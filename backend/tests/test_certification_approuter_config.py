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
import re

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


class TestProtectedCertificationTenantAwareRoute:
    """Gate 0E10-LOGIN-R4D — tenant-aware AppRouter route topology repair.

    Validates that mta-certification.yaml module 'ncoreshift-app' exposes
    both a legacy compatibility route and an explicit tenant-aware route
    (prefixed with the ntt-tdd-build-demo subaccount subdomain), and that
    TENANT_HOST_PATTERN correctly captures only that tenant prefix from the
    tenant-aware hostname — without depending on the ambiguous
    ${default-uri} placeholder and without hardcoding the regional domain.
    """

    EXPECTED_TENANT = "ntt-tdd-build-demo"
    EXPECTED_IDENTITY_PROVIDER = "sap.custom"

    def _load_mta_certification(self):
        import yaml
        path = os.path.join(REPO_ROOT, "mta-certification.yaml")
        with open(path) as f:
            return yaml.safe_load(f)

    def _approuter_module(self, mta):
        modules = [m for m in mta["modules"] if m["name"] == "ncoreshift-app"]
        assert len(modules) == 1
        return modules[0]

    def test_explicit_routes_parameter_present(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        routes = module["parameters"].get("routes")
        assert routes is not None, "ncoreshift-app module must declare explicit 'routes'"
        assert isinstance(routes, list)
        assert len(routes) == 2

    def test_compatibility_route_present(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        route_values = [r["route"] for r in module["parameters"]["routes"]]
        assert "ncoreshift-app.${default-domain}" in route_values

    def test_tenant_aware_route_present_with_correct_prefix(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        route_values = [r["route"] for r in module["parameters"]["routes"]]
        expected_route = f"{self.EXPECTED_TENANT}-ncoreshift-app.${{default-domain}}"
        assert expected_route in route_values

    def test_legacy_host_domain_parameters_removed(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        assert "host" not in module["parameters"], (
            "Legacy 'host' parameter must be superseded by explicit 'routes'"
        )
        assert "domain" not in module["parameters"]

    def test_tenant_host_pattern_does_not_use_default_uri(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        pattern = module["properties"]["TENANT_HOST_PATTERN"]
        assert "default-uri" not in pattern, (
            "TENANT_HOST_PATTERN must not depend on the ambiguous ${default-uri} "
            "placeholder once explicit routes are in use"
        )

    def test_tenant_host_pattern_uses_default_domain_placeholder(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        pattern = module["properties"]["TENANT_HOST_PATTERN"]
        assert "${default-domain}" in pattern
        assert "cfapps.us10.hana.ondemand.com" not in pattern, (
            "TENANT_HOST_PATTERN must not hardcode the regional domain"
        )

    def test_tenant_host_pattern_matches_tenant_aware_hostname_and_captures_tenant(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        pattern = module["properties"]["TENANT_HOST_PATTERN"]
        resolved_pattern = pattern.replace(
            "${default-domain}", "cfapps.us10.hana.ondemand.com"
        )
        tenant_aware_host = f"{self.EXPECTED_TENANT}-ncoreshift-app.cfapps.us10.hana.ondemand.com"
        match = re.match(resolved_pattern, tenant_aware_host)
        assert match is not None, "Pattern must match the tenant-aware hostname"
        assert match.group(1) == self.EXPECTED_TENANT

    def test_tenant_host_pattern_does_not_capture_ncoreshift_app_as_tenant(self):
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        pattern = module["properties"]["TENANT_HOST_PATTERN"]
        resolved_pattern = pattern.replace(
            "${default-domain}", "cfapps.us10.hana.ondemand.com"
        )
        tenant_aware_host = f"{self.EXPECTED_TENANT}-ncoreshift-app.cfapps.us10.hana.ondemand.com"
        match = re.match(resolved_pattern, tenant_aware_host)
        assert match is not None
        assert match.group(1) != "ncoreshift-app"

    def test_tenant_host_pattern_does_not_match_compatibility_hostname(self):
        """The bare compatibility hostname has no tenant prefix, so the
        pattern is expected NOT to match it (acceptable: legacy/compat
        routing only during certification)."""
        mta = self._load_mta_certification()
        module = self._approuter_module(mta)
        pattern = module["properties"]["TENANT_HOST_PATTERN"]
        resolved_pattern = pattern.replace(
            "${default-domain}", "cfapps.us10.hana.ondemand.com"
        )
        compat_host = "ncoreshift-app.cfapps.us10.hana.ondemand.com"
        match = re.match(resolved_pattern, compat_host)
        assert match is None

    def test_protected_identity_provider_still_sap_custom(self):
        path = os.path.join(REPO_ROOT, "app-certification", "xs-app.json")
        with open(path) as f:
            config = json.load(f)
        xsuaa_routes = [r for r in config["routes"] if r.get("authenticationType") == "xsuaa"]
        assert len(xsuaa_routes) == 2
        for route in xsuaa_routes:
            assert route.get("identityProvider") == self.EXPECTED_IDENTITY_PROVIDER

    def test_no_useridp_or_iot_security_substitution_introduced(self):
        mta = self._load_mta_certification()
        serialized = json.dumps(mta)
        assert "useridp" not in serialized
        assert "iot-security" not in serialized

    def test_anonymous_test_descriptor_route_config_unchanged(self):
        """Regression guard: mta-anonymous-test.yaml must retain its
        ${default-uri}-based TENANT_HOST_PATTERN and must not have gained
        a tenant-aware route — this repair is scoped only to
        mta-certification.yaml."""
        import yaml
        path = os.path.join(REPO_ROOT, "mta-anonymous-test.yaml")
        with open(path) as f:
            mta = yaml.safe_load(f)
        test_modules = [m for m in mta["modules"] if m["name"] == "ncoreshift-test"]
        assert len(test_modules) == 1
        module = test_modules[0]
        pattern = module["properties"]["TENANT_HOST_PATTERN"]
        assert pattern == "^(.*)-${default-uri}"
        assert "routes" not in module["parameters"]

    def test_generic_mta_descriptor_route_config_unchanged(self):
        """Regression guard: mta.yaml must retain its ${default-uri}-based
        TENANT_HOST_PATTERN and must not have gained a tenant-aware route."""
        import yaml
        path = os.path.join(REPO_ROOT, "mta.yaml")
        with open(path) as f:
            mta = yaml.safe_load(f)
        serialized = json.dumps(mta)
        assert "ntt-tdd-build-demo" not in serialized
