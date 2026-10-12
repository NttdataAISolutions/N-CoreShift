"""
N-CoreShift — Python Backend N-CoreIQ Auth Tests (Foundation C.1)

Tests A–Q: XSUAA token acquisition, caching, fail-closed behavior,
N-CoreIQ 401/403, disabled-mode restrictions, token safety,
and source contract (no max_lines).

All HTTP calls use unittest.mock — no live XSUAA or N-CoreIQ required.

Scenarios:
A. xsuaa token acquisition success
B. Basic client authentication to XSUAA token endpoint
C. Authorization Bearer attached to N-CoreIQ request
D. cached token reused (single HTTP call for multiple get_token() calls)
E. expired token refreshed (short expires_in triggers re-acquisition)
F. missing VCAP/XSUAA binding fails closed
G. missing clientid/clientsecret fails closed
H. token endpoint 401 fails closed
I. token endpoint timeout
J. token endpoint unavailable (network error)
K. access token never appears in errors
L. client secret never appears in errors
M. disabled mode works only for local/dev
N. production disabled mode rejected
O. N-CoreIQ 401 normalized
P. N-CoreIQ 403 normalized
Q. get_source still sends NO max_lines parameter
"""

import asyncio
import base64
import json
import os
import sys
import time
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Imports ───────────────────────────────────────────────────────────────────
from integrations.ncoreiq_token_provider import (
    DisabledModeTokenProvider,
    NCoreIQTokenAcquisitionError,
    XSUAAClientCredentialsTokenProvider,
    _resolve_xsuaa_binding,
    create_ncoreiq_token_provider,
    reset_ncoreiq_token_provider_singleton,
)
from integrations.ncoreiq_client import (
    NCoreIQClient,
    NCoreIQError,
    NCoreIQTimeoutError,
    NCoreIQUnavailableError,
)

# ── Test constants ────────────────────────────────────────────────────────────

DUMMY_TOKEN_URL = "https://test.authentication.us10.hana.ondemand.com/oauth/token"
DUMMY_CLIENT_ID = "sb-ncoreshift-test!t123"
# Dummy secret — NOT a real credential. Test fixture only.
DUMMY_CLIENT_SECRET = "test-secret-fixture-not-real"
DUMMY_TOKEN = "eyJhbGciOiJSUzI1NiJ9.dGVzdC10b2tlbi1ub3QtcmVhbA.sig"
BASE_URL = "http://localhost:8000"

# ── Mock httpx helpers ────────────────────────────────────────────────────────

