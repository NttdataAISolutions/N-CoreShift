import React from 'react';
import type { CleanCorePosture } from '../data/mockData';

export const DEPLOYMENT_MODELS = ['RISE with SAP','RISE with SAP (Private Cloud)','BTP Side-by-Side','S/4HANA Cloud Public Edition (direct)','On-Premise Greenfield'];
export const EXTENSIBILITY_TIERS = ['Developer Extensibility (Tier 2)','Key User Extensibility (Tier 1)','Classic Extensibility (Tier 3)','No Extensibility'];
export const POSTURE_OPTIONS: CleanCorePosture[] = ['Compliant', 'Tolerated', 'Custom'];
export const COMMON_EXTENSIONS = ['RAP Business Objects','Fiori Elements','BAdI Implementations','Key User Apps','Classic ABAP (reviewed)','Side-by-Side BTP Extensions'];
export const CHECK_BADGE: Record<string, string> = { pass: 'success', fail: 'danger', warn: 'warning', pending: 'neutral' };
export const CHECK_ICON: Record<string, string> = { pass: '✅', fail: '❌', warn: '⚠️', pending: '⏳' };

export const iStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.65rem',
  borderRadius: '0.4rem', border: '1px solid var(--ncs-border)',
  background: 'var(--ncs-surface)', color: 'var(--ncs-text)', fontSize: '0.875rem',
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ncs-muted)', marginBottom: '0.3rem' }}>{label}</div>
      {children}
    </div>
  );
}

