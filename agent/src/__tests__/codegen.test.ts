/**
 * N-CoreShift – Phase 9: Code Generation Service Tests
 */

import { describe, it, expect } from "@jest/globals";
import {
  CodeGenerationService,
  checkGenerationGate,
} from "../codegen/CodeGenerationService.js";
import { MockCodeGenAIProvider } from "../codegen/MockCodeGenAIProvider.js";
import type {
  CodeGenerationRequest,
  ObjectAssessment,
  ModernizationPlan,
  CleanCorePolicyContext,
  TargetExtensibilityContext,
} from "../codegen/types.js";
import type { FunctionalIntentResult } from "../intent/types.js";
import type { AssessmentEvidenceItem } from "../assessment/types.js";

const T = "tenant-1";
const P = "project-1";
const A = "analysis-1";
const NOW = "2026-09-27T12:00:00.000Z";
const MANDATORY_LABEL =
  "Generated implementation draft - consultant validation required.";

// ── Fixture helpers ───────────────────────────────────────────────────────

function makeEvidence(
  o?: Partial<AssessmentEvidenceItem>,
): AssessmentEvidenceItem {
  return {
    id: "ev-001",
    type: "BADI_AVAILABLE",
    description: "BAdI SD_PRICING_BADI available.",
    source: "AI_DERIVED",
    confidence: "VERIFIED",
    applicableEditions: ["S4HANA_CLOUD_PUBLIC"],
    applicableFromRelease: "2023",
    verificationRequired: false,
    ...o,
  };
}

function makeAssessment(o?: Partial<ObjectAssessment>): ObjectAssessment {
  return {
    id: "assess-001",
    tenantId: T,
    projectId: P,
    analysisId: A,
    objectId: "obj-001",
    objectName: "EXIT_PRICING_001",
    objectType: "EXIT",
    disposition: "REFACTOR",
    cleanCoreRisk: "HIGH",
    currentPattern: "CLASSIC_USER_EXIT",
    businessRequirement: "Pricing exit must continue to function.",
    finding: "Direct table access detected.",
    recommendedTargetPattern: "BAdI SD_PRICING_BADI.",
    reasoning: "Released BAdI covers all condition types.",
    targetEdition: "S4HANA_CLOUD_PUBLIC",
    targetRelease: "2023",
    evidence: [makeEvidence()],
    confidence: 0.88,
    assumptions: ["BAdI covers all condition types."],
    verificationRequired: [],
    architectureDecisionStatus: "APPROVED",
    requiresRevalidation: false,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  };
}

function makePlan(o?: Partial<ModernizationPlan>): ModernizationPlan {
  return {
    id: "plan-001",
    tenantId: T,
    projectId: P,
    analysisId: A,
    objectId: "obj-001",
    objectName: "EXIT_PRICING_001",
    objectType: "EXIT",
    assessmentId: "assess-001",
    state: "APPROVED",
    sections: [],
    summary: "Replace legacy exit with BAdI.",
    estimatedComplexity: "MEDIUM",
    keyRisks: ["BAdI filter conflicts."],
    assumptions: ["BAdI available."],
    requiresRevalidation: false,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  };
}

function makeFunctionalIntent(
  o?: Partial<FunctionalIntentResult>,
): FunctionalIntentResult {
  return {
    functionalSummary: "Custom pricing logic.",
    businessProcess: "Order-to-Cash",
    moduleCandidates: ["SD"],
    businessObjective: "Validate pricing before billing.",
    inputs: ["Sales order header"],
    outputs: ["Pricing conditions"],
    businessRules: ["Apply group Z pricing."],
    SAPObjectsUsed: ["KONH", "KONP"],
    integrations: [],
    userInteraction: "background",
    technicalPattern: "USER_EXIT",
    uncertainties: [],
    clarifyingQuestions: [],
    confidence: "HIGH",
    ...o,
  };
}

function makePolicy(
  o?: Partial<CleanCorePolicyContext>,
): CleanCorePolicyContext {
  return {
    posture: "STRICT",
    coreModificationsPermitted: "PROHIBITED",
    classicExitsPermitted: "PROHIBITED",
    directTableUpdatesPermitted: "PROHIBITED",
    unreleasedObjectsPermitted: "PROHIBITED",
    releasedApiObjectRequired: true,
    architectureReviewRequired: true,
    extensionPreferenceOrder: ["SAP_STANDARD", "CONFIGURATION", "KEY_USER"],
    ...o,
  };
}

