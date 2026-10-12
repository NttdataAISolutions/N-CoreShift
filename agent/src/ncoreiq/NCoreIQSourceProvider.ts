/**
 * N-CoreShift — NCoreIQSourceProvider
 *
 * CodeSourceProvider implementation backed by N-CoreIQ.
 *
 * Product responsibility boundary:
 *   N-CoreIQ  = Technical repository evidence (SAP connectivity, extraction)
 *   N-CoreShift = Modernization judgement (this product)
 *
 * This provider:
 *   - Implements CodeSourceProviderContract for downstream compatibility
 *   - Adds N-CoreIQ-specific methods (testConnection, listPackages, etc.)
 *   - Maps N-CoreIQ DTOs → N-CoreShift domain models
 *   - Enforces evidence-first model: evidence is persisted before analysis
 *   - Enforces tenant/project isolation on all stored evidence
 *   - Treats all N-CoreIQ content as UNTRUSTED (never executes source)
 *   - Never logs Authorization headers, tokens, or credentials
 *
 * Authentication:
 *   SERVICE_TO_SERVICE_AUTH: DEFERRED UNTIL N-CORESHIFT BTP/XSUAA
 *   APPLICATION IDENTITY IS ESTABLISHED.
 *
 * Source hash:
 *   When N-CoreIQ provides sha256, it is stored as-is with ncoreiqProvidedHash=true.
 *   If sha256 is absent or empty, N-CoreShift computes SHA-256 using the same
 *   canonical algorithm (all lines joined by "\n", UTF-8 encoded).
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AuditService, BackgroundJobService } from '../services/domain-interfaces.js';
import type {
  CodeSourceProviderContract,
  IngestedSource,
  InMemorySourceFile,
  IngestionJobInput,
} from '../source/types.js';
import { NCoreIQClient } from './NCoreIQClient.js';
import { NCoreIQTokenAcquisitionError } from './NCoreIQTokenProvider.js';
import type {
  NCoreIQClientConfig,
  NCoreIQConnectionTestResult,
  NCoreIQObjectEvidence,
  NCoreIQDependencyRecord,
  NCoreIQImportJob,
  RepositorySearchRequest,
  PackageListOptions,
  DependencyQueryOptions,
  ExtractionJobRequest,
  PackageHierarchyResponse,
  RepositorySearchResponse,
  RepositoryObjectMetadata,
  RepositoryObjectSource,
  DirectDependenciesResponse,
  ExtractionJobCreatedResponse,
  JobStatusResponse,
} from './types.js';
import {
  NCoreIQApiError,
  NCoreIQTimeoutError,
  NCoreIQUnavailableError,
} from './types.js';

// ── In-memory evidence store (replace with persistent adapter in production) ──

export class InMemoryNCoreIQEvidenceStore {
  private _evidence: NCoreIQObjectEvidence[] = [];
  private _dependencies: NCoreIQDependencyRecord[] = [];
  private _jobs: NCoreIQImportJob[] = [];

  saveEvidence(ev: NCoreIQObjectEvidence): void {
    // Mark any previous version for the same object as not latest
    for (const e of this._evidence) {
      if (
        e.tenantId === ev.tenantId &&
        e.projectId === ev.projectId &&
        e.analysisId === ev.analysisId &&
        e.objectType === ev.objectType &&
        e.objectName === ev.objectName
      ) {
        e.isLatest = false;
      }
    }
    this._evidence.push(ev);
  }

  getEvidence(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): NCoreIQObjectEvidence[] {
    return this._evidence.filter(
      (e) =>
        e.tenantId === tenantId &&
        e.projectId === projectId &&
        e.analysisId === analysisId &&
        e.isLatest,
    );
  }

  getEvidenceByObject(
    tenantId: string,
    projectId: string,
    analysisId: string,
    objectType: string,
    objectName: string,
  ): NCoreIQObjectEvidence | undefined {
    return this._evidence.find(
      (e) =>
        e.tenantId === tenantId &&
        e.projectId === projectId &&
        e.analysisId === analysisId &&
        e.objectType === objectType &&
        e.objectName === objectName &&
        e.isLatest,
    );
  }

  saveDependencies(deps: NCoreIQDependencyRecord[]): void {
    this._dependencies.push(...deps);
  }

  getDependencies(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): NCoreIQDependencyRecord[] {
    return this._dependencies.filter(
      (d) =>
        d.tenantId === tenantId &&
        d.projectId === projectId &&
        d.analysisId === analysisId,
    );
  }

  saveJob(job: NCoreIQImportJob): void {
    const idx = this._jobs.findIndex((j) => j.localJobId === job.localJobId);
    if (idx >= 0) {
      this._jobs[idx] = job;
    } else {
      this._jobs.push(job);
    }
  }

  getJob(localJobId: string): NCoreIQImportJob | undefined {
    return this._jobs.find((j) => j.localJobId === localJobId);
  }

  getJobByUpstreamId(upstreamJobId: string): NCoreIQImportJob | undefined {
    return this._jobs.find((j) => j.upstreamJobId === upstreamJobId);
  }

  get evidenceCount(): number {
    return this._evidence.length;
  }

  clear(): void {
    this._evidence = [];
    this._dependencies = [];
    this._jobs = [];
  }
}

// ── Bulk import request ───────────────────────────────────────────────────

export interface BulkImportRequest {
  tenantId: string;
  projectId: string;
  analysisId: string;
  packages: string[];
  includeSubpackages?: boolean;
  includeMetadata?: boolean;
  includeDependencies?: boolean;
  requestedBy: string;
}

export interface BulkImportResult {
  localJobId: string;
  upstreamJobId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  objectsImported: number;
  objectsFailed: number;
  errors: string[];
}

// ── NCoreIQSourceProvider options ─────────────────────────────────────────

export interface NCoreIQSourceProviderOptions {
  /**
   * Authentication mode.
   * 'xsuaa'    → tokenProvider MUST be set in config. Fails closed if missing.
   * 'disabled' → No token sent. Only allowed when isProduction=false.
   */
  authMode?: 'xsuaa' | 'disabled';
  /**
   * Whether this is a production runtime (NODE_ENV=production).
   * When true, authMode='disabled' is rejected at construction time.
   * Defaults to false for backward compatibility with existing tests.
   */
  isProduction?: boolean;
}

