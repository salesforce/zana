function Zs(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Ua(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function ko(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function Ao(e,a,r){return Zs().callRpc(e,a,r)}function Do(e){return{__zccPluginApp:!0,setup:e}}function To(){return Ua().useRpc?.()??ko("useRpc")}function Mo(e,a){Ua().useRealtime?.(e,a)}function Ro(){return Ua().useZccContext?.()??{projectId:null,threadId:null}}function ye(){return Ua().useZccNavigate?.()??ko("useZccNavigate")}function Js(){return globalThis.__ZCC_HOST_REACT__}function Fo(e,a){let r=Js(),t=Ua()[e];return!r||!t?null:r.createElement(t,a)}function Bo(e){return Fo("ThreadChat",e)}function za(e){return Fo("Markdown",e)}var $=globalThis.__ZCC_HOST_REACT__;var mi=$.Children,gi=$.Component,hi=$.Fragment,xi=$.StrictMode,Li=$.Suspense,Ii=$.cloneElement,No=$.createContext,ya=$.createElement,Ci=$.createRef,Bt=$.forwardRef,bi=$.isValidElement,yi=$.lazy,Si=$.memo,Pi=$.startTransition,Ae=$.useCallback,Eo=$.useContext,vi=$.useDebugValue,Oo=$.useDeferredValue,O=$.useEffect,qo=$.useId,wi=$.useImperativeHandle,ki=$.useInsertionEffect,Sa=$.useLayoutEffect,X=$.useMemo,Ai=$.useReducer,R=$.useRef,y=$.useState,Ho=$.useSyncExternalStore,Di=$.useTransition,Ti=$.version;var _o=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Uo(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:_o(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var zo=e=>{let a="",r=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){r=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=r?t.toUpperCase():t,r=!1}return a};var jo=e=>{let a=zo(e);return a.charAt(0).toUpperCase()+a.slice(1)};var ja=(...e)=>e.filter((a,r,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===r).join(" ").trim();var $e={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function Kt(e){return e!=null}function Go(e,a={}){let r=a.attributeNames??{},t=C=>r[C]??C,n=e.size??e.width??$e.width,s=e.size??e.height??$e.height,i=e.aliases?.filter(C=>typeof C=="string"&&C.trim()!=="").map(C=>`lucide-${C}`)??[],l=[...e.name?[`lucide-${e.name}`]:[],...i],u=a.className?.split(" ").filter(Boolean)??[],c=a.includeDefaultClasses===!1?ja(...u):ja("lucide",...l,...u),p=a.absoluteStrokeWidth?Number(a.strokeWidth??$e["stroke-width"])*Number(e.size??e.width??$e.width)/Number(a.size??a.width??$e.width):a.strokeWidth??$e["stroke-width"];return["svg",{...Object.entries($e).reduce((C,[f,m])=>(C[t(f)]=m,C),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&Kt(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&Kt(a.width)&&{[t("width")]:a.width},..."height"in a&&Kt(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:p,...c&&{[t("class")]:c},[t("viewBox")]:`0 0 ${n} ${s}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(C=>{let[f,m,L]=C,A=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...m}:m;return L?[f,A,L]:[f,A]})]}function $o(e,a={}){return Go(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var Vo=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Qs=No({});var Wo=()=>Eo(Qs);var Xo=Bt(({color:e,size:a,width:r,height:t,strokeWidth:n,absoluteStrokeWidth:s,nonScalingStroke:i,className:l="",children:u,iconNode:c=[],icon:p={node:c,aliases:[],size:24},...I},C)=>{let{size:f=24,strokeWidth:m=2,absoluteStrokeWidth:L=!1,nonScalingStroke:A=!1,color:T="currentColor",className:w=""}=Wo()??{},F=!!u||Vo(I),[k,N,P=[]]=$o(p,{color:e??T,width:r??a??f,height:t??a??f,strokeWidth:n??m,absoluteStrokeWidth:s??L,nonScalingStroke:i??A,className:ja(w,l),hasA11yProp:F,attributes:I});return ya(k,{ref:C,...N},[...P.map(([E,x])=>ya(E,x)),...Array.isArray(u)?u:[u]])});function h(e,a=[],r=[]){let t=typeof e=="string"?Uo(e,a,r):e,n=Bt(({className:s,...i},l)=>ya(Xo,{ref:l,icon:t,className:s,...i}));return t.name&&(n.displayName=jo(t.name)),n}var Ko={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};Ko.node;var Ga=h(Ko);var Zo={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};Zo.node;var $a=h(Zo);var Jo={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};Jo.node;var ua=h(Jo);var Qo={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};Qo.node;var Va=h(Qo);var Yo={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};Yo.node;var me=h(Yo);var er={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};er.node;var Wa=h(er);var ar={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};ar.node;var Oe=h(ar);var tr={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};tr.node;var le=h(tr);var or={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};or.node;var ca=h(or);var rr={name:"chevron-up",size:24,node:[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]};rr.node;var Xa=h(rr);var nr={name:"circle-dot",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]};nr.node;var Ka=h(nr);var sr={name:"cloud-upload",size:24,node:[["path",{d:"M12 13v8",key:"1l5pq0"}],["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"m8 17 4-4 4 4",key:"1quai1"}]],aliases:["upload-cloud"]};sr.node;var qe=h(sr);var dr={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};dr.node;var Ve=h(dr);var lr={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};lr.node;var Za=h(lr);var ir={name:"corner-down-right",size:24,node:[["path",{d:"m15 10 5 5-5 5",key:"qqa56n"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12",key:"z08zvw"}]]};ir.node;var Ja=h(ir);var ur={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};ur.node;var We=h(ur);var cr={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};cr.node;var Qa=h(cr);var fr={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};fr.node;var De=h(fr);var pr={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};pr.node;var He=h(pr);var mr={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};mr.node;var Ya=h(mr);var gr={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};gr.node;var et=h(gr);var hr={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};hr.node;var Se=h(hr);var xr={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};xr.node;var at=h(xr);var Lr={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};Lr.node;var Xe=h(Lr);var Ir={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};Ir.node;var Te=h(Ir);var Cr={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};Cr.node;var tt=h(Cr);var br={name:"file-type",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M11 18h2",key:"12mj7e"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5",key:"qbrxap"}]]};br.node;var ot=h(br);var yr={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};yr.node;var Ke=h(yr);var Sr={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};Sr.node;var rt=h(Sr);var Pr={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};Pr.node;var _e=h(Pr);var vr={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};vr.node;var nt=h(vr);var wr={name:"git-fork",size:24,node:[["circle",{cx:"12",cy:"18",r:"3",key:"1mpf1b"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["path",{d:"M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9",key:"1uq4wg"}],["path",{d:"M12 12v3",key:"158kv8"}]]};wr.node;var st=h(wr);var kr={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};kr.node;var dt=h(kr);var Ar={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};Ar.node;var fa=h(Ar);var Dr={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};Dr.node;var Ze=h(Dr);var Tr={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};Tr.node;var lt=h(Tr);var Mr={name:"list-tree",size:24,node:[["path",{d:"M8 5h13",key:"1pao27"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"M3 10a2 2 0 0 0 2 2h3",key:"1npucw"}],["path",{d:"M3 5v12a2 2 0 0 0 2 2h3",key:"x1gjn2"}]]};Mr.node;var it=h(Mr);var Rr={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};Rr.node;var Je=h(Rr);var Fr={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};Fr.node;var pa=h(Fr);var Br={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};Br.node;var ut=h(Br);var Nr={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};Nr.node;var Ie=h(Nr);var Er={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};Er.node;var ct=h(Er);var Or={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};Or.node;var ft=h(Or);var qr={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};qr.node;var Me=h(qr);var Hr={name:"panel-left-open",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m14 9 3 3-3 3",key:"8010ee"}]],aliases:["sidebar-open"]};Hr.node;var Re=h(Hr);var _r={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};_r.node;var pt=h(_r);var Ur={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};Ur.node;var ma=h(Ur);var zr={name:"pin-off",size:24,node:[["path",{d:"M12 17v5",key:"bb1du9"}],["path",{d:"M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89",key:"znwnzq"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",key:"c9qhm2"}]]};zr.node;var mt=h(zr);var jr={name:"pin",size:24,node:[["path",{d:"M12 17v5",key:"bb1du9"}],["path",{d:"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",key:"1nkz8b"}]]};jr.node;var ga=h(jr);var Gr={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};Gr.node;var Ce=h(Gr);var $r={name:"reply",size:24,node:[["path",{d:"M20 18v-2a4 4 0 0 0-4-4H4",key:"5vmcpk"}],["path",{d:"m9 17-5-5 5-5",key:"nvlc11"}]]};$r.node;var gt=h($r);var Vr={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};Vr.node;var Pe=h(Vr);var Wr={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};Wr.node;var Ue=h(Wr);var Xr={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};Xr.node;var ht=h(Xr);var Kr={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};Kr.node;var xt=h(Kr);var Zr={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Zr.node;var ha=h(Zr);var Jr={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};Jr.node;var Lt=h(Jr);var Qr={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};Qr.node;var ne=h(Qr);var Yr={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};Yr.node;var It=h(Yr);var en={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};en.node;var Ct=h(en);var an={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};an.node;var xe=h(an);var tn={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};tn.node;var ve=h(tn);var on={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};on.node;var bt=h(on);var rn={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};rn.node;var yt=h(rn);var nn={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};nn.node;var Qe=h(nn);var sn={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};sn.node;var St=h(sn);var dn={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};dn.node;var ie=h(dn);var Zt=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];function ln(e){return Zt.find(a=>a.id===e)??null}var Nt=4e3;function un(e){let a=e.path?` Focus on ${e.path}.`:"",r=[e.action?.instruction,e.prompt?.trim()].filter(Boolean).join(`

`);return[`You are working on the design doc "${e.doc.title}" (id ${e.doc.id}) in the Design Docs plugin.${a}`,r,`Start with design_doc_read doc="${e.doc.id}" to see its files and open comments. Make changes in the doc itself with design_doc_write (prefer small edits with baseRevision) and design_doc_comment, rather than pasting long content into chat. The user is watching the doc update live. When you finish, summarise what you changed and end with ::design-doc{id="${e.doc.id}"} on its own line.`].filter(Boolean).join(`

`)}function Ys(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function ed(e){let a=(t,n)=>e(t,n===void 0?void 0:Ys(n)),r=async t=>{await t};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(t={})=>a("list",t),get:t=>a("get",{doc:t}),create:t=>a("create",t),update:(t,n)=>a("update",{doc:t,...n}),pin:(t,n)=>a("pin",{doc:t,pinned:n}),remove:t=>r(a("remove",{doc:t})),readFile:(t,n)=>a("readFile",{doc:t,path:n}),renderPage:(t,n)=>a("renderPage",{doc:t,...n}),readPageFile:(t,n)=>a("readPageFile",{doc:t,path:n}),pageLink:(t,n)=>a("pageLink",{doc:t,path:n}),siteFiles:t=>a("siteFiles",{doc:t}),reportRender:(t,n)=>r(a("reportRender",{doc:t,...n})),writeFile:(t,n)=>a("writeFile",{doc:t,...n}),editFile:(t,n)=>a("editFile",{doc:t,...n}),deleteFile:(t,n)=>r(a("deleteFile",{doc:t,path:n})),renameFile:(t,n,s)=>a("renameFile",{doc:t,from:n,to:s}),history:(t,n={})=>a("history",{doc:t,...n}),revision:(t,n)=>a("revision",{doc:t,id:n}),restore:(t,n,s)=>a("restore",{doc:t,id:n,baseRevision:s}),addComment:(t,n)=>a("addComment",{doc:t,...n}),replyToComment:(t,n,s)=>a("replyToComment",{doc:t,id:n,body:s}),setCommentStatus:(t,n,s)=>a("setCommentStatus",{doc:t,id:n,status:s}),deleteComment:(t,n)=>r(a("deleteComment",{doc:t,id:n})),unlinkThread:(t,n)=>r(a("unlinkThread",{doc:t,threadId:n})),askAgent:(t,n)=>a("askAgent",{doc:t,...n,path:n.path??void 0}),publish:(t,n)=>a("publish",{doc:t,...n})}}function G(){let e=To();return X(()=>ed((a,r)=>e.call(a,r)),[e])}function U(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function cn(e){return/changed since revision/i.test(U(e))}function fn(e){return/^design doc .* not found/i.test(e)}function B(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var pn="design-docs";var mn="changed",Et=["draft","review","approved","implemented","archived"],Ot={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function gn(e,a){let r=t=>t.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Ye(e,a){let[r,t]=y({key:e,data:null,error:null,loading:e!==null}),[n,s]=y(0),i=R(a);i.current=a,O(()=>{if(e===null){t({key:e,data:null,error:null,loading:!1});return}let c=!1;return t(p=>({key:e,data:p.key===e?p.data:null,error:null,loading:!0})),i.current().then(p=>{c||t({key:e,data:p,error:null,loading:!1})},p=>{c||t(I=>({key:e,data:I.key===e?I.data:null,error:U(p),loading:!1}))}),()=>{c=!0}},[e,n]);let l=Ae(()=>s(c=>c+1),[]),u=r.key===e;return{data:u?r.data:null,error:u?r.error:null,loading:u?r.loading:e!==null,reload:l}}function xn(e,a=120){let r=R(e);r.current=e;let t=R(new Set),n=R(null);O(()=>()=>{n.current&&clearTimeout(n.current)},[]),Mo(mn,s=>{let i=typeof s?.docId=="string"?s.docId:null;t.current.add(i),!n.current&&(n.current=setTimeout(()=>{n.current=null;let l=[...t.current];t.current.clear();for(let u of l)r.current(u)},a))})}function Pa(e){let a=G(),r=Ye(JSON.stringify(e),()=>a.list(e));return xn(()=>r.reload()),r}function qt(e){let a=G(),r=Ye(e,()=>a.get(e));return xn(t=>{(t===null||t===e)&&r.reload()}),r}function Ln(e,a,r){let t=G(),n=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Ye(n,()=>t.readFile(e,a))}function Jt(){let e=G();return Ye("templates",()=>e.templates())}function Fe(){let e=G();return Ye("projects",()=>e.projects())}var hn="zcc.design-docs.";function re(e,a){let[r,t]=y(()=>{try{let s=globalThis.localStorage?.getItem(hn+e);if(s==null)return a;let i=JSON.parse(s);return typeof i==typeof a?i:a}catch{return a}}),n=Ae(s=>{t(s);try{globalThis.localStorage?.setItem(hn+e,JSON.stringify(s))}catch{}},[e]);return[r,n]}function In(e){let[a,r]=y(null),[t,n]=y(null);return Sa(()=>{if(!a)return;let s=l=>n(l>0?e.filter(u=>l>=u).length:null);if(s(a.getBoundingClientRect().width),typeof ResizeObserver>"u")return;let i=new ResizeObserver(l=>s(l[0]?.contentRect.width??0));return i.observe(a),()=>i.disconnect()},[a,e]),[r,t]}function va(e=6e4){let[a,r]=y(()=>Date.now());return O(()=>{let t=setInterval(()=>r(Date.now()),e);return()=>clearInterval(t)},[e]),a}var ad=Symbol.for("react.portal");function td(e,a){return{$$typeof:ad,key:null,children:e,containerInfo:a,implementation:null}}function Qt(e){return typeof document>"u"?e:td(e,document.body)}function xa(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function Cn(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let t=Math.round(r/60);if(t<60)return`${t}m ago`;let n=Math.round(t/60);if(n<24)return`${n}h ago`;let s=Math.round(n/24);return s<30?`${s}d ago`:new Date(e).toISOString().slice(0,10)}var bn=globalThis.__ZCC_HOST_REACT__,V=bn.Fragment;function o(e,a,r){return bn.createElement(e,r===void 0?a:{...a,key:r})}var d=o;var od={MessageSquareText:ut,CheckCheck:Wa,WandSparkles:Qe,Workflow:St,ScanSearch:xt,ListChecks:lt};function yn(e){return od[e]??ne}function wa({kind:e,size:a=14}){return o(e==="image"||e==="svg"?at:e==="font"?ot:e==="markdown"||e==="text"?tt:et,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function ea({status:e,compact:a=!1}){return d("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[o("span",{className:"dd-status-dot","aria-hidden":!0}),Ot[e]]})}function be({actor:e}){let a=e.kind==="agent"?me:yt;return d("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[o(a,{size:12,"aria-hidden":!0}),o("span",{className:"dd-actor-label",children:e.label})]})}function pe({at:e,now:a}){return o("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:Cn(e,a)})}function K({size:e=14,label:a}){return o("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:o(Je,{size:e,className:"dd-spin","aria-hidden":!0})})}function we({icon:e,title:a,children:r}){return d("div",{className:"dd-empty",children:[o("span",{className:"dd-empty-icon",children:o(e,{size:22,"aria-hidden":!0})}),o("div",{className:"dd-empty-title",children:a}),r?o("div",{className:"dd-empty-body",children:r}):null]})}function z({icon:e,label:a,onClick:r,active:t=!1,danger:n=!1,disabled:s=!1,size:i=14}){return o("button",{type:"button",className:`icon-btn dd-icon-btn${t?" on":""}${n?" danger":""}`,title:a,"aria-label":a,"aria-pressed":t||void 0,disabled:s,onClick:r,children:o(e,{size:i,"aria-hidden":!0})})}function Sn(e,a){let r=R(null),t=R(a);return t.current=a,O(()=>{if(!e)return;let n=i=>{r.current&&i.target instanceof Node&&!r.current.contains(i.target)&&t.current()},s=i=>{i.key==="Escape"&&t.current()};return document.addEventListener("mousedown",n),document.addEventListener("keydown",s),()=>{document.removeEventListener("mousedown",n),document.removeEventListener("keydown",s)}},[e]),r}function ke({open:e,onClose:a,anchor:r,children:t,align:n="end",className:s=""}){let i=Sn(e,a);return d("div",{className:"dd-pop-anchor",ref:i,children:[r,e?o("div",{className:`dd-pop dd-pop-${n} ${s}`,role:"dialog",children:t}):null]})}function Pn(e){if(e.clientX||e.clientY)return{x:e.clientX,y:e.clientY};let a=e.currentTarget.getBoundingClientRect();return{x:a.left+12,y:a.bottom}}var Ht=4;function vn({at:e,label:a,onClose:r,children:t}){let n=Sn(!0,r),s=R(r);s.current=r;let[i,l]=y(e);Sa(()=>{let c=n.current,{width:p,height:I}=c.getBoundingClientRect();l({x:Math.max(Ht,Math.min(e.x,window.innerWidth-p-Ht)),y:Math.max(Ht,Math.min(e.y,window.innerHeight-I-Ht))})},[n,e.x,e.y]),O(()=>{let c=document.activeElement instanceof HTMLElement?document.activeElement:null;n.current?.querySelector('[role="menuitem"]')?.focus();let p=I=>{I.target instanceof Node&&n.current?.contains(I.target)||s.current()};return window.addEventListener("scroll",p,!0),window.addEventListener("resize",p),window.addEventListener("blur",p),()=>{window.removeEventListener("scroll",p,!0),window.removeEventListener("resize",p),window.removeEventListener("blur",p),c?.isConnected&&(document.activeElement===document.body||n.current?.contains(document.activeElement))&&c.focus()}},[n]);let u=c=>{let p=[...c.currentTarget.querySelectorAll('[role="menuitem"]')],I=p.indexOf(document.activeElement),C=c.key==="ArrowDown"?(I+1)%p.length:c.key==="ArrowUp"?(I-1+p.length)%p.length:c.key==="Home"?0:c.key==="End"?p.length-1:-1;c.key==="Tab"&&r(),!(C<0||!p.length)&&(c.preventDefault(),p[C].focus())};return Qt(o("div",{ref:n,className:"dd-pop dd-menu dd-context-menu",role:"menu","aria-label":a,style:{left:i.x,top:i.y},onKeyDown:u,onContextMenu:c=>c.preventDefault(),children:t}))}function ue({icon:e,label:a,hint:r,onSelect:t,danger:n=!1,checked:s=!1}){return d("button",{type:"button",role:"menuitem",className:`dd-menu-item${n?" dd-menu-danger":""}${s?" dd-menu-checked":""}`,onClick:t,children:[e?o(e,{size:14,"aria-hidden":!0}):null,o("span",{className:"dd-menu-label",children:a}),r?o("span",{className:"dd-menu-hint",children:r}):null]})}function Be({request:e,onClose:a}){let[r,t]=y(!1),n=async()=>{t(!0);try{await e.run()}finally{t(!1),a()}};return o(aa,{title:e.title,onClose:a,footer:d(V,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{n()},autoFocus:!0,children:e.confirmLabel})]}),children:o("div",{className:"dd-confirm-body",children:e.body})})}function aa({title:e,onClose:a,children:r,footer:t,wide:n=!1}){return O(()=>{let s=i=>{i.key==="Escape"&&a()};return document.addEventListener("keydown",s),()=>document.removeEventListener("keydown",s)},[a]),Qt(o("div",{className:"dd-dialog-backdrop",onMouseDown:s=>{s.target===s.currentTarget&&a()},children:d("div",{className:`dd-dialog${n?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[d("div",{className:"dd-dialog-header",children:[o("span",{className:"dd-dialog-title",children:e}),o(z,{icon:ie,label:"Close",onClick:a})]}),o("div",{className:"dd-dialog-body",children:r}),t?o("div",{className:"dd-dialog-footer",children:t}):null]})}))}var wn={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},ka="design-doc";function Pt(e,a,r){e.openPanelAgent?.({threadId:r,title:a.title})||(e.openThreadPanel({actionId:ka,title:a.title,params:{docId:a.id},threadId:r}),e.toThread(r))}function Yt(e,a,r){if(!e.openPanelAgent)return!1;let t=un({doc:a,action:r.action?ln(r.action):null,prompt:r.prompt,path:r.path});return e.openPanelAgent({draft:{prompt:t,view:a.id,...r.projectId?{projectId:r.projectId}:{}},title:a.title})}function kn({doc:e,now:a,chatThreadId:r=null,onOpenChat:t}){let n=G(),s=ye(),i=[...e.threads].sort((u,c)=>c.lastActivityAt-u.lastActivityAt),l=t?i.find(u=>u.threadId===r):void 0;return l&&t?d("div",{className:"dd-rail-pane dd-agents dd-agent-chat",children:[d("div",{className:"dd-agent-chat-head",children:[o(z,{icon:ua,label:"All agents",size:13,onClick:()=>t(null)}),o("span",{className:"dd-agent-chat-title",title:l.title,children:l.title}),o("span",{className:`dd-role dd-role-${l.role}`,children:wn[l.role]}),o(z,{icon:He,label:"Open full thread",size:13,onClick:()=>s.toThread(l.threadId)})]}),o(Bo,{threadId:l.threadId,variant:"compact",layout:"contained",className:"dd-agent-chat-body"})]}):o("div",{className:"dd-rail-pane dd-agents",children:d("div",{className:"dd-rail-scroll",children:[i.length?o("ul",{className:"dd-thread-list",children:i.map(u=>d("li",{className:"dd-thread",children:[d("button",{type:"button",className:"dd-thread-open",onClick:()=>t?t(u.threadId):s.toThread(u.threadId),title:t?"Open chat beside the doc":"Open thread",children:[o(me,{size:14,"aria-hidden":!0}),d("span",{className:"dd-thread-main",children:[o("span",{className:"dd-thread-title",children:u.title}),d("span",{className:"dd-thread-meta",children:[o("span",{className:`dd-role dd-role-${u.role}`,children:wn[u.role]}),o(pe,{at:u.lastActivityAt,now:a})]})]})]}),o(z,{icon:bt,label:"Unlink thread",size:13,onClick:()=>{n.unlinkThread(e.id,u.threadId).catch(c=>B(`Could not unlink: ${U(c)}`,"error"))}})]},u.threadId))}):d(we,{icon:me,title:"No agents yet",children:["Use ",o("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),d("div",{className:"dd-agents-hint",children:[o(Va,{size:13,"aria-hidden":!0}),d("span",{children:["Agents in this project already know this doc exists. Type ",o("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",o("code",{children:"design_doc_read"}),"."]})]})]})})}function An({doc:e,activePath:a,request:r,contextProjectId:t,compact:n=!1}){let s=G(),i=ye(),[l,u]=y(!1),[c,p]=y(""),[I,C]=y(!1),[f,m]=y(t??""),[L,A]=y(null),T=Fe(),w=R(null),F=!e.projectId,k=T.data??[],N=F?f||k[0]?.id||"":e.projectId;O(()=>{r&&(p(r.prompt),C(!0),u(!0),requestAnimationFrame(()=>{let x=w.current;x&&(x.focus(),x.selectionStart=x.selectionEnd=x.value.length)}))},[r]),O(()=>{l&&C(x=>x||!!a&&a!==e.entryPath)},[l,a,e.entryPath]);let P=async x=>{if(L)return;if(F&&!N){B("Add a project first: agents run inside a project.","error");return}let D={action:x,prompt:x?void 0:c.trim()||void 0,path:I?a:null,projectId:N||null};if(Yt(i,e,D)){u(!1),p("");return}A(x??"custom");try{let v=await s.askAgent(e.id,{...x?{action:x}:{},...c.trim()&&!x?{prompt:c.trim()}:{},path:I?a:null,...F?{projectId:N}:{}});Pt(i,e,v.threadId),B(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),u(!1),p("")}catch(v){B(`Could not start the agent: ${U(v)}`,"error")}finally{A(null)}},E=x=>{x.key==="Enter"&&(x.metaKey||x.ctrlKey)&&(x.preventDefault(),c.trim()&&P(null))};return d(ke,{open:l,onClose:()=>u(!1),className:"dd-ask",anchor:d("button",{type:"button",className:`btn primary dd-ask-trigger${n?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":l,onClick:()=>u(!l),children:[o(ne,{size:13,"aria-hidden":!0}),n?null:"Ask agent",o(le,{size:12,"aria-hidden":!0})]}),children:[d("div",{className:"dd-ask-head",children:[o("span",{className:"dd-ask-title",children:"Ask an agent"}),o("span",{className:"dd-muted",children:"Opens a briefed composer beside the doc; pick a harness and send"})]}),o("div",{className:"dd-ask-actions",role:"menu",children:Zt.map(x=>{let D=yn(x.icon);return d("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!L,onClick:()=>{P(x.id)},title:x.description,children:[o("span",{className:"dd-ask-action-icon",children:L===x.id?o(K,{size:13}):o(D,{size:14,"aria-hidden":!0})}),d("span",{className:"dd-ask-action-text",children:[o("span",{className:"dd-ask-action-label",children:x.label}),o("span",{className:"dd-ask-action-desc",children:x.description})]})]},x.id)})}),d("div",{className:"dd-ask-custom",children:[o("textarea",{ref:w,className:"dd-input",rows:3,maxLength:Nt,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:c,onChange:x=>p(x.target.value),onKeyDown:E}),d("div",{className:"dd-ask-options",children:[a?d("label",{className:"dd-check",children:[o("input",{type:"checkbox",checked:I,onChange:x=>C(x.target.checked)}),"Focus on ",o("code",{children:a})]}):null,F?d("label",{className:"dd-field-inline",children:["Run in",d("select",{className:"dd-input dd-select",value:N,onChange:x=>m(x.target.value),children:[k.length?null:o("option",{value:"",children:"No projects"}),k.map(x=>o("option",{value:x.id,children:x.name},x.id))]})]}):null,o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary",disabled:!c.trim()||!!L,onClick:()=>{P(null)},children:[L==="custom"?o(K,{size:12}):null,"Start"]})]})]})]})}var rd=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),nd=/[A-Za-z][^\t\n\f\r />]*/y,sd=/[\t\n\f\r /]*/y,Dn=/[\t\n\f\r ]*/y,dd=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,ld=/[^\t\n\f\r >]*/y,id={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function ud(e){return e.includes("&")?e.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(a,r,t,n)=>{if(n)return id[n.toLowerCase()]??a;let s=r?Number(r):parseInt(t,16);return s>0&&s<=1114111?String.fromCodePoint(s):a}):e}function Tn(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function Aa(e,a,r){return e.lastIndex=r,e.exec(a)?.[0]??""}function cd(e,a){let r=Aa(nd,e,a+1),t=a+1+r.length,n=[];for(;t<e.length;){let s=Aa(sd,e,t);if(t+=s.length,t>=e.length)return null;if(e[t]===">")return{name:r.toLowerCase(),attributes:n,selfClosing:s.endsWith("/"),start:a,end:t+1};let i=Aa(dd,e,t)||e[t];t+=i.length,t+=Aa(Dn,e,t).length;let l=null;if(e[t]==="="){t+=1,t+=Aa(Dn,e,t).length;let u=e[t];if(u==='"'||u==="'"){let c=e.indexOf(u,t+1);if(c<0)return null;l=e.slice(t+1,c),t=c+1}else l=Aa(ld,e,t),t+=l.length}n.push({name:i.toLowerCase(),value:l===null?null:ud(l)})}return null}function*fd(e){let a=0;for(;a<e.length;){let r=e.indexOf("<",a);if(r<0)return;let t=e[r+1]??"";if(e.startsWith("<!--",r)){let s=e.indexOf("-->",r+4);a=s<0?e.length:s+3;continue}if(t==="!"||t==="?"||t==="/"&&/[A-Za-z]/.test(e[r+2]??"")){let s=e.indexOf(">",r+2);a=s<0?e.length:s+1;continue}if(!/[A-Za-z]/.test(t)){a=r+1;continue}let n=cd(e,r);if(!n)return;if(a=n.end,rd.has(n.name)){let s=new RegExp(`</${n.name}(?=[\\t\\n\\f\\r />])`,"ig");s.lastIndex=n.end;let i=s.exec(e),l=i?i.index:e.length,u=i?e.indexOf(">",l):-1,c=u<0?e.length:u+1;yield{...n,content:{start:n.end,end:l,closeEnd:c}},a=c;continue}yield n}}function _t(e,a){let r=-1;for(let n of fd(e)){if(n.name==="head")return e.slice(0,n.end)+a+e.slice(n.end);if(n.name==="html"){r=n.end;continue}break}if(r>=0)return e.slice(0,r)+a+e.slice(r);let t=e.match(/^\s*<!doctype[^>]*>/i);return t?t[0]+a+e.slice(t[0].length):a+e}function vt(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var pd={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},md={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"};var Mn={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function La(e){let a=vt(e),r=pd[a];return r||(Mn[a]?"code":"text")}function Rn(e){return Mn[vt(e)]??""}function ze(e){return e==="image"||e==="font"}function Fn(e){return md[vt(e)]??null}var gd=/^[a-z][a-z0-9+.-]*:/i;function wt(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||gd.test(r))return null;let t=r.split(/[?#]/,1)[0],n=t;try{n=decodeURIComponent(t)}catch{}let s=n.startsWith("/")?[]:e.split("/").slice(0,-1);for(let i of n.split("/"))if(!(!i||i===".")){if(i===".."){if(!s.length)return null;s.pop();continue}s.push(i)}return s.length?s.join("/"):null}function Bn(e,a){let r=e.split("/"),t=a.split("/"),n=Math.min(r.length,t.length);for(let s=0;s<n;s+=1){let i=s===r.length-1,l=s===t.length-1;if(r[s]!==t[s])return i!==l?i?-1:1:r[s].localeCompare(t[s],void 0,{sensitivity:"base",numeric:!0})}return r.length-t.length}function eo(e){let a=(e??"").split("/").filter(Boolean),[r,...t]=a;return{docId:r??null,path:t.length?t.join("/"):null}}function Da(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}function hd(e){let a=new TextEncoder().encode(e),r="";for(let t=0;t<a.length;t+=32768)r+=String.fromCharCode(...a.subarray(t,t+32768));return btoa(r)}function ao(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${hd(e.content)}`;let a=Fn(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var Nn=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;function En(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function On(e,a){let r=new Set;for(let t of a.matchAll(Nn)){let n=wt(e,En(t[2]));n&&r.add(n)}return[...r]}function qn(e,a,r){return r.size?a.replace(Nn,(t,n,s,i="")=>{let l=wt(e,En(s)),u=l?r.get(l):void 0;return u?`${n}${u}${i})`:t}):a}function to(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(n=>n[0].length)),t="`".repeat(Math.max(3,r+1));return`${t}${a}
${e.replace(/\n$/,"")}
${t}`}function Hn(e,a){return to(a,Rn(e))}var xd=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function _n(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let n of xd){let s=r.getPropertyValue(n).trim();s&&(a[n]=s)}let t=r.getPropertyValue("color-scheme").trim();return t&&(a["color-scheme"]=t),a}var Ld=/^[^<>{};]*$/;function Un(e,a){let t=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>Ld.test(n)).map(([n,s])=>`${n}: ${s};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;return _t(e,t)}function zn(e){let a=[],r=new Map;for(let t of[...e].sort((n,s)=>Bn(n.path,s.path))){let n=t.path.split("/"),s=a;for(let i=0;i<n.length-1;i+=1){let l=n.slice(0,i+1).join("/"),u=r.get(l);u||(u={kind:"folder",name:n[i],path:l,children:[]},r.set(l,u),s.push(u)),s=u.children}s.push({kind:"file",name:n.at(-1),path:t.path,file:t})}return a}var jn=/^(?:(?:https|ssh):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/|[\w.-]+@([\w.-]+):)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;function Id(e){return e.length>0&&e.length<=100&&/^[\w./-]+$/.test(e)&&!e.startsWith("-")&&!e.startsWith("/")&&!e.endsWith("/")&&!e.endsWith(".")&&!e.endsWith(".lock")&&!e.includes("..")&&!e.includes("//")}var Ta=class extends Error{};function Gn(e){let a=typeof e.repo=="string"?e.repo.trim():"";if(a.length>300)throw new Ta("repository URL must be at most 300 characters");if(a&&!jn.test(a))throw new Ta("repository must be a clone URL such as https://github.com/owner/repo or git@github.com:owner/repo.git");let r=typeof e.branch=="string"?e.branch.trim():"";if(!Id(r))throw new Ta("branch must be a valid git branch name, e.g. main or gh-pages");let t=e.folder??"root";if(t!=="root"&&t!=="docs")throw new Ta("folder must be root or docs");return{repo:a||null,branch:r,folder:t}}function $n(e){let a=e.trim().match(jn);if(!a)return null;let r=(a[1]??a[2]).toLowerCase(),[t,n]=[a[3],a[4]];return r==="github.com"?n.toLowerCase()===`${t.toLowerCase()}.github.io`?`https://${n}/`:`https://${t}.github.io/${n}/`:`https://${r}/pages/${t}/${n}/`}var oo={repo:"",branch:"main",folder:"root"},Wn=e=>`zcc.design-docs.publish.${e}`;function Vn(e){try{let a=JSON.parse(localStorage.getItem(Wn(e))??"null");return a?{repo:typeof a.repo=="string"?a.repo:"",branch:typeof a.branch=="string"&&a.branch?a.branch:oo.branch,folder:a.folder==="docs"?"docs":"root"}:oo}catch{return oo}}function yd(e,a){try{localStorage.setItem(Wn(e),JSON.stringify(a))}catch{}}function Sd(e,a){try{return Gn({...e,repo:a?"":e.repo}),null}catch(r){return U(r)}}function Pd({doc:e,onClose:a}){let r=G(),t=ye(),n=Fe(),[s,i]=y(()=>Vn(e.id)),[l,u]=y(()=>!Vn(e.id).repo),[c,p]=y(""),[I,C]=y(!1),f=!e.projectId,m=n.data??[],L=f?c||m[0]?.id||"":e.projectId,A=e.files.some(P=>P.kind==="html"),T=A?!l&&!s.repo.trim()?null:Sd(s,l):"This doc has no HTML pages to publish. Add an index.html first.",w=A&&!T&&(l||!!s.repo.trim())&&(!f||!!L),F=!l&&!T&&s.repo.trim()?$n(s.repo):null,k=P=>i(E=>({...E,...P})),N=async()=>{if(!(!w||I)){C(!0);try{let P=await r.publish(e.id,{...l?{}:{repo:s.repo.trim()},branch:s.branch.trim(),folder:s.folder,...f?{projectId:L}:{}});yd(e.id,{...s,repo:l?"":s.repo.trim(),branch:s.branch.trim()}),Pt(t,e,P.threadId),B(`Publishing \u201C${e.title}\u201D. The agent reports the live URL when the push lands.`),a()}catch(P){B(`Could not start publishing: ${U(P)}`,"error")}finally{C(!1)}}};return d(aa,{title:"Publish site",onClose:a,footer:d(V,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),d("button",{type:"button",className:"btn primary",disabled:!w||I,onClick:()=>{N()},children:[I?o(K,{size:12}):o(qe,{size:13,"aria-hidden":!0}),"Publish"]})]}),children:[o("p",{className:"dd-muted dd-publish-intro",children:"An agent exports this doc as a static site, commits it and pushes it with your git credentials. GitHub Pages then serves it."}),d("div",{className:"dd-publish-fields",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Repository"}),d("select",{className:"dd-input dd-select",value:l?"own":"other",onChange:P=>u(P.target.value==="own"),children:[o("option",{value:"own",children:"This project's repository"}),o("option",{value:"other",children:"Another repository\u2026"})]})]}),l?null:d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Clone URL"}),o("input",{className:"dd-input",value:s.repo,maxLength:300,placeholder:"https://github.com/owner/repo",spellCheck:!1,autoFocus:!0,onChange:P=>k({repo:P.target.value})})]}),d("div",{className:"dd-field-row",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Branch"}),o("input",{className:"dd-input",value:s.branch,maxLength:100,spellCheck:!1,onChange:P=>k({branch:P.target.value})})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Folder"}),d("select",{className:"dd-input dd-select",value:s.folder,onChange:P=>k({folder:P.target.value}),children:[o("option",{value:"root",children:"/ (root)"}),o("option",{value:"docs",children:"/docs"})]})]})]}),f?d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Run the agent in"}),d("select",{className:"dd-input dd-select",value:L,onChange:P=>p(P.target.value),children:[m.length?null:o("option",{value:"",children:"No projects"}),m.map(P=>o("option",{value:P.id,children:P.name},P.id))]})]}):null]}),T?o("p",{className:"dd-publish-problem",role:"alert",children:T}):d("p",{className:"dd-muted dd-field-help",children:[F?d(V,{children:["Expected at ",o("code",{children:F}),"."," "]}):null,"Turn on Pages in the repository settings once: deploy from ",o("code",{children:s.branch.trim()||"main"}),","," ",o("code",{children:s.folder==="docs"?"/docs":"/ (root)"}),". Other files in the repository are left in place."]})]})}function Xn({doc:e,compact:a=!1}){let[r,t]=y(!1);return d(V,{children:[d("button",{type:"button",className:"btn dd-publish-trigger",title:"Publish as a GitHub Pages site","aria-label":a?"Publish":void 0,onClick:()=>t(!0),children:[o(qe,{size:13,"aria-hidden":!0}),a?null:"Publish"]}),r?o(Pd,{doc:e,onClose:()=>t(!1)}):null]})}var Zn=e=>e.key==="Enter"&&(e.metaKey||e.ctrlKey);function vd({onSend:e,onCancel:a}){let[r,t]=y(""),[n,s]=y(!1),i=async()=>{let l=r.trim();if(!l||n)return;s(!0);let u=await e(l);s(!1),u&&t("")};return d("div",{className:"dd-reply-composer",children:[o("textarea",{className:"dd-input dd-composer-input",placeholder:"Reply\u2026 agents see the whole thread","aria-label":"Reply",value:r,maxLength:8e3,rows:2,autoFocus:!0,onChange:l=>t(l.target.value),onKeyDown:l=>{Zn(l)?(l.preventDefault(),i()):l.key==="Escape"&&(l.preventDefault(),a())}}),d("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send \xB7 Esc to cancel"}),d("span",{className:"dd-reply-buttons",children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:!r.trim()||n,onClick:()=>{i()},children:"Reply"})]})]})]})}function wd({comment:e,fileGone:a,now:r,onToggle:t,onDelete:n,onDeleteReply:s,onReply:i,onFocus:l}){let u=e.status==="resolved",[c,p]=y(!1);return d("article",{className:`dd-comment${u?" dd-comment-resolved":""}`,children:[d("header",{className:"dd-comment-head",children:[o(be,{actor:e.author}),o(pe,{at:e.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(z,{icon:gt,label:"Reply",onClick:()=>p(!0),size:13}),o(z,{icon:u?Ue:Oe,label:u?"Reopen":"Resolve",onClick:t,size:13}),o(z,{icon:xe,label:"Delete comment",onClick:n,danger:!0,size:13})]}),e.path||e.quote?d("button",{type:"button",className:"dd-comment-anchor",onClick:l,disabled:!l,title:a?"This file was deleted":"Show in the document",children:[e.path?d("span",{className:`dd-comment-path${a?" dd-comment-path-gone":""}`,children:[e.path,a?" (deleted)":""]}):null,e.quote?o("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,o("div",{className:"dd-comment-body",children:o(za,{content:e.body})}),e.replies.length?o("ol",{className:"dd-replies","aria-label":"Replies",children:e.replies.map(I=>d("li",{className:"dd-reply",children:[d("header",{className:"dd-comment-head",children:[o(be,{actor:I.author}),o(pe,{at:I.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(z,{icon:xe,label:"Delete reply",onClick:()=>s(I.id),danger:!0,size:12})]}),o("div",{className:"dd-comment-body",children:o(za,{content:I.body})})]},I.id))}):null,c?o(vd,{onCancel:()=>p(!1),onSend:async I=>{let C=await i(I);return C&&p(!1),C}}):null]})}function Jn({doc:e,activePath:a,now:r,pendingQuote:t,onClearQuote:n,draft:s,onDraft:i,onFocusComment:l}){let u=G(),[c,p]=re("comments-scope","all"),[I,C]=y(!1),[f,m]=y(!1),[L,A]=y(null),T=R(null);O(()=>{t&&T.current?.focus()},[t]);let w=X(()=>e.comments.filter(b=>c==="all"||!b.path||b.path===a),[e.comments,c,a]),F=w.filter(b=>b.status==="open"),k=w.filter(b=>b.status==="resolved"),N=async(b,q)=>{try{return await b(),!0}catch(j){return B(`${q}: ${U(j)}`,"error"),!1}},P=t?t.path:a,E=async()=>{let b=s.trim();if(!(!b||f)){m(!0);try{await u.addComment(e.id,{body:b,...P?{path:P}:{},...t?{quote:t.text}:{}}),i(""),n()}catch(q){B(`Could not add the comment: ${U(q)}`,"error")}finally{m(!1)}}},x=b=>{Zn(b)&&(b.preventDefault(),E())},D=X(()=>new Set(e.files.map(b=>b.path)),[e.files]),v=b=>{let q=!!b.path&&!D.has(b.path);return o(wd,{comment:b,fileGone:q,now:r,onToggle:()=>{N(()=>u.setCommentStatus(e.id,b.id,b.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>A({title:"Delete comment",body:b.replies.length?`Delete this comment and its ${b.replies.length===1?"reply":`${b.replies.length} replies`}? This cannot be undone.`:"Delete this comment? This cannot be undone.",confirmLabel:"Delete",danger:!0,run:()=>{N(()=>u.deleteComment(e.id,b.id),"Could not delete the comment")}}),onDeleteReply:j=>{N(()=>u.deleteComment(e.id,j),"Could not delete the reply")},onReply:j=>N(()=>u.replyToComment(e.id,b.id,j),"Could not reply"),onFocus:!q&&(b.quote||b.path)?()=>l(b):void 0},b.id)};return d("div",{className:"dd-rail-pane dd-comments",children:[o("div",{className:"dd-rail-toolbar",children:d("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[o("button",{type:"button",className:c==="all"?"on":"",onClick:()=>p("all"),children:"All files"}),o("button",{type:"button",className:c==="file"?"on":"",onClick:()=>p("file"),disabled:!a,children:"This file"})]})}),d("div",{className:"dd-rail-scroll",children:[F.length===0?o(we,{icon:Ie,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):F.map(v),k.length?d("div",{className:"dd-resolved",children:[d("button",{type:"button",className:"dd-disclosure",onClick:()=>C(!I),children:[I?o(le,{size:13,"aria-hidden":!0}):o(ca,{size:13,"aria-hidden":!0}),"Resolved (",k.length,")"]}),I?k.map(v):null]}):null]}),d("div",{className:"dd-composer",children:[t?d("div",{className:"dd-composer-quote",children:[o("span",{className:"dd-comment-quote",children:t.text}),o(z,{icon:ie,label:"Remove quote",onClick:n,size:12})]}):null,o("textarea",{ref:T,className:"dd-input dd-composer-input",placeholder:P?`Comment on ${P}\u2026 agents see open comments`:"Leave a comment\u2026",value:s,maxLength:8e3,rows:3,onChange:b=>i(b.target.value),onKeyDown:x}),d("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),o("button",{type:"button",className:"btn primary",disabled:!s.trim()||f,onClick:()=>{E()},children:"Comment"})]})]}),L?o(Be,{request:L,onClose:()=>A(null)}):null]})}function kd(e){let a=document.createElement("textarea");a.value=e,a.setAttribute("readonly",""),a.style.position="fixed",a.style.top="-9999px";let r=document.activeElement instanceof HTMLElement?document.activeElement:null;document.body.appendChild(a);try{return a.select(),document.execCommand("copy")}catch{return!1}finally{a.remove(),r?.focus()}}async function Qn(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return kd(e)}var Ad=(()=>{let e=new Uint32Array(256);for(let a=0;a<256;a+=1){let r=a;for(let t=0;t<8;t+=1)r=r&1?3988292384^r>>>1:r>>>1;e[a]=r>>>0}return e})();function Dd(e){let a=4294967295;for(let r of e)a=Ad[(a^r)&255]^a>>>8;return(a^4294967295)>>>0}function Td(e){let a=Math.max(e.getFullYear(),1980);return{time:e.getHours()<<11|e.getMinutes()<<5|Math.floor(e.getSeconds()/2),date:a-1980<<9|e.getMonth()+1<<5|e.getDate()}}var Yn=2048,ro=20;function es(e,a=new Date){let r=new TextEncoder,{time:t,date:n}=Td(a),s=[],i=[],l=0;for(let f of e){let m=r.encode(f.path),L=Dd(f.data),A=f.data.length,T=new Uint8Array(30+m.length),w=new DataView(T.buffer);w.setUint32(0,67324752,!0),w.setUint16(4,ro,!0),w.setUint16(6,Yn,!0),w.setUint16(8,0,!0),w.setUint16(10,t,!0),w.setUint16(12,n,!0),w.setUint32(14,L,!0),w.setUint32(18,A,!0),w.setUint32(22,A,!0),w.setUint16(26,m.length,!0),w.setUint16(28,0,!0),T.set(m,30),s.push(T,f.data);let F=new Uint8Array(46+m.length),k=new DataView(F.buffer);k.setUint32(0,33639248,!0),k.setUint16(4,ro,!0),k.setUint16(6,ro,!0),k.setUint16(8,Yn,!0),k.setUint16(10,0,!0),k.setUint16(12,t,!0),k.setUint16(14,n,!0),k.setUint32(16,L,!0),k.setUint32(20,A,!0),k.setUint32(24,A,!0),k.setUint16(28,m.length,!0),k.setUint32(42,l,!0),F.set(m,46),i.push(F),l+=T.length+A}let u=i.reduce((f,m)=>f+m.length,0),c=new Uint8Array(22),p=new DataView(c.buffer);p.setUint32(0,101010256,!0),p.setUint16(8,e.length,!0),p.setUint16(10,e.length,!0),p.setUint32(12,u,!0),p.setUint32(16,l,!0);let I=new Uint8Array(l+u+c.length),C=0;for(let f of[...s,...i,c])I.set(f,C),C+=f.length;return I}function Md(e){if(e.encoding==="utf8")return new TextEncoder().encode(e.content);let a=atob(e.content),r=new Uint8Array(a.length);for(let t=0;t<a.length;t+=1)r[t]=a.charCodeAt(t);return r}function as(e,a,r){return es(a.map(t=>({path:`${e}/${t.path}`,data:Md(t)})),r)}var Rd=3e4;function ts(e,a,r){let t=URL.createObjectURL(new Blob([a],{type:r})),n=document.createElement("a");n.href=t,n.download=e,n.style.display="none",document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(t),Rd)}function Fd({doc:e,projects:a,onClose:r,onMove:t}){let[n,s]=y(e.projectId??"");return d(aa,{title:"Move design doc",onClose:r,footer:d(V,{children:[o("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.projectId??""),onClick:()=>{t(n||null).then(r)},children:"Move"})]}),children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),d("select",{className:"dd-input dd-select",value:n,onChange:i=>s(i.target.value),children:[o("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(i=>o("option",{value:i.id,children:i.name},i.id))]})]}),o("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}function Bd({doc:e,onClose:a,onPick:r}){let t=Pa({...e.projectId?{projectId:e.projectId}:{},status:"active"}),[n,s]=y(e.alternativeTo??""),i=t.data??[],l=i.filter(c=>c.id!==e.id&&!c.alternativeTo),u=i.filter(c=>c.alternativeTo===e.id).length;return d(aa,{title:"Alternative to\u2026",onClose:a,footer:d(V,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.alternativeTo??"")||u>0,onClick:()=>{r(n||null).then(a)},children:"Save"})]}),children:[t.data?d("label",{className:"dd-field",children:[d("span",{className:"dd-field-label",children:["\u201C",e.title,"\u201D is an alternative to"]}),d("select",{className:"dd-input dd-select",value:n,disabled:u>0,onChange:c=>s(c.target.value),children:[o("option",{value:"",children:"Nothing: a doc of its own"}),l.map(c=>o("option",{value:c.id,children:c.title},c.id))]})]}):o(K,{label:"Loading design docs"}),o("p",{className:"dd-muted dd-field-help",children:u>0?`This doc has ${u} alternative${u===1?"":"s"} of its own. Detach them first: alternatives nest one level deep.`:"Alternatives are listed under the doc they compete with, so competing proposals stay together."})]})}async function os(e,a){await Qn(e)?B(`Copied ${a}`):B(`Could not copy ${a}`,"error")}function Ut(e){let a=G(),[r,t]=y(null),[n,s]=y(null),[i,l]=y(null),u=async(f,m)=>{try{await a.update(f.id,m)}catch(L){B(`Could not update the doc: ${U(L)}`,"error")}},c=async(f,m)=>{try{await a.pin(f.id,m)}catch(L){B(`Could not ${m?"pin":"unpin"} the doc: ${U(L)}`,"error")}},p=async f=>{try{let m=await a.siteFiles(f.id);ts(`${m.slug}.zip`,as(m.slug,m.files),"application/zip")}catch(m){B(`Could not download the doc: ${U(m)}`,"error")}};return{items:(f,m,L,A)=>{let T=f.status==="archived",w=F=>()=>{m(),F()};return d(V,{children:[A?o(ue,{icon:_e,label:"Open",onSelect:w(A)}):null,f.pinnedAt!==null?o(ue,{icon:mt,label:"Unpin",onSelect:w(()=>{c(f,!1)})}):o(ue,{icon:ga,label:"Pin to top",onSelect:w(()=>{c(f,!0)})}),o(ue,{icon:Za,label:"Copy chat reference",hint:"Paste into any thread",onSelect:w(()=>{os(gn(f.id),"reference")})}),o(ue,{icon:fa,label:"Copy id",hint:f.slug,onSelect:w(()=>{os(f.id,"id")})}),o(ue,{icon:Qa,label:"Download .zip",hint:`${f.slug}.zip`,onSelect:w(()=>{p(f)})}),o(ue,{icon:rt,label:"Move to project\u2026",onSelect:w(()=>t(f))}),o(ue,{icon:st,label:"Alternative to\u2026",hint:f.alternativeTo?"Linked":void 0,onSelect:w(()=>s(f))}),o(ue,{icon:T?Ga:$a,label:T?"Unarchive":"Archive",onSelect:w(()=>{u(f,{status:T?"draft":"archived"})})}),o(ue,{icon:xe,label:"Delete\u2026",danger:!0,onSelect:w(()=>l({title:"Delete design doc",body:d(V,{children:["Delete ",o("strong",{children:f.title})," with its ",f.fileCount," file",f.fileCount===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await a.remove(f.id),B(`Deleted \u201C${f.title}\u201D`),L()}catch(F){B(`Could not delete: ${U(F)}`,"error")}}}))})]})},dialogs:d(V,{children:[r?o(Fd,{doc:r,projects:e,onClose:()=>t(null),onMove:f=>u(r,{projectId:f})}):null,n?o(Bd,{doc:n,onClose:()=>s(null),onPick:f=>u(n,{alternativeTo:f})}):null,i?o(Be,{request:i,onClose:()=>l(null)}):null]})}}function ns({value:e,placeholder:a,maxLength:r,multiline:t=!1,className:n="",label:s,onSave:i}){let[l,u]=y(!1),[c,p]=y(e),I=R(!1);O(()=>{l||p(e)},[e,l]);let C=async m=>{if(I.current)return;I.current=!0,u(!1);let L=c.trim();if(m&&L!==e.trim())try{await i(L)}catch{p(e)}else p(e)},f=m=>{m.key==="Escape"?(m.preventDefault(),C(!1)):m.key==="Enter"&&(!t||m.metaKey||m.ctrlKey||!m.shiftKey)&&(m.preventDefault(),C(!0))};if(l){let m={className:`dd-editable-input ${n}`,value:c,maxLength:r,"aria-label":s,autoFocus:!0,onChange:L=>p(L.target.value),onKeyDown:f,onBlur:()=>{C(!0)}};return t?o("textarea",{...m,rows:2,placeholder:a}):o("input",{...m,placeholder:a})}return o("button",{type:"button",className:`dd-editable ${n}${e?"":" dd-editable-empty"}`,title:`Edit ${s.toLowerCase()}`,onClick:()=>{I.current=!1,u(!0)},children:e||a})}function Ed({tags:e,onChange:a}){let[r,t]=y(!1),[n,s]=y(""),i=()=>{let l=n.split(",").map(c=>c.trim().toLowerCase().slice(0,32)).filter(Boolean);s(""),t(!1);let u=[...new Set([...e,...l])].slice(0,12);u.length!==e.length&&a(u)};return d("span",{className:"dd-tags",children:[e.map(l=>d("span",{className:"dd-tag",children:[o(fa,{size:10,"aria-hidden":!0}),l,o("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${l}`,onClick:()=>a(e.filter(u=>u!==l)),children:o(ie,{size:10,"aria-hidden":!0})})]},l)),r?o("input",{className:"dd-input dd-tag-input",value:n,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:l=>s(l.target.value),onBlur:i,onKeyDown:l=>{l.key==="Enter"?(l.preventDefault(),i()):l.key==="Escape"&&(s(""),t(!1))}}):e.length<12?d("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>t(!0),children:[o(Ce,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function Od({status:e,onChange:a}){let[r,t]=y(!1);return o(ke,{open:r,onClose:()=>t(!1),align:"start",className:"dd-menu",anchor:o("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>t(!r),title:"Change status",children:o(ea,{status:e})}),children:Et.map(n=>o(ue,{label:o(ea,{status:n}),checked:n===e,icon:n===e?Oe:void 0,onSelect:()=>{t(!1),n!==e&&a(n)}},n))})}function ss({doc:e,projects:a,compact:r,collapsible:t=!1,actions:n,onDeleted:s}){let i=G(),[l,u]=y(!1),[c,p]=y(!1),I=Ut(a),C=e.projectId?a.find(L=>L.id===e.projectId):null,f=async L=>{try{await i.update(e.id,L)}catch(A){throw B(`Could not update the doc: ${U(A)}`,"error"),A}},m=r||t&&!c;return d("header",{className:`dd-doc-header${r||t?" dd-doc-header-compact":""}`,children:[d("div",{className:"dd-doc-title-row",children:[o(ns,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:L=>L?f({title:L}):void 0}),o("span",{className:"dd-spacer"}),n,o(ke,{open:l,onClose:()=>u(!1),className:"dd-menu",anchor:o(z,{icon:De,label:"More actions",active:l,onClick:()=>u(!l)}),children:I.items(e,()=>u(!1),s)})]}),m?null:o(ns,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:L=>f({summary:L})}),d("div",{className:"dd-doc-meta",children:[o(Od,{status:e.status,onChange:L=>{f({status:L}).catch(()=>{})}}),d("span",{className:"dd-doc-project",title:C?`Project \xB7 ${C.name}`:"Visible to agents in every project",children:[C?null:o(dt,{size:12,"aria-hidden":!0}),C?C.name:e.projectId?"Unknown project":"Global"]}),m?null:o(Ed,{tags:e.tags,onChange:L=>{f({tags:L}).catch(()=>{})}}),o("span",{className:"dd-spacer"}),d("span",{className:"dd-doc-updated",children:[o(be,{actor:e.updatedBy})," ",o(pe,{at:e.updatedAt,now:Date.now()})]}),t?o(z,{icon:c?Xa:le,label:c?"Hide summary and tags":"Show summary and tags",active:c,onClick:()=>p(!c)}):null]}),I.dialogs]})}function ds({docId:e,file:a,removed:r=!1,split:t,renderPreview:n,onStateChange:s,onSaved:i}){let l=G(),[u,c]=y(a.content),[p,I]=y({content:a.content,revision:a.revision}),[C,f]=y(!1),[m,L]=y(null),A=u!==p.content,T=Oo(u),w=R({dirty:A,draft:u,saved:p});w.current={dirty:A,draft:u,saved:p},O(()=>{let{dirty:P,draft:E,saved:x}=w.current;a.revision!==x.revision&&(!P||a.content===E?(c(a.content),I({content:a.content,revision:a.revision}),L(null)):L({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),O(()=>{s?.({dirty:A,saving:C})},[A,C,s]);let F=Ae(async P=>{if(!C){f(!0);try{let E=P??(r?0:p.revision),x=await l.writeFile(e,{path:a.path,content:u,baseRevision:E});I({content:u,revision:x.revision}),L(null),i?.(x)}catch(E){if(cn(E)){let x=await l.readFile(e,a.path).catch(()=>null);L({revision:x?.revision??p.revision+1,by:x?.updatedBy??a.updatedBy})}else B(`Could not save ${a.path}: ${U(E)}`,"error")}finally{f(!1)}}},[l,e,u,a.path,a.updatedBy,i,r,p.revision,C]),k=async()=>{try{let P=await l.readFile(e,a.path);c(P.content),I({content:P.content,revision:P.revision}),L(null)}catch(P){B(`Could not reload ${a.path}: ${U(P)}`,"error")}},N=P=>{if((P.metaKey||P.ctrlKey)&&P.key.toLowerCase()==="s"){P.preventDefault(),A&&!m&&F();return}if(P.key==="Tab"&&!P.metaKey&&!P.ctrlKey&&!P.altKey){P.preventDefault();let E=P.currentTarget,{selectionStart:x,selectionEnd:D,value:v}=E,b=`${v.slice(0,x)}  ${v.slice(D)}`;c(b),requestAnimationFrame(()=>{E.selectionStart=E.selectionEnd=x+2})}};return d("div",{className:"dd-editor",children:[r&&A&&!m?d("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(Se,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[a.path," was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them."]})]}):null,m?d("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(ve,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[o(be,{actor:m.by})," saved revision ",m.revision," while you were editing."]}),d("button",{type:"button",className:"btn",onClick:()=>{k()},children:[o(Ue,{size:12,"aria-hidden":!0})," Discard mine"]}),o("button",{type:"button",className:"btn",onClick:()=>{F(m.revision)},children:"Overwrite with mine"})]}):null,d("div",{className:`dd-editor-body${t?" dd-editor-split":""}`,children:[o("textarea",{className:"dd-editor-input",value:u,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:P=>c(P.target.value),onKeyDown:N,autoFocus:!0}),t?o("div",{className:"dd-editor-preview",children:n(T)}):null]}),d("div",{className:"dd-editor-footer",children:[d("span",{className:"dd-editor-state",children:[C?o(K,{size:12,label:"Saving"}):null,C?"Saving\u2026":A?"Unsaved changes":`Saved \xB7 rev ${p.revision}`]}),o("span",{className:"dd-editor-hint",children:"\u2318S to save"}),o("button",{type:"button",className:"btn",disabled:!A||C,onClick:()=>c(p.content),children:"Revert"}),d("button",{type:"button",className:"btn primary",disabled:!A||C||!!m,onClick:()=>{F()},children:[o(ht,{size:12,"aria-hidden":!0})," Save"]})]})]})}var zt="dd-comment",jt="dd-comment-focus";function qd(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}var Hd=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE"]);function _d(e){let a=e.ownerDocument.createTreeWalker(e,4,{acceptNode:u=>Hd.has(u.parentElement?.tagName.toUpperCase()??"")?2:1}),r=[],t=[],n="";for(let u=a.nextNode();u;u=a.nextNode())t.push(n.length),r.push(u),n+=u.data;let s="",i=[],l=!0;for(let u=0;u<n.length;u+=1){let c=n[u];/\s/.test(c)?(l||(s+=" ",i.push(u)),l=!0):(s+=c,i.push(u),l=!1)}return{nodes:r,starts:t,normalized:s,map:i}}function ls(e,a){let r=0,t=e.starts.length-1;for(;r<t;){let n=r+t+1>>1;e.starts[n]<=a?r=n:t=n-1}return[e.nodes[r],a-e.starts[r]]}function lo(e,a){let r=new Map;if(!a.length)return r;let t=_d(e);if(!t.nodes.length)return r;for(let n of a){if(r.has(n))continue;let s="",i=-1;for(let C of new Set([n.replace(/\s+/g," ").trim(),qd(n)]))if(!(C.length<2)&&(i=t.normalized.indexOf(C),i>=0)){s=C;break}if(i<0)continue;let[l,u]=ls(t,t.map[i]),[c,p]=ls(t,t.map[i+s.length-1]),I=e.ownerDocument.createRange();I.setStart(l,u),I.setEnd(c,p+1),r.set(n,I)}return r}function Ud(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var is=new Map;function Ia(e,a,r){let t=Ud();if(!t)return;let n=is.get(e)??new Map;is.set(e,n),r.length?n.set(a,r):n.delete(a);let s=[...n.values()].flat();s.length?t.registry.set(e,new t.Highlight(...s)):t.registry.delete(e)}var cs="dd-page";var zd="dd-page-hello",fs=50,jd=256*1024,uo=1e3,io=4e3,Gd=500,$d=500,Vd=new Set(["error","missing","blocked"]);function At(e){return e&&typeof e=="object"&&!Array.isArray(e)?e:null}function Ma(e,a){return typeof e=="string"&&e.length<=a?e:null}function co(e,a){return typeof e=="string"?e.slice(0,a):null}function Gt(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function us(e){return!Array.isArray(e)||e.length>$d?null:e.every(a=>typeof a=="string"&&a.length<=500)?e:null}function Wd(e){if(e===null)return null;let a=At(e);if(!a)return;let[r,t,n,s]=[a.top,a.left,a.bottom,a.right].map(Gt);return r===null||t===null||n===null||s===null?void 0:{top:r,left:t,bottom:n,right:s}}function Xd(e){let a=At(e);if(!a)return null;let r=0;for(let[t,n]of Object.entries(a))if(typeof n!="string"||(r+=t.length+n.length,r>jd))return null;return{...a}}function Kd(e){let a=At(e),r=a?.kind,t=co(a?.message,Gd);if(!a||!Vd.has(r)||!t)return null;let n=co(a.source,uo),s=Gt(a.line);return{kind:r,message:t,...n?{source:n}:{},...s!==null&&s>0?{line:Math.floor(s)}:{}}}function ps(e){let a=At(e);if(!a)return null;switch(a.type){case"ready":return{type:"ready"};case"fetch":{let r=Ma(a.path,uo);return Number.isSafeInteger(a.id)&&a.id>=0&&r!==null?{type:"fetch",id:a.id,path:r}:null}case"navigate":{let r=Ma(a.path,uo),t=a.hash===null?null:Ma(a.hash,io);return r===null||t===null&&a.hash!==null||typeof a.newTab!="boolean"?null:{type:"navigate",path:r,hash:t,newTab:a.newTab,redirect:a.redirect===!0}}case"open":{let r=Ma(a.url,io);return r===null?null:{type:"open",url:r}}case"problem":{let r=Kd(a.problem);return r?{type:"problem",problem:r}:null}case"selection":{let r=co(a.text,500),t=Wd(a.rect);return r===null||t===void 0?null:{type:"selection",text:r,rect:t}}case"anchors":{let r=us(a.found),t=us(a.missing);return r&&t?{type:"anchors",found:r,missing:t}:null}case"focused":{let r=Ma(a.quote,500);return r===null||typeof a.found!="boolean"?null:{type:"focused",quote:r,found:a.found}}case"scroll":{let r=Gt(a.x),t=Gt(a.y);return r===null||t===null?null:{type:"scroll",x:r,y:t}}case"hash":{let r=a.hash===null?null:Ma(a.hash,io);return r===null&&a.hash!==null?null:{type:"hash",hash:r}}case"storage":{let r=Xd(a.entries);return r?{type:"storage",entries:r}:null}default:return null}}function ms(e){return At(e)?.dd===zd}var Ag=12*1024*1024,fo=960*1024;function gs(e,a,r){let t=new Map(a.map(n=>[n.path,n.revision]));return!r&&e.revision!==(t.get(e.path)??null)||e.deps.some(n=>(t.get(n.path)??0)!==n.revision)?!0:e.missing.some(n=>t.has(n))}function po(e,a){let r=[...e],t=new Set(e.map(n=>n.path));for(let[n,s]of a){if(r.length>=500)break;t.has(n)||r.push({path:n,revision:s})}return r}function hs(e){return JSON.stringify(e).replace(/</g,"\\u003c")}var Zd=new URL("./page-runtime.js",import.meta.url).href,xs=[{id:"full",label:"Full width",icon:ct,width:null},{id:"tablet",label:"Tablet (768px)",icon:Ct,width:768},{id:"phone",label:"Phone (390px)",icon:Lt,width:390}],Jd=400,Qd=1500,Yd=6,el=200,al=20,tl=50,ol={error:"Error",missing:"Missing",blocked:"Blocked"},Ra=new Map;function rl(e,a){for(Ra.delete(e),Ra.set(e,a);Ra.size>al;)Ra.delete(Ra.keys().next().value)}var Ca=new Map,mo=(e,a)=>`${e}\0${a}`;function nl(e,a,r){let t=mo(e,a);for(Ca.delete(t),Ca.set(t,r);Ca.size>tl;)Ca.delete(Ca.keys().next().value)}function sl(e,a,r,t){let n=`<script type="application/json" id="${cs}">${hs(a)}<\/script><script src="${Tn(r)}"><\/script>`,s=_t(e.html,n);return e.styled?s:Un(s,t)}function dl(e,a){let r=0,t=[],n=()=>{for(;r<e&&t.length;){let s=t.shift();r+=1,Promise.resolve().then(s).catch(()=>{}).finally(()=>{r-=1,n()})}};return{add(s){return r+t.length>=a?!1:(t.push(s),n(),!0)},clear(){t.length=0}}}function ll(e){return e.length*6<fo?!1:new TextEncoder().encode(JSON.stringify(e)).byteLength>fo}function il(e,a){return e.kind===a.kind&&e.message===a.message&&e.source===a.source&&e.line===a.line}function Ls({docId:e,file:a,files:r,draft:t=!1,quotes:n=[],onOpenPath:s,onQuote:i,onAskAbout:l,handleRef:u}){let c=G(),p=a.path,[I,C]=y("full"),[f,m]=y(null),[L,A]=y(!0),[T,w]=y(null),[F,k]=y(!1),[N,P]=y([]),[E,x]=y(!1),[D,v]=y(null),[b,q]=y(null),[j,oe]=y(0),ce=R(null),fe=R(null),Z=R(null),W=R(!1),te=R(null),ge=R([]),se=R(new Map),de=R(null),Le=R(""),he=R({hash:Ca.get(mo(e,p))??null,scroll:null}),S=R(n);S.current=n;let H=X(()=>dl(Yd,el),[]);O(()=>{Ca.delete(mo(e,p))},[e,p]);let _=t?a.content:null,[J,ra]=y(_);O(()=>{if(_===J)return;if(_===null){ra(null);return}let g=setTimeout(()=>ra(_),Jd);return()=>clearTimeout(g)},[_,J]);let Rt=r.find(g=>g.path===p)?.revision??null,je=J===null?Rt:null,Ge=R(0);O(()=>{let g=++Ge.current;if(J!==null&&ll(J)){k(!0),A(!1);return}k(!1),A(!0),c.renderPage(e,{path:p,draft:J??void 0}).then(M=>{if(g!==Ge.current)return;let Q={mode:"frame",docId:e,path:p,hash:he.current.hash,scroll:he.current.scroll,quotes:[...S.current],storage:Ra.get(e)};m({id:g,page:M,srcDoc:sl(M,Q,Zd,M.styled?{}:_n()),draft:J!==null}),w(null),A(!1)},M=>{g===Ge.current&&(w(U(M)),A(!1))})},[c,e,p,J,je,j]);let ee=R("");O(()=>{if(!f||L)return;let g={...f.page,deps:po(f.page.deps,se.current)};if(!gs(g,r,J!==null))return;let M=r.map(Q=>`${Q.path}@${Q.revision}`).join("|");ee.current!==M&&(ee.current=M,oe(Q=>Q+1))},[f,r,L,J]);let Ne=(g,M=Z.current)=>{try{M?.postMessage(g)}catch{}},Na=g=>{P(M=>M.length>=fs||M.some(Q=>il(Q,g))?M:[...M,g]),na()},Wt=R(N);Wt.current=N;let ae=R(f);ae.current=f;let na=()=>{de.current&&clearTimeout(de.current),de.current=setTimeout(()=>{de.current=null;let g=ae.current,M=g?.page;if(!M||g.draft||M.revision===null||!W.current)return;let Q={path:M.path,revision:M.revision,deps:po(M.deps,se.current),missing:M.missing,problems:Wt.current,unanchored:ge.current},Y=JSON.stringify(Q);Y!==Le.current&&(Le.current=Y,c.reportRender(e,Q).catch(()=>{Le.current=""}))},Qd)},sa=(g,M)=>{g!==p&&(M!==null&&nl(e,g,M),s?.(g))},Xt=(g,M,Q)=>{let Y=new Set(r.map(ia=>ia.path)),Ee=Y.has(g)?g:Y.has(`${g}/index.html`)?`${g}/index.html`:null;if(!Ee){B(`${g} is not a file in this design doc`,"error");return}Q?v(Ee===p?null:{path:Ee,hash:M}):sa(Ee,M)},Ea=g=>{let M;try{M=new URL(g)}catch{return}if(M.protocol!=="https:"&&M.protocol!=="http:"){B(`Zana opens web links only, not ${M.protocol} links`,"error");return}let Q=globalThis.navigator?.userActivation;if(Q&&!Q.isActive){Na({kind:"blocked",message:`The page tried to open ${M.href} without a click`});return}globalThis.open(M.href,"_blank","noopener,noreferrer")},da=(g,M)=>{let Q=ce.current,Y=fe.current;if(!i||!g||!M||!Q||!Y){q(null);return}let Ee=Q.getBoundingClientRect(),ia=Y.getBoundingClientRect(),Xs=Ee.top-ia.top+Y.scrollTop+M.top-36,Ks=Ee.left-ia.left+Y.scrollLeft+(M.left+M.right)/2;q({text:g,top:Math.max(4,Xs),left:Math.min(Math.max(80,Ks),Math.max(80,Y.scrollWidth-80))})},ba=(g,M)=>{switch(g.type){case"ready":W.current=!0,Ne({type:"highlight",quotes:[...S.current]},M),te.current!==null&&Ne({type:"focus",quote:te.current},M),te.current=null,na();break;case"fetch":{!se.current.has(g.path)&&se.current.size<500&&(se.current.set(g.path,r.find(Y=>Y.path===g.path)?.revision??0),na()),H.add(async()=>{let Y=null;try{Y=await c.readPageFile(e,g.path)}catch{Y=null}Z.current===M&&Ne({type:"file",id:g.id,file:Y},M)})||Ne({type:"file",id:g.id,file:null},M);break}case"navigate":Xt(g.path,g.hash,g.redirect);break;case"open":Ea(g.url);break;case"problem":Na(g.problem);break;case"selection":da(g.text,g.rect);break;case"anchors":ge.current=g.missing,na();break;case"focused":g.found||B("That passage is no longer on this page");break;case"scroll":he.current.scroll={x:g.x,y:g.y};break;case"hash":he.current.hash=g.hash;break;case"storage":rl(e,g.entries);break;default:break}},Oa=R(ba);Oa.current=ba,O(()=>{let g=M=>{let Q=ce.current,Y=M.ports?.[0];!Q||!Y||M.source!==Q.contentWindow||!ms(M.data)||(Z.current?.close(),Z.current=Y,W.current=!1,ge.current=[],se.current=new Map,H.clear(),P([]),v(null),q(null),Y.onmessage=Ee=>{if(Z.current!==Y)return;let ia=ps(Ee.data);ia&&Oa.current(ia,Y)})};return globalThis.addEventListener("message",g),()=>{globalThis.removeEventListener("message",g),Z.current?.close(),Z.current=null,H.clear(),de.current&&clearTimeout(de.current)}},[H]);let qa=n.join("\0");O(()=>{W.current&&Ne({type:"highlight",quotes:qa?qa.split("\0"):[]})},[qa]),O(()=>{if(!u)return;let g={focusQuote(M){return W.current&&Z.current?Ne({type:"focus",quote:M}):te.current=M,!0}};return u.current=g,()=>{u.current===g&&(u.current=null)}},[u]);let la=[...X(()=>f?[...f.page.missing.map(g=>({kind:"missing",message:`The page uses ${g}, which is not a file in this doc`})),...f.page.warnings.map(g=>({kind:"blocked",message:g}))]:[],[f]),...N],Ft=async()=>{try{let{url:g}=await c.pageLink(e,p);globalThis.open(g,"_blank","noopener,noreferrer")}catch(g){B(U(g),"error")}},Ha=g=>{!b||!g||(g(b.text),q(null),Ne({type:"clear-selection"}))},_a=xs.find(g=>g.id===I).width;return d("div",{className:"dd-html-stage",onMouseDown:g=>{g.target.closest?.(".dd-selection-chip")||q(null)},children:[d("div",{className:"dd-html-toolbar",children:[d("div",{className:"dd-html-status",children:[L?o(K,{size:12,label:"Rendering page"}):null,t?o("span",{className:"dd-muted",children:"Unsaved changes"}):null]}),o("div",{className:"dd-html-widths",role:"toolbar","aria-label":"Preview width",children:xs.map(g=>o("button",{type:"button",className:`icon-btn${I===g.id?" on":""}`,title:g.label,"aria-label":g.label,"aria-pressed":I===g.id,onClick:()=>C(g.id),children:o(g.icon,{size:14,"aria-hidden":!0})},g.id))}),d("div",{className:"dd-html-actions",children:[la.length?o(ke,{open:E,onClose:()=>x(!1),className:"dd-page-problems",anchor:d("button",{type:"button",className:"dd-page-badge","aria-label":`${la.length} page ${la.length===1?"problem":"problems"}`,"aria-expanded":E,onClick:()=>x(g=>!g),children:[o(ve,{size:13,"aria-hidden":!0}),la.length]}),children:o("ul",{"aria-label":"Page problems",children:la.map((g,M)=>d("li",{className:`dd-page-problem dd-page-problem-${g.kind}`,children:[o("span",{className:"dd-page-problem-kind",children:ol[g.kind]}),o("span",{className:"dd-page-problem-message",children:g.message}),g.source?d("span",{className:"dd-muted dd-page-problem-source",children:[g.source,g.line?`:${g.line}`:""]}):null]},M))})}):null,t?null:o(z,{icon:He,label:"Open in browser",onClick:()=>{Ft()}})]})]}),D?d("div",{className:"dd-banner dd-banner-info",children:[o(Ja,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:["This page redirects to ",o("code",{children:D.path}),"."]}),o("button",{type:"button",className:"btn",onClick:()=>{v(null),sa(D.path,D.hash)},children:"Go there"}),o(z,{icon:ie,label:"Dismiss",onClick:()=>v(null)})]}):null,F?d("div",{className:"dd-banner dd-banner-warn",children:[o(ve,{size:14,"aria-hidden":!0}),o("span",{className:"dd-banner-text",children:"This draft is too large to preview. Save it to see the page."})]}):null,T?o("div",{className:"dd-banner dd-banner-error",children:T}):null,d("div",{className:"dd-html-viewport",ref:fe,children:[f?o("iframe",{ref:ce,className:`dd-html-frame${_a?" dd-html-frame-device":""}`,style:_a?{width:_a}:void 0,sandbox:"allow-scripts allow-forms",srcDoc:f.srcDoc,title:p},f.id):T||F?null:o("div",{className:"dd-center",children:o(K,{label:"Rendering page"})}),b?d("div",{className:"dd-selection-chip",style:{top:b.top,left:b.left},children:[d("button",{type:"button",onClick:()=>Ha(i),children:[o(pa,{size:13,"aria-hidden":!0}),"Comment"]}),l?d("button",{type:"button",onClick:()=>Ha(l),children:[o(ne,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})]})}var ul=24,cl=64,Fa=new Map;function fl(e,a){for(Fa.delete(e),Fa.set(e,a);Fa.size>cl;)Fa.delete(Fa.keys().next().value)}function pl(e,a,r){let t=G(),n=X(()=>{let c=new Map(a.map(p=>[p.path,p]));return r.map(p=>c.get(p)).filter(p=>!!p&&(p.kind==="image"||p.kind==="svg")).slice(0,ul)},[a,r]),s=n.map(c=>`${c.path}@${c.revision}`).join("|"),i=R(n);i.current=n;let[l,u]=y(new Map);return O(()=>{let c=i.current,p=!1,I=new Map,C=[];for(let f of c){let m=Fa.get(`${e}\0${f.path}\0${f.revision}`);m?I.set(f.path,m):C.push(f)}if(u(I),!!C.length)return Promise.all(C.map(async f=>{try{let m=await t.readFile(e,f.path),L=ao(m);L&&(fl(`${e}\0${m.path}\0${m.revision}`,L),I.set(m.path,L))}catch{}})).then(()=>{p||u(new Map(I))}),()=>{p=!0}},[t,e,s]),l}function Tt({docId:e,file:a,files:r,quotes:t=[],onOpenPath:n,onQuote:s,onAskAbout:i,handleRef:l,draft:u=!1}){let c=R(null),p=R(null),I=R({}),[C,f]=y(null),m=X(()=>a.kind==="markdown"?On(a.path,a.content):[],[a.path,a.content,a.kind]),L=pl(e,r,m),A=X(()=>new Set(r.map(x=>x.path)),[r]),T=X(()=>a.kind==="markdown"?qn(a.path,a.content,L):a.kind==="mermaid"?to(a.content,"mermaid"):a.kind==="code"?Hn(a.path,a.content):null,[a.kind,a.path,a.content,L]),w=t.join("\0");O(()=>{let x=p.current,D=I.current,v=w?w.split("\0"):[];if(!x||!v.length){Ia(zt,D,[]);return}let b=()=>Ia(zt,D,[...lo(x,v).values()]),q=setTimeout(b,60),j=typeof MutationObserver=="function"?new MutationObserver(()=>b()):null;return j?.observe(x,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(q),j?.disconnect(),Ia(zt,D,[]),Ia(jt,D,[])}},[w,T,a.kind,a.content]);let F=a.kind!=="html";O(()=>{if(!(!l||!F))return l.current={focusQuote(x){let D=p.current,v=D?lo(D,[x]).get(x):void 0;return v?(v.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),Ia(jt,I.current,[v]),setTimeout(()=>Ia(jt,I.current,[]),1800),!0):!1}},()=>{l.current=null}},[l,F]);let k=x=>{let D=x.target?.closest?.("a");if(!D)return;let v=D.getAttribute("href")??"";if(v.startsWith("#")){x.preventDefault(),x.stopPropagation();return}let b=wt(a.path,v);if(!b)return;x.preventDefault(),x.stopPropagation();let q=[...A].find(j=>j.startsWith(`${b}/`));A.has(b)?n?.(b):q?n?.(q):B(`${b} is not a file in this design doc`,"error")},N=()=>{if(!s)return;let x=globalThis.getSelection?.(),D=c.current,v=x?.toString().trim()??"";if(!x||x.isCollapsed||!v||!D||!p.current?.contains(x.anchorNode)){f(null);return}let b=x.getRangeAt(0).getBoundingClientRect(),q=D.getBoundingClientRect();f({text:v.slice(0,500),top:Math.max(4,b.top-q.top+D.scrollTop-36),left:Math.min(Math.max(80,b.left-q.left+b.width/2),Math.max(80,q.width-80))})},P=x=>{!C||!x||(x(C.text),f(null),globalThis.getSelection?.()?.removeAllRanges())},E;if(a.kind==="html")E=o(Ls,{docId:e,file:a,files:r,draft:u,quotes:t,onOpenPath:n,onQuote:s,onAskAbout:i,handleRef:l},`${e}\0${a.path}`);else if(a.kind==="image"||a.kind==="svg"){let x=ao(a);E=o("div",{className:"dd-image-stage",children:x?o("img",{src:x,alt:a.path}):o("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else a.kind==="font"?E=o("div",{className:"dd-image-stage",children:o("span",{className:"dd-muted",children:"Font file. Pages in this doc load it through @font-face."})}):T!==null?E=o("div",{className:`dd-prose dd-prose-${a.kind}`,ref:p,onClickCapture:k,children:a.kind==="markdown"&&!a.content.trim()?o("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):o(za,{content:T})}):E=o("div",{className:"dd-prose",ref:p,children:o("pre",{className:"dd-plain",children:a.content})});return d("div",{className:`dd-preview dd-preview-${a.kind}`,ref:c,onMouseUp:N,onMouseDown:x=>{x.target.closest?.(".dd-selection-chip")||f(null)},children:[E,C?d("div",{className:"dd-selection-chip",style:{top:C.top,left:C.left},children:[d("button",{type:"button",onClick:()=>P(s),children:[o(pa,{size:13,"aria-hidden":!0}),"Comment"]}),i?d("button",{type:"button",onClick:()=>P(i),children:[o(ne,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function Is(e,a,r=1500){let t=e.split(`
`),n=a.split(`
`),s=0;for(;s<t.length&&s<n.length&&t[s]===n[s];)s+=1;let i=t.length,l=n.length;for(;i>s&&l>s&&t[i-1]===n[l-1];)i-=1,l-=1;let u=t.slice(s,i),c=n.slice(s,l);if(u.length>r||c.length>r)return null;let p=c.length+1,I=new Uint32Array((u.length+1)*p);for(let L=u.length-1;L>=0;L-=1)for(let A=c.length-1;A>=0;A-=1)I[L*p+A]=u[L]===c[A]?I[(L+1)*p+A+1]+1:Math.max(I[(L+1)*p+A],I[L*p+A+1]);let C=[],f=0,m=0;for(;f<u.length&&m<c.length;)u[f]===c[m]?(C.push({type:"same",text:u[f]}),f+=1,m+=1):I[(f+1)*p+m]>=I[f*p+m+1]?(C.push({type:"del",text:u[f]}),f+=1):(C.push({type:"add",text:c[m]}),m+=1);for(;f<u.length;)C.push({type:"del",text:u[f++]});for(;m<c.length;)C.push({type:"add",text:c[m++]});return[...t.slice(0,s).map(L=>({type:"same",text:L})),...C,...t.slice(i).map(L=>({type:"same",text:L}))]}function Cs(e,a=3){let r=new Uint8Array(e.length);e.forEach((s,i)=>{if(s.type!=="same")for(let l=Math.max(0,i-a);l<=Math.min(e.length-1,i+a);l+=1)r[l]=1});let t=[],n=0;for(;n<e.length;)if(r[n]){let s=[];for(;n<e.length&&r[n];)s.push(e[n++]);t.push({type:"lines",lines:s})}else{let s=0;for(;n<e.length&&!r[n];)s+=1,n+=1;t.push({type:"gap",count:s})}return t}function bs(e){let a=0,r=0;for(let t of e)t.type==="add"?a+=1:t.type==="del"&&(r+=1);return{added:a,removed:r}}var ml={create:Te,write:Xe,delete:Ke,rename:ft},ys={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function Ss({doc:e,activePath:a,now:r,selectedId:t,onSelect:n}){let s=G(),[i,l]=re("history-scope","file"),u=i==="file"?a:null,c=Ye(`${e.id}\0${u??"*"}\0${e.revision}`,()=>s.history(e.id,{...u?{path:u}:{},limit:100}));return d("div",{className:"dd-rail-pane dd-history",children:[o("div",{className:"dd-rail-toolbar",children:d("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[o("button",{type:"button",className:i==="file"?"on":"",onClick:()=>l("file"),disabled:!a,children:"This file"}),o("button",{type:"button",className:i==="all"?"on":"",onClick:()=>l("all"),children:"All files"})]})}),d("div",{className:"dd-rail-scroll",children:[c.error?o("div",{className:"dd-banner dd-banner-error",children:c.error}):null,!c.data&&c.loading?o("div",{className:"dd-center",children:o(K,{label:"Loading history"})}):null,c.data&&!c.data.length?o(we,{icon:Pe,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,o("ol",{className:"dd-history-list",children:c.data?.map(p=>{let I=ml[p.op];return o("li",{children:d("button",{type:"button",className:`dd-history-row${t===p.id?" on":""}`,onClick:()=>n(p),children:[o(I,{size:13,className:`dd-op dd-op-${p.op}`,"aria-hidden":!0}),d("span",{className:"dd-history-main",children:[d("span",{className:"dd-history-title",children:[ys[p.op],u?null:o("span",{className:"dd-history-path",children:p.path}),d("span",{className:"dd-history-rev",children:["rev ",p.revision]})]}),p.note?o("span",{className:"dd-history-note",children:p.note}):null,d("span",{className:"dd-history-meta",children:[o(be,{actor:p.actor}),o(pe,{at:p.createdAt,now:r})]})]})]})},p.id)})})]})]})}async function gl(e,a,r){let t=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||t.encoding==="base64")return{after:t,before:null,pruned:!1};if(r.op==="delete")return{after:t,before:t.content,pruned:!1};let n=(await e.history(a,{path:r.path,limit:100})).find(i=>i.id<r.id);if(!n)return{after:t,before:null,pruned:!0};if(n.op==="delete")return{after:t,before:"",pruned:!1};let s=await e.revision(a,n.id);return{after:t,before:s.content,pruned:!1}}function Ps({doc:e,revision:a,onClose:r,onOpenPath:t}){let n=G(),[s,i]=y(a.op==="write"||a.op==="delete"?"changes":"full"),[l,u]=y(!1),[c,p]=y(null),I=Ye(`${e.id}\0${a.id}`,()=>gl(n,e.id,a)),C=La(a.path),f=e.files.find(k=>k.path===a.path)??null,m=f?.revision===a.revision&&a.op!=="delete",L=X(()=>{let k=I.data;if(!k||k.before===null||ze(C))return null;let N=Is(k.before,a.op==="delete"?"":k.after.content);return N?{hunks:Cs(N),stats:bs(N)}:"too-large"},[I.data,a.op,C]),A=async()=>{u(!0);try{let k=await n.restore(e.id,a.id,f?.revision??0);B(`Restored ${k.path} to revision ${a.revision} (now rev ${k.revision})`),t(k.path),r()}catch(k){B(`Could not restore: ${U(k)}`,"error")}finally{u(!1)}},T=()=>{if(f){A();return}p({title:`Recreate ${a.path}?`,body:d(V,{children:[o("code",{children:a.path})," is no longer in this doc",a.op==="delete"?"":"; it may have been renamed",". Recreate it with the content of revision ",a.revision,"?"]}),confirmLabel:"Recreate",run:()=>{A()}})},w=L!==null,F=s==="full"||!w;return d("div",{className:"dd-revision",children:[d("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[o(Pe,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[o("strong",{children:ys[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",o(be,{actor:a.actor})," ",o(pe,{at:a.createdAt,now:Date.now()}),a.renamedFrom?d(V,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?d("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),w?d("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[o("button",{type:"button",className:s==="changes"?"on":"",onClick:()=>i("changes"),children:"Changes"}),o("button",{type:"button",className:s==="full"?"on":"",onClick:()=>i("full"),children:"Full file"})]}):null,d("button",{type:"button",className:"btn",disabled:m||l||!I.data,onClick:T,children:[o(Ue,{size:12,"aria-hidden":!0})," ",m?"Current":f?"Restore":"Recreate file"]}),o(z,{icon:ie,label:"Close revision",onClick:r})]}),d("div",{className:"dd-revision-body",children:[I.error?o("div",{className:"dd-banner dd-banner-error",children:I.error}):null,I.data?F?d(V,{children:[I.data.pruned?o("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,L==="too-large"?o("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,o(Tt,{docId:e.id,file:{path:a.path,kind:C,content:I.data.after.content,encoding:I.data.after.encoding},files:e.files,onOpenPath:t,draft:!0})]}):L&&L!=="too-large"?d("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[d("div",{className:"dd-diff-stats",children:[d("span",{className:"dd-diff-added",children:["+",L.stats.added]}),d("span",{className:"dd-diff-removed",children:["\u2212",L.stats.removed]}),o("span",{className:"dd-muted",children:xa(a.size)})]}),L.hunks.map((k,N)=>k.type==="gap"?d("div",{className:"dd-diff-gap",children:["\u22EF ",k.count," unchanged line",k.count===1?"":"s"]},N):k.lines.map((P,E)=>d("div",{className:`dd-diff-line dd-diff-${P.type}`,role:"row",children:[o("span",{className:"dd-diff-sign","aria-hidden":!0,children:P.type==="add"?"+":P.type==="del"?"\u2212":" "}),o("span",{className:"dd-diff-text",children:P.text||" "})]},`${N}-${E}`))),L.stats.added+L.stats.removed===0?o("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:I.loading?o("div",{className:"dd-center",children:o(K,{label:"Loading revision"})}):null]}),c?o(Be,{request:c,onClose:()=>p(null)}):null]})}var hl=[{id:"preview",label:"Preview",icon:Ya},{id:"edit",label:"Edit",icon:ma},{id:"split",label:"Split",icon:Ve}];function xl(e,a,r){let t=Ln(e,a,r),n=R(null);t.data&&(n.current=t.data);let s=n.current&&n.current.path===a?n.current:null;return{file:t.data??s,error:t.error,loading:t.loading}}function Ll(e,a,r){let[t,n]=y(null),s=R({path:e,revision:a});return O(()=>{let i=s.current;if(s.current={path:e,revision:a},i.path!==e||a===null||i.revision===null||a<=i.revision||r?.kind!=="agent")return;n(r.label);let l=setTimeout(()=>n(null),4e3);return()=>clearTimeout(l)},[e,a,r]),t}function vs({doc:e,path:a,mode:r,onModeChange:t,railOpen:n,onToggleRail:s,revision:i,onCloseRevision:l,previewHandle:u,onOpenPath:c,onQuote:p,onAskAbout:I,onEditorState:C,leading:f}){let m=e.files.find(x=>x.path===a)??null,{file:L,error:A,loading:T}=xl(e.id,a,m?.revision??null),w=Ll(a,m?.revision??null,m?.updatedBy),F=!m||!ze(m.kind),k=F?r:"preview",N=X(()=>e.comments.filter(x=>x.status==="open"&&x.path===a&&x.quote).map(x=>x.quote),[e.comments,a]),P=a.lastIndexOf("/");O(()=>{k==="preview"&&C({dirty:!1,saving:!1})},[k,C]);let E;return i?E=o(Ps,{doc:e,revision:i,onClose:l,onOpenPath:c},i.id):!m&&!(L&&k!=="preview")?E=d("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}):L?k==="preview"?E=o(Tt,{docId:e.id,file:L,files:e.files,quotes:N,onOpenPath:c,onQuote:p,onAskAbout:I,handleRef:u}):E=o(ds,{docId:e.id,file:L,removed:!m,split:k==="split",onStateChange:C,renderPreview:x=>o(Tt,{docId:e.id,file:{...L,content:x},files:e.files,onOpenPath:c,draft:x!==L.content})},`${e.id}\0${a}`):E=o("div",{className:"dd-center",children:A?o("div",{className:"dd-banner dd-banner-error",children:A}):T?o(K,{label:"Loading file"}):null}),d("section",{className:"dd-file-pane","aria-label":a,children:[d("div",{className:"dd-file-toolbar",children:[f,m?o(wa,{kind:m.kind}):null,d("span",{className:"dd-file-path",title:a,children:[P>0?o("span",{className:"dd-file-dir",children:a.slice(0,P+1)}):null,o("span",{className:"dd-file-name",children:a.slice(P+1)})]}),m?d("span",{className:"dd-file-meta",children:["rev ",m.revision," \xB7 ",xa(m.size)," \xB7 ",o(be,{actor:m.updatedBy})," ",o(pe,{at:m.updatedAt,now:Date.now()})]}):null,w?d("span",{className:"dd-flash",role:"status",children:[o(me,{size:12,"aria-hidden":!0})," Updated by ",w]}):null,o("span",{className:"dd-spacer"}),i?null:o("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:hl.map(x=>d("button",{type:"button",className:k===x.id?"on":"",disabled:!F&&x.id!=="preview",onClick:()=>t(x.id),title:x.label,"aria-pressed":k===x.id,children:[o(x.icon,{size:13,"aria-hidden":!0}),o("span",{className:"dd-mode-label",children:x.label})]},x.id))}),o(z,{icon:pt,label:n?"Hide comments & history":"Show comments & history",active:n,onClick:s})]}),o("div",{className:"dd-file-body",children:E})]})}function bl(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,t=>t.toUpperCase());switch(La(e)){case"markdown":return`# ${r}

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
`;default:return""}}function yl(e){let a=e.trim().replace(/^\/+/,"");return vt(a)?a:`${a}.md`}function Sl(e){return new Promise((a,r)=>{let t=new FileReader,n=ze(La(e.name));t.onerror=()=>r(t.error??new Error("could not read the file")),t.onload=()=>{let s=String(t.result??"");a(n?{content:s.slice(s.indexOf(",")+1),encoding:"base64"}:{content:s})},n?t.readAsDataURL(e):t.readAsText(e)})}function ws({initial:e,placeholder:a,onSubmit:r,onCancel:t}){let[n,s]=y(e),i=R(!1),l=c=>{c?.preventDefault(),!i.current&&(i.current=!0,n.trim()&&n.trim()!==e?r(n.trim()):t())};return o("form",{className:"dd-tree-input",onSubmit:l,children:o("input",{className:"dd-input",value:n,placeholder:a,"aria-label":a,onChange:c=>s(c.target.value),onKeyDown:c=>{c.key==="Escape"&&(c.preventDefault(),i.current=!0,t())},onBlur:()=>l(),autoFocus:!0,onFocus:c=>{let p=c.target.value.lastIndexOf("."),I=c.target.value.lastIndexOf("/")+1;c.target.setSelectionRange(I,p>I?p:c.target.value.length)}})})}function Pl({doc:e,file:a,name:r,depth:t,active:n,renaming:s,onOpen:i,onRename:l,onRenameDone:u,onDelete:c}){let p=G(),[I,C]=y(!1),f=e.entryPath===a.path,m=e.comments.filter(L=>L.status==="open"&&L.path===a.path).length;return s?o("div",{className:"dd-tree-row",style:{paddingLeft:8+t*14},children:o(ws,{initial:a.path,placeholder:"New path",onSubmit:L=>u(L),onCancel:()=>u(null)})}):d("div",{className:`dd-tree-row dd-tree-file${n?" on":""}`,style:{paddingLeft:8+t*14},children:[d("button",{type:"button",className:"dd-tree-open",onClick:i,onDoubleClick:l,title:`${a.path} \xB7 ${xa(a.size)} \xB7 rev ${a.revision}`,"aria-current":n?"page":void 0,children:[o(wa,{kind:a.kind}),o("span",{className:"dd-tree-name",children:r}),f?o(Ze,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,m?o("span",{className:"dd-tree-badge",title:`${m} open comment${m===1?"":"s"}`,children:m}):null]}),d(ke,{open:I,onClose:()=>C(!1),className:"dd-menu",anchor:o(z,{icon:De,label:`Actions for ${a.path}`,size:13,active:I,onClick:()=>C(!I)}),children:[o(ue,{icon:ma,label:"Rename or move",onSelect:()=>{C(!1),l()}}),f||ze(a.kind)?null:o(ue,{icon:It,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{C(!1),p.update(e.id,{entryPath:a.path}).catch(L=>B(U(L),"error"))}}),o(ue,{icon:xe,label:"Delete",danger:!0,onSelect:()=>{C(!1),c()}})]})]})}function go({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n,onHide:s}){let i=G(),[l,u]=y(new Set),[c,p]=y(!1),[I,C]=y(null),[f,m]=y(null),L=R(null),A=zn(e.files),T=e.files.length>=500,w=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",F=async D=>{p(!1);let v=yl(D);if(e.files.some(b=>b.path===v)){r(v);return}if(ze(La(v))){B("Use \u201CAdd files\u201D to upload images and fonts.","error");return}try{await i.writeFile(e.id,{path:v,content:bl(v)}),r(v)}catch(b){B(`Could not create ${v}: ${U(b)}`,"error")}},k=(D,v)=>{if(C(null),!v||v===D)return;let b=async()=>{try{let q=await i.renameFile(e.id,D,v);t(D,q.path)}catch(q){B(`Could not rename ${D}: ${U(q)}`,"error")}};if(!n?.(D)){b();return}m({title:"Discard unsaved changes?",body:d(V,{children:["Renaming ",o("code",{children:D})," drops your unsaved edits to it. Save them first to keep them."]}),confirmLabel:"Discard and rename",danger:!0,run:b})},N=async D=>{for(let v of Array.from(D??[])){let b=La(v.name),q=ze(b)?2097152:2097152;if(v.size>q){B(`${v.name} is larger than ${xa(q)}`,"error");continue}let j=b==="image"||b==="svg"||b==="font",oe=`${w||(j?"assets/":"")}${v.name.replace(/[^\w.-]+/g,"-")}`;try{let ce=await Sl(v);await i.writeFile(e.id,{path:oe,...ce});let fe=oe.slice(w.length);B(b==="font"||!j?`Added ${oe}`:`Added ${oe}. Reference it with ![${v.name}](${fe})`)}catch(ce){B(`Could not add ${v.name}: ${U(ce)}`,"error")}}L.current&&(L.current.value="")},P=D=>m({title:"Delete file",body:d(V,{children:["Delete ",o("code",{children:D.path}),"? Its history is kept, so it can be recreated from History.",n?.(D.path)?" Your unsaved edits to it will be lost.":null]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await i.deleteFile(e.id,D.path),t(D.path,null)}catch(v){B(`Could not delete ${D.path}: ${U(v)}`,"error")}}}),E=D=>u(v=>{let b=new Set(v);return b.has(D)?b.delete(D):b.add(D),b}),x=(D,v)=>D.map(b=>{if(b.kind==="folder"){let q=!l.has(b.path);return d("div",{role:"group","aria-label":b.name,children:[d("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+v*14},onClick:()=>E(b.path),"aria-expanded":q,children:[q?o(le,{size:12,"aria-hidden":!0}):o(ca,{size:12,"aria-hidden":!0}),q?o(_e,{size:14,"aria-hidden":!0}):o(nt,{size:14,"aria-hidden":!0}),o("span",{className:"dd-tree-name",children:b.name})]}),q?x(b.children,v+1):null]},`d:${b.path}`)}return o(Pl,{doc:e,file:b.file,name:b.name,depth:v,active:b.path===a,renaming:I===b.path,onOpen:()=>r(b.path),onRename:()=>C(b.path),onRenameDone:q=>{k(b.path,q)},onDelete:()=>P(b.file)},`f:${b.path}`)});return d("nav",{className:"dd-tree","aria-label":"Files",children:[d("div",{className:"dd-tree-head",children:[o("span",{className:"dd-section-label",children:"Files"}),o("span",{className:"dd-tree-count",children:e.files.length}),o("span",{className:"dd-spacer"}),o(z,{icon:Te,label:"Add files",size:13,disabled:T,onClick:()=>L.current?.click()}),o(z,{icon:Ce,label:"New file",size:13,disabled:T,onClick:()=>p(!0)}),s?o(z,{icon:Me,label:"Hide files",size:13,onClick:s}):null,o("input",{ref:L,type:"file",multiple:!0,hidden:!0,onChange:D=>{N(D.target.files)}})]}),d("div",{className:"dd-tree-scroll",role:"tree",children:[x(A,0),c?o("div",{className:"dd-tree-row",style:{paddingLeft:8},children:o(ws,{initial:w,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:D=>{F(D)},onCancel:()=>p(!1)})}):null]}),f?o(Be,{request:f,onClose:()=>m(null)}):null]})}var vl=560,wl=640,kl=1100,$t=[vl,wl,kl];function Al(e,a){let r=t=>!!t&&e.files.some(n=>n.path===t);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function Dl({doc:e,tab:a,onTab:r,activePath:t,now:n,pendingQuote:s,onClearQuote:i,commentDraft:l,onCommentDraft:u,onFocusComment:c,selectedRevision:p,onSelectRevision:I,chatThreadId:C,onOpenChat:f,onClose:m}){let L=[{id:"comments",label:"Comments",icon:Ie,count:e.openComments},{id:"history",label:"History",icon:Pe},{id:"agents",label:"Agents",icon:me,count:e.threads.length}],A=a==="agents"&&!!f&&e.threads.some(T=>T.threadId===C);return d("aside",{className:`dd-rail${A?" dd-rail-chat":""}`,"aria-label":"Comments, history and agents",children:[d("div",{className:"dd-rail-tabs",role:"tablist",children:[L.map(T=>d("button",{type:"button",role:"tab","aria-selected":a===T.id,className:`dd-rail-tab${a===T.id?" on":""}`,onClick:()=>r(T.id),children:[o(T.icon,{size:13,"aria-hidden":!0}),T.label,T.count?o("span",{className:"dd-count",children:T.count}):null]},T.id)),m?d(V,{children:[o("span",{className:"dd-spacer"}),o(z,{icon:ie,label:"Close",onClick:m,size:13})]}):null]}),a==="comments"?o(Jn,{doc:e,activePath:t,now:n,pendingQuote:s,onClearQuote:i,draft:l,onDraft:u,onFocusComment:c}):a==="history"?o(Ss,{doc:e,activePath:t,now:n,selectedId:p,onSelect:I}):o(kn,{doc:e,now:n,chatThreadId:C,...f?{onOpenChat:f}:{}})]})}function Tl({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let[s,i]=y(!1),l=e.files.find(u=>u.path===a);return o(ke,{open:s,onClose:()=>i(!1),align:"start",className:"dd-switcher-pop",anchor:d("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":s,onClick:()=>i(!s),title:"Files in this doc",children:[l?o(wa,{kind:l.kind}):null,d("span",{children:[e.files.length," files"]}),o(le,{size:12,"aria-hidden":!0})]}),children:o(go,{doc:e,activePath:a,onOpen:u=>{i(!1),r(u)},onPathChanged:t,hasDraft:n})})}function Vt({docId:e,path:a,onOpenPath:r,layout:t,contextProjectId:n=null,onDeleted:s,headerExtra:i}){let l=qt(e),u=Fe(),c=va(),p=t==="compact",[I,C]=In($t),f=!p&&(C??$t.length)<1,m=!p&&(C??$t.length)>=2,L=!p&&(C??$t.length)>=3,[A,T]=re("tree",!0),w=m&&A,[F,k]=re("view-mode","preview"),[N,P]=re("rail",!0),[E,x]=re("rail-compact",!1),D=L?N:E,v=L?P:x,[b,q]=re("rail-tab","comments"),[j,oe]=y(null),[ce,fe]=y(""),[Z,W]=y(null),[te,ge]=y(null),[se,de]=y(null),[Le,he]=y(null),[S,H]=y(null),_=R({dirty:!1,saving:!1}),[J,ra]=y(!1),Rt=R(null),je=R(null),Ge=R(null),ee=l.data,Ne=ee?Al(ee,a):null,Na=!!ee&&!!je.current&&!ee.files.some(g=>g.path===je.current);Na||(Ge.current=null);let ae=Na&&(J||Ge.current===je.current)?je.current:Ne;je.current=ae;let na=!!ee&&!!l.error&&fn(l.error),sa=R({onDeleted:s,title:ee?.title??""});sa.current={onDeleted:s,title:ee?.title??sa.current.title};let Xt=Ae(g=>{_.current.saving&&!g.saving&&!g.dirty&&(Ge.current=je.current),_.current=g,ra(g.dirty)},[]),Ea=Ae(()=>{_.current={dirty:!1,saving:!1},Ge.current=null,ra(!1)},[]),da=Ae(g=>{if(!_.current.dirty){g();return}he({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{Ea(),g()}})},[Ea]),ba=Ae(g=>{if(g===ae){de(null);return}da(()=>{de(null),r(g)})},[ae,da,r]);O(()=>{na&&(B(`\u201C${sa.current.title}\u201D was deleted`),sa.current.onDeleted())},[na]);let Oa=!!Z&&!!ee?.threads.some(g=>g.threadId===Z);if(O(()=>{Z&&ee&&!Oa&&W(null)},[Z,Oa,ee]),O(()=>{if(!S||S.path!==ae||se)return;let g=[80,300,900].map(M=>setTimeout(()=>{Rt.current?.focusQuote(S.quote)&&(g.forEach(clearTimeout),H(null))},M));return()=>g.forEach(clearTimeout)},[S,ae,se]),!ee)return o("div",{className:"dd-doc dd-center",children:l.error?o(we,{icon:Se,title:"This design doc could not be opened",children:l.error}):o(K,{label:"Loading design doc"})});let qa=g=>da(()=>{de(null),g.path&&g.path!==ae&&r(g.path),F!=="preview"&&k("preview"),L||v(!1),g.quote&&H({path:g.path??ae??"",quote:g.quote,nonce:Date.now()})}),wo=g=>da(()=>{de(g),g.path!==ae&&ee.files.some(M=>M.path===g.path)&&r(g.path)}),la=g=>{g==="preview"?da(()=>k(g)):k(g)},Ft=(g,M)=>{g===ae&&(Ea(),r(M,!0))},Ha=g=>g===ae&&_.current.dirty,_a=o(Dl,{doc:ee,tab:b,onTab:q,activePath:ae,now:c,pendingQuote:j,onClearQuote:()=>oe(null),commentDraft:ce,onCommentDraft:fe,onFocusComment:qa,selectedRevision:se?.id??null,onSelectRevision:wo,chatThreadId:Z,...p?{}:{onOpenChat:W},onClose:L?void 0:()=>v(!1)});return d("div",{ref:I,className:`dd-doc dd-doc-${t}${f?" dd-doc-narrow":""}${D?" dd-rail-open":""}${L?"":" dd-rail-floating"}`,children:[o(ss,{doc:ee,projects:u.data??[],compact:p,collapsible:f,onDeleted:s,actions:d(V,{children:[i,o(Xn,{doc:ee,compact:p||f}),o(An,{doc:ee,activePath:ae,request:te,contextProjectId:n,compact:p||f})]})}),d("div",{className:"dd-doc-body",children:[w?o(go,{doc:ee,activePath:ae,onOpen:ba,onPathChanged:Ft,hasDraft:Ha,onHide:()=>T(!1)}):null,ae?o(vs,{doc:ee,path:ae,mode:F,onModeChange:la,railOpen:D,onToggleRail:()=>v(!D),revision:se,onCloseRevision:()=>de(null),previewHandle:Rt,onOpenPath:ba,onQuote:g=>{oe({path:ae,text:g}),q("comments"),v(!0)},onAskAbout:g=>ge({prompt:`About this passage in ${ae}:
> ${g.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:Xt,leading:w?null:d(V,{children:[m?o(z,{icon:Re,label:"Show files",onClick:()=>T(!0)}):null,o(Tl,{doc:ee,activePath:ae,onOpen:ba,onPathChanged:Ft,hasDraft:Ha})]})}):o("div",{className:"dd-file-pane dd-center",children:o(we,{icon:Se,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),D?_a:null]}),Le?o(Be,{request:Le,onClose:()=>he(null)}):null]})}var ta=globalThis.__ZCC_HOST_REACT_DOM__;if(ta==null)throw new Error("host react-dom is not available");var ks=ta.createPortal,Gh=ta.flushSync,$h=ta.hydrate,Vh=ta.render,Wh=ta.unmountComponentAtNode,Xh=ta.findDOMNode,Kh=ta.version;var Mt=null,ho=new Set;function Ds(){ho.forEach(e=>e())}function Ml(e){Mt!==e&&(Mt=e,Ds())}function Rl(e){Mt===e&&(Mt=null,Ds())}function As(e){return Mt===e}function Fl(e){return ho.add(e),()=>ho.delete(e)}function xo(){let e=R(null);e.current||(e.current=Symbol("popover"));let a=e.current;return[Ho(Fl,()=>As(a),()=>!1),n=>{(typeof n=="function"?n(As(a)):n)?Ml(a):Rl(a)}]}var Bl=typeof window>"u"?O:Sa,oa=8,Ts=4,Nl=160,El=360,Ol=.55;function ql(e,a,r){let t=Math.max(e.width,r),n=e.left;n+t>a.width-oa&&(n=e.right-t),n<oa&&(n=oa),n+t>a.width-oa&&(n=Math.max(oa,a.width-t-oa));let s=a.height-e.bottom-oa,i=e.top-oa,l=s<Nl&&i>s,u=Math.max(120,l?i:s),c=Math.min(El,Math.floor(a.height*Ol)),p=Math.min(u,c);return l?{left:n,width:t,maxHeight:p,bottom:a.height-e.top+Ts}:{left:n,width:t,maxHeight:p,top:e.bottom+Ts}}function Hl(e,a){if(e.sticky)return!0;let r=a.trim().toLowerCase();return r?`${e.label} ${e.compactLabel??""} ${e.description??""}`.toLowerCase().includes(r):!0}function _l(e,a,r=!0){let t=[],n=[];for(let s of e){if(s.sticky){n.push(s);continue}(!r||Hl(s,a))&&t.push(s)}return{items:t,sticky:n}}function Ms({option:e,previousGroup:a,optionId:r,selected:t,active:n,onHover:s,onSelect:i}){return d("div",{children:[e.group&&e.group!==a&&o("div",{className:"launch-model-picker-group-label",children:e.group}),d("button",{type:"button",id:r,className:`launch-model-picker-option${e.description?" launch-model-picker-option--stacked":""}${e.className?` ${e.className}`:""}${t?" is-selected":""}${n?" is-active":""}${e.tone==="warning"?" is-warning":""}`,role:"option","aria-selected":t,"aria-disabled":e.disabled||void 0,disabled:e.disabled,tabIndex:-1,onMouseEnter:s,onFocus:s,onClick:i,children:[e.content||e.description?d("span",{className:"launch-model-picker-option-copy",children:[e.content??o("span",{children:e.label}),e.description?o("span",{className:"launch-model-picker-option-description",children:e.description}):null]}):o("span",{children:e.label}),t&&o(Oe,{size:14,"aria-hidden":"true"})]})]})}function Lo({id:e,ariaLabel:a,value:r,options:t,onChange:n,placeholder:s="Select\u2026",disabled:i,title:l,ariaKeyshortcuts:u,searchable:c=!0,searchPlaceholder:p="Search\u2026",emptyHint:I="No matches",className:C="",triggerClassName:f="launch-model-picker-trigger",triggerTestId:m,triggerIcon:L,minWidth:A=200,anchorToParent:T=!1}){let[w,F]=xo(),[k,N]=y(""),[P,E]=y(null),x=R(null),D=R(null),v=R(null),b=R(!1),q=qo(),[j,oe]=y(0),ce=t.find(S=>S.value===r),{items:fe,sticky:Z}=X(()=>_l(t,k,c),[t,k,c]),W=X(()=>[...fe,...Z],[Z,fe]),te=W[j],ge=S=>`${q}-${S.value}`,se=S=>{!S||S.disabled||(n(S.value),F(!1))},de=S=>{W.length!==0&&oe(H=>{for(let _=1;_<=W.length;_+=1){let J=(H+S*_+W.length)%W.length;if(!W[J].disabled)return J}return H})},Le=S=>{if(S.key==="Escape")S.preventDefault(),F(!1);else if(S.key==="ArrowDown")S.preventDefault(),de(1);else if(S.key==="ArrowUp")S.preventDefault(),de(-1);else if(S.key==="Home"){S.preventDefault();let H=W.findIndex(_=>!_.disabled);H>=0&&oe(H)}else if(S.key==="End"){S.preventDefault();let H=W.length-1-[...W].reverse().findIndex(_=>!_.disabled);H>=0&&oe(H)}else S.key==="Enter"&&(S.preventDefault(),se(te))};Bl(()=>{if(!w||!x.current)return;let S=T?x.current.parentElement?.getBoundingClientRect()??x.current.getBoundingClientRect():x.current.getBoundingClientRect();E(ql(S,{width:window.innerWidth,height:window.innerHeight},A))},[w,T,A]),O(()=>{if(!w)return;let S=_=>{let J=_.target;x.current?.contains(J)||D.current?.contains(J)||F(!1)},H=_=>{_.key==="Escape"&&F(!1)};return document.addEventListener("mousedown",S,!0),document.addEventListener("keydown",H),()=>{document.removeEventListener("mousedown",S,!0),document.removeEventListener("keydown",H)}},[w]),O(()=>{if(w){let S=W.findIndex(_=>_.value===r&&!_.disabled),H=W.findIndex(_=>!_.disabled);oe(S>=0?S:Math.max(0,H))}else N(""),b.current&&x.current?.focus();b.current=w},[w,c,r]);let he=w&&P!==null;return O(()=>{he&&(c?v.current?.focus():D.current?.focus())},[he,c]),O(()=>{j>=W.length&&oe(0)},[j,W.length]),O(()=>{if(!w||!te||te.sticky)return;let S=D.current?.querySelector(`[id="${CSS.escape(ge(te))}"]`);S instanceof HTMLElement&&S.scrollIntoView({block:"nearest"})},[j,te,w]),d(V,{children:[d("button",{ref:x,id:e,type:"button",className:`${f} ${C}${ce?.tone==="warning"?" is-warning":""}`,disabled:i,title:l,"aria-keyshortcuts":u,onClick:()=>F(S=>!S),onKeyDown:S=>{(S.key==="ArrowDown"||S.key==="ArrowUp")&&(S.preventDefault(),F(!0))},"aria-haspopup":"listbox","aria-expanded":w,"aria-controls":w?q:void 0,"aria-label":a,"data-testid":m??e,children:[L,o("span",{children:ce?.compactLabel??ce?.label??s}),o(le,{size:14,"aria-hidden":"true"})]}),w&&ks(d("div",{ref:D,className:"launch-model-picker-menu launch-model-picker-menu--split",role:"listbox",id:q,tabIndex:-1,"aria-label":a,"aria-activedescendant":te?ge(te):void 0,onKeyDown:Le,style:P?{left:P.left,width:P.width,maxHeight:P.maxHeight,...P.bottom!=null?{bottom:P.bottom,top:"auto"}:{top:P.top}}:{visibility:"hidden"},children:[c&&d("div",{className:"launch-model-picker-search",children:[o(ha,{size:13,"aria-hidden":"true"}),o("input",{ref:v,value:k,onChange:S=>N(S.target.value),placeholder:p,"aria-label":p,"aria-activedescendant":te?ge(te):void 0,onKeyDown:Le})]}),d("div",{className:"launch-model-picker-options",children:[fe.map((S,H)=>o(Ms,{option:S,previousGroup:fe[H-1]?.group,optionId:ge(S),selected:r===S.value,active:j===H,onHover:()=>oe(H),onSelect:()=>se(S)},S.value)),fe.length===0&&o("div",{className:"launch-model-picker-hint",children:I})]}),Z.length>0&&o("div",{className:"launch-model-picker-footer",children:Z.map((S,H)=>{let _=fe.length+H;return o(Ms,{option:S,previousGroup:H===0?void 0:Z[H-1]?.group,optionId:ge(S),selected:r===S.value,active:j===_,onHover:()=>oe(_),onSelect:()=>se(S)},S.value)})})]}),document.body)]})}function Fs(e,a){let r=new Set(e.map(f=>f.id)),t=new Map,n=[];for(let f of e)if(f.alternativeTo&&f.alternativeTo!==f.id&&r.has(f.alternativeTo)){let m=t.get(f.alternativeTo)??[];m.push(f),t.set(f.alternativeTo,m)}else n.push(f);let s=f=>({doc:f,alternatives:t.get(f.id)??[]}),i=[],l=(f,m,L,A,T={})=>{if(!A.length)return;let w=A.map(s);i.push({key:f,kind:m,label:L,entries:w,count:w.reduce((F,k)=>F+1+k.alternatives.length,0),...T})},u=n.filter(f=>f.pinnedAt!==null),c=n.filter(f=>f.pinnedAt===null&&f.openComments>0),p=n.filter(f=>f.pinnedAt===null&&f.openComments===0);if(l("pinned","pinned","Pinned",u),l("needs-me","needs-me","Needs me",c),!a.byProject)return l("recent","recent","Recent",p),i;let I=new Map,C=a.currentProjectId??null;C&&I.set(`project:${C}`,{projectId:C,docs:[]});for(let f of p){let m=f.projectId?`project:${f.projectId}`:"project:",L=I.get(m)??{projectId:f.projectId,docs:[]};L.docs.push(f),I.set(m,L)}for(let[f,m]of I)l(f,"project",m.projectId?a.projectName(m.projectId):"Global",m.docs,{projectId:m.projectId,current:!!C&&m.projectId===C});return i}function Io(e){try{let a=JSON.parse(e);return new Set(Array.isArray(a)?a.filter(r=>typeof r=="string"):[])}catch{return new Set}}function Bs(e,a){let r=Io(e);return r.has(a)?r.delete(a):r.add(a),JSON.stringify([...r])}var Rs=[217,262,173,24,330,142,45,195];function Co(e){if(!e)return"var(--text-dim)";let a=0;for(let r=0;r<e.length;r+=1)a=a*31+e.charCodeAt(r)|0;return`hsl(${Rs[Math.abs(a)%Rs.length]} 62% 52%)`}function Ns(e,a){try{let r=JSON.parse(e);if(r&&typeof r.since=="number"&&r.docs&&typeof r.docs=="object"){let t={};for(let[n,s]of Object.entries(r.docs))typeof s=="number"&&(t[n]=s);return{since:r.since,docs:t}}}catch{}return{since:a,docs:{}}}function Es(e,a,r){if((e.docs[a]??e.since)>=r)return null;let t=Object.entries({...e.docs,[a]:r}).sort((n,s)=>s[1]-n[1]).slice(0,500);return{since:e.since,docs:Object.fromEntries(t)}}function Os(e,a){return e.updatedBy.kind==="agent"&&e.updatedAt>(a.docs[e.id]??a.since)}var yo="__global__",Ul=Nt-600,zl=[{value:"active",label:"Active",description:"Everything except archived"},...Et.map(e=>({value:e,label:Ot[e]})),{value:"all",label:"All statuses"}];function bo(e,a,r){return{value:e,label:a,content:d("span",{className:"dd-pick-row",children:[o("span",{className:"dd-pick-label",children:a}),o("span",{className:"dd-pick-count",children:r})]})}}function jl(e,a,r){let t=new Map;for(let s of e)t.set(s.projectId,(t.get(s.projectId)??0)+1);let n=[bo("","All projects",e.length)];(t.has(null)||r===yo)&&n.push(bo(yo,"Global docs",t.get(null)??0));for(let s of a)(t.has(s.id)||r===s.id)&&n.push(bo(s.id,s.name,t.get(s.id)??0));return n}function qs(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function Gl(e,a){let[r,t]=y(e);return O(()=>{let n=setTimeout(()=>t(e),a);return()=>clearTimeout(n)},[e,a]),r}function $l(e){return e.summary?`${e.title}
${e.summary}`:e.title}function Vl({doc:e,active:a,alternative:r=!1,projectName:t,unseen:n,now:s,menuOpen:i,onSelect:l,onMenu:u}){let c=e.lastComment,p=e.openComments>(c?1:0);return d("button",{type:"button",className:`dd-doc-row${a?" on":""}${r?" dd-doc-row-alt":""}${i?" dd-doc-row-menu":""}`,title:$l(e),onClick:l,onContextMenu:I=>{I.preventDefault(),u(Pn(I))},"aria-current":a?"page":void 0,"aria-haspopup":"menu",children:[d("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:e.title}),r?o("span",{className:"dd-doc-row-badge",title:"An alternative to the doc above",children:"Alt"}):null,e.status!=="draft"?o(ea,{status:e.status,compact:!0}):null,o(pe,{at:e.updatedAt,now:s})]}),c?d("span",{className:"dd-doc-row-excerpt",children:[o(Ie,{size:11,"aria-hidden":!0}),o("span",{className:"dd-doc-row-excerpt-body",children:c.body.replace(/\s+/g," ").trim()}),o("span",{className:"dd-doc-row-excerpt-author",children:c.author.label})]}):null,t!==null||p||n?d("span",{className:"dd-doc-row-meta",children:[t!==null?d("span",{className:"dd-doc-row-project",title:t,children:[o("span",{className:"dd-swatch",style:{background:Co(e.projectId)},"aria-hidden":!0}),o("span",{className:"dd-doc-row-project-name",children:t})]}):null,p?d("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[o(Ie,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,n?d("span",{className:"dd-doc-row-unseen",title:"Edited by an agent since you last opened it",children:[o(me,{size:11,"aria-hidden":!0})," New edits"]}):null]}):null]})}var Wl={pinned:ga,"needs-me":Ie};function Xl({section:e,open:a,onToggle:r}){let t=e.kind==="pinned"||e.kind==="needs-me"?Wl[e.kind]:null;return d("button",{type:"button",className:`dd-list-section dd-list-section-${e.kind}`,"aria-expanded":a,onClick:r,children:[o(le,{size:12,"aria-hidden":!0,className:"dd-list-section-caret"}),t?o(t,{size:11,"aria-hidden":!0}):null,e.kind==="project"?o("span",{className:"dd-swatch",style:{background:Co(e.projectId??null)},"aria-hidden":!0}):null,o("span",{className:"dd-list-section-label",title:e.label,children:e.label}),e.current?o("span",{className:"dd-list-section-here",title:"The project you are in",children:"Here"}):null,o("span",{className:"dd-list-section-count",children:e.count})]})}function Kl({projectId:e,showProjects:a,projects:r,activeId:t,onSelect:n,onDeleted:s,onNew:i,onCollapse:l,headerActions:u}){let[c,p]=y(""),[I,C]=re("list-status","active"),[f,m]=re("list-project",""),[L,A]=re("list-grouped",!0),[T,w]=re("list-collapsed","[]"),[F,k]=re("list-seen",""),[N,P]=y(null),E=Ro(),x=Ut(r),D=Gl(c.trim(),200),v=va(),b=Pa({...e?{projectId:e}:{},...D?{query:D}:{},status:I}),q=X(()=>new Map(r.map(S=>[S.id,S.name])),[r]),j=X(()=>{let S=b.data??[];return!a||!f?S:S.filter(H=>f===yo?H.projectId===null:H.projectId===f)},[b.data,a,f]),oe=I!=="active"||a&&!!f,ce=a&&!f&&L,fe=a?E.projectId:null,Z=X(()=>Fs(j,{byProject:ce,currentProjectId:fe,projectName:S=>q.get(S)??"Unknown project"}),[j,ce,fe,q]),W=X(()=>Ns(F,Date.now()),[F]);O(()=>{F||k(JSON.stringify(W))},[F,W,k]);let te=b.data?.find(S=>S.id===t)?.updatedAt??null;O(()=>{if(!t||te===null)return;let S=Es(W,t,te);S&&k(JSON.stringify(S))},[t,te,W,k]);let ge=!(Z.length===1&&Z[0]?.kind==="recent"),se=X(()=>D?new Set:Io(T),[D,T]),de=(S,H)=>H.kind==="project"?null:a?S.projectId?q.get(S.projectId)??"Unknown project":"Global":S.projectId?null:"Global",Le=(S,H,_)=>o(Vl,{doc:S,active:S.id===t,alternative:_,projectName:_?null:de(S,H),unseen:S.id!==t&&Os(S,W),now:v,menuOpen:N?.doc.id===S.id,onSelect:()=>n(S.id),onMenu:J=>P({doc:S,at:J})},S.id),he=X(()=>a?jl(b.data??[],r,f):[],[a,b.data,r,f]);return d("div",{className:"dd-list",children:[d("div",{className:"dd-list-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),b.data?o("span",{className:"dd-list-count",title:`${j.length} ${j.length===1?"doc":"docs"}`,children:j.length}):null,o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary dd-new",onClick:i,children:[o(Ce,{size:13,"aria-hidden":!0})," New"]}),o(z,{icon:Me,label:"Hide doc list",onClick:l}),u]}),o("div",{className:"dd-list-tools",children:d("label",{className:"dd-search",children:[o(ha,{size:13,"aria-hidden":!0}),o("input",{value:c,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:S=>p(S.target.value)}),c?o("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>p(""),children:o(ie,{size:12,"aria-hidden":!0})}):null]})}),d("div",{className:"dd-list-filters",children:[o(Lo,{ariaLabel:"Filter by status",value:I,options:zl,onChange:C,searchable:!1,triggerClassName:`launch-model-picker-trigger dd-pick${I!=="active"?" on":""}`,triggerIcon:o(Ka,{size:12,"aria-hidden":!0})}),a?o(Lo,{ariaLabel:"Filter by project",value:f,options:he,onChange:m,searchable:he.length>8,searchPlaceholder:"Search projects\u2026",minWidth:220,triggerClassName:`launch-model-picker-trigger dd-pick${f?" on":""}`,triggerIcon:o(_e,{size:12,"aria-hidden":!0})}):null,a&&!f?d(V,{children:[o("span",{className:"dd-spacer"}),o(z,{icon:it,label:"Group by project",active:L,size:13,onClick:()=>A(!L)})]}):null]}),d("div",{className:"dd-list-scroll",children:[b.error?o("div",{className:"dd-banner dd-banner-error",children:b.error}):null,!b.data&&b.loading?o("div",{className:"dd-center",children:o(K,{label:"Loading design docs"})}):null,b.data&&!j.length?o("div",{className:"dd-list-empty dd-muted",children:D||oe?"No docs match.":"No design docs yet."}):null,Z.map(S=>{let H=!se.has(S.key),_=S.entries.flatMap(J=>[Le(J.doc,S,!1),...J.alternatives.map(ra=>Le(ra,S,!0))]);return ge?d("section",{className:"dd-list-group","aria-label":S.label,children:[o(Xl,{section:S,open:H,onToggle:()=>w(Bs(T,S.key))}),H?_:null]},S.key):_})]}),N?o(vn,{at:N.at,label:`Actions for ${N.doc.title}`,onClose:()=>P(null),children:x.items(N.doc,()=>P(null),()=>s(N.doc.id),N.doc.id===t?void 0:()=>n(N.doc.id))},`${N.doc.id}@${N.at.x},${N.at.y}`):null,x.dialogs]})}function Hs({templates:e,selected:a,onSelect:r}){return o("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(t=>d("button",{type:"button",role:"radio","aria-checked":a===t.id,className:`dd-template${a===t.id?" on":""}`,onClick:()=>r(t.id),children:[o("span",{className:"dd-template-label",children:t.label}),o("span",{className:"dd-template-desc",children:t.description}),o("span",{className:"dd-template-files",children:t.files.join(" \xB7 ")})]},t.id))})}function So({initialTemplate:e,defaultProjectId:a,projects:r,onClose:t,onCreated:n}){let s=G(),i=ye(),l=Jt(),[u,c]=y(""),[p,I]=y(""),[C,f]=y(e??null),[m,L]=y(a??""),[A,T]=y(""),[w,F]=y(""),[k,N]=y(!1),P=C??l.data?.[0]?.id??null,E=!!w.trim(),x=m||a||r[0]?.id||"",D=async()=>{if(!(!u.trim()||k)){N(!0);try{let v=await s.create({title:u.trim(),...p.trim()?{summary:p.trim()}:{},...P?{template:P}:{},tags:A.split(",").map(b=>b.trim().toLowerCase()).filter(Boolean),projectId:m||null});if(n(v.id),E){if(!x)B("Doc created. Add a project to let an agent draft it.","error");else if(!Yt(i,v,{prompt:qs(w),projectId:x})){let b=await s.askAgent(v.id,{prompt:qs(w),projectId:x});Pt(i,v,b.threadId),B(`An agent is drafting \u201C${v.title}\u201D. Watch it fill in as it writes.`)}}t()}catch(v){B(`Could not create the doc: ${U(v)}`,"error"),N(!1)}}};return o(aa,{title:"New design doc",wide:!0,onClose:t,footer:d(V,{children:[o("span",{className:"dd-muted dd-dialog-hint",children:E?"An agent drafts it from the brief.":"You can ask an agent to fill it in later."}),o("span",{className:"dd-spacer"}),o("button",{type:"button",className:"btn",onClick:t,children:"Cancel"}),d("button",{type:"button",className:"btn primary",disabled:!u.trim()||k,onClick:()=>{D()},children:[k?o(K,{size:12}):E?o(ne,{size:12,"aria-hidden":!0}):null,E?"Create & draft with agent":"Create"]})]}),children:d("form",{className:"dd-form",onSubmit:v=>{v.preventDefault(),D()},children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Title"}),o("input",{className:"dd-input",value:u,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:v=>c(v.target.value),autoFocus:!0})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Summary"}),o("input",{className:"dd-input",value:p,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:v=>I(v.target.value)})]}),d("div",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Template"}),l.data?o(Hs,{templates:l.data,selected:P,onSelect:f}):o(K,{label:"Loading templates"})]}),d("div",{className:"dd-field-row",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),d("select",{className:"dd-input dd-select",value:m,onChange:v=>L(v.target.value),children:[o("option",{value:"",children:"Global (all projects)"}),r.map(v=>o("option",{value:v.id,children:v.name},v.id))]})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Tags"}),o("input",{className:"dd-input",value:A,placeholder:"sync, mobile",onChange:v=>T(v.target.value)})]})]}),d("label",{className:"dd-field",children:[d("span",{className:"dd-field-label",children:[o(ne,{size:12,"aria-hidden":!0})," Brief for an agent ",o("span",{className:"dd-muted",children:"(optional)"})]}),o("textarea",{className:"dd-input",rows:4,value:w,maxLength:Ul,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:v=>F(v.target.value)})]}),o("button",{type:"submit",hidden:!0})]})})}function Zl({templates:e,onNew:a}){return o("div",{className:"dd-landing",children:d("div",{className:"dd-landing-inner",children:[o("span",{className:"dd-landing-icon",children:o(We,{size:26,"aria-hidden":!0})}),o("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),o("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),d("ul",{className:"dd-landing-points",children:[d("li",{children:[o(ne,{size:13,"aria-hidden":!0})," ",o("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),d("li",{children:[o(Ie,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),d("li",{children:[o(me,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),d("div",{className:"dd-landing-start",children:[o("span",{className:"dd-section-label",children:"Start from a template"}),e?o(Hs,{templates:e,selected:null,onSelect:r=>a(r)}):o(K,{})]})]})})}function Po({projectId:e,location:a,onLocationChange:r,variant:t,headerActions:n}){let s=Fe(),i=Jt(),[l,u]=y(null),[c,p]=re("list-open",!0),I=s.data??[];return d("div",{className:"dd-root dd-workbench",children:[c?o(Kl,{projectId:t==="project"?e:null,showProjects:t==="global",projects:I,activeId:a.docId,onSelect:C=>r({docId:C,path:null}),onDeleted:C=>{C===a.docId&&r({docId:null,path:null})},onNew:()=>u({template:null}),onCollapse:()=>p(!1),headerActions:n}):d("nav",{className:"dd-list-collapsed","aria-label":"Design docs",children:[o(z,{icon:Re,label:"Show doc list",onClick:()=>p(!0)}),o(z,{icon:Ce,label:"New design doc",onClick:()=>u({template:null})}),n]}),o("main",{className:"dd-main",children:a.docId?o(Vt,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(C,f)=>r({docId:a.docId,path:C},f??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):o(Zl,{templates:i.data,onNew:C=>u({template:C??null})})}),l?o(So,{initialTemplate:l.template,defaultProjectId:e,projects:I,onClose:()=>u(null),onCreated:C=>r({docId:C,path:null})}):null]})}var Ba="design-docs";function _s({children:e}){return o("div",{className:"dd-root",children:e})}function Us({subPath:e}){let a=ye();return o(Po,{variant:"global",projectId:null,location:eo(e),onLocationChange:(r,t)=>a.toPluginPanel(Ba,{subPath:Da(r),...t?{replace:t}:{}})})}function zs({projectId:e,headerActions:a}){let[r,t]=re(`project-location:${e}`,"");return o(Po,{variant:"project",projectId:e,location:eo(r),onLocationChange:n=>t(Da(n)),headerActions:a})}function Jl(e,a,r,t){e.openThreadPanel({actionId:ka,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...t?{threadId:t}:{}})||e.toPluginPanel(Ba,{subPath:Da(a)})}function js({attributes:e,source:a,message:r}){let t=ye(),n=e.id?.trim()||null,s=e.path?.trim()||null,i=qt(n);if(!n||i.error)return o("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:n?`Design doc unavailable: ${i.error}`:"Invalid design doc link: an id is required."});let l=i.data;return d("div",{className:"plugin-directive-card dd-card",children:[d("button",{type:"button",className:"plugin-directive-card-main",disabled:!l,onClick:()=>l&&Jl(t,{docId:l.id,path:s},l.title,r.threadId),title:l?`Open ${l.title} beside this conversation`:void 0,children:[o("span",{className:"dd-card-icon","aria-hidden":!0,children:o(We,{size:14})}),o("span",{className:"plugin-directive-card-kind",children:"Design doc"}),o("span",{className:"plugin-directive-card-title",children:l?l.title:"Loading\u2026"}),l?d("span",{className:"plugin-directive-card-meta dd-card-meta",children:[s?o("code",{children:s}):null,o(ea,{status:l.status,compact:!0}),l.files.length," file",l.files.length===1?"":"s",l.openComments?` \xB7 ${l.openComments} open comment${l.openComments===1?"":"s"}`:""]}):o(K,{size:12})]}),l?o("button",{type:"button",className:"plugin-directive-card-open",onClick:u=>{u.stopPropagation(),t.toPluginPanel(Ba,{subPath:Da({docId:l.id,path:s})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function Ql({projectId:e,onPick:a}){let r=Pa({...e?{projectId:e}:{},status:"active"}),t=Fe(),n=va(),[s,i]=y(!1);return d("div",{className:"dd-picker",children:[d("div",{className:"dd-picker-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary",onClick:()=>i(!0),children:[o(Ce,{size:13,"aria-hidden":!0})," New"]})]}),o("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(l=>d("button",{type:"button",className:"dd-doc-row",onClick:()=>a(l.id),children:[d("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:l.title}),l.status!=="draft"?o(ea,{status:l.status,compact:!0}):null]}),l.summary?o("span",{className:"dd-doc-row-summary",children:l.summary}):null,d("span",{className:"dd-doc-row-meta",children:[d("span",{children:[l.fileCount," files"]}),o("span",{className:"dd-spacer"}),o(pe,{at:l.updatedAt,now:n})]})]},l.id)):o(we,{icon:We,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):o("div",{className:"dd-center",children:r.error?o("div",{className:"dd-banner dd-banner-error",children:r.error}):o(K,{})})}),s?o(So,{defaultProjectId:e,projects:t.data??[],onClose:()=>i(!1),onCreated:l=>a(l)}):null]})}function Gs(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function $s(e){let{docId:a,path:r}=Gs(e.params);return o(Yl,{...e},`${a}\0${r}`)}function Yl({params:e,projectId:a}){let r=ye(),t=Gs(e),[n,s]=y(t),i=!t.docId;if(!n.docId)return o(_s,{children:o(Ql,{projectId:a??null,onPick:u=>s({docId:u,path:null})})});let l=n.docId;return o(_s,{children:o(Vt,{docId:l,path:n.path,layout:"compact",contextProjectId:a??null,onOpenPath:u=>s({docId:l,path:u}),onDeleted:()=>s({docId:null,path:null}),headerExtra:d(V,{children:[i?o(z,{icon:ua,label:"All design docs",onClick:()=>s({docId:null,path:null})}):null,o(z,{icon:He,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(Ba,{subPath:Da(n)})})]})},l)})}async function Vs({threadId:e,message:a,selectedText:r,openPanel:t}){let n=(r?.trim()||a.text).trim();if(!n){B("This message has no text to save.","error");return}try{let s=await Ao(pn,"createFromMessage",{threadId:e,text:n});t({actionId:ka,title:s.title,params:{docId:s.id}}),B(`Saved \u201C${s.title}\u201D as a design doc`)}catch(s){B(`Could not save the design doc: ${U(s)}`,"error")}}var vo=`
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
.dd-list-count { color: var(--text-dim); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dd-list-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 40px;
  width: 40px;
  gap: 4px;
  padding: 8px 0;
  border-right: 1px solid var(--border);
  background: var(--bg-base);
}
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
.dd-list-filters { display: flex; align-items: center; gap: 2px; padding: 0 8px 6px 6px; }
.dd-workbench .dd-pick {
  display: inline-flex;
  flex: 0 1 auto;
  width: fit-content;
  max-width: 160px;
  min-width: 0;
  height: 24px;
  gap: 4px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
}
.dd-workbench .dd-pick:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dd-workbench .dd-pick.on { color: var(--accent-blue); background: color-mix(in srgb, var(--accent-blue) 10%, transparent); }
.dd-workbench .dd-pick > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-pick-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dd-pick-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-pick-count { flex: 0 0 auto; color: var(--text-dim); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dd-list-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 6px 12px; }
.dd-list-empty { padding: 20px 10px; text-align: center; font-size: 12px; }
.dd-doc-row {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
  width: 100%;
  margin-bottom: 1px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dd-doc-row:hover { background: var(--bg-hover); }
.dd-doc-row.on { background: var(--bg-elevated); border-color: var(--border); }
.dd-doc-row-top { display: flex; align-items: center; gap: 6px; }
.dd-doc-row-title { flex: 1 1 auto; min-width: 0; overflow: hidden; font-weight: 550; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.dd-doc-row-top > .dd-time { flex: 0 0 auto; color: var(--text-dim); font-size: 11px; font-variant-numeric: tabular-nums; }
.dd-doc-row-excerpt { display: flex; align-items: center; gap: 4px; min-width: 0; color: var(--text-muted); font-size: 11.5px; }
.dd-doc-row-excerpt > svg { flex: 0 0 auto; color: var(--accent-gold); }
.dd-doc-row-excerpt-body { flex: 0 1 auto; min-width: 3em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Agent labels can be a whole thread title: never let one crowd out the comment. */
.dd-doc-row-excerpt-author { flex: 0 1 auto; min-width: 0; max-width: 40%; overflow: hidden; color: var(--text-dim); text-overflow: ellipsis; white-space: nowrap; }
.dd-doc-row-excerpt-author::before { content: '\u2014 '; }
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
.dd-doc-row-meta > span.dd-doc-row-project { flex: 0 1 auto; gap: 5px; min-width: 0; color: var(--text-muted); }
.dd-doc-row-project-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-doc-row-unseen { flex: 0 0 auto; color: var(--accent-blue); font-weight: 600; }
.dd-swatch { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 2px; }
.dd-doc-row-comments { color: var(--accent-gold); }
.dd-doc-row-alt { position: relative; width: calc(100% - 14px); margin-left: 14px; padding-top: 4px; padding-bottom: 4px; }
.dd-doc-row-alt::before { content: ''; position: absolute; left: -8px; top: 0; height: 50%; width: 6px; border-left: 1px solid var(--border); border-bottom: 1px solid var(--border); border-bottom-left-radius: 4px; }
.dd-doc-row-badge { flex: 0 0 auto; margin-top: 1px; padding: 0 5px; border-radius: 4px; background: color-mix(in srgb, var(--accent-gold) 14%, transparent); color: var(--accent-gold); font-size: 10.5px; font-weight: 600; line-height: 16px; }
.dd-list-group + .dd-list-group { margin-top: 4px; }
.dd-list-section {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 6px 6px 4px;
  border: 0;
  background: var(--bg-base);
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.dd-list-section:hover { color: var(--text-primary); }
.dd-list-section-caret { flex: 0 0 auto; transition: transform 120ms ease; }
.dd-list-section[aria-expanded='false'] .dd-list-section-caret { transform: rotate(-90deg); }
.dd-list-section-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-list-section-here { flex: 0 0 auto; padding: 0 5px; border-radius: 4px; background: color-mix(in srgb, var(--accent-blue) 14%, transparent); color: var(--accent-blue); font-size: 10px; line-height: 15px; }
.dd-list-section-count { flex: 0 0 auto; font-variant-numeric: tabular-nums; letter-spacing: 0; }
.dd-list-section-pinned { color: var(--accent-blue); }
.dd-list-section-needs-me { color: var(--accent-gold); }
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
.dd-doc-header-compact button.dd-doc-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.dd-doc-header-compact .dd-doc-updated { min-width: 0; overflow: hidden; white-space: nowrap; }
.dd-doc-header-compact .dd-doc-updated > * { overflow: hidden; text-overflow: ellipsis; }
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
.dd-publish-trigger { height: 28px; padding: 0 10px; gap: 5px; }
.dd-publish-intro { margin: 0 0 14px; font-size: 12px; line-height: 1.5; }
.dd-publish-fields { display: flex; flex-direction: column; gap: 12px; }
.dd-publish-problem { margin: 10px 0 0; font-size: 12px; color: var(--danger); }
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
.dd-rail.dd-rail-chat { flex-basis: 420px; width: 420px; }
.dd-rail-floating .dd-rail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 15; width: min(340px, 100%); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.25); }
.dd-rail-floating .dd-rail.dd-rail-chat { width: min(420px, 100%); }
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

.dd-agent-chat-head { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; height: 36px; padding: 0 6px; border-bottom: 1px solid var(--border); }
.dd-agent-chat-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; }
.dd-agent-chat-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.dd-agent-chat-body > * { flex: 1 1 auto; min-height: 0; }
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
/* A phone already is the phone width: the preview-width switcher is noise. */
.dd-doc-narrow .dd-html-widths { display: none; }
.dd-doc-narrow .dd-html-toolbar { padding: 2px 8px; }
`;var Ws="design-docs-plugin-styles";function ei(){if(typeof document>"u")return;let e=document.getElementById(Ws);if(e instanceof HTMLStyleElement){e.textContent=vo;return}let a=document.createElement("style");a.id=Ws,a.textContent=vo,document.head.appendChild(a)}ei();var jx=Do(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:Ba,component:Us}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:zs}),e.slots.messageDirective({id:"design-doc",component:js}),e.slots.threadPanelAction({id:ka,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:$s}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:Vs})});export{jx as default,ei as injectStyles};
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
lucide-react/dist/esm/icons/chevron-up.mjs:
lucide-react/dist/esm/icons/circle-dot.mjs:
lucide-react/dist/esm/icons/cloud-upload.mjs:
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
lucide-react/dist/esm/icons/git-fork.mjs:
lucide-react/dist/esm/icons/globe.mjs:
lucide-react/dist/esm/icons/hash.mjs:
lucide-react/dist/esm/icons/house.mjs:
lucide-react/dist/esm/icons/list-checks.mjs:
lucide-react/dist/esm/icons/list-tree.mjs:
lucide-react/dist/esm/icons/loader-circle.mjs:
lucide-react/dist/esm/icons/message-square-plus.mjs:
lucide-react/dist/esm/icons/message-square-text.mjs:
lucide-react/dist/esm/icons/message-square.mjs:
lucide-react/dist/esm/icons/monitor.mjs:
lucide-react/dist/esm/icons/move-right.mjs:
lucide-react/dist/esm/icons/panel-left-close.mjs:
lucide-react/dist/esm/icons/panel-left-open.mjs:
lucide-react/dist/esm/icons/panel-right.mjs:
lucide-react/dist/esm/icons/pencil.mjs:
lucide-react/dist/esm/icons/pin-off.mjs:
lucide-react/dist/esm/icons/pin.mjs:
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
