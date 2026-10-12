/**
 * N-CoreShift – Phase 2: Landscape domain types.
 *
 * These types drive the Landscape Readiness Gate (Section 5 of the playbook).
 * All state is scoped by tenantId + projectId (Principle 18).
 */

// ── Landscape readiness states ─────────────────────────────────────────────

export const LANDSCAPE_READINESS_STATES = [
  'DRAFT',
  'INCOMPLETE',
  'READY_FOR_ASSESSMENT',
  'APPROVED_FOR_ASSESSMENT',
  'APPROVED_FOR_CODE_GENERATION',
] as const;

export type LandscapeReadinessState = (typeof LANDSCAPE_READINESS_STATES)[number];

// ── Transformation scenarios ───────────────────────────────────────────────

export const TRANSFORMATION_SCENARIOS = [
  'ECC_TO_S4HANA',
  'S4HANA_UPGRADE',
  'PRIVATE_TO_PUBLIC',
  'BROWNFIELD_MODERNIZATION',
  'SELECTIVE_TRANSFORMATION',
  'CLEAN_CORE_REMEDIATION',
  'OTHER',
] as const;

export type TransformationScenario = (typeof TRANSFORMATION_SCENARIOS)[number];

export const TRANSFORMATION_SCENARIO_LABELS: Record<TransformationScenario, string> = {
  ECC_TO_S4HANA: 'ECC to S/4HANA',
  S4HANA_UPGRADE: 'S/4HANA Upgrade',
  PRIVATE_TO_PUBLIC: 'S/4HANA Private to Public Transition',
  BROWNFIELD_MODERNIZATION: 'Brownfield Modernization',
  SELECTIVE_TRANSFORMATION: 'Selective Transformation',
  CLEAN_CORE_REMEDIATION: 'Existing S/4 Clean Core Remediation',
  OTHER: 'Other',
};

// ── Source ERP product / deployment ───────────────────────────────────────

export const SOURCE_ERP_PRODUCTS = ['SAP_ECC', 'SAP_S4HANA', 'OTHER_SAP'] as const;
export type SourceErpProduct = (typeof SOURCE_ERP_PRODUCTS)[number];

export const SOURCE_DEPLOYMENT_MODELS = ['ON_PREMISE', 'PRIVATE_CLOUD', 'PUBLIC_CLOUD'] as const;
export type SourceDeploymentModel = (typeof SOURCE_DEPLOYMENT_MODELS)[number];

export const SOURCE_ACCESS_MODES = [
  'FILE_UPLOAD',
  'ABAP_GIT_BUNDLE',
  'CONNECTED_SAP_SYSTEM',
  'IMPORTED_ANALYSIS_REPORT',
] as const;
export type SourceAccessMode = (typeof SOURCE_ACCESS_MODES)[number];

// ── Target edition / deployment ────────────────────────────────────────────

export const TARGET_EDITIONS = ['S4HANA_ON_PREMISE', 'S4HANA_CLOUD_PRIVATE', 'S4HANA_CLOUD_PUBLIC'] as const;
export type TargetEdition = (typeof TARGET_EDITIONS)[number];

export const TARGET_EDITION_LABELS: Record<TargetEdition, string> = {
  S4HANA_ON_PREMISE: 'SAP S/4HANA On-Premise',
  S4HANA_CLOUD_PRIVATE: 'SAP S/4HANA Cloud Private Edition',
  S4HANA_CLOUD_PUBLIC: 'SAP S/4HANA Cloud Public Edition',
};

// ── Tristate capability flag ───────────────────────────────────────────────

export const TRISTATE_VALUES = ['YES', 'NO', 'CONDITIONAL'] as const;
export type TristateValue = (typeof TRISTATE_VALUES)[number];

export const PERMISSION_VALUES = ['PROHIBITED', 'EXCEPTION_ONLY', 'ALLOWED'] as const;
export type PermissionValue = (typeof PERMISSION_VALUES)[number];

