/**
 * N-CoreShift – Phase 11: Evidence Import Service (Orchestrator)
 *
 * Single entry-point for importing SAP evidence files into an analysis.
 * Routes each EvidenceImportRequest to the correct adapter based on format,
 * normalises the result into EvidenceImportResult, and (optionally) persists
 * a StoredEvidenceRecord via an injected store.
 *
 * Supported formats:
 *  ATC_XML             → ATCImportAdapter.parseATCXml
 *  SCI_XML             → SCIImportAdapter.parseSCIXml
 *  SCMON_CSV           → SCMONImportAdapter.parseSCMONCsv
 *  CCM_JSON            → CCMImportAdapter.parseCCMJson
 *  CCM_XML             → CCMImportAdapter.parseCCMXml
 *  READINESS_CHECK_JSON → ReadinessCheckImportAdapter.parseReadinessCheckJson
 *
 * Design rules:
 *  - Never throws. All errors are captured in EvidenceImportResult.errors.
 *  - Input is untrusted data (Principle 17); adapters enforce size/field limits.
 *  - Tenant and project isolation is enforced by the caller supplying tenantId
 *    and projectId; the service propagates them to every result record.
 *  - No SAP credentials are stored or touched here.
 */

import type {
  EvidenceImportFormat,
  EvidenceImportRequest,
  EvidenceImportResult,
  ImportedEvidence,
  StoredEvidenceRecord,
} from './types.js';

import { parseATCXml } from './ATCImportAdapter.js';
import { parseSCIXml } from './SCIImportAdapter.js';
import { parseSCMONCsv } from './SCMONImportAdapter.js';
import { parseCCMJson, parseCCMXml } from './CCMImportAdapter.js';
import { parseReadinessCheckJson } from './ReadinessCheckImportAdapter.js';

// ── Persistence contract ──────────────────────────────────────────────────

/**
 * Optional persistence store.  Provide an implementation to persist imported
 * evidence records; omit (or inject InMemoryEvidenceStore) for tests.
 */
export interface EvidenceStore {
  save(record: StoredEvidenceRecord): Promise<void>;
  findByAnalysis(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<StoredEvidenceRecord[]>;
}

// ── In-memory store (for tests / development) ─────────────────────────────

export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly _records: StoredEvidenceRecord[] = [];

  async save(record: StoredEvidenceRecord): Promise<void> {
    this._records.push(record);
  }

  async findByAnalysis(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<StoredEvidenceRecord[]> {
    return this._records.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.projectId === projectId &&
        r.analysisId === analysisId,
    );
  }

  /** Test helper – wipe all records */
  clear(): void {
    this._records.length = 0;
  }

  get size(): number {
    return this._records.length;
  }
}

// ── Service ───────────────────────────────────────────────────────────────

export class EvidenceImportService {
  constructor(private readonly _store?: EvidenceStore) {}

