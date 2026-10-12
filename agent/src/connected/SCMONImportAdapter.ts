/**
 * N-CoreShift – Phase 11: SCMON / Usage Statistics Import Adapter
 *
 * Parses CSV usage statistics exported from:
 *  - Transaction SUSG (report SUSG – Usage and Procedure Logging)
 *  - SCMON monitor export (System Change Option Monitor)
 *
 * Expected CSV format (with header row):
 *   ObjectName,ObjectType,CalledCount,LastUsed,Users
 *
 * Tolerances:
 *  - Column order is determined by header row (case-insensitive).
 *  - Missing optional columns are silently ignored.
 *  - Rows with blank ObjectName are skipped with a warning.
 *  - Extra columns are ignored.
 *  - Tab-separated variants are also accepted.
 *
 * Input is treated as untrusted data (Principle 17).
 */

import type { SCMONEntry } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 500_000;
const MAX_FIELD_LENGTH = 256;

// ── Public API ────────────────────────────────────────────────────────────

export interface SCMONParseResult {
  entries: SCMONEntry[];
  warnings: string[];
  errors: string[];
  rawRowCount: number;
}

/**
 * Parse a SCMON/SUSG CSV export.
 * Never throws – errors are returned in the result.
 */
export function parseSCMONCsv(csvContent: string): SCMONParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (Buffer.byteLength(csvContent, 'utf8') > MAX_CONTENT_BYTES) {
    return {
      entries: [],
      warnings: [],
      errors: ['SCMON CSV content exceeds 50 MB limit'],
      rawRowCount: 0,
    };
  }

  // Normalise line endings
  const lines = csvContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { entries: [], warnings: ['CSV is empty'], errors, rawRowCount: 0 };
  }

  // Detect delimiter: tab or comma
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  // Parse header row
  const headerRow = _splitRow(lines[0], delimiter);
  const colIndex = _buildColumnIndex(headerRow);

  if (colIndex.objectName === -1) {
    return {
      entries: [],
      warnings: [],
      errors: [
        'Header row must contain an ObjectName column. ' +
          `Found: ${headerRow.join(', ')}`,
      ],
      rawRowCount: 0,
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_ROWS) {
    warnings.push(
      `CSV has ${dataLines.length} data rows; only the first ${MAX_ROWS} will be processed.`,
    );
    dataLines.splice(MAX_ROWS);
  }

  const rawRowCount = dataLines.length;
  const entries: SCMONEntry[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const cells = _splitRow(dataLines[i], delimiter);
    const entry = _parseRow(cells, colIndex, i + 2, warnings);
    if (entry !== null) {
      entries.push(entry);
    }
  }

  if (entries.length < rawRowCount) {
    warnings.push(
      `${rawRowCount - entries.length} of ${rawRowCount} rows skipped (blank object name).`,
    );
  }

  return { entries, warnings, errors, rawRowCount };
}

// ── Internal helpers ──────────────────────────────────────────────────────

interface ColumnIndex {
  objectName: number;
  objectType: number;
  calledCount: number;
  lastUsedDate: number;
  userCount: number;
}

function _buildColumnIndex(headers: string[]): ColumnIndex {
  const idx = (names: string[]): number => {
    for (const name of names) {
      const i = headers.findIndex(
        (h) => h.trim().toLowerCase() === name.toLowerCase(),
      );
      if (i !== -1) return i;
    }
    return -1;
  };

  return {
    objectName: idx([
      'objectname',
      'object_name',
      'obj_name',
      'program',
      'name',
    ]),
    objectType: idx([
      'objecttype',
      'object_type',
      'obj_type',
      'type',
      'objtype',
    ]),
    calledCount: idx([
      'calledcount',
      'called_count',
      'callcount',
      'call_count',
      'count',
      'executions',
    ]),
    lastUsedDate: idx([
      'lastused',
      'last_used',
      'lastuseddate',
      'last_used_date',
      'lastcall',
      'last_call',
    ]),
    userCount: idx([
      'users',
      'usercount',
      'user_count',
      'distinctusers',
      'distinct_users',
    ]),
  };
}

function _parseRow(
  cells: string[],
  col: ColumnIndex,
  lineNumber: number,
  warnings: string[],
): SCMONEntry | null {
  const objectName =
    col.objectName >= 0 ? (cells[col.objectName] ?? '').trim() : '';

  if (!objectName) {
    return null; // blank rows counted at caller
  }

  const objectType =
    col.objectType >= 0
      ? _cap((cells[col.objectType] ?? '').trim()) || 'PROG'
      : 'PROG';

  let calledCount = 0;
  if (col.calledCount >= 0) {
    const raw = (cells[col.calledCount] ?? '').trim().replace(/[,\s]/g, '');
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 0) {
      calledCount = n;
    } else if (raw !== '') {
      warnings.push(`Line ${lineNumber}: invalid CalledCount "${raw}", defaulting to 0`);
    }
  }

  let lastUsedDate: string | undefined;
  if (col.lastUsedDate >= 0) {
    const raw = (cells[col.lastUsedDate] ?? '').trim();
    if (raw) {
      lastUsedDate = _normaliseDate(raw) ?? undefined;
      if (!lastUsedDate) {
        warnings.push(`Line ${lineNumber}: unrecognised date "${raw}", ignoring`);
      }
    }
  }

  let userCount: number | undefined;
  if (col.userCount >= 0) {
    const raw = (cells[col.userCount] ?? '').trim().replace(/[,\s]/g, '');
    if (raw) {
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n >= 0) {
        userCount = n;
      } else {
        warnings.push(`Line ${lineNumber}: invalid user count "${raw}", ignoring`);
      }
    }
  }

  return {
    objectName: _cap(objectName),
    objectType,
    calledCount,
    ...(lastUsedDate !== undefined && { lastUsedDate }),
    ...(userCount !== undefined && { userCount }),
  };
}

/** Split a CSV/TSV row, handling quoted fields */
function _splitRow(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t');
  }
  // Comma: handle double-quoted fields
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Normalise various date formats to ISO string (YYYY-MM-DD).
 * Accepts: YYYYMMDD, DD.MM.YYYY, YYYY-MM-DD, MM/DD/YYYY
 */
function _normaliseDate(raw: string): string | null {
  const s = raw.trim();

  // YYYYMMDD (SAP internal format)
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  // DD.MM.YYYY
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  // MM/DD/YYYY
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  return null;
}

function _cap(s: string): string {
  return s.length > MAX_FIELD_LENGTH ? s.slice(0, MAX_FIELD_LENGTH) : s;
}
