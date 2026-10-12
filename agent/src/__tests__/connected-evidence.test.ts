/**
 * N-CoreShift – Phase 11 Tests: Connected Evidence Import
 *
 * Covers:
 *  - ATCImportAdapter   (ATC XML)
 *  - SCIImportAdapter   (Code Inspector XML)
 *  - SCMONImportAdapter (SCMON/SUSG CSV)
 *  - CCMImportAdapter   (CCM JSON + XML)
 *  - ReadinessCheckImportAdapter (Readiness Check JSON)
 *  - EvidenceImportService (orchestrator + InMemoryEvidenceStore)
 */

import { parseATCXml } from '../connected/ATCImportAdapter.js';
import { parseSCIXml } from '../connected/SCIImportAdapter.js';
import { parseSCMONCsv } from '../connected/SCMONImportAdapter.js';
import { parseCCMJson, parseCCMXml } from '../connected/CCMImportAdapter.js';
import { parseReadinessCheckJson } from '../connected/ReadinessCheckImportAdapter.js';
import {
  EvidenceImportService,
  InMemoryEvidenceStore,
} from '../connected/EvidenceImportService.js';
import type { EvidenceImportRequest } from '../connected/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function baseRequest(
  overrides: Partial<EvidenceImportRequest> = {},
): EvidenceImportRequest {
  return {
    tenantId: 'tenant-1',
    projectId: 'proj-1',
    analysisId: 'analysis-1',
    format: 'ATC_XML',
    fileContent: '',
    originalFileName: 'test.xml',
    importedBy: 'tester',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ATCImportAdapter
// ═══════════════════════════════════════════════════════════════════════════

describe('ATCImportAdapter – parseATCXml', () => {
  const MINIMAL_ATC = `
    <SATC_ATC_RUN_RESULT>
      <FINDINGS>
        <SATC_ATC_FINDING>
          <OBJECT_NAME>ZREPORT_DEMO</OBJECT_NAME>
          <OBJECT_TYPE>PROG</OBJECT_TYPE>
          <PRIORITY>2</PRIORITY>
          <CHECK_ID>CL_CI_TEST_DYNAMIC_PROG_CALLS</CHECK_ID>
          <MESSAGE_TEXT>Dynamic program call detected</MESSAGE_TEXT>
          <LINE>42</LINE>
        </SATC_ATC_FINDING>
      </FINDINGS>
    </SATC_ATC_RUN_RESULT>`;

  it('parses a well-formed ATC XML with one finding', () => {
    const result = parseATCXml(MINIMAL_ATC);
    expect(result.errors).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.objectName).toBe('ZREPORT_DEMO');
    expect(f.objectType).toBe('PROG');
    expect(f.priority).toBe(2);
    expect(f.checkId).toBe('CL_CI_TEST_DYNAMIC_PROG_CALLS');
    expect(f.messageText).toBe('Dynamic program call detected');
    expect(f.sourceLine).toBe(42);
  });

  it('clamps out-of-range priority to 4', () => {
    const xml = MINIMAL_ATC.replace('<PRIORITY>2</PRIORITY>', '<PRIORITY>99</PRIORITY>');
    const result = parseATCXml(xml);
    expect(result.findings[0].priority).toBe(4);
  });

  it('returns error for non-XML content', () => {
    const result = parseATCXml('this is not xml');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.findings).toHaveLength(0);
  });

  it('returns warning for XML with no finding elements', () => {
    const result = parseATCXml('<SATC_ATC_RUN_RESULT><FINDINGS/></SATC_ATC_RUN_RESULT>');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.findings).toHaveLength(0);
  });

  it('skips findings missing object name and emits warning', () => {
    const xml = `
      <SATC_ATC_RUN_RESULT>
        <FINDINGS>
          <SATC_ATC_FINDING>
            <PRIORITY>1</PRIORITY>
            <CHECK_ID>SOME_CHECK</CHECK_ID>
            <MESSAGE_TEXT>some message</MESSAGE_TEXT>
          </SATC_ATC_FINDING>
          <SATC_ATC_FINDING>
            <OBJECT_NAME>ZVALID</OBJECT_NAME>
            <OBJECT_TYPE>PROG</OBJECT_TYPE>
            <PRIORITY>3</PRIORITY>
            <CHECK_ID>OTHER_CHECK</CHECK_ID>
            <MESSAGE_TEXT>ok</MESSAGE_TEXT>
          </SATC_ATC_FINDING>
        </FINDINGS>
      </SATC_ATC_RUN_RESULT>`;
    const result = parseATCXml(xml);
    expect(result.findings).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('skipping'))).toBe(true);
  });

  it('parses alternative root element <FINDINGS> directly', () => {
    const xml = `
      <FINDINGS>
        <SATC_ATC_FINDING>
          <OBJECT_NAME>ZALT</OBJECT_NAME>
          <OBJECT_TYPE>CLAS</OBJECT_TYPE>
          <PRIORITY>1</PRIORITY>
          <CHECK_ID>ATC_CHECK</CHECK_ID>
          <MESSAGE_TEXT>msg</MESSAGE_TEXT>
        </SATC_ATC_FINDING>
      </FINDINGS>`;
    const result = parseATCXml(xml);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].objectName).toBe('ZALT');
  });

  it('returns error for content exceeding 50 MB', () => {
    const huge = 'x'.repeat(51 * 1024 * 1024);
    const result = parseATCXml(huge);
    expect(result.errors[0]).toMatch(/50 MB/);
  });

  it('decodes XML entities in message text', () => {
    const xml = `
      <SATC_ATC_RUN_RESULT>
        <FINDINGS>
          <SATC_ATC_FINDING>
            <OBJECT_NAME>ZPROG</OBJECT_NAME>
            <OBJECT_TYPE>PROG</OBJECT_TYPE>
            <PRIORITY>2</PRIORITY>
            <CHECK_ID>CHK</CHECK_ID>
            <MESSAGE_TEXT>Use & instead of &amp;</MESSAGE_TEXT>
          </SATC_ATC_FINDING>
        </FINDINGS>
      </SATC_ATC_RUN_RESULT>`;
    const result = parseATCXml(xml);
    expect(result.findings[0].messageText).toBe('Use & instead of &');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCIImportAdapter
// ═══════════════════════════════════════════════════════════════════════════

describe('SCIImportAdapter – parseSCIXml', () => {
  const MINIMAL_SCI = `
    <SCI_WORKLIST>
      <FINDING>
        <OBJECT_NAME>ZFORM_PROG</OBJECT_NAME>
        <OBJECT_TYPE>PROG</OBJECT_TYPE>
        <CHECK_ID>AVOID_OBSOLETE_STATEMENTS</CHECK_ID>
        <PRIORITY>2</PRIORITY>
        <MESSAGE_TEXT>Obsolete MOVE statement used</MESSAGE_TEXT>
        <LINE>15</LINE>
      </FINDING>
    </SCI_WORKLIST>`;

  it('parses a well-formed SCI XML with one finding', () => {
    const result = parseSCIXml(MINIMAL_SCI);
    expect(result.errors).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.objectName).toBe('ZFORM_PROG');
    expect(f.priority).toBe('2');
    expect(f.checkId).toBe('AVOID_OBSOLETE_STATEMENTS');
    expect(f.sourceLine).toBe(15);
  });

  it('accepts alternative element name CHECK_RESULT', () => {
    const xml = `
      <SCIR_RESULT>
        <CHECK_RESULT>
          <OBJECT_NAME>ZCLASS</OBJECT_NAME>
          <OBJECT_TYPE>CLAS</OBJECT_TYPE>
          <CHECK_ID>CI_CHECK</CHECK_ID>
          <PRIORITY>1</PRIORITY>
          <MESSAGE_TEXT>critical</MESSAGE_TEXT>
        </CHECK_RESULT>
      </SCIR_RESULT>`;
    const result = parseSCIXml(xml);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].objectType).toBe('CLAS');
  });

  it('skips findings missing object name', () => {
    const xml = `
      <SCI_WORKLIST>
        <FINDING>
          <CHECK_ID>SOME_CHECK</CHECK_ID>
          <PRIORITY>3</PRIORITY>
          <MESSAGE_TEXT>no name</MESSAGE_TEXT>
        </FINDING>
      </SCI_WORKLIST>`;
    const result = parseSCIXml(xml);
    expect(result.findings).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns warning for XML with no supported elements', () => {
    const result = parseSCIXml('<SCI_WORKLIST></SCI_WORKLIST>');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns error for non-XML', () => {
    const result = parseSCIXml('not xml content');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('defaults objectType to PROG when missing', () => {
    const xml = `
      <SCI_WORKLIST>
        <FINDING>
          <OBJECT_NAME>ZMISSING_TYPE</OBJECT_NAME>
          <CHECK_ID>CHK</CHECK_ID>
          <PRIORITY>3</PRIORITY>
          <MESSAGE_TEXT>msg</MESSAGE_TEXT>
        </FINDING>
      </SCI_WORKLIST>`;
    const result = parseSCIXml(xml);
    expect(result.findings[0].objectType).toBe('PROG');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCMONImportAdapter
// ═══════════════════════════════════════════════════════════════════════════

describe('SCMONImportAdapter – parseSCMONCsv', () => {
  const MINIMAL_CSV = [
    'ObjectName,ObjectType,CalledCount,LastUsed,Users',
    'ZREPORT_A,PROG,150,20240115,5',
    'ZCL_HELPER,CLAS,0,20230601,2',
  ].join('\n');

  it('parses a well-formed CSV with two rows', () => {
    const result = parseSCMONCsv(MINIMAL_CSV);
    expect(result.errors).toHaveLength(0);
    expect(result.entries).toHaveLength(2);
    const e = result.entries[0];
    expect(e.objectName).toBe('ZREPORT_A');
    expect(e.objectType).toBe('PROG');
    expect(e.calledCount).toBe(150);
    expect(e.lastUsedDate).toBe('2024-01-15');
    expect(e.userCount).toBe(5);
  });

  it('accepts tab-separated format', () => {
    const tsv = [
      'ObjectName\tObjectType\tCalledCount',
      'ZTAB_PROG\tPROG\t77',
    ].join('\n');
    const result = parseSCMONCsv(tsv);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].calledCount).toBe(77);
  });

  it('normalises various date formats', () => {
    const csv = [
      'ObjectName,ObjectType,CalledCount,LastUsed',
      'ZPROG1,PROG,10,20240101',
      'ZPROG2,PROG,10,01.01.2024',
      'ZPROG3,PROG,10,2024-01-01',
      'ZPROG4,PROG,10,01/01/2024',
    ].join('\n');
    const result = parseSCMONCsv(csv);
    expect(result.entries.every((e) => e.lastUsedDate === '2024-01-01')).toBe(true);
  });

  it('skips rows with blank ObjectName and emits warning', () => {
    const csv = [
      'ObjectName,ObjectType,CalledCount',
      ',PROG,10',
      'ZVALID,PROG,20',
    ].join('\n');
    const result = parseSCMONCsv(csv);
    expect(result.entries).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('skipped'))).toBe(true);
  });

  it('returns error when header lacks ObjectName column', () => {
    const csv = ['Foo,Bar', 'a,b'].join('\n');
    const result = parseSCMONCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns warning for empty CSV', () => {
    const result = parseSCMONCsv('   \n  \n');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('defaults objectType to PROG when column absent', () => {
    const csv = ['ObjectName,CalledCount', 'ZNOTYPE,5'].join('\n');
    const result = parseSCMONCsv(csv);
    expect(result.entries[0].objectType).toBe('PROG');
  });

  it('handles quoted fields with commas', () => {
    const csv = [
      'ObjectName,ObjectType,CalledCount',
      '"Z,PROG_WITH_COMMA",PROG,10',
    ].join('\n');
    const result = parseSCMONCsv(csv);
    expect(result.entries[0].objectName).toBe('Z,PROG_WITH_COMMA');
  });

  it('emits warning for non-numeric CalledCount but defaults to 0', () => {
    const csv = [
      'ObjectName,ObjectType,CalledCount',
      'ZPROG,PROG,N/A',
    ].join('\n');
    const result = parseSCMONCsv(csv);
    expect(result.entries[0].calledCount).toBe(0);
    expect(result.warnings.some((w) => w.includes('CalledCount'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CCMImportAdapter
// ═══════════════════════════════════════════════════════════════════════════

describe('CCMImportAdapter – parseCCMJson', () => {
  const MINIMAL_CCM_JSON = JSON.stringify({
    objects: [
      {
        objectName: 'ZCCM_PROG',
        objectType: 'PROG',
        status: 'INCOMPATIBLE',
        suggestion: 'Rewrite using BAdI',
        effort: 'HIGH',
      },
    ],
  });

  it('parses a well-formed CCM JSON with one object', () => {
    const result = parseCCMJson(MINIMAL_CCM_JSON);
    expect(result.errors).toHaveLength(0);
    expect(result.objects).toHaveLength(1);
    const o = result.objects[0];
    expect(o.objectName).toBe('ZCCM_PROG');
    expect(o.status).toBe('INCOMPATIBLE');
    expect(o.effort).toBe('HIGH');
  });

  it('accepts top-level array format', () => {
    const json = JSON.stringify([
      { objectName: 'ZARRAY_OBJ', objectType: 'CLAS', status: 'COMPATIBLE' },
    ]);
    const result = parseCCMJson(json);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].objectName).toBe('ZARRAY_OBJ');
  });

  it('accepts nested customCodeObjects key', () => {
    const json = JSON.stringify({
      customCodeObjects: [
        { objectName: 'ZNESTED', objectType: 'PROG', status: 'UNCLEAR' },
      ],
    });
    const result = parseCCMJson(json);
    expect(result.objects).toHaveLength(1);
  });

  it('skips items missing objectName and emits warning', () => {
    const json = JSON.stringify({
      objects: [
        { objectType: 'PROG', status: 'COMPATIBLE' },
        { objectName: 'ZVALID', objectType: 'PROG', status: 'INCOMPATIBLE' },
      ],
    });
    const result = parseCCMJson(json);
    expect(result.objects).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns error for invalid JSON', () => {
    const result = parseCCMJson('not json');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns error when no objects array can be located', () => {
    const result = parseCCMJson(JSON.stringify({ foo: 'bar' }));
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('CCMImportAdapter – parseCCMXml', () => {
  const MINIMAL_CCM_XML = `
    <CCM_RESULTS>
      <OBJECT>
        <OBJECT_NAME>ZXML_PROG</OBJECT_NAME>
        <OBJECT_TYPE>PROG</OBJECT_TYPE>
        <STATUS>INCOMPATIBLE</STATUS>
        <SUGGESTION>Migrate to standard API</SUGGESTION>
        <EFFORT>MEDIUM</EFFORT>
      </OBJECT>
    </CCM_RESULTS>`;

  it('parses a well-formed CCM XML with one object', () => {
    const result = parseCCMXml(MINIMAL_CCM_XML);
    expect(result.errors).toHaveLength(0);
    expect(result.objects).toHaveLength(1);
    const o = result.objects[0];
    expect(o.objectName).toBe('ZXML_PROG');
    expect(o.status).toBe('INCOMPATIBLE');
    expect(o.effort).toBe('MEDIUM');
    expect(o.suggestion).toBe('Migrate to standard API');
  });

  it('skips objects missing OBJECT_NAME', () => {
    const xml = `
      <CCM_RESULTS>
        <OBJECT><STATUS>COMPATIBLE</STATUS></OBJECT>
      </CCM_RESULTS>`;
    const result = parseCCMXml(xml);
    expect(result.objects).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns error for non-XML', () => {
    const result = parseCCMXml('plain text');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns warning for XML with no objects', () => {
    const result = parseCCMXml('<CCM_RESULTS></CCM_RESULTS>');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ReadinessCheckImportAdapter
// ═══════════════════════════════════════════════════════════════════════════

describe('ReadinessCheckImportAdapter – parseReadinessCheckJson', () => {
  const MINIMAL_RC = JSON.stringify({
    customCode: {
      objects: [
        {
          objectName: 'ZREAD_PROG',
          objectType: 'PROG',
          category: 'SYNTAX_CHECK',
          severity: 'HIGH',
          recommendation: 'Remove obsolete syntax',
          details: 'Line 10 uses deprecated MOVE.',
        },
      ],
    },
  });

  it('parses a well-formed Readiness Check JSON', () => {
    const result = parseReadinessCheckJson(MINIMAL_RC);
    expect(result.errors).toHaveLength(0);
    expect(result.objects).toHaveLength(1);
    const o = result.objects[0];
    expect(o.objectName).toBe('ZREAD_PROG');
    expect(o.category).toBe('SYNTAX_CHECK');
    expect(o.severity).toBe('HIGH');
    expect(o.recommendation).toBe('Remove obsolete syntax');
  });

  it('accepts top-level array format', () => {
    const json = JSON.stringify([
      { objectName: 'ZARR', category: 'GENERAL', severity: 'LOW' },
    ]);
    const result = parseReadinessCheckJson(json);
    expect(result.objects).toHaveLength(1);
  });

  it('accepts readinessCheckResult wrapper', () => {
    const json = JSON.stringify({
      readinessCheckResult: {
        customCode: {
          objects: [{ objectName: 'ZWRAPPED', category: 'MODIFICATION_MONITOR', severity: 'MEDIUM' }],
        },
      },
    });
    const result = parseReadinessCheckJson(json);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].objectName).toBe('ZWRAPPED');
  });

  it('skips items missing objectName and emits warning', () => {
    const json = JSON.stringify({
      customCode: {
        objects: [
          { category: 'GENERAL', severity: 'INFO' },
          { objectName: 'ZVALID', category: 'GENERAL', severity: 'INFO' },
        ],
      },
    });
    const result = parseReadinessCheckJson(json);
    expect(result.objects).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns error for invalid JSON', () => {
    const result = parseReadinessCheckJson('not json {{ }}');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns error when objects array cannot be located', () => {
    const result = parseReadinessCheckJson(JSON.stringify({ something: 'else' }));
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('defaults category to GENERAL when missing', () => {
    const json = JSON.stringify({
      objects: [{ objectName: 'ZNOCAT', severity: 'LOW' }],
    });
    const result = parseReadinessCheckJson(json);
    expect(result.objects[0].category).toBe('GENERAL');
  });

  it('defaults severity to INFO when missing', () => {
    const json = JSON.stringify({
      objects: [{ objectName: 'ZNOSEV', category: 'SYNTAX_CHECK' }],
    });
    const result = parseReadinessCheckJson(json);
    expect(result.objects[0].severity).toBe('INFO');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EvidenceImportService
// ═══════════════════════════════════════════════════════════════════════════

describe('EvidenceImportService', () => {
  let store: InMemoryEvidenceStore;
  let svc: EvidenceImportService;

  beforeEach(() => {
    store = new InMemoryEvidenceStore();
    svc = new EvidenceImportService(store);
  });

  // ── Validation ───────────────────────────────────────────────────────────

  it('returns error when tenantId is missing', async () => {
    const req = baseRequest({ tenantId: '' });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/tenantId/);
  });

  it('returns error when fileContent is empty', async () => {
    const req = baseRequest({ fileContent: '   ' });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/fileContent/);
  });

  // ── ATC round-trip ────────────────────────────────────────────────────────

  it('imports ATC_XML and persists to store', async () => {
    const xml = `
      <SATC_ATC_RUN_RESULT>
        <FINDINGS>
          <SATC_ATC_FINDING>
            <OBJECT_NAME>ZSVC_RUN</OBJECT_NAME>
            <OBJECT_TYPE>PROG</OBJECT_TYPE>
            <PRIORITY>1</PRIORITY>
            <CHECK_ID>CRITICAL_CHECK</CHECK_ID>
            <MESSAGE_TEXT>Critical issue</MESSAGE_TEXT>
          </SATC_ATC_FINDING>
        </FINDINGS>
      </SATC_ATC_RUN_RESULT>`;
    const req = baseRequest({ format: 'ATC_XML', fileContent: xml });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.evidence.type).toBe('ATC');
    expect(store.size).toBe(1);
  });

  // ── SCI round-trip ────────────────────────────────────────────────────────

  it('imports SCI_XML successfully', async () => {
    const xml = `
      <SCI_WORKLIST>
        <FINDING>
          <OBJECT_NAME>ZSCI_OBJ</OBJECT_NAME>
          <OBJECT_TYPE>CLAS</OBJECT_TYPE>
          <CHECK_ID>OBS_CHECK</CHECK_ID>
          <PRIORITY>2</PRIORITY>
          <MESSAGE_TEXT>Obsolete call</MESSAGE_TEXT>
        </FINDING>
      </SCI_WORKLIST>`;
    const req = baseRequest({ format: 'SCI_XML', fileContent: xml });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(true);
    expect(result.evidence.type).toBe('SCI');
    expect(result.importedCount).toBe(1);
  });

  // ── SCMON round-trip ──────────────────────────────────────────────────────

  it('imports SCMON_CSV successfully', async () => {
    const csv = ['ObjectName,ObjectType,CalledCount', 'ZSCMON,PROG,42'].join('\n');
    const req = baseRequest({ format: 'SCMON_CSV', fileContent: csv });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(true);
    expect(result.evidence.type).toBe('SCMON');
    expect(result.importedCount).toBe(1);
  });

  // ── CCM JSON round-trip ───────────────────────────────────────────────────

  it('imports CCM_JSON successfully', async () => {
    const json = JSON.stringify({
      objects: [{ objectName: 'ZCCM_SVC', objectType: 'PROG', status: 'INCOMPATIBLE' }],
    });
    const req = baseRequest({ format: 'CCM_JSON', fileContent: json });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(true);
    expect(result.evidence.type).toBe('CCM');
  });

  // ── CCM XML round-trip ────────────────────────────────────────────────────

  it('imports CCM_XML successfully', async () => {
    const xml = `
      <CCM_RESULTS>
        <OBJECT>
          <OBJECT_NAME>ZCCM_XML_OBJ</OBJECT_NAME>
          <OBJECT_TYPE>PROG</OBJECT_TYPE>
          <STATUS>COMPATIBLE</STATUS>
        </OBJECT>
      </CCM_RESULTS>`;
    const req = baseRequest({ format: 'CCM_XML', fileContent: xml });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(true);
    expect(result.evidence.type).toBe('CCM');
  });

  // ── Readiness Check round-trip ────────────────────────────────────────────

  it('imports READINESS_CHECK_JSON successfully', async () => {
    const json = JSON.stringify({
      customCode: {
        objects: [{ objectName: 'ZRC_OBJ', category: 'SYNTAX_CHECK', severity: 'MEDIUM' }],
      },
    });
    const req = baseRequest({ format: 'READINESS_CHECK_JSON', fileContent: json });
    const result = await svc.importEvidence(req);
    expect(result.success).toBe(true);
    expect(result.evidence.type).toBe('READINESS_CHECK');
    expect(result.importedCount).toBe(1);
  });

  // ── Store retrieval ───────────────────────────────────────────────────────

  it('getEvidenceForAnalysis returns stored records', async () => {
    const xml = `
      <SATC_ATC_RUN_RESULT>
        <FINDINGS>
          <SATC_ATC_FINDING>
            <OBJECT_NAME>ZSVC_STORE</OBJECT_NAME>
            <OBJECT_TYPE>PROG</OBJECT_TYPE>
            <PRIORITY>2</PRIORITY>
            <CHECK_ID>CHK</CHECK_ID>
            <MESSAGE_TEXT>msg</MESSAGE_TEXT>
          </SATC_ATC_FINDING>
        </FINDINGS>
      </SATC_ATC_RUN_RESULT>`;
    await svc.importEvidence(
      baseRequest({ format: 'ATC_XML', fileContent: xml }),
    );
    const records = await svc.getEvidenceForAnalysis(
      'tenant-1',
      'proj-1',
      'analysis-1',
    );
    expect(records).toHaveLength(1);
    expect(records[0].format).toBe('ATC_XML');
    expect(records[0].itemCount).toBe(1);
  });

  it('getEvidenceForAnalysis returns empty array with no store', async () => {
    const noStoreSvc = new EvidenceImportService();
    const records = await noStoreSvc.getEvidenceForAnalysis('t', 'p', 'a');
    expect(records).toHaveLength(0);
  });

  it('getEvidenceForAnalysis isolates by tenantId', async () => {
    const xml = `
      <SATC_ATC_RUN_RESULT>
        <FINDINGS>
          <SATC_ATC_FINDING>
            <OBJECT_NAME>ZTENANT_ISO</OBJECT_NAME>
            <OBJECT_TYPE>PROG</OBJECT_TYPE>
            <PRIORITY>3</PRIORITY>
            <CHECK_ID>CHK</CHECK_ID>
            <MESSAGE_TEXT>iso</MESSAGE_TEXT>
          </SATC_ATC_FINDING>
        </FINDINGS>
      </SATC_ATC_RUN_RESULT>`;
    // Import under tenant-1
    await svc.importEvidence(
      baseRequest({ tenantId: 'tenant-1', format: 'ATC_XML', fileContent: xml }),
    );
    // Query under tenant-2 – must see nothing
    const records = await svc.getEvidenceForAnalysis('tenant-2', 'proj-1', 'analysis-1');
    expect(records).toHaveLength(0);
  });

  it('does not persist when parse produced 0 items', async () => {
    // Empty ATC XML – zero findings
    const xml = '<SATC_ATC_RUN_RESULT><FINDINGS/></SATC_ATC_RUN_RESULT>';
    const req = baseRequest({ format: 'ATC_XML', fileContent: xml });
    const result = await svc.importEvidence(req);
    // success=true (no errors), but zero items → no persistence
    expect(result.importedCount).toBe(0);
    expect(store.size).toBe(0);
  });

  it('propagates format and fileName to stored record', async () => {
    const csv = ['ObjectName,ObjectType,CalledCount', 'ZPROP,PROG,5'].join('\n');
    await svc.importEvidence(
      baseRequest({
        format: 'SCMON_CSV',
        fileContent: csv,
        originalFileName: 'my_scmon.csv',
      }),
    );
    const records = await svc.getEvidenceForAnalysis('tenant-1', 'proj-1', 'analysis-1');
    expect(records[0].format).toBe('SCMON_CSV');
    expect(records[0].originalFileName).toBe('my_scmon.csv');
    expect(records[0].importedBy).toBe('tester');
  });

  it('InMemoryEvidenceStore.clear() resets store', async () => {
    const csv = ['ObjectName,ObjectType,CalledCount', 'ZCLEAR,PROG,1'].join('\n');
    await svc.importEvidence(
      baseRequest({ format: 'SCMON_CSV', fileContent: csv }),
    );
    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
  });

  it('multiple imports accumulate in store', async () => {
    const atcXml = `
      <SATC_ATC_RUN_RESULT>
        <FINDINGS>
          <SATC_ATC_FINDING>
            <OBJECT_NAME>ZMULTI</OBJECT_NAME><OBJECT_TYPE>PROG</OBJECT_TYPE>
            <PRIORITY>2</PRIORITY><CHECK_ID>C</CHECK_ID><MESSAGE_TEXT>m</MESSAGE_TEXT>
          </SATC_ATC_FINDING>
        </FINDINGS>
      </SATC_ATC_RUN_RESULT>`;
    const csv = ['ObjectName,ObjectType,CalledCount', 'ZMULTI2,PROG,3'].join('\n');
    await svc.importEvidence(baseRequest({ format: 'ATC_XML', fileContent: atcXml }));
    await svc.importEvidence(baseRequest({ format: 'SCMON_CSV', fileContent: csv }));
    expect(store.size).toBe(2);
    const records = await svc.getEvidenceForAnalysis('tenant-1', 'proj-1', 'analysis-1');
    expect(records).toHaveLength(2);
  });
});
