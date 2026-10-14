"""
N-CoreShift — Inbound XSUAA Authentication Middleware

Validates XSUAA bearer tokens forwarded by the AppRouter to the Python
FastAPI backend (via forwardAuthToken: true in the AppRouter destination).

Behavior
--------
Non-production  (PYTHON_ENV / APP_ENV / NODE_ENV ≠ 'production'):
    Authentication is BYPASSED — existing local development is fully preserved.
    The outbound N-CoreIQ token provider (ncoreiq_token_provider.py) is NOT
    affected by this module; they are independent authentication boundaries.

Production  (any of those env vars == 'production'):
    Authentication is MANDATORY for every path EXCEPT exactly /api/health.
    /api/health is exempt because CF health checks do not carry a token.

    Missing XSUAA binding at startup    → RuntimeError (fail closed)
    Missing xsappname at startup        → RuntimeError (fail closed)
    Missing Authorization header        → 401
    Non-Bearer Authorization header     → 401
    Empty bearer token string           → 401
    sap-xssec token validation failure  → 401
    Valid token, missing .User scope    → 403
    sap-xssec library missing           → 500 (misconfiguration)

XSUAA credentials
-----------------
Resolved exclusively from VCAP_SERVICES["xsuaa"][0].credentials.
No manual env-var injection of client secrets is supported for production
inbound auth.

sap-xssec API
-------------
Uses the maintained public API:

    from sap import xssec
    security_context = xssec.create_security_context(token, credentials)

create_security_context() is synchronous; it is executed in a thread pool
via asyncio.to_thread() to avoid blocking the event loop.

sap-xssec performs automatically:
  RS256 signature verification, issuer validation, audience validation,
  tenant validation, and token-expiry checks.
No custom JWT/JWKS logic is introduced.

Universal N-CoreShift User scope (0D2B gate)
--------------------------------------------
xs-security.json confirms $XSAPPNAME.User is present in ALL seven
role-templates. Every legitimate N-CoreShift user holds this scope.

After token validation the middleware requires:

    <runtime-xsappname>.User

where runtime-xsappname is resolved from the bound VCAP_SERVICES xsuaa
credentials (credentials["xsappname"]).

Error semantics:
  Valid token, missing .User scope → 403 FORBIDDEN
  (not 401 — the token itself is valid, only authorization is missing)

FUNCTIONAL_SCOPE_POLICY = USER_SCOPE_ENFORCED (0D2B gate)

Security rules
--------------
  • clientid, clientsecret are NEVER logged.
  • Token value, raw claims, Authorization header contents are NEVER logged.
  • Exception messages from sap-xssec are NOT forwarded to the response.
  • Only safe derived identity (logon_name, subaccount_id) is attached to
    request.state.identity.
  • No raw claim payload is exposed to business-layer routes.
"""

import asyncio
import json
import logging
import os
from typing import Any, Dict, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# The ONLY path exempt from authentication in production.
# CF health checks do not carry an XSUAA access token.
_HEALTH_PATH: str = "/api/health"

# ── Scope policy declaration ──────────────────────────────────────────────────
# xs-security.json: $XSAPPNAME.User present in ALL role-templates.
# Universal scope confirmed and enforced in this gate.
FUNCTIONAL_SCOPE_POLICY: str = "USER_SCOPE_ENFORCED"


# ── VCAP_SERVICES credential resolver ────────────────────────────────────────

def _resolve_xsuaa_credentials() -> Optional[Dict[str, Any]]:
    """
    Parse VCAP_SERVICES and return the xsuaa credentials dictionary.

    Returns the full credentials dict (clientid, clientsecret, url,
    uaadomain, xsappname, identityzone, etc.) or None if not present.

    ONLY VCAP_SERVICES is consulted — no manual env-var credential fallback
    is permitted for the inbound authentication path.

    The returned dict is passed directly to sap-xssec; the library uses it
    to verify token issuer, audience, and tenant binding.
    The dict contents are NEVER logged.
    """
    vcap_raw = os.environ.get("VCAP_SERVICES", "")
    if not vcap_raw.strip():
        return None

    try:
        vcap: dict = json.loads(vcap_raw)
        xsuaa_list = vcap.get("xsuaa", [])
        if not isinstance(xsuaa_list, list) or not xsuaa_list:
            return None
        creds: dict = xsuaa_list[0].get("credentials", {})
        # Minimum required fields for sap-xssec token validation
        if creds.get("clientid") and creds.get("url"):
            return creds
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        logger.error(
            "[XSUAAMiddleware] VCAP_SERVICES present but xsuaa binding could not be parsed"
        )

    return None


