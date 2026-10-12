/**
 * N-CoreShift — N-CoreIQ External Consumer Types
 *
 * All types are derived EXCLUSIVELY from the N-CoreIQ External Consumer
 * Contract v1 (ncoreiq-consumer-contract-v1.md).
 *
 * CONTRACT MISMATCH NOTE (2026-10-11):
 *  The original stub had incorrect field names. Corrections:
 *    - PackageEntry: package/parent_package/depth (not package_name)
 *    - NCoreIQObjectEntry: package/friendly_type/author/match_reason
 *    - RepositoryObjectSource: components[] (not flat lines[])
 *    - DependencyRelation: relation_id/source_object_type/relationship_type/
 *      confidence/evidence_source/source_component/line_no/dynamic
 *    - DirectDependenciesResponse: relationships[] (not dependencies[])
 */

// ── Client configuration ──────────────────────────────────────────────────

/**
 * NCoreIQClient configuration.
 * Base URLs (Section 2):
 *   Production : https://ncoreiq.cfapps.us10.hana.ondemand.com
 *   Local dev  : http://localhost:8000
 *
 * Use the direct backend URL. Never use the AppRouter URL for backend integration.
 * Controlled via NCOREIQ_BASE_URL env var — never hard-coded.
 */
export interface NCoreIQClientConfig {
  /** No trailing slash. Set via NCOREIQ_BASE_URL env var. */
  baseUrl: string;
  /**
   * Bearer JWT for XSUAA (Section 3).
   * SERVICE_TO_SERVICE_AUTH: DEFERRED UNTIL N-CORESHIFT BTP/XSUAA
   * APPLICATION IDENTITY IS ESTABLISHED.
   */
  bearerToken?: string;
  /** Request timeout ms. Default 30 000. */
  timeoutMs?: number;
  /**
   * Optional fetch implementation override — for testing only.
   * In production, globalThis.fetch (Node 18+) is used.
   * Inject a mock here in tests to avoid network calls.
   */
  fetchFn?: (url: string, init?: Record<string, unknown>) => Promise<{
    ok: boolean;
    status: number;
    headers: { get: (name: string) => string | null };
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }>;
}

export type NCoreIQAuthMode = 'disabled' | 'xsuaa';

// ── Error types (Section 6) ───────────────────────────────────────────────

export interface NCoreIQErrorBody {
  error: string;
  message: string;
  request_id: string;
  correlation_id: string;
}

export interface NCoreIQValidationError {
  detail: string | unknown[];
}

export class NCoreIQApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly errorCode: string,
    message: string,
    public readonly requestId?: string,
    public readonly correlationId?: string,
  ) {
    super(`[NCoreIQ ${httpStatus}] ${errorCode}: ${message}`);
    this.name = 'NCoreIQApiError';
  }
}

export class NCoreIQTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`N-CoreIQ request timed out after ${timeoutMs}ms`);
    this.name = 'NCoreIQTimeoutError';
  }
}

export class NCoreIQUnavailableError extends Error {
  constructor(cause?: string) {
    super(`N-CoreIQ is unavailable${cause ? ': ' + cause : ''}`);
    this.name = 'NCoreIQUnavailableError';
  }
}

// ── HTTP status constants (Section 6) ────────────────────────────────────

export const NCOREIQ_HTTP = {
  OK: 200,
  ACCEPTED: 202,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE: 422,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  SAP_UNAVAILABLE: 503,
} as const;

// ── 7-A: SAP Ping — GET /api/v1/sap/ping ─────────────────────────────────

export interface SAPPingResponse {
  status: 'connected' | 'error';
  connection_mode: string;
  system_id: string;
  client: string;
  sap_release: string;
  timestamp: string; // YYYYMMDD
  ping_method: string;
  message: string;
}

// ── 7-B: Package Discovery — GET /api/v1/repository/packages/{package} ───

export interface NCoreIQPackageEntry {
  package: string;
  parent_package: string | null;
  description: string;
  depth: number;
}

export interface PackageListOptions {
  include_subpackages?: boolean;
  max_depth?: number; // 0-20, default 20
}

