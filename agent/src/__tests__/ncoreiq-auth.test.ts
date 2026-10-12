/**
 * N-CoreShift — NCoreIQ Service-to-Service Authentication Tests (Foundation C)
 *
 * Tests A–P: client_credentials token acquisition, caching, fail-closed behavior,
 * N-CoreIQ 401/403, disabled-mode restrictions, and token safety.
 *
 * All HTTP calls use injectable mocks — no live XSUAA or N-CoreIQ required.
 */

import {
  XSUAAClientCredentialsTokenProvider,
  DisabledModeTokenProvider,
  NCoreIQTokenAcquisitionError,
  createNCoreIQTokenProvider,
} from '../ncoreiq/NCoreIQTokenProvider.js';
import { NCoreIQClient } from '../ncoreiq/NCoreIQClient.js';
import {
  NCoreIQSourceProvider,
  InMemoryNCoreIQEvidenceStore,
} from '../ncoreiq/NCoreIQSourceProvider.js';
import { NCoreIQApiError } from '../ncoreiq/types.js';
import type { SAPPingResponse } from '../ncoreiq/types.js';

// ── Test helpers ──────────────────────────────────────────────────────────

const DUMMY_TOKEN_URL = 'https://test.authentication.us10.hana.ondemand.com/oauth/token';
const DUMMY_CLIENT_ID = 'sb-ncoreshift-test!t123';
// Dummy secret — NOT a real credential. Test fixture only.
const DUMMY_CLIENT_SECRET = 'test-secret-fixture-not-real';
const DUMMY_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.dGVzdC10b2tlbi1ub3QtcmVhbA.sig';
const BASE_URL = 'http://localhost:8000';

type TokenFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

type ApiFetchFn = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

function mockTokenFetch(status: number, body: unknown): TokenFetchFn {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function mockTokenFetchTimeout(): TokenFetchFn {
  return async (_url, init) => {
    if (init.signal) {
      await new Promise<never>((_, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
          reject(err);
        });
      });
    }
    throw new Error('timeout');
  };
}

function mockTokenFetchNetwork(): TokenFetchFn {
  return async () => { throw new Error('ECONNREFUSED'); };
}

function successTokenFetch(token = DUMMY_TOKEN, expiresIn = 43200): TokenFetchFn {
  return mockTokenFetch(200, { access_token: token, token_type: 'bearer', expires_in: expiresIn });
}

function mockApiResp(status: number, body: unknown): {
  ok: boolean; status: number;
  headers: { get: (n: string) => string | null };
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

function capturedHeaders(): { captured: Record<string, string>[]; fetchFn: ApiFetchFn } {
  const captured: Record<string, string>[] = [];
  const fetchFn: ApiFetchFn = async (_url, init) => {
    captured.push((init?.headers ?? {}) as Record<string, string>);
    return mockApiResp(200, { status: 'connected', connection_mode: 'odata', system_id: 'NC1', client: '800', sap_release: '752', timestamp: '20261011', ping_method: 'SystemInfoSet', message: 'OK' } as SAPPingResponse);
  };
  return { captured, fetchFn };
}

// ── A. client_credentials token successfully obtained ─────────────────────

describe('A. Token acquisition success', () => {
  it('obtains access_token from XSUAA token endpoint', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(),
    );
    const token = await provider.getToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('POSTs grant_type=client_credentials', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchFn: TokenFetchFn = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200, json: async () => ({ access_token: DUMMY_TOKEN, expires_in: 3600 }) };
    };
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      fetchFn,
    );
    await provider.getToken();
    expect(calls[0].body).toContain('grant_type=client_credentials');
    expect(calls[0].url).toBe(DUMMY_TOKEN_URL);
  });

  it('sends Basic auth header with encoded credentials', async () => {
    const calls: Array<{ headers: Record<string, string> }> = [];
    const fetchFn: TokenFetchFn = async (_url, init) => {
      calls.push({ headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ access_token: DUMMY_TOKEN, expires_in: 3600 }) };
    };
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      fetchFn,
    );
    await provider.getToken();
    expect(calls[0].headers['Authorization']).toMatch(/^Basic /);
    // Credentials are encoded — never appear as plaintext in log-visible fields
    const encoded = calls[0].headers['Authorization'].replace('Basic ', '');
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    expect(decoded).toBe(`${DUMMY_CLIENT_ID}:${DUMMY_CLIENT_SECRET}`);
  });
});

