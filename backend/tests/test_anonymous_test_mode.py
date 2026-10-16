"""
N-CoreShift — Anonymous Test Mode Tests (Gate 0E10-AT1A)

Validates backend/auth/anonymous_test.py and its integration into
XSUAAInboundMiddleware (backend/auth/xsuaa.py).

Scenarios (per gate Step 11):
  1. Default mode requires authentication.
  2. anonymous_test without confirmation fails closed.
  3. anonymous_test on wrong app name fails closed.
  4. anonymous_test on ncoreshift-test-python permits safe allowlisted route.
  5. N-CoreIQ routes return 403 in anonymous_test.
  6. Admin operations return 403 in anonymous_test.
  7. Production/default authenticated behavior is unchanged.
  8. Production xs-app.json still requires XSUAA.
  9. Test xs-app config uses authenticationType: none.
  10. Test descriptor uses separate app names.
"""

import json
import os
import sys

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auth.xsuaa import XSUAAInboundMiddleware  # noqa: E402
from auth.anonymous_test import (  # noqa: E402
    REQUIRED_TEST_APP_NAME,
    FORBIDDEN_PRODUCTION_APP_NAME,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAKE_XSUAA_VCAP_SERVICES = json.dumps({
    "xsuaa": [
        {
            "credentials": {
                "clientid": "sb-ncoreshift-test-fixture!t0000",
                "clientsecret": "test-fixture-not-a-real-secret-0000",
                "url": "https://test-fixture.authentication.us10.hana.ondemand.com",
                "xsappname": "ncoreshift-test-fixture!t0000",
                "identityzone": "test-fixture-zone",
                "uaadomain": "authentication.us10.hana.ondemand.com",
            }
        }
    ]
})


def _vcap_application(app_name: str) -> str:
    return json.dumps({"application_name": app_name})


def _make_app_with_routes() -> FastAPI:
    app = FastAPI()
    app.add_middleware(XSUAAInboundMiddleware)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/config/bootstrap")
    def bootstrap():
        return {"success": True, "data": {"anonymousTestMode": True}}

    @app.post("/api/ncoreiq/ping")
    def ncoreiq_ping():
        return {"status": "should-not-reach"}

    @app.get("/api/ncoreiq/import/x/status")
    def ncoreiq_status():
        return {"status": "should-not-reach"}

    @app.get("/api/admin/users")
    def admin_users():
        return {"status": "should-not-reach"}

    @app.get("/api/ai-admin/providers")
    def ai_admin_providers():
        return {"status": "should-not-reach"}

    @app.get("/api/test")
    def protected():
        return {"status": "authorized"}

    return app


# ══════════════════════════════════════════════════════════════════════════
# 1. Default mode requires authentication
# ══════════════════════════════════════════════════════════════════════════


class Test1_DefaultModeRequiresAuth:
    def test_production_default_no_token_returns_401(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.delenv("NCORESHIFT_AUTH_MODE", raising=False)
        monkeypatch.delenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", raising=False)
        monkeypatch.delenv("VCAP_APPLICATION", raising=False)

        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/api/test")
        assert resp.status_code == 401


# ══════════════════════════════════════════════════════════════════════════
# 2. anonymous_test without confirmation fails closed
# ══════════════════════════════════════════════════════════════════════════


class Test2_MissingConfirmationFailsClosed:
    def test_missing_confirm_raises_runtime_error(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.delenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", raising=False)
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application(REQUIRED_TEST_APP_NAME))

        with pytest.raises(RuntimeError, match="NCORESHIFT_ANONYMOUS_TEST_CONFIRM"):
            with TestClient(_make_app_with_routes()):
                pass


# ══════════════════════════════════════════════════════════════════════════
# 3. anonymous_test on wrong app name fails closed
# ══════════════════════════════════════════════════════════════════════════


class Test3_WrongAppNameFailsClosed:
    def test_wrong_app_name_raises_runtime_error(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.setenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", "true")
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application("some-other-app"))

        with pytest.raises(RuntimeError, match=REQUIRED_TEST_APP_NAME):
            with TestClient(_make_app_with_routes()):
                pass

    def test_production_app_name_always_raises_runtime_error(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.setenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", "true")
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application(FORBIDDEN_PRODUCTION_APP_NAME))

        with pytest.raises(RuntimeError, match=FORBIDDEN_PRODUCTION_APP_NAME):
            with TestClient(_make_app_with_routes()):
                pass


# ══════════════════════════════════════════════════════════════════════════
# 4. anonymous_test on ncoreshift-test-python permits safe allowlisted route
# ══════════════════════════════════════════════════════════════════════════


class Test4_CorrectAppNamePermitsSafeRoute:
    def test_health_allowed_under_anonymous_test(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.setenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", "true")
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application(REQUIRED_TEST_APP_NAME))

        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=True) as client:
            resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_bootstrap_allowed_under_anonymous_test(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.setenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", "true")
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application(REQUIRED_TEST_APP_NAME))

        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=True) as client:
            resp = client.get("/api/config/bootstrap")
        assert resp.status_code == 200
        assert resp.json()["data"]["anonymousTestMode"] is True

    def test_non_allowlisted_route_returns_403(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.setenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", "true")
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application(REQUIRED_TEST_APP_NAME))

        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/api/test")
        assert resp.status_code == 403
        assert resp.json()["message"] == "Operation disabled in anonymous test mode."