export interface PackageHierarchyResponse {
  system_id: string;
  client: string;
  root_package: string;
  include_subpackages: boolean;
  max_depth: number;
  truncated: boolean;
  message: string | null;
  packages: NCoreIQPackageEntry[];
}

// ── 7-C: Repository Search — POST /api/v1/repository/search ──────────────

export interface RepositorySearchRequest {
  packages?: string[];
  name_patterns?: string[];
  /** Supported: PROG CLAS INTF FUGR FUNC TABL DTEL DOMA VIEW SHLP ENQU TRAN MSAG */
  object_types?: string[];
  include_subpackages?: boolean;
  all_custom_objects?: boolean;
  max_results?: number;
}

export interface NCoreIQObjectEntry {
  sap_object_type: string;
  friendly_type: string;
  object_name: string;
  package: string;
  description: string;
  author: string;
  match_reason: string;
}

export interface SearchStatistics {
  total_matches: number;
  returned_count: number;
}

export interface RepositorySearchResponse {
  system_id: string;
  client: string;
  truncated: boolean;
  message: string | null;
  statistics: SearchStatistics;
  objects: NCoreIQObjectEntry[];
}

// ── 7-D: Object Metadata — GET /api/v1/repository/objects/{type}/{name}/metadata

export interface RepositoryObjectMetadata {
  sap_object_type: string;
  object_name: string;
  system_id: string;
  client: string;
  pgmid: string;
  package: string;
  object_subtype: string | null;
  program_name: string | null;
  function_group: string | null;
  table_class: string | null;
  author: string;
  master_language: string;
  source_system: string | null;
  created_date: string; // YYYYMMDD
  changed_by: string;
  changed_date: string; // YYYYMMDD
  description: string;
  active_status: string;
  found: boolean;
  warning: string | null;
  message: string | null;
}

// ── 7-E: Object Source — GET /api/v1/repository/objects/{type}/{name}/source ──

export interface SourceLine {
  component_type: string;
  component_name: string;
  line_no: number; // 1-based
  source_line: string; // Unicode preserved — never execute
}

export interface SourceComponent {
  component_type: string;
  component_name: string;
  line_count: number;
  source_text: string;
  lines: SourceLine[];
}

/**
 * Complete source response (Section 7-E).
 *
 * sha256 = SHA-256( all_component_lines.join("\n").encode("utf-8") ) — Section 8.
 * Computed by N-CoreIQ. N-CoreShift stores it for evidence integrity.
 *
 * IMPORTANT: Do NOT request max_lines for production imports.
 * Omit max_lines to retrieve complete source (default behaviour).
 */
export interface RepositoryObjectSource {
  sap_object_type: string;
  object_name: string;
  system_id: string;
  client: string;
  max_lines: number | null; // null = complete; integer = bounded
  returned_lines: number;
  component_count: number;
  found: boolean;
  truncated: boolean;
  message: string | null;
  sha256: string;
  components: SourceComponent[];
}

// ── 7-F: Direct Dependencies ──────────────────────────────────────────────
// GET /api/v1/repository/objects/{type}/{name}/dependencies

export interface DependencyRelation {
  relation_id: number;
  system_id: string;
  client: string;
  source_object_type: string;
  source_object_name: string;
  target_object_type: string;
  target_object_name: string;
  relationship_type: string;
  confidence: 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';
  evidence_source: string;
  source_component: string;
  line_no: number | null;
  dynamic: boolean;
  detail: string | null;
}

export interface DependencyQueryOptions {
  relationship_type?: string[];
  min_confidence?: 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';
  max_results?: number;
}

export interface DirectDependenciesResponse {
  system_id: string;
  client: string;
  source_object_type: string;
  source_object_name: string;
  total_relations: number;
  returned_relations: number;
  truncated: boolean;
  message: string | null;
  relationships: DependencyRelation[];
}

// ── 7-G: Dependency Traversal ─────────────────────────────────────────────
// POST /api/v1/repository/dependencies/traverse

