/**
 * N-CoreShift - Phase 9: Code Generation Service
 */

import { randomUUID } from 'crypto';
import type { AIProvider } from '../providers/AIProvider.js';
import { CodeGenerationPromptBuilder, CODEGEN_PROMPT_VERSION } from './CodeGenerationPromptBuilder.js';
import type {
  CodeGenerationRequest,
  CodeGenerationResponse,
  CodeGenerationGateResult,
  GeneratedArtifact,
  ArtifactParseResult,
  ArtifactSectionKey,
  ArtifactHistoryEntry,
  ConsultantArtifactDecision,
  RawArtifactOutput,
  ArtifactValidationError,
} from './types.js';

const MANDATORY_LABEL = 'Generated implementation draft - consultant validation required.';

const REQUIRED_SECTION_KEYS: ArtifactSectionKey[] = [
  'PURPOSE', 'PRECONDITIONS', 'GENERATED_CODE', 'CONFIGURATION_REQUIRED',
  'DEPENDENCIES', 'WHERE_IT_BELONGS', 'HOW_TO_VALIDATE', 'ASSUMPTIONS',
  'ITEMS_REQUIRING_VERIFICATION',
];

const JSON_KEY_TO_SECTION: Record<string, ArtifactSectionKey> = {
  purpose: 'PURPOSE',
  preconditions: 'PRECONDITIONS',
  generatedCode: 'GENERATED_CODE',
  configurationRequired: 'CONFIGURATION_REQUIRED',
  dependencies: 'DEPENDENCIES',
  whereItBelongs: 'WHERE_IT_BELONGS',
  howToValidate: 'HOW_TO_VALIDATE',
  assumptions: 'ASSUMPTIONS',
  itemsRequiringVerification: 'ITEMS_REQUIRING_VERIFICATION',
};

const EMPTY_SECTIONS: Record<ArtifactSectionKey, string> = {
  PURPOSE: '', PRECONDITIONS: '', GENERATED_CODE: '', CONFIGURATION_REQUIRED: '',
  DEPENDENCIES: '', WHERE_IT_BELONGS: '', HOW_TO_VALIDATE: '', ASSUMPTIONS: '',
  ITEMS_REQUIRING_VERIFICATION: '',
};

export function checkGenerationGate(request: CodeGenerationRequest): CodeGenerationGateResult {
  const blockedReasons: string[] = [];

  const landscapeApproved = request.landscapeReadinessState === 'APPROVED_FOR_CODE_GENERATION';
  if (!landscapeApproved) {
    blockedReasons.push(`Gate 1: Landscape readiness state is '${request.landscapeReadinessState}' - must be APPROVED_FOR_CODE_GENERATION.`);
  }

  const editionPresent = typeof request.targetEdition === 'string' && request.targetEdition.trim().length > 0;
  if (!editionPresent) blockedReasons.push('Gate 2: Target edition is missing or empty.');

  const releasePresent = typeof request.targetRelease === 'string' && request.targetRelease.trim().length > 0;
  if (!releasePresent) blockedReasons.push('Gate 3: Target release is missing or empty.');

  const policyPresent = typeof request.cleanCorePolicy?.posture === 'string' && request.cleanCorePolicy.posture.trim().length > 0;
  if (!policyPresent) blockedReasons.push('Gate 4: Clean Core policy posture is missing or empty.');

  const recommendationApproved = request.assessment?.architectureDecisionStatus === 'APPROVED';
  if (!recommendationApproved) {
    blockedReasons.push(`Gate 5: Assessment architecture decision status is '${request.assessment?.architectureDecisionStatus ?? 'UNKNOWN'}' - must be APPROVED.`);
  }

  const planStateApproved = request.plan?.state === 'APPROVED';
  const planNoRevalidation = request.plan?.requiresRevalidation === false;
  const planApproved = planStateApproved && planNoRevalidation;
  if (!planApproved) {
    if (!planStateApproved) {
      blockedReasons.push(`Gate 6: Modernization plan state is '${request.plan?.state ?? 'UNKNOWN'}' - must be APPROVED.`);
    } else {
      blockedReasons.push('Gate 6: Modernization plan requires revalidation before code generation can proceed.');
    }
  }

  const unresolvedEvidence = (request.assessment?.evidence ?? []).filter(
    (e) => e.verificationRequired && e.confidence !== 'VERIFIED',
  );
  const technicalPatternVerified = unresolvedEvidence.length === 0;
  if (!technicalPatternVerified) {
    blockedReasons.push(`Gate 7: ${unresolvedEvidence.length} evidence item(s) require consultant verification: [${unresolvedEvidence.map((e) => e.id).join(', ')}].`);
  }

  return {
    allowed: blockedReasons.length === 0,
    blockedReasons,
    landscapeApprovedForCodeGeneration: landscapeApproved,
    targetEditionPresent: editionPresent,
    targetReleasePresent: releasePresent,
    cleanCorePolicyPresent: policyPresent,
    recommendationApproved,
    planApproved,
    technicalPatternVerified,
  };
}

