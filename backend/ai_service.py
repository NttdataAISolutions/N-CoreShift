"""
SAP AI Core – Generative AI Hub client (Enhanced).

Enhancements over v1:
  • Richer structured JSON output (risk_rationale, dependencies, effort/impact,
    confidence_score, modernization_plan_json, suggested_sap_replacement)
  • Token counting + USD cost estimation
  • Prompt versioning (version string + SHA-256 hash)
  • Source-code version hash (SHA-256) for change detection
  • AI guardrails: input sanitisation, prompt-injection detection, sensitive-data
    scrubbing, output validation
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
AI_API_URL        = os.getenv("AI_API_URL", "")
AI_CLIENT_ID      = os.getenv("AI_CLIENT_ID", "")
AI_CLIENT_SECRET  = os.getenv("AI_CLIENT_SECRET", "")
AI_AUTH_URL       = os.getenv("AI_AUTH_URL", "")
AI_RESOURCE_GROUP = os.getenv("AI_RESOURCE_GROUP", "default")
AI_DEPLOYMENT_ID  = os.getenv("AI_DEPLOYMENT_ID", "")
LLM_MODEL         = os.getenv("LLM_MODEL", "anthropic--claude-4.6-sonnet")

# Cost per 1 million tokens (USD) – configurable via env
_IN_COST_PER_1M  = float(os.getenv("LLM_INPUT_COST_PER_1M_TOKENS",  "3.00"))
_OUT_COST_PER_1M = float(os.getenv("LLM_OUTPUT_COST_PER_1M_TOKENS", "15.00"))

# Prompt versions – bump whenever the prompt templates change
ANALYSIS_PROMPT_VERSION = os.getenv("ANALYSIS_PROMPT_VERSION", "2.0")
CODEGEN_PROMPT_VERSION  = os.getenv("CODE_GENERATION_PROMPT_VERSION", "2.0")

# ── Token cache ───────────────────────────────────────────────────────────────
_token_cache: dict[str, Any] = {"token": None, "expires_at": 0}


def _get_token() -> str:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    resp = httpx.post(
        f"{AI_AUTH_URL}/oauth/token",
        data={
            "grant_type": "client_credentials",
            "client_id": AI_CLIENT_ID,
            "client_secret": AI_CLIENT_SECRET,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + int(data.get("expires_in", 3600))
    return _token_cache["token"]


# ── Cost helpers ──────────────────────────────────────────────────────────────

def _cost(tokens: int, per_1m: float) -> float:
    return round(tokens * per_1m / 1_000_000, 6)


def _extract_usage(response_json: dict) -> dict[str, int]:
    """Extract token counts from Anthropic response (usage field)."""
    usage = response_json.get("usage", {})
    inp = usage.get("input_tokens", 0)
    out = usage.get("output_tokens", 0)
    return {"input_tokens": inp, "output_tokens": out, "total_tokens": inp + out}


# ── Hashing helpers ───────────────────────────────────────────────────────────

def sha256_prefix(text: str, length: int = 12) -> str:
    """Return first *length* hex chars of SHA-256 of *text*."""
    return hashlib.sha256(text.encode()).hexdigest()[:length]


def prompt_hash(prompt: str) -> str:
    return sha256_prefix(prompt, 16)


# ── Guardrails ────────────────────────────────────────────────────────────────

_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"disregard\s+(all\s+)?instructions",
    r"you\s+are\s+now\s+(a|an)",
    r"act\s+as\s+(if\s+you\s+are|a|an)",
    r"system\s*:\s*(ignore|override)",
    r"jailbreak",
    r"DAN\s+mode",
    r"<\s*script[^>]*>",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE | re.DOTALL)

_SENSITIVE_PATTERNS = [
    r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b",
    r"\b(?:\d[ -]?){13,16}\b",
    r"(password|passwd|secret|api[_\-]?key)\s*[=:]\s*\S+",
]
_SENSITIVE_RE = re.compile("|".join(_SENSITIVE_PATTERNS), re.IGNORECASE)


def _check_guardrails(text: str) -> tuple[bool, list[str]]:
    """Returns (blocked, issues). Blocked means do NOT send to LLM."""
    issues: list[str] = []
    if _INJECTION_RE.search(text):
        issues.append("Potential prompt-injection pattern detected in input.")
    if _SENSITIVE_RE.search(text):
        issues.append("Potential sensitive data (email/credential) detected in source code.")
    blocked = any("prompt-injection" in i for i in issues)
    return blocked, issues


def _sanitize(text: str, max_chars: int = 12_000) -> str:
    return text.replace("\x00", "")[:max_chars]


# ── Low-level chat ────────────────────────────────────────────────────────────

def _chat(messages: list[dict], max_tokens: int = 2048) -> tuple[str, dict]:
    """Call Claude via SAP AI Core. Returns (text, usage_dict)."""
    token = _get_token()
    url = f"{AI_API_URL}/v2/inference/deployments/{AI_DEPLOYMENT_ID}/invoke"

    system_text = ""
    user_messages = []
    for m in messages:
        if m.get("role") == "system":
            system_text = m.get("content", "")
        else:
            user_messages.append(m)

    payload: dict = {
        "anthropic_version": "bedrock-2023-05-31",
        "messages": user_messages,
        "max_tokens": max_tokens,
    }
    if system_text:
        payload["system"] = system_text

    headers = {
        "Authorization": f"Bearer {token}",
        "AI-Resource-Group": AI_RESOURCE_GROUP,
        "Content-Type": "application/json",
    }
    resp = httpx.post(url, json=payload, headers=headers, timeout=120)
    resp.raise_for_status()
    resp_json = resp.json()
    text = resp_json["content"][0]["text"]
    usage = _extract_usage(resp_json)
    return text, usage


# ── Prompt templates ──────────────────────────────────────────────────────────

ANALYSIS_SYSTEM = (
    "You are a senior SAP clean-core modernization consultant. "
    "You analyze SAP custom ABAP objects and provide structured JSON assessments "
    "covering risk, recommended disposition, effort, business impact, and a detailed "
    "step-by-step modernization plan. Always respond with valid JSON only."
)

ANALYSIS_USER_TMPL = """\
Analyze the following SAP ABAP object and respond with a single valid JSON object \
(no markdown, no prose outside JSON).

