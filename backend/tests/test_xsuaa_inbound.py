"""
N-CoreShift — Focused Inbound XSUAA Authentication Tests (Gate C / 0D2C)

Tests A–H: inbound XSUAA middleware behavior for the N-CoreShift FastAPI backend.

Uses a minimal FastAPI test application around XSUAAInboundMiddleware so that
no database.py, SQLite state, or full application context is required.

All XSUAA operations are mocked — no real XSUAA, no live token, no real credentials.
Test binding metadata is clearly fake and non-secret.

Scenarios:
A. Local development bypass (non-production, no Authorization header) → 200
B. Missing token in production (no Authorization header) → 401
C. Malformed Bearer token (non-Bearer Authorization header) → 401
D. Invalid / expired token (sap-xssec raises exception) → 401
E. Valid token without universal User scope → 403
F. Valid token with universal User scope → 200
G. Health endpoint exemption in production (no Authorization header) → 200
H. Missing XSUAA binding in production → fail closed (RuntimeError at startup)
"""

import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from starlette.requests import Request
from starlette.testclient import TestClient

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auth.xsuaa import XSUAAInboundMiddleware  # noqa: E402

# ── Test constants ─────────────────────────────────────────────────────────────
# Completely fake / non-secret test fixture binding.
# These are NOT real credentials and cannot authenticate against any service.

_FAKE_XSAPPNAME = "ncoreshift-test-fixture!t0000"

FAKE_VCAP_SERVICES = json.dumps({
    "xsuaa": [
        {
            "credentials": {
                "clientid": "sb-ncoreshift-test-fixture!t0000",
                "clientsecret": "test-fixture-not-a-real-secret-0000",
                "url": "https://test-fixture.authentication.us10.hana.ondemand.com",
                "xsappname": _FAKE_XSAPPNAME,
                "identityzone": "test-fixture-zone",
                "uaadomain": "authentication.us10.hana.ondemand.com",
            }
        }
    ]
})

FAKE_REQUIRED_SCOPE = f"{_FAKE_XSAPPNAME}.User"

# Clearly fake bearer token — not a real JWT, not a real credential
FAKE_BEARER = "test-bearer-fixture.not-real-jwt.0000"


# ── Minimal FastAPI app factory ────────────────────────────────────────────────


def _make_test_app() -> FastAPI:
    """
    Return a minimal FastAPI app that wraps XSUAAInboundMiddleware.

    Does NOT import database.py, models.py, or any project router that
    requires SQLite.  The two endpoints below are sufficient to exercise
    every middleware branch:

      GET /api/test   — protected, requires valid token + User scope
      GET /api/health — exempt from auth in production
    """
    app = FastAPI()
    app.add_middleware(XSUAAInboundMiddleware)

    @app.get("/api/test")
    def protected_endpoint():
        return {"status": "authorized"}

    @app.get("/api/health")
    def health_endpoint():
        return {"status": "ok"}

    return app


# ── Helpers ────────────────────────────────────────────────────────────────────


def _mock_security_context(scope_granted: bool) -> MagicMock:
    """Return a mock sap-xssec SecurityContext whose check_scope() is controllable."""
    ctx = MagicMock()
    ctx.check_scope.return_value = scope_granted
    ctx.get_logon_name.return_value = "test-user-fixture"
    ctx.get_subaccount_id.return_value = "test-subaccount-fixture"
    return ctx


# ══════════════════════════════════════════════════════════════════════════════
# A. LOCAL DEVELOPMENT BYPASS
# Non-production environment, protected endpoint, no Authorization header → 200
# ══════════════════════════════════════════════════════════════════════════════


