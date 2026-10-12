/**
 * srv/__tests__/ai-admin.test.ts
 *
 * Tests for the AI-Admin subsystem:
 *   - AiAdminRegistry (unit)
 *   - Provider adapters (unit – no real network calls; adapters are unconfigured)
 *   - Express router via supertest (integration)
 */

import request from 'supertest';
import express from 'express';
import { AiAdminRegistry } from '../src/ai-admin/registry';
import {
  SapAiCoreAdapter,
  SapAiInterfaceAdapter,
  OpenAIAdapter,
  BaseProviderAdapter,
} from '../src/ai-admin/adapters';
import { createAiAdminRouter } from '../src/ai-admin/router';
import type { ConnectionTestResult, ProviderId } from '../src/ai-admin/types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal stub adapter – always configured, always "succeeds" in <5 ms */
class StubAdapter extends BaseProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  readonly description = 'Stub for testing';

  constructor(id: ProviderId, name = `Stub-${id}`) {
    super();
    this.id = id;
    this.name = name;
  }

  isConfigured(): boolean {
    return true;
  }
  getModel(): string {
    return 'stub-model';
  }
  getEndpointHint(): string {
    return 'stub.example.com';
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return {
      providerId: this.id,
      success: true,
      latencyMs: 1,
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Build a minimal Express app wired to a registry */
function buildApp(registry: AiAdminRegistry) {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-admin', createAiAdminRouter(registry));
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.  AiAdminRegistry – unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('AiAdminRegistry – unit', () => {
  let registry: AiAdminRegistry;

  beforeEach(() => {
    registry = new AiAdminRegistry();
  });

  test('starts with no providers and no active provider', () => {
    expect(registry.listProviders()).toHaveLength(0);
    expect(registry.getActive()).toBeNull();
  });

  test('register() adds a provider', () => {
    registry.register(new StubAdapter('sap-ai-core'));
    expect(registry.listProviders()).toHaveLength(1);
  });

  test('setInitialActive() sets active when provider is registered', () => {
    registry.register(new StubAdapter('sap-ai-core'));
    registry.setInitialActive('sap-ai-core');
    expect(registry.getActive()).toBe('sap-ai-core');
  });

  test('setInitialActive() is a no-op for unknown provider', () => {
    registry.setInitialActive('openai');
    expect(registry.getActive()).toBeNull();
  });

  test('listProviders() marks the active provider correctly', () => {
    registry.register(new StubAdapter('sap-ai-core'));
    registry.register(new StubAdapter('openai'));
    registry.setInitialActive('openai');

    const list = registry.listProviders();
    const active = list.find((p) => p.isActive);
    const inactive = list.find((p) => !p.isActive);

    expect(active?.id).toBe('openai');
    expect(inactive?.id).toBe('sap-ai-core');
  });

  test('setActiveProvider() changes the active provider and logs audit', () => {
    registry.register(new StubAdapter('sap-ai-core'));
    registry.register(new StubAdapter('openai'));
    registry.setInitialActive('sap-ai-core');

    const ok = registry.setActiveProvider('openai', 'test-user');
    expect(ok).toBe(true);
    expect(registry.getActive()).toBe('openai');

    const audit = registry.getAuditLog(10);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].action).toBe('SET_ACTIVE_PROVIDER');
    expect(audit[0].actor).toBe('test-user');
    expect(audit[0].outcome).toBe('SUCCESS');
  });

  test('setActiveProvider() returns false for unknown provider', () => {
    const ok = registry.setActiveProvider('sap-ai-interface', 'user');
    expect(ok).toBe(false);
  });

  test('getProviderStatus() returns null for unknown id', async () => {
    const status = await registry.getProviderStatus('openai');
    expect(status).toBeNull();
  });

  test('getProviderStatus() returns configured status for stub', async () => {
    registry.register(new StubAdapter('openai'));
    const status = await registry.getProviderStatus('openai');

    expect(status).not.toBeNull();
    expect(status!.available).toBe(true);
    expect(status!.latencyMs).toBeDefined();
  });

  test('testConnection() returns null for unknown provider', async () => {
    const result = await registry.testConnection('sap-ai-core', 'tester');
    expect(result).toBeNull();
  });

  test('testConnection() returns result for stub and appends audit', async () => {
    registry.register(new StubAdapter('sap-ai-core'));
    const result = await registry.testConnection('sap-ai-core', 'ci-bot');

    expect(result!.success).toBe(true);

    const log = registry.getAuditLog(5);
    expect(log[0].action).toBe('TEST_CONNECTION');
    expect(log[0].actor).toBe('ci-bot');
  });

  test('getAuditLog() returns entries in reverse-chronological order', async () => {
    registry.register(new StubAdapter('sap-ai-core'));
    registry.register(new StubAdapter('openai'));

    await registry.testConnection('sap-ai-core', 'user-a');
    await registry.testConnection('openai', 'user-b');

    const log = registry.getAuditLog(10);
    // Most recent first
    expect(log[0].providerId).toBe('openai');
    expect(log[1].providerId).toBe('sap-ai-core');
  });

  test('getAuditLog() respects the limit parameter', async () => {
    registry.register(new StubAdapter('sap-ai-core'));
    for (let i = 0; i < 10; i++) {
      await registry.testConnection('sap-ai-core', `u${i}`);
    }
    expect(registry.getAuditLog(3)).toHaveLength(3);
  });

  test('getAllStatuses() returns one entry per registered provider', async () => {
    registry.register(new StubAdapter('sap-ai-core'));
    registry.register(new StubAdapter('openai'));

    const statuses = await registry.getAllStatuses();
    expect(statuses).toHaveLength(2);
    statuses.forEach((s) => expect(s.available).toBe(true));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.  Provider adapters – unit tests (no real network)
// ─────────────────────────────────────────────────────────────────────────────

describe('SapAiCoreAdapter', () => {
  let adapter: SapAiCoreAdapter;

  beforeEach(() => {
    // Ensure env is clean
    delete process.env['SAP_AI_CORE_BASE_URL'];
    delete process.env['SAP_AI_CORE_CLIENT_ID'];
    delete process.env['SAP_AI_CORE_CLIENT_SECRET'];
    delete process.env['SAP_AI_CORE_AUTH_URL'];
    adapter = new SapAiCoreAdapter();
  });

  test('isConfigured() is false without env vars', () => {
    expect(adapter.isConfigured()).toBe(false);
  });

  test('toProviderInfo() shape is correct', () => {
    const info = adapter.toProviderInfo(false);
    expect(info.id).toBe('sap-ai-core');
    expect(info.isConfigured).toBe(false);
    expect(info.isActive).toBe(false);
    expect(info.name).toContain('SAP AI Core');
  });

  test('testConnection() fails gracefully when unconfigured', async () => {
    const result = await adapter.testConnection();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing');
    expect(result.latencyMs).toBe(0);
  });

  test('getModel() returns default model when env not set', () => {
    expect(adapter.getModel()).toBe('gpt-4o');
  });
});

describe('SapAiInterfaceAdapter', () => {
  let adapter: SapAiInterfaceAdapter;

  beforeEach(() => {
    delete process.env['SAP_AI_INTERFACE_URL'];
    delete process.env['SAP_AI_INTERFACE_API_KEY'];
    adapter = new SapAiInterfaceAdapter();
  });

  test('isConfigured() is false without env vars', () => {
    expect(adapter.isConfigured()).toBe(false);
  });

  test('testConnection() fails gracefully when unconfigured', async () => {
    const result = await adapter.testConnection();
    expect(result.success).toBe(false);
    expect(result.latencyMs).toBe(0);
  });

  test('getEndpointHint() is undefined when env not set', () => {
    expect(adapter.getEndpointHint()).toBeUndefined();
  });
});

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    delete process.env['OPENAI_API_KEY'];
    adapter = new OpenAIAdapter();
  });

  test('isConfigured() is false without env vars', () => {
    expect(adapter.isConfigured()).toBe(false);
  });

  test('testConnection() fails gracefully when unconfigured', async () => {
    const result = await adapter.testConnection();
    expect(result.success).toBe(false);
    expect(result.error).toContain('OPENAI_API_KEY');
  });

  test('getEndpointHint() always returns openai endpoint', () => {
    expect(adapter.getEndpointHint()).toBe('api.openai.com');
  });

  test('getModel() returns default model when env not set', () => {
    expect(adapter.getModel()).toBe('gpt-4o');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.  HTTP Router – integration tests via supertest
// ─────────────────────────────────────────────────────────────────────────────

describe('AI-Admin Router – HTTP', () => {
  let registry: AiAdminRegistry;
  let app: express.Application;

  beforeEach(() => {
    registry = new AiAdminRegistry();
    registry.register(new StubAdapter('sap-ai-core', 'SAP AI Core'));
    registry.register(new StubAdapter('sap-ai-interface', 'SAP AI Interface'));
    registry.register(new StubAdapter('openai', 'OpenAI'));
    registry.setInitialActive('sap-ai-interface');
    app = buildApp(registry);
  });

  // GET /providers ──────────────────────────────────────────────────────────

  test('GET /providers returns all providers with active flag', async () => {
    const res = await request(app).get('/api/ai-admin/providers');

    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(3);
    expect(res.body.activeProvider).toBe('sap-ai-interface');

    const active = res.body.providers.find(
      (p: { isActive: boolean }) => p.isActive,
    );
    expect(active.id).toBe('sap-ai-interface');
  });

  // GET /providers/:id/status ───────────────────────────────────────────────

  test('GET /providers/:id/status returns status for known provider', async () => {
    const res = await request(app).get(
      '/api/ai-admin/providers/sap-ai-core/status',
    );

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('sap-ai-core');
    expect(res.body.available).toBe(true);
    expect(res.body).toHaveProperty('checkedAt');
  });

  test('GET /providers/:id/status 404 for unknown provider', async () => {
    const res = await request(app).get(
      '/api/ai-admin/providers/unknown/status',
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('unknown');
  });

  // POST /providers/:id/test ────────────────────────────────────────────────

  test('POST /providers/:id/test returns connection result', async () => {
    const res = await request(app)
      .post('/api/ai-admin/providers/openai/test')
      .set('X-User', 'test-admin');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.providerId).toBe('openai');
    expect(res.body).toHaveProperty('latencyMs');
  });

  test('POST /providers/:id/test 404 for unknown provider', async () => {
    const res = await request(app).post('/api/ai-admin/providers/ghost/test');
    expect(res.status).toBe(404);
  });

  // POST /active-provider ───────────────────────────────────────────────────

  test('POST /active-provider switches the active provider', async () => {
    const res = await request(app)
      .post('/api/ai-admin/active-provider')
      .set('Content-Type', 'application/json')
      .send({ providerId: 'openai' });

    expect(res.status).toBe(200);
    expect(res.body.activeProvider).toBe('openai');

    // Confirm the registry reflects the change
    expect(registry.getActive()).toBe('openai');
  });

  test('POST /active-provider 400 when body missing providerId', async () => {
    const res = await request(app)
      .post('/api/ai-admin/active-provider')
      .set('Content-Type', 'application/json')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing');
  });

  test('POST /active-provider 404 for unknown providerId', async () => {
    const res = await request(app)
      .post('/api/ai-admin/active-provider')
      .send({ providerId: 'unknown-provider' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('unknown-provider');
  });

  // GET /audit ──────────────────────────────────────────────────────────────

  test('GET /audit returns audit entries after activity', async () => {
    // Trigger some audit events
    await request(app).post('/api/ai-admin/active-provider').send({ providerId: 'openai' });
    await request(app).post('/api/ai-admin/providers/sap-ai-core/test');

    const res = await request(app).get('/api/ai-admin/audit');

    expect(res.status).toBe(200);
    expect(res.body.entries).toBeDefined();
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(2);
  });

  test('GET /audit respects ?limit query param', async () => {
    // Generate 5 audit events
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/ai-admin/providers/openai/test');
    }

    const res = await request(app).get('/api/ai-admin/audit?limit=2');

    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(2);
  });

  test('GET /audit returns empty array when no activity', async () => {
    const res = await request(app).get('/api/ai-admin/audit');
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  // Audit log entry shape ───────────────────────────────────────────────────

  test('audit entry has required fields', async () => {
    await request(app)
      .post('/api/ai-admin/providers/sap-ai-core/test')
      .set('X-User', 'qa-engineer');

    const res = await request(app).get('/api/ai-admin/audit');
    const entry = res.body.entries[0];

    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('action');
    expect(entry).toHaveProperty('actor');
    expect(entry).toHaveProperty('providerId');
    expect(entry).toHaveProperty('outcome');
    expect(entry.actor).toBe('qa-engineer');
  });
});
