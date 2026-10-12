/**
 * N-CoreShift – Phase 5: Heuristic ABAP Source Parser
 *
 * Security boundary: Comments are stripped BEFORE any pattern matching.
 * Treats all uploaded content as untrusted data (Principle 17).
 * This parser uses heuristics, NOT a full ABAP grammar.
 * All findings store confidence and provenance.
 */
import type {
  DependencyType,
  FindingConfidence,
  ParsedSourceFile,
  ProvenanceType,
  RiskSignalOccurrence,
  SapObjectType,
  SourceFileInput,
  TechnicalRiskSignal,
} from './types.js';

// ── Comment Stripping (security boundary) ─────────────────────────────────

const FULL_LINE_COMMENT = /^\s*\*/;
const INLINE_COMMENT = /".*$/;

function stripAbapComments(line: string): string {
  if (FULL_LINE_COMMENT.test(line)) return '';
  return line.replace(INLINE_COMMENT, '').trim();
}

// ── Filename Classification ────────────────────────────────────────────────

function nameFromFile(fileName: string): string {
  return (fileName.replace(/\\/g, '/').split('/').pop() ?? fileName).split('.')[0].toUpperCase();
}

function baseName(fileName: string): string {
  return (fileName.replace(/\\/g, '/').split('/').pop() ?? fileName).toLowerCase();
}

