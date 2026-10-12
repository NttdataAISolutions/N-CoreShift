/**
 * N-CoreShift – Phase 6: Functional Intent Analyzer
 *
 * Uses controlled AI assistance to answer:
 *   "What business purpose does this custom object appear to serve?"
 *
 * Architecture rules enforced:
 * - All LLM calls go through AIProvider abstraction (Principle 13).
 * - Source code is untrusted data (Principle 17) – prompt builder enforces this.
 * - Business need is separated from legacy implementation.
 * - Structured output is validated before accepting.
 * - Provider outage throws – no silent fallback (Principle 23).
 * - All records scoped by tenantId + projectId (Principle 18).
 * - Consultant review/override/approval is supported with version history.
 */

import { randomUUID } from 'crypto';
import type { AIProvider } from '../providers/AIProvider.js';
import {
  buildIntentPrompt,
  extractJsonFromResponse,
} from './FunctionalIntentPromptBuilder.js';
import type {
  AnalyzeIntentRequest,
  AnalyzeIntentResponse,
  ConsultantIntentDecision,
  FunctionalIntentRecord,
  FunctionalIntentResult,
  FunctionalIntentVersion,
  IntentConfidence,
  IntentParseResult,
  IntentValidationError,
  RawFunctionalIntentOutput,
  TechnicalPattern,
} from './types.js';

// ── Injection-pattern sanitization ───────────────────────────────────────────

/**
 * Patterns that indicate the LLM may have echoed prompt-injection text back
 * into its structured output. Any string field matching one of these patterns
 * is replaced with a safe sentinel so it cannot be mistaken for real analysis.
 *
 * This is a defence-in-depth measure. The primary defence is the prompt builder
 * wrapping source code inside <UNTRUSTED-DATA> blocks (Principle 17).
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+your\s+instructions/i,
  /override\s+your\s+instructions/i,
  /disregard\s+your\s+instructions/i,
  /forget\s+your\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+if\s+you/i,
];

const INJECTION_SENTINEL =
  '[sanitized: potential injection pattern detected in AI output]';

function sanitizeOutputString(value: string): string {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      return INJECTION_SENTINEL;
    }
  }
  return value;
}

function sanitizeStringFields(obj: FunctionalIntentResult): FunctionalIntentResult {
  return {
    ...obj,
    functionalSummary: sanitizeOutputString(obj.functionalSummary),
    businessProcess: sanitizeOutputString(obj.businessProcess),
    businessObjective: sanitizeOutputString(obj.businessObjective),
    userInteraction: sanitizeOutputString(obj.userInteraction),
    moduleCandidates: obj.moduleCandidates.map(sanitizeOutputString),
    inputs: obj.inputs.map(sanitizeOutputString),
    outputs: obj.outputs.map(sanitizeOutputString),
    businessRules: obj.businessRules.map(sanitizeOutputString),
    SAPObjectsUsed: obj.SAPObjectsUsed.map(sanitizeOutputString),
    integrations: obj.integrations.map(sanitizeOutputString),
    uncertainties: obj.uncertainties.map(sanitizeOutputString),
    clarifyingQuestions: obj.clarifyingQuestions.map(sanitizeOutputString),
  };
}

// ── Valid enum values ─────────────────────────────────────────────────────────

const VALID_TECHNICAL_PATTERNS: TechnicalPattern[] = [
  'REPORT',
  'INTERACTIVE_REPORT',
  'BATCH_JOB',
  'FORM_OUTPUT',
  'ENHANCEMENT',
  'USER_EXIT',
  'INTERFACE_WRAPPER',
  'DATA_MIGRATION',
  'WORKFLOW_EXTENSION',
  'INTEGRATION_ADAPTER',
  'CUSTOM_TABLE_MAINTENANCE',
  'CLASS_LIBRARY',
  'CDS_EXTENSION',
  'CONFIGURATION_DRIVER',
  'UNKNOWN',
];

const VALID_CONFIDENCE_VALUES: IntentConfidence[] = [
  'HIGH',
  'MEDIUM',
  'LOW',
  'INSUFFICIENT',
];

// ── Output parser / validator ─────────────────────────────────────────────────

/**
 * Parses and validates the raw LLM response string.
 * Returns a typed result with validation errors if anything is wrong.
 * NEVER throws – always returns IntentParseResult.
 */
