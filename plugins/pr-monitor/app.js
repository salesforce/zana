var W=globalThis.__ZCC_HOST_REACT__;var js=W.Children,Ks=W.Component,Xs=W.Fragment,Zs=W.StrictMode,Js=W.Suspense,Ys=W.cloneElement,Ot=W.createContext,ya=W.createElement,Qs=W.createRef,Ya=W.forwardRef,el=W.isValidElement,al=W.lazy,tl=W.memo,ol=W.startTransition,Z=W.useCallback,qt=W.useContext,rl=W.useDebugValue,sl=W.useDeferredValue,q=W.useEffect,ll=W.useId,nl=W.useImperativeHandle,il=W.useInsertionEffect,dl=W.useLayoutEffect,Q=W.useMemo,ul=W.useReducer,ke=W.useRef,u=W.useState,cl=W.useSyncExternalStore,fl=W.useTransition,pl=W.version;function jo(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}async function ra(e,t,s){return jo().callRpc(e,t,s)}function Ut(e){return{__zccPluginApp:!0,setup:e}}var Qa=(...e)=>e.filter((t,s,r)=>!!t&&t.trim()!==""&&r.indexOf(t)===s).join(" ").trim();var zt=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();var _t=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(t,s,r)=>r?r.toUpperCase():s.toLowerCase());var xt=e=>{let t=_t(e);return t.charAt(0).toUpperCase()+t.slice(1)};var et={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};var Gt=e=>{for(let t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};var Ko=Ot({});var Vt=()=>qt(Ko);var Wt=Ya(({color:e,size:t,strokeWidth:s,absoluteStrokeWidth:r,className:n="",children:d,iconNode:i,...c},I)=>{let{size:f=24,strokeWidth:C=2,absoluteStrokeWidth:L=!1,color:y="currentColor",className:v=""}=Vt()??{},P=r??L?Number(s??C)*24/Number(t??f):s??C;return ya("svg",{ref:I,...et,width:t??f??et.width,height:t??f??et.height,stroke:e??y,strokeWidth:P,className:Qa("lucide",v,n),...!d&&!Gt(c)&&{"aria-hidden":"true"},...c},[...i.map(([h,m])=>ya(h,m)),...Array.isArray(d)?d:[d]])});var p=(e,t)=>{let s=Ya(({className:r,...n},d)=>ya(Wt,{ref:d,iconNode:t,className:Qa(`lucide-${zt(xt(e))}`,`lucide-${e}`,r),...n}));return s.displayName=xt(e),s};var Xo=[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]],Ma=p("arrow-down",Xo);var Zo=[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]],Ta=p("arrow-left",Zo);var Jo=[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]],Da=p("arrow-up",Jo);var Yo=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]],Je=p("bell-off",Yo);var Qo=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]],Pe=p("bell",Qo);var er=[["path",{d:"M10 2v8l3-3 3 3V2",key:"sqw3rj"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",key:"k3hazp"}]],Na=p("book-marked",er);var ar=[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],Ba=p("building-2",ar);var tr=[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]],Fe=p("check",tr);var or=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],ga=p("chevron-down",or);var rr=[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]],Ye=p("chevron-right",rr);var sr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],Re=p("circle-alert",sr);var lr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],me=p("circle-check",lr);var nr=[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]],Fa=p("circle-dashed",nr);var ir=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],Ae=p("circle-question-mark",ir);var dr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],Se=p("circle-x",dr);var ur=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]],Me=p("clock",ur);var cr=[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],Ea=p("cloud-off",cr);var fr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],sa=p("columns-3",fr);var pr=[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]],Ha=p("download",pr);var mr=[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]],Ee=p("external-link",mr);var gr=[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],Oa=p("eye-off",gr);var xr=[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],qa=p("eye",xr);var hr=[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]],Ua=p("folder-git-2",hr);var Lr=[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]],wa=p("folder-search",Lr);var br=[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]],He=p("git-branch",br);var Ir=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]],Qe=p("git-merge",Ir);var Cr=[["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 9v12",key:"1sc30k"}],["path",{d:"m21 3-6 6",key:"16nqsk"}],["path",{d:"m21 9-6-6",key:"9j17rh"}],["path",{d:"M18 11.5V15",key:"65xf6f"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}]],ea=p("git-pull-request-closed",Cr);var Sr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],We=p("git-pull-request-draft",Sr);var yr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],ge=p("git-pull-request",yr);var wr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]],za=p("globe",wr);var vr=[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]],_a=p("layout-list",vr);var kr=[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]],Oe=p("link-2",kr);var Pr=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],_=p("loader-circle",Pr);var Rr=[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]],$e=p("mail-open",Rr);var Ar=[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]],aa=p("mail",Ar);var Mr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],la=p("panel-left-close",Mr);var Tr=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],je=p("pen",Tr);var Dr=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]],va=p("plus",Dr);var Nr=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]],ve=p("refresh-cw",Nr);var Br=[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]],ka=p("search",Br);var Fr=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],Ga=p("settings",Fr);var Er=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]],Va=p("shield-alert",Er);var Hr=[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],Te=p("sparkles",Hr);var Or=[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],na=p("square-check-big",Or);var qr=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]],qe=p("star",qr);var Ur=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],ce=p("trash-2",Ur);var zr=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],Ke=p("triangle-alert",zr);var _r=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]],Wa=p("users",_r);var Gr=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],$a=p("wifi-off",Gr);var Vr=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]],xa=p("wifi",Vr);var Wr=[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]],ja=p("wrench",Wr);var $r=[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]],Ie=p("x",$r);var Xa={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},at="standard",Ka={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},tt="standard";function jr(e){let t=e?.buildTisPreset??e?.tisPreset;return t&&t in Xa?t:at}function $t(e,t){let s=(e??"").toLowerCase();return s?(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function Za(e,t,s,r){let n=$t(e,t);if(n){let d=Xa[jr(n)];return{warnHours:d.warnHours,dangerHours:d.dangerHours}}return{warnHours:s,dangerHours:r}}function ht(e,t,s,r){let n=$t(e,t);if(n){let d=n.reviewTisPreset&&n.reviewTisPreset in Ka?n.reviewTisPreset:tt,i=Ka[d];return{warnDays:i.warnDays,dangerDays:i.dangerDays}}return{warnDays:s,dangerDays:r}}var jt={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},Lt="organizations",ha={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:Lt,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},xe="monitoredCount",J="monitoredPrs",La="settings",Ja="prefetch:orgs",bt="prefetch:repos",It="prefetch:author",Kr=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function Ct(e){let t=Kr.exec(e);if(!t)throw new Error(`Not a GitHub PR URL: ${e}`);return t[1]}var Xr={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function St(e){return Xr[e]}var Zr={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function yt(e){return Zr[e]}var Jr=/\bW-\d{8}\b/i;function ia(e,t,s){for(let r of[e,t,s]){if(typeof r!="string"||!r)continue;let n=Jr.exec(r);if(n)return n[0].toUpperCase()}}function ot(e,t){if(!e||!t||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(t)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${t.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var Kt=globalThis.__ZCC_HOST_REACT__,ee=Kt.Fragment;function a(e,t,s){return Kt.createElement(e,s===void 0?t:{...t,key:s})}var o=a;function Xt({onSave:e}){let[t,s]=u(!1),r=async()=>{s(!0);try{await e({...ha})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:o("div",{className:"prm-setup",children:[a(ge,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void r(),disabled:t,children:t?"Saving\u2026":"Get started"})})]})})}function Ue(e){let t=Date.now(),s=Math.max(0,t-e),r=Math.floor(s/1e3);if(r<60)return"just now";let n=Math.floor(r/60);if(n<60)return`${n}m ago`;let d=Math.floor(n/60);if(d<24)return`${d}h ago`;let i=Math.floor(d/24);if(i===1)return"yesterday";if(i<30)return`${i}d ago`;let c=Math.floor(i/30);return c<12?`${c}mo ago`:`${Math.floor(c/12)}y ago`}var Yr={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function Xe(e){return Yr[e]}function Zt(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function rt(e){let t=0,s=0,r=0;for(let n of e){let d=n.state.toUpperCase();d==="SUCCESS"||d==="PASS"||d==="PASSED"?t++:d==="FAILURE"||d==="FAILED"||d==="ERROR"||d==="CANCELLED"?s++:r++}return{pass:t,fail:s,pending:r}}var Qr={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function Jt(e){return Qr[e.toUpperCase()]??"pending"}function st(e){return{label:Xe(e),className:`prm-status-pill--${e}`}}var ze=4,_e=6,ba=3,Ia=5;function da(e){if(!e)return"";let t=Math.max(0,Date.now()-e),s=Math.floor(t/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function ua(e,t){let s=t==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function ca(e){let t=e.name||e.login,s=t.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():t.slice(0,2).toUpperCase()}var es=new Set(["fail","failure"]),as=new Set(["pending","in_progress","queued"]);function ts(e){return(e??"").toLowerCase().trim()||"pending"}function os(e,t){if(!t||t.length===0)return!1;let s=(e??"").toLowerCase();return t.some(r=>{let n=(r??"").toLowerCase();return n.length>0&&s.includes(n)})}function Pa(e,t={}){if(!e||e.length===0)return!1;let s=t.ignoredFailingChecks;for(let r of e){let n=ts(r.bucket||r.state);if(as.has(n)||es.has(n)&&!os(r.name,s))return!1}return!0}function Ra(e){let{status:t,buildHappy:s,reviewApproved:r,sfciGated:n,hasSfciJob:d,elapsedHours:i,warnHours:c,dangerHours:I}=e;if(t==="integrating"||t==="closed-merged"||t==="closed-abandoned")return"done";let f=n&&!d;return s&&r&&t==="yellow"?f?"blocked":i>=I?"merge-stall":i>=c?"warn":"ok":s?"done":f?"blocked":i>=I?"danger":i>=c?"warn":"ok"}function lt(e){let{reviewApproved:t,merged:s,elapsedDays:r,warnDays:n,dangerDays:d}=e;return t&&!s?"done":r>=d?"danger":r>=n?"warn":"ok"}function rs(e){if(typeof document>"u")return!1;let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.top="-9999px",t.setAttribute("readonly",""),document.body.appendChild(t);try{return t.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(t)}}async function Aa(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return rs(e)}var ss=Symbol.for("react.portal");function fa(e,t){return{$$typeof:ss,key:null,children:e,containerInfo:t,implementation:null}}var nt=4,it=8,Yt=120,ls=320,ns=280;function is(e,t){let s=t.innerHeight-e.bottom-nt-it,r=e.top-nt-it,n=s<Yt&&r>s,d=Math.max(Yt,Math.min(ls,n?r:s)),i=Math.max(it,Math.min(e.left,t.innerWidth-ns-it));return n?{left:i,bottom:t.innerHeight-e.top+nt,maxHeight:d}:{left:i,top:e.bottom+nt,maxHeight:d}}function dt({projectId:e,projects:t,onAssign:s}){let r=ke(null),[n,d]=u(!1),[i,c]=u(null),I=t.find(L=>L.id===e),f=!!I;q(()=>{if(!n)return;let L=r.current;L&&c(is(L.getBoundingClientRect(),window))},[n]),q(()=>{if(!n)return;let L=y=>{y.key==="Escape"&&d(!1)};return window.addEventListener("keydown",L),()=>window.removeEventListener("keydown",L)},[n]);let C=f?`Associated with ${I.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return o(ee,{children:[o("button",{ref:r,type:"button",className:`prm-project-row ${f?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:C,"aria-label":C,onClick:L=>{L.stopPropagation(),d(y=>!y)},children:[a(Ua,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:f?I.name:"Not associated with a project"})]}),n&&i&&typeof document<"u"&&fa(o(ee,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:L=>{L.stopPropagation(),d(!1)}}),o("div",{className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...i},role:"menu",children:[t.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),f&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:L=>{L.stopPropagation(),s(null),d(!1)},children:"Clear association"}),t.map(L=>a("button",{type:"button",className:`prm-project-menu-item ${L.id===e?"is-active":""}`,role:"menuitem",onClick:y=>{y.stopPropagation(),s(L.id),d(!1)},children:L.name},L.id))]})]}),document.body)]})}function ut({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(t=>{let s=Jt(t.state);return o("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:t.name}),t.bucket&&a("span",{className:"prm-check-bucket",children:t.bucket}),a("span",{className:"prm-check-state",title:t.state,children:t.state.toLowerCase()})]},`${t.bucket??""}/${t.name}`)})})}function Qt(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}var ds=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],us=["seen","favorite","mute","dismiss"];function eo({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:d,reviewDangerDays:i,sfciGated:c=!1,ignoredFailingChecks:I,workItemLocatorBase:f,selected:C,onToggleSelect:L,onDismiss:y,onProjectAssign:v}){let[P,h]=u(!1),[m,M]=u(!1),k=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),N=e.workItem??ia(e.title,e.headRefName,e.body),B=ot(N,f),T=st(e.status),te=e.status==="closed-merged"||e.status==="closed-abandoned",U=!!e.muted,H=!!e.favorite,j=!!e.syncError,S=e.checks??[],O=rt(S),V=e.reviewDecision==="APPROVED",K=e.buildHappy??Pa(S,{ignoredFailingChecks:I}),w=Ra({status:e.status,buildHappy:K,reviewApproved:V,sfciGated:c,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??ze,dangerHours:n??_e}),de=da(e.lastStatusChange),se=w==="merge-stall"||w==="danger"?"danger":w==="warn"?"warn":"ok",ie=w==="done"?"Build \u2713":w==="merge-stall"?"Merge stalled":ua(se,"build"),F=w==="done"?"done":se,ye=!e.isDraft&&!te,A=e.status==="closed-merged",E=lt({reviewApproved:V,merged:A,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:d??ba,dangerDays:i??Ia}),D=da(e.reviewClockStartedAt),$=E==="danger"?"danger":E==="warn"?"warn":"ok",oe=E==="done"?"Review \u2713":ua($,"review"),Ce=E==="done"?"done":$,le=e.reviewers??[],fe={"changes-requested":le.filter(l=>l.state==="changes-requested"),"review-requested":le.filter(l=>l.state==="review-requested"),approved:le.filter(l=>l.state==="approved")},Ge=le.length>0,pa=()=>{Qt(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ma=e.isDraft?We:e.status==="closed-merged"?Qe:e.status==="closed-abandoned"?ea:ge,De=l=>{l?.ok&&l.prs&&(t.cache.set(J,l.prs),t.cache.set(xe,l.prs.length),t.cache.refreshBadge())},he=async()=>{if(k){let l=await t.call("markPrAsSeen",{url:e.url});De(l)}},oa=async()=>{let l=k?"markPrAsSeen":"markPrAsUnseen",R=await t.call(l,{url:e.url});De(R)},G=async()=>{let l=await t.call("setPrMuted",{url:e.url,muted:!U});De(l)},Le=async()=>{let l=await t.call("setPrFavorite",{url:e.url,favorite:!H});De(l)},ue=async l=>{l.stopPropagation(),M(!0);try{let R=await t.call("retryPr",{url:e.url});De(R)}finally{M(!1)}},be=async(l,R)=>{await Aa(l)?t.toast(`${R} copied`,"info"):t.toast(`Failed to copy ${R}`,"error")},X=S.length>0,re=X?` \u2014 click to ${P?"hide":"show"} checks`:"",g=l=>{l.stopPropagation(),h(R=>!R)},b=l=>{(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),g(l))},x=l=>X?{role:"button",tabIndex:0,"aria-expanded":P,title:l,"data-tip":l,onClick:g,onKeyDown:b}:{},Y=X?" prm-tip prm-checks-trigger":"",ae=`${T.label} \u2014 overall PR status${re}`,Ve=`${O.pass} passing, ${O.fail} failing, ${O.pending} running`,Ne=w==="done"?"Build passing":w==="merge-stall"?"Merge stalled":w==="blocked"?"Build waiting (SFCI job not yet created)":ie||"Build running",Be=`${Ne} \xB7 ${de} in build phase \xB7 ${Ve}${re}`,Ca=E==="done"?"Review approved":oe||"Awaiting review",we=`${Ca} \xB7 ${D} in review${re}`,Sa=`${Ve}${re}`,Ft={seen:{Icon:k?$e:aa,label:k?"Mark read":"Mark unread",title:k?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:qe,label:H?"Unfavorite":"Favorite",title:H?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:H},mute:{Icon:U?Je:Pe,label:U?"Unmute":"Mute",title:U?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:ce,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},gt=l=>{l==="seen"?oa():l==="favorite"?Le():l==="mute"?G():y(e.url)};return o("div",{className:`prm-tile ${k?"prm-tile--unread":""} ${te?"prm-tile--closed":""} ${j?"prm-tile--stale":""} ${H?"prm-tile--favorite":""} ${C?"prm-tile--selected":""}`,onClick:he,role:"button",tabIndex:0,onKeyDown:l=>{(l.key==="Enter"||l.key===" ")&&(l.preventDefault(),he())},children:[o("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:C,title:C?"Deselect this PR":"Select this PR","aria-label":C?"Deselect this PR":"Select this PR",onClick:l=>l.stopPropagation(),onChange:l=>{l.stopPropagation(),L(e.url)}}),a(ma,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),o("span",{className:"prm-tile-title",children:[N&&o("span",{className:"prm-tile-workitem-inline",children:["@",N,": "]}),e.title.replace(new RegExp(`(?:^|@)${N}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${T.className} prm-tip${Y}`,title:ae,"data-tip":ae,...x(ae),children:T.label}),X?o("span",{className:`prm-tis prm-tis--${F} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":P,title:Be,"data-tip":Be,"aria-label":`${Ne}, ${de} in build phase`,onClick:g,onKeyDown:b,children:[de,ie&&o("span",{className:"prm-tis-cue",children:[" ",ie]})]}):o("span",{className:`prm-tis prm-tis--${F} prm-tip`,title:Be,"data-tip":Be,"aria-label":`${Ne}, ${de} in build phase`,children:[de,ie&&o("span",{className:"prm-tis-cue",children:[" ",ie]})]}),ye&&(D||oe)&&(X?o("span",{className:`prm-tis prm-tis--review prm-tis--${Ce} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":P,title:we,"data-tip":we,"aria-label":`${Ca}, ${D} in review`,onClick:g,onKeyDown:b,children:[D,oe&&o("span",{className:"prm-tis-cue",children:[" ",oe]})]}):o("span",{className:`prm-tis prm-tis--review prm-tis--${Ce} prm-tip`,title:we,"data-tip":we,"aria-label":`${Ca}, ${D} in review`,children:[D,oe&&o("span",{className:"prm-tis-cue",children:[" ",oe]})]})),S.length>0&&o("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${O.pass} passed, ${O.fail} failed, ${O.pending} running`,...x(Sa),children:[O.pass>0&&o("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(Fe,{size:9})," ",O.pass]}),O.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(Ie,{size:9})," ",O.fail]}),O.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(Me,{size:9})," ",O.pending]})]}),U&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(Je,{size:11})}),j&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(Re,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:m,onClick:l=>void ue(l),children:a(ve,{size:10,className:m?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:us.map(l=>{let R=Ft[l],z=R.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${R.danger?" prm-tile-icon-btn--danger":""}${R.active?" prm-tile-icon-btn--active":""}`,title:R.title,"data-tip":R.label,"aria-label":R.label,"aria-pressed":R.active,onClick:ne=>{ne.stopPropagation(),gt(l)},children:a(z,{size:13,...R.active?{fill:"currentColor"}:{}})},l)})})]}),o("div",{className:"prm-tile-line2",children:[N&&(B?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${N}`,onClick:l=>{l.stopPropagation(),Qt(B)&&t.openExternal(B)},children:N}):a("span",{className:"prm-workitem-chip",children:N})),a("span",{className:"prm-tile-repo",children:e.repo}),o("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:l=>{l.stopPropagation(),pa()},children:a(Ee,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:l=>{l.stopPropagation(),be(e.url,"PR link")},children:a(Oe,{size:10})})]}),e.author&&o("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ca(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-tile-line3",children:[a(He,{size:10,className:"prm-branch-icon","aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:l=>{l.stopPropagation(),be(e.headRefName,"Branch name")},children:a(Oe,{size:10})})]}),Ge&&a("div",{className:"prm-reviewers",children:ds.map(({state:l,label:R,className:z})=>{let ne=fe[l];return ne.length===0?null:o("span",{className:`prm-reviewers-group ${z}`,title:R,children:[a("span",{className:"prm-reviewers-label",children:R}),ne.map(pe=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:pe.name||pe.login,"aria-label":`${R}: ${pe.name||pe.login}`,children:ca(pe)},pe.login))]},l)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(dt,{projectId:e.projectId,projects:s,onAssign:l=>v(e.url,l)}),P&&S.length>0&&a("div",{className:"prm-tile-checks",onClick:l=>l.stopPropagation(),children:a(ut,{checks:S})})]})}function ao({anchorRef:e,hosts:t,selectedHosts:s,onClose:r,onToggleHost:n,onSelectAll:d,shortHost:i}){let[c,I]=u(null);if(q(()=>{let C=e.current;if(!C)return;let L=C.getBoundingClientRect();I({top:L.bottom+4,left:L.left})},[e]),q(()=>{let C=L=>{L.key==="Escape"&&r()};return window.addEventListener("keydown",C),()=>window.removeEventListener("keydown",C)},[r]),!c||typeof document>"u")return null;let f=s.length===0;return fa(o(ee,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:C=>{C.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-host-filter",style:{position:"fixed",top:c.top,left:c.left},role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),o("button",{type:"button",className:`prm-project-menu-item ${f?"is-active":""}`,role:"menuitemcheckbox","aria-checked":f,onClick:C=>{C.stopPropagation(),d()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:f&&a(Fe,{size:12})}),"All hosts"]}),t.map(C=>{let L=s.includes(C);return o("button",{type:"button",className:`prm-project-menu-item ${L?"is-active":""}`,role:"menuitemcheckbox","aria-checked":L,onClick:y=>{y.stopPropagation(),n(C)},title:`Filter to ${C}`,children:[a("span",{className:"prm-sync-filter-check",children:L&&a(Fe,{size:12})}),i(C)]},C)})]})]}),document.body)}var cs='button, a, input, textarea, select, [contenteditable="true"]';function to(e){return!e||typeof e.closest!="function"?!1:e.closest(cs)!==null}function oo(e,t,s){return{left:e.left-(t-e.x),top:e.top-(s-e.y)}}function wt(){let e=ke(null),[t,s]=u(!1),r=Z(i=>{let c=e.current;!c||c.id!==i.pointerId||(e.current=null,s(!1),i.currentTarget.hasPointerCapture(i.pointerId)&&i.currentTarget.releasePointerCapture(i.pointerId))},[]),n=Z(i=>{i.button!==0||to(i.target)||(e.current={id:i.pointerId,x:i.clientX,y:i.clientY,left:i.currentTarget.scrollLeft,top:i.currentTarget.scrollTop},i.currentTarget.setPointerCapture(i.pointerId),s(!0))},[]),d=Z(i=>{let c=e.current;if(!c||c.id!==i.pointerId)return;let I=oo(c,i.clientX,i.clientY);i.currentTarget.scrollLeft=I.left,i.currentTarget.scrollTop=I.top},[]);return{isPanning:t,canvasPanProps:{onPointerDown:n,onPointerMove:d,onPointerUp:r,onPointerCancel:r}}}var vt=`.zcc-kanban {
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
  background: var(--bg-panel, var(--zcc-surface, #10151c));
  border: 1px solid var(--border, var(--zcc-border, #1f2731));
  border-radius: 10px;
  overflow: visible;
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
  background: var(--bg-panel, var(--zcc-surface, #10151c));
  border-bottom: 1px solid var(--border, var(--zcc-border, #1f2731));
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
  background: var(--bg-elevated, var(--zcc-surface-raised, #161c25));
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
  background: var(--bg-hover, var(--zcc-surface-hover, #1a212c));
  color: var(--text-primary, var(--zcc-foreground, #e6edf3));
}

.zcc-kanban-col-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: visible;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.zcc-kanban-col.is-collapsed .zcc-kanban-col-body {
  display: none;
}

.zcc-kanban-col-empty {
  min-height: 24px;
}
`;function ps(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function ro({children:e,className:t="",label:s,columnWidth:r}){let{isPanning:n,canvasPanProps:d}=wt();return a("div",{role:"list","aria-label":s,className:["zcc-kanban",n?"is-panning":"",t].filter(Boolean).join(" "),style:ps(r),...d,children:e})}function so({children:e,className:t="",columnId:s,label:r,count:n,icon:d,badge:i,collapsed:c=!1,onToggleCollapse:I}){let f=c?`Expand ${r}`:`Collapse ${r}`;return o("section",{role:"listitem",className:["zcc-kanban-col",c?"is-collapsed":"",t].filter(Boolean).join(" "),"aria-label":`${r} (${n})`,"data-kanban-column":s,"data-board-column":s,"data-collapsed":c?"true":"false",children:[o("header",{className:"zcc-kanban-col-header",children:[d?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:d}):null,a("span",{className:"zcc-kanban-col-title",children:r}),a("span",{className:"zcc-kanban-col-count",children:n}),i,I?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:f,"aria-label":f,"aria-expanded":!c,onClick:()=>I(s),children:c?a(Ye,{size:13}):a(la,{size:13})}):null]}),c?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}var kt=["conflict","failed","yellow","review-required","pending","integrating","green"],lo=["closed-merged","closed-abandoned"],no={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function Pt(e){return e==="list"||e==="board"}function ms(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function ct(e){let t=ms();for(let s of e)t[s.status].push(s);return t}function io(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var uo=[...kt,...lo];function co(e){return typeof e=="string"&&uo.includes(e)}function fo(e,t={}){let s=io(e);return t.showEmpty?[...kt,...lo.filter(r=>s[r]>0)]:uo.filter(r=>s[r]>0)}function po(e){let t=io(e);return kt.filter(s=>t[s]===0).length}function mo(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function gs(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function xs(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function go({pr:e,host:t,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:n,selected:d,selectionActive:i=!1,selectMode:c=!1,onToggleSelect:I,onDismiss:f,onOpen:C}){let[L,y]=u(!1),v=xs(e),P=e.status==="closed-merged"||e.status==="closed-abandoned",h=!!e.favorite,m=!!e.syncError,M=e.workItem??ia(e.title,e.headRefName,e.body),k=M?e.title.replace(new RegExp(`(?:^|@)${M}[:\\s]*`,"i"),""):e.title,N=e.checks??[],B=rt(N),T=e.updatedAt||e.lastChecked||e.lastStatusChange,te=e.buildHappy??Pa(N,{ignoredFailingChecks:n}),U=Ra({status:e.status,buildHappy:te,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??ze,dangerHours:r??_e}),H=U==="merge-stall"?"Merge stalled":U==="warn"||U==="danger"?ua(U,"build"):"",j=U==="merge-stall"||U==="danger"?"danger":U==="warn"?"warn":"",S=d||c||i,O=F=>{F?.ok&&F.prs&&(t.cache.set(J,F.prs),t.cache.set(xe,F.prs.length),t.cache.refreshBadge())},V=async()=>{if(!v)return;let F=await t.call("markPrAsSeen",{url:e.url});O(F)},K=async()=>{let F=await t.call("setPrFavorite",{url:e.url,favorite:!h});O(F)},w=()=>{gs(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},de=async()=>{y(!0);try{let F=await t.call("retryPr",{url:e.url});O(F)}finally{y(!1)}},se=()=>{C(e.url),V()},ie=F=>{if(F.metaKey||F.ctrlKey||c){I(e.url);return}se()};return o("article",{className:["prm-board-card",v?"prm-board-card--unread":"",P?"prm-board-card--closed":"",h?"prm-board-card--favorite":"",d?"prm-board-card--selected":"",m?"prm-board-card--stale":"",S?"prm-board-card--selectable":"",c?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:ie,onKeyDown:F=>{(F.key==="Enter"||F.key===" ")&&(F.preventDefault(),c?I(e.url):se())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[o("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:d,title:d?"Deselect this PR":"Select this PR","aria-label":d?"Deselect this PR":"Select this PR",onClick:F=>F.stopPropagation(),onChange:F=>{F.stopPropagation(),I(e.url)}}),o("span",{className:"prm-board-card-id",children:[o("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",children:mo(e.repo)})]}),M&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:M}),o("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${h?" prm-tile-icon-btn--active":""}`,title:h?"Unfavorite":"Favorite","data-tip":h?"Unfavorite":"Favorite","aria-label":h?"Unfavorite":"Favorite","aria-pressed":h,onClick:F=>{F.stopPropagation(),K()},children:a(qe,{size:12,...h?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:F=>{F.stopPropagation(),w()},children:a(Ee,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:F=>{F.stopPropagation(),f(e.url)},children:a(ce,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:k}),o("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:ca(e.author)}),H?o("span",{className:`prm-tis prm-tis--${j} prm-board-card-stall`,children:[da(e.lastStatusChange)," ",H]}):T>0&&a("span",{className:"prm-board-card-time",children:Ue(T)}),B.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${B.fail} checks failing`,children:[a(Ie,{size:9})," ",B.fail]}),B.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${B.pending} checks running`,children:[a(Me,{size:9})," ",B.pending]}),e.isDraft&&o("span",{className:"prm-draft-pill prm-board-card-draft",children:[a(We,{size:10,"aria-hidden":!0})," Draft"]}),m&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(Re,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:L,onClick:F=>{F.stopPropagation(),de()},children:a(ve,{size:10,className:L?"prm-spin":""})})]})]})]})}var hs={conflict:Va,failed:Se,yellow:Ke,"review-required":qa,pending:Fa,integrating:_,green:me,"closed-merged":Qe,"closed-abandoned":ea};function xo({prs:e,host:t,tisWarnHours:s,tisDangerHours:r,repositories:n,selected:d,selectMode:i=!1,showEmpty:c=!1,collapsed:I,onToggleCollapse:f,onToggleSelect:C,onDismiss:L,onOpen:y}){let v=Q(()=>ct(e),[e]),P=Q(()=>fo(v,{showEmpty:c}),[v,c]),h=d.size>0||i;return a(ro,{label:"Pull requests by status",columnWidth:260,className:"prm-board",children:P.map(m=>{let M=v[m],k=hs[m],N=I.has(m),B=M.filter(T=>T.lastSeenAt===0||T.lastStatusChange>(T.lastSeenAt??T.addedAt)).length;return a(so,{columnId:m,className:`prm-board-col--${m}`,label:no[m],count:M.length,icon:a(k,{size:14,"aria-hidden":!0}),badge:B>0?a("span",{className:"zcc-kanban-col-badge",title:`${B} unread`,children:B}):null,collapsed:N,onToggleCollapse:T=>f(T),children:M.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):M.map(T=>{let te=Za(T.repo,n,s??ze,r??_e),U=(n??[]).find(H=>`${H.owner}/${H.repo}`.toLowerCase()===T.repo.toLowerCase());return a(go,{pr:T,host:t,tisWarnHours:te.warnHours,tisDangerHours:te.dangerHours,ignoredFailingChecks:U?.ignoredFailingChecks,selected:d.has(T.url),selectionActive:h,selectMode:i,onToggleSelect:C,onDismiss:L,onOpen:y},T.url)})},m)})})}var Ls=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function ho(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function bs(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function Lo({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:d,reviewDangerDays:i,sfciGated:c=!1,ignoredFailingChecks:I,workItemLocatorBase:f,onClose:C,onDismiss:L,onProjectAssign:y}){let[v,P]=u(!1);q(()=>{let G=Le=>{Le.key==="Escape"&&C()};return window.addEventListener("keydown",G),()=>window.removeEventListener("keydown",G)},[C]);let h=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),m=e.status==="closed-merged"||e.status==="closed-abandoned",M=!!e.muted,k=!!e.favorite,N=!!e.syncError,B=e.workItem??ia(e.title,e.headRefName,e.body),T=ot(B,f),te=B?e.title.replace(new RegExp(`(?:^|@)${B}[:\\s]*`,"i"),""):e.title,U=st(e.status),H=e.checks??[],j=e.reviewers??[],S={"changes-requested":j.filter(G=>G.state==="changes-requested"),"review-requested":j.filter(G=>G.state==="review-requested"),approved:j.filter(G=>G.state==="approved")},O=bs(e),V=e.reviewDecision==="APPROVED",K=e.buildHappy??Pa(H,{ignoredFailingChecks:I}),w=Ra({status:e.status,buildHappy:K,reviewApproved:V,sfciGated:c,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??ze,dangerHours:n??_e}),de=da(e.lastStatusChange),se=w==="merge-stall"||w==="danger"?"danger":w==="warn"?"warn":"ok",ie=w==="done"?"Build \u2713":w==="merge-stall"?"Merge stalled":ua(se,"build"),F=w==="done"?"done":se,ye=!e.isDraft&&!m,A=lt({reviewApproved:V,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:d??ba,dangerDays:i??Ia}),E=da(e.reviewClockStartedAt),D=A==="danger"?"danger":A==="warn"?"warn":"ok",$=A==="done"?"Review \u2713":ua(D,"review"),oe=A==="done"?"done":D,Ce=e.isDraft?We:e.status==="closed-merged"?Qe:e.status==="closed-abandoned"?ea:ge,le=G=>{G?.ok&&G.prs&&(t.cache.set(J,G.prs),t.cache.set(xe,G.prs.length),t.cache.refreshBadge())},fe=()=>{ho(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},Ge=async(G,Le)=>{await Aa(G)?t.toast(`${Le} copied`,"info"):t.toast(`Failed to copy ${Le}`,"error")},pa=async()=>{let G=h?"markPrAsSeen":"markPrAsUnseen";le(await t.call(G,{url:e.url}))},ma=async()=>{le(await t.call("setPrMuted",{url:e.url,muted:!M}))},De=async()=>{le(await t.call("setPrFavorite",{url:e.url,favorite:!k}))},he=async()=>{P(!0);try{le(await t.call("retryPr",{url:e.url}))}finally{P(!1)}},oa=a("div",{className:"modal-backdrop",onClick:C,"data-testid":"prm-detail-backdrop",children:o("div",{className:"modal prm-modal prm-modal--detail",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-detail-title",onClick:G=>G.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:"prm-detail-title",children:[a(Ce,{size:14,"aria-hidden":!0}),o("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:C,title:"Close",children:a(Ie,{size:14})})]}),o("div",{className:"prm-modal-body prm-detail-body",children:[o("div",{className:"prm-detail-heading",children:[B&&(T?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${B}`,onClick:()=>{ho(T)&&t.openExternal(T)},children:B}):a("span",{className:"prm-workitem-chip",children:B})),a("h4",{className:"prm-detail-pr-title",children:te})]}),o("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${U.className}`,children:U.label}),e.isDraft&&o("span",{className:"prm-draft-pill",children:[a(We,{size:10,"aria-hidden":!0})," Draft"]}),M&&o("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(Je,{size:11,"aria-hidden":!0})," Muted"]}),de&&o("span",{className:`prm-tis prm-tis--${F}`,children:[de,ie&&o("span",{className:"prm-tis-cue",children:[" ",ie]})]}),ye&&(E||$)&&o("span",{className:`prm-tis prm-tis--review prm-tis--${oe}`,children:[E,$&&o("span",{className:"prm-tis-cue",children:[" ",$]})]})]}),O&&a("div",{className:"prm-detail-hint",children:O}),o("dl",{className:"prm-detail-facts",children:[e.author&&o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),o("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ca(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:Ue(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:Ue(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:Ue(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Branches"}),o("div",{className:"prm-detail-branch",children:[a(He,{size:12,"aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>void Ge(e.headRefName,"Branch name"),children:a(Oe,{size:10})})]})]}),e.body&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Description"}),a("div",{className:"prm-detail-desc",children:e.body})]}),j.length>0&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:Ls.map(({state:G,label:Le,className:ue})=>{let be=S[G];return be.length===0?null:o("span",{className:`prm-reviewers-group ${ue}`,title:Le,children:[a("span",{className:"prm-reviewers-label",children:Le}),be.map(X=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:X.name||X.login,"aria-label":`${Le}: ${X.name||X.login}`,children:ca(X)},X.login))]},G)})})]}),o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Checks"}),a(ut,{checks:H})]}),N&&o("div",{className:"prm-detail-sync-error",children:[a(Re,{size:12,"aria-hidden":!0}),o("span",{children:["Couldn't sync this PR: ",e.syncError]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:v,"aria-label":"Retry syncing this PR",onClick:()=>void he(),children:[a(ve,{size:11,className:v?"prm-spin":""})," Retry"]})]}),a("div",{className:"prm-detail-section",children:a(dt,{projectId:e.projectId,projects:s,onAssign:G=>y(e.url,G)})})]}),o("footer",{className:"prm-modal-footer prm-detail-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:fe,title:"Open on GitHub",children:[a(Ee,{size:13}),a("span",{children:"Open on GitHub"})]}),o("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>void Ge(e.url,"PR link"),children:[a(Oe,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${k?" prm-tile-icon-btn--active":""}`,title:k?"Unfavorite":"Favorite","data-tip":k?"Unfavorite":"Favorite","aria-label":k?"Unfavorite":"Favorite","aria-pressed":k,onClick:()=>void De(),children:a(qe,{size:13,...k?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:M?"Unmute":"Mute","data-tip":M?"Unmute":"Mute","aria-label":M?"Unmute":"Mute",onClick:()=>void ma(),children:M?a(Je,{size:13}):a(Pe,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:h?"Mark this PR as read":"Mark this PR as unread","data-tip":h?"Mark read":"Mark unread","aria-label":h?"Mark read":"Mark unread",onClick:()=>void pa(),children:h?a($e,{size:13}):a(aa,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>L(e.url),children:a(ce,{size:13})})]})]})});return typeof document<"u"?fa(oa,document.body):oa}var Is=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],Co=["closed-merged","closed-abandoned"],Cs=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function Ss(e,t){let s=e.favorite?1:0,r=t.favorite?1:0;return s!==r?r-s:t.lastStatusChange-e.lastStatusChange}function ft(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function ys(e,t){return e.length>0&&e.every(r=>{let n=t.find(d=>d.url===r);return n?!!n.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function ws(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function vs(e){let t=e.workItem??ia(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),Xe(e.status),e.headRefName??"",e.baseRefName??"",t,e.repo,ws(e.repo)].join("").toLowerCase()}var bo="boardShowEmpty",Io="boardCollapsed";function So({prs:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:n,reviewWarnDays:d,reviewDangerDays:i,repositories:c,workItemLocatorBase:I,sortField:f,sortDir:C,onSortChange:L,hostScope:y,onHostScopeChange:v,awaitingFirstSync:P,syncing:h,autoSyncEnabled:m,onDismiss:M,onProjectAssign:k,onBulkSetSeen:N,onBulkDismiss:B,onBulkSetFavorite:T,viewMode:te="list",onViewModeChange:U}){let[H,j]=u("all"),[S,O]=u(""),[V,K]=u(new Set),[w,de]=u(!1),[se,ie]=u(te),[F,ye]=u(!1),[A,E]=u(!1),[D,$]=u(()=>new Set),[oe,Ce]=u(null),le=ke(null),fe=U?te:se,Ge=l=>{l==="board"&&j("all"),l==="list"&&ye(!1),U?U(l):ie(l)};q(()=>{let l=!0;return t.storage.get(bo).then(R=>{l&&typeof R=="boolean"&&E(R)}),t.storage.get(Io).then(R=>{!l||!Array.isArray(R)||$(new Set(R.filter(co)))}),()=>{l=!1}},[t]);let pa=l=>{E(l),t.storage.set(bo,l)},ma=l=>{$(R=>{let z=new Set(R);return z.has(l)?z.delete(l):z.add(l),t.storage.set(Io,[...z]),z})},De=Q(()=>{let l=[];for(let R of e){let z=Ct(R.url);l.includes(z)||l.push(z)}return l},[e]),he=Q(()=>{if(y.length===0)return e;let l=new Set(y);return e.filter(R=>l.has(Ct(R.url)))},[e,y]),oa=Q(()=>{let l=new Map;for(let R of he)l.set(R.status,(l.get(R.status)??0)+1);return l},[he]),G=Q(()=>H==="all"?he:he.filter(l=>l.status===H),[he,H]),Le=Q(()=>{let l=S.trim().toLowerCase();return l?G.filter(R=>vs(R).includes(l)):G},[G,S]),ue=Q(()=>{let l=C==="asc"?1:-1,R=[...Le];return f==="favorites"?(R.sort(Ss),R):(R.sort((z,ne)=>{let pe=0;switch(f){case"created":pe=(z.createdAt??0)-(ne.createdAt??0);break;case"status":pe=yt(z.status)-yt(ne.status);break;case"statusUpdated":pe=z.lastStatusChange-ne.lastStatusChange;break;case"updated":default:pe=(z.updatedAt||z.lastChecked||z.lastStatusChange)-(ne.updatedAt||ne.lastChecked||ne.lastStatusChange);break}if(pe===0){let Et=ft(z)?1:0,Ht=ft(ne)?1:0;return Et!==Ht?Ht-Et:(ne.createdAt??0)-(z.createdAt??0)}return pe*l}),R)},[Le,f,C]),be=Q(()=>po(ct(ue)),[ue]),X=oe?e.find(l=>l.url===oe):void 0;q(()=>{oe&&!X&&Ce(null)},[oe,X]);let re=Q(()=>{if(!X)return null;let l=Za(X.repo,c,r??ze,n??_e),R=ht(X.repo,c,d??ba,i??Ia),z=(c??[]).find(ne=>`${ne.owner}/${ne.repo}`.toLowerCase()===X.repo.toLowerCase());return{tisWarnHours:l.warnHours,tisDangerHours:l.dangerHours,reviewWarnDays:R.warnDays,reviewDangerDays:R.dangerDays,sfciGated:z?.sfciGated===!0,ignoredFailingChecks:z?.ignoredFailingChecks}},[X,c,r,n,d,i]),g=Q(()=>he.filter(ft).length,[he]),b=Q(()=>ue.map(l=>l.url),[ue]),x=Q(()=>b.filter(l=>V.has(l)),[b,V]),Y=ue.length>0&&x.length===ue.length,ae=x.length>0&&!Y,Ve=l=>{K(R=>{let z=new Set(R);return z.has(l)?z.delete(l):z.add(l),z})},Ne=()=>{K(Y||ae?new Set:new Set(b))},Be=()=>K(new Set),Ca=x.length>0?x:b,we=Ca.every(l=>{let R=e.find(z=>z.url===l);return R?!ft(R):!0}),Sa=ys(x,e);if(e.length===0){if(P){let l=h||m;return o("div",{className:"prm-empty",children:[l?a(_,{size:32,className:"prm-spin","aria-hidden":!0}):a(ge,{size:32,"aria-hidden":!0}),a("h3",{children:l?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:l?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return o("div",{className:"prm-empty",children:[a(ge,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let gt=o("div",{className:"prm-list-toolbar",children:[o("div",{className:"prm-list-controls",children:[o("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":fe==="list",title:"List view",onClick:()=>Ge("list"),children:[a(_a,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":fe==="board",title:"Board view",onClick:()=>Ge("board"),children:[a(sa,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),fe==="list"&&a("label",{className:"prm-select-all",title:Y?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:Y,ref:l=>{l&&(l.indeterminate=ae)},onChange:Ne,"aria-label":Y?"Clear selection":"Select all shown PRs"})}),fe==="list"&&o("span",{className:"prm-shown-count","aria-live":"polite",children:[ue.length," shown"]}),o("div",{className:"prm-search",children:[a(ka,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:S,onChange:l=>O(l.target.value),"aria-label":"Search PRs"})]}),o("button",{type:"button",ref:le,className:`prm-btn prm-btn--sm ${y.length>0?"is-active":""}`,onClick:()=>de(l=>!l),title:"Filter by host","aria-expanded":w,children:[a(za,{size:12}),o("span",{children:["Host",y.length>0&&o("span",{className:"prm-unread-count",children:[" (",y.length,")"]})]}),a(ga,{size:12})]}),w&&a(ao,{anchorRef:le,hosts:De,selectedHosts:y,onClose:()=>de(!1),onToggleHost:l=>v(y.includes(l)?y.filter(R=>R!==l):[...y,l]),onSelectAll:()=>v([]),shortHost:Zt}),fe==="board"&&o(ee,{children:[o("button",{type:"button",className:`prm-btn prm-btn--sm ${F?"is-active":""}`,"aria-pressed":F,title:"Select cards for bulk actions",onClick:()=>ye(l=>!l),children:[a(na,{size:12}),a("span",{children:"Select"})]}),be>0&&o("button",{type:"button",className:`prm-btn prm-btn--sm ${A?"is-active":""}`,"aria-pressed":A,title:A?"Hide empty columns":`Show ${be} empty column${be===1?"":"s"}`,onClick:()=>pa(!A),children:[a(Oa,{size:12}),a("span",{children:A?"Hide empty":`Empty (${be})`})]})]}),fe==="list"&&o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>N(Ca,!we),title:x.length>0?`Mark the ${x.length} selected PR(s) ${we?"unread":"read"}`:`Mark all shown PRs ${we?"unread":"read"}`,children:[a($e,{size:12}),o("span",{children:[we?"Mark unread":"Mark read",g>0&&o("span",{className:"prm-unread-count",children:[" (",g,")"]})]})]}),fe==="list"&&o("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:f,onChange:l=>L(l.target.value,C),"aria-label":"Sort field",children:Cs.map(l=>a("option",{value:l.id,title:l.title,children:l.label},l.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>L(f,C==="asc"?"desc":"asc"),disabled:f==="favorites",title:f==="favorites"?"Favorites first uses a fixed order":C==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":C==="asc"?"Sorted ascending":"Sorted descending",children:C==="asc"?a(Da,{size:12}):a(Ma,{size:12})})]})]}),fe==="list"&&o("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[o("button",{type:"button",role:"tab","aria-selected":H==="all",className:`prm-segment-tab ${H==="all"?"active":""}`,onClick:()=>j("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:he.length})]}),Is.map(l=>{let R=oa.get(l)??0;return o("button",{type:"button",role:"tab","aria-selected":H===l,className:`prm-segment-tab prm-segment-tab--${l} ${H===l?"active":""}`,onClick:()=>j(l),title:`Show PRs in "${Xe(l)}"`,children:[Xe(l)," ",a("span",{className:"prm-segment-count",children:R})]},l)})]}),x.length>0&&o("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:Be,title:"Clear selection","aria-label":"Clear selection",children:a(Ie,{size:12})}),o("span",{className:"prm-bulk-count",children:[x.length," selected"]}),o("div",{className:"prm-bulk-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>N(x,!we),title:`Mark the selected PR(s) ${we?"unread":"read"}`,children:[we?a(aa,{size:12}):a($e,{size:12}),a("span",{children:we?"Mark unread":"Mark read"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>T(x,Sa.favorite),title:`${Sa.label} the selected PR(s)`,children:[a(qe,{size:12,...Sa.favorite?{}:{fill:"currentColor"}}),a("span",{children:Sa.label})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{B(x),Be()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(ce,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return o("div",{className:`prm-list${fe==="board"?" prm-list--board":""}`,children:[gt,ue.length===0?o("div",{className:"prm-empty prm-empty--filtered",children:[a(ka,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:S.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),o("div",{className:"prm-empty-actions",children:[S.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>O(""),title:"Clear search",children:"Clear search"}),H!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>j("all"),title:"Show all PRs",children:"Show all"})]})]}):fe==="board"?a(xo,{prs:ue,host:t,tisWarnHours:r,tisDangerHours:n,repositories:c,selected:V,selectMode:F,showEmpty:A,collapsed:D,onToggleCollapse:ma,onToggleSelect:Ve,onDismiss:M,onOpen:Ce}):a("div",{className:"prm-tile-list",children:ue.map(l=>{let R=Za(l.repo,c,r??ze,n??_e),z=ht(l.repo,c,d??ba,i??Ia),ne=(c??[]).find(pe=>`${pe.owner}/${pe.repo}`.toLowerCase()===l.repo.toLowerCase());return a(eo,{pr:l,host:t,projects:s,tisWarnHours:R.warnHours,tisDangerHours:R.dangerHours,reviewWarnDays:z.warnDays,reviewDangerDays:z.dangerDays,sfciGated:ne?.sfciGated===!0,ignoredFailingChecks:ne?.ignoredFailingChecks,workItemLocatorBase:I,selected:V.has(l.url),onToggleSelect:Ve,onDismiss:M,onProjectAssign:k},l.url)})}),X&&re&&a(Lo,{pr:X,host:t,projects:s,tisWarnHours:re.tisWarnHours,tisDangerHours:re.tisDangerHours,reviewWarnDays:re.reviewWarnDays,reviewDangerDays:re.reviewDangerDays,sfciGated:re.sfciGated,ignoredFailingChecks:re.ignoredFailingChecks,workItemLocatorBase:I,onClose:()=>Ce(null),onDismiss:l=>{Ce(null),M(l)},onProjectAssign:k})]})}function yo({host:e,onClose:t,onPulled:s}){let[r,n]=u([]),[d,i]=u(!1),[c,I]=u(""),[f,C]=u(""),[L,y]=u(!1),[v,P]=u(null),h=ke(null);q(()=>{let k=!0;return e.call("listRepos").then(N=>{if(!k)return;let B=(N?.repos??[]).filter(T=>T.active&&T.connection==="connected");n(B),B.length>0&&I(`${B[0].host}|${B[0].owner}/${B[0].repo}`),i(!0)}).catch(()=>{k&&i(!0)}),()=>{k=!1}},[e]),q(()=>{let k=N=>{N.key==="Escape"&&!L&&t()};return window.addEventListener("keydown",k),()=>window.removeEventListener("keydown",k)},[t,L]);let m=Q(()=>r.find(k=>`${k.host}|${k.owner}/${k.repo}`===c),[r,c]),M=async()=>{P(null);let k=Number(f.trim());if(!m){P("Select a repository.");return}if(!Number.isFinite(k)||k<=0){P("Enter a valid PR number.");return}y(!0);try{let N=await e.call("pullPr",{host:m.host,fullName:`${m.owner}/${m.repo}`,number:k});N?.ok&&Array.isArray(N.prs)?s(N.prs):P(N?.error||"Failed to pull PR.")}catch(N){P(N instanceof Error?N.message:String(N))}finally{y(!1)}};return a("div",{className:"modal-backdrop",onClick:()=>!L&&t(),children:o("div",{className:"modal prm-modal",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-pull-title",onClick:k=>k.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:"prm-pull-title",children:[a(ge,{size:14,"aria-hidden":!0})," Add PR"]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:t,title:"Close",children:a(Ie,{size:14})})]}),o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),d&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):o("select",{className:"prm-input prm-input--select",value:c,onChange:k=>I(k.target.value),disabled:L||!d,"aria-label":"Repository",children:[!d&&a("option",{children:"Loading\u2026"}),r.map(k=>{let N=`${k.host}|${k.owner}/${k.repo}`;return o("option",{value:N,children:[k.owner,"/",k.repo," (",k.shortHost,")"]},N)})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{ref:h,type:"number",min:1,value:f,placeholder:"e.g. 42",className:"prm-input",onChange:k=>{C(k.target.value),v&&P(null)},onKeyDown:k=>{k.key==="Enter"&&!L&&(k.preventDefault(),M())},disabled:L||r.length===0})]}),v&&a("div",{className:"prm-modal-error",children:v})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void M(),disabled:L||r.length===0||!f.trim(),title:"Add this PR to the monitored list",children:[L?a(_,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:L,title:"Cancel without adding",children:"Cancel"})]})]})})}function wo({anchorRef:e,host:t,selectedRepos:s,onClose:r,onToggleRepo:n,onSelectAll:d,onSync:i}){let[c,I]=u(null),[f,C]=u([]);if(q(()=>{let y=e.current;if(!y)return;let v=y.getBoundingClientRect();I({top:v.bottom+4,left:v.right})},[e]),q(()=>{let y=!0;return t.call("listRepos").then(v=>{y&&C((v?.repos??[]).filter(P=>P.active&&P.connection==="connected"))}).catch(()=>{}),()=>{y=!1}},[t]),q(()=>{let y=v=>{v.key==="Escape"&&r()};return window.addEventListener("keydown",y),()=>window.removeEventListener("keydown",y)},[r]),!c||typeof document>"u")return null;let L=s.length===0;return fa(o(ee,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:y=>{y.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-sync-filter",style:{position:"fixed",top:c.top,left:c.left,transform:"translateX(-100%)"},role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),o("button",{type:"button",className:`prm-project-menu-item ${L?"is-active":""}`,role:"menuitemcheckbox","aria-checked":L,onClick:y=>{y.stopPropagation(),d()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:L&&a(Fe,{size:12})}),"All repositories"]}),f.map(y=>{let v=`${y.owner}/${y.repo}`,P=s.includes(v);return o("button",{type:"button",className:`prm-project-menu-item ${P?"is-active":""}`,role:"menuitemcheckbox","aria-checked":P,onClick:h=>{h.stopPropagation(),n(v)},title:`Filter/sync ${v}`,children:[a("span",{className:"prm-sync-filter-check",children:P&&a(Fe,{size:12})}),v," ",o("span",{className:"prm-sync-filter-host",children:["(",y.shortHost,")"]})]},`${y.host}|${v}`)}),a("div",{className:"prm-tile-menu-divider"}),o("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{i(s),r()},title:L?"Sync all repositories now":"Sync the selected repositories now",children:L?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Ze({title:e,subtitle:t,actions:s}){return o("header",{className:"prm-area-header",children:[o("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:t})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function pt({state:e}){return e==="checking"?o("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(_,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(me,{size:11})," Connected"]}):o("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(Se,{size:11})," Disconnected"]})}function ta({title:e,icon:t,onClose:s,busy:r,footer:n,children:d,wide:i}){return q(()=>{let c=I=>{I.key==="Escape"&&!r&&s()};return window.addEventListener("keydown",c),()=>window.removeEventListener("keydown",c)},[s,r]),a("div",{className:"modal-backdrop",onClick:()=>!r&&s(),children:o("div",{className:`modal prm-modal${i?" prm-modal--wide":""}`,role:"dialog","aria-modal":!0,onClick:c=>c.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{children:[t," ",e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close",children:a(Ie,{size:14})})]}),d]})})}function mt({title:e,message:t,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:n,busy:d,onConfirm:i,onCancel:c}){return o(ta,{title:e,onClose:c,busy:d,children:[a("div",{className:"prm-modal-body",children:t}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:c,disabled:d,children:r}),o("button",{type:"button",className:`prm-btn ${n?"prm-btn--danger":"prm-btn--primary"}`,onClick:i,disabled:d,children:[d?a(_,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function vo({host:e}){let[t,s]=u(()=>{let m=e.cache.get(Ja);return m?.ok&&Array.isArray(m.orgs)?m.orgs:null}),[r,n]=u(null),[d,i]=u(!1),[c,I]=u(null),[f,C]=u(!1),[L,y]=u(!1),v=Z(async()=>{try{let m=await e.call("listOrgs");m?.ok&&Array.isArray(m.orgs)?(s(m.orgs),n(null)):(s([]),m?.error&&n(m.error))}catch(m){s([]),n(m instanceof Error?m.message:String(m))}},[e]);q(()=>{v()},[v]);let P=async()=>{i(!0),n(null);try{let m=await e.call("rediscoverOrgs");!m?.ok&&m?.error&&n(m.error),await v()}catch(m){n(m instanceof Error?m.message:String(m))}finally{i(!1)}},h=async()=>{if(c){C(!0);try{let m=await e.call("deleteOrg",{host:c.host,login:c.login});!m?.ok&&m?.error&&e.toast(m.error,"error"),await v()}catch(m){e.toast(m instanceof Error?m.message:String(m),"error")}finally{C(!1),I(null)}}};return o("div",{className:"prm-area",children:[a(Ze,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:o(ee,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void P(),disabled:d,title:"Re-discover organizations from your gh accounts",children:[d?a(_,{size:13,className:"prm-spin"}):a(Te,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>y(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(Ae,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),t===null?o("div",{className:"prm-loading",children:[a(_,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):t.length===0?o("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:t.map(m=>o("div",{className:"prm-entity-card",children:[o("div",{className:"prm-entity-main",children:[o("div",{className:"prm-entity-title",children:[m.login," ",o("span",{className:"prm-entity-host",children:["(",m.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:m.apiBaseUrl}),o("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:m.login})]})]}),o("div",{className:"prm-entity-side",children:[a(pt,{state:d?"checking":m.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>I(m),title:"Delete organization",children:a(ce,{size:15})})]})]},`${m.host}|${m.login}`))}),L&&o(ta,{title:"Adding & removing organizations",icon:a(Ae,{size:16}),onClose:()=>y(!1),children:[o("div",{className:"prm-modal-body prm-help-body",children:[o("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),o("ul",{children:[o("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),o("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),o("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),o("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>y(!1),children:a("span",{children:"Got it"})})})]}),c&&a(mt,{title:"Delete organization?",danger:!0,busy:f,message:o(ee,{children:["Delete ",a("strong",{children:c.login})," (",c.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>void h(),onCancel:()=>I(null)})]})}function ks(e,t){try{let s=new URL(t);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(t)}catch{}}function ko(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function Ps(e,t){await Aa(t)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Po({host:e,onRepositoriesChanged:t}){let[s,r]=u(()=>{let S=e.cache.get(bt);return S?.ok&&Array.isArray(S.repos)?S.repos:null}),[n,d]=u(()=>{let S=e.cache.get(Ja);return S?.ok&&Array.isArray(S.orgs)?S.orgs:[]}),[i,c]=u(null),[I,f]=u(!1),[C,L]=u(!1),[y,v]=u(!1),[P,h]=u(null),[m,M]=u("general"),[k,N]=u(null),[B,T]=u(null),[te,U]=u(!1),H=Z(async()=>{try{let[S,O]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);S?.ok&&Array.isArray(S.repos)?(r(S.repos),c(null)):(r([]),S?.error&&c(S.error)),d(O?.ok&&Array.isArray(O.orgs)?O.orgs:[])}catch(S){r([]),c(S instanceof Error?S.message:String(S))}},[e]);q(()=>{H()},[H]);let j=async()=>{if(B){U(!0);try{await e.call("deleteRepository",{host:B.host,owner:B.owner,repo:B.repo}),await H()}catch(S){e.toast(S instanceof Error?S.message:String(S),"error")}finally{U(!1),T(null)}}};return o("div",{className:"prm-area",children:[a(Ze,{title:"Repositories",subtitle:"Manage your connected repositories",actions:o(ee,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>L(!0),children:[a(Te,{size:13})," ",a("span",{children:"Suggested for you"})]}),o("button",{type:"button",className:"prm-btn",onClick:()=>v(!0),children:[a(wa,{size:13})," ",a("span",{children:"Browse Repositories"})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>f(!0),children:[a(va,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),i&&a("div",{className:"prm-error",children:i}),s===null?o("div",{className:"prm-loading",children:[a(_,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?o("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(S=>o("div",{className:"prm-entity-card prm-repo-card",children:[o("div",{className:"prm-repo-top",children:[o("div",{className:"prm-entity-title",children:[a(He,{size:14,"aria-hidden":!0})," ",o("span",{children:[S.owner,"/",S.repo]}),a("span",{className:`prm-active-badge${S.active?"":" prm-active-badge--off"}`,children:S.active?"Active":"Inactive"}),a(pt,{state:S.connection}),(()=>{let O=Xa[S.buildTisPreset??S.tisPreset??at],V=Ka[S.reviewTisPreset??tt];return o(ee,{children:[o("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${O.warnHours}h, behind schedule after ${O.dangerHours}h`,children:[a(Me,{size:11,"aria-hidden":!0}),"Build: ",O.label]}),o("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${V.warnDays}d, behind schedule after ${V.dangerDays}d`,children:[a(Me,{size:11,"aria-hidden":!0}),"Review: ",V.label]})]})})()]}),o("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>ks(e,ko(S)),children:a(Ee,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>void Ps(e,ko(S)),children:a(Oe,{size:14})})]})]}),o("div",{className:"prm-entity-sub prm-repo-meta",children:[o("span",{children:["Organization: ",S.orgLogin," (",S.shortHost,")"]}),o("span",{children:["Created ",Ue(S.createdAt)]})]}),o("div",{className:"prm-repo-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>N(S),children:[a(xa,{size:12})," ",a("span",{children:"Test Connection"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{M("general"),h(S)},children:[a(je,{size:12})," ",a("span",{children:"Edit Repository"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{M("status"),h(S)},title:"Status Settings",children:[a(Me,{size:12})," ",a("span",{children:"Status Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{M("notifications"),h(S)},title:"Notification Settings",children:[a(Pe,{size:12})," ",a("span",{children:"Notification Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>T(S),children:[a(ce,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${S.host}|${S.owner}/${S.repo}`))}),I&&a(Rs,{host:e,orgs:n,onClose:()=>f(!1),onAdded:async()=>{f(!1),await H()}}),C&&a(As,{host:e,onClose:()=>L(!1),onAdded:async()=>{await H()}}),y&&a(Ms,{host:e,onClose:()=>v(!1),onAdded:async()=>{await H()}}),P&&a(Ts,{host:e,repo:P,orgs:n,initialTab:m,onClose:()=>h(null),onSaved:async S=>{h(null),Array.isArray(S)&&(e.cache.set(J,S),e.cache.set(xe,S.length),e.cache.refreshBadge()),t?.(),await H()}}),k&&a(Ds,{host:e,repo:k,onClose:()=>N(null),onResult:S=>{let O=S?"connected":"disconnected";r(V=>(V??[]).map(K=>K.host===k.host&&K.owner===k.owner&&K.repo===k.repo?{...K,connection:O}:K))}}),B&&a(mt,{title:"Delete repository?",danger:!0,busy:te,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>void j(),onCancel:()=>T(null)})]})}function Rs({host:e,orgs:t,onClose:s,onAdded:r}){let[n,d]=u(""),[i,c]=u(t[0]?`${t[0].host}|${t[0].login}`:""),[I,f]=u(null),[C,L]=u(!1),y=async()=>{let v=t.find(P=>`${P.host}|${P.login}`===i);if(!v){f("Please select an organization.");return}L(!0),f(null);try{let P=await e.call("addRepository",{ref:n.trim(),host:v.host,orgLogin:v.login});P?.ok?r():f(P?.error||"Failed to add repository.")}catch(P){f(P instanceof Error?P.message:String(P))}finally{L(!1)}};return o(ta,{title:"Add repository",icon:a(va,{size:14}),onClose:s,busy:C,children:[o("div",{className:"prm-modal-body",children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:n,spellCheck:!1,onChange:v=>{d(v.target.value),I&&f(null)},onKeyDown:v=>{v.key==="Enter"&&!C&&(v.preventDefault(),y())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),o("select",{className:"prm-input prm-input--select",value:i,onChange:v=>c(v.target.value),children:[t.length===0&&a("option",{value:"",children:"No organizations"}),t.map(v=>o("option",{value:`${v.host}|${v.login}`,children:[v.login," (",v.shortHost,")"]},`${v.host}|${v.login}`))]})]}),I&&a("div",{className:"prm-modal-error",children:I})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:C,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void y(),disabled:C||!n.trim(),children:[C?a(_,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function As({host:e,onClose:t,onAdded:s}){let[r,n]=u(null),[d,i]=u(new Set),[c,I]=u(null),[f,C]=u(!1),L=Z(async()=>{n(null),I(null);try{let h=await e.call("suggestRepositories");h?.ok&&Array.isArray(h.repos)?(n(h.repos),i(new Set(h.repos.filter(m=>m.alreadyAdded).map(m=>m.fullName)))):(n([]),h?.error&&I(h.error))}catch(h){n([]),I(h instanceof Error?h.message:String(h))}},[e]);q(()=>{L()},[L]);let y=h=>{h.alreadyAdded||i(m=>{let M=new Set(m);return M.has(h.fullName)?M.delete(h.fullName):M.add(h.fullName),M})},v=async()=>{if(!r)return;let h=r.filter(m=>!m.alreadyAdded&&d.has(m.fullName));if(h.length!==0){C(!0);try{await e.call("addRepositories",{repos:h.map(m=>({owner:m.owner,repo:m.repo,host:m.host,orgLogin:m.orgLogin}))}),await s(),t()}catch(m){e.toast(m instanceof Error?m.message:String(m),"error")}finally{C(!1)}}},P=r?r.filter(h=>!h.alreadyAdded&&d.has(h.fullName)).length:0;return o(ta,{title:"Suggested for you",icon:a(Te,{size:14}),onClose:t,busy:f,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?o("div",{className:"prm-loading",children:[a(_,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):c?a("div",{className:"prm-modal-error",children:c}):r.length===0?o("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(h=>o("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:d.has(h.fullName),disabled:h.alreadyAdded,onChange:()=>y(h)}),o("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:h.fullName}),o("span",{className:"prm-entity-sub",children:[h.prCount," PRs \xB7 ",Ue(h.lastActivity)]})]}),h.alreadyAdded&&o("span",{className:"prm-suggested-added",children:[a(me,{size:13})," Already added"]})]},h.fullName))})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void L(),disabled:f||r===null,children:[a(Te,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:f,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void v(),disabled:f||P===0,children:[f?a(_,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Adding\u2026":P>0?`Add ${P} Selected`:"Add Selected"})]})]})]})}function Ms({host:e,onClose:t,onAdded:s}){let[r,n]=u(""),[d,i]=u(null),[c,I]=u(!0),[f,C]=u(!1),[L,y]=u(!1),[v,P]=u(1),[h,m]=u(null),[M,k]=u(new Set),[N,B]=u(new Set),[T,te]=u(new Set),[U,H]=u(!1),j=Z(async(A,E)=>{E?C(!0):I(!0),m(null);try{let D=await e.call("listAllRepositories",{page:A}),$=D?.ok&&Array.isArray(D.repos)?D.repos:[];y(!!D?.hasMore),te(new Set(Array.isArray(D?.incompleteOwners)?D.incompleteOwners:[])),i(oe=>{if(!E||!oe)return $;let Ce=new Set(oe.map(le=>`${le.host}|${le.fullName}`));return[...oe,...$.filter(le=>!Ce.has(`${le.host}|${le.fullName}`))]}),D&&D.ok===!1&&D.error&&m(D.error)}catch(D){m(D instanceof Error?D.message:String(D)),E||i([])}finally{I(!1),C(!1)}},[e]);q(()=>{j(1,!1)},[j]);let S=()=>{let A=v+1;P(A),j(A,!0)},O=d??[],V=r.trim().toLowerCase(),K=V?O.filter(A=>A.fullName.toLowerCase().includes(V)):O,w=A=>{k(E=>{let D=new Set(E);return D.has(A)?D.delete(A):D.add(A),D})},de=A=>{B(E=>{let D=new Set(E);return D.has(A)?D.delete(A):D.add(A),D})},se=A=>`${A.host}|${A.fullName}`,ie=(()=>{let A=new Map;for(let E of K){let D=A.get(E.owner)??[];D.push(E),A.set(E.owner,D)}return Array.from(A.entries())})(),F=async()=>{let A=K.filter(E=>!E.alreadyAdded&&M.has(se(E)));if(A.length!==0){H(!0);try{await e.call("addRepositories",{repos:A.map(E=>({owner:E.owner,repo:E.repo,host:E.host,orgLogin:E.owner}))}),await s(),t()}catch(E){e.toast(E instanceof Error?E.message:String(E),"error")}finally{H(!1)}}},ye=K.filter(A=>!A.alreadyAdded&&M.has(se(A))).length;return o(ta,{title:"Browse Repositories",icon:a(wa,{size:14}),onClose:t,busy:U,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:A=>n(A.target.value)})}),h&&a("div",{className:"prm-modal-error",children:h}),c?o("div",{className:"prm-loading",children:[a(_,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):o("div",{className:"prm-browse-list",children:[ie.map(([A,E])=>{let D=!N.has(A);return o("div",{className:"prm-browse-group",children:[o("button",{type:"button",className:"prm-browse-group-header",onClick:()=>de(A),"aria-expanded":D,children:[a(Ye,{size:13,className:`prm-disclosure${D?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:A}),o("span",{className:"prm-browse-group-count",title:!V&&T.has(A)?`${E.length} loaded \u2014 more available, use Load more`:void 0,children:["(",E.length,!V&&T.has(A)?"\u2026":"",")"]})]}),D&&E.map($=>$.alreadyAdded?o("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[o("span",{children:[a(He,{size:13,"aria-hidden":!0})," ",$.fullName,$.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(me,{size:11,"aria-hidden":!0})," Connected"]})]},se($)):o("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:M.has(se($)),onChange:()=>w(se($))}),o("span",{children:[a(He,{size:13,"aria-hidden":!0})," ",$.fullName,$.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},se($)))]},A)}),K.length===0&&a("div",{className:"prm-area-empty",children:V?"No repositories match your filter.":"No repositories found."}),L&&!V&&o("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:S,disabled:f,children:[f?a(_,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Loading\u2026":"Load more"})]})]})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:U,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void F(),disabled:U||ye===0,children:[U?a(_,{size:13,className:"prm-spin"}):null,a("span",{children:ye>0?`Add ${ye} Selected`:"Add Selected"})]})]})]})}function Ts({host:e,repo:t,orgs:s,initialTab:r="general",onClose:n,onSaved:d}){let[i,c]=u(r),[I,f]=u(`${t.owner}/${t.repo}`),[C,L]=u(t.orgLogin),[y,v]=u(t.active),[P,h]=u(t.buildTisPreset??t.tisPreset??at),[m,M]=u(t.reviewTisPreset??tt),[k,N]=u(t.sfciGated===!0),[B,T]=u((t.ignoredFailingChecks??[]).some(w=>w.toLowerCase().includes("snyk"))),[te,U]=u(t.notifyInApp??!0),[H,j]=u(null),[S,O]=u(!1),V=s.filter(w=>w.host===t.host),K=async()=>{O(!0),j(null);try{let w=await e.call("updateRepository",{key:{host:t.host,owner:t.owner,repo:t.repo},ref:I.trim(),orgLogin:C,active:y,buildTisPreset:P,reviewTisPreset:m,sfciGated:k,ignoredFailingChecks:B?["Snyk"]:[],notifyInApp:te});w?.ok?d(w.prs):j(w?.error||"Failed to save settings.")}catch(w){j(w instanceof Error?w.message:String(w))}finally{O(!1)}};return o(ta,{title:o("span",{className:"prm-dialog-title",children:["Repository Settings ",o("span",{className:"prm-entity-sub",children:[t.owner,"/",t.repo]})]}),icon:a(je,{size:14}),onClose:n,busy:S,children:[o("nav",{className:"prm-dialog-tabs",children:[o("button",{type:"button",className:`prm-dialog-tab${i==="general"?" active":""}`,onClick:()=>c("general"),children:[a(je,{size:12})," General"]}),o("button",{type:"button",className:`prm-dialog-tab${i==="status"?" active":""}`,onClick:()=>c("status"),children:[a(Me,{size:12})," Status"]}),o("button",{type:"button",className:`prm-dialog-tab${i==="notifications"?" active":""}`,onClick:()=>c("notifications"),children:[a(Pe,{size:12})," Notifications"]})]}),o("div",{className:"prm-modal-body",children:[i==="general"?o(ee,{children:[o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:y,onChange:w=>v(w.target.checked)}),o("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:I,spellCheck:!1,onChange:w=>f(w.target.value)})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:C,onChange:w=>L(w.target.value),children:V.map(w=>o("option",{value:w.login,children:[w.login," (",w.shortHost,")"]},w.login))})]})]}):i==="status"?o(ee,{children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:P,onChange:w=>h(w.target.value),children:Object.values(Xa).map(w=>o("option",{value:w.id,children:[w.label," (",w.warnHours,"h / ",w.dangerHours,"h)"]},w.id))})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:m,onChange:w=>M(w.target.value),children:Object.values(Ka).map(w=>o("option",{value:w.id,children:[w.label," (",w.warnDays,"d / ",w.dangerDays,"d)"]},w.id))})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:k,onChange:w=>N(w.target.checked)}),o("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:B,onChange:w=>T(w.target.checked)}),o("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:te,onChange:w=>U(w.target.checked)}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),H&&a("div",{className:"prm-modal-error",children:H})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:n,disabled:S,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void K(),disabled:S,children:[S?a(_,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function Ds({host:e,repo:t,onClose:s,onResult:r}){let[n,d]=u(null);return q(()=>{let i=!0;return(async()=>{try{let I=await e.call("testRepository",{host:t.host,owner:t.owner,repo:t.repo})??{ok:!1,error:"No response"};i&&(d(I),r?.(I.ok))}catch(c){i&&(d({ok:!1,error:c instanceof Error?c.message:String(c)}),r?.(!1))}})(),()=>{i=!1}},[e,t]),o(ta,{title:`Connection Test Results: ${t.owner}/${t.repo}`,icon:a(xa,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:n===null?o("div",{className:"prm-loading",children:[a(xa,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):n.ok?o("div",{className:"prm-test-result prm-test-result--ok",children:[a(me,{size:16})," All connection tests passed."]}):o("div",{className:"prm-test-result prm-test-result--fail",children:[a(Se,{size:16}),o("div",{children:[a("div",{children:n.error||"Connection failed."}),o("div",{className:"prm-field-hint",children:["Try ",o("code",{children:["gh auth login ",t.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function Ns(e){let t=e.trim().split(/\s+/).filter(Boolean);return t.length===0?"?":t.length===1?t[0].slice(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}function Ro({host:e}){let[t,s]=u(()=>{let f=e.cache.get(It);return f?.ok?f.author??null:void 0}),[r,n]=u(null),[d,i]=u(!1),c=Z(async()=>{try{let f=await e.call("getAuthor");f?.ok?(s(f.author??null),n(null)):(s(null),f?.error&&n(f.error))}catch(f){s(null),n(f instanceof Error?f.message:String(f))}},[e]);q(()=>{c()},[c]);let I=t?.name||t?.login||"";return o("div",{className:"prm-area",children:[a(Ze,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),t===void 0?o("div",{className:"prm-loading",children:[a(_,{size:14,className:"prm-spin"})," Loading author\u2026"]}):t===null?o("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:o("div",{className:"prm-entity-card prm-author-card",children:[o("button",{type:"button",className:"prm-author-row",onClick:()=>i(f=>!f),"aria-expanded":d,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:Ns(I)}),o("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:I}),t.email&&a("span",{className:"prm-entity-sub",children:t.email})]}),a(Ye,{size:16,className:`prm-disclosure${d?" is-open":""}`,"aria-hidden":!0})]}),d&&o("div",{className:"prm-author-detail",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:I||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:t.email||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:t.identities.map(f=>o("div",{className:"prm-identity-row",children:[o("span",{children:[f.login," ",o("span",{className:"prm-entity-host",children:["(",f.shortHost,")"]})]}),f.connection==="connected"?a(me,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):o("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(Se,{size:13})," Disconnected"]})]},`${f.host}|${f.login}`))})]})]})]})})]})}function Ao({settings:e,update:t}){let s=e.notifyInApp??e.notifyOnChange;return o("div",{className:"prm-area",children:[a(Ze,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>t({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>t({sendToInbox:r.target.checked})}),o("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>t({badgeMode:"unread"})}),o("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>t({badgeMode:"total"})}),o("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var Mo=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],Bs=15;function To(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function Fs(e,t){let s=Math.max(0,e-t),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let n=Math.floor(r/60),d=r%60;return d?`in ${n}h ${d}m`:`in ${n}h`}function Do({settings:e,update:t,host:s}){let[r,n]=u(()=>s.cache.get(J)??[]),[d,i]=u(!1),[c,I]=u(()=>Date.now());q(()=>{let h=window.setInterval(()=>{let m=s.cache.get(J);m&&n(M=>M===m?M:m),I(Date.now())},1e3);return()=>window.clearInterval(h)},[s]);let f=e.autoSyncEnabled??!0,C=Mo.some(h=>h.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:Bs,L=r.reduce((h,m)=>Math.max(h,m.lastChecked||0),0),y=f&&L?L+C*6e4:0,v=new Set(r.map(h=>h.repo)).size,P=async()=>{i(!0);try{let h=await s.call("pollAll");h?.ok&&Array.isArray(h.prs)&&(n(h.prs),s.cache.set(J,h.prs))}catch(h){s.toast(h instanceof Error?h.message:String(h),"error")}finally{i(!1)}};return o("div",{className:"prm-area",children:[a(Ze,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:f,onChange:h=>t({autoSyncEnabled:h.target.checked})}),o("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),o("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:C,onChange:h=>{let m=Number(h.target.value);Number.isFinite(m)&&t({pollIntervalMinutes:m})},children:Mo.map(h=>a("option",{value:h.value,children:h.label},h.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),o("div",{className:"prm-sync-status",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:y?o(ee,{children:[Fs(y,c)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",To(y)]})]}):"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:L?o(ee,{children:[Ue(L)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",To(L)]})]}):""})]}),o("div",{className:"prm-sync-counts",children:[o("span",{className:"prm-sync-count",children:[a("strong",{children:v})," repositories checked"]}),o("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>void P(),disabled:d,children:[d?a(_,{size:13,className:"prm-spin"}):a(ve,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var Es=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:Ba},{id:"repositories",label:"Repositories",icon:Na},{id:"author",label:"Author",icon:Wa}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:Pe}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:ja}]}];function No({settings:e,onSave:t,onRepositoriesChanged:s,host:r}){let[n,d]=u(e.settingsActiveNav??Lt),i=I=>{let f={...e,...I};t(f),r.cache.set("settings",f),r.cache.refreshBadge()},c=I=>{d(I),i({settingsActiveNav:I})};return a("div",{className:"prm-settings-shell",children:o("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:Es.map(I=>o("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:I.label}),I.items.map(f=>{let C=f.icon;return o("button",{type:"button",className:`prm-nav-row${n===f.id?" active":""}`,"aria-current":n===f.id,onClick:()=>c(f.id),children:[a(C,{size:15,"aria-hidden":!0}),a("span",{children:f.label})]},f.id)})]},I.label))}),o("div",{className:"prm-settings-pane",children:[n==="organizations"&&a(vo,{host:r}),n==="repositories"&&a(Po,{host:r,onRepositoriesChanged:s}),n==="author"&&a(Ro,{host:r}),n==="notifications"&&a(Ao,{settings:e,update:i}),n==="system"&&a(Do,{settings:e,update:i,host:r})]})]})})}function Bo(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function Fo(e,t,s){return e===1?t:s}function Eo(e){if(!e)return null;let t=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return t.length>0?{kind:"disconnect",subjects:t,action:"settings",message:`GitHub sign-in expired for ${Bo(t)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${Fo(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${Fo(r.length,"is","is")} temporarily unreachable for ${Bo(r)} \u2014 retrying automatically.`}:null}function Hs(e,t){let s=(e.repo??"").toLowerCase();if(s)return(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function Ho(e,t){let s=Hs(e,t.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let d=t.notifyInApp??t.notifyOnChange??!1,i=t.sendToInbox??!1;return{inApp:d,inbox:i&&!!e.projectId}}function Oo(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function Os(e){try{let t=new URL(e);if(t.protocol!=="http:"&&t.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function qo(e,t,s){for(let r of t){let n=St(r.newStatus)>St(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||n))continue;let i=Ho(r.pr,s);if(!i.inApp&&!i.inbox)continue;let c=Oo(r.pr.repo),I=Oo(r.pr.title),f=Os(r.pr.url),C=f?`[${I}](${f})`:I;if(i.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${Xe(r.oldStatus)} \u2192 ${Xe(r.newStatus)}`,"info"),i.inbox&&r.pr.projectId){let L=`**${c}#${r.pr.number}** \u2014 ${Xe(r.oldStatus)} \u2192 **${Xe(r.newStatus)}**

