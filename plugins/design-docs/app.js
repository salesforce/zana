function gd(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function vt(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function mo(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function go(e,a,r){return gd().callRpc(e,a,r)}function ho(e){return{__zccPluginApp:!0,setup:e}}function xo(){return vt().useRpc?.()??mo("useRpc")}function Lo(e,a){vt().useRealtime?.(e,a)}function Oe(){return vt().useZccNavigate?.()??mo("useZccNavigate")}function hd(){return globalThis.__ZCC_HOST_REACT__}function Io(e,a){let r=hd(),t=vt()[e];return!r||!t?null:r.createElement(t,a)}function Co(e){return Io("ThreadChat",e)}function Na(e){return Io("Markdown",e)}var G=globalThis.__ZCC_HOST_REACT__;var Sl=G.Children,yl=G.Component,Pl=G.Fragment,vl=G.StrictMode,wl=G.Suspense,kl=G.cloneElement,bo=G.createContext,Ia=G.createElement,Al=G.createRef,wt=G.forwardRef,Dl=G.isValidElement,Tl=G.lazy,Ml=G.memo,Rl=G.startTransition,ke=G.useCallback,So=G.useContext,Fl=G.useDebugValue,yo=G.useDeferredValue,O=G.useEffect,Po=G.useId,Bl=G.useImperativeHandle,Nl=G.useInsertionEffect,Ca=G.useLayoutEffect,W=G.useMemo,El=G.useReducer,T=G.useRef,S=G.useState,vo=G.useSyncExternalStore,Ol=G.useTransition,ql=G.version;var wo=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function ko(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:wo(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var Ao=e=>{let a="",r=!1;for(let t of e){if(t==="-"||t==="_"||t<=" "){r=a.length>0;continue}a.length===0?a+=t.toLowerCase():a+=r?t.toUpperCase():t,r=!1}return a};var Do=e=>{let a=Ao(e);return a.charAt(0).toUpperCase()+a.slice(1)};var Ea=(...e)=>e.filter((a,r,t)=>!!a&&a.trim()!==""&&t.indexOf(a)===r).join(" ").trim();var Ve={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function _t(e){return e!=null}function To(e,a={}){let r=a.attributeNames??{},t=h=>r[h]??h,n=e.size??e.width??Ve.width,d=e.size??e.height??Ve.height,i=e.aliases?.filter(h=>typeof h=="string"&&h.trim()!=="").map(h=>`lucide-${h}`)??[],l=[...e.name?[`lucide-${e.name}`]:[],...i],c=a.className?.split(" ").filter(Boolean)??[],f=a.includeDefaultClasses===!1?Ea(...c):Ea("lucide",...l,...c),u=a.absoluteStrokeWidth?Number(a.strokeWidth??Ve["stroke-width"])*Number(e.size??e.width??Ve.width)/Number(a.size??a.width??Ve.width):a.strokeWidth??Ve["stroke-width"];return["svg",{...Object.entries(Ve).reduce((h,[I,x])=>(h[t(I)]=x,h),{}),..."color"in a&&a.color&&{[t("stroke")]:a.color},..."size"in a&&_t(a.size)&&{[t("width")]:a.size,[t("height")]:a.size},..."width"in a&&_t(a.width)&&{[t("width")]:a.width},..."height"in a&&_t(a.height)&&{[t("height")]:a.height},[t("stroke-width")]:u,...f&&{[t("class")]:f},[t("viewBox")]:`0 0 ${n} ${d}`,...a.hasA11yProp===!1?{[t("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(h=>{let[I,x,L]=h,k=a.nonScalingStroke?{[t("vector-effect")]:"non-scaling-stroke",...x}:x;return L?[I,k,L]:[I,k]})]}function Mo(e,a={}){return To(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var Ro=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var xd=bo({});var Fo=()=>So(xd);var Bo=wt(({color:e,size:a,width:r,height:t,strokeWidth:n,absoluteStrokeWidth:d,nonScalingStroke:i,className:l="",children:c,iconNode:f=[],icon:u={node:f,aliases:[],size:24},...p},h)=>{let{size:I=24,strokeWidth:x=2,absoluteStrokeWidth:L=!1,nonScalingStroke:k=!1,color:R="currentColor",className:A=""}=Fo()??{},N=!!c||Ro(p),[v,H,w=[]]=Mo(u,{color:e??R,width:r??a??I,height:t??a??I,strokeWidth:n??x,absoluteStrokeWidth:d??L,nonScalingStroke:i??k,className:Ea(A,l),hasA11yProp:N,attributes:p});return Ia(v,{ref:h,...H},[...w.map(([F,m])=>Ia(F,m)),...Array.isArray(c)?c:[c]])});function g(e,a=[],r=[]){let t=typeof e=="string"?ko(e,a,r):e,n=wt(({className:d,...i},l)=>Ia(Bo,{ref:l,icon:t,className:d,...i}));return t.name&&(n.displayName=Do(t.name)),n}var No={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};No.node;var Oa=g(No);var Eo={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};Eo.node;var qa=g(Eo);var Oo={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};Oo.node;var sa=g(Oo);var qo={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};qo.node;var Ha=g(qo);var Ho={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};Ho.node;var ue=g(Ho);var _o={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};_o.node;var _a=g(_o);var Uo={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};Uo.node;var qe=g(Uo);var zo={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};zo.node;var he=g(zo);var Go={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};Go.node;var la=g(Go);var jo={name:"circle-dot",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]};jo.node;var Ua=g(jo);var Vo={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};Vo.node;var $e=g(Vo);var $o={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};$o.node;var za=g($o);var Wo={name:"corner-down-right",size:24,node:[["path",{d:"m15 10 5 5-5 5",key:"qqa56n"}],["path",{d:"M4 4v7a4 4 0 0 0 4 4h12",key:"z08zvw"}]]};Wo.node;var Ga=g(Wo);var Xo={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};Xo.node;var We=g(Xo);var Ko={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};Ko.node;var ja=g(Ko);var Zo={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};Zo.node;var Ae=g(Zo);var Qo={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};Qo.node;var He=g(Qo);var Jo={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};Jo.node;var Va=g(Jo);var Yo={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};Yo.node;var $a=g(Yo);var er={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};er.node;var be=g(er);var ar={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};ar.node;var Wa=g(ar);var tr={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};tr.node;var Xe=g(tr);var or={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};or.node;var De=g(or);var rr={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};rr.node;var ia=g(rr);var nr={name:"file-type",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M11 18h2",key:"12mj7e"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"M9 13v-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v.5",key:"qbrxap"}]]};nr.node;var Xa=g(nr);var dr={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};dr.node;var Ke=g(dr);var sr={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};sr.node;var Ka=g(sr);var lr={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};lr.node;var _e=g(lr);var ir={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};ir.node;var Za=g(ir);var ur={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};ur.node;var Qa=g(ur);var cr={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};cr.node;var ua=g(cr);var fr={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};fr.node;var Ze=g(fr);var pr={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};pr.node;var Ja=g(pr);var mr={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};mr.node;var Qe=g(mr);var gr={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};gr.node;var ca=g(gr);var hr={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};hr.node;var Ya=g(hr);var xr={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};xr.node;var Te=g(xr);var Lr={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};Lr.node;var et=g(Lr);var Ir={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};Ir.node;var at=g(Ir);var Cr={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};Cr.node;var Me=g(Cr);var br={name:"panel-left-open",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m14 9 3 3-3 3",key:"8010ee"}]],aliases:["sidebar-open"]};br.node;var Re=g(br);var Sr={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};Sr.node;var tt=g(Sr);var yr={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};yr.node;var fa=g(yr);var Pr={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};Pr.node;var Ie=g(Pr);var vr={name:"reply",size:24,node:[["path",{d:"M20 18v-2a4 4 0 0 0-4-4H4",key:"5vmcpk"}],["path",{d:"m9 17-5-5 5-5",key:"nvlc11"}]]};vr.node;var ot=g(vr);var wr={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};wr.node;var Se=g(wr);var kr={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};kr.node;var Ue=g(kr);var Ar={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};Ar.node;var rt=g(Ar);var Dr={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};Dr.node;var nt=g(Dr);var Tr={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Tr.node;var pa=g(Tr);var Mr={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};Mr.node;var dt=g(Mr);var Rr={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};Rr.node;var ae=g(Rr);var Fr={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};Fr.node;var st=g(Fr);var Br={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};Br.node;var lt=g(Br);var Nr={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};Nr.node;var xe=g(Nr);var Er={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};Er.node;var ye=g(Er);var Or={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};Or.node;var it=g(Or);var qr={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};qr.node;var ut=g(qr);var Hr={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};Hr.node;var Je=g(Hr);var _r={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};_r.node;var ct=g(_r);var Ur={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};Ur.node;var re=g(Ur);var zr=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];var kt=4e3;function Ld(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function Id(e){let a=(t,n)=>e(t,n===void 0?void 0:Ld(n)),r=async t=>{await t};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(t={})=>a("list",t),get:t=>a("get",{doc:t}),create:t=>a("create",t),update:(t,n)=>a("update",{doc:t,...n}),remove:t=>r(a("remove",{doc:t})),readFile:(t,n)=>a("readFile",{doc:t,path:n}),renderPage:(t,n)=>a("renderPage",{doc:t,...n}),readPageFile:(t,n)=>a("readPageFile",{doc:t,path:n}),pageLink:(t,n)=>a("pageLink",{doc:t,path:n}),siteFiles:t=>a("siteFiles",{doc:t}),reportRender:(t,n)=>r(a("reportRender",{doc:t,...n})),writeFile:(t,n)=>a("writeFile",{doc:t,...n}),editFile:(t,n)=>a("editFile",{doc:t,...n}),deleteFile:(t,n)=>r(a("deleteFile",{doc:t,path:n})),renameFile:(t,n,d)=>a("renameFile",{doc:t,from:n,to:d}),history:(t,n={})=>a("history",{doc:t,...n}),revision:(t,n)=>a("revision",{doc:t,id:n}),restore:(t,n,d)=>a("restore",{doc:t,id:n,baseRevision:d}),addComment:(t,n)=>a("addComment",{doc:t,...n}),replyToComment:(t,n,d)=>a("replyToComment",{doc:t,id:n,body:d}),setCommentStatus:(t,n,d)=>a("setCommentStatus",{doc:t,id:n,status:d}),deleteComment:(t,n)=>r(a("deleteComment",{doc:t,id:n})),unlinkThread:(t,n)=>r(a("unlinkThread",{doc:t,threadId:n})),askAgent:(t,n)=>a("askAgent",{doc:t,...n,path:n.path??void 0})}}function j(){let e=xo();return W(()=>Id((a,r)=>e.call(a,r)),[e])}function U(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function Gr(e){return/changed since revision/i.test(U(e))}function jr(e){return/^design doc .* not found/i.test(e)}function B(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var Vr="design-docs";var $r="changed",At=["draft","review","approved","implemented","archived"],Dt={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function Wr(e,a){let r=t=>t.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Ye(e,a){let[r,t]=S({key:e,data:null,error:null,loading:e!==null}),[n,d]=S(0),i=T(a);i.current=a,O(()=>{if(e===null){t({key:e,data:null,error:null,loading:!1});return}let f=!1;return t(u=>({key:e,data:u.key===e?u.data:null,error:null,loading:!0})),i.current().then(u=>{f||t({key:e,data:u,error:null,loading:!1})},u=>{f||t(p=>({key:e,data:p.key===e?p.data:null,error:U(u),loading:!1}))}),()=>{f=!0}},[e,n]);let l=ke(()=>d(f=>f+1),[]),c=r.key===e;return{data:c?r.data:null,error:c?r.error:null,loading:c?r.loading:e!==null,reload:l}}function Kr(e,a=120){let r=T(e);r.current=e;let t=T(new Set),n=T(null);O(()=>()=>{n.current&&clearTimeout(n.current)},[]),Lo($r,d=>{let i=typeof d?.docId=="string"?d.docId:null;t.current.add(i),!n.current&&(n.current=setTimeout(()=>{n.current=null;let l=[...t.current];t.current.clear();for(let c of l)r.current(c)},a))})}function Tt(e){let a=j(),r=Ye(JSON.stringify(e),()=>a.list(e));return Kr(()=>r.reload()),r}function Mt(e){let a=j(),r=Ye(e,()=>a.get(e));return Kr(t=>{(t===null||t===e)&&r.reload()}),r}function Zr(e,a,r){let t=j(),n=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Ye(n,()=>t.readFile(e,a))}function Ut(){let e=j();return Ye("templates",()=>e.templates())}function ea(){let e=j();return Ye("projects",()=>e.projects())}var Xr="zcc.design-docs.";function le(e,a){let[r,t]=S(()=>{try{let d=globalThis.localStorage?.getItem(Xr+e);if(d==null)return a;let i=JSON.parse(d);return typeof i==typeof a?i:a}catch{return a}}),n=ke(d=>{t(d);try{globalThis.localStorage?.setItem(Xr+e,JSON.stringify(d))}catch{}},[e]);return[r,n]}function Qr(e){let[a,r]=S(null),[t,n]=S(null);return Ca(()=>{if(!a)return;let d=l=>n(l>0?e.filter(c=>l>=c).length:null);if(d(a.getBoundingClientRect().width),typeof ResizeObserver>"u")return;let i=new ResizeObserver(l=>d(l[0]?.contentRect.width??0));return i.observe(a),()=>i.disconnect()},[a,e]),[r,t]}function ba(e=6e4){let[a,r]=S(()=>Date.now());return O(()=>{let t=setInterval(()=>r(Date.now()),e);return()=>clearInterval(t)},[e]),a}var Cd=Symbol.for("react.portal");function bd(e,a){return{$$typeof:Cd,key:null,children:e,containerInfo:a,implementation:null}}function zt(e){return typeof document>"u"?e:bd(e,document.body)}function ma(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function Jr(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let t=Math.round(r/60);if(t<60)return`${t}m ago`;let n=Math.round(t/60);if(n<24)return`${n}h ago`;let d=Math.round(n/24);return d<30?`${d}d ago`:new Date(e).toISOString().slice(0,10)}var Yr=globalThis.__ZCC_HOST_REACT__,X=Yr.Fragment;function o(e,a,r){return Yr.createElement(e,r===void 0?a:{...a,key:r})}var s=o;var Sd={MessageSquareText:Ya,CheckCheck:_a,WandSparkles:Je,Workflow:ct,ScanSearch:nt,ListChecks:Ja};function en(e){return Sd[e]??ae}function Sa({kind:e,size:a=14}){return o(e==="image"||e==="svg"?Wa:e==="font"?Xa:e==="markdown"||e==="text"?ia:$a,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function aa({status:e,compact:a=!1}){return s("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[o("span",{className:"dd-status-dot","aria-hidden":!0}),Dt[e]]})}function Ce({actor:e}){let a=e.kind==="agent"?ue:ut;return s("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[o(a,{size:12,"aria-hidden":!0}),o("span",{className:"dd-actor-label",children:e.label})]})}function ie({at:e,now:a}){return o("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:Jr(e,a)})}function Q({size:e=14,label:a}){return o("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:o(Qe,{size:e,className:"dd-spin","aria-hidden":!0})})}function Pe({icon:e,title:a,children:r}){return s("div",{className:"dd-empty",children:[o("span",{className:"dd-empty-icon",children:o(e,{size:22,"aria-hidden":!0})}),o("div",{className:"dd-empty-title",children:a}),r?o("div",{className:"dd-empty-body",children:r}):null]})}function _({icon:e,label:a,onClick:r,active:t=!1,danger:n=!1,disabled:d=!1,size:i=14}){return o("button",{type:"button",className:`icon-btn dd-icon-btn${t?" on":""}${n?" danger":""}`,title:a,"aria-label":a,"aria-pressed":t||void 0,disabled:d,onClick:r,children:o(e,{size:i,"aria-hidden":!0})})}function an(e,a){let r=T(null),t=T(a);return t.current=a,O(()=>{if(!e)return;let n=i=>{r.current&&i.target instanceof Node&&!r.current.contains(i.target)&&t.current()},d=i=>{i.key==="Escape"&&t.current()};return document.addEventListener("mousedown",n),document.addEventListener("keydown",d),()=>{document.removeEventListener("mousedown",n),document.removeEventListener("keydown",d)}},[e]),r}function ve({open:e,onClose:a,anchor:r,children:t,align:n="end",className:d=""}){let i=an(e,a);return s("div",{className:"dd-pop-anchor",ref:i,children:[r,e?o("div",{className:`dd-pop dd-pop-${n} ${d}`,role:"dialog",children:t}):null]})}function tn(e){if(e.clientX||e.clientY)return{x:e.clientX,y:e.clientY};let a=e.currentTarget.getBoundingClientRect();return{x:a.left+12,y:a.bottom}}var Rt=4;function on({at:e,label:a,onClose:r,children:t}){let n=an(!0,r),d=T(r);d.current=r;let[i,l]=S(e);Ca(()=>{let f=n.current,{width:u,height:p}=f.getBoundingClientRect();l({x:Math.max(Rt,Math.min(e.x,window.innerWidth-u-Rt)),y:Math.max(Rt,Math.min(e.y,window.innerHeight-p-Rt))})},[n,e.x,e.y]),O(()=>{let f=document.activeElement instanceof HTMLElement?document.activeElement:null;n.current?.querySelector('[role="menuitem"]')?.focus();let u=p=>{p.target instanceof Node&&n.current?.contains(p.target)||d.current()};return window.addEventListener("scroll",u,!0),window.addEventListener("resize",u),window.addEventListener("blur",u),()=>{window.removeEventListener("scroll",u,!0),window.removeEventListener("resize",u),window.removeEventListener("blur",u),f?.isConnected&&(document.activeElement===document.body||n.current?.contains(document.activeElement))&&f.focus()}},[n]);let c=f=>{let u=[...f.currentTarget.querySelectorAll('[role="menuitem"]')],p=u.indexOf(document.activeElement),h=f.key==="ArrowDown"?(p+1)%u.length:f.key==="ArrowUp"?(p-1+u.length)%u.length:f.key==="Home"?0:f.key==="End"?u.length-1:-1;f.key==="Tab"&&r(),!(h<0||!u.length)&&(f.preventDefault(),u[h].focus())};return zt(o("div",{ref:n,className:"dd-pop dd-menu dd-context-menu",role:"menu","aria-label":a,style:{left:i.x,top:i.y},onKeyDown:c,onContextMenu:f=>f.preventDefault(),children:t}))}function fe({icon:e,label:a,hint:r,onSelect:t,danger:n=!1,checked:d=!1}){return s("button",{type:"button",role:"menuitem",className:`dd-menu-item${n?" dd-menu-danger":""}${d?" dd-menu-checked":""}`,onClick:t,children:[e?o(e,{size:14,"aria-hidden":!0}):null,o("span",{className:"dd-menu-label",children:a}),r?o("span",{className:"dd-menu-hint",children:r}):null]})}function Fe({request:e,onClose:a}){let[r,t]=S(!1),n=async()=>{t(!0);try{await e.run()}finally{t(!1),a()}};return o(ft,{title:e.title,onClose:a,footer:s(X,{children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{n()},autoFocus:!0,children:e.confirmLabel})]}),children:o("div",{className:"dd-confirm-body",children:e.body})})}function ft({title:e,onClose:a,children:r,footer:t,wide:n=!1}){return O(()=>{let d=i=>{i.key==="Escape"&&a()};return document.addEventListener("keydown",d),()=>document.removeEventListener("keydown",d)},[a]),zt(o("div",{className:"dd-dialog-backdrop",onMouseDown:d=>{d.target===d.currentTarget&&a()},children:s("div",{className:`dd-dialog${n?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[s("div",{className:"dd-dialog-header",children:[o("span",{className:"dd-dialog-title",children:e}),o(_,{icon:re,label:"Close",onClick:a})]}),o("div",{className:"dd-dialog-body",children:r}),t?o("div",{className:"dd-dialog-footer",children:t}):null]})}))}var rn={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},ta="design-doc";function nn({doc:e,now:a,chatThreadId:r=null,onOpenChat:t}){let n=j(),d=Oe(),i=[...e.threads].sort((c,f)=>f.lastActivityAt-c.lastActivityAt),l=t?i.find(c=>c.threadId===r):void 0;return l&&t?s("div",{className:"dd-rail-pane dd-agents dd-agent-chat",children:[s("div",{className:"dd-agent-chat-head",children:[o(_,{icon:sa,label:"All agents",size:13,onClick:()=>t(null)}),o("span",{className:"dd-agent-chat-title",title:l.title,children:l.title}),o("span",{className:`dd-role dd-role-${l.role}`,children:rn[l.role]}),o(_,{icon:He,label:"Open full thread",size:13,onClick:()=>d.toThread(l.threadId)})]}),o(Co,{threadId:l.threadId,variant:"compact",layout:"contained",className:"dd-agent-chat-body"})]}):o("div",{className:"dd-rail-pane dd-agents",children:s("div",{className:"dd-rail-scroll",children:[i.length?o("ul",{className:"dd-thread-list",children:i.map(c=>s("li",{className:"dd-thread",children:[s("button",{type:"button",className:"dd-thread-open",onClick:()=>t?t(c.threadId):d.toThread(c.threadId),title:t?"Open chat beside the doc":"Open thread",children:[o(ue,{size:14,"aria-hidden":!0}),s("span",{className:"dd-thread-main",children:[o("span",{className:"dd-thread-title",children:c.title}),s("span",{className:"dd-thread-meta",children:[o("span",{className:`dd-role dd-role-${c.role}`,children:rn[c.role]}),o(ie,{at:c.lastActivityAt,now:a})]})]})]}),o(_,{icon:it,label:"Unlink thread",size:13,onClick:()=>{n.unlinkThread(e.id,c.threadId).catch(f=>B(`Could not unlink: ${U(f)}`,"error"))}})]},c.threadId))}):s(Pe,{icon:ue,title:"No agents yet",children:["Use ",o("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),s("div",{className:"dd-agents-hint",children:[o(Ha,{size:13,"aria-hidden":!0}),s("span",{children:["Agents in this project already know this doc exists. Type ",o("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",o("code",{children:"design_doc_read"}),"."]})]})]})})}function dn({doc:e,activePath:a,request:r,contextProjectId:t,compact:n=!1}){let d=j(),i=Oe(),[l,c]=S(!1),[f,u]=S(""),[p,h]=S(!1),[I,x]=S(t??""),[L,k]=S(null),R=ea(),A=T(null),N=!e.projectId,v=R.data??[],H=N?I||v[0]?.id||"":e.projectId;O(()=>{r&&(u(r.prompt),h(!0),c(!0),requestAnimationFrame(()=>{let m=A.current;m&&(m.focus(),m.selectionStart=m.selectionEnd=m.value.length)}))},[r]),O(()=>{l&&h(m=>m||!!a&&a!==e.entryPath)},[l,a,e.entryPath]);let w=async m=>{if(!L){if(N&&!H){B("Add a project first: agents run inside a project.","error");return}k(m??"custom");try{let y=await d.askAgent(e.id,{...m?{action:m}:{},...f.trim()&&!m?{prompt:f.trim()}:{},path:p?a:null,...N?{projectId:H}:{}});i.openThreadPanel({actionId:ta,title:e.title,params:{docId:e.id},threadId:y.threadId}),i.toThread(y.threadId),B(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),c(!1),u("")}catch(y){B(`Could not start the agent: ${U(y)}`,"error")}finally{k(null)}}},F=m=>{m.key==="Enter"&&(m.metaKey||m.ctrlKey)&&(m.preventDefault(),f.trim()&&w(null))};return s(ve,{open:l,onClose:()=>c(!1),className:"dd-ask",anchor:s("button",{type:"button",className:`btn primary dd-ask-trigger${n?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":l,onClick:()=>c(!l),children:[o(ae,{size:13,"aria-hidden":!0}),n?null:"Ask agent",o(he,{size:12,"aria-hidden":!0})]}),children:[s("div",{className:"dd-ask-head",children:[o("span",{className:"dd-ask-title",children:"Ask an agent"}),o("span",{className:"dd-muted",children:"Starts a new thread that edits this doc live"})]}),o("div",{className:"dd-ask-actions",role:"menu",children:zr.map(m=>{let y=en(m.icon);return s("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!L,onClick:()=>{w(m.id)},title:m.description,children:[o("span",{className:"dd-ask-action-icon",children:L===m.id?o(Q,{size:13}):o(y,{size:14,"aria-hidden":!0})}),s("span",{className:"dd-ask-action-text",children:[o("span",{className:"dd-ask-action-label",children:m.label}),o("span",{className:"dd-ask-action-desc",children:m.description})]})]},m.id)})}),s("div",{className:"dd-ask-custom",children:[o("textarea",{ref:A,className:"dd-input",rows:3,maxLength:kt,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:f,onChange:m=>u(m.target.value),onKeyDown:F}),s("div",{className:"dd-ask-options",children:[a?s("label",{className:"dd-check",children:[o("input",{type:"checkbox",checked:p,onChange:m=>h(m.target.checked)}),"Focus on ",o("code",{children:a})]}):null,N?s("label",{className:"dd-field-inline",children:["Run in",s("select",{className:"dd-input dd-select",value:H,onChange:m=>x(m.target.value),children:[v.length?null:o("option",{value:"",children:"No projects"}),v.map(m=>o("option",{value:m.id,children:m.name},m.id))]})]}):null,o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",disabled:!f.trim()||!!L,onClick:()=>{w(null)},children:[L==="custom"?o(Q,{size:12}):null,"Start"]})]})]})]})}var yd=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),Pd=/[A-Za-z][^\t\n\f\r />]*/y,vd=/[\t\n\f\r /]*/y,sn=/[\t\n\f\r ]*/y,wd=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,kd=/[^\t\n\f\r >]*/y,Ad={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function Dd(e){return e.includes("&")?e.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(a,r,t,n)=>{if(n)return Ad[n.toLowerCase()]??a;let d=r?Number(r):parseInt(t,16);return d>0&&d<=1114111?String.fromCodePoint(d):a}):e}function ln(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function ya(e,a,r){return e.lastIndex=r,e.exec(a)?.[0]??""}function Td(e,a){let r=ya(Pd,e,a+1),t=a+1+r.length,n=[];for(;t<e.length;){let d=ya(vd,e,t);if(t+=d.length,t>=e.length)return null;if(e[t]===">")return{name:r.toLowerCase(),attributes:n,selfClosing:d.endsWith("/"),start:a,end:t+1};let i=ya(wd,e,t)||e[t];t+=i.length,t+=ya(sn,e,t).length;let l=null;if(e[t]==="="){t+=1,t+=ya(sn,e,t).length;let c=e[t];if(c==='"'||c==="'"){let f=e.indexOf(c,t+1);if(f<0)return null;l=e.slice(t+1,f),t=f+1}else l=ya(kd,e,t),t+=l.length}n.push({name:i.toLowerCase(),value:l===null?null:Dd(l)})}return null}function*Md(e){let a=0;for(;a<e.length;){let r=e.indexOf("<",a);if(r<0)return;let t=e[r+1]??"";if(e.startsWith("<!--",r)){let d=e.indexOf("-->",r+4);a=d<0?e.length:d+3;continue}if(t==="!"||t==="?"||t==="/"&&/[A-Za-z]/.test(e[r+2]??"")){let d=e.indexOf(">",r+2);a=d<0?e.length:d+1;continue}if(!/[A-Za-z]/.test(t)){a=r+1;continue}let n=Td(e,r);if(!n)return;if(a=n.end,yd.has(n.name)){let d=new RegExp(`</${n.name}(?=[\\t\\n\\f\\r />])`,"ig");d.lastIndex=n.end;let i=d.exec(e),l=i?i.index:e.length,c=i?e.indexOf(">",l):-1,f=c<0?e.length:c+1;yield{...n,content:{start:n.end,end:l,closeEnd:f}},a=f;continue}yield n}}function Ft(e,a){let r=-1;for(let n of Md(e)){if(n.name==="head")return e.slice(0,n.end)+a+e.slice(n.end);if(n.name==="html"){r=n.end;continue}break}if(r>=0)return e.slice(0,r)+a+e.slice(r);let t=e.match(/^\s*<!doctype[^>]*>/i);return t?t[0]+a+e.slice(t[0].length):a+e}function pt(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var Rd={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},Fd={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"};var un={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function ga(e){let a=pt(e),r=Rd[a];return r||(un[a]?"code":"text")}function cn(e){return un[pt(e)]??""}function ze(e){return e==="image"||e==="font"}function fn(e){return Fd[pt(e)]??null}var Bd=/^[a-z][a-z0-9+.-]*:/i;function mt(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||Bd.test(r))return null;let t=r.split(/[?#]/,1)[0],n=t;try{n=decodeURIComponent(t)}catch{}let d=n.startsWith("/")?[]:e.split("/").slice(0,-1);for(let i of n.split("/"))if(!(!i||i===".")){if(i===".."){if(!d.length)return null;d.pop();continue}d.push(i)}return d.length?d.join("/"):null}function pn(e,a){let r=e.split("/"),t=a.split("/"),n=Math.min(r.length,t.length);for(let d=0;d<n;d+=1){let i=d===r.length-1,l=d===t.length-1;if(r[d]!==t[d])return i!==l?i?-1:1:r[d].localeCompare(t[d],void 0,{sensitivity:"base",numeric:!0})}return r.length-t.length}function Gt(e){let a=(e??"").split("/").filter(Boolean),[r,...t]=a;return{docId:r??null,path:t.length?t.join("/"):null}}function Pa(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}function Nd(e){let a=new TextEncoder().encode(e),r="";for(let t=0;t<a.length;t+=32768)r+=String.fromCharCode(...a.subarray(t,t+32768));return btoa(r)}function jt(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${Nd(e.content)}`;let a=fn(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var mn=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;function gn(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function hn(e,a){let r=new Set;for(let t of a.matchAll(mn)){let n=mt(e,gn(t[2]));n&&r.add(n)}return[...r]}function xn(e,a,r){return r.size?a.replace(mn,(t,n,d,i="")=>{let l=mt(e,gn(d)),c=l?r.get(l):void 0;return c?`${n}${c}${i})`:t}):a}function Vt(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(n=>n[0].length)),t="`".repeat(Math.max(3,r+1));return`${t}${a}
${e.replace(/\n$/,"")}
${t}`}function Ln(e,a){return Vt(a,cn(e))}var Ed=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function In(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let n of Ed){let d=r.getPropertyValue(n).trim();d&&(a[n]=d)}let t=r.getPropertyValue("color-scheme").trim();return t&&(a["color-scheme"]=t),a}var Od=/^[^<>{};]*$/;function Cn(e,a){let t=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>Od.test(n)).map(([n,d])=>`${n}: ${d};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`;return Ft(e,t)}function bn(e){let a=[],r=new Map;for(let t of[...e].sort((n,d)=>pn(n.path,d.path))){let n=t.path.split("/"),d=a;for(let i=0;i<n.length-1;i+=1){let l=n.slice(0,i+1).join("/"),c=r.get(l);c||(c={kind:"folder",name:n[i],path:l,children:[]},r.set(l,c),d.push(c)),d=c.children}d.push({kind:"file",name:n.at(-1),path:t.path,file:t})}return a}var yn=e=>e.key==="Enter"&&(e.metaKey||e.ctrlKey);function qd({onSend:e,onCancel:a}){let[r,t]=S(""),[n,d]=S(!1),i=async()=>{let l=r.trim();if(!l||n)return;d(!0);let c=await e(l);d(!1),c&&t("")};return s("div",{className:"dd-reply-composer",children:[o("textarea",{className:"dd-input dd-composer-input",placeholder:"Reply\u2026 agents see the whole thread","aria-label":"Reply",value:r,maxLength:8e3,rows:2,autoFocus:!0,onChange:l=>t(l.target.value),onKeyDown:l=>{yn(l)?(l.preventDefault(),i()):l.key==="Escape"&&(l.preventDefault(),a())}}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send \xB7 Esc to cancel"}),s("span",{className:"dd-reply-buttons",children:[o("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:!r.trim()||n,onClick:()=>{i()},children:"Reply"})]})]})]})}function Hd({comment:e,fileGone:a,now:r,onToggle:t,onDelete:n,onDeleteReply:d,onReply:i,onFocus:l}){let c=e.status==="resolved",[f,u]=S(!1);return s("article",{className:`dd-comment${c?" dd-comment-resolved":""}`,children:[s("header",{className:"dd-comment-head",children:[o(Ce,{actor:e.author}),o(ie,{at:e.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(_,{icon:ot,label:"Reply",onClick:()=>u(!0),size:13}),o(_,{icon:c?Ue:qe,label:c?"Reopen":"Resolve",onClick:t,size:13}),o(_,{icon:xe,label:"Delete comment",onClick:n,danger:!0,size:13})]}),e.path||e.quote?s("button",{type:"button",className:"dd-comment-anchor",onClick:l,disabled:!l,title:a?"This file was deleted":"Show in the document",children:[e.path?s("span",{className:`dd-comment-path${a?" dd-comment-path-gone":""}`,children:[e.path,a?" (deleted)":""]}):null,e.quote?o("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,o("div",{className:"dd-comment-body",children:o(Na,{content:e.body})}),e.replies.length?o("ol",{className:"dd-replies","aria-label":"Replies",children:e.replies.map(p=>s("li",{className:"dd-reply",children:[s("header",{className:"dd-comment-head",children:[o(Ce,{actor:p.author}),o(ie,{at:p.createdAt,now:r}),o("span",{className:"dd-spacer"}),o(_,{icon:xe,label:"Delete reply",onClick:()=>d(p.id),danger:!0,size:12})]}),o("div",{className:"dd-comment-body",children:o(Na,{content:p.body})})]},p.id))}):null,f?o(qd,{onCancel:()=>u(!1),onSend:async p=>{let h=await i(p);return h&&u(!1),h}}):null]})}function Pn({doc:e,activePath:a,now:r,pendingQuote:t,onClearQuote:n,draft:d,onDraft:i,onFocusComment:l}){let c=j(),[f,u]=le("comments-scope","all"),[p,h]=S(!1),[I,x]=S(!1),[L,k]=S(null),R=T(null);O(()=>{t&&R.current?.focus()},[t]);let A=W(()=>e.comments.filter(C=>f==="all"||!C.path||C.path===a),[e.comments,f,a]),N=A.filter(C=>C.status==="open"),v=A.filter(C=>C.status==="resolved"),H=async(C,q)=>{try{return await C(),!0}catch($){return B(`${q}: ${U($)}`,"error"),!1}},w=t?t.path:a,F=async()=>{let C=d.trim();if(!(!C||I)){x(!0);try{await c.addComment(e.id,{body:C,...w?{path:w}:{},...t?{quote:t.text}:{}}),i(""),n()}catch(q){B(`Could not add the comment: ${U(q)}`,"error")}finally{x(!1)}}},m=C=>{yn(C)&&(C.preventDefault(),F())},y=W(()=>new Set(e.files.map(C=>C.path)),[e.files]),P=C=>{let q=!!C.path&&!y.has(C.path);return o(Hd,{comment:C,fileGone:q,now:r,onToggle:()=>{H(()=>c.setCommentStatus(e.id,C.id,C.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>k({title:"Delete comment",body:C.replies.length?`Delete this comment and its ${C.replies.length===1?"reply":`${C.replies.length} replies`}? This cannot be undone.`:"Delete this comment? This cannot be undone.",confirmLabel:"Delete",danger:!0,run:()=>{H(()=>c.deleteComment(e.id,C.id),"Could not delete the comment")}}),onDeleteReply:$=>{H(()=>c.deleteComment(e.id,$),"Could not delete the reply")},onReply:$=>H(()=>c.replyToComment(e.id,C.id,$),"Could not reply"),onFocus:!q&&(C.quote||C.path)?()=>l(C):void 0},C.id)};return s("div",{className:"dd-rail-pane dd-comments",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[o("button",{type:"button",className:f==="all"?"on":"",onClick:()=>u("all"),children:"All files"}),o("button",{type:"button",className:f==="file"?"on":"",onClick:()=>u("file"),disabled:!a,children:"This file"})]})}),s("div",{className:"dd-rail-scroll",children:[N.length===0?o(Pe,{icon:Te,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):N.map(P),v.length?s("div",{className:"dd-resolved",children:[s("button",{type:"button",className:"dd-disclosure",onClick:()=>h(!p),children:[p?o(he,{size:13,"aria-hidden":!0}):o(la,{size:13,"aria-hidden":!0}),"Resolved (",v.length,")"]}),p?v.map(P):null]}):null]}),s("div",{className:"dd-composer",children:[t?s("div",{className:"dd-composer-quote",children:[o("span",{className:"dd-comment-quote",children:t.text}),o(_,{icon:re,label:"Remove quote",onClick:n,size:12})]}):null,o("textarea",{ref:R,className:"dd-input dd-composer-input",placeholder:w?`Comment on ${w}\u2026 agents see open comments`:"Leave a comment\u2026",value:d,maxLength:8e3,rows:3,onChange:C=>i(C.target.value),onKeyDown:m}),s("div",{className:"dd-composer-actions",children:[o("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),o("button",{type:"button",className:"btn primary",disabled:!d.trim()||I,onClick:()=>{F()},children:"Comment"})]})]}),L?o(Fe,{request:L,onClose:()=>k(null)}):null]})}var _d=(()=>{let e=new Uint32Array(256);for(let a=0;a<256;a+=1){let r=a;for(let t=0;t<8;t+=1)r=r&1?3988292384^r>>>1:r>>>1;e[a]=r>>>0}return e})();function Ud(e){let a=4294967295;for(let r of e)a=_d[(a^r)&255]^a>>>8;return(a^4294967295)>>>0}function zd(e){let a=Math.max(e.getFullYear(),1980);return{time:e.getHours()<<11|e.getMinutes()<<5|Math.floor(e.getSeconds()/2),date:a-1980<<9|e.getMonth()+1<<5|e.getDate()}}var vn=2048,$t=20;function wn(e,a=new Date){let r=new TextEncoder,{time:t,date:n}=zd(a),d=[],i=[],l=0;for(let I of e){let x=r.encode(I.path),L=Ud(I.data),k=I.data.length,R=new Uint8Array(30+x.length),A=new DataView(R.buffer);A.setUint32(0,67324752,!0),A.setUint16(4,$t,!0),A.setUint16(6,vn,!0),A.setUint16(8,0,!0),A.setUint16(10,t,!0),A.setUint16(12,n,!0),A.setUint32(14,L,!0),A.setUint32(18,k,!0),A.setUint32(22,k,!0),A.setUint16(26,x.length,!0),A.setUint16(28,0,!0),R.set(x,30),d.push(R,I.data);let N=new Uint8Array(46+x.length),v=new DataView(N.buffer);v.setUint32(0,33639248,!0),v.setUint16(4,$t,!0),v.setUint16(6,$t,!0),v.setUint16(8,vn,!0),v.setUint16(10,0,!0),v.setUint16(12,t,!0),v.setUint16(14,n,!0),v.setUint32(16,L,!0),v.setUint32(20,k,!0),v.setUint32(24,k,!0),v.setUint16(28,x.length,!0),v.setUint32(42,l,!0),N.set(x,46),i.push(N),l+=R.length+k}let c=i.reduce((I,x)=>I+x.length,0),f=new Uint8Array(22),u=new DataView(f.buffer);u.setUint32(0,101010256,!0),u.setUint16(8,e.length,!0),u.setUint16(10,e.length,!0),u.setUint32(12,c,!0),u.setUint32(16,l,!0);let p=new Uint8Array(l+c+f.length),h=0;for(let I of[...d,...i,f])p.set(I,h),h+=I.length;return p}function Gd(e){if(e.encoding==="utf8")return new TextEncoder().encode(e.content);let a=atob(e.content),r=new Uint8Array(a.length);for(let t=0;t<a.length;t+=1)r[t]=a.charCodeAt(t);return r}function kn(e,a,r){return wn(a.map(t=>({path:`${e}/${t.path}`,data:Gd(t)})),r)}var jd=3e4;function An(e,a,r){let t=URL.createObjectURL(new Blob([a],{type:r})),n=document.createElement("a");n.href=t,n.download=e,n.style.display="none",document.body.append(n),n.click(),n.remove(),setTimeout(()=>URL.revokeObjectURL(t),jd)}function Vd({doc:e,projects:a,onClose:r,onMove:t}){let[n,d]=S(e.projectId??"");return s(ft,{title:"Move design doc",onClose:r,footer:s(X,{children:[o("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),o("button",{type:"button",className:"btn primary",disabled:n===(e.projectId??""),onClick:()=>{t(n||null).then(r)},children:"Move"})]}),children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:n,onChange:i=>d(i.target.value),children:[o("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(i=>o("option",{value:i.id,children:i.name},i.id))]})]}),o("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}async function Dn(e,a){try{await navigator.clipboard.writeText(e),B(`Copied ${a}`)}catch{B(`Could not copy ${a}`,"error")}}function Bt(e){let a=j(),[r,t]=S(null),[n,d]=S(null),i=async(u,p)=>{try{await a.update(u.id,p)}catch(h){B(`Could not update the doc: ${U(h)}`,"error")}},l=async u=>{try{let p=await a.siteFiles(u.id);An(`${p.slug}.zip`,kn(p.slug,p.files),"application/zip")}catch(p){B(`Could not download the doc: ${U(p)}`,"error")}};return{items:(u,p,h,I)=>{let x=u.status==="archived",L=k=>()=>{p(),k()};return s(X,{children:[I?o(fe,{icon:_e,label:"Open",onSelect:L(I)}):null,o(fe,{icon:za,label:"Copy chat reference",hint:"Paste into any thread",onSelect:L(()=>{Dn(Wr(u.id),"reference")})}),o(fe,{icon:ua,label:"Copy id",hint:u.slug,onSelect:L(()=>{Dn(u.id,"id")})}),o(fe,{icon:ja,label:"Download .zip",hint:`${u.slug}.zip`,onSelect:L(()=>{l(u)})}),o(fe,{icon:Ka,label:"Move to project\u2026",onSelect:L(()=>t(u))}),o(fe,{icon:x?Oa:qa,label:x?"Unarchive":"Archive",onSelect:L(()=>{i(u,{status:x?"draft":"archived"})})}),o(fe,{icon:xe,label:"Delete\u2026",danger:!0,onSelect:L(()=>d({title:"Delete design doc",body:s(X,{children:["Delete ",o("strong",{children:u.title})," with its ",u.fileCount," file",u.fileCount===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await a.remove(u.id),B(`Deleted \u201C${u.title}\u201D`),h()}catch(k){B(`Could not delete: ${U(k)}`,"error")}}}))})]})},dialogs:s(X,{children:[r?o(Vd,{doc:r,projects:e,onClose:()=>t(null),onMove:u=>i(r,{projectId:u})}):null,n?o(Fe,{request:n,onClose:()=>d(null)}):null]})}}function Mn({value:e,placeholder:a,maxLength:r,multiline:t=!1,className:n="",label:d,onSave:i}){let[l,c]=S(!1),[f,u]=S(e),p=T(!1);O(()=>{l||u(e)},[e,l]);let h=async x=>{if(p.current)return;p.current=!0,c(!1);let L=f.trim();if(x&&L!==e.trim())try{await i(L)}catch{u(e)}else u(e)},I=x=>{x.key==="Escape"?(x.preventDefault(),h(!1)):x.key==="Enter"&&(!t||x.metaKey||x.ctrlKey||!x.shiftKey)&&(x.preventDefault(),h(!0))};if(l){let x={className:`dd-editable-input ${n}`,value:f,maxLength:r,"aria-label":d,autoFocus:!0,onChange:L=>u(L.target.value),onKeyDown:I,onBlur:()=>{h(!0)}};return t?o("textarea",{...x,rows:2,placeholder:a}):o("input",{...x,placeholder:a})}return o("button",{type:"button",className:`dd-editable ${n}${e?"":" dd-editable-empty"}`,title:`Edit ${d.toLowerCase()}`,onClick:()=>{p.current=!1,c(!0)},children:e||a})}function Wd({tags:e,onChange:a}){let[r,t]=S(!1),[n,d]=S(""),i=()=>{let l=n.split(",").map(f=>f.trim().toLowerCase().slice(0,32)).filter(Boolean);d(""),t(!1);let c=[...new Set([...e,...l])].slice(0,12);c.length!==e.length&&a(c)};return s("span",{className:"dd-tags",children:[e.map(l=>s("span",{className:"dd-tag",children:[o(ua,{size:10,"aria-hidden":!0}),l,o("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${l}`,onClick:()=>a(e.filter(c=>c!==l)),children:o(re,{size:10,"aria-hidden":!0})})]},l)),r?o("input",{className:"dd-input dd-tag-input",value:n,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:l=>d(l.target.value),onBlur:i,onKeyDown:l=>{l.key==="Enter"?(l.preventDefault(),i()):l.key==="Escape"&&(d(""),t(!1))}}):e.length<12?s("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>t(!0),children:[o(Ie,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function Xd({status:e,onChange:a}){let[r,t]=S(!1);return o(ve,{open:r,onClose:()=>t(!1),align:"start",className:"dd-menu",anchor:o("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>t(!r),title:"Change status",children:o(aa,{status:e})}),children:At.map(n=>o(fe,{label:o(aa,{status:n}),checked:n===e,icon:n===e?qe:void 0,onSelect:()=>{t(!1),n!==e&&a(n)}},n))})}function Rn({doc:e,projects:a,compact:r,actions:t,onDeleted:n}){let d=j(),[i,l]=S(!1),c=Bt(a),f=e.projectId?a.find(p=>p.id===e.projectId):null,u=async p=>{try{await d.update(e.id,p)}catch(h){throw B(`Could not update the doc: ${U(h)}`,"error"),h}};return s("header",{className:`dd-doc-header${r?" dd-doc-header-compact":""}`,children:[s("div",{className:"dd-doc-title-row",children:[o(Mn,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:p=>p?u({title:p}):void 0}),o("span",{className:"dd-spacer"}),t,o(ve,{open:i,onClose:()=>l(!1),className:"dd-menu",anchor:o(_,{icon:Ae,label:"More actions",active:i,onClick:()=>l(!i)}),children:c.items(e,()=>l(!1),n)})]}),r?null:o(Mn,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:p=>u({summary:p})}),s("div",{className:"dd-doc-meta",children:[o(Xd,{status:e.status,onChange:p=>{u({status:p}).catch(()=>{})}}),s("span",{className:"dd-doc-project",title:f?`Project \xB7 ${f.name}`:"Visible to agents in every project",children:[f?null:o(Qa,{size:12,"aria-hidden":!0}),f?f.name:e.projectId?"Unknown project":"Global"]}),r?null:o(Wd,{tags:e.tags,onChange:p=>{u({tags:p}).catch(()=>{})}}),o("span",{className:"dd-spacer"}),s("span",{className:"dd-doc-updated",children:[o(Ce,{actor:e.updatedBy})," ",o(ie,{at:e.updatedAt,now:Date.now()})]})]}),c.dialogs]})}function Fn({docId:e,file:a,removed:r=!1,split:t,renderPreview:n,onStateChange:d,onSaved:i}){let l=j(),[c,f]=S(a.content),[u,p]=S({content:a.content,revision:a.revision}),[h,I]=S(!1),[x,L]=S(null),k=c!==u.content,R=yo(c),A=T({dirty:k,draft:c,saved:u});A.current={dirty:k,draft:c,saved:u},O(()=>{let{dirty:w,draft:F,saved:m}=A.current;a.revision!==m.revision&&(!w||a.content===F?(f(a.content),p({content:a.content,revision:a.revision}),L(null)):L({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),O(()=>{d?.({dirty:k,saving:h})},[k,h,d]);let N=ke(async w=>{if(!h){I(!0);try{let F=w??(r?0:u.revision),m=await l.writeFile(e,{path:a.path,content:c,baseRevision:F});p({content:c,revision:m.revision}),L(null),i?.(m)}catch(F){if(Gr(F)){let m=await l.readFile(e,a.path).catch(()=>null);L({revision:m?.revision??u.revision+1,by:m?.updatedBy??a.updatedBy})}else B(`Could not save ${a.path}: ${U(F)}`,"error")}finally{I(!1)}}},[l,e,c,a.path,a.updatedBy,i,r,u.revision,h]),v=async()=>{try{let w=await l.readFile(e,a.path);f(w.content),p({content:w.content,revision:w.revision}),L(null)}catch(w){B(`Could not reload ${a.path}: ${U(w)}`,"error")}},H=w=>{if((w.metaKey||w.ctrlKey)&&w.key.toLowerCase()==="s"){w.preventDefault(),k&&!x&&N();return}if(w.key==="Tab"&&!w.metaKey&&!w.ctrlKey&&!w.altKey){w.preventDefault();let F=w.currentTarget,{selectionStart:m,selectionEnd:y,value:P}=F,C=`${P.slice(0,m)}  ${P.slice(y)}`;f(C),requestAnimationFrame(()=>{F.selectionStart=F.selectionEnd=m+2})}};return s("div",{className:"dd-editor",children:[r&&k&&!x?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(be,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[a.path," was deleted or renamed while you were editing. Save puts it back with your edits; Revert drops them."]})]}):null,x?s("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[o(ye,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o(Ce,{actor:x.by})," saved revision ",x.revision," while you were editing."]}),s("button",{type:"button",className:"btn",onClick:()=>{v()},children:[o(Ue,{size:12,"aria-hidden":!0})," Discard mine"]}),o("button",{type:"button",className:"btn",onClick:()=>{N(x.revision)},children:"Overwrite with mine"})]}):null,s("div",{className:`dd-editor-body${t?" dd-editor-split":""}`,children:[o("textarea",{className:"dd-editor-input",value:c,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:w=>f(w.target.value),onKeyDown:H,autoFocus:!0}),t?o("div",{className:"dd-editor-preview",children:n(R)}):null]}),s("div",{className:"dd-editor-footer",children:[s("span",{className:"dd-editor-state",children:[h?o(Q,{size:12,label:"Saving"}):null,h?"Saving\u2026":k?"Unsaved changes":`Saved \xB7 rev ${u.revision}`]}),o("span",{className:"dd-editor-hint",children:"\u2318S to save"}),o("button",{type:"button",className:"btn",disabled:!k||h,onClick:()=>f(u.content),children:"Revert"}),s("button",{type:"button",className:"btn primary",disabled:!k||h||!!x,onClick:()=>{N()},children:[o(rt,{size:12,"aria-hidden":!0})," Save"]})]})]})}var Nt="dd-comment",Et="dd-comment-focus";function Kd(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}var Zd=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE"]);function Qd(e){let a=e.ownerDocument.createTreeWalker(e,4,{acceptNode:c=>Zd.has(c.parentElement?.tagName.toUpperCase()??"")?2:1}),r=[],t=[],n="";for(let c=a.nextNode();c;c=a.nextNode())t.push(n.length),r.push(c),n+=c.data;let d="",i=[],l=!0;for(let c=0;c<n.length;c+=1){let f=n[c];/\s/.test(f)?(l||(d+=" ",i.push(c)),l=!0):(d+=f,i.push(c),l=!1)}return{nodes:r,starts:t,normalized:d,map:i}}function Bn(e,a){let r=0,t=e.starts.length-1;for(;r<t;){let n=r+t+1>>1;e.starts[n]<=a?r=n:t=n-1}return[e.nodes[r],a-e.starts[r]]}function Kt(e,a){let r=new Map;if(!a.length)return r;let t=Qd(e);if(!t.nodes.length)return r;for(let n of a){if(r.has(n))continue;let d="",i=-1;for(let h of new Set([n.replace(/\s+/g," ").trim(),Kd(n)]))if(!(h.length<2)&&(i=t.normalized.indexOf(h),i>=0)){d=h;break}if(i<0)continue;let[l,c]=Bn(t,t.map[i]),[f,u]=Bn(t,t.map[i+d.length-1]),p=e.ownerDocument.createRange();p.setStart(l,c),p.setEnd(f,u+1),r.set(n,p)}return r}function Jd(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var Nn=new Map;function ha(e,a,r){let t=Jd();if(!t)return;let n=Nn.get(e)??new Map;Nn.set(e,n),r.length?n.set(a,r):n.delete(a);let d=[...n.values()].flat();d.length?t.registry.set(e,new t.Highlight(...d)):t.registry.delete(e)}var On="dd-page";var Yd="dd-page-hello",qn=50,es=256*1024,Qt=1e3,Zt=4e3,as=500,ts=500,os=new Set(["error","missing","blocked"]);function ht(e){return e&&typeof e=="object"&&!Array.isArray(e)?e:null}function va(e,a){return typeof e=="string"&&e.length<=a?e:null}function Jt(e,a){return typeof e=="string"?e.slice(0,a):null}function Ot(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function En(e){return!Array.isArray(e)||e.length>ts?null:e.every(a=>typeof a=="string"&&a.length<=500)?e:null}function rs(e){if(e===null)return null;let a=ht(e);if(!a)return;let[r,t,n,d]=[a.top,a.left,a.bottom,a.right].map(Ot);return r===null||t===null||n===null||d===null?void 0:{top:r,left:t,bottom:n,right:d}}function ns(e){let a=ht(e);if(!a)return null;let r=0;for(let[t,n]of Object.entries(a))if(typeof n!="string"||(r+=t.length+n.length,r>es))return null;return{...a}}function ds(e){let a=ht(e),r=a?.kind,t=Jt(a?.message,as);if(!a||!os.has(r)||!t)return null;let n=Jt(a.source,Qt),d=Ot(a.line);return{kind:r,message:t,...n?{source:n}:{},...d!==null&&d>0?{line:Math.floor(d)}:{}}}function Hn(e){let a=ht(e);if(!a)return null;switch(a.type){case"ready":return{type:"ready"};case"fetch":{let r=va(a.path,Qt);return Number.isSafeInteger(a.id)&&a.id>=0&&r!==null?{type:"fetch",id:a.id,path:r}:null}case"navigate":{let r=va(a.path,Qt),t=a.hash===null?null:va(a.hash,Zt);return r===null||t===null&&a.hash!==null||typeof a.newTab!="boolean"?null:{type:"navigate",path:r,hash:t,newTab:a.newTab,redirect:a.redirect===!0}}case"open":{let r=va(a.url,Zt);return r===null?null:{type:"open",url:r}}case"problem":{let r=ds(a.problem);return r?{type:"problem",problem:r}:null}case"selection":{let r=Jt(a.text,500),t=rs(a.rect);return r===null||t===void 0?null:{type:"selection",text:r,rect:t}}case"anchors":{let r=En(a.found),t=En(a.missing);return r&&t?{type:"anchors",found:r,missing:t}:null}case"focused":{let r=va(a.quote,500);return r===null||typeof a.found!="boolean"?null:{type:"focused",quote:r,found:a.found}}case"scroll":{let r=Ot(a.x),t=Ot(a.y);return r===null||t===null?null:{type:"scroll",x:r,y:t}}case"hash":{let r=a.hash===null?null:va(a.hash,Zt);return r===null&&a.hash!==null?null:{type:"hash",hash:r}}case"storage":{let r=ns(a.entries);return r?{type:"storage",entries:r}:null}default:return null}}function _n(e){return ht(e)?.dd===Yd}var rm=12*1024*1024,Yt=960*1024;function Un(e,a,r){let t=new Map(a.map(n=>[n.path,n.revision]));return!r&&e.revision!==(t.get(e.path)??null)||e.deps.some(n=>(t.get(n.path)??0)!==n.revision)?!0:e.missing.some(n=>t.has(n))}function eo(e,a){let r=[...e],t=new Set(e.map(n=>n.path));for(let[n,d]of a){if(r.length>=500)break;t.has(n)||r.push({path:n,revision:d})}return r}function zn(e){return JSON.stringify(e).replace(/</g,"\\u003c")}var ss=new URL("./page-runtime.js",import.meta.url).href,Gn=[{id:"full",label:"Full width",icon:et,width:null},{id:"tablet",label:"Tablet (768px)",icon:lt,width:768},{id:"phone",label:"Phone (390px)",icon:dt,width:390}],ls=400,is=1500,us=6,cs=200,fs=20,ps=50,ms={error:"Error",missing:"Missing",blocked:"Blocked"},wa=new Map;function gs(e,a){for(wa.delete(e),wa.set(e,a);wa.size>fs;)wa.delete(wa.keys().next().value)}var xa=new Map,ao=(e,a)=>`${e}\0${a}`;function hs(e,a,r){let t=ao(e,a);for(xa.delete(t),xa.set(t,r);xa.size>ps;)xa.delete(xa.keys().next().value)}function xs(e,a,r,t){let n=`<script type="application/json" id="${On}">${zn(a)}<\/script><script src="${ln(r)}"><\/script>`,d=Ft(e.html,n);return e.styled?d:Cn(d,t)}function Ls(e,a){let r=0,t=[],n=()=>{for(;r<e&&t.length;){let d=t.shift();r+=1,Promise.resolve().then(d).catch(()=>{}).finally(()=>{r-=1,n()})}};return{add(d){return r+t.length>=a?!1:(t.push(d),n(),!0)},clear(){t.length=0}}}function Is(e){return e.length*6<Yt?!1:new TextEncoder().encode(JSON.stringify(e)).byteLength>Yt}function Cs(e,a){return e.kind===a.kind&&e.message===a.message&&e.source===a.source&&e.line===a.line}function jn({docId:e,file:a,files:r,draft:t=!1,quotes:n=[],onOpenPath:d,onQuote:i,onAskAbout:l,handleRef:c}){let f=j(),u=a.path,[p,h]=S("full"),[I,x]=S(null),[L,k]=S(!0),[R,A]=S(null),[N,v]=S(!1),[H,w]=S([]),[F,m]=S(!1),[y,P]=S(null),[C,q]=S(null),[$,ne]=S(0),pe=T(null),te=T(null),oe=T(null),Y=T(!1),de=T(null),ce=T([]),se=T(new Map),Le=T(null),Be=T(""),D=T({hash:xa.get(ao(e,u))??null,scroll:null}),V=T(n);V.current=n;let z=W(()=>Ls(us,cs),[]);O(()=>{xa.delete(ao(e,u))},[e,u]);let me=t?a.content:null,[ge,Da]=S(me);O(()=>{if(me===ge)return;if(me===null){Da(null);return}let b=setTimeout(()=>Da(me),ls);return()=>clearTimeout(b)},[me,ge]);let Ge=r.find(b=>b.path===u)?.revision??null,La=ge===null?Ge:null,J=T(0);O(()=>{let b=++J.current;if(ge!==null&&Is(ge)){v(!0),k(!1);return}v(!1),k(!0),f.renderPage(e,{path:u,draft:ge??void 0}).then(M=>{if(b!==J.current)return;let K={mode:"frame",docId:e,path:u,hash:D.current.hash,scroll:D.current.scroll,quotes:[...V.current],storage:wa.get(e)};x({id:b,page:M,srcDoc:xs(M,K,ss,M.styled?{}:In()),draft:ge!==null}),A(null),k(!1)},M=>{b===J.current&&(A(U(M)),k(!1))})},[f,e,u,ge,La,$]);let Ct=T("");O(()=>{if(!I||L)return;let b={...I.page,deps:eo(I.page.deps,se.current)};if(!Un(b,r,ge!==null))return;let M=r.map(K=>`${K.path}@${K.revision}`).join("|");Ct.current!==M&&(Ct.current=M,ne(K=>K+1))},[I,r,L,ge]);let we=(b,M=oe.current)=>{try{M?.postMessage(b)}catch{}},Ht=b=>{w(M=>M.length>=qn||M.some(K=>Cs(K,b))?M:[...M,b]),Ne()},ee=T(H);ee.current=H;let Ta=T(I);Ta.current=I;let Ne=()=>{Le.current&&clearTimeout(Le.current),Le.current=setTimeout(()=>{Le.current=null;let b=Ta.current,M=b?.page;if(!M||b.draft||M.revision===null||!Y.current)return;let K={path:M.path,revision:M.revision,deps:eo(M.deps,se.current),missing:M.missing,problems:ee.current,unanchored:ce.current},Z=JSON.stringify(K);Z!==Be.current&&(Be.current=Z,f.reportRender(e,K).catch(()=>{Be.current=""}))},is)},bt=(b,M)=>{b!==u&&(M!==null&&hs(e,b,M),d?.(b))},Ma=(b,M,K)=>{let Z=new Set(r.map(da=>da.path)),Ee=Z.has(b)?b:Z.has(`${b}/index.html`)?`${b}/index.html`:null;if(!Ee){B(`${b} is not a file in this design doc`,"error");return}K?P(Ee===u?null:{path:Ee,hash:M}):bt(Ee,M)},na=b=>{let M;try{M=new URL(b)}catch{return}if(M.protocol!=="https:"&&M.protocol!=="http:"){B(`Zana opens web links only, not ${M.protocol} links`,"error");return}let K=globalThis.navigator?.userActivation;if(K&&!K.isActive){Ht({kind:"blocked",message:`The page tried to open ${M.href} without a click`});return}globalThis.open(M.href,"_blank","noopener,noreferrer")},Ra=(b,M)=>{let K=pe.current,Z=te.current;if(!i||!b||!M||!K||!Z){q(null);return}let Ee=K.getBoundingClientRect(),da=Z.getBoundingClientRect(),pd=Ee.top-da.top+Z.scrollTop+M.top-36,md=Ee.left-da.left+Z.scrollLeft+(M.left+M.right)/2;q({text:b,top:Math.max(4,pd),left:Math.min(Math.max(80,md),Math.max(80,Z.scrollWidth-80))})},Fa=(b,M)=>{switch(b.type){case"ready":Y.current=!0,we({type:"highlight",quotes:[...V.current]},M),de.current!==null&&we({type:"focus",quote:de.current},M),de.current=null,Ne();break;case"fetch":{!se.current.has(b.path)&&se.current.size<500&&(se.current.set(b.path,r.find(Z=>Z.path===b.path)?.revision??0),Ne()),z.add(async()=>{let Z=null;try{Z=await f.readPageFile(e,b.path)}catch{Z=null}oe.current===M&&we({type:"file",id:b.id,file:Z},M)})||we({type:"file",id:b.id,file:null},M);break}case"navigate":Ma(b.path,b.hash,b.redirect);break;case"open":na(b.url);break;case"problem":Ht(b.problem);break;case"selection":Ra(b.text,b.rect);break;case"anchors":ce.current=b.missing,Ne();break;case"focused":b.found||B("That passage is no longer on this page");break;case"scroll":D.current.scroll={x:b.x,y:b.y};break;case"hash":D.current.hash=b.hash;break;case"storage":gs(e,b.entries);break;default:break}},St=T(Fa);St.current=Fa,O(()=>{let b=M=>{let K=pe.current,Z=M.ports?.[0];!K||!Z||M.source!==K.contentWindow||!_n(M.data)||(oe.current?.close(),oe.current=Z,Y.current=!1,ce.current=[],se.current=new Map,z.clear(),w([]),P(null),q(null),Z.onmessage=Ee=>{if(oe.current!==Z)return;let da=Hn(Ee.data);da&&St.current(da,Z)})};return globalThis.addEventListener("message",b),()=>{globalThis.removeEventListener("message",b),oe.current?.close(),oe.current=null,z.clear(),Le.current&&clearTimeout(Le.current)}},[z]);let Ba=n.join("\0");O(()=>{Y.current&&we({type:"highlight",quotes:Ba?Ba.split("\0"):[]})},[Ba]),O(()=>{if(!c)return;let b={focusQuote(M){return Y.current&&oe.current?we({type:"focus",quote:M}):de.current=M,!0}};return c.current=b,()=>{c.current===b&&(c.current=null)}},[c]);let je=[...W(()=>I?[...I.page.missing.map(b=>({kind:"missing",message:`The page uses ${b}, which is not a file in this doc`})),...I.page.warnings.map(b=>({kind:"blocked",message:b}))]:[],[I]),...H],yt=async()=>{try{let{url:b}=await f.pageLink(e,u);globalThis.open(b,"_blank","noopener,noreferrer")}catch(b){B(U(b),"error")}},Pt=b=>{!C||!b||(b(C.text),q(null),we({type:"clear-selection"}))},E=Gn.find(b=>b.id===p).width;return s("div",{className:"dd-html-stage",onMouseDown:b=>{b.target.closest?.(".dd-selection-chip")||q(null)},children:[s("div",{className:"dd-html-toolbar",children:[s("div",{className:"dd-html-status",children:[L?o(Q,{size:12,label:"Rendering page"}):null,t?o("span",{className:"dd-muted",children:"Unsaved changes"}):null]}),o("div",{className:"dd-html-widths",role:"toolbar","aria-label":"Preview width",children:Gn.map(b=>o("button",{type:"button",className:`icon-btn${p===b.id?" on":""}`,title:b.label,"aria-label":b.label,"aria-pressed":p===b.id,onClick:()=>h(b.id),children:o(b.icon,{size:14,"aria-hidden":!0})},b.id))}),s("div",{className:"dd-html-actions",children:[je.length?o(ve,{open:F,onClose:()=>m(!1),className:"dd-page-problems",anchor:s("button",{type:"button",className:"dd-page-badge","aria-label":`${je.length} page ${je.length===1?"problem":"problems"}`,"aria-expanded":F,onClick:()=>m(b=>!b),children:[o(ye,{size:13,"aria-hidden":!0}),je.length]}),children:o("ul",{"aria-label":"Page problems",children:je.map((b,M)=>s("li",{className:`dd-page-problem dd-page-problem-${b.kind}`,children:[o("span",{className:"dd-page-problem-kind",children:ms[b.kind]}),o("span",{className:"dd-page-problem-message",children:b.message}),b.source?s("span",{className:"dd-muted dd-page-problem-source",children:[b.source,b.line?`:${b.line}`:""]}):null]},M))})}):null,t?null:o(_,{icon:He,label:"Open in browser",onClick:()=>{yt()}})]})]}),y?s("div",{className:"dd-banner dd-banner-info",children:[o(Ga,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:["This page redirects to ",o("code",{children:y.path}),"."]}),o("button",{type:"button",className:"btn",onClick:()=>{P(null),bt(y.path,y.hash)},children:"Go there"}),o(_,{icon:re,label:"Dismiss",onClick:()=>P(null)})]}):null,N?s("div",{className:"dd-banner dd-banner-warn",children:[o(ye,{size:14,"aria-hidden":!0}),o("span",{className:"dd-banner-text",children:"This draft is too large to preview. Save it to see the page."})]}):null,R?o("div",{className:"dd-banner dd-banner-error",children:R}):null,s("div",{className:"dd-html-viewport",ref:te,children:[I?o("iframe",{ref:pe,className:`dd-html-frame${E?" dd-html-frame-device":""}`,style:E?{width:E}:void 0,sandbox:"allow-scripts allow-forms",srcDoc:I.srcDoc,title:u},I.id):R||N?null:o("div",{className:"dd-center",children:o(Q,{label:"Rendering page"})}),C?s("div",{className:"dd-selection-chip",style:{top:C.top,left:C.left},children:[s("button",{type:"button",onClick:()=>Pt(i),children:[o(ca,{size:13,"aria-hidden":!0}),"Comment"]}),l?s("button",{type:"button",onClick:()=>Pt(l),children:[o(ae,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})]})}var bs=24,Ss=64,ka=new Map;function ys(e,a){for(ka.delete(e),ka.set(e,a);ka.size>Ss;)ka.delete(ka.keys().next().value)}function Ps(e,a,r){let t=j(),n=W(()=>{let f=new Map(a.map(u=>[u.path,u]));return r.map(u=>f.get(u)).filter(u=>!!u&&(u.kind==="image"||u.kind==="svg")).slice(0,bs)},[a,r]),d=n.map(f=>`${f.path}@${f.revision}`).join("|"),i=T(n);i.current=n;let[l,c]=S(new Map);return O(()=>{let f=i.current,u=!1,p=new Map,h=[];for(let I of f){let x=ka.get(`${e}\0${I.path}\0${I.revision}`);x?p.set(I.path,x):h.push(I)}if(c(p),!!h.length)return Promise.all(h.map(async I=>{try{let x=await t.readFile(e,I.path),L=jt(x);L&&(ys(`${e}\0${x.path}\0${x.revision}`,L),p.set(x.path,L))}catch{}})).then(()=>{u||c(new Map(p))}),()=>{u=!0}},[t,e,d]),l}function Lt({docId:e,file:a,files:r,quotes:t=[],onOpenPath:n,onQuote:d,onAskAbout:i,handleRef:l,draft:c=!1}){let f=T(null),u=T(null),p=T({}),[h,I]=S(null),x=W(()=>a.kind==="markdown"?hn(a.path,a.content):[],[a.path,a.content,a.kind]),L=Ps(e,r,x),k=W(()=>new Set(r.map(m=>m.path)),[r]),R=W(()=>a.kind==="markdown"?xn(a.path,a.content,L):a.kind==="mermaid"?Vt(a.content,"mermaid"):a.kind==="code"?Ln(a.path,a.content):null,[a.kind,a.path,a.content,L]),A=t.join("\0");O(()=>{let m=u.current,y=p.current,P=A?A.split("\0"):[];if(!m||!P.length){ha(Nt,y,[]);return}let C=()=>ha(Nt,y,[...Kt(m,P).values()]),q=setTimeout(C,60),$=typeof MutationObserver=="function"?new MutationObserver(()=>C()):null;return $?.observe(m,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(q),$?.disconnect(),ha(Nt,y,[]),ha(Et,y,[])}},[A,R,a.kind,a.content]);let N=a.kind!=="html";O(()=>{if(!(!l||!N))return l.current={focusQuote(m){let y=u.current,P=y?Kt(y,[m]).get(m):void 0;return P?(P.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),ha(Et,p.current,[P]),setTimeout(()=>ha(Et,p.current,[]),1800),!0):!1}},()=>{l.current=null}},[l,N]);let v=m=>{let y=m.target?.closest?.("a");if(!y)return;let P=y.getAttribute("href")??"";if(P.startsWith("#")){m.preventDefault(),m.stopPropagation();return}let C=mt(a.path,P);if(!C)return;m.preventDefault(),m.stopPropagation();let q=[...k].find($=>$.startsWith(`${C}/`));k.has(C)?n?.(C):q?n?.(q):B(`${C} is not a file in this design doc`,"error")},H=()=>{if(!d)return;let m=globalThis.getSelection?.(),y=f.current,P=m?.toString().trim()??"";if(!m||m.isCollapsed||!P||!y||!u.current?.contains(m.anchorNode)){I(null);return}let C=m.getRangeAt(0).getBoundingClientRect(),q=y.getBoundingClientRect();I({text:P.slice(0,500),top:Math.max(4,C.top-q.top+y.scrollTop-36),left:Math.min(Math.max(80,C.left-q.left+C.width/2),Math.max(80,q.width-80))})},w=m=>{!h||!m||(m(h.text),I(null),globalThis.getSelection?.()?.removeAllRanges())},F;if(a.kind==="html")F=o(jn,{docId:e,file:a,files:r,draft:c,quotes:t,onOpenPath:n,onQuote:d,onAskAbout:i,handleRef:l},`${e}\0${a.path}`);else if(a.kind==="image"||a.kind==="svg"){let m=jt(a);F=o("div",{className:"dd-image-stage",children:m?o("img",{src:m,alt:a.path}):o("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else a.kind==="font"?F=o("div",{className:"dd-image-stage",children:o("span",{className:"dd-muted",children:"Font file. Pages in this doc load it through @font-face."})}):R!==null?F=o("div",{className:`dd-prose dd-prose-${a.kind}`,ref:u,onClickCapture:v,children:a.kind==="markdown"&&!a.content.trim()?o("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):o(Na,{content:R})}):F=o("div",{className:"dd-prose",ref:u,children:o("pre",{className:"dd-plain",children:a.content})});return s("div",{className:`dd-preview dd-preview-${a.kind}`,ref:f,onMouseUp:H,onMouseDown:m=>{m.target.closest?.(".dd-selection-chip")||I(null)},children:[F,h?s("div",{className:"dd-selection-chip",style:{top:h.top,left:h.left},children:[s("button",{type:"button",onClick:()=>w(d),children:[o(ca,{size:13,"aria-hidden":!0}),"Comment"]}),i?s("button",{type:"button",onClick:()=>w(i),children:[o(ae,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function Vn(e,a,r=1500){let t=e.split(`
`),n=a.split(`
`),d=0;for(;d<t.length&&d<n.length&&t[d]===n[d];)d+=1;let i=t.length,l=n.length;for(;i>d&&l>d&&t[i-1]===n[l-1];)i-=1,l-=1;let c=t.slice(d,i),f=n.slice(d,l);if(c.length>r||f.length>r)return null;let u=f.length+1,p=new Uint32Array((c.length+1)*u);for(let L=c.length-1;L>=0;L-=1)for(let k=f.length-1;k>=0;k-=1)p[L*u+k]=c[L]===f[k]?p[(L+1)*u+k+1]+1:Math.max(p[(L+1)*u+k],p[L*u+k+1]);let h=[],I=0,x=0;for(;I<c.length&&x<f.length;)c[I]===f[x]?(h.push({type:"same",text:c[I]}),I+=1,x+=1):p[(I+1)*u+x]>=p[I*u+x+1]?(h.push({type:"del",text:c[I]}),I+=1):(h.push({type:"add",text:f[x]}),x+=1);for(;I<c.length;)h.push({type:"del",text:c[I++]});for(;x<f.length;)h.push({type:"add",text:f[x++]});return[...t.slice(0,d).map(L=>({type:"same",text:L})),...h,...t.slice(i).map(L=>({type:"same",text:L}))]}function $n(e,a=3){let r=new Uint8Array(e.length);e.forEach((d,i)=>{if(d.type!=="same")for(let l=Math.max(0,i-a);l<=Math.min(e.length-1,i+a);l+=1)r[l]=1});let t=[],n=0;for(;n<e.length;)if(r[n]){let d=[];for(;n<e.length&&r[n];)d.push(e[n++]);t.push({type:"lines",lines:d})}else{let d=0;for(;n<e.length&&!r[n];)d+=1,n+=1;t.push({type:"gap",count:d})}return t}function Wn(e){let a=0,r=0;for(let t of e)t.type==="add"?a+=1:t.type==="del"&&(r+=1);return{added:a,removed:r}}var vs={create:De,write:Xe,delete:Ke,rename:at},Xn={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function Kn({doc:e,activePath:a,now:r,selectedId:t,onSelect:n}){let d=j(),[i,l]=le("history-scope","file"),c=i==="file"?a:null,f=Ye(`${e.id}\0${c??"*"}\0${e.revision}`,()=>d.history(e.id,{...c?{path:c}:{},limit:100}));return s("div",{className:"dd-rail-pane dd-history",children:[o("div",{className:"dd-rail-toolbar",children:s("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[o("button",{type:"button",className:i==="file"?"on":"",onClick:()=>l("file"),disabled:!a,children:"This file"}),o("button",{type:"button",className:i==="all"?"on":"",onClick:()=>l("all"),children:"All files"})]})}),s("div",{className:"dd-rail-scroll",children:[f.error?o("div",{className:"dd-banner dd-banner-error",children:f.error}):null,!f.data&&f.loading?o("div",{className:"dd-center",children:o(Q,{label:"Loading history"})}):null,f.data&&!f.data.length?o(Pe,{icon:Se,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,o("ol",{className:"dd-history-list",children:f.data?.map(u=>{let p=vs[u.op];return o("li",{children:s("button",{type:"button",className:`dd-history-row${t===u.id?" on":""}`,onClick:()=>n(u),children:[o(p,{size:13,className:`dd-op dd-op-${u.op}`,"aria-hidden":!0}),s("span",{className:"dd-history-main",children:[s("span",{className:"dd-history-title",children:[Xn[u.op],c?null:o("span",{className:"dd-history-path",children:u.path}),s("span",{className:"dd-history-rev",children:["rev ",u.revision]})]}),u.note?o("span",{className:"dd-history-note",children:u.note}):null,s("span",{className:"dd-history-meta",children:[o(Ce,{actor:u.actor}),o(ie,{at:u.createdAt,now:r})]})]})]})},u.id)})})]})]})}async function ws(e,a,r){let t=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||t.encoding==="base64")return{after:t,before:null,pruned:!1};if(r.op==="delete")return{after:t,before:t.content,pruned:!1};let n=(await e.history(a,{path:r.path,limit:100})).find(i=>i.id<r.id);if(!n)return{after:t,before:null,pruned:!0};if(n.op==="delete")return{after:t,before:"",pruned:!1};let d=await e.revision(a,n.id);return{after:t,before:d.content,pruned:!1}}function Zn({doc:e,revision:a,onClose:r,onOpenPath:t}){let n=j(),[d,i]=S(a.op==="write"||a.op==="delete"?"changes":"full"),[l,c]=S(!1),[f,u]=S(null),p=Ye(`${e.id}\0${a.id}`,()=>ws(n,e.id,a)),h=ga(a.path),I=e.files.find(v=>v.path===a.path)??null,x=I?.revision===a.revision&&a.op!=="delete",L=W(()=>{let v=p.data;if(!v||v.before===null||ze(h))return null;let H=Vn(v.before,a.op==="delete"?"":v.after.content);return H?{hunks:$n(H),stats:Wn(H)}:"too-large"},[p.data,a.op,h]),k=async()=>{c(!0);try{let v=await n.restore(e.id,a.id,I?.revision??0);B(`Restored ${v.path} to revision ${a.revision} (now rev ${v.revision})`),t(v.path),r()}catch(v){B(`Could not restore: ${U(v)}`,"error")}finally{c(!1)}},R=()=>{if(I){k();return}u({title:`Recreate ${a.path}?`,body:s(X,{children:[o("code",{children:a.path})," is no longer in this doc",a.op==="delete"?"":"; it may have been renamed",". Recreate it with the content of revision ",a.revision,"?"]}),confirmLabel:"Recreate",run:()=>{k()}})},A=L!==null,N=d==="full"||!A;return s("div",{className:"dd-revision",children:[s("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[o(Se,{size:14,"aria-hidden":!0}),s("span",{className:"dd-banner-text",children:[o("strong",{children:Xn[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",o(Ce,{actor:a.actor})," ",o(ie,{at:a.createdAt,now:Date.now()}),a.renamedFrom?s(X,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?s("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),A?s("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[o("button",{type:"button",className:d==="changes"?"on":"",onClick:()=>i("changes"),children:"Changes"}),o("button",{type:"button",className:d==="full"?"on":"",onClick:()=>i("full"),children:"Full file"})]}):null,s("button",{type:"button",className:"btn",disabled:x||l||!p.data,onClick:R,children:[o(Ue,{size:12,"aria-hidden":!0})," ",x?"Current":I?"Restore":"Recreate file"]}),o(_,{icon:re,label:"Close revision",onClick:r})]}),s("div",{className:"dd-revision-body",children:[p.error?o("div",{className:"dd-banner dd-banner-error",children:p.error}):null,p.data?N?s(X,{children:[p.data.pruned?o("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,L==="too-large"?o("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,o(Lt,{docId:e.id,file:{path:a.path,kind:h,content:p.data.after.content,encoding:p.data.after.encoding},files:e.files,onOpenPath:t,draft:!0})]}):L&&L!=="too-large"?s("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[s("div",{className:"dd-diff-stats",children:[s("span",{className:"dd-diff-added",children:["+",L.stats.added]}),s("span",{className:"dd-diff-removed",children:["\u2212",L.stats.removed]}),o("span",{className:"dd-muted",children:ma(a.size)})]}),L.hunks.map((v,H)=>v.type==="gap"?s("div",{className:"dd-diff-gap",children:["\u22EF ",v.count," unchanged line",v.count===1?"":"s"]},H):v.lines.map((w,F)=>s("div",{className:`dd-diff-line dd-diff-${w.type}`,role:"row",children:[o("span",{className:"dd-diff-sign","aria-hidden":!0,children:w.type==="add"?"+":w.type==="del"?"\u2212":" "}),o("span",{className:"dd-diff-text",children:w.text||" "})]},`${H}-${F}`))),L.stats.added+L.stats.removed===0?o("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:p.loading?o("div",{className:"dd-center",children:o(Q,{label:"Loading revision"})}):null]}),f?o(Fe,{request:f,onClose:()=>u(null)}):null]})}var ks=[{id:"preview",label:"Preview",icon:Va},{id:"edit",label:"Edit",icon:fa},{id:"split",label:"Split",icon:$e}];function As(e,a,r){let t=Zr(e,a,r),n=T(null);t.data&&(n.current=t.data);let d=n.current&&n.current.path===a?n.current:null;return{file:t.data??d,error:t.error,loading:t.loading}}function Ds(e,a,r){let[t,n]=S(null),d=T({path:e,revision:a});return O(()=>{let i=d.current;if(d.current={path:e,revision:a},i.path!==e||a===null||i.revision===null||a<=i.revision||r?.kind!=="agent")return;n(r.label);let l=setTimeout(()=>n(null),4e3);return()=>clearTimeout(l)},[e,a,r]),t}function Qn({doc:e,path:a,mode:r,onModeChange:t,railOpen:n,onToggleRail:d,revision:i,onCloseRevision:l,previewHandle:c,onOpenPath:f,onQuote:u,onAskAbout:p,onEditorState:h,leading:I}){let x=e.files.find(m=>m.path===a)??null,{file:L,error:k,loading:R}=As(e.id,a,x?.revision??null),A=Ds(a,x?.revision??null,x?.updatedBy),N=!x||!ze(x.kind),v=N?r:"preview",H=W(()=>e.comments.filter(m=>m.status==="open"&&m.path===a&&m.quote).map(m=>m.quote),[e.comments,a]),w=a.lastIndexOf("/");O(()=>{v==="preview"&&h({dirty:!1,saving:!1})},[v,h]);let F;return i?F=o(Zn,{doc:e,revision:i,onClose:l,onOpenPath:f},i.id):!x&&!(L&&v!=="preview")?F=s("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}):L?v==="preview"?F=o(Lt,{docId:e.id,file:L,files:e.files,quotes:H,onOpenPath:f,onQuote:u,onAskAbout:p,handleRef:c}):F=o(Fn,{docId:e.id,file:L,removed:!x,split:v==="split",onStateChange:h,renderPreview:m=>o(Lt,{docId:e.id,file:{...L,content:m},files:e.files,onOpenPath:f,draft:m!==L.content})},`${e.id}\0${a}`):F=o("div",{className:"dd-center",children:k?o("div",{className:"dd-banner dd-banner-error",children:k}):R?o(Q,{label:"Loading file"}):null}),s("section",{className:"dd-file-pane","aria-label":a,children:[s("div",{className:"dd-file-toolbar",children:[I,x?o(Sa,{kind:x.kind}):null,s("span",{className:"dd-file-path",title:a,children:[w>0?o("span",{className:"dd-file-dir",children:a.slice(0,w+1)}):null,o("span",{className:"dd-file-name",children:a.slice(w+1)})]}),x?s("span",{className:"dd-file-meta",children:["rev ",x.revision," \xB7 ",ma(x.size)," \xB7 ",o(Ce,{actor:x.updatedBy})," ",o(ie,{at:x.updatedAt,now:Date.now()})]}):null,A?s("span",{className:"dd-flash",role:"status",children:[o(ue,{size:12,"aria-hidden":!0})," Updated by ",A]}):null,o("span",{className:"dd-spacer"}),i?null:o("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:ks.map(m=>s("button",{type:"button",className:v===m.id?"on":"",disabled:!N&&m.id!=="preview",onClick:()=>t(m.id),title:m.label,"aria-pressed":v===m.id,children:[o(m.icon,{size:13,"aria-hidden":!0}),o("span",{className:"dd-mode-label",children:m.label})]},m.id))}),o(_,{icon:tt,label:n?"Hide comments & history":"Show comments & history",active:n,onClick:d})]}),o("div",{className:"dd-file-body",children:F})]})}function Rs(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,t=>t.toUpperCase());switch(ga(e)){case"markdown":return`# ${r}

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
`;default:return""}}function Fs(e){let a=e.trim().replace(/^\/+/,"");return pt(a)?a:`${a}.md`}function Bs(e){return new Promise((a,r)=>{let t=new FileReader,n=ze(ga(e.name));t.onerror=()=>r(t.error??new Error("could not read the file")),t.onload=()=>{let d=String(t.result??"");a(n?{content:d.slice(d.indexOf(",")+1),encoding:"base64"}:{content:d})},n?t.readAsDataURL(e):t.readAsText(e)})}function Jn({initial:e,placeholder:a,onSubmit:r,onCancel:t}){let[n,d]=S(e),i=T(!1),l=f=>{f?.preventDefault(),!i.current&&(i.current=!0,n.trim()&&n.trim()!==e?r(n.trim()):t())};return o("form",{className:"dd-tree-input",onSubmit:l,children:o("input",{className:"dd-input",value:n,placeholder:a,"aria-label":a,onChange:f=>d(f.target.value),onKeyDown:f=>{f.key==="Escape"&&(f.preventDefault(),i.current=!0,t())},onBlur:()=>l(),autoFocus:!0,onFocus:f=>{let u=f.target.value.lastIndexOf("."),p=f.target.value.lastIndexOf("/")+1;f.target.setSelectionRange(p,u>p?u:f.target.value.length)}})})}function Ns({doc:e,file:a,name:r,depth:t,active:n,renaming:d,onOpen:i,onRename:l,onRenameDone:c,onDelete:f}){let u=j(),[p,h]=S(!1),I=e.entryPath===a.path,x=e.comments.filter(L=>L.status==="open"&&L.path===a.path).length;return d?o("div",{className:"dd-tree-row",style:{paddingLeft:8+t*14},children:o(Jn,{initial:a.path,placeholder:"New path",onSubmit:L=>c(L),onCancel:()=>c(null)})}):s("div",{className:`dd-tree-row dd-tree-file${n?" on":""}`,style:{paddingLeft:8+t*14},children:[s("button",{type:"button",className:"dd-tree-open",onClick:i,onDoubleClick:l,title:`${a.path} \xB7 ${ma(a.size)} \xB7 rev ${a.revision}`,"aria-current":n?"page":void 0,children:[o(Sa,{kind:a.kind}),o("span",{className:"dd-tree-name",children:r}),I?o(Ze,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,x?o("span",{className:"dd-tree-badge",title:`${x} open comment${x===1?"":"s"}`,children:x}):null]}),s(ve,{open:p,onClose:()=>h(!1),className:"dd-menu",anchor:o(_,{icon:Ae,label:`Actions for ${a.path}`,size:13,active:p,onClick:()=>h(!p)}),children:[o(fe,{icon:fa,label:"Rename or move",onSelect:()=>{h(!1),l()}}),I||ze(a.kind)?null:o(fe,{icon:st,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{h(!1),u.update(e.id,{entryPath:a.path}).catch(L=>B(U(L),"error"))}}),o(fe,{icon:xe,label:"Delete",danger:!0,onSelect:()=>{h(!1),f()}})]})]})}function to({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n,onHide:d}){let i=j(),[l,c]=S(new Set),[f,u]=S(!1),[p,h]=S(null),[I,x]=S(null),L=T(null),k=bn(e.files),R=e.files.length>=500,A=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",N=async y=>{u(!1);let P=Fs(y);if(e.files.some(C=>C.path===P)){r(P);return}if(ze(ga(P))){B("Use \u201CAdd files\u201D to upload images and fonts.","error");return}try{await i.writeFile(e.id,{path:P,content:Rs(P)}),r(P)}catch(C){B(`Could not create ${P}: ${U(C)}`,"error")}},v=(y,P)=>{if(h(null),!P||P===y)return;let C=async()=>{try{let q=await i.renameFile(e.id,y,P);t(y,q.path)}catch(q){B(`Could not rename ${y}: ${U(q)}`,"error")}};if(!n?.(y)){C();return}x({title:"Discard unsaved changes?",body:s(X,{children:["Renaming ",o("code",{children:y})," drops your unsaved edits to it. Save them first to keep them."]}),confirmLabel:"Discard and rename",danger:!0,run:C})},H=async y=>{for(let P of Array.from(y??[])){let C=ga(P.name),q=ze(C)?2097152:2097152;if(P.size>q){B(`${P.name} is larger than ${ma(q)}`,"error");continue}let $=C==="image"||C==="svg"||C==="font",ne=`${A||($?"assets/":"")}${P.name.replace(/[^\w.-]+/g,"-")}`;try{let pe=await Bs(P);await i.writeFile(e.id,{path:ne,...pe});let te=ne.slice(A.length);B(C==="font"||!$?`Added ${ne}`:`Added ${ne}. Reference it with ![${P.name}](${te})`)}catch(pe){B(`Could not add ${P.name}: ${U(pe)}`,"error")}}L.current&&(L.current.value="")},w=y=>x({title:"Delete file",body:s(X,{children:["Delete ",o("code",{children:y.path}),"? Its history is kept, so it can be recreated from History.",n?.(y.path)?" Your unsaved edits to it will be lost.":null]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await i.deleteFile(e.id,y.path),t(y.path,null)}catch(P){B(`Could not delete ${y.path}: ${U(P)}`,"error")}}}),F=y=>c(P=>{let C=new Set(P);return C.has(y)?C.delete(y):C.add(y),C}),m=(y,P)=>y.map(C=>{if(C.kind==="folder"){let q=!l.has(C.path);return s("div",{role:"group","aria-label":C.name,children:[s("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+P*14},onClick:()=>F(C.path),"aria-expanded":q,children:[q?o(he,{size:12,"aria-hidden":!0}):o(la,{size:12,"aria-hidden":!0}),q?o(_e,{size:14,"aria-hidden":!0}):o(Za,{size:14,"aria-hidden":!0}),o("span",{className:"dd-tree-name",children:C.name})]}),q?m(C.children,P+1):null]},`d:${C.path}`)}return o(Ns,{doc:e,file:C.file,name:C.name,depth:P,active:C.path===a,renaming:p===C.path,onOpen:()=>r(C.path),onRename:()=>h(C.path),onRenameDone:q=>{v(C.path,q)},onDelete:()=>w(C.file)},`f:${C.path}`)});return s("nav",{className:"dd-tree","aria-label":"Files",children:[s("div",{className:"dd-tree-head",children:[o("span",{className:"dd-section-label",children:"Files"}),o("span",{className:"dd-tree-count",children:e.files.length}),o("span",{className:"dd-spacer"}),o(_,{icon:De,label:"Add files",size:13,disabled:R,onClick:()=>L.current?.click()}),o(_,{icon:Ie,label:"New file",size:13,disabled:R,onClick:()=>u(!0)}),d?o(_,{icon:Me,label:"Hide files",size:13,onClick:d}):null,o("input",{ref:L,type:"file",multiple:!0,hidden:!0,onChange:y=>{H(y.target.files)}})]}),s("div",{className:"dd-tree-scroll",role:"tree",children:[m(k,0),f?o("div",{className:"dd-tree-row",style:{paddingLeft:8},children:o(Jn,{initial:A,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:y=>{N(y)},onCancel:()=>u(!1)})}):null]}),I?o(Fe,{request:I,onClose:()=>x(null)}):null]})}var Es=640,Os=1100,oo=[Es,Os];function qs(e,a){let r=t=>!!t&&e.files.some(n=>n.path===t);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function Hs({doc:e,tab:a,onTab:r,activePath:t,now:n,pendingQuote:d,onClearQuote:i,commentDraft:l,onCommentDraft:c,onFocusComment:f,selectedRevision:u,onSelectRevision:p,chatThreadId:h,onOpenChat:I,onClose:x}){let L=[{id:"comments",label:"Comments",icon:Te,count:e.openComments},{id:"history",label:"History",icon:Se},{id:"agents",label:"Agents",icon:ue,count:e.threads.length}],k=a==="agents"&&!!I&&e.threads.some(R=>R.threadId===h);return s("aside",{className:`dd-rail${k?" dd-rail-chat":""}`,"aria-label":"Comments, history and agents",children:[s("div",{className:"dd-rail-tabs",role:"tablist",children:[L.map(R=>s("button",{type:"button",role:"tab","aria-selected":a===R.id,className:`dd-rail-tab${a===R.id?" on":""}`,onClick:()=>r(R.id),children:[o(R.icon,{size:13,"aria-hidden":!0}),R.label,R.count?o("span",{className:"dd-count",children:R.count}):null]},R.id)),x?s(X,{children:[o("span",{className:"dd-spacer"}),o(_,{icon:re,label:"Close",onClick:x,size:13})]}):null]}),a==="comments"?o(Pn,{doc:e,activePath:t,now:n,pendingQuote:d,onClearQuote:i,draft:l,onDraft:c,onFocusComment:f}):a==="history"?o(Kn,{doc:e,activePath:t,now:n,selectedId:u,onSelect:p}):o(nn,{doc:e,now:n,chatThreadId:h,...I?{onOpenChat:I}:{}})]})}function _s({doc:e,activePath:a,onOpen:r,onPathChanged:t,hasDraft:n}){let[d,i]=S(!1),l=e.files.find(c=>c.path===a);return o(ve,{open:d,onClose:()=>i(!1),align:"start",className:"dd-switcher-pop",anchor:s("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":d,onClick:()=>i(!d),title:"Files in this doc",children:[l?o(Sa,{kind:l.kind}):null,s("span",{children:[e.files.length," files"]}),o(he,{size:12,"aria-hidden":!0})]}),children:o(to,{doc:e,activePath:a,onOpen:c=>{i(!1),r(c)},onPathChanged:t,hasDraft:n})})}function qt({docId:e,path:a,onOpenPath:r,layout:t,contextProjectId:n=null,onDeleted:d,headerExtra:i}){let l=Mt(e),c=ea(),f=ba(),u=t==="compact",[p,h]=Qr(oo),I=!u&&(h??oo.length)>=1,x=!u&&(h??oo.length)>=2,[L,k]=le("tree",!0),R=I&&L,[A,N]=le("view-mode","preview"),[v,H]=le("rail",!0),[w,F]=le("rail-compact",!1),m=x?v:w,y=x?H:F,[P,C]=le("rail-tab","comments"),[q,$]=S(null),[ne,pe]=S(""),[te,oe]=S(null),[Y,de]=S(null),[ce,se]=S(null),[Le,Be]=S(null),[D,V]=S(null),z=T({dirty:!1,saving:!1}),[me,ge]=S(!1),Da=T(null),Ge=T(null),La=T(null),J=l.data,Ct=J?qs(J,a):null,we=!!J&&!!Ge.current&&!J.files.some(E=>E.path===Ge.current);we||(La.current=null);let ee=we&&(me||La.current===Ge.current)?Ge.current:Ct;Ge.current=ee;let Ta=!!J&&!!l.error&&jr(l.error),Ne=T({onDeleted:d,title:J?.title??""});Ne.current={onDeleted:d,title:J?.title??Ne.current.title};let bt=ke(E=>{z.current.saving&&!E.saving&&!E.dirty&&(La.current=Ge.current),z.current=E,ge(E.dirty)},[]),Ma=ke(()=>{z.current={dirty:!1,saving:!1},La.current=null,ge(!1)},[]),na=ke(E=>{if(!z.current.dirty){E();return}Be({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{Ma(),E()}})},[Ma]),Ra=ke(E=>{if(E===ee){se(null);return}na(()=>{se(null),r(E)})},[ee,na,r]);O(()=>{Ta&&(B(`\u201C${Ne.current.title}\u201D was deleted`),Ne.current.onDeleted())},[Ta]);let Fa=!!te&&!!J?.threads.some(E=>E.threadId===te);if(O(()=>{te&&J&&!Fa&&oe(null)},[te,Fa,J]),O(()=>{if(!D||D.path!==ee||ce)return;let E=[80,300,900].map(b=>setTimeout(()=>{Da.current?.focusQuote(D.quote)&&(E.forEach(clearTimeout),V(null))},b));return()=>E.forEach(clearTimeout)},[D,ee,ce]),!J)return o("div",{className:"dd-doc dd-center",children:l.error?o(Pe,{icon:be,title:"This design doc could not be opened",children:l.error}):o(Q,{label:"Loading design doc"})});let St=E=>na(()=>{se(null),E.path&&E.path!==ee&&r(E.path),A!=="preview"&&N("preview"),x||y(!1),E.quote&&V({path:E.path??ee??"",quote:E.quote,nonce:Date.now()})}),Ba=E=>na(()=>{se(E),E.path!==ee&&J.files.some(b=>b.path===E.path)&&r(E.path)}),po=E=>{E==="preview"?na(()=>N(E)):N(E)},je=(E,b)=>{E===ee&&(Ma(),r(b,!0))},yt=E=>E===ee&&z.current.dirty,Pt=o(Hs,{doc:J,tab:P,onTab:C,activePath:ee,now:f,pendingQuote:q,onClearQuote:()=>$(null),commentDraft:ne,onCommentDraft:pe,onFocusComment:St,selectedRevision:ce?.id??null,onSelectRevision:Ba,chatThreadId:te,...u?{}:{onOpenChat:oe},onClose:x?void 0:()=>y(!1)});return s("div",{ref:p,className:`dd-doc dd-doc-${t}${m?" dd-rail-open":""}${x?"":" dd-rail-floating"}`,children:[o(Rn,{doc:J,projects:c.data??[],compact:u,onDeleted:d,actions:s(X,{children:[i,o(dn,{doc:J,activePath:ee,request:Y,contextProjectId:n,compact:u})]})}),s("div",{className:"dd-doc-body",children:[R?o(to,{doc:J,activePath:ee,onOpen:Ra,onPathChanged:je,hasDraft:yt,onHide:()=>k(!1)}):null,ee?o(Qn,{doc:J,path:ee,mode:A,onModeChange:po,railOpen:m,onToggleRail:()=>y(!m),revision:ce,onCloseRevision:()=>se(null),previewHandle:Da,onOpenPath:Ra,onQuote:E=>{$({path:ee,text:E}),C("comments"),y(!0)},onAskAbout:E=>de({prompt:`About this passage in ${ee}:
> ${E.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:bt,leading:R?null:s(X,{children:[I?o(_,{icon:Re,label:"Show files",onClick:()=>k(!0)}):null,o(_s,{doc:J,activePath:ee,onOpen:Ra,onPathChanged:je,hasDraft:yt})]})}):o("div",{className:"dd-file-pane dd-center",children:o(Pe,{icon:be,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),m?Pt:null]}),Le?o(Fe,{request:Le,onClose:()=>Be(null)}):null]})}var oa=globalThis.__ZCC_HOST_REACT_DOM__;if(oa==null)throw new Error("host react-dom is not available");var Yn=oa.createPortal,Ig=oa.flushSync,Cg=oa.hydrate,bg=oa.render,Sg=oa.unmountComponentAtNode,yg=oa.findDOMNode,Pg=oa.version;var It=null,ro=new Set;function ad(){ro.forEach(e=>e())}function Us(e){It!==e&&(It=e,ad())}function zs(e){It===e&&(It=null,ad())}function ed(e){return It===e}function Gs(e){return ro.add(e),()=>ro.delete(e)}function no(){let e=T(null);e.current||(e.current=Symbol("popover"));let a=e.current;return[vo(Gs,()=>ed(a),()=>!1),n=>{(typeof n=="function"?n(ed(a)):n)?Us(a):zs(a)}]}var js=typeof window>"u"?O:Ca,ra=8,td=4,Vs=160,$s=360,Ws=.55;function Xs(e,a,r){let t=Math.max(e.width,r),n=e.left;n+t>a.width-ra&&(n=e.right-t),n<ra&&(n=ra),n+t>a.width-ra&&(n=Math.max(ra,a.width-t-ra));let d=a.height-e.bottom-ra,i=e.top-ra,l=d<Vs&&i>d,c=Math.max(120,l?i:d),f=Math.min($s,Math.floor(a.height*Ws)),u=Math.min(c,f);return l?{left:n,width:t,maxHeight:u,bottom:a.height-e.top+td}:{left:n,width:t,maxHeight:u,top:e.bottom+td}}function Ks(e,a){if(e.sticky)return!0;let r=a.trim().toLowerCase();return r?`${e.label} ${e.compactLabel??""} ${e.description??""}`.toLowerCase().includes(r):!0}function Zs(e,a,r=!0){let t=[],n=[];for(let d of e){if(d.sticky){n.push(d);continue}(!r||Ks(d,a))&&t.push(d)}return{items:t,sticky:n}}function od({option:e,previousGroup:a,optionId:r,selected:t,active:n,onHover:d,onSelect:i}){return s("div",{children:[e.group&&e.group!==a&&o("div",{className:"launch-model-picker-group-label",children:e.group}),s("button",{type:"button",id:r,className:`launch-model-picker-option${e.description?" launch-model-picker-option--stacked":""}${e.className?` ${e.className}`:""}${t?" is-selected":""}${n?" is-active":""}${e.tone==="warning"?" is-warning":""}`,role:"option","aria-selected":t,"aria-disabled":e.disabled||void 0,disabled:e.disabled,tabIndex:-1,onMouseEnter:d,onFocus:d,onClick:i,children:[e.content||e.description?s("span",{className:"launch-model-picker-option-copy",children:[e.content??o("span",{children:e.label}),e.description?o("span",{className:"launch-model-picker-option-description",children:e.description}):null]}):o("span",{children:e.label}),t&&o(qe,{size:14,"aria-hidden":"true"})]})]})}function so({id:e,ariaLabel:a,value:r,options:t,onChange:n,placeholder:d="Select\u2026",disabled:i,title:l,ariaKeyshortcuts:c,searchable:f=!0,searchPlaceholder:u="Search\u2026",emptyHint:p="No matches",className:h="",triggerClassName:I="launch-model-picker-trigger",triggerTestId:x,triggerIcon:L,minWidth:k=200,anchorToParent:R=!1}){let[A,N]=no(),[v,H]=S(""),[w,F]=S(null),m=T(null),y=T(null),P=T(null),C=T(!1),q=Po(),[$,ne]=S(0),pe=t.find(D=>D.value===r),{items:te,sticky:oe}=W(()=>Zs(t,v,f),[t,v,f]),Y=W(()=>[...te,...oe],[oe,te]),de=Y[$],ce=D=>`${q}-${D.value}`,se=D=>{!D||D.disabled||(n(D.value),N(!1))},Le=D=>{Y.length!==0&&ne(V=>{for(let z=1;z<=Y.length;z+=1){let me=(V+D*z+Y.length)%Y.length;if(!Y[me].disabled)return me}return V})},Be=D=>{if(D.key==="Escape")D.preventDefault(),N(!1);else if(D.key==="ArrowDown")D.preventDefault(),Le(1);else if(D.key==="ArrowUp")D.preventDefault(),Le(-1);else if(D.key==="Home"){D.preventDefault();let V=Y.findIndex(z=>!z.disabled);V>=0&&ne(V)}else if(D.key==="End"){D.preventDefault();let V=Y.length-1-[...Y].reverse().findIndex(z=>!z.disabled);V>=0&&ne(V)}else D.key==="Enter"&&(D.preventDefault(),se(de))};return js(()=>{if(!A||!m.current)return;let D=R?m.current.parentElement?.getBoundingClientRect()??m.current.getBoundingClientRect():m.current.getBoundingClientRect();F(Xs(D,{width:window.innerWidth,height:window.innerHeight},k))},[A,R,k]),O(()=>{if(!A)return;let D=z=>{let me=z.target;m.current?.contains(me)||y.current?.contains(me)||N(!1)},V=z=>{z.key==="Escape"&&N(!1)};return document.addEventListener("mousedown",D,!0),document.addEventListener("keydown",V),()=>{document.removeEventListener("mousedown",D,!0),document.removeEventListener("keydown",V)}},[A]),O(()=>{if(A){let D=Y.findIndex(z=>z.value===r&&!z.disabled),V=Y.findIndex(z=>!z.disabled);ne(D>=0?D:Math.max(0,V)),f?P.current?.focus():y.current?.focus()}else H(""),C.current&&m.current?.focus();C.current=A},[A,f,r]),O(()=>{$>=Y.length&&ne(0)},[$,Y.length]),O(()=>{if(!A||!de||de.sticky)return;let D=y.current?.querySelector(`[id="${CSS.escape(ce(de))}"]`);D instanceof HTMLElement&&D.scrollIntoView({block:"nearest"})},[$,de,A]),s(X,{children:[s("button",{ref:m,id:e,type:"button",className:`${I} ${h}${pe?.tone==="warning"?" is-warning":""}`,disabled:i,title:l,"aria-keyshortcuts":c,onClick:()=>N(D=>!D),onKeyDown:D=>{(D.key==="ArrowDown"||D.key==="ArrowUp")&&(D.preventDefault(),N(!0))},"aria-haspopup":"listbox","aria-expanded":A,"aria-controls":A?q:void 0,"aria-label":a,"data-testid":x??e,children:[L,o("span",{children:pe?.compactLabel??pe?.label??d}),o(he,{size:14,"aria-hidden":"true"})]}),A&&Yn(s("div",{ref:y,className:"launch-model-picker-menu launch-model-picker-menu--split",role:"listbox",id:q,tabIndex:-1,"aria-label":a,"aria-activedescendant":de?ce(de):void 0,onKeyDown:Be,style:w?{left:w.left,width:w.width,maxHeight:w.maxHeight,...w.bottom!=null?{bottom:w.bottom,top:"auto"}:{top:w.top}}:{visibility:"hidden"},children:[f&&s("div",{className:"launch-model-picker-search",children:[o(pa,{size:13,"aria-hidden":"true"}),o("input",{ref:P,value:v,onChange:D=>H(D.target.value),placeholder:u,"aria-label":u,"aria-activedescendant":de?ce(de):void 0,onKeyDown:Be})]}),s("div",{className:"launch-model-picker-options",children:[te.map((D,V)=>o(od,{option:D,previousGroup:te[V-1]?.group,optionId:ce(D),selected:r===D.value,active:$===V,onHover:()=>ne(V),onSelect:()=>se(D)},D.value)),te.length===0&&o("div",{className:"launch-model-picker-hint",children:p})]}),oe.length>0&&o("div",{className:"launch-model-picker-footer",children:oe.map((D,V)=>{let z=te.length+V;return o(od,{option:D,previousGroup:V===0?void 0:oe[V-1]?.group,optionId:ce(D),selected:r===D.value,active:$===z,onHover:()=>ne(z),onSelect:()=>se(D)},D.value)})})]}),document.body)]})}var io="__global__",Qs=kt-600,Js=[{value:"active",label:"Active",description:"Everything except archived"},...At.map(e=>({value:e,label:Dt[e]})),{value:"all",label:"All statuses"}];function lo(e,a,r){return{value:e,label:a,content:s("span",{className:"dd-pick-row",children:[o("span",{className:"dd-pick-label",children:a}),o("span",{className:"dd-pick-count",children:r})]})}}function Ys(e,a,r){let t=new Map;for(let d of e)t.set(d.projectId,(t.get(d.projectId)??0)+1);let n=[lo("","All projects",e.length)];(t.has(null)||r===io)&&n.push(lo(io,"Global docs",t.get(null)??0));for(let d of a)(t.has(d.id)||r===d.id)&&n.push(lo(d.id,d.name,t.get(d.id)??0));return n}function el(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function al(e,a){let[r,t]=S(e);return O(()=>{let n=setTimeout(()=>t(e),a);return()=>clearTimeout(n)},[e,a]),r}function tl({doc:e,active:a,projectName:r,now:t,menuOpen:n,onSelect:d,onMenu:i}){return s("button",{type:"button",className:`dd-doc-row${a?" on":""}${n?" dd-doc-row-menu":""}`,onClick:d,onContextMenu:l=>{l.preventDefault(),i(tn(l))},"aria-current":a?"page":void 0,"aria-haspopup":"menu",children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:e.title}),o(aa,{status:e.status,compact:!0})]}),e.summary?o("span",{className:"dd-doc-row-summary",children:e.summary}):null,s("span",{className:"dd-doc-row-meta",children:[r!==null?o("span",{className:"dd-doc-row-project",title:r,children:r}):null,s("span",{title:`${e.fileCount} files`,children:[o(ia,{size:11,"aria-hidden":!0})," ",e.fileCount]}),e.openComments?s("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[o(Te,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,e.updatedBy.kind==="agent"?o("span",{title:"Last edited by an agent",children:o(ue,{size:11,"aria-label":"Last edited by an agent"})}):null,o("span",{className:"dd-spacer"}),o(ie,{at:e.updatedAt,now:t})]})]})}function ol({projectId:e,showProjects:a,projects:r,activeId:t,onSelect:n,onDeleted:d,onNew:i,onCollapse:l,headerActions:c}){let[f,u]=S(""),[p,h]=le("list-status","active"),[I,x]=le("list-project",""),[L,k]=S(null),R=Bt(r),A=al(f.trim(),200),N=ba(),v=Tt({...e?{projectId:e}:{},...A?{query:A}:{},status:p}),H=W(()=>new Map(r.map(y=>[y.id,y.name])),[r]),w=W(()=>{let y=v.data??[];return!a||!I?y:y.filter(P=>I===io?P.projectId===null:P.projectId===I)},[v.data,a,I]),F=p!=="active"||a&&!!I,m=W(()=>a?Ys(v.data??[],r,I):[],[a,v.data,r,I]);return s("div",{className:"dd-list",children:[s("div",{className:"dd-list-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),v.data?o("span",{className:"dd-list-count",title:`${w.length} ${w.length===1?"doc":"docs"}`,children:w.length}):null,o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary dd-new",onClick:i,children:[o(Ie,{size:13,"aria-hidden":!0})," New"]}),o(_,{icon:Me,label:"Hide doc list",onClick:l}),c]}),o("div",{className:"dd-list-tools",children:s("label",{className:"dd-search",children:[o(pa,{size:13,"aria-hidden":!0}),o("input",{value:f,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:y=>u(y.target.value)}),f?o("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>u(""),children:o(re,{size:12,"aria-hidden":!0})}):null]})}),s("div",{className:"dd-list-filters",children:[o(so,{ariaLabel:"Filter by status",value:p,options:Js,onChange:h,searchable:!1,triggerClassName:`launch-model-picker-trigger dd-pick${p!=="active"?" on":""}`,triggerIcon:o(Ua,{size:12,"aria-hidden":!0})}),a?o(so,{ariaLabel:"Filter by project",value:I,options:m,onChange:x,searchable:m.length>8,searchPlaceholder:"Search projects\u2026",minWidth:220,triggerClassName:`launch-model-picker-trigger dd-pick${I?" on":""}`,triggerIcon:o(_e,{size:12,"aria-hidden":!0})}):null]}),s("div",{className:"dd-list-scroll",children:[v.error?o("div",{className:"dd-banner dd-banner-error",children:v.error}):null,!v.data&&v.loading?o("div",{className:"dd-center",children:o(Q,{label:"Loading design docs"})}):null,v.data&&!w.length?o("div",{className:"dd-list-empty dd-muted",children:A||F?"No docs match.":"No design docs yet."}):null,w.map(y=>o(tl,{doc:y,active:y.id===t,projectName:a?y.projectId?H.get(y.projectId)??"Unknown project":"Global":y.projectId?null:"Global",now:N,menuOpen:L?.doc.id===y.id,onSelect:()=>n(y.id),onMenu:P=>k({doc:y,at:P})},y.id))]}),L?o(on,{at:L.at,label:`Actions for ${L.doc.title}`,onClose:()=>k(null),children:R.items(L.doc,()=>k(null),()=>d(L.doc.id),L.doc.id===t?void 0:()=>n(L.doc.id))},`${L.doc.id}@${L.at.x},${L.at.y}`):null,R.dialogs]})}function rd({templates:e,selected:a,onSelect:r}){return o("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(t=>s("button",{type:"button",role:"radio","aria-checked":a===t.id,className:`dd-template${a===t.id?" on":""}`,onClick:()=>r(t.id),children:[o("span",{className:"dd-template-label",children:t.label}),o("span",{className:"dd-template-desc",children:t.description}),o("span",{className:"dd-template-files",children:t.files.join(" \xB7 ")})]},t.id))})}function uo({initialTemplate:e,defaultProjectId:a,projects:r,onClose:t,onCreated:n}){let d=j(),i=Oe(),l=Ut(),[c,f]=S(""),[u,p]=S(""),[h,I]=S(e??null),[x,L]=S(a??""),[k,R]=S(""),[A,N]=S(""),[v,H]=S(!1),w=h??l.data?.[0]?.id??null,F=!!A.trim(),m=x||a||r[0]?.id||"",y=async()=>{if(!(!c.trim()||v)){H(!0);try{let P=await d.create({title:c.trim(),...u.trim()?{summary:u.trim()}:{},...w?{template:w}:{},tags:k.split(",").map(C=>C.trim().toLowerCase()).filter(Boolean),projectId:x||null});if(n(P.id),F)if(!m)B("Doc created. Add a project to let an agent draft it.","error");else{let C=await d.askAgent(P.id,{prompt:el(A),projectId:m});i.openThreadPanel({actionId:ta,title:P.title,params:{docId:P.id},threadId:C.threadId}),i.toThread(C.threadId),B(`An agent is drafting \u201C${P.title}\u201D. Watch it fill in beside the chat.`)}t()}catch(P){B(`Could not create the doc: ${U(P)}`,"error"),H(!1)}}};return o(ft,{title:"New design doc",wide:!0,onClose:t,footer:s(X,{children:[o("span",{className:"dd-muted dd-dialog-hint",children:F?"An agent starts a new thread to draft it.":"You can ask an agent to fill it in later."}),o("span",{className:"dd-spacer"}),o("button",{type:"button",className:"btn",onClick:t,children:"Cancel"}),s("button",{type:"button",className:"btn primary",disabled:!c.trim()||v,onClick:()=>{y()},children:[v?o(Q,{size:12}):F?o(ae,{size:12,"aria-hidden":!0}):null,F?"Create & draft with agent":"Create"]})]}),children:s("form",{className:"dd-form",onSubmit:P=>{P.preventDefault(),y()},children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Title"}),o("input",{className:"dd-input",value:c,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:P=>f(P.target.value),autoFocus:!0})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Summary"}),o("input",{className:"dd-input",value:u,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:P=>p(P.target.value)})]}),s("div",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Template"}),l.data?o(rd,{templates:l.data,selected:w,onSelect:I}):o(Q,{label:"Loading templates"})]}),s("div",{className:"dd-field-row",children:[s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Project"}),s("select",{className:"dd-input dd-select",value:x,onChange:P=>L(P.target.value),children:[o("option",{value:"",children:"Global (all projects)"}),r.map(P=>o("option",{value:P.id,children:P.name},P.id))]})]}),s("label",{className:"dd-field",children:[o("span",{className:"dd-field-label",children:"Tags"}),o("input",{className:"dd-input",value:k,placeholder:"sync, mobile",onChange:P=>R(P.target.value)})]})]}),s("label",{className:"dd-field",children:[s("span",{className:"dd-field-label",children:[o(ae,{size:12,"aria-hidden":!0})," Brief for an agent ",o("span",{className:"dd-muted",children:"(optional)"})]}),o("textarea",{className:"dd-input",rows:4,value:A,maxLength:Qs,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:P=>N(P.target.value)})]}),o("button",{type:"submit",hidden:!0})]})})}function rl({templates:e,onNew:a}){return o("div",{className:"dd-landing",children:s("div",{className:"dd-landing-inner",children:[o("span",{className:"dd-landing-icon",children:o(We,{size:26,"aria-hidden":!0})}),o("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),o("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),s("ul",{className:"dd-landing-points",children:[s("li",{children:[o(ae,{size:13,"aria-hidden":!0})," ",o("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),s("li",{children:[o(Te,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),s("li",{children:[o(ue,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),s("div",{className:"dd-landing-start",children:[o("span",{className:"dd-section-label",children:"Start from a template"}),e?o(rd,{templates:e,selected:null,onSelect:r=>a(r)}):o(Q,{})]})]})})}function co({projectId:e,location:a,onLocationChange:r,variant:t,headerActions:n}){let d=ea(),i=Ut(),[l,c]=S(null),[f,u]=le("list-open",!0),p=d.data??[];return s("div",{className:"dd-root dd-workbench",children:[f?o(ol,{projectId:t==="project"?e:null,showProjects:t==="global",projects:p,activeId:a.docId,onSelect:h=>r({docId:h,path:null}),onDeleted:h=>{h===a.docId&&r({docId:null,path:null})},onNew:()=>c({template:null}),onCollapse:()=>u(!1),headerActions:n}):s("nav",{className:"dd-list-collapsed","aria-label":"Design docs",children:[o(_,{icon:Re,label:"Show doc list",onClick:()=>u(!0)}),o(_,{icon:Ie,label:"New design doc",onClick:()=>c({template:null})}),n]}),o("main",{className:"dd-main",children:a.docId?o(qt,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(h,I)=>r({docId:a.docId,path:h},I??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):o(rl,{templates:i.data,onNew:h=>c({template:h??null})})}),l?o(uo,{initialTemplate:l.template,defaultProjectId:e,projects:p,onClose:()=>c(null),onCreated:h=>r({docId:h,path:null})}):null]})}var Aa="design-docs";function nd({children:e}){return o("div",{className:"dd-root",children:e})}function dd({subPath:e}){let a=Oe();return o(co,{variant:"global",projectId:null,location:Gt(e),onLocationChange:(r,t)=>a.toPluginPanel(Aa,{subPath:Pa(r),...t?{replace:t}:{}})})}function sd({projectId:e,headerActions:a}){let[r,t]=le(`project-location:${e}`,"");return o(co,{variant:"project",projectId:e,location:Gt(r),onLocationChange:n=>t(Pa(n)),headerActions:a})}function nl(e,a,r,t){e.openThreadPanel({actionId:ta,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...t?{threadId:t}:{}})||e.toPluginPanel(Aa,{subPath:Pa(a)})}function ld({attributes:e,source:a,message:r}){let t=Oe(),n=e.id?.trim()||null,d=e.path?.trim()||null,i=Mt(n);if(!n||i.error)return o("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:n?`Design doc unavailable: ${i.error}`:"Invalid design doc link: an id is required."});let l=i.data;return s("div",{className:"plugin-directive-card dd-card",children:[s("button",{type:"button",className:"plugin-directive-card-main",disabled:!l,onClick:()=>l&&nl(t,{docId:l.id,path:d},l.title,r.threadId),title:l?`Open ${l.title} beside this conversation`:void 0,children:[o("span",{className:"dd-card-icon","aria-hidden":!0,children:o(We,{size:14})}),o("span",{className:"plugin-directive-card-kind",children:"Design doc"}),o("span",{className:"plugin-directive-card-title",children:l?l.title:"Loading\u2026"}),l?s("span",{className:"plugin-directive-card-meta dd-card-meta",children:[d?o("code",{children:d}):null,o(aa,{status:l.status,compact:!0}),l.files.length," file",l.files.length===1?"":"s",l.openComments?` \xB7 ${l.openComments} open comment${l.openComments===1?"":"s"}`:""]}):o(Q,{size:12})]}),l?o("button",{type:"button",className:"plugin-directive-card-open",onClick:c=>{c.stopPropagation(),t.toPluginPanel(Aa,{subPath:Pa({docId:l.id,path:d})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function dl({projectId:e,onPick:a}){let r=Tt({...e?{projectId:e}:{},status:"active"}),t=ea(),n=ba(),[d,i]=S(!1);return s("div",{className:"dd-picker",children:[s("div",{className:"dd-picker-head",children:[o("span",{className:"dd-list-title",children:"Design docs"}),o("span",{className:"dd-spacer"}),s("button",{type:"button",className:"btn primary",onClick:()=>i(!0),children:[o(Ie,{size:13,"aria-hidden":!0})," New"]})]}),o("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(l=>s("button",{type:"button",className:"dd-doc-row",onClick:()=>a(l.id),children:[s("span",{className:"dd-doc-row-top",children:[o("span",{className:"dd-doc-row-title",children:l.title}),o(aa,{status:l.status,compact:!0})]}),l.summary?o("span",{className:"dd-doc-row-summary",children:l.summary}):null,s("span",{className:"dd-doc-row-meta",children:[s("span",{children:[l.fileCount," files"]}),o("span",{className:"dd-spacer"}),o(ie,{at:l.updatedAt,now:n})]})]},l.id)):o(Pe,{icon:We,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):o("div",{className:"dd-center",children:r.error?o("div",{className:"dd-banner dd-banner-error",children:r.error}):o(Q,{})})}),d?o(uo,{defaultProjectId:e,projects:t.data??[],onClose:()=>i(!1),onCreated:l=>a(l)}):null]})}function id(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function ud(e){let{docId:a,path:r}=id(e.params);return o(sl,{...e},`${a}\0${r}`)}function sl({params:e,projectId:a}){let r=Oe(),t=id(e),[n,d]=S(t),i=!t.docId;if(!n.docId)return o(nd,{children:o(dl,{projectId:a??null,onPick:c=>d({docId:c,path:null})})});let l=n.docId;return o(nd,{children:o(qt,{docId:l,path:n.path,layout:"compact",contextProjectId:a??null,onOpenPath:c=>d({docId:l,path:c}),onDeleted:()=>d({docId:null,path:null}),headerExtra:s(X,{children:[i?o(_,{icon:sa,label:"All design docs",onClick:()=>d({docId:null,path:null})}):null,o(_,{icon:He,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(Aa,{subPath:Pa(n)})})]})},l)})}async function cd({threadId:e,message:a,selectedText:r,openPanel:t}){let n=(r?.trim()||a.text).trim();if(!n){B("This message has no text to save.","error");return}try{let d=await go(Vr,"createFromMessage",{threadId:e,text:n});t({actionId:ta,title:d.title,params:{docId:d.id}}),B(`Saved \u201C${d.title}\u201D as a design doc`)}catch(d){B(`Could not save the design doc: ${U(d)}`,"error")}}var fo=`
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
`;var fd="design-docs-plugin-styles";function ll(){if(typeof document>"u")return;let e=document.getElementById(fd);if(e instanceof HTMLStyleElement){e.textContent=fo;return}let a=document.createElement("style");a.id=fd,a.textContent=fo,document.head.appendChild(a)}ll();var mh=ho(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:Aa,component:dd}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:sd}),e.slots.messageDirective({id:"design-doc",component:ld}),e.slots.threadPanelAction({id:ta,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:ud}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:cd})});export{mh as default,ll as injectStyles};
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
lucide-react/dist/esm/icons/circle-dot.mjs:
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