export function classifyFromFilename(fileName: string): {
  objectType: SapObjectType;
  objectName: string;
  confidence: FindingConfidence;
  provenance: ProvenanceType;
} {
  const b = baseName(fileName);
  const n = nameFromFile(fileName);
  const fp: ProvenanceType = 'FILENAME_PATTERN';
  if (b.endsWith('.clas.abap')) return { objectType: 'CLASS', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.intf.abap')) return { objectType: 'INTERFACE', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.prog.abap')) return { objectType: 'REPORT', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.incl.abap')) return { objectType: 'INCLUDE', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.fugr.abap')) return { objectType: 'FUNCTION_GROUP', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.func.abap')) return { objectType: 'FUNCTION_MODULE', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.ddls.asddls') || b.endsWith('.cds'))
    return { objectType: 'CDS_VIEW', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.enho.abap') || b.endsWith('.enho.xml'))
    return { objectType: 'ENHANCEMENT_IMPLEMENTATION', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.tabl.xml') || b.endsWith('.tabl.abap'))
    return { objectType: 'CUSTOM_TABLE', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.view.xml'))
    return { objectType: 'CUSTOM_VIEW', objectName: n, confidence: 'MEDIUM', provenance: fp };
  if (b.endsWith('.abap'))
    return { objectType: 'UNKNOWN', objectName: n, confidence: 'LOW', provenance: fp };
  return { objectType: 'UNKNOWN', objectName: n, confidence: 'UNCERTAIN', provenance: fp };
}

// ── Content-based Type Refinement ─────────────────────────────────────────

const OBJECT_KW_PATTERNS: Array<{ re: RegExp; type: SapObjectType; kw: string }> = [
  { re: /^REPORT\s+\w+/im, type: 'REPORT', kw: 'REPORT' },
  { re: /^PROGRAM\s+\w+/im, type: 'REPORT', kw: 'PROGRAM' },
  { re: /^CLASS\s+\w+\s+DEFINITION/im, type: 'CLASS', kw: 'CLASS DEFINITION' },
  { re: /^INTERFACE\s+\w+\s*\./im, type: 'INTERFACE', kw: 'INTERFACE' },
  { re: /^FUNCTION-POOL\s+\w+/im, type: 'FUNCTION_GROUP', kw: 'FUNCTION-POOL' },
  { re: /^FUNCTION\s+\w+\s*\./im, type: 'FUNCTION_MODULE', kw: 'FUNCTION' },
  { re: /\bENHANCEMENT-IMPLEMENTATION\s+\w+/im, type: 'ENHANCEMENT_IMPLEMENTATION', kw: 'ENHANCEMENT-IMPLEMENTATION' },
  { re: /\bGET\s+BADI\s+\w+/im, type: 'BADI_REFERENCE', kw: 'GET BADI' },
  { re: /^DEFINE\s+VIEW\s+\w+/im, type: 'CDS_VIEW', kw: 'DEFINE VIEW' },
  { re: /\bCUSTOMER-FUNCTION\b/im, type: 'CUSTOMER_EXIT', kw: 'CUSTOMER-FUNCTION' },
];

/**
 * Refines object type from executable source lines (comments already stripped).
 * Exported for unit testing.
 */
export function refineObjectTypeFromContent(
  lines: string[],
  current: SapObjectType,
): {
  objectType: SapObjectType;
  confidence: FindingConfidence;
  keywords: string[];
  provenance: ProvenanceType;
} {
  const code = lines.join('\n');
  const found: string[] = [];
  let refined = current;
  for (const e of OBJECT_KW_PATTERNS) {
    if (e.re.test(code)) {
      found.push(e.kw);
      if (refined === 'UNKNOWN') refined = e.type;
    }
  }
  if (found.length > 0)
    return { objectType: refined, confidence: 'HIGH', keywords: found, provenance: 'KEYWORD_PATTERN' };
  if (current !== 'UNKNOWN')
    return { objectType: current, confidence: 'MEDIUM', keywords: [], provenance: 'FILENAME_PATTERN' };
  return { objectType: 'UNKNOWN', confidence: 'LOW', keywords: [], provenance: 'CONTENT_HEURISTIC' };
}

// ── Dependency Patterns ────────────────────────────────────────────────────

interface DepPattern {
  re: RegExp;
  type: DependencyType;
  extract: (m: RegExpMatchArray) => string;
  conf: FindingConfidence;
}

const DEP_PATTERNS: DepPattern[] = [
  { re: /\bCALL\s+FUNCTION\s+'([^']+)'/gi, type: 'CALL_FUNCTION', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bCALL\s+TRANSACTION\s+'?(\w+)'?/gi, type: 'CALL_TRANSACTION', extract: (m) => m[1], conf: 'HIGH' },
  {
    re: /\bPERFORM\s+(\w+)(?:\s+IN\s+PROGRAM\s+(\w+))?/gi,
    type: 'PERFORM',
    extract: (m) => (m[2] ? `${m[1]}@${m[2]}` : m[1]),
    conf: 'HIGH',
  },
  { re: /\bINCLUDE\s+(\w+)\s*\./gi, type: 'INCLUDE', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bINHERITING\s+FROM\s+(\w+)/gi, type: 'INHERITS_FROM', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bINTERFACES\s+(\w+)\s*\./gi, type: 'IMPLEMENTS', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bFROM\s+([A-Z_]\w+)\b/gi, type: 'SELECT_FROM', extract: (m) => m[1], conf: 'MEDIUM' },
  { re: /\bINSERT\s+([A-Z_]\w+)\s+FROM\b/gi, type: 'INSERT_INTO', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bINSERT\s+INTO\s+([A-Z_]\w+)\b/gi, type: 'INSERT_INTO', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bUPDATE\s+([A-Z_]\w+)\s+SET\b/gi, type: 'UPDATE_TABLE', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bDELETE\s+FROM\s+([A-Z_]\w+)\b/gi, type: 'DELETE_FROM', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bMODIFY\s+([A-Z_]\w+)\s+FROM\b/gi, type: 'MODIFY_TABLE', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bGET\s+BADI\s+(\w+)/gi, type: 'BADI_GET_INSTANCE', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bCREATE\s+OBJECT\s+(\w+)/gi, type: 'CREATE_OBJECT', extract: (m) => m[1], conf: 'MEDIUM' },
  { re: /\bAUTHORITY-CHECK\s+OBJECT\s+'([^']+)'/gi, type: 'AUTHORITY_CHECK', extract: (m) => m[1], conf: 'HIGH' },
  { re: /\bCALL\s+METHOD\s+(\w+(?:->|=>)\w+)/gi, type: 'CALL_METHOD', extract: (m) => m[1], conf: 'MEDIUM' },
];

// ── Risk Signal Patterns ───────────────────────────────────────────────────

interface RiskPattern {
  re: RegExp;
  signal: TechnicalRiskSignal;
  note: string;
  conf: FindingConfidence;
}

