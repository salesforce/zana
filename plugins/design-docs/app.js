function Cr(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function va(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}function Za(e){throw new Error(`${e} is not available until the host plugin runtime is installed`)}async function Ja(e,a,r){return Cr().callRpc(e,a,r)}function Qa(e){return{__zccPluginApp:!0,setup:e}}function Ya(){return va().useRpc?.()??Za("useRpc")}function et(e,a){va().useRealtime?.(e,a)}function se(){return va().useZccNavigate?.()??Za("useZccNavigate")}function Sr(){return globalThis.__ZCC_HOST_REACT__}function br(e,a){let r=Sr(),o=va()[e];return!r||!o?null:r.createElement(o,a)}function ka(e){return br("Markdown",e)}var F=globalThis.__ZCC_HOST_REACT__;var Rd=F.Children,Fd=F.Component,Bd=F.Fragment,Nd=F.StrictMode,qd=F.Suspense,Od=F.cloneElement,at=F.createContext,Re=F.createElement,Ed=F.createRef,Aa=F.forwardRef,Hd=F.isValidElement,Ud=F.lazy,zd=F.memo,_d=F.startTransition,le=F.useCallback,tt=F.useContext,Gd=F.useDebugValue,ot=F.useDeferredValue,N=F.useEffect,jd=F.useId,Vd=F.useImperativeHandle,Wd=F.useInsertionEffect,$d=F.useLayoutEffect,U=F.useMemo,Xd=F.useReducer,B=F.useRef,b=F.useState,Kd=F.useSyncExternalStore,Zd=F.useTransition,Jd=F.version;var rt=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function dt(e,a,r=[]){if(a==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:rt(e),size:24,node:a,...r.length>0?{aliases:r}:{}}}var st=e=>{let a="",r=!1;for(let o of e){if(o==="-"||o==="_"||o<=" "){r=a.length>0;continue}a.length===0?a+=o.toLowerCase():a+=r?o.toUpperCase():o,r=!1}return a};var lt=e=>{let a=st(e);return a.charAt(0).toUpperCase()+a.slice(1)};var ze=(...e)=>e.filter((a,r,o)=>!!a&&a.trim()!==""&&o.indexOf(a)===r).join(" ").trim();var ue={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function qa(e){return e!=null}function nt(e,a={}){let r=a.attributeNames??{},o=L=>r[L]??L,d=e.size??e.width??ue.width,s=e.size??e.height??ue.height,n=e.aliases?.filter(L=>typeof L=="string"&&L.trim()!=="").map(L=>`lucide-${L}`)??[],i=[...e.name?[`lucide-${e.name}`]:[],...n],f=a.className?.split(" ").filter(Boolean)??[],u=a.includeDefaultClasses===!1?ze(...f):ze("lucide",...i,...f),g=a.absoluteStrokeWidth?Number(a.strokeWidth??ue["stroke-width"])*Number(e.size??e.width??ue.width)/Number(a.size??a.width??ue.width):a.strokeWidth??ue["stroke-width"];return["svg",{...Object.entries(ue).reduce((L,[C,h])=>(L[o(C)]=h,L),{}),..."color"in a&&a.color&&{[o("stroke")]:a.color},..."size"in a&&qa(a.size)&&{[o("width")]:a.size,[o("height")]:a.size},..."width"in a&&qa(a.width)&&{[o("width")]:a.width},..."height"in a&&qa(a.height)&&{[o("height")]:a.height},[o("stroke-width")]:g,...u&&{[o("class")]:u},[o("viewBox")]:`0 0 ${d} ${s}`,...a.hasA11yProp===!1?{[o("aria-hidden")]:"true"}:{},..."attributes"in a&&a.attributes},e.node.map(L=>{let[C,h,x]=L,k=a.nonScalingStroke?{[o("vector-effect")]:"non-scaling-stroke",...h}:h;return x?[C,k,x]:[C,k]})]}function it(e,a={}){return nt(e,{...a,attributeNames:{...a.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var ut=e=>{for(let a in e)if(a.startsWith("aria-")||a==="role"||a==="title")return!0;return!1};var Pr=at({});var ft=()=>tt(Pr);var ct=Aa(({color:e,size:a,width:r,height:o,strokeWidth:d,absoluteStrokeWidth:s,nonScalingStroke:n,className:i="",children:f,iconNode:u=[],icon:g={node:u,aliases:[],size:24},...I},L)=>{let{size:C=24,strokeWidth:h=2,absoluteStrokeWidth:x=!1,nonScalingStroke:k=!1,color:y="currentColor",className:D=""}=ft()??{},R=!!f||ut(I),[T,v,S=[]]=it(g,{color:e??y,width:r??a??C,height:o??a??C,strokeWidth:d??h,absoluteStrokeWidth:s??x,nonScalingStroke:n??k,className:ze(D,i),hasA11yProp:R,attributes:I});return Re(T,{ref:L,...v},[...S.map(([p,m])=>Re(p,m)),...Array.isArray(f)?f:[f]])});function c(e,a=[],r=[]){let o=typeof e=="string"?dt(e,a,r):e,d=Aa(({className:s,...n},i)=>Re(ct,{ref:i,icon:o,className:s,...n}));return o.name&&(d.displayName=lt(o.name)),d}var pt={name:"archive-restore",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h2",key:"tvwodi"}],["path",{d:"M20 8v11a2 2 0 0 1-2 2h-2",key:"1gkqxj"}],["path",{d:"m9 15 3-3 3 3",key:"1pd0qc"}],["path",{d:"M12 12v9",key:"192myk"}]]};pt.node;var _e=c(pt);var mt={name:"archive",size:24,node:[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]};mt.node;var Ge=c(mt);var gt={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};gt.node;var je=c(gt);var xt={name:"at-sign",size:24,node:[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]};xt.node;var Ve=c(xt);var ht={name:"bot",size:24,node:[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]};ht.node;var V=c(ht);var Lt={name:"check-check",size:24,node:[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]};Lt.node;var We=c(Lt);var It={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};It.node;var ve=c(It);var Ct={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};Ct.node;var J=c(Ct);var St={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};St.node;var ke=c(St);var bt={name:"columns-2",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]],aliases:["columns"]};bt.node;var fe=c(bt);var Pt={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};Pt.node;var $e=c(Pt);var wt={name:"drafting-compass",size:24,node:[["path",{d:"m12.99 6.74 1.93 3.44",key:"iwagvd"}],["path",{d:"M19.136 12a10 10 0 0 1-14.271 0",key:"ppmlo4"}],["path",{d:"m21 21-2.16-3.84",key:"vylbct"}],["path",{d:"m3 21 8.02-14.26",key:"1ssaw4"}],["circle",{cx:"12",cy:"5",r:"2",key:"f1ur92"}]]};wt.node;var ce=c(wt);var yt={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};yt.node;var re=c(yt);var vt={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};vt.node;var Xe=c(vt);var kt={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};kt.node;var Ke=c(kt);var At={name:"file-code",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}]]};At.node;var Ze=c(At);var Dt={name:"file-exclamation-point",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["file-warning"]};Dt.node;var ne=c(Dt);var Tt={name:"file-image",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]};Tt.node;var Je=c(Tt);var Mt={name:"file-pen",size:24,node:[["path",{d:"M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34",key:"o6klzx"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z",key:"zhnas1"}]],aliases:["file-edit"]};Mt.node;var pe=c(Mt);var Rt={name:"file-plus-corner",size:24,node:[["path",{d:"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35",key:"17jvcc"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M14 19h6",key:"bvotb8"}],["path",{d:"M17 16v6",key:"18yu1i"}]],aliases:["file-plus-2"]};Rt.node;var me=c(Rt);var Ft={name:"file-text",size:24,node:[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]};Ft.node;var Ae=c(Ft);var Bt={name:"file-x-corner",size:24,node:[["path",{d:"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5",key:"1jo35a"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"m15 17 5 5",key:"36xl1x"}],["path",{d:"m20 17-5 5",key:"vdz27y"}]],aliases:["file-x-2"]};Bt.node;var ge=c(Bt);var Nt={name:"folder-input",size:24,node:[["path",{d:"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1",key:"fm4g5t"}],["path",{d:"M2 13h10",key:"pgb2dq"}],["path",{d:"m9 16 3-3-3-3",key:"6m91ic"}]]};Nt.node;var Qe=c(Nt);var qt={name:"folder-open",size:24,node:[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]};qt.node;var Ye=c(qt);var Ot={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};Ot.node;var ea=c(Ot);var Et={name:"funnel",size:24,node:[["path",{d:"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z",key:"sc7q7i"}]],aliases:["filter"]};Et.node;var xe=c(Et);var Ht={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};Ht.node;var aa=c(Ht);var Ut={name:"hash",size:24,node:[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]};Ut.node;var Fe=c(Ut);var zt={name:"house",size:24,node:[["path",{d:"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",key:"5wwlr5"}],["path",{d:"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"r6nss1"}]],aliases:["home"]};zt.node;var he=c(zt);var _t={name:"image-plus",size:24,node:[["path",{d:"M16 5h6",key:"1vod17"}],["path",{d:"M19 2v6",key:"4bpg5p"}],["path",{d:"M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5",key:"1ue2ih"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}]]};_t.node;var ta=c(_t);var Gt={name:"list-checks",size:24,node:[["path",{d:"M13 5h8",key:"a7qcls"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 19h8",key:"c3s6r1"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}]]};Gt.node;var oa=c(Gt);var jt={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};jt.node;var Le=c(jt);var Vt={name:"message-square-plus",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M12 8v6",key:"1ib9pf"}],["path",{d:"M9 11h6",key:"1fldmi"}]]};Vt.node;var ra=c(Vt);var Wt={name:"message-square-text",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}],["path",{d:"M7 11h10",key:"1twpyw"}],["path",{d:"M7 15h6",key:"d9of3u"}],["path",{d:"M7 7h8",key:"af5zfr"}]]};Wt.node;var da=c(Wt);var $t={name:"message-square",size:24,node:[["path",{d:"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",key:"18887p"}]]};$t.node;var de=c($t);var Xt={name:"monitor",size:24,node:[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]};Xt.node;var sa=c(Xt);var Kt={name:"move-right",size:24,node:[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]};Kt.node;var la=c(Kt);var Zt={name:"panel-right",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M15 3v18",key:"14nvp0"}]]};Zt.node;var na=c(Zt);var Jt={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};Jt.node;var De=c(Jt);var Qt={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};Qt.node;var Q=c(Qt);var Yt={name:"rotate-ccw-clock",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]],aliases:["history"]};Yt.node;var Y=c(Yt);var eo={name:"rotate-ccw",size:24,node:[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]};eo.node;var ie=c(eo);var ao={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};ao.node;var ia=c(ao);var to={name:"scan-search",size:24,node:[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}],["path",{d:"m16 16-1.9-1.9",key:"1dq9hf"}]]};to.node;var ua=c(to);var oo={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};oo.node;var fa=c(oo);var ro={name:"smartphone",size:24,node:[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]};ro.node;var ca=c(ro);var so={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};so.node;var G=c(so);var lo={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};lo.node;var pa=c(lo);var no={name:"tablet",size:24,node:[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]};no.node;var ma=c(no);var io={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};io.node;var Z=c(io);var uo={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};uo.node;var Ie=c(uo);var fo={name:"unlink",size:24,node:[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]};fo.node;var ga=c(fo);var co={name:"user",size:24,node:[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]};co.node;var xa=c(co);var po={name:"wand-sparkles",size:24,node:[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]],aliases:["wand-2"]};po.node;var Ce=c(po);var mo={name:"workflow",size:24,node:[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]};mo.node;var ha=c(mo);var go={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};go.node;var W=c(go);var xo=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];var Da=4e3;function wr(e){return Object.fromEntries(Object.entries(e).filter(([,a])=>a!==void 0))}function yr(e){let a=(o,d)=>e(o,d===void 0?void 0:wr(d)),r=async o=>{await o};return{templates:()=>a("templates"),projects:()=>a("projects"),list:(o={})=>a("list",o),get:o=>a("get",{doc:o}),create:o=>a("create",o),update:(o,d)=>a("update",{doc:o,...d}),remove:o=>r(a("remove",{doc:o})),readFile:(o,d)=>a("readFile",{doc:o,path:d}),writeFile:(o,d)=>a("writeFile",{doc:o,...d}),editFile:(o,d)=>a("editFile",{doc:o,...d}),deleteFile:(o,d)=>r(a("deleteFile",{doc:o,path:d})),renameFile:(o,d,s)=>a("renameFile",{doc:o,from:d,to:s}),history:(o,d={})=>a("history",{doc:o,...d}),revision:(o,d)=>a("revision",{doc:o,id:d}),restore:(o,d)=>a("restore",{doc:o,id:d}),addComment:(o,d)=>a("addComment",{doc:o,...d}),setCommentStatus:(o,d,s)=>a("setCommentStatus",{doc:o,id:d,status:s}),deleteComment:(o,d)=>r(a("deleteComment",{doc:o,id:d})),unlinkThread:(o,d)=>r(a("unlinkThread",{doc:o,threadId:d})),askAgent:(o,d)=>a("askAgent",{doc:o,...d,path:d.path??void 0})}}function O(){let e=Ya();return U(()=>yr((a,r)=>e.call(a,r)),[e])}function q(e){return(e instanceof Error?e.message:String(e)).replace(/^(Error invoking remote method '[^']+': )?(Error: )?/,"")}function ho(e){return/changed since revision/i.test(q(e))}function A(e,a="info"){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,a)}var Lo="design-docs";var Io="changed",Ta=["draft","review","approved","implemented","archived"],La={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function Co(e,a){let r=o=>o.replace(/["\\\n\r]/g,"");return a?`::design-doc{id="${r(e)}" path="${r(a)}"}`:`::design-doc{id="${r(e)}"}`}function Se(e,a){let[r,o]=b({key:e,data:null,error:null,loading:e!==null}),[d,s]=b(0),n=B(a);n.current=a,N(()=>{if(e===null){o({key:e,data:null,error:null,loading:!1});return}let u=!1;return o(g=>({key:e,data:g.key===e?g.data:null,error:null,loading:!0})),n.current().then(g=>{u||o({key:e,data:g,error:null,loading:!1})},g=>{u||o(I=>({key:e,data:I.key===e?I.data:null,error:q(g),loading:!1}))}),()=>{u=!0}},[e,d]);let i=le(()=>s(u=>u+1),[]),f=r.key===e;return{data:f?r.data:null,error:f?r.error:null,loading:f?r.loading:e!==null,reload:i}}function bo(e,a=120){let r=B(e);r.current=e;let o=B(new Set),d=B(null);N(()=>()=>{d.current&&clearTimeout(d.current)},[]),et(Io,s=>{let n=typeof s?.docId=="string"?s.docId:null;o.current.add(n),!d.current&&(d.current=setTimeout(()=>{d.current=null;let i=[...o.current];o.current.clear();for(let f of i)r.current(f)},a))})}function Ma(e){let a=O(),r=Se(JSON.stringify(e),()=>a.list(e));return bo(()=>r.reload()),r}function Ra(e){let a=O(),r=Se(e,()=>a.get(e));return bo(o=>{(o===null||o===e)&&r.reload()}),r}function Po(e,a,r){let o=O(),d=e&&a&&r!==null?`${e}\0${a}\0${r}`:null;return Se(d,()=>o.readFile(e,a))}function Oa(){let e=O();return Se("templates",()=>e.templates())}function be(){let e=O();return Se("projects",()=>e.projects())}var So="zcc.design-docs.";function K(e,a){let[r,o]=b(()=>{try{let s=globalThis.localStorage?.getItem(So+e);if(s==null)return a;let n=JSON.parse(s);return typeof n==typeof a?n:a}catch{return a}}),d=le(s=>{o(s);try{globalThis.localStorage?.setItem(So+e,JSON.stringify(s))}catch{}},[e]);return[r,d]}function Be(e=6e4){let[a,r]=b(()=>Date.now());return N(()=>{let o=setInterval(()=>r(Date.now()),e);return()=>clearInterval(o)},[e]),a}function Te(e){return e>=1024*1024?`${Math.round(e/(1024*1024)*10)/10} MiB`:e>=1024?`${Math.round(e/1024)} KiB`:`${e} B`}function wo(e,a=Date.now()){let r=Math.max(0,Math.round((a-e)/1e3));if(r<45)return"just now";let o=Math.round(r/60);if(o<60)return`${o}m ago`;let d=Math.round(o/60);if(d<24)return`${d}h ago`;let s=Math.round(d/24);return s<30?`${s}d ago`:new Date(e).toISOString().slice(0,10)}var yo=globalThis.__ZCC_HOST_REACT__,z=yo.Fragment;function t(e,a,r){return yo.createElement(e,r===void 0?a:{...a,key:r})}var l=t;var vr={MessageSquareText:da,CheckCheck:We,WandSparkles:Ce,Workflow:ha,ScanSearch:ua,ListChecks:oa};function vo(e){return vr[e]??G}function Ne({kind:e,size:a=14}){return t(e==="image"||e==="svg"?Je:e==="markdown"||e==="text"?Ae:Ze,{size:a,className:`dd-file-icon dd-kind-${e}`,"aria-hidden":!0})}function Pe({status:e,compact:a=!1}){return l("span",{className:`dd-status dd-status-${e}${a?" dd-status-compact":""}`,children:[t("span",{className:"dd-status-dot","aria-hidden":!0}),La[e]]})}function ee({actor:e}){let a=e.kind==="agent"?V:xa;return l("span",{className:`dd-actor dd-actor-${e.kind}`,title:e.kind==="agent"?`Agent \xB7 ${e.label}`:e.label,children:[t(a,{size:12,"aria-hidden":!0}),t("span",{className:"dd-actor-label",children:e.label})]})}function $({at:e,now:a}){return t("time",{className:"dd-time",dateTime:new Date(e).toISOString(),title:new Date(e).toLocaleString(),children:wo(e,a)})}function H({size:e=14,label:a}){return t("span",{className:"dd-spinner",role:"status","aria-label":a??"Loading",children:t(Le,{size:e,className:"dd-spin","aria-hidden":!0})})}function ae({icon:e,title:a,children:r}){return l("div",{className:"dd-empty",children:[t("span",{className:"dd-empty-icon",children:t(e,{size:22,"aria-hidden":!0})}),t("div",{className:"dd-empty-title",children:a}),r?t("div",{className:"dd-empty-body",children:r}):null]})}function E({icon:e,label:a,onClick:r,active:o=!1,danger:d=!1,disabled:s=!1,size:n=14}){return t("button",{type:"button",className:`icon-btn dd-icon-btn${o?" on":""}${d?" danger":""}`,title:a,"aria-label":a,"aria-pressed":o||void 0,disabled:s,onClick:r,children:t(e,{size:n,"aria-hidden":!0})})}function kr(e,a){let r=B(null),o=B(a);return o.current=a,N(()=>{if(!e)return;let d=n=>{r.current&&n.target instanceof Node&&!r.current.contains(n.target)&&o.current()},s=n=>{n.key==="Escape"&&o.current()};return document.addEventListener("mousedown",d),document.addEventListener("keydown",s),()=>{document.removeEventListener("mousedown",d),document.removeEventListener("keydown",s)}},[e]),r}function te({open:e,onClose:a,anchor:r,children:o,align:d="end",className:s=""}){let n=kr(e,a);return l("div",{className:"dd-pop-anchor",ref:n,children:[r,e?t("div",{className:`dd-pop dd-pop-${d} ${s}`,role:"dialog",children:o}):null]})}function X({icon:e,label:a,hint:r,onSelect:o,danger:d=!1,checked:s=!1}){return l("button",{type:"button",role:"menuitem",className:`dd-menu-item${d?" dd-menu-danger":""}${s?" dd-menu-checked":""}`,onClick:o,children:[e?t(e,{size:14,"aria-hidden":!0}):null,t("span",{className:"dd-menu-label",children:a}),r?t("span",{className:"dd-menu-hint",children:r}):null]})}function qe({request:e,onClose:a}){let[r,o]=b(!1),d=async()=>{o(!0);try{await e.run()}finally{o(!1),a()}};return t(Ia,{title:e.title,onClose:a,footer:l(z,{children:[t("button",{type:"button",className:"btn",onClick:a,children:"Cancel"}),t("button",{type:"button",className:`btn primary${e.danger?" dd-btn-danger":""}`,disabled:r,onClick:()=>{d()},autoFocus:!0,children:e.confirmLabel})]}),children:t("div",{className:"dd-confirm-body",children:e.body})})}function Ia({title:e,onClose:a,children:r,footer:o,wide:d=!1}){return N(()=>{let s=n=>{n.key==="Escape"&&a()};return document.addEventListener("keydown",s),()=>document.removeEventListener("keydown",s)},[a]),t("div",{className:"dd-dialog-backdrop",onMouseDown:s=>{s.target===s.currentTarget&&a()},children:l("div",{className:`dd-dialog${d?" dd-dialog-wide":""}`,role:"dialog","aria-modal":"true","aria-label":e,children:[l("div",{className:"dd-dialog-header",children:[t("span",{className:"dd-dialog-title",children:e}),t(E,{icon:W,label:"Close",onClick:a})]}),t("div",{className:"dd-dialog-body",children:r}),o?t("div",{className:"dd-dialog-footer",children:o}):null]})})}var Ar={author:"Author",editor:"Editor",reviewer:"Reviewer",assistant:"Assistant"},we="design-doc";function ko({doc:e,now:a}){let r=O(),o=se(),d=[...e.threads].sort((s,n)=>n.lastActivityAt-s.lastActivityAt);return t("div",{className:"dd-rail-pane dd-agents",children:l("div",{className:"dd-rail-scroll",children:[d.length?t("ul",{className:"dd-thread-list",children:d.map(s=>l("li",{className:"dd-thread",children:[l("button",{type:"button",className:"dd-thread-open",onClick:()=>o.toThread(s.threadId),title:"Open thread",children:[t(V,{size:14,"aria-hidden":!0}),l("span",{className:"dd-thread-main",children:[t("span",{className:"dd-thread-title",children:s.title}),l("span",{className:"dd-thread-meta",children:[t("span",{className:`dd-role dd-role-${s.role}`,children:Ar[s.role]}),t($,{at:s.lastActivityAt,now:a})]})]})]}),t(E,{icon:ga,label:"Unlink thread",size:13,onClick:()=>{r.unlinkThread(e.id,s.threadId).catch(n=>A(`Could not unlink: ${q(n)}`,"error"))}})]},s.threadId))}):l(ae,{icon:V,title:"No agents yet",children:["Use ",t("strong",{children:"Ask agent"})," to start one on this doc. Threads that read or edit it show up here."]}),l("div",{className:"dd-agents-hint",children:[t(Ve,{size:13,"aria-hidden":!0}),l("span",{children:["Agents in this project already know this doc exists. Type ",t("kbd",{children:"@"})," in any composer to attach it, or ask them to use"," ",t("code",{children:"design_doc_read"}),"."]})]})]})})}function Ao({doc:e,activePath:a,request:r,contextProjectId:o,compact:d=!1}){let s=O(),n=se(),[i,f]=b(!1),[u,g]=b(""),[I,L]=b(!1),[C,h]=b(o??""),[x,k]=b(null),y=be(),D=B(null),R=!e.projectId,T=y.data??[],v=R?C||T[0]?.id||"":e.projectId;N(()=>{r&&(g(r.prompt),L(!0),f(!0),requestAnimationFrame(()=>{let m=D.current;m&&(m.focus(),m.selectionStart=m.selectionEnd=m.value.length)}))},[r]),N(()=>{i&&L(m=>m||!!a&&a!==e.entryPath)},[i,a,e.entryPath]);let S=async m=>{if(!x){if(R&&!v){A("Add a project first: agents run inside a project.","error");return}k(m??"custom");try{let P=await s.askAgent(e.id,{...m?{action:m}:{},...u.trim()&&!m?{prompt:u.trim()}:{},path:I?a:null,...R?{projectId:v}:{}});n.openThreadPanel({actionId:we,title:e.title,params:{docId:e.id},threadId:P.threadId}),n.toThread(P.threadId),A(`Agent started on \u201C${e.title}\u201D. Its edits appear here live.`),f(!1),g("")}catch(P){A(`Could not start the agent: ${q(P)}`,"error")}finally{k(null)}}},p=m=>{m.key==="Enter"&&(m.metaKey||m.ctrlKey)&&(m.preventDefault(),u.trim()&&S(null))};return l(te,{open:i,onClose:()=>f(!1),className:"dd-ask",anchor:l("button",{type:"button",className:`btn primary dd-ask-trigger${d?" dd-ask-compact":""}`,"aria-haspopup":"dialog","aria-expanded":i,onClick:()=>f(!i),children:[t(G,{size:13,"aria-hidden":!0}),d?null:"Ask agent",t(J,{size:12,"aria-hidden":!0})]}),children:[l("div",{className:"dd-ask-head",children:[t("span",{className:"dd-ask-title",children:"Ask an agent"}),t("span",{className:"dd-muted",children:"Starts a new thread that edits this doc live"})]}),t("div",{className:"dd-ask-actions",role:"menu",children:xo.map(m=>{let P=vo(m.icon);return l("button",{type:"button",role:"menuitem",className:"dd-ask-action",disabled:!!x,onClick:()=>{S(m.id)},title:m.description,children:[t("span",{className:"dd-ask-action-icon",children:x===m.id?t(H,{size:13}):t(P,{size:14,"aria-hidden":!0})}),l("span",{className:"dd-ask-action-text",children:[t("span",{className:"dd-ask-action-label",children:m.label}),t("span",{className:"dd-ask-action-desc",children:m.description})]})]},m.id)})}),l("div",{className:"dd-ask-custom",children:[t("textarea",{ref:D,className:"dd-input",rows:3,maxLength:Da,placeholder:"Or describe what you want\u2026 e.g. \u201CCompare two caching strategies and recommend one\u201D",value:u,onChange:m=>g(m.target.value),onKeyDown:p}),l("div",{className:"dd-ask-options",children:[a?l("label",{className:"dd-check",children:[t("input",{type:"checkbox",checked:I,onChange:m=>L(m.target.checked)}),"Focus on ",t("code",{children:a})]}):null,R?l("label",{className:"dd-field-inline",children:["Run in",l("select",{className:"dd-input dd-select",value:v,onChange:m=>h(m.target.value),children:[T.length?null:t("option",{value:"",children:"No projects"}),T.map(m=>t("option",{value:m.id,children:m.name},m.id))]})]}):null,t("span",{className:"dd-spacer"}),l("button",{type:"button",className:"btn primary",disabled:!u.trim()||!!x,onClick:()=>{S(null)},children:[x==="custom"?t(H,{size:12}):null,"Start"]})]})]})]})}function Ca(e){let a=e.split("/").pop()??e,r=a.lastIndexOf(".");return r<=0?"":a.slice(r+1).toLowerCase()}var Dr={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",txt:"text"},Tr={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp"},Do={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function Sa(e){let a=Ca(e),r=Dr[a];return r||(Do[a]?"code":"text")}function To(e){return Do[Ca(e)]??""}function Mo(e){return e==="image"}function Ro(e){return Tr[Ca(e)]??null}function Fo(e,a){let r=e.split("/"),o=a.split("/"),d=Math.min(r.length,o.length);for(let s=0;s<d;s+=1){let n=s===r.length-1,i=s===o.length-1;if(r[s]!==o[s])return n!==i?n?-1:1:r[s].localeCompare(o[s],void 0,{sensitivity:"base",numeric:!0})}return r.length-o.length}function Ea(e){let a=(e??"").split("/").filter(Boolean),[r,...o]=a;return{docId:r??null,path:o.length?o.join("/"):null}}function Oe(e){return e.docId?e.path?`${e.docId}/${e.path}`:e.docId:""}var Mr=/^[a-z][a-z0-9+.-]*:/i;function ba(e,a){let r=a.trim();if(!r||r.startsWith("#")||r.startsWith("//")||Mr.test(r))return null;let o=r.split(/[?#]/,1)[0],d=o;try{d=decodeURIComponent(o)}catch{}let s=d.startsWith("/")?[]:e.split("/").slice(0,-1);for(let n of d.split("/"))if(!(!n||n===".")){if(n===".."){if(!s.length)return null;s.pop();continue}s.push(n)}return s.length?s.join("/"):null}function Rr(e){let a=new TextEncoder().encode(e),r="";for(let o=0;o<a.length;o+=32768)r+=String.fromCharCode(...a.subarray(o,o+32768));return btoa(r)}function Ha(e){if(e.kind==="svg")return`data:image/svg+xml;base64,${Rr(e.content)}`;let a=Ro(e.path);return e.kind==="image"&&a&&e.encoding==="base64"?`data:${a};base64,${e.content}`:null}var Bo=/(!\[[^\]]*\]\()\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g,No=/(\ssrc\s*=\s*)(["'])([^"']+)\2/gi;function qo(e){return e.startsWith("<")&&e.endsWith(">")?e.slice(1,-1):e}function Oo(e,a,r){let o=new Set,d=r==="markdown"?Bo:No;for(let s of a.matchAll(d)){let n=r==="markdown"?qo(s[2]):s[3],i=ba(e,n);i&&o.add(i)}return[...o]}function Ua(e,a,r,o){return o.size?r==="markdown"?a.replace(Bo,(d,s,n,i="")=>{let f=ba(e,qo(n)),u=f?o.get(f):void 0;return u?`${s}${u}${i})`:d}):a.replace(No,(d,s,n,i)=>{let f=ba(e,i),u=f?o.get(f):void 0;return u?`${s}${n}${u}${n}`:d}):a}function za(e,a){let r=Math.max(0,...[...e.matchAll(/`+/g)].map(d=>d[0].length)),o="`".repeat(Math.max(3,r+1));return`${o}${a}
${e.replace(/\n$/,"")}
${o}`}function Eo(e,a){return za(a,To(e))}var Fr=["--bg-base","--bg-panel","--bg-elevated","--bg-hover","--bg-input","--border","--border-strong","--text-primary","--text-muted","--text-dim","--text-bright","--accent","--accent-blue","--accent-gold","--danger","--success","--font-mono"];function Ho(e=globalThis.document?.documentElement??null){let a={};if(!e||typeof getComputedStyle!="function")return a;let r=getComputedStyle(e);for(let d of Fr){let s=r.getPropertyValue(d).trim();s&&(a[d]=s)}let o=r.getPropertyValue("color-scheme").trim();return o&&(a["color-scheme"]=o),a}var Br=/^[^<>{};]*$/;function Uo(e,a){let o=`<style data-zcc-theme>:root { ${Object.entries(a).filter(([,n])=>Br.test(n)).map(([n,i])=>`${n}: ${i};`).join(" ")} }
html, body { margin: 0; background: var(--bg-panel, #fff); color: var(--text-primary, #111); }
body { padding: 16px; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--accent, #2f81f7); }</style>`,d=e.match(/<head[^>]*>/i);if(d){let n=(d.index??0)+d[0].length;return e.slice(0,n)+o+e.slice(n)}let s=e.match(/^\s*<!doctype[^>]*>/i);return s?s[0]+o+e.slice(s[0].length):o+e}function zo(e){let a=[],r=new Map;for(let o of[...e].sort((d,s)=>Fo(d.path,s.path))){let d=o.path.split("/"),s=a;for(let n=0;n<d.length-1;n+=1){let i=d.slice(0,n+1).join("/"),f=r.get(i);f||(f={kind:"folder",name:d[n],path:i,children:[]},r.set(i,f),s.push(f)),s=f.children}s.push({kind:"file",name:d.at(-1),path:o.path,file:o})}return a}function qr({comment:e,now:a,onToggle:r,onDelete:o,onFocus:d}){let s=e.status==="resolved";return l("article",{className:`dd-comment${s?" dd-comment-resolved":""}`,children:[l("header",{className:"dd-comment-head",children:[t(ee,{actor:e.author}),t($,{at:e.createdAt,now:a}),t("span",{className:"dd-spacer"}),t(E,{icon:s?ie:ve,label:s?"Reopen":"Resolve",onClick:r,size:13}),t(E,{icon:Z,label:"Delete comment",onClick:o,danger:!0,size:13})]}),e.path||e.quote?l("button",{type:"button",className:"dd-comment-anchor",onClick:d,disabled:!d,title:"Show in the document",children:[e.path?t("span",{className:"dd-comment-path",children:e.path}):null,e.quote?t("span",{className:"dd-comment-quote",children:e.quote}):null]}):null,t("div",{className:"dd-comment-body",children:t(ka,{content:e.body})})]})}function _o({doc:e,activePath:a,now:r,pendingQuote:o,onClearQuote:d,onFocusComment:s}){let n=O(),[i,f]=K("comments-scope","all"),[u,g]=b(!1),[I,L]=b(""),[C,h]=b(!1),x=B(null);N(()=>{o&&x.current?.focus()},[o]);let k=U(()=>e.comments.filter(p=>i==="all"||!p.path||p.path===a),[e.comments,i,a]),y=k.filter(p=>p.status==="open"),D=k.filter(p=>p.status==="resolved"),R=async(p,m)=>{try{await p()}catch(P){A(`${m}: ${q(P)}`,"error")}},T=async()=>{let p=I.trim();if(!(!p||C)){h(!0);try{await n.addComment(e.id,{body:p,...a?{path:a}:{},...o?{quote:o}:{}}),L(""),d()}catch(m){A(`Could not add the comment: ${q(m)}`,"error")}finally{h(!1)}}},v=p=>{p.key==="Enter"&&(p.metaKey||p.ctrlKey)&&(p.preventDefault(),T())},S=p=>t(qr,{comment:p,now:r,onToggle:()=>{R(()=>n.setCommentStatus(e.id,p.id,p.status==="open"?"resolved":"open"),"Could not update the comment")},onDelete:()=>{R(()=>n.deleteComment(e.id,p.id),"Could not delete the comment")},onFocus:p.quote||p.path?()=>s(p):void 0},p.id);return l("div",{className:"dd-rail-pane dd-comments",children:[t("div",{className:"dd-rail-toolbar",children:l("div",{className:"dd-segmented",role:"group","aria-label":"Comment scope",children:[t("button",{type:"button",className:i==="all"?"on":"",onClick:()=>f("all"),children:"All files"}),t("button",{type:"button",className:i==="file"?"on":"",onClick:()=>f("file"),disabled:!a,children:"This file"})]})}),l("div",{className:"dd-rail-scroll",children:[y.length===0?t(ae,{icon:de,title:"No open comments",children:"Select text in the document to comment on it, or ask an agent for a review."}):y.map(S),D.length?l("div",{className:"dd-resolved",children:[l("button",{type:"button",className:"dd-disclosure",onClick:()=>g(!u),children:[u?t(J,{size:13,"aria-hidden":!0}):t(ke,{size:13,"aria-hidden":!0}),"Resolved (",D.length,")"]}),u?D.map(S):null]}):null]}),l("div",{className:"dd-composer",children:[o?l("div",{className:"dd-composer-quote",children:[t("span",{className:"dd-comment-quote",children:o}),t(E,{icon:W,label:"Remove quote",onClick:d,size:12})]}):null,t("textarea",{ref:x,className:"dd-input dd-composer-input",placeholder:a?`Comment on ${a}\u2026 agents see open comments`:"Leave a comment\u2026",value:I,maxLength:8e3,rows:3,onChange:p=>L(p.target.value),onKeyDown:v}),l("div",{className:"dd-composer-actions",children:[t("span",{className:"dd-editor-hint",children:"\u2318\u21B5 to send"}),t("button",{type:"button",className:"btn primary",disabled:!I.trim()||C,onClick:()=>{T()},children:"Comment"})]})]})]})}function jo({value:e,placeholder:a,maxLength:r,multiline:o=!1,className:d="",label:s,onSave:n}){let[i,f]=b(!1),[u,g]=b(e),I=B(!1);N(()=>{i||g(e)},[e,i]);let L=async h=>{if(I.current)return;I.current=!0,f(!1);let x=u.trim();if(h&&x!==e.trim())try{await n(x)}catch{g(e)}else g(e)},C=h=>{h.key==="Escape"?(h.preventDefault(),L(!1)):h.key==="Enter"&&(!o||h.metaKey||h.ctrlKey||!h.shiftKey)&&(h.preventDefault(),L(!0))};if(i){let h={className:`dd-editable-input ${d}`,value:u,maxLength:r,"aria-label":s,autoFocus:!0,onChange:x=>g(x.target.value),onKeyDown:C,onBlur:()=>{L(!0)}};return o?t("textarea",{...h,rows:2,placeholder:a}):t("input",{...h,placeholder:a})}return t("button",{type:"button",className:`dd-editable ${d}${e?"":" dd-editable-empty"}`,title:`Edit ${s.toLowerCase()}`,onClick:()=>{I.current=!1,f(!0)},children:e||a})}function Er({tags:e,onChange:a}){let[r,o]=b(!1),[d,s]=b(""),n=()=>{let i=d.split(",").map(u=>u.trim().toLowerCase().slice(0,32)).filter(Boolean);s(""),o(!1);let f=[...new Set([...e,...i])].slice(0,12);f.length!==e.length&&a(f)};return l("span",{className:"dd-tags",children:[e.map(i=>l("span",{className:"dd-tag",children:[t(Fe,{size:10,"aria-hidden":!0}),i,t("button",{type:"button",className:"dd-tag-remove","aria-label":`Remove tag ${i}`,onClick:()=>a(e.filter(f=>f!==i)),children:t(W,{size:10,"aria-hidden":!0})})]},i)),r?t("input",{className:"dd-input dd-tag-input",value:d,placeholder:"tag, another","aria-label":"Add tags",autoFocus:!0,onChange:i=>s(i.target.value),onBlur:n,onKeyDown:i=>{i.key==="Enter"?(i.preventDefault(),n()):i.key==="Escape"&&(s(""),o(!1))}}):e.length<12?l("button",{type:"button",className:"dd-tag dd-tag-add",onClick:()=>o(!0),children:[t(Q,{size:10,"aria-hidden":!0})," Tag"]}):null]})}function Hr({status:e,onChange:a}){let[r,o]=b(!1);return t(te,{open:r,onClose:()=>o(!1),align:"start",className:"dd-menu",anchor:t("button",{type:"button",className:"dd-status-button","aria-haspopup":"menu","aria-expanded":r,onClick:()=>o(!r),title:"Change status",children:t(Pe,{status:e})}),children:Ta.map(d=>t(X,{label:t(Pe,{status:d}),checked:d===e,icon:d===e?ve:void 0,onSelect:()=>{o(!1),d!==e&&a(d)}},d))})}function Ur({doc:e,projects:a,onClose:r,onMove:o}){let[d,s]=b(e.projectId??"");return l(Ia,{title:"Move design doc",onClose:r,footer:l(z,{children:[t("button",{type:"button",className:"btn",onClick:r,children:"Cancel"}),t("button",{type:"button",className:"btn primary",disabled:d===(e.projectId??""),onClick:()=>{o(d||null).then(r)},children:"Move"})]}),children:[l("label",{className:"dd-field",children:[t("span",{className:"dd-field-label",children:"Project"}),l("select",{className:"dd-input dd-select",value:d,onChange:n=>s(n.target.value),children:[t("option",{value:"",children:"Global \u2014 every project's agents can see it"}),a.map(n=>t("option",{value:n.id,children:n.name},n.id))]})]}),t("p",{className:"dd-muted dd-field-help",children:"Agents are told about the docs of the project they run in, plus global docs."})]})}async function Vo(e,a){try{await navigator.clipboard.writeText(e),A(`Copied ${a}`)}catch{A(`Could not copy ${a}`,"error")}}function Wo({doc:e,projects:a,compact:r,actions:o,onDeleted:d}){let s=O(),[n,i]=b(!1),[f,u]=b(!1),[g,I]=b(null),L=e.projectId?a.find(x=>x.id===e.projectId):null,C=async x=>{try{await s.update(e.id,x)}catch(k){throw A(`Could not update the doc: ${q(k)}`,"error"),k}},h=e.status==="archived";return l("header",{className:`dd-doc-header${r?" dd-doc-header-compact":""}`,children:[l("div",{className:"dd-doc-title-row",children:[t(jo,{className:"dd-doc-title",label:"Title",value:e.title,placeholder:"Untitled design doc",maxLength:140,onSave:x=>x?C({title:x}):void 0}),t("span",{className:"dd-spacer"}),o,l(te,{open:n,onClose:()=>i(!1),className:"dd-menu",anchor:t(E,{icon:re,label:"More actions",active:n,onClick:()=>i(!n)}),children:[t(X,{icon:$e,label:"Copy chat reference",hint:"Paste into any thread",onSelect:()=>{i(!1),Vo(Co(e.id),"reference")}}),t(X,{icon:Fe,label:"Copy id",hint:e.slug,onSelect:()=>{i(!1),Vo(e.id,"id")}}),t(X,{icon:Qe,label:"Move to project\u2026",onSelect:()=>{i(!1),u(!0)}}),t(X,{icon:h?_e:Ge,label:h?"Unarchive":"Archive",onSelect:()=>{i(!1),C({status:h?"draft":"archived"}).catch(()=>{})}}),t(X,{icon:Z,label:"Delete\u2026",danger:!0,onSelect:()=>{i(!1),I({title:"Delete design doc",body:l(z,{children:["Delete ",t("strong",{children:e.title})," with its ",e.files.length," file",e.files.length===1?"":"s",", comments and history? This cannot be undone. Archive it instead to keep it out of agents' way."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await s.remove(e.id),A(`Deleted \u201C${e.title}\u201D`),d()}catch(x){A(`Could not delete: ${q(x)}`,"error")}}})}})]})]}),r?null:t(jo,{className:"dd-doc-summary",label:"Summary",multiline:!0,value:e.summary,placeholder:"Add a one-line summary \u2014 agents see it when choosing which doc to read",maxLength:600,onSave:x=>C({summary:x})}),l("div",{className:"dd-doc-meta",children:[t(Hr,{status:e.status,onChange:x=>{C({status:x}).catch(()=>{})}}),l("span",{className:"dd-doc-project",title:L?`Project \xB7 ${L.name}`:"Visible to agents in every project",children:[L?null:t(aa,{size:12,"aria-hidden":!0}),L?L.name:e.projectId?"Unknown project":"Global"]}),r?null:t(Er,{tags:e.tags,onChange:x=>{C({tags:x}).catch(()=>{})}}),t("span",{className:"dd-spacer"}),l("span",{className:"dd-doc-updated",children:[t(ee,{actor:e.updatedBy})," ",t($,{at:e.updatedAt,now:Date.now()})]})]}),f?t(Ur,{doc:e,projects:a,onClose:()=>u(!1),onMove:x=>C({projectId:x}).catch(()=>{})}):null,g?t(qe,{request:g,onClose:()=>I(null)}):null]})}function $o({docId:e,file:a,split:r,renderPreview:o,onStateChange:d,onSaved:s}){let n=O(),[i,f]=b(a.content),[u,g]=b({content:a.content,revision:a.revision}),[I,L]=b(!1),[C,h]=b(null),x=i!==u.content,k=ot(i),y=B({dirty:x,draft:i,saved:u});y.current={dirty:x,draft:i,saved:u},N(()=>{let{dirty:v,draft:S,saved:p}=y.current;a.revision!==p.revision&&(!v||a.content===S?(f(a.content),g({content:a.content,revision:a.revision}),h(null)):h({revision:a.revision,by:a.updatedBy}))},[a.revision,a.content,a.updatedBy]),N(()=>{d?.({dirty:x,saving:I})},[x,I,d]);let D=le(async(v=u.revision)=>{if(!I){L(!0);try{let S=await n.writeFile(e,{path:a.path,content:i,baseRevision:v});g({content:i,revision:S.revision}),h(null),s?.(S)}catch(S){if(ho(S)){let p=await n.readFile(e,a.path).catch(()=>null);h({revision:p?.revision??u.revision+1,by:p?.updatedBy??a.updatedBy})}else A(`Could not save ${a.path}: ${q(S)}`,"error")}finally{L(!1)}}},[n,e,i,a.path,a.updatedBy,s,u.revision,I]),R=async()=>{try{let v=await n.readFile(e,a.path);f(v.content),g({content:v.content,revision:v.revision}),h(null)}catch(v){A(`Could not reload ${a.path}: ${q(v)}`,"error")}},T=v=>{if((v.metaKey||v.ctrlKey)&&v.key.toLowerCase()==="s"){v.preventDefault(),x&&!C&&D();return}if(v.key==="Tab"&&!v.metaKey&&!v.ctrlKey&&!v.altKey){v.preventDefault();let S=v.currentTarget,{selectionStart:p,selectionEnd:m,value:P}=S,w=`${P.slice(0,p)}  ${P.slice(m)}`;f(w),requestAnimationFrame(()=>{S.selectionStart=S.selectionEnd=p+2})}};return l("div",{className:"dd-editor",children:[C?l("div",{className:"dd-banner dd-banner-warn",role:"alert",children:[t(Ie,{size:14,"aria-hidden":!0}),l("span",{className:"dd-banner-text",children:[t(ee,{actor:C.by})," saved revision ",C.revision," while you were editing."]}),l("button",{type:"button",className:"btn",onClick:()=>{R()},children:[t(ie,{size:12,"aria-hidden":!0})," Discard mine"]}),t("button",{type:"button",className:"btn",onClick:()=>{D(C.revision)},children:"Overwrite with mine"})]}):null,l("div",{className:`dd-editor-body${r?" dd-editor-split":""}`,children:[t("textarea",{className:"dd-editor-input",value:i,spellCheck:a.kind==="markdown"||a.kind==="text","aria-label":`Edit ${a.path}`,onChange:v=>f(v.target.value),onKeyDown:T,autoFocus:!0}),r?t("div",{className:"dd-editor-preview",children:o(k)}):null]}),l("div",{className:"dd-editor-footer",children:[l("span",{className:"dd-editor-state",children:[I?t(H,{size:12,label:"Saving"}):null,I?"Saving\u2026":x?"Unsaved changes":`Saved \xB7 rev ${u.revision}`]}),t("span",{className:"dd-editor-hint",children:"\u2318S to save"}),t("button",{type:"button",className:"btn",disabled:!x||I,onClick:()=>f(u.content),children:"Revert"}),l("button",{type:"button",className:"btn primary",disabled:!x||I||!!C,onClick:()=>{D()},children:[t(ia,{size:12,"aria-hidden":!0})," Save"]})]})]})}var Fa="dd-comment",Ba="dd-comment-focus";function zr(e){return e.replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm,"").replace(/[*_`~]+/g,"").replace(/\s+/g," ").trim()}function _r(e){let a=e.ownerDocument.createTreeWalker(e,4),r=[],o=[],d="";for(let f=a.nextNode();f;f=a.nextNode())o.push(d.length),r.push(f),d+=f.data;let s="",n=[],i=!0;for(let f=0;f<d.length;f+=1){let u=d[f];/\s/.test(u)?(i||(s+=" ",n.push(f)),i=!0):(s+=u,n.push(f),i=!1)}return{nodes:r,starts:o,normalized:s,map:n}}function Xo(e,a){let r=0,o=e.starts.length-1;for(;r<o;){let d=r+o+1>>1;e.starts[d]<=a?r=d:o=d-1}return[e.nodes[r],a-e.starts[r]]}function ja(e,a){let r=new Map;if(!a.length)return r;let o=_r(e);if(!o.nodes.length)return r;for(let d of a){let s=zr(d);if(s.length<2||r.has(d))continue;let n=o.normalized.indexOf(s);if(n<0)continue;let[i,f]=Xo(o,o.map[n]),[u,g]=Xo(o,o.map[n+s.length-1]),I=e.ownerDocument.createRange();I.setStart(i,f),I.setEnd(u,g+1),r.set(d,I)}return r}function Gr(){let e=globalThis.CSS,a=globalThis.Highlight;return e?.highlights&&a?{registry:e.highlights,Highlight:a}:null}var Ko=new Map;function Me(e,a,r){let o=Gr();if(!o)return;let d=Ko.get(e)??new Map;Ko.set(e,d),r.length?d.set(a,r):d.delete(a);let s=[...d.values()].flat();s.length?o.registry.set(e,new o.Highlight(...s)):o.registry.delete(e)}var Vr=24,Wr=64,Ee=new Map;function $r(e,a){for(Ee.delete(e),Ee.set(e,a);Ee.size>Wr;)Ee.delete(Ee.keys().next().value)}function Xr(e,a,r){let o=O(),d=U(()=>{let u=new Map(a.map(g=>[g.path,g]));return r.map(g=>u.get(g)).filter(g=>!!g&&(g.kind==="image"||g.kind==="svg")).slice(0,Vr)},[a,r]),s=d.map(u=>`${u.path}@${u.revision}`).join("|"),n=B(d);n.current=d;let[i,f]=b(new Map);return N(()=>{let u=n.current,g=!1,I=new Map,L=[];for(let C of u){let h=Ee.get(`${e}\0${C.path}\0${C.revision}`);h?I.set(C.path,h):L.push(C)}if(f(I),!!L.length)return Promise.all(L.map(async C=>{try{let h=await o.readFile(e,C.path),x=Ha(h);x&&($r(`${e}\0${h.path}\0${h.revision}`,x),I.set(h.path,x))}catch{}})).then(()=>{g||f(new Map(I))}),()=>{g=!0}},[o,e,s]),i}var Zo=[{id:"full",label:"Full width",icon:sa,width:null},{id:"tablet",label:"Tablet (768px)",icon:ma,width:768},{id:"phone",label:"Phone (390px)",icon:ca,width:390}];function Kr({file:e,assets:a}){let[r,o]=b("full"),d=U(()=>Uo(Ua(e.path,e.content,"html",a),Ho()),[e.path,e.content,a]),s=Zo.find(n=>n.id===r).width;return l("div",{className:"dd-html-stage",children:[t("div",{className:"dd-html-toolbar",role:"toolbar","aria-label":"Preview width",children:Zo.map(n=>t("button",{type:"button",className:`icon-btn${r===n.id?" on":""}`,title:n.label,"aria-label":n.label,"aria-pressed":r===n.id,onClick:()=>o(n.id),children:t(n.icon,{size:14,"aria-hidden":!0})},n.id))}),t("div",{className:"dd-html-viewport",children:t("iframe",{className:`dd-html-frame${s?" dd-html-frame-device":""}`,style:s?{width:s}:void 0,sandbox:"allow-scripts",srcDoc:d,title:e.path})})]})}function Pa({docId:e,file:a,files:r,quotes:o=[],onOpenPath:d,onQuote:s,onAskAbout:n,handleRef:i}){let f=B(null),u=B(null),g=B({}),[I,L]=b(null),C=a.kind==="markdown"||a.kind==="html",h=U(()=>C?Oo(a.path,a.content,a.kind):[],[C,a.path,a.content,a.kind]),x=Xr(e,r,h),k=U(()=>new Set(r.map(p=>p.path)),[r]),y=U(()=>a.kind==="markdown"?Ua(a.path,a.content,"markdown",x):a.kind==="mermaid"?za(a.content,"mermaid"):a.kind==="code"?Eo(a.path,a.content):null,[a.kind,a.path,a.content,x]),D=o.join("\0");N(()=>{let p=u.current,m=g.current,P=D?D.split("\0"):[];if(!p||!P.length){Me(Fa,m,[]);return}let w=()=>Me(Fa,m,[...ja(p,P).values()]),_=setTimeout(w,60),ye=typeof MutationObserver=="function"?new MutationObserver(()=>w()):null;return ye?.observe(p,{childList:!0,subtree:!0,characterData:!0}),()=>{clearTimeout(_),ye?.disconnect(),Me(Fa,m,[]),Me(Ba,m,[])}},[D,y,a.kind,a.content]),N(()=>{if(i)return i.current={focusQuote(p){let m=u.current,P=m?ja(m,[p]).get(p):void 0;return P?(P.startContainer.parentElement?.scrollIntoView?.({block:"center",behavior:"smooth"}),Me(Ba,g.current,[P]),setTimeout(()=>Me(Ba,g.current,[]),1800),!0):!1}},()=>{i.current=null}},[i]);let R=p=>{let m=p.target?.closest?.("a");if(!m)return;let P=m.getAttribute("href")??"";if(P.startsWith("#")){p.preventDefault(),p.stopPropagation();return}let w=ba(a.path,P);if(!w)return;p.preventDefault(),p.stopPropagation();let _=[...k].find(ye=>ye.startsWith(`${w}/`));k.has(w)?d?.(w):_?d?.(_):A(`${w} is not a file in this design doc`,"error")},T=()=>{if(!s)return;let p=globalThis.getSelection?.(),m=f.current,P=p?.toString().trim()??"";if(!p||p.isCollapsed||!P||!m||!u.current?.contains(p.anchorNode)){L(null);return}let w=p.getRangeAt(0).getBoundingClientRect(),_=m.getBoundingClientRect();L({text:P.slice(0,500),top:Math.max(4,w.top-_.top+m.scrollTop-36),left:Math.min(Math.max(80,w.left-_.left+w.width/2),Math.max(80,_.width-80))})},v=p=>{!I||!p||(p(I.text),L(null),globalThis.getSelection?.()?.removeAllRanges())},S;if(a.kind==="html")S=t(Kr,{file:a,assets:x});else if(a.kind==="image"||a.kind==="svg"){let p=Ha(a);S=t("div",{className:"dd-image-stage",children:p?t("img",{src:p,alt:a.path}):t("span",{className:"dd-muted",children:"This image cannot be displayed."})})}else y!==null?S=t("div",{className:`dd-prose dd-prose-${a.kind}`,ref:u,onClickCapture:R,children:a.kind==="markdown"&&!a.content.trim()?t("p",{className:"dd-muted",children:"This file is empty. Switch to Edit, or ask an agent to fill it in."}):t(ka,{content:y})}):S=t("div",{className:"dd-prose",ref:u,children:t("pre",{className:"dd-plain",children:a.content})});return l("div",{className:`dd-preview dd-preview-${a.kind}`,ref:f,onMouseUp:T,onMouseDown:p=>{p.target.closest?.(".dd-selection-chip")||L(null)},children:[S,I?l("div",{className:"dd-selection-chip",style:{top:I.top,left:I.left},children:[l("button",{type:"button",onClick:()=>v(s),children:[t(ra,{size:13,"aria-hidden":!0}),"Comment"]}),n?l("button",{type:"button",onClick:()=>v(n),children:[t(G,{size:13,"aria-hidden":!0}),"Ask agent"]}):null]}):null]})}function Jo(e,a,r=1500){let o=e.split(`
`),d=a.split(`
`),s=0;for(;s<o.length&&s<d.length&&o[s]===d[s];)s+=1;let n=o.length,i=d.length;for(;n>s&&i>s&&o[n-1]===d[i-1];)n-=1,i-=1;let f=o.slice(s,n),u=d.slice(s,i);if(f.length>r||u.length>r)return null;let g=u.length+1,I=new Uint32Array((f.length+1)*g);for(let x=f.length-1;x>=0;x-=1)for(let k=u.length-1;k>=0;k-=1)I[x*g+k]=f[x]===u[k]?I[(x+1)*g+k+1]+1:Math.max(I[(x+1)*g+k],I[x*g+k+1]);let L=[],C=0,h=0;for(;C<f.length&&h<u.length;)f[C]===u[h]?(L.push({type:"same",text:f[C]}),C+=1,h+=1):I[(C+1)*g+h]>=I[C*g+h+1]?(L.push({type:"del",text:f[C]}),C+=1):(L.push({type:"add",text:u[h]}),h+=1);for(;C<f.length;)L.push({type:"del",text:f[C++]});for(;h<u.length;)L.push({type:"add",text:u[h++]});return[...o.slice(0,s).map(x=>({type:"same",text:x})),...L,...o.slice(n).map(x=>({type:"same",text:x}))]}function Qo(e,a=3){let r=new Uint8Array(e.length);e.forEach((s,n)=>{if(s.type!=="same")for(let i=Math.max(0,n-a);i<=Math.min(e.length-1,n+a);i+=1)r[i]=1});let o=[],d=0;for(;d<e.length;)if(r[d]){let s=[];for(;d<e.length&&r[d];)s.push(e[d++]);o.push({type:"lines",lines:s})}else{let s=0;for(;d<e.length&&!r[d];)s+=1,d+=1;o.push({type:"gap",count:s})}return o}function Yo(e){let a=0,r=0;for(let o of e)o.type==="add"?a+=1:o.type==="del"&&(r+=1);return{added:a,removed:r}}var Zr={create:me,write:pe,delete:ge,rename:la},er={create:"Created",write:"Edited",delete:"Deleted",rename:"Renamed"};function ar({doc:e,activePath:a,now:r,selectedId:o,onSelect:d}){let s=O(),[n,i]=K("history-scope","file"),f=n==="file"?a:null,u=Se(`${e.id}\0${f??"*"}\0${e.revision}`,()=>s.history(e.id,{...f?{path:f}:{},limit:100}));return l("div",{className:"dd-rail-pane dd-history",children:[t("div",{className:"dd-rail-toolbar",children:l("div",{className:"dd-segmented",role:"group","aria-label":"History scope",children:[t("button",{type:"button",className:n==="file"?"on":"",onClick:()=>i("file"),disabled:!a,children:"This file"}),t("button",{type:"button",className:n==="all"?"on":"",onClick:()=>i("all"),children:"All files"})]})}),l("div",{className:"dd-rail-scroll",children:[u.error?t("div",{className:"dd-banner dd-banner-error",children:u.error}):null,!u.data&&u.loading?t("div",{className:"dd-center",children:t(H,{label:"Loading history"})}):null,u.data&&!u.data.length?t(ae,{icon:Y,title:"No history yet",children:"Every save by you or an agent is kept here, so you can compare and restore."}):null,t("ol",{className:"dd-history-list",children:u.data?.map(g=>{let I=Zr[g.op];return t("li",{children:l("button",{type:"button",className:`dd-history-row${o===g.id?" on":""}`,onClick:()=>d(g),children:[t(I,{size:13,className:`dd-op dd-op-${g.op}`,"aria-hidden":!0}),l("span",{className:"dd-history-main",children:[l("span",{className:"dd-history-title",children:[er[g.op],f?null:t("span",{className:"dd-history-path",children:g.path}),l("span",{className:"dd-history-rev",children:["rev ",g.revision]})]}),g.note?t("span",{className:"dd-history-note",children:g.note}):null,l("span",{className:"dd-history-meta",children:[t(ee,{actor:g.actor}),t($,{at:g.createdAt,now:r})]})]})]})},g.id)})})]})]})}async function Jr(e,a,r){let o=await e.revision(a,r.id);if(r.op==="create"||r.op==="rename"||o.encoding==="base64")return{after:o,before:null,pruned:!1};if(r.op==="delete")return{after:o,before:o.content,pruned:!1};let d=(await e.history(a,{path:r.path,limit:100})).find(n=>n.id<r.id);if(!d)return{after:o,before:null,pruned:!0};if(d.op==="delete")return{after:o,before:"",pruned:!1};let s=await e.revision(a,d.id);return{after:o,before:s.content,pruned:!1}}function tr({doc:e,revision:a,onClose:r,onOpenPath:o}){let d=O(),[s,n]=b(a.op==="write"||a.op==="delete"?"changes":"full"),[i,f]=b(!1),u=Se(`${e.id}\0${a.id}`,()=>Jr(d,e.id,a)),g=Sa(a.path),L=(e.files.find(y=>y.path===a.path)??null)?.revision===a.revision&&a.op!=="delete",C=U(()=>{let y=u.data;if(!y||y.before===null||Mo(g))return null;let D=Jo(y.before,a.op==="delete"?"":y.after.content);return D?{hunks:Qo(D),stats:Yo(D)}:"too-large"},[u.data,a.op,g]),h=async()=>{f(!0);try{let y=await d.restore(e.id,a.id);A(`Restored ${y.path} to revision ${a.revision} (now rev ${y.revision})`),o(y.path),r()}catch(y){A(`Could not restore: ${q(y)}`,"error")}finally{f(!1)}},x=C!==null,k=s==="full"||!x;return l("div",{className:"dd-revision",children:[l("div",{className:"dd-banner dd-banner-info dd-revision-banner",children:[t(Y,{size:14,"aria-hidden":!0}),l("span",{className:"dd-banner-text",children:[t("strong",{children:er[a.op]})," ",a.path," \xB7 rev ",a.revision," by ",t(ee,{actor:a.actor})," ",t($,{at:a.createdAt,now:Date.now()}),a.renamedFrom?l(z,{children:[" \xB7 from ",a.renamedFrom]}):null,a.note?l("span",{className:"dd-revision-note",children:[" \u2014 ",a.note]}):null]}),x?l("div",{className:"dd-segmented",role:"group","aria-label":"Revision view",children:[t("button",{type:"button",className:s==="changes"?"on":"",onClick:()=>n("changes"),children:"Changes"}),t("button",{type:"button",className:s==="full"?"on":"",onClick:()=>n("full"),children:"Full file"})]}):null,l("button",{type:"button",className:"btn",disabled:L||i||!u.data,onClick:()=>{h()},children:[t(ie,{size:12,"aria-hidden":!0})," ",L?"Current":a.op==="delete"?"Recreate file":"Restore"]}),t(E,{icon:W,label:"Close revision",onClick:r})]}),l("div",{className:"dd-revision-body",children:[u.error?t("div",{className:"dd-banner dd-banner-error",children:u.error}):null,u.data?k?l(z,{children:[u.data.pruned?t("p",{className:"dd-muted dd-revision-hint",children:"Earlier revisions of this file were pruned, so only the snapshot is shown."}):null,C==="too-large"?t("p",{className:"dd-muted dd-revision-hint",children:"This change is too large to diff; showing the full snapshot."}):null,t(Pa,{docId:e.id,file:{path:a.path,kind:g,content:u.data.after.content,encoding:u.data.after.encoding},files:e.files,onOpenPath:o})]}):C&&C!=="too-large"?l("div",{className:"dd-diff",role:"table","aria-label":`Changes in revision ${a.revision}`,children:[l("div",{className:"dd-diff-stats",children:[l("span",{className:"dd-diff-added",children:["+",C.stats.added]}),l("span",{className:"dd-diff-removed",children:["\u2212",C.stats.removed]}),t("span",{className:"dd-muted",children:Te(a.size)})]}),C.hunks.map((y,D)=>y.type==="gap"?l("div",{className:"dd-diff-gap",children:["\u22EF ",y.count," unchanged line",y.count===1?"":"s"]},D):y.lines.map((R,T)=>l("div",{className:`dd-diff-line dd-diff-${R.type}`,role:"row",children:[t("span",{className:"dd-diff-sign","aria-hidden":!0,children:R.type==="add"?"+":R.type==="del"?"\u2212":" "}),t("span",{className:"dd-diff-text",children:R.text||" "})]},`${D}-${T}`))),C.stats.added+C.stats.removed===0?t("p",{className:"dd-muted dd-revision-hint",children:"No line changes in this revision."}):null]}):null:u.loading?t("div",{className:"dd-center",children:t(H,{label:"Loading revision"})}):null]})]})}var Qr=[{id:"preview",label:"Preview",icon:Ke},{id:"edit",label:"Edit",icon:De},{id:"split",label:"Split",icon:fe}];function Yr(e,a,r){let o=Po(e,a,r),d=B(null);o.data&&(d.current=o.data);let s=d.current&&d.current.path===a?d.current:null;return{file:o.data??s,error:o.error,loading:o.loading}}function ed(e,a,r){let[o,d]=b(null),s=B({path:e,revision:a});return N(()=>{let n=s.current;if(s.current={path:e,revision:a},n.path!==e||a===null||n.revision===null||a<=n.revision||r?.kind!=="agent")return;d(r.label);let i=setTimeout(()=>d(null),4e3);return()=>clearTimeout(i)},[e,a,r]),o}function or({doc:e,path:a,mode:r,onModeChange:o,railOpen:d,onToggleRail:s,revision:n,onCloseRevision:i,previewHandle:f,onOpenPath:u,onQuote:g,onAskAbout:I,onEditorState:L,leading:C}){let h=e.files.find(m=>m.path===a)??null,{file:x,error:k,loading:y}=Yr(e.id,a,h?.revision??null),D=ed(a,h?.revision??null,h?.updatedBy),R=h?.kind!=="image",T=R?r:"preview",v=U(()=>e.comments.filter(m=>m.status==="open"&&m.path===a&&m.quote).map(m=>m.quote),[e.comments,a]),S=a.lastIndexOf("/");N(()=>{T==="preview"&&L({dirty:!1,saving:!1})},[T,L]);let p;return n?p=t(tr,{doc:e,revision:n,onClose:i,onOpenPath:u},n.id):h?x?T==="preview"?p=t(Pa,{docId:e.id,file:x,files:e.files,quotes:v,onOpenPath:u,onQuote:g,onAskAbout:I,handleRef:f}):p=t($o,{docId:e.id,file:x,split:T==="split",onStateChange:L,renderPreview:m=>t(Pa,{docId:e.id,file:{...x,content:m},files:e.files,onOpenPath:u})},`${e.id}\0${a}`):p=t("div",{className:"dd-center",children:k?t("div",{className:"dd-banner dd-banner-error",children:k}):y?t(H,{label:"Loading file"}):null}):p=l("div",{className:"dd-center dd-muted",children:[a," is not in this doc anymore."]}),l("section",{className:"dd-file-pane","aria-label":a,children:[l("div",{className:"dd-file-toolbar",children:[C,h?t(Ne,{kind:h.kind}):null,l("span",{className:"dd-file-path",title:a,children:[S>0?t("span",{className:"dd-file-dir",children:a.slice(0,S+1)}):null,t("span",{className:"dd-file-name",children:a.slice(S+1)})]}),h?l("span",{className:"dd-file-meta",children:["rev ",h.revision," \xB7 ",Te(h.size)," \xB7 ",t(ee,{actor:h.updatedBy})," ",t($,{at:h.updatedAt,now:Date.now()})]}):null,D?l("span",{className:"dd-flash",role:"status",children:[t(V,{size:12,"aria-hidden":!0})," Updated by ",D]}):null,t("span",{className:"dd-spacer"}),n?null:t("div",{className:"dd-segmented dd-mode",role:"group","aria-label":"View mode",children:Qr.map(m=>l("button",{type:"button",className:T===m.id?"on":"",disabled:!R&&m.id!=="preview",onClick:()=>o(m.id),title:m.label,"aria-pressed":T===m.id,children:[t(m.icon,{size:13,"aria-hidden":!0}),t("span",{className:"dd-mode-label",children:m.label})]},m.id))}),t(E,{icon:na,label:d?"Hide comments & history":"Show comments & history",active:d,onClick:s})]}),t("div",{className:"dd-file-body",children:p})]})}function td(e){let r=e.split("/").at(-1).replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/^\w/,o=>o.toUpperCase());switch(Sa(e)){case"markdown":return`# ${r}

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
`;default:return""}}function od(e){let a=e.trim().replace(/^\/+/,"");return Ca(a)?a:`${a}.md`}function rd(e){return new Promise((a,r)=>{let o=new FileReader,d=e.name.toLowerCase().endsWith(".svg");o.onerror=()=>r(o.error??new Error("could not read the file")),o.onload=()=>{let s=String(o.result??"");a(d?{content:s}:{content:s.slice(s.indexOf(",")+1),encoding:"base64"})},d?o.readAsText(e):o.readAsDataURL(e)})}function dr({initial:e,placeholder:a,onSubmit:r,onCancel:o}){let[d,s]=b(e),n=B(!1),i=u=>{u?.preventDefault(),!n.current&&(n.current=!0,d.trim()&&d.trim()!==e?r(d.trim()):o())};return t("form",{className:"dd-tree-input",onSubmit:i,children:t("input",{className:"dd-input",value:d,placeholder:a,"aria-label":a,onChange:u=>s(u.target.value),onKeyDown:u=>{u.key==="Escape"&&(u.preventDefault(),n.current=!0,o())},onBlur:()=>i(),autoFocus:!0,onFocus:u=>{let g=u.target.value.lastIndexOf("."),I=u.target.value.lastIndexOf("/")+1;u.target.setSelectionRange(I,g>I?g:u.target.value.length)}})})}function dd({doc:e,file:a,name:r,depth:o,active:d,renaming:s,onOpen:n,onRename:i,onRenameDone:f,onDelete:u}){let g=O(),[I,L]=b(!1),C=e.entryPath===a.path,h=e.comments.filter(x=>x.status==="open"&&x.path===a.path).length;return s?t("div",{className:"dd-tree-row",style:{paddingLeft:8+o*14},children:t(dr,{initial:a.path,placeholder:"New path",onSubmit:x=>f(x),onCancel:()=>f(null)})}):l("div",{className:`dd-tree-row dd-tree-file${d?" on":""}`,style:{paddingLeft:8+o*14},children:[l("button",{type:"button",className:"dd-tree-open",onClick:n,onDoubleClick:i,title:`${a.path} \xB7 ${Te(a.size)} \xB7 rev ${a.revision}`,"aria-current":d?"page":void 0,children:[t(Ne,{kind:a.kind}),t("span",{className:"dd-tree-name",children:r}),C?t(he,{size:11,className:"dd-tree-entry","aria-label":"Entry file"}):null,h?t("span",{className:"dd-tree-badge",title:`${h} open comment${h===1?"":"s"}`,children:h}):null]}),l(te,{open:I,onClose:()=>L(!1),className:"dd-menu",anchor:t(E,{icon:re,label:`Actions for ${a.path}`,size:13,active:I,onClick:()=>L(!I)}),children:[t(X,{icon:De,label:"Rename or move",onSelect:()=>{L(!1),i()}}),C||a.kind==="image"?null:t(X,{icon:pa,label:"Open first",hint:"Make this the doc's entry file",onSelect:()=>{L(!1),g.update(e.id,{entryPath:a.path}).catch(x=>A(q(x),"error"))}}),t(X,{icon:Z,label:"Delete",danger:!0,onSelect:()=>{L(!1),u()}})]})]})}function Va({doc:e,activePath:a,onOpen:r,onPathChanged:o}){let d=O(),[s,n]=b(new Set),[i,f]=b(!1),[u,g]=b(null),[I,L]=b(null),C=B(null),h=zo(e.files),x=e.files.length>=150,k=a?.includes("/")?a.slice(0,a.lastIndexOf("/")+1):"",y=async p=>{f(!1);let m=od(p);if(e.files.some(P=>P.path===m)){r(m);return}if(Sa(m)==="image"){A("Use \u201CAdd image\u201D to upload a picture.","error");return}try{await d.writeFile(e.id,{path:m,content:td(m)}),r(m)}catch(P){A(`Could not create ${m}: ${q(P)}`,"error")}},D=async(p,m)=>{if(g(null),!(!m||m===p))try{let P=await d.renameFile(e.id,p,m);o(p,P.path)}catch(P){A(`Could not rename ${p}: ${q(P)}`,"error")}},R=async p=>{for(let m of Array.from(p??[])){if(m.size>2097152){A(`${m.name} is larger than ${Te(2097152)}`,"error");continue}let P=`${k||"assets/"}${m.name.replace(/[^\w.-]+/g,"-")}`;try{let w=await rd(m);await d.writeFile(e.id,{path:P,...w}),A(`Added ${P}. Reference it with ![${m.name}](${P.slice(k.length)})`)}catch(w){A(`Could not add ${m.name}: ${q(w)}`,"error")}}C.current&&(C.current.value="")},T=p=>L({title:"Delete file",body:l(z,{children:["Delete ",t("code",{children:p.path}),"? Its history is kept, so it can be recreated from History."]}),confirmLabel:"Delete",danger:!0,run:async()=>{try{await d.deleteFile(e.id,p.path),o(p.path,null)}catch(m){A(`Could not delete ${p.path}: ${q(m)}`,"error")}}}),v=p=>n(m=>{let P=new Set(m);return P.has(p)?P.delete(p):P.add(p),P}),S=(p,m)=>p.map(P=>{if(P.kind==="folder"){let w=!s.has(P.path);return l("div",{role:"group","aria-label":P.name,children:[l("button",{type:"button",className:"dd-tree-row dd-tree-folder",style:{paddingLeft:8+m*14},onClick:()=>v(P.path),"aria-expanded":w,children:[w?t(J,{size:12,"aria-hidden":!0}):t(ke,{size:12,"aria-hidden":!0}),w?t(Ye,{size:14,"aria-hidden":!0}):t(ea,{size:14,"aria-hidden":!0}),t("span",{className:"dd-tree-name",children:P.name})]}),w?S(P.children,m+1):null]},`d:${P.path}`)}return t(dd,{doc:e,file:P.file,name:P.name,depth:m,active:P.path===a,renaming:u===P.path,onOpen:()=>r(P.path),onRename:()=>g(P.path),onRenameDone:w=>{D(P.path,w)},onDelete:()=>T(P.file)},`f:${P.path}`)});return l("nav",{className:"dd-tree","aria-label":"Files",children:[l("div",{className:"dd-tree-head",children:[t("span",{className:"dd-section-label",children:"Files"}),t("span",{className:"dd-tree-count",children:e.files.length}),t("span",{className:"dd-spacer"}),t(E,{icon:ta,label:"Add image",size:13,disabled:x,onClick:()=>C.current?.click()}),t(E,{icon:Q,label:"New file",size:13,disabled:x,onClick:()=>f(!0)}),t("input",{ref:C,type:"file",accept:"image/png,image/jpeg,image/gif,image/webp,image/svg+xml",multiple:!0,hidden:!0,onChange:p=>{R(p.target.files)}})]}),l("div",{className:"dd-tree-scroll",role:"tree",children:[S(h,0),i?t("div",{className:"dd-tree-row",style:{paddingLeft:8},children:t(dr,{initial:k,placeholder:"path/name.md, .mmd, .html\u2026",onSubmit:p=>{y(p)},onCancel:()=>f(!1)})}):null]}),I?t(qe,{request:I,onClose:()=>L(null)}):null]})}function sd(e,a){let r=o=>!!o&&e.files.some(d=>d.path===o);return r(a)?a:r(e.entryPath)?e.entryPath:e.files[0]?.path??null}function ld({doc:e,tab:a,onTab:r,activePath:o,now:d,pendingQuote:s,onClearQuote:n,onFocusComment:i,selectedRevision:f,onSelectRevision:u,onClose:g}){let I=[{id:"comments",label:"Comments",icon:de,count:e.openComments},{id:"history",label:"History",icon:Y},{id:"agents",label:"Agents",icon:V,count:e.threads.length}];return l("aside",{className:"dd-rail","aria-label":"Comments, history and agents",children:[l("div",{className:"dd-rail-tabs",role:"tablist",children:[I.map(L=>l("button",{type:"button",role:"tab","aria-selected":a===L.id,className:`dd-rail-tab${a===L.id?" on":""}`,onClick:()=>r(L.id),children:[t(L.icon,{size:13,"aria-hidden":!0}),L.label,L.count?t("span",{className:"dd-count",children:L.count}):null]},L.id)),g?l(z,{children:[t("span",{className:"dd-spacer"}),t(E,{icon:W,label:"Close",onClick:g,size:13})]}):null]}),a==="comments"?t(_o,{doc:e,activePath:o,now:d,pendingQuote:s,onClearQuote:n,onFocusComment:i}):a==="history"?t(ar,{doc:e,activePath:o,now:d,selectedId:f,onSelect:u}):t(ko,{doc:e,now:d})]})}function nd({doc:e,activePath:a,onOpen:r,onPathChanged:o}){let[d,s]=b(!1),n=e.files.find(i=>i.path===a);return t(te,{open:d,onClose:()=>s(!1),align:"start",className:"dd-switcher-pop",anchor:l("button",{type:"button",className:"dd-switcher","aria-haspopup":"dialog","aria-expanded":d,onClick:()=>s(!d),title:"Files in this doc",children:[n?t(Ne,{kind:n.kind}):null,l("span",{children:[e.files.length," files"]}),t(J,{size:12,"aria-hidden":!0})]}),children:t(Va,{doc:e,activePath:a,onOpen:i=>{s(!1),r(i)},onPathChanged:o})})}function Na({docId:e,path:a,onOpenPath:r,layout:o,contextProjectId:d=null,onDeleted:s,headerExtra:n}){let i=Ra(e),f=be(),u=Be(),g=o==="compact",[I,L]=K("view-mode","preview"),[C,h]=K(g?"rail-compact":"rail",!g),[x,k]=K("rail-tab","comments"),[y,D]=b(null),[R,T]=b(null),[v,S]=b(null),[p,m]=b(null),[P,w]=b(null),_=B({dirty:!1,saving:!1}),ye=B(null),oe=i.data,j=oe?sd(oe,a):null,gr=le(M=>{_.current=M},[]),wa=le(M=>{if(!_.current.dirty){M();return}m({title:"Discard unsaved changes?",body:"Your edits to this file have not been saved.",confirmLabel:"Discard",danger:!0,run:()=>{_.current={dirty:!1,saving:!1},M()}})},[]),ya=le(M=>{if(M===j){S(null);return}wa(()=>{S(null),r(M)})},[j,wa,r]);if(N(()=>{if(!P||P.path!==j||v)return;let M=[80,300,900].map(Ue=>setTimeout(()=>{ye.current?.focusQuote(P.quote)&&(M.forEach(clearTimeout),w(null))},Ue));return()=>M.forEach(clearTimeout)},[P,j,v]),!oe)return t("div",{className:"dd-doc dd-center",children:i.error?t(ae,{icon:ne,title:"This design doc could not be opened",children:i.error}):t(H,{label:"Loading design doc"})});let xr=M=>{M.path&&M.path!==j&&ya(M.path),I!=="preview"&&L("preview"),M.quote&&w({path:M.path??j??"",quote:M.quote,nonce:Date.now()})},hr=M=>wa(()=>{S(M),M.path!==j&&oe.files.some(Ue=>Ue.path===M.path)&&r(M.path)}),Lr=M=>{M==="preview"?wa(()=>L(M)):L(M)},Ka=(M,Ue)=>{M===j&&r(Ue,!0)},Ir=t(ld,{doc:oe,tab:x,onTab:k,activePath:j,now:u,pendingQuote:y,onClearQuote:()=>D(null),onFocusComment:xr,selectedRevision:v?.id??null,onSelectRevision:hr,onClose:g?()=>h(!1):void 0});return l("div",{className:`dd-doc dd-doc-${o}${C?" dd-rail-open":""}`,children:[t(Wo,{doc:oe,projects:f.data??[],compact:g,onDeleted:s,actions:l(z,{children:[n,t(Ao,{doc:oe,activePath:j,request:R,contextProjectId:d,compact:g})]})}),l("div",{className:"dd-doc-body",children:[g?null:t(Va,{doc:oe,activePath:j,onOpen:ya,onPathChanged:Ka}),j?t(or,{doc:oe,path:j,mode:I,onModeChange:Lr,railOpen:C,onToggleRail:()=>h(!C),revision:v,onCloseRevision:()=>S(null),previewHandle:ye,onOpenPath:ya,onQuote:M=>{D(M),k("comments"),h(!0)},onAskAbout:M=>T({prompt:`About this passage in ${j}:
> ${M.replace(/\n/g,`
> `)}

`,nonce:Date.now()}),onEditorState:gr,leading:g?t(nd,{doc:oe,activePath:j,onOpen:ya,onPathChanged:Ka}):null}):t("div",{className:"dd-file-pane dd-center",children:t(ae,{icon:ne,title:"This doc has no files",children:"Add one from the file list, or ask an agent to draft it."})}),C?Ir:null]}),p?t(qe,{request:p,onClose:()=>m(null)}):null]})}var sr="__global__",id=Da-600;function ud(e){return["Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.","Brief:",e.trim()].join(`

`)}function fd(e,a){let[r,o]=b(e);return N(()=>{let d=setTimeout(()=>o(e),a);return()=>clearTimeout(d)},[e,a]),r}function cd({doc:e,active:a,projectName:r,now:o,onSelect:d}){return l("button",{type:"button",className:`dd-doc-row${a?" on":""}`,onClick:d,"aria-current":a?"page":void 0,children:[l("span",{className:"dd-doc-row-top",children:[t("span",{className:"dd-doc-row-title",children:e.title}),t(Pe,{status:e.status,compact:!0})]}),e.summary?t("span",{className:"dd-doc-row-summary",children:e.summary}):null,l("span",{className:"dd-doc-row-meta",children:[r!==null?t("span",{className:"dd-doc-row-project",children:r}):null,l("span",{title:`${e.fileCount} files`,children:[t(Ae,{size:11,"aria-hidden":!0})," ",e.fileCount]}),e.openComments?l("span",{title:`${e.openComments} open comments`,className:"dd-doc-row-comments",children:[t(de,{size:11,"aria-hidden":!0})," ",e.openComments]}):null,e.updatedBy.kind==="agent"?t(V,{size:11,"aria-label":"Last edited by an agent"}):null,t("span",{className:"dd-spacer"}),t($,{at:e.updatedAt,now:o})]})]})}function pd({projectId:e,showProjects:a,projects:r,activeId:o,onSelect:d,onNew:s,headerActions:n}){let[i,f]=b(""),[u,g]=K("list-status","active"),[I,L]=K("list-project",""),[C,h]=b(!1),x=fd(i.trim(),200),k=Be(),y=Ma({...e?{projectId:e}:{},...x?{query:x}:{},status:u}),D=U(()=>new Map(r.map(S=>[S.id,S.name])),[r]),R=U(()=>{let S=y.data??[];return!a||!I?S:S.filter(p=>I===sr?p.projectId===null:p.projectId===I)},[y.data,a,I]),T=u!=="active"||a&&!!I,v=u==="active"?"Active":u==="all"?"All":La[u];return l("div",{className:"dd-list",children:[l("div",{className:"dd-list-head",children:[t("span",{className:"dd-list-title",children:"Design docs"}),t("span",{className:"dd-spacer"}),l("button",{type:"button",className:"btn primary dd-new",onClick:s,children:[t(Q,{size:13,"aria-hidden":!0})," New"]}),n]}),l("div",{className:"dd-list-tools",children:[l("label",{className:"dd-search",children:[t(fa,{size:13,"aria-hidden":!0}),t("input",{value:i,placeholder:"Search docs and content","aria-label":"Search design docs",onChange:S=>f(S.target.value)}),i?t("button",{type:"button",className:"dd-search-clear","aria-label":"Clear search",onClick:()=>f(""),children:t(W,{size:12,"aria-hidden":!0})}):null]}),l(te,{open:C,onClose:()=>h(!1),className:"dd-menu",anchor:t(E,{icon:xe,label:`Filter (${v})`,active:T||C,onClick:()=>h(!C)}),children:[t("div",{className:"dd-menu-section",children:"Status"}),["active",...Ta,"all"].map(S=>t(X,{label:S==="active"?"Active (not archived)":S==="all"?"All":La[S],checked:S===u,onSelect:()=>{g(S),h(!1)}},S)),a?l(z,{children:[t("div",{className:"dd-menu-section",children:"Project"}),[{id:"",name:"All projects"},{id:sr,name:"Global docs"},...r].map(S=>t(X,{label:S.name,checked:S.id===I,onSelect:()=>{L(S.id),h(!1)}},S.id||"all"))]}):null]})]}),l("div",{className:"dd-list-scroll",children:[y.error?t("div",{className:"dd-banner dd-banner-error",children:y.error}):null,!y.data&&y.loading?t("div",{className:"dd-center",children:t(H,{label:"Loading design docs"})}):null,y.data&&!R.length?t("div",{className:"dd-list-empty dd-muted",children:x||T?"No docs match.":"No design docs yet."}):null,R.map(S=>t(cd,{doc:S,active:S.id===o,projectName:a?S.projectId?D.get(S.projectId)??"Unknown project":"Global":S.projectId?null:"Global",now:k,onSelect:()=>d(S.id)},S.id))]})]})}function lr({templates:e,selected:a,onSelect:r}){return t("div",{className:"dd-templates",role:"radiogroup","aria-label":"Template",children:e.map(o=>l("button",{type:"button",role:"radio","aria-checked":a===o.id,className:`dd-template${a===o.id?" on":""}`,onClick:()=>r(o.id),children:[t("span",{className:"dd-template-label",children:o.label}),t("span",{className:"dd-template-desc",children:o.description}),t("span",{className:"dd-template-files",children:o.files.join(" \xB7 ")})]},o.id))})}function Wa({initialTemplate:e,defaultProjectId:a,projects:r,onClose:o,onCreated:d}){let s=O(),n=se(),i=Oa(),[f,u]=b(""),[g,I]=b(""),[L,C]=b(e??null),[h,x]=b(a??""),[k,y]=b(""),[D,R]=b(""),[T,v]=b(!1),S=L??i.data?.[0]?.id??null,p=!!D.trim(),m=h||a||r[0]?.id||"",P=async()=>{if(!(!f.trim()||T)){v(!0);try{let w=await s.create({title:f.trim(),...g.trim()?{summary:g.trim()}:{},...S?{template:S}:{},tags:k.split(",").map(_=>_.trim().toLowerCase()).filter(Boolean),projectId:h||null});if(d(w.id),p)if(!m)A("Doc created. Add a project to let an agent draft it.","error");else{let _=await s.askAgent(w.id,{prompt:ud(D),projectId:m});n.openThreadPanel({actionId:we,title:w.title,params:{docId:w.id},threadId:_.threadId}),n.toThread(_.threadId),A(`An agent is drafting \u201C${w.title}\u201D. Watch it fill in beside the chat.`)}o()}catch(w){A(`Could not create the doc: ${q(w)}`,"error"),v(!1)}}};return t(Ia,{title:"New design doc",wide:!0,onClose:o,footer:l(z,{children:[t("span",{className:"dd-muted dd-dialog-hint",children:p?"An agent starts a new thread to draft it.":"You can ask an agent to fill it in later."}),t("span",{className:"dd-spacer"}),t("button",{type:"button",className:"btn",onClick:o,children:"Cancel"}),l("button",{type:"button",className:"btn primary",disabled:!f.trim()||T,onClick:()=>{P()},children:[T?t(H,{size:12}):p?t(G,{size:12,"aria-hidden":!0}):null,p?"Create & draft with agent":"Create"]})]}),children:l("form",{className:"dd-form",onSubmit:w=>{w.preventDefault(),P()},children:[l("label",{className:"dd-field",children:[t("span",{className:"dd-field-label",children:"Title"}),t("input",{className:"dd-input",value:f,maxLength:140,placeholder:"e.g. Offline sync for the mobile app",onChange:w=>u(w.target.value),autoFocus:!0})]}),l("label",{className:"dd-field",children:[t("span",{className:"dd-field-label",children:"Summary"}),t("input",{className:"dd-input",value:g,maxLength:600,placeholder:"One line agents see when deciding which doc to read",onChange:w=>I(w.target.value)})]}),l("div",{className:"dd-field",children:[t("span",{className:"dd-field-label",children:"Template"}),i.data?t(lr,{templates:i.data,selected:S,onSelect:C}):t(H,{label:"Loading templates"})]}),l("div",{className:"dd-field-row",children:[l("label",{className:"dd-field",children:[t("span",{className:"dd-field-label",children:"Project"}),l("select",{className:"dd-input dd-select",value:h,onChange:w=>x(w.target.value),children:[t("option",{value:"",children:"Global (all projects)"}),r.map(w=>t("option",{value:w.id,children:w.name},w.id))]})]}),l("label",{className:"dd-field",children:[t("span",{className:"dd-field-label",children:"Tags"}),t("input",{className:"dd-input",value:k,placeholder:"sync, mobile",onChange:w=>y(w.target.value)})]})]}),l("label",{className:"dd-field",children:[l("span",{className:"dd-field-label",children:[t(G,{size:12,"aria-hidden":!0})," Brief for an agent ",t("span",{className:"dd-muted",children:"(optional)"})]}),t("textarea",{className:"dd-input",rows:4,value:D,maxLength:id,placeholder:"Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch.",onChange:w=>R(w.target.value)})]}),t("button",{type:"submit",hidden:!0})]})})}function md({templates:e,onNew:a}){return t("div",{className:"dd-landing",children:l("div",{className:"dd-landing-inner",children:[t("span",{className:"dd-landing-icon",children:t(ce,{size:26,"aria-hidden":!0})}),t("h1",{className:"dd-landing-title",children:"Design docs your agents work on with you"}),t("p",{className:"dd-landing-lede",children:"Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for context, edit them, and leave review comments. You watch every change land live."}),l("ul",{className:"dd-landing-points",children:[l("li",{children:[t(G,{size:13,"aria-hidden":!0})," ",t("strong",{children:"Ask agent"})," to review, fill gaps, add diagrams or check a design against the code."]}),l("li",{children:[t(de,{size:13,"aria-hidden":!0})," Select any passage to comment. Agents address open comments."]}),l("li",{children:[t(V,{size:13,"aria-hidden":!0})," Every save is versioned, so an agent's edit is always one click from undone."]})]}),l("div",{className:"dd-landing-start",children:[t("span",{className:"dd-section-label",children:"Start from a template"}),e?t(lr,{templates:e,selected:null,onSelect:r=>a(r)}):t(H,{})]})]})})}function $a({projectId:e,location:a,onLocationChange:r,variant:o,headerActions:d}){let s=be(),n=Oa(),[i,f]=b(null),u=s.data??[];return l("div",{className:"dd-root dd-workbench",children:[t(pd,{projectId:o==="project"?e:null,showProjects:o==="global",projects:u,activeId:a.docId,onSelect:g=>r({docId:g,path:null}),onNew:()=>f({template:null}),headerActions:d}),t("main",{className:"dd-main",children:a.docId?t(Na,{docId:a.docId,path:a.path,layout:"workbench",contextProjectId:e,onOpenPath:(g,I)=>r({docId:a.docId,path:g},I??!0),onDeleted:()=>r({docId:null,path:null})},a.docId):t(md,{templates:n.data,onNew:g=>f({template:g??null})})}),i?t(Wa,{initialTemplate:i.template,defaultProjectId:e,projects:u,onClose:()=>f(null),onCreated:g=>r({docId:g,path:null})}):null]})}var He="design-docs";function nr({children:e}){return t("div",{className:"dd-root",children:e})}function ir({subPath:e}){let a=se();return t($a,{variant:"global",projectId:null,location:Ea(e),onLocationChange:(r,o)=>a.toPluginPanel(He,{subPath:Oe(r),...o?{replace:o}:{}})})}function ur({projectId:e,headerActions:a}){let[r,o]=K(`project-location:${e}`,"");return t($a,{variant:"project",projectId:e,location:Ea(r),onLocationChange:d=>o(Oe(d)),headerActions:a})}function gd(e,a,r,o){e.openThreadPanel({actionId:we,title:r,params:{docId:a.docId,...a.path?{path:a.path}:{}},...o?{threadId:o}:{}})||e.toPluginPanel(He,{subPath:Oe(a)})}function fr({attributes:e,source:a,message:r}){let o=se(),d=e.id?.trim()||null,s=e.path?.trim()||null,n=Ra(d);if(!d||n.error)return t("div",{className:"plugin-directive-card plugin-directive-card--error",role:"alert",title:a,children:d?`Design doc unavailable: ${n.error}`:"Invalid design doc link: an id is required."});let i=n.data;return l("div",{className:"plugin-directive-card dd-card",children:[l("button",{type:"button",className:"plugin-directive-card-main",disabled:!i,onClick:()=>i&&gd(o,{docId:i.id,path:s},i.title,r.threadId),title:i?`Open ${i.title} beside this conversation`:void 0,children:[t("span",{className:"dd-card-icon","aria-hidden":!0,children:t(ce,{size:14})}),t("span",{className:"plugin-directive-card-kind",children:"Design doc"}),t("span",{className:"plugin-directive-card-title",children:i?i.title:"Loading\u2026"}),i?l("span",{className:"plugin-directive-card-meta dd-card-meta",children:[s?t("code",{children:s}):null,t(Pe,{status:i.status,compact:!0}),i.files.length," file",i.files.length===1?"":"s",i.openComments?` \xB7 ${i.openComments} open comment${i.openComments===1?"":"s"}`:""]}):t(H,{size:12})]}),i?t("button",{type:"button",className:"plugin-directive-card-open",onClick:f=>{f.stopPropagation(),o.toPluginPanel(He,{subPath:Oe({docId:i.id,path:s})})},title:"Open in Design Docs",children:"Open in Design Docs"}):null]})}function xd({projectId:e,onPick:a}){let r=Ma({...e?{projectId:e}:{},status:"active"}),o=be(),d=Be(),[s,n]=b(!1);return l("div",{className:"dd-picker",children:[l("div",{className:"dd-picker-head",children:[t("span",{className:"dd-list-title",children:"Design docs"}),t("span",{className:"dd-spacer"}),l("button",{type:"button",className:"btn primary",onClick:()=>n(!0),children:[t(Q,{size:13,"aria-hidden":!0})," New"]})]}),t("div",{className:"dd-list-scroll",children:r.data?r.data.length?r.data.map(i=>l("button",{type:"button",className:"dd-doc-row",onClick:()=>a(i.id),children:[l("span",{className:"dd-doc-row-top",children:[t("span",{className:"dd-doc-row-title",children:i.title}),t(Pe,{status:i.status,compact:!0})]}),i.summary?t("span",{className:"dd-doc-row-summary",children:i.summary}):null,l("span",{className:"dd-doc-row-meta",children:[l("span",{children:[i.fileCount," files"]}),t("span",{className:"dd-spacer"}),t($,{at:i.updatedAt,now:d})]})]},i.id)):t(ae,{icon:ce,title:"No design docs here yet",children:"Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools."}):t("div",{className:"dd-center",children:r.error?t("div",{className:"dd-banner dd-banner-error",children:r.error}):t(H,{})})}),s?t(Wa,{defaultProjectId:e,projects:o.data??[],onClose:()=>n(!1),onCreated:i=>a(i)}):null]})}function hd(e){if(!e||typeof e!="object"||Array.isArray(e))return{docId:null,path:null};let a=e;return{docId:typeof a.docId=="string"&&a.docId?a.docId:null,path:typeof a.path=="string"&&a.path?a.path:null}}function cr({params:e,projectId:a}){let r=se(),o=hd(e),[d,s]=b(o),n=!o.docId;if(!d.docId)return t(nr,{children:t(xd,{projectId:a??null,onPick:f=>s({docId:f,path:null})})});let i=d.docId;return t(nr,{children:t(Na,{docId:i,path:d.path,layout:"compact",contextProjectId:a??null,onOpenPath:f=>s({docId:i,path:f}),onDeleted:()=>s({docId:null,path:null}),headerExtra:l(z,{children:[n?t(E,{icon:je,label:"All design docs",onClick:()=>s({docId:null,path:null})}):null,t(E,{icon:Xe,label:"Open in Design Docs",onClick:()=>r.toPluginPanel(He,{subPath:Oe(d)})})]})},i)})}async function pr({threadId:e,message:a,selectedText:r,openPanel:o}){let d=(r?.trim()||a.text).trim();if(!d){A("This message has no text to save.","error");return}try{let s=await Ja(Lo,"createFromMessage",{threadId:e,text:d});o({actionId:we,title:s.title,params:{docId:s.id}}),A(`Saved \u201C${s.title}\u201D as a design doc`)}catch(s){A(`Could not save the design doc: ${q(s)}`,"error")}}var Xa=`
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
.dd-tag-remove { display: none; padding: 0; margin-left: 2px; border: 0; background: none; color: inherit; cursor: pointer; }
.dd-tag:hover .dd-tag-remove { display: inline-flex; }
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
.dd-html-toolbar { display: flex; justify-content: center; gap: 2px; padding: 4px; border-bottom: 1px solid var(--border); background: var(--bg-base); }
.dd-html-viewport { display: flex; justify-content: center; flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--bg-base); }
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
.dd-doc-compact .dd-rail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 15; width: min(340px, 100%); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.25); }
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
@media (max-width: 1180px) {
  .dd-workbench .dd-rail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 15; box-shadow: -12px 0 32px rgba(0, 0, 0, 0.25); }
}
@media (max-width: 900px) {
  .dd-list { flex-basis: 220px; width: 220px; }
  .dd-tree { flex-basis: 180px; width: 180px; }
  .dd-mode-label, .dd-file-meta { display: none; }
}
`;var mr="design-docs-plugin-styles";function Ld(){if(typeof document>"u")return;let e=document.getElementById(mr);if(e instanceof HTMLStyleElement){e.textContent=Xa;return}let a=document.createElement("style");a.id=mr,a.textContent=Xa,document.head.appendChild(a)}Ld();var cc=Qa(e=>{e.slots.navPanel({id:"design-docs",title:"Design Docs",icon:"DraftingCompass",path:He,component:ir}),e.slots.projectTab({id:"design",label:"Design",icon:"DraftingCompass",header:"custom",component:ur}),e.slots.messageDirective({id:"design-doc",component:fr}),e.slots.threadPanelAction({id:we,title:"Design doc",icon:"DraftingCompass",layout:"flush",scopes:["thread","agent-session"],component:cr}),e.slots.messageAction({id:"save-design-doc",title:"Save as design doc",icon:"FilePlus",run:pr})});export{cc as default,Ld as injectStyles};
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
lucide-react/dist/esm/icons/file-x-corner.mjs:
lucide-react/dist/esm/icons/folder-input.mjs:
lucide-react/dist/esm/icons/folder-open.mjs:
lucide-react/dist/esm/icons/folder.mjs:
lucide-react/dist/esm/icons/funnel.mjs:
lucide-react/dist/esm/icons/globe.mjs:
lucide-react/dist/esm/icons/hash.mjs:
lucide-react/dist/esm/icons/house.mjs:
lucide-react/dist/esm/icons/image-plus.mjs:
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