class TestA_LocalDevelopmentBypass:
    """A. Non-production: middleware is a transparent pass-through."""

    def test_a1_no_auth_header_non_production_returns_200(self, monkeypatch):
        """Non-production, no Authorization header on protected endpoint → 200."""
        monkeypatch.delenv("PYTHON_ENV", raising=False)
        monkeypatch.delenv("APP_ENV", raising=False)
        monkeypatch.delenv("NODE_ENV", raising=False)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            response = client.get("/api/test")

        assert response.status_code == 200

    def test_a2_arbitrary_header_non_production_returns_200(self, monkeypatch):
        """Non-production: even a malformed Authorization header is ignored."""
        monkeypatch.delenv("PYTHON_ENV", raising=False)
        monkeypatch.delenv("APP_ENV", raising=False)
        monkeypatch.delenv("NODE_ENV", raising=False)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            response = client.get("/api/test", headers={"Authorization": "NotBearer whatever"})

        assert response.status_code == 200

    def test_a3_production_flag_absent_bypass_active(self, monkeypatch):
        """Confirm bypass is active when no production env var is set at all."""
        for var in ("PYTHON_ENV", "APP_ENV", "NODE_ENV"):
            monkeypatch.delenv(var, raising=False)

        app = _make_test_app()
        with TestClient(app) as client:
            r = client.get("/api/test")
        assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# B. MISSING TOKEN IN PRODUCTION
# Production environment, valid XSUAA binding, no Authorization header → 401
# ══════════════════════════════════════════════════════════════════════════════


