from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Plan, ObjectAnalysisResult, Object

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Plans"])


class PlanApprove(BaseModel):
    approval_status: str  # Approved | Rejected | Pending
    approver: Optional[str] = ""
    comments: Optional[str] = ""


def _json(val, default):
    if val is None:
        return default
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return default
    return val


def plan_to_dict(p: Plan) -> dict:
    ar = p.analysis_result
    return {
        "id": p.id,
        "object_id": p.object_id,
        "object_name": p.object.object_name if p.object else "",
        "object_type": p.object.object_type if p.object else "",
        "analysis_result_id": p.analysis_result_id,
        "plan_summary": p.plan_summary,
        "approval_status": p.approval_status,
        "approver": p.approver,
        "approved_at": p.approved_at.isoformat() if p.approved_at else None,
        "comments": p.comments,
        # enriched from linked analysis result
        "disposition": ar.disposition if ar else "",
        "risk_level": ar.risk_level if ar else "",
        "technical_effort": getattr(ar, "technical_effort", "") if ar else "",
        "business_impact": getattr(ar, "business_impact", "") if ar else "",
        "confidence_score": getattr(ar, "confidence_score", 0.0) if ar else 0.0,
        "modernization_plan_steps": _json(getattr(ar, "modernization_plan_json", None), []) if ar else [],
        "suggested_sap_replacement": _json(getattr(ar, "suggested_sap_replacement_json", None), {}) if ar else {},
        "model_name": getattr(ar, "model_name", "") if ar else "",
        "prompt_version": getattr(ar, "prompt_version", "") if ar else "",
        # approval gate flag – convenient for the UI
        "code_generation_allowed": p.approval_status == "Approved",
    }


@router.get("/projects/{project_id}/plans")
def list_plans(project_id: int, db: Session = Depends(get_db)):
    objects = db.query(Object).filter(Object.project_id == project_id).all()
    obj_ids = [o.id for o in objects]
    plans = db.query(Plan).filter(Plan.object_id.in_(obj_ids)).all()
    return {"success": True, "data": [plan_to_dict(p) for p in plans]}


@router.post("/analysis-results/{result_id}/plans", status_code=201)
def create_plan_from_result(result_id: int, db: Session = Depends(get_db)):
    result = db.query(ObjectAnalysisResult).filter(ObjectAnalysisResult.id == result_id).first()
    if not result:
        raise HTTPException(status_code=404, detail="Analysis result not found")

    # Idempotent – return existing plan if already created
    existing = db.query(Plan).filter(Plan.analysis_result_id == result_id).first()
    if existing:
        return {"success": True, "data": plan_to_dict(existing), "already_existed": True}

    plan = Plan(
        object_id=result.object_id,
        analysis_result_id=result.id,
        plan_summary=result.modernization_plan,
        approval_status="Pending",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return {"success": True, "data": plan_to_dict(plan), "already_existed": False}


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, db: Session = Depends(get_db)):
    p = db.query(Plan).filter(Plan.id == plan_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"success": True, "data": plan_to_dict(p)}


@router.put("/plans/{plan_id}/approve")
def approve_plan(plan_id: int, body: PlanApprove, db: Session = Depends(get_db)):
    p = db.query(Plan).filter(Plan.id == plan_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")

    allowed_statuses = {"Approved", "Rejected", "Pending"}
    if body.approval_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"approval_status must be one of: {', '.join(sorted(allowed_statuses))}",
        )

    p.approval_status = body.approval_status
    p.approver = body.approver or ""
    p.comments = body.comments or ""
    if body.approval_status in ("Approved", "Rejected"):
        p.approved_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    logger.info("Plan %d set to %s by %s", plan_id, body.approval_status, body.approver)
    return {"success": True, "data": plan_to_dict(p)}


@router.get("/plans/{plan_id}/approval-gate")
def check_approval_gate(plan_id: int, db: Session = Depends(get_db)):
    """
    Returns whether code generation is allowed for this plan.
    Code generation requires approval_status == 'Approved'.
    """
    p = db.query(Plan).filter(Plan.id == plan_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")
    allowed = p.approval_status == "Approved"
    return {
        "success": True,
        "data": {
            "plan_id": plan_id,
            "approval_status": p.approval_status,
            "code_generation_allowed": allowed,
            "reason": "" if allowed else f"Plan must be Approved before code generation (current: {p.approval_status})",
        },
    }


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    p = db.query(Plan).filter(Plan.id == plan_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")
    db.delete(p)
    db.commit()
    return {"success": True, "data": {"deleted": True}}
