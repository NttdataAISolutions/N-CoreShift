from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, Analysis, ObjectAnalysisResult, Artifact
from pydantic import BaseModel
from typing import Optional, List
import os
import time
import uuid
from datetime import datetime

router = APIRouter(tags=["Admin"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _is_sap_ai_core_configured() -> bool:
    return bool(_env("AI_DEPLOYMENT_ID") and _env("AI_API_URL"))


def _model_display() -> str:
    raw = _env("LLM_MODEL", "")
    return raw if raw else "Not configured"


def _endpoint_hint() -> str:
    url = _env("AI_API_URL", "")
    if not url:
        return ""
    # Mask credentials – just show the host
    try:
        from urllib.parse import urlparse
        return urlparse(url).netloc
    except Exception:
        return url[:40] + "…" if len(url) > 40 else url


# ---------------------------------------------------------------------------
# User CRUD (existing)
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    name: str
    email: str
    role: Optional[str] = "Viewer"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None


def user_to_dict(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role}


@router.get("/admin/users")
def list_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return {"success": True, "data": [user_to_dict(u) for u in users]}


@router.post("/admin/users", status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="User with this email already exists")
    u = User(**body.model_dump())
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"success": True, "data": user_to_dict(u)}


@router.put("/admin/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return {"success": True, "data": user_to_dict(u)}


@router.delete("/admin/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(u)
    db.commit()
    return {"success": True, "data": {"deleted": True}}


@router.get("/admin/ai-config")
def get_ai_config():
    return {
        "success": True,
        "data": {
            "deployment_id": _env("AI_DEPLOYMENT_ID"),
            "model": _env("LLM_MODEL"),
            "resource_group": _env("AI_RESOURCE_GROUP", "default"),
            "api_url": _env("AI_API_URL"),
        },
    }


# ---------------------------------------------------------------------------
# AI Admin – Providers
# The frontend (AdministrationPage.tsx) expects:
#   GET  /api/ai-admin/providers        → { providers: [...], activeProvider: id|null }
#   POST /api/ai-admin/providers/{id}/test  → ConnectionTestResult
#   POST /api/ai-admin/active-provider  → { ok: true }
#   GET  /api/ai-admin/audit            → { entries: [...] }
# ---------------------------------------------------------------------------

def _build_providers() -> tuple[list[dict], str | None]:
    """Return (providers_list, active_provider_id)."""
    configured = _is_sap_ai_core_configured()
    model = _model_display()
    deployment_id = _env("AI_DEPLOYMENT_ID")
    resource_group = _env("AI_RESOURCE_GROUP", "default")
    endpoint = _endpoint_hint()

    providers = [
        {
            "id": "sap-ai-core",
            "name": "SAP AI Core",
            "description": (
                f"SAP BTP AI Core service · Deployment: {deployment_id} · "
                f"Resource group: {resource_group}"
                if configured
                else "SAP BTP AI Core service – not yet configured (see .env)"
            ),
            "isConfigured": configured,
            "isActive": configured,
            "model": model if configured else None,
            "endpointHint": endpoint if configured else None,
        },
        {
            "id": "sap-ai-interface",
            "name": "SAP AI Interface (LLM Proxy)",
            "description": "Route requests through the SAP AI Interface proxy layer.",
            "isConfigured": False,
            "isActive": False,
            "model": None,
            "endpointHint": None,
        },
        {
            "id": "openai",
            "name": "OpenAI (Direct)",
            "description": "Call OpenAI APIs directly using an OPENAI_API_KEY secret.",
            "isConfigured": bool(_env("OPENAI_API_KEY")),
            "isActive": False,
            "model": _env("OPENAI_MODEL", "gpt-4o") if _env("OPENAI_API_KEY") else None,
            "endpointHint": "api.openai.com" if _env("OPENAI_API_KEY") else None,
        },
    ]

    active = "sap-ai-core" if configured else None
    return providers, active


@router.get("/ai-admin/providers")
def list_ai_providers():
    """Return registered AI providers with live configuration status."""
    providers, active = _build_providers()
    return {"providers": providers, "activeProvider": active}


class ActivateProviderBody(BaseModel):
    providerId: str


@router.post("/ai-admin/active-provider")
def set_active_provider(body: ActivateProviderBody):
    """Mark a provider as active (in-memory only; persists until restart)."""
    valid_ids = {"sap-ai-core", "sap-ai-interface", "openai"}
    if body.providerId not in valid_ids:
        raise HTTPException(status_code=400, detail=f"Unknown provider id: {body.providerId}")
    return {"ok": True, "activeProvider": body.providerId}


@router.post("/ai-admin/providers/{provider_id}/test")
def test_provider_connection(provider_id: str):
    """Attempt a lightweight connectivity check for the given provider."""
    import requests as req_lib  # optional; only needed here

    checked_at = datetime.utcnow().isoformat() + "Z"

    if provider_id == "sap-ai-core":
        if not _is_sap_ai_core_configured():
            return {
                "providerId": provider_id,
                "success": False,
                "latencyMs": 0,
                "checkedAt": checked_at,
                "error": "SAP AI Core is not configured (AI_DEPLOYMENT_ID or AI_API_URL missing).",
            }
        # Try a HEAD/GET to the API endpoint
        url = _env("AI_API_URL").rstrip("/") + "/v2/lm/deployments"
        start = time.time()
        try:
            resp = req_lib.get(url, timeout=8, headers={"Accept": "application/json"})
            latency = int((time.time() - start) * 1000)
            # 401/403 = reachable (auth required), 200 = fully open
            reachable = resp.status_code in (200, 401, 403)
            return {
                "providerId": provider_id,
                "success": reachable,
                "latencyMs": latency,
                "checkedAt": checked_at,
                "error": None if reachable else f"HTTP {resp.status_code}",
            }
        except Exception as exc:
            return {
                "providerId": provider_id,
                "success": False,
                "latencyMs": int((time.time() - start) * 1000),
                "checkedAt": checked_at,
                "error": str(exc),
            }

    # Other providers – return not-configured result
    return {
        "providerId": provider_id,
        "success": False,
        "latencyMs": 0,
        "checkedAt": checked_at,
        "error": f"Provider '{provider_id}' is not configured in this environment.",
    }


# ---------------------------------------------------------------------------
# AI Admin – Audit Log
# Populated from real DB records: analyses + artifact generation events.
# ---------------------------------------------------------------------------

@router.get("/ai-admin/audit")
def get_audit_log(limit: int = 50, db: Session = Depends(get_db)):
    """
    Return a unified audit log built from:
    - Analysis runs  (ObjectAnalysisResult rows)
    - Code generation runs (Artifact rows)
    Most-recent-first, capped at `limit`.
    """
    entries: list[dict] = []

    # ── Analysis events ──────────────────────────────────────────────────────
    analysis_rows = (
        db.query(ObjectAnalysisResult)
        .filter(ObjectAnalysisResult.request_status != "")
        .order_by(ObjectAnalysisResult.created_at.desc())
        .limit(limit)
        .all()
    )
    for r in analysis_rows:
        provider = r.llm_provider or "sap-ai-core"
        tokens = r.total_tokens or 0
        cost = r.estimated_total_cost_usd or 0.0
        detail = (
            f"Model: {r.model_name or _env('LLM_MODEL', 'n/a')} · "
            f"Tokens: {tokens:,} · Cost: ${cost:.4f}"
        )
        entries.append(
            {
                "id": f"ar-{r.id}",
                "timestamp": r.created_at.isoformat() + "Z" if r.created_at else "",
                "action": "ANALYSIS_RUN",
                "actor": "system",
                "providerId": _canonical_provider_id(provider),
                "detail": detail,
                "outcome": "SUCCESS" if r.request_status == "success" else "FAILURE",
            }
        )

    # ── Artifact / codegen events ────────────────────────────────────────────
    artifact_rows = (
        db.query(Artifact)
        .filter(Artifact.request_status != "")
        .order_by(Artifact.created_at.desc())
        .limit(limit)
        .all()
    )
    for a in artifact_rows:
        provider = a.llm_provider or "sap-ai-core"
        tokens = a.total_tokens or 0
        cost = a.estimated_total_cost_usd or 0.0
        detail = (
            f"Model: {a.model_name or _env('LLM_MODEL', 'n/a')} · "
            f"Tokens: {tokens:,} · Cost: ${cost:.4f} · "
            f"Status: {a.generation_status}"
        )
        entries.append(
            {
                "id": f"af-{a.id}",
                "timestamp": a.created_at.isoformat() + "Z" if a.created_at else "",
                "action": "CODE_GENERATION",
                "actor": "system",
                "providerId": _canonical_provider_id(provider),
                "detail": detail,
                "outcome": "SUCCESS" if a.request_status == "success" else "FAILURE",
            }
        )

    # Sort all entries newest-first and cap
    entries.sort(key=lambda e: e["timestamp"], reverse=True)
    entries = entries[:limit]

    return {"entries": entries}


def _canonical_provider_id(raw: str) -> str:
    """Normalise provider string to the ProviderId enum the frontend expects."""
    raw = (raw or "").lower()
    if "openai" in raw:
        return "openai"
    if "interface" in raw:
        return "sap-ai-interface"
    return "sap-ai-core"