function makeExtensibility(
  o?: Partial<TargetExtensibilityContext>,
): TargetExtensibilityContext {
  return {
    keyUserExtensibilityAllowed: "YES",
    developerExtensibilityAllowed: "YES",
    abapCloudRequired: "YES",
    classicAbapAllowed: "NO",
    sideBySideBtpAllowed: "YES",
    releasedApisRequired: "YES",
    ...o,
  };
}

function makeRequest(
  o?: Partial<CodeGenerationRequest>,
): CodeGenerationRequest {
  return {
    tenantId: T,
    projectId: P,
    analysisId: A,
    objectId: "obj-001",
    objectName: "EXIT_PRICING_001",
    objectType: "EXIT",
    assessmentId: "assess-001",
    planId: "plan-001",
    assessment: makeAssessment(),
    plan: makePlan(),
    functionalIntent: makeFunctionalIntent(),
    targetEdition: "S4HANA_CLOUD_PUBLIC",
    targetRelease: "2023",
    transformationScenario: "GREENFIELD",
    cleanCorePolicy: makePolicy(),
    targetExtensibility: makeExtensibility(),
    landscapeReadinessState: "APPROVED_FOR_CODE_GENERATION",
    artifactType: "ABAP_CLOUD",
    ...o,
  };
}

// ── Gate unit tests (standalone) ──────────────────────────────────────────

