import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type MockProject, type MockLandscape, type CleanCorePosture } from '../data/mockData';
import { useAppStore } from '../store/AppStoreContext';
import { DEPLOYMENT_MODELS, EXTENSIBILITY_TIERS, COMMON_EXTENSIONS, iStyle, Field } from './LandscapeModals';

const SRC_EDITIONS = ['ECC 6.0 EhP8','ECC 6.0 EhP7','S/4HANA On-Premise 2020','S/4HANA On-Premise 2021','S/4HANA On-Premise 2022','S/4HANA On-Premise 2023','Other'];
const TGT_EDITIONS = ['S/4HANA Cloud Public Edition','S/4HANA Cloud Private Edition','S/4HANA On-Premise','BTP + S/4HANA Cloud Public Edition','Other'];
const TGT_RELS = ['2502','2408','2023','2022','2021'];
const DB_PLATS = ['SAP HANA 2.0','Oracle 19c','MS SQL Server 2019','IBM DB2','MaxDB','Other'];
const POSTURES: CleanCorePosture[] = ['Compliant','Tolerated','Custom'];
const STEP_LABELS = ['Basics','Source System','Target System','Strategy & Gov'];

interface WD {
  name:string; client:string;
  srcName:string; srcRelease:string; srcEdition:string; srcDb:string; srcId:string;
  tgtEdition:string; tgtRelease:string; tgtDeploy:string; tgtTier:string;
  posture:CleanCorePosture; retireThr:number; exts:string; approvers:string; dual:boolean; policyVer:string;
}
const INIT:WD = {
  name:'',client:'',
  srcName:'',srcRelease:'',srcEdition:SRC_EDITIONS[0],srcDb:DB_PLATS[0],srcId:'',
  tgtEdition:TGT_EDITIONS[0],tgtRelease:TGT_RELS[0],tgtDeploy:DEPLOYMENT_MODELS[0],tgtTier:EXTENSIBILITY_TIERS[0],
  posture:'Compliant',retireThr:0,exts:'RAP Business Objects, Fiori Elements, BAdI Implementations',
  approvers:'Project Lead, Clean Core Architect',dual:true,policyVer:'v1.0',
};