${C}`;try{await e.pushInbox({comments:L,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var Rt="activeSubTab",Uo="listSort",zo="hostScope",At="listView";function Mt({host:e}){let[t,s]=u(null),[r,n]=u(!1),[d,i]=u(()=>e.cache.get(J)??[]),[c,I]=u(!1),[f,C]=u(null),[L,y]=u("prs"),[v,P]=u(!1),[h,m]=u(!1),[M,k]=u(!1),[N,B]=u(!1),[T,te]=u([]),[U,H]=u("status"),[j,S]=u("asc"),[O,V]=u([]),[K,w]=u("board"),[de,se]=u(!1),[ie,F]=u(()=>({...jt})),ye=ke(null),[A,E]=u(()=>e.listProjects());q(()=>{let g=!0;return Promise.all([e.storage.get(La),e.storage.get(Rt),e.call("listPrs"),e.storage.get(Uo),e.storage.get(zo),e.storage.get(At)]).then(([b,x,Y,ae,Ve,Ne])=>{if(!g)return;ae?.field&&H(ae.field),ae?.dir&&S(ae.dir),Array.isArray(Ve)&&V(Ve),Pt(Ne)&&w(Ne);let Be=b?{...ha,...b,relevanceModes:{...ha.relevanceModes,...b.relevanceModes}}:null;s(Be),Be&&(e.cache.set("settings",Be),e.cache.refreshBadge?.()),x==="prs"||x==="settings"?y(x):(x==="board"||x==="list")&&(y("prs"),Pt(Ne)||(w(x),e.storage.set(At,x)),e.storage.set(Rt,"prs")),Array.isArray(Y)&&Y.length>0&&(i(Y),e.cache.set(J,Y),e.cache.set(xe,Y.length),e.cache.refreshBadge?.()),n(!0),P(!0),B(!0)}).catch(b=>{g&&(console.error("pr-monitor hydrate failed",b),n(!0),P(!0),B(!0))}),()=>{g=!1}},[e]),q(()=>{let g=()=>{let x=e.cache.get(J);x&&i(ae=>ae===x?ae:x);let Y=e.listProjects();E(ae=>ae.length===Y.length?ae:Y)},b=window.setInterval(g,100);return()=>window.clearInterval(b)},[e]);let D=g=>{y(g),e.storage.set(Rt,g)},$=Z(async g=>{I(!0),C(null);try{let b=Array.isArray(g)&&g.length>0,x=b?await e.call("syncRepos",{repos:g}):await e.call("pollAll");if(x?.ok&&Array.isArray(x.prs)){if(i(x.prs),e.cache.set(J,x.prs),e.cache.set(xe,x.prs.length),e.cache.refreshBadge?.(),Array.isArray(x.deltas)&&x.deltas.length>0){let ae=t??{...ha,...await e.storage.get(La)};await qo(e,x.deltas,ae)}}else x?.error&&C(x.error);let Y=x?.health;!b&&Y&&F(Y)}catch(b){C(b instanceof Error?b.message:String(b))}finally{I(!1),se(!0)}},[e]),oe=ke(!1);q(()=>{!N||oe.current||(oe.current=!0,e.call("getSyncHealth").then(g=>{g?.ok&&g.health&&F(g.health)}).catch(()=>{}),$())},[N,$,e]);let Ce=Z(async(g,b)=>{try{let x=await e.call("resolveRemoteGone",{repo:g,action:b});if(!x?.ok){e.toast(`Couldn't ${b} ${g} \u2014 ${x?.error??"unknown error"}`,"error");return}F(Y=>({...Y,remoteGone:Y.remoteGone.filter(ae=>ae.toLowerCase()!==g.toLowerCase()),keptGone:b==="keep"?[...Y.keptGone,g].filter((ae,Ve,Ne)=>Ne.indexOf(ae)===Ve):Y.keptGone})),$()}catch(x){e.toast(`Couldn't ${b} ${g} \u2014 ${x instanceof Error?x.message:String(x)}`,"error")}},[e,$]),le=Z(async g=>{try{let b=await e.call("removePr",g);b?.ok&&Array.isArray(b.prs)&&(i(b.prs),e.cache.set(J,b.prs),e.cache.set(xe,b.prs.length),e.cache.refreshBadge?.())}catch(b){e.toast(`Couldn't remove PR \u2014 ${b instanceof Error?b.message:String(b)}`,"error")}},[e]),fe=Z(async g=>{let b=d.find(x=>x.url===g);if(b)try{let x;b.source==="auto"?x=await e.call("dismissPr",{url:g}):x=await e.call("removePr",g),x?.ok&&Array.isArray(x.prs)&&(i(x.prs),e.cache.set(J,x.prs),e.cache.set(xe,x.prs.length),e.cache.refreshBadge?.())}catch(x){e.toast(`Couldn't dismiss PR \u2014 ${x instanceof Error?x.message:String(x)}`,"error")}},[e,d]),Ge=Z(async g=>{s(g);let b=await e.storage.get(La),x={...g};b&&(x.organizations=b.organizations,x.repositories=b.repositories,x.author=b.author,x.orgDiscovered=b.orgDiscovered,x.authorDiscovered=b.authorDiscovered),await e.storage.set(La,x),e.cache.set("settings",x),e.cache.refreshBadge?.()},[e]),pa=Z(async()=>{let g=await e.storage.get(La);g?.repositories&&s(b=>b&&{...b,repositories:g.repositories})},[e]),ma=Z(async(g,b)=>{try{let x=await e.call("assignProject",g,b);x?.ok&&Array.isArray(x.prs)&&(i(x.prs),e.cache.set(J,x.prs))}catch(x){e.toast(`Couldn't assign project \u2014 ${x instanceof Error?x.message:String(x)}`,"error")}},[e]),De=Z((g,b)=>{H(g),S(b),e.storage.set(Uo,{field:g,dir:b})},[e]),he=Z(g=>{V(g),e.storage.set(zo,g)},[e]),oa=Z(g=>{w(g),e.storage.set(At,g)},[e]),G=Z(async(g,b)=>{if(g.length!==0)try{let x=await e.call("setPrsSeen",{urls:g,seen:b});x?.ok&&Array.isArray(x.prs)&&(i(x.prs),e.cache.set(J,x.prs),e.cache.set("monitoredCount",x.prs.length),e.cache.refreshBadge?.())}catch(x){e.toast(`Couldn't update read state \u2014 ${x instanceof Error?x.message:String(x)}`,"error")}},[e]),Le=Z(async(g,b)=>{if(g.length!==0)try{let x=await e.call("setPrsFavorite",{urls:g,favorite:b});x?.ok&&Array.isArray(x.prs)&&(i(x.prs),e.cache.set(J,x.prs))}catch(x){e.toast(`Couldn't update favorites \u2014 ${x instanceof Error?x.message:String(x)}`,"error")}},[e]),ue=Z(async g=>{if(g.length!==0)try{let b=await e.call("dismissPrs",{urls:g});b?.ok&&Array.isArray(b.prs)&&(i(b.prs),e.cache.set(J,b.prs),e.cache.set(xe,b.prs.length),e.cache.refreshBadge?.())}catch(b){e.toast(`Couldn't dismiss PRs \u2014 ${b instanceof Error?b.message:String(b)}`,"error")}},[e]),be=Q(()=>{if(T.length===0)return d;let g=new Set(T.map(b=>b.toLowerCase()));return d.filter(b=>g.has(b.repo.toLowerCase()))},[d,T]),X=Q(()=>be.filter(g=>Co.includes(g.status)).map(g=>g.url),[be]),re=Q(()=>Eo(ie),[ie]);return v?t?o("section",{className:"prm-panel",children:[o("header",{className:"prm-header",children:[o("div",{className:"prm-header-title",children:[a(ge,{size:16,className:"prm-header-icon","aria-hidden":!0}),o("div",{className:"prm-header-heading",children:[a("h2",{children:L==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:L==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),L==="prs"&&a("span",{className:"prm-count-pill",children:be.length})]}),o("div",{className:"prm-header-actions",children:[L==="prs"&&o(ee,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>m(!0),title:"Add a specific pull request to the monitored list",children:[a(Ha,{size:13})," ",a("span",{children:"Add PR"})]}),X.length>0&&o("button",{type:"button",className:"prm-btn",onClick:()=>void ue(X),title:`Sweep \u2014 dismiss the ${X.length} Merged/Closed PR(s) from the list`,children:[a(ce,{size:13})," ",a("span",{children:"Sweep"})]}),o("div",{className:"prm-split-btn",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>void $(T),disabled:c,title:T.length>0?`Sync the ${T.length} selected repositor${T.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[c?a(_,{size:13,className:"prm-spin"}):a(ve,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:ye,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>k(g=>!g),disabled:c,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker",children:a(ga,{size:13})}),M&&a(wo,{anchorRef:ye,host:e,selectedRepos:T,onClose:()=>k(!1),onToggleRepo:g=>te(b=>b.includes(g)?b.filter(x=>x!==g):[...b,g]),onSelectAll:()=>te([]),onSync:g=>void $(g)})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":L==="settings",onClick:()=>D(L==="settings"?"prs":"settings"),title:L==="settings"?"Back to pull requests":"Settings",children:L==="settings"?o(ee,{children:[a(Ta,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):o(ee,{children:[a(Ga,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]})]}),o("div",{className:`prm-content${L==="prs"&&K==="board"?" prm-content--board":""}`,children:[f&&a("div",{className:"prm-error",children:f}),L==="prs"&&re&&o("div",{className:`prm-sync-clue prm-sync-clue--${re.kind}`,role:"status",children:[re.kind==="disconnect"&&a($a,{size:14,"aria-hidden":!0}),re.kind==="remote-gone"&&a(Ke,{size:14,"aria-hidden":!0}),re.kind==="outage"&&a(Ea,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:re.message}),re.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>D("settings"),children:"Open Settings"})]}),L==="prs"&&ie.remoteGone.map(g=>o("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${g} is gone`,children:[o("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:g})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),o("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>void Ce(g,"keep"),children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>void Ce(g,"remove"),children:"Remove"})]})]},g)),L==="prs"&&a(So,{prs:be,host:e,projects:A,tisWarnHours:t.tisWarnHours,tisDangerHours:t.tisDangerHours,reviewWarnDays:t.reviewWarnDays,reviewDangerDays:t.reviewDangerDays,repositories:t.repositories,workItemLocatorBase:t.gusLocatorBaseUrl,sortField:U,sortDir:j,onSortChange:De,hostScope:O,onHostScopeChange:he,awaitingFirstSync:!de,syncing:c,autoSyncEnabled:t.autoSyncEnabled??!0,onDismiss:g=>void fe(g),onProjectAssign:(g,b)=>void ma(g,b),onBulkSetSeen:(g,b)=>void G(g,b),onBulkDismiss:g=>void ue(g),onBulkSetFavorite:(g,b)=>void Le(g,b),viewMode:K,onViewModeChange:oa}),L==="settings"&&r&&a(No,{settings:t,onSave:g=>void Ge(g),onRepositoriesChanged:()=>void pa(),host:e})]}),h&&a(yo,{host:e,onClose:()=>m(!1),onPulled:g=>{i(g),e.cache.set(J,g),e.cache.set(xe,g.length),e.cache.refreshBadge?.(),m(!1)}})]}):a("section",{className:"prm-panel",children:a(Xt,{onSave:async g=>{await Ge(g)}})}):a("section",{className:"prm-panel",children:o("div",{className:"prm-loading",children:[a(_,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})})}function _o(e){if(e.length!==0)return e.length===1?e[0]:e}var Tt=new Map,Dt=[],Go;function Nt(e){Go=e}function qs(){return{get:e=>Tt.get(e),set:(e,t)=>{Tt.set(e,t)},delete:e=>{Tt.delete(e)},refreshBadge:()=>Go?.()}}function Us(e,t){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,t)}function zs(e){try{let t=new URL(e);if(t.protocol!=="https:"&&t.protocol!=="http:"||typeof window>"u")return;window.open(t.href,"_blank","noopener,noreferrer")}catch{}}function Vo(e){return Dt=[],ra(e,"listProjects").then(t=>{Array.isArray(t)&&(Dt=t)}).catch(()=>{}),{call:(t,...s)=>ra(e,t,_o(s)),storage:{get:t=>ra(e,"storageGet",t),set:async(t,s)=>{await ra(e,"storageSet",{key:t,value:s})}},cache:qs(),toast:Us,listProjects:()=>Dt,openExternal:zs,pushInbox:async t=>t.projectId?await ra(e,"pushInbox",t):{id:""}}}var Bt=`/*
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

  .prm-board {
    --zcc-kanban-col-min: 220px;
    --zcc-kanban-col-flex: 0 0 220px;
    --zcc-kanban-col-width: 220px;
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

`;var $o="pr-monitor",Wo="prm-plugin-styles";function Gs(){if(typeof document>"u")return;let e=document.getElementById(Wo);if(e instanceof HTMLStyleElement){e.textContent=`${vt}
${Bt}`;return}let t=document.createElement("style");t.id=Wo,t.textContent=`${vt}
${Bt}`,document.head.appendChild(t)}Gs();var Vs={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function Ws(){let e=Q(()=>Vo($o),[]);return a("div",{style:Vs,children:a(Mt,{host:e})})}function $s(){let[e,t]=u(null);return q(()=>{let s=!0,r=async()=>{try{let d=await ra($o,"badge");if(!s)return;let i=typeof d?.count=="number"&&d.count>0?d.count:null;t(i)}catch{s&&t(null)}};r(),Nt(()=>{r()});let n=window.setInterval(()=>{r()},3e4);return()=>{s=!1,window.clearInterval(n),Nt(void 0)}},[]),e==null?null:a("span",{className:"nav-badge",children:e})}var _f=Ut(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:Ws,experimental_sidebarAccessory:$s}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:t=>{t.toPluginPanel("main")}})});export{_f as default,Gs as injectStyles};
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
