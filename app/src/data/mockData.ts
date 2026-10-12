/**
 * N-CoreShift – Phase 10 mock data
 * Rich demo data for all UI pages.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type Disposition = 'Retire' | 'Replace' | 'Refactor' | 'Replatform' | 'Pending';
export type RiskLevel = 'High' | 'Medium' | 'Low' | 'Unknown';
export type ReadinessState = 'Ready' | 'Incomplete' | 'Not Started' | 'Blocked';
export type DecisionStatus = 'Approved' | 'Pending Review' | 'Rejected' | 'Not Started';
export type ProcessingStatus = 'Complete' | 'In Progress' | 'Queued' | 'Failed';
export type CleanCorePosture = 'Compliant' | 'Tolerated' | 'Custom';

export interface FourRDist {
  retire: number;
  replace: number;
  refactor: number;
  replatform: number;
}

export interface MockProject {
  id: string;
  name: string;
  client: string;
  sourceSystem: string;
  targetEdition: string;
  readinessState: ReadinessState;
  objectCount: number;
  analysisCount: number;
  plansCount: number;
  lastActivity: string;
}

export interface MockLandscape {
  projectId: string;
  sourceSystem: { name: string; release: string; edition: string; dbPlatform: string; instanceId: string };
  targetSystem: { edition: string; release: string; deploymentModel: string; extensibilityTier: string };
  cleanCoreStrategy: { posture: CleanCorePosture; allowedExtensions: string[]; retireThreshold: number };
  governance: { approverRoles: string[]; requiresDualApproval: boolean; policyVersion: string };
  readinessChecks: ReadinessCheck[];
  versions: LandscapeVersion[];
}

export interface ReadinessCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'pending';
  detail: string;
}

export interface LandscapeVersion {
  version: string;
  changedBy: string;
  changedAt: string;
  summary: string;
}

export interface MockAnalysis {
  id: string;
  name: string;
  projectId: string;
  sourceSystem: string;
  targetEdition: string;
  readinessState: ReadinessState;
  processingStatus: ProcessingStatus;
  objectsAnalyzed: number;
  dist: FourRDist;
  riskDist: { high: number; medium: number; low: number; unknown: number };
  createdAt: string;
  completedAt?: string;
}

export interface MockInventoryObject {
  id: string;
  analysisId: string;
  name: string;
  type: string;
  package: string;
  functionalPurpose: string;
  riskLevel: RiskLevel;
  disposition: Disposition;
  confidence: number;
  decisionStatus: DecisionStatus;
  businessProcess: string;
  linesOfCode: number;
  lastChanged: string;
  owner: string;
}

export interface MockObjectDetail extends MockInventoryObject {
  sourceCode: string;
  dependencies: Dependency[];
  functionalIntent: FunctionalIntent;
  assessment: Assessment;
  modernizationPlan: ModernizationPlan;
  generatedArtifacts: GeneratedArtifact[];
  decisionHistory: DecisionEvent[];
}

export interface Dependency {
  name: string;
  type: string;
  direction: 'Uses' | 'Used By';
  risk: RiskLevel;
}

export interface FunctionalIntent {
  summary: string;
  businessDomain: string;
  inputs: string[];
  outputs: string[];
  sideEffects: string[];
  sapEquivalent: string;
}

export interface Assessment {
  posture: CleanCorePosture;
  score: number;
  disposition: Disposition;
  rationale: string;
  extensibilityMechanism: string;
  evidence: string[];
  gaps: string[];
}

export interface ModernizationPlan {
  disposition: Disposition;
  targetTechnology: string;
  effort: 'Low' | 'Medium' | 'High';
  steps: PlanStep[];
  risks: string[];
  approvalStatus: DecisionStatus;
}

export interface PlanStep {
  order: number;
  title: string;
  description: string;
  status: 'Done' | 'In Progress' | 'Todo';
}

export interface GeneratedArtifact {
  id: string;
  type: string;
  name: string;
  language: string;
  lines: number;
  status: string;
  snippet: string;
}

export interface DecisionEvent {
  date: string;
  actor: string;
  action: string;
  comment: string;
}

// ── Mock Projects ──────────────────────────────────────────────────────────

export const MOCK_PROJECTS: MockProject[] = [
  {
    id: 'proj-001',
    name: 'Acme Corp – S/4HANA Rise Migration',
    client: 'Acme Corporation',
    sourceSystem: 'ECC 6.0 EhP8',
    targetEdition: 'S/4HANA Cloud Public (2502)',
    readinessState: 'Ready',
    objectCount: 847,
    analysisCount: 3,
    plansCount: 12,
    lastActivity: '2026-09-26',
  },
  {
    id: 'proj-002',
    name: 'GlobalMfg – Selective Data Migration',
    client: 'Global Manufacturing GmbH',
    sourceSystem: 'S/4HANA On-Premise 2021',
    targetEdition: 'S/4HANA Cloud Private (2502)',
    readinessState: 'Incomplete',
    objectCount: 312,
    analysisCount: 1,
    plansCount: 4,
    lastActivity: '2026-09-24',
  },
  {
    id: 'proj-003',
    name: 'RetailCo – BTP Side-by-Side',
    client: 'RetailCo SA',
    sourceSystem: 'ECC 6.0 EhP7',
    targetEdition: 'BTP + S/4HANA Cloud Public (2502)',
    readinessState: 'Not Started',
    objectCount: 0,
    analysisCount: 0,
    plansCount: 0,
    lastActivity: '2026-09-20',
  },
];

// ── Mock Landscapes ─────────────────────────────────────────────────────────

export const MOCK_LANDSCAPE: MockLandscape = {
  projectId: 'proj-001',
  sourceSystem: {
    name: 'Acme PRD',
    release: 'SAP ERP 6.0 EhP8',
    edition: 'ECC',
    dbPlatform: 'Oracle 19c',
    instanceId: 'PRD/000',
  },
  targetSystem: {
    edition: 'S/4HANA Cloud Public Edition',
    release: '2502',
    deploymentModel: 'RISE with SAP',
    extensibilityTier: 'Developer Extensibility (Tier 2)',
  },
  cleanCoreStrategy: {
    posture: 'Compliant',
    allowedExtensions: ['RAP Business Objects', 'Fiori Elements', 'BAdI Implementations', 'Key User Apps'],
    retireThreshold: 0,
  },
  governance: {
    approverRoles: ['Project Lead', 'Clean Core Architect'],
    requiresDualApproval: true,
    policyVersion: 'v1.2',
  },
  readinessChecks: [
    { id: 'r1', label: 'Source system profile complete', status: 'pass', detail: 'All required fields populated' },
    { id: 'r2', label: 'Target system profile complete', status: 'pass', detail: 'Edition, release and deployment model confirmed' },
    { id: 'r3', label: 'Clean Core policy defined', status: 'pass', detail: 'Posture: Compliant – all custom code must pass extension veto' },
    { id: 'r4', label: 'Governance approvers configured', status: 'pass', detail: '2 approver roles with dual-approval requirement' },
    { id: 'r5', label: 'Source code uploaded', status: 'pass', detail: '847 objects ingested from ZIP package' },
    { id: 'r6', label: 'Vector embeddings indexed', status: 'pass', detail: 'Indexing 100% complete – SAP knowledge base refreshed' },
    { id: 'r7', label: 'BTP destination configured', status: 'pass', detail: 'BTP sub-account destination configured and tested successfully' },
  ],
  versions: [
    { version: 'v1.2', changedBy: 'Alice Martin', changedAt: '2026-09-26T14:30Z', summary: 'Updated governance policy – added dual approval requirement' },
    { version: 'v1.1', changedBy: 'Bob Singh', changedAt: '2026-09-22T09:15Z', summary: 'Confirmed target release to 2502' },
    { version: 'v1.0', changedBy: 'Alice Martin', changedAt: '2026-09-18T11:00Z', summary: 'Initial landscape profile created' },
  ],
};

export const MOCK_LANDSCAPES: MockLandscape[] = [
  MOCK_LANDSCAPE,
  {
    projectId: 'proj-002',
    sourceSystem: {
      name: 'GlobalMfg PRD',
      release: 'SAP S/4HANA 2021',
      edition: 'S/4HANA On-Premise',
      dbPlatform: 'SAP HANA 2.0',
      instanceId: 'S4P/000',
    },
    targetSystem: {
      edition: 'S/4HANA Cloud Private Edition',
      release: '2502',
      deploymentModel: 'RISE with SAP (Private Cloud)',
      extensibilityTier: 'Classic Extensibility (Tier 3)',
    },
    cleanCoreStrategy: {
      posture: 'Tolerated',
      allowedExtensions: ['RAP Business Objects', 'Fiori Elements', 'Classic ABAP (reviewed)', 'BAdI Implementations'],
      retireThreshold: 24,
    },
    governance: {
      approverRoles: ['Project Lead'],
      requiresDualApproval: false,
      policyVersion: 'v0.9',
    },
    readinessChecks: [
      { id: 'r1', label: 'Source system profile complete', status: 'pass', detail: 'All required fields populated' },
      { id: 'r2', label: 'Target system profile complete', status: 'warn', detail: 'Deployment model confirmed; extensibility tier pending review' },
      { id: 'r3', label: 'Clean Core policy defined', status: 'pass', detail: 'Posture: Tolerated – classic ABAP allowed with review' },
      { id: 'r4', label: 'Governance approvers configured', status: 'warn', detail: 'Single approver only – dual approval not yet enabled' },
      { id: 'r5', label: 'Source code uploaded', status: 'pass', detail: '312 objects ingested' },
      { id: 'r6', label: 'Vector embeddings indexed', status: 'pending', detail: 'Indexing 60% complete' },
      { id: 'r7', label: 'BTP destination configured', status: 'pending', detail: 'Destination not yet configured' },
    ],
    versions: [
      { version: 'v0.9', changedBy: 'Carol Li', changedAt: '2026-09-24T10:00Z', summary: 'Initial landscape profile created' },
    ],
  },
  {
    projectId: 'proj-003',
    sourceSystem: {
      name: 'RetailCo ECC',
      release: 'SAP ERP 6.0 EhP7',
      edition: 'ECC',
      dbPlatform: 'MS SQL Server 2019',
      instanceId: 'ECC/100',
    },
    targetSystem: {
      edition: 'S/4HANA Cloud Public Edition',
      release: '2502',
      deploymentModel: 'BTP Side-by-Side',
      extensibilityTier: 'Developer Extensibility (Tier 2)',
    },
    cleanCoreStrategy: {
      posture: 'Compliant',
      allowedExtensions: ['RAP Business Objects', 'Fiori Elements', 'Key User Apps'],
      retireThreshold: 12,
    },
    governance: {
      approverRoles: ['Project Lead', 'Clean Core Architect', 'Business Owner'],
      requiresDualApproval: true,
      policyVersion: 'v0.1',
    },
    readinessChecks: [
      { id: 'r1', label: 'Source system profile complete', status: 'warn', detail: 'Instance ID and database platform need confirmation' },
      { id: 'r2', label: 'Target system profile complete', status: 'pass', detail: 'BTP + S/4HANA Cloud Public confirmed' },
      { id: 'r3', label: 'Clean Core policy defined', status: 'pending', detail: 'Policy draft not yet finalised' },
      { id: 'r4', label: 'Governance approvers configured', status: 'pass', detail: '3 approver roles configured' },
      { id: 'r5', label: 'Source code uploaded', status: 'fail', detail: 'No source code uploaded yet' },
      { id: 'r6', label: 'Vector embeddings indexed', status: 'fail', detail: 'Cannot index — source code missing' },
      { id: 'r7', label: 'BTP destination configured', status: 'pending', detail: 'BTP sub-account being provisioned' },
    ],
    versions: [
      { version: 'v0.1', changedBy: 'David Park', changedAt: '2026-09-20T09:00Z', summary: 'Landscape stub created for project kick-off' },
    ],
  },
];

// ── Mock Analyses ──────────────────────────────────────────────────────────

export const MOCK_ANALYSES: MockAnalysis[] = [
  {
    id: 'ana-001',
    name: 'Full Code Scan – Run 3',
    projectId: 'proj-001',
    sourceSystem: 'ECC 6.0 EhP8',
    targetEdition: 'S/4HANA Cloud Public 2502',
    readinessState: 'Ready',
    processingStatus: 'Complete',
    objectsAnalyzed: 847,
    dist: { retire: 189, replace: 312, refactor: 241, replatform: 105 },
    riskDist: { high: 142, medium: 389, low: 286, unknown: 30 },
    createdAt: '2026-09-25T08:00Z',
    completedAt: '2026-09-25T09:47Z',
  },
  {
    id: 'ana-002',
    name: 'Finance Module – Deep Dive',
    projectId: 'proj-001',
    sourceSystem: 'ECC 6.0 EhP8',
    targetEdition: 'S/4HANA Cloud Public 2502',
    readinessState: 'Ready',
    processingStatus: 'Complete',
    objectsAnalyzed: 143,
    dist: { retire: 22, replace: 71, refactor: 38, replatform: 12 },
    riskDist: { high: 41, medium: 67, low: 31, unknown: 4 },
    createdAt: '2026-09-20T10:00Z',
    completedAt: '2026-09-20T10:34Z',
  },
  {
    id: 'ana-003',
    name: 'Logistics Objects – Run 1',
    projectId: 'proj-002',
    sourceSystem: 'S/4HANA On-Premise 2021',
    targetEdition: 'S/4HANA Cloud Private 2502',
    readinessState: 'Incomplete',
    processingStatus: 'In Progress',
    objectsAnalyzed: 198,
    dist: { retire: 31, replace: 89, refactor: 61, replatform: 17 },
    riskDist: { high: 28, medium: 101, low: 61, unknown: 8 },
    createdAt: '2026-09-24T15:00Z',
  },
];

// ── Mock Inventory Objects ─────────────────────────────────────────────────

export const MOCK_INVENTORY: MockInventoryObject[] = [
  {
    id: 'obj-001', analysisId: 'ana-001',
    name: 'ZFI_PAYMENT_BLOCK', type: 'Function Module', package: 'ZFIN_CORE',
    functionalPurpose: 'Blocks vendor payment items based on custom hold reason codes',
    riskLevel: 'High', disposition: 'Refactor', confidence: 87, decisionStatus: 'Approved',
    businessProcess: 'Accounts Payable', linesOfCode: 412, lastChanged: '2024-11-15', owner: 'Finance Team',
  },
  {
    id: 'obj-002', analysisId: 'ana-001',
    name: 'ZCOS_OVERHEAD_CALC', type: 'ABAP Report', package: 'ZCONTROLLING',
    functionalPurpose: 'Recalculates overhead surcharge rates for cost center accounting',
    riskLevel: 'High', disposition: 'Replace', confidence: 92, decisionStatus: 'Pending Review',
    businessProcess: 'Controlling', linesOfCode: 789, lastChanged: '2023-08-22', owner: 'CO Team',
  },
  {
    id: 'obj-003', analysisId: 'ana-001',
    name: 'ZMM_VENDOR_SCORE', type: 'Function Module', package: 'ZPROCUREMENT',
    functionalPurpose: 'Scores vendor performance based on delivery and quality KPIs',
    riskLevel: 'Medium', disposition: 'Replatform', confidence: 78, decisionStatus: 'Pending Review',
    businessProcess: 'Procurement', linesOfCode: 331, lastChanged: '2025-01-10', owner: 'MM Team',
  },
  {
    id: 'obj-004', analysisId: 'ana-001',
    name: 'ZOLD_CURRENCY_CONV', type: 'Function Module', package: 'ZLEGACY',
    functionalPurpose: 'Legacy currency conversion using hardcoded exchange rates',
    riskLevel: 'Low', disposition: 'Retire', confidence: 96, decisionStatus: 'Approved',
    businessProcess: 'Finance', linesOfCode: 88, lastChanged: '2019-03-01', owner: 'Finance Team',
  },
  {
    id: 'obj-005', analysisId: 'ana-001',
    name: 'ZSD_PRICING_EXIT', type: 'User Exit', package: 'ZSALES',
    functionalPurpose: 'Custom pricing condition logic for volume discount tiers',
    riskLevel: 'High', disposition: 'Refactor', confidence: 81, decisionStatus: 'Not Started',
    businessProcess: 'Sales & Distribution', linesOfCode: 562, lastChanged: '2025-03-18', owner: 'SD Team',
  },
  {
    id: 'obj-006', analysisId: 'ana-001',
    name: 'ZPP_PROD_ORDER_CHK', type: 'Enhancement', package: 'ZPROD_PLAN',
    functionalPurpose: 'Pre-save validation for production orders against capacity constraints',
    riskLevel: 'Medium', disposition: 'Replace', confidence: 88, decisionStatus: 'Pending Review',
    businessProcess: 'Production Planning', linesOfCode: 203, lastChanged: '2025-06-01', owner: 'PP Team',
  },
  {
    id: 'obj-007', analysisId: 'ana-001',
    name: 'ZHR_LEAVE_QUOTA', type: 'ABAP Report', package: 'ZHR_MGMT',
    functionalPurpose: 'Calculates and posts leave quota entitlements for employees',
    riskLevel: 'Medium', disposition: 'Replace', confidence: 83, decisionStatus: 'Not Started',
    businessProcess: 'Human Resources', linesOfCode: 447, lastChanged: '2024-05-20', owner: 'HR Team',
  },
  {
    id: 'obj-008', analysisId: 'ana-001',
    name: 'ZWF_APPROVAL_ROUTE', type: 'Workflow', package: 'ZWORKFLOW',
    functionalPurpose: 'Custom multi-level approval routing for purchase requisitions',
    riskLevel: 'Medium', disposition: 'Replatform', confidence: 74, decisionStatus: 'Not Started',
    businessProcess: 'Procurement', linesOfCode: 618, lastChanged: '2025-02-14', owner: 'Basis Team',
  },
];

// ── Mock Object Detail ─────────────────────────────────────────────────────

export const MOCK_OBJECT_DETAIL: MockObjectDetail = {
  ...MOCK_INVENTORY[0],
  sourceCode: `FUNCTION ZFI_PAYMENT_BLOCK.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IV_VENDOR)   TYPE  LFA1-LIFNR
*"     VALUE(IV_REASON)   TYPE  ZFI_HOLD_REASON
*"  EXPORTING
*"     VALUE(EV_BLOCKED)  TYPE  BOOLE-BOOLE
*"----------------------------------------------------------------------
  DATA: ls_lfb1 TYPE lfb1.

  SELECT SINGLE * FROM lfb1
    INTO ls_lfb1
    WHERE lifnr = iv_vendor
      AND bukrs = sy-bukrs.

  IF ls_lfb1-zahls CA iv_reason.
    ev_blocked = abap_true.
  ELSE.
    ev_blocked = abap_false.
  ENDIF.
ENDFUNCTION.`,
  dependencies: [
    { name: 'LFB1', type: 'Database Table', direction: 'Uses', risk: 'Medium' },
    { name: 'ZFI_HOLD_REASON', type: 'Domain', direction: 'Uses', risk: 'Low' },
    { name: 'ZFI_PAYMENT_RUN', type: 'Program', direction: 'Used By', risk: 'High' },
    { name: 'FI_PAYMENT_BLOCK_SET', type: 'Function Module', direction: 'Used By', risk: 'Medium' },
  ],
  functionalIntent: {
    summary: 'Blocks a vendor\'s payment items in a company code based on a custom hold reason code. The hold reason is matched against the vendor\'s payment block indicator in LFB1.',
    businessDomain: 'Accounts Payable / Finance',
    inputs: ['Vendor number (IV_VENDOR)', 'Hold reason code (IV_REASON)', 'Company code (implicit via SY-BUKRS)'],
    outputs: ['Boolean blocked flag (EV_BLOCKED)'],
    sideEffects: ['None – read-only function'],
    sapEquivalent: 'S/4HANA BAPI_VENDOR_SETBLOCK or Business Partner (BP) payment block fields via BAdI VENDOR_ADD_DATA',
  },
  assessment: {
    posture: 'Tolerated',
    score: 62,
    disposition: 'Refactor',
    rationale: 'The function accesses LFB1 directly which is deprecated in S/4HANA Cloud. The business logic (custom hold codes) is valid and must be preserved, but must be reimplemented via RAP BAdI or Key User extensibility in the Business Partner model.',
    extensibilityMechanism: 'BAdI: VENDOR_ADD_DATA_CS (Business Partner Add-on Data)',
    evidence: [
      'LFB1 is a compatibility view in S/4HANA Cloud – direct SELECT is flagged by ABAP Test Cockpit (ATC)',
      'SAP Note 2220612: Vendor Master Data Migration to Business Partner',
      'Clean Core check failed: direct table access to deprecated view',
    ],
    gaps: [
      'Custom hold reason codes not available in standard BP payment block',
      'Company-code-level payment blocking requires BP relationship segment',
    ],
  },
  modernizationPlan: {
    disposition: 'Refactor',
    targetTechnology: 'RAP BAdI + Key User Extensibility',
    effort: 'Medium',
    approvalStatus: 'Approved',
    steps: [
      { order: 1, title: 'Map custom hold reasons to BP payment block categories', description: 'Analyze ZFI_HOLD_REASON domain values and map to standard S/4HANA BP payment block indicators', status: 'Done' },
      { order: 2, title: 'Implement BAdI VENDOR_ADD_DATA_CS', description: 'Create BAdI implementation that stores and evaluates custom hold codes in BP extension fields', status: 'In Progress' },
      { order: 3, title: 'Migrate existing hold data', description: 'One-time migration of existing payment block records to new BP extension fields', status: 'Todo' },
      { order: 4, title: 'Retire ZFI_PAYMENT_BLOCK', description: 'Remove function module and update all callers to use new BP API', status: 'Todo' },
    ],
    risks: [
      'Callers of ZFI_PAYMENT_BLOCK must all be updated – 2 programs identified',
      'Custom hold reasons have no 1:1 standard equivalent – mapping validation required with Finance team',
    ],
  },
  generatedArtifacts: [
    {
      id: 'art-001',
      type: 'BAdI Implementation',
      name: 'ZCL_VENDOR_HOLD_BADI',
      language: 'ABAP (RAP)',
      lines: 87,
      status: 'Draft',
      snippet: `CLASS zcl_vendor_hold_badi DEFINITION
  PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_badi_vendor_add_data.
  PRIVATE SECTION.
    METHODS map_hold_reason
      IMPORTING iv_reason TYPE zfi_hold_reason
      RETURNING VALUE(rv_block) TYPE dzlspr.
ENDCLASS.`,
    },
    {
      id: 'art-002',
      type: 'Migration Script',
      name: 'ZMIG_PAYMENT_BLOCKS',
      language: 'ABAP',
      lines: 134,
      status: 'Draft',
      snippet: `REPORT zmig_payment_blocks.
* One-time migration: ZFI hold records → BP extension fields
SELECT lifnr, bukrs, zahls FROM lfb1
  INTO TABLE @DATA(lt_vendors)
  WHERE zahls IS NOT INITIAL.`,
    },
  ],
  decisionHistory: [
    { date: '2026-09-26T10:15Z', actor: 'Alice Martin', action: 'Approved', comment: 'Disposition confirmed as Refactor. BAdI path validated with SAP CoE.' },
    { date: '2026-09-24T14:00Z', actor: 'Bob Singh', action: 'Submitted for Review', comment: 'Assessment complete, ready for architect sign-off.' },
    { date: '2026-09-22T09:30Z', actor: 'System', action: 'Assessment Generated', comment: 'AI assessment completed with 87% confidence.' },
  ],
};

// ── Portfolio summary (derived) ────────────────────────────────────────────

export const PORTFOLIO_STATS = {
  totalProjects: MOCK_PROJECTS.length,
  readyProjects: MOCK_PROJECTS.filter(p => p.readinessState === 'Ready').length,
  totalObjects: MOCK_PROJECTS.reduce((s, p) => s + p.objectCount, 0),
  totalAnalyses: MOCK_PROJECTS.reduce((s, p) => s + p.analysisCount, 0),
  plansAwaitingApproval: MOCK_INVENTORY.filter(o => o.decisionStatus === 'Pending Review').length,
  codeGenReady: MOCK_INVENTORY.filter(o => o.decisionStatus === 'Approved').length,
  dist: {
    retire: MOCK_INVENTORY.filter(o => o.disposition === 'Retire').length,
    replace: MOCK_INVENTORY.filter(o => o.disposition === 'Replace').length,
    refactor: MOCK_INVENTORY.filter(o => o.disposition === 'Refactor').length,
    replatform: MOCK_INVENTORY.filter(o => o.disposition === 'Replatform').length,
  },
  riskHigh: MOCK_INVENTORY.filter(o => o.riskLevel === 'High').length,
  riskMedium: MOCK_INVENTORY.filter(o => o.riskLevel === 'Medium').length,
  riskLow: MOCK_INVENTORY.filter(o => o.riskLevel === 'Low').length,
};
