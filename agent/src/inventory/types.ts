/**
 * N-CoreShift – Phase 5: SAP Object Inventory and Dependency Analysis Types
 *
 * All findings are heuristic-based. Confidence and provenance are stored
 * for every finding. Comments must never produce dependency findings.
 * Technical risk signals are evidence, not Clean Core verdicts.
 *
 * All records are scoped by tenantId and projectId (Principle 18).
 */

// ── SAP Object Types ───────────────────────────────────────────────────────

export const SAP_OBJECT_TYPES = [
  'REPORT',
  'INCLUDE',
  'CLASS',
  'INTERFACE',
  'FUNCTION_MODULE',
  'FUNCTION_GROUP',
  'CDS_VIEW',
  'CDS_BEHAVIOR',
  'ENHANCEMENT_IMPLEMENTATION',
  'BADI_IMPLEMENTATION',
  'BADI_REFERENCE',
  'USER_EXIT',
  'CUSTOMER_EXIT',
  'CUSTOM_TABLE',
  'CUSTOM_VIEW',
  'STANDARD_TABLE_USAGE',
  'API_BAPI_REFERENCE',
  'ODATA_SERVICE',
  'RFC_DESTINATION',
  'HTTP_ENDPOINT',
  'FORM_ROUTINE',
  'OUTPUT_TYPE',
  'UNKNOWN',
] as const;

export type SapObjectType = (typeof SAP_OBJECT_TYPES)[number];

// ── Dependency Types ───────────────────────────────────────────────────────

export const DEPENDENCY_TYPES = [
  'CALL_FUNCTION',
  'CALL_METHOD',
  'CALL_TRANSACTION',
  'PERFORM',
  'INCLUDE',
  'INHERITS_FROM',
  'IMPLEMENTS',
  'SELECT_FROM',
  'INSERT_INTO',
  'UPDATE_TABLE',
  'DELETE_FROM',
  'MODIFY_TABLE',
  'BADI_GET_INSTANCE',
  'ENHANCEMENT_POINT',
  'CUSTOMER_FUNCTION',
  'RFC_CALL',
  'HTTP_CALL',
  'BAPI_CALL',
  'ODATA_REFERENCE',
  'AUTHORITY_CHECK',
  'CREATE_OBJECT',
  'FIELD_SYMBOL_CAST',
  'DYNAMIC_SQL',
  'NATIVE_SQL',
  'UNKNOWN_DEPENDENCY',
] as const;

export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

// ── Technical Risk Signals ─────────────────────────────────────────────────
// These are evidence signals, NOT automatic Clean Core verdicts.

export const TECHNICAL_RISK_SIGNALS = [
  'DIRECT_TABLE_ACCESS',
  'SAP_OWNED_TABLE_MODIFICATION',
  'NATIVE_SQL',
  'DYNAMIC_SQL',
  'CALL_TRANSACTION',
  'CLASSIC_ENHANCEMENT_PATTERN',
  'HARD_CODED_CLIENT',
  'HARD_CODED_SYSTEM',
  'EXTERNAL_RFC_DEPENDENCY',
  'EXTERNAL_HTTP_CALL',
  'UNRELEASED_SAP_OBJECT_USAGE',
  'DIRECT_TABLE_UPDATE_BYPASSING_BAPI',
  'OBSOLETE_STATEMENT',
  'UNRESOLVED_STANDARD_DEPENDENCY',
] as const;

export type TechnicalRiskSignal = (typeof TECHNICAL_RISK_SIGNALS)[number];

// ── Evidence / Confidence ──────────────────────────────────────────────────

export const FINDING_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW', 'UNCERTAIN'] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCE)[number];

export const PROVENANCE_TYPES = [
  'FILENAME_PATTERN',
  'KEYWORD_PATTERN',
  'CONTENT_HEURISTIC',
  'ABAPGIT_MANIFEST',
  'MANUAL',
] as const;
export type ProvenanceType = (typeof PROVENANCE_TYPES)[number];

// ── Core Domain Types ──────────────────────────────────────────────────────

/**
 * A parsed/detected SAP object from ingested source code.
 * Heuristic findings: confidence and provenance are always stored.
 */
export interface ObjectInventoryEntry {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  sourceFileId: string;

  // Object identity
  objectName: string;
  objectType: SapObjectType;
  packageName?: string;
  programName?: string;
  parentObject?: string; // e.g. function group for function modules

  // Classification evidence
  confidence: FindingConfidence;
  provenance: ProvenanceType;
  evidenceLocation: string; // "filename" | "line N" | "line N-M"
  rawKeywordMatches: string[]; // keywords that triggered classification

  // Description derived from source (heuristic, not AI)
  detectedDescription?: string;

  // Technical risk signals detected in this object (evidence only)
  technicalRiskSignals: TechnicalRiskSignal[];

  // Line counts (informational)
  lineCount?: number;
  codeLineCount?: number; // excluding blanks + comments

  createdAt: Date;
}

/**
 * A directed dependency edge between two objects.
 * Source and target are object names (not IDs) for portability.
 */
export interface DependencyEdge {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;

  sourceObject: string;
  targetObject: string;
  dependencyType: DependencyType;
  evidenceLocation: string; // "line N" or "line N-M"
  rawText: string; // exact text that produced this finding (max 256 chars)
  confidence: FindingConfidence;
}

/**
 * A technical risk signal occurrence with location evidence.
 */
export interface RiskSignalOccurrence {
  signal: TechnicalRiskSignal;
  objectName: string;
  evidenceLocation: string;
  rawText: string; // max 256 chars
  confidence: FindingConfidence;
  note: string; // human-readable description of the risk
}

/**
 * Result of parsing a single source file.
 */
export interface ParsedSourceFile {
  sourceFileId: string;
  fileName: string;
  objectName: string;
  objectType: SapObjectType;
  confidence: FindingConfidence;
  provenance: ProvenanceType;
  dependencies: Omit<DependencyEdge, 'id' | 'tenantId' | 'projectId' | 'analysisId'>[];
  riskSignals: RiskSignalOccurrence[];
  lineCount: number;
  codeLineCount: number;
  rawKeywordMatches: string[];
  detectedDescription?: string;
  parentObject?: string;
  programName?: string;
  packageName?: string;
}

/**
 * Aggregated result of inventorying an entire analysis package.
 */
export interface InventoryResult {
  analysisId: string;
  tenantId: string;
  projectId: string;
  objectCount: number;
  dependencyCount: number;
  riskSignalCount: number;
  objectsByType: Record<string, number>;
  riskSignalsByType: Record<string, number>;
  objectsWithHighRisk: number;
  unresolvedDependencies: number;
  parsingWarnings: string[];
  completedAt: Date;
}

// ── Parser Inputs ──────────────────────────────────────────────────────────

/**
 * Minimal source file input to the parser – avoids coupling to Phase 4 types.
 */
export interface SourceFileInput {
  id: string;
  fileName: string;
  content: string; // decoded text content
  filePath?: string;
}
