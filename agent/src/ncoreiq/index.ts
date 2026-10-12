/**
 * N-CoreShift — N-CoreIQ Integration Module
 *
 * Public exports for the NCoreIQ source provider integration.
 *
 * Architecture:
 *   NCoreIQClient        — HTTP client for N-CoreIQ REST API v1
 *   NCoreIQSourceProvider — CodeSourceProvider implementation
 *   types                — N-CoreIQ DTO and N-CoreShift mapping types
 *
 * SERVICE_TO_SERVICE_AUTH: DEFERRED UNTIL N-CORESHIFT BTP/XSUAA
 * APPLICATION IDENTITY IS ESTABLISHED.
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

// Provider and store
export {
  NCoreIQSourceProvider,
  InMemoryNCoreIQEvidenceStore,
} from './NCoreIQSourceProvider.js';

export type {
  BulkImportRequest,
  BulkImportResult,
} from './NCoreIQSourceProvider.js';