// ── B. Token attached to N-CoreIQ request ────────────────────────────────

describe('B. Token attached to N-CoreIQ request', () => {
  it('includes Authorization: Bearer <token> on N-CoreIQ calls', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(DUMMY_TOKEN),
    );
    const { captured, fetchFn } = capturedHeaders();
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn });
    await client.ping();
    expect(captured[0]['Authorization']).toBe(`Bearer ${DUMMY_TOKEN}`);
  });

  it('does NOT send Authorization header when tokenProvider returns empty string (disabled mode)', async () => {
    const tokenProvider = new DisabledModeTokenProvider();
    const { captured, fetchFn } = capturedHeaders();
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn });
    await client.ping();
    expect(captured[0]['Authorization']).toBeUndefined();
  });
});

// ── C. Token never appears in logs ────────────────────────────────────────

describe('C. Token never in logs/errors', () => {
  it('error messages do not contain the token value', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(DUMMY_TOKEN),
    );
    const apiFetch: ApiFetchFn = async () => mockApiResp(401, {
      error: 'UNAUTHORIZED', message: 'Token invalid', request_id: 'r1', correlation_id: 'c1',
    });
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn: apiFetch });
    let caught: NCoreIQApiError | null = null;
    try { await client.ping(); } catch (e) { caught = e as NCoreIQApiError; }
    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain(DUMMY_TOKEN);
    expect(caught!.message).not.toContain('Bearer');
    expect(caught!.message).not.toContain(DUMMY_CLIENT_SECRET);
  });

  it('NCoreIQTokenAcquisitionError does not include clientSecret', () => {
    expect(() => new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: '', tokenUrl: DUMMY_TOKEN_URL },
    )).toThrow(NCoreIQTokenAcquisitionError);

    try {
      new XSUAAClientCredentialsTokenProvider(
        { clientId: DUMMY_CLIENT_ID, clientSecret: '', tokenUrl: DUMMY_TOKEN_URL },
      );
    } catch (e) {
      const err = e as NCoreIQTokenAcquisitionError;
      expect(err.message).not.toContain(DUMMY_CLIENT_SECRET);
    }
  });
});

// ── D. Missing XSUAA binding fails closed ────────────────────────────────

describe('D. Missing XSUAA binding fails closed', () => {
  it('createNCoreIQTokenProvider throws BINDING_MISSING when xsuaaConfig is null and mode=xsuaa', () => {
    expect(() => createNCoreIQTokenProvider(null, 'xsuaa', false))
      .toThrow(NCoreIQTokenAcquisitionError);
    expect(() => createNCoreIQTokenProvider(null, 'xsuaa', false))
      .toThrow('BINDING_MISSING');
  });

  it('NCoreIQSourceProvider throws when authMode=xsuaa and no tokenProvider in config', () => {
    expect(() => new NCoreIQSourceProvider(
      { baseUrl: BASE_URL },
      undefined, undefined, undefined,
      { authMode: 'xsuaa', isProduction: false },
    )).toThrow(NCoreIQTokenAcquisitionError);
  });

  it('XSUAAClientCredentialsTokenProvider constructor throws when tokenUrl is empty', () => {
    expect(() => new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: '' },
    )).toThrow(NCoreIQTokenAcquisitionError);
  });
});

// ── E. Invalid credentials fail closed ───────────────────────────────────

describe('E. Invalid credentials fail closed', () => {
  it('throws CREDENTIALS_MISSING when clientId is empty', () => {
    expect(() => new XSUAAClientCredentialsTokenProvider(
      { clientId: '', clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
    )).toThrow(NCoreIQTokenAcquisitionError);
  });

  it('throws CREDENTIALS_MISSING when clientSecret is empty', () => {
    expect(() => new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: '', tokenUrl: DUMMY_TOKEN_URL },
    )).toThrow(NCoreIQTokenAcquisitionError);
  });

  it('reason is CREDENTIALS_MISSING for empty clientId', () => {
    try {
      new XSUAAClientCredentialsTokenProvider(
        { clientId: '', clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      );
    } catch (e) {
      expect((e as NCoreIQTokenAcquisitionError).reason).toBe('CREDENTIALS_MISSING');
    }
  });
});

