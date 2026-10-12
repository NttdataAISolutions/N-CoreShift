/**
 * N-CoreShift – Phase 3: AI Provider Administration Types
 *
 * Administrator-controlled provider/model configuration.
 * Credentials stay in environment/secret management – never in DB or UI.
 * No silent failover to another provider (Principle 23).
 */

import type { AIHealthStatus, AIModelInfo } from '../types/index.js';

// ── Registry-level types ───────────────────────────────────────────────────

export interface AIProviderRegistryEntry {
  /** Unique machine-readable provider id, e.g. 'sap-ai-core' */
  providerId: string;
  /** Human-readable name shown in admin UI */
  providerName: string;
  /** Whether all required environment variables are present */
  isConfigured: boolean;
  /** Whether this is the currently active provider */
  isActive: boolean;
  /** The model id that is selected for generation */
  activeModelId?: string;
}

/** Snapshot of a provider's runtime status – may be cached */
export interface AIProviderStatusSnapshot {
  providerId: string;
  providerName: string;
  isConfigured: boolean;
  isActive: boolean;
  activeModelId?: string;
  /** Convenience field: true when the provider is reachable and operational */
  available: boolean;
  health: AIHealthStatus;
  availableModels: AIModelInfo[];
  /** ISO timestamp of when this status was last refreshed */
  checkedAt: string;
}

/** Result returned by testConnection() – distinct from a full status snapshot */
export interface ConnectionTestResult {
  providerId: string;
  /** True when the provider is reachable and operational */
  available: boolean;
  /** Whether all required environment variables are present */
  configured: boolean;
  /** ISO timestamp of when the check was performed */
  checkedAt: string;
  /** Human-readable error message when available=false */
  errorMessage?: string;
}

/** Request to switch the active provider or model */
export interface SetActiveProviderRequest {
  providerId: string;
  modelId?: string;
}

/** Audit event recorded whenever provider or model configuration changes */
export interface AIProviderAuditEvent {
  id: string;
  tenantId: string;
  changedBy: string;
  changedAt: string;
  action:
    | 'PROVIDER_ACTIVATED'
    | 'MODEL_CHANGED'
    | 'CONNECTION_TESTED'
    | 'MODELS_REFRESHED'
    | 'PROVIDER_DEACTIVATED';
  previousProviderId?: string;
  newProviderId?: string;
  previousModelId?: string;
  newModelId?: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'UNAUTHORIZED';
  detail?: string;
}

// ── Error types ────────────────────────────────────────────────────────────

export class AIProviderRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AIProviderRegistryError';
  }
}

/** Thrown when caller lacks PlatformAdmin role */
export class AIAdminUnauthorizedError extends Error {
  constructor(message = 'AI provider administration requires PlatformAdmin role') {
    super(message);
    this.name = 'AIAdminUnauthorizedError';
  }
}

// ── Role constants ─────────────────────────────────────────────────────────

export const AI_ADMIN_ROLES = ['NCoreShift.PlatformAdmin'] as const;

// ── Status cache TTL (ms) ──────────────────────────────────────────────────

/** Status cache is valid for this many milliseconds before a fresh check is needed */
export const STATUS_CACHE_TTL_MS = 30_000;
