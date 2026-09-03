function K(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function J(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function Re(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function I(e,t,r){return K().callRpc(e,t,r)}async function X(e,t){return K().setSettings(e,t)}function W(e){return{__zccPluginApp:!0,setup:e}}function Q(){return J().useSettings?.()??{values:void 0,isLoading:!0}}function L(){return J().useZccNavigate?.()??Re("useZccNavigate")}var o=globalThis.__ZCC_HOST_REACT__;var Le=o.Children,Fe=o.Component,Ge=o.Fragment,Be=o.StrictMode,$e=o.Suspense,Ve=o.cloneElement,He=o.createContext,Ue=o.createElement,ze=o.createRef,qe=o.forwardRef,Ze=o.isValidElement,Ye=o.lazy,Ke=o.memo,Je=o.startTransition,v=o.useCallback,Xe=o.useContext,We=o.useDebugValue,Qe=o.useDeferredValue,R=o.useEffect,et=o.useId,tt=o.useImperativeHandle,nt=o.useInsertionEffect,it=o.useLayoutEffect,ee=o.useMemo,ot=o.useReducer,te=o.useRef,l=o.useState,rt=o.useSyncExternalStore,st=o.useTransition,at=o.version;var b=[{id:"support-bot",title:"Support bot",dialect:"agentforce",source:`# @dialect:agentforce
config:
    agent_name: "Support Bot"
    default_locale: "en_US"

variables:
    case_id: mutable string = ""
        description: "The current support case ID"
    is_verified: mutable boolean = False

system:
    instructions: |
        You are a helpful support agent.
        Always verify the customer before discussing account details.

start_agent:
    reasoning:
        instructions: ->
            | Greet the user and ask for their case ID.
            if @variables.is_verified:
                | You may discuss account details.
            | Always be concise and professional.
    after_reasoning:
        if not @variables.is_verified:
            transition to @topic.identity_verification
        else:
            transition to @topic.billing

topic identity_verification:
    description: "Verify the customer before account work"
    reasoning:
        instructions: ->
            | Ask for the email on the account, then confirm the case ID.

topic billing:
    description: "Handle billing inquiries"
    reasoning:
        instructions: ->
            | Look up the case and explain the latest invoice in plain language.
`},{id:"minimal",title:"Minimal agent",dialect:"agentscript",source:`# @dialect:agentscript
config:
    agent_name: "Minimal"

system:
    instructions: "You are a concise assistant."

start_agent:
    reasoning:
        instructions: "Greet the user and wait for a task."
`},{id:"fabric-router",title:"Fabric router",dialect:"agentfabric",source:`# @dialect:agentfabric
config:
    agent_name: "Fabric Router"

system:
    instructions: "Route the user to the right specialist."

start_agent:
    reasoning:
        instructions: ->
            | Ask what the user needs, then transition.
    after_reasoning:
        transition to @topic.handoff

topic handoff:
    description: "Hand the conversation to a specialist"
    reasoning:
        instructions: "Summarize the request and pick a specialist."
`}];var F=["agentforce","agentscript","agentfabric"],be="agentforce";function G(e){return F.includes(e)?e:be}var f="zcc-salesforce-agentscript";function Ce(e){return!!e&&typeof e=="object"}function ne(e){return!Ce(e)||e.source!==f||typeof e.type!="string"?!1:e.type==="ready"?!0:e.type==="dirty"?typeof e.dirty=="boolean":e.type==="requestOpen"?typeof e.path=="string":e.type==="persist"&&typeof e.path=="string"&&typeof e.content=="string"}function B(){return typeof document>"u"?"dark":document.documentElement.getAttribute("data-theme")==="light"?"light":"dark"}var ie="/plugins/salesforce/assets/playground/dist/index.html";function oe(e,t){return e?`file:${e}`:`example:${t}`}function re(e){return e.startsWith("example:")?{kind:"example",id:e.slice(8)}:{kind:"file",path:e.startsWith("file:")?e.slice(5):e}}function se(e,t,r){return!e||!t||r}function ae(e,t){return e&&!t?"Examples are in-memory until you set a DX project root under Plugins \u2192 Salesforce.":null}var le=12e3,ce="Could not load the Agent Script playground. Rebuild the Salesforce plugin (`pnpm --dir plugins/salesforce run build`) or reinstall it.";function ue(e){return e.ready?!1:e.iframeError||e.timedOut}var pe=globalThis.__ZCC_HOST_REACT__,gt=pe.Fragment;function g(e,t,r){return pe.createElement(e,r===void 0?t:{...t,key:r})}var C=g;var Te="salesforce",_e={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function x(e,t){try{e?.contentWindow?.postMessage(t,window.location.origin)}catch{}}function de(e){let t=e.pluginId||Te,r=Q(),a=te(null),[p,P]=l(null),[m,A]=l([]),[S,c]=l(e.subPath||null),[k,u]=l(b[0]?.id??"support-bot"),[d,D]=l(void 0),[ge,E]=l(!1),[V,h]=l(null),[H,U]=l(!1),[me,fe]=l(null),[N,Pe]=l(!1),[M,z]=l(!1),[he,q]=l(!1),y=me??G(r.values?.agentScriptDialect),T=!!p?.dxProject,O=v(async()=>{let n=await I(t,"agentFiles.list");n?.ok&&Array.isArray(n.files)&&A(n.files)},[t]);R(()=>{let n=!1;return I(t,"status").then(i=>{n||P(i??{})}).catch(i=>{n||h(i instanceof Error?i.message:String(i))}),O().catch(i=>{n||h(i instanceof Error?i.message:String(i))}),()=>{n=!0}},[t,O]);let _=v(async(n,i)=>{if(h(null),!n){let j=b.find(ye=>ye.id===i)??b[0];c(null),u(j?.id??"support-bot"),D(void 0),E(!1),x(a.current,{source:f,type:"setFile",path:null,content:j?.source??"",dialect:j?.dialect??y,readOnly:!1});return}let s=await I(t,"agentFiles.read",{path:n});if(!s?.ok||!s.file){h(s?.error||"Could not read Agent Script file.");return}c(s.file.path),u(""),D(s.file.sha256),E(!1),x(a.current,{source:f,type:"setFile",path:s.file.path,content:s.file.content,dialect:y,readOnly:!1,sha256:s.file.sha256})},[y,t]),xe=v(()=>{x(a.current,{source:f,type:"flushSave"})},[]),Z=v(async(n,i)=>{if(!T||!n){h("Set a DX project root before saving.");return}U(!0),h(null);try{let s=await I(t,"agentFiles.write",{path:n,content:i,expectedSha256:d});if(!s?.ok||!s.file){h(s?.error||"Save failed.");return}D(s.file.sha256),E(!1),x(a.current,{source:f,type:"saved",sha256:s.file.sha256}),await O()}finally{U(!1)}},[t,O,T,d]);R(()=>{let n=i=>{if(i.origin!==window.location.origin||!ne(i.data))return;let s=i.data;if(s.type==="ready"){Pe(!0),z(!1),q(!1),x(a.current,{source:f,type:"init",dialect:y,theme:B(),examples:b,files:m,saveEnabled:T}),_(e.subPath||null);return}if(s.type==="dirty"){E(s.dirty);return}if(s.type==="requestOpen"){_(s.path);return}s.type==="persist"&&Z(s.path,s.content)};return window.addEventListener("message",n),()=>window.removeEventListener("message",n)},[y,m,_,Z,e.subPath,T]),R(()=>{if(typeof process<"u"&&process.env.VITEST||N||M)return;let n=window.setTimeout(()=>q(!0),le);return()=>window.clearTimeout(n)},[N,M]),R(()=>{let n=a.current;if(!n)return;let i=()=>z(!0);return n.addEventListener("error",i),()=>n.removeEventListener("error",i)},[]),R(()=>{let n=document.documentElement,i=new MutationObserver(()=>{x(a.current,{source:f,type:"setTheme",theme:B()})});return i.observe(n,{attributes:!0,attributeFilter:["data-theme"]}),()=>i.disconnect()},[]);let Y=ee(()=>ae(!!p,p?.dxProject),[p]),Ae=oe(S,k),Se=ue({ready:N,iframeError:M,timedOut:he});return C("div",{style:_e,"data-testid":"salesforce-agent-script-panel",children:[C("div",{style:{display:"flex",gap:8,alignItems:"center",padding:"8px 12px",borderBottom:"1px solid var(--border, #333)",flexWrap:"wrap"},children:[g("strong",{children:"Agent Script"}),g("select",{"aria-label":"Agent Script dialect",value:y,onChange:n=>{let i=G(n.target.value);fe(i),X(t,{agentScriptDialect:i}).catch(()=>{}),x(a.current,{source:f,type:"setDialect",dialect:i})},children:F.map(n=>g("option",{value:n,children:n},n))}),C("select",{"aria-label":"Agent Script file",value:Ae,onChange:n=>{let i=re(n.target.value);if(i.kind==="example"){_(null,i.id);return}_(i.path)},children:[b.map(n=>C("option",{value:`example:${n.id}`,children:["Example: ",n.title]},n.id)),m.map(n=>C("option",{value:`file:${n.path}`,children:[n.apiName," (",n.path,")"]},n.path))]}),g("button",{type:"button",disabled:se(T,S,H),onClick:()=>void xe(),children:H?"Saving\u2026":ge?"Save":"Saved"}),Y?g("span",{style:{color:"var(--text-muted)"},children:Y}):null,V?g("span",{style:{color:"var(--danger, #c00)"},children:V}):null]}),Se?g("p",{"data-testid":"salesforce-agent-script-playground-error",style:{color:"var(--danger, #c00)",padding:16},children:ce}):g("iframe",{ref:a,title:"Agent Script playground",src:typeof process<"u"&&process.env.VITEST?"about:blank":ie,style:{flex:1,minHeight:0,width:"100%",border:0,background:"transparent"}})]})}function w(){return globalThis.__ZCC_HOST_REACT__}function $(){return globalThis.__ZCC_PLUGIN_HOST__}function Ie(e){let t=w();return t?t.createElement("div",{style:{padding:16,height:"100%",boxSizing:"border-box"}},e):null}function ve(e){let t=w(),r=L();if(!t)return null;let[a,p]=t.useState(null),[P,m]=t.useState(!1),[A,S]=t.useState(null);t.useEffect(()=>{let u=!1;return $()?.callRpc(e.pluginId,"status").then(d=>{u||p(d)}).catch(d=>{u||S(d instanceof Error?d.message:String(d))}),()=>{u=!0}},[e.pluginId]);let c=a?.lastDoctor,k=c?.org?`${c.org.alias} (${c.org.kind})`:a?.defaultOrg||"No org configured";return Ie(t.createElement(t.Fragment,null,t.createElement("h2",{style:{marginTop:0}},"Salesforce"),t.createElement("p",null,k),c?.cliOk===!1?t.createElement("p",{style:{color:"var(--danger)"}},c.cliError||"Salesforce CLI missing"):null,c&&typeof c.agentBundleCount=="number"?t.createElement("p",{style:{color:"var(--text-muted)"}},`${c.agentBundleCount} .agent bundle${c.agentBundleCount===1?"":"s"}`):null,a&&!a.dxProject?t.createElement("p",{style:{color:"var(--text-muted)"}},"No sfdx-project.json at the configured DX project root."):null,A?t.createElement("p",{style:{color:"var(--danger)"}},A):null,t.createElement("div",{style:{display:"flex",gap:8}},t.createElement("button",{type:"button",disabled:P,onClick:()=>{m(!0),S(null),$()?.callRpc(e.pluginId,"doctor").then(u=>{p(d=>({...d??{},lastDoctor:u}))}).catch(u=>S(u instanceof Error?u.message:String(u))).finally(()=>m(!1))}},P?"Running doctor\u2026":"Run doctor"),t.createElement("button",{type:"button",onClick:()=>r.toPluginPanel("agent-script")},"Open Agent Script"))))}function we(e){let t=w();if(!t)return null;let r=e.interaction.payload&&typeof e.interaction.payload=="object"?e.interaction.payload:{};return t.createElement("div",{style:{display:"grid",gap:8}},t.createElement("p",{style:{margin:0}},r.summary||"Confirm this Salesforce action."),r.orgAlias?t.createElement("p",{style:{margin:0,color:"var(--text-muted)"}},`${r.orgAlias} \xB7 ${r.orgKind||"unknown"}${r.orgId?` \xB7 ${r.orgId}`:""}`):null,r.preview?t.createElement("pre",{style:{whiteSpace:"pre-wrap",maxHeight:160,overflow:"auto",margin:0}},String(r.preview)):null,t.createElement("div",{style:{display:"flex",gap:8}},t.createElement("button",{type:"button",onClick:()=>void e.submit({approved:!0})},"Allow this action"),t.createElement("button",{type:"button",onClick:()=>void e.cancel()},"Deny")))}function Ee(e){let t=w();if(!t)return null;let[r,a]=t.useState(null);if(t.useEffect(()=>{let m=!1;return $()?.callRpc(e.pluginId||"salesforce","status").then(A=>{m||a(A)}).catch(()=>{}),()=>{m=!0}},[e.pluginId]),!r)return null;let p=r.lastDoctor,P=p?.org?.kind;return!r.defaultOrg&&r.dxProject?t.createElement("p",{style:{margin:0}},"Salesforce: set a default org alias under Plugins \u2192 Salesforce, then run zcc sf doctor."):P==="production"?t.createElement("p",{style:{margin:0}},`Salesforce: target org ${r.defaultOrg} is production. Org reads, anonymous Apex, and Agent publish/activate require confirmation.`):P==="unknown"?t.createElement("p",{style:{margin:0}},`Salesforce: target org ${r.defaultOrg} kind is unknown. Access and Agent publish/activate require confirmation.`):(p?.agentBundleCount??0)>0?t.createElement("p",{style:{margin:0}},"Salesforce: Agent publish/activate requires confirmation."):null}function Oe(e){let t=w(),r=L();if(!t)return null;let a=e.experimental_Original;return t.createElement("div",{className:"salesforce-agent-opener",style:{display:"grid",gap:8,padding:8}},t.createElement("p",{style:{margin:0,color:"var(--text-muted)"}},e.path),t.createElement("button",{type:"button",onClick:()=>r.toPluginPanel("agent-script",{subPath:e.path})},"Open in Agent Script"),t.createElement(a))}var Tt=W(e=>{e.slots.navPanel({id:"agent-script",title:"Agent Script",icon:"FileCode",component:de}),e.slots.fileOpener({id:"agent",title:"Agent Script",extensions:["agent","afscript"],component:Oe}),e.slots.projectTab({id:"salesforce",label:"Salesforce",icon:"Cloud",order:80,global:!1,component:ve}),e.slots.pendingInteraction({id:"salesforce-guardrail",component:we}),e.composer.customize({id:"salesforce-banner",scopes:["thread","new-thread"],banners:[{id:"org-status",chrome:"card",component:Ee}]}),e.slots.commandPaletteAction({id:"open-agent-script",title:"Open Agent Script",run:t=>{t.toPluginPanel("agent-script")}})});export{Tt as default};
