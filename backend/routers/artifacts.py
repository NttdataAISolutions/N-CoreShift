from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db, SessionLocal
from models import Artifact, Plan, Object

import ai_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Artifacts"])


class ReviewBody(BaseModel):
    note: Optional[str] = ""
    reviewer: Optional[str] = "Consultant"


def artifact_to_dict(a: Artifact) -> dict:
    # Map generation_status to a display status
    status_map = {
        "Pending": "Generating",
        "Generated": "Pending Review",
        "Accepted": "Accepted",
        "Rejected": "Rejected",
        "Failed": "Failed",
    }
    display_status = status_map.get(a.generation_status, a.generation_status)

    obj = a.object
    plan = a.plan
    ar = plan.analysis_result if plan else None

    return {
        "id": a.id,
        "object_id": a.object_id,
        "object_name": obj.object_name if obj else "",
        "object_type": obj.object_type if obj else "",
        "plan_id": a.plan_id,
        "original_code": a.original_code or "",
        "generated_code": a.generated_code or "",
        "generation_status": a.generation_status,
        "display_status": display_status,
        "review_note": a.review_note or "",
        "reviewer": a.reviewer or "",
        "reviewed_at": a.reviewed_at.isoformat() if a.reviewed_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        # Traceability
        "analysis_result_id": plan.analysis_result_id if plan else None,
        "disposition": ar.disposition if ar else "",
        "risk_level": ar.risk_level if ar else "",
        "plan_approval_status": plan.approval_status if plan else "",
        # LLM metadata for this generation call
        "model_name": getattr(a, "model_name", "") or "",
        "prompt_version": getattr(a, "prompt_version", "") or "",
        "input_tokens": getattr(a, "input_tokens", 0) or 0,
        "output_tokens": getattr(a, "output_tokens", 0) or 0,
        "total_tokens": getattr(a, "total_tokens", 0) or 0,
        "estimated_total_cost_usd": getattr(a, "estimated_total_cost_usd", 0.0) or 0.0,
        "request_status": getattr(a, "request_status", "") or "",
    }


def _generate(artifact_id: int):
    db = SessionLocal()
    try:
        artifact = db.query(Artifact).filter(Artifact.id == artifact_id).first()
        if not artifact:
            return
        obj = db.query(Object).filter(Object.id == artifact.object_id).first()
        plan = db.query(Plan).filter(Plan.id == artifact.plan_id).first()
        if not obj or not plan:
            artifact.generation_status = "Failed"
            db.commit()
            return

        disposition = plan.analysis_result.disposition if plan.analysis_result else "Refactor"
        plan_summary = plan.plan_summary or ""
        try:
            result = ai_service.generate_code(
                object_name=obj.object_name,
                object_type=obj.object_type,
                disposition=disposition,
                modernization_plan=plan_summary,
                source_code=obj.source_code,
            )
            # generate_code may return a plain string or an enriched dict
            if isinstance(result, dict):
                artifact.generated_code = result.get("code", "")
                artifact.model_name = result.get("_model", "")
                artifact.prompt_version = result.get("_prompt_version", "")
                artifact.input_tokens = result.get("_input_tokens", 0)
                artifact.output_tokens = result.get("_output_tokens", 0)
                artifact.total_tokens = result.get("_total_tokens", 0)
                artifact.estimated_total_cost_usd = result.get("_total_cost_usd", 0.0)
                artifact.request_status = result.get("_request_status", "")
            else:
                artifact.generated_code = str(result)
                artifact.request_status = "ok"
            artifact.generation_status = "Generated"
            logger.info(
                "Artifact %d generated (tokens=%d, cost=$%.4f)",
                artifact_id,
                artifact.total_tokens or 0,
                artifact.estimated_total_cost_usd or 0.0,
            )
        except Exception as e:
            logger.error("Code generation error for artifact %d: %s", artifact_id, e)
            artifact.generation_status = "Failed"
            artifact.request_status = "error"
        db.commit()
    finally:
        db.close()