class TestB_MissingTokenInProduction:
    """B. Production: missing Authorization header → 401."""

    def test_b1_no_auth_header_production_returns_401(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/test")

        assert response.status_code == 401
        body = response.json()
        assert body.get("error") == "UNAUTHORIZED"

    def test_b2_empty_authorization_header_returns_401(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/api/test", headers={"Authorization": ""})

        assert response.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# C. MALFORMED BEARER TOKEN
# Production, Authorization header present but not "Bearer ..." format → 401
# ══════════════════════════════════════════════════════════════════════════════


class TestC_MalformedBearerToken:
    """C. Production: malformed / non-Bearer Authorization header → 401."""

    def test_c1_basic_auth_scheme_returns_401(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                "/api/test",
                headers={"Authorization": "Basic dXNlcjpwYXNz"},
            )

        assert response.status_code == 401
        assert response.json().get("error") == "UNAUTHORIZED"

    def test_c2_bearer_with_empty_token_returns_401(self, monkeypatch):
        """'Bearer ' with only whitespace after the prefix → 401."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                "/api/test",
                headers={"Authorization": "Bearer   "},
            )

        assert response.status_code == 401

    def test_c3_token_scheme_not_bearer_returns_401(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(
                "/api/test",
                headers={"Authorization": f"Token {FAKE_BEARER}"},
            )

        assert response.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# D. INVALID / EXPIRED TOKEN
# sap-xssec create_security_context raises an exception → 401
# ══════════════════════════════════════════════════════════════════════════════


class TestD_InvalidOrExpiredToken:
    """D. Production: sap-xssec validation failure → 401."""

    def test_d1_validation_exception_returns_401(self, monkeypatch):
        """Mock create_security_context to raise a validation error → 401."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()

        with patch("sap.xssec.create_security_context", side_effect=Exception("token expired")):
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        assert response.status_code == 401
        assert response.json().get("error") == "UNAUTHORIZED"

    def test_d2_value_error_from_xssec_returns_401(self, monkeypatch):
        """ValueError from create_security_context (bad audience) → 401."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()

        with patch("sap.xssec.create_security_context", side_effect=ValueError("invalid audience")):
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        assert response.status_code == 401

    def test_d3_runtime_error_from_xssec_returns_401(self, monkeypatch):
        """RuntimeError from create_security_context (wrong issuer) → 401."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()

        with patch("sap.xssec.create_security_context", side_effect=RuntimeError("issuer mismatch")):
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        assert response.status_code == 401
        assert response.json().get("error") == "UNAUTHORIZED"


# ══════════════════════════════════════════════════════════════════════════════
# E. VALID TOKEN WITHOUT UNIVERSAL USER SCOPE
# check_scope(<xsappname>.User) == False → 403
# ══════════════════════════════════════════════════════════════════════════════


class TestE_ValidTokenMissingUserScope:
    """E. Production: valid token, check_scope returns False → 403."""

    def test_e1_missing_user_scope_returns_403(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        mock_ctx = _mock_security_context(scope_granted=False)

        with patch("sap.xssec.create_security_context", return_value=mock_ctx):
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        assert response.status_code == 403
        body = response.json()
        assert body.get("error") == "FORBIDDEN"
        # Confirm the correct runtime scope was checked
        mock_ctx.check_scope.assert_called_once_with(FAKE_REQUIRED_SCOPE)

    def test_e2_403_not_401_when_scope_missing(self, monkeypatch):
        """Scope failure must be 403, not 401 (token is valid, user lacks authorization)."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        mock_ctx = _mock_security_context(scope_granted=False)

        with patch("sap.xssec.create_security_context", return_value=mock_ctx):
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        assert response.status_code != 401, "Scope failure must be 403, not 401"
        assert response.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# F. VALID TOKEN WITH UNIVERSAL USER SCOPE
# check_scope(<xsappname>.User) == True → 200
# ══════════════════════════════════════════════════════════════════════════════


class TestF_ValidTokenWithUserScope:
    """F. Production: valid token with User scope → 200."""

    def test_f1_valid_token_with_scope_returns_200(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        mock_ctx = _mock_security_context(scope_granted=True)

        with patch("sap.xssec.create_security_context", return_value=mock_ctx):
            with TestClient(app, raise_server_exceptions=True) as client:
                response = client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        assert response.status_code == 200
        mock_ctx.check_scope.assert_called_once_with(FAKE_REQUIRED_SCOPE)

    def test_f2_scope_check_uses_runtime_xsappname(self, monkeypatch):
        """Middleware must use xsappname from VCAP binding, not a hardcoded value."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        mock_ctx = _mock_security_context(scope_granted=True)

        with patch("sap.xssec.create_security_context", return_value=mock_ctx):
            with TestClient(app, raise_server_exceptions=True) as client:
                client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        # The scope checked must include the fake xsappname from VCAP
        called_scope = mock_ctx.check_scope.call_args[0][0]
        assert called_scope == FAKE_REQUIRED_SCOPE
        assert _FAKE_XSAPPNAME in called_scope
        assert called_scope.endswith(".User")

    def test_f3_identity_attached_to_request_state(self, monkeypatch):
        """After successful auth, request.state.identity is populated."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        captured_identity = {}

        # Build a fresh app that captures request.state.identity
        inner_app = FastAPI()
        inner_app.add_middleware(XSUAAInboundMiddleware)

        @inner_app.get("/api/test")
        def _endpoint(request: Request):
            identity = getattr(request.state, "identity", {})
            captured_identity.update(identity)
            return {"status": "ok"}

        mock_ctx = _mock_security_context(scope_granted=True)

        with patch("sap.xssec.create_security_context", return_value=mock_ctx):
            with TestClient(inner_app, raise_server_exceptions=True) as client:
                response = client.get(
                    "/api/test",
                    headers={"Authorization": f"Bearer {FAKE_BEARER}"},
                )

        assert response.status_code == 200
        assert captured_identity.get("authenticated") is True


# ══════════════════════════════════════════════════════════════════════════════
# G. HEALTH ENDPOINT EXEMPTION
# GET /api/health in production with no Authorization header → 200
# ══════════════════════════════════════════════════════════════════════════════


class TestG_HealthEndpointExemption:
    """G. Production: /api/health is exempt from token validation → 200."""

    def test_g1_health_no_auth_production_returns_200(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            response = client.get("/api/health")

        assert response.status_code == 200

    def test_g2_health_exempt_while_other_paths_protected(self, monkeypatch):
        """Confirm health is exempt but /api/test still requires a token."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        app = _make_test_app()
        with TestClient(app, raise_server_exceptions=False) as client:
            health_resp = client.get("/api/health")
            protected_resp = client.get("/api/test")

        assert health_resp.status_code == 200
        assert protected_resp.status_code == 401

    def test_g3_health_path_exact_match_only(self, monkeypatch):
        """Only exactly /api/health is exempt — a sub-path is still protected."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_VCAP_SERVICES)

        # Add a sub-path to verify it is NOT exempt
        inner_app = FastAPI()
        inner_app.add_middleware(XSUAAInboundMiddleware)

        @inner_app.get("/api/health")
        def _health():
            return {"status": "ok"}

        @inner_app.get("/api/health/details")
        def _health_details():
            return {"status": "details"}

        with TestClient(inner_app, raise_server_exceptions=False) as client:
            health_resp = client.get("/api/health")
            details_resp = client.get("/api/health/details")

        assert health_resp.status_code == 200
        assert details_resp.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# H. MISSING XSUAA BINDING IN PRODUCTION
# No VCAP_SERVICES in production → RuntimeError at app startup (fail closed)
# ══════════════════════════════════════════════════════════════════════════════


class TestH_MissingXsuaaBindingInProduction:
    """H. Production: missing XSUAA binding → fail closed at startup."""

    def test_h1_no_vcap_services_raises_runtime_error(self, monkeypatch):
        """No VCAP_SERVICES in production → RuntimeError at middleware build (fail closed).

        Note: Starlette builds the middleware stack lazily on first request /
        app startup. _make_test_app() itself does not raise; the error surfaces
        when TestClient enters its context and starts the ASGI lifespan.
        """
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.delenv("VCAP_SERVICES", raising=False)

        with pytest.raises(RuntimeError, match="XSUAA credentials not found"):
            with TestClient(_make_test_app()):
                pass  # trigger middleware stack construction

    def test_h2_empty_vcap_services_raises_runtime_error(self, monkeypatch):
        """Empty VCAP_SERVICES string → RuntimeError (fail closed)."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", "")

        with pytest.raises(RuntimeError):
            with TestClient(_make_test_app()):
                pass

    def test_h3_vcap_without_xsuaa_binding_raises_runtime_error(self, monkeypatch):
        """VCAP_SERVICES present but no xsuaa entry → RuntimeError (fail closed)."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv(
            "VCAP_SERVICES",
            json.dumps({"postgresql": [{"credentials": {"host": "localhost"}}]}),
        )

        with pytest.raises(RuntimeError):
            with TestClient(_make_test_app()):
                pass

    def test_h4_vcap_xsuaa_missing_xsappname_raises_runtime_error(self, monkeypatch):
        """VCAP xsuaa binding present but xsappname absent → RuntimeError (fail closed)."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv(
            "VCAP_SERVICES",
            json.dumps({
                "xsuaa": [{
                    "credentials": {
                        "clientid": "sb-test!t0000",
                        "clientsecret": "test-secret-fixture",
                        "url": "https://test.authentication.us10.hana.ondemand.com",
                        # xsappname intentionally absent
                    }
                }]
            }),
        )

        with pytest.raises(RuntimeError, match="xsappname not found"):
            with TestClient(_make_test_app()):
                pass

    def test_h5_non_production_missing_vcap_does_not_raise(self, monkeypatch):
        """Non-production without VCAP_SERVICES must NOT raise (bypass active)."""
        monkeypatch.delenv("PYTHON_ENV", raising=False)
        monkeypatch.delenv("APP_ENV", raising=False)
        monkeypatch.delenv("NODE_ENV", raising=False)
        monkeypatch.delenv("VCAP_SERVICES", raising=False)

        # Should not raise
        app = _make_test_app()
        with TestClient(app) as client:
            r = client.get("/api/test")
        assert r.status_code == 200
