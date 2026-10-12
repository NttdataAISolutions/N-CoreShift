/**
 * N-CoreShift – Phase 4: File Validator
 *
 * Security-first validation for all uploaded source files.
 * Implements:
 *   - Extension allow-list
 *   - MIME/magic-byte type validation
 *   - Upload-size limits
 *   - Filename sanitisation
 *   - ZIP traversal protection
 *   - Decompression limits
 *   - Duplicate/source-hash detection
 *
 * Uploaded content is ALWAYS treated as untrusted (Principle 17).
 * This module NEVER executes uploaded content.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import type { FileValidationResult } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────

/** Maximum size for a single non-ZIP file: 10 MB */
export const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum size for a ZIP archive: 100 MB */
export const MAX_ZIP_FILE_BYTES = 100 * 1024 * 1024;

/** Maximum uncompressed size of all files extracted from a ZIP: 500 MB */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

/** Maximum number of files extractable from a single ZIP */
export const MAX_ZIP_ENTRY_COUNT = 5_000;

/** Compression ratio limit – prevents decompression bombs */
export const MAX_COMPRESSION_RATIO = 100;

/**
 * Allowed file extensions for SAP source uploads.
 * Only these extensions will be accepted.
 */
export const ALLOWED_EXTENSIONS = new Set([
  ".abap",
  ".txt",
  ".xml",
  ".json",
  ".csv",
  ".zip",
  ".asddls", // ABAP CDS
  ".asdddls", // ABAP Dictionary
  ".ddls", // CDS DDL
  ".ddlx", // CDS DCL
  ".bdef", // Behavior definition
  ".clas.abap",
  ".prog.abap",
  ".intf.abap",
  ".fugr.abap",
  ".doma.abap",
  ".dtel.abap",
  ".tabl.abap",
  ".ttyp.abap",
  ".msag.abap",
  ".shlp.abap",
  ".enhc.abap",
  ".enhs.abap",
  ".enhf.abap",
]);

/**
 * Extensions that should be text-decoded as UTF-8.
 * All entries in ALLOWED_EXTENSIONS that are not .zip are text.
 */
export const TEXT_EXTENSIONS = new Set([...ALLOWED_EXTENSIONS].filter((e) => e !== ".zip"));

// ZIP magic bytes: PK\x03\x04
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// ── Path sanitisation ─────────────────────────────────────────────────────

/**
 * Sanitises a file path extracted from a ZIP to prevent path traversal.
 *
 * Rules:
 * 1. Resolve against a virtual root.
 * 2. Reject if the resolved path escapes the virtual root.
 * 3. Strip leading slashes and drive letters.
 * 4. Normalise separators.
 *
 * @throws {Error} If the path is an attempted traversal.
 */
export function sanitisePath(rawPath: string): string {
  // Normalise separators
  const normalised = rawPath.replace(/\\/g, "/");

  // Reject null bytes
  if (normalised.includes("\0")) {
    throw new Error(`Path contains null byte: ${JSON.stringify(rawPath)}`);
  }

  // Resolve against a virtual root
  const virtualRoot = "/safe_root";
  const resolved = path.posix.resolve(virtualRoot, normalised);

  // Must stay inside the virtual root
  if (!resolved.startsWith(virtualRoot + "/") && resolved !== virtualRoot) {
    throw new Error(`Path traversal attempt detected: ${JSON.stringify(rawPath)}`);
  }

  // Return the relative portion, stripped of leading slash
  return resolved.slice(virtualRoot.length + 1);
}

/**
 * Returns true if a filename (not its containing path) looks suspicious.
 * Blocks names with null bytes, control characters, or only dots.
 */
export function isSuspiciousFilename(name: string): boolean {
  if (!name || name.trim() === "") return true;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) return true; // control characters
  if (/^\.+$/.test(name)) return true; // only dots
  return false;
}

// ── Hash helpers ──────────────────────────────────────────────────────────

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ── Extension helpers ─────────────────────────────────────────────────────

/**
 * Returns the lowercased extension of a filename.
 * For compound extensions like .clas.abap it returns .clas.abap.
 */
export function getExtension(filename: string): string {
  const base = path.basename(filename).toLowerCase();

  // Check compound extensions first (longest match wins)
  const compoundExts = [
    ".clas.abap",
    ".prog.abap",
    ".intf.abap",
    ".fugr.abap",
    ".doma.abap",
    ".dtel.abap",
    ".tabl.abap",
    ".ttyp.abap",
    ".msag.abap",
    ".shlp.abap",
    ".enhc.abap",
    ".enhs.abap",
    ".enhf.abap",
  ];
  for (const ext of compoundExts) {
    if (base.endsWith(ext)) return ext;
  }
  return path.extname(base);
}

