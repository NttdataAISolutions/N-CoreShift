import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MOCK_INVENTORY, MOCK_OBJECT_DETAIL } from '../data/mockData';

const RISK: Record<string, string> = { High: 'danger', Medium: 'warning', Low: 'success', Unknown: 'neutral' };
const DISP: Record<string, string> = { Retire: 'retire', Replace: 'replace', Refactor: 'refactor', Replatform: 'replatform', Pending: 'neutral' };
const STEP: Record<string, string> = { Done: 'success', 'In Progress': 'in-progress', Todo: 'neutral' };
const ACT: Record<string, string> = { Approved: 'success', Rejected: 'danger', Submitted: 'warning', Commented: 'neutral', Created: 'info' };

export default function ObjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Look up the base inventory entry for the header (name, type, etc.)
  const base = MOCK_INVENTORY.find(o => o.id === id);
  // Use MOCK_OBJECT_DETAIL for full tab content; overlay header fields from the
  // matched base entry so any row can be drilled into meaningfully.
  const obj = base ? { ...MOCK_OBJECT_DETAIL, ...base } : MOCK_OBJECT_DETAIL;
  const found = Boolean(base);

  type Tab = 'intent' | 'assessment' | 'plan' | 'codegen' | 'history' | 'source';
  const [tab, setTab] = useState<Tab>('intent');

  const tabs: [Tab, string][] = [
    ['intent', '🧠 Intent'], ['assessment', '⚖️ Assessment'], ['plan', '📋 Plan'],
    ['codegen', '💻 Code'], ['history', '📜 History'], ['source', '🗒️ Source'],
  ];

  return (
    <div className="ncs-page">
      <div className="ncs-page__header">
        {!found && (
          <div className="ncs-status-banner ncs-status-banner--warning" style={{ marginBottom: '1rem' }}>
            Object <code>{id}</code> not found in inventory — showing demo data.
          </div>
        )}
        <button className="ncs-btn ncs-btn--ghost ncs-btn--sm" onClick={() => navigate('/object-inventory')} style={{ marginBottom: '0.75rem' }}>
          ← Back to Inventory
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h1 className="ncs-page__title ncs-mono">{obj.name}</h1>
            <p className="ncs-page__subtitle">{obj.type} · {obj.package} · {obj.businessProcess}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <span className={`ncs-badge ncs-badge--${RISK[obj.riskLevel]}`}>{obj.riskLevel} Risk</span>
            <span className={`ncs-badge ncs-badge--${DISP[obj.disposition]}`}>{obj.disposition}</span>
            <span className="ncs-badge ncs-badge--neutral">{obj.confidence}%</span>
          </div>
        </div>
        <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: 'var(--ncs-muted)' }}>{obj.functionalPurpose}</div>
      </div>

      <div className="ncs-tabs">
        {tabs.map(([t, l]) => (
          <button key={t} className={`ncs-tab${tab === t ? ' ncs-tab--active' : ''}`} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      {/* INTENT */}
      {tab === 'intent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="ncs-card">
            <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Summary</div>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{obj.functionalIntent.summary}</p>
          </div>
          <div className="ncs-grid ncs-grid--2" style={{ gap: '1rem' }}>
            <div className="ncs-card">
              <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Business Domain</div>
              <span className="ncs-badge ncs-badge--info">{obj.functionalIntent.businessDomain}</span>
            </div>
            <div className="ncs-card">
              <div className="ncs-section__title" style={{ borderBottom: 'none' }}>SAP Equivalent</div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--ncs-muted)' }}>{obj.functionalIntent.sapEquivalent}</p>
            </div>
            <div className="ncs-card">
              <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Inputs</div>
              <ul className="ncs-list">{obj.functionalIntent.inputs.map(i => <li key={i}>{i}</li>)}</ul>
            </div>
            <div className="ncs-card">
              <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Outputs</div>
              <ul className="ncs-list">{obj.functionalIntent.outputs.map(o => <li key={o}>{o}</li>)}</ul>
            </div>
          </div>
          <div className="ncs-card">
            <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Dependencies</div>
            <div className="ncs-table-wrap">
              <table className="ncs-table">
                <thead><tr><th>Name</th><th>Type</th><th>Direction</th><th>Risk</th></tr></thead>
                <tbody>
                  {obj.dependencies.map(d => (
                    <tr key={d.name}>
                      <td className="ncs-mono">{d.name}</td>
                      <td>{d.type}</td>
                      <td><span className={`ncs-badge ncs-badge--${d.direction === 'Used By' ? 'warning' : 'info'}`}>{d.direction}</span></td>
                      <td><span className={`ncs-badge ncs-badge--${RISK[d.risk]}`}>{d.risk}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ASSESSMENT */}
      {tab === 'assessment' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="ncs-grid ncs-grid--3" style={{ gap: '1rem' }}>
            <div className="ncs-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--ncs-muted)' }}>Clean Core Score</div>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: obj.assessment.score >= 80 ? 'var(--ncs-success)' : obj.assessment.score >= 60 ? 'var(--ncs-warning)' : 'var(--ncs-danger)' }}>{obj.assessment.score}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--ncs-muted)' }}>/ 100</div>
            </div>
            <div className="ncs-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--ncs-muted)' }}>Posture</div>
              <span className={`ncs-badge ncs-badge--${obj.assessment.posture === 'Compliant' ? 'success' : obj.assessment.posture === 'Tolerated' ? 'warning' : 'danger'}`} style={{ fontSize: '0.9rem' }}>{obj.assessment.posture}</span>
            </div>
            <div className="ncs-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--ncs-muted)' }}>Recommended</div>
              <span className={`ncs-badge ncs-badge--${DISP[obj.assessment.disposition]}`} style={{ fontSize: '0.9rem' }}>{obj.assessment.disposition}</span>
            </div>
          </div>
          <div className="ncs-card">
            <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Rationale</div>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{obj.assessment.rationale}</p>
          </div>
          <div className="ncs-card">
            <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Extensibility Mechanism</div>
            <code className="ncs-code-inline">{obj.assessment.extensibilityMechanism}</code>
          </div>
          <div className="ncs-grid ncs-grid--2" style={{ gap: '1rem' }}>
            <div className="ncs-card">
              <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Evidence</div>
              <ul className="ncs-list">{obj.assessment.evidence.map(e => <li key={e}>{e}</li>)}</ul>
            </div>
            <div className="ncs-card">
              <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Gaps</div>
              <ul className="ncs-list ncs-list--warning">{obj.assessment.gaps.map(g => <li key={g}>⚠️ {g}</li>)}</ul>
            </div>
          </div>
        </div>
      )}

      {/* PLAN */}
      {tab === 'plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="ncs-grid ncs-grid--3" style={{ gap: '1rem' }}>
            <div className="ncs-card">
              <dl className="ncs-kv">
                <dt className="ncs-kv__label">Disposition</dt>
                <dd className="ncs-kv__value"><span className={`ncs-badge ncs-badge--${DISP[obj.modernizationPlan.disposition]}`}>{obj.modernizationPlan.disposition}</span></dd>
                <dt className="ncs-kv__label">Approval</dt>
                <dd className="ncs-kv__value"><span className={`ncs-badge ncs-badge--${obj.modernizationPlan.approvalStatus === 'Approved' ? 'success' : 'warning'}`}>{obj.modernizationPlan.approvalStatus}</span></dd>
              </dl>
            </div>
            <div className="ncs-card">
              <dl className="ncs-kv">
                <dt className="ncs-kv__label">Target Tech</dt>
                <dd className="ncs-kv__value">{obj.modernizationPlan.targetTechnology}</dd>
                <dt className="ncs-kv__label">Effort</dt>
                <dd className="ncs-kv__value"><span className={`ncs-badge ncs-badge--${obj.modernizationPlan.effort === 'Low' ? 'success' : obj.modernizationPlan.effort === 'High' ? 'danger' : 'warning'}`}>{obj.modernizationPlan.effort}</span></dd>
              </dl>
            </div>
            <div className="ncs-card">
              <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Risks</div>
              <ul className="ncs-list ncs-list--warning">{obj.modernizationPlan.risks.map(r => <li key={r}>⚠️ {r}</li>)}</ul>
            </div>
          </div>
          <div className="ncs-card">
            <div className="ncs-section__title" style={{ borderBottom: 'none' }}>Implementation Steps</div>
            {obj.modernizationPlan.steps.map(s => (
              <div key={s.order} style={{ display: 'flex', gap: '1rem', padding: '0.75rem 0', borderBottom: '1px solid var(--ncs-border)' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ncs-surface)', border: '2px solid var(--ncs-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700, flexShrink: 0 }}>{s.order}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                    <strong>{s.title}</strong>
                    <span className={`ncs-badge ncs-badge--${STEP[s.status]}`}>{s.status}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--ncs-muted)' }}>{s.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CODEGEN */}
      {tab === 'codegen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {obj.generatedArtifacts.map(art => (
            <div key={art.id} className="ncs-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{art.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--ncs-muted)' }}>{art.type} · {art.language} · {art.lines} lines</div>
                </div>
                <span className={`ncs-badge ncs-badge--${art.status === 'Draft' ? 'warning' : 'success'}`}>{art.status}</span>
              </div>
              <pre className="ncs-code-block">{art.snippet}</pre>
            </div>
          ))}
        </div>
      )}

      {/* HISTORY */}
      {tab === 'history' && (
        <div className="ncs-table-wrap">
          <table className="ncs-table">
            <thead><tr><th>Date</th><th>Actor</th><th>Action</th><th>Comment</th></tr></thead>
            <tbody>
              {obj.decisionHistory.map((h, i) => (
                <tr key={i}>
                  <td className="ncs-table__mono">{h.date.split('T')[0]}</td>
                  <td>{h.actor}</td>
                  <td><span className={`ncs-badge ncs-badge--${ACT[h.action] ?? 'neutral'}`}>{h.action}</span></td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--ncs-muted)' }}>{h.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SOURCE */}
      {tab === 'source' && (
        <div className="ncs-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{obj.name}.abap</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--ncs-muted)' }}>{obj.linesOfCode.toLocaleString()} lines · Last changed {obj.lastChanged}</div>
            </div>
            <span className="ncs-badge ncs-badge--info">ABAP</span>
          </div>
          <pre className="ncs-code-block">{obj.sourceCode}</pre>
        </div>
      )}
    </div>
  );
}
