/**
 * N-CoreShift Phase 4 – Source Ingestion Tests
 * No filesystem I/O. No LLM calls.
 */

import { describe, it, expect } from "@jest/globals";
import AdmZip from "adm-zip";

import { FileValidator } from "../source/FileValidator.js";
import { FileUploadSourceProvider } from "../source/FileUploadSourceProvider.js";
import {
  ModernizationAnalysisService,
  deriveCustomObjects,
} from "../source/ModernizationAnalysisService.js";
import type {
  AnalysisRepository,
  CodeSourceRecord,
  CustomObjectRecord,
  ModernizationAnalysis,
  SourceFileRecord,
} from "../source/types.js";

// ── helpers ────────────────────────────────────────────────────────────────

function abapBuf(src = "REPORT z_test.\nWRITE: 'hello'."): Buffer {
  return Buffer.from(src, "utf-8");
}

function makeZip(entries: Array<{ name: string; content: string }>): Buffer {
  const z = new AdmZip();
  for (const e of entries) z.addFile(e.name, Buffer.from(e.content, "utf-8"));
  return z.toBuffer();
}

function makeRepo(overrides: Partial<AnalysisRepository> = {}): AnalysisRepository {
  const analyses = new Map<string, ModernizationAnalysis>();
  const sources = new Map<string, CodeSourceRecord>();
  const objects: CustomObjectRecord[] = [];

  return {
    saveAnalysis: async (a) => {
      analyses.set(`${a.tenantId}:${a.projectId}:${a.id}`, a);
      return a;
    },
    findAnalysis: async (tenantId, projectId, id) =>
      analyses.get(`${tenantId}:${projectId}:${id}`) ?? null,
    listAnalyses: async (tenantId, projectId) =>
      [...analyses.values()].filter(
        (a) => a.tenantId === tenantId && a.projectId === projectId,
      ),
    incrementAnalysisCounters: async () => {},
    saveCodeSource: async (r) => {
      sources.set(`${r.tenantId}:${r.projectId}:${r.bundleHash}`, r);
      return r;
    },
    findCodeSourceByHash: async (tenantId, projectId, hash) =>
      sources.get(`${tenantId}:${projectId}:${hash}`) ?? null,
    saveSourceFiles: async (_r: SourceFileRecord[]) => {},
    saveCustomObjects: async (recs: CustomObjectRecord[]) => {
      objects.push(...recs);
    },
    listCustomObjects: async (tenantId, projectId, analysisId) =>
      objects.filter(
        (o) =>
          o.tenantId === tenantId &&
          o.projectId === projectId &&
          o.analysisId === analysisId,
      ),
    ...overrides,
  };
}

// ── FileValidator ──────────────────────────────────────────────────────────

