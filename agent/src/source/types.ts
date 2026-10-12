/**
 * N-CoreShift – Phase 4: Source Ingestion Domain Types
 *
 * Defines ModernizationAnalysis, CodeSource, SourceFile, and CustomObject
 * plus all supporting enums and interfaces.
 *
 * All records are scoped by tenantId and projectId (Principle 18).
 * Uploaded content is treated as untrusted data (Principle 17).
 */

// ── Analysis Status ──────────────────────────────────────────────────────

export type AnalysisStatus =
  | 'CREATED'
  | 'DRAFT'
  | 'INGESTING'
  | 'INGESTION_COMPLETE'
  | 'INGESTION_FAILED'
  | 'ANALYSIS_PENDING'
  | 'ANALYZING'
  | 'ANALYSIS_COMPLETE'
  | 'ANALYSIS_FAILED';

export const VALID_ANALYSIS_STATUSES: AnalysisStatus[] = [
  'CREATED',
  'DRAFT',
  'INGESTING',
  'INGESTION_COMPLETE',
  'INGESTION_FAILED',
  'ANALYSIS_PENDING',
  'ANALYZING',
  'ANALYSIS_COMPLETE',
  'ANALYSIS_FAILED',
];

// ── Source Access Mode ────────────────────────────────────────────────────

export type SourceAccessMode =
  | 'FILE_UPLOAD'
  | 'ABAPGIT_BUNDLE'
  | 'CONNECTED_SYSTEM'
  | 'IMPORTED_REPORT';

// ── File Validation Result ────────────────────────────────────────────────

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Normalised extension, e.g. '.abap' */
  detectedExtension: string;
  /** Bytes */
  sizeBytes: number;
  /** SHA-256 hex of the raw buffer */
  contentHash: string;
  /** Whether the file is a ZIP archive */
  isZip: boolean;
}

// ── Source File (in-memory, pre-persist) ─────────────────────────────────

export interface InMemorySourceFile {
  /** Sanitised path within the upload / archive */
  filePath: string;
  /** Original filename before sanitisation */
  originalName: string;
  extension: string;
  /** UTF-8 text content – never binary */
  textContent: string;
  sizeBytes: number;
  contentHash: string;
  encoding: string;
}

// ── Ingestion Job Input ───────────────────────────────────────────────────

export interface IngestionJobInput {
  tenantId: string;
  projectId: string;
  analysisId: string;
  /** Original uploaded filename */
  fileName: string;
  /** Raw buffer */
  buffer: Buffer;
  /** Uploader identity */
  uploadedBy: string;
}

// ── Ingestion Job Result ──────────────────────────────────────────────────

export interface IngestionJobResult {
  analysisId: string;
  filesAccepted: number;
  filesRejected: number;
  totalSizeBytes: number;
  rejectedFiles: Array<{ path: string; reason: string }>;
  codeSourceId: string;
  status: AnalysisStatus;
  errors: string[];
}

// ── CodeSourceProvider contract ───────────────────────────────────────────

export interface IngestedSource {
  codeSourceId: string;
  files: InMemorySourceFile[];
  validationSummary: FileValidationResult;
  totalFiles: number;
  totalSizeBytes: number;
  /** SHA-256 of the whole upload (buffer hash) */
  bundleHash: string;
}

export interface CodeSourceProviderContract {
  /**
   * Validate and extract source files from the given buffer.
   * Never executes any content.
   */
  ingest(input: IngestionJobInput): Promise<IngestedSource>;

  /** Returns the display name of this provider. */
  providerName(): string;

  /** Returns supported extension list. */
  supportedExtensions(): string[];
}

// ── ModernizationAnalysis (domain record) ────────────────────────────────

export interface ModernizationAnalysis {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  description?: string;
  status: AnalysisStatus;
  sourceAccessMode: SourceAccessMode;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Number of source files ingested */
  sourceFileCount: number;
  /** Total ingested bytes */
  totalSizeBytes: number;
  /** Background job id when large package processing */
  backgroundJobId?: string;
}

// ── CodeSource (domain record) ────────────────────────────────────────────

export interface CodeSource {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  originalFileName: string;
  bundleHash: string;
  /** Total number of files extracted */
  fileCount: number;
  totalSizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED';
}

