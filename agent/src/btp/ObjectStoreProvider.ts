/**
 * N-CoreShift – SAP BTP Object Store Provider (FileStorageProvider adapter)
 *
 * Supports AWS S3, Azure Blob Storage, and GCP GCS – whichever backing
 * provider is bound to the BTP Object Store service instance.
 *
 * All object keys are namespaced:  {keyPrefix}{tenantId}/{projectId}/{fileId}
 *
 * Design decisions:
 *  - Uses built-in fetch for S3/GCS presigned-URL style operations and Azure
 *    REST API to avoid adding cloud-SDK dependencies to the agent package.
 *  - AWS Signature v4 is implemented inline (minimal subset needed for
 *    PutObject / GetObject / DeleteObject / ListObjectsV2).
 *  - Metadata JSON is stored as a companion object at {key}.meta.json so that
 *    getMeta() and list() can operate without a separate database.
 */

import crypto from 'node:crypto';
import type { FileStorageProvider } from '../providers/FileStorageProvider.js';
import type { TenantScope, StoredFile, FileUploadRequest } from '../types/index.js';
import type { ObjectStoreAdapterConfig } from './types.js';

// ── Key helpers ───────────────────────────────────────────────────────────────

function buildKey(prefix: string, scope: TenantScope, fileId: string): string {
  return `${prefix}${scope.tenantId}/${scope.projectId}/${fileId}`;
}

function metaKey(key: string): string {
  return `${key}.meta.json`;
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── AWS Signature V4 (minimal – covers S3 REST API needs) ────────────────────

function hmac(key: crypto.BinaryLike | crypto.KeyObject, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto
    .createHash('sha256')
    .update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    .digest('hex');
}

interface S3RequestParams {
  method: string;
  bucket: string;
  region: string;
  key: string;
  body?: Buffer;
  contentType?: string;
  accessKeyId: string;
  secretAccessKey: string;
  queryParams?: Record<string, string>;
}

function buildS3Headers(params: S3RequestParams): {
  url: string;
  headers: Record<string, string>;
} {
  const {
    method,
    bucket,
    region,
    key,
    body,
    contentType,
    accessKeyId,
    secretAccessKey,
    queryParams = {},
  } = params;

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${key}${
    Object.keys(queryParams).length
      ? '?' + new URLSearchParams(queryParams).toString()
      : ''
  }`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.substring(0, 8);

  const bodyHash = sha256Hex(body ?? Buffer.alloc(0));

  const canonicalHeaders =
    `content-type:${contentType ?? 'application/octet-stream'}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalRequest = [
    method,
    `/${key}`,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(Buffer.from('AWS4' + secretAccessKey, 'utf8'), dateStamp), region), 's3'),
    'aws4_request',
  );
  const signature = hmac(signingKey, stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url,
    headers: {
      'Content-Type': contentType ?? 'application/octet-stream',
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': bodyHash,
      Authorization: authorization,
    },
  };
}

// ── ObjectStoreProvider ───────────────────────────────────────────────────────

export class ObjectStoreProvider implements FileStorageProvider {
  readonly providerId = 'btp-object-store';

  private readonly cfg: Required<Pick<ObjectStoreAdapterConfig, 'provider' | 'bucket'>> &
    ObjectStoreAdapterConfig;

  constructor(config: ObjectStoreAdapterConfig) {
    this.cfg = { keyPrefix: 'ncoreshift/', ...config };
  }

  // ── FileStorageProvider: store ──────────────────────────────────────────────

  async store(request: FileUploadRequest): Promise<StoredFile> {
    const fileId = generateId();
    const scope: TenantScope = { tenantId: request.tenantId, projectId: request.projectId };
    const key = buildKey(this.cfg.keyPrefix!, scope, fileId);

    await this._put(key, request.content, request.mimeType);

    const record: StoredFile = {
      id: fileId,
      tenantId: request.tenantId,
      projectId: request.projectId,
      originalName: request.originalName,
      storagePath: key,
      sizeBytes: request.content.length,
      mimeType: request.mimeType,
      uploadedAt: new Date().toISOString(),
    };

    await this._put(
      metaKey(key),
      Buffer.from(JSON.stringify(record), 'utf8'),
      'application/json',
    );

    return record;
  }

  // ── FileStorageProvider: retrieve ───────────────────────────────────────────

  async retrieve(scope: TenantScope, fileId: string): Promise<Uint8Array> {
    const key = buildKey(this.cfg.keyPrefix!, scope, fileId);
    return this._get(key);
  }

