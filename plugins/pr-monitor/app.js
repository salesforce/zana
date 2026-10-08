var $=globalThis.__ZCC_HOST_REACT__;var Cn=$.Children,Sn=$.Component,yn=$.Fragment,wn=$.StrictMode,vn=$.Suspense,Pn=$.cloneElement,$t=$.createContext,Da=$.createElement,kn=$.createRef,dt=$.forwardRef,An=$.isValidElement,Rn=$.lazy,Mn=$.memo,Tn=$.startTransition,W=$.useCallback,Wt=$.useContext,Dn=$.useDebugValue,Nn=$.useDeferredValue,j=$.useEffect,Xt=$.useId,Bn=$.useImperativeHandle,Fn=$.useInsertionEffect,Kt=$.useLayoutEffect,Q=$.useMemo,En=$.useReducer,oe=$.useRef,f=$.useState,Zt=$.useSyncExternalStore,Hn=$.useTransition,On=$.version;function gs(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function hs(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}async function ua(e,t,s){return gs().callRpc(e,t,s)}function Jt(e){return{__zccPluginApp:!0,setup:e}}function wt(e,t){hs().useRealtime?.(e,t)}var Yt=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Qt(e,t,s=[]){if(t==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:Yt(e),size:24,node:t,...s.length>0?{aliases:s}:{}}}var eo=e=>{let t="",s=!1;for(let r of e){if(r==="-"||r==="_"||r<=" "){s=t.length>0;continue}t.length===0?t+=r.toLowerCase():t+=s?r.toUpperCase():r,s=!1}return t};var ao=e=>{let t=eo(e);return t.charAt(0).toUpperCase()+t.slice(1)};var za=(...e)=>e.filter((t,s,r)=>!!t&&t.trim()!==""&&r.indexOf(t)===s).join(" ").trim();var ca={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function vt(e){return e!=null}function to(e,t={}){let s=t.attributeNames??{},r=I=>s[I]??I,n=e.size??e.width??ca.width,i=e.size??e.height??ca.height,l=e.aliases?.filter(I=>typeof I=="string"&&I.trim()!=="").map(I=>`lucide-${I}`)??[],g=[...e.name?[`lucide-${e.name}`]:[],...l],L=t.className?.split(" ").filter(Boolean)??[],p=t.includeDefaultClasses===!1?za(...L):za("lucide",...g,...L),S=t.absoluteStrokeWidth?Number(t.strokeWidth??ca["stroke-width"])*Number(e.size??e.width??ca.width)/Number(t.size??t.width??ca.width):t.strokeWidth??ca["stroke-width"];return["svg",{...Object.entries(ca).reduce((I,[c,C])=>(I[r(c)]=C,I),{}),..."color"in t&&t.color&&{[r("stroke")]:t.color},..."size"in t&&vt(t.size)&&{[r("width")]:t.size,[r("height")]:t.size},..."width"in t&&vt(t.width)&&{[r("width")]:t.width},..."height"in t&&vt(t.height)&&{[r("height")]:t.height},[r("stroke-width")]:S,...p&&{[r("class")]:p},[r("viewBox")]:`0 0 ${n} ${i}`,...t.hasA11yProp===!1?{[r("aria-hidden")]:"true"}:{},..."attributes"in t&&t.attributes},e.node.map(I=>{let[c,C,h]=I,d=t.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...C}:C;return h?[c,d,h]:[c,d]})]}function oo(e,t={}){return to(e,{...t,attributeNames:{...t.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var ro=e=>{for(let t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};var xs=$t({});var so=()=>Wt(xs);var no=dt(({color:e,size:t,width:s,height:r,strokeWidth:n,absoluteStrokeWidth:i,nonScalingStroke:l,className:g="",children:L,iconNode:p=[],icon:S={node:p,aliases:[],size:24},...y},I)=>{let{size:c=24,strokeWidth:C=2,absoluteStrokeWidth:h=!1,nonScalingStroke:d=!1,color:v="currentColor",className:A=""}=so()??{},U=!!L||ro(y),[R,E,X=[]]=oo(S,{color:e??v,width:s??t??c,height:r??t??c,strokeWidth:n??C,absoluteStrokeWidth:i??h,nonScalingStroke:l??d,className:za(A,g),hasA11yProp:U,attributes:y});return Da(R,{ref:I,...E},[...X.map(([N,z])=>Da(N,z)),...Array.isArray(L)?L:[L]])});function x(e,t=[],s=[]){let r=typeof e=="string"?Qt(e,t,s):e,n=dt(({className:i,...l},g)=>Da(no,{ref:g,icon:r,className:i,...l}));return r.name&&(n.displayName=ao(r.name)),n}var lo={name:"arrow-down",size:24,node:[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]]};lo.node;var Ua=x(lo);var io={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};io.node;var Na=x(io);var uo={name:"arrow-up",size:24,node:[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]]};uo.node;var _a=x(uo);var co={name:"bell-off",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]]};co.node;var oa=x(co);var fo={name:"bell",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]]};fo.node;var De=x(fo);var po={name:"book-bookmark",size:24,node:[["path",{d:"M10 2v7.751a.25.25 0 00.407.195l2.28-1.834a.5.5 0 01.627 0l2.28 1.834A.25.25 0 0016 9.751V2",key:"x9x4jl"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 016.5 2H19a1 1 0 011 1v18a1 1 0 01-1 1H6.5a1 1 0 010-5H20",key:"1889un"}]],aliases:["book-marked"]};po.node;var fa=x(po);var mo={name:"building-complex",size:24,node:[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],aliases:["building-2"]};mo.node;var pa=x(mo);var go={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};go.node;var qe=x(go);var ho={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};ho.node;var Pa=x(ho);var xo={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};xo.node;var ra=x(xo);var bo={name:"circle-alert",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],aliases:["alert-circle"]};bo.node;var ve=x(bo);var Lo={name:"circle-check",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 9-5.5 5.5L8 12",key:"xofnsj"}]],aliases:["check-circle-2"]};Lo.node;var ge=x(Lo);var Io={name:"circle-dashed",size:24,node:[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]]};Io.node;var Ga=x(Io);var Co={name:"circle-question-mark",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["help-circle","circle-help"]};Co.node;var Ne=x(Co);var So={name:"circle-x",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],aliases:["x-circle"]};So.node;var Pe=x(So);var yo={name:"clock",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]]};yo.node;var Be=x(yo);var wo={name:"cloud-off",size:24,node:[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};wo.node;var Va=x(wo);var vo={name:"columns-3",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],aliases:["panels-left-right"]};vo.node;var ma=x(vo);var Po={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};Po.node;var ja=x(Po);var ko={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};ko.node;var ga=x(ko);var Ao={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};Ao.node;var Fe=x(Ao);var Ro={name:"eye-off",size:24,node:[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};Ro.node;var $a=x(Ro);var Mo={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};Mo.node;var Wa=x(Mo);var To={name:"folder-git-2",size:24,node:[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]]};To.node;var Xa=x(To);var Do={name:"folder-search",size:24,node:[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]]};Do.node;var Ba=x(Do);var No={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};No.node;var Ka=x(No);var Bo={name:"git-branch",size:24,node:[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]]};Bo.node;var ze=x(Bo);var Fo={name:"git-merge",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]]};Fo.node;var sa=x(Fo);var Eo={name:"git-pull-request-closed",size:24,node:[["path",{d:"m15.5 3.5 5 5",key:"1kmx7t"}],["path",{d:"m15.5 8.5 5-5",key:"saftza"}],["path",{d:"M18 11.62V15",key:"1greaj"}],["path",{d:"M6 9v12",key:"1sc30k"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}]]};Eo.node;var na=x(Eo);var Ho={name:"git-pull-request-draft",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};Ho.node;var Xe=x(Ho);var Oo={name:"git-pull-request",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};Oo.node;var he=x(Oo);var qo={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};qo.node;var Za=x(qo);var zo={name:"layout-list",size:24,node:[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]]};zo.node;var Ja=x(zo);var Uo={name:"link-2",size:24,node:[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]]};Uo.node;var Ue=x(Uo);var _o={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};_o.node;var V=x(_o);var Go={name:"mail-open",size:24,node:[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]]};Go.node;var Ke=x(Go);var Vo={name:"mail",size:24,node:[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]]};Vo.node;var la=x(Vo);var jo={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};jo.node;var ha=x(jo);var $o={name:"pen",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],aliases:["edit-2"]};$o.node;var Ze=x($o);var Wo={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};Wo.node;var Fa=x(Wo);var Xo={name:"refresh-cw",size:24,node:[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]};Xo.node;var Ce=x(Xo);var Ko={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Ko.node;var xa=x(Ko);var Zo={name:"settings",size:24,node:[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};Zo.node;var Ya=x(Zo);var Jo={name:"shield-alert",size:24,node:[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]]};Jo.node;var Qa=x(Jo);var Yo={name:"sliders-horizontal",size:24,node:[["path",{d:"M10 5H3",key:"1qgfaw"}],["path",{d:"M12 19H3",key:"yhmn1j"}],["path",{d:"M14 3v4",key:"1sua03"}],["path",{d:"M16 17v4",key:"1q0r14"}],["path",{d:"M21 12h-9",key:"1o4lsq"}],["path",{d:"M21 19h-5",key:"1rlt1p"}],["path",{d:"M21 5h-7",key:"1oszz2"}],["path",{d:"M8 10v4",key:"tgpxqk"}],["path",{d:"M8 12H3",key:"a7s4jb"}]]};Yo.node;var et=x(Yo);var Qo={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};Qo.node;var Ee=x(Qo);var er={name:"square-check-big",size:24,node:[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],aliases:["check-square"]};er.node;var ba=x(er);var ar={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};ar.node;var Re=x(ar);var tr={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};tr.node;var ie=x(tr);var or={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};or.node;var _e=x(or);var rr={name:"users",size:24,node:[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]]};rr.node;var at=x(rr);var sr={name:"wifi-off",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};sr.node;var tt=x(sr);var nr={name:"wifi",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]]};nr.node;var ka=x(nr);var lr={name:"wrench",size:24,node:[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]]};lr.node;var ot=x(lr);var ir={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};ir.node;var Ge=x(ir);var st={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},ut="standard",rt={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},ct="standard";function bs(e){let t=e?.buildTisPreset??e?.tisPreset;return t&&t in st?t:ut}function dr(e,t){let s=(e??"").toLowerCase();return s?(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function nt(e,t,s,r){let n=dr(e,t);if(n){let i=st[bs(n)];return{warnHours:i.warnHours,dangerHours:i.dangerHours}}return{warnHours:s,dangerHours:r}}function Pt(e,t,s,r){let n=dr(e,t);if(n){let i=n.reviewTisPreset&&n.reviewTisPreset in rt?n.reviewTisPreset:ct,l=rt[i];return{warnDays:l.warnDays,dangerDays:l.dangerDays}}return{warnDays:s,dangerDays:r}}var ur={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},kt="organizations",Aa={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:kt,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},ke="monitoredCount",re="monitoredPrs",Ra="settings",lt="prefetch:orgs",At="prefetch:repos",Rt="prefetch:author",Ls=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function Mt(e){let t=Ls.exec(e);if(!t)throw new Error(`Not a GitHub PR URL: ${e}`);return t[1]}var Is={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function Tt(e){return Is[e]}var Cs={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function Dt(e){return Cs[e]}var Ss=/\bW-\d{8}\b/i;function La(e,t,s){for(let r of[e,t,s]){if(typeof r!="string"||!r)continue;let n=Ss.exec(r);if(n)return n[0].toUpperCase()}}function ft(e,t){if(!e||!t||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(t)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${t.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var ys=Symbol.for("react.portal");function Ia(e,t){return{$$typeof:ys,key:null,children:e,containerInfo:t,implementation:null}}var cr=globalThis.__ZCC_HOST_REACT__,Z=cr.Fragment;function a(e,t,s){return cr.createElement(e,s===void 0?t:{...t,key:s})}var o=a;function ue({title:e,icon:t,onClose:s,busy:r=!1,children:n,footer:i,wide:l=!1,className:g="",titleId:L,closeLabel:p="Close",backdropTestId:S}){let y=Xt(),I=L??y,c=oe(null),C=oe(typeof document>"u"?null:document.activeElement),h=oe({onClose:s,busy:r});h.current={onClose:s,busy:r},j(()=>{let v=C.current,A=c.current;A.focus();let U=R=>{if(R.defaultPrevented)return;let E=document.querySelectorAll(".prm-modal");if(E[E.length-1]===A){if(R.key==="Escape")R.preventDefault(),h.current.busy||h.current.onClose();else if(R.key==="Tab"){let X=Array.from(A.querySelectorAll("button, [href], input, select, textarea, [tabindex]")).filter(G=>G.tabIndex>=0&&!G.matches(":disabled")&&!G.closest("[hidden], [inert]")&&getComputedStyle(G).display!=="none"&&getComputedStyle(G).visibility!=="hidden"),N=X[0],z=X[X.length-1];N?R.shiftKey&&(document.activeElement===N||document.activeElement===A)?(R.preventDefault(),z.focus()):!R.shiftKey&&(document.activeElement===z||document.activeElement===A)&&(R.preventDefault(),N.focus()):(R.preventDefault(),A.focus())}}};return window.addEventListener("keydown",U),()=>{window.removeEventListener("keydown",U),v?.isConnected&&v.focus()}},[]);let d=a("div",{className:"modal-backdrop prm-modal-backdrop","data-testid":S,onClick:v=>{v.target===v.currentTarget&&!r&&s()},children:o("div",{ref:c,tabIndex:-1,role:"dialog","aria-modal":"true","aria-labelledby":I,className:`modal prm-modal${l?" prm-modal--wide":""} ${g}`,children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:I,children:[t&&a("span",{className:"prm-modal-icon","aria-hidden":!0,children:t}),e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close","aria-label":p,children:a(Ge,{size:16,"aria-hidden":!0})})]}),n,i]})});return typeof document>"u"?d:Ia(d,document.body)}function Me(e){let t=Date.now(),s=Math.max(0,t-e),r=Math.floor(s/1e3);if(r<60)return"just now";let n=Math.floor(r/60);if(n<60)return`${n}m ago`;let i=Math.floor(n/60);if(i<24)return`${i}h ago`;let l=Math.floor(i/24);if(l===1)return"yesterday";if(l<30)return`${l}d ago`;let g=Math.floor(l/30);return g<12?`${g}mo ago`:`${Math.floor(g/12)}y ago`}var ws={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function xe(e){return ws[e]}function fr(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function pt(e){let t=0,s=0,r=0;for(let n of e){let i=n.state.toUpperCase();i==="SUCCESS"||i==="PASS"||i==="PASSED"?t++:i==="FAILURE"||i==="FAILED"||i==="ERROR"||i==="CANCELLED"?s++:r++}return{pass:t,fail:s,pending:r}}var vs={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function pr(e){return vs[e.toUpperCase()]??"pending"}function Ea(e){return{label:xe(e),className:`prm-status-pill--${e}`}}var Ve=4,je=6,Ma=3,Ta=5;function Ca(e){if(!e)return"";let t=Math.max(0,Date.now()-e),s=Math.floor(t/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function Sa(e,t){let s=t==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function ya(e){let t=e.name||e.login,s=t.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():t.slice(0,2).toUpperCase()}var mr="(max-width: 1024px)";function Ps(e){let t=window.matchMedia?.(mr);return t?.addEventListener("change",e),()=>t?.removeEventListener("change",e)}function mt(){return Zt(Ps,()=>window.matchMedia?.(mr).matches??!1,()=>!1)}function gr({query:e,onQuery:t,status:s,onStatus:r,statuses:n,hosts:i,hostScope:l,onHostScope:g,sortField:L,sortDir:p,onSort:S,sortFields:y,shownCount:I}){let[c,C]=f(!1),h=s!=="all"||l.length>0;return o(Z,{children:[o("div",{className:"prm-mobile-toolbar",children:[o("div",{className:"prm-search",children:[a(xa,{size:18,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026","aria-label":"Search PRs",value:e,onChange:d=>t(d.target.value)})]}),o("button",{type:"button",className:`prm-btn${h?" is-active":""}`,"aria-haspopup":"dialog","aria-expanded":c,onClick:()=>C(!0),children:[a(et,{size:18,"aria-hidden":!0})," Filters",h&&a("span",{className:"prm-mobile-filter-dot"})]})]}),o("div",{className:"prm-mobile-summary","aria-live":"polite",children:[o("span",{children:[I," pull request",I===1?"":"s",s!=="all"&&` \xB7 ${xe(s)}`]}),h&&a("button",{type:"button",className:"prm-text-btn",onClick:()=>{r("all"),g([])},children:"Clear filters"})]}),c&&a(ue,{title:"Filter pull requests",closeLabel:"Close PR filters",onClose:()=>C(!1),footer:a("footer",{className:"prm-modal-footer",children:o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>C(!1),children:["Show ",I," pull request",I===1?"":"s"]})}),children:o("div",{className:"prm-modal-body prm-mobile-filters",children:[o("label",{className:"prm-field",children:["Status",o("select",{"aria-label":"Status",className:"prm-input",value:s,onChange:d=>r(d.target.value),children:[a("option",{value:"all",children:"All statuses"}),n.map(({id:d,count:v})=>o("option",{value:d,children:[xe(d)," (",v,")"]},d))]})]}),o("label",{className:"prm-field",children:["Sort by",a("select",{"aria-label":"Sort by",className:"prm-input",value:L,onChange:d=>S(d.target.value,p),children:y.map(({id:d,label:v})=>a("option",{value:d,children:v},d))})]}),o("label",{className:"prm-field",children:["Order",o("select",{"aria-label":"Order",className:"prm-input",value:p,disabled:L==="favorites",onChange:d=>S(L,d.target.value),children:[a("option",{value:"asc",children:"Ascending"}),a("option",{value:"desc",children:"Descending"})]})]}),o("fieldset",{className:"prm-mobile-hosts",children:[a("legend",{children:"Git hosts"}),a("button",{type:"button",className:"prm-btn","aria-pressed":l.length===0,onClick:()=>g([]),children:"All hosts"}),i.map(d=>o("label",{children:[a("input",{type:"checkbox",checked:l.includes(d),onChange:()=>g(l.includes(d)?l.filter(v=>v!==d):[...l,d])}),d]},d))]})]})})]})}function hr({prs:e,onOpen:t}){return a("div",{className:"prm-mobile-list",children:e.map(s=>{let r=s.lastSeenAt===0||s.lastStatusChange>(s.lastSeenAt??s.addedAt),n=Ea(s.status);return o("button",{type:"button",className:`prm-mobile-card${r?" is-unread":""}`,onClick:()=>t(s),children:[o("span",{className:"prm-mobile-card-repo",children:[a(Ka,{size:14,"aria-hidden":!0}),a("span",{children:s.repo}),o("span",{children:["#",s.number]}),s.favorite&&a(Re,{size:14,fill:"currentColor","aria-label":"Favorite"})]}),a("span",{className:"prm-mobile-card-title",children:s.title}),o("span",{className:"prm-mobile-card-meta",children:[a("span",{className:`prm-status-pill ${n.className}`,children:n.label}),s.isDraft&&a("span",{children:"Draft"}),s.author&&a("span",{className:"prm-mobile-author",children:s.author.name||s.author.login}),a("span",{className:"prm-mobile-card-time",children:Me(s.updatedAt||s.lastChecked||s.lastStatusChange)})]}),s.syncError&&o("span",{className:"prm-mobile-sync-error",children:[a(ve,{size:14,"aria-hidden":!0}),"Sync failed \xB7 Open for details"]})]},s.url)})})}function xr({onSave:e}){let[t,s]=f(!1),r=async()=>{s(!0);try{await e({...Aa})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:o("div",{className:"prm-setup",children:[a(he,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{r()},disabled:t,children:t?"Saving\u2026":"Get started"})})]})})}async function pe(e,t,s){try{let r=await e.call(t,s);if(!r?.ok)throw new Error(r?.error||"The request failed. Please try again.");Array.isArray(r.prs)&&(e.cache.set(re,r.prs),e.cache.set(ke,r.prs.length),e.cache.refreshBadge())}catch(r){e.toast(`Couldn't update PR \u2014 ${r instanceof Error?r.message:String(r)}`,"error")}}var ks=new Set(["fail","failure"]),As=new Set(["pending","in_progress","queued"]);function Rs(e){return(e??"").toLowerCase().trim()||"pending"}function Ms(e,t){if(!t||t.length===0)return!1;let s=(e??"").toLowerCase();return t.some(r=>{let n=(r??"").toLowerCase();return n.length>0&&s.includes(n)})}function Ha(e,t={}){if(!e||e.length===0)return!1;let s=t.ignoredFailingChecks;for(let r of e){let n=Rs(r.bucket||r.state);if(As.has(n)||ks.has(n)&&!Ms(r.name,s))return!1}return!0}function Oa(e){let{status:t,buildHappy:s,reviewApproved:r,sfciGated:n,hasSfciJob:i,elapsedHours:l,warnHours:g,dangerHours:L}=e;if(t==="integrating"||t==="closed-merged"||t==="closed-abandoned")return"done";let p=n&&!i;return s&&r&&t==="yellow"?p?"blocked":l>=L?"merge-stall":l>=g?"warn":"ok":s?"done":p?"blocked":l>=L?"danger":l>=g?"warn":"ok"}function gt(e){let{reviewApproved:t,merged:s,elapsedDays:r,warnDays:n,dangerDays:i}=e;return t&&!s?"done":r>=i?"danger":r>=n?"warn":"ok"}function Ts(e){if(typeof document>"u")return!1;let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.top="-9999px",t.setAttribute("readonly",""),document.body.appendChild(t);try{return t.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(t)}}async function qa(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return Ts(e)}var ht=4,xt=8,br=120,Ds=320,Ns=280;function Bs(e,t){let s=t.innerHeight-e.bottom-ht-xt,r=e.top-ht-xt,n=s<br&&r>s,i=Math.max(br,Math.min(Ds,n?r:s)),l=Math.max(xt,Math.min(e.left,t.innerWidth-Ns-xt));return n?{left:l,bottom:t.innerHeight-e.top+ht,maxHeight:i}:{left:l,top:e.bottom+ht,maxHeight:i}}function bt({projectId:e,projects:t,onAssign:s}){let r=oe(null),n=oe(null),[i,l]=f(!1),[g,L]=f(null),p=t.find(c=>c.id===e),S=!!p;j(()=>{if(!i)return;let c=r.current;c&&L(Bs(c.getBoundingClientRect(),window))},[i]),j(()=>{if(!i||!g)return;let c=n.current;(c?.querySelector(".is-active")??c?.querySelector("button")??c)?.focus()},[i,g]);let y=()=>{l(!1),r.current?.focus()},I=S?`Associated with ${p.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return o(Z,{children:[o("button",{ref:r,type:"button",className:`prm-project-row ${S?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:I,"aria-label":I,"aria-haspopup":"menu","aria-expanded":i,onClick:c=>{c.stopPropagation(),l(C=>!C)},children:[a(Xa,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:S?p.name:"Not associated with a project"})]}),i&&g&&typeof document<"u"&&Ia(o(Z,{children:[a("div",{className:"prm-project-menu-backdrop",onClick:c=>{c.stopPropagation(),y()}}),o("div",{ref:n,className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...g},role:"menu","aria-label":"Associate a project",tabIndex:-1,onKeyDown:c=>{if(c.key==="Escape"||c.key==="Tab")c.preventDefault(),c.stopPropagation(),y();else if(["ArrowDown","ArrowUp","Home","End"].includes(c.key)){c.preventDefault(),c.stopPropagation();let C=Array.from(c.currentTarget.querySelectorAll("button")),h=C.indexOf(document.activeElement),d=c.key==="Home"?0:c.key==="End"?C.length-1:(h+(c.key==="ArrowDown"?1:-1)+C.length)%C.length;C[d]?.focus()}},children:[t.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),S&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:c=>{c.stopPropagation(),s(null),y()},children:"Clear association"}),t.map(c=>a("button",{type:"button",className:`prm-project-menu-item ${c.id===e?"is-active":""}`,role:"menuitem",onClick:C=>{C.stopPropagation(),s(c.id),y()},children:c.name},c.id))]})]}),document.body)]})}function Lt({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(t=>{let s=pr(t.state);return o("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:t.name}),t.bucket&&a("span",{className:"prm-check-bucket",children:t.bucket}),a("span",{className:"prm-check-state",title:t.state,children:t.state.toLowerCase()})]},`${t.bucket??""}/${t.name}`)})})}function Lr(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}var Fs=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],Es=["seen","favorite","mute","dismiss"];function Ir({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:i,reviewDangerDays:l,sfciGated:g=!1,ignoredFailingChecks:L,workItemLocatorBase:p,selected:S,onToggleSelect:y,onDismiss:I,onProjectAssign:c}){let[C,h]=f(!1),[d,v]=f(!1),A=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),U=e.workItem??La(e.title,e.headRefName,e.body),R=ft(U,p),E=Ea(e.status),X=e.status==="closed-merged"||e.status==="closed-abandoned",N=!!e.muted,z=!!e.favorite,G=!!e.syncError,P=e.checks??[],q=pt(P),_=e.reviewDecision==="APPROVED",K=e.buildHappy??Ha(P,{ignoredFailingChecks:L}),k=Oa({status:e.status,buildHappy:K,reviewApproved:_,sfciGated:g,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??Ve,dangerHours:n??je}),de=Ca(e.lastStatusChange),ce=k==="merge-stall"||k==="danger"?"danger":k==="warn"?"warn":"ok",O=k==="done"?"Build \u2713":k==="merge-stall"?"Merge stalled":Sa(ce,"build"),He=k==="done"?"done":ce,be=!e.isDraft&&!X,B=e.status==="closed-merged",F=gt({reviewApproved:_,merged:B,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:i??Ma,dangerDays:l??Ta}),H=Ca(e.reviewClockStartedAt),Y=F==="danger"?"danger":F==="warn"?"warn":"ok",le=F==="done"?"Review \u2713":Sa(Y,"review"),me=F==="done"?"done":Y,ee=e.reviewers??[],Ye={"changes-requested":ee.filter(u=>u.state==="changes-requested"),"review-requested":ee.filter(u=>u.state==="review-requested"),approved:ee.filter(u=>u.state==="approved")},se=ee.length>0,Qe=()=>{Lr(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ia=e.isDraft?Xe:e.status==="closed-merged"?sa:e.status==="closed-abandoned"?na:he,$e=async()=>{A&&await pe(t,"markPrAsSeen",{url:e.url})},Se=async()=>{await pe(t,A?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},Le=async()=>{await pe(t,"setPrMuted",{url:e.url,muted:!N})},ea=async()=>{await pe(t,"setPrFavorite",{url:e.url,favorite:!z})},ne=async u=>{u.stopPropagation(),v(!0);try{await pe(t,"retryPr",{url:e.url})}finally{v(!1)}},ye=async(u,M)=>{await qa(u)?t.toast(`${M} copied`,"info"):t.toast(`Failed to copy ${M}`,"error")},ae=P.length>0,we=ae?` \u2014 click to ${C?"hide":"show"} checks`:"",te=u=>{u.stopPropagation(),h(M=>!M)},Ae=u=>{(u.key==="Enter"||u.key===" ")&&(u.preventDefault(),te(u))},wa=u=>ae?{role:"button",tabIndex:0,"aria-expanded":C,title:u,"data-tip":u,onClick:te,onKeyDown:Ae}:{},da=ae?" prm-tip prm-checks-trigger":"",fe=`${E.label} \u2014 overall PR status${we}`,We=`${q.pass} passing, ${q.fail} failing, ${q.pending} running`,aa=k==="done"?"Build passing":k==="merge-stall"?"Merge stalled":k==="blocked"?"Build waiting (SFCI job not yet created)":O||"Build running",Te=`${aa} \xB7 ${de} in build phase \xB7 ${We}${we}`,ta=F==="done"?"Review approved":le||"Awaiting review",Ie=`${ta} \xB7 ${H} in review${we}`,va=`${We}${we}`,b={seen:{Icon:A?Ke:la,label:A?"Mark read":"Mark unread",title:A?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:Re,label:z?"Unfavorite":"Favorite",title:z?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:z},mute:{Icon:N?oa:De,label:N?"Unmute":"Mute",title:N?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:ie,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},w=u=>{u==="seen"?Se():u==="favorite"?ea():u==="mute"?Le():I(e.url)};return o("div",{className:`prm-tile ${A?"prm-tile--unread":""} ${X?"prm-tile--closed":""} ${G?"prm-tile--stale":""} ${z?"prm-tile--favorite":""} ${S?"prm-tile--selected":""}`,onClick:$e,role:"button",tabIndex:0,onKeyDown:u=>{(u.key==="Enter"||u.key===" ")&&(u.preventDefault(),$e())},children:[o("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:S,title:S?"Deselect this PR":"Select this PR","aria-label":S?"Deselect this PR":"Select this PR",onClick:u=>u.stopPropagation(),onChange:u=>{u.stopPropagation(),y(e.url)}}),a(ia,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),o("span",{className:"prm-tile-title",children:[U&&o("span",{className:"prm-tile-workitem-inline",children:["@",U,": "]}),e.title.replace(new RegExp(`(?:^|@)${U}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${E.className} prm-tip${da}`,title:fe,"data-tip":fe,...wa(fe),children:E.label}),ae?o("span",{className:`prm-tis prm-tis--${He} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":C,title:Te,"data-tip":Te,"aria-label":`${aa}, ${de} in build phase`,onClick:te,onKeyDown:Ae,children:[de,O&&o("span",{className:"prm-tis-cue",children:[" ",O]})]}):o("span",{className:`prm-tis prm-tis--${He} prm-tip`,title:Te,"data-tip":Te,"aria-label":`${aa}, ${de} in build phase`,children:[de,O&&o("span",{className:"prm-tis-cue",children:[" ",O]})]}),be&&(H||le)&&(ae?o("span",{className:`prm-tis prm-tis--review prm-tis--${me} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":C,title:Ie,"data-tip":Ie,"aria-label":`${ta}, ${H} in review`,onClick:te,onKeyDown:Ae,children:[H,le&&o("span",{className:"prm-tis-cue",children:[" ",le]})]}):o("span",{className:`prm-tis prm-tis--review prm-tis--${me} prm-tip`,title:Ie,"data-tip":Ie,"aria-label":`${ta}, ${H} in review`,children:[H,le&&o("span",{className:"prm-tis-cue",children:[" ",le]})]})),P.length>0&&o("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${q.pass} passed, ${q.fail} failed, ${q.pending} running`,...wa(va),children:[q.pass>0&&o("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(qe,{size:9})," ",q.pass]}),q.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(Ge,{size:9})," ",q.fail]}),q.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(Be,{size:9})," ",q.pending]})]}),N&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(oa,{size:11})}),G&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(ve,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:d,onClick:u=>{ne(u)},children:a(Ce,{size:10,className:d?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:Es.map(u=>{let M=b[u],m=M.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${M.danger?" prm-tile-icon-btn--danger":""}${M.active?" prm-tile-icon-btn--active":""}`,title:M.title,"data-tip":M.label,"aria-label":M.label,"aria-pressed":M.active,onClick:T=>{T.stopPropagation(),w(u)},children:a(m,{size:13,...M.active?{fill:"currentColor"}:{}})},u)})})]}),o("div",{className:"prm-tile-line2",children:[U&&(R?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${U}`,onClick:u=>{u.stopPropagation(),Lr(R)&&t.openExternal(R)},children:U}):a("span",{className:"prm-workitem-chip",children:U})),a("span",{className:"prm-tile-repo",children:e.repo}),o("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:u=>{u.stopPropagation(),Qe()},children:a(Fe,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:u=>{u.stopPropagation(),ye(e.url,"PR link")},children:a(Ue,{size:10})})]}),e.author&&o("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ya(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-tile-line3",children:[a(ze,{size:10,className:"prm-branch-icon","aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:u=>{u.stopPropagation(),ye(e.headRefName,"Branch name")},children:a(Ue,{size:10})})]}),se&&a("div",{className:"prm-reviewers",children:Fs.map(({state:u,label:M,className:m})=>{let T=Ye[u];return T.length===0?null:o("span",{className:`prm-reviewers-group ${m}`,title:M,children:[a("span",{className:"prm-reviewers-label",children:M}),T.map(D=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:D.name||D.login,"aria-label":`${M}: ${D.name||D.login}`,children:ya(D)},D.login))]},u)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(bt,{projectId:e.projectId,projects:s,onAssign:u=>c(e.url,u)}),C&&P.length>0&&a("div",{className:"prm-tile-checks",onClick:u=>u.stopPropagation(),children:a(Lt,{checks:P})})]})}function It(e,t,s=!1){let r=oe(null),n=oe(t);n.current=t;let[i,l]=f({top:0,left:0,maxHeight:400});return Kt(()=>{let g=r.current,L=e.current;if(!g||!L)return;let p=()=>{let y=L.getBoundingClientRect(),I=Math.max(12,Math.min(y.bottom+6,window.innerHeight-160)),c=g.getBoundingClientRect().width,C=Math.max(12,Math.min(s?y.right-c:y.left,window.innerWidth-c-12));l({top:I,left:C,maxHeight:window.innerHeight-I-12})};p(),g.querySelector("button:not(:disabled)")?.focus();let S=y=>{if(!y.defaultPrevented){if(y.key==="Escape")y.preventDefault(),n.current();else if(y.key==="Tab")n.current();else if(["ArrowDown","ArrowUp","Home","End"].includes(y.key)){let I=Array.from(g.querySelectorAll("button:not(:disabled)"));if(!I.length)return;y.preventDefault();let c=I.indexOf(document.activeElement),C=y.key==="Home"?0:y.key==="End"?I.length-1:(c+(y.key==="ArrowDown"?1:-1)+I.length)%I.length;I[C].focus()}}};return window.addEventListener("resize",p),window.addEventListener("keydown",S),()=>{window.removeEventListener("resize",p),window.removeEventListener("keydown",S),L.isConnected&&L.focus({preventScroll:!0})}},[e,s]),{ref:r,position:i}}function Cr({anchorRef:e,hosts:t,selectedHosts:s,onClose:r,onToggleHost:n,onSelectAll:i,shortHost:l}){let{ref:g,position:L}=It(e,r,!1);if(typeof document>"u")return null;let p=s.length===0;return Ia(o(Z,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:S=>{S.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-host-filter",ref:g,style:{position:"fixed",...L},"aria-label":"Host filter",role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),o("button",{type:"button",className:`prm-project-menu-item ${p?"is-active":""}`,role:"menuitemcheckbox","aria-checked":p,onClick:S=>{S.stopPropagation(),i()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:p&&a(qe,{size:12})}),"All hosts"]}),t.map(S=>{let y=s.includes(S);return o("button",{type:"button",className:`prm-project-menu-item ${y?"is-active":""}`,role:"menuitemcheckbox","aria-checked":y,onClick:I=>{I.stopPropagation(),n(S)},title:`Filter to ${S}`,children:[a("span",{className:"prm-sync-filter-check",children:y&&a(qe,{size:12})}),l(S)]},S)})]})]}),document.body)}var Hs='button, a, input, textarea, select, [contenteditable="true"]';function Sr(e){return!e||typeof e.closest!="function"?!1:e.closest(Hs)!==null}function yr(e,t,s){return{left:e.left-(t-e.x),top:e.top-(s-e.y)}}function Nt(){let e=oe(null),[t,s]=f(!1),r=W(l=>{let g=e.current;!g||g.id!==l.pointerId||(e.current=null,s(!1),l.currentTarget.hasPointerCapture(l.pointerId)&&l.currentTarget.releasePointerCapture(l.pointerId))},[]),n=W(l=>{l.button!==0||Sr(l.target)||(e.current={id:l.pointerId,x:l.clientX,y:l.clientY,left:l.currentTarget.scrollLeft,top:l.currentTarget.scrollTop},l.currentTarget.setPointerCapture(l.pointerId),s(!0))},[]),i=W(l=>{let g=e.current;if(!g||g.id!==l.pointerId)return;let L=yr(g,l.clientX,l.clientY);l.currentTarget.scrollLeft=L.left,l.currentTarget.scrollTop=L.top},[]);return{isPanning:t,canvasPanProps:{onPointerDown:n,onPointerMove:i,onPointerUp:r,onPointerCancel:r}}}var Bt=`.zcc-kanban {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 10px;
  overflow: auto;
  cursor: grab;
  overscroll-behavior: contain;
}

.zcc-kanban.is-panning {
  cursor: grabbing;
  user-select: none;
}

.zcc-kanban-col {
  display: flex;
  flex-direction: column;
  min-width: var(--zcc-kanban-col-min, 200px);
  flex: var(--zcc-kanban-col-flex, 1 1 200px);
  width: var(--zcc-kanban-col-width, auto);
  min-height: 0;
  background: var(--bg-panel, var(--zcc-surface, #1e1e1e));
  border: 1px solid var(--border, var(--zcc-border, #2e2e2e));
  border-radius: 10px;
  overflow: hidden;
}

.zcc-kanban-col.is-collapsed {
  flex: 0 0 44px;
  width: 44px;
  min-width: 44px;
  max-width: 44px;
}

.zcc-kanban-col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  position: sticky;
  top: 0;
  z-index: 1;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, var(--zcc-foreground-muted, #8b949e));
  background: transparent;
  border-bottom: 1px solid var(--border, var(--zcc-border, #2e2e2e));
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-header {
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 12px;
  border-bottom: 0;
}

.zcc-kanban-col-icon {
  flex-shrink: 0;
  color: var(--text-dim, var(--zcc-foreground-muted, #8b949e));
}

.zcc-kanban-col-title {
  min-width: 0;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 11px;
}

.zcc-kanban-col-count {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim, var(--zcc-foreground-muted, #8b949e));
  background: var(--bg-elevated, var(--zcc-surface-raised, #242424));
  border-radius: 9px;
  padding: 0 7px;
  line-height: 16px;
  min-width: 16px;
  text-align: center;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-count {
  margin-left: 0;
  writing-mode: horizontal-tb;
}

.zcc-kanban-col-badge {
  min-width: 16px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--accent-blue, var(--zcc-primary, #2f81f7));
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.zcc-kanban-col-collapse {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted, var(--zcc-foreground-muted, #8b949e));
  cursor: pointer;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-collapse {
  margin-left: 0;
  margin-top: auto;
}

.zcc-kanban-col-collapse:hover {
  background: var(--bg-hover, var(--zcc-surface-hover, #2a2a2a));
  color: var(--text-primary, var(--zcc-foreground, #e6edf3));
}

.zcc-kanban-col-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.zcc-kanban-col-body > * {
  flex-shrink: 0;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-body {
  display: none;
}

.zcc-kanban-col-empty {
  min-height: 24px;
}
`;function qs(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function wr({children:e,className:t="",label:s,columnWidth:r}){let{isPanning:n,canvasPanProps:i}=Nt();return a("div",{role:"list","aria-label":s,className:["zcc-kanban",n?"is-panning":"",t].filter(Boolean).join(" "),style:qs(r),...i,children:e})}function vr({children:e,className:t="",columnId:s,label:r,count:n,icon:i,badge:l,collapsed:g=!1,onToggleCollapse:L,onContextMenu:p,onDragOver:S,onDragLeave:y,onDrop:I}){let c=g?`Expand ${r}`:`Collapse ${r}`;return o("section",{role:"listitem",className:["zcc-kanban-col",g?"is-collapsed":"",t].filter(Boolean).join(" "),"aria-label":`${r} (${n})`,"data-kanban-column":s,"data-board-column":s,"data-collapsed":g?"true":"false",onContextMenu:p,onDragOver:S,onDragLeave:y,onDrop:I,children:[o("header",{className:"zcc-kanban-col-header",children:[i?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:i}):null,a("span",{className:"zcc-kanban-col-title",children:r}),a("span",{className:"zcc-kanban-col-count",children:n}),l,L?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:c,"aria-label":c,"aria-expanded":!g,onClick:()=>L(s),children:g?a(ra,{size:13}):a(ha,{size:13})}):null]}),g?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}var Ft=["conflict","failed","yellow","review-required","pending","integrating","green"],Pr=["closed-merged","closed-abandoned"],kr={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function Et(e){return e==="list"||e==="board"}function zs(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function Ct(e){let t=zs();for(let s of e)t[s.status].push(s);return t}function Ar(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var Rr=[...Ft,...Pr];function Mr(e){return typeof e=="string"&&Rr.includes(e)}function Tr(e,t={}){let s=Ar(e);return t.showEmpty?[...Ft,...Pr.filter(r=>s[r]>0)]:Rr.filter(r=>s[r]>0)}function Dr(e){let t=Ar(e);return Ft.filter(s=>t[s]===0).length}function Nr(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Us(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function _s(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Br({pr:e,host:t,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:n,selected:i,selectionActive:l=!1,selectMode:g=!1,onToggleSelect:L,onDismiss:p,onOpen:S}){let[y,I]=f(!1),c=_s(e),C=e.status==="closed-merged"||e.status==="closed-abandoned",h=!!e.favorite,d=!!e.syncError,v=e.workItem??La(e.title,e.headRefName,e.body),A=v?e.title.replace(new RegExp(`(?:^|@)${v}[:\\s]*`,"i"),""):e.title,U=e.checks??[],R=pt(U),E=e.updatedAt||e.lastChecked||e.lastStatusChange,X=e.buildHappy??Ha(U,{ignoredFailingChecks:n}),N=Oa({status:e.status,buildHappy:X,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??Ve,dangerHours:r??je}),z=N==="merge-stall"?"Merge stalled":N==="warn"||N==="danger"?Sa(N,"build"):"",G=N==="merge-stall"||N==="danger"?"danger":N==="warn"?"warn":"",P=i||g||l,q=async()=>{c&&await pe(t,"markPrAsSeen",{url:e.url})},_=async()=>{await pe(t,"setPrFavorite",{url:e.url,favorite:!h})},K=()=>{Us(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},k=async()=>{I(!0);try{await pe(t,"retryPr",{url:e.url})}finally{I(!1)}},de=()=>{S(e.url),q()},ce=O=>{if(O.metaKey||O.ctrlKey||g){L(e.url);return}de()};return o("article",{className:["prm-board-card",c?"prm-board-card--unread":"",C?"prm-board-card--closed":"",h?"prm-board-card--favorite":"",i?"prm-board-card--selected":"",d?"prm-board-card--stale":"",P?"prm-board-card--selectable":"",g?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:ce,onPointerDown:O=>O.stopPropagation(),onKeyDown:O=>{O.target===O.currentTarget&&(O.key==="Enter"||O.key===" ")&&(O.preventDefault(),g||O.metaKey||O.ctrlKey?L(e.url):de())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[o("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:i,title:i?"Deselect this PR":"Select this PR","aria-label":i?"Deselect this PR":"Select this PR",onClick:O=>O.stopPropagation(),onChange:O=>{O.stopPropagation(),L(e.url)}}),o("span",{className:"prm-board-card-id",children:[o("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",title:e.repo,children:Nr(e.repo)})]}),v&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:v}),o("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${h?" prm-tile-icon-btn--active":""}`,title:h?"Unfavorite":"Favorite","data-tip":h?"Unfavorite":"Favorite","aria-label":h?"Unfavorite":"Favorite","aria-pressed":h,onClick:O=>{O.stopPropagation(),_()},children:a(Re,{size:12,...h?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:O=>{O.stopPropagation(),K()},children:a(Fe,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:O=>{O.stopPropagation(),p(e.url)},children:a(ie,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:A}),o("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:ya(e.author)}),z?o("span",{className:`prm-tis prm-tis--${G} prm-board-card-stall`,children:[Ca(e.lastStatusChange)," ",z]}):E>0&&a("span",{className:"prm-board-card-time",children:Me(E)}),R.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${R.fail} checks failing`,children:[a(Ge,{size:9})," ",R.fail]}),R.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${R.pending} checks running`,children:[a(Be,{size:9})," ",R.pending]}),e.isDraft&&o("span",{className:"prm-draft-pill prm-board-card-draft",children:[a(Xe,{size:10,"aria-hidden":!0})," Draft"]}),d&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(ve,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:y,onClick:O=>{O.stopPropagation(),k()},children:a(Ce,{size:10,className:y?"prm-spin":""})})]})]})]})}var Gs={conflict:Qa,failed:Pe,yellow:_e,"review-required":Wa,pending:Ga,integrating:V,green:ge,"closed-merged":sa,"closed-abandoned":na};function Fr({prs:e,host:t,tisWarnHours:s,tisDangerHours:r,repositories:n,selected:i,selectMode:l=!1,showEmpty:g=!1,collapsed:L,onToggleCollapse:p,onToggleSelect:S,onDismiss:y,onOpen:I}){let c=Q(()=>Ct(e),[e]),C=Q(()=>Tr(c,{showEmpty:g}),[c,g]),h=i.size>0||l;return a(wr,{label:"Pull requests by status",className:"prm-board",children:C.map(d=>{let v=c[d],A=Gs[d],U=L.has(d),R=v.filter(E=>E.lastSeenAt===0||E.lastStatusChange>(E.lastSeenAt??E.addedAt)).length;return a(vr,{columnId:d,className:`prm-board-col--${d}`,label:kr[d],count:v.length,icon:a(A,{size:14,"aria-hidden":!0}),badge:R>0?a("span",{className:"zcc-kanban-col-badge",title:`${R} unread`,children:R}):null,collapsed:U,onToggleCollapse:E=>p(E),children:v.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):v.map(E=>{let X=nt(E.repo,n,s??Ve,r??je),N=(n??[]).find(z=>`${z.owner}/${z.repo}`.toLowerCase()===E.repo.toLowerCase());return a(Br,{pr:E,host:t,tisWarnHours:X.warnHours,tisDangerHours:X.dangerHours,ignoredFailingChecks:N?.ignoredFailingChecks,selected:i.has(E.url),selectionActive:h,selectMode:l,onToggleSelect:S,onDismiss:y,onOpen:I},E.url)})},d)})})}var Vs=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function Er(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function js(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function Hr({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:i,reviewDangerDays:l,sfciGated:g=!1,ignoredFailingChecks:L,workItemLocatorBase:p,onClose:S,onDismiss:y,onProjectAssign:I}){let[c,C]=f(!1),[h,d]=f(!1),v=(e.body?.length??0)>600,A=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),U=e.status==="closed-merged"||e.status==="closed-abandoned",R=!!e.muted,E=!!e.favorite,X=!!e.syncError,N=e.workItem??La(e.title,e.headRefName,e.body),z=ft(N,p),G=N?e.title.replace(new RegExp(`(?:^|@)${N}[:\\s]*`,"i"),""):e.title,P=Ea(e.status),q=e.checks??[],_=e.reviewers??[],K={"changes-requested":_.filter(ne=>ne.state==="changes-requested"),"review-requested":_.filter(ne=>ne.state==="review-requested"),approved:_.filter(ne=>ne.state==="approved")},k=js(e),de=e.reviewDecision==="APPROVED",ce=e.buildHappy??Ha(q,{ignoredFailingChecks:L}),O=Oa({status:e.status,buildHappy:ce,reviewApproved:de,sfciGated:g,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??Ve,dangerHours:n??je}),He=Ca(e.lastStatusChange),be=O==="merge-stall"||O==="danger"?"danger":O==="warn"?"warn":"ok",B=O==="done"?"Build \u2713":O==="merge-stall"?"Merge stalled":Sa(be,"build"),F=O==="done"?"done":be,H=!e.isDraft&&!U,Y=gt({reviewApproved:de,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:i??Ma,dangerDays:l??Ta}),le=Ca(e.reviewClockStartedAt),me=Y==="danger"?"danger":Y==="warn"?"warn":"ok",ee=Y==="done"?"Review \u2713":Sa(me,"review"),Ye=Y==="done"?"done":me,se=e.isDraft?Xe:e.status==="closed-merged"?sa:e.status==="closed-abandoned"?na:he,Qe=()=>{Er(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ia=async(ne,ye)=>{await qa(ne)?t.toast(`${ye} copied`,"info"):t.toast(`Failed to copy ${ye}`,"error")},$e=async()=>{await pe(t,A?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},Se=async()=>{await pe(t,"setPrMuted",{url:e.url,muted:!R})},Le=async()=>{await pe(t,"setPrFavorite",{url:e.url,favorite:!E})},ea=async()=>{C(!0);try{await pe(t,"retryPr",{url:e.url})}finally{C(!1)}};return o(ue,{title:o("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]}),icon:a(se,{size:18}),titleId:"prm-detail-title",closeLabel:"Close PR details",backdropTestId:"prm-detail-backdrop",className:"prm-modal--detail",onClose:S,children:[o("div",{className:"prm-modal-body prm-detail-body",children:[o("div",{className:"prm-detail-heading",children:[N&&(z?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${N}`,onClick:()=>{Er(z)&&t.openExternal(z)},children:N}):a("span",{className:"prm-workitem-chip",children:N})),a("h4",{className:"prm-detail-pr-title",children:G})]}),o("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${P.className}`,children:P.label}),e.isDraft&&o("span",{className:"prm-draft-pill",children:[a(Xe,{size:10,"aria-hidden":!0})," Draft"]}),R&&o("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(oa,{size:11,"aria-hidden":!0})," Muted"]}),He&&o("span",{className:`prm-tis prm-tis--${F}`,children:[He,B&&o("span",{className:"prm-tis-cue",children:[" ",B]})]}),H&&(le||ee)&&o("span",{className:`prm-tis prm-tis--review prm-tis--${Ye}`,children:[le,ee&&o("span",{className:"prm-tis-cue",children:[" ",ee]})]})]}),k&&a("div",{className:"prm-detail-hint",children:k}),X&&o("div",{className:"prm-detail-sync-error",role:"alert",children:[a(ve,{size:12,"aria-hidden":!0}),o("span",{children:["Couldn't sync this PR: ",e.syncError]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:c,"aria-label":"Retry syncing this PR",onClick:()=>{ea()},children:[a(Ce,{size:11,className:c?"prm-spin":""})," Retry"]})]}),o("div",{className:"prm-detail-grid",children:[o("div",{className:"prm-detail-main",children:[o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Checks"}),a(Lt,{checks:q})]}),e.body&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Description preview"}),a("div",{className:"prm-detail-desc",id:"prm-description-preview",children:v&&!h?`${e.body.slice(0,600).trimEnd()}\u2026`:e.body}),v&&a("button",{type:"button",className:"prm-text-btn","aria-expanded":h,"aria-controls":"prm-description-preview",onClick:()=>d(ne=>!ne),children:h?"Collapse preview":"Expand preview"}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-detail-description-link",onClick:Qe,children:["Read full description on GitHub ",a(Fe,{size:12,"aria-hidden":!0})]})]})]}),o("aside",{className:"prm-detail-sidebar","aria-label":"Pull request information",children:[o("dl",{className:"prm-detail-facts",children:[e.author&&o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),o("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ya(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:Me(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:Me(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:Me(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Branches"}),o("div",{className:"prm-detail-branch",children:[a(ze,{size:12,"aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>{ia(e.headRefName,"Branch name")},children:a(Ue,{size:10})})]})]}),_.length>0&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:Vs.map(({state:ne,label:ye,className:ae})=>{let we=K[ne];return we.length===0?null:o("span",{className:`prm-reviewers-group ${ae}`,title:ye,children:[a("span",{className:"prm-reviewers-label",children:ye}),we.map(te=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:te.name||te.login,"aria-label":`${ye}: ${te.name||te.login}`,children:ya(te)},te.login))]},ne)})})]}),o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Project"}),a(bt,{projectId:e.projectId,projects:s,onAssign:ne=>I(e.url,ne)})]})]})]})]}),o("footer",{className:"prm-modal-footer prm-detail-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:Qe,title:"Open on GitHub",children:[a(Fe,{size:13}),a("span",{children:"Open on GitHub"})]}),o("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>{ia(e.url,"PR link")},children:[a(Ue,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${E?" prm-tile-icon-btn--active":""}`,title:E?"Unfavorite":"Favorite","data-tip":E?"Unfavorite":"Favorite","aria-label":E?"Unfavorite":"Favorite","aria-pressed":E,onClick:()=>{Le()},children:a(Re,{size:13,...E?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:R?"Unmute":"Mute","data-tip":R?"Unmute":"Mute","aria-label":R?"Unmute":"Mute","aria-pressed":R,onClick:()=>{Se()},children:R?a(oa,{size:13}):a(De,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:A?"Mark this PR as read":"Mark this PR as unread","data-tip":A?"Mark read":"Mark unread","aria-label":A?"Mark read":"Mark unread",onClick:()=>{$e()},children:A?a(Ke,{size:13}):a(la,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>y(e.url),children:a(ie,{size:13})})]})]})}var Or=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],_r=["closed-merged","closed-abandoned"],qr=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function $s(e,t){let s=e.favorite?1:0,r=t.favorite?1:0;return s!==r?r-s:t.lastStatusChange-e.lastStatusChange}function it(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Ws(e,t){return e.length>0&&e.every(r=>{let n=t.find(i=>i.url===r);return n?!!n.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function Xs(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Ks(e){let t=e.workItem??La(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),xe(e.status),e.headRefName??"",e.baseRefName??"",t,e.repo,Xs(e.repo)].join("").toLowerCase()}var zr="boardShowEmpty",Ur="boardCollapsed";function Gr({prs:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:i,reviewDangerDays:l,repositories:g,workItemLocatorBase:L,sortField:p,sortDir:S,onSortChange:y,hostScope:I,onHostScopeChange:c,awaitingFirstSync:C,syncing:h,autoSyncEnabled:d,onDismiss:v,onProjectAssign:A,onBulkSetSeen:U,onBulkDismiss:R,onBulkSetFavorite:E,viewMode:X="list",onViewModeChange:N}){let z=mt(),[G,P]=f("all"),[q,_]=f(""),[K,k]=f(new Set),[de,ce]=f(!1),[O,He]=f(X),[be,B]=f(!1),[F,H]=f(!1),[Y,le]=f(()=>new Set),[me,ee]=f(null),Ye=oe(null),se=z?"list":N?X:O,Qe=m=>{m==="board"&&P("all"),m==="list"&&B(!1),N?N(m):He(m)};j(()=>{let m=!0;return t.storage.get(zr).then(T=>{m&&typeof T=="boolean"&&H(T)}),t.storage.get(Ur).then(T=>{!m||!Array.isArray(T)||le(new Set(T.filter(Mr)))}),()=>{m=!1}},[t]);let ia=m=>{H(m),t.storage.set(zr,m)},$e=m=>{le(T=>{let D=new Set(T);return D.has(m)?D.delete(m):D.add(m),t.storage.set(Ur,[...D]),D})},Se=Q(()=>{let m=[];for(let T of e){let D=Mt(T.url);m.includes(D)||m.push(D)}return m},[e]),Le=Q(()=>{if(I.length===0)return e;let m=new Set(I);return e.filter(T=>m.has(Mt(T.url)))},[e,I]),ea=Q(()=>{let m=new Map;for(let T of Le)m.set(T.status,(m.get(T.status)??0)+1);return m},[Le]),ne=Q(()=>se==="board"||G==="all"?Le:Le.filter(m=>m.status===G),[Le,G,se]),ye=Q(()=>{let m=q.trim().toLowerCase();return m?ne.filter(T=>Ks(T).includes(m)):ne},[ne,q]),ae=Q(()=>{let m=S==="asc"?1:-1,T=[...ye];return p==="favorites"?(T.sort($s),T):(T.sort((D,J)=>{let Oe=0;switch(p){case"created":Oe=(D.createdAt??0)-(J.createdAt??0);break;case"status":Oe=Dt(D.status)-Dt(J.status);break;case"statusUpdated":Oe=D.lastStatusChange-J.lastStatusChange;break;default:Oe=(D.updatedAt||D.lastChecked||D.lastStatusChange)-(J.updatedAt||J.lastChecked||J.lastStatusChange);break}if(Oe===0){let Vt=it(D)?1:0,jt=it(J)?1:0;return Vt!==jt?jt-Vt:(J.createdAt??0)-(D.createdAt??0)}return Oe*m}),T)},[ye,p,S]),we=Q(()=>Dr(Ct(ae)),[ae]),te=me?e.find(m=>m.url===me):void 0;j(()=>{me&&!te&&ee(null)},[me,te]);let Ae=Q(()=>{if(!te)return null;let m=nt(te.repo,g,r??Ve,n??je),T=Pt(te.repo,g,i??Ma,l??Ta),D=(g??[]).find(J=>`${J.owner}/${J.repo}`.toLowerCase()===te.repo.toLowerCase());return{tisWarnHours:m.warnHours,tisDangerHours:m.dangerHours,reviewWarnDays:T.warnDays,reviewDangerDays:T.dangerDays,sfciGated:D?.sfciGated===!0,ignoredFailingChecks:D?.ignoredFailingChecks}},[te,g,r,n,i,l]),wa=Q(()=>Le.filter(it).length,[Le]),da=Q(()=>ae.map(m=>m.url),[ae]),fe=Q(()=>da.filter(m=>K.has(m)),[da,K]),We=ae.length>0&&fe.length===ae.length,aa=fe.length>0&&!We,Te=m=>{k(T=>{let D=new Set(T);return D.has(m)?D.delete(m):D.add(m),D})},ta=()=>{k(We||aa?new Set:new Set(da))},Ie=()=>k(new Set),va=fe.length>0?fe:da,b=va.every(m=>{let T=e.find(D=>D.url===m);return T?!it(T):!0}),w=Ws(fe,e);if(e.length===0){if(C){let m=h||d;return o("div",{className:"prm-empty",children:[m?a(V,{size:32,className:"prm-spin","aria-hidden":!0}):a(he,{size:32,"aria-hidden":!0}),a("h3",{children:m?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:m?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return o("div",{className:"prm-empty",children:[a(he,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let M=o("div",{className:"prm-list-toolbar",children:[o("div",{className:"prm-list-controls",children:[o("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":se==="list",title:"List view",onClick:()=>Qe("list"),children:[a(Ja,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":se==="board",title:"Board view",onClick:()=>Qe("board"),children:[a(ma,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),se==="list"&&a("label",{className:"prm-select-all",title:We?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:We,ref:m=>{m&&(m.indeterminate=aa)},onChange:ta,"aria-label":We?"Clear selection":"Select all shown PRs"})}),se==="list"&&o("span",{className:"prm-shown-count","aria-live":"polite",children:[ae.length," shown"]}),o("div",{className:"prm-search",children:[a(xa,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:q,onChange:m=>_(m.target.value),"aria-label":"Search PRs"})]}),o("button",{type:"button",ref:Ye,className:`prm-btn prm-btn--sm ${I.length>0?"is-active":""}`,onClick:()=>ce(m=>!m),title:"Filter by host","aria-expanded":de,children:[a(Za,{size:12}),o("span",{children:["Host",I.length>0&&o("span",{className:"prm-unread-count",children:[" (",I.length,")"]})]}),a(Pa,{size:12})]}),de&&a(Cr,{anchorRef:Ye,hosts:Se,selectedHosts:I,onClose:()=>ce(!1),onToggleHost:m=>c(I.includes(m)?I.filter(T=>T!==m):[...I,m]),onSelectAll:()=>c([]),shortHost:fr}),se==="board"&&o(Z,{children:[o("button",{type:"button",className:`prm-btn prm-btn--sm ${be?"is-active":""}`,"aria-pressed":be,title:"Select cards for bulk actions",onClick:()=>B(m=>!m),children:[a(ba,{size:12}),a("span",{children:"Select"})]}),we>0&&o("button",{type:"button",className:`prm-btn prm-btn--sm ${F?"is-active":""}`,"aria-pressed":F,title:F?"Hide empty columns":`Show ${we} empty column${we===1?"":"s"}`,onClick:()=>ia(!F),children:[a($a,{size:12}),a("span",{children:F?"Hide empty":`Empty (${we})`})]})]}),se==="list"&&o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>U(va,!b),title:fe.length>0?`Mark the ${fe.length} selected PR(s) ${b?"unread":"read"}`:`Mark all shown PRs ${b?"unread":"read"}`,children:[a(Ke,{size:12}),o("span",{children:[b?"Mark unread":"Mark read",wa>0&&o("span",{className:"prm-unread-count",children:[" (",wa,")"]})]})]}),se==="list"&&o("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:p,onChange:m=>y(m.target.value,S),"aria-label":"Sort field",children:qr.map(m=>a("option",{value:m.id,title:m.title,children:m.label},m.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>y(p,S==="asc"?"desc":"asc"),disabled:p==="favorites",title:p==="favorites"?"Favorites first uses a fixed order":S==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":S==="asc"?"Sorted ascending":"Sorted descending",children:S==="asc"?a(_a,{size:12}):a(Ua,{size:12})})]})]}),se==="list"&&o("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[o("button",{type:"button",role:"tab","aria-selected":G==="all",className:`prm-segment-tab ${G==="all"?"active":""}`,onClick:()=>P("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:Le.length})]}),Or.map(m=>{let T=ea.get(m)??0;return o("button",{type:"button",role:"tab","aria-selected":G===m,className:`prm-segment-tab prm-segment-tab--${m} ${G===m?"active":""}`,onClick:()=>P(m),title:`Show PRs in "${xe(m)}"`,children:[xe(m)," ",a("span",{className:"prm-segment-count",children:T})]},m)})]}),fe.length>0&&o("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:Ie,title:"Clear selection","aria-label":"Clear selection",children:a(Ge,{size:12})}),o("span",{className:"prm-bulk-count",children:[fe.length," selected"]}),o("div",{className:"prm-bulk-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>U(fe,!b),title:`Mark the selected PR(s) ${b?"unread":"read"}`,children:[b?a(la,{size:12}):a(Ke,{size:12}),a("span",{children:b?"Mark unread":"Mark read"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>E(fe,w.favorite),title:`${w.label} the selected PR(s)`,children:[a(Re,{size:12,...w.favorite?{}:{fill:"currentColor"}}),a("span",{children:w.label})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{R(fe),Ie()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(ie,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return o("div",{className:`prm-list${se==="board"?" prm-list--board":""}`,children:[z?a(gr,{query:q,onQuery:_,status:G,onStatus:P,statuses:Or.map(m=>({id:m,count:ea.get(m)??0})),hosts:Se,hostScope:I,onHostScope:c,sortField:p,sortDir:S,onSort:y,sortFields:qr,shownCount:ae.length}):M,ae.length===0?o("div",{className:"prm-empty prm-empty--filtered",children:[a(xa,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:q.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),o("div",{className:"prm-empty-actions",children:[q.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>_(""),title:"Clear search",children:"Clear search"}),G!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>P("all"),title:"Show all PRs",children:"Show all"})]})]}):z?a(hr,{prs:ae,onOpen:m=>{ee(m.url),it(m)&&pe(t,"markPrAsSeen",{url:m.url})}}):se==="board"?a(Fr,{prs:ae,host:t,tisWarnHours:r,tisDangerHours:n,repositories:g,selected:K,selectMode:be,showEmpty:F,collapsed:Y,onToggleCollapse:$e,onToggleSelect:Te,onDismiss:v,onOpen:ee}):a("div",{className:"prm-tile-list",children:ae.map(m=>{let T=nt(m.repo,g,r??Ve,n??je),D=Pt(m.repo,g,i??Ma,l??Ta),J=(g??[]).find(Oe=>`${Oe.owner}/${Oe.repo}`.toLowerCase()===m.repo.toLowerCase());return a(Ir,{pr:m,host:t,projects:s,tisWarnHours:T.warnHours,tisDangerHours:T.dangerHours,reviewWarnDays:D.warnDays,reviewDangerDays:D.dangerDays,sfciGated:J?.sfciGated===!0,ignoredFailingChecks:J?.ignoredFailingChecks,workItemLocatorBase:L,selected:K.has(m.url),onToggleSelect:Te,onDismiss:v,onProjectAssign:A},m.url)})}),te&&Ae&&a(Hr,{pr:te,host:t,projects:s,tisWarnHours:Ae.tisWarnHours,tisDangerHours:Ae.tisDangerHours,reviewWarnDays:Ae.reviewWarnDays,reviewDangerDays:Ae.reviewDangerDays,sfciGated:Ae.sfciGated,ignoredFailingChecks:Ae.ignoredFailingChecks,workItemLocatorBase:L,onClose:()=>ee(null),onDismiss:m=>{ee(null),v(m)},onProjectAssign:A})]})}function Vr({host:e,onClose:t,onPulled:s}){let[r,n]=f([]),[i,l]=f(!1),[g,L]=f(""),[p,S]=f(""),[y,I]=f(!1),[c,C]=f(null);j(()=>{let v=!0;return e.call("listRepos").then(A=>{if(!v)return;let U=(A?.repos??[]).filter(R=>R.active&&R.connection==="connected");n(U),U.length>0&&L(`${U[0].host}|${U[0].owner}/${U[0].repo}`),l(!0)}).catch(()=>{v&&l(!0)}),()=>{v=!1}},[e]);let h=Q(()=>r.find(v=>`${v.host}|${v.owner}/${v.repo}`===g),[r,g]),d=async()=>{if(y)return;C(null);let v=Number(p.trim());if(!h){C("Select a repository.");return}if(!Number.isSafeInteger(v)||v<=0){C("Enter a valid PR number.");return}I(!0);try{let A=await e.call("pullPr",{host:h.host,fullName:`${h.owner}/${h.repo}`,number:v});A?.ok&&Array.isArray(A.prs)?s(A.prs):C(A?.error||"Failed to pull PR.")}catch(A){C(A instanceof Error?A.message:String(A))}finally{I(!1)}};return o(ue,{title:"Add PR",titleId:"prm-pull-title",icon:a(he,{size:16}),onClose:t,busy:y,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),i&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):o("select",{className:"prm-input prm-input--select",value:g,onChange:v=>L(v.target.value),disabled:y||!i,"aria-label":"Repository",children:[!i&&a("option",{children:"Loading\u2026"}),r.map(v=>{let A=`${v.host}|${v.owner}/${v.repo}`;return o("option",{value:A,children:[v.owner,"/",v.repo," (",v.shortHost,")"]},A)})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{type:"number",min:1,step:1,"aria-invalid":!!c,"aria-describedby":c?"prm-pull-error":void 0,value:p,placeholder:"e.g. 42",className:"prm-input",onChange:v=>{S(v.target.value),c&&C(null)},onKeyDown:v=>{v.key==="Enter"&&!y&&(v.preventDefault(),d())},disabled:y||r.length===0})]}),c&&a("div",{className:"prm-modal-error",id:"prm-pull-error",role:"alert",children:c})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:y,title:"Cancel without adding",children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{d()},disabled:y||r.length===0||!p.trim(),title:"Add this PR to the monitored list",children:[y?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]})]})]})}function jr({anchorRef:e,host:t,selectedRepos:s,onClose:r,onToggleRepo:n,onSelectAll:i,onSync:l}){let{ref:g,position:L}=It(e,r,!0),[p,S]=f([]);if(j(()=>{let I=!0;return t.call("listRepos").then(c=>{I&&S((c?.repos??[]).filter(C=>C.active&&C.connection==="connected"))}).catch(()=>{}),()=>{I=!1}},[t]),typeof document>"u")return null;let y=s.length===0;return Ia(o(Z,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:I=>{I.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-sync-filter",ref:g,style:{position:"fixed",...L},"aria-label":"Sync & Filter",role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),o("button",{type:"button",className:`prm-project-menu-item ${y?"is-active":""}`,role:"menuitemcheckbox","aria-checked":y,onClick:I=>{I.stopPropagation(),i()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:y&&a(qe,{size:12})}),"All repositories"]}),p.map(I=>{let c=`${I.owner}/${I.repo}`,C=s.includes(c);return o("button",{type:"button",className:`prm-project-menu-item ${C?"is-active":""}`,role:"menuitemcheckbox","aria-checked":C,onClick:h=>{h.stopPropagation(),n(c)},title:`Filter/sync ${c}`,children:[a("span",{className:"prm-sync-filter-check",children:C&&a(qe,{size:12})}),c," ",o("span",{className:"prm-sync-filter-host",children:["(",I.shortHost,")"]})]},`${I.host}|${c}`)}),a("div",{className:"prm-tile-menu-divider"}),o("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{l(s),r()},title:y?"Sync all repositories now":"Sync the selected repositories now",children:y?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Je({title:e,subtitle:t,actions:s}){return o("header",{className:"prm-area-header",children:[o("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:t})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function St({state:e}){return e==="checking"?o("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(V,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(ge,{size:11})," Connected"]}):o("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(Pe,{size:11})," Disconnected"]})}function yt({title:e,message:t,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:n,busy:i,onConfirm:l,onCancel:g}){return o(ue,{title:e,onClose:g,busy:i,children:[a("div",{className:"prm-modal-body",children:t}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:g,disabled:i,children:r}),o("button",{type:"button",className:`prm-btn ${n?"prm-btn--danger":"prm-btn--primary"}`,onClick:l,disabled:i,children:[i?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function $r({host:e}){let[t,s]=f(()=>{let d=e.cache.get(lt);return d?.ok&&Array.isArray(d.orgs)?d.orgs:null}),[r,n]=f(null),[i,l]=f(!1),[g,L]=f(null),[p,S]=f(!1),[y,I]=f(!1),c=W(async()=>{try{let d=await e.call("listOrgs");d?.ok&&Array.isArray(d.orgs)?(s(d.orgs),n(null)):(s([]),d?.error&&n(d.error))}catch(d){s([]),n(d instanceof Error?d.message:String(d))}},[e]);j(()=>{c()},[c]);let C=async()=>{l(!0),n(null);try{let d=await e.call("rediscoverOrgs");!d?.ok&&d?.error&&n(d.error),await c()}catch(d){n(d instanceof Error?d.message:String(d))}finally{l(!1)}},h=async()=>{if(g){S(!0);try{let d=await e.call("deleteOrg",{host:g.host,login:g.login});!d?.ok&&d?.error&&e.toast(d.error,"error"),await c()}catch(d){e.toast(d instanceof Error?d.message:String(d),"error")}finally{S(!1),L(null)}}};return o("div",{className:"prm-area",children:[a(Je,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:o(Z,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>{C()},disabled:i,title:"Re-discover organizations from your gh accounts",children:[i?a(V,{size:13,className:"prm-spin"}):a(Ee,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>I(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(Ne,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),t===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):t.length===0?o("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:t.map(d=>o("div",{className:"prm-entity-card",children:[o("div",{className:"prm-entity-main",children:[o("div",{className:"prm-entity-title",children:[d.login," ",o("span",{className:"prm-entity-host",children:["(",d.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:d.apiBaseUrl}),o("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:d.login})]})]}),o("div",{className:"prm-entity-side",children:[a(St,{state:i?"checking":d.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>L(d),title:"Delete organization",children:a(ie,{size:15})})]})]},`${d.host}|${d.login}`))}),y&&o(ue,{title:"Adding & removing organizations",icon:a(Ne,{size:16}),onClose:()=>I(!1),children:[o("div",{className:"prm-modal-body prm-help-body",children:[o("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),o("ul",{children:[o("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),o("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),o("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),o("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>I(!1),children:a("span",{children:"Got it"})})})]}),g&&a(yt,{title:"Delete organization?",danger:!0,busy:p,message:o(Z,{children:["Delete ",a("strong",{children:g.login})," (",g.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>{h()},onCancel:()=>L(null)})]})}function Zs(e,t){try{let s=new URL(t);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(t)}catch{}}function Wr(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function Js(e,t){await qa(t)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Xr({host:e,onRepositoriesChanged:t}){let[s,r]=f(()=>{let P=e.cache.get(At);return P?.ok&&Array.isArray(P.repos)?P.repos:null}),[n,i]=f(()=>{let P=e.cache.get(lt);return P?.ok&&Array.isArray(P.orgs)?P.orgs:[]}),[l,g]=f(null),[L,p]=f(!1),[S,y]=f(!1),[I,c]=f(!1),[C,h]=f(null),[d,v]=f("general"),[A,U]=f(null),[R,E]=f(null),[X,N]=f(!1),z=W(async()=>{try{let[P,q]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);P?.ok&&Array.isArray(P.repos)?(r(P.repos),g(null)):(r([]),P?.error&&g(P.error)),i(q?.ok&&Array.isArray(q.orgs)?q.orgs:[])}catch(P){r([]),g(P instanceof Error?P.message:String(P))}},[e]);j(()=>{z()},[z]);let G=async()=>{if(R){N(!0);try{await e.call("deleteRepository",{host:R.host,owner:R.owner,repo:R.repo}),await z()}catch(P){e.toast(P instanceof Error?P.message:String(P),"error")}finally{N(!1),E(null)}}};return o("div",{className:"prm-area",children:[a(Je,{title:"Repositories",subtitle:"Manage your connected repositories",actions:o(Z,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>y(!0),children:[a(Ee,{size:13})," ",a("span",{children:"Suggested for you"})]}),o("button",{type:"button",className:"prm-btn",onClick:()=>c(!0),children:[a(Ba,{size:13})," ",a("span",{children:"Browse Repositories"})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>p(!0),children:[a(Fa,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),l&&a("div",{className:"prm-error",children:l}),s===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?o("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(P=>o("div",{className:"prm-entity-card prm-repo-card",children:[o("div",{className:"prm-repo-top",children:[o("div",{className:"prm-entity-title",children:[a(ze,{size:14,"aria-hidden":!0})," ",o("span",{children:[P.owner,"/",P.repo]}),a("span",{className:`prm-active-badge${P.active?"":" prm-active-badge--off"}`,children:P.active?"Active":"Inactive"}),a(St,{state:P.connection}),(()=>{let q=st[P.buildTisPreset??P.tisPreset??ut],_=rt[P.reviewTisPreset??ct];return o(Z,{children:[o("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${q.warnHours}h, behind schedule after ${q.dangerHours}h`,children:[a(Be,{size:11,"aria-hidden":!0}),"Build: ",q.label]}),o("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${_.warnDays}d, behind schedule after ${_.dangerDays}d`,children:[a(Be,{size:11,"aria-hidden":!0}),"Review: ",_.label]})]})})()]}),o("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>Zs(e,Wr(P)),children:a(Fe,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>{Js(e,Wr(P))},children:a(Ue,{size:14})})]})]}),o("div",{className:"prm-entity-sub prm-repo-meta",children:[o("span",{children:["Organization: ",P.orgLogin," (",P.shortHost,")"]}),o("span",{children:["Created ",Me(P.createdAt)]})]}),o("div",{className:"prm-repo-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>U(P),children:[a(ka,{size:12})," ",a("span",{children:"Test Connection"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{v("general"),h(P)},children:[a(Ze,{size:12})," ",a("span",{children:"Edit Repository"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{v("status"),h(P)},title:"Status Settings",children:[a(Be,{size:12})," ",a("span",{children:"Status Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{v("notifications"),h(P)},title:"Notification Settings",children:[a(De,{size:12})," ",a("span",{children:"Notification Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>E(P),children:[a(ie,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${P.host}|${P.owner}/${P.repo}`))}),L&&a(Ys,{host:e,orgs:n,onClose:()=>p(!1),onAdded:async()=>{p(!1),await z()}}),S&&a(Qs,{host:e,onClose:()=>y(!1),onAdded:async()=>{await z()}}),I&&a(en,{host:e,onClose:()=>c(!1),onAdded:async()=>{await z()}}),C&&a(an,{host:e,repo:C,orgs:n,initialTab:d,onClose:()=>h(null),onSaved:async P=>{h(null),Array.isArray(P)&&(e.cache.set(re,P),e.cache.set(ke,P.length),e.cache.refreshBadge()),t?.(),await z()}}),A&&a(tn,{host:e,repo:A,onClose:()=>U(null),onResult:P=>{let q=P?"connected":"disconnected";r(_=>(_??[]).map(K=>K.host===A.host&&K.owner===A.owner&&K.repo===A.repo?{...K,connection:q}:K))}}),R&&a(yt,{title:"Delete repository?",danger:!0,busy:X,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>{G()},onCancel:()=>E(null)})]})}function Ys({host:e,orgs:t,onClose:s,onAdded:r}){let[n,i]=f(""),[l,g]=f(t[0]?`${t[0].host}|${t[0].login}`:""),[L,p]=f(null),[S,y]=f(!1),I=async()=>{let c=t.find(C=>`${C.host}|${C.login}`===l);if(!c){p("Please select an organization.");return}y(!0),p(null);try{let C=await e.call("addRepository",{ref:n.trim(),host:c.host,orgLogin:c.login});C?.ok?r():p(C?.error||"Failed to add repository.")}catch(C){p(C instanceof Error?C.message:String(C))}finally{y(!1)}};return o(ue,{title:"Add repository",icon:a(Fa,{size:14}),onClose:s,busy:S,children:[o("div",{className:"prm-modal-body",children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:n,spellCheck:!1,onChange:c=>{i(c.target.value),L&&p(null)},onKeyDown:c=>{c.key==="Enter"&&!S&&(c.preventDefault(),I())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),o("select",{className:"prm-input prm-input--select",value:l,onChange:c=>g(c.target.value),children:[t.length===0&&a("option",{value:"",children:"No organizations"}),t.map(c=>o("option",{value:`${c.host}|${c.login}`,children:[c.login," (",c.shortHost,")"]},`${c.host}|${c.login}`))]})]}),L&&a("div",{className:"prm-modal-error",role:"alert",children:L})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:S,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{I()},disabled:S||!n.trim(),children:[S?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function Qs({host:e,onClose:t,onAdded:s}){let[r,n]=f(null),[i,l]=f(new Set),[g,L]=f(null),[p,S]=f(!1),y=W(async()=>{n(null),L(null);try{let h=await e.call("suggestRepositories");h?.ok&&Array.isArray(h.repos)?(n(h.repos),l(new Set(h.repos.filter(d=>d.alreadyAdded).map(d=>d.fullName)))):(n([]),h?.error&&L(h.error))}catch(h){n([]),L(h instanceof Error?h.message:String(h))}},[e]);j(()=>{y()},[y]);let I=h=>{h.alreadyAdded||l(d=>{let v=new Set(d);return v.has(h.fullName)?v.delete(h.fullName):v.add(h.fullName),v})},c=async()=>{if(!r)return;let h=r.filter(d=>!d.alreadyAdded&&i.has(d.fullName));if(h.length!==0){S(!0);try{await e.call("addRepositories",{repos:h.map(d=>({owner:d.owner,repo:d.repo,host:d.host,orgLogin:d.orgLogin}))}),await s(),t()}catch(d){e.toast(d instanceof Error?d.message:String(d),"error")}finally{S(!1)}}},C=r?r.filter(h=>!h.alreadyAdded&&i.has(h.fullName)).length:0;return o(ue,{title:"Suggested for you",icon:a(Ee,{size:14}),onClose:t,busy:p,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):g?a("div",{className:"prm-modal-error",role:"alert",children:g}):r.length===0?o("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(h=>o("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:i.has(h.fullName),disabled:h.alreadyAdded,onChange:()=>I(h)}),o("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:h.fullName}),o("span",{className:"prm-entity-sub",children:[h.prCount," PRs \xB7 ",Me(h.lastActivity)]})]}),h.alreadyAdded&&o("span",{className:"prm-suggested-added",children:[a(ge,{size:13})," Already added"]})]},h.fullName))})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn",onClick:()=>{y()},disabled:p||r===null,children:[a(Ee,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:p,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{c()},disabled:p||C===0,children:[p?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:p?"Adding\u2026":C>0?`Add ${C} Selected`:"Add Selected"})]})]})]})}function en({host:e,onClose:t,onAdded:s}){let[r,n]=f(""),[i,l]=f(null),[g,L]=f(!0),[p,S]=f(!1),[y,I]=f(!1),[c,C]=f(1),[h,d]=f(null),[v,A]=f(new Set),[U,R]=f(new Set),[E,X]=f(new Set),[N,z]=f(!1),G=W(async(B,F)=>{F?S(!0):L(!0),d(null);try{let H=await e.call("listAllRepositories",{page:B}),Y=H?.ok&&Array.isArray(H.repos)?H.repos:[];I(!!H?.hasMore),X(new Set(Array.isArray(H?.incompleteOwners)?H.incompleteOwners:[])),l(le=>{if(!F||!le)return Y;let me=new Set(le.map(ee=>`${ee.host}|${ee.fullName}`));return[...le,...Y.filter(ee=>!me.has(`${ee.host}|${ee.fullName}`))]}),H&&H.ok===!1&&H.error&&d(H.error)}catch(H){d(H instanceof Error?H.message:String(H)),F||l([])}finally{L(!1),S(!1)}},[e]);j(()=>{G(1,!1)},[G]);let P=()=>{let B=c+1;C(B),G(B,!0)},q=i??[],_=r.trim().toLowerCase(),K=_?q.filter(B=>B.fullName.toLowerCase().includes(_)):q,k=B=>{A(F=>{let H=new Set(F);return H.has(B)?H.delete(B):H.add(B),H})},de=B=>{R(F=>{let H=new Set(F);return H.has(B)?H.delete(B):H.add(B),H})},ce=B=>`${B.host}|${B.fullName}`,O=(()=>{let B=new Map;for(let F of K){let H=B.get(F.owner)??[];H.push(F),B.set(F.owner,H)}return Array.from(B.entries())})(),He=async()=>{let B=K.filter(F=>!F.alreadyAdded&&v.has(ce(F)));if(B.length!==0){z(!0);try{await e.call("addRepositories",{repos:B.map(F=>({owner:F.owner,repo:F.repo,host:F.host,orgLogin:F.owner}))}),await s(),t()}catch(F){e.toast(F instanceof Error?F.message:String(F),"error")}finally{z(!1)}}},be=K.filter(B=>!B.alreadyAdded&&v.has(ce(B))).length;return o(ue,{title:"Browse Repositories",icon:a(Ba,{size:14}),onClose:t,busy:N,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:B=>n(B.target.value)})}),h&&a("div",{className:"prm-modal-error",role:"alert",children:h}),g?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):o("div",{className:"prm-browse-list",children:[O.map(([B,F])=>{let H=!U.has(B);return o("div",{className:"prm-browse-group",children:[o("button",{type:"button",className:"prm-browse-group-header",onClick:()=>de(B),"aria-expanded":H,children:[a(ra,{size:13,className:`prm-disclosure${H?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:B}),o("span",{className:"prm-browse-group-count",title:!_&&E.has(B)?`${F.length} loaded \u2014 more available, use Load more`:void 0,children:["(",F.length,!_&&E.has(B)?"\u2026":"",")"]})]}),H&&F.map(Y=>Y.alreadyAdded?o("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[o("span",{children:[a(ze,{size:13,"aria-hidden":!0})," ",Y.fullName,Y.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(ge,{size:11,"aria-hidden":!0})," Connected"]})]},ce(Y)):o("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:v.has(ce(Y)),onChange:()=>k(ce(Y))}),o("span",{children:[a(ze,{size:13,"aria-hidden":!0})," ",Y.fullName,Y.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},ce(Y)))]},B)}),K.length===0&&a("div",{className:"prm-area-empty",children:_?"No repositories match your filter.":"No repositories found."}),y&&!_&&o("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:P,disabled:p,children:[p?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:p?"Loading\u2026":"Load more"})]})]})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:N,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{He()},disabled:N||be===0,children:[N?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:be>0?`Add ${be} Selected`:"Add Selected"})]})]})]})}function an({host:e,repo:t,orgs:s,initialTab:r="general",onClose:n,onSaved:i}){let[l,g]=f(r),[L,p]=f(`${t.owner}/${t.repo}`),[S,y]=f(t.orgLogin),[I,c]=f(t.active),[C,h]=f(t.buildTisPreset??t.tisPreset??ut),[d,v]=f(t.reviewTisPreset??ct),[A,U]=f(t.sfciGated===!0),[R,E]=f((t.ignoredFailingChecks??[]).some(k=>k.toLowerCase().includes("snyk"))),[X,N]=f(t.notifyInApp??!0),[z,G]=f(null),[P,q]=f(!1),_=s.filter(k=>k.host===t.host),K=async()=>{q(!0),G(null);try{let k=await e.call("updateRepository",{key:{host:t.host,owner:t.owner,repo:t.repo},ref:L.trim(),orgLogin:S,active:I,buildTisPreset:C,reviewTisPreset:d,sfciGated:A,ignoredFailingChecks:R?["Snyk"]:[],notifyInApp:X});k?.ok?i(k.prs):G(k?.error||"Failed to save settings.")}catch(k){G(k instanceof Error?k.message:String(k))}finally{q(!1)}};return o(ue,{title:o("span",{className:"prm-dialog-title",children:["Repository Settings ",o("span",{className:"prm-entity-sub",children:[t.owner,"/",t.repo]})]}),icon:a(Ze,{size:14}),onClose:n,busy:P,children:[o("nav",{className:"prm-dialog-tabs","aria-label":"Repository settings sections",children:[o("button",{type:"button",className:`prm-dialog-tab${l==="general"?" active":""}`,"aria-current":l==="general"?"page":void 0,onClick:()=>g("general"),children:[a(Ze,{size:12})," General"]}),o("button",{type:"button",className:`prm-dialog-tab${l==="status"?" active":""}`,"aria-current":l==="status"?"page":void 0,onClick:()=>g("status"),children:[a(Be,{size:12})," Status"]}),o("button",{type:"button",className:`prm-dialog-tab${l==="notifications"?" active":""}`,"aria-current":l==="notifications"?"page":void 0,onClick:()=>g("notifications"),children:[a(De,{size:12})," Notifications"]})]}),o("div",{className:"prm-modal-body",children:[l==="general"?o(Z,{children:[o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:I,onChange:k=>c(k.target.checked)}),o("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:L,spellCheck:!1,onChange:k=>p(k.target.value)})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:S,onChange:k=>y(k.target.value),children:_.map(k=>o("option",{value:k.login,children:[k.login," (",k.shortHost,")"]},k.login))})]})]}):l==="status"?o(Z,{children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:C,onChange:k=>h(k.target.value),children:Object.values(st).map(k=>o("option",{value:k.id,children:[k.label," (",k.warnHours,"h / ",k.dangerHours,"h)"]},k.id))})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:d,onChange:k=>v(k.target.value),children:Object.values(rt).map(k=>o("option",{value:k.id,children:[k.label," (",k.warnDays,"d / ",k.dangerDays,"d)"]},k.id))})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:A,onChange:k=>U(k.target.checked)}),o("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:R,onChange:k=>E(k.target.checked)}),o("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:X,onChange:k=>N(k.target.checked)}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),z&&a("div",{className:"prm-modal-error",role:"alert",children:z})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:n,disabled:P,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{K()},disabled:P,children:[P?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function tn({host:e,repo:t,onClose:s,onResult:r}){let[n,i]=f(null);return j(()=>{let l=!0;return(async()=>{try{let L=await e.call("testRepository",{host:t.host,owner:t.owner,repo:t.repo})??{ok:!1,error:"No response"};l&&(i(L),r?.(L.ok))}catch(g){l&&(i({ok:!1,error:g instanceof Error?g.message:String(g)}),r?.(!1))}})(),()=>{l=!1}},[e,t]),o(ue,{title:`Connection Test Results: ${t.owner}/${t.repo}`,icon:a(ka,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:n===null?o("div",{className:"prm-loading",children:[a(ka,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):n.ok?o("div",{className:"prm-test-result prm-test-result--ok",children:[a(ge,{size:16})," All connection tests passed."]}):o("div",{className:"prm-test-result prm-test-result--fail",children:[a(Pe,{size:16}),o("div",{children:[a("div",{children:n.error||"Connection failed."}),o("div",{className:"prm-field-hint",children:["Try ",o("code",{children:["gh auth login ",t.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function on(e){let t=e.trim().split(/\s+/).filter(Boolean);return t.length===0?"?":t.length===1?t[0].slice(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}function Kr({host:e}){let[t,s]=f(()=>{let p=e.cache.get(Rt);return p?.ok?p.author??null:void 0}),[r,n]=f(null),[i,l]=f(!1),g=W(async()=>{try{let p=await e.call("getAuthor");p?.ok?(s(p.author??null),n(null)):(s(null),p?.error&&n(p.error))}catch(p){s(null),n(p instanceof Error?p.message:String(p))}},[e]);j(()=>{g()},[g]);let L=t?.name||t?.login||"";return o("div",{className:"prm-area",children:[a(Je,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),t===void 0?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading author\u2026"]}):t===null?o("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:o("div",{className:"prm-entity-card prm-author-card",children:[o("button",{type:"button",className:"prm-author-row",onClick:()=>l(p=>!p),"aria-expanded":i,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:on(L)}),o("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:L}),t.email&&a("span",{className:"prm-entity-sub",children:t.email})]}),a(ra,{size:16,className:`prm-disclosure${i?" is-open":""}`,"aria-hidden":!0})]}),i&&o("div",{className:"prm-author-detail",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:L||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:t.email||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:t.identities.map(p=>o("div",{className:"prm-identity-row",children:[o("span",{children:[p.login," ",o("span",{className:"prm-entity-host",children:["(",p.shortHost,")"]})]}),p.connection==="connected"?a(ge,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):o("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(Pe,{size:13})," Disconnected"]})]},`${p.host}|${p.login}`))})]})]})]})})]})}function Zr({settings:e,update:t}){let s=e.notifyInApp??e.notifyOnChange;return o("div",{className:"prm-area",children:[a(Je,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>t({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>t({sendToInbox:r.target.checked})}),o("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>t({badgeMode:"unread"})}),o("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>t({badgeMode:"total"})}),o("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var Jr=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],rn=15;function Yr(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function sn(e,t){let s=Math.max(0,e-t),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let n=Math.floor(r/60),i=r%60;return i?`in ${n}h ${i}m`:`in ${n}h`}function Qr({settings:e,update:t,host:s}){let[r,n]=f(()=>s.cache.get(re)??[]),[i,l]=f(!1),[g,L]=f(()=>Date.now());j(()=>{let h=window.setInterval(()=>{let d=s.cache.get(re);d&&n(v=>v===d?v:d),L(Date.now())},1e3);return()=>window.clearInterval(h)},[s]);let p=e.autoSyncEnabled??!0,S=Jr.some(h=>h.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:rn,y=r.reduce((h,d)=>Math.max(h,d.lastChecked||0),0),I=p&&y?y+S*6e4:0,c=new Set(r.map(h=>h.repo)).size,C=async()=>{l(!0);try{let h=await s.call("pollAll");h?.ok&&Array.isArray(h.prs)&&(n(h.prs),s.cache.set(re,h.prs))}catch(h){s.toast(h instanceof Error?h.message:String(h),"error")}finally{l(!1)}};return o("div",{className:"prm-area",children:[a(Je,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:p,onChange:h=>t({autoSyncEnabled:h.target.checked})}),o("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),o("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:S,onChange:h=>{let d=Number(h.target.value);Number.isFinite(d)&&t({pollIntervalMinutes:d})},children:Jr.map(h=>a("option",{value:h.value,children:h.label},h.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),o("div",{className:"prm-sync-status",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:I?o(Z,{children:[sn(I,g)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Yr(I)]})]}):"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:y?o(Z,{children:[Me(y)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Yr(y)]})]}):""})]}),o("div",{className:"prm-sync-counts",children:[o("span",{className:"prm-sync-count",children:[a("strong",{children:c})," repositories checked"]}),o("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>{C()},disabled:i,children:[i?a(V,{size:13,className:"prm-spin"}):a(Ce,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var nn=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:pa},{id:"repositories",label:"Repositories",icon:fa},{id:"author",label:"Author",icon:at}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:De}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:ot}]}];function es({settings:e,onSave:t,onRepositoriesChanged:s,host:r}){let[n,i]=f(e.settingsActiveNav??kt),l=L=>{let p={...e,...L};t(p),r.cache.set("settings",p),r.cache.refreshBadge()},g=L=>{i(L),l({settingsActiveNav:L})};return a("div",{className:"prm-settings-shell",children:o("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:nn.map(L=>o("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:L.label}),L.items.map(p=>{let S=p.icon;return o("button",{type:"button",className:`prm-nav-row${n===p.id?" active":""}`,"aria-current":n===p.id,onClick:()=>g(p.id),children:[a(S,{size:15,"aria-hidden":!0}),a("span",{children:p.label})]},p.id)})]},L.label))}),o("div",{className:"prm-settings-pane",children:[n==="organizations"&&a($r,{host:r}),n==="repositories"&&a(Xr,{host:r,onRepositoriesChanged:s}),n==="author"&&a(Kr,{host:r}),n==="notifications"&&a(Zr,{settings:e,update:l}),n==="system"&&a(Qr,{settings:e,update:l,host:r})]})]})})}function as(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function ts(e,t,s){return e===1?t:s}function os(e){if(!e)return null;let t=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return t.length>0?{kind:"disconnect",subjects:t,action:"settings",message:`GitHub sign-in expired for ${as(t)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${ts(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${ts(r.length,"is","is")} temporarily unreachable for ${as(r)} \u2014 retrying automatically.`}:null}function ln(e,t){let s=(e.repo??"").toLowerCase();if(s)return(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function rs(e,t){let s=ln(e,t.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let i=t.notifyInApp??t.notifyOnChange??!1,l=t.sendToInbox??!1;return{inApp:i,inbox:l&&!!e.projectId}}function ss(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function dn(e){try{let t=new URL(e);if(t.protocol!=="http:"&&t.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function ls(e,t,s){for(let r of t){let n=Tt(r.newStatus)>Tt(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||n))continue;let l=rs(r.pr,s);if(!l.inApp&&!l.inbox)continue;let g=ss(r.pr.repo),L=ss(r.pr.title),p=dn(r.pr.url),S=p?`[${L}](${p})`:L;if(l.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${xe(r.oldStatus)} \u2192 ${xe(r.newStatus)}`,"info"),l.inbox&&r.pr.projectId){let y=`**${g}#${r.pr.number}** \u2014 ${xe(r.oldStatus)} \u2192 **${xe(r.newStatus)}**

${S}`;try{await e.pushInbox({comments:y,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var Ht="activeSubTab",is="listSort",ds="hostScope",Ot="listView";function qt({host:e}){let t=mt(),[s,r]=f(!1),[n,i]=f(null),[l,g]=f(!1),[L,p]=f(()=>e.cache.get(re)??[]),[S,y]=f(!1),[I,c]=f(null),[C,h]=f("prs"),[d,v]=f(!1),[A,U]=f(null),[R,E]=f(0),[X,N]=f(!1),[z,G]=f(!1),[P,q]=f(!1),[_,K]=f([]),[k,de]=f("status"),[ce,O]=f("asc"),[He,be]=f([]),[B,F]=f("board"),[H,Y]=f(!1),[le,me]=f(()=>({...ur})),ee=oe(null),Ye=oe(null),se=oe(!0);j(()=>(se.current=!0,()=>{se.current=!1}),[]),j(()=>{t||r(!1)},[t]);let[Qe,ia]=f(()=>e.listProjects());j(()=>{let b=!0;return U(null),v(!1),Promise.all([e.storage.get(Ra),e.storage.get(Ht),e.call("listPrs"),e.storage.get(is),e.storage.get(ds),e.storage.get(Ot)]).then(([w,u,M,m,T,D])=>{if(!b)return;m?.field&&de(m.field),m?.dir&&O(m.dir),Array.isArray(T)&&be(T),Et(D)&&F(D);let J=w?{...Aa,...w,relevanceModes:{...Aa.relevanceModes,...w.relevanceModes}}:null;i(J),J&&(e.cache.set("settings",J),e.cache.refreshBadge?.()),u==="prs"||u==="settings"?h(u):(u==="board"||u==="list")&&(h("prs"),Et(D)||(F(u),e.storage.set(Ot,u)),e.storage.set(Ht,"prs")),Array.isArray(M)&&(p(M),e.cache.set(re,M),e.cache.set(ke,M.length),e.cache.refreshBadge?.()),g(!0),v(!0),q(!0)}).catch(w=>{b&&(console.error("pr-monitor hydrate failed",w),U(w instanceof Error?w.message:String(w)),v(!0))}),()=>{b=!1}},[e,R]),j(()=>{let b=()=>{let u=e.cache.get(re);u&&p(m=>m===u?m:u);let M=e.listProjects();ia(m=>m.length===M.length&&m.every((T,D)=>T.id===M[D].id&&T.name===M[D].name&&T.path===M[D].path)?m:M)},w=window.setInterval(b,100);return()=>window.clearInterval(w)},[e]);let $e=b=>{h(b),e.storage.set(Ht,b)},Se=W(async b=>{y(!0),c(null);try{let w=Array.isArray(b)&&b.length>0,M=w?await e.call("syncRepos",{repos:b}):await e.call("pollAll"),m=Date.now()+3e5;for(;(M.state==="running"||M.state==="queued")&&se.current&&Date.now()<m;)await new Promise(J=>window.setTimeout(J,250)),M=await e.call("syncStatus",{id:M.id});if((M.state===void 0||M.state==="succeeded")&&Array.isArray(M.prs)){let J=M.state==="succeeded"?await e.call("listPrs"):M.prs;if(!se.current)return;if(!Array.isArray(J))throw new Error("Could not refresh pull requests after syncing.");if(p(J),e.cache.set(re,J),e.cache.set(ke,J.length),e.cache.refreshBadge?.(),Array.isArray(M.deltas)&&M.deltas.length>0){let Oe=n??{...Aa,...await e.storage.get(Ra)};await ls(e,M.deltas,Oe)}}else!se.current||Date.now()>=m?c("Sync is still running. Check back shortly."):M?.error&&c(M.error);let D=M?.health;!w&&D&&me(D)}catch(w){c(w instanceof Error?w.message:String(w))}finally{y(!1),Y(!0)}},[e]),Le=oe(!1);j(()=>{!P||Le.current||(Le.current=!0,e.call("getSyncHealth").then(b=>{b?.ok&&b.health&&me(b.health)}).catch(()=>{}),Se())},[P,Se,e]);let ea=W(async(b,w)=>{try{let u=await e.call("resolveRemoteGone",{repo:b,action:w});if(!u?.ok){e.toast(`Couldn't ${w} ${b} \u2014 ${u?.error??"unknown error"}`,"error");return}me(M=>({...M,remoteGone:M.remoteGone.filter(m=>m.toLowerCase()!==b.toLowerCase()),keptGone:w==="keep"?[...M.keptGone,b].filter((m,T,D)=>D.indexOf(m)===T):M.keptGone})),Se()}catch(u){e.toast(`Couldn't ${w} ${b} \u2014 ${u instanceof Error?u.message:String(u)}`,"error")}},[e,Se]),ne=W(async b=>{try{let w=await e.call("removePr",b);w?.ok&&Array.isArray(w.prs)&&(p(w.prs),e.cache.set(re,w.prs),e.cache.set(ke,w.prs.length),e.cache.refreshBadge?.())}catch(w){e.toast(`Couldn't remove PR \u2014 ${w instanceof Error?w.message:String(w)}`,"error")}},[e]),ye=W(async b=>{let w=L.find(u=>u.url===b);if(w)try{let u;w.source==="auto"?u=await e.call("dismissPr",{url:b}):u=await e.call("removePr",b),u?.ok&&Array.isArray(u.prs)&&(p(u.prs),e.cache.set(re,u.prs),e.cache.set(ke,u.prs.length),e.cache.refreshBadge?.())}catch(u){e.toast(`Couldn't dismiss PR \u2014 ${u instanceof Error?u.message:String(u)}`,"error")}},[e,L]),ae=W(async b=>{i(b);let w=await e.storage.get(Ra),u={...b};w&&(u.organizations=w.organizations,u.repositories=w.repositories,u.author=w.author,u.orgDiscovered=w.orgDiscovered,u.authorDiscovered=w.authorDiscovered),await e.storage.set(Ra,u),e.cache.set("settings",u),e.cache.refreshBadge?.()},[e]),we=W(async()=>{let b=await e.storage.get(Ra);b?.repositories&&i(w=>w&&{...w,repositories:b.repositories})},[e]),te=W(async(b,w)=>{try{let u=await e.call("assignProject",b,w);u?.ok&&Array.isArray(u.prs)&&(p(u.prs),e.cache.set(re,u.prs))}catch(u){e.toast(`Couldn't assign project \u2014 ${u instanceof Error?u.message:String(u)}`,"error")}},[e]),Ae=W((b,w)=>{de(b),O(w),e.storage.set(is,{field:b,dir:w})},[e]),wa=W(b=>{be(b),e.storage.set(ds,b)},[e]),da=W(b=>{F(b),e.storage.set(Ot,b)},[e]),fe=W(async(b,w)=>{if(b.length!==0)try{let u=await e.call("setPrsSeen",{urls:b,seen:w});u?.ok&&Array.isArray(u.prs)&&(p(u.prs),e.cache.set(re,u.prs),e.cache.set("monitoredCount",u.prs.length),e.cache.refreshBadge?.())}catch(u){e.toast(`Couldn't update read state \u2014 ${u instanceof Error?u.message:String(u)}`,"error")}},[e]),We=W(async(b,w)=>{if(b.length!==0)try{let u=await e.call("setPrsFavorite",{urls:b,favorite:w});u?.ok&&Array.isArray(u.prs)&&(p(u.prs),e.cache.set(re,u.prs))}catch(u){e.toast(`Couldn't update favorites \u2014 ${u instanceof Error?u.message:String(u)}`,"error")}},[e]),aa=W(async b=>{if(b.length!==0)try{let w=await e.call("dismissPrs",{urls:b});w?.ok&&Array.isArray(w.prs)&&(p(w.prs),e.cache.set(re,w.prs),e.cache.set(ke,w.prs.length),e.cache.refreshBadge?.())}catch(w){e.toast(`Couldn't dismiss PRs \u2014 ${w instanceof Error?w.message:String(w)}`,"error")}},[e]),Te=Q(()=>{if(_.length===0)return L;let b=new Set(_.map(w=>w.toLowerCase()));return L.filter(w=>b.has(w.repo.toLowerCase()))},[L,_]),ta=Q(()=>Te.filter(b=>_r.includes(b.status)).map(b=>b.url),[Te]),Ie=Q(()=>os(le),[le]);if(!d)return a("section",{className:"prm-panel",children:o("div",{className:"prm-loading",children:[a(V,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})});if(A!==null)return a("section",{className:"prm-panel",children:o("div",{className:"prm-empty",role:"alert",children:[a(_e,{size:28,"aria-hidden":!0}),a("h3",{children:"Couldn't load PR Monitor"}),a("p",{children:A}),o("button",{type:"button",className:"prm-btn",onClick:()=>E(b=>b+1),children:[a(Ce,{size:13,"aria-hidden":!0})," Retry loading"]})]})});if(!n)return a("section",{className:"prm-panel",children:a(xr,{onSave:async b=>{await ae(b)}})});let va=o("div",{className:"prm-header-actions",children:[C==="prs"&&o(Z,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>{r(!1),N(!0)},title:"Add a specific pull request to the monitored list",children:[a(ja,{size:13})," ",a("span",{children:"Add PR"})]}),ta.length>0&&o("button",{type:"button",className:"prm-btn",onClick:()=>{aa(ta)},title:`Sweep \u2014 dismiss the ${ta.length} Merged/Closed PR(s) from the list`,children:[a(ie,{size:13})," ",a("span",{children:"Sweep"})]}),o("div",{className:"prm-split-btn",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>{Se(_)},disabled:S,title:_.length>0?`Sync the ${_.length} selected repositor${_.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[S?a(V,{size:13,className:"prm-spin"}):a(Ce,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:Ye,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>{r(!1),G(b=>!b)},disabled:S,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker","aria-haspopup":"menu","aria-expanded":z,children:a(Pa,{size:13})})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":C==="settings",onClick:()=>{r(!1),$e(C==="settings"?"prs":"settings")},title:C==="settings"?"Back to pull requests":"Settings",children:C==="settings"?o(Z,{children:[a(Na,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):o(Z,{children:[a(Ya,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]});return o("section",{className:"prm-panel",children:[o("header",{className:"prm-header",children:[o("div",{className:"prm-header-title",children:[a(he,{size:16,className:"prm-header-icon","aria-hidden":!0}),o("div",{className:"prm-header-heading",children:[a("h2",{children:C==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:C==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),C==="prs"&&a("span",{className:"prm-count-pill",children:Te.length})]}),t?o("div",{className:"prm-mobile-header-actions",children:[C==="prs"&&a("button",{type:"button",className:"prm-btn","aria-label":"Sync pull requests",disabled:S,onClick:()=>{Se(_)},children:S?a(V,{size:18,className:"prm-spin"}):a(Ce,{size:18})}),C==="settings"&&o("button",{type:"button",className:"prm-btn",onClick:()=>$e("prs"),children:[a(Na,{size:18})," PRs"]}),a("button",{type:"button",className:"prm-btn",ref:ee,"aria-label":"PR Monitor actions","aria-haspopup":"dialog","aria-expanded":s,onClick:()=>r(!0),children:a(ga,{size:20})})]}):va]}),t&&s&&a(ue,{title:"PR Monitor actions",closeLabel:"Close PR actions",onClose:()=>r(!1),children:a("div",{className:"prm-modal-body prm-mobile-actions",children:va})}),z&&a(jr,{anchorRef:t?ee:Ye,host:e,selectedRepos:_,onClose:()=>G(!1),onToggleRepo:b=>K(w=>w.includes(b)?w.filter(u=>u!==b):[...w,b]),onSelectAll:()=>K([]),onSync:b=>{Se(b)}}),o("div",{className:`prm-content${C==="prs"&&!t&&B==="board"?" prm-content--board":""}`,children:[I&&a("div",{className:"prm-error",children:I}),C==="prs"&&Ie&&o("div",{className:`prm-sync-clue prm-sync-clue--${Ie.kind}`,role:"status",children:[Ie.kind==="disconnect"&&a(tt,{size:14,"aria-hidden":!0}),Ie.kind==="remote-gone"&&a(_e,{size:14,"aria-hidden":!0}),Ie.kind==="outage"&&a(Va,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:Ie.message}),Ie.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>$e("settings"),children:"Open Settings"})]}),C==="prs"&&le.remoteGone.map(b=>o("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${b} is gone`,children:[o("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:b})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),o("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>{ea(b,"keep")},children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>{ea(b,"remove")},children:"Remove"})]})]},b)),C==="prs"&&a(Gr,{prs:Te,host:e,projects:Qe,tisWarnHours:n.tisWarnHours,tisDangerHours:n.tisDangerHours,reviewWarnDays:n.reviewWarnDays,reviewDangerDays:n.reviewDangerDays,repositories:n.repositories,workItemLocatorBase:n.gusLocatorBaseUrl,sortField:k,sortDir:ce,onSortChange:Ae,hostScope:He,onHostScopeChange:wa,awaitingFirstSync:!H,syncing:S,autoSyncEnabled:n.autoSyncEnabled??!0,onDismiss:b=>{ye(b)},onProjectAssign:(b,w)=>{te(b,w)},onBulkSetSeen:(b,w)=>{fe(b,w)},onBulkDismiss:b=>{aa(b)},onBulkSetFavorite:(b,w)=>{We(b,w)},viewMode:B,onViewModeChange:da}),C==="settings"&&l&&a(es,{settings:n,onSave:b=>{ae(b)},onRepositoriesChanged:()=>{we()},host:e})]}),X&&a(Vr,{host:e,onClose:()=>N(!1),onPulled:b=>{p(b),e.cache.set(re,b),e.cache.set(ke,b.length),e.cache.refreshBadge?.(),N(!1)}})]})}function us(e){if(e.length!==0)return e.length===1?e[0]:e}var zt=new Map,cs,cn=5e3;function Ut(e){cs=e}function fn(){return{get:e=>zt.get(e),set:(e,t)=>{zt.set(e,t)},delete:e=>{zt.delete(e)},refreshBadge:()=>cs?.()}}function pn(e,t){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,t)}function mn(e){try{let t=new URL(e);if(t.protocol!=="https:"&&t.protocol!=="http:"||typeof window>"u")return;window.open(t.href,"_blank","noopener,noreferrer")}catch{}}function fs(e){let t=[],s=!1,r=0,n=async()=>{if(!(s||Date.now()<r)){s=!0;try{let i=await ua(e,"listProjects");Array.isArray(i)&&(t=i)}catch{}finally{r=Date.now()+cn,s=!1}}};return n(),{call:(i,...l)=>ua(e,i,us(l)),storage:{get:i=>ua(e,"storageGet",i),set:async(i,l)=>{await ua(e,"storageSet",{key:i,value:l})}},cache:fn(),toast:pn,listProjects:()=>(n(),t),openExternal:mn,pushInbox:async i=>i.projectId?await ua(e,"pushInbox",i):{id:""}}}var _t="prs-changed";var Gt=`/*
 * PR Monitor \u2014 plugin-scoped styles. Everything here is prefixed with \`.prm-\`
 * so it can never collide with core or another plugin. The UI is a full-width
 * workbench: a kanban board (default) or a dense tile list.
 *
 * Colors are pulled from the app's CSS custom properties (\`--bg-*\`, \`--text-*\`,
 * \`--accent-*\`, \`--danger\`, \`--success\`) so both light and dark themes work
 * without a plugin-side theme switch.
 */

/* \u2500\u2500 Panel shell \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

/*
 * Root panel. The host \`.module-panel-slot\` already spans the shell content
 * columns, so this root only needs to fill the slot: full height, flex column,
 * min-height 0 so the tile list can scroll.
 */
.prm-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 13px;
  container-type: inline-size;
}

.prm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0; /* Never shrink header - always visible */
}

.prm-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prm-header-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.prm-header-icon {
  color: var(--accent-blue);
}

.prm-count-pill {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border-radius: 10px;
  padding: 1px 8px;
  font-weight: 500;
  min-width: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.prm-header-actions {
  display: flex;
  gap: 6px;
}

.prm-content {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto; /* Vertical scroll only \u2014 content word-wraps, never scrolls sideways */
  overflow-x: hidden;
}

/* \u2500\u2500 Buttons \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  line-height: 1.2;
  padding: 7px 12px;
  min-height: 30px;
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
  font-size: 12px;
  font-weight: 550;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.prm-btn svg {
  display: block;
  flex-shrink: 0;
}

.prm-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--border-strong));
}

.prm-btn:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 2px;
}

.prm-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.prm-btn--primary {
  background: var(--accent-blue);
  color: white;
  border-color: var(--accent-blue);
}

/* Opt a button out of flex-column stretch so it sizes to its own text
   (e.g. "Sync All Now" inside .prm-subsection). */
.prm-btn--inline {
  align-self: flex-start;
}

.prm-btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
  background: var(--accent-blue);
}

.prm-row-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  min-width: 28px;
  min-height: 28px;
  border-radius: 5px;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
}

.prm-row-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* The lucide <svg> fills the tiny (padding:2px) icon button, so the pointer is
   always over the SVG child, never the button itself. In Electron/Chromium the
   native \`title\` tooltip is flaky when the persistent hover target is a child
   rather than the title-bearing element, so icon-only buttons showed no hover
   text. Make the icon transparent to pointer events \u2192 the button is the stable
   hover target and its \`title\` surfaces (clicks still land on the button). */
.prm-row-icon-btn svg {
  pointer-events: none;
}

.prm-row-icon-btn--danger:hover {
  color: var(--danger);
}

/* Deterministic hover tooltip for icon-only buttons. The native \`title\` tooltip
   is unreliable in Electron/Chromium for tiny icon buttons (it often never
   surfaces even with the SVG made pointer-transparent), so we render our own
   from a \`data-tip\` attribute. \`title\` stays on the element as an a11y/native
   fallback; \`data-tip\` drives the visible bubble. The host tokens keep it on
   theme. The positioned ancestor is the button itself. */
.prm-tip {
  position: relative;
}
.prm-tip::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  /* Tooltip text is plain mixed-case prose even when the element it labels is
     CSS-uppercased (e.g. a status pill). text-transform inherits into ::after
     content, so reset it here or the pill's uppercase leaks into the bubble. */
  text-transform: none;
  white-space: nowrap;
  padding: 3px 7px;
  border-radius: 4px;
  background: var(--bg-tooltip, #1f2430);
  /* \`--text-primary\` is dark in ZCC's light theme, while this surface is
     intentionally dark. Keep the tooltip foreground fixed to an inverse color
     so check summaries remain readable in both host themes. */
  color: #fff;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  font-size: 11px;
  line-height: 1.3;
  pointer-events: none;
  opacity: 0;
  z-index: 20;
  transition: opacity 0.1s ease;
}
.prm-tip:hover::after,
.prm-tip:focus-visible::after {
  opacity: 1;
}

/* \u2500\u2500 Loading / errors \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-muted);
  font-size: 12px;
}

.prm-spin {
  animation: prm-spin 0.9s linear infinite;
}

@keyframes prm-spin {
  to {
    transform: rotate(360deg);
  }
}

.prm-error {
  margin: 8px 14px;
  padding: 6px 10px;
  border-radius: 5px;
  background: rgba(248, 81, 73, 0.1);
  color: var(--danger);
  font-size: 12px;
  border: 1px solid rgba(248, 81, 73, 0.3);
}

/* \u2500\u2500 Sync-health clue + Remove/Keep prompt (R-REPO-013/015/016) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * One consolidated clue banner (AC-REPO-13.5), colored by kind, plus a per-repo
 * Remove/Keep prompt for confirmed remote-gone repos (R-REPO-016). */
.prm-sync-clue {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 14px;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.prm-sync-clue--disconnect {
  background: rgba(248, 81, 73, 0.1);
  border-color: rgba(248, 81, 73, 0.3);
  color: var(--danger);
}

.prm-sync-clue--remote-gone {
  background: rgba(210, 153, 34, 0.1);
  border-color: rgba(210, 153, 34, 0.35);
  color: var(--warning, #d29922);
}

.prm-sync-clue--outage {
  background: var(--bg-elevated);
  border-color: var(--border);
  color: var(--text-muted);
}

.prm-sync-clue-msg {
  flex: 1 1 auto;
  min-width: 0;
}

.prm-sync-clue-action {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 5px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.prm-sync-clue-action:hover {
  background: rgba(255, 255, 255, 0.08);
}

.prm-sync-prompt {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 14px;
  padding: 8px 10px;
  border-radius: 5px;
  font-size: 12px;
  background: rgba(210, 153, 34, 0.08);
  border: 1px solid rgba(210, 153, 34, 0.3);
  color: var(--text-primary);
}

.prm-sync-prompt-msg {
  flex: 1 1 auto;
  min-width: 0;
}

.prm-sync-prompt-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
}

.prm-btn--danger {
  background: var(--danger);
  color: white;
  border-color: var(--danger);
}

.prm-btn--danger:hover:not(:disabled) {
  filter: brightness(1.08);
  background: var(--danger);
}

/* Transparent full-viewport backdrop that sits just BELOW the fixed menu. It
 * catches every outside click and closes the menu structurally, so we don't
 * need a window mousedown listener (which raced with item selection across the
 * host-React boundary \u2014 see PrProjectControl). A click on a menu item
 * lands on the item (higher z-index); a click anywhere else lands here. */
.prm-project-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: transparent;
}

.prm-project-menu-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prm-project-menu-item:hover {
  background: var(--bg-hover);
}

.prm-project-menu-item.is-active {
  background: rgba(47, 129, 247, 0.15);
  color: var(--accent-blue);
  font-weight: 600;
}

.prm-project-menu-empty {
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-style: italic;
}

/* \u2500\u2500 Check summary \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-check-pip {
  display: inline-block;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  border: 1px solid var(--border);
  line-height: 1.25;
}

.prm-check-pip--pass {
  background: rgba(63, 185, 80, 0.15);
  color: var(--success);
  border-color: rgba(63, 185, 80, 0.3);
}

.prm-check-pip--fail {
  background: rgba(248, 81, 73, 0.15);
  color: var(--danger);
  border-color: rgba(248, 81, 73, 0.3);
}

.prm-check-pip--pending {
  background: rgba(212, 160, 23, 0.15);
  color: var(--accent-gold);
  border-color: rgba(212, 160, 23, 0.3);
}

.prm-checks-list {
  list-style: none;
  padding: 6px 0 0;
  margin: 6px 0 0;
  border-top: 1px solid var(--border);
  font-size: 11px;
}

.prm-checks-empty {
  padding: 6px 0;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.prm-check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  color: var(--text-muted);
}

.prm-check-state-pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
}

.prm-check-state-pip--pass {
  background: var(--success);
}

.prm-check-state-pip--fail {
  background: var(--danger);
}

.prm-check-state-pip--pending {
  background: var(--accent-gold);
}

.prm-check-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 11px;
}

.prm-check-bucket {
  font-size: 10px;
  color: var(--text-dim);
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-elevated);
}

.prm-check-state {
  font-size: 10px;
  text-transform: lowercase;
  color: var(--text-dim);
}

/* \u2500\u2500 Compact list view \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-list {
  flex: 1 1 auto;
  min-height: 0; /* Allow flex shrinking */
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* \u2500\u2500 Modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-modal-backdrop {
  padding: 24px;
  overscroll-behavior: contain;
}

.prm-modal {
  width: min(480px, 100%);
  max-height: min(800px, calc(100dvh - 48px));
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  outline: none;
}

.prm-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.prm-modal-header h3 {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.prm-modal-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--text-muted);
}

.prm-modal-body {
  padding: 20px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overflow-wrap: anywhere;
  overscroll-behavior: contain;
}

/* Help popup body \u2014 readable prose with a tidy bulleted list. */
.prm-help-body {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.prm-help-body p {
  margin: 0 0 10px;
}

.prm-help-body ul {
  margin: 0 0 10px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prm-help-body strong {
  color: var(--text-primary);
}

.prm-modal-footer {
  padding: 12px 20px;
  flex-shrink: 0;
  flex-wrap: wrap;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.prm-modal-error {
  margin-top: 10px;
  padding: 6px 10px;
  border-radius: 5px;
  background: rgba(248, 81, 73, 0.1);
  color: var(--danger);
  font-size: 12px;
  border: 1px solid rgba(248, 81, 73, 0.3);
}

/* \u2500\u2500 Form fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prm-field-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.prm-field-hint {
  font-size: 10px;
  color: var(--text-dim);
}

/* Emphasized field label \u2014 for text fields that should stand out like the
   bold checkbox labels (AC-REPO-11 readability). */
.prm-field-label--strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: none;
  letter-spacing: 0;
}

.prm-input {
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
}

.prm-input:focus {
  outline: none;
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 2px rgba(47, 129, 247, 0.2);
}

/* \u2500\u2500 Settings view \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-radio-row,
.prm-checkbox-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid transparent;
}

.prm-radio-row:hover,
.prm-checkbox-row:hover {
  background: var(--bg-hover);
}

.prm-radio-row input,
.prm-checkbox-row input {
  margin-top: 2px;
  flex-shrink: 0;
}

.prm-radio-row > span,
.prm-checkbox-row > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.prm-radio-row strong,
.prm-checkbox-row strong {
  font-size: 12px;
  font-weight: 600;
}

.prm-radio-row small,
.prm-checkbox-row small {
  font-size: 11px;
  color: var(--text-muted);
}

/* \u2500\u2500 Setup gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-setup-gate {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.prm-setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 460px;
  text-align: center;
  color: var(--text-muted);
}

.prm-setup h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.prm-setup p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

/* \u2500\u2500 Empty states \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
}

.prm-empty h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.prm-empty p {
  margin: 0;
  font-size: 13px;
}

/* \u2500\u2500 Tile UI (Phase 2) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-tile-list {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prm-tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  box-shadow: none;
  /* Item 6: the tile root is NOT a click target for a READ PR \u2014 a whole-row
     click only does something when unread (marks it seen). So the row shows the
     default cursor; only an unread tile (below) opts into pointer. The dead
     space right of the project / branch / Draft no longer looks clickable. */
  cursor: default;
  transition: background 0.12s, border-color 0.12s;
  position: relative;
}

.prm-tile:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

/* Favorite (R-LIST-026) \u2014 a find-faster marker: a light-yellow row tint mixed
   from the gold accent over the base surface so it reads in both themes. The
   explicit :hover rule is required \u2014 \`.prm-tile:hover\` at (0,2,0) specificity
   would otherwise override the bare \`--favorite\` class (0,1,0) and wash the tint
   away on hover. Declared BEFORE unread/selected so those stronger states win
   the cascade (same specificity): a selected or unread favorite shows the
   stronger tint, with the star + gold action icon still marking it a favorite. */
.prm-tile--favorite {
  background: color-mix(in srgb, var(--accent-gold, #d4a017) 22%, var(--bg-base));
}

.prm-tile--favorite:hover {
  background: color-mix(in srgb, var(--accent-gold, #d4a017) 30%, var(--bg-base));
}

/* Unread \u2014 inbox-style: 2px left accent bar + bold title. The rest of the
   row stays muted; no blue ring and no whole-row bold. */
.prm-tile--unread {
  border-left: 2px solid var(--accent-blue);
  /* Unread rows ARE a click target (click marks seen), so they show pointer. */
  cursor: pointer;
}

.prm-tile--unread .prm-tile-title {
  font-weight: 600;
  color: var(--text-primary);
}

.prm-tile--closed {
  opacity: 0.7;
}

/* Selected in the bulk-select model (R-LIST-006). */
.prm-tile--selected {
  background: color-mix(in srgb, var(--accent-blue) 10%, var(--bg-base));
  border-color: color-mix(in srgb, var(--accent-blue) 35%, var(--border));
}

/* Last sync errored (R-LIST-023) \u2014 subtle warning edge, retry lives inline. */
.prm-tile--stale {
  border-left: 3px solid var(--warning, var(--accent-gold, #d29922));
}

.prm-tile-line1 {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.prm-tile-state-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.prm-tile-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.4;
}

.prm-tile-workitem-inline {
  color: var(--accent);
  font-weight: 600;
}

.prm-status-pill {
  display: inline-block;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.prm-status-pill--failed,
.prm-status-pill--conflict {
  background: rgba(248, 81, 73, 0.15);
  color: var(--danger);
  border: 1px solid rgba(248, 81, 73, 0.3);
}

.prm-status-pill--yellow,
.prm-status-pill--pending {
  background: rgba(212, 160, 23, 0.15);
  color: var(--accent-gold);
  border: 1px solid rgba(212, 160, 23, 0.3);
}

.prm-status-pill--review-required,
.prm-status-pill--integrating {
  background: rgba(47, 129, 247, 0.15);
  color: var(--accent-blue);
  border: 1px solid rgba(47, 129, 247, 0.3);
}

.prm-status-pill--green {
  background: rgba(63, 185, 80, 0.15);
  color: var(--success);
  border: 1px solid rgba(63, 185, 80, 0.3);
}

.prm-status-pill--closed-merged {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
}

.prm-status-pill--closed-abandoned {
  background: var(--bg-elevated);
  color: var(--text-dim);
  border: 1px solid var(--border);
}

/* Time-in-status pill (R-LIST-013): how long the PR has sat in its current
 * rollup status, escalating ok \u2192 warn \u2192 danger. A text cue (prm-tis-cue,
 * "Slow"/"Stalled") rides alongside the color for colorblind users (AC-LIST-13.2). */
.prm-tis {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 8px;
  font-weight: 500;
  flex-shrink: 0;
}

.prm-tis--ok {
  color: var(--success);
  background: rgba(63, 185, 80, 0.1);
}

.prm-tis--warn {
  color: var(--accent-gold);
  background: rgba(212, 160, 23, 0.1);
}

.prm-tis--danger {
  color: var(--danger);
  background: rgba(248, 81, 73, 0.1);
}

/* Passive done-state (Build \u2713 / Review \u2713) \u2014 the gate finished, so the pill is a
 * calm neutral check, no alarm color (\xA73 two-pill model, extension Rule 6: a new
 * rendered modifier needs its own rule). Both pills share this treatment. */
.prm-tis--done {
  color: var(--text-muted);
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
}

/* The review pill is label-distinguished, not hue-distinguished (\xA76.4): it shares
 * the ok/warn/danger/done colors. A hair more left margin sets it apart from the
 * build pill when both sit inline. */
.prm-tis--review {
  margin-left: 1px;
}

.prm-tis-cue {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.prm-tile-line2 {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-muted);
}

.prm-workitem-chip {
  display: inline-block;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  flex-shrink: 0;
}

/* Work-item chip that resolves to a locator URL \u2014 rendered as a <button> that
 * opens externally, so make it read as clickable (R-LIST-011 work-item link). */
.prm-workitem-chip--link {
  cursor: pointer;
}

.prm-workitem-chip--link:hover {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}

.prm-tile-repo {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.prm-tile-number {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.prm-tile-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px;
  border-radius: 3px;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
}

.prm-tile-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--accent-blue);
}

.prm-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.prm-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}

.prm-avatar--initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-blue);
  color: white;
  font-size: 8px;
  font-weight: 600;
}

.prm-author-name {
  font-size: 11px;
  color: var(--text-primary);
}

/* Draft pill (item 14): solid gray fill + bold white text, so it carries the
   same visual weight as a status pill instead of reading as muted body text. */
.prm-draft-pill {
  display: inline-block;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 10px;
  background: var(--text-muted, #6e7681);
  color: #fff;
  border: 1px solid var(--text-muted, #6e7681);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.prm-tile-line3 {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.prm-branch-icon {
  color: var(--text-dim);
  flex-shrink: 0;
}

.prm-branch {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--text-muted);
}

.prm-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* \u2500\u2500 Tile menu \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-tile-menu {
  position: absolute;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 10000;
  min-width: 180px;
  max-width: 240px;
  padding: 4px;
}

/* Project-assign picker \u2014 a prm-tile-menu positioned fixed at the trigger and
 * right-aligned (translateX(-100%)) in PrProjectControl. Only overrides sizing. */
.prm-project-picker {
  min-width: 160px;
  max-width: 280px;
  overflow-y: auto;
}

.prm-tile-menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

/* \u2500\u2500 Settings shell (grouped left-nav, R-SET-*) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-settings-shell {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.prm-settings-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.prm-settings-nav {
  width: 210px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 12px 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.prm-nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.prm-nav-group-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-dim);
  padding: 0 8px 4px;
}

.prm-nav-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}

.prm-nav-row:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.prm-nav-row.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  font-weight: 550;
}

.prm-nav-row.active svg {
  color: var(--text-primary);
}

.prm-settings-pane {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 20px;
}

/* \u2500\u2500 Settings area (shared shell for the five areas) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-area {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}

.prm-area-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.prm-area-heading h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.prm-area-heading p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.prm-area-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.prm-area-explainer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.prm-area-explainer code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-elevated);
}

.prm-area-empty {
  padding: 24px 16px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}

.prm-subsection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.prm-subsection-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

/* \u2500\u2500 Entity cards (orgs / repos / author) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prm-entity-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.prm-entity-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.prm-entity-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.prm-entity-host {
  color: var(--text-muted);
  font-weight: 400;
}

.prm-entity-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.prm-entity-sub code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

.prm-entity-side {
  display: flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
}

/* Org card lays main+side side-by-side */
.prm-entity-card:not(.prm-repo-card):not(.prm-author-card) {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

/* \u2500\u2500 Connection pill (R-ORG-005) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-conn-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.prm-conn-pill--connected {
  background: rgba(63, 185, 80, 0.15);
  color: var(--success);
  border: 1px solid rgba(63, 185, 80, 0.3);
}

.prm-conn-pill--disconnected {
  background: rgba(248, 81, 73, 0.12);
  color: var(--danger);
  border: 1px solid rgba(248, 81, 73, 0.3);
}

.prm-conn-pill--checking {
  background: rgba(47, 129, 247, 0.12);
  color: var(--accent-blue);
  border: 1px solid rgba(47, 129, 247, 0.3);
}

/* \u2500\u2500 Repo card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-repo-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.prm-repo-quick {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.prm-repo-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.prm-repo-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.prm-active-badge {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 2px 7px;
  border-radius: 9px;
  background: rgba(63, 185, 80, 0.15);
  color: var(--success);
  border: 1px solid rgba(63, 185, 80, 0.3);
}

.prm-active-badge--off {
  background: var(--bg-panel);
  color: var(--text-dim);
  border-color: var(--border);
}

/* Time-in-status preset pill on the repo card, next to the connection pill
   (R-LIST/R-REPO \u2014 surface which TIS preset is selected). */
.prm-tis-preset-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 2px 7px;
  border-radius: 9px;
  background: var(--bg-panel);
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.prm-btn--sm {
  padding: 3px 8px;
  font-size: 11px;
}

.prm-btn--danger,
.prm-btn--danger:hover:not(:disabled) {
  background: var(--danger);
  border-color: var(--danger);
  color: white;
}

.prm-btn--danger:hover:not(:disabled) {
  filter: brightness(1.08);
}

.prm-btn--danger-ghost:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}

/* \u2500\u2500 Author card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-author-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
  color: inherit;
  text-align: left;
}

.prm-author-id {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1 1 auto;
  min-width: 0;
}

/* Author-card expand/collapse chevron (rotates when the card is open). */
.prm-disclosure {
  color: var(--text-dim);
  transition: transform 0.15s;
}

.prm-disclosure.is-open {
  transform: rotate(90deg);
}

.prm-avatar--initials {
  width: 28px;
  height: 28px;
  font-size: 11px;
}

.prm-author-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.prm-kv {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text-primary);
}

.prm-identity-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prm-identity-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.prm-identity-verified {
  color: var(--success);
}

.prm-identity-disconnected {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--danger);
  font-size: 11px;
}

/* \u2500\u2500 Sync status (System area) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-sync-status {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.prm-sync-counts {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.prm-sync-count strong {
  color: var(--text-primary);
}

.prm-input--select {
  width: auto;
  min-width: 200px;
  max-width: 100%;
}

/* \u2500\u2500 Settings dialogs (Add / Suggested / Browse / Repo-settings / Test) \u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-modal--wide {
  width: min(680px, 100%);
}

.prm-dialog-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.prm-dialog-tabs {
  display: flex;
  flex-shrink: 0;
  overflow-x: auto;
  gap: 4px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}

.prm-dialog-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.prm-dialog-tab.active {
  color: var(--accent-blue);
  border-bottom-color: var(--accent-blue);
  font-weight: 600;
}

.prm-modal-body .prm-field {
  margin-bottom: 12px;
}

.prm-suggested-list,
.prm-browse-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 360px;
  overflow-y: auto;
}

.prm-suggested-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.prm-suggested-row:hover {
  background: var(--bg-hover);
}

.prm-suggested-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.prm-suggested-added {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--success);
  white-space: nowrap;
  flex-shrink: 0;
}

.prm-added-tag {
  color: var(--text-dim);
}

.prm-browse-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.prm-browse-controls .prm-input:not(.prm-input--select) {
  flex: 1 1 auto;
}

.prm-browse-group {
  display: flex;
  flex-direction: column;
}

.prm-browse-group + .prm-browse-group {
  margin-top: 4px;
}

.prm-browse-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 6px;
  text-align: left;
}

.prm-browse-group-header:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.prm-browse-group-name {
  color: var(--text-primary);
}

.prm-browse-group-count {
  color: var(--text-muted);
  font-weight: 400;
}

.prm-browse-repo-row {
  margin-left: 16px;
}

/* An already-monitored repo renders as a non-selectable row with a "Connected"
   pill in place of the checkbox (AC-REPO-9.3). */
.prm-browse-repo-row--added {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: default;
}

.prm-browse-load-more {
  align-self: center;
  margin-top: 8px;
}

.prm-test-result {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
}

.prm-test-result--ok {
  background: rgba(63, 185, 80, 0.12);
  color: var(--success);
  border: 1px solid rgba(63, 185, 80, 0.3);
}

.prm-test-result--fail {
  background: rgba(248, 81, 73, 0.1);
  color: var(--danger);
  border: 1px solid rgba(248, 81, 73, 0.3);
}

/* ==========================================================================
 * List redesign (R-LIST-*) \u2014 header heading, split sync control, segment tabs,
 * list toolbar, bulk bar, tile check-pips / mute / sync-error / reviewers,
 * project control, Sync & Filter menu, project line, filtered-empty.
 * All token-based; no shared Tickets board chrome.
 * ========================================================================== */

/* Header heading + subtitle (AC-LIST-1.1 / 1.2). */
.prm-header-heading {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.prm-header-heading h2 {
  margin: 0;
}

.prm-header-subtitle {
  margin: 0;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

/* Split sync control (R-LIST-002). */
.prm-split-btn {
  position: relative;
  display: inline-flex;
  align-items: stretch;
}

.prm-split-primary {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.prm-split-caret {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.25);
  padding-left: 6px;
  padding-right: 6px;
}

/* Segment tabs (R-LIST-005). Quiet cohort chips: muted until active. */
.prm-segment-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.prm-segment-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.prm-segment-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.prm-segment-tab.active {
  background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--border));
  color: var(--accent-blue);
  font-weight: 600;
}

.prm-segment-count {
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  opacity: 0.8;
}

/* Status color only when the chip is the active filter. */
.prm-segment-tab--failed.active,
.prm-segment-tab--conflict.active {
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  color: var(--danger);
  font-weight: 600;
}

.prm-segment-tab--yellow.active,
.prm-segment-tab--pending.active {
  background: color-mix(in srgb, var(--accent-gold) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent-gold) 40%, var(--border));
  color: var(--accent-gold);
  font-weight: 600;
}

.prm-segment-tab--review-required.active,
.prm-segment-tab--integrating.active {
  background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--border));
  color: var(--accent-blue);
  font-weight: 600;
}

.prm-segment-tab--green.active {
  background: color-mix(in srgb, var(--success) 15%, transparent);
  border-color: color-mix(in srgb, var(--success) 40%, var(--border));
  color: var(--success);
  font-weight: 600;
}

.prm-segment-tab--closed-merged.active {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  color: var(--accent);
  font-weight: 600;
}

.prm-segment-tab--closed-abandoned.active {
  background: var(--bg-elevated);
  border-color: var(--border);
  color: var(--text-dim);
  font-weight: 600;
}

/* List toolbar container + controls row. */
.prm-list-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.prm-list-controls,
.prm-segment-tabs {
  width: 100%;
  min-width: 0;
}

.prm-list-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.prm-select-all {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.prm-shown-count {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.prm-search {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 1 1 140px;
  min-width: 120px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input, var(--bg-elevated));
  color: var(--text-muted);
}

.prm-search-input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--text-primary);
  font-size: 12px;
}

.prm-sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.prm-sort-select {
  font-size: 11px;
  padding: 3px 6px;
}

.prm-sort-dir {
  padding: 4px 6px;
}

.prm-unread-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

/* Bulk-action bar (R-LIST-006). */
.prm-bulk-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(47, 129, 247, 0.1);
  border: 1px solid var(--accent-blue);
}

.prm-bulk-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
}

.prm-bulk-clear:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.prm-bulk-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.prm-bulk-actions {
  display: inline-flex;
  gap: 6px;
  margin-left: auto;
}

/* Tile selection checkbox (R-LIST-006). */
.prm-tile-select {
  flex-shrink: 0;
  cursor: pointer;
}

/* Check-status summary pips container (R-LIST-021). */
.prm-check-pips {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* \u2500\u2500 Item 2: cursor discipline \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   The tile root is itself clickable (marks seen), so it carries cursor:pointer.
   But its decorative/text children must NOT inherit the pointer \u2014 a label or a
   status word is not itself a button. These read as default text; the genuinely
   interactive surfaces (buttons, links, and the check-toggle pills below) opt
   back into pointer explicitly. */
.prm-status-pill,
.prm-tis,
.prm-check-pips,
.prm-check-pip,
.prm-mute-indicator,
.prm-sync-error-text,
.prm-sync-error-icon,
.prm-tile-state-icon,
.prm-tile-title,
.prm-tile-repo,
.prm-tile-number,
.prm-author-name,
.prm-avatar,
.prm-reviewers-label,
.prm-reviewer-avatar,
.prm-branch,
.prm-branch-icon,
.prm-desc,
.prm-workitem-chip {
  cursor: default;
}

/* \u2500\u2500 Item 6: the status pill / time-in-status pill / check pips double as the
   per-check disclosure toggle when the PR has checks. \`prm-checks-trigger\` is
   added to exactly those surfaces in that case \u2014 it restores pointer + a hover
   affordance so they read as the clickable toggle they are. Without checks the
   default cursor:default above stands. */
.prm-checks-trigger,
/* \u2026and everything inside a trigger: the check pips carry cursor:default in the
   discipline block above, which would otherwise win over the parent trigger and
   leave the pass/fail counts showing no pointer even though they toggle. */
.prm-checks-trigger * {
  cursor: pointer;
}

.prm-checks-trigger:hover {
  filter: brightness(1.12);
}

/* \u2500\u2500 Item 10: trailing row-action set + a danger variant of the shared icon
   button. \`prm-tile-actions\` groups the inline action icons and pushes them to
   the row's end; \`prm-tile-icon-btn--danger\` tints the destructive dismiss
   action on hover. */
.prm-tile-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.prm-tile-icon-btn--danger:hover {
  background: rgba(248, 81, 73, 0.15);
  color: var(--danger);
}

/* Active (toggled-on) row action \u2014 the favorited star reads gold + filled
   (R-LIST-026). Keeps the gold on hover so it never flips to the default blue. */
.prm-tile-icon-btn--active,
.prm-tile-icon-btn--active:hover {
  /* A bright, unambiguous yellow-gold so the filled favorite star reads as
     yellow at 13px \u2014 the darker \`--accent-gold\` (#d4a017) muddies to grey at
     this size. Declared after the base \`.prm-tile-icon-btn\` rule so it wins
     the cascade at equal specificity. */
  color: var(--accent-gold);
}

/* Mute indicator (AC-LIST-18.3). */
.prm-mute-indicator {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
}

/* Per-PR sync-error indicator + retry (R-LIST-023). */
.prm-sync-error {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--warning, var(--accent-yellow, #d29922));
  font-size: 10px;
}

.prm-sync-error-icon {
  flex-shrink: 0;
}

.prm-sync-error-text {
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 600;
}

/* Reviewers strip grouped by state (R-LIST-016). */
.prm-reviewers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.prm-reviewers-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.prm-reviewers-label {
  font-size: 10px;
  color: var(--text-muted);
  /* Item 8: breathing room between the group label and its avatars. */
  margin-right: 4px;
}

.prm-reviewers--changes .prm-reviewer-avatar {
  background: var(--danger);
}

.prm-reviewers--requested .prm-reviewer-avatar {
  background: var(--text-muted);
}

.prm-reviewers--approved .prm-reviewer-avatar {
  background: var(--success);
}

.prm-reviewer-avatar {
  margin-left: -4px;
}

.prm-reviewer-avatar:first-of-type {
  margin-left: 0;
}

/* Project-association ROW (item 5; R-LIST-020). Always present: muted when
   unassociated (optional), primary when associated. Meaning is carried by the
   label text and hover title, never by hue alone (AC-LIST-20.2a). */
.prm-project-row {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  margin-top: 4px;
  padding: 2px 6px 2px 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  max-width: 100%;
}

.prm-project-row:hover {
  background: var(--bg-hover);
  border-color: var(--border);
}

.prm-project-row-icon {
  flex-shrink: 0;
}

.prm-project-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prm-project-row--associated {
  color: var(--text-primary);
}

.prm-project-row--unassociated {
  color: var(--text-muted);
}

/* Sync & Filter picker (R-LIST-002). Reuses prm-tile-menu base. */
.prm-sync-filter {
  min-width: 240px;
  max-width: 320px;
  padding: 6px;
}

.prm-sync-filter-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 8px;
}

.prm-sync-filter-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.prm-sync-filter-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  color: var(--accent-blue);
}

.prm-sync-filter-host {
  color: var(--text-dim);
  font-size: 10px;
}

.prm-sync-filter-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px 4px 2px;
}

/* Host filter picker (R-LIST-027). Reuses prm-tile-menu + prm-sync-filter-*. */
.prm-host-filter {
  min-width: 200px;
  max-width: 280px;
  padding: 6px;
}

/* Toolbar toggle button \u2014 highlighted while the host filter narrows the list. */
.prm-btn.is-active {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: white;
}

.prm-tile-checks {
  margin-top: 6px;
}

/* Filtered-empty state (AC-LIST-24.2). */
.prm-empty--filtered {
  padding: 32px 16px;
}

.prm-empty-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}

/* Modal description line shared by Pull PR (and others). */
.prm-modal-desc {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--text-muted);
}

/* \u2500\u2500 List / Board view toggle (BB-style segmented control) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-view-toggle {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.prm-view-toggle-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 550;
  font-family: inherit;
  cursor: pointer;
  line-height: 1.2;
}

.prm-view-toggle-btn svg {
  display: block;
  flex-shrink: 0;
}

.prm-view-toggle-btn:hover {
  color: var(--text-primary);
}

.prm-view-toggle-btn[aria-pressed='true'] {
  background: var(--bg-base);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.prm-view-toggle-btn:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 1px;
}

/* \u2500\u2500 Kanban board \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-content--board {
  overflow: hidden;
}

.prm-list--board {
  overflow: hidden;
  min-height: 0;
  padding: 8px 10px 0;
}

.prm-list--board .prm-list-toolbar {
  flex-shrink: 0;
  margin-bottom: 0;
  border-bottom: 0;
  padding-bottom: 8px;
}

.prm-board {
  padding: 0 2px 12px;
}

.prm-board > .zcc-kanban-col:not(.is-collapsed) {
  min-width: 260px;
  max-width: 420px;
  flex: 1 0 260px;
  width: auto;
}

.prm-board-col-empty {
  padding: 18px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}

.prm-board-col--conflict .zcc-kanban-col-icon,
.prm-board-col--failed .zcc-kanban-col-icon {
  color: var(--danger);
}

.prm-board-col--yellow .zcc-kanban-col-icon,
.prm-board-col--pending .zcc-kanban-col-icon {
  color: var(--accent-gold);
}

.prm-board-col--review-required .zcc-kanban-col-icon,
.prm-board-col--integrating .zcc-kanban-col-icon {
  color: var(--accent-blue);
}

.prm-board-col--green .zcc-kanban-col-icon,
.prm-board-col--closed-merged .zcc-kanban-col-icon {
  color: var(--success);
}

.prm-board-col--closed-abandoned .zcc-kanban-col-icon {
  color: var(--text-muted);
}

.prm-board-col--conflict,
.prm-board-col--failed {
  box-shadow: inset 0 2px 0 var(--danger);
}

.prm-board-col--yellow,
.prm-board-col--pending {
  box-shadow: inset 0 2px 0 var(--accent-gold);
}

.prm-board-col--review-required,
.prm-board-col--integrating {
  box-shadow: inset 0 2px 0 var(--accent-blue);
}

.prm-board-col--green,
.prm-board-col--closed-merged {
  box-shadow: inset 0 2px 0 var(--success);
}

.prm-board-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 8px;
  border-radius: 10px;
  background: var(--bg-panel, var(--bg-base));
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
}

.prm-board-card:hover {
  border-color: var(--border-strong);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
}

.prm-board-card:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 1px;
}

.prm-board-card--unread {
  border-left: 2px solid var(--accent-blue);
}

.prm-board-card--unread .prm-board-card-title {
  font-weight: 600;
}

.prm-board-card--favorite {
  background: color-mix(in srgb, var(--accent-gold, #d4a017) 18%, var(--bg-base));
}

.prm-board-card--favorite:hover {
  background: color-mix(in srgb, var(--accent-gold, #d4a017) 26%, var(--bg-base));
}

.prm-board-card--selected {
  background: color-mix(in srgb, var(--accent-blue) 10%, var(--bg-base));
  border-color: color-mix(in srgb, var(--accent-blue) 35%, var(--border));
}

.prm-board-card--closed {
  opacity: 0.72;
}

.prm-board-card--stale {
  border-left: 3px solid var(--warning, var(--accent-gold, #d29922));
}

.prm-board-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.prm-board-card-select {
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  margin: 0;
}

.prm-board-card:hover .prm-board-card-select,
.prm-board-card:focus-within .prm-board-card-select,
.prm-board-card--selected .prm-board-card-select,
.prm-board-card--select-mode .prm-board-card-select,
.prm-board-card--selectable .prm-board-card-select {
  opacity: 1;
  pointer-events: auto;
}

.prm-board-card--select-mode {
  cursor: pointer;
}

.prm-board-card-id {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1 1 100px;
  overflow: hidden;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.prm-board-card-num {
  flex-shrink: 0;
  font-weight: 650;
}

.prm-board-card-repo {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-muted);
}

.prm-board-card-wi {
  flex-shrink: 0;
  font-size: 9px;
  padding: 1px 5px;
}

.prm-board-card-draft {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.prm-board-card-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  /* Keep the repository readable; actions share a separate row with the key. */
  order: 2;
}

.prm-board-card:hover .prm-board-card-actions,
.prm-board-card:focus-within .prm-board-card-actions,
.prm-board-card--selected .prm-board-card-actions,
.prm-board-card--favorite .prm-board-card-actions {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .prm-board-card-actions,
  .prm-board-card-select {
    opacity: 1;
    pointer-events: auto;
  }
}

.prm-board-card-title {
  font-size: 13px;
  line-height: 1.35;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
}

.prm-board-card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.prm-board-card-time {
  font-variant-numeric: tabular-nums;
}

.prm-board-card .prm-avatar {
  width: 18px;
  height: 18px;
  font-size: 8px;
}

@media (max-width: 640px) {
  .prm-view-toggle-btn span {
    display: none;
  }

  .prm-board > .zcc-kanban-col:not(.is-collapsed) {
    min-width: 220px;
    flex-basis: 220px;
  }
}

/* \u2500\u2500 PR detail modal (opened from a board card) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-modal--detail {
  width: min(840px, 100%);
  outline: none;
}

.prm-modal--detail .prm-modal-header,
.prm-modal--detail .prm-modal-footer {
  flex-shrink: 0;
}

.prm-modal--detail .prm-modal-header h3 {
  min-width: 0;
}

.prm-modal--detail .prm-row-icon-btn,
.prm-detail-footer .prm-tile-icon-btn {
  min-width: 28px;
  min-height: 28px;
  flex-shrink: 0;
}

.prm-detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  min-height: 0;
}

.prm-detail-id {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.prm-detail-repo {
  font-weight: 500;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.prm-detail-heading {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.prm-detail-pr-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.prm-detail-status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.prm-detail-hint {
  font-size: 12px;
  color: var(--danger);
}

.prm-detail-facts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px 16px;
  margin: 0;
}

.prm-detail-fact {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.prm-detail-fact dt {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.prm-detail-fact dd {
  overflow-wrap: anywhere;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--text-primary);
}

.prm-detail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.prm-detail-label {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.prm-detail-branch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.prm-detail-desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.prm-detail-description-link {
  align-self: flex-start;
}

.prm-detail-sync-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(212, 160, 23, 0.12);
  color: var(--warning, var(--accent-gold));
  font-size: 12px;
}

.prm-detail-sync-error span {
  flex: 1 1 auto;
  min-width: 0;
}

.prm-detail-footer {
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
}

.prm-detail-footer-spacer {
  flex: 1;
}

.prm-detail-section .prm-checks-list {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.prm-detail-section .prm-reviewers {
  margin-top: 0;
}

/* Keep portaled surfaces on the same typography and focus treatment as the panel. */
.prm-panel :is(button, input, select, textarea),
.prm-modal :is(button, input, select, textarea),
.prm-tile-menu :is(button, input) { font-family: inherit; }

.prm-panel :is(button, input, select, textarea):focus-visible,
.prm-modal :is(button, input, select, textarea):focus-visible,
.prm-tile-menu :is(button, input):focus-visible {
  outline: 2px solid var(--focus-ring, var(--accent-blue));
  outline-offset: 2px;
}

.prm-modal .prm-input { width: 100%; min-width: 0; min-height: 34px; }
.prm-modal .prm-row-icon-btn { flex-shrink: 0; }
.prm-modal button:disabled { cursor: not-allowed; opacity: 0.5; }
.prm-modal .prm-field:last-child { margin-bottom: 0; }
.prm-modal-desc { line-height: 1.6; }

.prm-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px;
  gap: 24px;
  align-items: start;
}
.prm-detail-main, .prm-detail-sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.prm-detail-sidebar { border-left: 1px solid var(--border); padding-left: 20px; }
.prm-detail-main .prm-detail-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.prm-detail-main .prm-detail-section + .prm-detail-section { border-top: 1px solid var(--border); padding-top: 16px; }
.prm-detail-main .prm-check-row { padding: 8px 0; align-items: baseline; }
.prm-detail-main .prm-check-name { overflow-wrap: anywhere; white-space: normal; }
.prm-detail-sidebar .prm-branch { white-space: normal; overflow-wrap: anywhere; }
.prm-detail-sidebar .prm-reviewers-group { flex-wrap: wrap; }
.prm-detail-sidebar .prm-reviewers-label { flex-basis: 100%; }
.prm-detail-sidebar .prm-project-row { white-space: normal; text-align: left; min-height: 30px; }
.prm-detail-description-link { white-space: normal; text-align: left; }
.prm-text-btn {
  border: 0;
  background: transparent;
  color: var(--settings-link, var(--accent-blue));
  padding: 2px 0;
  align-self: flex-start;
  font-size: 12px;
  cursor: pointer;
}
.prm-text-btn:hover { text-decoration: underline; }
.prm-detail-hint { padding: 8px 12px; border-radius: 6px; background: color-mix(in srgb, var(--danger) 8%, transparent); }
.prm-detail-sync-error { flex-wrap: wrap; }
.prm-detail-sync-error span { flex-basis: 200px; overflow-wrap: anywhere; }
.prm-detail-fact .prm-avatar { flex-shrink: 0; }

.prm-settings-nav { width: 184px; background: var(--bg-base); padding: 20px 10px; }
.prm-settings-pane { padding: 24px; }
.prm-area { margin-inline: auto; gap: 20px; }
.prm-area-heading p { line-height: 1.6; margin-top: 4px; }
.prm-subsection { padding-top: 16px; gap: 12px; }
.prm-entity-title { overflow-wrap: anywhere; flex-wrap: wrap; }
.prm-entity-side { flex-wrap: wrap; }
.prm-nav-group-label { color: var(--text-muted); }
.prm-nav-row { min-height: 32px; }

@container (max-width: 640px) {
  .prm-header { padding: 12px; }
  .prm-header-actions { flex-wrap: wrap; }
  .prm-settings-body { flex-direction: column; }
  .prm-settings-nav { width: 100%; flex-direction: row; gap: 12px; padding: 8px; border-right: 0; border-bottom: 1px solid var(--border); }
  .prm-nav-group { flex-direction: row; }
  .prm-nav-group-label { display: none; }
  .prm-nav-row { white-space: nowrap; width: auto; }
  .prm-settings-pane { padding: 16px; }
  .prm-repo-top { flex-wrap: wrap; }
}

@media (max-width: 640px) {
  .prm-modal-backdrop { padding: 12px; }
  .prm-modal { max-height: calc(100dvh - 24px); }
  .prm-modal-header, .prm-modal-body { padding: 16px; }
  .prm-modal-footer { padding: 12px 16px; }
  .prm-detail-grid { grid-template-columns: minmax(0, 1fr); }
  .prm-detail-sidebar { border-left: 0; padding-left: 0; border-top: 1px solid var(--border); padding-top: 16px; }
  .prm-detail-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .prm-detail-footer-spacer { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .prm-panel *, .prm-modal *, .prm-tile-menu * { transition: none !important; }
  .prm-spin { animation: none !important; }
}

.prm-sync-filter, .prm-host-filter {
  width: 300px;
  min-width: 0;
  max-width: calc(100vw - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px;
  font-size: 12px;
}

.prm-detail-sidebar .prm-tip::after { left: auto; right: 0; transform: none; }
.prm-detail-sync-error {
  color: color-mix(in srgb, var(--accent-gold) 70%, var(--text-primary));
  background: color-mix(in srgb, var(--accent-gold) 10%, var(--bg-panel));
}

/* Phone/tablet navigation is a list \u2192 full-page detail flow. Desktop keeps its board. */
@media (max-width: 1024px) {
  .prm-header { flex-wrap: nowrap; gap: 8px; padding: 8px 16px; }
  .prm-header-title { min-width: 0; }
  .prm-header-title h2 { font-size: 17px; }
  .prm-header-subtitle { display: none; }
  .prm-mobile-header-actions { display: flex; gap: 4px; }
  .prm-panel .prm-btn, .prm-modal .prm-btn, .prm-tile-menu .prm-btn { min-height: 44px; font-size: 14px; }
  .prm-mobile-header-actions .prm-btn { min-width: 44px; padding: 8px; }
  .prm-panel .prm-list { min-height: 0; flex: 1; overflow: hidden; gap: 0; padding: 0; }
  .prm-mobile-toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 16px 0; flex-shrink: 0; }
  .prm-mobile-toolbar .prm-search { flex: 1; min-width: 0; min-height: 44px; padding: 0 10px; border-radius: 12px; }
  .prm-mobile-toolbar .prm-search-input { font-size: 16px; min-width: 0; width: 100%; }
  .prm-mobile-toolbar > .prm-btn { flex-shrink: 0; padding: 8px 10px; border-radius: 12px; }
  .prm-mobile-filter-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-blue); }
  .prm-mobile-summary { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 18px; color: var(--text-muted); font-size: 12px; flex-shrink: 0; }
  .prm-mobile-summary .prm-text-btn { align-self: auto; min-height: 44px; }
  .prm-mobile-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 16px max(16px, env(safe-area-inset-bottom)); }
  .prm-mobile-card { display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: 100%; min-width: 0; padding: 16px 0; text-align: left; color: var(--text-primary); background: transparent; border: 0; border-bottom: 1px solid var(--border); cursor: pointer; }
  .prm-mobile-card:first-child { padding-top: 4px; }
  .prm-mobile-card:hover { background: var(--bg-hover); }
  .prm-mobile-card-repo { display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; }
  .prm-mobile-card-repo > svg { flex-shrink: 0; }
  .prm-mobile-card-repo > span:first-of-type { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prm-mobile-card-repo > span:last-of-type { margin-left: auto; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .prm-mobile-card-title { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: 16px; line-height: 1.45; font-weight: 500; }
  .prm-mobile-card.is-unread .prm-mobile-card-title { font-weight: 650; }
  .prm-mobile-card.is-unread .prm-mobile-card-repo > svg:first-child { color: var(--accent-blue); }
  .prm-mobile-card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: 12px; }
  .prm-mobile-card-meta .prm-status-pill { font-size: 12px; padding: 4px 8px; }
  .prm-mobile-author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
  .prm-mobile-card-time { margin-left: auto; }
  .prm-mobile-sync-error { display: flex; align-items: center; gap: 6px; color: var(--danger); font-size: 12px; }
  .prm-mobile-filters { display: flex; flex-direction: column; gap: 20px; }
  .prm-mobile-hosts { display: flex; flex-direction: column; gap: 8px; padding: 0; border: 0; margin: 0; min-width: 0; }
  .prm-mobile-hosts legend { margin-bottom: 12px; }
  .prm-mobile-hosts label { display: flex; gap: 12px; align-items: center; min-height: 44px; overflow-wrap: anywhere; }
  .prm-mobile-hosts input { width: 20px; height: 20px; flex-shrink: 0; }
  .prm-mobile-actions .prm-header-actions { flex-direction: column; gap: 12px; }
  .prm-mobile-actions .prm-header-actions > .prm-btn { justify-content: flex-start; gap: 12px; padding: 12px 16px; }
  .prm-mobile-actions .prm-split-btn { width: 100%; }
  .prm-mobile-actions .prm-split-primary { flex: 1; }
  .prm-mobile-actions .prm-split-caret { min-width: 48px; }
  .prm-modal-backdrop { padding: 0; }
  .prm-modal-backdrop .prm-modal.modal[role="dialog"] { width: 100%; max-width: none; height: 100%; max-height: 100%; margin: 0; border: 0; border-radius: 0; }
  .prm-modal-header, .prm-modal-body { padding: 16px; }
  .prm-modal-header { padding-top: max(12px, env(safe-area-inset-top)); min-height: 60px; }
  .prm-modal-header h3 { min-width: 0; font-size: 16px; overflow-wrap: anywhere; }
  .prm-modal .prm-row-icon-btn, .prm-detail-footer .prm-tile-icon-btn { min-width: 44px; min-height: 44px; }
  .prm-modal .prm-row-icon-btn svg, .prm-detail-footer .prm-tile-icon-btn svg { width: 18px; height: 18px; }
  .prm-modal-body { min-height: 0; overscroll-behavior: contain; font-size: 15px; }
  .prm-modal .prm-input { min-height: 48px; font-size: 16px; }
  .prm-modal-footer { padding: 12px 16px max(12px, env(safe-area-inset-bottom)); }
  .prm-detail-grid { grid-template-columns: minmax(0, 1fr); }
  .prm-detail-sidebar { border-left: 0; padding-left: 0; border-top: 1px solid var(--border); padding-top: 16px; }
  .prm-detail-id { flex-wrap: wrap; min-width: 0; }
  .prm-detail-repo { overflow-wrap: anywhere; }
  .prm-detail-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .prm-detail-footer-spacer { display: none; }
  .prm-modal--detail .prm-detail-footer { flex-wrap: wrap; gap: 4px; }
  .prm-detail-body .prm-text-btn, .prm-detail-body .prm-project-row { min-height: 44px; }
  .prm-detail-pr-title { font-size: 22px; }
  .prm-detail-desc { font-size: 15px; line-height: 1.6; }
  .prm-sync-filter { inset: 0 !important; width: 100%; max-width: none; max-height: 100% !important; border-radius: 0; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); font-size: 15px; }
  .prm-sync-filter .prm-project-menu-item { min-height: 48px; }
  .prm-sync-filter-footer { flex-wrap: wrap; }
  .prm-settings-body { flex-direction: column; }
  .prm-settings-nav { width: 100%; flex-direction: row; gap: 12px; padding: 8px; border-right: 0; border-bottom: 1px solid var(--border); }
  .prm-nav-group { flex-direction: row; }
  .prm-nav-group-label { display: none; }
  .prm-nav-row { white-space: nowrap; width: auto; min-height: 44px; }
  .prm-settings-pane { padding: 16px; }
  .prm-panel .prm-input { font-size: 16px; min-height: 44px; }
}
`;var ms="pr-monitor",ps="prm-plugin-styles";function hn(){return globalThis.__ZCC_PLUGIN_RUNTIME__}function xn(){if(typeof document>"u")return;let e=document.getElementById(ps);if(e instanceof HTMLStyleElement){e.textContent=`${Bt}
${Gt}`;return}let t=document.createElement("style");t.id=ps,t.textContent=`${Bt}
${Gt}`,document.head.appendChild(t)}xn();var bn={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function Ln(){let e=Q(()=>fs(ms),[]);return wt(_t,t=>{let s=t?.prs;Array.isArray(s)&&(e.cache.set(re,s),e.cache.set(ke,s.length),e.cache.refreshBadge?.())}),a("div",{style:bn,children:a(qt,{host:e})})}function In(){let[e,t]=f(null),s=oe(!0),r=oe(0),n=W(async()=>{let i=++r.current;try{let l=await ua(ms,"badge");if(!s.current||i!==r.current)return;let g=typeof l?.count=="number"&&l.count>0?l.count:null;t(g)}catch(l){if(!s.current||i!==r.current)return;console.warn("[pr-monitor] badge refresh failed",l),t(null)}},[]);return j(()=>(s.current=!0,n(),Ut(()=>{s.current&&n()}),()=>{s.current=!1,r.current++,Ut(void 0)}),[n]),wt(_t,i=>{(async()=>{let l=Array.isArray(i?.inAppDeltas)?i.inAppDeltas:[];if(n(),l.length===0)return;let g=hn();for(let L of l)g?.toast?.(`${L.pr.repo}#${L.pr.number}: ${xe(L.oldStatus)} -> ${xe(L.newStatus)}`,"info")})().catch(l=>console.warn("[pr-monitor] notification delivery failed",l))}),e==null?null:a("span",{className:"nav-badge",children:e})}var pm=Jt(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:Ln,experimental_sidebarAccessory:In}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:t=>{t.toPluginPanel("main")}})});export{pm as default,xn as injectStyles};
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
lucide-react/dist/esm/icons/arrow-down.mjs:
lucide-react/dist/esm/icons/arrow-left.mjs:
lucide-react/dist/esm/icons/arrow-up.mjs:
lucide-react/dist/esm/icons/bell-off.mjs:
lucide-react/dist/esm/icons/bell.mjs:
lucide-react/dist/esm/icons/book-bookmark.mjs:
lucide-react/dist/esm/icons/building-complex.mjs:
lucide-react/dist/esm/icons/check.mjs:
lucide-react/dist/esm/icons/chevron-down.mjs:
lucide-react/dist/esm/icons/chevron-right.mjs:
lucide-react/dist/esm/icons/circle-alert.mjs:
lucide-react/dist/esm/icons/circle-check.mjs:
lucide-react/dist/esm/icons/circle-dashed.mjs:
lucide-react/dist/esm/icons/circle-question-mark.mjs:
lucide-react/dist/esm/icons/circle-x.mjs:
lucide-react/dist/esm/icons/clock.mjs:
lucide-react/dist/esm/icons/cloud-off.mjs:
lucide-react/dist/esm/icons/columns-3.mjs:
lucide-react/dist/esm/icons/download.mjs:
lucide-react/dist/esm/icons/ellipsis.mjs:
lucide-react/dist/esm/icons/external-link.mjs:
lucide-react/dist/esm/icons/eye-off.mjs:
lucide-react/dist/esm/icons/eye.mjs:
lucide-react/dist/esm/icons/folder-git-2.mjs:
lucide-react/dist/esm/icons/folder-search.mjs:
lucide-react/dist/esm/icons/folder.mjs:
lucide-react/dist/esm/icons/git-branch.mjs:
lucide-react/dist/esm/icons/git-merge.mjs:
lucide-react/dist/esm/icons/git-pull-request-closed.mjs:
lucide-react/dist/esm/icons/git-pull-request-draft.mjs:
lucide-react/dist/esm/icons/git-pull-request.mjs:
lucide-react/dist/esm/icons/globe.mjs:
lucide-react/dist/esm/icons/layout-list.mjs:
lucide-react/dist/esm/icons/link-2.mjs:
lucide-react/dist/esm/icons/loader-circle.mjs:
lucide-react/dist/esm/icons/mail-open.mjs:
lucide-react/dist/esm/icons/mail.mjs:
lucide-react/dist/esm/icons/panel-left-close.mjs:
lucide-react/dist/esm/icons/pen.mjs:
lucide-react/dist/esm/icons/plus.mjs:
lucide-react/dist/esm/icons/refresh-cw.mjs:
lucide-react/dist/esm/icons/search.mjs:
lucide-react/dist/esm/icons/settings.mjs:
lucide-react/dist/esm/icons/shield-alert.mjs:
lucide-react/dist/esm/icons/sliders-horizontal.mjs:
lucide-react/dist/esm/icons/sparkles.mjs:
lucide-react/dist/esm/icons/square-check-big.mjs:
lucide-react/dist/esm/icons/star.mjs:
lucide-react/dist/esm/icons/trash.mjs:
lucide-react/dist/esm/icons/triangle-alert.mjs:
lucide-react/dist/esm/icons/users.mjs:
lucide-react/dist/esm/icons/wifi-off.mjs:
lucide-react/dist/esm/icons/wifi.mjs:
lucide-react/dist/esm/icons/wrench.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.47.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
