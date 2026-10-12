$content = @'
/**
 * N-CoreShift - Phase 2: LandscapeReadinessService tests
 */
import { CleanCorePolicy, GovernancePolicy, ProjectContext, SourceSystemProfile, TargetSystemProfile } from '../landscape/types.js';
import { LandscapeReadinessInput, LandscapeReadinessService } from '../landscape/LandscapeReadinessService.js';

const svc = new LandscapeReadinessService();
const TS = '2025-01-01T00:00:00Z';

function proj(o: Partial<ProjectContext> = {}): ProjectContext {
  return { id:'proj-1', tenantId:'tenant-a', name:'Test', customerName:'Acme',
    projectIdentifier:'P1', transformationScenario:'ECC_TO_S4HANA',
    primaryIndustry:'Manufacturing', llmProcessingPermitted:true,
    readinessState:'DRAFT', createdAt:TS, updatedAt:TS, createdBy:'user@test.com', ...o };
}

function src(o: Partial<SourceSystemProfile> = {}): SourceSystemProfile {
  return { id:'src-1', tenantId:'tenant-a', projectId:'proj-1',
    systemName:'ECC', systemSid:'ERP', erpProduct:'SAP_ECC',
    deploymentModel:'ON_PREMISE', releaseVersion:'ECC 6.0 EHP8',
    accessMode:'FILE_UPLOAD', devSystemAvailable:true, qasSystemAvailable:true,
    prdSystemAvailable:true, hasCustomCodeInventory:true, hasAtcResults:false,
    hasCodeInspectorResults:false, hasUsageData:false, hasScmonData:false,
    hasCustomCodeMigrationExport:false, hasReadinessCheckOutput:false,
    hasTransportHistory:false, hasIncidentHistory:false,
    hasFunctionalDocumentation:false, createdAt:TS, updatedAt:TS, ...o };
}

function tgt(o: Partial<TargetSystemProfile> = {}): TargetSystemProfile {
  return { id:'tgt-1', tenantId:'tenant-a', projectId:'proj-1',
    targetEdition:'S4HANA_ON_PREMISE', targetRelease:'2023', riseWithSap:false,
    keyUserExtensibilityAllowed:'YES', developerExtensibilityAllowed:'YES',
    abapCloudRequired:'CONDITIONAL', classicAbapAllowed:'CONDITIONAL',
    sideBySideBtpAllowed:'YES', nonSapCloudExtensionsAllowed:'NO',
    releasedApisRequired:'YES', sapBuildAllowed:'CONDITIONAL',
    capNodejsAllowed:'YES', eventDrivenIntegrationAllowed:'CONDITIONAL',
    btpAvailable:'YES', integrationSuiteAvailable:'CONDITIONAL',
    eventMeshAvailable:'CONDITIONAL', hanaCloudAvailable:'YES',
    sapBuildPlatformAvailable:'CONDITIONAL', cloudConnectorAvailable:'YES',
    createdAt:TS, updatedAt:TS, ...o };
}

function pol(o: Partial<CleanCorePolicy> = {}): CleanCorePolicy {
  return { id:'pol-1', tenantId:'tenant-a', projectId:'proj-1',
    posture:'BALANCED', primaryObjective:'IMPROVE_UPGRADEABILITY',
    extensionPreferenceOrder:[{rank:1,technique:'SAP_STANDARD',label:'SAP Standard'}],
    coreModificationsPermitted:'EXCEPTION_ONLY', classicExitsPermitted:'EXCEPTION_ONLY',
    directTableUpdatesPermitted:'PROHIBITED', unreleasedObjectsPermitted:'EXCEPTION_ONLY',
    releasedApiObjectRequired:true, transactionalConsistencyRequired:true,
    architectureReviewRequired:true, exceptionApprovalRequired:true,
    exceptionExpiryRequired:false, createdAt:TS, updatedAt:TS, ...o };
}

