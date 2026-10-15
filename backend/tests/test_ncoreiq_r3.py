"""
N-CoreShift Gate 0E10-R3 Tests: N-CoreIQ consumer contract remediation.
Tests S-AB: summary contract, no results[], artifact retrieval, complete success,
COMPLETED_WITH_ERRORS, FAILED result, missing summary, malformed artifact,
no source logging, direct import regression.
"""
import hashlib, json, logging, os, sys
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import models
from database import Base

TEST_DB_URL = "sqlite://"
_eng = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
Base.metadata.create_all(bind=_eng)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=_eng)

from integrations.ncoreiq_client import (
    ARTIFACT_MAX_BYTES, NCoreIQClient, NCoreIQError, NCoreIQTimeoutError,
)
from providers.ncoreiq_source_provider import (
    NCoreIQJobStore, NCoreIQSourceProvider,
    _ARTIFACT_MAX_OBJECTS, extract_source_text,
)

def _client():
    return NCoreIQClient("http://localhost:8000")

def _provider(client=None):
    store = NCoreIQJobStore()
    c = client or _client()
    return NCoreIQSourceProvider(c, store), store

def _succeeded():
    return {"job_id": "j1", "status": "SUCCEEDED", "stage": None,
            "progress": None, "artifact": None,
            "created_at": "2026-10-15T00:00:00Z",
            "started_at": "2026-10-15T00:00:01Z",
            "completed_at": "2026-10-15T00:01:00Z"}

def _summary(st="COMPLETED", req=1, proc=1, succ=1, part=0,
             fail=0, skip=0, trunc=0, warn=None):
    return {"extraction_id": "e1", "status": st, "selection": {},
            "requested_object_count": req, "processed_object_count": proc,
            "successful_object_count": succ, "partial_object_count": part,
            "failed_object_count": fail, "skipped_object_count": skip,
            "truncated_object_count": trunc, "duration_ms": 1200,
            "metadata_enabled": True, "source_enabled": True,
            "warnings": warn or []}

def _result(summary):
    return {"job_id": "j1", "status": "SUCCEEDED", "summary": summary}

def _src(name="ZPROG_1", n=3):
    lines = [{"component_type": "PROGRAM", "component_name": name,
              "line_no": i+1, "source_line": f"* L{i+1}"} for i in range(n)]
    txt = "\n".join(l["source_line"] for l in lines)
    sha = hashlib.sha256(txt.encode()).hexdigest()
    return {"sap_object_type": "PROG", "object_name": name,
            "system_id": "NC1", "client": "800",
            "max_lines": None, "returned_lines": n,
            "found": True, "truncated": False, "message": None, "sha256": sha,
            "components": [{"component_type": "PROGRAM", "component_name": name,
                             "line_count": n, "source_text": txt, "lines": lines}]}

def _meta(name="ZPROG_1"):
    return {"sap_object_type": "PROG", "object_name": name,
            "system_id": "NC1", "client": "800", "pgmid": "R3TR",
            "package": "ZPKG", "author": "DEV",
            "created_date": "20230115", "changed_by": "DEV",
            "changed_date": "20261015", "description": "Test",
            "active_status": "A", "found": True, "warning": None,
            "message": None, "object_subtype": None, "program_name": None,
            "function_group": None, "table_class": None,
            "master_language": "EN", "source_system": None, "sap_release": "752"}

def _deps(name="ZPROG_1"):
    return {"system_id": "NC1", "client": "800",
            "source_object_type": "PROG", "source_object_name": name,
            "total_relations": 1, "returned_relations": 1,
            "truncated": False, "message": None,
            "relationships": [{"relation_id": 1, "system_id": "NC1", "client": "800",
                                "source_object_type": "PROG", "source_object_name": name,
                                "target_object_type": "FUNC", "target_object_name": "ZFI_CALL",
                                "relationship_type": "CALLS_FUNCTION", "confidence": "EXACT",
                                "evidence_source": "ABAP_PARSER",
                                "source_component": "PROG__ZPROG_1",
                                "line_no": 10, "dynamic": False, "detail": None}]}

