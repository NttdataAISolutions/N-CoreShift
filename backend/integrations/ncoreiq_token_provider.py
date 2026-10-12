"""
N-CoreShift — NCoreIQTokenProvider (Python runtime)

Server-side XSUAA client_credentials token provider for machine-to-machine
authentication between N-CoreShift and N-CoreIQ.

Responsibilities:
  - Resolve XSUAA credentials from BTP service bindings (VCAP_SERVICES)
    or NCS_XSUAA_* environment variable fallbacks
  - Acquire access token via OAuth2 client_credentials grant
  - Cache and reuse tokens safely until close to expiry (30s safety margin)
  - Refresh before expiration
  - Prevent duplicate simultaneous refresh with asyncio.Lock
  - Never expose token to browser / React layer
  - Never persist token to disk or database
  - Never log token value
  - Normalize OAuth failures safely without leaking credentials
  - Fail CLOSED in production if binding is missing or credentials invalid

Token flow:
    N-CoreShift XSUAA binding (VCAP_SERVICES / ncoreshift-uaa)
        | POST /oauth/token  grant_type=client_credentials
        | Authorization: Basic base64(clientId:clientSecret)
        v
      XSUAA token endpoint
        | JWT with NCoreIQ authority scopes
        v
    NCoreIQTokenProvider (server-side cache)
        | Authorization: Bearer <JWT>
        v
    NCoreIQClient → N-CoreIQ REST API

SECURITY:
  - clientSecret is NEVER logged (not even as [REDACTED])
  - Token value is NEVER logged or included in thrown Error messages
  - Token is NEVER forwarded to the browser / React
  - Production mode (NCOREIQ_AUTH_MODE=xsuaa) FAILS CLOSED if:
      · VCAP_SERVICES xsuaa binding is absent AND NCS_XSUAA_* vars are absent
      · clientId or clientSecret is empty
      · tokenUrl cannot be resolved
      · Token endpoint returns non-200
      · Token endpoint is unreachable or times out
  - disabled mode is ONLY permitted when NODE_ENV / PYTHON_ENV is not production

Python runtime equivalence:
  This file is the Python semantic equivalent of:
    agent/src/ncoreiq/NCoreIQTokenProvider.ts
  Both implement the same contract. Preserve semantic parity on changes.
"""

import asyncio
import base64
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from typing import Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Safety margin before true token expiry (seconds). Renew this many seconds early.
_EXPIRY_SAFETY_S: float = 30.0

# Default token lifetime if XSUAA response is missing expires_in (12 hours).
_DEFAULT_EXPIRES_IN_S: int = 43_200

# Timeout for the token endpoint HTTP call (seconds).
_TOKEN_FETCH_TIMEOUT_S: float = 15.0


# ── Exception ─────────────────────────────────────────────────────────────────

class NCoreIQTokenAcquisitionError(Exception):
    """
    Raised when token acquisition fails.
    The message NEVER includes the token, clientSecret, or raw HTTP response body.

    reason values:
      BINDING_MISSING       — VCAP_SERVICES absent or incomplete in xsuaa mode
      CREDENTIALS_MISSING   — clientId or clientSecret is empty
      TOKEN_ENDPOINT_UNAVAILABLE — network unreachable
      TOKEN_ENDPOINT_ERROR  — endpoint returned non-2xx
      TOKEN_ENDPOINT_TIMEOUT — endpoint timed out
      UNEXPECTED            — unclassified failure
    """

    BINDING_MISSING = "BINDING_MISSING"
    CREDENTIALS_MISSING = "CREDENTIALS_MISSING"
    TOKEN_ENDPOINT_UNAVAILABLE = "TOKEN_ENDPOINT_UNAVAILABLE"
    TOKEN_ENDPOINT_ERROR = "TOKEN_ENDPOINT_ERROR"
    TOKEN_ENDPOINT_TIMEOUT = "TOKEN_ENDPOINT_TIMEOUT"
    UNEXPECTED = "UNEXPECTED"

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(
            f"[NCoreIQTokenProvider] Token acquisition failed ({reason}): {detail}"
        )
        self.reason = reason


# ── Abstract base ─────────────────────────────────────────────────────────────

