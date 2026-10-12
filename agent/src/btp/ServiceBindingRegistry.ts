/**
 * N-CoreShift – BTP Service Binding Registry
 *
 * Single entry point that reads VCAP_SERVICES / environment config and
 * constructs every BTP adapter.  Application code should import from here
 * rather than constructing adapters directly.
 *
 * Usage (server startup):
 *
 *   const registry = ServiceBindingRegistry.fromEnvironment();
 *   registry.assertAllBound();           // fail fast on bad config
 *   const aiProvider = registry.aiCore;
 *
 * The registry is intentionally NOT a singleton so tests can create
 * isolated instances with injected config.
 */

import { AiCoreProvider } from './AiCoreProvider.js';
import { ObjectStoreProvider } from './ObjectStoreProvider.js';
import { DestinationServiceProvider } from './DestinationServiceProvider.js';
import type {
  AiCoreAdapterConfig,
  ObjectStoreAdapterConfig,
  DestinationServiceAdapterConfig,
  BTPServiceInfo,
  ServiceBindingRegistryStatus,
} from './types.js';

// ── Environment helpers ───────────────────────────────────────────────────────

function env(key: string): string {
  return process.env[key] ?? '';
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

// ── Config builders ───────────────────────────────────────────────────────────

function buildAiCoreConfig(): AiCoreAdapterConfig {
  return {
    apiUrl: env('AICORE_API_URL'),
    tokenUrl: env('AICORE_TOKEN_URL'),
    clientId: env('AICORE_CLIENT_ID'),
    clientSecret: env('AICORE_CLIENT_SECRET'),
    deploymentId: env('AICORE_DEPLOYMENT_ID'),
    defaultModel: env('AICORE_DEFAULT_MODEL') || 'gpt-4o',
    resourceGroup: env('AICORE_RESOURCE_GROUP') || 'default',
    timeoutMs: envInt('AICORE_TIMEOUT_MS', 120_000),
    maxRetries: envInt('AICORE_MAX_RETRIES', 3),
  };
}

function buildObjectStoreConfig(): ObjectStoreAdapterConfig {
  const provider = (env('OBJECTSTORE_PROVIDER') || 'aws-s3') as
    | 'aws-s3'
    | 'azure-blob'
    | 'gcp-gcs';

  return {
    provider,
    bucket: env('OBJECTSTORE_BUCKET'),
    region: env('OBJECTSTORE_REGION') || undefined,
    accessKeyId: env('OBJECTSTORE_ACCESS_KEY_ID') || undefined,
    secretAccessKey: env('OBJECTSTORE_SECRET_ACCESS_KEY') || undefined,
    accountName: env('OBJECTSTORE_ACCOUNT_NAME') || undefined,
    sasToken: env('OBJECTSTORE_SAS_TOKEN') || undefined,
    projectId: env('OBJECTSTORE_GCP_PROJECT_ID') || undefined,
    keyPrefix: env('OBJECTSTORE_KEY_PREFIX') || 'ncoreshift/',
  };
}

function buildDestinationConfig(): DestinationServiceAdapterConfig {
  return {
    serviceUrl: env('DESTINATION_SERVICE_URL'),
    clientId: env('DESTINATION_CLIENT_ID'),
    clientSecret: env('DESTINATION_CLIENT_SECRET'),
    tokenUrl: env('DESTINATION_TOKEN_URL'),
    cacheTtlMs: envInt('DESTINATION_CACHE_TTL_MS', 300_000),
  };
}

// ── ServiceBindingRegistry ────────────────────────────────────────────────────

export class ServiceBindingRegistry {
  readonly aiCore: AiCoreProvider;
  readonly objectStore: ObjectStoreProvider;
  readonly destination: DestinationServiceProvider;

  constructor(
    aiCoreConfig: AiCoreAdapterConfig,
    objectStoreConfig: ObjectStoreAdapterConfig,
    destinationConfig: DestinationServiceAdapterConfig,
  ) {
    this.aiCore = new AiCoreProvider(aiCoreConfig);
    this.objectStore = new ObjectStoreProvider(objectStoreConfig);
    this.destination = new DestinationServiceProvider(destinationConfig);
  }

  /**
   * Create a registry populated from process environment variables.
   * Call this once at server startup.
   */
  static fromEnvironment(): ServiceBindingRegistry {
    return new ServiceBindingRegistry(
      buildAiCoreConfig(),
      buildObjectStoreConfig(),
      buildDestinationConfig(),
    );
  }

  /**
   * Returns a status snapshot of every BTP service binding.
   * Does NOT make network calls – uses isConfigured() only.
   */
  status(): ServiceBindingRegistryStatus {
    const aiCoreOk = this.aiCore.isConfigured();

    const objectStoreOk = !!(
      this.objectStore.providerId &&
      process.env['OBJECTSTORE_BUCKET']
    );

    const destOk = !!(
      process.env['DESTINATION_SERVICE_URL'] &&
      process.env['DESTINATION_CLIENT_ID'] &&
      process.env['DESTINATION_CLIENT_SECRET'] &&
      process.env['DESTINATION_TOKEN_URL']
    );

    // HANA binding is optional in phase 12 – report as unbound if not configured
    const hanaOk = !!(
      process.env['HANA_HOST'] &&
      process.env['HANA_USER'] &&
      process.env['HANA_PASSWORD']
    );

    const info = (ok: boolean, name: string): BTPServiceInfo => ({
      name,
      status: ok ? 'bound' : 'unbound',
    });

    return {
      aiCore: info(aiCoreOk, 'SAP AI Core'),
      objectStore: info(objectStoreOk, 'SAP BTP Object Store'),
      destination: info(destOk, 'SAP BTP Destination Service'),
      hana: info(hanaOk, 'SAP HANA Cloud'),
    };
  }

  /**
   * Throws if any mandatory BTP service binding is missing.
   * Call during server startup to fail fast rather than at request time.
   *
   * @param required  Services that must be bound (default: all except hana)
   */
  assertAllBound(
    required: (keyof Omit<ServiceBindingRegistryStatus, 'hana'>)[] = [
      'aiCore',
      'objectStore',
      'destination',
    ],
  ): void {
    const s = this.status();
    const missing = required.filter((key) => s[key].status !== 'bound');
    if (missing.length > 0) {
      const names = missing.map((k) => s[k].name).join(', ');
      throw new Error(
        `[ServiceBindingRegistry] Required BTP services are not configured: ${names}. ` +
          'Check environment variables or VCAP_SERVICES binding.',
      );
    }
  }

  /**
   * Run a lightweight health check against every bound service.
   * Returns a map of service → health status string.
   */
  async healthCheck(): Promise<Record<string, { ok: boolean; detail: string }>> {
    const results: Record<string, { ok: boolean; detail: string }> = {};

    // AI Core
    try {
      const h = await this.aiCore.healthCheck();
      results['aiCore'] = { ok: h.available, detail: h.errorMessage ?? 'OK' };
    } catch (err) {
      results['aiCore'] = { ok: false, detail: String(err) };
    }

    // Object Store – no live health check available; report configuration status
    const s = this.status();
    results['objectStore'] = {
      ok: s.objectStore.status === 'bound',
      detail: s.objectStore.status === 'bound' ? 'configured' : 'not configured',
    };

    // Destination Service – attempt to list destinations
    try {
      await this.destination.listNames();
      results['destination'] = { ok: true, detail: 'OK' };
    } catch (err) {
      results['destination'] = { ok: false, detail: String(err) };
    }

    return results;
  }
}
