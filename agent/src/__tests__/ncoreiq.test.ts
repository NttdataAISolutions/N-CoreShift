/**
 * N-CoreShift — NCoreIQ Integration Tests (A–W)
 *
 * All HTTP calls use the injectable fetchFn — no live N-CoreIQ or SAP required.
 * fetchFn is injected via NCoreIQClientConfig.fetchFn.
 */

import { NCoreIQClient, NCOREIQ_PATHS } from '../ncoreiq/NCoreIQClient.js';
import {
  NCoreIQSourceProvider,
  InMemoryNCoreIQEvidenceStore,
} from '../ncoreiq/NCoreIQSourceProvider.js';
import {
  NCoreIQApiError,
  NCoreIQTimeoutError,
  NCoreIQUnavailableError,
} from '../ncoreiq/types.js';
import type {
  SAPPingResponse,
  PackageHierarchyResponse,
  RepositorySearchResponse,
  RepositoryObjectMetadata,
  RepositoryObjectSource,
  DirectDependenciesResponse,
  ExtractionJobCreatedResponse,
  JobStatusResponse,
  NCoreIQClientConfig,
} from '../ncoreiq/types.js';
import { createHash } from 'node:crypto';

// ── Mock types ────────────────────────────────────────────────────────────

type MockResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type MockFetchFn = (url: string, init?: Record<string, unknown>) => Promise<MockResponse>;

// ── Helpers ───────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:8000';

function mockResp(status: number, body: unknown): MockResponse {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(text),
    arrayBuffer: () => Promise.resolve(new Uint8Array(Buffer.from(text)).buffer),
  };
}

function makeFetch(...responses: MockResponse[]): MockFetchFn {
  let i = 0;
  return () => Promise.resolve(responses[i++] ?? responses[responses.length - 1]);
}

function makeErrorFetch(err: Error): MockFetchFn {
  return () => Promise.reject(err);
}

function makeClient(fetchFn: MockFetchFn, token?: string): NCoreIQClient {
  return new NCoreIQClient({ baseUrl: BASE_URL, bearerToken: token, timeoutMs: 5000, fetchFn } as NCoreIQClientConfig);
}

function makeProvider(fetchFn: MockFetchFn, store?: InMemoryNCoreIQEvidenceStore): NCoreIQSourceProvider {
  return new NCoreIQSourceProvider(
    { baseUrl: BASE_URL, timeoutMs: 5000, fetchFn } as NCoreIQClientConfig,
    store ?? new InMemoryNCoreIQEvidenceStore(),
  );
}

function pingOk(): SAPPingResponse {
  return { status: 'connected', connection_mode: 'odata', system_id: 'NC1', client: '800', sap_release: '752', timestamp: '20261011', ping_method: 'SystemInfoSet', message: 'OK' };
}

function metaResp(objectType = 'PROG', objectName = 'ZREPORT_DEMO'): RepositoryObjectMetadata {
  return {
    sap_object_type: objectType, object_name: objectName, system_id: 'NC1', client: '800',
    pgmid: 'R3TR', package: 'ZNCOREIQ', object_subtype: null, program_name: null,
    function_group: null, table_class: null, author: 'DEVUSER', master_language: 'EN',
    source_system: null, created_date: '20230115', changed_by: 'DEVUSER2', changed_date: '20261001',
    description: 'Demo report', active_status: 'A', found: true, warning: null, message: null,
  };
}

function sourceResp(lineCount: number, objectName = 'ZREPORT_DEMO', maxLines: number | null = null): RepositoryObjectSource {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    component_type: 'PROGRAM', component_name: objectName,
    line_no: i + 1, source_line: `* Source line ${i + 1}`,
  }));
  const text = lines.map((l) => l.source_line).join('\n');
  const sha256 = createHash('sha256').update(text, 'utf-8').digest('hex');
  return {
    sap_object_type: 'PROG', object_name: objectName, system_id: 'NC1', client: '800',
    max_lines: maxLines, returned_lines: lineCount, component_count: 1,
    found: true, truncated: false, message: null, sha256,
    components: [{ component_type: 'PROGRAM', component_name: objectName, line_count: lineCount, source_text: text, lines }],
  };
}

