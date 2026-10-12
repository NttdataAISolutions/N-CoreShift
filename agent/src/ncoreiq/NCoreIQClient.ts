/**
 * N-CoreShift — NCoreIQClient
 *
 * Typed HTTP client for the N-CoreIQ External Consumer REST API v1.
 *
 * All endpoint paths are taken from the authoritative contract
 * (ncoreiq-consumer-contract-v1.md Section 7). No paths are invented.
 *
 * Responsibilities:
 *  - base URL construction
 *  - endpoint path building (centralised — not duplicated elsewhere)
 *  - Authorization header injection via tokenProvider (XSUAA) or bearerToken (tests)
 *  - timeout via AbortController
 *  - upstream error normalisation into NCoreIQApiError
 *  - secret-safe logging (Authorization headers are NEVER logged)
 *
 * Authentication:
 *  NCOREIQ_AUTH_MODE=xsuaa   → tokenProvider acquires client_credentials JWT dynamically.
 *  NCOREIQ_AUTH_MODE=disabled → No Authorization header sent (local dev only).
 *  bearerToken config field   → Backward-compat for existing tests only.
 */

import {
  NCoreIQClientConfig,
  NCoreIQApiError,
  NCoreIQTimeoutError,
  NCoreIQUnavailableError,
  NCOREIQ_HTTP,
  SAPPingResponse,
  PackageHierarchyResponse,
  PackageListOptions,
  RepositorySearchRequest,
  RepositorySearchResponse,
  RepositoryObjectMetadata,
  RepositoryObjectSource,
  DependencyQueryOptions,
  DirectDependenciesResponse,
  DependencyTraversalRequest,
  DependencyTraversalResponse,
  ReverseLookupRequest,
  ReverseLookupResponse,
  ImpactAnalysisRequest,
  ImpactAnalysisResponse,
  ExtractionJobRequest,
  ExtractionJobCreatedResponse,
  JobStatusResponse,
  JobResultResponse,
} from './types.js';
import type { NCoreIQTokenProvider } from './NCoreIQTokenProvider.js';

// ── API path constants (Contract Section 7 — authoritative) ──────────────
// Do NOT duplicate these strings anywhere else in the codebase.

const API_BASE = '/api/v1';

export const NCOREIQ_PATHS = {
  SAP_PING: `${API_BASE}/sap/ping`,
  PACKAGE: (pkg: string) => `${API_BASE}/repository/packages/${encodeURIComponent(pkg)}`,
  SEARCH: `${API_BASE}/repository/search`,
  OBJECT_METADATA: (type: string, name: string) =>
    `${API_BASE}/repository/objects/${encodeURIComponent(type)}/${encodeURIComponent(name)}/metadata`,
  OBJECT_SOURCE: (type: string, name: string) =>
    `${API_BASE}/repository/objects/${encodeURIComponent(type)}/${encodeURIComponent(name)}/source`,
  OBJECT_DEPENDENCIES: (type: string, name: string) =>
    `${API_BASE}/repository/objects/${encodeURIComponent(type)}/${encodeURIComponent(name)}/dependencies`,
  DEPENDENCIES_TRAVERSE: `${API_BASE}/repository/dependencies/traverse`,
  DEPENDENCIES_REVERSE: `${API_BASE}/repository/dependencies/reverse`,
  DEPENDENCIES_IMPACT: `${API_BASE}/repository/dependencies/impact`,
  JOBS: `${API_BASE}/repository/jobs`,
  JOB: (jobId: string) => `${API_BASE}/repository/jobs/${encodeURIComponent(jobId)}`,
  JOB_RESULT: (jobId: string) => `${API_BASE}/repository/jobs/${encodeURIComponent(jobId)}/result`,
  JOB_ARTIFACT: (jobId: string) => `${API_BASE}/repository/jobs/${encodeURIComponent(jobId)}/artifact`,
} as const;

const DEFAULT_TIMEOUT_MS = 30_000;

// Minimal fetch-like interface used internally (avoids DOM type dependency in tests)
type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

