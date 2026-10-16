"""
N-CoreShift — Protected (Certification) AppRouter Config Tests
(Gate 0E10-LOGIN-R1B)

Validates app-certification/xs-app.json — the AppRouter source actually
packaged by mta-certification.yaml (module 'ncoreshift-app', path
'app-certification') for the deployed ncoreshift-certification/1.0.0
generation.

LOGIN-R2 established that the generic repair in app/xs-app.json
(Gate 0E10-LOGIN-R1) was never applied to this protected variant.
LOGIN-R1B applies the equivalent deterministic corporate IdP selection
('sap.custom') to every XSUAA route in app-certification/xs-app.json,
without altering any other route semantics, the generic AppRouter
(app/xs-app.json), the anonymous-test AppRouter, or any MTA descriptor.

This test module intentionally mirrors the structure of
Test11_LoginR1IdentityProviderSelection in test_anonymous_test_mode.py,
but targets the protected certification variant.
"""

import json
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestProtectedAppCertificationIdentityProviderSelection:
    """app-certification/xs-app.json — Gate 0E10-LOGIN-R1B repair."""

    EXPECTED_IDENTITY_PROVIDER = "sap.custom"

    def _load_protected_xs_app(self):
        path = os.path.join(REPO_ROOT, "app-certification", "xs-app.json")
        with open(path) as f:
            return json.load(f)

    def test_every_xsuaa_route_selects_sap_custom_idp(self):
        config = self._load_protected_xs_app()
        xsuaa_routes = [r for r in config["routes"] if r.get("authenticationType") == "xsuaa"]
        assert len(xsuaa_routes) > 0
        for route in xsuaa_routes:
            assert route.get("identityProvider") == self.EXPECTED_IDENTITY_PROVIDER, (
                f"Route {route.get('source')} with authenticationType=xsuaa must set "
                f"identityProvider={self.EXPECTED_IDENTITY_PROVIDER!r}"
            )

    def test_none_auth_routes_do_not_receive_identity_provider(self):
        config = self._load_protected_xs_app()
        none_routes = [r for r in config["routes"] if r.get("authenticationType") == "none"]
        for route in none_routes:
            assert "identityProvider" not in route, (
                f"Route {route.get('source')} with authenticationType=none must NOT "
                "set identityProvider"
            )

    def test_route_destinations_and_localdirs_unchanged(self):
        config = self._load_protected_xs_app()
        routes = config["routes"]
        assert len(routes) == 2

        ncoreiq_route = next(r for r in routes if r["source"] == "^/api/ncoreiq/(.*)$")
        assert ncoreiq_route["target"] == "/api/ncoreiq/$1"
        assert ncoreiq_route["destination"] == "ncoreshift-python"
        assert ncoreiq_route["csrfProtection"] is True

        frontend_route = next(r for r in routes if r["source"] == "^/(.*)$")
        assert frontend_route["target"] == "/$1"
        assert frontend_route["localDir"] == "dist"

    def test_no_routes_added_or_removed(self):
        config = self._load_protected_xs_app()
        assert len(config["routes"]) == 2

    def test_no_dynamic_identity_provider_configuration(self):
        config = self._load_protected_xs_app()
        serialized = json.dumps(config)
        assert "dynamicIdentityProvider" not in serialized
        assert "DYNAMIC_IDENTITY_PROVIDER" not in serialized

    def test_welcome_and_logout_config_unchanged(self):
        config = self._load_protected_xs_app()
        assert config["welcomeFile"] == "/index.html"
        assert config["authenticationMethod"] == "route"
        assert config["sessionTimeout"] == 30
        assert config["logout"]["logoutEndpoint"] == "/do/logout"
        assert config["logout"]["logoutPage"] == "/index.html"

    def test_protected_mta_descriptor_ownership(self):
        """Confirms app-certification is still packaged by the
        ncoreshift-app module in mta-certification.yaml."""
        import yaml
        path = os.path.join(REPO_ROOT, "mta-certification.yaml")
        with open(path) as f:
            mta = yaml.safe_load(f)
        assert mta["ID"] == "ncoreshift-certification"
        approuter_modules = [m for m in mta["modules"] if m["name"] == "ncoreshift-app"]
        assert len(approuter_modules) == 1
        assert approuter_modules[0]["path"] == "app-certification"

    def test_protected_mta_does_not_introduce_dynamic_identity_provider(self):
        import yaml
        path = os.path.join(REPO_ROOT, "mta-certification.yaml")
        with open(path) as f:
            mta = yaml.safe_load(f)
        serialized = json.dumps(mta)
        assert "DYNAMIC_IDENTITY_PROVIDER" not in serialized


class TestGenericAppRouterUnaffectedByProtectedRepair:
    """Regression guard: confirms the generic AppRouter (LOGIN-R1) remains
    intact and is not altered by the protected (LOGIN-R1B) repair."""

    EXPECTED_IDENTITY_PROVIDER = "sap.custom"

    def _load_generic_xs_app(self):
        path = os.path.join(REPO_ROOT, "app", "xs-app.json")
        with open(path) as f:
            return json.load(f)

    def test_every_xsuaa_route_still_selects_sap_custom_idp(self):
        config = self._load_generic_xs_app()
        xsuaa_routes = [r for r in config["routes"] if r.get("authenticationType") == "xsuaa"]
        assert len(xsuaa_routes) > 0
        for route in xsuaa_routes:
            assert route.get("identityProvider") == self.EXPECTED_IDENTITY_PROVIDER


class TestAnonymousTestAppRouterUnaffectedByProtectedRepair:
    """Regression guard: confirms the anonymous-test AppRouter remains
    certified (authenticationType: none on all routes) and is not altered
    by the protected (LOGIN-R1B) repair."""

    def test_all_routes_still_use_none_auth(self):
        path = os.path.join(REPO_ROOT, "app", "xs-app.anonymous-test.json")
        with open(path) as f:
            config = json.load(f)
        for route in config["routes"]:
            assert route.get("authenticationType") == "none"
