/**
 * N-CoreShift – AIProvider abstraction (Principle 13)
 *
 * ALL LLM communication must go through this interface.
 * No component may call an LLM SDK directly.
 * Do not silently fall back to a different provider (Principle 23).
 */

import type {
  AICompletionRequest,
  AICompletionResponse,
  AIHealthStatus,
  AIModelInfo,
} from '../types/index.js';

export type { AIModelInfo };

export interface AIProvider {
  /** Unique provider identifier, e.g. 'sap-ai-core', 'openai' */
  readonly providerId: string;

  /** Human-readable provider name */
  readonly providerName: string;

  /**
   * Returns true if the provider has the minimum required configuration
   * (e.g. endpoint and credentials are present in environment).
   * Must not make network calls.
   */
  isConfigured(): boolean;

  /**
   * List available models for this provider.
   * May make a network call; callers should handle errors.
   */
  listModels(): Promise<AIModelInfo[]>;

  /**
   * Performs a lightweight connectivity and auth check.
   * Must not silently return healthy when it is not.
   */
  healthCheck(): Promise<AIHealthStatus>;

  /**
   * Send a completion request to the provider.
   * Throws if the provider is unavailable – do not fall back silently.
   */
  generate(request: AICompletionRequest): Promise<AICompletionResponse>;
}
