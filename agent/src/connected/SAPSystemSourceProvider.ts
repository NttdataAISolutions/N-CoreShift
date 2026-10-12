/**
 * N-CoreShift – Phase 11: SAPSystemSourceProvider abstract contract
 *
 * Defines the interface for connected SAP source ingestion.
 * V1 ships a StubSAPSystemSourceProvider that documents the verified integration
 * mechanisms without requiring a live SAP connection.
 *
 * Real implementations will be built once file-based analysis is end-to-end:
 *  - AbapGitSourceProvider   – reads source via /sap/bc/abapgit HTTP service
 *  - RfcHttpSourceProvider   – reads source via RFC/HTTP (ICF-enabled FMs)
 *
 * Security rules enforced by this contract:
 *  1. Credentials MUST route through BTP Destination Service in production.
 *  2. No SAP passwords may be stored in N-CoreShift database records.
 *  3. Fetched source content is treated as untrusted data (Principle 17).
 *  4. All operations are tenant/project scoped (Principle 18).
 */

import type {
  SAPSystemConnectionConfig,
  ConnectionTestResult,
  PackageBrowseRequest,
  PackageBrowseResult,
  ConnectedIngestionRequest,
  ConnectedIngestionResult,
  ConnectedAccessMechanism,
  SAPSystemInfo,
} from './types.js';

// ── Abstract provider interface ───────────────────────────────────────────

export interface SAPSystemSourceProvider {
  /** Unique provider identifier */
  readonly providerId: string;

  /** Human-readable name */
  readonly providerName: string;

  /** The access mechanism this provider uses */
  readonly accessMechanism: ConnectedAccessMechanism;

  /**
   * Test connectivity and confirm the system is accessible.
   * Must NOT throw – errors are returned in ConnectionTestResult.
   */
  testConnection(
    config: SAPSystemConnectionConfig,
  ): Promise<ConnectionTestResult>;

  /**
   * Browse available packages and objects in the target system.
   * Returns the packages and objects visible for the given scope selection.
   */
  browsePackages(request: PackageBrowseRequest): Promise<PackageBrowseResult>;

  /**
   * Ingest source code from the target SAP system.
   * Fetches ABAP source text for objects in the scope selection and stores
   * them as an InMemorySourceFile bundle for downstream analysis.
   * Must validate and sanitise all fetched content.
   */
  ingestFromSystem(
    request: ConnectedIngestionRequest,
  ): Promise<ConnectedIngestionResult>;
}

// ── Integration mechanism documentation ──────────────────────────────────
// Reference information for each verified mechanism.
// Do not add mechanisms that are not publicly documented by SAP.

export const CONNECTED_ACCESS_MECHANISM_DOCS: Record<
  ConnectedAccessMechanism,
  {
    name: string;
    description: string;
    prerequisites: string[];
    availableFor: string[];
    limitations: string[];
    sapDocRef?: string;
  }
> = {
  ABAPGIT_HTTP: {
    name: 'abapGit HTTP Service',
    description:
      'Reads ABAP source via the abapGit ICF service endpoint /sap/bc/abapgit. ' +
      'The service exposes package contents as serialised XML (abapGit format) ' +
      'which N-CoreShift deserialises to extract raw ABAP source files.',
    prerequisites: [
      'abapGit installed on source SAP system (open-source, from github.com/abapGit/abapGit)',
      'ICF service /sap/bc/abapgit activated in transaction SICF',
      'User with authorisation object S_RFC and abapGit-specific roles',
      'For On-Premise: SAP Cloud Connector configured for the BTP subaccount',
    ],
    availableFor: [
      'SAP ECC 6.0 EhP6+ with abapGit installed',
      'SAP S/4HANA On-Premise 1511+',
      'SAP S/4HANA Private Cloud (PCE) where abapGit is approved',
    ],
    limitations: [
      'Not available for SAP S/4HANA Public Cloud (RISE) – use file upload instead',
      'Read-only; cannot write back to source system',
      'Very large packages (>5000 objects) may time out; use scope selection to limit',
      'Generated objects (e.g. CDS underlying views) may not be exposed',
    ],
    sapDocRef:
      'https://docs.abapgit.org/ref-http-service.html',
  },

  RFC_HTTP: {
    name: 'RFC via HTTP (ICF)',
    description:
      'Calls RFC-enabled function modules via the SAP ICF HTTP endpoint. ' +
      'Specific FMs such as RFC_READ_REPORT (reads ABAP source lines) are used ' +
      'to fetch source code. Requires ICF service /sap/bc/rfc activated.',
    prerequisites: [
      'ICF service /sap/bc/rfc activated in transaction SICF',
      'Function modules RFC_READ_REPORT, SUSR_GET_ADMIN_USER_LOGIN_INFO allowed in RFC',
      'User with S_RFC authorisation for the called FMs',
      'For On-Premise: SAP Cloud Connector configured',
    ],
    availableFor: [
      'SAP ECC 6.0+',
      'SAP S/4HANA On-Premise 1511+',
      'SAP S/4HANA Private Cloud (PCE)',
    ],
    limitations: [
      'Not available for SAP S/4HANA Public Cloud',
      'FM RFC_READ_REPORT limited to ~72 char lines (legacy); newer FMs preferred',
      'BTP must whitelist the RFC destination and all called FM names',
    ],
    sapDocRef:
      'https://help.sap.com/docs/ABAP_PLATFORM_NEW/753088fc00704d0a80e7fbd6803c8adb/4b96c97b74b24d96e10000000a42189e.html',
  },

  ODATA_API: {
    name: 'OData API',
    description:
      'Reads object metadata and optionally source via published SAP OData services. ' +
      'The ABAP Development Tools (ADT) REST API (/sap/bc/adt/) is the most complete ' +
      'option for reading source, object lists, and where-used information.',
    prerequisites: [
      'ABAP Development Tools (ADT) backend services activated in SICF',
      'User with S_ADT_RES authorisation object',
      'For On-Premise: SAP Cloud Connector configured',
    ],
    availableFor: [
      'SAP S/4HANA On-Premise 1809+ (ADT services)',
      'SAP S/4HANA Private Cloud (PCE)',
      'SAP ECC 6.0 EhP7+ with ABAP Development Tools backend',
    ],
    limitations: [
      'Not available for SAP S/4HANA Public Cloud',
      'ADT REST API is not officially exposed as a supported integration API by SAP',
      'Use at own risk for integrations; prefer abapGit HTTP where available',
    ],
    sapDocRef:
      'https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/adt-rest-api',
  },
};

