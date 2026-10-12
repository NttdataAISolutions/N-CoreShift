/**
 * Phase 12 – BTP Service Adapter Tests
 * All HTTP calls mocked via jest.spyOn(global, 'fetch').
 */

import { jest } from '@jest/globals';
import { AiCoreProvider } from '../btp/AiCoreProvider.js';
import { ObjectStoreProvider } from '../btp/ObjectStoreProvider.js';
import { DestinationServiceProvider } from '../btp/DestinationServiceProvider.js';
import { ServiceBindingRegistry } from '../btp/ServiceBindingRegistry.js';
import type { AiCoreAdapterConfig, ObjectStoreAdapterConfig } from '../btp/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AI_CFG: AiCoreAdapterConfig = {
  apiUrl: 'https://api.ai.test',
  tokenUrl: 'https://auth.test',
  clientId: 'cid',
  clientSecret: 'csec',
  deploymentId: 'dep-001',
  defaultModel: 'gpt-4o',
  resourceGroup: 'default',
};

const S3_CFG: ObjectStoreAdapterConfig = {
  provider: 'aws-s3',
  bucket: 'test-bucket',
  region: 'eu-central-1',
  accessKeyId: 'AKIATEST',
  secretAccessKey: 'secret123',
  keyPrefix: 'test/',
};

const GCS_CFG: ObjectStoreAdapterConfig = {
  provider: 'gcp-gcs',
  bucket: 'gcs-bucket',
  projectId: 'fake-token',
  keyPrefix: 'test/',
};

const AZURE_CFG: ObjectStoreAdapterConfig = {
  provider: 'azure-blob',
  bucket: 'my-container',
  accountName: 'myaccount',
  sasToken: 'sv=2020&sig=xxx',
  keyPrefix: 'test/',
};

const DST_CFG = {
  serviceUrl: 'https://destination.test',
  clientId: 'dcid',
  clientSecret: 'dsec',
  tokenUrl: 'https://auth.test',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function okJson(body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => body,
    arrayBuffer: async () => Buffer.from(text).buffer,
  } as unknown as Response;
}

function okEmpty(status = 200): Response {
  return {
    ok: true,
    status,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function errResponse(status: number, msg = ''): Response {
  return {
    ok: false,
    status,
    text: async () => msg,
    json: async () => ({ error: msg }),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function tokenResponse(): Response {
  return okJson({ access_token: 'tok-abc', expires_in: 3600 });
}

function chatResponse(content: string, totalTokens = 10): Response {
  return okJson({
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: totalTokens - 5, total_tokens: totalTokens },
    model: 'gpt-4o',
  });
}

function bufferResponse(data: Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      const ab = new ArrayBuffer(data.length);
      new Uint8Array(ab).set(data);
      return ab;
    },
  } as unknown as Response;
}

// ── AiCoreProvider ────────────────────────────────────────────────────────────

describe('AiCoreProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('isConfigured() = true when all required fields present', () => {
    expect(new AiCoreProvider(AI_CFG).isConfigured()).toBe(true);
  });

  it('isConfigured() = false when apiUrl missing', () => {
    expect(new AiCoreProvider({ ...AI_CFG, apiUrl: '' }).isConfigured()).toBe(false);
  });

  it('generate() returns content from chat completion response', async () => {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValueOnce(chatResponse('Hello from AI Core!', 15));

    const result = await new AiCoreProvider(AI_CFG).generate({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Hello from AI Core!');
    expect(result.totalTokens).toBe(15);
    expect(String(fm.mock.calls[1][0])).toContain('/dep-001/chat/completions');
  });

  it('generate() retries on 429 and succeeds on second attempt', async () => {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValueOnce(errResponse(429, 'rate limited'));
    fm.mockResolvedValueOnce(chatResponse('Retry OK'));

    const result = await new AiCoreProvider({ ...AI_CFG, maxRetries: 2 }).generate({
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.content).toBe('Retry OK');
  });

  it('generate() throws after exhausting all retries', async () => {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValue(errResponse(500, 'server error'));

    await expect(
      new AiCoreProvider({ ...AI_CFG, maxRetries: 1 }).generate({
        messages: [{ role: 'user', content: 'fail' }],
      }),
    ).rejects.toThrow();
  });

  it('healthCheck() returns available=true when token succeeds', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(tokenResponse());
    const h = await new AiCoreProvider(AI_CFG).healthCheck();
    expect(h.available).toBe(true);
    expect(h.configured).toBe(true);
  });

  it('healthCheck() returns available=false when token fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(errResponse(401, 'unauthorized'));
    const h = await new AiCoreProvider(AI_CFG).healthCheck();
    expect(h.available).toBe(false);
    expect(h.errorMessage).toMatch(/401/);
  });

  it('healthCheck() returns configured=false when not configured', async () => {
    const h = await new AiCoreProvider({ ...AI_CFG, apiUrl: '' }).healthCheck();
    expect(h.configured).toBe(false);
    expect(h.available).toBe(false);
  });

  it('listModels() returns configured deployment', async () => {
    const models = await new AiCoreProvider(AI_CFG).listModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('dep-001');
    expect(models[0].name).toBe('gpt-4o');
  });

  it('metadata has no clientSecret', () => {
    const m = new AiCoreProvider(AI_CFG).metadata;
    expect(m.deploymentId).toBe('dep-001');
    expect(Object.keys(m)).not.toContain('clientSecret');
  });
});