# ══════════════════════════════════════════════════════════════════════════
# 5. N-CoreIQ routes return 403 in anonymous_test
# ══════════════════════════════════════════════════════════════════════════


class Test5_NCoreIQRoutesBlocked:
    def _anon_env(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.setenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", "true")
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application(REQUIRED_TEST_APP_NAME))

    def test_ncoreiq_ping_returns_403(self, monkeypatch):
        self._anon_env(monkeypatch)
        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.post("/api/ncoreiq/ping")
        assert resp.status_code == 403

    def test_ncoreiq_import_status_returns_403(self, monkeypatch):
        self._anon_env(monkeypatch)
        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/api/ncoreiq/import/x/status")
        assert resp.status_code == 403


# ══════════════════════════════════════════════════════════════════════════
# 6. Admin operations return 403 in anonymous_test
# ══════════════════════════════════════════════════════════════════════════


class Test6_AdminRoutesBlocked:
    def _anon_env(self, monkeypatch):
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.setenv("NCORESHIFT_AUTH_MODE", "anonymous_test")
        monkeypatch.setenv("NCORESHIFT_ANONYMOUS_TEST_CONFIRM", "true")
        monkeypatch.setenv("VCAP_APPLICATION", _vcap_application(REQUIRED_TEST_APP_NAME))

    def test_admin_users_returns_403(self, monkeypatch):
        self._anon_env(monkeypatch)
        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/api/admin/users")
        assert resp.status_code == 403

    def test_ai_admin_providers_returns_403(self, monkeypatch):
        self._anon_env(monkeypatch)
        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/api/ai-admin/providers")
        assert resp.status_code == 403


# ══════════════════════════════════════════════════════════════════════════
# 7. Production/default authenticated behavior is unchanged (regression)
# ══════════════════════════════════════════════════════════════════════════


class Test7_ProductionAuthUnchanged:
    def test_valid_token_with_scope_still_returns_200(self, monkeypatch):
        """Confirms anonymous_test module presence does not alter the normal
        XSUAA validation path when NCORESHIFT_AUTH_MODE is unset."""
        monkeypatch.setenv("PYTHON_ENV", "production")
        monkeypatch.setenv("VCAP_SERVICES", FAKE_XSUAA_VCAP_SERVICES)
        monkeypatch.delenv("NCORESHIFT_AUTH_MODE", raising=False)
        monkeypatch.delenv("VCAP_APPLICATION", raising=False)

        app = _make_app_with_routes()
        mock_ctx = MagicMock()
        mock_ctx.check_scope.return_value = True
        mock_ctx.get_logon_name.return_value = "test-user-fixture"
        mock_ctx.get_subaccount_id.return_value = "test-subaccount-fixture"

        with patch("sap.xssec.create_security_context", return_value=mock_ctx):
            with TestClient(app, raise_server_exceptions=True) as client:
                resp = client.get(
                    "/api/test",
                    headers={"Authorization": "Bearer test-bearer-fixture.not-real-jwt.0000"},
                )
        assert resp.status_code == 200

    def test_non_production_bypass_still_active(self, monkeypatch):
        for var in ("PYTHON_ENV", "APP_ENV", "NODE_ENV"):
            monkeypatch.delenv(var, raising=False)
        monkeypatch.delenv("NCORESHIFT_AUTH_MODE", raising=False)
        monkeypatch.delenv("VCAP_APPLICATION", raising=False)

        app = _make_app_with_routes()
        with TestClient(app, raise_server_exceptions=True) as client:
            resp = client.get("/api/test")
        assert resp.status_code == 200


