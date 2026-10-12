/**
 * N-CoreShift – VectorStore abstraction (Principle 16)
 *
 * All vector retrieval must go through this interface.
 * Local: in-memory mock; Production: SAP HANA Cloud Vector Engine.
 */

import type {
  VectorDocument,
  VectorSearchResult,
  TenantScope,
} from '../types/index.js';

export interface VectorStore {
  /** Provider identifier, e.g. 'hana-cloud', 'mock' */
  readonly storeId: string;

  /**
   * Upsert one or more documents (tenant-scoped).
   */
  upsert(scope: TenantScope, documents: VectorDocument[]): Promise<void>;

  /**
   * Search by vector similarity within tenant scope.
   */
  search(
    scope: TenantScope,
    queryVector: number[],
    topK?: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]>;

  /**
   * Delete documents by id within tenant scope.
   */
  delete(scope: TenantScope, ids: string[]): Promise<void>;

  /**
   * Delete all documents for a tenant/project scope.
   */
  deleteAll(scope: TenantScope): Promise<void>;
}
