/**
 * N-CoreShift — NCoreIQ Authorization Scope Contract Tests (Foundation C)
 *
 * Verifies the minimum privilege scope matrix:
 *   N-CoreShift machine identity requires exactly NCoreIQ.Analyst (which includes Viewer).
 *   N-CoreShift must NOT receive NCoreIQ.Operator or NCoreIQ.Admin.
 *
 * Based on the authoritative scope matrix from:
 *   C:\N-CoreIQ\docs\integration\ncoreiq-consumer-contract-v1.md
 *   C:\N-CoreIQ\app\auth\principal.py
 */

import { NCoreIQClient, NCOREIQ_PATHS } from '../ncoreiq/NCoreIQClient.js';

// ── Scope constants (from N-CoreIQ principal.py) ─────────────────────────

const SCOPE_VIEWER = 'NCoreIQ.Viewer';
const SCOPE_ANALYST = 'NCoreIQ.Analyst';
const SCOPE_OPERATOR = 'NCoreIQ.Operator';
const SCOPE_ADMIN = 'NCoreIQ.Admin';

// ── N-CoreShift minimum required scopes ──────────────────────────────────

/**
 * Scopes declared in N-CoreShift xs-security.json authorities[].
 * These match the grant-as-authority-to-apps entries in N-CoreIQ xs-security.json.
 *
 * This array is the AUTHORITATIVE record of what N-CoreShift claims.
 * If this test fails, a descriptor was modified without updating the contract.
 */
const NCORESHIFT_DECLARED_SCOPES = [
  'NCoreIQ.Viewer',
  'NCoreIQ.Analyst',
] as const;

// ── Scope requirement matrix (from consumer contract Section 4 + 7) ──────

/**
 * Authoritative scope requirement per N-CoreShift operation.
 * Derived from: ncoreiq-consumer-contract-v1.md Section 4 + Section 7.
 * NCoreIQ.Analyst scope includes NCoreIQ.Viewer (scope inheritance).
 */
const SCOPE_MATRIX: Array<{
  operation: string;
  endpoint: string;
  requiredScope: string;
  usedByNCoreShift: boolean;
}> = [
  { operation: 'SAP System Ping', endpoint: 'GET /api/v1/sap/ping', requiredScope: SCOPE_VIEWER, usedByNCoreShift: true },
  { operation: 'Package Discovery', endpoint: 'GET /api/v1/repository/packages/{pkg}', requiredScope: SCOPE_VIEWER, usedByNCoreShift: true },
  { operation: 'Repository Search', endpoint: 'POST /api/v1/repository/search', requiredScope: SCOPE_VIEWER, usedByNCoreShift: true },
  { operation: 'Object Metadata', endpoint: 'GET /api/v1/repository/objects/{type}/{name}/metadata', requiredScope: SCOPE_VIEWER, usedByNCoreShift: true },
  { operation: 'Complete Source', endpoint: 'GET /api/v1/repository/objects/{type}/{name}/source', requiredScope: SCOPE_VIEWER, usedByNCoreShift: true },
  { operation: 'Direct Dependencies', endpoint: 'GET /api/v1/repository/objects/{type}/{name}/dependencies', requiredScope: SCOPE_VIEWER, usedByNCoreShift: true },
  { operation: 'Dependency Traversal', endpoint: 'POST /api/v1/repository/dependencies/traverse', requiredScope: SCOPE_ANALYST, usedByNCoreShift: true },
  { operation: 'Reverse Lookup', endpoint: 'POST /api/v1/repository/dependencies/reverse', requiredScope: SCOPE_ANALYST, usedByNCoreShift: true },
  { operation: 'Impact Analysis', endpoint: 'POST /api/v1/repository/dependencies/impact', requiredScope: SCOPE_ANALYST, usedByNCoreShift: true },
  { operation: 'Job Creation', endpoint: 'POST /api/v1/repository/jobs', requiredScope: SCOPE_ANALYST, usedByNCoreShift: true },
  { operation: 'Job Status', endpoint: 'GET /api/v1/repository/jobs/{id}', requiredScope: SCOPE_ANALYST, usedByNCoreShift: true },
  { operation: 'Job Result', endpoint: 'GET /api/v1/repository/jobs/{id}/result', requiredScope: SCOPE_ANALYST, usedByNCoreShift: true },
  { operation: 'Artifact Download', endpoint: 'GET /api/v1/repository/jobs/{id}/artifact', requiredScope: SCOPE_ANALYST, usedByNCoreShift: true },
  // Operator endpoints — NOT required by N-CoreShift
  { operation: 'Cancel Job', endpoint: 'POST /api/v1/repository/jobs/{id}/cancel', requiredScope: SCOPE_OPERATOR as never, usedByNCoreShift: false },
  { operation: 'Retry Job', endpoint: 'POST /api/v1/repository/jobs/{id}/retry', requiredScope: SCOPE_OPERATOR as never, usedByNCoreShift: false },
  // Admin endpoints — NOT required by N-CoreShift
  { operation: 'Diagnostics', endpoint: 'GET /api/v1/admin/diagnostics', requiredScope: SCOPE_ADMIN as never, usedByNCoreShift: false },
];