const RISK_PATTERNS: RiskPattern[] = [
  {
    re: /\bEXEC\s+SQL\b/gi,
    signal: 'NATIVE_SQL',
    note: 'Native SQL (EXEC SQL) bypasses ABAP database abstraction layer',
    conf: 'HIGH',
  },
  {
    re: /\bADBC_\w+\b|\bnative\s+sql\b/gi,
    signal: 'NATIVE_SQL',
    note: 'ADBC native SQL call detected',
    conf: 'HIGH',
  },
  {
    re: /\bDYNAMIC\s+SELECTIONS?\b|\bDYNAMIC\s+WHERE\b|\(lv_tabname\)|\(lv_table\)/gi,
    signal: 'DYNAMIC_SQL',
    note: 'Dynamic SQL or dynamic table reference detected',
    conf: 'MEDIUM',
  },
  {
    re: /\bCALL\s+TRANSACTION\b/gi,
    signal: 'CALL_TRANSACTION',
    note: 'CALL TRANSACTION - hard-codes transaction flow, not suitable for Clean Core',
    conf: 'HIGH',
  },
  {
    re: /\bUPDATE\s+[A-Z_]\w+\s+SET\b/gi,
    signal: 'SAP_OWNED_TABLE_MODIFICATION',
    note: 'Direct UPDATE to a database table - may bypass SAP data model',
    conf: 'MEDIUM',
  },
  {
    re: /\bMODIFY\s+[A-Z_]\w+\s+FROM\b/gi,
    signal: 'SAP_OWNED_TABLE_MODIFICATION',
    note: 'Direct MODIFY to a database table - may bypass SAP data model',
    conf: 'MEDIUM',
  },
  {
    re: /\bINSERT\s+(?:INTO\s+)?[A-Z_]\w+(?:\s+FROM|\s+VALUES)/gi,
    signal: 'DIRECT_TABLE_UPDATE_BYPASSING_BAPI',
    note: 'Direct INSERT to database table without BAPI/API',
    conf: 'MEDIUM',
  },
  {
    re: /\bDESTINATION\s+'[^']+'/gi,
    signal: 'EXTERNAL_RFC_DEPENDENCY',
    note: 'RFC DESTINATION - external system call creates tight coupling',
    conf: 'HIGH',
  },
  {
    re: /\bCALL\s+FUNCTION\s+'[^']+'\s*\n?\s*DESTINATION\b/gi,
    signal: 'EXTERNAL_RFC_DEPENDENCY',
    note: 'RFC call with DESTINATION to external system',
    conf: 'HIGH',
  },
  {
    re: /\bCL_HTTP_CLIENT\b|\bIF_HTTP_CLIENT\b|\bHTTP_POST\b|\bHTTP_GET\b/gi,
    signal: 'EXTERNAL_HTTP_CALL',
    note: 'HTTP client usage - external web service call',
    conf: 'HIGH',
  },
  {
    re: /\bCUSTOMER-FUNCTION\s+'[^']+'/gi,
    signal: 'CLASSIC_ENHANCEMENT_PATTERN',
    note: 'CUSTOMER-FUNCTION - classic user exit pattern, not Clean Core compatible',
    conf: 'HIGH',
  },
  {
    re: /\bEXIT\.\s*$/gim,
    signal: 'CLASSIC_ENHANCEMENT_PATTERN',
    note: 'EXIT statement - classic exit pattern',
    conf: 'MEDIUM',
  },
  {
    re: /\bENHANCEMENT\s+\d+\s+\w+/gi,
    signal: 'CLASSIC_ENHANCEMENT_PATTERN',
    note: 'Implicit enhancement spot usage',
    conf: 'MEDIUM',
  },
  {
    re: /\bSY-MANDT\b/gi,
    signal: 'HARD_CODED_CLIENT',
    note: 'SY-MANDT reference - client assumption, may not work in multi-client scenarios',
    conf: 'MEDIUM',
  },
  {
    re: /\bCLIENT\s*=\s*'[0-9]{3}'/gi,
    signal: 'HARD_CODED_CLIENT',
    note: 'Hard-coded client number detected',
    conf: 'HIGH',
  },
  {
    re: /\bSY-SYSID\b|\bSY-HOST\b/gi,
    signal: 'HARD_CODED_SYSTEM',
    note: 'System ID or host reference - system assumption',
    conf: 'MEDIUM',
  },
  {
    re: /\bSELECT\s+\*?\s+FROM\s+[A-Z_]\w+\s+(?:WHERE|INTO)/gi,
    signal: 'DIRECT_TABLE_ACCESS',
    note: 'Direct table SELECT - dependency on SAP internal table structure',
    conf: 'LOW',
  },
];