def _make_httpx_response(status_code: int, json_body: Any) -> MagicMock:
    """Create a mock httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body
    return resp


def _success_token_response(token: str = DUMMY_TOKEN, expires_in: int = 43200) -> MagicMock:
    return _make_httpx_response(200, {"access_token": token, "token_type": "bearer", "expires_in": expires_in})


def _error_token_response(status: int, body: Any = None) -> MagicMock:
    return _make_httpx_response(status, body or {"error": "unauthorized_client"})


def make_provider(token: str = DUMMY_TOKEN, expires_in: int = 43200) -> XSUAAClientCredentialsTokenProvider:
    """Create a provider with mocked httpx."""
    provider = XSUAAClientCredentialsTokenProvider(
        client_id=DUMMY_CLIENT_ID,
        client_secret=DUMMY_CLIENT_SECRET,
        token_url=DUMMY_TOKEN_URL,
    )
    return provider


# ═══════════════════════════════════════════════════════════════════════════════
# A. XSUAA token acquisition success
# ═══════════════════════════════════════════════════════════════════════════════

class TestA_TokenAcquisitionSuccess:
    """A. xsuaa token acquisition success"""

    @pytest.mark.asyncio
    async def test_a1_obtains_access_token(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_client):
            token = await provider.get_token()
        assert isinstance(token, str)
        assert len(token) > 0

    @pytest.mark.asyncio
    async def test_a2_token_matches_response(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_client):
            token = await provider.get_token()
        assert token == DUMMY_TOKEN

    @pytest.mark.asyncio
    async def test_a3_has_cached_token_after_acquisition(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        assert provider.has_cached_token() is False
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
        assert provider.has_cached_token() is True


# ═══════════════════════════════════════════════════════════════════════════════
# B. Basic client authentication to XSUAA token endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestB_BasicClientAuthentication:
    """B. Basic client authentication to XSUAA token endpoint"""

    @pytest.mark.asyncio
    async def test_b1_posts_to_correct_url(self):
        provider = make_provider()
        call_urls = []
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def capture_post(url, **kwargs):
            call_urls.append(url)
            return _success_token_response()
        mock_client.post = capture_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
        assert call_urls[0] == DUMMY_TOKEN_URL

    @pytest.mark.asyncio
    async def test_b2_sends_client_credentials_grant(self):
        provider = make_provider()
        call_kwargs = []
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def capture_post(url, **kwargs):
            call_kwargs.append(kwargs)
            return _success_token_response()
        mock_client.post = capture_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
        body = call_kwargs[0].get("content", b"")
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        assert "grant_type=client_credentials" in body

    @pytest.mark.asyncio
    async def test_b3_sends_basic_auth_header(self):
        provider = make_provider()
        call_kwargs = []
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def capture_post(url, **kwargs):
            call_kwargs.append(kwargs)
            return _success_token_response()
        mock_client.post = capture_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
        headers = call_kwargs[0].get("headers", {})
        assert "Authorization" in headers
        assert headers["Authorization"].startswith("Basic ")

    @pytest.mark.asyncio
    async def test_b4_basic_auth_encodes_credentials_correctly(self):
        provider = make_provider()
        call_kwargs = []
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def capture_post(url, **kwargs):
            call_kwargs.append(kwargs)
            return _success_token_response()
        mock_client.post = capture_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
        auth_header = call_kwargs[0]["headers"]["Authorization"]
        encoded = auth_header.replace("Basic ", "")
        decoded = base64.b64decode(encoded).decode("utf-8")
        assert decoded == f"{DUMMY_CLIENT_ID}:{DUMMY_CLIENT_SECRET}"


# ═══════════════════════════════════════════════════════════════════════════════
# C. Authorization Bearer attached to N-CoreIQ request
# ═══════════════════════════════════════════════════════════════════════════════

class TestC_BearerAttachedToNCoreIQRequest:
    """C. Authorization Bearer attached to N-CoreIQ request"""

    @pytest.mark.asyncio
    async def test_c1_bearer_attached_to_ping(self):
        provider = make_provider()
        mock_token_client = AsyncMock()
        mock_token_client.__aenter__ = AsyncMock(return_value=mock_token_client)
        mock_token_client.__aexit__ = AsyncMock(return_value=False)
        mock_token_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_token_client):
            await provider.get_token()

        # Now make an N-CoreIQ request — capture Authorization header
        client = NCoreIQClient(BASE_URL, token_provider=provider)
        captured_headers = []
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        ping_resp = MagicMock()
        ping_resp.status_code = 200
        ping_resp.raise_for_status = MagicMock()
        ping_resp.json = MagicMock(return_value={"status": "connected", "system_id": "NC1"})
        async def capture_get(url, headers=None, params=None):
            captured_headers.append(headers or {})
            return ping_resp
        mock_api_client.get = capture_get
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            await client.ping()
        assert captured_headers[0].get("Authorization") == f"Bearer {DUMMY_TOKEN}"

    @pytest.mark.asyncio
    async def test_c2_no_auth_header_when_disabled_provider(self):
        provider = DisabledModeTokenProvider()
        client = NCoreIQClient(BASE_URL, token_provider=provider)
        captured_headers = []
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        ping_resp = MagicMock()
        ping_resp.status_code = 200
        ping_resp.raise_for_status = MagicMock()
        ping_resp.json = MagicMock(return_value={"status": "connected"})
        async def capture_get(url, headers=None, params=None):
            captured_headers.append(headers or {})
            return ping_resp
        mock_api_client.get = capture_get
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            await client.ping()
        assert "Authorization" not in captured_headers[0]


# ═══════════════════════════════════════════════════════════════════════════════
# D. Cached token reused
# ═══════════════════════════════════════════════════════════════════════════════

class TestD_CachedTokenReused:
    """D. cached token reused — single HTTP call for multiple get_token() calls"""

    @pytest.mark.asyncio
    async def test_d1_single_http_call_for_multiple_get_token(self):
        provider = make_provider()
        call_count = {"n": 0}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def counting_post(url, **kwargs):
            call_count["n"] += 1
            return _success_token_response(DUMMY_TOKEN, expires_in=43200)
        mock_client.post = counting_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            t1 = await provider.get_token()
            t2 = await provider.get_token()
            t3 = await provider.get_token()
        assert call_count["n"] == 1
        assert t1 == t2 == t3 == DUMMY_TOKEN

    @pytest.mark.asyncio
    async def test_d2_invalidate_cache_forces_reacquisition(self):
        provider = make_provider()
        call_count = {"n": 0}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def counting_post(url, **kwargs):
            call_count["n"] += 1
            return _success_token_response(f"token-{call_count['n']}", expires_in=43200)
        mock_client.post = counting_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            t1 = await provider.get_token()
            provider.invalidate_cache()
            t2 = await provider.get_token()
        assert call_count["n"] == 2
        assert t1 != t2

    @pytest.mark.asyncio
    async def test_d3_has_cached_token_false_after_invalidate(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_success_token_response())
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
        assert provider.has_cached_token() is True
        provider.invalidate_cache()
        assert provider.has_cached_token() is False


# ═══════════════════════════════════════════════════════════════════════════════
# E. Expired token refreshed
# ═══════════════════════════════════════════════════════════════════════════════

class TestE_ExpiredTokenRefreshed:
    """E. expired token refreshed — short expires_in triggers re-acquisition"""

    @pytest.mark.asyncio
    async def test_e1_reacquires_when_expires_in_less_than_safety_margin(self):
        """expires_in=1 means (1s - 30s safety) = immediately expired → always re-acquire."""
        provider = make_provider()
        call_count = {"n": 0}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def counting_post(url, **kwargs):
            call_count["n"] += 1
            return _success_token_response(f"token-{call_count['n']}", expires_in=1)
        mock_client.post = counting_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
            await provider.get_token()
        # expires_in=1 with 30s safety margin → cache is immediately invalid → 2 calls
        assert call_count["n"] == 2

    @pytest.mark.asyncio
    async def test_e2_manipulated_valid_until_triggers_refresh(self):
        """Manually set _valid_until to past → next get_token() re-acquires."""
        provider = make_provider()
        call_count = {"n": 0}
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        async def counting_post(url, **kwargs):
            call_count["n"] += 1
            return _success_token_response(f"token-{call_count['n']}", expires_in=43200)
        mock_client.post = counting_post
        with patch("httpx.AsyncClient", return_value=mock_client):
            t1 = await provider.get_token()
            # Force expiry
            provider._valid_until = time.monotonic() - 1.0
            t2 = await provider.get_token()
        assert call_count["n"] == 2
        assert t1 != t2

    @pytest.mark.asyncio
    async def test_e3_default_expires_in_used_when_missing(self):
        """If expires_in is absent from response, default 43200s is used."""
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_make_httpx_response(
            200, {"access_token": DUMMY_TOKEN, "token_type": "bearer"}
        ))
        before = time.monotonic()
        with patch("httpx.AsyncClient", return_value=mock_client):
            await provider.get_token()
        # valid_until should be ~ (before + 43200 - 30)
        assert provider._valid_until > before + 43100
        assert provider._valid_until < before + 43300


# ═══════════════════════════════════════════════════════════════════════════════
# F. Missing VCAP/XSUAA binding fails closed
# ═══════════════════════════════════════════════════════════════════════════════

class TestF_MissingBindingFailsClosed:
    """F. missing VCAP/XSUAA binding fails closed"""

    def test_f1_create_provider_xsuaa_no_vcap_raises(self, monkeypatch):
        reset_ncoreiq_token_provider_singleton()
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.delenv("NCS_XSUAA_CLIENT_ID", raising=False)
        monkeypatch.delenv("NCS_XSUAA_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("NCS_XSUAA_URL", raising=False)
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            create_ncoreiq_token_provider(auth_mode="xsuaa", is_production=False)
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.BINDING_MISSING

    def test_f2_resolve_xsuaa_binding_returns_none_without_env(self, monkeypatch):
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.delenv("NCS_XSUAA_CLIENT_ID", raising=False)
        monkeypatch.delenv("NCS_XSUAA_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("NCS_XSUAA_URL", raising=False)
        result = _resolve_xsuaa_binding()
        assert result is None

    def test_f3_vcap_services_xsuaa_binding_resolved(self, monkeypatch):
        vcap = {"xsuaa": [{"credentials": {
            "clientid": "sb-test!t1",
            "clientsecret": "secret-fixture",
            "url": "https://test.authentication.us10.hana.ondemand.com",
        }}]}
        monkeypatch.setenv("VCAP_SERVICES", json.dumps(vcap))
        monkeypatch.delenv("NCS_XSUAA_CLIENT_ID", raising=False)
        result = _resolve_xsuaa_binding()
        assert result is not None
        client_id, client_secret, url = result
        assert client_id == "sb-test!t1"
        assert url == "https://test.authentication.us10.hana.ondemand.com"

    def test_f4_ncs_xsuaa_env_vars_fallback(self, monkeypatch):
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-fallback!t2")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "fallback-secret")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://fallback.authentication.us10.hana.ondemand.com")
        result = _resolve_xsuaa_binding()
        assert result is not None
        client_id, _, url = result
        assert client_id == "sb-fallback!t2"

    def test_f5_malformed_vcap_falls_through_to_env_vars(self, monkeypatch):
        monkeypatch.setenv("VCAP_SERVICES", "not-valid-json")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-fallback!t3")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "secret-fallback")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://fallback.authentication.us10.hana.ondemand.com")
        result = _resolve_xsuaa_binding()
        assert result is not None
        assert result[0] == "sb-fallback!t3"


# ═══════════════════════════════════════════════════════════════════════════════
# G. Missing clientid/clientsecret fails closed
# ═══════════════════════════════════════════════════════════════════════════════

class TestG_MissingCredentialsFailsClosed:
    """G. missing clientid/clientsecret fails closed"""

    def test_g1_empty_client_id_raises_credentials_missing(self):
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            XSUAAClientCredentialsTokenProvider(
                client_id="",
                client_secret=DUMMY_CLIENT_SECRET,
                token_url=DUMMY_TOKEN_URL,
            )
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.CREDENTIALS_MISSING

    def test_g2_whitespace_client_id_raises_credentials_missing(self):
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            XSUAAClientCredentialsTokenProvider(
                client_id="   ",
                client_secret=DUMMY_CLIENT_SECRET,
                token_url=DUMMY_TOKEN_URL,
            )
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.CREDENTIALS_MISSING

    def test_g3_empty_client_secret_raises_credentials_missing(self):
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            XSUAAClientCredentialsTokenProvider(
                client_id=DUMMY_CLIENT_ID,
                client_secret="",
                token_url=DUMMY_TOKEN_URL,
            )
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.CREDENTIALS_MISSING

    def test_g4_empty_token_url_raises_binding_missing(self):
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            XSUAAClientCredentialsTokenProvider(
                client_id=DUMMY_CLIENT_ID,
                client_secret=DUMMY_CLIENT_SECRET,
                token_url="",
            )
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.BINDING_MISSING


# ═══════════════════════════════════════════════════════════════════════════════
# H. Token endpoint 401/4xx fails closed
# ═══════════════════════════════════════════════════════════════════════════════

class TestH_TokenEndpointErrorFailsClosed:
    """H. token endpoint 401 fails closed"""

    @pytest.mark.asyncio
    async def test_h1_endpoint_401_raises_token_endpoint_error(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_error_token_response(401))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_ERROR

    @pytest.mark.asyncio
    async def test_h2_endpoint_400_raises_token_endpoint_error(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_error_token_response(400))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_ERROR

    @pytest.mark.asyncio
    async def test_h3_endpoint_500_raises_token_endpoint_error(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_error_token_response(500))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_ERROR

    @pytest.mark.asyncio
    async def test_h4_missing_access_token_field_raises(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_make_httpx_response(
            200, {"token_type": "bearer"}
        ))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_ERROR


# ═══════════════════════════════════════════════════════════════════════════════
# I. Token endpoint timeout
# ═══════════════════════════════════════════════════════════════════════════════

class TestI_TokenEndpointTimeout:
    """I. token endpoint timeout"""

    @pytest.mark.asyncio
    async def test_i1_timeout_raises_token_endpoint_timeout(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_TIMEOUT

    @pytest.mark.asyncio
    async def test_i2_connect_timeout_raises_token_endpoint_timeout(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.ConnectTimeout("connect timeout"))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        # ConnectTimeout is a subclass of TimeoutException
        assert exc_info.value.reason in (
            NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_TIMEOUT,
            NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_UNAVAILABLE,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# J. Token endpoint unavailable (network error)
# ═══════════════════════════════════════════════════════════════════════════════

class TestJ_TokenEndpointUnavailable:
    """J. token endpoint unavailable (network error)"""

    @pytest.mark.asyncio
    async def test_j1_connect_error_raises_unavailable(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.ConnectError("ECONNREFUSED"))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_UNAVAILABLE

    @pytest.mark.asyncio
    async def test_j2_network_error_raises_unavailable(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.NetworkError("network error"))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_UNAVAILABLE

    @pytest.mark.asyncio
    async def test_j3_generic_exception_raises_unavailable(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=OSError("connection refused"))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.TOKEN_ENDPOINT_UNAVAILABLE


# ═══════════════════════════════════════════════════════════════════════════════
# K. Access token never appears in errors
# ═══════════════════════════════════════════════════════════════════════════════

class TestK_TokenNeverInErrors:
    """K. access token never appears in errors"""

    def test_k1_ncoreiq_error_never_contains_token(self):
        err = NCoreIQError(401, "UNAUTHORIZED", "Auth required")
        assert DUMMY_TOKEN not in str(err)
        assert "Bearer" not in str(err)
        assert "token" not in str(err).lower()

    @pytest.mark.asyncio
    async def test_k2_acquisition_error_never_contains_token(self):
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_error_token_response(
            401, {"error": "INVALID_TOKEN", "hint": DUMMY_TOKEN}
        ))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        # Error message must not contain the raw token value from the response body
        assert DUMMY_TOKEN not in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_k3_ncoreiq_client_error_no_bearer_in_message(self):
        provider = make_provider()
        mock_token_client = AsyncMock()
        mock_token_client.__aenter__ = AsyncMock(return_value=mock_token_client)
        mock_token_client.__aexit__ = AsyncMock(return_value=False)
        mock_token_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_token_client):
            await provider.get_token()

        client = NCoreIQClient(BASE_URL, token_provider=provider)
        err_resp = MagicMock()
        err_resp.status_code = 401
        err_resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("401", request=MagicMock(), response=err_resp)
        )
        err_resp.json = MagicMock(return_value={"message": "Token invalid"})
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = AsyncMock(return_value=err_resp)
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            with pytest.raises(NCoreIQError) as exc_info:
                await client.ping()
        assert DUMMY_TOKEN not in str(exc_info.value)
        assert "Bearer" not in str(exc_info.value)


# ═══════════════════════════════════════════════════════════════════════════════
# L. Client secret never appears in errors
# ═══════════════════════════════════════════════════════════════════════════════

class TestL_ClientSecretNeverInErrors:
    """L. client secret never appears in errors"""

    def test_l1_credentials_missing_error_no_secret(self):
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            XSUAAClientCredentialsTokenProvider(
                client_id=DUMMY_CLIENT_ID,
                client_secret="",
                token_url=DUMMY_TOKEN_URL,
            )
        assert DUMMY_CLIENT_SECRET not in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_l2_endpoint_error_does_not_echo_response_body(self):
        """Response body might contain credential-related hints — must not appear in error."""
        provider = make_provider()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=_error_token_response(
            401, {"error": "invalid_client", "hint": DUMMY_CLIENT_SECRET}
        ))
        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
                await provider.get_token()
        assert DUMMY_CLIENT_SECRET not in str(exc_info.value)

    def test_l3_binding_missing_error_no_secret(self):
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            XSUAAClientCredentialsTokenProvider(
                client_id=DUMMY_CLIENT_ID,
                client_secret=DUMMY_CLIENT_SECRET,
                token_url="",
            )
        assert DUMMY_CLIENT_SECRET not in str(exc_info.value)


# ═══════════════════════════════════════════════════════════════════════════════
# M. Disabled mode works only for local/dev
# ═══════════════════════════════════════════════════════════════════════════════

class TestM_DisabledModeLocalDevOnly:
    """M. disabled mode works only for local/dev"""

    @pytest.mark.asyncio
    async def test_m1_disabled_provider_returns_empty_string(self):
        provider = DisabledModeTokenProvider()
        token = await provider.get_token()
        assert token == ""

    def test_m2_create_provider_disabled_non_production_ok(self, monkeypatch):
        reset_ncoreiq_token_provider_singleton()
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.delenv("NCS_XSUAA_CLIENT_ID", raising=False)
        # Should NOT raise
        provider = create_ncoreiq_token_provider(auth_mode="disabled", is_production=False)
        assert isinstance(provider, DisabledModeTokenProvider)

    @pytest.mark.asyncio
    async def test_m3_disabled_client_sends_no_auth_header(self):
        provider = DisabledModeTokenProvider()
        client = NCoreIQClient(BASE_URL, token_provider=provider)
        captured_headers = []
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        resp = MagicMock()
        resp.status_code = 200
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={"status": "connected"})
        async def cap_get(url, headers=None, params=None):
            captured_headers.append(headers or {})
            return resp
        mock_api_client.get = cap_get
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            await client.ping()
        assert "Authorization" not in captured_headers[0]


# ═══════════════════════════════════════════════════════════════════════════════
# N. Production disabled mode rejected
# ═══════════════════════════════════════════════════════════════════════════════

class TestN_ProductionDisabledModeRejected:
    """N. production disabled mode rejected"""

    def test_n1_create_provider_disabled_production_raises(self, monkeypatch):
        reset_ncoreiq_token_provider_singleton()
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            create_ncoreiq_token_provider(auth_mode="disabled", is_production=True)
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.BINDING_MISSING

    def test_n2_production_env_disabled_raises(self, monkeypatch):
        reset_ncoreiq_token_provider_singleton()
        monkeypatch.setenv("NCOREIQ_AUTH_MODE", "disabled")
        monkeypatch.setenv("PYTHON_ENV", "production")
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            create_ncoreiq_token_provider()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.BINDING_MISSING

    def test_n3_error_message_does_not_reveal_mode_or_credentials(self, monkeypatch):
        reset_ncoreiq_token_provider_singleton()
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            create_ncoreiq_token_provider(auth_mode="disabled", is_production=True)
        msg = str(exc_info.value)
        # Should not reveal production credential values
        assert DUMMY_CLIENT_SECRET not in msg


# ═══════════════════════════════════════════════════════════════════════════════
# O. N-CoreIQ 401 normalized
# ═══════════════════════════════════════════════════════════════════════════════

class TestO_NCoreIQ401Normalized:
    """O. N-CoreIQ 401 normalized"""

    @pytest.mark.asyncio
    async def test_o1_ncoreiq_401_raises_ncoreiq_error(self):
        provider = make_provider()
        mock_token_client = AsyncMock()
        mock_token_client.__aenter__ = AsyncMock(return_value=mock_token_client)
        mock_token_client.__aexit__ = AsyncMock(return_value=False)
        mock_token_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_token_client):
            await provider.get_token()

        client = NCoreIQClient(BASE_URL, token_provider=provider)
        err_resp = MagicMock()
        err_resp.status_code = 401
        err_resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("401 Unauthorized", request=MagicMock(), response=err_resp)
        )
        err_resp.json = MagicMock(return_value={"message": "JWT expired"})
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = AsyncMock(return_value=err_resp)
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            with pytest.raises(NCoreIQError) as exc_info:
                await client.ping()
        assert exc_info.value.http_status == 401
        assert exc_info.value.error_code == "UNAUTHORIZED"
        # Error must not contain token
        assert DUMMY_TOKEN not in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_o2_ncoreiq_401_no_token_in_error(self):
        client = NCoreIQClient(BASE_URL, bearer_token=DUMMY_TOKEN)
        err_resp = MagicMock()
        err_resp.status_code = 401
        err_resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("401", request=MagicMock(), response=err_resp)
        )
        err_resp.json = MagicMock(return_value={"message": "Unauthorized"})
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = AsyncMock(return_value=err_resp)
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            with pytest.raises(NCoreIQError) as exc_info:
                await client.ping()
        assert DUMMY_TOKEN not in str(exc_info.value)
        assert "Bearer" not in str(exc_info.value)


# ═══════════════════════════════════════════════════════════════════════════════
# P. N-CoreIQ 403 normalized
# ═══════════════════════════════════════════════════════════════════════════════

class TestP_NCoreIQ403Normalized:
    """P. N-CoreIQ 403 normalized"""

    @pytest.mark.asyncio
    async def test_p1_ncoreiq_403_raises_forbidden(self):
        provider = make_provider()
        mock_token_client = AsyncMock()
        mock_token_client.__aenter__ = AsyncMock(return_value=mock_token_client)
        mock_token_client.__aexit__ = AsyncMock(return_value=False)
        mock_token_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_token_client):
            await provider.get_token()

        client = NCoreIQClient(BASE_URL, token_provider=provider)
        err_resp = MagicMock()
        err_resp.status_code = 403
        err_resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("403 Forbidden", request=MagicMock(), response=err_resp)
        )
        err_resp.json = MagicMock(return_value={"message": "Insufficient scope: NCoreIQ.Viewer required"})
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = AsyncMock(return_value=err_resp)
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            with pytest.raises(NCoreIQError) as exc_info:
                await client.ping()
        assert exc_info.value.http_status == 403
        assert exc_info.value.error_code == "FORBIDDEN"

    @pytest.mark.asyncio
    async def test_p2_ncoreiq_403_no_token_in_error(self):
        client = NCoreIQClient(BASE_URL, bearer_token=DUMMY_TOKEN)
        err_resp = MagicMock()
        err_resp.status_code = 403
        err_resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("403", request=MagicMock(), response=err_resp)
        )
        err_resp.json = MagicMock(return_value={"message": "Forbidden"})
        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = AsyncMock(return_value=err_resp)
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            with pytest.raises(NCoreIQError) as exc_info:
                await client.ping()
        assert DUMMY_TOKEN not in str(exc_info.value)


# ═══════════════════════════════════════════════════════════════════════════════
# R. Production requires VCAP_SERVICES — NCS_XSUAA_* env vars blocked
# ═══════════════════════════════════════════════════════════════════════════════

class TestR_ProductionVCAPOnlyBinding:
    """
    R. Production mode: NCS_XSUAA_* env var fallback is unavailable.

    In production (PYTHON_ENV=production / APP_ENV=production), the token
    provider MUST use the VCAP_SERVICES xsuaa binding exclusively.
    Manually injected NCS_XSUAA_* credentials must not be accepted.

    This prevents a service key or developer-injected secret from silently
    becoming a production runtime dependency.
    """

    def test_r1_production_with_vcap_services_succeeds(self, monkeypatch):
        """Production + valid VCAP_SERVICES binding → provider created successfully."""
        reset_ncoreiq_token_provider_singleton()
        vcap = {"xsuaa": [{"credentials": {
            "clientid": "sb-ncoreshift-prod!t99",
            "clientsecret": "prod-secret-fixture",
            "url": "https://prod.authentication.us10.hana.ondemand.com",
        }}]}
        monkeypatch.setenv("VCAP_SERVICES", json.dumps(vcap))
        monkeypatch.setenv("PYTHON_ENV", "production")
        # Also set NCS_XSUAA_* to verify VCAP takes precedence
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-override-should-be-ignored")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "override-secret-ignored")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://override.authentication.us10.hana.ondemand.com")
        # Should not raise — VCAP binding is present and valid
        provider = create_ncoreiq_token_provider(auth_mode="xsuaa", is_production=True)
        assert isinstance(provider, XSUAAClientCredentialsTokenProvider)

    def test_r2_production_with_only_env_vars_fails_closed(self, monkeypatch):
        """Production + no VCAP_SERVICES + NCS_XSUAA_* set → BINDING_MISSING raised.

        NCS_XSUAA_* env vars MUST NOT be accepted as a production credential source.
        """
        reset_ncoreiq_token_provider_singleton()
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-injected-prod-id")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "injected-prod-secret")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://injected.authentication.us10.hana.ondemand.com")
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            create_ncoreiq_token_provider(auth_mode="xsuaa", is_production=True)
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.BINDING_MISSING

    def test_r3_non_production_env_vars_accepted(self, monkeypatch):
        """Non-production + no VCAP_SERVICES + NCS_XSUAA_* set → provider created."""
        reset_ncoreiq_token_provider_singleton()
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-dev-client-id")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "dev-secret-fixture")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://dev.authentication.us10.hana.ondemand.com")
        # Non-production: env var fallback permitted
        provider = create_ncoreiq_token_provider(auth_mode="xsuaa", is_production=False)
        assert isinstance(provider, XSUAAClientCredentialsTokenProvider)

    def test_r4_resolve_binding_production_skips_env_vars(self, monkeypatch):
        """_resolve_xsuaa_binding(is_production=True) returns None when only env vars present."""
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-injected-id")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "injected-secret")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://injected.authentication.us10.hana.ondemand.com")
        result = _resolve_xsuaa_binding(is_production=True)
        assert result is None

    def test_r5_resolve_binding_non_production_accepts_env_vars(self, monkeypatch):
        """_resolve_xsuaa_binding(is_production=False) uses env vars when VCAP absent."""
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-dev-id")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "dev-secret")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://dev.authentication.us10.hana.ondemand.com")
        result = _resolve_xsuaa_binding(is_production=False)
        assert result is not None
        assert result[0] == "sb-dev-id"

    def test_r6_production_malformed_vcap_no_env_var_fallback(self, monkeypatch):
        """Production + malformed VCAP_SERVICES + NCS_XSUAA_* → BINDING_MISSING (no fallback)."""
        reset_ncoreiq_token_provider_singleton()
        monkeypatch.setenv("VCAP_SERVICES", "not-valid-json{{{")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-should-not-be-used")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "should-not-be-used-secret")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://should-not-be-used.authentication.us10.hana.ondemand.com")
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            create_ncoreiq_token_provider(auth_mode="xsuaa", is_production=True)
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.BINDING_MISSING

    def test_r7_app_env_production_triggers_vcap_only(self, monkeypatch):
        """APP_ENV=production (BTP deployment value) also enforces VCAP-only binding."""
        reset_ncoreiq_token_provider_singleton()
        monkeypatch.delenv("VCAP_SERVICES", raising=False)
        monkeypatch.delenv("PYTHON_ENV", raising=False)
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("NCOREIQ_AUTH_MODE", "xsuaa")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_ID", "sb-btp-injected")
        monkeypatch.setenv("NCS_XSUAA_CLIENT_SECRET", "btp-injected-secret")
        monkeypatch.setenv("NCS_XSUAA_URL", "https://btp.authentication.us10.hana.ondemand.com")
        with pytest.raises(NCoreIQTokenAcquisitionError) as exc_info:
            create_ncoreiq_token_provider()
        assert exc_info.value.reason == NCoreIQTokenAcquisitionError.BINDING_MISSING


# ═══════════════════════════════════════════════════════════════════════════════
# Q. get_source still sends NO max_lines parameter
# ═══════════════════════════════════════════════════════════════════════════════

class TestQ_GetSourceNoMaxLines:
    """Q. get_source still sends NO max_lines parameter"""

    @pytest.mark.asyncio
    async def test_q1_get_source_no_max_lines_param(self):
        provider = make_provider()
        mock_token_client = AsyncMock()
        mock_token_client.__aenter__ = AsyncMock(return_value=mock_token_client)
        mock_token_client.__aexit__ = AsyncMock(return_value=False)
        mock_token_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_token_client):
            await provider.get_token()

        client = NCoreIQClient(BASE_URL, token_provider=provider)
        source_resp = MagicMock()
        source_resp.status_code = 200
        source_resp.raise_for_status = MagicMock()
        source_resp.json = MagicMock(return_value={
            "sap_object_type": "PROG", "object_name": "ZTEST",
            "system_id": "NC1", "client": "800",
            "max_lines": None, "returned_lines": 10,
            "found": True, "truncated": False, "message": None, "sha256": "abc",
            "components": [],
        })
        captured_params = []
        captured_urls = []

        async def cap_get(url, headers=None, params=None):
            captured_params.append(params or {})
            captured_urls.append(url)
            return source_resp

        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = cap_get
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            await client.get_source("PROG", "ZTEST")

        # No max_lines in params
        assert "max_lines" not in captured_params[0]
        # URL must not contain max_lines
        assert "max_lines" not in captured_urls[0]
        # URL must use correct path
        assert "/api/v1/repository/objects/PROG/ZTEST/source" in captured_urls[0]

    @pytest.mark.asyncio
    async def test_q2_get_source_with_token_attaches_bearer(self):
        """get_source() with token provider still attaches Authorization header."""
        provider = make_provider()
        mock_token_client = AsyncMock()
        mock_token_client.__aenter__ = AsyncMock(return_value=mock_token_client)
        mock_token_client.__aexit__ = AsyncMock(return_value=False)
        mock_token_client.post = AsyncMock(return_value=_success_token_response(DUMMY_TOKEN))
        with patch("httpx.AsyncClient", return_value=mock_token_client):
            await provider.get_token()

        client = NCoreIQClient(BASE_URL, token_provider=provider)
        source_resp = MagicMock()
        source_resp.status_code = 200
        source_resp.raise_for_status = MagicMock()
        source_resp.json = MagicMock(return_value={
            "sap_object_type": "PROG", "object_name": "ZTEST",
            "returned_lines": 5, "found": True, "truncated": False,
            "sha256": "abc", "components": [],
        })
        captured_headers = []

        async def cap_get(url, headers=None, params=None):
            captured_headers.append(headers or {})
            return source_resp

        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = cap_get
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            await client.get_source("PROG", "ZTEST")

        assert captured_headers[0].get("Authorization") == f"Bearer {DUMMY_TOKEN}"

    @pytest.mark.asyncio
    async def test_q3_get_source_bounded_does_send_max_lines(self):
        """Verify get_source_bounded() DOES send max_lines (display-only path)."""
        client = NCoreIQClient(BASE_URL, bearer_token=DUMMY_TOKEN)
        source_resp = MagicMock()
        source_resp.status_code = 200
        source_resp.raise_for_status = MagicMock()
        source_resp.json = MagicMock(return_value={"components": []})
        captured_params = []

        async def cap_get(url, headers=None, params=None):
            captured_params.append(params or {})
            return source_resp

        mock_api_client = AsyncMock()
        mock_api_client.__aenter__ = AsyncMock(return_value=mock_api_client)
        mock_api_client.__aexit__ = AsyncMock(return_value=False)
        mock_api_client.get = cap_get
        with patch("httpx.AsyncClient", return_value=mock_api_client):
            await client.get_source_bounded("PROG", "ZTEST", max_lines=100)

        assert captured_params[0].get("max_lines") == "100"