function parseArtifactResponse(rawContent: string): ArtifactParseResult {
  const errors: ArtifactValidationError[] = [];
  const stripped = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let raw: RawArtifactOutput;
  try {
    raw = JSON.parse(stripped) as RawArtifactOutput;
  } catch {
    return {
      success: false,
      errors: [{ field: 'root', message: `JSON parse failed: ${stripped.slice(0, 120)}` }],
      rawContent,
    };
  }

  const sections: Partial<Record<ArtifactSectionKey, string>> = {};
  for (const [jsonKey, sectionKey] of Object.entries(JSON_KEY_TO_SECTION)) {
    const value = (raw as Record<string, unknown>)[jsonKey];
    if (typeof value === 'string' && value.trim().length > 0) {
      sections[sectionKey] = value.trim();
    } else {
      errors.push({ field: jsonKey, message: `Missing or empty required section '${jsonKey}'.` });
    }
  }

  const purpose = sections.PURPOSE ?? '';
  if (purpose.length > 0 && !purpose.startsWith(MANDATORY_LABEL)) {
    errors.push({ field: 'purpose', message: `PURPOSE must begin with the mandatory label: "${MANDATORY_LABEL}"` });
  }

  const language = typeof raw.language === 'string' && raw.language.trim().length > 0 ? raw.language.trim() : undefined;
  const targetPlatform = typeof raw.targetPlatform === 'string' && raw.targetPlatform.trim().length > 0 ? raw.targetPlatform.trim() : undefined;

  if (!language) errors.push({ field: 'language', message: 'Language field is missing.' });
  if (!targetPlatform) errors.push({ field: 'targetPlatform', message: 'Target platform field is missing.' });

  const missingSections = REQUIRED_SECTION_KEYS.filter((k) => !sections[k]);
  if (missingSections.length > 0 || !language || !targetPlatform) {
    return {
      success: false,
      sections: Object.keys(sections).length > 0 ? (sections as Record<ArtifactSectionKey, string>) : undefined,
      language,
      targetPlatform,
      errors,
      rawContent,
    };
  }

  return { success: true, sections: sections as Record<ArtifactSectionKey, string>, language, targetPlatform, errors: [] };
}

export class CodeGenerationService {
  private readonly _aiProvider: AIProvider;
  private readonly _promptBuilder: CodeGenerationPromptBuilder;
  private readonly _store = new Map<string, GeneratedArtifact>();
  private readonly _history = new Map<string, ArtifactHistoryEntry[]>();

  constructor(aiProvider: AIProvider) {
    this._aiProvider = aiProvider;
    this._promptBuilder = new CodeGenerationPromptBuilder();
  }

  checkGate(request: CodeGenerationRequest): CodeGenerationGateResult {
    return checkGenerationGate(request);
  }

  async generateArtifact(request: CodeGenerationRequest): Promise<CodeGenerationResponse> {
    const gateResult = checkGenerationGate(request);
    const now = new Date().toISOString();

    if (!gateResult.allowed) {
      const blocked = this._buildArtifact(request, {
        now, language: 'N/A', targetPlatform: 'N/A',
        sections: { ...EMPTY_SECTIONS },
        generatedByProvider: 'NONE', generatedByModel: 'NONE',
        version: 1,
        errorMsg: gateResult.blockedReasons.join(' | '),
      });
      this._store.set(blocked.id, blocked);
      this._appendHistory(blocked.id, {
        artifactId: blocked.id, version: 1, validationStatus: 'PENDING_REVIEW',
        changedBy: 'SYSTEM', changedAt: now,
        changeNote: `Generation blocked: ${gateResult.blockedReasons[0] ?? 'gate check failed'}`,
        artifactType: request.artifactType,
      });
      return {
        artifact: blocked,
        parseResult: { success: false, errors: gateResult.blockedReasons.map((r) => ({ field: 'gate', message: r })) },
        gateResult,
      };
    }

    const systemPrompt = this._promptBuilder.buildSystemPrompt(request);
    const userPrompt = this._promptBuilder.buildUserPrompt(request);
    let rawContent: string;
    let providerName: string;
    let modelName: string;

    try {
      const aiResponse = await this._aiProvider.generate({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: request.model,
        callerId: 'CodeGenerationService',
      });
      rawContent = aiResponse.content;
      providerName = aiResponse.provider;
      modelName = aiResponse.model;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errArtifact = this._buildArtifact(request, {
        now, language: 'N/A', targetPlatform: 'N/A',
        sections: { ...EMPTY_SECTIONS },
        generatedByProvider: this._aiProvider.providerId,
        generatedByModel: request.model ?? 'unknown',
        version: 1, errorMsg: msg,
      });
      this._store.set(errArtifact.id, errArtifact);
      this._appendHistory(errArtifact.id, {
        artifactId: errArtifact.id, version: 1, validationStatus: 'PENDING_REVIEW',
        changedBy: 'SYSTEM', changedAt: now,
        changeNote: `AI provider error: ${msg}`,
        artifactType: request.artifactType,
      });
      return {
        artifact: errArtifact,
        parseResult: { success: false, errors: [{ field: 'provider', message: msg }] },
        gateResult,
      };
    }

    const parseResult = parseArtifactResponse(rawContent);
    const evidenceRefs = (request.assessment.evidence ?? []).map((e) => e.id);

    const artifact = this._buildArtifact(request, {
      now,
      language: parseResult.language ?? 'UNKNOWN',
      targetPlatform: parseResult.targetPlatform ?? 'UNKNOWN',
      sections: parseResult.sections ?? { ...EMPTY_SECTIONS },
      generatedByProvider: providerName,
      generatedByModel: modelName,
      version: 1,
      errorMsg: parseResult.success
        ? undefined
        : parseResult.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
    });

    // override evidence refs from the real parse
    const final: GeneratedArtifact = { ...artifact, evidenceReferences: evidenceRefs };

    this._store.set(final.id, final);
    this._appendHistory(final.id, {
      artifactId: final.id, version: 1, validationStatus: 'PENDING_REVIEW',
      changedBy: 'SYSTEM', changedAt: now,
      changeNote: parseResult.success
        ? 'Artifact generated and parsed successfully.'
        : `Artifact generated but parse had errors: ${parseResult.errors.map((e) => e.field).join(', ')}`,
      artifactType: request.artifactType,
    });

    return { artifact: final, parseResult, gateResult };
  }