def _artifact(objs=None):
    if objs is None:
        objs = [{"sap_object_type": "PROG", "object_name": "ZPROG_1",
                 "package": "ZPKG", "success": True, "error_message": None,
                 "metadata": _meta("ZPROG_1"), "source": _src("ZPROG_1"),
                 "dependencies": _deps("ZPROG_1")}]
    return json.dumps({"extraction_id": "e1", "objects": objs}).encode()

def _new_proj(db, name):
    p = models.Project(name=name)
    db.add(p); db.commit(); db.refresh(p)
    return p


# S — Summary contract consumed
@pytest.mark.asyncio
async def test_s_summary_accepted():
    """Consumer accepts result_data["summary"] — certified contract."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(_summary()))
    c.get_job_artifact = AsyncMock(return_value=(_artifact(), "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "SummaryAccepted")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["resultSummary"] is not None
        assert r["resultSummary"]["status"] == "COMPLETED"
        assert r["resultSummary"]["requested_object_count"] == 1
        assert r["status"] == "COMPLETED"
    finally:
        db.close()

@pytest.mark.asyncio
async def test_s_summary_fields_stored():
    """All certified summary fields stored in job state."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(
        _summary(req=5, proc=5, succ=4, part=1)
    ))
    c.get_job_artifact = AsyncMock(return_value=(_artifact(), "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "SummaryFields")
    lid = store.create("j1", proj.id, 5, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        s = r["resultSummary"]
        assert s["extraction_id"] == "e1"
        assert s["requested_object_count"] == 5
        assert s["successful_object_count"] == 4
        assert s["partial_object_count"] == 1
        assert s["metadata_enabled"] is True
        assert s["source_enabled"] is True
    finally:
        db.close()

# T — Legacy results[] absent (regression guard)
@pytest.mark.asyncio
async def test_t_no_results_key_required():
    """results[] key absent in certified contract — consumer must not require it."""
    c = _client()
    result_resp = {"job_id": "j1", "status": "SUCCEEDED", "summary": _summary()}
    assert "results" not in result_resp
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=result_resp)
    c.get_job_artifact = AsyncMock(return_value=(_artifact(), "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "NoResultsKey")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "COMPLETED"
    finally:
        db.close()

@pytest.mark.asyncio
async def test_t_results_present_but_ignored():
    """Even if results[] is present, summary drives behavior."""
    c = _client()
    result_resp = {"job_id": "j1", "status": "SUCCEEDED",
                   "summary": _summary(),
                   "results": [{"object_type": "PROG", "object_name": "ZPROG_OLD",
                                 "success": True}]}
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=result_resp)
    c.get_job_artifact = AsyncMock(return_value=(_artifact(), "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "ResultsIgnored")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "COMPLETED"
    finally:
        db.close()


# U — Artifact retrieval
@pytest.mark.asyncio
async def test_u_artifact_correct_endpoint():
    """get_job_artifact uses certified endpoint path."""
    from integrations.ncoreiq_client import JOB_ARTIFACT_PATH
    expected = "/api/v1/repository/jobs/test-job/artifact"
    assert JOB_ARTIFACT_PATH.format(job_id="test-job") == expected

@pytest.mark.asyncio
async def test_u_artifact_uses_analyst_auth_flow():
    """Artifact download uses same bearer-token flow as other client methods."""
    import httpx
    calls = []
    async def mock_get(url, headers=None):
        calls.append({"url": url, "headers": headers or {}})
        class R:
            status_code = 200
            content = _artifact()
            def raise_for_status(self): pass
            def headers_get(self, k): return {"content-type": "application/json"}.get(k, "")
        r = R()
        r.headers = type("H", (), {"get": lambda self, k, d="": {"content-type": "application/json"}.get(k, d)})()
        return r
    c = NCoreIQClient("http://localhost:8000", bearer_token="test-tok")
    import unittest.mock as um
    with um.patch("httpx.AsyncClient") as MockClient:
        mock_client_instance = um.AsyncMock()
        MockClient.return_value.__aenter__ = um.AsyncMock(return_value=mock_client_instance)
        MockClient.return_value.__aexit__ = um.AsyncMock(return_value=False)
        mock_resp = um.MagicMock()
        mock_resp.raise_for_status = um.MagicMock()
        mock_resp.content = _artifact()
        mock_resp.headers = {"content-type": "application/json"}
        mock_client_instance.get = um.AsyncMock(return_value=mock_resp)
        body, ct = await c.get_job_artifact("job-u1")
        assert mock_client_instance.get.called
        call_kwargs = mock_client_instance.get.call_args
        url_arg = call_kwargs[0][0] if call_kwargs[0] else call_kwargs[1].get("url", "")
        assert "/artifact" in url_arg
        headers_arg = call_kwargs[1].get("headers", {}) or (call_kwargs[0][1] if len(call_kwargs[0]) > 1 else {})
        assert "Authorization" in str(headers_arg)

@pytest.mark.asyncio
async def test_u_artifact_error_propagated():
    """Artifact download NCoreIQError is propagated to caller."""
    c = _client()
    c.get_job_artifact = AsyncMock(side_effect=NCoreIQError(404, "NOT_FOUND", "No artifact"))
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(_summary()))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "ArtifactError")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
        assert r["artifactStatus"] == "FAILED"
        assert any("Artifact download" in e for e in r["errors"])
    finally:
        db.close()

@pytest.mark.asyncio
async def test_u_artifact_content_type_validated():
    """Unsupported content-type raises ValueError -> job FAILED."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(_summary()))
    c.get_job_artifact = AsyncMock(return_value=(b"<html/>", "text/html"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "BadContentType")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
    finally:
        db.close()

# V — Complete success (Section 19)
@pytest.mark.asyncio
async def test_v_complete_success():
    """SUCCEEDED + COMPLETED: summary consumed, artifact processed, object imported."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(
        _summary("COMPLETED", req=1, proc=1, succ=1, fail=0)
    ))
    c.get_job_artifact = AsyncMock(return_value=(_artifact(), "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "CompleteSuccess")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "COMPLETED"
        assert r["objectsImported"] == 1
        assert r["objectsFailed"] == 0
        assert r["resultSummary"]["status"] == "COMPLETED"
        # Verify object was persisted
        obj = db.query(models.Object).filter(
            models.Object.project_id == proj.id,
            models.Object.object_name == "ZPROG_1"
        ).first()
        assert obj is not None
        assert obj.provider == "NCOREIQ"
        # Verify dependency was persisted
        deps = db.query(models.ObjectDependency).filter(
            models.ObjectDependency.source_object_id == obj.id
        ).all()
        assert len(deps) == 1
        assert deps[0].target_object_name == "ZFI_CALL"
    finally:
        db.close()


# W — COMPLETED_WITH_ERRORS (Section 20)
@pytest.mark.asyncio
async def test_w_completed_with_errors_partial():
    """COMPLETED_WITH_ERRORS: summary retained, warnings sanitized, PARTIAL status."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(
        _summary("COMPLETED_WITH_ERRORS", req=2, proc=2, succ=1, part=0,
                 fail=1, warn=["Object ZPROG_2 failed: source not found"])
    ))
    c.get_job_artifact = AsyncMock(return_value=(_artifact(), "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "WithErrors")
    lid = store.create("j1", proj.id, 2, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "PARTIAL"
        assert r["resultStatus"] == "COMPLETED_WITH_ERRORS"
        assert len(r["warnings"]) == 1
        assert "Object ZPROG_2" in r["warnings"][0]
        assert r["objectsImported"] >= 1
        # Must NOT report as fully complete
        assert r["status"] != "COMPLETED"
    finally:
        db.close()

@pytest.mark.asyncio
async def test_w_warnings_sanitized():
    """Warnings are sanitized to string[:500] — not treated as executable content."""
    c = _client()
    long_warning = "W" * 1000
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(
        _summary("COMPLETED_WITH_ERRORS", warn=[long_warning])
    ))
    c.get_job_artifact = AsyncMock(return_value=(_artifact(), "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "WarningSanitized")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert len(r["warnings"]) == 1
        assert len(r["warnings"][0]) == 500

    finally:
        db.close()

# X — FAILED result (Section 21)
@pytest.mark.asyncio
async def test_x_failed_result_no_artifact():
    """result_status=FAILED: no artifact imported, sanitized failure, no silent success."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(_summary("FAILED")))
    c.get_job_artifact = AsyncMock()  # must NOT be called
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "FailedResult")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
        assert r["objectsImported"] == 0
        # Artifact download must NOT have been called
        c.get_job_artifact.assert_not_called()
    finally:
        db.close()

@pytest.mark.asyncio
async def test_x_upstream_failed_no_artifact():
    """upstream status=FAILED: job set FAILED, no artifact processing."""
    c = _client()
    c.get_job_status = AsyncMock(return_value={
        "job_id": "j1", "status": "FAILED", "stage": None,
        "progress": None, "artifact": None,
        "created_at": "2026-10-15T00:00:00Z", "started_at": None,
        "completed_at": "2026-10-15T00:01:00Z"
    })
    c.get_job_result = AsyncMock()
    c.get_job_artifact = AsyncMock()
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "UpstreamFailed")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
        c.get_job_result.assert_not_called()
        c.get_job_artifact.assert_not_called()
    finally:
        db.close()

# Y — Missing summary (Section 22)
@pytest.mark.asyncio
async def test_y_missing_summary_fails_closed():
    """Result without summary must fail closed. Must NOT fall back to results[]."""
    c = _client()
    result_without_summary = {
        "job_id": "j1", "status": "SUCCEEDED",
        "results": [{"object_type": "PROG", "object_name": "ZPROG_1", "success": True}]
    }
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=result_without_summary)
    c.get_job_artifact = AsyncMock()
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "MissingSummary")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
        assert r["objectsImported"] == 0
        c.get_job_artifact.assert_not_called()
        assert any("summary" in e.lower() for e in r["errors"])
    finally:
        db.close()

