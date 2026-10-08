function Wn(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function xt(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function ao(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function to(e,a,r){return Wn().callRpc(e,a,r)}function oo(e){return{__zccPluginApp:!0,setup:e}}function ro(){return xt().useRpc?.()??ao("useRpc")}function no(e,a){xt().useRealtime?.(e,a)}function ke(){return xt().useZccNavigate?.()??ao("useZccNavigate")}function Xn(){return globalThis.__ZCC_HOST_REACT__}function Kn(e,a){let r=Xn(),t=xt()[e];return!r||!t?null:r.createElement(t,a)}function va(e){return Kn("Markdown",e)}var H=globalThis.__ZCC_HOST_REACT__;var Vs=H.Children,$s=H.Component,Ws=H.Fragment,Xs=H.StrictMode,Ks=H.Suspense,Zs=H.cloneElement,so=H.createContext,ga=H.createElement,Js=H.createRef,ht=H.forwardRef,Qs=H.isValidElement,Ys=H.lazy,el=H.memo,al=H.startTransition,he=H.useCallback,lo=H.useContext,tl=H.useDebugValue,io=H.useDeferredValue,E=H.useEffect,ol=H.useId,rl=H.useImperativeHandle,nl=H.useInsertionEffect,Lt=H.useLayoutEffect,X=H.useMemo,dl=H.useReducer,D=H.useRef,b=H.useState,sl=H.useSyncExternalStore,ll=H.useTransition,il=H.version;var uo=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function co(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:uo(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var fo=e=>{let a="",r=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){r=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=r?t.toUpperCase():t,r=!1}return a};var po=e=>{let a=fo(e);return a.charAt(0).toUpperCase()+a.slice(1)};var ka=(...e)=>e.filter((a,r,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===r).join(" ").trim();var Be={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function Rt(e){return e!=null}function mo(e,a={}){let r=a.attributeNames??{},t=L=>r[L]??L,n=e.size??e.width??Be.width,d=e.size??e.height??Be.height,u=e.aliases?.filter(L=>typeof L=="string"&&L.trim()!=="").map(L=>`lucide-${L}`)??[],l=[...e.name?[`lucide-${e.name}`]:[],...u],c=a.className?.split(" ").filter(Boolean)??[],f=a.includeDefaultClasses===!1?ka(...c):ka("lucide",...l,...c),i=a.absoluteStrokeWidth?Number(a.strokeWidth??Be["stroke-width"])*Number(e.size??e.width??Be.width)/Number(a.size??a.width??Be.width):a.strokeWidth??Be["stroke-width"];return["svg",{...Object.entries(Be).reduce((L,[S,g])=>(L[t(S)]=g,L),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&Rt(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&Rt(a.width)&&{[t("width")]:a.width},..."height"in a&&Rt(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:i,...f&&{[t("class")]:f},[t("viewBox")]:`0 0 ${n} ${d}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(L=>{let[S,g,I]=L,P=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...g}:g;return I?[S,P,I]:[S,P]})]}function go(e,a={}){return mo(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var xo=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Zn=so({});var ho=()=>lo(Zn);var Lo=ht(({color:e,size:a,width:r,height:t,strokeWidth:n,absoluteStrokeWidth:d,nonScalingStroke:u,className:l="",children:c,iconNode:f=[],icon:i={node:f,aliases:[],size:24},...m},L)=>{let{size:S=24,strokeWidth:g=2,absoluteStrokeWidth:I=!1,nonScalingStroke:P=!1,color:q="currentColor",className:R=""}=ho()??{},N=!!c||xo(m),[w,F,k=[]]=go(i,{color:e??q,width:r??a??S,height:t??a??S,strokeWidth:n??g,absoluteStrokeWidth:d??I,nonScalingStroke:u??P,className:ka(R,l),hasA11yProp:N,attributes:m});return ga(w,{ref:L,...F},[...k.map(([T,p])=>ga(T,p)),...Array.isArray(c)?c:[c]])});function x(e,a=[],r=[]){let t=typeof e=="string"?co(e,a,r):e,n=ht(({className:d,...u},l)=>ga(Lo,{ref:l,icon:t,className:d,...u}));return t.name&&(n.displayName=po(t.name)),n}var Io={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};Io.node;var Aa=x(Io);var Co={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};Co.node;var Da=x(Co);var bo={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};bo.node;var Ta=x(bo);var So={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};So.node;var Ma=x(So);var yo={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};yo.node;var ae=x(yo);var Po={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};Po.node;var Ra=x(Po);var wo={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};wo.node;var Je=x(wo);var vo={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};vo.node;var ie=x(vo);var ko={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};ko.node;var Qe=x(ko);var Ao={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};Ao.node;var Ne=x(Ao);var Do={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};Do.node;var Fa=x(Do);var To={name:"corner-down-right",size:24,node:[["path",{d:"m15 10 5 5-5 5",key:"qqa56n"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12",key:"z08zvw"}]]};To.node;var Ba=x(To);var Mo={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};Mo.node;var Ee=x(Mo);var Ro={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};Ro.node;var Na=x(Ro);var Fo={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};Fo.node;var Le=x(Fo);var Bo={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};Bo.node;var Ye=x(Bo);var No={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};No.node;var Ea=x(No);var Eo={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};Eo.node;var qa=x(Eo);var qo={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};qo.node;var ue=x(qo);var Oo={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};Oo.node;var Oa=x(Oo);var Ho={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};Ho.node;var qe=x(Ho);var Uo={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};Uo.node;var Ie=x(Uo);var _o={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};_o.node;var ea=x(_o);var zo={name:"file-type",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M11 18h2",key:"12mj7e"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5",key:"qbrxap"}]]};zo.node;var Ha=x(zo);var Go={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};Go.node;var Oe=x(Go);var jo={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};jo.node;var Ua=x(jo);var Vo={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};Vo.node;var aa=x(Vo);var $o={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};$o.node;var _a=x($o);var Wo={name:"funnel",size:24,node:[["path",{d:"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z",key:"sc7q7i"}]],aliases:["filter"]};Wo.node;var He=x(Wo);var Xo={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};Xo.node;var za=x(Xo);var Ko={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};Ko.node;var ta=x(Ko);var Zo={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};Zo.node;var Ue=x(Zo);var Jo={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};Jo.node;var Ga=x(Jo);var Qo={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};Qo.node;var _e=x(Qo);var Yo={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};Yo.node;var oa=x(Yo);var er={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};er.node;var ja=x(er);var ar={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};ar.node;var Ce=x(ar);var tr={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};tr.node;var Va=x(tr);var or={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};or.node;var $a=x(or);var rr={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};rr.node;var Wa=x(rr);var nr={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};nr.node;var ra=x(nr);var dr={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};dr.node;var ce=x(dr);var sr={name:"reply",size:24,node:[["path",{d:"M20 18v-2a4 4 0 0 0-4-4H4",key:"5vmcpk"}],["path",{d:"m9 17-5-5 5-5",key:"nvlc11"}]]};sr.node;var Xa=x(sr);var lr={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};lr.node;var fe=x(lr);var ir={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};ir.node;var Ae=x(ir);var ur={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};ur.node;var Ka=x(ur);var cr={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};cr.node;var Za=x(cr);var fr={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};fr.node;var Ja=x(fr);var pr={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};pr.node;var Qa=x(pr);var mr={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};mr.node;var J=x(mr);var gr={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};gr.node;var Ya=x(gr);var xr={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};xr.node;var et=x(xr);var hr={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};hr.node;var oe=x(hr);var Lr={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};Lr.node;var pe=x(Lr);var Ir={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};Ir.node;var at=x(Ir);var Cr={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};Cr.node;var tt=x(Cr);var br={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};br.node;var ze=x(br);var Sr={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};Sr.node;var ot=x(Sr);var yr={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};yr.node;var Q=x(yr);var Pr=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];var It=4e3;function Jn(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function Qn(e){let a=(t,n)=>e(t,n===void 0?void 0:Jn(n)),r=async t=>{await t};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(t={})=>a("list",t),get:t=>a("get",{doc:t}),create:t=>a("create",t),update:(t,n)=>a("update",{doc:t,...n}),remove:t=>r(a("remove",{doc:t})),readFile:(t,n)=>a("readFile",{doc:t,path:n}),renderPage:(t,n)=>a("renderPage",{doc:t,...n}),readPageFile:(t,n)=>a("readPageFile",{doc:t,path:n}),pageLink:(t,n)=>a("pageLink",{doc:t,path:n}),siteFiles:t=>a("siteFiles",{doc:t}),reportRender:(t,n)=>r(a("reportRender",{doc:t,...n})),writeFile:(t,n)=>a("writeFile",{doc:t,...n}),editFile:(t,n)=>a("editFile",{doc:t,...n}),deleteFile:(t,n)=>r(a("deleteFile",{doc:t,path:n})),renameFile:(t,n,d)=>a("renameFile",{doc:t,from:n,to:d}),history:(t,n={})=>a("history",{doc:t,...n}),revision:(t,n)=>a("revision",{doc:t,id:n}),restore:(t,n,d)=>a("restore",{doc:t,id:n,baseRevision:d}),addComment:(t,n)=>a("addComment",{doc:t,...n}),replyToComment:(t,n,d)=>a("replyToComment",{doc:t,id:n,body:d}),setCommentStatus:(t,n,d)=>a("setCommentStatus",{doc:t,id:n,status:d}),deleteComment:(t,n)=>r(a("deleteComment",{doc:t,id:n})),unlinkThread:(t,n)=>r(a("unlinkThread",{doc:t,threadId:n})),askAgent:(t,n)=>a("askAgent",{doc:t,...n,path:n.path??void 0})}}function U(){let e=ro();return X(()=>Qn((a,r)=>e.call(a,r)),[e])}function O(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function wr(e){return/changed since revision/i.test(O(e))}function vr(e){return/^design doc .* not found/i.test(e)}function M(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var kr="design-docs";var Ar="changed",Ct=["draft","review","approved","implemented","archived"],rt={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function Dr(e,a){let r=t=>t.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Ge(e,a){let[r,t]=b({key:e,data:null,error:null,loading:e!==null}),[n,d]=b(0),u=D(a);u.current=a,E(()=>{if(e===null){t({key:e,data:null,error:null,loading:!1});return}let f=!1;return t(i=>({key:e,data:i.key===e?i.data:null,error:null,loading:!0})),u.current().then(i=>{f||t({key:e,data:i,error:null,loading:!1})},i=>{f||t(m=>({key:e,data:m.key===e?m.data:null,error:O(i),loading:!1}))}),()=>{f=!0}},[e,n]);let l=he(()=>d(f=>f+1),[]),c=r.key===e;return{data:c?r.data:null,error:c?r.error:null,loading:c?r.loading:e!==null,reload:l}}function Mr(e,a=120){let r=D(e);r.current=e;let t=D(new Set),n=D(null);E(()=>()=>{n.current&&clearTimeout(n.current)},[]),no(Ar,d=>{let u=typeof d?.docId=="string"?d.docId:null;t.current.add(u),!n.current&&(n.current=setTimeout(()=>{n.current=null;let l=[...t.current];t.current.clear();for(let c of l)r.current(c)},a))})}function bt(e){let a=U(),r=Ge(JSON.stringify(e),()=>a.list(e));return Mr(()=>r.reload()),r}function St(e){let a=U(),r=Ge(e,()=>a.get(e));return Mr(t=>{(t===null||t===e)&&r.reload()}),r}function Rr(e,a,r){let t=U(),n=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Ge(n,()=>t.readFile(e,a))}function Ft(){let e=U();return Ge("templates",()=>e.templates())}function je(){let e=U();return Ge("projects",()=>e.projects())}var Tr="zcc.design-docs.";function te(e,a){let[r,t]=b(()=>{try{let d=globalThis.localStorage?.getItem(Tr+e);if(d==null)return a;let u=JSON.parse(d);return typeof u==typeof a?u:a}catch{return a}}),n=he(d=>{t(d);try{globalThis.localStorage?.setItem(Tr+e,JSON.stringify(d))}catch{}},[e]);return[r,n]}function Fr(e){let[a,r]=b(null),[t,n]=b(null);return Lt(()=>{if(!a)return;let d=l=>n(l>0?e.filter(c=>l>=c).length:null);if(d(a.getBoundingClientRect().width),typeof ResizeObserver>"u")return;let u=new ResizeObserver(l=>d(l[0]?.contentRect.width??0));return u.observe(a),()=>u.disconnect()},[a,e]),[r,t]}function xa(e=6e4){let[a,r]=b(()=>Date.now());return E(()=>{let t=setInterval(()=>r(Date.now()),e);return()=>clearInterval(t)},[e]),a}var Yn=Symbol.for("react.portal");function ed(e,a){return{$$typeof:Yn,key:null,children:e,containerInfo:a,implementation:null}}function Bt(e){return typeof document>"u"?e:ed(e,document.body)}function na(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function Br(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let t=Math.round(r/60);if(t<60)return`${t}m ago`;let n=Math.round(t/60);if(n<24)return`${n}h ago`;let d=Math.round(n/24);return d<30?`${d}d ago`:new Date(e).toISOString().slice(0,10)}var Nr=globalThis.__ZCC_HOST_REACT__,$=Nr.Fragment;function o(e,a,r){return Nr.createElement(e,r===void 0?a:{...a,key:r})}var s=o;var ad={MessageSquareText:ja,CheckCheck:Ra,WandSparkles:ze,Workflow:ot,ScanSearch:Za,ListChecks:Ga};function Er(e){return ad[e]??J}function ha({kind:e,size:a=14}){return o(e==="image"||e==="svg"?Oa:e==="font"?Ha:e==="markdown"||e==="text"?ea:qa,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function Ve({status:e,compact:a=!1}){return s("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[o("span",{className:"dd-status-dot","aria-hidden":!0}),rt[e]]})}function se({actor:e}){let a=e.kind==="agent"?ae:tt;return s("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[o(a,{size:12,"aria-hidden":!0}),o("span",{className:"dd-actor-label",children:e.label})]})}function ee({at:e,now:a}){return o("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:Br(e,a)})}function V({size:e=14,label:a}){return o("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:o(_e,{size:e,className:"dd-spin","aria-hidden":!0})})}function me({icon:e,title:a,children:r}){return s("div",{className:"dd-empty",children:[o("span",{className:"dd-empty-icon",children:o(e,{size:22,"aria-hidden":!0})}),o("div",{className:"dd-empty-title",children:a}),r?o("div",{className:"dd-empty-body",children:r}):null]})}function _({icon:e,label:a,onClick:r,active:t=!1,danger:n=!1,disabled:d=!1,size:u=14}){return o("button",{type:"button",className:`icon-btn dd-icon-btn${t?" on":""}${n?" danger":""}`,title:a,"aria-label":a,"aria-pressed":t||void 0,disabled:d,onClick:r,children:o(e,{size:u,"aria-hidden":!0})})}function qr(e,a){let r=D(null),t=D(a);return t.current=a,E(()=>{if(!e)return;let n=u=>{r.current&&u.target instanceof Node&&!r.current.contains(u.target)&&t.current()},d=u=>{u.key==="Escape"&&t.current()};return document.addEventListener("mousedown",n),document.addEventListener("keydown",d),()=>{document.removeEventListener("mousedown",n),document.removeEventListener("keydown",d)}},[e]),r}function re({open:e,onClose:a,anchor:r,children:t,align:n="end",className:d=""}){let u=qr(e,a);return s("div",{className:"dd-pop-anchor",ref:u,children:[r,e?o("div",{className:`dd-pop dd-pop-${n} ${d}`,role:"dialog",children:t}):null]})}function Or(e){if(e.clientX||e.clientY)return{x:e.clientX,y:e.clientY};let a=e.currentTarget.getBoundingClientRect();return{x:a.left+12,y:a.bottom}}var yt=4;function Hr({at:e,label:a,onClose:r,children:t}){let n=qr(!0,r),d=D(r);d.current=r;let[u,l]=b(e);Lt(()=>{let f=n.current,{width:i,height:m}=f.getBoundingClientRect();l({x:Math.max(yt,Math.min(e.x,window.innerWidth-i-yt)),y:Math.max(yt,Math.min(e.y,window.innerHeight-m-yt))})},[n,e.x,e.y]),E(()=>{let f=document.activeElement instanceof HTMLElement?document.activeElement:null;n.current?.querySelector('[role="menuitem"]')?.focus();let i=m=>{m.target instanceof Node&&n.current?.contains(m.target)||d.current()};return window.addEventListener("scroll",i,!0),window.addEventListener("resize",i),window.addEventListener("blur",i),()=>{window.removeEventListener("scroll",i,!0),window.removeEventListener("resize",i),window.removeEventListener("blur",i),f?.isConnected&&(document.activeElement===document.body||n.current?.contains(document.activeElement))&&f.focus()}},[n]);let c=f=>{let i=[...f.currentTarget.querySelectorAll('[role="menuitem"]')],m=i.indexOf(document.activeElement),L=f.key==="ArrowDown"?(m+1)%i.length:f.key==="ArrowUp"?(m-1+i.length)%i.length:f.key==="Home"?0:f.key==="End"?i.length-1:-1;f.key==="Tab"&&r(),!(L<0||!i.length)&&(f.preventDefault(),i[L].focus())};return Bt(o("div",{ref:n,className:"dd-pop dd-menu dd-context-menu",role:"menu","aria-label":a,style:{left:u.x,top:u.y},onKeyDown:c,onContextMenu:f=>f.preventDefault(),children:t}))}function Y({icon:e,label:a,hint:r,onSelect:t,danger:n=!1,checked:d=!1}){return s("button",{type:"button",role:"menuitem",className:`dd-menu-item${n?" dd-menu-danger":""}${d?" dd-menu-checked":""}`,onClick:t,children:[e?o(e,{size:14,"aria-hidden":!0}):null,o("span",{className:"dd-menu-label",children:a}),r?o("span",{className:"dd-menu-hint",children:r}):null]})}function be({request:e,onClose:a}){let[r,t]=b(!1),n=async()=>{t(!0);try{await e.run()}finally{t(!1),a()}};return o(nt,{title:e.title,onClose:a,footer:s($,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{n()},autoFocus:!0,children:e.confirmLabel})]}),children:o("div",{className:"dd-confirm-body",children:e.body})})}function nt({title:e,onClose:a,children:r,footer:t,wide:n=!1}){return E(()=>{let d=u=>{u.key==="Escape"&&a()};return document.addEventListener("keydown",d),()=>document.removeEventListener("keydown",d)},[a]),Bt(o("div",{className:"dd-dialog-backdrop",onMouseDown:d=>{d.target===d.currentTarget&&a()},children:s("div",{className:`dd-dialog${n?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[s("div",{className:"dd-dialog-header",children:[o("span",{className:"dd-dialog-title",children:e}),o(_,{icon:Q,label:"Close",onClick:a})]}),o("div",{className:"dd-dialog-body",children:r}),t?o("div",{className:"dd-dialog-footer",children:t}):null]})}))}var td={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},$e="design-doc";function Ur({doc:e,now:a}){let r=U(),t=ke(),n=[...e.threads].sort((d,u)=>u.lastActivityAt-d.lastActivityAt);return o("div",{className:"dd-rail-pane dd-agents",children:s("div",{className:"dd-rail-scroll",children:[n.length?o("ul",{className:"dd-thread-list",children:n.map(d=>s("li",{className:"dd-thread",children:[s("button",{type:"button",className:"dd-thread-open",onClick:()=>t.toThread(d.threadId),title:"Open thread",children:[o(ae,{size:14,"aria-hidden":!0}),s("span",{className:"dd-thread-main",children:[o("span",{className:"dd-thread-title",children:d.title}),s("span",{className:"dd-thread-meta",children:[o("span",{className:`dd-role dd-role-${d.role}`,children:td[d.role]}),o(ee,{at:d.lastActivityAt,now:a})]})]})]}),o(_,{icon:at,label:"Unlink thread",size:13,onClick:()=>{r.unlinkThread(e.id,d.threadId).catch(u=>M(`Could not unlink: ${O(u)}`,"error"))}})]},d.threadId))}):s(me,{icon:ae,title:"No agents yet",children:["Use ",o("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),s("div",{className:"dd-agents-hint",children:[o(Ma,{size:13,"aria-hidden":!0}),s("span",{children:["Agents in this project already know this doc exists. Type ",o("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",o("code",{children:"design_doc_read"}),"."]})]})]})})}function _r({doc:e,activePath:a,request:r,contextProjectId:t,compact:n=!1}){let d=U(),u=ke(),[l,c]=b(!1),[f,i]=b(""),[m,L]=b(!1),[S,g]=b(t??""),[I,P]=b(null),q=je(),R=D(null),N=!e.projectId,w=q.data??[],F=N?S||w[0]?.id||"":e.projectId;E(()=>{r&&(i(r.prompt),L(!0),c(!0),requestAnimationFrame(()=>{let p=R.current;p&&(p.focus(),p.selectionStart=p.selectionEnd=p.value.length)}))},[r]),E(()=>{l&&L(p=>p||!!a&&a!==e.entryPath)},[l,a,e.entryPath]);let k=async p=>{if(!I){if(N&&!F){M("Add a project first: agents run inside a project.","error");return}P(p??"custom");try{let v=await d.askAgent(e.id,{...p?{action:p}:{},...f.trim()&&!p?{prompt:f.trim()}:{},path:m?a:null,...N?{projectId:F}:{}});u.openThreadPanel({actionId:$e,title:e.title,params:{docId:e.id},threadId:v.threadId}),u.toThread(v.threadId),M(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),c(!1),i("")}catch(v){M(`Could not start the agent: ${O(v)}`,"error")}finally{P(null)}}},T=p=>{p.key==="Enter"&&(p.metaKey||p.ctrlKey)&&(p.preventDefault(),f.trim()&&k(null))};return s(re,{open:l,onClose:()=>c(!1),className:"dd-ask",anchor:s("button",{type:"button",className:`btn primary dd-ask-trigger${n?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":l,onClick:()=>c(!l),children:[o(J,{size:13,"aria-hidden":!0}),n?null:"Ask agent",o(ie,{size:12,"aria-hidden":!0})]}),children:[s("div",{className:"dd-ask-head",children:[o("span",{className:"dd-ask-title",children:"Ask an agent"}),o("span",{className:"dd-muted",children:"Starts a new thread that edits this doc live"})]}),o("div",{className:"dd-ask-actions",role:"menu",children:Pr.map(p=>{let v=Er(p.icon);return s("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!I,onClick:()=>{k(p.id)},title:p.description,children:[o("span",{className:"dd-ask-action-icon",children:I===p.id?o(V,{size:13}):o(v,{size:14,"aria-hidden":!0})}),s("span",{className:"dd-ask-action-text",children:[o("span",{className:"dd-ask-action-label",children:p.label}),o("span",{className:"dd-ask-action-desc",children:p.description})]})]},p.id)})}),s("div",{className:"dd-ask-custom",children:[o("textarea",{ref:R,className:"dd-input",rows:3,maxLength:It,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:f,onChange:p=>i(p.target.value),onKeyDown:T}),s("div",{className:"dd-ask-options",children:[a?s("label",{className:"dd-check",children:[o("input",{type:"checkbox",checked:m,onChange:p=>L(p.target.checked)}),"Focus on ",o("code",{children:a})]}):null,N?s("label",{className:"dd-field-inline",children:["Run in",s("select",{className:"dd-input dd-select",value:F,onChange:p=>g(p.target.value),children:[w.length?null:o("option",{value:"",children:"No projects"}),w.map(p=>o("option",{value:p.id,children:p.name},p.id))]})]}):null,o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",disabled:!f.trim()||!!I,onClick:()=>{k(null)},children:[I==="custom"?o(V,{size:12}):null,"Start"]})]})]})]})}var od=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),rd=/[A-Za-z][^\t\n\f\r />]*/y,nd=/[\t\n\f\r /]*/y,zr=/[\t\n\f\r ]*/y,dd=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,sd=/[^\t\n\f\r >]*/y,ld={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function id(e){return e.includes("&")?e.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(a,r,t,n)=>{if(n)return ld[n.toLowerCase()]??a;let d=r?Number(r):parseInt(t,16);return d>0&&d<=1114111?String.fromCodePoint(d):a}):e}function Gr(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function La(e,a,r){return e.lastIndex=r,e.exec(a)?.[0]??""}function ud(e,a){let r=La(rd,e,a+1),t=a+1+r.length,n=[];for(;t<e.length;){let d=La(nd,e,t);if(t+=d.length,t>=e.length)return null;if(e[t]===">")return{name:r.toLowerCase(),attributes:n,selfClosing:d.endsWith("/"),start:a,end:t+1};let u=La(dd,e,t)||e[t];t+=u.length,t+=La(zr,e,t).length;let l=null;if(e[t]==="="){t+=1,t+=La(zr,e,t).length;let c=e[t];if(c==='"'||c==="'"){let f=e.indexOf(c,t+1);if(f<0)return null;l=e.slice(t+1,f),t=f+1}else l=La(sd,e,t),t+=l.length}n.push({name:u.toLowerCase(),value:l===null?null:id(l)})}return null}function*cd(e){let a=0;for(;a<e.length;){let r=e.indexOf("<",a);if(r<0)return;let t=e[r+1]??"";if(e.startsWith("<!--",r)){let d=e.indexOf("-->",r+4);a=d<0?e.length:d+3;continue}if(t==="!"||t==="?"||t==="/"&&/[A-Za-z]/.test(e[r+2]??"")){let d=e.indexOf(">",r+2);a=d<0?e.length:d+1;continue}if(!/[A-Za-z]/.test(t)){a=r+1;continue}let n=ud(e,r);if(!n)return;if(a=n.end,od.has(n.name)){let d=new RegExp(`</${n.name}(?=[\\t\\n\\f\\r />])`,"ig");d.lastIndex=n.end;let u=d.exec(e),l=u?u.index:e.length,c=u?e.indexOf(">",l):-1,f=c<0?e.length:c+1;yield{...n,content:{start:n.end,end:l,closeEnd:f}},a=f;continue}yield n}}function Pt(e,a){let r=-1;for(let n of cd(e)){if(n.name==="head")return e.slice(0,n.end)+a+e.slice(n.end);if(n.name==="html"){r=n.end;continue}break}if(r>=0)return e.slice(0,r)+a+e.slice(r);let t=e.match(/^\s*<!doctype[^>]*>/i);return t?t[0]+a+e.slice(t[0].length):a+e}function dt(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var fd={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},pd={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"};var jr={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function da(e){let a=dt(e),r=fd[a];return r||(jr[a]?"code":"text")}function Vr(e){return jr[dt(e)]??""}function De(e){return e==="image"||e==="font"}function $r(e){return pd[dt(e)]??null}var md=/^[a-z][a-z0-9+.-]*:/i;function st(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||md.test(r))return null;let t=r.split(/[?#]/,1)[0],n=t;try{n=decodeURIComponent(t)}catch{}let d=n.startsWith("/")?[]:e.split("/").slice(0,-1);for(let u of n.split("/"))if(!(!u||u===".")){if(u===".."){if(!d.length)return null;d.pop();continue}d.push(u)}return d.length?d.join("/"):null}function Wr(e,a){let r=e.split("/"),t=a.split("/"),n=Math.min(r.length,t.length);for(let d=0;d<n;d+=1){let u=d===r.length-1,l=d===t.length-1;if(r[d]!==t[d])return u!==l?u?-1:1:r[d].localeCompare(t[d],void 0,{sensitivity:"base",numeric:!0})}return r.length-t.length}function Nt(e){let a=(e??"").split("/").filter(Boolean),[r,...t]=a;return{docId:r??null,path:t.length?t.join("/"):null}}function Ia(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}function gd(e){let a=new TextEncoder().encode(e),r="";for(let t=0;t<a.length;t+=32768)r+=String.fromCharCode(...a.subarray(t,t+32768));return btoa(r)}function Et(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${gd(e.content)}`;let a=$r(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var Xr=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;function Kr(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function Zr(e,a){let r=new Set;for(let t of a.matchAll(Xr)){let n=st(e,Kr(t[2]));n&&r.add(n)}return[...r]}function Jr(e,a,r){return r.size?a.replace(Xr,(t,n,d,u="")=>{let l=st(e,Kr(d)),c=l?r.get(l):void 0;return c?`${n}${c}${u})`:t}):a}function qt(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(n=>n[0].length)),t="`".repeat(Math.max(3,r+1));return`${t}${a}
${e.replace(/\n$/,"")}
${t}`}function Qr(e,a){return qt(a,Vr(e))}var xd=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function Yr(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let n of xd){let d=r.getPropertyValue(n).trim();d&&(a[n]=d)}let t=r.getPropertyValue("color-scheme").trim();return t&&(a["color-scheme"]=t),a}var hd=/^[^<>{};]*$/;function en(e,a){let t=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>hd.test(n)).map(([n,d])=>`${n}: ${d};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;return Pt(e,t)}function an(e){let a=[],r=new Map;for(let t of[...e].sort((n,d)=>Wr(n.path,d.path))){let n=t.path.split("/"),d=a;for(let u=0;u<n.length-1;u+=1){let l=n.slice(0,u+1).join("/"),c=r.get(l);c||(c={kind:"folder",name:n[u],path:l,children:[]},r.set(l,c),d.push(c)),d=c.children}d.push({kind:"file",name:n.at(-1),path:t.path,file:t})}return a}var on=e=>e.key==="Enter"&&(e.metaKey||e.ctrlKey);function Ld({onSend:e,onCancel:a}){let[r,t]=b(""),[n,d]=b(!1),u=async()=>{let l=r.trim();if(!l||n)return;d(!0);let c=await e(l);d(!1),c&&t("")};return s("div",{className:"dd-reply-composer",children:[o("textarea",{className:"dd-input dd-composer-input",placeholder:"Reply\u2026 agents see the whole thread","aria-label":"Reply",value:r,maxLength:8e3,rows:2,autoFocus:!0,onChange:l=>t(l.target.value),onKeyDown:l=>{on(l)?(l.preventDefault(),u()):l.key==="Escape"&&(l.preventDefault(),a())}}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send \xB7 Esc to cancel"}),s("span",{className:"dd-reply-buttons",children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:!r.trim()||n,onClick:()=>{u()},children:"Reply"})]})]})]})}function Id({comment:e,fileGone:a,now:r,onToggle:t,onDelete:n,onDeleteReply:d,onReply:u,onFocus:l}){let c=e.status==="resolved",[f,i]=b(!1);return s("article",{className:`dd-comment${c?" dd-comment-resolved":""}`,children:[s("header",{className:"dd-comment-head",children:[o(se,{actor:e.author}),o(ee,{at:e.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(_,{icon:Xa,label:"Reply",onClick:()=>i(!0),size:13}),o(_,{icon:c?Ae:Je,label:c?"Reopen":"Resolve",onClick:t,size:13}),o(_,{icon:oe,label:"Delete comment",onClick:n,danger:!0,size:13})]}),e.path||e.quote?s("button",{type:"button",className:"dd-comment-anchor",onClick:l,disabled:!l,title:a?"This file was deleted":"Show in the document",children:[e.path?s("span",{className:`dd-comment-path${a?" dd-comment-path-gone":""}`,children:[e.path,a?" (deleted)":""]}):null,e.quote?o("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,o("div",{className:"dd-comment-body",children:o(va,{content:e.body})}),e.replies.length?o("ol",{className:"dd-replies","aria-label":"Replies",children:e.replies.map(m=>s("li",{className:"dd-reply",children:[s("header",{className:"dd-comment-head",children:[o(se,{actor:m.author}),o(ee,{at:m.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(_,{icon:oe,label:"Delete reply",onClick:()=>d(m.id),danger:!0,size:12})]}),o("div",{className:"dd-comment-body",children:o(va,{content:m.body})})]},m.id))}):null,f?o(Ld,{onCancel:()=>i(!1),onSend:async m=>{let L=await u(m);return L&&i(!1),L}}):null]})}function rn({doc:e,activePath:a,now:r,pendingQuote:t,onClearQuote:n,draft:d,onDraft:u,onFocusComment:l}){let c=U(),[f,i]=te("comments-scope","all"),[m,L]=b(!1),[S,g]=b(!1),[I,P]=b(null),q=D(null);E(()=>{t&&q.current?.focus()},[t]);let R=X(()=>e.comments.filter(y=>f==="all"||!y.path||y.path===a),[e.comments,f,a]),N=R.filter(y=>y.status==="open"),w=R.filter(y=>y.status==="resolved"),F=async(y,z)=>{try{return await y(),!0}catch(Z){return M(`${z}: ${O(Z)}`,"error"),!1}},k=t?t.path:a,T=async()=>{let y=d.trim();if(!(!y||S)){g(!0);try{await c.addComment(e.id,{body:y,...k?{path:k}:{},...t?{quote:t.text}:{}}),u(""),n()}catch(z){M(`Could not add the comment: ${O(z)}`,"error")}finally{g(!1)}}},p=y=>{on(y)&&(y.preventDefault(),T())},v=X(()=>new Set(e.files.map(y=>y.path)),[e.files]),h=y=>{let z=!!y.path&&!v.has(y.path);return o(Id,{comment:y,fileGone:z,now:r,onToggle:()=>{F(()=>c.setCommentStatus(e.id,y.id,y.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>P({title:"Delete comment",body:y.replies.length?`Delete this comment and its ${y.replies.length===1?"reply":`${y.replies.length} replies`}? This cannot be undone.`:"Delete this comment? This cannot be undone.",confirmLabel:"Delete",danger:!0,run:()=>{F(()=>c.deleteComment(e.id,y.id),"Could not delete the comment")}}),onDeleteReply:Z=>{F(()=>c.deleteComment(e.id,Z),"Could not delete the reply")},onReply:Z=>F(()=>c.replyToComment(e.id,y.id,Z),"Could not reply"),onFocus:!z&&(y.quote||y.path)?()=>l(y):void 0},y.id)};return s("div",{className:"dd-rail-pane dd-comments",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[o("button",{type:"button",className:f==="all"?"on":"",onClick:()=>i("all"),children:"All files"}),o("button",{type:"button",className:f==="file"?"on":"",onClick:()=>i("file"),disabled:!a,children:"This file"})]})}),s("div",{className:"dd-rail-scroll",children:[N.length===0?o(me,{icon:Ce,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):N.map(h),w.length?s("div",{className:"dd-resolved",children:[s("button",{type:"button",className:"dd-disclosure",onClick:()=>L(!m),children:[m?o(ie,{size:13,"aria-hidden":!0}):o(Qe,{size:13,"aria-hidden":!0}),"Resolved (",w.length,")"]}),m?w.map(h):null]}):null]}),s("div",{className:"dd-composer",children:[t?s("div",{className:"dd-composer-quote",children:[o("span",{className:"dd-comment-quote",children:t.text}),o(_,{icon:Q,label:"Remove quote",onClick:n,size:12})]}):null,o("textarea",{ref:q,className:"dd-input dd-composer-input",placeholder:k?`Comment on ${k}\u2026 agents see open comments`:"Leave a comment\u2026",value:d,maxLength:8e3,rows:3,onChange:y=>u(y.target.value),onKeyDown:p}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),o("button",{type:"button",className:"btn primary",disabled:!d.trim()||S,onClick:()=>{T()},children:"Comment"})]})]}),I?o(be,{request:I,onClose:()=>P(null)}):null]})}var Cd=(()=>{let e=new Uint32Array(256);for(let a=0;a<256;a+=1){let r=a;for(let t=0;t<8;t+=1)r=r&1?3988292384^r>>>1:r>>>1;e[a]=r>>>0}return e})();function bd(e){let a=4294967295;for(let r of e)a=Cd[(a^r)&255]^a>>>8;return(a^4294967295)>>>0}function Sd(e){let a=Math.max(e.getFullYear(),1980);return{time:e.getHours()<<11|e.getMinutes()<<5|Math.floor(e.getSeconds()/2),date:a-1980<<9|e.getMonth()+1<<5|e.getDate()}}var nn=2048,Ot=20;function dn(e,a=new Date){let r=new TextEncoder,{time:t,date:n}=Sd(a),d=[],u=[],l=0;for(let S of e){let g=r.encode(S.path),I=bd(S.data),P=S.data.length,q=new Uint8Array(30+g.length),R=new DataView(q.buffer);R.setUint32(0,67324752,!0),R.setUint16(4,Ot,!0),R.setUint16(6,nn,!0),R.setUint16(8,0,!0),R.setUint16(10,t,!0),R.setUint16(12,n,!0),R.setUint32(14,I,!0),R.setUint32(18,P,!0),R.setUint32(22,P,!0),R.setUint16(26,g.length,!0),R.setUint16(28,0,!0),q.set(g,30),d.push(q,S.data);let N=new Uint8Array(46+g.length),w=new DataView(N.buffer);w.setUint32(0,33639248,!0),w.setUint16(4,Ot,!0),w.setUint16(6,Ot,!0),w.setUint16(8,nn,!0),w.setUint16(10,0,!0),w.setUint16(12,t,!0),w.setUint16(14,n,!0),w.setUint32(16,I,!0),w.setUint32(20,P,!0),w.setUint32(24,P,!0),w.setUint16(28,g.length,!0),w.setUint32(42,l,!0),N.set(g,46),u.push(N),l+=q.length+P}let c=u.reduce((S,g)=>S+g.length,0),f=new Uint8Array(22),i=new DataView(f.buffer);i.setUint32(0,101010256,!0),i.setUint16(8,e.length,!0),i.setUint16(10,e.length,!0),i.setUint32(12,c,!0),i.setUint32(16,l,!0);let m=new Uint8Array(l+c+f.length),L=0;for(let S of[...d,...u,f])m.set(S,L),L+=S.length;return m}function yd(e){if(e.encoding==="utf8")return new TextEncoder().encode(e.content);let a=atob(e.content),r=new Uint8Array(a.length);for(let t=0;t<a.length;t+=1)r[t]=a.charCodeAt(t);return r}function sn(e,a,r){return dn(a.map(t=>({path:`${e}/${t.path}`,data:yd(t)})),r)}var Pd=3e4;function ln(e,a,r){let t=URL.createObjectURL(new Blob([a],{type:r})),n=document.createElement("a");n.href=t,n.download=e,n.style.display="none",document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(t),Pd)}function wd({doc:e,projects:a,onClose:r,onMove:t}){let[n,d]=b(e.projectId??"");return s(nt,{title:"Move design doc",onClose:r,footer:s($,{children:[o("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.projectId??""),onClick:()=>{t(n||null).then(r)},children:"Move"})]}),children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:n,onChange:u=>d(u.target.value),children:[o("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(u=>o("option",{value:u.id,children:u.name},u.id))]})]}),o("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}async function un(e,a){try{await navigator.clipboard.writeText(e),M(`Copied ${a}`)}catch{M(`Could not copy ${a}`,"error")}}function wt(e){let a=U(),[r,t]=b(null),[n,d]=b(null),u=async(i,m)=>{try{await a.update(i.id,m)}catch(L){M(`Could not update the doc: ${O(L)}`,"error")}},l=async i=>{try{let m=await a.siteFiles(i.id);ln(`${m.slug}.zip`,sn(m.slug,m.files),"application/zip")}catch(m){M(`Could not download the doc: ${O(m)}`,"error")}};return{items:(i,m,L,S)=>{let g=i.status==="archived",I=P=>()=>{m(),P()};return s($,{children:[S?o(Y,{icon:aa,label:"Open",onSelect:I(S)}):null,o(Y,{icon:Fa,label:"Copy chat reference",hint:"Paste into any thread",onSelect:I(()=>{un(Dr(i.id),"reference")})}),o(Y,{icon:ta,label:"Copy id",hint:i.slug,onSelect:I(()=>{un(i.id,"id")})}),o(Y,{icon:Na,label:"Download .zip",hint:`${i.slug}.zip`,onSelect:I(()=>{l(i)})}),o(Y,{icon:Ua,label:"Move to project\u2026",onSelect:I(()=>t(i))}),o(Y,{icon:g?Aa:Da,label:g?"Unarchive":"Archive",onSelect:I(()=>{u(i,{status:g?"draft":"archived"})})}),o(Y,{icon:oe,label:"Delete\u2026",danger:!0,onSelect:I(()=>d({title:"Delete design doc",body:s($,{children:["Delete ",o("strong",{children:i.title})," with its ",i.fileCount," file",i.fileCount===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await a.remove(i.id),M(`Deleted \u201C${i.title}\u201D`),L()}catch(P){M(`Could not delete: ${O(P)}`,"error")}}}))})]})},dialogs:s($,{children:[r?o(wd,{doc:r,projects:e,onClose:()=>t(null),onMove:i=>u(r,{projectId:i})}):null,n?o(be,{request:n,onClose:()=>d(null)}):null]})}}function fn({value:e,placeholder:a,maxLength:r,multiline:t=!1,className:n="",label:d,onSave:u}){let[l,c]=b(!1),[f,i]=b(e),m=D(!1);E(()=>{l||i(e)},[e,l]);let L=async g=>{if(m.current)return;m.current=!0,c(!1);let I=f.trim();if(g&&I!==e.trim())try{await u(I)}catch{i(e)}else i(e)},S=g=>{g.key==="Escape"?(g.preventDefault(),L(!1)):g.key==="Enter"&&(!t||g.metaKey||g.ctrlKey||!g.shiftKey)&&(g.preventDefault(),L(!0))};if(l){let g={className:`dd-editable-input ${n}`,value:f,maxLength:r,"aria-label":d,autoFocus:!0,onChange:I=>i(I.target.value),onKeyDown:S,onBlur:()=>{L(!0)}};return t?o("textarea",{...g,rows:2,placeholder:a}):o("input",{...g,placeholder:a})}return o("button",{type:"button",className:`dd-editable ${n}${e?"":" dd-editable-empty"}`,title:`Edit ${d.toLowerCase()}`,onClick:()=>{m.current=!1,c(!0)},children:e||a})}function kd({tags:e,onChange:a}){let[r,t]=b(!1),[n,d]=b(""),u=()=>{let l=n.split(",").map(f=>f.trim().toLowerCase().slice(0,32)).filter(Boolean);d(""),t(!1);let c=[...new Set([...e,...l])].slice(0,12);c.length!==e.length&&a(c)};return s("span",{className:"dd-tags",children:[e.map(l=>s("span",{className:"dd-tag",children:[o(ta,{size:10,"aria-hidden":!0}),l,o("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${l}`,onClick:()=>a(e.filter(c=>c!==l)),children:o(Q,{size:10,"aria-hidden":!0})})]},l)),r?o("input",{className:"dd-input dd-tag-input",value:n,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:l=>d(l.target.value),onBlur:u,onKeyDown:l=>{l.key==="Enter"?(l.preventDefault(),u()):l.key==="Escape"&&(d(""),t(!1))}}):e.length<12?s("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>t(!0),children:[o(ce,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function Ad({status:e,onChange:a}){let[r,t]=b(!1);return o(re,{open:r,onClose:()=>t(!1),align:"start",className:"dd-menu",anchor:o("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>t(!r),title:"Change status",children:o(Ve,{status:e})}),children:Ct.map(n=>o(Y,{label:o(Ve,{status:n}),checked:n===e,icon:n===e?Je:void 0,onSelect:()=>{t(!1),n!==e&&a(n)}},n))})}function pn({doc:e,projects:a,compact:r,actions:t,onDeleted:n}){let d=U(),[u,l]=b(!1),c=wt(a),f=e.projectId?a.find(m=>m.id===e.projectId):null,i=async m=>{try{await d.update(e.id,m)}catch(L){throw M(`Could not update the doc: ${O(L)}`,"error"),L}};return s("header",{className:`dd-doc-header${r?" dd-doc-header-compact":""}`,children:[s("div",{className:"dd-doc-title-row",children:[o(fn,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:m=>m?i({title:m}):void 0}),o("span",{className:"dd-spacer"}),t,o(re,{open:u,onClose:()=>l(!1),className:"dd-menu",anchor:o(_,{icon:Le,label:"More actions",active:u,onClick:()=>l(!u)}),children:c.items(e,()=>l(!1),n)})]}),r?null:o(fn,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:m=>i({summary:m})}),s("div",{className:"dd-doc-meta",children:[o(Ad,{status:e.status,onChange:m=>{i({status:m}).catch(()=>{})}}),s("span",{className:"dd-doc-project",title:f?`Project \xB7 ${f.name}`:"Visible to agents in every project",children:[f?null:o(za,{size:12,"aria-hidden":!0}),f?f.name:e.projectId?"Unknown project":"Global"]}),r?null:o(kd,{tags:e.tags,onChange:m=>{i({tags:m}).catch(()=>{})}}),o("span",{className:"dd-spacer"}),s("span",{className:"dd-doc-updated",children:[o(se,{actor:e.updatedBy})," ",o(ee,{at:e.updatedAt,now:Date.now()})]})]}),c.dialogs]})}function mn({docId:e,file:a,removed:r=!1,split:t,renderPreview:n,onStateChange:d,onSaved:u}){let l=U(),[c,f]=b(a.content),[i,m]=b({content:a.content,revision:a.revision}),[L,S]=b(!1),[g,I]=b(null),P=c!==i.content,q=io(c),R=D({dirty:P,draft:c,saved:i});R.current={dirty:P,draft:c,saved:i},E(()=>{let{dirty:k,draft:T,saved:p}=R.current;a.revision!==p.revision&&(!k||a.content===T?(f(a.content),m({content:a.content,revision:a.revision}),I(null)):I({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),E(()=>{d?.({dirty:P,saving:L})},[P,L,d]);let N=he(async k=>{if(!L){S(!0);try{let T=k??(r?0:i.revision),p=await l.writeFile(e,{path:a.path,content:c,baseRevision:T});m({content:c,revision:p.revision}),I(null),u?.(p)}catch(T){if(wr(T)){let p=await l.readFile(e,a.path).catch(()=>null);I({revision:p?.revision??i.revision+1,by:p?.updatedBy??a.updatedBy})}else M(`Could not save ${a.path}: ${O(T)}`,"error")}finally{S(!1)}}},[l,e,c,a.path,a.updatedBy,u,r,i.revision,L]),w=async()=>{try{let k=await l.readFile(e,a.path);f(k.content),m({content:k.content,revision:k.revision}),I(null)}catch(k){M(`Could not reload ${a.path}: ${O(k)}`,"error")}},F=k=>{if((k.metaKey||k.ctrlKey)&&k.key.toLowerCase()==="s"){k.preventDefault(),P&&!g&&N();return}if(k.key==="Tab"&&!k.metaKey&&!k.ctrlKey&&!k.altKey){k.preventDefault();let T=k.currentTarget,{selectionStart:p,selectionEnd:v,value:h}=T,y=`${h.slice(0,p)}  ${h.slice(v)}`;f(y),requestAnimationFrame(()=>{T.selectionStart=T.selectionEnd=p+2})}};return s("div",{className:"dd-editor",children:[r&&P&&!g?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(ue,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[a.path," was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them."]})]}):null,g?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(pe,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o(se,{actor:g.by})," saved revision ",g.revision," while you were editing."]}),s("button",{type:"button",className:"btn",onClick:()=>{w()},children:[o(Ae,{size:12,"aria-hidden":!0})," Discard mine"]}),o("button",{type:"button",className:"btn",onClick:()=>{N(g.revision)},children:"Overwrite with mine"})]}):null,s("div",{className:`dd-editor-body${t?" dd-editor-split":""}`,children:[o("textarea",{className:"dd-editor-input",value:c,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:k=>f(k.target.value),onKeyDown:F,autoFocus:!0}),t?o("div",{className:"dd-editor-preview",children:n(q)}):null]}),s("div",{className:"dd-editor-footer",children:[s("span",{className:"dd-editor-state",children:[L?o(V,{size:12,label:"Saving"}):null,L?"Saving\u2026":P?"Unsaved changes":`Saved \xB7 rev ${i.revision}`]}),o("span",{className:"dd-editor-hint",children:"\u2318S to save"}),o("button",{type:"button",className:"btn",disabled:!P||L,onClick:()=>f(i.content),children:"Revert"}),s("button",{type:"button",className:"btn primary",disabled:!P||L||!!g,onClick:()=>{N()},children:[o(Ka,{size:12,"aria-hidden":!0})," Save"]})]})]})}var vt="dd-comment",kt="dd-comment-focus";function Dd(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}var Td=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE"]);function Md(e){let a=e.ownerDocument.createTreeWalker(e,4,{acceptNode:c=>Td.has(c.parentElement?.tagName.toUpperCase()??"")?2:1}),r=[],t=[],n="";for(let c=a.nextNode();c;c=a.nextNode())t.push(n.length),r.push(c),n+=c.data;let d="",u=[],l=!0;for(let c=0;c<n.length;c+=1){let f=n[c];/\s/.test(f)?(l||(d+=" ",u.push(c)),l=!0):(d+=f,u.push(c),l=!1)}return{nodes:r,starts:t,normalized:d,map:u}}function gn(e,a){let r=0,t=e.starts.length-1;for(;r<t;){let n=r+t+1>>1;e.starts[n]<=a?r=n:t=n-1}return[e.nodes[r],a-e.starts[r]]}function _t(e,a){let r=new Map;if(!a.length)return r;let t=Md(e);if(!t.nodes.length)return r;for(let n of a){if(r.has(n))continue;let d="",u=-1;for(let L of new Set([n.replace(/\s+/g," ").trim(),Dd(n)]))if(!(L.length<2)&&(u=t.normalized.indexOf(L),u>=0)){d=L;break}if(u<0)continue;let[l,c]=gn(t,t.map[u]),[f,i]=gn(t,t.map[u+d.length-1]),m=e.ownerDocument.createRange();m.setStart(l,c),m.setEnd(f,i+1),r.set(n,m)}return r}function Rd(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var xn=new Map;function sa(e,a,r){let t=Rd();if(!t)return;let n=xn.get(e)??new Map;xn.set(e,n),r.length?n.set(a,r):n.delete(a);let d=[...n.values()].flat();d.length?t.registry.set(e,new t.Highlight(...d)):t.registry.delete(e)}var Ln="dd-page";var Fd="dd-page-hello",In=50,Bd=256*1024,Gt=1e3,zt=4e3,Nd=500,Ed=500,qd=new Set(["error","missing","blocked"]);function it(e){return e&&typeof e=="object"&&!Array.isArray(e)?e:null}function Ca(e,a){return typeof e=="string"&&e.length<=a?e:null}function jt(e,a){return typeof e=="string"?e.slice(0,a):null}function At(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function hn(e){return!Array.isArray(e)||e.length>Ed?null:e.every(a=>typeof a=="string"&&a.length<=500)?e:null}function Od(e){if(e===null)return null;let a=it(e);if(!a)return;let[r,t,n,d]=[a.top,a.left,a.bottom,a.right].map(At);return r===null||t===null||n===null||d===null?void 0:{top:r,left:t,bottom:n,right:d}}function Hd(e){let a=it(e);if(!a)return null;let r=0;for(let[t,n]of Object.entries(a))if(typeof n!="string"||(r+=t.length+n.length,r>Bd))return null;return{...a}}function Ud(e){let a=it(e),r=a?.kind,t=jt(a?.message,Nd);if(!a||!qd.has(r)||!t)return null;let n=jt(a.source,Gt),d=At(a.line);return{kind:r,message:t,...n?{source:n}:{},...d!==null&&d>0?{line:Math.floor(d)}:{}}}function Cn(e){let a=it(e);if(!a)return null;switch(a.type){case"ready":return{type:"ready"};case"fetch":{let r=Ca(a.path,Gt);return Number.isSafeInteger(a.id)&&a.id>=0&&r!==null?{type:"fetch",id:a.id,path:r}:null}case"navigate":{let r=Ca(a.path,Gt),t=a.hash===null?null:Ca(a.hash,zt);return r===null||t===null&&a.hash!==null||typeof a.newTab!="boolean"?null:{type:"navigate",path:r,hash:t,newTab:a.newTab,redirect:a.redirect===!0}}case"open":{let r=Ca(a.url,zt);return r===null?null:{type:"open",url:r}}case"problem":{let r=Ud(a.problem);return r?{type:"problem",problem:r}:null}case"selection":{let r=jt(a.text,500),t=Od(a.rect);return r===null||t===void 0?null:{type:"selection",text:r,rect:t}}case"anchors":{let r=hn(a.found),t=hn(a.missing);return r&&t?{type:"anchors",found:r,missing:t}:null}case"focused":{let r=Ca(a.quote,500);return r===null||typeof a.found!="boolean"?null:{type:"focused",quote:r,found:a.found}}case"scroll":{let r=At(a.x),t=At(a.y);return r===null||t===null?null:{type:"scroll",x:r,y:t}}case"hash":{let r=a.hash===null?null:Ca(a.hash,zt);return r===null&&a.hash!==null?null:{type:"hash",hash:r}}case"storage":{let r=Hd(a.entries);return r?{type:"storage",entries:r}:null}default:return null}}function bn(e){return it(e)?.dd===Fd}var yp=12*1024*1024,Vt=960*1024;function Sn(e,a,r){let t=new Map(a.map(n=>[n.path,n.revision]));return!r&&e.revision!==(t.get(e.path)??null)||e.deps.some(n=>(t.get(n.path)??0)!==n.revision)?!0:e.missing.some(n=>t.has(n))}function $t(e,a){let r=[...e],t=new Set(e.map(n=>n.path));for(let[n,d]of a){if(r.length>=500)break;t.has(n)||r.push({path:n,revision:d})}return r}function yn(e){return JSON.stringify(e).replace(/</g,"\\u003c")}var _d=new URL("./page-runtime.js",import.meta.url).href,Pn=[{id:"full",label:"Full width",icon:Va,width:null},{id:"tablet",label:"Tablet (768px)",icon:et,width:768},{id:"phone",label:"Phone (390px)",icon:Qa,width:390}],zd=400,Gd=1500,jd=6,Vd=200,$d=20,Wd=50,Xd={error:"Error",missing:"Missing",blocked:"Blocked"},ba=new Map;function Kd(e,a){for(ba.delete(e),ba.set(e,a);ba.size>$d;)ba.delete(ba.keys().next().value)}var la=new Map,Wt=(e,a)=>`${e}\0${a}`;function Zd(e,a,r){let t=Wt(e,a);for(la.delete(t),la.set(t,r);la.size>Wd;)la.delete(la.keys().next().value)}function Jd(e,a,r,t){let n=`<script type="application/json" id="${Ln}">${yn(a)}<\/script><script src="${Gr(r)}"><\/script>`,d=Pt(e.html,n);return e.styled?d:en(d,t)}function Qd(e,a){let r=0,t=[],n=()=>{for(;r<e&&t.length;){let d=t.shift();r+=1,Promise.resolve().then(d).catch(()=>{}).finally(()=>{r-=1,n()})}};return{add(d){return r+t.length>=a?!1:(t.push(d),n(),!0)},clear(){t.length=0}}}function Yd(e){return e.length*6<Vt?!1:new TextEncoder().encode(JSON.stringify(e)).byteLength>Vt}function es(e,a){return e.kind===a.kind&&e.message===a.message&&e.source===a.source&&e.line===a.line}function wn({docId:e,file:a,files:r,draft:t=!1,quotes:n=[],onOpenPath:d,onQuote:u,onAskAbout:l,handleRef:c}){let f=U(),i=a.path,[m,L]=b("full"),[S,g]=b(null),[I,P]=b(!0),[q,R]=b(null),[N,w]=b(!1),[F,k]=b([]),[T,p]=b(!1),[v,h]=b(null),[y,z]=b(null),[Z,We]=b(0),ge=D(null),Te=D(null),le=D(null),Me=D(!1),Se=D(null),ia=D([]),ne=D(new Map),Re=D(null),ua=D(""),Xe=D({hash:la.get(Wt(e,i))??null,scroll:null}),xe=D(n);xe.current=n;let ye=X(()=>Qd(jd,Vd),[]);E(()=>{la.delete(Wt(e,i))},[e,i]);let W=t?a.content:null,[de,Pa]=b(W);E(()=>{if(W===de)return;if(W===null){Pa(null);return}let C=setTimeout(()=>Pa(W),zd);return()=>clearTimeout(C)},[W,de]);let Yt=r.find(C=>C.path===i)?.revision??null,K=de===null?Yt:null,ca=D(0);E(()=>{let C=++ca.current;if(de!==null&&Yd(de)){w(!0),P(!1);return}w(!1),P(!0),f.renderPage(e,{path:i,draft:de??void 0}).then(A=>{if(C!==ca.current)return;let G={mode:"frame",docId:e,path:i,hash:Xe.current.hash,scroll:Xe.current.scroll,quotes:[...xe.current],storage:ba.get(e)};g({id:C,page:A,srcDoc:Jd(A,G,_d,A.styled?{}:Yr()),draft:de!==null}),R(null),P(!1)},A=>{C===ca.current&&(R(O(A)),P(!1))})},[f,e,i,de,K,Z]);let Ke=D("");E(()=>{if(!S||I)return;let C={...S.page,deps:$t(S.page.deps,ne.current)};if(!Sn(C,r,de!==null))return;let A=r.map(G=>`${G.path}@${G.revision}`).join("|");Ke.current!==A&&(Ke.current=A,We(G=>G+1))},[S,r,I,de]);let Pe=(C,A=le.current)=>{try{A?.postMessage(C)}catch{}},fa=C=>{k(A=>A.length>=In||A.some(G=>es(G,C))?A:[...A,C]),ma()},Fe=D(F);Fe.current=F;let pa=D(S);pa.current=S;let ma=()=>{Re.current&&clearTimeout(Re.current),Re.current=setTimeout(()=>{Re.current=null;let C=pa.current,A=C?.page;if(!A||C.draft||A.revision===null||!Me.current)return;let G={path:A.path,revision:A.revision,deps:$t(A.deps,ne.current),missing:A.missing,problems:Fe.current,unanchored:ia.current},j=JSON.stringify(G);j!==ua.current&&(ua.current=j,f.reportRender(e,G).catch(()=>{ua.current=""}))},Gd)},ft=(C,A)=>{C!==i&&(A!==null&&Zd(e,C,A),d?.(C))},Tt=(C,A,G)=>{let j=new Set(r.map(Ze=>Ze.path)),ve=j.has(C)?C:j.has(`${C}/index.html`)?`${C}/index.html`:null;if(!ve){M(`${C} is not a file in this design doc`,"error");return}G?h(ve===i?null:{path:ve,hash:A}):ft(ve,A)},pt=C=>{let A;try{A=new URL(C)}catch{return}if(A.protocol!=="https:"&&A.protocol!=="http:"){M(`Zana opens web links only, not ${A.protocol} links`,"error");return}let G=globalThis.navigator?.userActivation;if(G&&!G.isActive){fa({kind:"blocked",message:`The page tried to open ${A.href} without a click`});return}globalThis.open(A.href,"_blank","noopener,noreferrer")},mt=(C,A)=>{let G=ge.current,j=Te.current;if(!u||!C||!A||!G||!j){z(null);return}let ve=G.getBoundingClientRect(),Ze=j.getBoundingClientRect(),Vn=ve.top-Ze.top+j.scrollTop+A.top-36,$n=ve.left-Ze.left+j.scrollLeft+(A.left+A.right)/2;z({text:C,top:Math.max(4,Vn),left:Math.min(Math.max(80,$n),Math.max(80,j.scrollWidth-80))})},gt=(C,A)=>{switch(C.type){case"ready":Me.current=!0,Pe({type:"highlight",quotes:[...xe.current]},A),Se.current!==null&&Pe({type:"focus",quote:Se.current},A),Se.current=null,ma();break;case"fetch":{!ne.current.has(C.path)&&ne.current.size<500&&(ne.current.set(C.path,r.find(j=>j.path===C.path)?.revision??0),ma()),ye.add(async()=>{let j=null;try{j=await f.readPageFile(e,C.path)}catch{j=null}le.current===A&&Pe({type:"file",id:C.id,file:j},A)})||Pe({type:"file",id:C.id,file:null},A);break}case"navigate":Tt(C.path,C.hash,C.redirect);break;case"open":pt(C.url);break;case"problem":fa(C.problem);break;case"selection":mt(C.text,C.rect);break;case"anchors":ia.current=C.missing,ma();break;case"focused":C.found||M("That passage is no longer on this page");break;case"scroll":Xe.current.scroll={x:C.x,y:C.y};break;case"hash":Xe.current.hash=C.hash;break;case"storage":Kd(e,C.entries);break;default:break}},B=D(gt);B.current=gt,E(()=>{let C=A=>{let G=ge.current,j=A.ports?.[0];!G||!j||A.source!==G.contentWindow||!bn(A.data)||(le.current?.close(),le.current=j,Me.current=!1,ia.current=[],ne.current=new Map,ye.clear(),k([]),h(null),z(null),j.onmessage=ve=>{if(le.current!==j)return;let Ze=Cn(ve.data);Ze&&B.current(Ze,j)})};return globalThis.addEventListener("message",C),()=>{globalThis.removeEventListener("message",C),le.current?.close(),le.current=null,ye.clear(),Re.current&&clearTimeout(Re.current)}},[ye]);let we=n.join("\0");E(()=>{Me.current&&Pe({type:"highlight",quotes:we?we.split("\0"):[]})},[we]),E(()=>{if(!c)return;let C={focusQuote(A){return Me.current&&le.current?Pe({type:"focus",quote:A}):Se.current=A,!0}};return c.current=C,()=>{c.current===C&&(c.current=null)}},[c]);let wa=[...X(()=>S?[...S.page.missing.map(C=>({kind:"missing",message:`The page uses ${C}, which is not a file in this doc`})),...S.page.warnings.map(C=>({kind:"blocked",message:C}))]:[],[S]),...F],jn=async()=>{try{let{url:C}=await f.pageLink(e,i);globalThis.open(C,"_blank","noopener,noreferrer")}catch(C){M(O(C),"error")}},eo=C=>{!y||!C||(C(y.text),z(null),Pe({type:"clear-selection"}))},Mt=Pn.find(C=>C.id===m).width;return s("div",{className:"dd-html-stage",onMouseDown:C=>{C.target.closest?.(".dd-selection-chip")||z(null)},children:[s("div",{className:"dd-html-toolbar",children:[s("div",{className:"dd-html-status",children:[I?o(V,{size:12,label:"Rendering page"}):null,t?o("span",{className:"dd-muted",children:"Unsaved changes"}):null]}),o("div",{className:"dd-html-widths",role:"toolbar","aria-label":"Preview width",children:Pn.map(C=>o("button",{type:"button",className:`icon-btn${m===C.id?" on":""}`,title:C.label,"aria-label":C.label,"aria-pressed":m===C.id,onClick:()=>L(C.id),children:o(C.icon,{size:14,"aria-hidden":!0})},C.id))}),s("div",{className:"dd-html-actions",children:[wa.length?o(re,{open:T,onClose:()=>p(!1),className:"dd-page-problems",anchor:s("button",{type:"button",className:"dd-page-badge","aria-label":`${wa.length} page ${wa.length===1?"problem":"problems"}`,"aria-expanded":T,onClick:()=>p(C=>!C),children:[o(pe,{size:13,"aria-hidden":!0}),wa.length]}),children:o("ul",{"aria-label":"Page problems",children:wa.map((C,A)=>s("li",{className:`dd-page-problem dd-page-problem-${C.kind}`,children:[o("span",{className:"dd-page-problem-kind",children:Xd[C.kind]}),o("span",{className:"dd-page-problem-message",children:C.message}),C.source?s("span",{className:"dd-muted dd-page-problem-source",children:[C.source,C.line?`:${C.line}`:""]}):null]},A))})}):null,t?null:o(_,{icon:Ye,label:"Open in browser",onClick:()=>{jn()}})]})]}),v?s("div",{className:"dd-banner dd-banner-info",children:[o(Ba,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:["This page redirects to ",o("code",{children:v.path}),"."]}),o("button",{type:"button",className:"btn",onClick:()=>{h(null),ft(v.path,v.hash)},children:"Go there"}),o(_,{icon:Q,label:"Dismiss",onClick:()=>h(null)})]}):null,N?s("div",{className:"dd-banner dd-banner-warn",children:[o(pe,{size:14,"aria-hidden":!0}),o("span",{className:"dd-banner-text",children:"This draft is too large to preview. Save it to see the page."})]}):null,q?o("div",{className:"dd-banner dd-banner-error",children:q}):null,s("div",{className:"dd-html-viewport",ref:Te,children:[S?o("iframe",{ref:ge,className:`dd-html-frame${Mt?" dd-html-frame-device":""}`,style:Mt?{width:Mt}:void 0,sandbox:"allow-scripts allow-forms",srcDoc:S.srcDoc,title:i},S.id):q||N?null:o("div",{className:"dd-center",children:o(V,{label:"Rendering page"})}),y?s("div",{className:"dd-selection-chip",style:{top:y.top,left:y.left},children:[s("button",{type:"button",onClick:()=>eo(u),children:[o(oa,{size:13,"aria-hidden":!0}),"Comment"]}),l?s("button",{type:"button",onClick:()=>eo(l),children:[o(J,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})]})}var as=24,ts=64,Sa=new Map;function os(e,a){for(Sa.delete(e),Sa.set(e,a);Sa.size>ts;)Sa.delete(Sa.keys().next().value)}function rs(e,a,r){let t=U(),n=X(()=>{let f=new Map(a.map(i=>[i.path,i]));return r.map(i=>f.get(i)).filter(i=>!!i&&(i.kind==="image"||i.kind==="svg")).slice(0,as)},[a,r]),d=n.map(f=>`${f.path}@${f.revision}`).join("|"),u=D(n);u.current=n;let[l,c]=b(new Map);return E(()=>{let f=u.current,i=!1,m=new Map,L=[];for(let S of f){let g=Sa.get(`${e}\0${S.path}\0${S.revision}`);g?m.set(S.path,g):L.push(S)}if(c(m),!!L.length)return Promise.all(L.map(async S=>{try{let g=await t.readFile(e,S.path),I=Et(g);I&&(os(`${e}\0${g.path}\0${g.revision}`,I),m.set(g.path,I))}catch{}})).then(()=>{i||c(new Map(m))}),()=>{i=!0}},[t,e,d]),l}function ct({docId:e,file:a,files:r,quotes:t=[],onOpenPath:n,onQuote:d,onAskAbout:u,handleRef:l,draft:c=!1}){let f=D(null),i=D(null),m=D({}),[L,S]=b(null),g=X(()=>a.kind==="markdown"?Zr(a.path,a.content):[],[a.path,a.content,a.kind]),I=rs(e,r,g),P=X(()=>new Set(r.map(p=>p.path)),[r]),q=X(()=>a.kind==="markdown"?Jr(a.path,a.content,I):a.kind==="mermaid"?qt(a.content,"mermaid"):a.kind==="code"?Qr(a.path,a.content):null,[a.kind,a.path,a.content,I]),R=t.join("\0");E(()=>{let p=i.current,v=m.current,h=R?R.split("\0"):[];if(!p||!h.length){sa(vt,v,[]);return}let y=()=>sa(vt,v,[..._t(p,h).values()]),z=setTimeout(y,60),Z=typeof MutationObserver=="function"?new MutationObserver(()=>y()):null;return Z?.observe(p,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(z),Z?.disconnect(),sa(vt,v,[]),sa(kt,v,[])}},[R,q,a.kind,a.content]);let N=a.kind!=="html";E(()=>{if(!(!l||!N))return l.current={focusQuote(p){let v=i.current,h=v?_t(v,[p]).get(p):void 0;return h?(h.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),sa(kt,m.current,[h]),setTimeout(()=>sa(kt,m.current,[]),1800),!0):!1}},()=>{l.current=null}},[l,N]);let w=p=>{let v=p.target?.closest?.("a");if(!v)return;let h=v.getAttribute("href")??"";if(h.startsWith("#")){p.preventDefault(),p.stopPropagation();return}let y=st(a.path,h);if(!y)return;p.preventDefault(),p.stopPropagation();let z=[...P].find(Z=>Z.startsWith(`${y}/`));P.has(y)?n?.(y):z?n?.(z):M(`${y} is not a file in this design doc`,"error")},F=()=>{if(!d)return;let p=globalThis.getSelection?.(),v=f.current,h=p?.toString().trim()??"";if(!p||p.isCollapsed||!h||!v||!i.current?.contains(p.anchorNode)){S(null);return}let y=p.getRangeAt(0).getBoundingClientRect(),z=v.getBoundingClientRect();S({text:h.slice(0,500),top:Math.max(4,y.top-z.top+v.scrollTop-36),left:Math.min(Math.max(80,y.left-z.left+y.width/2),Math.max(80,z.width-80))})},k=p=>{!L||!p||(p(L.text),S(null),globalThis.getSelection?.()?.removeAllRanges())},T;if(a.kind==="html")T=o(wn,{docId:e,file:a,files:r,draft:c,quotes:t,onOpenPath:n,onQuote:d,onAskAbout:u,handleRef:l},`${e}\0${a.path}`);else if(a.kind==="image"||a.kind==="svg"){let p=Et(a);T=o("div",{className:"dd-image-stage",children:p?o("img",{src:p,alt:a.path}):o("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else a.kind==="font"?T=o("div",{className:"dd-image-stage",children:o("span",{className:"dd-muted",children:"Font file. Pages in this doc load it through @font-face."})}):q!==null?T=o("div",{className:`dd-prose dd-prose-${a.kind}`,ref:i,onClickCapture:w,children:a.kind==="markdown"&&!a.content.trim()?o("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):o(va,{content:q})}):T=o("div",{className:"dd-prose",ref:i,children:o("pre",{className:"dd-plain",children:a.content})});return s("div",{className:`dd-preview dd-preview-${a.kind}`,ref:f,onMouseUp:F,onMouseDown:p=>{p.target.closest?.(".dd-selection-chip")||S(null)},children:[T,L?s("div",{className:"dd-selection-chip",style:{top:L.top,left:L.left},children:[s("button",{type:"button",onClick:()=>k(d),children:[o(oa,{size:13,"aria-hidden":!0}),"Comment"]}),u?s("button",{type:"button",onClick:()=>k(u),children:[o(J,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function vn(e,a,r=1500){let t=e.split(`
`),n=a.split(`
`),d=0;for(;d<t.length&&d<n.length&&t[d]===n[d];)d+=1;let u=t.length,l=n.length;for(;u>d&&l>d&&t[u-1]===n[l-1];)u-=1,l-=1;let c=t.slice(d,u),f=n.slice(d,l);if(c.length>r||f.length>r)return null;let i=f.length+1,m=new Uint32Array((c.length+1)*i);for(let I=c.length-1;I>=0;I-=1)for(let P=f.length-1;P>=0;P-=1)m[I*i+P]=c[I]===f[P]?m[(I+1)*i+P+1]+1:Math.max(m[(I+1)*i+P],m[I*i+P+1]);let L=[],S=0,g=0;for(;S<c.length&&g<f.length;)c[S]===f[g]?(L.push({type:"same",text:c[S]}),S+=1,g+=1):m[(S+1)*i+g]>=m[S*i+g+1]?(L.push({type:"del",text:c[S]}),S+=1):(L.push({type:"add",text:f[g]}),g+=1);for(;S<c.length;)L.push({type:"del",text:c[S++]});for(;g<f.length;)L.push({type:"add",text:f[g++]});return[...t.slice(0,d).map(I=>({type:"same",text:I})),...L,...t.slice(u).map(I=>({type:"same",text:I}))]}function kn(e,a=3){let r=new Uint8Array(e.length);e.forEach((d,u)=>{if(d.type!=="same")for(let l=Math.max(0,u-a);l<=Math.min(e.length-1,u+a);l+=1)r[l]=1});let t=[],n=0;for(;n<e.length;)if(r[n]){let d=[];for(;n<e.length&&r[n];)d.push(e[n++]);t.push({type:"lines",lines:d})}else{let d=0;for(;n<e.length&&!r[n];)d+=1,n+=1;t.push({type:"gap",count:d})}return t}function An(e){let a=0,r=0;for(let t of e)t.type==="add"?a+=1:t.type==="del"&&(r+=1);return{added:a,removed:r}}var ns={create:Ie,write:qe,delete:Oe,rename:$a},Dn={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function Tn({doc:e,activePath:a,now:r,selectedId:t,onSelect:n}){let d=U(),[u,l]=te("history-scope","file"),c=u==="file"?a:null,f=Ge(`${e.id}\0${c??"*"}\0${e.revision}`,()=>d.history(e.id,{...c?{path:c}:{},limit:100}));return s("div",{className:"dd-rail-pane dd-history",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[o("button",{type:"button",className:u==="file"?"on":"",onClick:()=>l("file"),disabled:!a,children:"This file"}),o("button",{type:"button",className:u==="all"?"on":"",onClick:()=>l("all"),children:"All files"})]})}),s("div",{className:"dd-rail-scroll",children:[f.error?o("div",{className:"dd-banner dd-banner-error",children:f.error}):null,!f.data&&f.loading?o("div",{className:"dd-center",children:o(V,{label:"Loading history"})}):null,f.data&&!f.data.length?o(me,{icon:fe,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,o("ol",{className:"dd-history-list",children:f.data?.map(i=>{let m=ns[i.op];return o("li",{children:s("button",{type:"button",className:`dd-history-row${t===i.id?" on":""}`,onClick:()=>n(i),children:[o(m,{size:13,className:`dd-op dd-op-${i.op}`,"aria-hidden":!0}),s("span",{className:"dd-history-main",children:[s("span",{className:"dd-history-title",children:[Dn[i.op],c?null:o("span",{className:"dd-history-path",children:i.path}),s("span",{className:"dd-history-rev",children:["rev ",i.revision]})]}),i.note?o("span",{className:"dd-history-note",children:i.note}):null,s("span",{className:"dd-history-meta",children:[o(se,{actor:i.actor}),o(ee,{at:i.createdAt,now:r})]})]})]})},i.id)})})]})]})}async function ds(e,a,r){let t=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||t.encoding==="base64")return{after:t,before:null,pruned:!1};if(r.op==="delete")return{after:t,before:t.content,pruned:!1};let n=(await e.history(a,{path:r.path,limit:100})).find(u=>u.id<r.id);if(!n)return{after:t,before:null,pruned:!0};if(n.op==="delete")return{after:t,before:"",pruned:!1};let d=await e.revision(a,n.id);return{after:t,before:d.content,pruned:!1}}function Mn({doc:e,revision:a,onClose:r,onOpenPath:t}){let n=U(),[d,u]=b(a.op==="write"||a.op==="delete"?"changes":"full"),[l,c]=b(!1),[f,i]=b(null),m=Ge(`${e.id}\0${a.id}`,()=>ds(n,e.id,a)),L=da(a.path),S=e.files.find(w=>w.path===a.path)??null,g=S?.revision===a.revision&&a.op!=="delete",I=X(()=>{let w=m.data;if(!w||w.before===null||De(L))return null;let F=vn(w.before,a.op==="delete"?"":w.after.content);return F?{hunks:kn(F),stats:An(F)}:"too-large"},[m.data,a.op,L]),P=async()=>{c(!0);try{let w=await n.restore(e.id,a.id,S?.revision??0);M(`Restored ${w.path} to revision ${a.revision} (now rev ${w.revision})`),t(w.path),r()}catch(w){M(`Could not restore: ${O(w)}`,"error")}finally{c(!1)}},q=()=>{if(S){P();return}i({title:`Recreate ${a.path}?`,body:s($,{children:[o("code",{children:a.path})," is no longer in this doc",a.op==="delete"?"":"; it may have been renamed",". Recreate it with the content of revision ",a.revision,"?"]}),confirmLabel:"Recreate",run:()=>{P()}})},R=I!==null,N=d==="full"||!R;return s("div",{className:"dd-revision",children:[s("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[o(fe,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o("strong",{children:Dn[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",o(se,{actor:a.actor})," ",o(ee,{at:a.createdAt,now:Date.now()}),a.renamedFrom?s($,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?s("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),R?s("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[o("button",{type:"button",className:d==="changes"?"on":"",onClick:()=>u("changes"),children:"Changes"}),o("button",{type:"button",className:d==="full"?"on":"",onClick:()=>u("full"),children:"Full file"})]}):null,s("button",{type:"button",className:"btn",disabled:g||l||!m.data,onClick:q,children:[o(Ae,{size:12,"aria-hidden":!0})," ",g?"Current":S?"Restore":"Recreate file"]}),o(_,{icon:Q,label:"Close revision",onClick:r})]}),s("div",{className:"dd-revision-body",children:[m.error?o("div",{className:"dd-banner dd-banner-error",children:m.error}):null,m.data?N?s($,{children:[m.data.pruned?o("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,I==="too-large"?o("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,o(ct,{docId:e.id,file:{path:a.path,kind:L,content:m.data.after.content,encoding:m.data.after.encoding},files:e.files,onOpenPath:t,draft:!0})]}):I&&I!=="too-large"?s("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[s("div",{className:"dd-diff-stats",children:[s("span",{className:"dd-diff-added",children:["+",I.stats.added]}),s("span",{className:"dd-diff-removed",children:["\u2212",I.stats.removed]}),o("span",{className:"dd-muted",children:na(a.size)})]}),I.hunks.map((w,F)=>w.type==="gap"?s("div",{className:"dd-diff-gap",children:["\u22EF ",w.count," unchanged line",w.count===1?"":"s"]},F):w.lines.map((k,T)=>s("div",{className:`dd-diff-line dd-diff-${k.type}`,role:"row",children:[o("span",{className:"dd-diff-sign","aria-hidden":!0,children:k.type==="add"?"+":k.type==="del"?"\u2212":" "}),o("span",{className:"dd-diff-text",children:k.text||" "})]},`${F}-${T}`))),I.stats.added+I.stats.removed===0?o("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:m.loading?o("div",{className:"dd-center",children:o(V,{label:"Loading revision"})}):null]}),f?o(be,{request:f,onClose:()=>i(null)}):null]})}var ss=[{id:"preview",label:"Preview",icon:Ea},{id:"edit",label:"Edit",icon:ra},{id:"split",label:"Split",icon:Ne}];function ls(e,a,r){let t=Rr(e,a,r),n=D(null);t.data&&(n.current=t.data);let d=n.current&&n.current.path===a?n.current:null;return{file:t.data??d,error:t.error,loading:t.loading}}function is(e,a,r){let[t,n]=b(null),d=D({path:e,revision:a});return E(()=>{let u=d.current;if(d.current={path:e,revision:a},u.path!==e||a===null||u.revision===null||a<=u.revision||r?.kind!=="agent")return;n(r.label);let l=setTimeout(()=>n(null),4e3);return()=>clearTimeout(l)},[e,a,r]),t}function Rn({doc:e,path:a,mode:r,onModeChange:t,railOpen:n,onToggleRail:d,revision:u,onCloseRevision:l,previewHandle:c,onOpenPath:f,onQuote:i,onAskAbout:m,onEditorState:L,leading:S}){let g=e.files.find(p=>p.path===a)??null,{file:I,error:P,loading:q}=ls(e.id,a,g?.revision??null),R=is(a,g?.revision??null,g?.updatedBy),N=!g||!De(g.kind),w=N?r:"preview",F=X(()=>e.comments.filter(p=>p.status==="open"&&p.path===a&&p.quote).map(p=>p.quote),[e.comments,a]),k=a.lastIndexOf("/");E(()=>{w==="preview"&&L({dirty:!1,saving:!1})},[w,L]);let T;return u?T=o(Mn,{doc:e,revision:u,onClose:l,onOpenPath:f},u.id):!g&&!(I&&w!=="preview")?T=s("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}):I?w==="preview"?T=o(ct,{docId:e.id,file:I,files:e.files,quotes:F,onOpenPath:f,onQuote:i,onAskAbout:m,handleRef:c}):T=o(mn,{docId:e.id,file:I,removed:!g,split:w==="split",onStateChange:L,renderPreview:p=>o(ct,{docId:e.id,file:{...I,content:p},files:e.files,onOpenPath:f,draft:p!==I.content})},`${e.id}\0${a}`):T=o("div",{className:"dd-center",children:P?o("div",{className:"dd-banner dd-banner-error",children:P}):q?o(V,{label:"Loading file"}):null}),s("section",{className:"dd-file-pane","aria-label":a,children:[s("div",{className:"dd-file-toolbar",children:[S,g?o(ha,{kind:g.kind}):null,s("span",{className:"dd-file-path",title:a,children:[k>0?o("span",{className:"dd-file-dir",children:a.slice(0,k+1)}):null,o("span",{className:"dd-file-name",children:a.slice(k+1)})]}),g?s("span",{className:"dd-file-meta",children:["rev ",g.revision," \xB7 ",na(g.size)," \xB7 ",o(se,{actor:g.updatedBy})," ",o(ee,{at:g.updatedAt,now:Date.now()})]}):null,R?s("span",{className:"dd-flash",role:"status",children:[o(ae,{size:12,"aria-hidden":!0})," Updated by ",R]}):null,o("span",{className:"dd-spacer"}),u?null:o("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:ss.map(p=>s("button",{type:"button",className:w===p.id?"on":"",disabled:!N&&p.id!=="preview",onClick:()=>t(p.id),title:p.label,"aria-pressed":w===p.id,children:[o(p.icon,{size:13,"aria-hidden":!0}),o("span",{className:"dd-mode-label",children:p.label})]},p.id))}),o(_,{icon:Wa,label:n?"Hide comments & history":"Show comments & history",active:n,onClick:d})]}),o("div",{className:"dd-file-body",children:T})]})}function fs(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,t=>t.toUpperCase());switch(da(e)){case"markdown":return`# ${r}

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
`;default:return""}}function ps(e){let a=e.trim().replace(/^\/+/,"");return dt(a)?a:`${a}.md`}function ms(e){return new Promise((a,r)=>{let t=new FileReader,n=De(da(e.name));t.onerror=()=>r(t.error??new Error("could not read the file")),t.onload=()=>{let d=String(t.result??"");a(n?{content:d.slice(d.indexOf(",")+1),encoding:"base64"}:{content:d})},n?t.readAsDataURL(e):t.readAsText(e)})}function Fn({initial:e,placeholder:a,onSubmit:r,onCancel:t}){let[n,d]=b(e),u=D(!1),l=f=>{f?.preventDefault(),!u.current&&(u.current=!0,n.trim()&&n.trim()!==e?r(n.trim()):t())};return o("form",{className:"dd-tree-input",onSubmit:l,children:o("input",{className:"dd-input",value:n,placeholder:a,"aria-label":a,onChange:f=>d(f.target.value),onKeyDown:f=>{f.key==="Escape"&&(f.preventDefault(),u.current=!0,t())},onBlur:()=>l(),autoFocus:!0,onFocus:f=>{let i=f.target.value.lastIndexOf("."),m=f.target.value.lastIndexOf("/")+1;f.target.setSelectionRange(m,i>m?i:f.target.value.length)}})})}function gs({doc:e,file:a,name:r,depth:t,active:n,renaming:d,onOpen:u,onRename:l,onRenameDone:c,onDelete:f}){let i=U(),[m,L]=b(!1),S=e.entryPath===a.path,g=e.comments.filter(I=>I.status==="open"&&I.path===a.path).length;return d?o("div",{className:"dd-tree-row",style:{paddingLeft:8+t*14},children:o(Fn,{initial:a.path,placeholder:"New path",onSubmit:I=>c(I),onCancel:()=>c(null)})}):s("div",{className:`dd-tree-row dd-tree-file${n?" on":""}`,style:{paddingLeft:8+t*14},children:[s("button",{type:"button",className:"dd-tree-open",onClick:u,onDoubleClick:l,title:`${a.path} \xB7 ${na(a.size)} \xB7 rev ${a.revision}`,"aria-current":n?"page":void 0,children:[o(ha,{kind:a.kind}),o("span",{className:"dd-tree-name",children:r}),S?o(Ue,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,g?o("span",{className:"dd-tree-badge",title:`${g} open comment${g===1?"":"s"}`,children:g}):null]}),s(re,{open:m,onClose:()=>L(!1),className:"dd-menu",anchor:o(_,{icon:Le,label:`Actions for ${a.path}`,size:13,active:m,onClick:()=>L(!m)}),children:[o(Y,{icon:ra,label:"Rename or move",onSelect:()=>{L(!1),l()}}),S||De(a.kind)?null:o(Y,{icon:Ya,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{L(!1),i.update(e.id,{entryPath:a.path}).catch(I=>M(O(I),"error"))}}),o(Y,{icon:oe,label:"Delete",danger:!0,onSelect:()=>{L(!1),f()}})]})]})}function Xt({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let d=U(),[u,l]=b(new Set),[c,f]=b(!1),[i,m]=b(null),[L,S]=b(null),g=D(null),I=an(e.files),P=e.files.length>=500,q=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",R=async p=>{f(!1);let v=ps(p);if(e.files.some(h=>h.path===v)){r(v);return}if(De(da(v))){M("Use \u201CAdd files\u201D to upload images and fonts.","error");return}try{await d.writeFile(e.id,{path:v,content:fs(v)}),r(v)}catch(h){M(`Could not create ${v}: ${O(h)}`,"error")}},N=(p,v)=>{if(m(null),!v||v===p)return;let h=async()=>{try{let y=await d.renameFile(e.id,p,v);t(p,y.path)}catch(y){M(`Could not rename ${p}: ${O(y)}`,"error")}};if(!n?.(p)){h();return}S({title:"Discard unsaved changes?",body:s($,{children:["Renaming ",o("code",{children:p})," drops your unsaved edits to it. Save them first to keep them."]}),confirmLabel:"Discard and rename",danger:!0,run:h})},w=async p=>{for(let v of Array.from(p??[])){let h=da(v.name),y=De(h)?2097152:2097152;if(v.size>y){M(`${v.name} is larger than ${na(y)}`,"error");continue}let z=h==="image"||h==="svg"||h==="font",Z=`${q||(z?"assets/":"")}${v.name.replace(/[^\w.-]+/g,"-")}`;try{let We=await ms(v);await d.writeFile(e.id,{path:Z,...We});let ge=Z.slice(q.length);M(h==="font"||!z?`Added ${Z}`:`Added ${Z}. Reference it with ![${v.name}](${ge})`)}catch(We){M(`Could not add ${v.name}: ${O(We)}`,"error")}}g.current&&(g.current.value="")},F=p=>S({title:"Delete file",body:s($,{children:["Delete ",o("code",{children:p.path}),"? Its history is kept, so it can be recreated from History.",n?.(p.path)?" Your unsaved edits to it will be lost.":null]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await d.deleteFile(e.id,p.path),t(p.path,null)}catch(v){M(`Could not delete ${p.path}: ${O(v)}`,"error")}}}),k=p=>l(v=>{let h=new Set(v);return h.has(p)?h.delete(p):h.add(p),h}),T=(p,v)=>p.map(h=>{if(h.kind==="folder"){let y=!u.has(h.path);return s("div",{role:"group","aria-label":h.name,children:[s("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+v*14},onClick:()=>k(h.path),"aria-expanded":y,children:[y?o(ie,{size:12,"aria-hidden":!0}):o(Qe,{size:12,"aria-hidden":!0}),y?o(aa,{size:14,"aria-hidden":!0}):o(_a,{size:14,"aria-hidden":!0}),o("span",{className:"dd-tree-name",children:h.name})]}),y?T(h.children,v+1):null]},`d:${h.path}`)}return o(gs,{doc:e,file:h.file,name:h.name,depth:v,active:h.path===a,renaming:i===h.path,onOpen:()=>r(h.path),onRename:()=>m(h.path),onRenameDone:y=>{N(h.path,y)},onDelete:()=>F(h.file)},`f:${h.path}`)});return s("nav",{className:"dd-tree","aria-label":"Files",children:[s("div",{className:"dd-tree-head",children:[o("span",{className:"dd-section-label",children:"Files"}),o("span",{className:"dd-tree-count",children:e.files.length}),o("span",{className:"dd-spacer"}),o(_,{icon:Ie,label:"Add files",size:13,disabled:P,onClick:()=>g.current?.click()}),o(_,{icon:ce,label:"New file",size:13,disabled:P,onClick:()=>f(!0)}),o("input",{ref:g,type:"file",multiple:!0,hidden:!0,onChange:p=>{w(p.target.files)}})]}),s("div",{className:"dd-tree-scroll",role:"tree",children:[T(I,0),c?o("div",{className:"dd-tree-row",style:{paddingLeft:8},children:o(Fn,{initial:q,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:p=>{R(p)},onCancel:()=>f(!1)})}):null]}),L?o(be,{request:L,onClose:()=>S(null)}):null]})}var xs=640,hs=1100,Kt=[xs,hs];function Ls(e,a){let r=t=>!!t&&e.files.some(n=>n.path===t);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function Is({doc:e,tab:a,onTab:r,activePath:t,now:n,pendingQuote:d,onClearQuote:u,commentDraft:l,onCommentDraft:c,onFocusComment:f,selectedRevision:i,onSelectRevision:m,onClose:L}){let S=[{id:"comments",label:"Comments",icon:Ce,count:e.openComments},{id:"history",label:"History",icon:fe},{id:"agents",label:"Agents",icon:ae,count:e.threads.length}];return s("aside",{className:"dd-rail","aria-label":"Comments, history and agents",children:[s("div",{className:"dd-rail-tabs",role:"tablist",children:[S.map(g=>s("button",{type:"button",role:"tab","aria-selected":a===g.id,className:`dd-rail-tab${a===g.id?" on":""}`,onClick:()=>r(g.id),children:[o(g.icon,{size:13,"aria-hidden":!0}),g.label,g.count?o("span",{className:"dd-count",children:g.count}):null]},g.id)),L?s($,{children:[o("span",{className:"dd-spacer"}),o(_,{icon:Q,label:"Close",onClick:L,size:13})]}):null]}),a==="comments"?o(rn,{doc:e,activePath:t,now:n,pendingQuote:d,onClearQuote:u,draft:l,onDraft:c,onFocusComment:f}):a==="history"?o(Tn,{doc:e,activePath:t,now:n,selectedId:i,onSelect:m}):o(Ur,{doc:e,now:n})]})}function Cs({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let[d,u]=b(!1),l=e.files.find(c=>c.path===a);return o(re,{open:d,onClose:()=>u(!1),align:"start",className:"dd-switcher-pop",anchor:s("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":d,onClick:()=>u(!d),title:"Files in this doc",children:[l?o(ha,{kind:l.kind}):null,s("span",{children:[e.files.length," files"]}),o(ie,{size:12,"aria-hidden":!0})]}),children:o(Xt,{doc:e,activePath:a,onOpen:c=>{u(!1),r(c)},onPathChanged:t,hasDraft:n})})}function Dt({docId:e,path:a,onOpenPath:r,layout:t,contextProjectId:n=null,onDeleted:d,headerExtra:u}){let l=St(e),c=je(),f=xa(),i=t==="compact",[m,L]=Fr(Kt),S=!i&&(L??Kt.length)>=1,g=!i&&(L??Kt.length)>=2,[I,P]=te("view-mode","preview"),[q,R]=te("rail",!0),[N,w]=te("rail-compact",!1),F=g?q:N,k=g?R:w,[T,p]=te("rail-tab","comments"),[v,h]=b(null),[y,z]=b(""),[Z,We]=b(null),[ge,Te]=b(null),[le,Me]=b(null),[Se,ia]=b(null),ne=D({dirty:!1,saving:!1}),[Re,ua]=b(!1),Xe=D(null),xe=D(null),ye=D(null),W=l.data,de=W?Ls(W,a):null,Pa=!!W&&!!xe.current&&!W.files.some(B=>B.path===xe.current);Pa||(ye.current=null);let K=Pa&&(Re||ye.current===xe.current)?xe.current:de;xe.current=K;let ca=!!W&&!!l.error&&vr(l.error),Ke=D({onDeleted:d,title:W?.title??""});Ke.current={onDeleted:d,title:W?.title??Ke.current.title};let Pe=he(B=>{ne.current.saving&&!B.saving&&!B.dirty&&(ye.current=xe.current),ne.current=B,ua(B.dirty)},[]),fa=he(()=>{ne.current={dirty:!1,saving:!1},ye.current=null,ua(!1)},[]),Fe=he(B=>{if(!ne.current.dirty){B();return}Me({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{fa(),B()}})},[fa]),pa=he(B=>{if(B===K){Te(null);return}Fe(()=>{Te(null),r(B)})},[K,Fe,r]);if(E(()=>{ca&&(M(`\u201C${Ke.current.title}\u201D was deleted`),Ke.current.onDeleted())},[ca]),E(()=>{if(!Se||Se.path!==K||ge)return;let B=[80,300,900].map(we=>setTimeout(()=>{Xe.current?.focusQuote(Se.quote)&&(B.forEach(clearTimeout),ia(null))},we));return()=>B.forEach(clearTimeout)},[Se,K,ge]),!W)return o("div",{className:"dd-doc dd-center",children:l.error?o(me,{icon:ue,title:"This design doc could not be opened",children:l.error}):o(V,{label:"Loading design doc"})});let ma=B=>Fe(()=>{Te(null),B.path&&B.path!==K&&r(B.path),I!=="preview"&&P("preview"),g||k(!1),B.quote&&ia({path:B.path??K??"",quote:B.quote,nonce:Date.now()})}),ft=B=>Fe(()=>{Te(B),B.path!==K&&W.files.some(we=>we.path===B.path)&&r(B.path)}),Tt=B=>{B==="preview"?Fe(()=>P(B)):P(B)},pt=(B,we)=>{B===K&&(fa(),r(we,!0))},mt=B=>B===K&&ne.current.dirty,gt=o(Is,{doc:W,tab:T,onTab:p,activePath:K,now:f,pendingQuote:v,onClearQuote:()=>h(null),commentDraft:y,onCommentDraft:z,onFocusComment:ma,selectedRevision:ge?.id??null,onSelectRevision:ft,onClose:g?void 0:()=>k(!1)});return s("div",{ref:m,className:`dd-doc dd-doc-${t}${F?" dd-rail-open":""}${g?"":" dd-rail-floating"}`,children:[o(pn,{doc:W,projects:c.data??[],compact:i,onDeleted:d,actions:s($,{children:[u,o(_r,{doc:W,activePath:K,request:Z,contextProjectId:n,compact:i})]})}),s("div",{className:"dd-doc-body",children:[S?o(Xt,{doc:W,activePath:K,onOpen:pa,onPathChanged:pt,hasDraft:mt}):null,K?o(Rn,{doc:W,path:K,mode:I,onModeChange:Tt,railOpen:F,onToggleRail:()=>k(!F),revision:ge,onCloseRevision:()=>Te(null),previewHandle:Xe,onOpenPath:pa,onQuote:B=>{h({path:K,text:B}),p("comments"),k(!0)},onAskAbout:B=>We({prompt:`About this passage in ${K}:
> ${B.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:Pe,leading:S?null:o(Cs,{doc:W,activePath:K,onOpen:pa,onPathChanged:pt,hasDraft:mt})}):o("div",{className:"dd-file-pane dd-center",children:o(me,{icon:ue,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),F?gt:null]}),le?o(be,{request:le,onClose:()=>Me(null)}):null]})}var Bn="__global__",bs=It-600;function Ss(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function ys(e,a){let[r,t]=b(e);return E(()=>{let n=setTimeout(()=>t(e),a);return()=>clearTimeout(n)},[e,a]),r}function Ps({doc:e,active:a,projectName:r,now:t,menuOpen:n,onSelect:d,onMenu:u}){return s("button",{type:"button",className:`dd-doc-row${a?" on":""}${n?" dd-doc-row-menu":""}`,onClick:d,onContextMenu:l=>{l.preventDefault(),u(Or(l))},"aria-current":a?"page":void 0,"aria-haspopup":"menu",children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:e.title}),o(Ve,{status:e.status,compact:!0})]}),e.summary?o("span",{className:"dd-doc-row-summary",children:e.summary}):null,s("span",{className:"dd-doc-row-meta",children:[r!==null?o("span",{className:"dd-doc-row-project",children:r}):null,s("span",{title:`${e.fileCount} files`,children:[o(ea,{size:11,"aria-hidden":!0})," ",e.fileCount]}),e.openComments?s("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[o(Ce,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,e.updatedBy.kind==="agent"?o(ae,{size:11,"aria-label":"Last edited by an agent"}):null,o("span",{className:"dd-spacer"}),o(ee,{at:e.updatedAt,now:t})]})]})}function ws({projectId:e,showProjects:a,projects:r,activeId:t,onSelect:n,onDeleted:d,onNew:u,headerActions:l}){let[c,f]=b(""),[i,m]=te("list-status","active"),[L,S]=te("list-project",""),[g,I]=b(!1),[P,q]=b(null),R=wt(r),N=ys(c.trim(),200),w=xa(),F=bt({...e?{projectId:e}:{},...N?{query:N}:{},status:i}),k=X(()=>new Map(r.map(h=>[h.id,h.name])),[r]),T=X(()=>{let h=F.data??[];return!a||!L?h:h.filter(y=>L===Bn?y.projectId===null:y.projectId===L)},[F.data,a,L]),p=i!=="active"||a&&!!L,v=i==="active"?"Active":i==="all"?"All":rt[i];return s("div",{className:"dd-list",children:[s("div",{className:"dd-list-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary dd-new",onClick:u,children:[o(ce,{size:13,"aria-hidden":!0})," New"]}),l]}),s("div",{className:"dd-list-tools",children:[s("label",{className:"dd-search",children:[o(Ja,{size:13,"aria-hidden":!0}),o("input",{value:c,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:h=>f(h.target.value)}),c?o("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>f(""),children:o(Q,{size:12,"aria-hidden":!0})}):null]}),s(re,{open:g,onClose:()=>I(!1),className:"dd-menu",anchor:o(_,{icon:He,label:`Filter (${v})`,active:p||g,onClick:()=>I(!g)}),children:[o("div",{className:"dd-menu-section",children:"Status"}),["active",...Ct,"all"].map(h=>o(Y,{label:h==="active"?"Active (not archived)":h==="all"?"All":rt[h],checked:h===i,onSelect:()=>{m(h),I(!1)}},h)),a?s($,{children:[o("div",{className:"dd-menu-section",children:"Project"}),[{id:"",name:"All projects"},{id:Bn,name:"Global docs"},...r].map(h=>o(Y,{label:h.name,checked:h.id===L,onSelect:()=>{S(h.id),I(!1)}},h.id||"all"))]}):null]})]}),s("div",{className:"dd-list-scroll",children:[F.error?o("div",{className:"dd-banner dd-banner-error",children:F.error}):null,!F.data&&F.loading?o("div",{className:"dd-center",children:o(V,{label:"Loading design docs"})}):null,F.data&&!T.length?o("div",{className:"dd-list-empty dd-muted",children:N||p?"No docs match.":"No design docs yet."}):null,T.map(h=>o(Ps,{doc:h,active:h.id===t,projectName:a?h.projectId?k.get(h.projectId)??"Unknown project":"Global":h.projectId?null:"Global",now:w,menuOpen:P?.doc.id===h.id,onSelect:()=>n(h.id),onMenu:y=>q({doc:h,at:y})},h.id))]}),P?o(Hr,{at:P.at,label:`Actions for ${P.doc.title}`,onClose:()=>q(null),children:R.items(P.doc,()=>q(null),()=>d(P.doc.id),P.doc.id===t?void 0:()=>n(P.doc.id))},`${P.doc.id}@${P.at.x},${P.at.y}`):null,R.dialogs]})}function Nn({templates:e,selected:a,onSelect:r}){return o("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(t=>s("button",{type:"button",role:"radio","aria-checked":a===t.id,className:`dd-template${a===t.id?" on":""}`,onClick:()=>r(t.id),children:[o("span",{className:"dd-template-label",children:t.label}),o("span",{className:"dd-template-desc",children:t.description}),o("span",{className:"dd-template-files",children:t.files.join(" \xB7 ")})]},t.id))})}function Zt({initialTemplate:e,defaultProjectId:a,projects:r,onClose:t,onCreated:n}){let d=U(),u=ke(),l=Ft(),[c,f]=b(""),[i,m]=b(""),[L,S]=b(e??null),[g,I]=b(a??""),[P,q]=b(""),[R,N]=b(""),[w,F]=b(!1),k=L??l.data?.[0]?.id??null,T=!!R.trim(),p=g||a||r[0]?.id||"",v=async()=>{if(!(!c.trim()||w)){F(!0);try{let h=await d.create({title:c.trim(),...i.trim()?{summary:i.trim()}:{},...k?{template:k}:{},tags:P.split(",").map(y=>y.trim().toLowerCase()).filter(Boolean),projectId:g||null});if(n(h.id),T)if(!p)M("Doc created. Add a project to let an agent draft it.","error");else{let y=await d.askAgent(h.id,{prompt:Ss(R),projectId:p});u.openThreadPanel({actionId:$e,title:h.title,params:{docId:h.id},threadId:y.threadId}),u.toThread(y.threadId),M(`An agent is drafting \u201C${h.title}\u201D. Watch it fill in beside the chat.`)}t()}catch(h){M(`Could not create the doc: ${O(h)}`,"error"),F(!1)}}};return o(nt,{title:"New design doc",wide:!0,onClose:t,footer:s($,{children:[o("span",{className:"dd-muted dd-dialog-hint",children:T?"An agent starts a new thread to draft it.":"You can ask an agent to fill it in later."}),o("span",{className:"dd-spacer"}),o("button",{type:"button",className:"btn",onClick:t,children:"Cancel"}),s("button",{type:"button",className:"btn primary",disabled:!c.trim()||w,onClick:()=>{v()},children:[w?o(V,{size:12}):T?o(J,{size:12,"aria-hidden":!0}):null,T?"Create & draft with agent":"Create"]})]}),children:s("form",{className:"dd-form",onSubmit:h=>{h.preventDefault(),v()},children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Title"}),o("input",{className:"dd-input",value:c,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:h=>f(h.target.value),autoFocus:!0})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Summary"}),o("input",{className:"dd-input",value:i,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:h=>m(h.target.value)})]}),s("div",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Template"}),l.data?o(Nn,{templates:l.data,selected:k,onSelect:S}):o(V,{label:"Loading templates"})]}),s("div",{className:"dd-field-row",children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:g,onChange:h=>I(h.target.value),children:[o("option",{value:"",children:"Global (all projects)"}),r.map(h=>o("option",{value:h.id,children:h.name},h.id))]})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Tags"}),o("input",{className:"dd-input",value:P,placeholder:"sync, mobile",onChange:h=>q(h.target.value)})]})]}),s("label",{className:"dd-field",children:[s("span",{className:"dd-field-label",children:[o(J,{size:12,"aria-hidden":!0})," Brief for an agent ",o("span",{className:"dd-muted",children:"(optional)"})]}),o("textarea",{className:"dd-input",rows:4,value:R,maxLength:bs,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:h=>N(h.target.value)})]}),o("button",{type:"submit",hidden:!0})]})})}function vs({templates:e,onNew:a}){return o("div",{className:"dd-landing",children:s("div",{className:"dd-landing-inner",children:[o("span",{className:"dd-landing-icon",children:o(Ee,{size:26,"aria-hidden":!0})}),o("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),o("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),s("ul",{className:"dd-landing-points",children:[s("li",{children:[o(J,{size:13,"aria-hidden":!0})," ",o("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),s("li",{children:[o(Ce,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),s("li",{children:[o(ae,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),s("div",{className:"dd-landing-start",children:[o("span",{className:"dd-section-label",children:"Start from a template"}),e?o(Nn,{templates:e,selected:null,onSelect:r=>a(r)}):o(V,{})]})]})})}function Jt({projectId:e,location:a,onLocationChange:r,variant:t,headerActions:n}){let d=je(),u=Ft(),[l,c]=b(null),f=d.data??[];return s("div",{className:"dd-root dd-workbench",children:[o(ws,{projectId:t==="project"?e:null,showProjects:t==="global",projects:f,activeId:a.docId,onSelect:i=>r({docId:i,path:null}),onDeleted:i=>{i===a.docId&&r({docId:null,path:null})},onNew:()=>c({template:null}),headerActions:n}),o("main",{className:"dd-main",children:a.docId?o(Dt,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(i,m)=>r({docId:a.docId,path:i},m??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):o(vs,{templates:u.data,onNew:i=>c({template:i??null})})}),l?o(Zt,{initialTemplate:l.template,defaultProjectId:e,projects:f,onClose:()=>c(null),onCreated:i=>r({docId:i,path:null})}):null]})}var ya="design-docs";function En({children:e}){return o("div",{className:"dd-root",children:e})}function qn({subPath:e}){let a=ke();return o(Jt,{variant:"global",projectId:null,location:Nt(e),onLocationChange:(r,t)=>a.toPluginPanel(ya,{subPath:Ia(r),...t?{replace:t}:{}})})}function On({projectId:e,headerActions:a}){let[r,t]=te(`project-location:${e}`,"");return o(Jt,{variant:"project",projectId:e,location:Nt(r),onLocationChange:n=>t(Ia(n)),headerActions:a})}function ks(e,a,r,t){e.openThreadPanel({actionId:$e,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...t?{threadId:t}:{}})||e.toPluginPanel(ya,{subPath:Ia(a)})}function Hn({attributes:e,source:a,message:r}){let t=ke(),n=e.id?.trim()||null,d=e.path?.trim()||null,u=St(n);if(!n||u.error)return o("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:n?`Design doc unavailable: ${u.error}`:"Invalid design doc link: an id is required."});let l=u.data;return s("div",{className:"plugin-directive-card dd-card",children:[s("button",{type:"button",className:"plugin-directive-card-main",disabled:!l,onClick:()=>l&&ks(t,{docId:l.id,path:d},l.title,r.threadId),title:l?`Open ${l.title} beside this conversation`:void 0,children:[o("span",{className:"dd-card-icon","aria-hidden":!0,children:o(Ee,{size:14})}),o("span",{className:"plugin-directive-card-kind",children:"Design doc"}),o("span",{className:"plugin-directive-card-title",children:l?l.title:"Loading\u2026"}),l?s("span",{className:"plugin-directive-card-meta dd-card-meta",children:[d?o("code",{children:d}):null,o(Ve,{status:l.status,compact:!0}),l.files.length," file",l.files.length===1?"":"s",l.openComments?` \xB7 ${l.openComments} open comment${l.openComments===1?"":"s"}`:""]}):o(V,{size:12})]}),l?o("button",{type:"button",className:"plugin-directive-card-open",onClick:c=>{c.stopPropagation(),t.toPluginPanel(ya,{subPath:Ia({docId:l.id,path:d})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function As({projectId:e,onPick:a}){let r=bt({...e?{projectId:e}:{},status:"active"}),t=je(),n=xa(),[d,u]=b(!1);return s("div",{className:"dd-picker",children:[s("div",{className:"dd-picker-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",onClick:()=>u(!0),children:[o(ce,{size:13,"aria-hidden":!0})," New"]})]}),o("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(l=>s("button",{type:"button",className:"dd-doc-row",onClick:()=>a(l.id),children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:l.title}),o(Ve,{status:l.status,compact:!0})]}),l.summary?o("span",{className:"dd-doc-row-summary",children:l.summary}):null,s("span",{className:"dd-doc-row-meta",children:[s("span",{children:[l.fileCount," files"]}),o("span",{className:"dd-spacer"}),o(ee,{at:l.updatedAt,now:n})]})]},l.id)):o(me,{icon:Ee,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):o("div",{className:"dd-center",children:r.error?o("div",{className:"dd-banner dd-banner-error",children:r.error}):o(V,{})})}),d?o(Zt,{defaultProjectId:e,projects:t.data??[],onClose:()=>u(!1),onCreated:l=>a(l)}):null]})}function Un(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function _n(e){let{docId:a,path:r}=Un(e.params);return o(Ds,{...e},`${a}\0${r}`)}function Ds({params:e,projectId:a}){let r=ke(),t=Un(e),[n,d]=b(t),u=!t.docId;if(!n.docId)return o(En,{children:o(As,{projectId:a??null,onPick:c=>d({docId:c,path:null})})});let l=n.docId;return o(En,{children:o(Dt,{docId:l,path:n.path,layout:"compact",contextProjectId:a??null,onOpenPath:c=>d({docId:l,path:c}),onDeleted:()=>d({docId:null,path:null}),headerExtra:s($,{children:[u?o(_,{icon:Ta,label:"All design docs",onClick:()=>d({docId:null,path:null})}):null,o(_,{icon:Ye,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(ya,{subPath:Ia(n)})})]})},l)})}async function zn({threadId:e,message:a,selectedText:r,openPanel:t}){let n=(r?.trim()||a.text).trim();if(!n){M("This message has no text to save.","error");return}try{let d=await to(kr,"createFromMessage",{threadId:e,text:n});t({actionId:$e,title:d.title,params:{docId:d.id}}),M(`Saved \u201C${d.title}\u201D as a design doc`)}catch(d){M(`Could not save the design doc: ${O(d)}`,"error")}}var Qt=`
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
.dd-root *, .dd-root *::before, .dd-root *::after,
.dd-dialog-backdrop *, .dd-context-menu * { box-sizing: border-box; }
.dd-root button, .dd-dialog-backdrop button, .dd-context-menu button { font: inherit; color: inherit; }
.dd-root :focus-visible, .dd-dialog-backdrop :focus-visible, .dd-context-menu :focus-visible { outline: 2px solid var(--focus-ring, var(--accent-blue)); outline-offset: 1px; }
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
`;var Gn="design-docs-plugin-styles";function Ts(){if(typeof document>"u")return;let e=document.getElementById(Gn);if(e instanceof HTMLStyleElement){e.textContent=Qt;return}let a=document.createElement("style");a.id=Gn,a.textContent=Qt,document.head.appendChild(a)}Ts();var xg=oo(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:ya,component:qn}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:On}),e.slots.messageDirective({id:"design-doc",component:Hn}),e.slots.threadPanelAction({id:$e,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:_n}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:zn})});export{xg as default,Ts as injectStyles};
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
lucide-react/dist/esm/icons/download.mjs:
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