@router.get("/projects/{project_id}/artifacts")
def list_artifacts(project_id: int, db: Session = Depends(get_db)):
    objects = db.query(Object).filter(Object.project_id == project_id).all()
    obj_ids = [o.id for o in objects]
    artifacts = db.query(Artifact).filter(Artifact.object_id.in_(obj_ids)).all()
    return {"success": True, "data": [artifact_to_dict(a) for a in artifacts]}


@router.post("/plans/{plan_id}/artifacts", status_code=201)
def generate_artifact(plan_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # ── Approval gate ──────────────────────────────────────────────────────────
    if plan.approval_status != "Approved":
        raise HTTPException(
            status_code=403,
            detail=(
                f"Code generation requires an Approved plan "
                f"(current status: '{plan.approval_status}'). "
                "Please approve the plan first."
            ),
        )

    obj = db.query(Object).filter(Object.id == plan.object_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    artifact = Artifact(
        object_id=obj.id,
        plan_id=plan.id,
        original_code=obj.source_code,
        generation_status="Pending",
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)

    background_tasks.add_task(_generate, artifact.id)
    return {"success": True, "data": artifact_to_dict(artifact)}


@router.get("/artifacts/{artifact_id}")
def get_artifact(artifact_id: int, db: Session = Depends(get_db)):
    a = db.query(Artifact).filter(Artifact.id == artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return {"success": True, "data": artifact_to_dict(a)}


@router.put("/artifacts/{artifact_id}/accept")
def accept_artifact(artifact_id: int, body: ReviewBody = None, db: Session = Depends(get_db)):
    a = db.query(Artifact).filter(Artifact.id == artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if a.generation_status not in ("Generated", "Rejected"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot accept an artifact in '{a.generation_status}' state.",
        )
    a.generation_status = "Accepted"
    a.reviewer = (body.reviewer if body else None) or "Consultant"
    a.reviewed_at = datetime.utcnow()
    a.review_note = (body.note if body else None) or "Reviewed and approved."
    db.commit()
    db.refresh(a)
    return {"success": True, "data": artifact_to_dict(a)}


@router.put("/artifacts/{artifact_id}/reject")
def reject_artifact(artifact_id: int, body: ReviewBody = None, db: Session = Depends(get_db)):
    a = db.query(Artifact).filter(Artifact.id == artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if a.generation_status not in ("Generated", "Accepted"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject an artifact in '{a.generation_status}' state.",
        )
    a.generation_status = "Rejected"
    a.reviewer = (body.reviewer if body else None) or "Consultant"
    a.reviewed_at = datetime.utcnow()
    a.review_note = (body.note if body else None) or "Rejected by consultant."
    db.commit()
    db.refresh(a)
    return {"success": True, "data": artifact_to_dict(a)}


@router.get("/artifacts/{artifact_id}/download")
def download_artifact(artifact_id: int, db: Session = Depends(get_db)):
    a = db.query(Artifact).filter(Artifact.id == artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Artifact not found")
    code = a.generated_code or a.original_code or ""
    obj_name = a.object.object_name if a.object else f"artifact_{artifact_id}"
    obj_type = (a.object.object_type if a.object else "").lower()

    # Determine file extension based on object type
    if "typescript" in obj_type or "cap" in obj_type or "node" in obj_type:
        ext = "ts"
    elif "python" in obj_type:
        ext = "py"
    else:
        ext = "abap"

    filename = f"{obj_name}.{ext}"
    return Response(
        content=code.encode("utf-8"),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/artifacts/{artifact_id}/regenerate")
def regenerate_artifact(artifact_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    a = db.query(Artifact).filter(Artifact.id == artifact_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Artifact not found")
    a.generation_status = "Pending"
    a.review_note = ""
    a.reviewer = ""
    a.reviewed_at = None
    db.commit()
    background_tasks.add_task(_generate, a.id)
    return {"success": True, "data": artifact_to_dict(a)}
