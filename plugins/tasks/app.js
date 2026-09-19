function za(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Ie(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function Te(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function ve(e,a,o){return za().callRpc(e,a,o)}function Re(e){return{__zccPluginApp:!0,setup:e}}function ne(){return Ie().useRpc?.()??Te("useRpc")}function De(e,a){Ie().useRealtime?.(e,a)}function ie(){return Ie().useZccNavigate?.()??Te("useZccNavigate")}var x=globalThis.__ZCC_HOST_REACT__;var pt=x.Children,mt=x.Component,xt=x.Fragment,Lt=x.StrictMode,gt=x.Suspense,It=x.cloneElement,Me=x.createContext,W=x.createElement,Ct=x.createRef,fe=x.forwardRef,ht=x.isValidElement,St=x.lazy,kt=x.memo,Pt=x.startTransition,X=x.useCallback,Be=x.useContext,wt=x.useDebugValue,bt=x.useDeferredValue,P=x.useEffect,Fe=x.useId,yt=x.useImperativeHandle,At=x.useInsertionEffect,Tt=x.useLayoutEffect,Ce=x.useMemo,vt=x.useReducer,K=x.useRef,I=x.useState,Rt=x.useSyncExternalStore,Dt=x.useTransition,Mt=x.version;var q=["backlog","todo","in_progress","in_review","done","canceled"],H=["urgent","high","medium","low","none"],he=["manual","priority","due"];var Oe="tasks-changed";var w={backlog:"Backlog",todo:"Todo",in_progress:"In Progress",in_review:"In Review",done:"Done",canceled:"Canceled"},A={urgent:"Urgent",high:"High",medium:"Medium",low:"Low",none:"No priority"},Se={manual:"Manual",priority:"Priority",due:"Due date"},qe={urgent:0,high:1,medium:2,low:3,none:4},Ga=["backlog","todo","in_progress","in_review","done"],N={statuses:[],priorities:[]};function Ue(e){return typeof e=="string"&&q.includes(e)}function Ee(e){return typeof e=="string"&&H.includes(e)}function He(e){return typeof e=="string"&&he.includes(e)}function ce(e){return e.statuses.length>0||e.priorities.length>0}function Ne(e,a){return!(a.statuses.length>0&&!a.statuses.includes(e.status)||a.priorities.length>0&&!a.priorities.includes(e.priority))}function pe(e,a){let o=[...e];return a==="priority"?o.sort((r,s)=>qe[r.priority]-qe[s.priority]||r.order-s.order):a==="due"?o.sort((r,s)=>r.dueDate===null&&s.dueDate===null?r.order-s.order:r.dueDate===null?1:s.dueDate===null?-1:r.dueDate.localeCompare(s.dueDate)||r.order-s.order):o.sort((r,s)=>r.order-s.order||r.createdAt-s.createdAt),o}function me(e){let a=new Map;for(let o of e){let r=a.get(o.status);r?r.push(o):a.set(o.status,[o])}return q.flatMap(o=>{let r=a.get(o);return r?[{status:o,tasks:r}]:[]})}function Va(){return{backlog:[],todo:[],in_progress:[],in_review:[],done:[],canceled:[]}}function ze(e){let a=Va();for(let o of e)a[o.status].push(o);return a}function Ge(e){return[...Ga,...e.canceled.length>0?["canceled"]:[]]}function xe(e,a=new Date){let o=new Date(`${e}T00:00:00`);return Number.isNaN(o.getTime())?e:o.toLocaleDateString("en-US",{month:"short",day:"numeric",...o.getFullYear()===a.getFullYear()?{}:{year:"numeric"}})}var Ve="zcc-tasks:view",_e="zcc-tasks:filters",We="zcc-tasks:sort";function ke(e){try{return globalThis.localStorage?.getItem(e)??null}catch{return null}}function Pe(e,a){try{globalThis.localStorage?.setItem(e,a)}catch{}}function j(){return ke(Ve)==="board"?"board":"list"}function Xe(e){Pe(Ve,e)}function Ke(){let e=ke(We);return He(e)?e:"manual"}function je(e){Pe(We,e)}function Ze(){let e=ke(_e);if(!e)return{...N};try{let a=JSON.parse(e),o=Array.isArray(a.statuses)?a.statuses.filter(Ue):[],r=Array.isArray(a.priorities)?a.priorities.filter(Ee):[];return{statuses:o,priorities:r}}catch{return{...N}}}function $e(e){Pe(_e,JSON.stringify(e))}function _a(e){let a=e.split("/").filter(Boolean);return a[0]==="task"&&a[1]?{kind:"task",taskKey:a[1]}:a[0]==="board"?{kind:"browse",view:"board"}:a[0]==="list"?{kind:"browse",view:"list"}:{kind:"browse"}}function we(e,a){let o=_a(e);return o.kind==="task"?o:{kind:"browse",view:o.view??a}}function Je(e){return e.kind==="task"?`task/${e.taskKey}`:e.view==="board"?"board":""}var Qe=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Ye(e,a,o=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:Qe(e),size:24,node:a,...o.length>0?{aliases:o}:{}}}var ea=e=>{let a="",o=!1;for(let r of e){if(r==="-"||r==="_"||r<=" "){o=a.length>0;continue}a.length===0?a+=r.toLowerCase():a+=o?r.toUpperCase():r,o=!1}return a};var aa=e=>{let a=ea(e);return a.charAt(0).toUpperCase()+a.slice(1)};var $=(...e)=>e.filter((a,o,r)=>!!a&&a.trim()!==""&&r.indexOf(a)===o).join(" ").trim();var O={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function be(e){return e!=null}function ta(e,a={}){let o=a.attributeNames??{},r=m=>o[m]??m,s=e.size??e.width??O.width,i=e.size??e.height??O.height,u=e.aliases?.filter(m=>typeof m=="string"&&m.trim()!=="").map(m=>`lucide-${m}`)??[],d=[...e.name?[`lucide-${e.name}`]:[],...u],c=a.className?.split(" ").filter(Boolean)??[],n=a.includeDefaultClasses===!1?$(...c):$("lucide",...d,...c),p=a.absoluteStrokeWidth?Number(a.strokeWidth??O["stroke-width"])*Number(e.size??e.width??O.width)/Number(a.size??a.width??O.width):a.strokeWidth??O["stroke-width"];return["svg",{...Object.entries(O).reduce((m,[C,L])=>(m[r(C)]=L,m),{}),..."color"in a&&a.color&&{[r("stroke")]:a.color},..."size"in a&&be(a.size)&&{[r("width")]:a.size,[r("height")]:a.size},..."width"in a&&be(a.width)&&{[r("width")]:a.width},..."height"in a&&be(a.height)&&{[r("height")]:a.height},[r("stroke-width")]:p,...n&&{[r("class")]:n},[r("viewBox")]:`0 0 ${s} ${i}`,...a.hasA11yProp===!1?{[r("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(m=>{let[C,L,y]=m,T=a.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...L}:L;return y?[C,T,y]:[C,T]})]}function oa(e,a={}){return ta(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var ra=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Wa=Me({});var ua=()=>Be(Wa);var sa=fe(({color:e,size:a,width:o,height:r,strokeWidth:s,absoluteStrokeWidth:i,nonScalingStroke:u,className:d="",children:c,iconNode:n=[],icon:p={node:n,aliases:[],size:24},...S},m)=>{let{size:C=24,strokeWidth:L=2,absoluteStrokeWidth:y=!1,nonScalingStroke:T=!1,color:k="currentColor",className:le=""}=ua()??{},v=!!c||ra(S),[Le,F,Z=[]]=oa(p,{color:e??k,width:o??a??C,height:r??a??C,strokeWidth:s??L,absoluteStrokeWidth:i??y,nonScalingStroke:u??T,className:$(le,d),hasA11yProp:v,attributes:S});return W(Le,{ref:m,...F},[...Z.map(([de,ge])=>W(de,ge)),...Array.isArray(c)?c:[c]])});function g(e,a=[],o=[]){let r=typeof e=="string"?Ye(e,a,o):e,s=fe(({className:i,...u},d)=>W(sa,{ref:d,icon:r,className:i,...u}));return r.name&&(s.displayName=aa(r.name)),s}var la={name:"arrow-up-down",size:24,node:[["path",{d:"m21 16-4 4-4-4",key:"f6ql7i"}],["path",{d:"M17 20V4",key:"1ejh1v"}],["path",{d:"m3 8 4-4 4 4",key:"11wl7u"}],["path",{d:"M7 4v16",key:"1glfcx"}]]};la.node;var J=g(la);var da={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};da.node;var Q=g(da);var na={name:"chevron-left",size:24,node:[["path",{d:"m15 18-6-6 6-6",key:"1wnfg3"}]]};na.node;var Y=g(na);var ia={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};ia.node;var ee=g(ia);var fa={name:"chevron-up",size:24,node:[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]};fa.node;var ae=g(fa);var ca={name:"circle",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]};ca.node;var te=g(ca);var pa={name:"clock",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]]};pa.node;var z=g(pa);var ma={name:"list-filter",size:24,node:[["path",{d:"M2 5h20",key:"1fs1ex"}],["path",{d:"M6 12h12",key:"8npq4p"}],["path",{d:"M9 19h6",key:"456am0"}]]};ma.node;var oe=g(ma);var xa={name:"list-todo",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["rect",{x:"3",y:"4",width:"6",height:"6",rx:"1",key:"cif1o7"}]]};xa.node;var re=g(xa);var La={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};La.node;var U=g(La);var ga={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};ga.node;var R=g(ga);var Ia={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};Ia.node;var E=g(Ia);var Ca={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};Ca.node;var ue=g(Ca);var Xa='button, a, input, textarea, select, [contenteditable="true"]';function ha(e){return!e||typeof e.closest!="function"?!1:e.closest(Xa)!==null}function Sa(e,a,o){return{left:e.left-(a-e.x),top:e.top-(o-e.y)}}function ye(){let e=K(null),[a,o]=I(!1),r=X(u=>{let d=e.current;!d||d.id!==u.pointerId||(e.current=null,o(!1),u.currentTarget.hasPointerCapture(u.pointerId)&&u.currentTarget.releasePointerCapture(u.pointerId))},[]),s=X(u=>{u.button!==0||ha(u.target)||(e.current={id:u.pointerId,x:u.clientX,y:u.clientY,left:u.currentTarget.scrollLeft,top:u.currentTarget.scrollTop},u.currentTarget.setPointerCapture(u.pointerId),o(!0))},[]),i=X(u=>{let d=e.current;if(!d||d.id!==u.pointerId)return;let c=Sa(d,u.clientX,u.clientY);u.currentTarget.scrollLeft=c.left,u.currentTarget.scrollTop=c.top},[]);return{isPanning:a,canvasPanProps:{onPointerDown:s,onPointerMove:i,onPointerUp:r,onPointerCancel:r}}}var ka=`.zcc-kanban {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px;
  overflow: auto;
  cursor: grab;
  overscroll-behavior: contain;
}

.zcc-kanban.is-panning {
  cursor: grabbing;
  user-select: none;
}

.zcc-kanban-col {
  display: flex;
  flex-direction: column;
  min-width: var(--zcc-kanban-col-min, 200px);
  flex: var(--zcc-kanban-col-flex, 1 1 200px);
  width: var(--zcc-kanban-col-width, auto);
  min-height: 0;
  background: var(--bg-panel, var(--zcc-surface, #1e1e1e));
  border: 1px solid var(--border, var(--zcc-border, #2e2e2e));
  border-radius: 10px;
  overflow: hidden;
}

.zcc-kanban-col.is-collapsed {
  flex: 0 0 44px;
  width: 44px;
  min-width: 44px;
  max-width: 44px;
}

.zcc-kanban-col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  position: sticky;
  top: 0;
  z-index: 1;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, var(--zcc-foreground-muted, #8b949e));
  background: transparent;
  border-bottom: 1px solid var(--border, var(--zcc-border, #2e2e2e));
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-header {
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 12px;
  border-bottom: 0;
}

.zcc-kanban-col-icon {
  flex-shrink: 0;
  color: var(--text-dim, var(--zcc-foreground-muted, #8b949e));
}

.zcc-kanban-col-title {
  min-width: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 11px;
}

.zcc-kanban-col-count {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim, var(--zcc-foreground-muted, #8b949e));
  background: var(--bg-elevated, var(--zcc-surface-raised, #242424));
  border-radius: 9px;
  padding: 0 7px;
  line-height: 16px;
  min-width: 16px;
  text-align: center;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-count {
  margin-left: 0;
  writing-mode: horizontal-tb;
}

.zcc-kanban-col-badge {
  min-width: 16px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--accent-blue, var(--zcc-primary, #2f81f7));
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.zcc-kanban-col-collapse {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted, var(--zcc-foreground-muted, #8b949e));
  cursor: pointer;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-collapse {
  margin-left: 0;
  margin-top: auto;
}

.zcc-kanban-col-collapse:hover {
  background: var(--bg-hover, var(--zcc-surface-hover, #2a2a2a));
  color: var(--text-primary, var(--zcc-foreground, #e6edf3));
}

.zcc-kanban-col-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.zcc-kanban-col-body > * {
  flex-shrink: 0;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-body {
  display: none;
}

.zcc-kanban-col-empty {
  min-height: 24px;
}
`;var Pa=globalThis.__ZCC_HOST_REACT__,D=Pa.Fragment;function t(e,a,o){return Pa.createElement(e,o===void 0?a:{...a,key:o})}var l=t;function ja(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function wa({children:e,className:a="",label:o,columnWidth:r}){let{isPanning:s,canvasPanProps:i}=ye();return t("div",{role:"list","aria-label":o,className:["zcc-kanban",s?"is-panning":"",a].filter(Boolean).join(" "),style:ja(r),...i,children:e})}function ba({children:e,className:a="",columnId:o,label:r,count:s,icon:i,badge:u,collapsed:d=!1,onToggleCollapse:c,onContextMenu:n}){let p=d?`Expand ${r}`:`Collapse ${r}`;return l("section",{role:"listitem",className:["zcc-kanban-col",d?"is-collapsed":"",a].filter(Boolean).join(" "),"aria-label":`${r} (${s})`,"data-kanban-column":o,"data-board-column":o,"data-collapsed":d?"true":"false",onContextMenu:n,children:[l("header",{className:"zcc-kanban-col-header",children:[i?t("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:i}):null,t("span",{className:"zcc-kanban-col-title",children:r}),t("span",{className:"zcc-kanban-col-count",children:s}),u,c?t("button",{type:"button",className:"zcc-kanban-col-collapse",title:p,"aria-label":p,"aria-expanded":!d,onClick:()=>c(o),children:d?t(ee,{size:13}):t(U,{size:13})}):null]}),d?null:t("div",{className:"zcc-kanban-col-body",children:e})]})}function G({title:e,description:a,action:o}){return l("div",{className:"tsk-empty",children:[t("div",{className:"tsk-empty-icon","aria-hidden":!0,children:t(re,{size:20})}),l("div",{className:"tsk-empty-copy",children:[t("p",{className:"tsk-empty-title",children:e}),a?t("p",{className:"tsk-empty-desc",children:a}):null]}),o]})}var Za={backlog:"tsk-status-muted",todo:"tsk-status-muted",in_progress:"tsk-status-progress",in_review:"tsk-status-review",done:"tsk-status-done",canceled:"tsk-status-muted"};function b({status:e,className:a=""}){let o=s=>t("circle",{cx:"7",cy:"7",r:"5.4",fill:"none",stroke:"currentColor",strokeWidth:"1.6",...s?{strokeDasharray:"1.8 2"}:{}}),r=t("circle",{cx:"7",cy:"7",r:"6",fill:"currentColor"});return l("svg",{viewBox:"0 0 14 14","aria-hidden":!0,className:`tsk-glyph ${Za[e]} ${a}`.trim(),children:[e==="backlog"?o(!0):null,e==="todo"?o(!1):null,e==="in_progress"?l(D,{children:[o(!1),t("path",{d:"M7 7 L7 2.4 A4.6 4.6 0 0 1 11.2 9.5 Z",fill:"currentColor"})]}):null,e==="in_review"?l(D,{children:[o(!1),t("path",{d:"M7 7 L7 2.4 A4.6 4.6 0 1 1 6.99 2.4 Z",fill:"currentColor"})]}):null,e==="done"?l(D,{children:[r,t("path",{d:"M4.4 7.2 l1.8 1.8 3.4-3.8",fill:"none",stroke:"var(--bg-panel)",strokeWidth:"1.5",strokeLinecap:"round"})]}):null,e==="canceled"?l(D,{children:[r,t("path",{d:"M5 5 l4 4 M9 5 l-4 4",stroke:"var(--bg-panel)",strokeWidth:"1.4",strokeLinecap:"round"})]}):null]})}var $a={none:0,low:1,medium:2,high:3};function B({priority:e,className:a=""}){if(e==="urgent")return l("svg",{viewBox:"0 0 14 14","aria-hidden":!0,className:`tsk-glyph tsk-priority-urgent ${a}`.trim(),children:[t("rect",{x:"0.5",y:"0.5",width:"13",height:"13",rx:"3",fill:"currentColor"}),t("rect",{x:"6.2",y:"3",width:"1.6",height:"5.2",rx:"0.8",fill:"var(--bg-panel)"}),t("circle",{cx:"7",cy:"10.6",r:"1",fill:"var(--bg-panel)"})]});let o=$a[e],r=[{x:1.5,y:8,height:5},{x:5.5,y:5,height:8},{x:9.5,y:2,height:11}];return t("svg",{viewBox:"0 0 14 14","aria-hidden":!0,className:`tsk-glyph ${e==="none"?"tsk-priority-none":""} ${a}`.trim(),children:r.map((s,i)=>t("rect",{x:s.x,y:s.y,width:"3",height:s.height,rx:"1",className:i<o?"tsk-priority-on":"tsk-priority-off"},s.x))})}function ya({items:e,error:a,onOpen:o,onMove:r,onNew:s}){let[i,u]=I(null);if(e===void 0)return t("div",{className:"tsk-board-skeleton","aria-hidden":!0,children:Array.from({length:5},(c,n)=>t("div",{className:"tsk-board-skel-col"},n))});if(a&&e.length===0)return t(G,{title:"Couldn't load tasks",description:a});if(e.length===0)return t(G,{title:"No tasks yet",description:"Create the first task to start tracking work.",action:l("button",{type:"button",className:"tsk-btn tsk-btn-primary",onClick:()=>s("todo"),children:[t(R,{size:14}),"New task"]})});let d=ze(e);return t(wa,{label:"Tasks by status",columnWidth:240,className:"tsk-board",children:Ge(d).map(c=>{let n=d[c];return t(ba,{columnId:c,label:w[c],count:n.length,icon:t(b,{status:c}),children:l("div",{className:"tsk-col-drop","data-drop-status":c,onDragOver:p=>{p.preventDefault(),p.dataTransfer.dropEffect="move"},onDrop:p=>{p.preventDefault();let S=p.dataTransfer.getData("text/task-id"),m=e.find(y=>y.id===S);if(!m)return;let L=[...p.currentTarget.querySelectorAll("[data-task-id]")].findIndex(y=>{let T=y.getBoundingClientRect();return p.clientY<T.top+T.height/2});r(m,c,L===-1?n.length:L),u(null)},children:[n.map(p=>l("article",{"data-task-id":p.id,"data-task-key":p.key,draggable:!0,className:`tsk-card ${i===p.id?"is-dragging":""}`,onDragStart:S=>{S.dataTransfer.setData("text/task-id",p.id),S.dataTransfer.effectAllowed="move",u(p.id)},onDragEnd:()=>u(null),onClick:()=>o(p),children:[t("div",{className:"tsk-card-meta",children:t("span",{className:"tsk-card-key",children:p.key})}),t("div",{className:"tsk-card-title",children:p.title}),t("div",{className:"tsk-card-foot",children:t("span",{title:A[p.priority],children:t(B,{priority:p.priority})})})]},p.id)),l("button",{type:"button",className:"tsk-col-add",onClick:()=>s(c),children:[t(R,{size:12}),"Add"]})]})},c)})})}function V({icon:e,label:a,activeText:o,children:r,align:s="start",variant:i="chip",ariaLabel:u}){let[d,c]=I(!1),n=K(null),p=Fe();return P(()=>{if(!d)return;let m=L=>{n.current?.contains(L.target)||c(!1)},C=L=>{L.key==="Escape"&&c(!1)};return document.addEventListener("mousedown",m),document.addEventListener("keydown",C),()=>{document.removeEventListener("mousedown",m),document.removeEventListener("keydown",C)}},[d]),l("div",{className:`tsk-chip-wrap ${s==="end"?"tsk-chip-wrap-end":""}`,ref:n,children:[l("button",{type:"button",className:`${i==="ghost"?"tsk-icon-btn":"tsk-chip"} ${!!o?"is-active":""}`,"aria-label":u??a,"aria-haspopup":"menu","aria-expanded":d,"aria-controls":p,onClick:()=>c(m=>!m),children:[e,i==="chip"?a:null,o?t("span",{className:"tsk-chip-value",children:o}):null]}),d?t("div",{id:p,role:"menu",className:"tsk-menu",children:r(()=>c(!1))}):null]})}function _({icon:e,checked:a,children:o,onSelect:r}){return l("button",{type:"button",role:"menuitemcheckbox","aria-checked":a,className:"tsk-menu-item",onClick:r,children:[e,t("span",{className:"tsk-menu-item-label",children:o}),a?t("span",{className:"tsk-menu-check",children:"\u2713"}):null]})}function se({task:e,kind:a,onEdit:o}){return a==="status"?t(V,{variant:"ghost",ariaLabel:`Status: ${w[e.status]}`,icon:t(b,{status:e.status}),children:r=>t(D,{children:q.map(s=>t(_,{icon:t(b,{status:s}),checked:e.status===s,onSelect:()=>{o({status:s}),r()},children:w[s]},s))})}):t(V,{variant:"ghost",ariaLabel:`Priority: ${A[e.priority]}`,icon:t(B,{priority:e.priority}),children:r=>t(D,{children:H.map(s=>t(_,{icon:t(B,{priority:s}),checked:e.priority===s,onSelect:()=>{o({priority:s}),r()},children:A[s]},s))})})}function Aa({task:e,onOpen:a,onEdit:o}){return l("div",{className:"tsk-row","data-task-key":e.key,children:[t("button",{type:"button",className:"tsk-row-hit","aria-label":`Open ${e.key}: ${e.title}`,onClick:a}),t("div",{className:"tsk-row-priority",children:t(se,{task:e,kind:"priority",onEdit:o})}),t("span",{className:"tsk-row-key",children:e.key}),t("div",{className:"tsk-row-status",children:t(se,{task:e,kind:"status",onEdit:o})}),t("span",{className:"tsk-row-title",children:e.title}),e.dueDate?l("span",{className:"tsk-row-due",children:[t(z,{size:12,"aria-hidden":!0}),xe(e.dueDate)]}):null]})}function Ta({task:e,error:a,onPatch:o,onRemove:r}){let[s,i]=I(e?.description??"");return P(()=>{i(e?.description??"")},[e?.id,e?.description]),a&&!e?t("div",{className:"tsk-detail",children:t("p",{className:"tsk-empty-desc",children:a})}):e?l("div",{className:"tsk-detail",children:[l("div",{className:"tsk-detail-props",children:[t(se,{task:e,kind:"status",onEdit:u=>o(u)}),t("span",{className:"tsk-detail-status",children:w[e.status]}),t(se,{task:e,kind:"priority",onEdit:u=>o(u)}),t("span",{className:"tsk-detail-status",children:A[e.priority]}),l("label",{className:"tsk-due-field",children:[t(z,{size:12}),t("input",{type:"date","aria-label":"Due date",value:e.dueDate??"",onChange:u=>o({dueDate:u.target.value||null})}),e.dueDate?t("span",{children:xe(e.dueDate)}):t("span",{children:"Due date"})]})]}),t("h1",{className:"tsk-detail-title",contentEditable:!0,suppressContentEditableWarning:!0,role:"textbox","aria-label":"Task title",onKeyDown:u=>{u.key==="Enter"&&(u.preventDefault(),u.currentTarget.blur())},onBlur:u=>{let d=u.currentTarget.textContent?.trim()??"";if(!d){u.currentTarget.textContent=e.title;return}d!==e.title&&o({title:d})},children:e.title}),t("textarea",{className:"tsk-detail-body","aria-label":"Task description",placeholder:"Add a description\u2026",value:s,onChange:u=>i(u.target.value),onBlur:()=>{s!==e.description&&o({description:s})}}),l("button",{type:"button",className:"tsk-btn tsk-btn-danger",onClick:r,children:[t(E,{size:14}),"Delete task"]})]}):l("div",{className:"tsk-detail",children:[t("div",{className:"tsk-skeleton-row"}),t("div",{className:"tsk-skeleton-row"})]})}function va(e,a){return e.includes(a)?e.filter(o=>o!==a):[...e,a]}function Ra({filters:e,sort:a,taskCount:o,onFilters:r,onSort:s}){let i=ce(e);return l("div",{className:"tsk-filters",children:[l("div",{className:"tsk-filters-left",children:[t(V,{icon:t(te,{size:12}),label:"Status",activeText:e.statuses.map(u=>w[u]).join(", "),children:()=>q.map(u=>t(_,{icon:t(b,{status:u}),checked:e.statuses.includes(u),onSelect:()=>r({...e,statuses:va(e.statuses,u)}),children:w[u]},u))}),t(V,{icon:t(J,{size:12}),label:"Priority",activeText:e.priorities.map(u=>A[u]).join(", "),children:()=>H.map(u=>t(_,{icon:t(B,{priority:u}),checked:e.priorities.includes(u),onSelect:()=>r({...e,priorities:va(e.priorities,u)}),children:A[u]},u))}),i?l("button",{type:"button",className:"tsk-chip",onClick:()=>r(N),children:[t(ue,{size:12}),"Clear"]}):null]}),t(V,{icon:t(oe,{size:12}),label:"Sort",activeText:a==="manual"?void 0:Se[a],align:"end",children:u=>he.map(d=>t(_,{checked:a===d,onSelect:()=>{s(d),u()},children:Se[d]},d))}),t("span",{className:"tsk-count",children:o===void 0?"":`${o} ${o===1?"task":"tasks"}`})]})}function Da({items:e,error:a,filters:o,sort:r,onFilters:s,onSort:i,onOpen:u,onEdit:d,onNew:c}){let n=e?.filter(C=>Ne(C,o)),p=n?me(pe(n,r)):[],S=!!(n&&n.length===0&&e&&e.length>0&&ce(o)),m;return e===void 0?m=t("div",{className:"tsk-skeleton","aria-hidden":!0,children:Array.from({length:6},(C,L)=>t("div",{className:"tsk-skeleton-row"},L))}):a&&e.length===0?m=t(G,{title:"Couldn't load tasks",description:a}):S?m=t(G,{title:"No tasks match these filters",action:t("button",{type:"button",className:"tsk-btn tsk-btn-secondary",onClick:()=>s(N),children:"Clear filters"})}):e.length===0?m=t(G,{title:"No tasks yet",description:"Create the first task to start tracking work.",action:l("button",{type:"button",className:"tsk-btn tsk-btn-primary",onClick:c,children:[t(R,{size:14}),"New task"]})}):m=p.map(C=>l("section",{className:"tsk-group",children:[l("div",{className:"tsk-group-head","data-status-group-header":C.status,children:[t(b,{status:C.status}),t("span",{children:w[C.status]}),t("span",{className:"tsk-group-count",children:C.tasks.length})]}),C.tasks.map(L=>t(Aa,{task:L,onOpen:()=>u(L),onEdit:y=>d(L,y)},L.id))]},C.status)),l("div",{className:"tsk-list",children:[t(Ra,{filters:o,sort:r,taskCount:n?.length,onFilters:s,onSort:i}),t("div",{className:"tsk-list-body",children:m})]})}function Ma({open:e,defaultStatus:a="todo",busy:o,error:r,onClose:s,onCreate:i}){let[u,d]=I({title:"",description:"",status:a,priority:"none",dueDate:""}),c=K(null);return P(()=>{if(!e)return;d({title:"",description:"",status:a,priority:"none",dueDate:""});let n=requestAnimationFrame(()=>c.current?.focus());return()=>cancelAnimationFrame(n)},[e,a]),e?l("div",{className:"tsk-modal-root",role:"presentation",children:[t("button",{type:"button",className:"tsk-modal-backdrop","aria-label":"Close",onClick:s}),l("div",{className:"tsk-modal",role:"dialog","aria-labelledby":"tsk-new-title","aria-modal":"true",children:[t("h2",{id:"tsk-new-title",children:"New task"}),t("p",{className:"tsk-modal-lead",children:"Create a task with a title, status, and optional due date."}),l("form",{className:"tsk-modal-form",onSubmit:n=>{n.preventDefault(),!(!u.title.trim()||o)&&i(u)},children:[l("label",{className:"tsk-field",children:["Title",t("input",{ref:c,value:u.title,onChange:n=>d({...u,title:n.target.value}),placeholder:"Ship the tracker",required:!0})]}),l("label",{className:"tsk-field",children:["Description",t("textarea",{value:u.description,onChange:n=>d({...u,description:n.target.value}),placeholder:"What needs to happen?",rows:4})]}),l("div",{className:"tsk-field-row",children:[l("label",{className:"tsk-field",children:["Status",t("select",{value:u.status,onChange:n=>d({...u,status:n.target.value}),children:q.map(n=>t("option",{value:n,children:w[n]},n))})]}),l("label",{className:"tsk-field",children:["Priority",t("select",{value:u.priority,onChange:n=>d({...u,priority:n.target.value}),children:H.map(n=>t("option",{value:n,children:A[n]},n))})]}),l("label",{className:"tsk-field",children:["Due",t("input",{type:"date",value:u.dueDate,onChange:n=>d({...u,dueDate:n.target.value})})]})]}),l("div",{className:"tsk-status-preview","aria-hidden":!0,children:[t(b,{status:u.status}),t(B,{priority:u.priority})]}),r?t("p",{className:"tsk-form-error",children:r}):null,l("div",{className:"tsk-modal-actions",children:[t("button",{type:"button",className:"tsk-btn tsk-btn-secondary",onClick:s,children:"Cancel"}),t("button",{type:"submit",className:"tsk-btn tsk-btn-primary",disabled:o||!u.title.trim(),children:"Create task"})]})]})]})]}):null}function Ba({route:e,pager:a,onBack:o,onView:r,onNew:s,onStep:i}){return l("header",{className:"tsk-topbar",children:[t("div",{className:"tsk-topbar-lead",children:e.kind==="task"?l(D,{children:[t("button",{type:"button",className:"tsk-icon-btn","aria-label":"Back (Esc)",onClick:o,children:t(Y,{size:16})}),t("span",{className:"tsk-crumb",children:e.taskKey})]}):t("span",{className:"tsk-crumb-title",children:"All tasks"})}),e.kind==="task"&&a?l("div",{className:"tsk-pager",children:[l("span",{children:[a.index," / ",a.total]}),t("button",{type:"button",className:"tsk-icon-btn","aria-label":"Previous task",disabled:!a.prevKey,onClick:()=>a.prevKey&&i(a.prevKey),children:t(ae,{size:14})}),t("button",{type:"button",className:"tsk-icon-btn","aria-label":"Next task",disabled:!a.nextKey,onClick:()=>a.nextKey&&i(a.nextKey),children:t(Q,{size:14})})]}):null,e.kind==="browse"?l("div",{className:"tsk-view-toggle",role:"group","aria-label":"Task view",children:[t("button",{type:"button",className:e.view==="list"?"is-active":"","aria-pressed":e.view==="list",onClick:()=>r("list"),children:"List"}),t("button",{type:"button",className:e.view==="board"?"is-active":"","aria-pressed":e.view==="board",onClick:()=>r("board"),children:"Board"})]}):null,e.kind==="browse"?l("button",{type:"button",className:"tsk-btn tsk-btn-primary tsk-new","aria-label":"New task",onClick:s,children:[t(R,{size:14}),t("span",{children:"New task"})]}):null]})}function Fa(e,a){let o=a.toUpperCase(),r=e.findIndex(s=>s.key.toUpperCase()===o);return r===-1?null:{index:r+1,total:e.length,prevKey:e[r-1]?.key??null,nextKey:e[r+1]?.key??null}}function qa(){let e=ne(),[a,o]=I(void 0),[r,s]=I(null),i=X(()=>e.call("list").then(u=>{let d=u;o(Array.isArray(d?.items)?d.items:[]),s(null)}).catch(u=>{s(u instanceof Error?u.message:String(u)),o(d=>d??[])}),[e]);return P(()=>{i()},[i]),De(Oe,i),{items:a,error:r,refresh:i,rpc:e}}function Ae({pluginId:e,subPath:a}){let o=ie(),{items:r,error:s,refresh:i,rpc:u}=qa(),[d,c]=I(Ze),[n,p]=I(Ke),[S,m]=I({open:!1,status:"todo"}),[C,L]=I(null),[y,T]=I(!1),[k,le]=I(()=>we(a,j()));P(()=>{le(we(a,j()))},[a]);let v=(f,h=!1)=>{f.kind==="browse"&&Xe(f.view),le(f),o.toPluginPanel("main",{subPath:Je(f),replace:h})};P(()=>{if(k.kind!=="task")return;let f=h=>{if(h.key!=="Escape"||h.defaultPrevented)return;let M=h.target;M instanceof HTMLInputElement||M instanceof HTMLTextAreaElement||M instanceof HTMLElement&&M.isContentEditable||v({kind:"browse",view:j()})};return window.addEventListener("keydown",f),()=>window.removeEventListener("keydown",f)},[k.kind]);let Le=Ce(()=>r?me(pe(r,n)).flatMap(f=>f.tasks):[],[r,n]),F=k.kind==="task"?r?.find(f=>f.key.toUpperCase()===k.taskKey.toUpperCase()):void 0,Z=async f=>{try{return await f(),await i(),!0}catch(h){return L(h instanceof Error?h.message:String(h)),!1}},de=(f,h)=>{Z(()=>u.call("update",{id:f.id,...h}))},ge=f=>{T(!0),L(null),u.call("add",{title:f.title,description:f.description,status:f.status,priority:f.priority,dueDate:f.dueDate||void 0}).then(async h=>{let M=h;m({open:!1,status:"todo"}),await i(),M?.key&&v({kind:"task",taskKey:M.key})}).catch(h=>{L(h instanceof Error?h.message:String(h))}).finally(()=>T(!1))};return l("div",{className:"tsk-panel","data-plugin":e,children:[t(Ba,{route:k,pager:k.kind==="task"?Fa(Le,k.taskKey):null,onBack:()=>v({kind:"browse",view:j()}),onView:f=>v({kind:"browse",view:f},!0),onNew:()=>{L(null),m({open:!0,status:"todo"})},onStep:f=>v({kind:"task",taskKey:f})}),k.kind==="browse"&&k.view==="list"?t(Da,{items:r,error:s,filters:d,sort:n,onFilters:f=>{c(f),$e(f)},onSort:f=>{p(f),je(f)},onOpen:f=>v({kind:"task",taskKey:f.key}),onEdit:de,onNew:()=>m({open:!0,status:"todo"})}):null,k.kind==="browse"&&k.view==="board"?t(ya,{items:r,error:s,onOpen:f=>v({kind:"task",taskKey:f.key}),onMove:(f,h,M)=>{Z(()=>u.call("boardMove",{id:f.id,status:h,index:M}))},onNew:f=>{L(null),m({open:!0,status:f})}}):null,k.kind==="task"?t(Ta,{task:F,error:s??(r&&!F?`task not found: ${k.taskKey}`:null),onPatch:f=>{F&&de(F,f)},onRemove:()=>{F&&Z(()=>u.call("remove",{id:F.id})).then(f=>{f&&v({kind:"browse",view:j()})})}}):null,t(Ma,{open:S.open,defaultStatus:S.status,busy:y,error:C,onClose:()=>m({open:!1,status:"todo"}),onCreate:ge})]})}function Oa({pluginId:e}){return t(Ae,{pluginId:e,subPath:""})}function Ua(e){let a=ne(),o=ie(),r=e.attributes.key||e.attributes.id||"",s=e.attributes.title||r||"Task",[i,u]=I(null);P(()=>{r&&a.call("get",{key:r}).then(p=>{let S=p;S?.task&&u(S.task)}).catch(()=>{})},[r,a]);let d=i?.title??s,c=i?.status??"todo",n=i?.key??r;return l("button",{type:"button",className:"tsk-directive",onClick:()=>{n&&o.toPluginPanel("main",{subPath:`task/${n}`})},children:[t(b,{status:c}),t("span",{className:"tsk-directive-key",children:n}),t("span",{className:"tsk-directive-title",children:d})]})}var Ja="tasks";function Ea(){let[e,a]=I(null);return P(()=>{let o=!0,r=async()=>{try{let i=await ve(Ja,"badge");if(!o)return;a(typeof i?.count=="number"&&i.count>0?i.count:null)}catch{o&&a(null)}};r();let s=window.setInterval(()=>void r(),15e3);return()=>{o=!1,window.clearInterval(s)}},[]),e==null?null:t("span",{className:"nav-badge",children:e})}var Ha=`.tsk-panel {
  position: relative;
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 13px;
}

.tsk-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  flex-shrink: 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}

.tsk-topbar-lead {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.tsk-crumb-title,
.tsk-crumb {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tsk-crumb {
  color: var(--text-muted);
  font-weight: 500;
}

.tsk-pager {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.tsk-view-toggle {
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 6px;
  background: var(--bg-elevated);
}

.tsk-view-toggle button {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.tsk-view-toggle button.is-active {
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.08);
}

.tsk-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}

.tsk-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tsk-btn-primary {
  background: var(--accent-blue);
  color: #fff;
}

.tsk-btn-primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.tsk-btn-secondary {
  background: transparent;
  border-color: var(--border);
  color: var(--text-primary);
}

.tsk-btn-secondary:hover {
  background: var(--bg-hover);
}

.tsk-btn-danger {
  align-self: flex-start;
  background: transparent;
  border-color: var(--border);
  color: var(--danger);
}

.tsk-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  position: relative;
  z-index: 1;
}

.tsk-icon-btn:hover,
.tsk-icon-btn[aria-expanded='true'] {
  background: var(--bg-hover);
}

.tsk-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.tsk-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
}

.tsk-filters-left {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
}

.tsk-chip-wrap {
  position: relative;
  z-index: 3;
}

.tsk-chip-wrap-end {
  margin-left: auto;
}

.tsk-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.tsk-chip.is-active {
  border-style: solid;
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.tsk-chip:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.tsk-chip-value {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 550;
}

.tsk-count {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.tsk-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  min-width: 176px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.tsk-chip-wrap-end .tsk-menu {
  left: auto;
  right: 0;
}

.tsk-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.tsk-menu-item:hover,
.tsk-menu-item[aria-checked='true'] {
  background: var(--bg-hover);
}

.tsk-menu-item-label {
  flex: 1;
  min-width: 0;
}

.tsk-menu-check {
  color: var(--text-muted);
  font-size: 11px;
}

.tsk-list,
.tsk-detail {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.tsk-list-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.tsk-group-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 6px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
}

.tsk-group-count {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.tsk-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.tsk-row:hover {
  background: var(--bg-hover);
}

.tsk-row-hit {
  position: absolute;
  inset: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.tsk-row-hit:focus-visible {
  outline: 1px solid var(--accent-blue);
  outline-offset: -1px;
}

.tsk-row-priority,
.tsk-row-status {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}

.tsk-row-key {
  position: relative;
  z-index: 1;
  width: 56px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.tsk-row-title {
  position: relative;
  z-index: 0;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.tsk-row-due {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.tsk-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
}

.tsk-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-muted);
}

.tsk-empty-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tsk-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.tsk-empty-desc {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.tsk-skeleton {
  padding: 14px;
}

.tsk-skeleton-row,
.tsk-board-skel-col {
  height: 34px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: var(--bg-elevated);
}

.tsk-board {
  min-height: 0;
}

.tsk-board-skeleton {
  display: flex;
  gap: 10px;
  padding: 10px;
  min-height: 0;
  flex: 1;
}

.tsk-board-skel-col {
  flex: 0 0 240px;
  height: 100%;
}

.tsk-col-drop {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 80px;
  padding: 8px;
}

.tsk-card {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
  cursor: pointer;
  user-select: none;
}

.tsk-card:hover {
  border-color: var(--border-strong);
}

.tsk-card.is-dragging {
  opacity: 0.4;
}

.tsk-card-meta {
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tsk-card-title {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 550;
  line-height: 1.35;
}

.tsk-card-foot {
  display: flex;
  margin-top: 6px;
}

.tsk-col-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.tsk-col-add:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tsk-detail {
  padding: 20px 28px 32px;
  overflow: auto;
  gap: 12px;
}

.tsk-detail-props {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.tsk-detail-status {
  color: var(--text-muted);
  font-size: 12px;
}

.tsk-due-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.tsk-due-field input[type='date'] {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  padding: 2px 6px;
}

.tsk-detail-title {
  margin: 4px 0 0;
  font-size: 26px;
  font-weight: 650;
  line-height: 1.2;
  outline: none;
}

.tsk-detail-body {
  width: 100%;
  min-height: 160px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.5;
  padding: 10px 12px;
}

.tsk-modal-root {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 16px 16px;
}

.tsk-modal-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: color-mix(in srgb, #000 32%, transparent);
}

.tsk-modal {
  position: relative;
  z-index: 1;
  width: min(520px, 100%);
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-panel);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
  padding: 18px 18px 16px;
}

.tsk-modal h2 {
  margin: 0;
  font-size: 16px;
}

.tsk-modal-lead {
  margin: 6px 0 14px;
  color: var(--text-muted);
  font-size: 13px;
}

.tsk-modal-form,
.tsk-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tsk-field {
  font-size: 12px;
  color: var(--text-muted);
}

.tsk-field input,
.tsk-field textarea,
.tsk-field select {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  padding: 6px 8px;
}

.tsk-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.tsk-status-preview {
  display: flex;
  gap: 8px;
}

.tsk-form-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.tsk-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.tsk-directive {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: inherit;
  font: inherit;
  padding: 6px 10px;
  cursor: pointer;
}

.tsk-directive-key {
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.tsk-directive-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tsk-glyph {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.tsk-status-muted {
  color: var(--text-muted);
}

.tsk-status-progress {
  color: var(--accent-gold);
}

.tsk-status-review {
  color: var(--accent-blue);
}

.tsk-status-done {
  color: var(--success);
}

.tsk-priority-urgent {
  color: var(--accent-gold);
}

.tsk-priority-none {
  opacity: 0.4;
}

.tsk-priority-on {
  fill: var(--text-muted);
}

.tsk-priority-off {
  fill: var(--border-strong);
}

@media (max-width: 720px) {
  .tsk-new span,
  .tsk-pager span {
    display: none;
  }
  .tsk-field-row {
    grid-template-columns: 1fr;
  }
  .tsk-detail {
    padding: 16px;
  }
}
`;var Na="tsk-plugin-styles";function Ya(){if(typeof document>"u")return;let e=`${ka}
${Ha}`,a=document.getElementById(Na);if(a instanceof HTMLStyleElement){a.textContent=e;return}let o=document.createElement("style");o.id=Na,o.textContent=e,document.head.appendChild(o)}Ya();var Eu=Re(e=>{e.slots.navPanel({id:"main",title:"Tasks",icon:"ListTodo",component:Ae,experimental_sidebarAccessory:Ea}),e.slots.threadPanelAction({id:"board",title:"Tasks",icon:"ListTodo",layout:"flush",scopes:["thread","agent-session"],component:Oa}),e.slots.messageDirective({id:"task",component:Ua}),e.slots.commandPaletteAction({id:"open",title:"Open Tasks",run:a=>{a.toPluginPanel("main")}})});export{Eu as default,Ya as injectStyles};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs:
lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-react/dist/esm/shared/src/build/defaultAttributes.mjs:
lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs:
lucide-react/dist/esm/shared/src/build/buildLucideIconForReact.mjs:
lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs:
lucide-react/dist/esm/context.mjs:
lucide-react/dist/esm/Icon.mjs:
lucide-react/dist/esm/createLucideIcon.mjs:
lucide-react/dist/esm/icons/arrow-up-down.mjs:
lucide-react/dist/esm/icons/chevron-down.mjs:
lucide-react/dist/esm/icons/chevron-left.mjs:
lucide-react/dist/esm/icons/chevron-right.mjs:
lucide-react/dist/esm/icons/chevron-up.mjs:
lucide-react/dist/esm/icons/circle.mjs:
lucide-react/dist/esm/icons/clock.mjs:
lucide-react/dist/esm/icons/list-filter.mjs:
lucide-react/dist/esm/icons/list-todo.mjs:
lucide-react/dist/esm/icons/panel-left-close.mjs:
lucide-react/dist/esm/icons/plus.mjs:
lucide-react/dist/esm/icons/trash.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.47.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