// ── NCoreIQSourceProvider ─────────────────────────────────────────────────

export class NCoreIQSourceProvider implements CodeSourceProviderContract {
  private readonly _client: NCoreIQClient;
  private readonly _store: InMemoryNCoreIQEvidenceStore;
  private readonly _audit: AuditService | undefined;
  private readonly _jobs: BackgroundJobService | undefined;
  private readonly _baseUrl: string;

  constructor(
    config: NCoreIQClientConfig,
    store?: InMemoryNCoreIQEvidenceStore,
    audit?: AuditService,
    jobService?: BackgroundJobService,
    options?: NCoreIQSourceProviderOptions,
  ) {
    const authMode = options?.authMode ?? 'disabled';
    const isProduction = options?.isProduction ?? false;

    // Production MUST NOT use disabled auth mode
    if (isProduction && authMode === 'disabled') {
      throw new NCoreIQTokenAcquisitionError(
        'BINDING_MISSING',
        'NCoreIQSourceProvider: NCOREIQ_AUTH_MODE=disabled is not permitted in production. ' +
          'Set NCOREIQ_AUTH_MODE=xsuaa and provide a valid XSUAA service binding.',
      );
    }

    // xsuaa mode requires a tokenProvider in the client config — fail CLOSED
    if (authMode === 'xsuaa' && !config.tokenProvider) {
      throw new NCoreIQTokenAcquisitionError(
        'BINDING_MISSING',
        'NCoreIQSourceProvider: authMode=xsuaa but no tokenProvider was supplied in config. ' +
          'Use createNCoreIQTokenProvider() to build a provider from VCAP_SERVICES binding.',
      );
    }

    this._client = new NCoreIQClient(config);
    this._store = store ?? new InMemoryNCoreIQEvidenceStore();
    this._audit = audit;
    this._jobs = jobService;
    this._baseUrl = config.baseUrl;
  }

  providerName(): string {
    return 'NCoreIQSourceProvider';
  }

  supportedExtensions(): string[] {
    // Connected mode — source is retrieved directly, not via file extension.
    return ['.abap', '.asddls'];
  }

  // ── CodeSourceProviderContract: ingest() ─────────────────────────────────
  // Satisfies the interface for downstream pipeline compatibility.
  // Connected imports use importObject() / startBulkImport() instead.

