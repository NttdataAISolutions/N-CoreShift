/**
 * N-CoreShift – Phase 8: Modernization Planning Types
 *
 * A ModernizationPlan is generated from an approved ObjectAssessment.
 * Only APPROVED plans may proceed to code generation (Phase 9).
 * Plans must be revalidated when target landscape or Clean Core policy changes.
 * All records scoped by tenantId + projectId (Principle 18).
 */

import type { TenantScope } from '../types/index.js';
import type { ObjectAssessment, CleanCorePolicyContext } from '../assessment/types.js';
import type { FunctionalIntentResult } from '../intent/types.js';

export type { TenantScope, ObjectAssessment, CleanCorePolicyContext, FunctionalIntentResult };

// ── Plan lifecycle state ───────────────────────────────────────────────────

export const PLAN_STATES = ['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type PlanState = (typeof PLAN_STATES)[number];

// ── Plan step status ────────────────────────────────────────────────────────

export const PLAN_STEP_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'BLOCKED',
  'SKIPPED',
] as const;
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

// ── Responsible roles ──────────────────────────────────────────────────────

export const RESPONSIBLE_ROLES = [
  'FUNCTIONAL_CONSULTANT',
  'ABAP_DEVELOPER',
  'BTP_DEVELOPER',
  'INTEGRATION_CONSULTANT',
  'SECURITY_CONSULTANT',
  'SOLUTION_ARCHITECT',
  'BUSINESS_PROCESS_OWNER',
] as const;

export type ResponsibleRole = (typeof RESPONSIBLE_ROLES)[number];

export const RESPONSIBLE_ROLE_LABELS: Record<ResponsibleRole, string> = {
  FUNCTIONAL_CONSULTANT: 'Functional Consultant',
  ABAP_DEVELOPER: 'ABAP Developer',
  BTP_DEVELOPER: 'BTP Developer',
  INTEGRATION_CONSULTANT: 'Integration Consultant',
  SECURITY_CONSULTANT: 'Security Consultant',
  SOLUTION_ARCHITECT: 'Solution Architect',
  BUSINESS_PROCESS_OWNER: 'Business Process Owner',
};

// ── Plan section keys (18 mandatory sections) ──────────────────────────────

export const PLAN_SECTION_KEYS = [
  'CURRENT_STATE',
  'BUSINESS_REQUIREMENT',
  'TARGET_STATE',
  'PRECONDITIONS',
  'SAP_OBJECTS_TO_VERIFY',
  'FUNCTIONAL_CHANGES',
  'TECHNICAL_CHANGES',
  'DATA_CONSIDERATIONS',
  'INTEGRATION_CONSIDERATIONS',
  'SECURITY_AUTHORIZATION',
  'IMPLEMENTATION_STEPS',
  'UNIT_TESTING',
  'INTEGRATION_TESTING',
  'REGRESSION_TESTING',
  'CUTOVER_ACTIVATION',
  'LEGACY_DECOMMISSIONING',
  'ROLLBACK_CONSIDERATIONS',
  'POST_IMPLEMENTATION_VALIDATION',
] as const;

export type PlanSectionKey = (typeof PLAN_SECTION_KEYS)[number];

export const PLAN_SECTION_TITLES: Record<PlanSectionKey, string> = {
  CURRENT_STATE: '1. Current State',
  BUSINESS_REQUIREMENT: '2. Business Requirement',
  TARGET_STATE: '3. Target State',
  PRECONDITIONS: '4. Preconditions',
  SAP_OBJECTS_TO_VERIFY: '5. SAP Objects / Interfaces to Verify',
  FUNCTIONAL_CHANGES: '6. Functional Changes',
  TECHNICAL_CHANGES: '7. Technical Changes',
  DATA_CONSIDERATIONS: '8. Data Considerations',
  INTEGRATION_CONSIDERATIONS: '9. Integration Considerations',
  SECURITY_AUTHORIZATION: '10. Security and Authorization Considerations',
  IMPLEMENTATION_STEPS: '11. Implementation Steps',
  UNIT_TESTING: '12. Unit Testing',
  INTEGRATION_TESTING: '13. Integration Testing',
  REGRESSION_TESTING: '14. Regression Testing',
  CUTOVER_ACTIVATION: '15. Cutover and Activation',
  LEGACY_DECOMMISSIONING: '16. Legacy Object Decommissioning',
  ROLLBACK_CONSIDERATIONS: '17. Rollback Considerations',
  POST_IMPLEMENTATION_VALIDATION: '18. Post-Implementation Validation',
};

