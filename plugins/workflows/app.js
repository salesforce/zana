function T(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function E(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}function z(e){return{__zccPluginApp:!0,setup:e}}function y(){return T().useRpc?.()??E("useRpc")}function U(e,a){T().useRealtime?.(e,a)}function D(){return T().useZccNavigate?.()??E("useZccNavigate")}function X(){return T().useComposerView?.()??E("useComposerView")}var n=globalThis.__ZCC_HOST_REACT__;var Pa=n.Children,wa=n.Component,Aa=n.Fragment,ka=n.StrictMode,Ra=n.Suspense,ba=n.cloneElement,j=n.createContext,C=n.createElement,Ta=n.createRef,M=n.forwardRef,ya=n.isValidElement,Da=n.lazy,Ma=n.memo,Ba=n.startTransition,B=n.useCallback,Z=n.useContext,Fa=n.useDebugValue,va=n.useDeferredValue,A=n.useEffect,K=n.useId,qa=n.useImperativeHandle,Oa=n.useInsertionEffect,$=n.useLayoutEffect,Be=n.useMemo,Ea=n.useReducer,F=n.useRef,g=n.useState,Ua=n.useSyncExternalStore,Ha=n.useTransition,Na=n.version;var J=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Q(e,a,o=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:J(e),size:24,node:a,...o.length>0?{aliases:o}:{}}}var Y=e=>{let a="",o=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){o=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=o?t.toUpperCase():t,o=!1}return a};var ee=e=>{let a=Y(e);return a.charAt(0).toUpperCase()+a.slice(1)};var k=(...e)=>e.filter((a,o,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===o).join(" ").trim();var p={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function H(e){return e!=null}function ae(e,a={}){let o=a.attributeNames??{},t=c=>o[c]??c,u=e.size??e.width??p.width,d=e.size??e.height??p.height,l=e.aliases?.filter(c=>typeof c=="string"&&c.trim()!=="").map(c=>`lucide-${c}`)??[],s=[...e.name?[`lucide-${e.name}`]:[],...l],f=a.className?.split(" ").filter(Boolean)??[],m=a.includeDefaultClasses===!1?k(...f):k("lucide",...s,...f),x=a.absoluteStrokeWidth?Number(a.strokeWidth??p["stroke-width"])*Number(e.size??e.width??p.width)/Number(a.size??a.width??p.width):a.strokeWidth??p["stroke-width"];return["svg",{...Object.entries(p).reduce((c,[L,I])=>(c[t(L)]=I,c),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&H(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&H(a.width)&&{[t("width")]:a.width},..."height"in a&&H(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:x,...m&&{[t("class")]:m},[t("viewBox")]:`0 0 ${u} ${d}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(c=>{let[L,I,R]=c,b=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...I}:I;return R?[L,b,R]:[L,b]})]}function te(e,a={}){return ae(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var oe=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Fe=j({});var re=()=>Z(Fe);var ue=M(({color:e,size:a,width:o,height:t,strokeWidth:u,absoluteStrokeWidth:d,nonScalingStroke:l,className:s="",children:f,iconNode:m=[],icon:x={node:m,aliases:[],size:24},...O},c)=>{let{size:L=24,strokeWidth:I=2,absoluteStrokeWidth:R=!1,nonScalingStroke:b=!1,color:he="currentColor",className:Se=""}=re()??{},Pe=!!f||oe(O),[we,Ae,ke=[]]=te(x,{color:e??he,width:o??a??L,height:t??a??L,strokeWidth:u??I,absoluteStrokeWidth:d??R,nonScalingStroke:l??b,className:k(Se,s),hasA11yProp:Pe,attributes:O});return C(we,{ref:c,...Ae},[...ke.map(([Re,be])=>C(Re,be)),...Array.isArray(f)?f:[f]])});function h(e,a=[],o=[]){let t=typeof e=="string"?Q(e,a,o):e,u=M(({className:d,...l},s)=>C(ue,{ref:s,icon:t,className:d,...l}));return t.name&&(u.displayName=ee(t.name)),u}var le={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};le.node;var S=h(le);var de={name:"git-branch",size:24,node:[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]]};de.node;var P=h(de);var se={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};se.node;var w=h(se);var N="workflow-runs";function V(e){if(typeof e!="object"||e===null)return null;let a=e.threadId;return typeof a=="string"?a:null}var ne=globalThis.__ZCC_HOST_REACT__,v=ne.Fragment;function r(e,a,o){return ne.createElement(e,o===void 0?a:{...a,key:o})}var i=r;var q="workflow-run",ie=1e3;function ce(e){if(typeof e!="string")return null;let a=e.trim();return/^wfr_[0-9a-f-]+$/i.test(a)?a:null}function pe(e){return e.status==="queued"||e.status==="running"}function ve(e){return e.scope.kind==="thread"||e.scope.kind==="queued-message"?e.scope.threadId:e.scope.kind==="side-chat"?e.scope.childThreadId??e.scope.parentThreadId:null}function qe(e){return e?.closest("[data-composer-thread]")?.getAttribute("data-composer-thread")?.trim()||null}function Oe(){if(typeof window>"u")return null;let a=window.location.pathname.match(/\/threads\/([^/]+)/)?.[1]?.trim()??"";return!a||a==="new"?null:a}function G(e,a,o){return e.call(a,o).catch(t=>{let u=globalThis.__ZCC_PLUGIN_HOST__;if(!u)throw t;return u.callRpc("workflows",a,o)})}function Ee(e){switch(e){case"queued":return"queued";case"running":return"running";case"succeeded":return"done";case"failed":return"failed";case"cancelled":return"cancelled"}}function me(e,a){let o=y(),[t,u]=g({status:"loading"}),d=F(0),l=B(async()=>{let s=++d.current;try{let f=await G(o,"workflowRunView",{threadId:e,runId:a});s===d.current&&u({status:"ready",run:f.run,refreshError:null})}catch(f){if(s!==d.current)return;let m=f instanceof Error?f.message:String(f);u(x=>x.status==="ready"?{...x,refreshError:m}:{status:"error",message:m})}},[o,a,e]);return A(()=>(u({status:"loading"}),l(),()=>{d.current+=1}),[l]),U(N,s=>{V(s)===e&&l()}),A(()=>{if(t.status!=="ready"||t.run===null||!pe(t.run))return;let s=window.setInterval(()=>{l()},ie);return()=>window.clearInterval(s)},[l,t]),{state:t,refresh:l}}function Ue(e){let a=y(),[o,t]=g({status:"loading"}),u=F(0),d=B(async()=>{let s=++u.current;try{let f=await G(a,"workflowActiveRuns",{threadId:e});s===u.current&&t({status:"ready",runs:f.runs})}catch{s===u.current&&t({status:"error"})}},[a,e]);A(()=>(t({status:"loading"}),d(),()=>{u.current+=1}),[d]),U(N,s=>{V(s)===e&&d()}),A(()=>{let s=window.setInterval(()=>{d()},ie);return()=>window.clearInterval(s)},[d]);let l=B(s=>{t(f=>f.status==="ready"?{status:"ready",runs:s(f.runs)}:f)},[]);return{state:o,setRuns:l}}function fe({calls:e,onOpen:a}){return e.length===0?null:r("div",{children:e.map(o=>i("div",{className:`wf-call${o.childThreadId?" is-actionable":""}`,children:[r("span",{className:"wf-pill",children:Ee(o.status)}),o.childThreadId?r("button",{type:"button",onClick:()=>a(o.childThreadId),children:o.label}):r("span",{children:o.label}),o.cached?r("span",{className:"wf-pill",children:"cached"}):null]},o.id))})}function _({run:e}){let a=D(),o=t=>a.toThread(t);return i(v,{children:[e.phases.map(t=>i("section",{className:"wf-phase",children:[r("h4",{children:t.title}),t.detail?r("p",{className:"wf-muted",children:t.detail}):null,r(fe,{calls:t.calls,onOpen:o})]},t.title)),e.unphasedCalls.length>0?i("section",{className:"wf-phase",children:[r("h4",{children:"Other work"}),r(fe,{calls:e.unphasedCalls,onOpen:o})]}):null]})}function Le({threadId:e,run:a,onStopped:o}){let t=y(),[u,d]=g(!1);return pe(a)?r("button",{type:"button",className:"wf-btn",disabled:u,onClick:()=>{d(!0),G(t,"workflowStopRun",{threadId:e,runId:a.id}).then(l=>{let s=l.run;o(s)}).finally(()=>d(!1))},children:u?"Stopping\u2026":"Stop workflow"}):null}function ge({attributes:e,message:a}){let t=Object.keys(e).some(u=>u!=="run")?null:ce(e.run);return t===null?i("div",{className:"wf-invalid",children:["workflow-preview requires exactly one valid run attribute, e.g."," ",r("code",{children:'::workflow-preview{run="wfr_\u2026"}'})]}):r(He,{threadId:a.threadId,runId:t})}function He({threadId:e,runId:a}){let{state:o}=me(e,a),t=D(),[u,d]=g(!1),l=K();if(o.status==="loading")return r("div",{className:"wf-muted",children:"Loading workflow\u2026"});if(o.status==="error")return r("div",{className:"wf-error",children:o.message});if(o.run===null)return r("div",{className:"wf-muted",children:"Unknown workflow run."});let s=o.run;return i("article",{className:"wf-card","aria-label":"Workflow",children:[i("div",{className:"wf-card-head",children:[i("button",{type:"button",className:"wf-card-toggle","aria-expanded":u,"aria-controls":l,onClick:()=>d(f=>!f),children:[r(P,{size:14,"aria-hidden":!0}),r("span",{className:"wf-title",style:{margin:0},children:s.name}),r("span",{className:"wf-pill",children:s.status}),r(S,{size:14,"aria-hidden":!0})]}),r("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${s.name} in side panel`,onClick:()=>t.openThreadPanel({actionId:q,title:s.name,params:{runId:s.id}}),children:r(w,{size:14,"aria-hidden":!0})})]}),u?r("div",{id:l,className:"wf-card-body",children:r(_,{run:s})}):null]})}function Ne({run:e,threadId:a,onStopped:o}){let t=D(),[u,d]=g(!1);return i("section",{className:"wf-banner-card","aria-label":"Workflow",children:[i("div",{className:"wf-banner-head",children:[i("button",{type:"button",className:"wf-banner-toggle","aria-expanded":u,onClick:()=>d(l=>!l),children:[r(P,{size:14,"aria-hidden":!0}),r("span",{children:e.name}),r("span",{className:"wf-pill",children:e.status}),r(S,{size:14,"aria-hidden":!0})]}),r("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${e.name} in side panel`,onClick:()=>t.openThreadPanel({actionId:q,title:e.name,params:{runId:e.id}}),children:r(w,{size:14,"aria-hidden":!0})})]}),u?i("div",{className:"wf-card-body",children:[r(_,{run:e}),r(Le,{threadId:a,run:e,onStopped:o})]}):null]})}function xe(){let e=X(),a=F(null),[o,t]=g(null);$(()=>{t(qe(a.current))},[]);let u=ve(e)??o??Oe();return r("div",{ref:a,"data-testid":"wf-banner-root","data-wf-thread":u??"",children:u?r(Ve,{threadId:u}):null})}function Ve({threadId:e}){let{state:a,setRuns:o}=Ue(e);return a.status!=="ready"||a.runs.length===0?null:r("div",{className:"wf-banner",children:a.runs.map(t=>r(Ne,{run:t,threadId:e,onStopped:u=>o(d=>d.map(l=>l.id===u.id?u:l))},t.id))})}function Ge(e){return e===null||typeof e!="object"||Array.isArray(e)?null:ce(e.runId)}function Ie({threadId:e,params:a}){let o=Ge(a),{state:t,refresh:u}=me(e,o),d;if(t.status==="loading")d=r("p",{className:"wf-muted",children:"Loading workflow\u2026"});else if(t.status==="error")d=r("p",{className:"wf-error",children:t.message});else if(t.run===null)d=r("p",{className:"wf-muted",children:"No workflow run in this thread."});else{let l=t.run;d=i(v,{children:[r("h2",{className:"wf-title",children:l.name}),r("p",{className:"wf-muted",children:l.description}),r(_,{run:l}),i("dl",{className:"wf-meta",children:[r("dt",{children:"Status"}),r("dd",{children:l.status}),r("dt",{children:"Result"}),r("dd",{children:l.resultAvailable?"Available":"\u2014"}),l.error?i(v,{children:[r("dt",{children:"Error"}),r("dd",{className:"wf-error",children:l.error})]}):null]})]})}return i("div",{className:"wf-panel",children:[r("div",{className:"wf-panel-body",children:d}),t.status==="ready"&&t.run?r("div",{className:"wf-panel-footer",children:r(Le,{threadId:e,run:t.run,onStopped:()=>{u()}})}):null]})}var W=`.wf-panel,
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
`;var Ce="wf-plugin-styles";function We(){if(typeof document>"u")return;let e=document.getElementById(Ce);if(e instanceof HTMLStyleElement){e.textContent=W;return}let a=document.createElement("style");a.id=Ce,a.textContent=W,document.head.appendChild(a)}We();var Et=z(e=>{e.composer.customize({id:"workflow-status",scopes:["thread"],banners:[{id:"active-runs",chrome:"bare",component:xe}]}),e.slots.messageDirective({id:"workflow-preview",component:ge}),e.slots.threadPanelAction({id:q,title:"Workflow run",icon:"GitBranch",component:Ie,layout:"flush"})});export{Et as default,We as injectStyles};
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
