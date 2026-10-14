from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, run_migrations
import models

from auth.xsuaa import XSUAAInboundMiddleware
from routers import projects, objects, analyses, plans, artifacts, dashboard, admin, ncoreiq

# Create all tables (new tables only)
models.Base.metadata.create_all(bind=engine)

# Apply additive column migrations to existing tables
run_migrations()

app = FastAPI(title="N-CoreShift API", version="1.0.0")

# ── Middleware stack ──────────────────────────────────────────────────────────
# Registration order: last-added = outermost (first to process requests).
#
# 1. CORSMiddleware (added first = inner layer)
#    Handles preflight OPTIONS requests and adds CORS headers to all responses,
#    including 401 responses from the auth layer below.
#
# 2. XSUAAInboundMiddleware (added second = outer layer)
#    Validates XSUAA bearer tokens forwarded by AppRouter (production only).
#    /api/health is exempt. Local development is fully bypassed.
#    Does NOT touch the outbound N-CoreIQ client_credentials token provider.

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(XSUAAInboundMiddleware)

app.include_router(projects.router, prefix="/api")
app.include_router(objects.router, prefix="/api")
app.include_router(analyses.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(artifacts.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(ncoreiq.router)


@app.get("/api/health")
def health():
    return {"success": True, "data": {"status": "ok"}, "message": "N-CoreShift API running"}
