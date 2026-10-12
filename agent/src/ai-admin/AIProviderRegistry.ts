/**
 * N-CoreShift – Phase 3: AI Provider Registry
 *
 * Central registry for AI provider management.
 * - Providers are registered at startup.
 * - Status snapshots are cached for STATUS_CACHE_TTL_MS.
 * - Only PlatformAdmin may mutate active provider / model.
 * - No silent failover: if active provider is unavailable, caller receives
 *   an explicit error – the application never quietly switches providers.
 * - Credentials stay in environment; never stored in registry state or DB.
 *
 * Principles satisfied: 13 (AIProvider abstraction), 23 (no silent failover).
 */

import { randomUUID } from 'crypto';
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIHealthStatus,
  AIModelInfo,
} from '../types/index.js';
import {
  AI_ADMIN_ROLES,
  AIAdminUnauthorizedError,
  AIProviderRegistryError,
  STATUS_CACHE_TTL_MS,
  type AIProviderAuditEvent,
  type AIProviderRegistryEntry,
  type AIProviderStatusSnapshot,
  type ConnectionTestResult,
  type SetActiveProviderRequest,
} from './types.js';

// ── Adapter contract ──────────────────────────────────────────────────────

/**
 * Every AI provider implementation must satisfy this interface.
 * This is the boundary between the registry and concrete providers.
 */
export interface AIAdminProviderAdapter {
  readonly providerId: string;
  readonly providerName: string;
  /** Returns true when all required environment variables are present. */
  isConfigured(): boolean;
  /** Discovers the models available to the configured credentials. */
  listModels(): Promise<AIModelInfo[]>;
  /** Performs a lightweight connectivity/reachability check. */
  healthCheck(): Promise<AIHealthStatus>;
  /** Executes a generation request through this provider. */
  generate(request: AICompletionRequest): Promise<AICompletionResponse>;
}

// ── Auth context ──────────────────────────────────────────────────────────

export interface AIAdminAuthContext {
  tenantId: string;
  userId: string;
  roles: string[];
}

// ── Audit store contract ──────────────────────────────────────────────────

export interface AIAuditStore {
  append(event: AIProviderAuditEvent): Promise<void>;
  list(tenantId: string): Promise<AIProviderAuditEvent[]>;
}

/** In-memory implementation. Replace with a DB-backed store in production. */
export class InMemoryAuditStore implements AIAuditStore {
  private readonly events: AIProviderAuditEvent[] = [];

  async append(event: AIProviderAuditEvent): Promise<void> {
    this.events.push(event);
  }

  async list(tenantId: string): Promise<AIProviderAuditEvent[]> {
    return this.events
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt));
  }
}

// ── Registry ──────────────────────────────────────────────────────────────

export class AIProviderRegistry {
  private readonly providers = new Map<string, AIAdminProviderAdapter>();
  private activeProviderId: string | null = null;
  private activeModelId: string | undefined = undefined;

  /** providerId → status snapshot (with checkedAt timestamp for TTL) */
  private readonly statusCache = new Map<string, AIProviderStatusSnapshot>();

  constructor(private readonly auditStore: AIAuditStore) {}

  // ── Provider registration ──────────────────────────────────────────────

  /**
   * Register a provider adapter. Must be called at application startup
   * before any admin or generation operations.
   */
  register(provider: AIAdminProviderAdapter): void {
    this.providers.set(provider.providerId, provider);
  }

  /** Returns a static listing of all registered providers. */
  listRegistered(): AIProviderRegistryEntry[] {
    return Array.from(this.providers.values()).map((p) => ({
      providerId: p.providerId,
      providerName: p.providerName,
      isConfigured: p.isConfigured(),
      isActive: p.providerId === this.activeProviderId,
      activeModelId:
        p.providerId === this.activeProviderId ? this.activeModelId : undefined,
    }));
  }

  // ── Status snapshots ───────────────────────────────────────────────────