  async ingest(input: IngestionJobInput): Promise<IngestedSource> {
    // For connected-mode imports via NCoreIQSourceProvider, callers use
    // importObject() directly. This ingest() entrypoint is provided for
    // interface compatibility and delegates to importObject() by interpreting
    // the input fileName as "objectType/objectName".
    const parts = input.fileName.split('/');
    if (parts.length !== 2) {
      throw new Error(
        'NCoreIQSourceProvider.ingest(): fileName must be "OBJECT_TYPE/OBJECT_NAME" ' +
          `for connected imports. Got: "${input.fileName}"`,
      );
    }
    const [objectType, objectName] = parts;
    const evidence = await this.importObject(
      input.tenantId,
      input.projectId,
      input.analysisId,
      objectType,
      objectName,
    );

    const file: InMemorySourceFile = {
      filePath: `${objectType}/${objectName}.abap`,
      originalName: `${objectName}.abap`,
      extension: '.abap',
      textContent: evidence.sourceText,
      sizeBytes: Buffer.byteLength(evidence.sourceText, 'utf-8'),
      contentHash: evidence.sourceHash,
      encoding: 'utf-8',
    };

    return {
      codeSourceId: evidence.id,
      files: [file],
      validationSummary: {
        valid: true,
        errors: [],
        warnings: [],
        detectedExtension: '.abap',
        sizeBytes: file.sizeBytes,
        contentHash: evidence.sourceHash,
        isZip: false,
      },
      totalFiles: 1,
      totalSizeBytes: file.sizeBytes,
      bundleHash: evidence.sourceHash,
    };
  }

  // ── Connection test ───────────────────────────────────────────────────────

  /**
   * Test N-CoreIQ → SAP connectivity.
   * Uses GET /api/v1/sap/ping (Contract 7-A).
   * Returns a normalized result. Never includes credentials or tokens.
   */
  async testConnection(): Promise<NCoreIQConnectionTestResult> {
    const testedAt = new Date().toISOString();
    try {
      const ping = await this._client.ping();
      await this._audit?.record(
        { tenantId: 'system', projectId: 'system' },
        'NCOREIQ_CONNECTION_TEST',
        'system',
        { systemId: ping.system_id, status: ping.status },
      );
      return {
        connected: ping.status === 'connected',
        sourceProvider: 'NCOREIQ',
        systemId: ping.system_id ?? null,
        client: ping.client ?? null,
        sapRelease: ping.sap_release ?? null,
        upstreamConnectionState: ping.status,
        testedAt,
        error: ping.status !== 'connected' ? ping.message : null,
      };
    } catch (err) {
      return {
        connected: false,
        sourceProvider: 'NCOREIQ',
        systemId: null,
        client: null,
        sapRelease: null,
        upstreamConnectionState: null,
        testedAt,
        error: _safeErrorMessage(err),
      };
    }
  }

  // ── Package Discovery ─────────────────────────────────────────────────────

  async listPackages(
    tenantId: string,
    rootPackage: string,
    options?: PackageListOptions,
  ): Promise<PackageHierarchyResponse> {
    await this._audit?.record(
      { tenantId, projectId: 'system' },
      'NCOREIQ_PACKAGE_BROWSE',
      'system',
      { rootPackage },
    );
    return this._client.listPackages(rootPackage, options ?? {});
  }

  // ── Object Preview ────────────────────────────────────────────────────────

  async previewObjects(
    tenantId: string,
    request: RepositorySearchRequest,
  ): Promise<RepositorySearchResponse> {
    await this._audit?.record(
      { tenantId, projectId: 'system' },
      'NCOREIQ_PACKAGE_PREVIEW',
      'system',
      { packages: request.packages },
    );
    return this._client.searchObjects(request);
  }

  // ── Individual Object Import ──────────────────────────────────────────────

