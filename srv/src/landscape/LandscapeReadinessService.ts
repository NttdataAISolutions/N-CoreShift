/**
 * N-CoreShift – Phase 2: Landscape Readiness Service (srv copy)
 *
 * Self-contained within srv/src so that srv/tsconfig.json (rootDir: "src")
 * can compile without crossing into the agent workspace.
 *
 * Keep in sync with agent/src/landscape/LandscapeReadinessService.ts.
 */

import type {
  CleanCorePolicy,
  GovernancePolicy,
  LandscapeReadinessResult,
  LandscapeSection,
  MissingField,
  ProjectContext,
  ReadinessWarning,
  SectionStatus,
  SourceSystemProfile,
  TargetSystemProfile,
} from './types.js';

// ── Input bundle ────────────────────────────────────────────────────────────

export interface LandscapeReadinessInput {
  project: ProjectContext | null;
  sourceSystem: SourceSystemProfile | null;
  targetSystem: TargetSystemProfile | null;
  cleanCorePolicy: CleanCorePolicy | null;
  governancePolicy: GovernancePolicy | null;
  existingApproval?: {
    assessmentApprovedBy?: string;
    assessmentApprovedAt?: string;
    codeGenerationApprovedBy?: string;
    codeGenerationApprovedAt?: string;
  };
}

// ── Service ─────────────────────────────────────────────────────────────────

export class LandscapeReadinessService {
  compute(input: LandscapeReadinessInput): LandscapeReadinessResult {
    const projectStatus = this._checkProject(input.project);
    const sourceStatus = this._checkSourceSystem(input.sourceSystem);
    const targetStatus = this._checkTargetSystem(input.targetSystem);
    const policyStatus = this._checkCleanCorePolicy(input.cleanCorePolicy);
    const govStatus = this._checkGovernance(input.governancePolicy);

    const allStatuses: Record<LandscapeSection, SectionStatus> = {
      project: projectStatus,
      sourceSystem: sourceStatus,
      targetSystem: targetStatus,
      cleanCorePolicy: policyStatus,
      governance: govStatus,
    };

    const totalRequired = Object.values(allStatuses).reduce(
      (sum, s) => sum + s.requiredFieldCount,
      0,
    );
    const totalCompleted = Object.values(allStatuses).reduce(
      (sum, s) => sum + s.completedRequiredCount,
      0,
    );

    const completionPercent =
      totalRequired === 0 ? 0 : Math.round((totalCompleted / totalRequired) * 100);

    const missingRequiredFields: MissingField[] = [];
    for (const [section, status] of Object.entries(allStatuses) as [
      LandscapeSection,
      SectionStatus,
    ][]) {
      for (const field of status.missingRequired) {
        missingRequiredFields.push({ section, field, label: _fieldLabel(section, field) });
      }
    }

    const warnings = this._buildWarnings(input, allStatuses);

    const coreComplete =
      projectStatus.complete && sourceStatus.complete && targetStatus.complete && policyStatus.complete;

    const assessmentAllowed =
      coreComplete && missingRequiredFields.length === 0;

    // Code generation additionally requires target release and approved plan
    // (plan approval is enforced elsewhere; here we check landscape prerequisites)
    const codeGenerationAllowed =
      assessmentAllowed &&
      !!input.targetSystem?.targetRelease &&
      !!input.cleanCorePolicy &&
      (input.existingApproval?.codeGenerationApprovedBy !== undefined ||
        input.existingApproval?.assessmentApprovedBy !== undefined);

    let readinessState: LandscapeReadinessResult['readinessState'];
    if (!input.project) {
      readinessState = 'DRAFT';
    } else if (!coreComplete) {
      readinessState = 'INCOMPLETE';
    } else if (codeGenerationAllowed) {
      readinessState = 'APPROVED_FOR_CODE_GENERATION';
    } else if (input.existingApproval?.assessmentApprovedBy) {
      readinessState = 'APPROVED_FOR_ASSESSMENT';
    } else if (assessmentAllowed) {
      readinessState = 'READY_FOR_ASSESSMENT';
    } else {
      readinessState = 'INCOMPLETE';
    }

    return {
      projectId: input.project?.id ?? '',
      tenantId: input.project?.tenantId ?? '',
      readinessState,
      completionPercent,
      missingRequiredFields,
      warnings,
      assessmentAllowed,
      codeGenerationAllowed,
      approvedBy: input.existingApproval?.assessmentApprovedBy,
      approvedAt: input.existingApproval?.assessmentApprovedAt,
      sectionStatus: allStatuses,
      computedAt: new Date().toISOString(),
    };
  }

  // ── Section checkers ──────────────────────────────────────────────────────

