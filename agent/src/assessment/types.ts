/**
 * N-CoreShift – Phase 7: Evidence, Fit-to-Standard and Clean Core Assessment Types
 *
 * Every recommendation must be backed by evidence and expose confidence/uncertainty.
 * Evidence must carry edition/release applicability (Principles 5, 8, 9).
 * Never recommend a named SAP artifact without edition/release-scoped evidence (Phase 7 rule).
 * All records scoped by tenantId + projectId (Principle 18).
 */

import type {
  Disposition,
  EvidenceConfidence,
  CleanCoreRisk,
  TenantScope,
} from '../types/index.js';

import type { TargetEdition, TristateValue, PermissionValue, CleanCorePosture } from '../landscape/types.js';
import type { FunctionalIntentResult, IntentConfidence } from '../intent/types.js';
import type { TechnicalRiskSignal } from '../inventory/types.js';

export type {
  Disposition,
  EvidenceConfidence,
  CleanCoreRisk,
  TenantScope,
  TargetEdition,
  TristateValue,
  PermissionValue,
  CleanCorePosture,
  FunctionalIntentResult,
  IntentConfidence,
  TechnicalRiskSignal,
};

// ── Evidence types ─────────────────────────────────────────────────────────

export const EVIDENCE_TYPES = [
  'SAP_KNOWLEDGE_BASE',
  'STANDARD_FUNCTIONALITY_MATCH',
  'CONFIGURATION_OPTION',
  'EXTENSION_POINT_AVAILABLE',
  'RELEASED_API_AVAILABLE',
  'BADI_AVAILABLE',
  'CDS_VIEW_AVAILABLE',
  'BTP_SERVICE_AVAILABLE',
  'USAGE_DATA',
  'CODE_ANALYSIS',
  'DEPENDENCY_FINDING',
  'TECHNICAL_RISK_SIGNAL',
  'CONSULTANT_ASSESSMENT',
  'POLICY_CONSTRAINT',
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

// ── Current technical pattern (the legacy implementation pattern) ──────────

export const CURRENT_TECHNICAL_PATTERNS = [
  'DIRECT_TABLE_MODIFICATION',
  'CLASSIC_ENHANCEMENT',
  'CLASSIC_USER_EXIT',
  'CUSTOM_LOGIC_RELEASED_OBJECTS',
  'CUSTOM_LOGIC_UNRELEASED_OBJECTS',
  'SIDE_BY_SIDE_CANDIDATE',
  'SAP_STANDARD_USAGE',
  'DATA_MIGRATION_SCRIPT',
  'REPORT_OUTPUT',
  'INTERFACE_WRAPPER',
  'FORM_OUTPUT',
  'WORKFLOW_EXTENSION',
  'CONFIGURATION_DRIVER',
  'UNKNOWN',
] as const;

export type CurrentTechnicalPattern = (typeof CURRENT_TECHNICAL_PATTERNS)[number];

// ── Architecture decision status ───────────────────────────────────────────

export const ARCHITECTURE_DECISION_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'REQUIRES_REVALIDATION',
] as const;

export type ArchitectureDecisionStatus = (typeof ARCHITECTURE_DECISION_STATUSES)[number];

// ── Evidence item ──────────────────────────────────────────────────────────

/**
 * A single piece of evidence supporting or informing an assessment.
 *
 * Edition/release applicability is mandatory for any evidence that names a
 * specific SAP artifact, API, BAdI, CDS view, or capability.
 * If applicableEditions is empty, the evidence is considered edition-agnostic.
 */