  /**
   * Returns a full status snapshot for a single provider.
   * Cached for STATUS_CACHE_TTL_MS; pass { forceRefresh: true } to bypass cache.
   */
  async getStatusSnapshot(
    providerId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<AIProviderStatusSnapshot> {
    const forceRefresh = options?.forceRefresh ?? false;
    const provider = this._resolveProvider(providerId);
    const cached = this.statusCache.get(providerId);
    const now = Date.now();

    if (
      !forceRefresh &&
      cached !== undefined &&
      now - new Date(cached.checkedAt).getTime() < STATUS_CACHE_TTL_MS
    ) {
      return cached;
    }

    const checkedAt = new Date().toISOString();
    let health: AIHealthStatus;
    let availableModels: AIModelInfo[] = [];

    if (!provider.isConfigured()) {
      // Short-circuit: unconfigured providers are never reachable
      health = {
        configured: false,
        available: false,
        provider: providerId,
        model: this.activeModelId ?? '',
        checkedAt,
      };
    } else {
      try {
        const rawHealth = await provider.healthCheck();
        // Guard against malformed (null / non-object) healthCheck responses
        if (rawHealth === null || rawHealth === undefined || typeof rawHealth !== 'object') {
          health = {
            configured: true,
            available: false,
            provider: providerId,
            model: this.activeModelId ?? '',
            checkedAt,
            errorMessage: 'Provider returned a malformed health response.',
          };
        } else {
          health = rawHealth;
        }
      } catch (err) {
        health = {
          configured: provider.isConfigured(),
          available: false,
          provider: providerId,
          model: this.activeModelId ?? '',
          checkedAt,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }

      try {
        availableModels = await provider.listModels();
      } catch {
        // listModels failure is non-fatal for a status snapshot
        availableModels = [];
      }
    }

    const snapshot: AIProviderStatusSnapshot = {
      providerId,
      providerName: provider.providerName,
      isConfigured: provider.isConfigured(),
      isActive: providerId === this.activeProviderId,
      activeModelId:
        providerId === this.activeProviderId ? this.activeModelId : undefined,
      available: health.available,
      health,
      availableModels,
      checkedAt,
    };

    this.statusCache.set(providerId, snapshot);
    return snapshot;
  }

  /** Returns status snapshots for every registered provider. */
  async getAllStatusSnapshots(): Promise<AIProviderStatusSnapshot[]> {
    const results: AIProviderStatusSnapshot[] = [];
    for (const id of Array.from(this.providers.keys())) {
      results.push(await this.getStatusSnapshot(id));
    }
    return results;
  }

  // ── Public model discovery ────────────────────────────────────────────

  /**
   * Returns the list of models available on the given provider.
   * Read-only; no admin role required.
   * Returns an empty array when the provider is not configured.
   */
  async listModels(providerId: string): Promise<AIModelInfo[]> {
    const provider = this._resolveProvider(providerId);
    if (!provider.isConfigured()) {
      return [];
    }
    try {
      const models = await provider.listModels();
      if (!Array.isArray(models)) {
        throw new AIProviderRegistryError(
          'MODEL_LIST_FAILED',
          `Provider '${providerId}' returned a malformed model list.`,
        );
      }
      return models;
    } catch (err) {
      if (err instanceof AIProviderRegistryError) throw err;
      throw new AIProviderRegistryError(
        'MODEL_LIST_FAILED',
        `Failed to retrieve model list from provider '${providerId}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Active provider / model management ────────────────────────────────

  /**
   * Sets the active provider (and optionally model).
   * Requires PlatformAdmin role. Audit-logged.
   * Records UNAUTHORIZED audit event and throws if caller lacks the role.
   */
  async setActiveProvider(
    auth: AIAdminAuthContext,
    req: SetActiveProviderRequest,
  ): Promise<void> {
    if (!this._hasAdminRole(auth)) {
      await this._audit(auth, {
        action: 'PROVIDER_ACTIVATED',
        newProviderId: req.providerId,
        outcome: 'UNAUTHORIZED',
        detail: 'Caller lacks PlatformAdmin role',
      });
      throw new AIAdminUnauthorizedError();
    }

    const provider = this._resolveProvider(req.providerId);

    if (!provider.isConfigured()) {
      await this._audit(auth, {
        action: 'PROVIDER_ACTIVATED',
        previousProviderId: this.activeProviderId ?? undefined,
        newProviderId: req.providerId,
        outcome: 'FAILURE',
        detail: 'Provider not configured – required environment variables missing.',
      });
      throw new AIProviderRegistryError(
        'PROVIDER_NOT_CONFIGURED',
        `Provider '${req.providerId}' is not configured. Ensure required environment variables are set.`,
      );
    }

    const prevProviderId = this.activeProviderId ?? undefined;
    const prevModelId = this.activeModelId;

    this.activeProviderId = req.providerId;
    this.activeModelId = req.modelId;

    // Invalidate cache for affected providers
    if (prevProviderId) this.statusCache.delete(prevProviderId);
    this.statusCache.delete(req.providerId);

    await this._audit(auth, {
      action: 'PROVIDER_ACTIVATED',
      previousProviderId: prevProviderId,
      newProviderId: req.providerId,
      previousModelId: prevModelId,
      newModelId: req.modelId,
      outcome: 'SUCCESS',
    });
  }

  /**
   * Changes the active model for the currently active provider.
   * Verifies the model exists before committing. Audit-logged.
   * Records UNAUTHORIZED audit event and throws if caller lacks the role.
   */
  async setActiveModel(
    auth: AIAdminAuthContext,
    modelId: string,
  ): Promise<void> {
    if (!this._hasAdminRole(auth)) {
      await this._audit(auth, {
        action: 'MODEL_CHANGED',
        newModelId: modelId,
        outcome: 'UNAUTHORIZED',
        detail: 'Caller lacks PlatformAdmin role',
      });
      throw new AIAdminUnauthorizedError();
    }

    if (!this.activeProviderId) {
      throw new AIProviderRegistryError(
        'NO_ACTIVE_PROVIDER',
        'No active provider is set. Activate a provider before selecting a model.',
      );
    }

    const provider = this._resolveProvider(this.activeProviderId);

    // Verify the model exists on the provider
    let availableModels: AIModelInfo[];
    try {
      availableModels = await provider.listModels();
    } catch {
      throw new AIProviderRegistryError(
        'MODEL_LIST_FAILED',
        `Cannot verify model '${modelId}': failed to retrieve model list from provider '${this.activeProviderId}'.`,
      );
    }

    const modelExists = availableModels.some((m) => m.id === modelId);
    if (!modelExists) {
      await this._audit(auth, {
        action: 'MODEL_CHANGED',
        newProviderId: this.activeProviderId,
        previousModelId: this.activeModelId,
        newModelId: modelId,
        outcome: 'FAILURE',
        detail: `Model '${modelId}' not found on provider '${this.activeProviderId}'.`,
      });
      throw new AIProviderRegistryError(
        'MODEL_NOT_FOUND',
        `Model '${modelId}' is not available on provider '${this.activeProviderId}'.`,
      );
    }

    const prevModelId = this.activeModelId;
    this.activeModelId = modelId;
    this.statusCache.delete(this.activeProviderId);

    await this._audit(auth, {
      action: 'MODEL_CHANGED',
      newProviderId: this.activeProviderId,
      previousModelId: prevModelId,
      newModelId: modelId,
      outcome: 'SUCCESS',
    });
  }

  // ── Connection testing ────────────────────────────────────────────────

  /**
   * Performs an explicit connectivity test for the given provider.
   * Bypasses the status cache and records an audit event.
   * Requires PlatformAdmin role.
   * Returns a ConnectionTestResult with `configured`, `available`, and optional
   * `errorMessage` – distinct from a full AIProviderStatusSnapshot.
   */
  async testConnection(
    auth: AIAdminAuthContext,
    providerId: string,
  ): Promise<ConnectionTestResult> {
    if (!this._hasAdminRole(auth)) {
      await this._audit(auth, {
        action: 'CONNECTION_TESTED',
        newProviderId: providerId,
        outcome: 'UNAUTHORIZED',
        detail: 'Caller lacks PlatformAdmin role',
      });
      throw new AIAdminUnauthorizedError();
    }

    const snapshot = await this.getStatusSnapshot(providerId, {
      forceRefresh: true,
    });

    const errorMessage = snapshot.available
      ? undefined
      : (snapshot.health.errorMessage ?? 'Provider returned unhealthy status.');

    await this._audit(auth, {
      action: 'CONNECTION_TESTED',
      newProviderId: providerId,
      outcome: snapshot.available ? 'SUCCESS' : 'FAILURE',
      detail: snapshot.available ? 'Connection test passed.' : errorMessage,
    });

    return {
      providerId,
      available: snapshot.available,
      configured: snapshot.isConfigured,
      checkedAt: snapshot.checkedAt,
      errorMessage,
    };
  }

  // ── Model refresh ─────────────────────────────────────────────────────

  /**
   * Explicitly refreshes the model list for the given provider.
   * Requires PlatformAdmin role.
   */
  async refreshModels(
    auth: AIAdminAuthContext,
    providerId: string,
  ): Promise<AIModelInfo[]> {
    if (!this._hasAdminRole(auth)) {
      await this._audit(auth, {
        action: 'MODELS_REFRESHED',
        newProviderId: providerId,
        outcome: 'UNAUTHORIZED',
        detail: 'Caller lacks PlatformAdmin role',
      });
      throw new AIAdminUnauthorizedError();
    }

    const provider = this._resolveProvider(providerId);
    let models: AIModelInfo[];

    try {
      models = await provider.listModels();
    } catch (err) {
      await this._audit(auth, {
        action: 'MODELS_REFRESHED',
        newProviderId: providerId,
        outcome: 'FAILURE',
        detail: err instanceof Error ? err.message : String(err),
      });
      throw new AIProviderRegistryError(
        'MODEL_LIST_FAILED',
        `Failed to refresh models for provider '${providerId}'.`,
      );
    }

    // Invalidate cached snapshot so model list is fresh
    this.statusCache.delete(providerId);

    await this._audit(auth, {
      action: 'MODELS_REFRESHED',
      newProviderId: providerId,
      outcome: 'SUCCESS',
      detail: `${models.length} model(s) retrieved.`,
    });

    return models;
  }

  // ── Generation ────────────────────────────────────────────────────────

  /**
   * Delegates a generation request to the active provider.
   * Throws NO_ACTIVE_PROVIDER when no provider is active.
   * Propagates provider errors directly – never silently falls over to
   * a different provider (Principle 23).
   */
  async generate(request: AICompletionRequest): Promise<AICompletionResponse> {
    if (!this.activeProviderId) {
      throw new AIProviderRegistryError(
        'NO_ACTIVE_PROVIDER',
        'No active AI provider is set. Configure an active provider before generating.',
      );
    }

    const provider = this._resolveProvider(this.activeProviderId);

    // Do NOT catch and rethrow onto a different provider here.
    return provider.generate(request);
  }

  // ── Audit history ─────────────────────────────────────────────────────

  /** Returns the audit history for the given tenant. */
  async getAuditHistory(tenantId: string): Promise<AIProviderAuditEvent[]> {
    return this.auditStore.list(tenantId);
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _resolveProvider(providerId: string): AIAdminProviderAdapter {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AIProviderRegistryError(
        'PROVIDER_NOT_FOUND',
        `Provider '${providerId}' is not registered.`,
      );
    }
    return provider;
  }

  private _hasAdminRole(auth: AIAdminAuthContext): boolean {
    return auth.roles.some((r) =>
      (AI_ADMIN_ROLES as ReadonlyArray<string>).includes(r),
    );
  }

  private async _audit(
    auth: AIAdminAuthContext,
    fields: Omit<AIProviderAuditEvent, 'id' | 'tenantId' | 'changedBy' | 'changedAt'>,
  ): Promise<void> {
    const event: AIProviderAuditEvent = {
      id: randomUUID(),
      tenantId: auth.tenantId,
      changedBy: auth.userId,
      changedAt: new Date().toISOString(),
      ...fields,
    };
    await this.auditStore.append(event);
  }
}