export function isAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(getExtension(filename));
}

export function isZipByMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return buf.slice(0, 4).equals(ZIP_MAGIC);
}

// ── File Validator ────────────────────────────────────────────────────────

/**
 * Validate a single uploaded file buffer.
 *
 * Does NOT read ZIP contents – that is the responsibility of
 * FileUploadSourceProvider which performs ZIP traversal protection.
 */
export function validateFile(
  originalName: string,
  buf: Buffer,
  options: {
    /** Allow ZIP files (default true) */
    allowZip?: boolean;
  } = {},
): FileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { allowZip = true } = options;

  const detectedExtension = getExtension(originalName);
  const sizeBytes = buf.length;
  const contentHash = sha256(buf);
  const isZip = isZipByMagic(buf) || detectedExtension === ".zip";

  // Filename sanity
  const basename = path.basename(originalName);
  if (isSuspiciousFilename(basename)) {
    errors.push(`Suspicious filename: ${JSON.stringify(basename)}`);
  }

  // Extension check
  if (!isAllowedExtension(originalName)) {
    errors.push(
      `File extension "${detectedExtension}" is not on the allowed list. ` +
        `Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    );
  }

  // ZIP handling
  if (isZip) {
    if (!allowZip) {
      errors.push("ZIP files are not allowed in this context.");
    } else {
      // Size limit for ZIP
      if (sizeBytes > MAX_ZIP_FILE_BYTES) {
        errors.push(
          `ZIP file size ${sizeBytes} bytes exceeds maximum of ${MAX_ZIP_FILE_BYTES} bytes.`,
        );
      }
    }

    // Magic-byte / extension mismatch warning
    const hasMagic = isZipByMagic(buf);
    const hasExt = detectedExtension === ".zip";
    if (hasMagic && !hasExt) {
      errors.push(
        "File has ZIP magic bytes but extension is not .zip – possible disguised archive (security policy violation).",
      );
    }
    if (!hasMagic && hasExt && buf.length >= 4) {
      warnings.push("File has .zip extension but does not start with ZIP magic bytes.");
    }
  } else {
    // Non-ZIP size limit
    if (sizeBytes > MAX_SINGLE_FILE_BYTES) {
      errors.push(
        `File size ${sizeBytes} bytes exceeds maximum of ${MAX_SINGLE_FILE_BYTES} bytes.`,
      );
    }
    // Empty file error
    if (sizeBytes === 0) {
      errors.push("File is empty (0 bytes).");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    detectedExtension,
    sizeBytes,
    contentHash,
    isZip,
  };
}

// ── Duplicate detection ───────────────────────────────────────────────────

/**
 * Checks whether a bundle hash already exists in the provided set.
 * The caller is responsible for maintaining the known-hashes registry.
 */
export function isDuplicateBundle(bundleHash: string, knownHashes: Set<string>): boolean {
  return knownHashes.has(bundleHash);
}

// ── FileValidator class ───────────────────────────────────────────────────

/**
 * Object-oriented wrapper around the standalone `validateFile` function.
 *
 * Usage:
 *   const validator = new FileValidator();
 *   const result = validator.validate(buf, "z_report.abap");
 */
export class FileValidator {
  /**
   * Validate a file buffer.
   *
   * @param buf - The raw file bytes.
   * @param filename - Original filename (used for extension and name checks).
   * @param options - Optional overrides (e.g. allowZip).
   */
  validate(
    buf: Buffer,
    filename: string,
    options: { allowZip?: boolean } = {},
  ): FileValidationResult {
    return validateFile(filename, buf, options);
  }
}

// ── Text decoding ─────────────────────────────────────────────────────────

/**
 * Decodes a buffer as UTF-8, replacing invalid sequences.
 * Binary content is NEVER stored as text.
 * Returns null if the buffer appears to be non-text binary.
 */
export function decodeAsText(buf: Buffer): string | null {
  // Heuristic: if >10% of first 512 bytes are non-printable, treat as binary
  const probe = buf.slice(0, Math.min(512, buf.length));
  let nonPrintable = 0;
  for (let i = 0; i < probe.length; i++) {
    const b = probe[i];
    // Allow tab (9), newline (10), carriage return (13), and printable ASCII 32-126
    if (b !== 9 && b !== 10 && b !== 13 && (b < 32 || b > 126)) {
      nonPrintable++;
    }
  }
  if (probe.length > 0 && nonPrintable / probe.length > 0.1) {
    return null; // looks binary
  }
  return buf.toString("utf8");
}