  /**
   * Import a single SAP object from N-CoreIQ.
   * Fetches metadata + COMPLETE source (no max_lines) + dependencies.
   * Stores an immutable evidence snapshot scoped to tenantId/projectId.
   */
  async importObject(
    tenantId: string,
    projectId: string,
    analysisId: string,
    objectType: string,
    objectName: string,
    options: { includeDependencies?: boolean; isRefresh?: boolean } = {},
  ): Promise<NCoreIQObjectEvidence> {
    // Fetch metadata and complete source in parallel
    const [metadata, sourceResp] = await Promise.all([
      this._client.getMetadata(objectType, objectName),
      this._client.getSource(objectType, objectName), // NO max_lines
    ]);

    // Validate: reject truncated source — evidence must be complete
    if (sourceResp.truncated) {
      throw new Error(
        `NCoreIQSourceProvider: source for ${objectType}/${objectName} was truncated ` +
          `(returned_lines=${sourceResp.returned_lines}). Complete source is required.`,
      );
    }

    // Extract full source text from all components
    const sourceText = _extractSourceText(sourceResp);

    // Source hash — use N-CoreIQ's sha256 if present; compute locally otherwise
    let sourceHash = sourceResp.sha256;
    let ncoreiqProvidedHash = true;
    if (!sourceHash) {
      sourceHash = _computeSourceHash(sourceText);
      ncoreiqProvidedHash = false;
    }

    // Determine version
    const existing = this._store.getEvidenceByObject(
      tenantId,
      projectId,
      analysisId,
      objectType,
      objectName,
    );
    const version = existing ? existing.version + 1 : 1;
    const refreshedFrom = options.isRefresh ? existing?.id ?? null : null;

    const evidence: NCoreIQObjectEvidence = {
      id: randomUUID(),
      tenantId,
      projectId,
      analysisId,
      provider: 'NCOREIQ',
      ncoreiqBaseUrl: this._baseUrl,
      contractVersion: 'v1',
      systemId: sourceResp.system_id,
      client: sourceResp.client,
      sapRelease: null, // populated from testConnection if available
      sapPackage: metadata.package ?? '',
      objectType,
      objectName,
      author: metadata.author ?? null,
      createdDate: metadata.created_date ?? null,
      changedBy: metadata.changed_by ?? null,
      changedDate: metadata.changed_date ?? null,
      activeStatus: metadata.active_status ?? null,
      description: metadata.description ?? null,
      sourceText,
      returnedLines: sourceResp.returned_lines,
      sourceHash,
      ncoreiqProvidedHash,
      components: sourceResp.components,
      retrievedAt: new Date().toISOString(),
      version,
      isLatest: true,
      refreshedFrom,
    };

    this._store.saveEvidence(evidence);

    // Import dependencies if requested
    if (options.includeDependencies) {
      try {
        await this.importDependencies(tenantId, projectId, analysisId, objectType, objectName);
      } catch {
        // Dependency import failure does not invalidate object evidence
      }
    }

    await this._audit?.record(
      { tenantId, projectId },
      'NCOREIQ_OBJECT_IMPORT',
      'system',
      { objectType, objectName, returnedLines: sourceResp.returned_lines },
    );

    return evidence;
  }

  // ── Source Refresh ────────────────────────────────────────────────────────

  /**
   * Refresh an object's evidence from N-CoreIQ.
   * Previous versions remain intact — only isLatest changes.
   * This is an EXPLICIT operation; existing assessments are not affected.
   */
  async refreshObject(
    tenantId: string,
    projectId: string,
    analysisId: string,
    objectType: string,
    objectName: string,
  ): Promise<NCoreIQObjectEvidence> {
    return this.importObject(tenantId, projectId, analysisId, objectType, objectName, {
      isRefresh: true,
      includeDependencies: true,
    });
  }

  // ── Dependency Import ─────────────────────────────────────────────────────

  async importDependencies(
    tenantId: string,
    projectId: string,
    analysisId: string,
    objectType: string,
    objectName: string,
    options?: DependencyQueryOptions,
  ): Promise<NCoreIQDependencyRecord[]> {
    const resp: DirectDependenciesResponse = await this._client.getDependencies(
      objectType,
      objectName,
      options,
    );

    const records: NCoreIQDependencyRecord[] = resp.relationships.map((r) => ({
      id: randomUUID(),
      tenantId,
      projectId,
      analysisId,
      provider: 'NCOREIQ' as const,
      sourceObjectType: r.source_object_type,
      sourceObjectName: r.source_object_name,
      targetObjectType: r.target_object_type,
      targetObjectName: r.target_object_name,
      relationshipType: r.relationship_type,
      direction: 'OUTBOUND' as const,
      confidence: r.confidence,
      evidenceSource: r.evidence_source,
      sourceComponent: r.source_component,
      lineNo: r.line_no,
      dynamic: r.dynamic,
      importedAt: new Date().toISOString(),
    }));

    this._store.saveDependencies(records);
    return records;
  }

  // ── Bulk Package Import ───────────────────────────────────────────────────

