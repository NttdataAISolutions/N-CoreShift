/**
 * N-CoreShift – Centralised environment configuration
 *
 * ALL configuration MUST be read from environment variables or VCAP_SERVICES bindings.
 * Do not hard-code endpoints, credentials, or deployment-specific values anywhere else.
 *
 * Usage:
 *   import { config } from '../config/environment.js';
 *   const url = config.aiCore.apiUrl;
 */

import {
  credentialsFor,
  parseVcapApplication,
  SERVICE_LABEL,
} from './vcap.js';

// ── Runtime environment ───────────────────────────────────────────────────────

export type RuntimeEnv = 'development' | 'test' | 'production';

export function getRuntimeEnv(): RuntimeEnv {
  const e = process.env.NODE_ENV?.toLowerCase();
  if (e === 'production') return 'production';
  if (e === 'test') return 'test';
  return 'development';
}

export function isProduction(): boolean {
  return getRuntimeEnv() === 'production';
}

export function isCloudFoundry(): boolean {
  return Boolean(process.env.VCAP_APPLICATION);
}

// ── Config shape ──────────────────────────────────────────────────────────────

export interface XsuaaConfig {
  clientId: string;
  clientSecret: string;
  url: string;
  xsappname: string;
  verificationKey?: string;
}

export interface HanaConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  databaseName?: string;
  useTls: boolean;
}

export interface AiCoreConfig {
  /** Base URL for AI Core inference API (serviceurls.AI_API_URL) */
  apiUrl: string;
  /** OAuth2 token endpoint from XSUAA binding for AI Core */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Default deployment ID for chat/completion calls */
  deploymentId: string;
  /** Default model alias (e.g. 'gpt-4o', 'gpt-4-turbo') */
  defaultModel: string;
  /** Resource group (default: 'default') */
  resourceGroup: string;
}

export interface ObjectStoreConfig {
  provider: 'aws-s3' | 'azure-blob' | 'gcp-gcs';
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Azure storage account name */
  accountName?: string;
  /** Azure storage SAS token or account key */
  sasToken?: string;
  /** GCS project id */
  projectId?: string;
}