# ══════════════════════════════════════════════════════════════════════════
# 8. Production xs-app.json still requires XSUAA (static check)
# ══════════════════════════════════════════════════════════════════════════


class Test8_ProductionXsAppStillXsuaa:
    def test_production_xs_app_routes_use_xsuaa(self):
        path = os.path.join(REPO_ROOT, "app", "xs-app.json")
        with open(path) as f:
            config = json.load(f)
        api_routes = [r for r in config["routes"] if r.get("source", "").startswith("^/api")]
        assert len(api_routes) > 0
        for route in api_routes:
            assert route.get("authenticationType") == "xsuaa"

    def test_production_xs_app_frontend_route_uses_xsuaa(self):
        path = os.path.join(REPO_ROOT, "app", "xs-app.json")
        with open(path) as f:
            config = json.load(f)
        frontend_routes = [r for r in config["routes"] if r.get("localDir")]
        assert len(frontend_routes) == 1
        assert frontend_routes[0]["authenticationType"] == "xsuaa"


# ══════════════════════════════════════════════════════════════════════════
# 9. Test xs-app config uses authenticationType: none (static check)
# ══════════════════════════════════════════════════════════════════════════


class Test9_TestXsAppUsesNoneAuth:
    def test_all_routes_use_none_auth(self):
        path = os.path.join(REPO_ROOT, "app", "xs-app.anonymous-test.json")
        with open(path) as f:
            config = json.load(f)
        for route in config["routes"]:
            assert route.get("authenticationType") == "none"

    def test_destination_targets_test_python_app(self):
        path = os.path.join(REPO_ROOT, "app", "xs-app.anonymous-test.json")
        with open(path) as f:
            config = json.load(f)
        api_routes = [r for r in config["routes"] if r.get("destination")]
        assert len(api_routes) > 0
        for route in api_routes:
            assert route["destination"] == REQUIRED_TEST_APP_NAME
            assert route["destination"] != FORBIDDEN_PRODUCTION_APP_NAME


# ══════════════════════════════════════════════════════════════════════════
# 10. Test descriptor uses separate app names (static check)
# ══════════════════════════════════════════════════════════════════════════


class Test10_TestMtaUsesSeparateAppNames:
    def _load_mta(self):
        import yaml
        path = os.path.join(REPO_ROOT, "mta-anonymous-test.yaml")
        with open(path) as f:
            return yaml.safe_load(f)

    def test_mta_id_is_anonymous_test(self):
        mta = self._load_mta()
        assert mta["ID"] == "ncoreshift-anonymous-test"

    def test_backend_module_name_is_test_python(self):
        mta = self._load_mta()
        names = [m["name"] for m in mta["modules"]]
        assert REQUIRED_TEST_APP_NAME in names
        assert FORBIDDEN_PRODUCTION_APP_NAME not in names
        assert "ncoreshift-app" not in names

    def test_no_direct_sap_bindings(self):
        mta = self._load_mta()
        resource_names = [r["name"] for r in mta.get("resources", [])]
        assert "ecc-mcp-destination" not in resource_names
        assert "ecc-mcp-connectivity" not in resource_names

    def test_xsuaa_is_existing_service_reference_only(self):
        mta = self._load_mta()
        xsuaa_resources = [r for r in mta.get("resources", []) if r["name"] == "ncoreshift-uaa"]
        assert len(xsuaa_resources) == 1
        assert xsuaa_resources[0]["type"] == "org.cloudfoundry.existing-service"