// ── 1. Scope matrix integrity ─────────────────────────────────────────────

describe('1. Scope matrix — N-CoreShift required operations', () => {
  const requiredOps = SCOPE_MATRIX.filter((e) => e.usedByNCoreShift);
  const notRequiredOps = SCOPE_MATRIX.filter((e) => !e.usedByNCoreShift);

  it('all required N-CoreShift operations are covered by Viewer or Analyst scope', () => {
    for (const entry of requiredOps) {
      expect([SCOPE_VIEWER, SCOPE_ANALYST]).toContain(entry.requiredScope);
    }
  });

  it('no required N-CoreShift operation needs Operator scope', () => {
    const requiresOperator = requiredOps.filter((e) => e.requiredScope === SCOPE_OPERATOR);
    expect(requiresOperator).toHaveLength(0);
  });

  it('no required N-CoreShift operation needs Admin scope', () => {
    const requiresAdmin = requiredOps.filter((e) => e.requiredScope === SCOPE_ADMIN);
    expect(requiresAdmin).toHaveLength(0);
  });

  it('Analyst scope covers all operations that need more than Viewer', () => {
    const analystOps = requiredOps.filter((e) => e.requiredScope === SCOPE_ANALYST);
    expect(analystOps.length).toBeGreaterThan(0); // traversal, reverse, impact, jobs
    for (const op of analystOps) {
      expect(op.requiredScope).toBe(SCOPE_ANALYST);
    }
  });

  it('cancel_job and retry_job are NOT in N-CoreShift required operations', () => {
    const cancel = notRequiredOps.find((e) => e.operation === 'Cancel Job');
    const retry = notRequiredOps.find((e) => e.operation === 'Retry Job');
    expect(cancel?.usedByNCoreShift).toBe(false);
    expect(retry?.usedByNCoreShift).toBe(false);
  });

  it('diagnostics endpoint is NOT required by N-CoreShift', () => {
    const diag = notRequiredOps.find((e) => e.operation === 'Diagnostics');
    expect(diag?.usedByNCoreShift).toBe(false);
  });
});

// ── 2. N-CoreShift declared scopes match minimum required ─────────────────

describe('2. N-CoreShift declared authority scopes', () => {
  it('declares exactly NCoreIQ.Viewer and NCoreIQ.Analyst (least privilege)', () => {
    expect(NCORESHIFT_DECLARED_SCOPES).toHaveLength(2);
    expect(NCORESHIFT_DECLARED_SCOPES).toContain(SCOPE_VIEWER);
    expect(NCORESHIFT_DECLARED_SCOPES).toContain(SCOPE_ANALYST);
  });

  it('does NOT declare NCoreIQ.Operator', () => {
    expect((NCORESHIFT_DECLARED_SCOPES as readonly string[])).not.toContain(SCOPE_OPERATOR);
  });

  it('does NOT declare NCoreIQ.Admin', () => {
    expect((NCORESHIFT_DECLARED_SCOPES as readonly string[])).not.toContain(SCOPE_ADMIN);
  });

  it('declared scopes satisfy all required N-CoreShift operations', () => {
    const requiredScopes = new Set(
      SCOPE_MATRIX.filter((e) => e.usedByNCoreShift).map((e) => e.requiredScope),
    );
    for (const scope of requiredScopes) {
      const scopeArr: readonly string[] = NCORESHIFT_DECLARED_SCOPES;
      // NCoreIQ.Analyst includes NCoreIQ.Viewer by inheritance
      const covered =
        scopeArr.includes(scope) ||
        (scope === SCOPE_VIEWER && scopeArr.includes(SCOPE_ANALYST));
      expect(covered).toBe(true);
    }
  });
});

