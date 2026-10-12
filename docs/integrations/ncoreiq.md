# N-CoreIQ Integration — N-CoreShift

**Document version:** 2.0
**Contract version:** N-CoreIQ External Consumer Contract v1  
**Branch:** ncoreiq-integration  
**Date:** 2026-10-12
**Status:** Integration Foundation C — BTP Service-to-Service Authentication implemented, awaiting BTP deployment and certification

---

## Architecture

```
SAP ECC / SAP S/4HANA
        |
        v
    N-CoreIQ          ← Technical Repository Evidence Provider
        |                 (BTP CF, XSUAA protected backend)
        | REST API  /api/v1/  (direct backend — NOT AppRouter)
        |
        ^
        | Authorization: Bearer <XSUAA client_credentials JWT>
        |
    N-CoreShift       ← Clean Core Modernization Decision Engine
        |                 (NCoreIQTokenProvider → XSUAA → JWT)
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
| XSUAA JWT validation (RS256, issuer, audience, scope) | **N-CoreIQ** |
| Machine-to-machine token acquisition | **N-CoreShift** |
| Functional intent interpretation | **N-CoreShift** |
| Fit-to-Standard analysis | **N-CoreShift** |
| Clean Core decisioning (RETIRE/REPLACE/REFACTOR/REPLATFORM/REVIEW) | **N-CoreShift** |
| Immutable evidence snapshot persistence | **N-CoreShift** |
| Modernization planning | **N-CoreShift** |

**N-CoreIQ provides EVIDENCE. N-CoreShift provides INTERPRETATION AND MODERNIZATION DECISIONS.**

---

## Machine-to-Machine Authentication Architecture (Foundation C)

### Authentication Model

N-CoreShift uses **OAuth2 client_credentials grant** (machine-to-machine) to authenticate to N-CoreIQ. This is distinct from user authentication (interactive JWT forwarding).

```
N-CoreShift XSUAA binding (VCAP_SERVICES / ncoreshift-uaa)
        |
        | POST /oauth/token
        | grant_type=client_credentials
        | Authorization: Basic base64(clientId:clientSecret)
        v
    SAP XSUAA token endpoint
        |
        | JWT containing NCoreIQ authority scopes
        | aud: [ncoreiq-<org>-<space>]
        | scope: ncoreiq-<org>-<space>.NCoreIQ.Viewer ncoreiq-<org>-<space>.NCoreIQ.Analyst
        v
    NCoreIQTokenProvider (server-side cache)
        |
        | Authorization: Bearer <JWT>
        v
    N-CoreIQ backend (XSUAA-protected FastAPI)
        |   JWT validated: RS256 signature, issuer, audience, scopes
        v
    SAP ECC / S/4HANA
