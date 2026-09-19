function T(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function U(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}function _(e){return{__zccPluginApp:!0,setup:e}}function B(){return T().useRpc?.()??U("useRpc")}function H(e,a){T().useRealtime?.(e,a)}function M(){return T().useZccNavigate?.()??U("useZccNavigate")}function X(){return T().useComposerView?.()??U("useComposerView")}var f=globalThis.__ZCC_HOST_REACT__;var ea=f.Children,aa=f.Component,ta=f.Fragment,oa=f.StrictMode,ua=f.Suspense,da=f.cloneElement,j=f.createContext,C=f.createElement,la=f.createRef,y=f.forwardRef,ra=f.isValidElement,sa=f.lazy,fa=f.memo,na=f.startTransition,D=f.useCallback,Z=f.useContext,ia=f.useDebugValue,ca=f.useDeferredValue,k=f.useEffect,K=f.useId,pa=f.useImperativeHandle,ma=f.useInsertionEffect,J=f.useLayoutEffect,Te=f.useMemo,La=f.useReducer,F=f.useRef,I=f.useState,Ia=f.useSyncExternalStore,xa=f.useTransition,ga=f.version;var $=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Q(e,a,o=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:$(e),size:24,node:a,...o.length>0?{aliases:o}:{}}}var Y=e=>{let a="",o=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){o=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=o?t.toUpperCase():t,o=!1}return a};var ee=e=>{let a=Y(e);return a.charAt(0).toUpperCase()+a.slice(1)};var A=(...e)=>e.filter((a,o,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===o).join(" ").trim();var p={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function E(e){return e!=null}function ae(e,a={}){let o=a.attributeNames??{},t=c=>o[c]??c,d=e.size??e.width??p.width,r=e.size??e.height??p.height,l=e.aliases?.filter(c=>typeof c=="string"&&c.trim()!=="").map(c=>`lucide-${c}`)??[],s=[...e.name?[`lucide-${e.name}`]:[],...l],n=a.className?.split(" ").filter(Boolean)??[],m=a.includeDefaultClasses===!1?A(...n):A("lucide",...s,...n),x=a.absoluteStrokeWidth?Number(a.strokeWidth??p["stroke-width"])*Number(e.size??e.width??p.width)/Number(a.size??a.width??p.width):a.strokeWidth??p["stroke-width"];return["svg",{...Object.entries(p).reduce((c,[L,g])=>(c[t(L)]=g,c),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&E(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&E(a.width)&&{[t("width")]:a.width},..."height"in a&&E(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:x,...m&&{[t("class")]:m},[t("viewBox")]:`0 0 ${d} ${r}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(c=>{let[L,g,R]=c,b=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...g}:g;return R?[L,b,R]:[L,b]})]}function te(e,a={}){return ae(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var oe=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Be=j({});var ue=()=>Z(Be);var de=y(({color:e,size:a,width:o,height:t,strokeWidth:d,absoluteStrokeWidth:r,nonScalingStroke:l,className:s="",children:n,iconNode:m=[],icon:x={node:m,aliases:[],size:24},...O},c)=>{let{size:L=24,strokeWidth:g=2,absoluteStrokeWidth:R=!1,nonScalingStroke:b=!1,color:he="currentColor",className:Se=""}=ue()??{},Pe=!!n||oe(O),[we,ke,Ae=[]]=te(x,{color:e??he,width:o??a??L,height:t??a??L,strokeWidth:d??g,absoluteStrokeWidth:r??R,nonScalingStroke:l??b,className:A(Se,s),hasA11yProp:Pe,attributes:O});return C(we,{ref:c,...ke},[...Ae.map(([Re,be])=>C(Re,be)),...Array.isArray(n)?n:[n]])});function h(e,a=[],o=[]){let t=typeof e=="string"?Q(e,a,o):e,d=y(({className:r,...l},s)=>C(de,{ref:s,icon:t,className:r,...l}));return t.name&&(d.displayName=ee(t.name)),d}var le={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};le.node;var S=h(le);var re={name:"git-branch",size:24,node:[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]]};re.node;var P=h(re);var se={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};se.node;var w=h(se);var N="workflow-runs";function G(e){if(typeof e!="object"||e===null)return null;let a=e.threadId;return typeof a=="string"?a:null}var fe=globalThis.__ZCC_HOST_REACT__,v=fe.Fragment;function u(e,a,o){return fe.createElement(e,o===void 0?a:{...a,key:o})}var i=u;var q="workflow-run",ie=1e3;function ce(e){if(typeof e!="string")return null;let a=e.trim();return/^wfr_[0-9a-f-]+$/i.test(a)?a:null}function pe(e){return e.status==="queued"||e.status==="running"}function Me(e){return e.scope.kind==="thread"||e.scope.kind==="queued-message"?e.scope.threadId:e.scope.kind==="side-chat"?e.scope.childThreadId??e.scope.parentThreadId:null}function ye(e){return e?.closest("[data-composer-thread]")?.getAttribute("data-composer-thread")?.trim()||null}function De(){if(typeof window>"u")return null;let a=window.location.pathname.match(/\/threads\/([^/]+)/)?.[1]?.trim()??"";return!a||a==="new"?null:a}function V(e,a,o){return e.call(a,o).catch(t=>{let d=globalThis.__ZCC_PLUGIN_HOST__;if(!d)throw t;return d.callRpc("workflows",a,o)})}function Fe(e){switch(e){case"queued":return"queued";case"running":return"running";case"succeeded":return"done";case"failed":return"failed";case"cancelled":return"cancelled"}}function me(e,a){let o=B(),[t,d]=I({status:"loading"}),r=F(0),l=D(async()=>{let s=++r.current;try{let n=await V(o,"workflowRunView",{threadId:e,runId:a});s===r.current&&d({status:"ready",run:n.run,refreshError:null})}catch(n){if(s!==r.current)return;let m=n instanceof Error?n.message:String(n);d(x=>x.status==="ready"?{...x,refreshError:m}:{status:"error",message:m})}},[o,a,e]);return k(()=>(d({status:"loading"}),l(),()=>{r.current+=1}),[l]),H(N,s=>{G(s)===e&&l()}),k(()=>{if(t.status!=="ready"||t.run===null||!pe(t.run))return;let s=window.setInterval(()=>{l()},ie);return()=>window.clearInterval(s)},[l,t]),{state:t,refresh:l}}function ve(e){let a=B(),[o,t]=I({status:"loading"}),d=F(0),r=D(async()=>{let s=++d.current;try{let n=await V(a,"workflowActiveRuns",{threadId:e});s===d.current&&t({status:"ready",runs:n.runs})}catch{s===d.current&&t({status:"error"})}},[a,e]);k(()=>(t({status:"loading"}),r(),()=>{d.current+=1}),[r]),H(N,s=>{G(s)===e&&r()}),k(()=>{let s=window.setInterval(()=>{r()},ie);return()=>window.clearInterval(s)},[r]);let l=D(s=>{t(n=>n.status==="ready"?{status:"ready",runs:s(n.runs)}:n)},[]);return{state:o,setRuns:l}}function ne({calls:e,onOpen:a}){return e.length===0?null:u("div",{children:e.map(o=>i("div",{className:`wf-call${o.childThreadId?" is-actionable":""}`,children:[u("span",{className:"wf-pill",children:Fe(o.status)}),o.childThreadId?u("button",{type:"button",onClick:()=>a(o.childThreadId),children:o.label}):u("span",{children:o.label}),o.cached?u("span",{className:"wf-pill",children:"cached"}):null]},o.id))})}function W({run:e}){let a=M(),o=t=>a.toThread(t);return i(v,{children:[e.phases.map(t=>i("section",{className:"wf-phase",children:[u("h4",{children:t.title}),t.detail?u("p",{className:"wf-muted",children:t.detail}):null,u(ne,{calls:t.calls,onOpen:o})]},t.title)),e.unphasedCalls.length>0?i("section",{className:"wf-phase",children:[u("h4",{children:"Other work"}),u(ne,{calls:e.unphasedCalls,onOpen:o})]}):null]})}function Le({threadId:e,run:a,onStopped:o}){let t=B(),[d,r]=I(!1);return pe(a)?u("button",{type:"button",className:"wf-btn",disabled:d,onClick:()=>{r(!0),V(t,"workflowStopRun",{threadId:e,runId:a.id}).then(l=>{let s=l.run;o(s)}).finally(()=>r(!1))},children:d?"Stopping\u2026":"Stop workflow"}):null}function Ie({attributes:e,message:a}){let t=Object.keys(e).some(d=>d!=="run")?null:ce(e.run);return t===null?i("div",{className:"wf-invalid",children:["workflow-preview requires exactly one valid run attribute, e.g."," ",u("code",{children:'::workflow-preview{run="wfr_\u2026"}'})]}):u(qe,{threadId:a.threadId,runId:t})}function qe({threadId:e,runId:a}){let{state:o}=me(e,a),t=M(),[d,r]=I(!1),l=K();if(o.status==="loading")return u("div",{className:"wf-muted",children:"Loading workflow\u2026"});if(o.status==="error")return u("div",{className:"wf-error",children:o.message});if(o.run===null)return u("div",{className:"wf-muted",children:"Unknown workflow run."});let s=o.run;return i("article",{className:"wf-card","aria-label":"Workflow",children:[i("div",{className:"wf-card-head",children:[i("button",{type:"button",className:"wf-card-toggle","aria-expanded":d,"aria-controls":l,onClick:()=>r(n=>!n),children:[u(P,{size:14,"aria-hidden":!0}),u("span",{className:"wf-title",style:{margin:0},children:s.name}),u("span",{className:"wf-pill",children:s.status}),u(S,{size:14,"aria-hidden":!0})]}),u("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${s.name} in side panel`,onClick:()=>t.openThreadPanel({actionId:q,title:s.name,params:{runId:s.id}}),children:u(w,{size:14,"aria-hidden":!0})})]}),d?u("div",{id:l,className:"wf-card-body",children:u(W,{run:s})}):null]})}function Oe({run:e,threadId:a,onStopped:o}){let t=M(),[d,r]=I(!1);return i("section",{className:"wf-banner-card","aria-label":"Workflow",children:[i("div",{className:"wf-banner-head",children:[i("button",{type:"button",className:"wf-banner-toggle","aria-expanded":d,onClick:()=>r(l=>!l),children:[u(P,{size:14,"aria-hidden":!0}),u("span",{children:e.name}),u("span",{className:"wf-pill",children:e.status}),u(S,{size:14,"aria-hidden":!0})]}),u("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${e.name} in side panel`,onClick:()=>t.openThreadPanel({actionId:q,title:e.name,params:{runId:e.id}}),children:u(w,{size:14,"aria-hidden":!0})})]}),d?i("div",{className:"wf-card-body",children:[u(W,{run:e}),u(Le,{threadId:a,run:e,onStopped:o})]}):null]})}function xe(){let e=X(),a=F(null),[o,t]=I(null);J(()=>{t(ye(a.current))},[]);let d=Me(e)??o??De();return u("div",{ref:a,"data-testid":"wf-banner-root","data-wf-thread":d??"",children:d?u(Ue,{threadId:d}):null})}function Ue({threadId:e}){let{state:a,setRuns:o}=ve(e);return a.status!=="ready"||a.runs.length===0?null:u("div",{className:"wf-banner",children:a.runs.map(t=>u(Oe,{run:t,threadId:e,onStopped:d=>o(r=>r.map(l=>l.id===d.id?d:l))},t.id))})}function He(e){return e===null||typeof e!="object"||Array.isArray(e)?null:ce(e.runId)}function ge({threadId:e,params:a}){let o=He(a),{state:t,refresh:d}=me(e,o),r;if(t.status==="loading")r=u("p",{className:"wf-muted",children:"Loading workflow\u2026"});else if(t.status==="error")r=u("p",{className:"wf-error",children:t.message});else if(t.run===null)r=u("p",{className:"wf-muted",children:"No workflow run in this thread."});else{let l=t.run;r=i(v,{children:[u("h2",{className:"wf-title",children:l.name}),u("p",{className:"wf-muted",children:l.description}),u(W,{run:l}),i("dl",{className:"wf-meta",children:[u("dt",{children:"Status"}),u("dd",{children:l.status}),u("dt",{children:"Result"}),u("dd",{children:l.resultAvailable?"Available":"\u2014"}),l.error?i(v,{children:[u("dt",{children:"Error"}),u("dd",{className:"wf-error",children:l.error})]}):null]})]})}return i("div",{className:"wf-panel",children:[u("div",{className:"wf-panel-body",children:r}),t.status==="ready"&&t.run?u("div",{className:"wf-panel-footer",children:u(Le,{threadId:e,run:t.run,onStopped:()=>{d()}})}):null]})}var z=`.wf-panel,
.wf-card,
.wf-banner {
  color: var(--text-primary);
  font-size: 13px;
}

.wf-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}

.wf-panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}

.wf-panel-footer {
  flex-shrink: 0;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
}

.wf-muted {
  color: var(--text-muted);
}

.wf-error {
  color: var(--danger, #c44);
}

.wf-title {
  font-weight: 600;
  margin: 0 0 8px;
}

.wf-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  font-size: 12px;
}

.wf-meta dt {
  color: var(--text-muted);
}

.wf-meta dd {
  margin: 0;
  text-align: right;
}

.wf-phase {
  margin: 0 0 12px;
}

.wf-phase h4 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
}

.wf-call {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
  font-size: 12px;
}

.wf-call button {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.wf-call.is-actionable button:hover {
  text-decoration: underline;
}

.wf-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.wf-card,
.wf-banner-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated, var(--bg-panel));
  overflow: hidden;
}

.wf-card-head,
.wf-banner-head {
  display: flex;
  align-items: center;
  min-height: 32px;
}

.wf-card-head button,
.wf-banner-head button {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.wf-card-toggle,
.wf-banner-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  text-align: left;
}

.wf-card-open {
  width: 32px;
  flex-shrink: 0;
  border-left: 1px solid var(--border) !important;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.wf-card-body {
  border-top: 1px solid var(--border);
  padding: 8px 10px 10px;
}

.wf-btn {
  width: 100%;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--danger, #c44);
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.wf-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.wf-banner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wf-invalid {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.wf-invalid code {
  font-size: 11px;
}
`;var Ce="wf-plugin-styles";function Ne(){if(typeof document>"u")return;let e=document.getElementById(Ce);if(e instanceof HTMLStyleElement){e.textContent=z;return}let a=document.createElement("style");a.id=Ce,a.textContent=z,document.head.appendChild(a)}Ne();var Lt=_(e=>{e.composer.customize({id:"workflow-status",scopes:["thread"],banners:[{id:"active-runs",chrome:"bare",component:xe}]}),e.slots.messageDirective({id:"workflow-preview",component:Ie}),e.slots.threadPanelAction({id:q,title:"Workflow run",icon:"GitBranch",component:ge,layout:"flush"})});export{Lt as default,Ne as injectStyles};
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
lucide-react/dist/esm/icons/chevron-down.mjs:
lucide-react/dist/esm/icons/git-branch.mjs:
lucide-react/dist/esm/icons/panel-right.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.47.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
