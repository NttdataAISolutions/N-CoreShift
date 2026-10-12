import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

interface DashboardData {
  total_projects: number;
  total_objects: number;
  total_analyses: number;
  total_plans: number;
  total_artifacts: number;
  approved_plans: number;
  generated_artifacts: number;
  disposition_breakdown: Record<string, number>;
  risk_breakdown: Record<string, number>;
}

interface Project {
  id: number;
  name: string;
  source_system: string;
  target_system: string;
  status: string;
  object_count: number;
}

interface Analysis {
  id: number;
  label: string;
  project_id: number;
  project_name: string;
  status: string;
  created_at: string;
  object_count: number;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    Active: 'ready',
    Ready: 'ready',
    Complete: 'complete',
    Completed: 'complete',
    Incomplete: 'incomplete',
    Draft: 'neutral',
    Archived: 'neutral',
    Blocked: 'danger',
  };
  return `ncs-badge ncs-badge--${map[s] ?? 'neutral'}`;
}

export default function HomePage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [dRes, pRes, aRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/projects'),
          fetch('/api/analyses'),
        ]);
        const [dJson, pJson, aJson] = await Promise.all([
          dRes.json(),
          pRes.json(),
          aRes.json(),
        ]);
        if (dJson.success) setDashboard(dJson.data);
        if (pJson.success) setProjects(pJson.data);
        if (aJson.success) setAnalyses(aJson.data.slice(0, 5));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const dist = dashboard?.disposition_breakdown ?? {};
  const risk = dashboard?.risk_breakdown ?? {};
  const distTotal = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  const riskTotal = Object.values(risk).reduce((a, b) => a + b, 0) || 1;

  const distKeys = [
    { key: 'Retire', label: 'Retire', cls: 'retire' },
    { key: 'Replace', label: 'Replace', cls: 'replace' },
    { key: 'Refactor', label: 'Refactor', cls: 'refactor' },
    { key: 'Replatform', label: 'Replatform', cls: 'replatform' },
  ];

  return (
    <div className="ncs-page">
      <div className="ncs-page__header">
        <h1 className="ncs-page__title">&#x2B21; N-CoreShift Portfolio</h1>
        <p className="ncs-page__subtitle">AI-powered SAP custom code modernization platform</p>
      </div>

      <div className="ncs-grid ncs-grid--5">
        <div className="ncs-card">
          <div className="ncs-card__title">Projects</div>
          <div className="ncs-card__value">{loading ? '—' : (dashboard?.total_projects ?? 0)}</div>
          <div className="ncs-card__sub">total projects</div>
        </div>
        <div className="ncs-card">
          <div className="ncs-card__title">Custom Objects</div>
          <div className="ncs-card__value">{loading ? '—' : (dashboard?.total_objects ?? 0).toLocaleString()}</div>
          <div className="ncs-card__sub">across all projects</div>
        </div>
        <div className="ncs-card">
          <div className="ncs-card__title">Analyses Run</div>
          <div className="ncs-card__value">{loading ? '—' : (dashboard?.total_analyses ?? 0)}</div>
          <div className="ncs-card__sub">total scans</div>
        </div>
        <div className="ncs-card">
          <div className="ncs-card__title">Awaiting Approval</div>
          <div className="ncs-card__value" style={{ color: 'var(--ncs-warning)' }}>
            {loading ? '—' : (dashboard?.total_plans ?? 0) - (dashboard?.approved_plans ?? 0)}
          </div>
          <div className="ncs-card__sub">plans pending review</div>
        </div>
        <div className="ncs-card">
          <div className="ncs-card__title">Code-Gen Ready</div>
          <div className="ncs-card__value" style={{ color: 'var(--ncs-success)' }}>
            {loading ? '—' : (dashboard?.generated_artifacts ?? 0)}
          </div>
          <div className="ncs-card__sub">artifacts generated</div>
        </div>
      </div>

      <div className="ncs-grid ncs-grid--2 ncs-mt-3" style={{ gap: '1.5rem' }}>
        <div>
          <div className="ncs-section__title">Active Projects</div>
          {loading ? (
            <div className="ncs-card" style={{ color: 'var(--ncs-muted)', fontSize: '0.85rem' }}>Loading…</div>
          ) : projects.length === 0 ? (
            <div className="ncs-card" style={{ color: 'var(--ncs-muted)', fontSize: '0.85rem' }}>No projects yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {projects.map(p => (
                <div key={p.id} className="ncs-card" style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{p.name}</div>
                      {(p.source_system || p.target_system) && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--ncs-muted)' }}>
                          {p.source_system}{p.source_system && p.target_system ? ' \u2192 ' : ''}{p.target_system}
                        </div>
                      )}
                    </div>
                    <span className={statusBadge(p.status)}>{p.status}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--ncs-muted)' }}>
                    <span>&#x1F4E6; {p.object_count.toLocaleString()} objects</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <div className="ncs-section__title">4-R Disposition Distribution</div>
            <div className="ncs-card">
              {Object.keys(dist).length === 0 ? (
                <div style={{ color: 'var(--ncs-muted)', fontSize: '0.85rem' }}>No disposition data yet.</div>
              ) : (
                <>
                  <div className="ncs-dist">
                    {distKeys.map(d => {
                      const n = dist[d.key] ?? 0;
                      return n > 0 ? (
                        <div
                          key={d.key}
                          className={`ncs-dist__seg ncs-dist__seg--${d.cls}`}
                          style={{ width: `${(n / distTotal) * 100}%` }}
                        />
                      ) : null;
                    })}
                  </div>
                  <div className="ncs-dist-legend" style={{ marginTop: '0.75rem' }}>
                    {distKeys.map(d => (
                      <div key={d.key} className="ncs-dist-legend__item">
                        <div className={`ncs-dist-legend__dot ncs-dist-legend__dot--${d.cls}`} />
                        {d.label}: <strong>{dist[d.key] ?? 0}</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <div className="ncs-section__title">Risk Profile</div>
            <div className="ncs-card">
              {[
                { label: 'High Risk', key: 'High', cls: 'danger', bar: 'danger' },
                { label: 'Medium Risk', key: 'Medium', cls: 'warning', bar: 'warning' },
                { label: 'Low Risk', key: 'Low', cls: 'success', bar: 'success' },
              ].map(r => {
                const n = risk[r.key] ?? 0;
                return (
                  <div key={r.label} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.2rem' }}>
                      <span style={{ color: 'var(--ncs-muted)' }}>{r.label}</span>
                      <span className={`ncs-badge ncs-badge--${r.cls}`}>{n}</span>
                    </div>
                    <div className="ncs-progress">
                      <div
                        className={`ncs-progress__bar ncs-progress__bar--${r.bar}`}
                        style={{ width: `${(n / riskTotal) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {user && (
            <div className="ncs-card ncs-home-card--user">
              <div className="ncs-section__title">Signed In</div>
              <div className="ncs-home-user__name">{user.name}</div>
              <div className="ncs-home-user__email">{user.email}</div>
              <div className="ncs-home-user__roles">Roles: {user.roles.join(', ')}</div>
            </div>
          )}
        </div>
      </div>

      <div className="ncs-section">
        <div className="ncs-section__title">Recent Analyses</div>
        {loading ? (
          <div className="ncs-card" style={{ color: 'var(--ncs-muted)', fontSize: '0.85rem' }}>Loading…</div>
        ) : analyses.length === 0 ? (
          <div className="ncs-card" style={{ color: 'var(--ncs-muted)', fontSize: '0.85rem' }}>No analyses yet.</div>
        ) : (
          <div className="ncs-table-wrap">
            <table className="ncs-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Project</th>
                  <th>Objects</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map(a => (
                  <tr key={a.id}>
                    <td className="ncs-table__name">{a.label}</td>
                    <td>{a.project_name}</td>
                    <td>{a.object_count}</td>
                    <td>
                      <span
                        className={`ncs-badge ncs-badge--${
                          a.status === 'Complete'
                            ? 'complete'
                            : a.status === 'Running'
                            ? 'in-progress'
                            : a.status === 'Failed'
                            ? 'danger'
                            : 'neutral'
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="ncs-table__mono">{a.created_at ? a.created_at.split('T')[0] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