```

### Critical Separation

| Concern | Mechanism | Code Location |
|---|---|---|
| **User authentication** | Interactive browser JWT, AppRouter, XSUAA login | `app/src/auth/`, browser only |
| **Machine authentication** | Server-side `client_credentials`, never browser | `agent/src/ncoreiq/NCoreIQTokenProvider.ts` |

**The machine-to-machine JWT is NEVER forwarded to React / the browser.** It is acquired server-side, cached server-side, and only used for backend-to-backend N-CoreIQ calls.

---

## XSUAA Authority Grant Model

### N-CoreIQ (Granting / Resource Application)

`C:\N-CoreIQ\deployment\btp\xs-security.json` — grants Viewer and Analyst scopes to N-CoreShift:

```json
{
  "xsappname": "ncoreiq",
  "scopes": [
    {
      "name": "$XSAPPNAME.NCoreIQ.Viewer",
      "grant-as-authority-to-apps": ["$XSAPPNAME(application,ncoreshift)"]
    },
    {
      "name": "$XSAPPNAME.NCoreIQ.Analyst",
      "grant-as-authority-to-apps": ["$XSAPPNAME(application,ncoreshift)"]
    }
  ]
}
```

### N-CoreShift (Requesting Application)

`xs-security.json` — declares which N-CoreIQ authorities it claims:

```json
{
  "xsappname": "ncoreshift",
  "authorities": [
    "$XSAPPNAME(application,ncoreiq).NCoreIQ.Viewer",
    "$XSAPPNAME(application,ncoreiq).NCoreIQ.Analyst"
  ]
}
```

### How `$XSAPPNAME(application,...)` Resolves

XSUAA resolves `$XSAPPNAME(application,ncoreshift)` to the runtime xsappname of the N-CoreShift XSUAA service instance at deployment time (e.g. `ncoreshift-myorg-dev`). This avoids hard-coding org/space-specific names in the security descriptor.

---

## Minimum Privilege Scope Matrix

### N-CoreShift Required Scopes

N-CoreShift needs exactly **NCoreIQ.Analyst** (which includes NCoreIQ.Viewer by inheritance).
N-CoreShift does **NOT** need NCoreIQ.Operator or NCoreIQ.Admin.

| Operation | REST Endpoint | Required Scope | Required by N-CoreShift |
|---|---|---|---|
| SAP/system ping | `GET /api/v1/sap/ping` | NCoreIQ.Viewer | **YES** |
| Package discovery | `GET /api/v1/repository/packages/{pkg}` | NCoreIQ.Viewer | **YES** |
| Repository search | `POST /api/v1/repository/search` | NCoreIQ.Viewer | **YES** |
| Object metadata | `GET /api/v1/repository/objects/{type}/{name}/metadata` | NCoreIQ.Viewer | **YES** |
| Complete source | `GET /api/v1/repository/objects/{type}/{name}/source` | NCoreIQ.Viewer | **YES** |
| Direct dependencies | `GET /api/v1/repository/objects/{type}/{name}/dependencies` | NCoreIQ.Viewer | **YES** |
| Dependency traversal | `POST /api/v1/repository/dependencies/traverse` | **NCoreIQ.Analyst** | **YES** |
| Reverse lookup | `POST /api/v1/repository/dependencies/reverse` | **NCoreIQ.Analyst** | **YES** |
| Impact analysis | `POST /api/v1/repository/dependencies/impact` | **NCoreIQ.Analyst** | **YES** |
| Job creation | `POST /api/v1/repository/jobs` | **NCoreIQ.Analyst** | **YES** |
| Job status | `GET /api/v1/repository/jobs/{id}` | **NCoreIQ.Analyst** | **YES** |
| Job result | `GET /api/v1/repository/jobs/{id}/result` | **NCoreIQ.Analyst** | **YES** |
| Artifact download | `GET /api/v1/repository/jobs/{id}/artifact` | **NCoreIQ.Analyst** | **YES** |
| Cancel job | `POST /api/v1/repository/jobs/{id}/cancel` | NCoreIQ.Operator | NO |
| Retry job | `POST /api/v1/repository/jobs/{id}/retry` | NCoreIQ.Operator | NO |
| Diagnostics | `GET /api/v1/admin/diagnostics` | NCoreIQ.Admin | NO |

### Least-Privilege Rationale

- NCoreIQ.Analyst inherits NCoreIQ.Viewer by N-CoreIQ's scope inheritance rule
- N-CoreShift does not cancel or retry jobs — it creates and polls only
- N-CoreShift has no administrative need — no diagnostics or config access
- NCoreIQ.Admin is never granted to N-CoreShift

---

## NCoreIQTokenProvider

### Interface

```typescript
// agent/src/ncoreiq/NCoreIQTokenProvider.ts
export interface NCoreIQTokenProvider {
  getToken(): Promise<string>;
}
```

### Production Implementation

```typescript
import {
  createNCoreIQTokenProvider,
  XSUAAClientCredentialsTokenProvider,
} from './ncoreiq/NCoreIQTokenProvider.js';
import { getConfig, isProduction } from '../config/environment.js';

// Create from VCAP_SERVICES binding (server startup)
const tokenProvider = createNCoreIQTokenProvider(
  getConfig().xsuaa,           // from VCAP_SERVICES / NCS_XSUAA_* env vars
  getConfig().ncoreiq!.authMode, // 'xsuaa' in production
  isProduction(),              // true → fails closed if binding missing
);

