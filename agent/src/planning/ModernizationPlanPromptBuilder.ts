/**
 * N-CoreShift – Phase 8: Modernization Plan Prompt Builder
 *
 * Builds the system + user prompts for plan generation.
 * Source content is sanitized before insertion to defend against prompt injection.
 * The LLM is never shown raw ABAP source repositories.
 */

import { PLAN_SECTION_KEYS, PLAN_SECTION_TITLES, RESPONSIBLE_ROLES } from './types.js';
import type { PlanningRequest } from './types.js';

export interface PlanPrompt {
  system: string;
  user: string;
}

// ── Sanitisation (matches Phase 6/7 approach) ─────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(your\s+)?(previous\s+|all\s+)?instructions/gi,
  /you\s+are\s+now/gi,
  /disregard\s+(the\s+)?system\s+prompt/gi,
  /override\s+(the\s+)?system/gi,
  /act\s+as\s+(an?\s+)?unrestricted/gi,
  /forget\s+(your\s+)?previous/gi,
  /new\s+instructions?\s*:/gi,
  /system\s+prompt\s*:/gi,
];

export function sanitizeForPrompt(text: string): string {
  let safe = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ');
  for (const pattern of INJECTION_PATTERNS) {
    safe = safe.replace(pattern, '[CONTENT_REDACTED]');
  }
  return safe.slice(0, 3000);
}

// ── Prompt builder ────────────────────────────────────────────────────────

export function buildPlanPrompt(req: PlanningRequest): PlanPrompt {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(req);
  return { system, user };
}

function buildSystemPrompt(): string {
  const sectionList = PLAN_SECTION_KEYS.map(k => `  - ${k}: "${PLAN_SECTION_TITLES[k]}"`).join('\n');
  const roleList = RESPONSIBLE_ROLES.map(r => `  - ${r}`).join('\n');

  return `You are an expert SAP modernization consultant assistant within N-CoreShift.

Your task is to generate a structured, consultant-oriented modernization plan for a single SAP custom object.
The plan is based on an APPROVED Clean Core assessment and approved functional intent analysis.

CRITICAL RULES:
1. Base the plan ONLY on the assessment, functional intent, and landscape context provided.
2. Do NOT invent SAP APIs, BAdIs, CDS views, released objects, or configuration steps.
3. Every named SAP artifact must be listed under SAP_OBJECTS_TO_VERIFY for consultant confirmation.
4. Do NOT claim a plan step is complete or verified — all steps start as PENDING.
5. The plan is a consultant-ready DRAFT. It must be labeled accordingly.
6. Separate business requirements from technical implementation throughout.
7. The implementation steps must assign a responsible role to each step.
8. You must produce ALL 18 required sections. Do not omit any section.
9. Any uncertainty must be captured as an assumption or in the relevant section.
10. Do NOT generate executable code in the plan — that is Phase 9 (Code Generation).

REQUIRED SECTIONS (all 18 must appear in the output):
${sectionList}

VALID RESPONSIBLE ROLES for implementation steps:
${roleList}

OUTPUT FORMAT:
Respond with a single JSON object (no markdown fences) with this structure:
{
  "summary": "1-3 sentence executive summary of the modernization approach",
  "estimatedComplexity": "LOW | MEDIUM | HIGH | VERY_HIGH",
  "keyRisks": ["risk 1", "risk 2"],
  "assumptions": ["assumption 1", "assumption 2"],
  "sections": [
    {
      "key": "CURRENT_STATE",
      "content": "narrative description of current state"
    },
    {
      "key": "IMPLEMENTATION_STEPS",
      "content": "overview of implementation approach",
      "steps": [
        {
          "sequence": 1,
          "title": "step title",
          "description": "detailed description of what to do",
          "responsibleRole": "SOLUTION_ARCHITECT",
          "prerequisites": ["prerequisite 1"],
          "verification": "how to verify this step is complete",
          "status": "PENDING"
        }
      ]
    }
  ]
}

Every section except IMPLEMENTATION_STEPS uses only "key" and "content".
IMPLEMENTATION_STEPS uses "key", "content", and "steps".
All step "status" values must be "PENDING".
Do not include any text before or after the JSON object.`;
}