// ── Main Parse Function ────────────────────────────────────────────────────

/**
 * Parse a single source file and return structured findings.
 * Comments are stripped before any pattern matching (security boundary).
 * All findings store confidence and provenance - never silently assume HIGH confidence.
 */
export function parseSourceFile(input: SourceFileInput): ParsedSourceFile {
  const rawLines = input.content.split('\n');
  const cleanLines = rawLines.map(stripAbapComments).filter((l) => l.length > 0);

  // Classify from filename first
  const fileClass = classifyFromFilename(input.fileName);

  // Refine from content (operates only on comment-stripped lines)
  const contentClass = refineObjectTypeFromContent(cleanLines, fileClass.objectType);

  const finalObjectType = contentClass.objectType;
  const finalConfidence: FindingConfidence =
    contentClass.confidence === 'HIGH' ? 'HIGH' : fileClass.confidence;

  // Extract dependencies (only on clean lines)
  const cleanCode = cleanLines.join('\n');
  const dependencies: ParsedSourceFile['dependencies'] = [];
  const seenDeps = new Set<string>();

  for (const pat of DEP_PATTERNS) {
    pat.re.lastIndex = 0;
    let m: RegExpMatchArray | null;
    while ((m = pat.re.exec(cleanCode)) !== null) {
      const target = pat.extract(m).toUpperCase();
      if (!target || target.length < 2) continue;
      const key = `${pat.type}:${target}`;
      if (seenDeps.has(key)) continue;
      seenDeps.add(key);
      // Find line number in original (not clean) content
      const lineIdx = rawLines.findIndex((l) => stripAbapComments(l).includes(m![0].split('\n')[0]));
      const evidenceLocation = lineIdx >= 0 ? `${input.fileName} line ${lineIdx + 1}` : input.fileName;
      dependencies.push({
        sourceObject: fileClass.objectName,
        targetObject: target,
        dependencyType: pat.type,
        evidenceLocation,
        rawText: m[0].substring(0, 256),
        confidence: pat.conf,
      });
    }
  }

  // Detect risk signals (only on clean lines)
  const riskSignals: RiskSignalOccurrence[] = [];
  const seenRisks = new Set<string>();

  for (const pat of RISK_PATTERNS) {
    pat.re.lastIndex = 0;
    let m: RegExpMatchArray | null;
    while ((m = pat.re.exec(cleanCode)) !== null) {
      const key = `${pat.signal}:${m[0].substring(0, 40)}`;
      if (seenRisks.has(key)) continue;
      seenRisks.add(key);
      const lineIdx = rawLines.findIndex((l) => stripAbapComments(l).includes(m![0].split('\n')[0].trim()));
      const evidenceLocation = lineIdx >= 0 ? `${input.fileName} line ${lineIdx + 1}` : input.fileName;
      riskSignals.push({
        signal: pat.signal,
        objectName: fileClass.objectName,
        note: pat.note,
        evidenceLocation,
        rawText: m[0].substring(0, 256),
        confidence: pat.conf,
      });
    }
  }

  return {
    sourceFileId: input.id,
    objectName: fileClass.objectName,
    objectType: finalObjectType,
    fileName: input.fileName,
    confidence: finalConfidence,
    provenance: contentClass.provenance,
    rawKeywordMatches: contentClass.keywords,
    dependencies,
    riskSignals,
    lineCount: rawLines[rawLines.length - 1] === '' ? rawLines.length - 1 : rawLines.length,
    codeLineCount: cleanLines.length,
  };
}