const sourceProvider = new NCoreIQSourceProvider(
  {
    baseUrl: getConfig().ncoreiq!.baseUrl,
    tokenProvider,                          // dynamic JWT acquisition
    timeoutMs: getConfig().ncoreiq!.timeoutMs,
  },
  store, audit, jobs,
  { authMode: 'xsuaa', isProduction: isProduction() },
);
```

### Token Caching and Refresh

- Tokens are cached in memory until `(expires_in - 30s)` from acquisition time
- `expires_in` default: 43,200 seconds (12 hours, from XSUAA config)
- On cache miss: automatic re-acquisition
- `invalidateCache()` forces immediate re-acquisition on next call
- Concurrent requests to `getToken()` in a single Node event loop are safe (single-threaded)

### Security Invariants

| Invariant | Enforcement |
|---|---|
| Token never logged | No log calls in `NCoreIQTokenProvider.ts` |
| Token never in error messages | `NCoreIQTokenAcquisitionError` never includes token value |
| ClientSecret never logged | Not logged even as `[REDACTED]` |
| ClientSecret never in error messages | Errors use reason codes only |
| Token never returned to browser/React | `NCoreIQSourceProvider.testConnection()` result has no token field |
| Production fails closed | `createNCoreIQTokenProvider()` throws if binding missing |

### Local Development Mode

```typescript
// Local dev: NCOREIQ_AUTH_MODE=disabled (N-CoreIQ also runs AUTH_MODE=disabled)
const tokenProvider = createNCoreIQTokenProvider(null, 'disabled', false);
// Returns DisabledModeTokenProvider → getToken() returns '' → no Authorization header
```

**`disabled` is ONLY permitted when `isProduction=false`.** Production always fails closed.

---

## Fail-Closed Behavior

| Failure Mode | Behavior |
|---|---|
| XSUAA binding absent, `authMode=xsuaa` | `createNCoreIQTokenProvider()` throws `BINDING_MISSING` |
| `authMode=disabled`, `isProduction=true` | `NCoreIQSourceProvider` constructor throws `BINDING_MISSING` |
| `authMode=xsuaa`, no `tokenProvider` in config | `NCoreIQSourceProvider` constructor throws `BINDING_MISSING` |
| Empty `clientId` | `XSUAAClientCredentialsTokenProvider` constructor throws `CREDENTIALS_MISSING` |
| Empty `clientSecret` | `XSUAAClientCredentialsTokenProvider` constructor throws `CREDENTIALS_MISSING` |
| Empty `tokenUrl` | Constructor throws `BINDING_MISSING` |
| Token endpoint returns HTTP 4xx/5xx | `getToken()` throws `TOKEN_ENDPOINT_ERROR` |
| Token endpoint unreachable | `getToken()` throws `TOKEN_ENDPOINT_UNAVAILABLE` |
| Token endpoint timeout (15s) | `getToken()` throws `TOKEN_ENDPOINT_TIMEOUT` |
| N-CoreIQ returns 401 | `NCoreIQApiError` (httpStatus=401, errorCode=UNAUTHORIZED) |
| N-CoreIQ returns 403 | `NCoreIQApiError` (httpStatus=403, errorCode=FORBIDDEN) |
| `disabled` → `xsuaa` downgrade in production | BLOCKED — constructor throws |

**Never silently downgraded.** Production never falls back to unauthenticated mode.

---

## N-CoreIQ JWT Validation (Unchanged)

N-CoreIQ's existing JWT validation is preserved and **not weakened**:

- RS256 signature verified against XSUAA JWKS (`/token_keys`)
- Issuer validated: `https://<subaccount>.authentication.<region>.hana.ondemand.com/oauth/token`
- Audience validated: accepted values = `[ncoreiq-<org>-<space>, bound_clientid]`
- Expiry enforced
- Scope extracted and mapped to `AuthenticatedPrincipal`
- JWKS cached (5-minute TTL)

For a client_credentials JWT issued to N-CoreShift, the `aud` claim will contain the N-CoreIQ runtime xsappname (`ncoreiq-<org>-<space>`), which N-CoreIQ's middleware already accepts.

