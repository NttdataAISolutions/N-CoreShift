/**
 * N-CoreShift — NCoreIQTokenProvider
 *
 * Server-side XSUAA client_credentials token provider for machine-to-machine
 * authentication between N-CoreShift and N-CoreIQ.
 *
 * Responsibilities:
 *   - Acquire access token via OAuth2 client_credentials grant
 *   - Cache and reuse tokens safely until close to expiry (30s safety margin)
 *   - Refresh before expiration
 *   - Never expose token to React / browser layer
 *   - Never persist token to DB
 *   - Never log token value
 *   - Normalize OAuth failures safely without leaking credentials
 *   - Fail CLOSED in production if binding is missing or credentials invalid
 *
 * Token flow:
 *   N-CoreShift XSUAA binding (VCAP_SERVICES)
 *       | client_credentials POST
 *       v
 *     XSUAA token endpoint
 *       | JWT with NCoreIQ authorities
 *       v
 *   NCoreIQClient → Authorization: Bearer <token>
 *
 * SECURITY:
 *   - clientSecret is NEVER logged (not even as [REDACTED])
 *   - Token value is NEVER logged or included in thrown Error messages
 *   - Token is NEVER forwarded to the browser / React
 *   - Production mode (NCOREIQ_AUTH_MODE=xsuaa) FAILS CLOSED if:
 *       · XSUAA binding is absent
 *       · clientId or clientSecret is empty
 *       · tokenUrl cannot be resolved
 *       · Token endpoint returns non-200
 *       · Token endpoint is unreachable
 */

// ── Token cache entry ─────────────────────────────────────────────────────

interface CachedToken {
  /** Opaque access token — never logged. */
  readonly token: string;
  /** Absolute expiry timestamp (ms since epoch) minus safety margin. */
  readonly validUntil: number;
}

// Safety margin before true token expiry (ms). Renew this many ms early.
const EXPIRY_SAFETY_MS = 30_000;

// Default token lifetime if XSUAA response is missing `expires_in` (12 hours).
const DEFAULT_EXPIRES_IN_SECONDS = 43_200;

// Timeout for the token endpoint HTTP call (ms).
const TOKEN_FETCH_TIMEOUT_MS = 15_000;

// ── NCoreIQTokenProvider interface ───────────────────────────────────────────

/**
 * Provides an XSUAA access token for N-CoreIQ backend-to-backend calls.
 * Implementations must cache tokens and never log their values.
 */
export interface NCoreIQTokenProvider {
  /**
   * Returns a valid access token string.
   * Callers must attach it as: Authorization: Bearer <token>
   * Implementations may cache and refresh as needed.
   * Throws NCoreIQTokenAcquisitionError on failure.
   */
  getToken(): Promise<string>;
}

// ── Error type ────────────────────────────────────────────────────────────────

/**
 * Thrown when token acquisition fails.
 * The message NEVER includes the token, clientSecret, or raw HTTP response body.
 */
export class NCoreIQTokenAcquisitionError extends Error {
  constructor(
    public readonly reason: 'BINDING_MISSING' | 'CREDENTIALS_MISSING' | 'TOKEN_ENDPOINT_UNAVAILABLE' | 'TOKEN_ENDPOINT_ERROR' | 'TOKEN_ENDPOINT_TIMEOUT' | 'UNEXPECTED',
    detail: string,
  ) {
    super(`[NCoreIQTokenProvider] Token acquisition failed (${reason}): ${detail}`);
    this.name = 'NCoreIQTokenAcquisitionError';
  }
}

// ── XSUAA binding config ──────────────────────────────────────────────────────

/**
 * Binding configuration for the XSUAA token endpoint.
 * Values come from VCAP_SERVICES / env vars — never hard-coded.
 */
export interface XSUAABindingConfig {
  /** OAuth2 client ID from XSUAA service binding. Never logged. */
  readonly clientId: string;
  /** OAuth2 client secret from XSUAA service binding. NEVER logged. */
  readonly clientSecret: string;
  /**
   * Full XSUAA token endpoint URL.
   * Typically: https://<subaccount>.authentication.<region>.hana.ondemand.com/oauth/token
   * Derived from XSUAA service binding `url` field + '/oauth/token'.
   */
  readonly tokenUrl: string;
}

