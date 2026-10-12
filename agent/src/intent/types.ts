/**
 * N-CoreShift – Phase 6: Functional Intent Analysis Types
 *
 * These types define the structured output of the FunctionalIntentAnalyzer.
 * Critical rule: business requirement must be separated from legacy implementation.
 * All records scoped by tenantId + projectId (Principle 18).
 */

import type { TenantScope } from '../types/index.js';

// ── Confidence level for functional intent ────────────────────────────────────

export type IntentConfidence =
  | 'HIGH' // Strong evidence, clear business purpose
  | 'MEDIUM' // Reasonable evidence, some assumptions
  | 'LOW' // Limited evidence, significant uncertainty
  | 'INSUFFICIENT'; // Cannot determine intent reliably

// ── Functional intent review status ──────────────────────────────────────────

export type IntentReviewStatus =
  | 'PENDING_ANALYSIS' // Not yet analyzed
  | 'ANALYSIS_COMPLETE' // AI analysis done, awaiting consultant review
  | 'PARSE_FAILED' // AI returned unparseable / invalid structured output
  | 'UNDER_REVIEW' // Consultant is reviewing
  | 'APPROVED' // Consultant approved the interpretation
  | 'REJECTED' // Consultant rejected - requires re-analysis
  | 'OVERRIDDEN' // Consultant replaced AI interpretation with their own
  | 'CONSULTANT_OVERRIDDEN'; // Alias for OVERRIDDEN (convenience)

// ── Technical pattern detected ────────────────────────────────────────────────

export type TechnicalPattern =
  | 'REPORT' // Standalone ABAP report / program
  | 'INTERACTIVE_REPORT' // Report with user interaction
  | 'BATCH_JOB' // Background processing
  | 'FORM_OUTPUT' // Output form / smartform / Adobe form
  | 'ENHANCEMENT' // Enhancement spot / BAdI implementation
  | 'USER_EXIT' // Classic user exit / customer exit
  | 'INTERFACE_WRAPPER' // Wraps standard interface / API
  | 'DATA_MIGRATION' // Mass data processing
  | 'WORKFLOW_EXTENSION' // Workflow / approval extension
  | 'INTEGRATION_ADAPTER' // RFC / web service / IDoc adapter
  | 'CUSTOM_TABLE_MAINTENANCE' // View maintenance / Z-table logic
  | 'CLASS_LIBRARY' // Reusable class / utility
  | 'CDS_EXTENSION' // CDS view / extension
  | 'CONFIGURATION_DRIVER' // Reads configuration to drive behaviour
  | 'UNKNOWN'; // Cannot determine

// ── Structured output from LLM – validated before accepting ──────────────────

/**
 * Raw LLM output shape. This must be validated before accepting.
 * Treat as untrusted structured data.
 */
export interface RawFunctionalIntentOutput {
  functionalSummary?: unknown;
  businessProcess?: unknown;
  moduleCandidates?: unknown;
  businessObjective?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  businessRules?: unknown;
  SAPObjectsUsed?: unknown;
  integrations?: unknown;
  userInteraction?: unknown;
  technicalPattern?: unknown;
  uncertainties?: unknown;
  clarifyingQuestions?: unknown;
  confidence?: unknown;
}

// ── Validated functional intent result ───────────────────────────────────────

export interface FunctionalIntentResult {
  /** One-sentence description of the business purpose */
  functionalSummary: string;

  /** The SAP business process this belongs to, e.g. "Order-to-Cash" */
  businessProcess: string;

  /** Candidate SAP module areas, e.g. ["SD", "FI"] */
  moduleCandidates: string[];

  /**
   * The underlying business objective – separated from legacy implementation.
   * Example: "Validate sales order pricing before release"
   * NOT: "Update table VBAP directly"
   */
  businessObjective: string;

  /** Inputs this object consumes */
  inputs: string[];

  /** Outputs this object produces */
  outputs: string[];

  /** Business rules applied or enforced */
  businessRules: string[];

  /** Named SAP objects referenced */
  SAPObjectsUsed: string[];

  /** External system integrations detected */
  integrations: string[];

