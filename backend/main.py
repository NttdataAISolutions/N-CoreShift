from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, run_migrations
import models

from routers import projects, objects, analyses, plans, artifacts, dashboard, admin, ncoreiq

# Create all tables (new tables only)
models.Base.metadata.create_all(bind=engine)

# Apply additive column migrations to existing tables
run_migrations()

app = FastAPI(title="N-CoreShift API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
