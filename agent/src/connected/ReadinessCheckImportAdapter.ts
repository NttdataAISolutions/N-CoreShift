/**
 * N-CoreShift – Phase 11: SAP Readiness Check Import Adapter
 *
 * Parses the JSON export from SAP Readiness Check for SAP S/4HANA.
 *
 * Source:
 *  - readiness.sap.com (hosted Readiness Check service)
 *  - Embedded Readiness Check report in the source system
 *
 * Export path:
 *  readiness.sap.com → Results → Custom Code → Export JSON
 *
 * The JSON structure SAP produces is:
 * {
 *   "customCode": {
 *     "objects": [ { ... }, ... ]
 *   }
 * }
 *
 * Some versions wrap the entire result in a top-level key like
 * "readinessCheckResult" or "result". The adapter accepts any of:
 *  - Top-level array
 *  - { objects: [...] }
 *  - { customCode: { objects: [...] } }
 *  - { readinessCheckResult: { customCode: { objects: [...] } } }
 *  - { result: { customCode: { objects: [...] } } }
 *
 * Input is treated as untrusted data (Principle 17).
 */

import type { ReadinessCheckObject } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 50 * 1024 * 1024;
const MAX_OBJECTS = 200_000;
const MAX_FIELD_LENGTH = 512;

// ── Public API ────────────────────────────────────────────────────────────

export interface ReadinessCheckParseResult {
  objects: ReadinessCheckObject[];
  warnings: string[];
  errors: string[];
  rawObjectCount: number;
}

/**
 * Parse a SAP Readiness Check JSON export.
 * Never throws – errors are returned in the result.
 */
export function parseReadinessCheckJson(
  jsonContent: string,
): ReadinessCheckParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (Buffer.byteLength(jsonContent, 'utf8') > MAX_CONTENT_BYTES) {
    return {
      objects: [],
      warnings: [],
      errors: ['Readiness Check JSON content exceeds 50 MB limit'],
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
      errors: ['Readiness Check JSON content is not valid JSON'],
      rawObjectCount: 0,
    };
  }

  // Locate the objects array through the various nesting levels
  const rawItems = _locateObjectsArray(parsed, warnings);
  if (rawItems === null) {
    return {
      objects: [],
      warnings,
      errors: [
        'Could not locate a custom code objects array in the Readiness Check JSON. ' +
          'Verify the file was exported from readiness.sap.com as JSON.',
      ],
      rawObjectCount: 0,
    };
  }

  let items = rawItems;
  if (items.length > MAX_OBJECTS) {
    warnings.push(
      `Readiness Check JSON has ${items.length} objects; only the first ${MAX_OBJECTS} will be processed.`,
    );
    items = items.slice(0, MAX_OBJECTS);
  }

  const rawObjectCount = items.length;
  const objects: ReadinessCheckObject[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== 'object' || item === null) {
      warnings.push(`Item ${i + 1}: not an object, skipping`);
      continue;
    }
    const obj = _parseItem(item as Record<string, unknown>, i + 1, warnings);
    if (obj !== null) {
      objects.push(obj);
    }
  }

  if (objects.length < rawObjectCount) {
    warnings.push(
      `${rawObjectCount - objects.length} of ${rawObjectCount} object(s) skipped due to missing required fields.`,
    );
  }

  return { objects, warnings, errors, rawObjectCount };
}

// ── Locate objects array ──────────────────────────────────────────────────

function _locateObjectsArray(
  data: unknown,
  warnings: string[],
): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (typeof data !== 'object' || data === null) return null;

  const d = data as Record<string, unknown>;

  // Direct { objects: [...] }
  if (Array.isArray(d['objects'])) return d['objects'] as unknown[];

  // { customCode: { objects: [...] } }
  const customCode = d['customCode'];
  if (
    typeof customCode === 'object' &&
    customCode !== null &&
    Array.isArray((customCode as Record<string, unknown>)['objects'])
  ) {
    return (customCode as Record<string, unknown>)['objects'] as unknown[];
  }

  // { readinessCheckResult: { customCode: { objects: [...] } } }
  for (const topKey of ['readinessCheckResult', 'result', 'data']) {
    const top = d[topKey];
    if (typeof top === 'object' && top !== null) {
      const nested = _locateObjectsArray(top, warnings);
      if (nested !== null) return nested;
    }
  }

  // Fallback: look for any array value at the top level that is non-empty
  // and whose first element looks like a Readiness Check object
  for (const key of Object.keys(d)) {
    const val = d[key];
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (
        typeof first === 'object' &&
        first !== null &&
        (_hasAnyKey(first as Record<string, unknown>, [
          'objectName',
          'OBJECT_NAME',
          'programName',
          'PROGRAM_NAME',
          'name',
          'NAME',
        ]))
      ) {
        warnings.push(
          `Readiness Check: objects array found under key "${key}" (non-standard structure).`,
        );
        return val as unknown[];
      }
    }
  }

  return null;
}

function _hasAnyKey(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => k in obj);
}

// ── Item parser ───────────────────────────────────────────────────────────

function _parseItem(
  item: Record<string, unknown>,
  index: number,
  warnings: string[],
): ReadinessCheckObject | null {
  const objectName = _str(item, [
    'objectName',
    'OBJECT_NAME',
    'programName',
    'PROGRAM_NAME',
    'name',
    'NAME',
    'customCodeObject',
    'CUSTOM_CODE_OBJECT',
  ]);

  if (!objectName) {
    warnings.push(`Item ${index}: missing object name, skipping`);
    return null;
  }

  const objectType =
    _str(item, [
      'objectType',
      'OBJECT_TYPE',
      'type',
      'TYPE',
      'programType',
      'PROGRAM_TYPE',
    ]) || undefined;

  const category =
    _str(item, [
      'category',
      'CATEGORY',
      'checkCategory',
      'CHECK_CATEGORY',
      'topic',
      'TOPIC',
      'checkType',
      'CHECK_TYPE',
      'group',
      'GROUP',
    ]) || 'GENERAL';

  const severity =
    _str(item, [
      'severity',
      'SEVERITY',
      'priority',
      'PRIORITY',
      'impact',
      'IMPACT',
      'status',
      'STATUS',
    ]) || 'INFO';

  const recommendation =
    _str(item, [
      'recommendation',
      'RECOMMENDATION',
      'suggestion',
      'SUGGESTION',
      'action',
      'ACTION',
      'suggestedAction',
      'SUGGESTED_ACTION',
    ]) || undefined;

  const details =
    _str(item, [
      'details',
      'DETAILS',
      'message',
      'MESSAGE',
      'description',
      'DESCRIPTION',
      'text',
      'TEXT',
      'info',
      'INFO',
    ]) || undefined;

  return {
    objectName: _cap(objectName),
    ...(objectType && { objectType: _cap(objectType) }),
    category: _cap(category),
    severity: _cap(severity),
    ...(recommendation && { recommendation: _cap(recommendation) }),
    ...(details && { details: _cap(details) }),
  };
}

// ── Field helpers ─────────────────────────────────────────────────────────

function _str(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function _cap(s: string): string {
  return s.length > MAX_FIELD_LENGTH ? s.slice(0, MAX_FIELD_LENGTH) : s;
}
