import React, { useState, useEffect, useCallback } from 'react';

const API = '/api';

interface BackendProject { id: number; name: string; object_count: number; }

interface Analysis {
  id: number; project_id: number; run_date: string | null; status: string;
  result_count: number; label?: string;
  total_input_tokens?: number; total_output_tokens?: number;
  total_tokens?: number; total_cost_usd?: number;
}

interface AnalysisResult {
  id: number; analysis_id: number; object_id: number; object_name: string;
  functional_intent: string; risk_level: string; risk_rationale?: string;
  disposition: string; disposition_reasoning?: string; reasoning: string;
  modernization_plan: string; technical_effort?: string;
  technical_effort_rationale?: string; business_impact?: string;
  business_impact_rationale?: string; confidence_score?: number;
  dependencies?: string[]; suggested_sap_replacement?: Record<string, string>;
  validation_status?: string; validation_errors?: string[];
  sensitive_data_blocked?: boolean; model_name?: string; llm_provider?: string;
  prompt_version?: string; input_tokens?: number; output_tokens?: number;
  total_tokens?: number; estimated_total_cost_usd?: number;
  request_status?: string; created_at: string | null;
}

/* ── Pill ── */
function Pill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display:'inline-block', padding:'0.15rem 0.55rem', borderRadius:'999px',
      fontSize:'0.72rem', fontWeight:700, background:color+'22', color,
      border:'1px solid '+color+'44', whiteSpace:'nowrap' }}>
      {label}
    </span>
  );
}
function RiskBadge({ r }: { r: string }) {
  const c = r==='High'?'#dc3545':r==='Medium'?'#f59e0b':r==='Low'?'#22c55e':'#6b7280';
  return <Pill color={c} label={r||'—'} />;
}
function DispBadge({ d }: { d: string }) {
  const m: Record<string,string> = { Retire:'#dc3545', Replace:'#f59e0b', Refactor:'#3b82f6',
    Replatform:'#a855f7','BTP Extension':'#a855f7', Retain:'#22c55e', Pending:'#6b7280' };
  return <Pill color={m[d]??'#6b7280'} label={d||'—'} />;
}
function EffortBadge({ e }: { e?: string }) {
  if (!e) return null;
  const c = e==='High'?'#dc3545':e==='Medium'?'#f59e0b':'#22c55e';
  return <Pill color={c} label={e} />;
}
function StatusPill({ s }: { s: string }) {
  const c = s==='Complete'?'#22c55e':s==='Pending'?'#f59e0b':s==='Failed'?'#dc3545':'#6b7280';
  return <Pill color={c} label={s} />;
}
function ConfBar({ score }: { score?: number }) {
  const pct = Math.round((score??0)*100);
  const color = pct>=75?'#22c55e':pct>=45?'#f59e0b':'#dc3545';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
      <div style={{ height:'6px', width:'60px', background:'var(--ncs-border)',
        borderRadius:'3px', overflow:'hidden' }}>
        <div style={{ height:'100%', width:pct+'%', background:color, borderRadius:'3px' }} />
      </div>
      <span style={{ fontSize:'0.72rem', color:'var(--ncs-muted)' }}>{pct}%</span>
    </div>
  );
}