Object Name: {object_name}
Object Type: {object_type}
Package: {package}
Business Process: {business_process}

Source Code:
{source_code}

Return exactly this JSON structure:
{{
  "functional_intent": "1-3 sentence description of what this object does",
  "risk_level": "High|Medium|Low",
  "risk_rationale": "Why this risk level was assigned",
  "disposition": "Retain|Replace|Refactor|Replatform|Retire|BTP Extension",
  "disposition_reasoning": "Detailed reasoning for this disposition",
  "reasoning": "Overall analysis summary",
  "technical_effort": "Low|Medium|High|Very High",
  "technical_effort_rationale": "Why this effort estimate",
  "business_impact": "Low|Medium|High|Critical",
  "business_impact_rationale": "Why this business impact rating",
  "confidence_score": 0.85,
  "dependencies": [
    {{"name": "TABLE_OR_FM_NAME", "type": "Table|Function Module|BAPI|Class|Include", "notes": ""}}
  ],
  "suggested_sap_replacement": {{
    "module": "e.g. SAP RAP / BTP Extension / Standard BAPI",
    "description": "What standard capability replaces this",
    "migration_effort": "Low|Medium|High"
  }},
  "modernization_plan": "Plain-text step-by-step plan",
  "modernization_plan_steps": [
    {{"step": 1, "action": "...", "owner": "Developer|Consultant|Architect", "estimated_days": 1}}
  ],
  "quality_indicators": {{
    "completeness": 0.9,
    "specificity": 0.8,
    "actionability": 0.85
  }}
}}

confidence_score must be 0.0-1.0. quality_indicators values must each be 0.0-1.0."""

CODEGEN_SYSTEM = (
    "You are an expert SAP ABAP developer specialising in clean-core S/4HANA development. "
    "You rewrite legacy ABAP code into modern, clean-core compliant code. "
    "Return ONLY the generated code with inline comments. No extra prose."
)

CODEGEN_USER_TMPL = """\
Rewrite the following SAP ABAP object based on the modernisation decision.

Object Name:            {object_name}
Object Type:            {object_type}
Modernisation Decision: {disposition}
Modernisation Plan:     {modernization_plan}

Original Source Code:
{source_code}

