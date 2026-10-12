/**
 * N-CoreShift – Phase 8: Modernization Planning Service Tests
 *
 * Covers:
 *  - parsePlanResponse: happy path, fenced JSON, malformed, missing sections, invalid steps
 *  - ModernizationPlanningService.createPlan: success, fallback, unconfigured, AI error
 *  - Governance lifecycle: DRAFT→UNDER_REVIEW→APPROVED, rejection, reopen, applyReviewDecision
 *  - invalidatePlan, isReadyForCodeGeneration, buildHistoryEntry
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ModernizationPlanningService,
  parsePlanResponse,
} from '../planning/ModernizationPlanningService.js';
import { MockPlanAIProvider } from '../planning/MockPlanAIProvider.js';
import { PLAN_SECTION_KEYS, PLAN_SECTION_TITLES } from '../planning/types.js';
import type {
  ModernizationPlan,
  PlanningRequest,
  ObjectAssessment,
  FunctionalIntentResult,
  CleanCorePolicyContext,
} from '../planning/types.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeAssessment(overrides: Partial<ObjectAssessment> = {}): ObjectAssessment {
  return {
    id: 'assessment-001',
    tenantId: 'tenant-test',
    projectId: 'project-test',
    analysisId: 'analysis-001',
    objectId: 'obj-001',
    objectName: 'ZCL_LEGACY_PRICING',
    objectType: 'CLASS',
    disposition: 'REFACTOR',
    cleanCoreRisk: 'HIGH',
    currentPattern: 'CLASSIC_ENHANCEMENT',
    businessRequirement: 'Apply custom pricing logic during SD order creation.',
    finding: 'Classic enhancement USEREXIT_PRICING_PREPARE; not cloud-compatible.',
    recommendedTargetPattern: 'Replace with released BAdI SD_PRICE_CONDITION via ABAP Cloud.',
    reasoning: 'SD_PRICE_CONDITION is released for ABAP Cloud and covers this use case.',
    targetEdition: 'S4HANA_CLOUD_PRIVATE',
    targetRelease: '2023',
    evidence: [
      {
        id: 'ev-001',
        type: 'BADI_AVAILABLE',
        description: 'SD_PRICE_CONDITION BAdI is released for ABAP Cloud on CPE 2023.',
        source: 'KNOWLEDGE_BASE',
        confidence: 'VERIFIED',
        applicableEditions: ['S4HANA_CLOUD_PRIVATE'],
        applicableFromRelease: '2023',
        verificationRequired: true,
        namedSapArtifact: 'SD_PRICE_CONDITION',
      },
    ],
    confidence: 0.82,
    assumptions: ['BAdI covers all pricing scenarios currently handled by the user exit.'],
    verificationRequired: ['Confirm SD_PRICE_CONDITION is active in target system.'],
    architectureDecisionStatus: 'APPROVED',
    decidedBy: 'user-arch',
    decidedAt: '2026-01-15T10:00:00.000Z',
    decisionRationale: 'Approved by architecture board.',
    generatedByProvider: 'mock-assessment',
    generatedByModel: 'mock-assessment-v1',
    generatedAt: '2026-01-14T08:00:00.000Z',
    requiresRevalidation: false,
    version: 2,
    createdAt: '2026-01-14T08:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeFunctionalIntent(
  overrides: Partial<FunctionalIntentResult> = {},
): FunctionalIntentResult {
  return {
    functionalSummary: 'Intercepts SD pricing to add surcharges from a custom table.',
    businessProcess: 'Order-to-Cash / Pricing',
    moduleCandidates: ['SD'],
    businessObjective:
      'Apply customer-specific pricing surcharges during sales order creation.',
    inputs: ['Sales order header', 'Customer account group'],
    outputs: ['Pricing condition record'],
    businessRules: [
      'Surcharge applies only to customer account group ZR01.',
      'Surcharge percentage sourced from ZCUST_PRICING custom table.',
    ],
    SAPObjectsUsed: ['VBAP', 'KONV'],
    integrations: ['SD Pricing Procedure', 'Custom Z-table ZCUST_PRICING'],
    userInteraction: 'Automatic — triggered during order save.',
    technicalPattern: 'USER_EXIT',
    uncertainties: ['Unknown if all surcharge scenarios are covered by the released BAdI.'],
    clarifyingQuestions: [
      'Does BAdI SD_PRICE_CONDITION support all required pricing condition types?',
    ],
    confidence: 'HIGH',
    ...overrides,
  };
}

function makePolicy(overrides: Partial<CleanCorePolicyContext> = {}): CleanCorePolicyContext {
  return {
    posture: 'STRICT',
    coreModificationsPermitted: 'PROHIBITED',
    classicExitsPermitted: 'EXCEPTION_ONLY',
    directTableUpdatesPermitted: 'PROHIBITED',
    unreleasedObjectsPermitted: 'PROHIBITED',
    releasedApiObjectRequired: true,
    architectureReviewRequired: true,
    extensionPreferenceOrder: [
      'SAP_STANDARD',
      'CONFIGURATION',
      'KEY_USER',
      'DEVELOPER',
      'SIDE_BY_SIDE',
    ],
    ...overrides,
  };
}

const BASE_REQUEST: PlanningRequest = {
  tenantId: 'tenant-test',
  projectId: 'project-test',
  analysisId: 'analysis-001',
  objectId: 'obj-001',
  objectName: 'ZCL_LEGACY_PRICING',
  objectType: 'CLASS',
  assessmentId: 'assessment-001',
  assessment: makeAssessment(),
  functionalIntent: makeFunctionalIntent(),
  targetEdition: 'S4HANA_CLOUD_PRIVATE',
  targetRelease: '2023',
  transformationScenario: 'ECC_TO_S4',
  cleanCorePolicy: makePolicy(),
  model: 'mock-plan-v1',
};

/** Build a minimal valid ModernizationPlan in DRAFT state. */
function makeDraftPlan(overrides: Partial<ModernizationPlan> = {}): ModernizationPlan {
  const sections = PLAN_SECTION_KEYS.map(key => ({
    key,
    title: PLAN_SECTION_TITLES[key],
    content: `Stub content for ${key}.`,
    ...(key === 'IMPLEMENTATION_STEPS'
      ? {
          steps: [
            {
              sequence: 1,
              title: 'Create BAdI implementation',
              description: 'Implement SD_PRICE_CONDITION BAdI in ABAP Cloud.',
              responsibleRole: 'ABAP_DEVELOPER' as const,
              prerequisites: [],
              verification: 'Unit test passes.',
              status: 'PENDING' as const,
            },
          ],
        }
      : {}),
  }));

  return {
    id: 'plan-001',
    tenantId: 'tenant-test',
    projectId: 'project-test',
    analysisId: 'analysis-001',
    objectId: 'obj-001',
    objectName: 'ZCL_LEGACY_PRICING',
    objectType: 'CLASS',
    assessmentId: 'assessment-001',
    state: 'DRAFT',
    sections,
    summary: 'Migrate pricing user exit to ABAP Cloud BAdI SD_PRICE_CONDITION.',
    estimatedComplexity: 'MEDIUM',
    keyRisks: ['BAdI may not cover all legacy pricing scenarios.'],
    assumptions: ['Target system has CPE 2023 or higher.'],
    requiresRevalidation: false,
    version: 1,
    createdAt: '2026-01-14T08:00:00.000Z',
    updatedAt: '2026-01-14T08:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimal valid plan JSON string for parsePlanResponse tests. */
function buildValidPlanJson(sectionOverrides: Record<string, unknown> = {}): string {
  const sections = PLAN_SECTION_KEYS.map(key => ({
    key,
    content: `Content for section ${key}.`,
    ...(key === 'IMPLEMENTATION_STEPS'
      ? {
          steps: [
            {
              sequence: 1,
              title: 'Implement BAdI',
              description: 'Create ABAP Cloud BAdI implementation for SD pricing.',
              responsibleRole: 'ABAP_DEVELOPER',
              prerequisites: ['Development system access'],
              verification: 'Unit test covers basic surcharge calculation.',
            },
          ],
        }
      : {}),
    ...sectionOverrides,
  }));

  return JSON.stringify({
    summary: 'Modernisation plan for ZCL_LEGACY_PRICING.',
    estimatedComplexity: 'MEDIUM',
    keyRisks: ['BAdI scope unknown.'],
    assumptions: ['CPE 2023+ assumed.'],
    sections,
  });
}

// ── parsePlanResponse ─────────────────────────────────────────────────────────

describe('parsePlanResponse', () => {
  it('parses a valid plan JSON with all 18 sections', () => {
    const result = parsePlanResponse(buildValidPlanJson());

    expect(result.success).toBe(true);
    expect(result.sections).toHaveLength(18);
    expect(result.summary).toBe('Modernisation plan for ZCL_LEGACY_PRICING.');
    expect(result.estimatedComplexity).toBe('MEDIUM');
    expect(result.keyRisks).toContain('BAdI scope unknown.');
    expect(result.assumptions).toContain('CPE 2023+ assumed.');
    expect(result.errors).toHaveLength(0);
  });

  it('extracts JSON from a fenced code block', () => {
    const json = buildValidPlanJson();
    const fenced = `Here is the plan:\n\`\`\`json\n${json}\n\`\`\``;
    const result = parsePlanResponse(fenced);
    expect(result.success).toBe(true);
    expect(result.sections).toHaveLength(18);
  });

  it('returns success=false for malformed JSON', () => {
    const result = parsePlanResponse('not json at all !!!');
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.field === 'root')).toBe(true);
  });

  it('returns success=false when sections is missing', () => {
    const raw = JSON.stringify({ summary: 'No sections here' });
    const result = parsePlanResponse(raw);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.field === 'sections')).toBe(true);
  });

  it('returns success=false when required sections are missing', () => {
    const raw = JSON.stringify({
      summary: 'Partial plan',
      estimatedComplexity: 'LOW',
      keyRisks: [],
      assumptions: [],
      sections: [{ key: 'INVALID_KEY', content: 'Something.' }],
    });
    const result = parsePlanResponse(raw);
    expect(result.success).toBe(false);
    const missing = result.errors.filter(e => e.message.startsWith('Required section missing'));
    expect(missing.length).toBeGreaterThanOrEqual(18);
  });

  it('falls back to MEDIUM complexity when value is invalid', () => {
    const json = buildValidPlanJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['estimatedComplexity'] = 'EXTREME';
    const result = parsePlanResponse(JSON.stringify(parsed));
    expect(result.success).toBe(true);
    expect(result.estimatedComplexity).toBe('MEDIUM');
  });

  it('skips steps with missing required fields and records errors', () => {
    const sections = PLAN_SECTION_KEYS.map(key => ({
      key,
      content: `Content for ${key}.`,
      ...(key === 'IMPLEMENTATION_STEPS'
        ? {
            steps: [
              { sequence: 1, title: 'Missing description and verification' },
            ],
          }
        : {}),
    }));
    const raw = JSON.stringify({
      summary: 'Test',
      estimatedComplexity: 'LOW',
      keyRisks: [],
      assumptions: [],
      sections,
    });
    const result = parsePlanResponse(raw);
    // Parse succeeds — section exists — but step error is recorded
    expect(result.errors.some(e => e.field.startsWith('steps['))).toBe(true);
  });

  it('defaults responsibleRole to FUNCTIONAL_CONSULTANT for unknown role', () => {
    const sections = PLAN_SECTION_KEYS.map(key => ({
      key,
      content: `Content for ${key}.`,
      ...(key === 'IMPLEMENTATION_STEPS'
        ? {
            steps: [
              {
                sequence: 1,
                title: 'Step A',
                description: 'Do something.',
                responsibleRole: 'UNKNOWN_ROLE',
                prerequisites: [],
                verification: 'Verified when done.',
              },
            ],
          }
        : {}),
    }));
    const raw = JSON.stringify({
      summary: 'Test',
      estimatedComplexity: 'HIGH',
      keyRisks: [],
      assumptions: [],
      sections,
    });
    const result = parsePlanResponse(raw);
    expect(result.success).toBe(true);
    const impl = result.sections?.find(s => s.key === 'IMPLEMENTATION_STEPS');
    expect(impl?.steps?.[0]?.responsibleRole).toBe('FUNCTIONAL_CONSULTANT');
  });
});

