function Ad(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function At(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function Io(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function Co(e,a,r){return Ad().callRpc(e,a,r)}function bo(e){return{__zccPluginApp:!0,setup:e}}function So(){return At().useRpc?.()??Io("useRpc")}function yo(e,a){At().useRealtime?.(e,a)}function Ce(){return At().useZccNavigate?.()??Io("useZccNavigate")}function Dd(){return globalThis.__ZCC_HOST_REACT__}function Po(e,a){let r=Dd(),t=At()[e];return!r||!t?null:r.createElement(t,a)}function vo(e){return Po("ThreadChat",e)}function _a(e){return Po("Markdown",e)}var G=globalThis.__ZCC_HOST_REACT__;var zl=G.Children,Gl=G.Component,jl=G.Fragment,$l=G.StrictMode,Vl=G.Suspense,Wl=G.cloneElement,wo=G.createContext,ba=G.createElement,Xl=G.createRef,Dt=G.forwardRef,Kl=G.isValidElement,Zl=G.lazy,Jl=G.memo,Ql=G.startTransition,we=G.useCallback,ko=G.useContext,Yl=G.useDebugValue,Ao=G.useDeferredValue,E=G.useEffect,Do=G.useId,ei=G.useImperativeHandle,ai=G.useInsertionEffect,Sa=G.useLayoutEffect,V=G.useMemo,ti=G.useReducer,M=G.useRef,b=G.useState,To=G.useSyncExternalStore,oi=G.useTransition,ri=G.version;var Mo=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Ro(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:Mo(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var Fo=e=>{let a="",r=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){r=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=r?t.toUpperCase():t,r=!1}return a};var Bo=e=>{let a=Fo(e);return a.charAt(0).toUpperCase()+a.slice(1)};var Ua=(...e)=>e.filter((a,r,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===r).join(" ").trim();var $e={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function $t(e){return e!=null}function No(e,a={}){let r=a.attributeNames??{},t=L=>r[L]??L,n=e.size??e.width??$e.width,d=e.size??e.height??$e.height,i=e.aliases?.filter(L=>typeof L=="string"&&L.trim()!=="").map(L=>`lucide-${L}`)??[],l=[...e.name?[`lucide-${e.name}`]:[],...i],c=a.className?.split(" ").filter(Boolean)??[],f=a.includeDefaultClasses===!1?Ua(...c):Ua("lucide",...l,...c),u=a.absoluteStrokeWidth?Number(a.strokeWidth??$e["stroke-width"])*Number(e.size??e.width??$e.width)/Number(a.size??a.width??$e.width):a.strokeWidth??$e["stroke-width"];return["svg",{...Object.entries($e).reduce((L,[I,C])=>(L[t(I)]=C,L),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&$t(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&$t(a.width)&&{[t("width")]:a.width},..."height"in a&&$t(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:u,...f&&{[t("class")]:f},[t("viewBox")]:`0 0 ${n} ${d}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(L=>{let[I,C,m]=L,k=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...C}:C;return m?[I,k,m]:[I,k]})]}function Eo(e,a={}){return No(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var Oo=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Td=wo({});var qo=()=>ko(Td);var Ho=Dt(({color:e,size:a,width:r,height:t,strokeWidth:n,absoluteStrokeWidth:d,nonScalingStroke:i,className:l="",children:c,iconNode:f=[],icon:u={node:f,aliases:[],size:24},...h},L)=>{let{size:I=24,strokeWidth:C=2,absoluteStrokeWidth:m=!1,nonScalingStroke:k=!1,color:R="currentColor",className:A=""}=qo()??{},N=!!c||Oo(h),[w,q,y=[]]=Eo(u,{color:e??R,width:r??a??I,height:t??a??I,strokeWidth:n??C,absoluteStrokeWidth:d??m,nonScalingStroke:i??k,className:Ua(A,l),hasA11yProp:N,attributes:h});return ba(w,{ref:L,...q},[...y.map(([B,x])=>ba(B,x)),...Array.isArray(c)?c:[c]])});function g(e,a=[],r=[]){let t=typeof e=="string"?Ro(e,a,r):e,n=Dt(({className:d,...i},l)=>ba(Ho,{ref:l,icon:t,className:d,...i}));return t.name&&(n.displayName=Bo(t.name)),n}var _o={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};_o.node;var za=g(_o);var Uo={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};Uo.node;var Ga=g(Uo);var zo={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};zo.node;var la=g(zo);var Go={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};Go.node;var ja=g(Go);var jo={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};jo.node;var ue=g(jo);var $o={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};$o.node;var $a=g($o);var Vo={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};Vo.node;var Oe=g(Vo);var Wo={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};Wo.node;var ce=g(Wo);var Xo={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};Xo.node;var ia=g(Xo);var Ko={name:"chevron-up",size:24,node:[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]};Ko.node;var Va=g(Ko);var Zo={name:"circle-dot",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]};Zo.node;var Wa=g(Zo);var Jo={name:"cloud-upload",size:24,node:[["path",{d:"M12 13v8",key:"1l5pq0"}],["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"m8 17 4-4 4 4",key:"1quai1"}]],aliases:["upload-cloud"]};Jo.node;var qe=g(Jo);var Qo={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};Qo.node;var Ve=g(Qo);var Yo={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};Yo.node;var Xa=g(Yo);var er={name:"corner-down-right",size:24,node:[["path",{d:"m15 10 5 5-5 5",key:"qqa56n"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12",key:"z08zvw"}]]};er.node;var Ka=g(er);var ar={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};ar.node;var We=g(ar);var tr={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};tr.node;var Za=g(tr);var or={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};or.node;var ke=g(or);var rr={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};rr.node;var He=g(rr);var nr={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};nr.node;var Ja=g(nr);var dr={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};dr.node;var Qa=g(dr);var sr={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};sr.node;var be=g(sr);var lr={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};lr.node;var Ya=g(lr);var ir={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};ir.node;var Xe=g(ir);var ur={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};ur.node;var Ae=g(ur);var cr={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};cr.node;var ua=g(cr);var fr={name:"file-type",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M11 18h2",key:"12mj7e"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5",key:"qbrxap"}]]};fr.node;var et=g(fr);var pr={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};pr.node;var Ke=g(pr);var mr={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};mr.node;var at=g(mr);var gr={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};gr.node;var _e=g(gr);var hr={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};hr.node;var tt=g(hr);var xr={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};xr.node;var ot=g(xr);var Lr={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};Lr.node;var ca=g(Lr);var Ir={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};Ir.node;var Ze=g(Ir);var Cr={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};Cr.node;var rt=g(Cr);var br={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};br.node;var Je=g(br);var Sr={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};Sr.node;var fa=g(Sr);var yr={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};yr.node;var nt=g(yr);var Pr={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};Pr.node;var De=g(Pr);var vr={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};vr.node;var dt=g(vr);var wr={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};wr.node;var st=g(wr);var kr={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};kr.node;var Te=g(kr);var Ar={name:"panel-left-open",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m14 9 3 3-3 3",key:"8010ee"}]],aliases:["sidebar-open"]};Ar.node;var Me=g(Ar);var Dr={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};Dr.node;var lt=g(Dr);var Tr={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};Tr.node;var pa=g(Tr);var Mr={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};Mr.node;var xe=g(Mr);var Rr={name:"reply",size:24,node:[["path",{d:"M20 18v-2a4 4 0 0 0-4-4H4",key:"5vmcpk"}],["path",{d:"m9 17-5-5 5-5",key:"nvlc11"}]]};Rr.node;var it=g(Rr);var Fr={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};Fr.node;var Se=g(Fr);var Br={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};Br.node;var Ue=g(Br);var Nr={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};Nr.node;var ut=g(Nr);var Er={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};Er.node;var ct=g(Er);var Or={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Or.node;var ma=g(Or);var qr={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};qr.node;var ft=g(qr);var Hr={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};Hr.node;var ae=g(Hr);var _r={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};_r.node;var pt=g(_r);var Ur={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};Ur.node;var mt=g(Ur);var zr={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};zr.node;var ge=g(zr);var Gr={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};Gr.node;var ye=g(Gr);var jr={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};jr.node;var gt=g(jr);var $r={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};$r.node;var ht=g($r);var Vr={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};Vr.node;var Qe=g(Vr);var Wr={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};Wr.node;var xt=g(Wr);var Xr={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};Xr.node;var re=g(Xr);var Kr=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];var Tt=4e3;function Md(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function Rd(e){let a=(t,n)=>e(t,n===void 0?void 0:Md(n)),r=async t=>{await t};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(t={})=>a("list",t),get:t=>a("get",{doc:t}),create:t=>a("create",t),update:(t,n)=>a("update",{doc:t,...n}),remove:t=>r(a("remove",{doc:t})),readFile:(t,n)=>a("readFile",{doc:t,path:n}),renderPage:(t,n)=>a("renderPage",{doc:t,...n}),readPageFile:(t,n)=>a("readPageFile",{doc:t,path:n}),pageLink:(t,n)=>a("pageLink",{doc:t,path:n}),siteFiles:t=>a("siteFiles",{doc:t}),reportRender:(t,n)=>r(a("reportRender",{doc:t,...n})),writeFile:(t,n)=>a("writeFile",{doc:t,...n}),editFile:(t,n)=>a("editFile",{doc:t,...n}),deleteFile:(t,n)=>r(a("deleteFile",{doc:t,path:n})),renameFile:(t,n,d)=>a("renameFile",{doc:t,from:n,to:d}),history:(t,n={})=>a("history",{doc:t,...n}),revision:(t,n)=>a("revision",{doc:t,id:n}),restore:(t,n,d)=>a("restore",{doc:t,id:n,baseRevision:d}),addComment:(t,n)=>a("addComment",{doc:t,...n}),replyToComment:(t,n,d)=>a("replyToComment",{doc:t,id:n,body:d}),setCommentStatus:(t,n,d)=>a("setCommentStatus",{doc:t,id:n,status:d}),deleteComment:(t,n)=>r(a("deleteComment",{doc:t,id:n})),unlinkThread:(t,n)=>r(a("unlinkThread",{doc:t,threadId:n})),askAgent:(t,n)=>a("askAgent",{doc:t,...n,path:n.path??void 0}),publish:(t,n)=>a("publish",{doc:t,...n})}}function U(){let e=So();return V(()=>Rd((a,r)=>e.call(a,r)),[e])}function H(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function Zr(e){return/changed since revision/i.test(H(e))}function Jr(e){return/^design doc .* not found/i.test(e)}function F(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var Qr="design-docs";var Yr="changed",Mt=["draft","review","approved","implemented","archived"],Rt={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function en(e,a){let r=t=>t.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Ye(e,a){let[r,t]=b({key:e,data:null,error:null,loading:e!==null}),[n,d]=b(0),i=M(a);i.current=a,E(()=>{if(e===null){t({key:e,data:null,error:null,loading:!1});return}let f=!1;return t(u=>({key:e,data:u.key===e?u.data:null,error:null,loading:!0})),i.current().then(u=>{f||t({key:e,data:u,error:null,loading:!1})},u=>{f||t(h=>({key:e,data:h.key===e?h.data:null,error:H(u),loading:!1}))}),()=>{f=!0}},[e,n]);let l=we(()=>d(f=>f+1),[]),c=r.key===e;return{data:c?r.data:null,error:c?r.error:null,loading:c?r.loading:e!==null,reload:l}}function tn(e,a=120){let r=M(e);r.current=e;let t=M(new Set),n=M(null);E(()=>()=>{n.current&&clearTimeout(n.current)},[]),yo(Yr,d=>{let i=typeof d?.docId=="string"?d.docId:null;t.current.add(i),!n.current&&(n.current=setTimeout(()=>{n.current=null;let l=[...t.current];t.current.clear();for(let c of l)r.current(c)},a))})}function Ft(e){let a=U(),r=Ye(JSON.stringify(e),()=>a.list(e));return tn(()=>r.reload()),r}function Bt(e){let a=U(),r=Ye(e,()=>a.get(e));return tn(t=>{(t===null||t===e)&&r.reload()}),r}function on(e,a,r){let t=U(),n=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Ye(n,()=>t.readFile(e,a))}function Vt(){let e=U();return Ye("templates",()=>e.templates())}function Re(){let e=U();return Ye("projects",()=>e.projects())}var an="zcc.design-docs.";function de(e,a){let[r,t]=b(()=>{try{let d=globalThis.localStorage?.getItem(an+e);if(d==null)return a;let i=JSON.parse(d);return typeof i==typeof a?i:a}catch{return a}}),n=we(d=>{t(d);try{globalThis.localStorage?.setItem(an+e,JSON.stringify(d))}catch{}},[e]);return[r,n]}function rn(e){let[a,r]=b(null),[t,n]=b(null);return Sa(()=>{if(!a)return;let d=l=>n(l>0?e.filter(c=>l>=c).length:null);if(d(a.getBoundingClientRect().width),typeof ResizeObserver>"u")return;let i=new ResizeObserver(l=>d(l[0]?.contentRect.width??0));return i.observe(a),()=>i.disconnect()},[a,e]),[r,t]}function ya(e=6e4){let[a,r]=b(()=>Date.now());return E(()=>{let t=setInterval(()=>r(Date.now()),e);return()=>clearInterval(t)},[e]),a}var Fd=Symbol.for("react.portal");function Bd(e,a){return{$$typeof:Fd,key:null,children:e,containerInfo:a,implementation:null}}function Wt(e){return typeof document>"u"?e:Bd(e,document.body)}function ga(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function nn(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let t=Math.round(r/60);if(t<60)return`${t}m ago`;let n=Math.round(t/60);if(n<24)return`${n}h ago`;let d=Math.round(n/24);return d<30?`${d}d ago`:new Date(e).toISOString().slice(0,10)}var dn=globalThis.__ZCC_HOST_REACT__,j=dn.Fragment;function o(e,a,r){return dn.createElement(e,r===void 0?a:{...a,key:r})}var s=o;var Nd={MessageSquareText:nt,CheckCheck:$a,WandSparkles:Qe,Workflow:xt,ScanSearch:ct,ListChecks:rt};function sn(e){return Nd[e]??ae}function Pa({kind:e,size:a=14}){return o(e==="image"||e==="svg"?Ya:e==="font"?et:e==="markdown"||e==="text"?ua:Qa,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function ea({status:e,compact:a=!1}){return s("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[o("span",{className:"dd-status-dot","aria-hidden":!0}),Rt[e]]})}function Le({actor:e}){let a=e.kind==="agent"?ue:ht;return s("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[o(a,{size:12,"aria-hidden":!0}),o("span",{className:"dd-actor-label",children:e.label})]})}function se({at:e,now:a}){return o("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:nn(e,a)})}function W({size:e=14,label:a}){return o("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:o(Je,{size:e,className:"dd-spin","aria-hidden":!0})})}function Pe({icon:e,title:a,children:r}){return s("div",{className:"dd-empty",children:[o("span",{className:"dd-empty-icon",children:o(e,{size:22,"aria-hidden":!0})}),o("div",{className:"dd-empty-title",children:a}),r?o("div",{className:"dd-empty-body",children:r}):null]})}function _({icon:e,label:a,onClick:r,active:t=!1,danger:n=!1,disabled:d=!1,size:i=14}){return o("button",{type:"button",className:`icon-btn dd-icon-btn${t?" on":""}${n?" danger":""}`,title:a,"aria-label":a,"aria-pressed":t||void 0,disabled:d,onClick:r,children:o(e,{size:i,"aria-hidden":!0})})}function ln(e,a){let r=M(null),t=M(a);return t.current=a,E(()=>{if(!e)return;let n=i=>{r.current&&i.target instanceof Node&&!r.current.contains(i.target)&&t.current()},d=i=>{i.key==="Escape"&&t.current()};return document.addEventListener("mousedown",n),document.addEventListener("keydown",d),()=>{document.removeEventListener("mousedown",n),document.removeEventListener("keydown",d)}},[e]),r}function ve({open:e,onClose:a,anchor:r,children:t,align:n="end",className:d=""}){let i=ln(e,a);return s("div",{className:"dd-pop-anchor",ref:i,children:[r,e?o("div",{className:`dd-pop dd-pop-${n} ${d}`,role:"dialog",children:t}):null]})}function un(e){if(e.clientX||e.clientY)return{x:e.clientX,y:e.clientY};let a=e.currentTarget.getBoundingClientRect();return{x:a.left+12,y:a.bottom}}var Nt=4;function cn({at:e,label:a,onClose:r,children:t}){let n=ln(!0,r),d=M(r);d.current=r;let[i,l]=b(e);Sa(()=>{let f=n.current,{width:u,height:h}=f.getBoundingClientRect();l({x:Math.max(Nt,Math.min(e.x,window.innerWidth-u-Nt)),y:Math.max(Nt,Math.min(e.y,window.innerHeight-h-Nt))})},[n,e.x,e.y]),E(()=>{let f=document.activeElement instanceof HTMLElement?document.activeElement:null;n.current?.querySelector('[role="menuitem"]')?.focus();let u=h=>{h.target instanceof Node&&n.current?.contains(h.target)||d.current()};return window.addEventListener("scroll",u,!0),window.addEventListener("resize",u),window.addEventListener("blur",u),()=>{window.removeEventListener("scroll",u,!0),window.removeEventListener("resize",u),window.removeEventListener("blur",u),f?.isConnected&&(document.activeElement===document.body||n.current?.contains(document.activeElement))&&f.focus()}},[n]);let c=f=>{let u=[...f.currentTarget.querySelectorAll('[role="menuitem"]')],h=u.indexOf(document.activeElement),L=f.key==="ArrowDown"?(h+1)%u.length:f.key==="ArrowUp"?(h-1+u.length)%u.length:f.key==="Home"?0:f.key==="End"?u.length-1:-1;f.key==="Tab"&&r(),!(L<0||!u.length)&&(f.preventDefault(),u[L].focus())};return Wt(o("div",{ref:n,className:"dd-pop dd-menu dd-context-menu",role:"menu","aria-label":a,style:{left:i.x,top:i.y},onKeyDown:c,onContextMenu:f=>f.preventDefault(),children:t}))}function fe({icon:e,label:a,hint:r,onSelect:t,danger:n=!1,checked:d=!1}){return s("button",{type:"button",role:"menuitem",className:`dd-menu-item${n?" dd-menu-danger":""}${d?" dd-menu-checked":""}`,onClick:t,children:[e?o(e,{size:14,"aria-hidden":!0}):null,o("span",{className:"dd-menu-label",children:a}),r?o("span",{className:"dd-menu-hint",children:r}):null]})}function Fe({request:e,onClose:a}){let[r,t]=b(!1),n=async()=>{t(!0);try{await e.run()}finally{t(!1),a()}};return o(ha,{title:e.title,onClose:a,footer:s(j,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{n()},autoFocus:!0,children:e.confirmLabel})]}),children:o("div",{className:"dd-confirm-body",children:e.body})})}function ha({title:e,onClose:a,children:r,footer:t,wide:n=!1}){return E(()=>{let d=i=>{i.key==="Escape"&&a()};return document.addEventListener("keydown",d),()=>document.removeEventListener("keydown",d)},[a]),Wt(o("div",{className:"dd-dialog-backdrop",onMouseDown:d=>{d.target===d.currentTarget&&a()},children:s("div",{className:`dd-dialog${n?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[s("div",{className:"dd-dialog-header",children:[o("span",{className:"dd-dialog-title",children:e}),o(_,{icon:re,label:"Close",onClick:a})]}),o("div",{className:"dd-dialog-body",children:r}),t?o("div",{className:"dd-dialog-footer",children:t}):null]})}))}var fn={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},va="design-doc";function Lt(e,a,r){e.openPanelAgent?.({threadId:r,title:a.title})||(e.openThreadPanel({actionId:va,title:a.title,params:{docId:a.id},threadId:r}),e.toThread(r))}function pn({doc:e,now:a,chatThreadId:r=null,onOpenChat:t}){let n=U(),d=Ce(),i=[...e.threads].sort((c,f)=>f.lastActivityAt-c.lastActivityAt),l=t?i.find(c=>c.threadId===r):void 0;return l&&t?s("div",{className:"dd-rail-pane dd-agents dd-agent-chat",children:[s("div",{className:"dd-agent-chat-head",children:[o(_,{icon:la,label:"All agents",size:13,onClick:()=>t(null)}),o("span",{className:"dd-agent-chat-title",title:l.title,children:l.title}),o("span",{className:`dd-role dd-role-${l.role}`,children:fn[l.role]}),o(_,{icon:He,label:"Open full thread",size:13,onClick:()=>d.toThread(l.threadId)})]}),o(vo,{threadId:l.threadId,variant:"compact",layout:"contained",className:"dd-agent-chat-body"})]}):o("div",{className:"dd-rail-pane dd-agents",children:s("div",{className:"dd-rail-scroll",children:[i.length?o("ul",{className:"dd-thread-list",children:i.map(c=>s("li",{className:"dd-thread",children:[s("button",{type:"button",className:"dd-thread-open",onClick:()=>t?t(c.threadId):d.toThread(c.threadId),title:t?"Open chat beside the doc":"Open thread",children:[o(ue,{size:14,"aria-hidden":!0}),s("span",{className:"dd-thread-main",children:[o("span",{className:"dd-thread-title",children:c.title}),s("span",{className:"dd-thread-meta",children:[o("span",{className:`dd-role dd-role-${c.role}`,children:fn[c.role]}),o(se,{at:c.lastActivityAt,now:a})]})]})]}),o(_,{icon:gt,label:"Unlink thread",size:13,onClick:()=>{n.unlinkThread(e.id,c.threadId).catch(f=>F(`Could not unlink: ${H(f)}`,"error"))}})]},c.threadId))}):s(Pe,{icon:ue,title:"No agents yet",children:["Use ",o("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),s("div",{className:"dd-agents-hint",children:[o(ja,{size:13,"aria-hidden":!0}),s("span",{children:["Agents in this project already know this doc exists. Type ",o("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",o("code",{children:"design_doc_read"}),"."]})]})]})})}function mn({doc:e,activePath:a,request:r,contextProjectId:t,compact:n=!1}){let d=U(),i=Ce(),[l,c]=b(!1),[f,u]=b(""),[h,L]=b(!1),[I,C]=b(t??""),[m,k]=b(null),R=Re(),A=M(null),N=!e.projectId,w=R.data??[],q=N?I||w[0]?.id||"":e.projectId;E(()=>{r&&(u(r.prompt),L(!0),c(!0),requestAnimationFrame(()=>{let x=A.current;x&&(x.focus(),x.selectionStart=x.selectionEnd=x.value.length)}))},[r]),E(()=>{l&&L(x=>x||!!a&&a!==e.entryPath)},[l,a,e.entryPath]);let y=async x=>{if(!m){if(N&&!q){F("Add a project first: agents run inside a project.","error");return}k(x??"custom");try{let P=await d.askAgent(e.id,{...x?{action:x}:{},...f.trim()&&!x?{prompt:f.trim()}:{},path:h?a:null,...N?{projectId:q}:{}});Lt(i,e,P.threadId),F(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),c(!1),u("")}catch(P){F(`Could not start the agent: ${H(P)}`,"error")}finally{k(null)}}},B=x=>{x.key==="Enter"&&(x.metaKey||x.ctrlKey)&&(x.preventDefault(),f.trim()&&y(null))};return s(ve,{open:l,onClose:()=>c(!1),className:"dd-ask",anchor:s("button",{type:"button",className:`btn primary dd-ask-trigger${n?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":l,onClick:()=>c(!l),children:[o(ae,{size:13,"aria-hidden":!0}),n?null:"Ask agent",o(ce,{size:12,"aria-hidden":!0})]}),children:[s("div",{className:"dd-ask-head",children:[o("span",{className:"dd-ask-title",children:"Ask an agent"}),o("span",{className:"dd-muted",children:"Starts a new thread that edits this doc live"})]}),o("div",{className:"dd-ask-actions",role:"menu",children:Kr.map(x=>{let P=sn(x.icon);return s("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!m,onClick:()=>{y(x.id)},title:x.description,children:[o("span",{className:"dd-ask-action-icon",children:m===x.id?o(W,{size:13}):o(P,{size:14,"aria-hidden":!0})}),s("span",{className:"dd-ask-action-text",children:[o("span",{className:"dd-ask-action-label",children:x.label}),o("span",{className:"dd-ask-action-desc",children:x.description})]})]},x.id)})}),s("div",{className:"dd-ask-custom",children:[o("textarea",{ref:A,className:"dd-input",rows:3,maxLength:Tt,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:f,onChange:x=>u(x.target.value),onKeyDown:B}),s("div",{className:"dd-ask-options",children:[a?s("label",{className:"dd-check",children:[o("input",{type:"checkbox",checked:h,onChange:x=>L(x.target.checked)}),"Focus on ",o("code",{children:a})]}):null,N?s("label",{className:"dd-field-inline",children:["Run in",s("select",{className:"dd-input dd-select",value:q,onChange:x=>C(x.target.value),children:[w.length?null:o("option",{value:"",children:"No projects"}),w.map(x=>o("option",{value:x.id,children:x.name},x.id))]})]}):null,o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",disabled:!f.trim()||!!m,onClick:()=>{y(null)},children:[m==="custom"?o(W,{size:12}):null,"Start"]})]})]})]})}var Ed=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),Od=/[A-Za-z][^\t\n\f\r />]*/y,qd=/[\t\n\f\r /]*/y,gn=/[\t\n\f\r ]*/y,Hd=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,_d=/[^\t\n\f\r >]*/y,Ud={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function zd(e){return e.includes("&")?e.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(a,r,t,n)=>{if(n)return Ud[n.toLowerCase()]??a;let d=r?Number(r):parseInt(t,16);return d>0&&d<=1114111?String.fromCodePoint(d):a}):e}function hn(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function wa(e,a,r){return e.lastIndex=r,e.exec(a)?.[0]??""}function Gd(e,a){let r=wa(Od,e,a+1),t=a+1+r.length,n=[];for(;t<e.length;){let d=wa(qd,e,t);if(t+=d.length,t>=e.length)return null;if(e[t]===">")return{name:r.toLowerCase(),attributes:n,selfClosing:d.endsWith("/"),start:a,end:t+1};let i=wa(Hd,e,t)||e[t];t+=i.length,t+=wa(gn,e,t).length;let l=null;if(e[t]==="="){t+=1,t+=wa(gn,e,t).length;let c=e[t];if(c==='"'||c==="'"){let f=e.indexOf(c,t+1);if(f<0)return null;l=e.slice(t+1,f),t=f+1}else l=wa(_d,e,t),t+=l.length}n.push({name:i.toLowerCase(),value:l===null?null:zd(l)})}return null}function*jd(e){let a=0;for(;a<e.length;){let r=e.indexOf("<",a);if(r<0)return;let t=e[r+1]??"";if(e.startsWith("<!--",r)){let d=e.indexOf("-->",r+4);a=d<0?e.length:d+3;continue}if(t==="!"||t==="?"||t==="/"&&/[A-Za-z]/.test(e[r+2]??"")){let d=e.indexOf(">",r+2);a=d<0?e.length:d+1;continue}if(!/[A-Za-z]/.test(t)){a=r+1;continue}let n=Gd(e,r);if(!n)return;if(a=n.end,Ed.has(n.name)){let d=new RegExp(`</${n.name}(?=[\\t\\n\\f\\r />])`,"ig");d.lastIndex=n.end;let i=d.exec(e),l=i?i.index:e.length,c=i?e.indexOf(">",l):-1,f=c<0?e.length:c+1;yield{...n,content:{start:n.end,end:l,closeEnd:f}},a=f;continue}yield n}}function Et(e,a){let r=-1;for(let n of jd(e)){if(n.name==="head")return e.slice(0,n.end)+a+e.slice(n.end);if(n.name==="html"){r=n.end;continue}break}if(r>=0)return e.slice(0,r)+a+e.slice(r);let t=e.match(/^\s*<!doctype[^>]*>/i);return t?t[0]+a+e.slice(t[0].length):a+e}function It(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var $d={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},Vd={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"};var xn={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function xa(e){let a=It(e),r=$d[a];return r||(xn[a]?"code":"text")}function Ln(e){return xn[It(e)]??""}function ze(e){return e==="image"||e==="font"}function In(e){return Vd[It(e)]??null}var Wd=/^[a-z][a-z0-9+.-]*:/i;function Ct(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||Wd.test(r))return null;let t=r.split(/[?#]/,1)[0],n=t;try{n=decodeURIComponent(t)}catch{}let d=n.startsWith("/")?[]:e.split("/").slice(0,-1);for(let i of n.split("/"))if(!(!i||i===".")){if(i===".."){if(!d.length)return null;d.pop();continue}d.push(i)}return d.length?d.join("/"):null}function Cn(e,a){let r=e.split("/"),t=a.split("/"),n=Math.min(r.length,t.length);for(let d=0;d<n;d+=1){let i=d===r.length-1,l=d===t.length-1;if(r[d]!==t[d])return i!==l?i?-1:1:r[d].localeCompare(t[d],void 0,{sensitivity:"base",numeric:!0})}return r.length-t.length}function Xt(e){let a=(e??"").split("/").filter(Boolean),[r,...t]=a;return{docId:r??null,path:t.length?t.join("/"):null}}function ka(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}function Xd(e){let a=new TextEncoder().encode(e),r="";for(let t=0;t<a.length;t+=32768)r+=String.fromCharCode(...a.subarray(t,t+32768));return btoa(r)}function Kt(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${Xd(e.content)}`;let a=In(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var bn=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;function Sn(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function yn(e,a){let r=new Set;for(let t of a.matchAll(bn)){let n=Ct(e,Sn(t[2]));n&&r.add(n)}return[...r]}function Pn(e,a,r){return r.size?a.replace(bn,(t,n,d,i="")=>{let l=Ct(e,Sn(d)),c=l?r.get(l):void 0;return c?`${n}${c}${i})`:t}):a}function Zt(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(n=>n[0].length)),t="`".repeat(Math.max(3,r+1));return`${t}${a}
${e.replace(/\n$/,"")}
${t}`}function vn(e,a){return Zt(a,Ln(e))}var Kd=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function wn(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let n of Kd){let d=r.getPropertyValue(n).trim();d&&(a[n]=d)}let t=r.getPropertyValue("color-scheme").trim();return t&&(a["color-scheme"]=t),a}var Zd=/^[^<>{};]*$/;function kn(e,a){let t=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>Zd.test(n)).map(([n,d])=>`${n}: ${d};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;return Et(e,t)}function An(e){let a=[],r=new Map;for(let t of[...e].sort((n,d)=>Cn(n.path,d.path))){let n=t.path.split("/"),d=a;for(let i=0;i<n.length-1;i+=1){let l=n.slice(0,i+1).join("/"),c=r.get(l);c||(c={kind:"folder",name:n[i],path:l,children:[]},r.set(l,c),d.push(c)),d=c.children}d.push({kind:"file",name:n.at(-1),path:t.path,file:t})}return a}var Dn=/^(?:(?:https|ssh):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/|[\w.-]+@([\w.-]+):)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;function Jd(e){return e.length>0&&e.length<=100&&/^[\w./-]+$/.test(e)&&!e.startsWith("-")&&!e.startsWith("/")&&!e.endsWith("/")&&!e.endsWith(".")&&!e.endsWith(".lock")&&!e.includes("..")&&!e.includes("//")}var Aa=class extends Error{};function Tn(e){let a=typeof e.repo=="string"?e.repo.trim():"";if(a.length>300)throw new Aa("repository URL must be at most 300 characters");if(a&&!Dn.test(a))throw new Aa("repository must be a clone URL such as https://github.com/owner/repo or git@github.com:owner/repo.git");let r=typeof e.branch=="string"?e.branch.trim():"";if(!Jd(r))throw new Aa("branch must be a valid git branch name, e.g. main or gh-pages");let t=e.folder??"root";if(t!=="root"&&t!=="docs")throw new Aa("folder must be root or docs");return{repo:a||null,branch:r,folder:t}}function Mn(e){let a=e.trim().match(Dn);if(!a)return null;let r=(a[1]??a[2]).toLowerCase(),[t,n]=[a[3],a[4]];return r==="github.com"?n.toLowerCase()===`${t.toLowerCase()}.github.io`?`https://${n}/`:`https://${t}.github.io/${n}/`:`https://${r}/pages/${t}/${n}/`}var Jt={repo:"",branch:"main",folder:"root"},Fn=e=>`zcc.design-docs.publish.${e}`;function Rn(e){try{let a=JSON.parse(localStorage.getItem(Fn(e))??"null");return a?{repo:typeof a.repo=="string"?a.repo:"",branch:typeof a.branch=="string"&&a.branch?a.branch:Jt.branch,folder:a.folder==="docs"?"docs":"root"}:Jt}catch{return Jt}}function es(e,a){try{localStorage.setItem(Fn(e),JSON.stringify(a))}catch{}}function as(e,a){try{return Tn({...e,repo:a?"":e.repo}),null}catch(r){return H(r)}}function ts({doc:e,onClose:a}){let r=U(),t=Ce(),n=Re(),[d,i]=b(()=>Rn(e.id)),[l,c]=b(()=>!Rn(e.id).repo),[f,u]=b(""),[h,L]=b(!1),I=!e.projectId,C=n.data??[],m=I?f||C[0]?.id||"":e.projectId,k=e.files.some(y=>y.kind==="html"),R=k?!l&&!d.repo.trim()?null:as(d,l):"This doc has no HTML pages to publish. Add an index.html first.",A=k&&!R&&(l||!!d.repo.trim())&&(!I||!!m),N=!l&&!R&&d.repo.trim()?Mn(d.repo):null,w=y=>i(B=>({...B,...y})),q=async()=>{if(!(!A||h)){L(!0);try{let y=await r.publish(e.id,{...l?{}:{repo:d.repo.trim()},branch:d.branch.trim(),folder:d.folder,...I?{projectId:m}:{}});es(e.id,{...d,repo:l?"":d.repo.trim(),branch:d.branch.trim()}),Lt(t,e,y.threadId),F(`Publishing \u201C${e.title}\u201D. The agent reports the live URL when the push lands.`),a()}catch(y){F(`Could not start publishing: ${H(y)}`,"error")}finally{L(!1)}}};return s(ha,{title:"Publish site",onClose:a,footer:s(j,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),s("button",{type:"button",className:"btn primary",disabled:!A||h,onClick:()=>{q()},children:[h?o(W,{size:12}):o(qe,{size:13,"aria-hidden":!0}),"Publish"]})]}),children:[o("p",{className:"dd-muted dd-publish-intro",children:"An agent exports this doc as a static site, commits it and pushes it with your git credentials. GitHub Pages then serves it."}),s("div",{className:"dd-publish-fields",children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Repository"}),s("select",{className:"dd-input dd-select",value:l?"own":"other",onChange:y=>c(y.target.value==="own"),children:[o("option",{value:"own",children:"This project's repository"}),o("option",{value:"other",children:"Another repository\u2026"})]})]}),l?null:s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Clone URL"}),o("input",{className:"dd-input",value:d.repo,maxLength:300,placeholder:"https://github.com/owner/repo",spellCheck:!1,autoFocus:!0,onChange:y=>w({repo:y.target.value})})]}),s("div",{className:"dd-field-row",children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Branch"}),o("input",{className:"dd-input",value:d.branch,maxLength:100,spellCheck:!1,onChange:y=>w({branch:y.target.value})})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Folder"}),s("select",{className:"dd-input dd-select",value:d.folder,onChange:y=>w({folder:y.target.value}),children:[o("option",{value:"root",children:"/ (root)"}),o("option",{value:"docs",children:"/docs"})]})]})]}),I?s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Run the agent in"}),s("select",{className:"dd-input dd-select",value:m,onChange:y=>u(y.target.value),children:[C.length?null:o("option",{value:"",children:"No projects"}),C.map(y=>o("option",{value:y.id,children:y.name},y.id))]})]}):null]}),R?o("p",{className:"dd-publish-problem",role:"alert",children:R}):s("p",{className:"dd-muted dd-field-help",children:[N?s(j,{children:["Expected at ",o("code",{children:N}),"."," "]}):null,"Turn on Pages in the repository settings once: deploy from ",o("code",{children:d.branch.trim()||"main"}),","," ",o("code",{children:d.folder==="docs"?"/docs":"/ (root)"}),". Other files in the repository are left in place."]})]})}function Bn({doc:e,compact:a=!1}){let[r,t]=b(!1);return s(j,{children:[s("button",{type:"button",className:"btn dd-publish-trigger",title:"Publish as a GitHub Pages site","aria-label":a?"Publish":void 0,onClick:()=>t(!0),children:[o(qe,{size:13,"aria-hidden":!0}),a?null:"Publish"]}),r?o(ts,{doc:e,onClose:()=>t(!1)}):null]})}var En=e=>e.key==="Enter"&&(e.metaKey||e.ctrlKey);function os({onSend:e,onCancel:a}){let[r,t]=b(""),[n,d]=b(!1),i=async()=>{let l=r.trim();if(!l||n)return;d(!0);let c=await e(l);d(!1),c&&t("")};return s("div",{className:"dd-reply-composer",children:[o("textarea",{className:"dd-input dd-composer-input",placeholder:"Reply\u2026 agents see the whole thread","aria-label":"Reply",value:r,maxLength:8e3,rows:2,autoFocus:!0,onChange:l=>t(l.target.value),onKeyDown:l=>{En(l)?(l.preventDefault(),i()):l.key==="Escape"&&(l.preventDefault(),a())}}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send \xB7 Esc to cancel"}),s("span",{className:"dd-reply-buttons",children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:!r.trim()||n,onClick:()=>{i()},children:"Reply"})]})]})]})}function rs({comment:e,fileGone:a,now:r,onToggle:t,onDelete:n,onDeleteReply:d,onReply:i,onFocus:l}){let c=e.status==="resolved",[f,u]=b(!1);return s("article",{className:`dd-comment${c?" dd-comment-resolved":""}`,children:[s("header",{className:"dd-comment-head",children:[o(Le,{actor:e.author}),o(se,{at:e.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(_,{icon:it,label:"Reply",onClick:()=>u(!0),size:13}),o(_,{icon:c?Ue:Oe,label:c?"Reopen":"Resolve",onClick:t,size:13}),o(_,{icon:ge,label:"Delete comment",onClick:n,danger:!0,size:13})]}),e.path||e.quote?s("button",{type:"button",className:"dd-comment-anchor",onClick:l,disabled:!l,title:a?"This file was deleted":"Show in the document",children:[e.path?s("span",{className:`dd-comment-path${a?" dd-comment-path-gone":""}`,children:[e.path,a?" (deleted)":""]}):null,e.quote?o("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,o("div",{className:"dd-comment-body",children:o(_a,{content:e.body})}),e.replies.length?o("ol",{className:"dd-replies","aria-label":"Replies",children:e.replies.map(h=>s("li",{className:"dd-reply",children:[s("header",{className:"dd-comment-head",children:[o(Le,{actor:h.author}),o(se,{at:h.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(_,{icon:ge,label:"Delete reply",onClick:()=>d(h.id),danger:!0,size:12})]}),o("div",{className:"dd-comment-body",children:o(_a,{content:h.body})})]},h.id))}):null,f?o(os,{onCancel:()=>u(!1),onSend:async h=>{let L=await i(h);return L&&u(!1),L}}):null]})}function On({doc:e,activePath:a,now:r,pendingQuote:t,onClearQuote:n,draft:d,onDraft:i,onFocusComment:l}){let c=U(),[f,u]=de("comments-scope","all"),[h,L]=b(!1),[I,C]=b(!1),[m,k]=b(null),R=M(null);E(()=>{t&&R.current?.focus()},[t]);let A=V(()=>e.comments.filter(S=>f==="all"||!S.path||S.path===a),[e.comments,f,a]),N=A.filter(S=>S.status==="open"),w=A.filter(S=>S.status==="resolved"),q=async(S,O)=>{try{return await S(),!0}catch(X){return F(`${O}: ${H(X)}`,"error"),!1}},y=t?t.path:a,B=async()=>{let S=d.trim();if(!(!S||I)){C(!0);try{await c.addComment(e.id,{body:S,...y?{path:y}:{},...t?{quote:t.text}:{}}),i(""),n()}catch(O){F(`Could not add the comment: ${H(O)}`,"error")}finally{C(!1)}}},x=S=>{En(S)&&(S.preventDefault(),B())},P=V(()=>new Set(e.files.map(S=>S.path)),[e.files]),v=S=>{let O=!!S.path&&!P.has(S.path);return o(rs,{comment:S,fileGone:O,now:r,onToggle:()=>{q(()=>c.setCommentStatus(e.id,S.id,S.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>k({title:"Delete comment",body:S.replies.length?`Delete this comment and its ${S.replies.length===1?"reply":`${S.replies.length} replies`}? This cannot be undone.`:"Delete this comment? This cannot be undone.",confirmLabel:"Delete",danger:!0,run:()=>{q(()=>c.deleteComment(e.id,S.id),"Could not delete the comment")}}),onDeleteReply:X=>{q(()=>c.deleteComment(e.id,X),"Could not delete the reply")},onReply:X=>q(()=>c.replyToComment(e.id,S.id,X),"Could not reply"),onFocus:!O&&(S.quote||S.path)?()=>l(S):void 0},S.id)};return s("div",{className:"dd-rail-pane dd-comments",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[o("button",{type:"button",className:f==="all"?"on":"",onClick:()=>u("all"),children:"All files"}),o("button",{type:"button",className:f==="file"?"on":"",onClick:()=>u("file"),disabled:!a,children:"This file"})]})}),s("div",{className:"dd-rail-scroll",children:[N.length===0?o(Pe,{icon:De,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):N.map(v),w.length?s("div",{className:"dd-resolved",children:[s("button",{type:"button",className:"dd-disclosure",onClick:()=>L(!h),children:[h?o(ce,{size:13,"aria-hidden":!0}):o(ia,{size:13,"aria-hidden":!0}),"Resolved (",w.length,")"]}),h?w.map(v):null]}):null]}),s("div",{className:"dd-composer",children:[t?s("div",{className:"dd-composer-quote",children:[o("span",{className:"dd-comment-quote",children:t.text}),o(_,{icon:re,label:"Remove quote",onClick:n,size:12})]}):null,o("textarea",{ref:R,className:"dd-input dd-composer-input",placeholder:y?`Comment on ${y}\u2026 agents see open comments`:"Leave a comment\u2026",value:d,maxLength:8e3,rows:3,onChange:S=>i(S.target.value),onKeyDown:x}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),o("button",{type:"button",className:"btn primary",disabled:!d.trim()||I,onClick:()=>{B()},children:"Comment"})]})]}),m?o(Fe,{request:m,onClose:()=>k(null)}):null]})}var ns=(()=>{let e=new Uint32Array(256);for(let a=0;a<256;a+=1){let r=a;for(let t=0;t<8;t+=1)r=r&1?3988292384^r>>>1:r>>>1;e[a]=r>>>0}return e})();function ds(e){let a=4294967295;for(let r of e)a=ns[(a^r)&255]^a>>>8;return(a^4294967295)>>>0}function ss(e){let a=Math.max(e.getFullYear(),1980);return{time:e.getHours()<<11|e.getMinutes()<<5|Math.floor(e.getSeconds()/2),date:a-1980<<9|e.getMonth()+1<<5|e.getDate()}}var qn=2048,Qt=20;function Hn(e,a=new Date){let r=new TextEncoder,{time:t,date:n}=ss(a),d=[],i=[],l=0;for(let I of e){let C=r.encode(I.path),m=ds(I.data),k=I.data.length,R=new Uint8Array(30+C.length),A=new DataView(R.buffer);A.setUint32(0,67324752,!0),A.setUint16(4,Qt,!0),A.setUint16(6,qn,!0),A.setUint16(8,0,!0),A.setUint16(10,t,!0),A.setUint16(12,n,!0),A.setUint32(14,m,!0),A.setUint32(18,k,!0),A.setUint32(22,k,!0),A.setUint16(26,C.length,!0),A.setUint16(28,0,!0),R.set(C,30),d.push(R,I.data);let N=new Uint8Array(46+C.length),w=new DataView(N.buffer);w.setUint32(0,33639248,!0),w.setUint16(4,Qt,!0),w.setUint16(6,Qt,!0),w.setUint16(8,qn,!0),w.setUint16(10,0,!0),w.setUint16(12,t,!0),w.setUint16(14,n,!0),w.setUint32(16,m,!0),w.setUint32(20,k,!0),w.setUint32(24,k,!0),w.setUint16(28,C.length,!0),w.setUint32(42,l,!0),N.set(C,46),i.push(N),l+=R.length+k}let c=i.reduce((I,C)=>I+C.length,0),f=new Uint8Array(22),u=new DataView(f.buffer);u.setUint32(0,101010256,!0),u.setUint16(8,e.length,!0),u.setUint16(10,e.length,!0),u.setUint32(12,c,!0),u.setUint32(16,l,!0);let h=new Uint8Array(l+c+f.length),L=0;for(let I of[...d,...i,f])h.set(I,L),L+=I.length;return h}function ls(e){if(e.encoding==="utf8")return new TextEncoder().encode(e.content);let a=atob(e.content),r=new Uint8Array(a.length);for(let t=0;t<a.length;t+=1)r[t]=a.charCodeAt(t);return r}function _n(e,a,r){return Hn(a.map(t=>({path:`${e}/${t.path}`,data:ls(t)})),r)}var is=3e4;function Un(e,a,r){let t=URL.createObjectURL(new Blob([a],{type:r})),n=document.createElement("a");n.href=t,n.download=e,n.style.display="none",document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(t),is)}function us({doc:e,projects:a,onClose:r,onMove:t}){let[n,d]=b(e.projectId??"");return s(ha,{title:"Move design doc",onClose:r,footer:s(j,{children:[o("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.projectId??""),onClick:()=>{t(n||null).then(r)},children:"Move"})]}),children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:n,onChange:i=>d(i.target.value),children:[o("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(i=>o("option",{value:i.id,children:i.name},i.id))]})]}),o("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}async function zn(e,a){try{await navigator.clipboard.writeText(e),F(`Copied ${a}`)}catch{F(`Could not copy ${a}`,"error")}}function Ot(e){let a=U(),[r,t]=b(null),[n,d]=b(null),i=async(u,h)=>{try{await a.update(u.id,h)}catch(L){F(`Could not update the doc: ${H(L)}`,"error")}},l=async u=>{try{let h=await a.siteFiles(u.id);Un(`${h.slug}.zip`,_n(h.slug,h.files),"application/zip")}catch(h){F(`Could not download the doc: ${H(h)}`,"error")}};return{items:(u,h,L,I)=>{let C=u.status==="archived",m=k=>()=>{h(),k()};return s(j,{children:[I?o(fe,{icon:_e,label:"Open",onSelect:m(I)}):null,o(fe,{icon:Xa,label:"Copy chat reference",hint:"Paste into any thread",onSelect:m(()=>{zn(en(u.id),"reference")})}),o(fe,{icon:ca,label:"Copy id",hint:u.slug,onSelect:m(()=>{zn(u.id,"id")})}),o(fe,{icon:Za,label:"Download .zip",hint:`${u.slug}.zip`,onSelect:m(()=>{l(u)})}),o(fe,{icon:at,label:"Move to project\u2026",onSelect:m(()=>t(u))}),o(fe,{icon:C?za:Ga,label:C?"Unarchive":"Archive",onSelect:m(()=>{i(u,{status:C?"draft":"archived"})})}),o(fe,{icon:ge,label:"Delete\u2026",danger:!0,onSelect:m(()=>d({title:"Delete design doc",body:s(j,{children:["Delete ",o("strong",{children:u.title})," with its ",u.fileCount," file",u.fileCount===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await a.remove(u.id),F(`Deleted \u201C${u.title}\u201D`),L()}catch(k){F(`Could not delete: ${H(k)}`,"error")}}}))})]})},dialogs:s(j,{children:[r?o(us,{doc:r,projects:e,onClose:()=>t(null),onMove:u=>i(r,{projectId:u})}):null,n?o(Fe,{request:n,onClose:()=>d(null)}):null]})}}function jn({value:e,placeholder:a,maxLength:r,multiline:t=!1,className:n="",label:d,onSave:i}){let[l,c]=b(!1),[f,u]=b(e),h=M(!1);E(()=>{l||u(e)},[e,l]);let L=async C=>{if(h.current)return;h.current=!0,c(!1);let m=f.trim();if(C&&m!==e.trim())try{await i(m)}catch{u(e)}else u(e)},I=C=>{C.key==="Escape"?(C.preventDefault(),L(!1)):C.key==="Enter"&&(!t||C.metaKey||C.ctrlKey||!C.shiftKey)&&(C.preventDefault(),L(!0))};if(l){let C={className:`dd-editable-input ${n}`,value:f,maxLength:r,"aria-label":d,autoFocus:!0,onChange:m=>u(m.target.value),onKeyDown:I,onBlur:()=>{L(!0)}};return t?o("textarea",{...C,rows:2,placeholder:a}):o("input",{...C,placeholder:a})}return o("button",{type:"button",className:`dd-editable ${n}${e?"":" dd-editable-empty"}`,title:`Edit ${d.toLowerCase()}`,onClick:()=>{h.current=!1,c(!0)},children:e||a})}function fs({tags:e,onChange:a}){let[r,t]=b(!1),[n,d]=b(""),i=()=>{let l=n.split(",").map(f=>f.trim().toLowerCase().slice(0,32)).filter(Boolean);d(""),t(!1);let c=[...new Set([...e,...l])].slice(0,12);c.length!==e.length&&a(c)};return s("span",{className:"dd-tags",children:[e.map(l=>s("span",{className:"dd-tag",children:[o(ca,{size:10,"aria-hidden":!0}),l,o("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${l}`,onClick:()=>a(e.filter(c=>c!==l)),children:o(re,{size:10,"aria-hidden":!0})})]},l)),r?o("input",{className:"dd-input dd-tag-input",value:n,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:l=>d(l.target.value),onBlur:i,onKeyDown:l=>{l.key==="Enter"?(l.preventDefault(),i()):l.key==="Escape"&&(d(""),t(!1))}}):e.length<12?s("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>t(!0),children:[o(xe,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function ps({status:e,onChange:a}){let[r,t]=b(!1);return o(ve,{open:r,onClose:()=>t(!1),align:"start",className:"dd-menu",anchor:o("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>t(!r),title:"Change status",children:o(ea,{status:e})}),children:Mt.map(n=>o(fe,{label:o(ea,{status:n}),checked:n===e,icon:n===e?Oe:void 0,onSelect:()=>{t(!1),n!==e&&a(n)}},n))})}function $n({doc:e,projects:a,compact:r,collapsible:t=!1,actions:n,onDeleted:d}){let i=U(),[l,c]=b(!1),[f,u]=b(!1),h=Ot(a),L=e.projectId?a.find(m=>m.id===e.projectId):null,I=async m=>{try{await i.update(e.id,m)}catch(k){throw F(`Could not update the doc: ${H(k)}`,"error"),k}},C=r||t&&!f;return s("header",{className:`dd-doc-header${r||t?" dd-doc-header-compact":""}`,children:[s("div",{className:"dd-doc-title-row",children:[o(jn,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:m=>m?I({title:m}):void 0}),o("span",{className:"dd-spacer"}),n,o(ve,{open:l,onClose:()=>c(!1),className:"dd-menu",anchor:o(_,{icon:ke,label:"More actions",active:l,onClick:()=>c(!l)}),children:h.items(e,()=>c(!1),d)})]}),C?null:o(jn,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:m=>I({summary:m})}),s("div",{className:"dd-doc-meta",children:[o(ps,{status:e.status,onChange:m=>{I({status:m}).catch(()=>{})}}),s("span",{className:"dd-doc-project",title:L?`Project \xB7 ${L.name}`:"Visible to agents in every project",children:[L?null:o(ot,{size:12,"aria-hidden":!0}),L?L.name:e.projectId?"Unknown project":"Global"]}),C?null:o(fs,{tags:e.tags,onChange:m=>{I({tags:m}).catch(()=>{})}}),o("span",{className:"dd-spacer"}),s("span",{className:"dd-doc-updated",children:[o(Le,{actor:e.updatedBy})," ",o(se,{at:e.updatedAt,now:Date.now()})]}),t?o(_,{icon:f?Va:ce,label:f?"Hide summary and tags":"Show summary and tags",active:f,onClick:()=>u(!f)}):null]}),h.dialogs]})}function Vn({docId:e,file:a,removed:r=!1,split:t,renderPreview:n,onStateChange:d,onSaved:i}){let l=U(),[c,f]=b(a.content),[u,h]=b({content:a.content,revision:a.revision}),[L,I]=b(!1),[C,m]=b(null),k=c!==u.content,R=Ao(c),A=M({dirty:k,draft:c,saved:u});A.current={dirty:k,draft:c,saved:u},E(()=>{let{dirty:y,draft:B,saved:x}=A.current;a.revision!==x.revision&&(!y||a.content===B?(f(a.content),h({content:a.content,revision:a.revision}),m(null)):m({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),E(()=>{d?.({dirty:k,saving:L})},[k,L,d]);let N=we(async y=>{if(!L){I(!0);try{let B=y??(r?0:u.revision),x=await l.writeFile(e,{path:a.path,content:c,baseRevision:B});h({content:c,revision:x.revision}),m(null),i?.(x)}catch(B){if(Zr(B)){let x=await l.readFile(e,a.path).catch(()=>null);m({revision:x?.revision??u.revision+1,by:x?.updatedBy??a.updatedBy})}else F(`Could not save ${a.path}: ${H(B)}`,"error")}finally{I(!1)}}},[l,e,c,a.path,a.updatedBy,i,r,u.revision,L]),w=async()=>{try{let y=await l.readFile(e,a.path);f(y.content),h({content:y.content,revision:y.revision}),m(null)}catch(y){F(`Could not reload ${a.path}: ${H(y)}`,"error")}},q=y=>{if((y.metaKey||y.ctrlKey)&&y.key.toLowerCase()==="s"){y.preventDefault(),k&&!C&&N();return}if(y.key==="Tab"&&!y.metaKey&&!y.ctrlKey&&!y.altKey){y.preventDefault();let B=y.currentTarget,{selectionStart:x,selectionEnd:P,value:v}=B,S=`${v.slice(0,x)}  ${v.slice(P)}`;f(S),requestAnimationFrame(()=>{B.selectionStart=B.selectionEnd=x+2})}};return s("div",{className:"dd-editor",children:[r&&k&&!C?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(be,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[a.path," was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them."]})]}):null,C?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(ye,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o(Le,{actor:C.by})," saved revision ",C.revision," while you were editing."]}),s("button",{type:"button",className:"btn",onClick:()=>{w()},children:[o(Ue,{size:12,"aria-hidden":!0})," Discard mine"]}),o("button",{type:"button",className:"btn",onClick:()=>{N(C.revision)},children:"Overwrite with mine"})]}):null,s("div",{className:`dd-editor-body${t?" dd-editor-split":""}`,children:[o("textarea",{className:"dd-editor-input",value:c,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:y=>f(y.target.value),onKeyDown:q,autoFocus:!0}),t?o("div",{className:"dd-editor-preview",children:n(R)}):null]}),s("div",{className:"dd-editor-footer",children:[s("span",{className:"dd-editor-state",children:[L?o(W,{size:12,label:"Saving"}):null,L?"Saving\u2026":k?"Unsaved changes":`Saved \xB7 rev ${u.revision}`]}),o("span",{className:"dd-editor-hint",children:"\u2318S to save"}),o("button",{type:"button",className:"btn",disabled:!k||L,onClick:()=>f(u.content),children:"Revert"}),s("button",{type:"button",className:"btn primary",disabled:!k||L||!!C,onClick:()=>{N()},children:[o(ut,{size:12,"aria-hidden":!0})," Save"]})]})]})}var qt="dd-comment",Ht="dd-comment-focus";function ms(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}var gs=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE"]);function hs(e){let a=e.ownerDocument.createTreeWalker(e,4,{acceptNode:c=>gs.has(c.parentElement?.tagName.toUpperCase()??"")?2:1}),r=[],t=[],n="";for(let c=a.nextNode();c;c=a.nextNode())t.push(n.length),r.push(c),n+=c.data;let d="",i=[],l=!0;for(let c=0;c<n.length;c+=1){let f=n[c];/\s/.test(f)?(l||(d+=" ",i.push(c)),l=!0):(d+=f,i.push(c),l=!1)}return{nodes:r,starts:t,normalized:d,map:i}}function Wn(e,a){let r=0,t=e.starts.length-1;for(;r<t;){let n=r+t+1>>1;e.starts[n]<=a?r=n:t=n-1}return[e.nodes[r],a-e.starts[r]]}function ao(e,a){let r=new Map;if(!a.length)return r;let t=hs(e);if(!t.nodes.length)return r;for(let n of a){if(r.has(n))continue;let d="",i=-1;for(let L of new Set([n.replace(/\s+/g," ").trim(),ms(n)]))if(!(L.length<2)&&(i=t.normalized.indexOf(L),i>=0)){d=L;break}if(i<0)continue;let[l,c]=Wn(t,t.map[i]),[f,u]=Wn(t,t.map[i+d.length-1]),h=e.ownerDocument.createRange();h.setStart(l,c),h.setEnd(f,u+1),r.set(n,h)}return r}function xs(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var Xn=new Map;function La(e,a,r){let t=xs();if(!t)return;let n=Xn.get(e)??new Map;Xn.set(e,n),r.length?n.set(a,r):n.delete(a);let d=[...n.values()].flat();d.length?t.registry.set(e,new t.Highlight(...d)):t.registry.delete(e)}var Zn="dd-page";var Ls="dd-page-hello",Jn=50,Is=256*1024,oo=1e3,to=4e3,Cs=500,bs=500,Ss=new Set(["error","missing","blocked"]);function St(e){return e&&typeof e=="object"&&!Array.isArray(e)?e:null}function Da(e,a){return typeof e=="string"&&e.length<=a?e:null}function ro(e,a){return typeof e=="string"?e.slice(0,a):null}function _t(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function Kn(e){return!Array.isArray(e)||e.length>bs?null:e.every(a=>typeof a=="string"&&a.length<=500)?e:null}function ys(e){if(e===null)return null;let a=St(e);if(!a)return;let[r,t,n,d]=[a.top,a.left,a.bottom,a.right].map(_t);return r===null||t===null||n===null||d===null?void 0:{top:r,left:t,bottom:n,right:d}}function Ps(e){let a=St(e);if(!a)return null;let r=0;for(let[t,n]of Object.entries(a))if(typeof n!="string"||(r+=t.length+n.length,r>Is))return null;return{...a}}function vs(e){let a=St(e),r=a?.kind,t=ro(a?.message,Cs);if(!a||!Ss.has(r)||!t)return null;let n=ro(a.source,oo),d=_t(a.line);return{kind:r,message:t,...n?{source:n}:{},...d!==null&&d>0?{line:Math.floor(d)}:{}}}function Qn(e){let a=St(e);if(!a)return null;switch(a.type){case"ready":return{type:"ready"};case"fetch":{let r=Da(a.path,oo);return Number.isSafeInteger(a.id)&&a.id>=0&&r!==null?{type:"fetch",id:a.id,path:r}:null}case"navigate":{let r=Da(a.path,oo),t=a.hash===null?null:Da(a.hash,to);return r===null||t===null&&a.hash!==null||typeof a.newTab!="boolean"?null:{type:"navigate",path:r,hash:t,newTab:a.newTab,redirect:a.redirect===!0}}case"open":{let r=Da(a.url,to);return r===null?null:{type:"open",url:r}}case"problem":{let r=vs(a.problem);return r?{type:"problem",problem:r}:null}case"selection":{let r=ro(a.text,500),t=ys(a.rect);return r===null||t===void 0?null:{type:"selection",text:r,rect:t}}case"anchors":{let r=Kn(a.found),t=Kn(a.missing);return r&&t?{type:"anchors",found:r,missing:t}:null}case"focused":{let r=Da(a.quote,500);return r===null||typeof a.found!="boolean"?null:{type:"focused",quote:r,found:a.found}}case"scroll":{let r=_t(a.x),t=_t(a.y);return r===null||t===null?null:{type:"scroll",x:r,y:t}}case"hash":{let r=a.hash===null?null:Da(a.hash,to);return r===null&&a.hash!==null?null:{type:"hash",hash:r}}case"storage":{let r=Ps(a.entries);return r?{type:"storage",entries:r}:null}default:return null}}function Yn(e){return St(e)?.dd===Ls}var Um=12*1024*1024,no=960*1024;function ed(e,a,r){let t=new Map(a.map(n=>[n.path,n.revision]));return!r&&e.revision!==(t.get(e.path)??null)||e.deps.some(n=>(t.get(n.path)??0)!==n.revision)?!0:e.missing.some(n=>t.has(n))}function so(e,a){let r=[...e],t=new Set(e.map(n=>n.path));for(let[n,d]of a){if(r.length>=500)break;t.has(n)||r.push({path:n,revision:d})}return r}function ad(e){return JSON.stringify(e).replace(/</g,"\\u003c")}var ws=new URL("./page-runtime.js",import.meta.url).href,td=[{id:"full",label:"Full width",icon:dt,width:null},{id:"tablet",label:"Tablet (768px)",icon:mt,width:768},{id:"phone",label:"Phone (390px)",icon:ft,width:390}],ks=400,As=1500,Ds=6,Ts=200,Ms=20,Rs=50,Fs={error:"Error",missing:"Missing",blocked:"Blocked"},Ta=new Map;function Bs(e,a){for(Ta.delete(e),Ta.set(e,a);Ta.size>Ms;)Ta.delete(Ta.keys().next().value)}var Ia=new Map,lo=(e,a)=>`${e}\0${a}`;function Ns(e,a,r){let t=lo(e,a);for(Ia.delete(t),Ia.set(t,r);Ia.size>Rs;)Ia.delete(Ia.keys().next().value)}function Es(e,a,r,t){let n=`<script type="application/json" id="${Zn}">${ad(a)}<\/script><script src="${hn(r)}"><\/script>`,d=Et(e.html,n);return e.styled?d:kn(d,t)}function Os(e,a){let r=0,t=[],n=()=>{for(;r<e&&t.length;){let d=t.shift();r+=1,Promise.resolve().then(d).catch(()=>{}).finally(()=>{r-=1,n()})}};return{add(d){return r+t.length>=a?!1:(t.push(d),n(),!0)},clear(){t.length=0}}}function qs(e){return e.length*6<no?!1:new TextEncoder().encode(JSON.stringify(e)).byteLength>no}function Hs(e,a){return e.kind===a.kind&&e.message===a.message&&e.source===a.source&&e.line===a.line}function od({docId:e,file:a,files:r,draft:t=!1,quotes:n=[],onOpenPath:d,onQuote:i,onAskAbout:l,handleRef:c}){let f=U(),u=a.path,[h,L]=b("full"),[I,C]=b(null),[m,k]=b(!0),[R,A]=b(null),[N,w]=b(!1),[q,y]=b([]),[B,x]=b(!1),[P,v]=b(null),[S,O]=b(null),[X,te]=b(0),pe=M(null),me=M(null),ee=M(null),J=M(!1),ne=M(null),Ie=M([]),le=M(new Map),ie=M(null),Be=M(""),D=M({hash:Ia.get(lo(e,u))??null,scroll:null}),z=M(n);z.current=n;let $=V(()=>Os(Ds,Ts),[]);E(()=>{Ia.delete(lo(e,u))},[e,u]);let oe=t?a.content:null,[he,Fa]=b(oe);E(()=>{if(oe===he)return;if(oe===null){Fa(null);return}let p=setTimeout(()=>Fa(oe),ks);return()=>clearTimeout(p)},[oe,he]);let wt=r.find(p=>p.path===u)?.revision??null,Ge=he===null?wt:null,je=M(0);E(()=>{let p=++je.current;if(he!==null&&qs(he)){w(!0),k(!1);return}w(!1),k(!0),f.renderPage(e,{path:u,draft:he??void 0}).then(T=>{if(p!==je.current)return;let K={mode:"frame",docId:e,path:u,hash:D.current.hash,scroll:D.current.scroll,quotes:[...z.current],storage:Ta.get(e)};C({id:p,page:T,srcDoc:Es(T,K,ws,T.styled?{}:wn()),draft:he!==null}),A(null),k(!1)},T=>{p===je.current&&(A(H(T)),k(!1))})},[f,e,u,he,Ge,X]);let Q=M("");E(()=>{if(!I||m)return;let p={...I.page,deps:so(I.page.deps,le.current)};if(!ed(p,r,he!==null))return;let T=r.map(K=>`${K.path}@${K.revision}`).join("|");Q.current!==T&&(Q.current=T,te(K=>K+1))},[I,r,m,he]);let Ne=(p,T=ee.current)=>{try{T?.postMessage(p)}catch{}},Ba=p=>{y(T=>T.length>=Jn||T.some(K=>Hs(K,p))?T:[...T,p]),oa()},Gt=M(q);Gt.current=q;let Y=M(I);Y.current=I;let oa=()=>{ie.current&&clearTimeout(ie.current),ie.current=setTimeout(()=>{ie.current=null;let p=Y.current,T=p?.page;if(!T||p.draft||T.revision===null||!J.current)return;let K={path:T.path,revision:T.revision,deps:so(T.deps,le.current),missing:T.missing,problems:Gt.current,unanchored:Ie.current},Z=JSON.stringify(K);Z!==Be.current&&(Be.current=Z,f.reportRender(e,K).catch(()=>{Be.current=""}))},As)},ra=(p,T)=>{p!==u&&(T!==null&&Ns(e,p,T),d?.(p))},jt=(p,T,K)=>{let Z=new Set(r.map(sa=>sa.path)),Ee=Z.has(p)?p:Z.has(`${p}/index.html`)?`${p}/index.html`:null;if(!Ee){F(`${p} is not a file in this design doc`,"error");return}K?v(Ee===u?null:{path:Ee,hash:T}):ra(Ee,T)},Na=p=>{let T;try{T=new URL(p)}catch{return}if(T.protocol!=="https:"&&T.protocol!=="http:"){F(`Zana opens web links only, not ${T.protocol} links`,"error");return}let K=globalThis.navigator?.userActivation;if(K&&!K.isActive){Ba({kind:"blocked",message:`The page tried to open ${T.href} without a click`});return}globalThis.open(T.href,"_blank","noopener,noreferrer")},na=(p,T)=>{let K=pe.current,Z=me.current;if(!i||!p||!T||!K||!Z){O(null);return}let Ee=K.getBoundingClientRect(),sa=Z.getBoundingClientRect(),wd=Ee.top-sa.top+Z.scrollTop+T.top-36,kd=Ee.left-sa.left+Z.scrollLeft+(T.left+T.right)/2;O({text:p,top:Math.max(4,wd),left:Math.min(Math.max(80,kd),Math.max(80,Z.scrollWidth-80))})},Ca=(p,T)=>{switch(p.type){case"ready":J.current=!0,Ne({type:"highlight",quotes:[...z.current]},T),ne.current!==null&&Ne({type:"focus",quote:ne.current},T),ne.current=null,oa();break;case"fetch":{!le.current.has(p.path)&&le.current.size<500&&(le.current.set(p.path,r.find(Z=>Z.path===p.path)?.revision??0),oa()),$.add(async()=>{let Z=null;try{Z=await f.readPageFile(e,p.path)}catch{Z=null}ee.current===T&&Ne({type:"file",id:p.id,file:Z},T)})||Ne({type:"file",id:p.id,file:null},T);break}case"navigate":jt(p.path,p.hash,p.redirect);break;case"open":Na(p.url);break;case"problem":Ba(p.problem);break;case"selection":na(p.text,p.rect);break;case"anchors":Ie.current=p.missing,oa();break;case"focused":p.found||F("That passage is no longer on this page");break;case"scroll":D.current.scroll={x:p.x,y:p.y};break;case"hash":D.current.hash=p.hash;break;case"storage":Bs(e,p.entries);break;default:break}},Ea=M(Ca);Ea.current=Ca,E(()=>{let p=T=>{let K=pe.current,Z=T.ports?.[0];!K||!Z||T.source!==K.contentWindow||!Yn(T.data)||(ee.current?.close(),ee.current=Z,J.current=!1,Ie.current=[],le.current=new Map,$.clear(),y([]),v(null),O(null),Z.onmessage=Ee=>{if(ee.current!==Z)return;let sa=Qn(Ee.data);sa&&Ea.current(sa,Z)})};return globalThis.addEventListener("message",p),()=>{globalThis.removeEventListener("message",p),ee.current?.close(),ee.current=null,$.clear(),ie.current&&clearTimeout(ie.current)}},[$]);let Oa=n.join("\0");E(()=>{J.current&&Ne({type:"highlight",quotes:Oa?Oa.split("\0"):[]})},[Oa]),E(()=>{if(!c)return;let p={focusQuote(T){return J.current&&ee.current?Ne({type:"focus",quote:T}):ne.current=T,!0}};return c.current=p,()=>{c.current===p&&(c.current=null)}},[c]);let da=[...V(()=>I?[...I.page.missing.map(p=>({kind:"missing",message:`The page uses ${p}, which is not a file in this doc`})),...I.page.warnings.map(p=>({kind:"blocked",message:p}))]:[],[I]),...q],kt=async()=>{try{let{url:p}=await f.pageLink(e,u);globalThis.open(p,"_blank","noopener,noreferrer")}catch(p){F(H(p),"error")}},qa=p=>{!S||!p||(p(S.text),O(null),Ne({type:"clear-selection"}))},Ha=td.find(p=>p.id===h).width;return s("div",{className:"dd-html-stage",onMouseDown:p=>{p.target.closest?.(".dd-selection-chip")||O(null)},children:[s("div",{className:"dd-html-toolbar",children:[s("div",{className:"dd-html-status",children:[m?o(W,{size:12,label:"Rendering page"}):null,t?o("span",{className:"dd-muted",children:"Unsaved changes"}):null]}),o("div",{className:"dd-html-widths",role:"toolbar","aria-label":"Preview width",children:td.map(p=>o("button",{type:"button",className:`icon-btn${h===p.id?" on":""}`,title:p.label,"aria-label":p.label,"aria-pressed":h===p.id,onClick:()=>L(p.id),children:o(p.icon,{size:14,"aria-hidden":!0})},p.id))}),s("div",{className:"dd-html-actions",children:[da.length?o(ve,{open:B,onClose:()=>x(!1),className:"dd-page-problems",anchor:s("button",{type:"button",className:"dd-page-badge","aria-label":`${da.length} page ${da.length===1?"problem":"problems"}`,"aria-expanded":B,onClick:()=>x(p=>!p),children:[o(ye,{size:13,"aria-hidden":!0}),da.length]}),children:o("ul",{"aria-label":"Page problems",children:da.map((p,T)=>s("li",{className:`dd-page-problem dd-page-problem-${p.kind}`,children:[o("span",{className:"dd-page-problem-kind",children:Fs[p.kind]}),o("span",{className:"dd-page-problem-message",children:p.message}),p.source?s("span",{className:"dd-muted dd-page-problem-source",children:[p.source,p.line?`:${p.line}`:""]}):null]},T))})}):null,t?null:o(_,{icon:He,label:"Open in browser",onClick:()=>{kt()}})]})]}),P?s("div",{className:"dd-banner dd-banner-info",children:[o(Ka,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:["This page redirects to ",o("code",{children:P.path}),"."]}),o("button",{type:"button",className:"btn",onClick:()=>{v(null),ra(P.path,P.hash)},children:"Go there"}),o(_,{icon:re,label:"Dismiss",onClick:()=>v(null)})]}):null,N?s("div",{className:"dd-banner dd-banner-warn",children:[o(ye,{size:14,"aria-hidden":!0}),o("span",{className:"dd-banner-text",children:"This draft is too large to preview. Save it to see the page."})]}):null,R?o("div",{className:"dd-banner dd-banner-error",children:R}):null,s("div",{className:"dd-html-viewport",ref:me,children:[I?o("iframe",{ref:pe,className:`dd-html-frame${Ha?" dd-html-frame-device":""}`,style:Ha?{width:Ha}:void 0,sandbox:"allow-scripts allow-forms",srcDoc:I.srcDoc,title:u},I.id):R||N?null:o("div",{className:"dd-center",children:o(W,{label:"Rendering page"})}),S?s("div",{className:"dd-selection-chip",style:{top:S.top,left:S.left},children:[s("button",{type:"button",onClick:()=>qa(i),children:[o(fa,{size:13,"aria-hidden":!0}),"Comment"]}),l?s("button",{type:"button",onClick:()=>qa(l),children:[o(ae,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})]})}var _s=24,Us=64,Ma=new Map;function zs(e,a){for(Ma.delete(e),Ma.set(e,a);Ma.size>Us;)Ma.delete(Ma.keys().next().value)}function Gs(e,a,r){let t=U(),n=V(()=>{let f=new Map(a.map(u=>[u.path,u]));return r.map(u=>f.get(u)).filter(u=>!!u&&(u.kind==="image"||u.kind==="svg")).slice(0,_s)},[a,r]),d=n.map(f=>`${f.path}@${f.revision}`).join("|"),i=M(n);i.current=n;let[l,c]=b(new Map);return E(()=>{let f=i.current,u=!1,h=new Map,L=[];for(let I of f){let C=Ma.get(`${e}\0${I.path}\0${I.revision}`);C?h.set(I.path,C):L.push(I)}if(c(h),!!L.length)return Promise.all(L.map(async I=>{try{let C=await t.readFile(e,I.path),m=Kt(C);m&&(zs(`${e}\0${C.path}\0${C.revision}`,m),h.set(C.path,m))}catch{}})).then(()=>{u||c(new Map(h))}),()=>{u=!0}},[t,e,d]),l}function Pt({docId:e,file:a,files:r,quotes:t=[],onOpenPath:n,onQuote:d,onAskAbout:i,handleRef:l,draft:c=!1}){let f=M(null),u=M(null),h=M({}),[L,I]=b(null),C=V(()=>a.kind==="markdown"?yn(a.path,a.content):[],[a.path,a.content,a.kind]),m=Gs(e,r,C),k=V(()=>new Set(r.map(x=>x.path)),[r]),R=V(()=>a.kind==="markdown"?Pn(a.path,a.content,m):a.kind==="mermaid"?Zt(a.content,"mermaid"):a.kind==="code"?vn(a.path,a.content):null,[a.kind,a.path,a.content,m]),A=t.join("\0");E(()=>{let x=u.current,P=h.current,v=A?A.split("\0"):[];if(!x||!v.length){La(qt,P,[]);return}let S=()=>La(qt,P,[...ao(x,v).values()]),O=setTimeout(S,60),X=typeof MutationObserver=="function"?new MutationObserver(()=>S()):null;return X?.observe(x,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(O),X?.disconnect(),La(qt,P,[]),La(Ht,P,[])}},[A,R,a.kind,a.content]);let N=a.kind!=="html";E(()=>{if(!(!l||!N))return l.current={focusQuote(x){let P=u.current,v=P?ao(P,[x]).get(x):void 0;return v?(v.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),La(Ht,h.current,[v]),setTimeout(()=>La(Ht,h.current,[]),1800),!0):!1}},()=>{l.current=null}},[l,N]);let w=x=>{let P=x.target?.closest?.("a");if(!P)return;let v=P.getAttribute("href")??"";if(v.startsWith("#")){x.preventDefault(),x.stopPropagation();return}let S=Ct(a.path,v);if(!S)return;x.preventDefault(),x.stopPropagation();let O=[...k].find(X=>X.startsWith(`${S}/`));k.has(S)?n?.(S):O?n?.(O):F(`${S} is not a file in this design doc`,"error")},q=()=>{if(!d)return;let x=globalThis.getSelection?.(),P=f.current,v=x?.toString().trim()??"";if(!x||x.isCollapsed||!v||!P||!u.current?.contains(x.anchorNode)){I(null);return}let S=x.getRangeAt(0).getBoundingClientRect(),O=P.getBoundingClientRect();I({text:v.slice(0,500),top:Math.max(4,S.top-O.top+P.scrollTop-36),left:Math.min(Math.max(80,S.left-O.left+S.width/2),Math.max(80,O.width-80))})},y=x=>{!L||!x||(x(L.text),I(null),globalThis.getSelection?.()?.removeAllRanges())},B;if(a.kind==="html")B=o(od,{docId:e,file:a,files:r,draft:c,quotes:t,onOpenPath:n,onQuote:d,onAskAbout:i,handleRef:l},`${e}\0${a.path}`);else if(a.kind==="image"||a.kind==="svg"){let x=Kt(a);B=o("div",{className:"dd-image-stage",children:x?o("img",{src:x,alt:a.path}):o("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else a.kind==="font"?B=o("div",{className:"dd-image-stage",children:o("span",{className:"dd-muted",children:"Font file. Pages in this doc load it through @font-face."})}):R!==null?B=o("div",{className:`dd-prose dd-prose-${a.kind}`,ref:u,onClickCapture:w,children:a.kind==="markdown"&&!a.content.trim()?o("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):o(_a,{content:R})}):B=o("div",{className:"dd-prose",ref:u,children:o("pre",{className:"dd-plain",children:a.content})});return s("div",{className:`dd-preview dd-preview-${a.kind}`,ref:f,onMouseUp:q,onMouseDown:x=>{x.target.closest?.(".dd-selection-chip")||I(null)},children:[B,L?s("div",{className:"dd-selection-chip",style:{top:L.top,left:L.left},children:[s("button",{type:"button",onClick:()=>y(d),children:[o(fa,{size:13,"aria-hidden":!0}),"Comment"]}),i?s("button",{type:"button",onClick:()=>y(i),children:[o(ae,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function rd(e,a,r=1500){let t=e.split(`
`),n=a.split(`
`),d=0;for(;d<t.length&&d<n.length&&t[d]===n[d];)d+=1;let i=t.length,l=n.length;for(;i>d&&l>d&&t[i-1]===n[l-1];)i-=1,l-=1;let c=t.slice(d,i),f=n.slice(d,l);if(c.length>r||f.length>r)return null;let u=f.length+1,h=new Uint32Array((c.length+1)*u);for(let m=c.length-1;m>=0;m-=1)for(let k=f.length-1;k>=0;k-=1)h[m*u+k]=c[m]===f[k]?h[(m+1)*u+k+1]+1:Math.max(h[(m+1)*u+k],h[m*u+k+1]);let L=[],I=0,C=0;for(;I<c.length&&C<f.length;)c[I]===f[C]?(L.push({type:"same",text:c[I]}),I+=1,C+=1):h[(I+1)*u+C]>=h[I*u+C+1]?(L.push({type:"del",text:c[I]}),I+=1):(L.push({type:"add",text:f[C]}),C+=1);for(;I<c.length;)L.push({type:"del",text:c[I++]});for(;C<f.length;)L.push({type:"add",text:f[C++]});return[...t.slice(0,d).map(m=>({type:"same",text:m})),...L,...t.slice(i).map(m=>({type:"same",text:m}))]}function nd(e,a=3){let r=new Uint8Array(e.length);e.forEach((d,i)=>{if(d.type!=="same")for(let l=Math.max(0,i-a);l<=Math.min(e.length-1,i+a);l+=1)r[l]=1});let t=[],n=0;for(;n<e.length;)if(r[n]){let d=[];for(;n<e.length&&r[n];)d.push(e[n++]);t.push({type:"lines",lines:d})}else{let d=0;for(;n<e.length&&!r[n];)d+=1,n+=1;t.push({type:"gap",count:d})}return t}function dd(e){let a=0,r=0;for(let t of e)t.type==="add"?a+=1:t.type==="del"&&(r+=1);return{added:a,removed:r}}var js={create:Ae,write:Xe,delete:Ke,rename:st},sd={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function ld({doc:e,activePath:a,now:r,selectedId:t,onSelect:n}){let d=U(),[i,l]=de("history-scope","file"),c=i==="file"?a:null,f=Ye(`${e.id}\0${c??"*"}\0${e.revision}`,()=>d.history(e.id,{...c?{path:c}:{},limit:100}));return s("div",{className:"dd-rail-pane dd-history",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[o("button",{type:"button",className:i==="file"?"on":"",onClick:()=>l("file"),disabled:!a,children:"This file"}),o("button",{type:"button",className:i==="all"?"on":"",onClick:()=>l("all"),children:"All files"})]})}),s("div",{className:"dd-rail-scroll",children:[f.error?o("div",{className:"dd-banner dd-banner-error",children:f.error}):null,!f.data&&f.loading?o("div",{className:"dd-center",children:o(W,{label:"Loading history"})}):null,f.data&&!f.data.length?o(Pe,{icon:Se,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,o("ol",{className:"dd-history-list",children:f.data?.map(u=>{let h=js[u.op];return o("li",{children:s("button",{type:"button",className:`dd-history-row${t===u.id?" on":""}`,onClick:()=>n(u),children:[o(h,{size:13,className:`dd-op dd-op-${u.op}`,"aria-hidden":!0}),s("span",{className:"dd-history-main",children:[s("span",{className:"dd-history-title",children:[sd[u.op],c?null:o("span",{className:"dd-history-path",children:u.path}),s("span",{className:"dd-history-rev",children:["rev ",u.revision]})]}),u.note?o("span",{className:"dd-history-note",children:u.note}):null,s("span",{className:"dd-history-meta",children:[o(Le,{actor:u.actor}),o(se,{at:u.createdAt,now:r})]})]})]})},u.id)})})]})]})}async function $s(e,a,r){let t=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||t.encoding==="base64")return{after:t,before:null,pruned:!1};if(r.op==="delete")return{after:t,before:t.content,pruned:!1};let n=(await e.history(a,{path:r.path,limit:100})).find(i=>i.id<r.id);if(!n)return{after:t,before:null,pruned:!0};if(n.op==="delete")return{after:t,before:"",pruned:!1};let d=await e.revision(a,n.id);return{after:t,before:d.content,pruned:!1}}function id({doc:e,revision:a,onClose:r,onOpenPath:t}){let n=U(),[d,i]=b(a.op==="write"||a.op==="delete"?"changes":"full"),[l,c]=b(!1),[f,u]=b(null),h=Ye(`${e.id}\0${a.id}`,()=>$s(n,e.id,a)),L=xa(a.path),I=e.files.find(w=>w.path===a.path)??null,C=I?.revision===a.revision&&a.op!=="delete",m=V(()=>{let w=h.data;if(!w||w.before===null||ze(L))return null;let q=rd(w.before,a.op==="delete"?"":w.after.content);return q?{hunks:nd(q),stats:dd(q)}:"too-large"},[h.data,a.op,L]),k=async()=>{c(!0);try{let w=await n.restore(e.id,a.id,I?.revision??0);F(`Restored ${w.path} to revision ${a.revision} (now rev ${w.revision})`),t(w.path),r()}catch(w){F(`Could not restore: ${H(w)}`,"error")}finally{c(!1)}},R=()=>{if(I){k();return}u({title:`Recreate ${a.path}?`,body:s(j,{children:[o("code",{children:a.path})," is no longer in this doc",a.op==="delete"?"":"; it may have been renamed",". Recreate it with the content of revision ",a.revision,"?"]}),confirmLabel:"Recreate",run:()=>{k()}})},A=m!==null,N=d==="full"||!A;return s("div",{className:"dd-revision",children:[s("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[o(Se,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o("strong",{children:sd[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",o(Le,{actor:a.actor})," ",o(se,{at:a.createdAt,now:Date.now()}),a.renamedFrom?s(j,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?s("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),A?s("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[o("button",{type:"button",className:d==="changes"?"on":"",onClick:()=>i("changes"),children:"Changes"}),o("button",{type:"button",className:d==="full"?"on":"",onClick:()=>i("full"),children:"Full file"})]}):null,s("button",{type:"button",className:"btn",disabled:C||l||!h.data,onClick:R,children:[o(Ue,{size:12,"aria-hidden":!0})," ",C?"Current":I?"Restore":"Recreate file"]}),o(_,{icon:re,label:"Close revision",onClick:r})]}),s("div",{className:"dd-revision-body",children:[h.error?o("div",{className:"dd-banner dd-banner-error",children:h.error}):null,h.data?N?s(j,{children:[h.data.pruned?o("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,m==="too-large"?o("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,o(Pt,{docId:e.id,file:{path:a.path,kind:L,content:h.data.after.content,encoding:h.data.after.encoding},files:e.files,onOpenPath:t,draft:!0})]}):m&&m!=="too-large"?s("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[s("div",{className:"dd-diff-stats",children:[s("span",{className:"dd-diff-added",children:["+",m.stats.added]}),s("span",{className:"dd-diff-removed",children:["\u2212",m.stats.removed]}),o("span",{className:"dd-muted",children:ga(a.size)})]}),m.hunks.map((w,q)=>w.type==="gap"?s("div",{className:"dd-diff-gap",children:["\u22EF ",w.count," unchanged line",w.count===1?"":"s"]},q):w.lines.map((y,B)=>s("div",{className:`dd-diff-line dd-diff-${y.type}`,role:"row",children:[o("span",{className:"dd-diff-sign","aria-hidden":!0,children:y.type==="add"?"+":y.type==="del"?"\u2212":" "}),o("span",{className:"dd-diff-text",children:y.text||" "})]},`${q}-${B}`))),m.stats.added+m.stats.removed===0?o("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:h.loading?o("div",{className:"dd-center",children:o(W,{label:"Loading revision"})}):null]}),f?o(Fe,{request:f,onClose:()=>u(null)}):null]})}var Vs=[{id:"preview",label:"Preview",icon:Ja},{id:"edit",label:"Edit",icon:pa},{id:"split",label:"Split",icon:Ve}];function Ws(e,a,r){let t=on(e,a,r),n=M(null);t.data&&(n.current=t.data);let d=n.current&&n.current.path===a?n.current:null;return{file:t.data??d,error:t.error,loading:t.loading}}function Xs(e,a,r){let[t,n]=b(null),d=M({path:e,revision:a});return E(()=>{let i=d.current;if(d.current={path:e,revision:a},i.path!==e||a===null||i.revision===null||a<=i.revision||r?.kind!=="agent")return;n(r.label);let l=setTimeout(()=>n(null),4e3);return()=>clearTimeout(l)},[e,a,r]),t}function ud({doc:e,path:a,mode:r,onModeChange:t,railOpen:n,onToggleRail:d,revision:i,onCloseRevision:l,previewHandle:c,onOpenPath:f,onQuote:u,onAskAbout:h,onEditorState:L,leading:I}){let C=e.files.find(x=>x.path===a)??null,{file:m,error:k,loading:R}=Ws(e.id,a,C?.revision??null),A=Xs(a,C?.revision??null,C?.updatedBy),N=!C||!ze(C.kind),w=N?r:"preview",q=V(()=>e.comments.filter(x=>x.status==="open"&&x.path===a&&x.quote).map(x=>x.quote),[e.comments,a]),y=a.lastIndexOf("/");E(()=>{w==="preview"&&L({dirty:!1,saving:!1})},[w,L]);let B;return i?B=o(id,{doc:e,revision:i,onClose:l,onOpenPath:f},i.id):!C&&!(m&&w!=="preview")?B=s("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}):m?w==="preview"?B=o(Pt,{docId:e.id,file:m,files:e.files,quotes:q,onOpenPath:f,onQuote:u,onAskAbout:h,handleRef:c}):B=o(Vn,{docId:e.id,file:m,removed:!C,split:w==="split",onStateChange:L,renderPreview:x=>o(Pt,{docId:e.id,file:{...m,content:x},files:e.files,onOpenPath:f,draft:x!==m.content})},`${e.id}\0${a}`):B=o("div",{className:"dd-center",children:k?o("div",{className:"dd-banner dd-banner-error",children:k}):R?o(W,{label:"Loading file"}):null}),s("section",{className:"dd-file-pane","aria-label":a,children:[s("div",{className:"dd-file-toolbar",children:[I,C?o(Pa,{kind:C.kind}):null,s("span",{className:"dd-file-path",title:a,children:[y>0?o("span",{className:"dd-file-dir",children:a.slice(0,y+1)}):null,o("span",{className:"dd-file-name",children:a.slice(y+1)})]}),C?s("span",{className:"dd-file-meta",children:["rev ",C.revision," \xB7 ",ga(C.size)," \xB7 ",o(Le,{actor:C.updatedBy})," ",o(se,{at:C.updatedAt,now:Date.now()})]}):null,A?s("span",{className:"dd-flash",role:"status",children:[o(ue,{size:12,"aria-hidden":!0})," Updated by ",A]}):null,o("span",{className:"dd-spacer"}),i?null:o("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:Vs.map(x=>s("button",{type:"button",className:w===x.id?"on":"",disabled:!N&&x.id!=="preview",onClick:()=>t(x.id),title:x.label,"aria-pressed":w===x.id,children:[o(x.icon,{size:13,"aria-hidden":!0}),o("span",{className:"dd-mode-label",children:x.label})]},x.id))}),o(_,{icon:lt,label:n?"Hide comments & history":"Show comments & history",active:n,onClick:d})]}),o("div",{className:"dd-file-body",children:B})]})}function Js(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,t=>t.toUpperCase());switch(xa(e)){case"markdown":return`# ${r}

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
`;default:return""}}function Qs(e){let a=e.trim().replace(/^\/+/,"");return It(a)?a:`${a}.md`}function Ys(e){return new Promise((a,r)=>{let t=new FileReader,n=ze(xa(e.name));t.onerror=()=>r(t.error??new Error("could not read the file")),t.onload=()=>{let d=String(t.result??"");a(n?{content:d.slice(d.indexOf(",")+1),encoding:"base64"}:{content:d})},n?t.readAsDataURL(e):t.readAsText(e)})}function cd({initial:e,placeholder:a,onSubmit:r,onCancel:t}){let[n,d]=b(e),i=M(!1),l=f=>{f?.preventDefault(),!i.current&&(i.current=!0,n.trim()&&n.trim()!==e?r(n.trim()):t())};return o("form",{className:"dd-tree-input",onSubmit:l,children:o("input",{className:"dd-input",value:n,placeholder:a,"aria-label":a,onChange:f=>d(f.target.value),onKeyDown:f=>{f.key==="Escape"&&(f.preventDefault(),i.current=!0,t())},onBlur:()=>l(),autoFocus:!0,onFocus:f=>{let u=f.target.value.lastIndexOf("."),h=f.target.value.lastIndexOf("/")+1;f.target.setSelectionRange(h,u>h?u:f.target.value.length)}})})}function el({doc:e,file:a,name:r,depth:t,active:n,renaming:d,onOpen:i,onRename:l,onRenameDone:c,onDelete:f}){let u=U(),[h,L]=b(!1),I=e.entryPath===a.path,C=e.comments.filter(m=>m.status==="open"&&m.path===a.path).length;return d?o("div",{className:"dd-tree-row",style:{paddingLeft:8+t*14},children:o(cd,{initial:a.path,placeholder:"New path",onSubmit:m=>c(m),onCancel:()=>c(null)})}):s("div",{className:`dd-tree-row dd-tree-file${n?" on":""}`,style:{paddingLeft:8+t*14},children:[s("button",{type:"button",className:"dd-tree-open",onClick:i,onDoubleClick:l,title:`${a.path} \xB7 ${ga(a.size)} \xB7 rev ${a.revision}`,"aria-current":n?"page":void 0,children:[o(Pa,{kind:a.kind}),o("span",{className:"dd-tree-name",children:r}),I?o(Ze,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,C?o("span",{className:"dd-tree-badge",title:`${C} open comment${C===1?"":"s"}`,children:C}):null]}),s(ve,{open:h,onClose:()=>L(!1),className:"dd-menu",anchor:o(_,{icon:ke,label:`Actions for ${a.path}`,size:13,active:h,onClick:()=>L(!h)}),children:[o(fe,{icon:pa,label:"Rename or move",onSelect:()=>{L(!1),l()}}),I||ze(a.kind)?null:o(fe,{icon:pt,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{L(!1),u.update(e.id,{entryPath:a.path}).catch(m=>F(H(m),"error"))}}),o(fe,{icon:ge,label:"Delete",danger:!0,onSelect:()=>{L(!1),f()}})]})]})}function io({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n,onHide:d}){let i=U(),[l,c]=b(new Set),[f,u]=b(!1),[h,L]=b(null),[I,C]=b(null),m=M(null),k=An(e.files),R=e.files.length>=500,A=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",N=async P=>{u(!1);let v=Qs(P);if(e.files.some(S=>S.path===v)){r(v);return}if(ze(xa(v))){F("Use \u201CAdd files\u201D to upload images and fonts.","error");return}try{await i.writeFile(e.id,{path:v,content:Js(v)}),r(v)}catch(S){F(`Could not create ${v}: ${H(S)}`,"error")}},w=(P,v)=>{if(L(null),!v||v===P)return;let S=async()=>{try{let O=await i.renameFile(e.id,P,v);t(P,O.path)}catch(O){F(`Could not rename ${P}: ${H(O)}`,"error")}};if(!n?.(P)){S();return}C({title:"Discard unsaved changes?",body:s(j,{children:["Renaming ",o("code",{children:P})," drops your unsaved edits to it. Save them first to keep them."]}),confirmLabel:"Discard and rename",danger:!0,run:S})},q=async P=>{for(let v of Array.from(P??[])){let S=xa(v.name),O=ze(S)?2097152:2097152;if(v.size>O){F(`${v.name} is larger than ${ga(O)}`,"error");continue}let X=S==="image"||S==="svg"||S==="font",te=`${A||(X?"assets/":"")}${v.name.replace(/[^\w.-]+/g,"-")}`;try{let pe=await Ys(v);await i.writeFile(e.id,{path:te,...pe});let me=te.slice(A.length);F(S==="font"||!X?`Added ${te}`:`Added ${te}. Reference it with ![${v.name}](${me})`)}catch(pe){F(`Could not add ${v.name}: ${H(pe)}`,"error")}}m.current&&(m.current.value="")},y=P=>C({title:"Delete file",body:s(j,{children:["Delete ",o("code",{children:P.path}),"? Its history is kept, so it can be recreated from History.",n?.(P.path)?" Your unsaved edits to it will be lost.":null]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await i.deleteFile(e.id,P.path),t(P.path,null)}catch(v){F(`Could not delete ${P.path}: ${H(v)}`,"error")}}}),B=P=>c(v=>{let S=new Set(v);return S.has(P)?S.delete(P):S.add(P),S}),x=(P,v)=>P.map(S=>{if(S.kind==="folder"){let O=!l.has(S.path);return s("div",{role:"group","aria-label":S.name,children:[s("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+v*14},onClick:()=>B(S.path),"aria-expanded":O,children:[O?o(ce,{size:12,"aria-hidden":!0}):o(ia,{size:12,"aria-hidden":!0}),O?o(_e,{size:14,"aria-hidden":!0}):o(tt,{size:14,"aria-hidden":!0}),o("span",{className:"dd-tree-name",children:S.name})]}),O?x(S.children,v+1):null]},`d:${S.path}`)}return o(el,{doc:e,file:S.file,name:S.name,depth:v,active:S.path===a,renaming:h===S.path,onOpen:()=>r(S.path),onRename:()=>L(S.path),onRenameDone:O=>{w(S.path,O)},onDelete:()=>y(S.file)},`f:${S.path}`)});return s("nav",{className:"dd-tree","aria-label":"Files",children:[s("div",{className:"dd-tree-head",children:[o("span",{className:"dd-section-label",children:"Files"}),o("span",{className:"dd-tree-count",children:e.files.length}),o("span",{className:"dd-spacer"}),o(_,{icon:Ae,label:"Add files",size:13,disabled:R,onClick:()=>m.current?.click()}),o(_,{icon:xe,label:"New file",size:13,disabled:R,onClick:()=>u(!0)}),d?o(_,{icon:Te,label:"Hide files",size:13,onClick:d}):null,o("input",{ref:m,type:"file",multiple:!0,hidden:!0,onChange:P=>{q(P.target.files)}})]}),s("div",{className:"dd-tree-scroll",role:"tree",children:[x(k,0),f?o("div",{className:"dd-tree-row",style:{paddingLeft:8},children:o(cd,{initial:A,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:P=>{N(P)},onCancel:()=>u(!1)})}):null]}),I?o(Fe,{request:I,onClose:()=>C(null)}):null]})}var al=560,tl=640,ol=1100,Ut=[al,tl,ol];function rl(e,a){let r=t=>!!t&&e.files.some(n=>n.path===t);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function nl({doc:e,tab:a,onTab:r,activePath:t,now:n,pendingQuote:d,onClearQuote:i,commentDraft:l,onCommentDraft:c,onFocusComment:f,selectedRevision:u,onSelectRevision:h,chatThreadId:L,onOpenChat:I,onClose:C}){let m=[{id:"comments",label:"Comments",icon:De,count:e.openComments},{id:"history",label:"History",icon:Se},{id:"agents",label:"Agents",icon:ue,count:e.threads.length}],k=a==="agents"&&!!I&&e.threads.some(R=>R.threadId===L);return s("aside",{className:`dd-rail${k?" dd-rail-chat":""}`,"aria-label":"Comments, history and agents",children:[s("div",{className:"dd-rail-tabs",role:"tablist",children:[m.map(R=>s("button",{type:"button",role:"tab","aria-selected":a===R.id,className:`dd-rail-tab${a===R.id?" on":""}`,onClick:()=>r(R.id),children:[o(R.icon,{size:13,"aria-hidden":!0}),R.label,R.count?o("span",{className:"dd-count",children:R.count}):null]},R.id)),C?s(j,{children:[o("span",{className:"dd-spacer"}),o(_,{icon:re,label:"Close",onClick:C,size:13})]}):null]}),a==="comments"?o(On,{doc:e,activePath:t,now:n,pendingQuote:d,onClearQuote:i,draft:l,onDraft:c,onFocusComment:f}):a==="history"?o(ld,{doc:e,activePath:t,now:n,selectedId:u,onSelect:h}):o(pn,{doc:e,now:n,chatThreadId:L,...I?{onOpenChat:I}:{}})]})}function dl({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let[d,i]=b(!1),l=e.files.find(c=>c.path===a);return o(ve,{open:d,onClose:()=>i(!1),align:"start",className:"dd-switcher-pop",anchor:s("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":d,onClick:()=>i(!d),title:"Files in this doc",children:[l?o(Pa,{kind:l.kind}):null,s("span",{children:[e.files.length," files"]}),o(ce,{size:12,"aria-hidden":!0})]}),children:o(io,{doc:e,activePath:a,onOpen:c=>{i(!1),r(c)},onPathChanged:t,hasDraft:n})})}function zt({docId:e,path:a,onOpenPath:r,layout:t,contextProjectId:n=null,onDeleted:d,headerExtra:i}){let l=Bt(e),c=Re(),f=ya(),u=t==="compact",[h,L]=rn(Ut),I=!u&&(L??Ut.length)<1,C=!u&&(L??Ut.length)>=2,m=!u&&(L??Ut.length)>=3,[k,R]=de("tree",!0),A=C&&k,[N,w]=de("view-mode","preview"),[q,y]=de("rail",!0),[B,x]=de("rail-compact",!1),P=m?q:B,v=m?y:x,[S,O]=de("rail-tab","comments"),[X,te]=b(null),[pe,me]=b(""),[ee,J]=b(null),[ne,Ie]=b(null),[le,ie]=b(null),[Be,D]=b(null),[z,$]=b(null),oe=M({dirty:!1,saving:!1}),[he,Fa]=b(!1),wt=M(null),Ge=M(null),je=M(null),Q=l.data,Ne=Q?rl(Q,a):null,Ba=!!Q&&!!Ge.current&&!Q.files.some(p=>p.path===Ge.current);Ba||(je.current=null);let Y=Ba&&(he||je.current===Ge.current)?Ge.current:Ne;Ge.current=Y;let oa=!!Q&&!!l.error&&Jr(l.error),ra=M({onDeleted:d,title:Q?.title??""});ra.current={onDeleted:d,title:Q?.title??ra.current.title};let jt=we(p=>{oe.current.saving&&!p.saving&&!p.dirty&&(je.current=Ge.current),oe.current=p,Fa(p.dirty)},[]),Na=we(()=>{oe.current={dirty:!1,saving:!1},je.current=null,Fa(!1)},[]),na=we(p=>{if(!oe.current.dirty){p();return}D({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{Na(),p()}})},[Na]),Ca=we(p=>{if(p===Y){ie(null);return}na(()=>{ie(null),r(p)})},[Y,na,r]);E(()=>{oa&&(F(`\u201C${ra.current.title}\u201D was deleted`),ra.current.onDeleted())},[oa]);let Ea=!!ee&&!!Q?.threads.some(p=>p.threadId===ee);if(E(()=>{ee&&Q&&!Ea&&J(null)},[ee,Ea,Q]),E(()=>{if(!z||z.path!==Y||le)return;let p=[80,300,900].map(T=>setTimeout(()=>{wt.current?.focusQuote(z.quote)&&(p.forEach(clearTimeout),$(null))},T));return()=>p.forEach(clearTimeout)},[z,Y,le]),!Q)return o("div",{className:"dd-doc dd-center",children:l.error?o(Pe,{icon:be,title:"This design doc could not be opened",children:l.error}):o(W,{label:"Loading design doc"})});let Oa=p=>na(()=>{ie(null),p.path&&p.path!==Y&&r(p.path),N!=="preview"&&w("preview"),m||v(!1),p.quote&&$({path:p.path??Y??"",quote:p.quote,nonce:Date.now()})}),Lo=p=>na(()=>{ie(p),p.path!==Y&&Q.files.some(T=>T.path===p.path)&&r(p.path)}),da=p=>{p==="preview"?na(()=>w(p)):w(p)},kt=(p,T)=>{p===Y&&(Na(),r(T,!0))},qa=p=>p===Y&&oe.current.dirty,Ha=o(nl,{doc:Q,tab:S,onTab:O,activePath:Y,now:f,pendingQuote:X,onClearQuote:()=>te(null),commentDraft:pe,onCommentDraft:me,onFocusComment:Oa,selectedRevision:le?.id??null,onSelectRevision:Lo,chatThreadId:ee,...u?{}:{onOpenChat:J},onClose:m?void 0:()=>v(!1)});return s("div",{ref:h,className:`dd-doc dd-doc-${t}${I?" dd-doc-narrow":""}${P?" dd-rail-open":""}${m?"":" dd-rail-floating"}`,children:[o($n,{doc:Q,projects:c.data??[],compact:u,collapsible:I,onDeleted:d,actions:s(j,{children:[i,o(Bn,{doc:Q,compact:u||I}),o(mn,{doc:Q,activePath:Y,request:ne,contextProjectId:n,compact:u||I})]})}),s("div",{className:"dd-doc-body",children:[A?o(io,{doc:Q,activePath:Y,onOpen:Ca,onPathChanged:kt,hasDraft:qa,onHide:()=>R(!1)}):null,Y?o(ud,{doc:Q,path:Y,mode:N,onModeChange:da,railOpen:P,onToggleRail:()=>v(!P),revision:le,onCloseRevision:()=>ie(null),previewHandle:wt,onOpenPath:Ca,onQuote:p=>{te({path:Y,text:p}),O("comments"),v(!0)},onAskAbout:p=>Ie({prompt:`About this passage in ${Y}:
> ${p.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:jt,leading:A?null:s(j,{children:[C?o(_,{icon:Me,label:"Show files",onClick:()=>R(!0)}):null,o(dl,{doc:Q,activePath:Y,onOpen:Ca,onPathChanged:kt,hasDraft:qa})]})}):o("div",{className:"dd-file-pane dd-center",children:o(Pe,{icon:be,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),P?Ha:null]}),Be?o(Fe,{request:Be,onClose:()=>D(null)}):null]})}var aa=globalThis.__ZCC_HOST_REACT_DOM__;if(aa==null)throw new Error("host react-dom is not available");var fd=aa.createPortal,oh=aa.flushSync,rh=aa.hydrate,nh=aa.render,dh=aa.unmountComponentAtNode,sh=aa.findDOMNode,lh=aa.version;var vt=null,uo=new Set;function md(){uo.forEach(e=>e())}function sl(e){vt!==e&&(vt=e,md())}function ll(e){vt===e&&(vt=null,md())}function pd(e){return vt===e}function il(e){return uo.add(e),()=>uo.delete(e)}function co(){let e=M(null);e.current||(e.current=Symbol("popover"));let a=e.current;return[To(il,()=>pd(a),()=>!1),n=>{(typeof n=="function"?n(pd(a)):n)?sl(a):ll(a)}]}var ul=typeof window>"u"?E:Sa,ta=8,gd=4,cl=160,fl=360,pl=.55;function ml(e,a,r){let t=Math.max(e.width,r),n=e.left;n+t>a.width-ta&&(n=e.right-t),n<ta&&(n=ta),n+t>a.width-ta&&(n=Math.max(ta,a.width-t-ta));let d=a.height-e.bottom-ta,i=e.top-ta,l=d<cl&&i>d,c=Math.max(120,l?i:d),f=Math.min(fl,Math.floor(a.height*pl)),u=Math.min(c,f);return l?{left:n,width:t,maxHeight:u,bottom:a.height-e.top+gd}:{left:n,width:t,maxHeight:u,top:e.bottom+gd}}function gl(e,a){if(e.sticky)return!0;let r=a.trim().toLowerCase();return r?`${e.label} ${e.compactLabel??""} ${e.description??""}`.toLowerCase().includes(r):!0}function hl(e,a,r=!0){let t=[],n=[];for(let d of e){if(d.sticky){n.push(d);continue}(!r||gl(d,a))&&t.push(d)}return{items:t,sticky:n}}function hd({option:e,previousGroup:a,optionId:r,selected:t,active:n,onHover:d,onSelect:i}){return s("div",{children:[e.group&&e.group!==a&&o("div",{className:"launch-model-picker-group-label",children:e.group}),s("button",{type:"button",id:r,className:`launch-model-picker-option${e.description?" launch-model-picker-option--stacked":""}${e.className?` ${e.className}`:""}${t?" is-selected":""}${n?" is-active":""}${e.tone==="warning"?" is-warning":""}`,role:"option","aria-selected":t,"aria-disabled":e.disabled||void 0,disabled:e.disabled,tabIndex:-1,onMouseEnter:d,onFocus:d,onClick:i,children:[e.content||e.description?s("span",{className:"launch-model-picker-option-copy",children:[e.content??o("span",{children:e.label}),e.description?o("span",{className:"launch-model-picker-option-description",children:e.description}):null]}):o("span",{children:e.label}),t&&o(Oe,{size:14,"aria-hidden":"true"})]})]})}function fo({id:e,ariaLabel:a,value:r,options:t,onChange:n,placeholder:d="Select\u2026",disabled:i,title:l,ariaKeyshortcuts:c,searchable:f=!0,searchPlaceholder:u="Search\u2026",emptyHint:h="No matches",className:L="",triggerClassName:I="launch-model-picker-trigger",triggerTestId:C,triggerIcon:m,minWidth:k=200,anchorToParent:R=!1}){let[A,N]=co(),[w,q]=b(""),[y,B]=b(null),x=M(null),P=M(null),v=M(null),S=M(!1),O=Do(),[X,te]=b(0),pe=t.find(D=>D.value===r),{items:me,sticky:ee}=V(()=>hl(t,w,f),[t,w,f]),J=V(()=>[...me,...ee],[ee,me]),ne=J[X],Ie=D=>`${O}-${D.value}`,le=D=>{!D||D.disabled||(n(D.value),N(!1))},ie=D=>{J.length!==0&&te(z=>{for(let $=1;$<=J.length;$+=1){let oe=(z+D*$+J.length)%J.length;if(!J[oe].disabled)return oe}return z})},Be=D=>{if(D.key==="Escape")D.preventDefault(),N(!1);else if(D.key==="ArrowDown")D.preventDefault(),ie(1);else if(D.key==="ArrowUp")D.preventDefault(),ie(-1);else if(D.key==="Home"){D.preventDefault();let z=J.findIndex($=>!$.disabled);z>=0&&te(z)}else if(D.key==="End"){D.preventDefault();let z=J.length-1-[...J].reverse().findIndex($=>!$.disabled);z>=0&&te(z)}else D.key==="Enter"&&(D.preventDefault(),le(ne))};return ul(()=>{if(!A||!x.current)return;let D=R?x.current.parentElement?.getBoundingClientRect()??x.current.getBoundingClientRect():x.current.getBoundingClientRect();B(ml(D,{width:window.innerWidth,height:window.innerHeight},k))},[A,R,k]),E(()=>{if(!A)return;let D=$=>{let oe=$.target;x.current?.contains(oe)||P.current?.contains(oe)||N(!1)},z=$=>{$.key==="Escape"&&N(!1)};return document.addEventListener("mousedown",D,!0),document.addEventListener("keydown",z),()=>{document.removeEventListener("mousedown",D,!0),document.removeEventListener("keydown",z)}},[A]),E(()=>{if(A){let D=J.findIndex($=>$.value===r&&!$.disabled),z=J.findIndex($=>!$.disabled);te(D>=0?D:Math.max(0,z)),f?v.current?.focus():P.current?.focus()}else q(""),S.current&&x.current?.focus();S.current=A},[A,f,r]),E(()=>{X>=J.length&&te(0)},[X,J.length]),E(()=>{if(!A||!ne||ne.sticky)return;let D=P.current?.querySelector(`[id="${CSS.escape(Ie(ne))}"]`);D instanceof HTMLElement&&D.scrollIntoView({block:"nearest"})},[X,ne,A]),s(j,{children:[s("button",{ref:x,id:e,type:"button",className:`${I} ${L}${pe?.tone==="warning"?" is-warning":""}`,disabled:i,title:l,"aria-keyshortcuts":c,onClick:()=>N(D=>!D),onKeyDown:D=>{(D.key==="ArrowDown"||D.key==="ArrowUp")&&(D.preventDefault(),N(!0))},"aria-haspopup":"listbox","aria-expanded":A,"aria-controls":A?O:void 0,"aria-label":a,"data-testid":C??e,children:[m,o("span",{children:pe?.compactLabel??pe?.label??d}),o(ce,{size:14,"aria-hidden":"true"})]}),A&&fd(s("div",{ref:P,className:"launch-model-picker-menu launch-model-picker-menu--split",role:"listbox",id:O,tabIndex:-1,"aria-label":a,"aria-activedescendant":ne?Ie(ne):void 0,onKeyDown:Be,style:y?{left:y.left,width:y.width,maxHeight:y.maxHeight,...y.bottom!=null?{bottom:y.bottom,top:"auto"}:{top:y.top}}:{visibility:"hidden"},children:[f&&s("div",{className:"launch-model-picker-search",children:[o(ma,{size:13,"aria-hidden":"true"}),o("input",{ref:v,value:w,onChange:D=>q(D.target.value),placeholder:u,"aria-label":u,"aria-activedescendant":ne?Ie(ne):void 0,onKeyDown:Be})]}),s("div",{className:"launch-model-picker-options",children:[me.map((D,z)=>o(hd,{option:D,previousGroup:me[z-1]?.group,optionId:Ie(D),selected:r===D.value,active:X===z,onHover:()=>te(z),onSelect:()=>le(D)},D.value)),me.length===0&&o("div",{className:"launch-model-picker-hint",children:h})]}),ee.length>0&&o("div",{className:"launch-model-picker-footer",children:ee.map((D,z)=>{let $=me.length+z;return o(hd,{option:D,previousGroup:z===0?void 0:ee[z-1]?.group,optionId:Ie(D),selected:r===D.value,active:X===$,onHover:()=>te($),onSelect:()=>le(D)},D.value)})})]}),document.body)]})}var mo="__global__",xl=Tt-600,Ll=[{value:"active",label:"Active",description:"Everything except archived"},...Mt.map(e=>({value:e,label:Rt[e]})),{value:"all",label:"All statuses"}];function po(e,a,r){return{value:e,label:a,content:s("span",{className:"dd-pick-row",children:[o("span",{className:"dd-pick-label",children:a}),o("span",{className:"dd-pick-count",children:r})]})}}function Il(e,a,r){let t=new Map;for(let d of e)t.set(d.projectId,(t.get(d.projectId)??0)+1);let n=[po("","All projects",e.length)];(t.has(null)||r===mo)&&n.push(po(mo,"Global docs",t.get(null)??0));for(let d of a)(t.has(d.id)||r===d.id)&&n.push(po(d.id,d.name,t.get(d.id)??0));return n}function Cl(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function bl(e,a){let[r,t]=b(e);return E(()=>{let n=setTimeout(()=>t(e),a);return()=>clearTimeout(n)},[e,a]),r}function Sl({doc:e,active:a,projectName:r,now:t,menuOpen:n,onSelect:d,onMenu:i}){return s("button",{type:"button",className:`dd-doc-row${a?" on":""}${n?" dd-doc-row-menu":""}`,onClick:d,onContextMenu:l=>{l.preventDefault(),i(un(l))},"aria-current":a?"page":void 0,"aria-haspopup":"menu",children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:e.title}),o(ea,{status:e.status,compact:!0})]}),e.summary?o("span",{className:"dd-doc-row-summary",children:e.summary}):null,s("span",{className:"dd-doc-row-meta",children:[r!==null?o("span",{className:"dd-doc-row-project",title:r,children:r}):null,s("span",{title:`${e.fileCount} files`,children:[o(ua,{size:11,"aria-hidden":!0})," ",e.fileCount]}),e.openComments?s("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[o(De,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,e.updatedBy.kind==="agent"?o("span",{title:"Last edited by an agent",children:o(ue,{size:11,"aria-label":"Last edited by an agent"})}):null,o("span",{className:"dd-spacer"}),o(se,{at:e.updatedAt,now:t})]})]})}function yl({projectId:e,showProjects:a,projects:r,activeId:t,onSelect:n,onDeleted:d,onNew:i,onCollapse:l,headerActions:c}){let[f,u]=b(""),[h,L]=de("list-status","active"),[I,C]=de("list-project",""),[m,k]=b(null),R=Ot(r),A=bl(f.trim(),200),N=ya(),w=Ft({...e?{projectId:e}:{},...A?{query:A}:{},status:h}),q=V(()=>new Map(r.map(P=>[P.id,P.name])),[r]),y=V(()=>{let P=w.data??[];return!a||!I?P:P.filter(v=>I===mo?v.projectId===null:v.projectId===I)},[w.data,a,I]),B=h!=="active"||a&&!!I,x=V(()=>a?Il(w.data??[],r,I):[],[a,w.data,r,I]);return s("div",{className:"dd-list",children:[s("div",{className:"dd-list-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),w.data?o("span",{className:"dd-list-count",title:`${y.length} ${y.length===1?"doc":"docs"}`,children:y.length}):null,o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary dd-new",onClick:i,children:[o(xe,{size:13,"aria-hidden":!0})," New"]}),o(_,{icon:Te,label:"Hide doc list",onClick:l}),c]}),o("div",{className:"dd-list-tools",children:s("label",{className:"dd-search",children:[o(ma,{size:13,"aria-hidden":!0}),o("input",{value:f,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:P=>u(P.target.value)}),f?o("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>u(""),children:o(re,{size:12,"aria-hidden":!0})}):null]})}),s("div",{className:"dd-list-filters",children:[o(fo,{ariaLabel:"Filter by status",value:h,options:Ll,onChange:L,searchable:!1,triggerClassName:`launch-model-picker-trigger dd-pick${h!=="active"?" on":""}`,triggerIcon:o(Wa,{size:12,"aria-hidden":!0})}),a?o(fo,{ariaLabel:"Filter by project",value:I,options:x,onChange:C,searchable:x.length>8,searchPlaceholder:"Search projects\u2026",minWidth:220,triggerClassName:`launch-model-picker-trigger dd-pick${I?" on":""}`,triggerIcon:o(_e,{size:12,"aria-hidden":!0})}):null]}),s("div",{className:"dd-list-scroll",children:[w.error?o("div",{className:"dd-banner dd-banner-error",children:w.error}):null,!w.data&&w.loading?o("div",{className:"dd-center",children:o(W,{label:"Loading design docs"})}):null,w.data&&!y.length?o("div",{className:"dd-list-empty dd-muted",children:A||B?"No docs match.":"No design docs yet."}):null,y.map(P=>o(Sl,{doc:P,active:P.id===t,projectName:a?P.projectId?q.get(P.projectId)??"Unknown project":"Global":P.projectId?null:"Global",now:N,menuOpen:m?.doc.id===P.id,onSelect:()=>n(P.id),onMenu:v=>k({doc:P,at:v})},P.id))]}),m?o(cn,{at:m.at,label:`Actions for ${m.doc.title}`,onClose:()=>k(null),children:R.items(m.doc,()=>k(null),()=>d(m.doc.id),m.doc.id===t?void 0:()=>n(m.doc.id))},`${m.doc.id}@${m.at.x},${m.at.y}`):null,R.dialogs]})}function xd({templates:e,selected:a,onSelect:r}){return o("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(t=>s("button",{type:"button",role:"radio","aria-checked":a===t.id,className:`dd-template${a===t.id?" on":""}`,onClick:()=>r(t.id),children:[o("span",{className:"dd-template-label",children:t.label}),o("span",{className:"dd-template-desc",children:t.description}),o("span",{className:"dd-template-files",children:t.files.join(" \xB7 ")})]},t.id))})}function go({initialTemplate:e,defaultProjectId:a,projects:r,onClose:t,onCreated:n}){let d=U(),i=Ce(),l=Vt(),[c,f]=b(""),[u,h]=b(""),[L,I]=b(e??null),[C,m]=b(a??""),[k,R]=b(""),[A,N]=b(""),[w,q]=b(!1),y=L??l.data?.[0]?.id??null,B=!!A.trim(),x=C||a||r[0]?.id||"",P=async()=>{if(!(!c.trim()||w)){q(!0);try{let v=await d.create({title:c.trim(),...u.trim()?{summary:u.trim()}:{},...y?{template:y}:{},tags:k.split(",").map(S=>S.trim().toLowerCase()).filter(Boolean),projectId:C||null});if(n(v.id),B)if(!x)F("Doc created. Add a project to let an agent draft it.","error");else{let S=await d.askAgent(v.id,{prompt:Cl(A),projectId:x});Lt(i,v,S.threadId),F(`An agent is drafting \u201C${v.title}\u201D. Watch it fill in as it writes.`)}t()}catch(v){F(`Could not create the doc: ${H(v)}`,"error"),q(!1)}}};return o(ha,{title:"New design doc",wide:!0,onClose:t,footer:s(j,{children:[o("span",{className:"dd-muted dd-dialog-hint",children:B?"An agent starts a new thread to draft it.":"You can ask an agent to fill it in later."}),o("span",{className:"dd-spacer"}),o("button",{type:"button",className:"btn",onClick:t,children:"Cancel"}),s("button",{type:"button",className:"btn primary",disabled:!c.trim()||w,onClick:()=>{P()},children:[w?o(W,{size:12}):B?o(ae,{size:12,"aria-hidden":!0}):null,B?"Create & draft with agent":"Create"]})]}),children:s("form",{className:"dd-form",onSubmit:v=>{v.preventDefault(),P()},children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Title"}),o("input",{className:"dd-input",value:c,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:v=>f(v.target.value),autoFocus:!0})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Summary"}),o("input",{className:"dd-input",value:u,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:v=>h(v.target.value)})]}),s("div",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Template"}),l.data?o(xd,{templates:l.data,selected:y,onSelect:I}):o(W,{label:"Loading templates"})]}),s("div",{className:"dd-field-row",children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:C,onChange:v=>m(v.target.value),children:[o("option",{value:"",children:"Global (all projects)"}),r.map(v=>o("option",{value:v.id,children:v.name},v.id))]})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Tags"}),o("input",{className:"dd-input",value:k,placeholder:"sync, mobile",onChange:v=>R(v.target.value)})]})]}),s("label",{className:"dd-field",children:[s("span",{className:"dd-field-label",children:[o(ae,{size:12,"aria-hidden":!0})," Brief for an agent ",o("span",{className:"dd-muted",children:"(optional)"})]}),o("textarea",{className:"dd-input",rows:4,value:A,maxLength:xl,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:v=>N(v.target.value)})]}),o("button",{type:"submit",hidden:!0})]})})}function Pl({templates:e,onNew:a}){return o("div",{className:"dd-landing",children:s("div",{className:"dd-landing-inner",children:[o("span",{className:"dd-landing-icon",children:o(We,{size:26,"aria-hidden":!0})}),o("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),o("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),s("ul",{className:"dd-landing-points",children:[s("li",{children:[o(ae,{size:13,"aria-hidden":!0})," ",o("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),s("li",{children:[o(De,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),s("li",{children:[o(ue,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),s("div",{className:"dd-landing-start",children:[o("span",{className:"dd-section-label",children:"Start from a template"}),e?o(xd,{templates:e,selected:null,onSelect:r=>a(r)}):o(W,{})]})]})})}function ho({projectId:e,location:a,onLocationChange:r,variant:t,headerActions:n}){let d=Re(),i=Vt(),[l,c]=b(null),[f,u]=de("list-open",!0),h=d.data??[];return s("div",{className:"dd-root dd-workbench",children:[f?o(yl,{projectId:t==="project"?e:null,showProjects:t==="global",projects:h,activeId:a.docId,onSelect:L=>r({docId:L,path:null}),onDeleted:L=>{L===a.docId&&r({docId:null,path:null})},onNew:()=>c({template:null}),onCollapse:()=>u(!1),headerActions:n}):s("nav",{className:"dd-list-collapsed","aria-label":"Design docs",children:[o(_,{icon:Me,label:"Show doc list",onClick:()=>u(!0)}),o(_,{icon:xe,label:"New design doc",onClick:()=>c({template:null})}),n]}),o("main",{className:"dd-main",children:a.docId?o(zt,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(L,I)=>r({docId:a.docId,path:L},I??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):o(Pl,{templates:i.data,onNew:L=>c({template:L??null})})}),l?o(go,{initialTemplate:l.template,defaultProjectId:e,projects:h,onClose:()=>c(null),onCreated:L=>r({docId:L,path:null})}):null]})}var Ra="design-docs";function Ld({children:e}){return o("div",{className:"dd-root",children:e})}function Id({subPath:e}){let a=Ce();return o(ho,{variant:"global",projectId:null,location:Xt(e),onLocationChange:(r,t)=>a.toPluginPanel(Ra,{subPath:ka(r),...t?{replace:t}:{}})})}function Cd({projectId:e,headerActions:a}){let[r,t]=de(`project-location:${e}`,"");return o(ho,{variant:"project",projectId:e,location:Xt(r),onLocationChange:n=>t(ka(n)),headerActions:a})}function vl(e,a,r,t){e.openThreadPanel({actionId:va,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...t?{threadId:t}:{}})||e.toPluginPanel(Ra,{subPath:ka(a)})}function bd({attributes:e,source:a,message:r}){let t=Ce(),n=e.id?.trim()||null,d=e.path?.trim()||null,i=Bt(n);if(!n||i.error)return o("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:n?`Design doc unavailable: ${i.error}`:"Invalid design doc link: an id is required."});let l=i.data;return s("div",{className:"plugin-directive-card dd-card",children:[s("button",{type:"button",className:"plugin-directive-card-main",disabled:!l,onClick:()=>l&&vl(t,{docId:l.id,path:d},l.title,r.threadId),title:l?`Open ${l.title} beside this conversation`:void 0,children:[o("span",{className:"dd-card-icon","aria-hidden":!0,children:o(We,{size:14})}),o("span",{className:"plugin-directive-card-kind",children:"Design doc"}),o("span",{className:"plugin-directive-card-title",children:l?l.title:"Loading\u2026"}),l?s("span",{className:"plugin-directive-card-meta dd-card-meta",children:[d?o("code",{children:d}):null,o(ea,{status:l.status,compact:!0}),l.files.length," file",l.files.length===1?"":"s",l.openComments?` \xB7 ${l.openComments} open comment${l.openComments===1?"":"s"}`:""]}):o(W,{size:12})]}),l?o("button",{type:"button",className:"plugin-directive-card-open",onClick:c=>{c.stopPropagation(),t.toPluginPanel(Ra,{subPath:ka({docId:l.id,path:d})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function wl({projectId:e,onPick:a}){let r=Ft({...e?{projectId:e}:{},status:"active"}),t=Re(),n=ya(),[d,i]=b(!1);return s("div",{className:"dd-picker",children:[s("div",{className:"dd-picker-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",onClick:()=>i(!0),children:[o(xe,{size:13,"aria-hidden":!0})," New"]})]}),o("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(l=>s("button",{type:"button",className:"dd-doc-row",onClick:()=>a(l.id),children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:l.title}),o(ea,{status:l.status,compact:!0})]}),l.summary?o("span",{className:"dd-doc-row-summary",children:l.summary}):null,s("span",{className:"dd-doc-row-meta",children:[s("span",{children:[l.fileCount," files"]}),o("span",{className:"dd-spacer"}),o(se,{at:l.updatedAt,now:n})]})]},l.id)):o(Pe,{icon:We,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):o("div",{className:"dd-center",children:r.error?o("div",{className:"dd-banner dd-banner-error",children:r.error}):o(W,{})})}),d?o(go,{defaultProjectId:e,projects:t.data??[],onClose:()=>i(!1),onCreated:l=>a(l)}):null]})}function Sd(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function yd(e){let{docId:a,path:r}=Sd(e.params);return o(kl,{...e},`${a}\0${r}`)}function kl({params:e,projectId:a}){let r=Ce(),t=Sd(e),[n,d]=b(t),i=!t.docId;if(!n.docId)return o(Ld,{children:o(wl,{projectId:a??null,onPick:c=>d({docId:c,path:null})})});let l=n.docId;return o(Ld,{children:o(zt,{docId:l,path:n.path,layout:"compact",contextProjectId:a??null,onOpenPath:c=>d({docId:l,path:c}),onDeleted:()=>d({docId:null,path:null}),headerExtra:s(j,{children:[i?o(_,{icon:la,label:"All design docs",onClick:()=>d({docId:null,path:null})}):null,o(_,{icon:He,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(Ra,{subPath:ka(n)})})]})},l)})}async function Pd({threadId:e,message:a,selectedText:r,openPanel:t}){let n=(r?.trim()||a.text).trim();if(!n){F("This message has no text to save.","error");return}try{let d=await Co(Qr,"createFromMessage",{threadId:e,text:n});t({actionId:va,title:d.title,params:{docId:d.id}}),F(`Saved \u201C${d.title}\u201D as a design doc`)}catch(d){F(`Could not save the design doc: ${H(d)}`,"error")}}var xo=`
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
`;var vd="design-docs-plugin-styles";function Al(){if(typeof document>"u")return;let e=document.getElementById(vd);if(e instanceof HTMLStyleElement){e.textContent=xo;return}let a=document.createElement("style");a.id=vd,a.textContent=xo,document.head.appendChild(a)}Al();var Qh=bo(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:Ra,component:Id}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:Cd}),e.slots.messageDirective({id:"design-doc",component:bd}),e.slots.threadPanelAction({id:va,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:yd}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:Pd})});export{Qh as default,Al as injectStyles};
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
lucide-react/dist/esm/icons/panel-left-close.mjs:
lucide-react/dist/esm/icons/panel-left-open.mjs:
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
