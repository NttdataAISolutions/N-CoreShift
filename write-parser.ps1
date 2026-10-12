$content = @'
/**
 * N-CoreShift - Phase 5: Heuristic ABAP Source Parser
 * Security: comments stripped BEFORE pattern matching (Principle 17).
 * Uses heuristics, NOT a full ABAP grammar. Stores confidence+provenance.
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

const FULL_LINE_COMMENT = /^\s*\*/;
const INLINE_COMMENT = /".*$/;

function stripAbapComments(line: string): string {
  if (FULL_LINE_COMMENT.test(line)) return '';
  return line.replace(INLINE_COMMENT, '').trim();
}

function nameFromFile(fileName: string): string {
  return (fileName.replace(/\\/g, '/').split('/').pop() ?? fileName).split('.')[0].toUpperCase();
}
function baseName(fileName: string): string {
  return (fileName.replace(/\\/g, '/').split('/').pop() ?? fileName).toLowerCase();
}

export function classifyFromFilename(fileName: string): {
  objectType: SapObjectType; objectName: string; confidence: FindingConfidence; provenance: ProvenanceType;
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
  if (b.endsWith('.ddls.asddls') || b.endsWith('.cds')) return { objectType: 'CDS_VIEW', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.enho.abap') || b.endsWith('.enho.xml')) return { objectType: 'ENHANCEMENT_IMPLEMENTATION', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.tabl.xml') || b.endsWith('.tabl.abap')) return { objectType: 'CUSTOM_TABLE', objectName: n, confidence: 'HIGH', provenance: fp };
  if (b.endsWith('.view.xml')) return { objectType: 'CUSTOM_VIEW', objectName: n, confidence: 'MEDIUM', provenance: fp };
  if (b.endsWith('.abap')) return { objectType: 'UNKNOWN', objectName: n, confidence: 'LOW', provenance: fp };
  return { objectType: 'UNKNOWN', objectName: n, confidence: 'UNCERTAIN', provenance: fp };
}

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

export function refineObjectTypeFromContent(
  code: string, current: SapObjectType,
): { objectType: SapObjectType; confidence: FindingConfidence; keywords: string[]; provenance: ProvenanceType } {
  const found: string[] = [];
  let refined = current;
  for (const e of OBJECT_KW_PATTERNS) {
    if (e.re.test(code)) { found.push(e.kw); if (refined === 'UNKNOWN') refined = e.type; }
  }
  if (found.length > 0) return { objectType: refined, confidence: 'HIGH', keywords: found, provenance: 'KEYWORD_PATTERN' };
  if (current !== 'UNKNOWN') return { objectType: current, confidence: 'MEDIUM', keywords: [], provenance: 'FILENAME_PATTERN' };
  return { objectType: 'UNKNOWN', confidence: 'LOW', keywords: [], provenance: 'CONTENT_HEURISTIC' };
}

const DEP_PATTERNS: Array<{ re: RegExp; type: DependencyType; extract: (m: RegExpMatchArray) => string; conf: FindingConfidence; }> = [
  { re: /\bCALL\s+FUNCTION\s+'([^']+)'/gi, type: 'CALL_FUNCTION', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bCALL\s+TRANSACTION\s+'?(\w+)'?/gi, type: 'CALL_TRANSACTION', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bPERFORM\s+(\w+)(?:\s+IN\s+PROGRAM\s+(\w+))?/gi, type: 'PERFORM', extract: (m) => (m[2] ? `${m[1]!}@${m[2]}` : m[1]!), conf: 'HIGH' },
  { re: /\bINCLUDE\s+(\w+)\s*\./gi, type: 'INCLUDE', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bINHERITING\s+FROM\s+(\w+)/gi, type: 'INHERITS_FROM', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bINTERFACES\s+(\w+)\s*\./gi, type: 'IMPLEMENTS', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bFROM\s+([A-Z]\w+)\b/gi, type: 'SELECT_FROM', extract: (m) => m[1]!, conf: 'MEDIUM' },
  { re: /\bINSERT\s+(\w+)\s+FROM\b/gi, type: 'INSERT_INTO', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bINSERT\s+INTO\s+(\w+)\b/gi, type: 'INSERT_INTO', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bUPDATE\s+(\w+)\s+SET\b/gi, type: 'UPDATE_TABLE', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bDELETE\s+FROM\s+(\w+)\b/gi, type: 'DELETE_FROM', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bMODIFY\s+(\w+)\s+FROM\b/gi, type: 'MODIFY_TABLE', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bGET\s+BADI\s+(\w+)/gi, type: 'BADI_GET_INSTANCE', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bAUTHORITY-CHECK\s+OBJECT\s+'([^']+)'/gi, type: 'AUTHORITY_CHECK', extract: (m) => m[1]!, conf: 'HIGH' },
  { re: /\bCREATE\s+OBJECT\s+(\w+)/gi, type: 'CREATE_OBJECT', extract: (m) => m[1]!, conf: 'MEDIUM' },
];

