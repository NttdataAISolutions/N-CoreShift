/**
 * N-CoreShift – Phase 4: ModernizationAnalysisService
 *
 * Domain service that manages:
 *   - ModernizationAnalysis lifecycle
 *   - CodeSource and SourceFile records
 *   - CustomObject stubs derived from ingested files
 *
 * Depends on the LandscapeReadinessService gate (assessmentAllowed must be true).
 * All records are scoped by tenantId + projectId (Principle 18).
 * This service NEVER executes uploaded source code (Principle 17).
 */

import { randomUUID } from "node:crypto";
import type {
  AnalysisRepository,
  CreateAnalysisInput,
  CustomObjectRecord,
  IngestedSource,
  ModernizationAnalysis,
  SourceFileRecord,
} from "./types.js";

// ── ModernizationAnalysisService ──────────────────────────────────────────

export class ModernizationAnalysisService {
  constructor(private readonly repo: AnalysisRepository) {}

  // ── Analysis CRUD ───────────────────────────────────────────────────────

  async createAnalysis(
    input: CreateAnalysisInput,
  ): Promise<ModernizationAnalysis> {
    if (!input.tenantId) throw new Error("tenantId is required");
    if (!input.projectId) throw new Error("projectId is required");
    if (!input.name || input.name.trim() === "")
      throw new Error("Analysis name is required");

    const analysis: ModernizationAnalysis = {
      id: randomUUID(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      name: input.name.trim(),
      description: input.description ?? "",
      status: "CREATED",
      sourceAccessMode: "FILE_UPLOAD",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: input.createdBy ?? "system",
      sourceFileCount: 0,
      totalSizeBytes: 0,
    };

    return this.repo.saveAnalysis(analysis);
  }

  /** Alias kept for internal use */
  async getAnalysis(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<ModernizationAnalysis | null> {
    return this.repo.findAnalysis(tenantId, projectId, analysisId);
  }

  /** Primary public API – preferred over getAnalysis */
  async findAnalysis(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<ModernizationAnalysis | null> {
    return this.repo.findAnalysis(tenantId, projectId, analysisId);
  }

  async listAnalyses(
    tenantId: string,
    projectId: string,
  ): Promise<ModernizationAnalysis[]> {
    return this.repo.listAnalyses(tenantId, projectId);
  }

  // ── Source attachment ───────────────────────────────────────────────────

  /**
   * Primary public API: record an ingested source bundle against an analysis.
   * Checks for duplicate bundle hash before persisting.
   */
  async recordSourceUpload(
    tenantId: string,
    projectId: string,
    analysisId: string,
    ingestedSource: IngestedSource,
    uploadedBy: string,
  ): Promise<{
    isDuplicate: boolean;
    codeSourceId: string;
  }> {
    return this.attachSource(
      tenantId,
      projectId,
      analysisId,
      ingestedSource,
      ingestedSource.files[0]?.originalName ?? uploadedBy,
    );
  }

  /**
   * Internal implementation – attach an ingested source bundle to an analysis.
   */
  async attachSource(
    tenantId: string,
    projectId: string,
    analysisId: string,
    ingestedSource: IngestedSource,
    originalFileName: string,
  ): Promise<{
    isDuplicate: boolean;
    codeSourceId: string;
  }> {
    const analysis = await this.repo.findAnalysis(
      tenantId,
      projectId,
      analysisId,
    );
    if (!analysis) {
      throw new Error(
        `Analysis ${analysisId} not found in tenant ${tenantId} / project ${projectId}`,
      );
    }

    // Duplicate check
    const existing = await this.repo.findCodeSourceByHash(
      tenantId,
      projectId,
      ingestedSource.bundleHash,
    );
    if (existing) {
      return { isDuplicate: true, codeSourceId: existing.id };
    }

    // Persist code source
    const codeSource = await this.repo.saveCodeSource({
      id: ingestedSource.codeSourceId,
      tenantId,
      projectId,
      analysisId,
      originalFileName,
      bundleHash: ingestedSource.bundleHash,
      totalFiles: ingestedSource.totalFiles,
      totalSizeBytes: ingestedSource.totalSizeBytes,
      ingestionStatus: "COMPLETE",
      ingestionWarnings: ingestedSource.validationSummary.warnings,
      createdAt: new Date().toISOString(),
    });

    // Persist source files
    const fileRecords: SourceFileRecord[] = ingestedSource.files.map((f) => ({
      id: randomUUID(),
      tenantId,
      projectId,
      analysisId,
      codeSourceId: codeSource.id,
      filePath: f.filePath,
      originalName: f.originalName,
      extension: f.extension,
      textContent: f.textContent,
      sizeBytes: f.sizeBytes,
      contentHash: f.contentHash,
      encoding: f.encoding,
      createdAt: new Date().toISOString(),
    }));

    await this.repo.saveSourceFiles(fileRecords);

    // Derive basic custom object stubs from file names
    const customObjects = deriveCustomObjects(
      tenantId,
      projectId,
      analysisId,
      fileRecords,
    );
    if (customObjects.length > 0) {
      await this.repo.saveCustomObjects(customObjects);
    }

    // Update analysis counters
    await this.repo.incrementAnalysisCounters(
      tenantId,
      projectId,
      analysisId,
      1,
      ingestedSource.totalFiles,
      customObjects.length,
    );

    return { isDuplicate: false, codeSourceId: codeSource.id };
  }

  // ── Object listing ──────────────────────────────────────────────────────

  async listCustomObjects(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<CustomObjectRecord[]> {
    return this.repo.listCustomObjects(tenantId, projectId, analysisId);
  }
}

// ── Custom object derivation ──────────────────────────────────────────────

/** Minimal shape accepted by deriveCustomObjects for both test stubs and full SourceFileRecord */
interface PartialSourceFile {
  filePath: string;
  extension: string;
  sizeBytes: number;
  contentHash: string;
  textContent?: string;
  id?: string;
  codeSourceId?: string;
}

/**
 * Derive initial CustomObject stubs from source file paths.
 * Object type is inferred from the file extension alone – no execution.
 * This is a deterministic heuristic, not LLM-based analysis.
 *
 * Parameter order: (tenantId, projectId, analysisId, files) for ergonomic
 * call sites and test compatibility.
 */
export function deriveCustomObjects(
  tenantId: string,
  projectId: string,
  analysisId: string,
  files: PartialSourceFile[],
): CustomObjectRecord[] {
  return files.map((f) => {
    const objectType = extensionToObjectType(f.filePath, f.extension);
    const objectName = deriveObjectName(f.filePath, f.extension);
    return {
      id: randomUUID(),
      tenantId,
      projectId,
      analysisId,
      codeSourceId: f.codeSourceId ?? null,
      sourceFileId: f.id ?? null,
      objectName,
      objectType,
      packageName: null,
      disposition: null,
      cleanCoreRisk: null,
      confidence: null,
      status: "PENDING_ANALYSIS",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

function extensionToObjectType(filePath: string, ext: string): string {
  const lower = filePath.toLowerCase();
  // Compound abapGit-style extensions derived from file path take priority
  if (lower.endsWith(".prog.abap")) return "REPORT";
  if (lower.endsWith(".clas.abap")) return "CLASS";
  if (lower.endsWith(".intf.abap")) return "INTERFACE";
  if (lower.endsWith(".fugr.abap")) return "FUNCTION_GROUP";
  if (lower.endsWith(".doma.abap")) return "DOMAIN";
  if (lower.endsWith(".dtel.abap")) return "DATA_ELEMENT";
  if (lower.endsWith(".tabl.abap")) return "TABLE";
  if (lower.endsWith(".ttyp.abap")) return "TABLE_TYPE";
  if (lower.endsWith(".enhc.abap") || lower.endsWith(".enhf.abap"))
    return "ENHANCEMENT_IMPLEMENTATION";
  if (lower.endsWith(".enhs.abap")) return "ENHANCEMENT_SPOT";
  if (lower.endsWith(".msag.abap")) return "MESSAGE_CLASS";
  if (lower.endsWith(".shlp.abap")) return "SEARCH_HELP";
  // Single extensions
  const map: Record<string, string> = {
    ".asddls": "CDS_VIEW",
    ".asdddls": "CDS_VIEW",
    ".ddls": "CDS_VIEW",
    ".ddlx": "CDS_VIEW",
    ".bdef": "BEHAVIOR_DEFINITION",
    ".xml": "XML_DESCRIPTOR",
    ".json": "JSON_DESCRIPTOR",
    ".csv": "CSV_DATA",
    ".txt": "UNKNOWN",
    ".abap": "UNKNOWN_ABAP",
  };
  return map[ext] ?? "UNKNOWN";
}

function deriveObjectName(filePath: string, ext: string): string {
  const base = filePath
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .toLowerCase();

  // Strip compound extension
  const compoundExts = [
    ".clas.abap",
    ".prog.abap",
    ".intf.abap",
    ".fugr.abap",
    ".doma.abap",
    ".dtel.abap",
    ".tabl.abap",
    ".ttyp.abap",
    ".msag.abap",
    ".shlp.abap",
    ".enhc.abap",
    ".enhs.abap",
    ".enhf.abap",
  ];
  for (const ce of compoundExts) {
    if (base.endsWith(ce)) return base.slice(0, -ce.length).toUpperCase();
  }
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length).toUpperCase();
  }
  return base.toUpperCase();
}
