function S(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function y(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}function E(e){return{__zccPluginApp:!0,setup:e}}function P(){return S().useRpc?.()??y("useRpc")}function D(e,a){S().useRealtime?.(e,a)}function w(){return S().useZccNavigate?.()??y("useZccNavigate")}function N(){return S().useComposerView?.()??y("useComposerView")}var r=globalThis.__ZCC_HOST_REACT__;var Ve=r.Children,We=r.Component,_e=r.Fragment,ze=r.StrictMode,Xe=r.Suspense,je=r.cloneElement,G=r.createContext,m=r.createElement,Ze=r.createRef,A=r.forwardRef,Ke=r.isValidElement,Je=r.lazy,$e=r.memo,Qe=r.startTransition,k=r.useCallback,V=r.useContext,Ye=r.useDebugValue,ea=r.useDeferredValue,h=r.useEffect,W=r.useId,aa=r.useImperativeHandle,ta=r.useInsertionEffect,_=r.useLayoutEffect,pe=r.useMemo,oa=r.useReducer,R=r.useRef,c=r.useState,ua=r.useSyncExternalStore,da=r.useTransition,la=r.version;var T=(...e)=>e.filter((a,u,o)=>!!a&&a.trim()!==""&&o.indexOf(a)===u).join(" ").trim();var z=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();var X=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(a,u,o)=>o?o.toUpperCase():u.toLowerCase());var F=e=>{let a=X(e);return a.charAt(0).toUpperCase()+a.slice(1)};var B={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};var j=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var me=G({});var Z=()=>V(me);var K=A(({color:e,size:a,strokeWidth:u,absoluteStrokeWidth:o,className:d="",children:l,iconNode:s,...f},i)=>{let{size:p=24,strokeWidth:C=2,absoluteStrokeWidth:re=!1,color:se="currentColor",className:fe=""}=Z()??{},ne=o??re?Number(u??C)*24/Number(a??p):u??C;return m("svg",{ref:i,...B,width:a??p??B.width,height:a??p??B.height,stroke:e??se,strokeWidth:ne,className:T("lucide",fe,d),...!l&&!j(f)&&{"aria-hidden":"true"},...f},[...s.map(([ie,ce])=>m(ie,ce)),...Array.isArray(l)?l:[l]])});var L=(e,a)=>{let u=A(({className:o,...d},l)=>m(K,{ref:l,iconNode:a,className:T(`lucide-${z(F(e))}`,`lucide-${e}`,o),...d}));return u.displayName=F(e),u};var Le=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],I=L("chevron-down",Le);var Ie=[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]],x=L("git-branch",Ie);var xe=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]],g=L("panel-right",xe);var v="workflow-runs";function q(e){if(typeof e!="object"||e===null)return null;let a=e.threadId;return typeof a=="string"?a:null}var J=globalThis.__ZCC_HOST_REACT__,b=J.Fragment;function t(e,a,u){return J.createElement(e,u===void 0?a:{...a,key:u})}var n=t;var M="workflow-run",Q=1e3;function Y(e){if(typeof e!="string")return null;let a=e.trim();return/^wfr_[0-9a-f-]+$/i.test(a)?a:null}function ee(e){return e.status==="queued"||e.status==="running"}function ge(e){return e.scope.kind==="thread"||e.scope.kind==="queued-message"?e.scope.threadId:e.scope.kind==="side-chat"?e.scope.childThreadId??e.scope.parentThreadId:null}function Ce(e){return e?.closest("[data-composer-thread]")?.getAttribute("data-composer-thread")?.trim()||null}function he(){if(typeof window>"u")return null;let a=window.location.pathname.match(/\/threads\/([^/]+)/)?.[1]?.trim()??"";return!a||a==="new"?null:a}function O(e,a,u){return e.call(a,u).catch(o=>{let d=globalThis.__ZCC_PLUGIN_HOST__;if(!d)throw o;return d.callRpc("workflows",a,u)})}function Se(e){switch(e){case"queued":return"queued";case"running":return"running";case"succeeded":return"done";case"failed":return"failed";case"cancelled":return"cancelled"}}function ae(e,a){let u=P(),[o,d]=c({status:"loading"}),l=R(0),s=k(async()=>{let f=++l.current;try{let i=await O(u,"workflowRunView",{threadId:e,runId:a});f===l.current&&d({status:"ready",run:i.run,refreshError:null})}catch(i){if(f!==l.current)return;let p=i instanceof Error?i.message:String(i);d(C=>C.status==="ready"?{...C,refreshError:p}:{status:"error",message:p})}},[u,a,e]);return h(()=>(d({status:"loading"}),s(),()=>{l.current+=1}),[s]),D(v,f=>{q(f)===e&&s()}),h(()=>{if(o.status!=="ready"||o.run===null||!ee(o.run))return;let f=window.setInterval(()=>{s()},Q);return()=>window.clearInterval(f)},[s,o]),{state:o,refresh:s}}function Pe(e){let a=P(),[u,o]=c({status:"loading"}),d=R(0),l=k(async()=>{let f=++d.current;try{let i=await O(a,"workflowActiveRuns",{threadId:e});f===d.current&&o({status:"ready",runs:i.runs})}catch{f===d.current&&o({status:"error"})}},[a,e]);h(()=>(o({status:"loading"}),l(),()=>{d.current+=1}),[l]),D(v,f=>{q(f)===e&&l()}),h(()=>{let f=window.setInterval(()=>{l()},Q);return()=>window.clearInterval(f)},[l]);let s=k(f=>{o(i=>i.status==="ready"?{status:"ready",runs:f(i.runs)}:i)},[]);return{state:u,setRuns:s}}function $({calls:e,onOpen:a}){return e.length===0?null:t("div",{children:e.map(u=>n("div",{className:`wf-call${u.childThreadId?" is-actionable":""}`,children:[t("span",{className:"wf-pill",children:Se(u.status)}),u.childThreadId?t("button",{type:"button",onClick:()=>a(u.childThreadId),children:u.label}):t("span",{children:u.label}),u.cached?t("span",{className:"wf-pill",children:"cached"}):null]},u.id))})}function U({run:e}){let a=w(),u=o=>a.toThread(o);return n(b,{children:[e.phases.map(o=>n("section",{className:"wf-phase",children:[t("h4",{children:o.title}),o.detail?t("p",{className:"wf-muted",children:o.detail}):null,t($,{calls:o.calls,onOpen:u})]},o.title)),e.unphasedCalls.length>0?n("section",{className:"wf-phase",children:[t("h4",{children:"Other work"}),t($,{calls:e.unphasedCalls,onOpen:u})]}):null]})}function te({threadId:e,run:a,onStopped:u}){let o=P(),[d,l]=c(!1);return ee(a)?t("button",{type:"button",className:"wf-btn",disabled:d,onClick:()=>{l(!0),O(o,"workflowStopRun",{threadId:e,runId:a.id}).then(s=>{let f=s.run;u(f)}).finally(()=>l(!1))},children:d?"Stopping\u2026":"Stop workflow"}):null}function oe({attributes:e,message:a}){let o=Object.keys(e).some(d=>d!=="run")?null:Y(e.run);return o===null?n("div",{className:"wf-invalid",children:["workflow-preview requires exactly one valid run attribute, e.g."," ",t("code",{children:'::workflow-preview{run="wfr_\u2026"}'})]}):t(we,{threadId:a.threadId,runId:o})}function we({threadId:e,runId:a}){let{state:u}=ae(e,a),o=w(),[d,l]=c(!1),s=W();if(u.status==="loading")return t("div",{className:"wf-muted",children:"Loading workflow\u2026"});if(u.status==="error")return t("div",{className:"wf-error",children:u.message});if(u.run===null)return t("div",{className:"wf-muted",children:"Unknown workflow run."});let f=u.run;return n("article",{className:"wf-card","aria-label":"Workflow",children:[n("div",{className:"wf-card-head",children:[n("button",{type:"button",className:"wf-card-toggle","aria-expanded":d,"aria-controls":s,onClick:()=>l(i=>!i),children:[t(x,{size:14,"aria-hidden":!0}),t("span",{className:"wf-title",style:{margin:0},children:f.name}),t("span",{className:"wf-pill",children:f.status}),t(I,{size:14,"aria-hidden":!0})]}),t("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${f.name} in side panel`,onClick:()=>o.openThreadPanel({actionId:M,title:f.name,params:{runId:f.id}}),children:t(g,{size:14,"aria-hidden":!0})})]}),d?t("div",{id:s,className:"wf-card-body",children:t(U,{run:f})}):null]})}function Ae({run:e,threadId:a,onStopped:u}){let o=w(),[d,l]=c(!1);return n("section",{className:"wf-banner-card","aria-label":"Workflow",children:[n("div",{className:"wf-banner-head",children:[n("button",{type:"button",className:"wf-banner-toggle","aria-expanded":d,onClick:()=>l(s=>!s),children:[t(x,{size:14,"aria-hidden":!0}),t("span",{children:e.name}),t("span",{className:"wf-pill",children:e.status}),t(I,{size:14,"aria-hidden":!0})]}),t("button",{type:"button",className:"wf-card-open","aria-label":`Open workflow ${e.name} in side panel`,onClick:()=>o.openThreadPanel({actionId:M,title:e.name,params:{runId:e.id}}),children:t(g,{size:14,"aria-hidden":!0})})]}),d?n("div",{className:"wf-card-body",children:[t(U,{run:e}),t(te,{threadId:a,run:e,onStopped:u})]}):null]})}function ue(){let e=N(),a=R(null),[u,o]=c(null);_(()=>{o(Ce(a.current))},[]);let d=ge(e)??u??he();return t("div",{ref:a,"data-testid":"wf-banner-root","data-wf-thread":d??"",children:d?t(ke,{threadId:d}):null})}function ke({threadId:e}){let{state:a,setRuns:u}=Pe(e);return a.status!=="ready"||a.runs.length===0?null:t("div",{className:"wf-banner",children:a.runs.map(o=>t(Ae,{run:o,threadId:e,onStopped:d=>u(l=>l.map(s=>s.id===d.id?d:s))},o.id))})}function Re(e){return e===null||typeof e!="object"||Array.isArray(e)?null:Y(e.runId)}function de({threadId:e,params:a}){let u=Re(a),{state:o,refresh:d}=ae(e,u),l;if(o.status==="loading")l=t("p",{className:"wf-muted",children:"Loading workflow\u2026"});else if(o.status==="error")l=t("p",{className:"wf-error",children:o.message});else if(o.run===null)l=t("p",{className:"wf-muted",children:"No workflow run in this thread."});else{let s=o.run;l=n(b,{children:[t("h2",{className:"wf-title",children:s.name}),t("p",{className:"wf-muted",children:s.description}),t(U,{run:s}),n("dl",{className:"wf-meta",children:[t("dt",{children:"Status"}),t("dd",{children:s.status}),t("dt",{children:"Result"}),t("dd",{children:s.resultAvailable?"Available":"\u2014"}),s.error?n(b,{children:[t("dt",{children:"Error"}),t("dd",{className:"wf-error",children:s.error})]}):null]})]})}return n("div",{className:"wf-panel",children:[t("div",{className:"wf-panel-body",children:l}),o.status==="ready"&&o.run?t("div",{className:"wf-panel-footer",children:t(te,{threadId:e,run:o.run,onStopped:()=>{d()}})}):null]})}var H=`.wf-panel,
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
`;var le="wf-plugin-styles";function Be(){if(typeof document>"u")return;let e=document.getElementById(le);if(e instanceof HTMLStyleElement){e.textContent=H;return}let a=document.createElement("style");a.id=le,a.textContent=H,document.head.appendChild(a)}Be();var $a=E(e=>{e.composer.customize({id:"workflow-status",scopes:["thread"],banners:[{id:"active-runs",chrome:"bare",component:ue}]}),e.slots.messageDirective({id:"workflow-preview",component:oe}),e.slots.threadPanelAction({id:M,title:"Workflow run",icon:"GitBranch",component:de,layout:"flush"})});export{$a as default,Be as injectStyles};
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
lucide-react/dist/esm/icons/chevron-down.mjs:
lucide-react/dist/esm/icons/git-branch.mjs:
lucide-react/dist/esm/icons/panel-right.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.35.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