function StepBar({cur}:{cur:number}) {
  return (
    <div style={{display:'flex',alignItems:'center',marginBottom:'1.5rem'}}>
      {STEP_LABELS.map((lbl,i)=>{
        const done=i<cur, active=i===cur;
        return (
          <React.Fragment key={lbl}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1}}>
              <div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.78rem',fontWeight:700,background:done?'var(--ncs-success)':active?'var(--ncs-primary)':'var(--ncs-border)',color:done||active?'#fff':'var(--ncs-muted)'}}>
                {done?'✓':i+1}
              </div>
              <div style={{fontSize:'0.68rem',marginTop:'0.3rem',fontWeight:active?700:400,color:active?'var(--ncs-text)':'var(--ncs-muted)',whiteSpace:'nowrap'}}>{lbl}</div>
            </div>
            {i<STEP_LABELS.length-1&&<div style={{flex:1,height:2,minWidth:12,marginBottom:'1rem',background:done?'var(--ncs-success)':'var(--ncs-border)'}}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Wizard({onClose,onSave}:{onClose:()=>void;onSave:(p:MockProject,l:MockLandscape)=>void}) {
  const [step,setStep]=useState(0);
  const [d,setD]=useState<WD>(INIT);
  const [errs,setErrs]=useState<Partial<Record<keyof WD,string>>>({});

  function upd<K extends keyof WD>(f:K,v:WD[K]){setD(p=>({...p,[f]:v}));setErrs(p=>({...p,[f]:undefined}));}

  function ok(){
    const e:Partial<Record<keyof WD,string>>={};
    if(step===0){if(!d.name.trim())e.name='Required';if(!d.client.trim())e.client='Required';}
    if(step===1){if(!d.srcName.trim())e.srcName='Required';if(!d.srcRelease.trim())e.srcRelease='Required';}
    setErrs(e);return Object.keys(e).length===0;
  }

  function toggleExt(x:string){
    const cur=d.exts.split(',').map(s=>s.trim()).filter(Boolean);
    upd('exts',( cur.includes(x)?cur.filter(c=>c!==x):[...cur,x]).join(', '));
  }

  function submit(){
    if(!ok())return;
    const now=new Date().toISOString().split('T')[0];
    const iso=new Date().toISOString();
    const id=`proj-${Date.now()}`;
    const proj:MockProject={id,name:d.name.trim(),client:d.client.trim(),sourceSystem:d.srcEdition,targetEdition:d.tgtEdition,readinessState:'Not Started',objectCount:0,analysisCount:0,plansCount:0,lastActivity:now};
    const ls:MockLandscape={
      projectId:id,
      sourceSystem:{name:d.srcName.trim(),release:d.srcRelease.trim(),edition:d.srcEdition,dbPlatform:d.srcDb,instanceId:d.srcId.trim()||'—'},
      targetSystem:{edition:d.tgtEdition,release:d.tgtRelease,deploymentModel:d.tgtDeploy,extensibilityTier:d.tgtTier},
      cleanCoreStrategy:{posture:d.posture,allowedExtensions:d.exts.split(',').map(s=>s.trim()).filter(Boolean),retireThreshold:d.retireThr},
      governance:{approverRoles:d.approvers.split(',').map(s=>s.trim()).filter(Boolean),requiresDualApproval:d.dual,policyVersion:d.policyVer.trim()||'v1.0'},
      readinessChecks:[
        {id:'r1',label:'Source system profile complete',status:'pass',detail:'All required fields populated'},
        {id:'r2',label:'Target system profile complete',status:'pass',detail:'Edition, release and deployment model confirmed'},
        {id:'r3',label:'Clean Core policy defined',status:'pass',detail:`Posture: ${d.posture}`},
        {id:'r4',label:'Governance approvers configured',status:'pass',detail:`${d.approvers.split(',').map(s=>s.trim()).filter(Boolean).length} approver role(s)`},
        {id:'r5',label:'Source code uploaded',status:'pending',detail:'No source code uploaded yet'},
        {id:'r6',label:'Vector embeddings indexed',status:'pending',detail:'Cannot index — source code missing'},
        {id:'r7',label:'BTP destination configured',status:'pending',detail:'BTP sub-account not yet configured'},
      ],
      versions:[{version:d.policyVer.trim()||'v1.0',changedBy:'You',changedAt:iso,summary:'Initial landscape profile created via New Project wizard'}],
    };
    onSave(proj,ls);
  }

  const s={...iStyle,cursor:'pointer'};
  const ea={fontSize:'0.75rem',color:'var(--ncs-danger)',marginTop:'0.25rem'};
  const gap={display:'flex',flexDirection:'column' as const,gap:'0.85rem'};
  const extActive=d.exts.split(',').map(x=>x.trim()).filter(Boolean);

  const stepViews=[
    // Step 0 – Basics
    <div key="s0" style={gap}>
      <Field label="Project Name *">
        <input style={{...iStyle,borderColor:errs.name?'var(--ncs-danger)':undefined}} placeholder="e.g. Acme Corp – S/4HANA Rise Migration" value={d.name} onChange={e=>upd('name',e.target.value)} autoFocus/>
        {errs.name&&<div style={ea}>{errs.name}</div>}
      </Field>
      <Field label="Client *">
        <input style={{...iStyle,borderColor:errs.client?'var(--ncs-danger)':undefined}} placeholder="e.g. Acme Corporation" value={d.client} onChange={e=>upd('client',e.target.value)}/>
        {errs.client&&<div style={ea}>{errs.client}</div>}
      </Field>
    </div>,

    // Step 1 – Source System
    <div key="s1" style={gap}>
      <Field label="System Name *">
        <input style={{...iStyle,borderColor:errs.srcName?'var(--ncs-danger)':undefined}} placeholder="e.g. Acme PRD" value={d.srcName} onChange={e=>upd('srcName',e.target.value)} autoFocus/>
        {errs.srcName&&<div style={ea}>{errs.srcName}</div>}
      </Field>
      <Field label="SAP Release *">
        <input style={{...iStyle,borderColor:errs.srcRelease?'var(--ncs-danger)':undefined}} placeholder="e.g. SAP ERP 6.0 EhP8" value={d.srcRelease} onChange={e=>upd('srcRelease',e.target.value)}/>
        {errs.srcRelease&&<div style={ea}>{errs.srcRelease}</div>}
      </Field>
      <Field label="Edition">
        <select style={s} value={d.srcEdition} onChange={e=>upd('srcEdition',e.target.value)}>
          {SRC_EDITIONS.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Database Platform">
        <select style={s} value={d.srcDb} onChange={e=>upd('srcDb',e.target.value)}>
          {DB_PLATS.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Instance ID (optional)">
        <input style={iStyle} placeholder="e.g. PRD/000" value={d.srcId} onChange={e=>upd('srcId',e.target.value)}/>
      </Field>
    </div>,

    // Step 2 – Target System
    <div key="s2" style={gap}>
      <Field label="Target Edition *">
        <select style={s} value={d.tgtEdition} onChange={e=>upd('tgtEdition',e.target.value)}>
          {TGT_EDITIONS.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Target Release">
        <select style={s} value={d.tgtRelease} onChange={e=>upd('tgtRelease',e.target.value)}>
          {TGT_RELS.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Deployment Model">
        <select style={s} value={d.tgtDeploy} onChange={e=>upd('tgtDeploy',e.target.value)}>
          {DEPLOYMENT_MODELS.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Extensibility Tier">
        <select style={s} value={d.tgtTier} onChange={e=>upd('tgtTier',e.target.value)}>
          {EXTENSIBILITY_TIERS.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    </div>,

    // Step 3 – Strategy & Governance
    <div key="s3" style={gap}>
      <Field label="Clean Core Posture">
        <select style={s} value={d.posture} onChange={e=>upd('posture',e.target.value as CleanCorePosture)}>
          {POSTURES.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Retire Threshold (months)">
        <input style={iStyle} type="number" min={0} value={d.retireThr} onChange={e=>upd('retireThr',Number(e.target.value))}/>
      </Field>
      <Field label="Allowed Extensions">
        <div style={{display:'flex',flexWrap:'wrap',gap:'0.4rem',marginBottom:'0.4rem'}}>
          {COMMON_EXTENSIONS.map(x=>{
            const on=extActive.includes(x);
            return (
              <button key={x} onClick={()=>toggleExt(x)} style={{padding:'0.2rem 0.55rem',borderRadius:4,border:'1px solid',borderColor:on?'var(--ncs-primary)':'var(--ncs-border)',background:on?'var(--ncs-primary)':'transparent',color:on?'#fff':'var(--ncs-text)',fontSize:'0.72rem',cursor:'pointer'}}>
                {x}
              </button>
            );
          })}
        </div>
        <input style={iStyle} placeholder="Or type comma-separated values" value={d.exts} onChange={e=>upd('exts',e.target.value)}/>
      </Field>
      <Field label="Approver Roles (comma-separated)">
        <input style={iStyle} placeholder="e.g. Project Lead, Clean Core Architect" value={d.approvers} onChange={e=>upd('approvers',e.target.value)}/>
      </Field>
      <Field label="Policy Version">
        <input style={iStyle} placeholder="e.g. v1.0" value={d.policyVer} onChange={e=>upd('policyVer',e.target.value)}/>
      </Field>
      <Field label="">
        <label style={{display:'flex',alignItems:'center',gap:'0.5rem',cursor:'pointer',fontSize:'0.88rem'}}>
          <input type="checkbox" checked={d.dual} onChange={e=>upd('dual',e.target.checked)}/>
          Require dual approval
        </label>
      </Field>
    </div>,
  ];

  return (
    <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}}>
      <div style={{background:'var(--ncs-surface)',borderRadius:12,width:'100%',maxWidth:520,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        {/* Fixed header */}
        <div style={{padding:'1.5rem 2rem 0',flexShrink:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
            <h2 style={{margin:0,fontSize:'1.15rem',fontWeight:700}}>New Project</h2>
            <button onClick={onClose} style={{background:'none',border:'none',fontSize:'1.4rem',cursor:'pointer',color:'var(--ncs-muted)',lineHeight:1}}>&times;</button>
          </div>
          <StepBar cur={step}/>
        </div>
        {/* Scrollable body */}
        <div style={{flex:1,overflowY:'auto',padding:'0 2rem'}}>
          {stepViews[step]}
        </div>
        {/* Fixed footer */}
        <div style={{padding:'1rem 2rem 1.5rem',flexShrink:0,borderTop:'1px solid var(--ncs-border)',display:'flex',justifyContent:'space-between',gap:'0.75rem'}}>
          <button onClick={step===0?onClose:()=>setStep(s=>s-1)} style={{padding:'0.5rem 1.25rem',border:'1px solid var(--ncs-border)',borderRadius:6,background:'transparent',color:'var(--ncs-text)',cursor:'pointer',fontSize:'0.88rem'}}>
            {step===0?'Cancel':'Back'}
          </button>
          {step<STEP_LABELS.length-1
            ?<button onClick={()=>{if(ok())setStep(s=>s+1);}} style={{padding:'0.5rem 1.25rem',borderRadius:6,border:'none',background:'var(--ncs-primary)',color:'#fff',cursor:'pointer',fontSize:'0.88rem',fontWeight:600}}>Next</button>
            :<button onClick={submit} style={{padding:'0.5rem 1.25rem',borderRadius:6,border:'none',background:'var(--ncs-success)',color:'#fff',cursor:'pointer',fontSize:'0.88rem',fontWeight:600}}>Create Project</button>
          }
        </div>
      </div>
    </div>
  );
}

// ── Project card ───────────────────────────────────────────────────────────

const STATE_COLORS: Record<string,string> = {
  'Not Started':'var(--ncs-muted)',
  'In Progress':'var(--ncs-warning)',
  'Ready for Approval':'var(--ncs-primary)',
  'Approved':'var(--ncs-success)',
  'Rejected':'var(--ncs-danger)',
};

function ProjectCard({proj,onClick}:{proj:MockProject;onClick:()=>void}) {
  const sc=STATE_COLORS[proj.readinessState]||'var(--ncs-muted)';
  return (
    <div onClick={onClick} style={{background:'var(--ncs-surface)',border:'1px solid var(--ncs-border)',borderRadius:10,padding:'1.25rem 1.5rem',cursor:'pointer',transition:'box-shadow 0.15s',display:'flex',flexDirection:'column',gap:'0.6rem'}}
      onMouseEnter={e=>(e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,0.12)')}
      onMouseLeave={e=>(e.currentTarget.style.boxShadow='none')}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'0.75rem'}}>
        <div>
          <div style={{fontWeight:700,fontSize:'1rem',marginBottom:'0.2rem'}}>{proj.name}</div>
          <div style={{fontSize:'0.82rem',color:'var(--ncs-muted)'}}>{proj.client}</div>
        </div>
        <span style={{padding:'0.25rem 0.65rem',borderRadius:20,fontSize:'0.72rem',fontWeight:600,background:sc+'22',color:sc,whiteSpace:'nowrap'}}>
          {proj.readinessState}
        </span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.4rem 1rem',fontSize:'0.8rem',color:'var(--ncs-muted)'}}>
        <span>Source: <strong style={{color:'var(--ncs-text)'}}>{proj.sourceSystem}</strong></span>
        <span>Target: <strong style={{color:'var(--ncs-text)'}}>{proj.targetEdition}</strong></span>
        <span>Objects: <strong style={{color:'var(--ncs-text)'}}>{proj.objectCount}</strong></span>
        <span>Analyses: <strong style={{color:'var(--ncs-text)'}}>{proj.analysisCount}</strong></span>
      </div>
      <div style={{fontSize:'0.75rem',color:'var(--ncs-muted)',borderTop:'1px solid var(--ncs-border)',paddingTop:'0.5rem'}}>
        Last activity: {proj.lastActivity}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { state, addProject, addLandscape } = useAppStore();
  const { projects } = state;
  const [showWizard, setShowWizard] = useState(false);
  const [search, setSearch] = useState('');

  function handleSave(proj: MockProject, landscape: MockLandscape) {
    addProject(proj);
    addLandscape(landscape);
    setShowWizard(false);
    navigate(`/projects/${proj.id}`);
  }

  const filtered = projects.filter((p: MockProject) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.client.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{padding:'2rem',maxWidth:1100,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem',flexWrap:'wrap',gap:'0.75rem'}}>
        <div>
          <h1 style={{margin:0,fontSize:'1.5rem',fontWeight:800}}>Projects</h1>
          <p style={{margin:'0.25rem 0 0',color:'var(--ncs-muted)',fontSize:'0.88rem'}}>{projects.length} project{projects.length!==1?'s':''}</p>
        </div>
        <div style={{display:'flex',gap:'0.75rem',alignItems:'center'}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects…"
            style={{...iStyle,width:220,padding:'0.45rem 0.75rem'}}/>
          <button onClick={()=>setShowWizard(true)}
            style={{padding:'0.5rem 1.25rem',borderRadius:8,border:'none',background:'var(--ncs-primary)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:'0.88rem',whiteSpace:'nowrap'}}>
            + New Project
          </button>
        </div>
      </div>

      {filtered.length===0?(
        <div style={{textAlign:'center',padding:'4rem 2rem',color:'var(--ncs-muted)'}}>
          {search?'No projects match your search.':'No projects yet. Click "+ New Project" to get started.'}
        </div>
      ):(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:'1rem'}}>
          {filtered.map((p: MockProject)=>(
            <ProjectCard key={p.id} proj={p} onClick={()=>navigate(`/projects/${p.id}`)}/>
          ))}
        </div>
      )}

      {showWizard&&<Wizard onClose={()=>setShowWizard(false)} onSave={handleSave}/>}
    </div>
  );
}
