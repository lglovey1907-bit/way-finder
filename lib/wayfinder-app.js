import * as RMAP from './realmap';
import * as IND from './indoor';
// NDLS Wayfinder app logic (ported from the prototype). Data access goes through window.claude, provided by lib/runtime.js.
/* eslint-disable */
export function boot(){

// ================= Station layout (editable by staff in the Layout tab) =================
// Platforms and concourses are fixed bands; gates and foot over bridges come from LAYOUT,
// which staff can edit and save. buildGraph() turns a layout into the walking graph.
const XS=[130,230,330,510,690,790,880];
const PY0=[120,185,250,315,380,445,510,575,640];
// Platform line positions and metres-per-map-unit. A site survey (layout.geo) replaces the schematic values.
let PYS=PY0.slice(), SX=0.6, SY=0.42;
const PY=p=>PYS[p], CPY=62, CAY=704;
const N={}, ADJ={};
const PEN={walk:0,enter:0,plat:0,bridge:0,stairs:18,esc:8,lift:40};
const ALLP=[0,1,2,3,4,5,6,7,8];
const DEFAULT_LAYOUT={v:1,
  gates:[{id:'g1',n:'1',side:'P',x:130,status:'open'},{id:'g2',n:'2',side:'P',x:330,status:'closed'},{id:'g3',n:'3',side:'P',x:510,status:'exit'},{id:'g4',n:'4',side:'P',x:690,status:'entry'},{id:'g5',n:'5',side:'P',x:880,status:'open'},
         {id:'g6',n:'6',side:'A',x:130,status:'open'},{id:'g7',n:'7',side:'A',x:330,status:'open'},{id:'g8',n:'8',side:'A',x:510,status:'main'},{id:'g9',n:'9',side:'A',x:690,status:'open'},{id:'g10',n:'10',side:'A',x:880,status:'open'}],
  fobs:[{id:'fA',name:'Foot Over Bridge 1',shape:'straight',x:348,land:-1,plats:ALLP.slice(),stairs:true,lift:false,esc:false,endP:'stairs',endA:'stairs'},
        {id:'fB',name:'Foot Over Bridge 2',shape:'straight',x:858,land:1,plats:ALLP.slice(),stairs:true,lift:true,esc:false,endP:'esc',endA:'esc'},
        {id:'fC',name:'Foot Over Bridge 3',shape:'zigzag',from:'fB',lobby:780,step:30,plats:[1,2,3,4,5,6,7,8],stairs:true,lift:false,esc:false,endP:'none',endA:'stairs'}]};
let WORKS=[], FSEG={}, MIRROR=false, LAYOUT_REV=0, LAYOUT=null, GATES=[], gateAt={}, FOBS=[], FOB_BY={}, FOB_X={}, HNODES={}, VNODES={}, ZPATH={}, AREA_KEYS=[], PLACEABLE=[];
// A gate is numbered (Gate 5); a station entry has a name (Metro entry). The key links bridges to it.
const gateKey=g=>g.kind==='entry'?(g.name||'Entry'):String(g.n);
const gateText=n=>{n=String(n||'').trim();return /^gate\b/i.test(n)?n:/^[\w-]{1,5}$/.test(n)?'Gate '+n:n||'Gate';};
const gateLabel=g=>g.kind==='entry'?(g.name||'Station entry'):gateText(g.n);
const GATE_TAG={open:'',main:'MAIN',entry:'ENTRY',exit:'EXIT ONLY',closed:'CLOSED'};
const isFob=c=>!!FOB_BY[c];
const isVert=a=>!!(FOB_BY[a]&&FOB_BY[a].shape==='straight');
const isZig=c=>!!(FOB_BY[c]&&(FOB_BY[c].shape==='zigzag'||FOB_BY[c].shape==='path'));
const fobLand=f=>f.x+(+f.land||0)*20;
const zigX=(f,k)=>f.lobby-f.step*k;
const fobShort=f=>String(f.name||'FOB').replace(/foot\s*over\s*bridge/i,'FOB');
const accessWord=f=>f.stairs&&f.lift?'stairs + lift':f.lift?'lift':f.esc&&!f.stairs?'escalator':'stairs';
function nearestXS(x){let b=0;XS.forEach((xx,i)=>{if(Math.abs(xx-x)<Math.abs(XS[b]-x))b=i;});return b;}
function node(id,x,y,ctx,extra){N[id]=Object.assign({id,x,y,ctx},extra||{});ADJ[id]=[];}
function dm(a,b){return Math.hypot((N[a].x-N[b].x)*SX,(N[a].y-N[b].y)*SY);}
function edge(a,b,kind,extra){if(!N[a]||!N[b]||a===b)return;const len=dm(a,b);const e=Object.assign({a,b,kind,m:len,cost:len+PEN[kind]},extra||{});ADJ[a].push(e);ADJ[b].push(Object.assign({},e,{a:b,b:a}));}
function hNode(area,x){x=Math.round(Math.max(50,Math.min(950,+x||500)));const pre=area==='P'?'cP_':area==='A'?'cA_':area+'_';const i=XS.findIndex(v=>Math.abs(v-x)<3);
  if(i>=0)return pre+i;const id=pre+'x'+x;
  if(!N[id])node(id,x,area==='P'?CPY:area==='A'?CAY:PY(+area.slice(2)),area,{i:nearestXS(x),p:area.startsWith('pl')?+area.slice(2):undefined});return id;}
function normLayout(L){const g=(L&&Array.isArray(L.gates)?L.gates:DEFAULT_LAYOUT.gates).filter(x=>x&&x.id).map(x=>({id:String(x.id),kind:x.kind==='entry'?'entry':'gate',n:String(x.n||'').slice(0,40),name:String(x.name||'').slice(0,40),side:x.side==='A'?'A':'P',x:Math.max(50,Math.min(950,+x.x||500)),status:GATE_TAG[x.status]!==undefined?x.status:'open'}));
  const ends=['none','stairs','esc','lift'];
  const num=(v,d)=>isFinite(+v)?+v:d;
  const okTo=t=>/^(pl[0-8]|P|A|gate)$/.test(t);
  const normWays=p=>(Array.isArray(p.ways)?p.ways:(okTo(p.to)?[{to:p.to,gate:p.gate,stairs:p.stairs,lift:p.lift,esc:p.esc}]:[])).slice(0,6).filter(w=>w&&okTo(w.to)).map(w=>({to:w.to,gate:String(w.gate||'').slice(0,40),side:w.side==='sdb'||w.side==='nzm'?w.side:'',stairs:!!w.stairs,lift:!!w.lift,esc:!!w.esc}));
  const pathPts=a=>(Array.isArray(a)?a:[]).slice(0,80).map(p=>{const ways=normWays(p);return {ways,x:Math.max(30,Math.min(970,num(p.x,500))),y:Math.max(CPY,Math.min(CAY,num(p.y,386))),to:ways.length?ways[0].to:'',gate:String(p.gate||'').slice(0,40),stairs:ways.some(w=>w.stairs),lift:ways.some(w=>w.lift),esc:ways.some(w=>w.esc),sid:String(p.sid||'').slice(0,40),par:Number.isInteger(p.par)?p.par:null,link:String(p.link||'').slice(0,40),xlinks:(Array.isArray(p.xlinks)?p.xlinks:[]).slice(0,12).map(v=>String(v).slice(0,40)).filter(Boolean)};});
  const f=(L&&Array.isArray(L.fobs)?L.fobs:DEFAULT_LAYOUT.fobs).filter(x=>x&&x.id).map(x=>x.shape==='path'?(()=>{const pts=pathPts(x.pts);
      return {id:String(x.id),name:String(x.name||'Foot Over Bridge').slice(0,40),shape:'path',pts,plats:[...new Set(pts.flatMap(p=>p.ways.filter(w=>/^pl/.test(w.to)).map(w=>+w.to.slice(2))))].sort((a,b)=>a-b),
        stairs:pts.some(p=>p.stairs),lift:pts.some(p=>p.lift),esc:pts.some(p=>p.esc),endP:'none',endA:'none',x:pts.length?pts[0].x:500,land:0,lobby:500,step:0,from:''};})():({id:String(x.id),name:String(x.name||'Foot Over Bridge').slice(0,40),shape:x.shape==='zigzag'?'zigzag':'straight',
    x:Math.max(50,Math.min(950,+x.x||500)),land:[-1,0,1].includes(+x.land)?+x.land:1,lobby:Math.max(50,Math.min(950,+x.lobby||700)),step:Math.max(-80,Math.min(80,+x.step||0)),from:x.from||'',
    plats:Array.isArray(x.plats)?x.plats.map(Number).filter(p=>p>=0&&p<9):ALLP.slice(),stairs:!!x.stairs,lift:!!x.lift,esc:!!x.esc,endP:ends.includes(x.endP)?x.endP:'none',endA:ends.includes(x.endA)?x.endA:'none'}));
  let geo=null;const G=L&&L.geo;
  if(G&&Array.isArray(G.o)&&Array.isArray(G.a)&&Array.isArray(G.PYS)&&G.PYS.length===9&&[G.kx,G.ky,G.cx,G.v0,...G.o,...G.a,...G.PYS].every(v=>isFinite(+v))&&+G.kx&&+G.ky)
    geo={o:G.o.map(Number),a:G.a.map(Number),kx:+G.kx,ky:+G.ky,cx:+G.cx,v0:+G.v0,PYS:G.PYS.map(Number),at:String(G.at||''),n:+G.n||0};
  if(geo&&G.ends&&typeof G.ends.L==='string'&&typeof G.ends.R==='string')geo.ends={L:G.ends.L.slice(0,30),R:G.ends.R.slice(0,30)};
  const pillars=(L&&Array.isArray(L.pillars)?L.pillars:[]).slice(0,600).filter(p=>p&&isFinite(+p.x)&&+p.bar>=0&&+p.bar<9).map(p=>({bar:+p.bar,x:Math.max(30,Math.min(970,+p.x)),n:String(p.n||'').slice(0,12)})).filter(p=>p.n);
  const works=(L&&Array.isArray(L.works)?L.works:[]).slice(0,100).filter(w=>w&&isFinite(+w.x)&&isFinite(+w.y)).map(w=>({id:String(w.id||'').slice(0,40),name:String(w.name||'Construction work').slice(0,60),area:/^(pl[0-8]|P|A|fob)$/.test(w.area)?w.area:'P',
    x:Math.max(30,Math.min(970,+w.x)),y:Math.max(20,Math.min(760,+w.y)),r:Math.max(5,Math.min(500,+w.r||20)),block:!!w.block,until:/^\d{4}-\d{2}-\d{2}$/.test(w.until||'')?w.until:'',show:w.show!==false,pillar:String(w.pillar||'').slice(0,12),color:/^#[0-9a-f]{6}$/i.test(w.color||'')?w.color:''}));
  const out={v:1,gates:g,fobs:f};if(geo)out.geo=geo;if(works.length)out.works=works;if(pillars.length)out.pillars=pillars;if(L&&typeof L.auto==='boolean')out.auto=L.auto;if(L&&L.noStarter)out.noStarter=true;if(L&&L.src==='survey')out.src='survey';return out;}
// metres per map unit and platform lines for a layout
function layoutScale(L){if(L&&L.geo)return {SX:Math.abs(1/L.geo.kx),SY:Math.abs(1/L.geo.ky),PYS:L.geo.PYS.slice()};return {SX:0.6,SY:0.42,PYS:PY0.slice()};}
// which way along the platforms (left -1 / right +1 on the map) the Sadar Bazar or Nizamuddin end is
function endSign(side){if(side!=='sdb'&&side!=='nzm')return 0;const L=LAYOUT&&LAYOUT.geo&&LAYOUT.geo.ends?LAYOUT.geo.ends.L:'Sadar Bazar';const sdbLeft=L==='Sadar Bazar';return (side==='sdb')===sdbLeft?-1:1;}
const sideEnd=s=>s==='sdb'?'Sadar Bazar end':s==='nzm'?'Nizamuddin end':'';
// passenger wording for an official end name: the gate at that end of the station (Sadar Bazar / Nizamuddin are for staff only)
const passEnd=s=>{if(!(LAYOUT&&LAYOUT.geo&&LAYOUT.geo.ends)||!endSign(s))return '';return gateEnd('P',endSign(s)>0)+' end';};
function buildGraph(L){
  {const sc=layoutScale(L);SX=sc.SX;SY=sc.SY;PYS=sc.PYS;}
  LAYOUT=L;Object.keys(N).forEach(k=>delete N[k]);Object.keys(ADJ).forEach(k=>delete ADJ[k]);
  FOBS=L.fobs;FOB_BY={};FOBS.forEach(f=>FOB_BY[f.id]=f);FOB_X={};FOBS.forEach(f=>{if(f.shape==='straight')FOB_X[f.id]=f.x;});
  XS.forEach((x,i)=>{node('cP_'+i,x,CPY,'P',{i});node('cA_'+i,x,CAY,'A',{i});});
  for(let p=0;p<9;p++)XS.forEach((x,i)=>node(`pl${p}_${i}`,x,PY(p),'pl'+p,{p,i}));
  for(let i=0;i<7;i++){edge('cP_'+i,'pl0_'+i,'enter');edge('cA_'+i,'pl8_'+i,'enter');}
  GATES=[];gateAt={};
  L.gates.forEach(g=>{const id=hNode(g.side,g.x),lab=gateLabel(g);GATES.push([gateKey(g),id,GATE_TAG[g.status]||'',g,lab]);if(!gateAt[id])gateAt[id]=lab;});
  const access=f=>{const a=[f.stairs&&'stairs',f.lift&&'lift',f.esc&&'esc'].filter(Boolean);return a.length?a:['stairs'];};
  VNODES={};ZPATH={};FSEG={};
  FOBS.filter(f=>f.shape==='straight').forEach(f=>{const ids=[],lx=fobLand(f),ps=f.plats.slice().sort((a,b)=>a-b);
    if(f.endP!=='none'){node(f.id+'_P',f.x,CPY,f.id);ids.push(f.id+'_P');edge(f.id+'_P',hNode('P',lx),f.endP);}
    const lo=Math.min(...ps,f.endP!=='none'?0:9),hi=Math.max(...ps,f.endA!=='none'?8:-1);
    for(let p=Math.max(0,lo);p<=Math.min(8,hi);p++){const land=ps.includes(p);node(f.id+p,f.x,PY(p),f.id,{p,land});ids.push(f.id+p);
      if(land)access(f).forEach(k=>edge(f.id+p,hNode('pl'+p,lx),k));}
    if(f.endA!=='none'){node(f.id+'_A',f.x,CAY,f.id);ids.push(f.id+'_A');edge(f.id+'_A',hNode('A',lx),f.endA);}
    for(let i=1;i<ids.length;i++)edge(ids[i-1],ids[i],'bridge');VNODES[f.id]=ids;});
  FOBS.filter(f=>f.shape==='zigzag').forEach(f=>{const ps=f.plats,path=[];const from=f.from&&f.from!==f.id&&VNODES[f.from]&&VNODES[f.from].length?f.from:null;let p0=0;
    if(from){const b=VNODES[from].find(id=>N[id].p!==undefined)||VNODES[from][0];p0=N[b].p||0;path.push(b);}
    else if(f.endP!=='none'){node(f.id+'_P',f.lobby,CPY,f.id);edge(f.id+'_P',hNode('P',f.lobby),f.endP);path.push(f.id+'_P');}
    node(f.id+'_L',f.lobby,PY(p0),f.id,{lobby:true,p0});path.push(f.id+'_L');
    if(!from&&ps.includes(p0))access(f).forEach(k=>edge(f.id+'_L',hNode('pl'+p0,f.lobby),k));
    const pmax=Math.max(p0,...ps,f.endA!=='none'?8:p0);
    for(let p=p0+1;p<=pmax;p++){const x=zigX(f,p-p0),land=ps.includes(p);node(f.id+'_a'+p,zigX(f,p-p0-1),PY(p),f.id);node(f.id+p,x,PY(p),f.id,{p,land});path.push(f.id+'_a'+p,f.id+p);
      if(land)access(f).forEach(k=>edge(f.id+p,hNode('pl'+p,x),k));}
    if(f.endA!=='none'){const x=zigX(f,pmax-p0);node(f.id+'_A',x,CAY,f.id);path.push(f.id+'_A');edge(f.id+'_A',hNode('A',x),f.endA);}
    for(let i=1;i<path.length;i++)edge(path[i-1],path[i],'bridge');ZPATH[f.id]=path;});
  // Bridges recorded in the site survey: a polyline of real points, each may have its own way down
  FOBS.filter(f=>f.shape==='path').forEach(f=>{const path=[];
    f.pts.forEach((pt,k)=>{const id=f.id+'_'+k;let y=pt.y,p;const ways=pt.ways||[];
      const wp=ways.find(w=>/^pl\d$/.test(w.to)),wc=ways.find(w=>w.to==='P'||w.to==='A');
      if(wp){p=+wp.to.slice(2);y=PY(p);}else if(wc)y=wc.to==='P'?CPY:CAY;
      const acc={stairs:pt.stairs,lift:pt.lift,esc:pt.esc};node(id,pt.x,y,f.id,{sid:pt.sid,p,land:!!wp,to:pt.to,gate:(ways.find(w=>w.to==='gate')||{}).gate||'',acc,ways});path.push(id);
      ways.forEach(w=>{const ks=access(w),xo=Math.max(30,Math.min(970,pt.x+endSign(w.side)*Math.max(10,15/SX))),ex={side:w.side};
        if(/^pl\d$/.test(w.to))ks.forEach(kk=>edge(id,hNode(w.to,xo),kk,ex));
        else if(w.to==='P'||w.to==='A')ks.forEach(kk=>edge(id,hNode(w.to,xo),kk,ex));
        else if(w.to==='gate'){const gg=GATES.find(g=>String(g[0])===String(w.gate));if(gg)ks.forEach(kk=>edge(id,gg[1],kk,ex));}});});
    const seg=[];for(let i=1;i<path.length;i++){const pa=f.pts[i].par;const j=Number.isInteger(pa)&&pa>=0&&pa<path.length&&pa!==i?pa:i-1;if(f.pts[i].link)continue;edge(path[j],path[i],'bridge');seg.push([path[j],path[i]]);}FSEG[f.id]=seg;ZPATH[f.id]=path;});
  // bridge points that join another bridge (e.g. FOB 3 starting from FOB 2)
  FOBS.filter(f=>f.shape==='path').forEach(f=>f.pts.forEach((pt,i)=>{if(!pt.link)return;const id=f.id+'_'+i,o=Object.keys(N).find(k=>N[k].sid===pt.link&&k!==id);if(o){edge(o,id,'bridge');FSEG[f.id].push([o,id]);}else if(i>0){edge(f.id+'_'+(i-1),id,'bridge');FSEG[f.id].push([f.id+'_'+(i-1),id]);}}));
  // extra connections recorded on site (a point joined to several others, possibly on other bridges)
  {const bySid={};Object.keys(N).forEach(k=>{if(N[k].sid)bySid[N[k].sid]=k;});const done={};
    FOBS.filter(f=>f.shape==='path').forEach(f=>f.pts.forEach((pt,i)=>(pt.xlinks||[]).forEach(t=>{const a=f.id+'_'+i,b=bySid[t];if(!b||a===b)return;const key=[a,b].sort().join('|');if(done[key])return;done[key]=1;
      if(!(ADJ[a]||[]).some(e=>e.b===b))edge(a,b,'bridge');FSEG[f.id].push([a,b]);})));}
  HNODES={};
  Object.keys(N).forEach(id=>{const c=N[id].ctx;if(c==='P'||c==='A'||/^pl\d$/.test(c))(HNODES[c]=HNODES[c]||[]).push(id);});
  Object.entries(HNODES).forEach(([a,ids])=>{ids.sort((u,v)=>N[u].x-N[v].x);for(let i=1;i<ids.length;i++)edge(ids[i-1],ids[i],a==='P'||a==='A'?'walk':'plat');});
  AREA_KEYS=['P','pl0','pl1','pl2','pl3','pl4','pl5','pl6','pl7','pl8','A',...FOBS.filter(f=>f.shape==='straight'&&(VNODES[f.id]||[]).length).map(f=>f.id)];
  PLACEABLE=Object.keys(N).filter(id=>/^(cP|cA|pl\d)_/.test(id));
  const today=new Date().toISOString().slice(0,10);WORKS=(L.works||[]).filter(w=>!w.until||w.until>=today);
  WORKS.forEach(w=>Object.values(ADJ).forEach(list=>list.forEach(e=>{if(workHitsEdge(w,e)){if(w.block)e.block=true;else e.slow=true;}})));}
// construction/work areas: which walkway they sit on, and whether a stretch of walkway passes through them
function workOn(w,id){const n=N[id];if(!n)return false;return w.area==='fob'?isFob(n.ctx):n.ctx===w.area;}
function segDistM(w,a,b){const ax=(N[a].x-w.x)*SX,ay=(N[a].y-w.y)*SY,bx=(N[b].x-w.x)*SX,by=(N[b].y-w.y)*SY,dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;let t=l2?-(ax*dx+ay*dy)/l2:0;t=Math.max(0,Math.min(1,t));return Math.hypot(ax+dx*t,ay+dy*t);}
function workHitsEdge(w,e){const onA=workOn(w,e.a),onB=workOn(w,e.b);if(!onA&&!onB)return false;
  const along=e.kind==='walk'||e.kind==='plat'||e.kind==='bridge';
  if(along&&(onA&&onB||w.area==='fob'))return segDistM(w,e.a,e.b)<=w.r;
  if(!along){const id=onA?e.a:e.b;return Math.hypot((N[id].x-w.x)*SX,(N[id].y-w.y)*SY)<=w.r;}return false;}
function worksNear(id){const n=N[id];if(!n)return [];return WORKS.filter(w=>w.show&&workOn(w,id)&&Math.hypot((n.x-w.x)*SX,(n.y-w.y)*SY)<=w.r+10);}

// areas = walkable lines a QR board or facility can sit on
const areaY=a=>a==='P'?CPY:a==='A'?CAY:isVert(a)?null:PY(+a.slice(2));
const platLabel=p=>p===0?'Platform 1':p===8?'Platform 16':`Platform ${2*p}/${2*p+1}`;
const platHi=p=>p===0?'प्लेटफॉर्म 1':p===8?'प्लेटफॉर्म 16':`प्लेटफॉर्म ${2*p}/${2*p+1}`;
const areaLabel=a=>a==='P'?'Paharganj side concourse':a==='A'?'Ajmeri Gate side concourse':FOB_BY[a]?FOB_BY[a].name:platLabel(+a.slice(2));
const areaHi=a=>a==='P'?'पहाड़गंज साइड':a==='A'?'अजमेरी गेट साइड':FOB_BY[a]?'फुट ओवर ब्रिज '+((FOB_BY[a].name.match(/\d+/)||[''])[0]):platHi(+a.slice(2));
const areaGroup=a=>a==='P'?'Paharganj side':a==='A'?'Ajmeri Gate side':isFob(a)?'On the foot over bridges':'On the platforms';
const GROUPS=['Paharganj side','Ajmeri Gate side','On the platforms','On the foot over bridges'];
const nodeFor=(area,i)=>area==='P'?'cP_'+i:area==='A'?'cA_'+i:area+'_'+i;
const nearestI=x=>nearestXS(x);
const nearestPlat=y=>{let b=0;for(let p=0;p<9;p++)if(Math.abs(PY(p)-y)<Math.abs(PY(b)-y))b=p;return b;};
const vRange=a=>{const ys=(VNODES[a]||[]).map(id=>N[id].y);return ys.length?[Math.min(...ys),Math.max(...ys)]:[CPY,CAY];};
// Any point on a walkway: platforms and concourses run along x, straight foot over bridges along y
function ptXY(p){if(isVert(p.area)){const r=vRange(p.area);return {x:FOB_X[p.area],y:Math.max(r[0],Math.min(r[1],+p.y||PY(4)))};}
  return {x:Math.max(50,Math.min(950,+p.x||XS[3])),y:areaY(AREA_KEYS.includes(p.area)?p.area:'P')};}
function walkNodes(area){return isVert(area)?(VNODES[area]||[]):(HNODES[area]||[]);}
function snapToWalkway(px,py){let best=null;
  AREA_KEYS.forEach(a=>{let x,y,d;if(isVert(a)){const r=vRange(a);x=FOB_X[a];y=Math.max(r[0],Math.min(r[1],py));d=Math.abs(px-x)+(py<r[0]-30||py>r[1]+30?99:0);}else{y=areaY(a);x=Math.max(50,Math.min(950,px));d=Math.abs(py-y);}
    if(!best||d<best.d)best={d,area:a,x,y};});
  return {area:best.area,x:Math.round(best.x),y:Math.round(best.y)};}
// Amenities recorded without a platform: beyond PF 1 / PF 16 they belong to that side's concourse; between platforms only a foot over bridge is allowed
function snapNoPlat(px,py){const pad=8;if(py<=PY(0)-pad)return {area:'P',x:Math.round(Math.max(50,Math.min(950,px))),y:CPY};if(py>=PY(8)+pad)return {area:'A',x:Math.round(Math.max(50,Math.min(950,px))),y:CAY};
  let best=null;AREA_KEYS.forEach(a=>{if(!isVert(a))return;const r=vRange(a),x=FOB_X[a],y=Math.max(r[0],Math.min(r[1],py)),d=Math.abs(px-x);if(!best||d<best.d)best={d,area:a,x,y};});
  if(best&&best.d<=40)return {area:best.area,x:Math.round(best.x),y:Math.round(best.y)};
  const s=py-PY(0)<PY(8)-py?'P':'A';return {area:s,x:Math.round(Math.max(50,Math.min(950,px))),y:s==='P'?CPY:CAY};}
function attachEdges(area,x,y){const nodes=walkNodes(area),vert=isVert(area),c=id=>vert?N[id].y:N[id].x,v=vert?y:x,kind=vert?'bridge':(area==='P'||area==='A')?'walk':'plat',sc=vert?SY:SX;
  let L=null,R=null;nodes.forEach(id=>{const k=c(id);if(k<=v&&(L===null||k>c(L)))L=id;if(k>=v&&(R===null||k<c(R)))R=id;});
  return [...new Set([L,R].filter(Boolean))].map(b=>({b,kind,m:Math.abs(c(b)-v)*sc}));}
function makeNode(id,area,x,y){N[id]={id,x,y,ctx:area,virt:true,i:nearestI(x),p:area.startsWith('pl')?+area.slice(2):undefined};}
function nearestBase(area,x,y){if(isVert(area)){let b=null;walkNodes(area).forEach(id=>{if(!b||Math.abs(N[id].y-y)<Math.abs(N[b].y-y))b=id;});return b;}return nodeFor(area,nearestI(x));}
function sideGates(side){return GATES.filter(g=>N[g[1]]&&N[g[1]].ctx===side&&(!g[3]||g[3].kind!=='entry')).map(g=>({n:g[0],x:N[g[1]].x})).sort((a,b)=>a.x-b.x);}
const gateEnd=(ctx,up)=>{const gs=sideGates(ctx==='A'?'A':'P');if(!gs.length)return up?'far':'near';return gateText((up?gs[gs.length-1]:gs[0]).n);};
function posText(x){const gs=sideGates('P');if(!gs.length)return 'middle';
  if(x<=gs[0].x+25)return `beyond ${gateText(gs[0].n)}`;if(x>=gs[gs.length-1].x-25)return `beyond ${gateText(gs[gs.length-1].n)}`;
  const near=gs.reduce((b,k)=>Math.abs(k.x-x)<Math.abs(b.x-x)?k:b);if(Math.abs(near.x-x)<25)return `opposite Gate ${near.n}`;
  let lo=gs[0],hi=gs[gs.length-1];gs.forEach(k=>{if(k.x<=x)lo=k;});for(let i=gs.length-1;i>=0;i--)if(gs[i].x>=x)hi=gs[i];return `between Gates ${lo.n} and ${hi.n}`;}
function pillarNear(bar,x,maxM){const lim=maxM!=null?maxM/SX:28;let b=null;((LAYOUT&&LAYOUT.pillars)||[]).forEach(p=>{if(p.bar===bar&&Math.abs(p.x-x)<=lim&&(!b||Math.abs(p.x-x)<Math.abs(b.x-x)))b=p;});return b;}
// Where a spot is, in the words staff and passengers use on site: nearest pillar, nearest foot over bridge, nearest gate
function fobLandings(area){const out=[];FOBS.forEach(f=>(VNODES[f.id]||ZPATH[f.id]||[]).forEach(id=>(ADJ[id]||[]).forEach(e=>{const t=N[e.b];if(t&&t.ctx===area&&e.kind!=='bridge')out.push({f,x:t.x});})));return out;}
function nearFob(area,x,maxM){let b=null;fobLandings(area).forEach(l=>{const d=Math.abs(l.x-x)*SX;if(d<=maxM&&(!b||d<b.d))b={f:l.f,d};});return b;}
function fobRef(area,x){const fb=nearFob(area,x,60);if(fb)return {near:true,txt:`${fb.d<=12?'at':'near'} ${fobShort(fb.f)}`,f:fb.f,d:fb.d};
  const ls=fobLandings(area);if(!ls.length)return null;let lo=null,hi=null;ls.forEach(l=>{if(l.x<=x&&(!lo||l.x>lo.x))lo=l;if(l.x>=x&&(!hi||l.x<hi.x))hi=l;});
  if(lo&&hi&&lo.f.id!==hi.f.id)return {txt:`between ${fobShort(lo.f)} and ${fobShort(hi.f)}`};const o=lo||hi;return {txt:`${Math.round(Math.abs(o.x-x)*SX/10)*10} m from ${fobShort(o.f)}`};}
function landmarkAt(area,x){if(/^pl\d$/.test(area)){const pn=pillarNear(+area.slice(2),x,40);if(pn)return `pillar ${pn.n}`;}
  const fb=nearFob(area,x,30);if(fb)return fobShort(fb.f);
  if(area==='P'||area==='A'){let g=null;GATES.forEach(r=>{const n=N[r[1]];if(n&&n.ctx===area&&Math.abs(n.x-x)*SX<=40&&(!g||Math.abs(n.x-x)<Math.abs(N[g[1]].x-x)))g=r;});if(g)return g[4];}
  return '';}
function describePos(area,x,y){
  if(isVert(area)){const p=nearestPlat(y);if(y<PY(0)-12)return `${areaLabel(area)} · Paharganj side end`;if(y>PY(8)+12)return `${areaLabel(area)} · Ajmeri Gate side end`;
    if(Math.abs(PY(p)-y)<12)return `${areaLabel(area)} · above ${platLabel(p)}`;const q=y>PY(p)?p+1:p-1;return `${areaLabel(area)} · between ${platLabel(Math.min(p,q))} and ${platLabel(Math.max(p,q))}`;}
  const parts=[];
  if(area==='P'||area==='A'){parts.push(areaLabel(area));const gs=GATES.filter(g=>N[g[1]]&&N[g[1]].ctx===area).map(g=>({lab:g[4],x:N[g[1]].x}));
    const g=gs.reduce((b,k)=>!b||Math.abs(k.x-x)<Math.abs(b.x-x)?k:b,null);
    if(g&&Math.abs(g.x-x)*SX<=40)parts.push(`near ${g.lab}`);
    else if(gs.length>1){const sorted=gs.slice().sort((a,b)=>a.x-b.x);let lo=null,hi=null;sorted.forEach(k=>{if(k.x<=x)lo=k;});for(let i=sorted.length-1;i>=0;i--)if(sorted[i].x>=x)hi=sorted[i];
      parts.push(lo&&hi&&lo!==hi?`between ${lo.lab} and ${hi.lab}`:`near ${(lo||hi).lab}`);}
    const fr=fobRef(area,x);if(fr&&fr.near)parts.push(fr.txt);
    return parts.join(' · ');}
  const p=+area.slice(2);parts.push(platLabel(p));
  const pn=pillarNear(p,x,60);if(pn)parts.push(`${Math.abs(pn.x-x)*SX<=8?'at':'near'} pillar ${pn.n}`);
  const fr=fobRef(area,x);if(fr)parts.push(fr.near&&fr.d<=12?`${fr.txt} ${accessWord(fr.f)}`:fr.txt);
  if(parts.length===1)parts.push(posText(x));
  return parts.join(' · ');}
function alongText(area,x,y){return isVert(area)?`${Math.round((y-CPY)*SY)} m from the Paharganj side`:`${Math.round((x-50)*SX)} m from the ${gateEnd(area==='A'?'A':'P',false)} end`;}
buildGraph(normLayout(DEFAULT_LAYOUT));

// ================= Categories & facilities =================
// five groups, as the station authority organises them: A passenger facilities, B navigation points, C operational points,
// D temporary points (with dates), E points defined by the authority (and every new type staff add)
// [letter, name for staff, Hindi, name passengers see]
const CAT_GROUPS=[['A','Passenger facilities','यात्री सुविधाएँ','Facilities'],['B','Navigation points','आने-जाने के रास्ते','Getting around'],['C','Operational points','कार्यालय व सहायता','Help & offices'],['D','Temporary points','अभी की विशेष व्यवस्था','Special arrangements now'],['E','Authority-defined points','विशेष स्थान','Special points']];
const CATS=[
 // A. Passenger facilities
 ['ticket','UTS & PRS counters','टिकट काउंटर (यूटीएस / पीआरएस)','B','A'],['ysk','Yatri Suvidha Kendra','यात्री सुविधा केंद्र','Y','A'],
 ['waiting','Waiting Room','प्रतीक्षालय','W','A'],['lounge','AC Lounge','एसी लाउंज','L','A'],['retiring','Retiring Rooms','विश्रामालय','R','A'],
 ['toilet','Toilets','शौचालय','T','A'],['water','Drinking Water','पेयजल','D','A'],['cloak','Cloak Room','अमानती घर','C','A'],
 ['food','Catering & Food','खानपान','F','A'],['mih','May I Help You booth','मे आई हेल्प यू बूथ','?','A'],['help','Wheelchair & Porter','व्हीलचेयर व कुली','H','A'],
 ['atm','ATM','एटीएम','₹','A'],['shop','Shops & Book Stalls','दुकानें व बुक स्टॉल','S','A'],['pharmacy','Chemist','दवा की दुकान','+','A'],
 ['charging','Mobile Charging','मोबाइल चार्जिंग','⚡','A'],['feeding','Baby Feeding Room','शिशु आहार कक्ष','B','A'],
 // B. Navigation points
 ['platform','Platform','प्लेटफॉर्म','','B'],['gate','Entry & Exit Gates','प्रवेश व निकास द्वार','G','B'],['pfentry','Platform Entrances','प्लेटफॉर्म प्रवेश','P','B'],
 ['fobaccess','Foot Over Bridge Access','फुट ओवर ब्रिज पहुँच','F','B'],['subway','Subway Entrances','सबवे प्रवेश','U','B'],['lift','Lifts','लिफ्ट','L','B'],
 ['escalator','Escalators','एस्केलेटर','E','B'],['stairs','Stairs & Ramps','सीढ़ियाँ व रैंप','S','B'],['parking','Parking Entrances','पार्किंग प्रवेश','P','B'],
 ['transport','Taxi, Auto & Metro','टैक्सी, ऑटो व मेट्रो','M','B'],['dropoff','Pick-up & Drop-off','पिक-अप व ड्रॉप','D','B'],
 // C. Operational points
 ['police','RPF / GRP Post','आरपीएफ / जीआरपी चौकी','R','C'],['sm',"Station Master's Office",'स्टेशन मास्टर कार्यालय','SM','C'],['enquiry','Enquiry Office','पूछताछ कार्यालय','i','C'],
 ['parcel','Parcel Office','पार्सल कार्यालय','P','C'],['cmi','Commercial Inspector Office','वाणिज्य निरीक्षक कार्यालय','CI','C'],['lostfound','Lost & Found','खोया-पाया','?','C'],
 ['medical','Medical Assistance','चिकित्सा सहायता','+','C'],['complaint','Complaint Desk (Rail Madad)','शिकायत डेस्क (रेल मदद)','!','C'],
 // D. Temporary points (shown only between their dates)
 ['tmpticket','Festival Special Ticket Counter','त्योहार विशेष टिकट काउंटर','B','D'],['holding','Passenger Holding Area','यात्री होल्डिंग क्षेत्र','H','D'],
 ['tmpgate','Additional Entry Gate','अतिरिक्त प्रवेश द्वार','G','D'],['tmpfood','Temporary Catering Unit','अस्थायी खानपान','F','D'],['tmphelp','Special Help Desk','विशेष सहायता डेस्क','?','D'],
 ['queue','Queue Arrangement','कतार व्यवस्था','Q','D'],['tmpwater','Temporary Water Point','अस्थायी पानी','D','D'],['tmptoilet','Mobile Toilets','मोबाइल शौचालय','T','D'],
 // E. Authority-defined points
 ['newfac','New Facility','नई सुविधा','N','E'],['guide','Passenger Guidance Point','यात्री मार्गदर्शन बिंदु','→','E'],['diversion','Temporary Diversion','अस्थायी मार्ग परिवर्तन','↪','E'],
 ['restricted','Restricted Area (No Entry)','प्रतिबंधित क्षेत्र (प्रवेश वर्जित)','⛔','E'],['assembly','Emergency Assembly Point','आपातकालीन एकत्र स्थल','A','E'],
 ['emexit','Emergency Exit','आपातकालीन निकास','X','E'],['other','Other Point (Station Authority)','अन्य बिंदु (स्टेशन प्राधिकरण)','•','E']];
const CAT={};CATS.forEach(c=>CAT[c[0]]={id:c[0],en:c[1],hi:c[2],code:c[3],grp:c[4]||'E'});
// types staff added before these groups existed, now built in
const CAT_ALIAS={'x-yatra-suvidha-kendra':'ysk','x-road-to-yatri-suvidha-ke':'guide'};
const catGrp=c=>(CAT[c]&&CAT[c].grp)||'E';
// not a destination: shown on the map as information, never routed to
const NO_NAV=new Set(['restricted','diversion']);
// gates: what a gate is for. Facilities of a gate type and QR boards of kind Gate carry use: '' (entry & exit) | 'entry' | 'exit'
const GATE_CATS=new Set(['gate','tmpgate']);
const GATE_USE={'':['Entry & exit','प्रवेश व निकास'],entry:['Entry only','केवल प्रवेश'],exit:['Exit only','केवल निकास']};
const gateUseOf=a=>a&&(GATE_CATS.has(a.cat)||a.kind==='Gate')?(a.use==='entry'||a.use==='exit'?a.use:''):null;
const gateUseText=a=>{const u=gateUseOf(a);return u==null?'':GATE_USE[u][0]+' · '+GATE_USE[u][1];};
// temporary points carry "from" / "until" (date and time); passengers see them only in between
const inWindow=a=>{const now=Date.now(),f=a&&a.from?Date.parse(a.from):NaN,u=a&&a.until?Date.parse(a.until):NaN;return !(f>now)&&!(u<now);};
const PASS=()=>ALL().filter(a=>a.cat==='platform'||(inWindow(a)&&!NO_NAV.has(a.cat)));
let ADMIN_CATS=CATS.filter(c=>c[0]!=='platform');
// How many: e.g. 6 UTS counters, 4 ATVMs, 3 enquiry windows. Stored on the facility as count + unit.
const FAC_UNITS=[['counter','counter','counters','काउंटर'],['machine','machine','machines','मशीनें'],['window','window','windows','खिड़कियाँ'],['booth','booth','booths','बूथ'],['tap','tap','taps','नल'],['stall','stall','stalls','स्टॉल'],['seat','seat','seats','सीटें'],['bed','bed','beds','बिस्तर'],['unit','unit','units','']];
function defUnit(cat,name){const n=String(name||'');if(/atvm|machine|vending|kiosk/i.test(n))return 'machine';if(/window/i.test(n))return 'window';
  if(cat==='atm')return 'machine';if(['ticket','enquiry','cloak','medical','help'].includes(cat))return 'counter';if(cat==='water')return 'tap';if(cat==='food'||cat==='shop')return 'stall';if(cat==='waiting'||cat==='lounge')return 'seat';if(cat==='retiring')return 'bed';return 'unit';}
const facCount=a=>{const n=parseInt(a&&a.count,10);return n>0?n:0;};
function countText(a,hi){const n=facCount(a);if(!n)return '';const u=FAC_UNITS.find(x=>x[0]===(a.unit||defUnit(a.cat,a.name)))||FAC_UNITS[FAC_UNITS.length-1];
  return hi&&u[3]?`${n} ${u[3]}`:`${n} ${n===1?u[1]:u[2]}`;}
function countFields(d,ids,ro){const u=d.unit||defUnit(d.cat,d.name);
  return `<div class="two"><div class="field"><label for="${ids[0]}">How many <small>(optional)</small></label><input id="${ids[0]}" ${ids[2]?`data-sk="count"`:''} type="number" min="1" max="999" inputmode="numeric" value="${esc(d.count||'')}" placeholder="e.g. 6" ${ro?'disabled':''}></div>
    <div class="field"><label for="${ids[1]}">Of what</label><select id="${ids[1]}" ${ids[2]?`data-sk="unit"`:''} ${ro?'disabled':''}>${FAC_UNITS.map(x=>`<option value="${x[0]}"${x[0]===u?' selected':''}>${x[2]}</option>`).join('')}</select></div></div>
    <small class="msg" style="display:block;margin:-6px 0 10px">Shown to passengers, e.g. “6 counters” for UTS, “4 machines” for ATVMs.</small>`;}
const cleanCount=v=>{const n=parseInt(v,10);return n>0&&n<1000?n:null;};
// kinds of place added by staff in the site survey ("Add a new kind of place"). Each facility of that kind carries cat:'x-…' and catName.
const isXCat=c=>/^x-/.test(String(c||''));
function kindLetter(n){const w=String(n||'').trim();return (w.match(/[A-Za-z0-9]/)||['?'])[0].toUpperCase();}
function syncCats(){let ch=false;(FAC||[]).forEach(a=>{if(!isXCat(a.cat)||CAT[a.cat])return;const n=String(a.catName||a.name||'Other').trim();
    const row=[a.cat,n,hiAuto(n),kindLetter(n),'E'];CATS.push(row);CAT[a.cat]={id:row[0],en:row[1],hi:row[2],code:row[3],grp:'E'};ch=true;});
  if(ch)ADMIN_CATS=CATS.filter(c=>c[0]!=='platform');return ch;}
const xKinds=()=>CATS.filter(c=>isXCat(c[0]));
function kindIdFor(name){const n=String(name||'').trim();const ex=xKinds().find(c=>c[1].toLowerCase()===n.toLowerCase());if(ex)return ex[0];
  let id='x-'+(n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'kind');if(CAT[id])id+='-'+Math.random().toString(36).slice(2,6);return id;}
const BUILTIN=[
 ['l1','lounge','Executive Lounge','pl0_3','IRCTC · paid by the hour · AC, Wi-Fi, buffet'],['l2','lounge','AC Lounge','pl8_4','Paid · AC seating, charging points'],['l3','lounge','AC Lounge','pl4_5','Paid · AC seating'],
 ['w1','waiting','Upper Class Waiting Room','pl0_1','For AC and first-class ticket holders'],['w2','waiting','Ladies Waiting Room','pl0_5','Women passengers'],['w3','waiting','General Waiting Hall','pl6_3','Free for all ticket holders'],['w4','waiting','Sleeper Class Waiting Hall','pl8_1','Free for all ticket holders'],
 ['t1','toilet','Toilets','cP_1',''],['t2','toilet','Toilets','pl0_4','Pay and use'],['t3','toilet','Toilets','pl2_1',''],['t4','toilet','Toilets','pl4_3',''],['t5','toilet','Toilets','pl6_5',''],['t6','toilet','Toilets','pl8_2','Pay and use'],['t7','toilet','Toilets','cA_5',''],
 ['f1','food','Food Plaza','cP_5','Seated restaurant'],['f2','food','Jan Ahaar','pl8_3','Budget meals'],['f3','food','Refreshment Stall','pl3_4','Tea and snacks'],['f4','food','Refreshment Stall','pl5_1','Tea and snacks'],
 ['d1','water','Drinking Water (RO)','pl0_2',''],['d2','water','Drinking Water (RO)','pl1_5',''],['d3','water','Drinking Water (RO)','pl3_1',''],['d4','water','Drinking Water (RO)','pl5_4',''],['d5','water','Drinking Water (RO)','pl7_3',''],
 ['b1','ticket','Booking & Reservation Counters (UTS / PRS)','cP_4','Booking, reservation and enquiry near Gate 4'],['b5','ticket','Booking Counters (UTS)','cP_0','Unreserved tickets near Gate 1'],['b6','ticket','ATVM Machines','cP_4','Near Gate 4 · card and UPI'],['b2','ticket','Booking Office (UTS / PRS)','cA_3','Unreserved and reservation counters'],['b3','ticket','ATVM Machines','cP_0','Unreserved tickets · card and UPI'],['b4','ticket','ATVM Machines','cA_6','Unreserved tickets · card and UPI'],
 ['e1','enquiry','Enquiry Counter','cP_4',''],['e2','enquiry','Enquiry Counter','cA_4',''],['c1','cloak','Cloak Room','cP_1',''],['c2','cloak','Cloak Room','cA_1',''],
 ['r1','retiring','Retiring Rooms','cP_2','First floor'],['r2','retiring','Retiring Rooms','cA_2','First floor'],['m1','medical','First Aid Post','pl0_6',''],['m2','medical','First Aid Post','cA_5',''],
 ['x1','transport','Prepaid Taxi Booth','cP_0',''],['x2','transport','Prepaid Auto Booth','cA_0',''],['x3','transport','Parking','cA_6',''],['x4','transport','Airport Express Metro','cA_5','Metro entrance'],
].map(a=>({id:a[0],cat:a[1],name:a[2],node:a[3],note:a[4],status:'open',statusNote:''}));
const PLATS=[];for(let n=1;n<=16;n++){const p=n===1?0:n===16?8:Math.floor(n/2);PLATS.push({id:'pf'+n,cat:'platform',name:'Platform '+n,bar:p,status:'open',note:(p>0&&p<8)?`Island platform, shared with ${n%2?n-1:n+1}`:''});}
let FAC=BUILTIN.slice(), SOURCE='builtin';
const ALL=()=>FAC.concat(PLATS);
const isOpen=a=>(a.status||'open')==='open';
const STATUS={open:'Open',maintenance:'Under maintenance',closed:'Closed'};

// ================= QR points =================
const KINDS=['Gate','Hall','Booking office','Platform','FOB stairs / lift','Waiting area','Other'];
// Starter points: used until the QR database answers, and for viewers who can't reach it.
const BUILTIN_QR=[
 ['pg-gate1','Gate 1','गेट 1','Gate','cP_0'],['pg-gate2','Gate 2 · Closed','गेट 2 · बंद','Gate','cP_2'],['pg-gate3','Gate 3 · Exit only','गेट 3 · केवल निकास','Gate','cP_3'],['pg-gate4','Gate 4 · Entry','गेट 4 · प्रवेश','Gate','cP_4'],['pg-gate5','Gate 5 · Entry & exit','गेट 5 · प्रवेश व निकास','Gate','cP_6'],
 ['ag-gate6','Gate 6','गेट 6','Gate','cA_0'],['ag-gate7','Gate 7','गेट 7','Gate','cA_2'],['ag-gate8','Gate 8 · Main entrance','गेट 8 · मुख्य प्रवेश','Gate','cA_3'],['ag-gate9','Gate 9','गेट 9','Gate','cA_4'],['ag-gate10','Gate 10','गेट 10','Gate','cA_6'],
 ['pf1-mid','Platform 1 · middle','','Platform','pl0_3'],['pf4-fob1','Platform 4/5 · FOB 1 stairs','','FOB stairs / lift','pl2_2'],['pf8-fob2','Platform 8/9 · FOB 2','','FOB stairs / lift','pl4_6'],['pf12-mid','Platform 12/13 · middle','','Platform','pl6_3'],['pf16-south','Platform 16 · Gate 1 end','','Platform','pl8_0'],
].map(([id,name,nameHi,kind,nd])=>{const n=N[nd];return {id,name,nameHi,kind,area:n.ctx==='P'||n.ctx==='A'?n.ctx:'pl'+n.p,x:n.x,y:n.y,lat:null,lng:null,acc:null};});
let QRPTS=BUILTIN_QR.slice(), QR_SOURCE='builtin', qrStamp=0;
const getPt=id=>QRPTS.find(p=>p.id===id);
function sortedPts(){const k=p=>{const q=ptXY(p);return q.x+q.y;};return QRPTS.slice().sort((a,b)=>(GROUPS.indexOf(areaGroup(a.area))-GROUPS.indexOf(areaGroup(b.area)))||(AREA_KEYS.indexOf(a.area)-AREA_KEYS.indexOf(b.area))||(k(a)-k(b)));}
const hiLine=pt=>pt.nameHi?`${areaHi(pt.area)} · ${pt.nameHi}`:areaHi(pt.area);

// Put the scanned point into the graph as a temporary start node, joined to its neighbours on the same walkway
function setPin(pt){const a=AREA_KEYS.includes(pt.area)?pt.area:'P',q=ptXY({area:a,x:pt.x,y:pt.y});makeNode('__pin',a,q.x,q.y);
  ADJ.__pin=attachEdges(a,q.x,q.y).map(e=>({a:'__pin',b:e.b,kind:e.kind,m:e.m,cost:e.m}));return '__pin';}
// Facilities sit anywhere on a walkway; each gets its own node joined to the walkway nodes either side
function facPos(a){if(a.pillar&&a.area&&/^pl\d$/.test(a.area)&&a.src!=='survey'){const bar=+a.area.slice(2),pl=((LAYOUT&&LAYOUT.pillars)||[]).find(q=>q.bar===bar&&q.n.toLowerCase()===String(a.pillar).trim().toLowerCase());if(pl)return {area:a.area,x:Math.round(pl.x),y:PY(bar)};}
  if(a.src==='survey'&&a.pf&&LAYOUT&&LAYOUT.geo){const bar=pfBar(+a.pf);let x=null;
    if(a.pillar){const pl=(LAYOUT.pillars||[]).find(q=>q.bar===bar&&q.n.toLowerCase()===String(a.pillar).toLowerCase());if(pl)x=pl.x;}
    if(x==null&&hasLL(a))x=surveyXY(LAYOUT.geo,...geoEN(a.lat,a.lng)).x;if(x!=null)return {area:'pl'+bar,x:Math.max(50,Math.min(950,Math.round(x))),y:PY(bar)};}
  if(a.src==='survey'&&hasLL(a)&&LAYOUT&&LAYOUT.geo){const m=surveyXY(LAYOUT.geo,...geoEN(a.lat,a.lng));const q=snapNoPlat(m.x,m.y);return {area:q.area,x:q.x,y:q.y};}
  if(a.area&&AREA_KEYS.includes(a.area)){const q=ptXY(a);return {area:a.area,x:q.x,y:q.y};}
  const n=N[a.node];if(!n||n.virt)return null;const ar=n.ctx==='P'||n.ctx==='A'?n.ctx:n.ctx.startsWith('pl')?n.ctx:null;return ar?{area:ar,x:n.x,y:n.y}:null;}
function rebuildFacNodes(){Object.keys(N).forEach(k=>{if(k.startsWith('fac_'))delete N[k];});
  FAC.forEach(a=>{const p=facPos(a);a._n=null;if(!p)return;const id='fac_'+a.id;makeNode(id,p.area,p.x,p.y);N[id].att=attachEdges(p.area,p.x,p.y);a._n=id;if(!a.node||!N[a.node]||N[a.node].virt)a.node=nearestBase(p.area,p.x,p.y);});}
const facOnPf=a=>{const ar=a.area||(a._n&&N[a._n]?N[a._n].ctx:'');return /^pl\d$/.test(ar)?+ar.slice(2):null;};
function facLoc(a){const p=facOnPf(a);if(p===null)return {txt:a._n?where(a._n):'Location not set',miss:[]};
  const parts=[platLabel(p)],miss=[];const f=a.nearFob&&a.nearFob!=='none'?FOB_BY[a.nearFob]:null;
  if(String(a.pillar||'').trim())parts.push(`near pillar ${String(a.pillar).trim()}`);else miss.push('pillar');
  if(f)parts.push(`near ${fobShort(f)}`);else if(a.nearFob==='none')parts.push('no foot over bridge nearby');else miss.push('fob');
  return {txt:parts.join(' · '),miss};}
// passengers: staff-recorded pillar/FOB; anything not recorded yet is filled in from the layout
const facWhere=a=>{const L=facLoc(a);if(!L.miss.length||!a._n)return L.txt;const nn=N[a._n];const auto=(nn?describePos(nn.ctx,nn.x,nn.y):'').split(' · ').slice(1).filter(t=>(L.miss.includes('pillar')&&/pillar/.test(t))||(L.miss.includes('fob')&&/FOB/.test(t)));return [L.txt,...auto].join(' · ');};
// staff: missing references shown in red
const facWhereHtml=a=>{const L=facLoc(a);return esc(L.txt)+(L.miss.includes('pillar')?' · <span class="req">Pillar no. required</span>':'')+(L.miss.includes('fob')?' · <span class="req">FOB reference required</span>':'');};

// ================= helpers =================
const $=id=>document.getElementById(id);
const sideName=c=>c==='P'?'Paharganj side':'Ajmeri Gate side';
const fobName=c=>FOB_BY[c]?FOB_BY[c].name:'the foot over bridge';
function where(id){const n=N[id];if(!n)return 'Location not set';if(id.startsWith('fac_')){const a=FAC.find(x=>'fac_'+x.id===id);if(a&&facOnPf(a)!==null&&(a.pillar||a.nearFob))return facWhere(a);}if(n.virt)return describePos(n.ctx,n.x,n.y);
  if(n.ctx==='P'||n.ctx==='A')return describePos(n.ctx,n.x,n.y);
  if(isFob(n.ctx)){const f=FOB_BY[n.ctx];if(n.lobby)return `${f.name} · start / lobby`;if(n.p!==undefined&&n.land)return `${f.name} · ${isZig(n.ctx)?'stairs to':'landing for'} ${platLabel(n.p)}`;
    if(n.p!==undefined)return `${f.name} · above ${platLabel(n.p)}`;if(n.to==='P'||n.to==='A')return `${f.name} · ${sideName(n.to)} end`;if(n.to==='gate'){const gg=GATES.find(g=>String(g[0])===String(n.gate));return `${f.name} · at ${gg?gg[4]:'Gate '+n.gate}`;}if(id.endsWith('_P'))return `${f.name} · Paharganj side end`;if(id.endsWith('_A'))return `${f.name} · Ajmeri Gate side end`;return `${f.name} · walkway`;}
  return describePos('pl'+n.p,n.x,n.y);}
function amenAt(id){return FAC.filter(a=>a.node===id&&isOpen(a)&&a._n&&Math.abs(N[a._n].x-N[id].x)+Math.abs(N[a._n].y-N[id].y)<25);}
const r10=v=>Math.max(10,Math.round(v/10)*10);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function rel(iso){if(!iso)return '';const s=(Date.now()-Date.parse(iso))/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+' h ago';const d=Math.floor(s/86400);return d===1?'yesterday':d+' days ago';}
const NDLS={lat:28.6427,lng:77.2197};
function haversine(a,b){const R=6371000,t=Math.PI/180,dLa=(b.lat-a.lat)*t,dLo=(b.lng-a.lng)*t;const h=Math.sin(dLa/2)**2+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const fmtLL=(lat,lng)=>`${Math.abs(lat).toFixed(5)}° ${lat>=0?'N':'S'}, ${Math.abs(lng).toFixed(5)}° ${lng>=0?'E':'W'}`;
const accClass=a=>a==null?'none':a<=10?'good':a<=25?'fair':'poor';
const accText=a=>a==null?'No GPS reading':a<=10?`±${Math.round(a)} m · good`:a<=25?`±${Math.round(a)} m · fair`:`±${Math.round(a)} m · weak`;
const hasLL=p=>typeof p.lat==='number'&&typeof p.lng==='number';

function dijkstra(src,stepFree){const dist={},prev={},done={};dist.__src=src;Object.keys(N).forEach(k=>dist[k]=Infinity);dist[src]=0;
  for(;;){let u=null,best=Infinity;for(const k in dist)if(!done[k]&&dist[k]<best){best=dist[k];u=k;}if(u===null)break;done[u]=1;
    for(const e of ADJ[u]){if(stepFree&&e.kind==='stairs')continue;if(e.block)continue;const d=dist[u]+e.cost+(e.slow?10:0);if(d<dist[e.b]){dist[e.b]=d;prev[e.b]=e;}}}
  return {dist,prev};}
function pathTo(res,t){const edges=[];let c=t;while(res.prev[c]){edges.unshift(res.prev[c]);c=res.prev[c].a;}return edges;}
function routeTo(am,res){const src=res.dist.__src;
  if(!am._n){const t=targetNode(am,res);return {t,edges:pathTo(res,t),d:res.dist[t]};}
  const fn=N[am._n];let best=null;fn.att.forEach(e=>{const d=res.dist[e.b]+e.m;if(!best||d<best.d)best={d,e};});
  const sa=(ADJ[src]||[]).map(e=>e.b).sort().join(),fa=fn.att.map(e=>e.b).sort().join();
  if(src==='__pin'&&N.__pin.ctx===fn.ctx&&sa===fa){const sc=isVert(fn.ctx)?SY:SX,m=(isVert(fn.ctx)?Math.abs(fn.y-N.__pin.y):Math.abs(fn.x-N.__pin.x))*sc;
    if(!best||m<=best.d)return {t:am._n,d:m,edges:[{a:src,b:am._n,kind:fn.att[0].kind,m,cost:m}]};}
  if(!best||!isFinite(best.d))return {t:am._n,d:Infinity,edges:[]};
  return {t:am._n,d:best.d,edges:[...pathTo(res,best.e.b),{a:best.e.b,b:am._n,kind:best.e.kind,m:best.e.m,cost:best.e.m}]};}
function targetNode(am,res){if(am.node)return am.node;let best=null;XS.forEach((x,i)=>{const id=`pl${am.bar}_${i}`;if(!best||res.dist[id]<res.dist[best])best=id;});return best;}
function summarize(edges){let m=0,stairs=0,lifts=0,es=0;edges.forEach(e=>{m+=e.m;if(e.kind==='stairs')stairs++;if(e.kind==='lift')lifts++;if(e.kind==='esc')es++;});
  return {m,min:Math.max(1,Math.ceil((m/1.1+stairs*12+lifts*45+es*15)/60)),stairs,lifts,esc:es};}

function buildSteps(startId,edges,dest,startName,startSub){
  const items=[];let cur=null;
  edges.forEach(e=>{if(e.kind==='walk'||e.kind==='plat'||e.kind==='bridge'){const ctx=N[e.a].ctx;
      if(cur&&cur.ctx===ctx){cur.nodes.push(e.b);cur.m+=e.m;}else{cur={type:'move',ctx,nodes:[e.a,e.b],m:e.m};items.push(cur);}}
    else{cur=null;items.push({type:'trans',kind:e.kind,from:e.a,to:e.b,side:e.side||''});}});
  const steps=[{cls:'s-start',t:`Start at ${startName}`,s:'You are here · '+startSub,pts:[startId]}];
  items.forEach((it,k)=>{const next=items[k+1];
    if(it.type==='move'){if(it.m<4)return;const a=N[it.nodes[0]],b=N[it.nodes[it.nodes.length-1]];
      if(it.ctx==='P'||it.ctx==='A'){let target;
        if(next&&next.type==='trans'&&N[next.to].ctx.startsWith('f'))target=`the ${fobName(N[next.to].ctx)} ${next.kind==='esc'?'escalators':'stairs'}`;
        else if(gateAt[b.id])target=gateAt[b.id];else if(b.id.startsWith('fac_')&&FAC.find(x=>'fac_'+x.id===b.id))target='the '+FAC.find(x=>'fac_'+x.id===b.id).name;else if(amenAt(b.id).length)target='the '+amenAt(b.id)[0].name;else{const lm=landmarkAt(it.ctx,b.x);target=lm||'';}
        steps.push({t:target?`Walk along the ${sideName(it.ctx)} concourse to ${target}`:`Walk along the ${sideName(it.ctx)} concourse`,s:`About ${r10(it.m)} m`,pts:it.nodes});
      } else if(isZig(it.ctx)){const zf=FOB_BY[it.ctx];
        const pts=it.nodes.filter((id,i,arr)=>i===0||N[id].x!==N[arr[i-1]].x||N[id].y!==N[arr[i-1]].y);const turns=[];
        let h=[0,Math.sign(b.y-a.y)||1];
        for(let i=1;i<pts.length;i++){const dx=N[pts[i]].x-N[pts[i-1]].x,dy=N[pts[i]].y-N[pts[i-1]].y,l=Math.hypot(dx,dy)||1,d=[dx/l,dy/l];const cr=h[0]*d[1]-h[1]*d[0];if(Math.abs(cr)>.5)turns.push((cr>0)!==MIRROR?'right':'left');h=d;}
        let target='the end of the bridge';
        if(next&&next.type==='trans')target=`the ${next.kind==='lift'?'lift':next.kind==='esc'?'escalator':'stairs'} ${N[next.to].ctx.startsWith('pl')?'signed '+platLabel(N[next.to].p):gateAt[next.to]?'down to '+gateAt[next.to]:'down to the '+sideName(N[next.to].ctx)+' concourse'}`;
        else if(next&&next.type==='move'&&isFob(next.ctx))target=`the end and continue on ${fobName(next.ctx)}`;
        const tt=turns.length?'turn '+(turns.length>4?turns.slice(0,4).join(', then ')+', and keep following the zigzag':turns.join(', then ')):'go straight on';
        const landings=it.nodes.slice(1,-1).filter(id=>N[id].land).length;
        steps.push({t:`Take ${zf.name}: ${tt}, to ${target}`,s:`${fobShort(zf)} ${zf.shape==='path'?'crosses the platforms':'zigzags across the platforms'}${landings?` · ${landings} platform stair${landings===1?'':'s'} on the way`:''} · about ${r10(it.m)} m`,pts:it.nodes});
      } else if(isFob(it.ctx)){const towards=b.y>a.y?'Ajmeri Gate side':'Paharganj side';
        const passed=it.nodes.slice(1,-1).filter(id=>N[id].land).length;let target='the end of the bridge';
        if(next&&next.type==='trans'&&N[next.to].ctx.startsWith('pl'))target=`the ${next.kind==='lift'?'lift':'stairs'} signed ${platLabel(N[next.to].p)}`;
        else if(next&&next.type==='move'&&isZig(next.ctx))target=`the point where ${fobName(next.ctx)} turns off`;
        steps.push({t:`Cross ${fobName(it.ctx)} towards the ${towards} and stop at ${target}`,s:`${passed} other platform landing${passed===1?'':'s'} on the way · about ${r10(it.m)} m`,pts:it.nodes});
      } else {let to='';if(next&&next.type==='trans'&&N[next.to].ctx.startsWith('f'))to=`the ${fobShort(FOB_BY[N[next.to].ctx]||{name:'FOB'})} ${next.kind==='lift'?'lift':next.kind==='esc'?'escalator':'stairs'}`;
          else if(b.id.startsWith('fac_')){const fa=FAC.find(x=>'fac_'+x.id===b.id);if(fa)to='the '+fa.name;}
          if(!to){const lm=landmarkAt('pl'+a.p,b.x);if(lm)to=lm;}
        const passing=[...new Set(it.nodes.slice(1,-1).flatMap(id=>amenAt(id).map(x=>x.name.replace(/ \(RO\)/,''))))].slice(0,3);
        steps.push({t:to?`Walk along ${platLabel(a.p)} to ${to}`:`Walk along ${platLabel(a.p)}`,s:`About ${r10(it.m)} m`+(passing.length?` · you will pass ${passing.join(', ')}`:''),pts:it.nodes});}
    } else {const f=N[it.from],to=N[it.to],up=to.ctx.startsWith('f')&&!f.ctx.startsWith('f'),down=f.ctx.startsWith('f')&&!to.ctx.startsWith('f');let t;
      if(it.kind==='enter')t=to.ctx.startsWith('pl')?`Go through onto ${platLabel(to.p)}`:`Leave ${platLabel(f.p)} onto the ${sideName(to.ctx)} concourse`;
      else{const fob=fobName(up?to.ctx:f.ctx);const place=down?(to.ctx.startsWith('pl')?platLabel(to.p):`the ${sideName(to.ctx)} concourse`):fob;
        const verb=it.kind==='lift'?'Take the lift':it.kind==='esc'?'Take the escalator':(up?'Climb the stairs':'Take the stairs');t=`${verb} ${up?'up':'down'} to ${place}${down&&it.side&&to.ctx.startsWith('pl')&&landmarkAt(to.ctx,to.x).startsWith('pillar')?` (comes down near ${landmarkAt(to.ctx,to.x)})`:''}`;}
      steps.push({t,s:it.kind==='lift'?'Lift fits wheelchairs and luggage trolleys':it.kind==='esc'?'Escalator':it.kind==='stairs'?'Stairs':'',pts:[it.from,it.to]});}});
  const endId=edges.length?edges[edges.length-1].b:startId;
  {const seen={};steps.forEach(st=>{const ws=[...new Set((st.pts||[]).flatMap(worksNear))].filter(w=>!seen[w.id]);ws.forEach(w=>seen[w.id]=1);
    if(ws.length)st.s=(st.s?st.s+' · ':'')+'⚠ '+ws.map(w=>`${w.name}${w.block?' (closed)':''} here — follow the signs`).join('; ');});}
  const os=edges.length?outStep(dest,[startId,...edges.map(e=>e.b)]):null;
  if(os){const pv=steps[steps.length-1];if(pv&&pv.t.includes(dest.name)){pv.t=pv.t.replace('the '+dest.name,dest.name).replace(dest.name,os.out.gate.lab);pv.s=`About ${Math.max(5,r10(Math.abs(os.out.fx-os.out.gate.tx)*SX))} m`;}steps.push(os);}
  steps.push({cls:'s-end',t:edges.length?`Arrive at ${dest.name}`:`${dest.name} is right here`,s:dest.cat==='platform'?describePos('pl'+dest.bar,N[endId].x,N[endId].y):(os?`Outside the station, ${os.out.side==='P'?'Paharganj':'Ajmeri Gate'} side · out through ${os.out.gate.lab}`:where(endId))+(dest.note?' · '+dest.note:''),pts:[endId]});
  // photo anchors: where each step starts and which way it heads
  steps.forEach((s,k)=>{if(k===0||k===steps.length-1||!N[s.pts[0]])return;s.at=s.pts[0];
    for(let j=1;j<s.pts.length;j++){const u=s.pts[j-1],v=s.pts[j];if(N[u].x!==N[v].x||N[u].y!==N[v].y||N[u].ctx!==N[v].ctx){s.tok=edgeTok(u,v);break;}}});
  const last=steps[steps.length-1];last.at=last.pts[0];last.tok='here';last.fac=dest.cat!=='platform'?dest.id:null;
  const fe=edges.find(e=>e.m>0.5||N[e.a].ctx!==N[e.b].ctx);steps[0].at=startId;steps[0].tok=fe?edgeTok(fe.a,fe.b):null;
  return steps;}

// ================= map drawing =================
function drawMap(svg,o){
  let s='';
  s+=`<rect class="m-conc" x="40" y="28" width="920" height="58" rx="6"/><text class="m-side" x="52" y="44">PAHARGANJ SIDE · पहाड़गंज</text>`;
  s+=`<rect class="m-conc" x="40" y="684" width="920" height="58" rx="6"/><text class="m-side" x="52" y="734">AJMERI GATE SIDE · अजमेरी गेट</text>`;
  GATES.forEach(([n,id,tag,g,lab])=>{const nd=N[id],top=nd.ctx==='P',T=esc(String(lab).toUpperCase())+(tag?' · '+tag:''),w=Math.max(44,16+String(lab).length*7.2+(tag?(tag.length+3)*7.2:0)),y=top?6:746;
    s+=`<rect class="m-gate${tag==='CLOSED'?' closed':''}" x="${nd.x-w/2}" y="${y}" width="${w}" height="19" rx="3"/><text class="m-gatet" x="${nd.x}" y="${y+14}">${T}</text>`;});
  for(let p=0;p<8;p++){const a=PY(p),b=PY(p+1);[a+(b-a)*.34,a+(b-a)*.66].forEach(y=>{s+=`<line class="m-sleeper" x1="40" x2="960" y1="${y}" y2="${y}"/><line class="m-rail" x1="40" x2="960" y1="${y-2.5}" y2="${y-2.5}"/><line class="m-rail" x1="40" x2="960" y1="${y+2.5}" y2="${y+2.5}"/>`;});}
  FOBS.forEach(f=>{const sel=o.selFob===f.id?' sel':'';
    if(f.shape==='zigzag'||f.shape==='path'){const path=ZPATH[f.id]||[];if(f.shape==='path')(FSEG[f.id]||[]).forEach(([a,b])=>{if(N[a]&&N[b])s+=`<polyline class="m-fob3${sel}" points="${N[a].x},${N[a].y} ${N[b].x},${N[b].y}"/>`;});else if(path.length>1)s+=`<polyline class="m-fob3${sel}" points="${path.map(id=>N[id].x+','+N[id].y).join(' ')}"/>`;
      const L=N[f.id+'_L']||N[path[0]];if(L)s+=`<text class="m-fobt" x="${L.x-8}" y="${L.y+28}" text-anchor="end">${esc(fobShort(f))} · ${accessWord(f)}${f.shape==='zigzag'?' (zigzag)':''}</text>`;return;}
    const ids=VNODES[f.id]||[];if(!ids.length)return;const x=f.x,y0=ids[0].endsWith('_P')?28:N[ids[0]].y-14,y1=ids[ids.length-1].endsWith('_A')?742:N[ids[ids.length-1]].y+14;
    s+=`<rect class="m-fob${sel}" x="${x-11}" y="${y0}" width="22" height="${y1-y0}"/><line class="m-fobedge" x1="${x-11}" x2="${x-11}" y1="${y0}" y2="${y1}"/><line class="m-fobedge" x1="${x+11}" x2="${x+11}" y1="${y0}" y2="${y1}"/><text class="m-fobt" x="${x>800?x-16:x+16}" y="${PY(0)+44}"${x>800?' text-anchor="end"':''}>${esc(fobShort(f))} · ${accessWord(f)}</text>`;});
  if(o.selGate){const g=GATES.find(g=>g[3]&&g[3].id===o.selGate);if(g&&N[g[1]]){const nd=N[g[1]];s+=`<circle class="m-placering" cx="${nd.x}" cy="${nd.ctx==='P'?16:756}" r="22"/>`;}}
  for(let p=0;p<9;p++){const y=PY(p),lab=p===0?'1':p===8?'16':`${2*p} · ${2*p+1}`,on=o.destBar===p;
    s+=`<rect class="m-plat${on?' on':''}" x="46" y="${y-11}" width="908" height="22" rx="4"/>`;
    [52,900].forEach(tx=>{s+=`<rect class="m-tag" x="${tx}" y="${y-9}" width="48" height="18" rx="2"/><text class="m-tagt" x="${tx+24}" y="${y+5}">${lab}</text>`;});}
  if(o.edges&&o.edges.length){const pts=[o.start,...o.edges.map(e=>e.b)].map(id=>`${N[id].x},${N[id].y}`).join(' ');
    s+=`<polyline class="m-case" points="${pts}"/><polyline class="m-route${o.animate?' draw':''}" pathLength="1" points="${pts}"/>`;}
  if(o.start)s+=`<polyline class="m-hl" points="" data-hl="1"/>`;
  const pp=!!o.photoPick;
  if(pp)Object.keys(N).forEach(id=>{if(N[id].virt)return;s+=`<circle class="m-ph${PHOTOS['n-'+id]?' has':''}" data-pk="n-${id}" cx="${N[id].x}" cy="${N[id].y}" r="6"><title>${esc(where(id))}</title></circle>`;});
  if(!o.hideFac){const byNode={};FAC.forEach(a=>{if(a._n&&a.id!==o.skipFac){const n=N[a._n],k=Math.round(n.x/14)+':'+Math.round(n.y/14);(byNode[k]=byNode[k]||{n:a._n,arr:[]}).arr.push(a);}});
    Object.values(byNode).forEach(({n:id,arr})=>arr.forEach((a,k)=>{const x=N[id].x+(k-(arr.length-1)/2)*20,y=N[id].y-(pp?16:0),isD=a.id===o.destId;
      const cls=[isD?'dest':a.cat===o.cat?'on':'',isOpen(a)?'':'off',pp&&PHOTOS['f-'+a.id]?'phhas':''].join(' ');const r=isD?11:8;
      s+=`<g class="m-am ${cls}"${pp?` data-pk="f-${esc(a.id)}"`:''}><title>${esc(a.name)}${isOpen(a)?'':' · '+STATUS[a.status]}</title><circle cx="${x}" cy="${y}" r="${r}"/><text x="${x}" y="${y+(isD?4.5:3.8)}">${CAT[a.cat]?CAT[a.cat].code:'?'}</text></g>`;}));}
  if(o.qrs)o.qrs.forEach(q=>{const{x:qx,y}=ptXY(q);s+=`<g${pp?` data-pk="qr-${esc(q.id)}"`:''}><title>${esc(q.name)}</title><rect class="m-qr${pp&&PHOTOS['qr-'+q.id]?' phhas':''}" x="${qx-6}" y="${y-6}" width="12" height="12" rx="2"/>${o.qrLabels?`<text class="m-qrt" x="${qx+9}" y="${y-8}">${esc(q.name.split(' · ')[0])}</text>`:''}</g>`;});
  WORKS.filter(w=>w.show||o.allWorks).forEach(w=>{const rx=Math.max(8,w.r/SX),ry=Math.max(6,Math.min(30,w.r/SY));s+=`<g class="m-work${w.block?' blk':''}"${w.color?` style="--wc:${w.color}"`:''}><title>${esc(w.name)}${w.block?' · closed':''}</title><ellipse cx="${w.x}" cy="${w.y}" rx="${rx}" ry="${ry}"/><text x="${w.x}" y="${w.y-ry-4}">⚠ ${esc(w.name.length>22?w.name.slice(0,21)+'…':w.name)}</text></g>`;});
  if(o.flagNode){const n=N[o.flagNode];s+=`<path class="m-flag" d="M${n.x} ${n.y} v-26 l16 6 -16 6"/>`;}
  if(o.start){const u=N[o.start];s+=`<circle class="m-pulse" cx="${u.x}" cy="${u.y}" r="12"/><circle class="m-you" cx="${u.x}" cy="${u.y}" r="9"/>`;}
  if(o.pick){PLACEABLE.forEach(id=>{s+=`<circle class="m-hit" data-node="${id}" cx="${N[id].x}" cy="${N[id].y}" r="13"><title>${esc(where(id))}</title></circle>`;});}
  if(o.place&&N[o.place]){const n=N[o.place];s+=`<circle class="m-placering" cx="${n.x}" cy="${n.y}" r="20"/><circle class="m-place" cx="${n.x}" cy="${n.y}" r="10" pointer-events="none"/>`;}
  if(o.freePin){const{x:fx,y:fy}=ptXY(o.freePin);s+=`<circle class="m-pulse" cx="${fx}" cy="${fy}" r="12"/><circle class="${o.pinCls||'m-you'}" cx="${fx}" cy="${fy}" r="10" pointer-events="none"/>`;}
  svg.innerHTML=s;}
function svgPoint(svg,evt){const pt=svg.createSVGPoint();pt.x=evt.clientX;pt.y=evt.clientY;const m=svg.getScreenCTM();return m?pt.matrixTransform(m.inverse()):null;}

// ================= capabilities =================
let DB=null, USER=null, DL=null, CAN_EDIT=false, NAMES={}, pendingScan=null;
const C=window.claude;
async function initCaps(){
  if(!C||!C.use)return;
  const [db,user,dl,as]=await Promise.all([C.use('db'),C.use('user'),C.use('downloads'),C.use('assets')]);
  DB=db;USER=user;DL=dl;ASSETS=as;
  if(USER){try{CAN_EDIT=!!(await USER.canEdit());}catch(e){CAN_EDIT=false;}}
  $('tab-admin').hidden=!CAN_EDIT;$('tab-qr').hidden=!CAN_EDIT;$('tab-photos').hidden=!CAN_EDIT;$('tab-layout').hidden=true;$('tab-survey').hidden=true;imInitTab();renderCrowd();if(CAN_EDIT&&VIEW==='passenger')setTimeout(()=>{try{renderPassenger();}catch(_){}},0);
  if(CAN_EDIT&&pendingView)showView(pendingView);
  {const hd=document.querySelector('header.top');if(hd)hd.classList.toggle('staff',!!CAN_EDIT);}
  const sl=$('staffLink');if(sl&&CAN_EDIT){sl.textContent='Sign out';sl.href='/api/logout';}{const cl=$('controlLink');if(cl&&CAN_EDIT)cl.hidden=false;}
  if(DB){
    DB.collection('facilities').onSnapshot(snap=>{setTimeout(openFromLink,0);
      if(snap.empty){SOURCE='empty';FAC=SAVED_LAYOUT&&SAVED_LAYOUT.noStarter?[]:BUILTIN.map(a=>Object.assign({},a));}else{SOURCE='db';FAC=snap.docs.map(d=>Object.assign({id:d.id},d.data()));FAC.forEach(a=>{const n=CAT_ALIAS[a.cat];if(n){a.cat=n;delete a.catName;}});}syncCats();rebuildFacNodes();
      refreshNames();renderAll();},()=>{SOURCE='error';renderAll();});
    DB.collection('qrpoints').onSnapshot(snap=>{
      if(snap.empty){QR_SOURCE='empty';QRPTS=SAVED_LAYOUT&&SAVED_LAYOUT.noStarter?[]:BUILTIN_QR.slice();}else{QR_SOURCE='db';QRPTS=snap.docs.map(d=>Object.assign({id:d.id},d.data())).filter(p=>AREA_KEYS.includes(p.area));}
      qrStamp++;fitGeo();
      if(pendingScan&&getPt(pendingScan)){state.scan=pendingScan;showChoice(pendingScan);pendingScan=null;}
      if(!getPt(state.scan)&&QRPTS.length)state.scan=(getPt('pg-gate5')||QRPTS[0]).id;
      renderPassenger();if(VIEW==='qr')renderQR();if(VIEW==='photos')renderPhotos();},()=>{QR_SOURCE='error';if(VIEW==='qr')renderQR();});
    DB.collection('layout').onSnapshot(snap=>{const d=snap.docs.find(x=>x.id==='main');LY_SOURCE=d?'db':'builtin';SAVED_LAYOUT=normLayout(d?d.data():DEFAULT_LAYOUT);
      const editing=ly.dirty&&(VIEW==='layout'||ly.previewing);
      if(!editing&&lySig(SAVED_LAYOUT)!==lySig(LAYOUT))applyLayout(SAVED_LAYOUT);
      if(SAVED_LAYOUT.noStarter){let ch=false;if(SOURCE==='empty'&&FAC.length){FAC=[];ch=true;}if(QR_SOURCE==='empty'&&QRPTS.length){QRPTS=[];ch=true;}if(ch){rebuildFacNodes();renderAll();}}
      if(!ly.dirty)ly.draft=null;if(VIEW==='layout')renderLayout();},()=>{});
    DB.collection('survey').onSnapshot(snap=>{SV_SOURCE='db';SURVEY={};snap.docs.forEach(d=>{SURVEY[d.id]=d.data();});svSyncSoon();if(VIEW==='survey'){if(!sv.draft)renderSvEd();svDrawMap();}if(VIEW==='layout'&&LY_VIEW==='real')renderRealLy();if(VIEW==='passenger'&&MODE==='live')renderPassenger();},()=>{SV_SOURCE='error';});
    DB.collection('indoor').onSnapshot(snap=>{INDOOR=imAssemble(snap.docs);INDOOR_G=null;renderCrowd();svSyncSoon();if(IM.ed&&!IM.ed.isDirty())IM.ed.load(INDOOR);renderPassenger();},()=>{});
    DB.collection('photos').onSnapshot(snap=>{PH_SOURCE='db';PHOTOS={};snap.docs.forEach(d=>{PHOTOS[d.id]=Object.assign({key:d.id},d.data());});
      renderPassenger();renderPhotos();},()=>{PH_SOURCE='error';renderPhotos();});
  } else renderAll();}
async function refreshNames(){if(!USER)return;const ids=[...new Set(FAC.concat(QRPTS).map(a=>a.updatedBy).filter(Boolean))];if(!ids.length)return;
  try{const ps=await USER.profiles(ids);ids.forEach(id=>NAMES[id]=(ps[id]&&ps[id].name)||'');if(VIEW==='admin')renderAdminList();}catch(e){}}

// ================= view switching =================
let VIEW='passenger', pendingView=null;
function showView(v){if((v==='admin'||v==='qr'||v==='photos'||v==='layout'||v==='survey'||v==='indoormap')&&!CAN_EDIT){pendingView=v;v='passenger';}
  const prev=VIEW;
  if(prev==='survey'&&v!=='survey'){svStopCap();svLocate(false);}
  // Leaving the layout editor (or its 3D preview) puts the saved layout back for everything else; the draft is kept for when staff return.
  if(ly.dirty&&v!=='layout'&&!(v==='passenger'&&ly.previewing&&prev==='layout')){ly.previewing=false;if(lySig(LAYOUT)!==lySig(SAVED_LAYOUT))applyLayout(SAVED_LAYOUT);}
  if(v!=='passenger')ly.previewing=false;
  VIEW=v;['passenger','admin','qr','photos','layout','survey','indoormap'].forEach(k=>{if(!$('v-'+k))return;$('v-'+k).hidden=k!==v;$('tab-'+k).setAttribute('aria-selected',k===v);});if(v==='indoormap')imShow();
  // Site survey, the drawn map and the old layout are the steps of one tab: Station map
  {const mt=$('tab-indoormap'),on=v==='survey'||v==='indoormap'||v==='layout';if(mt)mt.setAttribute('aria-selected',String(on));document.querySelectorAll('.msteps [data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===v)));}
  $('lyPrevBar').hidden=!(v==='passenger'&&ly.previewing);
  if(v==='layout'){if(ly.dirty&&ly.draft&&lySig(normLayout(ly.draft))!==lySig(LAYOUT))applyLayout(ly.draft);renderLayout();}
  if(v==='survey')renderSurvey();if(v==='admin')renderAdmin();if(v==='qr')renderQR();if(v==='photos')renderPhotos();if(v==='passenger'){renderPassenger();startLoop();}}
$('tabs').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)showView(b.dataset.view);});

// ================= PASSENGER =================
// nothing is picked until the passenger chooses: they first see the station map with every amenity on it
const state={scan:'pg-gate5',cat:null,dest:'',stepFree:false};
let lastRouteKey='',STEPS=[];
function readHash(){const h=decodeURIComponent((location.hash||'').slice(1)).toLowerCase();if(!h)return false;
  if(h==='scan'){setTimeout(()=>{if(typeof openSheet==='function')openSheet();},400);return false;}
  if(h==='admin'||h==='facilities'){showView('admin');return true;}if(h==='qr'){showView('qr');return true;}if(h==='photos'){showView('photos');return true;}if(h==='layout'){showView('layout');return true;}if(h==='survey'){showView('survey');return true;}if(h==='indoormap'||h==='map-editor'){showView('indoormap');return true;}
  if(getPt(h)){state.scan=h;SCANNED=true;showView('passenger');showChoice(h);return true;}
  pendingScan=h;return false;}

// ---- Tell us / Gate duty (switched on or off in Control room → Staff & settings) ----
let FEAT={tell:true,duty:true};
function loadFeatures(){return fetch('/api/features',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(f=>{if(f){FEAT={tell:f.tell!==false,duty:f.duty!==false};applyFeatures();}}).catch(()=>{});}
function applyFeatures(){const ht=$('hereTell');if(ht)ht.hidden=!FEAT.tell;
  let hd=$('hereDuty');if(!hd&&ht){ht.insertAdjacentHTML('afterend','<a class="msg" id="hereDuty" href="/duty" style="display:block;margin-top:8px">Railway staff: gate duty</a>');hd=$('hereDuty');}
  if(hd){hd.hidden=!(FEAT.duty&&!FEAT.tell);const pt=getPt(state.scan);if(pt)hd.href='/duty?p='+encodeURIComponent(pt.id);}
  const ct=$('choiceTell'),cd=$('choiceDuty');if(ct)ct.hidden=!FEAT.tell;if(cd)cd.parentElement.hidden=!FEAT.duty;
  if(!FEAT.tell&&$('choice'))$('choice').hidden=true;}
// After a QR scan: "Directions" or "Tell us" (and a small link for staff gate duty). Skipped when Tell us is switched off.
function showChoice(id){const pt=getPt(id);if(!pt||!FEAT.tell||!$('choice'))return;const q=encodeURIComponent(pt.id);
  const hi=(pt.nameHi||'').trim();$('choiceH').textContent=hi?hi+' · '+pt.name:pt.name;$('choiceSub').textContent=areaHi(pt.area)+' · '+areaLabel(pt.area);
  $('choiceTell').href='/tell?p='+q;$('choiceDuty').href='/duty?p='+q;applyFeatures();$('choice').hidden=false;setTimeout(()=>$('choiceGo').focus(),50);}
function closeChoice(){if($('choice'))$('choice').hidden=true;}
if($('choiceGo')){$('choiceGo').addEventListener('click',closeChoice);$('choice').addEventListener('click',e=>{if(e.target.id==='choice')closeChoice();});}
loadFeatures();setInterval(loadFeatures,60000);
function renderPassenger(){
  if(imLive()){const p0=getPt(state.scan)||QRPTS[0];if(p0){renderIndoor(p0);return;}}else imHideView();
  {const want=LAYOUT&&LAYOUT.geo?'live':'map';if(MODE!==want){MODE=want;applyModeDom();}}
  const pt=getPt(state.scan)||QRPTS[0];if(!pt){$('hereName').textContent='Scan a QR board';$('hereSub').textContent='No QR boards have been set up yet.';return;}state.scan=pt.id;
  const start=setPin(pt),res=dijkstra(start,state.stepFree);
  {const le=$('legendEnds');if(le)le.hidden=true;}
  $('hereName').textContent=pt.name;if($('hereTell'))$('hereTell').href='/tell?p='+encodeURIComponent(pt.id);applyFeatures();
  $('hereSub').innerHTML=`${esc(areaLabel(pt.area))} <span class="qrid">QR ${esc(pt.id.toUpperCase())}</span>`;
  $('cats').innerHTML=catTiles();$('cats').classList.add('grouped');
  heroInit();todoBar();{const hn=$('hhName');if(hn){hn.textContent=pt.name;$('hhSub').textContent=!SCANNED&&FROM_LINK?'Example start · scan a QR board near you for your own route':areaLabel(pt.area)+(gateUseOf(pt)?' · '+gateUseText(pt):'');$('hhTell').href='/tell?p='+encodeURIComponent(pt.id);$('hhTell').hidden=!FEAT.tell;}}{const sf=$('heroSF');if(sf)sf.setAttribute('aria-pressed',String(!!state.stepFree));}
  placeDrop();const optP=OPT_PANEL,routeP=$('routeTitle').closest('.panel'),stepP=$('steps').closest('.panel');
  if(!state.cat||!CAT[state.cat]){state.cat=null;optP.hidden=routeP.hidden=stepP.hidden=true;STEPS=[];LAST_ROUTE=null;lastRouteKey='';heroCard(null);
    if($('navBtn'))$('navBtn').hidden=true;if(MODE==='live')renderLive(start,[],null,'none');else drawMap($('map'),{start,cat:null});return;}
  routeP.hidden=stepP.hidden=false;optP.hidden=true;
  const list=PASS().filter(a=>a.cat===state.cat&&(a.cat==='platform'||a._n)&&gateUseOf(a)!=='entry').map(a=>{const r=routeTo(a,res);return {a,t:r.t,d:r.d,sum:summarize(r.edges)};});
  if(state.cat!=='platform')list.sort((x,y)=>(isOpen(y.a)-isOpen(x.a))||(x.d-y.d));
  const open=list.filter(x=>isOpen(x.a)&&isFinite(x.d));
  const nearest=open.reduce((b,x)=>!b||x.d<b.d?x:b,null);
  const curr=list.find(x=>x.a.id===state.dest);
  if(!curr||!isOpen(curr.a))state.dest=nearest?nearest.a.id:'';
  const c=CAT[state.cat];$('optTitle').textContent=c.en;
  $('optCount').textContent=list.length?`${open.length} open${list.length>open.length?` · ${list.length-open.length} closed`:''}`:'';
  $('opts').innerHTML=list.length?list.map(x=>{const a=x.a,ok=isOpen(a);
    const w=a.cat==='platform'?(a.note||(a.bar===0?'Paharganj side':'Ajmeri Gate side')):facWhere(a);
    return `<button type="button" class="opt" data-id="${a.id}" aria-pressed="${state.dest===a.id}" ${ok?'':'disabled'}>
      <span class="n">${optNameHtml(a)}${facCount(a)?`<span class="tag cnt">${esc(countText(a))}</span>`:''}${x===nearest?'<span class="tag">Nearest</span>':''}</span>
      <span class="d">${ok?`${r10(x.sum.m)} m<small>${x.sum.min} min</small>`:'<small>—</small>'}</span>
      <span class="w">${esc(w)}</span>
      ${ok?(a.note&&a.cat!=='platform'?`<span class="note">${esc(a.note)}</span>`:''):`<span class="note st">${esc(STATUS[a.status])}${a.statusNote?' · '+esc(a.statusNote):''}</span>`}</button>`;}).join('')
    :`<p class="empty">No ${esc(c.en.toLowerCase())} listed at this station.</p>`;
  const dest=ALL().find(a=>a.id===state.dest);
  if(!dest){heroCard(null);$('routeTitle').innerHTML=`No open ${esc(c.en.toLowerCase())} right now<small>Ask at the nearest enquiry counter</small>`;
    $('stats').hidden=true;$('steps').innerHTML='';STEPS=[];LAST_ROUTE=null;if($('arBtn'))$('arBtn').hidden=true;if($('navBtn'))$('navBtn').hidden=true;drawMap($('map'),{start,cat:state.cat});lastRouteKey='';
    if(MODE==='3d')update3d({start,edges:[],dest:null,pt,tn:null,routeKey:LAYOUT_REV+'|none|'+state.scan+'|'+pt.x+'|'+pt.area,dynKey:dynSig(null,pt)});else if(MODE==='live')renderLive(start,[],null,'none');return;}
  $('stats').hidden=false;
  const rr=routeTo(dest,res),tn=rr.t,edges=rr.edges,sum=summarize(edges);
  $('routeTitle').innerHTML=`${esc(dest.name)}<small>${facCount(dest)?`<b>${esc(countText(dest))}</b> · `:''}${esc(dest.cat==='platform'?platLabel(dest.bar):facWhere(dest))}</small>`;
  $('stM').textContent=r10(sum.m);$('stT').textContent=sum.min;
  if(state.stepFree){$('stS').textContent=sum.lifts+sum.esc;$('stSL').textContent='lifts / esc.';}
  else{$('stS').textContent=sum.stairs;$('stSL').textContent=sum.stairs===1?'staircase':'staircases';}
  STEPS=buildSteps(start,edges,dest,pt.name,areaLabel(pt.area));LAST_ROUTE={start,edges,dest};if($('arBtn'))$('arBtn').hidden=!(LAYOUT&&LAYOUT.geo&&edges.length);if($('navBtn'))$('navBtn').hidden=!(LAYOUT&&LAYOUT.geo&&edges.length);
  $('steps').innerHTML=STEPS.map((s,i)=>{const sp=stepPhoto(s);return `<li tabindex="0" data-i="${i}" class="${s.cls||''}${sp?' has-ph':''}"><span class="num">${i+1}</span><div><div class="t">${esc(s.t)}</div>${s.s?`<div class="s">${esc(s.s)}</div>`:''}</div>${sp?`<button type="button" class="thumb" data-ph="${i}" aria-label="Photo for step ${i+1}"><img src="${esc(sp.url)}" alt="" loading="lazy"></button>`:''}</li>`;}).join('');
  const key=LAYOUT_REV+'|'+state.scan+'|'+pt.x+'|'+pt.area+'|'+state.dest+'|'+state.stepFree;
  drawMap($('map'),{start,edges,destId:dest.id,cat:state.cat,destBar:dest.cat==='platform'?dest.bar:null,flagNode:dest.cat==='platform'?tn:null,animate:key!==lastRouteKey});
  lastRouteKey=key;heroCard(dest,sum);
  if(MODE==='3d')update3d({start,edges,dest,pt,tn,routeKey:key,dynKey:dynSig(dest,pt)});else if(MODE==='live')renderLive(start,edges,dest,key);else markCur();}

const qrIcon='<svg viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="1" y="13" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="4" width="2" height="2" fill="currentColor"/><rect x="16" y="4" width="2" height="2" fill="currentColor"/><rect x="4" y="16" width="2" height="2" fill="currentColor"/><path d="M13 13h3v3h-3zM18 13h3v3M13 18v3h3M18 18h3v3h-3" fill="currentColor"/></svg>';
function openSheet(){const pts=sortedPts();
  $('scanList').innerHTML=GROUPS.map(g=>{const list=pts.filter(p=>areaGroup(p.area)===g);if(!list.length)return '';
    return `<div class="grp">${g}</div><div class="scans">${list.map(p=>`<button type="button" class="scan" data-scan="${esc(p.id)}" aria-pressed="${state.scan===p.id}">${qrIcon}<div><b>${esc(p.name)}</b><span>${esc(p.id.toUpperCase())}</span></div></button>`).join('')}</div>`;}).join('');
  $('sheet').hidden=false;const b=$('scanList').querySelector('[aria-pressed="true"]');if(b)b.focus();}
function closeSheet(){$('sheet').hidden=true;$('scanBtn').focus();}
$('cats').addEventListener('click',e=>{const b=e.target.closest('.cat');if(!b)return;state.cat=state.cat===b.dataset.cat?null:b.dataset.cat;state.dest='';renderPassenger();
  if(state.cat&&CATDROP&&CATDROP.isConnected)setTimeout(()=>CATDROP.scrollIntoView({behavior:'smooth',block:'nearest'}),50);});
// the options of the chosen kind open like a dropdown right under its row of tiles
let CATDROP=null,OPT_PANEL=null;
// "Where do you want to go?": tiles by group; a type shows only when it has a place passengers can go to now
function catTiles(){const live=new Set(PASS().map(a=>a.cat));live.add('platform');
  return CAT_GROUPS.map(([g,,hi,en])=>{const cs=CATS.filter(c=>(c[4]||'E')===g&&live.has(c[0]));if(!cs.length)return '';
    return `<div class="cat-grp"><p class="cat-gh"><b>${esc(en)}</b><span>${esc(hi)}</span></p><div class="cats-g">${cs.map(([id,en2,hi2])=>`<button type="button" class="cat ct" data-cat="${id}" aria-pressed="${state.cat===id}"><i style="background:${catColor(id)}">${catIcon(id)}</i><b>${esc(en2)}</b><span>${esc(hi2)}</span></button>`).join('')}</div></div>`;}).join('');}
function placeDrop(){const cats=$('cats');
  if(!CATDROP){OPT_PANEL=$('opts').closest('.panel');CATDROP=document.createElement('div');CATDROP.className='cat-drop';CATDROP.id='catDrop';CATDROP.append($('optTitle').closest('.label'),$('opts'));OPT_PANEL.hidden=true;}
  const all=[...cats.querySelectorAll('.cat')],sel=all.find(t=>t.getAttribute('aria-pressed')==='true');if(!sel){CATDROP.remove();return;}
  const grid=sel.parentElement,tiles=[...grid.querySelectorAll('.cat')];
  const cols=getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length||3,i=tiles.indexOf(sel),end=Math.min(tiles.length-1,Math.ceil((i+1)/cols)*cols-1);
  CATDROP.style.setProperty('--caret',`${((i%cols)+.5)/cols*100}%`);tiles[end].after(CATDROP);}
window.addEventListener('resize',()=>{if(CATDROP&&CATDROP.isConnected)placeDrop();});
$('opts').addEventListener('click',e=>{const b=e.target.closest('.opt');if(!b||b.disabled)return;state.dest=b.dataset.id;renderPassenger();});
$('stepFree').addEventListener('change',e=>{state.stepFree=e.target.checked;renderPassenger();});
$('scanBtn').addEventListener('click',openSheet);$('sheetClose').addEventListener('click',closeSheet);
$('sheet').addEventListener('click',e=>{if(e.target.id==='sheet')closeSheet();const b=e.target.closest('.scan');if(b){state.scan=b.dataset.scan;SCANNED=true;closeSheet();renderPassenger();}});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if($('choice')&&!$('choice').hidden)closeChoice();else if(!$('lightbox').hidden)$('lightbox').hidden=true;else if(!$('sheet').hidden)closeSheet();else if(!$('qrSheet').hidden)closeQrEd();else if(!$('phSheet').hidden)closePhEd();});
window.addEventListener('hashchange',()=>{if(readHash())renderPassenger();});
function hl(i){if(LAST_ROUTE&&LAST_ROUTE.indoor)return;/* steps on the drawn map have no old-model points */const el=$('map').querySelector('[data-hl]');if(!el)return;if(i==null||!STEPS[i]){el.setAttribute('points','');return;}
  const p=STEPS[i].pts;el.setAttribute('points',p.length>1?p.map(id=>`${N[id].x},${N[id].y}`).join(' '):`${N[p[0]].x},${N[p[0]].y} ${N[p[0]].x+0.1},${N[p[0]].y}`);}
const stepsEl=$('steps');
stepsEl.addEventListener('mouseover',e=>{const li=e.target.closest('li');if(li)hl(+li.dataset.i);});
stepsEl.addEventListener('mouseleave',()=>hl(null));
stepsEl.addEventListener('focusin',e=>{const li=e.target.closest('li');if(li)hl(+li.dataset.i);});
stepsEl.addEventListener('focusout',()=>hl(null));
stepsEl.addEventListener('click',e=>{const th=e.target.closest('[data-ph]');if(th){openLightbox(+th.dataset.ph);return;}
  const li=e.target.closest('li');if(!li)return;
  if(MODE==='3d'){walkTo(+li.dataset.i);$('stage3d').scrollIntoView({behavior:'smooth',block:'nearest'});}
  else{hl(+li.dataset.i);$('map').scrollIntoView({behavior:'smooth',block:'nearest'});}});

// ================= FACILITIES ADMIN =================
const ed={id:null,draft:null,confirmDel:false,msg:'',err:false,busy:false};
$('fCat').innerHTML='<option value="">All types</option>'+CAT_GROUPS.map(([g,en])=>`<optgroup label="${g}. ${esc(en)}"><option value="grp:${g}">All of ${g}. ${esc(en)}</option>${ADMIN_CATS.filter(c=>(c[4]||'E')===g).map(c=>`<option value="${c[0]}">${esc(c[1])}</option>`).join('')}</optgroup>`).join('');
function canWrite(){return !!DB&&CAN_EDIT&&SOURCE!=='error';}
function renderAdmin(){renderNotice();renderCounts();renderAdminList();renderEditor();}
function renderNotice(){const n=$('adminNotice');let html='';
  if(!DB)html=`<span>The facility database isn't reachable right now. Passengers see the last saved list.</span>`;
  else if(SOURCE==='error')html=`<span>The facility database stopped responding. Reload the page to try again.</span>`;
  else if(SOURCE==='empty')html=`<span>The facility database is empty, so passengers see the built-in starter list. Load it into the database to start editing.</span><button class="btn sm primary" id="seedBtn" type="button">Load starter list</button>`;
  n.innerHTML=html;n.hidden=!html;}
function renderCounts(){const c={open:0,maintenance:0,closed:0};FAC.forEach(a=>c[a.status||'open']++);
  $('counts').innerHTML=`<div class="count"><b>${FAC.length}</b><span>Facilities</span></div><div class="count c-ok"><b>${c.open}</b><span>Open</span></div><div class="count c-warn"><b>${c.maintenance}</b><span>Under maintenance</span></div><div class="count c-bad"><b>${c.closed}</b><span>Closed</span></div>`;}
// Facilities tab: every place by group (A to E) and type, the types still missing, and gaps on each platform
let ADM_F='';   // quick filter from the gaps panel: 'nopos' | 'nountil' | 'notopen'
const ESSENTIAL=new Set(['ticket','waiting','toilet','water','food','mih','help','gate','pfentry','fobaccess','lift','escalator','stairs','police','sm','enquiry','lostfound','medical','assembly','emexit']);
const PF_NEED=[['toilet','toilet'],['water','drinking water'],['food','food / catering'],['lift','lift or escalator']];
function facRow(a){const st=a.status||'open';const by=a.updatedBy?(NAMES[a.updatedBy]||'Someone'):'';const tmp=catGrp(a.cat)==='D'||a.until;
  return `<div class="row${ed.id===a.id?' sel':''}"><div><div class="n">${esc(a.name)}${facHi(a)?` · <span lang="hi">${esc(facHi(a))}</span>`:''}<small>${facAka(a).length?'also '+esc(facAka(a).join(', ')):''}${facCount(a)?(facAka(a).length?' · ':'')+esc(countText(a)):''}</small></div><div class="w">${facWhereHtml(a)}${st!=='open'&&a.statusNote?' · '+esc(a.statusNote):''}${PHOTOS['f-'+a.id]?' · has photo':''}${!facLL(a)?' · <span class="req">No map position</span>':''}${tmp?(a.until?` · ${inWindow(a)?'until':'<span class="req">ended</span>'} ${esc(String(a.until).replace('T',' '))}`:' · <span class="req">No end date</span>'):''}</div>${a.updatedAt?`<div class="u">Updated ${esc(rel(a.updatedAt))}${by?' by '+esc(by):''}</div>`:''}</div>
    <span class="pill ${st}">${STATUS[st]}</span><button class="btn sm" type="button" data-edit="${esc(a.id)}">Edit</button></div>`;}
// where a facility is, as a platform bar (0 = PF 1, 8 = PF 16), or null
const facBar=a=>{const ar=String(a.area||'');return ar.startsWith('pl')?+ar.slice(2):null;};
function facGaps(){const have={};FAC.forEach(a=>{(have[a.cat]=have[a.cat]||[]).push(a);});
  const groups=CAT_GROUPS.map(([g,en])=>{const types=CATS.filter(c=>(c[4]||'E')===g&&c[0]!=='platform'&&!isXCat(c[0]));const done=types.filter(c=>have[c[0]]);
    const miss=types.filter(c=>!have[c[0]]).sort((x,y)=>(ESSENTIAL.has(y[0])-ESSENTIAL.has(x[0])));return {g,en,types,done,miss};});
  const pf=[];for(let b=0;b<=8;b++){const here=FAC.filter(a=>facBar(a)===b);const need=PF_NEED.filter(([c])=>c==='lift'?!here.some(a=>a.cat==='lift'||a.cat==='escalator'):!here.some(a=>a.cat===c));if(need.length)pf.push({b,need});}
  const nopos=FAC.filter(a=>!facLL(a)).length,nountil=FAC.filter(a=>catGrp(a.cat)==='D'&&!a.until).length,ended=FAC.filter(a=>a.until&&!inWindow(a)).length,notopen=FAC.filter(a=>(a.status||'open')!=='open').length;
  const total=groups.reduce((s,x)=>s+x.types.length,0),done=groups.reduce((s,x)=>s+x.done.length,0);
  return `<details class="gaps" ${localStorage.getItem('wf-gaps')==='0'?'':'open'}><summary><b>What still needs work</b> <small>${done} of ${total} types added · ${pf.length} platform${pf.length===1?'':'s'} with gaps${nopos?` · ${nopos} without map position`:''}</small></summary>
    <div class="gap-groups">${groups.map(x=>`<div class="gap-g"><div class="gap-h"><b>${x.g}. ${esc(x.en)}</b><span>${x.done.length}/${x.types.length}</span></div><div class="gap-bar"><i style="width:${x.types.length?Math.round(x.done.length/x.types.length*100):0}%"></i></div>
      ${x.miss.length?`<div class="gap-miss">${x.miss.map(c=>`<button type="button" class="gap-chip${ESSENTIAL.has(c[0])?' ess':''}" data-addcat="${c[0]}" title="Add ${esc(c[1])}">+ ${esc(c[1])}</button>`).join('')}</div>`:'<p class="okm">All types added ✓</p>'}</div>`).join('')}</div>
    ${pf.length?`<div class="gap-pf"><b>Platforms missing a basic facility</b><ul>${pf.map(x=>`<li><span>${esc(platLabel(x.b))}</span> ${x.need.map(([c,t])=>`<button type="button" class="gap-chip" data-addcat="${c}" data-addbar="${x.b}">+ ${esc(t)}</button>`).join('')}</li>`).join('')}</ul></div>`:''}
    ${nopos||nountil||ended||notopen?`<div class="gap-q"><b>Check these</b> ${nopos?`<button type="button" class="gap-chip warn" data-adf="nopos">${nopos} with no map position (passengers can't be routed)</button>`:''}${nountil?`<button type="button" class="gap-chip warn" data-adf="nountil">${nountil} temporary without an end date</button>`:''}${ended?`<button type="button" class="gap-chip" data-adf="ended">${ended} temporary already ended</button>`:''}${notopen?`<button type="button" class="gap-chip" data-adf="notopen">${notopen} closed / under maintenance</button>`:''}${ADM_F?'<button type="button" class="gap-chip" data-adf="">Show all</button>':''}</div>`:''}
    <p class="msg">Orange = essential for passengers. Tap a missing type to add one; for a platform the platform is filled in for you.</p></details>`;}
function renderAdminList(){if(VIEW!=='admin')return;
  if(!$('facGaps'))$('rows').insertAdjacentHTML('beforebegin','<div id="facGaps"></div>');
  $('facGaps').innerHTML=facGaps();
  const q=$('q').value.trim().toLowerCase(),fc=$('fCat').value,fs=$('fStatus').value;
  const ok=a=>(!fc||(fc.startsWith('grp:')?catGrp(a.cat)===fc.slice(4):a.cat===fc))&&(!fs||(a.status||'open')===fs)&&(!q||(facWords(a)+' '+facWhere(a)+' '+(CAT[a.cat]||{}).en).toLowerCase().includes(q))
    &&(!ADM_F||(ADM_F==='nopos'?!facLL(a):ADM_F==='nountil'?catGrp(a.cat)==='D'&&!a.until:ADM_F==='ended'?a.until&&!inWindow(a):(a.status||'open')!=='open'));
  const order={closed:0,maintenance:1,open:2},rows=FAC.filter(ok),filtered=!!(q||fs||ADM_F);
  $('listCount').textContent=`${rows.length} shown`;
  const html=CAT_GROUPS.map(([g,en,hi])=>{if(fc.startsWith('grp:')&&fc.slice(4)!==g)return '';
    const types=CATS.filter(c=>(c[4]||'E')===g&&c[0]!=='platform'&&(!fc||fc.startsWith('grp:')||c[0]===fc));
    const blocks=types.map(c=>{const list=rows.filter(a=>a.cat===c[0]).sort((a,b)=>(order[a.status||'open']-order[b.status||'open'])||a.name.localeCompare(b.name,undefined,{numeric:true}));
      if(!list.length&&filtered)return '';
      return `<div class="adm-t"><p class="adm-th"><i style="background:${catColor(c[0])}">${catIcon(c[0])}</i><b>${esc(c[1])}</b><span lang="hi">${esc(c[2]||'')}</span><small>${list.length}</small>${list.length?`<button type="button" class="btn sm" data-addcat="${c[0]}">+ Add</button>`:''}</p>
        ${list.length?list.map(facRow).join(''):`<div class="adm-none"><span>None added yet${ESSENTIAL.has(c[0])?' · <b class="ess">essential</b>':''}</span> <button type="button" class="btn sm${ESSENTIAL.has(c[0])?' primary':''}" data-addcat="${c[0]}">+ Add ${esc(c[1])}</button></div>`}</div>`;}).join('');
    if(!blocks)return '';const n=rows.filter(a=>catGrp(a.cat)===g).length;
    return `<details class="adm-g" open><summary><b>${g}. ${esc(en)}</b> <span lang="hi">${esc(hi)}</span><small>${n} place${n===1?'':'s'}</small></summary>${blocks}</details>`;}).join('');
  $('rows').innerHTML=html||'<p class="empty">No facilities match these filters.</p>';}
// a new facility of this type (and on this platform), from "+ Add" or a gap
function addFacOf(cat,bar){openFacEd(null);ed.draft.cat=cat;if(bar!=null&&bar!=='')ed.draft.area='pl'+bar;ed.draft.unit='';renderEditor();
  if(window.innerWidth<960)$('editor').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>{const f=$('f-name');if(f)f.focus();},50);}
document.addEventListener('click',e=>{const b=e.target.closest('#facGaps [data-addcat],#rows [data-addcat]');if(b){addFacOf(b.dataset.addcat,b.dataset.addbar);return;}
  const f=e.target.closest('#facGaps [data-adf]');if(f){ADM_F=f.dataset.adf;renderAdminList();}});
document.addEventListener('toggle',e=>{if(e.target.classList&&e.target.classList.contains('gaps'))try{localStorage.setItem('wf-gaps',e.target.open?'1':'0');}catch(_){}},true);
['q','fCat','fStatus'].forEach(id=>$(id).addEventListener('input',renderAdminList));
$('rows').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(!b)return;const a=FAC.find(x=>x.id===b.dataset.edit);if(!a)return;
  openFacEd(a);if(window.innerWidth<960)$('editor').scrollIntoView({behavior:'smooth',block:'start'});});
$('addBtn').addEventListener('click',()=>{openFacEd(null);
  if(window.innerWidth<960)$('editor').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>{const f=$('f-name');if(f)f.focus();},50);});
$('adminNotice').addEventListener('click',async e=>{if(e.target.id!=='seedBtn'||!DB)return;e.target.disabled=true;
  try{const uid=USER?await USER.id():null;const now=new Date().toISOString();
    for(const a of BUILTIN){await DB.doc('facilities/'+a.id).set({cat:a.cat,name:a.name,node:a.node,note:a.note,status:'open',statusNote:'',updatedAt:now,updatedBy:uid||''});}}
  catch(err){e.target.disabled=false;$('adminNotice').insertAdjacentHTML('beforeend',`<span class="msg err">Couldn't load the list (${esc(err.code||'error')}).</span>`);}});


// ---- GPS → station map ----
const NDLS_C={lat:28.6431,lng:77.2194},MLAT=111320,MLNG=111320*Math.cos(28.6431*Math.PI/180);
const geoEN=(lat,lng)=>[(lng-NDLS_C.lng)*MLNG,(lat-NDLS_C.lat)*MLAT];
let GEO=null;
// Fit GPS to the map from QR points whose map spot was tapped by hand (metres on both sides; conj model keeps the north/east flip)
function fitGeo(){GEO=null;
  if(LAYOUT&&LAYOUT.geo){const g=LAYOUT.geo;GEO={k:0,survey:true,f:(e,n)=>surveyXY(g,e,n)};return;}
  const pts=QRPTS.filter(p=>hasLL(p)&&AREA_KEYS.includes(p.area)&&p.placed!=='gps').map(p=>{const q=ptXY(p),[e,n]=geoEN(p.lat,p.lng);return {e,n,X:(q.x-500)*SX,Y:(q.y-386)*SY};});
  const toMap=(X,Y)=>({x:500+X/SX,y:386+Y/SY});
  if(pts.length>=3){const S=[[0,0,0],[0,0,0],[0,0,0]],bx=[0,0,0],by=[0,0,0];
    pts.forEach(({e,n,X,Y})=>{const v=[e,n,1];for(let i=0;i<3;i++){for(let j=0;j<3;j++)S[i][j]+=v[i]*v[j];bx[i]+=v[i]*X;by[i]+=v[i]*Y;}});
    const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const D=det(S),norm=S[0][0]*S[1][1]*S[2][2];
    if(norm>0&&Math.abs(D)/norm>1e-3){const sol=b=>[0,1,2].map(c=>det(S.map((r,i)=>r.map((v,j)=>j===c?b[i]:v)))/D);const ax=sol(bx),ay=sol(by);
      GEO={k:pts.length,f:(e,n)=>toMap(ax[0]*e+ax[1]*n+ax[2],ay[0]*e+ay[1]*n+ay[2])};return;}}
  if(pts.length>=2){let a=null,b=null,dm=0;pts.forEach(p=>pts.forEach(q=>{const d=Math.hypot(p.e-q.e,p.n-q.n);if(d>dm){dm=d;a=p;b=q;}}));if(dm<15)return;
    const c0=[a.e,-a.n],c1=[b.e,-b.n],w0=[a.X,a.Y],w1=[b.X,b.Y],dc=[c1[0]-c0[0],c1[1]-c0[1]],dw=[w1[0]-w0[0],w1[1]-w0[1]],den=dc[0]*dc[0]+dc[1]*dc[1];
    const sr=(dw[0]*dc[0]+dw[1]*dc[1])/den,si=(dw[1]*dc[0]-dw[0]*dc[1])/den,t=[w0[0]-(sr*c0[0]-si*c0[1]),w0[1]-(sr*c0[1]+si*c0[0])];
    GEO={k:pts.length,f:(e,n)=>{const ce=e,cn=-n;return toMap(sr*ce-si*cn+t[0],sr*cn+si*ce+t[1]);}};}}
function geoToMap(lat,lng){const [e,n]=geoEN(lat,lng);return GEO?GEO.f(e,n):{x:500+n/SX,y:386+e/SY};}
// survey frame: metres east/north → along-platform u and across v → map x,y
function surveyXY(g,e,n){const [oe,on]=geoEN(g.o[0],g.o[1]),E=e-oe,Nn=n-on,u=E*g.a[0]+Nn*g.a[1],v=-E*g.a[1]+Nn*g.a[0];return {x:g.cx+g.kx*u,y:120+g.ky*(v-g.v0)};}
const geoNote=()=>GEO&&GEO.survey?'Matched using the site survey.':GEO?`Matched using ${GEO.k} QR points with GPS.`:'Rough match until 2 or more QR points have GPS saved.';
function placeFromGps(fix){const m=geoToMap(fix.lat,fix.lng);const off=Math.max(0,-m.x,m.x-1000,-m.y,m.y-772);
  if(off>120)return {far:Math.round(off*.5)};return snapToWalkway(m.x,m.y);}
function captureGps(onFix,onEnd){let best=null,watch=null,done=false,tm=null;const t0=Date.now();
  const stop=why=>{if(done)return;done=true;if(watch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(watch);clearTimeout(tm);onEnd(why,best);};
  if(!navigator.geolocation){setTimeout(()=>stop('nogeo'),0);return ()=>{};}
  try{watch=navigator.geolocation.watchPosition(pos=>{const c=pos.coords;if(!best||c.accuracy<best.acc){best={lat:c.latitude,lng:c.longitude,acc:c.accuracy};onFix(best);}
      if(best.acc<=8||Date.now()-t0>15000)stop('ok');},err=>stop(err.code===1?'denied':'nofix'),{enableHighAccuracy:true,maximumAge:0,timeout:20000});}
  catch(e){setTimeout(()=>stop('denied'),0);}
  tm=setTimeout(()=>stop(best?'ok':'nofix'),16000);return ()=>stop('cancel');}
const gpsFail={nogeo:"This browser can't share your location. Pick the area and slide to the spot, or tap the map.",denied:"Location access isn't allowed here. Pick the area and slide to the spot, or tap the map.",nofix:"Couldn't get a GPS fix under the roof. Pick the area and slide to the spot, or tap the map."};

// ---- facility editor ----
function openFacEd(a){stopFacGps();const p=a?facPos(a):null,ex=a?PHOTOS['f-'+a.id]:null;
  ed.id=a?a.id:'new';ed.confirmDel=false;ed.msg='';ed.err=false;ed.busy=false;ed.gpsMsg='';
  ed.draft={count:a&&facCount(a)?facCount(a):'',unit:a?a.unit||'':'',pillar:a?a.pillar||'':'',nearFob:a?a.nearFob||'':'',cat:a?a.cat:'toilet',name:a?a.name:'',note:a?a.note||'':'',status:a?a.status||'open':'open',statusNote:a?a.statusNote||'':'',
    nameHi:a?a.nameHi||'':'',aliases:a?facAka(a).slice():[],kw:a?facKw(a).slice():[],from:a?a.from||'':'',until:a?a.until||'':'',use:a?a.use||'':'',
    area:p?p.area:'',x:p?p.x:500,y:p?p.y:PY(4),lat:a&&typeof a.lat==='number'?a.lat:null,lng:a&&typeof a.lng==='number'?a.lng:null,acc:a&&a.acc!=null?a.acc:null,
    ph:{url:ex&&ex.assetId?blobUrl(ex.assetId):null,blob:null,w:ex?ex.w||0:0,h:ex?ex.h||0:0,hs:ex?(ex.hotspots||[]).map(h=>({x:h.x,y:h.y,to:'here'})):[],cap:ex?ex.caption||'':'',remove:false,changed:false}};
  renderAdminList();renderEditor();}
function stopFacGps(){if(ed.stopGps){const f=ed.stopGps;ed.stopGps=null;f();}}
function facPlaceText(d){if(!d.area)return 'Not placed yet';const q=ptXY(d),auto=describePos(d.area,q.x,q.y);if(!/^pl\d$/.test(d.area))return auto;
  const L=facLoc(d);return L.miss.length?`${L.txt} · map suggests: ${auto.split(' · ').slice(1).join(' · ')||'—'}`:L.txt;}
function drawFacMini(){const d=ed.draft,svg=$('miniMap');if(!svg)return;drawMap(svg,{cat:d.cat,skipFac:ed.id,freePin:d.area?{area:d.area,x:d.x,y:d.y}:null,pinCls:'m-place'});
  const t=$('fPlace');if(t){t.textContent=facPlaceText(d);t.className='place-txt'+(d.area?'':' none');}}
function renderEditor(){const box=$('editor');
  if(!ed.id){box.innerHTML=`<p class="label" id="h-ed">Edit facility</p><p class="empty">Pick a facility from the list to change its status, details, location or photo, or add a new one.</p>`;return;}
  const d=ed.draft,ro=!canWrite(),vert=d.area&&isVert(d.area),ph=d.ph,showPh=ph.url&&!ph.remove,canUp=!!ASSETS;
  const rv=vert?ptXY(d).y:ptXY(d).x;
  box.innerHTML=`<p class="label" id="h-ed">${ed.id==='new'?'Add facility':'Edit facility'}</p>
  <form class="form" id="edForm" novalidate>
    <div class="field"><label for="f-name">Name</label><input id="f-name" value="${esc(d.name)}" placeholder="e.g. AC Lounge" ${ro?'disabled':''} required></div>
    <div class="field"><label for="f-namehi">Name in Hindi · हिंदी नाम</label><div class="inrow"><input id="f-namehi" value="${esc(d.nameHi||'')}" placeholder="${esc(hiAuto(d.name)||'e.g. एसी लाउंज')}" ${ro?'disabled':''}><button class="btn sm" type="button" id="f-hisug" ${ro?'disabled':''}>Suggest</button></div><small class="msg">Shown to passengers under the English name. Left empty, the suggestion in grey is used.</small></div>
    <div class="field"><label for="f-kw">Search words <small>(what passengers may type or say, in English, Hindi or Hinglish; separate with commas)</small></label><textarea id="f-kw" rows="3" placeholder="e.g. toilet, washroom, bathroom, शौचालय, pishab" ${ro?'disabled':''}>${esc((d.kw||[]).join(', '))}</textarea>
      <div class="actions" style="margin-top:4px"><button class="btn sm" type="button" id="f-kwsug" ${ro?'disabled':''}>Suggest search words</button><small class="msg">${(d.kw||[]).length} words. Passengers' search and voice search use these.</small></div></div>
    <div class="field"><label for="f-alias">Other names passengers may search for <small>(separate with commas)</small></label><input id="f-alias" value="${esc((d.aliases||[]).join(', '))}" placeholder="e.g. Ticket Counter, UTS Counter, Booking Window, टिकट खिड़की" ${ro?'disabled':''}></div>
    <div class="field"><label for="f-cat">Type</label><select id="f-cat" ${ro?'disabled':''}>${CAT_GROUPS.map(([g,en])=>{const cs=ADMIN_CATS.filter(c=>(c[4]||'E')===g);return cs.length?`<optgroup label="${g}. ${esc(en)}">${cs.map(c=>`<option value="${c[0]}" ${c[0]===d.cat?'selected':''}>${esc(c[1])}${c[2]?' · '+esc(c[2]):''}</option>`).join('')}</optgroup>`:'';}).join('')}<option value="__new" ${d.cat==='__new'?'selected':''}>+ Add a new type…</option></select></div>
    ${d.cat==='__new'?`<div class="field"><label for="f-catnew">New type</label><input id="f-catnew" value="${esc(d.catNew||'')}" maxlength="40" placeholder="e.g. Parcel Office, Prayer Room, Mobile Charging" ${ro?'disabled':''}><small class="msg" style="display:block;margin-top:4px">Saved with this facility and added to the Type list for next time.</small></div>`:''}
    ${countFields(d,['f-count','f-unit',false],ro)}
    <fieldset class="field"><legend>Status</legend><div class="seg">
      ${[['open','Open','var(--ok)'],['maintenance','Maintenance','var(--warn)'],['closed','Closed','var(--bad)']].map(([v,l,c])=>`<label style="--c:${c}"><input type="radio" name="f-status" id="f-st-${v}" value="${v}" ${d.status===v?'checked':''} ${ro?'disabled':''}>${l}</label>`).join('')}
    </div></fieldset>
    ${GATE_CATS.has(d.cat)?`<div class="field"><label for="f-use">This gate is for</label><select id="f-use" ${ro?'disabled':''}>${Object.entries(GATE_USE).map(([k,v])=>`<option value="${k}" ${k===(d.use||'')?'selected':''}>${v[0]} · ${v[1]}</option>`).join('')}</select><small class="msg" style="display:block;margin-top:4px">Passengers looking for a way out are only shown gates they can exit by. Also make the walkway through the gate one way on the Station map.</small></div>`:''}
    <div class="two"><div class="field"><label for="f-from">Show to passengers from <small>(optional)</small></label><input id="f-from" type="datetime-local" value="${esc(d.from||'')}" ${ro?'disabled':''}></div><div class="field"><label for="f-until">Until <small>${catGrp(d.cat)==='D'?'(set this for a temporary point)':'(optional)'}</small></label><input id="f-until" type="datetime-local" value="${esc(d.until||'')}" ${ro?'disabled':''}></div></div>
    ${catGrp(d.cat)==='D'&&!d.until?'<p class="msg err" style="margin-top:-6px">Temporary point: set “Until” so it disappears for passengers when the arrangement ends.</p>':''}${NO_NAV.has(d.cat)?'<p class="msg" style="margin-top:-6px">Shown on the passenger map as a warning; passengers are never routed to it.</p>':''}
    <div class="field" ${d.status==='open'?'hidden':''} id="stNoteWrap"><label for="f-statusnote">Note for passengers</label><input id="f-statusnote" value="${esc(d.statusNote)}" placeholder="e.g. Reopens 18 Oct · use the lounge on PF 16" ${ro?'disabled':''}></div>
    <div class="field"><span class="flabel">Location</span>
      <div class="gps">
        <div class="gps-head"><span class="msg${ed.gpsErr?' err':''}" id="fGpsMsg">${esc(ed.gpsMsg||'Standing at the facility? Use your live location to place it.')}</span>
          <button class="btn sm primary" type="button" id="fGps" ${ro||ed.stopGps?'disabled':''}>${ed.stopGps?'Reading GPS…':'Use my location'}</button></div>
        ${d.lat!=null?`<div class="geo">${fmtLL(d.lat,d.lng)} <span class="pill ${accClass(d.acc)}">${d.acc!=null?accText(d.acc):'saved'}</span></div>`:''}
      </div>
      <select id="f-area" aria-label="Area" ${ro?'disabled':''}><option value="">Choose area</option>${AREA_KEYS.map(k=>`<option value="${k}" ${k===d.area?'selected':''}>${areaLabel(k)}</option>`).join('')}</select>
      <label for="f-pos" class="flabel" style="margin-top:4px">Position along ${vert?'the bridge':'it'}</label>
      <input type="range" id="f-pos" min="${vert?CPY:50}" max="${vert?CAY:950}" step="1" value="${Math.round(rv)}" ${ro||!d.area?'disabled':''} style="width:100%;accent-color:var(--route)">
      <div class="rangeends"><span>◀ ${vert?'Paharganj side':''}</span><span>${vert?'Ajmeri Gate side':''} ▶</span></div>
      <div class="place-txt${d.area?'':' none'}" id="fPlace">${esc(facPlaceText(d))}</div>
      ${/^pl\d$/.test(d.area||'')?`<div class="two" style="margin-top:6px"><div class="field"><label for="f-pillar">Nearest pillar number</label><input id="f-pillar" value="${esc(d.pillar)}" maxlength="12" placeholder="e.g. 23" ${ro?'disabled':''}>${String(d.pillar||'').trim()?'':'<small class="req">Required: the pillar number painted nearest the facility</small>'}</div>
        <div class="field"><label for="f-fob">Nearest foot over bridge</label><select id="f-fob" ${ro?'disabled':''}>${'<option value="">Choose…</option>'+FOBS.map(f=>`<option value="${esc(f.id)}" ${d.nearFob===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}<option value="none" ${d.nearFob==='none'?'selected':''}>No foot over bridge nearby</option></select>${d.nearFob?'':'<small class="req">Required: the FOB closest to the facility</small>'}</div></div>`:''}
      <small>Or tap the exact spot on the map. It snaps onto the nearest platform, concourse or bridge.</small>
      <div class="mapbox mini"><svg id="miniMap" viewBox="0 0 1000 772" role="img" aria-label="Tap to place the facility"></svg></div></div>
    <div class="field"><label for="f-note">Details shown to passengers</label><textarea id="f-note" placeholder="e.g. Paid · AC seating, charging points" ${ro?'disabled':''}>${esc(d.note)}</textarea></div>
    <div class="field"><span class="flabel">Photo of the entrance <small>(optional)</small></span>
      ${showPh?`<div class="phimg" id="fPhImg" title="Tap to mark the entrance"><img src="${esc(ph.url)}" alt="Photo of the entrance">${ph.hs[0]?hsHtml(ph.hs[0],'Entrance'):''}</div>
        <div class="actions"><label class="btn sm" for="fPhFile">Replace photo</label><button class="btn sm danger" type="button" id="fPhRm" ${ro?'disabled':''}>Remove photo</button><span class="msg">${ph.hs[0]?'Tap again to move the entrance marker.':'Tap the photo to mark the entrance.'}</span></div>`
       :`<label class="drop" for="fPhFile"><b>Add a photo</b><span>${canUp?'Passengers see it on the last step of their route, so they recognise the entrance.':"Photo uploads aren't available in this view."}</span></label>`}
      <input class="vh" type="file" id="fPhFile" accept="image/*" capture="environment" ${ro||!canUp?'disabled':''}>
      ${showPh?`<input id="fPhCap" value="${esc(ph.cap)}" placeholder="What to look for, e.g. Blue IRCTC signboard" aria-label="What to look for" ${ro?'disabled':''}>`:''}
    </div>
    ${ed.confirmDel?`<div class="confirm"><span>Delete <b>${esc(d.name||'this facility')}</b>? Passengers will stop seeing it, and its photo is removed.</span><div class="actions"><button class="btn danger" type="button" id="delYes">Delete</button><button class="btn" type="button" id="delNo">Keep it</button></div></div>`:''}
    <div class="actions"><button class="btn primary" type="submit" ${ro||ed.busy?'disabled':''}>${ed.id==='new'?'Add facility':'Save changes'}</button>
      <button class="btn" type="button" id="edCancel">Cancel</button>
      ${ed.id!=='new'&&!ed.confirmDel?`<button class="btn danger" type="button" id="edDel" ${ro?'disabled':''}>Delete</button>`:''}
      <span class="msg${ed.err?' err':''}" role="status">${esc(ed.msg)}</span></div>
  </form>`;
  drawFacMini();}
function readForm(){const d=ed.draft;const v=id=>$(id)?$(id).value:null;const g=(id,k)=>{const x=v(id);if(x!==null)d[k]=x;};
  g('f-name','name');g('f-namehi','nameHi');if($('f-alias'))d.aliases=cleanAliases($('f-alias').value);if($('f-kw'))d.kw=cleanKw($('f-kw').value);g('f-cat','cat');g('f-catnew','catNew');g('f-note','note');g('f-from','from');g('f-until','until');g('f-use','use');g('f-count','count');g('f-unit','unit');g('f-statusnote','statusNote');g('f-pillar','pillar');g('f-fob','nearFob');if($('fPhCap'))d.ph.cap=$('fPhCap').value;
  const st=document.querySelector('input[name="f-status"]:checked');if(st)d.status=st.value;}
function setFacSpot(sp){const d=ed.draft;const ch=d.area!==sp.area&&(/^pl/.test(d.area||'')||/^pl/.test(sp.area));d.area=sp.area;d.x=sp.x;d.y=sp.y;if(ch)setTimeout(()=>{readForm();renderEditor();},0);}
$('editor').addEventListener('input',e=>{const t=e.target;if(!ed.draft)return;
  if(t.id==='f-pos'){const d=ed.draft;if(ed.stopGps){stopFacGps();ed.gpsMsg='GPS stopped. Placed by hand.';const m=$('fGpsMsg');if(m)m.textContent=ed.gpsMsg;const g=$('fGps');if(g){g.disabled=false;g.textContent='Use my location';}}
    if(isVert(d.area))d.y=+t.value;else d.x=+t.value;drawFacMini();}
  else if(t.id==='fPhCap'){ed.draft.ph.cap=t.value;ed.draft.ph.changed=true;}});
$('editor').addEventListener('change',async e=>{const t=e.target;if(!ed.draft)return;readForm();const d=ed.draft;
  if(t.id==='f-area'){if(ed.stopGps){stopFacGps();ed.gpsMsg='GPS stopped. Placed by hand.';}const prev=d.area;d.area=t.value;if(d.area&&isVert(d.area)&&!isVert(prev||''))d.y=PY(4);if(d.area&&!isVert(d.area)&&(prev===''||isVert(prev)))d.x=500;renderEditor();}
  else if(t.name==='f-status'){$('stNoteWrap').hidden=d.status==='open';}
  else if(t.id==='f-cat'){if(!cleanCount(d.count))d.unit='';renderEditor();if(d.cat==='__new'&&$('f-catnew'))$('f-catnew').focus();}
  else if(t.id==='f-pillar'||t.id==='f-fob'){renderEditor();}
  else if(t.id==='fPhFile'&&t.files&&t.files[0]){ed.msg='Preparing photo…';ed.err=false;renderEditor();
    try{const r=await shrink(t.files[0]);if(d.ph.blob&&d.ph.url)URL.revokeObjectURL(d.ph.url);Object.assign(d.ph,{blob:r.blob,w:r.w,h:r.h,url:URL.createObjectURL(r.blob),hs:[],remove:false,changed:true});ed.msg='';}
    catch(err){ed.err=true;ed.msg="Couldn't read that photo. Try a JPG or PNG.";}renderEditor();}});
$('editor').addEventListener('click',async e=>{const t=e.target;if(!ed.draft)return;
  const svg=t.closest&&t.closest('#miniMap');if(svg&&canWrite()){const p=svgPoint(svg,e);if(!p)return;readForm();if(ed.stopGps){stopFacGps();ed.gpsMsg='GPS stopped. Placed by hand.';}setFacSpot(snapToWalkway(p.x,p.y));renderEditor();return;}
  const pim=t.closest&&t.closest('#fPhImg');if(pim&&canWrite()){const r=pim.getBoundingClientRect();readForm();ed.draft.ph.hs=[{x:Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),y:Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100)),to:'here'}];ed.draft.ph.changed=true;renderEditor();return;}
  if(t.id==='fGps'){readForm();ed.gpsErr=false;ed.gpsMsg='Hold still. Taking the best of several readings…';
    ed.stopGps=captureGps(fix=>{const d=ed.draft;if(!d)return;d.lat=fix.lat;d.lng=fix.lng;d.acc=fix.acc;const sp=placeFromGps(fix);
        if(sp.far){ed.gpsErr=true;ed.gpsMsg=`You seem to be about ${sp.far} m outside the station map. Tap the map to place it.`;}
        else{setFacSpot(sp);ed.gpsErr=false;ed.gpsMsg=`Placed from GPS at ±${Math.round(fix.acc)} m. ${geoNote()}`;}readForm();renderEditor();},
      (why,best)=>{ed.stopGps=null;if(!ed.draft)return;readForm();
        if(why==='ok'&&best&&!ed.gpsErr)ed.gpsMsg=`Placed from GPS at ±${Math.round(best.acc)} m. ${best.acc>25?'GPS drifts under the roof, so check the spot and slide or tap to fine-tune. ':''}${geoNote()}`;
        else if(why!=='ok'&&why!=='cancel'){ed.gpsErr=true;ed.gpsMsg=gpsFail[why]||gpsFail.nofix;}renderEditor();});
    renderEditor();return;}
  if(t.id==='f-kwsug'){readForm();ed.draft.kw=cleanKw([...(ed.draft.kw||[]),...suggestKw(ed.draft.cat,ed.draft.name)]);renderEditor();return;}
  if(t.id==='f-hisug'){readForm();ed.draft.nameHi=hiAuto(ed.draft.name)||ed.draft.nameHi;renderEditor();return;}
  if(t.id==='fPhRm'){readForm();ed.draft.ph.remove=true;ed.draft.ph.changed=true;renderEditor();}
  else if(t.id==='edCancel'){stopFacGps();ed.id=null;ed.draft=null;renderAdminList();renderEditor();}
  else if(t.id==='edDel'){readForm();ed.confirmDel=true;renderEditor();}
  else if(t.id==='delNo'){ed.confirmDel=false;renderEditor();}
  else if(t.id==='delYes'){ed.busy=true;const id=ed.id,ex=PHOTOS['f-'+id];
    try{await DB.doc('facilities/'+id).delete();if(ex){try{await DB.doc('photos/f-'+id).delete();if(ASSETS&&ex.assetId)await ASSETS.delete(ex.assetId);}catch(_){}}
      const nm=ed.draft.name;stopFacGps();ed.id=null;ed.draft=null;ed.busy=false;renderAdminList();renderEditor();$('editor').querySelector('.empty').textContent=`Deleted ${nm}.`;}
    catch(err){ed.busy=false;ed.confirmDel=false;ed.msg=`Couldn't delete (${err.code||'error'}). Try again.`;ed.err=true;renderEditor();}}});
$('editor').addEventListener('submit',async e=>{e.preventDefault();if(!canWrite())return;readForm();const d=ed.draft;
  const fail=m=>{ed.busy=false;ed.msg=m;ed.err=true;renderEditor();};
  if(!d.name.trim()){fail('Give the facility a name.');$('f-name').focus();return;}
  if(d.cat==='__new'){const nn=String(d.catNew||'').trim();if(!nn){fail('Type the new facility type, e.g. Parcel Office.');if($('f-catnew'))$('f-catnew').focus();return;}
    const ex=CATS.find(c=>c[0]!=='platform'&&c[1].toLowerCase()===nn.toLowerCase());if(ex)d.cat=ex[0];else{d.cat=kindIdFor(nn);const row=[d.cat,nn,hiAuto(nn),kindLetter(nn),'E'];CATS.push(row);CAT[d.cat]={id:row[0],en:row[1],hi:row[2],code:row[3],grp:'E'};ADMIN_CATS=CATS.filter(c=>c[0]!=='platform');}
    d.catNew='';}
  if(!d.area)return fail('Choose where the facility is: use your location, pick an area, or tap the map.');
  if(d.ph.url&&!d.ph.remove&&d.ph.blob&&!ASSETS)return fail("Photo uploads aren't available in this view. Remove the photo to save the rest.");
  stopFacGps();ed.busy=true;ed.msg='Saving…';ed.err=false;renderEditor();
  try{const uid=USER?await USER.id():null,now=new Date().toISOString(),q=ptXY(d);
    const onPf=/^pl\d$/.test(d.area),exRec=ed.id!=='new'?(FAC.find(x=>x.id===ed.id)||{}):{};
    const body={...Object.fromEntries(Object.entries(exRec).filter(([k])=>!['id','_n'].includes(k))),count:cleanCount(d.count),unit:cleanCount(d.count)?(d.unit||defUnit(d.cat,d.name)):'',pillar:onPf?String(d.pillar||'').trim():'',nearFob:onPf?(d.nearFob||''):'',pf:onPf?barPf(+d.area.slice(2)):null,cat:d.cat,...(isXCat(d.cat)&&CAT[d.cat]?{catName:CAT[d.cat].en}:{}),name:d.name.trim(),nameHi:String(d.nameHi||'').trim(),aliases:cleanAliases(d.aliases),kw:(d.kw&&d.kw.length?cleanKw(d.kw):suggestKw(d.cat,d.name)),from:d.from||'',until:d.until||'',use:GATE_CATS.has(d.cat)?(d.use||''):'',area:d.area,x:q.x,y:q.y,node:nearestBase(d.area,q.x,q.y),note:d.note.trim(),status:d.status,statusNote:d.status==='open'?'':d.statusNote.trim(),
      lat:d.lat,lng:d.lng,acc:d.acc!=null?Math.round(d.acc*10)/10:null,updatedAt:now,updatedBy:uid||''};
    const ref=ed.id==='new'?DB.collection('facilities').doc():DB.doc('facilities/'+ed.id);await ref.set(body);ed.id=ref.id;
    const ph=d.ph,ex=PHOTOS['f-'+ref.id];let note='';
    if(ph.remove){if(ex){await DB.doc('photos/f-'+ref.id).delete();if(ASSETS&&ex.assetId){try{await ASSETS.delete(ex.assetId);}catch(_){}}}Object.assign(ph,{url:null,blob:null,hs:[],cap:'',remove:false,changed:false});}
    else if(ph.url&&(ph.blob||ph.changed)){let assetId=ex?ex.assetId:null;
      if(ph.blob){ed.msg='Uploading photo…';renderEditor();const r=await ASSETS.upload(ph.blob,{type:'image/jpeg'});assetId=r.id;}
      if(assetId){await DB.doc('photos/f-'+ref.id).set({assetId,w:ph.w,h:ph.h,caption:(ph.cap||'').trim(),hotspots:ph.hs.map(h=>({x:Math.round(h.x*100)/100,y:Math.round(h.y*100)/100,to:'here'})),label:body.name+' · entrance',updatedAt:now,updatedBy:uid||''});
        if(ph.blob&&ex&&ex.assetId&&ex.assetId!==assetId){try{await ASSETS.delete(ex.assetId);}catch(_){}}
        if(ph.blob)URL.revokeObjectURL(ph.url);Object.assign(ph,{url:blobUrl(assetId),blob:null,changed:false});note=' Photo saved.';}}
    ed.busy=false;ed.msg='Saved. Passengers see this now.'+note;ed.err=false;renderAdminList();renderEditor();}
  catch(err){const c=err&&err.code;fail(c==='invalid_argument'?"You don't have permission to change facilities.":/large/.test(c||'')?'That photo is too large. Try a smaller one.':`Couldn't save (${c||'error'}). Try again.`);}});

// ================= QR POINTS =================
const DEFAULT_BASE=location.origin+'/';
$('baseUrl').value=DEFAULT_BASE;
const linkFor=id=>$('baseUrl').value.trim().split('#')[0]+'#'+id;
const qrCanWrite=()=>!!DB&&CAN_EDIT&&QR_SOURCE!=='error';
let fontsReady=null;
function loadFonts(){if(!fontsReady)fontsReady=Promise.all([document.fonts.load('700 100px "Barlow Condensed"'),document.fonts.load('600 100px "Barlow Condensed"'),document.fonts.load('700 50px Hind','रास्ता जानने'),document.fonts.load('600 50px Hind','रास्ता जानने'),document.fonts.load('500 40px Hind','Lounges')]).catch(()=>{});return fontsReady;}
function fit(g,text,font,size,max){let s=size;g.font=font.replace('{s}',s);while(g.measureText(text).width>max&&s>20){s-=4;g.font=font.replace('{s}',s);}return s;}
function drawPoster(pt,canvas){
  const W=1200,H=1760;canvas.width=W;canvas.height=H;const g=canvas.getContext('2d');const BC='"Barlow Condensed","Arial Narrow",sans-serif',HI='Hind,sans-serif';
  const title=pt.name.toUpperCase(),titleHi=(pt.nameHi||'').trim()||hiAuto(pt.name),M=W-140;
  const line=(t,font,size,y,col,align)=>{g.fillStyle=col;g.textAlign=align||'left';fit(g,t,font,size,M);g.fillText(t,align==='center'?W/2:70,y);g.textAlign='left';};
  g.fillStyle='#FFFFFF';g.fillRect(0,0,W,H);
  // header: Hindi on top, English below
  g.fillStyle='#F3C531';g.fillRect(0,0,W,300);
  line(FEAT.tell?'स्कैन करें: रास्ता जानें · हमें बताएं':'रास्ता जानने के लिए स्कैन करें',`700 {s}px ${HI}`,96,128,'#151515');
  line(FEAT.tell?'SCAN FOR DIRECTIONS · TELL US':'SCAN FOR DIRECTIONS',`700 {s}px ${BC}`,92,240,'#151515');
  // where you are
  line('आप यहाँ हैं · YOU ARE AT',`700 {s}px ${HI}`,40,362,'#4A525A');
  if(titleHi){line(titleHi,`700 {s}px ${HI}`,100,474,'#151515');line(title,`700 {s}px ${BC}`,84,566,'#151515');}
  else line(title,`700 {s}px ${BC}`,120,520,'#151515');
  line(areaHi(pt.area),`700 {s}px ${HI}`,40,626,'#4A525A');
  line(areaLabel(pt.area),`700 {s}px ${BC}`,42,676,'#4A525A');
  const q=qrcode(0,'M');q.addData(linkFor(pt.id));q.make();const n=q.getModuleCount(),quiet=4,cell=Math.floor(700/(n+quiet*2)),qs=cell*(n+quiet*2),x0=Math.round((W-qs)/2),y0=716;
  g.fillStyle='#151515';g.fillRect(x0-8,y0-8,qs+16,qs+16);g.fillStyle='#FFFFFF';g.fillRect(x0,y0,qs,qs);g.fillStyle='#000000';
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))g.fillRect(x0+(c+quiet)*cell,y0+(r+quiet)*cell,cell,cell);
  const yb=y0+qs+62;
  line('स्कैन करें और पाएँ रास्ता: लाउंज · प्रतीक्षालय · शौचालय · प्लेटफॉर्म · भोजन',`600 {s}px ${HI}`,36,yb,'#151515','center');
  line('Scan for the way to: Lounges · Waiting rooms · Toilets · Platforms · Food',`500 {s}px ${HI}`,30,yb+46,'#4A525A','center');
  g.fillStyle='#18212B';g.fillRect(0,H-190,W,190);
  g.fillStyle='#F3C531';g.fillRect(70,H-142,150,64);g.fillStyle='#151515';g.font=`700 46px ${BC}`;g.textAlign='center';g.fillText('NDLS',145,H-94);
  g.textAlign='left';g.fillStyle='#FFFFFF';g.font=`600 40px ${HI}`;g.fillText('नई दिल्ली · New Delhi',250,H-118);
  g.fillStyle='#C9CFD6';g.font=`500 27px ${HI}`;g.fillText('उत्तर रेलवे · दिल्ली मंडल',250,H-76);g.font=`500 25px ${HI}`;g.fillText('Northern Railway · Delhi Division',250,H-40);
  g.textAlign='right';g.fillStyle='#F3C531';g.font=`600 34px ${BC}`;g.fillText(pt.id.toUpperCase(),W-70,H-106);
  if(hasLL(pt)){g.fillStyle='#C9CFD6';g.font=`500 24px ${BC}`;g.fillText(fmtLL(pt.lat,pt.lng),W-70,H-66);}
  g.textAlign='left';}
// Hindi name suggested from the English one (staff can correct it)
const HI_WORDS=[['yatri suvidha kendra','यात्री सुविधा केंद्र'],['pay & use','पे एंड यूज़'],['pay and use','पे एंड यूज़'],['jan ahaar','जन आहार'],['first aid','प्राथमिक चिकित्सा'],['help desk','सहायता केंद्र'],['post office','डाकघर'],['food plaza','फूड प्लाज़ा'],['food court','फूड कोर्ट'],
  ['ladies','महिला'],['gents','पुरुष'],['atvm','एटीवीएम'],['atm','एटीएम'],['uts','यूटीएस'],['prs','पीआरएस'],['irctc','आईआरसीटीसी'],['grp','जीआरपी'],['rpf','आरपीएफ'],['executive','एग्जीक्यूटिव'],['ac','एसी'],['bank','बैंक'],['current','करंट'],['normal','सामान्य'],
  ['booth','बूथ'],['medical','चिकित्सा'],['chemist','दवा की दुकान'],['pharmacy','दवा की दुकान'],['wheelchair','व्हीलचेयर'],['taxi','टैक्सी'],['auto','ऑटो'],['tea','चाय'],['coffee','कॉफ़ी'],['canteen','कैंटीन'],['restaurant','रेस्टोरेंट'],['food','भोजन'],['shop','दुकान'],
  ['book','पुस्तक'],['dormitory','डॉरमेट्री'],['mobile','मोबाइल'],['charging','चार्जिंग'],['police','पुलिस'],['parcel','पार्सल'],['room','कक्ष'],['machine','मशीन'],['kiosk','कियोस्क'],['washroom','शौचालय'],['urinal','मूत्रालय'],['bath','स्नानघर'],['enquiry','पूछताछ'],
  ['foot over bridge','फुट ओवर ब्रिज'],['main entrance','मुख्य प्रवेश द्वार'],['sadar bazar end','सदर बाज़ार छोर'],['nizamuddin end','निज़ामुद्दीन छोर'],['ajmeri gate side','अजमेरी गेट साइड'],['paharganj side','पहाड़गंज साइड'],
  ['booking office','बुकिंग कार्यालय'],['reservation','आरक्षण'],['waiting room','प्रतीक्षालय'],['waiting hall','प्रतीक्षालय'],['catering stall','खानपान स्टॉल'],['drinking water','पेयजल'],['ajmeri gate','अजमेरी गेट'],['entry & exit','प्रवेश व निकास'],
  ['exit only','केवल निकास'],['entry only','केवल प्रवेश'],['sadar bazar','सदर बाज़ार'],['nizamuddin','निज़ामुद्दीन'],['paharganj','पहाड़गंज'],['platform','प्लेटफॉर्म'],['pillar','खंभा'],['gate','गेट'],['fob','एफओबी'],['entrance','प्रवेश द्वार'],['entry','प्रवेश'],['exit','निकास'],
  ['metro','मेट्रो'],['parking','पार्किंग'],['main','मुख्य'],['hall','हॉल'],['concourse','कॉनकोर्स'],['enquiry','पूछताछ'],['counters','काउंटर'],['counter','काउंटर'],['toilets','शौचालय'],['toilet','शौचालय'],['lounge','लाउंज'],['stairs','सीढ़ियाँ'],
  ['lift','लिफ्ट'],['escalator','एस्केलेटर'],['middle','मध्य'],['end','छोर'],['side','साइड'],['closed','बंद'],['new','नया'],['and','व'],['ticket','टिकट'],['booking','बुकिंग'],['office','कार्यालय'],['water','पानी'],['stall','स्टॉल'],['cloak room','अमानती घर'],['retiring room','विश्रामालय']];
// a facility's Hindi name: typed by staff, else suggested from the English; other names passengers may use
const facHi=a=>String(a&&a.nameHi||'').trim()||hiAuto(a&&a.name)||'';
const facAka=a=>Array.isArray(a&&a.aliases)?a.aliases.filter(Boolean):[];
const cleanAliases=v=>[...new Set((Array.isArray(v)?v:String(v||'').split(/[,;\n]/)).map(x=>String(x).trim()).filter(Boolean))].slice(0,12);
const facKw=a=>Array.isArray(a&&a.kw)?a.kw.filter(Boolean):[];
const facWords=a=>[a.name,facHi(a),...facAka(a),...facKw(a)].join(' ');
function optNameHtml(a){const hi=facHi(a),aka=facAka(a);return `${esc(a.name)}${hi?`<span class="nhi">${esc(hi)}</span>`:''}${aka.length?`<span class="aka">also: ${esc(aka.join(', '))}</span>`:''}`;}
// ---- search words: by type, plus words for what a facility's name says it offers (same rules used to write them for every facility) ----
const cleanKw=v=>{const out=[];(Array.isArray(v)?v:String(v||'').split(/[,;\n]/)).forEach(x=>{x=String(x).trim();if(x&&!out.some(y=>y.toLowerCase()===x.toLowerCase()))out.push(x);});return out.slice(0,80);};
const KW_CAT={ysk:'yatri suvidha kendra,ysk,ticket office,booking office,यात्री सुविधा केंद्र,टिकट घर',mih:'may i help you,help desk,madad,sahayata,information,help booth,मदद,सहायता,मे आई हेल्प यू',
 pharmacy:'chemist,medical store,dawai,dawa,medicine,pharmacy,दवा की दुकान,दवाई',charging:'mobile charging,charging point,phone charge,charger,मोबाइल चार्जिंग,चार्जिंग',feeding:'baby feeding,feeding room,mother,baby care,शिशु आहार,बच्चे को दूध',
 gate:'gate,entry,exit,entrance,bahar,andar,gate number,निकास,प्रवेश,गेट,बाहर',pfentry:'platform entry,platform entrance,प्लेटफॉर्म प्रवेश',fobaccess:'fob,foot over bridge,bridge,pul,overbridge,पुल,फुट ओवर ब्रिज',subway:'subway,underpass,niche ka rasta,सबवे',
 lift:'lift,elevator,लिफ्ट',escalator:'escalator,chalti seedhi,एस्केलेटर,चलती सीढ़ी',stairs:'stairs,seedhi,sidhi,ramp,सीढ़ी,सीढ़ियाँ,रैंप',parking:'parking,car parking,bike parking,पार्किंग',dropoff:'drop,pick up,pickup,drop off,car drop,पिक अप,ड्रॉप',
 police:'police,rpf,grp,thana,chowki,complaint,chori,theft,पुलिस,थाना,चौकी,चोरी',sm:'station master,sm office,स्टेशन मास्टर',parcel:'parcel,courier,luggage booking,पार्सल',cmi:'commercial inspector,cmi,वाणिज्य निरीक्षक',
 lostfound:'lost,found,lost and found,khoya,khoya paya,saman kho gaya,खोया पाया,खो गया',complaint:'complaint,rail madad,shikayat,शिकायत,रेल मदद',
 tmpticket:'special ticket,festival counter,extra ticket counter,chhath,diwali,holi,mela,विशेष टिकट',holding:'holding area,waiting area,pandal,shed,होल्डिंग',tmpgate:'extra gate,additional gate,new gate,अतिरिक्त गेट',
 tmpfood:'temporary food,stall,food,खाना',tmphelp:'help desk,special help,सहायता डेस्क',queue:'queue,line,lane,कतार,लाइन',tmpwater:'water,pani,temporary water,पानी',tmptoilet:'mobile toilet,toilet,शौचालय',
 guide:'guidance,help,direction,rasta,रास्ता',diversion:'diversion,closed way,route changed,रास्ता बदला',restricted:'restricted,no entry,प्रतिबंधित',assembly:'emergency,assembly point,एकत्र स्थल,आपातकाल',emexit:'emergency exit,exit,आपातकालीन निकास',
 toilet:'toilet,toilets,washroom,bathroom,restroom,loo,latrine,urinal,wc,shauchalay,sauchalay,toilet kahan hai,bathroom kidhar hai,pishab,peshab,sulabh,शौचालय,टॉयलेट,बाथरूम,पेशाब,लैट्रिन,सुलभ',
 water:'water,drinking water,pani,paani,peene ka pani,thanda pani,cold water,water cooler,water booth,pyaas,pyas lagi,bottle bharna,पानी,पीने का पानी,ठंडा पानी,प्यास,पेयजल,वाटर कूलर',
 food:'food,khana,khaana,bhojan,nashta,breakfast,lunch,dinner,snacks,tea,chai,coffee,meal,thali,canteen,bhookh,bhook lagi,hungry,kuch khana hai,eat,खाना,भोजन,नाश्ता,चाय,भूख,जलपान,कैंटीन',
 ticket:'ticket,tickets,ticket counter,ticket window,ticket ghar,booking,booking office,tikat,tikit,टिकट,टिकट घर,टिकट खिड़की,बुकिंग',
 atm:'atm,cash,money,paise,paisa nikalna,cash withdrawal,bank,एटीएम,पैसे,पैसा निकालना,बैंक',
 lounge:'lounge,ac lounge,executive lounge,ac waiting,premium waiting,aaram,rest,एसी लाउंज,लाउंज,आराम',
 waiting:'waiting room,waiting hall,wait,baithne ki jagah,baithna,seat,sitting,intezar,train ka intezar,प्रतीक्षालय,वेटिंग रूम,बैठने की जगह,इंतज़ार',
 enquiry:'enquiry,inquiry,information,help desk,train timing,train kab aayegi,kaunsa platform,poochtach,puchtach,पूछताछ,जानकारी,गाड़ी कब आएगी',
 cloak:'cloak room,luggage,baggage,saman,saman rakhna,bag rakhna,locker,अमानती घर,सामान,सामान रखना,लॉकर',
 retiring:'retiring room,room,stay,rukna,sona,dormitory,hotel,विश्रामालय,रुकने की जगह,कमरा',
 medical:'first aid,medical,doctor,dawai,dava,dawa,medicine,injury,chot,emergency,hospital,ilaaj,प्राथमिक चिकित्सा,डॉक्टर,दवा,दवाई,चोट,इमरजेंसी',
 transport:'taxi,auto,cab,metro,bus,parking,ola,uber,टैक्सी,ऑटो,मेट्रो,बस,पार्किंग',
 help:'help,sahayata,madad,wheelchair,stretcher,porter,coolie,kuli,golf cart,battery car,buggy,announcement,elaan,lost,khoya,सहायता,मदद,व्हीलचेयर,कुली,बैटरी कार,घोषणा',
 shop:'shop,store,dukaan,stall,दुकान'};
const KW_RULES=[[/juice|fruit/,'juice,fresh juice,fruit,phal,fal,mosambi,orange juice,santra,जूस,फल,मौसमी'],[/lichi|apple|soup/,'apple juice,lichi juice,soup,सूप,सेब का जूस'],[/namkeen|biscuit|cold drink/,'namkeen,biscuit,biscuits,cold drink,soft drink,chips,packet,packed food,नमकीन,बिस्कुट,कोल्ड ड्रिंक'],
 [/amul|dugdh|milk/,'milk,doodh,lassi,chaach,buttermilk,dahi,curd,दूध,लस्सी,छाछ,दही'],[/jan ahaar/,'jan ahaar,janahar,cheap food,sasta khana,thali,poori sabzi,irctc,जन आहार,सस्ता खाना,थाली'],[/food plaza|refreshment/,'food plaza,refreshment room,restaurant,veg thali,फूड प्लाज़ा,रिफ्रेशमेंट रूम,रेस्टोरेंट'],
 [/haldiram|kfc|momo|nazeer|pizza|burger|domino|mcdonald/,'chicken,burger,momos,biryani,pizza,fast food,non veg,मोमो,बिरयानी'],[/trolley/,'food trolley,trolley,moving stall,ट्रॉली'],[/stall/,'stall,khoka,स्टॉल'],[/khaan|khan pan|paan sewa|pan seva/,'khan pan,railway catering,railway food,रेलवे खानपान'],
 [/tea|coffee|chai/,'tea,chai,coffee,चाय,कॉफ़ी'],[/book|pustak|gita press|iskcon|ramakrishna/,'book,books,kitab,magazine,religious books,dharmik pustak,किताब,पुस्तक,धार्मिक पुस्तक'],[/ladies|women|mahila/,'ladies,women,mahila,female,महिला,लेडीज़'],
 [/sleeper/,'sleeper class,sleeper waiting,स्लीपर'],[/\bac\b/,'ac,air conditioned,thanda kamra,एसी'],[/pay & use|pay and use/,'pay and use,paid toilet,sulabh shauchalay,पे एंड यूज़'],[/\(ro\)|\bro\b/,'ro water,purified water,filter water,saaf pani,साफ़ पानी,आरओ'],
 [/atvm/,'atvm,ticket machine,automatic ticket machine,smart card,qr ticket,टिकट मशीन'],[/\buts\b/,'uts,unreserved ticket,general ticket,jan sadharan ticket,platform ticket,जनरल टिकट,अनारक्षित टिकट'],
 [/reservation|prs/,'prs,reservation counter,reservation,confirm ticket,booking counter,आरक्षण,रिज़र्वेशन'],[/current/,'current reservation,current booking,tatkal,तत्काल'],[/wheelchair|stretcher|golf cart|announcement/,'wheelchair,divyang,disabled,senior citizen,buzurg,दिव्यांग,बुज़ुर्ग'],
 [/ysk|yatri suvidha/,'yatri suvidha kendra,ysk,यात्री सुविधा केंद्र'],[/parcel/,'parcel,courier,saman bhejna,पार्सल'],[/police|grp|rpf/,'police,complaint,shikayat,chori,theft,पुलिस,शिकायत,चोरी']];
function suggestKw(cat,name){let w=(KW_CAT[cat]||'').split(',');const n=String(name||'').toLowerCase();KW_RULES.forEach(([rx,x])=>{if(rx.test(n))w=w.concat(x.split(','));});
  if(!KW_CAT[cat]&&CAT[cat])w=w.concat([CAT[cat].en,CAT[cat].hi].filter(Boolean));return cleanKw(w);}
function hiAuto(en){let t=' '+String(en||'')+' ';HI_WORDS.forEach(([e,h])=>{t=t.replace(new RegExp('(^|[^a-z])'+e.replace(/[.*+?^${}()|[\]\\&]/g,'\\$&')+'(?=[^a-z]|$)','gi'),(m,p)=>p+h);});
  t=t.trim();return /[ऀ-ॿ]/.test(t)?t:'';}
let qrBuilt='';
function renderQrNotice(){const n=$('qrNotice');let html='';
  if(!DB)html=`<span>QR points can't be saved in this view because the database isn't available. The starter points are shown.</span>`;
  else if(QR_SOURCE==='error')html=`<span>The QR point database stopped responding. Reload the page to try again.</span>`;
  else if(QR_SOURCE==='empty')html=`<span>No QR points saved yet, so passengers get the 15 starter points. Load them to start editing, or create your own with New QR point.</span><button class="btn sm primary" id="seedQrBtn" type="button">Load starter points</button>`;
  n.innerHTML=html;n.hidden=!html;}
async function renderQR(){renderQrNotice();const base=$('baseUrl').value.trim();const okBase=/^https?:\/\/\S+$/.test(base);
  $('newQrBtn').disabled=!qrCanWrite();
  $('zipBtn').disabled=!okBase||!DL||!window.JSZip;$('csvBtn').disabled=!okBase||!DL;
  if(!window.qrcode){$('posters').innerHTML='<p class="empty">The QR code library didn\'t load. Check your connection and reload the page.</p>';return;}
  if(!okBase){setQrMsg('Enter the full link of the app, starting with https://',true);return;}
  const key=base+'|'+qrStamp;if(qrBuilt===key)return;qrBuilt=key;await loadFonts();
  const pts=sortedPts();
  $('posters').innerHTML=GROUPS.map(g=>{const list=pts.filter(p=>areaGroup(p.area)===g);if(!list.length)return '';
    return `<div class="grp-h">${g} · ${list.length}</div><div class="posters">${list.map(p=>`<div class="poster"><canvas data-poster="${esc(p.id)}" aria-label="QR sign for ${esc(p.name)}"></canvas>
    <div><b>${esc(p.name)}</b><div class="pid">${esc(p.id.toUpperCase())} · ${esc(p.kind||'')}</div>
    <div class="geo">${hasLL(p)?`${fmtLL(p.lat,p.lng)} <span class="pill ${accClass(p.acc)}">${p.acc!=null?'±'+Math.round(p.acc)+' m':'typed in'}</span>`:'<span class="pill none">No GPS fix saved</span>'}</div></div>
    <div class="link" id="lk-${esc(p.id)}">${esc(linkFor(p.id))}</div>
    <div class="actions"><button class="btn sm primary" type="button" data-png="${esc(p.id)}" ${DL?'':'disabled'}>Download PNG</button><button class="btn sm" type="button" data-copy="${esc(p.id)}">Copy link</button>${qrCanWrite()?`<button class="btn sm" type="button" data-qedit="${esc(p.id)}">Edit</button>`:''}</div></div>`).join('')}</div>`;}).join('');
  document.querySelectorAll('[data-poster]').forEach(c=>drawPoster(getPt(c.dataset.poster),c));}
function setQrMsg(t,err){const m=$('qrMsg');m.textContent=t||'';m.className='msg'+(err?' err':'');}
$('baseUrl').addEventListener('change',()=>{setQrMsg('');qrBuilt='';renderQR();});
const toBlob=c=>new Promise(r=>c.toBlob(r,'image/png'));
async function save(filename,data){try{await DL.save({filename,data});setQrMsg(`Saved ${filename}.`);}
  catch(err){const c=err&&err.code;if(c==='declined')setQrMsg('Download cancelled.');else if(c==='rate_limited')setQrMsg('Another download is waiting for your confirmation.');else setQrMsg(`Couldn't download (${c||'error'}).`,true);}}
$('posters').addEventListener('click',async e=>{const p=e.target.closest('[data-png]'),cp=e.target.closest('[data-copy]'),qe=e.target.closest('[data-qedit]');
  if(qe){openQrEd(qe.dataset.qedit);return;}
  if(p&&DL){const c=document.querySelector(`[data-poster="${CSS.escape(p.dataset.png)}"]`);await save(`NDLS-QR-${p.dataset.png}.png`,await toBlob(c));}
  if(cp){const t=linkFor(cp.dataset.copy);navigator.clipboard.writeText(t).then(()=>{cp.textContent='Copied';setTimeout(()=>cp.textContent='Copy link',1500);})
    .catch(()=>{const r=document.createRange();r.selectNodeContents($('lk-'+cp.dataset.copy));const s=getSelection();s.removeAllRanges();s.addRange(r);setQrMsg('Link selected. Press Ctrl+C to copy.');});}});
$('zipBtn').addEventListener('click',async()=>{if(!DL||!window.JSZip)return;setQrMsg('Preparing ZIP…');const zip=new JSZip();
  for(const c of document.querySelectorAll('[data-poster]'))zip.file(`NDLS-QR-${c.dataset.poster}.png`,await toBlob(c));
  zip.file('qr-points.csv',csv());await save('NDLS-QR-signs.zip',await zip.generateAsync({type:'blob'}));});
function csv(){return 'qr_id,name,type,area,latitude,longitude,gps_accuracy_m,link\n'+sortedPts().map(s=>[s.id,s.name,s.kind||'',areaLabel(s.area),hasLL(s)?s.lat.toFixed(6):'',hasLL(s)?s.lng.toFixed(6):'',s.acc!=null?Math.round(s.acc):'',linkFor(s.id)].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')+'\n';}
$('csvBtn').addEventListener('click',()=>{if(DL)save('NDLS-QR-points.csv',csv());});
$('qrNotice').addEventListener('click',async e=>{if(e.target.id!=='seedQrBtn'||!DB)return;e.target.disabled=true;
  try{const uid=USER?await USER.id():null;const now=new Date().toISOString();
    for(const p of BUILTIN_QR){await DB.doc('qrpoints/'+p.id).set({name:p.name,nameHi:p.nameHi,kind:p.kind,area:p.area,x:p.x,lat:null,lng:null,acc:null,updatedAt:now,updatedBy:uid||''});}}
  catch(err){e.target.disabled=false;setQrMsg(`Couldn't load the starter points (${err.code||'error'}).`,true);}});

// ---- QR point editor ----
const qed={id:null,d:null,codeTouched:false,confirmDel:false,msg:'',err:false,busy:false,watch:null,timer:null};
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32);
const areaPrefix=a=>a==='P'?'pg-':a==='A'?'ag-':isFob(a)?slug(fobShort(FOB_BY[a]))+'-':a?'pf'+(a==='pl0'?1:a==='pl8'?16:2*+a.slice(2))+'-':'';
function autoCode(){const d=qed.d;let base=slug(d.name.replace(/platform\s*\d+(\/\d+)?/i,''))||'point';let c=areaPrefix(d.area)+base;c=c.replace(/^(pf\d+-)pf\d+-?/,'$1');
  let out=c,n=2;while(getPt(out)&&out!==qed.id)out=c+'-'+(n++);return out;}
function openQrEd(id){stopGps();const p=id?getPt(id):null;
  qed.id=id||'new';qed.codeTouched=!!id;qed.hiTouched=!!(p&&p.nameHi);qed.sv='';qed.confirmDel=false;qed.msg='';qed.err=false;qed.busy=false;
  qed.manual=!!p&&p.placed!=='gps';
  qed.d=p?{name:p.name,nameHi:p.nameHi||'',kind:p.kind||'Other',use:p.use||'',area:p.area,x:ptXY(p).x,y:ptXY(p).y,lat:hasLL(p)?p.lat:null,lng:hasLL(p)?p.lng:null,acc:p.acc!=null?p.acc:null,code:p.id,head:typeof p.head==='number'?p.head:null}
          :{name:'',nameHi:'',kind:'Gate',area:'',x:null,y:null,lat:null,lng:null,acc:null,code:'',head:null};
  renderQrEd();$('qrSheet').hidden=false;setTimeout(()=>{const f=$('q-name');if(f)f.focus();},30);}
// ---- QR boards from site-survey points: name, exact coordinates and spot on the model ----
// A spot that already has a QR can't be picked again, unless the point changed in the site survey after the QR was made.
function svSigOf(val){if(!val)return '';const r=v=>typeof v==='number'?v.toFixed(6):'';
  if(val.startsWith('s:')){const p=SURVEY[val.slice(2)];if(!p)return '';return [p.t,r(p.lat),r(p.lng),p.n||'',p.name||'',p.side||'',p.status||'',p.pf||'',p.end||'',p.pillar||'',p.bridge||'',p.to||''].join('|');}
  const a=FAC.find(x=>x.id===val.slice(2));if(!a)return '';return ['fac',r(a.lat),r(a.lng),a.name||'',a.cat||'',a.pf||'',a.pillar||''].join('|');}
function qrStateOf(val){const qs=QRPTS.filter(q=>q.sv===val);if(!qs.length)return {made:false,qs};const sig=svSigOf(val);
  const changed=qs.every(q=>q.svSig&&q.svSig!==sig);return {made:true,changed,qs};}
let qrSigBackfilled=false;
async function qrBackfillSig(){if(qrSigBackfilled||!DB||!qrCanWrite())return;qrSigBackfilled=true;
  // QR boards made before this check existed: record what their point looks like now, so later changes are noticed
  for(const q of QRPTS){if(!q.sv||q.svSig)continue;const sig=svSigOf(q.sv);if(!sig)continue;const rec=Object.assign({},q,{svSig:sig});delete rec.id;try{await DB.doc('qrpoints/'+q.id).set(rec);}catch(_){}}}
function qrSurveyOptions(){const o=[];const pts=Object.entries(SURVEY).map(([id,p])=>Object.assign({id},p)).filter(p=>typeof p.lat==='number');
  const add=(grp,val,label)=>o.push({grp,val,label});
  pts.filter(p=>p.t==='gate').sort((a,b)=>String(a.n).localeCompare(String(b.n),undefined,{numeric:true})).forEach(p=>add('Gates and entries','s:'+p.id,`${gateText(p.n)} · ${sideName(p.side==='A'?'A':'P')}`));
  pts.filter(p=>p.t==='entry').forEach(p=>add('Gates and entries','s:'+p.id,`${p.name} · ${sideName(p.side==='A'?'A':'P')}`));
  pts.filter(p=>p.t==='pfend'||p.t==='pillar').sort((a,b)=>pfBar(+a.pf)-pfBar(+b.pf)||(a.t===b.t?String(a.pillar||a.end).localeCompare(String(b.pillar||b.end),undefined,{numeric:true}):a.t==='pfend'?-1:1))
    .forEach(p=>add('Platforms','s:'+p.id,svQrName(p)));
  pts.filter(p=>p.t==='fob'&&p.to).forEach(p=>add('Foot over bridges','s:'+p.id,svQrName(p)));
  FAC.filter(a=>a.src==='survey'&&typeof a.lat==='number').forEach(a=>add('Amenities','f:'+a.id,a.name+(a.pf?` · ${platLabel(pfBar(+a.pf))}`:'')));
  return o;}
function svQrName(p){if(p.t==='gate')return gateText(p.n);if(p.t==='entry')return p.name||'Station entry';
  if(p.t==='pfend'){const lm=LAYOUT&&LAYOUT.geo?landmarkAt('pl'+pfBar(+p.pf),qrSpotFor(p).x):'';return `${platLabel(pfBar(+p.pf))} · platform end${lm&&lm.startsWith('pillar')?' near '+lm:''}`;}if(p.t==='pillar')return `${platLabel(pfBar(+p.pf))} · Pillar ${p.pillar}`;
  if(p.t==='fob'){const w=p.lift&&!p.stairs?'lift':p.esc&&!p.stairs?'escalator':'stairs';return p.to==='pf'?`${platLabel(pfBar(+p.pf))} · ${fobShort({name:p.bridge})} ${w}`:p.to==='gate'?`${svGateName(p.gate)} · ${fobShort({name:p.bridge})} ${w}`:`${sideName(p.to)} · ${fobShort({name:p.bridge})} ${w}`;}return 'Survey point';}
function qrSurveyPicker(d,ro){if(qed.id!=='new')return '';const o=qrSurveyOptions();if(!o.length)return `<p class="msg">Tip: points recorded in <b>Site survey</b> can be picked here to fill in the name and the exact position.</p>`;
  const grps=[...new Set(o.map(x=>x.grp))];
  qrBackfillSig();let nMade=0,nChanged=0;
  const opt=x=>{const st=qrStateOf(x.val),codes=st.made?st.qs.map(q=>q.id.toUpperCase()).join(', '):'';if(st.made&&!st.changed)nMade++;if(st.made&&st.changed)nChanged++;
    const lab=st.made?(st.changed?`⟳ ${x.label} · changed since QR ${codes} was made`:`✓ ${x.label} · QR made (${codes})`):x.label;
    return `<option value="${esc(x.val)}"${x.val===qed.sv?' selected':''}${st.made&&!st.changed?' disabled':''}>${esc(lab)}</option>`;};
  const cur=qed.sv?qrStateOf(qed.sv):null;
  return `<div class="field svpick"><label for="q-sv">Take from site survey</label><select id="q-sv" ${ro?'disabled':''}>${'<option value="">Choose a recorded point…</option>'+grps.map(g=>`<optgroup label="${esc(g)}">${o.filter(x=>x.grp===g).map(opt).join('')}</optgroup>`).join('')}</select>
    <small>Fills in the name (Hindi and English), the type and the exact coordinates recorded on site. ${nMade?`<b>✓</b> marks spots that already have a QR (${nMade}); they can't be picked again. `:''}${nChanged?`<b>⟳</b> marks spots changed in the site survey since their QR was made (${nChanged}): making a new QR for one replaces the old one.`:''}</small>
    ${cur&&cur.made?`<p class="msg err" style="margin-top:6px">Saving will <b>delete the old QR ${esc(cur.qs.map(q=>q.id.toUpperCase()).join(', '))}</b> for this spot. Print the new sign and replace the old board.</p>`:''}</div>`;}
function qrSpotFor(p){const geo=LAYOUT&&LAYOUT.geo;const gx=(lat,lng)=>geo?surveyXY(geo,...geoEN(lat,lng)):geoToMap(lat,lng);
  const onPf=(bar,x)=>({area:'pl'+bar,x:Math.max(50,Math.min(950,Math.round(x))),y:PY(bar)});
  if(p.t==='gate'||p.t==='entry'){const g=GATES.find(r=>r[3]&&(r[3].id==='sg-'+p.id||r[3].id==='se-'+p.id));if(g&&N[g[1]])return {area:N[g[1]].ctx,x:N[g[1]].x,y:N[g[1]].y};
    const m=gx(p.lat,p.lng);const a=p.side==='A'?'A':'P';return {area:a,x:Math.max(50,Math.min(950,Math.round(m.x))),y:a==='A'?CAY:CPY};}
  if(p.t==='pillar'){const bar=pfBar(+p.pf),pl=((LAYOUT&&LAYOUT.pillars)||[]).find(q=>q.bar===bar&&q.n===String(p.pillar));return onPf(bar,pl?pl.x:gx(p.lat,p.lng).x);}
  if(p.t==='pfend')return onPf(pfBar(+p.pf),gx(p.lat,p.lng).x);
  if(p.t==='fob'&&p.to==='pf')return onPf(pfBar(+p.pf),gx(p.lat,p.lng).x);
  if(p.t==='fob'&&(p.to==='P'||p.to==='A')){const m=gx(p.lat,p.lng);return {area:p.to,x:Math.max(50,Math.min(950,Math.round(m.x))),y:p.to==='A'?CAY:CPY};}
  const m=gx(p.lat,p.lng);return snapToWalkway(m.x,m.y);}
function qrFromSurvey(val){const d=qed.d;qed.sv=val||'';if(!val)return;let p=null,name='',kind='Other',spot=null;
  if(val.startsWith('s:')){p=Object.assign({id:val.slice(2)},SURVEY[val.slice(2)]||{});if(!p.t)return;name=svQrName(p);
    kind=p.t==='gate'||p.t==='entry'?'Gate':p.t==='fob'?'FOB stairs / lift':'Platform';spot=qrSpotFor(p);}
  else{const a=FAC.find(x=>x.id===val.slice(2));if(!a)return;p=a;name=a.name;kind=a.cat==='ticket'?'Booking office':a.cat==='waiting'||a.cat==='lounge'?'Waiting area':'Other';
    const fp=facPos(a);spot=fp||null;}
  d.name=name;d.nameHi=hiAuto(name);qed.hiTouched=false;d.kind=kind;d.lat=p.lat;d.lng=p.lng;d.acc=p.acc!=null?p.acc:null;
  if(spot&&spot.area){d.area=spot.area;d.x=spot.x;d.y=spot.y;qed.manual=true;}
  if(!qed.codeTouched)d.code=autoCode();renderQrEd();const m=$('gpsMsg');if(m){m.className='msg okm';m.textContent='Exact position taken from the site survey.';}}
function compassWord(h){const n=['north','north-east','east','south-east','south','south-west','west','north-west'];return `${h}° · facing ${n[Math.round(h/45)%8]}`;}
function closeQrEd(){stopGps();$('qrSheet').hidden=true;qed.id=null;}
function renderQrEd(){const d=qed.d,isNew=qed.id==='new',ro=!qrCanWrite();
  $('qrEd').innerHTML=`<h3 id="qrEdTitle">${isNew?'New QR point':'Edit QR point'}</h3>
  <p class="sub">${isNew?'Stand exactly where the board will be fixed before capturing your position.':'Changes apply to the printed code straight away. The link stays the same, so boards already fixed keep working.'}</p>
  <form class="form" id="qrForm" novalidate>
    ${qrSurveyPicker(d,ro)}
    <div class="two stack">
      <div class="field"><label for="q-hi">Name in Hindi <small>(printed on top)</small></label><input id="q-hi" value="${esc(d.nameHi)}" placeholder="e.g. गेट 5" lang="hi" ${ro?'disabled':''}><small>Filled in from the English name; correct it if needed.</small></div>
      <div class="field"><label for="q-name">Name in English <small>(printed below)</small></label><input id="q-name" value="${esc(d.name)}" placeholder="e.g. Gate 5, Main hall, Booking office" ${ro?'disabled':''}></div>
    </div>
    <div class="two stack">
      <div class="field"><label for="q-kind">Type of spot</label><select id="q-kind" ${ro?'disabled':''}>${KINDS.map(k=>`<option ${k===d.kind?'selected':''}>${k}</option>`).join('')}</select>${d.kind==='Gate'?`<label for="q-use" style="margin-top:8px">This gate is for</label><select id="q-use" ${ro?'disabled':''}>${Object.entries(GATE_USE).map(([k,v])=>`<option value="${k}" ${k===(d.use||'')?'selected':''}>${v[0]} · ${v[1]}</option>`).join('')}</select>`:''}</div>
      <div class="field"><label for="q-code">QR code ID</label><input id="q-code" value="${esc(isNew?(d.code||''):qed.id)}" ${isNew&&!ro?'':'disabled'} spellcheck="false" placeholder="Filled in from the name">
        <small>${isNew?'Part of the link. Lowercase letters, numbers and dashes.':'Fixed once a board is printed.'}</small></div>
    </div>
    <div class="gps">
      <div class="gps-head"><span class="flabel">1 · Your GPS position</span><button class="btn sm primary" type="button" id="gpsBtn" ${ro?'disabled':''}>Use my current location</button></div>
      <div class="read" id="gpsRead"></div>
      <span class="msg" id="gpsMsg" role="status"></span>
      <div class="two stack">
        <div class="field"><label for="q-lat">Latitude</label><input id="q-lat" inputmode="decimal" value="${d.lat!=null?d.lat.toFixed(6):''}" placeholder="28.64…" ${ro?'disabled':''}></div>
        <div class="field"><label for="q-lng">Longitude</label><input id="q-lng" inputmode="decimal" value="${d.lng!=null?d.lng.toFixed(6):''}" placeholder="77.21…" ${ro?'disabled':''}></div>
      </div>
      <div class="field"><label for="q-paste">Or paste from Google Maps</label><input id="q-paste" placeholder="28.643120, 77.219340 or a maps link" ${ro?'disabled':''}>
        <small>In Google Maps, long-press the blue dot where you stand and copy the coordinates.</small></div>
    </div>
    <div class="gps">
      <span class="flabel">2 · Check the spot on the station map</span>
      <div class="place-txt" id="placeTxt"></div>
      <div class="mapbox mini"><svg id="qrMap" viewBox="0 0 1000 772" role="img" aria-label="Tap to place the QR board"></svg></div>
    </div>
    <div class="gps">
      <div class="gps-head"><span class="flabel">3 · Which way the board faces <small>(for AR view)</small></span><button class="btn sm" type="button" id="qHeadBtn" ${ro?'disabled':''}>Read phone compass</button></div>
      <div class="two stack"><div class="field"><label for="q-head">Direction a passenger faces when reading the board (° from north)</label><input id="q-head" inputmode="numeric" value="${d.head!=null?d.head:''}" placeholder="e.g. 245" ${ro?'disabled':''}></div><div class="field"><span class="flabel">&nbsp;</span><span class="msg" id="qHeadMsg">${d.head!=null?esc(compassWord(d.head)):'Stand in front of the board, point the phone at it, hold it upright, then tap Read phone compass.'}</span></div></div>
    </div>
    ${qed.confirmDel?`<div class="confirm"><span>Delete <b>${esc(d.name)}</b>? Boards already printed with this code will open the default location instead.</span><div class="actions"><button class="btn danger" type="button" id="qDelYes">Delete</button><button class="btn" type="button" id="qDelNo">Keep it</button></div></div>`:''}
    <div class="actions"><button class="btn primary" type="submit" ${ro||qed.busy?'disabled':''}>${isNew?'Save and make QR':'Save changes'}</button>
      <button class="btn" type="button" id="qCancel">Cancel</button>
      ${!isNew&&!qed.confirmDel?`<button class="btn danger" type="button" id="qDel" ${ro?'disabled':''}>Delete</button>`:''}
      <span class="msg${qed.err?' err':''}" role="status">${esc(qed.msg)}</span></div>
  </form>`;
  updateGpsRead();updatePlace();}
function updateGpsRead(){const d=qed.d,r=$('gpsRead');if(!r)return;
  if(d.lat==null||d.lng==null){r.innerHTML='<span class="msg">Not captured yet</span>';return;}
  const far=haversine(NDLS,{lat:d.lat,lng:d.lng});
  r.innerHTML=`${fmtLL(d.lat,d.lng)} <span class="pill ${accClass(d.acc)}">${d.acc!=null?accText(d.acc):'typed in'}</span>
    <div class="actions" style="margin-top:6px"><a class="btn sm" href="https://www.google.com/maps?q=${d.lat.toFixed(6)},${d.lng.toFixed(6)}" target="_blank" rel="noopener">Check on Google Maps</a></div>
    ${far>1500?`<div class="msg err" style="margin-top:4px">This is ${(far/1000).toFixed(1)} km from New Delhi station. Check the numbers.</div>`:''}`;}
function updatePlace(){const d=qed.d,t=$('placeTxt'),svg=$('qrMap');if(!t)return;
  if(d.area&&(d.x!=null||d.y!=null)){const q=ptXY(d);t.className='place-txt';t.textContent=`${describePos(d.area,q.x,q.y)}${qed.manual?'':' · placed from GPS, tap to correct'}`;}
  else{t.className='place-txt none';t.textContent='Use your location in step 1, or tap where you are standing. The pin snaps onto the nearest platform, concourse or bridge.';}
  drawMap(svg,{hideFac:true,qrs:QRPTS.filter(p=>p.id!==qed.id),qrLabels:true,freePin:d.area&&(d.x!=null||d.y!=null)?{x:d.x,y:d.y,area:d.area}:null});}
function qrAutoPlace(){const d=qed.d;if(qed.manual||d.lat==null||d.lng==null)return;const sp=placeFromGps(d);if(sp.far)return;d.area=sp.area;d.x=sp.x;d.y=sp.y;
  if(qed.id==='new'&&!qed.codeTouched){d.code=autoCode();const c=$('q-code');if(c)c.value=d.code;}updatePlace();}
function parseLL(s){const m=String(s).match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/);return m?{lat:+m[1],lng:+m[2]}:null;}
function stopGps(){if(qed.watch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(qed.watch);qed.watch=null;clearTimeout(qed.timer);const b=$('gpsBtn');if(b){b.disabled=!qrCanWrite();b.textContent='Use my current location';}}
function startGps(){const msg=$('gpsMsg'),b=$('gpsBtn');
  if(!navigator.geolocation){msg.className='msg err';msg.textContent="This browser can't share your location. Paste the coordinates from Google Maps instead.";return;}
  let best=null;const t0=Date.now();b.disabled=true;b.textContent='Reading GPS…';msg.className='msg';msg.textContent='Hold the phone still at the spot. Taking the best of several readings…';
  try{qed.watch=navigator.geolocation.watchPosition(pos=>{const c=pos.coords;
      if(!best||c.accuracy<best.acc){best={lat:c.latitude,lng:c.longitude,acc:c.accuracy};Object.assign(qed.d,best);$('q-lat').value=best.lat.toFixed(6);$('q-lng').value=best.lng.toFixed(6);updateGpsRead();qrAutoPlace();}
      msg.textContent=`Best so far ±${Math.round(best.acc)} m. ${best.acc<=8?'Good enough.':'Still improving…'}`;
      if(best.acc<=8||Date.now()-t0>15000){stopGps();msg.className='msg okm';msg.textContent=`Captured at ±${Math.round(best.acc)} m.${best.acc>25?' Under a roof GPS drifts; tapping the map in step 2 sets the exact spot.':''}`;}},
    err=>{stopGps();msg.className='msg err';msg.textContent=err.code===1?"Location access isn't allowed here. Paste the coordinates from Google Maps instead.":"Couldn't get a GPS fix. Step out from under the roof for a moment, or paste the coordinates.";},
    {enableHighAccuracy:true,maximumAge:0,timeout:20000});}
  catch(e){stopGps();msg.className='msg err';msg.textContent="Location access isn't allowed here. Paste the coordinates from Google Maps instead.";}
  qed.timer=setTimeout(()=>{if(qed.watch!=null){stopGps();if(best){msg.className='msg okm';msg.textContent=`Captured at ±${Math.round(best.acc)} m.`;}}},16000);}
$('qrSheet').addEventListener('input',e=>{const t=e.target,d=qed.d;if(!d)return;
  if(t.id==='q-head'){const v=parseFloat(t.value);d.head=isNaN(v)?null:((Math.round(v)%360)+360)%360;const m=$('qHeadMsg');if(m)m.textContent=d.head!=null?compassWord(d.head):'';return;}
  if(t.id==='q-name'){d.name=t.value;if(qed.id==='new'&&!qed.codeTouched){d.code=autoCode();$('q-code').value=d.code;}if(!qed.hiTouched){d.nameHi=hiAuto(d.name);$('q-hi').value=d.nameHi;}}
  else if(t.id==='q-hi'){d.nameHi=t.value;qed.hiTouched=!!t.value;}
  else if(t.id==='q-code'){qed.codeTouched=true;d.code=t.value.trim().toLowerCase();}
  else if(t.id==='q-lat'||t.id==='q-lng'){const v=parseFloat(t.value);if(t.id==='q-lat')d.lat=isNaN(v)?null:v;else d.lng=isNaN(v)?null:v;d.acc=null;updateGpsRead();qrAutoPlace();}
  else if(t.id==='q-paste'){const ll=parseLL(t.value);if(ll){d.lat=ll.lat;d.lng=ll.lng;d.acc=null;$('q-lat').value=ll.lat.toFixed(6);$('q-lng').value=ll.lng.toFixed(6);updateGpsRead();qrAutoPlace();}}});
$('qrSheet').addEventListener('change',e=>{if(e.target.id==='q-use')qed.d.use=e.target.value;if(e.target.id==='q-kind'){qed.d.kind=e.target.value;renderQrEd();}if(e.target.id==='q-sv')qrFromSurvey(e.target.value);});
$('qrSheet').addEventListener('click',async e=>{const t=e.target;if(e.target.id==='qrSheet'){closeQrEd();return;}
  if(t.id==='qHeadBtn'){const m=$('qHeadMsg');m.textContent='Reading the compass… hold still.';m.className='msg';
    try{const {readCompass}=await import('./ar');const h=await readCompass(1800);qed.d.head=h;$('q-head').value=h;m.textContent=compassWord(h)+' · read from the phone';m.className='msg okm';}
    catch(err){m.textContent=(err&&err.message)||"Couldn't read the compass.";m.className='msg err';}return;}
  if(t.id==='gpsBtn'){startGps();return;}
  const svg=t.closest&&t.closest('#qrMap');
  if(svg&&qrCanWrite()){const p=svgPoint(svg,e);if(!p)return;const sp=snapToWalkway(p.x,p.y);qed.manual=true;
    qed.d.area=sp.area;qed.d.x=sp.x;qed.d.y=sp.y;if(qed.id==='new'&&!qed.codeTouched){qed.d.code=autoCode();$('q-code').value=qed.d.code;}updatePlace();return;}
  if(t.id==='qCancel')closeQrEd();
  else if(t.id==='qDel'){qed.confirmDel=true;renderQrEd();}
  else if(t.id==='qDelNo'){qed.confirmDel=false;renderQrEd();}
  else if(t.id==='qDelYes'){qed.busy=true;try{await DB.doc('qrpoints/'+qed.id).delete();const nm=qed.d.name;closeQrEd();setQrMsg(`Deleted ${nm}.`);}
    catch(err){qed.busy=false;qed.confirmDel=false;qed.err=true;qed.msg=`Couldn't delete (${err.code||'error'}).`;renderQrEd();}}});
$('qrSheet').addEventListener('submit',async e=>{e.preventDefault();if(!qrCanWrite())return;const d=qed.d,isNew=qed.id==='new';
  const fail=m=>{qed.err=true;qed.msg=m;renderQrEd();};
  d.name=d.name.trim();if(!d.name)return fail('Give the spot a name passengers will recognise.');
  if(!d.area||(d.x==null&&d.y==null))return fail('Use your location or tap the spot on the station map in step 2.');
  if((d.lat==null)!==(d.lng==null))return fail('Fill in both latitude and longitude, or leave both empty.');
  if(d.lat!=null&&(Math.abs(d.lat)>90||Math.abs(d.lng)>180))return fail("Those coordinates aren't valid.");
  const id=isNew?(d.code||autoCode()):qed.id;
  if(isNew){if(!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id))return fail('The QR code ID can only use lowercase letters, numbers and dashes.');
    const olds=qed.sv?QRPTS.filter(q=>q.sv===qed.sv).map(q=>q.id):[];
    if((getPt(id)&&!olds.includes(id))||['admin','qr','facilities'].includes(id))return fail(`The ID ${id} is already in use. Pick another.`);
    if(qed.sv){const st=qrStateOf(qed.sv);if(st.made&&!st.changed)return fail('This spot already has a QR and nothing has changed since. Pick another spot.');}}
  qed.busy=true;qed.err=false;qed.msg='Saving…';renderQrEd();
  try{const uid=USER?await USER.id():null;
    const q=ptXY(d);await DB.doc('qrpoints/'+id).set({name:d.name,nameHi:(d.nameHi||'').trim()||hiAuto(d.name),kind:d.kind,use:d.kind==='Gate'?(d.use||''):'',area:d.area,x:q.x,y:q.y,placed:qed.sv?'survey':qed.manual?'map':'gps',sv:qed.sv||'',svSig:qed.sv?svSigOf(qed.sv):'',head:d.head!=null?d.head:null,lat:d.lat,lng:d.lng,acc:d.acc!=null?Math.round(d.acc*10)/10:null,updatedAt:new Date().toISOString(),updatedBy:uid||''});
    let gone=[];if(isNew&&qed.sv){for(const q of QRPTS.filter(q=>q.sv===qed.sv&&q.id!==id)){try{await DB.doc('qrpoints/'+q.id).delete();if(PHOTOS['qr-'+q.id]){try{await DB.doc('photos/qr-'+q.id).delete();}catch(_){}}gone.push(q.id.toUpperCase());}catch(_){}}}
    closeQrEd();setQrMsg(`${isNew?'Created':'Saved'} ${d.name}.${gone.length?` Old QR ${gone.join(', ')} deleted; replace the old board with the new sign.`:''} Its sign is below.`);
    setTimeout(()=>{const c=document.querySelector(`[data-poster="${CSS.escape(id)}"]`);if(c)c.scrollIntoView({behavior:'smooth',block:'center'});},400);}
  catch(err){qed.busy=false;fail(err&&err.code==='invalid_argument'?"You don't have permission to change QR points.":`Couldn't save (${(err&&err.code)||'error'}). Try again.`);}});
$('newQrBtn').addEventListener('click',()=>openQrEd(null));

// ================= PHOTOS (shared) =================
let PHOTOS={}, ASSETS=null, PH_SOURCE='none';
const blobUrl=id=>/^(https?:|\/)/.test(id)?id:'/_blob/'+id;
const photoKey=id=>id==='__pin'?'qr-'+state.scan:'n-'+id;
function dirTok(u,v){const c=N[u].ctx;if(isZig(c)&&Math.abs(N[v].x-N[u].x)>Math.abs(N[v].y-N[u].y))return N[v].x>N[u].x?'north':'south';if(isFob(c))return N[v].y>N[u].y?'toA':'toP';return N[v].x>N[u].x?'north':'south';}
function edgeTok(a,b){return N[a].ctx===N[b].ctx?dirTok(a,b):'go:'+b;}
function stepPhoto(s){if(!s)return null;let ph=null;const pin=N.__pin;
  if(s.fac)ph=PHOTOS['f-'+s.fac]||null;
  if(!ph&&s.at&&N[s.at]){ph=PHOTOS[photoKey(s.at)]||null;
    if(!ph&&pin&&s.at!=='__pin'&&N[s.at].ctx===pin.ctx&&Math.abs(N[s.at].y-pin.y)+Math.abs(N[s.at].x-pin.x)<25)ph=PHOTOS['qr-'+state.scan]||null;
    if(!ph&&s.at==='__pin'){const cand=nearestBase(pin.ctx,pin.x,pin.y);if(N[cand]&&Math.abs(N[cand].x-pin.x)+Math.abs(N[cand].y-pin.y)<25)ph=PHOTOS['n-'+cand]||null;}}
  if(!ph||!ph.assetId)return null;
  return {ph,url:blobUrl(ph.assetId),hs:(ph.hotspots||[]).find(h=>h.to===s.tok)||null};}
function hsHtml(hs,label){return hs?`<span class="hs" style="left:${(+hs.x).toFixed(2)}%;top:${(+hs.y).toFixed(2)}%"><b>${esc(label||'Go here')}</b></span>`:'';}
function openLightbox(i){const s=STEPS[i],sp=stepPhoto(s);if(!sp)return;
  $('lbPh').innerHTML=`<img src="${esc(sp.url)}" alt="${esc(sp.ph.caption||'Photo of this spot')}">${hsHtml(sp.hs)}`;
  $('lbCap').innerHTML=`<b>Step ${i+1} · ${esc(s.t)}</b>${sp.ph.caption?`<small>Look for: ${esc(sp.ph.caption)}</small>`:''}`;
  $('lightbox').hidden=false;$('lbClose').focus();}
$('lbClose').addEventListener('click',()=>{$('lightbox').hidden=true;});
$('lightbox').addEventListener('click',e=>{if(e.target.id==='lightbox')$('lightbox').hidden=true;});
function dynSig(dest,pt){return LAYOUT_REV+'#'+FAC.map(a=>a.id+(a.status||'')+(a._n?N[a._n].x+','+N[a._n].y:'')).join(',')+'|'+(dest?dest.id:'')+'|'+pt.id+':'+pt.x+':'+pt.area+'|'+pt.name;}

// ================= 3D WALK =================
// Passengers see one map only: the surveyed station map ("live"). The drawn station map is a fallback until the survey is ready. 3D walk and AR view are switched off.
let MODE='live';
const W={ok:null,mode:'follow',playing:false,dist:0,goal:null,ids:[],path:[],cum:[0],total:0,ends:[0],cur:0,routeKey:'',dynKey:'',raf:0,last:0,orb:{th:-2.25,ph:.95,r:220,cx:0,cz:0},chev:null,chevN:0,chevOff:0,bob:null,speed:10};
const RM=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const wx=x=>(x-500)*SX, wz=y=>(y-386)*SY, HF=6.5;
const nodeH=id=>isFob(N[id].ctx)?HF:0;
const cssv=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||'#888888';
function V(id){return new THREE.Vector3(wx(N[id].x),nodeH(id),wz(N[id].y));}

function applyModeDom(){liveInit();document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===MODE));$('wrap3d').hidden=MODE!=='3d';$('wrapMap').hidden=MODE!=='map';$('wrapLive').hidden=MODE!=='live';}
function setMode(m){MODE=m;applyModeDom();try{localStorage.setItem('wf-mode',m);}catch(e){}if(m!=='3d'){W.playing=false;stopLoop();}renderPassenger();}
document.querySelector('.modesw').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b)setMode(b.dataset.mode);});

function ensure3d(){if(W.ok!==null)return Promise.resolve(W.ok);
  if(!W.p)W.p=Promise.race([loadFonts(),new Promise(r=>setTimeout(r,1500))]).then(()=>init3d());return W.p;}
function init3d(){if(W.ok!==null)return W.ok;
  if(!window.THREE){W.ok=false;W.why="The 3D view couldn't load. Check your connection and reload, or switch to the station map.";return false;}
  try{W.renderer=new THREE.WebGLRenderer({canvas:$('c3d'),antialias:true});}
  catch(e){W.ok=false;W.why="This device can't show 3D graphics. Switch to the station map; the step photos still work.";return false;}
  W.renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
  const S=W.scene=new THREE.Scene();W.camera=new THREE.PerspectiveCamera(55,1,0.5,2500);
  S.add(new THREE.HemisphereLight(0xffffff,0x5a5a5a,0.95));const sun=new THREE.DirectionalLight(0xffffff,0.55);sun.position.set(-150,260,120);S.add(sun);
  const L=o=>new THREE.MeshLambertMaterial(o||{}),B=o=>new THREE.MeshBasicMaterial(o||{});
  W.M={ground:L(),plat:L(),conc:L(),wall:L(),gate:L(),edge:B(),rail:L(),sleeper:L(),deck:L(),deckOn:L(),stair:L(),
    canopy:L({transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide}),glass:L({transparent:true,opacity:.38,depthWrite:false}),
    work:L({color:0xE8731A}),kiosk:L(),kioskOff:L({transparent:true,opacity:.45}),dest:B(),route:B(),chev:B({side:THREE.DoubleSide}),you:L(),
    ring:B({transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false})};
  applyTheme3d();buildStatic3d();
  W.dyn=new THREE.Group();S.add(W.dyn);W.rg=new THREE.Group();S.add(W.rg);
  const wk=W.walker=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,1.5,16),W.M.you);body.position.y=.95;
  const head=new THREE.Mesh(new THREE.SphereGeometry(.5,16,12),W.M.you);head.position.y=2.15;
  const ring=W.ring=new THREE.Mesh(new THREE.RingGeometry(1.1,1.6,32),W.M.ring);ring.rotation.x=-Math.PI/2;ring.position.y=.08;
  wk.add(body,head,ring);S.add(wk);
  W.look=new THREE.Vector3();W.sdir=new THREE.Vector3(1,0,0);
  bindOrbit();if(window.ResizeObserver)new ResizeObserver(size3d).observe($('stage3d'));size3d();
  const mq=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)');if(mq&&mq.addEventListener)mq.addEventListener('change',()=>{applyTheme3d();});
  new MutationObserver(()=>applyTheme3d()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  W.ok=true;return true;}
function size3d(){if(!W.renderer)return;const st=$('stage3d'),w=st.clientWidth,h=st.clientHeight;if(!w||!h)return;W.renderer.setSize(w,h,false);W.camera.aspect=w/h;W.camera.updateProjectionMatrix();}
function applyTheme3d(){if(!W.M)return;unfadeAll3d();const M=W.M,set=(m,k)=>m.color.set(cssv(k));
  const bg=new THREE.Color(cssv('--surface-2'));W.scene.background=bg;W.scene.fog=new THREE.Fog(bg,280,950);
  set(M.ground,'--track');set(M.plat,'--plat');set(M.conc,'--conc');set(M.wall,'--line');set(M.gate,'--ink');set(M.edge,'--sign');
  set(M.rail,'--muted');set(M.sleeper,'--line');set(M.deck,'--surface');M.deckOn.color.set(cssv('--route')).lerp(new THREE.Color(cssv('--surface')),.35);set(M.stair,'--line');set(M.canopy,'--muted');set(M.glass,'--fob');
  set(M.kiosk,'--surface');set(M.kioskOff,'--line');set(M.dest,'--sign');set(M.route,'--route');set(M.chev,'--sign');set(M.you,'--you');set(M.ring,'--you');}
// ---- outside the station in 3D: parking, roads, forecourts, stands, buildings from the site survey ----
const OUT3_COL={parking:'#5E6873',road:'#3E434A',dropoff:'#D8B06A',circ:'#C8CCC2',building:'#CBBDA4',construction:'#E9A23B',taxi:'#D9A400',bus:'#1E8E5A',metro:'#7B3FB8',other:'#475569'};
function llTo3(lat,lng){const g=LAYOUT&&LAYOUT.geo;if(!g)return null;const m=surveyXY(g,...geoEN(lat,lng));return {x:wx(m.x),z:wz(m.y)};}
const outSig=()=>Object.entries(SURVEY).filter(([k,p])=>p.t==='out').map(([k,p])=>k+':'+(p.updatedAt||'')).sort().join('|');
// ---- the real satellite picture laid on the ground under the 3D station (Esri World Imagery tiles, same as the station map) ----
let SAT_ON=true;try{SAT_ON=localStorage.getItem('wf-sat3d')!=='0';}catch(_){}
const SAT_TEX=new Map();
function satGround3d(S){if(!LAYOUT||!LAYOUT.geo)return;const G=new THREE.Group();G.visible=SAT_ON;W.satG=G;S.add(G);satBtn3d();
  let la0=90,la1=-90,ln0=180,ln1=-180;const add=(a,b)=>{if(a==null||b==null||isNaN(+a)||isNaN(+b))return;a=+a;b=+b;la0=Math.min(la0,a);la1=Math.max(la1,a);ln0=Math.min(ln0,b);ln1=Math.max(ln1,b);};
  Object.values(SURVEY).forEach(q=>{if(q.t==='out'&&Array.isArray(q.pts)){if(q.pts.length>8)return;q.pts.forEach(pp=>{if(Math.abs(pp[0]-NDLS_C.lat)<.006&&Math.abs(pp[1]-NDLS_C.lng)<.006)add(pp[0],pp[1]);});}else if(Math.abs(q.lat-NDLS_C.lat)<.006&&Math.abs(q.lng-NDLS_C.lng)<.006)add(q.lat,q.lng);});
  if(la0>la1){la0=NDLS_C.lat-.004;la1=NDLS_C.lat+.004;ln0=NDLS_C.lng-.004;ln1=NDLS_C.lng+.004;}
  la0-=.0012;la1+=.0012;ln0-=.0012;ln1+=.0012;
  const tx=(ln,z)=>Math.floor((ln+180)/360*2**z),ty=(la,z)=>{const r=la*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*2**z);};
  const lon=(x,z)=>x/2**z*360-180,lat=(y,z)=>{const n=Math.PI-2*Math.PI*y/2**z;return 180/Math.PI*Math.atan(.5*(Math.exp(n)-Math.exp(-n)));};
  let z=18;while(z>15&&(tx(ln1,z)-tx(ln0,z)+1)*(ty(la0,z)-ty(la1,z)+1)>140)z--;
  const loader=new THREE.TextureLoader();loader.setCrossOrigin('anonymous');
  for(let x=tx(ln0,z);x<=tx(ln1,z);x++)for(let y=ty(la1,z);y<=ty(la0,z);y++){
    const nw=llTo3(lat(y,z),lon(x,z)),ne=llTo3(lat(y,z),lon(x+1,z)),se=llTo3(lat(y+1,z),lon(x+1,z)),sw=llTo3(lat(y+1,z),lon(x,z));if(!nw||!ne||!se||!sw)continue;
    const geo=new THREE.BufferGeometry(),Y=-1.285;
    geo.setAttribute('position',new THREE.Float32BufferAttribute([nw.x,Y,nw.z,ne.x,Y,ne.z,se.x,Y,se.z,sw.x,Y,sw.z],3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));geo.setIndex([0,3,1,1,3,2]);
    const url=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    let e=SAT_TEX.get(url);if(!e){e={ok:false,mats:[]};SAT_TEX.set(url,e);const ee=e;e.t=loader.load(url,()=>{ee.ok=true;ee.mats.forEach(mm=>{mm.visible=true;});startLoop();},undefined,()=>{});}
    const mt=new THREE.MeshBasicMaterial({map:e.t,side:THREE.DoubleSide,fog:false});mt.visible=e.ok;e.mats.push(mt);
    const m=new THREE.Mesh(geo,mt);m.userData.keep=true;G.add(m);}}
function satBtn3d(){const st=$('stage3d');if(!st||st.querySelector('.satbtn'))return;
  st.insertAdjacentHTML('beforeend',`<button type="button" class="btn sm satbtn" aria-pressed="${SAT_ON}" title="Show the real satellite picture under the station">Satellite</button>`);
  st.querySelector('.satbtn').addEventListener('click',e=>{SAT_ON=!SAT_ON;try{localStorage.setItem('wf-sat3d',SAT_ON?'1':'0');}catch(_){}e.currentTarget.setAttribute('aria-pressed',String(SAT_ON));if(W.satG)W.satG.visible=SAT_ON;startLoop();});}
function boundary3d(S){const blue=new THREE.MeshBasicMaterial({color:0x1A73E8});
  stationOutlines().forEach(poly=>{const pts=poly.map(q=>llTo3(q[0],q[1])).filter(Boolean);for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<.3)continue;
    const m=new THREE.Mesh(new THREE.BoxGeometry(L+1.2,.25,1.2),blue);m.position.set((a.x+b.x)/2,-1.1,(a.z+b.z)/2);m.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);m.userData.keep=true;S.add(m);}});}
function buildOutside3d(S){W.outSig=outSig();if(!LAYOUT||!LAYOUT.geo)return;boundary3d(S);const mats={};const mat=k=>mats[k]||(mats[k]=new THREE.MeshLambertMaterial({color:/^#/.test(k)?k:(OUT3_COL[k]||OUT3_COL.other)})),flat=k=>mats['~'+k]||(mats['~'+k]=new THREE.MeshLambertMaterial({color:/^#/.test(k)?k:(OUT3_COL[k]||OUT3_COL.other),transparent:true,opacity:.5,depthWrite:false}));
  const white=new THREE.MeshBasicMaterial({color:0xF4F4F0});let lift=0;
  Object.values(SURVEY).filter(p=>p.t==='out').forEach(p=>{const k=RMAP.OUT[p.kind]?p.kind:'other',sh=p.shape||(RMAP.OUT[k]||RMAP.OUT.other).shape,name=String(p.name||(RMAP.OUT[k]||{}).label||'').trim(),pc=okHex(p.color)?p.color:null,isCon=k==='construction'||/constr|redevelop|work site/i.test(name),mt=kk=>pc?mat(pc):mat(isCon&&kk!=='building'?'construction':kk);
    const pts=(Array.isArray(p.pts)?p.pts:[]).map(q=>llTo3(q[0],q[1])).filter(Boolean);lift+=.002;if(k==='station'||k==='stationbldg')return;
    if(sh==='area'&&pts.length>=3){const shp=new THREE.Shape(pts.map(q=>new THREE.Vector2(q.x,-q.z)));
      if(k==='building'){const m=new THREE.Mesh(new THREE.ExtrudeGeometry(shp,{depth:9,bevelEnabled:false}),mt(k));m.rotation.x=-Math.PI/2;m.position.y=-1.3;S.add(m);}
      else{const m=new THREE.Mesh(new THREE.ShapeGeometry(shp),pc?flat(pc):flat(isCon?'construction':k));m.rotation.x=-Math.PI/2;m.position.y=-1.27+lift;m.userData.keep=true;S.add(m);
        if(k==='parking'){// painted bays along the longest edge
          let bi=0,bl=0;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],l=Math.hypot(b.x-a.x,b.z-a.z);if(l>bl){bl=l;bi=i;}}
          const a=pts[bi],b=pts[(bi+1)%pts.length],ux=(b.x-a.x)/bl,uz=(b.z-a.z)/bl,c=pts.reduce((o,q)=>({x:o.x+q.x/pts.length,z:o.z+q.z/pts.length}),{x:0,z:0});
          let nx=-uz,nz=ux;if((c.x-a.x)*nx+(c.z-a.z)*nz<0){nx=-nx;nz=-nz;}
          for(let t=2.5;t<bl-1;t+=2.7){const m2=mbox(.12,.02,5,white,a.x+ux*t+nx*3,-1.25+lift,a.z+uz*t+nz*3,S);m2.rotation.y=-Math.atan2(nz,nx)+Math.PI/2;m2.userData.keep=true;}}}
      if(isCon){// site hoarding all round: orange and white panels, 2.4 m high
        const hO=mat('#E8731A');for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<.5)continue;const ux=(b.x-a.x)/L,uz=(b.z-a.z)/L,ang=-Math.atan2(uz,ux);
          for(let t=0,j=0;t<L;t+=3,j++){const l=Math.min(3,L-t);const m3=mbox(l,2.4,.25,j%2?white:hO,a.x+ux*(t+l/2),-.1,a.z+uz*(t+l/2),S);m3.rotation.y=ang;}}}
      const c=pts.reduce((o,q)=>({x:o.x+q.x/pts.length,z:o.z+q.z/pts.length}),{x:0,z:0});
      const sp=sprite3((k==='parking'?'P · ':isCon?'⚠ ':'')+name.toUpperCase(),{bg:pc||(k==='parking'?'#2F6FDE':isCon?'#C2410C':'#18212B'),fg:'#FFFFFF',h:2.4});sp.position.set(c.x,k==='building'?11:isCon?5:4,c.z);S.add(sp);}
    else if(sh==='line'&&pts.length>=2){for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<.2)continue;const ang=-Math.atan2(b.z-a.z,b.x-a.x);
        const m=new THREE.Mesh(new THREE.BoxGeometry(L+4,.06,10),mt('road'));m.position.set((a.x+b.x)/2,-1.27+lift,(a.z+b.z)/2);m.rotation.y=ang;m.userData.keep=true;S.add(m);
        for(let t=1;t<L-1;t+=6){const m2=new THREE.Mesh(new THREE.BoxGeometry(3,.03,.2),white);m2.position.set(a.x+(b.x-a.x)*t/L,-1.23+lift,a.z+(b.z-a.z)*t/L);m2.rotation.y=ang;m2.userData.keep=true;S.add(m2);}}
      let bi=1,bl=0;for(let i=1;i<pts.length;i++){const l=Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z);if(l>bl){bl=l;bi=i;}}
      const sp=sprite3(name.toUpperCase(),{bg:'#3E434A',fg:'#FFFFFF',h:2});sp.position.set((pts[bi].x+pts[bi-1].x)/2,2.5,(pts[bi].z+pts[bi-1].z)/2);S.add(sp);}
    else{const q=llTo3(p.lat,p.lng);if(!q)return;const col=pc||OUT3_COL[k]||OUT3_COL.other;
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,5.5,8),W.M.rail);pole.position.set(q.x,-1.3+2.75,q.z);S.add(pole);
      const code=(RMAP.OUT[k]||{}).code;const sp=sprite3(`${code&&code!=='•'?code+' · ':''}${name.toUpperCase()}`,{bg:col,fg:'#FFFFFF',h:2});sp.position.set(q.x,5.4,q.z);S.add(sp);}});}
// ---- real photos above stalls near the route (from Photos: facility photos) ----
function facBoards3d(A){const dest=A.dest,ids=new Set();if(!W.path||!W.path.length)return;
  FAC.forEach(a=>{const ph=PHOTOS['f-'+a.id];if(!ph||!ph.assetId||!a._n||!N[a._n])return;const p=fac3(a);
    let near=dest&&a.id===dest.id;if(!near)for(let i=0;i<W.path.length;i+=1){if(W.path[i].distanceTo(p)<22){near=true;break;}}
    if(!near||ids.size>=14)return;ids.add(a.id);
    const H=2.8,pos=fac3(a);pos.y=(isFob(N[a._n].ctx)?HF:0)+5.2;
    const sm=new THREE.SpriteMaterial({transparent:true}),spr=new THREE.Sprite(sm);spr.scale.set(H*1.3,H,1);spr.position.copy(pos);spr.visible=false;spr.userData.fac=a.id;W.dyn.add(spr);
    const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>{if(spr.parent!==W.dyn)return;const ar=Math.max(.6,Math.min(2,img.width/img.height||4/3)),cw=480,ch=Math.round(cw/ar),bd=12,lab=56,cv=document.createElement('canvas');cv.width=cw+bd*2;cv.height=ch+bd*2+lab;const g=cv.getContext('2d');
      g.fillStyle=a.id===(dest&&dest.id)?'#F3C531':'#FFFFFF';g.fillRect(0,0,cv.width,cv.height);g.drawImage(img,bd,bd+lab,cw,ch);g.fillStyle='#151515';g.font='700 34px "Barlow Condensed","Arial Narrow",sans-serif';g.textBaseline='middle';
      const t=a.name.length>28?a.name.slice(0,27)+'…':a.name;g.fillText(t.toUpperCase(),bd+6,bd+lab/2);
      const tx=new THREE.CanvasTexture(cv);tx.minFilter=THREE.LinearFilter;sm.map=tx;sm.needsUpdate=true;spr.scale.set(H*cv.width/cv.height,H,1);spr.visible=true;W.pgAny=true;$('hint3d').hidden=false;startLoop();};
    img.src=blobUrl(ph.assetId);});}
function openFacPhoto(id){const a=FAC.find(x=>x.id===id),ph=a&&PHOTOS['f-'+a.id];if(!ph||!ph.assetId)return;
  $('lbPh').innerHTML=`<img src="${esc(blobUrl(ph.assetId))}" alt="${esc(ph.caption||a.name)}">`;$('lbCap').innerHTML=`<b>${esc(a.name)}</b><small>${esc(facWhere(a))}</small>`;$('lightbox').hidden=false;$('lbClose').focus();}
function mbox(w,h,d,mat,x,y,z,parent){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);(parent||W.target||W.scene).add(m);return m;}
function ramp3(x0,y0,x1,y1,z,w,mat){const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy);const m=new THREE.Mesh(new THREE.BoxGeometry(len,.35,w),mat);m.position.set((x0+x1)/2,(y0+y1)/2-.15,z);m.rotation.z=Math.atan2(dy,dx);(W.target||W.scene).add(m);return m;}
function sprite3(text,o){const size=64,pad=22,font=`700 ${size}px "Barlow Condensed","Arial Narrow",sans-serif`;
  const c=document.createElement('canvas'),g=c.getContext('2d');g.font=font;const w=Math.ceil(g.measureText(text).width)+pad*2,h=Math.round(size*1.35);
  c.width=w;c.height=h;g.font=font;g.fillStyle=o.bg;const r=12;g.beginPath();g.moveTo(r,0);g.arcTo(w,0,w,h,r);g.arcTo(w,h,0,h,r);g.arcTo(0,h,0,0,r);g.arcTo(0,0,w,0,r);g.closePath();g.fill();
  g.fillStyle=o.fg;g.textBaseline='middle';g.fillText(text,pad,h/2+3);
  const t=new THREE.CanvasTexture(c);t.minFilter=THREE.LinearFilter;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true}));
  const H=o.h||2.2;s.scale.set(H*w/h,H,1);return s;}
const gap3d=4.2;
function buildStatic3d(){const M=W.M;unfadeAll3d();if(!W.staticG){W.staticG=new THREE.Group();W.scene.add(W.staticG);}else clearGroup(W.staticG);
  const S=W.staticG;W.target=S;W.fobMesh={};const cx=wx(500),LEN=908*SX,mtx=new THREE.Matrix4();
  const g=new THREE.Mesh(new THREE.PlaneGeometry(2600,2200),M.ground);g.rotation.x=-Math.PI/2;g.position.y=-1.3;g.userData.keep=true;S.add(g);satGround3d(S);buildOutside3d(S);
  const RS=realStation();W.realRef=RS;const pfx=p=>{const r=RS.pf[p];if(!r||r[1]-r[0]<30)return [50,950];return [Math.max(-200,r[0]),Math.min(1200,r[1])];};
  const cpos=[];
  for(let p=0;p<9;p++){const z=wz(PY(p)),[a,b]=pfx(p),L=(b-a)*SX,c=wx((a+b)/2);mbox(L,1.3,9.2,M.plat,c,-.65,z);mbox(L,.05,.45,M.edge,c,.02,z-4.3);mbox(L,.05,.45,M.edge,c,.02,z+4.3);mbox(L*.9,.15,8,M.canopy,c,5.6,z);
    for(let x=wx(a)+20;x<=wx(b)-20;x+=34)cpos.push([x,z+2.2]);
    if(RS.pf[p]){[a,b].forEach((xe,e)=>{const sp=sprite3(`${platLabel(p).replace('Platform','PF').toUpperCase()} END`,{bg:'#5B6470',fg:'#FFFFFF',h:1.2});sp.position.set(wx(xe)+(e?-3:3),2.6,z);S.add(sp);});}}
  const cols=new THREE.InstancedMesh(new THREE.CylinderGeometry(.22,.22,5.6,8),M.rail,Math.max(1,cpos.length));cols.frustumCulled=false;let k=0;
  cpos.forEach(([x,z])=>{mtx.makeTranslation(x,2.8,z);cols.setMatrixAt(k++,mtx);});S.add(cols);
  const tz=[];for(let p=0;p<8;p++){const a=PY(p),b=PY(p+1);tz.push(wz(a+(b-a)*.34),wz(a+(b-a)*.66));}
  const slp=[];for(let x=-LEN/2;x<=LEN/2;x+=1.8)slp.push(x);
  const sl=new THREE.InstancedMesh(new THREE.BoxGeometry(.3,.12,2.6),M.sleeper,tz.length*slp.length);sl.frustumCulled=false;k=0;
  tz.forEach(z=>{mbox(LEN,.16,.12,M.rail,cx,-1.1,z-.72);mbox(LEN,.16,.12,M.rail,cx,-1.1,z+.72);slp.forEach(x=>{mtx.makeTranslation(cx+x,-1.22,z);sl.setMatrixAt(k++,mtx);});});S.add(sl);
  // concourse building on each side, drawn from the real gates: floor from the building front to the platform, front wall with openings at the gates, light roof
  ['P','A'].forEach(s=>{const sg=s==='P'?-1:1,w=RS.wall[s]||[],ey=RS['edge'+s];if(w.length<2)return;
    const pts=w.map(q=>new THREE.Vector2(wx(q.x),-wz(q.y)));pts.push(new THREE.Vector2(wx(w[w.length-1].x),-wz(ey)),new THREE.Vector2(wx(w[0].x),-wz(ey)));
    const shp=new THREE.Shape(pts);const fl=new THREE.Mesh(new THREE.ExtrudeGeometry(shp,{depth:1.3,bevelEnabled:false}),M.conc);fl.rotation.x=-Math.PI/2;fl.position.y=-1.3;fl.userData.keep=true;S.add(fl);
    const rf=new THREE.Mesh(new THREE.ShapeGeometry(shp),M.canopy);rf.rotation.x=-Math.PI/2;rf.position.y=10;S.add(rf);
    const gap=4.2;
    for(let i=1;i<w.length;i++){const a=w[i-1],b=w[i],ax=wx(a.x),az=wz(a.y),bx=wx(b.x),bz=wz(b.y),L=Math.hypot(bx-ax,bz-az);if(L<.5)continue;
      const ga=a.g?gap:0,gb=b.g?gap:0;if(L-ga-gb<.5)continue;const ux=(bx-ax)/L,uz=(bz-az)/L,sx=ax+ux*ga,sz=az+uz*ga,ex=bx-ux*gb,ez=bz-uz*gb;
      const m=new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(ex-sx,ez-sz),8,1),M.wall);m.position.set((sx+ex)/2,4,(sz+ez)/2);m.rotation.y=-Math.atan2(ez-sz,ex-sx);S.add(m);}
    // the ends of the building
    [w[0],w[w.length-1]].forEach(q=>{const x=wx(q.x),z0=wz(q.y),z1=wz(ey);mbox(1,8,Math.abs(z1-z0),M.wall,x,4,(z0+z1)/2);});
    const sideLab=sprite3(s==='P'?'PAHARGANJ SIDE':'AJMERI GATE SIDE',{bg:'#18212B',fg:'#FFFFFF',h:3});sideLab.position.set(wx(w[0].x)+18,11.5,wz(w[0].y)+sg*1.5);S.add(sideLab);});
  RS.gates.forEach(g=>{const closed=g.tag==='CLOSED',sg=g.side==='P'?-1:1,x=wx(g.tx),z=wz(g.wy);
    // direction of the wall at this gate
    const w=RS.wall[g.side]||[],i=w.findIndex(q=>q.g===g);let ang=0;if(i>=0){const a=w[Math.max(0,i-1)],b=w[Math.min(w.length-1,i+1)];ang=-Math.atan2(wz(b.y)-wz(a.y),wx(b.x)-wx(a.x));}
    if(g.front){const fr=new THREE.Group();fr.position.set(x,0,z);fr.rotation.y=ang;S.add(fr);
      const post=(dx)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(.9,8,1.4),closed?M.wall:M.gate);m.position.set(dx,4,0);fr.add(m);};post(-gap3d);post(gap3d);
      const lint=new THREE.Mesh(new THREE.BoxGeometry(gap3d*2+.9,1.2,1.4),closed?M.wall:M.gate);lint.position.set(0,7.6,0);fr.add(lint);}
    else{mbox(3,5,3,closed?M.wall:M.gate,x,2.5,z);}
    const sp=sprite3(`${g.lab.toUpperCase()}${g.tag?' · '+g.tag:''}`,{bg:closed?'#8A2A1C':'#18212B',fg:'#FFFFFF',h:2.2});sp.position.set(x,10.4,z+sg*2);S.add(sp);});
  const endMat=k=>k==='stairs'?M.stair:M.glass;
  const fobLab=(f,x,z)=>{const sp=sprite3(`${fobShort(f).toUpperCase()} · ${accessWord(f).toUpperCase()}`,{bg:'#1D59C4',fg:'#FFFFFF',h:2.2});sp.position.set(x,HF+5.4,z);S.add(sp);};
  const landing=(f,x,z)=>{if(f.stairs||(!f.lift&&!f.esc))ramp3(x,HF,x-11,0,z-2,2.6,M.stair);if(f.esc)ramp3(x,HF,x+11,0,z-2,2.6,M.glass);if(f.lift)mbox(3,HF+2.4,3,M.glass,x+(f.esc?-4:3),(HF+2.4)/2,z+2.5);};
  FOBS.forEach(f=>{
    if(f.shape==='straight'){const ids=VNODES[f.id]||[];if(!ids.length)return;const X=wx(f.x),zs=ids.map(id=>wz(N[id].y)),z0=Math.min(...zs)-4,z1=Math.max(...zs)+4,len=z1-z0,zm=(z0+z1)/2,px=wx(fobLand(f));
      (W.fobMesh[f.id]=W.fobMesh[f.id]||[]).push(mbox(8,.6,len,M.deck,X,HF-.3,zm));mbox(.15,1.1,len,M.rail,X-4,HF+.55,zm);mbox(.15,1.1,len,M.rail,X+4,HF+.55,zm);mbox(9,.2,len,M.canopy,X,HF+3.8,zm);
      ids.forEach(id=>{const n=N[id],z=wz(n.y);mbox(.9,HF+1.3,.9,M.rail,X,(HF-1.3)/2,z+3);
        if(n.p!==undefined&&n.land){if(f.stairs||(!f.lift&&!f.esc))ramp3(X,HF,px,0,z-(f.lift?2:0),f.lift?2.6:3,M.stair);if(f.esc)ramp3(X,HF,px+(px>=X?3:-3),0,z+2,2.4,M.glass);if(f.lift)mbox(3,HF+2.4,3,M.glass,px,(HF+2.4)/2,z+2.5);}});
      if(f.endP!=='none')ramp3(X,HF,px,0,wz(CPY),3.4,endMat(f.endP));if(f.endA!=='none')ramp3(X,HF,px,0,wz(CAY),3.4,endMat(f.endA));
      fobLab(f,X,zs[0]+(ids[0].endsWith('_P')?12:-6));if(ids.length>3)fobLab(f,X,zs[zs.length-1]-(ids[ids.length-1].endsWith('_A')?12:-6));return;}
    const path=ZPATH[f.id]||[];const segs=f.shape==='path'?(FSEG[f.id]||[]):path.slice(1).map((id,i)=>[path[i],id]);
    for(const [sa,sb] of segs){const a=N[sa],b=N[sb];if(!a||!b)continue;const x0=wx(a.x),z0=wz(a.y),x1=wx(b.x),z1=wz(b.y),L=Math.hypot(x1-x0,z1-z0);if(L<.1)continue;
      const m=new THREE.Mesh(new THREE.BoxGeometry(L+6,.6,6),M.deck);m.position.set((x0+x1)/2,HF-.3,(z0+z1)/2);m.rotation.y=-Math.atan2(z1-z0,x1-x0);S.add(m);(W.fobMesh[f.id]=W.fobMesh[f.id]||[]).push(m);
      const r=new THREE.Mesh(new THREE.BoxGeometry(L+6,.2,6.6),M.canopy);r.position.set((x0+x1)/2,HF+3.6,(z0+z1)/2);r.rotation.y=m.rotation.y;S.add(r);}
    path.forEach(id=>{const n=N[id];if(!n||n.ctx!==f.id)return;const x=wx(n.x),z=wz(n.y);
      if(n.ways){n.ways.forEach(w=>{const sg=endSign(w.side)||-1,ty=/^pl\d$/.test(w.to)?PY(+w.to.slice(2)):w.to==='P'?CPY:w.to==='A'?CAY:(N[(GATES.find(g=>String(g[0])===String(w.gate))||[])[1]]||{y:CPY}).y;
          const tz=wz(ty)+(/^pl/.test(w.to)?2.5:ty<386?-3:3),stair=w.stairs||(!w.lift&&!w.esc);
          if(stair)ramp3(x,HF,x+sg*11,0,tz-(w.esc?1.6:0),2.6,M.stair);if(w.esc)ramp3(x,HF,x+sg*11,0,tz+1.6,2.4,M.glass);if(w.lift)mbox(3,HF+2.4,3,M.glass,x+sg*3,(HF+2.4)/2,tz+(/^pl/.test(w.to)?0:0));});return;}
      if((n.p!==undefined&&n.land)||(n.lobby&&!f.from&&f.plats.includes(n.p0)))landing(n.acc||f,x,z+2.5);
      if(n.to==='P'||n.to==='A'||n.to==='gate'){const gy=n.to==='gate'?(N[(GATES.find(g=>String(g[0])===String(n.gate))||[])[1]]||{y:CPY}).y:n.to==='P'?CPY:CAY;const k=n.acc||f;
        ramp3(x,HF,x-11,0,wz(gy)+(gy<386?-3:3),3,k.stairs||(!k.lift&&!k.esc)?M.stair:M.glass);if(k.lift)mbox(3,HF+2.4,3,M.glass,x+3,(HF+2.4)/2,wz(gy));}
      if(id.endsWith('_P'))ramp3(x,HF,x-11,0,wz(CPY),3,endMat(f.endP));if(id.endsWith('_A'))ramp3(x,HF,x-11,0,wz(CAY),3,endMat(f.endA));});
    const L=N[f.id+'_L']||N[path[0]];if(L)fobLab(f,wx(L.x)-6,wz(L.y)+4);});
  WORKS.filter(w=>w.show).forEach(w=>{const X=wx(w.x),Z=wz(w.y),y0=w.area==='fob'?HF:0,R=Math.min(w.r,30),n=Math.max(6,Math.round(R/2.5));
    const wm=w.color?new THREE.MeshLambertMaterial({color:w.color}):M.work;for(let i=0;i<n;i++){const a=i/n*Math.PI*2;mbox(1.6,1.1,.25,wm,X+Math.cos(a)*R*.6,y0+.55,Z+Math.sin(a)*R*.35);}
    const sp=sprite3('⚠ '+w.name.toUpperCase()+(w.block?' · CLOSED':''),{bg:'#E8731A',fg:'#151515',h:2});sp.position.set(X,y0+4.2,Z);S.add(sp);});
  for(let p=0;p<9;p++){const lab=p===0?'PF 1':p===8?'PF 16':`PF ${2*p} | ${2*p+1}`;[150,560,880].forEach(x=>{const sp=sprite3(lab,{bg:'#F3C531',fg:'#151515',h:2});sp.position.set(wx(x),3.7,wz(PY(p)));S.add(sp);});}
  W.target=null;}
function clearGroup(g){while(g.children.length){const o=g.children.pop();o.traverse(x=>{if(x.geometry)x.geometry.dispose();if(x.isSprite){if(x.material.map)x.material.map.dispose();x.material.dispose();}});}}
// Stalls on a platform: island platforms (2/3 … 14/15, shared by two tracks) have them on the middle line;
// PF 1 and PF 16 (one track each) have them against the back wall, away from the track.
function platStallZ(ctx){const b=+String(ctx).slice(2);return b===0?-2.8:b===8?2.8:0;}
// the walking line on an island platform runs beside the middle-line stalls, not through them
function platWalkZ(ctx){const m=/^pl(\d)$/.exec(String(ctx||''));if(!m)return 0;const b=+m[1];return b>=1&&b<=7?-2.9:0;}
// Where a concourse / outside amenity really is (map units): its surveyed spot, kept off the tracks; out=true when it is beyond the station wall
// ---- the station as it really is, from the site survey (map units): true gate spots, the building front on each side, platform lengths ----
let REAL=null,REAL_SIG='';
const GATE_OUT_OK=st=>!['entry','closed'].includes(st||'open');
function realStation(){const geo=LAYOUT&&LAYOUT.geo,sig=LAYOUT_REV+'|'+(geo?geo.at:'')+'|'+Object.keys(SURVEY).length+'|'+FAC.length;if(REAL&&REAL_SIG===sig)return REAL;REAL_SIG=sig;
  const tp=(lat,lng)=>geo&&lat!=null&&lng!=null&&lat!==''?surveyXY(geo,...geoEN(+lat,+lng)):null;
  const R={gates:[],wall:{},xr:{},pf:{}};
  GATES.forEach(([n,id,tag,g,lab])=>{const nd=N[id];if(!nd||(nd.ctx!=='P'&&nd.ctx!=='A'))return;const side=nd.ctx,sv=g&&g.id?SURVEY[String(g.id).replace(/^s[ge]-/,'')]:null,m=sv?tp(sv.lat,sv.lng):null;
    const edge=side==='P'?PY(0):PY(8),y=m?m.y:(side==='P'?CPY-20:CAY+20);
    R.gates.push({id,side,x:nd.x,tx:m?m.x:nd.x,ty:y,status:(g&&g.status)||'open',kind:(g&&g.kind)||'gate',tag,lab:String(lab||gateText(n)),front:(!g||g.kind!=='entry')&&Math.abs(y-edge)<260});});
  ['P','A'].forEach(side=>{const P=side==='P',edge=P?PY(0):PY(8),lim=P?CPY-10:CAY+10;
    const fr=R.gates.filter(g=>g.side===side&&g.front).sort((a,b)=>a.tx-b.tx);fr.forEach(g=>{g.wy=P?Math.min(g.ty,lim):Math.max(g.ty,lim);});
    R.gates.filter(g=>g.side===side&&!g.front).forEach(g=>{g.wy=g.ty;});
    // how far the concourse runs: the gates, the bridges that land on it and everything placed on it
    const xs=fr.map(g=>g.tx);FOBS.forEach(f=>{const ids=VNODES[f.id]||ZPATH[f.id]||[];ids.forEach(id=>{(ADJ[id]||[]).forEach(e=>{const t=N[e.b];if(t&&t.ctx===side)xs.push(t.x);});});});
    FAC.forEach(a=>{const n=a._n&&N[a._n];if(n&&n.ctx===side)xs.push(n.x);});
    const x0=xs.length?Math.max(-300,Math.min(...xs)-30):60,x1=xs.length?Math.min(1300,Math.max(...xs)+30):940;R.xr[side]=[x0,x1];
    const w=fr.map(g=>({x:g.tx,y:g.wy,g}));if(!w.length)w.push({x:x0,y:P?CPY-30:CAY+30},{x:x1,y:P?CPY-30:CAY+30});
    if(w[0].x>x0)w.unshift({x:x0,y:w[0].y});if(w[w.length-1].x<x1)w.push({x:x1,y:w[w.length-1].y});R.wall[side]=w;R['edge'+side]=P?edge-12:edge+12;});
  // platform lengths from the surveyed ends (and bends)
  Object.values(SURVEY).forEach(q=>{if((q.t!=='pfend'&&q.t!=='pfpt')||!q.pf)return;const m=tp(q.lat,q.lng);if(!m)return;const b=pfBar(+q.pf);if(b==null||isNaN(b))return;const r=R.pf[b]||(R.pf[b]=[m.x,m.x]);r[0]=Math.min(r[0],m.x);r[1]=Math.max(r[1],m.x);});
  return REAL=R;}
function wallY(side,x){const w=(realStation().wall[side])||[];if(!w.length)return side==='P'?28:742;if(x<=w[0].x)return w[0].y;
  for(let i=1;i<w.length;i++)if(x<=w[i].x){const a=w[i-1],b=w[i],t=(b.x-a.x)>1e-6?(x-a.x)/(b.x-a.x):0;return a.y+(b.y-a.y)*t;}return w[w.length-1].y;}
// best gate to walk out of, from the concourse spot fromX to an outside spot (tx,ty): only gates passengers may leave by
function exitGate(side,fromX,tx,ty){let best=null;realStation().gates.forEach(g=>{if(g.side!==side||!g.front||!GATE_OUT_OK(g.status))return;
    const c=Math.abs(fromX-g.tx)*SX+Math.hypot((g.tx-tx)*SX,(g.wy-ty)*SY);if(!best||c<best.c)best={c,g};});return best&&best.g;}
// Where an amenity off the platforms really is (map units): its recorded spot; out=true when it is outside the station building
function facTrue(a){if(!a||a.pf||!hasLL(a)||!LAYOUT||!LAYOUT.geo||!a._n||!N[a._n])return null;const side=N[a._n].ctx;if(side!=='P'&&side!=='A')return null;
  const m=surveyXY(LAYOUT.geo,...geoEN(a.lat,a.lng));if(a.src!=='survey'&&a.x!=null&&Math.abs(m.x-(+a.x))>40)return null;
  let y=m.y;if(side==='P')y=Math.min(y,PY(0)-14);else y=Math.max(y,PY(8)+14);const x=Math.max(-400,Math.min(1400,m.x));
  const w=wallY(side,x),out=side==='P'?y<w-8:y>w+8;const g=out?exitGate(side,N[a._n].x,x,y):null;
  return {x,y,side,out:!!(out&&g),gate:out?g:null};}
function runStart(ids,side){let r=ids.length;while(r>0&&N[ids[r-1]]&&N[ids[r-1]].ctx===side)r--;return r;}
function routeOut(dest,ids){const t=dest&&dest.cat!=='platform'?facTrue(dest):null;if(!t||!t.out)return t;const r=runStart(ids,t.side);const fx=r<ids.length?N[ids[r]].x:N[ids[ids.length-1]].x;
  const g=exitGate(t.side,fx,t.x,t.y)||t.gate;return Object.assign({},t,{gate:g,run:r,fx});}
function cutAtGate(ids,run,gx){let best=-1,bd=1e9;for(let i=Math.max(run,0);i<ids.length;i++){const n=N[ids[i]];if(!n)continue;const dd=Math.abs(n.x-gx);if(dd<bd-1e-6){bd=dd;best=i;}}return best<0?ids.length:best+1;}
function outStep(dest,ids){const t=routeOut(dest,ids);if(!t||!t.out)return null;const g=t.gate,m=Math.round(Math.hypot((g.tx-t.x)*SX,(g.wy-t.y)*SY)/5)*5;
  return {t:`Go out through ${g.lab}`,s:`${dest.name} is outside the station building, about ${Math.max(5,m)} m from the gate${worksOutside(t)?' · ⚠ redevelopment work outside, follow the signs':''}`,pts:[ids[ids.length-1]],x3:'__extO',out:t};}
function worksOutside(t){if(!LAYOUT||!LAYOUT.geo)return false;return Object.values(SURVEY).some(q=>q.t==='out'&&/constr|work|redevelop/i.test((q.name||'')+' '+(q.kind||''))&&Array.isArray(q.pts)&&q.pts.some(pp=>{const m=surveyXY(LAYOUT.geo,...geoEN(pp[0],pp[1]));return Math.hypot((m.x-t.x)*SX,(m.y-t.y)*SY)<80;}));}
function fac3(a,k,cnt){const t=facTrue(a);if(t)return new THREE.Vector3(wx(t.x),0,wz(t.y));const id=a._n,p=V(id),c=N[id].ctx;k=k||0;cnt=cnt||1;
  if(isVert(c)){p.z+=(k-(cnt-1)/2)*4.2;p.x+=3;}else{p.x+=(k-(cnt-1)/2)*4.2;p.z+=c==='P'?-6.5:c==='A'?6.5:platStallZ(c);}return p;}
function rebuildDyn3d(A){clearGroup(W.dyn);W.bob=null;const dest=A.dest,pt=A.pt;
  const byNode={};FAC.forEach(a=>{if(a._n){const n=N[a._n],k=Math.round(n.x/14)+':'+Math.round(n.y/14);(byNode[k]=byNode[k]||{n:a._n,arr:[]}).arr.push(a);}});
  Object.values(byNode).forEach(({n:id,arr})=>arr.forEach((a,k)=>{const p=fac3(a,k,arr.length),tr=facTrue(a);if(tr&&tr.out){const st=sprite3('OUTSIDE',{bg:'#5B6470',fg:'#FFFFFF',h:1});st.position.set(p.x,5.1,p.z);W.dyn.add(st);}
    const isD=dest&&a.id===dest.id,open=isOpen(a);
    mbox(2.6,2.6,2.6,isD?W.M.dest:open?W.M.kiosk:W.M.kioskOff,p.x,1.3,p.z,W.dyn);
    const sp=sprite3(CAT[a.cat]?CAT[a.cat].code:'?',{bg:isD?'#F3C531':'#18212B',fg:isD?'#151515':'#FFFFFF',h:1.5});sp.position.set(p.x,3.5,p.z);W.dyn.add(sp);
    if(isD)destMarker(p,a.name);}));
  if(dest&&dest.cat==='platform'&&A.tn)destMarker(V(A.tn),dest.name);
  if(N.__pin&&pt){const p=V('__pin');const sp=W.youSp=sprite3('YOU ARE HERE · '+pt.name.toUpperCase(),{bg:'#CF4128',fg:'#FFFFFF',h:2.6});sp.position.set(p.x,p.y+11,p.z);sp.visible=W.mode==='overview';W.dyn.add(sp);}}
function destMarker(p,name){const lab=sprite3(name,{bg:'#F3C531',fg:'#151515',h:2.6});lab.position.set(p.x,9.6,p.z);W.dyn.add(lab);
  const cone=new THREE.Mesh(new THREE.ConeGeometry(1.1,2.2,4),W.M.dest);cone.rotation.x=Math.PI;cone.position.set(p.x,6.6,p.z);W.dyn.add(cone);W.bob=cone;}
let Q3=null,M3=null,S3=null,X3=null;
function rebuildRoute3d(A){clearGroup(W.rg);W.chev=null;
  const ids=[A.start,...(A.edges||[]).map(e=>e.b)].filter(id=>N[id]);W.ids=ids;W.path=ids.map(id=>{const v=V(id);v.y+=.12;const n=N[id];if(n&&!isVert(n.ctx))v.z+=platWalkZ(n.ctx);return v;});
  // last few metres: from the concourse walkway to the amenity's real spot, out through the nearest gate when it is outside
  const tr=A.dest&&A.dest.cat!=='platform'&&routeOut(A.dest,ids);W.extOut=null;
  if(tr&&W.path.length&&(A.edges||[]).length){const ext=[];if(tr.out){const g=tr.gate,P=tr.side==='P',cy=P?CPY:CAY;W.extOut=g.lab;
      // stop walking along the concourse where it passes the gate, instead of going on and coming back
      {const c=cutAtGate(ids,tr.run,g.tx);ids.length=c;W.path.length=c;}
      ext.push([g.tx,cy,'__extA'],[g.tx,g.wy+(P?6:-6),'__extG'],[g.tx,g.wy+(P?-12:12),'__extO']);}
    ext.push([tr.x,tr.y,'__ext_end']);ext.forEach(([x,y,id])=>{W.path.push(new THREE.Vector3(wx(x),.12,wz(y)));ids.push(id);});}
  W.where=whereList(ids,A);tintFobs(new Set(ids.filter(id=>N[id]&&isFob(N[id].ctx)).map(id=>N[id].ctx)));fobSigns3d(ids);
  W.cum=[0];for(let i=1;i<W.path.length;i++)W.cum.push(W.cum[i-1]+W.path[i].distanceTo(W.path[i-1]));W.total=W.cum[W.cum.length-1];
  if(W.total>.5){const cp=new THREE.CurvePath();for(let i=1;i<W.path.length;i++)if(W.path[i].distanceTo(W.path[i-1])>.01)cp.add(new THREE.LineCurve3(W.path[i-1].clone(),W.path[i].clone()));
    W.rg.add(new THREE.Mesh(new THREE.TubeGeometry(cp,Math.max(24,cp.curves.length*24),.5,8,false),W.M.route));
    const sh=new THREE.Shape();sh.moveTo(1.1,0);sh.lineTo(-.7,.85);sh.lineTo(-.3,0);sh.lineTo(-.7,-.85);sh.closePath();
    const geo=new THREE.ShapeGeometry(sh);geo.rotateX(-Math.PI/2);
    W.chevN=Math.max(1,Math.floor(W.total/5));W.chev=new THREE.InstancedMesh(geo,W.M.chev,W.chevN);W.chev.frustumCulled=false;W.rg.add(W.chev);placeChev();}
  setOverviewTarget();}
// ---- "where am I" in 3D: platform, which foot over bridge (and from where to where), concourse or outside ----
function fobOver(y){if(y<PY(0)-12)return 'over the Paharganj side';if(y>PY(8)+12)return 'over the Ajmeri Gate side';const p=nearestPlat(y);if(Math.abs(PY(p)-y)<14)return 'above '+platLabel(p);const q=y>PY(p)?p+1:p-1;return `between ${platLabel(Math.min(p,q))} and ${platLabel(Math.max(p,q)).replace('Platform ','')}`;}
function whereList(ids,A){const ctxOf=id=>N[id]?N[id].ctx:null;
  return ids.map((id,i)=>{if(id.startsWith('__ext')){const sd=facTrue(A.dest),sl=areaLabel(sd?sd.side:'P');
      if(sd&&sd.out&&(id==='__extO'||id==='__ext_end'))return {k:'out',t:'Outside the station building',s:`Out through ${W.extOut}${A.dest?' → '+A.dest.name:''}`};
      if(id==='__extA'||id==='__extG')return {k:'conc',t:sl,s:`Head for ${W.extOut} to go out`};
      return {k:'conc',t:sl,s:A.dest?'Almost there · '+A.dest.name:''};}
    const n=N[id],c=n.ctx;
    if(isFob(c)){let a=i,b=i;while(a>0&&ctxOf(ids[a-1])===c)a--;while(b<ids.length-1&&ctxOf(ids[b+1])===c)b++;
      const from=a>0&&ctxOf(ids[a-1])?areaLabel(ctxOf(ids[a-1])):'',to=b<ids.length-1&&ctxOf(ids[b+1])?areaLabel(ctxOf(ids[b+1])):'';
      const f=FOB_BY[c],pos=fobOver(n.y);
      return {k:'fob',t:`On ${f?fobShort(f):'the bridge'} · upstairs${pos?' · '+pos:''}`,s:[from&&'Up from '+from,to&&'down to '+to].filter(Boolean).join(' → ')};}
    if(/^pl\d$/.test(c))return {k:'plat',t:`On ${platLabel(+c.slice(2))}`,s:landmarkAt(c,n.x)?'near '+landmarkAt(c,n.x):''};
    return {k:'conc',t:areaLabel(c),s:landmarkAt(c,n.x)?'near '+landmarkAt(c,n.x):''};});}
function whereNow(){const L=W.where;if(!L||!L.length||!W.path.length)return null;if(W.path.length<2)return L[0];const i=segAt(W.dist),a=W.cum[i],b=W.cum[i+1];
  const j=(W.dist-a)<(b-W.dist)?i:i+1;const A=L[i],B=L[i+1]||A;
  // while climbing or coming down the stairs, say so
  if(A.k!==B.k&&(A.k==='fob'||B.k==='fob')&&W.dist>a+1&&W.dist<b-1)return B.k==='fob'?{k:'fob',t:'Going up to '+B.t.replace(/^On /,'').split(' · ')[0],s:B.s}:{k:B.k,t:'Coming down to '+B.t.replace(/^On /,''),s:A.s};
  return L[j]||A;}
const WHERE_ICON={fob:'⇡',plat:'▤',conc:'◫',out:'⇱'};
function whereChip(){const st=$('stage3d');if(!st)return;let el=st.querySelector('.where3d');if(!el){st.insertAdjacentHTML('beforeend','<div class="where3d" role="status" aria-live="polite"><b></b><span class="w-t"></span><span class="w-s"></span></div>');el=st.querySelector('.where3d');}
  const w=whereNow();if(!w){el.hidden=true;return;}const key=w.k+'|'+w.t+'|'+w.s;if(el._k===key)return;el._k=key;el.hidden=false;el.dataset.k=w.k;
  el.querySelector('b').textContent=WHERE_ICON[w.k]||'';el.querySelector('.w-t').textContent=w.t;el.querySelector('.w-s').textContent=w.s||'';}
// the bridge(s) this route uses are coloured, the rest stay plain
function tintFobs(used){W.usedFobs=used;if(!W.fobMesh||!W.M)return;unfadeAll3d();Object.entries(W.fobMesh).forEach(([id,ms])=>ms.forEach(m=>{m.material=used.has(id)?W.M.deckOn:W.M.deck;}));}
function fobSigns3d(ids){for(let i=0;i<ids.length;i++){const n=N[ids[i]];if(!n||!isFob(n.ctx))continue;const prev=N[ids[i-1]],next=N[ids[i+1]];const f=FOB_BY[n.ctx],nm=f?fobShort(f).toUpperCase():'BRIDGE';
    if(prev&&!isFob(prev.ctx)){const v=V(ids[i]);const sp=sprite3(`⇡ UP TO ${nm} · FROM ${areaShort(prev.ctx)}`,{bg:'#1D59C4',fg:'#FFFFFF',h:2});sp.position.set(v.x,HF+8.4,v.z);W.rg.add(sp);}
    if(next&&!isFob(next.ctx)){const v=V(ids[i]);const sp=sprite3(`⇣ DOWN TO ${areaShort(next.ctx)}`,{bg:'#1D59C4',fg:'#FFFFFF',h:2});sp.position.set(v.x,HF+8.4,v.z+(prev&&!isFob(prev.ctx)?5:0));W.rg.add(sp);}}}
const areaShort=c=>c==='P'?'PAHARGANJ SIDE':c==='A'?'AJMERI GATE SIDE':/^pl\d$/.test(c)?platLabel(+c.slice(2)).replace('Platform','PF').toUpperCase():String(c).toUpperCase();
function segAt(d){const c=W.cum;let i=0;while(i<c.length-2&&c[i+1]<d)i++;return i;}
function pointAt(d){const P=W.path;if(!P.length)return new THREE.Vector3();if(P.length<2)return P[0].clone();d=Math.max(0,Math.min(W.total,d));const i=segAt(d),Ln=W.cum[i+1]-W.cum[i];return P[i].clone().lerp(P[i+1],Ln>1e-6?(d-W.cum[i])/Ln:0);}
function dirAt(d){const P=W.path;if(P.length<2)return new THREE.Vector3(1,0,0);let i=segAt(Math.max(0,Math.min(W.total,d))),j=i;
  while(j<P.length-1&&P[j+1].distanceTo(P[j])<1e-3)j++;if(j>=P.length-1){j=Math.min(i,P.length-2);while(j>0&&P[j+1].distanceTo(P[j])<1e-3)j--;}
  const v=P[j+1].clone().sub(P[j]);return v.lengthSq()>1e-8?v.normalize():new THREE.Vector3(1,0,0);}
function placeChev(){if(!W.chev)return;if(!Q3){Q3=new THREE.Quaternion();M3=new THREE.Matrix4();S3=new THREE.Vector3(1,1,1);X3=new THREE.Vector3(1,0,0);}
  for(let i=0;i<W.chevN;i++){const d=(i*5+W.chevOff)%Math.max(W.total,.001);const p=pointAt(d);Q3.setFromUnitVectors(X3,dirAt(d));p.y+=.42;M3.compose(p,Q3,S3);W.chev.setMatrixAt(i,M3);}
  W.chev.instanceMatrix.needsUpdate=true;}
function computeEnds(){const ids=W.ids||[];W.ends=STEPS.map(()=>0);let idx=0;
  STEPS.forEach((s,k)=>{if(k===0)return;const last=s.x3&&ids.includes(s.x3)?s.x3:s.pts[s.pts.length-1];let j=ids.indexOf(last,idx);if(j<0)j=idx;idx=j;W.ends[k]=W.cum[j]||0;});
  if(STEPS.length>1)W.ends[STEPS.length-1]=W.total||0;}
function curFromDist(){for(let i=1;i<W.ends.length;i++)if(W.dist<W.ends[i]-.01)return i;return Math.max(0,W.ends.length-1);}
function update3d(A){W.args=A;
  if(W.ok===null){$('stageMsg').hidden=false;}
  ensure3d().then(ok=>{const msg=$('stageMsg');const a=W.args;
    if(!ok){msg.hidden=false;msg.textContent=W.why;W.ids=[];if(a&&a.routeKey!==W.routeKey){W.routeKey=a.routeKey;W.cur=0;}renderWalkCard();return;}
    msg.hidden=true;if(!a)return;
    if(W.outSig!==outSig()||W.realRef!==realStation())W.staticDirty=true;
    if(W.staticDirty){W.staticDirty=false;buildStatic3d();if(W.usedFobs)tintFobs(W.usedFobs);}
    const rNew=a.routeKey!==W.routeKey;
    if(rNew){W.routeKey=a.routeKey;rebuildRoute3d(a);W.dist=0;W.goal=null;W.playing=false;W.cur=0;snapCam();}
    if(rNew||a.dynKey!==W.dynKey||W.phFacKey!==Object.keys(PHOTOS).length){W.dynKey=a.dynKey;W.phFacKey=Object.keys(PHOTOS).length;rebuildDyn3d(a);facBoards3d(a);}
    if(W.youSp)W.youSp.visible=W.mode==='overview';
    const pk=W.routeKey+'#'+STEPS.map(s=>{const sp=stepPhoto(s);return sp?sp.url:'';}).join('|');if(pk!==W.phKey){W.phKey=pk;rebuildPhotos3d();}
    computeEnds();renderWalkCard();markCur();size3d();startLoop();});}
function snapCam(){const p=pointAt(W.dist),d=dirAt(W.dist);d.y=0;if(d.lengthSq()<1e-4)d.set(1,0,0);d.normalize();W.sdir.copy(d);
  if(W.mode==='follow'){W.camera.position.copy(p).addScaledVector(d,-FCAM.back);W.camera.position.y=p.y+FCAM.up;clampCam(W.camera.position);W.look.copy(p).addScaledVector(d,FCAM.ahead);W.look.y=p.y+FCAM.lookUp;W.camera.lookAt(W.look);}}
// follow camera at eye level behind the walker: below the bridge decks (6.5 m) and platform canopies (5.6 m), like walking with Street View
const FCAM={back:9.5,up:3.4,ahead:14,lookUp:1.3};
function clampCam(v){const zl=wz(28)+2,zh=wz(742)-2;if(v.z<zl){v.y+=Math.min(2,(zl-v.z)*.3);v.z=zl;}if(v.z>zh){v.y+=Math.min(2,(v.z-zh)*.3);v.z=zh;}v.x=Math.max(-320,Math.min(320,v.x));}
function setOverviewTarget(){if(!W.path.length)return;const b=new THREE.Box3().setFromPoints(W.path),c=b.getCenter(new THREE.Vector3()),s=b.getSize(new THREE.Vector3());
  W.orb.cx=c.x;W.orb.cz=c.z;W.orb.r=Math.max(90,Math.max(s.x,s.z)*1.3+50);}
function camStep(dt){const cam=W.camera,k=Math.min(1,dt*4);
  if(W.mode==='follow'){const p=pointAt(W.dist),d=dirAt(W.dist);d.y=0;if(d.lengthSq()>1e-4){d.normalize();W.sdir.lerp(d,Math.min(1,dt*3));if(W.sdir.lengthSq()<1e-4)W.sdir.copy(d);W.sdir.normalize();}
    const want=p.clone().addScaledVector(W.sdir,-FCAM.back);want.y=p.y+FCAM.up;clampCam(want);const look=p.clone().addScaledVector(W.sdir,FCAM.ahead);look.y=p.y+FCAM.lookUp;cam.position.lerp(want,k);W.look.lerp(look,k);}
  else{const o=W.orb;cam.position.lerp(new THREE.Vector3(o.cx+o.r*Math.sin(o.ph)*Math.cos(o.th),o.r*Math.cos(o.ph),o.cz+o.r*Math.sin(o.ph)*Math.sin(o.th)),k);W.look.lerp(new THREE.Vector3(o.cx,0,o.cz),k);}
  cam.lookAt(W.look);}
function setCam(m){if(W.mode!==m&&m==='overview')setOverviewTarget();W.mode=m;if(W.youSp)W.youSp.visible=m==='overview';document.querySelectorAll('[data-cam]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.cam===m));startLoop();}
document.querySelector('.camsw').addEventListener('click',e=>{const b=e.target.closest('[data-cam]');if(b)setCam(b.dataset.cam);});
document.querySelector('.zoomsw').addEventListener('click',e=>{const b=e.target.closest('[data-zoom]');if(!b||!W.ok)return;if(W.mode!=='overview')setCam('overview');W.orb.r*=1+(+b.dataset.zoom)*.25;orbClamp();startLoop();});
// 3D view controls, like a map app:
// one finger / left mouse drag = move around the station; two fingers = pinch to zoom, twist to turn, slide up/down to tilt;
// right mouse drag (or Shift + drag) = turn and tilt; mouse wheel = zoom; on-screen buttons for zoom, turn and tilt.
function orbClamp(){const o=W.orb;o.r=Math.max(18,Math.min(700,o.r));o.ph=Math.max(.12,Math.min(1.45,o.ph));o.cx=Math.max(-320,Math.min(320,o.cx));o.cz=Math.max(wz(0)-40,Math.min(wz(792)+40,o.cz));}
function orbPan(dx,dy){const o=W.orb,el=$('c3d'),h=(el&&el.clientHeight)||500,k=o.r*1.6/h,c=Math.cos(o.th),sn=Math.sin(o.th);
  o.cx+=(-sn*dx-c*dy)*k;o.cz+=(c*dx-sn*dy)*k;}
function toOverview(){if(W.mode!=='overview')setCam('overview');}
function bindOrbit(){const c=$('c3d');const pts=new Map();let drag=null,two=null;
  const pair=()=>{const a=[...pts.values()];const dx=a[1].x-a[0].x,dy=a[1].y-a[0].y;return {d:Math.hypot(dx,dy)||1,ang:Math.atan2(dy,dx),my:(a[0].y+a[1].y)/2,mx:(a[0].x+a[1].x)/2};};
  c.addEventListener('contextmenu',e=>e.preventDefault());
  c.addEventListener('pointerdown',e=>{pts.set(e.pointerId,{x:e.clientX,y:e.clientY});try{c.setPointerCapture(e.pointerId);}catch(_){}
    if(pts.size===1){drag={x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,rot:e.button===2||e.shiftKey||e.ctrlKey,moved:false};two=null;}
    else if(pts.size===2){two=pair();if(drag)drag.moved=true;}});
  c.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size>=2&&two){const p=pair();toOverview();const o=W.orb;
      o.r*=two.d/p.d;let da=p.ang-two.ang;if(da>Math.PI)da-=2*Math.PI;if(da<-Math.PI)da+=2*Math.PI;o.th-=da;o.ph-=(p.my-two.my)*.006;orbPan(p.mx-two.mx,0);
      two=p;orbClamp();startLoop();return;}
    if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;if(Math.abs(dx)+Math.abs(dy)<1)return;
    if(Math.abs(e.clientX-drag.x0)+Math.abs(e.clientY-drag.y0)>6)drag.moved=true;toOverview();
    if(drag.rot){W.orb.th+=dx*.006;W.orb.ph-=dy*.005;}else orbPan(dx,dy);orbClamp();startLoop();});
  const up=e=>{const was=drag;pts.delete(e.pointerId);if(pts.size<2)two=null;
    if(pts.size===0){if(was&&e.type==='pointerup'&&!was.moved)pickPhoto3d(e);drag=null;}
    else if(pts.size===1){const q=[...pts.values()][0];drag={x:q.x,y:q.y,x0:q.x,y0:q.y,rot:false,moved:true};}};
  c.addEventListener('pointerup',up);c.addEventListener('pointercancel',up);
  c.addEventListener('wheel',e=>{e.preventDefault();toOverview();if(e.ctrlKey){W.orb.r*=1+e.deltaY*.01;}else W.orb.r*=1+Math.sign(e.deltaY)*.1;orbClamp();startLoop();},{passive:false});
  // extra on-screen buttons: turn left/right, tilt, and back to the whole route
  const zs=document.querySelector('.zoomsw');if(zs&&!zs.querySelector('[data-orb]')){
    zs.insertAdjacentHTML('beforeend','<button type="button" data-orb="l" aria-label="Turn left">⟲</button><button type="button" data-orb="r" aria-label="Turn right">⟳</button><button type="button" data-orb="t" aria-label="Tilt: look from above or from the side">⤡</button><button type="button" data-orb="c" aria-label="Show the whole route">⌖</button>');
    zs.addEventListener('click',e=>{const b=e.target.closest('[data-orb]');if(!b||!W.ok)return;const o=W.orb,k=b.dataset.orb;
      if(k==='c'){W.mode='';setCam('overview');return;}toOverview();
      if(k==='l')o.th-=Math.PI/8;else if(k==='r')o.th+=Math.PI/8;else if(k==='t')o.ph=o.ph>.8?.35:1.2;orbClamp();startLoop();});}
  const st=c.parentElement;if(st&&!st.querySelector('.gesthint')){st.insertAdjacentHTML('beforeend','<p class="gesthint" aria-hidden="true">Drag to move · two fingers to zoom, turn and tilt</p>');
    const gh=st.querySelector('.gesthint');const hide=()=>{gh.classList.add('off');};c.addEventListener('pointerdown',hide,{once:true});setTimeout(hide,7000);}}
function startLoop(){if(W.raf||!W.ok||MODE!=='3d'||VIEW!=='passenger')return;W.last=performance.now();W.raf=requestAnimationFrame(tick);}
function stopLoop(){if(W.raf)cancelAnimationFrame(W.raf);W.raf=0;}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)startLoop();});
function tick(now){W.raf=0;if(MODE!=='3d'||VIEW!=='passenger'||document.hidden)return;
  const dt=Math.min(.05,Math.max(0,(now-W.last)/1000));W.last=now;
  if(W.playing){W.dist+=dt*W.speed;
    if(W.dist>=W.total){W.dist=W.total;W.playing=false;W.cur=Math.max(0,STEPS.length-1);renderWalkCard();markCur();}
    else{const ci=curFromDist();if(ci!==W.cur){W.cur=ci;renderWalkCard();markCur();}}}
  else if(W.goal!=null){W.dist+=(W.goal-W.dist)*Math.min(1,dt*2.5);if(Math.abs(W.goal-W.dist)<.05){W.dist=W.goal;W.goal=null;}}
  W.walker.position.copy(pointAt(W.dist));
  if(!RM){W.chevOff=(W.chevOff+dt*5)%5;placeChev();const f=(now/900)%1,s=1+f*.8;W.ring.scale.set(s,s,s);W.M.ring.opacity=.55*(1-f);if(W.bob)W.bob.position.y=6.6+Math.sin(now/300)*.6;}
  camStep(dt);if(now-(W.occT||0)>110){W.occT=now;unblock3d();whereChip();}W.renderer.render(W.scene,W.camera);W.raf=requestAnimationFrame(tick);}
let RC3=null;W.faded=new Set();W.fadeM=new Map();
function fadeMat(m){let f=W.fadeM.get(m);if(!f){f=m.clone();f.transparent=true;f.opacity=Math.min(m.opacity==null?1:m.opacity,.16);f.depthWrite=false;W.fadeM.set(m,f);}return f;}
function unblock3d(){if(!W.walker||!W.staticG)return;RC3=RC3||new THREE.Raycaster();RC3.camera=W.camera;const cam=W.camera.position,tg=W.walker.position.clone();tg.y+=1.4;
  const dir=tg.clone().sub(cam),dist=dir.length();if(dist<.5)return;dir.normalize();RC3.set(cam,dir);RC3.far=dist-.8;
  // also check a second ray to the route just ahead, so the line stays visible
  const hits=new Set();const look=W.mode==='follow'&&W.path.length?pointAt(Math.min(W.total,W.dist+8)):null;
  const objs=[W.staticG,W.dyn].filter(Boolean);
  const cast=()=>RC3.intersectObjects(objs,true).forEach(h=>{const o=h.object;if(o.isMesh&&!o.isInstancedMesh&&!o.userData.keep)hits.add(o);});
  cast();if(look){look.y+=.6;const d2=look.clone().sub(cam),l2=d2.length();if(l2>.5){RC3.set(cam,d2.normalize());RC3.far=l2-.5;cast();}}
  W.faded.forEach(o=>{if(!hits.has(o)){o.material=o.userData.mat0;W.faded.delete(o);}});
  hits.forEach(o=>{if(!W.faded.has(o)){o.userData.mat0=o.material;o.material=fadeMat(o.material);W.faded.add(o);}});}
function unfadeAll3d(){if(!W.faded)return;W.faded.forEach(o=>{o.material=o.userData.mat0;});W.faded.clear();W.fadeM.clear();}
function walkTo(i){if(!STEPS.length)return;i=Math.max(0,Math.min(STEPS.length-1,i));W.cur=i;W.playing=false;W.goal=W.ok?(i===0?0:(W.ends[i-1]||0)):null;
  if(W.ok&&W.mode!=='follow')setCam('follow');renderWalkCard();markCur();startLoop();}
function togglePlay(){if(!W.ok){walkTo(W.cur+1);return;}
  if(W.playing)W.playing=false;else{if(W.dist>=W.total-.1){W.dist=0;W.cur=0;}W.goal=null;W.playing=true;if(W.mode!=='follow')setCam('follow');}
  renderWalkCard();startLoop();}
function markCur(){document.querySelectorAll('#steps li').forEach(li=>li.classList.toggle('cur',(MODE==='3d'&&+li.dataset.i===W.cur)||(MODE==='live'&&LV.started&&+li.dataset.i===LV.cur)));}
function renderWalkCard(){const box=$('walkcard'),pip=$('pip');const n=STEPS.length;
  if(!n){box.innerHTML=`<span></span><div><div class="t">No route to show</div><div class="s">Pick another destination.</div></div>`;pip.hidden=true;return;}
  const i=Math.min(W.cur,n-1),s=STEPS[i],sp=stepPhoto(s);
  const playLbl=!W.ok?'':W.playing?'Pause':(W.total>0&&W.dist>=W.total-.1?'Walk again':'Walk it');
  box.innerHTML=`<span class="num${i===0?' n-start':i===n-1?' n-end':''}">${i+1}</span>
    <div><div class="of">Step ${i+1} of ${n}${sp?' · real photo':''}</div><div class="t">${esc(s.t)}</div>${s.s?`<div class="s">${esc(s.s)}</div>`:''}</div>
    <div class="ctl"><button class="btn sm" type="button" data-w="prev" ${i===0?'disabled':''}>◀ Back</button>${W.ok?`<button class="btn sm primary" type="button" data-w="play">${playLbl}</button>`:''}<button class="btn sm${W.ok?'':' primary'}" type="button" data-w="next" ${i===n-1?'disabled':''}>Next ▶</button></div>`;
  if(sp){const k=sp.url+'|'+(sp.hs?sp.hs.x+','+sp.hs.y:'');if(pip.dataset.k!==k){pip.innerHTML=`<span class="ph"><img src="${esc(sp.url)}" alt="Photo of this spot">${hsHtml(sp.hs)}</span><span class="cap">Real photo · tap to enlarge</span>`;pip.dataset.k=k;}pip.dataset.i=i;pip.hidden=false;}
  else{pip.hidden=true;pip.dataset.k='';}}
$('walkcard').addEventListener('click',e=>{const b=e.target.closest('[data-w]');if(!b||b.disabled)return;const w=b.dataset.w;
  if(w==='play')togglePlay();else walkTo(W.cur+(w==='next'?1:-1));});
$('pip').addEventListener('click',()=>openLightbox(+$('pip').dataset.i));


// Real photos stand in the 3D model as boards beside the route, one per step that has a photo. Tap a board to enlarge it.
function rebuildPhotos3d(){if(!W.pg){W.pg=new THREE.Group();W.scene.add(W.pg);}clearGroup(W.pg);let any=false;const placed=[];
  STEPS.forEach((s,i)=>{const sp=stepPhoto(s);if(!sp||!s.at||!N[s.at])return;any=true;
    const p=V(s.at);if(placed.some(q=>q.url===sp.url&&q.p.distanceTo(p)<20))return;placed.push({url:sp.url,p});let d=new THREE.Vector3(1,0,0);
    for(let j=1;j<s.pts.length;j++){if(!N[s.pts[j]]||!N[s.pts[j-1]])continue;const v=V(s.pts[j]).sub(V(s.pts[j-1]));v.y=0;if(v.lengthSq()>.01){d=v.normalize();break;}}
    const side=new THREE.Vector3(-d.z,0,d.x),ar=sp.ph.w&&sp.ph.h?Math.max(.6,Math.min(2,sp.ph.w/sp.ph.h)):4/3,H=3.6,Wd=H*ar;
    const pos=p.clone().addScaledVector(side,4+Wd/2).addScaledVector(d,5);const base=p.y;pos.y=base+2.6+H/2;
    mbox(.25,2.6+H*.2,.25,W.M.rail,pos.x,base+(2.6+H*.2)/2,pos.z,W.pg);
    const sm=new THREE.SpriteMaterial({transparent:true}),spr=new THREE.Sprite(sm);spr.scale.set(Wd*1.06,H*1.18,1);spr.position.copy(pos);spr.visible=false;spr.userData.i=i;W.pg.add(spr);
    const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>{if(spr.parent!==W.pg)return;const cw=640,ch=Math.round(cw/ar),bd=14,lab=64,c=document.createElement('canvas');c.width=cw+bd*2;c.height=ch+bd*2+lab;const g=c.getContext('2d');
      g.fillStyle='#F3C531';g.fillRect(0,0,c.width,c.height);g.drawImage(img,bd,bd+lab,cw,ch);g.fillStyle='#151515';g.font='700 40px "Barlow Condensed","Arial Narrow",sans-serif';g.textBaseline='middle';
      g.fillText(`STEP ${i+1} · REAL PHOTO · TAP`,bd+6,bd+lab/2);if(sp.hs){const hx=bd+cw*sp.hs.x/100,hy=bd+lab+ch*sp.hs.y/100;g.fillStyle='#CF4128';g.beginPath();g.arc(hx,hy,18,0,7);g.fill();g.strokeStyle='#FFFFFF';g.lineWidth=5;g.stroke();}
      const t=new THREE.CanvasTexture(c);t.minFilter=THREE.LinearFilter;sm.map=t;sm.needsUpdate=true;spr.scale.set(H*1.18*c.width/c.height,H*1.18,1);spr.visible=true;startLoop();};
    img.src=sp.url;});
  W.pgAny=any;$('hint3d').hidden=!any;}
function pickPhoto3d(e){if(!W.ok)return;W.pg=W.pg||new THREE.Group();const c=$('c3d'),r=c.getBoundingClientRect();
  const v=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);const rc=new THREE.Raycaster();rc.setFromCamera(v,W.camera);rc.camera=W.camera;
  const fh=rc.intersectObjects(W.dyn.children.filter(o=>o.isSprite&&o.visible&&o.userData.fac))[0];if(fh){openFacPhoto(fh.object.userData.fac);return;}
  const hit=rc.intersectObjects(W.pg.children.filter(o=>o.isSprite&&o.visible))[0];if(hit)openLightbox(hit.object.userData.i);}

// ================= STATION LAYOUT (staff editor) =================
let SAVED_LAYOUT=normLayout(DEFAULT_LAYOUT), LY_SOURCE='builtin';
const ly={draft:null,dirty:false,previewing:false,selFob:null,selGate:null,busy:false,confirmReset:false,msg:'',err:false};
const lySig=L=>JSON.stringify(normLayout(L));
const lyClone=o=>JSON.parse(JSON.stringify(o));
function applyLayout(L){buildGraph(normLayout(L));LAYOUT_REV++;rebuildFacNodes();fitGeo();
  W.staticDirty=!!W.ok;W.routeKey='';W.dynKey='';W.phKey='';lastRouteKey='';if(VIEW==='passenger')renderPassenger();if(VIEW==='admin')renderAdmin();if(VIEW==='qr'){qrBuilt='';renderQR();}}
const LY_STATUS=[['open','Entry & exit'],['main','Main entrance'],['entry','Entry only'],['exit','Exit only'],['closed','Closed']];
const LY_ENDS=[['none',"Doesn't reach it"],['stairs','Stairs'],['esc','Escalator'],['lift','Lift']];
const lyNewId=p=>p+Math.random().toString(36).replace(/[^a-z]/g,'').slice(0,5);
const opt=(v,l,cur)=>`<option value="${esc(v)}"${String(v)===String(cur)?' selected':''}>${esc(l)}</option>`;
function lyPosText(x){return `${posText(x)} · ${Math.round((x-50)*SX)} m from the left edge of the drawing`;}
function renderLayout(){if(VIEW!=='layout')return;lyViewsInit();if(LY_VIEW==='real')renderRealLy();if(!ly.draft)ly.draft=lyClone(SAVED_LAYOUT);
  const n=$('lyNotice');n.innerHTML=!DB?"<span>The layout can't be saved because the database isn't available.</span>":ly.draft.geo?`<span>This layout uses real positions from the <b>site survey</b>${ly.draft.geo.at?' built '+esc(rel(ly.draft.geo.at)):''}. Gates can be fine-tuned here; to change the bridges, edit the survey and build again.</span>`:'<span>This is a drawn (schematic) layout. For real positions, record the station in <b>Site survey</b>.</span>';n.hidden=!n.innerHTML;
  const D=ly.draft,ro=!CAN_EDIT||!DB;
  const gates=['P','A'].map(side=>{const list=D.gates.map((g,i)=>({g,i})).filter(o=>o.g.side===side).sort((a,b)=>a.g.x-b.g.x);
    return `<h3 class="lyh">${side==='P'?'Paharganj side gates and entries':'Ajmeri Gate side gates and entries'}</h3>${list.map(({g,i})=>`<div class="lyrow${ly.selGate===g.id?' sel':''}" data-g="${i}">
      ${g.kind==='entry'?`<div class="field lyn"><label for="lg-n-${i}">Entry name</label><input id="lg-n-${i}" data-gk="name" value="${esc(g.name)}" maxlength="40" ${ro?'disabled':''}></div>`:`<div class="field lyn"><label for="lg-n-${i}">Gate no.</label><input id="lg-n-${i}" data-gk="n" value="${esc(g.n)}" maxlength="40" ${ro?'disabled':''}></div>`}
      <div class="field"><label for="lg-s-${i}">Use</label><select id="lg-s-${i}" data-gk="status" ${ro?'disabled':''}>${LY_STATUS.map(([v,l])=>opt(v,l,g.status)).join('')}</select></div>
      <div class="field"><label for="lg-d-${i}">Side</label><select id="lg-d-${i}" data-gk="side" ${ro?'disabled':''}>${opt('P','Paharganj',g.side)}${opt('A','Ajmeri Gate',g.side)}</select></div>
      <div class="field lyx"><label for="lg-x-${i}">Position <small data-xv>${esc(lyPosText(g.x))}</small></label><input id="lg-x-${i}" type="range" min="50" max="950" step="5" data-gk="x" value="${g.x}" ${ro?'disabled':''}></div>
      <button class="btn sm" type="button" data-gdel="${i}" aria-label="Remove ${esc(gateLabel(g))}" ${ro?'disabled':''}>Remove</button></div>`).join('')||'<p class="empty">No gates on this side.</p>'}
      <div class="actions"><button class="btn sm" type="button" data-gadd="${side}" ${ro?'disabled':''}>Add gate on this side</button><button class="btn sm" type="button" data-eadd="${side}" ${ro?'disabled':''}>Add entry on this side</button></div>`;}).join('');
  const straight=D.fobs.filter(f=>f.shape==='straight');
  const fobs=D.fobs.map((f,i)=>{const zig=f.shape==='zigzag';
    if(f.shape==='path'){const pts=f.pts||[],downs=[...new Set(pts.flatMap(p=>(p.ways||[]).map(w=>/^pl/.test(w.to)?platLabel(+w.to.slice(2)):w.to==='gate'?gateText(w.gate):sideName(w.to)+' concourse')))];
      return `<fieldset class="lycard${ly.selFob===f.id?' sel':''}" data-f="${i}"><legend class="flabel">${esc(f.name||'Foot over bridge')}</legend>
      <div class="field"><label for="lf-n-${i}">Name</label><input id="lf-n-${i}" data-fk="name" value="${esc(f.name)}" maxlength="40" ${ro?'disabled':''}></div>
      <p class="msg" style="margin:8px 0">Recorded on site: ${pts.length} point${pts.length===1?'':'s'} along the bridge${downs.length?' · ways down to '+esc(downs.join(', ')):''}. To change its shape or stairs, edit the points in <b>Site survey</b> and build the model again.</p>
      <div class="actions"><button class="btn sm" type="button" data-fdel="${i}" ${ro?'disabled':''}>Remove this bridge</button></div></fieldset>`;}
    return `<fieldset class="lycard${ly.selFob===f.id?' sel':''}" data-f="${i}"><legend class="flabel">${esc(f.name||'Foot over bridge')}</legend>
      <div class="lygrid">
      <div class="field"><label for="lf-n-${i}">Name</label><input id="lf-n-${i}" data-fk="name" value="${esc(f.name)}" maxlength="40" ${ro?'disabled':''}></div>
      <div class="field"><label for="lf-s-${i}">Shape</label><select id="lf-s-${i}" data-fk="shape" ${ro?'disabled':''}>${opt('straight','Straight across the platforms',f.shape)}${opt('zigzag','With turns (zigzag)',f.shape)}</select></div>
      ${zig?`<div class="field"><label for="lf-f-${i}">Starts from</label><select id="lf-f-${i}" data-fk="from" ${ro?'disabled':''}>${opt('','Its own stairs (Paharganj side / Platform 1)',f.from)}${straight.filter(o=>o.id!==f.id).map(o=>opt(o.id,'Joins '+o.name,f.from)).join('')}</select></div>
        <div class="field lyx"><label for="lf-l-${i}">First stretch begins at <small data-xv>${esc(lyPosText(f.lobby))}</small></label><input id="lf-l-${i}" type="range" min="50" max="950" step="5" data-fk="lobby" value="${f.lobby}" ${ro?'disabled':''}></div>
        <div class="field lyx"><label for="lf-t-${i}">Each turn shifts it <small data-sv>${f.step<0?Math.round(-f.step*.6)+' m right':f.step>0?Math.round(f.step*.6)+' m left':'not at all'}</small></label><input id="lf-t-${i}" type="range" min="-80" max="80" step="5" data-fk="step" value="${f.step}" ${ro?'disabled':''}></div>`
      :`<div class="field lyx"><label for="lf-x-${i}">Position <small data-xv>${esc(lyPosText(f.x))}</small></label><input id="lf-x-${i}" type="range" min="50" max="950" step="2" data-fk="x" value="${f.x}" ${ro?'disabled':''}></div>
        <div class="field"><label for="lf-d-${i}">Stairs come down</label><select id="lf-d-${i}" data-fk="land" ${ro?'disabled':''}>${opt(-1,'On the left side (on the map)',f.land)}${opt(0,'Right under the bridge',f.land)}${opt(1,'On the right side (on the map)',f.land)}</select></div>`}
      <div class="field"><label for="lf-p-${i}">Paharganj side end</label><select id="lf-p-${i}" data-fk="endP" ${ro||(zig&&f.from)?'disabled':''}>${LY_ENDS.map(([v,l])=>opt(v,l,f.endP)).join('')}</select></div>
      <div class="field"><label for="lf-a-${i}">Ajmeri Gate side end</label><select id="lf-a-${i}" data-fk="endA" ${ro?'disabled':''}>${LY_ENDS.map(([v,l])=>opt(v,l,f.endA)).join('')}</select></div>
      </div>
      <div class="flabel" style="margin-top:10px">Way down to the platforms</div>
      <div class="lychips">${[['stairs','Stairs'],['lift','Lift'],['esc','Escalator']].map(([k,l])=>`<label class="lychip"><input type="checkbox" data-fk="${k}" ${f[k]?'checked':''} ${ro?'disabled':''}><span>${l}</span></label>`).join('')}</div>
      <div class="flabel" style="margin-top:10px">Platforms it serves</div>
      <div class="lychips">${ALLP.map(p=>`<label class="lychip"><input type="checkbox" data-fp="${p}" ${f.plats.includes(p)?'checked':''} ${ro?'disabled':''}><span>${p===0?'PF 1':p===8?'PF 16':'PF '+(2*p)+'/'+(2*p+1)}</span></label>`).join('')}</div>
      <div class="actions" style="margin-top:10px"><button class="btn sm" type="button" data-fdel="${i}" ${ro?'disabled':''}>Remove this bridge</button></div></fieldset>`;}).join('');
  $('lyEd').innerHTML=gates+`<h3 class="lyh">Foot over bridges</h3>${fobs||'<p class="empty">No foot over bridges.</p>'}
    <div class="actions"><button class="btn sm" type="button" id="lyAddFob" ${ro?'disabled':''}>Add foot over bridge</button></div>`;
  $('lyReset').disabled=ro;$('lyReset').parentNode.querySelector('.msg').textContent=ly.confirmReset?'Tap again to confirm. You still need to save afterwards.':'Puts back the starting layout. You still need to save.';
  lyRefresh();}
function lyRefresh(){const st=$('lyState');st.textContent=ly.dirty?'Unsaved changes':LY_SOURCE==='db'?'Saved':'Original layout';
  $('lySave').disabled=!ly.dirty||ly.busy||!DB||!CAN_EDIT;$('lyDiscard').disabled=!ly.dirty||ly.busy;
  const m=$('lyMsg');m.textContent=ly.msg||'';m.className='msg'+(ly.err?' err':ly.msg?' okm':'');
  drawMap($('lyMap'),{qrs:QRPTS,qrLabels:false,selFob:ly.selFob,selGate:ly.selGate});
  $('lyCheck').innerHTML=lyCheck();}
function lyCheck(){const r=dijkstra('cP_3',false),rs=dijkstra('cP_3',true),out=[];
  const reach=(res,p)=>(HNODES['pl'+p]||[]).some(id=>isFinite(res.dist[id]));
  const no=[],noSF=[];for(let p=0;p<9;p++){if(!reach(r,p))no.push(platLabel(p));else if(!reach(rs,p))noSF.push(platLabel(p));}
  out.push(no.length?['poor',`Can't be reached: ${no.join(', ')}. Add a bridge that serves ${no.length>1?'them':'it'}.`]:['good','Every platform can be reached from both sides.']);
  if(!no.length&&!isFinite(r.dist['cA_3']))out.push(['poor','The two sides of the station are not joined by any bridge.']);
  if(noSF.length)out.push(['fair',`Only by stairs: ${noSF.join(', ')}. Step-free passengers can't get there.`]);else if(!no.length)out.push(['good','Every platform has a step-free way (lift or escalator).']);
  ['P','A'].forEach(sd=>{const gs=LAYOUT.gates.filter(g=>g.side===sd);const ent=gs.filter(g=>g.status!=='closed'&&g.status!=='exit');
    if(!ent.length)out.push(['fair',`No entry gate on the ${sideName(sd)}.`]);});
  const dup={};LAYOUT.gates.filter(g=>g.kind!=='entry').forEach(g=>{dup[g.n]=(dup[g.n]||0)+1;});const d=Object.keys(dup).filter(k=>dup[k]>1);if(d.length)out.push(['fair',`Gate number used twice: ${d.join(', ')}.`]);
  return `<div class="rows">${out.map(([c,t])=>`<div class="row lyck"><span class="pill ${c}">${c==='good'?'OK':c==='fair'?'Check':'Problem'}</span><div class="n">${esc(t)}</div></div>`).join('')}</div>`;}
function lyChanged(rerender){ly.dirty=lySig(ly.draft)!==lySig(SAVED_LAYOUT);ly.msg='';ly.err=false;applyLayout(ly.draft);if(rerender)renderLayout();else lyRefresh();}
function lyField(t){const gEl=t.closest('[data-g]'),fEl=t.closest('[data-f]');
  if(gEl&&t.dataset.gk){const g=ly.draft.gates[+gEl.dataset.g];const k=t.dataset.gk;g[k]=k==='x'?+t.value:t.value;ly.selGate=g.id;ly.selFob=null;return k;}
  if(fEl){const f=ly.draft.fobs[+fEl.dataset.f];ly.selFob=f.id;ly.selGate=null;
    if(t.dataset.fp!=null){const p=+t.dataset.fp;f.plats=t.checked?[...new Set(f.plats.concat(p))].sort((a,b)=>a-b):f.plats.filter(x=>x!==p);return 'plats';}
    const k=t.dataset.fk;if(!k)return null;if(t.type==='checkbox')f[k]=t.checked;else if(['x','lobby','step','land'].includes(k))f[k]=+t.value;else f[k]=t.value;
    if(k==='shape'&&f.shape==='zigzag'&&!f.lobby){f.lobby=f.x||700;f.step=30;}if(k==='shape'&&f.shape!=='zigzag'&&!f.x)f.x=f.lobby||500;return k;}
  return null;}
$('lyEd').addEventListener('input',e=>{const t=e.target;if(t.tagName==='SELECT'||t.type==='checkbox')return;const k=lyField(t);if(!k)return;
  const sm=t.closest('.field')&&t.closest('.field').querySelector('[data-xv],[data-sv]');
  if(sm&&sm.dataset.xv!=null)sm.textContent=lyPosText(+t.value);else if(sm)sm.textContent=+t.value<0?Math.round(-t.value*.6)+' m right':+t.value>0?Math.round(t.value*.6)+' m left':'not at all';
  if(k==='name'){const lg=t.closest('fieldset').querySelector('legend');if(lg)lg.textContent=t.value||'Foot over bridge';}
  lyChanged(false);});
$('lyEd').addEventListener('change',e=>{const t=e.target;if(t.tagName!=='SELECT'&&t.type!=='checkbox')return;if(lyField(t))lyChanged(true);});
$('lyEd').addEventListener('focusin',e=>{const g=e.target.closest('[data-g]'),f=e.target.closest('[data-f]');const sg=g?ly.draft.gates[+g.dataset.g].id:null,sf=f?ly.draft.fobs[+f.dataset.f].id:null;
  if(sg!==ly.selGate||sf!==ly.selFob){ly.selGate=sg;ly.selFob=sf;document.querySelectorAll('#lyEd .sel').forEach(x=>x.classList.remove('sel'));if(g||f)(g||f).classList.add('sel');lyRefresh();}});
$('lyEd').addEventListener('click',e=>{const t=e.target.closest('button');if(!t||t.disabled)return;const D=ly.draft;
  if(t.dataset.eadd){const g={id:lyNewId('e'),kind:'entry',n:'',name:'Station entry',side:t.dataset.eadd,x:500,status:'open'};D.gates.push(g);ly.selGate=g.id;ly.selFob=null;lyChanged(true);}
  else if(t.dataset.gadd){const side=t.dataset.gadd,used=D.gates.map(g=>+g.n).filter(n=>!isNaN(n));const g={id:lyNewId('g'),n:String((used.length?Math.max(...used):0)+1),side,x:500,status:'open'};D.gates.push(g);ly.selGate=g.id;ly.selFob=null;lyChanged(true);}
  else if(t.dataset.gdel!=null){D.gates.splice(+t.dataset.gdel,1);ly.selGate=null;lyChanged(true);}
  else if(t.dataset.fdel!=null){const f=D.fobs[+t.dataset.fdel];D.fobs.splice(+t.dataset.fdel,1);D.fobs.forEach(o=>{if(o.from===f.id)o.from='';});ly.selFob=null;lyChanged(true);}
  else if(t.id==='lyAddFob'){const f={id:lyNewId('fob'),name:'Foot Over Bridge '+(D.fobs.length+1),shape:'straight',x:600,land:1,plats:ALLP.slice(),stairs:true,lift:false,esc:false,endP:'stairs',endA:'stairs',from:'',lobby:600,step:30};
    D.fobs.push(f);ly.selFob=f.id;ly.selGate=null;lyChanged(true);setTimeout(()=>{const c=document.querySelector('#lyEd .lycard.sel');if(c)c.scrollIntoView({behavior:'smooth',block:'nearest'});},50);}});
$('lyDiscard').addEventListener('click',()=>{ly.draft=lyClone(SAVED_LAYOUT);ly.confirmReset=false;lyChanged(true);ly.msg='Changes discarded.';lyRefresh();});
$('lyReset').addEventListener('click',()=>{if(!ly.confirmReset){ly.confirmReset=true;renderLayout();return;}ly.confirmReset=false;ly.draft=lyClone(normLayout(DEFAULT_LAYOUT));lyChanged(true);ly.msg='Original layout restored here. Tap Save layout to publish it.';lyRefresh();});
$('lySave').addEventListener('click',async()=>{if(!DB||!CAN_EDIT||!ly.dirty)return;ly.busy=true;ly.msg='Saving…';ly.err=false;lyRefresh();
  try{const uid=USER?await USER.id():null;const L=normLayout(ly.draft);await DB.doc('layout/main').set(Object.assign(L,{updatedAt:new Date().toISOString(),updatedBy:uid||''}));
    SAVED_LAYOUT=normLayout(L);ly.dirty=false;ly.busy=false;ly.msg='Layout saved. Passengers see it on their next refresh (within 30 seconds).';renderLayout();}
  catch(err){ly.busy=false;ly.err=true;ly.msg=(err&&err.code)==='invalid_argument'?'Your sign-in has expired. Sign in again at /staff.':`Couldn't save: ${(err&&err.message)||(err&&err.code)||'error'}. Try again.`;lyRefresh();}});
$('ly3d').addEventListener('click',()=>{ly.previewing=true;showView('passenger');if(MODE!=='3d')setMode('3d');setTimeout(()=>{if(W.ok)setCam('overview');},400);});
$('lyPrevBack').addEventListener('click',()=>showView('layout'));
window.addEventListener('beforeunload',e=>{if(ly.dirty){e.preventDefault();e.returnValue='';}});

// ================= SITE SURVEY (staff walk the station and record the real layout) =================
let SURVEY={}, SV_SOURCE='none';
const SV_TYPES=[['gate','Gate'],['entry','Station entry (not a gate)'],['pfend','End of a platform'],['pillar','Pillar on a platform'],['pfpt','Bend point on a platform line'],['fob','Foot over bridge point'],['fac','Amenity or facility (catering, water, toilet, ticket counter…)'],['out','Outside the station (parking, road, drop-off, taxi stand…)'],['work','Construction site / work area']];
const SV_QUICK=[['food','Catering stall'],['food','Jan Ahaar'],['food','Food Plaza / Refreshment room'],['water','Drinking water booth (RO)'],['toilet','Toilets'],['waiting','Waiting room'],['lounge','AC Lounge'],['ticket','UTS counter'],['ticket','Reservation (PRS) counter'],['ticket','ATVM'],['enquiry','Enquiry counter'],['cloak','Cloak room'],['retiring','Retiring room'],['medical','First aid / Medical'],['shop','Book stall'],['shop','Chemist'],['shop','Milk / fruit stall'],['help','Wheelchair point'],['help','Battery car point'],['help','Help desk / Sahayak']];
const SV_TO=[['pf','Stairs / lift / escalator down to a platform'],['P','Way down to the Paharganj side concourse'],['A','Way down to the Ajmeri Gate side concourse'],['gate','Leads straight to a gate or entry'],['','Turn or corner on the bridge (no way down)']];
const pfBar=n=>n<=1?0:n>=16?8:Math.floor(n/2);
// A bridge point can have several ways down (e.g. stairs to PF 1 and a way out to the concourse; stairs on both sides of an island platform)
function svWays(p){if(Array.isArray(p.ways))return p.ways;return p.to?[{to:p.to,pf:p.pf,gate:p.gate,side:'',stairs:!!p.stairs,lift:!!p.lift,esc:!!p.esc}]:[];}
const SV_WAY_TO=[['pf','A platform'],['P','Paharganj side concourse'],['A','Ajmeri Gate side concourse'],['gate','A gate or entry']];
const svWayAcc=w=>[w.stairs&&'stairs',w.lift&&'lift',w.esc&&'escalator'].filter(Boolean).join(' + ')||'stairs';
// survey bridges are stored by name ('sv:Foot Over Bridge 2'); turn that into the layout's bridge id
function svFobId(v){if(!v||!String(v).startsWith('sv:'))return v||'';const nm=String(v).slice(3);const f=FOBS.find(f=>f.name===nm);return f?f.id:'fs'+(nm.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,14)||'fob');}
function svPointName(id){const p=SURVEY[id];if(!p)return 'Deleted point';const n=(String(p.bridge||'').match(/\d+/)||[''])[0];return `B${n}-${p.seq||'?'}${p.bridge?' ('+fobShort({name:p.bridge})+')':''}`;}
function svLinkOptions(d){const br=svBridges(),skip=new Set([d.id,d.from,...(d.links||[])]);let h='<option value="">Add a connection…</option>';
  Object.entries(br).forEach(([name,arr])=>{const opts=arr.filter(p=>!skip.has(p.id));if(opts.length)h+=`<optgroup label="${esc(name)}">${opts.map(p=>`<option value="${esc(p.id)}">${esc(svPointName(p.id))} · ${esc(svWays(p).length?svWays(p).map(svWayText).join(', '):'turn')}</option>`).join('')}</optgroup>`;});return h;}
function svFromOptions(d){const br=svBridges(),mine=(br[String(d.bridge||'').trim()]||[]).filter(p=>p.id!==d.id);
  const prev=mine.filter(p=>(+p.seq||0)<(+d.seq||0)).pop();const lab=p=>`Point ${p.seq||'?'} · ${svWays(p).length?svWays(p).map(svWayText).join(', '):'turn'}`;
  let h=svOpt('',prev?`The previous point (${lab(prev)})`:'Nothing — this is the start of the bridge',d.from||'');
  if(mine.length)h+=`<optgroup label="${esc(String(d.bridge||'This bridge'))}">${mine.map(p=>svOpt(p.id,lab(p),d.from||'')).join('')}</optgroup>`;
  Object.entries(br).forEach(([name,arr])=>{if(name===String(d.bridge||'').trim())return;h+=`<optgroup label="${esc(name)}">${arr.map(p=>svOpt(p.id,lab(p),d.from||'')).join('')}</optgroup>`;});
  return h;}
function svWorkWhere(p){return p.area==='P'||p.area==='A'?sideName(p.area)+' concourse':p.area==='fob'?'foot over bridge':pfName(p.pf||1)+(p.pillar?' · pillar '+p.pillar:'');}
function svWayText(w){const where=w.to==='pf'?pfName(w.pf):w.to==='gate'?svGateName(w.gate):`the ${sideName(w.to)} concourse`;return `${svWayAcc(w)} to ${where}${w.side?` (${sideEnd(w.side)} side)`:''}`;}
// Platforms 2/3 … 14/15 are island platforms: one survey line each. pf stores 1, 2, 4 … 14, 16.
const barPf=b=>b===0?1:b===8?16:2*b;
const pfName=n=>platLabel(pfBar(+n));
const SV_ENDS=[['sdb','Sadar Bazar end'],['nzm','Nizamuddin end']];
const svEndName=e=>(SV_ENDS.find(x=>x[0]===e)||[0,'end not set'])[1];
const svEndsDone=()=>{const m={};Object.values(SURVEY).forEach(p=>{if(p.t==='pfend'&&(p.end==='sdb'||p.end==='nzm'))m[pfBar(+p.pf)+'|'+p.end]=1;});return m;};
function svNextEnd(){const done=svEndsDone(),b0=pfBar(sv.lastPf||1);for(let i=0;i<18;i++){const b=(b0+Math.floor(i/2))%9,e=i%2?'nzm':'sdb';if(!done[b+'|'+e])return {pf:barPf(b),end:e};}return {pf:barPf(b0),end:'sdb'};}
const sv={L:null,map:null,tiles:{},layer:'sat',group:null,draftM:null,meM:null,meC:null,watch:null,me:null,stopCap:null,draft:null,tapAdd:false,msg:'',err:false,busy:false,confirmDel:false,loading:null,fitted:false};
try{if(localStorage.getItem('wf-sv-layer')==='map')sv.layer='map';}catch(e){}
const svPts=()=>Object.entries(SURVEY).map(([id,p])=>Object.assign({id},p)).filter(p=>hasLL(p));
const svFacs=()=>FAC.filter(a=>a.src==='survey'&&hasLL(a));
const svBridges=()=>{const m={};svPts().filter(p=>p.t==='fob').forEach(p=>{const k=String(p.bridge||'').trim()||'Foot Over Bridge';(m[k]=m[k]||[]).push(p);});
  Object.values(m).forEach(a=>a.sort((x,y)=>(+x.seq||0)-(+y.seq||0)||String(x.at||'').localeCompare(String(y.at||''))));return m;};
const svCanWrite=()=>!!DB&&CAN_EDIT;

// ---- turn the recorded points into a station layout ----
function surveyBuild(){const pts=svPts().filter(p=>p.t!=='out'),probs=[],warns=[];
  if(pts.length<3)return {probs:['Record the platform ends, gates and bridges first.'],warns,layout:null};
  const o=[pts.reduce((s,p)=>s+p.lat,0)/pts.length,pts.reduce((s,p)=>s+p.lng,0)/pts.length],[oe,on]=geoEN(o[0],o[1]);
  const EN=p=>{const [e,n]=geoEN(p.lat,p.lng);return [e-oe,n-on];};
  // 1. direction of the platforms, from platform ends recorded on the same platform
  const byPf={};pts.filter(p=>p.t==='pfend'||p.t==='pillar').forEach(p=>(byPf[pfBar(+p.pf)]=byPf[pfBar(+p.pf)]||[]).push(EN(p)));
  let ax=0,ay=0;Object.values(byPf).forEach(arr=>{let a=null,b=null,d=0;for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){const k=Math.hypot(arr[i][0]-arr[j][0],arr[i][1]-arr[j][1]);if(k>d){d=k;a=arr[i];b=arr[j];}}
    if(d<30)return;let dx=(b[0]-a[0])/d,dy=(b[1]-a[1])/d;if(ax*dx+ay*dy<0){dx=-dx;dy=-dy;}ax+=dx*d;ay+=dy*d;});
  const al=Math.hypot(ax,ay);if(!al){probs.push('Record both ends of at least one platform (stand at each end; they must be 30 m or more apart).');return {probs,warns,layout:null};}
  ax/=al;ay/=al;const UV=p=>{const [e,n]=EN(p);return [e*ax+n*ay,-e*ay+n*ax];};
  // 2. where each platform line is across the station
  const vs={};pts.forEach(p=>{let pf=null;if(p.t==='pfend'||p.t==='pillar')pf=+p.pf;else if(p.t==='fob'&&p.to==='pf')pf=+p.pf;if(!pf)return;const b=pfBar(pf);(vs[b]=vs[b]||[]).push(UV(p)[1]);});
  const known=Object.keys(vs).map(Number).sort((a,b)=>a-b);
  if(known.length<2){probs.push('Record points on at least two different platforms that are far apart (Platform 1 and Platform 16 are best).');return {probs,warns,layout:null};}
  const vb={};known.forEach(b=>vb[b]=vs[b].reduce((s,v)=>s+v,0)/vs[b].length);
  const mx=known.reduce((s,b)=>s+b,0)/known.length,my=known.reduce((s,b)=>s+vb[b],0)/known.length;
  let sxy=0,sxx=0;known.forEach(b=>{sxy+=(b-mx)*(vb[b]-my);sxx+=(b-mx)*(b-mx);});const beta=sxy/sxx,alpha=my-beta*mx,fit=b=>alpha+beta*b;
  const vAt=b=>vb[b]!=null?vb[b]:fit(b),v0=vAt(0),v8=vAt(8);
  if(Math.abs(v8-v0)<40){probs.push('The platforms recorded so far are too close together to work out the station width. Record a point on Platform 1 and on Platform 16.');return {probs,warns,layout:null};}
  const ky=520/(v8-v0),PYS=ALLP.map(b=>120+ky*(vAt(b)-v0));
  for(let b=1;b<9;b++)if(PYS[b]<PYS[b-1]+12){warns.push(`${platLabel(b)} comes out in the wrong order across the station. Check the platform numbers of its points.`);PYS[b]=PYS[b-1]+12;}
  if(PYS[8]>660)for(let b=0;b<9;b++)PYS[b]=120+(PYS[b]-120)*520/(PYS[8]-120);
  if(!known.includes(0)||!known.includes(8))warns.push('Platform 1 or Platform 16 has no recorded point, so its position is estimated.');
  // 3. along the platforms; the direction is picked so the drawing is never a mirror image of the real station
  const us=pts.map(p=>UV(p)[0]),umin=Math.min(...us),umax=Math.max(...us);
  if(umax-umin<60){probs.push('The points cover less than 60 m along the platforms. Record both ends of a long platform.');return {probs,warns,layout:null};}
  const kx=(ky>0?-1:1)*900/(umax-umin),cx=kx>0?50-kx*umin:50-kx*umax;
  const X=p=>cx+kx*UV(p)[0],Y=p=>120+ky*(UV(p)[1]-v0);
  // 4. gates
  const gates=pts.filter(p=>p.t==='gate'||p.t==='entry').map(p=>p.t==='entry'?{id:'se-'+p.id,kind:'entry',n:'',name:String(p.name||'Station entry'),side:p.side==='A'?'A':'P',x:X(p),status:p.status||'open'}:{id:'sg-'+p.id,kind:'gate',n:String(p.n||'?'),name:'',side:p.side==='A'?'A':'P',x:X(p),status:p.status||'open'});
  // platform ends: every platform should have both; the 'Gate 1 end' of each platform should point the same way
  let ends=null;
  {const done=svEndsDone(),miss=[];for(let b=0;b<9;b++){const a=done[b+'|sdb'],c=done[b+'|nzm'];if(!a||!c)miss.push(`${platLabel(b).replace('Platform ','')}${a?' ('+svEndName('nzm')+')':c?' ('+svEndName('sdb')+')':''}`);}
    if(miss.length)warns.push(`Platform ends still to record: ${miss.join(', ')}.`);
    const dirs={};pts.filter(p=>p.t==='pfend'&&(p.end==='sdb'||p.end==='nzm')).forEach(p=>{const b=pfBar(+p.pf);(dirs[b]=dirs[b]||{})[p.end]=X(p);});
    const sg=Object.entries(dirs).filter(([k,v])=>v.sdb!=null&&v.nzm!=null).map(([k,v])=>[+k,Math.sign(v.nzm-v.sdb)]);
    if(sg.length){const maj=Math.sign(sg.reduce((s,x)=>s+x[1],0))||sg[0][1];ends=maj>0?{L:'Sadar Bazar',R:'Nizamuddin'}:{L:'Nizamuddin',R:'Sadar Bazar'};
      const bad=sg.filter(x=>x[1]!==maj).map(x=>platLabel(x[0]));if(bad.length)warns.push(`The two ends of ${bad.join(', ')} look swapped compared with the other platforms. Check which end is which.`);}
    else{const one=pts.filter(p=>p.t==='pfend'&&(p.end==='sdb'||p.end==='nzm'));if(one.length){const p=one[0],left=X(p)<500;ends=(p.end==='sdb')===left?{L:'Sadar Bazar',R:'Nizamuddin'}:{L:'Nizamuddin',R:'Sadar Bazar'};}}}
  const pillars=pts.filter(p=>p.t==='pillar'&&String(p.pillar||'').trim()).map(p=>({bar:pfBar(+p.pf),x:X(p),n:String(p.pillar).trim()}));
  const works=pts.filter(p=>p.t==='work').map(p=>{let x=X(p),y=Y(p),area=p.area;
    if(area==='pl'||!area){const bar=pfBar(+p.pf||1);area='pl'+bar;y=PYS[bar];const pl=p.pillar&&pillars.find(q=>q.bar===bar&&q.n===String(p.pillar).trim());if(pl)x=pl.x;}
    else if(area==='P')y=CPY;else if(area==='A')y=CAY;
    return {id:p.id,name:p.name||'Construction work',area,x:Math.max(30,Math.min(970,x)),y,r:Math.abs((+p.r||20)),block:!!p.block,until:p.until||'',show:p.show!==false,pillar:p.pillar||'',color:/^#[0-9a-f]{6}$/i.test(p.color||'')?p.color:''};});
  if(!gates.some(g=>g.side==='P'))warns.push('No gate recorded on the Paharganj side yet.');
  if(!gates.some(g=>g.side==='A'))warns.push('No gate recorded on the Ajmeri Gate side yet.');
  pts.filter(p=>p.t==='gate'||p.t==='entry').forEach(p=>{const y=Y(p),nm=p.t==='entry'?(p.name||'An entry'):'Gate '+p.n;if(p.side!=='A'&&y>PYS[4])warns.push(`${nm} is marked Paharganj side but was recorded on the Ajmeri Gate side of the platforms.`);if(p.side==='A'&&y<PYS[4])warns.push(`${nm} is marked Ajmeri Gate side but was recorded on the Paharganj side of the platforms.`);});
  // 5. foot over bridges
  const used={};const fobs=[];
  Object.entries(svBridges()).forEach(([name,arr])=>{let id='fs'+(name.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,14)||'fob');while(used[id])id+='x';used[id]=1;
    if(arr.length<2){probs.push(`${name} has only one point. Record at least both ends of the bridge.`);return;}
    const idx={};arr.forEach((p,i)=>idx[p.id]=i);
    const ps=arr.map((p,i)=>({xlinks:(Array.isArray(p.links)?p.links:[]).filter(t=>t!==p.id&&SURVEY[t]&&SURVEY[t].t==='fob'),par:p.from&&idx[p.from]!=null&&idx[p.from]!==i?idx[p.from]:null,link:p.from&&idx[p.from]==null&&SURVEY[p.from]?p.from:'',x:X(p),y:Math.max(CPY,Math.min(CAY,Y(p))),ways:svWays(p).map(w=>({to:w.to==='pf'?'pl'+pfBar(+w.pf):w.to,gate:String(w.gate||''),side:w.side||'',stairs:!!w.stairs,lift:!!w.lift,esc:!!w.esc})),sid:p.id}));
    ps.forEach((q,i)=>q.ways.forEach(q=>{if(q.to==='gate'&&!gates.some(g=>(g.kind==='entry'?g.name:g.n)===q.gate))warns.push(`${name}, point ${i+1}: ${svGateName(q.gate)} isn't recorded yet.`);}));
    if(!ps.some(q=>q.ways.length))probs.push(`${name} has no way down recorded. Mark the points where its stairs, lifts or escalators are.`);
    fobs.push({id,name,shape:'path',pts:ps});});
  if(!fobs.length)probs.push('Record at least one foot over bridge.');
  const far=pts.filter(p=>p.acc!=null&&p.acc>20&&p.placed!=='map').length;if(far)warns.push(`${far} point${far===1?' has':'s have'} weak GPS (worse than ±20 m) and ${far===1?'was':'were'} not adjusted on the map. Drag ${far===1?'it':'them'} to the exact spot.`);
  const layout={v:1,gates,fobs,pillars,works,src:'survey',geo:{o,a:[ax,ay],kx,ky,cx,v0,PYS,ends,at:new Date().toISOString(),n:pts.length}};if(!ends)delete layout.geo.ends;
  return {probs,warns,layout};}

// ---- map ----
function svLoad(){if(sv.L)return Promise.resolve(sv.L);if(!sv.loading)sv.loading=import('leaflet').then(m=>{sv.L=m.default||m;return sv.L;}).catch(()=>null);return sv.loading;}
async function svInitMap(){const L=await svLoad();if(!L){$('svMapMsg').hidden=false;$('svMapMsg').textContent="The map couldn't load. Check the connection and open this tab again.";return;}
  if(sv.map){sv.map.invalidateSize();return;}
  const map=sv.map=L.map('svMap',{zoomControl:true,attributionControl:true,maxZoom:21}).setView([NDLS_C.lat,NDLS_C.lng],17);
  sv.tiles.sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxNativeZoom:19,maxZoom:21,attribution:'Imagery &copy; Esri, Maxar, Earthstar Geographics'});
  sv.tiles.map=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxNativeZoom:19,maxZoom:21,attribution:'&copy; OpenStreetMap contributors'});
  sv.tiles[sv.layer].addTo(map);sv.group=L.layerGroup().addTo(map);
  map.on('click',e=>{if(!svCanWrite())return;if(sv.pfEdit)return;if(sv.draft){if(svIsShape(sv.draft)){svAddCorner(e.latlng.lat,e.latlng.lng);return;}svMoveDraft(e.latlng.lat,e.latlng.lng,'map');return;}if(sv.tapAdd){sv.tapAdd=false;svNewDraft({lat:e.latlng.lat,lng:e.latlng.lng,acc:null,placed:'map'});}});
  svDrawMap();setTimeout(()=>map.invalidateSize(),60);}
function svSetLayer(k){if(!sv.map||sv.layer===k)return;sv.map.removeLayer(sv.tiles[sv.layer]);sv.layer=k;sv.tiles[k].addTo(sv.map);try{localStorage.setItem('wf-sv-layer',k);}catch(e){}
  document.querySelectorAll('[data-svl]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.svl===k));}
function svIcon(cls,txt){return sv.L.divIcon({className:'svpin '+cls,html:`<b>${esc(txt)}</b>`,iconSize:null});}
function svLabel(p){if(p.t==='pfpt')return 'PF'+platLabel(pfBar(+p.pf)).replace('Platform ','')+' ⌇';if(p.t==='out'){const k=RMAP.OUT[p.kind]||RMAP.OUT.other;return (k.code?k.code+' ':'')+String(p.name||k.label).slice(0,16);}if(p.t==='work')return '⚠ '+String(p.name||'Work').slice(0,12);if(p.t==='gate')return /^[\w-]{1,5}$/.test(String(p.n||''))?'G'+p.n:String(p.n||'Gate').slice(0,14);if(p.t==='entry')return String(p.name||'Entry').slice(0,14);if(p.t==='pfend')return 'PF'+platLabel(pfBar(+p.pf)).replace('Platform ','')+(p.end==='sdb'?' SB':p.end==='nzm'?' NZM':'');if(p.t==='pillar')return 'P'+(p.pillar||'?');if(p.t==='fob'){const n=(String(p.bridge||'').match(/\d+/)||[''])[0];return 'B'+n+'·'+(p.seq||'');}return '?';}
// ---- colour of a marked area (outside areas and construction sites) ----
const AREA_COLORS=[['#2F6FDE','Blue'],['#1E8E5A','Green'],['#0E6E6E','Teal'],['#D9A400','Yellow'],['#E08A12','Orange'],['#C2410C','Dark orange'],['#B4232A','Red'],['#7B3FB8','Purple'],['#8C6E4F','Brown'],['#59616B','Grey']];
const okHex=c=>/^#[0-9a-f]{6}$/i.test(c||'');
function svDefColor(d){return d.t==='work'?'#C2410C':(RMAP.OUT[d.kind]||RMAP.OUT.other).color;}
function svColorField(d){const cur=okHex(d.color)?d.color.toLowerCase():'',def=svDefColor(d);
  return `<div class="field"><span class="flabel">Colour on the maps</span><div class="svcols" role="group" aria-label="Colour">
    <button type="button" class="svcol def${cur?'':' on'}" data-col="" title="Default for this type" style="--c:${def}"><i></i>Default</button>
    ${AREA_COLORS.map(([c,n])=>`<button type="button" class="svcol${cur===c.toLowerCase()?' on':''}" data-col="${c}" title="${n}" aria-label="${n}" style="--c:${c}"><i></i></button>`).join('')}
    <label class="svcol pick${cur&&!AREA_COLORS.some(([c])=>c.toLowerCase()===cur)?' on':''}" title="Any colour"><input type="color" id="sv-col" value="${cur||def}"><span>Other…</span></label></div>
    <small>Used for this ${d.t==='work'?'construction area':'area'} on the survey map, the Real map, the Live map and in 3D.</small></div>`;}
// ---- outside the station: shapes drawn by adding corners ----
const svShape=d=>d.shape||(RMAP.OUT[d.kind]||RMAP.OUT.other).shape;
const svIsShape=d=>d&&d.t==='out'&&svShape(d)!=='point';
function svAddCorner(lat,lng){const d=sv.draft;if(!d)return;d.pts=(d.pts||[]).concat([[+lat.toFixed(7),+lng.toFixed(7)]]);if(d.pts.length===1){d.lat=lat;d.lng=lng;}renderSvEd();svDrawMap();}
function svCornerGps(){const d=sv.draft;if(!d)return;const me=sv.me&&sv.watch!=null&&Date.now()-sv.me.t<8000?sv.me:null;
  if(me){svAddCorner(me.lat,me.lng);return;}d.cornerReading=true;renderSvEd();
  sv.stopCap=captureGps(()=>{},(why,best)=>{if(sv.draft!==d)return;d.cornerReading=false;sv.stopCap=null;if(best)svAddCorner(best.lat,best.lng);else{sv.err=true;sv.msg="Couldn't read GPS. Tap the map at the corner instead.";renderSvEd();}});}
function svOutDraw(L,g,p,editing){const k0=RMAP.OUT[p.kind]||RMAP.OUT.other,fixed=p.kind==='station'||p.kind==='stationbldg',k=Object.assign({},k0,{color:okHex(p.color)&&!fixed?p.color:k0.color}),sh=svShape(p),pts=(p.pts||[]).filter(q=>Array.isArray(q));
  let st={color:k.color,weight:editing?3:2,fillColor:k.color,fillOpacity:editing?.3:.2,dashArray:editing?'6 5':null};
  if(p.kind==='station')st={color:'#111111',weight:editing?4:3,fillColor:'#FFFFFF',fillOpacity:editing?.25:.15,dashArray:editing?'8 6':null};
  if(p.kind==='stationbldg'){st={color:'#FFFFFF',weight:editing?5:4,fillColor:'#FFFFFF',fillOpacity:editing?.45:.35,dashArray:editing?'8 6':null};if(pts.length>=3)L.polygon(pts,{color:'#5F6368',weight:(editing?5:4)+3,fill:false,interactive:false}).addTo(g);}
  let lay=null;if(sh==='area'&&pts.length>=3)lay=L.polygon(pts,st);else if(sh==='line'&&pts.length>=2)lay=L.polyline(pts,{color:k.color,weight:editing?7:6,opacity:.9,dashArray:editing?'8 6':null});else if(pts.length>=2)lay=L.polyline(pts,{color:k.color,weight:3,dashArray:'4 6'});
  if(lay){lay.addTo(g);if(!editing)lay.on('click',()=>svEdit(p.id));}
  if(editing&&!svCanWrite())pts.forEach((q,i)=>L.marker(q,{icon:svIcon('svpin-corner',String(i+1)),interactive:false}).addTo(g));
  if(editing&&svCanWrite())svShapeHandles(L,g,p,lay,sh);}
// Adjusting a shape on the map: drag a corner, tap + between two corners to add one, tap a corner to select it (then delete it),
// drag ✥ to move the whole shape.
function svShapeHandles(L,g,d,lay,sh){const pts=d.pts=(d.pts||[]).filter(q=>Array.isArray(q));const closed=sh==='area';
  const live=()=>{if(lay)lay.setLatLngs(pts.map(q=>[q[0],q[1]]));};
  pts.forEach((q,i)=>{const m=L.marker(q,{icon:svIcon('svpin-corner'+(sv.selCorner===i?' sel':''),String(i+1)),draggable:true,zIndexOffset:900,title:'Drag to move this corner · tap to select it'}).addTo(g);
    m.on('drag',()=>{const ll=m.getLatLng();pts[i]=[+ll.lat.toFixed(7),+ll.lng.toFixed(7)];live();});
    m.on('dragend',()=>{if(i===0){d.lat=pts[0][0];d.lng=pts[0][1];}d.placed='map';sv.selCorner=i;renderSvEd();svDrawMap();});
    m.on('click',()=>{sv.selCorner=sv.selCorner===i?null:i;renderSvEd();svDrawMap();});});
  const n=pts.length,segs=closed&&n>=3?n:n-1;
  for(let i=0;i<segs;i++){const a=pts[i],b=pts[(i+1)%n],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const m=L.marker(mid,{icon:svIcon('svpin-mid','+'),draggable:true,zIndexOffset:800,title:'Tap or drag to add a corner here'}).addTo(g);
    const ins=ll=>{pts.splice(i+1,0,[+ll.lat.toFixed(7),+ll.lng.toFixed(7)]);sv.selCorner=i+1;d.placed='map';renderSvEd();svDrawMap();};
    m.on('click',()=>ins(m.getLatLng()));m.on('dragend',()=>ins(m.getLatLng()));}
  if(n>=2){const c=[pts.reduce((s,q)=>s+q[0],0)/n,pts.reduce((s,q)=>s+q[1],0)/n];let start=null,orig=null;
    const mv=L.marker(c,{icon:svIcon('svpin-move','✥'),draggable:true,zIndexOffset:950,title:'Drag to move the whole shape'}).addTo(g);
    mv.on('dragstart',()=>{start=mv.getLatLng();orig=pts.map(q=>q.slice());});
    mv.on('drag',()=>{const ll=mv.getLatLng(),dl=ll.lat-start.lat,dn=ll.lng-start.lng;orig.forEach((q,i)=>{pts[i]=[+(q[0]+dl).toFixed(7),+(q[1]+dn).toFixed(7)];});live();});
    mv.on('dragend',()=>{d.lat=pts[0][0];d.lng=pts[0][1];d.placed='map';renderSvEd();svDrawMap();});}}
// Construction site: the area is a circle; drag the orange pin to move it and the white handle on its edge to resize it.
function svWorkHandles(L,g,d){const c=[d.lat,d.lng],r=Math.max(5,+d.r||20),col=okHex(d.color)?d.color:'#C2410C';
  const circ=L.circle(c,{radius:r,color:col,weight:2,dashArray:'6 5',fillColor:okHex(d.color)?d.color:'#F97316',fillOpacity:d.block?.3:.15,interactive:false}).addTo(g);
  if(!svCanWrite())return;const edge=()=>{const k=111320*Math.cos(d.lat*Math.PI/180);return [d.lat,d.lng+(+d.r||20)/k];};
  const h=L.marker(edge(),{icon:svIcon('svpin-size','↔'),draggable:true,zIndexOffset:900,title:'Drag to make the area bigger or smaller'}).addTo(g);
  h.on('drag',()=>{const ll=h.getLatLng(),m=sv.map.distance([d.lat,d.lng],ll);circ.setRadius(Math.max(5,m));const el=$('sv-r');if(el)el.value=Math.round(Math.max(5,m));});
  h.on('dragend',()=>{const ll=h.getLatLng();d.r=Math.min(500,Math.max(5,Math.round(sv.map.distance([d.lat,d.lng],ll))));renderSvEd();svDrawMap();});}
function svDrawMap(){if(!sv.map)return;const L=sv.L,g=sv.group;g.clearLayers();const pts=svPts();
  pts.filter(p=>p.t==='out'&&!(sv.draft&&sv.draft.id===p.id)).forEach(p=>svOutDraw(L,g,p,false));
  pts.filter(p=>p.t==='work'&&!(sv.draft&&sv.draft.id===p.id)).forEach(p=>L.circle([p.lat,p.lng],{radius:Math.max(5,+p.r||20),color:okHex(p.color)?p.color:'#C2410C',weight:1.5,dashArray:'4 5',fillColor:okHex(p.color)?p.color:'#F97316',fillOpacity:p.block?.22:.1,interactive:false}).addTo(g));
  if(sv.draft&&sv.draft.t==='work'){if(sv.zoomNext){sv.zoomNext=false;svZoomTo(sv.draft);}svWorkHandles(L,g,sv.draft);}
  if(sv.draft&&sv.draft.t==='out')svOutDraw(L,g,sv.draft,true);
  if(sv.pfEdit){pfEditDraw(L,g);}
  ALLP.forEach(b=>{if(sv.pfEdit&&sv.pfEdit.bar===b)return;const a=pfLinePts(b);if(a.length>1)L.polyline(a.map(p=>[p.lat,p.lng]),{color:'#F3C531',weight:6,opacity:.8,interactive:false}).addTo(g);});
  Object.values(svBridges()).forEach(a=>a.forEach(p=>(Array.isArray(p.links)?p.links:[]).forEach(t=>{const q=SURVEY[t];if(q&&typeof q.lat==='number')L.polyline([[q.lat,q.lng],[p.lat,p.lng]],{color:'#1D59C4',weight:5,opacity:.85,dashArray:'2 6',interactive:false}).addTo(g);})));
  Object.values(svBridges()).forEach(a=>a.forEach((p,i)=>{const par=p.from&&SURVEY[p.from]?SURVEY[p.from]:i>0?a[i-1]:null;if(par&&typeof par.lat==='number')L.polyline([[par.lat,par.lng],[p.lat,p.lng]],{color:'#1D59C4',weight:5,opacity:.85,dashArray:'8 6',interactive:false}).addTo(g);}));
  pts.forEach(p=>{if(sv.draft&&sv.draft.id===p.id)return;if(sv.pfEdit&&(p.t==='pfend'||p.t==='pfpt')&&pfBar(+p.pf)===sv.pfEdit.bar)return;const m=L.marker([p.lat,p.lng],{icon:svIcon('svpin-'+p.t,svLabel(p)),keyboard:true,title:svTitle(p)}).addTo(g);m.on('click',()=>svEdit(p.id));});
  svFacs().forEach(a=>{if(sv.draft&&sv.draft.fac===a.id)return;const m=L.marker([a.lat,a.lng],{icon:svIcon('svpin-fac',CAT[a.cat]?CAT[a.cat].code||'•':'•'),title:a.name}).addTo(g);m.on('click',()=>svEditFac(a.id));});
  if(sv.draft&&svIsShape(sv.draft)){if(sv.draftM&&sv.map.hasLayer(sv.draftM))sv.map.removeLayer(sv.draftM);}
  else if(sv.draft){const d=sv.draft;if(!sv.draftM){sv.draftM=L.marker([d.lat,d.lng],{icon:svIcon('svpin-draft','+'),draggable:true,zIndexOffset:1000,title:'Drag to the exact spot'});
      sv.draftM.on('dragend',()=>{const ll=sv.draftM.getLatLng();svMoveDraft(ll.lat,ll.lng,'map');});}
    sv.draftM.setLatLng([d.lat,d.lng]);if(!sv.map.hasLayer(sv.draftM))sv.draftM.addTo(sv.map);}
  else if(sv.draftM&&sv.map.hasLayer(sv.draftM))sv.map.removeLayer(sv.draftM);
  if(!sv.fitted&&pts.length>1){sv.fitted=true;const so=stationOutlines()[0];sv.map.fitBounds(L.latLngBounds(so&&so.length>=3?so:pts.map(p=>[p.lat,p.lng])).pad(.03),{maxZoom:19.5});}}
function svTitle(p){if(p.t==='pfpt')return `${pfName(p.pf)} · bend point on the platform line`;if(p.t==='out'){const k=RMAP.OUT[p.kind]||RMAP.OUT.other,sh=svShape(p),n=(p.pts||[]).length;return `${p.name||k.label} · ${k.label}${sh==='area'?` · area, ${n} corners`:sh==='line'?` · line, ${n} points`:''}`;}if(p.t==='work')return `⚠ ${p.name||'Construction work'} · ${svWorkWhere(p)} · ${p.block?'closed to passengers':'passage open'}${p.until?' · until '+p.until:''}${p.show===false?' · hidden from passengers':''}`;if(p.t==='pillar')return `${pfName(p.pf)} · pillar ${p.pillar||'?'}`;if(p.t==='gate')return `${gateText(p.n)} · ${sideName(p.side==='A'?'A':'P')}`;if(p.t==='entry')return `${p.name||'Station entry'} · ${sideName(p.side==='A'?'A':'P')}`;if(p.t==='pfend')return `${pfName(p.pf)} · ${svEndName(p.end)}`;
  if(p.t==='fob'){const ws=svWays(p),fr=(p.from&&SURVEY[p.from]?` · joins point ${SURVEY[p.from].seq||'?'}${SURVEY[p.from].bridge!==p.bridge?' of '+SURVEY[p.from].bridge:''}`:'')+((p.links||[]).length?` · also connected to ${(p.links||[]).map(svPointName).join(', ')}`:''),to=(ws.length?ws.map(svWayText).join(' · '):'turn on the bridge')+fr;return `${p.bridge||'Bridge'} · point ${p.seq||'?'} · ${to}`;}return '';}

// ---- my location ----
function svLocate(on){if(on===undefined)on=sv.watch==null;
  if(!on){if(sv.watch!=null&&navigator.geolocation)navigator.geolocation.clearWatch(sv.watch);sv.watch=null;if(sv.meM&&sv.map){sv.map.removeLayer(sv.meM);sv.map.removeLayer(sv.meC);}sv.meM=sv.meC=null;svGpsLine();return;}
  if(!navigator.geolocation){sv.gpsMsg="This browser can't share your location.";svGpsLine();return;}
  let first=true;sv.gpsMsg='Finding you…';svGpsLine();
  sv.watch=navigator.geolocation.watchPosition(pos=>{const c=pos.coords;sv.me={lat:c.latitude,lng:c.longitude,acc:c.accuracy,t:Date.now()};sv.gpsMsg='';
      if(sv.map&&sv.L){const ll=[c.latitude,c.longitude];if(!sv.meM){sv.meC=sv.L.circle(ll,{radius:c.accuracy,color:'#2b7bff',weight:1,fillOpacity:.12,interactive:false}).addTo(sv.map);sv.meM=sv.L.circleMarker(ll,{radius:7,color:'#fff',weight:2,fillColor:'#2b7bff',fillOpacity:1,interactive:false}).addTo(sv.map);}
        else{sv.meM.setLatLng(ll);sv.meC.setLatLng(ll);sv.meC.setRadius(c.accuracy);}if(first){first=false;sv.map.setView(ll,Math.max(sv.map.getZoom(),18));}}
      svGpsLine();},err=>{sv.gpsMsg=err.code===1?'Location access is blocked for this site. Allow it in the browser settings.':"Couldn't get a GPS fix. Move into the open and try again.";svGpsLine();},{enableHighAccuracy:true,maximumAge:2000,timeout:25000});
  svGpsLine();}
function svGpsLine(){const el=$('svGps');if(!el)return;const b=$('svLocate');if(b){b.textContent=sv.watch!=null?'Hide my location':'Show my location';b.setAttribute('aria-pressed',sv.watch!=null);}
  el.innerHTML=sv.gpsMsg?esc(sv.gpsMsg):sv.me&&sv.watch!=null?`You: ${fmtLL(sv.me.lat,sv.me.lng)} <span class="pill ${accClass(sv.me.acc)}">${accText(sv.me.acc)}</span>`:'';}

// ---- drafts ----
function svGateName(k){const e=Object.values(SURVEY).find(p=>p.t==='entry'&&p.name===k);return e?k:gateText(k);}
function svNextSeq(bridge){const a=svBridges()[bridge]||[];return a.reduce((m,p)=>Math.max(m,+p.seq||0),0)+1;}
function svDefaultBridge(){const names=Object.keys(svBridges());return sv.lastBridge&&names.includes(sv.lastBridge)?sv.lastBridge:names[0]||'';}
function svNewDraft(pos){svStopCap();sv.pfEdit=null;const last=sv.lastType||'gate',br=svDefaultBridge()||'Foot Over Bridge 1';
  const ne=svNextEnd();
  sv.draft={id:null,fac:null,t:last,lat:pos.lat,lng:pos.lng,acc:pos.acc,placed:pos.placed||'gps',n:'',side:'P',status:'open',pf:last==='pfend'?ne.pf:sv.lastPf||1,end:ne.end,pillar:'',facPf:'',ways:[{to:'pf',pf:sv.lastPf||1,gate:'',side:'',stairs:true,lift:false,esc:false}],area:'pl',block:false,r:20,until:'',show:true,
    bridge:br,newBridge:!svDefaultBridge(),seq:svNextSeq(br),to:'pf',gate:'',stairs:true,lift:false,esc:false,cat:'ticket',name:'',note:'',kind:'parking',shape:'area',pts:[]};sv.cornerTap=false;sv.selCorner=null;
  if(last==='out')sv.draft.pts=[[pos.lat,pos.lng]];
  sv.msg='';sv.err=false;sv.confirmDel=false;renderSvEd();svDrawMap();if(sv.map)sv.map.panTo([pos.lat,pos.lng]);svScrollEd();}
function svEdit(id){const p=SURVEY[id];if(!p)return;svStopCap();
  sv.draft=Object.assign({fac:null,from:'',links:[],area:'pl',block:false,r:20,until:'',show:true,n:'',side:'P',status:'open',pf:1,end:'',pillar:'',facPf:'',ways:svWays(p).map(w=>Object.assign({gate:'',side:''},w)),bridge:'',newBridge:false,seq:1,to:'',gate:'',stairs:false,lift:false,esc:false,cat:'ticket',name:'',note:'',kind:'other',shape:'',pts:[]},JSON.parse(JSON.stringify(p)),{id});sv.cornerTap=false;sv.selCorner=null;
  sv.msg='';sv.err=false;sv.confirmDel=false;renderSvEd();svDrawMap();if(sv.map)svZoomTo(p);svScrollEd();}
// editing a shape or a work area: zoom so its corners and handles are easy to grab
function svZoomTo(p){const L=sv.L;if(!L||!sv.map)return;const pts=(p.pts||[]).filter(q=>Array.isArray(q));
  if(p.t==='out'&&pts.length>=2){sv.map.fitBounds(L.latLngBounds(pts).pad(.45),{maxZoom:20});return;}
  if(p.t==='work'){const r=Math.max(5,+p.r||20),k=111320*Math.cos(p.lat*Math.PI/180);sv.map.fitBounds(L.latLngBounds([[p.lat-r*2.2/111320,p.lng-r*2.2/k],[p.lat+r*2.2/111320,p.lng+r*2.2/k]]),{maxZoom:20});return;}
  sv.map.panTo([p.lat,p.lng]);}
function svEditFac(fid){const a=FAC.find(x=>x.id===fid);if(!a)return;svStopCap();
  sv.draft={id:null,fac:a.id,count:facCount(a)||'',unit:a.unit||'',nearFob:a.nearFob||'',t:'fac',lat:a.lat,lng:a.lng,acc:a.acc!=null?a.acc:null,placed:a.placed||'gps',cat:a.cat,name:a.name,note:a.note||'',facPf:a.pf?String(barPf(pfBar(+a.pf))):'',pillar:a.pillar||''};
  sv.msg='';sv.err=false;sv.confirmDel=false;renderSvEd();svDrawMap();if(sv.map)sv.map.panTo([a.lat,a.lng]);svScrollEd();}
function svScrollEd(){if(window.innerWidth<960){const e=$('svEd');if(e)setTimeout(()=>e.scrollIntoView({behavior:'smooth',block:'nearest'}),40);}}
function svMoveDraft(lat,lng,how){if(!sv.draft)return;sv.draft.lat=lat;sv.draft.lng=lng;if(how==='map')sv.draft.placed='map';if(sv.draftM)sv.draftM.setLatLng([lat,lng]);svPosLine();if(sv.draft.t==='work')svDrawMap();}
function svStopCap(){if(sv.stopCap){const f=sv.stopCap;sv.stopCap=null;f();}}
function svGpsAdd(){if(!svCanWrite())return;
  const me=sv.me&&sv.watch!=null&&Date.now()-sv.me.t<8000?sv.me:null;
  svNewDraft(me?{lat:me.lat,lng:me.lng,acc:me.acc,placed:'gps'}:{lat:sv.map?sv.map.getCenter().lat:NDLS_C.lat,lng:sv.map?sv.map.getCenter().lng:NDLS_C.lng,acc:null,placed:'gps'});
  svReadGps(!me);}
function svReadGps(fresh){if(!sv.draft)return;const d=sv.draft;d.reading=true;if(fresh)d.acc=null;svPosLine();
  sv.stopCap=captureGps(fix=>{if(sv.draft!==d)return;if(d.placed==='map'&&!fresh)return;d.lat=fix.lat;d.lng=fix.lng;d.acc=fix.acc;d.placed='gps';if(sv.draftM)sv.draftM.setLatLng([fix.lat,fix.lng]);if(sv.map)sv.map.panTo([fix.lat,fix.lng]);svPosLine();},
    (why,best)=>{if(sv.draft!==d)return;d.reading=false;sv.stopCap=null;if(!best&&why!=='cancel')d.gpsErr=gpsFail[why]?gpsFail[why].replace(/Pick the area.*$/,'Drag the pin to the spot instead.'):'';svPosLine();});}
function svPosLine(){const el=$('svPos');if(!el||!sv.draft)return;const d=sv.draft;
  if(svIsShape(d)){const n=(d.pts||[]).length;el.innerHTML=`<p class="msg">${n?`Set by its ${n} ${svShape(d)==='area'?'corners':'points'}. Adjust them on the map.`:'Add the corners first.'}</p>`;return;}
  el.innerHTML=`<div class="geo">${fmtLL(d.lat,d.lng)} ${d.placed==='map'?'<span class="pill good">placed on the map</span>':d.acc!=null?`<span class="pill ${accClass(d.acc)}">GPS ${accText(d.acc)}</span>`:d.reading?'':'<span class="pill none">no GPS fix</span>'}</div>
    <p class="msg">${d.reading?'Reading GPS… stand still for a few seconds. ':''}${d.gpsErr?esc(d.gpsErr)+' ':''}Drag the orange <b>+</b> pin on the map, or tap the map, to put it on the exact spot.</p>
    <div class="actions">${d.reading?'<button class="btn sm" type="button" id="svGpsStop">Use this reading</button>':'<button class="btn sm" type="button" id="svGpsAgain">Read GPS again</button>'}</div>`;}

// ---- editor panel ----
function svTypeOpts(d){const cur=d.newKind?'new':d.tSel||(d.t==='fac'&&isXCat(d.cat)?'k:'+d.cat:d.t);const base=SV_TYPES.filter(t=>t[0]!=='work'),xk=xKinds();
  return base.map(([v,l])=>svOpt(v,l,cur)).join('')+(xk.length?`<optgroup label="Kinds of place you added">${xk.map(c=>svOpt('k:'+c[0],c[1],cur)).join('')}</optgroup>`:'')
    +SV_TYPES.filter(t=>t[0]==='work').map(([v,l])=>svOpt(v,l,cur)).join('')+svOpt('new','+ Something else: type a new kind of place…',cur);}
function svOpt(v,l,cur){return `<option value="${esc(v)}"${String(v)===String(cur)?' selected':''}>${esc(l)}</option>`;}
function renderSvEd(){const box=$('svEd');if(!box)return;const ro=!svCanWrite();
  if(sv.pfEdit){box.innerHTML=pfEditHtml();return;}
  if(!sv.draft){box.innerHTML=svListHtml(ro);return;}
  const d=sv.draft,bridges=Object.keys(svBridges()),gatesRec=svPts().filter(p=>p.t==='gate').map(p=>String(p.n)).filter(Boolean),entriesRec=svPts().filter(p=>p.t==='entry').map(p=>String(p.name||'')).filter(Boolean);
  const pfSel=(id,v,key)=>`<select id="${id}" data-sk="${key||'pf'}">${key?svOpt('','Not on a platform',v):''}${ALLP.map(b=>svOpt(barPf(b),platLabel(b),v===''||v==null?v:barPf(pfBar(+v)))).join('')}</select>`;
  let f='';
  const sideSel=`<div class="field"><label for="sv-side">Side of the station</label><select id="sv-side" data-sk="side">${svOpt('P','Paharganj side',d.side)}${svOpt('A','Ajmeri Gate side',d.side)}</select></div>`;
  const useSel=`<div class="field"><label for="sv-st">Use</label><select id="sv-st" data-sk="status">${LY_STATUS.map(([v,l])=>svOpt(v,l,d.status)).join('')}</select></div>`;
  if(d.t==='entry')f=`<div class="field"><label for="sv-name">Name of the entry</label><input id="sv-name" data-sk="name" value="${esc(d.name)}" maxlength="40" placeholder="e.g. Main entrance, Metro entry, Parking entry"></div>
    <div class="two">${sideSel}${useSel}</div><p class="msg">Stand in the entrance itself, where passengers come into the station.</p>`;
  else if(d.t==='gate')f=`<div class="two"><div class="field"><label for="sv-n">Gate number or name</label><input id="sv-n" data-sk="n" value="${esc(d.n)}" maxlength="40" placeholder="e.g. 5, or Paharganj Gate 1A"></div>
      <div class="field"><label for="sv-side">Side of the station</label><select id="sv-side" data-sk="side">${svOpt('P','Paharganj side',d.side)}${svOpt('A','Ajmeri Gate side',d.side)}</select></div></div>
    <div class="field"><label for="sv-st">Use</label><select id="sv-st" data-sk="status">${LY_STATUS.map(([v,l])=>svOpt(v,l,d.status)).join('')}</select></div>
    <p class="msg">Stand in the gateway itself.</p>`;
  else if(d.t==='pfend'){const done=svEndsDone(),dupe=!d.id&&d.end&&done[pfBar(+d.pf)+'|'+d.end];
    f=`<div class="two"><div class="field"><label for="sv-pf">Platform</label>${pfSel('sv-pf',d.pf)}</div>
      <div class="field"><label for="sv-end">Which end</label><select id="sv-end" data-sk="end">${d.end==='sdb'||d.end==='nzm'?'':svOpt('','Pick an end','')}${SV_ENDS.map(([v,l])=>svOpt(v,l,d.end)).join('')}</select></div></div>
    <p class="msg">Stand at the very end of the platform. Island platforms (2/3 … 14/15) count once. Record both ends of every platform.${dupe?` <b>${esc(pfName(d.pf))}, ${esc(svEndName(d.end))} is already recorded. Saving replaces the earlier reading.</b>`:''}</p>`;}
  else if(d.t==='pfpt')f=`<div class="field"><label for="sv-pf">Platform</label>${pfSel('sv-pf',d.pf)}</div><p class="msg">Stand where the platform bends (or on its edge line) and save. The platform is drawn through its ends and these points in order. To place several at once, use <b>Adjust line</b> in the platform table.</p>`;
  else if(d.t==='out'){const sh=svShape(d),n=(d.pts||[]).length,need=sh==='area'?3:sh==='line'?2:0;
    f=`<div class="two"><div class="field"><label for="sv-ok">What is it</label><select id="sv-ok" data-sk="kind">${RMAP.OUT_KINDS.map(k=>svOpt(k[0],k[1],d.kind)).join('')}</select></div>
      <div class="field"><label for="sv-osh">Draw it as</label><select id="sv-osh" data-sk="shape">${svOpt('area','An area (tap its corners)',sh)}${svOpt('line','A line (tap along it)',sh)}${svOpt('point','One spot',sh)}</select></div></div>
    <div class="field"><label for="sv-name">Name</label><input id="sv-name" data-sk="name" value="${esc(d.name)}" maxlength="60" placeholder="${esc(d.kind==='road'?'e.g. Chelmsford Road, DBG Road':d.kind==='parking'?'e.g. Paharganj side multilevel parking':'e.g. Prepaid taxi booth')}"></div>
    <div class="field"><label for="sv-note">Note <small>(optional)</small></label><input id="sv-note" data-sk="note" value="${esc(d.note)}" maxlength="120" placeholder="e.g. Two-wheeler and car parking, paid"></div>
    ${svColorField(d)}
    ${sh==='point'?'<p class="msg">Stand at the spot, or drag the orange + pin to it.</p>':`<div class="field"><span class="flabel">${sh==='area'?'Corners':'Points along the line'} <small class="hi">${n} added${n<need?` · at least ${need} needed`:''}</small></span>
      <div class="actions"><button class="btn sm" type="button" id="svCornerGps" ${d.cornerReading?'disabled':''}>${d.cornerReading?'Reading GPS…':'Add corner where I’m standing'}</button>
      <button class="btn sm" type="button" id="svCornerTap" aria-pressed="${!!sv.cornerTap}">${sv.cornerTap?'Tapping adds corners · tap here to stop':'Add corners by tapping the map'}</button>
      <button class="btn sm" type="button" id="svCornerUndo" ${n?'':'disabled'}>Undo last</button><button class="btn sm" type="button" id="svCornerClear" ${n?'':'disabled'}>Clear</button></div>
      ${n?`<p class="msg" style="margin:8px 0 0"><b>Adjust on the map:</b> drag a numbered corner to move it · tap <b>+</b> between two corners to add one · drag <b>✥</b> to move the whole ${sh==='area'?'area':'line'}.</p>`:''}
      ${sv.selCorner!=null&&sv.selCorner<n?`<div class="actions" style="margin-top:6px"><span class="msg">Corner ${sv.selCorner+1} selected</span><button class="btn sm danger" type="button" id="svCornerDel" ${n<=(sh==='area'?3:2)?'disabled':''}>Delete corner ${sv.selCorner+1}</button><button class="btn sm" type="button" id="svCornerDesel">Done</button></div>`:''}
      <small>${sh==='area'?'Walk around the area and add each corner in turn, or tap them on the satellite map. The shape closes by itself.':'Add a point at each bend along the road, in order.'}</small></div>`}`;}
  else if(d.t==='work'){
    f=`<div class="field"><label for="sv-name">What is happening</label><input id="sv-name" data-sk="name" value="${esc(d.name)}" maxlength="60" placeholder="e.g. Platform renovation, FOB repair, Lift under repair"></div>
    <div class="two"><div class="field"><label for="sv-wa">Where</label><select id="sv-wa" data-sk="area">${svOpt('pl','On a platform',d.area)}${svOpt('P','Paharganj side concourse',d.area)}${svOpt('A','Ajmeri Gate side concourse',d.area)}${svOpt('fob','On a foot over bridge',d.area)}</select></div>
      ${d.area==='pl'?`<div class="field"><label for="sv-pf">Platform</label>${pfSel('sv-pf',d.pf)}</div>`:'<div></div>'}</div>
    ${d.area==='pl'?`<div class="field"><label for="sv-pil">Nearest pillar <small>(optional)</small></label><input id="sv-pil" data-sk="pillar" value="${esc(d.pillar)}" maxlength="12" placeholder="e.g. 23"></div>`:''}
    <div class="two"><div class="field"><label for="sv-blk">Can passengers pass?</label><select id="sv-blk" data-sk="block">${svOpt('0','Yes, with care (partly blocked)',d.block?'1':'0')}${svOpt('1','No, closed (route around it)',d.block?'1':'0')}</select></div>
      <div class="field"><label for="sv-r">Size: radius in metres</label><input id="sv-r" data-sk="r" type="number" min="5" max="500" step="1" inputmode="numeric" value="${esc(d.r||20)}"><small>About ${Math.round((+d.r||20)*2)} m across. Or drag the ↔ handle on the map.</small></div></div>
    ${svColorField(d)}
    <div class="two"><div class="field"><label for="sv-until">Expected to finish <small>(optional)</small></label><input id="sv-until" data-sk="until" type="date" value="${esc(d.until)}"></div>
      <label class="lychip" style="align-self:end"><input type="checkbox" data-sk="show" ${d.show!==false?'checked':''}><span>Show to passengers</span></label></div>
    <p class="msg">Stand in the middle of the work area. Closed areas are routed around; partly blocked areas get a warning in the directions. After the finish date the area is ignored automatically; delete the point when the work is over.</p>`;}
  else if(d.t==='pillar'){const dupe=!d.id&&String(d.pillar).trim()&&Object.values(SURVEY).some(p=>p.t==='pillar'&&pfBar(+p.pf)===pfBar(+d.pf)&&String(p.pillar).trim().toLowerCase()===String(d.pillar).trim().toLowerCase());
    f=`<div class="two"><div class="field"><label for="sv-pf">Platform</label>${pfSel('sv-pf',d.pf)}</div>
      <div class="field"><label for="sv-pil">Pillar number</label><input id="sv-pil" data-sk="pillar" value="${esc(d.pillar)}" maxlength="12" placeholder="e.g. 23" inputmode="text"></div></div>
    <p class="msg">Stand next to the pillar and type the number painted on it. Pillars every 50–100 m along each platform are enough; passengers are then told “near pillar 23”.${dupe?' <b>This pillar is already recorded on this platform. Saving replaces it.</b>':''}</p>`;}
  else if(d.t==='fob')f=`<div class="field"><label for="sv-br">Which bridge</label><select id="sv-br" data-sk="bridge">${bridges.map(b=>svOpt(b,b,d.newBridge?'':d.bridge)).join('')}${svOpt('__new','New bridge…',d.newBridge?'__new':'')}</select></div>
    ${d.newBridge?`<div class="field"><label for="sv-brn">Name of the new bridge</label><input id="sv-brn" data-sk="bridgeName" value="${esc(d.bridge)}" maxlength="40" placeholder="e.g. Foot Over Bridge 3"></div>`:''}
    <div class="flabel">Ways down from this point</div>
    ${(d.ways||[]).length?(d.ways||[]).map((w,i)=>`<fieldset class="svway" data-wi="${i}"><legend class="flabel">Way ${i+1}</legend>
      <div class="two"><div class="field"><label for="sv-wt${i}">Leads to</label><select id="sv-wt${i}" data-wk="to">${SV_WAY_TO.map(([v,l])=>svOpt(v,l,w.to)).join('')}</select></div>
      ${w.to==='pf'?`<div class="field"><label for="sv-wp${i}">Platform</label><select id="sv-wp${i}" data-wk="pf">${ALLP.map(b=>svOpt(barPf(b),platLabel(b),barPf(pfBar(+w.pf||1)))).join('')}</select></div>`
        :w.to==='gate'?`<div class="field"><label for="sv-wg${i}">Gate or entry</label><select id="sv-wg${i}" data-wk="gate">${svOpt('','Pick one',w.gate)}${gatesRec.map(n=>svOpt(n,gateText(n),w.gate)).join('')}${entriesRec.map(n=>svOpt(n,n,w.gate)).join('')}</select></div>`:'<div></div>'}</div>
      ${w.to==='gate'?'':`<div class="field"><label for="sv-ws${i}">Which side does it go down</label><select id="sv-ws${i}" data-wk="side">${svOpt('','Straight down / not sure',w.side)}${svOpt('sdb','Towards the Sadar Bazar end',w.side)}${svOpt('nzm','Towards the Nizamuddin end',w.side)}</select></div>`}
      <div class="lychips">${[['stairs','Stairs'],['lift','Lift'],['esc','Escalator']].map(([k,l])=>`<label class="lychip"><input type="checkbox" data-wk="${k}" ${w[k]?'checked':''}><span>${l}</span></label>`).join('')}</div>
      <div class="actions" style="margin-top:6px"><button class="btn sm" type="button" data-wdel="${i}">Remove this way</button></div></fieldset>`).join('')
      :'<p class="msg">No way down here: this is a turn or corner on the bridge.</p>'}
    <div class="actions"><button class="btn sm" type="button" data-wadd="1">Add a way down</button></div>
    <p class="msg">Add one way for each stairs, lift or escalator at this spot. For example: stairs down to Platform 1 and a way out to the Paharganj concourse, or stairs on both sides of an island platform.</p>
    <div class="field"><label for="sv-from">Joins the bridge at</label><select id="sv-from" data-sk="from">${svFromOptions(d)}</select>
      <small>Where this point connects. Leave it on “the previous point” when you walk straight on. For a branch (for example a second way off point 13), pick that point.</small></div>
    <div class="field"><span class="flabel">Also connected to</span>
      <div class="lychips">${(d.links||[]).map((t,i)=>`<span class="svlink">${esc(svPointName(t))} <button type="button" class="btn sm" data-lkdel="${i}" aria-label="Remove connection">✕</button></span>`).join('')||'<span class="msg">No other connections.</span>'}</div>
      <select id="sv-lkadd" aria-label="Add a connection">${svLinkOptions(d)}</select>
      <small>Use this when this point joins more than one other point, for example B3-9 joined to B3-10 and also to B2-7.</small></div>
    <div class="field"><label for="sv-seq">Order along the bridge</label><input id="sv-seq" data-sk="seq" type="number" min="1" max="99" value="${esc(d.seq)}"><small>Points are joined in this order. Walk the bridge from one end to the other; each new point goes on the end.</small></div>`;
  else f=(d.newKind?`<div class="field"><label for="sv-kind">New kind of place</label><input id="sv-kind" data-sk="kindName" value="${esc(d.kindName||'')}" maxlength="40" placeholder="e.g. Parcel Office, Lost Property, Prayer Room">
      <small>Saved for future use: it is added to <b>What is here?</b> and to the passengers' <b>Where do you want to go?</b> list.</small></div>`:`<div class="field"><label for="sv-quick">Quick pick <small>(optional)</small></label><select id="sv-quick" data-sk="quick">${svOpt('','Choose a common amenity…','')}${SV_QUICK.map(([c,n],i)=>svOpt(i,n,'')).join('')}</select></div>
    <div class="field"><label for="sv-cat">Type</label><select id="sv-cat" data-sk="cat">${ADMIN_CATS.map(c=>svOpt(c[0],c[1],d.cat)).join('')}</select></div>`)+`
    <div class="field"><label for="sv-name">Name</label><input id="sv-name" data-sk="name" value="${esc(d.name)}" maxlength="60" placeholder="e.g. Reservation Counters"></div>
    ${countFields(d,['sv-cnt','sv-unit',true],false)}
    <div class="field"><label for="sv-note">Details shown to passengers <small>(optional)</small></label><input id="sv-note" data-sk="note" value="${esc(d.note)}" maxlength="120" placeholder="e.g. Open 8 am to 8 pm"></div>
    <div class="two"><div class="field"><label for="sv-fpf">On a platform?</label>${pfSel('sv-fpf',d.facPf,'facPf')}</div>
      ${d.facPf?`<div class="field"><label for="sv-fpil">Nearest pillar number</label><input id="sv-fpil" data-sk="pillar" value="${esc(d.pillar)}" maxlength="12" placeholder="e.g. 23">${String(d.pillar||'').trim()?'':'<small class="req">Required</small>'}</div>`:'<div></div>'}</div>
    ${d.facPf?`<div class="field"><label for="sv-ffob">Nearest foot over bridge</label><select id="sv-ffob" data-sk="nearFob">${svOpt('','Choose…',d.nearFob||'')}${FOBS.map(f=>svOpt(f.id,f.name,d.nearFob||'')).join('')}${Object.keys(svBridges()).filter(b=>!FOBS.some(f=>f.name===b)).map(b=>svOpt('sv:'+b,b,d.nearFob||'')).join('')}${svOpt('none','No foot over bridge nearby',d.nearFob||'')}</select>${d.nearFob?'':'<small class="req">Required</small>'}</div>`:''}
    <p class="msg">Saved as a facility that passengers can pick. Its status and photo are managed in <b>Facilities</b>.${d.facPf?' Setting the platform keeps it on the right platform even when the GPS is unsure.':''}</p>`;
  box.innerHTML=`<h3 class="lyh" style="margin-top:0">${d.id||d.fac?'Edit point':'New point'}</h3>
    <form class="form" id="svForm" novalidate>
      <div class="field"><label for="sv-t">What is here?</label><select id="sv-t" data-sk="t" ${d.id||d.fac?'disabled':''}>${svTypeOpts(d)}</select></div>
      ${f}
      <div class="field"><span class="flabel">Position</span><div id="svPos"></div></div>
      ${sv.confirmDel?`<div class="confirm"><span>Delete this point?</span><div class="actions"><button class="btn danger" type="button" id="svDelYes">Delete</button><button class="btn" type="button" id="svDelNo">Keep it</button></div></div>`:''}
      <div class="actions"><button class="btn primary" type="submit" ${ro||sv.busy?'disabled':''}>Save point</button><button class="btn" type="button" id="svCancel">Cancel</button>
        ${(d.id||d.fac)&&!sv.confirmDel?`<button class="btn danger" type="button" id="svDel" ${ro?'disabled':''}>Delete</button>`:''}
        <span class="msg${sv.err?' err':''}" role="status">${esc(sv.msg)}</span></div>
    </form>`;
  svPosLine();}
// ---- platform lines: ends + bend points, in order from the Sadar Bazar end to the Nizamuddin end ----
function pfLinePts(bar){const all=svPts().filter(p=>pfBar(+p.pf)===bar&&(p.t==='pfend'||p.t==='pfpt'));return pfOrder(all);}
function pfOrder(pts){if(pts.length<2)return pts.slice();const a=pts.find(p=>p.t==='pfend'&&p.end==='sdb'),z=pts.find(p=>p.t==='pfend'&&p.end==='nzm');
  let A=a,Z=z;if(!A||!Z){let dm=-1;pts.forEach(p=>pts.forEach(q=>{const d=(p.lat-q.lat)**2+((p.lng-q.lng)*.88)**2;if(d>dm){dm=d;A=p;Z=q;}}));}
  const ax=Z.lat-A.lat,ay=(Z.lng-A.lng)*.88,L2=ax*ax+ay*ay||1,t=p=>((p.lat-A.lat)*ax+(p.lng-A.lng)*.88*ay)/L2;
  return pts.slice().sort((p,q)=>(p===A?-1e9:p===Z?1e9:t(p))-(q===A?-1e9:q===Z?1e9:t(q)));}
const llLen=pts=>pts.reduce((s,p,i)=>i?s+sv.map.distance([pts[i-1].lat,pts[i-1].lng],[p.lat,p.lng]):0,0);
function pfEditStart(bar){svStopCap();sv.draft=null;sv.pfEdit={bar,pts:pfLinePts(bar).map(p=>({id:p.id,t:p.t,end:p.end||'',lat:p.lat,lng:p.lng,moved:false})),del:[],sel:null};
  renderSvEd();svDrawMap();const L=sv.L;if(sv.map&&L&&sv.pfEdit.pts.length>=2)sv.map.fitBounds(L.latLngBounds(sv.pfEdit.pts.map(p=>[p.lat,p.lng])).pad(.08),{maxZoom:20});svScrollEd();}
function pfEditHtml(){const e=sv.pfEdit,n=e.pts.length,bends=e.pts.filter(p=>p.t==='pfpt').length,len=sv.map&&n>1?Math.round(llLen(e.pts)):0,sel=e.sel!=null?e.pts[e.sel]:null;
  return `<h3 class="lyh" style="margin-top:0">${esc(platLabel(e.bar))} · platform line</h3>
    <p class="msg">The yellow line runs from the Sadar Bazar end to the Nizamuddin end through ${bends?`${bends} bend point${bends===1?'':'s'}`:'no bend points yet'}${len?` · <b>${len} m</b> long`:''}.</p>
    <p class="msg"><b>On the map:</b> tap <b>+</b> on the line to add a bend point there · drag any point to where the platform really runs (the two ends too) · tap a bend point to select it.</p>
    ${sel?`<div class="actions"><span class="msg">${sel.t==='pfend'?esc(svEndName(sel.end)):'Bend point '+e.pts.filter((p,i)=>p.t==='pfpt'&&i<=e.sel).length} selected</span>${sel.t==='pfpt'?`<button class="btn sm danger" type="button" id="pfDel">Delete this bend point</button>`:''}<button class="btn sm" type="button" id="pfDesel">Done</button></div>`:''}
    <div class="actions" style="margin-top:12px"><button class="btn primary" type="button" id="pfSave">Save platform line</button><button class="btn" type="button" id="pfCancel">Cancel</button><span class="msg${sv.err?' err':''}" id="pfMsg" role="status">${esc(sv.msg||'')}</span></div>`;}
function pfEditDraw(L,g){const e=sv.pfEdit,pts=e.pts;if(pts.length<2)return;
  const line=L.polyline(pts.map(p=>[p.lat,p.lng]),{color:'#F3C531',weight:9,opacity:.85}).addTo(g);
  const live=()=>line.setLatLngs(pts.map(p=>[p.lat,p.lng]));
  for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],m=L.marker([(a.lat+b.lat)/2,(a.lng+b.lng)/2],{icon:svIcon('svpin-mid','+'),draggable:true,zIndexOffset:800,title:'Tap or drag to add a bend point here'}).addTo(g);
    const ins=ll=>{pts.splice(i,0,{id:null,t:'pfpt',end:'',lat:+ll.lat.toFixed(7),lng:+ll.lng.toFixed(7),moved:true});e.sel=i;sv.msg='';renderSvEd();svDrawMap();};
    m.on('click',()=>ins(m.getLatLng()));m.on('dragend',()=>ins(m.getLatLng()));}
  pts.forEach((p,i)=>{const lab=p.t==='pfend'?(p.end==='sdb'?'SB end':p.end==='nzm'?'NZM end':'End'):'⌇';
    const m=L.marker([p.lat,p.lng],{icon:svIcon((p.t==='pfend'?'svpin-pfend':'svpin-corner')+(e.sel===i?' sel':''),lab),draggable:true,zIndexOffset:900,title:'Drag to move · tap to select'}).addTo(g);
    m.on('drag',()=>{const ll=m.getLatLng();p.lat=+ll.lat.toFixed(7);p.lng=+ll.lng.toFixed(7);p.moved=true;live();});
    m.on('dragend',()=>{e.sel=i;renderSvEd();svDrawMap();});m.on('click',()=>{e.sel=e.sel===i?null:i;renderSvEd();svDrawMap();});});}
async function pfEditSave(){const e=sv.pfEdit;if(!e||!DB)return;sv.msg='Saving…';sv.err=false;renderSvEd();
  try{const uid=USER?await USER.id():null,now=new Date().toISOString();
    for(const id of e.del){await DB.doc('survey/'+id).delete();}
    for(const p of e.pts){if(!p.moved)continue;
      if(p.id){const ex=Object.assign({},SURVEY[p.id]||{});Object.assign(ex,{lat:p.lat,lng:p.lng,placed:'map',updatedAt:now,by:uid||''});await DB.doc('survey/'+p.id).set(ex);}
      else{const id='sv'+Math.random().toString(36).slice(2,10);await DB.doc('survey/'+id).set({t:'pfpt',pf:barPf(e.bar),lat:p.lat,lng:p.lng,acc:null,placed:'map',at:now,updatedAt:now,by:uid||''});}}
    const nm=platLabel(e.bar);sv.pfEdit=null;sv.msg='';svScheduleAuto();renderSvEd();svDrawMap();const m=$('svMsg');if(m){m.textContent=`${nm} line saved.`;m.className='msg okm';}}
  catch(err){sv.err=true;sv.msg="Couldn't save: "+((err&&err.message)||'error');renderSvEd();}}
function svEndsGrid(){const byKey={},pil={};svPts().forEach(p=>{if(p.t==='pfend')byKey[pfBar(+p.pf)+'|'+(p.end||'')]=p;if(p.t==='pillar'){const b=pfBar(+p.pf);pil[b]=(pil[b]||0)+1;}});
  const cell=(b,e)=>{const p=byKey[b+'|'+e];return p?`<button type="button" class="svend on" data-sved="${esc(p.id)}" title="${esc(platLabel(b)+', '+svEndName(e))}">✓</button>`:`<span class="svend" title="${esc(platLabel(b)+', '+svEndName(e)+' · not recorded')}">–</span>`;};
  const loose=svPts().filter(p=>p.t==='pfend'&&p.end!=='sdb'&&p.end!=='nzm');
  return `<h3 class="lyh">Platform ends and pillars <small class="hi">${Object.keys(svEndsDone()).length} of 18 ends</small></h3>
    <div class="svends" role="table" aria-label="Platform ends recorded"><div class="svends-h" role="row"><span role="columnheader">PF</span><span role="columnheader">Sadar Bazar end</span><span role="columnheader">Nizamuddin end</span><span role="columnheader">Pillars</span><span role="columnheader">Line</span></div>
    ${ALLP.map(b=>`<div class="svends-r" role="row"><span role="rowheader">${platLabel(b).replace('Platform ','')}</span>${cell(b,'sdb')}${cell(b,'nzm')}<span class="svpil">${pil[b]||'–'}</span>${(()=>{const lp=pfLinePts(b),nb=lp.filter(p=>p.t==='pfpt').length;return lp.length>=2?`<button type="button" class="btn sm svline" data-pfline="${b}" title="Add bend points and adjust the line">${nb?`${nb} bend${nb===1?'':'s'} · `:''}Adjust</button>`:'<span class="svpil">–</span>';})()}</div>`).join('')}</div>
    ${loose.length?`<p class="msg">Ends recorded without a name (tap to say which end): ${loose.map(p=>`<button class="btn sm" type="button" data-sved="${esc(p.id)}">${esc(pfName(p.pf))}</button>`).join(' ')}</p>`:''}
    ${svPillarList()}`;}
function svPillarList(){const ps=svPts().filter(p=>p.t==='pillar').sort((a,b)=>pfBar(+a.pf)-pfBar(+b.pf)||String(a.pillar).localeCompare(String(b.pillar),undefined,{numeric:true}));if(!ps.length)return '';
  return `<details class="svpills"><summary>Pillars recorded (${ps.length})</summary><div class="lychips">${ps.map(p=>`<button class="btn sm" type="button" data-sved="${esc(p.id)}">${esc(platLabel(pfBar(+p.pf)).replace('Platform ','PF '))} · ${esc(p.pillar)}</button>`).join('')}</div></details>`;}
function svListHtml(ro){const pts=svPts(),r=surveyBuild(),br=svBridges();
  const cnt=t=>pts.filter(p=>p.t===t).length,endsDone=Object.keys(svEndsDone()).length;
  const chk=[...r.probs.map(t=>['poor','To do',t]),...r.warns.map(t=>['fair','Check',t])];if(!chk.length)chk.push(['good','Ready','Everything needed is recorded. Build the station model and check it.']);
  const row=(p,i)=>`<div class="row svrow"><div><div class="n">${esc(svTitle(p))}</div><div class="w">${p.placed==='map'?'Placed on the map':p.acc!=null?'GPS ±'+Math.round(p.acc)+' m':'No GPS'}${p.at?' · '+esc(rel(p.at)):''}</div></div><span></span><button class="btn sm" type="button" data-sved="${esc(p.id)}">Edit</button></div>`;
  const grp=(title,arr,empty)=>`<h3 class="lyh">${title} <small class="hi">${arr.length}</small></h3>${arr.length?`<div class="rows">${arr.map(row).join('')}</div>`:`<p class="empty">${empty}</p>`}`;
  return `<p class="label" style="margin:0">Survey progress</p>
    <div class="counts svcounts"><div class="count"><b>${endsDone}/18</b><span>Platform ends</span></div><div class="count"><b>${cnt('gate')+cnt('entry')}</b><span>Gates &amp; entries</span></div><div class="count"><b>${Object.keys(br).length}</b><span>Bridges</span></div><div class="count"><b>${svFacs().length}</b><span>Facilities</span></div></div>
    <div class="rows">${chk.map(([c,l,t])=>`<div class="row lyck"><span class="pill ${c}">${l}</span><div class="n">${esc(t)}</div></div>`).join('')}</div>
    <div class="actions" style="margin:12px 0 4px"><button class="btn ${LAYOUT&&LAYOUT.src==='survey'?'':'primary'}" type="button" id="svBuild" ${r.layout&&!r.probs.length&&!ro?'':'disabled'}>${LAYOUT&&LAYOUT.src==='survey'?'Review in Station layout':'Build station model'}</button><span class="msg">Opens it in <b>Station layout</b> to check and save.</span></div>
    ${svAutoHtml(ro)}
    ${svReplaceHtml(ro)}
    ${svEndsGrid()}
    ${grp('Gates and entries',pts.filter(p=>p.t==='gate'||p.t==='entry').sort((a,b)=>(a.t===b.t?0:a.t==='gate'?-1:1)||String(a.n||a.name).localeCompare(String(b.n||b.name),undefined,{numeric:true})),'Stand in each gateway and each station entrance and add a point.')}
    ${Object.keys(br).length?Object.entries(br).map(([name,arr])=>grp(esc(name),arr,'')).join(''):grp('Foot over bridges',[],'Walk each bridge end to end: add a point at each end, each turn, and each stairs, lift or escalator.')}
    ${grp('Outside the station',pts.filter(p=>p.t==='out'),'Draw the Station area boundary (black line) and the Station building layout (white line) here: add one, pick it in “What is it”, then drag its corners on the map (tap + between corners to add one). Also record parking areas, roads, drop-off zones and taxi stands.')}
    ${grp('Construction sites and work areas',pts.filter(p=>p.t==='work'),'Stand in the middle of any work area and add a Construction site point. Closed areas are routed around.')}
    <h3 class="lyh">Facilities <small class="hi">${svFacs().length}</small></h3>${svFacs().length?`<div class="rows">${svFacs().map(a=>`<div class="row svrow"><div><div class="n">${esc(a.name)}${facHi(a)?` · <span lang="hi">${esc(facHi(a))}</span>`:''}<small>${esc((CAT[a.cat]||{}).en||a.cat)}${facAka(a).length?' · also '+esc(facAka(a).join(', ')):''}${facCount(a)?' · '+esc(countText(a)):''}</small></div><div class="w">${facWhereHtml(a)}</div></div><span></span><button class="btn sm" type="button" data-svfac="${esc(a.id)}">Edit</button></div>`).join('')}</div>`:'<p class="empty">Ticket counters, ATVMs, enquiry, toilets, lounges… stand at the entrance and add a point.</p>'}`;}
// After a surveyed layout is saved, QR boards and facilities still sit where they were on the old drawing. Move them using their GPS (or, for gate boards, the gate number).
function svReplacePlan(){if(!LAYOUT||!LAYOUT.geo)return null;const moves=[],left=[];
  const at=(lat,lng)=>{const m=surveyXY(LAYOUT.geo,...geoEN(lat,lng));const off=Math.max(0,-m.x,m.x-1000,-m.y+20,m.y-792);if(off>60)return null;return snapToWalkway(m.x,m.y);};
  QRPTS.forEach(q=>{if(q.placed==='survey'&&q.sv)return;let to=null;if(hasLL(q))to=at(q.lat,q.lng);
    if(!to){const g=String(q.name||'').match(/gate\s*(\w+)/i),gg=g&&GATES.find(x=>String(x[0]).toLowerCase()===g[1].toLowerCase());const ge=!gg&&GATES.find(x=>x[3]&&x[3].kind==='entry'&&String(q.name||'').toLowerCase().includes(String(x[0]).toLowerCase()));const G2=gg||ge;if(G2&&N[G2[1]])to={area:N[G2[1]].ctx,x:N[G2[1]].x,y:N[G2[1]].y};}
    if(to){const cur=ptXY(q);if(q.area!==to.area||Math.abs(cur.x-to.x)>2||Math.abs(cur.y-to.y)>2)moves.push({col:'qrpoints',id:q.id,name:'QR · '+q.name,to});}else left.push('QR · '+q.name);});
  FAC.forEach(a=>{if(a.src==='survey')return;if(hasLL(a)){const to=at(a.lat,a.lng);if(to){moves.push({col:'facilities',id:a.id,name:a.name,to});return;}}left.push(a.name);});
  return {moves,left,leftQr:QRPTS.filter(q=>!(q.placed==='survey'&&q.sv)&&!hasLL(q)&&!pinnedByGate(q)).map(q=>q.id),leftFac:FAC.filter(a=>a.src!=='survey'&&!hasLL(a)).map(a=>a.id)};}
function pinnedByGate(q){const g=String(q.name||'').match(/gate\s*(\w+)/i);return !!(g&&GATES.find(x=>String(x[0]).toLowerCase()===g[1].toLowerCase()))||!!GATES.find(x=>x[3]&&x[3].kind==='entry'&&String(q.name||'').toLowerCase().includes(String(x[0]).toLowerCase()));}
// ---- keep the station layout in step with the survey ----
// Once a surveyed layout has been built and saved, every saved/deleted survey point rebuilds it and saves it again,
// and QR boards made from survey points move with their point.
let svAutoTimer=null;
const svAutoOn=()=>!!(LAYOUT&&LAYOUT.src==='survey'&&LAYOUT.geo&&LAYOUT.auto!==false);
const lyCore=L=>{const c=normLayout(L);if(c.geo)delete c.geo.at,delete c.geo.n;return JSON.stringify(c);};
function svScheduleAuto(){if(!svAutoOn()||!svCanWrite())return;clearTimeout(svAutoTimer);sv.autoMsg='Updating the station layout…';sv.autoErr=false;svAutoLine();svAutoTimer=setTimeout(()=>svAutoUpdate(false),1500);}
async function svAutoUpdate(force){if(!svCanWrite()||!LAYOUT||LAYOUT.src!=='survey')return;if(!force&&!svAutoOn())return;
  if(ly.dirty){sv.autoErr=true;sv.autoMsg='Not updated: there are unsaved changes in Station layout. Save or discard them first.';svAutoLine();return;}
  const r=surveyBuild();if(!r.layout||r.probs.length){sv.autoErr=true;sv.autoMsg='Not updated: '+(r.probs[0]||'the survey is incomplete.');svAutoLine();return;}
  r.layout.auto=LAYOUT.auto!==false;if(LAYOUT.noStarter)r.layout.noStarter=true;const L=normLayout(r.layout);let changed=lyCore(L)!==lyCore(LAYOUT);
  try{if(changed){const uid=USER?await USER.id():null;await DB.doc('layout/main').set(Object.assign({},L,{updatedAt:new Date().toISOString(),updatedBy:uid||''}));SAVED_LAYOUT=normLayout(L);if(!ly.dirty){ly.draft=null;}applyLayout(L);}
    const moved=await svFollowQr();sv.autoErr=false;
    sv.autoMsg=changed?`Station layout updated just now${moved?` · ${moved} QR board${moved===1?'':'s'} moved`:''}.`:`Station layout is up to date${moved?` · ${moved} QR board${moved===1?'':'s'} moved`:''}.`;}
  catch(err){sv.autoErr=true;sv.autoMsg=`Couldn't update the station layout: ${(err&&err.message)||'error'}`;}
  svAutoLine();if(VIEW==='survey'&&!sv.draft)renderSvEd();}
async function svFollowQr(){let n=0;const uid=USER?await USER.id():null,now=new Date().toISOString();
  for(const q of QRPTS){if(q.placed!=='survey'||!q.sv)continue;let p=null,spot=null;
    if(q.sv.startsWith('s:')){const sp=SURVEY[q.sv.slice(2)];if(!sp)continue;p=Object.assign({id:q.sv.slice(2)},sp);spot=qrSpotFor(p);}
    else{const a=FAC.find(x=>x.id===q.sv.slice(2));if(!a)continue;p=a;spot=facPos(a);}
    if(!spot||!spot.area)continue;const cur=ptXY(q);
    const diff=q.area!==spot.area||Math.abs(cur.x-spot.x)>1||Math.abs(cur.y-spot.y)>1||(typeof p.lat==='number'&&(Math.abs((q.lat||0)-p.lat)>1e-7||Math.abs((q.lng||0)-p.lng)>1e-7));
    if(!diff)continue;const rec=Object.assign({},q,{area:spot.area,x:spot.x,y:spot.y,lat:typeof p.lat==='number'?p.lat:q.lat,lng:typeof p.lng==='number'?p.lng:q.lng,acc:p.acc!=null?p.acc:q.acc,updatedAt:now,updatedBy:uid||''});delete rec.id;
    await DB.doc('qrpoints/'+q.id).set(rec);n++;}
  return n;}
async function svSetAuto(on){if(!svCanWrite()||!LAYOUT||LAYOUT.src!=='survey')return;const L=Object.assign({},normLayout(SAVED_LAYOUT),{auto:!!on});
  try{await DB.doc('layout/main').set(L);SAVED_LAYOUT=normLayout(L);LAYOUT.auto=!!on;sv.autoErr=false;sv.autoMsg=on?'Automatic updates are on.':'Automatic updates are off. Tap Update now when you want the station layout rebuilt.';if(on)svAutoUpdate(true);}
  catch(err){sv.autoErr=true;sv.autoMsg="Couldn't change the setting: "+((err&&err.message)||'error');}
  if(!sv.draft)renderSvEd();}
function svAutoLine(){const el=$('svAutoMsg');if(el){el.textContent=sv.autoMsg||'';el.className='msg'+(sv.autoErr?' err':sv.autoMsg?' okm':'');}const pm=$('svMsg');if(pm&&sv.autoMsg){pm.textContent=sv.autoMsg;pm.className='msg'+(sv.autoErr?' err':' okm');}}
function svAutoHtml(ro){if(!LAYOUT||LAYOUT.src!=='survey')return `<p class="msg">After you build and save the station model once, it will update automatically each time you add or change a point.</p>`;
  const on=LAYOUT.auto!==false,at=LAYOUT.geo&&LAYOUT.geo.at;
  return `<div class="svauto"><label class="toggle" for="svAuto"><div><b>Update the station layout automatically</b><span>Each saved or deleted point rebuilds the model passengers use. QR boards made from survey points move with them.</span></div><span class="sw"><input type="checkbox" id="svAuto" ${on?'checked':''} ${ro?'disabled':''}><i></i></span></label>
    <div class="actions"><span class="msg">Station layout last built ${at?esc(rel(at)):'—'}.</span>${on?'':`<button class="btn sm" type="button" id="svAutoNow" ${ro?'disabled':''}>Update now</button>`}</div>
    <p class="msg${sv.autoErr?' err':sv.autoMsg?' okm':''}" id="svAutoMsg" role="status">${esc(sv.autoMsg||'')}</p></div>`;}
function svReplaceHtml(ro){const pl=svReplacePlan();if(!pl)return '';
  return `<h3 class="lyh">Move QR boards and facilities</h3><p class="msg">The saved station layout comes from this survey. QR boards and facilities placed on the old drawing need moving onto it.</p>
    <div class="rows"><div class="row lyck"><span class="pill ${pl.moves.length?'fair':'good'}">${pl.moves.length?'Move':'OK'}</span><div class="n">${pl.moves.length?`${pl.moves.length} can be moved automatically using their GPS reading or gate number.`:'Nothing to move automatically.'}</div></div>
    ${pl.left.length?`<div class="row lyck"><span class="pill poor">Starter</span><div class="n">${pl.left.length} item${pl.left.length===1?'':'s'} from the starter (dummy) layout have no GPS reading: ${esc(pl.left.slice(0,6).join(', '))}${pl.left.length>6?'…':''}. Delete them, then record the real ones in this survey.
      <div class="actions" style="margin-top:6px">${sv.confirmStarter?`<button class="btn sm danger" type="button" id="svStarterYes" ${ro?'disabled':''}>Yes, delete ${pl.left.length}</button><button class="btn sm" type="button" id="svStarterNo">Keep them</button>`:`<button class="btn sm danger" type="button" id="svStarter" ${ro?'disabled':''}>Delete starter items</button>`}<span class="msg${sv.starterErr?' err':''}" id="svStarterMsg">${esc(sv.starterMsg||'')}</span></div></div></div>`:''}</div>
    <div class="actions" style="margin-top:8px"><button class="btn" type="button" id="svMove" ${ro||!pl.moves.length||sv.moving?'disabled':''}>Move ${pl.moves.length||''} now</button><span class="msg${sv.moveErr?' err':sv.moveMsg?' okm':''}" id="svMoveMsg" role="status">${esc(sv.moveMsg||'')}</span></div>`;}
function renderSurvey(){if(VIEW!=='survey')return;
  const n=$('svNotice');n.innerHTML=!DB?"<span>Survey points can't be saved because the database isn't available.</span>":'';n.hidden=!n.innerHTML;
  $('svAddGps').disabled=$('svAddTap').disabled=!svCanWrite();$('svAddTap').setAttribute('aria-pressed',sv.tapAdd);$('svAddTap').textContent=sv.tapAdd?'Now tap the map…':'Add by tapping the map';
  if(!sv.draft)renderSvEd();svInitMap().then(()=>svDrawMap());svGpsLine();}
function svVal(t){const d=sv.draft,k=t.dataset.sk;if(!d||!k)return null;
  if(t.type==='checkbox')d[k]=t.checked;else if(k==='bridge'){if(t.value==='__new'){d.newBridge=true;d.bridge='';d.seq=1;}else{d.newBridge=false;d.bridge=t.value;if(!d.id)d.seq=svNextSeq(t.value);}}
  else if(k==='block'){d.block=t.value==='1';}else if(k==='r'){d.r=Math.min(500,Math.max(5,+t.value||20));}
  else if(k==='bridgeName'){d.bridge=t.value;}else if(k==='quick'){const q=SV_QUICK[+t.value];if(q){d.cat=q[0];d.name=q[1];}}else if(k==='pf'||k==='seq')d[k]=+t.value||1;else d[k]=t.value;
  if(k==='t'){d.tSel='';d.newKind=false;const v=t.value;
    if(v==='new'){d.t='fac';d.newKind=true;d.tSel='new';d.kindName=d.kindName||'';}
    else if(v.startsWith('k:')){d.t='fac';d.tSel=v;d.cat=v.slice(2);if(!String(d.name||'').trim())d.name=(CAT[d.cat]||{}).en||'';}
    else if(v==='fac'&&isXCat(d.cat))d.cat=(ADMIN_CATS.find(c=>!isXCat(c[0]))||['food'])[0];}
  if(k==='kind'&&!d.id){d.shape=(RMAP.OUT[d.kind]||RMAP.OUT.other).shape;if((d.kind==='station'||d.kind==='stationbldg')&&(d.pts||[]).length<3){const ab=autoBoundary();if(ab){d.pts=ab.map(q=>[+q[0].toFixed(7),+q[1].toFixed(7)]);if(!String(d.name||'').trim())d.name=d.kind==='station'?'Station area':'Station building';sv.zoomNext=true;}}}
  if(k==='t'&&t.value==='work')sv.zoomNext=true;
  if(k==='t'&&t.value==='out'&&!(d.pts||[]).length)d.pts=[[d.lat,d.lng]];
  if(k==='t'&&t.value==='pfend'&&!d.id){const ne=svNextEnd();d.pf=ne.pf;d.end=ne.end;}
  if(k==='t'&&t.value==='fob'&&!d.bridge){d.bridge='Foot Over Bridge 1';d.newBridge=!Object.keys(svBridges()).length;}
  if(k==='to'&&t.value&&!d.stairs&&!d.lift&&!d.esc)d.stairs=true;return k;}
$('svEd').addEventListener('change',e=>{if(e.target.id==='svAuto'){svSetAuto(e.target.checked);return;}
  if(e.target.id==='sv-lkadd'&&sv.draft&&e.target.value){(sv.draft.links=sv.draft.links||[]).push(e.target.value);renderSvEd();return;}
  {const t=e.target,wk=t.dataset&&t.dataset.wk,fs=t.closest&&t.closest('[data-wi]');if(wk&&fs&&sv.draft&&sv.draft.ways){const w=sv.draft.ways[+fs.dataset.wi];
    if(t.type==='checkbox')w[wk]=t.checked;else if(wk==='pf')w.pf=+t.value||1;else w[wk]=t.value;if(wk==='to'){if(t.value!=='gate')w.gate='';if(t.value==='gate')w.side='';}
    if(wk==='to')renderSvEd();return;}}const k=svVal(e.target);if(k&&(['t','bridge','to','end','quick','facPf','pillar','area','nearFob','kind','shape','block'].includes(k)||(k==='pf'&&sv.draft&&(sv.draft.t==='pfend'||sv.draft.t==='pillar'))))renderSvEd();if(k&&['t','kind','shape','block','r'].includes(k))svDrawMap();});
$('svEd').addEventListener('input',e=>{if(e.target.id==='sv-col'&&sv.draft){sv.draft.color=e.target.value;svDrawMap();return;}if(e.target.tagName==='INPUT'&&e.target.type!=='checkbox'){svVal(e.target);if(e.target.id==='sv-r')svDrawMap();}});
$('svEd').addEventListener('change',e=>{if(e.target.id==='sv-col'&&sv.draft){sv.draft.color=e.target.value;renderSvEd();svDrawMap();}});
$('svEd').addEventListener('click',async e=>{const t=e.target.closest('button');if(!t||t.disabled)return;
  if(t.dataset.pfline!=null){if(!svCanWrite())return;pfEditStart(+t.dataset.pfline);return;}
  if(t.id==='pfSave'){pfEditSave();return;}if(t.id==='pfCancel'){sv.pfEdit=null;sv.msg='';renderSvEd();svDrawMap();return;}
  if(t.id==='pfDesel'&&sv.pfEdit){sv.pfEdit.sel=null;renderSvEd();svDrawMap();return;}
  if(t.id==='pfDel'&&sv.pfEdit&&sv.pfEdit.sel!=null){const e=sv.pfEdit,p=e.pts[e.sel];if(p&&p.t==='pfpt'){if(p.id)e.del.push(p.id);e.pts.splice(e.sel,1);e.sel=null;}renderSvEd();svDrawMap();return;}
  if(t.dataset.sved){sv.pfEdit=null;svEdit(t.dataset.sved);return;}
  if(t.dataset.lkdel!=null&&sv.draft&&sv.draft.links){sv.draft.links.splice(+t.dataset.lkdel,1);renderSvEd();return;}
  if(t.dataset.wadd&&sv.draft){const ws=sv.draft.ways=sv.draft.ways||[];const last=ws[ws.length-1];ws.push(last?{to:last.to,pf:last.pf,gate:'',side:last.side==='sdb'?'nzm':last.side==='nzm'?'sdb':'',stairs:true,lift:false,esc:false}:{to:'pf',pf:sv.lastPf||1,gate:'',side:'',stairs:true,lift:false,esc:false});renderSvEd();return;}
  if(t.dataset.wdel!=null&&sv.draft&&sv.draft.ways){sv.draft.ways.splice(+t.dataset.wdel,1);renderSvEd();return;}if(t.dataset.svfac){svEditFac(t.dataset.svfac);return;}
  if(t.id==='svCornerDel'&&sv.draft&&sv.selCorner!=null){sv.draft.pts.splice(sv.selCorner,1);sv.selCorner=null;renderSvEd();svDrawMap();return;}if(t.id==='svCornerDesel'){sv.selCorner=null;renderSvEd();svDrawMap();return;}
  if(t.dataset&&t.dataset.col!=null&&sv.draft){sv.draft.color=t.dataset.col;renderSvEd();svDrawMap();return;}
  if(t.id==='svCornerGps'){svCornerGps();return;}if(t.id==='svCornerTap'){sv.cornerTap=!sv.cornerTap;renderSvEd();return;}
  if(t.id==='svCornerUndo'&&sv.draft){sv.draft.pts=(sv.draft.pts||[]).slice(0,-1);renderSvEd();svDrawMap();return;}if(t.id==='svCornerClear'&&sv.draft){sv.draft.pts=[];renderSvEd();svDrawMap();return;}
  if(t.id==='svCancel'){sv.cornerTap=false;svStopCap();sv.draft=null;renderSvEd();svDrawMap();return;}
  if(t.id==='svGpsAgain'){svReadGps(true);return;}if(t.id==='svGpsStop'){svStopCap();return;}
  if(t.id==='svDel'){sv.confirmDel=true;renderSvEd();return;}if(t.id==='svDelNo'){sv.confirmDel=false;renderSvEd();return;}
  if(t.id==='svDelYes'){const d=sv.draft;sv.busy=true;try{if(d.fac)await DB.doc('facilities/'+d.fac).delete();else await DB.doc('survey/'+d.id).delete();svScheduleAuto();sv.draft=null;sv.busy=false;renderSvEd();svDrawMap();}
    catch(err){sv.busy=false;sv.err=true;sv.msg="Couldn't delete: "+((err&&err.message)||'error');sv.confirmDel=false;renderSvEd();}return;}
  if(t.id==='svAutoNow'){svAutoUpdate(true);return;}
  if(t.id==='svStarter'){sv.confirmStarter=true;renderSvEd();return;}if(t.id==='svStarterNo'){sv.confirmStarter=false;renderSvEd();return;}
  if(t.id==='svStarterYes'){const pl=svReplacePlan();if(!pl)return;sv.confirmStarter=false;t.disabled=true;let n=0;
    try{if(LAYOUT&&!LAYOUT.noStarter){const L=Object.assign({},normLayout(SAVED_LAYOUT),{noStarter:true});await DB.doc('layout/main').set(L);SAVED_LAYOUT=normLayout(L);LAYOUT.noStarter=true;}
      for(const id of pl.leftFac){await DB.doc('facilities/'+id).delete();if(PHOTOS['f-'+id]){try{await DB.doc('photos/f-'+id).delete();}catch(_){}}n++;sv.starterMsg=`Deleted ${n}…`;const m=$('svStarterMsg');if(m)m.textContent=sv.starterMsg;}
      for(const id of pl.leftQr){await DB.doc('qrpoints/'+id).delete();n++;sv.starterMsg=`Deleted ${n}…`;const m=$('svStarterMsg');if(m)m.textContent=sv.starterMsg;}
      sv.starterErr=false;sv.starterMsg=`Deleted ${n} starter item${n===1?'':'s'}.`;}
    catch(err){sv.starterErr=true;sv.starterMsg=`Stopped after ${n}: ${(err&&err.message)||'error'}`;}renderSvEd();return;}
  if(t.id==='svMove'){const pl=svReplacePlan();if(!pl)return;sv.moving=true;sv.moveErr=false;t.disabled=true;let done=0;const uid=USER?await USER.id():null,now=new Date().toISOString();
    const mm={set textContent(v){sv.moveMsg=v;const el=$('svMoveMsg');if(el)el.textContent=v;},set className(v){sv.moveErr=/err/.test(v);}};
    try{for(const m of pl.moves){const src=m.col==='qrpoints'?getPt(m.id):FAC.find(a=>a.id===m.id);if(!src)continue;const rec=Object.assign({},src,{area:m.to.area,x:m.to.x,y:m.to.y,updatedAt:now,updatedBy:uid||''});delete rec.id;delete rec._n;
        await DB.doc(m.col+'/'+m.id).set(rec);done++;if(mm)mm.textContent=`Moved ${done} of ${pl.moves.length}…`;}
      mm.textContent=`Moved ${done}. Check them in QR points and Facilities.`;}catch(err){mm.className='msg err';mm.textContent=`Stopped after ${done}: ${(err&&err.message)||'error'}`;}sv.moving=false;renderSvEd();return;}
  if(t.id==='svBuild'){const r=surveyBuild();if(!r.layout||r.probs.length)return;r.layout.auto=true;if(SAVED_LAYOUT&&SAVED_LAYOUT.noStarter)r.layout.noStarter=true;ly.draft=lyClone(normLayout(r.layout));ly.dirty=lySig(ly.draft)!==lySig(SAVED_LAYOUT);ly.selFob=null;ly.selGate=null;
    showView('layout');ly.msg=`Built from the site survey (${r.layout.geo.n} points). Check the preview, try See it in 3D, then Save layout.`;ly.err=false;lyRefresh();window.scrollTo({top:0,behavior:'smooth'});}});
$('svEd').addEventListener('submit',async e=>{e.preventDefault();if(!svCanWrite()||!sv.draft)return;const d=sv.draft,fail=m=>{sv.busy=false;sv.err=true;sv.msg=m;renderSvEd();};
  if(d.t==='gate'&&!String(d.n).trim())return fail('Type the gate number.');
  if(d.t==='entry'&&!String(d.name).trim())return fail('Type a name for the entry.');
  if(d.t==='entry'&&Object.entries(SURVEY).some(([id,p])=>id!==d.id&&p.t==='entry'&&String(p.name).trim().toLowerCase()===String(d.name).trim().toLowerCase()))return fail('Another entry already has this name. Give each entry its own name.');
  if(d.t==='pfend'&&d.end!=='sdb'&&d.end!=='nzm')return fail('Pick which end of the platform this is.');
  if(d.t==='pillar'&&!String(d.pillar).trim())return fail('Type the pillar number.');
  if(d.t==='out'){const sh=svShape(d),n=(d.pts||[]).length;if(sh==='area'&&n<3)return fail('Add at least 3 corners for an area.');if(sh==='line'&&n<2)return fail('Add at least 2 points for a line.');}
  if(d.t==='work'&&!String(d.name).trim())return fail('Say what the work is, e.g. Platform renovation.');
  if(d.t==='fob'&&!String(d.bridge).trim())return fail('Name the bridge.');
  if(d.t==='fob'&&(d.ways||[]).some(w=>w.to==='gate'&&!w.gate))return fail('Pick the gate or entry for each way that leads to a gate.');
  if(d.t==='fac'&&d.newKind&&!String(d.kindName||'').trim())return fail('Type the new kind of place, e.g. Parcel Office.');
  if(d.t==='fac'&&d.newKind&&CATS.some(c=>!isXCat(c[0])&&c[1].toLowerCase()===String(d.kindName).trim().toLowerCase()))return fail(`“${String(d.kindName).trim()}” is already in the list. Pick it under Amenity or facility.`);
  if(d.t==='fac'&&d.newKind&&!String(d.name).trim())d.name=String(d.kindName).trim();
  if(d.t==='fac'&&!String(d.name).trim())return fail('Type the name of the facility.');
  sv.busy=true;sv.err=false;sv.msg='Saving…';renderSvEd();svStopCap();
  const uid=USER?await USER.id():null,now=new Date().toISOString(),pos={lat:+d.lat.toFixed(7),lng:+d.lng.toFixed(7),acc:d.acc!=null?Math.round(d.acc):null,placed:d.placed||'gps'};
  try{if(d.t==='fac'){const ex=d.fac?FAC.find(a=>a.id===d.fac)||{}:{};const id=d.fac||('s'+Math.random().toString(36).slice(2,10));
      const q=placeFromGps(pos);const at=q&&!q.far?{area:q.area,x:q.x,y:q.y}:{};
      const fpf=d.facPf?barPf(pfBar(+d.facPf)):null;if(fpf){at.area='pl'+pfBar(fpf);at.y=PY(pfBar(fpf));if(at.x==null)at.x=500;}
      let kcat=d.cat,kname=isXCat(d.cat)&&CAT[d.cat]?CAT[d.cat].en:'';if(d.newKind){kname=String(d.kindName).trim();kcat=kindIdFor(kname);}
      const rec=Object.assign({status:'open',statusNote:''},ex,{count:cleanCount(d.count),unit:cleanCount(d.count)?(d.unit||defUnit(kcat,d.name)):'',cat:kcat,...(kname?{catName:kname}:{}),name:String(d.name).trim(),note:String(d.note||'').trim(),src:'survey',pf:fpf,pillar:fpf?String(d.pillar||'').trim():'',nearFob:fpf?svFobId(d.nearFob):''},pos,at,{updatedAt:now,updatedBy:uid||''});delete rec.id;delete rec._n;
      await DB.doc('facilities/'+id).set(rec);}
    else{let id=d.id;if(!id&&d.t==='pfend'){const ex=Object.entries(SURVEY).find(([k,p])=>p.t==='pfend'&&pfBar(+p.pf)===pfBar(+d.pf)&&p.end===d.end);if(ex)id=ex[0];}
      if(!id&&d.t==='pillar'){const ex=Object.entries(SURVEY).find(([k,p])=>p.t==='pillar'&&pfBar(+p.pf)===pfBar(+d.pf)&&String(p.pillar).trim().toLowerCase()===String(d.pillar).trim().toLowerCase());if(ex)id=ex[0];}id=id||('sv'+Math.random().toString(36).slice(2,10));const rec=Object.assign({t:d.t},pos,{at:SURVEY[id]&&SURVEY[id].at||now,updatedAt:now,by:uid||''});
      if(d.t==='gate')Object.assign(rec,{n:String(d.n).trim(),side:d.side==='A'?'A':'P',status:d.status||'open'});
      if(d.t==='out'){const sh=svShape(d),cp=sh==='point'?[]:(d.pts||[]).map(q=>[+(+q[0]).toFixed(7),+(+q[1]).toFixed(7)]);
        const c=cp.length?[cp.reduce((a,q)=>a+q[0],0)/cp.length,cp.reduce((a,q)=>a+q[1],0)/cp.length]:[pos.lat,pos.lng];
        Object.assign(rec,{color:okHex(d.color)?d.color:'',kind:RMAP.OUT[d.kind]?d.kind:'other',shape:sh,name:String(d.name||'').trim(),note:String(d.note||'').trim(),pts:cp,lat:+c[0].toFixed(7),lng:+c[1].toFixed(7)});}
      if(d.t==='work')Object.assign(rec,{color:okHex(d.color)?d.color:''});
      if(d.t==='work')Object.assign(rec,{name:String(d.name).trim(),area:d.area==='P'||d.area==='A'||d.area==='fob'?d.area:'pl',pf:d.area==='pl'?barPf(pfBar(+d.pf||1)):null,pillar:d.area==='pl'?String(d.pillar||'').trim():'',block:!!d.block,r:+d.r||20,until:d.until||'',show:d.show!==false});
      if(d.t==='entry')Object.assign(rec,{name:String(d.name).trim(),side:d.side==='A'?'A':'P',status:d.status||'open'});
      if(d.t==='pfend')Object.assign(rec,{pf:barPf(pfBar(+d.pf||1)),end:d.end});
      if(d.t==='pillar')Object.assign(rec,{pf:barPf(pfBar(+d.pf||1)),pillar:String(d.pillar).trim()});
      if(d.t==='pfpt')Object.assign(rec,{pf:barPf(pfBar(+d.pf||1))});
      if(d.t==='fob'){const ways=(d.ways||[]).map(w=>({to:w.to,pf:w.to==='pf'?barPf(pfBar(+w.pf||1)):null,gate:w.to==='gate'?String(w.gate):'',side:w.to==='gate'?'':(w.side||''),stairs:!!w.stairs,lift:!!w.lift,esc:!!w.esc}));const w0=ways[0]||{};
        Object.assign(rec,{bridge:String(d.bridge).trim(),seq:+d.seq||1,from:d.from&&d.from!==id&&SURVEY[d.from]?d.from:'',links:[...new Set((d.links||[]).filter(t=>t!==id&&SURVEY[t]))],ways,to:w0.to||'',pf:w0.pf||null,gate:w0.gate||'',stairs:!!w0.stairs,lift:!!w0.lift,esc:!!w0.esc});}
      await DB.doc('survey/'+id).set(rec);}
    sv.lastType=d.t;if(d.t==='fob')sv.lastBridge=String(d.bridge).trim();if(d.pf&&(d.t==='pfend'||d.t==='pillar'||d.t==='fob'))sv.lastPf=d.pf;
    sv.draft=null;sv.busy=false;sv.msg='';renderSvEd();svDrawMap();svScheduleAuto();const pm=$('svMsg');if(pm){pm.textContent='Point saved.';pm.className='msg okm';}}
  catch(err){fail(`Couldn't save: ${(err&&err.message)||(err&&err.code)||'error'}.`);}});
$('svAddGps').addEventListener('click',svGpsAdd);
$('svAddTap').addEventListener('click',()=>{sv.tapAdd=!sv.tapAdd;renderSurvey();});
$('svLocate').addEventListener('click',()=>svLocate());
document.querySelector('.svlayers').addEventListener('click',e=>{const b=e.target.closest('[data-svl]');if(b)svSetLayer(b.dataset.svl);});
document.querySelectorAll('[data-svl]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.svl===sv.layer));

// ================= PHOTOS ADMIN =================
function pkLabel(k){if(!k)return '';if(k.startsWith('n-'))return N[k.slice(2)]?where(k.slice(2)):'Station spot';
  if(k.startsWith('f-')){const a=FAC.find(x=>x.id===k.slice(2));return a?`${a.name} · entrance (${facWhere(a)})`:'Facility';}
  if(k.startsWith('qr-')){const p=getPt(k.slice(3));return p?`QR point · ${p.name} (${areaLabel(p.area)})`:'QR point';}return k;}
function pkFrom(k){if(k.startsWith('n-'))return k.slice(2);if(k.startsWith('qr-')){const p=getPt(k.slice(3));if(!p)return null;const q=ptXY(p);return nearestBase(p.area,q.x,q.y);}return null;}
function pkTokens(k){if(k.startsWith('f-'))return ['here'];
  if(k.startsWith('qr-')){const p=getPt(k.slice(3));if(!p)return [];const q=ptXY(p),cand=nearestBase(p.area,q.x,q.y),t=isVert(p.area)?['toA','toP']:['north','south'];
    if(Math.abs(N[cand].x-q.x)+Math.abs(N[cand].y-q.y)<25)ADJ[cand].forEach(e=>{if(N[e.b].ctx!==N[cand].ctx&&!t.includes('go:'+e.b))t.push('go:'+e.b);});return t;}
  const id=k.slice(2);if(!ADJ[id])return [];const t=[];ADJ[id].forEach(e=>{const x=edgeTok(id,e.b);if(!t.includes(x))t.push(x);});return t;}
function tokLabel(t,from){if(t==='north')return 'Straight on (rightwards on the station map)';if(t==='south')return 'Straight on (leftwards on the station map)';
  if(t==='toA')return 'Across the bridge, towards Ajmeri Gate side';if(t==='toP')return 'Across the bridge, towards Paharganj side';if(t==='here')return 'The entrance itself';
  if(t.startsWith('go:')){const b=t.slice(3),fb=N[b];if(!fb)return t;const e=from&&ADJ[from]?ADJ[from].find(x=>x.b===b):null,kind=e?e.kind:'enter';
    if(kind==='enter')return fb.ctx.startsWith('pl')?`Onto ${platLabel(fb.p)}`:`Off the platform to the ${sideName(fb.ctx)} concourse`;
    const up=fb.ctx.startsWith('f')&&!(N[from]||{ctx:''}).ctx.startsWith('f');const what=kind==='lift'?'Lift':kind==='esc'?'Escalator':'Stairs';
    return `${what} ${up?'up to '+fobName(fb.ctx):'down to '+where(b)}`;}return t;}
const phCanWrite=()=>!!DB&&!!ASSETS&&CAN_EDIT&&PH_SOURCE!=='error';
function setPhMsg(t,err){const m=$('phMsg');m.textContent=t||'';m.className='msg'+(err?' err':' okm');}
function routeStepKey(s,i){return s.fac&&i===STEPS.length-1?'f-'+s.fac:photoKey(s.at);}
function renderPhotos(){if(VIEW!=='photos')return;
  const n=$('phNotice');let h='';
  if(!DB)h="<span>Photos can't be saved in this view because the database isn't available.</span>";
  else if(!ASSETS)h="<span>Photo uploads need staff sign-in and a photo store. Check the Supabase keys in the deployment settings.</span>";
  else if(PH_SOURCE==='error')h='<span>The photo database stopped responding. Reload the page to try again.</span>';
  n.innerHTML=h;n.hidden=!h;
  const all=Object.values(PHOTOS),withArrow=all.filter(p=>(p.hotspots||[]).length).length;
  const cover=STEPS.filter(s=>stepPhoto(s)).length,qrHave=QRPTS.filter(p=>PHOTOS['qr-'+p.id]).length;
  $('phCounts').innerHTML=`<div class="count"><b>${all.length}</b><span>Photos added</span></div><div class="count c-ok"><b>${withArrow}</b><span>With direction markers</span></div><div class="count"><b>${cover}/${STEPS.length}</b><span>Steps on this route</span></div><div class="count"><b>${qrHave}/${QRPTS.length}</b><span>QR points photographed</span></div>`;
  drawMap($('phMap'),{photoPick:true,qrs:QRPTS});
  const pt=getPt(state.scan),dest=ALL().find(a=>a.id===state.dest);
  $('phRouteName').textContent=pt&&dest?`${pt.name} → ${dest.name}. Change the route in the Passenger tab.`:'Pick a destination in the Passenger tab.';
  $('phRouteCount').textContent=STEPS.length?`${cover} of ${STEPS.length} have photos`:'';
  $('phRows').innerHTML=STEPS.map((s,i)=>{const sp=stepPhoto(s),key=sp?sp.ph.key:routeStepKey(s,i);const cls=sp?(sp.hs||!s.tok?'good':'fair'):'none';
    const txt=sp?(sp.hs?'Photo + marker':s.tok?'No marker for this way':'Photo'):'No photo';
    return `<div class="row prow"><span class="num${i===0?' n-start':i===STEPS.length-1?' n-end':''}">${i+1}</span><div><div class="n">${esc(s.t)}</div><div class="w">${esc(pkLabel(key))}</div></div>
      <div class="actions"><span class="pill ${cls}">${txt}</span>${CAN_EDIT?`<button class="btn sm" type="button" data-phk="${esc(key)}" data-tok="${esc(s.tok||'')}">${PHOTOS[key]?'Edit':'Add photo'}</button>`:''}</div></div>`;}).join('')||'<p class="empty">No steps yet.</p>';renderNeed();}
// ---- "Photos still needed": every spot the passenger navigation can show a photo for, in walking order ----
const NEED={f:'need',t:'route'};
function needSpots(){const out=[],seen={};
  const add=(key,o)=>{if(seen[key])return seen[key];seen[key]=Object.assign({key},o);out.push(seen[key]);return seen[key];};
  const kindTxt=ks=>[...ks].map(k=>k==='lift'?'lift':k==='esc'?'escalator':'stairs').join(' / ');
  const grp=id=>{const n=N[id],c=n.ctx;if(c==='P')return {g:'Paharganj side concourse',o:0};if(c==='A')return {g:'Ajmeri Gate side concourse',o:30};
    if(isFob(c))return {g:fobName(c),o:1+(FOBS.findIndex(f=>f.id===c)+1)/100};if(/^pl\d$/.test(c))return {g:platLabel(+c.slice(2)),o:10+(+c.slice(2))};return {g:'Other',o:40};};
  // stairs, lifts and escalators: one photo at the foot, one at the top
  Object.keys(ADJ).forEach(a=>(ADJ[a]||[]).forEach(e=>{if(!/^(stairs|lift|esc)$/.test(e.kind)||!N[a]||!N[e.b])return;
    const top=isFob(N[a].ctx)&&!isFob(N[e.b].ctx),foot=!isFob(N[a].ctx)&&isFob(N[e.b].ctx);if(!top&&!foot)return;
    const gr=grp(a),sp=add('n-'+a,Object.assign({type:'access',id:a,ks:new Set(),to:e.b,x:N[a].x},gr));sp.ks.add(e.kind);
    sp.label=top?`Top of the ${kindTxt(sp.ks)} down to ${where(sp.to)}`:`Foot of the ${kindTxt(sp.ks)} up to ${fobName(N[sp.to].ctx)}`;
    sp.sub=top?`On ${fobName(N[a].ctx)} · face the way down`:`${where(a)} · face the ${kindTxt(sp.ks)}`;
    try{sp.sug=edgeTok(a,sp.to);}catch(_){sp.sug='';}}));
  // gates (inside the station, facing out)
  Object.keys(gateAt).forEach(id=>{if(!N[id])return;add('n-'+id,Object.assign({type:'gate',id,x:N[id].x,label:`${gateAt[id]} · from inside, facing the gate`,sub:where(id),sug:''},grp(id)));});
  // ways from the concourse onto Platform 1 / Platform 16
  Object.keys(ADJ).forEach(a=>{const n=N[a];if(!n||(n.ctx!=='P'&&n.ctx!=='A'))return;(ADJ[a]||[]).forEach(e=>{if(e.kind!=='enter'||!N[e.b])return;
    add('n-'+a,Object.assign({type:'entry',id:a,x:n.x,label:`Way onto ${platLabel(N[e.b].p)}`,sub:where(a)+' · face the platform',sug:(()=>{try{return edgeTok(a,e.b);}catch(_){return '';}})()},grp(a)));});});
  // QR boards: the first photo of every route started there
  QRPTS.forEach(p=>add('qr-'+p.id,{type:'qr',g:'QR boards',o:50,x:0,label:p.name,sub:`QR ${p.id.toUpperCase()} · ${areaLabel(p.area)} · stand at the board, face the station`,sug:''}));
  // facility entrances: the last photo of a route
  FAC.filter(a=>a._n||hasLL(a)).forEach(a=>add('f-'+a.id,{type:'fac',g:(CAT[a.cat]?CAT[a.cat].en:'Facilities'),o:60,x:0,label:a.name,sub:facWhere(a)+' · photo of the entrance',sug:'here',nm:a.name}));
  out.forEach(sp=>{const ph=PHOTOS[sp.key];sp.st=!ph||!ph.assetId?'none':(ph.hotspots||[]).length||sp.type==='fac'?'good':'fair';});
  return out;}
function renderNeed(){if(VIEW!=='photos')return;
  if(!$('phNeed')){const host=document.querySelector('#v-photos .grid.admin');if(!host)return;
    host.insertAdjacentHTML('afterend',`<section class="panel need" id="phNeed" aria-labelledby="h-need"><p class="label" id="h-need">Photos still needed <span class="hi">Work through it on one walk: top to bottom follows the station</span></p>
      <div class="need-bar"><div class="need-prog"><i id="needProg"></i></div><b id="needCount"></b></div>
      <div class="need-ctl"><div class="seg" role="group" aria-label="Which spots">${[['route','Route points'],['qr','QR boards'],['fac','Facilities']].map(([k,t])=>`<button type="button" data-nt="${k}">${t}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="Show">${[['need','Still needed'],['fair','No arrow yet'],['good','Done'],['all','All']].map(([k,t])=>`<button type="button" data-nf="${k}">${t}</button>`).join('')}</div></div>
      <div id="needList"></div></section>`);
    $('phNeed').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
      if(b.dataset.nt){NEED.t=b.dataset.nt;renderNeed();}else if(b.dataset.nf){NEED.f=b.dataset.nf;renderNeed();}
      else if(b.dataset.nk){openPhEd(b.dataset.nk,b.dataset.sug||'');}});}
  const all=needSpots(),pick=NEED.t==='route'?all.filter(s=>s.type==='access'||s.type==='gate'||s.type==='entry'):all.filter(s=>s.type===NEED.t);
  const done=pick.filter(s=>s.st==='good').length,noArr=pick.filter(s=>s.st==='fair').length;
  $('needProg').style.width=(pick.length?done/pick.length*100:0)+'%';
  $('needCount').textContent=`${done} of ${pick.length} done${noArr?` · ${noArr} need an arrow`:''}`;
  $('phNeed').querySelectorAll('[data-nt]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.nt===NEED.t));
  $('phNeed').querySelectorAll('[data-nf]').forEach(b=>{const k=b.dataset.nf,n=k==='all'?pick.length:k==='need'?pick.filter(s=>s.st==='none').length:pick.filter(s=>s.st===k).length;b.setAttribute('aria-pressed',k===NEED.f);b.textContent=b.textContent.replace(/ \(\d+\)$/,'')+` (${n})`;});
  const show=pick.filter(s=>NEED.f==='all'||(NEED.f==='need'?s.st==='none':s.st===NEED.f)).sort((a,b)=>a.o-b.o||(a.type==='fac'||a.type==='qr'?a.label.localeCompare(b.label):a.x-b.x));
  if(!show.length){$('needList').innerHTML=`<p class="empty">${NEED.f==='need'?'Nothing left here. Every spot has a photo.':'No spots in this list.'}</p>`;return;}
  const pillTxt={none:'Needed',fair:'Photo, no arrow',good:'Done'};let lastG='',n=0;
  $('needList').innerHTML=show.map(s=>{const head=s.g!==lastG?`<p class="need-g">${esc(s.g)}</p>`:'';lastG=s.g;n++;
    return `${head}<div class="row prow"><span class="num">${n}</span><div><div class="n">${esc(s.label)}</div><div class="w">${esc(s.sub||'')}</div></div>
      <div class="actions"><span class="pill ${s.st}">${pillTxt[s.st]}</span>${CAN_EDIT?`<button class="btn sm${s.st==='none'?' primary':''}" type="button" data-nk="${esc(s.key)}" data-sug="${esc(s.sug||'')}">${s.st==='none'?'Add photo':s.st==='fair'?'Add arrow':'Edit'}</button>`:''}</div></div>`;}).join('');}
$('phMap').addEventListener('click',e=>{const t=e.target.closest('[data-pk]');if(t&&CAN_EDIT)openPhEd(t.dataset.pk,'');});
$('phRows').addEventListener('click',e=>{const b=e.target.closest('[data-phk]');if(b)openPhEd(b.dataset.phk,b.dataset.tok);});
const pe={key:null};
function openPhEd(key,sug){const ex=PHOTOS[key];
  Object.assign(pe,{key,blob:null,url:ex&&ex.assetId?blobUrl(ex.assetId):null,w:ex?ex.w||0:0,h:ex?ex.h||0:0,hs:ex?(ex.hotspots||[]).map(h=>({x:h.x,y:h.y,to:h.to})):[],cap:ex?ex.caption||'':'',busy:false,msg:'',err:false,confirmDel:false,sug:sug||''});
  renderPhEd();$('phSheet').hidden=false;}
function closePhEd(){if(pe.blob&&pe.url)URL.revokeObjectURL(pe.url);$('phSheet').hidden=true;pe.key=null;}
function renderPhEd(){const toks=pkTokens(pe.key),from=pkFrom(pe.key),ro=!phCanWrite(),ex=PHOTOS[pe.key];
  $('phEd').innerHTML=`<h3 id="phEdTitle">${ex?'Edit photo':'Add photo'}</h3><p class="sub">${esc(pkLabel(pe.key))}</p>
  <form class="form" id="phForm" novalidate>
    ${pe.url?`<div class="phimg" id="phImg" title="Tap to add a marker"><img src="${esc(pe.url)}" alt="Photo of this spot">${pe.hs.map((h,i)=>`<span class="hs" style="left:${h.x}%;top:${h.y}%"><b>${i+1}</b></span>`).join('')}</div>
      <div class="actions"><label class="btn sm" for="phFile">Replace photo</label><span class="msg">Tap the photo where passengers should head, then pick which way that is.</span></div>`
     :`<label class="drop" for="phFile"><b>Take or choose a photo</b><span>Stand here facing the way passengers walk. Hold the phone level at eye height, landscape works best.</span></label>`}
    <input class="vh" type="file" id="phFile" accept="image/*" capture="environment" ${ro?'disabled':''}>
    ${pe.hs.length?`<div class="form" style="gap:6px">${pe.hs.map((h,i)=>`<div class="hrow"><span class="hnum">${i+1}</span><select data-hsel="${i}" aria-label="Direction for marker ${i+1}" ${ro?'disabled':''}><option value="">Which way is this?</option>${toks.map(t=>`<option value="${esc(t)}" ${t===h.to?'selected':''}>${esc(tokLabel(t,from))}</option>`).join('')}</select><button class="btn sm" type="button" data-hdel="${i}" ${ro?'disabled':''}>Remove</button></div>`).join('')}</div>`:''}
    <div class="field"><label for="phCap">What to look for <small>(optional)</small></label><input id="phCap" value="${esc(pe.cap)}" placeholder="e.g. Escalator beside the Food Plaza" ${ro?'disabled':''}></div>
    ${pe.confirmDel?`<div class="confirm"><span>Delete this photo? Passengers will no longer see it on this step.</span><div class="actions"><button class="btn danger" type="button" id="phDelYes">Delete</button><button class="btn" type="button" id="phDelNo">Keep it</button></div></div>`:''}
    <div class="actions"><button class="btn primary" type="submit" ${ro||pe.busy?'disabled':''}>Save photo</button><button class="btn" type="button" id="phCancel">Cancel</button>
      ${ex&&!pe.confirmDel?`<button class="btn danger" type="button" id="phDel" ${ro?'disabled':''}>Delete photo</button>`:''}
      <span class="msg${pe.err?' err':''}" role="status">${esc(pe.msg)}</span></div>
  </form>`;}
function shrink(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{const s=Math.min(1,1600/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*s);c.height=Math.round(im.naturalHeight*s);
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(b=>b?res({blob:b,w:c.width,h:c.height}):rej(new Error('encode')),'image/jpeg',.82);};
  im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('decode'));};im.src=u;});}
$('phSheet').addEventListener('change',async e=>{const t=e.target;
  if(t.id==='phFile'&&t.files&&t.files[0]){pe.msg='Preparing photo…';pe.err=false;renderPhEd();
    try{const r=await shrink(t.files[0]);if(pe.blob&&pe.url)URL.revokeObjectURL(pe.url);pe.blob=r.blob;pe.w=r.w;pe.h=r.h;pe.url=URL.createObjectURL(r.blob);pe.hs=[];pe.msg='';}
    catch(err){pe.err=true;pe.msg="Couldn't read that photo. Try a JPG or PNG.";}renderPhEd();}
  else if(t.dataset.hsel!=null)pe.hs[+t.dataset.hsel].to=t.value;});
$('phSheet').addEventListener('input',e=>{if(e.target.id==='phCap')pe.cap=e.target.value;});
$('phSheet').addEventListener('click',async e=>{const t=e.target;if(t.id==='phSheet'){closePhEd();return;}
  const img=t.closest&&t.closest('#phImg');
  if(img&&phCanWrite()){const r=img.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*100,y=(e.clientY-r.top)/r.height*100;const toks=pkTokens(pe.key);
    let to=pe.sug&&toks.includes(pe.sug)&&!pe.hs.some(h=>h.to===pe.sug)?pe.sug:(toks.length===1?toks[0]:'');
    pe.hs.push({x:Math.max(0,Math.min(100,x)),y:Math.max(0,Math.min(100,y)),to});pe.msg='';renderPhEd();return;}
  if(t.dataset.hdel!=null){pe.hs.splice(+t.dataset.hdel,1);renderPhEd();}
  else if(t.id==='phCancel')closePhEd();
  else if(t.id==='phDel'){pe.confirmDel=true;renderPhEd();}
  else if(t.id==='phDelNo'){pe.confirmDel=false;renderPhEd();}
  else if(t.id==='phDelYes'){const ex=PHOTOS[pe.key];pe.busy=true;
    try{await DB.doc('photos/'+pe.key).delete();if(ex&&ex.assetId&&ASSETS){try{await ASSETS.delete(ex.assetId);}catch(_){}}const l=pkLabel(pe.key);closePhEd();setPhMsg(`Deleted the photo for ${l}.`);}
    catch(err){pe.busy=false;pe.confirmDel=false;pe.err=true;pe.msg=`Couldn't delete (${(err&&err.code)||'error'}).`;renderPhEd();}}});
$('phSheet').addEventListener('submit',async e=>{e.preventDefault();if(!phCanWrite())return;const ex=PHOTOS[pe.key];
  const fail=m=>{pe.busy=false;pe.err=true;pe.msg=m;renderPhEd();};
  if(!pe.url)return fail('Add a photo first.');if(pe.hs.some(h=>!h.to))return fail('Pick a direction for every marker, or remove it.');
  pe.busy=true;pe.err=false;pe.msg=pe.blob?'Uploading…':'Saving…';renderPhEd();
  try{let assetId=ex?ex.assetId:null;if(pe.blob){const r=await ASSETS.upload(pe.blob,{type:'image/jpeg'});assetId=r.id;}
    const uid=USER?await USER.id():null;
    await DB.doc('photos/'+pe.key).set({assetId,w:pe.w,h:pe.h,caption:pe.cap.trim(),hotspots:pe.hs.map(h=>({x:Math.round(h.x*100)/100,y:Math.round(h.y*100)/100,to:h.to})),label:pkLabel(pe.key),updatedAt:new Date().toISOString(),updatedBy:uid||''});
    if(pe.blob&&ex&&ex.assetId&&ex.assetId!==assetId){try{await ASSETS.delete(ex.assetId);}catch(_){}}
    const l=pkLabel(pe.key);closePhEd();setPhMsg(`Saved the photo for ${l}.`);}
  catch(err){const c=err&&err.code;fail(c==='invalid_argument'?"You don't have permission to change photos.":/large/.test(c||'')?'That photo is too large. Try a smaller one.':`Couldn't save (${c||'error'}). Try again.`);}});

// ================= REAL MAP (staff) and LIVE MAP (passengers) =================
// Both draw the station at its surveyed GPS positions (lib/realmap.js). Map units → GPS uses the survey frame in LAYOUT.geo.
function mapToLL(x,y){const g=LAYOUT&&LAYOUT.geo;if(!g||!g.a)return null;const [oe,on]=geoEN(g.o[0],g.o[1]);
  const u=(x-g.cx)/g.kx,v=(y-120)/g.ky+g.v0,E=u*g.a[0]-v*g.a[1],Nn=u*g.a[1]+v*g.a[0];return [(Nn+on)/MLAT+NDLS_C.lat,(E+oe)/MLNG+NDLS_C.lng];}
function nodeLL(id){const n=N[id];return n?mapToLL(n.x,n.y):null;}
const rmHelpers=()=>({pfBar,platLabel,gateText:n=>gateText(n),endName:e=>svEndName(e),boundary:autoBoundary(),walks:walkNet()});
// ---- the station building outline: staff-drawn (survey, kind "station") or worked out from the survey ----
let BND=null,BND_SIG='';
function autoBoundary(){const sig=Object.keys(SURVEY).length+'|'+LAYOUT_REV+'|'+FAC.length;if(BND&&BND_SIG===sig)return BND;BND_SIG=sig;
  const svp=Object.values(SURVEY).filter(q=>hasLL(q)&&['pfend','pfpt','fob'].includes(q.t)).map(q=>[+q.lat,+q.lng]);if(svp.length<3)return BND=null;
  const close=ll=>svp.some(q=>RMAP.metres(q,ll)<120);
  const pts=svp.slice();
  Object.values(SURVEY).forEach(q=>{if(q.t==='gate'&&hasLL(q)&&close([+q.lat,+q.lng]))pts.push([+q.lat,+q.lng]);});
  FAC.forEach(a=>{if(!hasLL(a)||a.pf)return;const t=facTrue(a);if(t&&!t.out&&close([a.lat,a.lng]))pts.push([+a.lat,+a.lng]);});
  // convex hull on a flat frame, then pushed out 8 m so the outline sits just outside walls and platform ends
  const o=pts[0],kx=111320*Math.cos(o[0]*Math.PI/180),ky=111320,P=pts.map(p=>[(p[1]-o[1])*kx,(p[0]-o[0])*ky]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(O,A,B)=>(A[0]-O[0])*(B[1]-O[1])-(A[1]-O[1])*(B[0]-O[0]),lo=[],up=[];
  P.forEach(p=>{while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);});
  for(let i=P.length-1;i>=0;i--){const p=P[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}
  const H=lo.slice(0,-1).concat(up.slice(0,-1));if(H.length<3)return BND=null;
  const c=H.reduce((s,p)=>[s[0]+p[0]/H.length,s[1]+p[1]/H.length],[0,0]);
  return BND=H.map(p=>{const dx=p[0]-c[0],dy=p[1]-c[1],L=Math.hypot(dx,dy)||1;const x=p[0]+dx/L*8,y=p[1]+dy/L*8;return [o[0]+y/ky,o[1]+x/kx];});}
function stationBuildings(){return Object.values(SURVEY).filter(q=>q.t==='out'&&q.kind==='stationbldg'&&Array.isArray(q.pts)&&q.pts.length>=3).map(q=>q.pts);}
function stationOutlines(){const drawn=Object.values(SURVEY).filter(q=>q.t==='out'&&q.kind==='station'&&Array.isArray(q.pts)&&q.pts.length>=3).map(q=>q.pts);if(drawn.length)return drawn;const a=autoBoundary();return a?[a]:[];}
// walking paths of the station (every link of the route network on the ground and on the bridges)
function walkNet(){const out=[],seen=new Set();Object.keys(ADJ).forEach(id=>{const n=N[id];if(!n||n.virt||id.startsWith('fac_')||id==='__pin')return;
  (ADJ[id]||[]).forEach(e=>{const m=N[e.b];if(!m||m.virt||e.b.startsWith('fac_')||e.b==='__pin'||/stairs|lift|esc/.test(e.kind))return;const k=[id,e.b].sort().join('|');if(seen.has(k))return;seen.add(k);
    // only the part that really exists: platforms between their surveyed ends, concourses along the building
    let ax=n.x,bx=m.x;const c=n.ctx===m.ctx?n.ctx:null;if(c&&!isFob(c)){const RS=realStation(),r=/^pl\d$/.test(c)?RS.pf[+c.slice(2)]:RS.xr[c];if(r){const lo=Math.min(ax,bx),hi=Math.max(ax,bx);if(hi<r[0]||lo>r[1])return;ax=Math.max(r[0],Math.min(r[1],ax));bx=Math.max(r[0],Math.min(r[1],bx));}}
    const a=mapToLL(ax,n.y),b=mapToLL(bx,m.y);if(a&&b&&RMAP.metres(a,b)>.5)out.push([a,b]);});});return out;}
function rmFacs(destId,rich){return FAC.filter(a=>hasLL(a)||a._n).map(a=>{const ll=hasLL(a)?[a.lat,a.lng]:nodeLL(a._n);if(!ll)return null;
  const o={id:a.id,ll,count:countText(a),code:CAT[a.cat]?CAT[a.cat].code||'•':'•',name:a.name,open:isOpen(a),where:facWhere(a),dest:a.id===destId};
  // passenger map: a coloured icon per amenity (like a mall map); the chosen kind stands out, the others shrink to dots
  if(rich){o.html=`<i class="ic" style="background:${catColor(a.cat)}">${catIcon(a.cat)}</i><span>${esc(a.name)}${facHi(a)?`<small>${esc(facHi(a))}</small>`:''}</span>`;o.cls='rm-ic'+(state.cat?(a.cat===state.cat?' on':' dim'):'');}
  return o;}).filter(Boolean);}
function rmSetup(L,el,base){const map=L.map(el,{zoomControl:true,attributionControl:true,maxZoom:21,zoomSnap:.25,wheelPxPerZoomLevel:90}).setView([NDLS_C.lat,NDLS_C.lng],17);
  const bases=RMAP.baseLayers(L);bases[base].addTo(map);el.classList.toggle('rm-plain',base==='Plain plan');
  map.on('baselayerchange',e=>{el.classList.toggle('rm-plain',e.name==='Plain plan');try{localStorage.setItem('wf-rm-base-'+el.id,e.name);}catch(_){}});
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
  const zoomCls=()=>{const z=map.getZoom();el.classList.toggle('rm-z17',z>=17.5);el.classList.toggle('rm-z18',z>=18);el.classList.toggle('rm-z19',z>=19);el.classList.toggle('rm-z20',z>=20);};map.on('zoomend',zoomCls);zoomCls();
  return {map,bases};}
const RMV={ly:null,live:null};
function rmDraw(st,model,opts,overNames){const L=sv.L;if(st.groups)Object.values(st.groups).forEach(g=>st.map.removeLayer(g));
  st.groups=RMAP.drawModel(L,model,opts);const order=['outside','platforms','works','bridges','pillars','amenities','gates','labels'];order.forEach(k=>st.groups[k].addTo(st.map));
  if(st.ctl)st.map.removeControl(st.ctl);
  const ov={};Object.entries(overNames).forEach(([k,n])=>{ov[n]=st.groups[k];});st.ctl=L.control.layers(st.bases,ov,{collapsed:true,position:'topright'}).addTo(st.map);}
function rmInfoHtml(info){return `<button type="button" class="rm-x" aria-label="Close">✕</button><b>${esc(info.title)}</b>${info.rows.map(([k,v])=>`<div class="rm-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}`;}

// ---- staff: Station layout → Real map ----
let LY_VIEW='diagram';try{if(localStorage.getItem('wf-ly-view')==='real')LY_VIEW='real';}catch(_){}
function lyViewsInit(){const sec=$('v-layout');if(!sec||$('lyViews'))return;const grid=$('lyMap').closest('.grid');
  grid.insertAdjacentHTML('beforebegin',`<div class="lyviews"><div class="seg" id="lyViews" role="group" aria-label="Station layout view"><button type="button" data-lyv="real">Real map</button><button type="button" data-lyv="diagram">Diagram &amp; editor</button></div><span class="msg" id="lyViewNote"></span></div>
    <div id="lyReal" hidden><div class="rm-grid"><section class="panel rm-panel"><div class="rm-box" id="rmLyBox"><div id="rmLyMap" class="rm-map"></div><div class="rm-info" id="rmLyInfo" hidden></div></div>
      <div class="rm-legend">${[['plat','Platform'],['fob','Foot over bridge'],['way','Stairs / lift / escalator'],['gate','Gate'],['entry','Station entry'],['am','Amenity'],['work','Construction'],['park','Parking'],['road','Road']].map(([c,t])=>`<span class="lg lg-${c}"><i></i>${t}</span>`).join('')}</div></section>
      <section class="panel"><p class="label" style="margin:0 0 8px">Measured from the site survey <span class="hi">true lengths</span></p><div id="rmLyMeas"></div>
      <p class="msg" style="margin-top:12px">Everything here is drawn from the GPS points recorded in <b>Site survey</b>. To change a shape or length, edit the points there; this map updates by itself. Tap any platform, bridge, gate or area for details.</p></section></div></div>`);
  $('lyViews').addEventListener('click',e=>{const b=e.target.closest('[data-lyv]');if(!b)return;LY_VIEW=b.dataset.lyv;try{localStorage.setItem('wf-ly-view',LY_VIEW);}catch(_){}lyViewApply();});
  $('rmLyInfo').addEventListener('click',e=>{if(e.target.closest('.rm-x'))$('rmLyInfo').hidden=true;});
  addFs($('rmLyBox'));lyViewApply();}
function lyViewApply(){const grid=$('lyMap').closest('.grid'),real=LY_VIEW==='real';grid.hidden=real;$('lyReal').hidden=!real;
  document.querySelectorAll('[data-lyv]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.lyv===LY_VIEW));
  $('lyViewNote').textContent=real?'Drawn at the true positions recorded in the site survey.':'Simplified diagram used for directions. Edit gates and bridges here.';
  if(real)renderRealLy();}
async function renderRealLy(){if(VIEW!=='layout'||LY_VIEW!=='real')return;const L=await svLoad();if(!L){$('rmLyMeas').innerHTML='<p class="msg err">The map couldn\'t load. Check the connection.</p>';return;}
  let st=RMV.ly;if(!st){let base='Satellite';try{base=localStorage.getItem('wf-rm-base-rmLyMap')||base;}catch(_){}
    const s=rmSetup(L,$('rmLyMap'),RMAP.baseLayers(L)[base]?base:'Satellite');st=RMV.ly=Object.assign(s,{groups:null,ctl:null,fitted:false});}
  const model=RMAP.buildModel(SURVEY,rmHelpers());
  rmDraw(st,model,{staff:true,facilities:rmFacs(),onPick:info=>{const b=$('rmLyInfo');b.innerHTML=rmInfoHtml(info);b.hidden=false;}},
    {outside:'Outside the station',platforms:'Platforms',bridges:'Foot over bridges',gates:'Gates & entries',pillars:'Pillar numbers',amenities:'Amenities',works:'Construction',labels:'Labels'});
  $('rmLyMeas').innerHTML=RMAP.measurementsHtml(model);
  if(!st.fitted&&model.bounds.length>1){st.fitted=true;const so=stationOutlines()[0];st.map.fitBounds(L.latLngBounds(so&&so.length>=3?so:model.bounds).pad(.03),{maxZoom:19.5});}
  setTimeout(()=>st.map.invalidateSize(),60);}

// ---- passengers: Live map that follows the phone's GPS ----
const LV={route:null,line:[],cum:[],stepEnd:[],watch:null,me:null,follow:true,heading:null,cur:0,started:false,key:''};
let LAST_ROUTE=null;
async function openArView(){const r=LAST_ROUTE;if(!r||!r.dest){alert('Pick a destination first.');return;}
  const lr=liveRouteFromState(r.start,r.edges,r.dest);if(!lr||lr.line.length<2){alert('AR needs the surveyed station layout. Use the 3D walk or the steps for now.');return;}
  const pt=getPt(state.scan)||{};const h=lr.ids.map(id=>N[id]&&isFob(N[id].ctx)?HF:0);
  const {openAR}=await import('./ar');W.playing=false;stopLoop();
  openAR({line:lr.line,h,steps:STEPS.map(s=>({t:s.t,s:s.s})),stepEnd:lr.stepEnd,dest:{name:r.dest.name},start:{name:pt.name||'the QR board',head:typeof pt.head==='number'?pt.head:null}});}
function liveInit(){if($('wrapLive'))return;const ms=document.querySelector('.modesw');
  if(ms&&!$('arBtn')){ms.insertAdjacentHTML('afterend','<div class="navrow"><button type="button" class="btn navbtn" id="navBtn" hidden><span>▶</span> Navigate · नेविगेट करें</button><button type="button" class="btn sm arbtn" id="arBtn" hidden>📷 AR view</button></div>');$('arBtn').addEventListener('click',openArView);$('navBtn').addEventListener('click',openNavView);}
  if(ms&&!ms.querySelector('[data-mode="live"]'))ms.insertAdjacentHTML('beforeend','<button type="button" data-mode="live" aria-pressed="false">Live map</button>');
  $('wrapMap').insertAdjacentHTML('afterend',`<div id="wrapLive" hidden><div class="live-box" id="liveBox"><div id="liveMap" class="rm-map live-map"></div>
      <div class="live-banner" id="liveBanner" role="status" aria-live="polite"><span class="lb-ic" id="lbIc">↑</span><div><b id="lbT">Route ready</b><span id="lbS"></span></div></div>
      <div class="live-ctl"><button type="button" class="btn primary" id="liveStart">Start live navigation</button><button type="button" class="btn sm" id="liveCenter" hidden>⌖ Re-centre</button></div>
      <div class="rm-info" id="liveInfo" hidden></div></div>
    <p class="msg live-note" id="liveNote">Tap ▶ Navigate: the arrow moves with your steps. Tap ✓ at each stairs or turn, or scan any QR board, to correct it. Check the platform signs and the steps below.</p></div>`);
  $('liveStart').addEventListener('click',()=>{if(LAST_ROUTE&&LAST_ROUTE.edges&&LAST_ROUTE.edges.length)openNavView();else liveStart();});$('liveCenter').addEventListener('click',()=>{LV.follow=true;$('liveCenter').hidden=true;if(LV.me&&RMV.live)RMV.live.map.setView([LV.me.lat,LV.me.lng],Math.max(RMV.live.map.getZoom(),18.5));});
  $('liveInfo').addEventListener('click',e=>{if(e.target.closest('.rm-x'))$('liveInfo').hidden=true;});addFs($('liveBox'));}
function liveRouteFromState(start,edges,dest){const ids=[start,...(edges||[]).map(e=>e.b)].filter(id=>N[id]);
  const line=ids.map(nodeLL);if(line.some(x=>!x))return null;
  const pt=getPt(state.scan),near=(q,i)=>RMAP.metres(q,line[i])<45;if(pt&&hasLL(pt)&&near([pt.lat,pt.lng],0))line[0]=[pt.lat,pt.lng];if(dest&&hasLL(dest)&&dest.cat!=='platform'&&near([dest.lat,dest.lng],line.length-1))line[line.length-1]=[dest.lat,dest.lng];
  const cum=[0];for(let i=1;i<line.length;i++)cum.push(cum[i-1]+RMAP.metres(line[i-1],line[i]));
  const stepEnd=STEPS.map(s=>{const last=(s.pts||[]).slice(-1)[0];const i=ids.lastIndexOf(last);return i>=0?cum[i]:cum[cum.length-1];});
  return {ids,line,cum,stepEnd,total:cum[cum.length-1],dest};}
async function renderLive(start,edges,dest,key){liveInit();if(MODE!=='live')return;const L=await svLoad();
  if(!L){$('lbT').textContent="The map couldn't load";$('lbS').textContent='Use the steps below.';return;}
  if(!LAYOUT||!LAYOUT.geo){$('lbT').textContent='Live map not ready yet';$('lbS').textContent='Staff need to finish the site survey first. Use the 3D walk or the steps below.';$('liveStart').hidden=true;return;}
  let st=RMV.live;if(!st){let base='Street map';try{base=localStorage.getItem('wf-rm-base-liveMap')||base;}catch(_){}
    const s=rmSetup(L,$('liveMap'),RMAP.baseLayers(L)[base]?base:'Street map');st=RMV.live=Object.assign(s,{groups:null,ctl:null,rl:null});
    st.map.on('dragstart',()=>{if(LV.started){LV.follow=false;$('liveCenter').hidden=false;}});}
  const model=RMAP.buildModel(SURVEY,rmHelpers());
  rmDraw(st,model,{staff:false,facilities:rmFacs(dest&&dest.id,true),onPick:info=>{if(info.type==='amenity'&&info.id){heroPick(info.id);return;}const b=$('liveInfo');b.innerHTML=rmInfoHtml(info);b.hidden=false;}},
    {platforms:'Platforms',bridges:'Foot over bridges',gates:'Gates & entries',amenities:'Amenities',outside:'Outside the station'});
  const r=liveRouteFromState(start,edges,dest);LV.route=r;
  if(st.rl)st.rl.forEach(l=>st.map.removeLayer(l));st.rl=[];
  if(r&&r.line.length>1){st.rl.push(L.polyline(r.line,{color:'#ffffff',weight:11,opacity:.95,interactive:false}).addTo(st.map));
    st.rl.push(LV.walked=L.polyline([],{color:'#9AA4B1',weight:7,opacity:.95,interactive:false}).addTo(st.map));
    st.rl.push(LV.todo=L.polyline(r.line,{color:'#1A73E8',weight:7,opacity:1,interactive:false}).addTo(st.map));
    st.rl.push(L.marker(r.line[0],{icon:L.divIcon({className:'live-start',html:'<b></b>',iconSize:null}),title:'Start: the QR board you scanned',interactive:false}).addTo(st.map));
    st.rl.push(L.marker(r.line[r.line.length-1],{icon:L.divIcon({className:'live-dest',html:`<b></b><span>${esc(dest?dest.name:'')}</span>`,iconSize:null}),interactive:false}).addTo(st.map));}
  {const sp=getPt(state.scan),sll=sp&&hasLL(sp)?[sp.lat,sp.lng]:nodeLL(start);LV.here=sll;
    if(sll)st.rl.push(L.marker(sll,{icon:L.divIcon({className:'live-here',html:'<i></i><b></b><span>You are here · आप यहाँ हैं</span>',iconSize:null}),interactive:false,zIndexOffset:1500}).addTo(st.map));}
  if(STAFF_TODO)staffTasks().forEach(t=>st.rl.push(L.marker(t.ll,{icon:L.divIcon({className:'todo-pin k-'+t.kind,html:`<b>${TODO_SYM[t.kind]}</b>`,iconSize:null}),zIndexOffset:1600,title:TODO_TXT[t.kind]}).on('click',()=>todoPop(t.id)).addTo(st.map)));
  if(key!==LV.key){LV.key=key;LV.cur=0;if(r&&r.line.length>1&&!(LV.started&&LV.me&&LV.follow))st.map.fitBounds(L.latLngBounds(r.line).pad(.25),{maxZoom:19});}
  if(LV.me)liveUpdate();else liveBanner();setTimeout(()=>{st.map.invalidateSize();
    // first time the map is shown, and whenever nothing is picked: the whole station area
    if(!st.hfit||key==='none'){st.hfit=true;const so=stationOutlines()[0];if(so&&so.length>=3)st.map.fitBounds(L.latLngBounds(so),{padding:[8,8],maxZoom:19});}},60);}
function liveBanner(){const r=LV.route;if(!r){$('lbT').textContent='Pick a destination';$('lbS').textContent='';return;}
  if(!LV.started){$('lbIc').textContent='↑';$('lbT').textContent=`${r10(r.total)} m to ${r.dest?r.dest.name:'your destination'}`;$('lbS').textContent='Tap ▶ Navigate for step-by-step directions with voice · नेविगेट दबाएँ';return;}
  $('lbT').textContent='Finding your location…';$('lbS').textContent='Allow location access if your phone asks. Stand still for a moment.';}
function liveStart(){if(!navigator.geolocation){$('lbT').textContent="This phone can't share its location";$('lbS').textContent='Follow the steps below.';return;}
  LV.started=true;LV.follow=true;$('liveStart').hidden=true;liveBanner();
  try{const D=window.DeviceOrientationEvent;if(D&&typeof D.requestPermission==='function')D.requestPermission().then(s=>{if(s==='granted')liveCompass();}).catch(()=>{});else liveCompass();}catch(_){}
  if(LV.watch!=null)navigator.geolocation.clearWatch(LV.watch);
  LV.watch=navigator.geolocation.watchPosition(pos=>{const c=pos.coords;LV.me={lat:c.latitude,lng:c.longitude,acc:c.accuracy,t:Date.now()};
      if(c.heading!=null&&!isNaN(c.heading)&&(c.speed||0)>.6)LV.heading=c.heading;liveUpdate();},
    err=>{$('lbT').textContent=err.code===1?'Location is turned off for this site':'Couldn\'t find your location';$('lbS').textContent=err.code===1?'Allow location in your browser settings, or follow the steps below.':'Move into the open for a moment, or follow the steps below.';$('liveStart').hidden=false;$('liveStart').textContent='Try again';LV.started=false;},
    {enableHighAccuracy:true,maximumAge:2000,timeout:30000});}
let liveCompassOn=false;
function liveCompass(){if(liveCompassOn)return;liveCompassOn=true;const h=e=>{let d=null;if(typeof e.webkitCompassHeading==='number')d=e.webkitCompassHeading;else if(e.absolute&&typeof e.alpha==='number')d=360-e.alpha;if(d!=null&&!LV.movingHeading){LV.heading=d;liveMe();}};
  window.addEventListener('deviceorientationabsolute',h);window.addEventListener('deviceorientation',h);}
function liveMe(){const st=RMV.live,L=sv.L;if(!st||!LV.me||!L)return;const ll=[LV.me.lat,LV.me.lng];
  if(!LV.dot){LV.accC=L.circle(ll,{radius:LV.me.acc,color:'#1A73E8',weight:1,fillColor:'#1A73E8',fillOpacity:.12,interactive:false}).addTo(st.map);
    LV.dot=L.marker(ll,{icon:L.divIcon({className:'live-me',html:'<i class="cone"></i><b></b>',iconSize:null}),interactive:false,zIndexOffset:2000}).addTo(st.map);}
  LV.dot.setLatLng(ll);LV.accC.setLatLng(ll);LV.accC.setRadius(LV.me.acc);
  const el=LV.dot.getElement&&LV.dot.getElement();if(el){const cone=el.querySelector('.cone');if(cone){cone.style.display=LV.heading==null?'none':'';cone.style.transform=`translate(-50%,-100%) rotate(${LV.heading||0}deg)`;}}}
function liveUpdate(){const st=RMV.live,r=LV.route;if(!st||!LV.me)return;liveMe();const me=[LV.me.lat,LV.me.lng];
  if(LV.follow)st.map.setView(me,Math.max(st.map.getZoom(),18.5),{animate:true});
  if(!r||r.line.length<2){liveBanner();return;}
  const pj=RMAP.project(r.line,me),acc=LV.me.acc||99,d=pj?pj.d:0,left=Math.max(0,r.total-d);
  if(LV.walked&&pj){const done=r.line.slice(0,pj.i+1).concat([pj.ll]);LV.walked.setLatLngs(done);LV.todo.setLatLngs([pj.ll].concat(r.line.slice(pj.i+1)));}
  let i=r.stepEnd.findIndex(e=>e>d+4);if(i<0)i=STEPS.length-1;LV.cur=i;markCur();
  const s=STEPS[i],nx=STEPS[i+1];
  if(left<12&&pj.off<Math.max(25,acc)){$('lbIc').textContent='●';$('lbT').textContent=`You have arrived at ${r.dest?r.dest.name:'your destination'}`;$('lbS').textContent=s&&s.s?s.s:'';return;}
  if(pj.off>Math.max(35,acc*1.2)){$('lbIc').textContent='↺';$('lbT').textContent=`You're about ${r10(pj.off)} m from the route`;$('lbS').textContent='Walk back to the blue line. '+(acc>30?`GPS is rough here (±${Math.round(acc)} m).`:'');return;}
  $('lbIc').textContent=liveIcon(s);$('lbT').textContent=s?s.t:'Follow the blue line';
  $('lbS').textContent=`${r10(Math.max(0,r.stepEnd[i]-d))} m${nx?' · then '+nx.t.replace(/^Arrive at /,'arrive at '):''} · ${r10(left)} m left${acc>30?` · GPS ±${Math.round(acc)} m`:''}`;}
// ================= Navigate: full-screen turn-by-turn with Hindi voice (lib/nav.js) =================
const navPlatHi=b=>b===0?'प्लेटफॉर्म 1':b===8?'प्लेटफॉर्म 16':`प्लेटफॉर्म ${2*b} और ${2*b+1}`;
const gateHi=lab=>{const n=String(lab||'').match(/\d+/);return n?`गेट नंबर ${n[0]}`:String(lab||'गेट');};
const fobHi=c=>{const f=FOB_BY[c];const t=f?fobShort(f):'FOB';const n=t.match(/\d+/);return n?`फुट ओवर ब्रिज ${n[0]}`:'फुट ओवर ब्रिज';};
function placeHi(c){return c==='P'?'पहाड़गंज साइड कॉनकोर्स':c==='A'?'अजमेरी गेट साइड कॉनकोर्स':isFob(c)?fobHi(c):/^pl\d$/.test(c)?navPlatHi(+c.slice(2)):'';}
function placeEn(c){return c==='P'||c==='A'?`the ${areaLabel(c)}`:isFob(c)?(FOB_BY[c]?fobShort(FOB_BY[c]):'the bridge'):/^pl\d$/.test(c)?platLabel(+c.slice(2)):'';}
const CAT_COL={ysk:'#3949AB',mih:'#00897B',pharmacy:'#E53935',charging:'#F9A825',feeding:'#EC407A',gate:'#455A64',pfentry:'#546E7A',fobaccess:'#5C6BC0',subway:'#6D4C41',lift:'#1565C0',escalator:'#1565C0',stairs:'#37474F',parking:'#0277BD',dropoff:'#F9A825',
  police:'#283593',sm:'#4E342E',parcel:'#795548',cmi:'#1F2A5A',lostfound:'#8D6E63',complaint:'#C62828',tmpticket:'#EF6C00',holding:'#EF6C00',tmpgate:'#EF6C00',tmpfood:'#EF6C00',tmphelp:'#EF6C00',queue:'#EF6C00',tmpwater:'#EF6C00',tmptoilet:'#EF6C00',
  newfac:'#00796B',guide:'#00796B',diversion:'#F57F17',restricted:'#B71C1C',assembly:'#2E7D32',emexit:'#2E7D32',other:'#546E7A',lounge:'#8E24AA',waiting:'#5E35B1',toilet:'#039BE5',water:'#00ACC1',food:'#F4511E',ticket:'#3949AB',atm:'#2E7D32',enquiry:'#1E88E5',cloak:'#6D4C41',retiring:'#7B1FA2',medical:'#E53935',transport:'#F9A825',shop:'#D81B60',help:'#00897B'};
const catColor=c=>CAT_COL[c]||'#546E7A';
function navRoute(){const r=LAST_ROUTE;if(!r||!r.edges||!r.edges.length||!LAYOUT||!LAYOUT.geo)return null;const dest=r.dest;
  let ids=[r.start,...r.edges.map(e=>e.b)].filter(id=>N[id]);let kinds=r.edges.map(e=>e.kind);
  const P=ids.map(id=>({id,ll:nodeLL(id),lvl:isFob(N[id].ctx)?1:0,ctx:N[id].ctx,tag:''}));if(P.some(q=>!q.ll))return null;
  const pt=getPt(state.scan);if(pt&&hasLL(pt)&&RMAP.metres([pt.lat,pt.lng],P[0].ll)<45)P[0].ll=[pt.lat,pt.lng];
  const ro=dest&&dest.cat!=='platform'?routeOut(dest,ids):null;
  if(ro&&ro.out){const g=ro.gate,cy=ro.side==='P'?CPY:CAY;
    {const c=cutAtGate(ids,ro.run,g.tx);P.length=c;kinds.length=c-1;}
    const add=(ll,tag)=>{if(!ll)return;P.push({ll,lvl:0,ctx:ro.side,tag});kinds.push('walk');};
    add(mapToLL(g.tx,cy),'');add(mapToLL(g.tx,g.ty),'gate:'+g.lab);add([dest.lat,dest.lng],'dest');}
  else if(ro&&hasLL(dest)){P.push({ll:[dest.lat,dest.lng],lvl:0,ctx:ro.side,tag:'dest'});kinds.push('walk');}
  const line=P.map(q=>q.ll),cum=[0];for(let i=1;i<line.length;i++)cum.push(cum[i-1]+RMAP.metres(line[i-1],line[i]));
  const brg=(a,b)=>{const y=Math.sin((b[1]-a[1])*Math.PI/180)*Math.cos(b[0]*Math.PI/180),x=Math.cos(a[0]*Math.PI/180)*Math.sin(b[0]*Math.PI/180)-Math.sin(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.cos((b[1]-a[1])*Math.PI/180);return (Math.atan2(y,x)*180/Math.PI+360)%360;};
  const back=i=>{for(let j=i-1;j>=0;j--)if(cum[i]-cum[j]>2.5&&P[j].lvl===P[i].lvl)return j;return -1;},fwd=i=>{for(let j=i+1;j<P.length;j++)if(cum[j]-cum[i]>2.5&&P[j].lvl===P[i].lvl)return j;return -1;};
  const moves=[],push=m=>{const last=moves[moves.length-1];if(last&&Math.abs(last.d-m.d)<4&&last.type!=='straight'&&!/stairs|lift|esc|gate/.test(m.type))return;moves.push(m);};
  // first instruction
  {const c=P[0].ctx;push({d:0,type:'straight',hi:`${placeHi(c)} पर सीधे चलें`,en:`Walk straight along ${placeEn(c)}`});}
  for(let i=0;i<P.length-1;i++){const k=kinds[i],q=P[i],n=P[i+1];
    if(/stairs|lift|esc/.test(k)&&kinds[i-1]!==k){const up=n.lvl>q.lvl||(n.lvl===q.lvl&&isFob(n.ctx));let j=i+1;while(j<P.length-1&&kinds[j]===k)j++;const to=P[j].ctx;
      const ph=up?fobHi(to):placeHi(to),pe=up?(FOB_BY[to]?fobShort(FOB_BY[to]):'the bridge'):placeEn(to);
      const m=k==='lift'?{type:up?'liftup':'liftdown',hi:`लिफ्ट से ${up?'ऊपर':'नीचे'} ${ph} पर जाएँ`,en:`Take the lift ${up?'up':'down'} to ${pe}`,hiNow:`अब लिफ्ट लें, ${up?'ऊपर':'नीचे'} जाएँ`,enNow:`Take the lift ${up?'up':'down'} now`}
        :k==='esc'?{type:up?'escup':'escdown',hi:`एस्केलेटर से ${up?'ऊपर':'नीचे'} ${ph} पर जाएँ`,en:`Take the escalator ${up?'up':'down'} to ${pe}`,hiNow:`अब एस्केलेटर लें`,enNow:'Take the escalator now'}
        :{type:up?'stairsup':'stairsdown',hi:`सीढ़ियाँ ${up?'चढ़कर':'उतरकर'} ${ph} पर जाएँ`,en:`${up?'Climb the stairs up':'Take the stairs down'} to ${pe}`,hiNow:`अब सीढ़ियाँ ${up?'चढ़ें':'उतरें'}`,enNow:up?'Climb the stairs now':'Go down the stairs now'};
      push(Object.assign({d:cum[i]},m));continue;}
    if(i===0)continue;
    if(q.tag.startsWith('gate:')){const gl=q.tag.slice(5);push({d:cum[i],type:'gate',hi:`${gateHi(gl)} से बाहर निकलें`,en:`Go out through ${gl}`});continue;}
    const a=back(i),b=fwd(i);if(a<0||b<0)continue;const dlt=((brg(q.ll,P[b].ll)-brg(P[a].ll,q.ll)+540)%360)-180,ad=Math.abs(dlt),R=dlt>0;
    const oc=n.ctx!==q.ctx&&!isFob(n.ctx)&&!isFob(q.ctx)?n.ctx:(P[i-1].ctx!==q.ctx&&!isFob(q.ctx)&&!isFob(P[i-1].ctx)?q.ctx:'');
    const onto=oc?placeHi(oc):'',ontoEn=oc?placeEn(oc):'';
    if(ad<28){if(onto)push({d:cum[i],type:'platform',hi:`सीधे ${onto} पर जाएँ`,en:`Go straight onto ${ontoEn}`});continue;}
    const t=ad>150?'uturn':ad<60?(R?'slightright':'slightleft'):(R?'right':'left');
    const wh={uturn:['पीछे मुड़ें','Turn around'],slightright:['थोड़ा दाएँ मुड़ें','Keep slightly right'],slightleft:['थोड़ा बाएँ मुड़ें','Keep slightly left'],right:['दाएँ मुड़ें','Turn right'],left:['बाएँ मुड़ें','Turn left']}[t];
    push({d:cum[i],type:t,hi:onto?`${wh[0].replace('मुड़ें','मुड़कर')} ${onto} पर जाएँ`:wh[0],en:onto?`${wh[1]} onto ${ontoEn}`:wh[1],hiNow:`अब ${wh[0]}`,enNow:`${wh[1]} now`});}
  const total=cum[cum.length-1];push({d:total,type:'arrive',hi:`${facHi(dest)||dest.name} पर पहुँचें`,en:`Arrive at ${dest.name}`});
  // landmark photo for each instruction: the photo staff took at that point, with its "go here" arrow for the way this route leaves
  const navPh=(key,tok)=>{const ph=PHOTOS[key];if(!ph||!ph.assetId)return null;const hs=tok?(ph.hotspots||[]).find(h=>h.to===tok):null;return {url:blobUrl(ph.assetId),hs:hs?{x:+(+hs.x).toFixed(2),y:+(+hs.y).toFixed(2)}:null};};
  const nodePh=i=>{const q=P[i];if(!q||!q.id||!N[q.id])return null;const nx=P[i+1]&&P[i+1].id&&N[P[i+1].id]?P[i+1].id:null;let tok=null;try{tok=nx?edgeTok(q.id,nx):null;}catch(_){}return navPh(photoKey(q.id),tok);};
  moves.forEach(m=>{if(m.type==='arrive'){m.ph=navPh('f-'+dest.id)||navPh('n-fac_'+dest.id);return;}
    const i=cum.indexOf(m.d);if(i<0)return;m.ph=nodePh(i);
    for(let j=i+1;!m.ph&&j<P.length&&cum[j]-cum[i]<6;j++)m.ph=nodePh(j);for(let j=i-1;!m.ph&&j>=0&&cum[i]-cum[j]<6;j--)m.ph=nodePh(j);});
  // what to draw: platforms, bridges, gates, nearby amenities, outside areas
  const model=RMAP.buildModel(SURVEY,rmHelpers());const near=ll=>line.some(q=>RMAP.metres(q,ll)<40);
  const bridgeNames=model.bridges.map(b=>{const s=b.segs.slice().sort((p,q)=>RMAP.metres(q.a,q.b)-RMAP.metres(p.a,p.b))[0];return s&&b.name?{name:b.name,ll:[(s.a[0]+s.b[0])/2,(s.a[1]+s.b[1])/2]}:null;}).filter(Boolean);
  const overlay={boundary:stationOutlines(),buildings:stationBuildings(),walks:walkNet(),bridgeNames,platforms:model.platforms.map(x=>({line:x.line,island:x.island,name:x.name})),bridges:[].concat(...model.bridges.map(b=>b.segs.map(sg=>[sg.a,sg.b]))),
    gates:model.gates.map(g=>({ll:g.ll,name:g.name,status:g.status})),outside:model.outside.map(o=>({pts:o.pts,color:o.color,shape:o.shape,name:o.name,kind:o.kind})),
    amenities:rmFacs(dest.id).map(a=>({ll:a.ll,name:a.name,code:a.code,open:a.open,dest:a.dest,near:near(a.ll),color:catColor((FAC.find(f=>f.id===a.id)||{}).cat)}))};
  return {line,level:P.map(q=>q.lvl),moves,total,dest:{name:dest.name,nameHi:facHi(dest)},start:{name:pt?pt.name:''},overlay};}
async function openNavView(){const r=LAST_ROUTE&&LAST_ROUTE.indoor?imNavRoute():navRoute();if(!r){alert('Navigation needs the station survey. Use the 3D walk or the steps.');return;}
  // any QR board scanned during the walk: on this route it fixes the position, elsewhere it starts a new route to the same place
  r.board=id=>{const p=getPt(id);return p&&hasLL(p)?{ll:[p.lat,p.lng],name:p.name}:null;};
  r.onReroute=id=>{if(!getPt(id))return;state.scan=id;renderPassenger();setTimeout(()=>{if(LAST_ROUTE&&(LAST_ROUTE.indoor||(LAST_ROUTE.edges&&LAST_ROUTE.edges.length)))openNavView();},150);};
  W.playing=false;stopLoop();const {openNav}=await import('./nav');window.__NAV=openNav(r);}
function liveIcon(s){const t=String(s&&s.t||'');return /lift/i.test(t)?'⇅':/escalator/i.test(t)?'↗':/stairs|steps/i.test(t)?'≡':/arrive/i.test(t)?'●':/bridge|FOB/i.test(t)?'⇢':'↑';}

// ================= passenger home: the station map on top, choices below (like a mall map) =================
const CAT_IC={gate:'<path d="M4 21V6l8-3 8 3v15M9 21v-7h6v7"/>',lift:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 9l3-3 3 3M9 15l3 3 3-3"/>',escalator:'<path d="M3 18h4l9-11h5M3 18v3M7 18l9-11"/>',
  stairs:'<path d="M3 20h4v-4h4v-4h4V8h4V4"/>',police:'<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',restricted:'<circle cx="12" cy="12" r="8"/><path d="M7 12h10"/>',
  assembly:'<circle cx="12" cy="7" r="2"/><circle cx="6" cy="14" r="2"/><circle cx="18" cy="14" r="2"/><path d="M12 11v3M8 16l2-1M16 16l-2-1"/>',emexit:'<path d="M14 4h6v16h-6M4 12h11M11 8l4 4-4 4"/>',
  charging:'<path d="M13 3L6 14h5l-1 7 7-11h-5z"/>',parking:'<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" stroke="none">P</text>',
  ysk:'<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/>',pharmacy:'<path d="M12 5v14M5 12h14"/>',mih:'<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" stroke="none">?</text>',
  lounge:'<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 11h18v5H3zM5 16v2M19 16v2"/>',
  waiting:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  platform:'<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 16l-2 4M15 16l2 4"/>',
  toilet:'<text x="12" y="16" text-anchor="middle" font-size="10" font-weight="800" fill="#fff" stroke="none">WC</text>',
  water:'<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  food:'<path d="M7 3v18M5 3v5a2 2 0 0 0 4 0V3M17 21V3c-2 1.5-3 4-3 7h3"/>',
  ticket:'<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  atm:'<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" stroke="none">₹</text>',
  enquiry:'<path d="M12 10v8M12 6v.5"/>',
  cloak:'<rect x="5" y="8" width="14" height="12" rx="2"/><path d="M9 8V5h6v3"/>',
  retiring:'<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
  medical:'<path d="M12 5v14M5 12h14"/>',
  transport:'<path d="M5 16v-5l2-5h10l2 5v5zM5 16v2M19 16v2M5 11h14"/>',
  shop:'<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  help:'<circle cx="11" cy="4.5" r="1.6"/><path d="M11 7v6h5l2 5M11 10h4M8.5 10.5a5 5 0 1 0 6.5 6.5"/>'};
function catIcon(c){const p=CAT_IC[c]||`<text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="800" fill="#fff" stroke="none">${esc((CAT[c]&&CAT[c].code)||'•')}</text>`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;}
// ---- place search ----
const PS_SYN={toilet:'washroom bathroom loo urinal wc restroom latrine shauchalay toilet टॉयलेट शौचालय बाथरूम',water:'paani pani drinking tap cooler water पानी पीने',food:'khana food canteen restaurant meal snacks tea chai coffee juice खाना भोजन चाय',
    ticket:'uts prs booking counter tikat ticket reservation window atvm टिकट आरक्षण',atm:'atm cash bank money paise पैसे बैंक',lounge:'lounge ac executive आराम',waiting:'waiting hall rest baithne प्रतीक्षा',enquiry:'enquiry inquiry help desk information pooch puchtach पूछताछ',
    cloak:'cloak luggage baggage saman locker सामान',retiring:'retiring room stay dormitory sleep रुकने',medical:'medical doctor first aid dawa chemist hospital दवा डॉक्टर',transport:'taxi auto metro cab bus parking टैक्सी ऑटो मेट्रो',
    shop:'shop store stall book kitab दुकान',help:'help wheelchair porter coolie kuli सहायता व्हीलचेयर कुली',platform:'platform pf plat प्लेटफॉर्म'};
const psHay=a=>{const c=CAT[a.cat]||{};let w=[facWords(a),c.en,c.hi,PS_SYN[a.cat]||'',a.note||'',a.cat==='platform'?'':facWhere(a)];
    if(a.cat==='platform'){const n=(platLabel(a.bar).match(/\d+/g)||[]);w.push(platLabel(a.bar),navPlatHi(a.bar),...n.map(x=>`pf ${x} pf${x} platform ${x} प्लेटफॉर्म ${x}`));}
    let h=w.join(' ').toLowerCase();
    // "Platform 4/5" is also "PF 4", "PF 5"; "FOB 2" also "bridge 2"
    h+=' '+(h.match(/platform\s*(\d+)(\s*\/\s*\d+)?/g)||[]).map(x=>(x.match(/\d+/g)||[]).map(n=>`pf ${n} pf${n} platform ${n}`).join(' ')).join(' ');
    h+=' '+(h.match(/fob\s*\d+|foot over bridge\s*\d+/g)||[]).map(x=>{const n=(x.match(/\d+/)||[''])[0];return `fob ${n} fob${n} bridge ${n}`;}).join(' ');
    return ' '+h.replace(/[·,/()\-\[\]]/g,' ')+' ';};
  // every word must be found; a number must match a whole number ("1" doesn't find "16")
const psMatch=(h,toks)=>toks.every(k=>/^\d+$|^(pf|fob)\d+$/.test(k)?new RegExp('(^|[^0-9a-z])'+k+'([^0-9]|$)').test(h):h.includes(' '+k));
  // "PF 3", "platform no. 3", "प्लेटफॉर्म 3" mean that platform only; "FOB 2" / "bridge 2" that bridge
const psPhrase=t=>t.replace(/(pf|platform|plat|प्लेटफॉर्म)\s*(no\.?|number)?\s*(\d+)/g,'pf$3').replace(/(fob|bridge|ब्रिज)\s*(no\.?|number)?\s*(\d+)/g,'fob$3');
const psScore=(a,toks,t)=>{if(a.cat==='platform'&&toks.some(k=>/^pf\d+$/.test(k)))return -2;const n=(a.name+' '+facHi(a)).toLowerCase();return (n.startsWith(t)?0:n.includes(t)?1:toks.every(k=>n.includes(k))?2:3)*2+(isOpen(a)?0:1);};
const psRow=(a,t,key=x=>x.id)=>`<button type="button" data-hid="${esc(key(a))}"><i style="background:${isOpen(a)?catColor(a.cat):'#9AA0A6'}">${catIcon(a.cat)}</i><span><b>${esc(a.name)}${facHi(a)?` · ${esc(facHi(a))}`:''}</b><small>${(()=>{if(!t)return '';const hit=facAka(a).find(x=>x.toLowerCase().includes(t));return hit?esc('“'+hit+'” · '):'';})()}${esc(a.cat==='platform'?(a.note||(a.bar===0?'Paharganj side':a.bar===8?'Ajmeri Gate side':'')):facWhere(a))}${gateUseOf(a)?' · <b>'+esc(gateUseText(a))+'</b>':''}${isOpen(a)?'':' · closed'}</small></span></button>`;
const psGrouped=(list,t,key)=>{const by={};list.forEach(a=>{(by[a.cat]=by[a.cat]||[]).push(a);});
    return CATS.filter(c=>by[c[0]]).map(([id,en,hi])=>`<p class="hr-g"><i style="background:${catColor(id)}">${catIcon(id)}</i>${esc(en)} · ${esc(hi)} <small>${by[id].length}</small></p>${by[id].map(a=>psRow(a,t,key)).join('')}`).join('');};
// the same place search everywhere: the passenger search bar, and "Test a route" in the station map editor
function searchHtml(raw,key){const t=String(raw||'').trim().toLowerCase(),all=(key?ALL():PASS()).filter(a=>a.cat==='platform'||a._n||hasLL(a));
  if(!t)return `<p class="hr-c">All places · सभी जगहें <small>${all.length}</small></p>`+psGrouped(all.slice().sort((x,y)=>(isOpen(y)-isOpen(x))||x.name.localeCompare(y.name,undefined,{numeric:true})),'',key);
  const toks=psPhrase(t).split(/\s+/).filter(Boolean),hit=all.filter(a=>psMatch(psHay(a),toks)).sort((x,y)=>psScore(x,toks,t)-psScore(y,toks,t)||x.name.localeCompare(y.name,undefined,{numeric:true}));
  return hit.length?`<p class="hr-c">${hit.length} place${hit.length===1?'':'s'} found · ${hit.length} जगहें</p>`+(hit.length<=6?hit.map(a=>psRow(a,t,key)).join(''):(psScore(hit[0],toks,t)<=0?`<p class="hr-g">Best match · सबसे सही</p>${psRow(hit[0],t,key)}`:'')+psGrouped(psScore(hit[0],toks,t)<=0?hit.slice(1):hit,t,key)):'<p>No place found · कोई जगह नहीं मिली</p>';}
function heroInit(){if($('pHero'))return;const vp=$('v-passenger'),grid=vp&&vp.querySelector('.grid');if(!grid)return;liveInit();
  grid.insertAdjacentHTML('beforebegin',`<section class="hero" id="pHero" aria-label="Station map · स्टेशन का नक्शा">
    <div class="hero-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
      <button type="button" class="hero-mic" id="heroMic" hidden aria-label="Speak to search · बोलकर खोजें" title="Speak · बोलें"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
      <input id="heroQ" type="search" placeholder="Search a place · स्थान खोजें" autocomplete="off" aria-label="Search a place in the station"><div class="hero-res" id="heroRes" hidden></div></div>
    <div class="hero-here" id="heroHere"><span class="hh-pin" aria-hidden="true"></span><div class="hh-tx"><small>You are here · आप यहाँ हैं</small><b id="hhName"></b><span id="hhSub"></span></div>
      <button type="button" class="hh-btn" id="hhScan" aria-label="Scan another QR board"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5" y="5" width="6" height="6" fill="currentColor"/></svg>Scan</button>
      <a class="hh-btn" id="hhTell" href="/tell">Tell us</a></div>
    <div id="heroMaps"></div>
    <div class="hero-fabs"><button type="button" id="heroSF" aria-pressed="false" title="Step-free route (lifts, no stairs)" aria-label="Step-free route"><svg viewBox="0 0 24 24"><circle cx="11" cy="4.5" r="1.6"/><path d="M11 7v6h5l2 5M11 10h4M8.5 10.5a5 5 0 1 0 6.5 6.5"/></svg></button>
      <button type="button" id="heroTodo" hidden aria-pressed="false" title="Staff to-do: photos and QR boards still needed" aria-label="Staff to-do"><span>🛠</span><i id="heroTodoN"></i></button>
      <button type="button" id="heroRush" hidden title="FOB rush control" aria-label="FOB rush control"><span>🚦</span></button>
      <button type="button" id="heroMe" title="Show where I am" aria-label="Show where I am"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg></button></div>
    <div class="hero-card" id="heroCard" hidden></div><div class="todo-pop" id="todoPop" hidden></div><div class="todo-pop crowd-pop" id="crowdPop" hidden><p class="crowd-h"><b>FOB rush · भीड़</b><button type="button" id="crowdX" aria-label="Close">✕</button></p><div class="crowd-body"></div></div><div class="todo-key" id="todoKey" hidden></div></section>`);
  $('heroMaps').append($('wrapLive'),$('wrapMap'));
  // the choices sit straight under the map; "You are here" (scan / tell us) follows them; step-free is the ♿ button on the map
  const col=$('cats').closest('.col'),catP=$('cats').closest('.panel');col.insertBefore(catP,col.firstChild);
  $('hereName').closest('.panel').hidden=true;
  $('hhScan').addEventListener('click',()=>$('scanBtn').click());
  $('stepFree').closest('.panel').hidden=true;
  $('heroSF').addEventListener('click',()=>{const c=$('stepFree');c.checked=!c.checked;c.dispatchEvent(new Event('change'));});
  if(SR){$('heroMic').hidden=false;$('heroMic').closest('.hero-search').classList.add('has-mic');$('heroMic').addEventListener('click',voiceOpen);}
  $('heroRush').addEventListener('click',()=>{const p=$('crowdPop');p.hidden=!p.hidden;renderCrowd();});$('crowdX').addEventListener('click',()=>{$('crowdPop').hidden=true;});renderCrowd();
  $('heroTodo').addEventListener('click',()=>{STAFF_TODO=!STAFF_TODO;$('todoPop').hidden=true;renderPassenger();});
  $('todoPop').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const t=TODO_BY[b.dataset.t];$('todoPop').hidden=true;if(!t||b.dataset.a==='x')return;
    if(b.dataset.a==='photo'){openPhEd(t.key,t.sug||'');}else if(b.dataset.a==='qr'){showView('qr');setTimeout(()=>openQrEd(null),60);}});
  $('heroMe').addEventListener('click',()=>{const st=RMV.live;if(st&&LV.here){LV.follow=false;st.map.setView(LV.here,Math.max(st.map.getZoom(),19));}});
  const q=$('heroQ'),res=$('heroRes');
  // search every facility and platform: by name, Hindi name, other names, type, place, and words passengers use
  const run=()=>{res.innerHTML=searchHtml(q.value);res.hidden=false;};
  q.addEventListener('input',run);q.addEventListener('focus',run);
  q.addEventListener('keydown',e=>{if(e.key==='Escape'){q.value='';res.hidden=true;q.blur();}if(e.key==='Enter'){const f=res.querySelector('[data-hid]');if(f)f.click();}});
  res.addEventListener('click',e=>{const b=e.target.closest('[data-hid]');if(!b)return;q.value='';res.hidden=true;q.blur();heroPick(b.dataset.hid);});
  document.addEventListener('click',e=>{if(!e.target.closest('.hero-search'))res.hidden=true;});
  $('heroCard').addEventListener('click',e=>{if(e.target.closest('#heroGo'))openNavView();else if(e.target.closest('#heroX')){state.cat=null;state.dest='';renderPassenger();}else if(e.target.closest('#heroMore'))$('routeTitle').closest('.panel').scrollIntoView({behavior:'smooth',block:'start'});});}
// ---- staff to-do on the passenger map: spots that still need a photo, a "Go here" arrow, or a QR board ----
let STAFF_TODO=false,TODO_BY={};
const TODO_SYM={photo:'📷',arrow:'↗',qr:'QR'},TODO_TXT={photo:'Photo needed here',arrow:'Photo has no “Go here” arrow',qr:'Put a QR board here'};
function staffTasks(){if(!CAN_EDIT)return [];const out=[],qrs=QRPTS.filter(p=>hasLL(p)).map(p=>[+p.lat,+p.lng]),qs=[];
  needSpots().filter(s=>s.type==='access'||s.type==='gate'||s.type==='entry').forEach(s=>{const ll=nodeLL(s.id);if(!ll)return;const lv=isFob(N[s.id].ctx)?imUpper():imGround();
    if(s.st!=='good')out.push({id:'p:'+s.key,kind:s.st==='none'?'photo':'arrow',ll,lv,key:s.key,sug:s.sug,label:s.label,sub:s.sub});
    // a QR board at every stairs / lift / escalator end that has none within 25 m (passengers re-scan there to fix their position)
    if(s.type==='access'&&!qrs.some(q=>RMAP.metres(q,ll)<25)&&!qs.some(q=>RMAP.metres(q.ll,ll)<15))qs.push({id:'q:'+s.key,kind:'qr',ll,lv,label:s.label,sub:s.sub});});
  const all=out.concat(qs);TODO_BY={};all.forEach(t=>TODO_BY[t.id]=t);return all;}
function todoBar(){const b=$('heroTodo');if(!b)return;b.hidden=!CAN_EDIT;if(!CAN_EDIT){STAFF_TODO=false;return;}b.setAttribute('aria-pressed',String(STAFF_TODO));
  const T=staffTasks(),n={photo:0,arrow:0,qr:0};T.forEach(t=>n[t.kind]++);$('heroTodoN').textContent=T.length||'';
  const k=$('todoKey');k.hidden=!STAFF_TODO;k.innerHTML=`<b>Staff to-do</b> <span class="tk-photo">📷 ${n.photo} photo${n.photo===1?'':'s'}</span> <span class="tk-arrow">↗ ${n.arrow} arrow${n.arrow===1?'':'s'}</span> <span class="tk-qr">QR ${n.qr} board${n.qr===1?'':'s'}</span> <small>Tap a mark</small>`;}
function todoPop(id){const t=TODO_BY[id],p=$('todoPop');if(!t||!p)return;
  const what=t.kind==='photo'?'Stand here facing the way passengers walk, take the photo, then tap where they should head.':t.kind==='arrow'?'This spot has a photo but no “Go here” arrow. Open it and tap where passengers should head.':'Passengers can re-scan here to fix their position. Stand at the spot, make a QR board with “Use my current location”, print it and put it up.';
  p.innerHTML=`<div class="tp-h k-${t.kind}"><b>${TODO_SYM[t.kind]}</b> ${esc(TODO_TXT[t.kind])}</div><div class="tp-n">${esc(t.label)}</div><div class="tp-s">${esc(t.sub||'')}</div><p>${what}</p>
    <div class="actions">${t.kind==='qr'?`<button class="btn sm primary" type="button" data-t="${esc(t.id)}" data-a="qr">Make a QR board here</button>`:`<button class="btn sm primary" type="button" data-t="${esc(t.id)}" data-a="photo">${t.kind==='photo'?'Take the photo':'Add the arrow'}</button>`}<button class="btn sm" type="button" data-t="${esc(t.id)}" data-a="x">Close</button></div>`;
  p.hidden=false;}
let SCANNED=false,FROM_LINK=null;try{FROM_LINK=new URLSearchParams(location.search).get('to');}catch(_){}
function openFromLink(){if(!FROM_LINK||FROM_LINK==='done')return;const a=ALL().find(x=>x.id===FROM_LINK);if(!a)return;FROM_LINK='done';heroPick(a.id);}

// ================= voice search: speak in Hindi or English, hear the answer, say "हाँ" to go =================
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const VO={lang:(()=>{try{return localStorage.getItem('wf-voice-lang')||'hi-IN';}catch(_){return 'hi-IN';}})(),rec:null,stage:'',busy:false};
const HI_NUM={'एक':1,'दो':2,'तीन':3,'चार':4,'पाँच':5,'पांच':5,'छह':6,'छः':6,'सात':7,'आठ':8,'नौ':9,'दस':10,'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'पंद्रह':15,'सोलह':16,
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,ek:1,do:2,teen:3,char:4,paanch:5,panch:5,chhe:6,saat:7,aath:8,nau:9,das:10,gyarah:11,barah:12,terah:13,chaudah:14,pandrah:15,solah:16};
const FILLER=/(^|\s)(कहाँ|कहां|है|हैं|मुझे|मेरा|मेरी|को|जाना|चाहिए|बताओ|बताइए|ले|चलो|किधर|कृपया|प्लीज़|पर|का|की|के|में|kahan|kaha|kidhar|kaise|hai|mujhe|jana|jaana|chahiye|batao|le|chalo|where|is|the|i|want|to|go|take|me|please|find|nearest|show|need|a|an|of|can|get|some|ka|ki|ke|ko|par|pe)(?=\s|$)/gi;
function voiceTidy(t){t=' '+String(t||'').toLowerCase()+' ';Object.keys(HI_NUM).forEach(k=>{t=t.replace(new RegExp('(^|\\s)'+k+'(?=\\s|$)','g'),'$1'+HI_NUM[k]);});
  t=t.replace(/प्लेटफार्म|प्लेटफ़ॉर्म|प्लेटफॉर्म|प्लेटफोर्म|platform number|plateform|pletform/g,'platform').replace(/नंबर|number|no\./g,' ');
  t=t.replace(/[?.,!।]/g,' ');for(let i=0;i<2;i++)t=t.replace(FILLER,'$1');return t.replace(/\s+/g,' ').trim();}
function voiceSay(hi,en,then){try{const s=window.speechSynthesis;if(!s){if(then)then();return;}s.cancel();const hiL=VO.lang.startsWith('hi'),u=new SpeechSynthesisUtterance(hiL?hi:en);u.lang=hiL?'hi-IN':'en-IN';
  const v=s.getVoices().find(x=>x.lang&&x.lang.toLowerCase().startsWith(hiL?'hi':'en-in'));if(v)u.voice=v;u.rate=hiL?.95:1;u.onend=()=>{if(then)then();};u.onerror=()=>{if(then)then();};s.speak(u);}catch(_){if(then)then();}}
function voiceUI(){if($('voice'))return;document.body.insertAdjacentHTML('beforeend',`<div class="vo" id="voice" hidden role="dialog" aria-modal="true" aria-label="Voice search · बोलकर खोजें">
  <div class="vo-card"><div class="vo-lang" role="group" aria-label="Language"><button type="button" data-vl="hi-IN">हिंदी</button><button type="button" data-vl="en-IN">English</button></div>
    <button type="button" class="vo-mic" id="voMic" aria-label="Listen again"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
    <p class="vo-st" id="voSt"></p><p class="vo-tx" id="voTx"></p>
    <div class="vo-eg" id="voEg"><span>टॉयलेट कहाँ है</span><span>प्लेटफॉर्म सोलह</span><span>पीने का पानी</span><span>Ticket counter</span><span>मुझे खाना चाहिए</span></div>
    <div class="vo-act" id="voAct"></div><button type="button" class="vo-x" id="voX">✕ Close · बंद करें</button></div></div>`);
  const v=$('voice');v.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.vl){VO.lang=b.dataset.vl;try{localStorage.setItem('wf-voice-lang',VO.lang);}catch(_){}voiceLangBtns();voiceListen('ask');}
    else if(b.id==='voX')voiceClose();else if(b.id==='voMic')voiceListen(VO.stage==='confirm'?'confirm':'ask');
    else if(b.dataset.vgo){voiceClose();openNavView();}else if(b.dataset.vagain)voiceListen('ask');});}
function voiceLangBtns(){document.querySelectorAll('#voice [data-vl]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.vl===VO.lang)));}
function voiceClose(){try{VO.rec&&VO.rec.abort();}catch(_){}try{window.speechSynthesis&&window.speechSynthesis.cancel();}catch(_){}VO.stage='';if($('voice'))$('voice').hidden=true;}
function voiceOpen(){voiceUI();voiceLangBtns();$('voice').hidden=false;$('voAct').innerHTML='';$('voTx').textContent='';voiceListen('ask');}
function voiceListen(stage){if(!SR)return;try{VO.rec&&VO.rec.abort();}catch(_){}VO.stage=stage;const hi=VO.lang.startsWith('hi'),r=new SR();VO.rec=r;r.lang=VO.lang;r.interimResults=true;r.maxAlternatives=3;r.continuous=false;
  $('voice').classList.add('on');$('voSt').textContent=stage==='confirm'?(hi?'चलना है? “हाँ” या “नहीं” बोलिए':'Shall we go? Say “yes” or “no”'):(hi?'बोलिए… कहाँ जाना है?':'Speak now… where do you want to go?');$('voEg').hidden=stage==='confirm';
  let got='';r.onresult=e=>{let t='';for(let i=e.resultIndex;i<e.results.length;i++){t+=e.results[i][0].transcript;if(e.results[i].isFinal)got=e.results[i][0].transcript;}$('voTx').textContent='“'+t+'”';};
  r.onerror=e=>{$('voice').classList.remove('on');if(stage==='confirm'&&(e.error==='no-speech'||e.error==='aborted')){$('voSt').textContent=VO.title||'';$('voTx').textContent=(hi?'“चलें” दबाइए या माइक दबाकर “हाँ” बोलिए':'Tap “Go”, or tap the mic and say “yes”');return;}$('voSt').textContent=e.error==='not-allowed'||e.error==='service-not-allowed'?(hi?'माइक की अनुमति दें · Allow the microphone':'Allow the microphone for this site'):e.error==='network'?(hi?'आवाज़ खोज के लिए इंटरनेट चाहिए। लिखकर खोजें।':'Voice search needs internet. Please type instead.'):(hi?'सुनाई नहीं दिया। माइक दबाकर फिर बोलिए।':'Didn’t catch that. Tap the mic and speak again.');};
  r.onend=()=>{$('voice').classList.remove('on');if(got)(stage==='confirm'?voiceConfirm(got):voiceAsk(got));};
  try{r.start();}catch(_){}}
function voiceAsk(raw){const hi=VO.lang.startsWith('hi'),t=voiceTidy(raw);let pick=null,cat=null;
  const all=PASS().filter(a=>a.cat==='platform'||facLL(a)),pf=(t.match(/(?:platform|pf)\s*(\d{1,2})/)||t.match(/^(\d{1,2})$/)||[])[1];
  if(pf)pick=all.find(a=>a.cat==='platform'&&(platLabel(a.bar).match(/\d+/g)||[]).includes(String(+pf)));
  if(!pick){// a kind of place ("toilet", "पानी", "bhookh lagi"): the nearest open one
    const words=' '+t+' ';let best=null;Object.entries(KW_CAT).forEach(([c,w])=>{if(!CAT[c])return;const n=w.split(',').filter(k=>k&&words.includes(' '+k.toLowerCase())).reduce((s,k)=>Math.max(s,k.length),0);if(n&&(!best||n>best.n))best={c,n};});
    if(best)cat=best.c;}
  if(!pick&&!cat){const q=$('heroQ');q.value=t;q.dispatchEvent(new Event('input'));const f=document.querySelector('#heroRes [data-hid]');if(f)pick=ALL().find(a=>a.id===f.dataset.hid);$('heroRes').hidden=true;q.value='';}
  if(!pick&&!cat){$('voSt').textContent=hi?'माफ़ कीजिए, समझ नहीं आया। फिर से बोलिए।':'Sorry, I didn’t understand. Please say it again.';$('voAct').innerHTML=`<button type="button" class="btn primary" data-vagain="1">🎤 ${hi?'फिर से बोलें':'Try again'}</button>`;
    voiceSay('माफ़ कीजिए, समझ नहीं आया। फिर से बोलिए।','Sorry, I did not understand. Please say it again.');return;}
  if(pick){state.cat=pick.cat;state.dest=pick.id;}else{state.cat=cat;state.dest='';}renderPassenger();
  const dest=ALL().find(a=>a.id===state.dest);if(!dest){voiceSay('यह जगह अभी बंद है। पूछताछ काउंटर से पूछें।','That place is closed right now. Please ask at the enquiry counter.');$('voSt').textContent=hi?'यह अभी बंद है':'Closed right now';return;}
  const m=LAST_ROUTE&&LAST_ROUTE.len?LAST_ROUTE.len:+($('stM').textContent||0),min=Math.max(1,Math.round(m/1.2/60)),nm=dest.name,nh=facHi(dest)||dest.name,where=dest.cat==='platform'?'':facWhere(dest);
  VO.title=`${nm}${facHi(dest)?' · '+facHi(dest):''}`;$('voSt').textContent=VO.title;$('voTx').textContent=`${Math.round(m/10)*10} m · ${min} min${where?' · '+where:''}`;
  const canGo=!!LAST_ROUTE&&!!($('navBtn')&&!$('navBtn').hidden);
  $('voAct').innerHTML=canGo?`<button type="button" class="btn primary vo-go" data-vgo="1">▶ ${hi?'चलें':'Go'} · ${hi?'Go':'चलें'}</button><button type="button" class="btn" data-vagain="1">🎤 ${hi?'कुछ और':'Something else'}</button>`:`<button type="button" class="btn" data-vagain="1">🎤 ${hi?'कुछ और':'Something else'}</button>`;
  const cH=CAT[dest.cat]&&dest.cat!=='platform'&&!nh.includes(CAT[dest.cat].hi)?CAT[dest.cat].hi+', ':'',cE=CAT[dest.cat]&&dest.cat!=='platform'&&!nm.toLowerCase().includes(CAT[dest.cat].en.toLowerCase().replace(/s$/,''))?CAT[dest.cat].en+', ':'';
  voiceSay(`${cH}${nh}। ${Math.round(m/10)*10} मीटर, लगभग ${min} मिनट।${canGo?' चलना है तो हाँ बोलिए।':''}`,`${cE}${nm}. ${Math.round(m/10)*10} metres, about ${min} minutes.${canGo?' Say yes to start.':''}`,()=>{if(canGo&&!$('voice').hidden)voiceListen('confirm');});}
function voiceConfirm(raw){const t=' '+String(raw||'').toLowerCase()+' ';
  if(/(हाँ|हां|हा |हान|चलो|चलें|शुरू|ठीक|ha |haan|han |yes|yeah|ok|okay|chalo|start|go )/.test(t)){voiceClose();openNavView();return;}
  if(/(नहीं|नही|no |nahi|nahin|cancel)/.test(t)){voiceClose();return;}
  voiceListen('confirm');}

function heroPick(id){const a=ALL().find(x=>x.id===id);if(!a)return;state.cat=a.cat;state.dest=a.id;renderPassenger();}
function heroCard(dest,sum){const c=$('heroCard');if(!c)return;if(!dest||!sum){c.hidden=true;return;}
  const nav=!!(LAST_ROUTE&&(LAST_ROUTE.indoor||(LAYOUT&&LAYOUT.geo&&LAST_ROUTE.edges&&LAST_ROUTE.edges.length)));
  c.innerHTML=`<i class="hc-ic" style="background:${catColor(dest.cat)}">${catIcon(dest.cat)}</i>
    <button type="button" class="hc-tx" id="heroMore"><b>${esc(dest.name)}${facHi(dest)?` · ${esc(facHi(dest))}`:''}</b><span>${r10(sum.m)} m · ${sum.min} min · ${esc(dest.cat==='platform'?platLabel(dest.bar):facWhere(dest))}</span></button>
    ${nav?'<button type="button" class="hc-go" id="heroGo">▶ Go · चलें</button>':''}<button type="button" class="hc-x" id="heroX" aria-label="Clear">✕</button>
    ${sum.choices?`<div class="hc-rt">${sum.choices.map((r,i)=>`<button type="button" data-ri="${i}" aria-pressed="${i===sum.idx}">${esc(r.name)} · ${r10(r.m)} m</button>`).join('')}</div>`:sum.via?`<div class="hc-rt"><span>${esc(sum.via)}</span></div>`:''}`;c.hidden=false;}

// ================= the drawn station map (Mappedin-style): staff editor, passenger 3D map, routing =================
let INDOOR=null,INDOOR_G=null;const IM={ed:null,view:null,key:''};
// records: indoor/meta = floors, stairs/lifts, settings; indoor/lv-<floor> = that floor's spaces and walkways
function imAssemble(docs){if(!docs||!docs.length)return null;const meta=docs.find(d=>d.id==='meta');if(!meta)return null;const m=Object.assign(IND.emptyMap(),meta.data());m.spaces=[];m.paths=[];
  docs.filter(d=>d.id.startsWith('lv-')).forEach(d=>{const x=d.data(),lv=d.id.slice(3);(x.spaces||[]).forEach(q=>m.spaces.push(Object.assign({},q,{lv})));(x.paths||[]).forEach(q=>m.paths.push(Object.assign({},q,{lv})));});
  m.links=m.links||[];m.routes=m.routes||[];const cr=docs.find(d=>d.id==='crowd');m.rush=cr&&Array.isArray(cr.data().rush)?cr.data().rush:[];m.rushAt=cr?cr.data().updatedAt||'':'';return m;}
// ================= Record on site <-> Draw the map: one set of points =================
// Every surveyed bridge point, platform end and gate is tied to the drawn walkway corners (and stair/lift ends) at the
// same spot. INDOOR.svs remembers where each surveyed point was at the last sync: {id:[lat,lng]}.
//  · moved in Record on site  -> the drawn corners at the old spot move to the new spot (map saved for passengers)
//  · moved in Draw the map (Save map) -> the surveyed point moves to the corner's new spot
//  · first time: the drawing wins (surveyed points move to their drawn corners)
const SVS_TYPES={fob:6,pfend:6,pfpt:6,gate:2,entry:2};
let SV_SYNC_T=0,SV_SYNC_BUSY=false,SV_SYNC_INFO=null;
const svLvOf=(map,t)=>{const lv=map.levels||[];if(t==='fob'){const f=lv.find(l=>l.id==='f')||lv.find(l=>/fob|bridge/i.test(l.name||''))||lv.find(l=>(+l.z||0)===1);return f?f.id:'f';}const g=lv.find(l=>l.id==='g')||lv.find(l=>(+l.z||0)===0);return g?g.id:'g';};
const svMetres=(a,b)=>IND.metres(a,b);
// drawn corners and stair/lift ends at a spot
function svRefsAt(map,lv,P,tol){const out=[];(map.paths||[]).forEach(p=>{if(p.lv!==lv)return;p.pts.forEach((q,i)=>{if(svMetres(q,P)<=tol)out.push({t:'path',id:p.id,i});});});
  (map.links||[]).forEach(k=>['a','b'].forEach(w=>{const e=k[w];if(e&&e.lv===lv&&Array.isArray(e.ll)&&svMetres(e.ll,P)<=tol)out.push({t:'link',id:k.id,w});}));return out;}
function svRefLL(map,r){if(r.t==='path'){const p=(map.paths||[]).find(x=>x.id===r.id);return p&&p.pts[r.i]?p.pts[r.i]:null;}const k=(map.links||[]).find(x=>x.id===r.id);return k&&k[r.w]?k[r.w].ll:null;}
const svLL=p=>p&&typeof p.lat==='number'&&typeof p.lng==='number'?[+p.lat,+p.lng]:null;
const r7=q=>[+(+q[0]).toFixed(7),+(+q[1]).toFixed(7)];
async function svWrite(id,ll){const ex=Object.assign({},SURVEY[id]||{});Object.assign(ex,{lat:ll[0],lng:ll[1],placed:'map',updatedAt:new Date().toISOString(),by:(USER&&USER.id)||''});SURVEY[id]=ex;await DB.doc('survey/'+id).set(ex);}
function svSyncSoon(){clearTimeout(SV_SYNC_T);SV_SYNC_T=setTimeout(()=>{svSync().catch(e=>console.warn('survey sync',e));},2500);}
async function svSync(){if(!CAN_EDIT||!DB||!INDOOR||SV_SOURCE!=='db'||SV_SYNC_BUSY)return;if(IM.ed&&IM.ed.isDirty&&IM.ed.isDirty())return;
  SV_SYNC_BUSY=true;try{const map=JSON.parse(JSON.stringify(INDOOR)),svs=Object.assign({},map.svs||{}),info={moved:[],added:[],pulled:[],missing:[],linked:0};let mapCh=false,first=!map.svs;
    const pts=Object.entries(SURVEY).filter(([,p])=>SVS_TYPES[p.t]&&svLL(p));
    // surveyed points that were deleted: forget them
    Object.keys(svs).forEach(id=>{if(!SURVEY[id]||!SVS_TYPES[SURVEY[id].t])delete svs[id];});
    if(first){// the drawing wins: tie each surveyed point to the nearest drawn corner and move the point there
      const used=new Set();const cand=[];pts.forEach(([id,p])=>{const lv=svLvOf(map,p.t),P=svLL(p);svRefsAt(map,lv,P,SVS_TYPES[p.t]).forEach(r=>{const ll=svRefLL(map,r);cand.push({id,p,r,ll,d:svMetres(ll,P)});});});
      cand.sort((a,b)=>a.d-b.d);const done={};
      for(const c of cand){const k=c.r.t+c.r.id+(c.r.i!=null?':'+c.r.i:':'+c.r.w);if(used.has(k)||(done[c.id]&&svMetres(done[c.id],c.ll)>0.3))continue;used.add(k);if(!done[c.id])done[c.id]=c.ll;}
      for(const [id,p] of pts){const ll=done[id];if(ll){svs[id]=r7(ll);if(svMetres(ll,svLL(p))>0.2){info.pulled.push(id);await svWrite(id,r7(ll));}}else{svs[id]=r7(svLL(p));info.missing.push(id);}}}
    else for(const [id,p] of pts){const Q=r7(svLL(p)),P=svs[id];
      if(!P){// new in Record on site: a bridge point joins its bridge; others are listed for drawing
        svs[id]=Q;if(svRefsAt(map,svLvOf(map,p.t),Q,0.3).length)continue;
        const par=p.t==='fob'?[p.from,...(Array.isArray(p.links)?p.links:[])].map(x=>x&&SURVEY[x]).find(x=>x&&svLL(x)):null,lv=svLvOf(map,p.t);
        if(par&&svRefsAt(map,lv,r7(svLL(par)),0.5).length){map.paths.push({id:'w'+Math.random().toString(36).slice(2,9),lv,pts:[r7(svLL(par)),Q]});mapCh=true;info.added.push(id);}else info.missing.push(id);continue;}
      if(svMetres(P,Q)<=0.2)continue;
      // moved in Record on site: move the drawn corners that sat at the old spot
      const refs=svRefsAt(map,svLvOf(map,p.t),P,0.5);refs.forEach(r=>{if(r.t==='path')map.paths.find(x=>x.id===r.id).pts[r.i]=Q;else map.links.find(x=>x.id===r.id)[r.w].ll=Q;});
      if(refs.length){mapCh=true;info.moved.push(id);}svs[id]=Q;}
    info.linked=Object.keys(svs).filter(id=>svRefsAt(map,svLvOf(map,SURVEY[id].t),svs[id],0.5).length).length;
    info.missing=info.missing.concat(pts.filter(([id])=>!info.missing.includes(id)&&!svRefsAt(map,svLvOf(map,SURVEY[id].t),svs[id],0.5).length).map(([id])=>id));
    info.at=new Date().toISOString();SV_SYNC_INFO=info;
    const svsCh=JSON.stringify(svs)!==JSON.stringify(INDOOR.svs||{});
    if(mapCh||svsCh){map.svs=svs;INDOOR.svs=svs;await imSave(map);}
    renderSvSync();}
  finally{SV_SYNC_BUSY=false;}}
// Save map: surveyed points whose corner was dragged in the drawing follow it
async function svPushFromMap(map){if(!INDOOR||!INDOOR.svs||SV_SOURCE!=='db')return;const old=INDOOR,svs=Object.assign({},INDOOR.svs);let ch=false;
  for(const [id,P] of Object.entries(svs)){const p=SURVEY[id];if(!p)continue;const lv=svLvOf(old,p.t);
    const was=svRefsAt(old,lv,P,0.5);if(!was.length)continue;let to=null;
    // where did each drawn corner / stair end that sat on this point go?
    for(const r of was){let nl=null;if(r.t==='link'){const k=(map.links||[]).find(x=>x.id===r.id);nl=k&&k[r.w]?k[r.w].ll:null;}
      else{const po=old.paths.find(x=>x.id===r.id),pn=(map.paths||[]).find(x=>x.id===r.id);if(!pn)continue;
        if(po&&po.pts.length===pn.pts.length)nl=pn.pts[r.i];else{let best=null;pn.pts.forEach(q=>{const d=svMetres(q,P);if(d<=10&&(!best||d<best.d))best={q,d};});nl=best?best.q:null;}}
      if(nl&&svMetres(nl,P)>0.2){to=nl;break;}}
    if(!to)continue;to=r7(to);
    // the rest of the corners and stair ends at the old spot follow, so they stay joined
    svRefsAt(map,lv,P,0.5).forEach(r=>{if(r.t==='path')map.paths.find(x=>x.id===r.id).pts[r.i]=to;else map.links.find(x=>x.id===r.id)[r.w].ll=to;});
    svs[id]=to;await svWrite(id,to);ch=true;}
  if(ch)map.svs=svs;}
function renderSvSync(){const el=$('svSyncBody');if(!el)return;const I0=SV_SYNC_INFO;if(!INDOOR||!INDOOR.svs){el.innerHTML='<p class="msg">Not linked yet. It links by itself when a staff member with edit rights opens this page.</p>';return;}
  const nm=id=>{const p=SURVEY[id]||{};return p.t==='fob'?`${p.bridge||'FOB'} · point ${p.seq||''}`:p.t==='gate'?(p.n?gateText(p.n):p.name||'Gate'):p.t==='entry'?(p.name||'Station entry'):p.t==='pfend'?`${pfName(p.pf)} · ${svEndName(p.end)}`:p.t==='pfpt'?`${pfName(p.pf)} · bend point`:'Point';};
  const n=Object.keys(INDOOR.svs).length,miss=I0?I0.missing:[];
  el.innerHTML=`<p class="okm">✓ ${I0?I0.linked:n} surveyed points are tied to the drawing. Moving one in either place moves it in the other.</p>
    ${I0&&I0.pulled.length?`<p class="msg">First link: ${I0.pulled.length} surveyed point${I0.pulled.length===1?'':'s'} moved to match your drawing.</p>`:''}
    ${I0&&I0.moved.length?`<p class="msg">From Record on site: ${I0.moved.length} point${I0.moved.length===1?'':'s'} moved on the map (${I0.moved.slice(0,6).map(nm).map(esc).join(', ')}${I0.moved.length>6?'…':''}).</p>`:''}
    ${I0&&I0.added.length?`<p class="msg">From Record on site: ${I0.added.length} new bridge point${I0.added.length===1?'':'s'} joined to its bridge.</p>`:''}
    ${miss.length?`<p class="msg err">Recorded on site but not on the drawing yet (${miss.length}): ${miss.slice(0,12).map(nm).map(esc).join(', ')}${miss.length>12?'…':''}. Draw a walkway to these spots.</p>`:''}`;}
async function imSave(map){if(!DB)throw new Error('no database');const now=new Date().toISOString();
  try{await svPushFromMap(map);}catch(e){console.warn('survey sync',e);}
  const strip=o=>{const c=Object.assign({},o);delete c.lv;return c;};
  for(const L of map.levels)await DB.doc('indoor/lv-'+L.id).set({spaces:map.spaces.filter(q=>q.lv===L.id).map(strip),paths:map.paths.filter(q=>q.lv===L.id).map(strip),at:now});
  const old=INDOOR?INDOOR.levels.map(l=>l.id):[];for(const id of old)if(!map.levels.some(l=>l.id===id)){try{await DB.doc('indoor/lv-'+id).delete();}catch(_){}}
  await DB.doc('indoor/meta').set({v:1,levels:map.levels,links:map.links,routes:map.routes||[],live:!!map.live,style:map.style||{bg:0.32,shade:0.5},svs:map.svs||(INDOOR&&INDOOR.svs)||null,updatedAt:now,updatedBy:(USER&&USER.id)||''});}
// the black station boundary: the one drawn in the map (editable), else the one from the site survey
const imBoundary=()=>{const a=INDOOR?INDOOR.spaces.filter(s=>s.kind==='stationarea'&&s.pts.length>=3).map(s=>s.pts):[];return a.length?a:stationOutlines();};
const imLive=()=>!!(INDOOR&&INDOOR.live&&INDOOR.paths.length);
function IG(){if(!INDOOR_G&&INDOOR)INDOOR_G=IND.buildGraph(INDOOR);return INDOOR_G;}
const imUpper=()=>{const L=(INDOOR||IND.emptyMap()).levels.slice().sort((a,b)=>(a.z||0)-(b.z||0));return (L.find(l=>(l.z||0)===1)||L[1]||L[0]||{id:'g'}).id;};
const imGround=()=>{const L=(INDOOR||IND.emptyMap()).levels;return (L.find(l=>(l.z||0)===0)||L[0]||{id:'g'}).id;};
function facLv(a){if(a.lv&&(!INDOOR||IND.levelOf(INDOOR,a.lv)))return a.lv;return a._n&&N[a._n]&&isFob(N[a._n].ctx)?imUpper():imGround();}
function facLL(a){return hasLL(a)?[+a.lat,+a.lng]:a._n?nodeLL(a._n):null;}
const qrLv=p=>p.lv&&(!INDOOR||IND.levelOf(INDOOR,p.lv))?p.lv:imGround();
const qrLL=p=>hasLL(p)?[+p.lat,+p.lng]:null;
// a platform as a destination: anywhere on its walkway
function imPlatTargets(g,bar){const sp=g.map.spaces.filter(s=>s.kind==='platform'&&(+s.pf===+bar||String(s.name||'').toLowerCase()===platLabel(bar).toLowerCase())&&s.pts.length>=3);const out=[];
  sp.forEach(s=>{const xy=s.pts.map(g.F.to);g.nodes.forEach(n=>{if(n.lv===s.lv&&IND.inPoly([n.x,n.y],xy))out.push({lv:n.lv,ll:n.ll});});});
  const step=Math.max(1,Math.floor(out.length/40));return out.filter((_,i)=>i%step===0);}
// routes set by staff (Station map → Set routes) for this QR board and this destination; main first, then shortest
const imKey=a=>a.cat==='platform'?'plat:'+a.bar:'fac:'+a.id;
function imTarget(g,a){if(a.cat==='platform'){const many=imPlatTargets(g,a.bar);return many.length?{many}:null;}const ll=facLL(a);return ll?{lv:facLv(a),ll}:null;}
// ---- crowd control: routes for groups of QR boards / places, a share of passengers per route, and FOBs in rush ----
const RUSH=()=>(INDOOR&&Array.isArray(INDOOR.rush)?INDOOR.rush:[]).map(x=>String(x).toLowerCase());
const isRushed=name=>RUSH().includes(String(name||'').toLowerCase());
function fobNames(){const s=new Set();((INDOOR&&INDOOR.spaces)||[]).forEach(x=>{if(x.kind==='fob'&&x.name)s.add(x.name);});return [...s].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));}
// walkways on a FOB in rush cost 400 m extra, so the automatic route goes another way when there is one
function ROPTS(g){const r=RUSH(),k=r.join('|');if(!r.length)return {stepFree:state.stepFree};
  if(g._rushK!==k){g._rushK=k;const pen=new Set();g.edges.forEach(e=>{const A=g.nodes[e.a],B=g.nodes[e.b];if(!A||!B||A.lv!==B.lv)return;const sp=g.spaceAt(A.lv,[(A.ll[0]+B.ll[0])/2,(A.ll[1]+B.ll[1])/2]);if(sp&&sp.kind==='fob'&&r.includes(String(sp.name||'').toLowerCase()))pen.add(e.a<e.b?e.a+'-'+e.b:e.b+'-'+e.a);});g._rushPen=pen;}
  return {stepFree:state.stepFree,penalty:g._rushPen};}
// which space each walkway is in (platform, concourse, bridge), to steer a route: through Platform 1, outside along the concourse, by one bridge
function edgeSpaces(g){if(g._es)return g._es;const m=new Map();g.edges.forEach(e=>{const A=g.nodes[e.a],B=g.nodes[e.b];if(!A||!B||A.lv!==B.lv)return;const sp=g.spaceAt(A.lv,[(A.ll[0]+B.ll[0])/2,(A.ll[1]+B.ll[1])/2]);if(sp)m.set(e.a<e.b?e.a+'-'+e.b:e.b+'-'+e.a,sp);});return g._es=m;}
const isPf1Space=sp=>sp.kind==='platform'&&(+sp.pf===0||/^platform\s*1$/i.test(String(sp.name||'').trim()));
function wayOpts(g,approach,fob){const o=ROPTS(g),mult=new Map(),fl=String(fob||'').toLowerCase();if(approach==='auto'&&!fob)return o;
  edgeSpaces(g).forEach((sp,k)=>{let f=1;if(approach==='outside'&&['platform','concourse','fob','hall','waiting','ticket'].includes(sp.kind))f=8;if(approach==='concourse'&&sp.kind==='platform')f=8;if(approach==='pf1'&&sp.kind==='concourse')f=8;if(fob&&sp.kind==='fob'&&String(sp.name||'').toLowerCase()!==fl)f=Math.max(f,40);if(f>1)mult.set(k,f);});
  return Object.assign({},o,{mult});}
const fobNo=n=>(String(n||'').match(/\d+/)||[''])[0];
function wayLabel(r,w){const fb=w?fobNo(w.fob):'',ap=r.approach||'auto';
  const vn=(r.via||[]).map(v=>v.name).filter(Boolean),vnH=vn.map(x=>hiAuto(x)||x);
  const en=(w?`Via FOB ${fb}`:vn.length?`Via ${vn.join(', ')}`:'Set route')+(ap==='pf1'?' · through the platform':ap==='concourse'?' · along the concourse':ap==='outside'?' · outside the building':''),hi=(w?`एफओबी ${fb} से होकर`:vn.length?`${vnH.join(', ')} से होकर`:'तय रास्ता')+(ap==='pf1'?' · प्लेटफॉर्म से':ap==='concourse'?' · कॉनकोर्स से':ap==='outside'?' · स्टेशन भवन के बाहर से':'');
  return {en:r.name&&(!r.ways||r.ways.length<=1)?r.name:en,hi:r.nameHi&&(!r.ways||r.ways.length<=1)?r.nameHi:hi};}
function routeFobs(g,pts){const s=new Set();for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[i+1];[p.ll,q&&q.lv===p.lv?[(p.ll[0]+q.ll[0])/2,(p.ll[1]+q.ll[1])/2]:null].forEach(ll=>{if(!ll)return;const sp=g.spaceAt(p.lv,ll);if(sp&&sp.kind==='fob'&&sp.name)s.add(sp.name);});}return [...s];}
const QR_GROUPS=[['area:P','All QR boards · Paharganj side concourse'],['area:A','All QR boards · Ajmeri Gate side concourse'],['area:pf','All QR boards on platforms'],['area:fob','All QR boards on foot over bridges']];
const qrGroupOf=id=>{const p=getPt(id);if(!p)return '';const a=String(p.area||'');return a==='P'||a==='A'?a:isFob(a)?'fob':a.startsWith('pl')?'pf':'';};
const platNums=a=>(platLabel(a.bar).match(/\d+/g)||[]).map(Number);
function fromRank(f,scan){if(f===scan)return 3;if(String(f).startsWith('area:'))return f.slice(5)===qrGroupOf(scan)?2:0;return f==='*'?1:0;}
function toRank(t,a){t=String(t||'');if(t===imKey(a))return 3;if(t.startsWith('plats:')){if(a.cat!=='platform')return 0;const [x,y]=t.slice(6).split('-').map(Number);return platNums(a).some(n=>n>=x&&n<=y)?2:0;}if(t.startsWith('cat:'))return t.slice(4)===a.cat?1:0;return 0;}
function groupName(k){k=String(k||'');const q=QR_GROUPS.find(x=>x[0]===k);if(q)return q[1];if(k.startsWith('plats:')){const [x,y]=k.slice(6).split('-');return x===y?`Platform ${x}`:`Platforms ${x} to ${y}`;}if(k.startsWith('cat:')){const c=CAT[k.slice(4)];return c?`Nearest ${c.en.toLowerCase()} (any)`:k;}return '';}
const ROUTE_SEED=(()=>{try{let v=localStorage.getItem('wf-rseed');if(!v){v=Math.random().toString(36).slice(2);localStorage.setItem('wf-rseed',v);}return v;}catch(_){return Math.random().toString(36).slice(2);}})();
function hash01(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return ((h>>>0)%100000)/100000;}
const shareOf=v=>v===''||v==null||isNaN(+v)?null:Math.max(0,+v);
function imAdminRoutes(g,a,from){if(!from.ll)return [];const all=(INDOOR&&INDOOR.routes||[]).map(r=>({r,k:fromRank(r.from,state.scan)*10+toRank(r.to,a)})).filter(x=>x.k%10&&x.k>=10);if(!all.length)return [];
  const top=Math.max(...all.map(x=>x.k)),R=all.filter(x=>x.k===top).map(x=>x.r);
  const to=imTarget(g,a);if(!to)return [];const out=[];
  R.forEach(r=>{const W=Array.isArray(r.ways)&&r.ways.length?r.ways:[null];W.forEach((w,i)=>{const x=IND.routeVia(g,from,r.via||[],to,w||(r.approach&&r.approach!=='auto')?wayOpts(g,r.approach||'auto',w&&w.fob):ROPTS(g));if(!x)return;const lb=wayLabel(r,w);
    out.push(Object.assign(x,{id:r.id+(w?':'+i:''),name:lb.en,nameHi:lb.hi,main:!!r.main,share:shareOf(w?w.share:r.share),rushShare:shareOf(w?w.rushShare:r.rushShare),fobs:routeFobs(g,x.pts)}));});});
  if(!out.length)return [];
  // FOB in rush: its routes are not offered while another way exists; the "during rush" shares apply
  const rushOn=out.some(x=>x.fobs.some(isRushed)),ok=out.filter(x=>!x.fobs.some(isRushed)),pool=ok.length?ok:out;
  const w=pool.map(x=>rushOn&&x.rushShare!=null?x.rushShare:x.share);
  if(w.every(v=>v==null))return pool.sort((x,y)=>(y.main-x.main)||(x.len-y.len));
  const ww=w.map(v=>v||0),sum=ww.reduce((s,v)=>s+v,0);if(!sum)return pool.sort((x,y)=>(y.main-x.main)||(x.len-y.len));
  // the same phone always gets the same route for the same trip, so the split holds across all passengers
  let u=hash01(ROUTE_SEED+'|'+state.scan+'|'+imKey(a)+'|'+RUSH().join(','))*sum,pick=0;for(let i=0;i<ww.length;i++){if(u<ww[i]){pick=i;break;}u-=ww[i];}
  const first=pool[pick];return [first,...pool.filter(x=>x!==first&&ww[pool.indexOf(x)]>0).sort((x,y)=>x.len-y.len)];}
async function setRush(name,on){if(!DB||!CAN_EDIT)return;const cur=(INDOOR&&INDOOR.rush||[]).filter(x=>String(x).toLowerCase()!==String(name).toLowerCase());if(on)cur.push(name);
  if(INDOOR)INDOOR.rush=cur;INDOOR_G=null;renderCrowd();renderPassenger();
  try{await DB.doc('indoor/crowd').set({rush:cur,updatedAt:new Date().toISOString(),updatedBy:(USER&&USER.id)||''});}catch(e){alert("Couldn't save the rush setting: "+((e&&e.message)||'error'));}}
function crowdHtml(){const f=fobNames();if(!f.length)return '<p class="msg">Draw the foot over bridges (spaces of type FOB) on the station map first.</p>';
  return `<div class="crowd-list">${f.map(n=>{const on=isRushed(n);return `<label class="crowd-row${on?' on':''}"><input type="checkbox" data-rush="${esc(n)}" ${on?'checked':''} ${CAN_EDIT&&DB?'':'disabled'}><span><b>${esc(n)}</b><small>${on?'RUSH · passengers are sent another way':'Normal'}</small></span></label>`;}).join('')}</div>`;}
function renderCrowd(){document.querySelectorAll('.crowd-body').forEach(el=>{el.innerHTML=crowdHtml();});const n=RUSH().length,b=$('heroRush');if(b){b.hidden=!CAN_EDIT;b.classList.toggle('on',!!n);b.title=n?`${n} FOB in rush`:'FOB rush control';}}
document.addEventListener('change',e=>{const t=e.target.closest('[data-rush]');if(t)setRush(t.dataset.rush,t.checked);});
function imHit(R0,a){if(!R0)return null;const g=R0.g;
  if(a.cat==='platform'){let best=null;imPlatTargets(g,a.bar).forEach(t=>{const h=IND.toPoint(R0,t.lv,t.ll);if(h&&(!best||h.cost<best.cost))best=h;});return best;}
  const ll=facLL(a);return ll?IND.toPoint(R0,facLv(a),ll):null;}
function imHideView(){if($('rchoice'))$('rchoice').innerHTML='';const w=$('wrapIndoor');if(w&&!w.hidden){w.hidden=true;if($('wrapLive'))$('wrapLive').hidden=MODE!=='live';if($('wrapMap'))$('wrapMap').hidden=MODE!=='map';}}
function imEnsureView(){heroInit();let w=$('wrapIndoor');if(!w){$('heroMaps').insertAdjacentHTML('beforeend','<div id="wrapIndoor" class="iv-wrap"></div>');w=$('wrapIndoor');}
  w.hidden=false;if($('wrapLive'))$('wrapLive').hidden=true;if($('wrapMap'))$('wrapMap').hidden=true;
  if(!IM.viewP)IM.viewP=import('./indoor-view').then(m=>{IM.view=m.createIndoorView(w,{onPick:id=>heroPick(id),onTask:id=>todoPop(id)});return IM.view;});return IM.viewP;}
function renderIndoor(pt){
  heroInit();todoBar();
  {const hn=$('hhName');if(hn){hn.textContent=pt.name;$('hhSub').textContent=!SCANNED&&FROM_LINK?'Example start · scan a QR board near you for your own route':areaLabel(pt.area)+(gateUseOf(pt)?' · '+gateUseText(pt):'');$('hhTell').href='/tell?p='+encodeURIComponent(pt.id);$('hhTell').hidden=!FEAT.tell;}}{const sf=$('heroSF');if(sf)sf.setAttribute('aria-pressed',String(!!state.stepFree));}
  state.scan=pt.id;$('hereName').textContent=pt.name;
  $('cats').innerHTML=catTiles();$('cats').classList.add('grouped');
  placeDrop();const routeP=$('routeTitle').closest('.panel'),stepP=$('steps').closest('.panel');OPT_PANEL.hidden=true;
  const g=IG(),from={lv:qrLv(pt),ll:qrLL(pt)},R0=from.ll?IND.fromPoint(g,from.lv,from.ll,ROPTS(g)):null;
  const vfacs=FAC.filter(a=>facLL(a)&&inWindow(a)).map(a=>({id:a.id,ll:facLL(a),lv:facLv(a),name:a.name,hi:facHi(a),color:catColor(a.cat),icon:catIcon(a.cat),open:isOpen(a),on:!!state.cat&&a.cat===state.cat,dim:!!state.cat&&a.cat!==state.cat,dest:a.id===state.dest}));
  const here=from.ll?{lv:from.lv,ll:from.ll}:null,bnd=imBoundary();
  const show=(route,dest)=>imEnsureView().then(v=>v.set({tasks:STAFF_TODO?staffTasks():[],map:INDOOR,facs:vfacs.map(f=>Object.assign(f,{dest:!!dest&&f.id===dest.id})),here,route,routeKey:route?state.scan+'|'+(dest&&dest.id)+'|'+state.stepFree+'|'+RUSH().join(','):'',boundary:bnd}));
  if($('rchoice'))$('rchoice').innerHTML='';
  if(!state.cat||!CAT[state.cat]){state.cat=null;routeP.hidden=stepP.hidden=true;STEPS=[];LAST_ROUTE=null;lastRouteKey='';heroCard(null);if($('navBtn'))$('navBtn').hidden=true;show(null,null);return;}
  routeP.hidden=stepP.hidden=false;
  const list=PASS().filter(a=>a.cat===state.cat&&(a.cat==='platform'||facLL(a))&&gateUseOf(a)!=='entry').map(a=>{const h=imHit(R0,a),ar=imAdminRoutes(g,a,from);return {a,h,ar,d:ar.length?ar[0].len:h?h.len:Infinity};});
  if(state.cat!=='platform')list.sort((x,y)=>(isOpen(y.a)-isOpen(x.a))||(x.d-y.d));
  const open=list.filter(x=>isOpen(x.a)&&isFinite(x.d)),nearest=open.reduce((b,x)=>!b||x.d<b.d?x:b,null),curr=list.find(x=>x.a.id===state.dest);
  if(!curr||!isOpen(curr.a)||!isFinite(curr.d))state.dest=nearest?nearest.a.id:'';
  const c=CAT[state.cat],mins=d=>Math.max(1,Math.round(d/1.2/60));$('optTitle').textContent=c.en;
  $('optCount').textContent=list.length?`${open.length} open${list.length>open.length?` · ${list.length-open.length} closed`:''}`:'';
  $('opts').innerHTML=list.length?list.map(x=>{const a=x.a,ok=isOpen(a)&&isFinite(x.d);const w=a.cat==='platform'?(a.note||(a.bar===0?'Paharganj side':'Ajmeri Gate side')):facWhere(a);const L=IND.levelOf(INDOOR,facLv(a));
    return `<button type="button" class="opt" data-id="${a.id}" aria-pressed="${state.dest===a.id}" ${ok?'':'disabled'}>
      <span class="n">${optNameHtml(a)}${facCount(a)?`<span class="tag cnt">${esc(countText(a))}</span>`:''}${x===nearest?'<span class="tag">Nearest</span>':''}</span>
      <span class="d">${ok?`${r10(x.d)} m<small>${mins(x.d)} min</small>`:'<small>—</small>'}</span>
      <span class="w">${esc(w)}${a.cat!=='platform'&&L&&(L.z||0)!==0?` · ${esc(L.name)}`:''}</span>
      ${isOpen(a)?(isFinite(x.d)?(a.note&&a.cat!=='platform'?`<span class="note">${esc(a.note)}</span>`:''):'<span class="note st">Not on the station map yet</span>'):`<span class="note st">${esc(STATUS[a.status])}${a.statusNote?' · '+esc(a.statusNote):''}</span>`}</button>`;}).join('')
    :`<p class="empty">No ${esc(c.en.toLowerCase())} listed at this station.</p>`;
  const dx=list.find(x=>x.a.id===state.dest);
  if(!dx){heroCard(null);$('routeTitle').innerHTML=`No open ${esc(c.en.toLowerCase())} right now<small>Ask at the nearest enquiry counter</small>`;$('stats').hidden=true;$('steps').innerHTML='';STEPS=[];LAST_ROUTE=null;if($('navBtn'))$('navBtn').hidden=true;show(null,null);return;}
  if(state.rFor!==dx.a.id){state.rFor=dx.a.id;state.rIdx=0;}const RS=dx.ar||[],ri=Math.min(state.rIdx||0,Math.max(0,RS.length-1)),useR=RS[ri],rlen=useR?useR.len:dx.d;
  const dest=dx.a,pts=useR?useR.pts:IND.pathTo(R0,dx.h),mv=IND.moves(g,pts,{name:dest.name,nameHi:facHi(dest)}),stairs=pts.filter(p=>p.link&&p.link.kind==='stairs').length,lifts=pts.filter(p=>p.link&&p.link.kind!=='stairs').length;
  $('stats').hidden=false;$('routeTitle').innerHTML=`${esc(dest.name)}<small>${facCount(dest)?`<b>${esc(countText(dest))}</b> · `:''}${esc(dest.cat==='platform'?platLabel(dest.bar):facWhere(dest))}</small>`;
  $('stM').textContent=r10(rlen);$('stT').textContent=mins(rlen);imChoices(RS,ri);
  if(state.stepFree){$('stS').textContent=lifts;$('stSL').textContent='lifts / esc.';}else{$('stS').textContent=stairs;$('stSL').textContent=stairs===1?'staircase':'staircases';}
  const M=mv.moves;STEPS=M.map((m,i)=>({t:m.en,s:m.hi+(M[i+1]?` · ${r10(Math.max(0,M[i+1].d-m.d))} m`:''),cls:i===0?'s-start':m.type==='arrive'?'s-end':''}));
  $('steps').innerHTML=STEPS.map((s,i)=>`<li tabindex="0" data-i="${i}" class="${s.cls||''}"><span class="num">${i+1}</span><div><div class="t">${esc(s.t)}</div>${s.s?`<div class="s">${esc(s.s)}</div>`:''}</div></li>`).join('');
  LAST_ROUTE={indoor:true,pts,mv,dest,len:rlen,start:pt,via:useR?useR.name:''};if($('navBtn'))$('navBtn').hidden=false;if($('arBtn'))$('arBtn').hidden=true;
  {const k=pts.length+'|'+dest.id+'|'+ri;if(IM.warm!==k){IM.warm=k;setTimeout(()=>{try{const nr=imNavRoute();(nr&&nr.moves||[]).forEach(m=>{if(m.ph&&m.ph.url)fetch(m.ph.url).catch(()=>{});});}catch(_){}},400);}}
  heroCard(dest,{m:rlen,min:mins(rlen),choices:RS.length>1?RS.map(r=>({name:r.name,nameHi:r.nameHi,m:r.len})):null,idx:ri,via:useR&&RS.length===1?useR.name:''});show({pts},dest);}
// choice of the routes staff set, under the route title
function imChoices(RS,ri){let rc=$('rchoice');if(!rc){$('stats').insertAdjacentHTML('afterend','<div class="rchoice" id="rchoice"></div>');rc=$('rchoice');}
  rc.innerHTML=RS.length>1?`<p class="rc-h">Choose your way · रास्ता चुनें</p>${RS.map((r,i)=>`<button type="button" data-ri="${i}" aria-pressed="${i===ri}"><b>${esc(r.name)}</b>${r.nameHi?`<span>${esc(r.nameHi)}</span>`:''}<small>${r10(r.len)} m · ${Math.max(1,Math.round(r.len/1.2/60))} min</small></button>`).join('')}`:RS.length===1?`<p class="rc-h">Route set by station staff · ${esc(RS[0].name)}${RS[0].nameHi?' · '+esc(RS[0].nameHi):''}</p>`:'';}
document.addEventListener('click',e=>{const b=e.target.closest('#rchoice [data-ri],#heroCard [data-ri]');if(!b)return;state.rIdx=+b.dataset.ri;renderPassenger();});
// Navigate screen from a drawn-map route
function imNavRoute(){const R=LAST_ROUTE;if(!R||!R.indoor)return null;const L0=INDOOR.levels.slice().sort((a,b)=>(a.z||0)-(b.z||0)),li=id=>Math.max(0,L0.findIndex(l=>l.id===id));
  const line=R.pts.map(p=>p.ll),level=R.pts.map(p=>li(p.lv));
  // photos staff took near each turn or stairs (Photos tab) still show on the cards
  const nodesLL=Object.keys(N).filter(id=>!N[id].virt&&PHOTOS[photoKey(id)]).map(id=>({id,ll:nodeLL(id)})).filter(q=>q.ll);
  const moves=R.mv.moves.map(m=>{const p=R.pts[Math.min(R.pts.length-1,m.i||0)];let ph=null;
    if(m.type==='arrive'){const x=PHOTOS['f-'+R.dest.id];if(x&&x.assetId)ph={url:blobUrl(x.assetId),hs:null};}
    else if(p){let best=null;nodesLL.forEach(q=>{const d=IND.metres(q.ll,p.ll);if(d<8&&(!best||d<best.d))best={d,q};});if(best){const x=PHOTOS[photoKey(best.q.id)];if(x&&x.assetId)ph={url:blobUrl(x.assetId),hs:null};}}
    return Object.assign({},m,{ph});});
  const spaces=INDOOR.spaces.filter(s=>s.pts.length>=3&&!IND.OUTLINE(s.kind)).map(s=>({pts:s.pts,color:IND.styleOf(s,INDOOR.style).fill,lv:li(s.lv),name:s.label===false?'':s.name,kind:s.kind}));
  const near=ll=>line.some(q=>IND.metres(q,ll)<40);
  return {motionOnly:true,line,level,levelNames:L0.map(l=>({en:l.name,hi:l.hi||l.name})),moves,total:R.mv.total,dest:{name:R.dest.name,nameHi:facHi(R.dest)},start:{name:R.start?R.start.name:''},
    overlay:{boundary:imBoundary(),boundaryColor:(()=>{const s=INDOOR.spaces.find(q=>q.kind==='stationarea');return s?IND.styleOf(s,INDOOR.style).line:null;})(),buildings:INDOOR.spaces.filter(s=>s.kind==='building').map(s=>s.pts),spaces,platforms:[],bridges:[],bridgeNames:[],walks:INDOOR.paths.map(q=>q.pts),gates:[],outside:[],
      labels:spaces.filter(s=>s.name&&['platform','fob','concourse','hall'].includes(s.kind)).map(s=>({ll:IND.centroid(s.pts),name:s.name,lv:s.lv})),
      amenities:FAC.filter(a=>facLL(a)).map(a=>({ll:facLL(a),name:a.name,code:CAT[a.cat]?CAT[a.cat].code||'•':'•',open:isOpen(a),dest:a.id===R.dest.id,near:near(facLL(a)),color:catColor(a.cat)}))}};}

// ---- pre-fill the drawn map from the site survey and the station model ----
function indoorFromSurvey(){const m=IND.emptyMap(),G0='g',F1='f';const model=RMAP.buildModel(SURVEY,rmHelpers()),rid=p=>p+Math.random().toString(36).slice(2,9),r7=q=>[+(+q[0]).toFixed(7),+(+q[1]).toFixed(7)];
  const realLL=id=>{const n=N[id];if(!n)return null;if(n.sid&&SURVEY[n.sid]&&hasLL(SURVEY[n.sid]))return [+SURVEY[n.sid].lat,+SURVEY[n.sid].lng];return nodeLL(id);};
  const F=IND.frame(model.platforms[0]&&model.platforms[0].line[0]||[NDLS_C.lat,NDLS_C.lng]);
  const onLine=(line,ll)=>{const p=F.to(ll);let best=null;for(let i=1;i<line.length;i++){const a=F.to(line[i-1]),b=F.to(line[i]),vx=b[0]-a[0],vy=b[1]-a[1],L2=vx*vx+vy*vy||1,t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/L2)),x=a[0]+vx*t,y=a[1]+vy*t,d=Math.hypot(p[0]-x,p[1]-y);if(!best||d<best.d)best={d,ll:F.ll(x,y)};}return best?best.ll:ll;};
  const plat=bar=>model.platforms.find(p=>p.bar===bar);
  // ground: each platform along its surveyed line
  model.platforms.forEach(p=>{if(!p.line||p.line.length<2)return;m.paths.push({id:rid('w'),lv:G0,pts:p.line.map(r7),pf:p.bar});
    m.spaces.push({id:rid('s'),lv:G0,kind:'platform',name:p.name,nameHi:navPlatHi(p.bar),pf:p.bar,pts:IND.bufferLine(F,p.line,p.island?5:3.5)});});
  // ground: the two concourses and the ways onto Platform 1 / 16
  const seen=new Set(),conc={P:[],A:[]};
  Object.keys(ADJ).forEach(a=>(ADJ[a]||[]).forEach(e=>{const A=N[a],B=N[e.b];if(!A||!B||A.virt||B.virt||a.startsWith('fac_')||e.b.startsWith('fac_'))return;const k=[a,e.b].sort().join('|');if(seen.has(k))return;seen.add(k);
    if(e.kind==='walk'&&A.ctx===B.ctx&&(A.ctx==='P'||A.ctx==='A')){const pa=nodeLL(a),pb=nodeLL(e.b);if(pa&&pb){m.paths.push({id:rid('w'),lv:G0,pts:[r7(pa),r7(pb)]});conc[A.ctx].push([pa,pb]);}}
    else if(e.kind==='enter'){const c=A.ctx==='P'||A.ctx==='A'?a:e.b,pn=c===a?e.b:a,pl=plat(N[pn].p),pa=nodeLL(c);if(pa&&pl)m.paths.push({id:rid('w'),lv:G0,pts:[r7(pa),r7(onLine(pl.line,nodeLL(pn)||pa))]});}}));
  // every piece carries the name (for the directions); only one shows it as a label
  ['P','A'].forEach(side=>{let first=true;conc[side].forEach(sg=>{m.spaces.push({id:rid('s'),lv:G0,kind:'concourse',name:`${sideName(side)} concourse`,nameHi:placeHi(side),label:first?undefined:false,pts:IND.bufferLine(F,sg,6)});first=false;});});
  // gates: a short walkway in from each surveyed gate
  Object.values(SURVEY).filter(q=>q.t==='gate'&&hasLL(q)).forEach(q=>{const ll=[+q.lat,+q.lng];let best=null;m.paths.filter(p=>p.lv===G0).forEach(p=>{const t=onLine(p.pts,ll),d=IND.metres(t,ll);if(!best||d<best.d)best={d,t};});if(best&&best.d>1&&best.d<60)m.paths.push({id:rid('w'),lv:G0,pts:[r7(ll),r7(best.t)]});});
  // FOB level: surveyed bridges, or the bridges of the station layout
  const fobDone=new Set(),fHi=n=>{const d=String(n||'').match(/\d+/);return d?`फुट ओवर ब्रिज ${d[0]}`:'फुट ओवर ब्रिज';};
  model.bridges.forEach(b=>{let longest=null;b.segs.forEach(sg=>{m.paths.push({id:rid('w'),lv:F1,pts:[r7(sg.a),r7(sg.b)]});const sp={id:rid('s'),lv:F1,kind:'fob',name:b.name,nameHi:fHi(b.name),label:false,pts:IND.bufferLine(F,[sg.a,sg.b],2.6)};m.spaces.push(sp);const L=IND.metres(sg.a,sg.b);if(!longest||L>longest.L)longest={L,sp};});if(longest)delete longest.sp.label;fobDone.add(String(b.name).toLowerCase());});
  FOBS.forEach(f=>{if(fobDone.has(String(f.name).toLowerCase())||f.shape==='path')return;let named=false;Object.keys(ADJ).forEach(a=>(ADJ[a]||[]).forEach(e=>{if(e.kind!=='bridge'||N[a].ctx!==f.id||a>e.b)return;const pa=realLL(a),pb=realLL(e.b);if(!pa||!pb)return;m.paths.push({id:rid('w'),lv:F1,pts:[r7(pa),r7(pb)]});m.spaces.push({id:rid('s'),lv:F1,kind:'fob',name:f.name,nameHi:fHi(f.name),label:named?false:undefined,pts:IND.bufferLine(F,[pa,pb],2.6)});named=true;}));});
  // stairs, lifts, escalators between the bridges and the ground
  const lk=new Set();
  Object.keys(ADJ).forEach(a=>(ADJ[a]||[]).forEach(e=>{if(!/^(stairs|lift|esc)$/.test(e.kind))return;const A=N[a],B=N[e.b];if(!A||!B||!isFob(A.ctx)||isFob(B.ctx))return;const k=a+'|'+e.b+'|'+e.kind;if(lk.has(k))return;lk.add(k);
    const top=realLL(a);let low=nodeLL(e.b);if(!top||!low)return;const pl=/^pl\d$/.test(B.ctx)?plat(B.p):null;if(pl)low=onLine(pl.line,low);
    m.links.push({id:rid('k'),kind:e.kind,name:`${fobShort(FOB_BY[A.ctx]||{name:'FOB'})} · ${where(e.b)}`.slice(0,60),a:{lv:F1,ll:r7(top)},b:{lv:G0,ll:r7(low)}});}));
  // the station building drawn in the survey
  stationBuildings().forEach(b=>m.spaces.push({id:rid('s'),lv:G0,kind:'building',name:'Station building',pts:b.map(r7)}));
  // the black station boundary becomes part of the map, so staff can move or delete its corners
  stationOutlines().slice(0,1).forEach(b=>m.spaces.push({id:rid('s'),lv:G0,kind:'stationarea',name:'Station area',pts:b.map(r7)}));
  // join loose ends: a walkway that stops short of another one is extended onto it (up to 25 m)
  [G0,F1].forEach(lv=>{const P=m.paths.filter(p=>p.lv===lv);P.forEach(p=>{if(p.pf!=null)return;[0,p.pts.length-1].forEach(end=>{const e=p.pts[end];let near=false,best=null;
    P.forEach(q=>{if(q===p)return;const t=onLine(q.pts,e),d=IND.metres(t,e);if(d<1.5)near=true;if(!best||d<best.d)best={d,t};});
    if(!near&&best&&best.d<25){if(end===0)p.pts.unshift(r7(best.t));else p.pts.push(r7(best.t));}});});});
  m.paths.forEach(p=>delete p.pf);return m;}

// ---- staff tab: Indoor map ----
function imInitTab(){if(!CAN_EDIT||$('tab-indoormap'))return;const tabs=$('tabs');if(!tabs)return;
  tabs.insertAdjacentHTML('beforeend','<button role="tab" data-view="indoormap" aria-selected="false" id="tab-indoormap">Station map</button>');
  $('v-survey').insertAdjacentHTML('afterend',`<section id="v-indoormap" hidden><h2 class="view">Station map</h2>
    <p class="lede">Draw the real station, floor by floor, on the satellite photo, like a shopping-mall map. <b>Walkways</b> are the lines people walk along: routes follow them exactly. <b>Spaces</b> are the platforms, concourses, bridge decks, rooms and shops passengers see in 3D. <b>Stairs, lifts and escalators</b> join the floors. Tick <b>Passengers use this map</b> and save when it is ready.</p>
    <details class="panel crowd-box" id="svSyncBox"><summary><b>Record on site ↔ Draw the map</b> <small>Points recorded on site (bridge points, platform ends, gates) and the drawn map are kept the same, both ways.</small></summary><div id="svSyncBody"></div></details>
    <details class="panel crowd-box" id="crowdBox" open><summary><b>Crowd control · FOB rush</b> <small>Tick a foot over bridge when it is crowded. Passengers are sent another way at once (set routes use their “during rush” share). Untick when it clears.</small></summary><div class="crowd-body"></div></details>
    <div id="imRoot"></div></section>`);mapStepsInit();renderCrowd();renderSvSync();}
function mapStepsInit(){const bar=`<div class="msteps" role="group" aria-label="Station map steps">
    <button type="button" data-view="survey"><b>1 · Record on site</b><small>Walk the station with GPS: platform ends, gates, bridges, amenities, boundaries</small></button>
    <span class="ms-arrow" aria-hidden="true">→</span>
    <button type="button" data-view="indoormap"><b>2 · Draw the map</b><small>Walkways, spaces, floors, stairs and lifts: what passengers see and route on</small></button>
    <button type="button" class="ms-adv" data-view="layout">Advanced · old layout</button></div>`;
  ['v-survey','v-indoormap','v-layout'].forEach(id=>{const sec=$(id);if(!sec||sec.querySelector('.msteps'))return;sec.insertAdjacentHTML('afterbegin',bar);});
  const h=(id,t)=>{const e=$(id)&&$(id).querySelector('h2.view');if(e)e.textContent=t;};
  h('v-survey','Step 1 · Record on site');h('v-indoormap','Step 2 · Draw the map');h('v-layout','Advanced · old station layout');
  {const l=$('v-survey')&&$('v-survey').querySelector('p.lede');if(l&&!l.dataset.m){l.dataset.m=1;l.insertAdjacentHTML('beforeend',' Then go to <b>Step 2 · Draw the map</b> and tap <b>Fill from site survey</b>.');}}
  {const l=$('v-layout')&&$('v-layout').querySelector('p.lede');if(l&&!l.dataset.m){l.dataset.m=1;l.insertAdjacentHTML('beforebegin','<div class="notice ms-note"><span>This is the old, simplified station model. Once <b>Step 2 · Draw the map</b> is switched on for passengers, they no longer use it. It is kept as a backup and to pre-fill Step 2; most staff never need to open it.</span></div>');}}
  document.addEventListener('click',e=>{const b=e.target.closest('.msteps [data-view]');if(b)showView(b.dataset.view);});}
async function imShow(){const root=$('imRoot');if(!root)return;if(IM.ed){IM.ed.resize();IM.ed.refresh();return;}
  const L=await svLoad();if(!L){root.innerHTML='<p class="msg err">The map editor couldn\'t load. Check the connection and open this tab again.</p>';return;}
  const {createEditor}=await import('./indoor-edit');
  const clean=a=>{const c={};Object.keys(a).forEach(k=>{if(k!=='id'&&!k.startsWith('_'))c[k]=a[k];});return c;};
  IM.ed=createEditor(root,{L,bases:()=>RMAP.baseLayers(L),save:imSave,prefill:indoorFromSurvey,boundary:stationOutlines,canWrite:()=>!!(CAN_EDIT&&DB),
    facs:()=>FAC.filter(a=>facLL(a)).map(a=>({id:a.id,name:a.name,ll:facLL(a),lv:facLv(a),color:catColor(a.cat),code:CAT[a.cat]?CAT[a.cat].code||'•':'•'})),
    qrs:()=>QRPTS.filter(p=>qrLL(p)).map(p=>({id:p.id,name:p.name,ll:qrLL(p),lv:qrLv(p)})),
    dests:()=>ALL().filter(a=>a.cat==='platform'||facLL(a)).map(a=>({key:imKey(a),name:a.cat==='platform'?a.name:`${a.name} · ${(CAT[a.cat]||{}).en||''} · ${facWhere(a)}`})).sort((x,y)=>(x.key<'g'?0:1)-(y.key<'g'?0:1)||x.name.localeCompare(y.name,undefined,{numeric:true})),
    searchHtml:t=>searchHtml(t,imKey),
    qrGroups:()=>QR_GROUPS.map(([key,name])=>({key,name,first:(QRPTS.find(p=>qrLL(p)&&qrGroupOf(p.id)===key.slice(5))||{}).id||''})),
    catGroups:()=>CATS.filter(c=>c[0]!=='platform').map(c=>({key:'cat:'+c[0],name:`Nearest ${c[1].toLowerCase()} (any)`})),
    groupName,
    placeName:key=>{const a=ALL().find(x=>imKey(x)===key);return a?a.name+(facHi(a)?' · '+facHi(a):''):'';},
    fobNames:()=>fobNames(),
    testRoute:(qrId,key,g,stepFree)=>{const a=ALL().find(x=>imKey(x)===key),q=QRPTS.find(p=>p.id===qrId);if(!a||!q||!qrLL(q))return null;const keep=[state.scan,state.stepFree];state.scan=qrId;state.stepFree=!!stepFree;
      try{const R=imAdminRoutes(g,a,{lv:qrLv(q),ll:qrLL(q)});return R.length?{route:R[0],name:R[0].name,others:R.length-1}:null;}finally{[state.scan,state.stepFree]=keep;}},
    ruleRoute:(d,way,g,from,to)=>IND.routeVia(g,from,d.via||[],to,wayOpts(g,d.approach||'auto',way?way.fob:null)),
    targetOf:(key,g)=>{key=String(key||'');if(key.startsWith('plats:')||key.startsWith('cat:')){const many=[];ALL().filter(a=>toRank(key,a)).forEach(a=>{const t=imTarget(g,a);if(t)(t.many||[t]).forEach(x=>many.push(x));});return many.length?{many}:null;}const a=ALL().find(x=>imKey(x)===key);return a?imTarget(g,a):null;},
    setFac:async(id,ch)=>{const a=FAC.find(x=>x.id===id);if(!a||!DB)return;const rec=clean(a);if(ch.lv)rec.lv=ch.lv;if(ch.ll){rec.lat=ch.ll[0];rec.lng=ch.ll[1];}rec.updatedAt=new Date().toISOString();Object.assign(a,ch.lv?{lv:ch.lv}:{},ch.ll?{lat:ch.ll[0],lng:ch.ll[1]}:{});IM.ed.refresh();try{await DB.doc('facilities/'+id).set(rec);}catch(e){alert("Couldn't save the facility: "+((e&&e.message)||'error'));}},
    setQr:async(id,ch)=>{const p=QRPTS.find(x=>x.id===id);if(!p||!DB)return;const rec=clean(p);if(ch.lv)rec.lv=ch.lv;rec.updatedAt=new Date().toISOString();Object.assign(p,ch.lv?{lv:ch.lv}:{});IM.ed.refresh();try{await DB.doc('qrpoints/'+id).set(rec);}catch(e){alert("Couldn't save the QR board: "+((e&&e.message)||'error'));}}});
  IM.ed.load(INDOOR);setTimeout(()=>IM.ed.resize(),80);}

// ================= full screen for maps and the 3D view =================
function fsToggle(el,on){if(on===undefined)on=!el.classList.contains('fs-on');el.classList.toggle('fs-on',on);document.body.classList.toggle('fs-lock',!!document.querySelector('.fs-on'));
  const b=el._fsbtn||el.querySelector(':scope > .fsbtn');if(b){b.textContent=on?'✕ Close full screen':'⤢ Full screen';b.setAttribute('aria-pressed',on);}
  try{if(on&&el.requestFullscreen&&!document.fullscreenElement)el.requestFullscreen().catch(()=>{});else if(!on&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch(_){}
  setTimeout(()=>{if(sv.map)sv.map.invalidateSize();Object.values(RMV).forEach(v=>v&&v.map&&v.map.invalidateSize());if(typeof size3d==='function')size3d();},120);}
function addFs(el,target){if(!el||el.querySelector(':scope > .fsbtn'))return;target=target||el;const b=document.createElement('button');b.type='button';b.className='btn sm fsbtn';b.textContent='⤢ Full screen';b.setAttribute('aria-pressed','false');
  b.addEventListener('click',e=>{e.stopPropagation();fsToggle(target);});target._fsbtn=b;el.appendChild(b);}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)document.querySelectorAll('.fs-on').forEach(el=>fsToggle(el,false));});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.fs-on').forEach(el=>fsToggle(el,false));});
[$('stage3d'),$('map')&&$('map').parentElement].forEach(el=>addFs(el));
// Site survey and Station layout: full screen keeps the editing panel next to the map
if($('svMap'))addFs($('svMap'),$('svMap').closest('.grid'));if($('lyMap'))addFs($('lyMap').parentElement,$('lyMap').closest('.grid'));

// ================= boot =================
function renderAll(){renderPassenger();if(VIEW==='admin')renderAdmin();else renderCounts();if(VIEW==='survey'){if(!sv.draft)renderSvEd();svDrawMap();}}
try{readHash();}catch(e){}
applyModeDom();
rebuildFacNodes();fitGeo();
renderPassenger();
initCaps();

}