  private _checkProject(p: ProjectContext | null): SectionStatus {
    const required = [
      'name',
      'customerName',
      'projectIdentifier',
      'transformationScenario',
      'llmProcessingPermitted',
    ];
    return _checkFields(p as Record<string, unknown> | null, required);
  }

  private _checkSourceSystem(s: SourceSystemProfile | null): SectionStatus {
    const required = ['systemName', 'erpProduct', 'deploymentModel', 'accessMode'];
    return _checkFields(s as Record<string, unknown> | null, required);
  }

  private _checkTargetSystem(t: TargetSystemProfile | null): SectionStatus {
    const required = [
      'targetEdition',
      'keyUserExtensibilityAllowed',
      'developerExtensibilityAllowed',
      'abapCloudRequired',
    ];
    return _checkFields(t as Record<string, unknown> | null, required);
  }

  private _checkCleanCorePolicy(p: CleanCorePolicy | null): SectionStatus {
    const required = [
      'posture',
      'primaryObjective',
      'coreModificationsPermitted',
      'classicExitsPermitted',
      'directTableUpdatesPermitted',
    ];
    return _checkFields(p as Record<string, unknown> | null, required);
  }

  private _checkGovernance(g: GovernancePolicy | null): SectionStatus {
    // Governance is optional overall but we track it
    const required: string[] = [];
    return _checkFields(g as Record<string, unknown> | null, required);
  }

  // ── Warnings ──────────────────────────────────────────────────────────────

  private _buildWarnings(
    input: LandscapeReadinessInput,
    statuses: Record<LandscapeSection, SectionStatus>,
  ): ReadinessWarning[] {
    const warnings: ReadinessWarning[] = [];

    if (!statuses.governance.complete && !input.governancePolicy) {
      warnings.push({
        code: 'GOVERNANCE_NOT_CONFIGURED',
        section: 'governance',
        message:
          'Governance policy not yet configured. Architecture review settings will default to required.',
      });
    }

    if (input.targetSystem && !input.targetSystem.targetRelease) {
      warnings.push({
        code: 'TARGET_RELEASE_MISSING',
        section: 'targetSystem',
        message:
          'Target release not specified. Code generation will remain blocked until target release is set.',
      });
    }

    if (input.cleanCorePolicy && !input.cleanCorePolicy.extensionPreferenceOrder?.length) {
      warnings.push({
        code: 'EXTENSION_PREFERENCE_NOT_CONFIGURED',
        section: 'cleanCorePolicy',
        message: 'Extension preference order not configured. Default order will be applied.',
      });
    }

    if (input.sourceSystem && !input.sourceSystem.hasUsageData && !input.sourceSystem.hasAtcResults) {
      warnings.push({
        code: 'LOW_EVIDENCE_COVERAGE',
        section: 'sourceSystem',
        message:
          'No usage data or ATC results uploaded. Recommendations will have lower confidence.',
      });
    }

    return warnings;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _checkFields(
  obj: Record<string, unknown> | null,
  required: string[],
): SectionStatus {
  if (!obj) {
    return {
      complete: false,
      requiredFieldCount: required.length,
      completedRequiredCount: 0,
      missingRequired: [...required],
    };
  }

  const missing: string[] = [];
  for (const field of required) {
    const val = obj[field];
    if (val === undefined || val === null || val === '') {
      missing.push(field);
    }
  }

  return {
    complete: missing.length === 0,
    requiredFieldCount: required.length,
    completedRequiredCount: required.length - missing.length,
    missingRequired: missing,
  };
}

function _fieldLabel(section: LandscapeSection, field: string): string {
  const labels: Record<string, string> = {
    // project
    name: 'Project Name',
    customerName: 'Customer Name',
    projectIdentifier: 'Project Identifier',
    transformationScenario: 'Transformation Scenario',
    llmProcessingPermitted: 'LLM Processing Permission',
    // source
    systemName: 'Source System Name',
    erpProduct: 'Source ERP Product',
    deploymentModel: 'Source Deployment Model',
    accessMode: 'Source Access Mode',
    // target
    targetEdition: 'Target Edition',
    keyUserExtensibilityAllowed: 'Key-User Extensibility',
    developerExtensibilityAllowed: 'Developer Extensibility',
    abapCloudRequired: 'ABAP Cloud Required',
    // policy
    posture: 'Clean Core Posture',
    primaryObjective: 'Primary Objective',
    coreModificationsPermitted: 'Core Modifications Permitted',
    classicExitsPermitted: 'Classic Exits Permitted',
    directTableUpdatesPermitted: 'Direct Table Updates Permitted',
  };
  return labels[field] ?? `${section}.${field}`;
}