No changes to N-CoreIQ's `app/auth/middleware.py` are required for the standard XSUAA authority grant flow.

---

## Direct Backend URL

N-CoreShift calls the **protected N-CoreIQ backend directly**, not via the AppRouter:

| Environment | URL |
|---|---|
| BTP Production | `https://ncoreiq.cfapps.us10.hana.ondemand.com` |
| Local development | `http://localhost:8000` |

The URL is configured via `NCOREIQ_BASE_URL` — never hard-coded in application source.

**Do NOT use the AppRouter URL** (`https://ncoreiq-ui.cfapps.us10.hana.ondemand.com`). The AppRouter is for browser traffic only. Backend-to-backend integration uses the protected backend directly.

### Destination Service Decision

N-CoreShift does **not** use BTP Destination Service for the N-CoreShift → N-CoreIQ connection. Direct HTTPS via `NCOREIQ_BASE_URL` is the established pattern in N-CoreShift (consistent with AI Core, Object Store). Destination Service would add unnecessary indirection.

Note: This is separate from N-CoreIQ's own use of Destination Service for the N-CoreIQ → SAP connection (`NC1_ODATA`). These are different connections.

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NCOREIQ_BASE_URL` | Required | Direct backend URL. Never use AppRouter URL. |
| `NCOREIQ_AUTH_MODE` | Optional | `disabled` (local) or `xsuaa` (BTP production). Default: `disabled`. |
| `NCOREIQ_TIMEOUT_MS` | Optional | Request timeout ms. Default: `30000`. |

### XSUAA Binding (BTP Production)

The token provider reads from `NCS_XSUAA_*` environment variables or VCAP_SERVICES (automatically populated when `ncoreshift-uaa` service is bound):

| Source | Variable / Binding field | Used for |
|---|---|---|
| VCAP_SERVICES | `xsuaa[].credentials.clientid` | OAuth2 client ID |
| VCAP_SERVICES | `xsuaa[].credentials.clientsecret` | OAuth2 client secret |
| VCAP_SERVICES | `xsuaa[].credentials.url` | XSUAA base URL → token endpoint |
| env var fallback | `NCS_XSUAA_CLIENT_ID` | Local dev / CI override |
| env var fallback | `NCS_XSUAA_CLIENT_SECRET` | Local dev / CI override |
| env var fallback | `NCS_XSUAA_URL` | Local dev / CI override |

**No secrets are stored in `.env`, source files, or test fixtures.**

---

## BTP Binding Requirements

The following must be true at deployment time for service-to-service auth to work:

1. **N-CoreShift XSUAA service bound** — `ncoreshift-uaa` service instance bound to `ncoreshift-srv` app. Credentials in `VCAP_SERVICES`.

2. **N-CoreIQ xs-security.json deployed** — The updated `deployment/btp/xs-security.json` (with `grant-as-authority-to-apps`) must be deployed to N-CoreIQ's XSUAA service instance:
   ```
   # In N-CoreIQ project:
   cf update-service ncoreiq-xsuaa -c deployment/btp/xs-security.json
   # OR redeploy:
   mbt build && cf deploy mta_archives/ncoreiq_*.mtar
   ```

3. **N-CoreShift xs-security.json deployed** — The updated `xs-security.json` (with `authorities`) must be deployed to N-CoreShift's XSUAA service instance:
   ```
   # In N-CoreShift project:
   cf update-service ncoreshift-uaa -c xs-security.json
   # OR redeploy:
   mbt build && cf deploy mta_archives/ncoreshift_*.mtar
   ```

4. **VCAP_SERVICES populated** — Happens automatically when service is bound to the app in CF.

5. **NCOREIQ_BASE_URL configured** — Set on the N-CoreShift backend app:
   ```
   cf set-env ncoreshift-srv NCOREIQ_BASE_URL https://ncoreiq.cfapps.us10.hana.ondemand.com
   cf set-env ncoreshift-srv NCOREIQ_AUTH_MODE xsuaa
   cf restage ncoreshift-srv
   ```

### Values Known Now vs. Values Discovered During Deployment

| Value | Known now | Discovery command |
|---|---|---|
| N-CoreShift logical `xsappname` | `ncoreshift` | In `xs-security.json` |
| N-CoreIQ logical `xsappname` | `ncoreiq` | In N-CoreIQ `xs-security.json` |
| N-CoreShift runtime xsappname | `ncoreshift-<org>-<space>` | `cf service ncoreshift-uaa --guid` |
| N-CoreIQ runtime xsappname | `ncoreiq-<org>-<space>` | `cf service ncoreiq-xsuaa --guid` |
| N-CoreShift `clientid` | NOT known | `cf service-key ncoreshift-uaa ncoreshift-sk` |
| N-CoreShift `clientsecret` | NOT known | `cf service-key ncoreshift-uaa ncoreshift-sk` |
| XSUAA token endpoint URL | NOT known | From service key `.url` + `/oauth/token` |
| N-CoreIQ backend URL | `https://ncoreiq.cfapps.us10.hana.ondemand.com` | `cf app ncoreiq-backend` |

