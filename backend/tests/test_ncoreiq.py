"""
N-CoreShift — Python Backend N-CoreIQ Tests

All N-CoreIQ HTTP calls are mocked using unittest.mock.
No live N-CoreIQ or SAP connectivity required.

Tests cover scenarios A–R as specified in Foundation B.2:
A. Connection success
B. Connection 401/403
C. Connection timeout
D. Fail-closed xsuaa configuration
E. Package discovery
F. Object preview
G. Complete source import with 1,250 lines
H. No max_lines parameter
I. Truncated source rejection
J. Source hash persistence (N-CoreIQ provided + locally computed)
K. Tenant/project isolation
L. Successful import persistence
M. Partial import
N. Failed import
O. Dependency persistence
P. Local/upstream job correlation for async extraction
Q. Safe error redaction
R. Explicit refresh does not destroy previous evidence
"""

import asyncio
import hashlib
import json
import os
import sys
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ── Path setup ────────────────────────────────────────────────────────────────
# Allow imports from backend/ root when running pytest from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── In-memory SQLite for tests ────────────────────────────────────────────────
import models
from database import Base

TEST_DB_URL = "sqlite://"  # pure in-memory
_test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
Base.metadata.create_all(bind=_test_engine)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)


def make_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


# ── Fixtures ──────────────────────────────────────────────────────────────────

from integrations.ncoreiq_client import (
    NCoreIQClient,
    NCoreIQError,
    NCoreIQTimeoutError,
    NCoreIQUnavailableError,
    resolve_base_url,
)
from providers.ncoreiq_source_provider import (
    NCoreIQJobStore,
    NCoreIQSourceProvider,
    compute_source_hash,
    extract_source_text,
    get_source_hash,
)


def make_client(mock_fn=None) -> NCoreIQClient:
    """Create a client with a mocked _get/_post."""
    client = NCoreIQClient("http://localhost:8000")
    if mock_fn:
        client._get = mock_fn
        client._post = mock_fn
    return client


def make_provider(mock_client=None) -> tuple[NCoreIQSourceProvider, NCoreIQJobStore]:
    store = NCoreIQJobStore()
    if mock_client is None:
        mock_client = NCoreIQClient("http://localhost:8000")
    return NCoreIQSourceProvider(mock_client, store), store


def ping_ok() -> Dict[str, Any]:
    return {"status": "connected", "system_id": "NC1", "client": "800",
            "sap_release": "752", "message": "OK"}


def make_source_response(line_count: int, obj_name: str = "ZTEST",
                          truncated: bool = False) -> Dict[str, Any]:
    lines = [{"component_type": "PROGRAM", "component_name": obj_name,
               "line_no": i + 1, "source_line": f"* Line {i + 1}"} for i in range(line_count)]
    source_text = "\n".join(l["source_line"] for l in lines)
    sha256 = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
    return {
        "sap_object_type": "PROG", "object_name": obj_name,
        "system_id": "NC1", "client": "800",
        "max_lines": None, "returned_lines": line_count,
        "found": True, "truncated": truncated, "message": None,
        "sha256": sha256,
        "components": [{"component_type": "PROGRAM", "component_name": obj_name,
                        "line_count": line_count, "source_text": source_text, "lines": lines}],
    }


def make_metadata_response(obj_name: str = "ZTEST") -> Dict[str, Any]:
    return {"sap_object_type": "PROG", "object_name": obj_name, "system_id": "NC1",
            "client": "800", "pgmid": "R3TR", "package": "ZTEST_PKG",
            "author": "DEVUSER", "created_date": "20230115", "changed_by": "DEVUSER2",
            "changed_date": "20261001", "description": "Test", "active_status": "A",
            "found": True, "warning": None, "message": None,
            "object_subtype": None, "program_name": None, "function_group": None,
            "table_class": None, "master_language": "EN", "source_system": None,
            "sap_release": "752"}


def make_search_response(count: int = 3) -> Dict[str, Any]:
    return {
        "system_id": "NC1", "client": "800", "truncated": False, "message": None,
        "statistics": {"total_matches": count, "returned_count": count},
        "objects": [{"sap_object_type": "PROG", "friendly_type": "Program",
                      "object_name": f"ZPROG_{i}", "package": "ZTEST",
                      "description": f"Prog {i}", "author": "DEV", "match_reason": "PACKAGE"}
                    for i in range(count)],
    }


