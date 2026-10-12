/**
 * N-CoreShift – FileStorageProvider abstraction
 *
 * Abstracts object/file storage so local and BTP (Object Store) implementations
 * are interchangeable. Do not persist customer source code on ephemeral local disk
 * in production (Principle 19).
 */

import type { TenantScope, StoredFile, FileUploadRequest } from '../types/index.js';

export interface FileStorageProvider {
  readonly providerId: string;

  /** Store a file and return its metadata record. */
  store(request: FileUploadRequest): Promise<StoredFile>;

  /** Retrieve file content as bytes. */
  retrieve(scope: TenantScope, fileId: string): Promise<Uint8Array>;

  /** Get metadata only (no content). */
  getMeta(scope: TenantScope, fileId: string): Promise<StoredFile | null>;

  /** List all files for a project. */
  list(scope: TenantScope): Promise<StoredFile[]>;

  /** Delete a file. */
  delete(scope: TenantScope, fileId: string): Promise<void>;
}
