var W=globalThis.__ZCC_HOST_REACT__;var Os=W.Children,qs=W.Component,Us=W.Fragment,_s=W.StrictMode,zs=W.Suspense,Gs=W.cloneElement,Et=W.createContext,wa=W.createElement,Vs=W.createRef,Qa=W.forwardRef,Ws=W.isValidElement,$s=W.lazy,js=W.memo,Xs=W.startTransition,te=W.useCallback,Ot=W.useContext,Ks=W.useDebugValue,Zs=W.useDeferredValue,q=W.useEffect,Js=W.useId,Ys=W.useImperativeHandle,Qs=W.useInsertionEffect,el=W.useLayoutEffect,Y=W.useMemo,al=W.useReducer,Ve=W.useRef,i=W.useState,tl=W.useSyncExternalStore,ol=W.useTransition,rl=W.version;function _o(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}async function ra(e,o,s){return _o().callRpc(e,o,s)}function qt(e){return{__zccPluginApp:!0,setup:e}}var et=(...e)=>e.filter((o,s,r)=>!!o&&o.trim()!==""&&r.indexOf(o)===s).join(" ").trim();var Ut=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();var _t=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(o,s,r)=>r?r.toUpperCase():s.toLowerCase());var ht=e=>{let o=_t(e);return o.charAt(0).toUpperCase()+o.slice(1)};var at={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};var zt=e=>{for(let o in e)if(o.startsWith("aria-")||o==="role"||o==="title")return!0;return!1};var zo=Et({});var Gt=()=>Ot(zo);var Vt=Qa(({color:e,size:o,strokeWidth:s,absoluteStrokeWidth:r,className:n="",children:d,iconNode:m,...L},S)=>{let{size:f=24,strokeWidth:I=2,absoluteStrokeWidth:h=!1,color:y="currentColor",className:v=""}=Gt()??{},P=r??h?Number(s??I)*24/Number(o??f):s??I;return wa("svg",{ref:S,...at,width:o??f??at.width,height:o??f??at.height,stroke:e??y,strokeWidth:P,className:et("lucide",v,n),...!d&&!zt(L)&&{"aria-hidden":"true"},...L},[...m.map(([x,u])=>wa(x,u)),...Array.isArray(d)?d:[d]])});var c=(e,o)=>{let s=Qa(({className:r,...n},d)=>wa(Vt,{ref:d,iconNode:o,className:et(`lucide-${Ut(ht(e))}`,`lucide-${e}`,r),...n}));return s.displayName=ht(e),s};var Go=[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]],Ta=c("arrow-down",Go);var Vo=[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]],Da=c("arrow-left",Vo);var Wo=[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]],Na=c("arrow-up",Wo);var $o=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]],Je=c("bell-off",$o);var jo=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]],ke=c("bell",jo);var Xo=[["path",{d:"M10 2v8l3-3 3 3V2",key:"sqw3rj"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",key:"k3hazp"}]],Ba=c("book-marked",Xo);var Ko=[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],Fa=c("building-2",Ko);var Zo=[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]],Be=c("check",Zo);var Jo=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],ga=c("chevron-down",Jo);var Yo=[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]],Ye=c("chevron-right",Yo);var Qo=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],Pe=c("circle-alert",Qo);var er=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],me=c("circle-check",er);var ar=[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]],Ha=c("circle-dashed",ar);var tr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],Re=c("circle-question-mark",tr);var or=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],Se=c("circle-x",or);var rr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]],Ae=c("clock",rr);var sr=[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],Ea=c("cloud-off",sr);var lr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],sa=c("columns-3",lr);var nr=[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]],Oa=c("download",nr);var ir=[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]],Fe=c("external-link",ir);var dr=[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],qa=c("eye-off",dr);var ur=[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],Ua=c("eye",ur);var cr=[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]],_a=c("folder-git-2",cr);var fr=[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]],va=c("folder-search",fr);var pr=[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]],He=c("git-branch",pr);var mr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]],Qe=c("git-merge",mr);var gr=[["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 9v12",key:"1sc30k"}],["path",{d:"m21 3-6 6",key:"16nqsk"}],["path",{d:"m21 9-6-6",key:"9j17rh"}],["path",{d:"M18 11.5V15",key:"65xf6f"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}]],ea=c("git-pull-request-closed",gr);var xr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],We=c("git-pull-request-draft",xr);var hr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],ge=c("git-pull-request",hr);var Lr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]],za=c("globe",Lr);var br=[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]],Ga=c("layout-list",br);var Ir=[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]],Ee=c("link-2",Ir);var Cr=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],z=c("loader-circle",Cr);var Sr=[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]],$e=c("mail-open",Sr);var yr=[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]],aa=c("mail",yr);var wr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],la=c("panel-left-close",wr);var vr=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],je=c("pen",vr);var kr=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]],ka=c("plus",kr);var Pr=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]],ve=c("refresh-cw",Pr);var Rr=[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]],Pa=c("search",Rr);var Ar=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],Va=c("settings",Ar);var Mr=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]],Wa=c("shield-alert",Mr);var Tr=[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],Me=c("sparkles",Tr);var Dr=[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],na=c("square-check-big",Dr);var Nr=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]],Oe=c("star",Nr);var Br=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],ce=c("trash-2",Br);var Fr=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],Xe=c("triangle-alert",Fr);var Hr=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]],$a=c("users",Hr);var Er=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],ja=c("wifi-off",Er);var Or=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]],xa=c("wifi",Or);var qr=[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]],Xa=c("wrench",qr);var Ur=[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]],Ie=c("x",Ur);var Za={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},tt="standard",Ka={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},ot="standard";function _r(e){let o=e?.buildTisPreset??e?.tisPreset;return o&&o in Za?o:tt}function Wt(e,o){let s=(e??"").toLowerCase();return s?(o??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function Ja(e,o,s,r){let n=Wt(e,o);if(n){let d=Za[_r(n)];return{warnHours:d.warnHours,dangerHours:d.dangerHours}}return{warnHours:s,dangerHours:r}}function Lt(e,o,s,r){let n=Wt(e,o);if(n){let d=n.reviewTisPreset&&n.reviewTisPreset in Ka?n.reviewTisPreset:ot,m=Ka[d];return{warnDays:m.warnDays,dangerDays:m.dangerDays}}return{warnDays:s,dangerDays:r}}var $t={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},bt="organizations",ha={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:bt,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},xe="monitoredCount",Z="monitoredPrs",La="settings",Ya="prefetch:orgs",It="prefetch:repos",Ct="prefetch:author",zr=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function St(e){let o=zr.exec(e);if(!o)throw new Error(`Not a GitHub PR URL: ${e}`);return o[1]}var Gr={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function yt(e){return Gr[e]}var Vr={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function wt(e){return Vr[e]}var Wr=/\bW-\d{8}\b/i;function ia(e,o,s){for(let r of[e,o,s]){if(typeof r!="string"||!r)continue;let n=Wr.exec(r);if(n)return n[0].toUpperCase()}}function rt(e,o){if(!e||!o||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(o)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${o.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var jt=globalThis.__ZCC_HOST_REACT__,Q=jt.Fragment;function a(e,o,s){return jt.createElement(e,s===void 0?o:{...o,key:s})}var t=a;function Xt({onSave:e}){let[o,s]=i(!1),r=async()=>{s(!0);try{await e({...ha})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:t("div",{className:"prm-setup",children:[a(ge,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void r(),disabled:o,children:o?"Saving\u2026":"Get started"})})]})})}function qe(e){let o=Date.now(),s=Math.max(0,o-e),r=Math.floor(s/1e3);if(r<60)return"just now";let n=Math.floor(r/60);if(n<60)return`${n}m ago`;let d=Math.floor(n/60);if(d<24)return`${d}h ago`;let m=Math.floor(d/24);if(m===1)return"yesterday";if(m<30)return`${m}d ago`;let L=Math.floor(m/30);return L<12?`${L}mo ago`:`${Math.floor(L/12)}y ago`}var $r={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function Ke(e){return $r[e]}function Kt(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function st(e){let o=0,s=0,r=0;for(let n of e){let d=n.state.toUpperCase();d==="SUCCESS"||d==="PASS"||d==="PASSED"?o++:d==="FAILURE"||d==="FAILED"||d==="ERROR"||d==="CANCELLED"?s++:r++}return{pass:o,fail:s,pending:r}}var jr={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function Zt(e){return jr[e.toUpperCase()]??"pending"}function lt(e){return{label:Ke(e),className:`prm-status-pill--${e}`}}var Ue=4,_e=6,ba=3,Ia=5;function da(e){if(!e)return"";let o=Math.max(0,Date.now()-e),s=Math.floor(o/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function ua(e,o){let s=o==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function ca(e){let o=e.name||e.login,s=o.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():o.slice(0,2).toUpperCase()}var Xr=new Set(["fail","failure"]),Kr=new Set(["pending","in_progress","queued"]);function Zr(e){return(e??"").toLowerCase().trim()||"pending"}function Jr(e,o){if(!o||o.length===0)return!1;let s=(e??"").toLowerCase();return o.some(r=>{let n=(r??"").toLowerCase();return n.length>0&&s.includes(n)})}function Ra(e,o={}){if(!e||e.length===0)return!1;let s=o.ignoredFailingChecks;for(let r of e){let n=Zr(r.bucket||r.state);if(Kr.has(n)||Xr.has(n)&&!Jr(r.name,s))return!1}return!0}function Aa(e){let{status:o,buildHappy:s,reviewApproved:r,sfciGated:n,hasSfciJob:d,elapsedHours:m,warnHours:L,dangerHours:S}=e;if(o==="integrating"||o==="closed-merged"||o==="closed-abandoned")return"done";let f=n&&!d;return s&&r&&o==="yellow"?f?"blocked":m>=S?"merge-stall":m>=L?"warn":"ok":s?"done":f?"blocked":m>=S?"danger":m>=L?"warn":"ok"}function nt(e){let{reviewApproved:o,merged:s,elapsedDays:r,warnDays:n,dangerDays:d}=e;return o&&!s?"done":r>=d?"danger":r>=n?"warn":"ok"}function Yr(e){if(typeof document>"u")return!1;let o=document.createElement("textarea");o.value=e,o.style.position="fixed",o.style.top="-9999px",o.setAttribute("readonly",""),document.body.appendChild(o);try{return o.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(o)}}async function Ma(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return Yr(e)}var Qr=Symbol.for("react.portal");function fa(e,o){return{$$typeof:Qr,key:null,children:e,containerInfo:o,implementation:null}}var it=4,dt=8,Jt=120,es=320,as=280;function ts(e,o){let s=o.innerHeight-e.bottom-it-dt,r=e.top-it-dt,n=s<Jt&&r>s,d=Math.max(Jt,Math.min(es,n?r:s)),m=Math.max(dt,Math.min(e.left,o.innerWidth-as-dt));return n?{left:m,bottom:o.innerHeight-e.top+it,maxHeight:d}:{left:m,top:e.bottom+it,maxHeight:d}}function ut({projectId:e,projects:o,onAssign:s}){let r=Ve(null),[n,d]=i(!1),[m,L]=i(null),S=o.find(h=>h.id===e),f=!!S;q(()=>{if(!n)return;let h=r.current;h&&L(ts(h.getBoundingClientRect(),window))},[n]),q(()=>{if(!n)return;let h=y=>{y.key==="Escape"&&d(!1)};return window.addEventListener("keydown",h),()=>window.removeEventListener("keydown",h)},[n]);let I=f?`Associated with ${S.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return t(Q,{children:[t("button",{ref:r,type:"button",className:`prm-project-row ${f?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:I,"aria-label":I,onClick:h=>{h.stopPropagation(),d(y=>!y)},children:[a(_a,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:f?S.name:"Not associated with a project"})]}),n&&m&&typeof document<"u"&&fa(t(Q,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:h=>{h.stopPropagation(),d(!1)}}),t("div",{className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...m},role:"menu",children:[o.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),f&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:h=>{h.stopPropagation(),s(null),d(!1)},children:"Clear association"}),o.map(h=>a("button",{type:"button",className:`prm-project-menu-item ${h.id===e?"is-active":""}`,role:"menuitem",onClick:y=>{y.stopPropagation(),s(h.id),d(!1)},children:h.name},h.id))]})]}),document.body)]})}function ct({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(o=>{let s=Zt(o.state);return t("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:o.name}),o.bucket&&a("span",{className:"prm-check-bucket",children:o.bucket}),a("span",{className:"prm-check-state",title:o.state,children:o.state.toLowerCase()})]},`${o.bucket??""}/${o.name}`)})})}function Yt(e){try{let o=new URL(e);return o.protocol==="http:"||o.protocol==="https:"}catch{return!1}}var os=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],rs=["seen","favorite","mute","dismiss"];function Qt({pr:e,host:o,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:d,reviewDangerDays:m,sfciGated:L=!1,ignoredFailingChecks:S,workItemLocatorBase:f,selected:I,onToggleSelect:h,onDismiss:y,onProjectAssign:v}){let[P,x]=i(!1),[u,T]=i(!1),k=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),M=e.workItem??ia(e.title,e.headRefName,e.body),N=rt(M,f),B=lt(e.status),ae=e.status==="closed-merged"||e.status==="closed-abandoned",U=!!e.muted,E=!!e.favorite,j=!!e.syncError,C=e.checks??[],O=st(C),V=e.reviewDecision==="APPROVED",X=e.buildHappy??Ra(C,{ignoredFailingChecks:S}),w=Aa({status:e.status,buildHappy:X,reviewApproved:V,sfciGated:L,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??Ue,dangerHours:n??_e}),de=da(e.lastStatusChange),se=w==="merge-stall"||w==="danger"?"danger":w==="warn"?"warn":"ok",ie=w==="done"?"Build \u2713":w==="merge-stall"?"Merge stalled":ua(se,"build"),F=w==="done"?"done":se,ye=!e.isDraft&&!ae,A=e.status==="closed-merged",H=nt({reviewApproved:V,merged:A,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:d??ba,dangerDays:m??Ia}),D=da(e.reviewClockStartedAt),$=H==="danger"?"danger":H==="warn"?"warn":"ok",oe=H==="done"?"Review \u2713":ua($,"review"),Ce=H==="done"?"done":$,le=e.reviewers??[],fe={"changes-requested":le.filter(l=>l.state==="changes-requested"),"review-requested":le.filter(l=>l.state==="review-requested"),approved:le.filter(l=>l.state==="approved")},ze=le.length>0,pa=()=>{Yt(e.url)?o.openExternal(e.url):o.toast("Refusing to open a non-http(s) URL","error")},ma=e.isDraft?We:e.status==="closed-merged"?Qe:e.status==="closed-abandoned"?ea:ge,Te=l=>{l?.ok&&l.prs&&(o.cache.set(Z,l.prs),o.cache.set(xe,l.prs.length),o.cache.refreshBadge())},he=async()=>{if(k){let l=await o.call("markPrAsSeen",{url:e.url});Te(l)}},oa=async()=>{let l=k?"markPrAsSeen":"markPrAsUnseen",R=await o.call(l,{url:e.url});Te(R)},G=async()=>{let l=await o.call("setPrMuted",{url:e.url,muted:!U});Te(l)},Le=async()=>{let l=await o.call("setPrFavorite",{url:e.url,favorite:!E});Te(l)},ue=async l=>{l.stopPropagation(),T(!0);try{let R=await o.call("retryPr",{url:e.url});Te(R)}finally{T(!1)}},be=async(l,R)=>{await Ma(l)?o.toast(`${R} copied`,"info"):o.toast(`Failed to copy ${R}`,"error")},K=C.length>0,re=K?` \u2014 click to ${P?"hide":"show"} checks`:"",p=l=>{l.stopPropagation(),x(R=>!R)},b=l=>{(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),p(l))},g=l=>K?{role:"button",tabIndex:0,"aria-expanded":P,title:l,"data-tip":l,onClick:p,onKeyDown:b}:{},J=K?" prm-tip prm-checks-trigger":"",ee=`${B.label} \u2014 overall PR status${re}`,Ge=`${O.pass} passing, ${O.fail} failing, ${O.pending} running`,De=w==="done"?"Build passing":w==="merge-stall"?"Merge stalled":w==="blocked"?"Build waiting (SFCI job not yet created)":ie||"Build running",Ne=`${De} \xB7 ${de} in build phase \xB7 ${Ge}${re}`,Sa=H==="done"?"Review approved":oe||"Awaiting review",we=`${Sa} \xB7 ${D} in review${re}`,ya=`${Ge}${re}`,Bt={seen:{Icon:k?$e:aa,label:k?"Mark read":"Mark unread",title:k?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:Oe,label:E?"Unfavorite":"Favorite",title:E?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:E},mute:{Icon:U?Je:ke,label:U?"Unmute":"Mute",title:U?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:ce,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},xt=l=>{l==="seen"?oa():l==="favorite"?Le():l==="mute"?G():y(e.url)};return t("div",{className:`prm-tile ${k?"prm-tile--unread":""} ${ae?"prm-tile--closed":""} ${j?"prm-tile--stale":""} ${E?"prm-tile--favorite":""} ${I?"prm-tile--selected":""}`,onClick:he,role:"button",tabIndex:0,onKeyDown:l=>{(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),he())},children:[t("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:I,title:I?"Deselect this PR":"Select this PR","aria-label":I?"Deselect this PR":"Select this PR",onClick:l=>l.stopPropagation(),onChange:l=>{l.stopPropagation(),h(e.url)}}),a(ma,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),t("span",{className:"prm-tile-title",children:[M&&t("span",{className:"prm-tile-workitem-inline",children:["@",M,": "]}),e.title.replace(new RegExp(`(?:^|@)${M}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${B.className} prm-tip${J}`,title:ee,"data-tip":ee,...g(ee),children:B.label}),K?t("span",{className:`prm-tis prm-tis--${F} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":P,title:Ne,"data-tip":Ne,"aria-label":`${De}, ${de} in build phase`,onClick:p,onKeyDown:b,children:[de,ie&&t("span",{className:"prm-tis-cue",children:[" ",ie]})]}):t("span",{className:`prm-tis prm-tis--${F} prm-tip`,title:Ne,"data-tip":Ne,"aria-label":`${De}, ${de} in build phase`,children:[de,ie&&t("span",{className:"prm-tis-cue",children:[" ",ie]})]}),ye&&(D||oe)&&(K?t("span",{className:`prm-tis prm-tis--review prm-tis--${Ce} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":P,title:we,"data-tip":we,"aria-label":`${Sa}, ${D} in review`,onClick:p,onKeyDown:b,children:[D,oe&&t("span",{className:"prm-tis-cue",children:[" ",oe]})]}):t("span",{className:`prm-tis prm-tis--review prm-tis--${Ce} prm-tip`,title:we,"data-tip":we,"aria-label":`${Sa}, ${D} in review`,children:[D,oe&&t("span",{className:"prm-tis-cue",children:[" ",oe]})]})),C.length>0&&t("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${O.pass} passed, ${O.fail} failed, ${O.pending} running`,...g(ya),children:[O.pass>0&&t("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(Be,{size:9})," ",O.pass]}),O.fail>0&&t("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(Ie,{size:9})," ",O.fail]}),O.pending>0&&t("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(Ae,{size:9})," ",O.pending]})]}),U&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(Je,{size:11})}),j&&t("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(Pe,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:u,onClick:l=>void ue(l),children:a(ve,{size:10,className:u?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:rs.map(l=>{let R=Bt[l],_=R.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${R.danger?" prm-tile-icon-btn--danger":""}${R.active?" prm-tile-icon-btn--active":""}`,title:R.title,"data-tip":R.label,"aria-label":R.label,"aria-pressed":R.active,onClick:ne=>{ne.stopPropagation(),xt(l)},children:a(_,{size:13,...R.active?{fill:"currentColor"}:{}})},l)})})]}),t("div",{className:"prm-tile-line2",children:[M&&(N?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${M}`,onClick:l=>{l.stopPropagation(),Yt(N)&&o.openExternal(N)},children:M}):a("span",{className:"prm-workitem-chip",children:M})),a("span",{className:"prm-tile-repo",children:e.repo}),t("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:l=>{l.stopPropagation(),pa()},children:a(Fe,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:l=>{l.stopPropagation(),be(e.url,"PR link")},children:a(Ee,{size:10})})]}),e.author&&t("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ca(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&t("div",{className:"prm-tile-line3",children:[a(He,{size:10,className:"prm-branch-icon","aria-hidden":!0}),t("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:l=>{l.stopPropagation(),be(e.headRefName,"Branch name")},children:a(Ee,{size:10})})]}),ze&&a("div",{className:"prm-reviewers",children:os.map(({state:l,label:R,className:_})=>{let ne=fe[l];return ne.length===0?null:t("span",{className:`prm-reviewers-group ${_}`,title:R,children:[a("span",{className:"prm-reviewers-label",children:R}),ne.map(pe=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:pe.name||pe.login,"aria-label":`${R}: ${pe.name||pe.login}`,children:ca(pe)},pe.login))]},l)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(ut,{projectId:e.projectId,projects:s,onAssign:l=>v(e.url,l)}),P&&C.length>0&&a("div",{className:"prm-tile-checks",onClick:l=>l.stopPropagation(),children:a(ct,{checks:C})})]})}function eo({anchorRef:e,hosts:o,selectedHosts:s,onClose:r,onToggleHost:n,onSelectAll:d,shortHost:m}){let[L,S]=i(null);if(q(()=>{let I=e.current;if(!I)return;let h=I.getBoundingClientRect();S({top:h.bottom+4,left:h.left})},[e]),q(()=>{let I=h=>{h.key==="Escape"&&r()};return window.addEventListener("keydown",I),()=>window.removeEventListener("keydown",I)},[r]),!L||typeof document>"u")return null;let f=s.length===0;return fa(t(Q,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:I=>{I.stopPropagation(),r()}}),t("div",{className:"prm-tile-menu prm-host-filter",style:{position:"fixed",top:L.top,left:L.left},role:"menu",children:[t("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),t("button",{type:"button",className:`prm-project-menu-item ${f?"is-active":""}`,role:"menuitemcheckbox","aria-checked":f,onClick:I=>{I.stopPropagation(),d()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:f&&a(Be,{size:12})}),"All hosts"]}),o.map(I=>{let h=s.includes(I);return t("button",{type:"button",className:`prm-project-menu-item ${h?"is-active":""}`,role:"menuitemcheckbox","aria-checked":h,onClick:y=>{y.stopPropagation(),n(I)},title:`Filter to ${I}`,children:[a("span",{className:"prm-sync-filter-check",children:h&&a(Be,{size:12})}),m(I)]},I)})]})]}),document.body)}var vt=["conflict","failed","yellow","review-required","pending","integrating","green"],ao=["closed-merged","closed-abandoned"],Ca={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function kt(e){return e==="list"||e==="board"}function ss(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function ft(e){let o=ss();for(let s of e)o[s.status].push(s);return o}function to(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var oo=[...vt,...ao];function ro(e){return typeof e=="string"&&oo.includes(e)}function so(e,o={}){let s=to(e);return o.showEmpty?[...vt,...ao.filter(r=>s[r]>0)]:oo.filter(r=>s[r]>0)}function lo(e){let o=to(e);return vt.filter(s=>o[s]===0).length}function no(e){let o=e.lastIndexOf("/");return o>=0?e.slice(o+1):e}function ls(e){try{let o=new URL(e);return o.protocol==="http:"||o.protocol==="https:"}catch{return!1}}function ns(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function io({pr:e,host:o,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:n,selected:d,selectionActive:m=!1,selectMode:L=!1,onToggleSelect:S,onDismiss:f,onOpen:I}){let[h,y]=i(!1),v=ns(e),P=e.status==="closed-merged"||e.status==="closed-abandoned",x=!!e.favorite,u=!!e.syncError,T=e.workItem??ia(e.title,e.headRefName,e.body),k=T?e.title.replace(new RegExp(`(?:^|@)${T}[:\\s]*`,"i"),""):e.title,M=e.checks??[],N=st(M),B=e.updatedAt||e.lastChecked||e.lastStatusChange,ae=e.buildHappy??Ra(M,{ignoredFailingChecks:n}),U=Aa({status:e.status,buildHappy:ae,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??Ue,dangerHours:r??_e}),E=U==="merge-stall"?"Merge stalled":U==="warn"||U==="danger"?ua(U,"build"):"",j=U==="merge-stall"||U==="danger"?"danger":U==="warn"?"warn":"",C=d||L||m,O=F=>{F?.ok&&F.prs&&(o.cache.set(Z,F.prs),o.cache.set(xe,F.prs.length),o.cache.refreshBadge())},V=async()=>{if(!v)return;let F=await o.call("markPrAsSeen",{url:e.url});O(F)},X=async()=>{let F=await o.call("setPrFavorite",{url:e.url,favorite:!x});O(F)},w=()=>{ls(e.url)?o.openExternal(e.url):o.toast("Refusing to open a non-http(s) URL","error")},de=async()=>{y(!0);try{let F=await o.call("retryPr",{url:e.url});O(F)}finally{y(!1)}},se=()=>{I(e.url),V()},ie=F=>{if(F.metaKey||F.ctrlKey||L){S(e.url);return}se()};return t("article",{className:["prm-board-card",v?"prm-board-card--unread":"",P?"prm-board-card--closed":"",x?"prm-board-card--favorite":"",d?"prm-board-card--selected":"",u?"prm-board-card--stale":"",C?"prm-board-card--selectable":"",L?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:ie,onKeyDown:F=>{(F.key==="Enter"||F.key===" ")&&(F.preventDefault(),L?S(e.url):se())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[t("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:d,title:d?"Deselect this PR":"Select this PR","aria-label":d?"Deselect this PR":"Select this PR",onClick:F=>F.stopPropagation(),onChange:F=>{F.stopPropagation(),S(e.url)}}),t("span",{className:"prm-board-card-id",children:[t("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",children:no(e.repo)})]}),T&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:T}),t("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${x?" prm-tile-icon-btn--active":""}`,title:x?"Unfavorite":"Favorite","data-tip":x?"Unfavorite":"Favorite","aria-label":x?"Unfavorite":"Favorite","aria-pressed":x,onClick:F=>{F.stopPropagation(),X()},children:a(Oe,{size:12,...x?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:F=>{F.stopPropagation(),w()},children:a(Fe,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:F=>{F.stopPropagation(),f(e.url)},children:a(ce,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:k}),t("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:ca(e.author)}),E?t("span",{className:`prm-tis prm-tis--${j} prm-board-card-stall`,children:[da(e.lastStatusChange)," ",E]}):B>0&&a("span",{className:"prm-board-card-time",children:qe(B)}),N.fail>0&&t("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${N.fail} checks failing`,children:[a(Ie,{size:9})," ",N.fail]}),N.pending>0&&t("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${N.pending} checks running`,children:[a(Ae,{size:9})," ",N.pending]}),e.isDraft&&t("span",{className:"prm-draft-pill prm-board-card-draft",children:[a(We,{size:10,"aria-hidden":!0})," Draft"]}),u&&t("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(Pe,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:h,onClick:F=>{F.stopPropagation(),de()},children:a(ve,{size:10,className:h?"prm-spin":""})})]})]})]})}var is={conflict:Wa,failed:Se,yellow:Xe,"review-required":Ua,pending:Ha,integrating:z,green:me,"closed-merged":Qe,"closed-abandoned":ea};function uo({prs:e,host:o,tisWarnHours:s,tisDangerHours:r,repositories:n,selected:d,selectMode:m=!1,showEmpty:L=!1,collapsed:S,onToggleCollapse:f,onToggleSelect:I,onDismiss:h,onOpen:y}){let v=Y(()=>ft(e),[e]),P=Y(()=>so(v,{showEmpty:L}),[v,L]),x=d.size>0||m;return a("div",{className:"prm-board",role:"list","aria-label":"Pull requests by status",children:P.map(u=>{let T=v[u],k=is[u],M=S.has(u),N=T.filter(B=>B.lastSeenAt===0||B.lastStatusChange>(B.lastSeenAt??B.addedAt)).length;return t("section",{className:`prm-board-col prm-board-col--${u}${M?" prm-board-col--collapsed":""}`,"aria-label":`${Ca[u]} (${T.length})`,"data-board-column":u,"data-collapsed":M?"true":"false",children:[t("header",{className:"prm-board-col-header",children:[a(k,{size:14,className:"prm-board-col-icon","aria-hidden":!0}),a("span",{className:"prm-board-col-title",children:Ca[u]}),a("span",{className:"prm-board-col-count",children:T.length}),N>0&&a("span",{className:"prm-board-col-unread",title:`${N} unread`,children:N}),a("button",{type:"button",className:"prm-board-col-collapse",title:M?`Expand ${Ca[u]}`:`Collapse ${Ca[u]}`,"aria-label":M?`Expand ${Ca[u]}`:`Collapse ${Ca[u]}`,"aria-expanded":!M,onClick:()=>f(u),children:M?a(Ye,{size:13}):a(la,{size:13})})]}),!M&&a("div",{className:"prm-board-col-body",children:T.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):T.map(B=>{let ae=Ja(B.repo,n,s??Ue,r??_e),U=(n??[]).find(E=>`${E.owner}/${E.repo}`.toLowerCase()===B.repo.toLowerCase());return a(io,{pr:B,host:o,tisWarnHours:ae.warnHours,tisDangerHours:ae.dangerHours,ignoredFailingChecks:U?.ignoredFailingChecks,selected:d.has(B.url),selectionActive:x,selectMode:m,onToggleSelect:I,onDismiss:h,onOpen:y},B.url)})})]},u)})})}var ds=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function co(e){try{let o=new URL(e);return o.protocol==="http:"||o.protocol==="https:"}catch{return!1}}function us(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function fo({pr:e,host:o,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:d,reviewDangerDays:m,sfciGated:L=!1,ignoredFailingChecks:S,workItemLocatorBase:f,onClose:I,onDismiss:h,onProjectAssign:y}){let[v,P]=i(!1);q(()=>{let G=Le=>{Le.key==="Escape"&&I()};return window.addEventListener("keydown",G),()=>window.removeEventListener("keydown",G)},[I]);let x=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),u=e.status==="closed-merged"||e.status==="closed-abandoned",T=!!e.muted,k=!!e.favorite,M=!!e.syncError,N=e.workItem??ia(e.title,e.headRefName,e.body),B=rt(N,f),ae=N?e.title.replace(new RegExp(`(?:^|@)${N}[:\\s]*`,"i"),""):e.title,U=lt(e.status),E=e.checks??[],j=e.reviewers??[],C={"changes-requested":j.filter(G=>G.state==="changes-requested"),"review-requested":j.filter(G=>G.state==="review-requested"),approved:j.filter(G=>G.state==="approved")},O=us(e),V=e.reviewDecision==="APPROVED",X=e.buildHappy??Ra(E,{ignoredFailingChecks:S}),w=Aa({status:e.status,buildHappy:X,reviewApproved:V,sfciGated:L,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??Ue,dangerHours:n??_e}),de=da(e.lastStatusChange),se=w==="merge-stall"||w==="danger"?"danger":w==="warn"?"warn":"ok",ie=w==="done"?"Build \u2713":w==="merge-stall"?"Merge stalled":ua(se,"build"),F=w==="done"?"done":se,ye=!e.isDraft&&!u,A=nt({reviewApproved:V,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:d??ba,dangerDays:m??Ia}),H=da(e.reviewClockStartedAt),D=A==="danger"?"danger":A==="warn"?"warn":"ok",$=A==="done"?"Review \u2713":ua(D,"review"),oe=A==="done"?"done":D,Ce=e.isDraft?We:e.status==="closed-merged"?Qe:e.status==="closed-abandoned"?ea:ge,le=G=>{G?.ok&&G.prs&&(o.cache.set(Z,G.prs),o.cache.set(xe,G.prs.length),o.cache.refreshBadge())},fe=()=>{co(e.url)?o.openExternal(e.url):o.toast("Refusing to open a non-http(s) URL","error")},ze=async(G,Le)=>{await Ma(G)?o.toast(`${Le} copied`,"info"):o.toast(`Failed to copy ${Le}`,"error")},pa=async()=>{let G=x?"markPrAsSeen":"markPrAsUnseen";le(await o.call(G,{url:e.url}))},ma=async()=>{le(await o.call("setPrMuted",{url:e.url,muted:!T}))},Te=async()=>{le(await o.call("setPrFavorite",{url:e.url,favorite:!k}))},he=async()=>{P(!0);try{le(await o.call("retryPr",{url:e.url}))}finally{P(!1)}},oa=a("div",{className:"modal-backdrop",onClick:I,"data-testid":"prm-detail-backdrop",children:t("div",{className:"modal prm-modal prm-modal--detail",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-detail-title",onClick:G=>G.stopPropagation(),children:[t("header",{className:"prm-modal-header",children:[t("h3",{id:"prm-detail-title",children:[a(Ce,{size:14,"aria-hidden":!0}),t("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:I,title:"Close",children:a(Ie,{size:14})})]}),t("div",{className:"prm-modal-body prm-detail-body",children:[t("div",{className:"prm-detail-heading",children:[N&&(B?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${N}`,onClick:()=>{co(B)&&o.openExternal(B)},children:N}):a("span",{className:"prm-workitem-chip",children:N})),a("h4",{className:"prm-detail-pr-title",children:ae})]}),t("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${U.className}`,children:U.label}),e.isDraft&&t("span",{className:"prm-draft-pill",children:[a(We,{size:10,"aria-hidden":!0})," Draft"]}),T&&t("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(Je,{size:11,"aria-hidden":!0})," Muted"]}),de&&t("span",{className:`prm-tis prm-tis--${F}`,children:[de,ie&&t("span",{className:"prm-tis-cue",children:[" ",ie]})]}),ye&&(H||$)&&t("span",{className:`prm-tis prm-tis--review prm-tis--${oe}`,children:[H,$&&t("span",{className:"prm-tis-cue",children:[" ",$]})]})]}),O&&a("div",{className:"prm-detail-hint",children:O}),t("dl",{className:"prm-detail-facts",children:[e.author&&t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),t("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ca(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:qe(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:qe(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:qe(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Branches"}),t("div",{className:"prm-detail-branch",children:[a(He,{size:12,"aria-hidden":!0}),t("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>void ze(e.headRefName,"Branch name"),children:a(Ee,{size:10})})]})]}),e.body&&t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Description"}),a("div",{className:"prm-detail-desc",children:e.body})]}),j.length>0&&t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:ds.map(({state:G,label:Le,className:ue})=>{let be=C[G];return be.length===0?null:t("span",{className:`prm-reviewers-group ${ue}`,title:Le,children:[a("span",{className:"prm-reviewers-label",children:Le}),be.map(K=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:K.name||K.login,"aria-label":`${Le}: ${K.name||K.login}`,children:ca(K)},K.login))]},G)})})]}),t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Checks"}),a(ct,{checks:E})]}),M&&t("div",{className:"prm-detail-sync-error",children:[a(Pe,{size:12,"aria-hidden":!0}),t("span",{children:["Couldn't sync this PR: ",e.syncError]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:v,"aria-label":"Retry syncing this PR",onClick:()=>void he(),children:[a(ve,{size:11,className:v?"prm-spin":""})," Retry"]})]}),a("div",{className:"prm-detail-section",children:a(ut,{projectId:e.projectId,projects:s,onAssign:G=>y(e.url,G)})})]}),t("footer",{className:"prm-modal-footer prm-detail-footer",children:[t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:fe,title:"Open on GitHub",children:[a(Fe,{size:13}),a("span",{children:"Open on GitHub"})]}),t("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>void ze(e.url,"PR link"),children:[a(Ee,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${k?" prm-tile-icon-btn--active":""}`,title:k?"Unfavorite":"Favorite","data-tip":k?"Unfavorite":"Favorite","aria-label":k?"Unfavorite":"Favorite","aria-pressed":k,onClick:()=>void Te(),children:a(Oe,{size:13,...k?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:T?"Unmute":"Mute","data-tip":T?"Unmute":"Mute","aria-label":T?"Unmute":"Mute",onClick:()=>void ma(),children:T?a(Je,{size:13}):a(ke,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:x?"Mark this PR as read":"Mark this PR as unread","data-tip":x?"Mark read":"Mark unread","aria-label":x?"Mark read":"Mark unread",onClick:()=>void pa(),children:x?a($e,{size:13}):a(aa,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>h(e.url),children:a(ce,{size:13})})]})]})});return typeof document<"u"?fa(oa,document.body):oa}var cs=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],go=["closed-merged","closed-abandoned"],fs=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function ps(e,o){let s=e.favorite?1:0,r=o.favorite?1:0;return s!==r?r-s:o.lastStatusChange-e.lastStatusChange}function pt(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function ms(e,o){return e.length>0&&e.every(r=>{let n=o.find(d=>d.url===r);return n?!!n.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function gs(e){let o=e.lastIndexOf("/");return o>=0?e.slice(o+1):e}function xs(e){let o=e.workItem??ia(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),Ke(e.status),e.headRefName??"",e.baseRefName??"",o,e.repo,gs(e.repo)].join("").toLowerCase()}var po="boardShowEmpty",mo="boardCollapsed";function xo({prs:e,host:o,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:d,reviewDangerDays:m,repositories:L,workItemLocatorBase:S,sortField:f,sortDir:I,onSortChange:h,hostScope:y,onHostScopeChange:v,awaitingFirstSync:P,syncing:x,autoSyncEnabled:u,onDismiss:T,onProjectAssign:k,onBulkSetSeen:M,onBulkDismiss:N,onBulkSetFavorite:B,viewMode:ae="list",onViewModeChange:U}){let[E,j]=i("all"),[C,O]=i(""),[V,X]=i(new Set),[w,de]=i(!1),[se,ie]=i(ae),[F,ye]=i(!1),[A,H]=i(!1),[D,$]=i(()=>new Set),[oe,Ce]=i(null),le=Ve(null),fe=U?ae:se,ze=l=>{l==="board"&&j("all"),l==="list"&&ye(!1),U?U(l):ie(l)};q(()=>{let l=!0;return o.storage.get(po).then(R=>{l&&typeof R=="boolean"&&H(R)}),o.storage.get(mo).then(R=>{!l||!Array.isArray(R)||$(new Set(R.filter(ro)))}),()=>{l=!1}},[o]);let pa=l=>{H(l),o.storage.set(po,l)},ma=l=>{$(R=>{let _=new Set(R);return _.has(l)?_.delete(l):_.add(l),o.storage.set(mo,[..._]),_})},Te=Y(()=>{let l=[];for(let R of e){let _=St(R.url);l.includes(_)||l.push(_)}return l},[e]),he=Y(()=>{if(y.length===0)return e;let l=new Set(y);return e.filter(R=>l.has(St(R.url)))},[e,y]),oa=Y(()=>{let l=new Map;for(let R of he)l.set(R.status,(l.get(R.status)??0)+1);return l},[he]),G=Y(()=>E==="all"?he:he.filter(l=>l.status===E),[he,E]),Le=Y(()=>{let l=C.trim().toLowerCase();return l?G.filter(R=>xs(R).includes(l)):G},[G,C]),ue=Y(()=>{let l=I==="asc"?1:-1,R=[...Le];return f==="favorites"?(R.sort(ps),R):(R.sort((_,ne)=>{let pe=0;switch(f){case"created":pe=(_.createdAt??0)-(ne.createdAt??0);break;case"status":pe=wt(_.status)-wt(ne.status);break;case"statusUpdated":pe=_.lastStatusChange-ne.lastStatusChange;break;case"updated":default:pe=(_.updatedAt||_.lastChecked||_.lastStatusChange)-(ne.updatedAt||ne.lastChecked||ne.lastStatusChange);break}if(pe===0){let Ft=pt(_)?1:0,Ht=pt(ne)?1:0;return Ft!==Ht?Ht-Ft:(ne.createdAt??0)-(_.createdAt??0)}return pe*l}),R)},[Le,f,I]),be=Y(()=>lo(ft(ue)),[ue]),K=oe?e.find(l=>l.url===oe):void 0;q(()=>{oe&&!K&&Ce(null)},[oe,K]);let re=Y(()=>{if(!K)return null;let l=Ja(K.repo,L,r??Ue,n??_e),R=Lt(K.repo,L,d??ba,m??Ia),_=(L??[]).find(ne=>`${ne.owner}/${ne.repo}`.toLowerCase()===K.repo.toLowerCase());return{tisWarnHours:l.warnHours,tisDangerHours:l.dangerHours,reviewWarnDays:R.warnDays,reviewDangerDays:R.dangerDays,sfciGated:_?.sfciGated===!0,ignoredFailingChecks:_?.ignoredFailingChecks}},[K,L,r,n,d,m]),p=Y(()=>he.filter(pt).length,[he]),b=Y(()=>ue.map(l=>l.url),[ue]),g=Y(()=>b.filter(l=>V.has(l)),[b,V]),J=ue.length>0&&g.length===ue.length,ee=g.length>0&&!J,Ge=l=>{X(R=>{let _=new Set(R);return _.has(l)?_.delete(l):_.add(l),_})},De=()=>{X(J||ee?new Set:new Set(b))},Ne=()=>X(new Set),Sa=g.length>0?g:b,we=Sa.every(l=>{let R=e.find(_=>_.url===l);return R?!pt(R):!0}),ya=ms(g,e);if(e.length===0){if(P){let l=x||u;return t("div",{className:"prm-empty",children:[l?a(z,{size:32,className:"prm-spin","aria-hidden":!0}):a(ge,{size:32,"aria-hidden":!0}),a("h3",{children:l?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:l?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return t("div",{className:"prm-empty",children:[a(ge,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let xt=t("div",{className:"prm-list-toolbar",children:[t("div",{className:"prm-list-controls",children:[t("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[t("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":fe==="list",title:"List view",onClick:()=>ze("list"),children:[a(Ga,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),t("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":fe==="board",title:"Board view",onClick:()=>ze("board"),children:[a(sa,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),fe==="list"&&a("label",{className:"prm-select-all",title:J?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:J,ref:l=>{l&&(l.indeterminate=ee)},onChange:De,"aria-label":J?"Clear selection":"Select all shown PRs"})}),fe==="list"&&t("span",{className:"prm-shown-count","aria-live":"polite",children:[ue.length," shown"]}),t("div",{className:"prm-search",children:[a(Pa,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:C,onChange:l=>O(l.target.value),"aria-label":"Search PRs"})]}),t("button",{type:"button",ref:le,className:`prm-btn prm-btn--sm ${y.length>0?"is-active":""}`,onClick:()=>de(l=>!l),title:"Filter by host","aria-expanded":w,children:[a(za,{size:12}),t("span",{children:["Host",y.length>0&&t("span",{className:"prm-unread-count",children:[" (",y.length,")"]})]}),a(ga,{size:12})]}),w&&a(eo,{anchorRef:le,hosts:Te,selectedHosts:y,onClose:()=>de(!1),onToggleHost:l=>v(y.includes(l)?y.filter(R=>R!==l):[...y,l]),onSelectAll:()=>v([]),shortHost:Kt}),fe==="board"&&t(Q,{children:[t("button",{type:"button",className:`prm-btn prm-btn--sm ${F?"is-active":""}`,"aria-pressed":F,title:"Select cards for bulk actions",onClick:()=>ye(l=>!l),children:[a(na,{size:12}),a("span",{children:"Select"})]}),be>0&&t("button",{type:"button",className:`prm-btn prm-btn--sm ${A?"is-active":""}`,"aria-pressed":A,title:A?"Hide empty columns":`Show ${be} empty column${be===1?"":"s"}`,onClick:()=>pa(!A),children:[a(qa,{size:12}),a("span",{children:A?"Hide empty":`Empty (${be})`})]})]}),fe==="list"&&t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>M(Sa,!we),title:g.length>0?`Mark the ${g.length} selected PR(s) ${we?"unread":"read"}`:`Mark all shown PRs ${we?"unread":"read"}`,children:[a($e,{size:12}),t("span",{children:[we?"Mark unread":"Mark read",p>0&&t("span",{className:"prm-unread-count",children:[" (",p,")"]})]})]}),fe==="list"&&t("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:f,onChange:l=>h(l.target.value,I),"aria-label":"Sort field",children:fs.map(l=>a("option",{value:l.id,title:l.title,children:l.label},l.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>h(f,I==="asc"?"desc":"asc"),disabled:f==="favorites",title:f==="favorites"?"Favorites first uses a fixed order":I==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":I==="asc"?"Sorted ascending":"Sorted descending",children:I==="asc"?a(Na,{size:12}):a(Ta,{size:12})})]})]}),fe==="list"&&t("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[t("button",{type:"button",role:"tab","aria-selected":E==="all",className:`prm-segment-tab ${E==="all"?"active":""}`,onClick:()=>j("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:he.length})]}),cs.map(l=>{let R=oa.get(l)??0;return t("button",{type:"button",role:"tab","aria-selected":E===l,className:`prm-segment-tab prm-segment-tab--${l} ${E===l?"active":""}`,onClick:()=>j(l),title:`Show PRs in "${Ke(l)}"`,children:[Ke(l)," ",a("span",{className:"prm-segment-count",children:R})]},l)})]}),g.length>0&&t("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:Ne,title:"Clear selection","aria-label":"Clear selection",children:a(Ie,{size:12})}),t("span",{className:"prm-bulk-count",children:[g.length," selected"]}),t("div",{className:"prm-bulk-actions",children:[t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>M(g,!we),title:`Mark the selected PR(s) ${we?"unread":"read"}`,children:[we?a(aa,{size:12}):a($e,{size:12}),a("span",{children:we?"Mark unread":"Mark read"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>B(g,ya.favorite),title:`${ya.label} the selected PR(s)`,children:[a(Oe,{size:12,...ya.favorite?{}:{fill:"currentColor"}}),a("span",{children:ya.label})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{N(g),Ne()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(ce,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return t("div",{className:`prm-list${fe==="board"?" prm-list--board":""}`,children:[xt,ue.length===0?t("div",{className:"prm-empty prm-empty--filtered",children:[a(Pa,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:C.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),t("div",{className:"prm-empty-actions",children:[C.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>O(""),title:"Clear search",children:"Clear search"}),E!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>j("all"),title:"Show all PRs",children:"Show all"})]})]}):fe==="board"?a(uo,{prs:ue,host:o,tisWarnHours:r,tisDangerHours:n,repositories:L,selected:V,selectMode:F,showEmpty:A,collapsed:D,onToggleCollapse:ma,onToggleSelect:Ge,onDismiss:T,onOpen:Ce}):a("div",{className:"prm-tile-list",children:ue.map(l=>{let R=Ja(l.repo,L,r??Ue,n??_e),_=Lt(l.repo,L,d??ba,m??Ia),ne=(L??[]).find(pe=>`${pe.owner}/${pe.repo}`.toLowerCase()===l.repo.toLowerCase());return a(Qt,{pr:l,host:o,projects:s,tisWarnHours:R.warnHours,tisDangerHours:R.dangerHours,reviewWarnDays:_.warnDays,reviewDangerDays:_.dangerDays,sfciGated:ne?.sfciGated===!0,ignoredFailingChecks:ne?.ignoredFailingChecks,workItemLocatorBase:S,selected:V.has(l.url),onToggleSelect:Ge,onDismiss:T,onProjectAssign:k},l.url)})}),K&&re&&a(fo,{pr:K,host:o,projects:s,tisWarnHours:re.tisWarnHours,tisDangerHours:re.tisDangerHours,reviewWarnDays:re.reviewWarnDays,reviewDangerDays:re.reviewDangerDays,sfciGated:re.sfciGated,ignoredFailingChecks:re.ignoredFailingChecks,workItemLocatorBase:S,onClose:()=>Ce(null),onDismiss:l=>{Ce(null),T(l)},onProjectAssign:k})]})}function ho({host:e,onClose:o,onPulled:s}){let[r,n]=i([]),[d,m]=i(!1),[L,S]=i(""),[f,I]=i(""),[h,y]=i(!1),[v,P]=i(null),x=Ve(null);q(()=>{let k=!0;return e.call("listRepos").then(M=>{if(!k)return;let N=(M?.repos??[]).filter(B=>B.active&&B.connection==="connected");n(N),N.length>0&&S(`${N[0].host}|${N[0].owner}/${N[0].repo}`),m(!0)}).catch(()=>{k&&m(!0)}),()=>{k=!1}},[e]),q(()=>{let k=M=>{M.key==="Escape"&&!h&&o()};return window.addEventListener("keydown",k),()=>window.removeEventListener("keydown",k)},[o,h]);let u=Y(()=>r.find(k=>`${k.host}|${k.owner}/${k.repo}`===L),[r,L]),T=async()=>{P(null);let k=Number(f.trim());if(!u){P("Select a repository.");return}if(!Number.isFinite(k)||k<=0){P("Enter a valid PR number.");return}y(!0);try{let M=await e.call("pullPr",{host:u.host,fullName:`${u.owner}/${u.repo}`,number:k});M?.ok&&Array.isArray(M.prs)?s(M.prs):P(M?.error||"Failed to pull PR.")}catch(M){P(M instanceof Error?M.message:String(M))}finally{y(!1)}};return a("div",{className:"modal-backdrop",onClick:()=>!h&&o(),children:t("div",{className:"modal prm-modal",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-pull-title",onClick:k=>k.stopPropagation(),children:[t("header",{className:"prm-modal-header",children:[t("h3",{id:"prm-pull-title",children:[a(ge,{size:14,"aria-hidden":!0})," Add PR"]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:o,title:"Close",children:a(Ie,{size:14})})]}),t("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),d&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):t("select",{className:"prm-input prm-input--select",value:L,onChange:k=>S(k.target.value),disabled:h||!d,"aria-label":"Repository",children:[!d&&a("option",{children:"Loading\u2026"}),r.map(k=>{let M=`${k.host}|${k.owner}/${k.repo}`;return t("option",{value:M,children:[k.owner,"/",k.repo," (",k.shortHost,")"]},M)})]})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{ref:x,type:"number",min:1,value:f,placeholder:"e.g. 42",className:"prm-input",onChange:k=>{I(k.target.value),v&&P(null)},onKeyDown:k=>{k.key==="Enter"&&!h&&(k.preventDefault(),T())},disabled:h||r.length===0})]}),v&&a("div",{className:"prm-modal-error",children:v})]}),t("footer",{className:"prm-modal-footer",children:[t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void T(),disabled:h||r.length===0||!f.trim(),title:"Add this PR to the monitored list",children:[h?a(z,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]}),a("button",{type:"button",className:"prm-btn",onClick:o,disabled:h,title:"Cancel without adding",children:"Cancel"})]})]})})}function Lo({anchorRef:e,host:o,selectedRepos:s,onClose:r,onToggleRepo:n,onSelectAll:d,onSync:m}){let[L,S]=i(null),[f,I]=i([]);if(q(()=>{let y=e.current;if(!y)return;let v=y.getBoundingClientRect();S({top:v.bottom+4,left:v.right})},[e]),q(()=>{let y=!0;return o.call("listRepos").then(v=>{y&&I((v?.repos??[]).filter(P=>P.active&&P.connection==="connected"))}).catch(()=>{}),()=>{y=!1}},[o]),q(()=>{let y=v=>{v.key==="Escape"&&r()};return window.addEventListener("keydown",y),()=>window.removeEventListener("keydown",y)},[r]),!L||typeof document>"u")return null;let h=s.length===0;return fa(t(Q,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:y=>{y.stopPropagation(),r()}}),t("div",{className:"prm-tile-menu prm-sync-filter",style:{position:"fixed",top:L.top,left:L.left,transform:"translateX(-100%)"},role:"menu",children:[t("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),t("button",{type:"button",className:`prm-project-menu-item ${h?"is-active":""}`,role:"menuitemcheckbox","aria-checked":h,onClick:y=>{y.stopPropagation(),d()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:h&&a(Be,{size:12})}),"All repositories"]}),f.map(y=>{let v=`${y.owner}/${y.repo}`,P=s.includes(v);return t("button",{type:"button",className:`prm-project-menu-item ${P?"is-active":""}`,role:"menuitemcheckbox","aria-checked":P,onClick:x=>{x.stopPropagation(),n(v)},title:`Filter/sync ${v}`,children:[a("span",{className:"prm-sync-filter-check",children:P&&a(Be,{size:12})}),v," ",t("span",{className:"prm-sync-filter-host",children:["(",y.shortHost,")"]})]},`${y.host}|${v}`)}),a("div",{className:"prm-tile-menu-divider"}),t("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{m(s),r()},title:h?"Sync all repositories now":"Sync the selected repositories now",children:h?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Ze({title:e,subtitle:o,actions:s}){return t("header",{className:"prm-area-header",children:[t("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:o})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function mt({state:e}){return e==="checking"?t("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(z,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?t("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(me,{size:11})," Connected"]}):t("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(Se,{size:11})," Disconnected"]})}function ta({title:e,icon:o,onClose:s,busy:r,footer:n,children:d,wide:m}){return q(()=>{let L=S=>{S.key==="Escape"&&!r&&s()};return window.addEventListener("keydown",L),()=>window.removeEventListener("keydown",L)},[s,r]),a("div",{className:"modal-backdrop",onClick:()=>!r&&s(),children:t("div",{className:`modal prm-modal${m?" prm-modal--wide":""}`,role:"dialog","aria-modal":!0,onClick:L=>L.stopPropagation(),children:[t("header",{className:"prm-modal-header",children:[t("h3",{children:[o," ",e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close",children:a(Ie,{size:14})})]}),d]})})}function gt({title:e,message:o,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:n,busy:d,onConfirm:m,onCancel:L}){return t(ta,{title:e,onClose:L,busy:d,children:[a("div",{className:"prm-modal-body",children:o}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:L,disabled:d,children:r}),t("button",{type:"button",className:`prm-btn ${n?"prm-btn--danger":"prm-btn--primary"}`,onClick:m,disabled:d,children:[d?a(z,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function bo({host:e}){let[o,s]=i(()=>{let u=e.cache.get(Ya);return u?.ok&&Array.isArray(u.orgs)?u.orgs:null}),[r,n]=i(null),[d,m]=i(!1),[L,S]=i(null),[f,I]=i(!1),[h,y]=i(!1),v=te(async()=>{try{let u=await e.call("listOrgs");u?.ok&&Array.isArray(u.orgs)?(s(u.orgs),n(null)):(s([]),u?.error&&n(u.error))}catch(u){s([]),n(u instanceof Error?u.message:String(u))}},[e]);q(()=>{v()},[v]);let P=async()=>{m(!0),n(null);try{let u=await e.call("rediscoverOrgs");!u?.ok&&u?.error&&n(u.error),await v()}catch(u){n(u instanceof Error?u.message:String(u))}finally{m(!1)}},x=async()=>{if(L){I(!0);try{let u=await e.call("deleteOrg",{host:L.host,login:L.login});!u?.ok&&u?.error&&e.toast(u.error,"error"),await v()}catch(u){e.toast(u instanceof Error?u.message:String(u),"error")}finally{I(!1),S(null)}}};return t("div",{className:"prm-area",children:[a(Ze,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:t(Q,{children:[t("button",{type:"button",className:"prm-btn",onClick:()=>void P(),disabled:d,title:"Re-discover organizations from your gh accounts",children:[d?a(z,{size:13,className:"prm-spin"}):a(Me,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>y(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(Re,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),o===null?t("div",{className:"prm-loading",children:[a(z,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):o.length===0?t("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:o.map(u=>t("div",{className:"prm-entity-card",children:[t("div",{className:"prm-entity-main",children:[t("div",{className:"prm-entity-title",children:[u.login," ",t("span",{className:"prm-entity-host",children:["(",u.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:u.apiBaseUrl}),t("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:u.login})]})]}),t("div",{className:"prm-entity-side",children:[a(mt,{state:d?"checking":u.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>S(u),title:"Delete organization",children:a(ce,{size:15})})]})]},`${u.host}|${u.login}`))}),h&&t(ta,{title:"Adding & removing organizations",icon:a(Re,{size:16}),onClose:()=>y(!1),children:[t("div",{className:"prm-modal-body prm-help-body",children:[t("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),t("ul",{children:[t("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),t("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),t("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),t("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>y(!1),children:a("span",{children:"Got it"})})})]}),L&&a(gt,{title:"Delete organization?",danger:!0,busy:f,message:t(Q,{children:["Delete ",a("strong",{children:L.login})," (",L.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>void x(),onCancel:()=>S(null)})]})}function hs(e,o){try{let s=new URL(o);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(o)}catch{}}function Io(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function Ls(e,o){await Ma(o)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Co({host:e,onRepositoriesChanged:o}){let[s,r]=i(()=>{let C=e.cache.get(It);return C?.ok&&Array.isArray(C.repos)?C.repos:null}),[n,d]=i(()=>{let C=e.cache.get(Ya);return C?.ok&&Array.isArray(C.orgs)?C.orgs:[]}),[m,L]=i(null),[S,f]=i(!1),[I,h]=i(!1),[y,v]=i(!1),[P,x]=i(null),[u,T]=i("general"),[k,M]=i(null),[N,B]=i(null),[ae,U]=i(!1),E=te(async()=>{try{let[C,O]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);C?.ok&&Array.isArray(C.repos)?(r(C.repos),L(null)):(r([]),C?.error&&L(C.error)),d(O?.ok&&Array.isArray(O.orgs)?O.orgs:[])}catch(C){r([]),L(C instanceof Error?C.message:String(C))}},[e]);q(()=>{E()},[E]);let j=async()=>{if(N){U(!0);try{await e.call("deleteRepository",{host:N.host,owner:N.owner,repo:N.repo}),await E()}catch(C){e.toast(C instanceof Error?C.message:String(C),"error")}finally{U(!1),B(null)}}};return t("div",{className:"prm-area",children:[a(Ze,{title:"Repositories",subtitle:"Manage your connected repositories",actions:t(Q,{children:[t("button",{type:"button",className:"prm-btn",onClick:()=>h(!0),children:[a(Me,{size:13})," ",a("span",{children:"Suggested for you"})]}),t("button",{type:"button",className:"prm-btn",onClick:()=>v(!0),children:[a(va,{size:13})," ",a("span",{children:"Browse Repositories"})]}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>f(!0),children:[a(ka,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),m&&a("div",{className:"prm-error",children:m}),s===null?t("div",{className:"prm-loading",children:[a(z,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?t("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(C=>t("div",{className:"prm-entity-card prm-repo-card",children:[t("div",{className:"prm-repo-top",children:[t("div",{className:"prm-entity-title",children:[a(He,{size:14,"aria-hidden":!0})," ",t("span",{children:[C.owner,"/",C.repo]}),a("span",{className:`prm-active-badge${C.active?"":" prm-active-badge--off"}`,children:C.active?"Active":"Inactive"}),a(mt,{state:C.connection}),(()=>{let O=Za[C.buildTisPreset??C.tisPreset??tt],V=Ka[C.reviewTisPreset??ot];return t(Q,{children:[t("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${O.warnHours}h, behind schedule after ${O.dangerHours}h`,children:[a(Ae,{size:11,"aria-hidden":!0}),"Build: ",O.label]}),t("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${V.warnDays}d, behind schedule after ${V.dangerDays}d`,children:[a(Ae,{size:11,"aria-hidden":!0}),"Review: ",V.label]})]})})()]}),t("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>hs(e,Io(C)),children:a(Fe,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>void Ls(e,Io(C)),children:a(Ee,{size:14})})]})]}),t("div",{className:"prm-entity-sub prm-repo-meta",children:[t("span",{children:["Organization: ",C.orgLogin," (",C.shortHost,")"]}),t("span",{children:["Created ",qe(C.createdAt)]})]}),t("div",{className:"prm-repo-actions",children:[t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>M(C),children:[a(xa,{size:12})," ",a("span",{children:"Test Connection"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{T("general"),x(C)},children:[a(je,{size:12})," ",a("span",{children:"Edit Repository"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{T("status"),x(C)},title:"Status Settings",children:[a(Ae,{size:12})," ",a("span",{children:"Status Settings"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{T("notifications"),x(C)},title:"Notification Settings",children:[a(ke,{size:12})," ",a("span",{children:"Notification Settings"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>B(C),children:[a(ce,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${C.host}|${C.owner}/${C.repo}`))}),S&&a(bs,{host:e,orgs:n,onClose:()=>f(!1),onAdded:async()=>{f(!1),await E()}}),I&&a(Is,{host:e,onClose:()=>h(!1),onAdded:async()=>{await E()}}),y&&a(Cs,{host:e,onClose:()=>v(!1),onAdded:async()=>{await E()}}),P&&a(Ss,{host:e,repo:P,orgs:n,initialTab:u,onClose:()=>x(null),onSaved:async C=>{x(null),Array.isArray(C)&&(e.cache.set(Z,C),e.cache.set(xe,C.length),e.cache.refreshBadge()),o?.(),await E()}}),k&&a(ys,{host:e,repo:k,onClose:()=>M(null),onResult:C=>{let O=C?"connected":"disconnected";r(V=>(V??[]).map(X=>X.host===k.host&&X.owner===k.owner&&X.repo===k.repo?{...X,connection:O}:X))}}),N&&a(gt,{title:"Delete repository?",danger:!0,busy:ae,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>void j(),onCancel:()=>B(null)})]})}function bs({host:e,orgs:o,onClose:s,onAdded:r}){let[n,d]=i(""),[m,L]=i(o[0]?`${o[0].host}|${o[0].login}`:""),[S,f]=i(null),[I,h]=i(!1),y=async()=>{let v=o.find(P=>`${P.host}|${P.login}`===m);if(!v){f("Please select an organization.");return}h(!0),f(null);try{let P=await e.call("addRepository",{ref:n.trim(),host:v.host,orgLogin:v.login});P?.ok?r():f(P?.error||"Failed to add repository.")}catch(P){f(P instanceof Error?P.message:String(P))}finally{h(!1)}};return t(ta,{title:"Add repository",icon:a(ka,{size:14}),onClose:s,busy:I,children:[t("div",{className:"prm-modal-body",children:[t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:n,spellCheck:!1,onChange:v=>{d(v.target.value),S&&f(null)},onKeyDown:v=>{v.key==="Enter"&&!I&&(v.preventDefault(),y())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),t("select",{className:"prm-input prm-input--select",value:m,onChange:v=>L(v.target.value),children:[o.length===0&&a("option",{value:"",children:"No organizations"}),o.map(v=>t("option",{value:`${v.host}|${v.login}`,children:[v.login," (",v.shortHost,")"]},`${v.host}|${v.login}`))]})]}),S&&a("div",{className:"prm-modal-error",children:S})]}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:I,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void y(),disabled:I||!n.trim(),children:[I?a(z,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function Is({host:e,onClose:o,onAdded:s}){let[r,n]=i(null),[d,m]=i(new Set),[L,S]=i(null),[f,I]=i(!1),h=te(async()=>{n(null),S(null);try{let x=await e.call("suggestRepositories");x?.ok&&Array.isArray(x.repos)?(n(x.repos),m(new Set(x.repos.filter(u=>u.alreadyAdded).map(u=>u.fullName)))):(n([]),x?.error&&S(x.error))}catch(x){n([]),S(x instanceof Error?x.message:String(x))}},[e]);q(()=>{h()},[h]);let y=x=>{x.alreadyAdded||m(u=>{let T=new Set(u);return T.has(x.fullName)?T.delete(x.fullName):T.add(x.fullName),T})},v=async()=>{if(!r)return;let x=r.filter(u=>!u.alreadyAdded&&d.has(u.fullName));if(x.length!==0){I(!0);try{await e.call("addRepositories",{repos:x.map(u=>({owner:u.owner,repo:u.repo,host:u.host,orgLogin:u.orgLogin}))}),await s(),o()}catch(u){e.toast(u instanceof Error?u.message:String(u),"error")}finally{I(!1)}}},P=r?r.filter(x=>!x.alreadyAdded&&d.has(x.fullName)).length:0;return t(ta,{title:"Suggested for you",icon:a(Me,{size:14}),onClose:o,busy:f,wide:!0,children:[t("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?t("div",{className:"prm-loading",children:[a(z,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):L?a("div",{className:"prm-modal-error",children:L}):r.length===0?t("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(x=>t("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:d.has(x.fullName),disabled:x.alreadyAdded,onChange:()=>y(x)}),t("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:x.fullName}),t("span",{className:"prm-entity-sub",children:[x.prCount," PRs \xB7 ",qe(x.lastActivity)]})]}),x.alreadyAdded&&t("span",{className:"prm-suggested-added",children:[a(me,{size:13})," Already added"]})]},x.fullName))})]}),t("footer",{className:"prm-modal-footer",children:[t("button",{type:"button",className:"prm-btn",onClick:()=>void h(),disabled:f||r===null,children:[a(Me,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:o,disabled:f,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void v(),disabled:f||P===0,children:[f?a(z,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Adding\u2026":P>0?`Add ${P} Selected`:"Add Selected"})]})]})]})}function Cs({host:e,onClose:o,onAdded:s}){let[r,n]=i(""),[d,m]=i(null),[L,S]=i(!0),[f,I]=i(!1),[h,y]=i(!1),[v,P]=i(1),[x,u]=i(null),[T,k]=i(new Set),[M,N]=i(new Set),[B,ae]=i(new Set),[U,E]=i(!1),j=te(async(A,H)=>{H?I(!0):S(!0),u(null);try{let D=await e.call("listAllRepositories",{page:A}),$=D?.ok&&Array.isArray(D.repos)?D.repos:[];y(!!D?.hasMore),ae(new Set(Array.isArray(D?.incompleteOwners)?D.incompleteOwners:[])),m(oe=>{if(!H||!oe)return $;let Ce=new Set(oe.map(le=>`${le.host}|${le.fullName}`));return[...oe,...$.filter(le=>!Ce.has(`${le.host}|${le.fullName}`))]}),D&&D.ok===!1&&D.error&&u(D.error)}catch(D){u(D instanceof Error?D.message:String(D)),H||m([])}finally{S(!1),I(!1)}},[e]);q(()=>{j(1,!1)},[j]);let C=()=>{let A=v+1;P(A),j(A,!0)},O=d??[],V=r.trim().toLowerCase(),X=V?O.filter(A=>A.fullName.toLowerCase().includes(V)):O,w=A=>{k(H=>{let D=new Set(H);return D.has(A)?D.delete(A):D.add(A),D})},de=A=>{N(H=>{let D=new Set(H);return D.has(A)?D.delete(A):D.add(A),D})},se=A=>`${A.host}|${A.fullName}`,ie=(()=>{let A=new Map;for(let H of X){let D=A.get(H.owner)??[];D.push(H),A.set(H.owner,D)}return Array.from(A.entries())})(),F=async()=>{let A=X.filter(H=>!H.alreadyAdded&&T.has(se(H)));if(A.length!==0){E(!0);try{await e.call("addRepositories",{repos:A.map(H=>({owner:H.owner,repo:H.repo,host:H.host,orgLogin:H.owner}))}),await s(),o()}catch(H){e.toast(H instanceof Error?H.message:String(H),"error")}finally{E(!1)}}},ye=X.filter(A=>!A.alreadyAdded&&T.has(se(A))).length;return t(ta,{title:"Browse Repositories",icon:a(va,{size:14}),onClose:o,busy:U,wide:!0,children:[t("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:A=>n(A.target.value)})}),x&&a("div",{className:"prm-modal-error",children:x}),L?t("div",{className:"prm-loading",children:[a(z,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):t("div",{className:"prm-browse-list",children:[ie.map(([A,H])=>{let D=!M.has(A);return t("div",{className:"prm-browse-group",children:[t("button",{type:"button",className:"prm-browse-group-header",onClick:()=>de(A),"aria-expanded":D,children:[a(Ye,{size:13,className:`prm-disclosure${D?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:A}),t("span",{className:"prm-browse-group-count",title:!V&&B.has(A)?`${H.length} loaded \u2014 more available, use Load more`:void 0,children:["(",H.length,!V&&B.has(A)?"\u2026":"",")"]})]}),D&&H.map($=>$.alreadyAdded?t("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[t("span",{children:[a(He,{size:13,"aria-hidden":!0})," ",$.fullName,$.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),t("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(me,{size:11,"aria-hidden":!0})," Connected"]})]},se($)):t("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:T.has(se($)),onChange:()=>w(se($))}),t("span",{children:[a(He,{size:13,"aria-hidden":!0})," ",$.fullName,$.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},se($)))]},A)}),X.length===0&&a("div",{className:"prm-area-empty",children:V?"No repositories match your filter.":"No repositories found."}),h&&!V&&t("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:C,disabled:f,children:[f?a(z,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Loading\u2026":"Load more"})]})]})]}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:o,disabled:U,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void F(),disabled:U||ye===0,children:[U?a(z,{size:13,className:"prm-spin"}):null,a("span",{children:ye>0?`Add ${ye} Selected`:"Add Selected"})]})]})]})}function Ss({host:e,repo:o,orgs:s,initialTab:r="general",onClose:n,onSaved:d}){let[m,L]=i(r),[S,f]=i(`${o.owner}/${o.repo}`),[I,h]=i(o.orgLogin),[y,v]=i(o.active),[P,x]=i(o.buildTisPreset??o.tisPreset??tt),[u,T]=i(o.reviewTisPreset??ot),[k,M]=i(o.sfciGated===!0),[N,B]=i((o.ignoredFailingChecks??[]).some(w=>w.toLowerCase().includes("snyk"))),[ae,U]=i(o.notifyInApp??!0),[E,j]=i(null),[C,O]=i(!1),V=s.filter(w=>w.host===o.host),X=async()=>{O(!0),j(null);try{let w=await e.call("updateRepository",{key:{host:o.host,owner:o.owner,repo:o.repo},ref:S.trim(),orgLogin:I,active:y,buildTisPreset:P,reviewTisPreset:u,sfciGated:k,ignoredFailingChecks:N?["Snyk"]:[],notifyInApp:ae});w?.ok?d(w.prs):j(w?.error||"Failed to save settings.")}catch(w){j(w instanceof Error?w.message:String(w))}finally{O(!1)}};return t(ta,{title:t("span",{className:"prm-dialog-title",children:["Repository Settings ",t("span",{className:"prm-entity-sub",children:[o.owner,"/",o.repo]})]}),icon:a(je,{size:14}),onClose:n,busy:C,children:[t("nav",{className:"prm-dialog-tabs",children:[t("button",{type:"button",className:`prm-dialog-tab${m==="general"?" active":""}`,onClick:()=>L("general"),children:[a(je,{size:12})," General"]}),t("button",{type:"button",className:`prm-dialog-tab${m==="status"?" active":""}`,onClick:()=>L("status"),children:[a(Ae,{size:12})," Status"]}),t("button",{type:"button",className:`prm-dialog-tab${m==="notifications"?" active":""}`,onClick:()=>L("notifications"),children:[a(ke,{size:12})," Notifications"]})]}),t("div",{className:"prm-modal-body",children:[m==="general"?t(Q,{children:[t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:y,onChange:w=>v(w.target.checked)}),t("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:S,spellCheck:!1,onChange:w=>f(w.target.value)})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:I,onChange:w=>h(w.target.value),children:V.map(w=>t("option",{value:w.login,children:[w.login," (",w.shortHost,")"]},w.login))})]})]}):m==="status"?t(Q,{children:[t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:P,onChange:w=>x(w.target.value),children:Object.values(Za).map(w=>t("option",{value:w.id,children:[w.label," (",w.warnHours,"h / ",w.dangerHours,"h)"]},w.id))})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:u,onChange:w=>T(w.target.value),children:Object.values(Ka).map(w=>t("option",{value:w.id,children:[w.label," (",w.warnDays,"d / ",w.dangerDays,"d)"]},w.id))})]}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:k,onChange:w=>M(w.target.checked)}),t("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:N,onChange:w=>B(w.target.checked)}),t("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:ae,onChange:w=>U(w.target.checked)}),t("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),E&&a("div",{className:"prm-modal-error",children:E})]}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:n,disabled:C,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void X(),disabled:C,children:[C?a(z,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function ys({host:e,repo:o,onClose:s,onResult:r}){let[n,d]=i(null);return q(()=>{let m=!0;return(async()=>{try{let S=await e.call("testRepository",{host:o.host,owner:o.owner,repo:o.repo})??{ok:!1,error:"No response"};m&&(d(S),r?.(S.ok))}catch(L){m&&(d({ok:!1,error:L instanceof Error?L.message:String(L)}),r?.(!1))}})(),()=>{m=!1}},[e,o]),t(ta,{title:`Connection Test Results: ${o.owner}/${o.repo}`,icon:a(xa,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:n===null?t("div",{className:"prm-loading",children:[a(xa,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):n.ok?t("div",{className:"prm-test-result prm-test-result--ok",children:[a(me,{size:16})," All connection tests passed."]}):t("div",{className:"prm-test-result prm-test-result--fail",children:[a(Se,{size:16}),t("div",{children:[a("div",{children:n.error||"Connection failed."}),t("div",{className:"prm-field-hint",children:["Try ",t("code",{children:["gh auth login ",o.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function ws(e){let o=e.trim().split(/\s+/).filter(Boolean);return o.length===0?"?":o.length===1?o[0].slice(0,2).toUpperCase():(o[0][0]+o[o.length-1][0]).toUpperCase()}function So({host:e}){let[o,s]=i(()=>{let f=e.cache.get(Ct);return f?.ok?f.author??null:void 0}),[r,n]=i(null),[d,m]=i(!1),L=te(async()=>{try{let f=await e.call("getAuthor");f?.ok?(s(f.author??null),n(null)):(s(null),f?.error&&n(f.error))}catch(f){s(null),n(f instanceof Error?f.message:String(f))}},[e]);q(()=>{L()},[L]);let S=o?.name||o?.login||"";return t("div",{className:"prm-area",children:[a(Ze,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),o===void 0?t("div",{className:"prm-loading",children:[a(z,{size:14,className:"prm-spin"})," Loading author\u2026"]}):o===null?t("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:t("div",{className:"prm-entity-card prm-author-card",children:[t("button",{type:"button",className:"prm-author-row",onClick:()=>m(f=>!f),"aria-expanded":d,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:ws(S)}),t("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:S}),o.email&&a("span",{className:"prm-entity-sub",children:o.email})]}),a(Ye,{size:16,className:`prm-disclosure${d?" is-open":""}`,"aria-hidden":!0})]}),d&&t("div",{className:"prm-author-detail",children:[t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:S||"\u2014"})]}),t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:o.email||"\u2014"})]}),t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:o.identities.map(f=>t("div",{className:"prm-identity-row",children:[t("span",{children:[f.login," ",t("span",{className:"prm-entity-host",children:["(",f.shortHost,")"]})]}),f.connection==="connected"?a(me,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):t("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(Se,{size:13})," Disconnected"]})]},`${f.host}|${f.login}`))})]})]})]})})]})}function yo({settings:e,update:o}){let s=e.notifyInApp??e.notifyOnChange;return t("div",{className:"prm-area",children:[a(Ze,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>o({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),t("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>o({sendToInbox:r.target.checked})}),t("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),t("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),t("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>o({badgeMode:"unread"})}),t("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),t("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>o({badgeMode:"total"})}),t("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var wo=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],vs=15;function vo(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function ks(e,o){let s=Math.max(0,e-o),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let n=Math.floor(r/60),d=r%60;return d?`in ${n}h ${d}m`:`in ${n}h`}function ko({settings:e,update:o,host:s}){let[r,n]=i(()=>s.cache.get(Z)??[]),[d,m]=i(!1),[L,S]=i(()=>Date.now());q(()=>{let x=window.setInterval(()=>{let u=s.cache.get(Z);u&&n(T=>T===u?T:u),S(Date.now())},1e3);return()=>window.clearInterval(x)},[s]);let f=e.autoSyncEnabled??!0,I=wo.some(x=>x.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:vs,h=r.reduce((x,u)=>Math.max(x,u.lastChecked||0),0),y=f&&h?h+I*6e4:0,v=new Set(r.map(x=>x.repo)).size,P=async()=>{m(!0);try{let x=await s.call("pollAll");x?.ok&&Array.isArray(x.prs)&&(n(x.prs),s.cache.set(Z,x.prs))}catch(x){s.toast(x instanceof Error?x.message:String(x),"error")}finally{m(!1)}};return t("div",{className:"prm-area",children:[a(Ze,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:f,onChange:x=>o({autoSyncEnabled:x.target.checked})}),t("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),t("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:I,onChange:x=>{let u=Number(x.target.value);Number.isFinite(u)&&o({pollIntervalMinutes:u})},children:wo.map(x=>a("option",{value:x.value,children:x.label},x.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),t("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),t("div",{className:"prm-sync-status",children:[t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:y?t(Q,{children:[ks(y,L)," ",t("span",{className:"prm-field-hint",children:["\xB7 ",vo(y)]})]}):"\u2014"})]}),t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:h?t(Q,{children:[qe(h)," ",t("span",{className:"prm-field-hint",children:["\xB7 ",vo(h)]})]}):""})]}),t("div",{className:"prm-sync-counts",children:[t("span",{className:"prm-sync-count",children:[a("strong",{children:v})," repositories checked"]}),t("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),t("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>void P(),disabled:d,children:[d?a(z,{size:13,className:"prm-spin"}):a(ve,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var Ps=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:Fa},{id:"repositories",label:"Repositories",icon:Ba},{id:"author",label:"Author",icon:$a}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:ke}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:Xa}]}];function Po({settings:e,onSave:o,onRepositoriesChanged:s,host:r}){let[n,d]=i(e.settingsActiveNav??bt),m=S=>{let f={...e,...S};o(f),r.cache.set("settings",f),r.cache.refreshBadge()},L=S=>{d(S),m({settingsActiveNav:S})};return a("div",{className:"prm-settings-shell",children:t("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:Ps.map(S=>t("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:S.label}),S.items.map(f=>{let I=f.icon;return t("button",{type:"button",className:`prm-nav-row${n===f.id?" active":""}`,"aria-current":n===f.id,onClick:()=>L(f.id),children:[a(I,{size:15,"aria-hidden":!0}),a("span",{children:f.label})]},f.id)})]},S.label))}),t("div",{className:"prm-settings-pane",children:[n==="organizations"&&a(bo,{host:r}),n==="repositories"&&a(Co,{host:r,onRepositoriesChanged:s}),n==="author"&&a(So,{host:r}),n==="notifications"&&a(yo,{settings:e,update:m}),n==="system"&&a(ko,{settings:e,update:m,host:r})]})]})})}function Ro(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function Ao(e,o,s){return e===1?o:s}function Mo(e){if(!e)return null;let o=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return o.length>0?{kind:"disconnect",subjects:o,action:"settings",message:`GitHub sign-in expired for ${Ro(o)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${Ao(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${Ao(r.length,"is","is")} temporarily unreachable for ${Ro(r)} \u2014 retrying automatically.`}:null}function Rs(e,o){let s=(e.repo??"").toLowerCase();if(s)return(o??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function To(e,o){let s=Rs(e,o.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let d=o.notifyInApp??o.notifyOnChange??!1,m=o.sendToInbox??!1;return{inApp:d,inbox:m&&!!e.projectId}}function Do(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function As(e){try{let o=new URL(e);if(o.protocol!=="http:"&&o.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function No(e,o,s){for(let r of o){let n=yt(r.newStatus)>yt(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||n))continue;let m=To(r.pr,s);if(!m.inApp&&!m.inbox)continue;let L=Do(r.pr.repo),S=Do(r.pr.title),f=As(r.pr.url),I=f?`[${S}](${f})`:S;if(m.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${Ke(r.oldStatus)} \u2192 ${Ke(r.newStatus)}`,"info"),m.inbox&&r.pr.projectId){let h=`**${L}#${r.pr.number}** \u2014 ${Ke(r.oldStatus)} \u2192 **${Ke(r.newStatus)}**

${I}`;try{await e.pushInbox({comments:h,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var Pt="activeSubTab",Bo="listSort",Fo="hostScope",Rt="listView";function At({host:e}){let[o,s]=i(null),[r,n]=i(!1),[d,m]=i(()=>e.cache.get(Z)??[]),[L,S]=i(!1),[f,I]=i(null),[h,y]=i("prs"),[v,P]=i(!1),[x,u]=i(!1),[T,k]=i(!1),[M,N]=i(!1),[B,ae]=i([]),[U,E]=i("status"),[j,C]=i("asc"),[O,V]=i([]),[X,w]=i("board"),[de,se]=i(!1),[ie,F]=i(()=>({...$t})),ye=Ve(null),[A,H]=i(()=>e.listProjects());q(()=>{let p=!0;return Promise.all([e.storage.get(La),e.storage.get(Pt),e.call("listPrs"),e.storage.get(Bo),e.storage.get(Fo),e.storage.get(Rt)]).then(([b,g,J,ee,Ge,De])=>{if(!p)return;ee?.field&&E(ee.field),ee?.dir&&C(ee.dir),Array.isArray(Ge)&&V(Ge),kt(De)&&w(De);let Ne=b?{...ha,...b,relevanceModes:{...ha.relevanceModes,...b.relevanceModes}}:null;s(Ne),Ne&&(e.cache.set("settings",Ne),e.cache.refreshBadge?.()),g==="prs"||g==="settings"?y(g):(g==="board"||g==="list")&&(y("prs"),kt(De)||(w(g),e.storage.set(Rt,g)),e.storage.set(Pt,"prs")),Array.isArray(J)&&J.length>0&&(m(J),e.cache.set(Z,J),e.cache.set(xe,J.length),e.cache.refreshBadge?.()),n(!0),P(!0),N(!0)}).catch(b=>{p&&(console.error("pr-monitor hydrate failed",b),n(!0),P(!0),N(!0))}),()=>{p=!1}},[e]),q(()=>{let p=()=>{let g=e.cache.get(Z);g&&m(ee=>ee===g?ee:g);let J=e.listProjects();H(ee=>ee.length===J.length?ee:J)},b=window.setInterval(p,100);return()=>window.clearInterval(b)},[e]);let D=p=>{y(p),e.storage.set(Pt,p)},$=te(async p=>{S(!0),I(null);try{let b=Array.isArray(p)&&p.length>0,g=b?await e.call("syncRepos",{repos:p}):await e.call("pollAll");if(g?.ok&&Array.isArray(g.prs)){if(m(g.prs),e.cache.set(Z,g.prs),e.cache.set(xe,g.prs.length),e.cache.refreshBadge?.(),Array.isArray(g.deltas)&&g.deltas.length>0){let ee=o??{...ha,...await e.storage.get(La)};await No(e,g.deltas,ee)}}else g?.error&&I(g.error);let J=g?.health;!b&&J&&F(J)}catch(b){I(b instanceof Error?b.message:String(b))}finally{S(!1),se(!0)}},[e]),oe=Ve(!1);q(()=>{!M||oe.current||(oe.current=!0,e.call("getSyncHealth").then(p=>{p?.ok&&p.health&&F(p.health)}).catch(()=>{}),$())},[M,$,e]);let Ce=te(async(p,b)=>{try{let g=await e.call("resolveRemoteGone",{repo:p,action:b});if(!g?.ok){e.toast(`Couldn't ${b} ${p} \u2014 ${g?.error??"unknown error"}`,"error");return}F(J=>({...J,remoteGone:J.remoteGone.filter(ee=>ee.toLowerCase()!==p.toLowerCase()),keptGone:b==="keep"?[...J.keptGone,p].filter((ee,Ge,De)=>De.indexOf(ee)===Ge):J.keptGone})),$()}catch(g){e.toast(`Couldn't ${b} ${p} \u2014 ${g instanceof Error?g.message:String(g)}`,"error")}},[e,$]),le=te(async p=>{try{let b=await e.call("removePr",p);b?.ok&&Array.isArray(b.prs)&&(m(b.prs),e.cache.set(Z,b.prs),e.cache.set(xe,b.prs.length),e.cache.refreshBadge?.())}catch(b){e.toast(`Couldn't remove PR \u2014 ${b instanceof Error?b.message:String(b)}`,"error")}},[e]),fe=te(async p=>{let b=d.find(g=>g.url===p);if(b)try{let g;b.source==="auto"?g=await e.call("dismissPr",{url:p}):g=await e.call("removePr",p),g?.ok&&Array.isArray(g.prs)&&(m(g.prs),e.cache.set(Z,g.prs),e.cache.set(xe,g.prs.length),e.cache.refreshBadge?.())}catch(g){e.toast(`Couldn't dismiss PR \u2014 ${g instanceof Error?g.message:String(g)}`,"error")}},[e,d]),ze=te(async p=>{s(p);let b=await e.storage.get(La),g={...p};b&&(g.organizations=b.organizations,g.repositories=b.repositories,g.author=b.author,g.orgDiscovered=b.orgDiscovered,g.authorDiscovered=b.authorDiscovered),await e.storage.set(La,g),e.cache.set("settings",g),e.cache.refreshBadge?.()},[e]),pa=te(async()=>{let p=await e.storage.get(La);p?.repositories&&s(b=>b&&{...b,repositories:p.repositories})},[e]),ma=te(async(p,b)=>{try{let g=await e.call("assignProject",p,b);g?.ok&&Array.isArray(g.prs)&&(m(g.prs),e.cache.set(Z,g.prs))}catch(g){e.toast(`Couldn't assign project \u2014 ${g instanceof Error?g.message:String(g)}`,"error")}},[e]),Te=te((p,b)=>{E(p),C(b),e.storage.set(Bo,{field:p,dir:b})},[e]),he=te(p=>{V(p),e.storage.set(Fo,p)},[e]),oa=te(p=>{w(p),e.storage.set(Rt,p)},[e]),G=te(async(p,b)=>{if(p.length!==0)try{let g=await e.call("setPrsSeen",{urls:p,seen:b});g?.ok&&Array.isArray(g.prs)&&(m(g.prs),e.cache.set(Z,g.prs),e.cache.set("monitoredCount",g.prs.length),e.cache.refreshBadge?.())}catch(g){e.toast(`Couldn't update read state \u2014 ${g instanceof Error?g.message:String(g)}`,"error")}},[e]),Le=te(async(p,b)=>{if(p.length!==0)try{let g=await e.call("setPrsFavorite",{urls:p,favorite:b});g?.ok&&Array.isArray(g.prs)&&(m(g.prs),e.cache.set(Z,g.prs))}catch(g){e.toast(`Couldn't update favorites \u2014 ${g instanceof Error?g.message:String(g)}`,"error")}},[e]),ue=te(async p=>{if(p.length!==0)try{let b=await e.call("dismissPrs",{urls:p});b?.ok&&Array.isArray(b.prs)&&(m(b.prs),e.cache.set(Z,b.prs),e.cache.set(xe,b.prs.length),e.cache.refreshBadge?.())}catch(b){e.toast(`Couldn't dismiss PRs \u2014 ${b instanceof Error?b.message:String(b)}`,"error")}},[e]),be=Y(()=>{if(B.length===0)return d;let p=new Set(B.map(b=>b.toLowerCase()));return d.filter(b=>p.has(b.repo.toLowerCase()))},[d,B]),K=Y(()=>be.filter(p=>go.includes(p.status)).map(p=>p.url),[be]),re=Y(()=>Mo(ie),[ie]);return v?o?t("section",{className:"prm-panel",children:[t("header",{className:"prm-header",children:[t("div",{className:"prm-header-title",children:[a(ge,{size:16,className:"prm-header-icon","aria-hidden":!0}),t("div",{className:"prm-header-heading",children:[a("h2",{children:h==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:h==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),h==="prs"&&a("span",{className:"prm-count-pill",children:be.length})]}),t("div",{className:"prm-header-actions",children:[h==="prs"&&t(Q,{children:[t("button",{type:"button",className:"prm-btn",onClick:()=>u(!0),title:"Add a specific pull request to the monitored list",children:[a(Oa,{size:13})," ",a("span",{children:"Add PR"})]}),K.length>0&&t("button",{type:"button",className:"prm-btn",onClick:()=>void ue(K),title:`Sweep \u2014 dismiss the ${K.length} Merged/Closed PR(s) from the list`,children:[a(ce,{size:13})," ",a("span",{children:"Sweep"})]}),t("div",{className:"prm-split-btn",children:[t("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>void $(B),disabled:L,title:B.length>0?`Sync the ${B.length} selected repositor${B.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[L?a(z,{size:13,className:"prm-spin"}):a(ve,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:ye,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>k(p=>!p),disabled:L,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker",children:a(ga,{size:13})}),T&&a(Lo,{anchorRef:ye,host:e,selectedRepos:B,onClose:()=>k(!1),onToggleRepo:p=>ae(b=>b.includes(p)?b.filter(g=>g!==p):[...b,p]),onSelectAll:()=>ae([]),onSync:p=>void $(p)})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":h==="settings",onClick:()=>D(h==="settings"?"prs":"settings"),title:h==="settings"?"Back to pull requests":"Settings",children:h==="settings"?t(Q,{children:[a(Da,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):t(Q,{children:[a(Va,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]})]}),t("div",{className:`prm-content${h==="prs"&&X==="board"?" prm-content--board":""}`,children:[f&&a("div",{className:"prm-error",children:f}),h==="prs"&&re&&t("div",{className:`prm-sync-clue prm-sync-clue--${re.kind}`,role:"status",children:[re.kind==="disconnect"&&a(ja,{size:14,"aria-hidden":!0}),re.kind==="remote-gone"&&a(Xe,{size:14,"aria-hidden":!0}),re.kind==="outage"&&a(Ea,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:re.message}),re.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>D("settings"),children:"Open Settings"})]}),h==="prs"&&ie.remoteGone.map(p=>t("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${p} is gone`,children:[t("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:p})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),t("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>void Ce(p,"keep"),children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>void Ce(p,"remove"),children:"Remove"})]})]},p)),h==="prs"&&a(xo,{prs:be,host:e,projects:A,tisWarnHours:o.tisWarnHours,tisDangerHours:o.tisDangerHours,reviewWarnDays:o.reviewWarnDays,reviewDangerDays:o.reviewDangerDays,repositories:o.repositories,workItemLocatorBase:o.gusLocatorBaseUrl,sortField:U,sortDir:j,onSortChange:Te,hostScope:O,onHostScopeChange:he,awaitingFirstSync:!de,syncing:L,autoSyncEnabled:o.autoSyncEnabled??!0,onDismiss:p=>void fe(p),onProjectAssign:(p,b)=>void ma(p,b),onBulkSetSeen:(p,b)=>void G(p,b),onBulkDismiss:p=>void ue(p),onBulkSetFavorite:(p,b)=>void Le(p,b),viewMode:X,onViewModeChange:oa}),h==="settings"&&r&&a(Po,{settings:o,onSave:p=>void ze(p),onRepositoriesChanged:()=>void pa(),host:e})]}),x&&a(ho,{host:e,onClose:()=>u(!1),onPulled:p=>{m(p),e.cache.set(Z,p),e.cache.set(xe,p.length),e.cache.refreshBadge?.(),u(!1)}})]}):a("section",{className:"prm-panel",children:a(Xt,{onSave:async p=>{await ze(p)}})}):a("section",{className:"prm-panel",children:t("div",{className:"prm-loading",children:[a(z,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})})}function Ho(e){if(e.length!==0)return e.length===1?e[0]:e}var Mt=new Map,Tt=[],Eo;function Dt(e){Eo=e}function Ms(){return{get:e=>Mt.get(e),set:(e,o)=>{Mt.set(e,o)},delete:e=>{Mt.delete(e)},refreshBadge:()=>Eo?.()}}function Ts(e,o){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,o)}function Ds(e){try{let o=new URL(e);if(o.protocol!=="https:"&&o.protocol!=="http:"||typeof window>"u")return;window.open(o.href,"_blank","noopener,noreferrer")}catch{}}function Oo(e){return Tt=[],ra(e,"listProjects").then(o=>{Array.isArray(o)&&(Tt=o)}).catch(()=>{}),{call:(o,...s)=>ra(e,o,Ho(s)),storage:{get:o=>ra(e,"storageGet",o),set:async(o,s)=>{await ra(e,"storageSet",{key:o,value:s})}},cache:Ms(),toast:Ts,listProjects:()=>Tt,openExternal:Ds,pushInbox:async o=>o.projectId?await ra(e,"pushInbox",o):{id:""}}}var Nt=`/*
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
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0 2px 12px;
}

.prm-board-col {
  display: flex;
  flex-direction: column;
  width: 260px;
  min-width: 260px;
  max-height: 100%;
  background: color-mix(in srgb, var(--bg-elevated) 65%, transparent);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.prm-board-col-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 8px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border);
}

.prm-board-col-icon {
  flex-shrink: 0;
}

.prm-board-col-title {
  min-width: 0;
}

.prm-board-col-count {
  font-weight: 500;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.prm-board-col-unread {
  min-width: 16px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--accent-blue);
  color: white;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.prm-board-col-collapse {
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
  color: var(--text-muted);
  cursor: pointer;
}

.prm-board-col-collapse:hover {
  background: var(--bg-hover, color-mix(in srgb, var(--text) 8%, transparent));
  color: var(--text);
}

.prm-board-col--collapsed {
  width: 44px;
  min-width: 44px;
  max-width: 44px;
}

.prm-board-col--collapsed .prm-board-col-header {
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 12px;
  border-bottom: 0;
}

.prm-board-col--collapsed .prm-board-col-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 11px;
}

.prm-board-col--collapsed .prm-board-col-count,
.prm-board-col--collapsed .prm-board-col-unread {
  writing-mode: horizontal-tb;
}

.prm-board-col--collapsed .prm-board-col-collapse {
  margin-left: 0;
  margin-top: auto;
}

.prm-board-col--collapsed .prm-board-col-body {
  display: none;
}

.prm-board-col-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

.prm-board-col-empty {
  padding: 18px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}

.prm-board-col--conflict .prm-board-col-icon,
.prm-board-col--failed .prm-board-col-icon {
  color: var(--danger);
}

.prm-board-col--yellow .prm-board-col-icon,
.prm-board-col--pending .prm-board-col-icon {
  color: var(--accent-gold);
}

.prm-board-col--review-required .prm-board-col-icon,
.prm-board-col--integrating .prm-board-col-icon {
  color: var(--accent-blue);
}

.prm-board-col--green .prm-board-col-icon,
.prm-board-col--closed-merged .prm-board-col-icon {
  color: var(--success);
}

.prm-board-col--closed-abandoned .prm-board-col-icon {
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
  flex: 0 1 auto;
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

  .prm-board-col {
    width: 220px;
    min-width: 220px;
  }
}

/* \u2500\u2500 PR detail modal (opened from a board card) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.prm-modal--detail {
  width: min(720px, 94vw);
  max-height: 86vh;
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
}

.prm-detail-repo {
  font-weight: 500;
  color: var(--text-muted);
  font-size: 12px;
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
}

.prm-detail-section .prm-checks-list {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.prm-detail-section .prm-reviewers {
  margin-top: 0;
}

`;var Uo="pr-monitor",qo="prm-plugin-styles";function Bs(){if(typeof document>"u")return;let e=document.getElementById(qo);if(e instanceof HTMLStyleElement){e.textContent=Nt;return}let o=document.createElement("style");o.id=qo,o.textContent=Nt,document.head.appendChild(o)}Bs();var Fs={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function Hs(){let e=Y(()=>Oo(Uo),[]);return a("div",{style:Fs,children:a(At,{host:e})})}function Es(){let[e,o]=i(null);return q(()=>{let s=!0,r=async()=>{try{let d=await ra(Uo,"badge");if(!s)return;let m=typeof d?.count=="number"&&d.count>0?d.count:null;o(m)}catch{s&&o(null)}};r(),Dt(()=>{r()});let n=window.setInterval(()=>{r()},3e4);return()=>{s=!1,window.clearInterval(n),Dt(void 0)}},[]),e==null?null:a("span",{className:"nav-badge",children:e})}var yf=qt(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:Hs,experimental_sidebarAccessory:Es}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:o=>{o.toPluginPanel("main")}})});export{yf as default,Bs as injectStyles};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-react/dist/esm/defaultAttributes.mjs:
lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs:
lucide-react/dist/esm/context.mjs:
lucide-react/dist/esm/Icon.mjs:
lucide-react/dist/esm/createLucideIcon.mjs:
lucide-react/dist/esm/icons/arrow-down.mjs:
lucide-react/dist/esm/icons/arrow-left.mjs:
lucide-react/dist/esm/icons/arrow-up.mjs:
lucide-react/dist/esm/icons/bell-off.mjs:
lucide-react/dist/esm/icons/bell.mjs:
lucide-react/dist/esm/icons/book-marked.mjs:
lucide-react/dist/esm/icons/building-2.mjs:
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
lucide-react/dist/esm/icons/trash-2.mjs:
lucide-react/dist/esm/icons/triangle-alert.mjs:
lucide-react/dist/esm/icons/users.mjs:
lucide-react/dist/esm/icons/wifi-off.mjs:
lucide-react/dist/esm/icons/wifi.mjs:
lucide-react/dist/esm/icons/wrench.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.31.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