def make_deps_response(obj_name: str = "ZTEST") -> Dict[str, Any]:
    return {
        "system_id": "NC1", "client": "800",
        "source_object_type": "PROG", "source_object_name": obj_name,
        "total_relations": 1, "returned_relations": 1, "truncated": False, "message": None,
        "relationships": [{
            "relation_id": 1, "system_id": "NC1", "client": "800",
            "source_object_type": "PROG", "source_object_name": obj_name,
            "target_object_type": "FUNC", "target_object_name": "ZFI_GET_VENDOR",
            "relationship_type": "CALLS_FUNCTION", "confidence": "EXACT",
            "evidence_source": "ABAP_PARSER", "source_component": "PROGRAM__ZTEST",
            "line_no": 42, "dynamic": False, "detail": None,
        }],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# A. Connection success
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_connection_success():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(return_value=ping_ok())
    provider, _ = make_provider(client)
    result = await provider.test_connection()
    assert result["connected"] is True
    assert result["sourceProvider"] == "NCOREIQ"
    assert result["systemId"] == "NC1"
    assert result["client"] == "800"
    assert result["sapRelease"] == "752"
    assert result["error"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# B. Connection 401 / 403
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_b_connection_401():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(side_effect=NCoreIQError(401, "UNAUTHORIZED", "Token required"))
    provider, _ = make_provider(client)
    result = await provider.test_connection()
    assert result["connected"] is False
    assert "Bearer" not in (result.get("error") or "")


@pytest.mark.asyncio
async def test_b_connection_403():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(side_effect=NCoreIQError(403, "FORBIDDEN", "Insufficient scope"))
    provider, _ = make_provider(client)
    result = await provider.test_connection()
    assert result["connected"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# C. Connection timeout
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_c_connection_timeout():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(side_effect=NCoreIQTimeoutError(30.0))
    provider, _ = make_provider(client)
    result = await provider.test_connection()
    assert result["connected"] is False
    assert result["error"] is not None


# ═══════════════════════════════════════════════════════════════════════════════
# D. Fail-closed xsuaa configuration
# ═══════════════════════════════════════════════════════════════════════════════

def test_d_fail_closed_xsuaa(monkeypatch):
    monkeypatch.setenv("NCOREIQ_AUTH_MODE", "xsuaa")
    monkeypatch.delenv("NCOREIQ_BASE_URL", raising=False)
    with pytest.raises(ValueError, match="NCOREIQ_BASE_URL must be configured"):
        resolve_base_url(request_base_url=None)


def test_d_server_env_takes_precedence(monkeypatch):
    monkeypatch.setenv("NCOREIQ_BASE_URL", "http://configured-server:8000")
    monkeypatch.setenv("NCOREIQ_AUTH_MODE", "xsuaa")
    url = resolve_base_url(request_base_url="http://browser-url-should-be-ignored:9999")
    assert url == "http://configured-server:8000"


# ═══════════════════════════════════════════════════════════════════════════════
# E. Package discovery
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_e_package_discovery():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(return_value={
        "root_package": "ZNCOREIQ",
        "packages": [
            {"package": "ZNCOREIQ", "parent_package": None, "description": "Root", "depth": 0},
            {"package": "ZNCOREIQ_CORE", "parent_package": "ZNCOREIQ", "description": "Core", "depth": 1},
        ],
    })
    provider, _ = make_provider(client)
    result = await provider.list_packages("ZNCOREIQ")
    assert result["root_package"] == "ZNCOREIQ"
    assert len(result["packages"]) == 2
    assert result["packages"][1]["parent_package"] == "ZNCOREIQ"


# ═══════════════════════════════════════════════════════════════════════════════
# F. Object preview
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_f_object_preview():
    client = NCoreIQClient("http://localhost:8000")
    client._post = AsyncMock(return_value=make_search_response(5))
    provider, _ = make_provider(client)
    result = await provider.preview_objects(["ZNCOREIQ"])
    assert len(result["objects"]) == 5
    assert result["objects"][0]["sap_object_type"] == "PROG"
    assert result["objects"][0]["friendly_type"] == "Program"
    assert result["objects"][0]["match_reason"] == "PACKAGE"


# ═══════════════════════════════════════════════════════════════════════════════
# G. Complete source import — 1,250 lines
# H. No max_lines parameter
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_g_1250_line_import():
    source = make_source_response(1250, "ZREPORT_LARGE")
    client = NCoreIQClient("http://localhost:8000")
    call_args = []
    async def mock_get(path, params=None, timeout=30.0):
        call_args.append((path, params))
        if "metadata" in path:
            return make_metadata_response("ZREPORT_LARGE")
        return source
    client._get = mock_get
    provider, store = make_provider(client)
    db = TestSession()
    # Create project
    proj = models.Project(name="TestProj1250")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        obj_id = await provider.import_object(proj.id, "PROG", "ZREPORT_LARGE", "Program", "ZPKG", db, "http://localhost:8000")
        assert obj_id is not None
        obj = db.query(models.Object).filter(models.Object.id == obj_id).first()
        assert obj is not None
        assert obj.lines_of_code == 1250
        lines = obj.source_code.split("\n")
        assert len(lines) == 1250
    finally:
        db.close()


@pytest.mark.asyncio
async def test_h_no_max_lines_in_source_request():
    """Verify get_source() NEVER sends max_lines parameter."""
    source = make_source_response(10, "ZTEST")
    client = NCoreIQClient("http://localhost:8000")
    captured_params = []
    async def mock_get(path, params=None, timeout=30.0):
        captured_params.append(params or {})
        if "metadata" in path:
            return make_metadata_response()
        return source
    client._get = mock_get
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestNoMaxLines")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        await provider.import_object(proj.id, "PROG", "ZTEST", "Program", "", db, "http://localhost:8000")
        source_params = [p for p in captured_params if "max_lines" in p]
        assert len(source_params) == 0, "max_lines must NEVER be sent for import"
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# I. Truncated source rejection
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_i_truncated_source_rejected():
    truncated_source = make_source_response(5, "ZTEST", truncated=True)
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(return_value=truncated_source)
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestTruncated")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        result = await provider.import_object(proj.id, "PROG", "ZTEST", "Program", "", db, "http://localhost:8000")
        assert result is None, "Truncated source must be rejected"
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# J. Source hash persistence
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_j_source_hash_ncoreiq_provided():
    source = make_source_response(5, "ZHASH")
    client = NCoreIQClient("http://localhost:8000")
    async def mock_get(path, params=None, timeout=30.0):
        if "metadata" in path: return make_metadata_response("ZHASH")
        return source
    client._get = mock_get
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestHashProvided")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        obj_id = await provider.import_object(proj.id, "PROG", "ZHASH", "Program", "", db, "http://localhost:8000")
        obj = db.query(models.Object).filter(models.Object.id == obj_id).first()
        assert obj.source_code_version == source["sha256"]
        meta = json.loads(obj.ncoreiq_metadata_json)
        assert meta["ncoreiq_hash_provided"] is True
        assert meta["provider"] == "NCOREIQ"
        assert meta["contract_version"] == "v1"
    finally:
        db.close()


@pytest.mark.asyncio
async def test_j_source_hash_computed_locally():
    source = make_source_response(5, "ZHASH2")
    source["sha256"] = ""  # N-CoreIQ did not provide hash
    client = NCoreIQClient("http://localhost:8000")
    async def mock_get(path, params=None, timeout=30.0):
        if "metadata" in path: return make_metadata_response("ZHASH2")
        return source
    client._get = mock_get
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestHashComputed")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        obj_id = await provider.import_object(proj.id, "PROG", "ZHASH2", "Program", "", db, "http://localhost:8000")
        obj = db.query(models.Object).filter(models.Object.id == obj_id).first()
        assert obj.source_code_version is not None and len(obj.source_code_version) == 64
        meta = json.loads(obj.ncoreiq_metadata_json)
        assert meta["ncoreiq_hash_provided"] is False
    finally:
        db.close()


def test_j_hash_deterministic():
    text = "* Source line 1\n* Source line 2"
    h1 = compute_source_hash(text)
    h2 = compute_source_hash(text)
    assert h1 == h2
    assert len(h1) == 64


# ═══════════════════════════════════════════════════════════════════════════════
# K. Tenant / project isolation
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_k_project_isolation():
    source = make_source_response(5, "ZISOLATE")
    client = NCoreIQClient("http://localhost:8000")
    async def mock_get(path, params=None, timeout=30.0):
        if "metadata" in path: return make_metadata_response("ZISOLATE")
        return source
    client._get = mock_get
    provider, _ = make_provider(client)
    db = TestSession()
    proj_a = models.Project(name="IsoProjectA")
    proj_b = models.Project(name="IsoProjectB")
    db.add(proj_a); db.add(proj_b); db.commit()
    db.refresh(proj_a); db.refresh(proj_b)
    try:
        # Import into proj_a only
        await provider.import_object(proj_a.id, "PROG", "ZISOLATE", "Program", "", db, "http://localhost:8000")
        obj_a = db.query(models.Object).filter(models.Object.project_id == proj_a.id).first()
        obj_b = db.query(models.Object).filter(models.Object.project_id == proj_b.id).first()
        assert obj_a is not None
        assert obj_b is None  # proj_b has no objects
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# L. Successful import persistence
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_l_successful_import_persisted():
    source = make_source_response(10, "ZPERSIST")
    client = NCoreIQClient("http://localhost:8000")
    async def mock_get(path, params=None, timeout=30.0):
        if "metadata" in path: return make_metadata_response("ZPERSIST")
        return source
    client._get = mock_get
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestPersist")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        obj_id = await provider.import_object(proj.id, "PROG", "ZPERSIST", "Program", "ZPKG", db, "http://localhost:8000")
        assert obj_id is not None
        obj = db.query(models.Object).filter(models.Object.id == obj_id).first()
        assert obj.object_name == "ZPERSIST"
        assert obj.provider == "NCOREIQ"
        assert obj.is_latest_version is True
        assert obj.object_version == 1
        assert obj.lines_of_code == 10
        meta = json.loads(obj.ncoreiq_metadata_json)
        assert meta["sap_sid"] == "NC1"
        assert meta["sap_client"] == "800"
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# M. Partial import
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_m_partial_import():
    store = NCoreIQJobStore()
    local_id = store.create(None, 1, 2, ["ZPKG"])
    store.update(local_id, objectsImported=1, objectsFailed=1)
    store.set_status(local_id, "PARTIAL")
    job = store.get(local_id)
    assert job["status"] == "PARTIAL"
    assert job["objectsImported"] == 1
    assert job["objectsFailed"] == 1


# ═══════════════════════════════════════════════════════════════════════════════
# N. Failed import
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_n_failed_import():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(side_effect=NCoreIQError(503, "SAP_UNAVAILABLE", "SAP is down"))
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestFailed")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        result = await provider.import_object(proj.id, "PROG", "ZFAILED", "Program", "", db, "http://localhost:8000")
        assert result is None
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# O. Dependency persistence
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_o_dependency_persistence():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(return_value=make_deps_response("ZDEP"))
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestDeps")
    db.add(proj); db.commit(); db.refresh(proj)
    obj = models.Object(project_id=proj.id, object_name="ZDEP", object_type="PROG")
    db.add(obj); db.commit(); db.refresh(obj)
    try:
        count = await provider.import_dependencies(proj.id, obj.id, "PROG", "ZDEP", db)
        assert count == 1
        deps = db.query(models.ObjectDependency).filter(models.ObjectDependency.source_object_id == obj.id).all()
        assert len(deps) == 1
        d = deps[0]
        assert d.target_object_name == "ZFI_GET_VENDOR"
        assert d.relationship_type == "CALLS_FUNCTION"
        assert d.confidence == "EXACT"
        assert d.dynamic is False
        assert d.provider == "NCOREIQ"
        assert d.line_no == 42
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# P. Local/upstream job correlation
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_p_job_correlation():
    store = NCoreIQJobStore()
    local_id = store.create("upstream-job-abc", 1, 5, ["ZPKG"])
    job = store.get(local_id)
    assert job["localJobId"] == local_id
    assert job["upstreamJobId"] == "upstream-job-abc"
    assert job["objectsRequested"] == 5
    assert job["status"] == "RUNNING"


@pytest.mark.asyncio
async def test_p_extraction_job_creation():
    created = {"job_id": "upstream-xyz", "status": "QUEUED", "stage": None,
               "created_at": "2026-10-12T00:00:00Z", "status_url": "http://ncoreiq/jobs/xyz"}
    client = NCoreIQClient("http://localhost:8000")
    client._post = AsyncMock(return_value=created)
    store = NCoreIQJobStore()
    provider = NCoreIQSourceProvider(client, store)
    objects = [{"sap_object_type": "PROG", "object_name": f"ZPROG_{i}"} for i in range(25)]
    local_id, upstream_id = await provider.start_extraction_job_import(1, objects, ["ZPKG"])
    assert upstream_id == "upstream-xyz"
    job = store.get(local_id)
    assert job["upstreamJobId"] == "upstream-xyz"
    # Verify create_extraction_job sent source_max_lines=None (complete source)
    call_body = client._post.call_args[0][1]
    assert call_body["extraction"]["source_max_lines"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# Q. Safe error redaction
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_q_safe_error_redaction():
    """NCoreIQError must never contain tokens or credentials."""
    err = NCoreIQError(401, "UNAUTHORIZED", "Auth required")
    assert "Bearer" not in str(err)
    assert "secret" not in str(err).lower()
    assert "token" not in str(err).lower()
    assert "password" not in str(err).lower()


@pytest.mark.asyncio
async def test_q_connection_failure_safe():
    client = NCoreIQClient("http://localhost:8000")
    client._get = AsyncMock(side_effect=NCoreIQUnavailableError())
    provider, _ = make_provider(client)
    result = await provider.test_connection()
    assert result["connected"] is False
    assert result.get("error") is not None
    assert "token" not in (result.get("error") or "").lower()


# ═══════════════════════════════════════════════════════════════════════════════
# R. Explicit refresh does not destroy previous evidence
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_r_refresh_creates_new_version():
    client = NCoreIQClient("http://localhost:8000")
    v1_source = make_source_response(5, "ZREFRESH")
    v2_source = make_source_response(7, "ZREFRESH")
    call_count = {"n": 0}

    async def mock_get(path, params=None, timeout=30.0):
        if "metadata" in path:
            return make_metadata_response("ZREFRESH")
        call_count["n"] += 1
        return v1_source if call_count["n"] <= 1 else v2_source
    client._get = mock_get
    provider, _ = make_provider(client)
    db = TestSession()
    proj = models.Project(name="TestRefresh")
    db.add(proj); db.commit(); db.refresh(proj)
    try:
        # First import — version 1
        id1 = await provider.import_object(proj.id, "PROG", "ZREFRESH", "Program", "", db, "http://localhost:8000")
        obj1 = db.query(models.Object).filter(models.Object.id == id1).first()
        assert obj1.object_version == 1
        assert obj1.is_latest_version is True

        # Add an analysis result to force new version on refresh
        ar = models.Analysis(project_id=proj.id)
        db.add(ar); db.commit(); db.refresh(ar)
        result = models.ObjectAnalysisResult(analysis_id=ar.id, object_id=id1)
        db.add(result); db.commit()

        # Explicit refresh — version 2
        id2 = await provider.import_object(
            proj.id, "PROG", "ZREFRESH", "Program", "", db, "http://localhost:8000", refresh=True
        )
        db.refresh(obj1)  # reload from DB

        assert id2 is not None
        assert id2 != id1

        # v1 still in DB — source code preserved for reproducibility
        old = db.query(models.Object).filter(models.Object.id == id1).first()
        assert old is not None
        assert old.source_code is not None
        assert old.is_latest_version is False
        assert old.object_version == 1

        # v2 is the new canonical version
        new = db.query(models.Object).filter(models.Object.id == id2).first()
        assert new.is_latest_version is True
        assert new.object_version == 2
        assert new.parent_object_id == id1
        assert new.lines_of_code == 7
    finally:
        db.close()