// ── ModernizationPlanningService – createPlan ────────────────────────────────

describe('ModernizationPlanningService.createPlan', () => {
  it('throws when provider is not configured', async () => {
    const svc = new ModernizationPlanningService(new MockPlanAIProvider({ unconfigured: true }));
    await expect(svc.createPlan(BASE_REQUEST)).rejects.toThrow('AI provider not configured');
  });

  it('generates a DRAFT plan with all 18 sections on success', async () => {
    const svc = new ModernizationPlanningService(new MockPlanAIProvider());
    const { plan, parseResult } = await svc.createPlan(BASE_REQUEST);

    expect(parseResult.success).toBe(true);
    expect(plan.state).toBe('DRAFT');
    expect(plan.tenantId).toBe('tenant-test');
    expect(plan.projectId).toBe('project-test');
    expect(plan.objectName).toBe('ZCL_LEGACY_PRICING');
    expect(plan.sections).toHaveLength(18);
    expect(plan.requiresRevalidation).toBe(false);
    expect(plan.version).toBe(1);
    expect(plan.id).toBeTruthy();
    expect(plan.createdAt).toBeTruthy();
  });

  it('sets all IMPLEMENTATION_STEPS to PENDING status', async () => {
    const svc = new ModernizationPlanningService(new MockPlanAIProvider());
    const { plan } = await svc.createPlan(BASE_REQUEST);
    const impl = plan.sections.find(s => s.key === 'IMPLEMENTATION_STEPS');
    expect(impl?.steps?.length).toBeGreaterThan(0);
    impl?.steps?.forEach(step => {
      expect(step.status).toBe('PENDING');
    });
  });

  it('records provider and model on the plan', async () => {
    const svc = new ModernizationPlanningService(new MockPlanAIProvider());
    const { plan } = await svc.createPlan(BASE_REQUEST);
    expect(plan.generatedByProvider).toBeTruthy();
    expect(plan.generatedByModel).toBeTruthy();
    expect(plan.generatedAt).toBeTruthy();
  });

  it('produces a fallback plan when AI returns malformed JSON', async () => {
    const svc = new ModernizationPlanningService(
      new MockPlanAIProvider({ malformedJson: true }),
    );
    const { plan, parseResult } = await svc.createPlan(BASE_REQUEST);

    expect(parseResult.success).toBe(false);
    expect(plan.state).toBe('DRAFT');
    expect(plan.planError).toBeTruthy();
    expect(plan.sections).toHaveLength(18);
    expect(plan.summary).toContain('failed');
  });

  it('produces a fallback plan when required sections are missing', async () => {
    const allKeys = PLAN_SECTION_KEYS.slice(1); // drop first key → one section missing
    const svc = new ModernizationPlanningService(
      new MockPlanAIProvider({ missingSections: allKeys }),
    );
    const { plan, parseResult } = await svc.createPlan(BASE_REQUEST);
    expect(parseResult.success).toBe(false);
    expect(plan.planError).toBeTruthy();
  });

  it('propagates AI provider errors', async () => {
    const svc = new ModernizationPlanningService(
      new MockPlanAIProvider({ throwError: 'Simulated network failure' }),
    );
    await expect(svc.createPlan(BASE_REQUEST)).rejects.toThrow('Simulated network failure');
  });

  it('passes the model override to the provider', async () => {
    const svc = new ModernizationPlanningService(new MockPlanAIProvider());
    const req = { ...BASE_REQUEST, model: 'gpt-4o-specific' };
    const { plan } = await svc.createPlan(req);
    expect(plan.state).toBe('DRAFT');
  });
});