class NCoreIQTokenProvider(ABC):
    """
    Abstract provider for XSUAA access tokens used by N-CoreIQ backend calls.
    Implementations must cache tokens and never log their values.
    """

    @abstractmethod
    async def get_token(self) -> str:
        """
        Returns a valid access token string.
        Callers attach it as: Authorization: Bearer <token>
        Implementations may cache and refresh as needed.
        Returns '' when auth is disabled (client omits Authorization header).
        Raises NCoreIQTokenAcquisitionError on failure.
        """
        ...


# ── Production implementation ─────────────────────────────────────────────────

class XSUAAClientCredentialsTokenProvider(NCoreIQTokenProvider):
    """
    Production token provider.

    Uses OAuth2 client_credentials grant against the XSUAA token endpoint.
    Token is cached until (expires_in - EXPIRY_SAFETY_S).

    Thread-safety: asyncio.Lock prevents duplicate simultaneous refresh
    within a single asyncio event loop (equivalent to TypeScript single-threaded
    event loop safety guarantee).

    Usage:
        provider = XSUAAClientCredentialsTokenProvider(
            client_id=..., client_secret=..., token_url=...
        )
        token = await provider.get_token()
        # → attach as Authorization: Bearer <token>
    """

    def __init__(self, client_id: str, client_secret: str, token_url: str) -> None:
        if not client_id or not client_id.strip():
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.CREDENTIALS_MISSING,
                "clientId is empty",
            )
        if not client_secret or not client_secret.strip():
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.CREDENTIALS_MISSING,
                "clientSecret is empty",
            )
        if not token_url or not token_url.strip():
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.BINDING_MISSING,
                "tokenUrl is empty",
            )

        self._client_id: str = client_id
        # clientSecret held as opaque credential — NEVER logged
        self._client_secret: str = client_secret
        self._token_url: str = token_url

        # Cache: access_token string (or None) + monotonic valid-until timestamp
        self._cached_token: Optional[str] = None
        self._valid_until: float = 0.0

        # asyncio lock prevents simultaneous refresh
        self._lock: asyncio.Lock = asyncio.Lock()

    def _is_cache_valid(self) -> bool:
        return (
            self._cached_token is not None
            and time.monotonic() < self._valid_until
        )

    async def get_token(self) -> str:
        """
        Returns a valid access token. Reuses cached token if still valid.
        Acquires lock before refresh to prevent simultaneous requests.
        """
        # Fast path — no lock needed when cache is valid
        if self._is_cache_valid():
            return self._cached_token  # type: ignore[return-value]

        # Slow path — acquire lock, double-check, then refresh
        async with self._lock:
            if self._is_cache_valid():
                return self._cached_token  # type: ignore[return-value]
            return await self._acquire_token()

    async def _acquire_token(self) -> str:
        """Perform the actual token endpoint POST. Must be called under _lock."""
        # Basic auth — credentials encoded but NEVER logged
        credentials = base64.b64encode(
            f"{self._client_id}:{self._client_secret}".encode("utf-8")
        ).decode("ascii")

        try:
            async with httpx.AsyncClient(timeout=_TOKEN_FETCH_TIMEOUT_S) as client:
                resp = await client.post(
                    self._token_url,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        # Authorization header contains credentials — NEVER logged
                        "Authorization": f"Basic {credentials}",
                    },
                    content="grant_type=client_credentials",
                )
        except httpx.TimeoutException:
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_TIMEOUT,
                f"Token endpoint did not respond within {_TOKEN_FETCH_TIMEOUT_S}s",
            )
        except (httpx.ConnectError, httpx.NetworkError, httpx.RemoteProtocolError):
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_UNAVAILABLE,
                "Token endpoint is unreachable",
            )
        except Exception:
            # Do not re-raise raw exception — may contain URL fragments
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_UNAVAILABLE,
                "Token endpoint is unreachable",
            )

        if not (200 <= resp.status_code < 300):
            # Do NOT include response body — may contain credential hints
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_ERROR,
                f"Token endpoint returned HTTP {resp.status_code}",
            )

        try:
            body: dict = resp.json()
        except Exception:
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_ERROR,
                "Token endpoint returned non-JSON response",
            )

        access_token = body.get("access_token", "")
        if not isinstance(access_token, str) or not access_token:
            raise NCoreIQTokenAcquisitionError(
                NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_ERROR,
                "Token response missing access_token field",
            )

        expires_in = body.get("expires_in", _DEFAULT_EXPIRES_IN_S)
        if not isinstance(expires_in, (int, float)) or expires_in <= 0:
            expires_in = _DEFAULT_EXPIRES_IN_S

        # Cache token — NEVER log the access_token value
        self._cached_token = access_token
        self._valid_until = time.monotonic() + float(expires_in) - _EXPIRY_SAFETY_S

        # Log acquisition success only — token value is NOT logged
        logger.info("[NCoreIQTokenProvider] Token acquired successfully (expires_in=%ss)", expires_in)
        return access_token

    def invalidate_cache(self) -> None:
        """
        Invalidate the cached token — forces re-acquisition on next get_token().
        Use for forced refresh or after receiving 401 from N-CoreIQ.
        """
        self._cached_token = None
        self._valid_until = 0.0

    def has_cached_token(self) -> bool:
        """
        Returns True if a valid cached token exists (for testing/introspection).
        Does NOT return the token value.
        """
        return self._is_cache_valid()


