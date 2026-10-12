/**
 * N-CoreShift - Phase 9: Guided Target Code Generation Types
 *
 * Code generation is only permitted after all 7 mandatory preconditions pass.
 * Every generated artifact must carry the label:
 *   "Generated implementation draft - consultant validation required."
 * No generated code is ever automatically deployed, activated, or executed.
 * All records scoped by tenantId + projectId (Principle 18).
 */

import type { TenantScope } from '../types/index.js';
import type {
  ObjectAssessment,
  CleanCorePolicyContext,
  TargetExtensibilityContext,
} from '../assessment/types.js';
import type { ModernizationPlan } from '../planning/types.js';
import type { FunctionalIntentResult } from '../intent/types.js';

export type {
  TenantScope,
  ObjectAssessment,
  CleanCorePolicyContext,
  TargetExtensibilityContext,
  ModernizationPlan,
  FunctionalIntentResult,
};

// ── Artifact types ─────────────────────────────────────────────────────────

export const ARTIFACT_TYPES = [
  'ABAP',
  'ABAP_CLOUD',
  'RAP_ARTIFACT',
  'CDS_ARTIFACT',
  'ENHANCEMENT_SKELETON',
  'BADI_SKELETON',
  'API_CONSUMPTION',
  'CAP_NODEJS',
  'BTP_APP_SKELETON',
  'INTEGRATION_CLIENT',
  'UNIT_TEST_SKELETON',
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  ABAP: 'ABAP Program',
  ABAP_CLOUD: 'ABAP Cloud (Released Objects Only)',
  RAP_ARTIFACT: 'RAP Business Object / Behavior',
  CDS_ARTIFACT: 'CDS View / Annotation',
  ENHANCEMENT_SKELETON: 'Enhancement Implementation Skeleton',
  BADI_SKELETON: 'BAdI Implementation Skeleton',
  API_CONSUMPTION: 'Released SAP API Consumption Example',
  CAP_NODEJS: 'CAP Node.js / TypeScript Service',
  BTP_APP_SKELETON: 'BTP Side-by-Side Application Skeleton',
  INTEGRATION_CLIENT: 'Integration Client / Adapter Example',
  UNIT_TEST_SKELETON: 'Unit Test Skeleton',
};

// ── Artifact validation status ─────────────────────────────────────────────

export const ARTIFACT_VALIDATION_STATUSES = [
  'PENDING_REVIEW',
  'ACCEPTED',
  'REJECTED',
  'REGENERATED',
  'SUPERSEDED',
] as const;

export type ArtifactValidationStatus = (typeof ARTIFACT_VALIDATION_STATUSES)[number];

// ── Consultant artifact action ─────────────────────────────────────────────

export const CONSULTANT_ARTIFACT_ACTIONS = [
  'ACCEPT',
  'EDIT',
  'REGENERATE',
  'REJECT',
] as const;

export type ConsultantArtifactAction = (typeof CONSULTANT_ARTIFACT_ACTIONS)[number];

// ── Artifact section keys (9 mandatory presentation sections) ─────────────

export const ARTIFACT_SECTION_KEYS = [
  'PURPOSE',
  'PRECONDITIONS',
  'GENERATED_CODE',
  'CONFIGURATION_REQUIRED',
  'DEPENDENCIES',
  'WHERE_IT_BELONGS',
  'HOW_TO_VALIDATE',
  'ASSUMPTIONS',
  'ITEMS_REQUIRING_VERIFICATION',
] as const;

export type ArtifactSectionKey = (typeof ARTIFACT_SECTION_KEYS)[number];

export const ARTIFACT_SECTION_TITLES: Record<ArtifactSectionKey, string> = {
  PURPOSE: 'Purpose',
  PRECONDITIONS: 'Preconditions',
  GENERATED_CODE: 'Generated Code',
  CONFIGURATION_REQUIRED: 'Configuration Required',
  DEPENDENCIES: 'Dependencies',
  WHERE_IT_BELONGS: 'Where It Belongs',
  HOW_TO_VALIDATE: 'How to Validate',
  ASSUMPTIONS: 'Assumptions',
  ITEMS_REQUIRING_VERIFICATION: 'Items Requiring Verification',
};

// ── Code generation gate result ────────────────────────────────────────────

/**
 * Result of checking all 7 mandatory preconditions.
 * All must pass before artifact generation is permitted.
 */
export interface CodeGenerationGateResult {
  allowed: boolean;
  blockedReasons: string[];
  /** 1. Landscape Readiness is APPROVED_FOR_CODE_GENERATION */
  landscapeApprovedForCodeGeneration: boolean;
  /** 2. Target edition is present */
  targetEditionPresent: boolean;
  /** 3. Target release is present */
  targetReleasePresent: boolean;
  /** 4. Clean Core policy is present (posture is set) */
  cleanCorePolicyPresent: boolean;
  /** 5. Modernization recommendation is approved (architectureDecisionStatus = APPROVED) */
  recommendationApproved: boolean;
  /** 6. Modernization plan is APPROVED and requiresRevalidation = false */
  planApproved: boolean;
  /** 7. Technical pattern is sufficiently verified (no unresolved evidence requiring verification) */
  technicalPatternVerified: boolean;
}

