/**
 * N-CoreShift Phase 13 Regression & Security Test Suite
 */
import { TelemetryService, InMemoryTelemetryStore } from '../observability/TelemetryService.js';
import { NCS_ROLE, NCS_PERMISSION, getPermissionsForRoles, hasPermission } from '../auth/rbac.js';
import { FileValidator, MAX_SINGLE_FILE_BYTES } from '../source/FileValidator.js';
import { parseSourceFile, classifyFromFilename } from '../inventory/AbapSourceParser.js';
import { LandscapeReadinessService } from '../landscape/LandscapeReadinessService.js';
import type { LandscapeReadinessInput } from '../landscape/LandscapeReadinessService.js';
import type { SourceFileInput } from '../inventory/types.js';
import type {
  CleanCorePolicy, GovernancePolicy, ProjectContext,
  SourceSystemProfile, TargetSystemProfile,
} from '../landscape/types.js';

// ── helpers ───────────────────────────────────────────────────────────────────
function tel() {
  const store = new InMemoryTelemetryStore();
  return { svc: new TelemetryService(store), store };
}
const T1 = 'tenant-alpha';
const T2 = 'tenant-beta';
const PID = 'proj-001';
const AID = 'analysis-001';
const TS = '2025-01-01T00:00:00Z';

function makeProject(o: Partial<ProjectContext> = {}): ProjectContext {
  return {
    id: 'proj-1', tenantId: T1, name: 'Test', customerName: 'Acme',
    projectIdentifier: 'P1', transformationScenario: 'ECC_TO_S4HANA',
    primaryIndustry: 'Manufacturing', llmProcessingPermitted: true,
    readinessState: 'DRAFT', createdAt: TS, updatedAt: TS, createdBy: 'u@t.com', ...o,
  };
}
function makeSrc(o: Partial<SourceSystemProfile> = {}): SourceSystemProfile {
  return {
    id: 'src-1', tenantId: T1, projectId: 'proj-1', systemName: 'ECC',
    systemSid: 'ERP', erpProduct: 'SAP_ECC', deploymentModel: 'ON_PREMISE',
    releaseVersion: 'ECC 6.0 EHP8', accessMode: 'FILE_UPLOAD',
    devSystemAvailable: true, qasSystemAvailable: true, prdSystemAvailable: true,
    hasCustomCodeInventory: true, hasAtcResults: false, hasCodeInspectorResults: false,
    hasUsageData: false, hasScmonData: false, hasCustomCodeMigrationExport: false,
    hasReadinessCheckOutput: false, hasTransportHistory: false,
    hasIncidentHistory: false, hasFunctionalDocumentation: false,
    createdAt: TS, updatedAt: TS, ...o,
  };
}
function makeTgt(o: Partial<TargetSystemProfile> = {}): TargetSystemProfile {
  return {
    id: 'tgt-1', tenantId: T1, projectId: 'proj-1',
    targetEdition: 'S4HANA_ON_PREMISE', targetRelease: '2023', riseWithSap: false,
    keyUserExtensibilityAllowed: 'YES', developerExtensibilityAllowed: 'YES',
    abapCloudRequired: 'CONDITIONAL', classicAbapAllowed: 'CONDITIONAL',
    sideBySideBtpAllowed: 'YES', nonSapCloudExtensionsAllowed: 'NO',
    releasedApisRequired: 'YES', sapBuildAllowed: 'CONDITIONAL',
    capNodejsAllowed: 'YES', eventDrivenIntegrationAllowed: 'CONDITIONAL',
    btpAvailable: 'YES', integrationSuiteAvailable: 'CONDITIONAL',
    eventMeshAvailable: 'CONDITIONAL', hanaCloudAvailable: 'YES',
    sapBuildPlatformAvailable: 'CONDITIONAL', cloudConnectorAvailable: 'YES',
    createdAt: TS, updatedAt: TS, ...o,
  };
}
function makePol(o: Partial<CleanCorePolicy> = {}): CleanCorePolicy {
  return {
    id: 'pol-1', tenantId: T1, projectId: 'proj-1', posture: 'BALANCED',
    primaryObjective: 'IMPROVE_UPGRADEABILITY',
    extensionPreferenceOrder: [{ rank: 1, technique: 'SAP_STANDARD', label: 'SAP Standard' }],
    coreModificationsPermitted: 'EXCEPTION_ONLY', classicExitsPermitted: 'EXCEPTION_ONLY',
    directTableUpdatesPermitted: 'PROHIBITED', unreleasedObjectsPermitted: 'EXCEPTION_ONLY',
    releasedApiObjectRequired: true, transactionalConsistencyRequired: true,
    architectureReviewRequired: true, exceptionApprovalRequired: true,
    exceptionExpiryRequired: false, createdAt: TS, updatedAt: TS, ...o,
  };
}
function makeGov(): GovernancePolicy {
  return {
    id: 'gov-1', tenantId: T1, projectId: 'proj-1',
    architectureReviewRequired: true, cleanCoreExceptionApprovalRequired: true,
    approverRoles: ['NCoreShift.CleanCoreApprover'], exceptionExpiryRequired: false,
    createdAt: TS, updatedAt: TS,
  };
}
function fullInput(): LandscapeReadinessInput {
  return {
    project: makeProject(), sourceSystem: makeSrc(),
    targetSystem: makeTgt(), cleanCorePolicy: makePol(), governancePolicy: makeGov(),
  };
}

