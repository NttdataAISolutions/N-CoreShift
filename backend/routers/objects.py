from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from database import get_db
from models import Object, Project
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

router = APIRouter(tags=["Objects"])


class ObjectCreate(BaseModel):
    project_id: int
    object_name: str
    object_type: Optional[str] = ""
    package: Optional[str] = ""
    business_process: Optional[str] = ""
    source_code: Optional[str] = ""
    lines_of_code: Optional[int] = 0


class ObjectUpdate(BaseModel):
    object_name: Optional[str] = None
    object_type: Optional[str] = None
    package: Optional[str] = None
    business_process: Optional[str] = None
    source_code: Optional[str] = None
    lines_of_code: Optional[int] = None


def obj_to_dict(o: Object) -> dict:
    return {
        "id": o.id,
        "project_id": o.project_id,
        "object_name": o.object_name,
        "object_type": o.object_type,
        "package": o.package,
        "business_process": o.business_process,
        "source_code": o.source_code,
        "lines_of_code": o.lines_of_code,
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }


@router.get("/projects/{project_id}/objects")
def list_objects(project_id: int, db: Session = Depends(get_db)):
    objs = db.query(Object).filter(Object.project_id == project_id).all()
    return {"success": True, "data": [obj_to_dict(o) for o in objs]}


@router.post("/objects", status_code=201)
def create_object(body: ObjectCreate, db: Session = Depends(get_db)):
    proj = db.query(Project).filter(Project.id == body.project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    loc = body.lines_of_code or len([ln for ln in body.source_code.split("\n") if ln.strip()])
    o = Object(**body.model_dump())
    o.lines_of_code = loc
    db.add(o)
    db.commit()
    db.refresh(o)
    return {"success": True, "data": obj_to_dict(o)}


@router.get("/objects/{object_id}")
def get_object(object_id: int, db: Session = Depends(get_db)):
    o = db.query(Object).filter(Object.id == object_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Object not found")
    return {"success": True, "data": obj_to_dict(o)}


@router.put("/objects/{object_id}")
def update_object(object_id: int, body: ObjectUpdate, db: Session = Depends(get_db)):
    o = db.query(Object).filter(Object.id == object_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Object not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(o, k, v)
    db.commit()
    db.refresh(o)
    return {"success": True, "data": obj_to_dict(o)}


@router.delete("/objects/{object_id}")
def delete_object(object_id: int, db: Session = Depends(get_db)):
    o = db.query(Object).filter(Object.id == object_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Object not found")
    db.delete(o)
    db.commit()
    return {"success": True, "data": {"deleted": True}}


@router.post("/projects/{project_id}/objects/upload")
async def upload_objects(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload a text file containing ABAP source code as a new object."""
    proj = db.query(Project).filter(Project.id == project_id).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    content = await file.read()
    source_code = content.decode("utf-8", errors="replace")
    filename = file.filename or "UNKNOWN"
    object_name = filename.rsplit(".", 1)[0].upper()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    type_map = {"abap": "ABAP Program", "prog": "ABAP Program", "class": "ABAP Class",
                "fugr": "Function Group", "badi": "BAdI Implementation", "enho": "Enhancement"}
    object_type = type_map.get(ext, "ABAP Program")
    loc = len([ln for ln in source_code.split("\n") if ln.strip()])

    o = Object(
        project_id=project_id,
        object_name=object_name,
        object_type=object_type,
        source_code=source_code,
        lines_of_code=loc,
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return {"success": True, "data": obj_to_dict(o)}
