var j=globalThis.__ZCC_HOST_REACT__;var vn=j.Children,Pn=j.Component,kn=j.Fragment,An=j.StrictMode,Rn=j.Suspense,Mn=j.cloneElement,Wt=j.createContext,Ba=j.createElement,Tn=j.createRef,ft=j.forwardRef,Dn=j.isValidElement,Nn=j.lazy,Bn=j.memo,Fn=j.startTransition,W=j.useCallback,Xt=j.useContext,En=j.useDebugValue,Hn=j.useDeferredValue,_=j.useEffect,Kt=j.useId,On=j.useImperativeHandle,qn=j.useInsertionEffect,Zt=j.useLayoutEffect,Y=j.useMemo,zn=j.useReducer,oe=j.useRef,f=j.useState,Jt=j.useSyncExternalStore,Un=j.useTransition,_n=j.version;function bs(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Ls(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}async function pa(e,t,s){return bs().callRpc(e,t,s)}function Yt(e){return{__zccPluginApp:!0,setup:e}}function pt(e,t){Ls().useRealtime?.(e,t)}var Qt=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();function eo(e,t,s=[]){if(t==null)throw new Error("[lucide]: iconNode is required when icon name is used");return{name:Qt(e),size:24,node:t,...s.length>0?{aliases:s}:{}}}var ao=e=>{let t="",s=!1;for(let r of e){if(r==="-"||r==="_"||r<=" "){s=t.length>0;continue}t.length===0?t+=r.toLowerCase():t+=s?r.toUpperCase():r,s=!1}return t};var to=e=>{let t=ao(e);return t.charAt(0).toUpperCase()+t.slice(1)};var _a=(...e)=>e.filter((t,s,r)=>!!t&&t.trim()!==""&&r.indexOf(t)===s).join(" ").trim();var ma={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};function At(e){return e!=null}function oo(e,t={}){let s=t.attributeNames??{},r=b=>s[b]??b,l=e.size??e.width??ma.width,i=e.size??e.height??ma.height,d=e.aliases?.filter(b=>typeof b=="string"&&b.trim()!=="").map(b=>`lucide-${b}`)??[],m=[...e.name?[`lucide-${e.name}`]:[],...d],L=t.className?.split(" ").filter(Boolean)??[],g=t.includeDefaultClasses===!1?_a(...L):_a("lucide",...m,...L),I=t.absoluteStrokeWidth?Number(t.strokeWidth??ma["stroke-width"])*Number(e.size??e.width??ma.width)/Number(t.size??t.width??ma.width):t.strokeWidth??ma["stroke-width"];return["svg",{...Object.entries(ma).reduce((b,[p,y])=>(b[r(p)]=y,b),{}),..."color"in t&&t.color&&{[r("stroke")]:t.color},..."size"in t&&At(t.size)&&{[r("width")]:t.size,[r("height")]:t.size},..."width"in t&&At(t.width)&&{[r("width")]:t.width},..."height"in t&&At(t.height)&&{[r("height")]:t.height},[r("stroke-width")]:I,...g&&{[r("class")]:g},[r("viewBox")]:`0 0 ${l} ${i}`,...t.hasA11yProp===!1?{[r("aria-hidden")]:"true"}:{},..."attributes"in t&&t.attributes},e.node.map(b=>{let[p,y,c]=b,u=t.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...y}:y;return c?[p,u,c]:[p,u]})]}function ro(e,t={}){return oo(e,{...t,attributeNames:{...t.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}var so=e=>{for(let t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};var Is=Wt({});var no=()=>Xt(Is);var lo=ft(({color:e,size:t,width:s,height:r,strokeWidth:l,absoluteStrokeWidth:i,nonScalingStroke:d,className:m="",children:L,iconNode:g=[],icon:I={node:g,aliases:[],size:24},...C},b)=>{let{size:p=24,strokeWidth:y=2,absoluteStrokeWidth:c=!1,nonScalingStroke:u=!1,color:v="currentColor",className:R=""}=no()??{},z=!!L||so(C),[M,B,X=[]]=ro(I,{color:e??v,width:s??t??p,height:r??t??p,strokeWidth:l??y,absoluteStrokeWidth:i??c,nonScalingStroke:d??u,className:_a(R,m),hasA11yProp:z,attributes:C});return Ba(M,{ref:b,...B},[...X.map(([F,E])=>Ba(F,E)),...Array.isArray(L)?L:[L]])});function x(e,t=[],s=[]){let r=typeof e=="string"?eo(e,t,s):e,l=ft(({className:i,...d},m)=>Ba(lo,{ref:m,icon:r,className:i,...d}));return r.name&&(l.displayName=to(r.name)),l}var io={name:"arrow-down",size:24,node:[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]]};io.node;var Ga=x(io);var uo={name:"arrow-left",size:24,node:[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]};uo.node;var Fa=x(uo);var co={name:"arrow-up",size:24,node:[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]]};co.node;var Va=x(co);var fo={name:"bell-off",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]]};fo.node;var sa=x(fo);var po={name:"bell",size:24,node:[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]]};po.node;var Fe=x(po);var mo={name:"book-bookmark",size:24,node:[["path",{d:"M10 2v7.751a.25.25 0 00.407.195l2.28-1.834a.5.5 0 01.627 0l2.28 1.834A.25.25 0 0016 9.751V2",key:"x9x4jl"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 016.5 2H19a1 1 0 011 1v18a1 1 0 01-1 1H6.5a1 1 0 010-5H20",key:"1889un"}]],aliases:["book-marked"]};mo.node;var ga=x(mo);var go={name:"building-complex",size:24,node:[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],aliases:["building-2"]};go.node;var ha=x(go);var ho={name:"check",size:24,node:[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]};ho.node;var Ue=x(ho);var xo={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};xo.node;var ka=x(xo);var bo={name:"chevron-right",size:24,node:[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]};bo.node;var na=x(bo);var Lo={name:"circle-alert",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],aliases:["alert-circle"]};Lo.node;var we=x(Lo);var Io={name:"circle-check",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 9-5.5 5.5L8 12",key:"xofnsj"}]],aliases:["check-circle-2"]};Io.node;var ge=x(Io);var Co={name:"circle-dashed",size:24,node:[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]]};Co.node;var ja=x(Co);var So={name:"circle-question-mark",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["help-circle","circle-help"]};So.node;var Ee=x(So);var yo={name:"circle-x",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],aliases:["x-circle"]};yo.node;var ve=x(yo);var wo={name:"clock",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]]};wo.node;var He=x(wo);var vo={name:"cloud-off",size:24,node:[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};vo.node;var $a=x(vo);var Po={name:"columns-3",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],aliases:["panels-left-right"]};Po.node;var xa=x(Po);var ko={name:"download",size:24,node:[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]]};ko.node;var Wa=x(ko);var Ao={name:"ellipsis",size:24,node:[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]],aliases:["more-horizontal"]};Ao.node;var ba=x(Ao);var Ro={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};Ro.node;var Oe=x(Ro);var Mo={name:"eye-off",size:24,node:[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};Mo.node;var Xa=x(Mo);var To={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};To.node;var Ka=x(To);var Do={name:"folder-git-2",size:24,node:[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]]};Do.node;var Za=x(Do);var No={name:"folder-search",size:24,node:[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]]};No.node;var Ea=x(No);var Bo={name:"folder",size:24,node:[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]};Bo.node;var Ja=x(Bo);var Fo={name:"git-branch",size:24,node:[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]]};Fo.node;var _e=x(Fo);var Eo={name:"git-merge",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]]};Eo.node;var la=x(Eo);var Ho={name:"git-pull-request-closed",size:24,node:[["path",{d:"m15.5 3.5 5 5",key:"1kmx7t"}],["path",{d:"m15.5 8.5 5-5",key:"saftza"}],["path",{d:"M18 11.62V15",key:"1greaj"}],["path",{d:"M6 9v12",key:"1sc30k"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}]]};Ho.node;var ia=x(Ho);var Oo={name:"git-pull-request-draft",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};Oo.node;var Ze=x(Oo);var qo={name:"git-pull-request",size:24,node:[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]]};qo.node;var he=x(qo);var zo={name:"globe",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]};zo.node;var Ya=x(zo);var Uo={name:"layout-list",size:24,node:[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]]};Uo.node;var Qa=x(Uo);var _o={name:"link-2",size:24,node:[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]]};_o.node;var Ge=x(_o);var Go={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};Go.node;var U=x(Go);var Vo={name:"mail-open",size:24,node:[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]]};Vo.node;var Je=x(Vo);var jo={name:"mail",size:24,node:[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]]};jo.node;var da=x(jo);var $o={name:"panel-left-close",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],aliases:["sidebar-close"]};$o.node;var La=x($o);var Wo={name:"pen",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],aliases:["edit-2"]};Wo.node;var Ye=x(Wo);var Xo={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};Xo.node;var Ha=x(Xo);var Ko={name:"refresh-cw",size:24,node:[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]};Ko.node;var Ie=x(Ko);var Zo={name:"search",size:24,node:[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]]};Zo.node;var Ia=x(Zo);var Jo={name:"settings",size:24,node:[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};Jo.node;var et=x(Jo);var Yo={name:"shield-alert",size:24,node:[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]]};Yo.node;var at=x(Yo);var Qo={name:"sliders-horizontal",size:24,node:[["path",{d:"M10 5H3",key:"1qgfaw"}],["path",{d:"M12 19H3",key:"yhmn1j"}],["path",{d:"M14 3v4",key:"1sua03"}],["path",{d:"M16 17v4",key:"1q0r14"}],["path",{d:"M21 12h-9",key:"1o4lsq"}],["path",{d:"M21 19h-5",key:"1rlt1p"}],["path",{d:"M21 5h-7",key:"1oszz2"}],["path",{d:"M8 10v4",key:"tgpxqk"}],["path",{d:"M8 12H3",key:"a7s4jb"}]]};Qo.node;var tt=x(Qo);var er={name:"sparkles",size:24,node:[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],aliases:["stars"]};er.node;var qe=x(er);var ar={name:"square-check-big",size:24,node:[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],aliases:["check-square"]};ar.node;var Ca=x(ar);var tr={name:"star",size:24,node:[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]]};tr.node;var Re=x(tr);var or={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};or.node;var le=x(or);var rr={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};rr.node;var Ve=x(rr);var sr={name:"users",size:24,node:[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]]};sr.node;var ot=x(sr);var nr={name:"wifi-off",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};nr.node;var rt=x(nr);var lr={name:"wifi",size:24,node:[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]]};lr.node;var Aa=x(lr);var ir={name:"wrench",size:24,node:[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]]};ir.node;var st=x(ir);var dr={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};dr.node;var je=x(dr);var lt={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},mt="standard",nt={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},gt="standard";function Cs(e){let t=e?.buildTisPreset??e?.tisPreset;return t&&t in lt?t:mt}function ur(e,t){let s=(e??"").toLowerCase();return s?(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function it(e,t,s,r){let l=ur(e,t);if(l){let i=lt[Cs(l)];return{warnHours:i.warnHours,dangerHours:i.dangerHours}}return{warnHours:s,dangerHours:r}}function Rt(e,t,s,r){let l=ur(e,t);if(l){let i=l.reviewTisPreset&&l.reviewTisPreset in nt?l.reviewTisPreset:gt,d=nt[i];return{warnDays:d.warnDays,dangerDays:d.dangerDays}}return{warnDays:s,dangerDays:r}}var cr={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},Mt="organizations",Ra={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:Mt,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},Pe="monitoredCount",re="monitoredPrs",Ma="settings",dt="prefetch:orgs",Tt="prefetch:repos",Dt="prefetch:author",Ss=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function Nt(e){let t=Ss.exec(e);if(!t)throw new Error(`Not a GitHub PR URL: ${e}`);return t[1]}var ys={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function Bt(e){return ys[e]}var ws={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function Ft(e){return ws[e]}var vs=/\bW-\d{8}\b/i;function Sa(e,t,s){for(let r of[e,t,s]){if(typeof r!="string"||!r)continue;let l=vs.exec(r);if(l)return l[0].toUpperCase()}}function ht(e,t){if(!e||!t||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(t)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${t.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var Ps=Symbol.for("react.portal");function ya(e,t){return{$$typeof:Ps,key:null,children:e,containerInfo:t,implementation:null}}var fr=globalThis.__ZCC_HOST_REACT__,K=fr.Fragment;function a(e,t,s){return fr.createElement(e,s===void 0?t:{...t,key:s})}var o=a;function de({title:e,icon:t,onClose:s,busy:r=!1,children:l,footer:i,wide:d=!1,className:m="",titleId:L,closeLabel:g="Close",backdropTestId:I}){let C=Kt(),b=L??C,p=oe(null),y=oe(typeof document>"u"?null:document.activeElement),c=oe({onClose:s,busy:r});c.current={onClose:s,busy:r},_(()=>{let v=y.current,R=p.current;R.focus();let z=M=>{if(M.defaultPrevented)return;let B=document.querySelectorAll(".prm-modal");if(B[B.length-1]===R){if(M.key==="Escape")M.preventDefault(),c.current.busy||c.current.onClose();else if(M.key==="Tab"){let X=Array.from(R.querySelectorAll("button, [href], input, select, textarea, [tabindex]")).filter($=>$.tabIndex>=0&&!$.matches(":disabled")&&!$.closest("[hidden], [inert]")&&getComputedStyle($).display!=="none"&&getComputedStyle($).visibility!=="hidden"),F=X[0],E=X[X.length-1];F?M.shiftKey&&(document.activeElement===F||document.activeElement===R)?(M.preventDefault(),E.focus()):!M.shiftKey&&(document.activeElement===E||document.activeElement===R)&&(M.preventDefault(),F.focus()):(M.preventDefault(),R.focus())}}};return window.addEventListener("keydown",z),()=>{window.removeEventListener("keydown",z),v?.isConnected&&v.focus()}},[]);let u=a("div",{className:"modal-backdrop prm-modal-backdrop","data-testid":I,onClick:v=>{v.target===v.currentTarget&&!r&&s()},children:o("div",{ref:p,tabIndex:-1,role:"dialog","aria-modal":"true","aria-labelledby":b,className:`modal prm-modal${d?" prm-modal--wide":""} ${m}`,children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:b,children:[t&&a("span",{className:"prm-modal-icon","aria-hidden":!0,children:t}),e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close","aria-label":g,children:a(je,{size:16,"aria-hidden":!0})})]}),l,i]})});return typeof document>"u"?u:ya(u,document.body)}function Me(e){let t=Date.now(),s=Math.max(0,t-e),r=Math.floor(s/1e3);if(r<60)return"just now";let l=Math.floor(r/60);if(l<60)return`${l}m ago`;let i=Math.floor(l/60);if(i<24)return`${i}h ago`;let d=Math.floor(i/24);if(d===1)return"yesterday";if(d<30)return`${d}d ago`;let m=Math.floor(d/30);return m<12?`${m}mo ago`:`${Math.floor(m/12)}y ago`}var ks={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function xe(e){return ks[e]}function pr(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function xt(e){let t=0,s=0,r=0;for(let l of e){let i=l.state.toUpperCase();i==="SUCCESS"||i==="PASS"||i==="PASSED"?t++:i==="FAILURE"||i==="FAILED"||i==="ERROR"||i==="CANCELLED"?s++:r++}return{pass:t,fail:s,pending:r}}var As={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function mr(e){return As[e.toUpperCase()]??"pending"}function Oa(e){return{label:xe(e),className:`prm-status-pill--${e}`}}var $e=4,We=6,Ta=3,Da=5;function wa(e){if(!e)return"";let t=Math.max(0,Date.now()-e),s=Math.floor(t/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function va(e,t){let s=t==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function Pa(e){let t=e.name||e.login,s=t.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():t.slice(0,2).toUpperCase()}var gr="(max-width: 1024px)";function Rs(e){let t=window.matchMedia?.(gr);return t?.addEventListener("change",e),()=>t?.removeEventListener("change",e)}function bt(){return Jt(Rs,()=>window.matchMedia?.(gr).matches??!1,()=>!1)}function hr({query:e,onQuery:t,status:s,onStatus:r,statuses:l,hosts:i,hostScope:d,onHostScope:m,sortField:L,sortDir:g,onSort:I,sortFields:C,shownCount:b}){let[p,y]=f(!1),c=s!=="all"||d.length>0;return o(K,{children:[o("div",{className:"prm-mobile-toolbar",children:[o("div",{className:"prm-search",children:[a(Ia,{size:18,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026","aria-label":"Search PRs",value:e,onChange:u=>t(u.target.value)})]}),o("button",{type:"button",className:`prm-btn${c?" is-active":""}`,"aria-haspopup":"dialog","aria-expanded":p,onClick:()=>y(!0),children:[a(tt,{size:18,"aria-hidden":!0})," Filters",c&&a("span",{className:"prm-mobile-filter-dot"})]})]}),o("div",{className:"prm-mobile-summary","aria-live":"polite",children:[o("span",{children:[b," pull request",b===1?"":"s",s!=="all"&&` \xB7 ${xe(s)}`]}),c&&a("button",{type:"button",className:"prm-text-btn",onClick:()=>{r("all"),m([])},children:"Clear filters"})]}),p&&a(de,{title:"Filter pull requests",closeLabel:"Close PR filters",onClose:()=>y(!1),footer:a("footer",{className:"prm-modal-footer",children:o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>y(!1),children:["Show ",b," pull request",b===1?"":"s"]})}),children:o("div",{className:"prm-modal-body prm-mobile-filters",children:[o("label",{className:"prm-field",children:["Status",o("select",{"aria-label":"Status",className:"prm-input",value:s,onChange:u=>r(u.target.value),children:[a("option",{value:"all",children:"All statuses"}),l.map(({id:u,count:v})=>o("option",{value:u,children:[xe(u)," (",v,")"]},u))]})]}),o("label",{className:"prm-field",children:["Sort by",a("select",{"aria-label":"Sort by",className:"prm-input",value:L,onChange:u=>I(u.target.value,g),children:C.map(({id:u,label:v})=>a("option",{value:u,children:v},u))})]}),o("label",{className:"prm-field",children:["Order",o("select",{"aria-label":"Order",className:"prm-input",value:g,disabled:L==="favorites",onChange:u=>I(L,u.target.value),children:[a("option",{value:"asc",children:"Ascending"}),a("option",{value:"desc",children:"Descending"})]})]}),o("fieldset",{className:"prm-mobile-hosts",children:[a("legend",{children:"Git hosts"}),a("button",{type:"button",className:"prm-btn","aria-pressed":d.length===0,onClick:()=>m([]),children:"All hosts"}),i.map(u=>o("label",{children:[a("input",{type:"checkbox",checked:d.includes(u),onChange:()=>m(d.includes(u)?d.filter(v=>v!==u):[...d,u])}),u]},u))]})]})})]})}function xr({prs:e,onOpen:t}){return a("div",{className:"prm-mobile-list",children:e.map(s=>{let r=s.lastSeenAt===0||s.lastStatusChange>(s.lastSeenAt??s.addedAt),l=Oa(s.status);return o("button",{type:"button",className:`prm-mobile-card${r?" is-unread":""}`,onClick:()=>t(s),children:[o("span",{className:"prm-mobile-card-repo",children:[a(Ja,{size:14,"aria-hidden":!0}),a("span",{children:s.repo}),o("span",{children:["#",s.number]}),s.favorite&&a(Re,{size:14,fill:"currentColor","aria-label":"Favorite"})]}),a("span",{className:"prm-mobile-card-title",children:s.title}),o("span",{className:"prm-mobile-card-meta",children:[a("span",{className:`prm-status-pill ${l.className}`,children:l.label}),s.isDraft&&a("span",{children:"Draft"}),s.author&&a("span",{className:"prm-mobile-author",children:s.author.name||s.author.login}),a("span",{className:"prm-mobile-card-time",children:Me(s.updatedAt||s.lastChecked||s.lastStatusChange)})]}),s.syncError&&o("span",{className:"prm-mobile-sync-error",children:[a(we,{size:14,"aria-hidden":!0}),"Sync failed \xB7 Open for details"]})]},s.url)})})}function br({onSave:e}){let[t,s]=f(!1),r=async()=>{s(!0);try{await e({...Ra})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:o("div",{className:"prm-setup",children:[a(he,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{r()},disabled:t,children:t?"Saving\u2026":"Get started"})})]})})}async function me(e,t,s){try{let r=await e.call(t,s);if(!r?.ok)throw new Error(r?.error||"The request failed. Please try again.");Array.isArray(r.prs)&&(e.cache.set(re,r.prs),e.cache.set(Pe,r.prs.length),e.cache.refreshBadge())}catch(r){e.toast(`Couldn't update PR \u2014 ${r instanceof Error?r.message:String(r)}`,"error")}}var Ms=new Set(["fail","failure"]),Ts=new Set(["pending","in_progress","queued"]);function Ds(e){return(e??"").toLowerCase().trim()||"pending"}function Ns(e,t){if(!t||t.length===0)return!1;let s=(e??"").toLowerCase();return t.some(r=>{let l=(r??"").toLowerCase();return l.length>0&&s.includes(l)})}function qa(e,t={}){if(!e||e.length===0)return!1;let s=t.ignoredFailingChecks;for(let r of e){let l=Ds(r.bucket||r.state);if(Ts.has(l)||Ms.has(l)&&!Ns(r.name,s))return!1}return!0}function za(e){let{status:t,buildHappy:s,reviewApproved:r,sfciGated:l,hasSfciJob:i,elapsedHours:d,warnHours:m,dangerHours:L}=e;if(t==="integrating"||t==="closed-merged"||t==="closed-abandoned")return"done";let g=l&&!i;return s&&r&&t==="yellow"?g?"blocked":d>=L?"merge-stall":d>=m?"warn":"ok":s?"done":g?"blocked":d>=L?"danger":d>=m?"warn":"ok"}function Lt(e){let{reviewApproved:t,merged:s,elapsedDays:r,warnDays:l,dangerDays:i}=e;return t&&!s?"done":r>=i?"danger":r>=l?"warn":"ok"}function Bs(e){if(typeof document>"u")return!1;let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.top="-9999px",t.setAttribute("readonly",""),document.body.appendChild(t);try{return t.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(t)}}async function Ua(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return Bs(e)}var It=4,Ct=8,Lr=120,Fs=320,Es=280;function Hs(e,t){let s=t.innerHeight-e.bottom-It-Ct,r=e.top-It-Ct,l=s<Lr&&r>s,i=Math.max(Lr,Math.min(Fs,l?r:s)),d=Math.max(Ct,Math.min(e.left,t.innerWidth-Es-Ct));return l?{left:d,bottom:t.innerHeight-e.top+It,maxHeight:i}:{left:d,top:e.bottom+It,maxHeight:i}}function St({projectId:e,projects:t,onAssign:s}){let r=oe(null),l=oe(null),[i,d]=f(!1),[m,L]=f(null),g=t.find(p=>p.id===e),I=!!g;_(()=>{if(!i)return;let p=r.current;p&&L(Hs(p.getBoundingClientRect(),window))},[i]),_(()=>{if(!i||!m)return;let p=l.current;(p?.querySelector(".is-active")??p?.querySelector("button")??p)?.focus()},[i,m]);let C=()=>{d(!1),r.current?.focus()},b=I?`Associated with ${g.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return o(K,{children:[o("button",{ref:r,type:"button",className:`prm-project-row ${I?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:b,"aria-label":b,"aria-haspopup":"menu","aria-expanded":i,onClick:p=>{p.stopPropagation(),d(y=>!y)},children:[a(Za,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:I?g.name:"Not associated with a project"})]}),i&&m&&typeof document<"u"&&ya(o(K,{children:[a("div",{className:"prm-project-menu-backdrop",onClick:p=>{p.stopPropagation(),C()}}),o("div",{ref:l,className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...m},role:"menu","aria-label":"Associate a project",tabIndex:-1,onKeyDown:p=>{if(p.key==="Escape"||p.key==="Tab")p.preventDefault(),p.stopPropagation(),C();else if(["ArrowDown","ArrowUp","Home","End"].includes(p.key)){p.preventDefault(),p.stopPropagation();let y=Array.from(p.currentTarget.querySelectorAll("button")),c=y.indexOf(document.activeElement),u=p.key==="Home"?0:p.key==="End"?y.length-1:(c+(p.key==="ArrowDown"?1:-1)+y.length)%y.length;y[u]?.focus()}},children:[t.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),I&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:p=>{p.stopPropagation(),s(null),C()},children:"Clear association"}),t.map(p=>a("button",{type:"button",className:`prm-project-menu-item ${p.id===e?"is-active":""}`,role:"menuitem",onClick:y=>{y.stopPropagation(),s(p.id),C()},children:p.name},p.id))]})]}),document.body)]})}function yt({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(t=>{let s=mr(t.state);return o("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:t.name}),t.bucket&&a("span",{className:"prm-check-bucket",children:t.bucket}),a("span",{className:"prm-check-state",title:t.state,children:t.state.toLowerCase()})]},`${t.bucket??""}/${t.name}`)})})}function Ir(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}var Os=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],qs=["seen","favorite","mute","dismiss"];function Cr({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:l,reviewWarnDays:i,reviewDangerDays:d,sfciGated:m=!1,ignoredFailingChecks:L,workItemLocatorBase:g,selected:I,onToggleSelect:C,onDismiss:b,onProjectAssign:p}){let[y,c]=f(!1),[u,v]=f(!1),R=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),z=e.workItem??Sa(e.title,e.headRefName,e.body),M=ht(z,g),B=Oa(e.status),X=e.status==="closed-merged"||e.status==="closed-abandoned",F=!!e.muted,E=!!e.favorite,$=!!e.syncError,w=e.checks??[],O=xt(w),G=e.reviewDecision==="APPROVED",V=e.buildHappy??qa(w,{ignoredFailingChecks:L}),k=za({status:e.status,buildHappy:V,reviewApproved:G,sfciGated:m,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??$e,dangerHours:l??We}),ne=wa(e.lastStatusChange),ie=k==="merge-stall"||k==="danger"?"danger":k==="warn"?"warn":"ok",H=k==="done"?"Build \u2713":k==="merge-stall"?"Merge stalled":va(ie,"build"),Te=k==="done"?"done":ie,De=!e.isDraft&&!X,N=e.status==="closed-merged",q=Lt({reviewApproved:G,merged:N,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:i??Ta,dangerDays:d??Da}),T=wa(e.reviewClockStartedAt),Z=q==="danger"?"danger":q==="warn"?"warn":"ok",fe=q==="done"?"Review \u2713":va(Z,"review"),Ce=q==="done"?"done":Z,Q=e.reviewers??[],ke={"changes-requested":Q.filter(A=>A.state==="changes-requested"),"review-requested":Q.filter(A=>A.state==="review-requested"),approved:Q.filter(A=>A.state==="approved")},ea=Q.length>0,ee=()=>{Ir(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},aa=e.isDraft?Ze:e.status==="closed-merged"?la:e.status==="closed-abandoned"?ia:he,ua=async()=>{R&&await me(t,"markPrAsSeen",{url:e.url})},ta=async()=>{await me(t,R?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},Se=async()=>{await me(t,"setPrMuted",{url:e.url,muted:!F})},be=async()=>{await me(t,"setPrFavorite",{url:e.url,favorite:!E})},ae=async A=>{A.stopPropagation(),v(!0);try{await me(t,"retryPr",{url:e.url})}finally{v(!1)}},ye=async(A,h)=>{await Ua(A)?t.toast(`${h} copied`,"info"):t.toast(`Failed to copy ${h}`,"error")},Ne=w.length>0,te=Ne?` \u2014 click to ${y?"hide":"show"} checks`:"",ue=A=>{A.stopPropagation(),c(h=>!h)},Le=A=>{(A.key==="Enter"||A.key===" ")&&(A.preventDefault(),ue(A))},Be=A=>Ne?{role:"button",tabIndex:0,"aria-expanded":y,title:A,"data-tip":A,onClick:ue,onKeyDown:Le}:{},Na=Ne?" prm-tip prm-checks-trigger":"",Xe=`${B.label} \u2014 overall PR status${te}`,pe=`${O.pass} passing, ${O.fail} failing, ${O.pending} running`,ze=k==="done"?"Build passing":k==="merge-stall"?"Merge stalled":k==="blocked"?"Build waiting (SFCI job not yet created)":H||"Build running",Ke=`${ze} \xB7 ${ne} in build phase \xB7 ${pe}${te}`,ca=q==="done"?"Review approved":fe||"Awaiting review",oa=`${ca} \xB7 ${T} in review${te}`,ra=`${pe}${te}`,fa={seen:{Icon:R?Je:da,label:R?"Mark read":"Mark unread",title:R?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:Re,label:E?"Unfavorite":"Favorite",title:E?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:E},mute:{Icon:F?sa:Fe,label:F?"Unmute":"Mute",title:F?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:le,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},ce=A=>{A==="seen"?ta():A==="favorite"?be():A==="mute"?Se():b(e.url)};return o("div",{className:`prm-tile ${R?"prm-tile--unread":""} ${X?"prm-tile--closed":""} ${$?"prm-tile--stale":""} ${E?"prm-tile--favorite":""} ${I?"prm-tile--selected":""}`,onClick:ua,role:"button",tabIndex:0,onKeyDown:A=>{(A.key==="Enter"||A.key===" ")&&(A.preventDefault(),ua())},children:[o("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:I,title:I?"Deselect this PR":"Select this PR","aria-label":I?"Deselect this PR":"Select this PR",onClick:A=>A.stopPropagation(),onChange:A=>{A.stopPropagation(),C(e.url)}}),a(aa,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),o("span",{className:"prm-tile-title",children:[z&&o("span",{className:"prm-tile-workitem-inline",children:["@",z,": "]}),e.title.replace(new RegExp(`(?:^|@)${z}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${B.className} prm-tip${Na}`,title:Xe,"data-tip":Xe,...Be(Xe),children:B.label}),Ne?o("span",{className:`prm-tis prm-tis--${Te} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":y,title:Ke,"data-tip":Ke,"aria-label":`${ze}, ${ne} in build phase`,onClick:ue,onKeyDown:Le,children:[ne,H&&o("span",{className:"prm-tis-cue",children:[" ",H]})]}):o("span",{className:`prm-tis prm-tis--${Te} prm-tip`,title:Ke,"data-tip":Ke,"aria-label":`${ze}, ${ne} in build phase`,children:[ne,H&&o("span",{className:"prm-tis-cue",children:[" ",H]})]}),De&&(T||fe)&&(Ne?o("span",{className:`prm-tis prm-tis--review prm-tis--${Ce} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":y,title:oa,"data-tip":oa,"aria-label":`${ca}, ${T} in review`,onClick:ue,onKeyDown:Le,children:[T,fe&&o("span",{className:"prm-tis-cue",children:[" ",fe]})]}):o("span",{className:`prm-tis prm-tis--review prm-tis--${Ce} prm-tip`,title:oa,"data-tip":oa,"aria-label":`${ca}, ${T} in review`,children:[T,fe&&o("span",{className:"prm-tis-cue",children:[" ",fe]})]})),w.length>0&&o("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${O.pass} passed, ${O.fail} failed, ${O.pending} running`,...Be(ra),children:[O.pass>0&&o("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(Ue,{size:9})," ",O.pass]}),O.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(je,{size:9})," ",O.fail]}),O.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(He,{size:9})," ",O.pending]})]}),F&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(sa,{size:11})}),$&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(we,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:u,onClick:A=>{ae(A)},children:a(Ie,{size:10,className:u?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:qs.map(A=>{let h=fa[A],S=h.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${h.danger?" prm-tile-icon-btn--danger":""}${h.active?" prm-tile-icon-btn--active":""}`,title:h.title,"data-tip":h.label,"aria-label":h.label,"aria-pressed":h.active,onClick:n=>{n.stopPropagation(),ce(A)},children:a(S,{size:13,...h.active?{fill:"currentColor"}:{}})},A)})})]}),o("div",{className:"prm-tile-line2",children:[z&&(M?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${z}`,onClick:A=>{A.stopPropagation(),Ir(M)&&t.openExternal(M)},children:z}):a("span",{className:"prm-workitem-chip",children:z})),a("span",{className:"prm-tile-repo",children:e.repo}),o("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:A=>{A.stopPropagation(),ee()},children:a(Oe,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:A=>{A.stopPropagation(),ye(e.url,"PR link")},children:a(Ge,{size:10})})]}),e.author&&o("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:Pa(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-tile-line3",children:[a(_e,{size:10,className:"prm-branch-icon","aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:A=>{A.stopPropagation(),ye(e.headRefName,"Branch name")},children:a(Ge,{size:10})})]}),ea&&a("div",{className:"prm-reviewers",children:Os.map(({state:A,label:h,className:S})=>{let n=ke[A];return n.length===0?null:o("span",{className:`prm-reviewers-group ${S}`,title:h,children:[a("span",{className:"prm-reviewers-label",children:h}),n.map(P=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:P.name||P.login,"aria-label":`${h}: ${P.name||P.login}`,children:Pa(P)},P.login))]},A)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(St,{projectId:e.projectId,projects:s,onAssign:A=>p(e.url,A)}),y&&w.length>0&&a("div",{className:"prm-tile-checks",onClick:A=>A.stopPropagation(),children:a(yt,{checks:w})})]})}function wt(e,t,s=!1){let r=oe(null),l=oe(t);l.current=t;let[i,d]=f({top:0,left:0,maxHeight:400});return Zt(()=>{let m=r.current,L=e.current;if(!m||!L)return;let g=()=>{let C=L.getBoundingClientRect(),b=Math.max(12,Math.min(C.bottom+6,window.innerHeight-160)),p=m.getBoundingClientRect().width,y=Math.max(12,Math.min(s?C.right-p:C.left,window.innerWidth-p-12));d({top:b,left:y,maxHeight:window.innerHeight-b-12})};g(),m.querySelector("button:not(:disabled)")?.focus();let I=C=>{if(!C.defaultPrevented){if(C.key==="Escape")C.preventDefault(),l.current();else if(C.key==="Tab")l.current();else if(["ArrowDown","ArrowUp","Home","End"].includes(C.key)){let b=Array.from(m.querySelectorAll("button:not(:disabled)"));if(!b.length)return;C.preventDefault();let p=b.indexOf(document.activeElement),y=C.key==="Home"?0:C.key==="End"?b.length-1:(p+(C.key==="ArrowDown"?1:-1)+b.length)%b.length;b[y].focus()}}};return window.addEventListener("resize",g),window.addEventListener("keydown",I),()=>{window.removeEventListener("resize",g),window.removeEventListener("keydown",I),L.isConnected&&L.focus({preventScroll:!0})}},[e,s]),{ref:r,position:i}}function Sr({anchorRef:e,hosts:t,selectedHosts:s,onClose:r,onToggleHost:l,onSelectAll:i,shortHost:d}){let{ref:m,position:L}=wt(e,r,!1);if(typeof document>"u")return null;let g=s.length===0;return ya(o(K,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:I=>{I.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-host-filter",ref:m,style:{position:"fixed",...L},"aria-label":"Host filter",role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),o("button",{type:"button",className:`prm-project-menu-item ${g?"is-active":""}`,role:"menuitemcheckbox","aria-checked":g,onClick:I=>{I.stopPropagation(),i()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:g&&a(Ue,{size:12})}),"All hosts"]}),t.map(I=>{let C=s.includes(I);return o("button",{type:"button",className:`prm-project-menu-item ${C?"is-active":""}`,role:"menuitemcheckbox","aria-checked":C,onClick:b=>{b.stopPropagation(),l(I)},title:`Filter to ${I}`,children:[a("span",{className:"prm-sync-filter-check",children:C&&a(Ue,{size:12})}),d(I)]},I)})]})]}),document.body)}var zs='button, a, input, textarea, select, [contenteditable="true"]';function yr(e){return!e||typeof e.closest!="function"?!1:e.closest(zs)!==null}function wr(e,t,s){return{left:e.left-(t-e.x),top:e.top-(s-e.y)}}function Et(){let e=oe(null),[t,s]=f(!1),r=W(d=>{let m=e.current;!m||m.id!==d.pointerId||(e.current=null,s(!1),d.currentTarget.hasPointerCapture(d.pointerId)&&d.currentTarget.releasePointerCapture(d.pointerId))},[]),l=W(d=>{d.button!==0||yr(d.target)||(e.current={id:d.pointerId,x:d.clientX,y:d.clientY,left:d.currentTarget.scrollLeft,top:d.currentTarget.scrollTop},d.currentTarget.setPointerCapture(d.pointerId),s(!0))},[]),i=W(d=>{let m=e.current;if(!m||m.id!==d.pointerId)return;let L=wr(m,d.clientX,d.clientY);d.currentTarget.scrollLeft=L.left,d.currentTarget.scrollTop=L.top},[]);return{isPanning:t,canvasPanProps:{onPointerDown:l,onPointerMove:i,onPointerUp:r,onPointerCancel:r}}}var Ht=`.zcc-kanban {
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
`;function _s(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function vr({children:e,className:t="",label:s,columnWidth:r}){let{isPanning:l,canvasPanProps:i}=Et();return a("div",{role:"list","aria-label":s,className:["zcc-kanban",l?"is-panning":"",t].filter(Boolean).join(" "),style:_s(r),...i,children:e})}function Pr({children:e,className:t="",columnId:s,label:r,count:l,icon:i,badge:d,collapsed:m=!1,onToggleCollapse:L,onContextMenu:g,onDragOver:I,onDragLeave:C,onDrop:b}){let p=m?`Expand ${r}`:`Collapse ${r}`;return o("section",{role:"listitem",className:["zcc-kanban-col",m?"is-collapsed":"",t].filter(Boolean).join(" "),"aria-label":`${r} (${l})`,"data-kanban-column":s,"data-board-column":s,"data-collapsed":m?"true":"false",onContextMenu:g,onDragOver:I,onDragLeave:C,onDrop:b,children:[o("header",{className:"zcc-kanban-col-header",children:[i?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:i}):null,a("span",{className:"zcc-kanban-col-title",children:r}),a("span",{className:"zcc-kanban-col-count",children:l}),d,L?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:p,"aria-label":p,"aria-expanded":!m,onClick:()=>L(s),children:m?a(na,{size:13}):a(La,{size:13})}):null]}),m?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}var Ot=["conflict","failed","yellow","review-required","pending","integrating","green"],kr=["closed-merged","closed-abandoned"],Ar={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function qt(e){return e==="list"||e==="board"}function Gs(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function vt(e){let t=Gs();for(let s of e)t[s.status].push(s);return t}function Rr(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var Mr=[...Ot,...kr];function Tr(e){return typeof e=="string"&&Mr.includes(e)}function Dr(e,t={}){let s=Rr(e);return t.showEmpty?[...Ot,...kr.filter(r=>s[r]>0)]:Mr.filter(r=>s[r]>0)}function Nr(e){let t=Rr(e);return Ot.filter(s=>t[s]===0).length}function Br(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Vs(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function js(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Fr({pr:e,host:t,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:l,selected:i,selectionActive:d=!1,selectMode:m=!1,onToggleSelect:L,onDismiss:g,onOpen:I}){let[C,b]=f(!1),p=js(e),y=e.status==="closed-merged"||e.status==="closed-abandoned",c=!!e.favorite,u=!!e.syncError,v=e.workItem??Sa(e.title,e.headRefName,e.body),R=v?e.title.replace(new RegExp(`(?:^|@)${v}[:\\s]*`,"i"),""):e.title,z=e.checks??[],M=xt(z),B=e.updatedAt||e.lastChecked||e.lastStatusChange,X=e.buildHappy??qa(z,{ignoredFailingChecks:l}),F=za({status:e.status,buildHappy:X,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??$e,dangerHours:r??We}),E=F==="merge-stall"?"Merge stalled":F==="warn"||F==="danger"?va(F,"build"):"",$=F==="merge-stall"||F==="danger"?"danger":F==="warn"?"warn":"",w=i||m||d,O=async()=>{p&&await me(t,"markPrAsSeen",{url:e.url})},G=async()=>{await me(t,"setPrFavorite",{url:e.url,favorite:!c})},V=()=>{Vs(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},k=async()=>{b(!0);try{await me(t,"retryPr",{url:e.url})}finally{b(!1)}},ne=()=>{I(e.url),O()},ie=H=>{if(H.metaKey||H.ctrlKey||m){L(e.url);return}ne()};return o("article",{className:["prm-board-card",p?"prm-board-card--unread":"",y?"prm-board-card--closed":"",c?"prm-board-card--favorite":"",i?"prm-board-card--selected":"",u?"prm-board-card--stale":"",w?"prm-board-card--selectable":"",m?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:ie,onPointerDown:H=>H.stopPropagation(),onKeyDown:H=>{H.target===H.currentTarget&&(H.key==="Enter"||H.key===" ")&&(H.preventDefault(),m||H.metaKey||H.ctrlKey?L(e.url):ne())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[o("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:i,title:i?"Deselect this PR":"Select this PR","aria-label":i?"Deselect this PR":"Select this PR",onClick:H=>H.stopPropagation(),onChange:H=>{H.stopPropagation(),L(e.url)}}),o("span",{className:"prm-board-card-id",children:[o("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",title:e.repo,children:Br(e.repo)})]}),v&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:v}),o("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${c?" prm-tile-icon-btn--active":""}`,title:c?"Unfavorite":"Favorite","data-tip":c?"Unfavorite":"Favorite","aria-label":c?"Unfavorite":"Favorite","aria-pressed":c,onClick:H=>{H.stopPropagation(),G()},children:a(Re,{size:12,...c?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:H=>{H.stopPropagation(),V()},children:a(Oe,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:H=>{H.stopPropagation(),g(e.url)},children:a(le,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:R}),o("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:Pa(e.author)}),E?o("span",{className:`prm-tis prm-tis--${$} prm-board-card-stall`,children:[wa(e.lastStatusChange)," ",E]}):B>0&&a("span",{className:"prm-board-card-time",children:Me(B)}),M.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${M.fail} checks failing`,children:[a(je,{size:9})," ",M.fail]}),M.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${M.pending} checks running`,children:[a(He,{size:9})," ",M.pending]}),e.isDraft&&o("span",{className:"prm-draft-pill prm-board-card-draft",children:[a(Ze,{size:10,"aria-hidden":!0})," Draft"]}),u&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(we,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:C,onClick:H=>{H.stopPropagation(),k()},children:a(Ie,{size:10,className:C?"prm-spin":""})})]})]})]})}var $s={conflict:at,failed:ve,yellow:Ve,"review-required":Ka,pending:ja,integrating:U,green:ge,"closed-merged":la,"closed-abandoned":ia};function Er({prs:e,host:t,tisWarnHours:s,tisDangerHours:r,repositories:l,selected:i,selectMode:d=!1,showEmpty:m=!1,collapsed:L,onToggleCollapse:g,onToggleSelect:I,onDismiss:C,onOpen:b}){let p=Y(()=>vt(e),[e]),y=Y(()=>Dr(p,{showEmpty:m}),[p,m]),c=i.size>0||d;return a(vr,{label:"Pull requests by status",className:"prm-board",children:y.map(u=>{let v=p[u],R=$s[u],z=L.has(u),M=v.filter(B=>B.lastSeenAt===0||B.lastStatusChange>(B.lastSeenAt??B.addedAt)).length;return a(Pr,{columnId:u,className:`prm-board-col--${u}`,label:Ar[u],count:v.length,icon:a(R,{size:14,"aria-hidden":!0}),badge:M>0?a("span",{className:"zcc-kanban-col-badge",title:`${M} unread`,children:M}):null,collapsed:z,onToggleCollapse:B=>g(B),children:v.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):v.map(B=>{let X=it(B.repo,l,s??$e,r??We),F=(l??[]).find(E=>`${E.owner}/${E.repo}`.toLowerCase()===B.repo.toLowerCase());return a(Fr,{pr:B,host:t,tisWarnHours:X.warnHours,tisDangerHours:X.dangerHours,ignoredFailingChecks:F?.ignoredFailingChecks,selected:i.has(B.url),selectionActive:c,selectMode:d,onToggleSelect:I,onDismiss:C,onOpen:b},B.url)})},u)})})}var Ws=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function Hr(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function Xs(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function Or({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:l,reviewWarnDays:i,reviewDangerDays:d,sfciGated:m=!1,ignoredFailingChecks:L,workItemLocatorBase:g,onClose:I,onDismiss:C,onProjectAssign:b}){let[p,y]=f(!1),[c,u]=f(!1),v=(e.body?.length??0)>600,R=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),z=e.status==="closed-merged"||e.status==="closed-abandoned",M=!!e.muted,B=!!e.favorite,X=!!e.syncError,F=e.workItem??Sa(e.title,e.headRefName,e.body),E=ht(F,g),$=F?e.title.replace(new RegExp(`(?:^|@)${F}[:\\s]*`,"i"),""):e.title,w=Oa(e.status),O=e.checks??[],G=e.reviewers??[],V={"changes-requested":G.filter(ae=>ae.state==="changes-requested"),"review-requested":G.filter(ae=>ae.state==="review-requested"),approved:G.filter(ae=>ae.state==="approved")},k=Xs(e),ne=e.reviewDecision==="APPROVED",ie=e.buildHappy??qa(O,{ignoredFailingChecks:L}),H=za({status:e.status,buildHappy:ie,reviewApproved:ne,sfciGated:m,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??$e,dangerHours:l??We}),Te=wa(e.lastStatusChange),De=H==="merge-stall"||H==="danger"?"danger":H==="warn"?"warn":"ok",N=H==="done"?"Build \u2713":H==="merge-stall"?"Merge stalled":va(De,"build"),q=H==="done"?"done":De,T=!e.isDraft&&!z,Z=Lt({reviewApproved:ne,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:i??Ta,dangerDays:d??Da}),fe=wa(e.reviewClockStartedAt),Ce=Z==="danger"?"danger":Z==="warn"?"warn":"ok",Q=Z==="done"?"Review \u2713":va(Ce,"review"),ke=Z==="done"?"done":Ce,ea=e.isDraft?Ze:e.status==="closed-merged"?la:e.status==="closed-abandoned"?ia:he,ee=()=>{Hr(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},aa=async(ae,ye)=>{await Ua(ae)?t.toast(`${ye} copied`,"info"):t.toast(`Failed to copy ${ye}`,"error")},ua=async()=>{await me(t,R?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},ta=async()=>{await me(t,"setPrMuted",{url:e.url,muted:!M})},Se=async()=>{await me(t,"setPrFavorite",{url:e.url,favorite:!B})},be=async()=>{y(!0);try{await me(t,"retryPr",{url:e.url})}finally{y(!1)}};return o(de,{title:o("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]}),icon:a(ea,{size:18}),titleId:"prm-detail-title",closeLabel:"Close PR details",backdropTestId:"prm-detail-backdrop",className:"prm-modal--detail",onClose:I,children:[o("div",{className:"prm-modal-body prm-detail-body",children:[o("div",{className:"prm-detail-heading",children:[F&&(E?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${F}`,onClick:()=>{Hr(E)&&t.openExternal(E)},children:F}):a("span",{className:"prm-workitem-chip",children:F})),a("h4",{className:"prm-detail-pr-title",children:$})]}),o("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${w.className}`,children:w.label}),e.isDraft&&o("span",{className:"prm-draft-pill",children:[a(Ze,{size:10,"aria-hidden":!0})," Draft"]}),M&&o("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(sa,{size:11,"aria-hidden":!0})," Muted"]}),Te&&o("span",{className:`prm-tis prm-tis--${q}`,children:[Te,N&&o("span",{className:"prm-tis-cue",children:[" ",N]})]}),T&&(fe||Q)&&o("span",{className:`prm-tis prm-tis--review prm-tis--${ke}`,children:[fe,Q&&o("span",{className:"prm-tis-cue",children:[" ",Q]})]})]}),k&&a("div",{className:"prm-detail-hint",children:k}),X&&o("div",{className:"prm-detail-sync-error",role:"alert",children:[a(we,{size:12,"aria-hidden":!0}),o("span",{children:["Couldn't sync this PR: ",e.syncError]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:p,"aria-label":"Retry syncing this PR",onClick:()=>{be()},children:[a(Ie,{size:11,className:p?"prm-spin":""})," Retry"]})]}),o("div",{className:"prm-detail-grid",children:[o("div",{className:"prm-detail-main",children:[o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Checks"}),a(yt,{checks:O})]}),e.body&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Description preview"}),a("div",{className:"prm-detail-desc",id:"prm-description-preview",children:v&&!c?`${e.body.slice(0,600).trimEnd()}\u2026`:e.body}),v&&a("button",{type:"button",className:"prm-text-btn","aria-expanded":c,"aria-controls":"prm-description-preview",onClick:()=>u(ae=>!ae),children:c?"Collapse preview":"Expand preview"}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-detail-description-link",onClick:ee,children:["Read full description on GitHub ",a(Oe,{size:12,"aria-hidden":!0})]})]})]}),o("aside",{className:"prm-detail-sidebar","aria-label":"Pull request information",children:[o("dl",{className:"prm-detail-facts",children:[e.author&&o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),o("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:Pa(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:Me(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:Me(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:Me(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Branches"}),o("div",{className:"prm-detail-branch",children:[a(_e,{size:12,"aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>{aa(e.headRefName,"Branch name")},children:a(Ge,{size:10})})]})]}),G.length>0&&o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:Ws.map(({state:ae,label:ye,className:Ne})=>{let te=V[ae];return te.length===0?null:o("span",{className:`prm-reviewers-group ${Ne}`,title:ye,children:[a("span",{className:"prm-reviewers-label",children:ye}),te.map(ue=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:ue.name||ue.login,"aria-label":`${ye}: ${ue.name||ue.login}`,children:Pa(ue)},ue.login))]},ae)})})]}),o("div",{className:"prm-detail-section",children:[a("h4",{className:"prm-detail-label",children:"Project"}),a(St,{projectId:e.projectId,projects:s,onAssign:ae=>b(e.url,ae)})]})]})]})]}),o("footer",{className:"prm-modal-footer prm-detail-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:ee,title:"Open on GitHub",children:[a(Oe,{size:13}),a("span",{children:"Open on GitHub"})]}),o("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>{aa(e.url,"PR link")},children:[a(Ge,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${B?" prm-tile-icon-btn--active":""}`,title:B?"Unfavorite":"Favorite","data-tip":B?"Unfavorite":"Favorite","aria-label":B?"Unfavorite":"Favorite","aria-pressed":B,onClick:()=>{Se()},children:a(Re,{size:13,...B?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:M?"Unmute":"Mute","data-tip":M?"Unmute":"Mute","aria-label":M?"Unmute":"Mute","aria-pressed":M,onClick:()=>{ta()},children:M?a(sa,{size:13}):a(Fe,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:R?"Mark this PR as read":"Mark this PR as unread","data-tip":R?"Mark read":"Mark unread","aria-label":R?"Mark read":"Mark unread",onClick:()=>{ua()},children:R?a(Je,{size:13}):a(da,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>C(e.url),children:a(le,{size:13})})]})]})}var qr=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],Gr=["closed-merged","closed-abandoned"],zr=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function Ks(e,t){let s=e.favorite?1:0,r=t.favorite?1:0;return s!==r?r-s:t.lastStatusChange-e.lastStatusChange}function ut(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Zs(e,t){return e.length>0&&e.every(r=>{let l=t.find(i=>i.url===r);return l?!!l.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function Js(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Ys(e){let t=e.workItem??Sa(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),xe(e.status),e.headRefName??"",e.baseRefName??"",t,e.repo,Js(e.repo)].join("").toLowerCase()}var Ur="boardShowEmpty",_r="boardCollapsed";function Vr({prs:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:l,reviewWarnDays:i,reviewDangerDays:d,repositories:m,workItemLocatorBase:L,sortField:g,sortDir:I,onSortChange:C,hostScope:b,onHostScopeChange:p,awaitingFirstSync:y,syncing:c,autoSyncEnabled:u,onDismiss:v,onProjectAssign:R,onBulkSetSeen:z,onBulkDismiss:M,onBulkSetFavorite:B,viewMode:X="list",onViewModeChange:F,request:E}){let $=bt(),[w,O]=f("all"),[G,V]=f(""),[k,ne]=f(new Set),[ie,H]=f(!1),[Te,De]=f(X),[N,q]=f(!1),[T,Z]=f(!1),[fe,Ce]=f(()=>new Set),[Q,ke]=f(null),ea=oe(null),ee=$?"list":F?X:Te,aa=n=>{n==="board"&&O("all"),n==="list"&&q(!1),F?F(n):De(n)};_(()=>{let n=!0;return t.storage.get(Ur).then(P=>{n&&typeof P=="boolean"&&Z(P)}),t.storage.get(_r).then(P=>{!n||!Array.isArray(P)||Ce(new Set(P.filter(Tr)))}),()=>{n=!1}},[t]);let ua=n=>{Z(n),t.storage.set(Ur,n)},ta=n=>{Ce(P=>{let D=new Set(P);return D.has(n)?D.delete(n):D.add(n),t.storage.set(_r,[...D]),D})},Se=Y(()=>{let n=[];for(let P of e){let D=Nt(P.url);n.includes(D)||n.push(D)}return n},[e]),be=Y(()=>{if(b.length===0)return e;let n=new Set(b);return e.filter(P=>n.has(Nt(P.url)))},[e,b]),ae=Y(()=>{let n=new Map;for(let P of be)n.set(P.status,(n.get(P.status)??0)+1);return n},[be]),ye=Y(()=>ee==="board"||w==="all"?be:be.filter(n=>n.status===w),[be,w,ee]),Ne=Y(()=>{let n=G.trim().toLowerCase();return n?ye.filter(P=>Ys(P).includes(n)):ye},[ye,G]),te=Y(()=>{let n=I==="asc"?1:-1,P=[...Ne];return g==="favorites"?(P.sort(Ks),P):(P.sort((D,J)=>{let se=0;switch(g){case"created":se=(D.createdAt??0)-(J.createdAt??0);break;case"status":se=Ft(D.status)-Ft(J.status);break;case"statusUpdated":se=D.lastStatusChange-J.lastStatusChange;break;default:se=(D.updatedAt||D.lastChecked||D.lastStatusChange)-(J.updatedAt||J.lastChecked||J.lastStatusChange);break}if(se===0){let Ae=ut(D)?1:0,ct=ut(J)?1:0;return Ae!==ct?ct-Ae:(J.createdAt??0)-(D.createdAt??0)}return se*n}),P)},[Ne,g,I]),ue=Y(()=>Nr(vt(te)),[te]);_(()=>{E&&(E.query!==void 0&&V(E.query),E.revealUrl&&ke(E.revealUrl))},[E]);let Le=Q?e.find(n=>n.url===Q):void 0;_(()=>{Q&&!Le&&ke(null)},[Q,Le]);let Be=Y(()=>{if(!Le)return null;let n=it(Le.repo,m,r??$e,l??We),P=Rt(Le.repo,m,i??Ta,d??Da),D=(m??[]).find(J=>`${J.owner}/${J.repo}`.toLowerCase()===Le.repo.toLowerCase());return{tisWarnHours:n.warnHours,tisDangerHours:n.dangerHours,reviewWarnDays:P.warnDays,reviewDangerDays:P.dangerDays,sfciGated:D?.sfciGated===!0,ignoredFailingChecks:D?.ignoredFailingChecks}},[Le,m,r,l,i,d]),Na=Y(()=>be.filter(ut).length,[be]),Xe=Y(()=>te.map(n=>n.url),[te]),pe=Y(()=>Xe.filter(n=>k.has(n)),[Xe,k]),ze=te.length>0&&pe.length===te.length,Ke=pe.length>0&&!ze,ca=n=>{ne(P=>{let D=new Set(P);return D.has(n)?D.delete(n):D.add(n),D})},oa=()=>{ne(ze||Ke?new Set:new Set(Xe))},ra=()=>ne(new Set),fa=pe.length>0?pe:Xe,ce=fa.every(n=>{let P=e.find(D=>D.url===n);return P?!ut(P):!0}),A=Zs(pe,e);if(e.length===0){if(y){let n=c||u;return o("div",{className:"prm-empty",children:[n?a(U,{size:32,className:"prm-spin","aria-hidden":!0}):a(he,{size:32,"aria-hidden":!0}),a("h3",{children:n?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:n?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return o("div",{className:"prm-empty",children:[a(he,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let S=o("div",{className:"prm-list-toolbar",children:[o("div",{className:"prm-list-controls",children:[o("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":ee==="list",title:"List view",onClick:()=>aa("list"),children:[a(Qa,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":ee==="board",title:"Board view",onClick:()=>aa("board"),children:[a(xa,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),ee==="list"&&a("label",{className:"prm-select-all",title:ze?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:ze,ref:n=>{n&&(n.indeterminate=Ke)},onChange:oa,"aria-label":ze?"Clear selection":"Select all shown PRs"})}),ee==="list"&&o("span",{className:"prm-shown-count","aria-live":"polite",children:[te.length," shown"]}),o("div",{className:"prm-search",children:[a(Ia,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:G,onChange:n=>V(n.target.value),"aria-label":"Search PRs"})]}),o("button",{type:"button",ref:ea,className:`prm-btn prm-btn--sm ${b.length>0?"is-active":""}`,onClick:()=>H(n=>!n),title:"Filter by host","aria-expanded":ie,children:[a(Ya,{size:12}),o("span",{children:["Host",b.length>0&&o("span",{className:"prm-unread-count",children:[" (",b.length,")"]})]}),a(ka,{size:12})]}),ie&&a(Sr,{anchorRef:ea,hosts:Se,selectedHosts:b,onClose:()=>H(!1),onToggleHost:n=>p(b.includes(n)?b.filter(P=>P!==n):[...b,n]),onSelectAll:()=>p([]),shortHost:pr}),ee==="board"&&o(K,{children:[o("button",{type:"button",className:`prm-btn prm-btn--sm ${N?"is-active":""}`,"aria-pressed":N,title:"Select cards for bulk actions",onClick:()=>q(n=>!n),children:[a(Ca,{size:12}),a("span",{children:"Select"})]}),ue>0&&o("button",{type:"button",className:`prm-btn prm-btn--sm ${T?"is-active":""}`,"aria-pressed":T,title:T?"Hide empty columns":`Show ${ue} empty column${ue===1?"":"s"}`,onClick:()=>ua(!T),children:[a(Xa,{size:12}),a("span",{children:T?"Hide empty":`Empty (${ue})`})]})]}),ee==="list"&&o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>z(fa,!ce),title:pe.length>0?`Mark the ${pe.length} selected PR(s) ${ce?"unread":"read"}`:`Mark all shown PRs ${ce?"unread":"read"}`,children:[a(Je,{size:12}),o("span",{children:[ce?"Mark unread":"Mark read",Na>0&&o("span",{className:"prm-unread-count",children:[" (",Na,")"]})]})]}),ee==="list"&&o("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:g,onChange:n=>C(n.target.value,I),"aria-label":"Sort field",children:zr.map(n=>a("option",{value:n.id,title:n.title,children:n.label},n.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>C(g,I==="asc"?"desc":"asc"),disabled:g==="favorites",title:g==="favorites"?"Favorites first uses a fixed order":I==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":I==="asc"?"Sorted ascending":"Sorted descending",children:I==="asc"?a(Va,{size:12}):a(Ga,{size:12})})]})]}),ee==="list"&&o("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[o("button",{type:"button",role:"tab","aria-selected":w==="all",className:`prm-segment-tab ${w==="all"?"active":""}`,onClick:()=>O("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:be.length})]}),qr.map(n=>{let P=ae.get(n)??0;return o("button",{type:"button",role:"tab","aria-selected":w===n,className:`prm-segment-tab prm-segment-tab--${n} ${w===n?"active":""}`,onClick:()=>O(n),title:`Show PRs in "${xe(n)}"`,children:[xe(n)," ",a("span",{className:"prm-segment-count",children:P})]},n)})]}),pe.length>0&&o("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:ra,title:"Clear selection","aria-label":"Clear selection",children:a(je,{size:12})}),o("span",{className:"prm-bulk-count",children:[pe.length," selected"]}),o("div",{className:"prm-bulk-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>z(pe,!ce),title:`Mark the selected PR(s) ${ce?"unread":"read"}`,children:[ce?a(da,{size:12}):a(Je,{size:12}),a("span",{children:ce?"Mark unread":"Mark read"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>B(pe,A.favorite),title:`${A.label} the selected PR(s)`,children:[a(Re,{size:12,...A.favorite?{}:{fill:"currentColor"}}),a("span",{children:A.label})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{M(pe),ra()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(le,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return o("div",{className:`prm-list${ee==="board"?" prm-list--board":""}`,children:[$?a(hr,{query:G,onQuery:V,status:w,onStatus:O,statuses:qr.map(n=>({id:n,count:ae.get(n)??0})),hosts:Se,hostScope:b,onHostScope:p,sortField:g,sortDir:I,onSort:C,sortFields:zr,shownCount:te.length}):S,te.length===0?o("div",{className:"prm-empty prm-empty--filtered",children:[a(Ia,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:G.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),o("div",{className:"prm-empty-actions",children:[G.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>V(""),title:"Clear search",children:"Clear search"}),w!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>O("all"),title:"Show all PRs",children:"Show all"})]})]}):$?a(xr,{prs:te,onOpen:n=>{ke(n.url),ut(n)&&me(t,"markPrAsSeen",{url:n.url})}}):ee==="board"?a(Er,{prs:te,host:t,tisWarnHours:r,tisDangerHours:l,repositories:m,selected:k,selectMode:N,showEmpty:T,collapsed:fe,onToggleCollapse:ta,onToggleSelect:ca,onDismiss:v,onOpen:ke}):a("div",{className:"prm-tile-list",children:te.map(n=>{let P=it(n.repo,m,r??$e,l??We),D=Rt(n.repo,m,i??Ta,d??Da),J=(m??[]).find(se=>`${se.owner}/${se.repo}`.toLowerCase()===n.repo.toLowerCase());return a(Cr,{pr:n,host:t,projects:s,tisWarnHours:P.warnHours,tisDangerHours:P.dangerHours,reviewWarnDays:D.warnDays,reviewDangerDays:D.dangerDays,sfciGated:J?.sfciGated===!0,ignoredFailingChecks:J?.ignoredFailingChecks,workItemLocatorBase:L,selected:k.has(n.url),onToggleSelect:ca,onDismiss:v,onProjectAssign:R},n.url)})}),Le&&Be&&a(Or,{pr:Le,host:t,projects:s,tisWarnHours:Be.tisWarnHours,tisDangerHours:Be.tisDangerHours,reviewWarnDays:Be.reviewWarnDays,reviewDangerDays:Be.reviewDangerDays,sfciGated:Be.sfciGated,ignoredFailingChecks:Be.ignoredFailingChecks,workItemLocatorBase:L,onClose:()=>ke(null),onDismiss:n=>{ke(null),v(n)},onProjectAssign:R})]})}function jr({host:e,onClose:t,onPulled:s}){let[r,l]=f([]),[i,d]=f(!1),[m,L]=f(""),[g,I]=f(""),[C,b]=f(!1),[p,y]=f(null);_(()=>{let v=!0;return e.call("listRepos").then(R=>{if(!v)return;let z=(R?.repos??[]).filter(M=>M.active&&M.connection==="connected");l(z),z.length>0&&L(`${z[0].host}|${z[0].owner}/${z[0].repo}`),d(!0)}).catch(()=>{v&&d(!0)}),()=>{v=!1}},[e]);let c=Y(()=>r.find(v=>`${v.host}|${v.owner}/${v.repo}`===m),[r,m]),u=async()=>{if(C)return;y(null);let v=Number(g.trim());if(!c){y("Select a repository.");return}if(!Number.isSafeInteger(v)||v<=0){y("Enter a valid PR number.");return}b(!0);try{let R=await e.call("pullPr",{host:c.host,fullName:`${c.owner}/${c.repo}`,number:v});R?.ok&&Array.isArray(R.prs)?s(R.prs):y(R?.error||"Failed to pull PR.")}catch(R){y(R instanceof Error?R.message:String(R))}finally{b(!1)}};return o(de,{title:"Add PR",titleId:"prm-pull-title",icon:a(he,{size:16}),onClose:t,busy:C,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),i&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):o("select",{className:"prm-input prm-input--select",value:m,onChange:v=>L(v.target.value),disabled:C||!i,"aria-label":"Repository",children:[!i&&a("option",{children:"Loading\u2026"}),r.map(v=>{let R=`${v.host}|${v.owner}/${v.repo}`;return o("option",{value:R,children:[v.owner,"/",v.repo," (",v.shortHost,")"]},R)})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{type:"number",min:1,step:1,"aria-invalid":!!p,"aria-describedby":p?"prm-pull-error":void 0,value:g,placeholder:"e.g. 42",className:"prm-input",onChange:v=>{I(v.target.value),p&&y(null)},onKeyDown:v=>{v.key==="Enter"&&!C&&(v.preventDefault(),u())},disabled:C||r.length===0})]}),p&&a("div",{className:"prm-modal-error",id:"prm-pull-error",role:"alert",children:p})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:C,title:"Cancel without adding",children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{u()},disabled:C||r.length===0||!g.trim(),title:"Add this PR to the monitored list",children:[C?a(U,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]})]})]})}function $r({anchorRef:e,host:t,selectedRepos:s,onClose:r,onToggleRepo:l,onSelectAll:i,onSync:d}){let{ref:m,position:L}=wt(e,r,!0),[g,I]=f([]);if(_(()=>{let b=!0;return t.call("listRepos").then(p=>{b&&I((p?.repos??[]).filter(y=>y.active&&y.connection==="connected"))}).catch(()=>{}),()=>{b=!1}},[t]),typeof document>"u")return null;let C=s.length===0;return ya(o(K,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:b=>{b.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-sync-filter",ref:m,style:{position:"fixed",...L},"aria-label":"Sync & Filter",role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),o("button",{type:"button",className:`prm-project-menu-item ${C?"is-active":""}`,role:"menuitemcheckbox","aria-checked":C,onClick:b=>{b.stopPropagation(),i()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:C&&a(Ue,{size:12})}),"All repositories"]}),g.map(b=>{let p=`${b.owner}/${b.repo}`,y=s.includes(p);return o("button",{type:"button",className:`prm-project-menu-item ${y?"is-active":""}`,role:"menuitemcheckbox","aria-checked":y,onClick:c=>{c.stopPropagation(),l(p)},title:`Filter/sync ${p}`,children:[a("span",{className:"prm-sync-filter-check",children:y&&a(Ue,{size:12})}),p," ",o("span",{className:"prm-sync-filter-host",children:["(",b.shortHost,")"]})]},`${b.host}|${p}`)}),a("div",{className:"prm-tile-menu-divider"}),o("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{d(s),r()},title:C?"Sync all repositories now":"Sync the selected repositories now",children:C?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Qe({title:e,subtitle:t,actions:s}){return o("header",{className:"prm-area-header",children:[o("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:t})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function Pt({state:e}){return e==="checking"?o("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(U,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(ge,{size:11})," Connected"]}):o("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(ve,{size:11})," Disconnected"]})}function kt({title:e,message:t,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:l,busy:i,onConfirm:d,onCancel:m}){return o(de,{title:e,onClose:m,busy:i,children:[a("div",{className:"prm-modal-body",children:t}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:m,disabled:i,children:r}),o("button",{type:"button",className:`prm-btn ${l?"prm-btn--danger":"prm-btn--primary"}`,onClick:d,disabled:i,children:[i?a(U,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function Wr({host:e}){let[t,s]=f(()=>{let u=e.cache.get(dt);return u?.ok&&Array.isArray(u.orgs)?u.orgs:null}),[r,l]=f(null),[i,d]=f(!1),[m,L]=f(null),[g,I]=f(!1),[C,b]=f(!1),p=W(async()=>{try{let u=await e.call("listOrgs");u?.ok&&Array.isArray(u.orgs)?(s(u.orgs),l(null)):(s([]),u?.error&&l(u.error))}catch(u){s([]),l(u instanceof Error?u.message:String(u))}},[e]);_(()=>{p()},[p]);let y=async()=>{d(!0),l(null);try{let u=await e.call("rediscoverOrgs");!u?.ok&&u?.error&&l(u.error),await p()}catch(u){l(u instanceof Error?u.message:String(u))}finally{d(!1)}},c=async()=>{if(m){I(!0);try{let u=await e.call("deleteOrg",{host:m.host,login:m.login});!u?.ok&&u?.error&&e.toast(u.error,"error"),await p()}catch(u){e.toast(u instanceof Error?u.message:String(u),"error")}finally{I(!1),L(null)}}};return o("div",{className:"prm-area",children:[a(Qe,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:o(K,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>{y()},disabled:i,title:"Re-discover organizations from your gh accounts",children:[i?a(U,{size:13,className:"prm-spin"}):a(qe,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>b(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(Ee,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),t===null?o("div",{className:"prm-loading",children:[a(U,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):t.length===0?o("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:t.map(u=>o("div",{className:"prm-entity-card",children:[o("div",{className:"prm-entity-main",children:[o("div",{className:"prm-entity-title",children:[u.login," ",o("span",{className:"prm-entity-host",children:["(",u.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:u.apiBaseUrl}),o("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:u.login})]})]}),o("div",{className:"prm-entity-side",children:[a(Pt,{state:i?"checking":u.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>L(u),title:"Delete organization",children:a(le,{size:15})})]})]},`${u.host}|${u.login}`))}),C&&o(de,{title:"Adding & removing organizations",icon:a(Ee,{size:16}),onClose:()=>b(!1),children:[o("div",{className:"prm-modal-body prm-help-body",children:[o("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),o("ul",{children:[o("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),o("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),o("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),o("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>b(!1),children:a("span",{children:"Got it"})})})]}),m&&a(kt,{title:"Delete organization?",danger:!0,busy:g,message:o(K,{children:["Delete ",a("strong",{children:m.login})," (",m.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>{c()},onCancel:()=>L(null)})]})}function Qs(e,t){try{let s=new URL(t);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(t)}catch{}}function Xr(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function en(e,t){await Ua(t)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Kr({host:e,onRepositoriesChanged:t}){let[s,r]=f(()=>{let w=e.cache.get(Tt);return w?.ok&&Array.isArray(w.repos)?w.repos:null}),[l,i]=f(()=>{let w=e.cache.get(dt);return w?.ok&&Array.isArray(w.orgs)?w.orgs:[]}),[d,m]=f(null),[L,g]=f(!1),[I,C]=f(!1),[b,p]=f(!1),[y,c]=f(null),[u,v]=f("general"),[R,z]=f(null),[M,B]=f(null),[X,F]=f(!1),E=W(async()=>{try{let[w,O]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);w?.ok&&Array.isArray(w.repos)?(r(w.repos),m(null)):(r([]),w?.error&&m(w.error)),i(O?.ok&&Array.isArray(O.orgs)?O.orgs:[])}catch(w){r([]),m(w instanceof Error?w.message:String(w))}},[e]);_(()=>{E()},[E]);let $=async()=>{if(M){F(!0);try{await e.call("deleteRepository",{host:M.host,owner:M.owner,repo:M.repo}),await E()}catch(w){e.toast(w instanceof Error?w.message:String(w),"error")}finally{F(!1),B(null)}}};return o("div",{className:"prm-area",children:[a(Qe,{title:"Repositories",subtitle:"Manage your connected repositories",actions:o(K,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>C(!0),children:[a(qe,{size:13})," ",a("span",{children:"Suggested for you"})]}),o("button",{type:"button",className:"prm-btn",onClick:()=>p(!0),children:[a(Ea,{size:13})," ",a("span",{children:"Browse Repositories"})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>g(!0),children:[a(Ha,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),d&&a("div",{className:"prm-error",children:d}),s===null?o("div",{className:"prm-loading",children:[a(U,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?o("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(w=>o("div",{className:"prm-entity-card prm-repo-card",children:[o("div",{className:"prm-repo-top",children:[o("div",{className:"prm-entity-title",children:[a(_e,{size:14,"aria-hidden":!0})," ",o("span",{children:[w.owner,"/",w.repo]}),a("span",{className:`prm-active-badge${w.active?"":" prm-active-badge--off"}`,children:w.active?"Active":"Inactive"}),a(Pt,{state:w.connection}),(()=>{let O=lt[w.buildTisPreset??w.tisPreset??mt],G=nt[w.reviewTisPreset??gt];return o(K,{children:[o("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${O.warnHours}h, behind schedule after ${O.dangerHours}h`,children:[a(He,{size:11,"aria-hidden":!0}),"Build: ",O.label]}),o("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${G.warnDays}d, behind schedule after ${G.dangerDays}d`,children:[a(He,{size:11,"aria-hidden":!0}),"Review: ",G.label]})]})})()]}),o("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>Qs(e,Xr(w)),children:a(Oe,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>{en(e,Xr(w))},children:a(Ge,{size:14})})]})]}),o("div",{className:"prm-entity-sub prm-repo-meta",children:[o("span",{children:["Organization: ",w.orgLogin," (",w.shortHost,")"]}),o("span",{children:["Created ",Me(w.createdAt)]})]}),o("div",{className:"prm-repo-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>z(w),children:[a(Aa,{size:12})," ",a("span",{children:"Test Connection"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{v("general"),c(w)},children:[a(Ye,{size:12})," ",a("span",{children:"Edit Repository"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{v("status"),c(w)},title:"Status Settings",children:[a(He,{size:12})," ",a("span",{children:"Status Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{v("notifications"),c(w)},title:"Notification Settings",children:[a(Fe,{size:12})," ",a("span",{children:"Notification Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>B(w),children:[a(le,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${w.host}|${w.owner}/${w.repo}`))}),L&&a(an,{host:e,orgs:l,onClose:()=>g(!1),onAdded:async()=>{g(!1),await E()}}),I&&a(tn,{host:e,onClose:()=>C(!1),onAdded:async()=>{await E()}}),b&&a(on,{host:e,onClose:()=>p(!1),onAdded:async()=>{await E()}}),y&&a(rn,{host:e,repo:y,orgs:l,initialTab:u,onClose:()=>c(null),onSaved:async w=>{c(null),Array.isArray(w)&&(e.cache.set(re,w),e.cache.set(Pe,w.length),e.cache.refreshBadge()),t?.(),await E()}}),R&&a(sn,{host:e,repo:R,onClose:()=>z(null),onResult:w=>{let O=w?"connected":"disconnected";r(G=>(G??[]).map(V=>V.host===R.host&&V.owner===R.owner&&V.repo===R.repo?{...V,connection:O}:V))}}),M&&a(kt,{title:"Delete repository?",danger:!0,busy:X,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>{$()},onCancel:()=>B(null)})]})}function an({host:e,orgs:t,onClose:s,onAdded:r}){let[l,i]=f(""),[d,m]=f(t[0]?`${t[0].host}|${t[0].login}`:""),[L,g]=f(null),[I,C]=f(!1),b=async()=>{let p=t.find(y=>`${y.host}|${y.login}`===d);if(!p){g("Please select an organization.");return}C(!0),g(null);try{let y=await e.call("addRepository",{ref:l.trim(),host:p.host,orgLogin:p.login});y?.ok?r():g(y?.error||"Failed to add repository.")}catch(y){g(y instanceof Error?y.message:String(y))}finally{C(!1)}};return o(de,{title:"Add repository",icon:a(Ha,{size:14}),onClose:s,busy:I,children:[o("div",{className:"prm-modal-body",children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:l,spellCheck:!1,onChange:p=>{i(p.target.value),L&&g(null)},onKeyDown:p=>{p.key==="Enter"&&!I&&(p.preventDefault(),b())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),o("select",{className:"prm-input prm-input--select",value:d,onChange:p=>m(p.target.value),children:[t.length===0&&a("option",{value:"",children:"No organizations"}),t.map(p=>o("option",{value:`${p.host}|${p.login}`,children:[p.login," (",p.shortHost,")"]},`${p.host}|${p.login}`))]})]}),L&&a("div",{className:"prm-modal-error",role:"alert",children:L})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:I,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{b()},disabled:I||!l.trim(),children:[I?a(U,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function tn({host:e,onClose:t,onAdded:s}){let[r,l]=f(null),[i,d]=f(new Set),[m,L]=f(null),[g,I]=f(!1),C=W(async()=>{l(null),L(null);try{let c=await e.call("suggestRepositories");c?.ok&&Array.isArray(c.repos)?(l(c.repos),d(new Set(c.repos.filter(u=>u.alreadyAdded).map(u=>u.fullName)))):(l([]),c?.error&&L(c.error))}catch(c){l([]),L(c instanceof Error?c.message:String(c))}},[e]);_(()=>{C()},[C]);let b=c=>{c.alreadyAdded||d(u=>{let v=new Set(u);return v.has(c.fullName)?v.delete(c.fullName):v.add(c.fullName),v})},p=async()=>{if(!r)return;let c=r.filter(u=>!u.alreadyAdded&&i.has(u.fullName));if(c.length!==0){I(!0);try{await e.call("addRepositories",{repos:c.map(u=>({owner:u.owner,repo:u.repo,host:u.host,orgLogin:u.orgLogin}))}),await s(),t()}catch(u){e.toast(u instanceof Error?u.message:String(u),"error")}finally{I(!1)}}},y=r?r.filter(c=>!c.alreadyAdded&&i.has(c.fullName)).length:0;return o(de,{title:"Suggested for you",icon:a(qe,{size:14}),onClose:t,busy:g,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?o("div",{className:"prm-loading",children:[a(U,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):m?a("div",{className:"prm-modal-error",role:"alert",children:m}):r.length===0?o("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(c=>o("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:i.has(c.fullName),disabled:c.alreadyAdded,onChange:()=>b(c)}),o("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:c.fullName}),o("span",{className:"prm-entity-sub",children:[c.prCount," PRs \xB7 ",Me(c.lastActivity)]})]}),c.alreadyAdded&&o("span",{className:"prm-suggested-added",children:[a(ge,{size:13})," Already added"]})]},c.fullName))})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn",onClick:()=>{C()},disabled:g||r===null,children:[a(qe,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:g,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{p()},disabled:g||y===0,children:[g?a(U,{size:13,className:"prm-spin"}):null,a("span",{children:g?"Adding\u2026":y>0?`Add ${y} Selected`:"Add Selected"})]})]})]})}function on({host:e,onClose:t,onAdded:s}){let[r,l]=f(""),[i,d]=f(null),[m,L]=f(!0),[g,I]=f(!1),[C,b]=f(!1),[p,y]=f(1),[c,u]=f(null),[v,R]=f(new Set),[z,M]=f(new Set),[B,X]=f(new Set),[F,E]=f(!1),$=W(async(N,q)=>{q?I(!0):L(!0),u(null);try{let T=await e.call("listAllRepositories",{page:N}),Z=T?.ok&&Array.isArray(T.repos)?T.repos:[];b(!!T?.hasMore),X(new Set(Array.isArray(T?.incompleteOwners)?T.incompleteOwners:[])),d(fe=>{if(!q||!fe)return Z;let Ce=new Set(fe.map(Q=>`${Q.host}|${Q.fullName}`));return[...fe,...Z.filter(Q=>!Ce.has(`${Q.host}|${Q.fullName}`))]}),T&&T.ok===!1&&T.error&&u(T.error)}catch(T){u(T instanceof Error?T.message:String(T)),q||d([])}finally{L(!1),I(!1)}},[e]);_(()=>{$(1,!1)},[$]);let w=()=>{let N=p+1;y(N),$(N,!0)},O=i??[],G=r.trim().toLowerCase(),V=G?O.filter(N=>N.fullName.toLowerCase().includes(G)):O,k=N=>{R(q=>{let T=new Set(q);return T.has(N)?T.delete(N):T.add(N),T})},ne=N=>{M(q=>{let T=new Set(q);return T.has(N)?T.delete(N):T.add(N),T})},ie=N=>`${N.host}|${N.fullName}`,H=(()=>{let N=new Map;for(let q of V){let T=N.get(q.owner)??[];T.push(q),N.set(q.owner,T)}return Array.from(N.entries())})(),Te=async()=>{let N=V.filter(q=>!q.alreadyAdded&&v.has(ie(q)));if(N.length!==0){E(!0);try{await e.call("addRepositories",{repos:N.map(q=>({owner:q.owner,repo:q.repo,host:q.host,orgLogin:q.owner}))}),await s(),t()}catch(q){e.toast(q instanceof Error?q.message:String(q),"error")}finally{E(!1)}}},De=V.filter(N=>!N.alreadyAdded&&v.has(ie(N))).length;return o(de,{title:"Browse Repositories",icon:a(Ea,{size:14}),onClose:t,busy:F,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:N=>l(N.target.value)})}),c&&a("div",{className:"prm-modal-error",role:"alert",children:c}),m?o("div",{className:"prm-loading",children:[a(U,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):o("div",{className:"prm-browse-list",children:[H.map(([N,q])=>{let T=!z.has(N);return o("div",{className:"prm-browse-group",children:[o("button",{type:"button",className:"prm-browse-group-header",onClick:()=>ne(N),"aria-expanded":T,children:[a(na,{size:13,className:`prm-disclosure${T?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:N}),o("span",{className:"prm-browse-group-count",title:!G&&B.has(N)?`${q.length} loaded \u2014 more available, use Load more`:void 0,children:["(",q.length,!G&&B.has(N)?"\u2026":"",")"]})]}),T&&q.map(Z=>Z.alreadyAdded?o("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[o("span",{children:[a(_e,{size:13,"aria-hidden":!0})," ",Z.fullName,Z.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(ge,{size:11,"aria-hidden":!0})," Connected"]})]},ie(Z)):o("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:v.has(ie(Z)),onChange:()=>k(ie(Z))}),o("span",{children:[a(_e,{size:13,"aria-hidden":!0})," ",Z.fullName,Z.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},ie(Z)))]},N)}),V.length===0&&a("div",{className:"prm-area-empty",children:G?"No repositories match your filter.":"No repositories found."}),C&&!G&&o("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:w,disabled:g,children:[g?a(U,{size:13,className:"prm-spin"}):null,a("span",{children:g?"Loading\u2026":"Load more"})]})]})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:F,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{Te()},disabled:F||De===0,children:[F?a(U,{size:13,className:"prm-spin"}):null,a("span",{children:De>0?`Add ${De} Selected`:"Add Selected"})]})]})]})}function rn({host:e,repo:t,orgs:s,initialTab:r="general",onClose:l,onSaved:i}){let[d,m]=f(r),[L,g]=f(`${t.owner}/${t.repo}`),[I,C]=f(t.orgLogin),[b,p]=f(t.active),[y,c]=f(t.buildTisPreset??t.tisPreset??mt),[u,v]=f(t.reviewTisPreset??gt),[R,z]=f(t.sfciGated===!0),[M,B]=f((t.ignoredFailingChecks??[]).some(k=>k.toLowerCase().includes("snyk"))),[X,F]=f(t.notifyInApp??!0),[E,$]=f(null),[w,O]=f(!1),G=s.filter(k=>k.host===t.host),V=async()=>{O(!0),$(null);try{let k=await e.call("updateRepository",{key:{host:t.host,owner:t.owner,repo:t.repo},ref:L.trim(),orgLogin:I,active:b,buildTisPreset:y,reviewTisPreset:u,sfciGated:R,ignoredFailingChecks:M?["Snyk"]:[],notifyInApp:X});k?.ok?i(k.prs):$(k?.error||"Failed to save settings.")}catch(k){$(k instanceof Error?k.message:String(k))}finally{O(!1)}};return o(de,{title:o("span",{className:"prm-dialog-title",children:["Repository Settings ",o("span",{className:"prm-entity-sub",children:[t.owner,"/",t.repo]})]}),icon:a(Ye,{size:14}),onClose:l,busy:w,children:[o("nav",{className:"prm-dialog-tabs","aria-label":"Repository settings sections",children:[o("button",{type:"button",className:`prm-dialog-tab${d==="general"?" active":""}`,"aria-current":d==="general"?"page":void 0,onClick:()=>m("general"),children:[a(Ye,{size:12})," General"]}),o("button",{type:"button",className:`prm-dialog-tab${d==="status"?" active":""}`,"aria-current":d==="status"?"page":void 0,onClick:()=>m("status"),children:[a(He,{size:12})," Status"]}),o("button",{type:"button",className:`prm-dialog-tab${d==="notifications"?" active":""}`,"aria-current":d==="notifications"?"page":void 0,onClick:()=>m("notifications"),children:[a(Fe,{size:12})," Notifications"]})]}),o("div",{className:"prm-modal-body",children:[d==="general"?o(K,{children:[o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:b,onChange:k=>p(k.target.checked)}),o("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:L,spellCheck:!1,onChange:k=>g(k.target.value)})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:I,onChange:k=>C(k.target.value),children:G.map(k=>o("option",{value:k.login,children:[k.login," (",k.shortHost,")"]},k.login))})]})]}):d==="status"?o(K,{children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:y,onChange:k=>c(k.target.value),children:Object.values(lt).map(k=>o("option",{value:k.id,children:[k.label," (",k.warnHours,"h / ",k.dangerHours,"h)"]},k.id))})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:u,onChange:k=>v(k.target.value),children:Object.values(nt).map(k=>o("option",{value:k.id,children:[k.label," (",k.warnDays,"d / ",k.dangerDays,"d)"]},k.id))})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:R,onChange:k=>z(k.target.checked)}),o("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:M,onChange:k=>B(k.target.checked)}),o("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:X,onChange:k=>F(k.target.checked)}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),E&&a("div",{className:"prm-modal-error",role:"alert",children:E})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:l,disabled:w,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>{V()},disabled:w,children:[w?a(U,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function sn({host:e,repo:t,onClose:s,onResult:r}){let[l,i]=f(null);return _(()=>{let d=!0;return(async()=>{try{let L=await e.call("testRepository",{host:t.host,owner:t.owner,repo:t.repo})??{ok:!1,error:"No response"};d&&(i(L),r?.(L.ok))}catch(m){d&&(i({ok:!1,error:m instanceof Error?m.message:String(m)}),r?.(!1))}})(),()=>{d=!1}},[e,t]),o(de,{title:`Connection Test Results: ${t.owner}/${t.repo}`,icon:a(Aa,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:l===null?o("div",{className:"prm-loading",children:[a(Aa,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):l.ok?o("div",{className:"prm-test-result prm-test-result--ok",children:[a(ge,{size:16})," All connection tests passed."]}):o("div",{className:"prm-test-result prm-test-result--fail",children:[a(ve,{size:16}),o("div",{children:[a("div",{children:l.error||"Connection failed."}),o("div",{className:"prm-field-hint",children:["Try ",o("code",{children:["gh auth login ",t.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function nn(e){let t=e.trim().split(/\s+/).filter(Boolean);return t.length===0?"?":t.length===1?t[0].slice(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}function Zr({host:e}){let[t,s]=f(()=>{let g=e.cache.get(Dt);return g?.ok?g.author??null:void 0}),[r,l]=f(null),[i,d]=f(!1),m=W(async()=>{try{let g=await e.call("getAuthor");g?.ok?(s(g.author??null),l(null)):(s(null),g?.error&&l(g.error))}catch(g){s(null),l(g instanceof Error?g.message:String(g))}},[e]);_(()=>{m()},[m]);let L=t?.name||t?.login||"";return o("div",{className:"prm-area",children:[a(Qe,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),t===void 0?o("div",{className:"prm-loading",children:[a(U,{size:14,className:"prm-spin"})," Loading author\u2026"]}):t===null?o("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:o("div",{className:"prm-entity-card prm-author-card",children:[o("button",{type:"button",className:"prm-author-row",onClick:()=>d(g=>!g),"aria-expanded":i,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:nn(L)}),o("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:L}),t.email&&a("span",{className:"prm-entity-sub",children:t.email})]}),a(na,{size:16,className:`prm-disclosure${i?" is-open":""}`,"aria-hidden":!0})]}),i&&o("div",{className:"prm-author-detail",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:L||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:t.email||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:t.identities.map(g=>o("div",{className:"prm-identity-row",children:[o("span",{children:[g.login," ",o("span",{className:"prm-entity-host",children:["(",g.shortHost,")"]})]}),g.connection==="connected"?a(ge,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):o("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(ve,{size:13})," Disconnected"]})]},`${g.host}|${g.login}`))})]})]})]})})]})}function Jr({settings:e,update:t}){let s=e.notifyInApp??e.notifyOnChange;return o("div",{className:"prm-area",children:[a(Qe,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>t({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>t({sendToInbox:r.target.checked})}),o("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>t({badgeMode:"unread"})}),o("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>t({badgeMode:"total"})}),o("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var Yr=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],ln=15;function Qr(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function dn(e,t){let s=Math.max(0,e-t),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let l=Math.floor(r/60),i=r%60;return i?`in ${l}h ${i}m`:`in ${l}h`}function es({settings:e,update:t,host:s}){let[r,l]=f(()=>s.cache.get(re)??[]),[i,d]=f(!1),[m,L]=f(()=>Date.now());_(()=>{let c=window.setInterval(()=>{let u=s.cache.get(re);u&&l(v=>v===u?v:u),L(Date.now())},1e3);return()=>window.clearInterval(c)},[s]);let g=e.autoSyncEnabled??!0,I=Yr.some(c=>c.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:ln,C=r.reduce((c,u)=>Math.max(c,u.lastChecked||0),0),b=g&&C?C+I*6e4:0,p=new Set(r.map(c=>c.repo)).size,y=async()=>{d(!0);try{let c=await s.call("pollAll");c?.ok&&Array.isArray(c.prs)&&(l(c.prs),s.cache.set(re,c.prs))}catch(c){s.toast(c instanceof Error?c.message:String(c),"error")}finally{d(!1)}};return o("div",{className:"prm-area",children:[a(Qe,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:g,onChange:c=>t({autoSyncEnabled:c.target.checked})}),o("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),o("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:I,onChange:c=>{let u=Number(c.target.value);Number.isFinite(u)&&t({pollIntervalMinutes:u})},children:Yr.map(c=>a("option",{value:c.value,children:c.label},c.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),o("div",{className:"prm-sync-status",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:b?o(K,{children:[dn(b,m)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Qr(b)]})]}):"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:C?o(K,{children:[Me(C)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",Qr(C)]})]}):""})]}),o("div",{className:"prm-sync-counts",children:[o("span",{className:"prm-sync-count",children:[a("strong",{children:p})," repositories checked"]}),o("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>{y()},disabled:i,children:[i?a(U,{size:13,className:"prm-spin"}):a(Ie,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var un=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:ha},{id:"repositories",label:"Repositories",icon:ga},{id:"author",label:"Author",icon:ot}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:Fe}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:st}]}];function as({settings:e,onSave:t,onRepositoriesChanged:s,host:r}){let[l,i]=f(e.settingsActiveNav??Mt),d=L=>{let g={...e,...L};t(g),r.cache.set("settings",g),r.cache.refreshBadge()},m=L=>{i(L),d({settingsActiveNav:L})};return a("div",{className:"prm-settings-shell",children:o("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:un.map(L=>o("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:L.label}),L.items.map(g=>{let I=g.icon;return o("button",{type:"button",className:`prm-nav-row${l===g.id?" active":""}`,"aria-current":l===g.id,onClick:()=>m(g.id),children:[a(I,{size:15,"aria-hidden":!0}),a("span",{children:g.label})]},g.id)})]},L.label))}),o("div",{className:"prm-settings-pane",children:[l==="organizations"&&a(Wr,{host:r}),l==="repositories"&&a(Kr,{host:r,onRepositoriesChanged:s}),l==="author"&&a(Zr,{host:r}),l==="notifications"&&a(Jr,{settings:e,update:d}),l==="system"&&a(es,{settings:e,update:d,host:r})]})]})})}function ts(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function os(e,t,s){return e===1?t:s}function rs(e){if(!e)return null;let t=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return t.length>0?{kind:"disconnect",subjects:t,action:"settings",message:`GitHub sign-in expired for ${ts(t)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${os(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${os(r.length,"is","is")} temporarily unreachable for ${ts(r)} \u2014 retrying automatically.`}:null}function cn(e,t){let s=(e.repo??"").toLowerCase();if(s)return(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function ss(e,t){let s=cn(e,t.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let i=t.notifyInApp??t.notifyOnChange??!1,d=t.sendToInbox??!1;return{inApp:i,inbox:d&&!!e.projectId}}function ns(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function fn(e){try{let t=new URL(e);if(t.protocol!=="http:"&&t.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function is(e,t,s){for(let r of t){let l=Bt(r.newStatus)>Bt(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||l))continue;let d=ss(r.pr,s);if(!d.inApp&&!d.inbox)continue;let m=ns(r.pr.repo),L=ns(r.pr.title),g=fn(r.pr.url),I=g?`[${L}](${g})`:L;if(d.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${xe(r.oldStatus)} \u2192 ${xe(r.newStatus)}`,"info"),d.inbox&&r.pr.projectId){let C=`**${m}#${r.pr.number}** \u2014 ${xe(r.oldStatus)} \u2192 **${xe(r.newStatus)}**

${I}`;try{await e.pushInbox({comments:C,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var zt="activeSubTab",ds="listSort",us="hostScope",Ut="listView";function mn(e){try{let[t,s]=new URL(e).pathname.split("/").filter(Boolean);return t&&s?`${t}/${s}`:null}catch{return null}}function _t({host:e,uiRequest:t}){let s=bt(),[r,l]=f(!1),[i,d]=f(null),[m,L]=f(!1),[g,I]=f(()=>e.cache.get(re)??[]),[C,b]=f(!1),[p,y]=f(null),[c,u]=f("prs"),[v,R]=f(!1),[z,M]=f(null),[B,X]=f(0),[F,E]=f(!1),[$,w]=f(!1),[O,G]=f(!1),[V,k]=f([]),[ne,ie]=f("status"),[H,Te]=f("asc"),[De,N]=f([]),[q,T]=f("board"),[Z,fe]=f(!1),[Ce,Q]=f(()=>({...cr})),ke=oe(null),ea=oe(null),ee=oe(!0);_(()=>(ee.current=!0,()=>{ee.current=!1}),[]),_(()=>{s||l(!1)},[s]);let[aa,ua]=f(()=>e.listProjects());_(()=>{let h=!0;return M(null),R(!1),Promise.all([e.storage.get(Ma),e.storage.get(zt),e.call("listPrs"),e.storage.get(ds),e.storage.get(us),e.storage.get(Ut)]).then(([S,n,P,D,J,se])=>{if(!h)return;D?.field&&ie(D.field),D?.dir&&Te(D.dir),Array.isArray(J)&&N(J),qt(se)&&T(se);let Ae=S?{...Ra,...S,relevanceModes:{...Ra.relevanceModes,...S.relevanceModes}}:null;d(Ae),Ae&&(e.cache.set("settings",Ae),e.cache.refreshBadge?.()),n==="prs"||n==="settings"?u(n):(n==="board"||n==="list")&&(u("prs"),qt(se)||(T(n),e.storage.set(Ut,n)),e.storage.set(zt,"prs")),Array.isArray(P)&&(I(P),e.cache.set(re,P),e.cache.set(Pe,P.length),e.cache.refreshBadge?.()),L(!0),R(!0),G(!0)}).catch(S=>{h&&(console.error("pr-monitor hydrate failed",S),M(S instanceof Error?S.message:String(S)),R(!0))}),()=>{h=!1}},[e,B]),_(()=>{let h=()=>{let n=e.cache.get(re);n&&I(D=>D===n?D:n);let P=e.listProjects();ua(D=>D.length===P.length&&D.every((J,se)=>J.id===P[se].id&&J.name===P[se].name&&J.path===P[se].path)?D:P)},S=window.setInterval(h,100);return()=>window.clearInterval(S)},[e]);let ta=h=>{u(h),e.storage.set(zt,h)},Se=W(async h=>{b(!0),y(null);try{let S=Array.isArray(h)&&h.length>0,P=S?await e.call("syncRepos",{repos:h}):await e.call("pollAll"),D=Date.now()+3e5;for(;(P.state==="running"||P.state==="queued")&&ee.current&&Date.now()<D;)await new Promise(Ae=>window.setTimeout(Ae,250)),P=await e.call("syncStatus",{id:P.id});if((P.state===void 0||P.state==="succeeded")&&Array.isArray(P.prs)){let Ae=P.state==="succeeded"?await e.call("listPrs"):P.prs;if(!ee.current)return;if(!Array.isArray(Ae))throw new Error("Could not refresh pull requests after syncing.");if(I(Ae),e.cache.set(re,Ae),e.cache.set(Pe,Ae.length),e.cache.refreshBadge?.(),Array.isArray(P.deltas)&&P.deltas.length>0){let ct=i??{...Ra,...await e.storage.get(Ma)};await is(e,P.deltas,ct)}}else!ee.current||Date.now()>=D?y("Sync is still running. Check back shortly."):P?.error&&y(P.error);let se=P?.health;!S&&se&&Q(se)}catch(S){y(S instanceof Error?S.message:String(S))}finally{b(!1),fe(!0)}},[e]),be=oe(!1);_(()=>{!O||be.current||(be.current=!0,e.call("getSyncHealth").then(h=>{h?.ok&&h.health&&Q(h.health)}).catch(()=>{}),Se())},[O,Se,e]);let ae=W(async(h,S)=>{try{let n=await e.call("resolveRemoteGone",{repo:h,action:S});if(!n?.ok){e.toast(`Couldn't ${S} ${h} \u2014 ${n?.error??"unknown error"}`,"error");return}Q(P=>({...P,remoteGone:P.remoteGone.filter(D=>D.toLowerCase()!==h.toLowerCase()),keptGone:S==="keep"?[...P.keptGone,h].filter((D,J,se)=>se.indexOf(D)===J):P.keptGone})),Se()}catch(n){e.toast(`Couldn't ${S} ${h} \u2014 ${n instanceof Error?n.message:String(n)}`,"error")}},[e,Se]),ye=W(async h=>{try{let S=await e.call("removePr",h);S?.ok&&Array.isArray(S.prs)&&(I(S.prs),e.cache.set(re,S.prs),e.cache.set(Pe,S.prs.length),e.cache.refreshBadge?.())}catch(S){e.toast(`Couldn't remove PR \u2014 ${S instanceof Error?S.message:String(S)}`,"error")}},[e]),Ne=W(async h=>{let S=g.find(n=>n.url===h);if(S)try{let n;S.source==="auto"?n=await e.call("dismissPr",{url:h}):n=await e.call("removePr",h),n?.ok&&Array.isArray(n.prs)&&(I(n.prs),e.cache.set(re,n.prs),e.cache.set(Pe,n.prs.length),e.cache.refreshBadge?.())}catch(n){e.toast(`Couldn't dismiss PR \u2014 ${n instanceof Error?n.message:String(n)}`,"error")}},[e,g]),te=W(async h=>{d(h);let S=await e.storage.get(Ma),n={...h};S&&(n.organizations=S.organizations,n.repositories=S.repositories,n.author=S.author,n.orgDiscovered=S.orgDiscovered,n.authorDiscovered=S.authorDiscovered),await e.storage.set(Ma,n),e.cache.set("settings",n),e.cache.refreshBadge?.()},[e]),ue=W(async()=>{let h=await e.storage.get(Ma);h?.repositories&&d(S=>S&&{...S,repositories:h.repositories})},[e]),Le=W(async(h,S)=>{try{let n=await e.call("assignProject",h,S);n?.ok&&Array.isArray(n.prs)&&(I(n.prs),e.cache.set(re,n.prs))}catch(n){e.toast(`Couldn't assign project \u2014 ${n instanceof Error?n.message:String(n)}`,"error")}},[e]),Be=W((h,S)=>{ie(h),Te(S),e.storage.set(ds,{field:h,dir:S})},[e]),Na=W(h=>{N(h),e.storage.set(us,h)},[e]),Xe=W(h=>{T(h),e.storage.set(Ut,h)},[e]),pe=W(async(h,S)=>{if(h.length!==0)try{let n=await e.call("setPrsSeen",{urls:h,seen:S});n?.ok&&Array.isArray(n.prs)&&(I(n.prs),e.cache.set(re,n.prs),e.cache.set("monitoredCount",n.prs.length),e.cache.refreshBadge?.())}catch(n){e.toast(`Couldn't update read state \u2014 ${n instanceof Error?n.message:String(n)}`,"error")}},[e]),ze=W(async(h,S)=>{if(h.length!==0)try{let n=await e.call("setPrsFavorite",{urls:h,favorite:S});n?.ok&&Array.isArray(n.prs)&&(I(n.prs),e.cache.set(re,n.prs))}catch(n){e.toast(`Couldn't update favorites \u2014 ${n instanceof Error?n.message:String(n)}`,"error")}},[e]),Ke=W(async h=>{if(h.length!==0)try{let S=await e.call("dismissPrs",{urls:h});S?.ok&&Array.isArray(S.prs)&&(I(S.prs),e.cache.set(re,S.prs),e.cache.set(Pe,S.prs.length),e.cache.refreshBadge?.())}catch(S){e.toast(`Couldn't dismiss PRs \u2014 ${S instanceof Error?S.message:String(S)}`,"error")}},[e]),[ca,oa]=f(null);_(()=>{if(!t)return;let{seq:h,action:S}=t;if(u("prs"),S.action==="filter"){k(S.repos),oa({seq:h,query:S.query});return}let n=mn(S.url)?.toLowerCase();k(P=>P.length>0&&!P.some(D=>D.toLowerCase()===n)?[]:P),oa({seq:h,revealUrl:S.url})},[t]);let ra=Y(()=>{if(V.length===0)return g;let h=new Set(V.map(S=>S.toLowerCase()));return g.filter(S=>h.has(S.repo.toLowerCase()))},[g,V]),fa=Y(()=>ra.filter(h=>Gr.includes(h.status)).map(h=>h.url),[ra]),ce=Y(()=>rs(Ce),[Ce]);if(!v)return a("section",{className:"prm-panel",children:o("div",{className:"prm-loading",children:[a(U,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})});if(z!==null)return a("section",{className:"prm-panel",children:o("div",{className:"prm-empty",role:"alert",children:[a(Ve,{size:28,"aria-hidden":!0}),a("h3",{children:"Couldn't load PR Monitor"}),a("p",{children:z}),o("button",{type:"button",className:"prm-btn",onClick:()=>X(h=>h+1),children:[a(Ie,{size:13,"aria-hidden":!0})," Retry loading"]})]})});if(!i)return a("section",{className:"prm-panel",children:a(br,{onSave:async h=>{await te(h)}})});let A=o("div",{className:"prm-header-actions",children:[c==="prs"&&o(K,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>{l(!1),E(!0)},title:"Add a specific pull request to the monitored list",children:[a(Wa,{size:13})," ",a("span",{children:"Add PR"})]}),fa.length>0&&o("button",{type:"button",className:"prm-btn",onClick:()=>{Ke(fa)},title:`Sweep \u2014 dismiss the ${fa.length} Merged/Closed PR(s) from the list`,children:[a(le,{size:13})," ",a("span",{children:"Sweep"})]}),o("div",{className:"prm-split-btn",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>{Se(V)},disabled:C,title:V.length>0?`Sync the ${V.length} selected repositor${V.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[C?a(U,{size:13,className:"prm-spin"}):a(Ie,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:ea,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>{l(!1),w(h=>!h)},disabled:C,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker","aria-haspopup":"menu","aria-expanded":$,children:a(ka,{size:13})})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":c==="settings",onClick:()=>{l(!1),ta(c==="settings"?"prs":"settings")},title:c==="settings"?"Back to pull requests":"Settings",children:c==="settings"?o(K,{children:[a(Fa,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):o(K,{children:[a(et,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]});return o("section",{className:"prm-panel",children:[o("header",{className:"prm-header",children:[o("div",{className:"prm-header-title",children:[a(he,{size:16,className:"prm-header-icon","aria-hidden":!0}),o("div",{className:"prm-header-heading",children:[a("h2",{children:c==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:c==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),c==="prs"&&a("span",{className:"prm-count-pill",children:ra.length})]}),s?o("div",{className:"prm-mobile-header-actions",children:[c==="prs"&&a("button",{type:"button",className:"prm-btn","aria-label":"Sync pull requests",disabled:C,onClick:()=>{Se(V)},children:C?a(U,{size:18,className:"prm-spin"}):a(Ie,{size:18})}),c==="settings"&&o("button",{type:"button",className:"prm-btn",onClick:()=>ta("prs"),children:[a(Fa,{size:18})," PRs"]}),a("button",{type:"button",className:"prm-btn",ref:ke,"aria-label":"PR Monitor actions","aria-haspopup":"dialog","aria-expanded":r,onClick:()=>l(!0),children:a(ba,{size:20})})]}):A]}),s&&r&&a(de,{title:"PR Monitor actions",closeLabel:"Close PR actions",onClose:()=>l(!1),children:a("div",{className:"prm-modal-body prm-mobile-actions",children:A})}),$&&a($r,{anchorRef:s?ke:ea,host:e,selectedRepos:V,onClose:()=>w(!1),onToggleRepo:h=>k(S=>S.includes(h)?S.filter(n=>n!==h):[...S,h]),onSelectAll:()=>k([]),onSync:h=>{Se(h)}}),o("div",{className:`prm-content${c==="prs"&&!s&&q==="board"?" prm-content--board":""}`,children:[p&&a("div",{className:"prm-error",children:p}),c==="prs"&&ce&&o("div",{className:`prm-sync-clue prm-sync-clue--${ce.kind}`,role:"status",children:[ce.kind==="disconnect"&&a(rt,{size:14,"aria-hidden":!0}),ce.kind==="remote-gone"&&a(Ve,{size:14,"aria-hidden":!0}),ce.kind==="outage"&&a($a,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:ce.message}),ce.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>ta("settings"),children:"Open Settings"})]}),c==="prs"&&Ce.remoteGone.map(h=>o("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${h} is gone`,children:[o("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:h})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),o("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>{ae(h,"keep")},children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>{ae(h,"remove")},children:"Remove"})]})]},h)),c==="prs"&&a(Vr,{prs:ra,host:e,projects:aa,tisWarnHours:i.tisWarnHours,tisDangerHours:i.tisDangerHours,reviewWarnDays:i.reviewWarnDays,reviewDangerDays:i.reviewDangerDays,repositories:i.repositories,workItemLocatorBase:i.gusLocatorBaseUrl,sortField:ne,sortDir:H,onSortChange:Be,hostScope:De,onHostScopeChange:Na,awaitingFirstSync:!Z,syncing:C,autoSyncEnabled:i.autoSyncEnabled??!0,onDismiss:h=>{Ne(h)},onProjectAssign:(h,S)=>{Le(h,S)},onBulkSetSeen:(h,S)=>{pe(h,S)},onBulkDismiss:h=>{Ke(h)},onBulkSetFavorite:(h,S)=>{ze(h,S)},viewMode:q,onViewModeChange:Xe,request:ca}),c==="settings"&&m&&a(as,{settings:i,onSave:h=>{te(h)},onRepositoriesChanged:()=>{ue()},host:e})]}),F&&a(jr,{host:e,onClose:()=>E(!1),onPulled:h=>{I(h),e.cache.set(re,h),e.cache.set(Pe,h.length),e.cache.refreshBadge?.(),E(!1)}})]})}function cs(e){if(e.length!==0)return e.length===1?e[0]:e}var Gt=new Map,fs,gn=5e3;function Vt(e){fs=e}function hn(){return{get:e=>Gt.get(e),set:(e,t)=>{Gt.set(e,t)},delete:e=>{Gt.delete(e)},refreshBadge:()=>fs?.()}}function xn(e,t){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,t)}function bn(e){try{let t=new URL(e);if(t.protocol!=="https:"&&t.protocol!=="http:"||typeof window>"u")return;window.open(t.href,"_blank","noopener,noreferrer")}catch{}}function ps(e){let t=[],s=!1,r=0,l=async()=>{if(!(s||Date.now()<r)){s=!0;try{let i=await pa(e,"listProjects");Array.isArray(i)&&(t=i)}catch{}finally{r=Date.now()+gn,s=!1}}};return l(),{call:(i,...d)=>pa(e,i,cs(d)),storage:{get:i=>pa(e,"storageGet",i),set:async(i,d)=>{await pa(e,"storageSet",{key:i,value:d})}},cache:hn(),toast:xn,listProjects:()=>(l(),t),openExternal:bn,pushInbox:async i=>i.projectId?await pa(e,"pushInbox",i):{id:""}}}var jt="prs-changed",ms="panel-ui";function gs(e){if(!e||typeof e!="object")return null;let t=e;return t.action==="reveal"&&typeof t.url=="string"&&t.url?{action:"reveal",url:t.url}:t.action==="filter"?{action:"filter",repos:Array.isArray(t.repos)?t.repos.filter(r=>typeof r=="string"):[],query:typeof t.query=="string"?t.query:""}:null}var $t=`/*
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
`;var xs="pr-monitor",hs="prm-plugin-styles";function In(){return globalThis.__ZCC_PLUGIN_RUNTIME__}function Cn(){if(typeof document>"u")return;let e=document.getElementById(hs);if(e instanceof HTMLStyleElement){e.textContent=`${Ht}
${$t}`;return}let t=document.createElement("style");t.id=hs,t.textContent=`${Ht}
${$t}`,document.head.appendChild(t)}Cn();var Sn={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function yn(){let e=Y(()=>ps(xs),[]);pt(jt,r=>{let l=r?.prs;Array.isArray(l)&&(e.cache.set(re,l),e.cache.set(Pe,l.length),e.cache.refreshBadge?.())});let[t,s]=f(null);return pt(ms,r=>{let l=gs(r);l&&s(i=>({seq:(i?.seq??0)+1,action:l}))}),a("div",{style:Sn,children:a(_t,{host:e,uiRequest:t})})}function wn(){let[e,t]=f(null),s=oe(!0),r=oe(0),l=W(async()=>{let i=++r.current;try{let d=await pa(xs,"badge");if(!s.current||i!==r.current)return;let m=typeof d?.count=="number"&&d.count>0?d.count:null;t(m)}catch(d){if(!s.current||i!==r.current)return;console.warn("[pr-monitor] badge refresh failed",d),t(null)}},[]);return _(()=>(s.current=!0,l(),Vt(()=>{s.current&&l()}),()=>{s.current=!1,r.current++,Vt(void 0)}),[l]),pt(jt,i=>{(async()=>{let d=Array.isArray(i?.inAppDeltas)?i.inAppDeltas:[];if(l(),d.length===0)return;let m=In();for(let L of d)m?.toast?.(`${L.pr.repo}#${L.pr.number}: ${xe(L.oldStatus)} -> ${xe(L.newStatus)}`,"info")})().catch(d=>console.warn("[pr-monitor] notification delivery failed",d))}),e==null?null:a("span",{className:"nav-badge",children:e})}var xm=Yt(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:yn,experimental_sidebarAccessory:wn}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:t=>{t.toPluginPanel("main")}})});export{xm as default,Cn as injectStyles};
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
