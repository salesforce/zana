function Hn(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function gt(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function Qt(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function Yt(e,a,r){return Hn().callRpc(e,a,r)}function eo(e){return{__zccPluginApp:!0,setup:e}}function ao(){return gt().useRpc?.()??Qt("useRpc")}function to(e,a){gt().useRealtime?.(e,a)}function ke(){return gt().useZccNavigate?.()??Qt("useZccNavigate")}function _n(){return globalThis.__ZCC_HOST_REACT__}function Un(e,a){let r=_n(),t=gt()[e];return!r||!t?null:r.createElement(t,a)}function va(e){return Un("Markdown",e)}var H=globalThis.__ZCC_HOST_REACT__;var Ts=H.Children,Ms=H.Component,Rs=H.Fragment,Fs=H.StrictMode,Bs=H.Suspense,Ns=H.cloneElement,oo=H.createContext,ga=H.createElement,Es=H.createRef,xt=H.forwardRef,qs=H.isValidElement,Os=H.lazy,Hs=H.memo,_s=H.startTransition,he=H.useCallback,ro=H.useContext,Us=H.useDebugValue,no=H.useDeferredValue,B=H.useEffect,zs=H.useId,Gs=H.useImperativeHandle,js=H.useInsertionEffect,ht=H.useLayoutEffect,X=H.useMemo,Vs=H.useReducer,D=H.useRef,C=H.useState,$s=H.useSyncExternalStore,Ws=H.useTransition,Xs=H.version;var so=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function lo(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:so(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var io=e=>{let a="",r=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){r=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=r?t.toUpperCase():t,r=!1}return a};var uo=e=>{let a=io(e);return a.charAt(0).toUpperCase()+a.slice(1)};var ka=(...e)=>e.filter((a,r,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===r).join(" ").trim();var Be={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function Mt(e){return e!=null}function co(e,a={}){let r=a.attributeNames??{},t=L=>r[L]??L,n=e.size??e.width??Be.width,d=e.size??e.height??Be.height,i=e.aliases?.filter(L=>typeof L=="string"&&L.trim()!=="").map(L=>`lucide-${L}`)??[],l=[...e.name?[`lucide-${e.name}`]:[],...i],f=a.className?.split(" ").filter(Boolean)??[],u=a.includeDefaultClasses===!1?ka(...f):ka("lucide",...l,...f),c=a.absoluteStrokeWidth?Number(a.strokeWidth??Be["stroke-width"])*Number(e.size??e.width??Be.width)/Number(a.size??a.width??Be.width):a.strokeWidth??Be["stroke-width"];return["svg",{...Object.entries(Be).reduce((L,[S,h])=>(L[t(S)]=h,L),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&Mt(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&Mt(a.width)&&{[t("width")]:a.width},..."height"in a&&Mt(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:c,...u&&{[t("class")]:u},[t("viewBox")]:`0 0 ${n} ${d}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(L=>{let[S,h,b]=L,w=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...h}:h;return b?[S,w,b]:[S,w]})]}function fo(e,a={}){return co(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var po=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var zn=oo({});var mo=()=>ro(zn);var go=xt(({color:e,size:a,width:r,height:t,strokeWidth:n,absoluteStrokeWidth:d,nonScalingStroke:i,className:l="",children:f,iconNode:u=[],icon:c={node:u,aliases:[],size:24},...x},L)=>{let{size:S=24,strokeWidth:h=2,absoluteStrokeWidth:b=!1,nonScalingStroke:w=!1,color:q="currentColor",className:N=""}=mo()??{},E=!!f||po(x),[A,R,v=[]]=fo(c,{color:e??q,width:r??a??S,height:t??a??S,strokeWidth:n??h,absoluteStrokeWidth:d??b,nonScalingStroke:i??w,className:ka(N,l),hasA11yProp:E,attributes:x});return ga(A,{ref:L,...R},[...v.map(([T,p])=>ga(T,p)),...Array.isArray(f)?f:[f]])});function m(e,a=[],r=[]){let t=typeof e=="string"?lo(e,a,r):e,n=xt(({className:d,...i},l)=>ga(go,{ref:l,icon:t,className:d,...i}));return t.name&&(n.displayName=uo(t.name)),n}var xo={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};xo.node;var Aa=m(xo);var ho={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};ho.node;var Da=m(ho);var Lo={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};Lo.node;var Ta=m(Lo);var Io={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};Io.node;var Ma=m(Io);var Co={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};Co.node;var ae=m(Co);var bo={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};bo.node;var Ra=m(bo);var So={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};So.node;var Je=m(So);var Po={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};Po.node;var ie=m(Po);var yo={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};yo.node;var Qe=m(yo);var wo={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};wo.node;var Ne=m(wo);var vo={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};vo.node;var Fa=m(vo);var ko={name:"corner-down-right",size:24,node:[["path",{d:"m15 10 5 5-5 5",key:"qqa56n"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12",key:"z08zvw"}]]};ko.node;var Ba=m(ko);var Ao={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};Ao.node;var Ee=m(Ao);var Do={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};Do.node;var Le=m(Do);var To={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};To.node;var Ye=m(To);var Mo={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};Mo.node;var Na=m(Mo);var Ro={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};Ro.node;var Ea=m(Ro);var Fo={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};Fo.node;var ue=m(Fo);var Bo={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};Bo.node;var qa=m(Bo);var No={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};No.node;var qe=m(No);var Eo={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};Eo.node;var Ie=m(Eo);var qo={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};qo.node;var ea=m(qo);var Oo={name:"file-type",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M11 18h2",key:"12mj7e"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5",key:"qbrxap"}]]};Oo.node;var Oa=m(Oo);var Ho={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};Ho.node;var Oe=m(Ho);var _o={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};_o.node;var Ha=m(_o);var Uo={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};Uo.node;var aa=m(Uo);var zo={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};zo.node;var _a=m(zo);var Go={name:"funnel",size:24,node:[["path",{d:"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z",key:"sc7q7i"}]],aliases:["filter"]};Go.node;var He=m(Go);var jo={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};jo.node;var Ua=m(jo);var Vo={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};Vo.node;var ta=m(Vo);var $o={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};$o.node;var _e=m($o);var Wo={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};Wo.node;var za=m(Wo);var Xo={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};Xo.node;var Ue=m(Xo);var Ko={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};Ko.node;var oa=m(Ko);var Zo={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};Zo.node;var Ga=m(Zo);var Jo={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};Jo.node;var Ce=m(Jo);var Qo={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};Qo.node;var ja=m(Qo);var Yo={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};Yo.node;var Va=m(Yo);var er={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};er.node;var $a=m(er);var ar={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};ar.node;var ra=m(ar);var tr={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};tr.node;var ce=m(tr);var or={name:"reply",size:24,node:[["path",{d:"M20 18v-2a4 4 0 0 0-4-4H4",key:"5vmcpk"}],["path",{d:"m9 17-5-5 5-5",key:"nvlc11"}]]};or.node;var Wa=m(or);var rr={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};rr.node;var fe=m(rr);var nr={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};nr.node;var Ae=m(nr);var dr={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};dr.node;var Xa=m(dr);var sr={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};sr.node;var Ka=m(sr);var lr={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};lr.node;var Za=m(lr);var ir={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};ir.node;var Ja=m(ir);var ur={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};ur.node;var J=m(ur);var cr={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};cr.node;var Qa=m(cr);var fr={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};fr.node;var Ya=m(fr);var pr={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};pr.node;var oe=m(pr);var mr={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};mr.node;var pe=m(mr);var gr={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};gr.node;var et=m(gr);var xr={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};xr.node;var at=m(xr);var hr={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};hr.node;var ze=m(hr);var Lr={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};Lr.node;var tt=m(Lr);var Ir={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};Ir.node;var Q=m(Ir);var Cr=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];var Lt=4e3;function Gn(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function jn(e){let a=(t,n)=>e(t,n===void 0?void 0:Gn(n)),r=async t=>{await t};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(t={})=>a("list",t),get:t=>a("get",{doc:t}),create:t=>a("create",t),update:(t,n)=>a("update",{doc:t,...n}),remove:t=>r(a("remove",{doc:t})),readFile:(t,n)=>a("readFile",{doc:t,path:n}),renderPage:(t,n)=>a("renderPage",{doc:t,...n}),readPageFile:(t,n)=>a("readPageFile",{doc:t,path:n}),pageLink:(t,n)=>a("pageLink",{doc:t,path:n}),reportRender:(t,n)=>r(a("reportRender",{doc:t,...n})),writeFile:(t,n)=>a("writeFile",{doc:t,...n}),editFile:(t,n)=>a("editFile",{doc:t,...n}),deleteFile:(t,n)=>r(a("deleteFile",{doc:t,path:n})),renameFile:(t,n,d)=>a("renameFile",{doc:t,from:n,to:d}),history:(t,n={})=>a("history",{doc:t,...n}),revision:(t,n)=>a("revision",{doc:t,id:n}),restore:(t,n,d)=>a("restore",{doc:t,id:n,baseRevision:d}),addComment:(t,n)=>a("addComment",{doc:t,...n}),replyToComment:(t,n,d)=>a("replyToComment",{doc:t,id:n,body:d}),setCommentStatus:(t,n,d)=>a("setCommentStatus",{doc:t,id:n,status:d}),deleteComment:(t,n)=>r(a("deleteComment",{doc:t,id:n})),unlinkThread:(t,n)=>r(a("unlinkThread",{doc:t,threadId:n})),askAgent:(t,n)=>a("askAgent",{doc:t,...n,path:n.path??void 0})}}function _(){let e=ao();return X(()=>jn((a,r)=>e.call(a,r)),[e])}function O(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function br(e){return/changed since revision/i.test(O(e))}function Sr(e){return/^design doc .* not found/i.test(e)}function M(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var Pr="design-docs";var yr="changed",It=["draft","review","approved","implemented","archived"],ot={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function wr(e,a){let r=t=>t.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Ge(e,a){let[r,t]=C({key:e,data:null,error:null,loading:e!==null}),[n,d]=C(0),i=D(a);i.current=a,B(()=>{if(e===null){t({key:e,data:null,error:null,loading:!1});return}let u=!1;return t(c=>({key:e,data:c.key===e?c.data:null,error:null,loading:!0})),i.current().then(c=>{u||t({key:e,data:c,error:null,loading:!1})},c=>{u||t(x=>({key:e,data:x.key===e?x.data:null,error:O(c),loading:!1}))}),()=>{u=!0}},[e,n]);let l=he(()=>d(u=>u+1),[]),f=r.key===e;return{data:f?r.data:null,error:f?r.error:null,loading:f?r.loading:e!==null,reload:l}}function kr(e,a=120){let r=D(e);r.current=e;let t=D(new Set),n=D(null);B(()=>()=>{n.current&&clearTimeout(n.current)},[]),to(yr,d=>{let i=typeof d?.docId=="string"?d.docId:null;t.current.add(i),!n.current&&(n.current=setTimeout(()=>{n.current=null;let l=[...t.current];t.current.clear();for(let f of l)r.current(f)},a))})}function Ct(e){let a=_(),r=Ge(JSON.stringify(e),()=>a.list(e));return kr(()=>r.reload()),r}function bt(e){let a=_(),r=Ge(e,()=>a.get(e));return kr(t=>{(t===null||t===e)&&r.reload()}),r}function Ar(e,a,r){let t=_(),n=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Ge(n,()=>t.readFile(e,a))}function Rt(){let e=_();return Ge("templates",()=>e.templates())}function je(){let e=_();return Ge("projects",()=>e.projects())}var vr="zcc.design-docs.";function te(e,a){let[r,t]=C(()=>{try{let d=globalThis.localStorage?.getItem(vr+e);if(d==null)return a;let i=JSON.parse(d);return typeof i==typeof a?i:a}catch{return a}}),n=he(d=>{t(d);try{globalThis.localStorage?.setItem(vr+e,JSON.stringify(d))}catch{}},[e]);return[r,n]}function Dr(e){let[a,r]=C(null),[t,n]=C(null);return ht(()=>{if(!a)return;let d=l=>n(l>0?e.filter(f=>l>=f).length:null);if(d(a.getBoundingClientRect().width),typeof ResizeObserver>"u")return;let i=new ResizeObserver(l=>d(l[0]?.contentRect.width??0));return i.observe(a),()=>i.disconnect()},[a,e]),[r,t]}function xa(e=6e4){let[a,r]=C(()=>Date.now());return B(()=>{let t=setInterval(()=>r(Date.now()),e);return()=>clearInterval(t)},[e]),a}function na(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function Tr(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let t=Math.round(r/60);if(t<60)return`${t}m ago`;let n=Math.round(t/60);if(n<24)return`${n}h ago`;let d=Math.round(n/24);return d<30?`${d}d ago`:new Date(e).toISOString().slice(0,10)}var Mr=globalThis.__ZCC_HOST_REACT__,$=Mr.Fragment;function o(e,a,r){return Mr.createElement(e,r===void 0?a:{...a,key:r})}var s=o;var Vn={MessageSquareText:Ga,CheckCheck:Ra,WandSparkles:ze,Workflow:tt,ScanSearch:Ka,ListChecks:za};function Rr(e){return Vn[e]??J}function ha({kind:e,size:a=14}){return o(e==="image"||e==="svg"?qa:e==="font"?Oa:e==="markdown"||e==="text"?ea:Ea,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function Ve({status:e,compact:a=!1}){return s("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[o("span",{className:"dd-status-dot","aria-hidden":!0}),ot[e]]})}function se({actor:e}){let a=e.kind==="agent"?ae:at;return s("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[o(a,{size:12,"aria-hidden":!0}),o("span",{className:"dd-actor-label",children:e.label})]})}function Y({at:e,now:a}){return o("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:Tr(e,a)})}function V({size:e=14,label:a}){return o("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:o(Ue,{size:e,className:"dd-spin","aria-hidden":!0})})}function me({icon:e,title:a,children:r}){return s("div",{className:"dd-empty",children:[o("span",{className:"dd-empty-icon",children:o(e,{size:22,"aria-hidden":!0})}),o("div",{className:"dd-empty-title",children:a}),r?o("div",{className:"dd-empty-body",children:r}):null]})}function U({icon:e,label:a,onClick:r,active:t=!1,danger:n=!1,disabled:d=!1,size:i=14}){return o("button",{type:"button",className:`icon-btn dd-icon-btn${t?" on":""}${n?" danger":""}`,title:a,"aria-label":a,"aria-pressed":t||void 0,disabled:d,onClick:r,children:o(e,{size:i,"aria-hidden":!0})})}function Fr(e,a){let r=D(null),t=D(a);return t.current=a,B(()=>{if(!e)return;let n=i=>{r.current&&i.target instanceof Node&&!r.current.contains(i.target)&&t.current()},d=i=>{i.key==="Escape"&&t.current()};return document.addEventListener("mousedown",n),document.addEventListener("keydown",d),()=>{document.removeEventListener("mousedown",n),document.removeEventListener("keydown",d)}},[e]),r}function re({open:e,onClose:a,anchor:r,children:t,align:n="end",className:d=""}){let i=Fr(e,a);return s("div",{className:"dd-pop-anchor",ref:i,children:[r,e?o("div",{className:`dd-pop dd-pop-${n} ${d}`,role:"dialog",children:t}):null]})}function Br(e){if(e.clientX||e.clientY)return{x:e.clientX,y:e.clientY};let a=e.currentTarget.getBoundingClientRect();return{x:a.left+12,y:a.bottom}}var St=4;function Nr({at:e,label:a,onClose:r,children:t}){let n=Fr(!0,r),d=D(r);d.current=r;let[i,l]=C(e);ht(()=>{let u=n.current,{width:c,height:x}=u.getBoundingClientRect();l({x:Math.max(St,Math.min(e.x,window.innerWidth-c-St)),y:Math.max(St,Math.min(e.y,window.innerHeight-x-St))})},[n,e.x,e.y]),B(()=>{let u=document.activeElement instanceof HTMLElement?document.activeElement:null;n.current?.querySelector('[role="menuitem"]')?.focus();let c=x=>{x.target instanceof Node&&n.current?.contains(x.target)||d.current()};return window.addEventListener("scroll",c,!0),window.addEventListener("resize",c),window.addEventListener("blur",c),()=>{window.removeEventListener("scroll",c,!0),window.removeEventListener("resize",c),window.removeEventListener("blur",c),u?.isConnected&&(document.activeElement===document.body||n.current?.contains(document.activeElement))&&u.focus()}},[n]);let f=u=>{let c=[...u.currentTarget.querySelectorAll('[role="menuitem"]')],x=c.indexOf(document.activeElement),L=u.key==="ArrowDown"?(x+1)%c.length:u.key==="ArrowUp"?(x-1+c.length)%c.length:u.key==="Home"?0:u.key==="End"?c.length-1:-1;u.key==="Tab"&&r(),!(L<0||!c.length)&&(u.preventDefault(),c[L].focus())};return o("div",{ref:n,className:"dd-pop dd-menu dd-context-menu",role:"menu","aria-label":a,style:{left:i.x,top:i.y},onKeyDown:f,onContextMenu:u=>u.preventDefault(),children:t})}function ee({icon:e,label:a,hint:r,onSelect:t,danger:n=!1,checked:d=!1}){return s("button",{type:"button",role:"menuitem",className:`dd-menu-item${n?" dd-menu-danger":""}${d?" dd-menu-checked":""}`,onClick:t,children:[e?o(e,{size:14,"aria-hidden":!0}):null,o("span",{className:"dd-menu-label",children:a}),r?o("span",{className:"dd-menu-hint",children:r}):null]})}function be({request:e,onClose:a}){let[r,t]=C(!1),n=async()=>{t(!0);try{await e.run()}finally{t(!1),a()}};return o(rt,{title:e.title,onClose:a,footer:s($,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{n()},autoFocus:!0,children:e.confirmLabel})]}),children:o("div",{className:"dd-confirm-body",children:e.body})})}function rt({title:e,onClose:a,children:r,footer:t,wide:n=!1}){return B(()=>{let d=i=>{i.key==="Escape"&&a()};return document.addEventListener("keydown",d),()=>document.removeEventListener("keydown",d)},[a]),o("div",{className:"dd-dialog-backdrop",onMouseDown:d=>{d.target===d.currentTarget&&a()},children:s("div",{className:`dd-dialog${n?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[s("div",{className:"dd-dialog-header",children:[o("span",{className:"dd-dialog-title",children:e}),o(U,{icon:Q,label:"Close",onClick:a})]}),o("div",{className:"dd-dialog-body",children:r}),t?o("div",{className:"dd-dialog-footer",children:t}):null]})})}var $n={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},$e="design-doc";function Er({doc:e,now:a}){let r=_(),t=ke(),n=[...e.threads].sort((d,i)=>i.lastActivityAt-d.lastActivityAt);return o("div",{className:"dd-rail-pane dd-agents",children:s("div",{className:"dd-rail-scroll",children:[n.length?o("ul",{className:"dd-thread-list",children:n.map(d=>s("li",{className:"dd-thread",children:[s("button",{type:"button",className:"dd-thread-open",onClick:()=>t.toThread(d.threadId),title:"Open thread",children:[o(ae,{size:14,"aria-hidden":!0}),s("span",{className:"dd-thread-main",children:[o("span",{className:"dd-thread-title",children:d.title}),s("span",{className:"dd-thread-meta",children:[o("span",{className:`dd-role dd-role-${d.role}`,children:$n[d.role]}),o(Y,{at:d.lastActivityAt,now:a})]})]})]}),o(U,{icon:et,label:"Unlink thread",size:13,onClick:()=>{r.unlinkThread(e.id,d.threadId).catch(i=>M(`Could not unlink: ${O(i)}`,"error"))}})]},d.threadId))}):s(me,{icon:ae,title:"No agents yet",children:["Use ",o("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),s("div",{className:"dd-agents-hint",children:[o(Ma,{size:13,"aria-hidden":!0}),s("span",{children:["Agents in this project already know this doc exists. Type ",o("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",o("code",{children:"design_doc_read"}),"."]})]})]})})}function qr({doc:e,activePath:a,request:r,contextProjectId:t,compact:n=!1}){let d=_(),i=ke(),[l,f]=C(!1),[u,c]=C(""),[x,L]=C(!1),[S,h]=C(t??""),[b,w]=C(null),q=je(),N=D(null),E=!e.projectId,A=q.data??[],R=E?S||A[0]?.id||"":e.projectId;B(()=>{r&&(c(r.prompt),L(!0),f(!0),requestAnimationFrame(()=>{let p=N.current;p&&(p.focus(),p.selectionStart=p.selectionEnd=p.value.length)}))},[r]),B(()=>{l&&L(p=>p||!!a&&a!==e.entryPath)},[l,a,e.entryPath]);let v=async p=>{if(!b){if(E&&!R){M("Add a project first: agents run inside a project.","error");return}w(p??"custom");try{let y=await d.askAgent(e.id,{...p?{action:p}:{},...u.trim()&&!p?{prompt:u.trim()}:{},path:x?a:null,...E?{projectId:R}:{}});i.openThreadPanel({actionId:$e,title:e.title,params:{docId:e.id},threadId:y.threadId}),i.toThread(y.threadId),M(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),f(!1),c("")}catch(y){M(`Could not start the agent: ${O(y)}`,"error")}finally{w(null)}}},T=p=>{p.key==="Enter"&&(p.metaKey||p.ctrlKey)&&(p.preventDefault(),u.trim()&&v(null))};return s(re,{open:l,onClose:()=>f(!1),className:"dd-ask",anchor:s("button",{type:"button",className:`btn primary dd-ask-trigger${n?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":l,onClick:()=>f(!l),children:[o(J,{size:13,"aria-hidden":!0}),n?null:"Ask agent",o(ie,{size:12,"aria-hidden":!0})]}),children:[s("div",{className:"dd-ask-head",children:[o("span",{className:"dd-ask-title",children:"Ask an agent"}),o("span",{className:"dd-muted",children:"Starts a new thread that edits this doc live"})]}),o("div",{className:"dd-ask-actions",role:"menu",children:Cr.map(p=>{let y=Rr(p.icon);return s("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!b,onClick:()=>{v(p.id)},title:p.description,children:[o("span",{className:"dd-ask-action-icon",children:b===p.id?o(V,{size:13}):o(y,{size:14,"aria-hidden":!0})}),s("span",{className:"dd-ask-action-text",children:[o("span",{className:"dd-ask-action-label",children:p.label}),o("span",{className:"dd-ask-action-desc",children:p.description})]})]},p.id)})}),s("div",{className:"dd-ask-custom",children:[o("textarea",{ref:N,className:"dd-input",rows:3,maxLength:Lt,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:u,onChange:p=>c(p.target.value),onKeyDown:T}),s("div",{className:"dd-ask-options",children:[a?s("label",{className:"dd-check",children:[o("input",{type:"checkbox",checked:x,onChange:p=>L(p.target.checked)}),"Focus on ",o("code",{children:a})]}):null,E?s("label",{className:"dd-field-inline",children:["Run in",s("select",{className:"dd-input dd-select",value:R,onChange:p=>h(p.target.value),children:[A.length?null:o("option",{value:"",children:"No projects"}),A.map(p=>o("option",{value:p.id,children:p.name},p.id))]})]}):null,o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",disabled:!u.trim()||!!b,onClick:()=>{v(null)},children:[b==="custom"?o(V,{size:12}):null,"Start"]})]})]})]})}var Wn=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),Xn=/[A-Za-z][^\t\n\f\r />]*/y,Kn=/[\t\n\f\r /]*/y,Or=/[\t\n\f\r ]*/y,Zn=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,Jn=/[^\t\n\f\r >]*/y,Qn={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function Yn(e){return e.includes("&")?e.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(a,r,t,n)=>{if(n)return Qn[n.toLowerCase()]??a;let d=r?Number(r):parseInt(t,16);return d>0&&d<=1114111?String.fromCodePoint(d):a}):e}function Hr(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function La(e,a,r){return e.lastIndex=r,e.exec(a)?.[0]??""}function ed(e,a){let r=La(Xn,e,a+1),t=a+1+r.length,n=[];for(;t<e.length;){let d=La(Kn,e,t);if(t+=d.length,t>=e.length)return null;if(e[t]===">")return{name:r.toLowerCase(),attributes:n,selfClosing:d.endsWith("/"),start:a,end:t+1};let i=La(Zn,e,t)||e[t];t+=i.length,t+=La(Or,e,t).length;let l=null;if(e[t]==="="){t+=1,t+=La(Or,e,t).length;let f=e[t];if(f==='"'||f==="'"){let u=e.indexOf(f,t+1);if(u<0)return null;l=e.slice(t+1,u),t=u+1}else l=La(Jn,e,t),t+=l.length}n.push({name:i.toLowerCase(),value:l===null?null:Yn(l)})}return null}function*ad(e){let a=0;for(;a<e.length;){let r=e.indexOf("<",a);if(r<0)return;let t=e[r+1]??"";if(e.startsWith("<!--",r)){let d=e.indexOf("-->",r+4);a=d<0?e.length:d+3;continue}if(t==="!"||t==="?"||t==="/"&&/[A-Za-z]/.test(e[r+2]??"")){let d=e.indexOf(">",r+2);a=d<0?e.length:d+1;continue}if(!/[A-Za-z]/.test(t)){a=r+1;continue}let n=ed(e,r);if(!n)return;if(a=n.end,Wn.has(n.name)){let d=new RegExp(`</${n.name}(?=[\\t\\n\\f\\r />])`,"ig");d.lastIndex=n.end;let i=d.exec(e),l=i?i.index:e.length,f=i?e.indexOf(">",l):-1,u=f<0?e.length:f+1;yield{...n,content:{start:n.end,end:l,closeEnd:u}},a=u;continue}yield n}}function Pt(e,a){let r=-1;for(let n of ad(e)){if(n.name==="head")return e.slice(0,n.end)+a+e.slice(n.end);if(n.name==="html"){r=n.end;continue}break}if(r>=0)return e.slice(0,r)+a+e.slice(r);let t=e.match(/^\s*<!doctype[^>]*>/i);return t?t[0]+a+e.slice(t[0].length):a+e}function nt(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var td={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},od={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"};var _r={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function da(e){let a=nt(e),r=td[a];return r||(_r[a]?"code":"text")}function Ur(e){return _r[nt(e)]??""}function De(e){return e==="image"||e==="font"}function zr(e){return od[nt(e)]??null}var rd=/^[a-z][a-z0-9+.-]*:/i;function dt(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||rd.test(r))return null;let t=r.split(/[?#]/,1)[0],n=t;try{n=decodeURIComponent(t)}catch{}let d=n.startsWith("/")?[]:e.split("/").slice(0,-1);for(let i of n.split("/"))if(!(!i||i===".")){if(i===".."){if(!d.length)return null;d.pop();continue}d.push(i)}return d.length?d.join("/"):null}function Gr(e,a){let r=e.split("/"),t=a.split("/"),n=Math.min(r.length,t.length);for(let d=0;d<n;d+=1){let i=d===r.length-1,l=d===t.length-1;if(r[d]!==t[d])return i!==l?i?-1:1:r[d].localeCompare(t[d],void 0,{sensitivity:"base",numeric:!0})}return r.length-t.length}function Ft(e){let a=(e??"").split("/").filter(Boolean),[r,...t]=a;return{docId:r??null,path:t.length?t.join("/"):null}}function Ia(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}function nd(e){let a=new TextEncoder().encode(e),r="";for(let t=0;t<a.length;t+=32768)r+=String.fromCharCode(...a.subarray(t,t+32768));return btoa(r)}function Bt(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${nd(e.content)}`;let a=zr(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var jr=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;function Vr(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function $r(e,a){let r=new Set;for(let t of a.matchAll(jr)){let n=dt(e,Vr(t[2]));n&&r.add(n)}return[...r]}function Wr(e,a,r){return r.size?a.replace(jr,(t,n,d,i="")=>{let l=dt(e,Vr(d)),f=l?r.get(l):void 0;return f?`${n}${f}${i})`:t}):a}function Nt(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(n=>n[0].length)),t="`".repeat(Math.max(3,r+1));return`${t}${a}
${e.replace(/\n$/,"")}
${t}`}function Xr(e,a){return Nt(a,Ur(e))}var dd=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function Kr(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let n of dd){let d=r.getPropertyValue(n).trim();d&&(a[n]=d)}let t=r.getPropertyValue("color-scheme").trim();return t&&(a["color-scheme"]=t),a}var sd=/^[^<>{};]*$/;function Zr(e,a){let t=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>sd.test(n)).map(([n,d])=>`${n}: ${d};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;return Pt(e,t)}function Jr(e){let a=[],r=new Map;for(let t of[...e].sort((n,d)=>Gr(n.path,d.path))){let n=t.path.split("/"),d=a;for(let i=0;i<n.length-1;i+=1){let l=n.slice(0,i+1).join("/"),f=r.get(l);f||(f={kind:"folder",name:n[i],path:l,children:[]},r.set(l,f),d.push(f)),d=f.children}d.push({kind:"file",name:n.at(-1),path:t.path,file:t})}return a}var Yr=e=>e.key==="Enter"&&(e.metaKey||e.ctrlKey);function ld({onSend:e,onCancel:a}){let[r,t]=C(""),[n,d]=C(!1),i=async()=>{let l=r.trim();if(!l||n)return;d(!0);let f=await e(l);d(!1),f&&t("")};return s("div",{className:"dd-reply-composer",children:[o("textarea",{className:"dd-input dd-composer-input",placeholder:"Reply\u2026 agents see the whole thread","aria-label":"Reply",value:r,maxLength:8e3,rows:2,autoFocus:!0,onChange:l=>t(l.target.value),onKeyDown:l=>{Yr(l)?(l.preventDefault(),i()):l.key==="Escape"&&(l.preventDefault(),a())}}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send \xB7 Esc to cancel"}),s("span",{className:"dd-reply-buttons",children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:!r.trim()||n,onClick:()=>{i()},children:"Reply"})]})]})]})}function id({comment:e,fileGone:a,now:r,onToggle:t,onDelete:n,onDeleteReply:d,onReply:i,onFocus:l}){let f=e.status==="resolved",[u,c]=C(!1);return s("article",{className:`dd-comment${f?" dd-comment-resolved":""}`,children:[s("header",{className:"dd-comment-head",children:[o(se,{actor:e.author}),o(Y,{at:e.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(U,{icon:Wa,label:"Reply",onClick:()=>c(!0),size:13}),o(U,{icon:f?Ae:Je,label:f?"Reopen":"Resolve",onClick:t,size:13}),o(U,{icon:oe,label:"Delete comment",onClick:n,danger:!0,size:13})]}),e.path||e.quote?s("button",{type:"button",className:"dd-comment-anchor",onClick:l,disabled:!l,title:a?"This file was deleted":"Show in the document",children:[e.path?s("span",{className:`dd-comment-path${a?" dd-comment-path-gone":""}`,children:[e.path,a?" (deleted)":""]}):null,e.quote?o("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,o("div",{className:"dd-comment-body",children:o(va,{content:e.body})}),e.replies.length?o("ol",{className:"dd-replies","aria-label":"Replies",children:e.replies.map(x=>s("li",{className:"dd-reply",children:[s("header",{className:"dd-comment-head",children:[o(se,{actor:x.author}),o(Y,{at:x.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(U,{icon:oe,label:"Delete reply",onClick:()=>d(x.id),danger:!0,size:12})]}),o("div",{className:"dd-comment-body",children:o(va,{content:x.body})})]},x.id))}):null,u?o(ld,{onCancel:()=>c(!1),onSend:async x=>{let L=await i(x);return L&&c(!1),L}}):null]})}function en({doc:e,activePath:a,now:r,pendingQuote:t,onClearQuote:n,draft:d,onDraft:i,onFocusComment:l}){let f=_(),[u,c]=te("comments-scope","all"),[x,L]=C(!1),[S,h]=C(!1),[b,w]=C(null),q=D(null);B(()=>{t&&q.current?.focus()},[t]);let N=X(()=>e.comments.filter(P=>u==="all"||!P.path||P.path===a),[e.comments,u,a]),E=N.filter(P=>P.status==="open"),A=N.filter(P=>P.status==="resolved"),R=async(P,z)=>{try{return await P(),!0}catch(Z){return M(`${z}: ${O(Z)}`,"error"),!1}},v=t?t.path:a,T=async()=>{let P=d.trim();if(!(!P||S)){h(!0);try{await f.addComment(e.id,{body:P,...v?{path:v}:{},...t?{quote:t.text}:{}}),i(""),n()}catch(z){M(`Could not add the comment: ${O(z)}`,"error")}finally{h(!1)}}},p=P=>{Yr(P)&&(P.preventDefault(),T())},y=X(()=>new Set(e.files.map(P=>P.path)),[e.files]),g=P=>{let z=!!P.path&&!y.has(P.path);return o(id,{comment:P,fileGone:z,now:r,onToggle:()=>{R(()=>f.setCommentStatus(e.id,P.id,P.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>w({title:"Delete comment",body:P.replies.length?`Delete this comment and its ${P.replies.length===1?"reply":`${P.replies.length} replies`}? This cannot be undone.`:"Delete this comment? This cannot be undone.",confirmLabel:"Delete",danger:!0,run:()=>{R(()=>f.deleteComment(e.id,P.id),"Could not delete the comment")}}),onDeleteReply:Z=>{R(()=>f.deleteComment(e.id,Z),"Could not delete the reply")},onReply:Z=>R(()=>f.replyToComment(e.id,P.id,Z),"Could not reply"),onFocus:!z&&(P.quote||P.path)?()=>l(P):void 0},P.id)};return s("div",{className:"dd-rail-pane dd-comments",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[o("button",{type:"button",className:u==="all"?"on":"",onClick:()=>c("all"),children:"All files"}),o("button",{type:"button",className:u==="file"?"on":"",onClick:()=>c("file"),disabled:!a,children:"This file"})]})}),s("div",{className:"dd-rail-scroll",children:[E.length===0?o(me,{icon:Ce,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):E.map(g),A.length?s("div",{className:"dd-resolved",children:[s("button",{type:"button",className:"dd-disclosure",onClick:()=>L(!x),children:[x?o(ie,{size:13,"aria-hidden":!0}):o(Qe,{size:13,"aria-hidden":!0}),"Resolved (",A.length,")"]}),x?A.map(g):null]}):null]}),s("div",{className:"dd-composer",children:[t?s("div",{className:"dd-composer-quote",children:[o("span",{className:"dd-comment-quote",children:t.text}),o(U,{icon:Q,label:"Remove quote",onClick:n,size:12})]}):null,o("textarea",{ref:q,className:"dd-input dd-composer-input",placeholder:v?`Comment on ${v}\u2026 agents see open comments`:"Leave a comment\u2026",value:d,maxLength:8e3,rows:3,onChange:P=>i(P.target.value),onKeyDown:p}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),o("button",{type:"button",className:"btn primary",disabled:!d.trim()||S,onClick:()=>{T()},children:"Comment"})]})]}),b?o(be,{request:b,onClose:()=>w(null)}):null]})}function ud({doc:e,projects:a,onClose:r,onMove:t}){let[n,d]=C(e.projectId??"");return s(rt,{title:"Move design doc",onClose:r,footer:s($,{children:[o("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.projectId??""),onClick:()=>{t(n||null).then(r)},children:"Move"})]}),children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:n,onChange:i=>d(i.target.value),children:[o("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(i=>o("option",{value:i.id,children:i.name},i.id))]})]}),o("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}async function an(e,a){try{await navigator.clipboard.writeText(e),M(`Copied ${a}`)}catch{M(`Could not copy ${a}`,"error")}}function yt(e){let a=_(),[r,t]=C(null),[n,d]=C(null),i=async(u,c)=>{try{await a.update(u.id,c)}catch(x){M(`Could not update the doc: ${O(x)}`,"error")}};return{items:(u,c,x,L)=>{let S=u.status==="archived",h=b=>()=>{c(),b()};return s($,{children:[L?o(ee,{icon:aa,label:"Open",onSelect:h(L)}):null,o(ee,{icon:Fa,label:"Copy chat reference",hint:"Paste into any thread",onSelect:h(()=>{an(wr(u.id),"reference")})}),o(ee,{icon:ta,label:"Copy id",hint:u.slug,onSelect:h(()=>{an(u.id,"id")})}),o(ee,{icon:Ha,label:"Move to project\u2026",onSelect:h(()=>t(u))}),o(ee,{icon:S?Aa:Da,label:S?"Unarchive":"Archive",onSelect:h(()=>{i(u,{status:S?"draft":"archived"})})}),o(ee,{icon:oe,label:"Delete\u2026",danger:!0,onSelect:h(()=>d({title:"Delete design doc",body:s($,{children:["Delete ",o("strong",{children:u.title})," with its ",u.fileCount," file",u.fileCount===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await a.remove(u.id),M(`Deleted \u201C${u.title}\u201D`),x()}catch(b){M(`Could not delete: ${O(b)}`,"error")}}}))})]})},dialogs:s($,{children:[r?o(ud,{doc:r,projects:e,onClose:()=>t(null),onMove:u=>i(r,{projectId:u})}):null,n?o(be,{request:n,onClose:()=>d(null)}):null]})}}function on({value:e,placeholder:a,maxLength:r,multiline:t=!1,className:n="",label:d,onSave:i}){let[l,f]=C(!1),[u,c]=C(e),x=D(!1);B(()=>{l||c(e)},[e,l]);let L=async h=>{if(x.current)return;x.current=!0,f(!1);let b=u.trim();if(h&&b!==e.trim())try{await i(b)}catch{c(e)}else c(e)},S=h=>{h.key==="Escape"?(h.preventDefault(),L(!1)):h.key==="Enter"&&(!t||h.metaKey||h.ctrlKey||!h.shiftKey)&&(h.preventDefault(),L(!0))};if(l){let h={className:`dd-editable-input ${n}`,value:u,maxLength:r,"aria-label":d,autoFocus:!0,onChange:b=>c(b.target.value),onKeyDown:S,onBlur:()=>{L(!0)}};return t?o("textarea",{...h,rows:2,placeholder:a}):o("input",{...h,placeholder:a})}return o("button",{type:"button",className:`dd-editable ${n}${e?"":" dd-editable-empty"}`,title:`Edit ${d.toLowerCase()}`,onClick:()=>{x.current=!1,f(!0)},children:e||a})}function fd({tags:e,onChange:a}){let[r,t]=C(!1),[n,d]=C(""),i=()=>{let l=n.split(",").map(u=>u.trim().toLowerCase().slice(0,32)).filter(Boolean);d(""),t(!1);let f=[...new Set([...e,...l])].slice(0,12);f.length!==e.length&&a(f)};return s("span",{className:"dd-tags",children:[e.map(l=>s("span",{className:"dd-tag",children:[o(ta,{size:10,"aria-hidden":!0}),l,o("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${l}`,onClick:()=>a(e.filter(f=>f!==l)),children:o(Q,{size:10,"aria-hidden":!0})})]},l)),r?o("input",{className:"dd-input dd-tag-input",value:n,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:l=>d(l.target.value),onBlur:i,onKeyDown:l=>{l.key==="Enter"?(l.preventDefault(),i()):l.key==="Escape"&&(d(""),t(!1))}}):e.length<12?s("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>t(!0),children:[o(ce,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function pd({status:e,onChange:a}){let[r,t]=C(!1);return o(re,{open:r,onClose:()=>t(!1),align:"start",className:"dd-menu",anchor:o("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>t(!r),title:"Change status",children:o(Ve,{status:e})}),children:It.map(n=>o(ee,{label:o(Ve,{status:n}),checked:n===e,icon:n===e?Je:void 0,onSelect:()=>{t(!1),n!==e&&a(n)}},n))})}function rn({doc:e,projects:a,compact:r,actions:t,onDeleted:n}){let d=_(),[i,l]=C(!1),f=yt(a),u=e.projectId?a.find(x=>x.id===e.projectId):null,c=async x=>{try{await d.update(e.id,x)}catch(L){throw M(`Could not update the doc: ${O(L)}`,"error"),L}};return s("header",{className:`dd-doc-header${r?" dd-doc-header-compact":""}`,children:[s("div",{className:"dd-doc-title-row",children:[o(on,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:x=>x?c({title:x}):void 0}),o("span",{className:"dd-spacer"}),t,o(re,{open:i,onClose:()=>l(!1),className:"dd-menu",anchor:o(U,{icon:Le,label:"More actions",active:i,onClick:()=>l(!i)}),children:f.items(e,()=>l(!1),n)})]}),r?null:o(on,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:x=>c({summary:x})}),s("div",{className:"dd-doc-meta",children:[o(pd,{status:e.status,onChange:x=>{c({status:x}).catch(()=>{})}}),s("span",{className:"dd-doc-project",title:u?`Project \xB7 ${u.name}`:"Visible to agents in every project",children:[u?null:o(Ua,{size:12,"aria-hidden":!0}),u?u.name:e.projectId?"Unknown project":"Global"]}),r?null:o(fd,{tags:e.tags,onChange:x=>{c({tags:x}).catch(()=>{})}}),o("span",{className:"dd-spacer"}),s("span",{className:"dd-doc-updated",children:[o(se,{actor:e.updatedBy})," ",o(Y,{at:e.updatedAt,now:Date.now()})]})]}),f.dialogs]})}function nn({docId:e,file:a,removed:r=!1,split:t,renderPreview:n,onStateChange:d,onSaved:i}){let l=_(),[f,u]=C(a.content),[c,x]=C({content:a.content,revision:a.revision}),[L,S]=C(!1),[h,b]=C(null),w=f!==c.content,q=no(f),N=D({dirty:w,draft:f,saved:c});N.current={dirty:w,draft:f,saved:c},B(()=>{let{dirty:v,draft:T,saved:p}=N.current;a.revision!==p.revision&&(!v||a.content===T?(u(a.content),x({content:a.content,revision:a.revision}),b(null)):b({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),B(()=>{d?.({dirty:w,saving:L})},[w,L,d]);let E=he(async v=>{if(!L){S(!0);try{let T=v??(r?0:c.revision),p=await l.writeFile(e,{path:a.path,content:f,baseRevision:T});x({content:f,revision:p.revision}),b(null),i?.(p)}catch(T){if(br(T)){let p=await l.readFile(e,a.path).catch(()=>null);b({revision:p?.revision??c.revision+1,by:p?.updatedBy??a.updatedBy})}else M(`Could not save ${a.path}: ${O(T)}`,"error")}finally{S(!1)}}},[l,e,f,a.path,a.updatedBy,i,r,c.revision,L]),A=async()=>{try{let v=await l.readFile(e,a.path);u(v.content),x({content:v.content,revision:v.revision}),b(null)}catch(v){M(`Could not reload ${a.path}: ${O(v)}`,"error")}},R=v=>{if((v.metaKey||v.ctrlKey)&&v.key.toLowerCase()==="s"){v.preventDefault(),w&&!h&&E();return}if(v.key==="Tab"&&!v.metaKey&&!v.ctrlKey&&!v.altKey){v.preventDefault();let T=v.currentTarget,{selectionStart:p,selectionEnd:y,value:g}=T,P=`${g.slice(0,p)}  ${g.slice(y)}`;u(P),requestAnimationFrame(()=>{T.selectionStart=T.selectionEnd=p+2})}};return s("div",{className:"dd-editor",children:[r&&w&&!h?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(ue,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[a.path," was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them."]})]}):null,h?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(pe,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o(se,{actor:h.by})," saved revision ",h.revision," while you were editing."]}),s("button",{type:"button",className:"btn",onClick:()=>{A()},children:[o(Ae,{size:12,"aria-hidden":!0})," Discard mine"]}),o("button",{type:"button",className:"btn",onClick:()=>{E(h.revision)},children:"Overwrite with mine"})]}):null,s("div",{className:`dd-editor-body${t?" dd-editor-split":""}`,children:[o("textarea",{className:"dd-editor-input",value:f,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:v=>u(v.target.value),onKeyDown:R,autoFocus:!0}),t?o("div",{className:"dd-editor-preview",children:n(q)}):null]}),s("div",{className:"dd-editor-footer",children:[s("span",{className:"dd-editor-state",children:[L?o(V,{size:12,label:"Saving"}):null,L?"Saving\u2026":w?"Unsaved changes":`Saved \xB7 rev ${c.revision}`]}),o("span",{className:"dd-editor-hint",children:"\u2318S to save"}),o("button",{type:"button",className:"btn",disabled:!w||L,onClick:()=>u(c.content),children:"Revert"}),s("button",{type:"button",className:"btn primary",disabled:!w||L||!!h,onClick:()=>{E()},children:[o(Xa,{size:12,"aria-hidden":!0})," Save"]})]})]})}var wt="dd-comment",vt="dd-comment-focus";function md(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}var gd=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE"]);function xd(e){let a=e.ownerDocument.createTreeWalker(e,4,{acceptNode:f=>gd.has(f.parentElement?.tagName.toUpperCase()??"")?2:1}),r=[],t=[],n="";for(let f=a.nextNode();f;f=a.nextNode())t.push(n.length),r.push(f),n+=f.data;let d="",i=[],l=!0;for(let f=0;f<n.length;f+=1){let u=n[f];/\s/.test(u)?(l||(d+=" ",i.push(f)),l=!0):(d+=u,i.push(f),l=!1)}return{nodes:r,starts:t,normalized:d,map:i}}function dn(e,a){let r=0,t=e.starts.length-1;for(;r<t;){let n=r+t+1>>1;e.starts[n]<=a?r=n:t=n-1}return[e.nodes[r],a-e.starts[r]]}function Ot(e,a){let r=new Map;if(!a.length)return r;let t=xd(e);if(!t.nodes.length)return r;for(let n of a){if(r.has(n))continue;let d="",i=-1;for(let L of new Set([n.replace(/\s+/g," ").trim(),md(n)]))if(!(L.length<2)&&(i=t.normalized.indexOf(L),i>=0)){d=L;break}if(i<0)continue;let[l,f]=dn(t,t.map[i]),[u,c]=dn(t,t.map[i+d.length-1]),x=e.ownerDocument.createRange();x.setStart(l,f),x.setEnd(u,c+1),r.set(n,x)}return r}function hd(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var sn=new Map;function sa(e,a,r){let t=hd();if(!t)return;let n=sn.get(e)??new Map;sn.set(e,n),r.length?n.set(a,r):n.delete(a);let d=[...n.values()].flat();d.length?t.registry.set(e,new t.Highlight(...d)):t.registry.delete(e)}var un="dd-page";var Ld="dd-page-hello",cn=50,Id=256*1024,_t=1e3,Ht=4e3,Cd=500,bd=500,Sd=new Set(["error","missing","blocked"]);function lt(e){return e&&typeof e=="object"&&!Array.isArray(e)?e:null}function Ca(e,a){return typeof e=="string"&&e.length<=a?e:null}function Ut(e,a){return typeof e=="string"?e.slice(0,a):null}function kt(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function ln(e){return!Array.isArray(e)||e.length>bd?null:e.every(a=>typeof a=="string"&&a.length<=500)?e:null}function Pd(e){if(e===null)return null;let a=lt(e);if(!a)return;let[r,t,n,d]=[a.top,a.left,a.bottom,a.right].map(kt);return r===null||t===null||n===null||d===null?void 0:{top:r,left:t,bottom:n,right:d}}function yd(e){let a=lt(e);if(!a)return null;let r=0;for(let[t,n]of Object.entries(a))if(typeof n!="string"||(r+=t.length+n.length,r>Id))return null;return{...a}}function wd(e){let a=lt(e),r=a?.kind,t=Ut(a?.message,Cd);if(!a||!Sd.has(r)||!t)return null;let n=Ut(a.source,_t),d=kt(a.line);return{kind:r,message:t,...n?{source:n}:{},...d!==null&&d>0?{line:Math.floor(d)}:{}}}function fn(e){let a=lt(e);if(!a)return null;switch(a.type){case"ready":return{type:"ready"};case"fetch":{let r=Ca(a.path,_t);return Number.isSafeInteger(a.id)&&a.id>=0&&r!==null?{type:"fetch",id:a.id,path:r}:null}case"navigate":{let r=Ca(a.path,_t),t=a.hash===null?null:Ca(a.hash,Ht);return r===null||t===null&&a.hash!==null||typeof a.newTab!="boolean"?null:{type:"navigate",path:r,hash:t,newTab:a.newTab,redirect:a.redirect===!0}}case"open":{let r=Ca(a.url,Ht);return r===null?null:{type:"open",url:r}}case"problem":{let r=wd(a.problem);return r?{type:"problem",problem:r}:null}case"selection":{let r=Ut(a.text,500),t=Pd(a.rect);return r===null||t===void 0?null:{type:"selection",text:r,rect:t}}case"anchors":{let r=ln(a.found),t=ln(a.missing);return r&&t?{type:"anchors",found:r,missing:t}:null}case"focused":{let r=Ca(a.quote,500);return r===null||typeof a.found!="boolean"?null:{type:"focused",quote:r,found:a.found}}case"scroll":{let r=kt(a.x),t=kt(a.y);return r===null||t===null?null:{type:"scroll",x:r,y:t}}case"hash":{let r=a.hash===null?null:Ca(a.hash,Ht);return r===null&&a.hash!==null?null:{type:"hash",hash:r}}case"storage":{let r=yd(a.entries);return r?{type:"storage",entries:r}:null}default:return null}}function pn(e){return lt(e)?.dd===Ld}var Yf=12*1024*1024,zt=960*1024;function mn(e,a,r){let t=new Map(a.map(n=>[n.path,n.revision]));return!r&&e.revision!==(t.get(e.path)??null)||e.deps.some(n=>(t.get(n.path)??0)!==n.revision)?!0:e.missing.some(n=>t.has(n))}function Gt(e,a){let r=[...e],t=new Set(e.map(n=>n.path));for(let[n,d]of a){if(r.length>=500)break;t.has(n)||r.push({path:n,revision:d})}return r}function gn(e){return JSON.stringify(e).replace(/</g,"\\u003c")}var vd=new URL("./page-runtime.js",import.meta.url).href,xn=[{id:"full",label:"Full width",icon:ja,width:null},{id:"tablet",label:"Tablet (768px)",icon:Ya,width:768},{id:"phone",label:"Phone (390px)",icon:Ja,width:390}],kd=400,Ad=1500,Dd=6,Td=200,Md=20,Rd=50,Fd={error:"Error",missing:"Missing",blocked:"Blocked"},ba=new Map;function Bd(e,a){for(ba.delete(e),ba.set(e,a);ba.size>Md;)ba.delete(ba.keys().next().value)}var la=new Map,jt=(e,a)=>`${e}\0${a}`;function Nd(e,a,r){let t=jt(e,a);for(la.delete(t),la.set(t,r);la.size>Rd;)la.delete(la.keys().next().value)}function Ed(e,a,r,t){let n=`<script type="application/json" id="${un}">${gn(a)}<\/script><script src="${Hr(r)}"><\/script>`,d=Pt(e.html,n);return e.styled?d:Zr(d,t)}function qd(e,a){let r=0,t=[],n=()=>{for(;r<e&&t.length;){let d=t.shift();r+=1,Promise.resolve().then(d).catch(()=>{}).finally(()=>{r-=1,n()})}};return{add(d){return r+t.length>=a?!1:(t.push(d),n(),!0)},clear(){t.length=0}}}function Od(e){return e.length*6<zt?!1:new TextEncoder().encode(JSON.stringify(e)).byteLength>zt}function Hd(e,a){return e.kind===a.kind&&e.message===a.message&&e.source===a.source&&e.line===a.line}function hn({docId:e,file:a,files:r,draft:t=!1,quotes:n=[],onOpenPath:d,onQuote:i,onAskAbout:l,handleRef:f}){let u=_(),c=a.path,[x,L]=C("full"),[S,h]=C(null),[b,w]=C(!0),[q,N]=C(null),[E,A]=C(!1),[R,v]=C([]),[T,p]=C(!1),[y,g]=C(null),[P,z]=C(null),[Z,We]=C(0),ge=D(null),Te=D(null),le=D(null),Me=D(!1),Se=D(null),ia=D([]),ne=D(new Map),Re=D(null),ua=D(""),Xe=D({hash:la.get(jt(e,c))??null,scroll:null}),xe=D(n);xe.current=n;let Pe=X(()=>qd(Dd,Td),[]);B(()=>{la.delete(jt(e,c))},[e,c]);let W=t?a.content:null,[de,ya]=C(W);B(()=>{if(W===de)return;if(W===null){ya(null);return}let I=setTimeout(()=>ya(W),kd);return()=>clearTimeout(I)},[W,de]);let Zt=r.find(I=>I.path===c)?.revision??null,K=de===null?Zt:null,ca=D(0);B(()=>{let I=++ca.current;if(de!==null&&Od(de)){A(!0),w(!1);return}A(!1),w(!0),u.renderPage(e,{path:c,draft:de??void 0}).then(k=>{if(I!==ca.current)return;let G={mode:"frame",docId:e,path:c,hash:Xe.current.hash,scroll:Xe.current.scroll,quotes:[...xe.current],storage:ba.get(e)};h({id:I,page:k,srcDoc:Ed(k,G,vd,k.styled?{}:Kr()),draft:de!==null}),N(null),w(!1)},k=>{I===ca.current&&(N(O(k)),w(!1))})},[u,e,c,de,K,Z]);let Ke=D("");B(()=>{if(!S||b)return;let I={...S.page,deps:Gt(S.page.deps,ne.current)};if(!mn(I,r,de!==null))return;let k=r.map(G=>`${G.path}@${G.revision}`).join("|");Ke.current!==k&&(Ke.current=k,We(G=>G+1))},[S,r,b,de]);let ye=(I,k=le.current)=>{try{k?.postMessage(I)}catch{}},fa=I=>{v(k=>k.length>=cn||k.some(G=>Hd(G,I))?k:[...k,I]),ma()},Fe=D(R);Fe.current=R;let pa=D(S);pa.current=S;let ma=()=>{Re.current&&clearTimeout(Re.current),Re.current=setTimeout(()=>{Re.current=null;let I=pa.current,k=I?.page;if(!k||I.draft||k.revision===null||!Me.current)return;let G={path:k.path,revision:k.revision,deps:Gt(k.deps,ne.current),missing:k.missing,problems:Fe.current,unanchored:ia.current},j=JSON.stringify(G);j!==ua.current&&(ua.current=j,u.reportRender(e,G).catch(()=>{ua.current=""}))},Ad)},ct=(I,k)=>{I!==c&&(k!==null&&Nd(e,I,k),d?.(I))},Dt=(I,k,G)=>{let j=new Set(r.map(Ze=>Ze.path)),ve=j.has(I)?I:j.has(`${I}/index.html`)?`${I}/index.html`:null;if(!ve){M(`${I} is not a file in this design doc`,"error");return}G?g(ve===c?null:{path:ve,hash:k}):ct(ve,k)},ft=I=>{let k;try{k=new URL(I)}catch{return}if(k.protocol!=="https:"&&k.protocol!=="http:"){M(`Zana opens web links only, not ${k.protocol} links`,"error");return}let G=globalThis.navigator?.userActivation;if(G&&!G.isActive){fa({kind:"blocked",message:`The page tried to open ${k.href} without a click`});return}globalThis.open(k.href,"_blank","noopener,noreferrer")},pt=(I,k)=>{let G=ge.current,j=Te.current;if(!i||!I||!k||!G||!j){z(null);return}let ve=G.getBoundingClientRect(),Ze=j.getBoundingClientRect(),qn=ve.top-Ze.top+j.scrollTop+k.top-36,On=ve.left-Ze.left+j.scrollLeft+(k.left+k.right)/2;z({text:I,top:Math.max(4,qn),left:Math.min(Math.max(80,On),Math.max(80,j.scrollWidth-80))})},mt=(I,k)=>{switch(I.type){case"ready":Me.current=!0,ye({type:"highlight",quotes:[...xe.current]},k),Se.current!==null&&ye({type:"focus",quote:Se.current},k),Se.current=null,ma();break;case"fetch":{!ne.current.has(I.path)&&ne.current.size<500&&(ne.current.set(I.path,r.find(j=>j.path===I.path)?.revision??0),ma()),Pe.add(async()=>{let j=null;try{j=await u.readPageFile(e,I.path)}catch{j=null}le.current===k&&ye({type:"file",id:I.id,file:j},k)})||ye({type:"file",id:I.id,file:null},k);break}case"navigate":Dt(I.path,I.hash,I.redirect);break;case"open":ft(I.url);break;case"problem":fa(I.problem);break;case"selection":pt(I.text,I.rect);break;case"anchors":ia.current=I.missing,ma();break;case"focused":I.found||M("That passage is no longer on this page");break;case"scroll":Xe.current.scroll={x:I.x,y:I.y};break;case"hash":Xe.current.hash=I.hash;break;case"storage":Bd(e,I.entries);break;default:break}},F=D(mt);F.current=mt,B(()=>{let I=k=>{let G=ge.current,j=k.ports?.[0];!G||!j||k.source!==G.contentWindow||!pn(k.data)||(le.current?.close(),le.current=j,Me.current=!1,ia.current=[],ne.current=new Map,Pe.clear(),v([]),g(null),z(null),j.onmessage=ve=>{if(le.current!==j)return;let Ze=fn(ve.data);Ze&&F.current(Ze,j)})};return globalThis.addEventListener("message",I),()=>{globalThis.removeEventListener("message",I),le.current?.close(),le.current=null,Pe.clear(),Re.current&&clearTimeout(Re.current)}},[Pe]);let we=n.join("\0");B(()=>{Me.current&&ye({type:"highlight",quotes:we?we.split("\0"):[]})},[we]),B(()=>{if(!f)return;let I={focusQuote(k){return Me.current&&le.current?ye({type:"focus",quote:k}):Se.current=k,!0}};return f.current=I,()=>{f.current===I&&(f.current=null)}},[f]);let wa=[...X(()=>S?[...S.page.missing.map(I=>({kind:"missing",message:`The page uses ${I}, which is not a file in this doc`})),...S.page.warnings.map(I=>({kind:"blocked",message:I}))]:[],[S]),...R],En=async()=>{try{let{url:I}=await u.pageLink(e,c);globalThis.open(I,"_blank","noopener,noreferrer")}catch(I){M(O(I),"error")}},Jt=I=>{!P||!I||(I(P.text),z(null),ye({type:"clear-selection"}))},Tt=xn.find(I=>I.id===x).width;return s("div",{className:"dd-html-stage",onMouseDown:I=>{I.target.closest?.(".dd-selection-chip")||z(null)},children:[s("div",{className:"dd-html-toolbar",children:[s("div",{className:"dd-html-status",children:[b?o(V,{size:12,label:"Rendering page"}):null,t?o("span",{className:"dd-muted",children:"Unsaved changes"}):null]}),o("div",{className:"dd-html-widths",role:"toolbar","aria-label":"Preview width",children:xn.map(I=>o("button",{type:"button",className:`icon-btn${x===I.id?" on":""}`,title:I.label,"aria-label":I.label,"aria-pressed":x===I.id,onClick:()=>L(I.id),children:o(I.icon,{size:14,"aria-hidden":!0})},I.id))}),s("div",{className:"dd-html-actions",children:[wa.length?o(re,{open:T,onClose:()=>p(!1),className:"dd-page-problems",anchor:s("button",{type:"button",className:"dd-page-badge","aria-label":`${wa.length} page ${wa.length===1?"problem":"problems"}`,"aria-expanded":T,onClick:()=>p(I=>!I),children:[o(pe,{size:13,"aria-hidden":!0}),wa.length]}),children:o("ul",{"aria-label":"Page problems",children:wa.map((I,k)=>s("li",{className:`dd-page-problem dd-page-problem-${I.kind}`,children:[o("span",{className:"dd-page-problem-kind",children:Fd[I.kind]}),o("span",{className:"dd-page-problem-message",children:I.message}),I.source?s("span",{className:"dd-muted dd-page-problem-source",children:[I.source,I.line?`:${I.line}`:""]}):null]},k))})}):null,t?null:o(U,{icon:Ye,label:"Open in browser",onClick:()=>{En()}})]})]}),y?s("div",{className:"dd-banner dd-banner-info",children:[o(Ba,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:["This page redirects to ",o("code",{children:y.path}),"."]}),o("button",{type:"button",className:"btn",onClick:()=>{g(null),ct(y.path,y.hash)},children:"Go there"}),o(U,{icon:Q,label:"Dismiss",onClick:()=>g(null)})]}):null,E?s("div",{className:"dd-banner dd-banner-warn",children:[o(pe,{size:14,"aria-hidden":!0}),o("span",{className:"dd-banner-text",children:"This draft is too large to preview. Save it to see the page."})]}):null,q?o("div",{className:"dd-banner dd-banner-error",children:q}):null,s("div",{className:"dd-html-viewport",ref:Te,children:[S?o("iframe",{ref:ge,className:`dd-html-frame${Tt?" dd-html-frame-device":""}`,style:Tt?{width:Tt}:void 0,sandbox:"allow-scripts allow-forms",srcDoc:S.srcDoc,title:c},S.id):q||E?null:o("div",{className:"dd-center",children:o(V,{label:"Rendering page"})}),P?s("div",{className:"dd-selection-chip",style:{top:P.top,left:P.left},children:[s("button",{type:"button",onClick:()=>Jt(i),children:[o(oa,{size:13,"aria-hidden":!0}),"Comment"]}),l?s("button",{type:"button",onClick:()=>Jt(l),children:[o(J,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})]})}var _d=24,Ud=64,Sa=new Map;function zd(e,a){for(Sa.delete(e),Sa.set(e,a);Sa.size>Ud;)Sa.delete(Sa.keys().next().value)}function Gd(e,a,r){let t=_(),n=X(()=>{let u=new Map(a.map(c=>[c.path,c]));return r.map(c=>u.get(c)).filter(c=>!!c&&(c.kind==="image"||c.kind==="svg")).slice(0,_d)},[a,r]),d=n.map(u=>`${u.path}@${u.revision}`).join("|"),i=D(n);i.current=n;let[l,f]=C(new Map);return B(()=>{let u=i.current,c=!1,x=new Map,L=[];for(let S of u){let h=Sa.get(`${e}\0${S.path}\0${S.revision}`);h?x.set(S.path,h):L.push(S)}if(f(x),!!L.length)return Promise.all(L.map(async S=>{try{let h=await t.readFile(e,S.path),b=Bt(h);b&&(zd(`${e}\0${h.path}\0${h.revision}`,b),x.set(h.path,b))}catch{}})).then(()=>{c||f(new Map(x))}),()=>{c=!0}},[t,e,d]),l}function ut({docId:e,file:a,files:r,quotes:t=[],onOpenPath:n,onQuote:d,onAskAbout:i,handleRef:l,draft:f=!1}){let u=D(null),c=D(null),x=D({}),[L,S]=C(null),h=X(()=>a.kind==="markdown"?$r(a.path,a.content):[],[a.path,a.content,a.kind]),b=Gd(e,r,h),w=X(()=>new Set(r.map(p=>p.path)),[r]),q=X(()=>a.kind==="markdown"?Wr(a.path,a.content,b):a.kind==="mermaid"?Nt(a.content,"mermaid"):a.kind==="code"?Xr(a.path,a.content):null,[a.kind,a.path,a.content,b]),N=t.join("\0");B(()=>{let p=c.current,y=x.current,g=N?N.split("\0"):[];if(!p||!g.length){sa(wt,y,[]);return}let P=()=>sa(wt,y,[...Ot(p,g).values()]),z=setTimeout(P,60),Z=typeof MutationObserver=="function"?new MutationObserver(()=>P()):null;return Z?.observe(p,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(z),Z?.disconnect(),sa(wt,y,[]),sa(vt,y,[])}},[N,q,a.kind,a.content]);let E=a.kind!=="html";B(()=>{if(!(!l||!E))return l.current={focusQuote(p){let y=c.current,g=y?Ot(y,[p]).get(p):void 0;return g?(g.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),sa(vt,x.current,[g]),setTimeout(()=>sa(vt,x.current,[]),1800),!0):!1}},()=>{l.current=null}},[l,E]);let A=p=>{let y=p.target?.closest?.("a");if(!y)return;let g=y.getAttribute("href")??"";if(g.startsWith("#")){p.preventDefault(),p.stopPropagation();return}let P=dt(a.path,g);if(!P)return;p.preventDefault(),p.stopPropagation();let z=[...w].find(Z=>Z.startsWith(`${P}/`));w.has(P)?n?.(P):z?n?.(z):M(`${P} is not a file in this design doc`,"error")},R=()=>{if(!d)return;let p=globalThis.getSelection?.(),y=u.current,g=p?.toString().trim()??"";if(!p||p.isCollapsed||!g||!y||!c.current?.contains(p.anchorNode)){S(null);return}let P=p.getRangeAt(0).getBoundingClientRect(),z=y.getBoundingClientRect();S({text:g.slice(0,500),top:Math.max(4,P.top-z.top+y.scrollTop-36),left:Math.min(Math.max(80,P.left-z.left+P.width/2),Math.max(80,z.width-80))})},v=p=>{!L||!p||(p(L.text),S(null),globalThis.getSelection?.()?.removeAllRanges())},T;if(a.kind==="html")T=o(hn,{docId:e,file:a,files:r,draft:f,quotes:t,onOpenPath:n,onQuote:d,onAskAbout:i,handleRef:l},`${e}\0${a.path}`);else if(a.kind==="image"||a.kind==="svg"){let p=Bt(a);T=o("div",{className:"dd-image-stage",children:p?o("img",{src:p,alt:a.path}):o("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else a.kind==="font"?T=o("div",{className:"dd-image-stage",children:o("span",{className:"dd-muted",children:"Font file. Pages in this doc load it through @font-face."})}):q!==null?T=o("div",{className:`dd-prose dd-prose-${a.kind}`,ref:c,onClickCapture:A,children:a.kind==="markdown"&&!a.content.trim()?o("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):o(va,{content:q})}):T=o("div",{className:"dd-prose",ref:c,children:o("pre",{className:"dd-plain",children:a.content})});return s("div",{className:`dd-preview dd-preview-${a.kind}`,ref:u,onMouseUp:R,onMouseDown:p=>{p.target.closest?.(".dd-selection-chip")||S(null)},children:[T,L?s("div",{className:"dd-selection-chip",style:{top:L.top,left:L.left},children:[s("button",{type:"button",onClick:()=>v(d),children:[o(oa,{size:13,"aria-hidden":!0}),"Comment"]}),i?s("button",{type:"button",onClick:()=>v(i),children:[o(J,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function Ln(e,a,r=1500){let t=e.split(`
`),n=a.split(`
`),d=0;for(;d<t.length&&d<n.length&&t[d]===n[d];)d+=1;let i=t.length,l=n.length;for(;i>d&&l>d&&t[i-1]===n[l-1];)i-=1,l-=1;let f=t.slice(d,i),u=n.slice(d,l);if(f.length>r||u.length>r)return null;let c=u.length+1,x=new Uint32Array((f.length+1)*c);for(let b=f.length-1;b>=0;b-=1)for(let w=u.length-1;w>=0;w-=1)x[b*c+w]=f[b]===u[w]?x[(b+1)*c+w+1]+1:Math.max(x[(b+1)*c+w],x[b*c+w+1]);let L=[],S=0,h=0;for(;S<f.length&&h<u.length;)f[S]===u[h]?(L.push({type:"same",text:f[S]}),S+=1,h+=1):x[(S+1)*c+h]>=x[S*c+h+1]?(L.push({type:"del",text:f[S]}),S+=1):(L.push({type:"add",text:u[h]}),h+=1);for(;S<f.length;)L.push({type:"del",text:f[S++]});for(;h<u.length;)L.push({type:"add",text:u[h++]});return[...t.slice(0,d).map(b=>({type:"same",text:b})),...L,...t.slice(i).map(b=>({type:"same",text:b}))]}function In(e,a=3){let r=new Uint8Array(e.length);e.forEach((d,i)=>{if(d.type!=="same")for(let l=Math.max(0,i-a);l<=Math.min(e.length-1,i+a);l+=1)r[l]=1});let t=[],n=0;for(;n<e.length;)if(r[n]){let d=[];for(;n<e.length&&r[n];)d.push(e[n++]);t.push({type:"lines",lines:d})}else{let d=0;for(;n<e.length&&!r[n];)d+=1,n+=1;t.push({type:"gap",count:d})}return t}function Cn(e){let a=0,r=0;for(let t of e)t.type==="add"?a+=1:t.type==="del"&&(r+=1);return{added:a,removed:r}}var jd={create:Ie,write:qe,delete:Oe,rename:Va},bn={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function Sn({doc:e,activePath:a,now:r,selectedId:t,onSelect:n}){let d=_(),[i,l]=te("history-scope","file"),f=i==="file"?a:null,u=Ge(`${e.id}\0${f??"*"}\0${e.revision}`,()=>d.history(e.id,{...f?{path:f}:{},limit:100}));return s("div",{className:"dd-rail-pane dd-history",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[o("button",{type:"button",className:i==="file"?"on":"",onClick:()=>l("file"),disabled:!a,children:"This file"}),o("button",{type:"button",className:i==="all"?"on":"",onClick:()=>l("all"),children:"All files"})]})}),s("div",{className:"dd-rail-scroll",children:[u.error?o("div",{className:"dd-banner dd-banner-error",children:u.error}):null,!u.data&&u.loading?o("div",{className:"dd-center",children:o(V,{label:"Loading history"})}):null,u.data&&!u.data.length?o(me,{icon:fe,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,o("ol",{className:"dd-history-list",children:u.data?.map(c=>{let x=jd[c.op];return o("li",{children:s("button",{type:"button",className:`dd-history-row${t===c.id?" on":""}`,onClick:()=>n(c),children:[o(x,{size:13,className:`dd-op dd-op-${c.op}`,"aria-hidden":!0}),s("span",{className:"dd-history-main",children:[s("span",{className:"dd-history-title",children:[bn[c.op],f?null:o("span",{className:"dd-history-path",children:c.path}),s("span",{className:"dd-history-rev",children:["rev ",c.revision]})]}),c.note?o("span",{className:"dd-history-note",children:c.note}):null,s("span",{className:"dd-history-meta",children:[o(se,{actor:c.actor}),o(Y,{at:c.createdAt,now:r})]})]})]})},c.id)})})]})]})}async function Vd(e,a,r){let t=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||t.encoding==="base64")return{after:t,before:null,pruned:!1};if(r.op==="delete")return{after:t,before:t.content,pruned:!1};let n=(await e.history(a,{path:r.path,limit:100})).find(i=>i.id<r.id);if(!n)return{after:t,before:null,pruned:!0};if(n.op==="delete")return{after:t,before:"",pruned:!1};let d=await e.revision(a,n.id);return{after:t,before:d.content,pruned:!1}}function Pn({doc:e,revision:a,onClose:r,onOpenPath:t}){let n=_(),[d,i]=C(a.op==="write"||a.op==="delete"?"changes":"full"),[l,f]=C(!1),[u,c]=C(null),x=Ge(`${e.id}\0${a.id}`,()=>Vd(n,e.id,a)),L=da(a.path),S=e.files.find(A=>A.path===a.path)??null,h=S?.revision===a.revision&&a.op!=="delete",b=X(()=>{let A=x.data;if(!A||A.before===null||De(L))return null;let R=Ln(A.before,a.op==="delete"?"":A.after.content);return R?{hunks:In(R),stats:Cn(R)}:"too-large"},[x.data,a.op,L]),w=async()=>{f(!0);try{let A=await n.restore(e.id,a.id,S?.revision??0);M(`Restored ${A.path} to revision ${a.revision} (now rev ${A.revision})`),t(A.path),r()}catch(A){M(`Could not restore: ${O(A)}`,"error")}finally{f(!1)}},q=()=>{if(S){w();return}c({title:`Recreate ${a.path}?`,body:s($,{children:[o("code",{children:a.path})," is no longer in this doc",a.op==="delete"?"":"; it may have been renamed",". Recreate it with the content of revision ",a.revision,"?"]}),confirmLabel:"Recreate",run:()=>{w()}})},N=b!==null,E=d==="full"||!N;return s("div",{className:"dd-revision",children:[s("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[o(fe,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o("strong",{children:bn[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",o(se,{actor:a.actor})," ",o(Y,{at:a.createdAt,now:Date.now()}),a.renamedFrom?s($,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?s("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),N?s("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[o("button",{type:"button",className:d==="changes"?"on":"",onClick:()=>i("changes"),children:"Changes"}),o("button",{type:"button",className:d==="full"?"on":"",onClick:()=>i("full"),children:"Full file"})]}):null,s("button",{type:"button",className:"btn",disabled:h||l||!x.data,onClick:q,children:[o(Ae,{size:12,"aria-hidden":!0})," ",h?"Current":S?"Restore":"Recreate file"]}),o(U,{icon:Q,label:"Close revision",onClick:r})]}),s("div",{className:"dd-revision-body",children:[x.error?o("div",{className:"dd-banner dd-banner-error",children:x.error}):null,x.data?E?s($,{children:[x.data.pruned?o("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,b==="too-large"?o("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,o(ut,{docId:e.id,file:{path:a.path,kind:L,content:x.data.after.content,encoding:x.data.after.encoding},files:e.files,onOpenPath:t,draft:!0})]}):b&&b!=="too-large"?s("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[s("div",{className:"dd-diff-stats",children:[s("span",{className:"dd-diff-added",children:["+",b.stats.added]}),s("span",{className:"dd-diff-removed",children:["\u2212",b.stats.removed]}),o("span",{className:"dd-muted",children:na(a.size)})]}),b.hunks.map((A,R)=>A.type==="gap"?s("div",{className:"dd-diff-gap",children:["\u22EF ",A.count," unchanged line",A.count===1?"":"s"]},R):A.lines.map((v,T)=>s("div",{className:`dd-diff-line dd-diff-${v.type}`,role:"row",children:[o("span",{className:"dd-diff-sign","aria-hidden":!0,children:v.type==="add"?"+":v.type==="del"?"\u2212":" "}),o("span",{className:"dd-diff-text",children:v.text||" "})]},`${R}-${T}`))),b.stats.added+b.stats.removed===0?o("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:x.loading?o("div",{className:"dd-center",children:o(V,{label:"Loading revision"})}):null]}),u?o(be,{request:u,onClose:()=>c(null)}):null]})}var $d=[{id:"preview",label:"Preview",icon:Na},{id:"edit",label:"Edit",icon:ra},{id:"split",label:"Split",icon:Ne}];function Wd(e,a,r){let t=Ar(e,a,r),n=D(null);t.data&&(n.current=t.data);let d=n.current&&n.current.path===a?n.current:null;return{file:t.data??d,error:t.error,loading:t.loading}}function Xd(e,a,r){let[t,n]=C(null),d=D({path:e,revision:a});return B(()=>{let i=d.current;if(d.current={path:e,revision:a},i.path!==e||a===null||i.revision===null||a<=i.revision||r?.kind!=="agent")return;n(r.label);let l=setTimeout(()=>n(null),4e3);return()=>clearTimeout(l)},[e,a,r]),t}function yn({doc:e,path:a,mode:r,onModeChange:t,railOpen:n,onToggleRail:d,revision:i,onCloseRevision:l,previewHandle:f,onOpenPath:u,onQuote:c,onAskAbout:x,onEditorState:L,leading:S}){let h=e.files.find(p=>p.path===a)??null,{file:b,error:w,loading:q}=Wd(e.id,a,h?.revision??null),N=Xd(a,h?.revision??null,h?.updatedBy),E=!h||!De(h.kind),A=E?r:"preview",R=X(()=>e.comments.filter(p=>p.status==="open"&&p.path===a&&p.quote).map(p=>p.quote),[e.comments,a]),v=a.lastIndexOf("/");B(()=>{A==="preview"&&L({dirty:!1,saving:!1})},[A,L]);let T;return i?T=o(Pn,{doc:e,revision:i,onClose:l,onOpenPath:u},i.id):!h&&!(b&&A!=="preview")?T=s("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}):b?A==="preview"?T=o(ut,{docId:e.id,file:b,files:e.files,quotes:R,onOpenPath:u,onQuote:c,onAskAbout:x,handleRef:f}):T=o(nn,{docId:e.id,file:b,removed:!h,split:A==="split",onStateChange:L,renderPreview:p=>o(ut,{docId:e.id,file:{...b,content:p},files:e.files,onOpenPath:u,draft:p!==b.content})},`${e.id}\0${a}`):T=o("div",{className:"dd-center",children:w?o("div",{className:"dd-banner dd-banner-error",children:w}):q?o(V,{label:"Loading file"}):null}),s("section",{className:"dd-file-pane","aria-label":a,children:[s("div",{className:"dd-file-toolbar",children:[S,h?o(ha,{kind:h.kind}):null,s("span",{className:"dd-file-path",title:a,children:[v>0?o("span",{className:"dd-file-dir",children:a.slice(0,v+1)}):null,o("span",{className:"dd-file-name",children:a.slice(v+1)})]}),h?s("span",{className:"dd-file-meta",children:["rev ",h.revision," \xB7 ",na(h.size)," \xB7 ",o(se,{actor:h.updatedBy})," ",o(Y,{at:h.updatedAt,now:Date.now()})]}):null,N?s("span",{className:"dd-flash",role:"status",children:[o(ae,{size:12,"aria-hidden":!0})," Updated by ",N]}):null,o("span",{className:"dd-spacer"}),i?null:o("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:$d.map(p=>s("button",{type:"button",className:A===p.id?"on":"",disabled:!E&&p.id!=="preview",onClick:()=>t(p.id),title:p.label,"aria-pressed":A===p.id,children:[o(p.icon,{size:13,"aria-hidden":!0}),o("span",{className:"dd-mode-label",children:p.label})]},p.id))}),o(U,{icon:$a,label:n?"Hide comments & history":"Show comments & history",active:n,onClick:d})]}),o("div",{className:"dd-file-body",children:T})]})}function Jd(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,t=>t.toUpperCase());switch(da(e)){case"markdown":return`# ${r}

`;case"mermaid":return`flowchart LR
  A[Start] --> B[Next]
`;case"html":return`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${r}</title>
</head>
<body>
  <h1>${r}</h1>
</body>
</html>
`;case"svg":return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="10" y="10" width="180" height="80" rx="8" fill="none" stroke="currentColor"/>
</svg>
`;default:return""}}function Qd(e){let a=e.trim().replace(/^\/+/,"");return nt(a)?a:`${a}.md`}function Yd(e){return new Promise((a,r)=>{let t=new FileReader,n=De(da(e.name));t.onerror=()=>r(t.error??new Error("could not read the file")),t.onload=()=>{let d=String(t.result??"");a(n?{content:d.slice(d.indexOf(",")+1),encoding:"base64"}:{content:d})},n?t.readAsDataURL(e):t.readAsText(e)})}function wn({initial:e,placeholder:a,onSubmit:r,onCancel:t}){let[n,d]=C(e),i=D(!1),l=u=>{u?.preventDefault(),!i.current&&(i.current=!0,n.trim()&&n.trim()!==e?r(n.trim()):t())};return o("form",{className:"dd-tree-input",onSubmit:l,children:o("input",{className:"dd-input",value:n,placeholder:a,"aria-label":a,onChange:u=>d(u.target.value),onKeyDown:u=>{u.key==="Escape"&&(u.preventDefault(),i.current=!0,t())},onBlur:()=>l(),autoFocus:!0,onFocus:u=>{let c=u.target.value.lastIndexOf("."),x=u.target.value.lastIndexOf("/")+1;u.target.setSelectionRange(x,c>x?c:u.target.value.length)}})})}function es({doc:e,file:a,name:r,depth:t,active:n,renaming:d,onOpen:i,onRename:l,onRenameDone:f,onDelete:u}){let c=_(),[x,L]=C(!1),S=e.entryPath===a.path,h=e.comments.filter(b=>b.status==="open"&&b.path===a.path).length;return d?o("div",{className:"dd-tree-row",style:{paddingLeft:8+t*14},children:o(wn,{initial:a.path,placeholder:"New path",onSubmit:b=>f(b),onCancel:()=>f(null)})}):s("div",{className:`dd-tree-row dd-tree-file${n?" on":""}`,style:{paddingLeft:8+t*14},children:[s("button",{type:"button",className:"dd-tree-open",onClick:i,onDoubleClick:l,title:`${a.path} \xB7 ${na(a.size)} \xB7 rev ${a.revision}`,"aria-current":n?"page":void 0,children:[o(ha,{kind:a.kind}),o("span",{className:"dd-tree-name",children:r}),S?o(_e,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,h?o("span",{className:"dd-tree-badge",title:`${h} open comment${h===1?"":"s"}`,children:h}):null]}),s(re,{open:x,onClose:()=>L(!1),className:"dd-menu",anchor:o(U,{icon:Le,label:`Actions for ${a.path}`,size:13,active:x,onClick:()=>L(!x)}),children:[o(ee,{icon:ra,label:"Rename or move",onSelect:()=>{L(!1),l()}}),S||De(a.kind)?null:o(ee,{icon:Qa,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{L(!1),c.update(e.id,{entryPath:a.path}).catch(b=>M(O(b),"error"))}}),o(ee,{icon:oe,label:"Delete",danger:!0,onSelect:()=>{L(!1),u()}})]})]})}function Vt({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let d=_(),[i,l]=C(new Set),[f,u]=C(!1),[c,x]=C(null),[L,S]=C(null),h=D(null),b=Jr(e.files),w=e.files.length>=500,q=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",N=async p=>{u(!1);let y=Qd(p);if(e.files.some(g=>g.path===y)){r(y);return}if(De(da(y))){M("Use \u201CAdd files\u201D to upload images and fonts.","error");return}try{await d.writeFile(e.id,{path:y,content:Jd(y)}),r(y)}catch(g){M(`Could not create ${y}: ${O(g)}`,"error")}},E=(p,y)=>{if(x(null),!y||y===p)return;let g=async()=>{try{let P=await d.renameFile(e.id,p,y);t(p,P.path)}catch(P){M(`Could not rename ${p}: ${O(P)}`,"error")}};if(!n?.(p)){g();return}S({title:"Discard unsaved changes?",body:s($,{children:["Renaming ",o("code",{children:p})," drops your unsaved edits to it. Save them first to keep them."]}),confirmLabel:"Discard and rename",danger:!0,run:g})},A=async p=>{for(let y of Array.from(p??[])){let g=da(y.name),P=De(g)?2097152:2097152;if(y.size>P){M(`${y.name} is larger than ${na(P)}`,"error");continue}let z=g==="image"||g==="svg"||g==="font",Z=`${q||(z?"assets/":"")}${y.name.replace(/[^\w.-]+/g,"-")}`;try{let We=await Yd(y);await d.writeFile(e.id,{path:Z,...We});let ge=Z.slice(q.length);M(g==="font"||!z?`Added ${Z}`:`Added ${Z}. Reference it with ![${y.name}](${ge})`)}catch(We){M(`Could not add ${y.name}: ${O(We)}`,"error")}}h.current&&(h.current.value="")},R=p=>S({title:"Delete file",body:s($,{children:["Delete ",o("code",{children:p.path}),"? Its history is kept, so it can be recreated from History.",n?.(p.path)?" Your unsaved edits to it will be lost.":null]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await d.deleteFile(e.id,p.path),t(p.path,null)}catch(y){M(`Could not delete ${p.path}: ${O(y)}`,"error")}}}),v=p=>l(y=>{let g=new Set(y);return g.has(p)?g.delete(p):g.add(p),g}),T=(p,y)=>p.map(g=>{if(g.kind==="folder"){let P=!i.has(g.path);return s("div",{role:"group","aria-label":g.name,children:[s("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+y*14},onClick:()=>v(g.path),"aria-expanded":P,children:[P?o(ie,{size:12,"aria-hidden":!0}):o(Qe,{size:12,"aria-hidden":!0}),P?o(aa,{size:14,"aria-hidden":!0}):o(_a,{size:14,"aria-hidden":!0}),o("span",{className:"dd-tree-name",children:g.name})]}),P?T(g.children,y+1):null]},`d:${g.path}`)}return o(es,{doc:e,file:g.file,name:g.name,depth:y,active:g.path===a,renaming:c===g.path,onOpen:()=>r(g.path),onRename:()=>x(g.path),onRenameDone:P=>{E(g.path,P)},onDelete:()=>R(g.file)},`f:${g.path}`)});return s("nav",{className:"dd-tree","aria-label":"Files",children:[s("div",{className:"dd-tree-head",children:[o("span",{className:"dd-section-label",children:"Files"}),o("span",{className:"dd-tree-count",children:e.files.length}),o("span",{className:"dd-spacer"}),o(U,{icon:Ie,label:"Add files",size:13,disabled:w,onClick:()=>h.current?.click()}),o(U,{icon:ce,label:"New file",size:13,disabled:w,onClick:()=>u(!0)}),o("input",{ref:h,type:"file",multiple:!0,hidden:!0,onChange:p=>{A(p.target.files)}})]}),s("div",{className:"dd-tree-scroll",role:"tree",children:[T(b,0),f?o("div",{className:"dd-tree-row",style:{paddingLeft:8},children:o(wn,{initial:q,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:p=>{N(p)},onCancel:()=>u(!1)})}):null]}),L?o(be,{request:L,onClose:()=>S(null)}):null]})}var as=640,ts=1100,$t=[as,ts];function os(e,a){let r=t=>!!t&&e.files.some(n=>n.path===t);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function rs({doc:e,tab:a,onTab:r,activePath:t,now:n,pendingQuote:d,onClearQuote:i,commentDraft:l,onCommentDraft:f,onFocusComment:u,selectedRevision:c,onSelectRevision:x,onClose:L}){let S=[{id:"comments",label:"Comments",icon:Ce,count:e.openComments},{id:"history",label:"History",icon:fe},{id:"agents",label:"Agents",icon:ae,count:e.threads.length}];return s("aside",{className:"dd-rail","aria-label":"Comments, history and agents",children:[s("div",{className:"dd-rail-tabs",role:"tablist",children:[S.map(h=>s("button",{type:"button",role:"tab","aria-selected":a===h.id,className:`dd-rail-tab${a===h.id?" on":""}`,onClick:()=>r(h.id),children:[o(h.icon,{size:13,"aria-hidden":!0}),h.label,h.count?o("span",{className:"dd-count",children:h.count}):null]},h.id)),L?s($,{children:[o("span",{className:"dd-spacer"}),o(U,{icon:Q,label:"Close",onClick:L,size:13})]}):null]}),a==="comments"?o(en,{doc:e,activePath:t,now:n,pendingQuote:d,onClearQuote:i,draft:l,onDraft:f,onFocusComment:u}):a==="history"?o(Sn,{doc:e,activePath:t,now:n,selectedId:c,onSelect:x}):o(Er,{doc:e,now:n})]})}function ns({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let[d,i]=C(!1),l=e.files.find(f=>f.path===a);return o(re,{open:d,onClose:()=>i(!1),align:"start",className:"dd-switcher-pop",anchor:s("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":d,onClick:()=>i(!d),title:"Files in this doc",children:[l?o(ha,{kind:l.kind}):null,s("span",{children:[e.files.length," files"]}),o(ie,{size:12,"aria-hidden":!0})]}),children:o(Vt,{doc:e,activePath:a,onOpen:f=>{i(!1),r(f)},onPathChanged:t,hasDraft:n})})}function At({docId:e,path:a,onOpenPath:r,layout:t,contextProjectId:n=null,onDeleted:d,headerExtra:i}){let l=bt(e),f=je(),u=xa(),c=t==="compact",[x,L]=Dr($t),S=!c&&(L??$t.length)>=1,h=!c&&(L??$t.length)>=2,[b,w]=te("view-mode","preview"),[q,N]=te("rail",!0),[E,A]=te("rail-compact",!1),R=h?q:E,v=h?N:A,[T,p]=te("rail-tab","comments"),[y,g]=C(null),[P,z]=C(""),[Z,We]=C(null),[ge,Te]=C(null),[le,Me]=C(null),[Se,ia]=C(null),ne=D({dirty:!1,saving:!1}),[Re,ua]=C(!1),Xe=D(null),xe=D(null),Pe=D(null),W=l.data,de=W?os(W,a):null,ya=!!W&&!!xe.current&&!W.files.some(F=>F.path===xe.current);ya||(Pe.current=null);let K=ya&&(Re||Pe.current===xe.current)?xe.current:de;xe.current=K;let ca=!!W&&!!l.error&&Sr(l.error),Ke=D({onDeleted:d,title:W?.title??""});Ke.current={onDeleted:d,title:W?.title??Ke.current.title};let ye=he(F=>{ne.current.saving&&!F.saving&&!F.dirty&&(Pe.current=xe.current),ne.current=F,ua(F.dirty)},[]),fa=he(()=>{ne.current={dirty:!1,saving:!1},Pe.current=null,ua(!1)},[]),Fe=he(F=>{if(!ne.current.dirty){F();return}Me({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{fa(),F()}})},[fa]),pa=he(F=>{if(F===K){Te(null);return}Fe(()=>{Te(null),r(F)})},[K,Fe,r]);if(B(()=>{ca&&(M(`\u201C${Ke.current.title}\u201D was deleted`),Ke.current.onDeleted())},[ca]),B(()=>{if(!Se||Se.path!==K||ge)return;let F=[80,300,900].map(we=>setTimeout(()=>{Xe.current?.focusQuote(Se.quote)&&(F.forEach(clearTimeout),ia(null))},we));return()=>F.forEach(clearTimeout)},[Se,K,ge]),!W)return o("div",{className:"dd-doc dd-center",children:l.error?o(me,{icon:ue,title:"This design doc could not be opened",children:l.error}):o(V,{label:"Loading design doc"})});let ma=F=>Fe(()=>{Te(null),F.path&&F.path!==K&&r(F.path),b!=="preview"&&w("preview"),h||v(!1),F.quote&&ia({path:F.path??K??"",quote:F.quote,nonce:Date.now()})}),ct=F=>Fe(()=>{Te(F),F.path!==K&&W.files.some(we=>we.path===F.path)&&r(F.path)}),Dt=F=>{F==="preview"?Fe(()=>w(F)):w(F)},ft=(F,we)=>{F===K&&(fa(),r(we,!0))},pt=F=>F===K&&ne.current.dirty,mt=o(rs,{doc:W,tab:T,onTab:p,activePath:K,now:u,pendingQuote:y,onClearQuote:()=>g(null),commentDraft:P,onCommentDraft:z,onFocusComment:ma,selectedRevision:ge?.id??null,onSelectRevision:ct,onClose:h?void 0:()=>v(!1)});return s("div",{ref:x,className:`dd-doc dd-doc-${t}${R?" dd-rail-open":""}${h?"":" dd-rail-floating"}`,children:[o(rn,{doc:W,projects:f.data??[],compact:c,onDeleted:d,actions:s($,{children:[i,o(qr,{doc:W,activePath:K,request:Z,contextProjectId:n,compact:c})]})}),s("div",{className:"dd-doc-body",children:[S?o(Vt,{doc:W,activePath:K,onOpen:pa,onPathChanged:ft,hasDraft:pt}):null,K?o(yn,{doc:W,path:K,mode:b,onModeChange:Dt,railOpen:R,onToggleRail:()=>v(!R),revision:ge,onCloseRevision:()=>Te(null),previewHandle:Xe,onOpenPath:pa,onQuote:F=>{g({path:K,text:F}),p("comments"),v(!0)},onAskAbout:F=>We({prompt:`About this passage in ${K}:
> ${F.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:ye,leading:S?null:o(ns,{doc:W,activePath:K,onOpen:pa,onPathChanged:ft,hasDraft:pt})}):o("div",{className:"dd-file-pane dd-center",children:o(me,{icon:ue,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),R?mt:null]}),le?o(be,{request:le,onClose:()=>Me(null)}):null]})}var vn="__global__",ds=Lt-600;function ss(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function ls(e,a){let[r,t]=C(e);return B(()=>{let n=setTimeout(()=>t(e),a);return()=>clearTimeout(n)},[e,a]),r}function is({doc:e,active:a,projectName:r,now:t,menuOpen:n,onSelect:d,onMenu:i}){return s("button",{type:"button",className:`dd-doc-row${a?" on":""}${n?" dd-doc-row-menu":""}`,onClick:d,onContextMenu:l=>{l.preventDefault(),i(Br(l))},"aria-current":a?"page":void 0,"aria-haspopup":"menu",children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:e.title}),o(Ve,{status:e.status,compact:!0})]}),e.summary?o("span",{className:"dd-doc-row-summary",children:e.summary}):null,s("span",{className:"dd-doc-row-meta",children:[r!==null?o("span",{className:"dd-doc-row-project",children:r}):null,s("span",{title:`${e.fileCount} files`,children:[o(ea,{size:11,"aria-hidden":!0})," ",e.fileCount]}),e.openComments?s("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[o(Ce,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,e.updatedBy.kind==="agent"?o(ae,{size:11,"aria-label":"Last edited by an agent"}):null,o("span",{className:"dd-spacer"}),o(Y,{at:e.updatedAt,now:t})]})]})}function us({projectId:e,showProjects:a,projects:r,activeId:t,onSelect:n,onDeleted:d,onNew:i,headerActions:l}){let[f,u]=C(""),[c,x]=te("list-status","active"),[L,S]=te("list-project",""),[h,b]=C(!1),[w,q]=C(null),N=yt(r),E=ls(f.trim(),200),A=xa(),R=Ct({...e?{projectId:e}:{},...E?{query:E}:{},status:c}),v=X(()=>new Map(r.map(g=>[g.id,g.name])),[r]),T=X(()=>{let g=R.data??[];return!a||!L?g:g.filter(P=>L===vn?P.projectId===null:P.projectId===L)},[R.data,a,L]),p=c!=="active"||a&&!!L,y=c==="active"?"Active":c==="all"?"All":ot[c];return s("div",{className:"dd-list",children:[s("div",{className:"dd-list-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary dd-new",onClick:i,children:[o(ce,{size:13,"aria-hidden":!0})," New"]}),l]}),s("div",{className:"dd-list-tools",children:[s("label",{className:"dd-search",children:[o(Za,{size:13,"aria-hidden":!0}),o("input",{value:f,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:g=>u(g.target.value)}),f?o("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>u(""),children:o(Q,{size:12,"aria-hidden":!0})}):null]}),s(re,{open:h,onClose:()=>b(!1),className:"dd-menu",anchor:o(U,{icon:He,label:`Filter (${y})`,active:p||h,onClick:()=>b(!h)}),children:[o("div",{className:"dd-menu-section",children:"Status"}),["active",...It,"all"].map(g=>o(ee,{label:g==="active"?"Active (not archived)":g==="all"?"All":ot[g],checked:g===c,onSelect:()=>{x(g),b(!1)}},g)),a?s($,{children:[o("div",{className:"dd-menu-section",children:"Project"}),[{id:"",name:"All projects"},{id:vn,name:"Global docs"},...r].map(g=>o(ee,{label:g.name,checked:g.id===L,onSelect:()=>{S(g.id),b(!1)}},g.id||"all"))]}):null]})]}),s("div",{className:"dd-list-scroll",children:[R.error?o("div",{className:"dd-banner dd-banner-error",children:R.error}):null,!R.data&&R.loading?o("div",{className:"dd-center",children:o(V,{label:"Loading design docs"})}):null,R.data&&!T.length?o("div",{className:"dd-list-empty dd-muted",children:E||p?"No docs match.":"No design docs yet."}):null,T.map(g=>o(is,{doc:g,active:g.id===t,projectName:a?g.projectId?v.get(g.projectId)??"Unknown project":"Global":g.projectId?null:"Global",now:A,menuOpen:w?.doc.id===g.id,onSelect:()=>n(g.id),onMenu:P=>q({doc:g,at:P})},g.id))]}),w?o(Nr,{at:w.at,label:`Actions for ${w.doc.title}`,onClose:()=>q(null),children:N.items(w.doc,()=>q(null),()=>d(w.doc.id),w.doc.id===t?void 0:()=>n(w.doc.id))},`${w.doc.id}@${w.at.x},${w.at.y}`):null,N.dialogs]})}function kn({templates:e,selected:a,onSelect:r}){return o("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(t=>s("button",{type:"button",role:"radio","aria-checked":a===t.id,className:`dd-template${a===t.id?" on":""}`,onClick:()=>r(t.id),children:[o("span",{className:"dd-template-label",children:t.label}),o("span",{className:"dd-template-desc",children:t.description}),o("span",{className:"dd-template-files",children:t.files.join(" \xB7 ")})]},t.id))})}function Wt({initialTemplate:e,defaultProjectId:a,projects:r,onClose:t,onCreated:n}){let d=_(),i=ke(),l=Rt(),[f,u]=C(""),[c,x]=C(""),[L,S]=C(e??null),[h,b]=C(a??""),[w,q]=C(""),[N,E]=C(""),[A,R]=C(!1),v=L??l.data?.[0]?.id??null,T=!!N.trim(),p=h||a||r[0]?.id||"",y=async()=>{if(!(!f.trim()||A)){R(!0);try{let g=await d.create({title:f.trim(),...c.trim()?{summary:c.trim()}:{},...v?{template:v}:{},tags:w.split(",").map(P=>P.trim().toLowerCase()).filter(Boolean),projectId:h||null});if(n(g.id),T)if(!p)M("Doc created. Add a project to let an agent draft it.","error");else{let P=await d.askAgent(g.id,{prompt:ss(N),projectId:p});i.openThreadPanel({actionId:$e,title:g.title,params:{docId:g.id},threadId:P.threadId}),i.toThread(P.threadId),M(`An agent is drafting \u201C${g.title}\u201D. Watch it fill in beside the chat.`)}t()}catch(g){M(`Could not create the doc: ${O(g)}`,"error"),R(!1)}}};return o(rt,{title:"New design doc",wide:!0,onClose:t,footer:s($,{children:[o("span",{className:"dd-muted dd-dialog-hint",children:T?"An agent starts a new thread to draft it.":"You can ask an agent to fill it in later."}),o("span",{className:"dd-spacer"}),o("button",{type:"button",className:"btn",onClick:t,children:"Cancel"}),s("button",{type:"button",className:"btn primary",disabled:!f.trim()||A,onClick:()=>{y()},children:[A?o(V,{size:12}):T?o(J,{size:12,"aria-hidden":!0}):null,T?"Create & draft with agent":"Create"]})]}),children:s("form",{className:"dd-form",onSubmit:g=>{g.preventDefault(),y()},children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Title"}),o("input",{className:"dd-input",value:f,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:g=>u(g.target.value),autoFocus:!0})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Summary"}),o("input",{className:"dd-input",value:c,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:g=>x(g.target.value)})]}),s("div",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Template"}),l.data?o(kn,{templates:l.data,selected:v,onSelect:S}):o(V,{label:"Loading templates"})]}),s("div",{className:"dd-field-row",children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:h,onChange:g=>b(g.target.value),children:[o("option",{value:"",children:"Global (all projects)"}),r.map(g=>o("option",{value:g.id,children:g.name},g.id))]})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Tags"}),o("input",{className:"dd-input",value:w,placeholder:"sync, mobile",onChange:g=>q(g.target.value)})]})]}),s("label",{className:"dd-field",children:[s("span",{className:"dd-field-label",children:[o(J,{size:12,"aria-hidden":!0})," Brief for an agent ",o("span",{className:"dd-muted",children:"(optional)"})]}),o("textarea",{className:"dd-input",rows:4,value:N,maxLength:ds,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:g=>E(g.target.value)})]}),o("button",{type:"submit",hidden:!0})]})})}function cs({templates:e,onNew:a}){return o("div",{className:"dd-landing",children:s("div",{className:"dd-landing-inner",children:[o("span",{className:"dd-landing-icon",children:o(Ee,{size:26,"aria-hidden":!0})}),o("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),o("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),s("ul",{className:"dd-landing-points",children:[s("li",{children:[o(J,{size:13,"aria-hidden":!0})," ",o("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),s("li",{children:[o(Ce,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),s("li",{children:[o(ae,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),s("div",{className:"dd-landing-start",children:[o("span",{className:"dd-section-label",children:"Start from a template"}),e?o(kn,{templates:e,selected:null,onSelect:r=>a(r)}):o(V,{})]})]})})}function Xt({projectId:e,location:a,onLocationChange:r,variant:t,headerActions:n}){let d=je(),i=Rt(),[l,f]=C(null),u=d.data??[];return s("div",{className:"dd-root dd-workbench",children:[o(us,{projectId:t==="project"?e:null,showProjects:t==="global",projects:u,activeId:a.docId,onSelect:c=>r({docId:c,path:null}),onDeleted:c=>{c===a.docId&&r({docId:null,path:null})},onNew:()=>f({template:null}),headerActions:n}),o("main",{className:"dd-main",children:a.docId?o(At,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(c,x)=>r({docId:a.docId,path:c},x??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):o(cs,{templates:i.data,onNew:c=>f({template:c??null})})}),l?o(Wt,{initialTemplate:l.template,defaultProjectId:e,projects:u,onClose:()=>f(null),onCreated:c=>r({docId:c,path:null})}):null]})}var Pa="design-docs";function An({children:e}){return o("div",{className:"dd-root",children:e})}function Dn({subPath:e}){let a=ke();return o(Xt,{variant:"global",projectId:null,location:Ft(e),onLocationChange:(r,t)=>a.toPluginPanel(Pa,{subPath:Ia(r),...t?{replace:t}:{}})})}function Tn({projectId:e,headerActions:a}){let[r,t]=te(`project-location:${e}`,"");return o(Xt,{variant:"project",projectId:e,location:Ft(r),onLocationChange:n=>t(Ia(n)),headerActions:a})}function fs(e,a,r,t){e.openThreadPanel({actionId:$e,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...t?{threadId:t}:{}})||e.toPluginPanel(Pa,{subPath:Ia(a)})}function Mn({attributes:e,source:a,message:r}){let t=ke(),n=e.id?.trim()||null,d=e.path?.trim()||null,i=bt(n);if(!n||i.error)return o("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:n?`Design doc unavailable: ${i.error}`:"Invalid design doc link: an id is required."});let l=i.data;return s("div",{className:"plugin-directive-card dd-card",children:[s("button",{type:"button",className:"plugin-directive-card-main",disabled:!l,onClick:()=>l&&fs(t,{docId:l.id,path:d},l.title,r.threadId),title:l?`Open ${l.title} beside this conversation`:void 0,children:[o("span",{className:"dd-card-icon","aria-hidden":!0,children:o(Ee,{size:14})}),o("span",{className:"plugin-directive-card-kind",children:"Design doc"}),o("span",{className:"plugin-directive-card-title",children:l?l.title:"Loading\u2026"}),l?s("span",{className:"plugin-directive-card-meta dd-card-meta",children:[d?o("code",{children:d}):null,o(Ve,{status:l.status,compact:!0}),l.files.length," file",l.files.length===1?"":"s",l.openComments?` \xB7 ${l.openComments} open comment${l.openComments===1?"":"s"}`:""]}):o(V,{size:12})]}),l?o("button",{type:"button",className:"plugin-directive-card-open",onClick:f=>{f.stopPropagation(),t.toPluginPanel(Pa,{subPath:Ia({docId:l.id,path:d})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function ps({projectId:e,onPick:a}){let r=Ct({...e?{projectId:e}:{},status:"active"}),t=je(),n=xa(),[d,i]=C(!1);return s("div",{className:"dd-picker",children:[s("div",{className:"dd-picker-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",onClick:()=>i(!0),children:[o(ce,{size:13,"aria-hidden":!0})," New"]})]}),o("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(l=>s("button",{type:"button",className:"dd-doc-row",onClick:()=>a(l.id),children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:l.title}),o(Ve,{status:l.status,compact:!0})]}),l.summary?o("span",{className:"dd-doc-row-summary",children:l.summary}):null,s("span",{className:"dd-doc-row-meta",children:[s("span",{children:[l.fileCount," files"]}),o("span",{className:"dd-spacer"}),o(Y,{at:l.updatedAt,now:n})]})]},l.id)):o(me,{icon:Ee,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):o("div",{className:"dd-center",children:r.error?o("div",{className:"dd-banner dd-banner-error",children:r.error}):o(V,{})})}),d?o(Wt,{defaultProjectId:e,projects:t.data??[],onClose:()=>i(!1),onCreated:l=>a(l)}):null]})}function Rn(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function Fn(e){let{docId:a,path:r}=Rn(e.params);return o(ms,{...e},`${a}\0${r}`)}function ms({params:e,projectId:a}){let r=ke(),t=Rn(e),[n,d]=C(t),i=!t.docId;if(!n.docId)return o(An,{children:o(ps,{projectId:a??null,onPick:f=>d({docId:f,path:null})})});let l=n.docId;return o(An,{children:o(At,{docId:l,path:n.path,layout:"compact",contextProjectId:a??null,onOpenPath:f=>d({docId:l,path:f}),onDeleted:()=>d({docId:null,path:null}),headerExtra:s($,{children:[i?o(U,{icon:Ta,label:"All design docs",onClick:()=>d({docId:null,path:null})}):null,o(U,{icon:Ye,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(Pa,{subPath:Ia(n)})})]})},l)})}async function Bn({threadId:e,message:a,selectedText:r,openPanel:t}){let n=(r?.trim()||a.text).trim();if(!n){M("This message has no text to save.","error");return}try{let d=await Yt(Pr,"createFromMessage",{threadId:e,text:n});t({actionId:$e,title:d.title,params:{docId:d.id}}),M(`Saved \u201C${d.title}\u201D as a design doc`)}catch(d){M(`Could not save the design doc: ${O(d)}`,"error")}}var Kt=`
.dd-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 13px;
}
.dd-root *, .dd-root *::before, .dd-root *::after { box-sizing: border-box; }
.dd-root button { font: inherit; color: inherit; }
.dd-root :focus-visible { outline: 2px solid var(--focus-ring, var(--accent-blue)); outline-offset: 1px; }
.dd-spacer { flex: 1 1 auto; min-width: 0; }
.dd-muted { color: var(--text-muted); }
.dd-center { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-height: 120px; padding: 16px; }
.dd-spin { animation: dd-spin 0.9s linear infinite; }
@keyframes dd-spin { to { transform: rotate(360deg); } }
.dd-spinner { display: inline-flex; color: var(--text-muted); }
.dd-section-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dd-count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10.5px;
  line-height: 16px;
  text-align: center;
}
.dd-root code, .dd-pop code, .dd-dialog code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.92em; }
.dd-root kbd {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

/* \u2500\u2500 Inputs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-base));
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
}
.dd-input:focus { outline: none; border-color: var(--accent-blue); box-shadow: 0 0 0 1px var(--accent-blue); }
.dd-input::placeholder { color: var(--text-dim); }
.dd-select { appearance: auto; padding: 5px 6px; }
.dd-check { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; cursor: pointer; }
.dd-check code { color: var(--text-primary); }
.dd-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 0; }
.dd-field-row { display: flex; gap: 12px; }
.dd-field-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-primary); }
.dd-field-help { margin: 8px 0 0; font-size: 12px; }
.dd-field-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
.dd-field-inline .dd-select { width: auto; max-width: 180px; }
.dd-form { display: flex; flex-direction: column; gap: 14px; }

.dd-segmented {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-base);
}
.dd-segmented button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.dd-segmented button:hover:not(:disabled) { color: var(--text-primary); }
.dd-segmented button.on { background: var(--bg-elevated); color: var(--text-primary); box-shadow: 0 0 0 1px var(--border); }
.dd-segmented button:disabled { opacity: 0.4; cursor: default; }
.dd-btn-danger.btn.primary { background: var(--danger); border-color: var(--danger); }
.dd-icon-btn { flex: 0 0 auto; background: transparent; cursor: pointer; }
.dd-icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dd-icon-btn.danger:hover:not(:disabled) { color: var(--danger); }
.dd-icon-btn:disabled { opacity: 0.35; cursor: default; }

/* \u2500\u2500 Banners, empty states \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 12px;
}
.dd-banner-text { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dd-banner-warn { background: color-mix(in srgb, var(--accent-gold) 12%, var(--bg-panel)); border-color: color-mix(in srgb, var(--accent-gold) 35%, var(--border)); }
.dd-banner-warn > svg { color: var(--accent-gold); }
.dd-banner-error { margin: 8px; border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border)); border-radius: 6px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--bg-panel)); }
.dd-banner-info > svg { color: var(--accent-blue); }
.dd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 18px;
  text-align: center;
  color: var(--text-muted);
}
.dd-empty-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: 4px;
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text-muted);
}
.dd-empty-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.dd-empty-body { max-width: 280px; font-size: 12px; line-height: 1.5; }

/* \u2500\u2500 Status, actors, time \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-status {
  --dd-status: var(--text-muted);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dd-status) 14%, transparent);
  color: var(--dd-status);
  font-size: 11.5px;
  font-weight: 550;
  white-space: nowrap;
}
.dd-status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dd-status-compact { height: 18px; padding: 0 6px; font-size: 10.5px; }
.dd-status-review { --dd-status: var(--accent-gold); }
.dd-status-approved { --dd-status: var(--success); }
.dd-status-implemented { --dd-status: var(--accent-blue); }
.dd-status-archived { --dd-status: var(--text-dim); }
.dd-status-button { padding: 0; border: 0; background: none; cursor: pointer; border-radius: 999px; }
.dd-status-button:hover .dd-status { filter: brightness(1.15); }
.dd-actor { display: inline-flex; align-items: center; gap: 4px; min-width: 0; color: var(--text-muted); }
.dd-actor-agent { color: var(--accent-blue); }
.dd-actor-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.dd-time { color: var(--text-dim); white-space: nowrap; font-size: 11.5px; }
.dd-file-icon { flex: 0 0 auto; color: var(--text-muted); }
.dd-kind-mermaid, .dd-kind-svg { color: var(--accent-blue); }
.dd-kind-html { color: var(--accent-gold); }
.dd-kind-image { color: var(--success); }

/* \u2500\u2500 Popovers, menus, dialogs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-pop-anchor { position: relative; display: inline-flex; flex: 0 0 auto; }
.dd-pop {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 40;
  min-width: 200px;
  padding: 4px;
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  font-size: 13px;
}
.dd-context-menu { position: fixed; z-index: 60; }
.dd-pop-end { right: 0; }
.dd-pop-start { left: 0; }
.dd-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.dd-menu-item:hover { background: var(--bg-hover); }
.dd-menu-item > svg { color: var(--text-muted); flex: 0 0 auto; }
.dd-menu-label { flex: 1 1 auto; min-width: 0; }
.dd-menu-hint { color: var(--text-dim); font-size: 11.5px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-menu-danger, .dd-menu-danger > svg { color: var(--danger); }
.dd-menu-checked { background: color-mix(in srgb, var(--accent-blue) 12%, transparent); }
.dd-menu-section { padding: 6px 8px 2px; font-size: 10.5px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); }

.dd-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}
.dd-dialog {
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  max-height: min(760px, 100%);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 10px;
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  font-size: 13px;
}
.dd-dialog-wide { width: min(680px, 100%); }
.dd-dialog-header { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--border); }
.dd-dialog-title { flex: 1 1 auto; font-size: 14px; font-weight: 600; }
.dd-dialog-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px; }
.dd-dialog-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
.dd-dialog-hint { font-size: 12px; }
.dd-confirm-body { line-height: 1.55; }

/* \u2500\u2500 Workbench: list | doc \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-workbench { flex-direction: row; }
.dd-list {
  display: flex;
  flex-direction: column;
  flex: 0 0 280px;
  width: 280px;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-base);
}
.dd-list-head, .dd-picker-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
}
.dd-list-title { font-size: 13px; font-weight: 650; }
.dd-new { height: 26px; padding: 0 10px; }
.dd-list-tools { display: flex; align-items: center; gap: 4px; padding: 8px 8px 6px 10px; }
.dd-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  color: var(--text-dim);
}
.dd-search:focus-within { border-color: var(--accent-blue); }
.dd-search input { flex: 1 1 auto; min-width: 0; border: 0; outline: none; background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; }
.dd-search-clear { display: grid; place-items: center; padding: 2px; border: 0; border-radius: 4px; background: none; color: var(--text-muted); cursor: pointer; }
.dd-list-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 6px 12px; }
.dd-list-empty { padding: 20px 10px; text-align: center; font-size: 12px; }
.dd-doc-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  margin-bottom: 2px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dd-doc-row:hover { background: var(--bg-hover); }
.dd-doc-row.on { background: var(--bg-elevated); border-color: var(--border); }
.dd-doc-row-top { display: flex; align-items: flex-start; gap: 8px; }
.dd-doc-row-title { flex: 1 1 auto; min-width: 0; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.dd-doc-row-summary {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.dd-doc-row-meta { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 11.5px; }
.dd-doc-row-meta > span { display: inline-flex; align-items: center; gap: 3px; }
.dd-doc-row-project { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
.dd-doc-row-comments { color: var(--accent-gold); }
.dd-main { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }

/* \u2500\u2500 Landing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-landing { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dd-landing-inner { max-width: 760px; margin: 0 auto; padding: 56px 32px 48px; }
.dd-landing-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 18px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent-blue) 16%, var(--bg-elevated));
  color: var(--accent-blue);
}
.dd-landing-title { margin: 0 0 10px; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; color: var(--text-bright, var(--text-primary)); }
.dd-landing-lede { margin: 0 0 18px; max-width: 620px; color: var(--text-muted); font-size: 14px; line-height: 1.6; }
.dd-landing-points { display: flex; flex-direction: column; gap: 8px; margin: 0 0 32px; padding: 0; list-style: none; color: var(--text-muted); }
.dd-landing-points li { display: flex; align-items: baseline; gap: 8px; line-height: 1.5; }
.dd-landing-points svg { flex: 0 0 auto; position: relative; top: 2px; color: var(--accent-blue); }
.dd-landing-points strong { color: var(--text-primary); }
.dd-landing-start { display: flex; flex-direction: column; gap: 10px; }
.dd-templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.dd-template {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  text-align: left;
  cursor: pointer;
}
.dd-template:hover { border-color: var(--border-strong, var(--border)); background: var(--bg-hover); }
.dd-template.on { border-color: var(--accent-blue); box-shadow: 0 0 0 1px var(--accent-blue); }
.dd-template-label { font-weight: 600; }
.dd-template-desc { color: var(--text-muted); font-size: 12px; line-height: 1.45; }
.dd-template-files { margin-top: 2px; color: var(--text-dim); font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; }

/* \u2500\u2500 Doc \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-doc { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.dd-doc-header { flex: 0 0 auto; padding: 12px 16px 10px 20px; border-bottom: 1px solid var(--border); }
.dd-doc-header-compact { padding: 8px 8px 8px 12px; }
.dd-doc-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dd-doc-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; min-width: 0; }
.dd-doc-project { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 12px; }
.dd-doc-updated { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.dd-editable {
  display: block;
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px;
  margin-left: -6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: text;
  overflow-wrap: anywhere;
}
.dd-editable:hover { border-color: var(--border); background: var(--bg-elevated); }
.dd-editable-empty { color: var(--text-dim); font-style: italic; }
.dd-editable-input {
  min-width: 0;
  flex: 1 1 auto;
  margin-left: -6px;
  padding: 2px 6px;
  border: 1px solid var(--accent-blue);
  border-radius: 6px;
  outline: none;
  background: var(--bg-input, var(--bg-base));
  color: var(--text-primary);
  font: inherit;
  resize: none;
}
.dd-doc-title { font-size: 18px; font-weight: 650; line-height: 1.3; letter-spacing: -0.01em; color: var(--text-bright, var(--text-primary)); flex: 0 1 auto; }
.dd-doc-header-compact .dd-doc-title { font-size: 14px; }
input.dd-doc-title { width: 100%; }
.dd-doc-summary { margin-top: 2px; color: var(--text-muted); font-size: 13px; line-height: 1.5; width: 100%; }
textarea.dd-doc-summary { display: block; }
.dd-tags { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.dd-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
}
.dd-tag-add { border-style: dashed; cursor: pointer; }
.dd-tag-add:hover { color: var(--text-primary); }
/* Collapsed, not display:none, so keyboard users can still tab to it. */
.dd-tag-remove { display: inline-flex; width: 0; overflow: hidden; opacity: 0; padding: 0; margin-left: 0; border: 0; background: none; color: inherit; cursor: pointer; }
.dd-tag:hover .dd-tag-remove, .dd-tag-remove:focus-visible { width: 10px; margin-left: 2px; opacity: 1; }
.dd-tag-input { width: 140px; height: 22px; padding: 0 6px; font-size: 12px; }
.dd-doc-body { position: relative; display: flex; flex: 1 1 auto; min-height: 0; }

/* Ask agent */
.dd-ask-trigger { height: 28px; padding: 0 10px; }
.dd-ask-compact { padding: 0 8px; gap: 4px; }
.dd-ask { width: 360px; padding: 0; }
.dd-ask-head { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px 8px; }
.dd-ask-head .dd-muted { font-size: 12px; }
.dd-ask-title { font-weight: 650; }
.dd-ask-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 0 8px 8px; }
.dd-ask-action {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-panel);
  text-align: left;
  cursor: pointer;
}
.dd-ask-action:hover:not(:disabled) { border-color: var(--accent-blue); background: color-mix(in srgb, var(--accent-blue) 8%, var(--bg-panel)); }
.dd-ask-action:disabled { opacity: 0.6; cursor: default; }
.dd-ask-action-icon { display: grid; place-items: center; flex: 0 0 auto; width: 22px; height: 22px; border-radius: 6px; background: color-mix(in srgb, var(--accent-blue) 14%, transparent); color: var(--accent-blue); }
.dd-ask-action-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dd-ask-action-label { font-size: 12.5px; font-weight: 600; }
.dd-ask-action-desc { color: var(--text-muted); font-size: 11px; line-height: 1.35; }
.dd-ask-custom { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-top: 1px solid var(--border); }
.dd-ask-options { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }

/* \u2500\u2500 File tree \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-tree { display: flex; flex-direction: column; flex: 0 0 220px; width: 220px; min-height: 0; border-right: 1px solid var(--border); background: var(--bg-base); }
.dd-tree-head { display: flex; align-items: center; gap: 4px; height: 36px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--border); }
.dd-tree-count { color: var(--text-dim); font-size: 11px; }
.dd-tree-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 4px 12px; }
.dd-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 26px;
  padding-right: 2px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
}
.dd-tree-folder { gap: 5px; color: var(--text-muted); cursor: pointer; }
.dd-tree-folder:hover, .dd-tree-file:hover { background: var(--bg-hover); }
.dd-tree-file.on { background: color-mix(in srgb, var(--accent-blue) 16%, transparent); }
.dd-tree-file.on .dd-tree-name { color: var(--text-bright, var(--text-primary)); font-weight: 550; }
.dd-tree-open { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; height: 26px; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
.dd-tree-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-tree-entry { flex: 0 0 auto; color: var(--text-dim); }
.dd-tree-badge { flex: 0 0 auto; margin-left: auto; min-width: 16px; padding: 0 4px; border-radius: 999px; background: color-mix(in srgb, var(--accent-gold) 22%, transparent); color: var(--accent-gold); font-size: 10px; line-height: 15px; text-align: center; }
.dd-tree-row .dd-pop-anchor { visibility: hidden; }
.dd-tree-row:hover .dd-pop-anchor, .dd-tree-row:focus-within .dd-pop-anchor, .dd-tree-row .dd-pop-anchor:has(.dd-pop) { visibility: visible; }
.dd-tree-row .icon-btn { width: 22px; height: 22px; }
.dd-tree-input { flex: 1 1 auto; padding: 2px 0; }
.dd-tree-input .dd-input { height: 24px; padding: 0 6px; font-size: 12.5px; }
.dd-switcher-pop { padding: 0; width: 280px; max-height: 60vh; display: flex; }
.dd-switcher-pop .dd-tree { flex: 1 1 auto; width: auto; border: 0; border-radius: 8px; max-height: 60vh; }
.dd-switcher {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-base);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.dd-switcher:hover { color: var(--text-primary); }

/* \u2500\u2500 File pane \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-file-pane { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.dd-file-toolbar { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; height: 36px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--border); min-width: 0; }
.dd-file-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
.dd-file-dir { color: var(--text-dim); }
.dd-file-name { color: var(--text-primary); font-weight: 550; }
.dd-file-meta { display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; white-space: nowrap; color: var(--text-dim); font-size: 11.5px; }
.dd-flash {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-blue) 16%, transparent);
  color: var(--accent-blue);
  font-size: 11.5px;
  white-space: nowrap;
  animation: dd-flash-in 0.25s ease-out;
}
@keyframes dd-flash-in { from { opacity: 0; transform: translateY(-3px); } }
.dd-file-body { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-doc-compact .dd-file-meta, .dd-doc-compact .dd-mode-label { display: none; }
.dd-preview-html, .dd-preview-image { overflow: hidden; }
.dd-preview-image .dd-image-stage { height: 100%; overflow: auto; }

/* Preview */
.dd-preview { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; }
.dd-prose { max-width: 860px; margin: 0 auto; padding: 28px 40px 96px; }
.dd-doc-compact .dd-prose { padding: 16px 16px 64px; }
.dd-prose .inbox-md { font-size: 14px; line-height: 1.7; }
.dd-prose .inbox-md h1 { margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border); font-size: 26px; line-height: 1.25; letter-spacing: -0.015em; color: var(--text-bright, var(--text-primary)); }
.dd-prose .inbox-md h2 { margin: 32px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); font-size: 19px; line-height: 1.3; color: var(--text-bright, var(--text-primary)); }
.dd-prose .inbox-md h3 { margin: 24px 0 8px; font-size: 15.5px; }
.dd-prose .inbox-md h4 { margin: 18px 0 6px; font-size: 14px; color: var(--text-muted); }
.dd-prose .inbox-md p, .dd-prose .inbox-md ul, .dd-prose .inbox-md ol { margin: 0 0 14px; }
.dd-prose .inbox-md li { margin: 3px 0; }
.dd-prose .inbox-md blockquote { margin: 0 0 14px; padding: 6px 14px; border-left: 3px solid var(--accent-blue); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--accent-blue) 6%, transparent); color: var(--text-muted); }
.dd-prose .inbox-md table { font-size: 13px; }
.dd-prose .inbox-md img { max-width: 100%; border-radius: 6px; }
.dd-prose .inbox-md input[type='checkbox'] { margin-right: 6px; }
.dd-prose-mermaid, .dd-prose-code { max-width: none; }
.dd-prose-mermaid .inbox-md pre:has(svg), .dd-prose-mermaid .inbox-md svg { background: transparent; }
.dd-plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; line-height: 1.6; }
.dd-image-stage {
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 32px;
  background-color: var(--bg-base);
  background-image: linear-gradient(45deg, var(--bg-hover) 25%, transparent 25%, transparent 75%, var(--bg-hover) 75%), linear-gradient(45deg, var(--bg-hover) 25%, transparent 25%, transparent 75%, var(--bg-hover) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}
.dd-image-stage img { max-width: 100%; max-height: 100%; border-radius: 4px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2); }
.dd-html-stage { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dd-html-toolbar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 4px 8px; border-bottom: 1px solid var(--border); background: var(--bg-base); }
.dd-html-status { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.dd-html-widths { display: inline-flex; gap: 2px; }
.dd-html-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
.dd-html-viewport { position: relative; display: flex; justify-content: center; flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--bg-base); }
.dd-page-badge { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--accent-gold) 40%, var(--border)); border-radius: 12px; background: color-mix(in srgb, var(--accent-gold) 12%, transparent); color: var(--text-primary); font-size: 12px; font-variant-numeric: tabular-nums; cursor: pointer; }
.dd-page-badge svg { color: var(--accent-gold); }
.dd-page-badge:hover { background: color-mix(in srgb, var(--accent-gold) 20%, transparent); }
.dd-page-problems { width: min(440px, 80vw); max-height: 320px; overflow: auto; }
.dd-page-problems ul { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.dd-page-problem { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; padding: 6px 8px; border-radius: 5px; font-size: 12px; line-height: 1.45; }
.dd-page-problem:hover { background: var(--bg-hover); }
.dd-page-problem-kind { grid-row: span 2; align-self: start; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--bg-hover); }
.dd-page-problem-error .dd-page-problem-kind { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.dd-page-problem-missing .dd-page-problem-kind { color: var(--accent-gold); background: color-mix(in srgb, var(--accent-gold) 14%, transparent); }
.dd-page-problem-blocked .dd-page-problem-kind { color: var(--accent-blue); background: color-mix(in srgb, var(--accent-blue) 12%, transparent); }
.dd-page-problem-message { overflow-wrap: anywhere; }
.dd-page-problem-source { grid-column: 2; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; overflow-wrap: anywhere; }
.dd-html-frame { flex: 1 1 auto; width: 100%; height: 100%; min-height: 360px; border: 0; background: var(--bg-panel); }
.dd-html-frame-device { flex: 0 0 auto; margin: 16px; height: calc(100% - 32px); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25); }

/* Comment highlights (CSS Custom Highlight API) */
::highlight(dd-comment) { background-color: color-mix(in srgb, var(--accent-gold) 28%, transparent); text-decoration: underline; text-decoration-color: var(--accent-gold); text-decoration-thickness: 2px; }
::highlight(dd-comment-focus) { background-color: color-mix(in srgb, var(--accent-gold) 55%, transparent); }

.dd-selection-chip {
  position: absolute;
  z-index: 20;
  display: flex;
  gap: 2px;
  padding: 3px;
  transform: translateX(-50%);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.dd-selection-chip button { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dd-selection-chip button:hover { background: var(--bg-hover); }
.dd-selection-chip svg { color: var(--accent-blue); }

/* Editor */
.dd-editor { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-editor-body { display: flex; flex: 1 1 auto; min-height: 0; }
.dd-editor-input {
  flex: 1 1 0;
  min-width: 0;
  padding: 20px 24px 64px;
  border: 0;
  outline: none;
  resize: none;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  line-height: 1.65;
  tab-size: 2;
}
.dd-editor-split .dd-editor-input { border-right: 1px solid var(--border); background: var(--bg-base); }
.dd-editor-preview { display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }
.dd-editor-preview .dd-prose { padding: 20px 28px 64px; }
.dd-editor-footer { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; height: 40px; padding: 0 10px 0 14px; border-top: 1px solid var(--border); }
.dd-editor-state { display: inline-flex; align-items: center; gap: 6px; flex: 1 1 auto; color: var(--text-muted); font-size: 12px; }
.dd-editor-hint { color: var(--text-dim); font-size: 11.5px; }
.dd-editor-footer .btn { height: 26px; }

/* Revision view + diff */
.dd-revision { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-revision-banner { flex: 0 0 auto; }
.dd-revision-note { color: var(--text-muted); }
.dd-revision-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: auto; }
.dd-revision-hint { margin: 12px 16px 0; font-size: 12px; }
.dd-diff { padding: 12px 0 48px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; line-height: 1.6; }
.dd-diff-stats { display: flex; gap: 10px; padding: 0 16px 10px; font-size: 12px; }
.dd-diff-added { color: var(--success); }
.dd-diff-removed { color: var(--danger); }
.dd-diff-line { display: flex; padding: 0 16px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dd-diff-sign { flex: 0 0 28px; text-align: center; color: var(--text-dim); user-select: none; }
.dd-diff-text { flex: 1 1 auto; min-width: 0; }
.dd-diff-add { background: color-mix(in srgb, var(--success) 13%, transparent); }
.dd-diff-add .dd-diff-sign { color: var(--success); }
.dd-diff-del { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.dd-diff-del .dd-diff-sign { color: var(--danger); }
.dd-diff-del .dd-diff-text { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.dd-diff-gap { margin: 4px 0; padding: 2px 16px 2px 28px; background: var(--bg-base); color: var(--text-dim); font-size: 11.5px; }

/* \u2500\u2500 Rail \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-rail { display: flex; flex-direction: column; flex: 0 0 320px; width: 320px; min-height: 0; border-left: 1px solid var(--border); background: var(--bg-base); }
.dd-rail-floating .dd-rail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 15; width: min(340px, 100%); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.25); }
.dd-rail-tabs { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; height: 36px; padding: 0 6px; border-bottom: 1px solid var(--border); }
.dd-rail-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.dd-rail-tab:hover { color: var(--text-primary); }
.dd-rail-tab.on { background: var(--bg-elevated); color: var(--text-primary); box-shadow: 0 0 0 1px var(--border); }
.dd-rail-pane { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-rail-toolbar { display: flex; align-items: center; padding: 8px 10px 4px; }
.dd-rail-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 10px 12px; }

.dd-comment { margin-bottom: 8px; padding: 9px 10px 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
.dd-comment-resolved { opacity: 0.7; }
.dd-comment-head { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.dd-comment-head .icon-btn { width: 22px; height: 22px; }
.dd-comment-anchor { display: flex; flex-direction: column; gap: 3px; width: 100%; margin: 6px 0 2px; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
.dd-comment-anchor:disabled { cursor: default; }
.dd-comment-path { color: var(--text-dim); font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; }
.dd-comment-path-gone { font-style: italic; }
.dd-comment-quote {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding-left: 8px;
  border-left: 2px solid var(--accent-gold);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.dd-comment-anchor:hover:not(:disabled) .dd-comment-quote { color: var(--text-primary); }
.dd-comment-body .inbox-md { font-size: 12.5px; line-height: 1.55; }
.dd-comment-body .inbox-md p { margin: 4px 0 6px; }
.dd-replies { margin: 2px 0 6px; padding: 0 0 0 10px; border-left: 1px solid var(--border); list-style: none; }
.dd-reply { padding: 4px 0 0; }
.dd-reply .dd-comment-head { font-size: 11.5px; }
.dd-reply .icon-btn { width: 20px; height: 20px; }
.dd-reply-composer { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
.dd-reply-composer .dd-composer-input { min-height: 48px; }
.dd-reply-buttons { display: inline-flex; gap: 6px; }
.dd-resolved { margin-top: 8px; }
.dd-disclosure { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 6px; padding: 2px 0; border: 0; background: none; color: var(--text-muted); font-size: 12px; cursor: pointer; }
.dd-composer { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; padding: 10px; border-top: 1px solid var(--border); }
.dd-composer-quote { display: flex; align-items: flex-start; gap: 4px; }
.dd-composer-quote .dd-comment-quote { flex: 1 1 auto; }
.dd-composer-input { min-height: 64px; font-size: 12.5px; }
.dd-composer-actions { display: flex; align-items: center; justify-content: space-between; }
.dd-composer-actions .btn { height: 26px; }

.dd-history-list { margin: 0; padding: 0; list-style: none; }
.dd-history-row { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; }
.dd-history-row:hover { background: var(--bg-hover); }
.dd-history-row.on { background: color-mix(in srgb, var(--accent-blue) 14%, transparent); }
.dd-op { flex: 0 0 auto; margin-top: 2px; color: var(--text-muted); }
.dd-op-create { color: var(--success); }
.dd-op-delete { color: var(--danger); }
.dd-op-rename { color: var(--accent-gold); }
.dd-history-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dd-history-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; font-size: 12.5px; font-weight: 550; }
.dd-history-path { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px; font-weight: 400; color: var(--text-muted); overflow-wrap: anywhere; }
.dd-history-rev { color: var(--text-dim); font-size: 11px; font-weight: 400; }
.dd-history-note { color: var(--text-muted); font-size: 12px; }
.dd-history-meta { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }

.dd-thread-list { margin: 0 0 12px; padding: 0; list-style: none; }
.dd-thread { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; padding-right: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
.dd-thread-open { display: flex; align-items: flex-start; gap: 8px; flex: 1 1 auto; min-width: 0; padding: 8px 10px; border: 0; background: none; text-align: left; cursor: pointer; }
.dd-thread-open > svg { flex: 0 0 auto; margin-top: 2px; color: var(--accent-blue); }
.dd-thread-open:hover .dd-thread-title { color: var(--accent-blue); }
.dd-thread-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dd-thread-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.dd-thread-meta { display: flex; align-items: center; gap: 6px; }
.dd-role { padding: 0 6px; border-radius: 999px; background: var(--bg-hover); color: var(--text-muted); font-size: 10.5px; line-height: 16px; }
.dd-role-reviewer { background: color-mix(in srgb, var(--accent-gold) 18%, transparent); color: var(--accent-gold); }
.dd-role-editor, .dd-role-author { background: color-mix(in srgb, var(--accent-blue) 16%, transparent); color: var(--accent-blue); }
.dd-agents-hint { display: flex; gap: 8px; padding: 10px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.dd-agents-hint > svg { flex: 0 0 auto; margin-top: 2px; }

/* \u2500\u2500 Thread panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-picker { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-picker .dd-list-scroll { padding-top: 6px; }

/* \u2500\u2500 Chat card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.dd-card-icon { display: grid; place-items: center; flex: 0 0 auto; width: 24px; height: 24px; border-radius: 6px; background: color-mix(in srgb, var(--accent-blue) 16%, transparent); color: var(--accent-blue); }
.dd-card-meta { display: inline-flex; align-items: center; gap: 6px; }
.dd-card-meta code { color: var(--text-muted); font-size: 11.5px; }

/* \u2500\u2500 Narrow workbench \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
@media (max-width: 900px) {
  .dd-list { flex-basis: 220px; width: 220px; }
  .dd-tree { flex-basis: 180px; width: 180px; }
  .dd-mode-label, .dd-file-meta { display: none; }
}
`;var Nn="design-docs-plugin-styles";function gs(){if(typeof document>"u")return;let e=document.getElementById(Nn);if(e instanceof HTMLStyleElement){e.textContent=Kt;return}let a=document.createElement("style");a.id=Nn,a.textContent=Kt,document.head.appendChild(a)}gs();var $m=eo(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:Pa,component:Dn}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:Tn}),e.slots.messageDirective({id:"design-doc",component:Mn}),e.slots.threadPanelAction({id:$e,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:Fn}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:Bn})});export{$m as default,gs as injectStyles};
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
lucide-react/dist/esm/icons/archive-restore.mjs:
lucide-react/dist/esm/icons/archive.mjs:
lucide-react/dist/esm/icons/arrow-left.mjs:
lucide-react/dist/esm/icons/at-sign.mjs:
lucide-react/dist/esm/icons/bot.mjs:
lucide-react/dist/esm/icons/check-check.mjs:
lucide-react/dist/esm/icons/check.mjs:
lucide-react/dist/esm/icons/chevron-down.mjs:
lucide-react/dist/esm/icons/chevron-right.mjs:
lucide-react/dist/esm/icons/columns-2.mjs:
lucide-react/dist/esm/icons/copy.mjs:
lucide-react/dist/esm/icons/corner-down-right.mjs:
lucide-react/dist/esm/icons/drafting-compass.mjs:
lucide-react/dist/esm/icons/ellipsis.mjs:
lucide-react/dist/esm/icons/external-link.mjs:
lucide-react/dist/esm/icons/eye.mjs:
lucide-react/dist/esm/icons/file-code.mjs:
lucide-react/dist/esm/icons/file-exclamation-point.mjs:
lucide-react/dist/esm/icons/file-image.mjs:
lucide-react/dist/esm/icons/file-pen.mjs:
lucide-react/dist/esm/icons/file-plus-corner.mjs:
lucide-react/dist/esm/icons/file-text.mjs:
lucide-react/dist/esm/icons/file-type.mjs:
lucide-react/dist/esm/icons/file-x-corner.mjs:
lucide-react/dist/esm/icons/folder-input.mjs:
lucide-react/dist/esm/icons/folder-open.mjs:
lucide-react/dist/esm/icons/folder.mjs:
lucide-react/dist/esm/icons/funnel.mjs:
lucide-react/dist/esm/icons/globe.mjs:
lucide-react/dist/esm/icons/hash.mjs:
lucide-react/dist/esm/icons/house.mjs:
lucide-react/dist/esm/icons/list-checks.mjs:
lucide-react/dist/esm/icons/loader-circle.mjs:
lucide-react/dist/esm/icons/message-square-plus.mjs:
lucide-react/dist/esm/icons/message-square-text.mjs:
lucide-react/dist/esm/icons/message-square.mjs:
lucide-react/dist/esm/icons/monitor.mjs:
lucide-react/dist/esm/icons/move-right.mjs:
lucide-react/dist/esm/icons/panel-right.mjs:
lucide-react/dist/esm/icons/pencil.mjs:
lucide-react/dist/esm/icons/plus.mjs:
lucide-react/dist/esm/icons/reply.mjs:
lucide-react/dist/esm/icons/rotate-ccw-clock.mjs:
lucide-react/dist/esm/icons/rotate-ccw.mjs:
lucide-react/dist/esm/icons/save.mjs:
lucide-react/dist/esm/icons/scan-search.mjs:
lucide-react/dist/esm/icons/search.mjs:
lucide-react/dist/esm/icons/smartphone.mjs:
lucide-react/dist/esm/icons/sparkles.mjs:
lucide-react/dist/esm/icons/star.mjs:
lucide-react/dist/esm/icons/tablet.mjs:
lucide-react/dist/esm/icons/trash.mjs:
lucide-react/dist/esm/icons/triangle-alert.mjs:
lucide-react/dist/esm/icons/unlink.mjs:
lucide-react/dist/esm/icons/user.mjs:
lucide-react/dist/esm/icons/wand-sparkles.mjs:
lucide-react/dist/esm/icons/workflow.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.47.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
