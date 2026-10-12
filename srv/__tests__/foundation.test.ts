/**
 * N-CoreShift Phase 0 – srv foundation tests.
 * Validates domain type structural contracts are sound.
 */

import type {
  ProjectRecord,
  SourceSystemProfileRecord,
  TargetSystemProfileRecord,
  CleanCorePolicyRecord,
  LandscapeProfileVersionRecord,
} from '../src/types/domain';

describe('Phase 0 – srv domain type contracts', () => {
  it('ProjectRecord has required tenant/project scope fields', () => {
    const project: ProjectRecord = {
      id: 'proj-001',
      tenantId: 'tenant-001',
      name: 'ECC Migration',
      customerName: 'Acme Corp',
      readinessState: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'user@example.com',
    };
    expect(project.tenantId).toBe('tenant-001');
    expect(project.readinessState).toBe('DRAFT');
  });

  it('SourceSystemProfileRecord captures deployment context', () => {
    const src: SourceSystemProfileRecord = {
      id: 'src-001',
      tenantId: 'tenant-001',
      projectId: 'proj-001',
      systemName: 'DEV-100',
      erpProduct: 'ECC',
      deploymentModel: 'ON_PREMISE',
      devSystemAvailable: true,
      qasSystemAvailable: true,
      prdSystemAvailable: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(src.erpProduct).toBe('ECC');
    expect(src.devSystemAvailable).toBe(true);
  });

  it('TargetSystemProfileRecord requires edition and BTP flags', () => {
    const tgt: TargetSystemProfileRecord = {
      id: 'tgt-001',
      tenantId: 'tenant-001',
      projectId: 'proj-001',
      targetEdition: 'S4_PUBLIC',
      btpAvailable: true,
      integrationSuiteAvailable: false,
      hanaCloudAvailable: true,
      abapCloudRequired: true,
      classicAbapAllowed: 'NOT_APPLICABLE',
      sideBySideBtpAllowed: 'YES',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(tgt.targetEdition).toBe('S4_PUBLIC');
    expect(tgt.abapCloudRequired).toBe(true);
  });

  it('CleanCorePolicyRecord captures governance posture', () => {
    const policy: CleanCorePolicyRecord = {
      id: 'pol-001',
      tenantId: 'tenant-001',
      projectId: 'proj-001',
      posture: 'STRICT',
      primaryObjective: 'ELIMINATE_MODIFICATIONS',
      coreModificationsPermitted: 'PROHIBITED',
      classicExitsPermitted: 'EXCEPTION_ONLY',
      directTableUpdatesPermitted: 'PROHIBITED',
      unreleasedObjectsPermitted: 'PROHIBITED',
      releasedApiRequired: true,
      architectureReviewRequired: true,
      exceptionApprovalRequired: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(policy.posture).toBe('STRICT');
    expect(policy.coreModificationsPermitted).toBe('PROHIBITED');
  });

  it('LandscapeProfileVersionRecord stores versioned snapshots', () => {
    const version: LandscapeProfileVersionRecord = {
      id: 'v-001',
      tenantId: 'tenant-001',
      projectId: 'proj-001',
      versionNumber: 1,
      changedBy: 'architect@example.com',
      changedAt: new Date().toISOString(),
      snapshotJson: JSON.stringify({ posture: 'STRICT' }),
    };
    expect(version.versionNumber).toBe(1);
    expect(JSON.parse(version.snapshotJson)).toHaveProperty('posture');
  });
});
