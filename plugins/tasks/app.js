function wa(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function me(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function ye(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function Ae(e,t,o){return wa().callRpc(e,t,o)}function Te(e){return{__zccPluginApp:!0,setup:e}}function re(){return me().useRpc?.()??ye("useRpc")}function ve(e,t){me().useRealtime?.(e,t)}function ue(){return me().useZccNavigate?.()??ye("useZccNavigate")}var m=globalThis.__ZCC_HOST_REACT__;var nt=m.Children,it=m.Component,ft=m.Fragment,ct=m.StrictMode,pt=m.Suspense,mt=m.cloneElement,Re=m.createContext,V=m.createElement,xt=m.createRef,se=m.forwardRef,Lt=m.isValidElement,gt=m.lazy,It=m.memo,Ct=m.startTransition,_=m.useCallback,Me=m.useContext,ht=m.useDebugValue,St=m.useDeferredValue,k=m.useEffect,De=m.useId,kt=m.useImperativeHandle,Pt=m.useInsertionEffect,wt=m.useLayoutEffect,xe=m.useMemo,bt=m.useReducer,W=m.useRef,L=m.useState,yt=m.useSyncExternalStore,At=m.useTransition,Tt=m.version;var B=["backlog","todo","in_progress","in_review","done","canceled"],O=["urgent","high","medium","low","none"],Le=["manual","priority","due"];var Fe="tasks-changed";var P={backlog:"Backlog",todo:"Todo",in_progress:"In Progress",in_review:"In Review",done:"Done",canceled:"Canceled"},y={urgent:"Urgent",high:"High",medium:"Medium",low:"Low",none:"No priority"},ge={manual:"Manual",priority:"Priority",due:"Due date"},Be={urgent:0,high:1,medium:2,low:3,none:4},ba=["backlog","todo","in_progress","in_review","done"],U={statuses:[],priorities:[]};function qe(e){return typeof e=="string"&&B.includes(e)}function Oe(e){return typeof e=="string"&&O.includes(e)}function Ue(e){return typeof e=="string"&&Le.includes(e)}function le(e){return e.statuses.length>0||e.priorities.length>0}function Ee(e,t){return!(t.statuses.length>0&&!t.statuses.includes(e.status)||t.priorities.length>0&&!t.priorities.includes(e.priority))}function de(e,t){let o=[...e];return t==="priority"?o.sort((u,s)=>Be[u.priority]-Be[s.priority]||u.order-s.order):t==="due"?o.sort((u,s)=>u.dueDate===null&&s.dueDate===null?u.order-s.order:u.dueDate===null?1:s.dueDate===null?-1:u.dueDate.localeCompare(s.dueDate)||u.order-s.order):o.sort((u,s)=>u.order-s.order||u.createdAt-s.createdAt),o}function ne(e){let t=new Map;for(let o of e){let u=t.get(o.status);u?u.push(o):t.set(o.status,[o])}return B.flatMap(o=>{let u=t.get(o);return u?[{status:o,tasks:u}]:[]})}function ya(){return{backlog:[],todo:[],in_progress:[],in_review:[],done:[],canceled:[]}}function He(e){let t=ya();for(let o of e)t[o.status].push(o);return t}function Ne(e){return[...ba,...e.canceled.length>0?["canceled"]:[]]}function ie(e,t=new Date){let o=new Date(`${e}T00:00:00`);return Number.isNaN(o.getTime())?e:o.toLocaleDateString("en-US",{month:"short",day:"numeric",...o.getFullYear()===t.getFullYear()?{}:{year:"numeric"}})}var ze="zcc-tasks:view",Ge="zcc-tasks:filters",Ve="zcc-tasks:sort";function Ie(e){try{return globalThis.localStorage?.getItem(e)??null}catch{return null}}function Ce(e,t){try{globalThis.localStorage?.setItem(e,t)}catch{}}function X(){return Ie(ze)==="board"?"board":"list"}function _e(e){Ce(ze,e)}function We(){let e=Ie(Ve);return Ue(e)?e:"manual"}function Xe(e){Ce(Ve,e)}function Ke(){let e=Ie(Ge);if(!e)return{...U};try{let t=JSON.parse(e),o=Array.isArray(t.statuses)?t.statuses.filter(qe):[],u=Array.isArray(t.priorities)?t.priorities.filter(Oe):[];return{statuses:o,priorities:u}}catch{return{...U}}}function je(e){Ce(Ge,JSON.stringify(e))}function Aa(e){let t=e.split("/").filter(Boolean);return t[0]==="task"&&t[1]?{kind:"task",taskKey:t[1]}:t[0]==="board"?{kind:"browse",view:"board"}:t[0]==="list"?{kind:"browse",view:"list"}:{kind:"browse"}}function he(e,t){let o=Aa(e);return o.kind==="task"?o:{kind:"browse",view:o.view??t}}function Ze(e){return e.kind==="task"?`task/${e.taskKey}`:e.view==="board"?"board":""}var fe=(...e)=>e.filter((t,o,u)=>!!t&&t.trim()!==""&&u.indexOf(t)===o).join(" ").trim();var $e=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();var Je=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(t,o,u)=>u?u.toUpperCase():o.toLowerCase());var Se=e=>{let t=Je(e);return t.charAt(0).toUpperCase()+t.slice(1)};var ce={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};var Qe=e=>{for(let t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};var Ta=Re({});var Ye=()=>Me(Ta);var ea=se(({color:e,size:t,strokeWidth:o,absoluteStrokeWidth:u,className:s="",children:i,iconNode:r,...d},c)=>{let{size:n=24,strokeWidth:p=2,absoluteStrokeWidth:S=!1,color:g="currentColor",className:h=""}=Ye()??{},I=u??S?Number(o??p)*24/Number(t??n):o??p;return V("svg",{ref:c,...ce,width:t??n??ce.width,height:t??n??ce.height,stroke:e??g,strokeWidth:I,className:fe("lucide",h,s),...!i&&!Qe(d)&&{"aria-hidden":"true"},...d},[...r.map(([v,q])=>V(v,q)),...Array.isArray(i)?i:[i]])});var x=(e,t)=>{let o=se(({className:u,...s},i)=>V(ea,{ref:i,iconNode:t,className:fe(`lucide-${$e(Se(e))}`,`lucide-${e}`,u),...s}));return o.displayName=Se(e),o};var va=[["path",{d:"m21 16-4 4-4-4",key:"f6ql7i"}],["path",{d:"M17 20V4",key:"1ejh1v"}],["path",{d:"m3 8 4-4 4 4",key:"11wl7u"}],["path",{d:"M7 4v16",key:"1glfcx"}]],K=x("arrow-up-down",va);var Ra=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],j=x("chevron-down",Ra);var Ma=[["path",{d:"m15 18-6-6 6-6",key:"1wnfg3"}]],Z=x("chevron-left",Ma);var Da=[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]],$=x("chevron-right",Da);var Ba=[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]],J=x("chevron-up",Ba);var Fa=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]],Q=x("circle",Fa);var qa=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]],E=x("clock",qa);var Oa=[["path",{d:"M2 5h20",key:"1fs1ex"}],["path",{d:"M6 12h12",key:"8npq4p"}],["path",{d:"M9 19h6",key:"456am0"}]],Y=x("list-filter",Oa);var Ua=[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["rect",{x:"3",y:"4",width:"6",height:"6",rx:"1",key:"cif1o7"}]],ee=x("list-todo",Ua);var Ea=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],F=x("panel-left-close",Ea);var Ha=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]],A=x("plus",Ha);var Na=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],ae=x("trash-2",Na);var za=[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]],te=x("x",za);var Ga='button, a, input, textarea, select, [contenteditable="true"]';function aa(e){return!e||typeof e.closest!="function"?!1:e.closest(Ga)!==null}function ta(e,t,o){return{left:e.left-(t-e.x),top:e.top-(o-e.y)}}function ke(){let e=W(null),[t,o]=L(!1),u=_(r=>{let d=e.current;!d||d.id!==r.pointerId||(e.current=null,o(!1),r.currentTarget.hasPointerCapture(r.pointerId)&&r.currentTarget.releasePointerCapture(r.pointerId))},[]),s=_(r=>{r.button!==0||aa(r.target)||(e.current={id:r.pointerId,x:r.clientX,y:r.clientY,left:r.currentTarget.scrollLeft,top:r.currentTarget.scrollTop},r.currentTarget.setPointerCapture(r.pointerId),o(!0))},[]),i=_(r=>{let d=e.current;if(!d||d.id!==r.pointerId)return;let c=ta(d,r.clientX,r.clientY);r.currentTarget.scrollLeft=c.left,r.currentTarget.scrollTop=c.top},[]);return{isPanning:t,canvasPanProps:{onPointerDown:s,onPointerMove:i,onPointerUp:u,onPointerCancel:u}}}var oa=`.zcc-kanban {
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
`;var ra=globalThis.__ZCC_HOST_REACT__,T=ra.Fragment;function a(e,t,o){return ra.createElement(e,o===void 0?t:{...t,key:o})}var l=a;function _a(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function ua({children:e,className:t="",label:o,columnWidth:u}){let{isPanning:s,canvasPanProps:i}=ke();return a("div",{role:"list","aria-label":o,className:["zcc-kanban",s?"is-panning":"",t].filter(Boolean).join(" "),style:_a(u),...i,children:e})}function sa({children:e,className:t="",columnId:o,label:u,count:s,icon:i,badge:r,collapsed:d=!1,onToggleCollapse:c}){let n=d?`Expand ${u}`:`Collapse ${u}`;return l("section",{role:"listitem",className:["zcc-kanban-col",d?"is-collapsed":"",t].filter(Boolean).join(" "),"aria-label":`${u} (${s})`,"data-kanban-column":o,"data-board-column":o,"data-collapsed":d?"true":"false",children:[l("header",{className:"zcc-kanban-col-header",children:[i?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:i}):null,a("span",{className:"zcc-kanban-col-title",children:u}),a("span",{className:"zcc-kanban-col-count",children:s}),r,c?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:n,"aria-label":n,"aria-expanded":!d,onClick:()=>c(o),children:d?a($,{size:13}):a(F,{size:13})}):null]}),d?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}function H({title:e,description:t,action:o}){return l("div",{className:"tsk-empty",children:[a("div",{className:"tsk-empty-icon","aria-hidden":!0,children:a(ee,{size:20})}),l("div",{className:"tsk-empty-copy",children:[a("p",{className:"tsk-empty-title",children:e}),t?a("p",{className:"tsk-empty-desc",children:t}):null]}),o]})}var Wa={backlog:"tsk-status-muted",todo:"tsk-status-muted",in_progress:"tsk-status-progress",in_review:"tsk-status-review",done:"tsk-status-done",canceled:"tsk-status-muted"};function b({status:e,className:t=""}){let o=s=>a("circle",{cx:"7",cy:"7",r:"5.4",fill:"none",stroke:"currentColor",strokeWidth:"1.6",...s?{strokeDasharray:"1.8 2"}:{}}),u=a("circle",{cx:"7",cy:"7",r:"6",fill:"currentColor"});return l("svg",{viewBox:"0 0 14 14","aria-hidden":!0,className:`tsk-glyph ${Wa[e]} ${t}`.trim(),children:[e==="backlog"?o(!0):null,e==="todo"?o(!1):null,e==="in_progress"?l(T,{children:[o(!1),a("path",{d:"M7 7 L7 2.4 A4.6 4.6 0 0 1 11.2 9.5 Z",fill:"currentColor"})]}):null,e==="in_review"?l(T,{children:[o(!1),a("path",{d:"M7 7 L7 2.4 A4.6 4.6 0 1 1 6.99 2.4 Z",fill:"currentColor"})]}):null,e==="done"?l(T,{children:[u,a("path",{d:"M4.4 7.2 l1.8 1.8 3.4-3.8",fill:"none",stroke:"var(--bg-panel)",strokeWidth:"1.5",strokeLinecap:"round"})]}):null,e==="canceled"?l(T,{children:[u,a("path",{d:"M5 5 l4 4 M9 5 l-4 4",stroke:"var(--bg-panel)",strokeWidth:"1.4",strokeLinecap:"round"})]}):null]})}var Xa={none:0,low:1,medium:2,high:3};function M({priority:e,className:t=""}){if(e==="urgent")return l("svg",{viewBox:"0 0 14 14","aria-hidden":!0,className:`tsk-glyph tsk-priority-urgent ${t}`.trim(),children:[a("rect",{x:"0.5",y:"0.5",width:"13",height:"13",rx:"3",fill:"currentColor"}),a("rect",{x:"6.2",y:"3",width:"1.6",height:"5.2",rx:"0.8",fill:"var(--bg-panel)"}),a("circle",{cx:"7",cy:"10.6",r:"1",fill:"var(--bg-panel)"})]});let o=Xa[e],u=[{x:1.5,y:8,height:5},{x:5.5,y:5,height:8},{x:9.5,y:2,height:11}];return a("svg",{viewBox:"0 0 14 14","aria-hidden":!0,className:`tsk-glyph ${e==="none"?"tsk-priority-none":""} ${t}`.trim(),children:u.map((s,i)=>a("rect",{x:s.x,y:s.y,width:"3",height:s.height,rx:"1",className:i<o?"tsk-priority-on":"tsk-priority-off"},s.x))})}function la({items:e,error:t,onOpen:o,onMove:u,onNew:s}){let[i,r]=L(null);if(e===void 0)return a("div",{className:"tsk-board-skeleton","aria-hidden":!0,children:Array.from({length:5},(c,n)=>a("div",{className:"tsk-board-skel-col"},n))});if(t&&e.length===0)return a(H,{title:"Couldn't load tasks",description:t});if(e.length===0)return a(H,{title:"No tasks yet",description:"Create the first task to start tracking work.",action:l("button",{type:"button",className:"tsk-btn tsk-btn-primary",onClick:()=>s("todo"),children:[a(A,{size:14}),"New task"]})});let d=He(e);return a(ua,{label:"Tasks by status",columnWidth:240,className:"tsk-board",children:Ne(d).map(c=>{let n=d[c];return a(sa,{columnId:c,label:P[c],count:n.length,icon:a(b,{status:c}),children:l("div",{className:"tsk-col-drop","data-drop-status":c,onDragOver:p=>{p.preventDefault(),p.dataTransfer.dropEffect="move"},onDrop:p=>{p.preventDefault();let S=p.dataTransfer.getData("text/task-id"),g=e.find(v=>v.id===S);if(!g)return;let I=[...p.currentTarget.querySelectorAll("[data-task-id]")].findIndex(v=>{let q=v.getBoundingClientRect();return p.clientY<q.top+q.height/2});u(g,c,I===-1?n.length:I),r(null)},children:[n.map(p=>l("article",{"data-task-id":p.id,"data-task-key":p.key,draggable:!0,className:`tsk-card ${i===p.id?"is-dragging":""}`,onDragStart:S=>{S.dataTransfer.setData("text/task-id",p.id),S.dataTransfer.effectAllowed="move",r(p.id)},onDragEnd:()=>r(null),onClick:()=>o(p),children:[a("div",{className:"tsk-card-meta",children:a("span",{className:"tsk-card-key",children:p.key})}),a("div",{className:"tsk-card-title",children:p.title}),a("div",{className:"tsk-card-foot",children:a("span",{title:y[p.priority],children:a(M,{priority:p.priority})})})]},p.id)),l("button",{type:"button",className:"tsk-col-add",onClick:()=>s(c),children:[a(A,{size:12}),"Add"]})]})},c)})})}function N({icon:e,label:t,activeText:o,children:u,align:s="start",variant:i="chip",ariaLabel:r}){let[d,c]=L(!1),n=W(null),p=De();return k(()=>{if(!d)return;let g=I=>{n.current?.contains(I.target)||c(!1)},h=I=>{I.key==="Escape"&&c(!1)};return document.addEventListener("mousedown",g),document.addEventListener("keydown",h),()=>{document.removeEventListener("mousedown",g),document.removeEventListener("keydown",h)}},[d]),l("div",{className:`tsk-chip-wrap ${s==="end"?"tsk-chip-wrap-end":""}`,ref:n,children:[l("button",{type:"button",className:`${i==="ghost"?"tsk-icon-btn":"tsk-chip"} ${!!o?"is-active":""}`,"aria-label":r??t,"aria-haspopup":"menu","aria-expanded":d,"aria-controls":p,onClick:()=>c(g=>!g),children:[e,i==="chip"?t:null,o?a("span",{className:"tsk-chip-value",children:o}):null]}),d?a("div",{id:p,role:"menu",className:"tsk-menu",children:u(()=>c(!1))}):null]})}function z({icon:e,checked:t,children:o,onSelect:u}){return l("button",{type:"button",role:"menuitemcheckbox","aria-checked":t,className:"tsk-menu-item",onClick:u,children:[e,a("span",{className:"tsk-menu-item-label",children:o}),t?a("span",{className:"tsk-menu-check",children:"\u2713"}):null]})}function oe({task:e,kind:t,onEdit:o}){return t==="status"?a(N,{variant:"ghost",ariaLabel:`Status: ${P[e.status]}`,icon:a(b,{status:e.status}),children:u=>a(T,{children:B.map(s=>a(z,{icon:a(b,{status:s}),checked:e.status===s,onSelect:()=>{o({status:s}),u()},children:P[s]},s))})}):a(N,{variant:"ghost",ariaLabel:`Priority: ${y[e.priority]}`,icon:a(M,{priority:e.priority}),children:u=>a(T,{children:O.map(s=>a(z,{icon:a(M,{priority:s}),checked:e.priority===s,onSelect:()=>{o({priority:s}),u()},children:y[s]},s))})})}function da({task:e,onOpen:t,onEdit:o}){return l("div",{className:"tsk-row","data-task-key":e.key,children:[a("button",{type:"button",className:"tsk-row-hit","aria-label":`Open ${e.key}: ${e.title}`,onClick:t}),a("div",{className:"tsk-row-priority",children:a(oe,{task:e,kind:"priority",onEdit:o})}),a("span",{className:"tsk-row-key",children:e.key}),a("div",{className:"tsk-row-status",children:a(oe,{task:e,kind:"status",onEdit:o})}),a("span",{className:"tsk-row-title",children:e.title}),e.dueDate?l("span",{className:"tsk-row-due",children:[a(E,{size:12,"aria-hidden":!0}),ie(e.dueDate)]}):null]})}function na({task:e,error:t,onPatch:o,onRemove:u}){let[s,i]=L(e?.description??"");return k(()=>{i(e?.description??"")},[e?.id,e?.description]),t&&!e?a("div",{className:"tsk-detail",children:a("p",{className:"tsk-empty-desc",children:t})}):e?l("div",{className:"tsk-detail",children:[l("div",{className:"tsk-detail-props",children:[a(oe,{task:e,kind:"status",onEdit:r=>o(r)}),a("span",{className:"tsk-detail-status",children:P[e.status]}),a(oe,{task:e,kind:"priority",onEdit:r=>o(r)}),a("span",{className:"tsk-detail-status",children:y[e.priority]}),l("label",{className:"tsk-due-field",children:[a(E,{size:12}),a("input",{type:"date","aria-label":"Due date",value:e.dueDate??"",onChange:r=>o({dueDate:r.target.value||null})}),e.dueDate?a("span",{children:ie(e.dueDate)}):a("span",{children:"Due date"})]})]}),a("h1",{className:"tsk-detail-title",contentEditable:!0,suppressContentEditableWarning:!0,role:"textbox","aria-label":"Task title",onKeyDown:r=>{r.key==="Enter"&&(r.preventDefault(),r.currentTarget.blur())},onBlur:r=>{let d=r.currentTarget.textContent?.trim()??"";if(!d){r.currentTarget.textContent=e.title;return}d!==e.title&&o({title:d})},children:e.title}),a("textarea",{className:"tsk-detail-body","aria-label":"Task description",placeholder:"Add a description\u2026",value:s,onChange:r=>i(r.target.value),onBlur:()=>{s!==e.description&&o({description:s})}}),l("button",{type:"button",className:"tsk-btn tsk-btn-danger",onClick:u,children:[a(ae,{size:14}),"Delete task"]})]}):l("div",{className:"tsk-detail",children:[a("div",{className:"tsk-skeleton-row"}),a("div",{className:"tsk-skeleton-row"})]})}function ia(e,t){return e.includes(t)?e.filter(o=>o!==t):[...e,t]}function fa({filters:e,sort:t,taskCount:o,onFilters:u,onSort:s}){let i=le(e);return l("div",{className:"tsk-filters",children:[l("div",{className:"tsk-filters-left",children:[a(N,{icon:a(Q,{size:12}),label:"Status",activeText:e.statuses.map(r=>P[r]).join(", "),children:()=>B.map(r=>a(z,{icon:a(b,{status:r}),checked:e.statuses.includes(r),onSelect:()=>u({...e,statuses:ia(e.statuses,r)}),children:P[r]},r))}),a(N,{icon:a(K,{size:12}),label:"Priority",activeText:e.priorities.map(r=>y[r]).join(", "),children:()=>O.map(r=>a(z,{icon:a(M,{priority:r}),checked:e.priorities.includes(r),onSelect:()=>u({...e,priorities:ia(e.priorities,r)}),children:y[r]},r))}),i?l("button",{type:"button",className:"tsk-chip",onClick:()=>u(U),children:[a(te,{size:12}),"Clear"]}):null]}),a(N,{icon:a(Y,{size:12}),label:"Sort",activeText:t==="manual"?void 0:ge[t],align:"end",children:r=>Le.map(d=>a(z,{checked:t===d,onSelect:()=>{s(d),r()},children:ge[d]},d))}),a("span",{className:"tsk-count",children:o===void 0?"":`${o} ${o===1?"task":"tasks"}`})]})}function ca({items:e,error:t,filters:o,sort:u,onFilters:s,onSort:i,onOpen:r,onEdit:d,onNew:c}){let n=e?.filter(h=>Ee(h,o)),p=n?ne(de(n,u)):[],S=!!(n&&n.length===0&&e&&e.length>0&&le(o)),g;return e===void 0?g=a("div",{className:"tsk-skeleton","aria-hidden":!0,children:Array.from({length:6},(h,I)=>a("div",{className:"tsk-skeleton-row"},I))}):t&&e.length===0?g=a(H,{title:"Couldn't load tasks",description:t}):S?g=a(H,{title:"No tasks match these filters",action:a("button",{type:"button",className:"tsk-btn tsk-btn-secondary",onClick:()=>s(U),children:"Clear filters"})}):e.length===0?g=a(H,{title:"No tasks yet",description:"Create the first task to start tracking work.",action:l("button",{type:"button",className:"tsk-btn tsk-btn-primary",onClick:c,children:[a(A,{size:14}),"New task"]})}):g=p.map(h=>l("section",{className:"tsk-group",children:[l("div",{className:"tsk-group-head","data-status-group-header":h.status,children:[a(b,{status:h.status}),a("span",{children:P[h.status]}),a("span",{className:"tsk-group-count",children:h.tasks.length})]}),h.tasks.map(I=>a(da,{task:I,onOpen:()=>r(I),onEdit:v=>d(I,v)},I.id))]},h.status)),l("div",{className:"tsk-list",children:[a(fa,{filters:o,sort:u,taskCount:n?.length,onFilters:s,onSort:i}),a("div",{className:"tsk-list-body",children:g})]})}function pa({open:e,defaultStatus:t="todo",busy:o,error:u,onClose:s,onCreate:i}){let[r,d]=L({title:"",description:"",status:t,priority:"none",dueDate:""}),c=W(null);return k(()=>{if(!e)return;d({title:"",description:"",status:t,priority:"none",dueDate:""});let n=requestAnimationFrame(()=>c.current?.focus());return()=>cancelAnimationFrame(n)},[e,t]),e?l("div",{className:"tsk-modal-root",role:"presentation",children:[a("button",{type:"button",className:"tsk-modal-backdrop","aria-label":"Close",onClick:s}),l("div",{className:"tsk-modal",role:"dialog","aria-labelledby":"tsk-new-title","aria-modal":"true",children:[a("h2",{id:"tsk-new-title",children:"New task"}),a("p",{className:"tsk-modal-lead",children:"Create a task with a title, status, and optional due date."}),l("form",{className:"tsk-modal-form",onSubmit:n=>{n.preventDefault(),!(!r.title.trim()||o)&&i(r)},children:[l("label",{className:"tsk-field",children:["Title",a("input",{ref:c,value:r.title,onChange:n=>d({...r,title:n.target.value}),placeholder:"Ship the tracker",required:!0})]}),l("label",{className:"tsk-field",children:["Description",a("textarea",{value:r.description,onChange:n=>d({...r,description:n.target.value}),placeholder:"What needs to happen?",rows:4})]}),l("div",{className:"tsk-field-row",children:[l("label",{className:"tsk-field",children:["Status",a("select",{value:r.status,onChange:n=>d({...r,status:n.target.value}),children:B.map(n=>a("option",{value:n,children:P[n]},n))})]}),l("label",{className:"tsk-field",children:["Priority",a("select",{value:r.priority,onChange:n=>d({...r,priority:n.target.value}),children:O.map(n=>a("option",{value:n,children:y[n]},n))})]}),l("label",{className:"tsk-field",children:["Due",a("input",{type:"date",value:r.dueDate,onChange:n=>d({...r,dueDate:n.target.value})})]})]}),l("div",{className:"tsk-status-preview","aria-hidden":!0,children:[a(b,{status:r.status}),a(M,{priority:r.priority})]}),u?a("p",{className:"tsk-form-error",children:u}):null,l("div",{className:"tsk-modal-actions",children:[a("button",{type:"button",className:"tsk-btn tsk-btn-secondary",onClick:s,children:"Cancel"}),a("button",{type:"submit",className:"tsk-btn tsk-btn-primary",disabled:o||!r.title.trim(),children:"Create task"})]})]})]})]}):null}function ma({route:e,pager:t,onBack:o,onView:u,onNew:s,onStep:i}){return l("header",{className:"tsk-topbar",children:[a("div",{className:"tsk-topbar-lead",children:e.kind==="task"?l(T,{children:[a("button",{type:"button",className:"tsk-icon-btn","aria-label":"Back (Esc)",onClick:o,children:a(Z,{size:16})}),a("span",{className:"tsk-crumb",children:e.taskKey})]}):a("span",{className:"tsk-crumb-title",children:"All tasks"})}),e.kind==="task"&&t?l("div",{className:"tsk-pager",children:[l("span",{children:[t.index," / ",t.total]}),a("button",{type:"button",className:"tsk-icon-btn","aria-label":"Previous task",disabled:!t.prevKey,onClick:()=>t.prevKey&&i(t.prevKey),children:a(J,{size:14})}),a("button",{type:"button",className:"tsk-icon-btn","aria-label":"Next task",disabled:!t.nextKey,onClick:()=>t.nextKey&&i(t.nextKey),children:a(j,{size:14})})]}):null,e.kind==="browse"?l("div",{className:"tsk-view-toggle",role:"group","aria-label":"Task view",children:[a("button",{type:"button",className:e.view==="list"?"is-active":"","aria-pressed":e.view==="list",onClick:()=>u("list"),children:"List"}),a("button",{type:"button",className:e.view==="board"?"is-active":"","aria-pressed":e.view==="board",onClick:()=>u("board"),children:"Board"})]}):null,e.kind==="browse"?l("button",{type:"button",className:"tsk-btn tsk-btn-primary tsk-new","aria-label":"New task",onClick:s,children:[a(A,{size:14}),a("span",{children:"New task"})]}):null]})}function xa(e,t){let o=t.toUpperCase(),u=e.findIndex(s=>s.key.toUpperCase()===o);return u===-1?null:{index:u+1,total:e.length,prevKey:e[u-1]?.key??null,nextKey:e[u+1]?.key??null}}function La(){let e=re(),[t,o]=L(void 0),[u,s]=L(null),i=_(()=>e.call("list").then(r=>{let d=r;o(Array.isArray(d?.items)?d.items:[]),s(null)}).catch(r=>{s(r instanceof Error?r.message:String(r)),o(d=>d??[])}),[e]);return k(()=>{i()},[i]),ve(Fe,i),{items:t,error:u,refresh:i,rpc:e}}function Pe({pluginId:e,subPath:t}){let o=ue(),{items:u,error:s,refresh:i,rpc:r}=La(),[d,c]=L(Ke),[n,p]=L(We),[S,g]=L({open:!1,status:"todo"}),[h,I]=L(null),[v,q]=L(!1),[w,we]=L(()=>he(t,X()));k(()=>{we(he(t,X()))},[t]);let D=(f,C=!1)=>{f.kind==="browse"&&_e(f.view),we(f),o.toPluginPanel("main",{subPath:Ze(f),replace:C})};k(()=>{if(w.kind!=="task")return;let f=C=>{if(C.key!=="Escape"||C.defaultPrevented)return;let R=C.target;R instanceof HTMLInputElement||R instanceof HTMLTextAreaElement||R instanceof HTMLElement&&R.isContentEditable||D({kind:"browse",view:X()})};return window.addEventListener("keydown",f),()=>window.removeEventListener("keydown",f)},[w.kind]);let ka=xe(()=>u?ne(de(u,n)).flatMap(f=>f.tasks):[],[u,n]),G=w.kind==="task"?u?.find(f=>f.key.toUpperCase()===w.taskKey.toUpperCase()):void 0,pe=async f=>{try{return await f(),await i(),!0}catch(C){return I(C instanceof Error?C.message:String(C)),!1}},be=(f,C)=>{pe(()=>r.call("update",{id:f.id,...C}))},Pa=f=>{q(!0),I(null),r.call("add",{title:f.title,description:f.description,status:f.status,priority:f.priority,dueDate:f.dueDate||void 0}).then(async C=>{let R=C;g({open:!1,status:"todo"}),await i(),R?.key&&D({kind:"task",taskKey:R.key})}).catch(C=>{I(C instanceof Error?C.message:String(C))}).finally(()=>q(!1))};return l("div",{className:"tsk-panel","data-plugin":e,children:[a(ma,{route:w,pager:w.kind==="task"?xa(ka,w.taskKey):null,onBack:()=>D({kind:"browse",view:X()}),onView:f=>D({kind:"browse",view:f},!0),onNew:()=>{I(null),g({open:!0,status:"todo"})},onStep:f=>D({kind:"task",taskKey:f})}),w.kind==="browse"&&w.view==="list"?a(ca,{items:u,error:s,filters:d,sort:n,onFilters:f=>{c(f),je(f)},onSort:f=>{p(f),Xe(f)},onOpen:f=>D({kind:"task",taskKey:f.key}),onEdit:be,onNew:()=>g({open:!0,status:"todo"})}):null,w.kind==="browse"&&w.view==="board"?a(la,{items:u,error:s,onOpen:f=>D({kind:"task",taskKey:f.key}),onMove:(f,C,R)=>{pe(()=>r.call("boardMove",{id:f.id,status:C,index:R}))},onNew:f=>{I(null),g({open:!0,status:f})}}):null,w.kind==="task"?a(na,{task:G,error:s??(u&&!G?`task not found: ${w.taskKey}`:null),onPatch:f=>{G&&be(G,f)},onRemove:()=>{G&&pe(()=>r.call("remove",{id:G.id})).then(f=>{f&&D({kind:"browse",view:X()})})}}):null,a(pa,{open:S.open,defaultStatus:S.status,busy:v,error:h,onClose:()=>g({open:!1,status:"todo"}),onCreate:Pa})]})}function ga({pluginId:e}){return a(Pe,{pluginId:e,subPath:""})}function Ia(e){let t=re(),o=ue(),u=e.attributes.key||e.attributes.id||"",s=e.attributes.title||u||"Task",[i,r]=L(null);k(()=>{u&&t.call("get",{key:u}).then(p=>{let S=p;S?.task&&r(S.task)}).catch(()=>{})},[u,t]);let d=i?.title??s,c=i?.status??"todo",n=i?.key??u;return l("button",{type:"button",className:"tsk-directive",onClick:()=>{n&&o.toPluginPanel("main",{subPath:`task/${n}`})},children:[a(b,{status:c}),a("span",{className:"tsk-directive-key",children:n}),a("span",{className:"tsk-directive-title",children:d})]})}var Ka="tasks";function Ca(){let[e,t]=L(null);return k(()=>{let o=!0,u=async()=>{try{let i=await Ae(Ka,"badge");if(!o)return;t(typeof i?.count=="number"&&i.count>0?i.count:null)}catch{o&&t(null)}};u();let s=window.setInterval(()=>void u(),15e3);return()=>{o=!1,window.clearInterval(s)}},[]),e==null?null:a("span",{className:"nav-badge",children:e})}var ha=`.tsk-panel {
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
`;var Sa="tsk-plugin-styles";function Za(){if(typeof document>"u")return;let e=`${oa}
${ha}`,t=document.getElementById(Sa);if(t instanceof HTMLStyleElement){t.textContent=e;return}let o=document.createElement("style");o.id=Sa,o.textContent=e,document.head.appendChild(o)}Za();var Tu=Te(e=>{e.slots.navPanel({id:"main",title:"Tasks",icon:"ListTodo",component:Pe,experimental_sidebarAccessory:Ca}),e.slots.threadPanelAction({id:"board",title:"Tasks",icon:"ListTodo",layout:"flush",scopes:["thread","agent-session"],component:ga}),e.slots.messageDirective({id:"task",component:Ia}),e.slots.commandPaletteAction({id:"open",title:"Open Tasks",run:t=>{t.toPluginPanel("main")}})});export{Tu as default,Za as injectStyles};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-react/dist/esm/defaultAttributes.mjs:
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
lucide-react/dist/esm/icons/trash-2.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.35.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