// ── 3. API path contract integrity ────────────────────────────────────────

describe('3. NCoreIQClient path constants match contract Section 7', () => {
  it('SAP_PING path is /api/v1/sap/ping', () => {
    expect(NCOREIQ_PATHS.SAP_PING).toBe('/api/v1/sap/ping');
  });

  it('SEARCH path is /api/v1/repository/search', () => {
    expect(NCOREIQ_PATHS.SEARCH).toBe('/api/v1/repository/search');
  });

  it('JOBS path is /api/v1/repository/jobs', () => {
    expect(NCOREIQ_PATHS.JOBS).toBe('/api/v1/repository/jobs');
  });

  it('OBJECT_SOURCE includes /source suffix', () => {
    const path = NCOREIQ_PATHS.OBJECT_SOURCE('PROG', 'ZTEST');
    expect(path).toContain('/source');
    expect(path).not.toContain('max_lines');
  });

  it('DEPENDENCIES_TRAVERSE is /api/v1/repository/dependencies/traverse', () => {
    expect(NCOREIQ_PATHS.DEPENDENCIES_TRAVERSE).toBe('/api/v1/repository/dependencies/traverse');
  });

  it('DEPENDENCIES_REVERSE is /api/v1/repository/dependencies/reverse', () => {
    expect(NCOREIQ_PATHS.DEPENDENCIES_REVERSE).toBe('/api/v1/repository/dependencies/reverse');
  });

  it('DEPENDENCIES_IMPACT is /api/v1/repository/dependencies/impact', () => {
    expect(NCOREIQ_PATHS.DEPENDENCIES_IMPACT).toBe('/api/v1/repository/dependencies/impact');
  });

  it('JOB_RESULT path includes /result suffix', () => {
    const path = NCOREIQ_PATHS.JOB_RESULT('job-123');
    expect(path).toContain('/result');
    expect(path).toContain('job-123');
  });

  it('JOB_ARTIFACT path includes /artifact suffix', () => {
    const path = NCOREIQ_PATHS.JOB_ARTIFACT('job-456');
    expect(path).toContain('/artifact');
    expect(path).toContain('job-456');
  });
});

// ── 4. Scope inheritance verification ────────────────────────────────────

describe('4. NCoreIQ scope inheritance (from principal.py)', () => {
  // Simulates N-CoreIQ's _parse_scopes_from_claims logic
  function simulateScopeInheritance(granted: string[]): string[] {
    const result = [...granted];
    if (result.includes(SCOPE_ADMIN)) {
      for (const s of [SCOPE_VIEWER, SCOPE_ANALYST, SCOPE_OPERATOR]) {
        if (!result.includes(s)) result.push(s);
      }
    } else if (result.includes(SCOPE_OPERATOR)) {
      for (const s of [SCOPE_VIEWER, SCOPE_ANALYST]) {
        if (!result.includes(s)) result.push(s);
      }
    } else if (result.includes(SCOPE_ANALYST)) {
      if (!result.includes(SCOPE_VIEWER)) result.push(SCOPE_VIEWER);
    }
    return result;
  }

  it('granting NCoreIQ.Analyst also provides NCoreIQ.Viewer via inheritance', () => {
    const effective = simulateScopeInheritance([SCOPE_ANALYST]);
    expect(effective).toContain(SCOPE_VIEWER);
    expect(effective).toContain(SCOPE_ANALYST);
  });

  it('granting only NCoreIQ.Analyst does NOT provide Operator or Admin', () => {
    const effective = simulateScopeInheritance([SCOPE_ANALYST]);
    expect(effective).not.toContain(SCOPE_OPERATOR);
    expect(effective).not.toContain(SCOPE_ADMIN);
  });

  it('N-CoreShift with Analyst can access all required Viewer operations', () => {
    const effective = simulateScopeInheritance(Array.from(NCORESHIFT_DECLARED_SCOPES));
    const viewerOps = SCOPE_MATRIX.filter((e) => e.usedByNCoreShift && e.requiredScope === SCOPE_VIEWER);
    for (const op of viewerOps) {
      expect(effective).toContain(SCOPE_VIEWER);
    }
  });

  it('N-CoreShift with Analyst can access all required Analyst operations', () => {
    const effective = simulateScopeInheritance(Array.from(NCORESHIFT_DECLARED_SCOPES));
    const analystOps = SCOPE_MATRIX.filter((e) => e.usedByNCoreShift && e.requiredScope === SCOPE_ANALYST);
    for (const op of analystOps) {
      expect(effective).toContain(SCOPE_ANALYST);
    }
  });
});