export interface DestinationConfig {
  /** Destination service REST endpoint */
  serviceUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

export interface ConnectivityConfig {
  onpremiseProxyHost?: string;
  onpremiseProxyPort?: number;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

export interface LoggingConfig {
  level: string;
  /** If true, emit structured JSON logs (required for CF app-logs) */
  structured: boolean;
}

export interface ApplicationConfig {
  /** Cloud Foundry application metadata */
  applicationId?: string;
  applicationName?: string;
  spaceId?: string;
  spaceName?: string;
  organizationId?: string;
}

export interface NCoreIQIntegrationConfig {
  /**
   * Base URL of the N-CoreIQ backend. No trailing slash.
   * Set via NCOREIQ_BASE_URL env var.
   * Do NOT hard-code production or local URLs.
   * Do NOT use the AppRouter URL for backend integration.
   *
   * SERVICE_TO_SERVICE_AUTH: DEFERRED UNTIL N-CORESHIFT BTP/XSUAA
   * APPLICATION IDENTITY IS ESTABLISHED.
   */
  baseUrl: string;
  /** 'disabled' (local) | 'xsuaa' (BTP production) */
  authMode: 'disabled' | 'xsuaa';
  /** Request timeout in milliseconds. Default 30 000. */
  timeoutMs: number;
}

export interface NCSEnvironmentConfig {
  runtime: RuntimeEnv;
  isCloudFoundry: boolean;
  application: ApplicationConfig;
  xsuaa: XsuaaConfig | null;
  hana: HanaConfig | null;
  aiCore: AiCoreConfig | null;
  objectStore: ObjectStoreConfig | null;
  destination: DestinationConfig | null;
  connectivity: ConnectivityConfig | null;
  logging: LoggingConfig;
  /** N-CoreIQ connected source provider config. null if NCOREIQ_BASE_URL not set. */
  ncoreiq: NCoreIQIntegrationConfig | null;
}

// ── Builder functions ─────────────────────────────────────────────────────────

function buildXsuaaConfig(): XsuaaConfig | null {
  const creds = credentialsFor(SERVICE_LABEL.XSUAA);
  const clientId = creds.clientid as string | undefined;
  const url = creds.url as string | undefined;
  if (!clientId || !url) {
    // Fall back to explicit env vars (local development with .env)
    const envClientId = process.env.NCS_XSUAA_CLIENT_ID;
    const envUrl = process.env.NCS_XSUAA_URL;
    if (!envClientId || !envUrl) return null;
    return {
      clientId: envClientId,
      clientSecret: process.env.NCS_XSUAA_CLIENT_SECRET ?? '',
      url: envUrl,
      xsappname: process.env.NCS_XSUAA_XSAPPNAME ?? 'ncoreshift',
      verificationKey: process.env.NCS_XSUAA_VERIFICATION_KEY,
    };
  }
  return {
    clientId,
    clientSecret: (creds.clientsecret as string) ?? '',
    url,
    xsappname: (creds.xsappname as string) ?? 'ncoreshift',
    verificationKey: creds.verificationkey as string | undefined,
  };
}

function buildHanaConfig(): HanaConfig | null {
  const creds = credentialsFor(SERVICE_LABEL.HANA);
  const host = creds.host as string | undefined;
  if (!host) return null;
  return {
    host,
    port: Number(creds.port ?? 443),
    user: (creds.user as string) ?? '',
    password: (creds.password as string) ?? '',
    databaseName: creds.db_name as string | undefined,
    useTls: creds.use_tls !== false,
  };
}

function buildAiCoreConfig(): AiCoreConfig | null {
  const creds = credentialsFor(SERVICE_LABEL.AI_CORE);
  const serviceurls = creds.serviceurls as Record<string, string> | undefined;
  const apiUrl =
    (serviceurls?.AI_API_URL as string | undefined) ??
    (process.env.NCS_AICORE_API_URL as string | undefined);
  if (!apiUrl) return null;

  const clientId = (creds.clientid as string) ?? process.env.NCS_AICORE_CLIENT_ID ?? '';
  const clientSecret =
    (creds.clientsecret as string) ?? process.env.NCS_AICORE_CLIENT_SECRET ?? '';
  const tokenUrl =
    (creds.url as string) ?? process.env.NCS_AICORE_TOKEN_URL ?? '';

  return {
    apiUrl,
    tokenUrl,
    clientId,
    clientSecret,
    deploymentId: process.env.NCS_AICORE_DEPLOYMENT_ID ?? 'default',
    defaultModel: process.env.NCS_AICORE_DEFAULT_MODEL ?? 'gpt-4o',
    resourceGroup: process.env.NCS_AICORE_RESOURCE_GROUP ?? 'default',
  };
}

function buildObjectStoreConfig(): ObjectStoreConfig | null {
  const creds = credentialsFor(SERVICE_LABEL.OBJECT_STORE);
  const bucket = (creds.bucket as string) ?? process.env.NCS_OBJECTSTORE_BUCKET;
  if (!bucket) return null;

  // Detect provider from binding or env
  const provider =
    (process.env.NCS_OBJECTSTORE_PROVIDER as ObjectStoreConfig['provider'] | undefined) ??
    (creds.provider as ObjectStoreConfig['provider'] | undefined) ??
    'aws-s3';

  return {
    provider,
    bucket,
    region: (creds.region as string) ?? process.env.NCS_OBJECTSTORE_REGION,
    accessKeyId: (creds.access_key_id as string) ?? process.env.NCS_OBJECTSTORE_ACCESS_KEY_ID,
    secretAccessKey:
      (creds.secret_access_key as string) ?? process.env.NCS_OBJECTSTORE_SECRET_ACCESS_KEY,
    accountName: creds.account_name as string | undefined,
    sasToken: creds.sas_token as string | undefined,
    projectId: creds.project_id as string | undefined,
  };
}

function buildDestinationConfig(): DestinationConfig | null {
  const creds = credentialsFor(SERVICE_LABEL.DESTINATION);
  const serviceUrl = (creds.uri as string) ?? process.env.NCS_DESTINATION_SERVICE_URL;
  if (!serviceUrl) return null;
  return {
    serviceUrl,
    clientId: (creds.clientid as string) ?? process.env.NCS_DESTINATION_CLIENT_ID ?? '',
    clientSecret:
      (creds.clientsecret as string) ?? process.env.NCS_DESTINATION_CLIENT_SECRET ?? '',
    tokenUrl: (creds.url as string) ?? process.env.NCS_DESTINATION_TOKEN_URL ?? '',
  };
}

function buildConnectivityConfig(): ConnectivityConfig | null {
  const creds = credentialsFor(SERVICE_LABEL.CONNECTIVITY);
  const clientId =
    (creds.clientid as string | undefined) ?? process.env.NCS_CONNECTIVITY_CLIENT_ID;
  if (!clientId) return null;
  return {
    onpremiseProxyHost: creds.onpremise_proxy_host as string | undefined,
    onpremiseProxyPort: creds.onpremise_proxy_port
      ? Number(creds.onpremise_proxy_port)
      : undefined,
    clientId,
    clientSecret:
      (creds.clientsecret as string) ?? process.env.NCS_CONNECTIVITY_CLIENT_SECRET ?? '',
    tokenUrl: (creds.url as string) ?? process.env.NCS_CONNECTIVITY_TOKEN_URL ?? '',
  };
}

function buildNCoreIQConfig(): NCoreIQIntegrationConfig | null {
  const baseUrl = process.env.NCOREIQ_BASE_URL?.trim();
  if (!baseUrl) return null;
  const authMode = (process.env.NCOREIQ_AUTH_MODE?.toLowerCase() ?? 'disabled') as
    | 'disabled'
    | 'xsuaa';
  const timeoutMs = process.env.NCOREIQ_TIMEOUT_MS
    ? Number(process.env.NCOREIQ_TIMEOUT_MS)
    : 30_000;
  return { baseUrl, authMode, timeoutMs };
}

function buildLoggingConfig(): LoggingConfig {
  return {
    level: process.env.NCS_LOG_LEVEL ?? (isProduction() ? 'info' : 'debug'),
    structured: isCloudFoundry() || process.env.NCS_LOG_STRUCTURED === 'true',
  };
}

function buildApplicationConfig(): ApplicationConfig {
  const app = parseVcapApplication();
  return {
    applicationId: app?.application_id ?? process.env.CF_INSTANCE_GUID,
    applicationName: app?.application_name ?? process.env.CF_APP_NAME,
    spaceId: app?.space_id,
    spaceName: app?.space_name,
    organizationId: app?.organization_id,
  };
}

// ── Singleton config ──────────────────────────────────────────────────────────

let _config: NCSEnvironmentConfig | null = null;

/**
 * Returns the resolved environment configuration.
 * Cached after first call; call resetConfig() between tests.
 */
export function getConfig(): NCSEnvironmentConfig {
  if (_config) return _config;
  _config = {
    runtime: getRuntimeEnv(),
    isCloudFoundry: isCloudFoundry(),
    application: buildApplicationConfig(),
    xsuaa: buildXsuaaConfig(),
    hana: buildHanaConfig(),
    aiCore: buildAiCoreConfig(),
    objectStore: buildObjectStoreConfig(),
    destination: buildDestinationConfig(),
    connectivity: buildConnectivityConfig(),
    logging: buildLoggingConfig(),
    ncoreiq: buildNCoreIQConfig(),
  };
  return _config;
}

/** Reset config cache – for use in tests only. */
export function resetConfig(): void {
  _config = null;
}

/** Named export for convenience – same as getConfig() */
export const config = new Proxy({} as NCSEnvironmentConfig, {
  get(_target, prop: string | symbol) {
    return getConfig()[prop as keyof NCSEnvironmentConfig];
  },
});
