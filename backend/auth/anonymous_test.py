"""
N-CoreShift - Anonymous Test Mode (Gate 0E10-AT1A)

Provides an ISOLATED, explicitly-guarded "anonymous_test" authentication
mode for a FUTURE separate deployment:

    ncoreshift-test  ->  no browser login  ->  ncoreshift-test-python

This module does NOT alter the normal/default authenticated behavior
implemented in auth/xsuaa.py. It is loaded by XSUAAInboundMiddleware only
to determine whether anonymous_test is both requested AND safe to activate
on the current running application instance.

Activation requires ALL THREE of the following to be true simultaneously:

    1. NCORESHIFT_AUTH_MODE == "anonymous_test"
    2. NCORESHIFT_ANONYMOUS_TEST_CONFIRM == "true"
    3. Cloud Foundry application identity (VCAP_APPLICATION.application_name)
       == "ncoreshift-test-python"

If any of these three conditions is not met while anonymous_test mode was
requested (condition 1 true), this module FAILS CLOSED by raising
RuntimeError at startup. In particular, if anonymous_test settings are
present on the ncoreshift-python application (the normal production
Cloud Foundry app name), startup MUST fail - anonymous_test is only ever
permitted on ncoreshift-test-python.

If NCORESHIFT_AUTH_MODE is unset or anything other than "anonymous_test",
this module is fully inert and normal/default authenticated behavior
(auth/xsuaa.py) is completely unaffected.

Security boundaries
--------------------
  - Application identity is read ONLY from VCAP_APPLICATION (Cloud Foundry
    runtime metadata), never from a browser-supplied header.
  - AnonymousTestPrincipal is an explicit, minimal principal type. It does
    NOT carry Viewer / Analyst / Operator / Admin roles and must not
    satisfy any normal role/scope check used elsewhere in the codebase.
  - The anonymous allowlist is centralized here (ANONYMOUS_SAFE_ROUTES) -
    default-deny for every other route, including all N-CoreIQ integration
    routes and all admin routes.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import FrozenSet, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Required / forbidden application identity for anonymous_test ───────────
# anonymous_test is permitted ONLY on this exact Cloud Foundry application
# name. It must NEVER be permitted on "ncoreshift-python" (production).
REQUIRED_TEST_APP_NAME: str = "ncoreshift-test-python"

# Explicitly forbidden production app name - defense in depth. Even if some
# future refactor changes REQUIRED_TEST_APP_NAME, this name is never allowed.
FORBIDDEN_PRODUCTION_APP_NAME: str = "ncoreshift-python"

# ── Environment variable names ───────────────────────────────────────────────
ENV_AUTH_MODE: str = "NCORESHIFT_AUTH_MODE"
ENV_ANONYMOUS_CONFIRM: str = "NCORESHIFT_ANONYMOUS_TEST_CONFIRM"
ANONYMOUS_TEST_MODE_VALUE: str = "anonymous_test"
CONFIRM_TRUE_VALUE: str = "true"


# ── Anonymous principal ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class AnonymousTestPrincipal:
    """
    Explicit, minimal principal type attached to request.state.identity when
    a request is served under anonymous_test mode.

    This type intentionally does NOT implement check_scope(), has_role(), or
    any attribute resembling the sap-xssec SecurityContext API, so it cannot
    accidentally satisfy a normal role/scope guard elsewhere in the codebase.

    roles is always an empty frozenset - Viewer / Analyst / Operator / Admin
    are never granted automatically.
    """

    authenticated: bool = False
    anonymous: bool = True
    mode: str = ANONYMOUS_TEST_MODE_VALUE
    roles: FrozenSet[str] = field(default_factory=frozenset)

    def as_safe_dict(self) -> dict:
        """Safe dict representation for request.state.identity / logging."""
        return {
            "authenticated": self.authenticated,
            "anonymous": self.anonymous,
            "mode": self.mode,
            "roles": sorted(self.roles),
        }


# ── Centralized anonymous allowlist (Step 6 / Step 3) ────────────────────────
# Default is BLOCKED. Only routes explicitly listed here are reachable under
# anonymous_test. Entries are (METHOD, EXACT_PATH) tuples.
#
# Per the gate's conservative requirement, anonymous_test may only reach:
#   - frontend/static UI (handled by the TEST AppRouter config, not here)
#   - GET /api/health
#   - safe UI bootstrap/configuration endpoints necessary to render the UI
#
# No N-CoreIQ, extraction, artifact, admin, or SAP-adjacent route is ever
# listed here.
ANONYMOUS_SAFE_ROUTES: FrozenSet[Tuple[str, str]] = frozenset(
    {
        ("GET", "/api/health"),
        # Safe UI bootstrap endpoint (backend/main.py) — exposes ONLY the
        # boolean anonymousTestMode flag so the frontend can render the
        # "TEST MODE — Anonymous Access" banner. Never exposes credentials,
        # VCAP, XSUAA, N-CoreIQ tokens, or destination details.
        ("GET", "/api/config/bootstrap"),
    }
)

# Route prefixes that must ALWAYS be denied under anonymous_test, regardless
# of any future accidental addition to ANONYMOUS_SAFE_ROUTES. Defense in
# depth: these are checked before the allowlist and take absolute priority.
ALWAYS_BLOCKED_PREFIXES: Tuple[str, ...] = (
    "/api/ncoreiq",   # all N-CoreIQ integration routes (search, import, status, etc.)
    "/api/admin",      # admin CRUD
    "/api/ai-admin",   # AI provider admin / audit
)

ANONYMOUS_DENY_MESSAGE: str = "Operation disabled in anonymous test mode."


def is_anonymous_safe(method: str, path: str) -> bool:
    """
    Centralized policy decision for anonymous_test mode.

    Returns True only if the given (method, path) is explicitly allowlisted
    AND does not fall under an always-blocked prefix. Default is deny.
    """
    method = (method or "").upper()

    for blocked_prefix in ALWAYS_BLOCKED_PREFIXES:
        if path.startswith(blocked_prefix):
            return False

    return (method, path) in ANONYMOUS_SAFE_ROUTES


# ── Application identity resolution (Step 4) ─────────────────────────────────

def _resolve_cf_application_name() -> Optional[str]:
    """
    Resolve the Cloud Foundry application name from VCAP_APPLICATION.

    This is the ONLY source of application identity trusted by this module.
    A browser-supplied header is never consulted.

    Returns None if VCAP_APPLICATION is absent, empty, malformed, or does
    not contain an application_name field.
    """
    raw = os.environ.get("VCAP_APPLICATION", "")
    if not raw.strip():
        return None

    try:
        parsed: dict = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.error(
            "[AnonymousTestMode] VCAP_APPLICATION present but could not be parsed"
        )
        return None

    name = parsed.get("application_name") or parsed.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return None


# ── Auth mode resolution result ──────────────────────────────────────────────

@dataclass(frozen=True)
class AuthModeDecision:
    """Result of resolving the effective authentication mode at startup."""

    anonymous_test_active: bool
    application_name: Optional[str]


def resolve_auth_mode() -> AuthModeDecision:
    """
    Resolve the effective authentication mode for this running instance.

    Behavior:
      - NCORESHIFT_AUTH_MODE unset / not "anonymous_test"
            -> anonymous_test_active = False (normal/default authenticated
               mode is used; this function has no further effect).

      - NCORESHIFT_AUTH_MODE == "anonymous_test":
            ALL of the following must hold, or this function raises
            RuntimeError (fail closed):
              - NCORESHIFT_ANONYMOUS_TEST_CONFIRM == "true"
              - VCAP_APPLICATION.application_name == "ncoreshift-test-python"
            Additionally, if application_name == "ncoreshift-python"
            (production), this ALWAYS raises RuntimeError regardless of the
            other two settings - defense in depth against misconfiguration
            of the production descriptor.

    Returns AuthModeDecision(anonymous_test_active=True, ...) only when all
    three Step 4 requirements are satisfied.
    """
    requested_mode = os.environ.get(ENV_AUTH_MODE, "").strip().lower()

    if requested_mode != ANONYMOUS_TEST_MODE_VALUE:
        # Normal/default authenticated mode - this module has no effect.
        return AuthModeDecision(anonymous_test_active=False, application_name=None)

    application_name = _resolve_cf_application_name()

    # Defense in depth: anonymous_test must NEVER activate on the production
    # application name, no matter what else is configured.
    if application_name == FORBIDDEN_PRODUCTION_APP_NAME:
        raise RuntimeError(
            "[AnonymousTestMode] Startup check failed: "
            f"{ENV_AUTH_MODE}={ANONYMOUS_TEST_MODE_VALUE} is configured on "
            f"'{FORBIDDEN_PRODUCTION_APP_NAME}'. anonymous_test is permitted "
            f"only for '{REQUIRED_TEST_APP_NAME}'. Failing closed."
        )

    confirm_value = os.environ.get(ENV_ANONYMOUS_CONFIRM, "").strip().lower()
    if confirm_value != CONFIRM_TRUE_VALUE:
        raise RuntimeError(
            "[AnonymousTestMode] Startup check failed: "
            f"{ENV_AUTH_MODE}={ANONYMOUS_TEST_MODE_VALUE} requires "
            f"{ENV_ANONYMOUS_CONFIRM}=true to be explicitly set. Failing closed."
        )

    if application_name != REQUIRED_TEST_APP_NAME:
        raise RuntimeError(
            "[AnonymousTestMode] Startup check failed: "
            f"{ENV_AUTH_MODE}={ANONYMOUS_TEST_MODE_VALUE} and "
            f"{ENV_ANONYMOUS_CONFIRM}=true are set, but the Cloud Foundry "
            f"application identity (VCAP_APPLICATION.application_name) is "
            f"'{application_name}', not '{REQUIRED_TEST_APP_NAME}'. "
            "anonymous_test is permitted only for "
            f"'{REQUIRED_TEST_APP_NAME}'. Failing closed."
        )

    logger.warning(
        "[AnonymousTestMode] ANONYMOUS TEST MODE ACTIVE on application "
        f"'{application_name}'. Normal authentication is DISABLED for "
        "allowlisted routes only; all other routes remain blocked "
        "(403). This mode must never run on the production application."
    )

    return AuthModeDecision(anonymous_test_active=True, application_name=application_name)
