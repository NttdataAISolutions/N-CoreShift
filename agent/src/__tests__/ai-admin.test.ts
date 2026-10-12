/// <reference types="jest" />
import { jest } from '@jest/globals';
/**
 * N-CoreShift – Phase 3: AI Provider Registry Tests
 *
 * Covers: provider registration, activation, model management, testConnection,
 * authorization (RBAC), secret redaction, status caching (TTL), malformed
 * provider responses, no-silent-failover (Principle 23), generate() guard,
 * and multi-tenant audit isolation.
 */

import {
  AIProviderRegistry,
  InMemoryAuditStore,
} from "../ai-admin/AIProviderRegistry.js";
import type { AIAdminAuthContext } from "../ai-admin/AIProviderRegistry.js";
import { MockAdminProvider } from "../ai-admin/MockAdminProvider.js";
import {
  AIAdminUnauthorizedError,
  AIProviderRegistryError,
  STATUS_CACHE_TTL_MS,
} from "../ai-admin/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRegistry() {
  const auditStore = new InMemoryAuditStore();
  const registry = new AIProviderRegistry(auditStore);
  return { registry, auditStore };
}

const ADMIN: AIAdminAuthContext = {
  tenantId: "tenant-1",
  userId: "user-admin",
  roles: ["NCoreShift.PlatformAdmin"],
};

const TENANT2_ADMIN: AIAdminAuthContext = {
  tenantId: "tenant-2",
  userId: "user-admin-2",
  roles: ["NCoreShift.PlatformAdmin"],
};

const USER: AIAdminAuthContext = {
  tenantId: "tenant-1",
  userId: "user-basic",
  roles: ["NCoreShift.User"],
};

// ── 1. Registration and listing ───────────────────────────────────────────

describe("AIProviderRegistry – registration", () => {
  it("lists registered providers with isActive=false before activation", () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "p1" }));
    registry.register(new MockAdminProvider({ providerId: "p2", configured: false }));

    const entries = registry.listRegistered();
    expect(entries).toHaveLength(2);

    const p1 = entries.find((e) => e.providerId === "p1")!;
    expect(p1.isActive).toBe(false);
    expect(p1.isConfigured).toBe(true);
    expect(p1.activeModelId).toBeUndefined();

    const p2 = entries.find((e) => e.providerId === "p2")!;
    expect(p2.isConfigured).toBe(false);
  });

  it("throws PROVIDER_NOT_FOUND for status of unregistered provider", async () => {
    const { registry } = makeRegistry();
    const err = await registry.getStatusSnapshot("ghost").catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderRegistryError);
    expect((err as AIProviderRegistryError).code).toBe("PROVIDER_NOT_FOUND");
  });

  it("snapshot includes providerName, isConfigured, and checkedAt", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "p1", providerName: "SAP AI Core" })
    );
    const snap = await registry.getStatusSnapshot("p1");
    expect(snap.providerName).toBe("SAP AI Core");
    expect(snap.isConfigured).toBe(true);
    expect(snap.checkedAt).toBeTruthy();
  });
});

// ── 2. Provider activation ────────────────────────────────────────────────