function buildUserPrompt(req: PlanningRequest): string {
  const a = req.assessment;
  const fi = req.functionalIntent;

  const riskSignals = a.verificationRequired.length > 0
    ? a.verificationRequired.slice(0, 10).map(v => `  - ${sanitizeForPrompt(v)}`).join('\n')
    : '  (none flagged)';

  const evidence = a.evidence.slice(0, 8).map(ev =>
    `  - [${ev.confidence}] ${sanitizeForPrompt(ev.description)}` +
    (ev.namedSapArtifact ? ` (artifact: ${sanitizeForPrompt(ev.namedSapArtifact)})` : '')
  ).join('\n');

  const businessRules = fi.businessRules.slice(0, 6).map(r => `  - ${sanitizeForPrompt(r)}`).join('\n');
  const integrations = fi.integrations.slice(0, 5).map(i => `  - ${sanitizeForPrompt(i)}`).join('\n');

  return `Generate a modernization plan for the following SAP custom object.

=== OBJECT ===
Name: ${sanitizeForPrompt(req.objectName)}
Type: ${sanitizeForPrompt(req.objectType)}
Analysis ID: ${req.analysisId}

=== APPROVED ASSESSMENT ===
Disposition: ${a.disposition}
Clean Core Risk: ${a.cleanCoreRisk}
Current Pattern: ${a.currentPattern}
Finding: ${sanitizeForPrompt(a.finding)}
Recommended Target Pattern: ${sanitizeForPrompt(a.recommendedTargetPattern)}
Reasoning: ${sanitizeForPrompt(a.reasoning)}
Confidence: ${a.confidence}

Verification Required Items:
${riskSignals}

Supporting Evidence:
${evidence || '  (no evidence items)'}

=== FUNCTIONAL INTENT (APPROVED) ===
Business Requirement: ${sanitizeForPrompt(fi.businessObjective)}
Functional Summary: ${sanitizeForPrompt(fi.functionalSummary)}
Business Process: ${sanitizeForPrompt(fi.businessProcess)}
Technical Pattern (legacy): ${sanitizeForPrompt(fi.technicalPattern)}
User Interaction: ${sanitizeForPrompt(fi.userInteraction)}

Business Rules:
${businessRules || '  (none documented)'}

Integrations:
${integrations || '  (none documented)'}

Uncertainties: ${fi.uncertainties.slice(0, 5).map(u => sanitizeForPrompt(u)).join('; ') || 'none'}

=== TARGET LANDSCAPE ===
Target Edition: ${sanitizeForPrompt(req.targetEdition)}
Target Release: ${sanitizeForPrompt(req.targetRelease)}
Transformation Scenario: ${sanitizeForPrompt(req.transformationScenario)}

=== CLEAN CORE POLICY ===
Posture: ${req.cleanCorePolicy.posture}
Core Modifications: ${req.cleanCorePolicy.coreModificationsPermitted}
Classic Exits: ${req.cleanCorePolicy.classicExitsPermitted}
Direct Table Updates: ${req.cleanCorePolicy.directTableUpdatesPermitted}
Unreleased Objects: ${req.cleanCorePolicy.unreleasedObjectsPermitted}
Released API Required: ${req.cleanCorePolicy.releasedApiObjectRequired}
Architecture Review Required: ${req.cleanCorePolicy.architectureReviewRequired}
Extension Preference Order: ${req.cleanCorePolicy.extensionPreferenceOrder.join(' > ')}

=== INSTRUCTION ===
Generate a complete 18-section modernization plan.
All 18 section keys must appear. Implementation steps must each have sequence, title,
description, responsibleRole, prerequisites, verification, and status="PENDING".
Do not fabricate SAP artifacts — list them under SAP_OBJECTS_TO_VERIFY instead.
Output only valid JSON.`;
}
