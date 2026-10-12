/**
 * N-CoreShift – Domain Service Interfaces (Playbook Section 6)
 *
 * These are the core domain boundaries. They must remain independent of
 * CAP handlers and React components. Implementations live in later phases.
 */

import type { TenantScope, LandscapeReadinessState } from '../types/index.js';

// ---------------------------------------------------------------------------
// Landscape
// ---------------------------------------------------------------------------

export interface LandscapeReadinessResult {
  readinessState: LandscapeReadinessState;
  completionPercent: number;
  missingRequiredFields: string[];
  warnings: string[];
  assessmentAllowed: boolean;
  codeGenerationAllowed: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

export interface LandscapeProfileService {
  createProfile(scope: TenantScope, data: unknown): Promise<unknown>;
  updateProfile(scope: TenantScope, profileId: string, data: unknown): Promise<unknown>;
  getProfile(scope: TenantScope, profileId: string): Promise<unknown | null>;
  listVersions(scope: TenantScope, profileId: string): Promise<unknown[]>;
}

export interface LandscapeReadinessService {
  evaluate(scope: TenantScope, projectId: string): Promise<LandscapeReadinessResult>;
  approve(scope: TenantScope, projectId: string, approverId: string, level: 'ASSESSMENT' | 'CODE_GENERATION'): Promise<void>;
}

// ---------------------------------------------------------------------------
// Source / Inventory
// ---------------------------------------------------------------------------

export interface SourceParser {
  /** Parse raw source text and extract object-level metadata. */
  parse(fileName: string, content: string): Promise<unknown>;
}

export interface CodeInventoryService {
  buildInventory(scope: TenantScope, bundleId: string): Promise<void>;
  getInventory(scope: TenantScope, bundleId: string): Promise<unknown[]>;
}

export interface DependencyAnalyzer {
  analyze(scope: TenantScope, objectId: string): Promise<unknown>;
  getGraph(scope: TenantScope, bundleId: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export interface FunctionalIntentAnalyzer {
  analyze(scope: TenantScope, objectId: string): Promise<unknown>;
  override(scope: TenantScope, objectId: string, consultantInput: unknown): Promise<void>;
}

export interface FitToStandardEvaluator {
  evaluate(scope: TenantScope, objectId: string): Promise<unknown>;
}

export interface CleanCoreAssessmentEngine {
  assess(scope: TenantScope, objectId: string): Promise<unknown>;
  listAssessments(scope: TenantScope): Promise<unknown[]>;
}

export interface ExtensibilityDecisionService {
  recommend(scope: TenantScope, objectId: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Planning / Generation
// ---------------------------------------------------------------------------

export interface ModernizationPlanner {
  createPlan(scope: TenantScope, assessmentId: string): Promise<unknown>;
  approvePlan(scope: TenantScope, planId: string, approverId: string): Promise<void>;
  rejectPlan(scope: TenantScope, planId: string, reason: string): Promise<void>;
}

export interface CodeGenerationService {
  generate(scope: TenantScope, planId: string): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export interface AuditService {
  record(scope: TenantScope, event: string, actor: string, data?: unknown): Promise<void>;
  list(scope: TenantScope, filter?: unknown): Promise<unknown[]>;
}

export interface BackgroundJobService {
  enqueue(scope: TenantScope, jobType: string, payload: unknown): Promise<string>;
  getStatus(jobId: string): Promise<unknown>;
  cancel(jobId: string): Promise<void>;
}