/* ── Result detail panel ── */
function ResultDetail({ r }: { r: AnalysisResult }) {
  const Row = ({ label, children }: { label: string; children?: React.ReactNode }) =>
    children ? (
      <div style={{ display:'flex', gap:'0.5rem', marginBottom:'0.35rem', flexWrap:'wrap' }}>
        <span style={{ fontWeight:600, fontSize:'0.78rem', minWidth:'165px', color:'var(--ncs-muted)' }}>{label}</span>
        <span style={{ fontSize:'0.78rem', flex:1 }}>{children}</span>
      </div>
    ) : null;

  const deps = r.dependencies ?? [];
  const repl = r.suggested_sap_replacement ?? {};
  const valErrs = r.validation_errors ?? [];

  return (
    <div style={{ background:'var(--ncs-bg)', border:'1px solid var(--ncs-border)',
      borderRadius:'8px', padding:'0.9rem 1rem', marginTop:'0.25rem', fontSize:'0.82rem' }}>

      <SectionHeading>Assessment Details</SectionHeading>
      <Row label="Disposition Reasoning">{r.disposition_reasoning}</Row>
      <Row label="Risk Rationale">{r.risk_rationale}</Row>
      <Row label="Technical Effort">
        {r.technical_effort && (
          <span style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
            <EffortBadge e={r.technical_effort} />
            {r.technical_effort_rationale && <span style={{ color:'var(--ncs-muted)' }}>— {r.technical_effort_rationale}</span>}
          </span>
        )}
      </Row>
      <Row label="Business Impact">
        {r.business_impact && <span>{r.business_impact}{r.business_impact_rationale ? ` — ${r.business_impact_rationale}` : ''}</span>}
      </Row>
      {deps.length > 0 && <Row label="Dependencies">{deps.join(', ')}</Row>}
      {Object.keys(repl).length > 0 && (
        <Row label="SAP Replacement">
          {Object.entries(repl).map(([k,v]) => `${k}: ${v}`).join(' | ')}
        </Row>
      )}

      {r.modernization_plan && (
        <>
          <SectionHeading>Modernization Plan</SectionHeading>
          <div style={{ whiteSpace:'pre-wrap', lineHeight:1.5, fontSize:'0.82rem' }}>{r.modernization_plan}</div>
        </>
      )}

      <SectionHeading>LLM Metadata</SectionHeading>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'0.6rem' }}>
        {([
          ['Model', r.model_name||'—'],
          ['Provider', r.llm_provider||'—'],
          ['Prompt v', r.prompt_version||'—'],
          ['In tokens', r.input_tokens?.toLocaleString()??'—'],
          ['Out tokens', r.output_tokens?.toLocaleString()??'—'],
          ['Est. cost', r.estimated_total_cost_usd!=null?`$${r.estimated_total_cost_usd.toFixed(4)}`:'—'],
          ['Req status', r.request_status||'—'],
          ['Validation', r.validation_status||'—'],
        ] as [string,string][]).map(([lbl,val]) => (
          <div key={lbl} style={{ background:'var(--ncs-surface)', border:'1px solid var(--ncs-border)',
            borderRadius:'6px', padding:'0.3rem 0.6rem', minWidth:'80px' }}>
            <div style={{ fontSize:'0.65rem', color:'var(--ncs-muted)', marginBottom:'0.1rem' }}>{lbl}</div>
            <div style={{ fontSize:'0.78rem', fontWeight:600 }}>{val}</div>
          </div>
        ))}
      </div>

      {valErrs.length > 0 && (
        <div style={{ marginTop:'0.5rem', color:'#f59e0b', fontSize:'0.78rem' }}>
          ⚠ Validation issues: {valErrs.join('; ')}
        </div>
      )}
      {r.sensitive_data_blocked && (
        <div style={{ marginTop:'0.4rem', color:'#dc3545', fontSize:'0.78rem' }}>
          🔒 Source code was redacted before sending to the LLM.
        </div>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight:700, fontSize:'0.75rem', margin:'0.7rem 0 0.4rem',
      color:'var(--ncs-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
      {children}
    </div>
  );
}

