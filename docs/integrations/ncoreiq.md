# N-CoreIQ Integration — N-CoreShift

**Document version:** 1.0  
**Contract version:** N-CoreIQ External Consumer Contract v1  
**Branch:** ncoreiq-integration  
**Date:** 2026-10-11  
**Status:** Integration Foundation B — Implementation complete, awaiting BTP/XSUAA application identity

---

## Architecture

```
SAP ECC / SAP S/4HANA
        |
        v
    N-CoreIQ          ← Technical Repository Evidence Provider
        |
        | REST API  /api/v1/
        v
    N-CoreShift       ← Clean Core Modernization Decision Engine
        |
        +--> Evidence Snapshot
        +--> Functional Intent
        +--> Fit-to-Standard
        +--> Clean Core Assessment (4R + Review)
        +--> Modernization Planning
```

### Product Ownership Boundary

| Responsibility | Owner |
|---|---|
| SAP connectivity and credential management | **N-CoreIQ** |
| Package and repository discovery | **N-CoreIQ** |
| Object metadata extraction | **N-CoreIQ** |
| Complete source retrieval (no hidden line cap) | **N-CoreIQ** |
| Dependency extraction, traversal, reverse analysis | **N-CoreIQ** |
| Bulk extraction jobs and artifacts | **N-CoreIQ** |
| Functional intent interpretation | **N-CoreShift** |
| Fit-to-Standard analysis | **N-CoreShift** |
| Clean Core decisioning (RETIRE/REPLACE/REFACTOR/REPLATFORM/REVIEW) | **N-CoreShift** |
| Immutable evidence snapshot persistence | **N-CoreShift** |
| Modernization planning | **N-CoreShift** |

**N-CoreIQ provides EVIDENCE. N-CoreShift provides INTERPRETATION AND MODERNIZATION DECISIONS.**

---

## Authentication Status

```
SERVICE_TO_SERVICE_AUTH: DEFERRED UNTIL N-CORESHIFT BTP/XSUAA APPLICATION IDENTITY IS ESTABLISHED
```

Current state:
- `NCoreIQClient` accepts an optional `bearerToken` in configuration
- When N-CoreIQ runs with `AUTH_MODE=disabled` (local/dev), no token is required
- BTP production requires a valid XSUAA Bearer JWT obtained via client_credentials flow
- The N-CoreShift BTP/XSUAA application identity has not yet been established
- Full service-to-service trust configuration (xs-security.json, role collection assignment) is deferred