export interface SAPObjectRef {
  sap_object_type: string;
  object_name: string;
}

export interface DependencyTraversalRequest {
  root_object: SAPObjectRef;
  max_depth?: number; // <= 5
  max_nodes?: number; // <= 5000
  max_edges?: number; // <= 20000
}

export interface TraversalNode {
  sap_object_type: string;
  object_name: string;
}

export interface TraversalEdge {
  source: SAPObjectRef;
  target: SAPObjectRef;
  relationship_type: string;
  confidence: string;
}

export interface DependencyTraversalResponse {
  system_id: string;
  client: string;
  root_object: SAPObjectRef;
  nodes: TraversalNode[];
  edges: TraversalEdge[];
  cycles_detected: boolean;
  truncated: boolean;
  statistics: Record<string, number>;
}

// ── 7-H: Reverse Dependency Lookup ───────────────────────────────────────
// POST /api/v1/repository/dependencies/reverse

export interface DependencyScope {
  packages?: string[];
  name_patterns?: string[];
  all_custom_objects?: boolean;
  include_subpackages?: boolean;
}

export interface ReverseLookupRequest {
  target_object: SAPObjectRef;
  scope: DependencyScope;
  max_candidates?: number;
}

export interface ReverseDependentEntry {
  sap_object_type: string;
  object_name: string;
  relationship_types: string[];
  confidence: string;
  dynamic: boolean;
}

export interface ReverseLookupResponse {
  system_id: string;
  client: string;
  target_object: SAPObjectRef;
  dependents: ReverseDependentEntry[];
  truncated: boolean;
}

// ── 7-I: Dependency Impact Analysis ──────────────────────────────────────
// POST /api/v1/repository/dependencies/impact

export interface ImpactAnalysisRequest {
  object: SAPObjectRef;
  scope: DependencyScope;
}

export interface ImpactAnalysisResponse {
  system_id: string;
  client: string;
  object: SAPObjectRef;
  direct_dependent_count: number;
  total_impacted_objects: number;
  relationship_type_counts: Record<string, number>;
  confidence_counts: Record<string, number>;
  dynamic_reference_count: number;
  impacted_objects: ReverseDependentEntry[];
}

// ── 7-J: Extraction Job Creation ─────────────────────────────────────────
// POST /api/v1/repository/jobs

export interface ExtractionJobObject {
  object_type: string;
  object_name: string;
}

export interface ExtractionSpec {
  objects: ExtractionJobObject[];
  include_metadata: boolean;
  include_source: boolean;
  /** null = complete source (no limit). Never use 500 as default. */
  source_max_lines: number | null;
  continue_on_error: boolean;
}

export type ExportFormat = 'zip' | 'json' | 'none';

export interface ExtractionJobRequest {
  extraction: ExtractionSpec;
  export_format: ExportFormat;
}

/** N-CoreIQ job status values (Section 7-K terminal: SUCCEEDED/FAILED/CANCELLED). */
export type NCoreIQJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** Artifact summary embedded in job status response. */
export interface JobArtifactSummary {
  format: ExportFormat;
  size_bytes: number | null;
  sha256: string | null;
  available: boolean;
}

/** Job progress block. */
export interface JobProgress {
  percent_complete: number | null;
  processed_objects: number;
  total_objects: number;
  failed_objects: number;
}

/** Response from POST /api/v1/repository/jobs (HTTP 202). */
export interface ExtractionJobCreatedResponse {
  job_id: string;
  status: NCoreIQJobStatus;
  stage: string | null;
  created_at: string;
  status_url: string;
}

// ── 7-K: Job Status — GET /api/v1/repository/jobs/{job_id} ───────────────

