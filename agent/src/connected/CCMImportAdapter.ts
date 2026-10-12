/**
 * N-CoreShift – Phase 11: Custom Code Migration (CCM) Import Adapter
 *
 * Parses exports from the SAP Custom Code Migration tooling:
 *
 * JSON format (CCM_JSON):
 *  Source: SAP Custom Code Migration Fiori app (transaction SYCM) or BTP CCM service.
 *  Export: CCM app → Custom Code → Export → JSON
 *  Root structure: { "objects": [ { ... }, ... ] }
 *  Available: S/4HANA 1610+ On-Premise / Private Cloud; BTP CCM service.
 *
 * XML format (CCM_XML):
 *  Source: Report SYCM_GET_CALL_STATISTICS or older CCM add-on exports.
 *  Root element: <CCM_RESULTS> containing <OBJECT> elements.
 *  Available: S/4HANA 1610+, ECC with CCM add-on.
 *
 * Both formats are parsed to the same CCMObject[] structure.
 *
 * Input is treated as untrusted data (Principle 17).
 * Passwords and credentials must never appear in CCM exports; if any are
 * detected in field values the record is redacted and a warning is emitted.
 */

import type { CCMObject } from './types.js';
import { _extractAllElements } from './ATCImportAdapter.js';

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 50 * 1024 * 1024;
const MAX_FIELD_LENGTH = 512;
const MAX_OBJECTS = 200_000;

// ── Public API ────────────────────────────────────────────────────────────

export interface CCMParseResult {
  objects: CCMObject[];
  warnings: string[];
  errors: string[];
  rawObjectCount: number;
}

/**
 * Parse a CCM JSON export ({ "objects": [...] }).
 * Never throws – errors are returned in the result.
 */
export function parseCCMJson(jsonContent: string): CCMParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (Buffer.byteLength(jsonContent, 'utf8') > MAX_CONTENT_BYTES) {
    return {
      objects: [],
      warnings: [],
      errors: ['CCM JSON content exceeds 50 MB limit'],
      rawObjectCount: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    return {
      objects: [],
      warnings: [],
      errors: ['CCM JSON content is not valid JSON'],
      rawObjectCount: 0,
    };
  }

  // Accept top-level array, { objects: [...] }, or { customCodeObjects: [...] }
  let rawItems: unknown[];
  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    const rec = parsed as Record<string, unknown>;
    // Try known wrapper key names in priority order
    const arr =
      Array.isArray(rec['objects']) ? rec['objects'] :
      Array.isArray(rec['customCodeObjects']) ? rec['customCodeObjects'] :
      undefined;

    if (arr === undefined) {
      return {
        objects: [],
        warnings: [],
        errors: [
          'CCM JSON must be either an array or an object with an "objects" or "customCodeObjects" array property',
        ],
        rawObjectCount: 0,
      };
    }
    rawItems = arr;
  } else {
    return {
      objects: [],
      warnings: [],
      errors: [
        'CCM JSON must be either an array or an object with an "objects" or "customCodeObjects" array property',
      ],
      rawObjectCount: 0,
    };
  }

  if (rawItems.length > MAX_OBJECTS) {
    warnings.push(
      `CCM JSON has ${rawItems.length} objects; only the first ${MAX_OBJECTS} will be processed.`,
    );
    rawItems = rawItems.slice(0, MAX_OBJECTS);
  }

  const rawObjectCount = rawItems.length;
  const objects: CCMObject[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (typeof item !== 'object' || item === null) {
      warnings.push(`Item ${i + 1}: not an object, skipping`);
      continue;
    }
    const obj = _parseCCMJsonItem(item as Record<string, unknown>, i + 1, warnings);
    if (obj !== null) {
      objects.push(obj);
    }
  }

  return { objects, warnings, errors, rawObjectCount };
}

/**
 * Parse a CCM XML export (<CCM_RESULTS> containing <OBJECT> elements).
 * Never throws – errors are returned in the result.
 */