describe("AIProviderRegistry – provider activation", () => {
  it("activates a configured provider and marks it active", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "sap-ai-core" }));
    await registry.setActiveProvider(ADMIN, { providerId: "sap-ai-core", modelId: "gpt-4o" });
    const active = registry.listRegistered().find((e) => e.providerId === "sap-ai-core")!;
    expect(active.isActive).toBe(true);
    expect(active.activeModelId).toBe("gpt-4o");
  });

  it("only one provider is active at a time after switching", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "p1" }));
    registry.register(new MockAdminProvider({ providerId: "p2" }));
    await registry.setActiveProvider(ADMIN, { providerId: "p1" });
    await registry.setActiveProvider(ADMIN, { providerId: "p2" });
    const entries = registry.listRegistered();
    expect(entries.filter((e) => e.isActive)).toHaveLength(1);
    expect(entries.find((e) => e.isActive)!.providerId).toBe("p2");
  });

  it("rejects activation of unconfigured provider with PROVIDER_NOT_CONFIGURED", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "unconf", configured: false }));
    const err = await registry
      .setActiveProvider(ADMIN, { providerId: "unconf" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderRegistryError);
    expect((err as AIProviderRegistryError).code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("throws PROVIDER_NOT_FOUND for unregistered provider", async () => {
    const { registry } = makeRegistry();
    const err = await registry
      .setActiveProvider(ADMIN, { providerId: "ghost" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderRegistryError);
    expect((err as AIProviderRegistryError).code).toBe("PROVIDER_NOT_FOUND");
  });

  it("records SUCCESS audit with userId, newProviderId, newModelId", async () => {
    const { registry, auditStore } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "prov-a" }));
    await registry.setActiveProvider(ADMIN, { providerId: "prov-a", modelId: "m1" });
    const history = await auditStore.list(ADMIN.tenantId);
    const evt = history.find((e) => e.action === "PROVIDER_ACTIVATED" && e.outcome === "SUCCESS")!;
    expect(evt.newProviderId).toBe("prov-a");
    expect(evt.newModelId).toBe("m1");
    expect(evt.changedBy).toBe(ADMIN.userId);
    expect(evt.changedAt).toBeTruthy();
  });

  it("records FAILURE audit when activation is rejected", async () => {
    const { registry, auditStore } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "unconf", configured: false }));
    await registry.setActiveProvider(ADMIN, { providerId: "unconf" }).catch(() => null);
    const history = await auditStore.list(ADMIN.tenantId);
    const evt = history.find((e) => e.action === "PROVIDER_ACTIVATED");
    expect(evt).toBeDefined();
    expect(evt!.outcome).toBe("FAILURE");
  });

  it("records previousProviderId when switching providers", async () => {
    const { registry, auditStore } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "first" }));
    registry.register(new MockAdminProvider({ providerId: "second" }));
    await registry.setActiveProvider(ADMIN, { providerId: "first" });
    await registry.setActiveProvider(ADMIN, { providerId: "second" });
    const history = await auditStore.list(ADMIN.tenantId);
    const evt = history
      .filter((e) => e.action === "PROVIDER_ACTIVATED" && e.outcome === "SUCCESS")
      .at(-1)!;
    expect(evt.previousProviderId).toBe("first");
    expect(evt.newProviderId).toBe("second");
  });
});

// ── 3. Model management ───────────────────────────────────────────────────

describe("AIProviderRegistry – model management", () => {
  it("sets active model when present in listModels", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", models: [{ id: "model-a", name: "Model A" }] })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov" });
    await registry.setActiveModel(ADMIN, "model-a");
    expect(registry.listRegistered()[0].activeModelId).toBe("model-a");
  });

  it("throws MODEL_NOT_FOUND for unknown model", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", models: [{ id: "model-a", name: "Model A" }] })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov" });
    const err = await registry.setActiveModel(ADMIN, "nonexistent").catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderRegistryError);
    expect((err as AIProviderRegistryError).code).toBe("MODEL_NOT_FOUND");
  });

  it("throws MODEL_LIST_FAILED when listModels() throws", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", listModelsError: "Network timeout" })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov" });
    const err = await registry.setActiveModel(ADMIN, "any").catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderRegistryError);
    expect((err as AIProviderRegistryError).code).toBe("MODEL_LIST_FAILED");
  });

  it("throws NO_ACTIVE_PROVIDER when no provider is active", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "prov" }));
    const err = await registry.setActiveModel(ADMIN, "model-a").catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderRegistryError);
    expect((err as AIProviderRegistryError).code).toBe("NO_ACTIVE_PROVIDER");
  });

  it("records MODEL_CHANGED audit with previous/new model ids", async () => {
    const { registry, auditStore } = makeRegistry();
    registry.register(
      new MockAdminProvider({
        providerId: "prov",
        models: [
          { id: "model-a", name: "Model A" },
          { id: "model-b", name: "Model B" },
        ],
      })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov", modelId: "model-a" });
    await registry.setActiveModel(ADMIN, "model-b");
    const history = await auditStore.list(ADMIN.tenantId);
    const evt = history.find((e) => e.action === "MODEL_CHANGED")!;
    expect(evt.previousModelId).toBe("model-a");
    expect(evt.newModelId).toBe("model-b");
    expect(evt.outcome).toBe("SUCCESS");
  });
});

// ── 4. testConnection ─────────────────────────────────────────────────────