  /** How users interact: UI / background / RFC / API / none */
  userInteraction: string;

  /** Detected technical implementation pattern */
  technicalPattern: TechnicalPattern;

  /** Things that could not be determined from the available source */
  uncertainties: string[];

  /** Questions a consultant should ask to resolve uncertainties */
  clarifyingQuestions: string[];

  /** AI confidence in this interpretation */
  confidence: IntentConfidence;
}

// ── Analysis context sent to the LLM ─────────────────────────────────────────

export interface IntentAnalysisContext {
  /** Object name */
  objectName: string;
  /** Object type label */
  objectType: string;
  /** Selected source code chunks (NOT the full file blindly) */
  sourceChunks: string[];
  /** Dependency edges summary */
  dependencySummary: string;
  /** Risk signals summary */
  riskSignalSummary: string;
  /** Target deployment model label */
  targetDeploymentModel: string;
  /** Source deployment model label */
  sourceDeploymentModel: string;
  /** Transformation scenario label */
  transformationScenario: string;
  /** Optional additional documentation text */
  documentationExcerpt?: string;
}

// ── Per-object functional intent record ──────────────────────────────────────

export interface FunctionalIntentRecord extends TenantScope {
  id: string;
  analysisId: string;
  objectName: string;
  objectType: string;

  /** Current review status */
  reviewStatus: IntentReviewStatus;

  /** AI-generated interpretation (may be null if analysis failed) */
  aiInterpretation: FunctionalIntentResult | null;

  /** Consultant override (replaces AI when set and status is OVERRIDDEN) */
  consultantOverride: Partial<FunctionalIntentResult> | null;

  /**
   * The effective interpretation to use for downstream assessment.
   * Equals consultantOverride when status is OVERRIDDEN or APPROVED with edits,
   * otherwise aiInterpretation.
   */
  effectiveInterpretation: FunctionalIntentResult | null;

  /** Consultant who reviewed/approved/overrode */
  reviewedBy?: string;
  reviewedAt?: string;

  /** Consultant who applied a direct override (populated by applyConsultantOverride) */
  consultantOverriddenBy?: string;

  /** Consultant notes */
  consultantNotes?: string;

  /** Provider used for AI analysis */
  analyzedByProvider?: string;
  analyzedByModel?: string;
  analyzedAt?: string;

  /** Error message if analysis failed */
  analysisError?: string;

  /** Version counter for history tracking */
  version: number;

  createdAt: string;
  updatedAt: string;
}

// ── Version history entry ─────────────────────────────────────────────────────

export interface FunctionalIntentVersion {
  id: string;
  intentRecordId: string;
  tenantId: string;
  projectId: string;
  version: number;
  reviewStatus: IntentReviewStatus;
  aiInterpretation: FunctionalIntentResult | null;
  consultantOverride: Partial<FunctionalIntentResult> | null;
  changedBy: string;
  changeReason: string;
  changedAt: string;
}

// ── Validation errors ─────────────────────────────────────────────────────────

export interface IntentValidationError {
  field: string;
  message: string;
}

export interface IntentParseResult {
  success: boolean;
  result?: FunctionalIntentResult;
  errors: IntentValidationError[];
  rawContent?: string;
}

// ── Consultant action types ───────────────────────────────────────────────────

export type ConsultantIntentAction =
  | 'APPROVE' // Accept AI interpretation as-is
  | 'OVERRIDE' // Replace with consultant's own interpretation
  | 'REJECT'; // Reject – triggers re-analysis

export interface ConsultantIntentDecision {
  action: ConsultantIntentAction;
  consultantId: string;
  notes?: string;
  /** Required when action is OVERRIDE */
  override?: Partial<FunctionalIntentResult>;
}

// ── Service request/response ──────────────────────────────────────────────────

export interface AnalyzeIntentRequest {
  tenantId: string;
  projectId: string;
  analysisId: string;
  objectName: string;
  objectType: string;
  context: IntentAnalysisContext;
  /** Model override – provider resolves default when absent */
  model?: string;
}

export interface AnalyzeIntentResponse {
  record: FunctionalIntentRecord;
  parseResult: IntentParseResult;
}