  // ── FileStorageProvider: getMeta ────────────────────────────────────────────

  async getMeta(scope: TenantScope, fileId: string): Promise<StoredFile | null> {
    const key = buildKey(this.cfg.keyPrefix!, scope, fileId);
    try {
      const bytes = await this._get(metaKey(key));
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as StoredFile;
    } catch {
      return null;
    }
  }

  // ── FileStorageProvider: list ───────────────────────────────────────────────

  async list(scope: TenantScope): Promise<StoredFile[]> {
    const prefix = `${this.cfg.keyPrefix}${scope.tenantId}/${scope.projectId}/`;
    const keys = await this._listKeys(prefix);
    // Only process .meta.json objects
    const metaKeys = keys.filter((k) => k.endsWith('.meta.json'));
    const results: StoredFile[] = [];
    for (const mk of metaKeys) {
      try {
        const bytes = await this._get(mk);
        const record = JSON.parse(Buffer.from(bytes).toString('utf8')) as StoredFile;
        results.push(record);
      } catch {
        // Skip corrupt/missing meta entries
      }
    }
    return results;
  }

  // ── FileStorageProvider: delete ─────────────────────────────────────────────

  async delete(scope: TenantScope, fileId: string): Promise<void> {
    const key = buildKey(this.cfg.keyPrefix!, scope, fileId);
    await this._delete(key);
    await this._delete(metaKey(key)).catch(() => {
      /* best-effort */
    });
  }

  // ── Provider dispatch ───────────────────────────────────────────────────────

  private async _put(key: string, body: Buffer, contentType: string): Promise<void> {
    switch (this.cfg.provider) {
      case 'aws-s3':
        await this._s3Put(key, body, contentType);
        break;
      case 'azure-blob':
        await this._azurePut(key, body, contentType);
        break;
      case 'gcp-gcs':
        await this._gcsPut(key, body, contentType);
        break;
    }
  }

  private async _get(key: string): Promise<Buffer> {
    switch (this.cfg.provider) {
      case 'aws-s3':
        return this._s3Get(key);
      case 'azure-blob':
        return this._azureGet(key);
      case 'gcp-gcs':
        return this._gcsGet(key);
    }
  }

  private async _delete(key: string): Promise<void> {
    switch (this.cfg.provider) {
      case 'aws-s3':
        await this._s3Delete(key);
        break;
      case 'azure-blob':
        await this._azureDelete(key);
        break;
      case 'gcp-gcs':
        await this._gcsDelete(key);
        break;
    }
  }

  private async _listKeys(prefix: string): Promise<string[]> {
    switch (this.cfg.provider) {
      case 'aws-s3':
        return this._s3List(prefix);
      case 'azure-blob':
        return this._azureList(prefix);
      case 'gcp-gcs':
        return this._gcsList(prefix);
    }
  }

  // ── AWS S3 operations ───────────────────────────────────────────────────────

  private _s3Params() {
    return {
      bucket: this.cfg.bucket,
      region: this.cfg.region ?? 'eu-central-1',
      accessKeyId: this.cfg.accessKeyId ?? '',
      secretAccessKey: this.cfg.secretAccessKey ?? '',
    };
  }

  private async _s3Put(key: string, body: Buffer, contentType: string): Promise<void> {
    const p = this._s3Params();
    const { url, headers } = buildS3Headers({
      method: 'PUT',
      ...p,
      key,
      body,
      contentType,
    });
    const res = await fetch(url, { method: 'PUT', headers, body });
    if (!res.ok) throw new Error(`S3 PUT failed: HTTP ${res.status}`);
  }

  private async _s3Get(key: string): Promise<Buffer> {
    const p = this._s3Params();
    const { url, headers } = buildS3Headers({ method: 'GET', ...p, key });
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new Error(`S3 GET failed: HTTP ${res.status} for key ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async _s3Delete(key: string): Promise<void> {
    const p = this._s3Params();
    const { url, headers } = buildS3Headers({ method: 'DELETE', ...p, key });
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE failed: HTTP ${res.status}`);
  }

  private async _s3List(prefix: string): Promise<string[]> {
    const p = this._s3Params();
    const { url, headers } = buildS3Headers({
      method: 'GET',
      ...p,
      key: '',
      queryParams: { 'list-type': '2', prefix },
    });
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new Error(`S3 LIST failed: HTTP ${res.status}`);
    const xml = await res.text();
    // Minimal XML parse – extract <Key> values
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  }