/* ── Results table ── */
function ResultsTable({ results, onPlansCreated }: { results: AnalysisResult[]; onPlansCreated: () => void }) {
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function createAllPlans() {
    setCreating(true); setMsg('');
    let ok = 0;
    for (const r of results) {
      try {
        const res = await fetch(`${API}/analysis-results/${r.id}/plans`, { method:'POST' });
        if (res.ok) ok++;
      } catch { /* ignore */ }
    }
    setMsg(`Created ${ok} plan${ok !== 1 ? 's' : ''}`);
    setCreating(false);
    onPlansCreated();
  }

  const avgConf = results.length > 0
    ? results.reduce((s,r) => s + (r.confidence_score??0), 0) / results.length : 0;

  return (
    <div style={{ marginTop:'0.75rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
        marginBottom:'0.75rem', flexWrap:'wrap', gap:'0.5rem' }}>
        <div style={{ fontWeight:600, fontSize:'0.9rem' }}>
          {results.length} object{results.length !== 1 ? 's' : ''} analyzed
          {results.length > 0 && (
            <span style={{ marginLeft:'0.75rem', fontWeight:400, fontSize:'0.8rem', color:'var(--ncs-muted)' }}>
              avg. confidence {Math.round(avgConf * 100)}%
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          {msg && <span style={{ fontSize:'0.8rem', color:'#22c55e' }}>✓ {msg}</span>}
          <button className="ncs-btn ncs-btn--primary ncs-btn--sm"
            onClick={createAllPlans} disabled={creating || results.length === 0}>
            {creating ? 'Creating…' : 'Create Modernization Plans'}
          </button>
        </div>
      </div>

      <div style={{ overflowX:'auto', borderRadius:'8px', border:'1px solid var(--ncs-border)' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.84rem' }}>
          <thead>
            <tr style={{ background:'var(--ncs-surface)', borderBottom:'2px solid var(--ncs-border)' }}>
              {['', 'Object', 'Disposition', 'Risk', 'Effort', 'Confidence', 'Functional Intent'].map(h => (
                <th key={h} style={{ padding:'0.6rem 0.75rem', textAlign:'left',
                  fontWeight:700, fontSize:'0.78rem', color:'var(--ncs-muted)', whiteSpace:'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map(r => (
              <React.Fragment key={r.id}>
                <tr
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  style={{ borderBottom:'1px solid var(--ncs-border)', cursor:'pointer',
                    background: expandedId===r.id ? 'var(--ncs-surface)' : undefined,
                    transition:'background 0.15s' }}
                >
                  <td style={{ padding:'0.5rem 0.75rem', width:'24px', color:'var(--ncs-muted)', fontSize:'0.8rem' }}>
                    {expandedId === r.id ? '▾' : '▸'}
                  </td>
                  <td style={{ padding:'0.5rem 0.75rem', fontWeight:600, whiteSpace:'nowrap' }}>{r.object_name}</td>
                  <td style={{ padding:'0.5rem 0.75rem' }}><DispBadge d={r.disposition} /></td>
                  <td style={{ padding:'0.5rem 0.75rem' }}><RiskBadge r={r.risk_level} /></td>
                  <td style={{ padding:'0.5rem 0.75rem' }}><EffortBadge e={r.technical_effort} /></td>
                  <td style={{ padding:'0.5rem 0.75rem' }}><ConfBar score={r.confidence_score} /></td>
                  <td style={{ padding:'0.5rem 0.75rem', color:'var(--ncs-muted)', maxWidth:'320px',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {r.functional_intent}
                  </td>
                </tr>
                {expandedId === r.id && (
                  <tr>
                    <td colSpan={7} style={{ padding:'0 0.75rem 0.75rem' }}>
                      <ResultDetail r={r} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── LLM Usage summary card ── */
function LlmUsageCard({ analysis }: { analysis: Analysis }) {
  const tokens = analysis.total_tokens ?? 0;
  const cost = analysis.total_cost_usd ?? 0;
  const inTok = analysis.total_input_tokens ?? 0;
  const outTok = analysis.total_output_tokens ?? 0;
  if (!tokens && !cost) return null;
  return (
    <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap', marginTop:'0.5rem' }}>
      {([
        ['Input tokens', inTok.toLocaleString()],
        ['Output tokens', outTok.toLocaleString()],
        ['Total tokens', tokens.toLocaleString()],
        ['Est. cost', `$${cost.toFixed(4)}`],
      ] as [string,string][]).map(([lbl,val]) => (
        <div key={lbl} style={{ background:'var(--ncs-surface)', border:'1px solid var(--ncs-border)',
          borderRadius:'6px', padding:'0.3rem 0.7rem' }}>
          <div style={{ fontSize:'0.65rem', color:'var(--ncs-muted)', marginBottom:'0.1rem' }}>{lbl}</div>
          <div style={{ fontSize:'0.82rem', fontWeight:700 }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Analysis card ── */
function AnalysisCard({
  analysis, projectName, onRefresh,
}: {
  analysis: Analysis; projectName: string; onRefresh: () => void;
}) {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadResults() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/analyses/${analysis.id}/results`);
      if (res.ok) {
        const json = await res.json();
        setResults(Array.isArray(json) ? json : (json.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  function toggle() {
    if (!open && results.length === 0) loadResults();
    setOpen(o => !o);
  }

  const d = analysis.run_date ? new Date(analysis.run_date).toLocaleString() : 'Not run';

  return (
    <div style={{ background:'var(--ncs-surface)', border:'1px solid var(--ncs-border)',
      borderRadius:'10px', padding:'1rem 1.1rem', marginBottom:'0.85rem' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start',
        flexWrap:'wrap', gap:'0.5rem' }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'1rem' }}>
            {analysis.label || `Analysis #${analysis.id}`}
          </div>
          <div style={{ fontSize:'0.8rem', color:'var(--ncs-muted)', marginTop:'0.2rem' }}>
            {projectName} &bull; {d} &bull; {analysis.result_count} object{analysis.result_count !== 1 ? 's' : ''}
          </div>
          <LlmUsageCard analysis={analysis} />
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
          <StatusPill s={analysis.status} />
          <button className="ncs-btn ncs-btn--sm" onClick={toggle} style={{ minWidth:'90px' }}>
            {open ? 'Hide Results' : 'View Results'}
          </button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop:'0.75rem' }}>
          {loading ? (
            <div style={{ color:'var(--ncs-muted)', fontSize:'0.85rem', padding:'0.5rem' }}>Loading…</div>
          ) : (
            <ResultsTable results={results} onPlansCreated={onRefresh} />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Run analysis modal ── */
function RunModal({
  projects, onClose, onDone,
}: {
  projects: BackendProject[]; onClose: () => void; onDone: () => void;
}) {
  const [projectId, setProjectId] = useState<number | ''>(projects[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    if (!projectId) { setError('Select a project'); return; }
    setRunning(true); setError('');
    try {
      const res = await fetch(`${API}/analyses`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ project_id: projectId, label: label || undefined }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.detail || 'Failed'); }
      else { onDone(); onClose(); }
    } catch { setError('Network error'); }
    setRunning(false);
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'var(--ncs-surface)', borderRadius:'12px', padding:'1.5rem',
        width:'420px', border:'1px solid var(--ncs-border)' }}>
        <div style={{ fontWeight:700, fontSize:'1.1rem', marginBottom:'1rem' }}>Run New Analysis</div>
        <label style={{ display:'block', marginBottom:'0.75rem' }}>
          <div style={{ fontSize:'0.82rem', fontWeight:600, marginBottom:'0.3rem' }}>Project</div>
          <select className="ncs-input" style={{ width:'100%' }}
            value={projectId} onChange={e => setProjectId(Number(e.target.value))}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ display:'block', marginBottom:'1rem' }}>
          <div style={{ fontSize:'0.82rem', fontWeight:600, marginBottom:'0.3rem' }}>Label (optional)</div>
          <input className="ncs-input" style={{ width:'100%' }} value={label}
            onChange={e => setLabel(e.target.value)} placeholder="e.g. Sprint 3 baseline" />
        </label>
        {error && <div style={{ color:'#dc3545', fontSize:'0.82rem', marginBottom:'0.75rem' }}>{error}</div>}
        <div style={{ display:'flex', gap:'0.5rem', justifyContent:'flex-end' }}>
          <button className="ncs-btn" onClick={onClose} disabled={running}>Cancel</button>
          <button className="ncs-btn ncs-btn--primary" onClick={run} disabled={running}>
            {running ? 'Running…' : 'Run Analysis'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ── */
export default function AnalysesPage() {
  const [projects, setProjects] = useState<BackendProject[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterProject, setFilterProject] = useState<number | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, an] = await Promise.all([
        fetch(`${API}/projects`).then(r => r.json()),
        fetch(`${API}/analyses`).then(r => r.json()),
      ]);
      setProjects(Array.isArray(pr) ? pr : []);
      setAnalyses(Array.isArray(an) ? an : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const filtered = filterProject === 'all'
    ? analyses
    : analyses.filter(a => a.project_id === filterProject);

  return (
    <div style={{ padding:'1.5rem 2rem', maxWidth:'1100px', margin:'0 auto' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
        marginBottom:'1.5rem', flexWrap:'wrap', gap:'0.75rem' }}>
        <div>
          <h1 style={{ margin:0, fontSize:'1.5rem', fontWeight:800 }}>Clean-Core Analyses</h1>
          <div style={{ fontSize:'0.85rem', color:'var(--ncs-muted)', marginTop:'0.25rem' }}>
            AI-powered ABAP object assessments
          </div>
        </div>
        <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
          <select className="ncs-input" value={filterProject}
            onChange={e => setFilterProject(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="ncs-btn ncs-btn--primary" onClick={() => setShowModal(true)}
            disabled={projects.length === 0}>
            + New Analysis
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:'3rem', color:'var(--ncs-muted)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'3rem', color:'var(--ncs-muted)' }}>
          No analyses yet. Run your first analysis to get started.
        </div>
      ) : (
        filtered.map(a => (
          <AnalysisCard
            key={a.id}
            analysis={a}
            projectName={projectMap[a.project_id] ?? `Project ${a.project_id}`}
            onRefresh={load}
          />
        ))
      )}

      {showModal && (
        <RunModal projects={projects} onClose={() => setShowModal(false)} onDone={load} />
      )}
    </div>
  );
}