# ── Disabled mode (local development only) ────────────────────────────────────

class DisabledModeTokenProvider(NCoreIQTokenProvider):
    """
    Token provider for NCOREIQ_AUTH_MODE=disabled (local development only).

    Returns empty string — NCoreIQClient omits Authorization header when token is empty.

    MUST NOT be used in production (NCOREIQ_AUTH_MODE=xsuaa).
    Production guard is enforced in create_ncoreiq_token_provider().
    """

    async def get_token(self) -> str:
        # Returns '' — client will not send Authorization header.
        # Production guard is enforced at factory / startup level.
        return ""


# ── VCAP_SERVICES binding resolution ─────────────────────────────────────────

def _resolve_xsuaa_binding(is_production: bool = False) -> Optional[Tuple[str, str, str]]:
    """
    Resolve XSUAA credentials for the token provider.

    Resolution order:
      1. VCAP_SERVICES["xsuaa"][0].credentials (BTP runtime binding — preferred,
         and the ONLY source permitted when is_production=True)
      2. NCS_XSUAA_CLIENT_ID + NCS_XSUAA_CLIENT_SECRET + NCS_XSUAA_URL (env override —
         local development and CI only; unavailable when is_production=True)

    is_production:
        True  — only VCAP_SERVICES is accepted. NCS_XSUAA_* env var fallback is
                 blocked to prevent manually injected credentials from becoming a
                 production dependency. If VCAP_SERVICES is absent or incomplete,
                 returns None (caller will raise BINDING_MISSING).
        False — VCAP_SERVICES tried first, then NCS_XSUAA_* fallback (local dev / CI).

    Returns (client_id, client_secret, xsuaa_url) or None if not available.

    The returned xsuaa_url is the base URL; callers append '/oauth/token'.

    Service key values are NOT used at runtime. A service key may be used only
    for manual certification/verification outside the running application.
    """
    # 1. VCAP_SERVICES (BTP Cloud Foundry runtime binding — authoritative)
    vcap_raw = os.environ.get("VCAP_SERVICES", "")
    if vcap_raw.strip():
        try:
            vcap = json.loads(vcap_raw)
            xsuaa_entries = vcap.get("xsuaa", [])
            if xsuaa_entries and isinstance(xsuaa_entries, list):
                creds = xsuaa_entries[0].get("credentials", {})
                client_id = creds.get("clientid", "").strip()
                client_secret = creds.get("clientsecret", "").strip()
                url = creds.get("url", "").strip().rstrip("/")
                if client_id and client_secret and url:
                    return client_id, client_secret, url
        except (json.JSONDecodeError, KeyError, IndexError, TypeError):
            # Malformed VCAP_SERVICES — fall through only if not production
            logger.warning("[NCoreIQTokenProvider] VCAP_SERVICES present but failed to parse xsuaa binding")

    # 2. NCS_XSUAA_* env var fallback — BLOCKED in production.
    #    BTP production runtime must have a proper VCAP_SERVICES xsuaa binding.
    #    Do not make manually injected client-secret env vars a production dependency.
    if is_production:
        logger.warning(
            "[NCoreIQTokenProvider] Production mode: NCS_XSUAA_* env var fallback is disabled. "
            "Ensure the ncoreshift-uaa XSUAA service is bound and VCAP_SERVICES is populated."
        )
        return None

    client_id = os.environ.get("NCS_XSUAA_CLIENT_ID", "").strip()
    client_secret = os.environ.get("NCS_XSUAA_CLIENT_SECRET", "").strip()
    url = os.environ.get("NCS_XSUAA_URL", "").strip().rstrip("/")
    if client_id and client_secret and url:
        return client_id, client_secret, url

    return None


