var j=globalThis.__ZCC_HOST_REACT__;var rn=j.Children,sn=j.Component,nn=j.Fragment,ln=j.StrictMode,dn=j.Suspense,un=j.cloneElement,Ut=j.createContext,Ra=j.createElement,cn=j.createRef,ot=j.forwardRef,fn=j.isValidElement,pn=j.lazy,mn=j.memo,gn=j.startTransition,Z=j.useCallback,zt=j.useContext,hn=j.useDebugValue,xn=j.useDeferredValue,z=j.useEffect,Ln=j.useId,bn=j.useImperativeHandle,In=j.useInsertionEffect,Cn=j.useLayoutEffect,oe=j.useMemo,Sn=j.useReducer,ue=j.useRef,d=j.useState,yn=j.useSyncExternalStore,wn=j.useTransition,vn=j.version;function Yr(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Qr(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}async function ua(e,t,s){return Yr().callRpc(e,t,s)}function _t(e){return{__zccPluginApp:!0,setup:e}}function Lt(e,t){Qr().useRealtime?.(e,t)}var Gt=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function Vt(e,t,s=[]){if(t==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:Gt(e),size:24,node:t,...s.length>0?{aliases:s}:{}}}var $t=e=>{let t="",s=!1;for(let r of e){if(r==="-"||r==="_"||r<=" "){s=t.length>0;continue}t.length===0?t+=r.toLowerCase():t+=s?r.toUpperCase():r,s=!1}return t};var Wt=e=>{let t=$t(e);return t.charAt(0).toUpperCase()+t.slice(1)};var Ea=(...e)=>e.filter((t,s,r)=>!!t&&t.trim()!==""&&r.indexOf(t)===s).join(" ").trim();var ca={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function bt(e){return e!=null}function jt(e,t={}){let s=t.attributeNames??{},r=b=>s[b]??b,i=e.size??e.width??ca.width,l=e.size??e.height??ca.height,n=e.aliases?.filter(b=>typeof b=="string"&&b.trim()!=="").map(b=>`lucide-${b}`)??[],u=[...e.name?[`lucide-${e.name}`]:[],...n],L=t.className?.split(" ").filter(Boolean)??[],g=t.includeDefaultClasses===!1?Ea(...L):Ea("lucide",...u,...L),C=t.absoluteStrokeWidth?Number(t.strokeWidth??ca["stroke-width"])*Number(e.size??e.width??ca.width)/Number(t.size??t.width??ca.width):t.strokeWidth??ca["stroke-width"];return["svg",{...Object.entries(ca).reduce((b,[c,v])=>(b[r(c)]=v,b),{}),..."color"in t&&t.color&&{[r("stroke")]:t.color},..."size"in t&&bt(t.size)&&{[r("width")]:t.size,[r("height")]:t.size},..."width"in t&&bt(t.width)&&{[r("width")]:t.width},..."height"in t&&bt(t.height)&&{[r("height")]:t.height},[r("stroke-width")]:C,...g&&{[r("class")]:g},[r("viewBox")]:`0 0 ${i} ${l}`,...t.hasA11yProp===!1?{[r("aria-hidden")]:"true"}:{},..."attributes"in t&&t.attributes},e.node.map(b=>{let[c,v,h]=b,f=t.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...v}:v;return h?[c,f,h]:[c,f]})]}function Xt(e,t={}){return jt(e,{...t,attributeNames:{...t.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var Kt=e=>{for(let t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};var es=Ut({});var Zt=()=>zt(es);var Jt=ot(({color:e,size:t,width:s,height:r,strokeWidth:i,absoluteStrokeWidth:l,nonScalingStroke:n,className:u="",children:L,iconNode:g=[],icon:C={node:g,aliases:[],size:24},...S},b)=>{let{size:c=24,strokeWidth:v=2,absoluteStrokeWidth:h=!1,nonScalingStroke:f=!1,color:D="currentColor",className:A=""}=Zt()??{},R=!!L||Kt(S),[N,U,W=[]]=Xt(C,{color:e??D,width:s??t??c,height:r??t??c,strokeWidth:i??v,absoluteStrokeWidth:l??h,nonScalingStroke:n??f,className:Ea(A,u),hasA11yProp:R,attributes:S});return Ra(N,{ref:b,...U},[...W.map(([_,F])=>Ra(_,F)),...Array.isArray(L)?L:[L]])});function m(e,t=[],s=[]){let r=typeof e=="string"?Vt(e,t,s):e,i=ot(({className:l,...n},u)=>Ra(Jt,{ref:u,icon:r,className:l,...n}));return r.name&&(i.displayName=Wt(r.name)),i}var Yt={name:"arrow-down",size:24,node:[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]]};Yt.node;var Ha=m(Yt);var Qt={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};Qt.node;var Oa=m(Qt);var eo={name:"arrow-up",size:24,node:[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]]};eo.node;var qa=m(eo);var ao={name:"bell-off",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]]};ao.node;var ta=m(ao);var to={name:"bell",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]]};to.node;var Be=m(to);var oo={name:"book-bookmark",size:24,node:[["path",{d:"M10 2v7.751a.25.25 0 00.407.195l2.28-1.834a.5.5 0 01.627 0l2.28 1.834A.25.25 0 0016 9.751V2",key:"x9x4jl"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 016.5 2H19a1 1 0 011 1v18a1 1 0 01-1 1H6.5a1 1 0 010-5H20",key:"1889un"}]],aliases:["book-marked"]};oo.node;var fa=m(oo);var ro={name:"building-complex",size:24,node:[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],aliases:["building-2"]};ro.node;var pa=m(ro);var so={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};so.node;var ze=m(so);var no={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};no.node;var ya=m(no);var lo={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};lo.node;var oa=m(lo);var io={name:"circle-alert",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],aliases:["alert-circle"]};io.node;var Fe=m(io);var uo={name:"circle-check",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 9-5.5 5.5L8 12",key:"xofnsj"}]],aliases:["check-circle-2"]};uo.node;var xe=m(uo);var co={name:"circle-dashed",size:24,node:[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]]};co.node;var Ua=m(co);var fo={name:"circle-question-mark",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["help-circle","circle-help"]};fo.node;var Ee=m(fo);var po={name:"circle-x",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],aliases:["x-circle"]};po.node;var Pe=m(po);var mo={name:"clock",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]]};mo.node;var He=m(mo);var go={name:"cloud-off",size:24,node:[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};go.node;var za=m(go);var ho={name:"columns-3",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],aliases:["panels-left-right"]};ho.node;var ma=m(ho);var xo={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};xo.node;var _a=m(xo);var Lo={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};Lo.node;var Oe=m(Lo);var bo={name:"eye-off",size:24,node:[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};bo.node;var Ga=m(bo);var Io={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};Io.node;var Va=m(Io);var Co={name:"folder-git-2",size:24,node:[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]]};Co.node;var $a=m(Co);var So={name:"folder-search",size:24,node:[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]]};So.node;var Ma=m(So);var yo={name:"git-branch",size:24,node:[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]]};yo.node;var _e=m(yo);var wo={name:"git-merge",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]]};wo.node;var ra=m(wo);var vo={name:"git-pull-request-closed",size:24,node:[["path",{d:"m15.5 3.5 5 5",key:"1kmx7t"}],["path",{d:"m15.5 8.5 5-5",key:"saftza"}],["path",{d:"M18 11.62V15",key:"1greaj"}],["path",{d:"M6 9v12",key:"1sc30k"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}]]};vo.node;var sa=m(vo);var Po={name:"git-pull-request-draft",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};Po.node;var Ze=m(Po);var ko={name:"git-pull-request",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};ko.node;var Le=m(ko);var Ao={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};Ao.node;var Wa=m(Ao);var Ro={name:"layout-list",size:24,node:[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]]};Ro.node;var ja=m(Ro);var Mo={name:"link-2",size:24,node:[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]]};Mo.node;var Ge=m(Mo);var To={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};To.node;var V=m(To);var Do={name:"mail-open",size:24,node:[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]]};Do.node;var Je=m(Do);var No={name:"mail",size:24,node:[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]]};No.node;var na=m(No);var Bo={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};Bo.node;var ga=m(Bo);var Fo={name:"pen",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],aliases:["edit-2"]};Fo.node;var Ye=m(Fo);var Eo={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};Eo.node;var Ta=m(Eo);var Ho={name:"refresh-cw",size:24,node:[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]};Ho.node;var ke=m(Ho);var Oo={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Oo.node;var Da=m(Oo);var qo={name:"settings",size:24,node:[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};qo.node;var Xa=m(qo);var Uo={name:"shield-alert",size:24,node:[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]]};Uo.node;var Ka=m(Uo);var zo={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};zo.node;var qe=m(zo);var _o={name:"square-check-big",size:24,node:[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],aliases:["check-square"]};_o.node;var ha=m(_o);var Go={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};Go.node;var Ve=m(Go);var Vo={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};Vo.node;var ce=m(Vo);var $o={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};$o.node;var $e=m($o);var Wo={name:"users",size:24,node:[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]]};Wo.node;var Za=m(Wo);var jo={name:"wifi-off",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};jo.node;var Ja=m(jo);var Xo={name:"wifi",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]]};Xo.node;var wa=m(Xo);var Ko={name:"wrench",size:24,node:[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]]};Ko.node;var Ya=m(Ko);var Zo={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};Zo.node;var Se=m(Zo);var et={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},rt="standard",Qa={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},st="standard";function as(e){let t=e?.buildTisPreset??e?.tisPreset;return t&&t in et?t:rt}function Jo(e,t){let s=(e??"").toLowerCase();return s?(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function at(e,t,s,r){let i=Jo(e,t);if(i){let l=et[as(i)];return{warnHours:l.warnHours,dangerHours:l.dangerHours}}return{warnHours:s,dangerHours:r}}function It(e,t,s,r){let i=Jo(e,t);if(i){let l=i.reviewTisPreset&&i.reviewTisPreset in Qa?i.reviewTisPreset:st,n=Qa[l];return{warnDays:n.warnDays,dangerDays:n.dangerDays}}return{warnDays:s,dangerDays:r}}var Yo={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},Ct="organizations",va={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:Ct,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},Ae="monitoredCount",ie="monitoredPrs",Pa="settings",tt="prefetch:orgs",St="prefetch:repos",yt="prefetch:author",ts=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function wt(e){let t=ts.exec(e);if(!t)throw new Error(`Not a GitHub PR URL: ${e}`);return t[1]}var os={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function vt(e){return os[e]}var rs={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function Pt(e){return rs[e]}var ss=/\bW-\d{8}\b/i;function xa(e,t,s){for(let r of[e,t,s]){if(typeof r!="string"||!r)continue;let i=ss.exec(r);if(i)return i[0].toUpperCase()}}function nt(e,t){if(!e||!t||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(t)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${t.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var Qo=globalThis.__ZCC_HOST_REACT__,re=Qo.Fragment;function a(e,t,s){return Qo.createElement(e,s===void 0?t:{...t,key:s})}var o=a;function er({onSave:e}){let[t,s]=d(!1),r=async()=>{s(!0);try{await e({...va})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:o("div",{className:"prm-setup",children:[a(Le,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void r(),disabled:t,children:t?"Saving\u2026":"Get started"})})]})})}function We(e){let t=Date.now(),s=Math.max(0,t-e),r=Math.floor(s/1e3);if(r<60)return"just now";let i=Math.floor(r/60);if(i<60)return`${i}m ago`;let l=Math.floor(i/60);if(l<24)return`${l}h ago`;let n=Math.floor(l/24);if(n===1)return"yesterday";if(n<30)return`${n}d ago`;let u=Math.floor(n/30);return u<12?`${u}mo ago`:`${Math.floor(u/12)}y ago`}var ns={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function Ne(e){return ns[e]}function ar(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function lt(e){let t=0,s=0,r=0;for(let i of e){let l=i.state.toUpperCase();l==="SUCCESS"||l==="PASS"||l==="PASSED"?t++:l==="FAILURE"||l==="FAILED"||l==="ERROR"||l==="CANCELLED"?s++:r++}return{pass:t,fail:s,pending:r}}var ls={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function tr(e){return ls[e.toUpperCase()]??"pending"}function it(e){return{label:Ne(e),className:`prm-status-pill--${e}`}}var je=4,Xe=6,ka=3,Aa=5;function La(e){if(!e)return"";let t=Math.max(0,Date.now()-e),s=Math.floor(t/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function ba(e,t){let s=t==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function Ia(e){let t=e.name||e.login,s=t.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():t.slice(0,2).toUpperCase()}async function ye(e,t,s){try{let r=await e.call(t,s);if(!r?.ok)throw new Error(r?.error||"The request failed. Please try again.");Array.isArray(r.prs)&&(e.cache.set(ie,r.prs),e.cache.set(Ae,r.prs.length),e.cache.refreshBadge())}catch(r){e.toast(`Couldn't update PR \u2014 ${r instanceof Error?r.message:String(r)}`,"error")}}var is=new Set(["fail","failure"]),ds=new Set(["pending","in_progress","queued"]);function us(e){return(e??"").toLowerCase().trim()||"pending"}function cs(e,t){if(!t||t.length===0)return!1;let s=(e??"").toLowerCase();return t.some(r=>{let i=(r??"").toLowerCase();return i.length>0&&s.includes(i)})}function Na(e,t={}){if(!e||e.length===0)return!1;let s=t.ignoredFailingChecks;for(let r of e){let i=us(r.bucket||r.state);if(ds.has(i)||is.has(i)&&!cs(r.name,s))return!1}return!0}function Ba(e){let{status:t,buildHappy:s,reviewApproved:r,sfciGated:i,hasSfciJob:l,elapsedHours:n,warnHours:u,dangerHours:L}=e;if(t==="integrating"||t==="closed-merged"||t==="closed-abandoned")return"done";let g=i&&!l;return s&&r&&t==="yellow"?g?"blocked":n>=L?"merge-stall":n>=u?"warn":"ok":s?"done":g?"blocked":n>=L?"danger":n>=u?"warn":"ok"}function dt(e){let{reviewApproved:t,merged:s,elapsedDays:r,warnDays:i,dangerDays:l}=e;return t&&!s?"done":r>=l?"danger":r>=i?"warn":"ok"}function fs(e){if(typeof document>"u")return!1;let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.top="-9999px",t.setAttribute("readonly",""),document.body.appendChild(t);try{return t.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(t)}}async function Fa(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return fs(e)}var ps=Symbol.for("react.portal");function Ca(e,t){return{$$typeof:ps,key:null,children:e,containerInfo:t,implementation:null}}var ut=4,ct=8,or=120,ms=320,gs=280;function hs(e,t){let s=t.innerHeight-e.bottom-ut-ct,r=e.top-ut-ct,i=s<or&&r>s,l=Math.max(or,Math.min(ms,i?r:s)),n=Math.max(ct,Math.min(e.left,t.innerWidth-gs-ct));return i?{left:n,bottom:t.innerHeight-e.top+ut,maxHeight:l}:{left:n,top:e.bottom+ut,maxHeight:l}}function ft({projectId:e,projects:t,onAssign:s}){let r=ue(null),i=ue(null),[l,n]=d(!1),[u,L]=d(null),g=t.find(c=>c.id===e),C=!!g;z(()=>{if(!l)return;let c=r.current;c&&L(hs(c.getBoundingClientRect(),window))},[l]),z(()=>{if(!l||!u)return;let c=i.current;(c?.querySelector(".is-active")??c?.querySelector("button")??c)?.focus()},[l,u]);let S=()=>{n(!1),r.current?.focus()},b=C?`Associated with ${g.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return o(re,{children:[o("button",{ref:r,type:"button",className:`prm-project-row ${C?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:b,"aria-label":b,"aria-haspopup":"menu","aria-expanded":l,onClick:c=>{c.stopPropagation(),n(v=>!v)},children:[a($a,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:C?g.name:"Not associated with a project"})]}),l&&u&&typeof document<"u"&&Ca(o(re,{children:[a("div",{className:"prm-project-menu-backdrop",onClick:c=>{c.stopPropagation(),S()}}),o("div",{ref:i,className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...u},role:"menu","aria-label":"Associate a project",tabIndex:-1,onKeyDown:c=>{if(c.key==="Escape"||c.key==="Tab")c.preventDefault(),c.stopPropagation(),S();else if(["ArrowDown","ArrowUp","Home","End"].includes(c.key)){c.preventDefault(),c.stopPropagation();let v=Array.from(c.currentTarget.querySelectorAll("button")),h=v.indexOf(document.activeElement),f=c.key==="Home"?0:c.key==="End"?v.length-1:(h+(c.key==="ArrowDown"?1:-1)+v.length)%v.length;v[f]?.focus()}},children:[t.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),C&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:c=>{c.stopPropagation(),s(null),S()},children:"Clear association"}),t.map(c=>a("button",{type:"button",className:`prm-project-menu-item ${c.id===e?"is-active":""}`,role:"menuitem",onClick:v=>{v.stopPropagation(),s(c.id),S()},children:c.name},c.id))]})]}),document.body)]})}function pt({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(t=>{let s=tr(t.state);return o("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:t.name}),t.bucket&&a("span",{className:"prm-check-bucket",children:t.bucket}),a("span",{className:"prm-check-state",title:t.state,children:t.state.toLowerCase()})]},`${t.bucket??""}/${t.name}`)})})}function rr(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}var xs=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],Ls=["seen","favorite","mute","dismiss"];function sr({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:l,reviewDangerDays:n,sfciGated:u=!1,ignoredFailingChecks:L,workItemLocatorBase:g,selected:C,onToggleSelect:S,onDismiss:b,onProjectAssign:c}){let[v,h]=d(!1),[f,D]=d(!1),A=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),R=e.workItem??xa(e.title,e.headRefName,e.body),N=nt(R,g),U=it(e.status),W=e.status==="closed-merged"||e.status==="closed-abandoned",_=!!e.muted,F=!!e.favorite,$=!!e.syncError,w=e.checks??[],E=lt(w),X=e.reviewDecision==="APPROVED",J=e.buildHappy??Na(w,{ignoredFailingChecks:L}),P=Ba({status:e.status,buildHappy:J,reviewApproved:X,sfciGated:u,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??je,dangerHours:i??Xe}),pe=La(e.lastStatusChange),se=P==="merge-stall"||P==="danger"?"danger":P==="warn"?"warn":"ok",H=P==="done"?"Build \u2713":P==="merge-stall"?"Merge stalled":ba(se,"build"),be=P==="done"?"done":se,Re=!e.isDraft&&!W,M=e.status==="closed-merged",B=dt({reviewApproved:X,merged:M,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:l??ka,dangerDays:n??Aa}),T=La(e.reviewClockStartedAt),ae=B==="danger"?"danger":B==="warn"?"warn":"ok",ne=B==="done"?"Review \u2713":ba(ae,"review"),Ie=B==="done"?"done":ae,me=e.reviewers??[],ge={"changes-requested":me.filter(k=>k.state==="changes-requested"),"review-requested":me.filter(k=>k.state==="review-requested"),approved:me.filter(k=>k.state==="approved")},we=me.length>0,ea=()=>{rr(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ia=e.isDraft?Ze:e.status==="closed-merged"?ra:e.status==="closed-abandoned"?sa:Le,Sa=async()=>{A&&await ye(t,"markPrAsSeen",{url:e.url})},ve=async()=>{await ye(t,A?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},da=async()=>{await ye(t,"setPrMuted",{url:e.url,muted:!_})},Ke=async()=>{await ye(t,"setPrFavorite",{url:e.url,favorite:!F})},Q=async k=>{k.stopPropagation(),D(!0);try{await ye(t,"retryPr",{url:e.url})}finally{D(!1)}},ee=async(k,p)=>{await Fa(k)?t.toast(`${p} copied`,"info"):t.toast(`Failed to copy ${p}`,"error")},le=w.length>0,te=le?` \u2014 click to ${v?"hide":"show"} checks`:"",Y=k=>{k.stopPropagation(),h(p=>!p)},Ue=k=>{(k.key==="Enter"||k.key===" ")&&(k.preventDefault(),Y(k))},Me=k=>le?{role:"button",tabIndex:0,"aria-expanded":v,title:k,"data-tip":k,onClick:Y,onKeyDown:Ue}:{},fe=le?" prm-tip prm-checks-trigger":"",Te=`${U.label} \u2014 overall PR status${te}`,De=`${E.pass} passing, ${E.fail} failing, ${E.pending} running`,x=P==="done"?"Build passing":P==="merge-stall"?"Merge stalled":P==="blocked"?"Build waiting (SFCI job not yet created)":H||"Build running",I=`${x} \xB7 ${pe} in build phase \xB7 ${De}${te}`,y=B==="done"?"Review approved":ne||"Awaiting review",O=`${y} \xB7 ${T} in review${te}`,K=`${De}${te}`,he={seen:{Icon:A?Je:na,label:A?"Mark read":"Mark unread",title:A?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:Ve,label:F?"Unfavorite":"Favorite",title:F?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:F},mute:{Icon:_?ta:Be,label:_?"Unmute":"Mute",title:_?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:ce,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},Ce=k=>{k==="seen"?ve():k==="favorite"?Ke():k==="mute"?da():b(e.url)};return o("div",{className:`prm-tile ${A?"prm-tile--unread":""} ${W?"prm-tile--closed":""} ${$?"prm-tile--stale":""} ${F?"prm-tile--favorite":""} ${C?"prm-tile--selected":""}`,onClick:Sa,role:"button",tabIndex:0,onKeyDown:k=>{(k.key==="Enter"||k.key===" ")&&(k.preventDefault(),Sa())},children:[o("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:C,title:C?"Deselect this PR":"Select this PR","aria-label":C?"Deselect this PR":"Select this PR",onClick:k=>k.stopPropagation(),onChange:k=>{k.stopPropagation(),S(e.url)}}),a(ia,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),o("span",{className:"prm-tile-title",children:[R&&o("span",{className:"prm-tile-workitem-inline",children:["@",R,": "]}),e.title.replace(new RegExp(`(?:^|@)${R}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${U.className} prm-tip${fe}`,title:Te,"data-tip":Te,...Me(Te),children:U.label}),le?o("span",{className:`prm-tis prm-tis--${be} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":v,title:I,"data-tip":I,"aria-label":`${x}, ${pe} in build phase`,onClick:Y,onKeyDown:Ue,children:[pe,H&&o("span",{className:"prm-tis-cue",children:[" ",H]})]}):o("span",{className:`prm-tis prm-tis--${be} prm-tip`,title:I,"data-tip":I,"aria-label":`${x}, ${pe} in build phase`,children:[pe,H&&o("span",{className:"prm-tis-cue",children:[" ",H]})]}),Re&&(T||ne)&&(le?o("span",{className:`prm-tis prm-tis--review prm-tis--${Ie} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":v,title:O,"data-tip":O,"aria-label":`${y}, ${T} in review`,onClick:Y,onKeyDown:Ue,children:[T,ne&&o("span",{className:"prm-tis-cue",children:[" ",ne]})]}):o("span",{className:`prm-tis prm-tis--review prm-tis--${Ie} prm-tip`,title:O,"data-tip":O,"aria-label":`${y}, ${T} in review`,children:[T,ne&&o("span",{className:"prm-tis-cue",children:[" ",ne]})]})),w.length>0&&o("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${E.pass} passed, ${E.fail} failed, ${E.pending} running`,...Me(K),children:[E.pass>0&&o("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(ze,{size:9})," ",E.pass]}),E.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(Se,{size:9})," ",E.fail]}),E.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(He,{size:9})," ",E.pending]})]}),_&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(ta,{size:11})}),$&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(Fe,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:f,onClick:k=>void Q(k),children:a(ke,{size:10,className:f?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:Ls.map(k=>{let p=he[k],q=p.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${p.danger?" prm-tile-icon-btn--danger":""}${p.active?" prm-tile-icon-btn--active":""}`,title:p.title,"data-tip":p.label,"aria-label":p.label,"aria-pressed":p.active,onClick:G=>{G.stopPropagation(),Ce(k)},children:a(q,{size:13,...p.active?{fill:"currentColor"}:{}})},k)})})]}),o("div",{className:"prm-tile-line2",children:[R&&(N?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${R}`,onClick:k=>{k.stopPropagation(),rr(N)&&t.openExternal(N)},children:R}):a("span",{className:"prm-workitem-chip",children:R})),a("span",{className:"prm-tile-repo",children:e.repo}),o("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:k=>{k.stopPropagation(),ea()},children:a(Oe,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:k=>{k.stopPropagation(),ee(e.url,"PR link")},children:a(Ge,{size:10})})]}),e.author&&o("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:Ia(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-tile-line3",children:[a(_e,{size:10,className:"prm-branch-icon","aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:k=>{k.stopPropagation(),ee(e.headRefName,"Branch name")},children:a(Ge,{size:10})})]}),we&&a("div",{className:"prm-reviewers",children:xs.map(({state:k,label:p,className:q})=>{let G=ge[k];return G.length===0?null:o("span",{className:`prm-reviewers-group ${q}`,title:p,children:[a("span",{className:"prm-reviewers-label",children:p}),G.map(de=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:de.name||de.login,"aria-label":`${p}: ${de.name||de.login}`,children:Ia(de)},de.login))]},k)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(ft,{projectId:e.projectId,projects:s,onAssign:k=>c(e.url,k)}),v&&w.length>0&&a("div",{className:"prm-tile-checks",onClick:k=>k.stopPropagation(),children:a(pt,{checks:w})})]})}function nr({anchorRef:e,hosts:t,selectedHosts:s,onClose:r,onToggleHost:i,onSelectAll:l,shortHost:n}){let[u,L]=d(null);if(z(()=>{let C=e.current;if(!C)return;let S=C.getBoundingClientRect();L({top:S.bottom+4,left:S.left})},[e]),z(()=>{let C=S=>{S.key==="Escape"&&r()};return window.addEventListener("keydown",C),()=>window.removeEventListener("keydown",C)},[r]),!u||typeof document>"u")return null;let g=s.length===0;return Ca(o(re,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:C=>{C.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-host-filter",style:{position:"fixed",top:u.top,left:u.left},role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),o("button",{type:"button",className:`prm-project-menu-item ${g?"is-active":""}`,role:"menuitemcheckbox","aria-checked":g,onClick:C=>{C.stopPropagation(),l()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:g&&a(ze,{size:12})}),"All hosts"]}),t.map(C=>{let S=s.includes(C);return o("button",{type:"button",className:`prm-project-menu-item ${S?"is-active":""}`,role:"menuitemcheckbox","aria-checked":S,onClick:b=>{b.stopPropagation(),i(C)},title:`Filter to ${C}`,children:[a("span",{className:"prm-sync-filter-check",children:S&&a(ze,{size:12})}),n(C)]},C)})]})]}),document.body)}var bs='button, a, input, textarea, select, [contenteditable="true"]';function lr(e){return!e||typeof e.closest!="function"?!1:e.closest(bs)!==null}function ir(e,t,s){return{left:e.left-(t-e.x),top:e.top-(s-e.y)}}function kt(){let e=ue(null),[t,s]=d(!1),r=Z(n=>{let u=e.current;!u||u.id!==n.pointerId||(e.current=null,s(!1),n.currentTarget.hasPointerCapture(n.pointerId)&&n.currentTarget.releasePointerCapture(n.pointerId))},[]),i=Z(n=>{n.button!==0||lr(n.target)||(e.current={id:n.pointerId,x:n.clientX,y:n.clientY,left:n.currentTarget.scrollLeft,top:n.currentTarget.scrollTop},n.currentTarget.setPointerCapture(n.pointerId),s(!0))},[]),l=Z(n=>{let u=e.current;if(!u||u.id!==n.pointerId)return;let L=ir(u,n.clientX,n.clientY);n.currentTarget.scrollLeft=L.left,n.currentTarget.scrollTop=L.top},[]);return{isPanning:t,canvasPanProps:{onPointerDown:i,onPointerMove:l,onPointerUp:r,onPointerCancel:r}}}var At=`.zcc-kanban {
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
`;function Cs(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function dr({children:e,className:t="",label:s,columnWidth:r}){let{isPanning:i,canvasPanProps:l}=kt();return a("div",{role:"list","aria-label":s,className:["zcc-kanban",i?"is-panning":"",t].filter(Boolean).join(" "),style:Cs(r),...l,children:e})}function ur({children:e,className:t="",columnId:s,label:r,count:i,icon:l,badge:n,collapsed:u=!1,onToggleCollapse:L,onContextMenu:g,onDragOver:C,onDragLeave:S,onDrop:b}){let c=u?`Expand ${r}`:`Collapse ${r}`;return o("section",{role:"listitem",className:["zcc-kanban-col",u?"is-collapsed":"",t].filter(Boolean).join(" "),"aria-label":`${r} (${i})`,"data-kanban-column":s,"data-board-column":s,"data-collapsed":u?"true":"false",onContextMenu:g,onDragOver:C,onDragLeave:S,onDrop:b,children:[o("header",{className:"zcc-kanban-col-header",children:[l?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:l}):null,a("span",{className:"zcc-kanban-col-title",children:r}),a("span",{className:"zcc-kanban-col-count",children:i}),n,L?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:c,"aria-label":c,"aria-expanded":!u,onClick:()=>L(s),children:u?a(oa,{size:13}):a(ga,{size:13})}):null]}),u?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}var Rt=["conflict","failed","yellow","review-required","pending","integrating","green"],cr=["closed-merged","closed-abandoned"],fr={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function Mt(e){return e==="list"||e==="board"}function Ss(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function mt(e){let t=Ss();for(let s of e)t[s.status].push(s);return t}function pr(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var mr=[...Rt,...cr];function gr(e){return typeof e=="string"&&mr.includes(e)}function hr(e,t={}){let s=pr(e);return t.showEmpty?[...Rt,...cr.filter(r=>s[r]>0)]:mr.filter(r=>s[r]>0)}function xr(e){let t=pr(e);return Rt.filter(s=>t[s]===0).length}function Lr(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function ys(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function ws(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function br({pr:e,host:t,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:i,selected:l,selectionActive:n=!1,selectMode:u=!1,onToggleSelect:L,onDismiss:g,onOpen:C}){let[S,b]=d(!1),c=ws(e),v=e.status==="closed-merged"||e.status==="closed-abandoned",h=!!e.favorite,f=!!e.syncError,D=e.workItem??xa(e.title,e.headRefName,e.body),A=D?e.title.replace(new RegExp(`(?:^|@)${D}[:\\s]*`,"i"),""):e.title,R=e.checks??[],N=lt(R),U=e.updatedAt||e.lastChecked||e.lastStatusChange,W=e.buildHappy??Na(R,{ignoredFailingChecks:i}),_=Ba({status:e.status,buildHappy:W,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??je,dangerHours:r??Xe}),F=_==="merge-stall"?"Merge stalled":_==="warn"||_==="danger"?ba(_,"build"):"",$=_==="merge-stall"||_==="danger"?"danger":_==="warn"?"warn":"",w=l||u||n,E=async()=>{c&&await ye(t,"markPrAsSeen",{url:e.url})},X=async()=>{await ye(t,"setPrFavorite",{url:e.url,favorite:!h})},J=()=>{ys(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},P=async()=>{b(!0);try{await ye(t,"retryPr",{url:e.url})}finally{b(!1)}},pe=()=>{C(e.url),E()},se=H=>{if(H.metaKey||H.ctrlKey||u){L(e.url);return}pe()};return o("article",{className:["prm-board-card",c?"prm-board-card--unread":"",v?"prm-board-card--closed":"",h?"prm-board-card--favorite":"",l?"prm-board-card--selected":"",f?"prm-board-card--stale":"",w?"prm-board-card--selectable":"",u?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:se,onPointerDown:H=>H.stopPropagation(),onKeyDown:H=>{H.target===H.currentTarget&&(H.key==="Enter"||H.key===" ")&&(H.preventDefault(),u||H.metaKey||H.ctrlKey?L(e.url):pe())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[o("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:l,title:l?"Deselect this PR":"Select this PR","aria-label":l?"Deselect this PR":"Select this PR",onClick:H=>H.stopPropagation(),onChange:H=>{H.stopPropagation(),L(e.url)}}),o("span",{className:"prm-board-card-id",children:[o("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",title:e.repo,children:Lr(e.repo)})]}),D&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:D}),o("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${h?" prm-tile-icon-btn--active":""}`,title:h?"Unfavorite":"Favorite","data-tip":h?"Unfavorite":"Favorite","aria-label":h?"Unfavorite":"Favorite","aria-pressed":h,onClick:H=>{H.stopPropagation(),X()},children:a(Ve,{size:12,...h?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:H=>{H.stopPropagation(),J()},children:a(Oe,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:H=>{H.stopPropagation(),g(e.url)},children:a(ce,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:A}),o("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:Ia(e.author)}),F?o("span",{className:`prm-tis prm-tis--${$} prm-board-card-stall`,children:[La(e.lastStatusChange)," ",F]}):U>0&&a("span",{className:"prm-board-card-time",children:We(U)}),N.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${N.fail} checks failing`,children:[a(Se,{size:9})," ",N.fail]}),N.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${N.pending} checks running`,children:[a(He,{size:9})," ",N.pending]}),e.isDraft&&o("span",{className:"prm-draft-pill prm-board-card-draft",children:[a(Ze,{size:10,"aria-hidden":!0})," Draft"]}),f&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(Fe,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:S,onClick:H=>{H.stopPropagation(),P()},children:a(ke,{size:10,className:S?"prm-spin":""})})]})]})]})}var vs={conflict:Ka,failed:Pe,yellow:$e,"review-required":Va,pending:Ua,integrating:V,green:xe,"closed-merged":ra,"closed-abandoned":sa};function Ir({prs:e,host:t,tisWarnHours:s,tisDangerHours:r,repositories:i,selected:l,selectMode:n=!1,showEmpty:u=!1,collapsed:L,onToggleCollapse:g,onToggleSelect:C,onDismiss:S,onOpen:b}){let c=oe(()=>mt(e),[e]),v=oe(()=>hr(c,{showEmpty:u}),[c,u]),h=l.size>0||n;return a(dr,{label:"Pull requests by status",className:"prm-board",children:v.map(f=>{let D=c[f],A=vs[f],R=L.has(f),N=D.filter(U=>U.lastSeenAt===0||U.lastStatusChange>(U.lastSeenAt??U.addedAt)).length;return a(ur,{columnId:f,className:`prm-board-col--${f}`,label:fr[f],count:D.length,icon:a(A,{size:14,"aria-hidden":!0}),badge:N>0?a("span",{className:"zcc-kanban-col-badge",title:`${N} unread`,children:N}):null,collapsed:R,onToggleCollapse:U=>g(U),children:D.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):D.map(U=>{let W=at(U.repo,i,s??je,r??Xe),_=(i??[]).find(F=>`${F.owner}/${F.repo}`.toLowerCase()===U.repo.toLowerCase());return a(br,{pr:U,host:t,tisWarnHours:W.warnHours,tisDangerHours:W.dangerHours,ignoredFailingChecks:_?.ignoredFailingChecks,selected:l.has(U.url),selectionActive:h,selectMode:n,onToggleSelect:C,onDismiss:S,onOpen:b},U.url)})},f)})})}var Ps=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function Cr(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function ks(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function Sr({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:l,reviewDangerDays:n,sfciGated:u=!1,ignoredFailingChecks:L,workItemLocatorBase:g,onClose:C,onDismiss:S,onProjectAssign:b}){let[c,v]=d(!1),h=ue(null),f=ue(C);f.current=C,z(()=>{let Q=document.activeElement;h.current?.focus();let ee=le=>{if(!le.defaultPrevented&&(le.key==="Escape"&&(le.preventDefault(),f.current()),le.key==="Tab")){let te=h.current,Y=te?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]');if(!te||!Y?.length)return;let Ue=Y[0],Me=Y[Y.length-1];le.shiftKey&&(document.activeElement===Ue||document.activeElement===te)?(le.preventDefault(),Me.focus()):!le.shiftKey&&(document.activeElement===Me||document.activeElement===te)&&(le.preventDefault(),Ue.focus())}};return window.addEventListener("keydown",ee),()=>{window.removeEventListener("keydown",ee),Q?.isConnected&&Q.focus()}},[]);let D=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),A=e.status==="closed-merged"||e.status==="closed-abandoned",R=!!e.muted,N=!!e.favorite,U=!!e.syncError,W=e.workItem??xa(e.title,e.headRefName,e.body),_=nt(W,g),F=W?e.title.replace(new RegExp(`(?:^|@)${W}[:\\s]*`,"i"),""):e.title,$=it(e.status),w=e.checks??[],E=e.reviewers??[],X={"changes-requested":E.filter(Q=>Q.state==="changes-requested"),"review-requested":E.filter(Q=>Q.state==="review-requested"),approved:E.filter(Q=>Q.state==="approved")},J=ks(e),P=e.reviewDecision==="APPROVED",pe=e.buildHappy??Na(w,{ignoredFailingChecks:L}),se=Ba({status:e.status,buildHappy:pe,reviewApproved:P,sfciGated:u,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??je,dangerHours:i??Xe}),H=La(e.lastStatusChange),be=se==="merge-stall"||se==="danger"?"danger":se==="warn"?"warn":"ok",Re=se==="done"?"Build \u2713":se==="merge-stall"?"Merge stalled":ba(be,"build"),M=se==="done"?"done":be,B=!e.isDraft&&!A,T=dt({reviewApproved:P,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:l??ka,dangerDays:n??Aa}),ae=La(e.reviewClockStartedAt),ne=T==="danger"?"danger":T==="warn"?"warn":"ok",Ie=T==="done"?"Review \u2713":ba(ne,"review"),me=T==="done"?"done":ne,ge=e.isDraft?Ze:e.status==="closed-merged"?ra:e.status==="closed-abandoned"?sa:Le,we=()=>{Cr(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ea=async(Q,ee)=>{await Fa(Q)?t.toast(`${ee} copied`,"info"):t.toast(`Failed to copy ${ee}`,"error")},ia=async()=>{await ye(t,D?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},Sa=async()=>{await ye(t,"setPrMuted",{url:e.url,muted:!R})},ve=async()=>{await ye(t,"setPrFavorite",{url:e.url,favorite:!N})},da=async()=>{v(!0);try{await ye(t,"retryPr",{url:e.url})}finally{v(!1)}},Ke=a("div",{className:"modal-backdrop",onClick:C,"data-testid":"prm-detail-backdrop",children:o("div",{ref:h,tabIndex:-1,className:"modal prm-modal prm-modal--detail",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-detail-title",onClick:Q=>Q.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:"prm-detail-title",children:[a(ge,{size:14,"aria-hidden":!0}),o("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:C,title:"Close","aria-label":"Close PR details",children:a(Se,{size:14})})]}),o("div",{className:"prm-modal-body prm-detail-body",children:[o("div",{className:"prm-detail-heading",children:[W&&(_?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${W}`,onClick:()=>{Cr(_)&&t.openExternal(_)},children:W}):a("span",{className:"prm-workitem-chip",children:W})),a("h4",{className:"prm-detail-pr-title",children:F})]}),o("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${$.className}`,children:$.label}),e.isDraft&&o("span",{className:"prm-draft-pill",children:[a(Ze,{size:10,"aria-hidden":!0})," Draft"]}),R&&o("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(ta,{size:11,"aria-hidden":!0})," Muted"]}),H&&o("span",{className:`prm-tis prm-tis--${M}`,children:[H,Re&&o("span",{className:"prm-tis-cue",children:[" ",Re]})]}),B&&(ae||Ie)&&o("span",{className:`prm-tis prm-tis--review prm-tis--${me}`,children:[ae,Ie&&o("span",{className:"prm-tis-cue",children:[" ",Ie]})]})]}),J&&a("div",{className:"prm-detail-hint",children:J}),o("dl",{className:"prm-detail-facts",children:[e.author&&o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),o("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:Ia(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:We(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:We(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:We(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Branches"}),o("div",{className:"prm-detail-branch",children:[a(_e,{size:12,"aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>void ea(e.headRefName,"Branch name"),children:a(Ge,{size:10})})]})]}),e.body&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Description preview"}),a("div",{className:"prm-detail-desc",children:e.body}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-detail-description-link",onClick:we,children:["Read full description on GitHub ",a(Oe,{size:12,"aria-hidden":!0})]})]}),E.length>0&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:Ps.map(({state:Q,label:ee,className:le})=>{let te=X[Q];return te.length===0?null:o("span",{className:`prm-reviewers-group ${le}`,title:ee,children:[a("span",{className:"prm-reviewers-label",children:ee}),te.map(Y=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:Y.name||Y.login,"aria-label":`${ee}: ${Y.name||Y.login}`,children:Ia(Y)},Y.login))]},Q)})})]}),o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Checks"}),a(pt,{checks:w})]}),U&&o("div",{className:"prm-detail-sync-error",children:[a(Fe,{size:12,"aria-hidden":!0}),o("span",{children:["Couldn't sync this PR: ",e.syncError]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:c,"aria-label":"Retry syncing this PR",onClick:()=>void da(),children:[a(ke,{size:11,className:c?"prm-spin":""})," Retry"]})]}),a("div",{className:"prm-detail-section",children:a(ft,{projectId:e.projectId,projects:s,onAssign:Q=>b(e.url,Q)})})]}),o("footer",{className:"prm-modal-footer prm-detail-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:we,title:"Open on GitHub",children:[a(Oe,{size:13}),a("span",{children:"Open on GitHub"})]}),o("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>void ea(e.url,"PR link"),children:[a(Ge,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${N?" prm-tile-icon-btn--active":""}`,title:N?"Unfavorite":"Favorite","data-tip":N?"Unfavorite":"Favorite","aria-label":N?"Unfavorite":"Favorite","aria-pressed":N,onClick:()=>void ve(),children:a(Ve,{size:13,...N?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:R?"Unmute":"Mute","data-tip":R?"Unmute":"Mute","aria-label":R?"Unmute":"Mute",onClick:()=>void Sa(),children:R?a(ta,{size:13}):a(Be,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:D?"Mark this PR as read":"Mark this PR as unread","data-tip":D?"Mark read":"Mark unread","aria-label":D?"Mark read":"Mark unread",onClick:()=>void ia(),children:D?a(Je,{size:13}):a(na,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>S(e.url),children:a(ce,{size:13})})]})]})});return typeof document<"u"?Ca(Ke,document.body):Ke}var As=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],vr=["closed-merged","closed-abandoned"],Rs=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function Ms(e,t){let s=e.favorite?1:0,r=t.favorite?1:0;return s!==r?r-s:t.lastStatusChange-e.lastStatusChange}function gt(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Ts(e,t){return e.length>0&&e.every(r=>{let i=t.find(l=>l.url===r);return i?!!i.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function Ds(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Ns(e){let t=e.workItem??xa(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),Ne(e.status),e.headRefName??"",e.baseRefName??"",t,e.repo,Ds(e.repo)].join("").toLowerCase()}var yr="boardShowEmpty",wr="boardCollapsed";function Pr({prs:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:l,reviewDangerDays:n,repositories:u,workItemLocatorBase:L,sortField:g,sortDir:C,onSortChange:S,hostScope:b,onHostScopeChange:c,awaitingFirstSync:v,syncing:h,autoSyncEnabled:f,onDismiss:D,onProjectAssign:A,onBulkSetSeen:R,onBulkDismiss:N,onBulkSetFavorite:U,viewMode:W="list",onViewModeChange:_}){let[F,$]=d("all"),[w,E]=d(""),[X,J]=d(new Set),[P,pe]=d(!1),[se,H]=d(W),[be,Re]=d(!1),[M,B]=d(!1),[T,ae]=d(()=>new Set),[ne,Ie]=d(null),me=ue(null),ge=_?W:se,we=p=>{p==="board"&&$("all"),p==="list"&&Re(!1),_?_(p):H(p)};z(()=>{let p=!0;return t.storage.get(yr).then(q=>{p&&typeof q=="boolean"&&B(q)}),t.storage.get(wr).then(q=>{!p||!Array.isArray(q)||ae(new Set(q.filter(gr)))}),()=>{p=!1}},[t]);let ea=p=>{B(p),t.storage.set(yr,p)},ia=p=>{ae(q=>{let G=new Set(q);return G.has(p)?G.delete(p):G.add(p),t.storage.set(wr,[...G]),G})},Sa=oe(()=>{let p=[];for(let q of e){let G=wt(q.url);p.includes(G)||p.push(G)}return p},[e]),ve=oe(()=>{if(b.length===0)return e;let p=new Set(b);return e.filter(q=>p.has(wt(q.url)))},[e,b]),da=oe(()=>{let p=new Map;for(let q of ve)p.set(q.status,(p.get(q.status)??0)+1);return p},[ve]),Ke=oe(()=>F==="all"?ve:ve.filter(p=>p.status===F),[ve,F]),Q=oe(()=>{let p=w.trim().toLowerCase();return p?Ke.filter(q=>Ns(q).includes(p)):Ke},[Ke,w]),ee=oe(()=>{let p=C==="asc"?1:-1,q=[...Q];return g==="favorites"?(q.sort(Ms),q):(q.sort((G,de)=>{let aa=0;switch(g){case"created":aa=(G.createdAt??0)-(de.createdAt??0);break;case"status":aa=Pt(G.status)-Pt(de.status);break;case"statusUpdated":aa=G.lastStatusChange-de.lastStatusChange;break;case"updated":default:aa=(G.updatedAt||G.lastChecked||G.lastStatusChange)-(de.updatedAt||de.lastChecked||de.lastStatusChange);break}if(aa===0){let Ot=gt(G)?1:0,qt=gt(de)?1:0;return Ot!==qt?qt-Ot:(de.createdAt??0)-(G.createdAt??0)}return aa*p}),q)},[Q,g,C]),le=oe(()=>xr(mt(ee)),[ee]),te=ne?e.find(p=>p.url===ne):void 0;z(()=>{ne&&!te&&Ie(null)},[ne,te]);let Y=oe(()=>{if(!te)return null;let p=at(te.repo,u,r??je,i??Xe),q=It(te.repo,u,l??ka,n??Aa),G=(u??[]).find(de=>`${de.owner}/${de.repo}`.toLowerCase()===te.repo.toLowerCase());return{tisWarnHours:p.warnHours,tisDangerHours:p.dangerHours,reviewWarnDays:q.warnDays,reviewDangerDays:q.dangerDays,sfciGated:G?.sfciGated===!0,ignoredFailingChecks:G?.ignoredFailingChecks}},[te,u,r,i,l,n]),Ue=oe(()=>ve.filter(gt).length,[ve]),Me=oe(()=>ee.map(p=>p.url),[ee]),fe=oe(()=>Me.filter(p=>X.has(p)),[Me,X]),Te=ee.length>0&&fe.length===ee.length,De=fe.length>0&&!Te,x=p=>{J(q=>{let G=new Set(q);return G.has(p)?G.delete(p):G.add(p),G})},I=()=>{J(Te||De?new Set:new Set(Me))},y=()=>J(new Set),O=fe.length>0?fe:Me,K=O.every(p=>{let q=e.find(G=>G.url===p);return q?!gt(q):!0}),he=Ts(fe,e);if(e.length===0){if(v){let p=h||f;return o("div",{className:"prm-empty",children:[p?a(V,{size:32,className:"prm-spin","aria-hidden":!0}):a(Le,{size:32,"aria-hidden":!0}),a("h3",{children:p?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:p?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return o("div",{className:"prm-empty",children:[a(Le,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let k=o("div",{className:"prm-list-toolbar",children:[o("div",{className:"prm-list-controls",children:[o("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":ge==="list",title:"List view",onClick:()=>we("list"),children:[a(ja,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":ge==="board",title:"Board view",onClick:()=>we("board"),children:[a(ma,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),ge==="list"&&a("label",{className:"prm-select-all",title:Te?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:Te,ref:p=>{p&&(p.indeterminate=De)},onChange:I,"aria-label":Te?"Clear selection":"Select all shown PRs"})}),ge==="list"&&o("span",{className:"prm-shown-count","aria-live":"polite",children:[ee.length," shown"]}),o("div",{className:"prm-search",children:[a(Da,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:w,onChange:p=>E(p.target.value),"aria-label":"Search PRs"})]}),o("button",{type:"button",ref:me,className:`prm-btn prm-btn--sm ${b.length>0?"is-active":""}`,onClick:()=>pe(p=>!p),title:"Filter by host","aria-expanded":P,children:[a(Wa,{size:12}),o("span",{children:["Host",b.length>0&&o("span",{className:"prm-unread-count",children:[" (",b.length,")"]})]}),a(ya,{size:12})]}),P&&a(nr,{anchorRef:me,hosts:Sa,selectedHosts:b,onClose:()=>pe(!1),onToggleHost:p=>c(b.includes(p)?b.filter(q=>q!==p):[...b,p]),onSelectAll:()=>c([]),shortHost:ar}),ge==="board"&&o(re,{children:[o("button",{type:"button",className:`prm-btn prm-btn--sm ${be?"is-active":""}`,"aria-pressed":be,title:"Select cards for bulk actions",onClick:()=>Re(p=>!p),children:[a(ha,{size:12}),a("span",{children:"Select"})]}),le>0&&o("button",{type:"button",className:`prm-btn prm-btn--sm ${M?"is-active":""}`,"aria-pressed":M,title:M?"Hide empty columns":`Show ${le} empty column${le===1?"":"s"}`,onClick:()=>ea(!M),children:[a(Ga,{size:12}),a("span",{children:M?"Hide empty":`Empty (${le})`})]})]}),ge==="list"&&o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>R(O,!K),title:fe.length>0?`Mark the ${fe.length} selected PR(s) ${K?"unread":"read"}`:`Mark all shown PRs ${K?"unread":"read"}`,children:[a(Je,{size:12}),o("span",{children:[K?"Mark unread":"Mark read",Ue>0&&o("span",{className:"prm-unread-count",children:[" (",Ue,")"]})]})]}),ge==="list"&&o("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:g,onChange:p=>S(p.target.value,C),"aria-label":"Sort field",children:Rs.map(p=>a("option",{value:p.id,title:p.title,children:p.label},p.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>S(g,C==="asc"?"desc":"asc"),disabled:g==="favorites",title:g==="favorites"?"Favorites first uses a fixed order":C==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":C==="asc"?"Sorted ascending":"Sorted descending",children:C==="asc"?a(qa,{size:12}):a(Ha,{size:12})})]})]}),ge==="list"&&o("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[o("button",{type:"button",role:"tab","aria-selected":F==="all",className:`prm-segment-tab ${F==="all"?"active":""}`,onClick:()=>$("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:ve.length})]}),As.map(p=>{let q=da.get(p)??0;return o("button",{type:"button",role:"tab","aria-selected":F===p,className:`prm-segment-tab prm-segment-tab--${p} ${F===p?"active":""}`,onClick:()=>$(p),title:`Show PRs in "${Ne(p)}"`,children:[Ne(p)," ",a("span",{className:"prm-segment-count",children:q})]},p)})]}),fe.length>0&&o("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:y,title:"Clear selection","aria-label":"Clear selection",children:a(Se,{size:12})}),o("span",{className:"prm-bulk-count",children:[fe.length," selected"]}),o("div",{className:"prm-bulk-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>R(fe,!K),title:`Mark the selected PR(s) ${K?"unread":"read"}`,children:[K?a(na,{size:12}):a(Je,{size:12}),a("span",{children:K?"Mark unread":"Mark read"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>U(fe,he.favorite),title:`${he.label} the selected PR(s)`,children:[a(Ve,{size:12,...he.favorite?{}:{fill:"currentColor"}}),a("span",{children:he.label})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{N(fe),y()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(ce,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return o("div",{className:`prm-list${ge==="board"?" prm-list--board":""}`,children:[k,ee.length===0?o("div",{className:"prm-empty prm-empty--filtered",children:[a(Da,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:w.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),o("div",{className:"prm-empty-actions",children:[w.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>E(""),title:"Clear search",children:"Clear search"}),F!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>$("all"),title:"Show all PRs",children:"Show all"})]})]}):ge==="board"?a(Ir,{prs:ee,host:t,tisWarnHours:r,tisDangerHours:i,repositories:u,selected:X,selectMode:be,showEmpty:M,collapsed:T,onToggleCollapse:ia,onToggleSelect:x,onDismiss:D,onOpen:Ie}):a("div",{className:"prm-tile-list",children:ee.map(p=>{let q=at(p.repo,u,r??je,i??Xe),G=It(p.repo,u,l??ka,n??Aa),de=(u??[]).find(aa=>`${aa.owner}/${aa.repo}`.toLowerCase()===p.repo.toLowerCase());return a(sr,{pr:p,host:t,projects:s,tisWarnHours:q.warnHours,tisDangerHours:q.dangerHours,reviewWarnDays:G.warnDays,reviewDangerDays:G.dangerDays,sfciGated:de?.sfciGated===!0,ignoredFailingChecks:de?.ignoredFailingChecks,workItemLocatorBase:L,selected:X.has(p.url),onToggleSelect:x,onDismiss:D,onProjectAssign:A},p.url)})}),te&&Y&&a(Sr,{pr:te,host:t,projects:s,tisWarnHours:Y.tisWarnHours,tisDangerHours:Y.tisDangerHours,reviewWarnDays:Y.reviewWarnDays,reviewDangerDays:Y.reviewDangerDays,sfciGated:Y.sfciGated,ignoredFailingChecks:Y.ignoredFailingChecks,workItemLocatorBase:L,onClose:()=>Ie(null),onDismiss:p=>{Ie(null),D(p)},onProjectAssign:A})]})}function kr({host:e,onClose:t,onPulled:s}){let[r,i]=d([]),[l,n]=d(!1),[u,L]=d(""),[g,C]=d(""),[S,b]=d(!1),[c,v]=d(null),h=ue(null);z(()=>{let A=!0;return e.call("listRepos").then(R=>{if(!A)return;let N=(R?.repos??[]).filter(U=>U.active&&U.connection==="connected");i(N),N.length>0&&L(`${N[0].host}|${N[0].owner}/${N[0].repo}`),n(!0)}).catch(()=>{A&&n(!0)}),()=>{A=!1}},[e]),z(()=>{let A=R=>{R.key==="Escape"&&!S&&t()};return window.addEventListener("keydown",A),()=>window.removeEventListener("keydown",A)},[t,S]);let f=oe(()=>r.find(A=>`${A.host}|${A.owner}/${A.repo}`===u),[r,u]),D=async()=>{v(null);let A=Number(g.trim());if(!f){v("Select a repository.");return}if(!Number.isFinite(A)||A<=0){v("Enter a valid PR number.");return}b(!0);try{let R=await e.call("pullPr",{host:f.host,fullName:`${f.owner}/${f.repo}`,number:A});R?.ok&&Array.isArray(R.prs)?s(R.prs):v(R?.error||"Failed to pull PR.")}catch(R){v(R instanceof Error?R.message:String(R))}finally{b(!1)}};return a("div",{className:"modal-backdrop",onClick:()=>!S&&t(),children:o("div",{className:"modal prm-modal",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-pull-title",onClick:A=>A.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:"prm-pull-title",children:[a(Le,{size:14,"aria-hidden":!0})," Add PR"]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:t,title:"Close",children:a(Se,{size:14})})]}),o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),l&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):o("select",{className:"prm-input prm-input--select",value:u,onChange:A=>L(A.target.value),disabled:S||!l,"aria-label":"Repository",children:[!l&&a("option",{children:"Loading\u2026"}),r.map(A=>{let R=`${A.host}|${A.owner}/${A.repo}`;return o("option",{value:R,children:[A.owner,"/",A.repo," (",A.shortHost,")"]},R)})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{ref:h,type:"number",min:1,value:g,placeholder:"e.g. 42",className:"prm-input",onChange:A=>{C(A.target.value),c&&v(null)},onKeyDown:A=>{A.key==="Enter"&&!S&&(A.preventDefault(),D())},disabled:S||r.length===0})]}),c&&a("div",{className:"prm-modal-error",children:c})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void D(),disabled:S||r.length===0||!g.trim(),title:"Add this PR to the monitored list",children:[S?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:S,title:"Cancel without adding",children:"Cancel"})]})]})})}function Ar({anchorRef:e,host:t,selectedRepos:s,onClose:r,onToggleRepo:i,onSelectAll:l,onSync:n}){let[u,L]=d(null),[g,C]=d([]);if(z(()=>{let b=e.current;if(!b)return;let c=b.getBoundingClientRect();L({top:c.bottom+4,left:c.right})},[e]),z(()=>{let b=!0;return t.call("listRepos").then(c=>{b&&C((c?.repos??[]).filter(v=>v.active&&v.connection==="connected"))}).catch(()=>{}),()=>{b=!1}},[t]),z(()=>{let b=c=>{c.key==="Escape"&&r()};return window.addEventListener("keydown",b),()=>window.removeEventListener("keydown",b)},[r]),!u||typeof document>"u")return null;let S=s.length===0;return Ca(o(re,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:b=>{b.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-sync-filter",style:{position:"fixed",top:u.top,left:u.left,transform:"translateX(-100%)"},role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),o("button",{type:"button",className:`prm-project-menu-item ${S?"is-active":""}`,role:"menuitemcheckbox","aria-checked":S,onClick:b=>{b.stopPropagation(),l()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:S&&a(ze,{size:12})}),"All repositories"]}),g.map(b=>{let c=`${b.owner}/${b.repo}`,v=s.includes(c);return o("button",{type:"button",className:`prm-project-menu-item ${v?"is-active":""}`,role:"menuitemcheckbox","aria-checked":v,onClick:h=>{h.stopPropagation(),i(c)},title:`Filter/sync ${c}`,children:[a("span",{className:"prm-sync-filter-check",children:v&&a(ze,{size:12})}),c," ",o("span",{className:"prm-sync-filter-host",children:["(",b.shortHost,")"]})]},`${b.host}|${c}`)}),a("div",{className:"prm-tile-menu-divider"}),o("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{n(s),r()},title:S?"Sync all repositories now":"Sync the selected repositories now",children:S?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Qe({title:e,subtitle:t,actions:s}){return o("header",{className:"prm-area-header",children:[o("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:t})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function ht({state:e}){return e==="checking"?o("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(V,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(xe,{size:11})," Connected"]}):o("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(Pe,{size:11})," Disconnected"]})}function la({title:e,icon:t,onClose:s,busy:r,footer:i,children:l,wide:n}){return z(()=>{let u=L=>{L.key==="Escape"&&!r&&s()};return window.addEventListener("keydown",u),()=>window.removeEventListener("keydown",u)},[s,r]),a("div",{className:"modal-backdrop",onClick:()=>!r&&s(),children:o("div",{className:`modal prm-modal${n?" prm-modal--wide":""}`,role:"dialog","aria-modal":!0,onClick:u=>u.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{children:[t," ",e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close",children:a(Se,{size:14})})]}),l]})})}function xt({title:e,message:t,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:i,busy:l,onConfirm:n,onCancel:u}){return o(la,{title:e,onClose:u,busy:l,children:[a("div",{className:"prm-modal-body",children:t}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:u,disabled:l,children:r}),o("button",{type:"button",className:`prm-btn ${i?"prm-btn--danger":"prm-btn--primary"}`,onClick:n,disabled:l,children:[l?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function Rr({host:e}){let[t,s]=d(()=>{let f=e.cache.get(tt);return f?.ok&&Array.isArray(f.orgs)?f.orgs:null}),[r,i]=d(null),[l,n]=d(!1),[u,L]=d(null),[g,C]=d(!1),[S,b]=d(!1),c=Z(async()=>{try{let f=await e.call("listOrgs");f?.ok&&Array.isArray(f.orgs)?(s(f.orgs),i(null)):(s([]),f?.error&&i(f.error))}catch(f){s([]),i(f instanceof Error?f.message:String(f))}},[e]);z(()=>{c()},[c]);let v=async()=>{n(!0),i(null);try{let f=await e.call("rediscoverOrgs");!f?.ok&&f?.error&&i(f.error),await c()}catch(f){i(f instanceof Error?f.message:String(f))}finally{n(!1)}},h=async()=>{if(u){C(!0);try{let f=await e.call("deleteOrg",{host:u.host,login:u.login});!f?.ok&&f?.error&&e.toast(f.error,"error"),await c()}catch(f){e.toast(f instanceof Error?f.message:String(f),"error")}finally{C(!1),L(null)}}};return o("div",{className:"prm-area",children:[a(Qe,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:o(re,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void v(),disabled:l,title:"Re-discover organizations from your gh accounts",children:[l?a(V,{size:13,className:"prm-spin"}):a(qe,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>b(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(Ee,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),t===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):t.length===0?o("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:t.map(f=>o("div",{className:"prm-entity-card",children:[o("div",{className:"prm-entity-main",children:[o("div",{className:"prm-entity-title",children:[f.login," ",o("span",{className:"prm-entity-host",children:["(",f.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:f.apiBaseUrl}),o("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:f.login})]})]}),o("div",{className:"prm-entity-side",children:[a(ht,{state:l?"checking":f.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>L(f),title:"Delete organization",children:a(ce,{size:15})})]})]},`${f.host}|${f.login}`))}),S&&o(la,{title:"Adding & removing organizations",icon:a(Ee,{size:16}),onClose:()=>b(!1),children:[o("div",{className:"prm-modal-body prm-help-body",children:[o("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),o("ul",{children:[o("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),o("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),o("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),o("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>b(!1),children:a("span",{children:"Got it"})})})]}),u&&a(xt,{title:"Delete organization?",danger:!0,busy:g,message:o(re,{children:["Delete ",a("strong",{children:u.login})," (",u.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>void h(),onCancel:()=>L(null)})]})}function Bs(e,t){try{let s=new URL(t);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(t)}catch{}}function Mr(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function Fs(e,t){await Fa(t)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Tr({host:e,onRepositoriesChanged:t}){let[s,r]=d(()=>{let w=e.cache.get(St);return w?.ok&&Array.isArray(w.repos)?w.repos:null}),[i,l]=d(()=>{let w=e.cache.get(tt);return w?.ok&&Array.isArray(w.orgs)?w.orgs:[]}),[n,u]=d(null),[L,g]=d(!1),[C,S]=d(!1),[b,c]=d(!1),[v,h]=d(null),[f,D]=d("general"),[A,R]=d(null),[N,U]=d(null),[W,_]=d(!1),F=Z(async()=>{try{let[w,E]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);w?.ok&&Array.isArray(w.repos)?(r(w.repos),u(null)):(r([]),w?.error&&u(w.error)),l(E?.ok&&Array.isArray(E.orgs)?E.orgs:[])}catch(w){r([]),u(w instanceof Error?w.message:String(w))}},[e]);z(()=>{F()},[F]);let $=async()=>{if(N){_(!0);try{await e.call("deleteRepository",{host:N.host,owner:N.owner,repo:N.repo}),await F()}catch(w){e.toast(w instanceof Error?w.message:String(w),"error")}finally{_(!1),U(null)}}};return o("div",{className:"prm-area",children:[a(Qe,{title:"Repositories",subtitle:"Manage your connected repositories",actions:o(re,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>S(!0),children:[a(qe,{size:13})," ",a("span",{children:"Suggested for you"})]}),o("button",{type:"button",className:"prm-btn",onClick:()=>c(!0),children:[a(Ma,{size:13})," ",a("span",{children:"Browse Repositories"})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>g(!0),children:[a(Ta,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),n&&a("div",{className:"prm-error",children:n}),s===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?o("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(w=>o("div",{className:"prm-entity-card prm-repo-card",children:[o("div",{className:"prm-repo-top",children:[o("div",{className:"prm-entity-title",children:[a(_e,{size:14,"aria-hidden":!0})," ",o("span",{children:[w.owner,"/",w.repo]}),a("span",{className:`prm-active-badge${w.active?"":" prm-active-badge--off"}`,children:w.active?"Active":"Inactive"}),a(ht,{state:w.connection}),(()=>{let E=et[w.buildTisPreset??w.tisPreset??rt],X=Qa[w.reviewTisPreset??st];return o(re,{children:[o("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${E.warnHours}h, behind schedule after ${E.dangerHours}h`,children:[a(He,{size:11,"aria-hidden":!0}),"Build: ",E.label]}),o("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${X.warnDays}d, behind schedule after ${X.dangerDays}d`,children:[a(He,{size:11,"aria-hidden":!0}),"Review: ",X.label]})]})})()]}),o("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>Bs(e,Mr(w)),children:a(Oe,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>void Fs(e,Mr(w)),children:a(Ge,{size:14})})]})]}),o("div",{className:"prm-entity-sub prm-repo-meta",children:[o("span",{children:["Organization: ",w.orgLogin," (",w.shortHost,")"]}),o("span",{children:["Created ",We(w.createdAt)]})]}),o("div",{className:"prm-repo-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>R(w),children:[a(wa,{size:12})," ",a("span",{children:"Test Connection"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{D("general"),h(w)},children:[a(Ye,{size:12})," ",a("span",{children:"Edit Repository"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{D("status"),h(w)},title:"Status Settings",children:[a(He,{size:12})," ",a("span",{children:"Status Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{D("notifications"),h(w)},title:"Notification Settings",children:[a(Be,{size:12})," ",a("span",{children:"Notification Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>U(w),children:[a(ce,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${w.host}|${w.owner}/${w.repo}`))}),L&&a(Es,{host:e,orgs:i,onClose:()=>g(!1),onAdded:async()=>{g(!1),await F()}}),C&&a(Hs,{host:e,onClose:()=>S(!1),onAdded:async()=>{await F()}}),b&&a(Os,{host:e,onClose:()=>c(!1),onAdded:async()=>{await F()}}),v&&a(qs,{host:e,repo:v,orgs:i,initialTab:f,onClose:()=>h(null),onSaved:async w=>{h(null),Array.isArray(w)&&(e.cache.set(ie,w),e.cache.set(Ae,w.length),e.cache.refreshBadge()),t?.(),await F()}}),A&&a(Us,{host:e,repo:A,onClose:()=>R(null),onResult:w=>{let E=w?"connected":"disconnected";r(X=>(X??[]).map(J=>J.host===A.host&&J.owner===A.owner&&J.repo===A.repo?{...J,connection:E}:J))}}),N&&a(xt,{title:"Delete repository?",danger:!0,busy:W,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>void $(),onCancel:()=>U(null)})]})}function Es({host:e,orgs:t,onClose:s,onAdded:r}){let[i,l]=d(""),[n,u]=d(t[0]?`${t[0].host}|${t[0].login}`:""),[L,g]=d(null),[C,S]=d(!1),b=async()=>{let c=t.find(v=>`${v.host}|${v.login}`===n);if(!c){g("Please select an organization.");return}S(!0),g(null);try{let v=await e.call("addRepository",{ref:i.trim(),host:c.host,orgLogin:c.login});v?.ok?r():g(v?.error||"Failed to add repository.")}catch(v){g(v instanceof Error?v.message:String(v))}finally{S(!1)}};return o(la,{title:"Add repository",icon:a(Ta,{size:14}),onClose:s,busy:C,children:[o("div",{className:"prm-modal-body",children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:i,spellCheck:!1,onChange:c=>{l(c.target.value),L&&g(null)},onKeyDown:c=>{c.key==="Enter"&&!C&&(c.preventDefault(),b())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),o("select",{className:"prm-input prm-input--select",value:n,onChange:c=>u(c.target.value),children:[t.length===0&&a("option",{value:"",children:"No organizations"}),t.map(c=>o("option",{value:`${c.host}|${c.login}`,children:[c.login," (",c.shortHost,")"]},`${c.host}|${c.login}`))]})]}),L&&a("div",{className:"prm-modal-error",children:L})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:C,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void b(),disabled:C||!i.trim(),children:[C?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function Hs({host:e,onClose:t,onAdded:s}){let[r,i]=d(null),[l,n]=d(new Set),[u,L]=d(null),[g,C]=d(!1),S=Z(async()=>{i(null),L(null);try{let h=await e.call("suggestRepositories");h?.ok&&Array.isArray(h.repos)?(i(h.repos),n(new Set(h.repos.filter(f=>f.alreadyAdded).map(f=>f.fullName)))):(i([]),h?.error&&L(h.error))}catch(h){i([]),L(h instanceof Error?h.message:String(h))}},[e]);z(()=>{S()},[S]);let b=h=>{h.alreadyAdded||n(f=>{let D=new Set(f);return D.has(h.fullName)?D.delete(h.fullName):D.add(h.fullName),D})},c=async()=>{if(!r)return;let h=r.filter(f=>!f.alreadyAdded&&l.has(f.fullName));if(h.length!==0){C(!0);try{await e.call("addRepositories",{repos:h.map(f=>({owner:f.owner,repo:f.repo,host:f.host,orgLogin:f.orgLogin}))}),await s(),t()}catch(f){e.toast(f instanceof Error?f.message:String(f),"error")}finally{C(!1)}}},v=r?r.filter(h=>!h.alreadyAdded&&l.has(h.fullName)).length:0;return o(la,{title:"Suggested for you",icon:a(qe,{size:14}),onClose:t,busy:g,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):u?a("div",{className:"prm-modal-error",children:u}):r.length===0?o("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(h=>o("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:l.has(h.fullName),disabled:h.alreadyAdded,onChange:()=>b(h)}),o("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:h.fullName}),o("span",{className:"prm-entity-sub",children:[h.prCount," PRs \xB7 ",We(h.lastActivity)]})]}),h.alreadyAdded&&o("span",{className:"prm-suggested-added",children:[a(xe,{size:13})," Already added"]})]},h.fullName))})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void S(),disabled:g||r===null,children:[a(qe,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:g,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void c(),disabled:g||v===0,children:[g?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:g?"Adding\u2026":v>0?`Add ${v} Selected`:"Add Selected"})]})]})]})}function Os({host:e,onClose:t,onAdded:s}){let[r,i]=d(""),[l,n]=d(null),[u,L]=d(!0),[g,C]=d(!1),[S,b]=d(!1),[c,v]=d(1),[h,f]=d(null),[D,A]=d(new Set),[R,N]=d(new Set),[U,W]=d(new Set),[_,F]=d(!1),$=Z(async(M,B)=>{B?C(!0):L(!0),f(null);try{let T=await e.call("listAllRepositories",{page:M}),ae=T?.ok&&Array.isArray(T.repos)?T.repos:[];b(!!T?.hasMore),W(new Set(Array.isArray(T?.incompleteOwners)?T.incompleteOwners:[])),n(ne=>{if(!B||!ne)return ae;let Ie=new Set(ne.map(me=>`${me.host}|${me.fullName}`));return[...ne,...ae.filter(me=>!Ie.has(`${me.host}|${me.fullName}`))]}),T&&T.ok===!1&&T.error&&f(T.error)}catch(T){f(T instanceof Error?T.message:String(T)),B||n([])}finally{L(!1),C(!1)}},[e]);z(()=>{$(1,!1)},[$]);let w=()=>{let M=c+1;v(M),$(M,!0)},E=l??[],X=r.trim().toLowerCase(),J=X?E.filter(M=>M.fullName.toLowerCase().includes(X)):E,P=M=>{A(B=>{let T=new Set(B);return T.has(M)?T.delete(M):T.add(M),T})},pe=M=>{N(B=>{let T=new Set(B);return T.has(M)?T.delete(M):T.add(M),T})},se=M=>`${M.host}|${M.fullName}`,H=(()=>{let M=new Map;for(let B of J){let T=M.get(B.owner)??[];T.push(B),M.set(B.owner,T)}return Array.from(M.entries())})(),be=async()=>{let M=J.filter(B=>!B.alreadyAdded&&D.has(se(B)));if(M.length!==0){F(!0);try{await e.call("addRepositories",{repos:M.map(B=>({owner:B.owner,repo:B.repo,host:B.host,orgLogin:B.owner}))}),await s(),t()}catch(B){e.toast(B instanceof Error?B.message:String(B),"error")}finally{F(!1)}}},Re=J.filter(M=>!M.alreadyAdded&&D.has(se(M))).length;return o(la,{title:"Browse Repositories",icon:a(Ma,{size:14}),onClose:t,busy:_,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:M=>i(M.target.value)})}),h&&a("div",{className:"prm-modal-error",children:h}),u?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):o("div",{className:"prm-browse-list",children:[H.map(([M,B])=>{let T=!R.has(M);return o("div",{className:"prm-browse-group",children:[o("button",{type:"button",className:"prm-browse-group-header",onClick:()=>pe(M),"aria-expanded":T,children:[a(oa,{size:13,className:`prm-disclosure${T?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:M}),o("span",{className:"prm-browse-group-count",title:!X&&U.has(M)?`${B.length} loaded \u2014 more available, use Load more`:void 0,children:["(",B.length,!X&&U.has(M)?"\u2026":"",")"]})]}),T&&B.map(ae=>ae.alreadyAdded?o("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[o("span",{children:[a(_e,{size:13,"aria-hidden":!0})," ",ae.fullName,ae.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(xe,{size:11,"aria-hidden":!0})," Connected"]})]},se(ae)):o("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:D.has(se(ae)),onChange:()=>P(se(ae))}),o("span",{children:[a(_e,{size:13,"aria-hidden":!0})," ",ae.fullName,ae.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},se(ae)))]},M)}),J.length===0&&a("div",{className:"prm-area-empty",children:X?"No repositories match your filter.":"No repositories found."}),S&&!X&&o("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:w,disabled:g,children:[g?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:g?"Loading\u2026":"Load more"})]})]})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:_,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void be(),disabled:_||Re===0,children:[_?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:Re>0?`Add ${Re} Selected`:"Add Selected"})]})]})]})}function qs({host:e,repo:t,orgs:s,initialTab:r="general",onClose:i,onSaved:l}){let[n,u]=d(r),[L,g]=d(`${t.owner}/${t.repo}`),[C,S]=d(t.orgLogin),[b,c]=d(t.active),[v,h]=d(t.buildTisPreset??t.tisPreset??rt),[f,D]=d(t.reviewTisPreset??st),[A,R]=d(t.sfciGated===!0),[N,U]=d((t.ignoredFailingChecks??[]).some(P=>P.toLowerCase().includes("snyk"))),[W,_]=d(t.notifyInApp??!0),[F,$]=d(null),[w,E]=d(!1),X=s.filter(P=>P.host===t.host),J=async()=>{E(!0),$(null);try{let P=await e.call("updateRepository",{key:{host:t.host,owner:t.owner,repo:t.repo},ref:L.trim(),orgLogin:C,active:b,buildTisPreset:v,reviewTisPreset:f,sfciGated:A,ignoredFailingChecks:N?["Snyk"]:[],notifyInApp:W});P?.ok?l(P.prs):$(P?.error||"Failed to save settings.")}catch(P){$(P instanceof Error?P.message:String(P))}finally{E(!1)}};return o(la,{title:o("span",{className:"prm-dialog-title",children:["Repository Settings ",o("span",{className:"prm-entity-sub",children:[t.owner,"/",t.repo]})]}),icon:a(Ye,{size:14}),onClose:i,busy:w,children:[o("nav",{className:"prm-dialog-tabs",children:[o("button",{type:"button",className:`prm-dialog-tab${n==="general"?" active":""}`,onClick:()=>u("general"),children:[a(Ye,{size:12})," General"]}),o("button",{type:"button",className:`prm-dialog-tab${n==="status"?" active":""}`,onClick:()=>u("status"),children:[a(He,{size:12})," Status"]}),o("button",{type:"button",className:`prm-dialog-tab${n==="notifications"?" active":""}`,onClick:()=>u("notifications"),children:[a(Be,{size:12})," Notifications"]})]}),o("div",{className:"prm-modal-body",children:[n==="general"?o(re,{children:[o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:b,onChange:P=>c(P.target.checked)}),o("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:L,spellCheck:!1,onChange:P=>g(P.target.value)})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:C,onChange:P=>S(P.target.value),children:X.map(P=>o("option",{value:P.login,children:[P.login," (",P.shortHost,")"]},P.login))})]})]}):n==="status"?o(re,{children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:v,onChange:P=>h(P.target.value),children:Object.values(et).map(P=>o("option",{value:P.id,children:[P.label," (",P.warnHours,"h / ",P.dangerHours,"h)"]},P.id))})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:f,onChange:P=>D(P.target.value),children:Object.values(Qa).map(P=>o("option",{value:P.id,children:[P.label," (",P.warnDays,"d / ",P.dangerDays,"d)"]},P.id))})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:A,onChange:P=>R(P.target.checked)}),o("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:N,onChange:P=>U(P.target.checked)}),o("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:W,onChange:P=>_(P.target.checked)}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),F&&a("div",{className:"prm-modal-error",children:F})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:i,disabled:w,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void J(),disabled:w,children:[w?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function Us({host:e,repo:t,onClose:s,onResult:r}){let[i,l]=d(null);return z(()=>{let n=!0;return(async()=>{try{let L=await e.call("testRepository",{host:t.host,owner:t.owner,repo:t.repo})??{ok:!1,error:"No response"};n&&(l(L),r?.(L.ok))}catch(u){n&&(l({ok:!1,error:u instanceof Error?u.message:String(u)}),r?.(!1))}})(),()=>{n=!1}},[e,t]),o(la,{title:`Connection Test Results: ${t.owner}/${t.repo}`,icon:a(wa,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:i===null?o("div",{className:"prm-loading",children:[a(wa,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):i.ok?o("div",{className:"prm-test-result prm-test-result--ok",children:[a(xe,{size:16})," All connection tests passed."]}):o("div",{className:"prm-test-result prm-test-result--fail",children:[a(Pe,{size:16}),o("div",{children:[a("div",{children:i.error||"Connection failed."}),o("div",{className:"prm-field-hint",children:["Try ",o("code",{children:["gh auth login ",t.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function zs(e){let t=e.trim().split(/\s+/).filter(Boolean);return t.length===0?"?":t.length===1?t[0].slice(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}function Dr({host:e}){let[t,s]=d(()=>{let g=e.cache.get(yt);return g?.ok?g.author??null:void 0}),[r,i]=d(null),[l,n]=d(!1),u=Z(async()=>{try{let g=await e.call("getAuthor");g?.ok?(s(g.author??null),i(null)):(s(null),g?.error&&i(g.error))}catch(g){s(null),i(g instanceof Error?g.message:String(g))}},[e]);z(()=>{u()},[u]);let L=t?.name||t?.login||"";return o("div",{className:"prm-area",children:[a(Qe,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),t===void 0?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading author\u2026"]}):t===null?o("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:o("div",{className:"prm-entity-card prm-author-card",children:[o("button",{type:"button",className:"prm-author-row",onClick:()=>n(g=>!g),"aria-expanded":l,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:zs(L)}),o("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:L}),t.email&&a("span",{className:"prm-entity-sub",children:t.email})]}),a(oa,{size:16,className:`prm-disclosure${l?" is-open":""}`,"aria-hidden":!0})]}),l&&o("div",{className:"prm-author-detail",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:L||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:t.email||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:t.identities.map(g=>o("div",{className:"prm-identity-row",children:[o("span",{children:[g.login," ",o("span",{className:"prm-entity-host",children:["(",g.shortHost,")"]})]}),g.connection==="connected"?a(xe,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):o("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(Pe,{size:13})," Disconnected"]})]},`${g.host}|${g.login}`))})]})]})]})})]})}function Nr({settings:e,update:t}){let s=e.notifyInApp??e.notifyOnChange;return o("div",{className:"prm-area",children:[a(Qe,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>t({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>t({sendToInbox:r.target.checked})}),o("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>t({badgeMode:"unread"})}),o("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>t({badgeMode:"total"})}),o("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var Br=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],_s=15;function Fr(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function Gs(e,t){let s=Math.max(0,e-t),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let i=Math.floor(r/60),l=r%60;return l?`in ${i}h ${l}m`:`in ${i}h`}function Er({settings:e,update:t,host:s}){let[r,i]=d(()=>s.cache.get(ie)??[]),[l,n]=d(!1),[u,L]=d(()=>Date.now());z(()=>{let h=window.setInterval(()=>{let f=s.cache.get(ie);f&&i(D=>D===f?D:f),L(Date.now())},1e3);return()=>window.clearInterval(h)},[s]);let g=e.autoSyncEnabled??!0,C=Br.some(h=>h.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:_s,S=r.reduce((h,f)=>Math.max(h,f.lastChecked||0),0),b=g&&S?S+C*6e4:0,c=new Set(r.map(h=>h.repo)).size,v=async()=>{n(!0);try{let h=await s.call("pollAll");h?.ok&&Array.isArray(h.prs)&&(i(h.prs),s.cache.set(ie,h.prs))}catch(h){s.toast(h instanceof Error?h.message:String(h),"error")}finally{n(!1)}};return o("div",{className:"prm-area",children:[a(Qe,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:g,onChange:h=>t({autoSyncEnabled:h.target.checked})}),o("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),o("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:C,onChange:h=>{let f=Number(h.target.value);Number.isFinite(f)&&t({pollIntervalMinutes:f})},children:Br.map(h=>a("option",{value:h.value,children:h.label},h.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),o("div",{className:"prm-sync-status",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:b?o(re,{children:[Gs(b,u)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Fr(b)]})]}):"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:S?o(re,{children:[We(S)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Fr(S)]})]}):""})]}),o("div",{className:"prm-sync-counts",children:[o("span",{className:"prm-sync-count",children:[a("strong",{children:c})," repositories checked"]}),o("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>void v(),disabled:l,children:[l?a(V,{size:13,className:"prm-spin"}):a(ke,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var Vs=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:pa},{id:"repositories",label:"Repositories",icon:fa},{id:"author",label:"Author",icon:Za}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:Be}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:Ya}]}];function Hr({settings:e,onSave:t,onRepositoriesChanged:s,host:r}){let[i,l]=d(e.settingsActiveNav??Ct),n=L=>{let g={...e,...L};t(g),r.cache.set("settings",g),r.cache.refreshBadge()},u=L=>{l(L),n({settingsActiveNav:L})};return a("div",{className:"prm-settings-shell",children:o("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:Vs.map(L=>o("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:L.label}),L.items.map(g=>{let C=g.icon;return o("button",{type:"button",className:`prm-nav-row${i===g.id?" active":""}`,"aria-current":i===g.id,onClick:()=>u(g.id),children:[a(C,{size:15,"aria-hidden":!0}),a("span",{children:g.label})]},g.id)})]},L.label))}),o("div",{className:"prm-settings-pane",children:[i==="organizations"&&a(Rr,{host:r}),i==="repositories"&&a(Tr,{host:r,onRepositoriesChanged:s}),i==="author"&&a(Dr,{host:r}),i==="notifications"&&a(Nr,{settings:e,update:n}),i==="system"&&a(Er,{settings:e,update:n,host:r})]})]})})}function Or(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function qr(e,t,s){return e===1?t:s}function Ur(e){if(!e)return null;let t=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return t.length>0?{kind:"disconnect",subjects:t,action:"settings",message:`GitHub sign-in expired for ${Or(t)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${qr(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${qr(r.length,"is","is")} temporarily unreachable for ${Or(r)} \u2014 retrying automatically.`}:null}function $s(e,t){let s=(e.repo??"").toLowerCase();if(s)return(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function zr(e,t){let s=$s(e,t.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let l=t.notifyInApp??t.notifyOnChange??!1,n=t.sendToInbox??!1;return{inApp:l,inbox:n&&!!e.projectId}}function _r(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function Ws(e){try{let t=new URL(e);if(t.protocol!=="http:"&&t.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function Vr(e,t,s){for(let r of t){let i=vt(r.newStatus)>vt(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||i))continue;let n=zr(r.pr,s);if(!n.inApp&&!n.inbox)continue;let u=_r(r.pr.repo),L=_r(r.pr.title),g=Ws(r.pr.url),C=g?`[${L}](${g})`:L;if(n.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${Ne(r.oldStatus)} \u2192 ${Ne(r.newStatus)}`,"info"),n.inbox&&r.pr.projectId){let S=`**${u}#${r.pr.number}** \u2014 ${Ne(r.oldStatus)} \u2192 **${Ne(r.newStatus)}**

${C}`;try{await e.pushInbox({comments:S,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var Tt="activeSubTab",$r="listSort",Wr="hostScope",Dt="listView";function Nt({host:e}){let[t,s]=d(null),[r,i]=d(!1),[l,n]=d(()=>e.cache.get(ie)??[]),[u,L]=d(!1),[g,C]=d(null),[S,b]=d("prs"),[c,v]=d(!1),[h,f]=d(null),[D,A]=d(0),[R,N]=d(!1),[U,W]=d(!1),[_,F]=d(!1),[$,w]=d([]),[E,X]=d("status"),[J,P]=d("asc"),[pe,se]=d([]),[H,be]=d("board"),[Re,M]=d(!1),[B,T]=d(()=>({...Yo})),ae=ue(null),ne=ue(!0);z(()=>(ne.current=!0,()=>{ne.current=!1}),[]);let[Ie,me]=d(()=>e.listProjects());z(()=>{let x=!0;return f(null),v(!1),Promise.all([e.storage.get(Pa),e.storage.get(Tt),e.call("listPrs"),e.storage.get($r),e.storage.get(Wr),e.storage.get(Dt)]).then(([I,y,O,K,he,Ce])=>{if(!x)return;K?.field&&X(K.field),K?.dir&&P(K.dir),Array.isArray(he)&&se(he),Mt(Ce)&&be(Ce);let k=I?{...va,...I,relevanceModes:{...va.relevanceModes,...I.relevanceModes}}:null;s(k),k&&(e.cache.set("settings",k),e.cache.refreshBadge?.()),y==="prs"||y==="settings"?b(y):(y==="board"||y==="list")&&(b("prs"),Mt(Ce)||(be(y),e.storage.set(Dt,y)),e.storage.set(Tt,"prs")),Array.isArray(O)&&(n(O),e.cache.set(ie,O),e.cache.set(Ae,O.length),e.cache.refreshBadge?.()),i(!0),v(!0),F(!0)}).catch(I=>{x&&(console.error("pr-monitor hydrate failed",I),f(I instanceof Error?I.message:String(I)),v(!0))}),()=>{x=!1}},[e,D]),z(()=>{let x=()=>{let y=e.cache.get(ie);y&&n(K=>K===y?K:y);let O=e.listProjects();me(K=>K.length===O.length&&K.every((he,Ce)=>he.id===O[Ce].id&&he.name===O[Ce].name&&he.path===O[Ce].path)?K:O)},I=window.setInterval(x,100);return()=>window.clearInterval(I)},[e]);let ge=x=>{b(x),e.storage.set(Tt,x)},we=Z(async x=>{L(!0),C(null);try{let I=Array.isArray(x)&&x.length>0,O=I?await e.call("syncRepos",{repos:x}):await e.call("pollAll"),K=Date.now()+3e5;for(;(O.state==="running"||O.state==="queued")&&ne.current&&Date.now()<K;)await new Promise(k=>window.setTimeout(k,250)),O=await e.call("syncStatus",{id:O.id});if((O.state===void 0||O.state==="succeeded")&&Array.isArray(O.prs)){if(n(O.prs),e.cache.set(ie,O.prs),e.cache.set(Ae,O.prs.length),e.cache.refreshBadge?.(),Array.isArray(O.deltas)&&O.deltas.length>0){let k=t??{...va,...await e.storage.get(Pa)};await Vr(e,O.deltas,k)}}else!ne.current||Date.now()>=K?C("Sync is still running. Check back shortly."):O?.error&&C(O.error);let Ce=O?.health;!I&&Ce&&T(Ce)}catch(I){C(I instanceof Error?I.message:String(I))}finally{L(!1),M(!0)}},[e]),ea=ue(!1);z(()=>{!_||ea.current||(ea.current=!0,e.call("getSyncHealth").then(x=>{x?.ok&&x.health&&T(x.health)}).catch(()=>{}),we())},[_,we,e]);let ia=Z(async(x,I)=>{try{let y=await e.call("resolveRemoteGone",{repo:x,action:I});if(!y?.ok){e.toast(`Couldn't ${I} ${x} \u2014 ${y?.error??"unknown error"}`,"error");return}T(O=>({...O,remoteGone:O.remoteGone.filter(K=>K.toLowerCase()!==x.toLowerCase()),keptGone:I==="keep"?[...O.keptGone,x].filter((K,he,Ce)=>Ce.indexOf(K)===he):O.keptGone})),we()}catch(y){e.toast(`Couldn't ${I} ${x} \u2014 ${y instanceof Error?y.message:String(y)}`,"error")}},[e,we]),Sa=Z(async x=>{try{let I=await e.call("removePr",x);I?.ok&&Array.isArray(I.prs)&&(n(I.prs),e.cache.set(ie,I.prs),e.cache.set(Ae,I.prs.length),e.cache.refreshBadge?.())}catch(I){e.toast(`Couldn't remove PR \u2014 ${I instanceof Error?I.message:String(I)}`,"error")}},[e]),ve=Z(async x=>{let I=l.find(y=>y.url===x);if(I)try{let y;I.source==="auto"?y=await e.call("dismissPr",{url:x}):y=await e.call("removePr",x),y?.ok&&Array.isArray(y.prs)&&(n(y.prs),e.cache.set(ie,y.prs),e.cache.set(Ae,y.prs.length),e.cache.refreshBadge?.())}catch(y){e.toast(`Couldn't dismiss PR \u2014 ${y instanceof Error?y.message:String(y)}`,"error")}},[e,l]),da=Z(async x=>{s(x);let I=await e.storage.get(Pa),y={...x};I&&(y.organizations=I.organizations,y.repositories=I.repositories,y.author=I.author,y.orgDiscovered=I.orgDiscovered,y.authorDiscovered=I.authorDiscovered),await e.storage.set(Pa,y),e.cache.set("settings",y),e.cache.refreshBadge?.()},[e]),Ke=Z(async()=>{let x=await e.storage.get(Pa);x?.repositories&&s(I=>I&&{...I,repositories:x.repositories})},[e]),Q=Z(async(x,I)=>{try{let y=await e.call("assignProject",x,I);y?.ok&&Array.isArray(y.prs)&&(n(y.prs),e.cache.set(ie,y.prs))}catch(y){e.toast(`Couldn't assign project \u2014 ${y instanceof Error?y.message:String(y)}`,"error")}},[e]),ee=Z((x,I)=>{X(x),P(I),e.storage.set($r,{field:x,dir:I})},[e]),le=Z(x=>{se(x),e.storage.set(Wr,x)},[e]),te=Z(x=>{be(x),e.storage.set(Dt,x)},[e]),Y=Z(async(x,I)=>{if(x.length!==0)try{let y=await e.call("setPrsSeen",{urls:x,seen:I});y?.ok&&Array.isArray(y.prs)&&(n(y.prs),e.cache.set(ie,y.prs),e.cache.set("monitoredCount",y.prs.length),e.cache.refreshBadge?.())}catch(y){e.toast(`Couldn't update read state \u2014 ${y instanceof Error?y.message:String(y)}`,"error")}},[e]),Ue=Z(async(x,I)=>{if(x.length!==0)try{let y=await e.call("setPrsFavorite",{urls:x,favorite:I});y?.ok&&Array.isArray(y.prs)&&(n(y.prs),e.cache.set(ie,y.prs))}catch(y){e.toast(`Couldn't update favorites \u2014 ${y instanceof Error?y.message:String(y)}`,"error")}},[e]),Me=Z(async x=>{if(x.length!==0)try{let I=await e.call("dismissPrs",{urls:x});I?.ok&&Array.isArray(I.prs)&&(n(I.prs),e.cache.set(ie,I.prs),e.cache.set(Ae,I.prs.length),e.cache.refreshBadge?.())}catch(I){e.toast(`Couldn't dismiss PRs \u2014 ${I instanceof Error?I.message:String(I)}`,"error")}},[e]),fe=oe(()=>{if($.length===0)return l;let x=new Set($.map(I=>I.toLowerCase()));return l.filter(I=>x.has(I.repo.toLowerCase()))},[l,$]),Te=oe(()=>fe.filter(x=>vr.includes(x.status)).map(x=>x.url),[fe]),De=oe(()=>Ur(B),[B]);return c?h!==null?a("section",{className:"prm-panel",children:o("div",{className:"prm-empty",role:"alert",children:[a($e,{size:28,"aria-hidden":!0}),a("h3",{children:"Couldn't load PR Monitor"}),a("p",{children:h}),o("button",{type:"button",className:"prm-btn",onClick:()=>A(x=>x+1),children:[a(ke,{size:13,"aria-hidden":!0})," Retry loading"]})]})}):t?o("section",{className:"prm-panel",children:[o("header",{className:"prm-header",children:[o("div",{className:"prm-header-title",children:[a(Le,{size:16,className:"prm-header-icon","aria-hidden":!0}),o("div",{className:"prm-header-heading",children:[a("h2",{children:S==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:S==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),S==="prs"&&a("span",{className:"prm-count-pill",children:fe.length})]}),o("div",{className:"prm-header-actions",children:[S==="prs"&&o(re,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>N(!0),title:"Add a specific pull request to the monitored list",children:[a(_a,{size:13})," ",a("span",{children:"Add PR"})]}),Te.length>0&&o("button",{type:"button",className:"prm-btn",onClick:()=>void Me(Te),title:`Sweep \u2014 dismiss the ${Te.length} Merged/Closed PR(s) from the list`,children:[a(ce,{size:13})," ",a("span",{children:"Sweep"})]}),o("div",{className:"prm-split-btn",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>void we($),disabled:u,title:$.length>0?`Sync the ${$.length} selected repositor${$.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[u?a(V,{size:13,className:"prm-spin"}):a(ke,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:ae,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>W(x=>!x),disabled:u,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker",children:a(ya,{size:13})}),U&&a(Ar,{anchorRef:ae,host:e,selectedRepos:$,onClose:()=>W(!1),onToggleRepo:x=>w(I=>I.includes(x)?I.filter(y=>y!==x):[...I,x]),onSelectAll:()=>w([]),onSync:x=>void we(x)})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":S==="settings",onClick:()=>ge(S==="settings"?"prs":"settings"),title:S==="settings"?"Back to pull requests":"Settings",children:S==="settings"?o(re,{children:[a(Oa,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):o(re,{children:[a(Xa,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]})]}),o("div",{className:`prm-content${S==="prs"&&H==="board"?" prm-content--board":""}`,children:[g&&a("div",{className:"prm-error",children:g}),S==="prs"&&De&&o("div",{className:`prm-sync-clue prm-sync-clue--${De.kind}`,role:"status",children:[De.kind==="disconnect"&&a(Ja,{size:14,"aria-hidden":!0}),De.kind==="remote-gone"&&a($e,{size:14,"aria-hidden":!0}),De.kind==="outage"&&a(za,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:De.message}),De.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>ge("settings"),children:"Open Settings"})]}),S==="prs"&&B.remoteGone.map(x=>o("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${x} is gone`,children:[o("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:x})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),o("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>void ia(x,"keep"),children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>void ia(x,"remove"),children:"Remove"})]})]},x)),S==="prs"&&a(Pr,{prs:fe,host:e,projects:Ie,tisWarnHours:t.tisWarnHours,tisDangerHours:t.tisDangerHours,reviewWarnDays:t.reviewWarnDays,reviewDangerDays:t.reviewDangerDays,repositories:t.repositories,workItemLocatorBase:t.gusLocatorBaseUrl,sortField:E,sortDir:J,onSortChange:ee,hostScope:pe,onHostScopeChange:le,awaitingFirstSync:!Re,syncing:u,autoSyncEnabled:t.autoSyncEnabled??!0,onDismiss:x=>void ve(x),onProjectAssign:(x,I)=>void Q(x,I),onBulkSetSeen:(x,I)=>void Y(x,I),onBulkDismiss:x=>void Me(x),onBulkSetFavorite:(x,I)=>void Ue(x,I),viewMode:H,onViewModeChange:te}),S==="settings"&&r&&a(Hr,{settings:t,onSave:x=>void da(x),onRepositoriesChanged:()=>void Ke(),host:e})]}),R&&a(kr,{host:e,onClose:()=>N(!1),onPulled:x=>{n(x),e.cache.set(ie,x),e.cache.set(Ae,x.length),e.cache.refreshBadge?.(),N(!1)}})]}):a("section",{className:"prm-panel",children:a(er,{onSave:async x=>{await da(x)}})}):a("section",{className:"prm-panel",children:o("div",{className:"prm-loading",children:[a(V,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})})}function jr(e){if(e.length!==0)return e.length===1?e[0]:e}var Bt=new Map,Xr,Xs=5e3;function Ft(e){Xr=e}function Ks(){return{get:e=>Bt.get(e),set:(e,t)=>{Bt.set(e,t)},delete:e=>{Bt.delete(e)},refreshBadge:()=>Xr?.()}}function Zs(e,t){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,t)}function Js(e){try{let t=new URL(e);if(t.protocol!=="https:"&&t.protocol!=="http:"||typeof window>"u")return;window.open(t.href,"_blank","noopener,noreferrer")}catch{}}function Kr(e){let t=[],s=!1,r=0,i=async()=>{if(!(s||Date.now()<r)){s=!0;try{let l=await ua(e,"listProjects");Array.isArray(l)&&(t=l)}catch{}finally{r=Date.now()+Xs,s=!1}}};return i(),{call:(l,...n)=>ua(e,l,jr(n)),storage:{get:l=>ua(e,"storageGet",l),set:async(l,n)=>{await ua(e,"storageSet",{key:l,value:n})}},cache:Ks(),toast:Zs,listProjects:()=>(i(),t),openExternal:Js,pushInbox:async l=>l.projectId?await ua(e,"pushInbox",l):{id:""}}}var Et="prs-changed";var Ht=`/*
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
}

.prm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
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
  border-radius: 8px;
  background: var(--bg-elevated);
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
  padding: 2px;
  border-radius: 4px;
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

.prm-modal {
  width: min(440px, 90vw);
  background: var(--bg-elevated);
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.prm-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.prm-modal-header h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.prm-modal-body {
  padding: 14px;
}

/* Help popup body \u2014 readable prose with a tidy bulleted list. */
.prm-help-body {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
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
  padding: 10px 14px;
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
  width: min(600px, 92vw);
}

.prm-dialog-title {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}

.prm-dialog-tabs {
  display: flex;
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
  color: var(--text-secondary);
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
  color: var(--text-secondary);
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
  color: #f5b400;
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
  color: var(--text-faint, var(--text-dim));
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
  color: var(--text-faint, var(--text-dim));
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
  width: min(720px, 94vw);
  max-height: 86vh;
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
  gap: 12px;
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
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.prm-detail-pr-title {
  margin: 0;
  font-size: 16px;
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
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
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
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint, var(--text-muted));
}

.prm-detail-fact dd {
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
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint, var(--text-muted));
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
  color: var(--text-secondary);
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
`;var Jr="pr-monitor",Zr="prm-plugin-styles";function Qs(){return globalThis.__ZCC_PLUGIN_RUNTIME__}function en(){if(typeof document>"u")return;let e=document.getElementById(Zr);if(e instanceof HTMLStyleElement){e.textContent=`${At}
${Ht}`;return}let t=document.createElement("style");t.id=Zr,t.textContent=`${At}
${Ht}`,document.head.appendChild(t)}en();var an={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function tn(){let e=oe(()=>Kr(Jr),[]);return Lt(Et,t=>{let s=t?.prs;Array.isArray(s)&&(e.cache.set(ie,s),e.cache.set(Ae,s.length),e.cache.refreshBadge?.())}),a("div",{style:an,children:a(Nt,{host:e})})}function on(){let[e,t]=d(null),s=ue(!0),r=ue(0),i=Z(async()=>{let l=++r.current;try{let n=await ua(Jr,"badge");if(!s.current||l!==r.current)return;let u=typeof n?.count=="number"&&n.count>0?n.count:null;t(u)}catch(n){if(!s.current||l!==r.current)return;console.warn("[pr-monitor] badge refresh failed",n),t(null)}},[]);return z(()=>(s.current=!0,i(),Ft(()=>{s.current&&i()}),()=>{s.current=!1,r.current++,Ft(void 0)}),[i]),Lt(Et,l=>{(async()=>{let n=Array.isArray(l?.inAppDeltas)?l.inAppDeltas:[];if(i(),n.length===0)return;let u=Qs();for(let L of n)u?.toast?.(`${L.pr.repo}#${L.pr.number}: ${Ne(L.oldStatus)} -> ${Ne(L.newStatus)}`,"info")})().catch(n=>console.warn("[pr-monitor] notification delivery failed",n))}),e==null?null:a("span",{className:"nav-badge",children:e})}var vp=_t(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:tn,experimental_sidebarAccessory:on}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:t=>{t.toPluginPanel("main")}})});export{vp as default,en as injectStyles};
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
lucide-react/dist/esm/icons/external-link.mjs:
lucide-react/dist/esm/icons/eye-off.mjs:
lucide-react/dist/esm/icons/eye.mjs:
lucide-react/dist/esm/icons/folder-git-2.mjs:
lucide-react/dist/esm/icons/folder-search.mjs:
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
