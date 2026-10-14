/**
 * N-CoreShift – Core Data Model
 *
 * Phase 2 adds:
 *   Project, SourceSystemProfile, TargetSystemProfile,
 *   CleanCorePolicy, GovernancePolicy, LandscapeProfileVersion,
 *   LandscapeReadinessResult
 *
 * Phase 4 adds: ModernizationAnalysis, CodeSource, SourceFile, CustomObject
 * Phase 5 adds: ObjectInventoryEntry, DependencyEdge
 * Phase 7 adds: CleanCoreAssessment
 * Phase 8 adds: ModernizationPlan, ModernizationStep
 * Phase 9 adds: GeneratedArtifact
 *
 * All records are scoped by tenantId and projectId (Principle 18).
 */

namespace ncoreshift.db;

// ── Common scoping aspect ──────────────────────────────────────────────────

aspect Scoped {
  tenantId  : String(64)  not null;
  projectId : String(36);
}

aspect Audited {
  createdAt  : DateTime not null;
  updatedAt  : DateTime not null;
  createdBy  : String(128);
  updatedBy  : String(128);
}

// ── Project ────────────────────────────────────────────────────────────────

/**
 * Top-level project record that anchors all landscape profiles,
 * analyses, and modernization plans.
 */
entity Project : Scoped, Audited {
  key id                     : String(36);
      name                   : String(256) not null;
      customerName           : String(256) not null;
      description            : String(2000);
      projectIdentifier      : String(64)  not null;
      transformationScenario : String(64);
      primaryIndustry        : String(128);
      countriesInScope       : String(1000);   // JSON array
      modulesInScope         : String(1000);   // JSON array
      architectureOwner      : String(256);
      cleanCoreDecisionAuthority : String(256);
      dataClassification     : String(64);
      llmProcessingPermitted : Boolean default false;
      readinessState         : String(64) default 'DRAFT';
}

// ── Source System Profile ──────────────────────────────────────────────────

entity SourceSystemProfile : Scoped, Audited {
  key id                           : String(36);
      systemName                   : String(256) not null;
      systemSid                    : String(32);
      erpProduct                   : String(64)  not null;
      deploymentModel              : String(64)  not null;
      releaseVersion               : String(64);
      enhancementPackage           : String(64);
      fpsSps                       : String(64);
      databasePlatform             : String(64);
      customNamespaces             : String(512);
      majorAddOns                  : String(2000);  // JSON array
      keyExternalIntegrations      : String(2000);  // JSON array
      existingBtpFootprint         : String(2000);
      accessMode                   : String(64)  not null;
      devSystemAvailable           : Boolean default false;
      qasSystemAvailable           : Boolean default false;
      prdSystemAvailable           : Boolean default false;
      hasCustomCodeInventory       : Boolean default false;
      hasAtcResults                : Boolean default false;
      hasCodeInspectorResults      : Boolean default false;
      hasUsageData                 : Boolean default false;
      hasScmonData                 : Boolean default false;
      hasCustomCodeMigrationExport : Boolean default false;
      hasReadinessCheckOutput      : Boolean default false;
      hasTransportHistory          : Boolean default false;
      hasIncidentHistory           : Boolean default false;
      hasFunctionalDocumentation   : Boolean default false;
}

// ── Target System Profile ──────────────────────────────────────────────────

entity TargetSystemProfile : Scoped, Audited {
  key id                              : String(36);
      targetEdition                   : String(64) not null;
      targetRelease                   : String(64) not null;
      plannedFpsSps                   : String(64);
      riseWithSap                     : Boolean default false;
      targetCountries                 : String(1000);   // JSON array
      targetIndustrySolutions         : String(1000);   // JSON array
      keyUserExtensibilityAllowed     : String(32);
      developerExtensibilityAllowed   : String(32);
      abapCloudRequired               : String(32);
      classicAbapAllowed              : String(32);
      sideBySideBtpAllowed            : String(32);
      nonSapCloudExtensionsAllowed    : String(32);
      releasedApisRequired            : String(32);
      sapBuildAllowed                 : String(32);
      capNodejsAllowed                : String(32);
      eventDrivenIntegrationAllowed   : String(32);
      btpAvailable                    : String(32);
      btpSubaccountRegion             : String(64);
      integrationSuiteAvailable       : String(32);
      eventMeshAvailable              : String(32);
      hanaCloudAvailable              : String(32);
      sapBuildPlatformAvailable       : String(32);
      cloudConnectorAvailable         : String(32);
      enterpriseIdentityApproach      : String(256);
      securityNetworkConstraints      : String(2000);
}

// ── Clean Core Policy ──────────────────────────────────────────────────────

entity CleanCorePolicy : Scoped, Audited {
  key id                           : String(36);
      posture                      : String(32)  not null;
      primaryObjective             : String(64)  not null;
      extensionPreferenceOrder     : String(4000);  // JSON array
      coreModificationsPermitted   : String(32)  not null;
      classicExitsPermitted        : String(32)  not null;
      directTableUpdatesPermitted  : String(32)  not null;
      unreleasedObjectsPermitted   : String(32)  not null;
      releasedApiObjectRequired    : Boolean default true;
      sideBySideThreshold          : String(1000);
      dataReplicationTolerance     : String(256);
      transactionalConsistencyRequired : Boolean default true;
      upgradeCadence               : String(256);
      performanceConstraints       : String(1000);
      availabilityDrConstraints    : String(1000);
      regulatoryDataResidency      : String(1000);
      securityArchConstraints      : String(1000);
      architectureReviewRequired   : Boolean default true;
      exceptionApprovalRequired    : Boolean default true;
      exceptionExpiryRequired      : Boolean default false;
}

// ── Governance Policy ──────────────────────────────────────────────────────

entity GovernancePolicy : Scoped, Audited {
  key id                                  : String(36);
      architectureReviewRequired          : Boolean default true;
      cleanCoreExceptionApprovalRequired  : Boolean default true;
      approverRoles                       : String(1000);  // JSON array
      exceptionExpiryRequired             : Boolean default false;
      requiredEvidenceLevel               : String(64);
      requiredConfidenceLevel             : String(64);
      codeGenerationConfidenceThreshold   : String(64);
}

// ── Landscape Profile Version (audit trail) ────────────────────────────────

entity LandscapeProfileVersion : Scoped, Audited {
  key id                 : String(36);
      versionNumber      : Integer not null;
      changedSection     : String(64);
      changeDescription  : String(1000);
      snapshotJson       : String(10000);  // JSON snapshot for auditability
      changedBy          : String(128);
      changedAt          : DateTime not null;
}

// ── Landscape Readiness Result (persisted snapshot) ───────────────────────

entity LandscapeReadinessResult : Scoped, Audited {
  key id                   : String(36);
      readinessState       : String(64) not null;
      completionPercent    : Integer not null;
      missingFieldsJson    : String(4000);  // JSON
      warningsJson         : String(4000);  // JSON
      sectionStatusJson    : String(4000);  // JSON
      assessmentAllowed    : Boolean not null;
      codeGenerationAllowed : Boolean not null;
      approvedBy           : String(128);
      approvedAt           : DateTime;
      computedAt           : DateTime not null;
}

// ── Revalidation Flag ─────────────────────────────────────────────────────

entity RevalidationFlag : Scoped, Audited {
  key id                      : String(36);
      reason                  : String(64) not null;
      flaggedAt               : DateTime not null;
      flaggedBy               : String(128);
      affectedAssessmentIds   : String(4000);  // JSON array
      resolved                : Boolean default false;
      resolvedAt              : DateTime;
      resolvedBy              : String(128);
}
