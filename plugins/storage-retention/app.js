var p=globalThis.__ZCC_HOST_REACT__;var Ne=p.Children,ke=p.Component,_e=p.Fragment,je=p.StrictMode,Ee=p.Suspense,Le=p.cloneElement,$e=p.createContext,Oe=p.createElement,Me=p.createRef,De=p.forwardRef,Fe=p.isValidElement,Be=p.lazy,He=p.memo,Ve=p.startTransition,I=p.useCallback,ze=p.useContext,Ze=p.useDebugValue,Ue=p.useDeferredValue,G=p.useEffect,Ge=p.useId,Je=p.useImperativeHandle,qe=p.useInsertionEffect,Ke=p.useLayoutEffect,J=p.useMemo,We=p.useReducer,k=p.useRef,S=p.useState,Ye=p.useSyncExternalStore,Qe=p.useTransition,Xe=p.version;function M(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function q(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}function K(e){return{__zccPluginApp:!0,setup:e}}function W(){return M().useRpc?.()??q("useRpc")}function D(e,i){M().useRealtime?.(e,i)}function F(){return M().useZccNavigate?.()??q("useZccNavigate")}var Y=["B","KB","MB","GB","TB"];function h(e){if(e<1024)return`${e} B`;let i=Math.min(Math.floor(Math.log(e)/Math.log(1024)),Y.length-1);return`${Number((e/1024**i).toFixed(1))} ${Y[i]}`}function _(e,i=Date.now()){let t=Math.round((i-e)/6e4);if(t<1)return"just now";if(t<60)return`${t}m ago`;let o=Math.round(t/60);return o<24?`${o}h ago`:`${Math.round(o/24)}d ago`}function Q(e){return e%365===0?e===365?"1 year":`${e/365} years`:e%7===0&&e<=28?e===7?"1 week":`${e/7} weeks`:e===1?"1 day":`${e} days`}function v(e,i,t=`${i}s`){return`${e.toLocaleString("en-US")} ${e===1?i:t}`}function T(e){return e instanceof Error?e.message:String(e)}function X(e,i){let t=(o,s)=>s===null||o!==null&&s>=o;return t(e.archiveAfterDays,i.archiveAfterDays)&&t(e.clearAfterDays,i.clearAfterDays)&&(!i.clearStorageOnArchive||e.clearStorageOnArchive)}var B=`/*
 * Storage & retention \u2014 plugin-scoped styles. Everything is prefixed \`.sr-\` so
 * it cannot collide with core or another plugin. The panel is a centered
 * reading/configuration surface; colors come from the app's CSS custom
 * properties so light and dark themes both work.
 */

.sr-panel {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 13px;
}

.sr-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 20px 40px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.sr-page > * {
  min-width: 0;
}

.sr-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sr-muted {
  color: var(--text-muted);
}

.sr-small {
  font-size: 12px;
  line-height: 1.4;
}

.sr-num {
  font-variant-numeric: tabular-nums;
}

/* \u2500\u2500 Headings \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.sr-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.sr-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.sr-heading h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sr-heading p {
  margin: 2px 0 0;
}

.sr-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sr-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.sr-header-row p {
  margin: 2px 0 0;
}

/* \u2500\u2500 Cards and rows \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.sr-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.sr-card-pad {
  padding: 12px 14px;
}

.sr-list > * + * {
  border-top: 1px solid var(--border);
}

.sr-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
}

.sr-row-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sr-row-name {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  word-break: break-word;
}

.sr-row-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.sr-row-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
}

.sr-row-block > .sr-row-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.sr-row-block p,
.sr-row p {
  margin: 0;
}

.sr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 16px;
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: 8px;
}

.sr-empty h2,
.sr-empty p {
  margin: 0;
}

.sr-info {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-base);
}

.sr-info h2,
.sr-info p {
  margin: 0;
}

.sr-info h2 {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 2px;
}

/* \u2500\u2500 Controls \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.sr-button {
  font: inherit;
  font-size: 12px;
  padding: 5px 11px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
}

.sr-button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.sr-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sr-button:focus-visible,
.sr-link:focus-visible,
.sr-select:focus-visible,
.sr-switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.sr-button-danger {
  border-color: var(--danger);
  color: var(--danger);
}

.sr-button-danger:hover:not(:disabled) {
  background: var(--danger);
  color: var(--bg-panel);
}

.sr-link {
  font: inherit;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.sr-link:hover {
  text-decoration: underline;
}

.sr-link-muted {
  color: var(--text-muted);
  font-size: 12px;
}

.sr-select {
  font: inherit;
  font-size: 12px;
  min-width: 150px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--bg-input);
  color: var(--text-primary);
}

.sr-select:disabled {
  opacity: 0.5;
}

.sr-switch {
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  accent-color: var(--accent);
  flex-shrink: 0;
}

.sr-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* \u2500\u2500 Status \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.sr-pill {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
  white-space: nowrap;
  vertical-align: middle;
}

.sr-size {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-hover);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  white-space: nowrap;
}

.sr-notice {
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  font-size: 12px;
}

.sr-notice-error,
.sr-error {
  color: var(--danger);
  border-color: var(--danger);
}

.sr-error {
  margin: 0;
  font-size: 12px;
}

.sr-notice-success {
  color: var(--success);
  border-color: var(--success);
}

.sr-confirm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--danger);
  background: var(--bg-base);
}

.sr-confirm p {
  margin: 0;
}

.sr-confirm-title {
  font-size: 13px;
  font-weight: 500;
}

.sr-review {
  border-color: var(--accent);
}

/* \u2500\u2500 Tables \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.sr-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.sr-table th,
.sr-table td {
  padding: 6px 0 6px 12px;
  text-align: right;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.sr-table th:first-child {
  padding-left: 0;
  text-align: left;
}

.sr-table thead th {
  color: var(--text-muted);
}

.sr-table tbody tr {
  border-top: 1px solid var(--border);
}

.sr-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.sr-total p {
  margin: 0;
}

.sr-total-value {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.sr-facts {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sr-facts p {
  margin: 0;
}

.sr-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
`;var ee=globalThis.__ZCC_HOST_REACT__,j=ee.Fragment;function n(e,i,t){return ee.createElement(e,t===void 0?i:{...i,key:t})}var r=n;var L="storage",te="sr-plugin-styles",de=[7,14,30,60,90,180,365],ue=[7,30,90,180,365],H=5;function pe(){if(typeof document>"u")return;let e=typeof B=="string"?B:"",i=document.getElementById(te);if(i instanceof HTMLStyleElement){i.textContent=e;return}let t=document.createElement("style");t.id=te,t.textContent=e,document.head.appendChild(t)}pe();function ge(){let e=W();return J(()=>{let i=(t,o=null)=>e.call(t,o);return{state:()=>i("state"),hosts:()=>i("hosts"),scanHost:t=>i("scanHost",{hostId:t}),scanAll:()=>i("scanAll"),preview:t=>i("preview",t),configure:t=>i("configure",t),clearLargeFiles:t=>i("startClearLargeFiles",{hostId:t}),clearArchivedFiles:t=>i("startClearArchivedFiles",{hostId:t}),removeOrphans:t=>i("startRemoveOrphans",{hostId:t}),clearThread:t=>i("clearThread",{threadId:t})}},[e])}function oe(e){let[i,t]=S(!1),[o,s]=S(null),[c,u]=S(null),l=I(async(f,P)=>{t(!0),s(null);try{let g=await P();return s(g?{kind:"success",text:g}:null),e(),!0}catch(g){return s({kind:"error",text:`${f}: ${T(g)}`}),!1}finally{t(!1)}},[e]),b=I(async()=>{if(c===null)return;await l(c.failure,async()=>(await c.run(),c.started))&&u(null)},[c,l]);return{busy:i,notice:o,confirmation:c,setConfirmation:u,run:l,confirm:b}}function me({subPath:e}){let i=ge(),[t,o]=S(null),[s,c]=S(null),u=k(0),l=k(0),b=I(P=>{u.current++,o(g=>g===null?null:{...g,state:P})},[]),f=I(async()=>{let P=u.current,g=++l.current;try{let[m,A]=await Promise.all([i.state(),i.hosts()]);if(g!==l.current)return;o(a=>({state:a!==null&&P!==u.current?a.state:m,hosts:A.hosts})),c(null)}catch(m){g===l.current&&c(T(m))}},[i]);return G(()=>(f(),()=>{l.current++}),[f]),D("changed",()=>{f()}),D("policy-changed",()=>{let P=u.current;i.state().then(g=>{P===u.current&&b(g)},g=>c(T(g)))}),n("div",{className:"sr-panel",children:r("div",{className:"sr-page",children:[s!==null&&r("div",{role:"alert",className:"sr-notice sr-notice-error",children:[n("p",{style:{margin:"0 0 8px"},children:s}),n("button",{className:"sr-button",onClick:()=>{f()},children:"Try again"})]}),t===null?s===null&&n("p",{role:"status",className:"sr-muted",children:"Loading storage\u2026"}):e?n(Re,{hostId:e,hosts:t.hosts,api:i,refresh:f},e):n(fe,{state:t.state,hosts:t.hosts,api:i,refresh:f,updateState:b})]})})}function $({title:e,description:i,badge:t,action:o}){return r("div",{className:"sr-heading",children:[r("div",{children:[r("h2",{children:[e,t!==void 0&&n("span",{className:"sr-pill",children:t})]}),i!==void 0&&n("p",{className:"sr-muted sr-small",children:i})]}),o]})}function se({notice:e}){return e===null?null:e.kind==="error"?n("p",{role:"alert",className:"sr-notice sr-notice-error",children:e.text}):n("p",{role:"status",className:"sr-notice sr-notice-success",children:e.text})}function N({actions:e}){let{confirmation:i,busy:t,setConfirmation:o,confirm:s}=e;return i===null?null:r("div",{role:"region","aria-label":"Confirm cleanup",className:"sr-confirm",children:[r("div",{children:[n("p",{className:"sr-confirm-title",children:i.title}),n("p",{className:"sr-muted sr-small",children:i.detail})]}),r("div",{className:"sr-actions",children:[n("button",{className:"sr-button",disabled:t,onClick:()=>o(null),children:"Cancel"}),n("button",{className:"sr-button sr-button-danger",disabled:t,onClick:()=>{s()},children:t?"Working\u2026":i.action})]})]})}function he({value:e}){return e>0?n("span",{className:"sr-size",children:h(e)}):null}function ae(e,i,t){return{key:"large-files",title:`Delete ${t.fileCount.toLocaleString("en-US")} large ${t.fileCount===1?"file":"files"} (${h(t.bytes)})?`,detail:`Delete files of ${h(10485760)} or more from ${v(t.threadCount,"archived thread")}. Smaller files and conversation history will be kept. Pinned and running threads are skipped. This cannot be undone.`,action:"Delete large files",failure:"Could not start the large-file cleanup",started:"Large-file cleanup started in the background.",run:()=>e.clearLargeFiles(i)}}function fe({state:e,hosts:i,api:t,refresh:o,updateState:s}){let c=F(),u=oe(o),{busy:l,confirmation:b,setConfirmation:f,run:P}=u,g=i.reduce((d,y)=>y.report===null?d:{threadCount:d.threadCount+y.report.archivedLargeFiles.threadCount,fileCount:d.fileCount+y.report.archivedLargeFiles.fileCount,bytes:d.bytes+y.report.archivedLargeFiles.bytes},{threadCount:0,fileCount:0,bytes:0}),m=i.filter(d=>d.largeFileCleanup.state==="running"),A=g.bytes>=1073741824||m.length>0,a=i.filter(d=>d.scan.state!=="scanning");return r(j,{children:[r("header",{className:"sr-header",children:[n("h1",{className:"sr-title",children:"Storage & retention"}),n("p",{className:"sr-muted sr-small",style:{margin:0},children:"See what threads keep on each machine and decide what ZCC may clean up. Nothing is archived or cleared unless you turn a policy on or confirm a cleanup."})]}),n(se,{notice:u.notice}),A&&r("div",{className:"sr-card sr-card-pad sr-stack",children:[r("div",{className:"sr-row-top",style:{display:"flex",justifyContent:"space-between",gap:12},children:[r("div",{children:[n("p",{className:"sr-row-name",style:{margin:0},children:g.bytes>=1073741824?`Free up ${h(g.bytes)} from archived threads`:"Large-file cleanup"}),r("p",{className:"sr-muted sr-small",style:{margin:"2px 0 0"},children:[v(g.fileCount,"file")," of ",h(10485760)," or more sit in the thread storage of ",v(g.threadCount,"archived thread"),". Deleting them keeps smaller files and conversation history."]})]}),n("button",{className:"sr-button",disabled:l||g.fileCount===0||m.length>0,onClick:()=>f(ae(t,null,g)),children:"Delete large files"})]}),b?.key==="large-files"&&n(N,{actions:u}),m.map(d=>r("p",{role:"status",className:"sr-muted sr-small",style:{margin:0},children:[d.hostName,": Deleting large files\u2026"]},d.hostId))]}),r("section",{"aria-label":"Machine storage",className:"sr-stack",children:[n($,{title:"Machine storage",action:n("button",{className:"sr-button",disabled:l||a.length===0,onClick:()=>{P("Could not start the scan",async()=>{await t.scanAll()})},children:"Scan all"})}),r("div",{className:"sr-card sr-list",children:[i.length===0&&r("div",{className:"sr-row-block",style:{textAlign:"center"},children:[n("p",{className:"sr-row-name",children:"No machines found"}),n("p",{className:"sr-muted sr-small",children:"Connect a machine to inspect its storage."})]}),i.map(d=>n(Pe,{host:d,busy:l,onOpen:()=>c.toPluginPanel(L,{subPath:d.hostId}),onScan:()=>{P("Could not start the scan",async()=>{await t.scanHost(d.hostId)})}},d.hostId))]})]}),n(ve,{state:e,api:t,updateState:s})]})}function Z(e){return e.activeThreadBytes+e.archivedThreadBytes+e.orphanBytes}function Pe({host:e,busy:i,onOpen:t,onScan:o}){let s=e.report,c=e.scan.state==="scanning",u=c?"scanning\u2026":e.scan.state==="failed"?"scan failed":s?`scanned ${_(s.scannedAt)}`:"not scanned",l=s?[`${h(Z(s))} in ${v(s.threadsWithStorageCount,"thread")}`,...s.disk?[`${h(s.disk.freeBytes)} free`]:[]]:[];return r("div",{className:"sr-row",children:[r("div",{className:"sr-row-main",children:[n("p",{className:"sr-row-name",children:n("button",{className:"sr-link",onClick:t,children:e.hostName})}),n("p",{className:"sr-muted sr-small",children:u}),e.scan.state==="failed"&&n("p",{className:"sr-error",children:e.scan.message}),l.length>0&&n("p",{className:"sr-muted sr-small sr-num",children:l.map((b,f)=>r("span",{children:[b,f<l.length-1&&" \xB7 "]},b))})]}),r("div",{className:"sr-row-side",children:[s&&n("span",{className:"sr-num",children:h(Z(s))}),n("button",{className:"sr-button","aria-label":`${s?"Rescan":"Scan"} ${e.hostName}`,disabled:i||c,onClick:o,children:c?"Scanning\u2026":s?"Rescan":"Scan"})]})]})}var be=(e,i)=>e.archiveAfterDays===i.archiveAfterDays&&e.clearAfterDays===i.clearAfterDays&&e.clearStorageOnArchive===i.clearStorageOnArchive;function xe(e,i,t){if(e===null)return"Checking what this would affect\u2026";let o=[`With these settings the next hourly check would archive ${v(e.archiveCount,"thread")} and clear the files of ${v(e.clearCount,"archived thread")}.`];return i.clearStorageOnArchive&&!t.clearStorageOnArchive&&o.push("Files of threads you archive from now on would be cleared about 30 seconds after archiving, once an undo is no longer possible."),o.join(" ")}function ve({state:e,api:i,updateState:t}){let[o,s]=S(null),[c,u]=S(null),[l,b]=S(!1),f=k(0),P=o?.policy??e.policy,g=e.policy.archiveAfterDays!==null||e.policy.clearAfterDays!==null;async function m(d){b(!0),u(null);try{t(await i.configure(d)),f.current++,s(null)}catch(y){u(`Could not save: ${T(y)}`)}finally{b(!1)}}function A(d,y){if(l)return;let C={...P,[d]:y},w=++f.current;if(u(null),be(C,e.policy)){s(null);return}if(X(e.policy,C)){s(null),m(C);return}s({policy:C,preview:null}),i.preview(C).then(R=>{w===f.current&&s({policy:C,preview:R})},R=>{w===f.current&&u(`Could not preview: ${T(R)}`)})}function a(){f.current++,s(null),u(null)}return r("section",{"aria-label":"Automatic retention",className:"sr-stack",children:[n($,{title:"Automatic retention",description:"Archive inactive threads and clear the files of old archives, across all projects. Checked hourly. Everything is off until you turn it on.",badge:g?"Checks hourly":"Off"}),r("p",{role:"note",className:"sr-notice",children:[n("strong",{children:"Pinned threads are never archived or cleared."})," Pin the threads you want to keep. Conversation history and uploaded attachments are never removed by these settings."]}),r("div",{className:"sr-card sr-list",children:[n(re,{label:Ce,description:"After this long with no activity.",presets:de,value:P.archiveAfterDays,disabled:l,onChange:d=>A("archiveAfterDays",d)}),n(re,{label:Ae,description:"After a thread has been archived this long. The thread itself stays.",presets:ue,value:P.clearAfterDays,disabled:l,onChange:d=>A("clearAfterDays",d)}),r("label",{className:"sr-row",children:[r("span",{className:"sr-row-main",children:[n("span",{className:"sr-row-name",children:ie}),n("span",{className:"sr-muted sr-small",children:"About 30 seconds after archiving, so an undo still works. Conversations and uploaded attachments are kept. Pinned threads are skipped."})]}),n("input",{type:"checkbox",role:"switch",className:"sr-switch","aria-label":ie,checked:P.clearStorageOnArchive,disabled:l,onChange:d=>A("clearStorageOnArchive",d.target.checked)})]}),(e.lastRun!==null||g)&&n("div",{className:"sr-row",children:n("p",{className:"sr-muted sr-small",children:e.lastRun?`Last checked ${_(e.lastRun.ranAt)} \xB7 ${e.lastRun.archivedCount} archived \xB7 ${e.lastRun.clearedCount} cleared${e.lastRun.failedCount?` \xB7 ${e.lastRun.failedCount} failed`:""}`:"The first check runs within the hour."})})]}),o!==null&&r("div",{role:"region","aria-label":"Review retention change",className:"sr-confirm sr-review",children:[n("p",{className:"sr-confirm-title",children:"Review before saving"}),n("p",{className:"sr-muted sr-small",children:xe(o.preview,o.policy,e.policy)}),r("div",{className:"sr-actions",children:[n("button",{className:"sr-button",disabled:l,onClick:a,children:"Cancel"}),n("button",{className:"sr-button",disabled:l||o.preview===null,onClick:()=>{m(o.policy)},children:l?"Saving\u2026":"Save retention settings"})]})]}),c!==null&&n("p",{role:"alert",className:"sr-error",children:c})]})}var Ce="Archive inactive threads",Ae="Clear files of archived threads",ie="Clear files when a thread is archived";function re({label:e,description:i,presets:t,value:o,disabled:s,onChange:c}){let u=o===null||t.includes(o)?t:[...t,o].sort((l,b)=>l-b);return r("div",{className:"sr-row",children:[r("div",{className:"sr-row-main",children:[n("p",{className:"sr-row-name",children:e}),n("p",{className:"sr-muted sr-small",children:i})]}),r("select",{className:"sr-select","aria-label":e,disabled:s,value:o===null?"never":String(o),onChange:l=>c(l.target.value==="never"?null:Number(l.target.value)),children:[n("option",{value:"never",children:"Never"}),u.map(l=>r("option",{value:String(l),children:["After ",Q(l)]},l))]})]})}function ye(e){switch(e.state){case"running":return{kind:"info",text:"Deleting large files in the background\u2026"};case"completed":return{kind:"success",text:`Deleted ${v(e.clearedFiles,"file")} (${h(e.clearedBytes)}).`};case"failed":return{kind:"error",text:`Large-file cleanup failed: ${e.message}`};default:return null}}function Se(e){switch(e.state){case"running":return{kind:"info",text:`Clearing archived files in the background. Cleared ${h(e.clearedBytes)} from ${v(e.clearedThreads,"thread")} so far.`};case"completed":return{kind:"success",text:`Cleared ${h(e.clearedBytes)} from ${v(e.clearedThreads,"archived thread")}.`};case"failed":return{kind:"error",text:`Archived-file cleanup failed: ${e.message}${e.clearedThreads>0?` (cleared ${h(e.clearedBytes)} from ${v(e.clearedThreads,"thread")} first)`:""}`};default:return null}}function we(e){switch(e.state){case"running":return{kind:"info",text:"Removing orphaned storage\u2026"};case"completed":return{kind:"success",text:e.message};case"failed":return{kind:"error",text:`Orphan cleanup failed: ${e.message}`};default:return null}}function V({job:e}){return e===null?null:e.kind==="error"?n("p",{role:"alert",className:"sr-error",children:e.text}):n("p",{role:"status",className:"sr-muted sr-small",children:e.text})}function Te(e){return[{label:"Active threads",count:e.threadsWithStorageCount-e.archivedThreadCount,value:e.activeThreadBytes},{label:"Archived threads",count:e.archivedThreadCount,value:e.archivedThreadBytes},...e.orphanCount>0||e.orphanBytes>0?[{label:"Orphaned",count:e.orphanCount,value:e.orphanBytes}]:[]]}function Re({hostId:e,hosts:i,api:t,refresh:o}){let s=F(),c=oe(o),{busy:u,confirmation:l,setConfirmation:b,run:f}=c,[P,g]=S(!1),m=i.find(x=>x.hostId===e)??null,A=n("button",{className:"sr-link sr-link-muted",onClick:()=>s.toPluginPanel(L),children:"All machines"});if(m===null)return r("header",{className:"sr-header",children:[A,n("p",{className:"sr-muted",children:"This machine is not available."})]});let a=m.report,d=m.scan.state==="scanning",y=m.largeFileCleanup.state==="running"||m.archivedFileCleanup.state==="running"||m.maintenance.state==="running",C=u||y,w=a?.largestThreads??[],R=P?w:w.slice(0,H),O=a?a.hiddenThreads.activeCount+a.hiddenThreads.archivedCount:0,le=a?a.hiddenThreads.activeBytes+a.hiddenThreads.archivedBytes:0,U=d&&n("p",{role:"status",className:"sr-muted sr-small",children:"Scanning in the background. Large directories may take a few minutes."});return r(j,{children:[r("header",{className:"sr-header",children:[A,r("div",{className:"sr-header-row",children:[r("div",{children:[n("h1",{className:"sr-title",children:m.hostName}),n("p",{className:"sr-muted sr-small",children:"Review stored files and free up space on this machine."})]}),n("button",{className:"sr-button",disabled:u||d,onClick:()=>{f("Could not start the scan",async()=>{await t.scanHost(m.hostId)})},children:d?"Scanning\u2026":a?"Rescan machine":"Scan machine"})]})]}),n(se,{notice:c.notice}),n("aside",{"aria-label":"What is thread storage?",className:"sr-info",children:r("div",{children:[n("h2",{children:"What is thread storage?"}),n("p",{className:"sr-muted sr-small",children:"A place for an agent to keep things that do not belong in the repository, like plans, reports and scratch files. Clearing it removes those files for good. Conversation history and uploaded attachments are kept separately."})]})}),m.scan.state==="failed"&&r("p",{role:"alert",className:"sr-error",children:["Scan failed: ",m.scan.message]}),a===null?r("div",{className:"sr-empty",children:[n("h2",{children:d?"Scanning this machine":"See what is taking up space"}),d?U:n("p",{className:"sr-muted sr-small",children:"Scan this machine to measure thread files and find storage you can clean up. Nothing is removed during a scan."})]}):r(j,{children:[r("section",{"aria-label":"Storage breakdown",className:"sr-card sr-card-pad",children:[r("div",{className:"sr-total",children:[n("p",{children:"Thread storage"}),n("p",{className:"sr-total-value",children:h(Z(a))})]}),r("table",{className:"sr-table",children:[n("caption",{className:"sr-sr-only",children:"Storage by category"}),n("thead",{children:r("tr",{children:[n("th",{scope:"col",children:"Category"}),n("th",{scope:"col",children:"Count"}),n("th",{scope:"col",children:"Size"})]})}),n("tbody",{children:Te(a).map(x=>r("tr",{children:[n("th",{scope:"row",children:x.label}),n("td",{className:"sr-muted",children:x.count.toLocaleString("en-US")}),n("td",{children:h(x.value)})]},x.label))})]}),r("div",{className:"sr-facts sr-muted sr-small",children:[a.disk&&r("p",{className:"sr-num",children:["Disk space: ",h(a.disk.freeBytes)," free of ",h(a.disk.totalBytes)]}),r("p",{title:new Date(a.scannedAt).toLocaleString(),children:["Scanned ",_(a.scannedAt)]}),a.partialCount>0&&r("p",{children:[v(a.partialCount,"folder")," ",a.partialCount===1?"was":"were"," too large to measure completely, so ",a.partialCount===1?"its size is a lower bound":"their sizes are lower bounds","."]}),O>0&&r("p",{children:["Includes ",v(O,"hidden thread")," (",h(le),") that"," ",O===1?"does":"do"," not appear in the thread list."]}),U]})]}),r("section",{"aria-label":"Clean up",className:"sr-stack",children:[n($,{title:"Clean up",description:"Each cleanup asks for confirmation first and cannot be undone."}),r("div",{className:"sr-card sr-list",children:[r(z,{title:"All files in archived threads",size:a.archivedFiles.bytes,description:`Clear stored files of any size from ${v(a.archivedFiles.threadCount,"archived thread")}. Pinned and running threads are skipped. Conversations and uploaded attachments are kept.`,action:"Clear archived files",disabled:C||a.archivedFiles.threadCount===0,onAction:()=>b({key:"archived-files",title:"Clear all archived thread files?",detail:`Delete ${h(a.archivedFiles.bytes)} of stored files from ${v(a.archivedFiles.threadCount,"archived thread")} on this machine. This includes small files. Conversations and uploaded attachments will be kept. Pinned and running threads are skipped. This cannot be undone.`,action:"Clear archived files",failure:"Could not start the archived-file cleanup",started:"Archived-file cleanup started in the background.",run:()=>t.clearArchivedFiles(m.hostId)}),children:[l?.key==="archived-files"&&n(N,{actions:c}),n(V,{job:Se(m.archivedFileCleanup)})]}),r(z,{title:"Large files in archived threads",size:a.archivedLargeFiles.bytes,description:a.archivedLargeFiles.fileCount>0?`${v(a.archivedLargeFiles.fileCount,"file")} of ${h(10485760)} or more across ${v(a.archivedLargeFiles.threadCount,"archived thread")}. Smaller files and conversation history are kept.`:`No files of ${h(10485760)} or more in archived threads.`,action:"Delete large files",disabled:C||a.archivedLargeFiles.fileCount===0,onAction:()=>b(ae(t,m.hostId,a.archivedLargeFiles)),children:[l?.key==="large-files"&&n(N,{actions:c}),n(V,{job:ye(m.largeFileCleanup)})]}),r(z,{title:"Orphaned storage",size:a.orphanBytes,description:"Folders in this machine's thread storage that no thread of this ZCC server owns. Only folders older than 10 minutes are removed.",action:"Remove orphans",disabled:C||a.orphanCount===0,onAction:()=>b({key:"orphans",title:`Remove ${h(a.orphanBytes)} of orphaned storage?`,detail:"Delete folders that no thread knows about. Existing threads and their files are kept. If this machine is also used by another ZCC server, check that those folders are not in use there first. This cannot be undone.",action:"Remove orphans",failure:"Could not start the orphan cleanup",started:"Orphan cleanup started in the background.",run:()=>t.removeOrphans(m.hostId)}),children:[l?.key==="orphans"&&n(N,{actions:c}),n(V,{job:we(m.maintenance)})]})]})]}),r("section",{"aria-label":"Threads using the most storage",className:"sr-stack",children:[n($,{title:"Threads using the most storage",description:"Clear files permanently removes a stopped thread's stored files, including small ones. Conversation history is kept."}),r("div",{className:"sr-card sr-list",children:[w.length===0&&n("p",{className:"sr-muted sr-small",style:{textAlign:"center",padding:20,margin:0},children:"No thread files found in the last scan."}),R.map(x=>n(Ie,{thread:x,disabled:C||x.running,onOpen:()=>s.toThread(x.threadId),onClear:()=>b({key:`thread:${x.threadId}`,title:`Clear the files of \u201C${x.title}\u201D?`,detail:`Delete ${h(x.sizeBytes)} of stored files, including small ones. Conversation history and uploaded attachments are kept. Conversation history is kept. This cannot be undone.`,action:"Clear files",failure:"Could not clear the thread files",started:`Cleared the files of \u201C${x.title}\u201D.`,run:()=>t.clearThread(x.threadId)}),children:l?.key===`thread:${x.threadId}`&&n(N,{actions:c})},x.threadId)),w.length>H&&n("div",{className:"sr-row",children:n("button",{className:"sr-link sr-link-muted","aria-expanded":P,onClick:()=>g(!P),children:P?"Show fewer":`Show ${w.length-H} more`})})]})]})]})]})}function z({title:e,size:i,description:t,action:o,disabled:s,onAction:c,children:u}){return r("div",{className:"sr-row-block",children:[r("div",{className:"sr-row-top",children:[r("div",{className:"sr-row-main",children:[r("p",{className:"sr-row-name",children:[e," ",n(he,{value:i})]}),n("p",{className:"sr-muted sr-small",children:t})]}),n("button",{className:"sr-button",disabled:s,onClick:c,children:o})]}),u]})}function Ie({thread:e,disabled:i,onOpen:t,onClear:o,children:s}){let c=[...e.hidden?["hidden"]:[],...e.pinned?["pinned"]:[],...e.running?["running"]:e.archivedAt!==null?["archived"]:[]];return r("div",{className:"sr-row-block",children:[r("div",{className:"sr-row-top",children:[n("div",{className:"sr-row-main",children:r("p",{className:"sr-row-name",children:[n("button",{className:"sr-link",title:e.title,onClick:t,children:e.title})," ",c.map(u=>n("span",{className:"sr-pill",children:u},u))]})}),r("div",{className:"sr-row-side",children:[n("span",{className:"sr-muted sr-small sr-num",children:h(e.sizeBytes)}),n("button",{className:"sr-button","aria-label":`Clear files: ${e.title}`,disabled:i,onClick:o,children:"Clear files"})]})]}),s]})}var Sn=K(e=>{e.slots.navPanel({id:L,title:"Storage & retention",icon:"DatabaseBackup",path:L,component:me})});export{Sn as default};