// ── ObjectStoreProvider – S3 ──────────────────────────────────────────────────

describe('ObjectStoreProvider (aws-s3)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('store() PUTs data + meta and returns StoredFile', async () => {
    const fm = jest.spyOn(global, 'fetch').mockResolvedValue(okEmpty());
    const result = await new ObjectStoreProvider(S3_CFG).store({
      tenantId: 't1', projectId: 'p1', originalName: 'test.abap',
      content: Buffer.from('REPORT ZTEST.'), mimeType: 'text/plain',
    });
    expect(fm).toHaveBeenCalledTimes(2);
    expect(result.tenantId).toBe('t1');
    expect(result.originalName).toBe('test.abap');
    expect(result.sizeBytes).toBe(13);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.storagePath).toMatch(/^test\/t1\/p1\//);
  });

  it('retrieve() returns raw bytes', async () => {
    const data = Buffer.from('REPORT Z.');
    jest.spyOn(global, 'fetch').mockResolvedValue(bufferResponse(data));
    const bytes = await new ObjectStoreProvider(S3_CFG).retrieve(
      { tenantId: 't1', projectId: 'p1' }, 'f1',
    );
    expect(Buffer.from(bytes).toString()).toBe('REPORT Z.');
  });

  it('delete() sends two DELETE requests', async () => {
    const fm = jest.spyOn(global, 'fetch').mockResolvedValue(okEmpty(204));
    await new ObjectStoreProvider(S3_CFG).delete({ tenantId: 't1', projectId: 'p1' }, 'f2');
    expect(fm).toHaveBeenCalledTimes(2);
  });

  it('list() parses ListObjectsV2 XML and fetches meta for each entry', async () => {
    const xml = [
      '<?xml version="1.0"?><ListBucketResult>',
      '<Contents><Key>test/t1/p1/fa.meta.json</Key></Contents>',
      '<Contents><Key>test/t1/p1/fa</Key></Contents>',
      '</ListBucketResult>',
    ].join('');

    const meta = {
      id: 'fa', tenantId: 't1', projectId: 'p1', originalName: 'a.abap',
      storagePath: 'test/t1/p1/fa', sizeBytes: 42, mimeType: 'text/plain',
      uploadedAt: new Date().toISOString(),
    };

    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce({ ok: true, status: 200, text: async () => xml } as unknown as Response);
    fm.mockResolvedValueOnce(bufferResponse(Buffer.from(JSON.stringify(meta))));

    const files = await new ObjectStoreProvider(S3_CFG).list({ tenantId: 't1', projectId: 'p1' });
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe('fa');
  });

  it('getMeta() returns null on 404', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(errResponse(404));
    const result = await new ObjectStoreProvider(S3_CFG).getMeta(
      { tenantId: 't1', projectId: 'p1' }, 'no-such',
    );
    expect(result).toBeNull();
  });

  it('keyPrefix is reflected in storagePath', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okEmpty());
    const r = await new ObjectStoreProvider({ ...S3_CFG, keyPrefix: 'custom/' }).store({
      tenantId: 'T', projectId: 'P', originalName: 'f.abap',
      content: Buffer.from('x'), mimeType: 'text/plain',
    });
    expect(r.storagePath).toMatch(/^custom\/T\/P\//);
  });
});

// ── ObjectStoreProvider – GCS ─────────────────────────────────────────────────

describe('ObjectStoreProvider (gcp-gcs)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('store() POSTs to GCS upload URL', async () => {
    const fm = jest.spyOn(global, 'fetch').mockResolvedValue(okEmpty());
    await new ObjectStoreProvider(GCS_CFG).store({
      tenantId: 't2', projectId: 'p2', originalName: 'code.abap',
      content: Buffer.from('CLASS Z.'), mimeType: 'text/plain',
    });
    expect(String(fm.mock.calls[0][0])).toContain('storage.googleapis.com/upload');
  });

  it('retrieve() GETs from GCS download URL', async () => {
    const data = Buffer.from('CLASS Z.');
    jest.spyOn(global, 'fetch').mockResolvedValue(bufferResponse(data));
    const bytes = await new ObjectStoreProvider(GCS_CFG).retrieve(
      { tenantId: 't2', projectId: 'p2' }, 'fid',
    );
    expect(Buffer.from(bytes).toString()).toBe('CLASS Z.');
  });
});