export interface JobStatusResponse {
  job_id: string;
  status: NCoreIQJobStatus;
  stage: string | null;
  progress: JobProgress | null;
  artifact: JobArtifactSummary | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ── 7-L: Job Result — GET /api/v1/repository/jobs/{job_id}/result ─────────

export interface JobObjectResult {
  object_type: string;
  object_name: string;
  success: boolean;
  error_message: string | null;
}

export interface JobResultResponse {
  job_id: string;
  status: NCoreIQJobStatus;
  total_requested: number;
  succeeded_count: number;
  failed_count: number;
  results: JobObjectResult[];
}

// ── N-CoreShift domain mapping types ─────────────────────────────────────
//
// These types map N-CoreIQ evidence to N-CoreShift domain models.
// They are NOT part of the N-CoreIQ contract; they are N-CoreShift-owned.

/**
 * Result of NCoreIQSourceProvider.testConnection().
 * Normalized from SAPPingResponse. Credentials are never included.
 */
export interface NCoreIQConnectionTestResult {
  connected: boolean;
  /** N-CoreIQ source provider identifier. */
  sourceProvider: 'NCOREIQ';
  /** SAP SID from ping response, if available. */
  systemId: string | null;
  client: string | null;
  sapRelease: string | null;
  upstreamConnectionState: string | null;
  testedAt: string;
  error: string | null;
}

/**
 * N-CoreIQ evidence snapshot — immutable record of a single SAP object
 * retrieved from N-CoreIQ. Scoped by tenantId + projectId.
 *
 * Previously completed assessments remain explainable against the evidence
 * that existed at assessment time (evidence-first model, Section 13).
 */
export interface NCoreIQObjectEvidence {
  /** N-CoreShift generated ID. */
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  /** Fixed — always 'NCOREIQ'. */
  provider: 'NCOREIQ';
  /** N-CoreIQ base URL this evidence was retrieved from. */
  ncoreiqBaseUrl: string;
  /** N-CoreIQ contract version. */
  contractVersion: 'v1';
  // SAP provenance
  systemId: string;
  client: string;
  sapRelease: string | null;
  sapPackage: string;
  objectType: string;
  objectName: string;
  // Metadata (from RepositoryObjectMetadata)
  author: string | null;
  createdDate: string | null;
  changedBy: string | null;
  changedDate: string | null;
  activeStatus: string | null;
  description: string | null;
  // Source (COMPLETE — truncated=false required)
  sourceText: string;
  returnedLines: number;
  /**
   * sha256 from N-CoreIQ response (Section 8).
   * If N-CoreIQ provided it, ncoreiqProvidedHash=true.
   * If N-CoreShift computed it, ncoreiqProvidedHash=false.
   */
  sourceHash: string;
  ncoreiqProvidedHash: boolean;
  // Component structure
  components: SourceComponent[];
  // Retrieval provenance (N-CoreShift records the timestamp, Section 8)
  retrievedAt: string;
  // Version/refresh control
  version: number;
  isLatest: boolean;
  refreshedFrom: string | null;
}

/**
 * A normalized dependency record imported from N-CoreIQ.
 * A technical dependency is EVIDENCE only — not a Clean Core verdict.
 */
export interface NCoreIQDependencyRecord {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  provider: 'NCOREIQ';
  // Normalized from DependencyRelation
  sourceObjectType: string;
  sourceObjectName: string;
  targetObjectType: string;
  targetObjectName: string;
  relationshipType: string;
  direction: 'OUTBOUND';
  confidence: string;
  evidenceSource: string;
  sourceComponent: string;
  lineNo: number | null;
  dynamic: boolean;
  importedAt: string;
}

/**
 * Local import job record that tracks a bulk N-CoreIQ extraction job.
 * Correlates local BackgroundJobService job with upstream N-CoreIQ job.
 */
export interface NCoreIQImportJob {
  /** Local N-CoreShift job ID (from BackgroundJobService). */
  localJobId: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  /** Upstream N-CoreIQ job_id. */
  upstreamJobId: string;
  /** Packages requested for import. */
  requestedPackages: string[];
  /** N-CoreIQ job status (upstream). */
  upstreamStatus: NCoreIQJobStatus;
  /** N-CoreShift local job status (mapped). */
  localStatus: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  objectsRequested: number;
  objectsImported: number;
  objectsFailed: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** N-CoreIQ artifact download URL, if available. */
  artifactUrl: string | null;
  errors: string[];
}