export interface AssessmentEvidenceItem {
  id: string;
  type: EvidenceType;
  description: string;
  /** Origin of this evidence: 'CODE_ANALYSIS' | 'AI_DERIVED' | 'CONSULTANT' | 'KNOWLEDGE_BASE' */
  source: string;
  confidence: EvidenceConfidence;
  /**
   * Which target editions this evidence applies to.
   * Empty array = not edition-restricted (applies to all).
   * Non-empty = evidence ONLY applies to listed editions.
   */
  applicableEditions: TargetEdition[];
  /**
   * Minimum release string this evidence applies to (e.g. "2023").
   * Empty = no release restriction known.
   */
  applicableFromRelease?: string;
  /**
   * Maximum release this evidence applies up to (exclusive).
   * Empty = no upper bound.
   */
  applicableUntilRelease?: string;
  /**
   * If true, a consultant must verify this evidence before the assessment
   * can move to APPROVED status.
   */
  verificationRequired: boolean;
  /**
   * Named SAP artifact referenced by this evidence (e.g. a specific BAdI name,
   * CDS view name, released API name).
   * When set, edition/release applicability MUST be validated before accepting.
   */
  namedSapArtifact?: string;
  notes?: string;
}

// ── Evidence applicability check result ───────────────────────────────────

export interface EvidenceApplicabilityResult {
  evidenceId: string;
  targetEdition: TargetEdition;
  targetRelease: string;
  isApplicable: boolean;
  reason?: string;
}

// ── Clean Core policy context (minimal subset for assessment engine) ───────

export interface CleanCorePolicyContext {
  posture: CleanCorePosture;
  coreModificationsPermitted: PermissionValue;
  classicExitsPermitted: PermissionValue;
  directTableUpdatesPermitted: PermissionValue;
  unreleasedObjectsPermitted: PermissionValue;
  releasedApiObjectRequired: boolean;
  architectureReviewRequired: boolean;
  /**
   * Ordered list of technique names from most preferred to least preferred.
   * Example: ['SAP_STANDARD', 'CONFIGURATION', 'KEY_USER', 'DEVELOPER', 'SIDE_BY_SIDE', 'CLASSIC_EXCEPTION']
   */
  extensionPreferenceOrder: string[];
}

// ── Target extensibility context ──────────────────────────────────────────

export interface TargetExtensibilityContext {
  keyUserExtensibilityAllowed: TristateValue;
  developerExtensibilityAllowed: TristateValue;
  abapCloudRequired: TristateValue;
  classicAbapAllowed: TristateValue;
  sideBySideBtpAllowed: TristateValue;
  releasedApisRequired: TristateValue;
}

// ── Assessment request ─────────────────────────────────────────────────────

export interface AssessmentRequest {
  tenantId: string;
  projectId: string;
  analysisId: string;
  objectId: string;
  objectName: string;
  objectType: string;

  /**
   * Approved functional intent from Phase 6.
   * Must be the effective interpretation (approved or consultant-overridden).
   */
  functionalIntent: FunctionalIntentResult;
  /** Confidence of the functional intent interpretation */
  intentConfidence: IntentConfidence;

  /** Technical risk signals from Phase 5 inventory */
  technicalRiskSignals: TechnicalRiskSignal[];
  /** Dependency summary text (not raw code – sanitized for prompt use) */
  dependencySummary: string;

  /** Target landscape context (from Landscape Readiness Gate) */
  targetEdition: TargetEdition;
  targetRelease: string;
  sourceErpProduct: string;
  sourceRelease?: string;
  transformationScenario: string;

  cleanCorePolicy: CleanCorePolicyContext;
  targetExtensibility: TargetExtensibilityContext;

  /** Optional pre-loaded evidence items (e.g. from knowledge base retrieval) */
  additionalEvidence?: AssessmentEvidenceItem[];

  /** Model override */
  model?: string;
}

// ── Raw LLM structured output (unvalidated) ────────────────────────────────

/**
 * Raw shape returned by the LLM. Must be validated before accepting.
 * Treat as untrusted structured data.
 */
export interface RawAssessmentOutput {
  disposition?: unknown;
  cleanCoreRisk?: unknown;
  currentPattern?: unknown;
  finding?: unknown;
  recommendedTargetPattern?: unknown;
  reasoning?: unknown;
  evidence?: unknown;
  confidence?: unknown;
  assumptions?: unknown;
  verificationRequired?: unknown;
}

// ── Validated assessment result from LLM ──────────────────────────────────