// ── ObjectStoreProvider – Azure Blob ─────────────────────────────────────────

describe('ObjectStoreProvider (azure-blob)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('store() sends x-ms-blob-type: BlockBlob header', async () => {
    const fm = jest.spyOn(global, 'fetch').mockResolvedValue(okEmpty(201));
    await new ObjectStoreProvider(AZURE_CFG).store({
      tenantId: 't3', projectId: 'p3', originalName: 'z.abap',
      content: Buffer.from('DATA.'), mimeType: 'text/plain',
    });
    const [, init] = fm.mock.calls[0] as [unknown, { method?: string; headers?: Record<string, string>; body?: unknown }];
    expect((init.headers as Record<string, string>)['x-ms-blob-type']).toBe('BlockBlob');
  });

  it('retrieve() GETs from Azure Blob URL', async () => {
    const data = Buffer.from('DATA.');
    jest.spyOn(global, 'fetch').mockResolvedValue(bufferResponse(data));
    const bytes = await new ObjectStoreProvider(AZURE_CFG).retrieve(
      { tenantId: 't3', projectId: 'p3' }, 'bid',
    );
    expect(Buffer.from(bytes).toString()).toBe('DATA.');
  });
});

// ── DestinationServiceProvider ────────────────────────────────────────────────

describe('DestinationServiceProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  function stubDst(destPayload: unknown): ReturnType<typeof jest.spyOn> {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValueOnce(okJson(destPayload));
    return fm;
  }

  const DST_PAYLOAD = {
    destinationConfiguration: {
      URL: 'https://s4.example.com',
      Authentication: 'OAuth2ClientCredentials',
    },
    authTokens: [{ type: 'Bearer', value: 'resolved-bearer' }],
  };

  it('resolve() returns url and authorizationHeader', async () => {
    stubDst(DST_PAYLOAD);
    const dst = new DestinationServiceProvider(DST_CFG);
    const result = await dst.resolve('S4_SYSTEM');
    expect(result.url).toBe('https://s4.example.com');
    expect(result.authorizationHeader).toBe('Bearer resolved-bearer');
    expect(result.authenticationType).toBe('OAuth2ClientCredentials');
  });

  it('resolve() returns cached result on second call', async () => {
    const fm = stubDst(DST_PAYLOAD);
    const dst = new DestinationServiceProvider(DST_CFG);
    await dst.resolve('S4_SYSTEM');
    await dst.resolve('S4_SYSTEM'); // should not call fetch again
    expect(fm).toHaveBeenCalledTimes(2); // 1 token + 1 destination
  });

  it('resolve() re-fetches after evict()', async () => {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValueOnce(okJson(DST_PAYLOAD));
    fm.mockResolvedValueOnce(okJson(DST_PAYLOAD));
    const dst = new DestinationServiceProvider(DST_CFG);
    await dst.resolve('S4_SYSTEM');
    dst.evict('S4_SYSTEM');
    await dst.resolve('S4_SYSTEM');
    expect(fm).toHaveBeenCalledTimes(3);
  });

  it('resolve() builds BasicAuthentication header', async () => {
    stubDst({
      destinationConfiguration: {
        URL: 'https://basic.example.com',
        Authentication: 'BasicAuthentication',
        User: 'admin',
        Password: 'pass123',
      },
    });
    const result = await new DestinationServiceProvider(DST_CFG).resolve('BASIC_DST');
    expect(result.authorizationHeader).toBe(
      'Basic ' + Buffer.from('admin:pass123').toString('base64'),
    );
  });

  it('resolve() leaves authorizationHeader undefined for NoAuthentication', async () => {
    stubDst({
      destinationConfiguration: { URL: 'https://open.example.com', Authentication: 'NoAuthentication' },
    });
    const result = await new DestinationServiceProvider(DST_CFG).resolve('OPEN_DST');
    expect(result.authorizationHeader).toBeUndefined();
  });

  it('resolve() throws on 404', async () => {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValueOnce(errResponse(404));
    await expect(
      new DestinationServiceProvider(DST_CFG).resolve('MISSING'),
    ).rejects.toThrow(/not found/i);
  });

  it('resolve() throws when authToken has error field', async () => {
    stubDst({
      destinationConfiguration: { URL: 'https://err.example.com', Authentication: 'OAuth2ClientCredentials' },
      authTokens: [{ type: 'Bearer', value: '', error: 'token_error' }],
    });
    await expect(
      new DestinationServiceProvider(DST_CFG).resolve('ERR_DST'),
    ).rejects.toThrow(/token_error/);
  });

  it('listNames() returns destination name array', async () => {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValueOnce(
      okJson([
        { destinationName: 'S4_PROD' },
        { destinationName: 'SCI_DEV' },
      ]),
    );
    const names = await new DestinationServiceProvider(DST_CFG).listNames();
    expect(names).toEqual(['S4_PROD', 'SCI_DEV']);
  });

  it('clearCache() forces re-fetch on next resolve()', async () => {
    const fm = jest.spyOn(global, 'fetch');
    fm.mockResolvedValueOnce(tokenResponse());
    fm.mockResolvedValueOnce(okJson(DST_PAYLOAD));
    fm.mockResolvedValueOnce(okJson(DST_PAYLOAD));
    const dst = new DestinationServiceProvider(DST_CFG);
    await dst.resolve('S4_SYSTEM');
    dst.clearCache();
    await dst.resolve('S4_SYSTEM');
    expect(fm).toHaveBeenCalledTimes(3);
  });
});

