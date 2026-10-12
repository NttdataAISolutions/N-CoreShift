/**
 * N-CoreShift — TelemetryService
 *
 * Records non-sensitive operational telemetry.
 * Source code content, credentials, and personal data must never be passed here.
 */

import {
  TelemetryEvent,
  TelemetryEventKind,
  TelemetryStore,
  AICallRecord,
  AnalysisDurationRecord,
  TelemetrySummary,
} from './types.js';

// ─── In-memory store (replace with persistent adapter in production) ──────────

export class InMemoryTelemetryStore implements TelemetryStore {
  private _events: TelemetryEvent[] = [];
  private _aiCalls: AICallRecord[] = [];
  private _durations: AnalysisDurationRecord[] = [];

  record(event: TelemetryEvent): void {
    this._events.push(event);
  }

  getEvents(tenantId: string, kinds?: TelemetryEventKind[]): TelemetryEvent[] {
    return this._events.filter(
      (e) => e.tenantId === tenantId && (!kinds || kinds.includes(e.kind)),
    );
  }

  getAICallRecords(tenantId: string): AICallRecord[] {
    return this._aiCalls.filter((r) => r.tenantId === tenantId);
  }

  getAnalysisDurations(tenantId: string): AnalysisDurationRecord[] {
    return this._durations.filter((r) => r.tenantId === tenantId);
  }

  /** Internal — for TelemetryService use only */
  _addAICall(record: AICallRecord): void {
    this._aiCalls.push(record);
  }

  _addDuration(record: AnalysisDurationRecord): void {
    this._durations.push(record);
  }

  clear(): void {
    this._events = [];
    this._aiCalls = [];
    this._durations = [];
  }
}

// ─── TelemetryService ─────────────────────────────────────────────────────────

export class TelemetryService {
  private readonly _store: InMemoryTelemetryStore;

  constructor(store?: InMemoryTelemetryStore) {
    this._store = store ?? new InMemoryTelemetryStore();
  }

  get store(): InMemoryTelemetryStore {
    return this._store;
  }

  // ── Generic event recorder ──────────────────────────────────────────────────