// ── Minimal fetch interface for testability ───────────────────────────────────

type TokenFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

// ── XSUAAClientCredentialsTokenProvider ──────────────────────────────────────

/**
 * Production token provider.
 *
 * Uses OAuth2 client_credentials grant against the XSUAA token endpoint.
 * Token is cached until (exp - EXPIRY_SAFETY_MS).
 *
 * Usage:
 *   const provider = XSUAAClientCredentialsTokenProvider.fromBinding(xsuaaConfig);
 *   const token = await provider.getToken();
 *   // → attach as Authorization: Bearer <token>
 */
export class XSUAAClientCredentialsTokenProvider implements NCoreIQTokenProvider {
  private readonly _clientId: string;
  // clientSecret stored as opaque value, NEVER logged.
  private readonly _clientSecret: string;
  private readonly _tokenUrl: string;
  private readonly _fetchFn: TokenFetchFn;
  private _cache: CachedToken | null = null;

  constructor(binding: XSUAABindingConfig, fetchFn?: TokenFetchFn) {
    if (!binding.clientId || binding.clientId.trim() === '') {
      throw new NCoreIQTokenAcquisitionError('CREDENTIALS_MISSING', 'clientId is empty');
    }
    if (!binding.clientSecret || binding.clientSecret.trim() === '') {
      throw new NCoreIQTokenAcquisitionError('CREDENTIALS_MISSING', 'clientSecret is empty');
    }
    if (!binding.tokenUrl || binding.tokenUrl.trim() === '') {
      throw new NCoreIQTokenAcquisitionError('BINDING_MISSING', 'tokenUrl is empty');
    }
    this._clientId = binding.clientId;
    this._clientSecret = binding.clientSecret;
    this._tokenUrl = binding.tokenUrl;
    // Use injected fetch (tests) or globalThis.fetch (production, Node 18+)
    this._fetchFn = fetchFn ?? (globalThis.fetch as unknown as TokenFetchFn);
  }

  /**
   * Returns a valid access token. Reuses cached token if still valid.
   * Thread-safe for single-threaded Node event loop.
   * Throws NCoreIQTokenAcquisitionError on any failure.
   */
  async getToken(): Promise<string> {
    if (this._isCacheValid()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this._cache!.token;
    }
    return this._acquireToken();
  }

  private _isCacheValid(): boolean {
    return (
      this._cache !== null &&
      Date.now() < this._cache.validUntil
    );
  }