---

## Deployment and Certification Sequence

After review, execute in this order:

```bash
# 1. Deploy N-CoreIQ with updated xs-security.json (grant-as-authority-to-apps)
cd C:\N-CoreIQ
mbt build
cf deploy mta_archives/ncoreiq_1.0.0.mtar

# 2. Deploy N-CoreShift with updated xs-security.json (authorities)
cd C:\AI_Automation\N-CoreShift\N-CoreShift
mbt build
cf deploy mta_archives/ncoreshift_1.0.0.mtar

# 3. Set N-CoreIQ URL and auth mode on N-CoreShift backend
cf set-env ncoreshift-srv NCOREIQ_BASE_URL https://ncoreiq.cfapps.us10.hana.ondemand.com
cf set-env ncoreshift-srv NCOREIQ_AUTH_MODE xsuaa
cf restage ncoreshift-srv

# 4. Discover the N-CoreShift service key (DO NOT commit output)
cf create-service-key ncoreshift-uaa ncoreshift-sk
cf service-key ncoreshift-uaa ncoreshift-sk
# → record clientid, clientsecret, url for verification only

# 5. Manually test token acquisition
# POST https://<xsuaa-url>/oauth/token
# Authorization: Basic base64(<clientid>:<clientsecret>)
# Body: grant_type=client_credentials
# → Verify: access_token present, scope includes NCoreIQ.Viewer NCoreIQ.Analyst

# 6. Verify N-CoreIQ accepts the token
# GET https://ncoreiq.cfapps.us10.hana.ondemand.com/api/v1/sap/ping
# Authorization: Bearer <token-from-step-5>
# → Expect: HTTP 200, status=connected OR HTTP 503 (SAP unreachable, not auth failure)

# 7. Verify N-CoreShift → N-CoreIQ integration via deployed app
# GET https://ncoreshift-srv.cfapps.us10.hana.ondemand.com/api/ncoreiq/ping
# Authorization: Bearer <ncoreshift-user-token>
# → Expect: connected=true (or SAP connectivity error, not auth error)
```

---

## Implementation Files (Foundation C)

| File | Change | Description |
|---|---|---|
| `agent/src/ncoreiq/NCoreIQTokenProvider.ts` | **NEW** | XSUAA client_credentials token provider |
| `agent/src/ncoreiq/types.ts` | Updated | Added `tokenProvider` to `NCoreIQClientConfig` |
| `agent/src/ncoreiq/NCoreIQClient.ts` | Updated | Async `_acquireBearer()`, `_buildHeaders()`, tokenProvider support |
| `agent/src/ncoreiq/NCoreIQSourceProvider.ts` | Updated | Production fail-closed guards, `NCoreIQSourceProviderOptions` |
| `agent/src/ncoreiq/index.ts` | Updated | Export NCoreIQTokenProvider types + factory |
| `agent/src/__tests__/ncoreiq-auth.test.ts` | **NEW** | Security tests A–P (16 scenarios) |
| `agent/src/__tests__/ncoreiq-scope-contract.test.ts` | **NEW** | Scope contract tests (minimum privilege) |
| `xs-security.json` | Updated | Added `authorities` for NCoreIQ.Viewer + NCoreIQ.Analyst |
| `C:\N-CoreIQ\deployment\btp\xs-security.json` | Updated | Added `grant-as-authority-to-apps` to Viewer + Analyst |
| `docs/integrations/ncoreiq.md` | Updated | This document |

