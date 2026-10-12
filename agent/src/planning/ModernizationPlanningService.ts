/**
 * N-CoreShift – Phase 8: Modernization Planning Service
 *
 * Generates structured 18-section modernization plans from approved assessments.
 * Enforces governance lifecycle: DRAFT → UNDER_REVIEW → APPROVED | REJECTED.
 * Only APPROVED plans (with requiresRevalidation=false) gate progress to Phase 9.
 *
 * All operations scoped by tenantId + projectId (Principle 18).
 * Provider calls are never made directly — only through the AIProvider interface (Principle 13).
 */

import { randomUUID } from 'crypto';
import type { AIProvider } from '../providers/AIProvider.js';
import { buildPlanPrompt } from './ModernizationPlanPromptBuilder.js';
import {
  PLAN_SECTION_KEYS,
  PLAN_SECTION_TITLES,
  RESPONSIBLE_ROLES,
  type ModernizationPlan,
  type PlanSection,
  type PlanStep,
  type PlanSectionKey,
  type PlanState,
  type PlanParseResult,
  type PlanValidationError,
  type PlanningRequest,
  type PlanningResponse,
  type PlanReviewDecision,
  type PlanInvalidationRecord,
  type PlanHistoryEntry,
  type RawPlanOutput,
} from './types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_ROLES = new Set<string>(RESPONSIBLE_ROLES);
const VALID_SECTION_KEYS = new Set<string>(PLAN_SECTION_KEYS);
const VALID_COMPLEXITY = new Set(['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']);
const MAX_STR = 4000;
const MAX_STEPS = 30;
const MAX_ARR = 40;

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractJson(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a !== -1 && b > a) return raw.slice(a, b + 1);
  return raw.trim();
}

function safeStr(v: unknown, max = MAX_STR): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  return v.trim().slice(0, max);
}

function safeStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .slice(0, MAX_ARR)
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map(x => (x as string).trim().slice(0, MAX_STR));
}

function parseStep(
  raw: unknown,
  idx: number,
  errs: PlanValidationError[],
): PlanStep | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;

  const sequence = typeof s['sequence'] === 'number' ? s['sequence'] : idx + 1;
  const title = safeStr(s['title']);
  const description = safeStr(s['description']);
  const verification = safeStr(s['verification']);

  if (!title || !description || !verification) {
    errs.push({
      field: `steps[${idx}]`,
      message: 'Step missing required field (title, description, or verification).',
    });
    return undefined;
  }

  const rawRole = s['responsibleRole'];
  const responsibleRole = typeof rawRole === 'string' && VALID_ROLES.has(rawRole)
    ? rawRole as PlanStep['responsibleRole']
    : 'FUNCTIONAL_CONSULTANT' as PlanStep['responsibleRole'];

  return {
    sequence,
    title,
    description,
    responsibleRole,
    prerequisites: safeStrArr(s['prerequisites']),
    verification,
    status: 'PENDING', // always PENDING from LLM — enforced
  };
}

function parseSection(
  raw: unknown,
  idx: number,
  errs: PlanValidationError[],
): PlanSection | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;

  const key = typeof s['key'] === 'string' && VALID_SECTION_KEYS.has(s['key'])
    ? s['key'] as PlanSectionKey
    : undefined;

  if (!key) {
    errs.push({
      field: `sections[${idx}].key`,
      message: `Invalid or missing section key: ${JSON.stringify(s['key'])}`,
    });
    return undefined;
  }

  const content = typeof s['content'] === 'string' && s['content'].trim()
    ? s['content'].trim().slice(0, MAX_STR)
    : `No content provided for ${PLAN_SECTION_TITLES[key]}.`;

  const section: PlanSection = {
    key,
    title: PLAN_SECTION_TITLES[key],
    content,
  };

  if (key === 'IMPLEMENTATION_STEPS' && Array.isArray(s['steps'])) {
    const stepErrs: PlanValidationError[] = [];
    const steps = (s['steps'] as unknown[])
      .slice(0, MAX_STEPS)
      .map((st, i) => parseStep(st, i, stepErrs))
      .filter((st): st is PlanStep => st !== undefined);
    errs.push(...stepErrs);
    section.steps = steps;
  }

  return section;
}

