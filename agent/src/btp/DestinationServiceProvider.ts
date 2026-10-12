/**
 * N-CoreShift – SAP BTP Destination Service Provider
 *
 * Resolves named destinations from the BTP Destination Service and returns
 * the URL + resolved Authorization header so callers never touch credentials
 * directly.
 *
 * Design decisions:
 *  - OAuth2 client-credentials token is cached with a configurable TTL.
 *  - Resolved destinations are cached per-name for `cacheTtlMs` (default 5 min)
 *    to avoid hammering the Destination Service on every SAP system call.
 *  - No SDK dependency – uses built-in fetch (Node ≥ 18).
 *  - Supports NoAuthentication, BasicAuthentication, and
 *    OAuth2ClientCredentials destination auth types.
 */

import type {
  DestinationServiceAdapterConfig,
  ResolvedDestination,
} from './types.js';

// ── Token cache ───────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch seconds
}

// ── Destination cache entry ───────────────────────────────────────────────────

interface CachedDestination {
  resolved: ResolvedDestination;
  expiresAt: number; // epoch ms
}

// ── Raw Destination Service response shape ────────────────────────────────────

interface DestinationServiceResponse {
  destinationConfiguration: Record<string, string>;
  authTokens?: {
    type: string;
    value: string;
    error?: string;
  }[];
}

const TOKEN_EXPIRY_BUFFER_SEC = 60;

// ── DestinationServiceProvider ────────────────────────────────────────────────

export class DestinationServiceProvider {
  private readonly cfg: Required<DestinationServiceAdapterConfig>;
  private _token: CachedToken | null = null;
  private readonly _cache = new Map<string, CachedDestination>();

  constructor(config: DestinationServiceAdapterConfig) {
    this.cfg = {
      cacheTtlMs: 300_000,
      ...config,
    };
  }

  /**
   * Resolve a named destination.
   * Returns the destination URL and a ready-to-use Authorization header.
   * Throws if the destination is not found or its auth token is invalid.
   */
  async resolve(destinationName: string): Promise<ResolvedDestination> {
    const cached = this._cache.get(destinationName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.resolved;
    }

    const accessToken = await this._fetchToken();
    const url =
      `${this.cfg.serviceUrl.replace(/\/$/, '')}/destination-configuration/v1/destinations/${encodeURIComponent(destinationName)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 404) {
      throw new Error(`Destination '${destinationName}' not found in BTP Destination Service`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Destination Service error for '${destinationName}': HTTP ${res.status} – ${body.substring(0, 300)}`,
      );
    }

    const data = (await res.json()) as DestinationServiceResponse;
    const cfg = data.destinationConfiguration;
    const authType = cfg['Authentication'] ?? 'NoAuthentication';

    let authorizationHeader: string | undefined;

    if (data.authTokens && data.authTokens.length > 0) {
      const token = data.authTokens[0];
      if (token.error) {
        throw new Error(
          `Destination '${destinationName}' auth token error: ${token.error}`,
        );
      }
      authorizationHeader = `${token.type} ${token.value}`;
    } else if (authType === 'BasicAuthentication') {
      const user = cfg['User'] ?? '';
      const pass = cfg['Password'] ?? '';
      const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
      authorizationHeader = `Basic ${encoded}`;
    }
    // NoAuthentication → authorizationHeader stays undefined

    const resolved: ResolvedDestination = {
      name: destinationName,
      url: cfg['URL'] ?? '',
      authenticationType: authType,
      authorizationHeader,
      properties: cfg,
    };

    this._cache.set(destinationName, {
      resolved,
      expiresAt: Date.now() + this.cfg.cacheTtlMs,
    });

    return resolved;
  }

  /**
   * List all available destination names visible to this service binding.
   */
  async listNames(): Promise<string[]> {
    const accessToken = await this._fetchToken();
    const url = `${this.cfg.serviceUrl.replace(/\/$/, '')}/destination-configuration/v1/subaccountDestinations`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Destination Service list failed: HTTP ${res.status} – ${body}`);
    }

    const data = (await res.json()) as { destinationName: string }[];
    return data.map((d) => d.destinationName);
  }

  /** Evict a destination from the in-process cache (e.g. after credential rotation). */
  evict(destinationName: string): void {
    this._cache.delete(destinationName);
  }

  /** Clear the entire destination cache. */
  clearCache(): void {
    this._cache.clear();
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async _fetchToken(): Promise<string> {
    if (
      this._token &&
      this._token.expiresAt > Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_BUFFER_SEC
    ) {
      return this._token.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });

    const res = await fetch(`${this.cfg.tokenUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Destination Service OAuth2 token fetch failed: HTTP ${res.status} – ${text}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    this._token = {
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    };

    return this._token.accessToken;
  }
}