---

## Test Coverage (Foundation C)

| Test File | Tests | Coverage |
|---|---|---|
| `ncoreiq.test.ts` (existing) | 37 tests (A–W) | Client, provider, evidence, jobs, hashing |
| `ncoreiq-auth.test.ts` | 16 scenarios (A–P) | Token acquisition, caching, fail-closed, 401/403, disabled mode, browser safety |
| `ncoreiq-scope-contract.test.ts` | 20+ tests | Scope matrix, least privilege, path constants, inheritance |

**All 525 agent tests pass.**

---

## NCoreIQClient (Updated)

Authentication is now fully dynamic:

```typescript
// Production (NCOREIQ_AUTH_MODE=xsuaa)
const client = new NCoreIQClient({
  baseUrl: 'https://ncoreiq.cfapps.us10.hana.ondemand.com',
  tokenProvider,  // XSUAAClientCredentialsTokenProvider — fetches+caches JWT
  timeoutMs: 30_000,
});

// Local dev (NCOREIQ_AUTH_MODE=disabled)
const client = new NCoreIQClient({
  baseUrl: 'http://localhost:8000',
  tokenProvider: new DisabledModeTokenProvider(),  // returns '' → no auth header
  timeoutMs: 30_000,
});

// Tests (backward-compat — static token)
const client = new NCoreIQClient({
  baseUrl: 'http://localhost:8000',
  bearerToken: 'test-token',  // static, tests only
  fetchFn: mockFetch,
});
```

---

## Remaining Items for BTP Service-to-Service Certification

After deployment of Foundation C:

1. **Execute deployment sequence** (Section above)
2. **Discover runtime xsappnames** to confirm `$XSAPPNAME(application,...)` resolved correctly
3. **Manually verify token** contains correct audience and scope claims
4. **Run integration smoke test** against deployed N-CoreShift → N-CoreIQ path
5. **Verify N-CoreIQ JWT validation** accepts the client_credentials JWT from N-CoreShift
6. If N-CoreIQ rejects the token (audience mismatch), set `AUTH__AUDIENCE` on N-CoreIQ to explicitly accept the N-CoreShift clientid

---

## Local / Mock Testing

All tests use `fetchFn` injection — no live N-CoreIQ or SAP connectivity required.

For local development with a real N-CoreIQ instance:
1. Start N-CoreIQ with `AUTH_MODE=disabled`
2. Set `NCOREIQ_BASE_URL=http://localhost:8000`
3. Set `NCOREIQ_AUTH_MODE=disabled`
4. N-CoreIQ will accept requests without a JWT

For local testing with XSUAA:
1. Set `NCOREIQ_AUTH_MODE=xsuaa`
2. Provide `NCS_XSUAA_CLIENT_ID`, `NCS_XSUAA_CLIENT_SECRET`, `NCS_XSUAA_URL` in `.env` (not committed)
3. N-CoreIQ must run with `AUTH_MODE=xsuaa` and be reachable

---

## What Is NOT Modified

| Component | Status |
|---|---|
| N-CoreIQ `app/auth/middleware.py` | Unchanged — JWT validation preserved |
| N-CoreIQ `app/auth/principal.py` | Unchanged — scope constants preserved |
| N-CoreIQ SAP connectivity (`NC1_ODATA`) | Unchanged |
| N-CoreIQ Destination Service | Unchanged |
| N-CoreIQ Connectivity Service | Unchanged |
| N-CoreIQ Cloud Connector configuration | Unchanged |
| SAP Gateway / SAP ABAP | Unchanged |
| N-CoreShift user role-collections | Unchanged — user auth unaffected |
| N-CoreShift interactive XSUAA flow | Unchanged |