// ── Parse & validate LLM output ──────────────────────────────────────────────

export function parsePlanResponse(rawContent: string): PlanParseResult {
  const errs: PlanValidationError[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJson(rawContent));
  } catch {
    return {
      success: false,
      errors: [{ field: 'root', message: 'Not valid JSON.' }],
      rawContent: rawContent.slice(0, 500),
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      success: false,
      errors: [{ field: 'root', message: 'JSON is not an object.' }],
      rawContent: rawContent.slice(0, 500),
    };
  }

  const raw = parsed as RawPlanOutput;

  const summary = safeStr(raw.summary) ?? 'Modernization plan generated by N-CoreShift.';
  const estimatedComplexity =
    typeof raw.estimatedComplexity === 'string' && VALID_COMPLEXITY.has(raw.estimatedComplexity)
      ? raw.estimatedComplexity
      : 'MEDIUM';
  const keyRisks = safeStrArr(raw.keyRisks);
  const assumptions = safeStrArr(raw.assumptions);

  if (!Array.isArray(raw.sections)) {
    return {
      success: false,
      errors: [{ field: 'sections', message: 'sections must be an array.' }],
      rawContent: rawContent.slice(0, 500),
    };
  }

  const sections = (raw.sections as unknown[])
    .map((s, i) => parseSection(s, i, errs))
    .filter((s): s is PlanSection => s !== undefined);

  // Verify all 18 required sections are present
  const presentKeys = new Set(sections.map(s => s.key));
  for (const required of PLAN_SECTION_KEYS) {
    if (!presentKeys.has(required)) {
      errs.push({
        field: 'sections',
        message: `Required section missing: ${required}`,
      });
    }
  }

  // Implementation steps must have at least one step
  const implSection = sections.find(s => s.key === 'IMPLEMENTATION_STEPS');
  if (implSection && (!implSection.steps || implSection.steps.length === 0)) {
    errs.push({
      field: 'IMPLEMENTATION_STEPS.steps',
      message: 'Implementation steps section must contain at least one step.',
    });
  }

  const missingSections = errs.filter(e => e.field === 'sections' && e.message.startsWith('Required'));
  if (missingSections.length > 0) {
    return { success: false, sections, summary, estimatedComplexity, keyRisks, assumptions, errors: errs, rawContent: rawContent.slice(0, 500) };
  }

  return { success: true, sections, summary, estimatedComplexity, keyRisks, assumptions, errors: errs };
}

// ── Error fallback plan ───────────────────────────────────────────────────────

function buildFallbackSections(): PlanSection[] {
  return PLAN_SECTION_KEYS.map(key => ({
    key,
    title: PLAN_SECTION_TITLES[key],
    content: 'Content not available — plan generation failed. Consultant review required.',
    ...(key === 'IMPLEMENTATION_STEPS' ? { steps: [] } : {}),
  }));
}

// ── Main service ─────────────────────────────────────────────────────────────

export class ModernizationPlanningService {
  constructor(private readonly aiProvider: AIProvider) {}