// ── F. Token endpoint 401 ─────────────────────────────────────────────────

describe('F. Token endpoint HTTP error', () => {
  it('throws TOKEN_ENDPOINT_ERROR on 401 from token endpoint', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      mockTokenFetch(401, { error: 'unauthorized_client' }),
    );
    await expect(provider.getToken()).rejects.toThrow(NCoreIQTokenAcquisitionError);
    await expect(provider.getToken()).rejects.toMatchObject({ reason: 'TOKEN_ENDPOINT_ERROR' });
  });

  it('throws TOKEN_ENDPOINT_ERROR on 400 from token endpoint', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      mockTokenFetch(400, { error: 'invalid_client' }),
    );
    await expect(provider.getToken()).rejects.toMatchObject({ reason: 'TOKEN_ENDPOINT_ERROR' });
  });

  it('error message does not include response body (may contain credential hints)', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      mockTokenFetch(401, { error: 'INVALID_SECRET', hint: DUMMY_CLIENT_SECRET }),
    );
    try {
      await provider.getToken();
    } catch (e) {
      const err = e as NCoreIQTokenAcquisitionError;
      expect(err.message).not.toContain(DUMMY_CLIENT_SECRET);
      expect(err.reason).toBe('TOKEN_ENDPOINT_ERROR');
    }
  });
});

// ── G. Token endpoint timeout ─────────────────────────────────────────────

describe('G. Token endpoint timeout', () => {
  it('throws TOKEN_ENDPOINT_TIMEOUT on AbortError', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      mockTokenFetchTimeout(),
    );
    await expect(provider.getToken()).rejects.toMatchObject({ reason: 'TOKEN_ENDPOINT_TIMEOUT' });
  }, 20_000);

  it('throws TOKEN_ENDPOINT_UNAVAILABLE on ECONNREFUSED', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      mockTokenFetchNetwork(),
    );
    await expect(provider.getToken()).rejects.toMatchObject({ reason: 'TOKEN_ENDPOINT_UNAVAILABLE' });
  });
});

// ── H. Token refresh ──────────────────────────────────────────────────────

describe('H. Token refresh', () => {
  it('re-acquires token after invalidateCache()', async () => {
    let callCount = 0;
    const fetchFn: TokenFetchFn = async () => {
      callCount++;
      return { ok: true, status: 200, json: async () => ({ access_token: `token-${callCount}`, expires_in: 43200 }) };
    };
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      fetchFn,
    );
    const t1 = await provider.getToken();
    provider.invalidateCache();
    const t2 = await provider.getToken();
    expect(callCount).toBe(2);
    expect(t1).not.toBe(t2);
  });

  it('re-acquires when token is expired (short expires_in)', async () => {
    let callCount = 0;
    const fetchFn: TokenFetchFn = async () => {
      callCount++;
      // expires_in=1 means valid for 1s, but with 30s margin it's immediately expired
      return { ok: true, status: 200, json: async () => ({ access_token: `token-${callCount}`, expires_in: 1 }) };
    };
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      fetchFn,
    );
    await provider.getToken();
    await provider.getToken();
    // Both calls should trigger acquisition since expires_in=1 with 30s margin is always expired
    expect(callCount).toBe(2);
  });
});

// ── I. Cached token reuse ─────────────────────────────────────────────────

describe('I. Cached token reuse', () => {
  it('reuses cached token on repeated getToken() calls within validity window', async () => {
    let callCount = 0;
    const fetchFn: TokenFetchFn = async () => {
      callCount++;
      return { ok: true, status: 200, json: async () => ({ access_token: DUMMY_TOKEN, expires_in: 43200 }) };
    };
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      fetchFn,
    );
    const t1 = await provider.getToken();
    const t2 = await provider.getToken();
    const t3 = await provider.getToken();
    expect(callCount).toBe(1); // Only one HTTP call
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
  });

  it('hasCachedToken() returns true after successful acquisition', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(),
    );
    expect(provider.hasCachedToken()).toBe(false);
    await provider.getToken();
    expect(provider.hasCachedToken()).toBe(true);
  });

  it('hasCachedToken() returns false after invalidateCache()', async () => {
    const provider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(),
    );
    await provider.getToken();
    provider.invalidateCache();
    expect(provider.hasCachedToken()).toBe(false);
  });
});