  // ── Azure Blob Storage operations ───────────────────────────────────────────

  private _azureBaseUrl(blobName: string): string {
    return (
      `https://${this.cfg.accountName}.blob.core.windows.net` +
      `/${this.cfg.bucket}/${encodeURIComponent(blobName)}` +
      (this.cfg.sasToken ? `?${this.cfg.sasToken}` : '')
    );
  }

  private async _azurePut(key: string, body: Buffer, contentType: string): Promise<void> {
    const url = this._azureBaseUrl(key);
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': contentType,
        'Content-Length': String(body.length),
      },
      body,
    });
    if (!res.ok) throw new Error(`Azure Blob PUT failed: HTTP ${res.status}`);
  }

  private async _azureGet(key: string): Promise<Buffer> {
    const url = this._azureBaseUrl(key);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Azure Blob GET failed: HTTP ${res.status} for ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async _azureDelete(key: string): Promise<void> {
    const url = this._azureBaseUrl(key);
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Azure Blob DELETE failed: HTTP ${res.status}`);
    }
  }

  private async _azureList(prefix: string): Promise<string[]> {
    const qs = new URLSearchParams({
      restype: 'container',
      comp: 'list',
      prefix,
      ...(this.cfg.sasToken ? Object.fromEntries(new URLSearchParams(this.cfg.sasToken)) : {}),
    });
    const url =
      `https://${this.cfg.accountName}.blob.core.windows.net/${this.cfg.bucket}?${qs}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Azure Blob LIST failed: HTTP ${res.status}`);
    const xml = await res.text();
    return [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
  }

  // ── GCP Cloud Storage operations ─────────────────────────────────────────────
  // GCS uses a simple OAuth2 Bearer token passed via the projectId field
  // (serviceAccountToken) for service-account-based access from Cloud Run / BTP.

  private _gcsBaseUrl(objectName: string): string {
    const encoded = encodeURIComponent(objectName);
    return `https://storage.googleapis.com/upload/storage/v1/b/${this.cfg.bucket}/o?uploadType=media&name=${encoded}`;
  }

  private _gcsDownloadUrl(objectName: string): string {
    const encoded = encodeURIComponent(objectName);
    return `https://storage.googleapis.com/storage/v1/b/${this.cfg.bucket}/o/${encoded}?alt=media`;
  }

  private _gcsObjectUrl(objectName: string): string {
    const encoded = encodeURIComponent(objectName);
    return `https://storage.googleapis.com/storage/v1/b/${this.cfg.bucket}/o/${encoded}`;
  }

  private _gcsAuthHeader(): string {
    // projectId is repurposed to carry the service-account access token in the
    // BTP adapter. In a production deployment this token is obtained via
    // Workload Identity Federation or a mounted service-account key.
    return `Bearer ${this.cfg.projectId ?? ''}`;
  }

  private async _gcsPut(key: string, body: Buffer, contentType: string): Promise<void> {
    const encoded = encodeURIComponent(key);
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${this.cfg.bucket}/o?uploadType=media&name=${encoded}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this._gcsAuthHeader(),
        'Content-Type': contentType,
        'Content-Length': String(body.length),
      },
      body,
    });
    if (!res.ok) throw new Error(`GCS PUT failed: HTTP ${res.status}`);
  }

  private async _gcsGet(key: string): Promise<Buffer> {
    const url = this._gcsDownloadUrl(key);
    const res = await fetch(url, {
      headers: { Authorization: this._gcsAuthHeader() },
    });
    if (!res.ok) throw new Error(`GCS GET failed: HTTP ${res.status} for ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async _gcsDelete(key: string): Promise<void> {
    const url = this._gcsObjectUrl(key);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this._gcsAuthHeader() },
    });
    if (!res.ok && res.status !== 404) throw new Error(`GCS DELETE failed: HTTP ${res.status}`);
  }

  private async _gcsList(prefix: string): Promise<string[]> {
    const qs = new URLSearchParams({ prefix });
    const url = `https://storage.googleapis.com/storage/v1/b/${this.cfg.bucket}/o?${qs}`;
    const res = await fetch(url, {
      headers: { Authorization: this._gcsAuthHeader() },
    });
    if (!res.ok) throw new Error(`GCS LIST failed: HTTP ${res.status}`);
    const data = (await res.json()) as { items?: { name: string }[] };
    return (data.items ?? []).map((i) => i.name);
  }
}