See [N-CoreIQ Consumer Contract Section 11](../../C:/N-CoreIQ/docs/integration/ncoreiq-consumer-contract-v1.md#11-service-to-service-authentication-readiness) for the complete requirements.

---

## Configuration

All configuration is via environment variables. No production URLs, credentials, or OAuth secrets are hard-coded.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NCOREIQ_BASE_URL` | Required | Direct backend URL, e.g. `http://localhost:8000` or `https://ncoreiq.cfapps.us10.hana.ondemand.com`. **Never** use the AppRouter URL. |
| `NCOREIQ_AUTH_MODE` | Optional | `disabled` (local/dev) or `xsuaa` (BTP production). Default: `disabled`. |
| `NCOREIQ_TIMEOUT_MS` | Optional | Request timeout in milliseconds. Default: `30000`. |

### .env.example

```
NCOREIQ_BASE_URL=
NCOREIQ_AUTH_MODE=disabled
# NCOREIQ_TIMEOUT_MS=30000
```

### Server Configuration

`NCoreIQIntegrationConfig` is added to `NCSEnvironmentConfig` in `srv/src/config/environment.ts`. When `NCOREIQ_BASE_URL` is not set, `config.ncoreiq` is `null` and the connected source mode is unavailable.

---

## Implementation Files

| File | Description |
|---|---|
| `agent/src/ncoreiq/types.ts` | N-CoreIQ DTO types (from contract) + N-CoreShift domain mapping types |
| `agent/src/ncoreiq/NCoreIQClient.ts` | Typed HTTP client — all contract endpoints, secret-safe |
| `agent/src/ncoreiq/NCoreIQSourceProvider.ts` | CodeSourceProvider implementation + evidence store |
| `agent/src/ncoreiq/index.ts` | Public barrel exports |
| `agent/src/__tests__/ncoreiq.test.ts` | Integration tests A–W (37 tests) |
| `app/src/components/NCoreIQConnectModal.tsx` | UI: Connected SAP via N-CoreIQ flow |
| `srv/src/config/environment.ts` | `NCoreIQIntegrationConfig` + `buildNCoreIQConfig()` |

---

## NCoreIQClient

`NCoreIQClient` is the centralized HTTP client for the N-CoreIQ REST API v1.

### Endpoint Constants

All API paths are defined once in `NCOREIQ_PATHS` in `NCoreIQClient.ts`. No paths are duplicated elsewhere in the codebase.

```typescript
import { NCoreIQClient, NCOREIQ_PATHS } from './ncoreiq/NCoreIQClient.js';

const client = new NCoreIQClient({
  baseUrl: 'http://localhost:8000',   // from NCOREIQ_BASE_URL
  bearerToken: undefined,             // DEFERRED — see auth section
  timeoutMs: 30_000,
});
```

### Endpoint Mapping (Contract Section 7)

| Client Method | HTTP | Path |
|---|---|---|
| `ping()` | GET | `/api/v1/sap/ping` |
| `listPackages(pkg, opts)` | GET | `/api/v1/repository/packages/{package}` |
| `searchObjects(req)` | POST | `/api/v1/repository/search` |
| `getMetadata(type, name)` | GET | `/api/v1/repository/objects/{type}/{name}/metadata` |
| `getSource(type, name)` | GET | `/api/v1/repository/objects/{type}/{name}/source` |
| `getSourceBounded(type, name, N)` | GET | `.../source?max_lines=N` |
| `getDependencies(type, name)` | GET | `/api/v1/repository/objects/{type}/{name}/dependencies` |
| `traverseDependencies(req)` | POST | `/api/v1/repository/dependencies/traverse` |
| `findDependents(req)` | POST | `/api/v1/repository/dependencies/reverse` |
| `analyzeImpact(req)` | POST | `/api/v1/repository/dependencies/impact` |
| `createExtractionJob(req)` | POST | `/api/v1/repository/jobs` |
| `getJobStatus(jobId)` | GET | `/api/v1/repository/jobs/{job_id}` |
| `getJobResult(jobId)` | GET | `/api/v1/repository/jobs/{job_id}/result` |
| `downloadArtifact(jobId)` | GET | `/api/v1/repository/jobs/{job_id}/artifact` |

### Secret Safety

- `Authorization` headers are injected into outgoing requests but **never** written to any log
- Error messages from upstream are normalized — no stack traces, no credentials, no tokens are exposed
- `NCoreIQApiError`, `NCoreIQTimeoutError`, `NCoreIQUnavailableError` carry safe error codes only

### Test Injection

`NCoreIQClientConfig.fetchFn` accepts an optional fetch implementation for unit testing. Production always uses `globalThis.fetch` (Node 18+).

---

## NCoreIQSourceProvider

`NCoreIQSourceProvider` implements `CodeSourceProviderContract` and adds N-CoreIQ-specific methods.

### Provider Hierarchy

```
CodeSourceProvider (abstract)
    |
    +-- FileUploadSourceProvider
    +-- NCoreIQSourceProvider        ← this implementation
             |
             +-- NCoreIQClient
```

### Connected Import Workflow

```
1. testConnection()
   → GET /api/v1/sap/ping
   → Returns: connected, systemId, client, sapRelease

2. listPackages(tenantId, rootPackage, { include_subpackages: true })
   → GET /api/v1/repository/packages/{package}
   → Returns: package hierarchy for user selection

3. previewObjects(tenantId, { packages: [...], include_subpackages: true })
   → POST /api/v1/repository/search
   → Returns: object count, types, names for scope selection

4a. For individual objects:
    importObject(tenantId, projectId, analysisId, type, name)
    → Parallel: GET .../metadata  +  GET .../source  (NO max_lines)
    → Stores: NCoreIQObjectEvidence in InMemoryNCoreIQEvidenceStore

4b. For bulk packages:
    startBulkImport({ tenantId, projectId, analysisId, packages, ... })
    → POST /api/v1/repository/search (discover objects)
    → POST /api/v1/repository/jobs  (source_max_lines=null = COMPLETE)
    → Returns: NCoreIQImportJob with localJobId + upstreamJobId

5. pollImportJob(localJobId)
   → GET /api/v1/repository/jobs/{job_id}
   → Maps SUCCEEDED → COMPLETED, FAILED → FAILED, etc.

6. getEvidence(tenantId, projectId, analysisId)
   → Returns latest evidence snapshots — scoped, isolated
```

---

## Complete Source Import

**MANDATORY REQUIREMENT:** `getSource()` **never** sends `max_lines`. Persisted evidence is always complete.

```typescript
// CORRECT — complete source
await client.getSource('PROG', 'ZREPORT_DEMO');
// URL: GET /api/v1/repository/objects/PROG/ZREPORT_DEMO/source

// CORRECT — bounded, for UI preview only
await client.getSourceBounded('PROG', 'ZREPORT_DEMO', 500);
// URL: GET .../source?max_lines=500  (preview display only — NOT for import)

// NEVER sent by default:
// max_lines=500  ← explicitly prohibited
// max_lines=1000 ← explicitly prohibited
// max_lines=N    ← any limit during import is prohibited
```

N-CoreIQ transparently follows SAP Gateway `__next` pagination links and returns a single merged response with all source lines.

For bulk extraction jobs, `source_max_lines: null` is always sent — complete source per object.

---

## Package Discovery

```typescript
const provider = new NCoreIQSourceProvider(config);

// Test connection first
const conn = await provider.testConnection();
// conn.connected, conn.systemId, conn.client, conn.sapRelease

// Browse package hierarchy
const packages = await provider.listPackages(tenantId, 'ZNCOREIQ', {
  include_subpackages: true,
  max_depth: 20,
});
// packages.packages[].package, .parent_package, .description, .depth

// Preview objects in selected packages
const preview = await provider.previewObjects(tenantId, {
  packages: ['ZNCOREIQ', 'ZNCOREIQ_CORE'],
  include_subpackages: true,
});
// preview.objects[].sap_object_type, .object_name, .package, .description
```

---

## Evidence Snapshot Behavior

Every imported object produces an `NCoreIQObjectEvidence` record:

```typescript
{
  id: string;                 // N-CoreShift generated UUID
  tenantId: string;           // Tenant isolation
  projectId: string;          // Project isolation
  analysisId: string;
  provider: 'NCOREIQ';        // Fixed — always NCOREIQ
  ncoreiqBaseUrl: string;     // Evidence provenance
  contractVersion: 'v1';
  systemId: string;           // SAP SID (e.g. NC1)
  client: string;             // SAP client (e.g. 800)
  sapPackage: string;
  objectType: string;
  objectName: string;
  // ... SAP metadata fields
  sourceText: string;         // COMPLETE source — never truncated
  returnedLines: number;
  sourceHash: string;         // SHA-256 hex
  ncoreiqProvidedHash: boolean; // true if N-CoreIQ computed it
  retrievedAt: string;        // ISO timestamp — N-CoreShift records this
  version: number;            // 1 = initial, 2+ = refresh
  isLatest: boolean;
  refreshedFrom: string | null;
}
```

### Source Hash (Section 8)

The `sha256` field from N-CoreIQ is computed as:
```
SHA-256( all_component_lines.join("\n").encode("utf-8") )
```

- N-CoreShift stores the N-CoreIQ-provided hash when present (`ncoreiqProvidedHash=true`)
- If N-CoreIQ does not provide a hash, N-CoreShift computes it locally using the same algorithm
- This enables change detection between source evidence revisions

---

## Refresh and Immutability

Previously completed analysis evidence is **never** silently mutated:

```typescript
// Explicit refresh — creates version 2, marks version 1 as isLatest=false
const v2 = await provider.refreshObject(tenantId, projectId, analysisId, 'PROG', 'ZREPORT_DEMO');
// v2.version === 2
// v2.refreshedFrom === v1.id
// v1 remains stored with isLatest=false

// getEvidence() returns only the latest version of each object
const evidence = provider.getEvidence(tenantId, projectId, analysisId);
```

---

## Dependency Import

Technical dependencies from N-CoreIQ are evidence — **not** Clean Core decisions:

```typescript
const records = await provider.importDependencies(tenantId, projectId, analysisId, 'PROG', 'ZREPORT_DEMO');
// records[].relationshipType  (e.g. CALLS_FUNCTION)
// records[].targetObjectName
// records[].confidence       (EXACT / HIGH / MEDIUM / LOW)
// records[].direction        = 'OUTBOUND'
// records[].dynamic          (dynamic call — lower confidence)
```

A `CALLS_FUNCTION` dependency is technical evidence. Whether it constitutes a Clean Core violation is N-CoreShift's separate decision — not N-CoreIQ's.

---

## Bulk Extraction Job Integration

Large package imports use N-CoreIQ async extraction jobs (POST /api/v1/repository/jobs).

```typescript
// Start bulk import — never blocks a browser request
const job = await provider.startBulkImport({
  tenantId, projectId, analysisId,
  packages: ['ZNCOREIQ'],
  includeSubpackages: true,
  requestedBy: 'consultant@example.com',
});
// job.localJobId   — local BackgroundJobService ID
// job.upstreamJobId — N-CoreIQ job_id

// Poll status (BackgroundJobService handles scheduling)
const updated = await provider.pollImportJob(job.localJobId);
// updated.localStatus: QUEUED | RUNNING | COMPLETED | PARTIAL | FAILED | CANCELLED
// (N-CoreIQ SUCCEEDED maps to N-CoreShift COMPLETED)
```

The bulk job request always uses `source_max_lines: null` — complete source per object.

---

## Tenant and Project Isolation

All evidence is scoped by `tenantId` + `projectId`. The `InMemoryNCoreIQEvidenceStore` enforces this:

- `getEvidence(tenantId, projectId, analysisId)` returns only records matching all three
- Cross-tenant reads return empty — enforced server-side, not browser-side
- Tests N and O verify isolation explicitly

---

## Error Handling

| Condition | Error Type | Provider Behavior |
|---|---|---|
| HTTP 401 | `NCoreIQApiError` (httpStatus=401) | `testConnection()` returns `connected=false` |
| HTTP 403 | `NCoreIQApiError` (httpStatus=403) | Same — no credentials exposed |
| HTTP 503 | `NCoreIQApiError` (errorCode=SAP_UNAVAILABLE) | `testConnection()` returns `connected=false` |
| Timeout | `NCoreIQTimeoutError` | Error message: "timed out after Nms" |
| DNS/network failure | `NCoreIQUnavailableError` | Error message: "N-CoreIQ is unavailable" |
| Non-JSON response | `NCoreIQApiError` (MALFORMED_RESPONSE) | Upstream body not exposed |
| Truncated source | `Error` | `importObject()` throws — complete source required |
| Job not found | `Error` | `pollImportJob()` throws |

**Never logged:** Authorization headers, bearer tokens, client secrets, SAP credentials.

---

## Audit Integration

`NCoreIQSourceProvider` calls `AuditService` (when injected) for security-safe events:

| Event | Action recorded |
|---|---|
| Connection test | `NCOREIQ_CONNECTION_TEST` |
| Package browse | `NCOREIQ_PACKAGE_BROWSE` |
| Object preview | `NCOREIQ_PACKAGE_PREVIEW` |
| Object import | `NCOREIQ_OBJECT_IMPORT` |
| Bulk job started | `NCOREIQ_BULK_JOB_STARTED` |

Audit records contain only identifiers and counts — **never** tokens, secrets, or source content.

---

## UI — NCoreIQConnectModal

`app/src/components/NCoreIQConnectModal.tsx` provides the "Connected SAP via N-CoreIQ" source ingestion flow:

```
Step 1: Connection
  → Enter N-CoreIQ Base URL
  → Test Connection (GET /api/ncoreiq/ping)
  → Displays: SID, Client, SAP Release

Step 2: Packages
  → Enter root package name
  → Browse (POST /api/ncoreiq/packages)
  → Select packages for import

Step 3: Preview
  → Loads objects in selected packages (POST /api/ncoreiq/preview)
  → Displays: object type, name, description (not source code)

Step 4: Import
  → Starts bulk extraction job (POST /api/ncoreiq/import)
  → Polls status with progress display
  → Shows COMPLETED / PARTIAL / FAILED result
```

The UI **never** displays tokens, secrets, passwords, or source code content.

---

## Local / Mock Testing

All tests use `fetchFn` injection — no live N-CoreIQ or SAP connectivity required.

```typescript
import { NCoreIQClient } from '../ncoreiq/NCoreIQClient.js';
import type { NCoreIQClientConfig } from '../ncoreiq/types.js';

const mockFetch = (url: string) =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify({ status: 'connected', system_id: 'NC1', ... })),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  });

const client = new NCoreIQClient({
  baseUrl: 'http://localhost:8000',
  fetchFn: mockFetch,
} as NCoreIQClientConfig);
```

For local development with a real N-CoreIQ instance:
1. Start N-CoreIQ with `AUTH_MODE=disabled`
2. Set `NCOREIQ_BASE_URL=http://localhost:8000`
3. Leave `NCOREIQ_AUTH_MODE=disabled`

---

## BTP Deployment Work Still Required

The following work is deferred until the N-CoreShift BTP/XSUAA application identity is established:

1. **N-CoreShift XSUAA application registration** — obtain `xsappname` and `clientid`
2. **Role collection assignment** — assign `NCoreIQ Analyst` role collection to N-CoreShift service instance in BTP subaccount
3. **Token acquisition implementation** — implement client_credentials flow in `AuthProvider` or equivalent; inject `bearerToken` into `NCoreIQClientConfig`
4. **N-CoreIQ `xs-security.json` update** — add `authorities` or `foreign-scope-references` for N-CoreShift (N-CoreIQ team action)
5. **`AUTH__AUDIENCE` configuration** — N-CoreIQ may need to accept N-CoreShift `clientid` in JWT `aud` claim
6. **BTP Destination Service** — optionally resolve N-CoreIQ base URL via Destination Service for production routing

Until the above is complete, N-CoreShift cannot authenticate to N-CoreIQ in BTP production. Local development with `AUTH_MODE=disabled` is fully functional.

---

## Contract Mismatches Discovered

The original `agent/src/ncoreiq/types.ts` stub had incorrect field names throughout. All corrections documented at the top of that file. Key mismatches:

| Location | Original stub | Contract (authoritative) |
|---|---|---|
| Package entry | `package_name`, `object_count`, `sub_packages` | `package`, `parent_package`, `depth` |
| Search result object | `package_name`, no `friendly_type`/`author`/`match_reason` | `package`, `friendly_type`, `author`, `match_reason` |
| Source response | Flat `lines[]` array | `components[]` array with `lines[]` nested |
| Dependency relation | `from_type`/`from_name`/`to_type`/`relation_type` | `relation_id`/`source_object_type`/`relationship_type`/`confidence`/`evidence_source`/`line_no`/`dynamic` |
| Dependencies response | `dependencies[]` | `relationships[]` |
| Traversal/Reverse/Impact requests | Flat fields | Nested `root_object`/`target_object`/`object` with `SAPObjectRef` |

These mismatches have been corrected. The authoritative contract remains `C:\N-CoreIQ\docs\integration\ncoreiq-consumer-contract-v1.md`.