# ── Factory function ──────────────────────────────────────────────────────────

def create_ncoreiq_token_provider(
    auth_mode: Optional[str] = None,
    is_production: Optional[bool] = None,
) -> NCoreIQTokenProvider:
    """
    Create an NCoreIQTokenProvider from the N-CoreShift XSUAA service binding.

    auth_mode:
        'xsuaa'    — production M2M auth (requires XSUAA binding)
        'disabled' — local/dev only (no auth header sent)
        None       — read from NCOREIQ_AUTH_MODE env var (default: 'disabled')

    is_production:
        True  — fail closed if binding is missing or mode is 'disabled'
        False — allow 'disabled' mode
        None  — infer from PYTHON_ENV or APP_ENV env vars (production if 'production')

    Raises:
        NCoreIQTokenAcquisitionError(BINDING_MISSING)  — xsuaa mode, no binding
        NCoreIQTokenAcquisitionError(BINDING_MISSING)  — disabled mode in production
        NCoreIQTokenAcquisitionError(CREDENTIALS_MISSING) — empty clientId/clientSecret
    """
    if auth_mode is None:
        auth_mode = os.environ.get("NCOREIQ_AUTH_MODE", "disabled").lower().strip()

    if is_production is None:
        env = (
            os.environ.get("PYTHON_ENV", "")
            or os.environ.get("APP_ENV", "")
            or os.environ.get("NODE_ENV", "")
        ).lower().strip()
        is_production = env == "production"

    # Production MUST NOT downgrade to disabled
    if is_production and auth_mode == "disabled":
        raise NCoreIQTokenAcquisitionError(
            NCoreIQTokenAcquisitionError.BINDING_MISSING,
            "NCOREIQ_AUTH_MODE=disabled is not permitted in production. "
            "Set NCOREIQ_AUTH_MODE=xsuaa and provide a valid XSUAA service binding.",
        )

    if auth_mode == "disabled":
        return DisabledModeTokenProvider()

    # xsuaa mode — requires XSUAA binding.
    # Pass is_production so that in production only VCAP_SERVICES is accepted.
    binding = _resolve_xsuaa_binding(is_production=is_production)
    if binding is None:
        raise NCoreIQTokenAcquisitionError(
            NCoreIQTokenAcquisitionError.BINDING_MISSING,
            "NCOREIQ_AUTH_MODE=xsuaa but no XSUAA service binding was found. "
            "Ensure the ncoreshift-uaa service is bound and VCAP_SERVICES is populated, "
            "or set NCS_XSUAA_CLIENT_ID / NCS_XSUAA_CLIENT_SECRET / NCS_XSUAA_URL env vars.",
        )

    client_id, client_secret, xsuaa_url = binding
    token_url = xsuaa_url.rstrip("/") + "/oauth/token"

    return XSUAAClientCredentialsTokenProvider(
        client_id=client_id,
        client_secret=client_secret,
        token_url=token_url,
    )


# ── Process-level singleton ───────────────────────────────────────────────────

_singleton_provider: Optional[NCoreIQTokenProvider] = None
_singleton_lock = asyncio.Lock()


def get_ncoreiq_token_provider() -> NCoreIQTokenProvider:
    """
    Return the process-level token provider singleton.

    Called at request time by the router / client factory.
    The singleton is created lazily on first call.
    Using a process-level singleton ensures the token cache persists
    across requests within a single worker process.

    Raises NCoreIQTokenAcquisitionError if the binding is invalid in xsuaa mode.
    """
    global _singleton_provider
    if _singleton_provider is None:
        _singleton_provider = create_ncoreiq_token_provider()
    return _singleton_provider


def reset_ncoreiq_token_provider_singleton() -> None:
    """
    Reset the process-level singleton.
    For testing only — allows test isolation between test cases.
    """
    global _singleton_provider
    _singleton_provider = None