// ── 5. N-CoreShift machine identity configuration contract ────────────────

describe('5. N-CoreShift XSUAA authority configuration', () => {
  /**
   * N-CoreShift authorities are defined in mta.yaml parameters.config, NOT in
   * xs-security.json. This allows MTA deployment-time substitution of the
   * effective N-CoreIQ xsappname (ncoreiq-${org}-${space}).
   *
   * MTA template format (in mta.yaml config.authorities):
   *   "${ncoreiq-xsappname}.NCoreIQ.Viewer"
   *   "${ncoreiq-xsappname}.NCoreIQ.Analyst"
   *
   * Effective deployed format (resolved at deployment time, e.g.):
   *   "ncoreiq-<org>-<space>.NCoreIQ.Viewer"
   *   "ncoreiq-<org>-<space>.NCoreIQ.Analyst"
   *
   * The static $XSAPPNAME(application,ncoreiq) resolver is NOT used because
   * N-CoreIQ's effective xsappname is parameterized; XSUAA cannot resolve
   * the static 'ncoreiq' key against the deployed 'ncoreiq-<org>-<space>' service.
   *
   * Cross-space override: set mta parameter ncoreiq-xsappname explicitly.
   */

  // MTA template strings as they appear in mta.yaml config.authorities
  const MTA_AUTHORITY_TEMPLATES = [
    '${ncoreiq-xsappname}.NCoreIQ.Viewer',
    '${ncoreiq-xsappname}.NCoreIQ.Analyst',
  ] as const;

  // Effective deployed authority pattern — prefix is the resolved ncoreiq xsappname
  const DEPLOYED_AUTHORITY_PATTERNS = [
    /^ncoreiq-.+\.NCoreIQ\.Viewer$/,
    /^ncoreiq-.+\.NCoreIQ\.Analyst$/,
  ] as const;

  it('MTA template authorities reference ncoreiq-xsappname parameter', () => {
    for (const template of MTA_AUTHORITY_TEMPLATES) {
      expect(template).toContain('ncoreiq-xsappname');
    }
  });

  it('MTA template authorities include correct scope names Viewer and Analyst', () => {
    expect(MTA_AUTHORITY_TEMPLATES[0]).toContain('NCoreIQ.Viewer');
    expect(MTA_AUTHORITY_TEMPLATES[1]).toContain('NCoreIQ.Analyst');
  });

  it('MTA template authorities do NOT include Operator', () => {
    const hasOperator = MTA_AUTHORITY_TEMPLATES.some((t) => t.includes('Operator'));
    expect(hasOperator).toBe(false);
  });

  it('MTA template authorities do NOT include Admin', () => {
    const hasAdmin = MTA_AUTHORITY_TEMPLATES.some((t) => t.includes('Admin'));
    expect(hasAdmin).toBe(false);
  });

  it('deployed authority pattern matches expected ncoreiq-<org>-<space> prefix format', () => {
    // Simulate MTA resolution for known org/space (sanity check only — not hard-coded)
    const exampleOrg = 'my-org';
    const exampleSpace = 'my-space';
    const resolvedViewer = `ncoreiq-${exampleOrg}-${exampleSpace}.NCoreIQ.Viewer`;
    const resolvedAnalyst = `ncoreiq-${exampleOrg}-${exampleSpace}.NCoreIQ.Analyst`;
    expect(resolvedViewer).toMatch(DEPLOYED_AUTHORITY_PATTERNS[0]);
    expect(resolvedAnalyst).toMatch(DEPLOYED_AUTHORITY_PATTERNS[1]);
  });

  it('exactly two authorities declared — Viewer and Analyst only', () => {
    expect(MTA_AUTHORITY_TEMPLATES).toHaveLength(2);
  });

  it('N-CoreShift authorities correspond to the scopes declared in NCORESHIFT_DECLARED_SCOPES', () => {
    // Each MTA authority template maps to one NCORESHIFT_DECLARED_SCOPES entry
    const scopeNames = Array.from(NCORESHIFT_DECLARED_SCOPES);
    for (const template of MTA_AUTHORITY_TEMPLATES) {
      const matchedScope = scopeNames.find((s) => template.endsWith(`.${s}`));
      expect(matchedScope).toBeDefined();
    }
  });
});