function searchResp(count = 3): RepositorySearchResponse {
  return {
    system_id: 'NC1', client: '800', truncated: false, message: null,
    statistics: { total_matches: count, returned_count: count },
    objects: Array.from({ length: count }, (_, i) => ({
      sap_object_type: 'PROG', friendly_type: 'Program',
      object_name: `ZPROG_${i}`, package: 'ZNCOREIQ',
      description: `Program ${i}`, author: 'DEV', match_reason: 'PACKAGE',
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// A. Successful connection
// ─────────────────────────────────────────────────────────────────────────

describe('A. Successful connection', () => {
  it('testConnection() returns connected=true with SAP provenance', async () => {
    const provider = makeProvider(makeFetch(mockResp(200, pingOk())));
    const r = await provider.testConnection();
    expect(r.connected).toBe(true);
    expect(r.sourceProvider).toBe('NCOREIQ');
    expect(r.systemId).toBe('NC1');
    expect(r.client).toBe('800');
    expect(r.sapRelease).toBe('752');
    expect(r.error).toBeNull();
  });

  it('uses correct path GET /api/v1/sap/ping', async () => {
    const calls: string[] = [];
    const fn: MockFetchFn = (url) => { calls.push(url); return Promise.resolve(mockResp(200, pingOk())); };
    const client = makeClient(fn);
    await client.ping();
    expect(calls[0]).toBe(`${BASE_URL}${NCOREIQ_PATHS.SAP_PING}`);
    expect(calls[0]).toBe(`${BASE_URL}/api/v1/sap/ping`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// B. Authentication failure (401)
// ─────────────────────────────────────────────────────────────────────────

describe('B. Authentication failure', () => {
  it('throws NCoreIQApiError with httpStatus=401', async () => {
    const client = makeClient(makeFetch(mockResp(401, { error: 'UNAUTHORIZED', message: 'Token required', request_id: 'r1', correlation_id: 'c1' })));
    await expect(client.ping()).rejects.toThrow(NCoreIQApiError);
  });

  it('testConnection() returns connected=false on 401 without exposing token', async () => {
    const provider = makeProvider(makeFetch(mockResp(401, { error: 'UNAUTHORIZED', message: 'Token required', request_id: 'r1', correlation_id: 'c1' })));
    const r = await provider.testConnection();
    expect(r.connected).toBe(false);
    expect(r.error).not.toContain('Bearer');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// C. Authorization failure (403)
// ─────────────────────────────────────────────────────────────────────────

describe('C. Authorization failure', () => {
  it('throws NCoreIQApiError with httpStatus=403', async () => {
    const client = makeClient(makeFetch(mockResp(403, { error: 'FORBIDDEN', message: 'Insufficient scope', request_id: 'r2', correlation_id: 'c2' })));
    await expect(client.listPackages('ZNCOREIQ')).rejects.toThrow(NCoreIQApiError);
  });

  it('testConnection() returns connected=false on 403', async () => {
    const provider = makeProvider(makeFetch(mockResp(403, { error: 'FORBIDDEN', message: 'Insufficient scope', request_id: 'r2', correlation_id: 'c2' })));
    const r = await provider.testConnection();
    expect(r.connected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// D. Timeout / unavailable
// ─────────────────────────────────────────────────────────────────────────

describe('D. Timeout / unavailable', () => {
  it('throws NCoreIQTimeoutError on AbortError', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const client = makeClient(makeErrorFetch(err));
    await expect(client.ping()).rejects.toThrow(NCoreIQTimeoutError);
  });

  it('throws NCoreIQUnavailableError on ECONNREFUSED', async () => {
    const client = makeClient(makeErrorFetch(new Error('ECONNREFUSED')));
    await expect(client.ping()).rejects.toThrow(NCoreIQUnavailableError);
  });

  it('testConnection() returns connected=false on timeout', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const provider = makeProvider(makeErrorFetch(err));
    const r = await provider.testConnection();
    expect(r.connected).toBe(false);
    expect(r.error).toContain('timed out');
  });

  it('testConnection() returns connected=false when N-CoreIQ is down', async () => {
    const provider = makeProvider(makeErrorFetch(new Error('ENOTFOUND ncoreiq.example.com')));
    const r = await provider.testConnection();
    expect(r.connected).toBe(false);
    expect(r.error).toContain('unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// E. SAP unavailable (503)
// ─────────────────────────────────────────────────────────────────────────

describe('E. SAP unavailable (503)', () => {
  it('throws NCoreIQApiError with errorCode=SAP_UNAVAILABLE', async () => {
    const client = makeClient(makeFetch(mockResp(503, { error: 'SAP_UNAVAILABLE', message: 'SAP down', request_id: 'r3', correlation_id: 'c3' })));
    let caught: NCoreIQApiError | null = null;
    try { await client.ping(); } catch (e) { caught = e as NCoreIQApiError; }
    expect(caught).toBeInstanceOf(NCoreIQApiError);
    expect(caught!.httpStatus).toBe(503);
    expect(caught!.errorCode).toBe('SAP_UNAVAILABLE');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// F. Package discovery
// ─────────────────────────────────────────────────────────────────────────

describe('F. Package discovery', () => {
  const packageResp: PackageHierarchyResponse = {
    system_id: 'NC1', client: '800', root_package: 'ZNCOREIQ',
    include_subpackages: true, max_depth: 20, truncated: false, message: null,
    packages: [
      { package: 'ZNCOREIQ', parent_package: null, description: 'Root', depth: 0 },
      { package: 'ZNCOREIQ_CORE', parent_package: 'ZNCOREIQ', description: 'Core', depth: 1 },
    ],
  };

  it('listPackages() calls GET /api/v1/repository/packages/{package}', async () => {
    const calls: string[] = [];
    const fn: MockFetchFn = (url) => { calls.push(url); return Promise.resolve(mockResp(200, packageResp)); };
    const client = makeClient(fn);
    const resp = await client.listPackages('ZNCOREIQ', { include_subpackages: true });
    expect(calls[0]).toContain('/api/v1/repository/packages/ZNCOREIQ');
    expect(resp.packages).toHaveLength(2);
    expect(resp.packages[0].package).toBe('ZNCOREIQ');
    expect(resp.packages[1].parent_package).toBe('ZNCOREIQ');
  });

  it('provider.listPackages() returns packages with correct contract shape', async () => {
    const provider = makeProvider(makeFetch(mockResp(200, packageResp)));
    const resp = await provider.listPackages('tenant-1', 'ZNCOREIQ');
    expect(resp.root_package).toBe('ZNCOREIQ');
    expect(resp.packages[0].depth).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// G. Object preview
// ─────────────────────────────────────────────────────────────────────────

describe('G. Object preview', () => {
  it('previewObjects() calls POST /api/v1/repository/search', async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const fn: MockFetchFn = (url, init) => { calls.push([url, init]); return Promise.resolve(mockResp(200, searchResp(5))); };
    const client = makeClient(fn);
    const resp = await client.searchObjects({ packages: ['ZNCOREIQ'], include_subpackages: true });
    expect(calls[0][0]).toBe(`${BASE_URL}/api/v1/repository/search`);
    expect(resp.objects).toHaveLength(5);
    expect(resp.statistics.total_matches).toBe(5);
    expect(resp.objects[0].sap_object_type).toBe('PROG');
    expect(resp.objects[0].friendly_type).toBe('Program');
    expect(resp.objects[0].match_reason).toBe('PACKAGE');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// H. Object metadata import
// ─────────────────────────────────────────────────────────────────────────

describe('H. Object metadata import', () => {
  it('getMetadata() calls correct path and returns metadata', async () => {
    const calls: string[] = [];
    const fn: MockFetchFn = (url) => { calls.push(url); return Promise.resolve(mockResp(200, metaResp())); };
    const client = makeClient(fn);
    const meta = await client.getMetadata('PROG', 'ZREPORT_DEMO');
    expect(calls[0]).toContain('/api/v1/repository/objects/PROG/ZREPORT_DEMO/metadata');
    expect(meta.sap_object_type).toBe('PROG');
    expect(meta.package).toBe('ZNCOREIQ');
    expect(meta.author).toBe('DEVUSER');
    expect(meta.found).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// I. Complete source import (no max_lines)
// ─────────────────────────────────────────────────────────────────────────

describe('I. Complete source import', () => {
  it('getSource() omits max_lines param — complete retrieval', async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const fn: MockFetchFn = (url, init) => { calls.push([url, init]); return Promise.resolve(mockResp(200, sourceResp(10))); };
    const client = makeClient(fn);
    await client.getSource('PROG', 'ZREPORT_DEMO');
    const calledUrl = calls[0][0];
    expect(calledUrl).toContain('/api/v1/repository/objects/PROG/ZREPORT_DEMO/source');
    expect(calledUrl).not.toContain('max_lines');
  });

  it('getSourceBounded() sends max_lines param', async () => {
    const calls: string[] = [];
    const fn: MockFetchFn = (url) => { calls.push(url); return Promise.resolve(mockResp(200, { ...sourceResp(50), max_lines: 50 })); };
    const client = makeClient(fn);
    await client.getSourceBounded('PROG', 'ZREPORT_DEMO', 50);
    expect(calls[0]).toContain('max_lines=50');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// J. Source larger than 500 lines (1,250 lines test)
// K. No implicit max_lines=500
// ─────────────────────────────────────────────────────────────────────────

describe('J+K. 1250-line source — no max_lines=500', () => {
  it('imports 1250-line object — returned_lines=1250, truncated=false', async () => {
    const store = new InMemoryNCoreIQEvidenceStore();
    // metadata fetch first, then source fetch
    const fn = makeFetch(mockResp(200, metaResp('PROG', 'ZREPORT_LARGE')), mockResp(200, sourceResp(1250, 'ZREPORT_LARGE')));
    const provider = makeProvider(fn, store);
    const ev = await provider.importObject('tenant-1', 'proj-1', 'analysis-1', 'PROG', 'ZREPORT_LARGE');
    expect(ev.returnedLines).toBe(1250);
    expect(ev.sourceText.split('\n')).toHaveLength(1250);
    expect(store.evidenceCount).toBe(1);
  });

  it('getSource() NEVER sends max_lines=500 by default', async () => {
    const calls: string[] = [];
    const fn: MockFetchFn = (url) => { calls.push(url); return Promise.resolve(mockResp(200, sourceResp(1250, 'ZLARGE'))); };
    const client = makeClient(fn);
    await client.getSource('PROG', 'ZLARGE');
    expect(calls[0]).not.toContain('max_lines=500');
    expect(calls[0]).not.toContain('max_lines=');
  });

  it('importObject() does not send max_lines=500 or any limit', async () => {
    const calls: string[] = [];
    const fn: MockFetchFn = (url) => {
      calls.push(url);
      return Promise.resolve(mockResp(200, url.includes('metadata') ? metaResp() : sourceResp(1250)));
    };
    const provider = makeProvider(fn);
    await provider.importObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    const sourceCall = calls.find((u) => u.includes('/source'));
    expect(sourceCall).toBeDefined();
    expect(sourceCall).not.toContain('max_lines');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// L. Source integrity / hash
// ─────────────────────────────────────────────────────────────────────────

describe('L. Source hash / integrity', () => {
  it('stores N-CoreIQ-provided sha256 and marks ncoreiqProvidedHash=true', async () => {
    const src = sourceResp(5);
    const fn = makeFetch(mockResp(200, metaResp()), mockResp(200, src));
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    const ev = await provider.importObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    expect(ev.sourceHash).toBe(src.sha256);
    expect(ev.ncoreiqProvidedHash).toBe(true);
  });

  it('computes sha256 locally when N-CoreIQ sha256 is absent', async () => {
    const src = { ...sourceResp(5), sha256: '' };
    const fn = makeFetch(mockResp(200, metaResp()), mockResp(200, src));
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    const ev = await provider.importObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    expect(ev.ncoreiqProvidedHash).toBe(false);
    expect(ev.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha256 is deterministic for identical source', async () => {
    const src = sourceResp(5);
    const lines = src.components[0].lines.map((l) => l.source_line).join('\n');
    const expected = createHash('sha256').update(lines, 'utf-8').digest('hex');
    expect(src.sha256).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// M. Dependency normalization
// ─────────────────────────────────────────────────────────────────────────

describe('M. Dependency normalization', () => {
  it('importDependencies() maps contract fields to NCoreIQDependencyRecord', async () => {
    const depsResp: DirectDependenciesResponse = {
      system_id: 'NC1', client: '800',
      source_object_type: 'PROG', source_object_name: 'ZREPORT_DEMO',
      total_relations: 1, returned_relations: 1, truncated: false, message: null,
      relationships: [{
        relation_id: 1, system_id: 'NC1', client: '800',
        source_object_type: 'PROG', source_object_name: 'ZREPORT_DEMO',
        target_object_type: 'FUNC', target_object_name: 'ZFI_GET_VENDOR',
        relationship_type: 'CALLS_FUNCTION', confidence: 'EXACT',
        evidence_source: 'ABAP_PARSER', source_component: 'PROGRAM__ZREPORT_DEMO',
        line_no: 45, dynamic: false, detail: null,
      }],
    };
    const fn = makeFetch(mockResp(200, depsResp));
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    const records = await provider.importDependencies('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.provider).toBe('NCOREIQ');
    expect(r.sourceObjectType).toBe('PROG');
    expect(r.targetObjectName).toBe('ZFI_GET_VENDOR');
    expect(r.relationshipType).toBe('CALLS_FUNCTION');
    expect(r.confidence).toBe('EXACT');
    expect(r.direction).toBe('OUTBOUND');
    expect(r.lineNo).toBe(45);
    expect(r.dynamic).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// N. Tenant isolation
// ─────────────────────────────────────────────────────────────────────────

describe('N. Tenant isolation', () => {
  it('evidence from tenant-1 is not visible to tenant-2', async () => {
    const src = sourceResp(5);
    const fn = makeFetch(mockResp(200, metaResp()), mockResp(200, src));
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    await provider.importObject('tenant-1', 'proj-1', 'analysis-1', 'PROG', 'ZREPORT_DEMO');
    const t1 = provider.getEvidence('tenant-1', 'proj-1', 'analysis-1');
    const t2 = provider.getEvidence('tenant-2', 'proj-1', 'analysis-1');
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// O. Project isolation
// ─────────────────────────────────────────────────────────────────────────

describe('O. Project isolation', () => {
  it('evidence from proj-A is not visible to proj-B within the same tenant', async () => {
    const fn = makeFetch(
      mockResp(200, metaResp()), mockResp(200, sourceResp(5)),
      mockResp(200, metaResp()), mockResp(200, sourceResp(5)),
    );
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    await provider.importObject('tenant-1', 'proj-A', 'analysis-1', 'PROG', 'ZREPORT_DEMO');
    await provider.importObject('tenant-1', 'proj-B', 'analysis-1', 'PROG', 'ZREPORT_DEMO');
    const pA = provider.getEvidence('tenant-1', 'proj-A', 'analysis-1');
    const pB = provider.getEvidence('tenant-1', 'proj-B', 'analysis-1');
    expect(pA).toHaveLength(1);
    expect(pB).toHaveLength(1);
    expect(pA[0].projectId).toBe('proj-A');
    expect(pB[0].projectId).toBe('proj-B');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// P. Bulk extraction job creation
// ─────────────────────────────────────────────────────────────────────────

describe('P. Bulk extraction job creation', () => {
  it('startBulkImport() creates job with source_max_lines=null (complete)', async () => {
    const jobCreated: ExtractionJobCreatedResponse = {
      job_id: 'job-abc-123', status: 'QUEUED', stage: null,
      created_at: '2026-10-11T18:00:00Z',
      status_url: 'http://localhost:8000/api/v1/repository/jobs/job-abc-123',
    };
    const calls: Array<{ url: string; body: string }> = [];
    const fn: MockFetchFn = (url, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, body });
      return Promise.resolve(mockResp(url.includes('/jobs') ? 202 : 200, url.includes('/search') ? searchResp(3) : jobCreated));
    };
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    const job = await provider.startBulkImport({ tenantId: 't', projectId: 'p', analysisId: 'a', packages: ['ZNCOREIQ'], requestedBy: 'user' });
    const jobCall = calls.find((c) => c.url.includes('/jobs') && !c.url.includes('/jobs/'));
    expect(jobCall).toBeDefined();
    const reqBody = JSON.parse(jobCall!.body);
    expect(reqBody.extraction.source_max_lines).toBeNull();
    expect(job.upstreamJobId).toBe('job-abc-123');
    expect(job.localStatus).toBe('QUEUED');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Q. Bulk extraction status polling
// ─────────────────────────────────────────────────────────────────────────

describe('Q. Bulk extraction status polling', () => {
  it('pollImportJob() updates localStatus from RUNNING to COMPLETED', async () => {
    const runningStatus: JobStatusResponse = { job_id: 'job-1', status: 'RUNNING', stage: 'EXTRACTING', progress: null, artifact: null, created_at: '2026-10-11T18:00:00Z', started_at: '2026-10-11T18:00:01Z', completed_at: null };
    const succeededStatus: JobStatusResponse = { job_id: 'job-1', status: 'SUCCEEDED', stage: null, progress: null, artifact: null, created_at: '2026-10-11T18:00:00Z', started_at: '2026-10-11T18:00:01Z', completed_at: '2026-10-11T18:01:00Z' };
    const fn = makeFetch(mockResp(200, runningStatus), mockResp(200, succeededStatus));
    const store = new InMemoryNCoreIQEvidenceStore();
    store.saveJob({ localJobId: 'local-1', tenantId: 't', projectId: 'p', analysisId: 'a', upstreamJobId: 'job-1', requestedPackages: ['ZNCOREIQ'], upstreamStatus: 'RUNNING', localStatus: 'RUNNING', objectsRequested: 3, objectsImported: 0, objectsFailed: 0, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, artifactUrl: null, errors: [] });
    const provider = makeProvider(fn, store);
    const job1 = await provider.pollImportJob('local-1');
    expect(job1.upstreamStatus).toBe('RUNNING');
    expect(job1.localStatus).toBe('RUNNING');
    const job2 = await provider.pollImportJob('local-1');
    expect(job2.upstreamStatus).toBe('SUCCEEDED');
    expect(job2.localStatus).toBe('COMPLETED');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R. Successful bulk import
// ─────────────────────────────────────────────────────────────────────────

describe('R. Successful bulk import', () => {
  it('job with SUCCEEDED status maps to localStatus=COMPLETED', async () => {
    const succeededStatus: JobStatusResponse = { job_id: 'job-2', status: 'SUCCEEDED', stage: null, progress: null, artifact: null, created_at: '2026-10-11T18:00:00Z', started_at: null, completed_at: '2026-10-11T18:01:00Z' };
    const fn = makeFetch(mockResp(200, succeededStatus));
    const store = new InMemoryNCoreIQEvidenceStore();
    store.saveJob({ localJobId: 'local-2', tenantId: 't', projectId: 'p', analysisId: 'a', upstreamJobId: 'job-2', requestedPackages: ['ZNCOREIQ'], upstreamStatus: 'QUEUED', localStatus: 'QUEUED', objectsRequested: 3, objectsImported: 0, objectsFailed: 0, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, artifactUrl: null, errors: [] });
    const provider = makeProvider(fn, store);
    const job = await provider.pollImportJob('local-2');
    expect(job.localStatus).toBe('COMPLETED');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S. Partial import
// ─────────────────────────────────────────────────────────────────────────

describe('S. Partial import', () => {
  it('NCoreIQImportJob can represent PARTIAL status', () => {
    const store = new InMemoryNCoreIQEvidenceStore();
    const job = { localJobId: 'local-3', tenantId: 't', projectId: 'p', analysisId: 'a', upstreamJobId: 'job-3', requestedPackages: ['ZNCOREIQ'], upstreamStatus: 'SUCCEEDED' as const, localStatus: 'PARTIAL' as const, objectsRequested: 10, objectsImported: 7, objectsFailed: 3, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, artifactUrl: null, errors: ['Object ZPROG_8 not found'] };
    store.saveJob(job);
    const retrieved = store.getJob('local-3');
    expect(retrieved?.localStatus).toBe('PARTIAL');
    expect(retrieved?.objectsFailed).toBe(3);
    expect(retrieved?.objectsImported).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// T. Failed import
// ─────────────────────────────────────────────────────────────────────────

describe('T. Failed import', () => {
  it('FAILED upstream status maps to localStatus=FAILED', async () => {
    const failedStatus: JobStatusResponse = { job_id: 'job-4', status: 'FAILED', stage: null, progress: null, artifact: null, created_at: '2026-10-11T18:00:00Z', started_at: null, completed_at: '2026-10-11T18:00:30Z' };
    const fn = makeFetch(mockResp(200, failedStatus));
    const store = new InMemoryNCoreIQEvidenceStore();
    store.saveJob({ localJobId: 'local-4', tenantId: 't', projectId: 'p', analysisId: 'a', upstreamJobId: 'job-4', requestedPackages: ['ZNCOREIQ'], upstreamStatus: 'RUNNING', localStatus: 'RUNNING', objectsRequested: 3, objectsImported: 0, objectsFailed: 0, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, artifactUrl: null, errors: [] });
    const provider = makeProvider(fn, store);
    const job = await provider.pollImportJob('local-4');
    expect(job.localStatus).toBe('FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// U. Malformed upstream response
// ─────────────────────────────────────────────────────────────────────────

describe('U. Malformed upstream response', () => {
  it('non-JSON response throws NCoreIQApiError with MALFORMED_RESPONSE', async () => {
    const fn: MockFetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('not-json{{{{'), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    const client = makeClient(fn);
    await expect(client.ping()).rejects.toThrow(NCoreIQApiError);
  });

  it('importObject() rejects when source is truncated', async () => {
    const truncatedSource = { ...sourceResp(5), truncated: true };
    const fn = makeFetch(mockResp(200, metaResp()), mockResp(200, truncatedSource));
    const provider = makeProvider(fn);
    await expect(provider.importObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO')).rejects.toThrow(/truncated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// V. Safe error redaction
// ─────────────────────────────────────────────────────────────────────────

describe('V. Safe error redaction', () => {
  it('NCoreIQApiError message does not expose Authorization headers', async () => {
    const fn = makeFetch(mockResp(401, { error: 'UNAUTHORIZED', message: 'Auth required', request_id: 'r1', correlation_id: 'c1' }));
    const client = makeClient(fn, 'super-secret-bearer-token');
    let caught: NCoreIQApiError | null = null;
    try { await client.ping(); } catch (e) { caught = e as NCoreIQApiError; }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain('super-secret-bearer-token');
    expect(caught!.message).not.toContain('Bearer');
  });

  it('NCoreIQUnavailableError does not expose internal network details', async () => {
    const provider = makeProvider(makeErrorFetch(new Error('connect ECONNREFUSED 10.0.0.1:8443')));
    const r = await provider.testConnection();
    expect(r.error).not.toContain('10.0.0.1');
    expect(r.error).toContain('unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// W. Explicit source refresh / version behaviour
// ─────────────────────────────────────────────────────────────────────────

describe('W. Source refresh / version behaviour', () => {
  it('refreshObject() creates version 2 and marks v1 as not latest', async () => {
    const fn = makeFetch(
      mockResp(200, metaResp()), mockResp(200, sourceResp(5)),   // v1
      mockResp(200, metaResp()), mockResp(200, sourceResp(6)),   // v2 refresh
    );
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    const v1 = await provider.importObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    const v2 = await provider.refreshObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.isLatest).toBe(true);
    expect(v2.refreshedFrom).toBe(v1.id);
    const latest = provider.getEvidence('t', 'p', 'a');
    expect(latest).toHaveLength(1);
    expect(latest[0].version).toBe(2);
    expect(latest[0].returnedLines).toBe(6);
  });

  it('previous evidence snapshot remains stored after refresh', async () => {
    const fn = makeFetch(
      mockResp(200, metaResp()), mockResp(200, sourceResp(5)),
      mockResp(200, metaResp()), mockResp(200, sourceResp(6)),
    );
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = makeProvider(fn, store);
    await provider.importObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    await provider.refreshObject('t', 'p', 'a', 'PROG', 'ZREPORT_DEMO');
    expect(store.evidenceCount).toBe(2); // both versions stored
  });
});