  private async _acquireToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    }).toString();

    // Basic auth — credentials encoded but never logged
    const basicAuth = Buffer.from(
      `${this._clientId}:${this._clientSecret}`,
      'utf-8',
    ).toString('base64');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKEN_FETCH_TIMEOUT_MS);

    let response: { ok: boolean; status: number; json: () => Promise<unknown> };

    try {
      response = await this._fetchFn(this._tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Authorization header with credentials — NEVER logged anywhere in this file.
          Authorization: `Basic ${basicAuth}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NCoreIQTokenAcquisitionError(
          'TOKEN_ENDPOINT_TIMEOUT',
          `Token endpoint did not respond within ${TOKEN_FETCH_TIMEOUT_MS}ms`,
        );
      }
      // Do not include URL (may contain subaccount) or cause in message to avoid leaking
      throw new NCoreIQTokenAcquisitionError(
        'TOKEN_ENDPOINT_UNAVAILABLE',
        'Token endpoint is unreachable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Do NOT include response body — may contain OAuth error details with credential refs
      throw new NCoreIQTokenAcquisitionError(
        'TOKEN_ENDPOINT_ERROR',
        `Token endpoint returned HTTP ${response.status}`,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new NCoreIQTokenAcquisitionError(
        'TOKEN_ENDPOINT_ERROR',
        'Token endpoint returned non-JSON response',
      );
    }

    const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token : null;
    if (!accessToken) {
      throw new NCoreIQTokenAcquisitionError(
        'TOKEN_ENDPOINT_ERROR',
        'Token response missing access_token field',
      );
    }

    const expiresIn =
      typeof parsed.expires_in === 'number' && parsed.expires_in > 0
        ? parsed.expires_in
        : DEFAULT_EXPIRES_IN_SECONDS;

    // Cache token — store opaque value, never log it
    this._cache = {
      token: accessToken,
      validUntil: Date.now() + (expiresIn * 1_000) - EXPIRY_SAFETY_MS,
    };

    // Token itself is NOT logged — only acquisition success
    return accessToken;
  }

  /**
   * Invalidate the cached token — forces re-acquisition on next getToken().
   * Use for forced refresh testing or after receiving 401 from N-CoreIQ.
   */
  invalidateCache(): void {
    this._cache = null;
  }

  /**
   * Returns true if a valid cached token exists (for testing/introspection).
   * Does NOT return the token value.
   */
  hasCachedToken(): boolean {
    return this._isCacheValid();
  }
}

// ── DisabledModeTokenProvider ─────────────────────────────────────────────────

/**
 * Token provider for NCOREIQ_AUTH_MODE=disabled (local development only).
 *
 * Returns empty string — NCoreIQClient omits Authorization header when token is empty.
 *
 * MUST NOT be used in production (NCOREIQ_AUTH_MODE=xsuaa).
 * NCoreIQSourceProvider enforces this at construction time.
 */
export class DisabledModeTokenProvider implements NCoreIQTokenProvider {
  async getToken(): Promise<string> {
    // Returns empty string — client will not send Authorization header.
    // Production guard is enforced at NCoreIQSourceProvider level.
    return '';
  }
}

// ── Factory function ──────────────────────────────────────────────────────────

/**
 * Create an NCoreIQTokenProvider from the N-CoreShift XSUAA service binding.
 *
 * In production (NCOREIQ_AUTH_MODE=xsuaa): reads clientId, clientSecret, tokenUrl
 * from the resolved XSUAA binding. Throws NCoreIQTokenAcquisitionError if the
 * binding is absent or incomplete.
 *
 * In disabled mode (NCOREIQ_AUTH_MODE=disabled): returns DisabledModeTokenProvider.
 * Disabled mode is only allowed when NOT in production (NODE_ENV !== 'production').
 *
 * @param xsuaaConfig - XSUAA config resolved from VCAP_SERVICES / env vars
 * @param authMode    - 'xsuaa' | 'disabled'
 * @param isProduction - true when NODE_ENV=production
 * @param fetchFn     - optional fetch override for testing
 */
export function createNCoreIQTokenProvider(
  xsuaaConfig: { clientId: string; clientSecret: string; url: string } | null,
  authMode: 'xsuaa' | 'disabled',
  isProduction: boolean,
  fetchFn?: TokenFetchFn,
): NCoreIQTokenProvider {
  // Production MUST NOT downgrade to disabled
  if (isProduction && authMode === 'disabled') {
    throw new NCoreIQTokenAcquisitionError(
      'BINDING_MISSING',
      'NCOREIQ_AUTH_MODE=disabled is not permitted in production (NODE_ENV=production). ' +
        'Set NCOREIQ_AUTH_MODE=xsuaa and provide a valid XSUAA service binding.',
    );
  }

  if (authMode === 'disabled') {
    return new DisabledModeTokenProvider();
  }

  // xsuaa mode — requires XSUAA binding
  if (!xsuaaConfig) {
    throw new NCoreIQTokenAcquisitionError(
      'BINDING_MISSING',
      'NCOREIQ_AUTH_MODE=xsuaa but no XSUAA service binding was found. ' +
        'Ensure the ncoreshift-uaa service is bound and VCAP_SERVICES is populated, ' +
        'or set NCS_XSUAA_CLIENT_ID / NCS_XSUAA_CLIENT_SECRET / NCS_XSUAA_URL env vars.',
    );
  }

  const tokenUrl = xsuaaConfig.url.replace(/\/+$/, '') + '/oauth/token';

  return new XSUAAClientCredentialsTokenProvider(
    {
      clientId: xsuaaConfig.clientId,
      clientSecret: xsuaaConfig.clientSecret,
      tokenUrl,
    },
    fetchFn,
  );
}