// ── ServiceBindingRegistry ────────────────────────────────────────────────────

describe('ServiceBindingRegistry', () => {
  afterEach(() => jest.restoreAllMocks());

  const FULL_REG = () =>
    new ServiceBindingRegistry(AI_CFG, S3_CFG, {
      serviceUrl: 'https://destination.test',
      clientId: 'dcid',
      clientSecret: 'dsec',
      tokenUrl: 'https://auth.test',
    });

  it('constructor exposes aiCore, objectStore, destination instances', () => {
    const reg = FULL_REG();
    expect(reg.aiCore).toBeInstanceOf(AiCoreProvider);
    expect(reg.objectStore).toBeInstanceOf(ObjectStoreProvider);
    expect(reg.destination).toBeInstanceOf(DestinationServiceProvider);
  });

  it('assertAllBound() throws when AI Core config is empty', () => {
    const reg = new ServiceBindingRegistry(
      { ...AI_CFG, apiUrl: '', clientId: '' },
      S3_CFG,
      { serviceUrl: 'https://destination.test', clientId: 'dcid', clientSecret: 'dsec', tokenUrl: 'https://auth.test' },
    );
    expect(() => reg.assertAllBound(['aiCore'])).toThrow(/not configured/i);
  });

  it('assertAllBound() does not throw when AI Core is configured', () => {
    const reg = FULL_REG();
    expect(() => reg.assertAllBound(['aiCore'])).not.toThrow();
  });

  it('healthCheck() returns ok=true for aiCore when token succeeds', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(tokenResponse())                    // aiCore health token
      .mockResolvedValueOnce(tokenResponse())                    // destination token
      .mockResolvedValueOnce(okJson([{ destinationName: 'X' }])); // destination listNames

    const reg = FULL_REG();
    const result = await reg.healthCheck();
    expect(result['aiCore'].ok).toBe(true);
    expect(result['objectStore'].ok).toBe(false); // OBJECTSTORE_BUCKET env not set
    expect(result['destination'].ok).toBe(true);
  });

  it('healthCheck() marks aiCore ok=false when token fails', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(errResponse(401, 'unauth'))         // aiCore token fails
      .mockResolvedValueOnce(tokenResponse())                    // destination token
      .mockResolvedValueOnce(okJson([]));                        // destination listNames

    const result = await FULL_REG().healthCheck();
    expect(result['aiCore'].ok).toBe(false);
  });

  it('fromEnvironment() creates registry from env vars', () => {
    process.env['AICORE_API_URL'] = 'https://ai.env.test';
    process.env['AICORE_TOKEN_URL'] = 'https://auth.env.test';
    process.env['AICORE_CLIENT_ID'] = 'env-cid';
    process.env['AICORE_CLIENT_SECRET'] = 'env-sec';
    process.env['AICORE_DEPLOYMENT_ID'] = 'env-dep';
    const reg = ServiceBindingRegistry.fromEnvironment();
    expect(reg.aiCore.isConfigured()).toBe(true);
    delete process.env['AICORE_API_URL'];
    delete process.env['AICORE_TOKEN_URL'];
    delete process.env['AICORE_CLIENT_ID'];
    delete process.env['AICORE_CLIENT_SECRET'];
    delete process.env['AICORE_DEPLOYMENT_ID'];
  });
});