@pytest.mark.asyncio
async def test_y_null_summary_fails_closed():
    """Null summary must fail closed."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value={"job_id": "j1",
                                                "status": "SUCCEEDED",
                                                "summary": None})
    c.get_job_artifact = AsyncMock()
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "NullSummary")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
        c.get_job_artifact.assert_not_called()
    finally:
        db.close()

# Z — Malformed artifact (Section 23)
@pytest.mark.asyncio
async def test_z_invalid_json_rejected():
    """Invalid JSON artifact fails closed."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(_summary()))
    c.get_job_artifact = AsyncMock(return_value=(b"not-json{{{{", "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "InvalidJson")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
        assert r["objectsImported"] == 0
    finally:
        db.close()

@pytest.mark.asyncio
async def test_z_missing_objects_key_rejected():
    """JSON artifact without objects array fails closed."""
    c = _client()
    bad_payload = json.dumps({"extraction_id": "e1", "summary": {}}).encode()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(_summary()))
    c.get_job_artifact = AsyncMock(return_value=(bad_payload, "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "MissingObjects")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
    finally:
        db.close()

@pytest.mark.asyncio
async def test_z_root_not_object_rejected():
    """Artifact root that is not a dict fails closed."""
    c = _client()
    c.get_job_status = AsyncMock(return_value=_succeeded())
    c.get_job_result = AsyncMock(return_value=_result(_summary()))
    c.get_job_artifact = AsyncMock(return_value=(b"[1,2,3]", "application/json"))
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "RootArray")
    lid = store.create("j1", proj.id, 1, ["ZPKG"])
    try:
        r = await prov.poll_extraction_job(lid, "http://localhost:8000", db)
        assert r["status"] == "FAILED"
    finally:
        db.close()

@pytest.mark.asyncio
async def test_z_oversized_artifact_rejected():
    """Artifact exceeding ARTIFACT_MAX_BYTES is rejected by client."""
    c = _client()
    import unittest.mock as um
    with um.patch("httpx.AsyncClient") as MockClient:
        mock_ci = um.AsyncMock()
        MockClient.return_value.__aenter__ = um.AsyncMock(return_value=mock_ci)
        MockClient.return_value.__aexit__ = um.AsyncMock(return_value=False)
        mock_resp = um.MagicMock()
        mock_resp.raise_for_status = um.MagicMock()
        mock_resp.content = b"x" * (ARTIFACT_MAX_BYTES + 1)
        mock_resp.headers = um.MagicMock()
        mock_resp.headers.get = lambda k, d="": None
        mock_ci.get = um.AsyncMock(return_value=mock_resp)
        try:
            await c.get_job_artifact("job-big")
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "exceeds limit" in str(e).lower() or "size" in str(e).lower()


# AA — No source logging (Section 24)
def test_aa_no_source_logging_on_artifact_parse_error():
    """Source/evidence bodies must NOT appear in log output during parse errors."""
    import io, logging as lg
    handler = lg.StreamHandler(io.StringIO())
    handler.setLevel(lg.DEBUG)
    prov_logger = lg.getLogger("providers.ncoreiq_source_provider")
    prov_logger.addHandler(handler)
    try:
        source_evidence = "SENSITIVE_SOURCE_CODE_DO_NOT_LOG"
        bad_payload = json.dumps({
            "objects": [{"sap_object_type": "PROG", "object_name": "ZPROG_1",
                          "success": True, "source": {"source_text": source_evidence}}]
        }).encode()
        import asyncio
        prov, store = _provider()
        db = TestSession()
        proj = _new_proj(db, "NoLogTest")
        lid = store.create("j1", proj.id, 1, ["ZPKG"])
        try:
            # Simulate artifact with source evidence that should NOT be logged
            asyncio.get_event_loop().run_until_complete(
                prov._process_json_artifact(lid, bad_payload, "application/json",
                                             proj.id, "http://localhost:8000", db)
            )
        except Exception:
            pass
        finally:
            db.close()
        log_output = handler.stream.getvalue()
        assert source_evidence not in log_output, (
            "Source evidence appeared in logs — SECURITY VIOLATION"
        )
    finally:
        prov_logger.removeHandler(handler)

def test_aa_no_token_in_client_error_messages():
    """NCoreIQError must never contain token values."""
    from integrations.ncoreiq_client import NCoreIQError
    err = NCoreIQError(401, "UNAUTHORIZED", "Auth required")
    assert "Bearer" not in str(err)
    assert "token" not in str(err).lower()
    assert "secret" not in str(err).lower()

# AB — Direct import regression (Section 25)
@pytest.mark.asyncio
async def test_ab_direct_import_not_regressed():
    """run_direct_import still works correctly (no regression from extraction job changes)."""
    import unittest.mock as um
    c = _client()
    async def mock_get(path, params=None, timeout=30.0):
        if "metadata" in path:
            return _meta("ZPROG_AB")
        return _src("ZPROG_AB")
    c._get = mock_get
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "DirectImportAB")
    db.close()
    lid = store.create(None, proj.id, 1, ["ZPKG"])
    with um.patch("database.SessionLocal", new=TestSession):
        await prov.run_direct_import(
            lid, proj.id,
            [{"sap_object_type": "PROG", "object_name": "ZPROG_AB",
              "friendly_type": "Program", "package": "ZPKG"}],
            "http://localhost:8000",
            include_dependencies=False,
        )
    job = store.get(lid)
    assert job["status"] == "COMPLETED"
    assert job["objectsImported"] == 1
    db2 = TestSession()
    try:
        obj = db2.query(models.Object).filter(
            models.Object.project_id == proj.id,
            models.Object.object_name == "ZPROG_AB"
        ).first()
        assert obj is not None
        assert obj.provider == "NCOREIQ"
    finally:
        db2.close()

@pytest.mark.asyncio
async def test_ab_direct_import_partial_failure():
    """run_direct_import handles partial failure correctly."""
    import unittest.mock as um
    c = _client()
    call_count = {"n": 0}
    async def mock_get(path, params=None, timeout=30.0):
        call_count["n"] += 1
        if "ZPROG_FAIL" in path:
            raise NCoreIQError(503, "SAP_UNAVAILABLE", "SAP down")
        if "metadata" in path:
            return _meta("ZPROG_OK")
        return _src("ZPROG_OK")
    c._get = mock_get
    prov, store = _provider(c)
    db = TestSession()
    proj = _new_proj(db, "DirectImportPartial")
    db.close()
    lid = store.create(None, proj.id, 2, ["ZPKG"])
    with um.patch("database.SessionLocal", new=TestSession):
        await prov.run_direct_import(
            lid, proj.id,
            [{"sap_object_type": "PROG", "object_name": "ZPROG_OK",
              "friendly_type": "Program", "package": "ZPKG"},
             {"sap_object_type": "PROG", "object_name": "ZPROG_FAIL",
              "friendly_type": "Program", "package": "ZPKG"}],
            "http://localhost:8000",
        )
    job = store.get(lid)
    assert job["status"] == "PARTIAL"
    assert job["objectsImported"] == 1
    assert job["objectsFailed"] == 1
