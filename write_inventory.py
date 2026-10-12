content = r'''import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/AppStoreContext";
import { UploadModal } from "../components/UploadModal";
import type { Disposition, RiskLevel } from "../data/mockData";

const DISPOSITIONS: Disposition[] = ["Retire", "Replace", "Refactor", "Replatform", "Pending"];
const RISK_LEVELS: RiskLevel[] = ["High", "Medium", "Low", "Unknown"];
const DISP_CLR: Record<Disposition, string> = { Retire: "danger", Replace: "warning", Refactor: "info", Replatform: "purple", Pending: "neutral" };
const RISK_CLR: Record<RiskLevel, string> = { High: "danger", Medium: "warning", Low: "success", Unknown: "neutral" };

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  const map: Record<string, string> = { danger: "#dc3545", warning: "#f59e0b", info: "#3b82f6", success: "#22c55e", purple: "#a855f7", neutral: "#6b7280" };
  const c = map[color] ?? "#6b7280";
  return (
    <span style={{ display: "inline-block", padding: "0.15rem 0.5rem", borderRadius: "999px", fontSize: "0.72rem", fontWeight: 700, background: c + "22", color: c, border: `1px solid ${c}44`, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

interface DisplayObject {
  id: string;
  name: string;
  type: string;
  disposition: Disposition;
  riskLevel: RiskLevel;
  linesOfCode: number | null;
  owner: string | null;
  source: "mock" | "backend";
}

async function resolveBackendProjectId(projectName: string): Promise<number | null> {
  try {
    const r = await fetch("/api/projects");
    const j = await r.json();
    const list: Array<{ id: number; name: string }> = Array.isArray(j.data) ? j.data : [];
    const found = list.find((p) => p.name === projectName);
    if (found) return found.id;
    const cr = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName, description: "Auto-created" }),
    });
    const cj = await cr.json();
    return cj?.data?.id ?? null;
  } catch {
    return null;
  }
}

export default function ObjectInventoryPage() {
  const { state } = useAppStore();
  const { inventory, activeProjectId, projects, analyses } = state;
  const navigate = useNavigate();

  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDisp, setFilterDisp] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "type" | "disposition" | "riskLevel">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [backendObjects, setBackendObjects] = useState<DisplayObject[]>([]);
  const [loadingBackend, setLoadingBackend] = useState(false);

  const project = projects.find((p) => p.id === activeProjectId);

  const fetchBackendObjects = useCallback(async () => {
    if (!project) return;
    setLoadingBackend(true);
    try {
      const bid = await resolveBackendProjectId(project.name);
      if (!bid) {
        setLoadingBackend(false);
        return;
      }
      const r = await fetch(`/api/projects/${bid}/objects`);
      const j = await r.json();
      const list: Array<{ id: number; object_name: string; object_type: string; lines_of_code: number }> =
        Array.isArray(j.data) ? j.data : [];
      setBackendObjects(
        list.map((o) => ({
          id: `backend-${o.id}`,
          name: o.object_name,
          type: o.object_type || "ABAP Program",
          disposition: "Pending" as Disposition,
          riskLevel: "Unknown" as RiskLevel,
          linesOfCode: o.lines_of_code ?? null,
          owner: null,
          source: "backend",
        }))
      );
    } catch {
      /* ignore */
    } finally {
      setLoadingBackend(false);
    }
  }, [project]);

  useEffect(() => {
    fetchBackendObjects();
  }, [fetchBackendObjects]);

  const projectAnalysisIds = analyses
    .filter((a) => a.projectId === activeProjectId)
    .map((a) => a.id);

  const mockObjects: DisplayObject[] = inventory
    .filter((o) => projectAnalysisIds.includes(o.analysisId))
    .map((o) => ({
      id: String(o.id),
      name: o.name,
      type: o.type,
      disposition: o.disposition,
      riskLevel: o.riskLevel,
      linesOfCode: (o as any).linesOfCode ?? null,
      owner: (o as any).owner ?? null,
      source: "mock" as const,
    }));

  const backendNames = new Set(backendObjects.map((o) => o.name));
  const allObjects: DisplayObject[] = [
    ...backendObjects,
    ...mockObjects.filter((o) => !backendNames.has(o.name)),
  ];

  const filtered = allObjects
    .filter(
      (o) =>
        !search ||
        o.name.toLowerCase().includes(search.toLowerCase()) ||
        o.type.toLowerCase().includes(search.toLowerCase())
    )
    .filter((o) => !filterDisp || o.disposition === filterDisp)
    .filter((o) => !filterRisk || o.riskLevel === filterRisk)
    .sort((a, b) => {
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function handleUploadDone() {
    setShowUpload(false);
    fetchBackendObjects();
  }

  const selSt: React.CSSProperties = {
    background: "var(--ncs-surface)",
    border: "1px solid var(--ncs-border)",
    borderRadius: "0.4rem",
    padding: "0.3rem 0.55rem",
    fontSize: "0.82rem",
    color: "var(--ncs-text)",
    cursor: "pointer",
  };
  const thSt: React.CSSProperties = {
    padding: "0.65rem 0.9rem",
    textAlign: "left",
    fontWeight: 700,
    fontSize: "0.78rem",
    color: "var(--ncs-muted)",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };
  const tdSt: React.CSSProperties = { padding: "0.65rem 0.9rem" };

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: "1400px", margin: "0 auto" }}>
      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={handleUploadDone} />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700 }}>Object Inventory</h1>
          {project && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.88rem", color: "var(--ncs-muted)" }}>
              Project: {project.name} &middot; {allObjects.length} object{allObjects.length !== 1 ? "s" : ""}
              {loadingBackend && <span style={{ marginLeft: "0.5rem", opacity: 0.6 }}>(refreshing&hellip;)</span>}
            </p>
          )}
        </div>
        <button onClick={() => setShowUpload(true)} className="ncs-btn ncs-btn--primary">
          Upload Files
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search objects..."
          style={{ ...selSt, minWidth: "200px", padding: "0.35rem 0.6rem" }}
        />
        <select value={filterDisp} onChange={(e) => setFilterDisp(e.target.value)} style={selSt}>
          <option value="">All Dispositions</option>
          {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)} style={selSt}>
          <option value="">All Risk Levels</option>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {(search || filterDisp || filterRisk) && (
          <button
            onClick={() => { setSearch(""); setFilterDisp(""); setFilterRisk(""); }}
            style={{ ...selSt, color: "var(--ncs-muted)", fontSize: "0.78rem" }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: "0.82rem", color: "var(--ncs-muted)" }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: "10px", border: "1px solid var(--ncs-border)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.855rem" }}>
          <thead>
            <tr style={{ background: "var(--ncs-surface)", borderBottom: "2px solid var(--ncs-border)" }}>
              {(["name", "type", "disposition", "riskLevel"] as const).map((k) => (
                <th key={k} onClick={() => toggleSort(k)} style={thSt}>
                  {k === "riskLevel" ? "Risk" : k.charAt(0).toUpperCase() + k.slice(1)}{" "}
                  {sortKey === k ? (sortDir === "asc" ? "\u2191" : "\u2193") : ""}
                </th>
              ))}
              <th style={{ ...thSt, cursor: "default" }}>Lines</th>
              <th style={{ ...thSt, cursor: "default" }}>Owner</th>
              <th style={{ ...thSt, cursor: "default" }}>Source</th>
              <th style={{ padding: "0.65rem 0.9rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "3rem", textAlign: "center", color: "var(--ncs-muted)", fontSize: "0.9rem" }}>
                  {allObjects.length === 0
                    ? "No objects yet — upload ABAP source files to get started."
                    : "No objects match the current filters."}
                </td>
              </tr>
            ) : (
              filtered.map((obj) => (
                <tr
                  key={obj.id}
                  style={{ borderBottom: "1px solid var(--ncs-border)", cursor: obj.source === "mock" ? "pointer" : "default", transition: "background 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ncs-surface)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
                  onClick={() => obj.source === "mock" && navigate(`/objects/${obj.id}`)}
                >
                  <td style={{ ...tdSt, fontWeight: 600, fontFamily: "monospace", fontSize: "0.82rem" }}>{obj.name}</td>
                  <td style={{ ...tdSt, color: "var(--ncs-muted)" }}>{obj.type}</td>
                  <td style={tdSt}><Badge color={DISP_CLR[obj.disposition]}>{obj.disposition}</Badge></td>
                  <td style={tdSt}><Badge color={RISK_CLR[obj.riskLevel]}>{obj.riskLevel}</Badge></td>
                  <td style={{ ...tdSt, color: "var(--ncs-muted)" }}>{obj.linesOfCode ?? "\u2014"}</td>
                  <td style={{ ...tdSt, color: "var(--ncs-muted)" }}>{obj.owner ?? "\u2014"}</td>
                  <td style={tdSt}>
                    <span style={{ fontSize: "0.72rem", padding: "0.1rem 0.4rem", borderRadius: "4px", background: obj.source === "backend" ? "rgba(59,130,246,0.1)" : "rgba(100,100,100,0.1)", color: obj.source === "backend" ? "#3b82f6" : "#6b7280" }}>
                      {obj.source === "backend" ? "Uploaded" : "Analysis"}
                    </span>
                  </td>
                  <td style={{ ...tdSt, textAlign: "right" }}>
                    {obj.source === "mock" && <span style={{ fontSize: "0.8rem", color: "var(--ncs-muted)" }}>&rarr;</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
'''

with open(r'app\src\pages\ObjectInventoryPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Written OK')
