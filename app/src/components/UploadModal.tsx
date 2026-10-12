import React, { useState, useRef } from 'react';
import { useAppStore } from '../store/AppStoreContext';

export function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded?: () => void }) {
  const { state } = useAppStore();
  const { projects, activeProjectId } = state;
  const [selId, setSelId] = useState(activeProjectId ?? projects[0]?.id ?? '');
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const ref = React.useRef(null);

  async function resolveBackendId(name) {
    try {
      const r = await fetch('/api/projects');
      const j = await r.json();
      const list = Array.isArray(j.data) ? j.data : [];
      const found = list.find(p => p.name === name);
      if (found) return found.id;
      const cr = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: 'Auto-created' }) });
      const cj = await cr.json();
      return cj?.data?.id ?? null;
    } catch { return null; }
  }

  function addFiles(fl) {
    if (!fl) return;
    const ok = ['abap','prog','class','fugr','badi','enho','txt','inc'];
    const acc = []; let skip = 0;
    Array.from(fl).forEach(f => { const e = f.name.split('.').pop()?.toLowerCase() ?? ''; if (ok.includes(e)) acc.push(f); else skip++; });
    if (skip) alert(skip + ' file(s) skipped.');
    setFiles(prev => { const ex = new Set(prev.map(f => f.name)); return [...prev, ...acc.filter(f => !ex.has(f.name))]; });
  }

  async function doUpload() {
    if (!selId || !files.length) return;
    const proj = projects.find(p => p.id === selId);
    if (!proj) return;
    setUploading(true);
    setResults(files.map(f => ({ fileName: f.name, status: 'pending' })));
    const bid = await resolveBackendId(proj.name);
    if (!bid) { setResults(files.map(f => ({ fileName: f.name, status: 'error', message: 'Backend error' }))); setUploading(false); return; }
    for (const file of files) {
      setResults(p => p.map(r => r.fileName === file.name ? { ...r, status: 'uploading' } : r));
      try {
        const fd = new FormData(); fd.append('file', file);
        const resp = await fetch('/api/projects/' + bid + '/objects/upload', { method: 'POST', body: fd });
        const json = await resp.json();
        if (resp.ok && json.success)
          setResults(p => p.map(r => r.fileName === file.name ? { ...r, status: 'success', linesOfCode: json.data?.lines_of_code } : r));
        else
          setResults(p => p.map(r => r.fileName === file.name ? { ...r, status: 'error', message: json.detail ?? 'Failed' } : r));
      } catch { setResults(p => p.map(r => r.fileName === file.name ? { ...r, status: 'error', message: 'Network error' } : r)); }
    }
    setUploading(false);
  }

  const done = results.length > 0 && results.every(r => r.status === 'success' || r.status === 'error');
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const icon = s => s === 'success' ? '[OK]' : s === 'error' ? '[ERR]' : s === 'uploading' ? '[..]' : '[ ]';
  const exts = ['.abap','.prog','.class','.fugr','.badi','.enho','.txt','.inc'];
  const ov = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' };
  const md = { background: 'var(--ncs-surface)', border: '1px solid var(--ncs-border)', borderRadius: '12px', padding: '1.75rem', width: '100%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 48px rgba(0,0,0,.4)' };
  const inpS = { width: '100%', boxSizing: 'border-box', padding: '.45rem .6rem', border: '1px solid var(--ncs-border)', borderRadius: '6px', background: 'var(--ncs-bg)', color: 'var(--ncs-text)', fontSize: '.88rem' };
  const lblS = { display: 'block', fontSize: '.77rem', fontWeight: 600, color: 'var(--ncs-muted)', marginBottom: '.25rem' };

  return (
    <div style={ov} onClick={e => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <div style={md} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
          <h2 style={{ margin:0, fontSize:'1.15rem', fontWeight:700 }}>Upload ABAP Source Files</h2>
          {!uploading && <button onClick={onClose} style={{ background:'none', border:'none', fontSize:'1.4rem', cursor:'pointer', color:'var(--ncs-muted)' }}>X</button>}
        </div>
        <div style={{ marginBottom:'1.25rem' }}>
          <label style={lblS}>Target Project</label>
          {projects.length === 0
            ? <div style={{ fontSize:'.85rem', color:'var(--ncs-danger)', padding:'.5rem .75rem', background:'rgba(220,53,69,.1)', borderRadius:'6px' }}>No projects found.</div>
            : <select style={inpS} value={selId} onChange={e => setSelId(e.target.value)} disabled={uploading}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          }
        </div>
        <div style={{ fontSize:'.78rem', color:'var(--ncs-muted)', marginBottom:'1rem', display:'flex', gap:'.4rem', flexWrap:'wrap' }}>
          <span style={{ fontWeight:600 }}>Accepted:</span>
          {exts.map(e => <span key={e} style={{ padding:'.1rem .4rem', background:'var(--ncs-bg)', border:'1px solid var(--ncs-border)', borderRadius:'4px', fontFamily:'monospace', fontSize:'.76rem' }}>{e}</span>)}
        </div>
        {!done && (
          <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);addFiles(e.dataTransfer.files);}} onClick={()=>{if(!uploading)ref.current?.click();}}
            style={{ border:'2px dashed '+(drag?'#3b82f6':'var(--ncs-border)'), borderRadius:'10px', padding:'2rem 1rem', textAlign:'center', cursor:uploading?'not-allowed':'pointer', marginBottom:'1.25rem', background:drag?'rgba(59,130,246,.06)':'var(--ncs-bg)' }}>
            <div style={{ fontWeight:600, fontSize:'.9rem', marginBottom:'.25rem' }}>{uploading?'Uploading...':'Drag and drop or click to browse'}</div>
            <div style={{ fontSize:'.8rem', color:'var(--ncs-muted)' }}>Multiple files supported</div>
            <input ref={ref} type="file" multiple accept=".abap,.prog,.class,.fugr,.badi,.enho,.txt,.inc" style={{ display:'none' }} onChange={e=>addFiles(e.target.files)} />
          </div>
        )}
        {files.length > 0 && (
          <div style={{ marginBottom:'1.25rem' }}>
            <div style={{ fontSize:'.8rem', fontWeight:600, color:'var(--ncs-muted)', marginBottom:'.5rem' }}>{files.length} file{files.length!==1?'s':''} selected</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'.4rem', maxHeight:'200px', overflowY:'auto' }}>
              {files.map(f => {
                const res = results.find(r => r.fileName === f.name);
                const bg = res?.status==='success'?'rgba(34,197,94,.08)':res?.status==='error'?'rgba(220,53,69,.08)':'var(--ncs-bg)';
                return (
                  <div key={f.name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'.75rem', padding:'.45rem .75rem', background:bg, border:'1px solid var(--ncs-border)', borderRadius:'6px', fontSize:'.83rem' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'.5rem', minWidth:0 }}>
                      <span style={{ fontFamily:'monospace', fontSize:'.75rem' }}>{icon(res?.status??'pending')}</span>
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'.5rem', flexShrink:0 }}>
                      {res?.status==='success'&&res.linesOfCode!=null&&<span style={{ fontSize:'.75rem', color:'var(--ncs-muted)' }}>{res.linesOfCode} lines</span>}
                      {res?.status==='error'&&<span style={{ fontSize:'.75rem', color:'var(--ncs-danger)' }}>{res.message}</span>}
                      {!uploading&&!done&&<button onClick={()=>{setFiles(p=>p.filter(x=>x.name!==f.name));setResults(p=>p.filter(r=>r.fileName!==f.name));}} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--ncs-muted)', fontSize:'1rem' }}>X</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {done && (
          <div style={{ padding:'.75rem', background:errorCount>0?'rgba(220,53,69,.08)':'rgba(34,197,94,.08)', border:'1px solid var(--ncs-border)', borderRadius:'8px', marginBottom:'1.25rem', fontSize:'.88rem' }}>
            {successCount} uploaded{errorCount>0?' | '+errorCount+' failed':''}
          </div>
        )}
        <div style={{ display:'flex', gap:'.75rem', justifyContent:'flex-end' }}>
          {!uploading&&<button onClick={onClose} style={{ padding:'.5rem 1.25rem', border:'1px solid var(--ncs-border)', borderRadius:'6px', background:'var(--ncs-bg)', cursor:'pointer', fontSize:'.88rem' }}>Cancel</button>}
          {!done&&<button onClick={doUpload} disabled={uploading||!selId||!files.length||projects.length===0} style={{ padding:'.5rem 1.25rem', border:'none', borderRadius:'6px', background:(uploading||!selId||!files.length)?'#555':'#3b82f6', color:'#fff', cursor:(uploading||!selId||!files.length)?'not-allowed':'pointer', fontSize:'.88rem', fontWeight:600 }}>{uploading?'Uploading...':'Upload '+files.length+' File'+(files.length!==1?'s':'')}</button>}
          {done&&<button onClick={()=>{ onUploaded?.(); onClose(); }} style={{ padding:'.5rem 1.25rem', border:'none', borderRadius:'6px', background:'#3b82f6', color:'#fff', cursor:'pointer', fontSize:'.88rem', fontWeight:600 }}>Done</button>}
        </div>
      </div>
    </div>
  );
}
