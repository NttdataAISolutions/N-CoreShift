/**
 * AiAdminRegistry – holds all registered provider adapters, tracks the
 * active provider, and maintains an in-memory audit log.
 */

import { randomUUID } from 'crypto';
import {
  ProviderId,
  ProviderInfo,
  ProviderStatus,
  ConnectionTestResult,
  AuditEntry,
  AuditAction,
  AuditOutcome,
} from './types';
import { BaseProviderAdapter } from './adapters';

export class AiAdminRegistry {
  private adapters = new Map<ProviderId, BaseProviderAdapter>();
  private activeId: ProviderId | null = null;
  private auditLog: AuditEntry[] = [];

  // ── Registration ──────────────────────────────────────────────────────────

  register(adapter: BaseProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  setInitialActive(id: ProviderId): void {
    if (this.adapters.has(id)) {
      this.activeId = id;
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  listProviders(): ProviderInfo[] {
    return Array.from(this.adapters.values()).map((a) =>
      a.toProviderInfo(a.id === this.activeId),
    );
  }

  getActive(): ProviderId | null {
    return this.activeId;
  }

  async getProviderStatus(id: ProviderId): Promise<ProviderStatus | null> {
    const adapter = this.adapters.get(id);
    if (!adapter) return null;

    const info = adapter.toProviderInfo(id === this.activeId);
    if (!adapter.isConfigured()) {
      return {
        ...info,
        available: false,
        checkedAt: new Date().toISOString(),
        errorMessage: 'Provider is not configured',
      };
    }

    const result = await adapter.testConnection();
    this.addAudit({
      action: 'REFRESH_STATUS',
      actor: 'system',
      providerId: id,
      detail: result.success
        ? `Latency ${result.latencyMs} ms`
        : (result.error ?? 'Unknown error'),
      outcome: result.success ? 'SUCCESS' : 'FAILURE',
    });

    return {
      ...info,
      available: result.success,
      checkedAt: result.checkedAt,
      latencyMs: result.latencyMs,
      errorMessage: result.error,
    };
  }

  async getAllStatuses(): Promise<ProviderStatus[]> {
    const ids = Array.from(this.adapters.keys());
    return Promise.all(ids.map((id) => this.getProviderStatus(id) as Promise<ProviderStatus>));
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  async testConnection(id: ProviderId, actor: string): Promise<ConnectionTestResult | null> {
    const adapter = this.adapters.get(id);
    if (!adapter) return null;

    const result = await adapter.testConnection();
    this.addAudit({
      action: 'TEST_CONNECTION',
      actor,
      providerId: id,
      detail: result.success
        ? `OK – ${result.latencyMs} ms`
        : (result.error ?? 'Failed'),
      outcome: result.success ? 'SUCCESS' : 'FAILURE',
    });
    return result;
  }

  setActiveProvider(id: ProviderId, actor: string): boolean {
    if (!this.adapters.has(id)) return false;
    const previous = this.activeId;
    this.activeId = id;
    this.addAudit({
      action: 'SET_ACTIVE_PROVIDER',
      actor,
      providerId: id,
      detail: `Changed from ${previous ?? 'none'} to ${id}`,
      outcome: 'SUCCESS',
    });
    return true;
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  getAuditLog(limit = 100): AuditEntry[] {
    return [...this.auditLog].reverse().slice(0, limit);
  }

  private addAudit(entry: {
    action: AuditAction;
    actor: string;
    providerId: ProviderId;
    detail: string;
    outcome: AuditOutcome;
  }): void {
    this.auditLog.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    });
    // Cap the in-memory log at 500 entries
    if (this.auditLog.length > 500) this.auditLog.shift();
  }
}
