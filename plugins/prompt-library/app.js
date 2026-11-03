var n=globalThis.__ZCC_HOST_REACT__;var Q=n.Children,Y=n.Component,ee=n.Fragment,ne=n.StrictMode,te=n.Suspense,oe=n.cloneElement,re=n.createContext,ie=n.createElement,se=n.createRef,ae=n.forwardRef,le=n.isValidElement,ce=n.lazy,pe=n.memo,de=n.startTransition,ue=n.useCallback,ge=n.useContext,me=n.useDebugValue,Pe=n.useDeferredValue,T=n.useEffect,fe=n.useId,xe=n.useImperativeHandle,he=n.useInsertionEffect,be=n.useLayoutEffect,Ae=n.useMemo,Se=n.useReducer,y=n.useRef,p=n.useState,Ce=n.useSyncExternalStore,ve=n.useTransition,Te=n.version;function j(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function L(r){throw new Error(`${r} is not available until the host plugin runtime is installed`)}function O(r){return{__zccPluginApp:!0,setup:r}}function M(){return j().useRpc?.()??L("useRpc")}function D(){return j().useComposer?.()??L("useComposer")}var $=globalThis.__ZCC_HOST_REACT__,F=$.Fragment;function t(r,s,l){return $.createElement(r,l===void 0?s:{...s,key:l})}var i=t;var H="prompt-library-plugin-styles",Z=`
.pl-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel, var(--bg-surface, transparent));
  color: var(--text-secondary, var(--text-primary));
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.pl-trigger-btn:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
  border-color: var(--border-strong, var(--border));
}
.pl-trigger-btn svg {
  flex-shrink: 0;
  color: var(--text-muted);
}
.pl-trigger-btn:hover svg {
  color: var(--accent, currentColor);
}

.pl-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.pl-dialog {
  width: min(680px, 100%);
  max-height: min(640px, 82vh);
  background: var(--bg-panel, var(--bg, #18181b));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
}

.pl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}

.pl-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pl-title-group h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.pl-title-icon {
  color: var(--accent, #4c8bf5);
  display: inline-flex;
}

.pl-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 14px;
  border-bottom: 1px solid var(--border);
}

.pl-select {
  height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg, #121215);
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  outline: none;
}
.pl-select:focus {
  border-color: var(--accent, #4c8bf5);
}

.pl-search-wrap {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
}

.pl-search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-muted);
  pointer-events: none;
}

.pl-search-input {
  width: 100%;
  height: 34px;
  padding: 0 12px 0 32px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg, #121215);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.pl-search-input::placeholder {
  color: var(--text-muted);
}
.pl-search-input:focus {
  border-color: var(--accent, #4c8bf5);
}

.pl-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary, var(--text-muted));
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.pl-close-btn:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
}

.pl-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 14px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pl-alert {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, #ef4444 14%, transparent);
  border: 1px solid color-mix(in srgb, #ef4444 35%, transparent);
  color: #fca5a5;
  font-size: 12.5px;
}

.pl-status {
  margin: 0;
  padding: 6px 0;
  color: var(--text-muted);
  font-size: 12.5px;
}

.pl-empty {
  margin: 28px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.pl-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg, rgba(255, 255, 255, 0.02));
  transition: border-color 120ms ease;
}
.pl-card:hover {
  border-color: var(--border-strong, rgba(255, 255, 255, 0.22));
}

.pl-card-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  max-height: 160px;
  overflow-y: auto;
}

.pl-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.pl-btn-primary,
.pl-btn-secondary,
.pl-btn-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.pl-btn-primary {
  background: var(--accent, #4c8bf5);
  border: 1px solid transparent;
  color: #fff;
}
.pl-btn-primary:hover {
  filter: brightness(1.08);
}

.pl-btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary, var(--text-primary));
}
.pl-btn-secondary:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
}

.pl-btn-more {
  align-self: center;
  margin-top: 6px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary, var(--text-primary));
}
.pl-btn-more:hover:not(:disabled) {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary);
}
.pl-btn-more:disabled {
  opacity: 0.5;
  cursor: default;
}
`;function B(){if(typeof document>"u")return;let r=document.getElementById(H);if(r instanceof HTMLStyleElement){r.textContent=Z;return}let s=document.createElement("style");s.id=H,s.textContent=Z,document.head.appendChild(s)}function K(){T(()=>{B()},[]);let r=D(),s=M(),l=y(0),I=y(null),[b,u]=p(!1),[a,V]=p("starred"),[g,z]=p(""),[R,w]=p({scope:"starred",entries:[]}),[E,A]=p(null),[S,P]=p(""),[C,f]=p(!1),q=R.scope===a?R.entries:[],_=e=>w(o=>({...o,entries:e(o.entries)})),x=r.scope,m="threadId"in x?x.threadId:void 0,h="projectId"in x?x.projectId:void 0;T(()=>{if(!b)return;let e=++l.current,o=!1;f(!0),P(""),A(null);let c=setTimeout(()=>{s.call(a==="starred"?"list":"history",{scope:a,threadId:m,projectId:h,query:g}).then(d=>{if(o||e!==l.current)return;let N=d;w({scope:a,entries:N.entries}),A(N.nextCursor??null)}).catch(d=>{o||P(String(d))}).finally(()=>{o||f(!1)})},150);return()=>{o=!0,l.current++,clearTimeout(c)}},[b,a,g,m,h,s]);let X=async()=>{let e=l.current;f(!0);try{let o=await s.call("history",{scope:a,threadId:m,projectId:h,query:g,cursor:E});if(e!==l.current)return;_(c=>[...c,...o.entries]),A(o.nextCursor??null)}catch(o){e===l.current&&P(String(o))}finally{e===l.current&&f(!1)}},v=e=>e.input.filter(o=>o.type==="text").map(o=>o.text).join(`
`),k=q.filter(e=>a!=="starred"||v(e).toLowerCase().includes(g.toLowerCase()));return i(F,{children:[i("button",{type:"button",className:"pl-trigger-btn",onClick:()=>u(!0),children:[i("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[t("path",{d:"M10 2v8l3-3 3 3V2"}),t("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"})]}),t("span",{children:"Prompt Library"})]}),b&&t("div",{className:"pl-backdrop",onMouseDown:e=>{e.target===e.currentTarget&&u(!1)},children:i("div",{ref:I,className:"pl-dialog",role:"dialog","aria-modal":"true","aria-label":"Prompt Library",onKeyDown:e=>{if(e.key==="Escape"&&u(!1),e.key==="Tab"){let o=[...I.current?.querySelectorAll("button:not([disabled]), input, select")??[]],c=o[0],d=o.at(-1);e.shiftKey&&document.activeElement===c?(e.preventDefault(),d?.focus()):!e.shiftKey&&document.activeElement===d&&(e.preventDefault(),c?.focus())}},children:[t("div",{className:"pl-header",children:i("div",{className:"pl-title-group",children:[t("span",{className:"pl-title-icon","aria-hidden":"true",children:i("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[t("path",{d:"M10 2v8l3-3 3 3V2"}),t("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"})]})}),t("h2",{children:"Prompt Library"})]})}),i("div",{className:"pl-toolbar",children:[i("select",{className:"pl-select","aria-label":"Prompt scope",value:a,onChange:e=>V(e.target.value),children:[t("option",{value:"starred",children:"Starred"}),m&&t("option",{value:"thread",children:"Thread"}),(h||m)&&t("option",{value:"project",children:"Project"}),t("option",{value:"all",children:"All"})]}),i("div",{className:"pl-search-wrap",children:[i("svg",{className:"pl-search-icon",width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[t("circle",{cx:"11",cy:"11",r:"8"}),t("path",{d:"m21 21-4.3-4.3"})]}),t("input",{autoFocus:!0,className:"pl-search-input",type:"search","aria-label":"Search prompts",placeholder:"Search prompts\u2026",value:g,onChange:e=>z(e.target.value)})]}),t("button",{type:"button",className:"pl-close-btn",onClick:()=>u(!1),children:"Close"})]}),i("div",{className:"pl-body",children:[S&&t("p",{className:"pl-alert",role:"alert",children:S}),C&&t("p",{className:"pl-status",role:"status",children:"Loading\u2026"}),k.map(e=>i("article",{className:"pl-card",children:[t("p",{className:"pl-card-text",children:v(e).slice(0,800)||"Attachments"}),i("div",{className:"pl-card-actions",children:[t("button",{type:"button",className:"pl-btn-primary",onClick:()=>{r.experimental_replacePrompt?r.experimental_replacePrompt(e.input,e.threadId):r.setText(v(e)),r.focus(),u(!1)},children:"Use prompt"}),t("button",{type:"button",className:"pl-btn-secondary",onClick:()=>{s.call(a==="starred"?"remove":"star",e).then(()=>{a==="starred"&&_(o=>o.filter(c=>c.id!==e.id))}).catch(o=>P(String(o)))},children:a==="starred"?"Unstar":"Star"})]})]},e.id)),!C&&!S&&!k.length&&t("p",{className:"pl-empty",children:"No prompts found."}),E&&t("button",{type:"button",className:"pl-btn-more",disabled:C,onClick:()=>{X()},children:"Load more"})]})]})})]})}var ln=O(r=>{B(),r.composer.customize({id:"library",scopes:["thread","new-thread"],actions:[{id:"open",component:K}]})});export{K as PromptLibrary,ln as default,B as injectStyles};
