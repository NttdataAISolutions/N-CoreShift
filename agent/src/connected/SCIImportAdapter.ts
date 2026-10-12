/**
 * N-CoreShift – Phase 11: Code Inspector (SCI) Import Adapter
 *
 * Parses Code Inspector result XML exported from transaction SCI or SE80.
 *
 * Export path: SCI → Worklist → Display → Export → XML
 *              SE80 → Code Inspector → Display Results → Export
 *
 * Supported root elements (vary by NW release):
 *  - <SCI_WORKLIST>    (NW 7.0–7.57, typical export)
 *  - <SCIR_RESULT>     (alternative from older releases)
 *  - <WORKLIST>        (simplified export from some S/4 versions)
 *
 * Finding elements: <FINDING>, <CHECK_RESULT>, <ITEM>
 *
 * Input is treated as untrusted data (Principle 17).
 */

import type { SCIFinding } from './types.js';
import { _extractAllElements } from './ATCImportAdapter.js';

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 50 * 1024 * 1024;
const MAX_FIELD_LENGTH = 1024;

// ── Public API ────────────────────────────────────────────────────────────

export interface SCIParseResult {
  findings: SCIFinding[];
  warnings: string[];
  errors: string[];
  rawFindingCount: number;
}

/**
 * Parse a Code Inspector XML export.
 * Never throws – errors are returned in the result.
 */
export function parseSCIXml(xmlContent: string): SCIParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (Buffer.byteLength(xmlContent, 'utf8') > MAX_CONTENT_BYTES) {
    return {
      findings: [],
      warnings: [],
      errors: ['SCI XML content exceeds 50 MB limit'],
      rawFindingCount: 0,
    };
  }

  const trimmed = xmlContent.trim();
  if (!trimmed.startsWith('<') && !trimmed.startsWith('<?xml')) {
    return {
      findings: [],
      warnings: [],
      errors: ['Content does not appear to be XML'],
      rawFindingCount: 0,
    };
  }

  // Try multiple block element names used across SCI export formats
  let blocks: string[] = [];
  for (const tag of ['FINDING', 'CHECK_RESULT', 'ITEM', 'SCI_FINDING']) {
    const found = _extractAllElements(xmlContent, tag);
    if (found.length > 0) {
      blocks = found;
      break;
    }
  }

  if (blocks.length === 0) {
    warnings.push(
      'No finding elements found. Verify the file was exported from SCI/SE80 as XML.',
    );
    return { findings: [], warnings, errors, rawFindingCount: 0 };
  }

  const rawFindingCount = blocks.length;
  const findings: SCIFinding[] = [];

  for (const block of blocks) {
    const finding = _parseSCIBlock(block, warnings);
    if (finding !== null) {
      findings.push(finding);
    }
  }

  if (findings.length < rawFindingCount) {
    warnings.push(
      `${rawFindingCount - findings.length} of ${rawFindingCount} SCI finding(s) skipped due to missing required fields.`,
    );
  }

  return { findings, warnings, errors, rawFindingCount };
}

// ── Internal parsing ──────────────────────────────────────────────────────

function _parseSCIBlock(
  block: string,
  warnings: string[],
): SCIFinding | null {
  const objectName =
    _field(block, 'OBJECT_NAME') ||
    _field(block, 'OBJECTNAME') ||
    _field(block, 'OBJ_NAME') ||
    _field(block, 'PROGRAM');

  if (!objectName) {
    warnings.push('Skipping SCI finding: missing object name');
    return null;
  }

  const objectType =
    _field(block, 'OBJECT_TYPE') ||
    _field(block, 'OBJECTTYPE') ||
    _field(block, 'OBJ_TYPE') ||
    'PROG';

  const checkId =
    _field(block, 'CHECK_ID') ||
    _field(block, 'CHECKID') ||
    _field(block, 'CHECK') ||
    _field(block, 'CHECK_CLASS') ||
    _field(block, 'TEST') ||
    '';

  // SCI uses various priority/severity field names
  const priority =
    _field(block, 'PRIORITY') ||
    _field(block, 'PRIO') ||
    _field(block, 'SEVERITY') ||
    _field(block, 'KIND') ||
    '3';

  const messageText =
    _field(block, 'MESSAGE_TEXT') ||
    _field(block, 'MESSAGETEXT') ||
    _field(block, 'MESSAGE') ||
    _field(block, 'DESCRIPTION') ||
    _field(block, 'TEXT') ||
    '';

  const lineRaw =
    _field(block, 'LINE') ||
    _field(block, 'SRCLINE') ||
    _field(block, 'FINDING_LINE') ||
    '';

  const sourceLine = lineRaw ? _safeInt(lineRaw) : undefined;

  return {
    objectName: _cap(objectName),
    objectType: _cap(objectType),
    checkId: _cap(checkId),
    priority: _cap(priority),
    messageText: _cap(messageText),
    ...(sourceLine !== undefined && { sourceLine }),
  };
}

// ── XML helpers ───────────────────────────────────────────────────────────

function _field(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)</${tag}>`, 'is');
  const m = re.exec(xml);
  if (!m) return '';
  return _decodeEntities(m[1].trim());
}

function _decodeEntities(s: string): string {
  return s
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}

function _safeInt(s: string): number | undefined {
  const n = parseInt(s.trim(), 10);
  return isNaN(n) ? undefined : n;
}

function _cap(s: string): string {
  return s.length > MAX_FIELD_LENGTH ? s.slice(0, MAX_FIELD_LENGTH) : s;
}
