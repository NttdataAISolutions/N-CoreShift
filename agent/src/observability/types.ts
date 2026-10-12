/**
 * N-CoreShift — Observability / Telemetry Types
 *
 * Captures non-sensitive operational telemetry only.
 * Customer source code must never appear in telemetry records.
 */

// ─── Event categories ────────────────────────────────────────────────────────

export type TelemetryEventKind =
  | 'ANALYSIS_STARTED'
  | 'ANALYSIS_COMPLETED'
  | 'ANALYSIS_FAILED'
  | 'INGESTION_STARTED'
  | 'INGESTION_COMPLETED'
  | 'INGESTION_FAILED'
  | 'INVENTORY_COMPLETED'
  | 'INTENT_COMPLETED'
  | 'INTENT_FAILED'
  | 'EVIDENCE_RETRIEVED'
  | 'EVIDENCE_RETRIEVAL_FAILED'
  | 'ASSESSMENT_COMPLETED'
  | 'ASSESSMENT_FAILED'
  | 'PLAN_GENERATED'
  | 'PLAN_GENERATION_FAILED'
  | 'CODE_GENERATION_COMPLETED'
  | 'CODE_GENERATION_FAILED'
  | 'CODE_GENERATION_GATE_BLOCKED'
  | 'AI_CALL_STARTED'
  | 'AI_CALL_COMPLETED'
  | 'AI_CALL_FAILED'
  | 'AI_PARSE_FAILED'
  | 'PROVIDER_HEALTH_CHECK'
  | 'PROMPT_INJECTION_DETECTED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT'
  | 'ADMIN_CONFIG_CHANGED'
  | 'SECRET_REDACTION_APPLIED';

// ─── Core event shape ────────────────────────────────────────────────────────

export interface TelemetryEvent {
  eventId: string;
  kind: TelemetryEventKind;
  tenantId: string;
  projectId?: string;
  analysisId?: string;
  objectId?: string;
  timestamp: string; // ISO-8601
  durationMs?: number;
  /** AI provider identifier — no credentials */
  providerName?: string;
  /** Model identifier — no credentials */
  modelId?: string;
  /** Token usage when provider returns it */
  tokensInput?: number;
  tokensOutput?: number;
  /** Object/file counts — no content */
  objectCount?: number;
  objectsRequiringReview?: number;
  failureReason?: string; // sanitized — no source code
  blockedReasons?: string[];
  /** Whether prompt injection pattern was detected */
  injectionDetected?: boolean;
  /** Metadata bag — no source code, no credentials */
  meta?: Record<string, string | number | boolean>;
}

// ─── Analysis duration record ─────────────────────────────────────────────────

export interface AnalysisDurationRecord {
  analysisId: string;
  tenantId: string;
  projectId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  objectsProcessed: number;
  failed: boolean;
  failureReason?: string;
}

// ─── AI call record ───────────────────────────────────────────────────────────

export interface AICallRecord {
  callId: string;
  tenantId: string;
  analysisId?: string;
  providerName: string;
  modelId?: string;
  purpose: string; // e.g. 'functional-intent', 'assessment', 'plan', 'codegen'
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  succeeded: boolean;
  parseFailed: boolean;
  failureReason?: string;
  /** No prompt content, no completion content */
}

// ─── Telemetry store contract ─────────────────────────────────────────────────

export interface TelemetryStore {
  record(event: TelemetryEvent): void;
  getEvents(tenantId: string, kinds?: TelemetryEventKind[]): TelemetryEvent[];
  getAICallRecords(tenantId: string): AICallRecord[];
  getAnalysisDurations(tenantId: string): AnalysisDurationRecord[];
  clear(): void;
}

// ─── Telemetry summary ────────────────────────────────────────────────────────

export interface TelemetrySummary {
  tenantId: string;
  windowStart: string;
  windowEnd: string;
  totalAnalyses: number;
  failedAnalyses: number;
  totalObjects: number;
  objectsRequiringReview: number;
  aiCalls: number;
  aiCallFailures: number;
  parseFailed: number;
  providerHealthChecks: number;
  codeGenerationAttempts: number;
  codeGenerationFailures: number;
  codeGenerationGateBlocks: number;
  planGenerationFailures: number;
  injectionDetectionEvents: number;
  unauthorizedAccessAttempts: number;
}
