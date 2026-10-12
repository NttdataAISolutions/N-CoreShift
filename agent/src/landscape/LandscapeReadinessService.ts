/**
 * N-CoreShift – Phase 2: LandscapeReadinessService
 *
 * Computes readiness state from project, source, target, and policy data.
 * This is the authoritative gate that determines whether assessment and
 * code generation are permitted (Playbook Section 5.5, Principles 2 & 3).
 */

import {
  CleanCorePolicy,
  GovernancePolicy,
  LandscapeReadinessResult,
  LandscapeReadinessState,
  LandscapeSection,
  MissingField,
  ProjectContext,
  ReadinessWarning,
  RevalidationFlag,
  RevalidationReason,
  SectionStatus,
  SourceSystemProfile,
  TargetSystemProfile,
} from './types.js';

export interface LandscapeReadinessInput {
  project: ProjectContext | null;
  sourceSystem: SourceSystemProfile | null;
  targetSystem: TargetSystemProfile | null;
  cleanCorePolicy: CleanCorePolicy | null;
  governancePolicy: GovernancePolicy | null;
}

// ── Required field definitions ─────────────────────────────────────────────

const REQUIRED_PROJECT_FIELDS: Array<{ field: keyof ProjectContext; label: string }> = [
  { field: 'name', label: 'Project Name' },
  { field: 'customerName', label: 'Customer Name' },
  { field: 'projectIdentifier', label: 'Project Identifier' },
  { field: 'transformationScenario', label: 'Transformation Scenario' },
];

const REQUIRED_SOURCE_FIELDS: Array<{ field: keyof SourceSystemProfile; label: string }> = [
  { field: 'systemName', label: 'Source System Name' },
  { field: 'erpProduct', label: 'Source ERP Product' },
  { field: 'deploymentModel', label: 'Source Deployment Model' },
  { field: 'accessMode', label: 'Source Access Mode' },
];

const REQUIRED_TARGET_FIELDS: Array<{ field: keyof TargetSystemProfile; label: string }> = [
  { field: 'targetEdition', label: 'Target Edition' },
  { field: 'targetRelease', label: 'Target Release / Version' },
  { field: 'keyUserExtensibilityAllowed', label: 'Key-User Extensibility Policy' },
  { field: 'developerExtensibilityAllowed', label: 'Developer Extensibility Policy' },
  { field: 'abapCloudRequired', label: 'ABAP Cloud Requirement' },
  { field: 'classicAbapAllowed', label: 'Classic ABAP Policy' },
  { field: 'sideBySideBtpAllowed', label: 'Side-by-Side BTP Policy' },
];

const REQUIRED_POLICY_FIELDS: Array<{ field: keyof CleanCorePolicy; label: string }> = [
  { field: 'posture', label: 'Clean Core Posture' },
  { field: 'primaryObjective', label: 'Primary Objective' },
  { field: 'coreModificationsPermitted', label: 'Core Modifications Policy' },
  { field: 'classicExitsPermitted', label: 'Classic Exits Policy' },
  { field: 'directTableUpdatesPermitted', label: 'Direct Table Updates Policy' },
  { field: 'unreleasedObjectsPermitted', label: 'Unreleased Objects Policy' },
];

// ── Helper ─────────────────────────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return true;
  return true;
}

function checkSection<T extends object>(
  section: LandscapeSection,
  obj: T | null,
  requiredFields: Array<{ field: keyof T; label: string }>,
): SectionStatus {
  if (!obj) {
    return {
      complete: false,
      requiredFieldCount: requiredFields.length,
      completedRequiredCount: 0,
      missingRequired: requiredFields.map((f) => String(f.field)),
    };
  }
  const missing: string[] = [];
  for (const { field } of requiredFields) {
    if (!isPresent(obj[field])) {
      missing.push(String(field));
    }
  }
  return {
    complete: missing.length === 0,
    requiredFieldCount: requiredFields.length,
    completedRequiredCount: requiredFields.length - missing.length,
    missingRequired: missing,
  };
}

// ── Main service ───────────────────────────────────────────────────────────

