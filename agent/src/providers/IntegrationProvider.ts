/**
 * N-CoreShift – IntegrationProvider abstraction
 *
 * Abstracts external-system connectivity (SAP system calls, BTP Destination Service,
 * Connectivity Service, Cloud Connector). Do not hard-code endpoints or credentials.
 */

export interface DestinationConfig {
  name: string;
  url: string;
  /** Authentication type, e.g. 'NoAuthentication', 'BasicAuthentication', 'OAuth2' */
  authenticationType: string;
  additionalProperties?: Record<string, string>;
}

export interface IntegrationRequest {
  destinationName: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface IntegrationResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface IntegrationProvider {
  readonly providerId: string;

  /** Resolve a named destination configuration. */
  resolveDestination(name: string): Promise<DestinationConfig | null>;

  /** Execute an HTTP call through the connectivity layer. */
  call(request: IntegrationRequest): Promise<IntegrationResponse>;

  /** Check connectivity to a destination without performing a business operation. */
  ping(destinationName: string): Promise<{ reachable: boolean; latencyMs?: number }>;
}