export interface ValidatedAssessmentResult {
  disposition: Disposition;
  cleanCoreRisk: CleanCoreRisk;
  currentPattern: CurrentTechnicalPattern;
  finding: string;
  recommendedTargetPattern: string;
  reasoning: string;
  evidence: AssessmentEvidenceItem[];
  confidence: number; // 0–1
  assumptions: string[];
  verificationRequired: string[];
}

// ── Parse result ──────────────────────────────────────────────────────────

export interface AssessmentValidationError {
  field: string;
  message: string;
}

export interface AssessmentParseResult {
  success: boolean;
  result?: ValidatedAssessmentResult;
  errors: AssessmentValidationError[];
  rawContent?: string;
}

// ── Object assessment (persisted record) ──────────────────────────────────

export interface ObjectAssessment extends TenantScope {
  id: string;
  analysisId: string;
  objectId: string;
  objectName: string;
  objectType: string;

  /** 4R disposition */
  disposition: Disposition;
  /** Clean Core risk level */
  cleanCoreRisk: CleanCoreRisk;

  /** Legacy implementation pattern detected */
  currentPattern: CurrentTechnicalPattern;
  /** Business requirement (from approved functional intent – not the implementation) */
  businessRequirement: string;
  /** Key finding driving the disposition */
  finding: string;
  /** Recommended target pattern description */
  recommendedTargetPattern: string;
  /** Full reasoning for the recommendation */
  reasoning: string;

  /** Target edition this assessment was made for */
  targetEdition: string;
  /** Target release this assessment was made for */
  targetRelease: string;

  /** Evidence items supporting this assessment */
  evidence: AssessmentEvidenceItem[];
  /** Normalised confidence score 0–1 */
  confidence: number;
  /** Explicit assumptions made during assessment */
  assumptions: string[];
  /** Items that must be verified by a consultant before the plan is approved */
  verificationRequired: string[];

  /** Architecture decision workflow status */
  architectureDecisionStatus: ArchitectureDecisionStatus;
  /** Who made the architecture decision */
  decidedBy?: string;
  /** When the decision was made */
  decidedAt?: string;
  /** Rationale entered by the approver/rejector */
  decisionRationale?: string;

  /** AI provider used */
  generatedByProvider?: string;
  /** AI model used */
  generatedByModel?: string;
  /** When the assessment was generated */
  generatedAt?: string;
  /** If assessment parse failed, the error is stored here */
  assessmentError?: string;

  /** Whether this assessment requires revalidation due to landscape changes */
  requiresRevalidation: boolean;
  /** Reason for revalidation if flagged */
  revalidationReason?: string;

  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Package assessment summary ─────────────────────────────────────────────

export interface PackageAssessmentSummary {
  analysisId: string;
  projectId: string;
  tenantId: string;
  totalObjects: number;
  byDisposition: {
    RETIRE: number;
    REPLACE: number;
    REFACTOR: number;
    REPLATFORM: number;
    REQUIRES_REVIEW: number;
  };
  riskDistribution: {
    LOW: number;
    MEDIUM: number;
    HIGH: number;
    CRITICAL: number;
  };
  unresolvedEvidenceCount: number;
  requiresReviewCount: number;
  objectsWithInsufficientEvidence: number;
  objectsPendingArchitectureDecision: number;
  computedAt: string;
}

// ── Assessment response ────────────────────────────────────────────────────

export interface AssessmentResponse {
  assessment: ObjectAssessment;
  parseResult: AssessmentParseResult;
  /** Evidence items that were flagged as not applicable to the target edition/release */
  inapplicableEvidence: EvidenceApplicabilityResult[];
}

// ── Consultant decision on assessment ─────────────────────────────────────

export type ConsultantAssessmentAction = 'APPROVE' | 'REJECT' | 'OVERRIDE_DISPOSITION';

export interface ConsultantAssessmentDecision {
  action: ConsultantAssessmentAction;
  consultantId: string;
  rationale: string;
  overrideDisposition?: Disposition;
  overrideReasoning?: string;
}
