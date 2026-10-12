/**
 * N-CoreShift – CodeSourceProvider abstraction (Principle 14)
 *
 * All source ingestion must go through this interface.
 * V1 implementation: FileUploadSourceProvider.
 * Future: AbapGitSourceProvider, SAPSystemSourceProvider.
 */

import type { TenantScope, SourceAccessMode } from '../types/index.js';

export interface SourceFile {
  /** Original filename from the upload */
  name: string;
  /** Relative path within a bundle (e.g. ZIP), or filename for single files */
  relativePath: string;
  /** Raw text content – must be decoded from uploaded bytes */
  content: string;
  /** File extension (lower-case, no dot), e.g. 'abap', 'xml', 'txt' */
  extension: string;
  /** Byte size of the original file */
  sizeBytes: number;
  /** SHA-256 hex digest of content for deduplication */
  contentHash: string;
}

export interface SourceBundle {
  /** Unique source bundle id */
  id: string;
  tenantId: string;
  projectId: string;
  /** Human-provided label */
  label: string;
  accessMode: SourceAccessMode;
  files: SourceFile[];
  ingestedAt: string;
  /** Total size of all files in bytes */
  totalSizeBytes: number;
}

export interface SourceIngestionRequest {
  scope: TenantScope;
  label: string;
  /** Raw bytes of the uploaded file or ZIP bundle */
  data: Uint8Array;
  originalName: string;
  mimeType: string;
}

export interface SourceIngestionResult {
  bundleId: string;
  filesAccepted: number;
  filesRejected: number;
  rejectedFiles: Array<{ name: string; reason: string }>;
  warnings: string[];
}

export interface CodeSourceProvider {
  readonly providerId: string;
  readonly accessMode: SourceAccessMode;

  /**
   * Ingest a source bundle and return a parsed SourceBundle.
   * Must validate extensions, size limits, and ZIP safety.
   * Must NOT execute any uploaded code.
   */
  ingest(request: SourceIngestionRequest): Promise<SourceBundle>;

  /** Retrieve a previously ingested bundle. */
  getBundle(scope: TenantScope, bundleId: string): Promise<SourceBundle | null>;

  /** List all bundles for a project. */
  listBundles(scope: TenantScope): Promise<SourceBundle[]>;

  /** Delete a bundle and its files. */
  deleteBundle(scope: TenantScope, bundleId: string): Promise<void>;
}