describe("AIProviderRegistry – testConnection", () => {
  it("returns available=true for healthy provider", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "healthy" }));
    const health = await registry.testConnection(ADMIN, "healthy");
    expect(health.available).toBe(true);
    expect(health.configured).toBe(true);
  });

  it("returns available=false when healthCheck reports unavailable", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "down", available: false }));
    const health = await registry.testConnection(ADMIN, "down");
    expect(health.available).toBe(false);
  });

  it("captures errorMessage when healthCheck throws", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "throws", healthError: "Connection refused" })
    );
    const health = await registry.testConnection(ADMIN, "throws");
    expect(health.available).toBe(false);
    expect(health.errorMessage).toContain("Connection refused");
  });

  it("returns configured=false for unconfigured provider", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "unconf", configured: false }));
    const health = await registry.testConnection(ADMIN, "unconf");
    expect(health.configured).toBe(false);
    expect(health.available).toBe(false);
  });

  it("records CONNECTION_TESTED audit event", async () => {
    const { registry, auditStore } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "prov" }));
    await registry.testConnection(ADMIN, "prov");
    const history = await auditStore.list(ADMIN.tenantId);
    expect(history.some((e) => e.action === "CONNECTION_TESTED")).toBe(true);
  });
});

// ── 5. Authorization / RBAC ───────────────────────────────────────────────

describe("AIProviderRegistry – authorization", () => {
  it("rejects setActiveProvider for non-admin user", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "prov" }));
    const err = await registry.setActiveProvider(USER, { providerId: "prov" }).catch((e) => e);
    expect(err).toBeInstanceOf(AIAdminUnauthorizedError);
  });

  it("rejects setActiveModel for non-admin user", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", models: [{ id: "m1", name: "M1" }] })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov" });
    const err = await registry.setActiveModel(USER, "m1").catch((e) => e);
    expect(err).toBeInstanceOf(AIAdminUnauthorizedError);
  });

  it("records UNAUTHORIZED audit event when non-admin attempts change", async () => {
    const { registry, auditStore } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "prov" }));
    await registry.setActiveProvider(USER, { providerId: "prov" }).catch(() => null);
    const history = await auditStore.list(USER.tenantId);
    const evt = history.find((e) => e.outcome === "UNAUTHORIZED");
    expect(evt).toBeDefined();
    expect(evt!.changedBy).toBe(USER.userId);
  });
});

// ── 6. Secret redaction ───────────────────────────────────────────────────

describe("AIProviderRegistry – secret redaction", () => {
  it("listRegistered() does not expose credentials or API keys", () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", secretKey: "sk-secret-1234" })
    );
    const entries = registry.listRegistered();
    const json = JSON.stringify(entries);
    expect(json).not.toContain("sk-secret-1234");
    expect(json).not.toContain("secret");
  });

  it("getStatusSnapshot() does not expose credentials", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", secretKey: "bearer-token-xyz" })
    );
    const snap = await registry.getStatusSnapshot("prov");
    const json = JSON.stringify(snap);
    expect(json).not.toContain("bearer-token-xyz");
  });

  it("audit events do not contain credential material", async () => {
    const { registry, auditStore } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", secretKey: "api-key-secret" })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov" });
    const history = await auditStore.list(ADMIN.tenantId);
    const json = JSON.stringify(history);
    expect(json).not.toContain("api-key-secret");
  });
});

// ── 7. Status caching (TTL) ───────────────────────────────────────────────