  /**
   * Generate a new ModernizationPlan from an approved assessment.
   * Throws if the AI provider is not configured.
   */
  async createPlan(req: PlanningRequest): Promise<PlanningResponse> {
    if (!this.aiProvider.isConfigured()) {
      throw new Error(
        'AI provider not configured. Configure a provider before generating modernization plans.',
      );
    }

    const prompt = buildPlanPrompt(req);
    const generatedAt = new Date().toISOString();

    const aiResponse = await this.aiProvider.generate({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      model: req.model,
      temperature: 0.15,
      callerId: `modernization-plan:${req.tenantId}:${req.projectId}:${req.objectId}`,
    });

    const parseResult = parsePlanResponse(aiResponse.content);
    const now = new Date().toISOString();

    if (parseResult.success && parseResult.sections) {
      const plan: ModernizationPlan = {
        id: randomUUID(),
        tenantId: req.tenantId,
        projectId: req.projectId,
        analysisId: req.analysisId,
        objectId: req.objectId,
        objectName: req.objectName,
        objectType: req.objectType,
        assessmentId: req.assessmentId,
        state: 'DRAFT',
        sections: parseResult.sections,
        summary: parseResult.summary ?? '',
        estimatedComplexity: parseResult.estimatedComplexity ?? 'MEDIUM',
        keyRisks: parseResult.keyRisks ?? [],
        assumptions: parseResult.assumptions ?? [],
        generatedByProvider: aiResponse.provider,
        generatedByModel: aiResponse.model,
        generatedAt,
        requiresRevalidation: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      return { plan, parseResult };
    }

    // Graceful fallback — plan is persisted with error flag for manual review
    const plan: ModernizationPlan = {
      id: randomUUID(),
      tenantId: req.tenantId,
      projectId: req.projectId,
      analysisId: req.analysisId,
      objectId: req.objectId,
      objectName: req.objectName,
      objectType: req.objectType,
      assessmentId: req.assessmentId,
      state: 'DRAFT',
      sections: buildFallbackSections(),
      summary: 'Plan generation failed — manual consultant review required.',
      estimatedComplexity: 'MEDIUM',
      keyRisks: ['Plan generation failed; risk profile unknown until manual review.'],
      assumptions: ['AI response was malformed; plan content must be completed manually.'],
      generatedByProvider: aiResponse.provider,
      generatedByModel: aiResponse.model,
      generatedAt,
      planError: parseResult.errors.map(e => `${e.field}: ${e.message}`).join('; ').slice(0, 1000),
      requiresRevalidation: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    return { plan, parseResult };
  }

  // ── Governance lifecycle ───────────────────────────────────────────────────

  /**
   * Advance a plan from DRAFT → UNDER_REVIEW.
   * Throws if the plan is not in DRAFT state.
   */
  submitForReview(plan: ModernizationPlan, submittedBy: string): ModernizationPlan {
    this.assertState(plan, ['DRAFT'], 'submit for review');
    const now = new Date().toISOString();
    return {
      ...plan,
      state: 'UNDER_REVIEW',
      submittedForReviewAt: now,
      submittedForReviewBy: submittedBy,
      version: plan.version + 1,
      updatedAt: now,
    };
  }

  /**
   * Advance a plan from UNDER_REVIEW → APPROVED.
   * Throws if the plan is not in UNDER_REVIEW state.
   * Returns to DRAFT if requiresRevalidation is set (cannot approve stale plan).
   */
  approvePlan(plan: ModernizationPlan, approvedBy: string): ModernizationPlan {
    this.assertState(plan, ['UNDER_REVIEW'], 'approve');
    if (plan.requiresRevalidation) {
      throw new Error(
        `Plan ${plan.id} requires revalidation before it can be approved. ` +
          `Reason: ${plan.revalidationReason ?? 'landscape or policy change detected'}`,
      );
    }
    const now = new Date().toISOString();
    return {
      ...plan,
      state: 'APPROVED',
      approvedAt: now,
      approvedBy,
      version: plan.version + 1,
      updatedAt: now,
    };
  }

  /**
   * Move a plan from UNDER_REVIEW → REJECTED.
   * A rejection reason is required.
   */
  rejectPlan(plan: ModernizationPlan, rejectedBy: string, reason: string): ModernizationPlan {
    this.assertState(plan, ['UNDER_REVIEW'], 'reject');
    if (!reason || !reason.trim()) {
      throw new Error('A rejection reason is required.');
    }
    const now = new Date().toISOString();
    return {
      ...plan,
      state: 'REJECTED',
      rejectedAt: now,
      rejectedBy,
      rejectionReason: reason.trim().slice(0, 2000),
      version: plan.version + 1,
      updatedAt: now,
    };
  }

  /**
   * Return a rejected or approved plan to DRAFT for revision.
   */
  reopenPlan(plan: ModernizationPlan, _reopenedBy: string): ModernizationPlan {
    this.assertState(plan, ['REJECTED', 'APPROVED'], 'reopen');
    const now = new Date().toISOString();
    return {
      ...plan,
      state: 'DRAFT',
      requiresRevalidation: false,
      revalidationReason: undefined,
      version: plan.version + 1,
      updatedAt: now,
    };
  }

  /**
   * Apply a governance decision from a PlanReviewDecision record.
   * Delegates to the appropriate lifecycle method.
   */
  applyReviewDecision(plan: ModernizationPlan, decision: PlanReviewDecision): ModernizationPlan {
    switch (decision.action) {
      case 'SUBMIT_FOR_REVIEW':
        return this.submitForReview(plan, decision.reviewerId);
      case 'APPROVE':
        return this.approvePlan(plan, decision.reviewerId);
      case 'REJECT':
        return this.rejectPlan(plan, decision.reviewerId, decision.rejectionReason ?? 'No reason provided.');
      default:
        throw new Error(`Unknown review action: ${String(decision.action)}`);
    }
  }

  /**
   * Invalidate a plan — sets requiresRevalidation=true.
   * Called when target landscape or Clean Core policy changes after a plan was approved.
   * An APPROVED plan remains APPROVED but is blocked from code generation until re-approved.
   */
  invalidatePlan(
    plan: ModernizationPlan,
    reason: string,
    triggeredBy: string,
  ): { plan: ModernizationPlan; record: PlanInvalidationRecord } {
    const now = new Date().toISOString();
    const updated: ModernizationPlan = {
      ...plan,
      requiresRevalidation: true,
      revalidationReason: reason.trim().slice(0, 500),
      version: plan.version + 1,
      updatedAt: now,
    };
    const record: PlanInvalidationRecord = {
      planId: plan.id,
      reason: reason.trim().slice(0, 500),
      triggeredBy,
      invalidatedAt: now,
    };
    return { plan: updated, record };
  }

  /**
   * Returns true when the plan is cleared for code generation (Phase 9 gate).
   * Requires: state=APPROVED and requiresRevalidation=false.
   */
  isReadyForCodeGeneration(plan: ModernizationPlan): boolean {
    return plan.state === 'APPROVED' && !plan.requiresRevalidation;
  }

  /**
   * Build a history entry snapshot for audit purposes.
   */
  buildHistoryEntry(
    plan: ModernizationPlan,
    changedBy: string,
    changeNote: string,
  ): PlanHistoryEntry {
    return {
      planId: plan.id,
      version: plan.version,
      state: plan.state,
      changedBy,
      changedAt: plan.updatedAt,
      changeNote,
      snapshotSummary: plan.summary.slice(0, 200),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private assertState(
    plan: ModernizationPlan,
    allowed: PlanState[],
    action: string,
  ): void {
    if (!allowed.includes(plan.state)) {
      throw new Error(
        `Cannot ${action} plan ${plan.id}: current state is '${plan.state}', ` +
          `but expected one of [${allowed.join(', ')}].`,
      );
    }
  }
}

// ── Unused import cleanup — re-export for callers ────────────────────────────
export type {
  ModernizationPlan,
  PlanSection,
  PlanStep,
  PlanSectionKey,
  PlanState,
  PlanParseResult,
  PlanValidationError,
  PlanningRequest,
  PlanningResponse,
  PlanReviewDecision,
  PlanInvalidationRecord,
  PlanHistoryEntry,
};
