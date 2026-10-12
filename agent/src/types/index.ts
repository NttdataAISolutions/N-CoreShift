/**
 * N-CoreShift – Core Domain Types
 * These types form the shared contract for the entire analysis engine.
 * All records must be scoped by tenantId and projectId (Principle 18).
 */

// ── Tenant / Project scope ────────────────────────────────────────────────────

export interface TenantScope {
  tenantId: string;
  projectId: string;
}

// ── 4R Disposition model ──────────────────────────────────────────────────────

export type Disposition =
  | 'RETIRE'
  | 'REPLACE'
  | 'REFACTOR'
  | 'REPLATFORM'
  | 'REQUIRES_REVIEW';

export const ALL_DISPOSITIONS: Disposition[] = [
  'RETIRE',
  'REPLACE',
  'REFACTOR',
  'REPLATFORM',
  'REQUIRES_REVIEW',
];

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  RETIRE: 'Retire',
  REPLACE: 'Replace with SAP Standard',
  REFACTOR: 'Refactor to Clean Core',
  REPLATFORM: 'Replatform to BTP',
  REQUIRES_REVIEW: 'Requires Review',
};

// ── SAP Edition / Deployment model ───────────────────────────────────────────

export type SAPDeploymentModel =
  | 'S4_OP' // S/4HANA On-Premise
  | 'S4_PCE' // S/4HANA Cloud Private Edition
  | 'S4_PCE_RISE' // S/4HANA Cloud Private Edition (RISE)
  | 'S4_PUBLIC' // S/4HANA Cloud Public Edition
  | 'ECC' // SAP ECC (source only)
  | 'OTHER';

export const ALL_DEPLOYMENT_MODELS: SAPDeploymentModel[] = [
  'S4_OP',
  'S4_PCE',
  'S4_PCE_RISE',
  'S4_PUBLIC',
  'ECC',
  'OTHER',
];

export const DEPLOYMENT_MODEL_LABELS: Record<SAPDeploymentModel, string> = {
  S4_OP: 'SAP S/4HANA On-Premise',
  S4_PCE: 'SAP S/4HANA Cloud Private Edition',
  S4_PCE_RISE: 'SAP S/4HANA Cloud Private Edition (RISE)',
  S4_PUBLIC: 'SAP S/4HANA Cloud Public Edition',
  ECC: 'SAP ECC',
  OTHER: 'Other SAP System',
};

// ── Transformation scenario ──────────────────────────────────────────────────

export type TransformationScenario =
  | 'ECC_TO_S4'
  | 'S4_UPGRADE'
  | 'PCE_TO_PUBLIC'
  | 'BROWNFIELD'
  | 'SELECTIVE'
  | 'CLEAN_CORE_REMEDIATION'
  | 'OTHER';

export const ALL_TRANSFORMATION_SCENARIOS: TransformationScenario[] = [
  'ECC_TO_S4',
  'S4_UPGRADE',
  'PCE_TO_PUBLIC',
  'BROWNFIELD',
  'SELECTIVE',
  'CLEAN_CORE_REMEDIATION',
  'OTHER',
];

export const TRANSFORMATION_SCENARIO_LABELS: Record<
  TransformationScenario,
  string
> = {
  ECC_TO_S4: 'ECC to S/4HANA',
  S4_UPGRADE: 'S/4HANA Upgrade',
  PCE_TO_PUBLIC: 'S/4HANA Private to Public Transition',
  BROWNFIELD: 'Brownfield Modernization',
  SELECTIVE: 'Selective Data Transition',
  CLEAN_CORE_REMEDIATION: 'Existing S/4 Clean Core Remediation',
  OTHER: 'Other',
};

// ── Clean Core posture ────────────────────────────────────────────────────────

export type CleanCorePosture = 'STRICT' | 'BALANCED' | 'TRANSITIONAL' | 'CUSTOM';

export const ALL_CLEAN_CORE_POSTURES: CleanCorePosture[] = [
  'STRICT',
  'BALANCED',
  'TRANSITIONAL',
  'CUSTOM',
];

// ── Landscape Readiness state ─────────────────────────────────────────────────

export type LandscapeReadinessState =
  | 'DRAFT'
  | 'INCOMPLETE'
  | 'READY_FOR_ASSESSMENT'
  | 'APPROVED_FOR_ASSESSMENT'
  | 'APPROVED_FOR_CODE_GENERATION';

