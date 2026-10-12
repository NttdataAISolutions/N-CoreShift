/**
 * N-CoreShift – Phase 3: Mock AI Provider Adapter for testing
 *
 * Used exclusively in unit tests. Never used in production paths.
 */

import type {
  AICompletionRequest,
  AICompletionResponse,
  AIHealthStatus,
  AIModelInfo,
} from '../types/index.js';
import type { AIAdminProviderAdapter } from './AIProviderRegistry.js';

export interface MockAdminProviderOptions {
  providerId?: string;
  providerName?: string;
  configured?: boolean;
  available?: boolean;
  models?: AIModelInfo[];
  /** If set, healthCheck() throws this error string. */
  healthError?: string;
  /** If set, listModels() throws this error string. */
  listModelsError?: string;
  /** If set, generate() throws this error string. */
  generateError?: string;
  generateResponse?: Partial<AICompletionResponse>;
  /** Held internally to verify credentials are never leaked to callers. */
  secretKey?: string;
  /** When true, listModels() returns null to simulate a malformed provider response. */
  malformedModels?: boolean;
  /** When true, healthCheck() returns null to simulate a malformed provider response. */
  malformedHealth?: boolean;
}

export class MockAdminProvider implements AIAdminProviderAdapter {
  readonly providerId: string;
  readonly providerName: string;

  private _configured: boolean;
  private _available: boolean;
  private _models: AIModelInfo[];
  private _healthError?: string;
  private _listModelsError?: string;
  private _generateError?: string;
  private _generateResponse?: Partial<AICompletionResponse>;
  private _malformedModels: boolean;
  private _malformedHealth: boolean;
  // secretKey is intentionally stored but never exposed – used to verify
  // that credentials do not leak through any public API surface.
  private readonly _secretKey?: string;

  /** Tracks calls for test assertions */
  healthCheckCallCount = 0;
  listModelsCalls = 0;
  generateCalls = 0;

  constructor(opts: MockAdminProviderOptions = {}) {
    this.providerId = opts.providerId ?? 'mock-provider';
    this.providerName = opts.providerName ?? 'Mock Provider';
    this._configured = opts.configured ?? true;
    this._available = opts.available ?? true;
    this._models = opts.models ?? [
      { id: 'mock-gpt-4', name: 'Mock GPT-4' },
      { id: 'mock-gpt-3', name: 'Mock GPT-3' },
    ];
    this._healthError = opts.healthError;
    this._listModelsError = opts.listModelsError;
    this._generateError = opts.generateError;
    this._generateResponse = opts.generateResponse;
    this._malformedModels = opts.malformedModels ?? false;
    this._malformedHealth = opts.malformedHealth ?? false;
    this._secretKey = opts.secretKey;
  }

  isConfigured(): boolean {
    return this._configured;
  }

  async listModels(): Promise<AIModelInfo[]> {
    this.listModelsCalls++;
    if (this._malformedModels) {
      // Return a non-array to simulate a misbehaving provider for robustness tests.
      return null as unknown as AIModelInfo[];
    }
    if (this._listModelsError) {
      throw new Error(this._listModelsError);
    }
    return [...this._models];
  }

  async healthCheck(): Promise<AIHealthStatus> {
    this.healthCheckCallCount++;
    if (this._malformedHealth) {
      // Return a value that does not conform to AIHealthStatus – simulates a
      // misbehaving provider for robustness tests.
      return null as unknown as AIHealthStatus;
    }
    if (this._healthError) {
      throw new Error(this._healthError);
    }
    return {
      configured: this._configured,
      available: this._available,
      provider: this.providerId,
      model: 'mock-gpt-4',
      checkedAt: new Date().toISOString(),
      errorMessage: this._available ? undefined : 'Mock provider unavailable',
    };
  }

  async generate(request: AICompletionRequest): Promise<AICompletionResponse> {
    this.generateCalls++;
    if (this._generateError) {
      throw new Error(this._generateError);
    }
    return {
      content: this._generateResponse?.content ?? 'Mock response content',
      model: request.model ?? 'mock-gpt-4',
      provider: this.providerId,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      ...this._generateResponse,
    };
  }

  // ── Test helpers ────────────────────────────────────────────────────────

  /** Simulate provider becoming unconfigured */
  setConfigured(v: boolean): void {
    this._configured = v;
  }

  /** Simulate provider becoming unavailable */
  setAvailable(v: boolean): void {
    this._available = v;
  }

  /** Replace mock model list */
  setModels(models: AIModelInfo[]): void {
    this._models = models;
  }
}
