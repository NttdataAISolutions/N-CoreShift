/**
 * N-CoreShift – Phase 7: Clean Core Assessment Engine
 */

import { randomUUID } from 'crypto';
import type { AIProvider } from '../providers/AIProvider.js';
import { buildAssessmentPrompt } from './CleanCoreAssessmentPromptBuilder.js';
import { ALL_DISPOSITIONS, type Disposition, type CleanCoreRisk } from '../types/index.js';
import {
  CURRENT_TECHNICAL_PATTERNS,
  EVIDENCE_TYPES,
  type AssessmentRequest,
  type AssessmentResponse,
  type AssessmentParseResult,
  type AssessmentValidationError,
  type ValidatedAssessmentResult,
  type ObjectAssessment,
  type AssessmentEvidenceItem,
  type EvidenceApplicabilityResult,
  type RawAssessmentOutput,
  type CurrentTechnicalPattern,
  type TargetEdition,
} from './types.js';

const VALID_DISPOSITIONS = new Set<string>(ALL_DISPOSITIONS);
const VALID_RISKS = new Set<string>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_PATTERNS = new Set<string>(CURRENT_TECHNICAL_PATTERNS);
const VALID_EV_CONF = new Set<string>(['VERIFIED', 'LIKELY', 'REQUIRES_VERIFICATION', 'INSUFFICIENT_EVIDENCE']);
const VALID_EV_TYPES = new Set<string>(EVIDENCE_TYPES);
const MAX_STR = 4000;
const MAX_EV = 20;
const MAX_ARR = 30;

function extractJson(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a !== -1 && b > a) return raw.slice(a, b + 1);
  return raw.trim();
}

function enumField<T extends string>(v: unknown, set: Set<string>, field: string, errs: AssessmentValidationError[], def?: T): T | undefined {
  if (typeof v === 'string' && set.has(v)) return v as T;
  if (def !== undefined) return def;
  errs.push({ field, message: `Invalid/missing value: ${JSON.stringify(v)}. Expected: ${[...set].join(', ')}` });
  return undefined;
}

function strField(v: unknown, field: string, errs: AssessmentValidationError[], required: boolean): string | undefined {
  if (typeof v !== 'string' || !v.trim()) {
    if (required) errs.push({ field, message: 'Required string missing.' });
    return undefined;
  }
  return v.trim().slice(0, MAX_STR);
}

function confField(v: unknown, errs: AssessmentValidationError[]): number | undefined {
  if (typeof v !== 'number' || isNaN(v)) { errs.push({ field: 'confidence', message: 'Must be a number.' }); return undefined; }
  if (v < 0 || v > 1) { errs.push({ field: 'confidence', message: `Out of range [0,1]: ${v}` }); return undefined; }
  return v;
}

function evArray(v: unknown, errs: AssessmentValidationError[]): AssessmentEvidenceItem[] {
  if (!Array.isArray(v)) return [];
  const out: AssessmentEvidenceItem[] = [];
  (v as unknown[]).slice(0, MAX_EV).forEach((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const e = item as Record<string, unknown>;
    const desc = typeof e['description'] === 'string' && e['description'].trim() ? e['description'].trim().slice(0, MAX_STR) : null;
    if (!desc) { errs.push({ field: `evidence[${idx}].description`, message: 'Missing description.' }); return; }
    const id = typeof e['id'] === 'string' && e['id'] ? e['id'] : randomUUID();
    const type: AssessmentEvidenceItem['type'] =
      typeof e['type'] === 'string' && VALID_EV_TYPES.has(e['type']) ? e['type'] as AssessmentEvidenceItem['type'] : 'CODE_ANALYSIS';
    const confidence: AssessmentEvidenceItem['confidence'] =
      typeof e['confidence'] === 'string' && VALID_EV_CONF.has(e['confidence']) ? e['confidence'] as AssessmentEvidenceItem['confidence'] : 'REQUIRES_VERIFICATION';
    const verificationRequired = e['verificationRequired'] === true || e['verificationRequired'] === 'true';
    const applicableEditions: TargetEdition[] = Array.isArray(e['applicableEditions'])
      ? (e['applicableEditions'] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 10) as TargetEdition[]
      : [];
    out.push({
      id, type, description: desc, source: 'AI_DERIVED', confidence, verificationRequired, applicableEditions,
      applicableFromRelease: typeof e['applicableFromRelease'] === 'string' ? e['applicableFromRelease'] : undefined,
      applicableUntilRelease: typeof e['applicableUntilRelease'] === 'string' ? e['applicableUntilRelease'] : undefined,
      namedSapArtifact: typeof e['namedSapArtifact'] === 'string' ? e['namedSapArtifact'] : undefined,
    });
  });
  return out;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).slice(0, MAX_ARR).filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => (x as string).trim().slice(0, MAX_STR));
}