// ── Plan step ─────────────────────────────────────────────────────────────

/**
 * A single step within the Implementation Steps section.
 * Each step must name the responsible role and include verifiable criteria.
 */
export interface PlanStep {
  sequence: number;
  title: string;
  description: string;
  responsibleRole: ResponsibleRole;
  prerequisites: string[];
  verification: string;
  status: PlanStepStatus;
}

// ── Plan section ──────────────────────────────────────────────────────────

export interface PlanSection {
  key: PlanSectionKey;
  title: string;
  /** Narrative content for non-step sections */
  content: string;
  /**
   * Ordered implementation steps — only populated for IMPLEMENTATION_STEPS section.
   * Other sections carry their details in `content`.
   */
  steps?: PlanStep[];
}

// ── Raw LLM output (unvalidated) ──────────────────────────────────────────

/**
 * Shape expected from the LLM. Treated as untrusted — must be validated
 * before persisting or returning to callers.
 */
export interface RawPlanOutput {
  sections?: unknown;
  summary?: unknown;
  estimatedComplexity?: unknown;
  keyRisks?: unknown;
  assumptions?: unknown;
}

// ── Parse/validation result ────────────────────────────────────────────────

export interface PlanValidationError {
  field: string;
  message: string;
}

export interface PlanParseResult {
  success: boolean;
  sections?: PlanSection[];
  summary?: string;
  estimatedComplexity?: string;
  keyRisks?: string[];
  assumptions?: string[];
  errors: PlanValidationError[];
  rawContent?: string;
}

// ── Planning request ──────────────────────────────────────────────────────

export interface PlanningRequest {
  tenantId: string;
  projectId: string;
  analysisId: string;
  objectId: string;
  objectName: string;
  objectType: string;
  assessmentId: string;
  /** Must be an approved ObjectAssessment */
  assessment: ObjectAssessment;
  functionalIntent: FunctionalIntentResult;
  targetEdition: string;
  targetRelease: string;
  transformationScenario: string;
  cleanCorePolicy: CleanCorePolicyContext;
  /** Optional model override */
  model?: string;
}

// ── Persisted modernization plan ──────────────────────────────────────────

export interface ModernizationPlan extends TenantScope {
  id: string;
  analysisId: string;
  objectId: string;
  objectName: string;
  objectType: string;
  assessmentId: string;

  state: PlanState;

  sections: PlanSection[];

  /** High-level executive summary */
  summary: string;
  /** Estimated complexity: LOW | MEDIUM | HIGH | VERY_HIGH */
  estimatedComplexity: string;
  /** Top-level risks identified in the plan */
  keyRisks: string[];
  /** Assumptions made during planning */
  assumptions: string[];

  /** AI provider used for generation */
  generatedByProvider?: string;
  /** AI model used for generation */
  generatedByModel?: string;
  generatedAt?: string;

  /** If plan generation parse failed */
  planError?: string;

  /** Governance workflow */
  submittedForReviewAt?: string;
  submittedForReviewBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;

  /**
   * If true, plan must be revalidated before code generation proceeds.
   * Set when target landscape or Clean Core policy changes after plan approval.
   */
  requiresRevalidation: boolean;
  revalidationReason?: string;

  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Planning response ─────────────────────────────────────────────────────

export interface PlanningResponse {
  plan: ModernizationPlan;
  parseResult: PlanParseResult;
}

// ── Consultant review action ──────────────────────────────────────────────

export type PlanReviewAction = 'SUBMIT_FOR_REVIEW' | 'APPROVE' | 'REJECT';

export interface PlanReviewDecision {
  action: PlanReviewAction;
  reviewerId: string;
  rationale?: string;
  /** Required when action = 'REJECT' */
  rejectionReason?: string;
}

// ── Plan invalidation record ──────────────────────────────────────────────

export interface PlanInvalidationRecord {
  planId: string;
  reason: string;
  triggeredBy: string;
  invalidatedAt: string;
}

// ── Plan history entry ─────────────────────────────────────────────────────

export interface PlanHistoryEntry {
  planId: string;
  version: number;
  state: PlanState;
  changedBy: string;
  changedAt: string;
  changeNote: string;
  snapshotSummary: string;
}