// ── Stub provider (development / testing) ────────────────────────────────

/**
 * StubSAPSystemSourceProvider
 *
 * Development-only stub that satisfies the SAPSystemSourceProvider interface
 * without making any actual network calls. Used for:
 *  - Unit testing the plumbing around connected source workflows
 *  - Local development without a live SAP system
 *  - Demonstrating the provider contract to future implementors
 *
 * NOT suitable for production use.
 */
export class StubSAPSystemSourceProvider implements SAPSystemSourceProvider {
  readonly providerId = 'STUB_SAP_SYSTEM';
  readonly providerName = 'Stub SAP System Provider (Development Only)';
  readonly accessMechanism: ConnectedAccessMechanism = 'ABAPGIT_HTTP';

  async testConnection(
    config: SAPSystemConnectionConfig,
  ): Promise<ConnectionTestResult> {
    // Validate config structure without calling the network
    const errors = _validateConnectionConfig(config);
    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join('; '),
        testedAt: new Date().toISOString(),
      };
    }

    const mockInfo: SAPSystemInfo = {
      systemId: 'S4D',
      description: `Stub system for ${config.systemLabel}`,
      product: 'SAP S/4HANA On-Premise',
      release: '2023',
      deploymentModel: config.deploymentModel,
      supportedAccessMechanisms: ['ABAPGIT_HTTP', 'RFC_HTTP'],
    };

    return {
      success: true,
      systemInfo: mockInfo,
      testedAt: new Date().toISOString(),
    };
  }

  async browsePackages(
    request: PackageBrowseRequest,
  ): Promise<PackageBrowseResult> {
    const pkg = request.packageName ?? '(TOP-LEVEL)';
    return {
      packages: [
        {
          packageName: 'ZCUSTOM_CORE',
          description: 'Stub package – custom core objects',
          objectCount: 42,
          subPackages: ['ZCUSTOM_CORE_UTIL', 'ZCUSTOM_CORE_API'],
        },
      ],
      objects: [
        {
          objectName: 'ZSTUB_REPORT',
          objectType: 'PROG',
          packageName: pkg,
          description: 'Stub report object',
          namespace: 'Z',
          lastChanged: '20240101',
          changedBy: 'STUBUSER',
        },
      ],
      totalObjectCount: 1,
      accessMechanismUsed: this.accessMechanism,
      warnings: [
        'StubSAPSystemSourceProvider: no real SAP connection. Data is fabricated for development.',
      ],
    };
  }

  async ingestFromSystem(
    _request: ConnectedIngestionRequest,
  ): Promise<ConnectedIngestionResult> {
    return {
      success: true,
      bundleId: `STUB-BUNDLE-${Date.now()}`,
      importedObjectCount: 0,
      skippedObjects: [],
      warnings: [
        'StubSAPSystemSourceProvider: connected ingestion not implemented. ' +
          'Use FileUploadSourceProvider for file-based ingestion.',
      ],
      accessMechanismUsed: this.accessMechanism,
      importedAt: new Date().toISOString(),
    };
  }
}

// ── Internal validation helpers ───────────────────────────────────────────

function _validateConnectionConfig(
  config: SAPSystemConnectionConfig,
): string[] {
  const errors: string[] = [];

  if (!config.systemLabel || config.systemLabel.trim() === '') {
    errors.push('systemLabel is required');
  }

  if (config.useDestinationService) {
    if (!config.destinationName || config.destinationName.trim() === '') {
      errors.push(
        'destinationName is required when useDestinationService is true',
      );
    }
  } else {
    // Direct connection (dev/test only)
    if (!config.host || config.host.trim() === '') {
      errors.push(
        'host is required when not using BTP Destination Service',
      );
    }
    if (!config.httpPort && !config.httpsPort) {
      errors.push(
        'At least one of httpPort or httpsPort is required for direct connection',
      );
    }
  }

  if (
    config.deploymentModel === 'ON_PREMISE' &&
    config.useDestinationService &&
    config.useCloudConnector === undefined
  ) {
    // Warn but don't error – Cloud Connector may be optional in some topologies
  }

  return errors;
}

export { _validateConnectionConfig as validateConnectionConfig };
