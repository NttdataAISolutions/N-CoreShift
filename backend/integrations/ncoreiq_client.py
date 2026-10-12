"""
N-CoreShift — NCoreIQClient (Python runtime)

Typed HTTP client for the N-CoreIQ External Consumer REST API v1.
All endpoint paths match the authoritative contract
(ncoreiq-consumer-contract-v1.md Section 7). No paths are invented.

Responsibilities:
  - base URL resolution (server env takes precedence over request body)
  - centralized endpoint path constants
  - httpx async HTTP calls
  - Authorization header injection (server-side only — NEVER from browser)
  - token acquisition via NCoreIQTokenProvider (XSUAA client_credentials)
  - timeout handling
  - upstream error normalization (no stack traces, no credentials exposed)

Authentication:
  token_provider (NCoreIQTokenProvider) is the preferred path.
  bearer_token (static str) is retained for backwards-compatible test fixtures only.

Architecture decision:
  Python = CURRENT runtime adapter (N-CoreIQ → Python FastAPI → SQLite)
  TypeScript NCoreIQClient = FUTURE agent/domain adapter
  Both use the same N-CoreIQ consumer contract v1 semantics.
"""

import logging
import os
from typing import Any, Dict, Optional

import httpx

from integrations.ncoreiq_token_provider import NCoreIQTokenProvider

logger = logging.getLogger(__name__)

# ── API path constants (Contract Section 7 — authoritative) ──────────────────
# Do NOT duplicate these strings in routers or providers.

_API_BASE = "/api/v1"

PING_PATH = f"{_API_BASE}/sap/ping"
PACKAGES_PATH = f"{_API_BASE}/repository/packages/{{package}}"
SEARCH_PATH = f"{_API_BASE}/repository/search"
METADATA_PATH = f"{_API_BASE}/repository/objects/{{object_type}}/{{object_name}}/metadata"
SOURCE_PATH = f"{_API_BASE}/repository/objects/{{object_type}}/{{object_name}}/source"
DEPENDENCIES_PATH = f"{_API_BASE}/repository/objects/{{object_type}}/{{object_name}}/dependencies"
JOBS_PATH = f"{_API_BASE}/repository/jobs"
JOB_PATH = f"{_API_BASE}/repository/jobs/{{job_id}}"
JOB_RESULT_PATH = f"{_API_BASE}/repository/jobs/{{job_id}}/result"
JOB_ARTIFACT_PATH = f"{_API_BASE}/repository/jobs/{{job_id}}/artifact"

# Default timeout for standard requests
_DEFAULT_TIMEOUT = 30.0
# Extended timeout for source retrieval (large objects)
_SOURCE_TIMEOUT = 60.0
# Extended timeout for extraction jobs
_JOB_TIMEOUT = 30.0


class NCoreIQError(Exception):
    """Normalized error from N-CoreIQ. Never exposes tokens or credentials."""
    def __init__(self, http_status: int, error_code: str, message: str):
        super().__init__(f"[NCoreIQ {http_status}] {error_code}: {message}")
        self.http_status = http_status
        self.error_code = error_code


class NCoreIQTimeoutError(NCoreIQError):
    def __init__(self, timeout_s: float):
        super().__init__(503, "NCOREIQ_TIMEOUT", f"N-CoreIQ request timed out after {timeout_s}s")


class NCoreIQUnavailableError(NCoreIQError):
    def __init__(self):
        super().__init__(503, "NCOREIQ_UNAVAILABLE", "N-CoreIQ is unavailable")


def resolve_base_url(request_base_url: Optional[str] = None) -> str:
    """
    Resolve N-CoreIQ base URL.
    Server-side NCOREIQ_BASE_URL always takes precedence over request body.
    Falls back to request body only when NCOREIQ_AUTH_MODE=disabled (dev/test).
    Raises ValueError if not configured in a mode that requires it.
    """
    env_url = os.getenv("NCOREIQ_BASE_URL", "").strip().rstrip("/")
    if env_url:
        return env_url

    auth_mode = os.getenv("NCOREIQ_AUTH_MODE", "disabled").lower()
    if auth_mode != "disabled":
        raise ValueError(
            "NCOREIQ_BASE_URL must be configured server-side when "
            "NCOREIQ_AUTH_MODE is not 'disabled'."
        )

    if not request_base_url or not request_base_url.strip():
        raise ValueError("NCOREIQ_BASE_URL is not configured and no baseUrl provided.")

    return request_base_url.strip().rstrip("/")


