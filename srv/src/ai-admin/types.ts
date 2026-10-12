/**
 * AI Admin types for srv – local to the Express server.
 * Deliberately self-contained; does NOT depend on the agent package.
 */

export type ProviderId = 'sap-ai-core' | 'sap-ai-interface' | 'openai';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  isConfigured: boolean;
  isActive: boolean;
  model?: string;
  endpointHint?: string; // hostname only, no secrets
}

export interface ProviderStatus extends ProviderInfo {
  available: boolean;
  checkedAt: string;
  latencyMs?: number;
  errorMessage?: string;
}

export interface ConnectionTestResult {
  providerId: ProviderId;
  success: boolean;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export type AuditAction =
  | 'SET_ACTIVE_PROVIDER'
  | 'TEST_CONNECTION'
  | 'REFRESH_STATUS';

export type AuditOutcome = 'SUCCESS' | 'FAILURE';

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  actor: string;
  providerId: ProviderId;
  detail: string;
  outcome: AuditOutcome;
}
