from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Project, SystemProfile
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

router = APIRouter(tags=["Projects"])


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    source_system: Optional[str] = ""
    target_system: Optional[str] = ""
    clean_core_strategy: Optional[str] = ""
    clean_code_policy: Optional[str] = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    source_system: Optional[str] = None
    target_system: Optional[str] = None
    clean_core_strategy: Optional[str] = None
    clean_code_policy: Optional[str] = None
    status: Optional[str] = None


def project_to_dict(p: Project) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "source_system": p.source_system,
        "target_system": p.target_system,
        "clean_core_strategy": p.clean_core_strategy,
        "clean_code_policy": p.clean_code_policy,
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "object_count": len(p.objects) if p.objects else 0,
    }


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(Project).all()
    return {"success": True, "data": [project_to_dict(p) for p in projects]}


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    p = Project(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"success": True, "data": project_to_dict(p)}


@router.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True, "data": project_to_dict(p)}


@router.put("/projects/{project_id}")
def update_project(project_id: int, body: ProjectUpdate, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return {"success": True, "data": project_to_dict(p)}


@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(p)
    db.commit()
    return {"success": True, "data": {"deleted": True}}