describe("FileValidator", () => {
  const v = new FileValidator();

  it("accepts a valid .abap file", () => {
    const buf = abapBuf();
    const r = v.validate(buf, "z_report.abap");
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.detectedExtension).toBe(".abap");
    expect(r.sizeBytes).toBe(buf.length);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.isZip).toBe(false);
  });

  it("accepts a valid ZIP", () => {
    const buf = makeZip([{ name: "z_test.abap", content: "REPORT z_test." }]);
    const r = v.validate(buf, "package.zip");
    expect(r.valid).toBe(true);
    expect(r.isZip).toBe(true);
  });

  it("rejects an oversized file", () => {
    const big = Buffer.alloc(51 * 1024 * 1024, 0x41);
    const r = v.validate(big, "huge.abap");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: string) => e.toLowerCase().includes("size"))).toBe(true);
  });

  it("rejects a disallowed extension", () => {
    const r = v.validate(Buffer.from("evil", "utf-8"), "evil.exe");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: string) => e.toLowerCase().includes("extension"))).toBe(true);
  });

  it("rejects an empty file", () => {
    const r = v.validate(Buffer.alloc(0), "empty.abap");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: string) => e.toLowerCase().includes("empty"))).toBe(true);
  });

  it("returns a warnings array on valid xml", () => {
    const r = v.validate(Buffer.from("<root/>", "utf-8"), "config.xml");
    expect(r.valid).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  it("accepts .csv", () => {
    const r = v.validate(Buffer.from("col1,col2\nval1,val2", "utf-8"), "data.csv");
    expect(r.valid).toBe(true);
    expect(r.detectedExtension).toBe(".csv");
  });

  it("accepts .json", () => {
    const r = v.validate(Buffer.from('{"key":"value"}', "utf-8"), "manifest.json");
    expect(r.valid).toBe(true);
    expect(r.detectedExtension).toBe(".json");
  });

  it("accepts .txt", () => {
    const r = v.validate(Buffer.from("Some text", "utf-8"), "notes.txt");
    expect(r.valid).toBe(true);
    expect(r.detectedExtension).toBe(".txt");
  });

  it("produces a stable SHA-256 hash for identical content", () => {
    const buf = Buffer.from("REPORT z_stable.", "utf-8");
    const r1 = v.validate(buf, "z_stable.abap");
    const r2 = v.validate(buf, "z_stable.abap");
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it("produces different hashes for different content", () => {
    const r1 = v.validate(Buffer.from("REPORT z_a.", "utf-8"), "z_a.abap");
    const r2 = v.validate(Buffer.from("REPORT z_b.", "utf-8"), "z_b.abap");
    expect(r1.contentHash).not.toBe(r2.contentHash);
  });
});

// ── FileUploadSourceProvider ───────────────────────────────────────────────

describe("FileUploadSourceProvider", () => {
  const provider = new FileUploadSourceProvider();
  const base = {
    tenantId: "T1",
    projectId: "P1",
    analysisId: "A1",
    uploadedBy: "consultant@example.com",
  };

  it("ingests a single .abap file", async () => {
    const buf = abapBuf();
    const r = await provider.ingest({ ...base, fileName: "z_report.abap", buffer: buf });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].extension).toBe(".abap");
    expect(r.files[0].filePath).toBe("z_report.abap");
    expect(r.totalFiles).toBe(1);
    expect(r.bundleHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ingests a ZIP with multiple .abap files", async () => {
    const buf = makeZip([
      { name: "zcl_order.clas.abap", content: "CLASS zcl_order DEFINITION." },
      { name: "zif_order.intf.abap", content: "INTERFACE zif_order." },
      { name: "z_report.prog.abap", content: "REPORT z_report." },
    ]);
    const r = await provider.ingest({ ...base, fileName: "bundle.zip", buffer: buf });
    expect(r.files.length).toBe(3);
    expect(r.totalFiles).toBe(3);
  });

  it("skips disallowed files inside a ZIP", async () => {
    const buf = makeZip([
      { name: "z_report.abap", content: "REPORT z_report." },
      { name: "readme.md", content: "# docs" },
      { name: "binary.dll", content: "MZ..." },
    ]);
    const r = await provider.ingest({ ...base, fileName: "mixed.zip", buffer: buf });
    expect(r.files.length).toBe(1);
    expect(r.files[0].extension).toBe(".abap");
  });

  it("drops ZIP path traversal entries and keeps safe entries", async () => {
    const zip = new AdmZip();
    zip.addFile("../../../etc/passwd", Buffer.from("root:x:0:0:", "utf-8"));
    zip.addFile("z_ok.abap", Buffer.from("REPORT z_ok.", "utf-8"));
    const r = await provider.ingest({
      ...base,
      fileName: "traversal.zip",
      buffer: zip.toBuffer(),
    });
    const paths = r.files.map((f) => f.filePath);
    expect(paths.every((p) => !p.includes(".."))).toBe(true);
    expect(r.files.some((f) => f.extension === ".abap")).toBe(true);
  });

  it("rejects an unsupported file type at the top level", async () => {
    await expect(
      provider.ingest({ ...base, fileName: "malware.exe", buffer: Buffer.from("MZ", "utf-8") }),
    ).rejects.toThrow(/extension/i);
  });

  it("rejects an empty upload", async () => {
    await expect(
      provider.ingest({ ...base, fileName: "empty.abap", buffer: Buffer.alloc(0) }),
    ).rejects.toThrow(/empty/i);
  });

  it("produces a stable bundle hash for identical content", async () => {
    const buf = abapBuf("REPORT z_stable.");
    const r1 = await provider.ingest({ ...base, fileName: "z.abap", buffer: buf });
    const r2 = await provider.ingest({ ...base, fileName: "z.abap", buffer: buf });
    expect(r1.bundleHash).toBe(r2.bundleHash);
  });

  it("sanitises filenames inside ZIP – no path traversal survives", async () => {
    const buf = makeZip([{ name: "sub/../z_ok.abap", content: "REPORT z_ok." }]);
    const r = await provider.ingest({ ...base, fileName: "sanitise.zip", buffer: buf });
    for (const f of r.files) {
      expect(f.filePath).not.toContain("..");
    }
  });

  it("exposes the provider name", () => {
    expect(provider.providerName()).toBe("FileUploadSourceProvider");
  });

  it("returns supportedExtensions list containing .abap and .zip", () => {
    const exts = provider.supportedExtensions();
    expect(Array.isArray(exts)).toBe(true);
    expect(exts).toContain(".abap");
    expect(exts).toContain(".zip");
  });

  it("stores text content for .abap file", async () => {
    const content = "REPORT z_content.\nWRITE 'hello'.";
    const r = await provider.ingest({
      ...base,
      fileName: "z_content.abap",
      buffer: Buffer.from(content, "utf-8"),
    });
    expect(r.files[0].textContent).toBe(content);
  });

  it("returns totalSizeBytes matching file content size for single file", async () => {
    const content = "REPORT z_size.";
    const r = await provider.ingest({
      ...base,
      fileName: "z_size.abap",
      buffer: Buffer.from(content, "utf-8"),
    });
    expect(r.totalSizeBytes).toBeGreaterThan(0);
    expect(r.totalSizeBytes).toBe(r.files[0].sizeBytes);
  });

  it("ingests a CDS artifact (.asddls)", async () => {
    const content = "define view Z_Order as select from vbak { vbeln };";
    const r = await provider.ingest({
      ...base,
      fileName: "z_order.asddls",
      buffer: Buffer.from(content, "utf-8"),
    });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].extension).toBe(".asddls");
  });
});