Instructions:
- Refactor: Clean ABAP, released APIs, CDS views, no direct DB access.
- Replatform / BTP Extension: SAP BTP extension using RAP or BTP services.
- Add inline comments explaining key changes.
- Return ONLY the generated code."""


# ── Validation ────────────────────────────────────────────────────────────────

_VALID_RISK_LEVELS  = {"High", "Medium", "Low", "Unknown"}
_VALID_DISPOSITIONS = {"Retain", "Replace", "Refactor", "Replatform", "Retire", "BTP Extension", "Pending"}


def _validate_analysis(parsed: dict) -> tuple[str, list[str]]:
    """Returns (status, errors). status: 'valid' | 'warning'."""
    errors: list[str] = []
    if parsed.get("risk_level") not in _VALID_RISK_LEVELS:
        errors.append(f"Invalid risk_level: {parsed.get('risk_level')!r}")
    if parsed.get("disposition") not in _VALID_DISPOSITIONS:
        errors.append(f"Invalid disposition: {parsed.get('disposition')!r}")
    if not parsed.get("functional_intent"):
        errors.append("functional_intent is empty")
    conf = parsed.get("confidence_score", 0)
    if not isinstance(conf, (int, float)) or not (0 <= conf <= 1):
        errors.append(f"confidence_score out of range: {conf!r}")
        parsed["confidence_score"] = 0.0
    if errors:
        return "warning", errors
    return "valid", []


def _blocked_result(
    object_name: str,
    source_code_version: str,
    p_version: str,
    issues: list[str],
) -> dict:
    """Return a safe fallback result when guardrails block the request."""
    return {
        "functional_intent": "Analysis blocked by guardrails.",
        "risk_level": "High",
        "risk_rationale": "; ".join(issues),
        "disposition": "Pending",
        "disposition_reasoning": "Blocked before LLM call.",
        "reasoning": "Blocked before LLM call.",
        "technical_effort": "",
        "technical_effort_rationale": "",
        "business_impact": "",
        "business_impact_rationale": "",
        "confidence_score": 0.0,
        "modernization_plan": "",
        "modernization_plan_steps": [],
        "dependencies": [],
        "suggested_sap_replacement": {},
        "quality_indicators": {},
        "_raw": "",
        "_input_tokens": 0,
        "_output_tokens": 0,
        "_total_tokens": 0,
        "_input_cost_usd": 0.0,
        "_output_cost_usd": 0.0,
        "_total_cost_usd": 0.0,
        "_prompt_version": p_version,
        "_prompt_hash": "",
        "_source_code_version": source_code_version,
        "_model": LLM_MODEL,
        "_response_timestamp": datetime.now(timezone.utc).isoformat(),
        "_request_status": "blocked",
        "_validation_status": "invalid",
        "_validation_errors": issues,
        "_sensitive_data_blocked": True,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def analyze_object(
    object_name: str,
    object_type: str,
    package: str,
    business_process: str,
    source_code: str,
) -> dict:
    """
    Analyse an ABAP object via AI Core.

    Returns a dict with all parsed fields PLUS metadata keys prefixed with '_':
        _raw, _input_tokens, _output_tokens, _total_tokens,
        _input_cost_usd, _output_cost_usd, _total_cost_usd,
        _prompt_version, _prompt_hash, _source_code_version,
        _model, _response_timestamp, _request_status,
        _validation_status, _validation_errors, _sensitive_data_blocked
    """
    source_code_version = sha256_prefix(source_code)

    # Guardrail check
    blocked, guardrail_issues = _check_guardrails(source_code)
    if blocked:
        logger.warning("Guardrail BLOCKED analysis of %s: %s", object_name, guardrail_issues)
        return _blocked_result(object_name, source_code_version, ANALYSIS_PROMPT_VERSION, guardrail_issues)

    sensitive_blocked = len(guardrail_issues) > 0  # warned but not blocked

    clean_source = _sanitize(source_code)
    user_msg = ANALYSIS_USER_TMPL.format(
        object_name=object_name,
        object_type=object_type,
        package=package,
        business_process=business_process,
        source_code=clean_source,
    )
    full_prompt = ANALYSIS_SYSTEM + "\n" + user_msg
    p_hash = prompt_hash(full_prompt)

    raw = ""
    usage: dict[str, int] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    request_status = "failed"
    parsed: dict = {}

    try:
        raw, usage = _chat(
            [
                {"role": "system", "content": ANALYSIS_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=2048,
        )
        request_status = "success"

        # Strip markdown fences if present
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)

        parsed = json.loads(text)

    except json.JSONDecodeError as exc:
        logger.error("JSON parse error for %s: %s | raw=%s", object_name, exc, raw[:500])
        request_status = "parse_error"
        parsed = {
            "functional_intent": "",
            "risk_level": "Unknown",
            "risk_rationale": "",
            "disposition": "Pending",
            "disposition_reasoning": "",
            "reasoning": f"JSON parse error: {exc}",
            "technical_effort": "",
            "technical_effort_rationale": "",
            "business_impact": "",
            "business_impact_rationale": "",
            "confidence_score": 0.0,
            "dependencies": [],
            "suggested_sap_replacement": {},
            "modernization_plan": "",
            "modernization_plan_steps": [],
            "quality_indicators": {},
        }
    except Exception as exc:
        logger.error("AI call failed for %s: %s", object_name, exc)
        request_status = "error"
        parsed = {
            "functional_intent": "",
            "risk_level": "Unknown",
            "risk_rationale": "",
            "disposition": "Pending",
            "disposition_reasoning": "",
            "reasoning": f"AI service error: {exc}",
            "technical_effort": "",
            "technical_effort_rationale": "",
            "business_impact": "",
            "business_impact_rationale": "",
            "confidence_score": 0.0,
            "dependencies": [],
            "suggested_sap_replacement": {},
            "modernization_plan": "",
            "modernization_plan_steps": [],
            "quality_indicators": {},
        }

    validation_status, validation_errors = _validate_analysis(parsed)

    inp = usage["input_tokens"]
    out = usage["output_tokens"]
    tot = usage["total_tokens"]

    parsed.update(
        {
            "_raw": raw,
            "_input_tokens": inp,
            "_output_tokens": out,
            "_total_tokens": tot,
            "_input_cost_usd": _cost(inp, _IN_COST_PER_1M),
            "_output_cost_usd": _cost(out, _OUT_COST_PER_1M),
            "_total_cost_usd": _cost(inp, _IN_COST_PER_1M) + _cost(out, _OUT_COST_PER_1M),
            "_prompt_version": ANALYSIS_PROMPT_VERSION,
            "_prompt_hash": p_hash,
            "_source_code_version": source_code_version,
            "_model": LLM_MODEL,
            "_response_timestamp": datetime.now(timezone.utc).isoformat(),
            "_request_status": request_status,
            "_validation_status": validation_status,
            "_validation_errors": validation_errors,
            "_sensitive_data_blocked": sensitive_blocked,
        }
    )
    return parsed


def generate_code(
    object_name: str,
    object_type: str,
    disposition: str,
    modernization_plan: str,
    source_code: str,
) -> dict:
    """
    Generate modernised code for an ABAP object.

    Returns dict with keys:
        generated_code, assumptions, generation_notes,
        _input_tokens, _output_tokens, _total_tokens,
        _input_cost_usd, _output_cost_usd, _total_cost_usd,
        _prompt_version, _prompt_hash, _source_code_version,
        _model, _request_status
    """
    source_code_version = sha256_prefix(source_code)

    blocked, guardrail_issues = _check_guardrails(source_code)
    if blocked:
        return {
            "generated_code": f"-- Blocked by guardrails: {'; '.join(guardrail_issues)}",
            "assumptions": [],
            "generation_notes": "; ".join(guardrail_issues),
            "_input_tokens": 0,
            "_output_tokens": 0,
            "_total_tokens": 0,
            "_input_cost_usd": 0.0,
            "_output_cost_usd": 0.0,
            "_total_cost_usd": 0.0,
            "_prompt_version": CODEGEN_PROMPT_VERSION,
            "_prompt_hash": "",
            "_source_code_version": source_code_version,
            "_model": LLM_MODEL,
            "_request_status": "blocked",
        }

    clean_source = _sanitize(source_code)
    user_msg = CODEGEN_USER_TMPL.format(
        object_name=object_name,
        object_type=object_type,
        disposition=disposition,
        modernization_plan=modernization_plan,
        source_code=clean_source,
    )
    full_prompt = CODEGEN_SYSTEM + "\n" + user_msg
    p_hash = prompt_hash(full_prompt)

    raw = ""
    usage: dict[str, int] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    request_status = "failed"

    try:
        raw, usage = _chat(
            [
                {"role": "system", "content": CODEGEN_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=4096,
        )
        request_status = "success"
    except Exception as exc:
        logger.error("Code generation failed for %s: %s", object_name, exc)
        raw = f"-- Code generation error: {exc}"
        request_status = "error"

    inp = usage["input_tokens"]
    out = usage["output_tokens"]

    return {
        "generated_code": raw,
        "assumptions": [],
        "generation_notes": "",
        "_input_tokens": inp,
        "_output_tokens": out,
        "_total_tokens": inp + out,
        "_input_cost_usd": _cost(inp, _IN_COST_PER_1M),
        "_output_cost_usd": _cost(out, _OUT_COST_PER_1M),
        "_total_cost_usd": _cost(inp, _IN_COST_PER_1M) + _cost(out, _OUT_COST_PER_1M),
        "_prompt_version": CODEGEN_PROMPT_VERSION,
        "_prompt_hash": p_hash,
        "_source_code_version": source_code_version,
        "_model": LLM_MODEL,
        "_request_status": request_status,
    }
