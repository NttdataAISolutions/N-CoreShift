/**
 * N-CoreShift Agent – Public barrel export
 */

// Types
export * from './types/index.js';

// N-CoreIQ Integration
export {
  NCoreIQClient,
  NCoreIQSourceProvider,
  InMemoryNCoreIQEvidenceStore,
  NCoreIQApiError,
  NCoreIQTimeoutError,
  NCoreIQUnavailableError,
  NCOREIQ_HTTP,
  NCOREIQ_PATHS,
} from './ncoreiq/index.js';

export type {
  NCoreIQClientConfig,
  NCoreIQAuthMode,
  NCoreIQConnectionTestResult,
  NCoreIQObjectEvidence,
  NCoreIQDependencyRecord,
  NCoreIQImportJob,
  BulkImportRequest,
  BulkImportResult,
  SAPPingResponse,
  PackageHierarchyResponse,
  RepositorySearchRequest,
  RepositorySearchResponse,
  RepositoryObjectMetadata,
  RepositoryObjectSource,
  DirectDependenciesResponse,
  ExtractionJobRequest,
  ExtractionJobCreatedResponse,
  JobStatusResponse,
} from './ncoreiq/index.js';

// Provider interfaces
export type { AIProvider, AIModelInfo } from './providers/AIProvider.js';
export type { VectorStore } from './providers/VectorStore.js';
export type { KnowledgeProvider } from './providers/KnowledgeProvider.js';
export type { CodeSourceProvider, SourceBundle, SourceFile } from './providers/CodeSourceProvider.js';
export type { FileStorageProvider } from './providers/FileStorageProvider.js';
export type { AuthProvider, AuthenticatedUser, NCoreShiftRole } from './providers/AuthProvider.js';
export type { IntegrationProvider, DestinationConfig, IntegrationRequest, IntegrationResponse } from './providers/IntegrationProvider.js';

// Domain service interfaces
export type {
  LandscapeReadinessResult,
  LandscapeProfileService,
  LandscapeReadinessService,
  SourceParser,
  CodeInventoryService,
  DependencyAnalyzer,
  FunctionalIntentAnalyzer,
  FitToStandardEvaluator,
  CleanCoreAssessmentEngine,
  ExtensibilityDecisionService,
  ModernizationPlanner,
  CodeGenerationService,
  AuditService,
  BackgroundJobService,
} from './services/domain-interfaces.js';
