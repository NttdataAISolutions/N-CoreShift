from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Float, Boolean
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    source_system = Column(String, default="")
    target_system = Column(String, default="")
    clean_core_strategy = Column(String, default="")
    clean_code_policy = Column(String, default="")
    status = Column(String, default="Not Started")
    created_at = Column(DateTime, default=datetime.utcnow)

    objects = relationship("Object", back_populates="project", cascade="all, delete-orphan")
    system_profiles = relationship("SystemProfile", back_populates="project", cascade="all, delete-orphan")
    analyses = relationship("Analysis", back_populates="project", cascade="all, delete-orphan")


class SystemProfile(Base):
    __tablename__ = "system_profiles"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    system_type = Column(String)  # source / target
    system_name = Column(String, default="")
    sap_version = Column(String, default="")
    deployment_type = Column(String, default="")
    environment = Column(String, default="")

    project = relationship("Project", back_populates="system_profiles")


class Object(Base):
    __tablename__ = "objects"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    object_name = Column(String, nullable=False)
    object_type = Column(String, default="")
    package = Column(String, default="")
    business_process = Column(String, default="")
    source_code = Column(Text, default="")
    lines_of_code = Column(Integer, default=0)
    # Source-code version hash (SHA-256 hex) so analysis results can be
    # invalidated when source changes.
    source_code_version = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    # ── Source provider provenance ─────────────────────────────────────────────
    # Provider that ingested this object: FILE_UPLOAD | NCOREIQ | ABAPGIT
    provider = Column(String, default="FILE_UPLOAD")

    # ── N-CoreIQ evidence provenance (JSON) ───────────────────────────────────
    # Stores: sap_sid, sap_client, sap_release, ncoreiq_base_url, contract_version,
    #   sha256, ncoreiq_hash_provided, retrieved_at, object_version, refreshed_from_id
    # Null for non-N-CoreIQ objects.
    ncoreiq_metadata_json = Column(Text, nullable=True)

    # ── Evidence version tracking ─────────────────────────────────────────────
    # Version number within this project+object_name sequence (1 = first import).
    # Increments on explicit refresh.  Never decremented.
    object_version = Column(Integer, default=1)
    # True for the current canonical version; False for superseded versions.
    # A superseded object is never deleted — its source_code remains intact
    # so existing ObjectAnalysisResult rows remain reproducible against it.
    is_latest_version = Column(Boolean, default=True)
    # FK to the previous version of this object (null for first import).
    parent_object_id = Column(Integer, ForeignKey("objects.id"), nullable=True)

    project = relationship("Project", back_populates="objects")
    analysis_results = relationship("ObjectAnalysisResult", back_populates="object", cascade="all, delete-orphan")
    plans = relationship("Plan", back_populates="object", cascade="all, delete-orphan")
    artifacts = relationship("Artifact", back_populates="object", cascade="all, delete-orphan")
    # Child versions of this object (refreshed imports)
    child_versions = relationship("Object", foreign_keys=[parent_object_id])
    # Direct dependencies imported from N-CoreIQ
    dependencies = relationship("ObjectDependency", foreign_keys="ObjectDependency.source_object_id",
                                back_populates="source_object", cascade="all, delete-orphan")


class ObjectDependency(Base):
    """
    Technical dependency relationship for a SAP object, imported from N-CoreIQ.
    A dependency is EVIDENCE only — not a Clean Core verdict or disposition.
    """
    __tablename__ = "object_dependencies"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    # The object that contains this dependency
    source_object_id = Column(Integer, ForeignKey("objects.id"), nullable=False)
    source_object_name = Column(String, nullable=False)
    source_object_type = Column(String, default="")
    # The target of the dependency
    target_object_name = Column(String, nullable=False)
    target_object_type = Column(String, default="")
    # N-CoreIQ relationship fields (from DependencyRelation contract)
    relationship_type = Column(String, default="")     # e.g. CALLS_FUNCTION
    confidence = Column(String, default="")            # EXACT | HIGH | MEDIUM | LOW
    evidence_source = Column(String, default="")       # e.g. ABAP_PARSER
    source_component = Column(String, default="")      # e.g. PROGRAM__ZREPORT
    line_no = Column(Integer, nullable=True)
    dynamic = Column(Boolean, default=False)
    # Provenance
    provider = Column(String, default="NCOREIQ")
    imported_at = Column(DateTime, default=datetime.utcnow)

    source_object = relationship("Object", foreign_keys=[source_object_id],
                                 back_populates="dependencies")


class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    run_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="Pending")  # Pending / Complete / Failed
    # Aggregate token / cost totals for the whole analysis run
    total_input_tokens = Column(Integer, default=0)
    total_output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    total_cost_usd = Column(Float, default=0.0)
    # Version label so reruns can be compared ("1", "2", …)
    analysis_version = Column(Integer, default=1)
    # FK to previous analysis run (for rerun history)
    parent_analysis_id = Column(Integer, ForeignKey("analyses.id"), nullable=True)
    # Human-readable label / notes
    label = Column(String, default="")

    project = relationship("Project", back_populates="analyses")
    results = relationship("ObjectAnalysisResult", back_populates="analysis", cascade="all, delete-orphan")
    child_analyses = relationship("Analysis", foreign_keys=[parent_analysis_id])