describe("AIProviderRegistry – status caching", () => {
  it("returns cached snapshot within TTL without calling healthCheck again", async () => {
    const { registry } = makeRegistry();
    const provider = new MockAdminProvider({ providerId: "prov" });
    registry.register(provider);

    await registry.getStatusSnapshot("prov");
    const callsBefore = provider.healthCheckCallCount;
    await registry.getStatusSnapshot("prov");
    const callsAfter = provider.healthCheckCallCount;

    expect(callsAfter).toBe(callsBefore); // served from cache
  });

  it("re-fetches snapshot when forceRefresh=true", async () => {
    const { registry } = makeRegistry();
    const provider = new MockAdminProvider({ providerId: "prov" });
    registry.register(provider);

    await registry.getStatusSnapshot("prov");
    const callsBefore = provider.healthCheckCallCount;
    await registry.getStatusSnapshot("prov", { forceRefresh: true });
    const callsAfter = provider.healthCheckCallCount;

    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("re-fetches snapshot after TTL expires", async () => {
    const { registry } = makeRegistry();
    const provider = new MockAdminProvider({ providerId: "prov" });
    registry.register(provider);

    await registry.getStatusSnapshot("prov");
    const callsBefore = provider.healthCheckCallCount;

    // Advance time past TTL
    jest.useFakeTimers();
    jest.advanceTimersByTime(STATUS_CACHE_TTL_MS + 1000);

    await registry.getStatusSnapshot("prov");
    const callsAfter = provider.healthCheckCallCount;
    jest.useRealTimers();

    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it("STATUS_CACHE_TTL_MS is a positive number", () => {
    expect(STATUS_CACHE_TTL_MS).toBeGreaterThan(0);
  });
});

// ── 8. generate() guard – no active provider ─────────────────────────────

describe("AIProviderRegistry – generate() guard", () => {
  it("throws NO_ACTIVE_PROVIDER when generate called with no active provider", async () => {
    const { registry } = makeRegistry();
    registry.register(new MockAdminProvider({ providerId: "prov" }));
    const err = await registry
      .generate({ messages: [{ role: "user", content: "hello" }] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderRegistryError);
    expect((err as AIProviderRegistryError).code).toBe("NO_ACTIVE_PROVIDER");
  });

  it("delegates generate() to active provider when configured", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({
        providerId: "prov",
        generateResponse: { content: "SAP standard covers this", usage: { inputTokens: 10, outputTokens: 5 } },
      })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov" });
    const result = await registry.generate({ messages: [{ role: "user", content: "hello" }] });
    expect(result.content).toBe("SAP standard covers this");
  });

  it("propagates provider generate() error without silently switching providers", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "failing", generateError: "Provider unavailable" })
    );
    registry.register(new MockAdminProvider({ providerId: "fallback" }));
    await registry.setActiveProvider(ADMIN, { providerId: "failing" });

    const err = await registry
      .generate({ messages: [{ role: "user", content: "hello" }] })
      .catch((e) => e);

    // Must NOT silently switch to fallback (Principle 23)
    expect(err).toBeTruthy();
    const activeAfter = registry.listRegistered().find((e) => e.isActive)!;
    expect(activeAfter.providerId).toBe("failing");
  });
});

// ── 9. Malformed provider responses ──────────────────────────────────────

describe("AIProviderRegistry – malformed provider responses", () => {
  it("wraps malformed listModels response gracefully", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", malformedModels: true })
    );
    await registry.setActiveProvider(ADMIN, { providerId: "prov" });
    const models = await registry.listModels("prov").catch((e) => e);
    // Either returns empty array or throws MODEL_LIST_FAILED – must not crash unhandled
    expect(
      Array.isArray(models) || (models instanceof AIProviderRegistryError)
    ).toBe(true);
  });

  it("wraps malformed healthCheck response gracefully", async () => {
    const { registry } = makeRegistry();
    registry.register(
      new MockAdminProvider({ providerId: "prov", malformedHealth: true })
    );
    // Must not throw unhandled exception
    const snap = await registry.getStatusSnapshot("prov");
    expect(snap).toBeDefined();
    expect(snap.available).toBe(false);
  });
});

// ── 10. Multi-tenant audit isolation ─────────────────────────────────────

describe("AIProviderRegistry – multi-tenant audit isolation", () => {
  it("audit events from tenant-1 are not visible to tenant-2", async () => {
    const auditStore = new InMemoryAuditStore();
    const registry1 = new AIProviderRegistry(auditStore);
    const registry2 = new AIProviderRegistry(auditStore);

    registry1.register(new MockAdminProvider({ providerId: "prov" }));
    registry2.register(new MockAdminProvider({ providerId: "prov" }));

    await registry1.setActiveProvider(ADMIN, { providerId: "prov" });
    await registry2.setActiveProvider(TENANT2_ADMIN, { providerId: "prov" });

    const history1 = await auditStore.list(ADMIN.tenantId);
    const history2 = await auditStore.list(TENANT2_ADMIN.tenantId);

    // Each tenant sees only its own events
    expect(history1.every((e) => e.tenantId === ADMIN.tenantId)).toBe(true);
    expect(history2.every((e) => e.tenantId === TENANT2_ADMIN.tenantId)).toBe(true);

    // No cross-contamination
    expect(history1.some((e) => e.tenantId === TENANT2_ADMIN.tenantId)).toBe(false);
    expect(history2.some((e) => e.tenantId === ADMIN.tenantId)).toBe(false);
  });

  it("audit store returns empty array for tenant with no history", async () => {
    const auditStore = new InMemoryAuditStore();
    const history = await auditStore.list("new-tenant-no-events");
    expect(history).toEqual([]);
  });
});