function buildVerifList(r: ValidatedAssessmentResult, inapplicable: EvidenceApplicabilityResult[]): string[] {
  const out = [...r.verificationRequired];
  for (const ie of inapplicable) out.push(`EVIDENCE APPLICABILITY WARNING: ${ie.reason}`);
  for (const ev of r.evidence) {
    if (ev.namedSapArtifact && ev.verificationRequired) {
      out.push(`Verify SAP artifact '${ev.namedSapArtifact}' for edition ${ev.applicableEditions.join(', ') || 'unspecified'}.`);
    }
  }
  return out;
}

// ── Engine ──────────────────────────────────────────────────────────────────

export class CleanCoreAssessmentEngine {
  constructor(private readonly aiProvider: AIProvider) {}

  async assess(req: AssessmentRequest): Promise<AssessmentResponse> {
    if (!this.aiProvider.isConfigured()) {
      throw new Error('AI provider not configured. Configure a provider before running assessments.');
    }
    const prompt = buildAssessmentPrompt(req);
    const generatedAt = new Date().toISOString();
    const aiResponse = await this.aiProvider.generate({
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      model: req.model, temperature: 0.1,
      callerId: `cleancore-assessment:${req.tenantId}:${req.projectId}:${req.objectId}`,
    });
    const parseResult = this.parseAndValidate(aiResponse.content);
    const evidenceApplicability = parseResult.result
      ? checkEvidenceApplicability(parseResult.result.evidence, req.targetEdition, req.targetRelease)
      : [];
    const inapplicable = evidenceApplicability.filter(r => !r.isApplicable);
    const assessment = this.buildAssessment(req, parseResult, inapplicable, aiResponse.provider, aiResponse.model, generatedAt);
    return { assessment, parseResult, inapplicableEvidence: evidenceApplicability };
  }

  parseAndValidate(rawContent: string): AssessmentParseResult {
    const errs: AssessmentValidationError[] = [];
    let parsed: unknown;
    try { parsed = JSON.parse(extractJson(rawContent)); }
    catch { return { success: false, errors: [{ field: 'root', message: 'Not valid JSON.' }], rawContent: rawContent.slice(0, 500) }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { success: false, errors: [{ field: 'root', message: 'JSON is not an object.' }], rawContent: rawContent.slice(0, 500) };
    }
    const raw = parsed as RawAssessmentOutput;
    const disposition = enumField<Disposition>(raw.disposition, VALID_DISPOSITIONS, 'disposition', errs);
    const cleanCoreRisk = enumField<CleanCoreRisk>(raw.cleanCoreRisk, VALID_RISKS, 'cleanCoreRisk', errs);
    const currentPattern = enumField<CurrentTechnicalPattern>(raw.currentPattern, VALID_PATTERNS, 'currentPattern', errs, 'UNKNOWN' as CurrentTechnicalPattern);
    const finding = strField(raw.finding, 'finding', errs, true);
    const recommendedTargetPattern = strField(raw.recommendedTargetPattern, 'recommendedTargetPattern', errs, true);
    const reasoning = strField(raw.reasoning, 'reasoning', errs, true);
    const confidence = confField(raw.confidence, errs);
    const evidence = evArray(raw.evidence, errs);
    const assumptions = strArray(raw.assumptions);
    const verificationRequired = strArray(raw.verificationRequired);
    if (!disposition || !cleanCoreRisk || !finding || !recommendedTargetPattern || !reasoning || confidence === undefined) {
      return { success: false, errors: errs, rawContent: rawContent.slice(0, 500) };
    }
    const result: ValidatedAssessmentResult = {
      disposition, cleanCoreRisk, currentPattern: currentPattern ?? 'UNKNOWN',
      finding, recommendedTargetPattern, reasoning, evidence, confidence, assumptions, verificationRequired,
    };
    return { success: true, result, errors: errs };
  }