export function parseCCMXml(xmlContent: string): CCMParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (Buffer.byteLength(xmlContent, 'utf8') > MAX_CONTENT_BYTES) {
    return {
      objects: [],
      warnings: [],
      errors: ['CCM XML content exceeds 50 MB limit'],
      rawObjectCount: 0,
    };
  }

  const trimmed = xmlContent.trim();
  if (!trimmed.startsWith('<') && !trimmed.startsWith('<?xml')) {
    return {
      objects: [],
      warnings: [],
      errors: ['Content does not appear to be XML'],
      rawObjectCount: 0,
    };
  }

  // Extract object blocks; CCM XML uses <OBJECT> or <CCM_OBJECT>
  let blocks: string[] = [];
  for (const tag of ['OBJECT', 'CCM_OBJECT', 'ITEM', 'ENTRY']) {
    const found = _extractAllElements(xmlContent, tag);
    if (found.length > 0) {
      blocks = found;
      break;
    }
  }

  if (blocks.length === 0) {
    warnings.push(
      'No <OBJECT>, <CCM_OBJECT>, or <ITEM> elements found. ' +
        'Verify the file was exported from CCM/SYCM as XML format.',
    );
    return { objects: [], warnings, errors, rawObjectCount: 0 };
  }

  if (blocks.length > MAX_OBJECTS) {
    warnings.push(
      `CCM XML has ${blocks.length} objects; only the first ${MAX_OBJECTS} will be processed.`,
    );
    blocks = blocks.slice(0, MAX_OBJECTS);
  }

  const rawObjectCount = blocks.length;
  const objects: CCMObject[] = [];

  for (const block of blocks) {
    const obj = _parseCCMXmlBlock(block, warnings);
    if (obj !== null) {
      objects.push(obj);
    }
  }

  if (objects.length < rawObjectCount) {
    warnings.push(
      `${rawObjectCount - objects.length} of ${rawObjectCount} CCM object(s) skipped due to missing required fields.`,
    );
  }

  return { objects, warnings, errors, rawObjectCount };
}

// ── JSON item parser ──────────────────────────────────────────────────────

function _parseCCMJsonItem(
  item: Record<string, unknown>,
  index: number,
  warnings: string[],
): CCMObject | null {
  // Object name – try common field name variants
  const objectName = _strField(item, [
    'objectName', 'OBJECT_NAME', 'ObjectName', 'object_name', 'name', 'NAME',
  ]);

  if (!objectName) {
    warnings.push(`Item ${index}: missing object name, skipping`);
    return null;
  }

  const objectType = _strField(item, [
    'objectType', 'OBJECT_TYPE', 'ObjectType', 'object_type', 'type', 'TYPE',
  ]) || 'PROG';

  const status = _strField(item, [
    'status', 'STATUS', 'compatibilityStatus', 'COMPATIBILITY_STATUS',
    'compatibility_status', 'result', 'RESULT',
  ]) || 'UNCLEAR';

  const suggestion = _strField(item, [
    'suggestion', 'SUGGESTION', 'recommendation', 'RECOMMENDATION',
    'suggestedAction', 'SUGGESTED_ACTION',
  ]) || undefined;

  const effort = _strField(item, [
    'effort', 'EFFORT', 'estimatedEffort', 'ESTIMATED_EFFORT',
    'estimated_effort', 'workload', 'WORKLOAD',
  ]) || undefined;

  const notes = _strField(item, [
    'notes', 'NOTES', 'comment', 'COMMENT', 'remarks', 'REMARKS',
  ]) || undefined;

  return {
    objectName: _cap(objectName),
    objectType: _cap(objectType),
    status: _cap(status),
    ...(suggestion && { suggestion: _cap(suggestion) }),
    ...(effort && { effort: _cap(effort) }),
    ...(notes && { notes: _cap(notes) }),
  };
}

// ── XML block parser ──────────────────────────────────────────────────────

function _parseCCMXmlBlock(
  block: string,
  warnings: string[],
): CCMObject | null {
  const objectName =
    _xmlField(block, 'OBJECT_NAME') ||
    _xmlField(block, 'OBJECTNAME') ||
    _xmlField(block, 'OBJ_NAME') ||
    _xmlField(block, 'NAME');

  if (!objectName) {
    warnings.push('Skipping CCM XML object: missing object name');
    return null;
  }

  const objectType =
    _xmlField(block, 'OBJECT_TYPE') ||
    _xmlField(block, 'OBJECTTYPE') ||
    _xmlField(block, 'OBJ_TYPE') ||
    'PROG';

  const status =
    _xmlField(block, 'STATUS') ||
    _xmlField(block, 'COMPATIBILITY_STATUS') ||
    _xmlField(block, 'RESULT') ||
    'UNCLEAR';

  const suggestion =
    _xmlField(block, 'SUGGESTION') ||
    _xmlField(block, 'RECOMMENDATION') ||
    undefined;

  const effort =
    _xmlField(block, 'EFFORT') ||
    _xmlField(block, 'ESTIMATED_EFFORT') ||
    undefined;

  const notes =
    _xmlField(block, 'NOTES') ||
    _xmlField(block, 'COMMENT') ||
    _xmlField(block, 'REMARKS') ||
    undefined;

  return {
    objectName: _cap(objectName),
    objectType: _cap(objectType),
    status: _cap(status),
    ...(suggestion && { suggestion: _cap(suggestion) }),
    ...(effort && { effort: _cap(effort) }),
    ...(notes && { notes: _cap(notes) }),
  };
}

// ── Field helpers ─────────────────────────────────────────────────────────

function _strField(
  obj: Record<string, unknown>,
  keys: string[],
): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function _xmlField(xml: string, tag: string): string {
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

function _cap(s: string): string {
  return s.length > MAX_FIELD_LENGTH ? s.slice(0, MAX_FIELD_LENGTH) : s;
}