// ── NCoreIQClient ─────────────────────────────────────────────────────────

export class NCoreIQClient {
  private readonly _baseUrl: string;
  private readonly _timeoutMs: number;
  // Static bearerToken — backward compat for tests. Never logged.
  private readonly _bearerToken: string | undefined;
  // Dynamic token provider (XSUAA client_credentials). Takes precedence over bearerToken.
  private readonly _tokenProvider: NCoreIQTokenProvider | undefined;
  private readonly _fetchFn: FetchLike;

  constructor(config: NCoreIQClientConfig) {
    if (!config.baseUrl || config.baseUrl.trim() === '') {
      throw new Error('NCoreIQClient: baseUrl is required');
    }
    // Strip trailing slash to allow consistent path concatenation.
    this._baseUrl = config.baseUrl.replace(/\/+$/, '');
    this._timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._bearerToken = config.bearerToken;
    this._tokenProvider = config.tokenProvider;
    // Use injected fetch (tests) or globalThis.fetch (production, Node 18+)
    this._fetchFn = (config.fetchFn as FetchLike | undefined) ?? (globalThis.fetch as unknown as FetchLike);
  }

  // ── Section 7-A: SAP Ping ──────────────────────────────────────────────

  async ping(): Promise<SAPPingResponse> {
    return this._get<SAPPingResponse>(NCOREIQ_PATHS.SAP_PING);
  }

  // ── Section 7-B: Package Discovery ───────────────────────────────────

  async listPackages(
    packageName: string,
    options: PackageListOptions = {},
  ): Promise<PackageHierarchyResponse> {
    const params: Record<string, string> = {};
    if (options.include_subpackages !== undefined) {
      params['include_subpackages'] = String(options.include_subpackages);
    }
    if (options.max_depth !== undefined) {
      params['max_depth'] = String(options.max_depth);
    }
    return this._get<PackageHierarchyResponse>(
      NCOREIQ_PATHS.PACKAGE(packageName),
      params,
    );
  }

  // ── Section 7-C: Repository Search ───────────────────────────────────

  async searchObjects(request: RepositorySearchRequest): Promise<RepositorySearchResponse> {
    return this._post<RepositorySearchResponse>(NCOREIQ_PATHS.SEARCH, request);
  }

  // ── Section 7-D: Object Metadata ─────────────────────────────────────

  async getMetadata(
    objectType: string,
    objectName: string,
  ): Promise<RepositoryObjectMetadata> {
    return this._get<RepositoryObjectMetadata>(
      NCOREIQ_PATHS.OBJECT_METADATA(objectType, objectName),
    );
  }

  // ── Section 7-E: Object Source ────────────────────────────────────────

  /**
   * Retrieve COMPLETE source for an object.
   * Does NOT send max_lines — complete retrieval is the default.
   * N-CoreIQ follows SAP pagination internally and returns all lines.
   */
  async getSource(
    objectType: string,
    objectName: string,
  ): Promise<RepositoryObjectSource> {
    // No max_lines param — complete source (contract default).
    return this._get<RepositoryObjectSource>(
      NCOREIQ_PATHS.OBJECT_SOURCE(objectType, objectName),
    );
  }

  /**
   * Retrieve BOUNDED source — for preview/display only.
   * Persisted evidence MUST use getSource() (no max_lines).
   */
  async getSourceBounded(
    objectType: string,
    objectName: string,
    maxLines: number,
  ): Promise<RepositoryObjectSource> {
    return this._get<RepositoryObjectSource>(
      NCOREIQ_PATHS.OBJECT_SOURCE(objectType, objectName),
      { max_lines: String(maxLines) },
    );
  }

  // ── Section 7-F: Direct Dependencies ─────────────────────────────────

