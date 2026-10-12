/**
 * N-CoreShift – Phase 11: Connected SAP Source and Evidence Import Types
 *
 * Defines contracts for:
 *  - SAPSystemSourceProvider (connected-system source adapter)
 *  - Evidence import adapters (ATC, SCI, SCMON, CCM, Readiness Check)
 *
 * Design rules:
 *  - SAP passwords must NEVER be stored in N-CoreShift database entities.
 *  - Credentials are managed by BTP Destination Service or environment config.
 *  - All records are scoped by tenantId and projectId (Principle 18).
 *  - Do not invent SAP APIs. Only verified integration mechanisms are referenced.
 */

// ── Deployment model ──────────────────────────────────────────────────────

export type SAPDeploymentModel = 'ON_PREMISE' | 'PRIVATE_CLOUD' | 'PUBLIC_CLOUD';

// ── Verified integration mechanisms ──────────────────────────────────────
// Only mechanisms that are documented and available in their respective context.

export type ConnectedAccessMechanism =
  /** abapGit HTTP service /sap/bc/abapgit – available On-Premise and Private Cloud.
   *  Requires ICF service activation and abapGit installed on source system. */
  | 'ABAPGIT_HTTP'
  /** RFC via HTTP (ICF) – available On-Premise and Private Cloud.
   *  Requires RFC-enabled function modules and ICF activation. */
  | 'RFC_HTTP'
  /** OData APIs – available where specific SAP OData services are released/active.
   *  Coverage varies by product version and scope item activation. */
  | 'ODATA_API';

// ── Connection config (no password storage) ───────────────────────────────

export interface SAPSystemConnectionConfig {
  /** Human-readable label for display (e.g. "DEV Q00") */
  systemLabel: string;
  /** Deployment model – determines which access mechanisms are available */
  deploymentModel: SAPDeploymentModel;
  /**
   * Whether to route credentials through BTP Destination Service.
   * Required for production BTP deployments.
   * When true, destinationName must be provided.
   * Credentials themselves are NEVER stored here.
   */
  useDestinationService: boolean;
  /** BTP Destination service destination name */
  destinationName?: string;
  /**
   * Direct host – for local/dev/test only.
   * Not used in BTP production deployment.
   */
  host?: string;
  httpPort?: number;
  httpsPort?: number;
  /** SAP client number 000-999 */
  client?: string;
  /**
   * Whether to route through SAP Cloud Connector.
   * Required for On-Premise systems accessed from BTP.
   */
  useCloudConnector?: boolean;
  /** Cloud Connector location ID when multiple CC instances exist */
  locationId?: string;
}

// ── System info returned after a successful connection test ───────────────

export interface SAPSystemInfo {
  systemId: string;
  description: string;
  /** e.g. 'SAP ECC', 'SAP S/4HANA On-Premise', 'SAP S/4HANA Private Cloud' */
  product: string;
  /** e.g. '756', '2023', '2022 FPS02' */
  release: string;
  deploymentModel: SAPDeploymentModel;
  /** Access mechanisms confirmed available for this system */
  supportedAccessMechanisms: ConnectedAccessMechanism[];
}

export interface ConnectionTestResult {
  success: boolean;
  systemInfo?: SAPSystemInfo;
  error?: string;
  testedAt: string;
}

// ── Package browse ────────────────────────────────────────────────────────

export interface PackageDescriptor {
  packageName: string;
  description: string;
  /** Estimated/actual object count in this package (not sub-packages) */
  objectCount: number;
  subPackages: string[];
}

export interface SAPObjectDescriptor {
  objectName: string;
  /** SAP object type key, e.g. PROG, CLAS, FUGR, TABL */
  objectType: string;
  packageName: string;
  description: string;
  /** Namespace prefix, e.g. Z, Y, /CUST/ */
  namespace: string;
  lastChanged: string;
  changedBy: string;
}

export interface PackageBrowseRequest {
  scope: { tenantId: string; projectId: string };
  connectionConfig: SAPSystemConnectionConfig;
  /** Package to browse. If undefined, list top-level customer packages. */
  packageName?: string;
  includeSubPackages: boolean;
}

export interface PackageBrowseResult {
  packages: PackageDescriptor[];
  objects: SAPObjectDescriptor[];
  totalObjectCount: number;
  accessMechanismUsed: ConnectedAccessMechanism;
  warnings: string[];
}

// ── Scope selection ───────────────────────────────────────────────────────

export interface ObjectScopeSelection {
  /** Package names to include */
  packageNames: string[];
  includeSubPackages: boolean;
  /** Optional: specific objects within the packages */
  objectNames?: string[];
  /** Optional: filter by object type, e.g. ['PROG', 'CLAS', 'FUGR'] */
  objectTypeFilter?: string[];
  /** Optional: filter by namespace prefix, e.g. ['Z', 'Y', '/CUST/'] */
  namespaceFilter?: string[];
}

// ── Connected ingestion ───────────────────────────────────────────────────

export interface ConnectedIngestionRequest {
  tenantId: string;
  projectId: string;
  analysisId: string;
  connectionConfig: SAPSystemConnectionConfig;
  scopeSelection: ObjectScopeSelection;
  requestedBy: string;
}

export interface ConnectedIngestionResult {
  success: boolean;
  bundleId: string;
  importedObjectCount: number;
  skippedObjects: Array<{ objectName: string; reason: string }>;
  warnings: string[];
  accessMechanismUsed: ConnectedAccessMechanism;
  importedAt: string;
}

// ── Evidence import formats ───────────────────────────────────────────────
// Each format maps to a specific SAP export. No invented formats.