export function parseAndValidateIntentOutput(raw: string): IntentParseResult {
  const errors: IntentValidationError[] = [];

  // Extract JSON string
  const jsonStr = extractJsonFromResponse(raw);
  if (!jsonStr) {
    return {
      success: false,
      errors: [{ field: 'root', message: 'No JSON object found in response' }],
      rawContent: raw,
    };
  }

  // Parse JSON
  let parsed: RawFunctionalIntentOutput;
  try {
    parsed = JSON.parse(jsonStr) as RawFunctionalIntentOutput;
  } catch {
    return {
      success: false,
      errors: [
        { field: 'root', message: `JSON parse error: invalid JSON structure` },
      ],
      rawContent: raw,
    };
  }

  // Validate required string fields
  const requiredStrings: (keyof RawFunctionalIntentOutput)[] = [
    'functionalSummary',
    'businessProcess',
    'businessObjective',
    'userInteraction',
  ];
  for (const field of requiredStrings) {
    if (typeof parsed[field] !== 'string' || !(parsed[field] as string).trim()) {
      errors.push({ field, message: `Field "${field}" must be a non-empty string` });
    }
  }

  // Validate required array fields
  const requiredArrays: (keyof RawFunctionalIntentOutput)[] = [
    'moduleCandidates',
    'inputs',
    'outputs',
    'businessRules',
    'SAPObjectsUsed',
    'integrations',
    'uncertainties',
    'clarifyingQuestions',
  ];
  for (const field of requiredArrays) {
    if (!Array.isArray(parsed[field])) {
      errors.push({ field, message: `Field "${field}" must be an array` });
    }
  }

  // Validate technicalPattern enum
  if (!VALID_TECHNICAL_PATTERNS.includes(parsed.technicalPattern as TechnicalPattern)) {
    errors.push({
      field: 'technicalPattern',
      message: `Invalid technicalPattern: "${String(parsed.technicalPattern)}"`,
    });
  }

  // Validate confidence enum
  if (!VALID_CONFIDENCE_VALUES.includes(parsed.confidence as IntentConfidence)) {
    errors.push({
      field: 'confidence',
      message: `Invalid confidence value: "${String(parsed.confidence)}"`,
    });
  }

  if (errors.length > 0) {
    return { success: false, errors, rawContent: raw };
  }

  const result: FunctionalIntentResult = {
    functionalSummary: (parsed.functionalSummary as string).trim(),
    businessProcess: (parsed.businessProcess as string).trim(),
    moduleCandidates: (parsed.moduleCandidates as unknown[]).map(String),
    businessObjective: (parsed.businessObjective as string).trim(),
    inputs: (parsed.inputs as unknown[]).map(String),
    outputs: (parsed.outputs as unknown[]).map(String),
    businessRules: (parsed.businessRules as unknown[]).map(String),
    SAPObjectsUsed: (parsed.SAPObjectsUsed as unknown[]).map(String),
    integrations: (parsed.integrations as unknown[]).map(String),
    userInteraction: (parsed.userInteraction as string).trim(),
    technicalPattern: parsed.technicalPattern as TechnicalPattern,
    uncertainties: (parsed.uncertainties as unknown[]).map(String),
    clarifyingQuestions: (parsed.clarifyingQuestions as unknown[]).map(String),
    confidence: parsed.confidence as IntentConfidence,
  };

  return { success: true, result, errors: [] };
}

// ── In-memory store (Phase 6 – persistence deferred to Phase 8/DB) ────────────

export class FunctionalIntentAnalyzer {
  private readonly provider: AIProvider;
  private readonly records = new Map<string, FunctionalIntentRecord>();
  private readonly versions: FunctionalIntentVersion[] = [];

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  // ── Primary analysis ────────────────────────────────────────────────────────

