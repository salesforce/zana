function _s(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Ft(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function Po(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function vo(e,a,r){return _s().callRpc(e,a,r)}function wo(e){return{__zccPluginApp:!0,setup:e}}function ko(){return Ft().useRpc?.()??Po("useRpc")}function Ao(e,a){Ft().useRealtime?.(e,a)}function Ce(){return Ft().useZccNavigate?.()??Po("useZccNavigate")}function Us(){return globalThis.__ZCC_HOST_REACT__}function Do(e,a){let r=Us(),t=Ft()[e];return!r||!t?null:r.createElement(t,a)}function To(e){return Do("ThreadChat",e)}function za(e){return Do("Markdown",e)}var G=globalThis.__ZCC_HOST_REACT__;var ri=G.Children,ni=G.Component,si=G.Fragment,di=G.StrictMode,li=G.Suspense,ii=G.cloneElement,Mo=G.createContext,ya=G.createElement,ui=G.createRef,Bt=G.forwardRef,ci=G.isValidElement,fi=G.lazy,pi=G.memo,mi=G.startTransition,Ae=G.useCallback,Ro=G.useContext,gi=G.useDebugValue,Fo=G.useDeferredValue,O=G.useEffect,Bo=G.useId,hi=G.useImperativeHandle,xi=G.useInsertionEffect,Sa=G.useLayoutEffect,X=G.useMemo,Li=G.useReducer,F=G.useRef,b=G.useState,No=G.useSyncExternalStore,Ii=G.useTransition,Ci=G.version;var Eo=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Oo(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:Eo(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var qo=e=>{let a="",r=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){r=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=r?t.toUpperCase():t,r=!1}return a};var Ho=e=>{let a=qo(e);return a.charAt(0).toUpperCase()+a.slice(1)};var ja=(...e)=>e.filter((a,r,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===r).join(" ").trim();var $e={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function Kt(e){return e!=null}function _o(e,a={}){let r=a.attributeNames??{},t=m=>r[m]??m,n=e.size??e.width??$e.width,s=e.size??e.height??$e.height,i=e.aliases?.filter(m=>typeof m=="string"&&m.trim()!=="").map(m=>`lucide-${m}`)??[],l=[...e.name?[`lucide-${e.name}`]:[],...i],u=a.className?.split(" ").filter(Boolean)??[],c=a.includeDefaultClasses===!1?ja(...u):ja("lucide",...l,...u),f=a.absoluteStrokeWidth?Number(a.strokeWidth??$e["stroke-width"])*Number(e.size??e.width??$e.width)/Number(a.size??a.width??$e.width):a.strokeWidth??$e["stroke-width"];return["svg",{...Object.entries($e).reduce((m,[p,x])=>(m[t(p)]=x,m),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&Kt(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&Kt(a.width)&&{[t("width")]:a.width},..."height"in a&&Kt(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:f,...c&&{[t("class")]:c},[t("viewBox")]:`0 0 ${n} ${s}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(m=>{let[p,x,I]=m,k=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...x}:x;return I?[p,k,I]:[p,k]})]}function Uo(e,a={}){return _o(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var zo=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var zs=Mo({});var jo=()=>Ro(zs);var Go=Bt(({color:e,size:a,width:r,height:t,strokeWidth:n,absoluteStrokeWidth:s,nonScalingStroke:i,className:l="",children:u,iconNode:c=[],icon:f={node:c,aliases:[],size:24},...C},m)=>{let{size:p=24,strokeWidth:x=2,absoluteStrokeWidth:I=!1,nonScalingStroke:k=!1,color:D="currentColor",className:v=""}=jo()??{},M=!!u||zo(C),[w,H,S=[]]=Uo(f,{color:e??D,width:r??a??p,height:t??a??p,strokeWidth:n??x,absoluteStrokeWidth:s??I,nonScalingStroke:i??k,className:ja(v,l),hasA11yProp:M,attributes:C});return ya(w,{ref:m,...H},[...S.map(([N,L])=>ya(N,L)),...Array.isArray(u)?u:[u]])});function h(e,a=[],r=[]){let t=typeof e=="string"?Oo(e,a,r):e,n=Bt(({className:s,...i},l)=>ya(Go,{ref:l,icon:t,className:s,...i}));return t.name&&(n.displayName=Ho(t.name)),n}var $o={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};$o.node;var Ga=h($o);var Vo={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};Vo.node;var $a=h(Vo);var Wo={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};Wo.node;var ia=h(Wo);var Xo={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};Xo.node;var Va=h(Xo);var Ko={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};Ko.node;var ge=h(Ko);var Zo={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};Zo.node;var Wa=h(Zo);var Qo={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};Qo.node;var Oe=h(Qo);var Jo={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};Jo.node;var ie=h(Jo);var Yo={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};Yo.node;var ua=h(Yo);var er={name:"chevron-up",size:24,node:[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]};er.node;var Xa=h(er);var ar={name:"circle-dot",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]};ar.node;var Ka=h(ar);var tr={name:"cloud-upload",size:24,node:[["path",{d:"M12 13v8",key:"1l5pq0"}],["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"m8 17 4-4 4 4",key:"1quai1"}]],aliases:["upload-cloud"]};tr.node;var qe=h(tr);var or={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};or.node;var Ve=h(or);var rr={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};rr.node;var Za=h(rr);var nr={name:"corner-down-right",size:24,node:[["path",{d:"m15 10 5 5-5 5",key:"qqa56n"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12",key:"z08zvw"}]]};nr.node;var Qa=h(nr);var sr={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};sr.node;var We=h(sr);var dr={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};dr.node;var Ja=h(dr);var lr={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};lr.node;var De=h(lr);var ir={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};ir.node;var He=h(ir);var ur={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};ur.node;var Ya=h(ur);var cr={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};cr.node;var et=h(cr);var fr={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};fr.node;var be=h(fr);var pr={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};pr.node;var at=h(pr);var mr={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};mr.node;var Xe=h(mr);var gr={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};gr.node;var Te=h(gr);var hr={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};hr.node;var ca=h(hr);var xr={name:"file-type",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M11 18h2",key:"12mj7e"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5",key:"qbrxap"}]]};xr.node;var tt=h(xr);var Lr={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};Lr.node;var Ke=h(Lr);var Ir={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};Ir.node;var ot=h(Ir);var Cr={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};Cr.node;var _e=h(Cr);var br={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};br.node;var rt=h(br);var yr={name:"git-fork",size:24,node:[["circle",{cx:"12",cy:"18",r:"3",key:"1mpf1b"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["path",{d:"M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9",key:"1uq4wg"}],["path",{d:"M12 12v3",key:"158kv8"}]]};yr.node;var nt=h(yr);var Sr={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};Sr.node;var st=h(Sr);var Pr={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};Pr.node;var fa=h(Pr);var vr={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};vr.node;var Ze=h(vr);var wr={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};wr.node;var dt=h(wr);var kr={name:"list-tree",size:24,node:[["path",{d:"M8 5h13",key:"1pao27"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"M3 10a2 2 0 0 0 2 2h3",key:"1npucw"}],["path",{d:"M3 5v12a2 2 0 0 0 2 2h3",key:"x1gjn2"}]]};kr.node;var lt=h(kr);var Ar={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};Ar.node;var Qe=h(Ar);var Dr={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};Dr.node;var pa=h(Dr);var Tr={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};Tr.node;var it=h(Tr);var Mr={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};Mr.node;var ye=h(Mr);var Rr={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};Rr.node;var ut=h(Rr);var Fr={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};Fr.node;var ct=h(Fr);var Br={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};Br.node;var Me=h(Br);var Nr={name:"panel-left-open",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m14 9 3 3-3 3",key:"8010ee"}]],aliases:["sidebar-open"]};Nr.node;var Re=h(Nr);var Er={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};Er.node;var ft=h(Er);var Or={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};Or.node;var ma=h(Or);var qr={name:"pin-off",size:24,node:[["path",{d:"M12 17v5",key:"bb1du9"}],["path",{d:"M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89",key:"znwnzq"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11",key:"c9qhm2"}]]};qr.node;var pt=h(qr);var Hr={name:"pin",size:24,node:[["path",{d:"M12 17v5",key:"bb1du9"}],["path",{d:"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",key:"1nkz8b"}]]};Hr.node;var ga=h(Hr);var _r={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};_r.node;var xe=h(_r);var Ur={name:"reply",size:24,node:[["path",{d:"M20 18v-2a4 4 0 0 0-4-4H4",key:"5vmcpk"}],["path",{d:"m9 17-5-5 5-5",key:"nvlc11"}]]};Ur.node;var mt=h(Ur);var zr={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};zr.node;var Se=h(zr);var jr={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};jr.node;var Ue=h(jr);var Gr={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};Gr.node;var gt=h(Gr);var $r={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};$r.node;var ht=h($r);var Vr={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Vr.node;var ha=h(Vr);var Wr={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};Wr.node;var xt=h(Wr);var Xr={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};Xr.node;var de=h(Xr);var Kr={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};Kr.node;var Lt=h(Kr);var Zr={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};Zr.node;var It=h(Zr);var Qr={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};Qr.node;var he=h(Qr);var Jr={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};Jr.node;var Pe=h(Jr);var Yr={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};Yr.node;var Ct=h(Yr);var en={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};en.node;var bt=h(en);var an={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};an.node;var Je=h(an);var tn={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};tn.node;var yt=h(tn);var on={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};on.node;var ue=h(on);var rn=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];var Nt=4e3;function js(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function Gs(e){let a=(t,n)=>e(t,n===void 0?void 0:js(n)),r=async t=>{await t};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(t={})=>a("list",t),get:t=>a("get",{doc:t}),create:t=>a("create",t),update:(t,n)=>a("update",{doc:t,...n}),pin:(t,n)=>a("pin",{doc:t,pinned:n}),remove:t=>r(a("remove",{doc:t})),readFile:(t,n)=>a("readFile",{doc:t,path:n}),renderPage:(t,n)=>a("renderPage",{doc:t,...n}),readPageFile:(t,n)=>a("readPageFile",{doc:t,path:n}),pageLink:(t,n)=>a("pageLink",{doc:t,path:n}),siteFiles:t=>a("siteFiles",{doc:t}),reportRender:(t,n)=>r(a("reportRender",{doc:t,...n})),writeFile:(t,n)=>a("writeFile",{doc:t,...n}),editFile:(t,n)=>a("editFile",{doc:t,...n}),deleteFile:(t,n)=>r(a("deleteFile",{doc:t,path:n})),renameFile:(t,n,s)=>a("renameFile",{doc:t,from:n,to:s}),history:(t,n={})=>a("history",{doc:t,...n}),revision:(t,n)=>a("revision",{doc:t,id:n}),restore:(t,n,s)=>a("restore",{doc:t,id:n,baseRevision:s}),addComment:(t,n)=>a("addComment",{doc:t,...n}),replyToComment:(t,n,s)=>a("replyToComment",{doc:t,id:n,body:s}),setCommentStatus:(t,n,s)=>a("setCommentStatus",{doc:t,id:n,status:s}),deleteComment:(t,n)=>r(a("deleteComment",{doc:t,id:n})),unlinkThread:(t,n)=>r(a("unlinkThread",{doc:t,threadId:n})),askAgent:(t,n)=>a("askAgent",{doc:t,...n,path:n.path??void 0}),publish:(t,n)=>a("publish",{doc:t,...n})}}function j(){let e=ko();return X(()=>Gs((a,r)=>e.call(a,r)),[e])}function _(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function nn(e){return/changed since revision/i.test(_(e))}function sn(e){return/^design doc .* not found/i.test(e)}function B(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var dn="design-docs";var ln="changed",Et=["draft","review","approved","implemented","archived"],Ot={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function un(e,a){let r=t=>t.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Ye(e,a){let[r,t]=b({key:e,data:null,error:null,loading:e!==null}),[n,s]=b(0),i=F(a);i.current=a,O(()=>{if(e===null){t({key:e,data:null,error:null,loading:!1});return}let c=!1;return t(f=>({key:e,data:f.key===e?f.data:null,error:null,loading:!0})),i.current().then(f=>{c||t({key:e,data:f,error:null,loading:!1})},f=>{c||t(C=>({key:e,data:C.key===e?C.data:null,error:_(f),loading:!1}))}),()=>{c=!0}},[e,n]);let l=Ae(()=>s(c=>c+1),[]),u=r.key===e;return{data:u?r.data:null,error:u?r.error:null,loading:u?r.loading:e!==null,reload:l}}function fn(e,a=120){let r=F(e);r.current=e;let t=F(new Set),n=F(null);O(()=>()=>{n.current&&clearTimeout(n.current)},[]),Ao(ln,s=>{let i=typeof s?.docId=="string"?s.docId:null;t.current.add(i),!n.current&&(n.current=setTimeout(()=>{n.current=null;let l=[...t.current];t.current.clear();for(let u of l)r.current(u)},a))})}function Pa(e){let a=j(),r=Ye(JSON.stringify(e),()=>a.list(e));return fn(()=>r.reload()),r}function qt(e){let a=j(),r=Ye(e,()=>a.get(e));return fn(t=>{(t===null||t===e)&&r.reload()}),r}function pn(e,a,r){let t=j(),n=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Ye(n,()=>t.readFile(e,a))}function Zt(){let e=j();return Ye("templates",()=>e.templates())}function Fe(){let e=j();return Ye("projects",()=>e.projects())}var cn="zcc.design-docs.";function le(e,a){let[r,t]=b(()=>{try{let s=globalThis.localStorage?.getItem(cn+e);if(s==null)return a;let i=JSON.parse(s);return typeof i==typeof a?i:a}catch{return a}}),n=Ae(s=>{t(s);try{globalThis.localStorage?.setItem(cn+e,JSON.stringify(s))}catch{}},[e]);return[r,n]}function mn(e){let[a,r]=b(null),[t,n]=b(null);return Sa(()=>{if(!a)return;let s=l=>n(l>0?e.filter(u=>l>=u).length:null);if(s(a.getBoundingClientRect().width),typeof ResizeObserver>"u")return;let i=new ResizeObserver(l=>s(l[0]?.contentRect.width??0));return i.observe(a),()=>i.disconnect()},[a,e]),[r,t]}function va(e=6e4){let[a,r]=b(()=>Date.now());return O(()=>{let t=setInterval(()=>r(Date.now()),e);return()=>clearInterval(t)},[e]),a}var $s=Symbol.for("react.portal");function Vs(e,a){return{$$typeof:$s,key:null,children:e,containerInfo:a,implementation:null}}function Qt(e){return typeof document>"u"?e:Vs(e,document.body)}function xa(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function gn(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let t=Math.round(r/60);if(t<60)return`${t}m ago`;let n=Math.round(t/60);if(n<24)return`${n}h ago`;let s=Math.round(n/24);return s<30?`${s}d ago`:new Date(e).toISOString().slice(0,10)}var hn=globalThis.__ZCC_HOST_REACT__,$=hn.Fragment;function o(e,a,r){return hn.createElement(e,r===void 0?a:{...a,key:r})}var d=o;var Ws={MessageSquareText:it,CheckCheck:Wa,WandSparkles:Je,Workflow:yt,ScanSearch:ht,ListChecks:dt};function xn(e){return Ws[e]??de}function wa({kind:e,size:a=14}){return o(e==="image"||e==="svg"?at:e==="font"?tt:e==="markdown"||e==="text"?ca:et,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function ea({status:e,compact:a=!1}){return d("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[o("span",{className:"dd-status-dot","aria-hidden":!0}),Ot[e]]})}function Le({actor:e}){let a=e.kind==="agent"?ge:bt;return d("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[o(a,{size:12,"aria-hidden":!0}),o("span",{className:"dd-actor-label",children:e.label})]})}function fe({at:e,now:a}){return o("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:gn(e,a)})}function K({size:e=14,label:a}){return o("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:o(Qe,{size:e,className:"dd-spin","aria-hidden":!0})})}function ve({icon:e,title:a,children:r}){return d("div",{className:"dd-empty",children:[o("span",{className:"dd-empty-icon",children:o(e,{size:22,"aria-hidden":!0})}),o("div",{className:"dd-empty-title",children:a}),r?o("div",{className:"dd-empty-body",children:r}):null]})}function U({icon:e,label:a,onClick:r,active:t=!1,danger:n=!1,disabled:s=!1,size:i=14}){return o("button",{type:"button",className:`icon-btn dd-icon-btn${t?" on":""}${n?" danger":""}`,title:a,"aria-label":a,"aria-pressed":t||void 0,disabled:s,onClick:r,children:o(e,{size:i,"aria-hidden":!0})})}function Ln(e,a){let r=F(null),t=F(a);return t.current=a,O(()=>{if(!e)return;let n=i=>{r.current&&i.target instanceof Node&&!r.current.contains(i.target)&&t.current()},s=i=>{i.key==="Escape"&&t.current()};return document.addEventListener("mousedown",n),document.addEventListener("keydown",s),()=>{document.removeEventListener("mousedown",n),document.removeEventListener("keydown",s)}},[e]),r}function we({open:e,onClose:a,anchor:r,children:t,align:n="end",className:s=""}){let i=Ln(e,a);return d("div",{className:"dd-pop-anchor",ref:i,children:[r,e?o("div",{className:`dd-pop dd-pop-${n} ${s}`,role:"dialog",children:t}):null]})}function In(e){if(e.clientX||e.clientY)return{x:e.clientX,y:e.clientY};let a=e.currentTarget.getBoundingClientRect();return{x:a.left+12,y:a.bottom}}var Ht=4;function Cn({at:e,label:a,onClose:r,children:t}){let n=Ln(!0,r),s=F(r);s.current=r;let[i,l]=b(e);Sa(()=>{let c=n.current,{width:f,height:C}=c.getBoundingClientRect();l({x:Math.max(Ht,Math.min(e.x,window.innerWidth-f-Ht)),y:Math.max(Ht,Math.min(e.y,window.innerHeight-C-Ht))})},[n,e.x,e.y]),O(()=>{let c=document.activeElement instanceof HTMLElement?document.activeElement:null;n.current?.querySelector('[role="menuitem"]')?.focus();let f=C=>{C.target instanceof Node&&n.current?.contains(C.target)||s.current()};return window.addEventListener("scroll",f,!0),window.addEventListener("resize",f),window.addEventListener("blur",f),()=>{window.removeEventListener("scroll",f,!0),window.removeEventListener("resize",f),window.removeEventListener("blur",f),c?.isConnected&&(document.activeElement===document.body||n.current?.contains(document.activeElement))&&c.focus()}},[n]);let u=c=>{let f=[...c.currentTarget.querySelectorAll('[role="menuitem"]')],C=f.indexOf(document.activeElement),m=c.key==="ArrowDown"?(C+1)%f.length:c.key==="ArrowUp"?(C-1+f.length)%f.length:c.key==="Home"?0:c.key==="End"?f.length-1:-1;c.key==="Tab"&&r(),!(m<0||!f.length)&&(c.preventDefault(),f[m].focus())};return Qt(o("div",{ref:n,className:"dd-pop dd-menu dd-context-menu",role:"menu","aria-label":a,style:{left:i.x,top:i.y},onKeyDown:u,onContextMenu:c=>c.preventDefault(),children:t}))}function ce({icon:e,label:a,hint:r,onSelect:t,danger:n=!1,checked:s=!1}){return d("button",{type:"button",role:"menuitem",className:`dd-menu-item${n?" dd-menu-danger":""}${s?" dd-menu-checked":""}`,onClick:t,children:[e?o(e,{size:14,"aria-hidden":!0}):null,o("span",{className:"dd-menu-label",children:a}),r?o("span",{className:"dd-menu-hint",children:r}):null]})}function Be({request:e,onClose:a}){let[r,t]=b(!1),n=async()=>{t(!0);try{await e.run()}finally{t(!1),a()}};return o(aa,{title:e.title,onClose:a,footer:d($,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{n()},autoFocus:!0,children:e.confirmLabel})]}),children:o("div",{className:"dd-confirm-body",children:e.body})})}function aa({title:e,onClose:a,children:r,footer:t,wide:n=!1}){return O(()=>{let s=i=>{i.key==="Escape"&&a()};return document.addEventListener("keydown",s),()=>document.removeEventListener("keydown",s)},[a]),Qt(o("div",{className:"dd-dialog-backdrop",onMouseDown:s=>{s.target===s.currentTarget&&a()},children:d("div",{className:`dd-dialog${n?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[d("div",{className:"dd-dialog-header",children:[o("span",{className:"dd-dialog-title",children:e}),o(U,{icon:ue,label:"Close",onClick:a})]}),o("div",{className:"dd-dialog-body",children:r}),t?o("div",{className:"dd-dialog-footer",children:t}):null]})}))}var bn={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},ka="design-doc";function St(e,a,r){e.openPanelAgent?.({threadId:r,title:a.title})||(e.openThreadPanel({actionId:ka,title:a.title,params:{docId:a.id},threadId:r}),e.toThread(r))}function yn({doc:e,now:a,chatThreadId:r=null,onOpenChat:t}){let n=j(),s=Ce(),i=[...e.threads].sort((u,c)=>c.lastActivityAt-u.lastActivityAt),l=t?i.find(u=>u.threadId===r):void 0;return l&&t?d("div",{className:"dd-rail-pane dd-agents dd-agent-chat",children:[d("div",{className:"dd-agent-chat-head",children:[o(U,{icon:ia,label:"All agents",size:13,onClick:()=>t(null)}),o("span",{className:"dd-agent-chat-title",title:l.title,children:l.title}),o("span",{className:`dd-role dd-role-${l.role}`,children:bn[l.role]}),o(U,{icon:He,label:"Open full thread",size:13,onClick:()=>s.toThread(l.threadId)})]}),o(To,{threadId:l.threadId,variant:"compact",layout:"contained",className:"dd-agent-chat-body"})]}):o("div",{className:"dd-rail-pane dd-agents",children:d("div",{className:"dd-rail-scroll",children:[i.length?o("ul",{className:"dd-thread-list",children:i.map(u=>d("li",{className:"dd-thread",children:[d("button",{type:"button",className:"dd-thread-open",onClick:()=>t?t(u.threadId):s.toThread(u.threadId),title:t?"Open chat beside the doc":"Open thread",children:[o(ge,{size:14,"aria-hidden":!0}),d("span",{className:"dd-thread-main",children:[o("span",{className:"dd-thread-title",children:u.title}),d("span",{className:"dd-thread-meta",children:[o("span",{className:`dd-role dd-role-${u.role}`,children:bn[u.role]}),o(fe,{at:u.lastActivityAt,now:a})]})]})]}),o(U,{icon:Ct,label:"Unlink thread",size:13,onClick:()=>{n.unlinkThread(e.id,u.threadId).catch(c=>B(`Could not unlink: ${_(c)}`,"error"))}})]},u.threadId))}):d(ve,{icon:ge,title:"No agents yet",children:["Use ",o("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),d("div",{className:"dd-agents-hint",children:[o(Va,{size:13,"aria-hidden":!0}),d("span",{children:["Agents in this project already know this doc exists. Type ",o("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",o("code",{children:"design_doc_read"}),"."]})]})]})})}function Sn({doc:e,activePath:a,request:r,contextProjectId:t,compact:n=!1}){let s=j(),i=Ce(),[l,u]=b(!1),[c,f]=b(""),[C,m]=b(!1),[p,x]=b(t??""),[I,k]=b(null),D=Fe(),v=F(null),M=!e.projectId,w=D.data??[],H=M?p||w[0]?.id||"":e.projectId;O(()=>{r&&(f(r.prompt),m(!0),u(!0),requestAnimationFrame(()=>{let L=v.current;L&&(L.focus(),L.selectionStart=L.selectionEnd=L.value.length)}))},[r]),O(()=>{l&&m(L=>L||!!a&&a!==e.entryPath)},[l,a,e.entryPath]);let S=async L=>{if(!I){if(M&&!H){B("Add a project first: agents run inside a project.","error");return}k(L??"custom");try{let A=await s.askAgent(e.id,{...L?{action:L}:{},...c.trim()&&!L?{prompt:c.trim()}:{},path:C?a:null,...M?{projectId:H}:{}});St(i,e,A.threadId),B(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),u(!1),f("")}catch(A){B(`Could not start the agent: ${_(A)}`,"error")}finally{k(null)}}},N=L=>{L.key==="Enter"&&(L.metaKey||L.ctrlKey)&&(L.preventDefault(),c.trim()&&S(null))};return d(we,{open:l,onClose:()=>u(!1),className:"dd-ask",anchor:d("button",{type:"button",className:`btn primary dd-ask-trigger${n?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":l,onClick:()=>u(!l),children:[o(de,{size:13,"aria-hidden":!0}),n?null:"Ask agent",o(ie,{size:12,"aria-hidden":!0})]}),children:[d("div",{className:"dd-ask-head",children:[o("span",{className:"dd-ask-title",children:"Ask an agent"}),o("span",{className:"dd-muted",children:"Starts a new thread that edits this doc live"})]}),o("div",{className:"dd-ask-actions",role:"menu",children:rn.map(L=>{let A=xn(L.icon);return d("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!I,onClick:()=>{S(L.id)},title:L.description,children:[o("span",{className:"dd-ask-action-icon",children:I===L.id?o(K,{size:13}):o(A,{size:14,"aria-hidden":!0})}),d("span",{className:"dd-ask-action-text",children:[o("span",{className:"dd-ask-action-label",children:L.label}),o("span",{className:"dd-ask-action-desc",children:L.description})]})]},L.id)})}),d("div",{className:"dd-ask-custom",children:[o("textarea",{ref:v,className:"dd-input",rows:3,maxLength:Nt,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:c,onChange:L=>f(L.target.value),onKeyDown:N}),d("div",{className:"dd-ask-options",children:[a?d("label",{className:"dd-check",children:[o("input",{type:"checkbox",checked:C,onChange:L=>m(L.target.checked)}),"Focus on ",o("code",{children:a})]}):null,M?d("label",{className:"dd-field-inline",children:["Run in",d("select",{className:"dd-input dd-select",value:H,onChange:L=>x(L.target.value),children:[w.length?null:o("option",{value:"",children:"No projects"}),w.map(L=>o("option",{value:L.id,children:L.name},L.id))]})]}):null,o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary",disabled:!c.trim()||!!I,onClick:()=>{S(null)},children:[I==="custom"?o(K,{size:12}):null,"Start"]})]})]})]})}var Xs=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),Ks=/[A-Za-z][^\t\n\f\r />]*/y,Zs=/[\t\n\f\r /]*/y,Pn=/[\t\n\f\r ]*/y,Qs=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,Js=/[^\t\n\f\r >]*/y,Ys={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function ed(e){return e.includes("&")?e.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(a,r,t,n)=>{if(n)return Ys[n.toLowerCase()]??a;let s=r?Number(r):parseInt(t,16);return s>0&&s<=1114111?String.fromCodePoint(s):a}):e}function vn(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function Aa(e,a,r){return e.lastIndex=r,e.exec(a)?.[0]??""}function ad(e,a){let r=Aa(Ks,e,a+1),t=a+1+r.length,n=[];for(;t<e.length;){let s=Aa(Zs,e,t);if(t+=s.length,t>=e.length)return null;if(e[t]===">")return{name:r.toLowerCase(),attributes:n,selfClosing:s.endsWith("/"),start:a,end:t+1};let i=Aa(Qs,e,t)||e[t];t+=i.length,t+=Aa(Pn,e,t).length;let l=null;if(e[t]==="="){t+=1,t+=Aa(Pn,e,t).length;let u=e[t];if(u==='"'||u==="'"){let c=e.indexOf(u,t+1);if(c<0)return null;l=e.slice(t+1,c),t=c+1}else l=Aa(Js,e,t),t+=l.length}n.push({name:i.toLowerCase(),value:l===null?null:ed(l)})}return null}function*td(e){let a=0;for(;a<e.length;){let r=e.indexOf("<",a);if(r<0)return;let t=e[r+1]??"";if(e.startsWith("<!--",r)){let s=e.indexOf("-->",r+4);a=s<0?e.length:s+3;continue}if(t==="!"||t==="?"||t==="/"&&/[A-Za-z]/.test(e[r+2]??"")){let s=e.indexOf(">",r+2);a=s<0?e.length:s+1;continue}if(!/[A-Za-z]/.test(t)){a=r+1;continue}let n=ad(e,r);if(!n)return;if(a=n.end,Xs.has(n.name)){let s=new RegExp(`</${n.name}(?=[\\t\\n\\f\\r />])`,"ig");s.lastIndex=n.end;let i=s.exec(e),l=i?i.index:e.length,u=i?e.indexOf(">",l):-1,c=u<0?e.length:u+1;yield{...n,content:{start:n.end,end:l,closeEnd:c}},a=c;continue}yield n}}function _t(e,a){let r=-1;for(let n of td(e)){if(n.name==="head")return e.slice(0,n.end)+a+e.slice(n.end);if(n.name==="html"){r=n.end;continue}break}if(r>=0)return e.slice(0,r)+a+e.slice(r);let t=e.match(/^\s*<!doctype[^>]*>/i);return t?t[0]+a+e.slice(t[0].length):a+e}function Pt(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var od={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},rd={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"};var wn={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function La(e){let a=Pt(e),r=od[a];return r||(wn[a]?"code":"text")}function kn(e){return wn[Pt(e)]??""}function ze(e){return e==="image"||e==="font"}function An(e){return rd[Pt(e)]??null}var nd=/^[a-z][a-z0-9+.-]*:/i;function vt(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||nd.test(r))return null;let t=r.split(/[?#]/,1)[0],n=t;try{n=decodeURIComponent(t)}catch{}let s=n.startsWith("/")?[]:e.split("/").slice(0,-1);for(let i of n.split("/"))if(!(!i||i===".")){if(i===".."){if(!s.length)return null;s.pop();continue}s.push(i)}return s.length?s.join("/"):null}function Dn(e,a){let r=e.split("/"),t=a.split("/"),n=Math.min(r.length,t.length);for(let s=0;s<n;s+=1){let i=s===r.length-1,l=s===t.length-1;if(r[s]!==t[s])return i!==l?i?-1:1:r[s].localeCompare(t[s],void 0,{sensitivity:"base",numeric:!0})}return r.length-t.length}function Jt(e){let a=(e??"").split("/").filter(Boolean),[r,...t]=a;return{docId:r??null,path:t.length?t.join("/"):null}}function Da(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}function sd(e){let a=new TextEncoder().encode(e),r="";for(let t=0;t<a.length;t+=32768)r+=String.fromCharCode(...a.subarray(t,t+32768));return btoa(r)}function Yt(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${sd(e.content)}`;let a=An(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var Tn=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;function Mn(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function Rn(e,a){let r=new Set;for(let t of a.matchAll(Tn)){let n=vt(e,Mn(t[2]));n&&r.add(n)}return[...r]}function Fn(e,a,r){return r.size?a.replace(Tn,(t,n,s,i="")=>{let l=vt(e,Mn(s)),u=l?r.get(l):void 0;return u?`${n}${u}${i})`:t}):a}function eo(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(n=>n[0].length)),t="`".repeat(Math.max(3,r+1));return`${t}${a}
${e.replace(/\n$/,"")}
${t}`}function Bn(e,a){return eo(a,kn(e))}var dd=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function Nn(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let n of dd){let s=r.getPropertyValue(n).trim();s&&(a[n]=s)}let t=r.getPropertyValue("color-scheme").trim();return t&&(a["color-scheme"]=t),a}var ld=/^[^<>{};]*$/;function En(e,a){let t=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>ld.test(n)).map(([n,s])=>`${n}: ${s};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;return _t(e,t)}function On(e){let a=[],r=new Map;for(let t of[...e].sort((n,s)=>Dn(n.path,s.path))){let n=t.path.split("/"),s=a;for(let i=0;i<n.length-1;i+=1){let l=n.slice(0,i+1).join("/"),u=r.get(l);u||(u={kind:"folder",name:n[i],path:l,children:[]},r.set(l,u),s.push(u)),s=u.children}s.push({kind:"file",name:n.at(-1),path:t.path,file:t})}return a}var qn=/^(?:(?:https|ssh):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/|[\w.-]+@([\w.-]+):)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;function id(e){return e.length>0&&e.length<=100&&/^[\w./-]+$/.test(e)&&!e.startsWith("-")&&!e.startsWith("/")&&!e.endsWith("/")&&!e.endsWith(".")&&!e.endsWith(".lock")&&!e.includes("..")&&!e.includes("//")}var Ta=class extends Error{};function Hn(e){let a=typeof e.repo=="string"?e.repo.trim():"";if(a.length>300)throw new Ta("repository URL must be at most 300 characters");if(a&&!qn.test(a))throw new Ta("repository must be a clone URL such as https://github.com/owner/repo or git@github.com:owner/repo.git");let r=typeof e.branch=="string"?e.branch.trim():"";if(!id(r))throw new Ta("branch must be a valid git branch name, e.g. main or gh-pages");let t=e.folder??"root";if(t!=="root"&&t!=="docs")throw new Ta("folder must be root or docs");return{repo:a||null,branch:r,folder:t}}function _n(e){let a=e.trim().match(qn);if(!a)return null;let r=(a[1]??a[2]).toLowerCase(),[t,n]=[a[3],a[4]];return r==="github.com"?n.toLowerCase()===`${t.toLowerCase()}.github.io`?`https://${n}/`:`https://${t}.github.io/${n}/`:`https://${r}/pages/${t}/${n}/`}var ao={repo:"",branch:"main",folder:"root"},zn=e=>`zcc.design-docs.publish.${e}`;function Un(e){try{let a=JSON.parse(localStorage.getItem(zn(e))??"null");return a?{repo:typeof a.repo=="string"?a.repo:"",branch:typeof a.branch=="string"&&a.branch?a.branch:ao.branch,folder:a.folder==="docs"?"docs":"root"}:ao}catch{return ao}}function fd(e,a){try{localStorage.setItem(zn(e),JSON.stringify(a))}catch{}}function pd(e,a){try{return Hn({...e,repo:a?"":e.repo}),null}catch(r){return _(r)}}function md({doc:e,onClose:a}){let r=j(),t=Ce(),n=Fe(),[s,i]=b(()=>Un(e.id)),[l,u]=b(()=>!Un(e.id).repo),[c,f]=b(""),[C,m]=b(!1),p=!e.projectId,x=n.data??[],I=p?c||x[0]?.id||"":e.projectId,k=e.files.some(S=>S.kind==="html"),D=k?!l&&!s.repo.trim()?null:pd(s,l):"This doc has no HTML pages to publish. Add an index.html first.",v=k&&!D&&(l||!!s.repo.trim())&&(!p||!!I),M=!l&&!D&&s.repo.trim()?_n(s.repo):null,w=S=>i(N=>({...N,...S})),H=async()=>{if(!(!v||C)){m(!0);try{let S=await r.publish(e.id,{...l?{}:{repo:s.repo.trim()},branch:s.branch.trim(),folder:s.folder,...p?{projectId:I}:{}});fd(e.id,{...s,repo:l?"":s.repo.trim(),branch:s.branch.trim()}),St(t,e,S.threadId),B(`Publishing \u201C${e.title}\u201D. The agent reports the live URL when the push lands.`),a()}catch(S){B(`Could not start publishing: ${_(S)}`,"error")}finally{m(!1)}}};return d(aa,{title:"Publish site",onClose:a,footer:d($,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),d("button",{type:"button",className:"btn primary",disabled:!v||C,onClick:()=>{H()},children:[C?o(K,{size:12}):o(qe,{size:13,"aria-hidden":!0}),"Publish"]})]}),children:[o("p",{className:"dd-muted dd-publish-intro",children:"An agent exports this doc as a static site, commits it and pushes it with your git credentials. GitHub Pages then serves it."}),d("div",{className:"dd-publish-fields",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Repository"}),d("select",{className:"dd-input dd-select",value:l?"own":"other",onChange:S=>u(S.target.value==="own"),children:[o("option",{value:"own",children:"This project's repository"}),o("option",{value:"other",children:"Another repository\u2026"})]})]}),l?null:d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Clone URL"}),o("input",{className:"dd-input",value:s.repo,maxLength:300,placeholder:"https://github.com/owner/repo",spellCheck:!1,autoFocus:!0,onChange:S=>w({repo:S.target.value})})]}),d("div",{className:"dd-field-row",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Branch"}),o("input",{className:"dd-input",value:s.branch,maxLength:100,spellCheck:!1,onChange:S=>w({branch:S.target.value})})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Folder"}),d("select",{className:"dd-input dd-select",value:s.folder,onChange:S=>w({folder:S.target.value}),children:[o("option",{value:"root",children:"/ (root)"}),o("option",{value:"docs",children:"/docs"})]})]})]}),p?d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Run the agent in"}),d("select",{className:"dd-input dd-select",value:I,onChange:S=>f(S.target.value),children:[x.length?null:o("option",{value:"",children:"No projects"}),x.map(S=>o("option",{value:S.id,children:S.name},S.id))]})]}):null]}),D?o("p",{className:"dd-publish-problem",role:"alert",children:D}):d("p",{className:"dd-muted dd-field-help",children:[M?d($,{children:["Expected at ",o("code",{children:M}),"."," "]}):null,"Turn on Pages in the repository settings once: deploy from ",o("code",{children:s.branch.trim()||"main"}),","," ",o("code",{children:s.folder==="docs"?"/docs":"/ (root)"}),". Other files in the repository are left in place."]})]})}function jn({doc:e,compact:a=!1}){let[r,t]=b(!1);return d($,{children:[d("button",{type:"button",className:"btn dd-publish-trigger",title:"Publish as a GitHub Pages site","aria-label":a?"Publish":void 0,onClick:()=>t(!0),children:[o(qe,{size:13,"aria-hidden":!0}),a?null:"Publish"]}),r?o(md,{doc:e,onClose:()=>t(!1)}):null]})}var $n=e=>e.key==="Enter"&&(e.metaKey||e.ctrlKey);function gd({onSend:e,onCancel:a}){let[r,t]=b(""),[n,s]=b(!1),i=async()=>{let l=r.trim();if(!l||n)return;s(!0);let u=await e(l);s(!1),u&&t("")};return d("div",{className:"dd-reply-composer",children:[o("textarea",{className:"dd-input dd-composer-input",placeholder:"Reply\u2026 agents see the whole thread","aria-label":"Reply",value:r,maxLength:8e3,rows:2,autoFocus:!0,onChange:l=>t(l.target.value),onKeyDown:l=>{$n(l)?(l.preventDefault(),i()):l.key==="Escape"&&(l.preventDefault(),a())}}),d("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send \xB7 Esc to cancel"}),d("span",{className:"dd-reply-buttons",children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:!r.trim()||n,onClick:()=>{i()},children:"Reply"})]})]})]})}function hd({comment:e,fileGone:a,now:r,onToggle:t,onDelete:n,onDeleteReply:s,onReply:i,onFocus:l}){let u=e.status==="resolved",[c,f]=b(!1);return d("article",{className:`dd-comment${u?" dd-comment-resolved":""}`,children:[d("header",{className:"dd-comment-head",children:[o(Le,{actor:e.author}),o(fe,{at:e.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(U,{icon:mt,label:"Reply",onClick:()=>f(!0),size:13}),o(U,{icon:u?Ue:Oe,label:u?"Reopen":"Resolve",onClick:t,size:13}),o(U,{icon:he,label:"Delete comment",onClick:n,danger:!0,size:13})]}),e.path||e.quote?d("button",{type:"button",className:"dd-comment-anchor",onClick:l,disabled:!l,title:a?"This file was deleted":"Show in the document",children:[e.path?d("span",{className:`dd-comment-path${a?" dd-comment-path-gone":""}`,children:[e.path,a?" (deleted)":""]}):null,e.quote?o("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,o("div",{className:"dd-comment-body",children:o(za,{content:e.body})}),e.replies.length?o("ol",{className:"dd-replies","aria-label":"Replies",children:e.replies.map(C=>d("li",{className:"dd-reply",children:[d("header",{className:"dd-comment-head",children:[o(Le,{actor:C.author}),o(fe,{at:C.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(U,{icon:he,label:"Delete reply",onClick:()=>s(C.id),danger:!0,size:12})]}),o("div",{className:"dd-comment-body",children:o(za,{content:C.body})})]},C.id))}):null,c?o(gd,{onCancel:()=>f(!1),onSend:async C=>{let m=await i(C);return m&&f(!1),m}}):null]})}function Vn({doc:e,activePath:a,now:r,pendingQuote:t,onClearQuote:n,draft:s,onDraft:i,onFocusComment:l}){let u=j(),[c,f]=le("comments-scope","all"),[C,m]=b(!1),[p,x]=b(!1),[I,k]=b(null),D=F(null);O(()=>{t&&D.current?.focus()},[t]);let v=X(()=>e.comments.filter(y=>c==="all"||!y.path||y.path===a),[e.comments,c,a]),M=v.filter(y=>y.status==="open"),w=v.filter(y=>y.status==="resolved"),H=async(y,q)=>{try{return await y(),!0}catch(W){return B(`${q}: ${_(W)}`,"error"),!1}},S=t?t.path:a,N=async()=>{let y=s.trim();if(!(!y||p)){x(!0);try{await u.addComment(e.id,{body:y,...S?{path:S}:{},...t?{quote:t.text}:{}}),i(""),n()}catch(q){B(`Could not add the comment: ${_(q)}`,"error")}finally{x(!1)}}},L=y=>{$n(y)&&(y.preventDefault(),N())},A=X(()=>new Set(e.files.map(y=>y.path)),[e.files]),P=y=>{let q=!!y.path&&!A.has(y.path);return o(hd,{comment:y,fileGone:q,now:r,onToggle:()=>{H(()=>u.setCommentStatus(e.id,y.id,y.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>k({title:"Delete comment",body:y.replies.length?`Delete this comment and its ${y.replies.length===1?"reply":`${y.replies.length} replies`}? This cannot be undone.`:"Delete this comment? This cannot be undone.",confirmLabel:"Delete",danger:!0,run:()=>{H(()=>u.deleteComment(e.id,y.id),"Could not delete the comment")}}),onDeleteReply:W=>{H(()=>u.deleteComment(e.id,W),"Could not delete the reply")},onReply:W=>H(()=>u.replyToComment(e.id,y.id,W),"Could not reply"),onFocus:!q&&(y.quote||y.path)?()=>l(y):void 0},y.id)};return d("div",{className:"dd-rail-pane dd-comments",children:[o("div",{className:"dd-rail-toolbar",children:d("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[o("button",{type:"button",className:c==="all"?"on":"",onClick:()=>f("all"),children:"All files"}),o("button",{type:"button",className:c==="file"?"on":"",onClick:()=>f("file"),disabled:!a,children:"This file"})]})}),d("div",{className:"dd-rail-scroll",children:[M.length===0?o(ve,{icon:ye,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):M.map(P),w.length?d("div",{className:"dd-resolved",children:[d("button",{type:"button",className:"dd-disclosure",onClick:()=>m(!C),children:[C?o(ie,{size:13,"aria-hidden":!0}):o(ua,{size:13,"aria-hidden":!0}),"Resolved (",w.length,")"]}),C?w.map(P):null]}):null]}),d("div",{className:"dd-composer",children:[t?d("div",{className:"dd-composer-quote",children:[o("span",{className:"dd-comment-quote",children:t.text}),o(U,{icon:ue,label:"Remove quote",onClick:n,size:12})]}):null,o("textarea",{ref:D,className:"dd-input dd-composer-input",placeholder:S?`Comment on ${S}\u2026 agents see open comments`:"Leave a comment\u2026",value:s,maxLength:8e3,rows:3,onChange:y=>i(y.target.value),onKeyDown:L}),d("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),o("button",{type:"button",className:"btn primary",disabled:!s.trim()||p,onClick:()=>{N()},children:"Comment"})]})]}),I?o(Be,{request:I,onClose:()=>k(null)}):null]})}function xd(e){let a=document.createElement("textarea");a.value=e,a.setAttribute("readonly",""),a.style.position="fixed",a.style.top="-9999px";let r=document.activeElement instanceof HTMLElement?document.activeElement:null;document.body.appendChild(a);try{return a.select(),document.execCommand("copy")}catch{return!1}finally{a.remove(),r?.focus()}}async function Wn(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return xd(e)}var Ld=(()=>{let e=new Uint32Array(256);for(let a=0;a<256;a+=1){let r=a;for(let t=0;t<8;t+=1)r=r&1?3988292384^r>>>1:r>>>1;e[a]=r>>>0}return e})();function Id(e){let a=4294967295;for(let r of e)a=Ld[(a^r)&255]^a>>>8;return(a^4294967295)>>>0}function Cd(e){let a=Math.max(e.getFullYear(),1980);return{time:e.getHours()<<11|e.getMinutes()<<5|Math.floor(e.getSeconds()/2),date:a-1980<<9|e.getMonth()+1<<5|e.getDate()}}var Xn=2048,to=20;function Kn(e,a=new Date){let r=new TextEncoder,{time:t,date:n}=Cd(a),s=[],i=[],l=0;for(let p of e){let x=r.encode(p.path),I=Id(p.data),k=p.data.length,D=new Uint8Array(30+x.length),v=new DataView(D.buffer);v.setUint32(0,67324752,!0),v.setUint16(4,to,!0),v.setUint16(6,Xn,!0),v.setUint16(8,0,!0),v.setUint16(10,t,!0),v.setUint16(12,n,!0),v.setUint32(14,I,!0),v.setUint32(18,k,!0),v.setUint32(22,k,!0),v.setUint16(26,x.length,!0),v.setUint16(28,0,!0),D.set(x,30),s.push(D,p.data);let M=new Uint8Array(46+x.length),w=new DataView(M.buffer);w.setUint32(0,33639248,!0),w.setUint16(4,to,!0),w.setUint16(6,to,!0),w.setUint16(8,Xn,!0),w.setUint16(10,0,!0),w.setUint16(12,t,!0),w.setUint16(14,n,!0),w.setUint32(16,I,!0),w.setUint32(20,k,!0),w.setUint32(24,k,!0),w.setUint16(28,x.length,!0),w.setUint32(42,l,!0),M.set(x,46),i.push(M),l+=D.length+k}let u=i.reduce((p,x)=>p+x.length,0),c=new Uint8Array(22),f=new DataView(c.buffer);f.setUint32(0,101010256,!0),f.setUint16(8,e.length,!0),f.setUint16(10,e.length,!0),f.setUint32(12,u,!0),f.setUint32(16,l,!0);let C=new Uint8Array(l+u+c.length),m=0;for(let p of[...s,...i,c])C.set(p,m),m+=p.length;return C}function bd(e){if(e.encoding==="utf8")return new TextEncoder().encode(e.content);let a=atob(e.content),r=new Uint8Array(a.length);for(let t=0;t<a.length;t+=1)r[t]=a.charCodeAt(t);return r}function Zn(e,a,r){return Kn(a.map(t=>({path:`${e}/${t.path}`,data:bd(t)})),r)}var yd=3e4;function Qn(e,a,r){let t=URL.createObjectURL(new Blob([a],{type:r})),n=document.createElement("a");n.href=t,n.download=e,n.style.display="none",document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(t),yd)}function Sd({doc:e,projects:a,onClose:r,onMove:t}){let[n,s]=b(e.projectId??"");return d(aa,{title:"Move design doc",onClose:r,footer:d($,{children:[o("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.projectId??""),onClick:()=>{t(n||null).then(r)},children:"Move"})]}),children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),d("select",{className:"dd-input dd-select",value:n,onChange:i=>s(i.target.value),children:[o("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(i=>o("option",{value:i.id,children:i.name},i.id))]})]}),o("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}function Pd({doc:e,onClose:a,onPick:r}){let t=Pa({...e.projectId?{projectId:e.projectId}:{},status:"active"}),[n,s]=b(e.alternativeTo??""),i=t.data??[],l=i.filter(c=>c.id!==e.id&&!c.alternativeTo),u=i.filter(c=>c.alternativeTo===e.id).length;return d(aa,{title:"Alternative to\u2026",onClose:a,footer:d($,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.alternativeTo??"")||u>0,onClick:()=>{r(n||null).then(a)},children:"Save"})]}),children:[t.data?d("label",{className:"dd-field",children:[d("span",{className:"dd-field-label",children:["\u201C",e.title,"\u201D is an alternative to"]}),d("select",{className:"dd-input dd-select",value:n,disabled:u>0,onChange:c=>s(c.target.value),children:[o("option",{value:"",children:"Nothing: a doc of its own"}),l.map(c=>o("option",{value:c.id,children:c.title},c.id))]})]}):o(K,{label:"Loading design docs"}),o("p",{className:"dd-muted dd-field-help",children:u>0?`This doc has ${u} alternative${u===1?"":"s"} of its own. Detach them first: alternatives nest one level deep.`:"Alternatives are listed under the doc they compete with, so competing proposals stay together."})]})}async function Jn(e,a){await Wn(e)?B(`Copied ${a}`):B(`Could not copy ${a}`,"error")}function Ut(e){let a=j(),[r,t]=b(null),[n,s]=b(null),[i,l]=b(null),u=async(p,x)=>{try{await a.update(p.id,x)}catch(I){B(`Could not update the doc: ${_(I)}`,"error")}},c=async(p,x)=>{try{await a.pin(p.id,x)}catch(I){B(`Could not ${x?"pin":"unpin"} the doc: ${_(I)}`,"error")}},f=async p=>{try{let x=await a.siteFiles(p.id);Qn(`${x.slug}.zip`,Zn(x.slug,x.files),"application/zip")}catch(x){B(`Could not download the doc: ${_(x)}`,"error")}};return{items:(p,x,I,k)=>{let D=p.status==="archived",v=M=>()=>{x(),M()};return d($,{children:[k?o(ce,{icon:_e,label:"Open",onSelect:v(k)}):null,p.pinnedAt!==null?o(ce,{icon:pt,label:"Unpin",onSelect:v(()=>{c(p,!1)})}):o(ce,{icon:ga,label:"Pin to top",onSelect:v(()=>{c(p,!0)})}),o(ce,{icon:Za,label:"Copy chat reference",hint:"Paste into any thread",onSelect:v(()=>{Jn(un(p.id),"reference")})}),o(ce,{icon:fa,label:"Copy id",hint:p.slug,onSelect:v(()=>{Jn(p.id,"id")})}),o(ce,{icon:Ja,label:"Download .zip",hint:`${p.slug}.zip`,onSelect:v(()=>{f(p)})}),o(ce,{icon:ot,label:"Move to project\u2026",onSelect:v(()=>t(p))}),o(ce,{icon:nt,label:"Alternative to\u2026",hint:p.alternativeTo?"Linked":void 0,onSelect:v(()=>s(p))}),o(ce,{icon:D?Ga:$a,label:D?"Unarchive":"Archive",onSelect:v(()=>{u(p,{status:D?"draft":"archived"})})}),o(ce,{icon:he,label:"Delete\u2026",danger:!0,onSelect:v(()=>l({title:"Delete design doc",body:d($,{children:["Delete ",o("strong",{children:p.title})," with its ",p.fileCount," file",p.fileCount===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await a.remove(p.id),B(`Deleted \u201C${p.title}\u201D`),I()}catch(M){B(`Could not delete: ${_(M)}`,"error")}}}))})]})},dialogs:d($,{children:[r?o(Sd,{doc:r,projects:e,onClose:()=>t(null),onMove:p=>u(r,{projectId:p})}):null,n?o(Pd,{doc:n,onClose:()=>s(null),onPick:p=>u(n,{alternativeTo:p})}):null,i?o(Be,{request:i,onClose:()=>l(null)}):null]})}}function es({value:e,placeholder:a,maxLength:r,multiline:t=!1,className:n="",label:s,onSave:i}){let[l,u]=b(!1),[c,f]=b(e),C=F(!1);O(()=>{l||f(e)},[e,l]);let m=async x=>{if(C.current)return;C.current=!0,u(!1);let I=c.trim();if(x&&I!==e.trim())try{await i(I)}catch{f(e)}else f(e)},p=x=>{x.key==="Escape"?(x.preventDefault(),m(!1)):x.key==="Enter"&&(!t||x.metaKey||x.ctrlKey||!x.shiftKey)&&(x.preventDefault(),m(!0))};if(l){let x={className:`dd-editable-input ${n}`,value:c,maxLength:r,"aria-label":s,autoFocus:!0,onChange:I=>f(I.target.value),onKeyDown:p,onBlur:()=>{m(!0)}};return t?o("textarea",{...x,rows:2,placeholder:a}):o("input",{...x,placeholder:a})}return o("button",{type:"button",className:`dd-editable ${n}${e?"":" dd-editable-empty"}`,title:`Edit ${s.toLowerCase()}`,onClick:()=>{C.current=!1,u(!0)},children:e||a})}function wd({tags:e,onChange:a}){let[r,t]=b(!1),[n,s]=b(""),i=()=>{let l=n.split(",").map(c=>c.trim().toLowerCase().slice(0,32)).filter(Boolean);s(""),t(!1);let u=[...new Set([...e,...l])].slice(0,12);u.length!==e.length&&a(u)};return d("span",{className:"dd-tags",children:[e.map(l=>d("span",{className:"dd-tag",children:[o(fa,{size:10,"aria-hidden":!0}),l,o("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${l}`,onClick:()=>a(e.filter(u=>u!==l)),children:o(ue,{size:10,"aria-hidden":!0})})]},l)),r?o("input",{className:"dd-input dd-tag-input",value:n,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:l=>s(l.target.value),onBlur:i,onKeyDown:l=>{l.key==="Enter"?(l.preventDefault(),i()):l.key==="Escape"&&(s(""),t(!1))}}):e.length<12?d("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>t(!0),children:[o(xe,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function kd({status:e,onChange:a}){let[r,t]=b(!1);return o(we,{open:r,onClose:()=>t(!1),align:"start",className:"dd-menu",anchor:o("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>t(!r),title:"Change status",children:o(ea,{status:e})}),children:Et.map(n=>o(ce,{label:o(ea,{status:n}),checked:n===e,icon:n===e?Oe:void 0,onSelect:()=>{t(!1),n!==e&&a(n)}},n))})}function as({doc:e,projects:a,compact:r,collapsible:t=!1,actions:n,onDeleted:s}){let i=j(),[l,u]=b(!1),[c,f]=b(!1),C=Ut(a),m=e.projectId?a.find(I=>I.id===e.projectId):null,p=async I=>{try{await i.update(e.id,I)}catch(k){throw B(`Could not update the doc: ${_(k)}`,"error"),k}},x=r||t&&!c;return d("header",{className:`dd-doc-header${r||t?" dd-doc-header-compact":""}`,children:[d("div",{className:"dd-doc-title-row",children:[o(es,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:I=>I?p({title:I}):void 0}),o("span",{className:"dd-spacer"}),n,o(we,{open:l,onClose:()=>u(!1),className:"dd-menu",anchor:o(U,{icon:De,label:"More actions",active:l,onClick:()=>u(!l)}),children:C.items(e,()=>u(!1),s)})]}),x?null:o(es,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:I=>p({summary:I})}),d("div",{className:"dd-doc-meta",children:[o(kd,{status:e.status,onChange:I=>{p({status:I}).catch(()=>{})}}),d("span",{className:"dd-doc-project",title:m?`Project \xB7 ${m.name}`:"Visible to agents in every project",children:[m?null:o(st,{size:12,"aria-hidden":!0}),m?m.name:e.projectId?"Unknown project":"Global"]}),x?null:o(wd,{tags:e.tags,onChange:I=>{p({tags:I}).catch(()=>{})}}),o("span",{className:"dd-spacer"}),d("span",{className:"dd-doc-updated",children:[o(Le,{actor:e.updatedBy})," ",o(fe,{at:e.updatedAt,now:Date.now()})]}),t?o(U,{icon:c?Xa:ie,label:c?"Hide summary and tags":"Show summary and tags",active:c,onClick:()=>f(!c)}):null]}),C.dialogs]})}function ts({docId:e,file:a,removed:r=!1,split:t,renderPreview:n,onStateChange:s,onSaved:i}){let l=j(),[u,c]=b(a.content),[f,C]=b({content:a.content,revision:a.revision}),[m,p]=b(!1),[x,I]=b(null),k=u!==f.content,D=Fo(u),v=F({dirty:k,draft:u,saved:f});v.current={dirty:k,draft:u,saved:f},O(()=>{let{dirty:S,draft:N,saved:L}=v.current;a.revision!==L.revision&&(!S||a.content===N?(c(a.content),C({content:a.content,revision:a.revision}),I(null)):I({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),O(()=>{s?.({dirty:k,saving:m})},[k,m,s]);let M=Ae(async S=>{if(!m){p(!0);try{let N=S??(r?0:f.revision),L=await l.writeFile(e,{path:a.path,content:u,baseRevision:N});C({content:u,revision:L.revision}),I(null),i?.(L)}catch(N){if(nn(N)){let L=await l.readFile(e,a.path).catch(()=>null);I({revision:L?.revision??f.revision+1,by:L?.updatedBy??a.updatedBy})}else B(`Could not save ${a.path}: ${_(N)}`,"error")}finally{p(!1)}}},[l,e,u,a.path,a.updatedBy,i,r,f.revision,m]),w=async()=>{try{let S=await l.readFile(e,a.path);c(S.content),C({content:S.content,revision:S.revision}),I(null)}catch(S){B(`Could not reload ${a.path}: ${_(S)}`,"error")}},H=S=>{if((S.metaKey||S.ctrlKey)&&S.key.toLowerCase()==="s"){S.preventDefault(),k&&!x&&M();return}if(S.key==="Tab"&&!S.metaKey&&!S.ctrlKey&&!S.altKey){S.preventDefault();let N=S.currentTarget,{selectionStart:L,selectionEnd:A,value:P}=N,y=`${P.slice(0,L)}  ${P.slice(A)}`;c(y),requestAnimationFrame(()=>{N.selectionStart=N.selectionEnd=L+2})}};return d("div",{className:"dd-editor",children:[r&&k&&!x?d("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(be,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[a.path," was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them."]})]}):null,x?d("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(Pe,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[o(Le,{actor:x.by})," saved revision ",x.revision," while you were editing."]}),d("button",{type:"button",className:"btn",onClick:()=>{w()},children:[o(Ue,{size:12,"aria-hidden":!0})," Discard mine"]}),o("button",{type:"button",className:"btn",onClick:()=>{M(x.revision)},children:"Overwrite with mine"})]}):null,d("div",{className:`dd-editor-body${t?" dd-editor-split":""}`,children:[o("textarea",{className:"dd-editor-input",value:u,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:S=>c(S.target.value),onKeyDown:H,autoFocus:!0}),t?o("div",{className:"dd-editor-preview",children:n(D)}):null]}),d("div",{className:"dd-editor-footer",children:[d("span",{className:"dd-editor-state",children:[m?o(K,{size:12,label:"Saving"}):null,m?"Saving\u2026":k?"Unsaved changes":`Saved \xB7 rev ${f.revision}`]}),o("span",{className:"dd-editor-hint",children:"\u2318S to save"}),o("button",{type:"button",className:"btn",disabled:!k||m,onClick:()=>c(f.content),children:"Revert"}),d("button",{type:"button",className:"btn primary",disabled:!k||m||!!x,onClick:()=>{M()},children:[o(gt,{size:12,"aria-hidden":!0})," Save"]})]})]})}var zt="dd-comment",jt="dd-comment-focus";function Ad(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}var Dd=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE"]);function Td(e){let a=e.ownerDocument.createTreeWalker(e,4,{acceptNode:u=>Dd.has(u.parentElement?.tagName.toUpperCase()??"")?2:1}),r=[],t=[],n="";for(let u=a.nextNode();u;u=a.nextNode())t.push(n.length),r.push(u),n+=u.data;let s="",i=[],l=!0;for(let u=0;u<n.length;u+=1){let c=n[u];/\s/.test(c)?(l||(s+=" ",i.push(u)),l=!0):(s+=c,i.push(u),l=!1)}return{nodes:r,starts:t,normalized:s,map:i}}function os(e,a){let r=0,t=e.starts.length-1;for(;r<t;){let n=r+t+1>>1;e.starts[n]<=a?r=n:t=n-1}return[e.nodes[r],a-e.starts[r]]}function no(e,a){let r=new Map;if(!a.length)return r;let t=Td(e);if(!t.nodes.length)return r;for(let n of a){if(r.has(n))continue;let s="",i=-1;for(let m of new Set([n.replace(/\s+/g," ").trim(),Ad(n)]))if(!(m.length<2)&&(i=t.normalized.indexOf(m),i>=0)){s=m;break}if(i<0)continue;let[l,u]=os(t,t.map[i]),[c,f]=os(t,t.map[i+s.length-1]),C=e.ownerDocument.createRange();C.setStart(l,u),C.setEnd(c,f+1),r.set(n,C)}return r}function Md(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var rs=new Map;function Ia(e,a,r){let t=Md();if(!t)return;let n=rs.get(e)??new Map;rs.set(e,n),r.length?n.set(a,r):n.delete(a);let s=[...n.values()].flat();s.length?t.registry.set(e,new t.Highlight(...s)):t.registry.delete(e)}var ss="dd-page";var Rd="dd-page-hello",ds=50,Fd=256*1024,lo=1e3,so=4e3,Bd=500,Nd=500,Ed=new Set(["error","missing","blocked"]);function kt(e){return e&&typeof e=="object"&&!Array.isArray(e)?e:null}function Ma(e,a){return typeof e=="string"&&e.length<=a?e:null}function io(e,a){return typeof e=="string"?e.slice(0,a):null}function Gt(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function ns(e){return!Array.isArray(e)||e.length>Nd?null:e.every(a=>typeof a=="string"&&a.length<=500)?e:null}function Od(e){if(e===null)return null;let a=kt(e);if(!a)return;let[r,t,n,s]=[a.top,a.left,a.bottom,a.right].map(Gt);return r===null||t===null||n===null||s===null?void 0:{top:r,left:t,bottom:n,right:s}}function qd(e){let a=kt(e);if(!a)return null;let r=0;for(let[t,n]of Object.entries(a))if(typeof n!="string"||(r+=t.length+n.length,r>Fd))return null;return{...a}}function Hd(e){let a=kt(e),r=a?.kind,t=io(a?.message,Bd);if(!a||!Ed.has(r)||!t)return null;let n=io(a.source,lo),s=Gt(a.line);return{kind:r,message:t,...n?{source:n}:{},...s!==null&&s>0?{line:Math.floor(s)}:{}}}function ls(e){let a=kt(e);if(!a)return null;switch(a.type){case"ready":return{type:"ready"};case"fetch":{let r=Ma(a.path,lo);return Number.isSafeInteger(a.id)&&a.id>=0&&r!==null?{type:"fetch",id:a.id,path:r}:null}case"navigate":{let r=Ma(a.path,lo),t=a.hash===null?null:Ma(a.hash,so);return r===null||t===null&&a.hash!==null||typeof a.newTab!="boolean"?null:{type:"navigate",path:r,hash:t,newTab:a.newTab,redirect:a.redirect===!0}}case"open":{let r=Ma(a.url,so);return r===null?null:{type:"open",url:r}}case"problem":{let r=Hd(a.problem);return r?{type:"problem",problem:r}:null}case"selection":{let r=io(a.text,500),t=Od(a.rect);return r===null||t===void 0?null:{type:"selection",text:r,rect:t}}case"anchors":{let r=ns(a.found),t=ns(a.missing);return r&&t?{type:"anchors",found:r,missing:t}:null}case"focused":{let r=Ma(a.quote,500);return r===null||typeof a.found!="boolean"?null:{type:"focused",quote:r,found:a.found}}case"scroll":{let r=Gt(a.x),t=Gt(a.y);return r===null||t===null?null:{type:"scroll",x:r,y:t}}case"hash":{let r=a.hash===null?null:Ma(a.hash,so);return r===null&&a.hash!==null?null:{type:"hash",hash:r}}case"storage":{let r=qd(a.entries);return r?{type:"storage",entries:r}:null}default:return null}}function is(e){return kt(e)?.dd===Rd}var Lg=12*1024*1024,uo=960*1024;function us(e,a,r){let t=new Map(a.map(n=>[n.path,n.revision]));return!r&&e.revision!==(t.get(e.path)??null)||e.deps.some(n=>(t.get(n.path)??0)!==n.revision)?!0:e.missing.some(n=>t.has(n))}function co(e,a){let r=[...e],t=new Set(e.map(n=>n.path));for(let[n,s]of a){if(r.length>=500)break;t.has(n)||r.push({path:n,revision:s})}return r}function cs(e){return JSON.stringify(e).replace(/</g,"\\u003c")}var _d=new URL("./page-runtime.js",import.meta.url).href,fs=[{id:"full",label:"Full width",icon:ut,width:null},{id:"tablet",label:"Tablet (768px)",icon:It,width:768},{id:"phone",label:"Phone (390px)",icon:xt,width:390}],Ud=400,zd=1500,jd=6,Gd=200,$d=20,Vd=50,Wd={error:"Error",missing:"Missing",blocked:"Blocked"},Ra=new Map;function Xd(e,a){for(Ra.delete(e),Ra.set(e,a);Ra.size>$d;)Ra.delete(Ra.keys().next().value)}var Ca=new Map,fo=(e,a)=>`${e}\0${a}`;function Kd(e,a,r){let t=fo(e,a);for(Ca.delete(t),Ca.set(t,r);Ca.size>Vd;)Ca.delete(Ca.keys().next().value)}function Zd(e,a,r,t){let n=`<script type="application/json" id="${ss}">${cs(a)}<\/script><script src="${vn(r)}"><\/script>`,s=_t(e.html,n);return e.styled?s:En(s,t)}function Qd(e,a){let r=0,t=[],n=()=>{for(;r<e&&t.length;){let s=t.shift();r+=1,Promise.resolve().then(s).catch(()=>{}).finally(()=>{r-=1,n()})}};return{add(s){return r+t.length>=a?!1:(t.push(s),n(),!0)},clear(){t.length=0}}}function Jd(e){return e.length*6<uo?!1:new TextEncoder().encode(JSON.stringify(e)).byteLength>uo}function Yd(e,a){return e.kind===a.kind&&e.message===a.message&&e.source===a.source&&e.line===a.line}function ps({docId:e,file:a,files:r,draft:t=!1,quotes:n=[],onOpenPath:s,onQuote:i,onAskAbout:l,handleRef:u}){let c=j(),f=a.path,[C,m]=b("full"),[p,x]=b(null),[I,k]=b(!0),[D,v]=b(null),[M,w]=b(!1),[H,S]=b([]),[N,L]=b(!1),[A,P]=b(null),[y,q]=b(null),[W,ne]=b(0),pe=F(null),me=F(null),Q=F(null),Z=F(!1),E=F(null),ae=F([]),te=F(new Map),re=F(null),Ie=F(""),ke=F({hash:Ca.get(fo(e,f))??null,scroll:null}),T=F(n);T.current=n;let V=X(()=>Qd(jd,Gd),[]);O(()=>{Ca.delete(fo(e,f))},[e,f]);let z=t?a.content:null,[se,Na]=b(z);O(()=>{if(z===se)return;if(z===null){Na(null);return}let g=setTimeout(()=>Na(z),Ud);return()=>clearTimeout(g)},[z,se]);let Mt=r.find(g=>g.path===f)?.revision??null,je=se===null?Mt:null,Ge=F(0);O(()=>{let g=++Ge.current;if(se!==null&&Jd(se)){w(!0),k(!1);return}w(!1),k(!0),c.renderPage(e,{path:f,draft:se??void 0}).then(R=>{if(g!==Ge.current)return;let J={mode:"frame",docId:e,path:f,hash:ke.current.hash,scroll:ke.current.scroll,quotes:[...T.current],storage:Ra.get(e)};x({id:g,page:R,srcDoc:Zd(R,J,_d,R.styled?{}:Nn()),draft:se!==null}),v(null),k(!1)},R=>{g===Ge.current&&(v(_(R)),k(!1))})},[c,e,f,se,je,W]);let ee=F("");O(()=>{if(!p||I)return;let g={...p.page,deps:co(p.page.deps,te.current)};if(!us(g,r,se!==null))return;let R=r.map(J=>`${J.path}@${J.revision}`).join("|");ee.current!==R&&(ee.current=R,ne(J=>J+1))},[p,r,I,se]);let Ne=(g,R=Q.current)=>{try{R?.postMessage(g)}catch{}},Ea=g=>{S(R=>R.length>=ds||R.some(J=>Yd(J,g))?R:[...R,g]),ra()},Wt=F(H);Wt.current=H;let oe=F(p);oe.current=p;let ra=()=>{re.current&&clearTimeout(re.current),re.current=setTimeout(()=>{re.current=null;let g=oe.current,R=g?.page;if(!R||g.draft||R.revision===null||!Z.current)return;let J={path:R.path,revision:R.revision,deps:co(R.deps,te.current),missing:R.missing,problems:Wt.current,unanchored:ae.current},Y=JSON.stringify(J);Y!==Ie.current&&(Ie.current=Y,c.reportRender(e,J).catch(()=>{Ie.current=""}))},zd)},na=(g,R)=>{g!==f&&(R!==null&&Kd(e,g,R),s?.(g))},Xt=(g,R,J)=>{let Y=new Set(r.map(la=>la.path)),Ee=Y.has(g)?g:Y.has(`${g}/index.html`)?`${g}/index.html`:null;if(!Ee){B(`${g} is not a file in this design doc`,"error");return}J?P(Ee===f?null:{path:Ee,hash:R}):na(Ee,R)},Oa=g=>{let R;try{R=new URL(g)}catch{return}if(R.protocol!=="https:"&&R.protocol!=="http:"){B(`Zana opens web links only, not ${R.protocol} links`,"error");return}let J=globalThis.navigator?.userActivation;if(J&&!J.isActive){Ea({kind:"blocked",message:`The page tried to open ${R.href} without a click`});return}globalThis.open(R.href,"_blank","noopener,noreferrer")},sa=(g,R)=>{let J=pe.current,Y=me.current;if(!i||!g||!R||!J||!Y){q(null);return}let Ee=J.getBoundingClientRect(),la=Y.getBoundingClientRect(),qs=Ee.top-la.top+Y.scrollTop+R.top-36,Hs=Ee.left-la.left+Y.scrollLeft+(R.left+R.right)/2;q({text:g,top:Math.max(4,qs),left:Math.min(Math.max(80,Hs),Math.max(80,Y.scrollWidth-80))})},ba=(g,R)=>{switch(g.type){case"ready":Z.current=!0,Ne({type:"highlight",quotes:[...T.current]},R),E.current!==null&&Ne({type:"focus",quote:E.current},R),E.current=null,ra();break;case"fetch":{!te.current.has(g.path)&&te.current.size<500&&(te.current.set(g.path,r.find(Y=>Y.path===g.path)?.revision??0),ra()),V.add(async()=>{let Y=null;try{Y=await c.readPageFile(e,g.path)}catch{Y=null}Q.current===R&&Ne({type:"file",id:g.id,file:Y},R)})||Ne({type:"file",id:g.id,file:null},R);break}case"navigate":Xt(g.path,g.hash,g.redirect);break;case"open":Oa(g.url);break;case"problem":Ea(g.problem);break;case"selection":sa(g.text,g.rect);break;case"anchors":ae.current=g.missing,ra();break;case"focused":g.found||B("That passage is no longer on this page");break;case"scroll":ke.current.scroll={x:g.x,y:g.y};break;case"hash":ke.current.hash=g.hash;break;case"storage":Xd(e,g.entries);break;default:break}},qa=F(ba);qa.current=ba,O(()=>{let g=R=>{let J=pe.current,Y=R.ports?.[0];!J||!Y||R.source!==J.contentWindow||!is(R.data)||(Q.current?.close(),Q.current=Y,Z.current=!1,ae.current=[],te.current=new Map,V.clear(),S([]),P(null),q(null),Y.onmessage=Ee=>{if(Q.current!==Y)return;let la=ls(Ee.data);la&&qa.current(la,Y)})};return globalThis.addEventListener("message",g),()=>{globalThis.removeEventListener("message",g),Q.current?.close(),Q.current=null,V.clear(),re.current&&clearTimeout(re.current)}},[V]);let Ha=n.join("\0");O(()=>{Z.current&&Ne({type:"highlight",quotes:Ha?Ha.split("\0"):[]})},[Ha]),O(()=>{if(!u)return;let g={focusQuote(R){return Z.current&&Q.current?Ne({type:"focus",quote:R}):E.current=R,!0}};return u.current=g,()=>{u.current===g&&(u.current=null)}},[u]);let da=[...X(()=>p?[...p.page.missing.map(g=>({kind:"missing",message:`The page uses ${g}, which is not a file in this doc`})),...p.page.warnings.map(g=>({kind:"blocked",message:g}))]:[],[p]),...H],Rt=async()=>{try{let{url:g}=await c.pageLink(e,f);globalThis.open(g,"_blank","noopener,noreferrer")}catch(g){B(_(g),"error")}},_a=g=>{!y||!g||(g(y.text),q(null),Ne({type:"clear-selection"}))},Ua=fs.find(g=>g.id===C).width;return d("div",{className:"dd-html-stage",onMouseDown:g=>{g.target.closest?.(".dd-selection-chip")||q(null)},children:[d("div",{className:"dd-html-toolbar",children:[d("div",{className:"dd-html-status",children:[I?o(K,{size:12,label:"Rendering page"}):null,t?o("span",{className:"dd-muted",children:"Unsaved changes"}):null]}),o("div",{className:"dd-html-widths",role:"toolbar","aria-label":"Preview width",children:fs.map(g=>o("button",{type:"button",className:`icon-btn${C===g.id?" on":""}`,title:g.label,"aria-label":g.label,"aria-pressed":C===g.id,onClick:()=>m(g.id),children:o(g.icon,{size:14,"aria-hidden":!0})},g.id))}),d("div",{className:"dd-html-actions",children:[da.length?o(we,{open:N,onClose:()=>L(!1),className:"dd-page-problems",anchor:d("button",{type:"button",className:"dd-page-badge","aria-label":`${da.length} page ${da.length===1?"problem":"problems"}`,"aria-expanded":N,onClick:()=>L(g=>!g),children:[o(Pe,{size:13,"aria-hidden":!0}),da.length]}),children:o("ul",{"aria-label":"Page problems",children:da.map((g,R)=>d("li",{className:`dd-page-problem dd-page-problem-${g.kind}`,children:[o("span",{className:"dd-page-problem-kind",children:Wd[g.kind]}),o("span",{className:"dd-page-problem-message",children:g.message}),g.source?d("span",{className:"dd-muted dd-page-problem-source",children:[g.source,g.line?`:${g.line}`:""]}):null]},R))})}):null,t?null:o(U,{icon:He,label:"Open in browser",onClick:()=>{Rt()}})]})]}),A?d("div",{className:"dd-banner dd-banner-info",children:[o(Qa,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:["This page redirects to ",o("code",{children:A.path}),"."]}),o("button",{type:"button",className:"btn",onClick:()=>{P(null),na(A.path,A.hash)},children:"Go there"}),o(U,{icon:ue,label:"Dismiss",onClick:()=>P(null)})]}):null,M?d("div",{className:"dd-banner dd-banner-warn",children:[o(Pe,{size:14,"aria-hidden":!0}),o("span",{className:"dd-banner-text",children:"This draft is too large to preview. Save it to see the page."})]}):null,D?o("div",{className:"dd-banner dd-banner-error",children:D}):null,d("div",{className:"dd-html-viewport",ref:me,children:[p?o("iframe",{ref:pe,className:`dd-html-frame${Ua?" dd-html-frame-device":""}`,style:Ua?{width:Ua}:void 0,sandbox:"allow-scripts allow-forms",srcDoc:p.srcDoc,title:f},p.id):D||M?null:o("div",{className:"dd-center",children:o(K,{label:"Rendering page"})}),y?d("div",{className:"dd-selection-chip",style:{top:y.top,left:y.left},children:[d("button",{type:"button",onClick:()=>_a(i),children:[o(pa,{size:13,"aria-hidden":!0}),"Comment"]}),l?d("button",{type:"button",onClick:()=>_a(l),children:[o(de,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})]})}var el=24,al=64,Fa=new Map;function tl(e,a){for(Fa.delete(e),Fa.set(e,a);Fa.size>al;)Fa.delete(Fa.keys().next().value)}function ol(e,a,r){let t=j(),n=X(()=>{let c=new Map(a.map(f=>[f.path,f]));return r.map(f=>c.get(f)).filter(f=>!!f&&(f.kind==="image"||f.kind==="svg")).slice(0,el)},[a,r]),s=n.map(c=>`${c.path}@${c.revision}`).join("|"),i=F(n);i.current=n;let[l,u]=b(new Map);return O(()=>{let c=i.current,f=!1,C=new Map,m=[];for(let p of c){let x=Fa.get(`${e}\0${p.path}\0${p.revision}`);x?C.set(p.path,x):m.push(p)}if(u(C),!!m.length)return Promise.all(m.map(async p=>{try{let x=await t.readFile(e,p.path),I=Yt(x);I&&(tl(`${e}\0${x.path}\0${x.revision}`,I),C.set(x.path,I))}catch{}})).then(()=>{f||u(new Map(C))}),()=>{f=!0}},[t,e,s]),l}function Dt({docId:e,file:a,files:r,quotes:t=[],onOpenPath:n,onQuote:s,onAskAbout:i,handleRef:l,draft:u=!1}){let c=F(null),f=F(null),C=F({}),[m,p]=b(null),x=X(()=>a.kind==="markdown"?Rn(a.path,a.content):[],[a.path,a.content,a.kind]),I=ol(e,r,x),k=X(()=>new Set(r.map(L=>L.path)),[r]),D=X(()=>a.kind==="markdown"?Fn(a.path,a.content,I):a.kind==="mermaid"?eo(a.content,"mermaid"):a.kind==="code"?Bn(a.path,a.content):null,[a.kind,a.path,a.content,I]),v=t.join("\0");O(()=>{let L=f.current,A=C.current,P=v?v.split("\0"):[];if(!L||!P.length){Ia(zt,A,[]);return}let y=()=>Ia(zt,A,[...no(L,P).values()]),q=setTimeout(y,60),W=typeof MutationObserver=="function"?new MutationObserver(()=>y()):null;return W?.observe(L,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(q),W?.disconnect(),Ia(zt,A,[]),Ia(jt,A,[])}},[v,D,a.kind,a.content]);let M=a.kind!=="html";O(()=>{if(!(!l||!M))return l.current={focusQuote(L){let A=f.current,P=A?no(A,[L]).get(L):void 0;return P?(P.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),Ia(jt,C.current,[P]),setTimeout(()=>Ia(jt,C.current,[]),1800),!0):!1}},()=>{l.current=null}},[l,M]);let w=L=>{let A=L.target?.closest?.("a");if(!A)return;let P=A.getAttribute("href")??"";if(P.startsWith("#")){L.preventDefault(),L.stopPropagation();return}let y=vt(a.path,P);if(!y)return;L.preventDefault(),L.stopPropagation();let q=[...k].find(W=>W.startsWith(`${y}/`));k.has(y)?n?.(y):q?n?.(q):B(`${y} is not a file in this design doc`,"error")},H=()=>{if(!s)return;let L=globalThis.getSelection?.(),A=c.current,P=L?.toString().trim()??"";if(!L||L.isCollapsed||!P||!A||!f.current?.contains(L.anchorNode)){p(null);return}let y=L.getRangeAt(0).getBoundingClientRect(),q=A.getBoundingClientRect();p({text:P.slice(0,500),top:Math.max(4,y.top-q.top+A.scrollTop-36),left:Math.min(Math.max(80,y.left-q.left+y.width/2),Math.max(80,q.width-80))})},S=L=>{!m||!L||(L(m.text),p(null),globalThis.getSelection?.()?.removeAllRanges())},N;if(a.kind==="html")N=o(ps,{docId:e,file:a,files:r,draft:u,quotes:t,onOpenPath:n,onQuote:s,onAskAbout:i,handleRef:l},`${e}\0${a.path}`);else if(a.kind==="image"||a.kind==="svg"){let L=Yt(a);N=o("div",{className:"dd-image-stage",children:L?o("img",{src:L,alt:a.path}):o("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else a.kind==="font"?N=o("div",{className:"dd-image-stage",children:o("span",{className:"dd-muted",children:"Font file. Pages in this doc load it through @font-face."})}):D!==null?N=o("div",{className:`dd-prose dd-prose-${a.kind}`,ref:f,onClickCapture:w,children:a.kind==="markdown"&&!a.content.trim()?o("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):o(za,{content:D})}):N=o("div",{className:"dd-prose",ref:f,children:o("pre",{className:"dd-plain",children:a.content})});return d("div",{className:`dd-preview dd-preview-${a.kind}`,ref:c,onMouseUp:H,onMouseDown:L=>{L.target.closest?.(".dd-selection-chip")||p(null)},children:[N,m?d("div",{className:"dd-selection-chip",style:{top:m.top,left:m.left},children:[d("button",{type:"button",onClick:()=>S(s),children:[o(pa,{size:13,"aria-hidden":!0}),"Comment"]}),i?d("button",{type:"button",onClick:()=>S(i),children:[o(de,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function ms(e,a,r=1500){let t=e.split(`
`),n=a.split(`
`),s=0;for(;s<t.length&&s<n.length&&t[s]===n[s];)s+=1;let i=t.length,l=n.length;for(;i>s&&l>s&&t[i-1]===n[l-1];)i-=1,l-=1;let u=t.slice(s,i),c=n.slice(s,l);if(u.length>r||c.length>r)return null;let f=c.length+1,C=new Uint32Array((u.length+1)*f);for(let I=u.length-1;I>=0;I-=1)for(let k=c.length-1;k>=0;k-=1)C[I*f+k]=u[I]===c[k]?C[(I+1)*f+k+1]+1:Math.max(C[(I+1)*f+k],C[I*f+k+1]);let m=[],p=0,x=0;for(;p<u.length&&x<c.length;)u[p]===c[x]?(m.push({type:"same",text:u[p]}),p+=1,x+=1):C[(p+1)*f+x]>=C[p*f+x+1]?(m.push({type:"del",text:u[p]}),p+=1):(m.push({type:"add",text:c[x]}),x+=1);for(;p<u.length;)m.push({type:"del",text:u[p++]});for(;x<c.length;)m.push({type:"add",text:c[x++]});return[...t.slice(0,s).map(I=>({type:"same",text:I})),...m,...t.slice(i).map(I=>({type:"same",text:I}))]}function gs(e,a=3){let r=new Uint8Array(e.length);e.forEach((s,i)=>{if(s.type!=="same")for(let l=Math.max(0,i-a);l<=Math.min(e.length-1,i+a);l+=1)r[l]=1});let t=[],n=0;for(;n<e.length;)if(r[n]){let s=[];for(;n<e.length&&r[n];)s.push(e[n++]);t.push({type:"lines",lines:s})}else{let s=0;for(;n<e.length&&!r[n];)s+=1,n+=1;t.push({type:"gap",count:s})}return t}function hs(e){let a=0,r=0;for(let t of e)t.type==="add"?a+=1:t.type==="del"&&(r+=1);return{added:a,removed:r}}var rl={create:Te,write:Xe,delete:Ke,rename:ct},xs={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function Ls({doc:e,activePath:a,now:r,selectedId:t,onSelect:n}){let s=j(),[i,l]=le("history-scope","file"),u=i==="file"?a:null,c=Ye(`${e.id}\0${u??"*"}\0${e.revision}`,()=>s.history(e.id,{...u?{path:u}:{},limit:100}));return d("div",{className:"dd-rail-pane dd-history",children:[o("div",{className:"dd-rail-toolbar",children:d("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[o("button",{type:"button",className:i==="file"?"on":"",onClick:()=>l("file"),disabled:!a,children:"This file"}),o("button",{type:"button",className:i==="all"?"on":"",onClick:()=>l("all"),children:"All files"})]})}),d("div",{className:"dd-rail-scroll",children:[c.error?o("div",{className:"dd-banner dd-banner-error",children:c.error}):null,!c.data&&c.loading?o("div",{className:"dd-center",children:o(K,{label:"Loading history"})}):null,c.data&&!c.data.length?o(ve,{icon:Se,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,o("ol",{className:"dd-history-list",children:c.data?.map(f=>{let C=rl[f.op];return o("li",{children:d("button",{type:"button",className:`dd-history-row${t===f.id?" on":""}`,onClick:()=>n(f),children:[o(C,{size:13,className:`dd-op dd-op-${f.op}`,"aria-hidden":!0}),d("span",{className:"dd-history-main",children:[d("span",{className:"dd-history-title",children:[xs[f.op],u?null:o("span",{className:"dd-history-path",children:f.path}),d("span",{className:"dd-history-rev",children:["rev ",f.revision]})]}),f.note?o("span",{className:"dd-history-note",children:f.note}):null,d("span",{className:"dd-history-meta",children:[o(Le,{actor:f.actor}),o(fe,{at:f.createdAt,now:r})]})]})]})},f.id)})})]})]})}async function nl(e,a,r){let t=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||t.encoding==="base64")return{after:t,before:null,pruned:!1};if(r.op==="delete")return{after:t,before:t.content,pruned:!1};let n=(await e.history(a,{path:r.path,limit:100})).find(i=>i.id<r.id);if(!n)return{after:t,before:null,pruned:!0};if(n.op==="delete")return{after:t,before:"",pruned:!1};let s=await e.revision(a,n.id);return{after:t,before:s.content,pruned:!1}}function Is({doc:e,revision:a,onClose:r,onOpenPath:t}){let n=j(),[s,i]=b(a.op==="write"||a.op==="delete"?"changes":"full"),[l,u]=b(!1),[c,f]=b(null),C=Ye(`${e.id}\0${a.id}`,()=>nl(n,e.id,a)),m=La(a.path),p=e.files.find(w=>w.path===a.path)??null,x=p?.revision===a.revision&&a.op!=="delete",I=X(()=>{let w=C.data;if(!w||w.before===null||ze(m))return null;let H=ms(w.before,a.op==="delete"?"":w.after.content);return H?{hunks:gs(H),stats:hs(H)}:"too-large"},[C.data,a.op,m]),k=async()=>{u(!0);try{let w=await n.restore(e.id,a.id,p?.revision??0);B(`Restored ${w.path} to revision ${a.revision} (now rev ${w.revision})`),t(w.path),r()}catch(w){B(`Could not restore: ${_(w)}`,"error")}finally{u(!1)}},D=()=>{if(p){k();return}f({title:`Recreate ${a.path}?`,body:d($,{children:[o("code",{children:a.path})," is no longer in this doc",a.op==="delete"?"":"; it may have been renamed",". Recreate it with the content of revision ",a.revision,"?"]}),confirmLabel:"Recreate",run:()=>{k()}})},v=I!==null,M=s==="full"||!v;return d("div",{className:"dd-revision",children:[d("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[o(Se,{size:14,"aria-hidden":!0}),d("span",{className:"dd-banner-text",children:[o("strong",{children:xs[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",o(Le,{actor:a.actor})," ",o(fe,{at:a.createdAt,now:Date.now()}),a.renamedFrom?d($,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?d("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),v?d("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[o("button",{type:"button",className:s==="changes"?"on":"",onClick:()=>i("changes"),children:"Changes"}),o("button",{type:"button",className:s==="full"?"on":"",onClick:()=>i("full"),children:"Full file"})]}):null,d("button",{type:"button",className:"btn",disabled:x||l||!C.data,onClick:D,children:[o(Ue,{size:12,"aria-hidden":!0})," ",x?"Current":p?"Restore":"Recreate file"]}),o(U,{icon:ue,label:"Close revision",onClick:r})]}),d("div",{className:"dd-revision-body",children:[C.error?o("div",{className:"dd-banner dd-banner-error",children:C.error}):null,C.data?M?d($,{children:[C.data.pruned?o("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,I==="too-large"?o("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,o(Dt,{docId:e.id,file:{path:a.path,kind:m,content:C.data.after.content,encoding:C.data.after.encoding},files:e.files,onOpenPath:t,draft:!0})]}):I&&I!=="too-large"?d("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[d("div",{className:"dd-diff-stats",children:[d("span",{className:"dd-diff-added",children:["+",I.stats.added]}),d("span",{className:"dd-diff-removed",children:["\u2212",I.stats.removed]}),o("span",{className:"dd-muted",children:xa(a.size)})]}),I.hunks.map((w,H)=>w.type==="gap"?d("div",{className:"dd-diff-gap",children:["\u22EF ",w.count," unchanged line",w.count===1?"":"s"]},H):w.lines.map((S,N)=>d("div",{className:`dd-diff-line dd-diff-${S.type}`,role:"row",children:[o("span",{className:"dd-diff-sign","aria-hidden":!0,children:S.type==="add"?"+":S.type==="del"?"\u2212":" "}),o("span",{className:"dd-diff-text",children:S.text||" "})]},`${H}-${N}`))),I.stats.added+I.stats.removed===0?o("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:C.loading?o("div",{className:"dd-center",children:o(K,{label:"Loading revision"})}):null]}),c?o(Be,{request:c,onClose:()=>f(null)}):null]})}var sl=[{id:"preview",label:"Preview",icon:Ya},{id:"edit",label:"Edit",icon:ma},{id:"split",label:"Split",icon:Ve}];function dl(e,a,r){let t=pn(e,a,r),n=F(null);t.data&&(n.current=t.data);let s=n.current&&n.current.path===a?n.current:null;return{file:t.data??s,error:t.error,loading:t.loading}}function ll(e,a,r){let[t,n]=b(null),s=F({path:e,revision:a});return O(()=>{let i=s.current;if(s.current={path:e,revision:a},i.path!==e||a===null||i.revision===null||a<=i.revision||r?.kind!=="agent")return;n(r.label);let l=setTimeout(()=>n(null),4e3);return()=>clearTimeout(l)},[e,a,r]),t}function Cs({doc:e,path:a,mode:r,onModeChange:t,railOpen:n,onToggleRail:s,revision:i,onCloseRevision:l,previewHandle:u,onOpenPath:c,onQuote:f,onAskAbout:C,onEditorState:m,leading:p}){let x=e.files.find(L=>L.path===a)??null,{file:I,error:k,loading:D}=dl(e.id,a,x?.revision??null),v=ll(a,x?.revision??null,x?.updatedBy),M=!x||!ze(x.kind),w=M?r:"preview",H=X(()=>e.comments.filter(L=>L.status==="open"&&L.path===a&&L.quote).map(L=>L.quote),[e.comments,a]),S=a.lastIndexOf("/");O(()=>{w==="preview"&&m({dirty:!1,saving:!1})},[w,m]);let N;return i?N=o(Is,{doc:e,revision:i,onClose:l,onOpenPath:c},i.id):!x&&!(I&&w!=="preview")?N=d("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}):I?w==="preview"?N=o(Dt,{docId:e.id,file:I,files:e.files,quotes:H,onOpenPath:c,onQuote:f,onAskAbout:C,handleRef:u}):N=o(ts,{docId:e.id,file:I,removed:!x,split:w==="split",onStateChange:m,renderPreview:L=>o(Dt,{docId:e.id,file:{...I,content:L},files:e.files,onOpenPath:c,draft:L!==I.content})},`${e.id}\0${a}`):N=o("div",{className:"dd-center",children:k?o("div",{className:"dd-banner dd-banner-error",children:k}):D?o(K,{label:"Loading file"}):null}),d("section",{className:"dd-file-pane","aria-label":a,children:[d("div",{className:"dd-file-toolbar",children:[p,x?o(wa,{kind:x.kind}):null,d("span",{className:"dd-file-path",title:a,children:[S>0?o("span",{className:"dd-file-dir",children:a.slice(0,S+1)}):null,o("span",{className:"dd-file-name",children:a.slice(S+1)})]}),x?d("span",{className:"dd-file-meta",children:["rev ",x.revision," \xB7 ",xa(x.size)," \xB7 ",o(Le,{actor:x.updatedBy})," ",o(fe,{at:x.updatedAt,now:Date.now()})]}):null,v?d("span",{className:"dd-flash",role:"status",children:[o(ge,{size:12,"aria-hidden":!0})," Updated by ",v]}):null,o("span",{className:"dd-spacer"}),i?null:o("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:sl.map(L=>d("button",{type:"button",className:w===L.id?"on":"",disabled:!M&&L.id!=="preview",onClick:()=>t(L.id),title:L.label,"aria-pressed":w===L.id,children:[o(L.icon,{size:13,"aria-hidden":!0}),o("span",{className:"dd-mode-label",children:L.label})]},L.id))}),o(U,{icon:ft,label:n?"Hide comments & history":"Show comments & history",active:n,onClick:s})]}),o("div",{className:"dd-file-body",children:N})]})}function cl(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,t=>t.toUpperCase());switch(La(e)){case"markdown":return`# ${r}

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
`;default:return""}}function fl(e){let a=e.trim().replace(/^\/+/,"");return Pt(a)?a:`${a}.md`}function pl(e){return new Promise((a,r)=>{let t=new FileReader,n=ze(La(e.name));t.onerror=()=>r(t.error??new Error("could not read the file")),t.onload=()=>{let s=String(t.result??"");a(n?{content:s.slice(s.indexOf(",")+1),encoding:"base64"}:{content:s})},n?t.readAsDataURL(e):t.readAsText(e)})}function bs({initial:e,placeholder:a,onSubmit:r,onCancel:t}){let[n,s]=b(e),i=F(!1),l=c=>{c?.preventDefault(),!i.current&&(i.current=!0,n.trim()&&n.trim()!==e?r(n.trim()):t())};return o("form",{className:"dd-tree-input",onSubmit:l,children:o("input",{className:"dd-input",value:n,placeholder:a,"aria-label":a,onChange:c=>s(c.target.value),onKeyDown:c=>{c.key==="Escape"&&(c.preventDefault(),i.current=!0,t())},onBlur:()=>l(),autoFocus:!0,onFocus:c=>{let f=c.target.value.lastIndexOf("."),C=c.target.value.lastIndexOf("/")+1;c.target.setSelectionRange(C,f>C?f:c.target.value.length)}})})}function ml({doc:e,file:a,name:r,depth:t,active:n,renaming:s,onOpen:i,onRename:l,onRenameDone:u,onDelete:c}){let f=j(),[C,m]=b(!1),p=e.entryPath===a.path,x=e.comments.filter(I=>I.status==="open"&&I.path===a.path).length;return s?o("div",{className:"dd-tree-row",style:{paddingLeft:8+t*14},children:o(bs,{initial:a.path,placeholder:"New path",onSubmit:I=>u(I),onCancel:()=>u(null)})}):d("div",{className:`dd-tree-row dd-tree-file${n?" on":""}`,style:{paddingLeft:8+t*14},children:[d("button",{type:"button",className:"dd-tree-open",onClick:i,onDoubleClick:l,title:`${a.path} \xB7 ${xa(a.size)} \xB7 rev ${a.revision}`,"aria-current":n?"page":void 0,children:[o(wa,{kind:a.kind}),o("span",{className:"dd-tree-name",children:r}),p?o(Ze,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,x?o("span",{className:"dd-tree-badge",title:`${x} open comment${x===1?"":"s"}`,children:x}):null]}),d(we,{open:C,onClose:()=>m(!1),className:"dd-menu",anchor:o(U,{icon:De,label:`Actions for ${a.path}`,size:13,active:C,onClick:()=>m(!C)}),children:[o(ce,{icon:ma,label:"Rename or move",onSelect:()=>{m(!1),l()}}),p||ze(a.kind)?null:o(ce,{icon:Lt,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{m(!1),f.update(e.id,{entryPath:a.path}).catch(I=>B(_(I),"error"))}}),o(ce,{icon:he,label:"Delete",danger:!0,onSelect:()=>{m(!1),c()}})]})]})}function po({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n,onHide:s}){let i=j(),[l,u]=b(new Set),[c,f]=b(!1),[C,m]=b(null),[p,x]=b(null),I=F(null),k=On(e.files),D=e.files.length>=500,v=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",M=async A=>{f(!1);let P=fl(A);if(e.files.some(y=>y.path===P)){r(P);return}if(ze(La(P))){B("Use \u201CAdd files\u201D to upload images and fonts.","error");return}try{await i.writeFile(e.id,{path:P,content:cl(P)}),r(P)}catch(y){B(`Could not create ${P}: ${_(y)}`,"error")}},w=(A,P)=>{if(m(null),!P||P===A)return;let y=async()=>{try{let q=await i.renameFile(e.id,A,P);t(A,q.path)}catch(q){B(`Could not rename ${A}: ${_(q)}`,"error")}};if(!n?.(A)){y();return}x({title:"Discard unsaved changes?",body:d($,{children:["Renaming ",o("code",{children:A})," drops your unsaved edits to it. Save them first to keep them."]}),confirmLabel:"Discard and rename",danger:!0,run:y})},H=async A=>{for(let P of Array.from(A??[])){let y=La(P.name),q=ze(y)?2097152:2097152;if(P.size>q){B(`${P.name} is larger than ${xa(q)}`,"error");continue}let W=y==="image"||y==="svg"||y==="font",ne=`${v||(W?"assets/":"")}${P.name.replace(/[^\w.-]+/g,"-")}`;try{let pe=await pl(P);await i.writeFile(e.id,{path:ne,...pe});let me=ne.slice(v.length);B(y==="font"||!W?`Added ${ne}`:`Added ${ne}. Reference it with ![${P.name}](${me})`)}catch(pe){B(`Could not add ${P.name}: ${_(pe)}`,"error")}}I.current&&(I.current.value="")},S=A=>x({title:"Delete file",body:d($,{children:["Delete ",o("code",{children:A.path}),"? Its history is kept, so it can be recreated from History.",n?.(A.path)?" Your unsaved edits to it will be lost.":null]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await i.deleteFile(e.id,A.path),t(A.path,null)}catch(P){B(`Could not delete ${A.path}: ${_(P)}`,"error")}}}),N=A=>u(P=>{let y=new Set(P);return y.has(A)?y.delete(A):y.add(A),y}),L=(A,P)=>A.map(y=>{if(y.kind==="folder"){let q=!l.has(y.path);return d("div",{role:"group","aria-label":y.name,children:[d("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+P*14},onClick:()=>N(y.path),"aria-expanded":q,children:[q?o(ie,{size:12,"aria-hidden":!0}):o(ua,{size:12,"aria-hidden":!0}),q?o(_e,{size:14,"aria-hidden":!0}):o(rt,{size:14,"aria-hidden":!0}),o("span",{className:"dd-tree-name",children:y.name})]}),q?L(y.children,P+1):null]},`d:${y.path}`)}return o(ml,{doc:e,file:y.file,name:y.name,depth:P,active:y.path===a,renaming:C===y.path,onOpen:()=>r(y.path),onRename:()=>m(y.path),onRenameDone:q=>{w(y.path,q)},onDelete:()=>S(y.file)},`f:${y.path}`)});return d("nav",{className:"dd-tree","aria-label":"Files",children:[d("div",{className:"dd-tree-head",children:[o("span",{className:"dd-section-label",children:"Files"}),o("span",{className:"dd-tree-count",children:e.files.length}),o("span",{className:"dd-spacer"}),o(U,{icon:Te,label:"Add files",size:13,disabled:D,onClick:()=>I.current?.click()}),o(U,{icon:xe,label:"New file",size:13,disabled:D,onClick:()=>f(!0)}),s?o(U,{icon:Me,label:"Hide files",size:13,onClick:s}):null,o("input",{ref:I,type:"file",multiple:!0,hidden:!0,onChange:A=>{H(A.target.files)}})]}),d("div",{className:"dd-tree-scroll",role:"tree",children:[L(k,0),c?o("div",{className:"dd-tree-row",style:{paddingLeft:8},children:o(bs,{initial:v,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:A=>{M(A)},onCancel:()=>f(!1)})}):null]}),p?o(Be,{request:p,onClose:()=>x(null)}):null]})}var gl=560,hl=640,xl=1100,$t=[gl,hl,xl];function Ll(e,a){let r=t=>!!t&&e.files.some(n=>n.path===t);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function Il({doc:e,tab:a,onTab:r,activePath:t,now:n,pendingQuote:s,onClearQuote:i,commentDraft:l,onCommentDraft:u,onFocusComment:c,selectedRevision:f,onSelectRevision:C,chatThreadId:m,onOpenChat:p,onClose:x}){let I=[{id:"comments",label:"Comments",icon:ye,count:e.openComments},{id:"history",label:"History",icon:Se},{id:"agents",label:"Agents",icon:ge,count:e.threads.length}],k=a==="agents"&&!!p&&e.threads.some(D=>D.threadId===m);return d("aside",{className:`dd-rail${k?" dd-rail-chat":""}`,"aria-label":"Comments, history and agents",children:[d("div",{className:"dd-rail-tabs",role:"tablist",children:[I.map(D=>d("button",{type:"button",role:"tab","aria-selected":a===D.id,className:`dd-rail-tab${a===D.id?" on":""}`,onClick:()=>r(D.id),children:[o(D.icon,{size:13,"aria-hidden":!0}),D.label,D.count?o("span",{className:"dd-count",children:D.count}):null]},D.id)),x?d($,{children:[o("span",{className:"dd-spacer"}),o(U,{icon:ue,label:"Close",onClick:x,size:13})]}):null]}),a==="comments"?o(Vn,{doc:e,activePath:t,now:n,pendingQuote:s,onClearQuote:i,draft:l,onDraft:u,onFocusComment:c}):a==="history"?o(Ls,{doc:e,activePath:t,now:n,selectedId:f,onSelect:C}):o(yn,{doc:e,now:n,chatThreadId:m,...p?{onOpenChat:p}:{}})]})}function Cl({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let[s,i]=b(!1),l=e.files.find(u=>u.path===a);return o(we,{open:s,onClose:()=>i(!1),align:"start",className:"dd-switcher-pop",anchor:d("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":s,onClick:()=>i(!s),title:"Files in this doc",children:[l?o(wa,{kind:l.kind}):null,d("span",{children:[e.files.length," files"]}),o(ie,{size:12,"aria-hidden":!0})]}),children:o(po,{doc:e,activePath:a,onOpen:u=>{i(!1),r(u)},onPathChanged:t,hasDraft:n})})}function Vt({docId:e,path:a,onOpenPath:r,layout:t,contextProjectId:n=null,onDeleted:s,headerExtra:i}){let l=qt(e),u=Fe(),c=va(),f=t==="compact",[C,m]=mn($t),p=!f&&(m??$t.length)<1,x=!f&&(m??$t.length)>=2,I=!f&&(m??$t.length)>=3,[k,D]=le("tree",!0),v=x&&k,[M,w]=le("view-mode","preview"),[H,S]=le("rail",!0),[N,L]=le("rail-compact",!1),A=I?H:N,P=I?S:L,[y,q]=le("rail-tab","comments"),[W,ne]=b(null),[pe,me]=b(""),[Q,Z]=b(null),[E,ae]=b(null),[te,re]=b(null),[Ie,ke]=b(null),[T,V]=b(null),z=F({dirty:!1,saving:!1}),[se,Na]=b(!1),Mt=F(null),je=F(null),Ge=F(null),ee=l.data,Ne=ee?Ll(ee,a):null,Ea=!!ee&&!!je.current&&!ee.files.some(g=>g.path===je.current);Ea||(Ge.current=null);let oe=Ea&&(se||Ge.current===je.current)?je.current:Ne;je.current=oe;let ra=!!ee&&!!l.error&&sn(l.error),na=F({onDeleted:s,title:ee?.title??""});na.current={onDeleted:s,title:ee?.title??na.current.title};let Xt=Ae(g=>{z.current.saving&&!g.saving&&!g.dirty&&(Ge.current=je.current),z.current=g,Na(g.dirty)},[]),Oa=Ae(()=>{z.current={dirty:!1,saving:!1},Ge.current=null,Na(!1)},[]),sa=Ae(g=>{if(!z.current.dirty){g();return}ke({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{Oa(),g()}})},[Oa]),ba=Ae(g=>{if(g===oe){re(null);return}sa(()=>{re(null),r(g)})},[oe,sa,r]);O(()=>{ra&&(B(`\u201C${na.current.title}\u201D was deleted`),na.current.onDeleted())},[ra]);let qa=!!Q&&!!ee?.threads.some(g=>g.threadId===Q);if(O(()=>{Q&&ee&&!qa&&Z(null)},[Q,qa,ee]),O(()=>{if(!T||T.path!==oe||te)return;let g=[80,300,900].map(R=>setTimeout(()=>{Mt.current?.focusQuote(T.quote)&&(g.forEach(clearTimeout),V(null))},R));return()=>g.forEach(clearTimeout)},[T,oe,te]),!ee)return o("div",{className:"dd-doc dd-center",children:l.error?o(ve,{icon:be,title:"This design doc could not be opened",children:l.error}):o(K,{label:"Loading design doc"})});let Ha=g=>sa(()=>{re(null),g.path&&g.path!==oe&&r(g.path),M!=="preview"&&w("preview"),I||P(!1),g.quote&&V({path:g.path??oe??"",quote:g.quote,nonce:Date.now()})}),So=g=>sa(()=>{re(g),g.path!==oe&&ee.files.some(R=>R.path===g.path)&&r(g.path)}),da=g=>{g==="preview"?sa(()=>w(g)):w(g)},Rt=(g,R)=>{g===oe&&(Oa(),r(R,!0))},_a=g=>g===oe&&z.current.dirty,Ua=o(Il,{doc:ee,tab:y,onTab:q,activePath:oe,now:c,pendingQuote:W,onClearQuote:()=>ne(null),commentDraft:pe,onCommentDraft:me,onFocusComment:Ha,selectedRevision:te?.id??null,onSelectRevision:So,chatThreadId:Q,...f?{}:{onOpenChat:Z},onClose:I?void 0:()=>P(!1)});return d("div",{ref:C,className:`dd-doc dd-doc-${t}${p?" dd-doc-narrow":""}${A?" dd-rail-open":""}${I?"":" dd-rail-floating"}`,children:[o(as,{doc:ee,projects:u.data??[],compact:f,collapsible:p,onDeleted:s,actions:d($,{children:[i,o(jn,{doc:ee,compact:f||p}),o(Sn,{doc:ee,activePath:oe,request:E,contextProjectId:n,compact:f||p})]})}),d("div",{className:"dd-doc-body",children:[v?o(po,{doc:ee,activePath:oe,onOpen:ba,onPathChanged:Rt,hasDraft:_a,onHide:()=>D(!1)}):null,oe?o(Cs,{doc:ee,path:oe,mode:M,onModeChange:da,railOpen:A,onToggleRail:()=>P(!A),revision:te,onCloseRevision:()=>re(null),previewHandle:Mt,onOpenPath:ba,onQuote:g=>{ne({path:oe,text:g}),q("comments"),P(!0)},onAskAbout:g=>ae({prompt:`About this passage in ${oe}:
> ${g.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:Xt,leading:v?null:d($,{children:[x?o(U,{icon:Re,label:"Show files",onClick:()=>D(!0)}):null,o(Cl,{doc:ee,activePath:oe,onOpen:ba,onPathChanged:Rt,hasDraft:_a})]})}):o("div",{className:"dd-file-pane dd-center",children:o(ve,{icon:be,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),A?Ua:null]}),Ie?o(Be,{request:Ie,onClose:()=>ke(null)}):null]})}var ta=globalThis.__ZCC_HOST_REACT_DOM__;if(ta==null)throw new Error("host react-dom is not available");var ys=ta.createPortal,Bh=ta.flushSync,Nh=ta.hydrate,Eh=ta.render,Oh=ta.unmountComponentAtNode,qh=ta.findDOMNode,Hh=ta.version;var Tt=null,mo=new Set;function Ps(){mo.forEach(e=>e())}function bl(e){Tt!==e&&(Tt=e,Ps())}function yl(e){Tt===e&&(Tt=null,Ps())}function Ss(e){return Tt===e}function Sl(e){return mo.add(e),()=>mo.delete(e)}function go(){let e=F(null);e.current||(e.current=Symbol("popover"));let a=e.current;return[No(Sl,()=>Ss(a),()=>!1),n=>{(typeof n=="function"?n(Ss(a)):n)?bl(a):yl(a)}]}var Pl=typeof window>"u"?O:Sa,oa=8,vs=4,vl=160,wl=360,kl=.55;function Al(e,a,r){let t=Math.max(e.width,r),n=e.left;n+t>a.width-oa&&(n=e.right-t),n<oa&&(n=oa),n+t>a.width-oa&&(n=Math.max(oa,a.width-t-oa));let s=a.height-e.bottom-oa,i=e.top-oa,l=s<vl&&i>s,u=Math.max(120,l?i:s),c=Math.min(wl,Math.floor(a.height*kl)),f=Math.min(u,c);return l?{left:n,width:t,maxHeight:f,bottom:a.height-e.top+vs}:{left:n,width:t,maxHeight:f,top:e.bottom+vs}}function Dl(e,a){if(e.sticky)return!0;let r=a.trim().toLowerCase();return r?`${e.label} ${e.compactLabel??""} ${e.description??""}`.toLowerCase().includes(r):!0}function Tl(e,a,r=!0){let t=[],n=[];for(let s of e){if(s.sticky){n.push(s);continue}(!r||Dl(s,a))&&t.push(s)}return{items:t,sticky:n}}function ws({option:e,previousGroup:a,optionId:r,selected:t,active:n,onHover:s,onSelect:i}){return d("div",{children:[e.group&&e.group!==a&&o("div",{className:"launch-model-picker-group-label",children:e.group}),d("button",{type:"button",id:r,className:`launch-model-picker-option${e.description?" launch-model-picker-option--stacked":""}${e.className?` ${e.className}`:""}${t?" is-selected":""}${n?" is-active":""}${e.tone==="warning"?" is-warning":""}`,role:"option","aria-selected":t,"aria-disabled":e.disabled||void 0,disabled:e.disabled,tabIndex:-1,onMouseEnter:s,onFocus:s,onClick:i,children:[e.content||e.description?d("span",{className:"launch-model-picker-option-copy",children:[e.content??o("span",{children:e.label}),e.description?o("span",{className:"launch-model-picker-option-description",children:e.description}):null]}):o("span",{children:e.label}),t&&o(Oe,{size:14,"aria-hidden":"true"})]})]})}function ho({id:e,ariaLabel:a,value:r,options:t,onChange:n,placeholder:s="Select\u2026",disabled:i,title:l,ariaKeyshortcuts:u,searchable:c=!0,searchPlaceholder:f="Search\u2026",emptyHint:C="No matches",className:m="",triggerClassName:p="launch-model-picker-trigger",triggerTestId:x,triggerIcon:I,minWidth:k=200,anchorToParent:D=!1}){let[v,M]=go(),[w,H]=b(""),[S,N]=b(null),L=F(null),A=F(null),P=F(null),y=F(!1),q=Bo(),[W,ne]=b(0),pe=t.find(T=>T.value===r),{items:me,sticky:Q}=X(()=>Tl(t,w,c),[t,w,c]),Z=X(()=>[...me,...Q],[Q,me]),E=Z[W],ae=T=>`${q}-${T.value}`,te=T=>{!T||T.disabled||(n(T.value),M(!1))},re=T=>{Z.length!==0&&ne(V=>{for(let z=1;z<=Z.length;z+=1){let se=(V+T*z+Z.length)%Z.length;if(!Z[se].disabled)return se}return V})},Ie=T=>{if(T.key==="Escape")T.preventDefault(),M(!1);else if(T.key==="ArrowDown")T.preventDefault(),re(1);else if(T.key==="ArrowUp")T.preventDefault(),re(-1);else if(T.key==="Home"){T.preventDefault();let V=Z.findIndex(z=>!z.disabled);V>=0&&ne(V)}else if(T.key==="End"){T.preventDefault();let V=Z.length-1-[...Z].reverse().findIndex(z=>!z.disabled);V>=0&&ne(V)}else T.key==="Enter"&&(T.preventDefault(),te(E))};Pl(()=>{if(!v||!L.current)return;let T=D?L.current.parentElement?.getBoundingClientRect()??L.current.getBoundingClientRect():L.current.getBoundingClientRect();N(Al(T,{width:window.innerWidth,height:window.innerHeight},k))},[v,D,k]),O(()=>{if(!v)return;let T=z=>{let se=z.target;L.current?.contains(se)||A.current?.contains(se)||M(!1)},V=z=>{z.key==="Escape"&&M(!1)};return document.addEventListener("mousedown",T,!0),document.addEventListener("keydown",V),()=>{document.removeEventListener("mousedown",T,!0),document.removeEventListener("keydown",V)}},[v]),O(()=>{if(v){let T=Z.findIndex(z=>z.value===r&&!z.disabled),V=Z.findIndex(z=>!z.disabled);ne(T>=0?T:Math.max(0,V))}else H(""),y.current&&L.current?.focus();y.current=v},[v,c,r]);let ke=v&&S!==null;return O(()=>{ke&&(c?P.current?.focus():A.current?.focus())},[ke,c]),O(()=>{W>=Z.length&&ne(0)},[W,Z.length]),O(()=>{if(!v||!E||E.sticky)return;let T=A.current?.querySelector(`[id="${CSS.escape(ae(E))}"]`);T instanceof HTMLElement&&T.scrollIntoView({block:"nearest"})},[W,E,v]),d($,{children:[d("button",{ref:L,id:e,type:"button",className:`${p} ${m}${pe?.tone==="warning"?" is-warning":""}`,disabled:i,title:l,"aria-keyshortcuts":u,onClick:()=>M(T=>!T),onKeyDown:T=>{(T.key==="ArrowDown"||T.key==="ArrowUp")&&(T.preventDefault(),M(!0))},"aria-haspopup":"listbox","aria-expanded":v,"aria-controls":v?q:void 0,"aria-label":a,"data-testid":x??e,children:[I,o("span",{children:pe?.compactLabel??pe?.label??s}),o(ie,{size:14,"aria-hidden":"true"})]}),v&&ys(d("div",{ref:A,className:"launch-model-picker-menu launch-model-picker-menu--split",role:"listbox",id:q,tabIndex:-1,"aria-label":a,"aria-activedescendant":E?ae(E):void 0,onKeyDown:Ie,style:S?{left:S.left,width:S.width,maxHeight:S.maxHeight,...S.bottom!=null?{bottom:S.bottom,top:"auto"}:{top:S.top}}:{visibility:"hidden"},children:[c&&d("div",{className:"launch-model-picker-search",children:[o(ha,{size:13,"aria-hidden":"true"}),o("input",{ref:P,value:w,onChange:T=>H(T.target.value),placeholder:f,"aria-label":f,"aria-activedescendant":E?ae(E):void 0,onKeyDown:Ie})]}),d("div",{className:"launch-model-picker-options",children:[me.map((T,V)=>o(ws,{option:T,previousGroup:me[V-1]?.group,optionId:ae(T),selected:r===T.value,active:W===V,onHover:()=>ne(V),onSelect:()=>te(T)},T.value)),me.length===0&&o("div",{className:"launch-model-picker-hint",children:C})]}),Q.length>0&&o("div",{className:"launch-model-picker-footer",children:Q.map((T,V)=>{let z=me.length+V;return o(ws,{option:T,previousGroup:V===0?void 0:Q[V-1]?.group,optionId:ae(T),selected:r===T.value,active:W===z,onHover:()=>ne(z),onSelect:()=>te(T)},T.value)})})]}),document.body)]})}function ks(e,a){let r=new Set(e.map(m=>m.id)),t=new Map,n=[];for(let m of e)if(m.alternativeTo&&m.alternativeTo!==m.id&&r.has(m.alternativeTo)){let p=t.get(m.alternativeTo)??[];p.push(m),t.set(m.alternativeTo,p)}else n.push(m);let s=m=>({doc:m,alternatives:t.get(m.id)??[]}),i=[],l=(m,p,x,I)=>{if(!I.length)return;let k=I.map(s);i.push({key:m,kind:p,label:x,entries:k,count:k.reduce((D,v)=>D+1+v.alternatives.length,0)})},u=n.filter(m=>m.pinnedAt!==null),c=n.filter(m=>m.pinnedAt===null&&m.openComments>0),f=n.filter(m=>m.pinnedAt===null&&m.openComments===0);if(l("pinned","pinned","Pinned",u),l("needs-me","needs-me","Needs me",c),!a.byProject)return l("recent","recent","Recent",f),i;let C=new Map;for(let m of f){let p=m.projectId?`project:${m.projectId}`:"project:",x=C.get(p)??{projectId:m.projectId,docs:[]};x.docs.push(m),C.set(p,x)}for(let[m,p]of C)l(m,"project",p.projectId?a.projectName(p.projectId):"Global",p.docs);return i}function xo(e){try{let a=JSON.parse(e);return new Set(Array.isArray(a)?a.filter(r=>typeof r=="string"):[])}catch{return new Set}}function As(e,a){let r=xo(e);return r.has(a)?r.delete(a):r.add(a),JSON.stringify([...r])}var Io="__global__",Ml=Nt-600,Rl=[{value:"active",label:"Active",description:"Everything except archived"},...Et.map(e=>({value:e,label:Ot[e]})),{value:"all",label:"All statuses"}];function Lo(e,a,r){return{value:e,label:a,content:d("span",{className:"dd-pick-row",children:[o("span",{className:"dd-pick-label",children:a}),o("span",{className:"dd-pick-count",children:r})]})}}function Fl(e,a,r){let t=new Map;for(let s of e)t.set(s.projectId,(t.get(s.projectId)??0)+1);let n=[Lo("","All projects",e.length)];(t.has(null)||r===Io)&&n.push(Lo(Io,"Global docs",t.get(null)??0));for(let s of a)(t.has(s.id)||r===s.id)&&n.push(Lo(s.id,s.name,t.get(s.id)??0));return n}function Bl(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function Nl(e,a){let[r,t]=b(e);return O(()=>{let n=setTimeout(()=>t(e),a);return()=>clearTimeout(n)},[e,a]),r}function El({doc:e,active:a,alternative:r=!1,projectName:t,now:n,menuOpen:s,onSelect:i,onMenu:l}){return d("button",{type:"button",className:`dd-doc-row${a?" on":""}${r?" dd-doc-row-alt":""}${s?" dd-doc-row-menu":""}`,onClick:i,onContextMenu:u=>{u.preventDefault(),l(In(u))},"aria-current":a?"page":void 0,"aria-haspopup":"menu",children:[d("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:e.title}),r?o("span",{className:"dd-doc-row-badge",title:"An alternative to the doc above",children:"Alt"}):null,o(ea,{status:e.status,compact:!0})]}),e.summary?o("span",{className:"dd-doc-row-summary",children:e.summary}):null,d("span",{className:"dd-doc-row-meta",children:[t!==null?o("span",{className:"dd-doc-row-project",title:t,children:t}):null,d("span",{title:`${e.fileCount} files`,children:[o(ca,{size:11,"aria-hidden":!0})," ",e.fileCount]}),e.openComments?d("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[o(ye,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,e.updatedBy.kind==="agent"?o("span",{title:"Last edited by an agent",children:o(ge,{size:11,"aria-label":"Last edited by an agent"})}):null,o("span",{className:"dd-spacer"}),o(fe,{at:e.updatedAt,now:n})]})]})}var Ol={pinned:ga,"needs-me":ye};function ql({section:e,open:a,onToggle:r}){let t=e.kind==="pinned"||e.kind==="needs-me"?Ol[e.kind]:null;return d("button",{type:"button",className:`dd-list-section dd-list-section-${e.kind}`,"aria-expanded":a,onClick:r,children:[o(ie,{size:12,"aria-hidden":!0,className:"dd-list-section-caret"}),t?o(t,{size:11,"aria-hidden":!0}):null,o("span",{className:"dd-list-section-label",title:e.label,children:e.label}),o("span",{className:"dd-list-section-count",children:e.count})]})}function Hl({projectId:e,showProjects:a,projects:r,activeId:t,onSelect:n,onDeleted:s,onNew:i,onCollapse:l,headerActions:u}){let[c,f]=b(""),[C,m]=le("list-status","active"),[p,x]=le("list-project",""),[I,k]=le("list-grouped",!0),[D,v]=le("list-collapsed","[]"),[M,w]=b(null),H=Ut(r),S=Nl(c.trim(),200),N=va(),L=Pa({...e?{projectId:e}:{},...S?{query:S}:{},status:C}),A=X(()=>new Map(r.map(E=>[E.id,E.name])),[r]),P=X(()=>{let E=L.data??[];return!a||!p?E:E.filter(ae=>p===Io?ae.projectId===null:ae.projectId===p)},[L.data,a,p]),y=C!=="active"||a&&!!p,q=a&&!p&&I,W=X(()=>ks(P,{byProject:q,projectName:E=>A.get(E)??"Unknown project"}),[P,q,A]),ne=!(W.length===1&&W[0]?.kind==="recent"),pe=X(()=>S?new Set:xo(D),[S,D]),me=(E,ae)=>ae.kind==="project"?null:a?E.projectId?A.get(E.projectId)??"Unknown project":"Global":E.projectId?null:"Global",Q=(E,ae,te)=>o(El,{doc:E,active:E.id===t,alternative:te,projectName:te?null:me(E,ae),now:N,menuOpen:M?.doc.id===E.id,onSelect:()=>n(E.id),onMenu:re=>w({doc:E,at:re})},E.id),Z=X(()=>a?Fl(L.data??[],r,p):[],[a,L.data,r,p]);return d("div",{className:"dd-list",children:[d("div",{className:"dd-list-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),L.data?o("span",{className:"dd-list-count",title:`${P.length} ${P.length===1?"doc":"docs"}`,children:P.length}):null,o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary dd-new",onClick:i,children:[o(xe,{size:13,"aria-hidden":!0})," New"]}),o(U,{icon:Me,label:"Hide doc list",onClick:l}),u]}),o("div",{className:"dd-list-tools",children:d("label",{className:"dd-search",children:[o(ha,{size:13,"aria-hidden":!0}),o("input",{value:c,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:E=>f(E.target.value)}),c?o("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>f(""),children:o(ue,{size:12,"aria-hidden":!0})}):null]})}),d("div",{className:"dd-list-filters",children:[o(ho,{ariaLabel:"Filter by status",value:C,options:Rl,onChange:m,searchable:!1,triggerClassName:`launch-model-picker-trigger dd-pick${C!=="active"?" on":""}`,triggerIcon:o(Ka,{size:12,"aria-hidden":!0})}),a?o(ho,{ariaLabel:"Filter by project",value:p,options:Z,onChange:x,searchable:Z.length>8,searchPlaceholder:"Search projects\u2026",minWidth:220,triggerClassName:`launch-model-picker-trigger dd-pick${p?" on":""}`,triggerIcon:o(_e,{size:12,"aria-hidden":!0})}):null,a&&!p?d($,{children:[o("span",{className:"dd-spacer"}),o(U,{icon:lt,label:"Group by project",active:I,size:13,onClick:()=>k(!I)})]}):null]}),d("div",{className:"dd-list-scroll",children:[L.error?o("div",{className:"dd-banner dd-banner-error",children:L.error}):null,!L.data&&L.loading?o("div",{className:"dd-center",children:o(K,{label:"Loading design docs"})}):null,L.data&&!P.length?o("div",{className:"dd-list-empty dd-muted",children:S||y?"No docs match.":"No design docs yet."}):null,W.map(E=>{let ae=!pe.has(E.key),te=E.entries.flatMap(re=>[Q(re.doc,E,!1),...re.alternatives.map(Ie=>Q(Ie,E,!0))]);return ne?d("section",{className:"dd-list-group","aria-label":E.label,children:[o(ql,{section:E,open:ae,onToggle:()=>v(As(D,E.key))}),ae?te:null]},E.key):te})]}),M?o(Cn,{at:M.at,label:`Actions for ${M.doc.title}`,onClose:()=>w(null),children:H.items(M.doc,()=>w(null),()=>s(M.doc.id),M.doc.id===t?void 0:()=>n(M.doc.id))},`${M.doc.id}@${M.at.x},${M.at.y}`):null,H.dialogs]})}function Ds({templates:e,selected:a,onSelect:r}){return o("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(t=>d("button",{type:"button",role:"radio","aria-checked":a===t.id,className:`dd-template${a===t.id?" on":""}`,onClick:()=>r(t.id),children:[o("span",{className:"dd-template-label",children:t.label}),o("span",{className:"dd-template-desc",children:t.description}),o("span",{className:"dd-template-files",children:t.files.join(" \xB7 ")})]},t.id))})}function Co({initialTemplate:e,defaultProjectId:a,projects:r,onClose:t,onCreated:n}){let s=j(),i=Ce(),l=Zt(),[u,c]=b(""),[f,C]=b(""),[m,p]=b(e??null),[x,I]=b(a??""),[k,D]=b(""),[v,M]=b(""),[w,H]=b(!1),S=m??l.data?.[0]?.id??null,N=!!v.trim(),L=x||a||r[0]?.id||"",A=async()=>{if(!(!u.trim()||w)){H(!0);try{let P=await s.create({title:u.trim(),...f.trim()?{summary:f.trim()}:{},...S?{template:S}:{},tags:k.split(",").map(y=>y.trim().toLowerCase()).filter(Boolean),projectId:x||null});if(n(P.id),N)if(!L)B("Doc created. Add a project to let an agent draft it.","error");else{let y=await s.askAgent(P.id,{prompt:Bl(v),projectId:L});St(i,P,y.threadId),B(`An agent is drafting \u201C${P.title}\u201D. Watch it fill in as it writes.`)}t()}catch(P){B(`Could not create the doc: ${_(P)}`,"error"),H(!1)}}};return o(aa,{title:"New design doc",wide:!0,onClose:t,footer:d($,{children:[o("span",{className:"dd-muted dd-dialog-hint",children:N?"An agent starts a new thread to draft it.":"You can ask an agent to fill it in later."}),o("span",{className:"dd-spacer"}),o("button",{type:"button",className:"btn",onClick:t,children:"Cancel"}),d("button",{type:"button",className:"btn primary",disabled:!u.trim()||w,onClick:()=>{A()},children:[w?o(K,{size:12}):N?o(de,{size:12,"aria-hidden":!0}):null,N?"Create & draft with agent":"Create"]})]}),children:d("form",{className:"dd-form",onSubmit:P=>{P.preventDefault(),A()},children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Title"}),o("input",{className:"dd-input",value:u,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:P=>c(P.target.value),autoFocus:!0})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Summary"}),o("input",{className:"dd-input",value:f,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:P=>C(P.target.value)})]}),d("div",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Template"}),l.data?o(Ds,{templates:l.data,selected:S,onSelect:p}):o(K,{label:"Loading templates"})]}),d("div",{className:"dd-field-row",children:[d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),d("select",{className:"dd-input dd-select",value:x,onChange:P=>I(P.target.value),children:[o("option",{value:"",children:"Global (all projects)"}),r.map(P=>o("option",{value:P.id,children:P.name},P.id))]})]}),d("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Tags"}),o("input",{className:"dd-input",value:k,placeholder:"sync, mobile",onChange:P=>D(P.target.value)})]})]}),d("label",{className:"dd-field",children:[d("span",{className:"dd-field-label",children:[o(de,{size:12,"aria-hidden":!0})," Brief for an agent ",o("span",{className:"dd-muted",children:"(optional)"})]}),o("textarea",{className:"dd-input",rows:4,value:v,maxLength:Ml,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:P=>M(P.target.value)})]}),o("button",{type:"submit",hidden:!0})]})})}function _l({templates:e,onNew:a}){return o("div",{className:"dd-landing",children:d("div",{className:"dd-landing-inner",children:[o("span",{className:"dd-landing-icon",children:o(We,{size:26,"aria-hidden":!0})}),o("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),o("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),d("ul",{className:"dd-landing-points",children:[d("li",{children:[o(de,{size:13,"aria-hidden":!0})," ",o("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),d("li",{children:[o(ye,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),d("li",{children:[o(ge,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),d("div",{className:"dd-landing-start",children:[o("span",{className:"dd-section-label",children:"Start from a template"}),e?o(Ds,{templates:e,selected:null,onSelect:r=>a(r)}):o(K,{})]})]})})}function bo({projectId:e,location:a,onLocationChange:r,variant:t,headerActions:n}){let s=Fe(),i=Zt(),[l,u]=b(null),[c,f]=le("list-open",!0),C=s.data??[];return d("div",{className:"dd-root dd-workbench",children:[c?o(Hl,{projectId:t==="project"?e:null,showProjects:t==="global",projects:C,activeId:a.docId,onSelect:m=>r({docId:m,path:null}),onDeleted:m=>{m===a.docId&&r({docId:null,path:null})},onNew:()=>u({template:null}),onCollapse:()=>f(!1),headerActions:n}):d("nav",{className:"dd-list-collapsed","aria-label":"Design docs",children:[o(U,{icon:Re,label:"Show doc list",onClick:()=>f(!0)}),o(U,{icon:xe,label:"New design doc",onClick:()=>u({template:null})}),n]}),o("main",{className:"dd-main",children:a.docId?o(Vt,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(m,p)=>r({docId:a.docId,path:m},p??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):o(_l,{templates:i.data,onNew:m=>u({template:m??null})})}),l?o(Co,{initialTemplate:l.template,defaultProjectId:e,projects:C,onClose:()=>u(null),onCreated:m=>r({docId:m,path:null})}):null]})}var Ba="design-docs";function Ts({children:e}){return o("div",{className:"dd-root",children:e})}function Ms({subPath:e}){let a=Ce();return o(bo,{variant:"global",projectId:null,location:Jt(e),onLocationChange:(r,t)=>a.toPluginPanel(Ba,{subPath:Da(r),...t?{replace:t}:{}})})}function Rs({projectId:e,headerActions:a}){let[r,t]=le(`project-location:${e}`,"");return o(bo,{variant:"project",projectId:e,location:Jt(r),onLocationChange:n=>t(Da(n)),headerActions:a})}function Ul(e,a,r,t){e.openThreadPanel({actionId:ka,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...t?{threadId:t}:{}})||e.toPluginPanel(Ba,{subPath:Da(a)})}function Fs({attributes:e,source:a,message:r}){let t=Ce(),n=e.id?.trim()||null,s=e.path?.trim()||null,i=qt(n);if(!n||i.error)return o("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:n?`Design doc unavailable: ${i.error}`:"Invalid design doc link: an id is required."});let l=i.data;return d("div",{className:"plugin-directive-card dd-card",children:[d("button",{type:"button",className:"plugin-directive-card-main",disabled:!l,onClick:()=>l&&Ul(t,{docId:l.id,path:s},l.title,r.threadId),title:l?`Open ${l.title} beside this conversation`:void 0,children:[o("span",{className:"dd-card-icon","aria-hidden":!0,children:o(We,{size:14})}),o("span",{className:"plugin-directive-card-kind",children:"Design doc"}),o("span",{className:"plugin-directive-card-title",children:l?l.title:"Loading\u2026"}),l?d("span",{className:"plugin-directive-card-meta dd-card-meta",children:[s?o("code",{children:s}):null,o(ea,{status:l.status,compact:!0}),l.files.length," file",l.files.length===1?"":"s",l.openComments?` \xB7 ${l.openComments} open comment${l.openComments===1?"":"s"}`:""]}):o(K,{size:12})]}),l?o("button",{type:"button",className:"plugin-directive-card-open",onClick:u=>{u.stopPropagation(),t.toPluginPanel(Ba,{subPath:Da({docId:l.id,path:s})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function zl({projectId:e,onPick:a}){let r=Pa({...e?{projectId:e}:{},status:"active"}),t=Fe(),n=va(),[s,i]=b(!1);return d("div",{className:"dd-picker",children:[d("div",{className:"dd-picker-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),d("button",{type:"button",className:"btn primary",onClick:()=>i(!0),children:[o(xe,{size:13,"aria-hidden":!0})," New"]})]}),o("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(l=>d("button",{type:"button",className:"dd-doc-row",onClick:()=>a(l.id),children:[d("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:l.title}),o(ea,{status:l.status,compact:!0})]}),l.summary?o("span",{className:"dd-doc-row-summary",children:l.summary}):null,d("span",{className:"dd-doc-row-meta",children:[d("span",{children:[l.fileCount," files"]}),o("span",{className:"dd-spacer"}),o(fe,{at:l.updatedAt,now:n})]})]},l.id)):o(ve,{icon:We,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):o("div",{className:"dd-center",children:r.error?o("div",{className:"dd-banner dd-banner-error",children:r.error}):o(K,{})})}),s?o(Co,{defaultProjectId:e,projects:t.data??[],onClose:()=>i(!1),onCreated:l=>a(l)}):null]})}function Bs(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function Ns(e){let{docId:a,path:r}=Bs(e.params);return o(jl,{...e},`${a}\0${r}`)}function jl({params:e,projectId:a}){let r=Ce(),t=Bs(e),[n,s]=b(t),i=!t.docId;if(!n.docId)return o(Ts,{children:o(zl,{projectId:a??null,onPick:u=>s({docId:u,path:null})})});let l=n.docId;return o(Ts,{children:o(Vt,{docId:l,path:n.path,layout:"compact",contextProjectId:a??null,onOpenPath:u=>s({docId:l,path:u}),onDeleted:()=>s({docId:null,path:null}),headerExtra:d($,{children:[i?o(U,{icon:ia,label:"All design docs",onClick:()=>s({docId:null,path:null})}):null,o(U,{icon:He,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(Ba,{subPath:Da(n)})})]})},l)})}async function Es({threadId:e,message:a,selectedText:r,openPanel:t}){let n=(r?.trim()||a.text).trim();if(!n){B("This message has no text to save.","error");return}try{let s=await vo(dn,"createFromMessage",{threadId:e,text:n});t({actionId:ka,title:s.title,params:{docId:s.id}}),B(`Saved \u201C${s.title}\u201D as a design doc`)}catch(s){B(`Could not save the design doc: ${_(s)}`,"error")}}var yo=`
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
.dd-doc-row-meta > span.dd-doc-row-project { display: block; flex: 0 1 auto; min-width: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
.dd-doc-row-comments { color: var(--accent-gold); }
.dd-doc-row-alt { position: relative; width: calc(100% - 14px); margin-left: 14px; padding-top: 7px; padding-bottom: 7px; }
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
  letter-spacing: 0.03em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
}
.dd-list-section:hover { color: var(--text-primary); }
.dd-list-section-caret { flex: 0 0 auto; transition: transform 120ms ease; }
.dd-list-section[aria-expanded='false'] .dd-list-section-caret { transform: rotate(-90deg); }
.dd-list-section-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
`;var Os="design-docs-plugin-styles";function Gl(){if(typeof document>"u")return;let e=document.getElementById(Os);if(e instanceof HTMLStyleElement){e.textContent=yo;return}let a=document.createElement("style");a.id=Os,a.textContent=yo,document.head.appendChild(a)}Gl();var Mx=wo(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:Ba,component:Ms}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:Rs}),e.slots.messageDirective({id:"design-doc",component:Fs}),e.slots.threadPanelAction({id:ka,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:Ns}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:Es})});export{Mx as default,Gl as injectStyles};
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
