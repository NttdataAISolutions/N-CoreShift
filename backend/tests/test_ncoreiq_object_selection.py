"""
N-CoreShift Gate 0E10-AUTH-R2D-SELECT1 Tests
Explicit object selection for N-CoreIQ imports.

Tests A-G as specified in the gate:
A. One explicitly selected object -> exactly one authoritative object reaches the provider.
B. Multiple explicitly selected objects -> exactly N reach the provider.
C. Empty explicit selection ([]) -> validation failure, zero imports.
D. Tampered/out-of-package object -> rejected, zero imports.
E. Stale/missing selected object (existed earlier, not in current authoritative
   search) -> rejected, no package-wide fallback.
F. Legacy package-wide request (objects omitted) -> existing behavior preserved.
G. Strategy threshold unaffected by explicit selection (direct vs extraction-job).

All N-CoreIQ HTTP calls and provider internals are mocked -- no live
N-CoreIQ/SAP connectivity required. The FastAPI TestClient exercises the
actual router code path (start_import()).
"""

import os
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from database import Base, get_db
from routers import ncoreiq as ncoreiq_router_module

# -- In-memory SQLite test DB ------------------------------------------------
# StaticPool is required here (unlike some other test modules in this repo)
# because starlette's TestClient dispatches requests through an anyio
# worker thread. A plain "sqlite://" engine without StaticPool hands out a
# fresh, empty in-memory database per thread/connection, which would make
# the "projects" table invisible to the request thread. StaticPool pins
# all checkouts to a single shared connection so the schema created below
# is visible to every request handled by the TestClient.

TEST_DB_URL = "sqlite://"
_engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
Base.metadata.create_all(bind=_engine)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


def _override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _make_search_objects(count: int, prefix: str = "ZPROG"):
    return [
        {
            "sap_object_type": "PROG",
            "friendly_type": "Program",
            "object_name": f"{prefix}_{i}",
            "package": "ZTEST",
            "description": f"Object {i}",
        }
        for i in range(count)
    ]


class _FakeProvider:
    """
    Minimal fake provider used to isolate router-level selection logic from
    NCoreIQClient/XSUAA. preview_objects() returns a fixed authoritative
    search result; start_direct_import / start_extraction_job_import record
    the objects_to_import they actually receive for assertions.
    """

    def __init__(self, authoritative_objects):
        self._authoritative_objects = authoritative_objects
        self.received_direct_objects = None
        self.received_extraction_objects = None
        self.strategy_used = None

    async def preview_objects(self, packages, include_subpackages=True, max_results=200):
        return {"objects": self._authoritative_objects, "statistics": {}, "truncated": False}

    @staticmethod
    def resolve_or_create_project(project_name, db):
        proj = db.query(models.Project).filter(models.Project.name == project_name).first()
        if proj:
            return proj.id
        new_proj = models.Project(name=project_name)
        db.add(new_proj)
        db.commit()
        db.refresh(new_proj)
        return new_proj.id

    async def start_direct_import(self, project_id, objects_to_import, base_url, packages, db):
        self.received_direct_objects = objects_to_import
        self.strategy_used = "DIRECT"
        return "local-job-direct-1"

    async def run_direct_import(self, local_id, project_id, objects_to_import, base_url):
        pass

    async def start_extraction_job_import(self, project_id, objects_to_import, packages):
        self.received_extraction_objects = objects_to_import
        self.strategy_used = "EXTRACTION_JOB"
        return "local-job-extraction-1", "upstream-job-1"


def _make_app(fake_provider: _FakeProvider) -> FastAPI:
    app = FastAPI()
    app.include_router(ncoreiq_router_module.router)
    app.dependency_overrides[get_db] = _override_get_db

    def _fake_make_provider(request_base_url=None):
        return fake_provider, "http://localhost:8000"

    app.state._provider_patch = patch.object(
        ncoreiq_router_module, "_make_provider", _fake_make_provider
    )
    app.state._provider_patch.start()
    return app


def _teardown_app(app: FastAPI):
    app.state._provider_patch.stop()


# ============================================================================
# A - One explicitly selected object
# ============================================================================


def test_a_one_explicit_object_reaches_provider():
    authoritative = _make_search_objects(5)
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestA",
                    "packages": ["ZTEST"],
                    "include_subpackages": True,
                    "objects": [{"sap_object_type": "PROG", "object_name": "ZPROG_0"}],
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["objectsRequested"] == 1
        assert fake.received_direct_objects is not None
        assert len(fake.received_direct_objects) == 1
        assert fake.received_direct_objects[0]["object_name"] == "ZPROG_0"
    finally:
        _teardown_app(app)


# ============================================================================
# B - Multiple explicitly selected objects
# ============================================================================


def test_b_multiple_explicit_objects_reach_provider():
    authoritative = _make_search_objects(10)
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        requested = [
            {"sap_object_type": "PROG", "object_name": f"ZPROG_{i}"} for i in (1, 3, 5, 7)
        ]
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestB",
                    "packages": ["ZTEST"],
                    "objects": requested,
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["objectsRequested"] == 4
        assert len(fake.received_direct_objects) == 4
        names = {o["object_name"] for o in fake.received_direct_objects}
        assert names == {"ZPROG_1", "ZPROG_3", "ZPROG_5", "ZPROG_7"}
    finally:
        _teardown_app(app)


