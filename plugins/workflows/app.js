function T(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function U(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}function _(e){return{__zccPluginApp:!0,setup:e}}function y(){return T().useRpc?.()??U("useRpc")}function H(e,a){T().useRealtime?.(e,a)}function B(){return T().useZccNavigate?.()??U("useZccNavigate")}function j(){return T().useComposerView?.()??U("useComposerView")}var n=globalThis.__ZCC_HOST_REACT__;var ea=n.Children,aa=n.Component,ta=n.Fragment,oa=n.StrictMode,ua=n.Suspense,ra=n.cloneElement,X=n.createContext,C=n.createElement,da=n.createRef,D=n.forwardRef,la=n.isValidElement,sa=n.lazy,na=n.memo,fa=n.startTransition,M=n.useCallback,Z=n.useContext,ia=n.useDebugValue,ca=n.useDeferredValue,A=n.useEffect,K=n.useId,pa=n.useImperativeHandle,ma=n.useInsertionEffect,$=n.useLayoutEffect,Te=n.useMemo,La=n.useReducer,F=n.useRef,g=n.useState,ga=n.useSyncExternalStore,Ia=n.useTransition,xa=n.version;var J=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Q(e,a,o=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:J(e),size:24,node:a,...o.length>0?{aliases:o}:{}}}var Y=e=>{let a="",o=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){o=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=o?t.toUpperCase():t,o=!1}return a};var ee=e=>{let a=Y(e);return a.charAt(0).toUpperCase()+a.slice(1)};var k=(...e)=>e.filter((a,o,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===o).join(" ").trim();var p={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function E(e){return e!=null}function ae(e,a={}){let o=a.attributeNames??{},t=c=>o[c]??c,r=e.size??e.width??p.width,l=e.size??e.height??p.height,d=e.aliases?.filter(c=>typeof c=="string"&&c.trim()!=="").map(c=>`lucide-${c}`)??[],s=[...e.name?[`lucide-${e.name}`]:[],...d],f=a.className?.split(" ").filter(Boolean)??[],m=a.includeDefaultClasses===!1?k(...f):k("lucide",...s,...f),I=a.absoluteStrokeWidth?Number(a.strokeWidth??p["stroke-width"])*Number(e.size??e.width??p.width)/Number(a.size??a.width??p.width):a.strokeWidth??p["stroke-width"];return["svg",{...Object.entries(p).reduce((c,[L,x])=>(c[t(L)]=x,c),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&E(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&E(a.width)&&{[t("width")]:a.width},..."height"in a&&E(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:I,...m&&{[t("class")]:m},[t("viewBox")]:`0 0 ${r} ${l}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(c=>{let[L,x,R]=c,b=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...x}:x;return R?[L,b,R]:[L,b]})]}function te(e,a={}){return ae(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var oe=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var ye=X({});var ue=()=>Z(ye);var re=D(({color:e,size:a,width:o,height:t,strokeWidth:r,absoluteStrokeWidth:l,nonScalingStroke:d,className:s="",children:f,iconNode:m=[],icon:I={node:m,aliases:[],size:24},...O},c)=>{let{size:L=24,strokeWidth:x=2,absoluteStrokeWidth:R=!1,nonScalingStroke:b=!1,color:he="currentColor",className:Se=""}=ue()??{},Pe=!!f||oe(O),[we,Ae,ke=[]]=te(I,{color:e??he,width:o??a??L,height:t??a??L,strokeWidth:r??x,absoluteStrokeWidth:l??R,nonScalingStroke:d??b,className:k(Se,s),hasA11yProp:Pe,attributes:O});return C(we,{ref:c,...Ae},[...ke.map(([Re,be])=>C(Re,be)),...Array.isArray(f)?f:[f]])});function h(e,a=[],o=[]){let t=typeof e=="string"?Q(e,a,o):e,r=D(({className:l,...d},s)=>C(re,{ref:s,icon:t,className:l,...d}));return t.name&&(r.displayName=ee(t.name)),r}var de={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};de.node;var S=h(de);var le={name:"git-branch",size:24,node:[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]]};le.node;var P=h(le);var se={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};se.node;var w=h(se);var N="workflow-runs";function V(e){if(typeof e!="object"||e===null)return null;let a=e.threadId;return typeof a=="string"?a:null}var ne=globalThis.__ZCC_HOST_REACT__,v=ne.Fragment;function u(e,a,o){return ne.createElement(e,o===void 0?a:{...a,key:o})}var i=u;var q="workflow-run",ie=1e3;function ce(e){if(typeof e!="string")return null;let a=e.trim();return/^wfr_[0-9a-f-]+$/i.test(a)?a:null}function pe(e){return e.status==="queued"||e.status==="running"}function Be(e){return e.scope.kind==="thread"||e.scope.kind==="queued-message"?e.scope.threadId:e.scope.kind==="side-chat"?e.scope.childThreadId??e.scope.parentThreadId:null}function De(e){return e?.closest("[data-composer-thread]")?.getAttribute("data-composer-thread")?.trim()||null}function Me(){if(typeof window>"u")return null;let a=window.location.pathname.match(/\/threads\/([^/]+)/)?.[1]?.trim()??"";return!a||a==="new"?null:a}function G(e,a,o){return e.call(a,o).catch(t=>{let r=globalThis.__ZCC_PLUGIN_HOST__;if(!r)throw t;return r.callRpc("workflows",a,o)})}function Fe(e){switch(e){case"queued":return"queued";case"running":return"running";case"succeeded":return"done";case"failed":return"failed";case"cancelled":return"cancelled"}}function me(e,a){let o=y(),[t,r]=g({status:"loading"}),l=F(0),d=M(async()=>{let s=++l.current;try{let f=await G(o,"workflowRunView",{threadId:e,runId:a});s===l.current&&r({status:"ready",run:f.run,refreshError:null})}catch(f){if(s!==l.current)return;let m=f instanceof Error?f.message:String(f);r(I=>I.status==="ready"?{...I,refreshError:m}:{status:"error",message:m})}},[o,a,e]);return A(()=>(r({status:"loading"}),d(),()=>{l.current+=1}),[d]),H(N,s=>{V(s)===e&&d()}),A(()=>{if(t.status!=="ready"||t.run===null||!pe(t.run))return;let s=window.setInterval(()=>{d()},ie);return()=>window.clearInterval(s)},[d,t]),{state:t,refresh:d}}function ve(e){let a=y(),[o,t]=g({status:"loading"}),r=F(0),l=M(async()=>{let s=++r.current;try{let f=await G(a,"workflowActiveRuns",{threadId:e});s===r.current&&t({status:"ready",runs:f.runs})}catch{s===r.current&&t({status:"error"})}},[a,e]);A(()=>(t({status:"loading"}),l(),()=>{r.current+=1}),[l]),H(N,s=>{V(s)===e&&l()}),A(()=>{let s=window.setInterval(()=>{l()},ie);return()=>window.clearInterval(s)},[l]);let d=M(s=>{t(f=>f.status==="ready"?{status:"ready",runs:s(f.runs)}:f)},[]);return{state:o,setRuns:d}}function fe({calls:e,onOpen:a}){return e.length===0?null:u("div",{children:e.map(o=>i("div",{className:`wf-call${o.childThreadId?" is-actionable":""}`,children:[u("span",{className:"wf-pill",children:Fe(o.status)}),o.childThreadId?u("button",{type:"button",onClick:()=>a(o.childThreadId),children:o.label}):u("span",{children:o.label}),o.cached?u("span",{className:"wf-pill",children:"cached"}):null]},o.id))})}function W({run:e}){let a=B(),o=t=>a.toThread(t);return i(v,{children:[e.phases.map(t=>i("section",{className:"wf-phase",children:[u("h4",{children:t.title}),t.detail?u("p",{className:"wf-muted",children:t.detail}):null,u(fe,{calls:t.calls,onOpen:o})]},t.title)),e.unphasedCalls.length>0?i("section",{className:"wf-phase",children:[u("h4",{children:"Other work"}),u(fe,{calls:e.unphasedCalls,onOpen:o})]}):null]})}function Le({threadId:e,run:a,onStopped:o}){let t=y(),[r,l]=g(!1);return pe(a)?u("button",{type:"button",className:"wf-btn",disabled:r,onClick:()=>{l(!0),G(t,"workflowStopRun",{threadId:e,runId:a.id}).then(d=>{let s=d.run;o(s)}).finally(()=>l(!1))},children:r?"Stopping\u2026":"Stop workflow"}):null}function ge({attributes:e,message:a}){let t=Object.keys(e).some(r=>r!=="run")?null:ce(e.run);return t===null?i("div",{className:"wf-invalid",children:["workflow-preview requires exactly one valid run attribute, e.g."," ",u("code",{children:'::workflow-preview{run="wfr_\u2026"}'})]}):u(qe,{threadId:a.threadId,runId:t})}function qe({threadId:e,runId:a}){let{state:o}=me(e,a),t=B(),[r,l]=g(!1),d=K();if(o.status==="loading")return u("div",{className:"wf-muted",children:"Loading workflow\u2026"});if(o.status==="error")return u("div",{className:"wf-error",children:o.message});if(o.run===null)return u("div",{className:"wf-muted",children:"Unknown workflow run."});let s=o.run;return i("article",{className:"wf-card","aria-label":"Workflow",children:[i("div",{className:"wf-card-head",children:[i("button",{type:"button",className:"wf-card-toggle","aria-expanded":r,"aria-controls":d,onClick:()=>l(f=>!f),children:[u(P,{size:14,"aria-hidden":!0}),u("span",{className:"wf-title",style:{margin:0},children:s.name}),u("span",{className:"wf-pill",children:s.status}),u(S,{size:14,"aria-hidden":!0})]}),u("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${s.name} in side panel`,onClick:()=>t.openThreadPanel({actionId:q,title:s.name,params:{runId:s.id}}),children:u(w,{size:14,"aria-hidden":!0})})]}),r?u("div",{id:d,className:"wf-card-body",children:u(W,{run:s})}):null]})}function Oe({run:e,threadId:a,onStopped:o}){let t=B(),[r,l]=g(!1);return i("section",{className:"wf-banner-card","aria-label":"Workflow",children:[i("div",{className:"wf-banner-head",children:[i("button",{type:"button",className:"wf-banner-toggle","aria-expanded":r,onClick:()=>l(d=>!d),children:[u(P,{size:14,"aria-hidden":!0}),u("span",{children:e.name}),u("span",{className:"wf-pill",children:e.status}),u(S,{size:14,"aria-hidden":!0})]}),u("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${e.name} in side panel`,onClick:()=>t.openThreadPanel({actionId:q,title:e.name,params:{runId:e.id}}),children:u(w,{size:14,"aria-hidden":!0})})]}),r?i("div",{className:"wf-card-body",children:[u(W,{run:e}),u(Le,{threadId:a,run:e,onStopped:o})]}):null]})}function Ie(){let e=j(),a=F(null),[o,t]=g(null);$(()=>{t(De(a.current))},[]);let r=Be(e)??o??Me();return u("div",{ref:a,"data-testid":"wf-banner-root","data-wf-thread":r??"",children:r?u(Ue,{threadId:r}):null})}function Ue({threadId:e}){let{state:a,setRuns:o}=ve(e);return a.status!=="ready"||a.runs.length===0?null:u("div",{className:"wf-banner",children:a.runs.map(t=>u(Oe,{run:t,threadId:e,onStopped:r=>o(l=>l.map(d=>d.id===r.id?r:d))},t.id))})}function He(e){return e===null||typeof e!="object"||Array.isArray(e)?null:ce(e.runId)}function xe({threadId:e,params:a}){let o=He(a),{state:t,refresh:r}=me(e,o),l;if(t.status==="loading")l=u("p",{className:"wf-muted",children:"Loading workflow\u2026"});else if(t.status==="error")l=u("p",{className:"wf-error",children:t.message});else if(t.run===null)l=u("p",{className:"wf-muted",children:"No workflow run in this thread."});else{let d=t.run;l=i(v,{children:[u("h2",{className:"wf-title",children:d.name}),u("p",{className:"wf-muted",children:d.description}),u(W,{run:d}),i("dl",{className:"wf-meta",children:[u("dt",{children:"Status"}),u("dd",{children:d.status}),u("dt",{children:"Result"}),u("dd",{children:d.resultAvailable?"Available":"\u2014"}),d.error?i(v,{children:[u("dt",{children:"Error"}),u("dd",{className:"wf-error",children:d.error})]}):null]})]})}return i("div",{className:"wf-panel",children:[u("div",{className:"wf-panel-body",children:l}),t.status==="ready"&&t.run?u("div",{className:"wf-panel-footer",children:u(Le,{threadId:e,run:t.run,onStopped:()=>{r()}})}):null]})}var z=`.wf-panel,
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
`;var Ce="wf-plugin-styles";function Ne(){if(typeof document>"u")return;let e=document.getElementById(Ce);if(e instanceof HTMLStyleElement){e.textContent=z;return}let a=document.createElement("style");a.id=Ce,a.textContent=z,document.head.appendChild(a)}Ne();var Lt=_(e=>{e.composer.customize({id:"workflow-status",scopes:["thread"],banners:[{id:"active-runs",chrome:"bare",component:Ie}]}),e.slots.messageDirective({id:"workflow-preview",component:ge}),e.slots.threadPanelAction({id:q,title:"Workflow run",icon:"GitBranch",component:xe,layout:"flush"})});export{Lt as default,Ne as injectStyles};
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