// ════════════════════════════════════════════════════════════════
// CAT-01  store initialisation
// ════════════════════════════════════════════════════════════════
describe('CAT-01 TelemetryService store initialisation', () => {
  it('starts empty', () => {
    const { svc } = tel();
    expect(svc.store.getEvents(T1)).toHaveLength(0);
    expect(svc.store.getAICallRecords(T1)).toHaveLength(0);
    expect(svc.store.getAnalysisDurations(T1)).toHaveLength(0);
  });
  it('accepts an external store instance', () => {
    const store = new InMemoryTelemetryStore();
    expect(new TelemetryService(store).store).toBe(store);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-02  generic recordEvent
// ════════════════════════════════════════════════════════════════
describe('CAT-02 TelemetryService generic recordEvent', () => {
  it('auto-assigns UUID and ISO timestamp', () => {
    const { svc } = tel();
    svc.recordEvent({ kind: 'INGESTION_STARTED', tenantId: T1 });
    const [ev] = svc.store.getEvents(T1);
    expect(ev.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(ev.timestamp).getTime()).not.toBeNaN();
  });
  it('preserves caller-supplied fields', () => {
    const { svc } = tel();
    svc.recordEvent({ kind: 'INGESTION_COMPLETED', tenantId: T1, projectId: PID, objectCount: 42, meta: { source: 'zip' } });
    const ev = svc.store.getEvents(T1)[0];
    expect(ev.projectId).toBe(PID);
    expect(ev.objectCount).toBe(42);
    expect(ev.meta?.source).toBe('zip');
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-03  analysis lifecycle
// ════════════════════════════════════════════════════════════════
describe('CAT-03 TelemetryService analysis lifecycle', () => {
  it('STARTED creates a duration record', () => {
    const { svc } = tel();
    svc.analysisStarted({ tenantId: T1, projectId: PID, analysisId: AID });
    const [dur] = svc.store.getAnalysisDurations(T1);
    expect(dur.analysisId).toBe(AID);
    expect(dur.failed).toBe(false);
  });
  it('COMPLETED updates duration', () => {
    const { svc } = tel();
    svc.analysisStarted({ tenantId: T1, projectId: PID, analysisId: AID });
    svc.analysisCompleted({ tenantId: T1, projectId: PID, analysisId: AID, objectCount: 120, objectsRequiringReview: 5, durationMs: 3200 });
    const dur = svc.store.getAnalysisDurations(T1)[0];
    expect(dur.objectsProcessed).toBe(120);
    expect(dur.durationMs).toBe(3200);
    expect(dur.failed).toBe(false);
  });
  it('FAILED marks duration as failed', () => {
    const { svc } = tel();
    svc.analysisStarted({ tenantId: T1, projectId: PID, analysisId: AID });
    svc.analysisFailed({ tenantId: T1, projectId: PID, analysisId: AID, failureReason: 'timeout' });
    const dur = svc.store.getAnalysisDurations(T1)[0];
    expect(dur.failed).toBe(true);
    expect(dur.failureReason).toBe('timeout');
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-04  AI call tracking
// ════════════════════════════════════════════════════════════════
describe('CAT-04 TelemetryService AI call tracking', () => {
  it('records a successful call with tokens', () => {
    const { svc } = tel();
    svc.aiCallStarted({ callId: 'c1', tenantId: T1, providerName: 'ai', purpose: 'assessment' });
    svc.aiCallCompleted({ callId: 'c1', tenantId: T1, providerName: 'ai', durationMs: 800, tokensInput: 200, tokensOutput: 150 });
    const rec = svc.store.getAICallRecords(T1)[0];
    expect(rec.succeeded).toBe(true);
    expect(rec.tokensInput).toBe(200);
    expect(rec.parseFailed).toBe(false);
  });
  it('records a failed call', () => {
    const { svc } = tel();
    svc.aiCallStarted({ callId: 'c2', tenantId: T1, providerName: 'ai', purpose: 'intent' });
    svc.aiCallFailed({ callId: 'c2', tenantId: T1, providerName: 'ai', failureReason: 'network error' });
    expect(svc.store.getAICallRecords(T1)[0].failureReason).toBe('network error');
  });
  it('marks parse failures', () => {
    const { svc } = tel();
    svc.aiCallStarted({ callId: 'c3', tenantId: T1, providerName: 'ai', purpose: 'codegen' });
    svc.aiParseFailed({ callId: 'c3', tenantId: T1, providerName: 'ai', purpose: 'codegen' });
    expect(svc.store.getAICallRecords(T1)[0].parseFailed).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-05  security events
// ════════════════════════════════════════════════════════════════
describe('CAT-05 TelemetryService security events', () => {
  it('PROMPT_INJECTION_DETECTED sets injectionDetected=true', () => {
    const { svc } = tel();
    svc.promptInjectionDetected({ tenantId: T1, objectId: 'ZCL_EVIL' });
    const ev = svc.store.getEvents(T1, ['PROMPT_INJECTION_DETECTED'])[0];
    expect(ev.injectionDetected).toBe(true);
    expect(ev.objectId).toBe('ZCL_EVIL');
  });
  it('UNAUTHORIZED_ACCESS_ATTEMPT preserves meta', () => {
    const { svc } = tel();
    svc.unauthorizedAccessAttempt({ tenantId: T1, meta: { role: 'USER' } });
    const ev = svc.store.getEvents(T1, ['UNAUTHORIZED_ACCESS_ATTEMPT'])[0];
    expect(ev.meta?.role).toBe('USER');
  });
  it('SECRET_REDACTION_APPLIED is recorded', () => {
    const { svc } = tel();
    svc.secretRedactionApplied({ tenantId: T1 });
    expect(svc.store.getEvents(T1, ['SECRET_REDACTION_APPLIED'])).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-06  code-generation gate telemetry
// ════════════════════════════════════════════════════════════════
describe('CAT-06 TelemetryService code-generation gate', () => {
  it('records GATE_BLOCKED with blockedReasons', () => {
    const { svc } = tel();
    svc.codeGenerationGateBlocked({ tenantId: T1, blockedReasons: ['no-assessment', 'no-plan'] });
    const ev = svc.store.getEvents(T1, ['CODE_GENERATION_GATE_BLOCKED'])[0];
    expect(ev.blockedReasons).toEqual(['no-assessment', 'no-plan']);
  });
  it('records CODE_GENERATION_FAILED', () => {
    const { svc } = tel();
    svc.codeGenerationFailed({ tenantId: T1, failureReason: 'AI timeout' });
    expect(svc.store.getEvents(T1, ['CODE_GENERATION_FAILED'])[0].failureReason).toBe('AI timeout');
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-07  tenant isolation in telemetry store
// ════════════════════════════════════════════════════════════════
describe('CAT-07 TelemetryService tenant isolation', () => {
  it('events for T1 are invisible to T2', () => {
    const { svc } = tel();
    svc.recordEvent({ kind: 'INGESTION_STARTED', tenantId: T1 });
    expect(svc.store.getEvents(T2)).toHaveLength(0);
  });
  it('AI records for T1 are invisible to T2', () => {
    const { svc } = tel();
    svc.aiCallStarted({ callId: 'x', tenantId: T1, providerName: 'ai', purpose: 'test' });
    expect(svc.store.getAICallRecords(T2)).toHaveLength(0);
  });
  it('duration records for T1 are invisible to T2', () => {
    const { svc } = tel();
    svc.analysisStarted({ tenantId: T1, projectId: PID, analysisId: AID });
    expect(svc.store.getAnalysisDurations(T2)).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-08  RBAC – role/permission model
// ════════════════════════════════════════════════════════════════
describe('CAT-08 RBAC roles and permissions', () => {
  it('PLATFORM_ADMIN has MANAGE_AI_PROVIDER permission', () => {
    expect(hasPermission([NCS_ROLE.PLATFORM_ADMIN], NCS_PERMISSION.MANAGE_AI_PROVIDER)).toBe(true);
  });
  it('USER cannot WRITE_ASSESSMENT', () => {
    expect(hasPermission([NCS_ROLE.USER], NCS_PERMISSION.WRITE_ASSESSMENT)).toBe(false);
  });
  it('CONSULTANT can READ_ASSESSMENT', () => {
    expect(hasPermission([NCS_ROLE.CONSULTANT], NCS_PERMISSION.READ_ASSESSMENT)).toBe(true);
  });
  it('multiple roles union permissions', () => {
    expect(hasPermission([NCS_ROLE.USER, NCS_ROLE.CONSULTANT], NCS_PERMISSION.READ_ASSESSMENT)).toBe(true);
  });
  it('empty roles have no permissions', () => {
    const perms = getPermissionsForRoles([]);
    expect(perms.size).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-09  RBAC – clean-core approver gate
// ════════════════════════════════════════════════════════════════
describe('CAT-09 RBAC clean-core approver gate', () => {
  it('CLEAN_CORE_APPROVER can APPROVE_LANDSCAPE', () => {
    expect(hasPermission([NCS_ROLE.CLEAN_CORE_APPROVER], NCS_PERMISSION.APPROVE_LANDSCAPE)).toBe(true);
  });
  it('CONSULTANT cannot APPROVE_LANDSCAPE', () => {
    expect(hasPermission([NCS_ROLE.CONSULTANT], NCS_PERMISSION.APPROVE_LANDSCAPE)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-10  RBAC – artifact write gate
// ════════════════════════════════════════════════════════════════
describe('CAT-10 RBAC artifact write gate', () => {
  it('TECHNICAL_CONSULTANT can WRITE_ARTIFACT', () => {
    expect(hasPermission([NCS_ROLE.TECHNICAL_CONSULTANT], NCS_PERMISSION.WRITE_ARTIFACT)).toBe(true);
  });
  it('USER cannot WRITE_ARTIFACT', () => {
    expect(hasPermission([NCS_ROLE.USER], NCS_PERMISSION.WRITE_ARTIFACT)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-11  FileValidator security
// ════════════════════════════════════════════════════════════════
describe('CAT-11 FileValidator security', () => {
  const v = new FileValidator();
  it('rejects files over size limit', () => {
    const big = Buffer.alloc(MAX_SINGLE_FILE_BYTES + 1);
    const r = v.validate(big, 'big.abap');
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/size/i);
  });
  it('rejects disallowed extensions', () => {
    const r = v.validate(Buffer.from('MZ'), 'script.exe');
    expect(r.valid).toBe(false);
  });
  it('rejects zip magic bytes with .abap extension', () => {
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const r = v.validate(zipMagic, 'fake.abap');
    expect(r.valid).toBe(false);
  });
  it('accepts a valid small ABAP file', () => {
    const r = v.validate(Buffer.from('CLASS zcl_test DEFINITION.'), 'ZCL_TEST.abap');
    expect(r.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-12  AbapSourceParser
// ════════════════════════════════════════════════════════════════
describe('CAT-12 AbapSourceParser', () => {
  it('classifies CLASS file from filename', () => {
    expect(classifyFromFilename('ZCL_MY_CLASS.clas.abap').objectType).toBe('CLASS');
  });
  it('classifies FUNCTION GROUP from filename', () => {
    expect(classifyFromFilename('ZFG_MYFUNC.fugr.abap').objectType).toBe('FUNCTION_GROUP');
  });
  it('parses a minimal CLASS file', () => {
    const input: SourceFileInput = {
      id: 'f1', fileName: 'ZCL_DEMO.abap',
      content: 'CLASS zcl_demo DEFINITION PUBLIC.\nENDCLASS.',
    };
    const result = parseSourceFile(input);
    expect(result.objectName).toBe('ZCL_DEMO');
    expect(result.objectType).toBe('CLASS');
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-13  LandscapeReadinessService – happy path
// ════════════════════════════════════════════════════════════════
describe('CAT-13 LandscapeReadinessService happy path', () => {
  const svc = new LandscapeReadinessService();
  it('READY_FOR_ASSESSMENT for a fully populated input', () => {
    const r = svc.compute(fullInput());
    expect(r.readinessState).toBe('READY_FOR_ASSESSMENT');
    expect(r.missingRequiredFields).toHaveLength(0);
  });
  it('result includes sectionStatus map', () => {
    const r = svc.compute(fullInput());
    expect(r.sectionStatus).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// CAT-14  LandscapeReadinessService – blockers
// ════════════════════════════════════════════════════════════════
describe('CAT-14 LandscapeReadinessService blockers', () => {
  const svc = new LandscapeReadinessService();
  it('not READY_FOR_ASSESSMENT when project name is missing', () => {
    const input = fullInput();
    (input.project as unknown as Record<string, unknown>).name = '';
    const r = svc.compute(input);
    expect(r.readinessState).not.toBe('READY_FOR_ASSESSMENT');
    expect(r.missingRequiredFields.length).toBeGreaterThan(0);
  });
  it('emits LOW_EVIDENCE_AVAILABILITY warning when all evidence sources absent', () => {
    const input = fullInput();
    input.sourceSystem!.hasCustomCodeInventory = false;
    input.sourceSystem!.hasAtcResults = false;
    input.sourceSystem!.hasUsageData = false;
    const r = svc.compute(input);
    // evidence absence is a warning, not a blocker
    expect(r.assessmentAllowed).toBe(true);
    expect(r.warnings.some((w) => w.code === 'LOW_EVIDENCE_AVAILABILITY')).toBe(true);
  });
});