class NCoreIQClient:
    """
    Async HTTP client for N-CoreIQ REST API v1.
    Instantiated per-request (stateless — no connection pooling across requests).

    Token acquisition is handled by the injected NCoreIQTokenProvider.
    The provider caches the token across requests (process-level singleton).
    Authorization headers are NEVER exposed to callers or logged.

    Parameters:
        base_url      — N-CoreIQ backend URL (no trailing slash)
        token_provider — NCoreIQTokenProvider for XSUAA client_credentials auth
                          (preferred; used in production and test injection)
        bearer_token  — Static bearer token string (backwards-compat for tests only)
                          Ignored when token_provider is set.
    """

    def __init__(
        self,
        base_url: str,
        token_provider: Optional[NCoreIQTokenProvider] = None,
        bearer_token: Optional[str] = None,
    ):
        self._base_url = base_url.rstrip("/")
        # token_provider takes precedence over static bearer_token
        self._token_provider = token_provider
        # Static bearer token — retained for test fixture backwards-compatibility only
        self._bearer_token = bearer_token

    async def _get_bearer(self) -> Optional[str]:
        """
        Resolve the bearer token for this request.
        token_provider.get_token() takes precedence over static bearer_token.
        Returns None when auth is fully disabled (no header sent).
        Token value is NEVER logged anywhere in this method.
        """
        if self._token_provider is not None:
            token = await self._token_provider.get_token()
            # DisabledModeTokenProvider returns '' — treat as no auth
            return token if token else None
        return self._bearer_token or None

    def _build_headers(self, bearer: Optional[str]) -> Dict[str, str]:
        """Build request headers. bearer is passed in (never fetched here)."""
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if bearer:
            h["Authorization"] = f"Bearer {bearer}"
            # Token value is never written to any log
        return h

    @staticmethod
    def _normalize_error(exc: Exception) -> NCoreIQError:
        """Convert any exception to a safe NCoreIQError — no credentials exposed."""
        if isinstance(exc, httpx.TimeoutException):
            return NCoreIQTimeoutError(30.0)
        if isinstance(exc, (httpx.ConnectError, httpx.NetworkError)):
            return NCoreIQUnavailableError()
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            codes = {
                401: "UNAUTHORIZED",
                403: "FORBIDDEN",
                404: "NOT_FOUND",
                409: "CONFLICT",
                410: "GONE",
                503: "SAP_UNAVAILABLE",
            }
            code = codes.get(status, f"HTTP_{status}")
            # Attempt to extract safe message from response body
            try:
                body = exc.response.json()
                msg = body.get("message", f"HTTP {status}")
            except Exception:
                msg = f"HTTP {status}"
            return NCoreIQError(status, code, msg)
        return NCoreIQError(500, "NCOREIQ_ERROR", "N-CoreIQ operation failed")

    async def _get(self, path: str, params: Optional[Dict[str, str]] = None,
                   timeout: float = _DEFAULT_TIMEOUT) -> Any:
        url = f"{self._base_url}{path}"
        bearer = await self._get_bearer()
        headers = self._build_headers(bearer)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, headers=headers, params=params or {})
                resp.raise_for_status()
                return resp.json()
        except (NCoreIQError, NCoreIQTimeoutError, NCoreIQUnavailableError):
            raise
        except Exception as exc:
            raise self._normalize_error(exc) from None

    async def _post(self, path: str, body: Any,
                    timeout: float = _DEFAULT_TIMEOUT) -> Any:
        url = f"{self._base_url}{path}"
        bearer = await self._get_bearer()
        headers = self._build_headers(bearer)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                return resp.json()
        except (NCoreIQError, NCoreIQTimeoutError, NCoreIQUnavailableError):
            raise
        except Exception as exc:
            raise self._normalize_error(exc) from None

    # ── Section 7-A: SAP Ping ─────────────────────────────────────────────────

    async def ping(self) -> Dict[str, Any]:
        """GET /api/v1/sap/ping"""
        return await self._get(PING_PATH)

    # ── Section 7-B: Package Discovery ───────────────────────────────────────

    async def list_packages(self, package: str,
                             include_subpackages: bool = True,
                             max_depth: int = 20) -> Dict[str, Any]:
        """GET /api/v1/repository/packages/{package}"""
        path = PACKAGES_PATH.format(package=package)
        params = {
            "include_subpackages": str(include_subpackages).lower(),
            "max_depth": str(max_depth),
        }
        return await self._get(path, params=params)

    # ── Section 7-C: Repository Search ───────────────────────────────────────

    async def search_objects(self, packages: list, include_subpackages: bool = True,
                              max_results: int = 200) -> Dict[str, Any]:
        """POST /api/v1/repository/search"""
        body = {
            "packages": packages,
            "include_subpackages": include_subpackages,
            "max_results": min(max_results, 500),
        }
        return await self._post(SEARCH_PATH, body)

    # ── Section 7-D: Object Metadata ─────────────────────────────────────────

    async def get_metadata(self, object_type: str, object_name: str) -> Dict[str, Any]:
        """GET /api/v1/repository/objects/{type}/{name}/metadata"""
        path = METADATA_PATH.format(object_type=object_type, object_name=object_name)
        return await self._get(path)

    # ── Section 7-E: Object Source ────────────────────────────────────────────

    async def get_source(self, object_type: str, object_name: str) -> Dict[str, Any]:
        """
        GET /api/v1/repository/objects/{type}/{name}/source
        NO max_lines parameter — complete source retrieval (contract default).
        N-CoreIQ follows SAP pagination internally.
        """
        path = SOURCE_PATH.format(object_type=object_type, object_name=object_name)
        # No params — complete source is the default when max_lines is omitted
        return await self._get(path, timeout=_SOURCE_TIMEOUT)

    async def get_source_bounded(self, object_type: str, object_name: str,
                                  max_lines: int) -> Dict[str, Any]:
        """
        GET /api/v1/repository/objects/{type}/{name}/source?max_lines=N
        For display/preview only — NOT for analysis evidence.
        """
        path = SOURCE_PATH.format(object_type=object_type, object_name=object_name)
        return await self._get(path, params={"max_lines": str(max_lines)})

    # ── Section 7-F: Direct Dependencies ─────────────────────────────────────

    async def get_dependencies(self, object_type: str, object_name: str,
                                 max_results: int = 1000) -> Dict[str, Any]:
        """GET /api/v1/repository/objects/{type}/{name}/dependencies"""
        path = DEPENDENCIES_PATH.format(object_type=object_type, object_name=object_name)
        return await self._get(path, params={"max_results": str(max_results)})

    # ── Section 7-J: Extraction Job Creation ─────────────────────────────────

    async def create_extraction_job(self, objects: list,
                                     source_max_lines: Optional[int] = None,
                                     export_format: str = "json") -> Dict[str, Any]:
        """
        POST /api/v1/repository/jobs
        source_max_lines=None means complete source (contract default).
        Never pass 500 as a default.
        """
        body = {
            "extraction": {
                "objects": objects,
                "include_metadata": True,
                "include_source": True,
                "source_max_lines": source_max_lines,  # None = complete
                "continue_on_error": True,
            },
            "export_format": export_format,
        }
        return await self._post(JOBS_PATH, body, timeout=_JOB_TIMEOUT)

    # ── Section 7-K: Job Status ───────────────────────────────────────────────

    async def get_job_status(self, job_id: str) -> Dict[str, Any]:
        """GET /api/v1/repository/jobs/{job_id}"""
        path = JOB_PATH.format(job_id=job_id)
        return await self._get(path)

    # ── Section 7-L: Job Result ───────────────────────────────────────────────

    async def get_job_result(self, job_id: str) -> Dict[str, Any]:
        """GET /api/v1/repository/jobs/{job_id}/result"""
        path = JOB_RESULT_PATH.format(job_id=job_id)
        return await self._get(path)