// ── SourceFile (domain record) ────────────────────────────────────────────

export interface SourceFile {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  codeSourceId: string;
  filePath: string;
  originalName: string;
  extension: string;
  /** SHA-256 of text content */
  contentHash: string;
  sizeBytes: number;
  /** UTF-8 text stored here for analysis */
  textContent: string;
  encoding: string;
  createdAt: string;
}

// ── CustomObject (domain record) ──────────────────────────────────────────

export type CustomObjectType =
  | 'REPORT'
  | 'INCLUDE'
  | 'CLASS'
  | 'INTERFACE'
  | 'FUNCTION_MODULE'
  | 'FUNCTION_GROUP'
  | 'CDS_ARTIFACT'
  | 'ENHANCEMENT_IMPLEMENTATION'
  | 'BADI_IMPLEMENTATION'
  | 'EXIT_REFERENCE'
  | 'CUSTOM_TABLE'
  | 'CUSTOM_VIEW'
  | 'FORM_ROUTINE'
  | 'OUTPUT_ARTIFACT'
  | 'UNKNOWN';

export interface CustomObject {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  sourceFileId: string;
  objectName: string;
  objectType: CustomObjectType;
  packageName?: string;
  /** Namespace, e.g. Z*, Y*, /CUST/ */
  namespace?: string;
  /** Confidence that the type detection is correct */
  typeConfidence: number;
  detectionProvenance: string;
  createdAt: string;
}

// ── Analysis creation input ───────────────────────────────────────────────

export interface CreateAnalysisInput {
  tenantId: string;
  projectId: string;
  name: string;
  description?: string;
  createdBy: string;
}

// ── CustomObjectRecord ────────────────────────────────────────────────────
// Persistence-layer record that extends CustomObject with extra fields
// used by the ModernizationAnalysisService before full ABAP parsing.

export interface CustomObjectRecord {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  codeSourceId: string | null;
  sourceFileId: string | null;
  objectName: string;
  /** String type – before categorisation may be a raw extension-derived label */
  objectType: string;
  packageName: string | null;
  disposition: string | null;
  cleanCoreRisk: string | null;
  confidence: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ── CodeSourceRecord ──────────────────────────────────────────────────────
// Persistence input record used by AnalysisRepository.saveCodeSource.

export interface CodeSourceRecord {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  originalFileName: string;
  bundleHash: string;
  totalFiles: number;
  totalSizeBytes: number;
  ingestionStatus: string;
  ingestionWarnings: string[];
  createdAt: string;
}

// ── SourceFileRecord ──────────────────────────────────────────────────────

export interface SourceFileRecord {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  codeSourceId: string;
  filePath: string;
  originalName: string;
  extension: string;
  textContent: string;
  sizeBytes: number;
  contentHash: string;
  encoding: string;
  createdAt: string;
}

// ── AnalysisRepository ────────────────────────────────────────────────────
// Repository contract for ModernizationAnalysisService.
// Implementations may use SQLite (dev) or HANA Cloud (production).

export interface AnalysisRepository {
  // Analysis
  saveAnalysis(analysis: ModernizationAnalysis): Promise<ModernizationAnalysis>;
  findAnalysis(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<ModernizationAnalysis | null>;
  listAnalyses(
    tenantId: string,
    projectId: string,
  ): Promise<ModernizationAnalysis[]>;
  incrementAnalysisCounters(
    tenantId: string,
    projectId: string,
    analysisId: string,
    sourceDelta: number,
    fileDelta: number,
    objectDelta: number,
  ): Promise<void>;

  // CodeSource
  saveCodeSource(record: CodeSourceRecord): Promise<CodeSourceRecord>;
  findCodeSourceByHash(
    tenantId: string,
    projectId: string,
    bundleHash: string,
  ): Promise<CodeSourceRecord | null>;

  // SourceFile
  saveSourceFiles(records: SourceFileRecord[]): Promise<void>;

  // CustomObject
  saveCustomObjects(records: CustomObjectRecord[]): Promise<void>;
  listCustomObjects(
    tenantId: string,
    projectId: string,
    analysisId: string,
  ): Promise<CustomObjectRecord[]>;
}
