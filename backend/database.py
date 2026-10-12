from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
import os
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./ncoreshift.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# SQLite additive migration helper
# SQLAlchemy's create_all() only creates *new* tables; it never alters
# existing ones.  For SQLite (which lacks full ALTER TABLE support) we use a
# simple "try ADD COLUMN, ignore duplicate-column errors" pattern.
# ---------------------------------------------------------------------------

_MIGRATIONS: list[tuple[str, str, str]] = [
    # (table, column, column_def)
    # ── objects ──────────────────────────────────────────────────────────────
    ("objects", "source_code_version", "TEXT DEFAULT ''"),

    # ── analyses ─────────────────────────────────────────────────────────────
    ("analyses", "total_input_tokens",  "INTEGER DEFAULT 0"),
    ("analyses", "total_output_tokens", "INTEGER DEFAULT 0"),
    ("analyses", "total_tokens",        "INTEGER DEFAULT 0"),
    ("analyses", "total_cost_usd",      "REAL DEFAULT 0.0"),
    ("analyses", "analysis_version",    "INTEGER DEFAULT 1"),
    ("analyses", "parent_analysis_id",  "INTEGER"),
    ("analyses", "label",               "TEXT DEFAULT ''"),

    # ── object_analysis_results ──────────────────────────────────────────────
    ("object_analysis_results", "risk_rationale",               "TEXT DEFAULT ''"),
    ("object_analysis_results", "disposition_reasoning",        "TEXT DEFAULT ''"),
    ("object_analysis_results", "dependencies_json",            "TEXT DEFAULT '[]'"),
    ("object_analysis_results", "suggested_sap_replacement_json", "TEXT DEFAULT '{}'"),
    ("object_analysis_results", "modernization_plan_json",      "TEXT DEFAULT '{}'"),
    ("object_analysis_results", "technical_effort",             "TEXT DEFAULT ''"),
    ("object_analysis_results", "technical_effort_rationale",   "TEXT DEFAULT ''"),
    ("object_analysis_results", "business_impact",              "TEXT DEFAULT ''"),
    ("object_analysis_results", "business_impact_rationale",    "TEXT DEFAULT ''"),
    ("object_analysis_results", "confidence_score",             "REAL DEFAULT 0.0"),
    ("object_analysis_results", "quality_indicators_json",      "TEXT DEFAULT '{}'"),
    ("object_analysis_results", "validation_status",            "TEXT DEFAULT ''"),
    ("object_analysis_results", "validation_errors_json",       "TEXT DEFAULT '[]'"),
    ("object_analysis_results", "sensitive_data_blocked",       "INTEGER DEFAULT 0"),
    ("object_analysis_results", "model_name",                   "TEXT DEFAULT ''"),
    ("object_analysis_results", "llm_provider",                 "TEXT DEFAULT ''"),
    ("object_analysis_results", "prompt_version",               "TEXT DEFAULT ''"),
    ("object_analysis_results", "prompt_hash",                  "TEXT DEFAULT ''"),
    ("object_analysis_results", "source_code_version",          "TEXT DEFAULT ''"),
    ("object_analysis_results", "input_tokens",                 "INTEGER DEFAULT 0"),
    ("object_analysis_results", "output_tokens",                "INTEGER DEFAULT 0"),
    ("object_analysis_results", "total_tokens",                 "INTEGER DEFAULT 0"),
    ("object_analysis_results", "estimated_input_cost_usd",     "REAL DEFAULT 0.0"),
    ("object_analysis_results", "estimated_output_cost_usd",    "REAL DEFAULT 0.0"),
    ("object_analysis_results", "estimated_total_cost_usd",     "REAL DEFAULT 0.0"),
    ("object_analysis_results", "response_timestamp",           "DATETIME"),
    ("object_analysis_results", "request_status",               "TEXT DEFAULT ''"),
    ("object_analysis_results", "analysis_version",             "INTEGER DEFAULT 1"),
    ("object_analysis_results", "parent_analysis_result_id",    "INTEGER"),

    # ── objects (N-CoreIQ evidence provenance) ───────────────────────────────
    ("objects", "provider",               "TEXT DEFAULT 'FILE_UPLOAD'"),
    ("objects", "ncoreiq_metadata_json",  "TEXT"),
    ("objects", "object_version",         "INTEGER DEFAULT 1"),
    ("objects", "is_latest_version",      "INTEGER DEFAULT 1"),
    ("objects", "parent_object_id",       "INTEGER"),

    # ── plans ─────────────────────────────────────────────────────────────────
    ("plans", "rejection_reason",       "TEXT DEFAULT ''"),
    ("plans", "revision_count",         "INTEGER DEFAULT 0"),
    ("plans", "required_approver_role", "TEXT DEFAULT 'Consultant'"),
    ("plans", "codegen_allowed",        "INTEGER DEFAULT 0"),

    # ── artifacts ────────────────────────────────────────────────────────────
    ("artifacts", "analysis_result_id",         "INTEGER"),
    ("artifacts", "artifact_version",            "INTEGER DEFAULT 1"),
    ("artifacts", "parent_artifact_id",          "INTEGER"),
    ("artifacts", "model_name",                  "TEXT DEFAULT ''"),
    ("artifacts", "llm_provider",                "TEXT DEFAULT ''"),
    ("artifacts", "prompt_version",              "TEXT DEFAULT ''"),
    ("artifacts", "prompt_hash",                 "TEXT DEFAULT ''"),
    ("artifacts", "source_code_version",         "TEXT DEFAULT ''"),
    ("artifacts", "input_tokens",                "INTEGER DEFAULT 0"),
    ("artifacts", "output_tokens",               "INTEGER DEFAULT 0"),
    ("artifacts", "total_tokens",                "INTEGER DEFAULT 0"),
    ("artifacts", "estimated_input_cost_usd",    "REAL DEFAULT 0.0"),
    ("artifacts", "estimated_output_cost_usd",   "REAL DEFAULT 0.0"),
    ("artifacts", "estimated_total_cost_usd",    "REAL DEFAULT 0.0"),
    ("artifacts", "request_status",              "TEXT DEFAULT ''"),
    ("artifacts", "generation_notes",            "TEXT DEFAULT ''"),
    ("artifacts", "assumptions_json",            "TEXT DEFAULT '[]'"),
]


def run_migrations() -> None:
    """Apply additive column migrations to the SQLite database."""
    with engine.connect() as conn:
        for table, column, col_def in _MIGRATIONS:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))
                conn.commit()
                logger.info("Migration: added %s.%s", table, column)
            except Exception as exc:
                # "duplicate column name" → already exists, skip silently
                msg = str(exc).lower()
                if "duplicate column" in msg or "already exists" in msg:
                    pass
                else:
                    logger.warning("Migration skipped %s.%s: %s", table, column, exc)