  async getDependencies(
    objectType: string,
    objectName: string,
    options: DependencyQueryOptions = {},
  ): Promise<DirectDependenciesResponse> {
    const params: Record<string, string> = {};
    if (options.relationship_type?.length) {
      // Repeatable param — join as multiple entries; handled via URL encoding
      params['relationship_type'] = options.relationship_type.join(',');
    }
    if (options.min_confidence) {
      params['min_confidence'] = options.min_confidence;
    }
    if (options.max_results !== undefined) {
      params['max_results'] = String(options.max_results);
    }
    return this._get<DirectDependenciesResponse>(
      NCOREIQ_PATHS.OBJECT_DEPENDENCIES(objectType, objectName),
      params,
    );
  }

  // ── Section 7-G: Dependency Traversal ────────────────────────────────

  async traverseDependencies(
    request: DependencyTraversalRequest,
  ): Promise<DependencyTraversalResponse> {
    return this._post<DependencyTraversalResponse>(
      NCOREIQ_PATHS.DEPENDENCIES_TRAVERSE,
      request,
    );
  }

  // ── Section 7-H: Reverse Dependency Lookup ───────────────────────────

  async findDependents(request: ReverseLookupRequest): Promise<ReverseLookupResponse> {
    return this._post<ReverseLookupResponse>(
      NCOREIQ_PATHS.DEPENDENCIES_REVERSE,
      request,
    );
  }

  // ── Section 7-I: Dependency Impact Analysis ──────────────────────────

  async analyzeImpact(request: ImpactAnalysisRequest): Promise<ImpactAnalysisResponse> {
    return this._post<ImpactAnalysisResponse>(
      NCOREIQ_PATHS.DEPENDENCIES_IMPACT,
      request,
    );
  }

  // ── Section 7-J: Extraction Job Creation ─────────────────────────────

  async createExtractionJob(
    request: ExtractionJobRequest,
    idempotencyKey?: string,
  ): Promise<ExtractionJobCreatedResponse> {
    const extraHeaders: Record<string, string> = {};
    if (idempotencyKey) {
      extraHeaders['Idempotency-Key'] = idempotencyKey;
    }
    return this._post<ExtractionJobCreatedResponse>(
      NCOREIQ_PATHS.JOBS,
      request,
      extraHeaders,
    );
  }

