/**
 * N-CoreShift – Phase 4: FileUploadSourceProvider
 *
 * V1 implementation of CodeSourceProviderContract for direct file uploads.
 * Supports: .abap, .txt, .xml, .json, .csv, .zip (and ABAP compound exts).
 *
 * Security guarantees:
 *  - Never executes uploaded content.
 *  - ZIP traversal protection via sanitisePath().
 *  - Decompression bomb protection via entry count + uncompressed size limits.
 *  - Duplicate bundle detection via SHA-256.
 *  - Filename sanitisation.
 *  - Extension allow-list enforced for every extracted file.
 *
 * All source content is treated as untrusted data (Principle 17).
 */

import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import {
  decodeAsText,
  getExtension,
  isAllowedExtension,
  isZipByMagic,
  MAX_ZIP_ENTRY_COUNT,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  sanitisePath,
  sha256,
  sha256Text,
  validateFile,
} from "./FileValidator.js";
import type {
  CodeSourceProviderContract,
  IngestedSource,
  InMemorySourceFile,
  IngestionJobInput,
} from "./types.js";

// ── FileUploadSourceProvider ──────────────────────────────────────────────

export class FileUploadSourceProvider implements CodeSourceProviderContract {
  providerName(): string {
    return "FileUploadSourceProvider";
  }

  supportedExtensions(): string[] {
    return [
      ".abap",
      ".txt",
      ".xml",
      ".json",
      ".csv",
      ".zip",
      ".asddls",
      ".ddls",
      ".ddlx",
      ".bdef",
      ".clas.abap",
      ".prog.abap",
      ".intf.abap",
    ];
  }

  async ingest(input: IngestionJobInput): Promise<IngestedSource> {
    const { fileName, buffer } = input;
    const codeSourceId = randomUUID();
    const bundleHash = sha256(buffer);

    // Top-level file validation
    const topValidation = validateFile(fileName, buffer);
    if (!topValidation.valid) {
      throw new IngestionValidationError(
        `Upload rejected for "${fileName}": ${topValidation.errors.join("; ")}`,
        topValidation.errors,
      );
    }

    let files: InMemorySourceFile[];

    if (topValidation.isZip || isZipByMagic(buffer)) {
      files = this._extractZip(buffer, fileName);
    } else {
      const singleFile = this._extractSingleFile(fileName, buffer);
      if (!singleFile) {
        throw new IngestionValidationError(
          `File "${fileName}" could not be decoded as text. Binary files are not supported.`,
          ["Non-text content detected"],
        );
      }
      files = [singleFile];
    }

    const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

    return {
      codeSourceId,
      files,
      validationSummary: topValidation,
      totalFiles: files.length,
      totalSizeBytes,
      bundleHash,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _extractSingleFile(
    fileName: string,
    buffer: Buffer,
  ): InMemorySourceFile | null {
    const textContent = decodeAsText(buffer);
    if (textContent === null) return null;

    const ext = getExtension(fileName);
    const contentHash = sha256Text(textContent);

    return {
      filePath: fileName,
      originalName: fileName,
      extension: ext,
      textContent,
      sizeBytes: buffer.length,
      contentHash,
      encoding: "utf-8",
    };
  }

  private _extractZip(buffer: Buffer, zipName: string): InMemorySourceFile[] {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch (err) {
      throw new IngestionValidationError(
        `Could not open ZIP archive "${zipName}": ${String(err)}`,
        ["Corrupt or invalid ZIP"],
      );
    }

    const entries = zip.getEntries();

    // Entry count limit
    if (entries.length > MAX_ZIP_ENTRY_COUNT) {
      throw new IngestionValidationError(
        `ZIP contains ${entries.length} entries, exceeding limit of ${MAX_ZIP_ENTRY_COUNT}.`,
        [`Entry count ${entries.length} > ${MAX_ZIP_ENTRY_COUNT}`],
      );
    }

    const files: InMemorySourceFile[] = [];
    let totalUncompressed = 0;
    const rejectedFiles: Array<{ path: string; reason: string }> = [];

    for (const entry of entries) {
      // Skip directory entries
      if (entry.isDirectory) continue;

      const rawEntryPath = entry.entryName;

      // Path traversal protection
      let safePath: string;
      try {
        safePath = sanitisePath(rawEntryPath);
      } catch {
        rejectedFiles.push({ path: rawEntryPath, reason: "Path traversal attempt" });
        continue;
      }

      // Extension check
      if (!isAllowedExtension(safePath)) {
        rejectedFiles.push({
          path: safePath,
          reason: `Extension "${getExtension(safePath)}" not in allow-list`,
        });
        continue;
      }

      // Per-entry uncompressed size check
      const entryUncompressedSize = entry.header.size;
      totalUncompressed += entryUncompressedSize;

      if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new IngestionValidationError(
          `ZIP total uncompressed size exceeded ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes. Possible decompression bomb.`,
          ["Uncompressed size limit exceeded"],
        );
      }

      // Decompression ratio check
      const compressedSize = entry.header.compressedSize ?? entryUncompressedSize;
      if (compressedSize > 0 && entryUncompressedSize / compressedSize > 100) {
        rejectedFiles.push({
          path: safePath,
          reason: `Compression ratio exceeds limit (${Math.round(entryUncompressedSize / compressedSize)}:1)`,
        });
        continue;
      }

      // Decompress entry
      let entryBuffer: Buffer;
      try {
        entryBuffer = entry.getData();
      } catch {
        rejectedFiles.push({ path: safePath, reason: "Failed to decompress entry" });
        continue;
      }

      // Text decode
      const textContent = decodeAsText(entryBuffer);
      if (textContent === null) {
        rejectedFiles.push({ path: safePath, reason: "Binary content (not text)" });
        continue;
      }

      const ext = getExtension(safePath);
      const contentHash = sha256Text(textContent);

      files.push({
        filePath: safePath,
        originalName: rawEntryPath,
        extension: ext,
        textContent,
        sizeBytes: entryBuffer.length,
        contentHash,
        encoding: "utf-8",
      });
    }

    if (files.length === 0 && rejectedFiles.length > 0) {
      throw new IngestionValidationError(
        `ZIP "${zipName}" contained no accepted files. All ${rejectedFiles.length} entries were rejected.`,
        rejectedFiles.map((r) => `${r.path}: ${r.reason}`),
      );
    }

    return files;
  }
}

// ── Error type ────────────────────────────────────────────────────────────

export class IngestionValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: string[],
  ) {
    super(message);
    this.name = "IngestionValidationError";
  }
}
