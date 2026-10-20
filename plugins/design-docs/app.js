function Ws(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Ua(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function ko(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function Ao(e,a,r){return Ws().callRpc(e,a,r)}function Do(e){return{__zccPluginApp:!0,setup:e}}function To(){return Ua().useRpc?.()??ko("useRpc")}function Mo(e,a){Ua().useRealtime?.(e,a)}function Ro(){return Ua().useZccContext?.()??{projectId:null,threadId:null}}function Pe(){return Ua().useZccNavigate?.()??ko("useZccNavigate")}function Xs(){return globalThis.__ZCC_HOST_REACT__}function Ks(e,a){let r=Xs(),t=Ua()[e];return!r||!t?null:r.createElement(t,a)}function za(e){return Ks("Markdown",e)}var V=globalThis.__ZCC_HOST_REACT__;var pi=V.Children,mi=V.Component,gi=V.Fragment,hi=V.StrictMode,xi=V.Suspense,Li=V.cloneElement,Fo=V.createContext,Sa=V.createElement,Ii=V.createRef,Bt=V.forwardRef,Ci=V.isValidElement,bi=V.lazy,yi=V.memo,Si=V.startTransition,Te=V.useCallback,Bo=V.useContext,Pi=V.useDebugValue,No=V.useDeferredValue,O=V.useEffect,Eo=V.useId,vi=V.useImperativeHandle,wi=V.useInsertionEffect,Pa=V.useLayoutEffect,X=V.useMemo,ki=V.useReducer,T=V.useRef,b=V.useState,Oo=V.useSyncExternalStore,Ai=V.useTransition,Di=V.version;var qo=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Ho(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:qo(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var _o=e=>{let a="",r=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){r=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=r?t.toUpperCase():t,r=!1}return a};var Uo=e=>{let a=_o(e);return a.charAt(0).toUpperCase()+a.slice(1)};var ja=(...e)=>e.filter((a,r,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===r).join(" ").trim();var $e={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function Zt(e){return e!=null}function zo(e,a={}){let r=a.attributeNames??{},t=I=>r[I]??I,n=e.size??e.width??$e.width,s=e.size??e.height??$e.height,i=e.aliases?.filter(I=>typeof I=="string"&&I.trim()!=="").map(I=>`lucide-${I}`)??[],l=[...e.name?[`lucide-${e.name}`]:[],...i],u=a.className?.split(" ").filter(Boolean)??[],c=a.includeDefaultClasses===!1?ja(...u):ja("lucide",...l,...u),p=a.absoluteStrokeWidth?Number(a.strokeWidth??$e["stroke-width"])*Number(e.size??e.width??$e.width)/Number(a.size??a.width??$e.width):a.strokeWidth??$e["stroke-width"];return["svg",{...Object.entries($e).reduce((I,[f,m])=>(I[t(f)]=m,I),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&Zt(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&Zt(a.width)&&{[t("width")]:a.width},..."height"in a&&Zt(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:p,...c&&{[t("class")]:c},[t("viewBox")]:`0 0 ${n} ${s}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(I=>{let[f,m,h]=I,D=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...m}:m;return h?[f,D,h]:[f,D]})]}function jo(e,a={}){return zo(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var Go=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Zs=Fo({});var $o=()=>Bo(Zs);var Vo=Bt(({color:e,size:a,width:r,height:t,strokeWidth:n,absoluteStrokeWidth:s,nonScalingStroke:i,className:l="",children:u,iconNode:c=[],icon:p={node:c,aliases:[],size:24},...L},I)=>{let{size:f=24,strokeWidth:m=2,absoluteStrokeWidth:h=!1,nonScalingStroke:D=!1,color:N="currentColor",className:w=""}=$o()??{},M=!!u||Go(L),[k,B,P=[]]=jo(p,{color:e??N,width:r??a??f,height:t??a??f,strokeWidth:n??m,absoluteStrokeWidth:s??h,nonScalingStroke:i??D,className:ja(w,l),hasA11yProp:M,attributes:L});return Sa(k,{ref:I,...B},[...P.map(([E,x])=>Sa(E,x)),...Array.isArray(u)?u:[u]])});function g(e,a=[],r=[]){let t=typeof e=="string"?Ho(e,a,r):e,n=Bt(({className:s,...i},l)=>Sa(Vo,{ref:l,icon:t,className:s,...i}));return t.name&&(n.displayName=Uo(t.name)),n}var Wo={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};Wo.node;var Ga=g(Wo);var Xo={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};Xo.node;var $a=g(Xo);var Ko={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};Ko.node;var Va=g(Ko);var Zo={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};Zo.node;var Wa=g(Zo);var Jo={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};Jo.node;var ge=g(Jo);var Qo={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};Qo.node;var Xa=g(Qo);var Yo={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};Yo.node;var qe=g(Yo);var er={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};er.node;var le=g(er);var ar={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};ar.node;var la=g(ar);var tr={name:"chevron-up",size:24,node:[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]};tr.node;var Ka=g(tr);var or={name:"circle-dot",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]};or.node;var Za=g(or);var rr={name:"cloud-upload",size:24,node:[["path",{d:"M12 13v8",key:"1l5pq0"}],["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"m8 17 4-4 4 4",key:"1quai1"}]],aliases:["upload-cloud"]};rr.node;var He=g(rr);var nr={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};nr.node;var Ve=g(nr);var sr={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};sr.node;var Ja=g(sr);var dr={name:"corner-down-right",size:24,node:[["path",{d:"m15 10 5 5-5 5",key:"qqa56n"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12",key:"z08zvw"}]]};dr.node;var Qa=g(dr);var lr={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};lr.node;var We=g(lr);var ir={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};ir.node;var Ya=g(ir);var ur={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};ur.node;var Me=g(ur);var cr={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};cr.node;var ia=g(cr);var fr={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};fr.node;var et=g(fr);var pr={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};pr.node;var at=g(pr);var mr={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};mr.node;var ve=g(mr);var gr={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};gr.node;var tt=g(gr);var hr={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};hr.node;var Xe=g(hr);var xr={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};xr.node;var Re=g(xr);var Lr={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};Lr.node;var ot=g(Lr);var Ir={name:"file-type",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M11 18h2",key:"12mj7e"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5",key:"qbrxap"}]]};Ir.node;var rt=g(Ir);var Cr={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};Cr.node;var Ke=g(Cr);var br={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};br.node;var nt=g(br);var yr={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};yr.node;var _e=g(yr);var Sr={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};Sr.node;var st=g(Sr);var Pr={name:"git-fork",size:24,node:[["circle",{cx:"12",cy:"18",r:"3",key:"1mpf1b"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["path",{d:"M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9",key:"1uq4wg"}],["path",{d:"M12 12v3",key:"158kv8"}]]};Pr.node;var dt=g(Pr);var vr={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};vr.node;var lt=g(vr);var wr={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};wr.node;var ua=g(wr);var kr={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};kr.node;var Ze=g(kr);var Ar={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};Ar.node;var it=g(Ar);var Dr={name:"list-tree",size:24,node:[["path",{d:"M8 5h13",key:"1pao27"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"M3 10a2 2 0 0 0 2 2h3",key:"1npucw"}],["path",{d:"M3 5v12a2 2 0 0 0 2 2h3",key:"x1gjn2"}]]};Dr.node;var ut=g(Dr);var Tr={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};Tr.node;var Je=g(Tr);var Mr={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};Mr.node;var ca=g(Mr);var Rr={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};Rr.node;var ct=g(Rr);var Fr={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};Fr.node;var Ce=g(Fr);var Br={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};Br.node;var ft=g(Br);var Nr={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};Nr.node;var pt=g(Nr);var Er={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};Er.node;var Fe=g(Er);var Or={name:"panel-left-open",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m14 9 3 3-3 3",key:"8010ee"}]],aliases:["sidebar-open"]};Or.node;var Be=g(Or);var qr={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};qr.node;var mt=g(qr);var Hr={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};Hr.node;var fa=g(Hr);var _r={name:"pin-off",size:24,node:[["path",{d:"M12 17v5",key:"bb1du9"}],["path",{d:"M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89",key:"znwnzq"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",key:"c9qhm2"}]]};_r.node;var gt=g(_r);var Ur={name:"pin",size:24,node:[["path",{d:"M12 17v5",key:"bb1du9"}],["path",{d:"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",key:"1nkz8b"}]]};Ur.node;var pa=g(Ur);var zr={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};zr.node;var be=g(zr);var jr={name:"reply",size:24,node:[["path",{d:"M20 18v-2a4 4 0 0 0-4-4H4",key:"5vmcpk"}],["path",{d:"m9 17-5-5 5-5",key:"nvlc11"}]]};jr.node;var ht=g(jr);var Gr={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};Gr.node;var we=g(Gr);var $r={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};$r.node;var Ue=g($r);var Vr={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};Vr.node;var xt=g(Vr);var Wr={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};Wr.node;var Lt=g(Wr);var Xr={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Xr.node;var ma=g(Xr);var Kr={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};Kr.node;var It=g(Kr);var Zr={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};Zr.node;var se=g(Zr);var Jr={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};Jr.node;var Ct=g(Jr);var Qr={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};Qr.node;var bt=g(Qr);var Yr={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};Yr.node;var Ie=g(Yr);var en={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};en.node;var ke=g(en);var an={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};an.node;var yt=g(an);var tn={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};tn.node;var St=g(tn);var on={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};on.node;var Qe=g(on);var rn={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};rn.node;var Pt=g(rn);var nn={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};nn.node;var ie=g(nn);var Jt=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];function sn(e){return Jt.find(a=>a.id===e)??null}var Nt=4e3;function dn(e){let a=e.path?` Focus on ${e.path}.`:"",r=[e.action?.instruction,e.prompt?.trim()].filter(Boolean).join(`

`);return[`You are working on the design doc "${e.doc.title}" (id ${e.doc.id}) in the Design Docs plugin.${a}`,r,`Start with design_doc_read doc="${e.doc.id}" to see its files and open comments. Make changes in the doc itself with design_doc_write (prefer small edits with baseRevision) and design_doc_comment, rather than pasting long content into chat. The user is watching the doc update live. When you finish, summarise what you changed and end with ::design-doc{id="${e.doc.id}"} on its own line.`].filter(Boolean).join(`

`)}function Js(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function Qs(e){let a=(t,n)=>e(t,n===void 0?void 0:Js(n)),r=async t=>{await t};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(t={})=>a("list",t),get:t=>a("get",{doc:t}),create:t=>a("create",t),update:(t,n)=>a("update",{doc:t,...n}),pin:(t,n)=>a("pin",{doc:t,pinned:n}),remove:t=>r(a("remove",{doc:t})),readFile:(t,n)=>a("readFile",{doc:t,path:n}),renderPage:(t,n)=>a("renderPage",{doc:t,...n}),readPageFile:(t,n)=>a("readPageFile",{doc:t,path:n}),pageLink:(t,n)=>a("pageLink",{doc:t,path:n}),siteFiles:t=>a("siteFiles",{doc:t}),reportRender:(t,n)=>r(a("reportRender",{doc:t,...n})),writeFile:(t,n)=>a("writeFile",{doc:t,...n}),editFile:(t,n)=>a("editFile",{doc:t,...n}),deleteFile:(t,n)=>r(a("deleteFile",{doc:t,path:n})),renameFile:(t,n,s)=>a("renameFile",{doc:t,from:n,to:s}),history:(t,n={})=>a("history",{doc:t,...n}),revision:(t,n)=>a("revision",{doc:t,id:n}),restore:(t,n,s)=>a("restore",{doc:t,id:n,baseRevision:s}),addComment:(t,n)=>a("addComment",{doc:t,...n}),replyToComment:(t,n,s)=>a("replyToComment",{doc:t,id:n,body:s}),setCommentStatus:(t,n,s)=>a("setCommentStatus",{doc:t,id:n,status:s}),deleteComment:(t,n)=>r(a("deleteComment",{doc:t,id:n})),unlinkThread:(t,n)=>r(a("unlinkThread",{doc:t,threadId:n})),askAgent:(t,n)=>a("askAgent",{doc:t,...n,path:n.path??void 0}),publish:(t,n)=>a("publish",{doc:t,...n})}}function $(){let e=To();return X(()=>Qs((a,r)=>e.call(a,r)),[e])}function U(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function ln(e){return/changed since revision/i.test(U(e))}function un(e){return/^design doc .* not found/i.test(e)}function F(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var cn="design-docs";var fn="changed",Et=["draft","review","approved","implemented","archived"],Ot={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function pn(e,a){let r=t=>t.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Ye(e,a){let[r,t]=b({key:e,data:null,error:null,loading:e!==null}),[n,s]=b(0),i=T(a);i.current=a,O(()=>{if(e===null){t({key:e,data:null,error:null,loading:!1});return}let c=!1;return t(p=>({key:e,data:p.key===e?p.data:null,error:null,loading:!0})),i.current().then(p=>{c||t({key:e,data:p,error:null,loading:!1})},p=>{c||t(L=>({key:e,data:L.key===e?L.data:null,error:U(p),loading:!1}))}),()=>{c=!0}},[e,n]);let l=Te(()=>s(c=>c+1),[]),u=r.key===e;return{data:u?r.data:null,error:u?r.error:null,loading:u?r.loading:e!==null,reload:l}}function gn(e,a=120){let r=T(e);r.current=e;let t=T(new Set),n=T(null);O(()=>()=>{n.current&&clearTimeout(n.current)},[]),Mo(fn,s=>{let i=typeof s?.docId=="string"?s.docId:null;t.current.add(i),!n.current&&(n.current=setTimeout(()=>{n.current=null;let l=[...t.current];t.current.clear();for(let u of l)r.current(u)},a))})}function va(e){let a=$(),r=Ye(JSON.stringify(e),()=>a.list(e));return gn(()=>r.reload()),r}function qt(e){let a=$(),r=Ye(e,()=>a.get(e));return gn(t=>{(t===null||t===e)&&r.reload()}),r}function hn(e,a,r){let t=$(),n=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Ye(n,()=>t.readFile(e,a))}function Qt(){let e=$();return Ye("templates",()=>e.templates())}function Ne(){let e=$();return Ye("projects",()=>e.projects())}var mn="zcc.design-docs.";function re(e,a){let[r,t]=b(()=>{try{let s=globalThis.localStorage?.getItem(mn+e);if(s==null)return a;let i=JSON.parse(s);return typeof i==typeof a?i:a}catch{return a}}),n=Te(s=>{t(s);try{globalThis.localStorage?.setItem(mn+e,JSON.stringify(s))}catch{}},[e]);return[r,n]}function xn(e){let[a,r]=b(null),[t,n]=b(null);return Pa(()=>{if(!a)return;let s=l=>n(l>0?e.filter(u=>l>=u).length:null);if(s(a.getBoundingClientRect().width),typeof ResizeObserver>"u")return;let i=new ResizeObserver(l=>s(l[0]?.contentRect.width??0));return i.observe(a),()=>i.disconnect()},[a,e]),[r,t]}function wa(e=6e4){let[a,r]=b(()=>Date.now());return O(()=>{let t=setInterval(()=>r(Date.now()),e);return()=>clearInterval(t)},[e]),a}var Ys=Symbol.for("react.portal");function ed(e,a){return{$$typeof:Ys,key:null,children:e,containerInfo:a,implementation:null}}function Yt(e){return typeof document>"u"?e:ed(e,document.body)}function ga(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function Ln(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let t=Math.round(r/60);if(t<60)return`${t}m ago`;let n=Math.round(t/60);if(n<24)return`${n}h ago`;let s=Math.round(n/24);return s<30?`${s}d ago`:new Date(e).toISOString().slice(0,10)}var In=globalThis.__ZCC_HOST_REACT__,W=In.Fragment;function o(e,a,r){return In.createElement(e,r===void 0?a:{...a,key:r})}var d=o;var ad={MessageSquareText:ct,CheckCheck:Xa,WandSparkles:Qe,Workflow:Pt,ScanSearch:Lt,ListChecks:it};function Cn(e){return ad[e]??se}function ka({kind:e,size:a=14}){return o(e==="image"||e==="svg"?tt:e==="font"?rt:e==="markdown"||e==="text"?ot:at,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function ea({status:e,compact:a=!1}){return d("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[o("span",{className:"dd-status-dot","aria-hidden":!0}),Ot[e]]})}function ye({actor:e}){let a=e.kind==="agent"?ge:St;return d("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[o(a,{size:12,"aria-hidden":!0}),o("span",{className:"dd-actor-label",children:e.label})]})}function pe({at:e,now:a}){return o("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:Ln(e,a)})}function Z({size:e=14,label:a}){return o("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:o(Je,{size:e,className:"dd-spin","aria-hidden":!0})})}function Ae({icon:e,title:a,children:r}){return d("div",{className:"dd-empty",children:[o("span",{className:"dd-empty-icon",children:o(e,{size:22,"aria-hidden":!0})}),o("div",{className:"dd-empty-title",children:a}),r?o("div",{className:"dd-empty-body",children:r}):null]})}function z({icon:e,label:a,onClick:r,active:t=!1,danger:n=!1,disabled:s=!1,size:i=14}){return o("button",{type:"button",className:`icon-btn dd-icon-btn${t?" on":""}${n?" danger":""}`,title:a,"aria-label":a,"aria-pressed":t||void 0,disabled:s,onClick:r,children:o(e,{size:i,"aria-hidden":!0})})}function bn(e,a){let r=T(null),t=T(a);return t.current=a,O(()=>{if(!e)return;let n=i=>{r.current&&i.target instanceof Node&&!r.current.contains(i.target)&&t.current()},s=i=>{i.key==="Escape"&&t.current()};return document.addEventListener("mousedown",n),document.addEventListener("keydown",s),()=>{document.removeEventListener("mousedown",n),document.removeEventListener("keydown",s)}},[e]),r}function De({open:e,onClose:a,anchor:r,children:t,align:n="end",className:s=""}){let i=bn(e,a);return d("div",{className:"dd-pop-anchor",ref:i,children:[r,e?o("div",{className:`dd-pop dd-pop-${n} ${s}`,role:"dialog",children:t}):null]})}function yn(e){if(e.clientX||e.clientY)return{x:e.clientX,y:e.clientY};let a=e.currentTarget.getBoundingClientRect();return{x:a.left+12,y:a.bottom}}var Ht=4;function Sn({at:e,label:a,onClose:r,children:t}){let n=bn(!0,r),s=T(r);s.current=r;let[i,l]=b(e);Pa(()=>{let c=n.current,{width:p,height:L}=c.getBoundingClientRect();l({x:Math.max(Ht,Math.min(e.x,window.innerWidth-p-Ht)),y:Math.max(Ht,Math.min(e.y,window.innerHeight-L-Ht))})},[n,e.x,e.y]),O(()=>{let c=document.activeElement instanceof HTMLElement?document.activeElement:null;n.current?.querySelector('[role="menuitem"]')?.focus();let p=L=>{L.target instanceof Node&&n.current?.contains(L.target)||s.current()};return window.addEventListener("scroll",p,!0),window.addEventListener("resize",p),window.addEventListener("blur",p),()=>{window.removeEventListener("scroll",p,!0),window.removeEventListener("resize",p),window.removeEventListener("blur",p),c?.isConnected&&(document.activeElement===document.body||n.current?.contains(document.activeElement))&&c.focus()}},[n]);let u=c=>{let p=[...c.currentTarget.querySelectorAll('[role="menuitem"]')],L=p.indexOf(document.activeElement),I=c.key==="ArrowDown"?(L+1)%p.length:c.key==="ArrowUp"?(L-1+p.length)%p.length:c.key==="Home"?0:c.key==="End"?p.length-1:-1;c.key==="Tab"&&r(),!(I<0||!p.length)&&(c.preventDefault(),p[I].focus())};return Yt(o("div",{ref:n,className:"dd-pop dd-menu dd-context-menu",role:"menu","aria-label":a,style:{left:i.x,top:i.y},onKeyDown:u,onContextMenu:c=>c.preventDefault(),children:t}))}function ue({icon:e,label:a,hint:r,onSelect:t,danger:n=!1,checked:s=!1}){return d("button",{type:"button",role:"menuitem",className:`dd-menu-item${n?" dd-menu-danger":""}${s?" dd-menu-checked":""}`,onClick:t,children:[e?o(e,{size:14,"aria-hidden":!0}):null,o("span",{className:"dd-menu-label",children:a}),r?o("span",{className:"dd-menu-hint",children:r}):null]})}function Ee({request:e,onClose:a}){let[r,t]=b(!1),n=async()=>{t(!0);try{await e.run()}finally{t(!1),a()}};return o(aa,{title:e.title,onClose:a,footer:d(W,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{n()},autoFocus:!0,children:e.confirmLabel})]}),children:o("div",{className:"dd-confirm-body",children:e.body})})}function aa({title:e,onClose:a,children:r,footer:t,wide:n=!1}){return O(()=>{let s=i=>{i.key==="Escape"&&a()};return document.addEventListener("keydown",s),()=>document.removeEventListener("keydown",s)},[a]),Yt(o("div",{className:"dd-dialog-backdrop",onMouseDown:s=>{s.target===s.currentTarget&&a()},children:d("div",{className:`dd-dialog${n?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[d("div",{className:"dd-dialog-header",children:[o("span",{className:"dd-dialog-title",children:e}),o(z,{icon:ie,label:"Close",onClick:a})]}),o("div",{className:"dd-dialog-body",children:r}),t?o("div",{className:"dd-dialog-footer",children:t}):null]})}))}var td={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},Aa="design-doc";function Da(e,a,r){e.openPanelAgent?.({threadId:r,title:a.title})||(e.openThreadPanel({actionId:Aa,title:a.title,params:{docId:a.id},threadId:r}),e.toThread(r))}function eo(e,a,r){if(!e.openPanelAgent)return!1;let t=dn({doc:a,action:r.action?sn(r.action):null,prompt:r.prompt,path:r.path});return e.openPanelAgent({draft:{prompt:t,view:a.id,...r.projectId?{projectId:r.projectId}:{}},title:a.title})}function Pn({doc:e,now:a,openInPanel:r=!0}){let t=$(),n=Pe(),s=[...e.threads].sort((i,l)=>l.lastActivityAt-i.lastActivityAt);return o("div",{className:"dd-rail-pane dd-agents",children:d("div",{className:"dd-rail-scroll",children:[s.length?o("ul",{className:"dd-thread-list",children:s.map(i=>d("li",{className:"dd-thread",children:[d("button",{type:"button",className:"dd-thread-open",onClick:()=>r?Da(n,e,i.threadId):n.toThread(i.threadId),title:r?"Open chat beside the doc":"Open thread",children:[o(ge,{size:14,"aria-hidden":!0}),d("span",{className:"dd-thread-main",children:[o("span",{className:"dd-thread-title",children:i.title}),d("span",{className:"dd-thread-meta",children:[o("span",{className:`dd-role dd-role-${i.role}`,children:td[i.role]}),o(pe,{at:i.lastActivityAt,now:a})]})]})]}),o(z,{icon:yt,label:"Unlink thread",size:13,onClick:()=>{t.unlinkThread(e.id,i.threadId).catch(l=>F(`Could not unlink: ${U(l)}`,"error"))}})]},i.threadId))}):d(Ae,{icon:ge,title:"No agents yet",children:["Use ",o("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),d("div",{className:"dd-agents-hint",children:[o(Wa,{size:13,"aria-hidden":!0}),d("span",{children:["Agents in this project already know this doc exists. Type ",o("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",o("code",{children:"design_doc_read"}),"."]})]})]})})}function vn({doc:e,activePath:a,request:r,contextProjectId:t,compact:n=!1}){let s=$(),i=Pe(),[l,u]=b(!1),[c,p]=b(""),[L,I]=b(!1),[f,m]=b(t??""),[h,D]=b(null),N=Ne(),w=T(null),M=!e.projectId,k=N.data??[],B=M?f||k[0]?.id||"":e.projectId;O(()=>{r&&(p(r.prompt),I(!0),u(!0),requestAnimationFrame(()=>{let x=w.current;x&&(x.focus(),x.selectionStart=x.selectionEnd=x.value.length)}))},[r]),O(()=>{l&&I(x=>x||!!a&&a!==e.entryPath)},[l,a,e.entryPath]);let P=async x=>{if(h)return;if(M&&!B){F("Add a project first: agents run inside a project.","error");return}let A={action:x,prompt:x?void 0:c.trim()||void 0,path:L?a:null,projectId:B||null};if(eo(i,e,A)){u(!1),p("");return}D(x??"custom");try{let v=await s.askAgent(e.id,{...x?{action:x}:{},...c.trim()&&!x?{prompt:c.trim()}:{},path:L?a:null,...M?{projectId:B}:{}});Da(i,e,v.threadId),F(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),u(!1),p("")}catch(v){F(`Could not start the agent: ${U(v)}`,"error")}finally{D(null)}},E=x=>{x.key==="Enter"&&(x.metaKey||x.ctrlKey)&&(x.preventDefault(),c.trim()&&P(null))};return d(De,{open:l,onClose:()=>u(!1),className:"dd-ask",anchor:d("button",{type:"button",className:`btn primary dd-ask-trigger${n?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":l,onClick:()=>u(!l),children:[o(se,{size:13,"aria-hidden":!0}),n?null:"Ask agent",o(le,{size:12,"aria-hidden":!0})]}),children:[d("div",{className:"dd-ask-head",children:[o("span",{className:"dd-ask-title",children:"Ask an agent"}),o("span",{className:"dd-muted",children:"Opens a briefed composer beside the doc; pick a harness and send"})]}),o("div",{className:"dd-ask-actions",role:"menu",children:Jt.map(x=>{let A=Cn(x.icon);return d("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!h,onClick:()=>{P(x.id)},title:x.description,children:[o("span",{className:"dd-ask-action-icon",children:h===x.id?o(Z,{size:13}):o(A,{size:14,"aria-hidden":!0})}),d("span",{className:"dd-ask-action-text",children:[o("span",{className:"dd-ask-action-label",children:x.label}),o("span",{className:"dd-ask-action-desc",children:x.description})]})]},x.id)})}),d("div",{className:"dd-ask-custom",children:[o("textarea",{ref:w,className:"dd-input",rows:3,maxLength:Nt,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:c,onChange:x=>p(x.target.value),onKeyDown:E}),d("div",{className:"dd-ask-options",children:[a?d("label",{className:"dd-check",children:[o("input",{type:"checkbox",checked:L,onChange:x=>I(x.target.checked)}),"Focus on ",o("code",{children:a})]}):null,M?d("label",{className:"dd-field-inline",children:["Run in",d("select",{className:"dd-input dd-select",value:B,onChange:x=>m(x.target.value),children:[k.length?null:o("option",{value:"",children:"No projects"}),k.map(x=>o("option",{value:x.id,children:x.name},x.id))]})]}):null,o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary",disabled:!c.trim()||!!h,onClick:()=>{P(null)},children:[h==="custom"?o(Z,{size:12}):null,"Start"]})]})]})]})}var od=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),rd=/[A-Za-z][^\t\n\f\r />]*/y,nd=/[\t\n\f\r /]*/y,wn=/[\t\n\f\r ]*/y,sd=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,dd=/[^\t\n\f\r >]*/y,ld={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function id(e){return e.includes("&")?e.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(a,r,t,n)=>{if(n)return ld[n.toLowerCase()]??a;let s=r?Number(r):parseInt(t,16);return s>0&&s<=1114111?String.fromCodePoint(s):a}):e}function kn(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function Ta(e,a,r){return e.lastIndex=r,e.exec(a)?.[0]??""}function ud(e,a){let r=Ta(rd,e,a+1),t=a+1+r.length,n=[];for(;t<e.length;){let s=Ta(nd,e,t);if(t+=s.length,t>=e.length)return null;if(e[t]===">")return{name:r.toLowerCase(),attributes:n,selfClosing:s.endsWith("/"),start:a,end:t+1};let i=Ta(sd,e,t)||e[t];t+=i.length,t+=Ta(wn,e,t).length;let l=null;if(e[t]==="="){t+=1,t+=Ta(wn,e,t).length;let u=e[t];if(u==='"'||u==="'"){let c=e.indexOf(u,t+1);if(c<0)return null;l=e.slice(t+1,c),t=c+1}else l=Ta(dd,e,t),t+=l.length}n.push({name:i.toLowerCase(),value:l===null?null:id(l)})}return null}function*cd(e){let a=0;for(;a<e.length;){let r=e.indexOf("<",a);if(r<0)return;let t=e[r+1]??"";if(e.startsWith("<!--",r)){let s=e.indexOf("-->",r+4);a=s<0?e.length:s+3;continue}if(t==="!"||t==="?"||t==="/"&&/[A-Za-z]/.test(e[r+2]??"")){let s=e.indexOf(">",r+2);a=s<0?e.length:s+1;continue}if(!/[A-Za-z]/.test(t)){a=r+1;continue}let n=ud(e,r);if(!n)return;if(a=n.end,od.has(n.name)){let s=new RegExp(`</${n.name}(?=[\\t\\n\\f\\r />])`,"ig");s.lastIndex=n.end;let i=s.exec(e),l=i?i.index:e.length,u=i?e.indexOf(">",l):-1,c=u<0?e.length:u+1;yield{...n,content:{start:n.end,end:l,closeEnd:c}},a=c;continue}yield n}}function _t(e,a){let r=-1;for(let n of cd(e)){if(n.name==="head")return e.slice(0,n.end)+a+e.slice(n.end);if(n.name==="html"){r=n.end;continue}break}if(r>=0)return e.slice(0,r)+a+e.slice(r);let t=e.match(/^\s*<!doctype[^>]*>/i);return t?t[0]+a+e.slice(t[0].length):a+e}function vt(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var fd={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},pd={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"};var An={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function ha(e){let a=vt(e),r=fd[a];return r||(An[a]?"code":"text")}function Dn(e){return An[vt(e)]??""}function ze(e){return e==="image"||e==="font"}function Tn(e){return pd[vt(e)]??null}var md=/^[a-z][a-z0-9+.-]*:/i;function wt(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||md.test(r))return null;let t=r.split(/[?#]/,1)[0],n=t;try{n=decodeURIComponent(t)}catch{}let s=n.startsWith("/")?[]:e.split("/").slice(0,-1);for(let i of n.split("/"))if(!(!i||i===".")){if(i===".."){if(!s.length)return null;s.pop();continue}s.push(i)}return s.length?s.join("/"):null}function Mn(e,a){let r=e.split("/"),t=a.split("/"),n=Math.min(r.length,t.length);for(let s=0;s<n;s+=1){let i=s===r.length-1,l=s===t.length-1;if(r[s]!==t[s])return i!==l?i?-1:1:r[s].localeCompare(t[s],void 0,{sensitivity:"base",numeric:!0})}return r.length-t.length}function ao(e){let a=(e??"").split("/").filter(Boolean),[r,...t]=a;return{docId:r??null,path:t.length?t.join("/"):null}}function Ma(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}function gd(e){let a=new TextEncoder().encode(e),r="";for(let t=0;t<a.length;t+=32768)r+=String.fromCharCode(...a.subarray(t,t+32768));return btoa(r)}function to(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${gd(e.content)}`;let a=Tn(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var Rn=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;function Fn(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function Bn(e,a){let r=new Set;for(let t of a.matchAll(Rn)){let n=wt(e,Fn(t[2]));n&&r.add(n)}return[...r]}function Nn(e,a,r){return r.size?a.replace(Rn,(t,n,s,i="")=>{let l=wt(e,Fn(s)),u=l?r.get(l):void 0;return u?`${n}${u}${i})`:t}):a}function oo(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(n=>n[0].length)),t="`".repeat(Math.max(3,r+1));return`${t}${a}
${e.replace(/\n$/,"")}
${t}`}function En(e,a){return oo(a,Dn(e))}var hd=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function On(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let n of hd){let s=r.getPropertyValue(n).trim();s&&(a[n]=s)}let t=r.getPropertyValue("color-scheme").trim();return t&&(a["color-scheme"]=t),a}var xd=/^[^<>{};]*$/;function qn(e,a){let t=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>xd.test(n)).map(([n,s])=>`${n}: ${s};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;return _t(e,t)}function Hn(e){let a=[],r=new Map;for(let t of[...e].sort((n,s)=>Mn(n.path,s.path))){let n=t.path.split("/"),s=a;for(let i=0;i<n.length-1;i+=1){let l=n.slice(0,i+1).join("/"),u=r.get(l);u||(u={kind:"folder",name:n[i],path:l,children:[]},r.set(l,u),s.push(u)),s=u.children}s.push({kind:"file",name:n.at(-1),path:t.path,file:t})}return a}var _n=/^(?:(?:https|ssh):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/|[\w.-]+@([\w.-]+):)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;function Ld(e){return e.length>0&&e.length<=100&&/^[\w./-]+$/.test(e)&&!e.startsWith("-")&&!e.startsWith("/")&&!e.endsWith("/")&&!e.endsWith(".")&&!e.endsWith(".lock")&&!e.includes("..")&&!e.includes("//")}var Ra=class extends Error{};function Un(e){let a=typeof e.repo=="string"?e.repo.trim():"";if(a.length>300)throw new Ra("repository URL must be at most 300 characters");if(a&&!_n.test(a))throw new Ra("repository must be a clone URL such as https://github.com/owner/repo or git@github.com:owner/repo.git");let r=typeof e.branch=="string"?e.branch.trim():"";if(!Ld(r))throw new Ra("branch must be a valid git branch name, e.g. main or gh-pages");let t=e.folder??"root";if(t!=="root"&&t!=="docs")throw new Ra("folder must be root or docs");return{repo:a||null,branch:r,folder:t}}function zn(e){let a=e.trim().match(_n);if(!a)return null;let r=(a[1]??a[2]).toLowerCase(),[t,n]=[a[3],a[4]];return r==="github.com"?n.toLowerCase()===`${t.toLowerCase()}.github.io`?`https://${n}/`:`https://${t}.github.io/${n}/`:`https://${r}/pages/${t}/${n}/`}var ro={repo:"",branch:"main",folder:"root"},Gn=e=>`zcc.design-docs.publish.${e}`;function jn(e){try{let a=JSON.parse(localStorage.getItem(Gn(e))??"null");return a?{repo:typeof a.repo=="string"?a.repo:"",branch:typeof a.branch=="string"&&a.branch?a.branch:ro.branch,folder:a.folder==="docs"?"docs":"root"}:ro}catch{return ro}}function bd(e,a){try{localStorage.setItem(Gn(e),JSON.stringify(a))}catch{}}function yd(e,a){try{return Un({...e,repo:a?"":e.repo}),null}catch(r){return U(r)}}function Sd({doc:e,onClose:a}){let r=$(),t=Pe(),n=Ne(),[s,i]=b(()=>jn(e.id)),[l,u]=b(()=>!jn(e.id).repo),[c,p]=b(""),[L,I]=b(!1),f=!e.projectId,m=n.data??[],h=f?c||m[0]?.id||"":e.projectId,D=e.files.some(P=>P.kind==="html"),N=D?!l&&!s.repo.trim()?null:yd(s,l):"This doc has no HTML pages to publish. Add an index.html first.",w=D&&!N&&(l||!!s.repo.trim())&&(!f||!!h),M=!l&&!N&&s.repo.trim()?zn(s.repo):null,k=P=>i(E=>({...E,...P})),B=async()=>{if(!(!w||L)){I(!0);try{let P=await r.publish(e.id,{...l?{}:{repo:s.repo.trim()},branch:s.branch.trim(),folder:s.folder,...f?{projectId:h}:{}});bd(e.id,{...s,repo:l?"":s.repo.trim(),branch:s.branch.trim()}),Da(t,e,P.threadId),F(`Publishing \u201C${e.title}\u201D. The agent reports the live URL when the push lands.`),a()}catch(P){F(`Could not start publishing: ${U(P)}`,"error")}finally{I(!1)}}};return d(aa,{title:"Publish site",onClose:a,footer:d(W,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),d("button",{type:"button",className:"btn primary",disabled:!w||L,onClick:()=>{B()},children:[L?o(Z,{size:12}):o(He,{size:13,"aria-hidden":!0}),"Publish"]})]}),children:[o("p",{className:"dd-muted dd-publish-intro",children:"An agent exports this doc as a static site, commits it and pushes it with your git credentials. GitHub Pages then serves it."}),d("div",{className:"dd-publish-fields",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Repository"}),d("select",{className:"dd-input dd-select",value:l?"own":"other",onChange:P=>u(P.target.value==="own"),children:[o("option",{value:"own",children:"This project's repository"}),o("option",{value:"other",children:"Another repository\u2026"})]})]}),l?null:d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Clone URL"}),o("input",{className:"dd-input",value:s.repo,maxLength:300,placeholder:"https://github.com/owner/repo",spellCheck:!1,autoFocus:!0,onChange:P=>k({repo:P.target.value})})]}),d("div",{className:"dd-field-row",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Branch"}),o("input",{className:"dd-input",value:s.branch,maxLength:100,spellCheck:!1,onChange:P=>k({branch:P.target.value})})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Folder"}),d("select",{className:"dd-input dd-select",value:s.folder,onChange:P=>k({folder:P.target.value}),children:[o("option",{value:"root",children:"/ (root)"}),o("option",{value:"docs",children:"/docs"})]})]})]}),f?d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Run the agent in"}),d("select",{className:"dd-input dd-select",value:h,onChange:P=>p(P.target.value),children:[m.length?null:o("option",{value:"",children:"No projects"}),m.map(P=>o("option",{value:P.id,children:P.name},P.id))]})]}):null]}),N?o("p",{className:"dd-publish-problem",role:"alert",children:N}):d("p",{className:"dd-muted dd-field-help",children:[M?d(W,{children:["Expected at ",o("code",{children:M}),"."," "]}):null,"Turn on Pages in the repository settings once: deploy from ",o("code",{children:s.branch.trim()||"main"}),","," ",o("code",{children:s.folder==="docs"?"/docs":"/ (root)"}),". Other files in the repository are left in place."]})]})}function $n({doc:e,compact:a=!1}){let[r,t]=b(!1);return d(W,{children:[d("button",{type:"button",className:"btn dd-publish-trigger",title:"Publish as a GitHub Pages site","aria-label":a?"Publish":void 0,onClick:()=>t(!0),children:[o(He,{size:13,"aria-hidden":!0}),a?null:"Publish"]}),r?o(Sd,{doc:e,onClose:()=>t(!1)}):null]})}var Wn=e=>e.key==="Enter"&&(e.metaKey||e.ctrlKey);function Pd({onSend:e,onCancel:a}){let[r,t]=b(""),[n,s]=b(!1),i=async()=>{let l=r.trim();if(!l||n)return;s(!0);let u=await e(l);s(!1),u&&t("")};return d("div",{className:"dd-reply-composer",children:[o("textarea",{className:"dd-input dd-composer-input",placeholder:"Reply\u2026 agents see the whole thread","aria-label":"Reply",value:r,maxLength:8e3,rows:2,autoFocus:!0,onChange:l=>t(l.target.value),onKeyDown:l=>{Wn(l)?(l.preventDefault(),i()):l.key==="Escape"&&(l.preventDefault(),a())}}),d("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send \xB7 Esc to cancel"}),d("span",{className:"dd-reply-buttons",children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:!r.trim()||n,onClick:()=>{i()},children:"Reply"})]})]})]})}function vd({comment:e,fileGone:a,now:r,onToggle:t,onDelete:n,onDeleteReply:s,onReply:i,onFocus:l}){let u=e.status==="resolved",[c,p]=b(!1);return d("article",{className:`dd-comment${u?" dd-comment-resolved":""}`,children:[d("header",{className:"dd-comment-head",children:[o(ye,{actor:e.author}),o(pe,{at:e.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(z,{icon:ht,label:"Reply",onClick:()=>p(!0),size:13}),o(z,{icon:u?Ue:qe,label:u?"Reopen":"Resolve",onClick:t,size:13}),o(z,{icon:Ie,label:"Delete comment",onClick:n,danger:!0,size:13})]}),e.path||e.quote?d("button",{type:"button",className:"dd-comment-anchor",onClick:l,disabled:!l,title:a?"This file was deleted":"Show in the document",children:[e.path?d("span",{className:`dd-comment-path${a?" dd-comment-path-gone":""}`,children:[e.path,a?" (deleted)":""]}):null,e.quote?o("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,o("div",{className:"dd-comment-body",children:o(za,{content:e.body})}),e.replies.length?o("ol",{className:"dd-replies","aria-label":"Replies",children:e.replies.map(L=>d("li",{className:"dd-reply",children:[d("header",{className:"dd-comment-head",children:[o(ye,{actor:L.author}),o(pe,{at:L.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(z,{icon:Ie,label:"Delete reply",onClick:()=>s(L.id),danger:!0,size:12})]}),o("div",{className:"dd-comment-body",children:o(za,{content:L.body})})]},L.id))}):null,c?o(Pd,{onCancel:()=>p(!1),onSend:async L=>{let I=await i(L);return I&&p(!1),I}}):null]})}function Xn({doc:e,activePath:a,now:r,pendingQuote:t,onClearQuote:n,draft:s,onDraft:i,onFocusComment:l}){let u=$(),[c,p]=re("comments-scope","all"),[L,I]=b(!1),[f,m]=b(!1),[h,D]=b(null),N=T(null);O(()=>{t&&N.current?.focus()},[t]);let w=X(()=>e.comments.filter(C=>c==="all"||!C.path||C.path===a),[e.comments,c,a]),M=w.filter(C=>C.status==="open"),k=w.filter(C=>C.status==="resolved"),B=async(C,q)=>{try{return await C(),!0}catch(G){return F(`${q}: ${U(G)}`,"error"),!1}},P=t?t.path:a,E=async()=>{let C=s.trim();if(!(!C||f)){m(!0);try{await u.addComment(e.id,{body:C,...P?{path:P}:{},...t?{quote:t.text}:{}}),i(""),n()}catch(q){F(`Could not add the comment: ${U(q)}`,"error")}finally{m(!1)}}},x=C=>{Wn(C)&&(C.preventDefault(),E())},A=X(()=>new Set(e.files.map(C=>C.path)),[e.files]),v=C=>{let q=!!C.path&&!A.has(C.path);return o(vd,{comment:C,fileGone:q,now:r,onToggle:()=>{B(()=>u.setCommentStatus(e.id,C.id,C.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>D({title:"Delete comment",body:C.replies.length?`Delete this comment and its ${C.replies.length===1?"reply":`${C.replies.length} replies`}? This cannot be undone.`:"Delete this comment? This cannot be undone.",confirmLabel:"Delete",danger:!0,run:()=>{B(()=>u.deleteComment(e.id,C.id),"Could not delete the comment")}}),onDeleteReply:G=>{B(()=>u.deleteComment(e.id,G),"Could not delete the reply")},onReply:G=>B(()=>u.replyToComment(e.id,C.id,G),"Could not reply"),onFocus:!q&&(C.quote||C.path)?()=>l(C):void 0},C.id)};return d("div",{className:"dd-rail-pane dd-comments",children:[o("div",{className:"dd-rail-toolbar",children:d("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[o("button",{type:"button",className:c==="all"?"on":"",onClick:()=>p("all"),children:"All files"}),o("button",{type:"button",className:c==="file"?"on":"",onClick:()=>p("file"),disabled:!a,children:"This file"})]})}),d("div",{className:"dd-rail-scroll",children:[M.length===0?o(Ae,{icon:Ce,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):M.map(v),k.length?d("div",{className:"dd-resolved",children:[d("button",{type:"button",className:"dd-disclosure",onClick:()=>I(!L),children:[L?o(le,{size:13,"aria-hidden":!0}):o(la,{size:13,"aria-hidden":!0}),"Resolved (",k.length,")"]}),L?k.map(v):null]}):null]}),d("div",{className:"dd-composer",children:[t?d("div",{className:"dd-composer-quote",children:[o("span",{className:"dd-comment-quote",children:t.text}),o(z,{icon:ie,label:"Remove quote",onClick:n,size:12})]}):null,o("textarea",{ref:N,className:"dd-input dd-composer-input",placeholder:P?`Comment on ${P}\u2026 agents see open comments`:"Leave a comment\u2026",value:s,maxLength:8e3,rows:3,onChange:C=>i(C.target.value),onKeyDown:x}),d("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),o("button",{type:"button",className:"btn primary",disabled:!s.trim()||f,onClick:()=>{E()},children:"Comment"})]})]}),h?o(Ee,{request:h,onClose:()=>D(null)}):null]})}function wd(e){let a=document.createElement("textarea");a.value=e,a.setAttribute("readonly",""),a.style.position="fixed",a.style.top="-9999px";let r=document.activeElement instanceof HTMLElement?document.activeElement:null;document.body.appendChild(a);try{return a.select(),document.execCommand("copy")}catch{return!1}finally{a.remove(),r?.focus()}}async function Kn(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return wd(e)}var kd=(()=>{let e=new Uint32Array(256);for(let a=0;a<256;a+=1){let r=a;for(let t=0;t<8;t+=1)r=r&1?3988292384^r>>>1:r>>>1;e[a]=r>>>0}return e})();function Ad(e){let a=4294967295;for(let r of e)a=kd[(a^r)&255]^a>>>8;return(a^4294967295)>>>0}function Dd(e){let a=Math.max(e.getFullYear(),1980);return{time:e.getHours()<<11|e.getMinutes()<<5|Math.floor(e.getSeconds()/2),date:a-1980<<9|e.getMonth()+1<<5|e.getDate()}}var Zn=2048,no=20;function Jn(e,a=new Date){let r=new TextEncoder,{time:t,date:n}=Dd(a),s=[],i=[],l=0;for(let f of e){let m=r.encode(f.path),h=Ad(f.data),D=f.data.length,N=new Uint8Array(30+m.length),w=new DataView(N.buffer);w.setUint32(0,67324752,!0),w.setUint16(4,no,!0),w.setUint16(6,Zn,!0),w.setUint16(8,0,!0),w.setUint16(10,t,!0),w.setUint16(12,n,!0),w.setUint32(14,h,!0),w.setUint32(18,D,!0),w.setUint32(22,D,!0),w.setUint16(26,m.length,!0),w.setUint16(28,0,!0),N.set(m,30),s.push(N,f.data);let M=new Uint8Array(46+m.length),k=new DataView(M.buffer);k.setUint32(0,33639248,!0),k.setUint16(4,no,!0),k.setUint16(6,no,!0),k.setUint16(8,Zn,!0),k.setUint16(10,0,!0),k.setUint16(12,t,!0),k.setUint16(14,n,!0),k.setUint32(16,h,!0),k.setUint32(20,D,!0),k.setUint32(24,D,!0),k.setUint16(28,m.length,!0),k.setUint32(42,l,!0),M.set(m,46),i.push(M),l+=N.length+D}let u=i.reduce((f,m)=>f+m.length,0),c=new Uint8Array(22),p=new DataView(c.buffer);p.setUint32(0,101010256,!0),p.setUint16(8,e.length,!0),p.setUint16(10,e.length,!0),p.setUint32(12,u,!0),p.setUint32(16,l,!0);let L=new Uint8Array(l+u+c.length),I=0;for(let f of[...s,...i,c])L.set(f,I),I+=f.length;return L}function Td(e){if(e.encoding==="utf8")return new TextEncoder().encode(e.content);let a=atob(e.content),r=new Uint8Array(a.length);for(let t=0;t<a.length;t+=1)r[t]=a.charCodeAt(t);return r}function Qn(e,a,r){return Jn(a.map(t=>({path:`${e}/${t.path}`,data:Td(t)})),r)}var Md=3e4;function Yn(e,a,r){let t=URL.createObjectURL(new Blob([a],{type:r})),n=document.createElement("a");n.href=t,n.download=e,n.style.display="none",document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(t),Md)}function Rd({doc:e,projects:a,onClose:r,onMove:t}){let[n,s]=b(e.projectId??"");return d(aa,{title:"Move design doc",onClose:r,footer:d(W,{children:[o("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.projectId??""),onClick:()=>{t(n||null).then(r)},children:"Move"})]}),children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),d("select",{className:"dd-input dd-select",value:n,onChange:i=>s(i.target.value),children:[o("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(i=>o("option",{value:i.id,children:i.name},i.id))]})]}),o("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}function Fd({doc:e,onClose:a,onPick:r}){let t=va({...e.projectId?{projectId:e.projectId}:{},status:"active"}),[n,s]=b(e.alternativeTo??""),i=t.data??[],l=i.filter(c=>c.id!==e.id&&!c.alternativeTo),u=i.filter(c=>c.alternativeTo===e.id).length;return d(aa,{title:"Alternative to\u2026",onClose:a,footer:d(W,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.alternativeTo??"")||u>0,onClick:()=>{r(n||null).then(a)},children:"Save"})]}),children:[t.data?d("label",{className:"dd-field",children:[d("span",{className:"dd-field-label",children:["\u201C",e.title,"\u201D is an alternative to"]}),d("select",{className:"dd-input dd-select",value:n,disabled:u>0,onChange:c=>s(c.target.value),children:[o("option",{value:"",children:"Nothing: a doc of its own"}),l.map(c=>o("option",{value:c.id,children:c.title},c.id))]})]}):o(Z,{label:"Loading design docs"}),o("p",{className:"dd-muted dd-field-help",children:u>0?`This doc has ${u} alternative${u===1?"":"s"} of its own. Detach them first: alternatives nest one level deep.`:"Alternatives are listed under the doc they compete with, so competing proposals stay together."})]})}async function es(e,a){await Kn(e)?F(`Copied ${a}`):F(`Could not copy ${a}`,"error")}function Ut(e){let a=$(),[r,t]=b(null),[n,s]=b(null),[i,l]=b(null),u=async(f,m)=>{try{await a.update(f.id,m)}catch(h){F(`Could not update the doc: ${U(h)}`,"error")}},c=async(f,m)=>{try{await a.pin(f.id,m)}catch(h){F(`Could not ${m?"pin":"unpin"} the doc: ${U(h)}`,"error")}},p=async f=>{try{let m=await a.siteFiles(f.id);Yn(`${m.slug}.zip`,Qn(m.slug,m.files),"application/zip")}catch(m){F(`Could not download the doc: ${U(m)}`,"error")}};return{items:(f,m,h,D)=>{let N=f.status==="archived",w=M=>()=>{m(),M()};return d(W,{children:[D?o(ue,{icon:_e,label:"Open",onSelect:w(D)}):null,f.pinnedAt!==null?o(ue,{icon:gt,label:"Unpin",onSelect:w(()=>{c(f,!1)})}):o(ue,{icon:pa,label:"Pin to top",onSelect:w(()=>{c(f,!0)})}),o(ue,{icon:Ja,label:"Copy chat reference",hint:"Paste into any thread",onSelect:w(()=>{es(pn(f.id),"reference")})}),o(ue,{icon:ua,label:"Copy id",hint:f.slug,onSelect:w(()=>{es(f.id,"id")})}),o(ue,{icon:Ya,label:"Download .zip",hint:`${f.slug}.zip`,onSelect:w(()=>{p(f)})}),o(ue,{icon:nt,label:"Move to project\u2026",onSelect:w(()=>t(f))}),o(ue,{icon:dt,label:"Alternative to\u2026",hint:f.alternativeTo?"Linked":void 0,onSelect:w(()=>s(f))}),o(ue,{icon:N?Ga:$a,label:N?"Unarchive":"Archive",onSelect:w(()=>{u(f,{status:N?"draft":"archived"})})}),o(ue,{icon:Ie,label:"Delete\u2026",danger:!0,onSelect:w(()=>l({title:"Delete design doc",body:d(W,{children:["Delete ",o("strong",{children:f.title})," with its ",f.fileCount," file",f.fileCount===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await a.remove(f.id),F(`Deleted \u201C${f.title}\u201D`),h()}catch(M){F(`Could not delete: ${U(M)}`,"error")}}}))})]})},dialogs:d(W,{children:[r?o(Rd,{doc:r,projects:e,onClose:()=>t(null),onMove:f=>u(r,{projectId:f})}):null,n?o(Fd,{doc:n,onClose:()=>s(null),onPick:f=>u(n,{alternativeTo:f})}):null,i?o(Ee,{request:i,onClose:()=>l(null)}):null]})}}function ts({value:e,placeholder:a,maxLength:r,multiline:t=!1,className:n="",label:s,onSave:i}){let[l,u]=b(!1),[c,p]=b(e),L=T(!1);O(()=>{l||p(e)},[e,l]);let I=async m=>{if(L.current)return;L.current=!0,u(!1);let h=c.trim();if(m&&h!==e.trim())try{await i(h)}catch{p(e)}else p(e)},f=m=>{m.key==="Escape"?(m.preventDefault(),I(!1)):m.key==="Enter"&&(!t||m.metaKey||m.ctrlKey||!m.shiftKey)&&(m.preventDefault(),I(!0))};if(l){let m={className:`dd-editable-input ${n}`,value:c,maxLength:r,"aria-label":s,autoFocus:!0,onChange:h=>p(h.target.value),onKeyDown:f,onBlur:()=>{I(!0)}};return t?o("textarea",{...m,rows:2,placeholder:a}):o("input",{...m,placeholder:a})}return o("button",{type:"button",className:`dd-editable ${n}${e?"":" dd-editable-empty"}`,title:`Edit ${s.toLowerCase()}`,onClick:()=>{L.current=!1,u(!0)},children:e||a})}function Nd({tags:e,onChange:a}){let[r,t]=b(!1),[n,s]=b(""),i=()=>{let l=n.split(",").map(c=>c.trim().toLowerCase().slice(0,32)).filter(Boolean);s(""),t(!1);let u=[...new Set([...e,...l])].slice(0,12);u.length!==e.length&&a(u)};return d("span",{className:"dd-tags",children:[e.map(l=>d("span",{className:"dd-tag",children:[o(ua,{size:10,"aria-hidden":!0}),l,o("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${l}`,onClick:()=>a(e.filter(u=>u!==l)),children:o(ie,{size:10,"aria-hidden":!0})})]},l)),r?o("input",{className:"dd-input dd-tag-input",value:n,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:l=>s(l.target.value),onBlur:i,onKeyDown:l=>{l.key==="Enter"?(l.preventDefault(),i()):l.key==="Escape"&&(s(""),t(!1))}}):e.length<12?d("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>t(!0),children:[o(be,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function Ed({status:e,onChange:a}){let[r,t]=b(!1);return o(De,{open:r,onClose:()=>t(!1),align:"start",className:"dd-menu",anchor:o("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>t(!r),title:"Change status",children:o(ea,{status:e})}),children:Et.map(n=>o(ue,{label:o(ea,{status:n}),checked:n===e,icon:n===e?qe:void 0,onSelect:()=>{t(!1),n!==e&&a(n)}},n))})}function os({doc:e,projects:a,compact:r,collapsible:t=!1,actions:n,onDeleted:s}){let i=$(),[l,u]=b(!1),[c,p]=b(!1),L=Ut(a),I=e.projectId?a.find(h=>h.id===e.projectId):null,f=async h=>{try{await i.update(e.id,h)}catch(D){throw F(`Could not update the doc: ${U(D)}`,"error"),D}},m=r||t&&!c;return d("header",{className:`dd-doc-header${r||t?" dd-doc-header-compact":""}`,children:[d("div",{className:"dd-doc-title-row",children:[o(ts,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:h=>h?f({title:h}):void 0}),o("span",{className:"dd-spacer"}),n,o(De,{open:l,onClose:()=>u(!1),className:"dd-menu",anchor:o(z,{icon:Me,label:"More actions",active:l,onClick:()=>u(!l)}),children:L.items(e,()=>u(!1),s)})]}),m?null:o(ts,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:h=>f({summary:h})}),d("div",{className:"dd-doc-meta",children:[o(Ed,{status:e.status,onChange:h=>{f({status:h}).catch(()=>{})}}),d("span",{className:"dd-doc-project",title:I?`Project \xB7 ${I.name}`:"Visible to agents in every project",children:[I?null:o(lt,{size:12,"aria-hidden":!0}),I?I.name:e.projectId?"Unknown project":"Global"]}),m?null:o(Nd,{tags:e.tags,onChange:h=>{f({tags:h}).catch(()=>{})}}),o("span",{className:"dd-spacer"}),d("span",{className:"dd-doc-updated",children:[o(ye,{actor:e.updatedBy})," ",o(pe,{at:e.updatedAt,now:Date.now()})]}),t?o(z,{icon:c?Ka:le,label:c?"Hide summary and tags":"Show summary and tags",active:c,onClick:()=>p(!c)}):null]}),L.dialogs]})}function rs({docId:e,file:a,removed:r=!1,split:t,renderPreview:n,onStateChange:s,onSaved:i}){let l=$(),[u,c]=b(a.content),[p,L]=b({content:a.content,revision:a.revision}),[I,f]=b(!1),[m,h]=b(null),D=u!==p.content,N=No(u),w=T({dirty:D,draft:u,saved:p});w.current={dirty:D,draft:u,saved:p},O(()=>{let{dirty:P,draft:E,saved:x}=w.current;a.revision!==x.revision&&(!P||a.content===E?(c(a.content),L({content:a.content,revision:a.revision}),h(null)):h({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),O(()=>{s?.({dirty:D,saving:I})},[D,I,s]);let M=Te(async P=>{if(!I){f(!0);try{let E=P??(r?0:p.revision),x=await l.writeFile(e,{path:a.path,content:u,baseRevision:E});L({content:u,revision:x.revision}),h(null),i?.(x)}catch(E){if(ln(E)){let x=await l.readFile(e,a.path).catch(()=>null);h({revision:x?.revision??p.revision+1,by:x?.updatedBy??a.updatedBy})}else F(`Could not save ${a.path}: ${U(E)}`,"error")}finally{f(!1)}}},[l,e,u,a.path,a.updatedBy,i,r,p.revision,I]),k=async()=>{try{let P=await l.readFile(e,a.path);c(P.content),L({content:P.content,revision:P.revision}),h(null)}catch(P){F(`Could not reload ${a.path}: ${U(P)}`,"error")}},B=P=>{if((P.metaKey||P.ctrlKey)&&P.key.toLowerCase()==="s"){P.preventDefault(),D&&!m&&M();return}if(P.key==="Tab"&&!P.metaKey&&!P.ctrlKey&&!P.altKey){P.preventDefault();let E=P.currentTarget,{selectionStart:x,selectionEnd:A,value:v}=E,C=`${v.slice(0,x)}  ${v.slice(A)}`;c(C),requestAnimationFrame(()=>{E.selectionStart=E.selectionEnd=x+2})}};return d("div",{className:"dd-editor",children:[r&&D&&!m?d("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(ve,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[a.path," was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them."]})]}):null,m?d("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(ke,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[o(ye,{actor:m.by})," saved revision ",m.revision," while you were editing."]}),d("button",{type:"button",className:"btn",onClick:()=>{k()},children:[o(Ue,{size:12,"aria-hidden":!0})," Discard mine"]}),o("button",{type:"button",className:"btn",onClick:()=>{M(m.revision)},children:"Overwrite with mine"})]}):null,d("div",{className:`dd-editor-body${t?" dd-editor-split":""}`,children:[o("textarea",{className:"dd-editor-input",value:u,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:P=>c(P.target.value),onKeyDown:B,autoFocus:!0}),t?o("div",{className:"dd-editor-preview",children:n(N)}):null]}),d("div",{className:"dd-editor-footer",children:[d("span",{className:"dd-editor-state",children:[I?o(Z,{size:12,label:"Saving"}):null,I?"Saving\u2026":D?"Unsaved changes":`Saved \xB7 rev ${p.revision}`]}),o("span",{className:"dd-editor-hint",children:"\u2318S to save"}),o("button",{type:"button",className:"btn",disabled:!D||I,onClick:()=>c(p.content),children:"Revert"}),d("button",{type:"button",className:"btn primary",disabled:!D||I||!!m,onClick:()=>{M()},children:[o(xt,{size:12,"aria-hidden":!0})," Save"]})]})]})}var zt="dd-comment",jt="dd-comment-focus";function Od(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}var qd=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE"]);function Hd(e){let a=e.ownerDocument.createTreeWalker(e,4,{acceptNode:u=>qd.has(u.parentElement?.tagName.toUpperCase()??"")?2:1}),r=[],t=[],n="";for(let u=a.nextNode();u;u=a.nextNode())t.push(n.length),r.push(u),n+=u.data;let s="",i=[],l=!0;for(let u=0;u<n.length;u+=1){let c=n[u];/\s/.test(c)?(l||(s+=" ",i.push(u)),l=!0):(s+=c,i.push(u),l=!1)}return{nodes:r,starts:t,normalized:s,map:i}}function ns(e,a){let r=0,t=e.starts.length-1;for(;r<t;){let n=r+t+1>>1;e.starts[n]<=a?r=n:t=n-1}return[e.nodes[r],a-e.starts[r]]}function io(e,a){let r=new Map;if(!a.length)return r;let t=Hd(e);if(!t.nodes.length)return r;for(let n of a){if(r.has(n))continue;let s="",i=-1;for(let I of new Set([n.replace(/\s+/g," ").trim(),Od(n)]))if(!(I.length<2)&&(i=t.normalized.indexOf(I),i>=0)){s=I;break}if(i<0)continue;let[l,u]=ns(t,t.map[i]),[c,p]=ns(t,t.map[i+s.length-1]),L=e.ownerDocument.createRange();L.setStart(l,u),L.setEnd(c,p+1),r.set(n,L)}return r}function _d(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var ss=new Map;function xa(e,a,r){let t=_d();if(!t)return;let n=ss.get(e)??new Map;ss.set(e,n),r.length?n.set(a,r):n.delete(a);let s=[...n.values()].flat();s.length?t.registry.set(e,new t.Highlight(...s)):t.registry.delete(e)}var ls="dd-page";var Ud="dd-page-hello",is=50,zd=256*1024,co=1e3,uo=4e3,jd=500,Gd=500,$d=new Set(["error","missing","blocked"]);function At(e){return e&&typeof e=="object"&&!Array.isArray(e)?e:null}function Fa(e,a){return typeof e=="string"&&e.length<=a?e:null}function fo(e,a){return typeof e=="string"?e.slice(0,a):null}function Gt(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function ds(e){return!Array.isArray(e)||e.length>Gd?null:e.every(a=>typeof a=="string"&&a.length<=500)?e:null}function Vd(e){if(e===null)return null;let a=At(e);if(!a)return;let[r,t,n,s]=[a.top,a.left,a.bottom,a.right].map(Gt);return r===null||t===null||n===null||s===null?void 0:{top:r,left:t,bottom:n,right:s}}function Wd(e){let a=At(e);if(!a)return null;let r=0;for(let[t,n]of Object.entries(a))if(typeof n!="string"||(r+=t.length+n.length,r>zd))return null;return{...a}}function Xd(e){let a=At(e),r=a?.kind,t=fo(a?.message,jd);if(!a||!$d.has(r)||!t)return null;let n=fo(a.source,co),s=Gt(a.line);return{kind:r,message:t,...n?{source:n}:{},...s!==null&&s>0?{line:Math.floor(s)}:{}}}function us(e){let a=At(e);if(!a)return null;switch(a.type){case"ready":return{type:"ready"};case"fetch":{let r=Fa(a.path,co);return Number.isSafeInteger(a.id)&&a.id>=0&&r!==null?{type:"fetch",id:a.id,path:r}:null}case"navigate":{let r=Fa(a.path,co),t=a.hash===null?null:Fa(a.hash,uo);return r===null||t===null&&a.hash!==null||typeof a.newTab!="boolean"?null:{type:"navigate",path:r,hash:t,newTab:a.newTab,redirect:a.redirect===!0}}case"open":{let r=Fa(a.url,uo);return r===null?null:{type:"open",url:r}}case"problem":{let r=Xd(a.problem);return r?{type:"problem",problem:r}:null}case"selection":{let r=fo(a.text,500),t=Vd(a.rect);return r===null||t===void 0?null:{type:"selection",text:r,rect:t}}case"anchors":{let r=ds(a.found),t=ds(a.missing);return r&&t?{type:"anchors",found:r,missing:t}:null}case"focused":{let r=Fa(a.quote,500);return r===null||typeof a.found!="boolean"?null:{type:"focused",quote:r,found:a.found}}case"scroll":{let r=Gt(a.x),t=Gt(a.y);return r===null||t===null?null:{type:"scroll",x:r,y:t}}case"hash":{let r=a.hash===null?null:Fa(a.hash,uo);return r===null&&a.hash!==null?null:{type:"hash",hash:r}}case"storage":{let r=Wd(a.entries);return r?{type:"storage",entries:r}:null}default:return null}}function cs(e){return At(e)?.dd===Ud}var kg=12*1024*1024,po=960*1024;function fs(e,a,r){let t=new Map(a.map(n=>[n.path,n.revision]));return!r&&e.revision!==(t.get(e.path)??null)||e.deps.some(n=>(t.get(n.path)??0)!==n.revision)?!0:e.missing.some(n=>t.has(n))}function mo(e,a){let r=[...e],t=new Set(e.map(n=>n.path));for(let[n,s]of a){if(r.length>=500)break;t.has(n)||r.push({path:n,revision:s})}return r}function ps(e){return JSON.stringify(e).replace(/</g,"\\u003c")}var Kd=new URL("./page-runtime.js",import.meta.url).href,ms=[{id:"full",label:"Full width",icon:ft,width:null},{id:"tablet",label:"Tablet (768px)",icon:bt,width:768},{id:"phone",label:"Phone (390px)",icon:It,width:390}],Zd=400,Jd=1500,Qd=6,Yd=200,el=20,al=50,tl={error:"Error",missing:"Missing",blocked:"Blocked"},Ba=new Map;function ol(e,a){for(Ba.delete(e),Ba.set(e,a);Ba.size>el;)Ba.delete(Ba.keys().next().value)}var La=new Map,go=(e,a)=>`${e}\0${a}`;function rl(e,a,r){let t=go(e,a);for(La.delete(t),La.set(t,r);La.size>al;)La.delete(La.keys().next().value)}function nl(e,a,r,t){let n=`<script type="application/json" id="${ls}">${ps(a)}<\/script><script src="${kn(r)}"><\/script>`,s=_t(e.html,n);return e.styled?s:qn(s,t)}function sl(e,a){let r=0,t=[],n=()=>{for(;r<e&&t.length;){let s=t.shift();r+=1,Promise.resolve().then(s).catch(()=>{}).finally(()=>{r-=1,n()})}};return{add(s){return r+t.length>=a?!1:(t.push(s),n(),!0)},clear(){t.length=0}}}function dl(e){return e.length*6<po?!1:new TextEncoder().encode(JSON.stringify(e)).byteLength>po}function ll(e,a){return e.kind===a.kind&&e.message===a.message&&e.source===a.source&&e.line===a.line}function gs({docId:e,file:a,files:r,draft:t=!1,quotes:n=[],onOpenPath:s,onQuote:i,onAskAbout:l,handleRef:u}){let c=$(),p=a.path,[L,I]=b("full"),[f,m]=b(null),[h,D]=b(!0),[N,w]=b(null),[M,k]=b(!1),[B,P]=b([]),[E,x]=b(!1),[A,v]=b(null),[C,q]=b(null),[G,oe]=b(0),ce=T(null),fe=T(null),te=T(null),K=T(!1),Q=T(null),de=T([]),me=T(new Map),he=T(null),xe=T(""),Le=T({hash:La.get(go(e,p))??null,scroll:null}),y=T(n);y.current=n;let _=X(()=>sl(Qd,Yd),[]);O(()=>{La.delete(go(e,p))},[e,p]);let j=t?a.content:null,[J,Se]=b(j);O(()=>{if(j===J)return;if(j===null){Se(null);return}let S=setTimeout(()=>Se(j),Zd);return()=>clearTimeout(S)},[j,J]);let Ia=r.find(S=>S.path===p)?.revision??null,ne=J===null?Ia:null,Oa=T(0);O(()=>{let S=++Oa.current;if(J!==null&&dl(J)){k(!0),D(!1);return}k(!1),D(!0),c.renderPage(e,{path:p,draft:J??void 0}).then(R=>{if(S!==Oa.current)return;let Y={mode:"frame",docId:e,path:p,hash:Le.current.hash,scroll:Le.current.scroll,quotes:[...y.current],storage:Ba.get(e)};m({id:S,page:R,srcDoc:nl(R,Y,Kd,R.styled?{}:On()),draft:J!==null}),w(null),D(!1)},R=>{S===Oa.current&&(w(U(R)),D(!1))})},[c,e,p,J,ne,G]);let qa=T("");O(()=>{if(!f||h)return;let S={...f.page,deps:mo(f.page.deps,me.current)};if(!fs(S,r,J!==null))return;let R=r.map(Y=>`${Y.path}@${Y.revision}`).join("|");qa.current!==R&&(qa.current=R,oe(Y=>Y+1))},[f,r,h,J]);let je=(S,R=te.current)=>{try{R?.postMessage(S)}catch{}},ae=S=>{P(R=>R.length>=is||R.some(Y=>ll(Y,S))?R:[...R,S]),Ca()},Ha=T(B);Ha.current=B;let ra=T(f);ra.current=f;let Ca=()=>{he.current&&clearTimeout(he.current),he.current=setTimeout(()=>{he.current=null;let S=ra.current,R=S?.page;if(!R||S.draft||R.revision===null||!K.current)return;let Y={path:R.path,revision:R.revision,deps:mo(R.deps,me.current),missing:R.missing,problems:Ha.current,unanchored:de.current},ee=JSON.stringify(Y);ee!==xe.current&&(xe.current=ee,c.reportRender(e,Y).catch(()=>{xe.current=""}))},Jd)},ba=(S,R)=>{S!==p&&(R!==null&&rl(e,S,R),s?.(S))},na=(S,R,Y)=>{let ee=new Set(r.map(da=>da.path)),Oe=ee.has(S)?S:ee.has(`${S}/index.html`)?`${S}/index.html`:null;if(!Oe){F(`${S} is not a file in this design doc`,"error");return}Y?v(Oe===p?null:{path:Oe,hash:R}):ba(Oe,R)},_a=S=>{let R;try{R=new URL(S)}catch{return}if(R.protocol!=="https:"&&R.protocol!=="http:"){F(`Zana opens web links only, not ${R.protocol} links`,"error");return}let Y=globalThis.navigator?.userActivation;if(Y&&!Y.isActive){ae({kind:"blocked",message:`The page tried to open ${R.href} without a click`});return}globalThis.open(R.href,"_blank","noopener,noreferrer")},Wt=(S,R)=>{let Y=ce.current,ee=fe.current;if(!i||!S||!R||!Y||!ee){q(null);return}let Oe=Y.getBoundingClientRect(),da=ee.getBoundingClientRect(),$s=Oe.top-da.top+ee.scrollTop+R.top-36,Vs=Oe.left-da.left+ee.scrollLeft+(R.left+R.right)/2;q({text:S,top:Math.max(4,$s),left:Math.min(Math.max(80,Vs),Math.max(80,ee.scrollWidth-80))})},Rt=(S,R)=>{switch(S.type){case"ready":K.current=!0,je({type:"highlight",quotes:[...y.current]},R),Q.current!==null&&je({type:"focus",quote:Q.current},R),Q.current=null,Ca();break;case"fetch":{!me.current.has(S.path)&&me.current.size<500&&(me.current.set(S.path,r.find(ee=>ee.path===S.path)?.revision??0),Ca()),_.add(async()=>{let ee=null;try{ee=await c.readPageFile(e,S.path)}catch{ee=null}te.current===R&&je({type:"file",id:S.id,file:ee},R)})||je({type:"file",id:S.id,file:null},R);break}case"navigate":na(S.path,S.hash,S.redirect);break;case"open":_a(S.url);break;case"problem":ae(S.problem);break;case"selection":Wt(S.text,S.rect);break;case"anchors":de.current=S.missing,Ca();break;case"focused":S.found||F("That passage is no longer on this page");break;case"scroll":Le.current.scroll={x:S.x,y:S.y};break;case"hash":Le.current.hash=S.hash;break;case"storage":ol(e,S.entries);break;default:break}},Ft=T(Rt);Ft.current=Rt,O(()=>{let S=R=>{let Y=ce.current,ee=R.ports?.[0];!Y||!ee||R.source!==Y.contentWindow||!cs(R.data)||(te.current?.close(),te.current=ee,K.current=!1,de.current=[],me.current=new Map,_.clear(),P([]),v(null),q(null),ee.onmessage=Oe=>{if(te.current!==ee)return;let da=us(Oe.data);da&&Ft.current(da,ee)})};return globalThis.addEventListener("message",S),()=>{globalThis.removeEventListener("message",S),te.current?.close(),te.current=null,_.clear(),he.current&&clearTimeout(he.current)}},[_]);let ya=n.join("\0");O(()=>{K.current&&je({type:"highlight",quotes:ya?ya.split("\0"):[]})},[ya]),O(()=>{if(!u)return;let S={focusQuote(R){return K.current&&te.current?je({type:"focus",quote:R}):Q.current=R,!0}};return u.current=S,()=>{u.current===S&&(u.current=null)}},[u]);let sa=[...X(()=>f?[...f.page.missing.map(S=>({kind:"missing",message:`The page uses ${S}, which is not a file in this doc`})),...f.page.warnings.map(S=>({kind:"blocked",message:S}))]:[],[f]),...B],H=async()=>{try{let{url:S}=await c.pageLink(e,p);globalThis.open(S,"_blank","noopener,noreferrer")}catch(S){F(U(S),"error")}},Ge=S=>{!C||!S||(S(C.text),q(null),je({type:"clear-selection"}))},Kt=ms.find(S=>S.id===L).width;return d("div",{className:"dd-html-stage",onMouseDown:S=>{S.target.closest?.(".dd-selection-chip")||q(null)},children:[d("div",{className:"dd-html-toolbar",children:[d("div",{className:"dd-html-status",children:[h?o(Z,{size:12,label:"Rendering page"}):null,t?o("span",{className:"dd-muted",children:"Unsaved changes"}):null]}),o("div",{className:"dd-html-widths",role:"toolbar","aria-label":"Preview width",children:ms.map(S=>o("button",{type:"button",className:`icon-btn${L===S.id?" on":""}`,title:S.label,"aria-label":S.label,"aria-pressed":L===S.id,onClick:()=>I(S.id),children:o(S.icon,{size:14,"aria-hidden":!0})},S.id))}),d("div",{className:"dd-html-actions",children:[sa.length?o(De,{open:E,onClose:()=>x(!1),className:"dd-page-problems",anchor:d("button",{type:"button",className:"dd-page-badge","aria-label":`${sa.length} page ${sa.length===1?"problem":"problems"}`,"aria-expanded":E,onClick:()=>x(S=>!S),children:[o(ke,{size:13,"aria-hidden":!0}),sa.length]}),children:o("ul",{"aria-label":"Page problems",children:sa.map((S,R)=>d("li",{className:`dd-page-problem dd-page-problem-${S.kind}`,children:[o("span",{className:"dd-page-problem-kind",children:tl[S.kind]}),o("span",{className:"dd-page-problem-message",children:S.message}),S.source?d("span",{className:"dd-muted dd-page-problem-source",children:[S.source,S.line?`:${S.line}`:""]}):null]},R))})}):null,t?null:o(z,{icon:ia,label:"Open in browser",onClick:()=>{H()}})]})]}),A?d("div",{className:"dd-banner dd-banner-info",children:[o(Qa,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:["This page redirects to ",o("code",{children:A.path}),"."]}),o("button",{type:"button",className:"btn",onClick:()=>{v(null),ba(A.path,A.hash)},children:"Go there"}),o(z,{icon:ie,label:"Dismiss",onClick:()=>v(null)})]}):null,M?d("div",{className:"dd-banner dd-banner-warn",children:[o(ke,{size:14,"aria-hidden":!0}),o("span",{className:"dd-banner-text",children:"This draft is too large to preview. Save it to see the page."})]}):null,N?o("div",{className:"dd-banner dd-banner-error",children:N}):null,d("div",{className:"dd-html-viewport",ref:fe,children:[f?o("iframe",{ref:ce,className:`dd-html-frame${Kt?" dd-html-frame-device":""}`,style:Kt?{width:Kt}:void 0,sandbox:"allow-scripts allow-forms",srcDoc:f.srcDoc,title:p},f.id):N||M?null:o("div",{className:"dd-center",children:o(Z,{label:"Rendering page"})}),C?d("div",{className:"dd-selection-chip",style:{top:C.top,left:C.left},children:[d("button",{type:"button",onClick:()=>Ge(i),children:[o(ca,{size:13,"aria-hidden":!0}),"Comment"]}),l?d("button",{type:"button",onClick:()=>Ge(l),children:[o(se,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})]})}var il=24,ul=64,Na=new Map;function cl(e,a){for(Na.delete(e),Na.set(e,a);Na.size>ul;)Na.delete(Na.keys().next().value)}function fl(e,a,r){let t=$(),n=X(()=>{let c=new Map(a.map(p=>[p.path,p]));return r.map(p=>c.get(p)).filter(p=>!!p&&(p.kind==="image"||p.kind==="svg")).slice(0,il)},[a,r]),s=n.map(c=>`${c.path}@${c.revision}`).join("|"),i=T(n);i.current=n;let[l,u]=b(new Map);return O(()=>{let c=i.current,p=!1,L=new Map,I=[];for(let f of c){let m=Na.get(`${e}\0${f.path}\0${f.revision}`);m?L.set(f.path,m):I.push(f)}if(u(L),!!I.length)return Promise.all(I.map(async f=>{try{let m=await t.readFile(e,f.path),h=to(m);h&&(cl(`${e}\0${m.path}\0${m.revision}`,h),L.set(m.path,h))}catch{}})).then(()=>{p||u(new Map(L))}),()=>{p=!0}},[t,e,s]),l}function Tt({docId:e,file:a,files:r,quotes:t=[],onOpenPath:n,onQuote:s,onAskAbout:i,handleRef:l,draft:u=!1}){let c=T(null),p=T(null),L=T({}),[I,f]=b(null),m=X(()=>a.kind==="markdown"?Bn(a.path,a.content):[],[a.path,a.content,a.kind]),h=fl(e,r,m),D=X(()=>new Set(r.map(x=>x.path)),[r]),N=X(()=>a.kind==="markdown"?Nn(a.path,a.content,h):a.kind==="mermaid"?oo(a.content,"mermaid"):a.kind==="code"?En(a.path,a.content):null,[a.kind,a.path,a.content,h]),w=t.join("\0");O(()=>{let x=p.current,A=L.current,v=w?w.split("\0"):[];if(!x||!v.length){xa(zt,A,[]);return}let C=()=>xa(zt,A,[...io(x,v).values()]),q=setTimeout(C,60),G=typeof MutationObserver=="function"?new MutationObserver(()=>C()):null;return G?.observe(x,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(q),G?.disconnect(),xa(zt,A,[]),xa(jt,A,[])}},[w,N,a.kind,a.content]);let M=a.kind!=="html";O(()=>{if(!(!l||!M))return l.current={focusQuote(x){let A=p.current,v=A?io(A,[x]).get(x):void 0;return v?(v.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),xa(jt,L.current,[v]),setTimeout(()=>xa(jt,L.current,[]),1800),!0):!1}},()=>{l.current=null}},[l,M]);let k=x=>{let A=x.target?.closest?.("a");if(!A)return;let v=A.getAttribute("href")??"";if(v.startsWith("#")){x.preventDefault(),x.stopPropagation();return}let C=wt(a.path,v);if(!C)return;x.preventDefault(),x.stopPropagation();let q=[...D].find(G=>G.startsWith(`${C}/`));D.has(C)?n?.(C):q?n?.(q):F(`${C} is not a file in this design doc`,"error")},B=()=>{if(!s)return;let x=globalThis.getSelection?.(),A=c.current,v=x?.toString().trim()??"";if(!x||x.isCollapsed||!v||!A||!p.current?.contains(x.anchorNode)){f(null);return}let C=x.getRangeAt(0).getBoundingClientRect(),q=A.getBoundingClientRect();f({text:v.slice(0,500),top:Math.max(4,C.top-q.top+A.scrollTop-36),left:Math.min(Math.max(80,C.left-q.left+C.width/2),Math.max(80,q.width-80))})},P=x=>{!I||!x||(x(I.text),f(null),globalThis.getSelection?.()?.removeAllRanges())},E;if(a.kind==="html")E=o(gs,{docId:e,file:a,files:r,draft:u,quotes:t,onOpenPath:n,onQuote:s,onAskAbout:i,handleRef:l},`${e}\0${a.path}`);else if(a.kind==="image"||a.kind==="svg"){let x=to(a);E=o("div",{className:"dd-image-stage",children:x?o("img",{src:x,alt:a.path}):o("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else a.kind==="font"?E=o("div",{className:"dd-image-stage",children:o("span",{className:"dd-muted",children:"Font file. Pages in this doc load it through @font-face."})}):N!==null?E=o("div",{className:`dd-prose dd-prose-${a.kind}`,ref:p,onClickCapture:k,children:a.kind==="markdown"&&!a.content.trim()?o("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):o(za,{content:N})}):E=o("div",{className:"dd-prose",ref:p,children:o("pre",{className:"dd-plain",children:a.content})});return d("div",{className:`dd-preview dd-preview-${a.kind}`,ref:c,onMouseUp:B,onMouseDown:x=>{x.target.closest?.(".dd-selection-chip")||f(null)},children:[E,I?d("div",{className:"dd-selection-chip",style:{top:I.top,left:I.left},children:[d("button",{type:"button",onClick:()=>P(s),children:[o(ca,{size:13,"aria-hidden":!0}),"Comment"]}),i?d("button",{type:"button",onClick:()=>P(i),children:[o(se,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function hs(e,a,r=1500){let t=e.split(`
`),n=a.split(`
`),s=0;for(;s<t.length&&s<n.length&&t[s]===n[s];)s+=1;let i=t.length,l=n.length;for(;i>s&&l>s&&t[i-1]===n[l-1];)i-=1,l-=1;let u=t.slice(s,i),c=n.slice(s,l);if(u.length>r||c.length>r)return null;let p=c.length+1,L=new Uint32Array((u.length+1)*p);for(let h=u.length-1;h>=0;h-=1)for(let D=c.length-1;D>=0;D-=1)L[h*p+D]=u[h]===c[D]?L[(h+1)*p+D+1]+1:Math.max(L[(h+1)*p+D],L[h*p+D+1]);let I=[],f=0,m=0;for(;f<u.length&&m<c.length;)u[f]===c[m]?(I.push({type:"same",text:u[f]}),f+=1,m+=1):L[(f+1)*p+m]>=L[f*p+m+1]?(I.push({type:"del",text:u[f]}),f+=1):(I.push({type:"add",text:c[m]}),m+=1);for(;f<u.length;)I.push({type:"del",text:u[f++]});for(;m<c.length;)I.push({type:"add",text:c[m++]});return[...t.slice(0,s).map(h=>({type:"same",text:h})),...I,...t.slice(i).map(h=>({type:"same",text:h}))]}function xs(e,a=3){let r=new Uint8Array(e.length);e.forEach((s,i)=>{if(s.type!=="same")for(let l=Math.max(0,i-a);l<=Math.min(e.length-1,i+a);l+=1)r[l]=1});let t=[],n=0;for(;n<e.length;)if(r[n]){let s=[];for(;n<e.length&&r[n];)s.push(e[n++]);t.push({type:"lines",lines:s})}else{let s=0;for(;n<e.length&&!r[n];)s+=1,n+=1;t.push({type:"gap",count:s})}return t}function Ls(e){let a=0,r=0;for(let t of e)t.type==="add"?a+=1:t.type==="del"&&(r+=1);return{added:a,removed:r}}var pl={create:Re,write:Xe,delete:Ke,rename:pt},Is={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function Cs({doc:e,activePath:a,now:r,selectedId:t,onSelect:n}){let s=$(),[i,l]=re("history-scope","file"),u=i==="file"?a:null,c=Ye(`${e.id}\0${u??"*"}\0${e.revision}`,()=>s.history(e.id,{...u?{path:u}:{},limit:100}));return d("div",{className:"dd-rail-pane dd-history",children:[o("div",{className:"dd-rail-toolbar",children:d("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[o("button",{type:"button",className:i==="file"?"on":"",onClick:()=>l("file"),disabled:!a,children:"This file"}),o("button",{type:"button",className:i==="all"?"on":"",onClick:()=>l("all"),children:"All files"})]})}),d("div",{className:"dd-rail-scroll",children:[c.error?o("div",{className:"dd-banner dd-banner-error",children:c.error}):null,!c.data&&c.loading?o("div",{className:"dd-center",children:o(Z,{label:"Loading history"})}):null,c.data&&!c.data.length?o(Ae,{icon:we,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,o("ol",{className:"dd-history-list",children:c.data?.map(p=>{let L=pl[p.op];return o("li",{children:d("button",{type:"button",className:`dd-history-row${t===p.id?" on":""}`,onClick:()=>n(p),children:[o(L,{size:13,className:`dd-op dd-op-${p.op}`,"aria-hidden":!0}),d("span",{className:"dd-history-main",children:[d("span",{className:"dd-history-title",children:[Is[p.op],u?null:o("span",{className:"dd-history-path",children:p.path}),d("span",{className:"dd-history-rev",children:["rev ",p.revision]})]}),p.note?o("span",{className:"dd-history-note",children:p.note}):null,d("span",{className:"dd-history-meta",children:[o(ye,{actor:p.actor}),o(pe,{at:p.createdAt,now:r})]})]})]})},p.id)})})]})]})}async function ml(e,a,r){let t=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||t.encoding==="base64")return{after:t,before:null,pruned:!1};if(r.op==="delete")return{after:t,before:t.content,pruned:!1};let n=(await e.history(a,{path:r.path,limit:100})).find(i=>i.id<r.id);if(!n)return{after:t,before:null,pruned:!0};if(n.op==="delete")return{after:t,before:"",pruned:!1};let s=await e.revision(a,n.id);return{after:t,before:s.content,pruned:!1}}function bs({doc:e,revision:a,onClose:r,onOpenPath:t}){let n=$(),[s,i]=b(a.op==="write"||a.op==="delete"?"changes":"full"),[l,u]=b(!1),[c,p]=b(null),L=Ye(`${e.id}\0${a.id}`,()=>ml(n,e.id,a)),I=ha(a.path),f=e.files.find(k=>k.path===a.path)??null,m=f?.revision===a.revision&&a.op!=="delete",h=X(()=>{let k=L.data;if(!k||k.before===null||ze(I))return null;let B=hs(k.before,a.op==="delete"?"":k.after.content);return B?{hunks:xs(B),stats:Ls(B)}:"too-large"},[L.data,a.op,I]),D=async()=>{u(!0);try{let k=await n.restore(e.id,a.id,f?.revision??0);F(`Restored ${k.path} to revision ${a.revision} (now rev ${k.revision})`),t(k.path),r()}catch(k){F(`Could not restore: ${U(k)}`,"error")}finally{u(!1)}},N=()=>{if(f){D();return}p({title:`Recreate ${a.path}?`,body:d(W,{children:[o("code",{children:a.path})," is no longer in this doc",a.op==="delete"?"":"; it may have been renamed",". Recreate it with the content of revision ",a.revision,"?"]}),confirmLabel:"Recreate",run:()=>{D()}})},w=h!==null,M=s==="full"||!w;return d("div",{className:"dd-revision",children:[d("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[o(we,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[o("strong",{children:Is[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",o(ye,{actor:a.actor})," ",o(pe,{at:a.createdAt,now:Date.now()}),a.renamedFrom?d(W,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?d("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),w?d("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[o("button",{type:"button",className:s==="changes"?"on":"",onClick:()=>i("changes"),children:"Changes"}),o("button",{type:"button",className:s==="full"?"on":"",onClick:()=>i("full"),children:"Full file"})]}):null,d("button",{type:"button",className:"btn",disabled:m||l||!L.data,onClick:N,children:[o(Ue,{size:12,"aria-hidden":!0})," ",m?"Current":f?"Restore":"Recreate file"]}),o(z,{icon:ie,label:"Close revision",onClick:r})]}),d("div",{className:"dd-revision-body",children:[L.error?o("div",{className:"dd-banner dd-banner-error",children:L.error}):null,L.data?M?d(W,{children:[L.data.pruned?o("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,h==="too-large"?o("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,o(Tt,{docId:e.id,file:{path:a.path,kind:I,content:L.data.after.content,encoding:L.data.after.encoding},files:e.files,onOpenPath:t,draft:!0})]}):h&&h!=="too-large"?d("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[d("div",{className:"dd-diff-stats",children:[d("span",{className:"dd-diff-added",children:["+",h.stats.added]}),d("span",{className:"dd-diff-removed",children:["\u2212",h.stats.removed]}),o("span",{className:"dd-muted",children:ga(a.size)})]}),h.hunks.map((k,B)=>k.type==="gap"?d("div",{className:"dd-diff-gap",children:["\u22EF ",k.count," unchanged line",k.count===1?"":"s"]},B):k.lines.map((P,E)=>d("div",{className:`dd-diff-line dd-diff-${P.type}`,role:"row",children:[o("span",{className:"dd-diff-sign","aria-hidden":!0,children:P.type==="add"?"+":P.type==="del"?"\u2212":" "}),o("span",{className:"dd-diff-text",children:P.text||" "})]},`${B}-${E}`))),h.stats.added+h.stats.removed===0?o("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:L.loading?o("div",{className:"dd-center",children:o(Z,{label:"Loading revision"})}):null]}),c?o(Ee,{request:c,onClose:()=>p(null)}):null]})}var gl=[{id:"preview",label:"Preview",icon:et},{id:"edit",label:"Edit",icon:fa},{id:"split",label:"Split",icon:Ve}];function hl(e,a,r){let t=hn(e,a,r),n=T(null);t.data&&(n.current=t.data);let s=n.current&&n.current.path===a?n.current:null;return{file:t.data??s,error:t.error,loading:t.loading}}function xl(e,a,r){let[t,n]=b(null),s=T({path:e,revision:a});return O(()=>{let i=s.current;if(s.current={path:e,revision:a},i.path!==e||a===null||i.revision===null||a<=i.revision||r?.kind!=="agent")return;n(r.label);let l=setTimeout(()=>n(null),4e3);return()=>clearTimeout(l)},[e,a,r]),t}function ys({doc:e,path:a,mode:r,onModeChange:t,railOpen:n,onToggleRail:s,revision:i,onCloseRevision:l,previewHandle:u,onOpenPath:c,onQuote:p,onAskAbout:L,onEditorState:I,leading:f}){let m=e.files.find(x=>x.path===a)??null,{file:h,error:D,loading:N}=hl(e.id,a,m?.revision??null),w=xl(a,m?.revision??null,m?.updatedBy),M=!m||!ze(m.kind),k=M?r:"preview",B=X(()=>e.comments.filter(x=>x.status==="open"&&x.path===a&&x.quote).map(x=>x.quote),[e.comments,a]),P=a.lastIndexOf("/");O(()=>{k==="preview"&&I({dirty:!1,saving:!1})},[k,I]);let E;return i?E=o(bs,{doc:e,revision:i,onClose:l,onOpenPath:c},i.id):!m&&!(h&&k!=="preview")?E=d("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}):h?k==="preview"?E=o(Tt,{docId:e.id,file:h,files:e.files,quotes:B,onOpenPath:c,onQuote:p,onAskAbout:L,handleRef:u}):E=o(rs,{docId:e.id,file:h,removed:!m,split:k==="split",onStateChange:I,renderPreview:x=>o(Tt,{docId:e.id,file:{...h,content:x},files:e.files,onOpenPath:c,draft:x!==h.content})},`${e.id}\0${a}`):E=o("div",{className:"dd-center",children:D?o("div",{className:"dd-banner dd-banner-error",children:D}):N?o(Z,{label:"Loading file"}):null}),d("section",{className:"dd-file-pane","aria-label":a,children:[d("div",{className:"dd-file-toolbar",children:[f,m?o(ka,{kind:m.kind}):null,d("span",{className:"dd-file-path",title:a,children:[P>0?o("span",{className:"dd-file-dir",children:a.slice(0,P+1)}):null,o("span",{className:"dd-file-name",children:a.slice(P+1)})]}),m?d("span",{className:"dd-file-meta",children:["rev ",m.revision," \xB7 ",ga(m.size)," \xB7 ",o(ye,{actor:m.updatedBy})," ",o(pe,{at:m.updatedAt,now:Date.now()})]}):null,w?d("span",{className:"dd-flash",role:"status",children:[o(ge,{size:12,"aria-hidden":!0})," Updated by ",w]}):null,o("span",{className:"dd-spacer"}),i?null:o("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:gl.map(x=>d("button",{type:"button",className:k===x.id?"on":"",disabled:!M&&x.id!=="preview",onClick:()=>t(x.id),title:x.label,"aria-pressed":k===x.id,children:[o(x.icon,{size:13,"aria-hidden":!0}),o("span",{className:"dd-mode-label",children:x.label})]},x.id))}),o(z,{icon:mt,label:n?"Hide comments & history":"Show comments & history",active:n,onClick:s})]}),o("div",{className:"dd-file-body",children:E})]})}function Cl(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,t=>t.toUpperCase());switch(ha(e)){case"markdown":return`# ${r}

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
`;default:return""}}function bl(e){let a=e.trim().replace(/^\/+/,"");return vt(a)?a:`${a}.md`}function yl(e){return new Promise((a,r)=>{let t=new FileReader,n=ze(ha(e.name));t.onerror=()=>r(t.error??new Error("could not read the file")),t.onload=()=>{let s=String(t.result??"");a(n?{content:s.slice(s.indexOf(",")+1),encoding:"base64"}:{content:s})},n?t.readAsDataURL(e):t.readAsText(e)})}function Ss({initial:e,placeholder:a,onSubmit:r,onCancel:t}){let[n,s]=b(e),i=T(!1),l=c=>{c?.preventDefault(),!i.current&&(i.current=!0,n.trim()&&n.trim()!==e?r(n.trim()):t())};return o("form",{className:"dd-tree-input",onSubmit:l,children:o("input",{className:"dd-input",value:n,placeholder:a,"aria-label":a,onChange:c=>s(c.target.value),onKeyDown:c=>{c.key==="Escape"&&(c.preventDefault(),i.current=!0,t())},onBlur:()=>l(),autoFocus:!0,onFocus:c=>{let p=c.target.value.lastIndexOf("."),L=c.target.value.lastIndexOf("/")+1;c.target.setSelectionRange(L,p>L?p:c.target.value.length)}})})}function Sl({doc:e,file:a,name:r,depth:t,active:n,renaming:s,onOpen:i,onRename:l,onRenameDone:u,onDelete:c}){let p=$(),[L,I]=b(!1),f=e.entryPath===a.path,m=e.comments.filter(h=>h.status==="open"&&h.path===a.path).length;return s?o("div",{className:"dd-tree-row",style:{paddingLeft:8+t*14},children:o(Ss,{initial:a.path,placeholder:"New path",onSubmit:h=>u(h),onCancel:()=>u(null)})}):d("div",{className:`dd-tree-row dd-tree-file${n?" on":""}`,style:{paddingLeft:8+t*14},children:[d("button",{type:"button",className:"dd-tree-open",onClick:i,onDoubleClick:l,title:`${a.path} \xB7 ${ga(a.size)} \xB7 rev ${a.revision}`,"aria-current":n?"page":void 0,children:[o(ka,{kind:a.kind}),o("span",{className:"dd-tree-name",children:r}),f?o(Ze,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,m?o("span",{className:"dd-tree-badge",title:`${m} open comment${m===1?"":"s"}`,children:m}):null]}),d(De,{open:L,onClose:()=>I(!1),className:"dd-menu",anchor:o(z,{icon:Me,label:`Actions for ${a.path}`,size:13,active:L,onClick:()=>I(!L)}),children:[o(ue,{icon:fa,label:"Rename or move",onSelect:()=>{I(!1),l()}}),f||ze(a.kind)?null:o(ue,{icon:Ct,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{I(!1),p.update(e.id,{entryPath:a.path}).catch(h=>F(U(h),"error"))}}),o(ue,{icon:Ie,label:"Delete",danger:!0,onSelect:()=>{I(!1),c()}})]})]})}function ho({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n,onHide:s}){let i=$(),[l,u]=b(new Set),[c,p]=b(!1),[L,I]=b(null),[f,m]=b(null),h=T(null),D=Hn(e.files),N=e.files.length>=500,w=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",M=async A=>{p(!1);let v=bl(A);if(e.files.some(C=>C.path===v)){r(v);return}if(ze(ha(v))){F("Use \u201CAdd files\u201D to upload images and fonts.","error");return}try{await i.writeFile(e.id,{path:v,content:Cl(v)}),r(v)}catch(C){F(`Could not create ${v}: ${U(C)}`,"error")}},k=(A,v)=>{if(I(null),!v||v===A)return;let C=async()=>{try{let q=await i.renameFile(e.id,A,v);t(A,q.path)}catch(q){F(`Could not rename ${A}: ${U(q)}`,"error")}};if(!n?.(A)){C();return}m({title:"Discard unsaved changes?",body:d(W,{children:["Renaming ",o("code",{children:A})," drops your unsaved edits to it. Save them first to keep them."]}),confirmLabel:"Discard and rename",danger:!0,run:C})},B=async A=>{for(let v of Array.from(A??[])){let C=ha(v.name),q=ze(C)?2097152:2097152;if(v.size>q){F(`${v.name} is larger than ${ga(q)}`,"error");continue}let G=C==="image"||C==="svg"||C==="font",oe=`${w||(G?"assets/":"")}${v.name.replace(/[^\w.-]+/g,"-")}`;try{let ce=await yl(v);await i.writeFile(e.id,{path:oe,...ce});let fe=oe.slice(w.length);F(C==="font"||!G?`Added ${oe}`:`Added ${oe}. Reference it with ![${v.name}](${fe})`)}catch(ce){F(`Could not add ${v.name}: ${U(ce)}`,"error")}}h.current&&(h.current.value="")},P=A=>m({title:"Delete file",body:d(W,{children:["Delete ",o("code",{children:A.path}),"? Its history is kept, so it can be recreated from History.",n?.(A.path)?" Your unsaved edits to it will be lost.":null]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await i.deleteFile(e.id,A.path),t(A.path,null)}catch(v){F(`Could not delete ${A.path}: ${U(v)}`,"error")}}}),E=A=>u(v=>{let C=new Set(v);return C.has(A)?C.delete(A):C.add(A),C}),x=(A,v)=>A.map(C=>{if(C.kind==="folder"){let q=!l.has(C.path);return d("div",{role:"group","aria-label":C.name,children:[d("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+v*14},onClick:()=>E(C.path),"aria-expanded":q,children:[q?o(le,{size:12,"aria-hidden":!0}):o(la,{size:12,"aria-hidden":!0}),q?o(_e,{size:14,"aria-hidden":!0}):o(st,{size:14,"aria-hidden":!0}),o("span",{className:"dd-tree-name",children:C.name})]}),q?x(C.children,v+1):null]},`d:${C.path}`)}return o(Sl,{doc:e,file:C.file,name:C.name,depth:v,active:C.path===a,renaming:L===C.path,onOpen:()=>r(C.path),onRename:()=>I(C.path),onRenameDone:q=>{k(C.path,q)},onDelete:()=>P(C.file)},`f:${C.path}`)});return d("nav",{className:"dd-tree","aria-label":"Files",children:[d("div",{className:"dd-tree-head",children:[o("span",{className:"dd-section-label",children:"Files"}),o("span",{className:"dd-tree-count",children:e.files.length}),o("span",{className:"dd-spacer"}),o(z,{icon:Re,label:"Add files",size:13,disabled:N,onClick:()=>h.current?.click()}),o(z,{icon:be,label:"New file",size:13,disabled:N,onClick:()=>p(!0)}),s?o(z,{icon:Fe,label:"Hide files",size:13,onClick:s}):null,o("input",{ref:h,type:"file",multiple:!0,hidden:!0,onChange:A=>{B(A.target.files)}})]}),d("div",{className:"dd-tree-scroll",role:"tree",children:[x(D,0),c?o("div",{className:"dd-tree-row",style:{paddingLeft:8},children:o(Ss,{initial:w,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:A=>{M(A)},onCancel:()=>p(!1)})}):null]}),f?o(Ee,{request:f,onClose:()=>m(null)}):null]})}var Pl=560,vl=640,wl=1100,$t=[Pl,vl,wl];function kl(e,a){let r=t=>!!t&&e.files.some(n=>n.path===t);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function Al({doc:e,tab:a,onTab:r,activePath:t,now:n,pendingQuote:s,onClearQuote:i,commentDraft:l,onCommentDraft:u,onFocusComment:c,selectedRevision:p,onSelectRevision:L,openInPanel:I,onClose:f}){let m=[{id:"comments",label:"Comments",icon:Ce,count:e.openComments},{id:"history",label:"History",icon:we},{id:"agents",label:"Agents",icon:ge,count:e.threads.length}];return d("aside",{className:"dd-rail","aria-label":"Comments, history and agents",children:[d("div",{className:"dd-rail-tabs",role:"tablist",children:[m.map(h=>d("button",{type:"button",role:"tab","aria-selected":a===h.id,className:`dd-rail-tab${a===h.id?" on":""}`,onClick:()=>r(h.id),children:[o(h.icon,{size:13,"aria-hidden":!0}),h.label,h.count?o("span",{className:"dd-count",children:h.count}):null]},h.id)),f?d(W,{children:[o("span",{className:"dd-spacer"}),o(z,{icon:ie,label:"Close",onClick:f,size:13})]}):null]}),a==="comments"?o(Xn,{doc:e,activePath:t,now:n,pendingQuote:s,onClearQuote:i,draft:l,onDraft:u,onFocusComment:c}):a==="history"?o(Cs,{doc:e,activePath:t,now:n,selectedId:p,onSelect:L}):o(Pn,{doc:e,now:n,openInPanel:I})]})}function Dl({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let[s,i]=b(!1),l=e.files.find(u=>u.path===a);return o(De,{open:s,onClose:()=>i(!1),align:"start",className:"dd-switcher-pop",anchor:d("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":s,onClick:()=>i(!s),title:"Files in this doc",children:[l?o(ka,{kind:l.kind}):null,d("span",{children:[e.files.length," files"]}),o(le,{size:12,"aria-hidden":!0})]}),children:o(ho,{doc:e,activePath:a,onOpen:u=>{i(!1),r(u)},onPathChanged:t,hasDraft:n})})}function Vt({docId:e,path:a,onOpenPath:r,layout:t,contextProjectId:n=null,onDeleted:s,headerExtra:i}){let l=qt(e),u=Ne(),c=wa(),p=t==="compact",[L,I]=xn($t),f=!p&&(I??$t.length)<1,m=!p&&(I??$t.length)>=2,h=!p&&(I??$t.length)>=3,[D,N]=re("tree",!0),w=m&&D,[M,k]=re("view-mode","preview"),[B,P]=re("rail",!0),[E,x]=re("rail-compact",!1),A=h?B:E,v=h?P:x,[C,q]=re("rail-tab","comments"),[G,oe]=b(null),[ce,fe]=b(""),[te,K]=b(null),[Q,de]=b(null),[me,he]=b(null),[xe,Le]=b(null),y=T({dirty:!1,saving:!1}),[_,j]=b(!1),J=T(null),Se=T(null),Ia=T(null),ne=l.data,Oa=ne?kl(ne,a):null,qa=!!ne&&!!Se.current&&!ne.files.some(H=>H.path===Se.current);qa||(Ia.current=null);let ae=qa&&(_||Ia.current===Se.current)?Se.current:Oa;Se.current=ae;let Ha=!!ne&&!!l.error&&un(l.error),ra=T({onDeleted:s,title:ne?.title??""});ra.current={onDeleted:s,title:ne?.title??ra.current.title};let Ca=Te(H=>{y.current.saving&&!H.saving&&!H.dirty&&(Ia.current=Se.current),y.current=H,j(H.dirty)},[]),ba=Te(()=>{y.current={dirty:!1,saving:!1},Ia.current=null,j(!1)},[]),na=Te(H=>{if(!y.current.dirty){H();return}he({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{ba(),H()}})},[ba]),_a=Te(H=>{if(H===ae){de(null);return}na(()=>{de(null),r(H)})},[ae,na,r]);if(O(()=>{Ha&&(F(`\u201C${ra.current.title}\u201D was deleted`),ra.current.onDeleted())},[Ha]),O(()=>{if(!xe||xe.path!==ae||Q)return;let H=[80,300,900].map(Ge=>setTimeout(()=>{J.current?.focusQuote(xe.quote)&&(H.forEach(clearTimeout),Le(null))},Ge));return()=>H.forEach(clearTimeout)},[xe,ae,Q]),!ne)return o("div",{className:"dd-doc dd-center",children:l.error?o(Ae,{icon:ve,title:"This design doc could not be opened",children:l.error}):o(Z,{label:"Loading design doc"})});let Wt=H=>na(()=>{de(null),H.path&&H.path!==ae&&r(H.path),M!=="preview"&&k("preview"),h||v(!1),H.quote&&Le({path:H.path??ae??"",quote:H.quote,nonce:Date.now()})}),Rt=H=>na(()=>{de(H),H.path!==ae&&ne.files.some(Ge=>Ge.path===H.path)&&r(H.path)}),Ft=H=>{H==="preview"?na(()=>k(H)):k(H)},ya=(H,Ge)=>{H===ae&&(ba(),r(Ge,!0))},Xt=H=>H===ae&&y.current.dirty,sa=o(Al,{doc:ne,tab:C,onTab:q,activePath:ae,now:c,pendingQuote:G,onClearQuote:()=>oe(null),commentDraft:ce,onCommentDraft:fe,onFocusComment:Wt,selectedRevision:Q?.id??null,onSelectRevision:Rt,openInPanel:!p,onClose:h?void 0:()=>v(!1)});return d("div",{ref:L,className:`dd-doc dd-doc-${t}${f?" dd-doc-narrow":""}${A?" dd-rail-open":""}${h?"":" dd-rail-floating"}`,children:[o(os,{doc:ne,projects:u.data??[],compact:p,collapsible:f,onDeleted:s,actions:d(W,{children:[i,o($n,{doc:ne,compact:p||f}),o(vn,{doc:ne,activePath:ae,request:te,contextProjectId:n,compact:p||f})]})}),d("div",{className:"dd-doc-body",children:[w?o(ho,{doc:ne,activePath:ae,onOpen:_a,onPathChanged:ya,hasDraft:Xt,onHide:()=>N(!1)}):null,ae?o(ys,{doc:ne,path:ae,mode:M,onModeChange:Ft,railOpen:A,onToggleRail:()=>v(!A),revision:Q,onCloseRevision:()=>de(null),previewHandle:J,onOpenPath:_a,onQuote:H=>{oe({path:ae,text:H}),q("comments"),v(!0)},onAskAbout:H=>K({prompt:`About this passage in ${ae}:
> ${H.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:Ca,leading:w?null:d(W,{children:[m?o(z,{icon:Be,label:"Show files",onClick:()=>N(!0)}):null,o(Dl,{doc:ne,activePath:ae,onOpen:_a,onPathChanged:ya,hasDraft:Xt})]})}):o("div",{className:"dd-file-pane dd-center",children:o(Ae,{icon:ve,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),A?sa:null]}),me?o(Ee,{request:me,onClose:()=>he(null)}):null]})}var ta=globalThis.__ZCC_HOST_REACT_DOM__;if(ta==null)throw new Error("host react-dom is not available");var Ps=ta.createPortal,jh=ta.flushSync,Gh=ta.hydrate,$h=ta.render,Vh=ta.unmountComponentAtNode,Wh=ta.findDOMNode,Xh=ta.version;var Mt=null,xo=new Set;function ws(){xo.forEach(e=>e())}function Tl(e){Mt!==e&&(Mt=e,ws())}function Ml(e){Mt===e&&(Mt=null,ws())}function vs(e){return Mt===e}function Rl(e){return xo.add(e),()=>xo.delete(e)}function Lo(){let e=T(null);e.current||(e.current=Symbol("popover"));let a=e.current;return[Oo(Rl,()=>vs(a),()=>!1),n=>{(typeof n=="function"?n(vs(a)):n)?Tl(a):Ml(a)}]}var Fl=typeof window>"u"?O:Pa,oa=8,ks=4,Bl=160,Nl=360,El=.55;function Ol(e,a,r){let t=Math.max(e.width,r),n=e.left;n+t>a.width-oa&&(n=e.right-t),n<oa&&(n=oa),n+t>a.width-oa&&(n=Math.max(oa,a.width-t-oa));let s=a.height-e.bottom-oa,i=e.top-oa,l=s<Bl&&i>s,u=Math.max(120,l?i:s),c=Math.min(Nl,Math.floor(a.height*El)),p=Math.min(u,c);return l?{left:n,width:t,maxHeight:p,bottom:a.height-e.top+ks}:{left:n,width:t,maxHeight:p,top:e.bottom+ks}}function ql(e,a){if(e.sticky)return!0;let r=a.trim().toLowerCase();return r?`${e.label} ${e.compactLabel??""} ${e.description??""}`.toLowerCase().includes(r):!0}function Hl(e,a,r=!0){let t=[],n=[];for(let s of e){if(s.sticky){n.push(s);continue}(!r||ql(s,a))&&t.push(s)}return{items:t,sticky:n}}function As({option:e,previousGroup:a,optionId:r,selected:t,active:n,onHover:s,onSelect:i}){return d("div",{children:[e.group&&e.group!==a&&o("div",{className:"launch-model-picker-group-label",children:e.group}),d("button",{type:"button",id:r,className:`launch-model-picker-option${e.description?" launch-model-picker-option--stacked":""}${e.className?` ${e.className}`:""}${t?" is-selected":""}${n?" is-active":""}${e.tone==="warning"?" is-warning":""}`,role:"option","aria-selected":t,"aria-disabled":e.disabled||void 0,disabled:e.disabled,tabIndex:-1,onMouseEnter:s,onFocus:s,onClick:i,children:[e.content||e.description?d("span",{className:"launch-model-picker-option-copy",children:[e.content??o("span",{children:e.label}),e.description?o("span",{className:"launch-model-picker-option-description",children:e.description}):null]}):o("span",{children:e.label}),t&&o(qe,{size:14,"aria-hidden":"true"})]})]})}function Io({id:e,ariaLabel:a,value:r,options:t,onChange:n,placeholder:s="Select\u2026",disabled:i,title:l,ariaKeyshortcuts:u,searchable:c=!0,searchPlaceholder:p="Search\u2026",emptyHint:L="No matches",className:I="",triggerClassName:f="launch-model-picker-trigger",triggerTestId:m,triggerIcon:h,minWidth:D=200,anchorToParent:N=!1}){let[w,M]=Lo(),[k,B]=b(""),[P,E]=b(null),x=T(null),A=T(null),v=T(null),C=T(!1),q=Eo(),[G,oe]=b(0),ce=t.find(y=>y.value===r),{items:fe,sticky:te}=X(()=>Hl(t,k,c),[t,k,c]),K=X(()=>[...fe,...te],[te,fe]),Q=K[G],de=y=>`${q}-${y.value}`,me=y=>{!y||y.disabled||(n(y.value),M(!1))},he=y=>{K.length!==0&&oe(_=>{for(let j=1;j<=K.length;j+=1){let J=(_+y*j+K.length)%K.length;if(!K[J].disabled)return J}return _})},xe=y=>{if(y.key==="Escape")y.preventDefault(),M(!1);else if(y.key==="ArrowDown")y.preventDefault(),he(1);else if(y.key==="ArrowUp")y.preventDefault(),he(-1);else if(y.key==="Home"){y.preventDefault();let _=K.findIndex(j=>!j.disabled);_>=0&&oe(_)}else if(y.key==="End"){y.preventDefault();let _=K.length-1-[...K].reverse().findIndex(j=>!j.disabled);_>=0&&oe(_)}else y.key==="Enter"&&(y.preventDefault(),me(Q))};Fl(()=>{if(!w||!x.current)return;let y=N?x.current.parentElement?.getBoundingClientRect()??x.current.getBoundingClientRect():x.current.getBoundingClientRect();E(Ol(y,{width:window.innerWidth,height:window.innerHeight},D))},[w,N,D]),O(()=>{if(!w)return;let y=j=>{let J=j.target;x.current?.contains(J)||A.current?.contains(J)||M(!1)},_=j=>{j.key==="Escape"&&M(!1)};return document.addEventListener("mousedown",y,!0),document.addEventListener("keydown",_),()=>{document.removeEventListener("mousedown",y,!0),document.removeEventListener("keydown",_)}},[w]),O(()=>{if(w){let y=K.findIndex(j=>j.value===r&&!j.disabled),_=K.findIndex(j=>!j.disabled);oe(y>=0?y:Math.max(0,_))}else B(""),C.current&&x.current?.focus();C.current=w},[w,c,r]);let Le=w&&P!==null;return O(()=>{Le&&(c?v.current?.focus():A.current?.focus())},[Le,c]),O(()=>{G>=K.length&&oe(0)},[G,K.length]),O(()=>{if(!w||!Q||Q.sticky)return;let y=A.current?.querySelector(`[id="${CSS.escape(de(Q))}"]`);y instanceof HTMLElement&&y.scrollIntoView({block:"nearest"})},[G,Q,w]),d(W,{children:[d("button",{ref:x,id:e,type:"button",className:`${f} ${I}${ce?.tone==="warning"?" is-warning":""}`,disabled:i,title:l,"aria-keyshortcuts":u,onClick:()=>M(y=>!y),onKeyDown:y=>{(y.key==="ArrowDown"||y.key==="ArrowUp")&&(y.preventDefault(),M(!0))},"aria-haspopup":"listbox","aria-expanded":w,"aria-controls":w?q:void 0,"aria-label":a,"data-testid":m??e,children:[h,o("span",{children:ce?.compactLabel??ce?.label??s}),o(le,{size:14,"aria-hidden":"true"})]}),w&&Ps(d("div",{ref:A,className:"launch-model-picker-menu launch-model-picker-menu--split",role:"listbox",id:q,tabIndex:-1,"aria-label":a,"aria-activedescendant":Q?de(Q):void 0,onKeyDown:xe,style:P?{left:P.left,width:P.width,maxHeight:P.maxHeight,...P.bottom!=null?{bottom:P.bottom,top:"auto"}:{top:P.top}}:{visibility:"hidden"},children:[c&&d("div",{className:"launch-model-picker-search",children:[o(ma,{size:13,"aria-hidden":"true"}),o("input",{ref:v,value:k,onChange:y=>B(y.target.value),placeholder:p,"aria-label":p,"aria-activedescendant":Q?de(Q):void 0,onKeyDown:xe})]}),d("div",{className:"launch-model-picker-options",children:[fe.map((y,_)=>o(As,{option:y,previousGroup:fe[_-1]?.group,optionId:de(y),selected:r===y.value,active:G===_,onHover:()=>oe(_),onSelect:()=>me(y)},y.value)),fe.length===0&&o("div",{className:"launch-model-picker-hint",children:L})]}),te.length>0&&o("div",{className:"launch-model-picker-footer",children:te.map((y,_)=>{let j=fe.length+_;return o(As,{option:y,previousGroup:_===0?void 0:te[_-1]?.group,optionId:de(y),selected:r===y.value,active:G===j,onHover:()=>oe(j),onSelect:()=>me(y)},y.value)})})]}),document.body)]})}function Ts(e,a){let r=new Set(e.map(f=>f.id)),t=new Map,n=[];for(let f of e)if(f.alternativeTo&&f.alternativeTo!==f.id&&r.has(f.alternativeTo)){let m=t.get(f.alternativeTo)??[];m.push(f),t.set(f.alternativeTo,m)}else n.push(f);let s=f=>({doc:f,alternatives:t.get(f.id)??[]}),i=[],l=(f,m,h,D,N={})=>{if(!D.length)return;let w=D.map(s);i.push({key:f,kind:m,label:h,entries:w,count:w.reduce((M,k)=>M+1+k.alternatives.length,0),...N})},u=n.filter(f=>f.pinnedAt!==null),c=n.filter(f=>f.pinnedAt===null&&f.openComments>0),p=n.filter(f=>f.pinnedAt===null&&f.openComments===0);if(l("pinned","pinned","Pinned",u),l("needs-me","needs-me","Needs me",c),!a.byProject)return l("recent","recent","Recent",p),i;let L=new Map,I=a.currentProjectId??null;I&&L.set(`project:${I}`,{projectId:I,docs:[]});for(let f of p){let m=f.projectId?`project:${f.projectId}`:"project:",h=L.get(m)??{projectId:f.projectId,docs:[]};h.docs.push(f),L.set(m,h)}for(let[f,m]of L)l(f,"project",m.projectId?a.projectName(m.projectId):"Global",m.docs,{projectId:m.projectId,current:!!I&&m.projectId===I});return i}function Co(e){try{let a=JSON.parse(e);return new Set(Array.isArray(a)?a.filter(r=>typeof r=="string"):[])}catch{return new Set}}function Ms(e,a){let r=Co(e);return r.has(a)?r.delete(a):r.add(a),JSON.stringify([...r])}var Ds=[217,262,173,24,330,142,45,195];function bo(e){if(!e)return"var(--text-dim)";let a=0;for(let r=0;r<e.length;r+=1)a=a*31+e.charCodeAt(r)|0;return`hsl(${Ds[Math.abs(a)%Ds.length]} 62% 52%)`}function Rs(e,a){try{let r=JSON.parse(e);if(r&&typeof r.since=="number"&&r.docs&&typeof r.docs=="object"){let t={};for(let[n,s]of Object.entries(r.docs))typeof s=="number"&&(t[n]=s);return{since:r.since,docs:t}}}catch{}return{since:a,docs:{}}}function Fs(e,a,r){if((e.docs[a]??e.since)>=r)return null;let t=Object.entries({...e.docs,[a]:r}).sort((n,s)=>s[1]-n[1]).slice(0,500);return{since:e.since,docs:Object.fromEntries(t)}}function Bs(e,a){return e.updatedBy.kind==="agent"&&e.updatedAt>(a.docs[e.id]??a.since)}var So="__global__",_l=Nt-600,Ul=[{value:"active",label:"Active",description:"Everything except archived"},...Et.map(e=>({value:e,label:Ot[e]})),{value:"all",label:"All statuses"}];function yo(e,a,r){return{value:e,label:a,content:d("span",{className:"dd-pick-row",children:[o("span",{className:"dd-pick-label",children:a}),o("span",{className:"dd-pick-count",children:r})]})}}function zl(e,a,r){let t=new Map;for(let s of e)t.set(s.projectId,(t.get(s.projectId)??0)+1);let n=[yo("","All projects",e.length)];(t.has(null)||r===So)&&n.push(yo(So,"Global docs",t.get(null)??0));for(let s of a)(t.has(s.id)||r===s.id)&&n.push(yo(s.id,s.name,t.get(s.id)??0));return n}function Ns(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function jl(e,a){let[r,t]=b(e);return O(()=>{let n=setTimeout(()=>t(e),a);return()=>clearTimeout(n)},[e,a]),r}function Gl(e){return e.summary?`${e.title}
${e.summary}`:e.title}function $l({doc:e,active:a,alternative:r=!1,projectName:t,unseen:n,now:s,menuOpen:i,onSelect:l,onMenu:u}){let c=e.lastComment,p=e.openComments>(c?1:0);return d("button",{type:"button",className:`dd-doc-row${a?" on":""}${r?" dd-doc-row-alt":""}${i?" dd-doc-row-menu":""}`,title:Gl(e),onClick:l,onContextMenu:L=>{L.preventDefault(),u(yn(L))},"aria-current":a?"page":void 0,"aria-haspopup":"menu",children:[d("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:e.title}),r?o("span",{className:"dd-doc-row-badge",title:"An alternative to the doc above",children:"Alt"}):null,e.status!=="draft"?o(ea,{status:e.status,compact:!0}):null,o(pe,{at:e.updatedAt,now:s})]}),c?d("span",{className:"dd-doc-row-excerpt",children:[o(Ce,{size:11,"aria-hidden":!0}),o("span",{className:"dd-doc-row-excerpt-body",children:c.body.replace(/\s+/g," ").trim()}),o("span",{className:"dd-doc-row-excerpt-author",children:c.author.label})]}):null,t!==null||p||n?d("span",{className:"dd-doc-row-meta",children:[t!==null?d("span",{className:"dd-doc-row-project",title:t,children:[o("span",{className:"dd-swatch",style:{background:bo(e.projectId)},"aria-hidden":!0}),o("span",{className:"dd-doc-row-project-name",children:t})]}):null,p?d("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[o(Ce,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,n?d("span",{className:"dd-doc-row-unseen",title:"Edited by an agent since you last opened it",children:[o(ge,{size:11,"aria-hidden":!0})," New edits"]}):null]}):null]})}var Vl={pinned:pa,"needs-me":Ce};function Wl({section:e,open:a,onToggle:r}){let t=e.kind==="pinned"||e.kind==="needs-me"?Vl[e.kind]:null;return d("button",{type:"button",className:`dd-list-section dd-list-section-${e.kind}`,"aria-expanded":a,onClick:r,children:[o(le,{size:12,"aria-hidden":!0,className:"dd-list-section-caret"}),t?o(t,{size:11,"aria-hidden":!0}):null,e.kind==="project"?o("span",{className:"dd-swatch",style:{background:bo(e.projectId??null)},"aria-hidden":!0}):null,o("span",{className:"dd-list-section-label",title:e.label,children:e.label}),e.current?o("span",{className:"dd-list-section-here",title:"The project you are in",children:"Here"}):null,o("span",{className:"dd-list-section-count",children:e.count})]})}function Xl({projectId:e,showProjects:a,projects:r,activeId:t,onSelect:n,onDeleted:s,onNew:i,onCollapse:l,headerActions:u}){let[c,p]=b(""),[L,I]=re("list-status","active"),[f,m]=re("list-project",""),[h,D]=re("list-grouped",!0),[N,w]=re("list-collapsed","[]"),[M,k]=re("list-seen",""),[B,P]=b(null),E=Ro(),x=Ut(r),A=jl(c.trim(),200),v=wa(),C=va({...e?{projectId:e}:{},...A?{query:A}:{},status:L}),q=X(()=>new Map(r.map(y=>[y.id,y.name])),[r]),G=X(()=>{let y=C.data??[];return!a||!f?y:y.filter(_=>f===So?_.projectId===null:_.projectId===f)},[C.data,a,f]),oe=L!=="active"||a&&!!f,ce=a&&!f&&h,fe=a?E.projectId:null,te=X(()=>Ts(G,{byProject:ce,currentProjectId:fe,projectName:y=>q.get(y)??"Unknown project"}),[G,ce,fe,q]),K=X(()=>Rs(M,Date.now()),[M]);O(()=>{M||k(JSON.stringify(K))},[M,K,k]);let Q=C.data?.find(y=>y.id===t)?.updatedAt??null;O(()=>{if(!t||Q===null)return;let y=Fs(K,t,Q);y&&k(JSON.stringify(y))},[t,Q,K,k]);let de=!(te.length===1&&te[0]?.kind==="recent"),me=X(()=>A?new Set:Co(N),[A,N]),he=(y,_)=>_.kind==="project"?null:a?y.projectId?q.get(y.projectId)??"Unknown project":"Global":y.projectId?null:"Global",xe=(y,_,j)=>o($l,{doc:y,active:y.id===t,alternative:j,projectName:j?null:he(y,_),unseen:y.id!==t&&Bs(y,K),now:v,menuOpen:B?.doc.id===y.id,onSelect:()=>n(y.id),onMenu:J=>P({doc:y,at:J})},y.id),Le=X(()=>a?zl(C.data??[],r,f):[],[a,C.data,r,f]);return d("div",{className:"dd-list",children:[d("div",{className:"dd-list-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),C.data?o("span",{className:"dd-list-count",title:`${G.length} ${G.length===1?"doc":"docs"}`,children:G.length}):null,o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary dd-new",onClick:i,children:[o(be,{size:13,"aria-hidden":!0})," New"]}),o(z,{icon:Fe,label:"Hide doc list",onClick:l}),u]}),o("div",{className:"dd-list-tools",children:d("label",{className:"dd-search",children:[o(ma,{size:13,"aria-hidden":!0}),o("input",{value:c,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:y=>p(y.target.value)}),c?o("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>p(""),children:o(ie,{size:12,"aria-hidden":!0})}):null]})}),d("div",{className:"dd-list-filters",children:[o(Io,{ariaLabel:"Filter by status",value:L,options:Ul,onChange:I,searchable:!1,triggerClassName:`launch-model-picker-trigger dd-pick${L!=="active"?" on":""}`,triggerIcon:o(Za,{size:12,"aria-hidden":!0})}),a?o(Io,{ariaLabel:"Filter by project",value:f,options:Le,onChange:m,searchable:Le.length>8,searchPlaceholder:"Search projects\u2026",minWidth:220,triggerClassName:`launch-model-picker-trigger dd-pick${f?" on":""}`,triggerIcon:o(_e,{size:12,"aria-hidden":!0})}):null,a&&!f?d(W,{children:[o("span",{className:"dd-spacer"}),o(z,{icon:ut,label:"Group by project",active:h,size:13,onClick:()=>D(!h)})]}):null]}),d("div",{className:"dd-list-scroll",children:[C.error?o("div",{className:"dd-banner dd-banner-error",children:C.error}):null,!C.data&&C.loading?o("div",{className:"dd-center",children:o(Z,{label:"Loading design docs"})}):null,C.data&&!G.length?o("div",{className:"dd-list-empty dd-muted",children:A||oe?"No docs match.":"No design docs yet."}):null,te.map(y=>{let _=!me.has(y.key),j=y.entries.flatMap(J=>[xe(J.doc,y,!1),...J.alternatives.map(Se=>xe(Se,y,!0))]);return de?d("section",{className:"dd-list-group","aria-label":y.label,children:[o(Wl,{section:y,open:_,onToggle:()=>w(Ms(N,y.key))}),_?j:null]},y.key):j})]}),B?o(Sn,{at:B.at,label:`Actions for ${B.doc.title}`,onClose:()=>P(null),children:x.items(B.doc,()=>P(null),()=>s(B.doc.id),B.doc.id===t?void 0:()=>n(B.doc.id))},`${B.doc.id}@${B.at.x},${B.at.y}`):null,x.dialogs]})}function Es({templates:e,selected:a,onSelect:r}){return o("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(t=>d("button",{type:"button",role:"radio","aria-checked":a===t.id,className:`dd-template${a===t.id?" on":""}`,onClick:()=>r(t.id),children:[o("span",{className:"dd-template-label",children:t.label}),o("span",{className:"dd-template-desc",children:t.description}),o("span",{className:"dd-template-files",children:t.files.join(" \xB7 ")})]},t.id))})}function Po({initialTemplate:e,defaultProjectId:a,projects:r,onClose:t,onCreated:n}){let s=$(),i=Pe(),l=Qt(),[u,c]=b(""),[p,L]=b(""),[I,f]=b(e??null),[m,h]=b(a??""),[D,N]=b(""),[w,M]=b(""),[k,B]=b(!1),P=I??l.data?.[0]?.id??null,E=!!w.trim(),x=m||a||r[0]?.id||"",A=async()=>{if(!(!u.trim()||k)){B(!0);try{let v=await s.create({title:u.trim(),...p.trim()?{summary:p.trim()}:{},...P?{template:P}:{},tags:D.split(",").map(C=>C.trim().toLowerCase()).filter(Boolean),projectId:m||null});if(n(v.id),E){if(!x)F("Doc created. Add a project to let an agent draft it.","error");else if(!eo(i,v,{prompt:Ns(w),projectId:x})){let C=await s.askAgent(v.id,{prompt:Ns(w),projectId:x});Da(i,v,C.threadId),F(`An agent is drafting \u201C${v.title}\u201D. Watch it fill in as it writes.`)}}t()}catch(v){F(`Could not create the doc: ${U(v)}`,"error"),B(!1)}}};return o(aa,{title:"New design doc",wide:!0,onClose:t,footer:d(W,{children:[o("span",{className:"dd-muted dd-dialog-hint",children:E?"An agent drafts it from the brief.":"You can ask an agent to fill it in later."}),o("span",{className:"dd-spacer"}),o("button",{type:"button",className:"btn",onClick:t,children:"Cancel"}),d("button",{type:"button",className:"btn primary",disabled:!u.trim()||k,onClick:()=>{A()},children:[k?o(Z,{size:12}):E?o(se,{size:12,"aria-hidden":!0}):null,E?"Create & draft with agent":"Create"]})]}),children:d("form",{className:"dd-form",onSubmit:v=>{v.preventDefault(),A()},children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Title"}),o("input",{className:"dd-input",value:u,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:v=>c(v.target.value),autoFocus:!0})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Summary"}),o("input",{className:"dd-input",value:p,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:v=>L(v.target.value)})]}),d("div",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Template"}),l.data?o(Es,{templates:l.data,selected:P,onSelect:f}):o(Z,{label:"Loading templates"})]}),d("div",{className:"dd-field-row",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),d("select",{className:"dd-input dd-select",value:m,onChange:v=>h(v.target.value),children:[o("option",{value:"",children:"Global (all projects)"}),r.map(v=>o("option",{value:v.id,children:v.name},v.id))]})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Tags"}),o("input",{className:"dd-input",value:D,placeholder:"sync, mobile",onChange:v=>N(v.target.value)})]})]}),d("label",{className:"dd-field",children:[d("span",{className:"dd-field-label",children:[o(se,{size:12,"aria-hidden":!0})," Brief for an agent ",o("span",{className:"dd-muted",children:"(optional)"})]}),o("textarea",{className:"dd-input",rows:4,value:w,maxLength:_l,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:v=>M(v.target.value)})]}),o("button",{type:"submit",hidden:!0})]})})}function Kl({templates:e,onNew:a}){return o("div",{className:"dd-landing",children:d("div",{className:"dd-landing-inner",children:[o("span",{className:"dd-landing-icon",children:o(We,{size:26,"aria-hidden":!0})}),o("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),o("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),d("ul",{className:"dd-landing-points",children:[d("li",{children:[o(se,{size:13,"aria-hidden":!0})," ",o("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),d("li",{children:[o(Ce,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),d("li",{children:[o(ge,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),d("div",{className:"dd-landing-start",children:[o("span",{className:"dd-section-label",children:"Start from a template"}),e?o(Es,{templates:e,selected:null,onSelect:r=>a(r)}):o(Z,{})]})]})})}function vo({projectId:e,location:a,onLocationChange:r,variant:t,headerActions:n}){let s=Ne(),i=Qt(),[l,u]=b(null),[c,p]=re("list-open",!0),L=s.data??[];return d("div",{className:"dd-root dd-workbench",children:[c?o(Xl,{projectId:t==="project"?e:null,showProjects:t==="global",projects:L,activeId:a.docId,onSelect:I=>r({docId:I,path:null}),onDeleted:I=>{I===a.docId&&r({docId:null,path:null})},onNew:()=>u({template:null}),onCollapse:()=>p(!1),headerActions:n}):d("nav",{className:"dd-list-collapsed","aria-label":"Design docs",children:[o(z,{icon:Be,label:"Show doc list",onClick:()=>p(!0)}),o(z,{icon:be,label:"New design doc",onClick:()=>u({template:null})}),n]}),o("main",{className:"dd-main",children:a.docId?o(Vt,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(I,f)=>r({docId:a.docId,path:I},f??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):o(Kl,{templates:i.data,onNew:I=>u({template:I??null})})}),l?o(Po,{initialTemplate:l.template,defaultProjectId:e,projects:L,onClose:()=>u(null),onCreated:I=>r({docId:I,path:null})}):null]})}var Ea="design-docs";function Os({children:e}){return o("div",{className:"dd-root",children:e})}function qs({subPath:e}){let a=Pe();return o(vo,{variant:"global",projectId:null,location:ao(e),onLocationChange:(r,t)=>a.toPluginPanel(Ea,{subPath:Ma(r),...t?{replace:t}:{}})})}function Hs({projectId:e,headerActions:a}){let[r,t]=re(`project-location:${e}`,"");return o(vo,{variant:"project",projectId:e,location:ao(r),onLocationChange:n=>t(Ma(n)),headerActions:a})}function Zl(e,a,r,t){e.openThreadPanel({actionId:Aa,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...t?{threadId:t}:{}})||e.toPluginPanel(Ea,{subPath:Ma(a)})}function _s({attributes:e,source:a,message:r}){let t=Pe(),n=e.id?.trim()||null,s=e.path?.trim()||null,i=qt(n);if(!n||i.error)return o("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:n?`Design doc unavailable: ${i.error}`:"Invalid design doc link: an id is required."});let l=i.data;return d("div",{className:"plugin-directive-card dd-card",children:[d("button",{type:"button",className:"plugin-directive-card-main",disabled:!l,onClick:()=>l&&Zl(t,{docId:l.id,path:s},l.title,r.threadId),title:l?`Open ${l.title} beside this conversation`:void 0,children:[o("span",{className:"dd-card-icon","aria-hidden":!0,children:o(We,{size:14})}),o("span",{className:"plugin-directive-card-kind",children:"Design doc"}),o("span",{className:"plugin-directive-card-title",children:l?l.title:"Loading\u2026"}),l?d("span",{className:"plugin-directive-card-meta dd-card-meta",children:[s?o("code",{children:s}):null,o(ea,{status:l.status,compact:!0}),l.files.length," file",l.files.length===1?"":"s",l.openComments?` \xB7 ${l.openComments} open comment${l.openComments===1?"":"s"}`:""]}):o(Z,{size:12})]}),l?o("button",{type:"button",className:"plugin-directive-card-open",onClick:u=>{u.stopPropagation(),t.toPluginPanel(Ea,{subPath:Ma({docId:l.id,path:s})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function Jl({projectId:e,onPick:a}){let r=va({...e?{projectId:e}:{},status:"active"}),t=Ne(),n=wa(),[s,i]=b(!1);return d("div",{className:"dd-picker",children:[d("div",{className:"dd-picker-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary",onClick:()=>i(!0),children:[o(be,{size:13,"aria-hidden":!0})," New"]})]}),o("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(l=>d("button",{type:"button",className:"dd-doc-row",onClick:()=>a(l.id),children:[d("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:l.title}),l.status!=="draft"?o(ea,{status:l.status,compact:!0}):null]}),l.summary?o("span",{className:"dd-doc-row-summary",children:l.summary}):null,d("span",{className:"dd-doc-row-meta",children:[d("span",{children:[l.fileCount," files"]}),o("span",{className:"dd-spacer"}),o(pe,{at:l.updatedAt,now:n})]})]},l.id)):o(Ae,{icon:We,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):o("div",{className:"dd-center",children:r.error?o("div",{className:"dd-banner dd-banner-error",children:r.error}):o(Z,{})})}),s?o(Po,{defaultProjectId:e,projects:t.data??[],onClose:()=>i(!1),onCreated:l=>a(l)}):null]})}function Us(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function zs(e){let{docId:a,path:r}=Us(e.params);return o(Ql,{...e},`${a}\0${r}`)}function Ql({params:e,projectId:a}){let r=Pe(),t=Us(e),[n,s]=b(t),i=!t.docId;if(!n.docId)return o(Os,{children:o(Jl,{projectId:a??null,onPick:u=>s({docId:u,path:null})})});let l=n.docId;return o(Os,{children:o(Vt,{docId:l,path:n.path,layout:"compact",contextProjectId:a??null,onOpenPath:u=>s({docId:l,path:u}),onDeleted:()=>s({docId:null,path:null}),headerExtra:d(W,{children:[i?o(z,{icon:Va,label:"All design docs",onClick:()=>s({docId:null,path:null})}):null,o(z,{icon:ia,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(Ea,{subPath:Ma(n)})})]})},l)})}async function js({threadId:e,message:a,selectedText:r,openPanel:t}){let n=(r?.trim()||a.text).trim();if(!n){F("This message has no text to save.","error");return}try{let s=await Ao(cn,"createFromMessage",{threadId:e,text:n});t({actionId:Aa,title:s.title,params:{docId:s.id}}),F(`Saved \u201C${s.title}\u201D as a design doc`)}catch(s){F(`Could not save the design doc: ${U(s)}`,"error")}}var wo=`
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
/* A phone already is the phone width: the preview-width switcher is noise. */
.dd-doc-narrow .dd-html-widths { display: none; }
.dd-doc-narrow .dd-html-toolbar { padding: 2px 8px; }
`;var Gs="design-docs-plugin-styles";function Yl(){if(typeof document>"u")return;let e=document.getElementById(Gs);if(e instanceof HTMLStyleElement){e.textContent=wo;return}let a=document.createElement("style");a.id=Gs,a.textContent=wo,document.head.appendChild(a)}Yl();var zx=Do(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:Ea,component:qs}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:Hs,detachable:!0}),e.slots.messageDirective({id:"design-doc",component:_s}),e.slots.threadPanelAction({id:Aa,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:zs}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:js})});export{zx as default,Yl as injectStyles};
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