export type EvidenceImportFormat =
  /**
   * ATC Run Result XML exported from transaction SATC (SAP ABAP Test Cockpit).
   * Export: SATC → Run → Export Results → XML Format.
   * Available: SAP NW 7.40+, ECC 6.0 EhP7+, S/4HANA all releases.
   * Root element: <SATC_ATC_RUN_RESULT> or <FINDINGS>.
   */
  | 'ATC_XML'
  /**
   * Code Inspector (SCI) result XML exported from transaction SCI or SE38/SE80.
   * Export: SCI → Inspection → Display Results → Export → XML.
   * Available: SAP NW 7.0+, ECC 6.0+, S/4HANA all releases.
   * Root element: <SCI_WORKLIST> or <SCIR_RESULT>.
   */
  | 'SCI_XML'
  /**
   * SCMON / usage statistics CSV export.
   * Source: Report SUSG (transaction SUSG) or SCMON monitor export.
   * Format: CSV with header row – ObjectName, ObjectType, CalledCount, LastUsed, Users.
   * Available: SAP NW 7.02+, ECC, S/4HANA.
   */
  | 'SCMON_CSV'
  /**
   * Custom Code Migration (CCM) app JSON export.
   * Source: SAP Custom Code Migration Fiori app (SYCM) or BTP CCM service.
   * Available: S/4HANA 1610+ on-premise / Private Cloud; BTP CCM for cloud.
   * Root key: "objects" array.
   */
  | 'CCM_JSON'
  /**
   * Custom Code Migration XML export (older format from report SYCM_GET_CALL_STATISTICS).
   * Available: S/4HANA 1610+, ECC with CCM add-on.
   * Root element: <CCM_RESULTS>.
   */
  | 'CCM_XML'
  /**
   * SAP Readiness Check JSON export.
   * Source: readiness.sap.com or embedded Readiness Check report.
   * Download: Readiness Check → Custom Code → Export JSON.
   * Available: ECC 6.0 with Readiness Check, S/4HANA all releases.
   */
  | 'READINESS_CHECK_JSON';

// ── ATC evidence ──────────────────────────────────────────────────────────

export interface ATCFinding {
  objectName: string;
  /** SAP object type key, e.g. PROG, CLAS */
  objectType: string;
  /** 1=Error, 2=Warning, 3=Info, 4=Other */
  priority: 1 | 2 | 3 | 4;
  checkId: string;
  messageText: string;
  sourceLine?: number;
  sourceColumn?: number;
}

// ── Code Inspector evidence ───────────────────────────────────────────────

export interface SCIFinding {
  objectName: string;
  objectType: string;
  checkId: string;
  /** Priority string from SCI, e.g. '1', 'HIGH', 'ERROR' */
  priority: string;
  messageText: string;
  sourceLine?: number;
}

// ── SCMON usage evidence ──────────────────────────────────────────────────

export interface SCMONEntry {
  objectName: string;
  objectType: string;
  /** Total call count within monitored period */
  calledCount: number;
  /** ISO date string of last usage, if available */
  lastUsedDate?: string;
  /** Distinct user count, if available */
  userCount?: number;
}

// ── Custom Code Migration evidence ───────────────────────────────────────

export interface CCMObject {
  objectName: string;
  objectType: string;
  /**
   * CCM compatibility status.
   * Typical values: COMPATIBLE, INCOMPATIBLE, UNCLEAR, NOT_RELEVANT, TO_BE_REVIEWED
   */
  status: string;
  suggestion?: string;
  /** Estimated effort: LOW, MEDIUM, HIGH */
  effort?: string;
  notes?: string;
}

// ── Readiness Check evidence ──────────────────────────────────────────────

export interface ReadinessCheckObject {
  objectName: string;
  objectType?: string;
  /** Category label from Readiness Check, e.g. 'MODIFICATION_MONITOR', 'SYNTAX_CHECK' */
  category: string;
  /** Severity: HIGH, MEDIUM, LOW, INFO */
  severity: string;
  recommendation?: string;
  details?: string;
}

// ── Evidence union ────────────────────────────────────────────────────────

export type ImportedEvidence =
  | { type: 'ATC'; findings: ATCFinding[] }
  | { type: 'SCI'; findings: SCIFinding[] }
  | { type: 'SCMON'; entries: SCMONEntry[] }
  | { type: 'CCM'; objects: CCMObject[] }
  | { type: 'READINESS_CHECK'; objects: ReadinessCheckObject[] };

// ── Evidence import request / result ──────────────────────────────────────

export interface EvidenceImportRequest {
  tenantId: string;
  projectId: string;
  analysisId: string;
  format: EvidenceImportFormat;
  /** Raw text content of the exported file – treated as untrusted data */
  fileContent: string;
  /** Original filename, for logging only */
  originalFileName: string;
  importedBy: string;
}

export interface EvidenceImportResult {
  tenantId: string;
  projectId: string;
  analysisId: string;
  format: EvidenceImportFormat;
  originalFileName: string;
  success: boolean;
  importedCount: number;
  evidence: ImportedEvidence;
  warnings: string[];
  errors: string[];
  importedAt: string;
}

// ── Stored evidence record (persistence) ──────────────────────────────────

export interface StoredEvidenceRecord {
  id: string;
  tenantId: string;
  projectId: string;
  analysisId: string;
  format: EvidenceImportFormat;
  originalFileName: string;
  importedBy: string;
  importedAt: string;
  /** Number of evidence items parsed */
  itemCount: number;
  /** Serialized ImportedEvidence JSON */
  evidenceJson: string;
  warnings: string[];
}