export class LandscapeReadinessService {
  /**
   * Compute readiness from the current landscape profile snapshot.
   * Does NOT persist — callers are responsible for persisting the result
   * alongside the profile version (audit trail).
   */
  compute(input: LandscapeReadinessInput): LandscapeReadinessResult {
    const projectId = input.project?.id ?? '';
    const tenantId = input.project?.tenantId ?? '';

    const sectionStatus: Record<LandscapeSection, SectionStatus> = {
      project: checkSection('project', input.project, REQUIRED_PROJECT_FIELDS),
      sourceSystem: checkSection('sourceSystem', input.sourceSystem, REQUIRED_SOURCE_FIELDS),
      targetSystem: checkSection('targetSystem', input.targetSystem, REQUIRED_TARGET_FIELDS),
      cleanCorePolicy: checkSection(
        'cleanCorePolicy',
        input.cleanCorePolicy,
        REQUIRED_POLICY_FIELDS,
      ),
      governance: {
        // Governance section has no hard-required fields for assessment
        complete: true,
        requiredFieldCount: 0,
        completedRequiredCount: 0,
        missingRequired: [],
      },
    };

    // Build flat list of missing fields
    const missingRequiredFields: MissingField[] = [];
    const sectionFieldLabels: Record<
      LandscapeSection,
      Array<{ field: string; label: string }>
    > = {
      project: REQUIRED_PROJECT_FIELDS.map((f) => ({
        field: String(f.field),
        label: f.label,
      })),
      sourceSystem: REQUIRED_SOURCE_FIELDS.map((f) => ({
        field: String(f.field),
        label: f.label,
      })),
      targetSystem: REQUIRED_TARGET_FIELDS.map((f) => ({
        field: String(f.field),
        label: f.label,
      })),
      cleanCorePolicy: REQUIRED_POLICY_FIELDS.map((f) => ({
        field: String(f.field),
        label: f.label,
      })),
      governance: [],
    };

    for (const [sec, status] of Object.entries(sectionStatus) as [LandscapeSection, SectionStatus][]) {
      for (const missingField of status.missingRequired) {
        const labelEntry = sectionFieldLabels[sec].find((e) => e.field === missingField);
        missingRequiredFields.push({
          section: sec,
          field: missingField,
          label: labelEntry?.label ?? missingField,
        });
      }
    }

    // Completion percentage across all required fields
    const totalRequired = Object.values(sectionStatus).reduce(
      (s, st) => s + st.requiredFieldCount,
      0,
    );
    const totalCompleted = Object.values(sectionStatus).reduce(
      (s, st) => s + st.completedRequiredCount,
      0,
    );
    const completionPercent =
      totalRequired === 0 ? 100 : Math.round((totalCompleted / totalRequired) * 100);

    // Warnings
    const warnings: ReadinessWarning[] = [];

    // Warn when target edition is Public Cloud and classicAbapAllowed is not NO/CONDITIONAL
    if (
      input.targetSystem?.targetEdition === 'S4HANA_CLOUD_PUBLIC' &&
      input.cleanCorePolicy &&
      input.cleanCorePolicy.coreModificationsPermitted === 'ALLOWED'
    ) {
      warnings.push({
        code: 'PUBLIC_CLOUD_MODIFICATION_CONFLICT',
        section: 'cleanCorePolicy',
        message:
          'Core modifications are set to ALLOWED but target edition is Public Cloud. Modifications are not permitted in S/4HANA Cloud Public Edition.',
      });
    }

    // Warn when no source evidence is available
    if (
      input.sourceSystem &&
      !input.sourceSystem.hasCustomCodeInventory &&
      !input.sourceSystem.hasAtcResults &&
      !input.sourceSystem.hasUsageData
    ) {
      warnings.push({
        code: 'LOW_EVIDENCE_AVAILABILITY',
        section: 'sourceSystem',
        message:
          'No optional evidence sources (custom code inventory, ATC results, usage data) are indicated. Recommendation confidence will be lower.',
      });
    }

    // Warn when LLM processing not permitted
    if (input.project && !input.project.llmProcessingPermitted) {
      warnings.push({
        code: 'LLM_PROCESSING_NOT_PERMITTED',
        section: 'project',
        message:
          'LLM processing of uploaded source code is not permitted. AI-assisted functional intent analysis will be unavailable.',
      });
    }

    // Assessment allowed when project + source + target + policy required fields complete
    const assessmentAllowed =
      sectionStatus.project.complete &&
      sectionStatus.sourceSystem.complete &&
      sectionStatus.targetSystem.complete &&
      sectionStatus.cleanCorePolicy.complete;

    // Code generation additionally requires target release to be present
    // and will be controlled by plan-approval gates in later phases
    const targetReleasePresent = isPresent(input.targetSystem?.targetRelease);
    const codeGenerationAllowed = assessmentAllowed && targetReleasePresent;

    // Compute readiness state
    let readinessState: LandscapeReadinessState;
    if (!input.project) {
      readinessState = 'DRAFT';
    } else if (!assessmentAllowed) {
      readinessState = completionPercent > 0 ? 'INCOMPLETE' : 'DRAFT';
    } else {
      readinessState = 'READY_FOR_ASSESSMENT';
    }

    return {
      projectId,
      tenantId,
      readinessState,
      completionPercent,
      missingRequiredFields,
      warnings,
      assessmentAllowed,
      codeGenerationAllowed,
      sectionStatus,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Determine which landscape sections changed between two profile snapshots
   * and produce revalidation flags. Called when the user updates target system
   * or Clean Core policy after assessments already exist.
   */
  detectRevalidationNeeds(
    previous: LandscapeReadinessInput,
    current: LandscapeReadinessInput,
    affectedAssessmentIds: string[],
    changedBy: string,
  ): RevalidationFlag[] {
    const flags: RevalidationFlag[] = [];
    const projectId = current.project?.id ?? '';
    const tenantId = current.project?.tenantId ?? '';
    const now = new Date().toISOString();

    const prevEdition = previous.targetSystem?.targetEdition;
    const currEdition = current.targetSystem?.targetEdition;
    if (prevEdition && currEdition && prevEdition !== currEdition) {
      flags.push({
        projectId,
        tenantId,
        reason: 'TARGET_EDITION_CHANGED' as RevalidationReason,
        flaggedAt: now,
        flaggedBy: changedBy,
        affectedAssessmentIds,
      });
    }

    const prevRelease = previous.targetSystem?.targetRelease;
    const currRelease = current.targetSystem?.targetRelease;
    if (prevRelease && currRelease && prevRelease !== currRelease) {
      flags.push({
        projectId,
        tenantId,
        reason: 'TARGET_RELEASE_CHANGED' as RevalidationReason,
        flaggedAt: now,
        flaggedBy: changedBy,
        affectedAssessmentIds,
      });
    }

    const prevPosture = previous.cleanCorePolicy?.posture;
    const currPosture = current.cleanCorePolicy?.posture;
    if (prevPosture && currPosture && prevPosture !== currPosture) {
      flags.push({
        projectId,
        tenantId,
        reason: 'CLEAN_CORE_POLICY_CHANGED' as RevalidationReason,
        flaggedAt: now,
        flaggedBy: changedBy,
        affectedAssessmentIds,
      });
    }

    return flags;
  }

  /**
   * Returns the human-readable banner message shown in the UI when the
   * landscape is not yet ready for assessment.
   */
  getBannerMessage(result: LandscapeReadinessResult): string | null {
    if (result.assessmentAllowed) return null;
    const sections: string[] = [];
    if (!result.sectionStatus.sourceSystem.complete) sections.push('Source System');
    if (!result.sectionStatus.targetSystem.complete) sections.push('Target System');
    if (!result.sectionStatus.cleanCorePolicy.complete) sections.push('Clean Core Policy');
    if (!result.sectionStatus.project.complete) sections.push('Project');
    if (sections.length === 0) return null;
    return `Landscape setup incomplete. Complete the ${sections.join(', ')} before starting assessment.`;
  }
}
