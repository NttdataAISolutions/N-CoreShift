"""
N-CoreShift — NCoreIQSourceProvider (Python runtime)

Business logic for connected SAP source ingestion via N-CoreIQ.

Responsibilities:
  - connection test
  - package discovery
  - object preview (no source download)
  - individual object import (metadata + complete source + deps)
  - versioned refresh (creates new Object row; does not overwrite existing evidence)
  - dependency import → ObjectDependency table
  - bulk import strategy:
      objects ≤ NCOREIQ_DIRECT_IMPORT_LIMIT → per-object direct fetch
      objects > NCOREIQ_DIRECT_IMPORT_LIMIT → N-CoreIQ async extraction job

Import threshold:
  NCOREIQ_DIRECT_IMPORT_LIMIT = 20  (configurable via env var)
  Objects above this count use POST /api/v1/repository/jobs (async extraction).
  The threshold avoids sending many individual requests for large packages
  while keeping small explicit-object imports simple and synchronous.

Architecture decision (B.2):
  Python = CURRENT runtime adapter
  TypeScript NCoreIQSourceProvider = FUTURE agent/domain adapter
  Both use the same contract. Neither performs Clean Core decisioning.
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy.orm import Session

from integrations.ncoreiq_client import NCoreIQClient, NCoreIQError
from models import Object, ObjectDependency, Project

logger = logging.getLogger(__name__)

# ── Direct import threshold ────────────────────────────────────────────────────
# Objects ≤ this → per-object direct fetch (synchronous, low overhead)
# Objects > this → N-CoreIQ async extraction job (POST /api/v1/repository/jobs)
# Configurable via NCOREIQ_DIRECT_IMPORT_LIMIT env var.
NCOREIQ_DIRECT_IMPORT_LIMIT: int = int(
    os.getenv("NCOREIQ_DIRECT_IMPORT_LIMIT", "20")
)

# Contract version embedded in evidence provenance
_CONTRACT_VERSION = "v1"


# ── Job store abstraction ──────────────────────────────────────────────────────

class NCoreIQJobStore:
    """
    In-memory import job store.

    LOCAL DEVELOPMENT ONLY.
    Replace with persistent store (database table or BTP Job Scheduling Service)
    before deploying to a stateless production environment.

    The abstraction isolates job-state management from router and provider logic.
    """

    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def create(self, upstream_job_id: Optional[str],
               project_id: int,
               objects_requested: int,
               packages: List[str]) -> str:
        local_id = str(uuid4())
        self._jobs[local_id] = {
            "localJobId": local_id,
            "upstreamJobId": upstream_job_id,
            "projectId": project_id,
            "requestedPackages": packages,
            "status": "RUNNING",
            "objectsRequested": objects_requested,
            "objectsImported": 0,
            "objectsFailed": 0,
            "errors": [],
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "completedAt": None,
        }
        return local_id

    def update(self, local_id: str, **kwargs: Any) -> None:
        if local_id in self._jobs:
            self._jobs[local_id].update(kwargs)

    def get(self, local_id: str) -> Optional[Dict[str, Any]]:
        return self._jobs.get(local_id)

    def set_status(self, local_id: str, status: str) -> None:
        if local_id in self._jobs:
            self._jobs[local_id]["status"] = status
            if status in ("COMPLETED", "PARTIAL", "FAILED", "CANCELLED"):
                self._jobs[local_id]["completedAt"] = datetime.now(timezone.utc).isoformat()


# Singleton job store (per-process, local dev only)
_job_store = NCoreIQJobStore()


def get_job_store() -> NCoreIQJobStore:
    """Return the process-level job store. Replace with persistent store in production."""
    return _job_store


# ── Source text helpers ────────────────────────────────────────────────────────

def extract_source_text(source_data: Dict[str, Any]) -> str:
    """
    Extract canonical source text from N-CoreIQ RepositoryObjectSource.
    Joins all component lines in component order, within each component in
    line_no order, separated by newline.
    Matches Section 8 SHA-256 canonical algorithm.
    """
    components = source_data.get("components", [])
    all_lines: List[str] = []
    for component in components:
        lines = sorted(component.get("lines", []), key=lambda l: l.get("line_no", 0))
        for line in lines:
            all_lines.append(line.get("source_line", ""))
    return "\n".join(all_lines)


def compute_source_hash(source_text: str) -> str:
    """
    SHA-256(source_text.encode('utf-8')) — canonical algorithm from contract Section 8.
    Used when N-CoreIQ does not provide sha256.
    """
    return hashlib.sha256(source_text.encode("utf-8")).hexdigest()


def get_source_hash(source_data: Dict[str, Any], source_text: str) -> Tuple[str, bool]:
    """
    Return (hash_hex, ncoreiq_provided).
    If N-CoreIQ provided sha256, use it directly (ncoreiq_provided=True).
    Otherwise compute locally (ncoreiq_provided=False).
    """
    ncoreiq_hash = source_data.get("sha256", "").strip()
    if ncoreiq_hash:
        return ncoreiq_hash, True
    return compute_source_hash(source_text), False


# ── NCoreIQSourceProvider ─────────────────────────────────────────────────────

class NCoreIQSourceProvider:
    """
    Source provider for connected SAP ingestion via N-CoreIQ.

    The provider is the sole place where N-CoreIQ business logic lives.
    The router calls this provider; it does not own N-CoreIQ HTTP mechanics.

    A technical dependency imported here is EVIDENCE only.
    It is not a Clean Core disposition.
    """

    def __init__(self, client: NCoreIQClient, job_store: Optional[NCoreIQJobStore] = None):
        self._client = client
        self._job_store = job_store or get_job_store()

    # ── Connection test ───────────────────────────────────────────────────────

    async def test_connection(self) -> Dict[str, Any]:
        """
        Test N-CoreIQ → SAP connectivity.
        Returns normalized result. Never exposes credentials or tokens.
        """
        try:
            data = await self._client.ping()
            return {
                "connected": data.get("status") == "connected",
                "sourceProvider": "NCOREIQ",
                "systemId": data.get("system_id"),
                "client": data.get("client"),
                "sapRelease": data.get("sap_release"),
                "upstreamConnectionState": data.get("status"),
                "error": None if data.get("status") == "connected" else data.get("message"),
            }
        except NCoreIQError as exc:
            return {
                "connected": False,
                "sourceProvider": "NCOREIQ",
                "systemId": None,
                "client": None,
                "sapRelease": None,
                "upstreamConnectionState": None,
                "error": str(exc),
            }
        except Exception as exc:
            logger.warning("Unexpected error in test_connection: %s", type(exc).__name__)
            return {
                "connected": False,
                "sourceProvider": "NCOREIQ",
                "systemId": None, "client": None, "sapRelease": None,
                "upstreamConnectionState": None,
                "error": "N-CoreIQ is unavailable",
            }

    # ── Package discovery ─────────────────────────────────────────────────────

    async def list_packages(self, package: str,
                             include_subpackages: bool = True) -> Dict[str, Any]:
        data = await self._client.list_packages(package, include_subpackages=include_subpackages)
        return {"packages": data.get("packages", []), "root_package": data.get("root_package")}

    # ── Object preview ────────────────────────────────────────────────────────

    async def preview_objects(self, packages: List[str],
                               include_subpackages: bool = True,
                               max_results: int = 200) -> Dict[str, Any]:
        """Search for objects — does NOT download source. Efficient preview."""
        data = await self._client.search_objects(
            packages, include_subpackages=include_subpackages, max_results=max_results
        )
        return {
            "objects": data.get("objects", []),
            "statistics": data.get("statistics", {}),
            "truncated": data.get("truncated", False),
        }

    # ── Resolve or create project ─────────────────────────────────────────────

    @staticmethod
    def resolve_or_create_project(project_name: str, db: Session) -> int:
        proj = db.query(Project).filter(Project.name == project_name).first()
        if proj:
            return proj.id
        new_proj = Project(name=project_name, description="Auto-created via N-CoreIQ import")
        db.add(new_proj)
        db.commit()
        db.refresh(new_proj)
        return new_proj.id

    # ── Individual object import ──────────────────────────────────────────────

    async def import_object(
        self,
        project_id: int,
        obj_type: str,
        obj_name: str,
        friendly_type: str,
        package: str,
        db: Session,
        ncoreiq_base_url: str,
        refresh: bool = False,
    ) -> Optional[int]:
        """
        Import a single SAP object from N-CoreIQ.

        Complete source (no max_lines). Truncated source is rejected.
        Persists N-CoreIQ provenance in ncoreiq_metadata_json.

        Versioning:
          - First import: creates Object row (object_version=1, is_latest_version=True).
          - Explicit refresh: creates NEW Object row (object_version=N+1),
            marks previous version is_latest_version=False.
            Previous source_code is preserved for reproducibility.
          - NOT refresh (re-import same object): if existing row has NO analysis
            results, it is updated in-place (safe — no evidence to preserve).
            If it has analysis results, treat as refresh (create new version).

        Returns the new object_id, or None on failure.
        """
        # Fetch complete source — NO max_lines
        try:
            source_data = await self._client.get_source(obj_type, obj_name)
        except NCoreIQError as exc:
            logger.warning("Failed to fetch source for %s/%s: %s", obj_type, obj_name, exc)
            return None

        if source_data.get("truncated"):
            logger.warning("Source for %s/%s is truncated — rejecting (complete source required)", obj_type, obj_name)
            return None

        source_text = extract_source_text(source_data)
        lines_of_code = source_data.get("returned_lines", 0)
        source_hash, ncoreiq_hash_provided = get_source_hash(source_data, source_text)
        retrieved_at = datetime.now(timezone.utc).isoformat()

        # Fetch metadata for SAP provenance
        sap_sid = source_data.get("system_id", "")
        sap_client = source_data.get("client", "")
        sap_release = ""
        try:
            meta = await self._client.get_metadata(obj_type, obj_name)
            sap_release = meta.get("sap_release", "")
            if not package:
                package = meta.get("package", "")
        except NCoreIQError:
            pass  # metadata failure does not prevent source import

        # Check for existing version
        existing = (
            db.query(Object)
            .filter(
                Object.project_id == project_id,
                Object.object_name == obj_name,
                Object.is_latest_version == True,  # noqa: E712
            )
            .first()
        )

        if existing and not refresh:
            # Has analysis results? → treat as implicit refresh
            has_analyses = len(existing.analysis_results) > 0
            if not has_analyses:
                # Safe to update in-place (no evidence to preserve)
                existing.source_code = source_text
                existing.lines_of_code = lines_of_code
                existing.source_code_version = source_hash
                existing.package = package or existing.package
                existing.object_type = friendly_type or existing.object_type
                existing.provider = "NCOREIQ"
                existing.ncoreiq_metadata_json = self._build_metadata_json(
                    sap_sid, sap_client, sap_release, ncoreiq_base_url,
                    source_data.get("sha256", ""), ncoreiq_hash_provided,
                    retrieved_at, existing.object_version, None,
                )
                db.commit()
                return existing.id

            # Has analyses → create new version
            refresh = True

        parent_id: Optional[int] = None
        new_version: int = 1

        if existing and refresh:
            # Mark existing as superseded — NEVER DELETE source_code
            existing.is_latest_version = False
            db.flush()
            parent_id = existing.id
            new_version = (existing.object_version or 1) + 1

        ncoreiq_meta = self._build_metadata_json(
            sap_sid, sap_client, sap_release, ncoreiq_base_url,
            source_data.get("sha256", ""), ncoreiq_hash_provided,
            retrieved_at, new_version, parent_id,
        )

        new_obj = Object(
            project_id=project_id,
            object_name=obj_name,
            object_type=friendly_type or obj_type,
            package=package,
            source_code=source_text,
            lines_of_code=lines_of_code,
            source_code_version=source_hash,
            provider="NCOREIQ",
            ncoreiq_metadata_json=ncoreiq_meta,
            object_version=new_version,
            is_latest_version=True,
            parent_object_id=parent_id,
        )
        db.add(new_obj)
        db.commit()
        db.refresh(new_obj)
        return new_obj.id

    @staticmethod
    def _build_metadata_json(
        sap_sid: str, sap_client: str, sap_release: str,
        ncoreiq_base_url: str, ncoreiq_sha256: str, ncoreiq_hash_provided: bool,
        retrieved_at: str, version: int, refreshed_from_id: Optional[int],
    ) -> str:
        return json.dumps({
            "provider": "NCOREIQ",
            "contract_version": _CONTRACT_VERSION,
            "sap_sid": sap_sid,
            "sap_client": sap_client,
            "sap_release": sap_release,
            "ncoreiq_base_url": ncoreiq_base_url,
            "ncoreiq_sha256": ncoreiq_sha256,
            "ncoreiq_hash_provided": ncoreiq_hash_provided,
            "retrieved_at": retrieved_at,
            "object_version": version,
            "refreshed_from_id": refreshed_from_id,
        })

    # ── Dependency import ─────────────────────────────────────────────────────

    async def import_dependencies(
        self, project_id: int, object_id: int,
        obj_type: str, obj_name: str, db: Session,
    ) -> int:
        """
        Import direct dependencies for an object.
        Dependencies are EVIDENCE only — not Clean Core verdicts.
        Returns count of imported dependency records.
        """
        try:
            data = await self._client.get_dependencies(obj_type, obj_name)
        except NCoreIQError as exc:
            logger.warning("Failed to fetch dependencies for %s/%s: %s", obj_type, obj_name, exc)
            return 0

        relationships = data.get("relationships", [])
        imported = 0
        for rel in relationships:
            target_name = rel.get("target_object_name", "")
            if not target_name:
                continue
            dep = ObjectDependency(
                project_id=project_id,
                source_object_id=object_id,
                source_object_name=obj_name,
                source_object_type=obj_type,
                target_object_name=target_name,
                target_object_type=rel.get("target_object_type", ""),
                relationship_type=rel.get("relationship_type", ""),
                confidence=rel.get("confidence", ""),
                evidence_source=rel.get("evidence_source", ""),
                source_component=rel.get("source_component", ""),
                line_no=rel.get("line_no"),
                dynamic=bool(rel.get("dynamic", False)),
                provider="NCOREIQ",
            )
            db.add(dep)
            imported += 1
        if imported:
            db.commit()
        return imported

    # ── Bulk import (direct path: ≤ NCOREIQ_DIRECT_IMPORT_LIMIT objects) ──────

    async def start_direct_import(
        self,
        project_id: int,
        objects_to_import: List[Dict[str, Any]],
        ncoreiq_base_url: str,
        packages: List[str],
        db: Session,
        include_dependencies: bool = True,
    ) -> str:
        """
        Per-object direct import for small object sets (≤ NCOREIQ_DIRECT_IMPORT_LIMIT).
        Runs as a background task. Returns local job ID.
        """
        local_id = self._job_store.create(
            upstream_job_id=None,
            project_id=project_id,
            objects_requested=len(objects_to_import),
            packages=packages,
        )
        # Caller must run _run_direct_import as a background task
        return local_id

    async def run_direct_import(
        self,
        local_job_id: str,
        project_id: int,
        objects_to_import: List[Dict[str, Any]],
        ncoreiq_base_url: str,
        include_dependencies: bool = True,
    ) -> None:
        """Background task body for direct per-object import."""
        from database import SessionLocal
        db = SessionLocal()
        try:
            for obj in objects_to_import:
                obj_type = obj.get("sap_object_type", "PROG")
                obj_name = obj.get("object_name", "")
                if not obj_name:
                    self._job_store.update(local_job_id, objectsFailed=self._job_store.get(local_job_id)["objectsFailed"] + 1)
                    continue
                object_id = await self.import_object(
                    project_id, obj_type, obj_name,
                    obj.get("friendly_type", obj_type),
                    obj.get("package", ""),
                    db, ncoreiq_base_url,
                )
                job = self._job_store.get(local_job_id)
                if object_id is None:
                    self._job_store.update(local_job_id, objectsFailed=job["objectsFailed"] + 1)
                    errors = job["errors"]
                    errors.append(f"{obj_name}: import failed")
                    self._job_store.update(local_job_id, errors=errors)
                else:
                    self._job_store.update(local_job_id, objectsImported=job["objectsImported"] + 1)
                    if include_dependencies:
                        try:
                            await self.import_dependencies(project_id, object_id, obj_type, obj_name, db)
                        except Exception:
                            pass  # dependency failure does not fail the object import

            job = self._job_store.get(local_job_id)
            if job["objectsFailed"] == 0:
                self._job_store.set_status(local_job_id, "COMPLETED")
            elif job["objectsImported"] == 0:
                self._job_store.set_status(local_job_id, "FAILED")
            else:
                self._job_store.set_status(local_job_id, "PARTIAL")
        except Exception as exc:
            logger.error("Direct import task %s failed: %s", local_job_id, type(exc).__name__)
            self._job_store.set_status(local_job_id, "FAILED")
        finally:
            db.close()

    # ── Bulk import (extraction job path: > NCOREIQ_DIRECT_IMPORT_LIMIT) ─────

    async def start_extraction_job_import(
        self,
        project_id: int,
        objects_to_import: List[Dict[str, Any]],
        packages: List[str],
    ) -> Tuple[str, str]:
        """
        Start N-CoreIQ async extraction job for large imports.
        Returns (local_job_id, upstream_job_id).
        """
        extraction_objects = [
            {"object_type": o.get("sap_object_type", "PROG"), "object_name": o.get("object_name", "")}
            for o in objects_to_import if o.get("object_name")
        ]
        result = await self._client.create_extraction_job(
            extraction_objects, source_max_lines=None  # complete source
        )
        upstream_job_id = result.get("job_id", str(uuid4()))
        local_id = self._job_store.create(
            upstream_job_id=upstream_job_id,
            project_id=project_id,
            objects_requested=len(extraction_objects),
            packages=packages,
        )
        return local_id, upstream_job_id

    async def poll_extraction_job(
        self,
        local_job_id: str,
        ncoreiq_base_url: str,
        db: Session,
    ) -> Dict[str, Any]:
        """
        Poll N-CoreIQ extraction job status and import completed objects.
        Call this from a background polling task.
        """
        job = self._job_store.get(local_job_id)
        if not job:
            return {"error": "JOB_NOT_FOUND"}

        upstream_id = job.get("upstreamJobId")
        if not upstream_id:
            return job

        status_data = await self._client.get_job_status(upstream_id)
        upstream_status = status_data.get("status", "RUNNING")

        if upstream_status in ("SUCCEEDED",):
            # Retrieve result and import objects
            try:
                result_data = await self._client.get_job_result(upstream_id)
                succeeded_objects = [
                    r for r in result_data.get("results", []) if r.get("success")
                ]
                for obj_result in succeeded_objects:
                    obj_type = obj_result.get("object_type", "PROG")
                    obj_name = obj_result.get("object_name", "")
                    if obj_name:
                        object_id = await self.import_object(
                            job["projectId"], obj_type, obj_name,
                            obj_type, "", db, ncoreiq_base_url,
                        )
                        cur = self._job_store.get(local_job_id)
                        if object_id:
                            self._job_store.update(local_job_id, objectsImported=cur["objectsImported"] + 1)
                            try:
                                await self.import_dependencies(job["projectId"], object_id, obj_type, obj_name, db)
                            except Exception:
                                pass
                        else:
                            self._job_store.update(local_job_id, objectsFailed=cur["objectsFailed"] + 1)
            except Exception as exc:
                logger.error("Failed to import extraction job results: %s", type(exc).__name__)
                self._job_store.set_status(local_job_id, "FAILED")
                return self._job_store.get(local_job_id)

            cur = self._job_store.get(local_job_id)
            if cur["objectsFailed"] == 0:
                self._job_store.set_status(local_job_id, "COMPLETED")
            elif cur["objectsImported"] == 0:
                self._job_store.set_status(local_job_id, "FAILED")
            else:
                self._job_store.set_status(local_job_id, "PARTIAL")

        elif upstream_status in ("FAILED", "CANCELLED"):
            self._job_store.set_status(local_job_id, upstream_status)

        return self._job_store.get(local_job_id)

    def get_job_status(self, local_job_id: str) -> Optional[Dict[str, Any]]:
        """Return current job state."""
        return self._job_store.get(local_job_id)
