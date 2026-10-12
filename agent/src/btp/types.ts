/**
 * N-CoreShift – BTP Service Adapter Types
 *
 * Defines the configuration contracts passed to each BTP adapter.
 * All values come from srv/src/config/environment.ts at runtime –
 * never hard-code credentials here.
 */

// ── AI Core ───────────────────────────────────────────────────────────────────

export interface AiCoreAdapterConfig {
  /** Base URL: serviceurls.AI_API_URL from the aicore binding */
  apiUrl: string;
  /** OAuth2 token URL from the aicore XSUAA binding */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** AI Core deployment ID (matches a deployed model in the resource group) */
  deploymentId: string;
  /** Human-readable model alias passed in prompts / audit records */
  defaultModel: string;
  /** AI Core resource group (default: 'default') */
  resourceGroup: string;
  /** Request timeout in ms (default: 120 000) */
  timeoutMs?: number;
  /** Max retries on transient errors (default: 3) */
  maxRetries?: number;
}

// ── Object Store ──────────────────────────────────────────────────────────────

export interface ObjectStoreAdapterConfig {
  provider: 'aws-s3' | 'azure-blob' | 'gcp-gcs';
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  accountName?: string;
  sasToken?: string;
  projectId?: string;
  /** Path prefix applied to all stored objects (default: 'ncoreshift/') */
  keyPrefix?: string;
}

// ── Destination Service ───────────────────────────────────────────────────────

export interface DestinationServiceAdapterConfig {
  /** Destination service REST endpoint */
  serviceUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  /** Cache TTL for destination lookups in ms (default: 300 000 = 5 min) */
  cacheTtlMs?: number;
}

export interface ResolvedDestination {
  name: string;
  url: string;
  /** Authentication type: NoAuthentication | BasicAuthentication | OAuth2ClientCredentials | SAMLAssertion */
  authenticationType: string;
  /** Resolved Authorization header value if applicable */
  authorizationHeader?: string;
  /** Additional destination properties */
  properties: Record<string, string>;
}

// ── HANA Vector Store ─────────────────────────────────────────────────────────

export interface HanaVectorAdapterConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  schema?: string;
  /** Table name for vector embeddings (default: 'NCS_VECTOR_STORE') */
  tableName?: string;
  /** Embedding dimensions (default: 1536 for text-embedding-ada-002) */
  dimensions?: number;
  useTls?: boolean;
}

// ── Service Binding Registry ──────────────────────────────────────────────────

export type BTPServiceStatus = 'bound' | 'unbound' | 'error';

export interface BTPServiceInfo {
  name: string;
  status: BTPServiceStatus;
  error?: string;
}

export interface ServiceBindingRegistryStatus {
  aiCore: BTPServiceInfo;
  objectStore: BTPServiceInfo;
  destination: BTPServiceInfo;
  hana: BTPServiceInfo;
}