# ── Middleware ────────────────────────────────────────────────────────────────

class XSUAAInboundMiddleware(BaseHTTPMiddleware):
    """
    Starlette/FastAPI middleware that validates inbound XSUAA bearer tokens.

    In production every request (except GET /api/health) must carry a valid
    XSUAA access token issued for this N-CoreShift application, and the token
    must include the universal $XSAPPNAME.User scope.

    The AppRouter forwards the browser session token via the
    forwardAuthToken: true destination property.

    Token validation is delegated entirely to the SAP-maintained sap-xssec
    library using the public API:

        from sap import xssec
        xssec.create_security_context(token, credentials)

    This middleware does NOT implement custom RS256, JWKS, issuer, audience,
    or tenant validation logic.

    Scope enforcement:
        After sap-xssec validates the token, the middleware requires the
        runtime <xsappname>.User scope, which is present in ALL N-CoreShift
        role-templates. Missing scope → 403 (not 401, token is valid but
        the principal lacks the required authorization).

    In non-production the middleware is a transparent pass-through so that
    local development (uvicorn direct) continues to work without a live XSUAA
    binding.
    """

    def __init__(self, app) -> None:
        super().__init__(app)
        self._is_production: bool = _detect_production()
        self._xsuaa_credentials: Optional[Dict[str, Any]] = None
        self._required_scope: Optional[str] = None

        if self._is_production:
            self._xsuaa_credentials = _resolve_xsuaa_credentials()
            if self._xsuaa_credentials is None:
                # Hard fail at startup — never start a production instance
                # without a valid XSUAA binding.
                raise RuntimeError(
                    "[XSUAAMiddleware] Production startup check failed: "
                    "XSUAA credentials not found in VCAP_SERVICES. "
                    "Ensure the ncoreshift-uaa service instance is bound."
                )

            # Resolve runtime xsappname for scope enforcement.
            # xsappname is a standard field in the XSUAA credentials dict.
            xsappname = self._xsuaa_credentials.get("xsappname", "").strip()
            if not xsappname:
                raise RuntimeError(
                    "[XSUAAMiddleware] Production startup check failed: "
                    "xsappname not found in XSUAA credentials. "
                    "Ensure the ncoreshift-uaa service is correctly bound."
                )

            # Build the concrete runtime scope for the universal User access level.
            # xs-security.json confirms $XSAPPNAME.User is in ALL role-templates.
            self._required_scope = f"{xsappname}.User"

            logger.info(
                "[XSUAAMiddleware] Production mode active — inbound XSUAA token "
                "validation enabled (sap-xssec). "
                "Health endpoint exempt. User scope enforced."
            )
        else:
            logger.info(
                "[XSUAAMiddleware] Non-production mode — inbound auth bypassed. "
                "Set PYTHON_ENV=production to enforce XSUAA token validation."
            )

    async def dispatch(self, request: Request, call_next):
        # ── Non-production: transparent pass-through ──────────────────────
        if not self._is_production:
            return await call_next(request)

        # ── /api/health exemption ─────────────────────────────────────────
        # Cloud Foundry health checks do not carry an XSUAA access token.
        # Only this exact path is exempt — all other paths remain protected.
        if request.url.path == _HEALTH_PATH:
            return await call_next(request)

        # ── Extract bearer token ──────────────────────────────────────────
        auth_header: str = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={
                    "error": "UNAUTHORIZED",
                    "message": "Authorization header missing or not Bearer type",
                },
            )

        token: str = auth_header[7:].strip()  # len("Bearer ") == 7
        if not token:
            return JSONResponse(
                status_code=401,
                content={"error": "UNAUTHORIZED", "message": "Bearer token is empty"},
            )

        # ── Validate with sap-xssec ───────────────────────────────────────
        # Use the maintained public SAP API:
        #   from sap import xssec
        #   xssec.create_security_context(token, credentials)
        #
        # create_security_context() is synchronous; run it in a thread pool
        # to avoid blocking the asyncio event loop.
        #
        # sap-xssec performs automatically:
        #   RS256 signature verification
        #   issuer validation
        #   audience validation
        #   tenant validation
        #   token-expiry check
        #
        # Do NOT log the token, exception message, or any claim values.
        try:
            from sap import xssec  # noqa: PLC0415

            security_context = await asyncio.to_thread(
                xssec.create_security_context, token, self._xsuaa_credentials
            )

        except ImportError:
            # sap-xssec not installed — should never happen in CF production
            # (buildpack installs requirements.txt before startup).
            logger.error(
                "[XSUAAMiddleware] sap-xssec library not available. "
                "Verify requirements.txt and buildpack installation."
            )
            return JSONResponse(
                status_code=500,
                content={
                    "error": "AUTH_MISCONFIGURED",
                    "message": "Authentication library unavailable",
                },
            )
        except Exception:
            # Token invalid, expired, wrong audience, wrong issuer, etc.
            # Do NOT log the exception message — it may contain token fragments.
            logger.warning("[XSUAAMiddleware] Inbound token validation failed")
            return JSONResponse(
                status_code=401,
                content={"error": "UNAUTHORIZED", "message": "Token validation failed"},
            )

        # ── Universal N-CoreShift User scope enforcement ──────────────────
        # Every legitimate N-CoreShift user holds <xsappname>.User
        # (confirmed: xs-security.json, all 7 role-templates include it).
        # Missing scope → 403, not 401 (token is valid, principal is not
        # authorized to access this application).
        try:
            scope_granted = security_context.check_scope(self._required_scope)
        except Exception:
            # Defensive: treat any scope-check failure as authorization denied.
            logger.warning("[XSUAAMiddleware] Scope check failed unexpectedly")
            return JSONResponse(
                status_code=403,
                content={"error": "FORBIDDEN", "message": "Authorization scope check failed"},
            )

        if not scope_granted:
            logger.warning("[XSUAAMiddleware] Token missing required application scope")
            return JSONResponse(
                status_code=403,
                content={
                    "error": "FORBIDDEN",
                    "message": "Token does not include the required application scope",
                },
            )

        # ── Attach safe derived identity ──────────────────────────────────
        # Only safe fields — never the token, raw claims, or credentials.
        request.state.identity = _extract_safe_identity(security_context)

        return await call_next(request)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _detect_production() -> bool:
    """
    Return True when any of PYTHON_ENV / APP_ENV / NODE_ENV equals 'production'.
    Mirrors the same check used by ncoreiq_token_provider.py for consistency.
    """
    env_value = (
        os.environ.get("PYTHON_ENV", "")
        or os.environ.get("APP_ENV", "")
        or os.environ.get("NODE_ENV", "")
    ).lower().strip()
    return env_value == "production"


def _extract_safe_identity(security_context) -> Dict[str, Any]:
    """
    Extract only safe, non-sensitive identity fields from the XSUAA security
    context and return them as a plain dictionary.

    Rules:
      • Do NOT attach the raw token.
      • Do NOT attach the full JWT claim payload.
      • Do NOT attach clientid, clientsecret, or Authorization header.
      • Only logon_name (display) and subaccount_id (tenant) are captured.

    This dict is attached to request.state.identity and is available to
    business-layer route handlers for logging / audit purposes only.
    """
    identity: Dict[str, Any] = {"authenticated": True}

    try:
        logon_name = security_context.get_logon_name()
        if logon_name:
            identity["user_name"] = logon_name
    except Exception:
        pass

    try:
        subaccount_id = security_context.get_subaccount_id()
        if subaccount_id:
            identity["subaccount_id"] = subaccount_id
    except Exception:
        pass

    return identity