const RISK_PATTERNS: Array<{ re: RegExp; signal: TechnicalRiskSignal; note: string; conf: FindingConfidence; }> = [
  { re: /\bEXEC\s+SQL\b/gi, signal: 'NATIVE_SQL', note: 'Native SQL (EXEC SQL) detected', conf: 'HIGH' },
  { re: /\bDYNAMIC\s+SQL\b/gi, signal: 'DYNAMIC_SQL', note: 'Dynamic SQL pattern detected', conf: 'MEDIUM' },
  { re: /\bCALL\s+TRANSACTION\b/gi, signal: 'CALL_TRANSACTION', note: 'CALL TRANSACTION detected', conf: 'HIGH' },
  { re: /\bUPDATE\s+\w+\s+SET\b/gi, signal: 'SAP_OWNED_TABLE_MODIFICATION', note: 'Direct UPDATE - verify if SAP-owned', conf: 'MEDIUM' },
  { re: /\bMODIFY\s+\w+\s+FROM\b/gi, signal: 'SAP_OWNED_TABLE_MODIFICATION', note: 'Direct MODIFY - verify if SAP-owned', conf: 'MEDIUM' },
  { re: /\bSELECT\b.*\bFROM\s+[A-Z]\w+\b/gi, signal: 'DIRECT_TABLE_ACCESS', note: 'Direct SELECT - verify if released', conf: 'LOW' },
  { re: /\bSY-MANDT\b/gi, signal: 'HARD_CODED_CLIENT', note: 'SY-MANDT reference detected', conf: 'HIGH' },
  { re: /\bSY-SYSID\b/gi, signal: 'HARD_CODED_SYSTEM', note: 'SY-SYSID reference detected', conf: 'MEDIUM' },
  { re: /\bCALL\s+FUNCTION\b.*\bDESTINATION\b/gi, signal: 'EXTERNAL_RFC_DEPENDENCY', note: 'RFC with DESTINATION - external RFC call', conf: 'HIGH' },
  { re: /\bCL_HTTP_CLIENT\b/gi, signal: 'EXTERNAL_HTTP_CALL', note: 'HTTP client usage detected', conf: 'HIGH' },
  { re: /\bCUSTOMER-FUNCTION\b|\bUSER-EXIT\b/gi, signal: 'CLASSIC_ENHANCEMENT_PATTERN', note: 'Classic exit pattern detected', conf: 'HIGH' },
];

function looksLikeSapOwnedTable(name: string): boolean {
  const u = name.toUpperCase();
  if (u.startsWith('Z') || u.startsWith('Y') || u.startsWith('/')) return false;
  return u.length >= 2;
}

function countLines(lines: string[]): { lineCount: number; codeLineCount: number } {
  return {
    lineCount: lines.length,
    codeLineCount: lines.filter((l) => stripAbapComments(l).length > 0).length,
  };
}

export function parseSourceFile(input: SourceFileInput): ParsedSourceFile {
  const { id, fileName, content } = input;
  const rawLines = content.split(/\r?\n/);
  const { lineCount, codeLineCount } = countLines(rawLines);

  const fc = classifyFromFilename(fileName);

  // Security boundary: strip comments before pattern matching
  const executableLines = rawLines.map(stripAbapComments).filter((l) => l.length > 0);
  const executableCode = executableLines.join('\n');

  const refined = refineObjectTypeFromContent(executableCode, fc.objectType);

  // Detect dependencies
  const dependencySeen = new Set<string>();
  const dependencies: ParsedSourceFile['dependencies'] = [];
  for (const pat of DEP_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(executableCode)) !== null) {
      const target = pat.extract(m).toUpperCase();
      if (!target || target.length < 2) continue;
      const key = `${pat.type}::${target}`;
      if (dependencySeen.has(key)) continue;
      dependencySeen.add(key);
      const rawText = (m[0] ?? '').substring(0, 256);
      // Flag SAP-owned table modifications
      let effectiveSignal: TechnicalRiskSignal | undefined;
      if (
        (pat.type === 'UPDATE_TABLE' || pat.type === 'INSERT_INTO' || pat.type === 'MODIFY_TABLE' || pat.type === 'DELETE_FROM') &&
        looksLikeSapOwnedTable(target)
      ) {
        effectiveSignal = 'SAP_OWNED_TABLE_MODIFICATION';
      }
      dependencies.push({
        sourceObject: refined.objectType !== 'UNKNOWN' ? fc.objectName : id,
        targetObject: target,
        dependencyType: pat.type,
        evidenceLocation: fileName,
        confidence: pat.conf,
        rawText,
        technicalRiskSignal: effectiveSignal,
        provenance: 'KEYWORD_PATTERN',
      });
    }
  }

  // Detect risk signals
  const riskSignals: RiskSignalOccurrence[] = [];
  for (const rp of RISK_PATTERNS) {
    const re = new RegExp(rp.re.source, rp.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.