export function KV({ pairs }: { pairs: [string, React.ReactNode][] }) {
  return (
    <dl className="ncs-kv">
      {pairs.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="ncs-kv__label">{k}</dt>
          <dd className="ncs-kv__value">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

interface ModalShellProps { title: string; onClose: () => void; onSave: () => void; children: React.ReactNode; }
export function ModalShell({ title, onClose, onSave, children }: ModalShellProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: 'var(--ncs-card-bg)', borderRadius: '0.75rem', padding: '1.5rem', width: '520px', maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{title}</h3>
          <button className="ncs-btn ncs-btn--ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>{children}</div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
          <button className="ncs-btn ncs-btn--secondary" onClick={onClose}>Cancel</button>
          <button className="ncs-btn ncs-btn--primary" onClick={onSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

export interface SourceDraft { name: string; release: string; edition: string; dbPlatform: string; instanceId: string; }
export interface TargetDraft { edition: string; release: string; deploymentModel: string; extensibilityTier: string; }
export interface StrategyDraft { posture: CleanCorePosture; allowedExtensions: string[]; retireThreshold: number; }
export interface GovDraft { approverRoles: string[]; requiresDualApproval: boolean; policyVersion: string; }

interface SrcProps { draft: SourceDraft; set: React.Dispatch<React.SetStateAction<SourceDraft>>; onClose: () => void; onSave: () => void; }
export function SourceModal({ draft, set, onClose, onSave }: SrcProps) {
  return (
    <ModalShell title="Edit Source System" onClose={onClose} onSave={onSave}>
      <Field label="System Name"><input style={iStyle} value={draft.name} onChange={e => set(d => ({ ...d, name: e.target.value }))} /></Field>
      <Field label="Release"><input style={iStyle} value={draft.release} onChange={e => set(d => ({ ...d, release: e.target.value }))} /></Field>
      <Field label="Edition"><input style={iStyle} value={draft.edition} onChange={e => set(d => ({ ...d, edition: e.target.value }))} /></Field>
      <Field label="Database Platform"><input style={iStyle} value={draft.dbPlatform} onChange={e => set(d => ({ ...d, dbPlatform: e.target.value }))} /></Field>
      <Field label="Instance ID"><input style={iStyle} value={draft.instanceId} onChange={e => set(d => ({ ...d, instanceId: e.target.value }))} /></Field>
    </ModalShell>
  );
}

interface TgtProps { draft: TargetDraft; set: React.Dispatch<React.SetStateAction<TargetDraft>>; onClose: () => void; onSave: () => void; }
export function TargetModal({ draft, set, onClose, onSave }: TgtProps) {
  return (
    <ModalShell title="Edit Target System" onClose={onClose} onSave={onSave}>
      <Field label="Edition"><input style={iStyle} value={draft.edition} onChange={e => set(d => ({ ...d, edition: e.target.value }))} /></Field>
      <Field label="Release"><input style={iStyle} value={draft.release} onChange={e => set(d => ({ ...d, release: e.target.value }))} /></Field>
      <Field label="Deployment Model">
        <select style={{ ...iStyle, cursor: 'pointer' }} value={draft.deploymentModel} onChange={e => set(d => ({ ...d, deploymentModel: e.target.value }))}>
          <option value="">— Select —</option>
          {DEPLOYMENT_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Extensibility Tier">
        <select style={{ ...iStyle, cursor: 'pointer' }} value={draft.extensibilityTier} onChange={e => set(d => ({ ...d, extensibilityTier: e.target.value }))}>
          <option value="">— Select —</option>
          {EXTENSIBILITY_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
    </ModalShell>
  );
}

interface StrProps { draft: StrategyDraft; set: React.Dispatch<React.SetStateAction<StrategyDraft>>; extText: string; setExtText: (v: string) => void; onClose: () => void; onSave: () => void; }
export function StrategyModal({ draft, set, extText, setExtText, onClose, onSave }: StrProps) {
  function toggle(ext: string) {
    const cur = extText.split(',').map(s => s.trim()).filter(Boolean);
    setExtText((cur.includes(ext) ? cur.filter(e => e !== ext) : [...cur, ext]).join(', '));
  }
  return (
    <ModalShell title="Edit Clean Core Strategy" onClose={onClose} onSave={onSave}>
      <Field label="Posture">
        <select style={{ ...iStyle, cursor: 'pointer' }} value={draft.posture} onChange={e => set(d => ({ ...d, posture: e.target.value as CleanCorePosture }))}>
          {POSTURE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Retire Threshold (% usage)">
        <input type="number" min={0} max={100} style={iStyle} value={draft.retireThreshold} onChange={e => set(d => ({ ...d, retireThreshold: parseInt(e.target.value) || 0 }))} />
      </Field>
      <Field label="Allowed Extensions (comma-separated)">
        <input style={iStyle} value={extText} onChange={e => setExtText(e.target.value)} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
          {COMMON_EXTENSIONS.map(ext => {
            const cur = extText.split(',').map(s => s.trim()).filter(Boolean);
            const on = cur.includes(ext);
            return (
              <button key={ext} onClick={() => toggle(ext)} className={`ncs-btn ${on ? 'ncs-btn--primary' : 'ncs-btn--secondary'}`} style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                {on ? '✓ ' : ''}{ext}
              </button>
            );
          })}
        </div>
      </Field>
    </ModalShell>
  );
}

interface GovProps { draft: GovDraft; set: React.Dispatch<React.SetStateAction<GovDraft>>; rolesText: string; setRolesText: (v: string) => void; onClose: () => void; onSave: () => void; }
export function GovernanceModal({ draft, set, rolesText, setRolesText, onClose, onSave }: GovProps) {
  return (
    <ModalShell title="Edit Governance Policy" onClose={onClose} onSave={onSave}>
      <Field label="Policy Version (leave blank to auto-increment)">
        <input style={iStyle} value={draft.policyVersion} placeholder="e.g. v2.0" onChange={e => set(d => ({ ...d, policyVersion: e.target.value }))} />
      </Field>
      <Field label="Approver Roles (comma-separated)">
        <input style={iStyle} value={rolesText} placeholder="e.g. Architect, Lead Developer" onChange={e => setRolesText(e.target.value)} />
      </Field>
      <Field label="">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
          <input type="checkbox" checked={draft.requiresDualApproval} onChange={e => set(d => ({ ...d, requiresDualApproval: e.target.checked }))} />
          Requires dual approval
        </label>
      </Field>
    </ModalShell>
  );
}