describe("checkGenerationGate (standalone)", () => {
  it("passes all 7 gates with a fully valid request", () => {
    const r = checkGenerationGate(makeRequest());
    expect(r.allowed).toBe(true);
    expect(r.blockedReasons).toHaveLength(0);
    expect(r.landscapeApprovedForCodeGeneration).toBe(true);
    expect(r.targetEditionPresent).toBe(true);
    expect(r.targetReleasePresent).toBe(true);
    expect(r.cleanCorePolicyPresent).toBe(true);
    expect(r.recommendationApproved).toBe(true);
    expect(r.planApproved).toBe(true);
    expect(r.technicalPatternVerified).toBe(true);
  });

  it("Gate 1: blocks when landscapeReadinessState != APPROVED_FOR_CODE_GENERATION", () => {
    const r = checkGenerationGate(
      makeRequest({ landscapeReadinessState: "APPROVED_FOR_ASSESSMENT" }),
    );
    expect(r.allowed).toBe(false);
    expect(r.landscapeApprovedForCodeGeneration).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("Gate 1"))).toBe(true);
  });

  it("Gate 1: blocks when landscapeReadinessState is DRAFT", () => {
    const r = checkGenerationGate(
      makeRequest({ landscapeReadinessState: "DRAFT" }),
    );
    expect(r.allowed).toBe(false);
    expect(r.landscapeApprovedForCodeGeneration).toBe(false);
  });

  it("Gate 2: blocks when targetEdition is whitespace", () => {
    const r = checkGenerationGate(makeRequest({ targetEdition: "   " }));
    expect(r.allowed).toBe(false);
    expect(r.targetEditionPresent).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("Gate 2"))).toBe(true);
  });

  it("Gate 2: blocks when targetEdition is empty", () => {
    const r = checkGenerationGate(makeRequest({ targetEdition: "" }));
    expect(r.allowed).toBe(false);
    expect(r.targetEditionPresent).toBe(false);
  });

  it("Gate 3: blocks when targetRelease is empty", () => {
    const r = checkGenerationGate(makeRequest({ targetRelease: "" }));
    expect(r.allowed).toBe(false);
    expect(r.targetReleasePresent).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("Gate 3"))).toBe(true);
  });

  it("Gate 3: blocks when targetRelease is whitespace", () => {
    const r = checkGenerationGate(makeRequest({ targetRelease: "  " }));
    expect(r.allowed).toBe(false);
    expect(r.targetReleasePresent).toBe(false);
  });

  it("Gate 4: blocks when cleanCorePolicy posture is empty", () => {
    const r = checkGenerationGate(
      makeRequest({ cleanCorePolicy: makePolicy({ posture: "" as never }) }),
    );
    expect(r.allowed).toBe(false);
    expect(r.cleanCorePolicyPresent).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("Gate 4"))).toBe(true);
  });

  it("Gate 5: blocks when architectureDecisionStatus is PENDING", () => {
    const r = checkGenerationGate(
      makeRequest({
        assessment: makeAssessment({ architectureDecisionStatus: "PENDING" }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.recommendationApproved).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("Gate 5"))).toBe(true);
  });

  it("Gate 5: blocks when architectureDecisionStatus is UNDER_REVIEW", () => {
    const r = checkGenerationGate(
      makeRequest({
        assessment: makeAssessment({
          architectureDecisionStatus: "UNDER_REVIEW",
        }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.recommendationApproved).toBe(false);
  });

  it("Gate 6: blocks when plan state is DRAFT", () => {
    const r = checkGenerationGate(
      makeRequest({ plan: makePlan({ state: "DRAFT" }) }),
    );
    expect(r.allowed).toBe(false);
    expect(r.planApproved).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("Gate 6"))).toBe(true);
  });

  it("Gate 6: blocks when plan state is APPROVED but requiresRevalidation=true", () => {
    const r = checkGenerationGate(
      makeRequest({
        plan: makePlan({ state: "APPROVED", requiresRevalidation: true }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.planApproved).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("revalidation"))).toBe(
      true,
    );
  });

  it("Gate 7: blocks when evidence verificationRequired=true and confidence=REQUIRES_VERIFICATION", () => {
    const r = checkGenerationGate(
      makeRequest({
        assessment: makeAssessment({
          evidence: [
            makeEvidence({
              id: "ev-unverified",
              verificationRequired: true,
              confidence: "REQUIRES_VERIFICATION",
            }),
          ],
        }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.technicalPatternVerified).toBe(false);
    expect(r.blockedReasons.some((x) => x.includes("Gate 7"))).toBe(true);
    expect(r.blockedReasons.some((x) => x.includes("ev-unverified"))).toBe(
      true,
    );
  });

  it("Gate 7: passes when verificationRequired=true but confidence=VERIFIED", () => {
    const r = checkGenerationGate(
      makeRequest({
        assessment: makeAssessment({
          evidence: [
            makeEvidence({ verificationRequired: true, confidence: "VERIFIED" }),
          ],
        }),
      }),
    );
    expect(r.technicalPatternVerified).toBe(true);
  });

  it("Gate 7: passes when verificationRequired=false regardless of confidence", () => {
    const r = checkGenerationGate(
      makeRequest({
        assessment: makeAssessment({
          evidence: [
            makeEvidence({
              verificationRequired: false,
              confidence: "REQUIRES_VERIFICATION",
            }),
          ],
        }),
      }),
    );
    expect(r.technicalPatternVerified).toBe(true);
  });

  it("accumulates multiple blocked reasons when all gates fail", () => {
    const r = checkGenerationGate(
      makeRequest({
        landscapeReadinessState: "DRAFT",
        targetEdition: "",
        targetRelease: "",
        cleanCorePolicy: makePolicy({ posture: "" as never }),
        assessment: makeAssessment({ architectureDecisionStatus: "PENDING" }),
        plan: makePlan({ state: "DRAFT" }),
      }),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockedReasons.length).toBeGreaterThanOrEqual(6);
  });
});

// ── CodeGenerationService.generateArtifact ────────────────────────────────

describe("CodeGenerationService.generateArtifact", () => {
  it("VALID: returns a well-formed artifact with all sections populated", async () => {
    const svc = new CodeGenerationService(new MockCodeGenAIProvider({ mode: "VALID" }));
    const res = await svc.generateArtifact(makeRequest());
    const { artifact, parseResult, gateResult } = res;

    expect(gateResult.allowed).toBe(true);
    expect(parseResult.success).toBe(true);
    expect(parseResult.errors).toHaveLength(0);

    expect(artifact.tenantId).toBe(T);
    expect(artifact.projectId).toBe(P);
    expect(artifact.objectId).toBe("obj-001");
    expect(artifact.validationStatus).toBe("PENDING_REVIEW");
    expect(artifact.artifactError).toBeUndefined();

    // Mandatory label must appear in PURPOSE section
    expect(artifact.label).toBe(MANDATORY_LABEL);
    expect(artifact.sections.PURPOSE).toContain(MANDATORY_LABEL);

    // All 9 required sections present and non-empty
    expect(artifact.sections.GENERATED_CODE.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.PURPOSE.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.PRECONDITIONS.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.CONFIGURATION_REQUIRED.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.DEPENDENCIES.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.WHERE_IT_BELONGS.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.HOW_TO_VALIDATE.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.ASSUMPTIONS.trim().length).toBeGreaterThan(0);
    expect(artifact.sections.ITEMS_REQUIRING_VERIFICATION.trim().length).toBeGreaterThan(0);

    // Evidence references populated
    expect(artifact.evidenceReferences.length).toBeGreaterThan(0);
    expect(artifact.evidenceReferences[0]).toBe("ev-001");

    // Prompt version recorded
    expect(artifact.generationPromptVersion).toBeTruthy();
    expect(typeof artifact.generationPromptVersion).toBe("string");

    // History entry created
    const history = svc.getArtifactHistory(artifact.id);
    expect(history).toHaveLength(1);
    expect(history[0].changeNote).toContain("generated");
  });

  it("VALID_CAP_NODEJS: TypeScript artifact targets BTP_CF", async () => {
    const svc = new CodeGenerationService(
      new MockCodeGenAIProvider({ mode: "VALID_CAP_NODEJS" }),
    );
    const res = await svc.generateArtifact(
      makeRequest({ artifactType: "CAP_NODEJS" }),
    );
    expect(res.gateResult.allowed).toBe(true);
    expect(res.parseResult.success).toBe(true);
    // language and targetPlatform are direct fields on the artifact, not section keys
    expect(res.artifact.language).toBe("TypeScript");
    expect(res.artifact.targetPlatform).toBe("BTP_CF");
  });

  it("MALFORMED_JSON: parseResult.success=false, error field=root", async () => {
    const svc = new CodeGenerationService(
      new MockCodeGenAIProvider({ mode: "MALFORMED_JSON" }),
    );
    const res = await svc.generateArtifact(makeRequest());
    expect(res.gateResult.allowed).toBe(true);
    expect(res.parseResult.success).toBe(false);
    expect(res.parseResult.errors.length).toBeGreaterThan(0);
    expect(res.parseResult.errors[0].field).toBe("root");
    expect(res.artifact.artifactError).toBeTruthy();
  });

  it("MISSING_SECTIONS: parseResult.success=false, multiple missing-field errors", async () => {
    const svc = new CodeGenerationService(
      new MockCodeGenAIProvider({ mode: "MISSING_SECTIONS" }),
    );
    const res = await svc.generateArtifact(makeRequest());
    expect(res.parseResult.success).toBe(false);
    expect(res.parseResult.errors.length).toBeGreaterThanOrEqual(3);
    const fields = res.parseResult.errors.map((e) => e.field);
    expect(fields.some((f) => f === "generatedCode")).toBe(true);
  });

  it("PROVIDER_ERROR: artifact.artifactError set, parseResult has provider error", async () => {
    const svc = new CodeGenerationService(
      new MockCodeGenAIProvider({ mode: "PROVIDER_ERROR" }),
    );
    const res = await svc.generateArtifact(makeRequest());
    expect(res.gateResult.allowed).toBe(true);
    expect(res.parseResult.success).toBe(false);
    const fields = res.parseResult.errors.map((e) => e.field);
    expect(fields.some((f) => f === "provider")).toBe(true);
    expect(res.artifact.artifactError).toBeTruthy();
  });

  it("EMPTY_GENERATED_CODE: parseResult.success=false, error for generatedCode", async () => {
    const svc = new CodeGenerationService(
      new MockCodeGenAIProvider({ mode: "EMPTY_GENERATED_CODE" }),
    );
    const res = await svc.generateArtifact(makeRequest());
    expect(res.parseResult.success).toBe(false);
    const fields = res.parseResult.errors.map((e) => e.field);
    expect(fields.some((f) => f === "generatedCode")).toBe(true);
  });

  it("gate-blocked request: gateResult.allowed=false, artifact.artifactError set, no AI call", async () => {
    const svc = new CodeGenerationService(new MockCodeGenAIProvider({ mode: "VALID" }));
    const blockedReq = makeRequest({
      landscapeReadinessState: "DRAFT",
    });
    const res = await svc.generateArtifact(blockedReq);
    expect(res.gateResult.allowed).toBe(false);
    expect(res.artifact.artifactError).toBeTruthy();
    expect(res.parseResult.success).toBe(false);
    expect(res.parseResult.errors[0].field).toBe("gate");
  });
});

// ── applyConsultantDecision ───────────────────────────────────────────────

describe("CodeGenerationService.applyConsultantDecision", () => {
  async function makeArtifact() {
    const svc = new CodeGenerationService(new MockCodeGenAIProvider({ mode: "VALID" }));
    const { artifact } = await svc.generateArtifact(makeRequest());
    return { svc, artifact };
  }

  it("ACCEPT: sets validationStatus=ACCEPTED, acceptedBy", async () => {
    const { svc, artifact } = await makeArtifact();
    const updated = svc.applyConsultantDecision(artifact.id, {
      action: "ACCEPT",
      consultantId: "consultant-1",
      notes: "Looks good.",
    });
    expect(updated.validationStatus).toBe("ACCEPTED");
    expect(updated.acceptedBy).toBe("consultant-1");
    expect(updated.rejectedBy).toBeUndefined();
  });

  it("REJECT: sets validationStatus=REJECTED, rejectedBy, rejectionReason", async () => {
    const { svc, artifact } = await makeArtifact();
    const updated = svc.applyConsultantDecision(artifact.id, {
      action: "REJECT",
      consultantId: "consultant-1",
      notes: "Needs rework.",
      rejectionReason: "Incorrect BAdI filter logic.",
    });
    expect(updated.validationStatus).toBe("REJECTED");
    expect(updated.rejectedBy).toBe("consultant-1");
    expect(updated.rejectionReason).toBe("Incorrect BAdI filter logic.");
    expect(updated.acceptedBy).toBeUndefined();
  });

  it("EDIT: merges edited sections, validationStatus remains PENDING_REVIEW", async () => {
    const { svc, artifact } = await makeArtifact();
    const updated = svc.applyConsultantDecision(artifact.id, {
      action: "EDIT",
      consultantId: "consultant-1",
      notes: "Fixed implementation.",
      editedSections: { PURPOSE: "Edited purpose text." },
    });
    expect(updated.validationStatus).toBe("PENDING_REVIEW");
    expect(updated.sections.PURPOSE).toBe("Edited purpose text.");
  });

  it("REGENERATE: sets validationStatus=REGENERATED", async () => {
    const { svc, artifact } = await makeArtifact();
    const updated = svc.applyConsultantDecision(artifact.id, {
      action: "REGENERATE",
      consultantId: "consultant-1",
      notes: "Please regenerate with updated context.",
    });
    expect(updated.validationStatus).toBe("REGENERATED");
  });

  it("throws when artifactId is unknown", async () => {
    const { svc } = await makeArtifact();
    expect(() =>
      svc.applyConsultantDecision("non-existent-id", {
        action: "ACCEPT",
        consultantId: "consultant-1",
        notes: "Accepts.",
      }),
    ).toThrow();
  });

  it("decision appends to artifact history", async () => {
    const { svc, artifact } = await makeArtifact();
    svc.applyConsultantDecision(artifact.id, {
      action: "ACCEPT",
      consultantId: "consultant-1",
      notes: "Approved.",
    });
    const history = svc.getArtifactHistory(artifact.id);
    expect(history.length).toBe(2); // generated + accepted
    expect(history[1].changedBy).toBe("consultant-1");
    expect(history[1].changeNote).toBeTruthy();
  });
});

// ── getArtifactHistory ────────────────────────────────────────────────────

describe("CodeGenerationService.getArtifactHistory", () => {
  it("returns empty array for unknown artifactId", () => {
    const svc = new CodeGenerationService(new MockCodeGenAIProvider({ mode: "VALID" }));
    expect(svc.getArtifactHistory("no-such-id")).toEqual([]);
  });

  it("history entries have changedBy, changedAt, changeNote", async () => {
    const svc = new CodeGenerationService(
      new MockCodeGenAIProvider({ mode: "VALID" }),
    );
    const { artifact } = await svc.generateArtifact(makeRequest());
    const history = svc.getArtifactHistory(artifact.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const entry = history[0];
    expect(entry.changedBy).toBe("SYSTEM");
    expect(typeof entry.changedAt).toBe("string");
    expect(entry.changeNote.trim().length).toBeGreaterThan(0);
    expect(entry.artifactType).toBe("ABAP_CLOUD");
  });

  it("multiple decisions accumulate entries in order", async () => {
    const svc = new CodeGenerationService(
      new MockCodeGenAIProvider({ mode: "VALID" }),
    );
    const { artifact } = await svc.generateArtifact(makeRequest());
    svc.applyConsultantDecision(artifact.id, {
      action: "ACCEPT",
      consultantId: "c-1",
      notes: "First accept.",
    });
    svc.applyConsultantDecision(artifact.id, {
      action: "REJECT",
      consultantId: "c-2",
      rejectionReason: "Changed mind.",
    });
    const history = svc.getArtifactHistory(artifact.id);
    expect(history.length).toBe(3);
    expect(history[0].changedBy).toBe("SYSTEM");
    expect(history[1].changedBy).toBe("c-1");
    expect(history[2].changedBy).toBe("c-2");
  });
});