// ── Raw LLM output (unvalidated) ──────────────────────────────────────────

/**
 * Expected shape from the LLM. Treated as untrusted - validated before use.
 */
export interface RawArtifactOutput {
  purpose?: unknown;
  preconditions?: unknown;
  generatedCode?: unknown;
  configurationRequired?: unknown;
  dependencies?: unknown;
  whereItBelongs?: unknown;
  howToValidate?: unknown;
  assumptions?: unknown;
  itemsRequiringVerification?: unknown;
  language?: unknown;
  targetPlatform?: unknown;
}

// ── Parse / validation ─────────────────────────────────────────────────────

export interface ArtifactValidationError {
  field: string;
  message: string;
}

export interface ArtifactParseResult {
  success: boolean;
  sections?: Record<ArtifactSectionKey, string>;
  language?: string;
  targetPlatform?: string;
  errors: ArtifactValidationError[];
  rawContent?: string;
}

// ── Generated artifact (persisted record) ─────────────────────────────────

/**
 * Every generated artifact carries a mandatory label (Principle 12):
 * "Generated implementation draft - consultant validation required."
 */
export interface GeneratedArtifact extends TenantScope {
  id: string;
  analysisId: string;
  objectId: string;
  objectName: string;
  objectType: string;
  sourceAssessmentId: string;
  sourcePlanId: string;

  artifactType: ArtifactType;
  /** Programming language of the generated code */
  language: string;
  /** Target runtime platform (e.g. S4HANA_ON_PREMISE, S4HANA_PUBLIC_CLOUD, BTP_CF) */
  targetPlatform: string;
  /** Target ERP edition */
  targetEdition: string;
  /** Target ERP release */
  targetRelease: string;

  /** IDs of evidence items cited during generation */
  evidenceReferences: string[];

  /** AI provider used */
  generatedByProvider: string;
  /** AI model used */
  generatedByModel: string;
  generatedAt: string;
  /** Prompt template version - for auditability when prompts change */
  generationPromptVersion: string;

  validationStatus: ArtifactValidationStatus;

  /**
   * Mandatory label - always set to:
   * "Generated implementation draft - consultant validation required."
   */
  label: string;

  /** The 9 presentation sections, each key maps to rendered text */
  sections: Record<ArtifactSectionKey, string>;

  /** Notes entered by the reviewing consultant */
  consultantNotes?: string;

  acceptedBy?: string;
  acceptedAt?: string;

  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;

  /** If artifact parse/generation failed, error stored here */
  artifactError?: string;

  /** Version - incremented on each regeneration */
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Code generation request ────────────────────────────────────────────────

export interface CodeGenerationRequest {
  tenantId: string;
  projectId: string;
  analysisId: string;
  objectId: string;
  objectName: string;
  objectType: string;
  assessmentId: string;
  planId: string;

  /** Approved ObjectAssessment from Phase 7 */
  assessment: ObjectAssessment;
  /** Approved ModernizationPlan from Phase 8 */
  plan: ModernizationPlan;
  /** Functional intent from Phase 6 */
  functionalIntent: FunctionalIntentResult;

  targetEdition: string;
  targetRelease: string;
  transformationScenario: string;

  cleanCorePolicy: CleanCorePolicyContext;
  targetExtensibility: TargetExtensibilityContext;

  /**
   * Current landscape readiness state - must be 'APPROVED_FOR_CODE_GENERATION'.
   */
  landscapeReadinessState: string;

  /** The artifact type to generate */
  artifactType: ArtifactType;

  /** Optional model override */
  model?: string;
}

// ── Code generation response ───────────────────────────────────────────────

export interface CodeGenerationResponse {
  artifact: GeneratedArtifact;
  parseResult: ArtifactParseResult;
  gateResult: CodeGenerationGateResult;
}

// ── Consultant decision on artifact ───────────────────────────────────────

export interface ConsultantArtifactDecision {
  action: ConsultantArtifactAction;
  consultantId: string;
  notes?: string;
  /** Required when action = REJECT */
  rejectionReason?: string;
  /** For EDIT: partial override of sections */
  editedSections?: Partial<Record<ArtifactSectionKey, string>>;
}

// ── Artifact history entry ─────────────────────────────────────────────────

export interface ArtifactHistoryEntry {
  artifactId: string;
  version: number;
  validationStatus: ArtifactValidationStatus;
  changedBy: string;
  changedAt: string;
  changeNote: string;
  artifactType: ArtifactType;
}