  applyConsultantDecision(artifactId: string, decision: ConsultantArtifactDecision): GeneratedArtifact {
    const existing = this._store.get(artifactId);
    if (!existing) throw new Error(`Artifact '${artifactId}' not found.`);

    const now = new Date().toISOString();
    let updated: GeneratedArtifact;

    switch (decision.action) {
      case 'ACCEPT':
        updated = {
          ...existing,
          validationStatus: 'ACCEPTED',
          consultantNotes: decision.notes,
          acceptedBy: decision.consultantId,
          acceptedAt: now,
          updatedAt: now,
        };
        break;
      case 'REJECT':
        updated = {
          ...existing,
          validationStatus: 'REJECTED',
          consultantNotes: decision.notes,
          rejectedBy: decision.consultantId,
          rejectedAt: now,
          rejectionReason: decision.rejectionReason ?? 'No reason provided.',
          updatedAt: now,
        };
        break;
      case 'EDIT':
        updated = {
          ...existing,
          sections: { ...existing.sections, ...(decision.editedSections ?? {}) },
          consultantNotes: decision.notes,
          updatedAt: now,
        };
        break;
      case 'REGENERATE':
        updated = {
          ...existing,
          validationStatus: 'REGENERATED',
          consultantNotes: decision.notes,
          updatedAt: now,
        };
        break;
      default:
        throw new Error(`Unknown consultant action: ${String((decision as ConsultantArtifactDecision).action)}`);
    }

    this._store.set(artifactId, updated);
    this._appendHistory(artifactId, {
      artifactId,
      version: updated.version,
      validationStatus: updated.validationStatus,
      changedBy: decision.consultantId,
      changedAt: now,
      changeNote: `Consultant action: ${decision.action}${decision.notes ? ` - ${decision.notes}` : ''}`,
      artifactType: existing.artifactType,
    });

    return updated;
  }

  getArtifact(artifactId: string): GeneratedArtifact | undefined {
    return this._store.get(artifactId);
  }

  getArtifactHistory(artifactId: string): ArtifactHistoryEntry[] {
    return this._history.get(artifactId) ?? [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _buildArtifact(
    request: CodeGenerationRequest,
    opts: {
      now: string;
      language: string;
      targetPlatform: string;
      sections: Record<ArtifactSectionKey, string>;
      generatedByProvider: string;
      generatedByModel: string;
      version: number;
      errorMsg?: string;
    },
  ): GeneratedArtifact {
    return {
      id: randomUUID(),
      tenantId: request.tenantId,
      projectId: request.projectId,
      analysisId: request.analysisId,
      objectId: request.objectId,
      objectName: request.objectName,
      objectType: request.objectType,
      sourceAssessmentId: request.assessmentId,
      sourcePlanId: request.planId,
      artifactType: request.artifactType,
      language: opts.language,
      targetPlatform: opts.targetPlatform,
      targetEdition: request.targetEdition,
      targetRelease: request.targetRelease,
      evidenceReferences: [],
      generatedByProvider: opts.generatedByProvider,
      generatedByModel: opts.generatedByModel,
      generatedAt: opts.now,
      generationPromptVersion: CODEGEN_PROMPT_VERSION,
      validationStatus: 'PENDING_REVIEW',
      label: MANDATORY_LABEL,
      sections: opts.sections,
      artifactError: opts.errorMsg,
      version: opts.version,
      createdAt: opts.now,
      updatedAt: opts.now,
    };
  }

  private _appendHistory(artifactId: string, entry: ArtifactHistoryEntry): void {
    const existing = this._history.get(artifactId) ?? [];
    this._history.set(artifactId, [...existing, entry]);
  }
}