  recordEvent(event: Omit<TelemetryEvent, 'eventId' | 'timestamp'>): void {
    this._store.record({
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
  }

  // ── Analysis lifecycle ──────────────────────────────────────────────────────

  analysisStarted(opts: {
    tenantId: string;
    projectId: string;
    analysisId: string;
  }): void {
    this._store._addDuration({
      analysisId: opts.analysisId,
      tenantId: opts.tenantId,
      projectId: opts.projectId,
      startedAt: new Date().toISOString(),
      objectsProcessed: 0,
      failed: false,
    });
    this.recordEvent({ kind: 'ANALYSIS_STARTED', ...opts });
  }

  analysisCompleted(opts: {
    tenantId: string;
    projectId: string;
    analysisId: string;
    objectCount: number;
    objectsRequiringReview: number;
    durationMs: number;
  }): void {
    const dur = this._store
      .getAnalysisDurations(opts.tenantId)
      .find((d) => d.analysisId === opts.analysisId);
    if (dur) {
      dur.completedAt = new Date().toISOString();
      dur.durationMs = opts.durationMs;
      dur.objectsProcessed = opts.objectCount;
    }
    this.recordEvent({ kind: 'ANALYSIS_COMPLETED', ...opts });
  }

  analysisFailed(opts: {
    tenantId: string;
    projectId: string;
    analysisId: string;
    failureReason: string;
  }): void {
    const dur = this._store
      .getAnalysisDurations(opts.tenantId)
      .find((d) => d.analysisId === opts.analysisId);
    if (dur) {
      dur.failed = true;
      dur.failureReason = opts.failureReason;
      dur.completedAt = new Date().toISOString();
    }
    this.recordEvent({ kind: 'ANALYSIS_FAILED', ...opts });
  }

  // ── AI calls ────────────────────────────────────────────────────────────────

  aiCallStarted(opts: {
    callId: string;
    tenantId: string;
    analysisId?: string;
    providerName: string;
    modelId?: string;
    purpose: string;
  }): void {
    this._store._addAICall({
      ...opts,
      startedAt: new Date().toISOString(),
      succeeded: false,
      parseFailed: false,
    });
    this.recordEvent({ kind: 'AI_CALL_STARTED', ...opts });
  }

  aiCallCompleted(opts: {
    callId: string;
    tenantId: string;
    providerName: string;
    durationMs: number;
    tokensInput?: number;
    tokensOutput?: number;
  }): void {
    const rec = this._store
      .getAICallRecords(opts.tenantId)
      .find((r) => r.callId === opts.callId);
    if (rec) {
      rec.succeeded = true;
      rec.completedAt = new Date().toISOString();
      rec.durationMs = opts.durationMs;
      rec.tokensInput = opts.tokensInput;
      rec.tokensOutput = opts.tokensOutput;
    }
    this.recordEvent({ kind: 'AI_CALL_COMPLETED', ...opts });
  }

  aiCallFailed(opts: {
    callId: string;
    tenantId: string;
    providerName: string;
    failureReason: string;
  }): void {
    const rec = this._store
      .getAICallRecords(opts.tenantId)
      .find((r) => r.callId === opts.callId);
    if (rec) {
      rec.failureReason = opts.failureReason;
      rec.completedAt = new Date().toISOString();
    }
    this.recordEvent({ kind: 'AI_CALL_FAILED', ...opts });
  }

  aiParseFailed(opts: {
    callId: string;
    tenantId: string;
    providerName: string;
    purpose: string;
  }): void {
    const rec = this._store
      .getAICallRecords(opts.tenantId)
      .find((r) => r.callId === opts.callId);
    if (rec) {
      rec.parseFailed = true;
    }
    this.recordEvent({ kind: 'AI_PARSE_FAILED', ...opts });
  }

  // ── Security events ─────────────────────────────────────────────────────────

  promptInjectionDetected(opts: {
    tenantId: string;
    analysisId?: string;
    objectId?: string;
    meta?: Record<string, string | number | boolean>;
  }): void {
    this.recordEvent({
      kind: 'PROMPT_INJECTION_DETECTED',
      injectionDetected: true,
      ...opts,
    });
  }

  unauthorizedAccessAttempt(opts: {
    tenantId: string;
    meta?: Record<string, string | number | boolean>;
  }): void {
    this.recordEvent({ kind: 'UNAUTHORIZED_ACCESS_ATTEMPT', ...opts });
  }

  secretRedactionApplied(opts: { tenantId: string }): void {
    this.recordEvent({ kind: 'SECRET_REDACTION_APPLIED', ...opts });
  }

  // ── Code generation ─────────────────────────────────────────────────────────

  codeGenerationGateBlocked(opts: {
    tenantId: string;
    analysisId?: string;
    blockedReasons: string[];
  }): void {
    this.recordEvent({ kind: 'CODE_GENERATION_GATE_BLOCKED', ...opts });
  }

  codeGenerationFailed(opts: {
    tenantId: string;
    analysisId?: string;
    failureReason: string;
  }): void {
    this.recordEvent({ kind: 'CODE_GENERATION_FAILED', ...opts });
  }

  // ── Plan generation ─────────────────────────────────────────────────────────

  planGenerationFailed(opts: {
    tenantId: string;
    analysisId?: string;
    failureReason: string;
  }): void {
    this.recordEvent({ kind: 'PLAN_GENERATION_FAILED', ...opts });
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  getSummary(tenantId: string): TelemetrySummary {
    const events = this._store.getEvents(tenantId);
    const aiCalls = this._store.getAICallRecords(tenantId);
    const durations = this._store.getAnalysisDurations(tenantId);

    const count = (kind: TelemetryEventKind) =>
      events.filter((e) => e.kind === kind).length;

    const totalObjects = events
      .filter((e) => e.kind === 'ANALYSIS_COMPLETED')
      .reduce((acc, e) => acc + (e.objectCount ?? 0), 0);

    const objectsRequiringReview = events
      .filter((e) => e.kind === 'ANALYSIS_COMPLETED')
      .reduce((acc, e) => acc + (e.objectsRequiringReview ?? 0), 0);

    const timestamps = events.map((e) => e.timestamp).sort();
    return {
      tenantId,
      windowStart: timestamps[0] ?? new Date().toISOString(),
      windowEnd: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      totalAnalyses: durations.length,
      failedAnalyses: durations.filter((d) => d.failed).length,
      totalObjects,
      objectsRequiringReview,
      aiCalls: aiCalls.length,
      aiCallFailures: aiCalls.filter((r) => !!r.failureReason).length,
      parseFailed: aiCalls.filter((r) => r.parseFailed).length,
      providerHealthChecks: count('PROVIDER_HEALTH_CHECK'),
      codeGenerationAttempts:
        count('CODE_GENERATION_COMPLETED') + count('CODE_GENERATION_FAILED'),
      codeGenerationFailures: count('CODE_GENERATION_FAILED'),
      codeGenerationGateBlocks: count('CODE_GENERATION_GATE_BLOCKED'),
      planGenerationFailures: count('PLAN_GENERATION_FAILED'),
      injectionDetectionEvents: count('PROMPT_INJECTION_DETECTED'),
      unauthorizedAccessAttempts: count('UNAUTHORIZED_ACCESS_ATTEMPT'),
    };
  }
}
