var n=globalThis.__ZCC_HOST_REACT__;var re=n.Children,ie=n.Component,se=n.Fragment,ae=n.StrictMode,le=n.Suspense,ce=n.cloneElement,pe=n.createContext,de=n.createElement,ue=n.createRef,ge=n.forwardRef,me=n.isValidElement,Pe=n.lazy,fe=n.memo,xe=n.startTransition,he=n.useCallback,be=n.useContext,Se=n.useDebugValue,ve=n.useDeferredValue,O=n.useEffect,Ae=n.useId,Ce=n.useImperativeHandle,Te=n.useInsertionEffect,ye=n.useLayoutEffect,Ie=n.useMemo,Re=n.useReducer,_=n.useRef,d=n.useState,we=n.useSyncExternalStore,Ee=n.useTransition,_e=n.version;function M(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function D(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}function $(e){return{__zccPluginApp:!0,setup:e}}function F(){return M().useRpc?.()??D("useRpc")}function H(){return M().useComposer?.()??D("useComposer")}var Z=globalThis.__ZCC_HOST_REACT__,B=Z.Fragment;function t(e,r,a){return Z.createElement(e,a===void 0?r:{...r,key:a})}var l=t;var V="prompt-library-plugin-styles",j=`
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
  background: var(--bg-panel, var(--bg-elevated, var(--bg, #181818)));
  border: 1px solid var(--border);
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
  color: var(--accent, currentColor);
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
  background: var(--bg-input, var(--bg-panel, var(--bg, transparent)));
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  outline: none;
}
.pl-select:focus {
  border-color: var(--accent);
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
  background: var(--bg-input, var(--bg-panel, var(--bg, transparent)));
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.pl-search-input::placeholder {
  color: var(--text-muted);
}
.pl-search-input:focus {
  border-color: var(--accent);
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
  background: color-mix(in srgb, var(--danger, #ef4444) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger, #ef4444) 35%, transparent);
  color: var(--danger-text, var(--danger, #ef4444));
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
  background: var(--bg-surface, var(--bg-panel, var(--bg, transparent)));
  transition: border-color 120ms ease;
}
.pl-card:hover {
  border-color: var(--border-strong, var(--border));
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
  background: var(--accent);
  border: 1px solid var(--accent, transparent);
  color: var(--accent-contrast, #fff);
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
`;function z({size:e=16}){return l("svg",{width:e,height:e,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[t("path",{d:"M10 2v8l3-3 3 3V2"}),t("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"})]})}function Y(){if(typeof document>"u")return;let e=document.getElementById(V);if(e instanceof HTMLStyleElement){e.textContent!==j&&(e.textContent=j);return}let r=document.createElement("style");r.id=V,r.textContent=j,document.head.appendChild(r)}var k=e=>e.input.filter(r=>r.type==="text").map(r=>r.text).join(`
`);function ee({onClick:e}){return l("button",{type:"button",className:"pl-trigger-btn",onClick:e,children:[t(z,{size:14}),t("span",{children:"Prompt Library"})]})}function ne({row:e,scope:r,onUse:a,onToggleStar:g}){return l("article",{className:"pl-card",children:[t("p",{className:"pl-card-text",children:k(e).slice(0,800)||"Attachments"}),l("div",{className:"pl-card-actions",children:[t("button",{type:"button",className:"pl-btn-primary",onClick:()=>a(e),children:"Use prompt"}),t("button",{type:"button",className:"pl-btn-secondary",onClick:()=>g(e),children:r==="starred"?"Unstar":"Star"})]})]})}function te({dialogRef:e,scope:r,setScope:a,threadId:g,projectId:P,query:f,setQuery:c,error:x,loading:p,filteredEntries:S,cursor:v,onClose:m,onUse:A,onToggleStar:h,onMore:w}){return t("div",{className:"pl-backdrop",onMouseDown:o=>{o.target===o.currentTarget&&m()},children:l("div",{ref:e,className:"pl-dialog",role:"dialog","aria-modal":"true","aria-label":"Prompt Library",onKeyDown:o=>{if(o.key==="Escape"&&m(),o.key==="Tab"){let C=[...e.current?.querySelectorAll("button:not([disabled]), input, select")??[]],u=C[0],T=C.at(-1);o.shiftKey&&document.activeElement===u?(o.preventDefault(),T?.focus()):!o.shiftKey&&document.activeElement===T&&(o.preventDefault(),u?.focus())}},children:[t("div",{className:"pl-header",children:l("div",{className:"pl-title-group",children:[t("span",{className:"pl-title-icon","aria-hidden":"true",children:t(z,{size:16})}),t("h2",{children:"Prompt Library"})]})}),l("div",{className:"pl-toolbar",children:[l("select",{className:"pl-select","aria-label":"Prompt scope",value:r,onChange:o=>a(o.target.value),children:[t("option",{value:"starred",children:"Starred"}),g&&t("option",{value:"thread",children:"Thread"}),(P||g)&&t("option",{value:"project",children:"Project"}),t("option",{value:"all",children:"All"})]}),l("div",{className:"pl-search-wrap",children:[l("svg",{className:"pl-search-icon",width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[t("circle",{cx:"11",cy:"11",r:"8"}),t("path",{d:"m21 21-4.3-4.3"})]}),t("input",{autoFocus:!0,className:"pl-search-input",type:"search","aria-label":"Search prompts",placeholder:"Search prompts\u2026",value:f,onChange:o=>c(o.target.value)})]}),t("button",{type:"button",className:"pl-close-btn",onClick:m,children:"Close"})]}),l("div",{className:"pl-body",children:[x&&t("p",{className:"pl-alert",role:"alert",children:x}),p&&t("p",{className:"pl-status",role:"status",children:"Loading\u2026"}),S.map(o=>t(ne,{row:o,scope:r,onUse:A,onToggleStar:h},o.id)),!p&&!x&&!S.length&&t("p",{className:"pl-empty",children:"No prompts found."}),v&&t("button",{type:"button",className:"pl-btn-more",disabled:p,onClick:w,children:"Load more"})]})]})})}function oe(){let e=H(),r=F(),a=_(0),g=_(null),[P,f]=d(!1),[c,x]=d("starred"),[p,S]=d(""),[v,m]=d({scope:"starred",entries:[]}),[A,h]=d(null),[w,o]=d(""),[C,u]=d(!1),T=v.scope===c?v.entries:[],N=i=>m(s=>({...s,entries:i(s.entries)})),y=e.scope,I="threadId"in y?y.threadId:void 0,R="projectId"in y?y.projectId:void 0;O(()=>{if(!P)return;let i=++a.current,s=!1;u(!0),o(""),h(null);let b=setTimeout(()=>{r.call(c==="starred"?"list":"history",{scope:c,threadId:I,projectId:R,query:p}).then(E=>{if(s||i!==a.current)return;let L=E;m({scope:c,entries:L.entries}),h(L.nextCursor??null)}).catch(E=>{s||o(String(E))}).finally(()=>{s||u(!1)})},150);return()=>{s=!0,a.current++,clearTimeout(b)}},[P,c,p,I,R,r]);let q=async()=>{let i=a.current;u(!0);try{let s=await r.call("history",{scope:c,threadId:I,projectId:R,query:p,cursor:A});if(i!==a.current)return;N(b=>[...b,...s.entries]),h(s.nextCursor??null)}catch(s){i===a.current&&o(String(s))}finally{i===a.current&&u(!1)}},U=i=>{e.experimental_replacePrompt?e.experimental_replacePrompt(i.input,i.threadId):e.setText(k(i)),e.focus(),f(!1)},X=i=>{r.call(c==="starred"?"remove":"star",i).then(()=>{c==="starred"&&N(s=>s.filter(b=>b.id!==i.id))}).catch(s=>o(String(s)))},J=T.filter(i=>c!=="starred"||k(i).toLowerCase().includes(p.toLowerCase()));return l(B,{children:[t(ee,{onClick:()=>f(!0)}),P&&t(te,{dialogRef:g,scope:c,setScope:x,threadId:I,projectId:R,query:p,setQuery:S,error:w,loading:C,filteredEntries:J,cursor:A,onClose:()=>f(!1),onUse:U,onToggleStar:X,onMore:()=>{q()}})]})}var mn=$(e=>{Y(),e.composer.customize({id:"library",scopes:["thread","new-thread"],actions:[{id:"open",component:oe}]})});export{z as BookMarkedIcon,j as PROMPT_LIBRARY_STYLES,oe as PromptLibrary,V as STYLE_TAG_ID,mn as default,Y as injectStyles};