  private buildAssessment(
    req: AssessmentRequest,
    parseResult: AssessmentParseResult,
    inapplicable: EvidenceApplicabilityResult[],
    provider: string, model: string, generatedAt: string,
  ): ObjectAssessment {
    const now = new Date().toISOString();
    if (parseResult.success && parseResult.result) {
      const r = parseResult.result;
      return {
        id: randomUUID(), tenantId: req.tenantId, projectId: req.projectId,
        analysisId: req.analysisId, objectId: req.objectId, objectName: req.objectName, objectType: req.objectType,
        disposition: r.disposition, cleanCoreRisk: r.cleanCoreRisk, currentPattern: r.currentPattern,
        businessRequirement: req.functionalIntent.businessObjective,
        finding: r.finding, recommendedTargetPattern: r.recommendedTargetPattern, reasoning: r.reasoning,
        targetEdition: req.targetEdition, targetRelease: req.targetRelease,
        evidence: r.evidence, confidence: r.confidence, assumptions: r.assumptions,
        verificationRequired: buildVerifList(r, inapplicable),
        architectureDecisionStatus: 'PENDING',
        generatedByProvider: provider, generatedByModel: model, generatedAt,
        requiresRevalidation: false, version: 1, createdAt: now, updatedAt: now,
      };
    }
    return {
      id: randomUUID(), tenantId: req.tenantId, projectId: req.projectId,
      analysisId: req.analysisId, objectId: req.objectId, objectName: req.objectName, objectType: req.objectType,
      disposition: 'REQUIRES_REVIEW', cleanCoreRisk: 'HIGH', currentPattern: 'UNKNOWN',
      businessRequirement: req.functionalIntent.businessObjective,
      finding: 'Assessment failed: AI response was invalid. Manual review required.',
      recommendedTargetPattern: 'Consultant review required.',
      reasoning: `Parse errors: ${parseResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')}`,
      targetEdition: req.targetEdition, targetRelease: req.targetRelease,
      evidence: [], confidence: 0, assumptions: ['AI response was malformed.'],
      verificationRequired: ['Manual consultant review required due to assessment parsing failure.'],
      architectureDecisionStatus: 'PENDING',
      generatedByProvider: provider, generatedByModel: model, generatedAt,
      assessmentError: parseResult.errors.map(e => `${e.field}: ${e.message}`).join('; ').slice(0, 1000),
      requiresRevalidation: false, version: 1, createdAt: now, updatedAt: now,
    };
  }
}

// ── Evidence applicability ──────────────────────────────────────────────────

export function checkEvidenceApplicability(
  evidence: AssessmentEvidenceItem[],
  targetEdition: TargetEdition,
  targetRelease: string,
): EvidenceApplicabilityResult[] {
  return evidence.map(item => {
    if (item.applicableEditions.length > 0 && !item.applicableEditions.includes(targetEdition)) {
      return { evidenceId: item.id, targetEdition, targetRelease, isApplicable: false, reason: `Evidence only applies to editions: ${item.applicableEditions.join(', ')}. Target: ${targetEdition}.` };
    }
    if (item.applicableFromRelease && targetRelease && targetRelease < item.applicableFromRelease) {
      return { evidenceId: item.id, targetEdition, targetRelease, isApplicable: false, reason: `Evidence requires release >= ${item.applicableFromRelease}. Target: ${targetRelease}.` };
    }
    if (item.applicableUntilRelease && targetRelease && targetRelease >= item.applicableUntilRelease) {
      return { evidenceId: item.id, targetEdition, targetRelease, isApplicable: false, reason: `Evidence only applies up to release ${item.applicableUntilRelease}. Target: ${targetRelease}.` };
    }
    return { evidenceId: item.id, targetEdition, targetRelease, isApplicable: true };
  });
}

// ── Package summary ─────────────────────────────────────────────────────────

export function buildPackageAssessmentSummary(
  assessments: ObjectAssessment[],
  analysisId: string,
  projectId: string,
  tenantId: string,
) {
  const byDisposition = { RETIRE: 0, REPLACE: 0, REFACTOR: 0, REPLATFORM: 0, REQUIRES_REVIEW: 0 };
  const riskDistribution = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  let unresolvedEvidenceCount = 0;
  let requiresReviewCount = 0;
  let objectsWithInsufficientEvidence = 0;
  let objectsPendingArchitectureDecision = 0;

  for (const a of assessments) {
    if (a.disposition in byDisposition) {
      byDisposition[a.disposition as keyof typeof byDisposition]++;
    }
    if (a.cleanCoreRisk in riskDistribution) {
      riskDistribution[a.cleanCoreRisk as keyof typeof riskDistribution]++;
    }
    if (a.disposition === 'REQUIRES_REVIEW') requiresReviewCount++;
    if (a.confidence < 0.4) objectsWithInsufficientEvidence++;
    if (a.architectureDecisionStatus === 'PENDING') objectsPendingArchitectureDecision++;
    unresolvedEvidenceCount += a.evidence.filter(e => e.verificationRequired).length;
  }

  return {
    analysisId,
    projectId,
    tenantId,
    totalObjects: assessments.length,
    byDisposition,
    riskDistribution,
    unresolvedEvidenceCount,
    requiresReviewCount,
    objectsWithInsufficientEvidence,
    objectsPendingArchitectureDecision,
    generatedAt: new Date().toISOString(),
  };
}
