/**
 * N-CoreShift – Phase 11: ATC Import Adapter
 *
 * Parses ATC (ABAP Test Cockpit) run result XML exported from transaction SATC.
 *
 * Accepted export formats:
 *  - SATC → Manage Runs → Select Run → Export → XML  (produces SATC_ATC_RUN_RESULT)
 *  - SE80 → ATC → Display Results → Export           (produces FINDINGS wrapper)
 *
 * The parser is intentionally lenient with element names to handle minor
 * variations between NW releases (7.40–7.57, S/4HANA 1511–2023).
 *
 * Input is treated as untrusted data:
 *  - No script execution
 *  - Content length guard (< 50 MB)
 *  - Field values are trimmed and length-capped
 */

import type { ATCFinding } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_FIELD_LENGTH = 1024;

// ── Public API ────────────────────────────────────────────────────────────

export interface ATCParseResult {
  findings: ATCFinding[];
  warnings: string[];
  errors: string[];
  rawFindingCount: number;
}

/**
 * Parse an ATC XML export.
 * Never throws – errors are returned in the result.
 */
export function parseATCXml(xmlContent: string): ATCParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Guard: size
  if (Buffer.byteLength(xmlContent, 'utf8') > MAX_CONTENT_BYTES) {
    return {
      findings: [],
      warnings: [],
      errors: ['ATC XML content exceeds 50 MB limit'],
      rawFindingCount: 0,
    };
  }

  // Guard: must look like XML
  const trimmed = xmlContent.trim();
  if (!trimmed.startsWith('<') && !trimmed.startsWith('<?xml')) {
    return {
      findings: [],
      warnings: [],
      errors: ['Content does not appear to be XML'],
      rawFindingCount: 0,
    };
  }

  // Try element name variants in priority order (SATC_ATC_FINDING is the
  // canonical name from SATC exports; others cover older NW releases)
  let blocks: string[] = [];
  for (const tag of ['SATC_ATC_FINDING', 'FINDING', 'ITEM', 'ATC_FINDING']) {
    const found = _extractAllElements(xmlContent, tag);
    if (found.length > 0) {
      blocks = found;
      break;
    }
  }

  if (blocks.length === 0) {
    warnings.push(
      'No <SATC_ATC_FINDING>, <FINDING>, <ITEM>, or <ATC_FINDING> elements found. ' +
        'Verify the file was exported from SATC as XML format.',
    );
    return { findings: [], warnings, errors, rawFindingCount: 0 };
  }

  const rawFindingCount = blocks.length;
  const findings: ATCFinding[] = [];

  for (const block of blocks) {
    const result = _parseFindingBlock(block, warnings);
    if (result !== null) {
      findings.push(result);
    }
  }

  if (findings.length < rawFindingCount) {
    warnings.push(
      `${rawFindingCount - findings.length} of ${rawFindingCount} finding(s) were skipped due to missing required fields.`,
    );
  }

  return { findings, warnings, errors, rawFindingCount };
}

// ── Internal parsing ──────────────────────────────────────────────────────

function _parseFindingBlock(
  block: string,
  warnings: string[],
): ATCFinding | null {
  // Object name – required. Try several element name variants.
  const objectName =
    _extractField(block, 'OBJECT_NAME') ||
    _extractField(block, 'OBJECTNAME') ||
    _extractField(block, 'OBJ_NAME');

  if (!objectName) {
    warnings.push('skipping finding: missing object name');
    return null;
  }

  // Object type
  const objectType =
    _extractField(block, 'OBJECT_TYPE') ||
    _extractField(block, 'OBJECTTYPE') ||
    _extractField(block, 'OBJ_TYPE') ||
    'PROG';

  // Priority (1–4)
  const priorityRaw =
    _extractField(block, 'PRIORITY') ||
    _extractField(block, 'PRIO') ||
    _extractField(block, 'SEVERITY') ||
    '3';

  const priority = _normalisePriority(priorityRaw);

  // Check ID
  const checkId =
    _extractField(block, 'CHECK_ID') ||
    _extractField(block, 'CHECKID') ||
    _extractField(block, 'CHECK') ||
    _extractField(block, 'CHECK_NAME') ||
    '';

  // Message text
  const messageText =
    _extractField(block, 'MESSAGE_TEXT') ||
    _extractField(block, 'MESSAGETEXT') ||
    _extractField(block, 'MESSAGE') ||
    _extractField(block, 'FINDING_TEXT') ||
    _extractField(block, 'TEXT') ||
    '';

  // Line / column (optional)
  const lineRaw =
    _extractField(block, 'FINDING_LINE') ||
    _extractField(block, 'LINE') ||
    _extractField(block, 'SRCLINE') ||
    '';
  const colRaw =
    _extractField(block, 'FINDING_COLUMN') ||
    _extractField(block, 'COLUMN') ||
    _extractField(block, 'SRCCOL') ||
    '';

  const sourceLine = lineRaw ? _safeInt(lineRaw) : undefined;
  const sourceColumn = colRaw ? _safeInt(colRaw) : undefined;

  return {
    objectName: _cap(objectName),
    objectType: _cap(objectType),
    priority,
    checkId: _cap(checkId),
    messageText: _cap(messageText),
    ...(sourceLine !== undefined && { sourceLine }),
    ...(sourceColumn !== undefined && { sourceColumn }),
  };
}

// ── XML helpers ───────────────────────────────────────────────────────────

/** Extract the first occurrence of <TAG>...</TAG> content */
function _extractField(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`,
    'is',
  );
  const m = re.exec(xml);
  return m ? _decodeXmlEntities(m[1].trim()) : '';
}

/** Extract all occurrences of <TAG>...</TAG> inner content */
export function _extractAllElements(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`, 'gis');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1]);
  }
  return results;
}

/** Decode common XML entities in field values.
 *  Uses a capture-group approach so the formatter cannot
 *  convert the entity names to literal characters.
 */
function _decodeXmlEntities(s: string): string {
  const XML_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return s.replace(/&([a-zA-Z]+);/g, (_m, name: string) => {
    return XML_ENTITIES[name] ?? `&${name};`;
  });
}

// ── Value helpers ─────────────────────────────────────────────────────────

function _normalisePriority(raw: string): 1 | 2 | 3 | 4 {
  const s = raw.trim().toUpperCase();
  // Numeric
  if (s === '1' || s === 'ERROR' || s === 'HIGH') return 1;
  if (s === '2' || s === 'WARNING' || s === 'MEDIUM') return 2;
  if (s === '3' || s === 'INFO' || s === 'INFORMATION' || s === 'LOW') return 3;
  if (s === '4' || s === 'OTHER' || s === 'NOTE') return 4;
  const n = parseInt(s, 10);
  if (!isNaN(n)) {
    if (n < 1) return 1;
    if (n > 4) return 4; // clamp out-of-range to lowest severity
    return n as 1 | 2 | 3 | 4;
  }
  return 3; // default to info
}

function _safeInt(s: string): number | undefined {
  const n = parseInt(s.trim(), 10);
  return isNaN(n) ? undefined : n;
}

function _cap(s: string): string {
  return s.length > MAX_FIELD_LENGTH ? s.slice(0, MAX_FIELD_LENGTH) : s;
}
