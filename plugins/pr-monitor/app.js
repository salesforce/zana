var j=globalThis.__ZCC_HOST_REACT__;var ln=j.Children,dn=j.Component,un=j.Fragment,cn=j.StrictMode,fn=j.Suspense,pn=j.cloneElement,zt=j.createContext,Ra=j.createElement,mn=j.createRef,ot=j.forwardRef,gn=j.isValidElement,hn=j.lazy,xn=j.memo,Ln=j.startTransition,Z=j.useCallback,_t=j.useContext,bn=j.useDebugValue,In=j.useDeferredValue,W=j.useEffect,Gt=j.useId,Cn=j.useImperativeHandle,Sn=j.useInsertionEffect,Vt=j.useLayoutEffect,ee=j.useMemo,yn=j.useReducer,se=j.useRef,d=j.useState,wn=j.useSyncExternalStore,vn=j.useTransition,Pn=j.version;function as(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function ts(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}async function ua(e,t,s){return as().callRpc(e,t,s)}function $t(e){return{__zccPluginApp:!0,setup:e}}function bt(e,t){ts().useRealtime?.(e,t)}var Wt=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function jt(e,t,s=[]){if(t==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:Wt(e),size:24,node:t,...s.length>0?{aliases:s}:{}}}var Xt=e=>{let t="",s=!1;for(let r of e){if(r==="-"||r==="_"||r<=" "){s=t.length>0;continue}t.length===0?t+=r.toLowerCase():t+=s?r.toUpperCase():r,s=!1}return t};var Kt=e=>{let t=Xt(e);return t.charAt(0).toUpperCase()+t.slice(1)};var Ea=(...e)=>e.filter((t,s,r)=>!!t&&t.trim()!==""&&r.indexOf(t)===s).join(" ").trim();var ca={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function It(e){return e!=null}function Zt(e,t={}){let s=t.attributeNames??{},r=I=>s[I]??I,l=e.size??e.width??ca.width,i=e.size??e.height??ca.height,n=e.aliases?.filter(I=>typeof I=="string"&&I.trim()!=="").map(I=>`lucide-${I}`)??[],u=[...e.name?[`lucide-${e.name}`]:[],...n],b=t.className?.split(" ").filter(Boolean)??[],f=t.includeDefaultClasses===!1?Ea(...b):Ea("lucide",...u,...b),S=t.absoluteStrokeWidth?Number(t.strokeWidth??ca["stroke-width"])*Number(e.size??e.width??ca.width)/Number(t.size??t.width??ca.width):t.strokeWidth??ca["stroke-width"];return["svg",{...Object.entries(ca).reduce((I,[c,y])=>(I[r(c)]=y,I),{}),..."color"in t&&t.color&&{[r("stroke")]:t.color},..."size"in t&&It(t.size)&&{[r("width")]:t.size,[r("height")]:t.size},..."width"in t&&It(t.width)&&{[r("width")]:t.width},..."height"in t&&It(t.height)&&{[r("height")]:t.height},[r("stroke-width")]:S,...f&&{[r("class")]:f},[r("viewBox")]:`0 0 ${l} ${i}`,...t.hasA11yProp===!1?{[r("aria-hidden")]:"true"}:{},..."attributes"in t&&t.attributes},e.node.map(I=>{let[c,y,m]=I,g=t.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...y}:y;return m?[c,g,m]:[c,g]})]}function Jt(e,t={}){return Zt(e,{...t,attributeNames:{...t.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var Yt=e=>{for(let t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};var os=zt({});var Qt=()=>_t(os);var eo=ot(({color:e,size:t,width:s,height:r,strokeWidth:l,absoluteStrokeWidth:i,nonScalingStroke:n,className:u="",children:b,iconNode:f=[],icon:S={node:f,aliases:[],size:24},...L},I)=>{let{size:c=24,strokeWidth:y=2,absoluteStrokeWidth:m=!1,nonScalingStroke:g=!1,color:P="currentColor",className:R=""}=Qt()??{},U=!!b||Yt(L),[M,D,K=[]]=Jt(S,{color:e??P,width:s??t??c,height:r??t??c,strokeWidth:l??y,absoluteStrokeWidth:i??m,nonScalingStroke:n??g,className:Ea(R,u),hasA11yProp:U,attributes:L});return Ra(M,{ref:I,...D},[...K.map(([N,F])=>Ra(N,F)),...Array.isArray(b)?b:[b]])});function h(e,t=[],s=[]){let r=typeof e=="string"?jt(e,t,s):e,l=ot(({className:i,...n},u)=>Ra(eo,{ref:u,icon:r,className:i,...n}));return r.name&&(l.displayName=Kt(r.name)),l}var ao={name:"arrow-down",size:24,node:[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]]};ao.node;var Ha=h(ao);var to={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};to.node;var Oa=h(to);var oo={name:"arrow-up",size:24,node:[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]]};oo.node;var qa=h(oo);var ro={name:"bell-off",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]]};ro.node;var oa=h(ro);var so={name:"bell",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]]};so.node;var Ne=h(so);var no={name:"book-bookmark",size:24,node:[["path",{d:"M10 2v7.751a.25.25 0 00.407.195l2.28-1.834a.5.5 0 01.627 0l2.28 1.834A.25.25 0 0016 9.751V2",key:"x9x4jl"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 016.5 2H19a1 1 0 011 1v18a1 1 0 01-1 1H6.5a1 1 0 010-5H20",key:"1889un"}]],aliases:["book-marked"]};no.node;var fa=h(no);var lo={name:"building-complex",size:24,node:[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],aliases:["building-2"]};lo.node;var pa=h(lo);var io={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};io.node;var qe=h(io);var uo={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};uo.node;var ya=h(uo);var co={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};co.node;var ra=h(co);var fo={name:"circle-alert",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],aliases:["alert-circle"]};fo.node;var Be=h(fo);var po={name:"circle-check",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 9-5.5 5.5L8 12",key:"xofnsj"}]],aliases:["check-circle-2"]};po.node;var he=h(po);var mo={name:"circle-dashed",size:24,node:[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]]};mo.node;var Ua=h(mo);var go={name:"circle-question-mark",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["help-circle","circle-help"]};go.node;var Fe=h(go);var ho={name:"circle-x",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],aliases:["x-circle"]};ho.node;var ve=h(ho);var xo={name:"clock",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]]};xo.node;var Ee=h(xo);var Lo={name:"cloud-off",size:24,node:[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};Lo.node;var za=h(Lo);var bo={name:"columns-3",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],aliases:["panels-left-right"]};bo.node;var ma=h(bo);var Io={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};Io.node;var _a=h(Io);var Co={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};Co.node;var He=h(Co);var So={name:"eye-off",size:24,node:[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};So.node;var Ga=h(So);var yo={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};yo.node;var Va=h(yo);var wo={name:"folder-git-2",size:24,node:[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]]};wo.node;var $a=h(wo);var vo={name:"folder-search",size:24,node:[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]]};vo.node;var Ma=h(vo);var Po={name:"git-branch",size:24,node:[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]]};Po.node;var Ue=h(Po);var ko={name:"git-merge",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]]};ko.node;var sa=h(ko);var Ao={name:"git-pull-request-closed",size:24,node:[["path",{d:"m15.5 3.5 5 5",key:"1kmx7t"}],["path",{d:"m15.5 8.5 5-5",key:"saftza"}],["path",{d:"M18 11.62V15",key:"1greaj"}],["path",{d:"M6 9v12",key:"1sc30k"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}]]};Ao.node;var na=h(Ao);var Ro={name:"git-pull-request-draft",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};Ro.node;var Ke=h(Ro);var Mo={name:"git-pull-request",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};Mo.node;var xe=h(Mo);var To={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};To.node;var Wa=h(To);var Do={name:"layout-list",size:24,node:[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]]};Do.node;var ja=h(Do);var No={name:"link-2",size:24,node:[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]]};No.node;var ze=h(No);var Bo={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};Bo.node;var V=h(Bo);var Fo={name:"mail-open",size:24,node:[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]]};Fo.node;var Ze=h(Fo);var Eo={name:"mail",size:24,node:[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]]};Eo.node;var la=h(Eo);var Ho={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};Ho.node;var ga=h(Ho);var Oo={name:"pen",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],aliases:["edit-2"]};Oo.node;var Je=h(Oo);var qo={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};qo.node;var Ta=h(qo);var Uo={name:"refresh-cw",size:24,node:[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]};Uo.node;var Pe=h(Uo);var zo={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};zo.node;var Da=h(zo);var _o={name:"settings",size:24,node:[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};_o.node;var Xa=h(_o);var Go={name:"shield-alert",size:24,node:[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]]};Go.node;var Ka=h(Go);var Vo={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};Vo.node;var Oe=h(Vo);var $o={name:"square-check-big",size:24,node:[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],aliases:["check-square"]};$o.node;var ha=h($o);var Wo={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};Wo.node;var _e=h(Wo);var jo={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};jo.node;var ie=h(jo);var Xo={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};Xo.node;var Ge=h(Xo);var Ko={name:"users",size:24,node:[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]]};Ko.node;var Za=h(Ko);var Zo={name:"wifi-off",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};Zo.node;var Ja=h(Zo);var Jo={name:"wifi",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]]};Jo.node;var wa=h(Jo);var Yo={name:"wrench",size:24,node:[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]]};Yo.node;var Ya=h(Yo);var Qo={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};Qo.node;var Ve=h(Qo);var et={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},rt="standard",Qa={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},st="standard";function rs(e){let t=e?.buildTisPreset??e?.tisPreset;return t&&t in et?t:rt}function er(e,t){let s=(e??"").toLowerCase();return s?(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function at(e,t,s,r){let l=er(e,t);if(l){let i=et[rs(l)];return{warnHours:i.warnHours,dangerHours:i.dangerHours}}return{warnHours:s,dangerHours:r}}function Ct(e,t,s,r){let l=er(e,t);if(l){let i=l.reviewTisPreset&&l.reviewTisPreset in Qa?l.reviewTisPreset:st,n=Qa[i];return{warnDays:n.warnDays,dangerDays:n.dangerDays}}return{warnDays:s,dangerDays:r}}var ar={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},St="organizations",va={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:St,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},ke="monitoredCount",te="monitoredPrs",Pa="settings",tt="prefetch:orgs",yt="prefetch:repos",wt="prefetch:author",ss=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function vt(e){let t=ss.exec(e);if(!t)throw new Error(`Not a GitHub PR URL: ${e}`);return t[1]}var ns={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function Pt(e){return ns[e]}var ls={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function kt(e){return ls[e]}var is=/\bW-\d{8}\b/i;function xa(e,t,s){for(let r of[e,t,s]){if(typeof r!="string"||!r)continue;let l=is.exec(r);if(l)return l[0].toUpperCase()}}function nt(e,t){if(!e||!t||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(t)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${t.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var tr=globalThis.__ZCC_HOST_REACT__,ae=tr.Fragment;function a(e,t,s){return tr.createElement(e,s===void 0?t:{...t,key:s})}var o=a;function or({onSave:e}){let[t,s]=d(!1),r=async()=>{s(!0);try{await e({...va})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:o("div",{className:"prm-setup",children:[a(xe,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void r(),disabled:t,children:t?"Saving\u2026":"Get started"})})]})})}function $e(e){let t=Date.now(),s=Math.max(0,t-e),r=Math.floor(s/1e3);if(r<60)return"just now";let l=Math.floor(r/60);if(l<60)return`${l}m ago`;let i=Math.floor(l/60);if(i<24)return`${i}h ago`;let n=Math.floor(i/24);if(n===1)return"yesterday";if(n<30)return`${n}d ago`;let u=Math.floor(n/30);return u<12?`${u}mo ago`:`${Math.floor(u/12)}y ago`}var ds={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function De(e){return ds[e]}function rr(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function lt(e){let t=0,s=0,r=0;for(let l of e){let i=l.state.toUpperCase();i==="SUCCESS"||i==="PASS"||i==="PASSED"?t++:i==="FAILURE"||i==="FAILED"||i==="ERROR"||i==="CANCELLED"?s++:r++}return{pass:t,fail:s,pending:r}}var us={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function sr(e){return us[e.toUpperCase()]??"pending"}function it(e){return{label:De(e),className:`prm-status-pill--${e}`}}var We=4,je=6,ka=3,Aa=5;function La(e){if(!e)return"";let t=Math.max(0,Date.now()-e),s=Math.floor(t/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function ba(e,t){let s=t==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function Ia(e){let t=e.name||e.login,s=t.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():t.slice(0,2).toUpperCase()}async function Ie(e,t,s){try{let r=await e.call(t,s);if(!r?.ok)throw new Error(r?.error||"The request failed. Please try again.");Array.isArray(r.prs)&&(e.cache.set(te,r.prs),e.cache.set(ke,r.prs.length),e.cache.refreshBadge())}catch(r){e.toast(`Couldn't update PR \u2014 ${r instanceof Error?r.message:String(r)}`,"error")}}var cs=new Set(["fail","failure"]),fs=new Set(["pending","in_progress","queued"]);function ps(e){return(e??"").toLowerCase().trim()||"pending"}function ms(e,t){if(!t||t.length===0)return!1;let s=(e??"").toLowerCase();return t.some(r=>{let l=(r??"").toLowerCase();return l.length>0&&s.includes(l)})}function Na(e,t={}){if(!e||e.length===0)return!1;let s=t.ignoredFailingChecks;for(let r of e){let l=ps(r.bucket||r.state);if(fs.has(l)||cs.has(l)&&!ms(r.name,s))return!1}return!0}function Ba(e){let{status:t,buildHappy:s,reviewApproved:r,sfciGated:l,hasSfciJob:i,elapsedHours:n,warnHours:u,dangerHours:b}=e;if(t==="integrating"||t==="closed-merged"||t==="closed-abandoned")return"done";let f=l&&!i;return s&&r&&t==="yellow"?f?"blocked":n>=b?"merge-stall":n>=u?"warn":"ok":s?"done":f?"blocked":n>=b?"danger":n>=u?"warn":"ok"}function dt(e){let{reviewApproved:t,merged:s,elapsedDays:r,warnDays:l,dangerDays:i}=e;return t&&!s?"done":r>=i?"danger":r>=l?"warn":"ok"}function gs(e){if(typeof document>"u")return!1;let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.top="-9999px",t.setAttribute("readonly",""),document.body.appendChild(t);try{return t.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(t)}}async function Fa(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return gs(e)}var hs=Symbol.for("react.portal");function Ca(e,t){return{$$typeof:hs,key:null,children:e,containerInfo:t,implementation:null}}var ut=4,ct=8,nr=120,xs=320,Ls=280;function bs(e,t){let s=t.innerHeight-e.bottom-ut-ct,r=e.top-ut-ct,l=s<nr&&r>s,i=Math.max(nr,Math.min(xs,l?r:s)),n=Math.max(ct,Math.min(e.left,t.innerWidth-Ls-ct));return l?{left:n,bottom:t.innerHeight-e.top+ut,maxHeight:i}:{left:n,top:e.bottom+ut,maxHeight:i}}function ft({projectId:e,projects:t,onAssign:s}){let r=se(null),l=se(null),[i,n]=d(!1),[u,b]=d(null),f=t.find(c=>c.id===e),S=!!f;W(()=>{if(!i)return;let c=r.current;c&&b(bs(c.getBoundingClientRect(),window))},[i]),W(()=>{if(!i||!u)return;let c=l.current;(c?.querySelector(".is-active")??c?.querySelector("button")??c)?.focus()},[i,u]);let L=()=>{n(!1),r.current?.focus()},I=S?`Associated with ${f.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return o(ae,{children:[o("button",{ref:r,type:"button",className:`prm-project-row ${S?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:I,"aria-label":I,"aria-haspopup":"menu","aria-expanded":i,onClick:c=>{c.stopPropagation(),n(y=>!y)},children:[a($a,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:S?f.name:"Not associated with a project"})]}),i&&u&&typeof document<"u"&&Ca(o(ae,{children:[a("div",{className:"prm-project-menu-backdrop",onClick:c=>{c.stopPropagation(),L()}}),o("div",{ref:l,className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...u},role:"menu","aria-label":"Associate a project",tabIndex:-1,onKeyDown:c=>{if(c.key==="Escape"||c.key==="Tab")c.preventDefault(),c.stopPropagation(),L();else if(["ArrowDown","ArrowUp","Home","End"].includes(c.key)){c.preventDefault(),c.stopPropagation();let y=Array.from(c.currentTarget.querySelectorAll("button")),m=y.indexOf(document.activeElement),g=c.key==="Home"?0:c.key==="End"?y.length-1:(m+(c.key==="ArrowDown"?1:-1)+y.length)%y.length;y[g]?.focus()}},children:[t.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),S&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:c=>{c.stopPropagation(),s(null),L()},children:"Clear association"}),t.map(c=>a("button",{type:"button",className:`prm-project-menu-item ${c.id===e?"is-active":""}`,role:"menuitem",onClick:y=>{y.stopPropagation(),s(c.id),L()},children:c.name},c.id))]})]}),document.body)]})}function pt({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(t=>{let s=sr(t.state);return o("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:t.name}),t.bucket&&a("span",{className:"prm-check-bucket",children:t.bucket}),a("span",{className:"prm-check-state",title:t.state,children:t.state.toLowerCase()})]},`${t.bucket??""}/${t.name}`)})})}function lr(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}var Is=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],Cs=["seen","favorite","mute","dismiss"];function ir({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:l,reviewWarnDays:i,reviewDangerDays:n,sfciGated:u=!1,ignoredFailingChecks:b,workItemLocatorBase:f,selected:S,onToggleSelect:L,onDismiss:I,onProjectAssign:c}){let[y,m]=d(!1),[g,P]=d(!1),R=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),U=e.workItem??xa(e.title,e.headRefName,e.body),M=nt(U,f),D=it(e.status),K=e.status==="closed-merged"||e.status==="closed-abandoned",N=!!e.muted,F=!!e.favorite,_=!!e.syncError,v=e.checks??[],z=lt(v),$=e.reviewDecision==="APPROVED",Y=e.buildHappy??Na(v,{ignoredFailingChecks:b}),k=Ba({status:e.status,buildHappy:Y,reviewApproved:$,sfciGated:u,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??We,dangerHours:l??je}),fe=La(e.lastStatusChange),pe=k==="merge-stall"||k==="danger"?"danger":k==="warn"?"warn":"ok",E=k==="done"?"Build \u2713":k==="merge-stall"?"Merge stalled":ba(pe,"build"),Le=k==="done"?"done":pe,Ae=!e.isDraft&&!K,T=e.status==="closed-merged",H=dt({reviewApproved:$,merged:T,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:i??ka,dangerDays:n??Aa}),B=La(e.reviewClockStartedAt),J=H==="danger"?"danger":H==="warn"?"warn":"ok",Q=H==="done"?"Review \u2713":ba(J,"review"),Se=H==="done"?"done":J,de=e.reviewers??[],me={"changes-requested":de.filter(A=>A.state==="changes-requested"),"review-requested":de.filter(A=>A.state==="review-requested"),approved:de.filter(A=>A.state==="approved")},Re=de.length>0,Qe=()=>{lr(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ea=e.isDraft?Ke:e.status==="closed-merged"?sa:e.status==="closed-abandoned"?na:xe,Sa=async()=>{R&&await Ie(t,"markPrAsSeen",{url:e.url})},ye=async()=>{await Ie(t,R?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},ia=async()=>{await Ie(t,"setPrMuted",{url:e.url,muted:!N})},aa=async()=>{await Ie(t,"setPrFavorite",{url:e.url,favorite:!F})},oe=async A=>{A.stopPropagation(),P(!0);try{await Ie(t,"retryPr",{url:e.url})}finally{P(!1)}},re=async(A,p)=>{await Fa(A)?t.toast(`${p} copied`,"info"):t.toast(`Failed to copy ${p}`,"error")},we=v.length>0,ue=we?` \u2014 click to ${y?"hide":"show"} checks`:"",ne=A=>{A.stopPropagation(),m(p=>!p)},da=A=>{(A.key==="Enter"||A.key===" ")&&(A.preventDefault(),ne(A))},Xe=A=>we?{role:"button",tabIndex:0,"aria-expanded":y,title:A,"data-tip":A,onClick:ne,onKeyDown:da}:{},ce=we?" prm-tip prm-checks-trigger":"",Me=`${D.label} \u2014 overall PR status${ue}`,Te=`${z.pass} passing, ${z.fail} failing, ${z.pending} running`,x=k==="done"?"Build passing":k==="merge-stall"?"Merge stalled":k==="blocked"?"Build waiting (SFCI job not yet created)":E||"Build running",C=`${x} \xB7 ${fe} in build phase \xB7 ${Te}${ue}`,w=H==="done"?"Review approved":Q||"Awaiting review",q=`${w} \xB7 ${B} in review${ue}`,X=`${Te}${ue}`,ge={seen:{Icon:R?Ze:la,label:R?"Mark read":"Mark unread",title:R?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:_e,label:F?"Unfavorite":"Favorite",title:F?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:F},mute:{Icon:N?oa:Ne,label:N?"Unmute":"Mute",title:N?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:ie,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},be=A=>{A==="seen"?ye():A==="favorite"?aa():A==="mute"?ia():I(e.url)};return o("div",{className:`prm-tile ${R?"prm-tile--unread":""} ${K?"prm-tile--closed":""} ${_?"prm-tile--stale":""} ${F?"prm-tile--favorite":""} ${S?"prm-tile--selected":""}`,onClick:Sa,role:"button",tabIndex:0,onKeyDown:A=>{(A.key==="Enter"||A.key===" ")&&(A.preventDefault(),Sa())},children:[o("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:S,title:S?"Deselect this PR":"Select this PR","aria-label":S?"Deselect this PR":"Select this PR",onClick:A=>A.stopPropagation(),onChange:A=>{A.stopPropagation(),L(e.url)}}),a(ea,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),o("span",{className:"prm-tile-title",children:[U&&o("span",{className:"prm-tile-workitem-inline",children:["@",U,": "]}),e.title.replace(new RegExp(`(?:^|@)${U}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${D.className} prm-tip${ce}`,title:Me,"data-tip":Me,...Xe(Me),children:D.label}),we?o("span",{className:`prm-tis prm-tis--${Le} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":y,title:C,"data-tip":C,"aria-label":`${x}, ${fe} in build phase`,onClick:ne,onKeyDown:da,children:[fe,E&&o("span",{className:"prm-tis-cue",children:[" ",E]})]}):o("span",{className:`prm-tis prm-tis--${Le} prm-tip`,title:C,"data-tip":C,"aria-label":`${x}, ${fe} in build phase`,children:[fe,E&&o("span",{className:"prm-tis-cue",children:[" ",E]})]}),Ae&&(B||Q)&&(we?o("span",{className:`prm-tis prm-tis--review prm-tis--${Se} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":y,title:q,"data-tip":q,"aria-label":`${w}, ${B} in review`,onClick:ne,onKeyDown:da,children:[B,Q&&o("span",{className:"prm-tis-cue",children:[" ",Q]})]}):o("span",{className:`prm-tis prm-tis--review prm-tis--${Se} prm-tip`,title:q,"data-tip":q,"aria-label":`${w}, ${B} in review`,children:[B,Q&&o("span",{className:"prm-tis-cue",children:[" ",Q]})]})),v.length>0&&o("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${z.pass} passed, ${z.fail} failed, ${z.pending} running`,...Xe(X),children:[z.pass>0&&o("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(qe,{size:9})," ",z.pass]}),z.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(Ve,{size:9})," ",z.fail]}),z.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(Ee,{size:9})," ",z.pending]})]}),N&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(oa,{size:11})}),_&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(Be,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:g,onClick:A=>void oe(A),children:a(Pe,{size:10,className:g?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:Cs.map(A=>{let p=ge[A],O=p.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${p.danger?" prm-tile-icon-btn--danger":""}${p.active?" prm-tile-icon-btn--active":""}`,title:p.title,"data-tip":p.label,"aria-label":p.label,"aria-pressed":p.active,onClick:G=>{G.stopPropagation(),be(A)},children:a(O,{size:13,...p.active?{fill:"currentColor"}:{}})},A)})})]}),o("div",{className:"prm-tile-line2",children:[U&&(M?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${U}`,onClick:A=>{A.stopPropagation(),lr(M)&&t.openExternal(M)},children:U}):a("span",{className:"prm-workitem-chip",children:U})),a("span",{className:"prm-tile-repo",children:e.repo}),o("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:A=>{A.stopPropagation(),Qe()},children:a(He,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:A=>{A.stopPropagation(),re(e.url,"PR link")},children:a(ze,{size:10})})]}),e.author&&o("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:Ia(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-tile-line3",children:[a(Ue,{size:10,className:"prm-branch-icon","aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:A=>{A.stopPropagation(),re(e.headRefName,"Branch name")},children:a(ze,{size:10})})]}),Re&&a("div",{className:"prm-reviewers",children:Is.map(({state:A,label:p,className:O})=>{let G=me[A];return G.length===0?null:o("span",{className:`prm-reviewers-group ${O}`,title:p,children:[a("span",{className:"prm-reviewers-label",children:p}),G.map(le=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:le.name||le.login,"aria-label":`${p}: ${le.name||le.login}`,children:Ia(le)},le.login))]},A)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(ft,{projectId:e.projectId,projects:s,onAssign:A=>c(e.url,A)}),y&&v.length>0&&a("div",{className:"prm-tile-checks",onClick:A=>A.stopPropagation(),children:a(pt,{checks:v})})]})}function mt(e,t,s=!1){let r=se(null),l=se(t);l.current=t;let[i,n]=d({top:0,left:0,maxHeight:400});return Vt(()=>{let u=r.current,b=e.current;if(!u||!b)return;let f=()=>{let L=b.getBoundingClientRect(),I=Math.max(12,Math.min(L.bottom+6,window.innerHeight-160)),c=u.getBoundingClientRect().width,y=Math.max(12,Math.min(s?L.right-c:L.left,window.innerWidth-c-12));n({top:I,left:y,maxHeight:window.innerHeight-I-12})};f(),u.querySelector("button:not(:disabled)")?.focus();let S=L=>{if(!L.defaultPrevented){if(L.key==="Escape")L.preventDefault(),l.current();else if(L.key==="Tab")l.current();else if(["ArrowDown","ArrowUp","Home","End"].includes(L.key)){let I=Array.from(u.querySelectorAll("button:not(:disabled)"));if(!I.length)return;L.preventDefault();let c=I.indexOf(document.activeElement),y=L.key==="Home"?0:L.key==="End"?I.length-1:(c+(L.key==="ArrowDown"?1:-1)+I.length)%I.length;I[y].focus()}}};return window.addEventListener("resize",f),window.addEventListener("keydown",S),()=>{window.removeEventListener("resize",f),window.removeEventListener("keydown",S),b.isConnected&&b.focus({preventScroll:!0})}},[e,s]),{ref:r,position:i}}function dr({anchorRef:e,hosts:t,selectedHosts:s,onClose:r,onToggleHost:l,onSelectAll:i,shortHost:n}){let{ref:u,position:b}=mt(e,r,!1);if(typeof document>"u")return null;let f=s.length===0;return Ca(o(ae,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:S=>{S.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-host-filter",ref:u,style:{position:"fixed",...b},"aria-label":"Host filter",role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),o("button",{type:"button",className:`prm-project-menu-item ${f?"is-active":""}`,role:"menuitemcheckbox","aria-checked":f,onClick:S=>{S.stopPropagation(),i()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:f&&a(qe,{size:12})}),"All hosts"]}),t.map(S=>{let L=s.includes(S);return o("button",{type:"button",className:`prm-project-menu-item ${L?"is-active":""}`,role:"menuitemcheckbox","aria-checked":L,onClick:I=>{I.stopPropagation(),l(S)},title:`Filter to ${S}`,children:[a("span",{className:"prm-sync-filter-check",children:L&&a(qe,{size:12})}),n(S)]},S)})]})]}),document.body)}var Ss='button, a, input, textarea, select, [contenteditable="true"]';function ur(e){return!e||typeof e.closest!="function"?!1:e.closest(Ss)!==null}function cr(e,t,s){return{left:e.left-(t-e.x),top:e.top-(s-e.y)}}function At(){let e=se(null),[t,s]=d(!1),r=Z(n=>{let u=e.current;!u||u.id!==n.pointerId||(e.current=null,s(!1),n.currentTarget.hasPointerCapture(n.pointerId)&&n.currentTarget.releasePointerCapture(n.pointerId))},[]),l=Z(n=>{n.button!==0||ur(n.target)||(e.current={id:n.pointerId,x:n.clientX,y:n.clientY,left:n.currentTarget.scrollLeft,top:n.currentTarget.scrollTop},n.currentTarget.setPointerCapture(n.pointerId),s(!0))},[]),i=Z(n=>{let u=e.current;if(!u||u.id!==n.pointerId)return;let b=cr(u,n.clientX,n.clientY);n.currentTarget.scrollLeft=b.left,n.currentTarget.scrollTop=b.top},[]);return{isPanning:t,canvasPanProps:{onPointerDown:l,onPointerMove:i,onPointerUp:r,onPointerCancel:r}}}var Rt=`.zcc-kanban {
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
`;function ws(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function fr({children:e,className:t="",label:s,columnWidth:r}){let{isPanning:l,canvasPanProps:i}=At();return a("div",{role:"list","aria-label":s,className:["zcc-kanban",l?"is-panning":"",t].filter(Boolean).join(" "),style:ws(r),...i,children:e})}function pr({children:e,className:t="",columnId:s,label:r,count:l,icon:i,badge:n,collapsed:u=!1,onToggleCollapse:b,onContextMenu:f,onDragOver:S,onDragLeave:L,onDrop:I}){let c=u?`Expand ${r}`:`Collapse ${r}`;return o("section",{role:"listitem",className:["zcc-kanban-col",u?"is-collapsed":"",t].filter(Boolean).join(" "),"aria-label":`${r} (${l})`,"data-kanban-column":s,"data-board-column":s,"data-collapsed":u?"true":"false",onContextMenu:f,onDragOver:S,onDragLeave:L,onDrop:I,children:[o("header",{className:"zcc-kanban-col-header",children:[i?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:i}):null,a("span",{className:"zcc-kanban-col-title",children:r}),a("span",{className:"zcc-kanban-col-count",children:l}),n,b?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:c,"aria-label":c,"aria-expanded":!u,onClick:()=>b(s),children:u?a(ra,{size:13}):a(ga,{size:13})}):null]}),u?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}var Mt=["conflict","failed","yellow","review-required","pending","integrating","green"],mr=["closed-merged","closed-abandoned"],gr={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function Tt(e){return e==="list"||e==="board"}function vs(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function gt(e){let t=vs();for(let s of e)t[s.status].push(s);return t}function hr(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var xr=[...Mt,...mr];function Lr(e){return typeof e=="string"&&xr.includes(e)}function br(e,t={}){let s=hr(e);return t.showEmpty?[...Mt,...mr.filter(r=>s[r]>0)]:xr.filter(r=>s[r]>0)}function Ir(e){let t=hr(e);return Mt.filter(s=>t[s]===0).length}function Cr(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Ps(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function ks(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Sr({pr:e,host:t,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:l,selected:i,selectionActive:n=!1,selectMode:u=!1,onToggleSelect:b,onDismiss:f,onOpen:S}){let[L,I]=d(!1),c=ks(e),y=e.status==="closed-merged"||e.status==="closed-abandoned",m=!!e.favorite,g=!!e.syncError,P=e.workItem??xa(e.title,e.headRefName,e.body),R=P?e.title.replace(new RegExp(`(?:^|@)${P}[:\\s]*`,"i"),""):e.title,U=e.checks??[],M=lt(U),D=e.updatedAt||e.lastChecked||e.lastStatusChange,K=e.buildHappy??Na(U,{ignoredFailingChecks:l}),N=Ba({status:e.status,buildHappy:K,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??We,dangerHours:r??je}),F=N==="merge-stall"?"Merge stalled":N==="warn"||N==="danger"?ba(N,"build"):"",_=N==="merge-stall"||N==="danger"?"danger":N==="warn"?"warn":"",v=i||u||n,z=async()=>{c&&await Ie(t,"markPrAsSeen",{url:e.url})},$=async()=>{await Ie(t,"setPrFavorite",{url:e.url,favorite:!m})},Y=()=>{Ps(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},k=async()=>{I(!0);try{await Ie(t,"retryPr",{url:e.url})}finally{I(!1)}},fe=()=>{S(e.url),z()},pe=E=>{if(E.metaKey||E.ctrlKey||u){b(e.url);return}fe()};return o("article",{className:["prm-board-card",c?"prm-board-card--unread":"",y?"prm-board-card--closed":"",m?"prm-board-card--favorite":"",i?"prm-board-card--selected":"",g?"prm-board-card--stale":"",v?"prm-board-card--selectable":"",u?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:pe,onPointerDown:E=>E.stopPropagation(),onKeyDown:E=>{E.target===E.currentTarget&&(E.key==="Enter"||E.key===" ")&&(E.preventDefault(),u||E.metaKey||E.ctrlKey?b(e.url):fe())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[o("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:i,title:i?"Deselect this PR":"Select this PR","aria-label":i?"Deselect this PR":"Select this PR",onClick:E=>E.stopPropagation(),onChange:E=>{E.stopPropagation(),b(e.url)}}),o("span",{className:"prm-board-card-id",children:[o("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",title:e.repo,children:Cr(e.repo)})]}),P&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:P}),o("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${m?" prm-tile-icon-btn--active":""}`,title:m?"Unfavorite":"Favorite","data-tip":m?"Unfavorite":"Favorite","aria-label":m?"Unfavorite":"Favorite","aria-pressed":m,onClick:E=>{E.stopPropagation(),$()},children:a(_e,{size:12,...m?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:E=>{E.stopPropagation(),Y()},children:a(He,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:E=>{E.stopPropagation(),f(e.url)},children:a(ie,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:R}),o("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:Ia(e.author)}),F?o("span",{className:`prm-tis prm-tis--${_} prm-board-card-stall`,children:[La(e.lastStatusChange)," ",F]}):D>0&&a("span",{className:"prm-board-card-time",children:$e(D)}),M.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${M.fail} checks failing`,children:[a(Ve,{size:9})," ",M.fail]}),M.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${M.pending} checks running`,children:[a(Ee,{size:9})," ",M.pending]}),e.isDraft&&o("span",{className:"prm-draft-pill prm-board-card-draft",children:[a(Ke,{size:10,"aria-hidden":!0})," Draft"]}),g&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(Be,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:L,onClick:E=>{E.stopPropagation(),k()},children:a(Pe,{size:10,className:L?"prm-spin":""})})]})]})]})}var As={conflict:Ka,failed:ve,yellow:Ge,"review-required":Va,pending:Ua,integrating:V,green:he,"closed-merged":sa,"closed-abandoned":na};function yr({prs:e,host:t,tisWarnHours:s,tisDangerHours:r,repositories:l,selected:i,selectMode:n=!1,showEmpty:u=!1,collapsed:b,onToggleCollapse:f,onToggleSelect:S,onDismiss:L,onOpen:I}){let c=ee(()=>gt(e),[e]),y=ee(()=>br(c,{showEmpty:u}),[c,u]),m=i.size>0||n;return a(fr,{label:"Pull requests by status",className:"prm-board",children:y.map(g=>{let P=c[g],R=As[g],U=b.has(g),M=P.filter(D=>D.lastSeenAt===0||D.lastStatusChange>(D.lastSeenAt??D.addedAt)).length;return a(pr,{columnId:g,className:`prm-board-col--${g}`,label:gr[g],count:P.length,icon:a(R,{size:14,"aria-hidden":!0}),badge:M>0?a("span",{className:"zcc-kanban-col-badge",title:`${M} unread`,children:M}):null,collapsed:U,onToggleCollapse:D=>f(D),children:P.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):P.map(D=>{let K=at(D.repo,l,s??We,r??je),N=(l??[]).find(F=>`${F.owner}/${F.repo}`.toLowerCase()===D.repo.toLowerCase());return a(Sr,{pr:D,host:t,tisWarnHours:K.warnHours,tisDangerHours:K.dangerHours,ignoredFailingChecks:N?.ignoredFailingChecks,selected:i.has(D.url),selectionActive:m,selectMode:n,onToggleSelect:S,onDismiss:L,onOpen:I},D.url)})},g)})})}function Ce({title:e,icon:t,onClose:s,busy:r=!1,children:l,footer:i,wide:n=!1,className:u="",titleId:b,closeLabel:f="Close",backdropTestId:S}){let L=Gt(),I=b??L,c=se(null),y=se(typeof document>"u"?null:document.activeElement),m=se({onClose:s,busy:r});m.current={onClose:s,busy:r},W(()=>{let P=y.current,R=c.current;R.focus();let U=M=>{if(M.defaultPrevented)return;let D=document.querySelectorAll(".prm-modal");if(D[D.length-1]===R){if(M.key==="Escape")M.preventDefault(),m.current.busy||m.current.onClose();else if(M.key==="Tab"){let K=Array.from(R.querySelectorAll("button, [href], input, select, textarea, [tabindex]")).filter(_=>_.tabIndex>=0&&!_.matches(":disabled")&&!_.closest("[hidden], [inert]")&&getComputedStyle(_).display!=="none"&&getComputedStyle(_).visibility!=="hidden"),N=K[0],F=K[K.length-1];N?M.shiftKey&&(document.activeElement===N||document.activeElement===R)?(M.preventDefault(),F.focus()):!M.shiftKey&&(document.activeElement===F||document.activeElement===R)&&(M.preventDefault(),N.focus()):(M.preventDefault(),R.focus())}}};return window.addEventListener("keydown",U),()=>{window.removeEventListener("keydown",U),P?.isConnected&&P.focus()}},[]);let g=a("div",{className:"modal-backdrop prm-modal-backdrop","data-testid":S,onClick:P=>{P.target===P.currentTarget&&!r&&s()},children:o("div",{ref:c,tabIndex:-1,role:"dialog","aria-modal":"true","aria-labelledby":I,className:`modal prm-modal${n?" prm-modal--wide":""} ${u}`,children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:I,children:[t&&a("span",{className:"prm-modal-icon","aria-hidden":!0,children:t}),e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close","aria-label":f,children:a(Ve,{size:16,"aria-hidden":!0})})]}),l,i]})});return typeof document>"u"?g:Ca(g,document.body)}var Rs=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function wr(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function Ms(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function vr({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:l,reviewWarnDays:i,reviewDangerDays:n,sfciGated:u=!1,ignoredFailingChecks:b,workItemLocatorBase:f,onClose:S,onDismiss:L,onProjectAssign:I}){let[c,y]=d(!1),[m,g]=d(!1),P=(e.body?.length??0)>600,R=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),U=e.status==="closed-merged"||e.status==="closed-abandoned",M=!!e.muted,D=!!e.favorite,K=!!e.syncError,N=e.workItem??xa(e.title,e.headRefName,e.body),F=nt(N,f),_=N?e.title.replace(new RegExp(`(?:^|@)${N}[:\\s]*`,"i"),""):e.title,v=it(e.status),z=e.checks??[],$=e.reviewers??[],Y={"changes-requested":$.filter(oe=>oe.state==="changes-requested"),"review-requested":$.filter(oe=>oe.state==="review-requested"),approved:$.filter(oe=>oe.state==="approved")},k=Ms(e),fe=e.reviewDecision==="APPROVED",pe=e.buildHappy??Na(z,{ignoredFailingChecks:b}),E=Ba({status:e.status,buildHappy:pe,reviewApproved:fe,sfciGated:u,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??We,dangerHours:l??je}),Le=La(e.lastStatusChange),Ae=E==="merge-stall"||E==="danger"?"danger":E==="warn"?"warn":"ok",T=E==="done"?"Build \u2713":E==="merge-stall"?"Merge stalled":ba(Ae,"build"),H=E==="done"?"done":Ae,B=!e.isDraft&&!U,J=dt({reviewApproved:fe,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:i??ka,dangerDays:n??Aa}),Q=La(e.reviewClockStartedAt),Se=J==="danger"?"danger":J==="warn"?"warn":"ok",de=J==="done"?"Review \u2713":ba(Se,"review"),me=J==="done"?"done":Se,Re=e.isDraft?Ke:e.status==="closed-merged"?sa:e.status==="closed-abandoned"?na:xe,Qe=()=>{wr(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ea=async(oe,re)=>{await Fa(oe)?t.toast(`${re} copied`,"info"):t.toast(`Failed to copy ${re}`,"error")},Sa=async()=>{await Ie(t,R?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},ye=async()=>{await Ie(t,"setPrMuted",{url:e.url,muted:!M})},ia=async()=>{await Ie(t,"setPrFavorite",{url:e.url,favorite:!D})},aa=async()=>{y(!0);try{await Ie(t,"retryPr",{url:e.url})}finally{y(!1)}};return o(Ce,{title:o("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]}),icon:a(Re,{size:18}),titleId:"prm-detail-title",closeLabel:"Close PR details",backdropTestId:"prm-detail-backdrop",className:"prm-modal--detail",onClose:S,children:[o("div",{className:"prm-modal-body prm-detail-body",children:[o("div",{className:"prm-detail-heading",children:[N&&(F?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${N}`,onClick:()=>{wr(F)&&t.openExternal(F)},children:N}):a("span",{className:"prm-workitem-chip",children:N})),a("h4",{className:"prm-detail-pr-title",children:_})]}),o("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${v.className}`,children:v.label}),e.isDraft&&o("span",{className:"prm-draft-pill",children:[a(Ke,{size:10,"aria-hidden":!0})," Draft"]}),M&&o("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(oa,{size:11,"aria-hidden":!0})," Muted"]}),Le&&o("span",{className:`prm-tis prm-tis--${H}`,children:[Le,T&&o("span",{className:"prm-tis-cue",children:[" ",T]})]}),B&&(Q||de)&&o("span",{className:`prm-tis prm-tis--review prm-tis--${me}`,children:[Q,de&&o("span",{className:"prm-tis-cue",children:[" ",de]})]})]}),k&&a("div",{className:"prm-detail-hint",children:k}),K&&o("div",{className:"prm-detail-sync-error",role:"alert",children:[a(Be,{size:12,"aria-hidden":!0}),o("span",{children:["Couldn't sync this PR: ",e.syncError]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:c,"aria-label":"Retry syncing this PR",onClick:()=>void aa(),children:[a(Pe,{size:11,className:c?"prm-spin":""})," Retry"]})]}),o("div",{className:"prm-detail-grid",children:[o("div",{className:"prm-detail-main",children:[o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Checks"}),a(pt,{checks:z})]}),e.body&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Description preview"}),a("div",{className:"prm-detail-desc",id:"prm-description-preview",children:P&&!m?`${e.body.slice(0,600).trimEnd()}\u2026`:e.body}),P&&a("button",{type:"button",className:"prm-text-btn","aria-expanded":m,"aria-controls":"prm-description-preview",onClick:()=>g(oe=>!oe),children:m?"Collapse preview":"Expand preview"}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-detail-description-link",onClick:Qe,children:["Read full description on GitHub ",a(He,{size:12,"aria-hidden":!0})]})]})]}),o("aside",{className:"prm-detail-sidebar","aria-label":"Pull request information",children:[o("dl",{className:"prm-detail-facts",children:[e.author&&o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),o("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:Ia(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:$e(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:$e(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:$e(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Branches"}),o("div",{className:"prm-detail-branch",children:[a(Ue,{size:12,"aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>void ea(e.headRefName,"Branch name"),children:a(ze,{size:10})})]})]}),$.length>0&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:Rs.map(({state:oe,label:re,className:we})=>{let ue=Y[oe];return ue.length===0?null:o("span",{className:`prm-reviewers-group ${we}`,title:re,children:[a("span",{className:"prm-reviewers-label",children:re}),ue.map(ne=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:ne.name||ne.login,"aria-label":`${re}: ${ne.name||ne.login}`,children:Ia(ne)},ne.login))]},oe)})})]}),o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Project"}),a(ft,{projectId:e.projectId,projects:s,onAssign:oe=>I(e.url,oe)})]})]})]})]}),o("footer",{className:"prm-modal-footer prm-detail-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:Qe,title:"Open on GitHub",children:[a(He,{size:13}),a("span",{children:"Open on GitHub"})]}),o("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>void ea(e.url,"PR link"),children:[a(ze,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${D?" prm-tile-icon-btn--active":""}`,title:D?"Unfavorite":"Favorite","data-tip":D?"Unfavorite":"Favorite","aria-label":D?"Unfavorite":"Favorite","aria-pressed":D,onClick:()=>void ia(),children:a(_e,{size:13,...D?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:M?"Unmute":"Mute","data-tip":M?"Unmute":"Mute","aria-label":M?"Unmute":"Mute","aria-pressed":M,onClick:()=>void ye(),children:M?a(oa,{size:13}):a(Ne,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:R?"Mark this PR as read":"Mark this PR as unread","data-tip":R?"Mark read":"Mark unread","aria-label":R?"Mark read":"Mark unread",onClick:()=>void Sa(),children:R?a(Ze,{size:13}):a(la,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>L(e.url),children:a(ie,{size:13})})]})]})}var Ts=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],Ar=["closed-merged","closed-abandoned"],Ds=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function Ns(e,t){let s=e.favorite?1:0,r=t.favorite?1:0;return s!==r?r-s:t.lastStatusChange-e.lastStatusChange}function ht(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Bs(e,t){return e.length>0&&e.every(r=>{let l=t.find(i=>i.url===r);return l?!!l.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function Fs(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Es(e){let t=e.workItem??xa(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),De(e.status),e.headRefName??"",e.baseRefName??"",t,e.repo,Fs(e.repo)].join("").toLowerCase()}var Pr="boardShowEmpty",kr="boardCollapsed";function Rr({prs:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:l,reviewWarnDays:i,reviewDangerDays:n,repositories:u,workItemLocatorBase:b,sortField:f,sortDir:S,onSortChange:L,hostScope:I,onHostScopeChange:c,awaitingFirstSync:y,syncing:m,autoSyncEnabled:g,onDismiss:P,onProjectAssign:R,onBulkSetSeen:U,onBulkDismiss:M,onBulkSetFavorite:D,viewMode:K="list",onViewModeChange:N}){let[F,_]=d("all"),[v,z]=d(""),[$,Y]=d(new Set),[k,fe]=d(!1),[pe,E]=d(K),[Le,Ae]=d(!1),[T,H]=d(!1),[B,J]=d(()=>new Set),[Q,Se]=d(null),de=se(null),me=N?K:pe,Re=p=>{p==="board"&&_("all"),p==="list"&&Ae(!1),N?N(p):E(p)};W(()=>{let p=!0;return t.storage.get(Pr).then(O=>{p&&typeof O=="boolean"&&H(O)}),t.storage.get(kr).then(O=>{!p||!Array.isArray(O)||J(new Set(O.filter(Lr)))}),()=>{p=!1}},[t]);let Qe=p=>{H(p),t.storage.set(Pr,p)},ea=p=>{J(O=>{let G=new Set(O);return G.has(p)?G.delete(p):G.add(p),t.storage.set(kr,[...G]),G})},Sa=ee(()=>{let p=[];for(let O of e){let G=vt(O.url);p.includes(G)||p.push(G)}return p},[e]),ye=ee(()=>{if(I.length===0)return e;let p=new Set(I);return e.filter(O=>p.has(vt(O.url)))},[e,I]),ia=ee(()=>{let p=new Map;for(let O of ye)p.set(O.status,(p.get(O.status)??0)+1);return p},[ye]),aa=ee(()=>F==="all"?ye:ye.filter(p=>p.status===F),[ye,F]),oe=ee(()=>{let p=v.trim().toLowerCase();return p?aa.filter(O=>Es(O).includes(p)):aa},[aa,v]),re=ee(()=>{let p=S==="asc"?1:-1,O=[...oe];return f==="favorites"?(O.sort(Ns),O):(O.sort((G,le)=>{let ta=0;switch(f){case"created":ta=(G.createdAt??0)-(le.createdAt??0);break;case"status":ta=kt(G.status)-kt(le.status);break;case"statusUpdated":ta=G.lastStatusChange-le.lastStatusChange;break;case"updated":default:ta=(G.updatedAt||G.lastChecked||G.lastStatusChange)-(le.updatedAt||le.lastChecked||le.lastStatusChange);break}if(ta===0){let qt=ht(G)?1:0,Ut=ht(le)?1:0;return qt!==Ut?Ut-qt:(le.createdAt??0)-(G.createdAt??0)}return ta*p}),O)},[oe,f,S]),we=ee(()=>Ir(gt(re)),[re]),ue=Q?e.find(p=>p.url===Q):void 0;W(()=>{Q&&!ue&&Se(null)},[Q,ue]);let ne=ee(()=>{if(!ue)return null;let p=at(ue.repo,u,r??We,l??je),O=Ct(ue.repo,u,i??ka,n??Aa),G=(u??[]).find(le=>`${le.owner}/${le.repo}`.toLowerCase()===ue.repo.toLowerCase());return{tisWarnHours:p.warnHours,tisDangerHours:p.dangerHours,reviewWarnDays:O.warnDays,reviewDangerDays:O.dangerDays,sfciGated:G?.sfciGated===!0,ignoredFailingChecks:G?.ignoredFailingChecks}},[ue,u,r,l,i,n]),da=ee(()=>ye.filter(ht).length,[ye]),Xe=ee(()=>re.map(p=>p.url),[re]),ce=ee(()=>Xe.filter(p=>$.has(p)),[Xe,$]),Me=re.length>0&&ce.length===re.length,Te=ce.length>0&&!Me,x=p=>{Y(O=>{let G=new Set(O);return G.has(p)?G.delete(p):G.add(p),G})},C=()=>{Y(Me||Te?new Set:new Set(Xe))},w=()=>Y(new Set),q=ce.length>0?ce:Xe,X=q.every(p=>{let O=e.find(G=>G.url===p);return O?!ht(O):!0}),ge=Bs(ce,e);if(e.length===0){if(y){let p=m||g;return o("div",{className:"prm-empty",children:[p?a(V,{size:32,className:"prm-spin","aria-hidden":!0}):a(xe,{size:32,"aria-hidden":!0}),a("h3",{children:p?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:p?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return o("div",{className:"prm-empty",children:[a(xe,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let A=o("div",{className:"prm-list-toolbar",children:[o("div",{className:"prm-list-controls",children:[o("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":me==="list",title:"List view",onClick:()=>Re("list"),children:[a(ja,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":me==="board",title:"Board view",onClick:()=>Re("board"),children:[a(ma,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),me==="list"&&a("label",{className:"prm-select-all",title:Me?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:Me,ref:p=>{p&&(p.indeterminate=Te)},onChange:C,"aria-label":Me?"Clear selection":"Select all shown PRs"})}),me==="list"&&o("span",{className:"prm-shown-count","aria-live":"polite",children:[re.length," shown"]}),o("div",{className:"prm-search",children:[a(Da,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:v,onChange:p=>z(p.target.value),"aria-label":"Search PRs"})]}),o("button",{type:"button",ref:de,className:`prm-btn prm-btn--sm ${I.length>0?"is-active":""}`,onClick:()=>fe(p=>!p),title:"Filter by host","aria-expanded":k,children:[a(Wa,{size:12}),o("span",{children:["Host",I.length>0&&o("span",{className:"prm-unread-count",children:[" (",I.length,")"]})]}),a(ya,{size:12})]}),k&&a(dr,{anchorRef:de,hosts:Sa,selectedHosts:I,onClose:()=>fe(!1),onToggleHost:p=>c(I.includes(p)?I.filter(O=>O!==p):[...I,p]),onSelectAll:()=>c([]),shortHost:rr}),me==="board"&&o(ae,{children:[o("button",{type:"button",className:`prm-btn prm-btn--sm ${Le?"is-active":""}`,"aria-pressed":Le,title:"Select cards for bulk actions",onClick:()=>Ae(p=>!p),children:[a(ha,{size:12}),a("span",{children:"Select"})]}),we>0&&o("button",{type:"button",className:`prm-btn prm-btn--sm ${T?"is-active":""}`,"aria-pressed":T,title:T?"Hide empty columns":`Show ${we} empty column${we===1?"":"s"}`,onClick:()=>Qe(!T),children:[a(Ga,{size:12}),a("span",{children:T?"Hide empty":`Empty (${we})`})]})]}),me==="list"&&o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>U(q,!X),title:ce.length>0?`Mark the ${ce.length} selected PR(s) ${X?"unread":"read"}`:`Mark all shown PRs ${X?"unread":"read"}`,children:[a(Ze,{size:12}),o("span",{children:[X?"Mark unread":"Mark read",da>0&&o("span",{className:"prm-unread-count",children:[" (",da,")"]})]})]}),me==="list"&&o("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:f,onChange:p=>L(p.target.value,S),"aria-label":"Sort field",children:Ds.map(p=>a("option",{value:p.id,title:p.title,children:p.label},p.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>L(f,S==="asc"?"desc":"asc"),disabled:f==="favorites",title:f==="favorites"?"Favorites first uses a fixed order":S==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":S==="asc"?"Sorted ascending":"Sorted descending",children:S==="asc"?a(qa,{size:12}):a(Ha,{size:12})})]})]}),me==="list"&&o("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[o("button",{type:"button",role:"tab","aria-selected":F==="all",className:`prm-segment-tab ${F==="all"?"active":""}`,onClick:()=>_("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:ye.length})]}),Ts.map(p=>{let O=ia.get(p)??0;return o("button",{type:"button",role:"tab","aria-selected":F===p,className:`prm-segment-tab prm-segment-tab--${p} ${F===p?"active":""}`,onClick:()=>_(p),title:`Show PRs in "${De(p)}"`,children:[De(p)," ",a("span",{className:"prm-segment-count",children:O})]},p)})]}),ce.length>0&&o("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:w,title:"Clear selection","aria-label":"Clear selection",children:a(Ve,{size:12})}),o("span",{className:"prm-bulk-count",children:[ce.length," selected"]}),o("div",{className:"prm-bulk-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>U(ce,!X),title:`Mark the selected PR(s) ${X?"unread":"read"}`,children:[X?a(la,{size:12}):a(Ze,{size:12}),a("span",{children:X?"Mark unread":"Mark read"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>D(ce,ge.favorite),title:`${ge.label} the selected PR(s)`,children:[a(_e,{size:12,...ge.favorite?{}:{fill:"currentColor"}}),a("span",{children:ge.label})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{M(ce),w()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(ie,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return o("div",{className:`prm-list${me==="board"?" prm-list--board":""}`,children:[A,re.length===0?o("div",{className:"prm-empty prm-empty--filtered",children:[a(Da,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:v.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),o("div",{className:"prm-empty-actions",children:[v.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>z(""),title:"Clear search",children:"Clear search"}),F!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>_("all"),title:"Show all PRs",children:"Show all"})]})]}):me==="board"?a(yr,{prs:re,host:t,tisWarnHours:r,tisDangerHours:l,repositories:u,selected:$,selectMode:Le,showEmpty:T,collapsed:B,onToggleCollapse:ea,onToggleSelect:x,onDismiss:P,onOpen:Se}):a("div",{className:"prm-tile-list",children:re.map(p=>{let O=at(p.repo,u,r??We,l??je),G=Ct(p.repo,u,i??ka,n??Aa),le=(u??[]).find(ta=>`${ta.owner}/${ta.repo}`.toLowerCase()===p.repo.toLowerCase());return a(ir,{pr:p,host:t,projects:s,tisWarnHours:O.warnHours,tisDangerHours:O.dangerHours,reviewWarnDays:G.warnDays,reviewDangerDays:G.dangerDays,sfciGated:le?.sfciGated===!0,ignoredFailingChecks:le?.ignoredFailingChecks,workItemLocatorBase:b,selected:$.has(p.url),onToggleSelect:x,onDismiss:P,onProjectAssign:R},p.url)})}),ue&&ne&&a(vr,{pr:ue,host:t,projects:s,tisWarnHours:ne.tisWarnHours,tisDangerHours:ne.tisDangerHours,reviewWarnDays:ne.reviewWarnDays,reviewDangerDays:ne.reviewDangerDays,sfciGated:ne.sfciGated,ignoredFailingChecks:ne.ignoredFailingChecks,workItemLocatorBase:b,onClose:()=>Se(null),onDismiss:p=>{Se(null),P(p)},onProjectAssign:R})]})}function Mr({host:e,onClose:t,onPulled:s}){let[r,l]=d([]),[i,n]=d(!1),[u,b]=d(""),[f,S]=d(""),[L,I]=d(!1),[c,y]=d(null);W(()=>{let P=!0;return e.call("listRepos").then(R=>{if(!P)return;let U=(R?.repos??[]).filter(M=>M.active&&M.connection==="connected");l(U),U.length>0&&b(`${U[0].host}|${U[0].owner}/${U[0].repo}`),n(!0)}).catch(()=>{P&&n(!0)}),()=>{P=!1}},[e]);let m=ee(()=>r.find(P=>`${P.host}|${P.owner}/${P.repo}`===u),[r,u]),g=async()=>{if(L)return;y(null);let P=Number(f.trim());if(!m){y("Select a repository.");return}if(!Number.isSafeInteger(P)||P<=0){y("Enter a valid PR number.");return}I(!0);try{let R=await e.call("pullPr",{host:m.host,fullName:`${m.owner}/${m.repo}`,number:P});R?.ok&&Array.isArray(R.prs)?s(R.prs):y(R?.error||"Failed to pull PR.")}catch(R){y(R instanceof Error?R.message:String(R))}finally{I(!1)}};return o(Ce,{title:"Add PR",titleId:"prm-pull-title",icon:a(xe,{size:16}),onClose:t,busy:L,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),i&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):o("select",{className:"prm-input prm-input--select",value:u,onChange:P=>b(P.target.value),disabled:L||!i,"aria-label":"Repository",children:[!i&&a("option",{children:"Loading\u2026"}),r.map(P=>{let R=`${P.host}|${P.owner}/${P.repo}`;return o("option",{value:R,children:[P.owner,"/",P.repo," (",P.shortHost,")"]},R)})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{type:"number",min:1,step:1,"aria-invalid":!!c,"aria-describedby":c?"prm-pull-error":void 0,value:f,placeholder:"e.g. 42",className:"prm-input",onChange:P=>{S(P.target.value),c&&y(null)},onKeyDown:P=>{P.key==="Enter"&&!L&&(P.preventDefault(),g())},disabled:L||r.length===0})]}),c&&a("div",{className:"prm-modal-error",id:"prm-pull-error",role:"alert",children:c})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:L,title:"Cancel without adding",children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void g(),disabled:L||r.length===0||!f.trim(),title:"Add this PR to the monitored list",children:[L?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]})]})]})}function Tr({anchorRef:e,host:t,selectedRepos:s,onClose:r,onToggleRepo:l,onSelectAll:i,onSync:n}){let{ref:u,position:b}=mt(e,r,!0),[f,S]=d([]);if(W(()=>{let I=!0;return t.call("listRepos").then(c=>{I&&S((c?.repos??[]).filter(y=>y.active&&y.connection==="connected"))}).catch(()=>{}),()=>{I=!1}},[t]),typeof document>"u")return null;let L=s.length===0;return Ca(o(ae,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:I=>{I.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-sync-filter",ref:u,style:{position:"fixed",...b},"aria-label":"Sync & Filter",role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),o("button",{type:"button",className:`prm-project-menu-item ${L?"is-active":""}`,role:"menuitemcheckbox","aria-checked":L,onClick:I=>{I.stopPropagation(),i()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:L&&a(qe,{size:12})}),"All repositories"]}),f.map(I=>{let c=`${I.owner}/${I.repo}`,y=s.includes(c);return o("button",{type:"button",className:`prm-project-menu-item ${y?"is-active":""}`,role:"menuitemcheckbox","aria-checked":y,onClick:m=>{m.stopPropagation(),l(c)},title:`Filter/sync ${c}`,children:[a("span",{className:"prm-sync-filter-check",children:y&&a(qe,{size:12})}),c," ",o("span",{className:"prm-sync-filter-host",children:["(",I.shortHost,")"]})]},`${I.host}|${c}`)}),a("div",{className:"prm-tile-menu-divider"}),o("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{n(s),r()},title:L?"Sync all repositories now":"Sync the selected repositories now",children:L?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Ye({title:e,subtitle:t,actions:s}){return o("header",{className:"prm-area-header",children:[o("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:t})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function xt({state:e}){return e==="checking"?o("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(V,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(he,{size:11})," Connected"]}):o("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(ve,{size:11})," Disconnected"]})}function Lt({title:e,message:t,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:l,busy:i,onConfirm:n,onCancel:u}){return o(Ce,{title:e,onClose:u,busy:i,children:[a("div",{className:"prm-modal-body",children:t}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:u,disabled:i,children:r}),o("button",{type:"button",className:`prm-btn ${l?"prm-btn--danger":"prm-btn--primary"}`,onClick:n,disabled:i,children:[i?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function Dr({host:e}){let[t,s]=d(()=>{let g=e.cache.get(tt);return g?.ok&&Array.isArray(g.orgs)?g.orgs:null}),[r,l]=d(null),[i,n]=d(!1),[u,b]=d(null),[f,S]=d(!1),[L,I]=d(!1),c=Z(async()=>{try{let g=await e.call("listOrgs");g?.ok&&Array.isArray(g.orgs)?(s(g.orgs),l(null)):(s([]),g?.error&&l(g.error))}catch(g){s([]),l(g instanceof Error?g.message:String(g))}},[e]);W(()=>{c()},[c]);let y=async()=>{n(!0),l(null);try{let g=await e.call("rediscoverOrgs");!g?.ok&&g?.error&&l(g.error),await c()}catch(g){l(g instanceof Error?g.message:String(g))}finally{n(!1)}},m=async()=>{if(u){S(!0);try{let g=await e.call("deleteOrg",{host:u.host,login:u.login});!g?.ok&&g?.error&&e.toast(g.error,"error"),await c()}catch(g){e.toast(g instanceof Error?g.message:String(g),"error")}finally{S(!1),b(null)}}};return o("div",{className:"prm-area",children:[a(Ye,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:o(ae,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void y(),disabled:i,title:"Re-discover organizations from your gh accounts",children:[i?a(V,{size:13,className:"prm-spin"}):a(Oe,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>I(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(Fe,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),t===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):t.length===0?o("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:t.map(g=>o("div",{className:"prm-entity-card",children:[o("div",{className:"prm-entity-main",children:[o("div",{className:"prm-entity-title",children:[g.login," ",o("span",{className:"prm-entity-host",children:["(",g.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:g.apiBaseUrl}),o("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:g.login})]})]}),o("div",{className:"prm-entity-side",children:[a(xt,{state:i?"checking":g.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>b(g),title:"Delete organization",children:a(ie,{size:15})})]})]},`${g.host}|${g.login}`))}),L&&o(Ce,{title:"Adding & removing organizations",icon:a(Fe,{size:16}),onClose:()=>I(!1),children:[o("div",{className:"prm-modal-body prm-help-body",children:[o("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),o("ul",{children:[o("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),o("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),o("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),o("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>I(!1),children:a("span",{children:"Got it"})})})]}),u&&a(Lt,{title:"Delete organization?",danger:!0,busy:f,message:o(ae,{children:["Delete ",a("strong",{children:u.login})," (",u.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>void m(),onCancel:()=>b(null)})]})}function Hs(e,t){try{let s=new URL(t);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(t)}catch{}}function Nr(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function Os(e,t){await Fa(t)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Br({host:e,onRepositoriesChanged:t}){let[s,r]=d(()=>{let v=e.cache.get(yt);return v?.ok&&Array.isArray(v.repos)?v.repos:null}),[l,i]=d(()=>{let v=e.cache.get(tt);return v?.ok&&Array.isArray(v.orgs)?v.orgs:[]}),[n,u]=d(null),[b,f]=d(!1),[S,L]=d(!1),[I,c]=d(!1),[y,m]=d(null),[g,P]=d("general"),[R,U]=d(null),[M,D]=d(null),[K,N]=d(!1),F=Z(async()=>{try{let[v,z]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);v?.ok&&Array.isArray(v.repos)?(r(v.repos),u(null)):(r([]),v?.error&&u(v.error)),i(z?.ok&&Array.isArray(z.orgs)?z.orgs:[])}catch(v){r([]),u(v instanceof Error?v.message:String(v))}},[e]);W(()=>{F()},[F]);let _=async()=>{if(M){N(!0);try{await e.call("deleteRepository",{host:M.host,owner:M.owner,repo:M.repo}),await F()}catch(v){e.toast(v instanceof Error?v.message:String(v),"error")}finally{N(!1),D(null)}}};return o("div",{className:"prm-area",children:[a(Ye,{title:"Repositories",subtitle:"Manage your connected repositories",actions:o(ae,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>L(!0),children:[a(Oe,{size:13})," ",a("span",{children:"Suggested for you"})]}),o("button",{type:"button",className:"prm-btn",onClick:()=>c(!0),children:[a(Ma,{size:13})," ",a("span",{children:"Browse Repositories"})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>f(!0),children:[a(Ta,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),n&&a("div",{className:"prm-error",children:n}),s===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?o("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(v=>o("div",{className:"prm-entity-card prm-repo-card",children:[o("div",{className:"prm-repo-top",children:[o("div",{className:"prm-entity-title",children:[a(Ue,{size:14,"aria-hidden":!0})," ",o("span",{children:[v.owner,"/",v.repo]}),a("span",{className:`prm-active-badge${v.active?"":" prm-active-badge--off"}`,children:v.active?"Active":"Inactive"}),a(xt,{state:v.connection}),(()=>{let z=et[v.buildTisPreset??v.tisPreset??rt],$=Qa[v.reviewTisPreset??st];return o(ae,{children:[o("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${z.warnHours}h, behind schedule after ${z.dangerHours}h`,children:[a(Ee,{size:11,"aria-hidden":!0}),"Build: ",z.label]}),o("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${$.warnDays}d, behind schedule after ${$.dangerDays}d`,children:[a(Ee,{size:11,"aria-hidden":!0}),"Review: ",$.label]})]})})()]}),o("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>Hs(e,Nr(v)),children:a(He,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>void Os(e,Nr(v)),children:a(ze,{size:14})})]})]}),o("div",{className:"prm-entity-sub prm-repo-meta",children:[o("span",{children:["Organization: ",v.orgLogin," (",v.shortHost,")"]}),o("span",{children:["Created ",$e(v.createdAt)]})]}),o("div",{className:"prm-repo-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>U(v),children:[a(wa,{size:12})," ",a("span",{children:"Test Connection"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{P("general"),m(v)},children:[a(Je,{size:12})," ",a("span",{children:"Edit Repository"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{P("status"),m(v)},title:"Status Settings",children:[a(Ee,{size:12})," ",a("span",{children:"Status Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{P("notifications"),m(v)},title:"Notification Settings",children:[a(Ne,{size:12})," ",a("span",{children:"Notification Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>D(v),children:[a(ie,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${v.host}|${v.owner}/${v.repo}`))}),b&&a(qs,{host:e,orgs:l,onClose:()=>f(!1),onAdded:async()=>{f(!1),await F()}}),S&&a(Us,{host:e,onClose:()=>L(!1),onAdded:async()=>{await F()}}),I&&a(zs,{host:e,onClose:()=>c(!1),onAdded:async()=>{await F()}}),y&&a(_s,{host:e,repo:y,orgs:l,initialTab:g,onClose:()=>m(null),onSaved:async v=>{m(null),Array.isArray(v)&&(e.cache.set(te,v),e.cache.set(ke,v.length),e.cache.refreshBadge()),t?.(),await F()}}),R&&a(Gs,{host:e,repo:R,onClose:()=>U(null),onResult:v=>{let z=v?"connected":"disconnected";r($=>($??[]).map(Y=>Y.host===R.host&&Y.owner===R.owner&&Y.repo===R.repo?{...Y,connection:z}:Y))}}),M&&a(Lt,{title:"Delete repository?",danger:!0,busy:K,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>void _(),onCancel:()=>D(null)})]})}function qs({host:e,orgs:t,onClose:s,onAdded:r}){let[l,i]=d(""),[n,u]=d(t[0]?`${t[0].host}|${t[0].login}`:""),[b,f]=d(null),[S,L]=d(!1),I=async()=>{let c=t.find(y=>`${y.host}|${y.login}`===n);if(!c){f("Please select an organization.");return}L(!0),f(null);try{let y=await e.call("addRepository",{ref:l.trim(),host:c.host,orgLogin:c.login});y?.ok?r():f(y?.error||"Failed to add repository.")}catch(y){f(y instanceof Error?y.message:String(y))}finally{L(!1)}};return o(Ce,{title:"Add repository",icon:a(Ta,{size:14}),onClose:s,busy:S,children:[o("div",{className:"prm-modal-body",children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:l,spellCheck:!1,onChange:c=>{i(c.target.value),b&&f(null)},onKeyDown:c=>{c.key==="Enter"&&!S&&(c.preventDefault(),I())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),o("select",{className:"prm-input prm-input--select",value:n,onChange:c=>u(c.target.value),children:[t.length===0&&a("option",{value:"",children:"No organizations"}),t.map(c=>o("option",{value:`${c.host}|${c.login}`,children:[c.login," (",c.shortHost,")"]},`${c.host}|${c.login}`))]})]}),b&&a("div",{className:"prm-modal-error",role:"alert",children:b})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:S,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void I(),disabled:S||!l.trim(),children:[S?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function Us({host:e,onClose:t,onAdded:s}){let[r,l]=d(null),[i,n]=d(new Set),[u,b]=d(null),[f,S]=d(!1),L=Z(async()=>{l(null),b(null);try{let m=await e.call("suggestRepositories");m?.ok&&Array.isArray(m.repos)?(l(m.repos),n(new Set(m.repos.filter(g=>g.alreadyAdded).map(g=>g.fullName)))):(l([]),m?.error&&b(m.error))}catch(m){l([]),b(m instanceof Error?m.message:String(m))}},[e]);W(()=>{L()},[L]);let I=m=>{m.alreadyAdded||n(g=>{let P=new Set(g);return P.has(m.fullName)?P.delete(m.fullName):P.add(m.fullName),P})},c=async()=>{if(!r)return;let m=r.filter(g=>!g.alreadyAdded&&i.has(g.fullName));if(m.length!==0){S(!0);try{await e.call("addRepositories",{repos:m.map(g=>({owner:g.owner,repo:g.repo,host:g.host,orgLogin:g.orgLogin}))}),await s(),t()}catch(g){e.toast(g instanceof Error?g.message:String(g),"error")}finally{S(!1)}}},y=r?r.filter(m=>!m.alreadyAdded&&i.has(m.fullName)).length:0;return o(Ce,{title:"Suggested for you",icon:a(Oe,{size:14}),onClose:t,busy:f,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):u?a("div",{className:"prm-modal-error",role:"alert",children:u}):r.length===0?o("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(m=>o("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:i.has(m.fullName),disabled:m.alreadyAdded,onChange:()=>I(m)}),o("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:m.fullName}),o("span",{className:"prm-entity-sub",children:[m.prCount," PRs \xB7 ",$e(m.lastActivity)]})]}),m.alreadyAdded&&o("span",{className:"prm-suggested-added",children:[a(he,{size:13})," Already added"]})]},m.fullName))})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void L(),disabled:f||r===null,children:[a(Oe,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:f,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void c(),disabled:f||y===0,children:[f?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Adding\u2026":y>0?`Add ${y} Selected`:"Add Selected"})]})]})]})}function zs({host:e,onClose:t,onAdded:s}){let[r,l]=d(""),[i,n]=d(null),[u,b]=d(!0),[f,S]=d(!1),[L,I]=d(!1),[c,y]=d(1),[m,g]=d(null),[P,R]=d(new Set),[U,M]=d(new Set),[D,K]=d(new Set),[N,F]=d(!1),_=Z(async(T,H)=>{H?S(!0):b(!0),g(null);try{let B=await e.call("listAllRepositories",{page:T}),J=B?.ok&&Array.isArray(B.repos)?B.repos:[];I(!!B?.hasMore),K(new Set(Array.isArray(B?.incompleteOwners)?B.incompleteOwners:[])),n(Q=>{if(!H||!Q)return J;let Se=new Set(Q.map(de=>`${de.host}|${de.fullName}`));return[...Q,...J.filter(de=>!Se.has(`${de.host}|${de.fullName}`))]}),B&&B.ok===!1&&B.error&&g(B.error)}catch(B){g(B instanceof Error?B.message:String(B)),H||n([])}finally{b(!1),S(!1)}},[e]);W(()=>{_(1,!1)},[_]);let v=()=>{let T=c+1;y(T),_(T,!0)},z=i??[],$=r.trim().toLowerCase(),Y=$?z.filter(T=>T.fullName.toLowerCase().includes($)):z,k=T=>{R(H=>{let B=new Set(H);return B.has(T)?B.delete(T):B.add(T),B})},fe=T=>{M(H=>{let B=new Set(H);return B.has(T)?B.delete(T):B.add(T),B})},pe=T=>`${T.host}|${T.fullName}`,E=(()=>{let T=new Map;for(let H of Y){let B=T.get(H.owner)??[];B.push(H),T.set(H.owner,B)}return Array.from(T.entries())})(),Le=async()=>{let T=Y.filter(H=>!H.alreadyAdded&&P.has(pe(H)));if(T.length!==0){F(!0);try{await e.call("addRepositories",{repos:T.map(H=>({owner:H.owner,repo:H.repo,host:H.host,orgLogin:H.owner}))}),await s(),t()}catch(H){e.toast(H instanceof Error?H.message:String(H),"error")}finally{F(!1)}}},Ae=Y.filter(T=>!T.alreadyAdded&&P.has(pe(T))).length;return o(Ce,{title:"Browse Repositories",icon:a(Ma,{size:14}),onClose:t,busy:N,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:T=>l(T.target.value)})}),m&&a("div",{className:"prm-modal-error",role:"alert",children:m}),u?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):o("div",{className:"prm-browse-list",children:[E.map(([T,H])=>{let B=!U.has(T);return o("div",{className:"prm-browse-group",children:[o("button",{type:"button",className:"prm-browse-group-header",onClick:()=>fe(T),"aria-expanded":B,children:[a(ra,{size:13,className:`prm-disclosure${B?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:T}),o("span",{className:"prm-browse-group-count",title:!$&&D.has(T)?`${H.length} loaded \u2014 more available, use Load more`:void 0,children:["(",H.length,!$&&D.has(T)?"\u2026":"",")"]})]}),B&&H.map(J=>J.alreadyAdded?o("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[o("span",{children:[a(Ue,{size:13,"aria-hidden":!0})," ",J.fullName,J.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(he,{size:11,"aria-hidden":!0})," Connected"]})]},pe(J)):o("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:P.has(pe(J)),onChange:()=>k(pe(J))}),o("span",{children:[a(Ue,{size:13,"aria-hidden":!0})," ",J.fullName,J.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},pe(J)))]},T)}),Y.length===0&&a("div",{className:"prm-area-empty",children:$?"No repositories match your filter.":"No repositories found."}),L&&!$&&o("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:v,disabled:f,children:[f?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Loading\u2026":"Load more"})]})]})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:N,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void Le(),disabled:N||Ae===0,children:[N?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:Ae>0?`Add ${Ae} Selected`:"Add Selected"})]})]})]})}function _s({host:e,repo:t,orgs:s,initialTab:r="general",onClose:l,onSaved:i}){let[n,u]=d(r),[b,f]=d(`${t.owner}/${t.repo}`),[S,L]=d(t.orgLogin),[I,c]=d(t.active),[y,m]=d(t.buildTisPreset??t.tisPreset??rt),[g,P]=d(t.reviewTisPreset??st),[R,U]=d(t.sfciGated===!0),[M,D]=d((t.ignoredFailingChecks??[]).some(k=>k.toLowerCase().includes("snyk"))),[K,N]=d(t.notifyInApp??!0),[F,_]=d(null),[v,z]=d(!1),$=s.filter(k=>k.host===t.host),Y=async()=>{z(!0),_(null);try{let k=await e.call("updateRepository",{key:{host:t.host,owner:t.owner,repo:t.repo},ref:b.trim(),orgLogin:S,active:I,buildTisPreset:y,reviewTisPreset:g,sfciGated:R,ignoredFailingChecks:M?["Snyk"]:[],notifyInApp:K});k?.ok?i(k.prs):_(k?.error||"Failed to save settings.")}catch(k){_(k instanceof Error?k.message:String(k))}finally{z(!1)}};return o(Ce,{title:o("span",{className:"prm-dialog-title",children:["Repository Settings ",o("span",{className:"prm-entity-sub",children:[t.owner,"/",t.repo]})]}),icon:a(Je,{size:14}),onClose:l,busy:v,children:[o("nav",{className:"prm-dialog-tabs","aria-label":"Repository settings sections",children:[o("button",{type:"button",className:`prm-dialog-tab${n==="general"?" active":""}`,"aria-current":n==="general"?"page":void 0,onClick:()=>u("general"),children:[a(Je,{size:12})," General"]}),o("button",{type:"button",className:`prm-dialog-tab${n==="status"?" active":""}`,"aria-current":n==="status"?"page":void 0,onClick:()=>u("status"),children:[a(Ee,{size:12})," Status"]}),o("button",{type:"button",className:`prm-dialog-tab${n==="notifications"?" active":""}`,"aria-current":n==="notifications"?"page":void 0,onClick:()=>u("notifications"),children:[a(Ne,{size:12})," Notifications"]})]}),o("div",{className:"prm-modal-body",children:[n==="general"?o(ae,{children:[o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:I,onChange:k=>c(k.target.checked)}),o("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:b,spellCheck:!1,onChange:k=>f(k.target.value)})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:S,onChange:k=>L(k.target.value),children:$.map(k=>o("option",{value:k.login,children:[k.login," (",k.shortHost,")"]},k.login))})]})]}):n==="status"?o(ae,{children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:y,onChange:k=>m(k.target.value),children:Object.values(et).map(k=>o("option",{value:k.id,children:[k.label," (",k.warnHours,"h / ",k.dangerHours,"h)"]},k.id))})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:g,onChange:k=>P(k.target.value),children:Object.values(Qa).map(k=>o("option",{value:k.id,children:[k.label," (",k.warnDays,"d / ",k.dangerDays,"d)"]},k.id))})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:R,onChange:k=>U(k.target.checked)}),o("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:M,onChange:k=>D(k.target.checked)}),o("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:K,onChange:k=>N(k.target.checked)}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),F&&a("div",{className:"prm-modal-error",role:"alert",children:F})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:l,disabled:v,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void Y(),disabled:v,children:[v?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function Gs({host:e,repo:t,onClose:s,onResult:r}){let[l,i]=d(null);return W(()=>{let n=!0;return(async()=>{try{let b=await e.call("testRepository",{host:t.host,owner:t.owner,repo:t.repo})??{ok:!1,error:"No response"};n&&(i(b),r?.(b.ok))}catch(u){n&&(i({ok:!1,error:u instanceof Error?u.message:String(u)}),r?.(!1))}})(),()=>{n=!1}},[e,t]),o(Ce,{title:`Connection Test Results: ${t.owner}/${t.repo}`,icon:a(wa,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:l===null?o("div",{className:"prm-loading",children:[a(wa,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):l.ok?o("div",{className:"prm-test-result prm-test-result--ok",children:[a(he,{size:16})," All connection tests passed."]}):o("div",{className:"prm-test-result prm-test-result--fail",children:[a(ve,{size:16}),o("div",{children:[a("div",{children:l.error||"Connection failed."}),o("div",{className:"prm-field-hint",children:["Try ",o("code",{children:["gh auth login ",t.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function Vs(e){let t=e.trim().split(/\s+/).filter(Boolean);return t.length===0?"?":t.length===1?t[0].slice(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}function Fr({host:e}){let[t,s]=d(()=>{let f=e.cache.get(wt);return f?.ok?f.author??null:void 0}),[r,l]=d(null),[i,n]=d(!1),u=Z(async()=>{try{let f=await e.call("getAuthor");f?.ok?(s(f.author??null),l(null)):(s(null),f?.error&&l(f.error))}catch(f){s(null),l(f instanceof Error?f.message:String(f))}},[e]);W(()=>{u()},[u]);let b=t?.name||t?.login||"";return o("div",{className:"prm-area",children:[a(Ye,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),t===void 0?o("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading author\u2026"]}):t===null?o("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:o("div",{className:"prm-entity-card prm-author-card",children:[o("button",{type:"button",className:"prm-author-row",onClick:()=>n(f=>!f),"aria-expanded":i,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:Vs(b)}),o("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:b}),t.email&&a("span",{className:"prm-entity-sub",children:t.email})]}),a(ra,{size:16,className:`prm-disclosure${i?" is-open":""}`,"aria-hidden":!0})]}),i&&o("div",{className:"prm-author-detail",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:b||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:t.email||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:t.identities.map(f=>o("div",{className:"prm-identity-row",children:[o("span",{children:[f.login," ",o("span",{className:"prm-entity-host",children:["(",f.shortHost,")"]})]}),f.connection==="connected"?a(he,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):o("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(ve,{size:13})," Disconnected"]})]},`${f.host}|${f.login}`))})]})]})]})})]})}function Er({settings:e,update:t}){let s=e.notifyInApp??e.notifyOnChange;return o("div",{className:"prm-area",children:[a(Ye,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>t({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>t({sendToInbox:r.target.checked})}),o("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>t({badgeMode:"unread"})}),o("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>t({badgeMode:"total"})}),o("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var Hr=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],$s=15;function Or(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function Ws(e,t){let s=Math.max(0,e-t),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let l=Math.floor(r/60),i=r%60;return i?`in ${l}h ${i}m`:`in ${l}h`}function qr({settings:e,update:t,host:s}){let[r,l]=d(()=>s.cache.get(te)??[]),[i,n]=d(!1),[u,b]=d(()=>Date.now());W(()=>{let m=window.setInterval(()=>{let g=s.cache.get(te);g&&l(P=>P===g?P:g),b(Date.now())},1e3);return()=>window.clearInterval(m)},[s]);let f=e.autoSyncEnabled??!0,S=Hr.some(m=>m.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:$s,L=r.reduce((m,g)=>Math.max(m,g.lastChecked||0),0),I=f&&L?L+S*6e4:0,c=new Set(r.map(m=>m.repo)).size,y=async()=>{n(!0);try{let m=await s.call("pollAll");m?.ok&&Array.isArray(m.prs)&&(l(m.prs),s.cache.set(te,m.prs))}catch(m){s.toast(m instanceof Error?m.message:String(m),"error")}finally{n(!1)}};return o("div",{className:"prm-area",children:[a(Ye,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:f,onChange:m=>t({autoSyncEnabled:m.target.checked})}),o("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),o("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:S,onChange:m=>{let g=Number(m.target.value);Number.isFinite(g)&&t({pollIntervalMinutes:g})},children:Hr.map(m=>a("option",{value:m.value,children:m.label},m.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),o("div",{className:"prm-sync-status",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:I?o(ae,{children:[Ws(I,u)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Or(I)]})]}):"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:L?o(ae,{children:[$e(L)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Or(L)]})]}):""})]}),o("div",{className:"prm-sync-counts",children:[o("span",{className:"prm-sync-count",children:[a("strong",{children:c})," repositories checked"]}),o("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>void y(),disabled:i,children:[i?a(V,{size:13,className:"prm-spin"}):a(Pe,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var js=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:pa},{id:"repositories",label:"Repositories",icon:fa},{id:"author",label:"Author",icon:Za}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:Ne}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:Ya}]}];function Ur({settings:e,onSave:t,onRepositoriesChanged:s,host:r}){let[l,i]=d(e.settingsActiveNav??St),n=b=>{let f={...e,...b};t(f),r.cache.set("settings",f),r.cache.refreshBadge()},u=b=>{i(b),n({settingsActiveNav:b})};return a("div",{className:"prm-settings-shell",children:o("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:js.map(b=>o("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:b.label}),b.items.map(f=>{let S=f.icon;return o("button",{type:"button",className:`prm-nav-row${l===f.id?" active":""}`,"aria-current":l===f.id,onClick:()=>u(f.id),children:[a(S,{size:15,"aria-hidden":!0}),a("span",{children:f.label})]},f.id)})]},b.label))}),o("div",{className:"prm-settings-pane",children:[l==="organizations"&&a(Dr,{host:r}),l==="repositories"&&a(Br,{host:r,onRepositoriesChanged:s}),l==="author"&&a(Fr,{host:r}),l==="notifications"&&a(Er,{settings:e,update:n}),l==="system"&&a(qr,{settings:e,update:n,host:r})]})]})})}function zr(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function _r(e,t,s){return e===1?t:s}function Gr(e){if(!e)return null;let t=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return t.length>0?{kind:"disconnect",subjects:t,action:"settings",message:`GitHub sign-in expired for ${zr(t)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${_r(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${_r(r.length,"is","is")} temporarily unreachable for ${zr(r)} \u2014 retrying automatically.`}:null}function Xs(e,t){let s=(e.repo??"").toLowerCase();if(s)return(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function Vr(e,t){let s=Xs(e,t.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let i=t.notifyInApp??t.notifyOnChange??!1,n=t.sendToInbox??!1;return{inApp:i,inbox:n&&!!e.projectId}}function $r(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function Ks(e){try{let t=new URL(e);if(t.protocol!=="http:"&&t.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function jr(e,t,s){for(let r of t){let l=Pt(r.newStatus)>Pt(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||l))continue;let n=Vr(r.pr,s);if(!n.inApp&&!n.inbox)continue;let u=$r(r.pr.repo),b=$r(r.pr.title),f=Ks(r.pr.url),S=f?`[${b}](${f})`:b;if(n.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${De(r.oldStatus)} \u2192 ${De(r.newStatus)}`,"info"),n.inbox&&r.pr.projectId){let L=`**${u}#${r.pr.number}** \u2014 ${De(r.oldStatus)} \u2192 **${De(r.newStatus)}**

${S}`;try{await e.pushInbox({comments:L,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var Dt="activeSubTab",Xr="listSort",Kr="hostScope",Nt="listView";function Bt({host:e}){let[t,s]=d(null),[r,l]=d(!1),[i,n]=d(()=>e.cache.get(te)??[]),[u,b]=d(!1),[f,S]=d(null),[L,I]=d("prs"),[c,y]=d(!1),[m,g]=d(null),[P,R]=d(0),[U,M]=d(!1),[D,K]=d(!1),[N,F]=d(!1),[_,v]=d([]),[z,$]=d("status"),[Y,k]=d("asc"),[fe,pe]=d([]),[E,Le]=d("board"),[Ae,T]=d(!1),[H,B]=d(()=>({...ar})),J=se(null),Q=se(!0);W(()=>(Q.current=!0,()=>{Q.current=!1}),[]);let[Se,de]=d(()=>e.listProjects());W(()=>{let x=!0;return g(null),y(!1),Promise.all([e.storage.get(Pa),e.storage.get(Dt),e.call("listPrs"),e.storage.get(Xr),e.storage.get(Kr),e.storage.get(Nt)]).then(([C,w,q,X,ge,be])=>{if(!x)return;X?.field&&$(X.field),X?.dir&&k(X.dir),Array.isArray(ge)&&pe(ge),Tt(be)&&Le(be);let A=C?{...va,...C,relevanceModes:{...va.relevanceModes,...C.relevanceModes}}:null;s(A),A&&(e.cache.set("settings",A),e.cache.refreshBadge?.()),w==="prs"||w==="settings"?I(w):(w==="board"||w==="list")&&(I("prs"),Tt(be)||(Le(w),e.storage.set(Nt,w)),e.storage.set(Dt,"prs")),Array.isArray(q)&&(n(q),e.cache.set(te,q),e.cache.set(ke,q.length),e.cache.refreshBadge?.()),l(!0),y(!0),F(!0)}).catch(C=>{x&&(console.error("pr-monitor hydrate failed",C),g(C instanceof Error?C.message:String(C)),y(!0))}),()=>{x=!1}},[e,P]),W(()=>{let x=()=>{let w=e.cache.get(te);w&&n(X=>X===w?X:w);let q=e.listProjects();de(X=>X.length===q.length&&X.every((ge,be)=>ge.id===q[be].id&&ge.name===q[be].name&&ge.path===q[be].path)?X:q)},C=window.setInterval(x,100);return()=>window.clearInterval(C)},[e]);let me=x=>{I(x),e.storage.set(Dt,x)},Re=Z(async x=>{b(!0),S(null);try{let C=Array.isArray(x)&&x.length>0,q=C?await e.call("syncRepos",{repos:x}):await e.call("pollAll"),X=Date.now()+3e5;for(;(q.state==="running"||q.state==="queued")&&Q.current&&Date.now()<X;)await new Promise(A=>window.setTimeout(A,250)),q=await e.call("syncStatus",{id:q.id});if((q.state===void 0||q.state==="succeeded")&&Array.isArray(q.prs)){let A=q.state==="succeeded"?await e.call("listPrs"):q.prs;if(!Q.current)return;if(!Array.isArray(A))throw new Error("Could not refresh pull requests after syncing.");if(n(A),e.cache.set(te,A),e.cache.set(ke,A.length),e.cache.refreshBadge?.(),Array.isArray(q.deltas)&&q.deltas.length>0){let p=t??{...va,...await e.storage.get(Pa)};await jr(e,q.deltas,p)}}else!Q.current||Date.now()>=X?S("Sync is still running. Check back shortly."):q?.error&&S(q.error);let be=q?.health;!C&&be&&B(be)}catch(C){S(C instanceof Error?C.message:String(C))}finally{b(!1),T(!0)}},[e]),Qe=se(!1);W(()=>{!N||Qe.current||(Qe.current=!0,e.call("getSyncHealth").then(x=>{x?.ok&&x.health&&B(x.health)}).catch(()=>{}),Re())},[N,Re,e]);let ea=Z(async(x,C)=>{try{let w=await e.call("resolveRemoteGone",{repo:x,action:C});if(!w?.ok){e.toast(`Couldn't ${C} ${x} \u2014 ${w?.error??"unknown error"}`,"error");return}B(q=>({...q,remoteGone:q.remoteGone.filter(X=>X.toLowerCase()!==x.toLowerCase()),keptGone:C==="keep"?[...q.keptGone,x].filter((X,ge,be)=>be.indexOf(X)===ge):q.keptGone})),Re()}catch(w){e.toast(`Couldn't ${C} ${x} \u2014 ${w instanceof Error?w.message:String(w)}`,"error")}},[e,Re]),Sa=Z(async x=>{try{let C=await e.call("removePr",x);C?.ok&&Array.isArray(C.prs)&&(n(C.prs),e.cache.set(te,C.prs),e.cache.set(ke,C.prs.length),e.cache.refreshBadge?.())}catch(C){e.toast(`Couldn't remove PR \u2014 ${C instanceof Error?C.message:String(C)}`,"error")}},[e]),ye=Z(async x=>{let C=i.find(w=>w.url===x);if(C)try{let w;C.source==="auto"?w=await e.call("dismissPr",{url:x}):w=await e.call("removePr",x),w?.ok&&Array.isArray(w.prs)&&(n(w.prs),e.cache.set(te,w.prs),e.cache.set(ke,w.prs.length),e.cache.refreshBadge?.())}catch(w){e.toast(`Couldn't dismiss PR \u2014 ${w instanceof Error?w.message:String(w)}`,"error")}},[e,i]),ia=Z(async x=>{s(x);let C=await e.storage.get(Pa),w={...x};C&&(w.organizations=C.organizations,w.repositories=C.repositories,w.author=C.author,w.orgDiscovered=C.orgDiscovered,w.authorDiscovered=C.authorDiscovered),await e.storage.set(Pa,w),e.cache.set("settings",w),e.cache.refreshBadge?.()},[e]),aa=Z(async()=>{let x=await e.storage.get(Pa);x?.repositories&&s(C=>C&&{...C,repositories:x.repositories})},[e]),oe=Z(async(x,C)=>{try{let w=await e.call("assignProject",x,C);w?.ok&&Array.isArray(w.prs)&&(n(w.prs),e.cache.set(te,w.prs))}catch(w){e.toast(`Couldn't assign project \u2014 ${w instanceof Error?w.message:String(w)}`,"error")}},[e]),re=Z((x,C)=>{$(x),k(C),e.storage.set(Xr,{field:x,dir:C})},[e]),we=Z(x=>{pe(x),e.storage.set(Kr,x)},[e]),ue=Z(x=>{Le(x),e.storage.set(Nt,x)},[e]),ne=Z(async(x,C)=>{if(x.length!==0)try{let w=await e.call("setPrsSeen",{urls:x,seen:C});w?.ok&&Array.isArray(w.prs)&&(n(w.prs),e.cache.set(te,w.prs),e.cache.set("monitoredCount",w.prs.length),e.cache.refreshBadge?.())}catch(w){e.toast(`Couldn't update read state \u2014 ${w instanceof Error?w.message:String(w)}`,"error")}},[e]),da=Z(async(x,C)=>{if(x.length!==0)try{let w=await e.call("setPrsFavorite",{urls:x,favorite:C});w?.ok&&Array.isArray(w.prs)&&(n(w.prs),e.cache.set(te,w.prs))}catch(w){e.toast(`Couldn't update favorites \u2014 ${w instanceof Error?w.message:String(w)}`,"error")}},[e]),Xe=Z(async x=>{if(x.length!==0)try{let C=await e.call("dismissPrs",{urls:x});C?.ok&&Array.isArray(C.prs)&&(n(C.prs),e.cache.set(te,C.prs),e.cache.set(ke,C.prs.length),e.cache.refreshBadge?.())}catch(C){e.toast(`Couldn't dismiss PRs \u2014 ${C instanceof Error?C.message:String(C)}`,"error")}},[e]),ce=ee(()=>{if(_.length===0)return i;let x=new Set(_.map(C=>C.toLowerCase()));return i.filter(C=>x.has(C.repo.toLowerCase()))},[i,_]),Me=ee(()=>ce.filter(x=>Ar.includes(x.status)).map(x=>x.url),[ce]),Te=ee(()=>Gr(H),[H]);return c?m!==null?a("section",{className:"prm-panel",children:o("div",{className:"prm-empty",role:"alert",children:[a(Ge,{size:28,"aria-hidden":!0}),a("h3",{children:"Couldn't load PR Monitor"}),a("p",{children:m}),o("button",{type:"button",className:"prm-btn",onClick:()=>R(x=>x+1),children:[a(Pe,{size:13,"aria-hidden":!0})," Retry loading"]})]})}):t?o("section",{className:"prm-panel",children:[o("header",{className:"prm-header",children:[o("div",{className:"prm-header-title",children:[a(xe,{size:16,className:"prm-header-icon","aria-hidden":!0}),o("div",{className:"prm-header-heading",children:[a("h2",{children:L==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:L==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),L==="prs"&&a("span",{className:"prm-count-pill",children:ce.length})]}),o("div",{className:"prm-header-actions",children:[L==="prs"&&o(ae,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>M(!0),title:"Add a specific pull request to the monitored list",children:[a(_a,{size:13})," ",a("span",{children:"Add PR"})]}),Me.length>0&&o("button",{type:"button",className:"prm-btn",onClick:()=>void Xe(Me),title:`Sweep \u2014 dismiss the ${Me.length} Merged/Closed PR(s) from the list`,children:[a(ie,{size:13})," ",a("span",{children:"Sweep"})]}),o("div",{className:"prm-split-btn",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>void Re(_),disabled:u,title:_.length>0?`Sync the ${_.length} selected repositor${_.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[u?a(V,{size:13,className:"prm-spin"}):a(Pe,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:J,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>K(x=>!x),disabled:u,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker","aria-haspopup":"menu","aria-expanded":D,children:a(ya,{size:13})}),D&&a(Tr,{anchorRef:J,host:e,selectedRepos:_,onClose:()=>K(!1),onToggleRepo:x=>v(C=>C.includes(x)?C.filter(w=>w!==x):[...C,x]),onSelectAll:()=>v([]),onSync:x=>void Re(x)})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":L==="settings",onClick:()=>me(L==="settings"?"prs":"settings"),title:L==="settings"?"Back to pull requests":"Settings",children:L==="settings"?o(ae,{children:[a(Oa,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):o(ae,{children:[a(Xa,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]})]}),o("div",{className:`prm-content${L==="prs"&&E==="board"?" prm-content--board":""}`,children:[f&&a("div",{className:"prm-error",children:f}),L==="prs"&&Te&&o("div",{className:`prm-sync-clue prm-sync-clue--${Te.kind}`,role:"status",children:[Te.kind==="disconnect"&&a(Ja,{size:14,"aria-hidden":!0}),Te.kind==="remote-gone"&&a(Ge,{size:14,"aria-hidden":!0}),Te.kind==="outage"&&a(za,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:Te.message}),Te.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>me("settings"),children:"Open Settings"})]}),L==="prs"&&H.remoteGone.map(x=>o("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${x} is gone`,children:[o("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:x})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),o("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>void ea(x,"keep"),children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>void ea(x,"remove"),children:"Remove"})]})]},x)),L==="prs"&&a(Rr,{prs:ce,host:e,projects:Se,tisWarnHours:t.tisWarnHours,tisDangerHours:t.tisDangerHours,reviewWarnDays:t.reviewWarnDays,reviewDangerDays:t.reviewDangerDays,repositories:t.repositories,workItemLocatorBase:t.gusLocatorBaseUrl,sortField:z,sortDir:Y,onSortChange:re,hostScope:fe,onHostScopeChange:we,awaitingFirstSync:!Ae,syncing:u,autoSyncEnabled:t.autoSyncEnabled??!0,onDismiss:x=>void ye(x),onProjectAssign:(x,C)=>void oe(x,C),onBulkSetSeen:(x,C)=>void ne(x,C),onBulkDismiss:x=>void Xe(x),onBulkSetFavorite:(x,C)=>void da(x,C),viewMode:E,onViewModeChange:ue}),L==="settings"&&r&&a(Ur,{settings:t,onSave:x=>void ia(x),onRepositoriesChanged:()=>void aa(),host:e})]}),U&&a(Mr,{host:e,onClose:()=>M(!1),onPulled:x=>{n(x),e.cache.set(te,x),e.cache.set(ke,x.length),e.cache.refreshBadge?.(),M(!1)}})]}):a("section",{className:"prm-panel",children:a(or,{onSave:async x=>{await ia(x)}})}):a("section",{className:"prm-panel",children:o("div",{className:"prm-loading",children:[a(V,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})})}function Zr(e){if(e.length!==0)return e.length===1?e[0]:e}var Ft=new Map,Jr,Js=5e3;function Et(e){Jr=e}function Ys(){return{get:e=>Ft.get(e),set:(e,t)=>{Ft.set(e,t)},delete:e=>{Ft.delete(e)},refreshBadge:()=>Jr?.()}}function Qs(e,t){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,t)}function en(e){try{let t=new URL(e);if(t.protocol!=="https:"&&t.protocol!=="http:"||typeof window>"u")return;window.open(t.href,"_blank","noopener,noreferrer")}catch{}}function Yr(e){let t=[],s=!1,r=0,l=async()=>{if(!(s||Date.now()<r)){s=!0;try{let i=await ua(e,"listProjects");Array.isArray(i)&&(t=i)}catch{}finally{r=Date.now()+Js,s=!1}}};return l(),{call:(i,...n)=>ua(e,i,Zr(n)),storage:{get:i=>ua(e,"storageGet",i),set:async(i,n)=>{await ua(e,"storageSet",{key:i,value:n})}},cache:Ys(),toast:Qs,listProjects:()=>(l(),t),openExternal:en,pushInbox:async i=>i.projectId?await ua(e,"pushInbox",i):{id:""}}}var Ht="prs-changed";var Ot=`/*
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
`;var es="pr-monitor",Qr="prm-plugin-styles";function tn(){return globalThis.__ZCC_PLUGIN_RUNTIME__}function on(){if(typeof document>"u")return;let e=document.getElementById(Qr);if(e instanceof HTMLStyleElement){e.textContent=`${Rt}
${Ot}`;return}let t=document.createElement("style");t.id=Qr,t.textContent=`${Rt}
${Ot}`,document.head.appendChild(t)}on();var rn={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function sn(){let e=ee(()=>Yr(es),[]);return bt(Ht,t=>{let s=t?.prs;Array.isArray(s)&&(e.cache.set(te,s),e.cache.set(ke,s.length),e.cache.refreshBadge?.())}),a("div",{style:rn,children:a(Bt,{host:e})})}function nn(){let[e,t]=d(null),s=se(!0),r=se(0),l=Z(async()=>{let i=++r.current;try{let n=await ua(es,"badge");if(!s.current||i!==r.current)return;let u=typeof n?.count=="number"&&n.count>0?n.count:null;t(u)}catch(n){if(!s.current||i!==r.current)return;console.warn("[pr-monitor] badge refresh failed",n),t(null)}},[]);return W(()=>(s.current=!0,l(),Et(()=>{s.current&&l()}),()=>{s.current=!1,r.current++,Et(void 0)}),[l]),bt(Ht,i=>{(async()=>{let n=Array.isArray(i?.inAppDeltas)?i.inAppDeltas:[];if(l(),n.length===0)return;let u=tn();for(let b of n)u?.toast?.(`${b.pr.repo}#${b.pr.number}: ${De(b.oldStatus)} -> ${De(b.newStatus)}`,"info")})().catch(n=>console.warn("[pr-monitor] notification delivery failed",n))}),e==null?null:a("span",{className:"nav-badge",children:e})}var Ep=$t(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:sn,experimental_sidebarAccessory:nn}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:t=>{t.toPluginPanel("main")}})});export{Ep as default,on as injectStyles};
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