// ── J. N-CoreIQ 401 ───────────────────────────────────────────────────────

describe('J. N-CoreIQ 401 response', () => {
  it('propagates NCoreIQApiError with httpStatus=401', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(),
    );
    const apiFetch: ApiFetchFn = async () => mockApiResp(401, {
      error: 'UNAUTHORIZED', message: 'JWT expired', request_id: 'r1', correlation_id: 'c1',
    });
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn: apiFetch });
    let err: NCoreIQApiError | null = null;
    try { await client.ping(); } catch (e) { err = e as NCoreIQApiError; }
    expect(err).toBeInstanceOf(NCoreIQApiError);
    expect(err!.httpStatus).toBe(401);
    expect(err!.errorCode).toBe('UNAUTHORIZED');
  });
});

// ── K. N-CoreIQ 403 ───────────────────────────────────────────────────────

describe('K. N-CoreIQ 403 response', () => {
  it('propagates NCoreIQApiError with httpStatus=403 and errorCode=FORBIDDEN', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(),
    );
    const apiFetch: ApiFetchFn = async () => mockApiResp(403, {
      error: 'FORBIDDEN', message: 'Insufficient scope', request_id: 'r2', correlation_id: 'c2',
    });
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn: apiFetch });
    let err: NCoreIQApiError | null = null;
    try { await client.ping(); } catch (e) { err = e as NCoreIQApiError; }
    expect(err!.httpStatus).toBe(403);
    expect(err!.errorCode).toBe('FORBIDDEN');
  });
});

// ── L. Insufficient N-CoreIQ scope ───────────────────────────────────────

describe('L. Insufficient scope (403 Forbidden)', () => {
  it('testConnection() returns connected=false on 403 without exposing token', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(DUMMY_TOKEN),
    );
    const apiFetch: ApiFetchFn = async () => mockApiResp(403, {
      error: 'FORBIDDEN', message: 'Insufficient scope: NCoreIQ.Viewer required',
      request_id: 'r3', correlation_id: 'c3',
    });
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = new NCoreIQSourceProvider(
      { baseUrl: BASE_URL, tokenProvider, fetchFn: apiFetch },
      store,
    );
    const result = await provider.testConnection();
    expect(result.connected).toBe(false);
    expect(result.error).not.toContain(DUMMY_TOKEN);
    expect(result.error).not.toContain('Bearer');
  });
});

// ── M. Disabled auth allowed only in local/development mode ──────────────

describe('M. Disabled auth — local dev only', () => {
  it('DisabledModeTokenProvider returns empty string (no auth header)', async () => {
    const p = new DisabledModeTokenProvider();
    const token = await p.getToken();
    expect(token).toBe('');
  });

  it('NCoreIQSourceProvider with authMode=disabled and isProduction=false does NOT throw', () => {
    expect(() => new NCoreIQSourceProvider(
      { baseUrl: BASE_URL },
      undefined, undefined, undefined,
      { authMode: 'disabled', isProduction: false },
    )).not.toThrow();
  });

  it('createNCoreIQTokenProvider(null, "disabled", false) returns DisabledModeTokenProvider', async () => {
    const p = createNCoreIQTokenProvider(null, 'disabled', false);
    expect(p).toBeInstanceOf(DisabledModeTokenProvider);
    const token = await p.getToken();
    expect(token).toBe('');
  });
});

// ── N. Production cannot downgrade to disabled ───────────────────────────

describe('N. Production fails closed on disabled auth', () => {
  it('NCoreIQSourceProvider throws when isProduction=true and authMode=disabled', () => {
    expect(() => new NCoreIQSourceProvider(
      { baseUrl: BASE_URL },
      undefined, undefined, undefined,
      { authMode: 'disabled', isProduction: true },
    )).toThrow(NCoreIQTokenAcquisitionError);
  });

  it('createNCoreIQTokenProvider throws BINDING_MISSING when isProduction=true and mode=disabled', () => {
    expect(() => createNCoreIQTokenProvider(null, 'disabled', true))
      .toThrow(NCoreIQTokenAcquisitionError);
  });

  it('error reason is BINDING_MISSING for production+disabled', () => {
    try {
      createNCoreIQTokenProvider(null, 'disabled', true);
    } catch (e) {
      expect((e as NCoreIQTokenAcquisitionError).reason).toBe('BINDING_MISSING');
    }
  });
});