  /**
   * Start an async bulk extraction job for the given packages.
   * Large imports run asynchronously — never blocks a browser request.
   * Uses POST /api/v1/repository/jobs (Contract 7-J).
   */
  async startBulkImport(request: BulkImportRequest): Promise<NCoreIQImportJob> {
    // 1. Preview to discover objects
    const searchResp = await this._client.searchObjects({
      packages: request.packages,
      include_subpackages: request.includeSubpackages ?? true,
    });

    const objects = searchResp.objects.map((o) => ({
      object_type: o.sap_object_type,
      object_name: o.object_name,
    }));

    // 2. Build extraction job request — source_max_lines: null = COMPLETE
    const jobReq: ExtractionJobRequest = {
      extraction: {
        objects,
        include_metadata: request.includeMetadata ?? true,
        include_source: true,
        source_max_lines: null, // COMPLETE source — never use 500 as default
        continue_on_error: true,
      },
      export_format: 'json',
    };

    // 3. Create upstream extraction job
    const created: ExtractionJobCreatedResponse = await this._client.createExtractionJob(jobReq);

    // 4. Enqueue local background job
    const localJobId = this._jobs
      ? await this._jobs.enqueue(
          { tenantId: request.tenantId, projectId: request.projectId },
          'NCOREIQ_BULK_IMPORT',
          { upstreamJobId: created.job_id, request },
        )
      : randomUUID();

    const job: NCoreIQImportJob = {
      localJobId,
      tenantId: request.tenantId,
      projectId: request.projectId,
      analysisId: request.analysisId,
      upstreamJobId: created.job_id,
      requestedPackages: request.packages,
      upstreamStatus: created.status,
      localStatus: 'QUEUED',
      objectsRequested: objects.length,
      objectsImported: 0,
      objectsFailed: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      artifactUrl: created.status_url,
      errors: [],
    };

    this._store.saveJob(job);

    await this._audit?.record(
      { tenantId: request.tenantId, projectId: request.projectId },
      'NCOREIQ_BULK_JOB_STARTED',
      request.requestedBy,
      { upstreamJobId: created.job_id, objectCount: objects.length },
    );

    return job;
  }

  /**
   * Poll upstream job status and update local job record.
   */
  async pollImportJob(localJobId: string): Promise<NCoreIQImportJob> {
    const job = this._store.getJob(localJobId);
    if (!job) throw new Error(`NCoreIQSourceProvider: job not found: ${localJobId}`);

    const statusResp: JobStatusResponse = await this._client.getJobStatus(job.upstreamJobId);

    const localStatus = _mapUpstreamStatus(statusResp.status);
    const updated: NCoreIQImportJob = {
      ...job,
      upstreamStatus: statusResp.status,
      localStatus,
      startedAt: statusResp.started_at ?? job.startedAt,
      completedAt: statusResp.completed_at ?? job.completedAt,
    };

    this._store.saveJob(updated);
    return updated;
  }

  /**
   * Retrieve stored evidence for a tenant/project/analysis scope.
   * Returns only the latest version of each object.
   * Tenant/project isolation is enforced — callers cannot read across tenants.
   */
  getEvidence(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): NCoreIQObjectEvidence[] {
    return this._store.getEvidence(tenantId, projectId, analysisId);
  }

  getDependencies(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): NCoreIQDependencyRecord[] {
    return this._store.getDependencies(tenantId, projectId, analysisId);
  }
}

// ── Module-private helpers ────────────────────────────────────────────────

/**
 * Extracts all source lines from all components, joined by "\n".
 * This is the canonical source text used for analysis and hashing.
 * Matches Section 8 sha256 algorithm: all_component_lines.join("\n").
 */
function _extractSourceText(sourceResp: RepositoryObjectSource): string {
  const allLines: string[] = [];
  for (const component of sourceResp.components) {
    for (const line of component.lines) {
      allLines.push(line.source_line);
    }
  }
  return allLines.join('\n');
}

/**
 * Compute SHA-256 of source text using the canonical algorithm from Section 8.
 * Used when N-CoreIQ does not provide sha256.
 */
function _computeSourceHash(sourceText: string): string {
  return createHash('sha256').update(sourceText, 'utf-8').digest('hex');
}

/**
 * Map NCoreIQ upstream job status to N-CoreShift local status.
 * N-CoreIQ terminal statuses: SUCCEEDED / FAILED / CANCELLED
 * N-CoreShift uses: COMPLETED / FAILED / CANCELLED  (no duplicate PARTIAL enum)
 */
function _mapUpstreamStatus(
  upstream: string,
): 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' {
  switch (upstream) {
    case 'QUEUED':
      return 'QUEUED';
    case 'RUNNING':
      return 'RUNNING';
    case 'SUCCEEDED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'RUNNING';
  }
}

/**
 * Convert any thrown error to a safe, non-sensitive message.
 * Never exposes tokens, credentials, or upstream stack traces.
 */
function _safeErrorMessage(err: unknown): string {
  if (err instanceof NCoreIQApiError) {
    return `N-CoreIQ API error [${err.httpStatus}] ${err.errorCode}`;
  }
  if (err instanceof NCoreIQTimeoutError) {
    return `N-CoreIQ request timed out after ${err.timeoutMs}ms`;
  }
  if (err instanceof NCoreIQUnavailableError) {
    return 'N-CoreIQ is unavailable';
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unknown error';
}
