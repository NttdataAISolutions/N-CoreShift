/**
 * N-CoreShift – KnowledgeProvider abstraction (Principle 15)
 *
 * All SAP knowledge retrieval (SAP standard capabilities, BAdIs, APIs,
 * released objects, scope items) must go through this interface.
 */

import type { TenantScope, KnowledgeSearchQuery, KnowledgeSearchResult } from '../types/index.js';

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  sourceType: 'SAP_HELP' | 'SAP_NOTE' | 'INTERNAL_CATALOG' | 'UPLOADED';
  edition?: string;
  release?: string;
  tags?: string[];
  url?: string;
}

export interface KnowledgeProvider {
  readonly providerId: string;

  /** Retrieve SAP knowledge relevant to a search query. */
  search(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult>;

  /** Ingest a knowledge document into the store (tenant-scoped). */
  ingest(scope: TenantScope, document: KnowledgeDocument): Promise<void>;

  /** Delete knowledge documents by id. */
  delete(scope: TenantScope, ids: string[]): Promise<void>;
}