  // ── Section 7-K: Job Status ───────────────────────────────────────────

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    return this._get<JobStatusResponse>(NCOREIQ_PATHS.JOB(jobId));
  }

  // ── Section 7-L: Job Result ───────────────────────────────────────────

  async getJobResult(jobId: string): Promise<JobResultResponse> {
    return this._get<JobResultResponse>(NCOREIQ_PATHS.JOB_RESULT(jobId));
  }

  // ── Section 7-M: Artifact Download ───────────────────────────────────

  /** Returns raw artifact bytes. Caller is responsible for ZIP extraction. */
  async downloadArtifact(jobId: string): Promise<Uint8Array> {
    const bearer = await this._acquireBearer();
    const url = this._url(NCOREIQ_PATHS.JOB_ARTIFACT(jobId));
    const response = await this._fetchWithTimeout(url, {
      method: 'GET',
      headers: this._buildHeaders(bearer),
    });
    await this._assertSuccess(response, url);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  // ── Internal HTTP helpers ─────────────────────────────────────────────

  private _url(path: string, params?: Record<string, string>): string {
    const url = `${this._baseUrl}${path}`;
    if (!params || Object.keys(params).length === 0) return url;
    const qs = new URLSearchParams(params).toString();
    return `${url}?${qs}`;
  }

  /**
   * Acquire the current bearer token from the token provider (dynamic) or
   * fall back to the static bearerToken (backward compat for tests).
   * Returns undefined when neither is configured (unauthenticated/disabled mode).
   * Token value is NEVER logged.
   */
  private async _acquireBearer(): Promise<string | undefined> {
    if (this._tokenProvider) {
      const token = await this._tokenProvider.getToken();
      // Empty string from DisabledModeTokenProvider means no auth header
      return token || undefined;
    }
    return this._bearerToken;
  }

  /**
   * Returns request headers.
   * Authorization header is injected when bearer is present but is
   * NEVER logged — it is only passed to the outgoing request.
   */
  private _buildHeaders(bearer?: string, extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (bearer) {
      // Token is passed to the request but never written to any log sink.
      h['Authorization'] = `Bearer ${bearer}`;
    }
    if (extra) {
      Object.assign(h, extra);
    }
    return h;
  }

  private async _get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const bearer = await this._acquireBearer();
    const url = this._url(path, params);
    const response = await this._fetchWithTimeout(url, {
      method: 'GET',
      headers: this._buildHeaders(bearer),
    });
    await this._assertSuccess(response, url);
    return this._parseJson<T>(response, url);
  }

  private async _post<T>(
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const bearer = await this._acquireBearer();
    const url = this._url(path);
    const response = await this._fetchWithTimeout(url, {
      method: 'POST',
      headers: this._buildHeaders(bearer, extraHeaders),
      body: JSON.stringify(body),
    });
    await this._assertSuccess(response, url);
    return this._parseJson<T>(response, url);
  }

  private async _fetchWithTimeout(
    url: string,
    init: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    status: number;
    headers: { get: (name: string) => string | null };
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }> {
    // For injected fetchFn (tests), skip AbortController — mock handles timing
    if (this._fetchFn !== (globalThis.fetch as unknown as FetchLike)) {
      try {
        return await this._fetchFn(url, init);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw new NCoreIQTimeoutError(this._timeoutMs);
        const cause = err instanceof Error ? err.message : String(err);
        throw new NCoreIQUnavailableError(cause);
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    try {
      const response = await this._fetchFn(url, { ...init, signal: controller.signal });
      return response;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new NCoreIQTimeoutError(this._timeoutMs);
      }
      const cause = err instanceof Error ? err.message : String(err);
      throw new NCoreIQUnavailableError(cause);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Asserts the response is 2xx.
   * Normalises upstream error bodies without exposing stack traces or credentials.
   */
  private async _assertSuccess(
    response: {
      ok: boolean;
      status: number;
      headers: { get: (name: string) => string | null };
      text: () => Promise<string>;
    },
    _url: string,
  ): Promise<void> {
    if (response.ok) return;

    const status = response.status;
    let errorCode = 'NCOREIQ_ERROR';
    let message = `HTTP ${status}`;
    let requestId: string | undefined;
    let correlationId: string | undefined;

    requestId = response.headers.get('X-Request-ID') ?? undefined;
    correlationId = response.headers.get('X-Correlation-ID') ?? undefined;

    try {
      const text = await response.text();
      if (text) {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed.error === 'string') errorCode = parsed.error;
        if (typeof parsed.message === 'string') message = parsed.message;
        if (typeof parsed.request_id === 'string') requestId = parsed.request_id;
        if (typeof parsed.correlation_id === 'string') correlationId = parsed.correlation_id;
      }
    } catch {
      // Non-JSON response body — use defaults. Do not propagate parse error.
    }

    // Specific named codes for N-CoreShift error handling
    if (status === NCOREIQ_HTTP.UNAUTHORIZED) errorCode = 'UNAUTHORIZED';
    if (status === NCOREIQ_HTTP.FORBIDDEN) errorCode = 'FORBIDDEN';
    if (status === NCOREIQ_HTTP.NOT_FOUND) errorCode = 'NOT_FOUND';
    if (status === NCOREIQ_HTTP.SAP_UNAVAILABLE) errorCode = 'SAP_UNAVAILABLE';

    throw new NCoreIQApiError(status, errorCode, message, requestId, correlationId);
  }

  private async _parseJson<T>(
    response: { text: () => Promise<string> },
    url: string,
  ): Promise<T> {
    try {
      const text = await response.text();
      return JSON.parse(text) as T;
    } catch {
      throw new NCoreIQApiError(
        NCOREIQ_HTTP.INTERNAL,
        'MALFORMED_RESPONSE',
        `N-CoreIQ returned non-JSON response from ${url}`,
      );
    }
  }
}