  /**
   * Import a single evidence file.
   * Returns a fully-populated EvidenceImportResult.
   * If a store was injected, persists a StoredEvidenceRecord on success.
   */
  async importEvidence(req: EvidenceImportRequest): Promise<EvidenceImportResult> {
    const importedAt = new Date().toISOString();

    // Validate required fields
    const validationError = _validateRequest(req);
    if (validationError) {
      return _errorResult(req, validationError, importedAt);
    }

    // Dispatch to the correct adapter
    let dispatchResult: DispatchResult;
    try {
      dispatchResult = _dispatch(req.format, req.fileContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return _errorResult(req, `Unexpected error in adapter: ${msg}`, importedAt);
    }

    const { evidence, warnings, errors, importedCount } = dispatchResult;

    const result: EvidenceImportResult = {
      tenantId: req.tenantId,
      projectId: req.projectId,
      analysisId: req.analysisId,
      format: req.format,
      originalFileName: req.originalFileName,
      success: errors.length === 0,
      importedCount,
      evidence,
      warnings,
      errors,
      importedAt,
    };

    // Persist if store available and parse succeeded with at least one item
    if (this._store && result.success && importedCount > 0) {
      const record: StoredEvidenceRecord = {
        id: _generateId(req),
        tenantId: req.tenantId,
        projectId: req.projectId,
        analysisId: req.analysisId,
        format: req.format,
        originalFileName: req.originalFileName,
        importedBy: req.importedBy,
        importedAt,
        itemCount: importedCount,
        evidenceJson: JSON.stringify(evidence),
        warnings,
      };
      try {
        await this._store.save(record);
      } catch (err) {
        // Store failure is non-fatal; append a warning
        const msg = err instanceof Error ? err.message : String(err);
        result.warnings = [
          ...result.warnings,
          `Evidence parsed successfully but failed to persist: ${msg}`,
        ];
      }
    }

    return result;
  }

  /**
   * Retrieve all evidence records for a given analysis from the store.
   * Returns an empty array if no store is configured.
   */
  async getEvidenceForAnalysis(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<StoredEvidenceRecord[]> {
    if (!this._store) return [];
    return this._store.findByAnalysis(tenantId, projectId, analysisId);
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────

interface DispatchResult {
  evidence: ImportedEvidence;
  warnings: string[];
  errors: string[];
  importedCount: number;
}

function _dispatch(format: EvidenceImportFormat, content: string): DispatchResult {
  switch (format) {
    case 'ATC_XML': {
      const r = parseATCXml(content);
      return {
        evidence: { type: 'ATC', findings: r.findings },
        warnings: r.warnings,
        errors: r.errors,
        importedCount: r.findings.length,
      };
    }

    case 'SCI_XML': {
      const r = parseSCIXml(content);
      return {
        evidence: { type: 'SCI', findings: r.findings },
        warnings: r.warnings,
        errors: r.errors,
        importedCount: r.findings.length,
      };
    }

    case 'SCMON_CSV': {
      const r = parseSCMONCsv(content);
      return {
        evidence: { type: 'SCMON', entries: r.entries },
        warnings: r.warnings,
        errors: r.errors,
        importedCount: r.entries.length,
      };
    }

    case 'CCM_JSON': {
      const r = parseCCMJson(content);
      return {
        evidence: { type: 'CCM', objects: r.objects },
        warnings: r.warnings,
        errors: r.errors,
        importedCount: r.objects.length,
      };
    }

    case 'CCM_XML': {
      const r = parseCCMXml(content);
      return {
        evidence: { type: 'CCM', objects: r.objects },
        warnings: r.warnings,
        errors: r.errors,
        importedCount: r.objects.length,
      };
    }

    case 'READINESS_CHECK_JSON': {
      const r = parseReadinessCheckJson(content);
      return {
        evidence: { type: 'READINESS_CHECK', objects: r.objects },
        warnings: r.warnings,
        errors: r.errors,
        importedCount: r.objects.length,
      };
    }

    default: {
      // TypeScript exhaustiveness guard
      const _exhaustive: never = format;
      return {
        evidence: { type: 'ATC', findings: [] },
        warnings: [],
        errors: [`Unknown evidence format: ${String(_exhaustive)}`],
        importedCount: 0,
      };
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _validateRequest(req: EvidenceImportRequest): string | null {
  if (!req.tenantId?.trim()) return 'tenantId is required';
  if (!req.projectId?.trim()) return 'projectId is required';
  if (!req.analysisId?.trim()) return 'analysisId is required';
  if (!req.importedBy?.trim()) return 'importedBy is required';
  if (!req.format) return 'format is required';
  if (typeof req.fileContent !== 'string' || req.fileContent.trim().length === 0) {
    return 'fileContent must be a non-empty string';
  }
  return null;
}

function _errorResult(
  req: EvidenceImportRequest,
  error: string,
  importedAt: string,
): EvidenceImportResult {
  return {
    tenantId: req.tenantId ?? '',
    projectId: req.projectId ?? '',
    analysisId: req.analysisId ?? '',
    format: req.format,
    originalFileName: req.originalFileName ?? '',
    success: false,
    importedCount: 0,
    evidence: { type: 'ATC', findings: [] },
    warnings: [],
    errors: [error],
    importedAt,
  };
}

/** Deterministic pseudo-ID: not a UUID – fine for non-DB usage */
function _generateId(req: EvidenceImportRequest): string {
  const ts = Date.now();
  return `evidence-${req.tenantId}-${req.analysisId}-${req.format}-${ts}`;
}