# ============================================================================
# C - Empty explicit selection -> validation failure, zero imports
# ============================================================================


def test_c_empty_explicit_selection_rejected():
    authoritative = _make_search_objects(5)
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestC",
                    "packages": ["ZTEST"],
                    "objects": [],
                },
            )
        assert resp.status_code == 400
        detail = resp.json().get("detail", {})
        assert detail.get("error") == "EMPTY_OBJECT_SELECTION"
        # Provider must never have been asked to import anything
        assert fake.received_direct_objects is None
        assert fake.received_extraction_objects is None
    finally:
        _teardown_app(app)


# ============================================================================
# D - Tampered / out-of-package object -> rejected, zero imports
# ============================================================================


def test_d_tampered_object_rejected():
    authoritative = _make_search_objects(3)  # ZPROG_0, ZPROG_1, ZPROG_2
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestD",
                    "packages": ["ZTEST"],
                    "objects": [
                        {"sap_object_type": "PROG", "object_name": "ZPROG_0"},
                        # Not part of the authoritative search result:
                        {"sap_object_type": "PROG", "object_name": "ZPROG_TAMPERED"},
                    ],
                },
            )
        assert resp.status_code == 400
        detail = resp.json().get("detail", {})
        assert detail.get("error") == "OBJECT_SELECTION_INVALID"
        assert "ZPROG_TAMPERED" in detail.get("message", "")
        # Nothing must have reached the provider -- reject outright, no partial import
        assert fake.received_direct_objects is None
        assert fake.received_extraction_objects is None
    finally:
        _teardown_app(app)


# ============================================================================
# E - Stale/missing selected object -> rejected, no package-wide fallback
# ============================================================================


def test_e_stale_object_rejected_no_fallback():
    """
    Simulates an object that existed in an earlier preview but is no longer
    present in the authoritative (re-run) search at import time.
    """
    # Authoritative search no longer contains "ZPROG_STALE"
    authoritative = _make_search_objects(2)
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestE",
                    "packages": ["ZTEST"],
                    "objects": [
                        {"sap_object_type": "PROG", "object_name": "ZPROG_STALE"},
                    ],
                },
            )
        assert resp.status_code == 400
        detail = resp.json().get("detail", {})
        assert detail.get("error") == "OBJECT_SELECTION_INVALID"
        # Must NOT silently fall back to importing the whole package
        assert fake.received_direct_objects is None
        assert fake.received_extraction_objects is None
    finally:
        _teardown_app(app)


# ============================================================================
# F - Legacy package-wide request (objects omitted) -> unchanged behavior
# ============================================================================


def test_f_legacy_package_wide_request_preserved():
    authoritative = _make_search_objects(6)
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestF",
                    "packages": ["ZTEST"],
                    "include_subpackages": True,
                    # "objects" field intentionally omitted
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["objectsRequested"] == 6
        # All authoritative objects were passed through -- legacy behavior
        assert len(fake.received_direct_objects) == 6
    finally:
        _teardown_app(app)


# ============================================================================
# G - Strategy threshold unaffected by explicit selection
# ============================================================================


def test_g_strategy_threshold_direct_path_for_small_explicit_selection():
    from providers.ncoreiq_source_provider import NCOREIQ_DIRECT_IMPORT_LIMIT

    count = min(3, NCOREIQ_DIRECT_IMPORT_LIMIT)
    authoritative = _make_search_objects(max(count, 1) + 50)  # plenty in the package
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        requested = [
            {"sap_object_type": "PROG", "object_name": f"ZPROG_{i}"} for i in range(count)
        ]
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestG_Direct",
                    "packages": ["ZTEST"],
                    "objects": requested,
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["strategy"] == "DIRECT"
        assert fake.strategy_used == "DIRECT"
        assert fake.received_extraction_objects is None
        assert len(fake.received_direct_objects) == count
    finally:
        _teardown_app(app)


def test_g_strategy_threshold_extraction_job_path_for_large_explicit_selection():
    from providers.ncoreiq_source_provider import NCOREIQ_DIRECT_IMPORT_LIMIT

    count = NCOREIQ_DIRECT_IMPORT_LIMIT + 5
    authoritative = _make_search_objects(count)
    fake = _FakeProvider(authoritative)
    app = _make_app(fake)
    try:
        requested = [
            {"sap_object_type": "PROG", "object_name": f"ZPROG_{i}"} for i in range(count)
        ]
        with TestClient(app) as client:
            resp = client.post(
                "/api/ncoreiq/import",
                json={
                    "projectName": "TestG_Extraction",
                    "packages": ["ZTEST"],
                    "objects": requested,
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["strategy"] == "EXTRACTION_JOB"
        assert fake.strategy_used == "EXTRACTION_JOB"
        assert fake.received_direct_objects is None
        assert len(fake.received_extraction_objects) == count
        # Threshold value itself must be unchanged / unaffected by explicit selection
        assert body["threshold"] == NCOREIQ_DIRECT_IMPORT_LIMIT
    finally:
        _teardown_app(app)