function gov(): GovernancePolicy {
  return { id:'gov-1', tenantId:'tenant-a', projectId:'proj-1',
    architectureReviewRequired:true, cleanCoreExceptionApprovalRequired:true,
    approverRoles:['NCoreShift.CleanCoreApprover'], exceptionExpiryRequired:false,
    createdAt:TS, updatedAt:TS };
}

function full(): LandscapeReadinessInput {
  return { project:proj(), sourceSystem:src(), targetSystem:tgt(),
    cleanCorePolicy:pol(), governancePolicy:gov() };
}

describe('LandscapeReadinessService', () => {

  describe('completed landscape', () => {
    it('allows assessment when complete', () => {
      expect(svc.compute(full()).assessmentAllowed).toBe(true);
    });
    it('allows code generation when complete', () => {
      expect(svc.compute(full()).codeGenerationAllowed).toBe(true);
    });
    it('returns 100 percent completion', () => {
      expect(svc.compute(full()).completionPercent).toBe(100);
    });
    it('returns READY_FOR_ASSESSMENT state', () => {
      expect(svc.compute(full()).readinessState).toBe('READY_FOR_ASSESSMENT');
    });
    it('scopes to correct tenant/project', () => {
      const r = svc.compute(full());
      expect(r.projectId).toBe('proj-1');
      expect(r.tenantId).toBe('tenant-a');
    });
  });

  describe('missing source system', () => {
    it('blocks assessment', () => {
      expect(svc.compute({ ...full(), sourceSystem: null }).assessmentAllowed).toBe(false);
    });
    it('sourceSystem section incomplete', () => {
      expect(svc.compute({ ...full(), sourceSystem: null }).sectionStatus.sourceSystem.complete).toBe(false);
    });
    it('lists sourceSystem in missing fields', () => {
      const r = svc.compute({ ...full(), sourceSystem: null });
      expect(r.missingRequiredFields.some(f => f.section === 'sourceSystem')).toBe(true);
    });
    it('blocks code generation', () => {
      expect(svc.compute({ ...full(), sourceSystem: null }).codeGenerationAllowed).toBe(false);
    });
  });

  describe('missing target edition', () => {
    it('blocks assessment', () => {
      const i = { ...full(), targetSystem: tgt({ targetEdition: undefined as unknown as 'S4HANA_ON_PREMISE' }) };
      expect(svc.compute(i).assessmentAllowed).toBe(false);
    });
    it('lists targetEdition in missing fields', () => {
      const i = { ...full(), targetSystem: tgt({ targetEdition: undefined as unknown as 'S4HANA_ON_PREMISE' }) };
      expect(svc.compute(i).missingRequiredFields.some(f => f.field === 'targetEdition')).toBe(true);
    });
  });

  describe('missing target release', () => {
    it('blocks assessment and code generation', () => {
      const r = svc.compute({ ...full(), targetSystem: tgt({ targetRelease: undefined }) });
      expect(r.assessmentAllowed).toBe(false);
      expect(r.codeGenerationAllowed).toBe(false);
    });
  });

  describe('missing Clean Core posture', () => {
    it('blocks assessment', () => {
      const i = { ...full(), cleanCorePolicy: pol({ posture: undefined as unknown as 'BALANCED' }) };
      expect(svc.compute(i).assessmentAllowed).toBe(false);
    });
    it('lists posture in missing fields', () => {
      const i = { ...full(), cleanCorePolicy: pol({ posture: undefined as unknown as 'BALANCED' }) };
      expect(svc.compute(i).missingRequiredFields.some(f => f.field === 'posture')).toBe(true);
    });
  });

  describe('optional evidence absent', () => {
    it('does not block assessment', () => {
      const s = src({ hasCustomCodeInventory:false, hasAtcResults:false, hasUsageData:false, hasScmonData:false });
      expect(svc.compute({ ...full(), sourceSystem: s }).assessmentAllowed).toBe(true);
    });
    it('emits LOW_EVIDENCE_AVAILABILITY warning', () => {
      const s = src({ hasCustomCodeInventory:false, hasAtcResults:false, hasUsageData:false });
      const r = svc.compute({ ...full(), sourceSystem: s });
      expect(r.warnings.some(w => w.code === 'LOW_EVIDENCE_AVAILABILITY')).toBe(true);
    });
  });

  describe('code generation blocked despite assessment ready', () => {
    it('blocked when targetRelease is empty', () => {
      expect(svc.compute({ ...full(), targetSystem: tgt({ targetRelease: '' }) }).codeGenerationAllowed).toBe(false);
    });
    it('blocked when cleanCorePolicy is null', () => {
      expect(svc.compute({ ...full(), cleanCorePolicy: null }).codeGenerationAllowed).toBe(false);
    });
  });

  describe('target system changed after assessment', () => {
    it('emits TARGET_EDITION_CHANGED', () => {
      const next = { ...full(), targetSystem: tgt({ targetEdition: 'S4HANA_CLOUD_PRIVATE' }) };
      const flags = svc.detectRevalidationNeeds(full(), next, ['a1'], 'arch@x.com');
      expect(flags.some(f => f.reason === 'TARGET_EDITION_CHANGED')).toBe(true);
    });
    it('emits TARGET_RELEASE_CHANGED', () => {
      const next = { ...full(), targetSystem: tgt({ targetRelease: '2024' }) };
      const flags = svc.detectRevalidationNeeds(full(), next, ['a1'], 'arch@x.com');
      expect(flags.some(f => f.reason === 'TARGET_RELEASE_CHANGED')).toBe(true);
    });
    it('includes affected assessment IDs', () => {
      const next = { ...full(), targetSystem: tgt({ targetEdition: 'S4HANA_CLOUD_PUBLIC' }) };
      const flags = svc.detectRevalidationNeeds(full(), next, ['a1', 'a2'], 'arch@x.com');
      expect(flags[0]?.affectedAssessmentIds).toContain('a1');
    });
    it('no TARGET flags when target unchanged', () => {
      const flags = svc.detectRevalidationNeeds(full(), full(), ['a1'], 'arch@x.com');
      expect(flags.filter(f => f.reason.startsWith('TARGET_'))).toHaveLength(0);
    });
  });

  describe('Clean Core policy changed after assessment', () => {
    it('emits CLEAN_CORE_POLICY_CHANGED', () => {
      const next = { ...full(), cleanCorePolicy: pol({ posture: 'STRICT' }) };
      const flags = svc.detectRevalidationNeeds(full(), next, ['a1'], 'arch@x.com');
      expect(flags.some(f => f.reason === 'CLEAN_CORE_POLICY_CHANGED')).toBe(true);
    });
    it('no flag when policy unchanged', () => {
      const flags = svc.detectRevalidationNeeds(full(), full(), ['a1'], 'arch@x.com');
      expect(flags.filter(f => f.reason === 'CLEAN_CORE_POLICY_CHANGED')).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('result tenantId matches project tenantId', () => {
      const i = { ...full(), project: proj({ tenantId: 'tenant-x', id: 'proj-x' }) };
      expect(svc.compute(i).tenantId).toBe('tenant-x');
    });
    it('different tenants produce independent results', () => {
      const r1 = svc.compute(full());
      const r2 = svc.compute({ ...full(), project: proj({ tenantId: 'tenant-y', id: 'proj-y' }), sourceSystem: null });
      expect(r1.assessmentAllowed).toBe(true);
      expect(r2.assessmentAllowed).toBe(false);
    });
  });

});
'@

Set-Content -Path "C:\N-CoreShift\agent\src\__tests__\landscape-readiness.test.ts" -Value $content -Encoding UTF8
Write-Host "Written: $((Get-Item 'C:\N-CoreShift\agent\src\__tests__\landscape-readiness.test.ts').Length) bytes"
