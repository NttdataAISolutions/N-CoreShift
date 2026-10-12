/**
 * N-CoreShift – VCAP_SERVICES parser utility
 *
 * Parses Cloud Foundry service bindings from VCAP_SERVICES environment variable.
 * All production service credentials MUST be read through this module –
 * never hard-code endpoints or credentials (Principle 19 / mta.yaml contract).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VcapServiceBinding {
  name: string;
  label: string;
  plan: string;
  tags: string[];
  credentials: Record<string, unknown>;
  syslog_drain_url?: string;
  volume_mounts?: unknown[];
}

export type VcapServices = Record<string, VcapServiceBinding[]>;

// ── Known service labels ──────────────────────────────────────────────────────

export const SERVICE_LABEL = {
  XSUAA: 'xsuaa',
  HANA: 'hana',
  DESTINATION: 'destination',
  CONNECTIVITY: 'connectivity',
  OBJECT_STORE: 'objectstore',
  AI_CORE: 'aicore',
  APPLICATION_LOGGING: 'application-logs',
} as const;

// ── Parser ────────────────────────────────────────────────────────────────────

let _parsed: VcapServices | null = null;

/**
 * Parse VCAP_SERVICES from the environment.
 * Caches the result in-process; safe to call repeatedly.
 */
export function parseVcapServices(raw?: string): VcapServices {
  if (_parsed !== null) return _parsed;
  const source = raw ?? process.env.VCAP_SERVICES;
  if (!source) {
    _parsed = {};
    return _parsed;
  }
  try {
    _parsed = JSON.parse(source) as VcapServices;
    return _parsed;
  } catch {
    throw new Error('VCAP_SERVICES is set but cannot be parsed as JSON');
  }
}

/** Reset the cache – used in tests. */
export function resetVcapCache(): void {
  _parsed = null;
}

/**
 * Find the first binding for a given service label.
 * Returns undefined if the service is not bound.
 */
export function findBinding(label: string, instanceName?: string): VcapServiceBinding | undefined {
  const services = parseVcapServices();
  const bindings = services[label] ?? [];
  if (instanceName) {
    return bindings.find((b) => b.name === instanceName);
  }
  return bindings[0];
}

/**
 * Find a binding by label; throws if not found.
 * Use in startup code where absence of a required service is a fatal error.
 */
export function requireBinding(label: string, instanceName?: string): VcapServiceBinding {
  const binding = findBinding(label, instanceName);
  if (!binding) {
    const hint = instanceName ? ` (instance: ${instanceName})` : '';
    throw new Error(
      `Required service binding not found: ${label}${hint}. ` +
        'Ensure the service is bound to this application in the MTA descriptor.',
    );
  }
  return binding;
}

/**
 * Read credentials from the first binding for a label.
 * Returns an empty record if the service is not bound (non-fatal).
 */
export function credentialsFor(label: string, instanceName?: string): Record<string, unknown> {
  return findBinding(label, instanceName)?.credentials ?? {};
}

// ── VCAP_APPLICATION ──────────────────────────────────────────────────────────

export interface VcapApplication {
  application_id: string;
  application_name: string;
  application_uris: string[];
  cf_api: string;
  organization_id: string;
  organization_name: string;
  space_id: string;
  space_name: string;
  limits?: Record<string, unknown>;
}

let _app: VcapApplication | null = null;

export function parseVcapApplication(raw?: string): VcapApplication | null {
  if (_app !== null) return _app;
  const source = raw ?? process.env.VCAP_APPLICATION;
  if (!source) return null;
  try {
    _app = JSON.parse(source) as VcapApplication;
    return _app;
  } catch {
    return null;
  }
}

export function resetVcapAppCache(): void {
  _app = null;
}
