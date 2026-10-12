/**
 * N-CoreShift – SAP AI Core Provider (BTP Adapter)
 *
 * Implements the AIProvider contract using SAP AI Core (Generative AI Hub).
 * Authenticates via OAuth2 Client Credentials, then calls the AI Core
 * chat-completions inference endpoint (OpenAI-compatible format).
 *
 * Design decisions:
 *  - Token is cached in-process and refreshed 60 s before expiry.
 *  - All HTTP calls use built-in fetch (Node ≥ 18) – no extra dependencies.
 *  - Retries on 429 / 5xx with exponential back-off.
 *  - Never logs credentials; only sanitised request metadata.
 */

import type { AIProvider, AIModelInfo } from '../providers/AIProvider.js';
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIHealthStatus,
} from '../types/index.js';
import type { AiCoreAdapterConfig } from './types.js';

// ── OAuth2 token cache ────────────────────────────────────────────────────────

interface OAuthToken {
  accessToken: string;
  expiresAt: number; // epoch seconds
}

const EXPIRY_BUFFER_SEC = 60;

// ── Chat completion shapes (OpenAI-compatible) ────────────────────────────────

interface ChatCompletionRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  max_tokens?: number;
  temperature?: number;
  stream?: false;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Retry helper ──────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: Parameters<typeof fetch>[1],
  maxRetries: number,
  timeoutMs: number,
): Promise<Response> {
  let lastError: Error = new Error('Unknown fetch error');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 30_000));
    }
    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`HTTP ${response.status} from AI Core`);
      continue;
    }
    return response;
  }
  throw lastError;
}

// ── AiCoreProvider ────────────────────────────────────────────────────────────

export class AiCoreProvider implements AIProvider {
  readonly providerId = 'sap-ai-core';
  readonly providerName = 'SAP AI Core (Generative AI Hub)';

  private readonly cfg: Required<AiCoreAdapterConfig>;
  private _token: OAuthToken | null = null;

  constructor(config: AiCoreAdapterConfig) {
    this.cfg = {
      timeoutMs: 120_000,
      maxRetries: 3,
      ...config,
    };
  }

  // ── AIProvider: isConfigured ────────────────────────────────────────────────

  isConfigured(): boolean {
    return !!(
      this.cfg.apiUrl &&
      this.cfg.tokenUrl &&
      this.cfg.clientId &&
      this.cfg.clientSecret &&
      this.cfg.deploymentId
    );
  }

  // ── AIProvider: listModels ──────────────────────────────────────────────────

  async listModels(): Promise<AIModelInfo[]> {
    // Return the single configured deployment as the available model.
    // A future enhancement can query the AI Core /lm/models endpoint.
    return [
      {
        id: this.cfg.deploymentId,
        name: this.cfg.defaultModel,
        description: `SAP AI Core deployment ${this.cfg.deploymentId}`,
        capabilities: ['chat', 'text-generation'],
      },
    ];
  }

  // ── AIProvider: healthCheck ─────────────────────────────────────────────────

  async healthCheck(): Promise<AIHealthStatus> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      return {
        configured: false,
        available: false,
        provider: this.providerName,
        model: this.cfg.defaultModel,
        checkedAt,
        errorMessage: 'AI Core adapter is not configured',
      };
    }
    try {
      await this._fetchToken();
      return {
        configured: true,
        available: true,
        provider: this.providerName,
        model: this.cfg.defaultModel,
        checkedAt,
      };
    } catch (err) {
      return {
        configured: true,
        available: false,
        provider: this.providerName,
        model: this.cfg.defaultModel,
        checkedAt,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── AIProvider: generate ────────────────────────────────────────────────────

  async generate(request: AICompletionRequest): Promise<AICompletionResponse> {
    const accessToken = await this._fetchToken();

    const body: ChatCompletionRequest = {
      model: request.model ?? this.cfg.defaultModel,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      stream: false,
    };

    const url = this._buildInferenceUrl();

    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'AI-Resource-Group': this.cfg.resourceGroup,
        },
        body: JSON.stringify(body),
      },
      this.cfg.maxRetries,
      this.cfg.timeoutMs,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `AI Core inference failed: HTTP ${response.status} – ${text.substring(0, 400)}`,
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('AI Core returned an empty choices array');
    }

    return {
      content: choice.message.content,
      model: data.model ?? this.cfg.defaultModel,
      provider: this.providerId,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _buildInferenceUrl(): string {
    const base = this.cfg.apiUrl.replace(/\/$/, '');
    return `${base}/v2/inference/deployments/${this.cfg.deploymentId}/chat/completions`;
  }

  private async _fetchToken(): Promise<string> {
    if (this._token && this._token.expiresAt > Date.now() / 1000 + EXPIRY_BUFFER_SEC) {
      return this._token.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(this.cfg.tokenUrl + '/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI Core OAuth2 token fetch failed: HTTP ${res.status} – ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    this._token = {
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    };

    return this._token.accessToken;
  }

  /** Expose config metadata for admin/diagnostics (no secrets). */
  get metadata(): Record<string, string> {
    return {
      deploymentId: this.cfg.deploymentId,
      defaultModel: this.cfg.defaultModel,
      resourceGroup: this.cfg.resourceGroup,
      apiUrl: this.cfg.apiUrl,
    };
  }
}