  /**
   * Run functional intent analysis for a single SAP object.
   * Throws if the AI provider is unavailable (Principle 23).
   */
  async analyzeIntent(req: AnalyzeIntentRequest): Promise<AnalyzeIntentResponse> {
    const now = new Date().toISOString();
    const id = randomUUID();

    // Build prompt – source code is demarcated as untrusted data
    const messages = buildIntentPrompt(req.context);

    // Call AI provider – throws on outage (no silent fallback)
    const aiResponse = await this.provider.generate({
      messages,
      model: req.model,
      temperature: 0.1, // Low temperature for deterministic structured output
      maxTokens: 1500,
      callerId: `functional-intent:${req.objectName}`,
    });

    // Parse and validate structured output
    const rawParseResult = parseAndValidateIntentOutput(aiResponse.content);

    // Sanitize string fields against injection patterns (defence-in-depth, Principle 17)
    const sanitizedResult =
      rawParseResult.success && rawParseResult.result
        ? sanitizeStringFields(rawParseResult.result)
        : rawParseResult.result;

    const parseResult: IntentParseResult = rawParseResult.success
      ? { ...rawParseResult, result: sanitizedResult }
      : rawParseResult;

    const record: FunctionalIntentRecord = {
      id,
      tenantId: req.tenantId,
      projectId: req.projectId,
      analysisId: req.analysisId,
      objectName: req.objectName,
      objectType: req.objectType,
      reviewStatus: parseResult.success ? 'ANALYSIS_COMPLETE' : 'PARSE_FAILED',
      aiInterpretation: parseResult.result ?? null,
      consultantOverride: null,
      effectiveInterpretation: parseResult.result ?? null,
      analyzedByProvider: aiResponse.provider,
      analyzedByModel: aiResponse.model,
      analyzedAt: now,
      analysisError: parseResult.success
        ? undefined
        : parseResult.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(id, record);

    // Record initial version
    this.appendVersion(record, 'system', 'Initial AI analysis');

    return { record, parseResult };
  }

  // ── Consultant review actions ───────────────────────────────────────────────

  /**
   * Apply a consultant decision (APPROVE / OVERRIDE / REJECT) to a record.
   * Throws if the record does not exist or belongs to a different tenant.
   */
  applyConsultantDecision(
    recordId: string,
    tenantId: string,
    projectId: string,
    decision: ConsultantIntentDecision,
  ): FunctionalIntentRecord {
    const record = this.getRecord(recordId, tenantId, projectId);
    const now = new Date().toISOString();

    switch (decision.action) {
      case 'APPROVE': {
        record.reviewStatus = 'APPROVED';
        record.reviewedBy = decision.consultantId;
        record.reviewedAt = now;
        record.consultantNotes = decision.notes;
        // Effective interpretation remains the AI interpretation
        record.effectiveInterpretation = record.aiInterpretation;
        break;
      }

      case 'OVERRIDE': {
        if (!decision.override) {
          throw new Error('OVERRIDE action requires an override object');
        }
        record.reviewStatus = 'OVERRIDDEN';
        record.reviewedBy = decision.consultantId;
        record.reviewedAt = now;
        record.consultantNotes = decision.notes;
        record.consultantOverride = decision.override;

        // Merge override on top of AI interpretation for effective result
        if (record.aiInterpretation) {
          record.effectiveInterpretation = {
            ...record.aiInterpretation,
            ...decision.override,
          } as FunctionalIntentResult;
        } else {
          // No AI interpretation – override must be a full result
          record.effectiveInterpretation =
            decision.override as FunctionalIntentResult;
        }
        break;
      }

      case 'REJECT': {
        record.reviewStatus = 'REJECTED';
        record.reviewedBy = decision.consultantId;
        record.reviewedAt = now;
        record.consultantNotes = decision.notes;
        // Clear effective interpretation until re-analysis
        record.effectiveInterpretation = null;
        break;
      }
    }

    record.version += 1;
    record.updatedAt = now;
    this.records.set(recordId, record);

    // Record version history
    this.appendVersion(
      record,
      decision.consultantId,
      `Consultant action: ${decision.action}${decision.notes ? ` – ${decision.notes}` : ''}`,
    );

    return record;
  }

  // ── Convenience override ────────────────────────────────────────────────────

  /**
   * Convenience method: apply a full consultant override directly.
   * Sets reviewStatus to CONSULTANT_OVERRIDDEN and bumps version.
   * The override becomes the effectiveInterpretation.
   */
  applyConsultantOverride(
    record: FunctionalIntentRecord,
    override: FunctionalIntentResult,
    consultantId: string,
    notes?: string,
  ): FunctionalIntentRecord {
    const now = new Date().toISOString();
    const updated: FunctionalIntentRecord = {
      ...record,
      reviewStatus: 'CONSULTANT_OVERRIDDEN',
      consultantOverride: override,
      effectiveInterpretation: override,
      consultantOverriddenBy: consultantId,
      reviewedBy: consultantId,
      reviewedAt: now,
      consultantNotes: notes,
      version: record.version + 1,
      updatedAt: now,
    };
    this.records.set(record.id, updated);
    this.appendVersion(updated, consultantId, `Consultant override applied`);
    return updated;
  }

  // ── Retrieval ───────────────────────────────────────────────────────────────

  getRecord(
    recordId: string,
    tenantId: string,
    projectId: string,
  ): FunctionalIntentRecord {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`FunctionalIntentRecord not found: ${recordId}`);
    }
    if (record.tenantId !== tenantId || record.projectId !== projectId) {
      throw new Error(`Access denied: record belongs to a different tenant/project`);
    }
    return record;
  }

  listRecords(tenantId: string, projectId: string): FunctionalIntentRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.tenantId === tenantId && r.projectId === projectId,
    );
  }

  getVersionHistory(
    recordId: string,
    tenantId: string,
    projectId: string,
  ): FunctionalIntentVersion[] {
    // Validate access
    this.getRecord(recordId, tenantId, projectId);
    return this.versions.filter((v) => v.intentRecordId === recordId);
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private appendVersion(
    record: FunctionalIntentRecord,
    changedBy: string,
    changeReason: string,
  ): void {
    this.versions.push({
      id: randomUUID(),
      intentRecordId: record.id,
      tenantId: record.tenantId,
      projectId: record.projectId,
      version: record.version,
      reviewStatus: record.reviewStatus,
      aiInterpretation: record.aiInterpretation,
      consultantOverride: record.consultantOverride,
      changedBy,
      changeReason,
      changedAt: record.updatedAt,
    });
  }
}
