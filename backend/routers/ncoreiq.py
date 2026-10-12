"""
N-CoreShift — N-CoreIQ Router (orchestration only)

This router handles:
  - HTTP request validation and authorization context
  - Provider instantiation (using server-side configuration)
  - Delegating ALL N-CoreIQ logic to NCoreIQSourceProvider
  - Safe response mapping

N-CoreIQ HTTP mechanics live in: backend/integrations/ncoreiq_client.py
N-CoreIQ business logic lives in: backend/providers/ncoreiq_source_provider.py

Security:
  - NCOREIQ_BASE_URL read from server environment (request body only in dev/disabled mode)
  - Bearer tokens managed server-side (DEFERRED until BTP/XSUAA identity established)
  - Authorization headers NEVER forwarded to or from browser
  - Upstream errors normalized before returning to browser

SERVICE_TO_SERVICE_AUTH: DEFERRED UNTIL N-CORESHIFT BTP/XSUAA APPLICATION
IDENTITY IS ESTABLISHED.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from integrations.ncoreiq_client import NCoreIQClient, NCoreIQError, resolve_base_url
from providers.ncoreiq_source_provider import (
    NCOREIQ_DIRECT_IMPORT_LIMIT,
    NCoreIQSourceProvider,
    get_job_store,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ncoreiq", tags=["N-CoreIQ"])


# ── Provider factory ──────────────────────────────────────────────────────────

def _make_provider(request_base_url: Optional[str] = None) -> tuple[NCoreIQSourceProvider, str]:
    """
    Resolve base URL and create provider.
    Raises HTTP 503 when N-CoreIQ is not configured in a mode that requires it.
    """
    try:
        base_url = resolve_base_url(request_base_url)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": "NCOREIQ_NOT_CONFIGURED", "message": str(exc)})
    client = NCoreIQClient(base_url)
    provider = NCoreIQSourceProvider(client, get_job_store())
    return provider, base_url


def _safe_error_response(exc: NCoreIQError) -> HTTPException:
    """Map NCoreIQError to safe HTTP 502. Never exposes credentials."""
    return HTTPException(status_code=502, detail={"error": exc.error_code, "message": str(exc)})


# ── Request models ────────────────────────────────────────────────────────────

class PingRequest(BaseModel):
    baseUrl: Optional[str] = None


class PackagesRequest(BaseModel):
    baseUrl: Optional[str] = None
    package: str
    include_subpackages: bool = True


class PreviewRequest(BaseModel):
    baseUrl: Optional[str] = None
    packages: List[str]
    include_subpackages: bool = True
    max_results: int = 200


class ImportRequest(BaseModel):
    baseUrl: Optional[str] = None
    projectId: Optional[str] = None
    projectName: Optional[str] = None
    packages: List[str]
    include_subpackages: bool = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/ping")
async def ping(req: PingRequest):
    """Test N-CoreIQ → SAP connectivity. Returns connection status + SAP provenance."""
    provider, _ = _make_provider(req.baseUrl)
    return await provider.test_connection()


@router.post("/packages")
async def list_packages(req: PackagesRequest):
    """Discover package hierarchy from N-CoreIQ."""
    provider, _ = _make_provider(req.baseUrl)
    try:
        return await provider.list_packages(req.package, include_subpackages=req.include_subpackages)
    except NCoreIQError as exc:
        raise _safe_error_response(exc)


@router.post("/preview")
async def preview_objects(req: PreviewRequest):
    """Preview objects in selected packages — no source download."""
    provider, _ = _make_provider(req.baseUrl)
    try:
        return await provider.preview_objects(
            req.packages,
            include_subpackages=req.include_subpackages,
            max_results=req.max_results,
        )
    except NCoreIQError as exc:
        raise _safe_error_response(exc)


@router.post("/import")
async def start_import(
    req: ImportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Start an async import of all objects in selected packages.

    Import strategy (based on NCOREIQ_DIRECT_IMPORT_LIMIT = {limit}):
      objects ≤ {limit} → per-object direct fetch (background task)
      objects > {limit}  → N-CoreIQ async extraction job

    Returns immediately with jobId for polling.
    """
    provider, base_url = _make_provider(req.baseUrl)

    # Resolve project
    project_name = req.projectName or (f"N-CoreIQ Import {req.packages[0]}" if req.packages else "N-CoreIQ Import")
    project_id = NCoreIQSourceProvider.resolve_or_create_project(project_name, db)

    # Discover objects
    try:
        search_result = await provider.preview_objects(req.packages, include_subpackages=req.include_subpackages)
    except NCoreIQError as exc:
        raise _safe_error_response(exc)

    objects_to_import = search_result.get("objects", [])
    count = len(objects_to_import)

    if count == 0:
        return {"jobId": None, "status": "COMPLETED", "objectsRequested": 0, "message": "No objects found"}

    if count <= NCOREIQ_DIRECT_IMPORT_LIMIT:
        # Small import — per-object direct fetch
        local_id = await provider.start_direct_import(
            project_id, objects_to_import, base_url, req.packages, db
        )
        background_tasks.add_task(
            provider.run_direct_import,
            local_id, project_id, objects_to_import, base_url,
        )
        return {"jobId": local_id, "status": "RUNNING", "objectsRequested": count,
                "strategy": "DIRECT", "threshold": NCOREIQ_DIRECT_IMPORT_LIMIT}
    else:
        # Large import — N-CoreIQ async extraction job
        try:
            local_id, upstream_id = await provider.start_extraction_job_import(
                project_id, objects_to_import, req.packages
            )
        except NCoreIQError as exc:
            raise _safe_error_response(exc)
        return {"jobId": local_id, "upstreamJobId": upstream_id, "status": "RUNNING",
                "objectsRequested": count, "strategy": "EXTRACTION_JOB",
                "threshold": NCOREIQ_DIRECT_IMPORT_LIMIT}


# Make the docstring dynamic
start_import.__doc__ = start_import.__doc__.format(limit=NCOREIQ_DIRECT_IMPORT_LIMIT)


@router.get("/import/{job_id}/status")
async def get_import_status(job_id: str, db: Session = Depends(get_db)):
    """
    Poll import job status.
    For extraction jobs, also advances the upstream job if it has completed.
    """
    job_store = get_job_store()
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"error": "JOB_NOT_FOUND", "message": f"Job {job_id} not found"})

    # If this is an extraction job that is still RUNNING, poll N-CoreIQ
    upstream_id = job.get("upstreamJobId")
    if upstream_id and job.get("status") == "RUNNING":
        try:
            base_url = resolve_base_url()
        except ValueError:
            base_url = ""

        if base_url:
            provider, _ = _make_provider()
            try:
                job = await provider.poll_extraction_job(job_id, base_url, db)
            except NCoreIQError:
                pass  # Return current state on poll error

    return {
        "jobId": job_id,
        "status": job.get("status", "UNKNOWN"),
        "objectsImported": job.get("objectsImported", 0),
        "objectsFailed": job.get("objectsFailed", 0),
        "objectsRequested": job.get("objectsRequested", 0),
        "errors": (job.get("errors") or [])[:10],
        "upstreamJobId": job.get("upstreamJobId"),
    }