class ObjectAnalysisResult(Base):
    __tablename__ = "object_analysis_results"
    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, ForeignKey("analyses.id"), nullable=False)
    object_id = Column(Integer, ForeignKey("objects.id"), nullable=False)

    # ── Core analysis fields ──────────────────────────────────────────────────
    functional_intent = Column(Text, default="")
    risk_level = Column(String, default="Unknown")          # High / Medium / Low
    risk_rationale = Column(Text, default="")
    disposition = Column(String, default="Pending")         # Retire/Replace/Refactor/Replatform/BTP Extension/Retain
    disposition_reasoning = Column(Text, default="")
    reasoning = Column(Text, default="")
    modernization_plan = Column(Text, default="")

    # ── Structured / enriched fields (stored as JSON strings) ─────────────────
    # JSON array: [{"name": "...", "type": "..."}, ...]
    dependencies_json = Column(Text, default="[]")
    # JSON: {"module": "...", "description": "...", "migration_effort": "..."}
    suggested_sap_replacement_json = Column(Text, default="{}")
    # JSON: detailed plan steps {"steps": [...], "estimated_days": N, ...}
    modernization_plan_json = Column(Text, default="{}")

    # ── Effort / impact scoring ───────────────────────────────────────────────
    technical_effort = Column(String, default="")           # Low / Medium / High / Very High
    technical_effort_rationale = Column(Text, default="")
    business_impact = Column(String, default="")            # Low / Medium / High / Critical
    business_impact_rationale = Column(Text, default="")

    # ── AI quality & guardrails ───────────────────────────────────────────────
    confidence_score = Column(Float, default=0.0)           # 0.0 – 1.0
    quality_indicators_json = Column(Text, default="{}")    # {"completeness":…, "specificity":…}
    validation_status = Column(String, default="")          # valid / invalid / warning
    validation_errors_json = Column(Text, default="[]")     # list of validation messages
    # Was suspicious input blocked before being sent to the LLM?
    sensitive_data_blocked = Column(Boolean, default=False)

    # ── Prompt / model provenance ─────────────────────────────────────────────
    model_name = Column(String, default="")
    llm_provider = Column(String, default="")
    prompt_version = Column(String, default="")
    prompt_hash = Column(String, default="")                # SHA-256 of the rendered prompt
    source_code_version = Column(String, default="")        # SHA-256 prefix of source at analysis time

    # ── LLM token / cost tracking ─────────────────────────────────────────────
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    estimated_input_cost_usd = Column(Float, default=0.0)
    estimated_output_cost_usd = Column(Float, default=0.0)
    estimated_total_cost_usd = Column(Float, default=0.0)
    response_timestamp = Column(DateTime, nullable=True)
    request_status = Column(String, default="")             # success / failed / blocked

    # ── Versioning / history ──────────────────────────────────────────────────
    analysis_version = Column(Integer, default=1)
    parent_analysis_result_id = Column(Integer, ForeignKey("object_analysis_results.id"), nullable=True)

    # ── Raw LLM response ─────────────────────────────────────────────────────
    raw_llm_response = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    analysis = relationship("Analysis", back_populates="results")
    object = relationship("Object", back_populates="analysis_results")
    plans = relationship("Plan", back_populates="analysis_result")
    child_results = relationship("ObjectAnalysisResult", foreign_keys=[parent_analysis_result_id])


class Plan(Base):
    __tablename__ = "plans"
    id = Column(Integer, primary_key=True, index=True)
    object_id = Column(Integer, ForeignKey("objects.id"), nullable=False)
    analysis_result_id = Column(Integer, ForeignKey("object_analysis_results.id"), nullable=True)
    plan_summary = Column(Text, default="")
    approval_status = Column(String, default="Pending")   # Pending / Approved / Rejected
    approver = Column(String, default="")
    approved_at = Column(DateTime, nullable=True)
    comments = Column(Text, default="")
    # Rejection / revision tracking
    rejection_reason = Column(Text, default="")
    revision_count = Column(Integer, default=0)
    required_approver_role = Column(String, default="Consultant")
    # Whether code generation is allowed (set True only when Approved + eligible disposition)
    codegen_allowed = Column(Boolean, default=False)

    object = relationship("Object", back_populates="plans")
    analysis_result = relationship("ObjectAnalysisResult", back_populates="plans")
    artifacts = relationship("Artifact", back_populates="plan")


class Artifact(Base):
    __tablename__ = "artifacts"
    id = Column(Integer, primary_key=True, index=True)
    object_id = Column(Integer, ForeignKey("objects.id"), nullable=False)
    plan_id = Column(Integer, ForeignKey("plans.id"), nullable=True)
    # Traceability: which analysis result triggered this artifact
    analysis_result_id = Column(Integer, ForeignKey("object_analysis_results.id"), nullable=True)
    original_code = Column(Text, default="")
    generated_code = Column(Text, default="")
    generation_status = Column(String, default="Pending")  # Pending / Generated / Accepted / Rejected / Failed
    review_note = Column(Text, default="")
    reviewer = Column(String, default="")
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    artifact_version = Column(Integer, default=1)
    parent_artifact_id = Column(Integer, ForeignKey("artifacts.id"), nullable=True)
    model_name = Column(String, default="")
    llm_provider = Column(String, default="")
    prompt_version = Column(String, default="")
    prompt_hash = Column(String, default="")
    source_code_version = Column(String, default="")
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    estimated_input_cost_usd = Column(Float, default=0.0)
    estimated_output_cost_usd = Column(Float, default=0.0)
    estimated_total_cost_usd = Column(Float, default=0.0)
    request_status = Column(String, default="")
    generation_notes = Column(Text, default="")
    assumptions_json = Column(Text, default="[]")

    object = relationship("Object", back_populates="artifacts")
    plan = relationship("Plan", back_populates="artifacts")
    child_artifacts = relationship("Artifact", foreign_keys=[parent_artifact_id])


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    role = Column(String, default="Viewer")