// ── O. Browser never receives technical token ─────────────────────────────

describe('O. Token stays server-side', () => {
  it('NCoreIQClient does not expose token via its public API surface', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(DUMMY_TOKEN),
    );
    const { fetchFn } = capturedHeaders();
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn });
    // Public API has no method to extract the token
    const publicProps = Object.getOwnPropertyNames(NCoreIQClient.prototype).filter(
      (p) => !p.startsWith('_') && p !== 'constructor',
    );
    expect(publicProps).not.toContain('getToken');
    expect(publicProps).not.toContain('bearerToken');
    expect(publicProps).not.toContain('token');
    // client object itself has no public token property
    expect((client as unknown as Record<string, unknown>)['token']).toBeUndefined();
    expect((client as unknown as Record<string, unknown>)['bearerToken']).toBeUndefined();
  });

  it('testConnection() result does not include any token field', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(DUMMY_TOKEN),
    );
    const apiFetch: ApiFetchFn = async () => mockApiResp(200, {
      status: 'connected', connection_mode: 'odata', system_id: 'NC1', client: '800',
      sap_release: '752', timestamp: '20261011', ping_method: 'SystemInfoSet', message: 'OK',
    });
    const store = new InMemoryNCoreIQEvidenceStore();
    const provider = new NCoreIQSourceProvider(
      { baseUrl: BASE_URL, tokenProvider, fetchFn: apiFetch },
      store,
    );
    const result = await provider.testConnection();
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(DUMMY_TOKEN);
    expect(resultStr).not.toContain('Bearer');
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('bearerToken');
  });
});

// ── P. NCoreIQClient sends no max_lines for complete-source calls ──────────

describe('P. getSource() never sends max_lines (complete source)', () => {
  it('getSource() does not include max_lines param', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(),
    );
    const calls: string[] = [];
    const apiFetch: ApiFetchFn = async (url) => {
      calls.push(url);
      return mockApiResp(200, {
        sap_object_type: 'PROG', object_name: 'ZTEST', system_id: 'NC1', client: '800',
        max_lines: null, returned_lines: 100, component_count: 1, found: true,
        truncated: false, message: null, sha256: 'abc123',
        components: [{ component_type: 'PROGRAM', component_name: 'ZTEST', line_count: 1, source_text: '', lines: [] }],
      });
    };
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn: apiFetch });
    await client.getSource('PROG', 'ZTEST');
    expect(calls[0]).not.toContain('max_lines');
    expect(calls[0]).toContain('/api/v1/repository/objects/PROG/ZTEST/source');
  });

  it('getSource() with tokenProvider still sends Bearer token', async () => {
    const tokenProvider = new XSUAAClientCredentialsTokenProvider(
      { clientId: DUMMY_CLIENT_ID, clientSecret: DUMMY_CLIENT_SECRET, tokenUrl: DUMMY_TOKEN_URL },
      successTokenFetch(DUMMY_TOKEN),
    );
    const sentHeaders: Record<string, string>[] = [];
    const apiFetch: ApiFetchFn = async (_url, init) => {
      sentHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return mockApiResp(200, {
        sap_object_type: 'PROG', object_name: 'ZTEST', system_id: 'NC1', client: '800',
        max_lines: null, returned_lines: 5, component_count: 1, found: true,
        truncated: false, message: null, sha256: 'abc',
        components: [{ component_type: 'PROGRAM', component_name: 'ZTEST', line_count: 1, source_text: '', lines: [] }],
      });
    };
    const client = new NCoreIQClient({ baseUrl: BASE_URL, tokenProvider, fetchFn: apiFetch });
    await client.getSource('PROG', 'ZTEST');
    expect(sentHeaders[0]['Authorization']).toBe(`Bearer ${DUMMY_TOKEN}`);
  });
});