// ── ModernizationAnalysisService ───────────────────────────────────────────

describe("ModernizationAnalysisService", () => {
  it("creates an analysis with required fields", async () => {
    const svc = new ModernizationAnalysisService(makeRepo());
    const a = await svc.createAnalysis({
      tenantId: "T1",
      projectId: "P1",
      name: "Test Analysis",
      createdBy: "user@example.com",
    });
    expect(a.id).toBeTruthy();
    expect(a.tenantId).toBe("T1");
    expect(a.projectId).toBe("P1");
    expect(a.name).toBe("Test Analysis");
    expect(a.status).toBe("CREATED");
    expect(typeof a.createdAt).toBe("string");
  });

  it("retrieves a saved analysis", async () => {
    const repo = makeRepo();
    const svc = new ModernizationAnalysisService(repo);
    const a = await svc.createAnalysis({
      tenantId: "T1",
      projectId: "P1",
      name: "Retrieve Me",
      createdBy: "user@example.com",
    });
    const found = await svc.findAnalysis("T1", "P1", a.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(a.id);
  });

  it("returns null for a missing analysis", async () => {
    const svc = new ModernizationAnalysisService(makeRepo());
    const found = await svc.findAnalysis("T1", "P1", "nonexistent-id");
    expect(found).toBeNull();
  });

  it("lists analyses for a tenant/project", async () => {
    const svc = new ModernizationAnalysisService(makeRepo());
    await svc.createAnalysis({ tenantId: "T1", projectId: "P1", name: "A1", createdBy: "u" });
    await svc.createAnalysis({ tenantId: "T1", projectId: "P1", name: "A2", createdBy: "u" });
    await svc.createAnalysis({ tenantId: "T2", projectId: "P1", name: "A3", createdBy: "u" });
    const list = await svc.listAnalyses("T1", "P1");
    expect(list).toHaveLength(2);
    expect(list.every((a) => a.tenantId === "T1")).toBe(true);
  });

  it("blocks analysis creation without tenantId", async () => {
    const svc = new ModernizationAnalysisService(makeRepo());
    await expect(
      svc.createAnalysis({ tenantId: "", projectId: "P1", name: "Bad", createdBy: "u" }),
    ).rejects.toThrow();
  });

  it("blocks analysis creation without projectId", async () => {
    const svc = new ModernizationAnalysisService(makeRepo());
    await expect(
      svc.createAnalysis({ tenantId: "T1", projectId: "", name: "Bad", createdBy: "u" }),
    ).rejects.toThrow();
  });

  it("blocks analysis creation without name", async () => {
    const svc = new ModernizationAnalysisService(makeRepo());
    await expect(
      svc.createAnalysis({ tenantId: "T1", projectId: "P1", name: "", createdBy: "u" }),
    ).rejects.toThrow();
  });

  it("detects duplicate source upload by bundle hash", async () => {
    const repo = makeRepo();
    const svc = new ModernizationAnalysisService(repo);
    const analysis = await svc.createAnalysis({
      tenantId: "T1",
      projectId: "P1",
      name: "Dup test",
      createdBy: "u",
    });
    const provider = new FileUploadSourceProvider();
    const buf = abapBuf("REPORT z_dup.");
    const ingested = await provider.ingest({
      tenantId: "T1",
      projectId: "P1",
      analysisId: analysis.id,
      fileName: "z_dup.abap",
      buffer: buf,
      uploadedBy: "u",
    });
    const result1 = await svc.recordSourceUpload("T1", "P1", analysis.id, ingested, "u");
    expect(result1.isDuplicate).toBe(false);
    const result2 = await svc.recordSourceUpload("T1", "P1", analysis.id, ingested, "u");
    expect(result2.isDuplicate).toBe(true);
  });

  it("stores custom objects derived from source files", async () => {
    const repo = makeRepo();
    const svc = new ModernizationAnalysisService(repo);
    const analysis = await svc.createAnalysis({
      tenantId: "T1",
      projectId: "P1",
      name: "Objects test",
      createdBy: "u",
    });
    const provider = new FileUploadSourceProvider();
    const buf = makeZip([
      { name: "zcl_order.clas.abap", content: "CLASS zcl_order DEFINITION PUBLIC." },
      { name: "z_report.prog.abap", content: "REPORT z_report." },
    ]);
    const ingested = await provider.ingest({
      tenantId: "T1",
      projectId: "P1",
      analysisId: analysis.id,
      fileName: "bundle.zip",
      buffer: buf,
      uploadedBy: "u",
    });
    await svc.recordSourceUpload("T1", "P1", analysis.id, ingested, "u");
    const objects = await repo.listCustomObjects("T1", "P1", analysis.id);
    expect(objects.length).toBeGreaterThan(0);
    expect(objects.every((o) => o.tenantId === "T1")).toBe(true);
  });
});

// ── deriveCustomObjects ────────────────────────────────────────────────────

describe("deriveCustomObjects", () => {
  it("derives a REPORT object from a .prog.abap file", () => {
    const objs = deriveCustomObjects("T1", "P1", "A1", [
      {
        filePath: "z_report.prog.abap",
        extension: ".abap",
        sizeBytes: 20,
        contentHash: "abc",
        textContent: "REPORT z_report.",
      },
    ]);
    expect(objs).toHaveLength(1);
    expect(objs[0].objectType).toBe("REPORT");
    expect(objs[0].objectName).toBe("Z_REPORT");
  });

  it("derives a CLASS object from a .clas.abap file", () => {
    const objs = deriveCustomObjects("T1", "P1", "A1", [
      {
        filePath: "zcl_order.clas.abap",
        extension: ".abap",
        sizeBytes: 30,
        contentHash: "def",
        textContent: "CLASS zcl_order DEFINITION.",
      },
    ]);
    expect(objs.some((o) => o.objectType === "CLASS")).toBe(true);
    expect(objs[0].objectName).toBe("ZCL_ORDER");
  });

  it("derives an INTERFACE object from a .intf.abap file", () => {
    const objs = deriveCustomObjects("T1", "P1", "A1", [
      {
        filePath: "zif_partner.intf.abap",
        extension: ".abap",
        sizeBytes: 15,
        contentHash: "ghi",
        textContent: "INTERFACE zif_partner.",
      },
    ]);
    expect(objs.some((o) => o.objectType === "INTERFACE")).toBe(true);
  });

  it("derives a CDS artifact from .asddls", () => {
    const objs = deriveCustomObjects("T1", "P1", "A1", [
      {
        filePath: "z_order_view.asddls",
        extension: ".asddls",
        sizeBytes: 50,
        contentHash: "jkl",
        textContent: "define view Z_Order as select from vbak { vbeln };",
      },
    ]);
    expect(objs.some((o) => o.objectType === "CDS_VIEW")).toBe(true);
  });

  it("sets UNKNOWN type for unrecognised extensions", () => {
    const objs = deriveCustomObjects("T1", "P1", "A1", [
      {
        filePath: "somefile.txt",
        extension: ".txt",
        sizeBytes: 10,
        contentHash: "mno",
        textContent: "some text content",
      },
    ]);
    expect(objs[0].objectType).toBe("UNKNOWN");
  });

  it("scopes every object to tenantId and projectId", () => {
    const objs = deriveCustomObjects("TENANT_X", "PROJ_Y", "ANALYSIS_Z", [
      {
        filePath: "z_test.prog.abap",
        extension: ".abap",
        sizeBytes: 14,
        contentHash: "pqr",
        textContent: "REPORT z_test.",
      },
    ]);
    expect(objs[0].tenantId).toBe("TENANT_X");
    expect(objs[0].projectId).toBe("PROJ_Y");
    expect(objs[0].analysisId).toBe("ANALYSIS_Z");
  });
});
