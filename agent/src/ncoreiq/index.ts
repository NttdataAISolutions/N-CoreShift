/**
 * N-CoreShift — N-CoreIQ Integration Module
 *
 * Public exports for the NCoreIQ source provider integration.
 *
 * Architecture:
 *   NCoreIQClient             — HTTP client for N-CoreIQ REST API v1
 *   NCoreIQSourceProvider     — CodeSourceProvider implementation
 *   NCoreIQTokenProvider      — XSUAA client_credentials token provider (m2m auth)
 *   types                     — N-CoreIQ DTO and N-CoreShift mapping types
 *
 * Machine-to-machine authentication (Foundation C):
 *   NCOREIQ_AUTH_MODE=xsuaa   → XSUAAClientCredentialsTokenProvider
 *   NCOREIQ_AUTH_MODE=disabled → DisabledModeTokenProvider (local dev only)
 *
 *   Production usage:
 *     const provider = createNCoreIQTokenProvider(
 *       getConfig().xsuaa,
 *       getConfig().ncoreiq!.authMode,
 *       isProduction()
 *     );
 *     const client = new NCoreIQSourceProvider(
 *       { baseUrl, tokenProvider: provider },
 *       store, audit, jobs,
 *       { authMode: 'xsuaa', isProduction: true }
 *     );
 */

// Types (DTOs and domain mapping)
export type {
  NCoreIQClientConfig,
  NCoreIQAuthMode,
  NCoreIQErrorBody,
  NCoreIQValidationError,
  SAPPingResponse,
  NCoreIQPackageEntry,
  PackageListOptions,
  PackageHierarchyResponse,
  RepositorySearchRequest,
  NCoreIQObjectEntry,
  SearchStatistics,
  RepositorySearchResponse,
  RepositoryObjectMetadata,
  SourceLine,
  SourceComponent,
  RepositoryObjectSource,
  DependencyRelation,
  DependencyQueryOptions,
  DirectDependenciesResponse,
  SAPObjectRef,
  DependencyTraversalRequest,
  DependencyTraversalResponse,
  DependencyScope,
  ReverseLookupRequest,
  ReverseLookupResponse,
  ImpactAnalysisRequest,
  ImpactAnalysisResponse,
  ExtractionJobObject,
  ExtractionSpec,
  ExportFormat,
  ExtractionJobRequest,
  NCoreIQJobStatus,
  JobArtifactSummary,
  JobProgress,
  ExtractionJobCreatedResponse,
  JobStatusResponse,
  JobResultResponse,
  NCoreIQConnectionTestResult,
  NCoreIQObjectEvidence,
  NCoreIQDependencyRecord,
  NCoreIQImportJob,
} from './types.js';

export {
  NCoreIQApiError,
  NCoreIQTimeoutError,
  NCoreIQUnavailableError,
  NCOREIQ_HTTP,
} from './types.js';

// Client
export { NCoreIQClient, NCOREIQ_PATHS } from './NCoreIQClient.js';

// Token provider (XSUAA machine-to-machine authentication)
export type { NCoreIQTokenProvider, XSUAABindingConfig } from './NCoreIQTokenProvider.js';
export {
  XSUAAClientCredentialsTokenProvider,
  DisabledModeTokenProvider,
  NCoreIQTokenAcquisitionError,
  createNCoreIQTokenProvider,
} from './NCoreIQTokenProvider.js';

// Provider and store
export {
  NCoreIQSourceProvider,
  InMemoryNCoreIQEvidenceStore,
} from './NCoreIQSourceProvider.js';

export type {
  BulkImportRequest,
  BulkImportResult,
  NCoreIQSourceProviderOptions,
} from './NCoreIQSourceProvider.js';
