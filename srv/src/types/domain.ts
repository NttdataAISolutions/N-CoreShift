/**
 * N-CoreShift – CAP service domain types (srv layer).
 * Shared types used across CAP service handlers.
 * All records are scoped by tenantId and projectId (Principle 18).
 */

export interface ProjectRecord {
  id: string;
  tenantId: string;
  name: string;
  customerName: string;
  description?: string;
  transformationScenario?: string;
  primaryIndustry?: string;
  readinessState: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface SourceSystemProfileRecord {
  id: string;
  tenantId: string;
  projectId: string;
  systemName: string;
  erpProduct: string;
  deploymentModel: string;
  releaseVersion?: string;
  enhancementPackage?: string;
  customNamespaces?: string;
  devSystemAvailable: boolean;
  qasSystemAvailable: boolean;
  prdSystemAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TargetSystemProfileRecord {
  id: string;
  tenantId: string;
  projectId: string;
  targetEdition: string;
  targetRelease?: string;
  btpAvailable: boolean;
  integrationSuiteAvailable: boolean;
  hanaCloudAvailable: boolean;
  abapCloudRequired: boolean;
  classicAbapAllowed: string;
  sideBySideBtpAllowed: string;
  createdAt: string;
  updatedAt: string;
}

export interface CleanCorePolicyRecord {
  id: string;
  tenantId: string;
  projectId: string;
  posture: string;
  primaryObjective: string;
  coreModificationsPermitted: string;
  classicExitsPermitted: string;
  directTableUpdatesPermitted: string;
  unreleasedObjectsPermitted: string;
  releasedApiRequired: boolean;
  architectureReviewRequired: boolean;
  exceptionApprovalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LandscapeProfileVersionRecord {
  id: string;
  tenantId: string;
  projectId: string;
  versionNumber: number;
  changedBy: string;
  changedAt: string;
  changeReason?: string;
  snapshotJson: string;
}