// ── Clean Core posture ─────────────────────────────────────────────────────

export const CLEAN_CORE_POSTURES = ['STRICT', 'BALANCED', 'TRANSITIONAL', 'CUSTOM'] as const;
export type CleanCorePosture = (typeof CLEAN_CORE_POSTURES)[number];

export const CLEAN_CORE_POSTURE_LABELS: Record<CleanCorePosture, string> = {
  STRICT: 'Strict – no classic modifications',
  BALANCED: 'Balanced – approved exceptions allowed',
  TRANSITIONAL: 'Transitional – staged clean-up',
  CUSTOM: 'Custom policy',
};

export const PRIMARY_OBJECTIVES = [
  'ELIMINATE_MODIFICATIONS',
  'REDUCE_CLASSIC_EXTENSIONS',
  'IMPROVE_UPGRADEABILITY',
  'MOVE_APPS_TO_BTP',
  'PUBLIC_CLOUD_READINESS',
  'REDUCE_TECHNICAL_DEBT',
  'COMBINATION',
] as const;
export type PrimaryObjective = (typeof PRIMARY_OBJECTIVES)[number];

// ── Domain entity types ────────────────────────────────────────────────────

export interface ProjectContext {
  id: string;
  tenantId: string;
  name: string;
  customerName: string;
  projectIdentifier: string;
  description?: string;
  transformationScenario: TransformationScenario;
  primaryIndustry?: string;
  countriesInScope?: string[];
  businessProcessesInScope?: string[];
  architectureOwner?: string;
  cleanCoreApprover?: string;
  dataClassification?: string;
  llmProcessingPermitted: boolean;
  readinessState: LandscapeReadinessState;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface SourceSystemProfile {
  id: string;
  tenantId: string;
  projectId: string;
  systemName: string;
  systemSid?: string;
  erpProduct: SourceErpProduct;
  deploymentModel: SourceDeploymentModel;
  releaseVersion?: string;
  enhancementPackage?: string;
  fpsSps?: string;
  databasePlatform?: string;
  devSystemAvailable: boolean;
  qasSystemAvailable: boolean;
  prdSystemAvailable: boolean;
  customNamespaces?: string[];
  installedAddons?: string[];
  keyIntegrations?: string[];
  btpFootprint?: string;
  accessMode: SourceAccessMode;
  // Evidence availability (optional – enrich confidence)
  hasCustomCodeInventory: boolean;
  hasAtcResults: boolean;
  hasCodeInspectorResults: boolean;
  hasUsageData: boolean;
  hasScmonData: boolean;
  hasCustomCodeMigrationExport: boolean;
  hasReadinessCheckOutput: boolean;
  hasTransportHistory: boolean;
  hasIncidentHistory: boolean;
  hasFunctionalDocumentation: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TargetSystemProfile {
  id: string;
  tenantId: string;
  projectId: string;
  targetEdition: TargetEdition;
  targetRelease?: string;
  targetFpsSps?: string;
  riseWithSap: boolean;
  targetCountries?: string[];
  targetIndustrySolutions?: string[];
  // Extensibility capabilities
  keyUserExtensibilityAllowed: TristateValue;
  developerExtensibilityAllowed: TristateValue;
  abapCloudRequired: TristateValue;
  classicAbapAllowed: TristateValue;
  sideBySideBtpAllowed: TristateValue;
  nonSapCloudExtensionsAllowed: TristateValue;
  releasedApisRequired: TristateValue;
  sapBuildAllowed: TristateValue;
  capNodejsAllowed: TristateValue;
  eventDrivenIntegrationAllowed: TristateValue;
  // Platform services
  btpAvailable: TristateValue;
  btpSubaccountRegion?: string;
  integrationSuiteAvailable: TristateValue;
  eventMeshAvailable: TristateValue;
  hanaCloudAvailable: TristateValue;
  sapBuildPlatformAvailable: TristateValue;
  cloudConnectorAvailable: TristateValue;
  enterpriseIdentityApproach?: string;
  securityConstraints?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionPreferenceEntry {
  rank: number;
  technique: string;
  label: string;
}

export interface CleanCorePolicy {
  id: string;
  tenantId: string;
  projectId: string;
  posture: CleanCorePosture;
  primaryObjective: PrimaryObjective;
  extensionPreferenceOrder: ExtensionPreferenceEntry[];
  // Policy controls
  coreModificationsPermitted: PermissionValue;
  classicExitsPermitted: PermissionValue;
  directTableUpdatesPermitted: PermissionValue;
  unreleasedObjectsPermitted: PermissionValue;
  releasedApiObjectRequired: boolean;
  sideBySideThreshold?: string;
  dataReplicationTolerance?: string;
  transactionalConsistencyRequired: boolean;
  upgradeCadenceObjective?: string;
  performanceConstraints?: string;
  availabilityConstraints?: string;
  regulatoryConstraints?: string;
  securityConstraints?: string;
  // Governance
  architectureReviewRequired: boolean;
  exceptionApprovalRequired: boolean;
  approverRoles?: string[];
  exceptionExpiryRequired: boolean;
  requiredEvidenceLevel?: string;
  requiredConfidenceLevel?: string;
  codeGenerationConfidenceThreshold?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GovernancePolicy {
  id: string;
  tenantId: string;
  projectId: string;
  architectureReviewRequired: boolean;
  cleanCoreExceptionApprovalRequired: boolean;
  approverRoles: string[];
  exceptionExpiryRequired: boolean;
  exceptionExpiryDays?: number;
  requiredEvidenceLevelForApproval?: string;
  requiredConfidenceLevelForRecommendation?: string;
  requiredThresholdForCodeGeneration?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LandscapeProfileVersion {
  id: string;
  tenantId: string;
  projectId: string;
  versionNumber: number;
  changedBy: string;
  changedAt: string;
  changeReason?: string;
  section: 'PROJECT' | 'SOURCE_SYSTEM' | 'TARGET_SYSTEM' | 'CLEAN_CORE_POLICY' | 'GOVERNANCE';
  snapshotJson: string;
}

// ── Readiness computation result ───────────────────────────────────────────

export interface LandscapeReadinessResult {
  projectId: string;
  tenantId: string;
  readinessState: LandscapeReadinessState;
  completionPercent: number;
  missingRequiredFields: MissingField[];
  warnings: ReadinessWarning[];
  assessmentAllowed: boolean;
  codeGenerationAllowed: boolean;
  approvedBy?: string;
  approvedAt?: string;
  sectionStatus: Record<LandscapeSection, SectionStatus>;
  computedAt: string;
}

export type LandscapeSection =
  | 'project'
  | 'sourceSystem'
  | 'targetSystem'
  | 'cleanCorePolicy'
  | 'governance';

export interface SectionStatus {
  complete: boolean;
  requiredFieldCount: number;
  completedRequiredCount: number;
  missingRequired: string[];
}

export interface MissingField {
  section: LandscapeSection;
  field: string;
  label: string;
}

export interface ReadinessWarning {
  code: string;
  section: LandscapeSection;
  message: string;
}

// ── Approval record ────────────────────────────────────────────────────────

export interface LandscapeApprovalRecord {
  projectId: string;
  tenantId: string;
  approvedBy: string;
  approvedAt: string;
  approvalType: 'ASSESSMENT' | 'CODE_GENERATION';
  notes?: string;
}

// ── Revalidation flag ──────────────────────────────────────────────────────

export type RevalidationReason =
  | 'TARGET_EDITION_CHANGED'
  | 'TARGET_RELEASE_CHANGED'
  | 'CLEAN_CORE_POLICY_CHANGED'
  | 'SOURCE_SYSTEM_CHANGED';

export interface RevalidationFlag {
  projectId: string;
  tenantId: string;
  reason: RevalidationReason;
  flaggedAt: string;
  flaggedBy: string;
  affectedAssessmentIds: string[];
}
