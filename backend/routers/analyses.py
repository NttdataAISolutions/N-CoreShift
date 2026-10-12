from __future__ import annotations

import json
import logging
import traceback

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import Analysis, ObjectAnalysisResult, Object, Project
import ai_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Analyses"])


def result_to_dict(r: ObjectAnalysisResult) -> dict:
    def _json(val, default):
        if val is None:
            return default
        if isinstance(val, str):
            try:
                return json.loads(val)
            except Exception:
                return default
        return val

    return {
        "id": r.id,
        "analysis_id": r.analysis_id,
        "object_id": r.object_id,
        "object_name": r.object.object_name if r.object else "",
        "functional_intent": r.functional_intent,
        "risk_level": r.risk_level,
        "risk_rationale": getattr(r, "risk_rationale", "") or "",
        "disposition": r.disposition,
        "disposition_reasoning": getattr(r, "disposition_reasoning", "") or "",
        "reasoning": r.reasoning,
        "modernization_plan": r.modernization_plan,
        "modernization_plan_json": _json(getattr(r, "modernization_plan_json", None), {}),
        "technical_effort": getattr(r, "technical_effort", "") or "",
        "technical_effort_rationale": getattr(r, "technical_effort_rationale", "") or "",
        "business_impact": getattr(r, "business_impact", "") or "",
        "business_impact_rationale": getattr(r, "business_impact_rationale", "") or "",
        "confidence_score": getattr(r, "confidence_score", 0.0) or 0.0,
        "dependencies": _json(getattr(r, "dependencies_json", None), []),
        "suggested_sap_replacement": _json(getattr(r, "suggested_sap_replacement_json", None), {}),
        "quality_indicators": _json(getattr(r, "quality_indicators_json", None), {}),
        "validation_status": getattr(r, "validation_status", "") or "",
        "validation_errors": _json(getattr(r, "validation_errors_json", None), []),
        "sensitive_data_blocked": bool(getattr(r, "sensitive_data_blocked", False)),
        # LLM metadata
        "model_name": getattr(r, "model_name", "") or "",
        "llm_provider": getattr(r, "llm_provider", "") or "",
        "prompt_version": getattr(r, "prompt_version", "") or "",
        "prompt_hash": getattr(r, "prompt_hash", "") or "",
        "source_code_version": getattr(r, "source_code_version", "") or "",
        "input_tokens": getattr(r, "input_tokens", 0) or 0,
        "output_tokens": getattr(r, "output_tokens", 0) or 0,
        "total_tokens": getattr(r, "total_tokens", 0) or 0,
        "estimated_input_cost_usd": getattr(r, "estimated_input_cost_usd", 0.0) or 0.0,
        "estimated_output_cost_usd": getattr(r, "estimated_output_cost_usd", 0.0) or 0.0,
        "estimated_total_cost_usd": getattr(r, "estimated_total_cost_usd", 0.0) or 0.0,
        "response_timestamp": r.response_timestamp.isoformat() if getattr(r, "response_timestamp", None) else None,
        "request_status": getattr(r, "request_status", "") or "",
        "analysis_version": getattr(r, "analysis_version", 1) or 1,
        "parent_analysis_result_id": getattr(r, "parent_analysis_result_id", None),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def analysis_to_dict(a: Analysis) -> dict:
    return {
        "id": a.id,
        "project_id": a.project_id,
        "run_date": a.run_date.isoformat() if a.run_date else None,
        "status": a.status,
        "result_count": len(a.results) if a.results else 0,
        "label": getattr(a, "label", "") or "",
        "analysis_version": getattr(a, "analysis_version", 1) or 1,
        "parent_analysis_id": getattr(a, "parent_analysis_id", None),
        # Aggregated LLM cost totals
        "total_input_tokens": getattr(a, "total_input_tokens", 0) or 0,
        "total_output_tokens": getattr(a, "total_output_tokens", 0) or 0,
        "total_tokens": getattr(a, "total_tokens", 0) or 0,
        "total_cost_usd": getattr(a, "total_cost_usd", 0.0) or 0.0,
    }


def _run_analysis(analysis_id: int):
    """Background task – creates its own DB session so the request session
    closure does not cause errors."""
    db: Session = SessionLocal()
    try:
        analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
        if not analysis:
            logger.error("Analysis %d not found in background task", analysis_id)
            return

        objects = db.query(Object).filter(Object.project_id == analysis.project_id).all()
        logger.info(
            "Running analysis %d for project %d – %d objects found",
            analysis_id,
            analysis.project_id,
            len(objects),
        )

        if not objects:
            analysis.status = "Failed"
            db.commit()
            logger.warning("Analysis %d failed – no objects in project", analysis_id)
            return

        success_count = 0
        total_input_tokens = 0
        total_output_tokens = 0
        total_cost_usd = 0.0

        for obj in objects:
            try:
                result = ai_service.analyze_object(
                    object_name=obj.object_name,
                    object_type=obj.object_type,
                    package=obj.package or "",
                    business_process=obj.business_process or "",
                    source_code=obj.source_code or "",
                )

                from datetime import datetime
                resp_ts_raw = result.get("_response_timestamp")
                resp_ts = None
                if resp_ts_raw:
                    try:
                        resp_ts = datetime.fromisoformat(resp_ts_raw)
                    except Exception:
                        pass

                r = ObjectAnalysisResult(
                    analysis_id=analysis.id,
                    object_id=obj.id,
                    functional_intent=result.get("functional_intent", ""),
                    risk_level=result.get("risk_level", "Unknown"),
                    risk_rationale=result.get("risk_rationale", ""),
                    disposition=result.get("disposition", "Pending"),
                    disposition_reasoning=result.get("disposition_reasoning", ""),
                    reasoning=result.get("reasoning", ""),
                    modernization_plan=result.get("modernization_plan", ""),
                    modernization_plan_json=json.dumps(result.get("modernization_plan_steps", [])),
                    technical_effort=result.get("technical_effort", ""),
                    technical_effort_rationale=result.get("technical_effort_rationale", ""),
                    business_impact=result.get("business_impact", ""),
                    business_impact_rationale=result.get("business_impact_rationale", ""),
                    confidence_score=result.get("confidence_score", 0.0),
                    dependencies_json=json.dumps(result.get("dependencies", [])),
                    suggested_sap_replacement_json=json.dumps(result.get("suggested_sap_replacement", {})),
                    quality_indicators_json=json.dumps(result.get("quality_indicators", {})),
                    validation_status=result.get("_validation_status", ""),
                    validation_errors_json=json.dumps(result.get("_validation_errors", [])),
                    sensitive_data_blocked=1 if result.get("_sensitive_data_blocked") else 0,
                    model_name=result.get("_model", ""),
                    llm_provider="SAP AI Core",
                    prompt_version=result.get("_prompt_version", ""),
                    prompt_hash=result.get("_prompt_hash", ""),
                    source_code_version=result.get("_source_code_version", ""),
                    input_tokens=result.get("_input_tokens", 0),
                    output_tokens=result.get("_output_tokens", 0),
                    total_tokens=result.get("_total_tokens", 0),
                    estimated_input_cost_usd=result.get("_input_cost_usd", 0.0),
                    estimated_output_cost_usd=result.get("_output_cost_usd", 0.0),
                    estimated_total_cost_usd=result.get("_total_cost_usd", 0.0),
                    response_timestamp=resp_ts,
                    request_status=result.get("_request_status", ""),
                    raw_llm_response=result.get("_raw", ""),
                )
                db.add(r)
                db.commit()

                total_input_tokens  += result.get("_input_tokens", 0)
                total_output_tokens += result.get("_output_tokens", 0)
                total_cost_usd      += result.get("_total_cost_usd", 0.0)
                success_count += 1

                logger.info(
                    "  Object %s → %s (risk=%s, tokens=%d, cost=$%.4f)",
                    obj.object_name,
                    result.get("disposition"),
                    result.get("risk_level"),
                    result.get("_total_tokens", 0),
                    result.get("_total_cost_usd", 0.0),
                )
            except Exception as obj_err:
                logger.error(
                    "  Failed to analyze object %s: %s\n%s",
                    obj.object_name,
                    obj_err,
                    traceback.format_exc(),
                )
                r = ObjectAnalysisResult(
                    analysis_id=analysis.id,
                    object_id=obj.id,
                    functional_intent="AI analysis failed",
                    risk_level="Unknown",
                    disposition="Pending",
                    reasoning=str(obj_err)[:500],
                    modernization_plan="",
                    raw_llm_response="",
                    request_status="error",
                )
                db.add(r)
                db.commit()

        # Update analysis-level aggregates
        analysis.status = "Complete"
        analysis.total_input_tokens  = total_input_tokens
        analysis.total_output_tokens = total_output_tokens
        analysis.total_tokens        = total_input_tokens + total_output_tokens
        analysis.total_cost_usd      = round(total_cost_usd, 6)
        db.commit()
        logger.info(
            "Analysis %d complete – %d/%d objects processed",
            analysis_id,
            success_count,
            len(objects),
        )
    except Exception as e:
        logger.error(
            "Analysis %d failed with unhandled error: %s\n%s",
            analysis_id,
            e,
            traceback.format_exc(),
        )
        try:
            analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
            if analysis:
                analysis.status = "Failed"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.get("/analyses")
def list_all_analyses(db: Session = Depends(get_db)):
    """Return all analyses across all projects, newest first."""
    analyses = db.query(Analysis).order_by(Analysis.run_date.desc()).all()
    return [analysis_to_dict(a) for a in analyses]


@router.post("/analyses", status_code=201)
def run_analysis_global(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Run a new analysis – accepts { project_id, label? } in the request body."""
    project_id = payload.get("project_id")
    label = payload.get("label", "")
    if not project_id:
        raise HTTPException(status_code=422, detail="project_id is required")
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    objects = db.query(Object).filter(Object.project_id == project_id).all()
    if not objects:
        raise HTTPException(
            status_code=400,
            detail="No objects found for this project. Please upload ABAP objects first.",
        )
    analysis = Analysis(project_id=project_id, status="Pending", label=label or None)
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    background_tasks.add_task(_run_analysis, analysis.id)
    return analysis_to_dict(analysis)


@router.get("/projects/{project_id}/analyses")
def list_analyses(project_id: int, db: Session = Depends(get_db)):
    analyses = db.query(Analysis).filter(Analysis.project_id == project_id).all()
    return {"success": True, "data": [analysis_to_dict(a) for a in analyses]}


@router.post("/projects/{project_id}/analyses", status_code=201)
def run_analysis(
    project_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    objects = db.query(Object).filter(Object.project_id == project_id).all()
    if not objects:
        raise HTTPException(
            status_code=400,
            detail="No objects found for this project. Please upload ABAP objects first.",
        )

    analysis = Analysis(project_id=project_id, status="Pending")
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    # Pass only the ID – background task creates its own session
    background_tasks.add_task(_run_analysis, analysis.id)
    return {"success": True, "data": analysis_to_dict(analysis)}


@router.get("/analyses/{analysis_id}")
def get_analysis(analysis_id: int, db: Session = Depends(get_db)):
    a = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {"success": True, "data": analysis_to_dict(a)}


@router.get("/analyses/{analysis_id}/results")
def get_analysis_results(analysis_id: int, db: Session = Depends(get_db)):
    results = (
        db.query(ObjectAnalysisResult)
        .filter(ObjectAnalysisResult.analysis_id == analysis_id)
        .all()
    )
    return {"success": True, "data": [result_to_dict(r) for r in results]}


@router.delete("/analyses/{analysis_id}")
def delete_analysis(analysis_id: int, db: Session = Depends(get_db)):
    a = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    db.delete(a)
    db.commit()
    return {"success": True, "data": {"deleted": True}}


@router.get("/projects/{project_id}/analysis-results")
def get_project_results(project_id: int, db: Session = Depends(get_db)):
    """Get latest analysis results for a project."""
    latest = (
        db.query(Analysis)
        .filter(Analysis.project_id == project_id, Analysis.status == "Complete")
        .order_by(Analysis.run_date.desc())
        .first()
    )
    if not latest:
        return {"success": True, "data": []}
    results = (
        db.query(ObjectAnalysisResult)
        .filter(ObjectAnalysisResult.analysis_id == latest.id)
        .all()
    )
    return {"success": True, "data": [result_to_dict(r) for r in results]}


@router.post("/analysis-results/{result_id}/plans")
def create_plan_from_result(result_id: int, db: Session = Depends(get_db)):
    """Create a modernization plan entry from an analysis result."""
    from models import Plan

    r = db.query(ObjectAnalysisResult).filter(ObjectAnalysisResult.id == result_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Analysis result not found")

    # Check if plan already exists for this analysis result
    existing = (
        db.query(Plan)
        .filter(Plan.analysis_result_id == r.id)
        .first()
    )
    if existing:
        return {"success": True, "data": {"id": existing.id, "already_existed": True}}

    plan = Plan(
        object_id=r.object_id,
        analysis_result_id=r.id,
        plan_summary=r.modernization_plan,
        approval_status="Pending",
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return {"success": True, "data": {"id": plan.id, "already_existed": False}}
