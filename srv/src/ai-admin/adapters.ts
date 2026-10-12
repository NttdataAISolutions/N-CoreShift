/**
 * Concrete AI provider adapters for the Administration API.
 * Each adapter reads its credentials exclusively from process.env so that
 * the .env file loaded by server.ts at startup is the single source of truth.
 */

import https from 'https';
import http from 'http';
import { ProviderId, ProviderInfo, ConnectionTestResult } from './types';

// ── Minimal HTTP helpers (no external deps) ────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
}

function httpRequest(
  method: string,
  url: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const allHeaders: Record<string, string | number> = { ...headers };
    if (body) {
      allHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method,
        headers: allHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(9000, () => {
      req.destroy(new Error('Request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

// ── Base adapter ───────────────────────────────────────────────────────────

export abstract class BaseProviderAdapter {
  abstract readonly id: ProviderId;
  abstract readonly name: string;
  abstract readonly description: string;

  abstract isConfigured(): boolean;
  abstract getModel(): string | undefined;
  abstract getEndpointHint(): string | undefined;
  abstract testConnection(): Promise<ConnectionTestResult>;

  toProviderInfo(isActive: boolean): ProviderInfo {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      isConfigured: this.isConfigured(),
      isActive,
      model: this.getModel(),
      endpointHint: this.getEndpointHint(),
    };
  }
}

// ── SAP AI Core (Generative AI Hub) ───────────────────────────────────────

export class SapAiCoreAdapter extends BaseProviderAdapter {
  readonly id: ProviderId = 'sap-ai-core';
  readonly name = 'SAP AI Core (Generative AI Hub)';
  readonly description =
    'Enterprise AI on SAP BTP with OAuth2 client-credentials and per-deployment models';

  private e(key: string): string {
    return process.env[key] ?? '';
  }

  isConfigured(): boolean {
    return !!(
      this.e('SAP_AI_CORE_BASE_URL') &&
      this.e('SAP_AI_CORE_CLIENT_ID') &&
      this.e('SAP_AI_CORE_CLIENT_SECRET') &&
      this.e('SAP_AI_CORE_AUTH_URL')
    );
  }

  getModel(): string | undefined {
    return this.e('SAP_AI_CORE_MODEL') || 'gpt-4o';
  }

  getEndpointHint(): string | undefined {
    const raw = this.e('SAP_AI_CORE_BASE_URL');
    if (!raw) return undefined;
    try {
      return new URL(raw).hostname;
    } catch {
      return undefined;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const base = { providerId: this.id, checkedAt: new Date().toISOString() };

    if (!this.isConfigured()) {
      return {
        ...base,
        success: false,
        latencyMs: 0,
        error:
          'Missing: SAP_AI_CORE_BASE_URL, SAP_AI_CORE_CLIENT_ID, SAP_AI_CORE_CLIENT_SECRET, or SAP_AI_CORE_AUTH_URL',
      };
    }

    try {
      const authUrl = this.e('SAP_AI_CORE_AUTH_URL');
      const tokenUrl = authUrl.endsWith('/oauth/token')
        ? authUrl
        : `${authUrl}/oauth/token`;
      const body = `grant_type=client_credentials&client_id=${encodeURIComponent(
        this.e('SAP_AI_CORE_CLIENT_ID'),
      )}&client_secret=${encodeURIComponent(this.e('SAP_AI_CORE_CLIENT_SECRET'))}`;
      const res = await httpRequest('POST', tokenUrl, body, {
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      const latencyMs = Date.now() - start;
      if (res.status === 200) {
        return { ...base, success: true, latencyMs };
      }
      return {
        ...base,
        success: false,
        latencyMs,
        error: `OAuth2 token endpoint returned HTTP ${res.status}`,
      };
    } catch (err: unknown) {
      return {
        ...base,
        success: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ── SAP AI Interface (N-Suite) ─────────────────────────────────────────────

export class SapAiInterfaceAdapter extends BaseProviderAdapter {
  readonly id: ProviderId = 'sap-ai-interface';
  readonly name = 'SAP AI Interface (N-Suite)';
  readonly description =
    'Shared AI services via the N-Suite AI Interface endpoint and API key';

  private e(key: string): string {
    return process.env[key] ?? '';
  }

  isConfigured(): boolean {
    return !!(this.e('SAP_AI_INTERFACE_URL') && this.e('SAP_AI_INTERFACE_API_KEY'));
  }

  getModel(): string | undefined {
    return undefined; // model determined by the interface
  }

  getEndpointHint(): string | undefined {
    const raw = this.e('SAP_AI_INTERFACE_URL');
    if (!raw) return undefined;
    try {
      return new URL(raw).hostname;
    } catch {
      return undefined;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const base = { providerId: this.id, checkedAt: new Date().toISOString() };

    if (!this.isConfigured()) {
      return {
        ...base,
        success: false,
        latencyMs: 0,
        error: 'Missing: SAP_AI_INTERFACE_URL or SAP_AI_INTERFACE_API_KEY',
      };
    }

    try {
      // Probe the health/ping endpoint (fall back to root if no /health)
      const rawUrl = this.e('SAP_AI_INTERFACE_URL').replace(/\/$/, '');
      const probeUrl = `${rawUrl}/health`;
      const res = await httpRequest('GET', probeUrl, undefined, {
        'x-api-key': this.e('SAP_AI_INTERFACE_API_KEY'),
      });
      const latencyMs = Date.now() - start;
      if (res.status < 500) {
        return { ...base, success: true, latencyMs };
      }
      return {
        ...base,
        success: false,
        latencyMs,
        error: `Health endpoint returned HTTP ${res.status}`,
      };
    } catch (err: unknown) {
      return {
        ...base,
        success: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ── OpenAI ─────────────────────────────────────────────────────────────────

export class OpenAIAdapter extends BaseProviderAdapter {
  readonly id: ProviderId = 'openai';
  readonly name = 'OpenAI';
  readonly description =
    'Direct OpenAI API – local/dev fallback; not recommended for production';

  private e(key: string): string {
    return process.env[key] ?? '';
  }

  isConfigured(): boolean {
    return !!this.e('OPENAI_API_KEY');
  }

  getModel(): string | undefined {
    return this.e('OPENAI_MODEL') || 'gpt-4o';
  }

  getEndpointHint(): string | undefined {
    return 'api.openai.com';
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const base = { providerId: this.id, checkedAt: new Date().toISOString() };

    if (!this.isConfigured()) {
      return {
        ...base,
        success: false,
        latencyMs: 0,
        error: 'Missing: OPENAI_API_KEY',
      };
    }

    try {
      // Lightweight call: list models (paginated, returns fast)
      const res = await httpRequest(
        'GET',
        'https://api.openai.com/v1/models?limit=1',
        undefined,
        { Authorization: `Bearer ${this.e('OPENAI_API_KEY')}` },
      );
      const latencyMs = Date.now() - start;
      if (res.status === 200) {
        return { ...base, success: true, latencyMs };
      }
      return {
        ...base,
        success: false,
        latencyMs,
        error: `OpenAI /v1/models returned HTTP ${res.status}`,
      };
    } catch (err: unknown) {
      return {
        ...base,
        success: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
