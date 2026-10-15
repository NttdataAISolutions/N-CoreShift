"""
N-CoreShift NCoreIQSourceProvider (Python runtime)
Business logic for connected SAP source ingestion via N-CoreIQ.
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy.orm import Session

from integrations.ncoreiq_client import ARTIFACT_MAX_BYTES, NCoreIQClient, NCoreIQError
from models import Object, ObjectDependency, Project

logger = logging.getLogger(__name__)

NCOREIQ_DIRECT_IMPORT_LIMIT: int = int(os.getenv("NCOREIQ_DIRECT_IMPORT_LIMIT", "20"))
_CONTRACT_VERSION = "v1"
_ARTIFACT_MAX_OBJECTS = 10_000
_JSON_CONTENT_TYPES = ("application/json", "text/plain")


class NCoreIQJobStore:
    """In-memory import job store. CLASSIFICATION: CERTIFICATION_ONLY"""

    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}

    def create(self, upstream_job_id, project_id, objects_requested, packages):
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
            "resultSummary": None,
            "resultStatus": None,
            "warnings": [],
            "artifactStatus": None,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "completedAt": None,
        }
        return local_id

    def update(self, local_id, **kwargs):
        if local_id in self._jobs:
            self._jobs[local_id].update(kwargs)

    def get(self, local_id):
        return self._jobs.get(local_id)

    def set_status(self, local_id, status):
        if local_id in self._jobs:
            self._jobs[local_id]["status"] = status
            if status in ("COMPLETED", "PARTIAL", "FAILED", "CANCELLED"):
                self._jobs[local_id]["completedAt"] = datetime.now(timezone.utc).isoformat()


_job_store = NCoreIQJobStore()


def get_job_store() -> NCoreIQJobStore:
    return _job_store


def extract_source_text(source_data: Dict[str, Any]) -> str:
    components = source_data.get("components", [])
    all_lines: List[str] = []
    for component in components:
        lines = sorted(component.get("lines", []), key=lambda l: l.get("line_no", 0))
        for line in lines:
            all_lines.append(line.get("source_line", ""))
    return "\n".join(all_lines)


def compute_source_hash(source_text: str) -> str:
    return hashlib.sha256(source_text.encode("utf-8")).hexdigest()


def get_source_hash(source_data: Dict[str, Any], source_text: str) -> Tuple[str, bool]:
    ncoreiq_hash = source_data.get("sha256", "").strip()
    if ncoreiq_hash:
        return ncoreiq_hash, True
    return compute_source_hash(source_text), False



class NCoreIQSourceProvider:
    """Source provider for connected SAP ingestion via N-CoreIQ."""

    def __init__(self, client: NCoreIQClient, job_store=None):
        self._client = client
        self._job_store = job_store or get_job_store()

    async def test_connection(self):
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
                "connected": False, "sourceProvider": "NCOREIQ",
                "systemId": None, "client": None, "sapRelease": None,
                "upstreamConnectionState": None, "error": str(exc),
            }
        except Exception as exc:
            logger.warning("Unexpected error in test_connection: %s", type(exc).__name__)
            return {
                "connected": False, "sourceProvider": "NCOREIQ",
                "systemId": None, "client": None, "sapRelease": None,
                "upstreamConnectionState": None, "error": "N-CoreIQ is unavailable",
            }

    async def list_packages(self, package, include_subpackages=True):
        data = await self._client.list_packages(package, include_subpackages=include_subpackages)
        return {"packages": data.get("packages", []), "root_package": data.get("root_package")}

    async def preview_objects(self, packages, include_subpackages=True, max_results=200):
        data = await self._client.search_objects(
            packages, include_subpackages=include_subpackages, max_results=max_results
        )
        return {
            "objects": data.get("objects", []),
            "statistics": data.get("statistics", {}),
            "truncated": data.get("truncated", False),
        }

    @staticmethod
    def resolve_or_create_project(project_name, db):
        proj = db.query(Project).filter(Project.name == project_name).first()
        if proj:
            return proj.id
        new_proj = Project(name=project_name, description="Auto-created via N-CoreIQ import")
        db.add(new_proj)
        db.commit()
        db.refresh(new_proj)
        return new_proj.id

    async def import_object(self, project_id, obj_type, obj_name, friendly_type,
                             package, db, ncoreiq_base_url, refresh=False):
        """
        Import a single SAP object from N-CoreIQ via individual API calls.
        Complete source (no max_lines). Truncated source is rejected.
        Returns new object_id, or None on failure.
        """
        try:
            source_data = await self._client.get_source(obj_type, obj_name)
        except NCoreIQError as exc:
            logger.warning("Failed to fetch source for %s/%s: %s", obj_type, obj_name, exc)
            return None
        if source_data.get("truncated"):
            logger.warning("Source for %s/%s is truncated — rejecting", obj_type, obj_name)
            return None
        source_text = extract_source_text(source_data)
        lines_of_code = source_data.get("returned_lines", 0)
        source_hash, ncoreiq_hash_provided = get_source_hash(source_data, source_text)
        retrieved_at = datetime.now(timezone.utc).isoformat()
        sap_sid = source_data.get("system_id", "")
        sap_client = source_data.get("client", "")
        sap_release = ""
        try:
            meta = await self._client.get_metadata(obj_type, obj_name)
            sap_release = meta.get("sap_release", "")
            if not package:
                package = meta.get("package", "")
        except NCoreIQError:
            pass
        return self._persist_object(
            project_id=project_id, obj_type=obj_type, obj_name=obj_name,
            friendly_type=friendly_type, package=package, source_text=source_text,
            lines_of_code=lines_of_code, source_hash=source_hash,
            ncoreiq_hash_provided=ncoreiq_hash_provided,
            source_sha256=source_data.get("sha256", ""), sap_sid=sap_sid,
            sap_client=sap_client, sap_release=sap_release,
            ncoreiq_base_url=ncoreiq_base_url, retrieved_at=retrieved_at,
            refresh=refresh, db=db,
        )

    @staticmethod
    def _build_metadata_json(sap_sid, sap_client, sap_release, ncoreiq_base_url,
                              ncoreiq_sha256, ncoreiq_hash_provided, retrieved_at,
                              version, refreshed_from_id):
        return json.dumps({
            "provider": "NCOREIQ", "contract_version": _CONTRACT_VERSION,
            "sap_sid": sap_sid, "sap_client": sap_client, "sap_release": sap_release,
            "ncoreiq_base_url": ncoreiq_base_url, "ncoreiq_sha256": ncoreiq_sha256,
            "ncoreiq_hash_provided": ncoreiq_hash_provided, "retrieved_at": retrieved_at,
            "object_version": version, "refreshed_from_id": refreshed_from_id,
        })

    def _persist_object(self, project_id, obj_type, obj_name, friendly_type, package,
                        source_text, lines_of_code, source_hash, ncoreiq_hash_provided,
                        source_sha256, sap_sid, sap_client, sap_release,
                        ncoreiq_base_url, retrieved_at, refresh, db):
        """Shared persistence for direct-import and artifact-import paths. Never logs source."""
        existing = (
            db.query(Object)
            .filter(
                Object.project_id == project_id,
                Object.object_name == obj_name,
                Object.is_latest_version == True,  # noqa: E712
            ).first()
        )
        if existing and not refresh:
            has_analyses = len(existing.analysis_results) > 0
            if not has_analyses:
                existing.source_code = source_text
                existing.lines_of_code = lines_of_code
                existing.source_code_version = source_hash
                existing.package = package or existing.package
                existing.object_type = friendly_type or existing.object_type
                existing.provider = "NCOREIQ"
                existing.ncoreiq_metadata_json = self._build_metadata_json(
                    sap_sid, sap_client, sap_release, ncoreiq_base_url,
                    source_sha256, ncoreiq_hash_provided, retrieved_at,
                    existing.object_version, None,
                )
                db.commit()
                return existing.id
            refresh = True
        parent_id = None
        new_version = 1
        if existing and refresh:
            existing.is_latest_version = False
            db.flush()
            parent_id = existing.id
            new_version = (existing.object_version or 1) + 1
        ncoreiq_meta = self._build_metadata_json(
            sap_sid, sap_client, sap_release, ncoreiq_base_url,
            source_sha256, ncoreiq_hash_provided, retrieved_at, new_version, parent_id,
        )
        new_obj = Object(
            project_id=project_id, object_name=obj_name,
            object_type=friendly_type or obj_type, package=package,
            source_code=source_text, lines_of_code=lines_of_code,
            source_code_version=source_hash, provider="NCOREIQ",
            ncoreiq_metadata_json=ncoreiq_meta, object_version=new_version,
            is_latest_version=True, parent_object_id=parent_id,
        )
        db.add(new_obj)
        db.commit()
        db.refresh(new_obj)
        return new_obj.id

    async def import_dependencies(self, project_id, object_id, obj_type, obj_name, db):
        """Import direct dependencies via N-CoreIQ API. Returns count."""
        try:
            data = await self._client.get_dependencies(obj_type, obj_name)
        except NCoreIQError as exc:
            logger.warning("Failed to fetch deps for %s/%s: %s", obj_type, obj_name, exc)
            return 0
        return self._persist_dependencies(
            project_id, object_id, obj_type, obj_name,
            data.get("relationships", []), db,
        )

    @staticmethod
    def _persist_dependencies(project_id, object_id, obj_type, obj_name, relationships, db):
        """Shared dependency persistence for API and artifact paths."""
        imported = 0
        for rel in relationships:
            if not isinstance(rel, dict):
                continue
            target_name = rel.get("target_object_name", "")
            if not target_name:
                continue
            dep = ObjectDependency(
                project_id=project_id, source_object_id=object_id,
                source_object_name=obj_name, source_object_type=obj_type,
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

    async def start_direct_import(self, project_id, objects_to_import, ncoreiq_base_url,
                                   packages, db, include_dependencies=True):
        """Per-object direct import for small sets. Returns local job ID."""
        local_id = self._job_store.create(
            upstream_job_id=None, project_id=project_id,
            objects_requested=len(objects_to_import), packages=packages,
        )
        return local_id

    async def run_direct_import(self, local_job_id, project_id, objects_to_import,
                                 ncoreiq_base_url, include_dependencies=True):
        """Background task body for direct per-object import."""
        from database import SessionLocal
        db = SessionLocal()
        try:
            for obj in objects_to_import:
                obj_type = obj.get("sap_object_type", "PROG")
                obj_name = obj.get("object_name", "")
                if not obj_name:
                    cur = self._job_store.get(local_job_id)
                    self._job_store.update(local_job_id, objectsFailed=cur["objectsFailed"] + 1)
                    continue
                object_id = await self.import_object(
                    project_id, obj_type, obj_name,
                    obj.get("friendly_type", obj_type), obj.get("package", ""),
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
                            pass
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

    async def _import_object_from_artifact_data(
            self, project_id, obj_type, obj_name, package,
            source_data, metadata_data, ncoreiq_base_url, db):
        """
        Import a single object using pre-fetched data from the artifact.
        Reuses _persist_object() -- no live N-CoreIQ API calls are made.
        Truncated source is rejected. Source evidence is NEVER logged.
        Returns object_id or None on failure.
        """
        if not source_data or not isinstance(source_data, dict):
            logger.warning("Artifact object %s/%s has no source data", obj_type, obj_name)
            return None
        if source_data.get("truncated"):
            logger.warning("Artifact source for %s/%s is truncated -- rejecting", obj_type, obj_name)
            return None
        source_text = extract_source_text(source_data)
        lines_of_code = source_data.get("returned_lines", 0)
        source_hash, ncoreiq_hash_provided = get_source_hash(source_data, source_text)
        retrieved_at = datetime.now(timezone.utc).isoformat()
        sap_sid = source_data.get("system_id", "")
        sap_client = source_data.get("client", "")
        sap_release = ""
        if metadata_data and isinstance(metadata_data, dict):
            sap_release = metadata_data.get("sap_release", "")
            if not package:
                package = metadata_data.get("package", "") or ""
        return self._persist_object(
            project_id=project_id, obj_type=obj_type, obj_name=obj_name,
            friendly_type=obj_type, package=package, source_text=source_text,
            lines_of_code=lines_of_code, source_hash=source_hash,
            ncoreiq_hash_provided=ncoreiq_hash_provided,
            source_sha256=source_data.get("sha256", ""), sap_sid=sap_sid,
            sap_client=sap_client, sap_release=sap_release,
            ncoreiq_base_url=ncoreiq_base_url, retrieved_at=retrieved_at,
            refresh=False, db=db,
        )

    async def _process_json_artifact(
            self, local_job_id, artifact_bytes, content_type,
            project_id, ncoreiq_base_url, db):
        """
        Parse a JSON artifact and import all successfully extracted objects.

        Artifact JSON format (derived from contract types in agent/src/ncoreiq/types.ts):
          {
            "extraction_id": "...",
            "objects": [
              {
                "sap_object_type": "PROG", "object_name": "ZPROG_1", "package": "ZTEST",
                "success": true, "error_message": null,
                "metadata": { <RepositoryObjectMetadata> },
                "source":   { <RepositoryObjectSource with components[]> },
                "dependencies": { <DirectDependenciesResponse with relationships[]> }
              }
            ]
          }

        Rejects: non-JSON content type, malformed JSON, missing objects array,
        oversized object count. Source evidence is NEVER logged.
        """
        ct_lower = (content_type or "").lower().split(";")[0].strip()
        if not any(ct_lower.startswith(jct) for jct in _JSON_CONTENT_TYPES):
            raise ValueError(
                f"Unsupported artifact content-type: {content_type!r}. Expected application/json."
            )
        try:
            payload = json.loads(artifact_bytes.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            # Do NOT log artifact_bytes -- may contain source evidence
            raise ValueError(f"Artifact JSON parse error: {type(exc).__name__}") from exc
        if not isinstance(payload, dict):
            raise ValueError("Artifact root must be a JSON object")
        objects = payload.get("objects")
        if not isinstance(objects, list):
            raise ValueError("Artifact missing required 'objects' array -- invalid schema")
        if len(objects) > _ARTIFACT_MAX_OBJECTS:
            raise ValueError(
                f"Artifact object count {len(objects)} exceeds limit {_ARTIFACT_MAX_OBJECTS}"
            )
        for art_obj in objects:
            if not isinstance(art_obj, dict):
                cur = self._job_store.get(local_job_id)
                self._job_store.update(local_job_id, objectsFailed=cur["objectsFailed"] + 1)
                continue
            if not art_obj.get("success", False):
                cur = self._job_store.get(local_job_id)
                self._job_store.update(local_job_id, objectsFailed=cur["objectsFailed"] + 1)
                continue
            obj_type = art_obj.get("sap_object_type", "PROG")
            obj_name = art_obj.get("object_name", "")
            if not obj_name:
                cur = self._job_store.get(local_job_id)
                self._job_store.update(local_job_id, objectsFailed=cur["objectsFailed"] + 1)
                continue
            object_id = await self._import_object_from_artifact_data(
                project_id=project_id,
                obj_type=obj_type, obj_name=obj_name,
                package=art_obj.get("package", ""),
                source_data=art_obj.get("source"),
                metadata_data=art_obj.get("metadata"),
                ncoreiq_base_url=ncoreiq_base_url, db=db,
            )
            cur = self._job_store.get(local_job_id)
            if object_id:
                self._job_store.update(local_job_id, objectsImported=cur["objectsImported"] + 1)
                deps_data = art_obj.get("dependencies")
                if deps_data and isinstance(deps_data, dict):
                    try:
                        rels = deps_data.get("relationships", [])
                        if isinstance(rels, list):
                            self._persist_dependencies(
                                project_id, object_id, obj_type, obj_name, rels, db
                            )
                    except Exception:
                        pass
            else:
                self._job_store.update(local_job_id, objectsFailed=cur["objectsFailed"] + 1)

    async def start_extraction_job_import(self, project_id, objects_to_import, packages):
        """Start N-CoreIQ async extraction job. Returns (local_job_id, upstream_job_id)."""
        extraction_objects = [
            {"object_type": o.get("sap_object_type", "PROG"), "object_name": o.get("object_name", "")}
            for o in objects_to_import if o.get("object_name")
        ]
        result = await self._client.create_extraction_job(
            extraction_objects, source_max_lines=None
        )
        upstream_job_id = result.get("job_id", str(uuid4()))
        local_id = self._job_store.create(
            upstream_job_id=upstream_job_id, project_id=project_id,
            objects_requested=len(extraction_objects), packages=packages,
        )
        return local_id, upstream_job_id

    async def poll_extraction_job(self, local_job_id, ncoreiq_base_url, db):
        """
        Poll N-CoreIQ extraction job status and process completed artifact.

        Job completion semantics (certified contract):
          SUCCEEDED + COMPLETED            -> artifact processed
          SUCCEEDED + COMPLETED_WITH_ERRORS -> artifact processed; partial result
          SUCCEEDED + FAILED               -> no artifact imported as successful result
          FAILED / CANCELLED               -> set local status accordingly

        Summary consumed from result_data["summary"] (certified contract).
        result_data["results"] is NEVER used -- absent from certified contract.
        """
        job = self._job_store.get(local_job_id)
        if not job:
            return {"error": "JOB_NOT_FOUND"}
        upstream_id = job.get("upstreamJobId")
        if not upstream_id:
            return job

        status_data = await self._client.get_job_status(upstream_id)
        upstream_status = status_data.get("status", "RUNNING")

        if upstream_status == "SUCCEEDED":
            # 1. Retrieve result -- certified contract requires summary field
            try:
                result_data = await self._client.get_job_result(upstream_id)
            except NCoreIQError as exc:
                logger.error("Failed to retrieve job result: %s", type(exc).__name__)
                errors = list((self._job_store.get(local_job_id) or {}).get("errors", []))
                errors.append(f"Result retrieval failed: {type(exc).__name__}")
                self._job_store.update(local_job_id, errors=errors)
                self._job_store.set_status(local_job_id, "FAILED")
                return self._job_store.get(local_job_id)

            # 2. Validate summary -- NEVER fall back to results[]
            summary = result_data.get("summary")
            if not summary or not isinstance(summary, dict):
                logger.error(
                    "Job result missing required summary field -- failing closed "
                    "(legacy results[] is not accepted by this consumer)"
                )
                errors = list((self._job_store.get(local_job_id) or {}).get("errors", []))
                errors.append("Result summary missing or invalid")
                self._job_store.update(local_job_id, errors=errors)
                self._job_store.set_status(local_job_id, "FAILED")
                return self._job_store.get(local_job_id)

            result_status = summary.get("status", "")
            if not result_status:
                logger.error("Summary missing status field")
                errors = list((self._job_store.get(local_job_id) or {}).get("errors", []))
                errors.append("Summary status field missing")
                self._job_store.update(local_job_id, errors=errors)
                self._job_store.set_status(local_job_id, "FAILED")
                return self._job_store.get(local_job_id)

            # 3. Sanitize warnings -- never treat as executable content
            raw_warnings = summary.get("warnings", [])
            safe_warnings = [
                str(w)[:500]
                for w in (raw_warnings if isinstance(raw_warnings, list) else [])
                if w is not None
            ]
            self._job_store.update(
                local_job_id,
                resultSummary=summary,
                resultStatus=result_status,
                warnings=safe_warnings,
                objectsRequested=summary.get(
                    "requested_object_count", job.get("objectsRequested", 0)
                ),
            )

            # 4. FAILED result_status -- do not import any artifact evidence
            if result_status == "FAILED":
                logger.warning("Extraction result_status=FAILED -- no artifact imported")
                self._job_store.set_status(local_job_id, "FAILED")
                return self._job_store.get(local_job_id)

            # 5. COMPLETED or COMPLETED_WITH_ERRORS -- download and process artifact
            if result_status in ("COMPLETED", "COMPLETED_WITH_ERRORS"):
                try:
                    artifact_bytes, content_type = await self._client.get_job_artifact(upstream_id)
                    self._job_store.update(local_job_id, artifactStatus="DOWNLOADED")
                except (NCoreIQError, ValueError) as exc:
                    logger.error("Artifact download failed: %s", type(exc).__name__)
                    errors = list((self._job_store.get(local_job_id) or {}).get("errors", []))
                    errors.append(f"Artifact download failed: {type(exc).__name__}")
                    self._job_store.update(local_job_id, errors=errors, artifactStatus="FAILED")
                    self._job_store.set_status(local_job_id, "FAILED")
                    return self._job_store.get(local_job_id)

                try:
                    await self._process_json_artifact(
                        local_job_id, artifact_bytes, content_type,
                        job["projectId"], ncoreiq_base_url, db,
                    )
                    self._job_store.update(local_job_id, artifactStatus="IMPORTED")
                except Exception as exc:
                    logger.error("Artifact processing failed: %s", type(exc).__name__)
                    errors = list((self._job_store.get(local_job_id) or {}).get("errors", []))
                    errors.append(f"Artifact processing failed: {type(exc).__name__}")
                    self._job_store.update(local_job_id, errors=errors, artifactStatus="FAILED")
                    self._job_store.set_status(local_job_id, "FAILED")
                    return self._job_store.get(local_job_id)

            # 6. Determine final local status
            cur = self._job_store.get(local_job_id)
            if result_status == "COMPLETED_WITH_ERRORS":
                # Partial evidence -- never report as fully complete
                if cur["objectsImported"] > 0:
                    self._job_store.set_status(local_job_id, "PARTIAL")
                else:
                    self._job_store.set_status(local_job_id, "FAILED")
            elif result_status == "COMPLETED":
                if cur["objectsFailed"] == 0:
                    self._job_store.set_status(local_job_id, "COMPLETED")
                elif cur["objectsImported"] == 0:
                    self._job_store.set_status(local_job_id, "FAILED")
                else:
                    self._job_store.set_status(local_job_id, "PARTIAL")

        elif upstream_status in ("FAILED", "CANCELLED"):
            self._job_store.set_status(local_job_id, upstream_status)

        return self._job_store.get(local_job_id)

    def get_job_status(self, local_job_id):
        """Return current job state."""
        return self._job_store.get(local_job_id)