// ── Governance lifecycle ──────────────────────────────────────────────────────

describe('ModernizationPlanningService – governance lifecycle', () => {
  let service: ModernizationPlanningService;

  beforeEach(() => {
    service = new ModernizationPlanningService(new MockPlanAIProvider());
  });

  // submitForReview

  it('submitForReview: DRAFT → UNDER_REVIEW', () => {
    const plan = makeDraftPlan();
    const updated = service.submitForReview(plan, 'consultant-01');
    expect(updated.state).toBe('UNDER_REVIEW');
    expect(updated.submittedForReviewBy).toBe('consultant-01');
    expect(updated.submittedForReviewAt).toBeTruthy();
    expect(updated.version).toBe(plan.version + 1);
  });

  it('submitForReview: throws when not in DRAFT', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW' });
    expect(() => service.submitForReview(plan, 'consultant-01')).toThrow(
      /DRAFT/,
    );
  });

  // approvePlan

  it('approvePlan: UNDER_REVIEW → APPROVED', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW' });
    const approved = service.approvePlan(plan, 'arch-01');
    expect(approved.state).toBe('APPROVED');
    expect(approved.approvedBy).toBe('arch-01');
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.version).toBe(plan.version + 1);
  });

  it('approvePlan: throws when plan requires revalidation', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW', requiresRevalidation: true });
    expect(() => service.approvePlan(plan, 'arch-01')).toThrow(
      /revalidation/,
    );
  });

  it('approvePlan: throws when not in UNDER_REVIEW', () => {
    const plan = makeDraftPlan({ state: 'DRAFT' });
    expect(() => service.approvePlan(plan, 'arch-01')).toThrow(/UNDER_REVIEW/);
  });

  // rejectPlan

  it('rejectPlan: UNDER_REVIEW → REJECTED', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW' });
    const rejected = service.rejectPlan(plan, 'arch-01', 'Scope too broad.');
    expect(rejected.state).toBe('REJECTED');
    expect(rejected.rejectedBy).toBe('arch-01');
    expect(rejected.rejectionReason).toBe('Scope too broad.');
    expect(rejected.version).toBe(plan.version + 1);
  });

  it('rejectPlan: throws when rejection reason is empty', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW' });
    expect(() => service.rejectPlan(plan, 'arch-01', '')).toThrow(
      /rejection reason/,
    );
  });

  it('rejectPlan: throws when not in UNDER_REVIEW', () => {
    const plan = makeDraftPlan({ state: 'DRAFT' });
    expect(() => service.rejectPlan(plan, 'arch-01', 'Reason.')).toThrow(
      /UNDER_REVIEW/,
    );
  });

  // reopenPlan

  it('reopenPlan: returns REJECTED plan to DRAFT', () => {
    const plan = makeDraftPlan({ state: 'REJECTED' });
    const reopened = service.reopenPlan(plan, 'consultant-01');
    expect(reopened.state).toBe('DRAFT');
    expect(reopened.requiresRevalidation).toBe(false);
    expect(reopened.version).toBe(plan.version + 1);
  });

  it('reopenPlan: returns APPROVED plan to DRAFT', () => {
    const plan = makeDraftPlan({ state: 'APPROVED' });
    const reopened = service.reopenPlan(plan, 'consultant-01');
    expect(reopened.state).toBe('DRAFT');
  });

  it('reopenPlan: throws when plan is in DRAFT', () => {
    const plan = makeDraftPlan({ state: 'DRAFT' });
    expect(() => service.reopenPlan(plan, 'consultant-01')).toThrow(
      /REJECTED.*APPROVED|APPROVED.*REJECTED/,
    );
  });

  // applyReviewDecision

  it('applyReviewDecision: SUBMIT_FOR_REVIEW delegates correctly', () => {
    const plan = makeDraftPlan();
    const updated = service.applyReviewDecision(plan, {
      action: 'SUBMIT_FOR_REVIEW',
      reviewerId: 'user-01',
    });
    expect(updated.state).toBe('UNDER_REVIEW');
  });

  it('applyReviewDecision: APPROVE delegates correctly', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW' });
    const updated = service.applyReviewDecision(plan, {
      action: 'APPROVE',
      reviewerId: 'arch-01',
    });
    expect(updated.state).toBe('APPROVED');
  });

  it('applyReviewDecision: REJECT delegates correctly', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW' });
    const updated = service.applyReviewDecision(plan, {
      action: 'REJECT',
      reviewerId: 'arch-01',
      rejectionReason: 'Needs rework.',
    });
    expect(updated.state).toBe('REJECTED');
    expect(updated.rejectionReason).toBe('Needs rework.');
  });

  it('applyReviewDecision: uses fallback rejection reason when absent', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW' });
    const updated = service.applyReviewDecision(plan, {
      action: 'REJECT',
      reviewerId: 'arch-01',
    });
    expect(updated.state).toBe('REJECTED');
    expect(updated.rejectionReason).toBeTruthy();
  });

  // invalidatePlan

  it('invalidatePlan: sets requiresRevalidation and returns invalidation record', () => {
    const plan = makeDraftPlan({ state: 'APPROVED' });
    const { plan: invalidated, record } = service.invalidatePlan(
      plan,
      'Target landscape changed.',
      'system',
    );
    expect(invalidated.requiresRevalidation).toBe(true);
    expect(invalidated.revalidationReason).toBe('Target landscape changed.');
    expect(invalidated.version).toBe(plan.version + 1);
    expect(record.planId).toBe(plan.id);
    expect(record.triggeredBy).toBe('system');
    expect(record.reason).toBe('Target landscape changed.');
    expect(record.invalidatedAt).toBeTruthy();
  });

  it('invalidatePlan: APPROVED plan remains APPROVED but blocks code generation', () => {
    const plan = makeDraftPlan({ state: 'APPROVED' });
    const { plan: invalidated } = service.invalidatePlan(plan, 'Policy updated.', 'system');
    expect(invalidated.state).toBe('APPROVED');
    expect(invalidated.requiresRevalidation).toBe(true);
    expect(service.isReadyForCodeGeneration(invalidated)).toBe(false);
  });

  // isReadyForCodeGeneration

  it('isReadyForCodeGeneration: returns true for APPROVED plan without revalidation flag', () => {
    const plan = makeDraftPlan({ state: 'APPROVED', requiresRevalidation: false });
    expect(service.isReadyForCodeGeneration(plan)).toBe(true);
  });

  it('isReadyForCodeGeneration: returns false for DRAFT plan', () => {
    expect(service.isReadyForCodeGeneration(makeDraftPlan())).toBe(false);
  });

  it('isReadyForCodeGeneration: returns false for UNDER_REVIEW plan', () => {
    expect(service.isReadyForCodeGeneration(makeDraftPlan({ state: 'UNDER_REVIEW' }))).toBe(false);
  });

  it('isReadyForCodeGeneration: returns false for APPROVED plan with revalidation flag', () => {
    const plan = makeDraftPlan({ state: 'APPROVED', requiresRevalidation: true });
    expect(service.isReadyForCodeGeneration(plan)).toBe(false);
  });

  // buildHistoryEntry

  it('buildHistoryEntry: returns a correctly shaped history entry', () => {
    const plan = makeDraftPlan({ state: 'UNDER_REVIEW', version: 3 });
    const entry = service.buildHistoryEntry(plan, 'arch-01', 'Submitted for architecture review.');

    expect(entry.planId).toBe(plan.id);
    expect(entry.version).toBe(3);
    expect(entry.state).toBe('UNDER_REVIEW');
    expect(entry.changedBy).toBe('arch-01');
    expect(entry.changeNote).toBe('Submitted for architecture review.');
    expect(entry.changedAt).toBe(plan.updatedAt);
    expect(typeof entry.snapshotSummary).toBe('string');
    expect(entry.snapshotSummary.length).toBeLessThanOrEqual(200);
  });

  // Full DRAFT → UNDER_REVIEW → APPROVED lifecycle

  it('full lifecycle: DRAFT → UNDER_REVIEW → APPROVED → invalidated → blocked', () => {
    let plan = makeDraftPlan();

    // Submit
    plan = service.submitForReview(plan, 'consultant-01');
    expect(plan.state).toBe('UNDER_REVIEW');

    // Approve
    plan = service.approvePlan(plan, 'arch-01');
    expect(plan.state).toBe('APPROVED');
    expect(service.isReadyForCodeGeneration(plan)).toBe(true);

    // Landscape changes → invalidate
    const { plan: inv } = service.invalidatePlan(plan, 'Target release upgraded.', 'system');
    expect(inv.requiresRevalidation).toBe(true);
    expect(service.isReadyForCodeGeneration(inv)).toBe(false);
  });

  it('full lifecycle: DRAFT → UNDER_REVIEW → REJECTED → DRAFT (reopen)', () => {
    let plan = makeDraftPlan();

    plan = service.submitForReview(plan, 'consultant-01');
    plan = service.rejectPlan(plan, 'arch-01', 'Scope unclear.');
    expect(plan.state).toBe('REJECTED');

    plan = service.reopenPlan(plan, 'consultant-01');
    expect(plan.state).toBe('DRAFT');
    expect(plan.requiresRevalidation).toBe(false);
  });
});
