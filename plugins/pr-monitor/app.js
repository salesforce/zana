var $=globalThis.__ZCC_HOST_REACT__;var Js=$.Children,Ys=$.Component,Qs=$.Fragment,en=$.StrictMode,an=$.Suspense,tn=$.cloneElement,Ut=$.createContext,ya=$.createElement,on=$.createRef,Ya=$.forwardRef,rn=$.isValidElement,sn=$.lazy,nn=$.memo,ln=$.startTransition,K=$.useCallback,_t=$.useContext,dn=$.useDebugValue,un=$.useDeferredValue,q=$.useEffect,cn=$.useId,fn=$.useImperativeHandle,pn=$.useInsertionEffect,mn=$.useLayoutEffect,Q=$.useMemo,gn=$.useReducer,Ce=$.useRef,u=$.useState,xn=$.useSyncExternalStore,hn=$.useTransition,Ln=$.version;function Xo(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Zo(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}async function ra(e,t,s){return Xo().callRpc(e,t,s)}function zt(e){return{__zccPluginApp:!0,setup:e}}function xt(e,t){Zo().useRealtime?.(e,t)}var Qa=(...e)=>e.filter((t,s,r)=>!!t&&t.trim()!==""&&r.indexOf(t)===s).join(" ").trim();var Gt=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();var Vt=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(t,s,r)=>r?r.toUpperCase():s.toLowerCase());var ht=e=>{let t=Vt(e);return t.charAt(0).toUpperCase()+t.slice(1)};var et={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};var jt=e=>{for(let t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};var Jo=Ut({});var $t=()=>_t(Jo);var Wt=Ya(({color:e,size:t,strokeWidth:s,absoluteStrokeWidth:r,className:i="",children:d,iconNode:l,...c},b)=>{let{size:f=24,strokeWidth:C=2,absoluteStrokeWidth:h=!1,color:y="currentColor",className:v=""}=$t()??{},k=r??h?Number(s??C)*24/Number(t??f):s??C;return ya("svg",{ref:b,...et,width:t??f??et.width,height:t??f??et.height,stroke:e??y,strokeWidth:k,className:Qa("lucide",v,i),...!d&&!jt(c)&&{"aria-hidden":"true"},...c},[...l.map(([x,m])=>ya(x,m)),...Array.isArray(d)?d:[d]])});var p=(e,t)=>{let s=Ya(({className:r,...i},d)=>ya(Wt,{ref:d,iconNode:t,className:Qa(`lucide-${Gt(ht(e))}`,`lucide-${e}`,r),...i}));return s.displayName=ht(e),s};var Yo=[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]],Ma=p("arrow-down",Yo);var Qo=[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]],Ta=p("arrow-left",Qo);var er=[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]],Da=p("arrow-up",er);var ar=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]],Je=p("bell-off",ar);var tr=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]],Me=p("bell",tr);var or=[["path",{d:"M10 2v8l3-3 3 3V2",key:"sqw3rj"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",key:"k3hazp"}]],Na=p("book-marked",or);var rr=[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],Ba=p("building-2",rr);var sr=[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]],He=p("check",sr);var nr=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],ga=p("chevron-down",nr);var lr=[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]],Ye=p("chevron-right",lr);var ir=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],Te=p("circle-alert",ir);var dr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],ge=p("circle-check",dr);var ur=[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]],Fa=p("circle-dashed",ur);var cr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],De=p("circle-question-mark",cr);var fr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],we=p("circle-x",fr);var pr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]],Ne=p("clock",pr);var mr=[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],Ea=p("cloud-off",mr);var gr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],sa=p("columns-3",gr);var xr=[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]],Ha=p("download",xr);var hr=[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]],Oe=p("external-link",hr);var Lr=[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],Oa=p("eye-off",Lr);var br=[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],qa=p("eye",br);var Ir=[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]],Ua=p("folder-git-2",Ir);var Cr=[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]],wa=p("folder-search",Cr);var Sr=[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]],qe=p("git-branch",Sr);var yr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]],Qe=p("git-merge",yr);var wr=[["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 9v12",key:"1sc30k"}],["path",{d:"m21 3-6 6",key:"16nqsk"}],["path",{d:"m21 9-6-6",key:"9j17rh"}],["path",{d:"M18 11.5V15",key:"65xf6f"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}]],ea=p("git-pull-request-closed",wr);var vr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],$e=p("git-pull-request-draft",vr);var Pr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],xe=p("git-pull-request",Pr);var kr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]],_a=p("globe",kr);var Ar=[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]],za=p("layout-list",Ar);var Rr=[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]],Ue=p("link-2",Rr);var Mr=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],G=p("loader-circle",Mr);var Tr=[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]],We=p("mail-open",Tr);var Dr=[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]],aa=p("mail",Dr);var Nr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],na=p("panel-left-close",Nr);var Br=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],Ke=p("pen",Br);var Fr=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]],va=p("plus",Fr);var Er=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]],Ae=p("refresh-cw",Er);var Hr=[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]],Pa=p("search",Hr);var Or=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],Ga=p("settings",Or);var qr=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]],Va=p("shield-alert",qr);var Ur=[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],Be=p("sparkles",Ur);var _r=[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],la=p("square-check-big",_r);var zr=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]],_e=p("star",zr);var Gr=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],fe=p("trash-2",Gr);var Vr=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],Xe=p("triangle-alert",Vr);var jr=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]],ja=p("users",jr);var $r=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],$a=p("wifi-off",$r);var Wr=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]],xa=p("wifi",Wr);var Kr=[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]],Wa=p("wrench",Kr);var Xr=[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]],Se=p("x",Xr);var Xa={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},at="standard",Ka={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},tt="standard";function Zr(e){let t=e?.buildTisPreset??e?.tisPreset;return t&&t in Xa?t:at}function Kt(e,t){let s=(e??"").toLowerCase();return s?(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function Za(e,t,s,r){let i=Kt(e,t);if(i){let d=Xa[Zr(i)];return{warnHours:d.warnHours,dangerHours:d.dangerHours}}return{warnHours:s,dangerHours:r}}function Lt(e,t,s,r){let i=Kt(e,t);if(i){let d=i.reviewTisPreset&&i.reviewTisPreset in Ka?i.reviewTisPreset:tt,l=Ka[d];return{warnDays:l.warnDays,dangerDays:l.dangerDays}}return{warnDays:s,dangerDays:r}}var Xt={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},bt="organizations",ha={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:bt,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},de="monitoredCount",X="monitoredPrs",La="settings",Ja="prefetch:orgs",It="prefetch:repos",Ct="prefetch:author",Jr=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function St(e){let t=Jr.exec(e);if(!t)throw new Error(`Not a GitHub PR URL: ${e}`);return t[1]}var Yr={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function yt(e){return Yr[e]}var Qr={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function wt(e){return Qr[e]}var es=/\bW-\d{8}\b/i;function ia(e,t,s){for(let r of[e,t,s]){if(typeof r!="string"||!r)continue;let i=es.exec(r);if(i)return i[0].toUpperCase()}}function ot(e,t){if(!e||!t||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(t)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${t.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var Zt=globalThis.__ZCC_HOST_REACT__,ee=Zt.Fragment;function a(e,t,s){return Zt.createElement(e,s===void 0?t:{...t,key:s})}var o=a;function Jt({onSave:e}){let[t,s]=u(!1),r=async()=>{s(!0);try{await e({...ha})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:o("div",{className:"prm-setup",children:[a(xe,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void r(),disabled:t,children:t?"Saving\u2026":"Get started"})})]})})}function ze(e){let t=Date.now(),s=Math.max(0,t-e),r=Math.floor(s/1e3);if(r<60)return"just now";let i=Math.floor(r/60);if(i<60)return`${i}m ago`;let d=Math.floor(i/60);if(d<24)return`${d}h ago`;let l=Math.floor(d/24);if(l===1)return"yesterday";if(l<30)return`${l}d ago`;let c=Math.floor(l/30);return c<12?`${c}mo ago`:`${Math.floor(c/12)}y ago`}var as={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function Re(e){return as[e]}function Yt(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function rt(e){let t=0,s=0,r=0;for(let i of e){let d=i.state.toUpperCase();d==="SUCCESS"||d==="PASS"||d==="PASSED"?t++:d==="FAILURE"||d==="FAILED"||d==="ERROR"||d==="CANCELLED"?s++:r++}return{pass:t,fail:s,pending:r}}var ts={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function Qt(e){return ts[e.toUpperCase()]??"pending"}function st(e){return{label:Re(e),className:`prm-status-pill--${e}`}}var Ge=4,Ve=6,ba=3,Ia=5;function da(e){if(!e)return"";let t=Math.max(0,Date.now()-e),s=Math.floor(t/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function ua(e,t){let s=t==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function ca(e){let t=e.name||e.login,s=t.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():t.slice(0,2).toUpperCase()}var os=new Set(["fail","failure"]),rs=new Set(["pending","in_progress","queued"]);function ss(e){return(e??"").toLowerCase().trim()||"pending"}function ns(e,t){if(!t||t.length===0)return!1;let s=(e??"").toLowerCase();return t.some(r=>{let i=(r??"").toLowerCase();return i.length>0&&s.includes(i)})}function ka(e,t={}){if(!e||e.length===0)return!1;let s=t.ignoredFailingChecks;for(let r of e){let i=ss(r.bucket||r.state);if(rs.has(i)||os.has(i)&&!ns(r.name,s))return!1}return!0}function Aa(e){let{status:t,buildHappy:s,reviewApproved:r,sfciGated:i,hasSfciJob:d,elapsedHours:l,warnHours:c,dangerHours:b}=e;if(t==="integrating"||t==="closed-merged"||t==="closed-abandoned")return"done";let f=i&&!d;return s&&r&&t==="yellow"?f?"blocked":l>=b?"merge-stall":l>=c?"warn":"ok":s?"done":f?"blocked":l>=b?"danger":l>=c?"warn":"ok"}function nt(e){let{reviewApproved:t,merged:s,elapsedDays:r,warnDays:i,dangerDays:d}=e;return t&&!s?"done":r>=d?"danger":r>=i?"warn":"ok"}function ls(e){if(typeof document>"u")return!1;let t=document.createElement("textarea");t.value=e,t.style.position="fixed",t.style.top="-9999px",t.setAttribute("readonly",""),document.body.appendChild(t);try{return t.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(t)}}async function Ra(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return ls(e)}var is=Symbol.for("react.portal");function fa(e,t){return{$$typeof:is,key:null,children:e,containerInfo:t,implementation:null}}var lt=4,it=8,eo=120,ds=320,us=280;function cs(e,t){let s=t.innerHeight-e.bottom-lt-it,r=e.top-lt-it,i=s<eo&&r>s,d=Math.max(eo,Math.min(ds,i?r:s)),l=Math.max(it,Math.min(e.left,t.innerWidth-us-it));return i?{left:l,bottom:t.innerHeight-e.top+lt,maxHeight:d}:{left:l,top:e.bottom+lt,maxHeight:d}}function dt({projectId:e,projects:t,onAssign:s}){let r=Ce(null),[i,d]=u(!1),[l,c]=u(null),b=t.find(h=>h.id===e),f=!!b;q(()=>{if(!i)return;let h=r.current;h&&c(cs(h.getBoundingClientRect(),window))},[i]),q(()=>{if(!i)return;let h=y=>{y.key==="Escape"&&d(!1)};return window.addEventListener("keydown",h),()=>window.removeEventListener("keydown",h)},[i]);let C=f?`Associated with ${b.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return o(ee,{children:[o("button",{ref:r,type:"button",className:`prm-project-row ${f?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:C,"aria-label":C,onClick:h=>{h.stopPropagation(),d(y=>!y)},children:[a(Ua,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:f?b.name:"Not associated with a project"})]}),i&&l&&typeof document<"u"&&fa(o(ee,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:h=>{h.stopPropagation(),d(!1)}}),o("div",{className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...l},role:"menu",children:[t.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),f&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:h=>{h.stopPropagation(),s(null),d(!1)},children:"Clear association"}),t.map(h=>a("button",{type:"button",className:`prm-project-menu-item ${h.id===e?"is-active":""}`,role:"menuitem",onClick:y=>{y.stopPropagation(),s(h.id),d(!1)},children:h.name},h.id))]})]}),document.body)]})}function ut({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(t=>{let s=Qt(t.state);return o("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:t.name}),t.bucket&&a("span",{className:"prm-check-bucket",children:t.bucket}),a("span",{className:"prm-check-state",title:t.state,children:t.state.toLowerCase()})]},`${t.bucket??""}/${t.name}`)})})}function ao(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}var fs=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],ps=["seen","favorite","mute","dismiss"];function to({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:d,reviewDangerDays:l,sfciGated:c=!1,ignoredFailingChecks:b,workItemLocatorBase:f,selected:C,onToggleSelect:h,onDismiss:y,onProjectAssign:v}){let[k,x]=u(!1),[m,M]=u(!1),P=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),N=e.workItem??ia(e.title,e.headRefName,e.body),B=ot(N,f),T=st(e.status),ae=e.status==="closed-merged"||e.status==="closed-abandoned",_=!!e.muted,H=!!e.favorite,Z=!!e.syncError,S=e.checks??[],O=rt(S),j=e.reviewDecision==="APPROVED",J=e.buildHappy??ka(S,{ignoredFailingChecks:b}),w=Aa({status:e.status,buildHappy:J,reviewApproved:j,sfciGated:c,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??Ge,dangerHours:i??Ve}),ue=da(e.lastStatusChange),se=w==="merge-stall"||w==="danger"?"danger":w==="warn"?"warn":"ok",ie=w==="done"?"Build \u2713":w==="merge-stall"?"Merge stalled":ua(se,"build"),F=w==="done"?"done":se,ve=!e.isDraft&&!ae,R=e.status==="closed-merged",E=nt({reviewApproved:j,merged:R,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:d??ba,dangerDays:l??Ia}),D=da(e.reviewClockStartedAt),W=E==="danger"?"danger":E==="warn"?"warn":"ok",oe=E==="done"?"Review \u2713":ua(W,"review"),ye=E==="done"?"done":W,ne=e.reviewers??[],pe={"changes-requested":ne.filter(n=>n.state==="changes-requested"),"review-requested":ne.filter(n=>n.state==="review-requested"),approved:ne.filter(n=>n.state==="approved")},je=ne.length>0,pa=()=>{ao(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ma=e.isDraft?$e:e.status==="closed-merged"?Qe:e.status==="closed-abandoned"?ea:xe,Fe=n=>{n?.ok&&n.prs&&(t.cache.set(X,n.prs),t.cache.set(de,n.prs.length),t.cache.refreshBadge())},he=async()=>{if(P){let n=await t.call("markPrAsSeen",{url:e.url});Fe(n)}},oa=async()=>{let n=P?"markPrAsSeen":"markPrAsUnseen",A=await t.call(n,{url:e.url});Fe(A)},V=async()=>{let n=await t.call("setPrMuted",{url:e.url,muted:!_});Fe(n)},Le=async()=>{let n=await t.call("setPrFavorite",{url:e.url,favorite:!H});Fe(n)},ce=async n=>{n.stopPropagation(),M(!0);try{let A=await t.call("retryPr",{url:e.url});Fe(A)}finally{M(!1)}},be=async(n,A)=>{await Ra(n)?t.toast(`${A} copied`,"info"):t.toast(`Failed to copy ${A}`,"error")},Y=S.length>0,re=Y?` \u2014 click to ${k?"hide":"show"} checks`:"",g=n=>{n.stopPropagation(),x(A=>!A)},I=n=>{(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),g(n))},L=n=>Y?{role:"button",tabIndex:0,"aria-expanded":k,title:n,"data-tip":n,onClick:g,onKeyDown:I}:{},U=Y?" prm-tip prm-checks-trigger":"",te=`${T.label} \u2014 overall PR status${re}`,Pe=`${O.pass} passing, ${O.fail} failing, ${O.pending} running`,Ie=w==="done"?"Build passing":w==="merge-stall"?"Merge stalled":w==="blocked"?"Build waiting (SFCI job not yet created)":ie||"Build running",Ee=`${Ie} \xB7 ${ue} in build phase \xB7 ${Pe}${re}`,Ca=E==="done"?"Review approved":oe||"Awaiting review",ke=`${Ca} \xB7 ${D} in review${re}`,Sa=`${Pe}${re}`,Ht={seen:{Icon:P?We:aa,label:P?"Mark read":"Mark unread",title:P?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:_e,label:H?"Unfavorite":"Favorite",title:H?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:H},mute:{Icon:_?Je:Me,label:_?"Unmute":"Mute",title:_?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:fe,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},gt=n=>{n==="seen"?oa():n==="favorite"?Le():n==="mute"?V():y(e.url)};return o("div",{className:`prm-tile ${P?"prm-tile--unread":""} ${ae?"prm-tile--closed":""} ${Z?"prm-tile--stale":""} ${H?"prm-tile--favorite":""} ${C?"prm-tile--selected":""}`,onClick:he,role:"button",tabIndex:0,onKeyDown:n=>{(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),he())},children:[o("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:C,title:C?"Deselect this PR":"Select this PR","aria-label":C?"Deselect this PR":"Select this PR",onClick:n=>n.stopPropagation(),onChange:n=>{n.stopPropagation(),h(e.url)}}),a(ma,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),o("span",{className:"prm-tile-title",children:[N&&o("span",{className:"prm-tile-workitem-inline",children:["@",N,": "]}),e.title.replace(new RegExp(`(?:^|@)${N}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${T.className} prm-tip${U}`,title:te,"data-tip":te,...L(te),children:T.label}),Y?o("span",{className:`prm-tis prm-tis--${F} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":k,title:Ee,"data-tip":Ee,"aria-label":`${Ie}, ${ue} in build phase`,onClick:g,onKeyDown:I,children:[ue,ie&&o("span",{className:"prm-tis-cue",children:[" ",ie]})]}):o("span",{className:`prm-tis prm-tis--${F} prm-tip`,title:Ee,"data-tip":Ee,"aria-label":`${Ie}, ${ue} in build phase`,children:[ue,ie&&o("span",{className:"prm-tis-cue",children:[" ",ie]})]}),ve&&(D||oe)&&(Y?o("span",{className:`prm-tis prm-tis--review prm-tis--${ye} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":k,title:ke,"data-tip":ke,"aria-label":`${Ca}, ${D} in review`,onClick:g,onKeyDown:I,children:[D,oe&&o("span",{className:"prm-tis-cue",children:[" ",oe]})]}):o("span",{className:`prm-tis prm-tis--review prm-tis--${ye} prm-tip`,title:ke,"data-tip":ke,"aria-label":`${Ca}, ${D} in review`,children:[D,oe&&o("span",{className:"prm-tis-cue",children:[" ",oe]})]})),S.length>0&&o("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${O.pass} passed, ${O.fail} failed, ${O.pending} running`,...L(Sa),children:[O.pass>0&&o("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(He,{size:9})," ",O.pass]}),O.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(Se,{size:9})," ",O.fail]}),O.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(Ne,{size:9})," ",O.pending]})]}),_&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(Je,{size:11})}),Z&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(Te,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:m,onClick:n=>void ce(n),children:a(Ae,{size:10,className:m?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:ps.map(n=>{let A=Ht[n],z=A.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${A.danger?" prm-tile-icon-btn--danger":""}${A.active?" prm-tile-icon-btn--active":""}`,title:A.title,"data-tip":A.label,"aria-label":A.label,"aria-pressed":A.active,onClick:le=>{le.stopPropagation(),gt(n)},children:a(z,{size:13,...A.active?{fill:"currentColor"}:{}})},n)})})]}),o("div",{className:"prm-tile-line2",children:[N&&(B?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${N}`,onClick:n=>{n.stopPropagation(),ao(B)&&t.openExternal(B)},children:N}):a("span",{className:"prm-workitem-chip",children:N})),a("span",{className:"prm-tile-repo",children:e.repo}),o("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:n=>{n.stopPropagation(),pa()},children:a(Oe,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:n=>{n.stopPropagation(),be(e.url,"PR link")},children:a(Ue,{size:10})})]}),e.author&&o("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ca(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-tile-line3",children:[a(qe,{size:10,className:"prm-branch-icon","aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:n=>{n.stopPropagation(),be(e.headRefName,"Branch name")},children:a(Ue,{size:10})})]}),je&&a("div",{className:"prm-reviewers",children:fs.map(({state:n,label:A,className:z})=>{let le=pe[n];return le.length===0?null:o("span",{className:`prm-reviewers-group ${z}`,title:A,children:[a("span",{className:"prm-reviewers-label",children:A}),le.map(me=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:me.name||me.login,"aria-label":`${A}: ${me.name||me.login}`,children:ca(me)},me.login))]},n)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(dt,{projectId:e.projectId,projects:s,onAssign:n=>v(e.url,n)}),k&&S.length>0&&a("div",{className:"prm-tile-checks",onClick:n=>n.stopPropagation(),children:a(ut,{checks:S})})]})}function oo({anchorRef:e,hosts:t,selectedHosts:s,onClose:r,onToggleHost:i,onSelectAll:d,shortHost:l}){let[c,b]=u(null);if(q(()=>{let C=e.current;if(!C)return;let h=C.getBoundingClientRect();b({top:h.bottom+4,left:h.left})},[e]),q(()=>{let C=h=>{h.key==="Escape"&&r()};return window.addEventListener("keydown",C),()=>window.removeEventListener("keydown",C)},[r]),!c||typeof document>"u")return null;let f=s.length===0;return fa(o(ee,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:C=>{C.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-host-filter",style:{position:"fixed",top:c.top,left:c.left},role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),o("button",{type:"button",className:`prm-project-menu-item ${f?"is-active":""}`,role:"menuitemcheckbox","aria-checked":f,onClick:C=>{C.stopPropagation(),d()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:f&&a(He,{size:12})}),"All hosts"]}),t.map(C=>{let h=s.includes(C);return o("button",{type:"button",className:`prm-project-menu-item ${h?"is-active":""}`,role:"menuitemcheckbox","aria-checked":h,onClick:y=>{y.stopPropagation(),i(C)},title:`Filter to ${C}`,children:[a("span",{className:"prm-sync-filter-check",children:h&&a(He,{size:12})}),l(C)]},C)})]})]}),document.body)}var ms='button, a, input, textarea, select, [contenteditable="true"]';function ro(e){return!e||typeof e.closest!="function"?!1:e.closest(ms)!==null}function so(e,t,s){return{left:e.left-(t-e.x),top:e.top-(s-e.y)}}function vt(){let e=Ce(null),[t,s]=u(!1),r=K(l=>{let c=e.current;!c||c.id!==l.pointerId||(e.current=null,s(!1),l.currentTarget.hasPointerCapture(l.pointerId)&&l.currentTarget.releasePointerCapture(l.pointerId))},[]),i=K(l=>{l.button!==0||ro(l.target)||(e.current={id:l.pointerId,x:l.clientX,y:l.clientY,left:l.currentTarget.scrollLeft,top:l.currentTarget.scrollTop},l.currentTarget.setPointerCapture(l.pointerId),s(!0))},[]),d=K(l=>{let c=e.current;if(!c||c.id!==l.pointerId)return;let b=so(c,l.clientX,l.clientY);l.currentTarget.scrollLeft=b.left,l.currentTarget.scrollTop=b.top},[]);return{isPanning:t,canvasPanProps:{onPointerDown:i,onPointerMove:d,onPointerUp:r,onPointerCancel:r}}}var Pt=`.zcc-kanban {
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
`;function xs(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function no({children:e,className:t="",label:s,columnWidth:r}){let{isPanning:i,canvasPanProps:d}=vt();return a("div",{role:"list","aria-label":s,className:["zcc-kanban",i?"is-panning":"",t].filter(Boolean).join(" "),style:xs(r),...d,children:e})}function lo({children:e,className:t="",columnId:s,label:r,count:i,icon:d,badge:l,collapsed:c=!1,onToggleCollapse:b}){let f=c?`Expand ${r}`:`Collapse ${r}`;return o("section",{role:"listitem",className:["zcc-kanban-col",c?"is-collapsed":"",t].filter(Boolean).join(" "),"aria-label":`${r} (${i})`,"data-kanban-column":s,"data-board-column":s,"data-collapsed":c?"true":"false",children:[o("header",{className:"zcc-kanban-col-header",children:[d?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:d}):null,a("span",{className:"zcc-kanban-col-title",children:r}),a("span",{className:"zcc-kanban-col-count",children:i}),l,b?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:f,"aria-label":f,"aria-expanded":!c,onClick:()=>b(s),children:c?a(Ye,{size:13}):a(na,{size:13})}):null]}),c?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}var kt=["conflict","failed","yellow","review-required","pending","integrating","green"],io=["closed-merged","closed-abandoned"],uo={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function At(e){return e==="list"||e==="board"}function hs(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function ct(e){let t=hs();for(let s of e)t[s.status].push(s);return t}function co(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var fo=[...kt,...io];function po(e){return typeof e=="string"&&fo.includes(e)}function mo(e,t={}){let s=co(e);return t.showEmpty?[...kt,...io.filter(r=>s[r]>0)]:fo.filter(r=>s[r]>0)}function go(e){let t=co(e);return kt.filter(s=>t[s]===0).length}function xo(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function Ls(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function bs(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function ho({pr:e,host:t,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:i,selected:d,selectionActive:l=!1,selectMode:c=!1,onToggleSelect:b,onDismiss:f,onOpen:C}){let[h,y]=u(!1),v=bs(e),k=e.status==="closed-merged"||e.status==="closed-abandoned",x=!!e.favorite,m=!!e.syncError,M=e.workItem??ia(e.title,e.headRefName,e.body),P=M?e.title.replace(new RegExp(`(?:^|@)${M}[:\\s]*`,"i"),""):e.title,N=e.checks??[],B=rt(N),T=e.updatedAt||e.lastChecked||e.lastStatusChange,ae=e.buildHappy??ka(N,{ignoredFailingChecks:i}),_=Aa({status:e.status,buildHappy:ae,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??Ge,dangerHours:r??Ve}),H=_==="merge-stall"?"Merge stalled":_==="warn"||_==="danger"?ua(_,"build"):"",Z=_==="merge-stall"||_==="danger"?"danger":_==="warn"?"warn":"",S=d||c||l,O=F=>{F?.ok&&F.prs&&(t.cache.set(X,F.prs),t.cache.set(de,F.prs.length),t.cache.refreshBadge())},j=async()=>{if(!v)return;let F=await t.call("markPrAsSeen",{url:e.url});O(F)},J=async()=>{let F=await t.call("setPrFavorite",{url:e.url,favorite:!x});O(F)},w=()=>{Ls(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},ue=async()=>{y(!0);try{let F=await t.call("retryPr",{url:e.url});O(F)}finally{y(!1)}},se=()=>{C(e.url),j()},ie=F=>{if(F.metaKey||F.ctrlKey||c){b(e.url);return}se()};return o("article",{className:["prm-board-card",v?"prm-board-card--unread":"",k?"prm-board-card--closed":"",x?"prm-board-card--favorite":"",d?"prm-board-card--selected":"",m?"prm-board-card--stale":"",S?"prm-board-card--selectable":"",c?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:ie,onKeyDown:F=>{(F.key==="Enter"||F.key===" ")&&(F.preventDefault(),c?b(e.url):se())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[o("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:d,title:d?"Deselect this PR":"Select this PR","aria-label":d?"Deselect this PR":"Select this PR",onClick:F=>F.stopPropagation(),onChange:F=>{F.stopPropagation(),b(e.url)}}),o("span",{className:"prm-board-card-id",children:[o("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",children:xo(e.repo)})]}),M&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:M}),o("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${x?" prm-tile-icon-btn--active":""}`,title:x?"Unfavorite":"Favorite","data-tip":x?"Unfavorite":"Favorite","aria-label":x?"Unfavorite":"Favorite","aria-pressed":x,onClick:F=>{F.stopPropagation(),J()},children:a(_e,{size:12,...x?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:F=>{F.stopPropagation(),w()},children:a(Oe,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:F=>{F.stopPropagation(),f(e.url)},children:a(fe,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:P}),o("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:ca(e.author)}),H?o("span",{className:`prm-tis prm-tis--${Z} prm-board-card-stall`,children:[da(e.lastStatusChange)," ",H]}):T>0&&a("span",{className:"prm-board-card-time",children:ze(T)}),B.fail>0&&o("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${B.fail} checks failing`,children:[a(Se,{size:9})," ",B.fail]}),B.pending>0&&o("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${B.pending} checks running`,children:[a(Ne,{size:9})," ",B.pending]}),e.isDraft&&o("span",{className:"prm-draft-pill prm-board-card-draft",children:[a($e,{size:10,"aria-hidden":!0})," Draft"]}),m&&o("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(Te,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:h,onClick:F=>{F.stopPropagation(),ue()},children:a(Ae,{size:10,className:h?"prm-spin":""})})]})]})]})}var Is={conflict:Va,failed:we,yellow:Xe,"review-required":qa,pending:Fa,integrating:G,green:ge,"closed-merged":Qe,"closed-abandoned":ea};function Lo({prs:e,host:t,tisWarnHours:s,tisDangerHours:r,repositories:i,selected:d,selectMode:l=!1,showEmpty:c=!1,collapsed:b,onToggleCollapse:f,onToggleSelect:C,onDismiss:h,onOpen:y}){let v=Q(()=>ct(e),[e]),k=Q(()=>mo(v,{showEmpty:c}),[v,c]),x=d.size>0||l;return a(no,{label:"Pull requests by status",columnWidth:260,className:"prm-board",children:k.map(m=>{let M=v[m],P=Is[m],N=b.has(m),B=M.filter(T=>T.lastSeenAt===0||T.lastStatusChange>(T.lastSeenAt??T.addedAt)).length;return a(lo,{columnId:m,className:`prm-board-col--${m}`,label:uo[m],count:M.length,icon:a(P,{size:14,"aria-hidden":!0}),badge:B>0?a("span",{className:"zcc-kanban-col-badge",title:`${B} unread`,children:B}):null,collapsed:N,onToggleCollapse:T=>f(T),children:M.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):M.map(T=>{let ae=Za(T.repo,i,s??Ge,r??Ve),_=(i??[]).find(H=>`${H.owner}/${H.repo}`.toLowerCase()===T.repo.toLowerCase());return a(ho,{pr:T,host:t,tisWarnHours:ae.warnHours,tisDangerHours:ae.dangerHours,ignoredFailingChecks:_?.ignoredFailingChecks,selected:d.has(T.url),selectionActive:x,selectMode:l,onToggleSelect:C,onDismiss:h,onOpen:y},T.url)})},m)})})}var Cs=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function bo(e){try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}function Ss(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function Io({pr:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:d,reviewDangerDays:l,sfciGated:c=!1,ignoredFailingChecks:b,workItemLocatorBase:f,onClose:C,onDismiss:h,onProjectAssign:y}){let[v,k]=u(!1);q(()=>{let V=Le=>{Le.key==="Escape"&&C()};return window.addEventListener("keydown",V),()=>window.removeEventListener("keydown",V)},[C]);let x=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),m=e.status==="closed-merged"||e.status==="closed-abandoned",M=!!e.muted,P=!!e.favorite,N=!!e.syncError,B=e.workItem??ia(e.title,e.headRefName,e.body),T=ot(B,f),ae=B?e.title.replace(new RegExp(`(?:^|@)${B}[:\\s]*`,"i"),""):e.title,_=st(e.status),H=e.checks??[],Z=e.reviewers??[],S={"changes-requested":Z.filter(V=>V.state==="changes-requested"),"review-requested":Z.filter(V=>V.state==="review-requested"),approved:Z.filter(V=>V.state==="approved")},O=Ss(e),j=e.reviewDecision==="APPROVED",J=e.buildHappy??ka(H,{ignoredFailingChecks:b}),w=Aa({status:e.status,buildHappy:J,reviewApproved:j,sfciGated:c,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??Ge,dangerHours:i??Ve}),ue=da(e.lastStatusChange),se=w==="merge-stall"||w==="danger"?"danger":w==="warn"?"warn":"ok",ie=w==="done"?"Build \u2713":w==="merge-stall"?"Merge stalled":ua(se,"build"),F=w==="done"?"done":se,ve=!e.isDraft&&!m,R=nt({reviewApproved:j,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:d??ba,dangerDays:l??Ia}),E=da(e.reviewClockStartedAt),D=R==="danger"?"danger":R==="warn"?"warn":"ok",W=R==="done"?"Review \u2713":ua(D,"review"),oe=R==="done"?"done":D,ye=e.isDraft?$e:e.status==="closed-merged"?Qe:e.status==="closed-abandoned"?ea:xe,ne=V=>{V?.ok&&V.prs&&(t.cache.set(X,V.prs),t.cache.set(de,V.prs.length),t.cache.refreshBadge())},pe=()=>{bo(e.url)?t.openExternal(e.url):t.toast("Refusing to open a non-http(s) URL","error")},je=async(V,Le)=>{await Ra(V)?t.toast(`${Le} copied`,"info"):t.toast(`Failed to copy ${Le}`,"error")},pa=async()=>{let V=x?"markPrAsSeen":"markPrAsUnseen";ne(await t.call(V,{url:e.url}))},ma=async()=>{ne(await t.call("setPrMuted",{url:e.url,muted:!M}))},Fe=async()=>{ne(await t.call("setPrFavorite",{url:e.url,favorite:!P}))},he=async()=>{k(!0);try{ne(await t.call("retryPr",{url:e.url}))}finally{k(!1)}},oa=a("div",{className:"modal-backdrop",onClick:C,"data-testid":"prm-detail-backdrop",children:o("div",{className:"modal prm-modal prm-modal--detail",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-detail-title",onClick:V=>V.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:"prm-detail-title",children:[a(ye,{size:14,"aria-hidden":!0}),o("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:C,title:"Close",children:a(Se,{size:14})})]}),o("div",{className:"prm-modal-body prm-detail-body",children:[o("div",{className:"prm-detail-heading",children:[B&&(T?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${B}`,onClick:()=>{bo(T)&&t.openExternal(T)},children:B}):a("span",{className:"prm-workitem-chip",children:B})),a("h4",{className:"prm-detail-pr-title",children:ae})]}),o("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${_.className}`,children:_.label}),e.isDraft&&o("span",{className:"prm-draft-pill",children:[a($e,{size:10,"aria-hidden":!0})," Draft"]}),M&&o("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(Je,{size:11,"aria-hidden":!0})," Muted"]}),ue&&o("span",{className:`prm-tis prm-tis--${F}`,children:[ue,ie&&o("span",{className:"prm-tis-cue",children:[" ",ie]})]}),ve&&(E||W)&&o("span",{className:`prm-tis prm-tis--review prm-tis--${oe}`,children:[E,W&&o("span",{className:"prm-tis-cue",children:[" ",W]})]})]}),O&&a("div",{className:"prm-detail-hint",children:O}),o("dl",{className:"prm-detail-facts",children:[e.author&&o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),o("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:ca(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:ze(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:ze(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?o("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:ze(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Branches"}),o("div",{className:"prm-detail-branch",children:[a(qe,{size:12,"aria-hidden":!0}),o("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>void je(e.headRefName,"Branch name"),children:a(Ue,{size:10})})]})]}),e.body&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Description"}),a("div",{className:"prm-detail-desc",children:e.body})]}),Z.length>0&&o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:Cs.map(({state:V,label:Le,className:ce})=>{let be=S[V];return be.length===0?null:o("span",{className:`prm-reviewers-group ${ce}`,title:Le,children:[a("span",{className:"prm-reviewers-label",children:Le}),be.map(Y=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:Y.name||Y.login,"aria-label":`${Le}: ${Y.name||Y.login}`,children:ca(Y)},Y.login))]},V)})})]}),o("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Checks"}),a(ut,{checks:H})]}),N&&o("div",{className:"prm-detail-sync-error",children:[a(Te,{size:12,"aria-hidden":!0}),o("span",{children:["Couldn't sync this PR: ",e.syncError]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:v,"aria-label":"Retry syncing this PR",onClick:()=>void he(),children:[a(Ae,{size:11,className:v?"prm-spin":""})," Retry"]})]}),a("div",{className:"prm-detail-section",children:a(dt,{projectId:e.projectId,projects:s,onAssign:V=>y(e.url,V)})})]}),o("footer",{className:"prm-modal-footer prm-detail-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:pe,title:"Open on GitHub",children:[a(Oe,{size:13}),a("span",{children:"Open on GitHub"})]}),o("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>void je(e.url,"PR link"),children:[a(Ue,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${P?" prm-tile-icon-btn--active":""}`,title:P?"Unfavorite":"Favorite","data-tip":P?"Unfavorite":"Favorite","aria-label":P?"Unfavorite":"Favorite","aria-pressed":P,onClick:()=>void Fe(),children:a(_e,{size:13,...P?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:M?"Unmute":"Mute","data-tip":M?"Unmute":"Mute","aria-label":M?"Unmute":"Mute",onClick:()=>void ma(),children:M?a(Je,{size:13}):a(Me,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:x?"Mark this PR as read":"Mark this PR as unread","data-tip":x?"Mark read":"Mark unread","aria-label":x?"Mark read":"Mark unread",onClick:()=>void pa(),children:x?a(We,{size:13}):a(aa,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>h(e.url),children:a(fe,{size:13})})]})]})});return typeof document<"u"?fa(oa,document.body):oa}var ys=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],yo=["closed-merged","closed-abandoned"],ws=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function vs(e,t){let s=e.favorite?1:0,r=t.favorite?1:0;return s!==r?r-s:t.lastStatusChange-e.lastStatusChange}function ft(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function Ps(e,t){return e.length>0&&e.every(r=>{let i=t.find(d=>d.url===r);return i?!!i.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function ks(e){let t=e.lastIndexOf("/");return t>=0?e.slice(t+1):e}function As(e){let t=e.workItem??ia(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),Re(e.status),e.headRefName??"",e.baseRefName??"",t,e.repo,ks(e.repo)].join("").toLowerCase()}var Co="boardShowEmpty",So="boardCollapsed";function wo({prs:e,host:t,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:d,reviewDangerDays:l,repositories:c,workItemLocatorBase:b,sortField:f,sortDir:C,onSortChange:h,hostScope:y,onHostScopeChange:v,awaitingFirstSync:k,syncing:x,autoSyncEnabled:m,onDismiss:M,onProjectAssign:P,onBulkSetSeen:N,onBulkDismiss:B,onBulkSetFavorite:T,viewMode:ae="list",onViewModeChange:_}){let[H,Z]=u("all"),[S,O]=u(""),[j,J]=u(new Set),[w,ue]=u(!1),[se,ie]=u(ae),[F,ve]=u(!1),[R,E]=u(!1),[D,W]=u(()=>new Set),[oe,ye]=u(null),ne=Ce(null),pe=_?ae:se,je=n=>{n==="board"&&Z("all"),n==="list"&&ve(!1),_?_(n):ie(n)};q(()=>{let n=!0;return t.storage.get(Co).then(A=>{n&&typeof A=="boolean"&&E(A)}),t.storage.get(So).then(A=>{!n||!Array.isArray(A)||W(new Set(A.filter(po)))}),()=>{n=!1}},[t]);let pa=n=>{E(n),t.storage.set(Co,n)},ma=n=>{W(A=>{let z=new Set(A);return z.has(n)?z.delete(n):z.add(n),t.storage.set(So,[...z]),z})},Fe=Q(()=>{let n=[];for(let A of e){let z=St(A.url);n.includes(z)||n.push(z)}return n},[e]),he=Q(()=>{if(y.length===0)return e;let n=new Set(y);return e.filter(A=>n.has(St(A.url)))},[e,y]),oa=Q(()=>{let n=new Map;for(let A of he)n.set(A.status,(n.get(A.status)??0)+1);return n},[he]),V=Q(()=>H==="all"?he:he.filter(n=>n.status===H),[he,H]),Le=Q(()=>{let n=S.trim().toLowerCase();return n?V.filter(A=>As(A).includes(n)):V},[V,S]),ce=Q(()=>{let n=C==="asc"?1:-1,A=[...Le];return f==="favorites"?(A.sort(vs),A):(A.sort((z,le)=>{let me=0;switch(f){case"created":me=(z.createdAt??0)-(le.createdAt??0);break;case"status":me=wt(z.status)-wt(le.status);break;case"statusUpdated":me=z.lastStatusChange-le.lastStatusChange;break;case"updated":default:me=(z.updatedAt||z.lastChecked||z.lastStatusChange)-(le.updatedAt||le.lastChecked||le.lastStatusChange);break}if(me===0){let Ot=ft(z)?1:0,qt=ft(le)?1:0;return Ot!==qt?qt-Ot:(le.createdAt??0)-(z.createdAt??0)}return me*n}),A)},[Le,f,C]),be=Q(()=>go(ct(ce)),[ce]),Y=oe?e.find(n=>n.url===oe):void 0;q(()=>{oe&&!Y&&ye(null)},[oe,Y]);let re=Q(()=>{if(!Y)return null;let n=Za(Y.repo,c,r??Ge,i??Ve),A=Lt(Y.repo,c,d??ba,l??Ia),z=(c??[]).find(le=>`${le.owner}/${le.repo}`.toLowerCase()===Y.repo.toLowerCase());return{tisWarnHours:n.warnHours,tisDangerHours:n.dangerHours,reviewWarnDays:A.warnDays,reviewDangerDays:A.dangerDays,sfciGated:z?.sfciGated===!0,ignoredFailingChecks:z?.ignoredFailingChecks}},[Y,c,r,i,d,l]),g=Q(()=>he.filter(ft).length,[he]),I=Q(()=>ce.map(n=>n.url),[ce]),L=Q(()=>I.filter(n=>j.has(n)),[I,j]),U=ce.length>0&&L.length===ce.length,te=L.length>0&&!U,Pe=n=>{J(A=>{let z=new Set(A);return z.has(n)?z.delete(n):z.add(n),z})},Ie=()=>{J(U||te?new Set:new Set(I))},Ee=()=>J(new Set),Ca=L.length>0?L:I,ke=Ca.every(n=>{let A=e.find(z=>z.url===n);return A?!ft(A):!0}),Sa=Ps(L,e);if(e.length===0){if(k){let n=x||m;return o("div",{className:"prm-empty",children:[n?a(G,{size:32,className:"prm-spin","aria-hidden":!0}):a(xe,{size:32,"aria-hidden":!0}),a("h3",{children:n?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:n?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return o("div",{className:"prm-empty",children:[a(xe,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let gt=o("div",{className:"prm-list-toolbar",children:[o("div",{className:"prm-list-controls",children:[o("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":pe==="list",title:"List view",onClick:()=>je("list"),children:[a(za,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),o("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":pe==="board",title:"Board view",onClick:()=>je("board"),children:[a(sa,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),pe==="list"&&a("label",{className:"prm-select-all",title:U?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:U,ref:n=>{n&&(n.indeterminate=te)},onChange:Ie,"aria-label":U?"Clear selection":"Select all shown PRs"})}),pe==="list"&&o("span",{className:"prm-shown-count","aria-live":"polite",children:[ce.length," shown"]}),o("div",{className:"prm-search",children:[a(Pa,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:S,onChange:n=>O(n.target.value),"aria-label":"Search PRs"})]}),o("button",{type:"button",ref:ne,className:`prm-btn prm-btn--sm ${y.length>0?"is-active":""}`,onClick:()=>ue(n=>!n),title:"Filter by host","aria-expanded":w,children:[a(_a,{size:12}),o("span",{children:["Host",y.length>0&&o("span",{className:"prm-unread-count",children:[" (",y.length,")"]})]}),a(ga,{size:12})]}),w&&a(oo,{anchorRef:ne,hosts:Fe,selectedHosts:y,onClose:()=>ue(!1),onToggleHost:n=>v(y.includes(n)?y.filter(A=>A!==n):[...y,n]),onSelectAll:()=>v([]),shortHost:Yt}),pe==="board"&&o(ee,{children:[o("button",{type:"button",className:`prm-btn prm-btn--sm ${F?"is-active":""}`,"aria-pressed":F,title:"Select cards for bulk actions",onClick:()=>ve(n=>!n),children:[a(la,{size:12}),a("span",{children:"Select"})]}),be>0&&o("button",{type:"button",className:`prm-btn prm-btn--sm ${R?"is-active":""}`,"aria-pressed":R,title:R?"Hide empty columns":`Show ${be} empty column${be===1?"":"s"}`,onClick:()=>pa(!R),children:[a(Oa,{size:12}),a("span",{children:R?"Hide empty":`Empty (${be})`})]})]}),pe==="list"&&o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>N(Ca,!ke),title:L.length>0?`Mark the ${L.length} selected PR(s) ${ke?"unread":"read"}`:`Mark all shown PRs ${ke?"unread":"read"}`,children:[a(We,{size:12}),o("span",{children:[ke?"Mark unread":"Mark read",g>0&&o("span",{className:"prm-unread-count",children:[" (",g,")"]})]})]}),pe==="list"&&o("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:f,onChange:n=>h(n.target.value,C),"aria-label":"Sort field",children:ws.map(n=>a("option",{value:n.id,title:n.title,children:n.label},n.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>h(f,C==="asc"?"desc":"asc"),disabled:f==="favorites",title:f==="favorites"?"Favorites first uses a fixed order":C==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":C==="asc"?"Sorted ascending":"Sorted descending",children:C==="asc"?a(Da,{size:12}):a(Ma,{size:12})})]})]}),pe==="list"&&o("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[o("button",{type:"button",role:"tab","aria-selected":H==="all",className:`prm-segment-tab ${H==="all"?"active":""}`,onClick:()=>Z("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:he.length})]}),ys.map(n=>{let A=oa.get(n)??0;return o("button",{type:"button",role:"tab","aria-selected":H===n,className:`prm-segment-tab prm-segment-tab--${n} ${H===n?"active":""}`,onClick:()=>Z(n),title:`Show PRs in "${Re(n)}"`,children:[Re(n)," ",a("span",{className:"prm-segment-count",children:A})]},n)})]}),L.length>0&&o("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:Ee,title:"Clear selection","aria-label":"Clear selection",children:a(Se,{size:12})}),o("span",{className:"prm-bulk-count",children:[L.length," selected"]}),o("div",{className:"prm-bulk-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>N(L,!ke),title:`Mark the selected PR(s) ${ke?"unread":"read"}`,children:[ke?a(aa,{size:12}):a(We,{size:12}),a("span",{children:ke?"Mark unread":"Mark read"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>T(L,Sa.favorite),title:`${Sa.label} the selected PR(s)`,children:[a(_e,{size:12,...Sa.favorite?{}:{fill:"currentColor"}}),a("span",{children:Sa.label})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{B(L),Ee()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(fe,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return o("div",{className:`prm-list${pe==="board"?" prm-list--board":""}`,children:[gt,ce.length===0?o("div",{className:"prm-empty prm-empty--filtered",children:[a(Pa,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:S.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),o("div",{className:"prm-empty-actions",children:[S.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>O(""),title:"Clear search",children:"Clear search"}),H!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>Z("all"),title:"Show all PRs",children:"Show all"})]})]}):pe==="board"?a(Lo,{prs:ce,host:t,tisWarnHours:r,tisDangerHours:i,repositories:c,selected:j,selectMode:F,showEmpty:R,collapsed:D,onToggleCollapse:ma,onToggleSelect:Pe,onDismiss:M,onOpen:ye}):a("div",{className:"prm-tile-list",children:ce.map(n=>{let A=Za(n.repo,c,r??Ge,i??Ve),z=Lt(n.repo,c,d??ba,l??Ia),le=(c??[]).find(me=>`${me.owner}/${me.repo}`.toLowerCase()===n.repo.toLowerCase());return a(to,{pr:n,host:t,projects:s,tisWarnHours:A.warnHours,tisDangerHours:A.dangerHours,reviewWarnDays:z.warnDays,reviewDangerDays:z.dangerDays,sfciGated:le?.sfciGated===!0,ignoredFailingChecks:le?.ignoredFailingChecks,workItemLocatorBase:b,selected:j.has(n.url),onToggleSelect:Pe,onDismiss:M,onProjectAssign:P},n.url)})}),Y&&re&&a(Io,{pr:Y,host:t,projects:s,tisWarnHours:re.tisWarnHours,tisDangerHours:re.tisDangerHours,reviewWarnDays:re.reviewWarnDays,reviewDangerDays:re.reviewDangerDays,sfciGated:re.sfciGated,ignoredFailingChecks:re.ignoredFailingChecks,workItemLocatorBase:b,onClose:()=>ye(null),onDismiss:n=>{ye(null),M(n)},onProjectAssign:P})]})}function vo({host:e,onClose:t,onPulled:s}){let[r,i]=u([]),[d,l]=u(!1),[c,b]=u(""),[f,C]=u(""),[h,y]=u(!1),[v,k]=u(null),x=Ce(null);q(()=>{let P=!0;return e.call("listRepos").then(N=>{if(!P)return;let B=(N?.repos??[]).filter(T=>T.active&&T.connection==="connected");i(B),B.length>0&&b(`${B[0].host}|${B[0].owner}/${B[0].repo}`),l(!0)}).catch(()=>{P&&l(!0)}),()=>{P=!1}},[e]),q(()=>{let P=N=>{N.key==="Escape"&&!h&&t()};return window.addEventListener("keydown",P),()=>window.removeEventListener("keydown",P)},[t,h]);let m=Q(()=>r.find(P=>`${P.host}|${P.owner}/${P.repo}`===c),[r,c]),M=async()=>{k(null);let P=Number(f.trim());if(!m){k("Select a repository.");return}if(!Number.isFinite(P)||P<=0){k("Enter a valid PR number.");return}y(!0);try{let N=await e.call("pullPr",{host:m.host,fullName:`${m.owner}/${m.repo}`,number:P});N?.ok&&Array.isArray(N.prs)?s(N.prs):k(N?.error||"Failed to pull PR.")}catch(N){k(N instanceof Error?N.message:String(N))}finally{y(!1)}};return a("div",{className:"modal-backdrop",onClick:()=>!h&&t(),children:o("div",{className:"modal prm-modal",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-pull-title",onClick:P=>P.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{id:"prm-pull-title",children:[a(xe,{size:14,"aria-hidden":!0})," Add PR"]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:t,title:"Close",children:a(Se,{size:14})})]}),o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),d&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):o("select",{className:"prm-input prm-input--select",value:c,onChange:P=>b(P.target.value),disabled:h||!d,"aria-label":"Repository",children:[!d&&a("option",{children:"Loading\u2026"}),r.map(P=>{let N=`${P.host}|${P.owner}/${P.repo}`;return o("option",{value:N,children:[P.owner,"/",P.repo," (",P.shortHost,")"]},N)})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{ref:x,type:"number",min:1,value:f,placeholder:"e.g. 42",className:"prm-input",onChange:P=>{C(P.target.value),v&&k(null)},onKeyDown:P=>{P.key==="Enter"&&!h&&(P.preventDefault(),M())},disabled:h||r.length===0})]}),v&&a("div",{className:"prm-modal-error",children:v})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void M(),disabled:h||r.length===0||!f.trim(),title:"Add this PR to the monitored list",children:[h?a(G,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:h,title:"Cancel without adding",children:"Cancel"})]})]})})}function Po({anchorRef:e,host:t,selectedRepos:s,onClose:r,onToggleRepo:i,onSelectAll:d,onSync:l}){let[c,b]=u(null),[f,C]=u([]);if(q(()=>{let y=e.current;if(!y)return;let v=y.getBoundingClientRect();b({top:v.bottom+4,left:v.right})},[e]),q(()=>{let y=!0;return t.call("listRepos").then(v=>{y&&C((v?.repos??[]).filter(k=>k.active&&k.connection==="connected"))}).catch(()=>{}),()=>{y=!1}},[t]),q(()=>{let y=v=>{v.key==="Escape"&&r()};return window.addEventListener("keydown",y),()=>window.removeEventListener("keydown",y)},[r]),!c||typeof document>"u")return null;let h=s.length===0;return fa(o(ee,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:y=>{y.stopPropagation(),r()}}),o("div",{className:"prm-tile-menu prm-sync-filter",style:{position:"fixed",top:c.top,left:c.left,transform:"translateX(-100%)"},role:"menu",children:[o("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),o("button",{type:"button",className:`prm-project-menu-item ${h?"is-active":""}`,role:"menuitemcheckbox","aria-checked":h,onClick:y=>{y.stopPropagation(),d()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:h&&a(He,{size:12})}),"All repositories"]}),f.map(y=>{let v=`${y.owner}/${y.repo}`,k=s.includes(v);return o("button",{type:"button",className:`prm-project-menu-item ${k?"is-active":""}`,role:"menuitemcheckbox","aria-checked":k,onClick:x=>{x.stopPropagation(),i(v)},title:`Filter/sync ${v}`,children:[a("span",{className:"prm-sync-filter-check",children:k&&a(He,{size:12})}),v," ",o("span",{className:"prm-sync-filter-host",children:["(",y.shortHost,")"]})]},`${y.host}|${v}`)}),a("div",{className:"prm-tile-menu-divider"}),o("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{l(s),r()},title:h?"Sync all repositories now":"Sync the selected repositories now",children:h?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Ze({title:e,subtitle:t,actions:s}){return o("header",{className:"prm-area-header",children:[o("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:t})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function pt({state:e}){return e==="checking"?o("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(G,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(ge,{size:11})," Connected"]}):o("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(we,{size:11})," Disconnected"]})}function ta({title:e,icon:t,onClose:s,busy:r,footer:i,children:d,wide:l}){return q(()=>{let c=b=>{b.key==="Escape"&&!r&&s()};return window.addEventListener("keydown",c),()=>window.removeEventListener("keydown",c)},[s,r]),a("div",{className:"modal-backdrop",onClick:()=>!r&&s(),children:o("div",{className:`modal prm-modal${l?" prm-modal--wide":""}`,role:"dialog","aria-modal":!0,onClick:c=>c.stopPropagation(),children:[o("header",{className:"prm-modal-header",children:[o("h3",{children:[t," ",e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close",children:a(Se,{size:14})})]}),d]})})}function mt({title:e,message:t,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:i,busy:d,onConfirm:l,onCancel:c}){return o(ta,{title:e,onClose:c,busy:d,children:[a("div",{className:"prm-modal-body",children:t}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:c,disabled:d,children:r}),o("button",{type:"button",className:`prm-btn ${i?"prm-btn--danger":"prm-btn--primary"}`,onClick:l,disabled:d,children:[d?a(G,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function ko({host:e}){let[t,s]=u(()=>{let m=e.cache.get(Ja);return m?.ok&&Array.isArray(m.orgs)?m.orgs:null}),[r,i]=u(null),[d,l]=u(!1),[c,b]=u(null),[f,C]=u(!1),[h,y]=u(!1),v=K(async()=>{try{let m=await e.call("listOrgs");m?.ok&&Array.isArray(m.orgs)?(s(m.orgs),i(null)):(s([]),m?.error&&i(m.error))}catch(m){s([]),i(m instanceof Error?m.message:String(m))}},[e]);q(()=>{v()},[v]);let k=async()=>{l(!0),i(null);try{let m=await e.call("rediscoverOrgs");!m?.ok&&m?.error&&i(m.error),await v()}catch(m){i(m instanceof Error?m.message:String(m))}finally{l(!1)}},x=async()=>{if(c){C(!0);try{let m=await e.call("deleteOrg",{host:c.host,login:c.login});!m?.ok&&m?.error&&e.toast(m.error,"error"),await v()}catch(m){e.toast(m instanceof Error?m.message:String(m),"error")}finally{C(!1),b(null)}}};return o("div",{className:"prm-area",children:[a(Ze,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:o(ee,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void k(),disabled:d,title:"Re-discover organizations from your gh accounts",children:[d?a(G,{size:13,className:"prm-spin"}):a(Be,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>y(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(De,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),t===null?o("div",{className:"prm-loading",children:[a(G,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):t.length===0?o("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:t.map(m=>o("div",{className:"prm-entity-card",children:[o("div",{className:"prm-entity-main",children:[o("div",{className:"prm-entity-title",children:[m.login," ",o("span",{className:"prm-entity-host",children:["(",m.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:m.apiBaseUrl}),o("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:m.login})]})]}),o("div",{className:"prm-entity-side",children:[a(pt,{state:d?"checking":m.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>b(m),title:"Delete organization",children:a(fe,{size:15})})]})]},`${m.host}|${m.login}`))}),h&&o(ta,{title:"Adding & removing organizations",icon:a(De,{size:16}),onClose:()=>y(!1),children:[o("div",{className:"prm-modal-body prm-help-body",children:[o("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),o("ul",{children:[o("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),o("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),o("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),o("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>y(!1),children:a("span",{children:"Got it"})})})]}),c&&a(mt,{title:"Delete organization?",danger:!0,busy:f,message:o(ee,{children:["Delete ",a("strong",{children:c.login})," (",c.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>void x(),onCancel:()=>b(null)})]})}function Rs(e,t){try{let s=new URL(t);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(t)}catch{}}function Ao(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function Ms(e,t){await Ra(t)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Ro({host:e,onRepositoriesChanged:t}){let[s,r]=u(()=>{let S=e.cache.get(It);return S?.ok&&Array.isArray(S.repos)?S.repos:null}),[i,d]=u(()=>{let S=e.cache.get(Ja);return S?.ok&&Array.isArray(S.orgs)?S.orgs:[]}),[l,c]=u(null),[b,f]=u(!1),[C,h]=u(!1),[y,v]=u(!1),[k,x]=u(null),[m,M]=u("general"),[P,N]=u(null),[B,T]=u(null),[ae,_]=u(!1),H=K(async()=>{try{let[S,O]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);S?.ok&&Array.isArray(S.repos)?(r(S.repos),c(null)):(r([]),S?.error&&c(S.error)),d(O?.ok&&Array.isArray(O.orgs)?O.orgs:[])}catch(S){r([]),c(S instanceof Error?S.message:String(S))}},[e]);q(()=>{H()},[H]);let Z=async()=>{if(B){_(!0);try{await e.call("deleteRepository",{host:B.host,owner:B.owner,repo:B.repo}),await H()}catch(S){e.toast(S instanceof Error?S.message:String(S),"error")}finally{_(!1),T(null)}}};return o("div",{className:"prm-area",children:[a(Ze,{title:"Repositories",subtitle:"Manage your connected repositories",actions:o(ee,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>h(!0),children:[a(Be,{size:13})," ",a("span",{children:"Suggested for you"})]}),o("button",{type:"button",className:"prm-btn",onClick:()=>v(!0),children:[a(wa,{size:13})," ",a("span",{children:"Browse Repositories"})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>f(!0),children:[a(va,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),l&&a("div",{className:"prm-error",children:l}),s===null?o("div",{className:"prm-loading",children:[a(G,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?o("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(S=>o("div",{className:"prm-entity-card prm-repo-card",children:[o("div",{className:"prm-repo-top",children:[o("div",{className:"prm-entity-title",children:[a(qe,{size:14,"aria-hidden":!0})," ",o("span",{children:[S.owner,"/",S.repo]}),a("span",{className:`prm-active-badge${S.active?"":" prm-active-badge--off"}`,children:S.active?"Active":"Inactive"}),a(pt,{state:S.connection}),(()=>{let O=Xa[S.buildTisPreset??S.tisPreset??at],j=Ka[S.reviewTisPreset??tt];return o(ee,{children:[o("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${O.warnHours}h, behind schedule after ${O.dangerHours}h`,children:[a(Ne,{size:11,"aria-hidden":!0}),"Build: ",O.label]}),o("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${j.warnDays}d, behind schedule after ${j.dangerDays}d`,children:[a(Ne,{size:11,"aria-hidden":!0}),"Review: ",j.label]})]})})()]}),o("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>Rs(e,Ao(S)),children:a(Oe,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>void Ms(e,Ao(S)),children:a(Ue,{size:14})})]})]}),o("div",{className:"prm-entity-sub prm-repo-meta",children:[o("span",{children:["Organization: ",S.orgLogin," (",S.shortHost,")"]}),o("span",{children:["Created ",ze(S.createdAt)]})]}),o("div",{className:"prm-repo-actions",children:[o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>N(S),children:[a(xa,{size:12})," ",a("span",{children:"Test Connection"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{M("general"),x(S)},children:[a(Ke,{size:12})," ",a("span",{children:"Edit Repository"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{M("status"),x(S)},title:"Status Settings",children:[a(Ne,{size:12})," ",a("span",{children:"Status Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{M("notifications"),x(S)},title:"Notification Settings",children:[a(Me,{size:12})," ",a("span",{children:"Notification Settings"})]}),o("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>T(S),children:[a(fe,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${S.host}|${S.owner}/${S.repo}`))}),b&&a(Ts,{host:e,orgs:i,onClose:()=>f(!1),onAdded:async()=>{f(!1),await H()}}),C&&a(Ds,{host:e,onClose:()=>h(!1),onAdded:async()=>{await H()}}),y&&a(Ns,{host:e,onClose:()=>v(!1),onAdded:async()=>{await H()}}),k&&a(Bs,{host:e,repo:k,orgs:i,initialTab:m,onClose:()=>x(null),onSaved:async S=>{x(null),Array.isArray(S)&&(e.cache.set(X,S),e.cache.set(de,S.length),e.cache.refreshBadge()),t?.(),await H()}}),P&&a(Fs,{host:e,repo:P,onClose:()=>N(null),onResult:S=>{let O=S?"connected":"disconnected";r(j=>(j??[]).map(J=>J.host===P.host&&J.owner===P.owner&&J.repo===P.repo?{...J,connection:O}:J))}}),B&&a(mt,{title:"Delete repository?",danger:!0,busy:ae,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>void Z(),onCancel:()=>T(null)})]})}function Ts({host:e,orgs:t,onClose:s,onAdded:r}){let[i,d]=u(""),[l,c]=u(t[0]?`${t[0].host}|${t[0].login}`:""),[b,f]=u(null),[C,h]=u(!1),y=async()=>{let v=t.find(k=>`${k.host}|${k.login}`===l);if(!v){f("Please select an organization.");return}h(!0),f(null);try{let k=await e.call("addRepository",{ref:i.trim(),host:v.host,orgLogin:v.login});k?.ok?r():f(k?.error||"Failed to add repository.")}catch(k){f(k instanceof Error?k.message:String(k))}finally{h(!1)}};return o(ta,{title:"Add repository",icon:a(va,{size:14}),onClose:s,busy:C,children:[o("div",{className:"prm-modal-body",children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:i,spellCheck:!1,onChange:v=>{d(v.target.value),b&&f(null)},onKeyDown:v=>{v.key==="Enter"&&!C&&(v.preventDefault(),y())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),o("select",{className:"prm-input prm-input--select",value:l,onChange:v=>c(v.target.value),children:[t.length===0&&a("option",{value:"",children:"No organizations"}),t.map(v=>o("option",{value:`${v.host}|${v.login}`,children:[v.login," (",v.shortHost,")"]},`${v.host}|${v.login}`))]})]}),b&&a("div",{className:"prm-modal-error",children:b})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:C,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void y(),disabled:C||!i.trim(),children:[C?a(G,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function Ds({host:e,onClose:t,onAdded:s}){let[r,i]=u(null),[d,l]=u(new Set),[c,b]=u(null),[f,C]=u(!1),h=K(async()=>{i(null),b(null);try{let x=await e.call("suggestRepositories");x?.ok&&Array.isArray(x.repos)?(i(x.repos),l(new Set(x.repos.filter(m=>m.alreadyAdded).map(m=>m.fullName)))):(i([]),x?.error&&b(x.error))}catch(x){i([]),b(x instanceof Error?x.message:String(x))}},[e]);q(()=>{h()},[h]);let y=x=>{x.alreadyAdded||l(m=>{let M=new Set(m);return M.has(x.fullName)?M.delete(x.fullName):M.add(x.fullName),M})},v=async()=>{if(!r)return;let x=r.filter(m=>!m.alreadyAdded&&d.has(m.fullName));if(x.length!==0){C(!0);try{await e.call("addRepositories",{repos:x.map(m=>({owner:m.owner,repo:m.repo,host:m.host,orgLogin:m.orgLogin}))}),await s(),t()}catch(m){e.toast(m instanceof Error?m.message:String(m),"error")}finally{C(!1)}}},k=r?r.filter(x=>!x.alreadyAdded&&d.has(x.fullName)).length:0;return o(ta,{title:"Suggested for you",icon:a(Be,{size:14}),onClose:t,busy:f,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?o("div",{className:"prm-loading",children:[a(G,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):c?a("div",{className:"prm-modal-error",children:c}):r.length===0?o("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(x=>o("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:d.has(x.fullName),disabled:x.alreadyAdded,onChange:()=>y(x)}),o("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:x.fullName}),o("span",{className:"prm-entity-sub",children:[x.prCount," PRs \xB7 ",ze(x.lastActivity)]})]}),x.alreadyAdded&&o("span",{className:"prm-suggested-added",children:[a(ge,{size:13})," Already added"]})]},x.fullName))})]}),o("footer",{className:"prm-modal-footer",children:[o("button",{type:"button",className:"prm-btn",onClick:()=>void h(),disabled:f||r===null,children:[a(Be,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:t,disabled:f,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void v(),disabled:f||k===0,children:[f?a(G,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Adding\u2026":k>0?`Add ${k} Selected`:"Add Selected"})]})]})]})}function Ns({host:e,onClose:t,onAdded:s}){let[r,i]=u(""),[d,l]=u(null),[c,b]=u(!0),[f,C]=u(!1),[h,y]=u(!1),[v,k]=u(1),[x,m]=u(null),[M,P]=u(new Set),[N,B]=u(new Set),[T,ae]=u(new Set),[_,H]=u(!1),Z=K(async(R,E)=>{E?C(!0):b(!0),m(null);try{let D=await e.call("listAllRepositories",{page:R}),W=D?.ok&&Array.isArray(D.repos)?D.repos:[];y(!!D?.hasMore),ae(new Set(Array.isArray(D?.incompleteOwners)?D.incompleteOwners:[])),l(oe=>{if(!E||!oe)return W;let ye=new Set(oe.map(ne=>`${ne.host}|${ne.fullName}`));return[...oe,...W.filter(ne=>!ye.has(`${ne.host}|${ne.fullName}`))]}),D&&D.ok===!1&&D.error&&m(D.error)}catch(D){m(D instanceof Error?D.message:String(D)),E||l([])}finally{b(!1),C(!1)}},[e]);q(()=>{Z(1,!1)},[Z]);let S=()=>{let R=v+1;k(R),Z(R,!0)},O=d??[],j=r.trim().toLowerCase(),J=j?O.filter(R=>R.fullName.toLowerCase().includes(j)):O,w=R=>{P(E=>{let D=new Set(E);return D.has(R)?D.delete(R):D.add(R),D})},ue=R=>{B(E=>{let D=new Set(E);return D.has(R)?D.delete(R):D.add(R),D})},se=R=>`${R.host}|${R.fullName}`,ie=(()=>{let R=new Map;for(let E of J){let D=R.get(E.owner)??[];D.push(E),R.set(E.owner,D)}return Array.from(R.entries())})(),F=async()=>{let R=J.filter(E=>!E.alreadyAdded&&M.has(se(E)));if(R.length!==0){H(!0);try{await e.call("addRepositories",{repos:R.map(E=>({owner:E.owner,repo:E.repo,host:E.host,orgLogin:E.owner}))}),await s(),t()}catch(E){e.toast(E instanceof Error?E.message:String(E),"error")}finally{H(!1)}}},ve=J.filter(R=>!R.alreadyAdded&&M.has(se(R))).length;return o(ta,{title:"Browse Repositories",icon:a(wa,{size:14}),onClose:t,busy:_,wide:!0,children:[o("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:R=>i(R.target.value)})}),x&&a("div",{className:"prm-modal-error",children:x}),c?o("div",{className:"prm-loading",children:[a(G,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):o("div",{className:"prm-browse-list",children:[ie.map(([R,E])=>{let D=!N.has(R);return o("div",{className:"prm-browse-group",children:[o("button",{type:"button",className:"prm-browse-group-header",onClick:()=>ue(R),"aria-expanded":D,children:[a(Ye,{size:13,className:`prm-disclosure${D?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:R}),o("span",{className:"prm-browse-group-count",title:!j&&T.has(R)?`${E.length} loaded \u2014 more available, use Load more`:void 0,children:["(",E.length,!j&&T.has(R)?"\u2026":"",")"]})]}),D&&E.map(W=>W.alreadyAdded?o("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[o("span",{children:[a(qe,{size:13,"aria-hidden":!0})," ",W.fullName,W.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),o("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(ge,{size:11,"aria-hidden":!0})," Connected"]})]},se(W)):o("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:M.has(se(W)),onChange:()=>w(se(W))}),o("span",{children:[a(qe,{size:13,"aria-hidden":!0})," ",W.fullName,W.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},se(W)))]},R)}),J.length===0&&a("div",{className:"prm-area-empty",children:j?"No repositories match your filter.":"No repositories found."}),h&&!j&&o("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:S,disabled:f,children:[f?a(G,{size:13,className:"prm-spin"}):null,a("span",{children:f?"Loading\u2026":"Load more"})]})]})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:t,disabled:_,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void F(),disabled:_||ve===0,children:[_?a(G,{size:13,className:"prm-spin"}):null,a("span",{children:ve>0?`Add ${ve} Selected`:"Add Selected"})]})]})]})}function Bs({host:e,repo:t,orgs:s,initialTab:r="general",onClose:i,onSaved:d}){let[l,c]=u(r),[b,f]=u(`${t.owner}/${t.repo}`),[C,h]=u(t.orgLogin),[y,v]=u(t.active),[k,x]=u(t.buildTisPreset??t.tisPreset??at),[m,M]=u(t.reviewTisPreset??tt),[P,N]=u(t.sfciGated===!0),[B,T]=u((t.ignoredFailingChecks??[]).some(w=>w.toLowerCase().includes("snyk"))),[ae,_]=u(t.notifyInApp??!0),[H,Z]=u(null),[S,O]=u(!1),j=s.filter(w=>w.host===t.host),J=async()=>{O(!0),Z(null);try{let w=await e.call("updateRepository",{key:{host:t.host,owner:t.owner,repo:t.repo},ref:b.trim(),orgLogin:C,active:y,buildTisPreset:k,reviewTisPreset:m,sfciGated:P,ignoredFailingChecks:B?["Snyk"]:[],notifyInApp:ae});w?.ok?d(w.prs):Z(w?.error||"Failed to save settings.")}catch(w){Z(w instanceof Error?w.message:String(w))}finally{O(!1)}};return o(ta,{title:o("span",{className:"prm-dialog-title",children:["Repository Settings ",o("span",{className:"prm-entity-sub",children:[t.owner,"/",t.repo]})]}),icon:a(Ke,{size:14}),onClose:i,busy:S,children:[o("nav",{className:"prm-dialog-tabs",children:[o("button",{type:"button",className:`prm-dialog-tab${l==="general"?" active":""}`,onClick:()=>c("general"),children:[a(Ke,{size:12})," General"]}),o("button",{type:"button",className:`prm-dialog-tab${l==="status"?" active":""}`,onClick:()=>c("status"),children:[a(Ne,{size:12})," Status"]}),o("button",{type:"button",className:`prm-dialog-tab${l==="notifications"?" active":""}`,onClick:()=>c("notifications"),children:[a(Me,{size:12})," Notifications"]})]}),o("div",{className:"prm-modal-body",children:[l==="general"?o(ee,{children:[o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:y,onChange:w=>v(w.target.checked)}),o("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:b,spellCheck:!1,onChange:w=>f(w.target.value)})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:C,onChange:w=>h(w.target.value),children:j.map(w=>o("option",{value:w.login,children:[w.login," (",w.shortHost,")"]},w.login))})]})]}):l==="status"?o(ee,{children:[o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:k,onChange:w=>x(w.target.value),children:Object.values(Xa).map(w=>o("option",{value:w.id,children:[w.label," (",w.warnHours,"h / ",w.dangerHours,"h)"]},w.id))})]}),o("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:m,onChange:w=>M(w.target.value),children:Object.values(Ka).map(w=>o("option",{value:w.id,children:[w.label," (",w.warnDays,"d / ",w.dangerDays,"d)"]},w.id))})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:P,onChange:w=>N(w.target.checked)}),o("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:B,onChange:w=>T(w.target.checked)}),o("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:ae,onChange:w=>_(w.target.checked)}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),H&&a("div",{className:"prm-modal-error",children:H})]}),o("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:i,disabled:S,children:"Cancel"}),o("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void J(),disabled:S,children:[S?a(G,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function Fs({host:e,repo:t,onClose:s,onResult:r}){let[i,d]=u(null);return q(()=>{let l=!0;return(async()=>{try{let b=await e.call("testRepository",{host:t.host,owner:t.owner,repo:t.repo})??{ok:!1,error:"No response"};l&&(d(b),r?.(b.ok))}catch(c){l&&(d({ok:!1,error:c instanceof Error?c.message:String(c)}),r?.(!1))}})(),()=>{l=!1}},[e,t]),o(ta,{title:`Connection Test Results: ${t.owner}/${t.repo}`,icon:a(xa,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:i===null?o("div",{className:"prm-loading",children:[a(xa,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):i.ok?o("div",{className:"prm-test-result prm-test-result--ok",children:[a(ge,{size:16})," All connection tests passed."]}):o("div",{className:"prm-test-result prm-test-result--fail",children:[a(we,{size:16}),o("div",{children:[a("div",{children:i.error||"Connection failed."}),o("div",{className:"prm-field-hint",children:["Try ",o("code",{children:["gh auth login ",t.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function Es(e){let t=e.trim().split(/\s+/).filter(Boolean);return t.length===0?"?":t.length===1?t[0].slice(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}function Mo({host:e}){let[t,s]=u(()=>{let f=e.cache.get(Ct);return f?.ok?f.author??null:void 0}),[r,i]=u(null),[d,l]=u(!1),c=K(async()=>{try{let f=await e.call("getAuthor");f?.ok?(s(f.author??null),i(null)):(s(null),f?.error&&i(f.error))}catch(f){s(null),i(f instanceof Error?f.message:String(f))}},[e]);q(()=>{c()},[c]);let b=t?.name||t?.login||"";return o("div",{className:"prm-area",children:[a(Ze,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),t===void 0?o("div",{className:"prm-loading",children:[a(G,{size:14,className:"prm-spin"})," Loading author\u2026"]}):t===null?o("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:o("div",{className:"prm-entity-card prm-author-card",children:[o("button",{type:"button",className:"prm-author-row",onClick:()=>l(f=>!f),"aria-expanded":d,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:Es(b)}),o("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:b}),t.email&&a("span",{className:"prm-entity-sub",children:t.email})]}),a(Ye,{size:16,className:`prm-disclosure${d?" is-open":""}`,"aria-hidden":!0})]}),d&&o("div",{className:"prm-author-detail",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:b||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:t.email||"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:t.identities.map(f=>o("div",{className:"prm-identity-row",children:[o("span",{children:[f.login," ",o("span",{className:"prm-entity-host",children:["(",f.shortHost,")"]})]}),f.connection==="connected"?a(ge,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):o("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(we,{size:13})," Disconnected"]})]},`${f.host}|${f.login}`))})]})]})]})})]})}function To({settings:e,update:t}){let s=e.notifyInApp??e.notifyOnChange;return o("div",{className:"prm-area",children:[a(Ze,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>t({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),o("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>t({sendToInbox:r.target.checked})}),o("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>t({badgeMode:"unread"})}),o("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),o("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>t({badgeMode:"total"})}),o("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var Do=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],Hs=15;function No(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function Os(e,t){let s=Math.max(0,e-t),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let i=Math.floor(r/60),d=r%60;return d?`in ${i}h ${d}m`:`in ${i}h`}function Bo({settings:e,update:t,host:s}){let[r,i]=u(()=>s.cache.get(X)??[]),[d,l]=u(!1),[c,b]=u(()=>Date.now());q(()=>{let x=window.setInterval(()=>{let m=s.cache.get(X);m&&i(M=>M===m?M:m),b(Date.now())},1e3);return()=>window.clearInterval(x)},[s]);let f=e.autoSyncEnabled??!0,C=Do.some(x=>x.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:Hs,h=r.reduce((x,m)=>Math.max(x,m.lastChecked||0),0),y=f&&h?h+C*6e4:0,v=new Set(r.map(x=>x.repo)).size,k=async()=>{l(!0);try{let x=await s.call("pollAll");x?.ok&&Array.isArray(x.prs)&&(i(x.prs),s.cache.set(X,x.prs))}catch(x){s.toast(x instanceof Error?x.message:String(x),"error")}finally{l(!1)}};return o("div",{className:"prm-area",children:[a(Ze,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),o("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:f,onChange:x=>t({autoSyncEnabled:x.target.checked})}),o("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),o("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:C,onChange:x=>{let m=Number(x.target.value);Number.isFinite(m)&&t({pollIntervalMinutes:m})},children:Do.map(x=>a("option",{value:x.value,children:x.label},x.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),o("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),o("div",{className:"prm-sync-status",children:[o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:y?o(ee,{children:[Os(y,c)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",No(y)]})]}):"\u2014"})]}),o("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:h?o(ee,{children:[ze(h)," ",o("span",{className:"prm-field-hint",children:["\xB7 ",No(h)]})]}):""})]}),o("div",{className:"prm-sync-counts",children:[o("span",{className:"prm-sync-count",children:[a("strong",{children:v})," repositories checked"]}),o("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),o("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>void k(),disabled:d,children:[d?a(G,{size:13,className:"prm-spin"}):a(Ae,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var qs=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:Ba},{id:"repositories",label:"Repositories",icon:Na},{id:"author",label:"Author",icon:ja}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:Me}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:Wa}]}];function Fo({settings:e,onSave:t,onRepositoriesChanged:s,host:r}){let[i,d]=u(e.settingsActiveNav??bt),l=b=>{let f={...e,...b};t(f),r.cache.set("settings",f),r.cache.refreshBadge()},c=b=>{d(b),l({settingsActiveNav:b})};return a("div",{className:"prm-settings-shell",children:o("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:qs.map(b=>o("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:b.label}),b.items.map(f=>{let C=f.icon;return o("button",{type:"button",className:`prm-nav-row${i===f.id?" active":""}`,"aria-current":i===f.id,onClick:()=>c(f.id),children:[a(C,{size:15,"aria-hidden":!0}),a("span",{children:f.label})]},f.id)})]},b.label))}),o("div",{className:"prm-settings-pane",children:[i==="organizations"&&a(ko,{host:r}),i==="repositories"&&a(Ro,{host:r,onRepositoriesChanged:s}),i==="author"&&a(Mo,{host:r}),i==="notifications"&&a(To,{settings:e,update:l}),i==="system"&&a(Bo,{settings:e,update:l,host:r})]})]})})}function Eo(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function Ho(e,t,s){return e===1?t:s}function Oo(e){if(!e)return null;let t=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return t.length>0?{kind:"disconnect",subjects:t,action:"settings",message:`GitHub sign-in expired for ${Eo(t)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${Ho(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${Ho(r.length,"is","is")} temporarily unreachable for ${Eo(r)} \u2014 retrying automatically.`}:null}function Us(e,t){let s=(e.repo??"").toLowerCase();if(s)return(t??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function qo(e,t){let s=Us(e,t.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let d=t.notifyInApp??t.notifyOnChange??!1,l=t.sendToInbox??!1;return{inApp:d,inbox:l&&!!e.projectId}}function Uo(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function _s(e){try{let t=new URL(e);if(t.protocol!=="http:"&&t.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function _o(e,t,s){for(let r of t){let i=yt(r.newStatus)>yt(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||i))continue;let l=qo(r.pr,s);if(!l.inApp&&!l.inbox)continue;let c=Uo(r.pr.repo),b=Uo(r.pr.title),f=_s(r.pr.url),C=f?`[${b}](${f})`:b;if(l.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${Re(r.oldStatus)} \u2192 ${Re(r.newStatus)}`,"info"),l.inbox&&r.pr.projectId){let h=`**${c}#${r.pr.number}** \u2014 ${Re(r.oldStatus)} \u2192 **${Re(r.newStatus)}**

${C}`;try{await e.pushInbox({comments:h,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var Rt="activeSubTab",zo="listSort",Go="hostScope",Mt="listView";function Tt({host:e}){let[t,s]=u(null),[r,i]=u(!1),[d,l]=u(()=>e.cache.get(X)??[]),[c,b]=u(!1),[f,C]=u(null),[h,y]=u("prs"),[v,k]=u(!1),[x,m]=u(!1),[M,P]=u(!1),[N,B]=u(!1),[T,ae]=u([]),[_,H]=u("status"),[Z,S]=u("asc"),[O,j]=u([]),[J,w]=u("board"),[ue,se]=u(!1),[ie,F]=u(()=>({...Xt})),ve=Ce(null),[R,E]=u(()=>e.listProjects());q(()=>{let g=!0;return Promise.all([e.storage.get(La),e.storage.get(Rt),e.call("listPrs"),e.storage.get(zo),e.storage.get(Go),e.storage.get(Mt)]).then(([I,L,U,te,Pe,Ie])=>{if(!g)return;te?.field&&H(te.field),te?.dir&&S(te.dir),Array.isArray(Pe)&&j(Pe),At(Ie)&&w(Ie);let Ee=I?{...ha,...I,relevanceModes:{...ha.relevanceModes,...I.relevanceModes}}:null;s(Ee),Ee&&(e.cache.set("settings",Ee),e.cache.refreshBadge?.()),L==="prs"||L==="settings"?y(L):(L==="board"||L==="list")&&(y("prs"),At(Ie)||(w(L),e.storage.set(Mt,L)),e.storage.set(Rt,"prs")),Array.isArray(U)&&U.length>0&&(l(U),e.cache.set(X,U),e.cache.set(de,U.length),e.cache.refreshBadge?.()),i(!0),k(!0),B(!0)}).catch(I=>{g&&(console.error("pr-monitor hydrate failed",I),i(!0),k(!0),B(!0))}),()=>{g=!1}},[e]),q(()=>{let g=()=>{let L=e.cache.get(X);L&&l(te=>te===L?te:L);let U=e.listProjects();E(te=>te.length===U.length?te:U)},I=window.setInterval(g,100);return()=>window.clearInterval(I)},[e]);let D=g=>{y(g),e.storage.set(Rt,g)},W=K(async g=>{b(!0),C(null);try{let I=Array.isArray(g)&&g.length>0,U=I?await e.call("syncRepos",{repos:g}):await e.call("pollAll");for(;U.state==="running";)await new Promise(Ie=>window.setTimeout(Ie,250)),U=await e.call("syncStatus");if((U.state===void 0||U.state==="succeeded")&&Array.isArray(U.prs)){if(l(U.prs),e.cache.set(X,U.prs),e.cache.set(de,U.prs.length),e.cache.refreshBadge?.(),Array.isArray(U.deltas)&&U.deltas.length>0){let Ie=t??{...ha,...await e.storage.get(La)};await _o(e,U.deltas,Ie)}}else U?.error&&C(U.error);let Pe=U?.health;!I&&Pe&&F(Pe)}catch(I){C(I instanceof Error?I.message:String(I))}finally{b(!1),se(!0)}},[e]),oe=Ce(!1);q(()=>{!N||oe.current||(oe.current=!0,e.call("getSyncHealth").then(g=>{g?.ok&&g.health&&F(g.health)}).catch(()=>{}),W())},[N,W,e]);let ye=K(async(g,I)=>{try{let L=await e.call("resolveRemoteGone",{repo:g,action:I});if(!L?.ok){e.toast(`Couldn't ${I} ${g} \u2014 ${L?.error??"unknown error"}`,"error");return}F(U=>({...U,remoteGone:U.remoteGone.filter(te=>te.toLowerCase()!==g.toLowerCase()),keptGone:I==="keep"?[...U.keptGone,g].filter((te,Pe,Ie)=>Ie.indexOf(te)===Pe):U.keptGone})),W()}catch(L){e.toast(`Couldn't ${I} ${g} \u2014 ${L instanceof Error?L.message:String(L)}`,"error")}},[e,W]),ne=K(async g=>{try{let I=await e.call("removePr",g);I?.ok&&Array.isArray(I.prs)&&(l(I.prs),e.cache.set(X,I.prs),e.cache.set(de,I.prs.length),e.cache.refreshBadge?.())}catch(I){e.toast(`Couldn't remove PR \u2014 ${I instanceof Error?I.message:String(I)}`,"error")}},[e]),pe=K(async g=>{let I=d.find(L=>L.url===g);if(I)try{let L;I.source==="auto"?L=await e.call("dismissPr",{url:g}):L=await e.call("removePr",g),L?.ok&&Array.isArray(L.prs)&&(l(L.prs),e.cache.set(X,L.prs),e.cache.set(de,L.prs.length),e.cache.refreshBadge?.())}catch(L){e.toast(`Couldn't dismiss PR \u2014 ${L instanceof Error?L.message:String(L)}`,"error")}},[e,d]),je=K(async g=>{s(g);let I=await e.storage.get(La),L={...g};I&&(L.organizations=I.organizations,L.repositories=I.repositories,L.author=I.author,L.orgDiscovered=I.orgDiscovered,L.authorDiscovered=I.authorDiscovered),await e.storage.set(La,L),e.cache.set("settings",L),e.cache.refreshBadge?.()},[e]),pa=K(async()=>{let g=await e.storage.get(La);g?.repositories&&s(I=>I&&{...I,repositories:g.repositories})},[e]),ma=K(async(g,I)=>{try{let L=await e.call("assignProject",g,I);L?.ok&&Array.isArray(L.prs)&&(l(L.prs),e.cache.set(X,L.prs))}catch(L){e.toast(`Couldn't assign project \u2014 ${L instanceof Error?L.message:String(L)}`,"error")}},[e]),Fe=K((g,I)=>{H(g),S(I),e.storage.set(zo,{field:g,dir:I})},[e]),he=K(g=>{j(g),e.storage.set(Go,g)},[e]),oa=K(g=>{w(g),e.storage.set(Mt,g)},[e]),V=K(async(g,I)=>{if(g.length!==0)try{let L=await e.call("setPrsSeen",{urls:g,seen:I});L?.ok&&Array.isArray(L.prs)&&(l(L.prs),e.cache.set(X,L.prs),e.cache.set("monitoredCount",L.prs.length),e.cache.refreshBadge?.())}catch(L){e.toast(`Couldn't update read state \u2014 ${L instanceof Error?L.message:String(L)}`,"error")}},[e]),Le=K(async(g,I)=>{if(g.length!==0)try{let L=await e.call("setPrsFavorite",{urls:g,favorite:I});L?.ok&&Array.isArray(L.prs)&&(l(L.prs),e.cache.set(X,L.prs))}catch(L){e.toast(`Couldn't update favorites \u2014 ${L instanceof Error?L.message:String(L)}`,"error")}},[e]),ce=K(async g=>{if(g.length!==0)try{let I=await e.call("dismissPrs",{urls:g});I?.ok&&Array.isArray(I.prs)&&(l(I.prs),e.cache.set(X,I.prs),e.cache.set(de,I.prs.length),e.cache.refreshBadge?.())}catch(I){e.toast(`Couldn't dismiss PRs \u2014 ${I instanceof Error?I.message:String(I)}`,"error")}},[e]),be=Q(()=>{if(T.length===0)return d;let g=new Set(T.map(I=>I.toLowerCase()));return d.filter(I=>g.has(I.repo.toLowerCase()))},[d,T]),Y=Q(()=>be.filter(g=>yo.includes(g.status)).map(g=>g.url),[be]),re=Q(()=>Oo(ie),[ie]);return v?t?o("section",{className:"prm-panel",children:[o("header",{className:"prm-header",children:[o("div",{className:"prm-header-title",children:[a(xe,{size:16,className:"prm-header-icon","aria-hidden":!0}),o("div",{className:"prm-header-heading",children:[a("h2",{children:h==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:h==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),h==="prs"&&a("span",{className:"prm-count-pill",children:be.length})]}),o("div",{className:"prm-header-actions",children:[h==="prs"&&o(ee,{children:[o("button",{type:"button",className:"prm-btn",onClick:()=>m(!0),title:"Add a specific pull request to the monitored list",children:[a(Ha,{size:13})," ",a("span",{children:"Add PR"})]}),Y.length>0&&o("button",{type:"button",className:"prm-btn",onClick:()=>void ce(Y),title:`Sweep \u2014 dismiss the ${Y.length} Merged/Closed PR(s) from the list`,children:[a(fe,{size:13})," ",a("span",{children:"Sweep"})]}),o("div",{className:"prm-split-btn",children:[o("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>void W(T),disabled:c,title:T.length>0?`Sync the ${T.length} selected repositor${T.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[c?a(G,{size:13,className:"prm-spin"}):a(Ae,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:ve,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>P(g=>!g),disabled:c,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker",children:a(ga,{size:13})}),M&&a(Po,{anchorRef:ve,host:e,selectedRepos:T,onClose:()=>P(!1),onToggleRepo:g=>ae(I=>I.includes(g)?I.filter(L=>L!==g):[...I,g]),onSelectAll:()=>ae([]),onSync:g=>void W(g)})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":h==="settings",onClick:()=>D(h==="settings"?"prs":"settings"),title:h==="settings"?"Back to pull requests":"Settings",children:h==="settings"?o(ee,{children:[a(Ta,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):o(ee,{children:[a(Ga,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]})]}),o("div",{className:`prm-content${h==="prs"&&J==="board"?" prm-content--board":""}`,children:[f&&a("div",{className:"prm-error",children:f}),h==="prs"&&re&&o("div",{className:`prm-sync-clue prm-sync-clue--${re.kind}`,role:"status",children:[re.kind==="disconnect"&&a($a,{size:14,"aria-hidden":!0}),re.kind==="remote-gone"&&a(Xe,{size:14,"aria-hidden":!0}),re.kind==="outage"&&a(Ea,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:re.message}),re.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>D("settings"),children:"Open Settings"})]}),h==="prs"&&ie.remoteGone.map(g=>o("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${g} is gone`,children:[o("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:g})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),o("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>void ye(g,"keep"),children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>void ye(g,"remove"),children:"Remove"})]})]},g)),h==="prs"&&a(wo,{prs:be,host:e,projects:R,tisWarnHours:t.tisWarnHours,tisDangerHours:t.tisDangerHours,reviewWarnDays:t.reviewWarnDays,reviewDangerDays:t.reviewDangerDays,repositories:t.repositories,workItemLocatorBase:t.gusLocatorBaseUrl,sortField:_,sortDir:Z,onSortChange:Fe,hostScope:O,onHostScopeChange:he,awaitingFirstSync:!ue,syncing:c,autoSyncEnabled:t.autoSyncEnabled??!0,onDismiss:g=>void pe(g),onProjectAssign:(g,I)=>void ma(g,I),onBulkSetSeen:(g,I)=>void V(g,I),onBulkDismiss:g=>void ce(g),onBulkSetFavorite:(g,I)=>void Le(g,I),viewMode:J,onViewModeChange:oa}),h==="settings"&&r&&a(Fo,{settings:t,onSave:g=>void je(g),onRepositoriesChanged:()=>void pa(),host:e})]}),x&&a(vo,{host:e,onClose:()=>m(!1),onPulled:g=>{l(g),e.cache.set(X,g),e.cache.set(de,g.length),e.cache.refreshBadge?.(),m(!1)}})]}):a("section",{className:"prm-panel",children:a(Jt,{onSave:async g=>{await je(g)}})}):a("section",{className:"prm-panel",children:o("div",{className:"prm-loading",children:[a(G,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})})}function Vo(e){if(e.length!==0)return e.length===1?e[0]:e}var Dt=new Map,Nt=[],jo;function Bt(e){jo=e}function zs(){return{get:e=>Dt.get(e),set:(e,t)=>{Dt.set(e,t)},delete:e=>{Dt.delete(e)},refreshBadge:()=>jo?.()}}function Gs(e,t){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,t)}function Vs(e){try{let t=new URL(e);if(t.protocol!=="https:"&&t.protocol!=="http:"||typeof window>"u")return;window.open(t.href,"_blank","noopener,noreferrer")}catch{}}function $o(e){return Nt=[],ra(e,"listProjects").then(t=>{Array.isArray(t)&&(Nt=t)}).catch(()=>{}),{call:(t,...s)=>ra(e,t,Vo(s)),storage:{get:t=>ra(e,"storageGet",t),set:async(t,s)=>{await ra(e,"storageSet",{key:t,value:s})}},cache:zs(),toast:Gs,listProjects:()=>Nt,openExternal:Vs,pushInbox:async t=>t.projectId?await ra(e,"pushInbox",t):{id:""}}}var Ft="prs-changed";var Et=`/*
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

`;var Ko="pr-monitor",Wo="prm-plugin-styles";function $s(){return globalThis.__ZCC_PLUGIN_RUNTIME__}function Ws(){if(typeof document>"u")return;let e=document.getElementById(Wo);if(e instanceof HTMLStyleElement){e.textContent=`${Pt}
${Et}`;return}let t=document.createElement("style");t.id=Wo,t.textContent=`${Pt}
${Et}`,document.head.appendChild(t)}Ws();var Ks={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function Xs(){let e=Q(()=>$o(Ko),[]);return xt(Ft,t=>{let s=t?.prs;Array.isArray(s)&&(e.cache.set(X,s),e.cache.set(de,s.length),e.cache.refreshBadge?.())}),a("div",{style:Ks,children:a(Tt,{host:e})})}function Zs(){let[e,t]=u(null),s=Ce(!0),r=Ce(0),i=K(async()=>{let d=++r.current;try{let l=await ra(Ko,"badge");if(!s.current||d!==r.current)return;let c=typeof l?.count=="number"&&l.count>0?l.count:null;t(c)}catch(l){if(!s.current||d!==r.current)return;console.warn("[pr-monitor] badge refresh failed",l),t(null)}},[]);return q(()=>(s.current=!0,i(),Bt(()=>{s.current&&i()}),()=>{s.current=!1,r.current++,Bt(void 0)}),[i]),xt(Ft,d=>{(async()=>{let l=Array.isArray(d?.inAppDeltas)?d.inAppDeltas:[];if(i(),l.length===0)return;let c=$s();for(let b of l)c?.toast?.(`${b.pr.repo}#${b.pr.number}: ${Re(b.oldStatus)} -> ${Re(b.newStatus)}`,"info")})().catch(l=>console.warn("[pr-monitor] notification delivery failed",l))}),e==null?null:a("span",{className:"nav-badge",children:e})}var rp=zt(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:Xs,experimental_sidebarAccessory:Zs}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:t=>{t.toPluginPanel("main")}})});export{rp as default,Ws as injectStyles};
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
   * @license lucide-react v1.35.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
