content = r'''import React, { useState } from "react";

interface Artifact {
  id: number;
  artifact_name: string;
  artifact_type: string;
  language: string;
  target_platform: string;
  lines_of_code: number;
  status: string;
  generated_by: string;
  generated_at: string;
  code_content: string;
  plan_object_name: string;
}

const SC: Record<string, string> = { "Pending Review": "#f59e0b", Accepted: "#22c55e", Rejected: "#dc3545", Draft: "#6b7280" };
const TC: Record<string, string> = { "BAdI Implementation": "#f59e0b", "Migration Script": "#3b82f6", "RAP Business Object": "#a855f7", "BAdI Skeleton": "#6b7280", "CAP Node.js": "#22c55e" };
const DATA: Artifact[] = [
  { id: 1, artifact_name: "ZCL_VENDOR_HOLD_BADI", artifact_type: "BAdI Implementation", language: "ABAP (RAP)", target_platform: "S/4HANA Cloud Private", lines_of_code: 87, status: "Pending Review", generated_by: "SAP AI Core (GPT-4o)", generated_at: "9/27/2026", code_content: "CLASS zcl_vendor_hold_badi DEFINITION\n  PUBLIC FINAL CREATE PUBLIC.\nENDCLASS.", plan_object_name: "ZFI_PAYMENT_BLOCK" },
  { id: 2, artifact_name: "ZMIG_PAYMENT_BLOCKS", artifact_type: "Migration Script", language: "ABAP", target_platform: "S/4HANA Cloud Private", lines_of_code: 134, status: "Pending Review", generated_by: "SAP AI Core (GPT-4o)", generated_at: "9/27/2026", code_content: "REPORT zmig_payment_blocks.\nDATA: lt_vendor TYPE TABLE OF lfa1.", plan_object_name: "ZFI_PAYMENT_BLOCK" },
  { id: 3, artifact_name: "ZI_VENDOR_SCORE_BO", artifact_type: "RAP Business Object", language: "ABAP (RAP)", target_platform: "S/4HANA Cloud Private", lines_of_code: 87, status: "Accepted", generated_by: "SAP AI Core (GPT-4o)", generated_at: "9/26/2026", code_content: "managed implementation in class zbp_vendor_score unique;", plan_object_name: "ZMM_VENDOR_SCORE" },
  { id: 4, artifact_name: "ZCL_SD_PRICING_BADI", artifact_type: "BAdI Skeleton", language: "ABAP", target_platform: "S/4HANA On-Premise", lines_of_code: 58, status: "Rejected", generated_by: "SAP AI Core (GPT-4o)", generated_at: "9/25/2026", code_content: "CLASS zcl_sd_pricing_badi DEFINITION PUBLIC FINAL.\nENDCLASS.", plan_object_name: "ZSD_PRICING_EXIT" },
  { id: 5, artifact_name: "approval-router.ts", artifact_type: "CAP Node.js", language: "TypeScript", target_platform: "SAP BTP Cloud Foundry", lines_of_code: 213, status: "Pending Review", generated_by: "SAP AI Core (GPT-4o)", generated_at: "9/27/2026", code_content: "import cds from '@sap/cds';\nmodule.exports = cds.service.impl(async function () {});", plan_object_name: "ZWF_APPROVAL_ROUTE" },
];
const TABS = ["All", "Pending Review", "Accepted", "Rejected", "Draft"];

export default function GeneratedArtifactsPage() {
  const [artifacts, setArtifacts] = useState<Artifact[]>(DATA);
  const [sel, setSel] = useState<Artifact>(DATA[0]);
  const [tab, setTab] = useState("All");
  const filtered = tab === "All" ? artifacts : artifacts.filter((a) => a.status === tab);
  const accepted = artifacts.filter((a) => a.status === "Accepted").length;
  const pending = artifacts.filter((a) => a.status === "Pending Review").length;
  const totalLines = artifacts.reduce((s, a) => s + a.lines_of_code, 0);
  function patchStatus(id: number, s: string) {
    setArtifacts((prev) => prev.map((a) => (a.id === id ? { ...a, status: s } : a)));
    setSel((prev) => (prev.id === id ? { ...prev, status: s } : prev));
  }
  const selColor = SC[sel.status] || "#6b7280";
  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800 }}>Generated Artifacts</h1>
        <p style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", color: "#6b7280" }}>Consultant-ready implementation drafts. All artifacts require human review before activation.</p>
      </div>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {([["Total Artifacts", String(artifacts.length), ""], ["Accepted", String(accepted), "#22c55e"], ["Pending Review", String(pending), "#f59e0b"], ["Total Lines", totalLines.toLocaleString(), ""]] as [string,string,string][]).map(([lbl, val, col]) => (
          <div key={lbl} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, flex: 1, minWidth: 110, padding: "0.9rem 1.2rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: "0.3rem" }}>{lbl}</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, color: col || "#111" }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#fef3c7", border: "1px solid #f59e0b55", borderRadius: 8, padding: "0.55rem 1rem", marginBottom: "1rem", fontSize: "0.8rem", color: "#92400e" }}>
        <span>Warning: Generated implementation drafts - consultant validation required before activation or transport creation</span>
      </div>
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "0.3rem 0.75rem", fontSize: "0.8rem", fontWeight: 600, borderRadius: 6, cursor: "pointer", border: tab === t ? "1.5px solid #2563eb" : "1px solid #e5e7eb", background: tab === t ? "#2563eb" : "#f9fafb", color: tab === t ? "#fff" : "#111" }}>{t}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1rem", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {filtered.map((a) => {
            const sc = SC[a.status] || "#6b7280";
            const tc = TC[a.artifact_type] || "#6b7280";
            const isActive = sel.id === a.id;
            return (
              <div key={a.id} onClick={() => setSel(a)} style={{ background: "#fff", border: "1px solid " + (isActive ? "#2563eb" : "#e5e7eb"), borderRadius: 10, padding: "0.75rem 1rem", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.3rem" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{a.artifact_name}</span>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, color: sc, background: sc + "18", border: "1px solid " + sc + "44", borderRadius: "999px", padding: "0.1rem 0.45rem", whiteSpace: "nowrap" }}>{a.status}</span>
                </div>
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: "0.3rem" }}>Plan: {a.plan_object_name}</div>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginBottom: "0.3rem" }}>
                  <span style={{ fontSize: "0.65rem", fontWeight: 700, color: tc, background: tc + "18", border: "1px solid " + tc + "44", borderRadius: 4, padding: "0.08rem 0.35rem" }}>{a.artifact_type}</span>
                  <span style={{ fontSize: "0.65rem", color: "#6b7280", background: "#f3f4f6", borderRadius: 4, padding: "0.08rem 0.35rem" }}>{a.language}</span>
                  <span style={{ fontSize: "0.65rem", color: "#6b7280" }}>{a.lines_of_code} lines</span>
                </div>
                <div style={{ fontSize: "0.68rem", color: "#6b7280" }}>{a.target_platform} - {a.generated_at}</div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "2rem", textAlign: "center", color: "#6b7280", fontSize: "0.85rem" }}>No artifacts match this filter.</div>
          )}
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "1.25rem 1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>{sel.artifact_name}</h2>
              <p style={{ margin: "0.15rem 0 0", fontSize: "0.78rem", color: "#6b7280" }}>{sel.artifact_type} - {sel.language} - {sel.target_platform}</p>
            </div>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: selColor, background: selColor + "18", border: "1px solid " + selColor + "44", borderRadius: "999px", padding: "0.15rem 0.55rem" }}>{sel.status}</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <button onClick={() => patchStatus(sel.id, "Accepted")} style={{ padding: "0.3rem 0.75rem", fontSize: "0.8rem", fontWeight: 600, borderRadius: 6, cursor: "pointer", background: "#22c55e", color: "#fff", border: "none" }}>Accept</button>
            <button onClick={() => patchStatus(sel.id, "Rejected")} style={{ padding: "0.3rem 0.75rem", fontSize: "0.8rem", fontWeight: 600, borderRadius: 6, cursor: "pointer", background: "#dc3545", color: "#fff", border: "none" }}>Reject</button>
            <button onClick={() => patchStatus(sel.id, "Pending Review")} style={{ padding: "0.3rem 0.75rem", fontSize: "0.8rem", fontWeight: 600, borderRadius: 6, cursor: "pointer", background: "#f9fafb", color: "#111", border: "1px solid #e5e7eb" }}>Reset to Pending</button>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              <span><strong>Generated by:</strong> {sel.generated_by}</span>
              <span><strong>Date:</strong> {sel.generated_at}</span>
              <span><strong>Lines:</strong> {sel.lines_of_code}</span>
              <span><strong>Source object:</strong> {sel.plan_object_name}</span>
            </div>
          </div>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151", marginBottom: "0.4rem" }}>Code Preview</div>
          <pre style={{ background: "#1e1e1e", color: "#d4d4d4", borderRadius: 8, padding: "1rem", fontSize: "0.78rem", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 120, margin: 0 }}>{sel.code_content}</pre>
        </div>
      </div>
    </div>
  );
}
'''

import os
path = os.path.join(os.path.dirname(__file__), 'N-CoreShift-main', 'app', 'src', 'pages', 'GeneratedArtifactsPage.tsx')
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Written:', path)