export const ALL_READINESS_STATES: LandscapeReadinessState[] = [
  'DRAFT',
  'INCOMPLETE',
  'READY_FOR_ASSESSMENT',
  'APPROVED_FOR_ASSESSMENT',
  'APPROVED_FOR_CODE_GENERATION',
];

// ── Evidence confidence ───────────────────────────────────────────────────────

export type EvidenceConfidence =
  | 'VERIFIED'
  | 'LIKELY'
  | 'REQUIRES_VERIFICATION'
  | 'INSUFFICIENT_EVIDENCE';

// ── Risk level ────────────────────────────────────────────────────────────────

export type CleanCoreRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ── Assessment status ─────────────────────────────────────────────────────────

export type AssessmentStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'REQUIRES_REVALIDATION';

// ── Plan / governance status ──────────────────────────────────────────────────

export type PlanStatus = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

// ── Code generation artifact type ─────────────────────────────────────────────

export type ArtifactType =
  | 'ABAP'
  | 'ABAP_CLOUD'
  | 'RAP'
  | 'CDS'
  | 'BADI_IMPLEMENTATION'
  | 'API_CONSUMPTION'
  | 'CAP_NODEJS'
  | 'BTP_SIDE_BY_SIDE'
  | 'INTEGRATION_CLIENT'
  | 'UNIT_TEST_SKELETON';

// ── Source access mode ────────────────────────────────────────────────────────

export type SourceAccessMode =
  | 'FILE_UPLOAD'
  | 'ABAPGIT_BUNDLE'
  | 'CONNECTED_SYSTEM'
  | 'ANALYSIS_REPORT';

// ── Permit level ──────────────────────────────────────────────────────────────

export type PermitLevel =
  | 'YES'
  | 'NO'
  | 'CONDITIONAL'
  | 'EXCEPTION_ONLY'
  | 'NOT_APPLICABLE';

// ── AI provider types ─────────────────────────────────────────────────────────

export interface AIModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  capabilities?: string[];
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionRequest {
  messages: AIMessage[];
  /** Caller-provided model hint – provider may override based on config */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Identifier for audit and observability */
  callerId?: string;
}

export interface AICompletionResponse {
  content: string;
  model: string;
  provider: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Normalised token usage – preferred for observability over the flat fields above */
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number };
}

export interface AIHealthStatus {
  configured: boolean;
  available: boolean;
  provider: string;
  model: string;
  checkedAt: string;
  errorMessage?: string;
}

// ── Vector store types ────────────────────────────────────────────────────────

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: VectorDocumentMetadata;
}

export interface VectorDocumentMetadata {
  tenantId: string;
  projectId?: string;
  sourceId?: string;
  chunkIndex?: number;
  [key: string]: unknown;
}

export interface VectorSearchResult {
  document: VectorDocument;
  score: number;
}

// ── Knowledge provider types ──────────────────────────────────────────────────

export interface KnowledgeSearchQuery {
  tenantId: string;
  projectId?: string;
  text: string;
  topK?: number;
  filter?: Record<string, unknown>;
}

export interface KnowledgeSearchResult {
  items: KnowledgeSearchResultItem[];
  query: string;
  provider: string;
}

export interface KnowledgeSearchResultItem {
  id: string;
  content: string;
  score: number;
  metadata: VectorDocumentMetadata;
}

// ── File storage types ────────────────────────────────────────────────────────

export interface StoredFile {
  id: string;
  tenantId: string;
  projectId: string;
  originalName: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

export interface FileUploadRequest {
  tenantId: string;
  projectId: string;
  originalName: string;
  content: Buffer;
  mimeType: string;
}

// ── Audit record ──────────────────────────────────────────────────────────────

export interface AuditRecord {
  id: string;
  tenantId: string;
  projectId?: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  timestamp: string;
  ipAddress?: string;
}

// ── Background job types ──────────────────────────────────────────────────────

export type JobType =
  | 'SOURCE_INGESTION'
  | 'OBJECT_INVENTORY'
  | 'DEPENDENCY_ANALYSIS'
  | 'FUNCTIONAL_INTENT'
  | 'CLEAN_CORE_ASSESSMENT'
  | 'MODERNIZATION_PLAN'
  | 'CODE_GENERATION'
  /** Async bulk package import from N-CoreIQ extraction job. */
  | 'NCOREIQ_BULK_IMPORT';

export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  /** Import completed but some objects failed — not a full success. */
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export interface JobRecord {
  id: string;
  tenantId: string;
  projectId: string;
  jobType: JobType;
  status: JobStatus;
  progress?: number;
  resultSummary?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
