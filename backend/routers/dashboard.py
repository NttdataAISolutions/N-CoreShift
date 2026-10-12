from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Project, Object, Analysis, ObjectAnalysisResult, Plan, Artifact

router = APIRouter(tags=["Dashboard"])


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    total_projects = db.query(func.count(Project.id)).scalar()
    total_objects = db.query(func.count(Object.id)).scalar()
    total_analyses = db.query(func.count(Analysis.id)).scalar()
    total_plans = db.query(func.count(Plan.id)).scalar()
    total_artifacts = db.query(func.count(Artifact.id)).scalar()

    approved_plans = db.query(func.count(Plan.id)).filter(Plan.approval_status == "Approved").scalar()
    generated_artifacts = db.query(func.count(Artifact.id)).filter(Artifact.generation_status == "Generated").scalar()

    # Disposition breakdown
    disposition_rows = (
        db.query(ObjectAnalysisResult.disposition, func.count(ObjectAnalysisResult.id))
        .group_by(ObjectAnalysisResult.disposition)
        .all()
    )
    disposition_breakdown = {row[0]: row[1] for row in disposition_rows}

    # Risk breakdown
    risk_rows = (
        db.query(ObjectAnalysisResult.risk_level, func.count(ObjectAnalysisResult.id))
        .group_by(ObjectAnalysisResult.risk_level)
        .all()
    )
    risk_breakdown = {row[0]: row[1] for row in risk_rows}

    return {
        "success": True,
        "data": {
            "total_projects": total_projects,
            "total_objects": total_objects,
            "total_analyses": total_analyses,
            "total_plans": total_plans,
            "total_artifacts": total_artifacts,
            "approved_plans": approved_plans,
            "generated_artifacts": generated_artifacts,
            "disposition_breakdown": disposition_breakdown,
            "risk_breakdown": risk_breakdown,
        },
    }
