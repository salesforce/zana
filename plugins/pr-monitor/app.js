var j=globalThis.__ZCC_HOST_REACT__;var en=j.Children,an=j.Component,tn=j.Fragment,on=j.StrictMode,rn=j.Suspense,sn=j.cloneElement,Ut=j.createContext,Pa=j.createElement,nn=j.createRef,at=j.forwardRef,ln=j.isValidElement,dn=j.lazy,un=j.memo,cn=j.startTransition,Z=j.useCallback,_t=j.useContext,fn=j.useDebugValue,pn=j.useDeferredValue,q=j.useEffect,mn=j.useId,gn=j.useImperativeHandle,hn=j.useInsertionEffect,xn=j.useLayoutEffect,oe=j.useMemo,Ln=j.useReducer,ue=j.useRef,d=j.useState,bn=j.useSyncExternalStore,In=j.useTransition,Cn=j.version;function Zo(){let e=globalThis.__ZCC_PLUGIN_HOST__;if(!e)throw new Error("plugin host is not available");return e}function Jo(){return globalThis.__ZCC_PLUGIN_RUNTIME__??{}}async function ua(e,o,s){return Zo().callRpc(e,o,s)}function zt(e){return{__zccPluginApp:!0,setup:e}}function Lt(e,o){Jo().useRealtime?.(e,o)}var tt=(...e)=>e.filter((o,s,r)=>!!o&&o.trim()!==""&&r.indexOf(o)===s).join(" ").trim();var Gt=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();var Vt=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(o,s,r)=>r?r.toUpperCase():s.toLowerCase());var bt=e=>{let o=Vt(e);return o.charAt(0).toUpperCase()+o.slice(1)};var ot={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};var $t=e=>{for(let o in e)if(o.startsWith("aria-")||o==="role"||o==="title")return!0;return!1};var Yo=Ut({});var jt=()=>_t(Yo);var Wt=at(({color:e,size:o,strokeWidth:s,absoluteStrokeWidth:r,className:i="",children:n,iconNode:l,...u},I)=>{let{size:m=24,strokeWidth:b=2,absoluteStrokeWidth:C=!1,color:w="currentColor",className:g=""}=jt()??{},v=r??C?Number(s??b)*24/Number(o??m):s??b;return Pa("svg",{ref:I,...ot,width:o??m??ot.width,height:o??m??ot.height,stroke:e??w,strokeWidth:v,className:tt("lucide",g,i),...!n&&!$t(u)&&{"aria-hidden":"true"},...u},[...l.map(([x,f])=>Pa(x,f)),...Array.isArray(n)?n:[n]])});var p=(e,o)=>{let s=at(({className:r,...i},n)=>Pa(Wt,{ref:n,iconNode:o,className:tt(`lucide-${Gt(bt(e))}`,`lucide-${e}`,r),...i}));return s.displayName=bt(e),s};var Qo=[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]],Na=p("arrow-down",Qo);var er=[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]],Ba=p("arrow-left",er);var ar=[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]],Fa=p("arrow-up",ar);var tr=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",key:"178tsu"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05",key:"1hqiys"}]],ta=p("bell-off",tr);var or=[["path",{d:"M10.268 21a2 2 0 0 0 3.464 0",key:"vwvbt9"}],["path",{d:"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",key:"11g9vi"}]],Be=p("bell",or);var rr=[["path",{d:"M10 2v8l3-3 3 3V2",key:"sqw3rj"}],["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",key:"k3hazp"}]],Ea=p("book-marked",rr);var sr=[["path",{d:"M10 12h4",key:"a56b0p"}],["path",{d:"M10 8h4",key:"1sr2af"}],["path",{d:"M14 21v-3a2 2 0 0 0-4 0v3",key:"1rgiei"}],["path",{d:"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",key:"secmi2"}],["path",{d:"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16",key:"16ra0t"}]],Ha=p("building-2",sr);var nr=[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]],_e=p("check",nr);var lr=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],Ia=p("chevron-down",lr);var ir=[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]],oa=p("chevron-right",ir);var dr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]],Fe=p("circle-alert",dr);var ur=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],xe=p("circle-check",ur);var cr=[["path",{d:"M10.1 2.182a10 10 0 0 1 3.8 0",key:"5ilxe3"}],["path",{d:"M13.9 21.818a10 10 0 0 1-3.8 0",key:"11zvb9"}],["path",{d:"M17.609 3.721a10 10 0 0 1 2.69 2.7",key:"1iw5b2"}],["path",{d:"M2.182 13.9a10 10 0 0 1 0-3.8",key:"c0bmvh"}],["path",{d:"M20.279 17.609a10 10 0 0 1-2.7 2.69",key:"1ruxm7"}],["path",{d:"M21.818 10.1a10 10 0 0 1 0 3.8",key:"qkgqxc"}],["path",{d:"M3.721 6.391a10 10 0 0 1 2.7-2.69",key:"1mcia2"}],["path",{d:"M6.391 20.279a10 10 0 0 1-2.69-2.7",key:"1fvljs"}]],Oa=p("circle-dashed",cr);var fr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]],Ee=p("circle-question-mark",fr);var pr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]],Pe=p("circle-x",pr);var mr=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6l4 2",key:"mmk7yg"}]],He=p("clock",mr);var gr=[["path",{d:"M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057",key:"1uxyv8"}],["path",{d:"M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78",key:"99tcn7"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],qa=p("cloud-off",gr);var hr=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]],ca=p("columns-3",hr);var xr=[["path",{d:"M12 15V3",key:"m9g1x1"}],["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["path",{d:"m7 10 5 5 5-5",key:"brsn70"}]],Ua=p("download",xr);var Lr=[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]],Oe=p("external-link",Lr);var br=[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],_a=p("eye-off",br);var Ir=[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],za=p("eye",Ir);var Cr=[["path",{d:"M18 19a5 5 0 0 1-5-5v8",key:"sz5oeg"}],["path",{d:"M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",key:"1w6njk"}],["circle",{cx:"13",cy:"12",r:"2",key:"1j92g6"}],["circle",{cx:"20",cy:"19",r:"2",key:"1obnsp"}]],Ga=p("folder-git-2",Cr);var Sr=[["path",{d:"M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",key:"1bw5m7"}],["path",{d:"m21 21-1.9-1.9",key:"1g2n9r"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}]],ka=p("folder-search",Sr);var yr=[["path",{d:"M15 6a9 9 0 0 0-9 9V3",key:"1cii5b"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}]],ze=p("git-branch",yr);var wr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 21V9a9 9 0 0 0 9 9",key:"7kw0sc"}]],ra=p("git-merge",wr);var vr=[["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M6 9v12",key:"1sc30k"}],["path",{d:"m21 3-6 6",key:"16nqsk"}],["path",{d:"m21 9-6-6",key:"9j17rh"}],["path",{d:"M18 11.5V15",key:"65xf6f"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}]],sa=p("git-pull-request-closed",vr);var Pr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M18 6V5",key:"1oao2s"}],["path",{d:"M18 11v-1",key:"11c8tz"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],Ze=p("git-pull-request-draft",Pr);var kr=[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["line",{x1:"6",x2:"6",y1:"9",y2:"21",key:"rroup"}]],Le=p("git-pull-request",kr);var Ar=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]],Va=p("globe",Ar);var Rr=[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]],$a=p("layout-list",Rr);var Mr=[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]],Ge=p("link-2",Mr);var Tr=[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],V=p("loader-circle",Tr);var Dr=[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]],Je=p("mail-open",Dr);var Nr=[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]],na=p("mail",Nr);var Br=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]],fa=p("panel-left-close",Br);var Fr=[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],Ye=p("pen",Fr);var Er=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]],Aa=p("plus",Er);var Hr=[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]],ke=p("refresh-cw",Hr);var Or=[["path",{d:"m21 21-4.34-4.34",key:"14j7rj"}],["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}]],Ra=p("search",Or);var qr=[["path",{d:"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",key:"1i5ecw"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]],ja=p("settings",qr);var Ur=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]],Wa=p("shield-alert",Ur);var _r=[["path",{d:"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",key:"1s2grr"}],["path",{d:"M20 2v4",key:"1rf3ol"}],["path",{d:"M22 4h-4",key:"gwowj6"}],["circle",{cx:"4",cy:"20",r:"2",key:"6kqj1y"}]],qe=p("sparkles",_r);var zr=[["path",{d:"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344",key:"2acyp4"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],pa=p("square-check-big",zr);var Gr=[["path",{d:"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",key:"r04s7s"}]],Ve=p("star",Gr);var Vr=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],ge=p("trash-2",Vr);var $r=[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],$e=p("triangle-alert",$r);var jr=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]],Ka=p("users",jr);var Wr=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]],Xa=p("wifi-off",Wr);var Kr=[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]],Ca=p("wifi",Kr);var Xr=[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",key:"1ngwbx"}]],Za=p("wrench",Xr);var Zr=[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]],Se=p("x",Zr);var Ya={fast:{id:"fast",label:"Fast",warnHours:1,dangerHours:2},standard:{id:"standard",label:"Standard",warnHours:4,dangerHours:6},"long-running":{id:"long-running",label:"Long-running",warnHours:12,dangerHours:24}},rt="standard",Ja={fast:{id:"fast",label:"Fast",warnDays:1,dangerDays:2},standard:{id:"standard",label:"Standard",warnDays:3,dangerDays:5},"long-running":{id:"long-running",label:"Long-running",warnDays:7,dangerDays:14}},st="standard";function Jr(e){let o=e?.buildTisPreset??e?.tisPreset;return o&&o in Ya?o:rt}function Kt(e,o){let s=(e??"").toLowerCase();return s?(o??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s):void 0}function Qa(e,o,s,r){let i=Kt(e,o);if(i){let n=Ya[Jr(i)];return{warnHours:n.warnHours,dangerHours:n.dangerHours}}return{warnHours:s,dangerHours:r}}function It(e,o,s,r){let i=Kt(e,o);if(i){let n=i.reviewTisPreset&&i.reviewTisPreset in Ja?i.reviewTisPreset:st,l=Ja[n];return{warnDays:l.warnDays,dangerDays:l.dangerDays}}return{warnDays:s,dangerDays:r}}var Xt={disconnectedHosts:[],outageHosts:[],remoteGone:[],keptGone:[]},Ct="organizations",Sa={pollIntervalMinutes:15,notifyOnChange:!0,badgeMode:"total",watchedRepos:[],watchedPeople:[],relevanceModes:{authored:!0,reviewRequested:!0,involved:!0},autoDiscover:!1,discoverHosts:void 0,tisWarnHours:4,tisDangerHours:6,reviewWarnDays:3,reviewDangerDays:5,gusLocatorBaseUrl:void 0,settingsActiveNav:Ct,organizations:[],repositories:[],orgDiscovered:!1,authorDiscovered:!1,notifyInApp:!0,sendToInbox:!1,autoSyncEnabled:!0},Ae="monitoredCount",ie="monitoredPrs",ya="settings",et="prefetch:orgs",St="prefetch:repos",yt="prefetch:author",Yr=/^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;function wt(e){let o=Yr.exec(e);if(!o)throw new Error(`Not a GitHub PR URL: ${e}`);return o[1]}var Qr={failed:7,conflict:6,yellow:5,"review-required":4,pending:3,integrating:2,green:1,"closed-abandoned":0,"closed-merged":0};function vt(e){return Qr[e]}var es={conflict:1,failed:2,yellow:3,"review-required":4,pending:5,integrating:6,green:7,"closed-merged":8,"closed-abandoned":9};function Pt(e){return es[e]}var as=/\bW-\d{8}\b/i;function ma(e,o,s){for(let r of[e,o,s]){if(typeof r!="string"||!r)continue;let i=as.exec(r);if(i)return i[0].toUpperCase()}}function nt(e,o){if(!e||!o||!/^W-\d{8}$/i.test(e))return null;let s;try{s=new URL(o)}catch{return null}return s.protocol!=="http:"&&s.protocol!=="https:"?null:`${o.replace(/\/+$/,"")}/${encodeURIComponent(e.toUpperCase())}`}var Zt=globalThis.__ZCC_HOST_REACT__,re=Zt.Fragment;function a(e,o,s){return Zt.createElement(e,s===void 0?o:{...o,key:s})}var t=a;function Jt({onSave:e}){let[o,s]=d(!1),r=async()=>{s(!0);try{await e({...Sa})}finally{s(!1)}};return a("div",{className:"prm-setup-gate",children:t("div",{className:"prm-setup",children:[a(Le,{size:32,"aria-hidden":!0}),a("h3",{children:"Set up PR Monitor"}),a("p",{children:"Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in."}),a("div",{className:"prm-empty-actions",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void r(),disabled:o,children:o?"Saving\u2026":"Get started"})})]})})}function je(e){let o=Date.now(),s=Math.max(0,o-e),r=Math.floor(s/1e3);if(r<60)return"just now";let i=Math.floor(r/60);if(i<60)return`${i}m ago`;let n=Math.floor(i/60);if(n<24)return`${n}h ago`;let l=Math.floor(n/24);if(l===1)return"yesterday";if(l<30)return`${l}d ago`;let u=Math.floor(l/30);return u<12?`${u}mo ago`:`${Math.floor(u/12)}y ago`}var ts={pending:"Pending",failed:"Failing",conflict:"Merge conflict",yellow:"Merge blocked","review-required":"Review required",integrating:"Merging",green:"All checks passing","closed-merged":"Merged","closed-abandoned":"Closed"};function Ne(e){return ts[e]}function Yt(e){return e.endsWith(".salesforce.com")?e.slice(0,-15):e}function lt(e){let o=0,s=0,r=0;for(let i of e){let n=i.state.toUpperCase();n==="SUCCESS"||n==="PASS"||n==="PASSED"?o++:n==="FAILURE"||n==="FAILED"||n==="ERROR"||n==="CANCELLED"?s++:r++}return{pass:o,fail:s,pending:r}}var os={SUCCESS:"pass",PASS:"pass",PASSED:"pass",FAILURE:"fail",FAILED:"fail",ERROR:"fail",CANCELLED:"fail"};function Qt(e){return os[e.toUpperCase()]??"pending"}function it(e){return{label:Ne(e),className:`prm-status-pill--${e}`}}var We=4,Ke=6,wa=3,va=5;function ga(e){if(!e)return"";let o=Math.max(0,Date.now()-e),s=Math.floor(o/(1e3*60));if(s<60)return`${s}m`;let r=Math.floor(s/60);return r<24?`${r}h`:`${Math.floor(r/24)}d`}function ha(e,o){let s=o==="build"?"Build":"Review";return e==="danger"?`${s} stalled`:e==="warn"?`${s} slow`:""}function xa(e){let o=e.name||e.login,s=o.split(/[\s._-]+/).filter(Boolean);return s.length>=2?(s[0][0]+s[1][0]).toUpperCase():o.slice(0,2).toUpperCase()}async function ye(e,o,s){try{let r=await e.call(o,s);if(!r?.ok)throw new Error(r?.error||"The request failed. Please try again.");Array.isArray(r.prs)&&(e.cache.set(ie,r.prs),e.cache.set(Ae,r.prs.length),e.cache.refreshBadge())}catch(r){e.toast(`Couldn't update PR \u2014 ${r instanceof Error?r.message:String(r)}`,"error")}}var rs=new Set(["fail","failure"]),ss=new Set(["pending","in_progress","queued"]);function ns(e){return(e??"").toLowerCase().trim()||"pending"}function ls(e,o){if(!o||o.length===0)return!1;let s=(e??"").toLowerCase();return o.some(r=>{let i=(r??"").toLowerCase();return i.length>0&&s.includes(i)})}function Ma(e,o={}){if(!e||e.length===0)return!1;let s=o.ignoredFailingChecks;for(let r of e){let i=ns(r.bucket||r.state);if(ss.has(i)||rs.has(i)&&!ls(r.name,s))return!1}return!0}function Ta(e){let{status:o,buildHappy:s,reviewApproved:r,sfciGated:i,hasSfciJob:n,elapsedHours:l,warnHours:u,dangerHours:I}=e;if(o==="integrating"||o==="closed-merged"||o==="closed-abandoned")return"done";let m=i&&!n;return s&&r&&o==="yellow"?m?"blocked":l>=I?"merge-stall":l>=u?"warn":"ok":s?"done":m?"blocked":l>=I?"danger":l>=u?"warn":"ok"}function dt(e){let{reviewApproved:o,merged:s,elapsedDays:r,warnDays:i,dangerDays:n}=e;return o&&!s?"done":r>=n?"danger":r>=i?"warn":"ok"}function is(e){if(typeof document>"u")return!1;let o=document.createElement("textarea");o.value=e,o.style.position="fixed",o.style.top="-9999px",o.setAttribute("readonly",""),document.body.appendChild(o);try{return o.select(),document.execCommand("copy")}catch{return!1}finally{document.body.removeChild(o)}}async function Da(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}return is(e)}var ds=Symbol.for("react.portal");function La(e,o){return{$$typeof:ds,key:null,children:e,containerInfo:o,implementation:null}}var ut=4,ct=8,eo=120,us=320,cs=280;function fs(e,o){let s=o.innerHeight-e.bottom-ut-ct,r=e.top-ut-ct,i=s<eo&&r>s,n=Math.max(eo,Math.min(us,i?r:s)),l=Math.max(ct,Math.min(e.left,o.innerWidth-cs-ct));return i?{left:l,bottom:o.innerHeight-e.top+ut,maxHeight:n}:{left:l,top:e.bottom+ut,maxHeight:n}}function ft({projectId:e,projects:o,onAssign:s}){let r=ue(null),i=ue(null),[n,l]=d(!1),[u,I]=d(null),m=o.find(g=>g.id===e),b=!!m;q(()=>{if(!n)return;let g=r.current;g&&I(fs(g.getBoundingClientRect(),window))},[n]),q(()=>{if(!n||!u)return;let g=i.current;(g?.querySelector(".is-active")??g?.querySelector("button")??g)?.focus()},[n,u]);let C=()=>{l(!1),r.current?.focus()},w=b?`Associated with ${m.name} \u2014 change or clear the Project`:"Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";return t(re,{children:[t("button",{ref:r,type:"button",className:`prm-project-row ${b?"prm-project-row--associated":"prm-project-row--unassociated"}`,title:w,"aria-label":w,"aria-haspopup":"menu","aria-expanded":n,onClick:g=>{g.stopPropagation(),l(v=>!v)},children:[a(Ga,{size:11,className:"prm-project-row-icon","aria-hidden":!0}),a("span",{className:"prm-project-row-name",children:b?m.name:"Not associated with a project"})]}),n&&u&&typeof document<"u"&&La(t(re,{children:[a("div",{className:"prm-project-menu-backdrop",onClick:g=>{g.stopPropagation(),C()}}),t("div",{ref:i,className:"prm-tile-menu prm-project-picker",style:{position:"fixed",...u},role:"menu","aria-label":"Associate a project",tabIndex:-1,onKeyDown:g=>{if(g.key==="Escape"||g.key==="Tab")g.preventDefault(),g.stopPropagation(),C();else if(["ArrowDown","ArrowUp","Home","End"].includes(g.key)){g.preventDefault(),g.stopPropagation();let v=Array.from(g.currentTarget.querySelectorAll("button")),x=v.indexOf(document.activeElement),f=g.key==="Home"?0:g.key==="End"?v.length-1:(x+(g.key==="ArrowDown"?1:-1)+v.length)%v.length;v[f]?.focus()}},children:[o.length===0&&a("div",{className:"prm-project-menu-empty",children:"No projects"}),b&&a("button",{type:"button",className:"prm-project-menu-item",role:"menuitem",onClick:g=>{g.stopPropagation(),s(null),C()},children:"Clear association"}),o.map(g=>a("button",{type:"button",className:`prm-project-menu-item ${g.id===e?"is-active":""}`,role:"menuitem",onClick:v=>{v.stopPropagation(),s(g.id),C()},children:g.name},g.id))]})]}),document.body)]})}function pt({checks:e}){return e.length===0?a("div",{className:"prm-checks-empty",children:"No check runs reported."}):a("ul",{className:"prm-checks-list",role:"list",children:e.map(o=>{let s=Qt(o.state);return t("li",{className:"prm-check-row",children:[a("span",{className:`prm-check-state-pip prm-check-state-pip--${s}`,"aria-hidden":!0}),a("span",{className:"prm-check-name",children:o.name}),o.bucket&&a("span",{className:"prm-check-bucket",children:o.bucket}),a("span",{className:"prm-check-state",title:o.state,children:o.state.toLowerCase()})]},`${o.bucket??""}/${o.name}`)})})}function ao(e){try{let o=new URL(e);return o.protocol==="http:"||o.protocol==="https:"}catch{return!1}}var ps=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}],ms=["seen","favorite","mute","dismiss"];function to({pr:e,host:o,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:n,reviewDangerDays:l,sfciGated:u=!1,ignoredFailingChecks:I,workItemLocatorBase:m,selected:b,onToggleSelect:C,onDismiss:w,onProjectAssign:g}){let[v,x]=d(!1),[f,D]=d(!1),A=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),T=e.workItem??ma(e.title,e.headRefName,e.body),N=nt(T,m),_=it(e.status),X=e.status==="closed-merged"||e.status==="closed-abandoned",z=!!e.muted,U=!!e.favorite,$=!!e.syncError,y=e.checks??[],F=lt(y),W=e.reviewDecision==="APPROVED",J=e.buildHappy??Ma(y,{ignoredFailingChecks:I}),P=Ta({status:e.status,buildHappy:J,reviewApproved:W,sfciGated:u,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??We,dangerHours:i??Ke}),fe=ga(e.lastStatusChange),se=P==="merge-stall"||P==="danger"?"danger":P==="warn"?"warn":"ok",E=P==="done"?"Build \u2713":P==="merge-stall"?"Merge stalled":ha(se,"build"),be=P==="done"?"done":se,Re=!e.isDraft&&!X,R=e.status==="closed-merged",B=dt({reviewApproved:W,merged:R,elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:n??wa,dangerDays:l??va}),M=ga(e.reviewClockStartedAt),ae=B==="danger"?"danger":B==="warn"?"warn":"ok",ne=B==="done"?"Review \u2713":ha(ae,"review"),Ie=B==="done"?"done":ae,pe=e.reviewers??[],me={"changes-requested":pe.filter(k=>k.state==="changes-requested"),"review-requested":pe.filter(k=>k.state==="review-requested"),approved:pe.filter(k=>k.state==="approved")},we=pe.length>0,ea=()=>{ao(e.url)?o.openExternal(e.url):o.toast("Refusing to open a non-http(s) URL","error")},ia=e.isDraft?Ze:e.status==="closed-merged"?ra:e.status==="closed-abandoned"?sa:Le,ba=async()=>{A&&await ye(o,"markPrAsSeen",{url:e.url})},ve=async()=>{await ye(o,A?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},da=async()=>{await ye(o,"setPrMuted",{url:e.url,muted:!z})},Xe=async()=>{await ye(o,"setPrFavorite",{url:e.url,favorite:!U})},Q=async k=>{k.stopPropagation(),D(!0);try{await ye(o,"retryPr",{url:e.url})}finally{D(!1)}},ee=async(k,c)=>{await Da(k)?o.toast(`${c} copied`,"info"):o.toast(`Failed to copy ${c}`,"error")},le=y.length>0,te=le?` \u2014 click to ${v?"hide":"show"} checks`:"",Y=k=>{k.stopPropagation(),x(c=>!c)},Ue=k=>{(k.key==="Enter"||k.key===" ")&&(k.preventDefault(),Y(k))},Me=k=>le?{role:"button",tabIndex:0,"aria-expanded":v,title:k,"data-tip":k,onClick:Y,onKeyDown:Ue}:{},ce=le?" prm-tip prm-checks-trigger":"",Te=`${_.label} \u2014 overall PR status${te}`,De=`${F.pass} passing, ${F.fail} failing, ${F.pending} running`,h=P==="done"?"Build passing":P==="merge-stall"?"Merge stalled":P==="blocked"?"Build waiting (SFCI job not yet created)":E||"Build running",L=`${h} \xB7 ${fe} in build phase \xB7 ${De}${te}`,S=B==="done"?"Review approved":ne||"Awaiting review",H=`${S} \xB7 ${M} in review${te}`,K=`${De}${te}`,he={seen:{Icon:A?Je:na,label:A?"Mark read":"Mark unread",title:A?"Mark this PR as read (seen)":"Mark this PR as unread"},favorite:{Icon:Ve,label:U?"Unfavorite":"Favorite",title:U?"Unfavorite \u2014 remove this PR from favorites":"Favorite \u2014 mark this PR to find it faster",active:U},mute:{Icon:z?ta:Be,label:z?"Unmute":"Mute",title:z?"Unmute \u2014 resume notifications for this PR":"Mute \u2014 silence notifications for this PR"},dismiss:{Icon:ge,label:"Dismiss",title:"Dismiss \u2014 remove this PR from the monitored list",danger:!0}},Ce=k=>{k==="seen"?ve():k==="favorite"?Xe():k==="mute"?da():w(e.url)};return t("div",{className:`prm-tile ${A?"prm-tile--unread":""} ${X?"prm-tile--closed":""} ${$?"prm-tile--stale":""} ${U?"prm-tile--favorite":""} ${b?"prm-tile--selected":""}`,onClick:ba,role:"button",tabIndex:0,onKeyDown:k=>{(k.key==="Enter"||k.key===" ")&&(k.preventDefault(),ba())},children:[t("div",{className:"prm-tile-line1",children:[a("input",{type:"checkbox",className:"prm-tile-select",checked:b,title:b?"Deselect this PR":"Select this PR","aria-label":b?"Deselect this PR":"Select this PR",onClick:k=>k.stopPropagation(),onChange:k=>{k.stopPropagation(),C(e.url)}}),a(ia,{size:14,className:"prm-tile-state-icon","aria-hidden":!0}),t("span",{className:"prm-tile-title",children:[T&&t("span",{className:"prm-tile-workitem-inline",children:["@",T,": "]}),e.title.replace(new RegExp(`(?:^|@)${T}[:\\s]*`,"i"),"")]}),a("span",{className:`prm-status-pill ${_.className} prm-tip${ce}`,title:Te,"data-tip":Te,...Me(Te),children:_.label}),le?t("span",{className:`prm-tis prm-tis--${be} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":v,title:L,"data-tip":L,"aria-label":`${h}, ${fe} in build phase`,onClick:Y,onKeyDown:Ue,children:[fe,E&&t("span",{className:"prm-tis-cue",children:[" ",E]})]}):t("span",{className:`prm-tis prm-tis--${be} prm-tip`,title:L,"data-tip":L,"aria-label":`${h}, ${fe} in build phase`,children:[fe,E&&t("span",{className:"prm-tis-cue",children:[" ",E]})]}),Re&&(M||ne)&&(le?t("span",{className:`prm-tis prm-tis--review prm-tis--${Ie} prm-tip prm-checks-trigger`,role:"button",tabIndex:0,"aria-expanded":v,title:H,"data-tip":H,"aria-label":`${S}, ${M} in review`,onClick:Y,onKeyDown:Ue,children:[M,ne&&t("span",{className:"prm-tis-cue",children:[" ",ne]})]}):t("span",{className:`prm-tis prm-tis--review prm-tis--${Ie} prm-tip`,title:H,"data-tip":H,"aria-label":`${S}, ${M} in review`,children:[M,ne&&t("span",{className:"prm-tis-cue",children:[" ",ne]})]})),y.length>0&&t("span",{className:"prm-check-pips prm-tip prm-checks-trigger","aria-label":`Checks: ${F.pass} passed, ${F.fail} failed, ${F.pending} running`,...Me(K),children:[F.pass>0&&t("span",{className:"prm-check-pip prm-check-pip--pass",children:[a(_e,{size:9})," ",F.pass]}),F.fail>0&&t("span",{className:"prm-check-pip prm-check-pip--fail",children:[a(Se,{size:9})," ",F.fail]}),F.pending>0&&t("span",{className:"prm-check-pip prm-check-pip--pending",children:[a(He,{size:9})," ",F.pending]})]}),z&&a("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced for this PR","aria-label":"Muted",children:a(ta,{size:11})}),$&&t("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}. Showing last-known (stale) status.`,children:[a(Fe,{size:11,className:"prm-sync-error-icon","aria-hidden":!0}),a("span",{className:"prm-sync-error-text",children:"stale"}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Retry \u2014 re-fetch just this PR","data-tip":"Retry sync","aria-label":"Retry syncing this PR",disabled:f,onClick:k=>void Q(k),children:a(ke,{size:10,className:f?"prm-spin":""})})]}),a("span",{className:"prm-tile-actions",children:ms.map(k=>{let c=he[k],O=c.Icon;return a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${c.danger?" prm-tile-icon-btn--danger":""}${c.active?" prm-tile-icon-btn--active":""}`,title:c.title,"data-tip":c.label,"aria-label":c.label,"aria-pressed":c.active,onClick:G=>{G.stopPropagation(),Ce(k)},children:a(O,{size:13,...c.active?{fill:"currentColor"}:{}})},k)})})]}),t("div",{className:"prm-tile-line2",children:[T&&(N?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${T}`,onClick:k=>{k.stopPropagation(),ao(N)&&o.openExternal(N)},children:T}):a("span",{className:"prm-workitem-chip",children:T})),a("span",{className:"prm-tile-repo",children:e.repo}),t("span",{className:"prm-tile-number",children:["#",e.number,a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:k=>{k.stopPropagation(),ea()},children:a(Oe,{size:10})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:k=>{k.stopPropagation(),ee(e.url,"PR link")},children:a(Ge,{size:10})})]}),e.author&&t("span",{className:"prm-author",children:[a("span",{className:"prm-avatar prm-avatar--initials",children:xa(e.author)}),a("span",{className:"prm-author-name",children:e.author.name||e.author.login})]}),e.isDraft&&a("span",{className:"prm-draft-pill",children:"Draft"})]}),(e.headRefName||e.baseRefName)&&t("div",{className:"prm-tile-line3",children:[a(ze,{size:10,className:"prm-branch-icon","aria-hidden":!0}),t("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:k=>{k.stopPropagation(),ee(e.headRefName,"Branch name")},children:a(Ge,{size:10})})]}),we&&a("div",{className:"prm-reviewers",children:ps.map(({state:k,label:c,className:O})=>{let G=me[k];return G.length===0?null:t("span",{className:`prm-reviewers-group ${O}`,title:c,children:[a("span",{className:"prm-reviewers-label",children:c}),G.map(de=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:de.name||de.login,"aria-label":`${c}: ${de.name||de.login}`,children:xa(de)},de.login))]},k)})}),e.body&&a("div",{className:"prm-desc",children:e.body}),a(ft,{projectId:e.projectId,projects:s,onAssign:k=>g(e.url,k)}),v&&y.length>0&&a("div",{className:"prm-tile-checks",onClick:k=>k.stopPropagation(),children:a(pt,{checks:y})})]})}function oo({anchorRef:e,hosts:o,selectedHosts:s,onClose:r,onToggleHost:i,onSelectAll:n,shortHost:l}){let[u,I]=d(null);if(q(()=>{let b=e.current;if(!b)return;let C=b.getBoundingClientRect();I({top:C.bottom+4,left:C.left})},[e]),q(()=>{let b=C=>{C.key==="Escape"&&r()};return window.addEventListener("keydown",b),()=>window.removeEventListener("keydown",b)},[r]),!u||typeof document>"u")return null;let m=s.length===0;return La(t(re,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:b=>{b.stopPropagation(),r()}}),t("div",{className:"prm-tile-menu prm-host-filter",style:{position:"fixed",top:u.top,left:u.left},role:"menu",children:[t("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Host"}),a("span",{className:"prm-sync-filter-desc",children:"Show PRs from specific git hosts."})]}),t("button",{type:"button",className:`prm-project-menu-item ${m?"is-active":""}`,role:"menuitemcheckbox","aria-checked":m,onClick:b=>{b.stopPropagation(),n()},title:"Show PRs from all hosts",children:[a("span",{className:"prm-sync-filter-check",children:m&&a(_e,{size:12})}),"All hosts"]}),o.map(b=>{let C=s.includes(b);return t("button",{type:"button",className:`prm-project-menu-item ${C?"is-active":""}`,role:"menuitemcheckbox","aria-checked":C,onClick:w=>{w.stopPropagation(),i(b)},title:`Filter to ${b}`,children:[a("span",{className:"prm-sync-filter-check",children:C&&a(_e,{size:12})}),l(b)]},b)})]})]}),document.body)}var gs='button, a, input, textarea, select, [contenteditable="true"]';function ro(e){return!e||typeof e.closest!="function"?!1:e.closest(gs)!==null}function so(e,o,s){return{left:e.left-(o-e.x),top:e.top-(s-e.y)}}function kt(){let e=ue(null),[o,s]=d(!1),r=Z(l=>{let u=e.current;!u||u.id!==l.pointerId||(e.current=null,s(!1),l.currentTarget.hasPointerCapture(l.pointerId)&&l.currentTarget.releasePointerCapture(l.pointerId))},[]),i=Z(l=>{l.button!==0||ro(l.target)||(e.current={id:l.pointerId,x:l.clientX,y:l.clientY,left:l.currentTarget.scrollLeft,top:l.currentTarget.scrollTop},l.currentTarget.setPointerCapture(l.pointerId),s(!0))},[]),n=Z(l=>{let u=e.current;if(!u||u.id!==l.pointerId)return;let I=so(u,l.clientX,l.clientY);l.currentTarget.scrollLeft=I.left,l.currentTarget.scrollTop=I.top},[]);return{isPanning:o,canvasPanProps:{onPointerDown:i,onPointerMove:n,onPointerUp:r,onPointerCancel:r}}}var At=`.zcc-kanban {
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
`;function xs(e){return e==null?{"--zcc-kanban-col-min":"200px","--zcc-kanban-col-flex":"1 1 200px","--zcc-kanban-col-width":"auto"}:{"--zcc-kanban-col-min":`${e}px`,"--zcc-kanban-col-flex":`0 0 ${e}px`,"--zcc-kanban-col-width":`${e}px`}}function no({children:e,className:o="",label:s,columnWidth:r}){let{isPanning:i,canvasPanProps:n}=kt();return a("div",{role:"list","aria-label":s,className:["zcc-kanban",i?"is-panning":"",o].filter(Boolean).join(" "),style:xs(r),...n,children:e})}function lo({children:e,className:o="",columnId:s,label:r,count:i,icon:n,badge:l,collapsed:u=!1,onToggleCollapse:I,onContextMenu:m}){let b=u?`Expand ${r}`:`Collapse ${r}`;return t("section",{role:"listitem",className:["zcc-kanban-col",u?"is-collapsed":"",o].filter(Boolean).join(" "),"aria-label":`${r} (${i})`,"data-kanban-column":s,"data-board-column":s,"data-collapsed":u?"true":"false",onContextMenu:m,children:[t("header",{className:"zcc-kanban-col-header",children:[n?a("span",{className:"zcc-kanban-col-icon","aria-hidden":!0,children:n}):null,a("span",{className:"zcc-kanban-col-title",children:r}),a("span",{className:"zcc-kanban-col-count",children:i}),l,I?a("button",{type:"button",className:"zcc-kanban-col-collapse",title:b,"aria-label":b,"aria-expanded":!u,onClick:()=>I(s),children:u?a(oa,{size:13}):a(fa,{size:13})}):null]}),u?null:a("div",{className:"zcc-kanban-col-body",children:e})]})}var Rt=["conflict","failed","yellow","review-required","pending","integrating","green"],io=["closed-merged","closed-abandoned"],uo={conflict:"Conflict",failed:"Failing",yellow:"Blocked","review-required":"Review",pending:"Pending",integrating:"Merging",green:"Ready","closed-merged":"Merged","closed-abandoned":"Closed"};function Mt(e){return e==="list"||e==="board"}function Ls(){return{conflict:[],failed:[],yellow:[],"review-required":[],pending:[],integrating:[],green:[],"closed-merged":[],"closed-abandoned":[]}}function mt(e){let o=Ls();for(let s of e)o[s.status].push(s);return o}function co(e){return{conflict:e.conflict.length,failed:e.failed.length,yellow:e.yellow.length,"review-required":e["review-required"].length,pending:e.pending.length,integrating:e.integrating.length,green:e.green.length,"closed-merged":e["closed-merged"].length,"closed-abandoned":e["closed-abandoned"].length}}var fo=[...Rt,...io];function po(e){return typeof e=="string"&&fo.includes(e)}function mo(e,o={}){let s=co(e);return o.showEmpty?[...Rt,...io.filter(r=>s[r]>0)]:fo.filter(r=>s[r]>0)}function go(e){let o=co(e);return Rt.filter(s=>o[s]===0).length}function ho(e){let o=e.lastIndexOf("/");return o>=0?e.slice(o+1):e}function bs(e){try{let o=new URL(e);return o.protocol==="http:"||o.protocol==="https:"}catch{return!1}}function Is(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function xo({pr:e,host:o,tisWarnHours:s,tisDangerHours:r,ignoredFailingChecks:i,selected:n,selectionActive:l=!1,selectMode:u=!1,onToggleSelect:I,onDismiss:m,onOpen:b}){let[C,w]=d(!1),g=Is(e),v=e.status==="closed-merged"||e.status==="closed-abandoned",x=!!e.favorite,f=!!e.syncError,D=e.workItem??ma(e.title,e.headRefName,e.body),A=D?e.title.replace(new RegExp(`(?:^|@)${D}[:\\s]*`,"i"),""):e.title,T=e.checks??[],N=lt(T),_=e.updatedAt||e.lastChecked||e.lastStatusChange,X=e.buildHappy??Ma(T,{ignoredFailingChecks:i}),z=Ta({status:e.status,buildHappy:X,reviewApproved:e.reviewDecision==="APPROVED",sfciGated:!1,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:s??We,dangerHours:r??Ke}),U=z==="merge-stall"?"Merge stalled":z==="warn"||z==="danger"?ha(z,"build"):"",$=z==="merge-stall"||z==="danger"?"danger":z==="warn"?"warn":"",y=n||u||l,F=async()=>{g&&await ye(o,"markPrAsSeen",{url:e.url})},W=async()=>{await ye(o,"setPrFavorite",{url:e.url,favorite:!x})},J=()=>{bs(e.url)?o.openExternal(e.url):o.toast("Refusing to open a non-http(s) URL","error")},P=async()=>{w(!0);try{await ye(o,"retryPr",{url:e.url})}finally{w(!1)}},fe=()=>{b(e.url),F()},se=E=>{if(E.metaKey||E.ctrlKey||u){I(e.url);return}fe()};return t("article",{className:["prm-board-card",g?"prm-board-card--unread":"",v?"prm-board-card--closed":"",x?"prm-board-card--favorite":"",n?"prm-board-card--selected":"",f?"prm-board-card--stale":"",y?"prm-board-card--selectable":"",u?"prm-board-card--select-mode":""].filter(Boolean).join(" "),onClick:se,onPointerDown:E=>E.stopPropagation(),onKeyDown:E=>{E.target===E.currentTarget&&(E.key==="Enter"||E.key===" ")&&(E.preventDefault(),u||E.metaKey||E.ctrlKey?I(e.url):fe())},role:"listitem",tabIndex:0,"aria-haspopup":"dialog","aria-label":`${e.repo} #${e.number}: ${e.title}`,children:[t("div",{className:"prm-board-card-top",children:[a("input",{type:"checkbox",className:"prm-board-card-select",checked:n,title:n?"Deselect this PR":"Select this PR","aria-label":n?"Deselect this PR":"Select this PR",onClick:E=>E.stopPropagation(),onChange:E=>{E.stopPropagation(),I(e.url)}}),t("span",{className:"prm-board-card-id",children:[t("span",{className:"prm-board-card-num",children:["#",e.number]}),a("span",{className:"prm-board-card-repo",title:e.repo,children:ho(e.repo)})]}),D&&a("span",{className:"prm-workitem-chip prm-board-card-wi",children:D}),t("span",{className:"prm-board-card-actions",children:[a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${x?" prm-tile-icon-btn--active":""}`,title:x?"Unfavorite":"Favorite","data-tip":x?"Unfavorite":"Favorite","aria-label":x?"Unfavorite":"Favorite","aria-pressed":x,onClick:E=>{E.stopPropagation(),W()},children:a(Ve,{size:12,...x?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:E=>{E.stopPropagation(),J()},children:a(Oe,{size:12})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:E=>{E.stopPropagation(),m(e.url)},children:a(ge,{size:12})})]})]}),a("div",{className:"prm-board-card-title",children:A}),t("div",{className:"prm-board-card-meta",children:[e.author&&a("span",{className:"prm-avatar prm-avatar--initials",title:e.author.name||e.author.login,children:xa(e.author)}),U?t("span",{className:`prm-tis prm-tis--${$} prm-board-card-stall`,children:[ga(e.lastStatusChange)," ",U]}):_>0&&a("span",{className:"prm-board-card-time",children:je(_)}),N.fail>0&&t("span",{className:"prm-check-pip prm-check-pip--fail","aria-label":`${N.fail} checks failing`,children:[a(Se,{size:9})," ",N.fail]}),N.pending>0&&t("span",{className:"prm-check-pip prm-check-pip--pending","aria-label":`${N.pending} checks running`,children:[a(He,{size:9})," ",N.pending]}),e.isDraft&&t("span",{className:"prm-draft-pill prm-board-card-draft",children:[a(Ze,{size:10,"aria-hidden":!0})," Draft"]}),f&&t("span",{className:"prm-sync-error",title:`Couldn't sync this PR: ${e.syncError}`,children:[a(Fe,{size:11,"aria-hidden":!0}),a("button",{type:"button",className:"prm-tile-icon-btn",title:"Retry sync","aria-label":"Retry syncing this PR",disabled:C,onClick:E=>{E.stopPropagation(),P()},children:a(ke,{size:10,className:C?"prm-spin":""})})]})]})]})}var Cs={conflict:Wa,failed:Pe,yellow:$e,"review-required":za,pending:Oa,integrating:V,green:xe,"closed-merged":ra,"closed-abandoned":sa};function Lo({prs:e,host:o,tisWarnHours:s,tisDangerHours:r,repositories:i,selected:n,selectMode:l=!1,showEmpty:u=!1,collapsed:I,onToggleCollapse:m,onToggleSelect:b,onDismiss:C,onOpen:w}){let g=oe(()=>mt(e),[e]),v=oe(()=>mo(g,{showEmpty:u}),[g,u]),x=n.size>0||l;return a(no,{label:"Pull requests by status",className:"prm-board",children:v.map(f=>{let D=g[f],A=Cs[f],T=I.has(f),N=D.filter(_=>_.lastSeenAt===0||_.lastStatusChange>(_.lastSeenAt??_.addedAt)).length;return a(lo,{columnId:f,className:`prm-board-col--${f}`,label:uo[f],count:D.length,icon:a(A,{size:14,"aria-hidden":!0}),badge:N>0?a("span",{className:"zcc-kanban-col-badge",title:`${N} unread`,children:N}):null,collapsed:T,onToggleCollapse:_=>m(_),children:D.length===0?a("div",{className:"prm-board-col-empty",children:"No PRs"}):D.map(_=>{let X=Qa(_.repo,i,s??We,r??Ke),z=(i??[]).find(U=>`${U.owner}/${U.repo}`.toLowerCase()===_.repo.toLowerCase());return a(xo,{pr:_,host:o,tisWarnHours:X.warnHours,tisDangerHours:X.dangerHours,ignoredFailingChecks:z?.ignoredFailingChecks,selected:n.has(_.url),selectionActive:x,selectMode:l,onToggleSelect:b,onDismiss:C,onOpen:w},_.url)})},f)})})}var Ss=[{state:"changes-requested",label:"Changes requested",className:"prm-reviewers--changes"},{state:"review-requested",label:"Review requested",className:"prm-reviewers--requested"},{state:"approved",label:"Approved",className:"prm-reviewers--approved"}];function bo(e){try{let o=new URL(e);return o.protocol==="http:"||o.protocol==="https:"}catch{return!1}}function ys(e){return e.mergeable==="CONFLICTING"||e.mergeStateStatus==="DIRTY"?"Has merge conflicts":e.mergeStateStatus==="BLOCKED"?"Merge blocked":e.mergeStateStatus==="BEHIND"?"Branch is behind the base":e.mergeStateStatus==="UNSTABLE"?"Merge state unstable":null}function Io({pr:e,host:o,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:n,reviewDangerDays:l,sfciGated:u=!1,ignoredFailingChecks:I,workItemLocatorBase:m,onClose:b,onDismiss:C,onProjectAssign:w}){let[g,v]=d(!1),x=ue(null),f=ue(b);f.current=b,q(()=>{let Q=document.activeElement;x.current?.focus();let ee=le=>{if(!le.defaultPrevented&&(le.key==="Escape"&&(le.preventDefault(),f.current()),le.key==="Tab")){let te=x.current,Y=te?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]');if(!te||!Y?.length)return;let Ue=Y[0],Me=Y[Y.length-1];le.shiftKey&&(document.activeElement===Ue||document.activeElement===te)?(le.preventDefault(),Me.focus()):!le.shiftKey&&(document.activeElement===Me||document.activeElement===te)&&(le.preventDefault(),Ue.focus())}};return window.addEventListener("keydown",ee),()=>{window.removeEventListener("keydown",ee),Q?.isConnected&&Q.focus()}},[]);let D=e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt),A=e.status==="closed-merged"||e.status==="closed-abandoned",T=!!e.muted,N=!!e.favorite,_=!!e.syncError,X=e.workItem??ma(e.title,e.headRefName,e.body),z=nt(X,m),U=X?e.title.replace(new RegExp(`(?:^|@)${X}[:\\s]*`,"i"),""):e.title,$=it(e.status),y=e.checks??[],F=e.reviewers??[],W={"changes-requested":F.filter(Q=>Q.state==="changes-requested"),"review-requested":F.filter(Q=>Q.state==="review-requested"),approved:F.filter(Q=>Q.state==="approved")},J=ys(e),P=e.reviewDecision==="APPROVED",fe=e.buildHappy??Ma(y,{ignoredFailingChecks:I}),se=Ta({status:e.status,buildHappy:fe,reviewApproved:P,sfciGated:u,hasSfciJob:!!e.hasSfciJob,elapsedHours:e.lastStatusChange?Math.max(0,Date.now()-e.lastStatusChange)/36e5:0,warnHours:r??We,dangerHours:i??Ke}),E=ga(e.lastStatusChange),be=se==="merge-stall"||se==="danger"?"danger":se==="warn"?"warn":"ok",Re=se==="done"?"Build \u2713":se==="merge-stall"?"Merge stalled":ha(be,"build"),R=se==="done"?"done":be,B=!e.isDraft&&!A,M=dt({reviewApproved:P,merged:e.status==="closed-merged",elapsedDays:e.reviewClockStartedAt?Math.max(0,Date.now()-e.reviewClockStartedAt)/864e5:0,warnDays:n??wa,dangerDays:l??va}),ae=ga(e.reviewClockStartedAt),ne=M==="danger"?"danger":M==="warn"?"warn":"ok",Ie=M==="done"?"Review \u2713":ha(ne,"review"),pe=M==="done"?"done":ne,me=e.isDraft?Ze:e.status==="closed-merged"?ra:e.status==="closed-abandoned"?sa:Le,we=()=>{bo(e.url)?o.openExternal(e.url):o.toast("Refusing to open a non-http(s) URL","error")},ea=async(Q,ee)=>{await Da(Q)?o.toast(`${ee} copied`,"info"):o.toast(`Failed to copy ${ee}`,"error")},ia=async()=>{await ye(o,D?"markPrAsSeen":"markPrAsUnseen",{url:e.url})},ba=async()=>{await ye(o,"setPrMuted",{url:e.url,muted:!T})},ve=async()=>{await ye(o,"setPrFavorite",{url:e.url,favorite:!N})},da=async()=>{v(!0);try{await ye(o,"retryPr",{url:e.url})}finally{v(!1)}},Xe=a("div",{className:"modal-backdrop",onClick:b,"data-testid":"prm-detail-backdrop",children:t("div",{ref:x,tabIndex:-1,className:"modal prm-modal prm-modal--detail",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-detail-title",onClick:Q=>Q.stopPropagation(),children:[t("header",{className:"prm-modal-header",children:[t("h3",{id:"prm-detail-title",children:[a(me,{size:14,"aria-hidden":!0}),t("span",{className:"prm-detail-id",children:["#",e.number,a("span",{className:"prm-detail-repo",children:e.repo})]})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:b,title:"Close","aria-label":"Close PR details",children:a(Se,{size:14})})]}),t("div",{className:"prm-modal-body prm-detail-body",children:[t("div",{className:"prm-detail-heading",children:[X&&(z?a("button",{type:"button",className:"prm-workitem-chip prm-workitem-chip--link",title:`Open ${X}`,onClick:()=>{bo(z)&&o.openExternal(z)},children:X}):a("span",{className:"prm-workitem-chip",children:X})),a("h4",{className:"prm-detail-pr-title",children:U})]}),t("div",{className:"prm-detail-status-row",children:[a("span",{className:`prm-status-pill ${$.className}`,children:$.label}),e.isDraft&&t("span",{className:"prm-draft-pill",children:[a(Ze,{size:10,"aria-hidden":!0})," Draft"]}),T&&t("span",{className:"prm-mute-indicator",title:"Muted \u2014 notifications silenced",children:[a(ta,{size:11,"aria-hidden":!0})," Muted"]}),E&&t("span",{className:`prm-tis prm-tis--${R}`,children:[E,Re&&t("span",{className:"prm-tis-cue",children:[" ",Re]})]}),B&&(ae||Ie)&&t("span",{className:`prm-tis prm-tis--review prm-tis--${pe}`,children:[ae,Ie&&t("span",{className:"prm-tis-cue",children:[" ",Ie]})]})]}),J&&a("div",{className:"prm-detail-hint",children:J}),t("dl",{className:"prm-detail-facts",children:[e.author&&t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Author"}),t("dd",{children:[a("span",{className:"prm-avatar prm-avatar--initials",children:xa(e.author)}),e.author.name||e.author.login]})]}),e.createdAt?t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Opened"}),a("dd",{children:je(e.createdAt)})]}):null,e.updatedAt||e.lastChecked?t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Updated"}),a("dd",{children:je(e.updatedAt||e.lastChecked)})]}):null,e.lastChecked?t("div",{className:"prm-detail-fact",children:[a("dt",{children:"Last synced"}),a("dd",{children:je(e.lastChecked)})]}):null]}),(e.headRefName||e.baseRefName)&&t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Branches"}),t("div",{className:"prm-detail-branch",children:[a(ze,{size:12,"aria-hidden":!0}),t("span",{className:"prm-branch",children:[e.headRefName||"?"," \u2192 ",e.baseRefName||"?"]}),e.headRefName&&a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:"Copy branch","data-tip":"Copy branch","aria-label":"Copy branch name",onClick:()=>void ea(e.headRefName,"Branch name"),children:a(Ge,{size:10})})]})]}),e.body&&t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Description preview"}),a("div",{className:"prm-detail-desc",children:e.body}),t("button",{type:"button",className:"prm-btn prm-btn--sm prm-detail-description-link",onClick:we,children:["Read full description on GitHub ",a(Oe,{size:12,"aria-hidden":!0})]})]}),F.length>0&&t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Reviewers"}),a("div",{className:"prm-reviewers",children:Ss.map(({state:Q,label:ee,className:le})=>{let te=W[Q];return te.length===0?null:t("span",{className:`prm-reviewers-group ${le}`,title:ee,children:[a("span",{className:"prm-reviewers-label",children:ee}),te.map(Y=>a("span",{className:"prm-avatar prm-avatar--initials prm-reviewer-avatar",title:Y.name||Y.login,"aria-label":`${ee}: ${Y.name||Y.login}`,children:xa(Y)},Y.login))]},Q)})})]}),t("div",{className:"prm-detail-section",children:[a("div",{className:"prm-detail-label",children:"Checks"}),a(pt,{checks:y})]}),_&&t("div",{className:"prm-detail-sync-error",children:[a(Fe,{size:12,"aria-hidden":!0}),t("span",{children:["Couldn't sync this PR: ",e.syncError]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",disabled:g,"aria-label":"Retry syncing this PR",onClick:()=>void da(),children:[a(ke,{size:11,className:g?"prm-spin":""})," Retry"]})]}),a("div",{className:"prm-detail-section",children:a(ft,{projectId:e.projectId,projects:s,onAssign:Q=>w(e.url,Q)})})]}),t("footer",{className:"prm-modal-footer prm-detail-footer",children:[t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:we,title:"Open on GitHub",children:[a(Oe,{size:13}),a("span",{children:"Open on GitHub"})]}),t("button",{type:"button",className:"prm-btn","aria-label":"Copy link",onClick:()=>void ea(e.url,"PR link"),children:[a(Ge,{size:13}),a("span",{children:"Copy link"})]}),a("span",{className:"prm-detail-footer-spacer"}),a("button",{type:"button",className:`prm-tile-icon-btn prm-tip${N?" prm-tile-icon-btn--active":""}`,title:N?"Unfavorite":"Favorite","data-tip":N?"Unfavorite":"Favorite","aria-label":N?"Unfavorite":"Favorite","aria-pressed":N,onClick:()=>void ve(),children:a(Ve,{size:13,...N?{fill:"currentColor"}:{}})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:T?"Unmute":"Mute","data-tip":T?"Unmute":"Mute","aria-label":T?"Unmute":"Mute",onClick:()=>void ba(),children:T?a(ta,{size:13}):a(Be,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip",title:D?"Mark this PR as read":"Mark this PR as unread","data-tip":D?"Mark read":"Mark unread","aria-label":D?"Mark read":"Mark unread",onClick:()=>void ia(),children:D?a(Je,{size:13}):a(na,{size:13})}),a("button",{type:"button",className:"prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",title:"Dismiss","data-tip":"Dismiss","aria-label":"Dismiss",onClick:()=>C(e.url),children:a(ge,{size:13})})]})]})});return typeof document<"u"?La(Xe,document.body):Xe}var ws=["conflict","failed","yellow","review-required","pending","integrating","green","closed-merged","closed-abandoned"],yo=["closed-merged","closed-abandoned"],vs=[{id:"updated",label:"PR Updated",title:"Sort by when the PR last changed on GitHub"},{id:"created",label:"PR Created",title:"Sort by when the PR was opened"},{id:"status",label:"Status",title:"Sort by rollup status (triage severity)"},{id:"statusUpdated",label:"Status Updated",title:"Sort by when the status last changed"},{id:"favorites",label:"Favorites first",title:"Group favorites at the top, then by when the status last changed"}];function Ps(e,o){let s=e.favorite?1:0,r=o.favorite?1:0;return s!==r?r-s:o.lastStatusChange-e.lastStatusChange}function gt(e){return e.lastSeenAt===0||e.lastStatusChange>(e.lastSeenAt??e.addedAt)}function ks(e,o){return e.length>0&&e.every(r=>{let i=o.find(n=>n.url===r);return i?!!i.favorite:!1})?{favorite:!1,label:"Unfavorite"}:{favorite:!0,label:"Favorite"}}function As(e){let o=e.lastIndexOf("/");return o>=0?e.slice(o+1):e}function Rs(e){let o=e.workItem??ma(e.title,e.headRefName,e.body)??"";return[e.title,`#${e.number}`,String(e.number),Ne(e.status),e.headRefName??"",e.baseRefName??"",o,e.repo,As(e.repo)].join("").toLowerCase()}var Co="boardShowEmpty",So="boardCollapsed";function wo({prs:e,host:o,projects:s,tisWarnHours:r,tisDangerHours:i,reviewWarnDays:n,reviewDangerDays:l,repositories:u,workItemLocatorBase:I,sortField:m,sortDir:b,onSortChange:C,hostScope:w,onHostScopeChange:g,awaitingFirstSync:v,syncing:x,autoSyncEnabled:f,onDismiss:D,onProjectAssign:A,onBulkSetSeen:T,onBulkDismiss:N,onBulkSetFavorite:_,viewMode:X="list",onViewModeChange:z}){let[U,$]=d("all"),[y,F]=d(""),[W,J]=d(new Set),[P,fe]=d(!1),[se,E]=d(X),[be,Re]=d(!1),[R,B]=d(!1),[M,ae]=d(()=>new Set),[ne,Ie]=d(null),pe=ue(null),me=z?X:se,we=c=>{c==="board"&&$("all"),c==="list"&&Re(!1),z?z(c):E(c)};q(()=>{let c=!0;return o.storage.get(Co).then(O=>{c&&typeof O=="boolean"&&B(O)}),o.storage.get(So).then(O=>{!c||!Array.isArray(O)||ae(new Set(O.filter(po)))}),()=>{c=!1}},[o]);let ea=c=>{B(c),o.storage.set(Co,c)},ia=c=>{ae(O=>{let G=new Set(O);return G.has(c)?G.delete(c):G.add(c),o.storage.set(So,[...G]),G})},ba=oe(()=>{let c=[];for(let O of e){let G=wt(O.url);c.includes(G)||c.push(G)}return c},[e]),ve=oe(()=>{if(w.length===0)return e;let c=new Set(w);return e.filter(O=>c.has(wt(O.url)))},[e,w]),da=oe(()=>{let c=new Map;for(let O of ve)c.set(O.status,(c.get(O.status)??0)+1);return c},[ve]),Xe=oe(()=>U==="all"?ve:ve.filter(c=>c.status===U),[ve,U]),Q=oe(()=>{let c=y.trim().toLowerCase();return c?Xe.filter(O=>Rs(O).includes(c)):Xe},[Xe,y]),ee=oe(()=>{let c=b==="asc"?1:-1,O=[...Q];return m==="favorites"?(O.sort(Ps),O):(O.sort((G,de)=>{let aa=0;switch(m){case"created":aa=(G.createdAt??0)-(de.createdAt??0);break;case"status":aa=Pt(G.status)-Pt(de.status);break;case"statusUpdated":aa=G.lastStatusChange-de.lastStatusChange;break;case"updated":default:aa=(G.updatedAt||G.lastChecked||G.lastStatusChange)-(de.updatedAt||de.lastChecked||de.lastStatusChange);break}if(aa===0){let Ot=gt(G)?1:0,qt=gt(de)?1:0;return Ot!==qt?qt-Ot:(de.createdAt??0)-(G.createdAt??0)}return aa*c}),O)},[Q,m,b]),le=oe(()=>go(mt(ee)),[ee]),te=ne?e.find(c=>c.url===ne):void 0;q(()=>{ne&&!te&&Ie(null)},[ne,te]);let Y=oe(()=>{if(!te)return null;let c=Qa(te.repo,u,r??We,i??Ke),O=It(te.repo,u,n??wa,l??va),G=(u??[]).find(de=>`${de.owner}/${de.repo}`.toLowerCase()===te.repo.toLowerCase());return{tisWarnHours:c.warnHours,tisDangerHours:c.dangerHours,reviewWarnDays:O.warnDays,reviewDangerDays:O.dangerDays,sfciGated:G?.sfciGated===!0,ignoredFailingChecks:G?.ignoredFailingChecks}},[te,u,r,i,n,l]),Ue=oe(()=>ve.filter(gt).length,[ve]),Me=oe(()=>ee.map(c=>c.url),[ee]),ce=oe(()=>Me.filter(c=>W.has(c)),[Me,W]),Te=ee.length>0&&ce.length===ee.length,De=ce.length>0&&!Te,h=c=>{J(O=>{let G=new Set(O);return G.has(c)?G.delete(c):G.add(c),G})},L=()=>{J(Te||De?new Set:new Set(Me))},S=()=>J(new Set),H=ce.length>0?ce:Me,K=H.every(c=>{let O=e.find(G=>G.url===c);return O?!gt(O):!0}),he=ks(ce,e);if(e.length===0){if(v){let c=x||f;return t("div",{className:"prm-empty",children:[c?a(V,{size:32,className:"prm-spin","aria-hidden":!0}):a(Le,{size:32,"aria-hidden":!0}),a("h3",{children:c?"Checking for your PRs\u2026":"No sync yet"}),a("p",{children:c?"PR Monitor is syncing with GitHub to find the pull requests you authored.":"Auto-sync is off. Run a sync from the header to find your pull requests."})]})}return t("div",{className:"prm-empty",children:[a(Le,{size:32,"aria-hidden":!0}),a("h3",{children:"No pull requests monitored"}),a("p",{children:"Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs."})]})}let k=t("div",{className:"prm-list-toolbar",children:[t("div",{className:"prm-list-controls",children:[t("div",{className:"prm-view-toggle",role:"group","aria-label":"View",children:[t("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":me==="list",title:"List view",onClick:()=>we("list"),children:[a($a,{size:13,"aria-hidden":!0}),a("span",{children:"List"})]}),t("button",{type:"button",className:"prm-view-toggle-btn","aria-pressed":me==="board",title:"Board view",onClick:()=>we("board"),children:[a(ca,{size:13,"aria-hidden":!0}),a("span",{children:"Board"})]})]}),me==="list"&&a("label",{className:"prm-select-all",title:Te?"Clear selection":"Select all shown PRs",children:a("input",{type:"checkbox",checked:Te,ref:c=>{c&&(c.indeterminate=De)},onChange:L,"aria-label":Te?"Clear selection":"Select all shown PRs"})}),me==="list"&&t("span",{className:"prm-shown-count","aria-live":"polite",children:[ee.length," shown"]}),t("div",{className:"prm-search",children:[a(Ra,{size:12,"aria-hidden":!0}),a("input",{type:"search",className:"prm-search-input",placeholder:"Search PRs\u2026",value:y,onChange:c=>F(c.target.value),"aria-label":"Search PRs"})]}),t("button",{type:"button",ref:pe,className:`prm-btn prm-btn--sm ${w.length>0?"is-active":""}`,onClick:()=>fe(c=>!c),title:"Filter by host","aria-expanded":P,children:[a(Va,{size:12}),t("span",{children:["Host",w.length>0&&t("span",{className:"prm-unread-count",children:[" (",w.length,")"]})]}),a(Ia,{size:12})]}),P&&a(oo,{anchorRef:pe,hosts:ba,selectedHosts:w,onClose:()=>fe(!1),onToggleHost:c=>g(w.includes(c)?w.filter(O=>O!==c):[...w,c]),onSelectAll:()=>g([]),shortHost:Yt}),me==="board"&&t(re,{children:[t("button",{type:"button",className:`prm-btn prm-btn--sm ${be?"is-active":""}`,"aria-pressed":be,title:"Select cards for bulk actions",onClick:()=>Re(c=>!c),children:[a(pa,{size:12}),a("span",{children:"Select"})]}),le>0&&t("button",{type:"button",className:`prm-btn prm-btn--sm ${R?"is-active":""}`,"aria-pressed":R,title:R?"Hide empty columns":`Show ${le} empty column${le===1?"":"s"}`,onClick:()=>ea(!R),children:[a(_a,{size:12}),a("span",{children:R?"Hide empty":`Empty (${le})`})]})]}),me==="list"&&t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>T(H,!K),title:ce.length>0?`Mark the ${ce.length} selected PR(s) ${K?"unread":"read"}`:`Mark all shown PRs ${K?"unread":"read"}`,children:[a(Je,{size:12}),t("span",{children:[K?"Mark unread":"Mark read",Ue>0&&t("span",{className:"prm-unread-count",children:[" (",Ue,")"]})]})]}),me==="list"&&t("div",{className:"prm-sort",title:"Sort order",children:[a("select",{className:"prm-input prm-input--select prm-sort-select",value:m,onChange:c=>C(c.target.value,b),"aria-label":"Sort field",children:vs.map(c=>a("option",{value:c.id,title:c.title,children:c.label},c.id))}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-sort-dir",onClick:()=>C(m,b==="asc"?"desc":"asc"),disabled:m==="favorites",title:m==="favorites"?"Favorites first uses a fixed order":b==="asc"?"Ascending \u2014 click for descending":"Descending \u2014 click for ascending","aria-label":b==="asc"?"Sorted ascending":"Sorted descending",children:b==="asc"?a(Fa,{size:12}):a(Na,{size:12})})]})]}),me==="list"&&t("div",{className:"prm-segment-tabs",role:"tablist","aria-label":"Filter by status",children:[t("button",{type:"button",role:"tab","aria-selected":U==="all",className:`prm-segment-tab ${U==="all"?"active":""}`,onClick:()=>$("all"),title:"Show all monitored PRs",children:["All ",a("span",{className:"prm-segment-count",children:ve.length})]}),ws.map(c=>{let O=da.get(c)??0;return t("button",{type:"button",role:"tab","aria-selected":U===c,className:`prm-segment-tab prm-segment-tab--${c} ${U===c?"active":""}`,onClick:()=>$(c),title:`Show PRs in "${Ne(c)}"`,children:[Ne(c)," ",a("span",{className:"prm-segment-count",children:O})]},c)})]}),ce.length>0&&t("div",{className:"prm-bulk-bar",children:[a("button",{type:"button",className:"prm-bulk-clear",onClick:S,title:"Clear selection","aria-label":"Clear selection",children:a(Se,{size:12})}),t("span",{className:"prm-bulk-count",children:[ce.length," selected"]}),t("div",{className:"prm-bulk-actions",children:[t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>T(ce,!K),title:`Mark the selected PR(s) ${K?"unread":"read"}`,children:[K?a(na,{size:12}):a(Je,{size:12}),a("span",{children:K?"Mark unread":"Mark read"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>_(ce,he.favorite),title:`${he.label} the selected PR(s)`,children:[a(Ve,{size:12,...he.favorite?{}:{fill:"currentColor"}}),a("span",{children:he.label})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger",onClick:()=>{N(ce),S()},title:"Dismiss the selected PR(s) \u2014 removes them from the monitored list",children:[a(ge,{size:12}),a("span",{children:"Dismiss"})]})]})]})]});return t("div",{className:`prm-list${me==="board"?" prm-list--board":""}`,children:[k,ee.length===0?t("div",{className:"prm-empty prm-empty--filtered",children:[a(Ra,{size:28,"aria-hidden":!0}),a("h3",{children:"No PRs match the current filter"}),a("p",{children:y.trim()?"Clear the search to see the rest.":'No PRs in this status. Switch to the "All" tab to see the rest.'}),t("div",{className:"prm-empty-actions",children:[y.trim()&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>F(""),title:"Clear search",children:"Clear search"}),U!=="all"&&a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>$("all"),title:"Show all PRs",children:"Show all"})]})]}):me==="board"?a(Lo,{prs:ee,host:o,tisWarnHours:r,tisDangerHours:i,repositories:u,selected:W,selectMode:be,showEmpty:R,collapsed:M,onToggleCollapse:ia,onToggleSelect:h,onDismiss:D,onOpen:Ie}):a("div",{className:"prm-tile-list",children:ee.map(c=>{let O=Qa(c.repo,u,r??We,i??Ke),G=It(c.repo,u,n??wa,l??va),de=(u??[]).find(aa=>`${aa.owner}/${aa.repo}`.toLowerCase()===c.repo.toLowerCase());return a(to,{pr:c,host:o,projects:s,tisWarnHours:O.warnHours,tisDangerHours:O.dangerHours,reviewWarnDays:G.warnDays,reviewDangerDays:G.dangerDays,sfciGated:de?.sfciGated===!0,ignoredFailingChecks:de?.ignoredFailingChecks,workItemLocatorBase:I,selected:W.has(c.url),onToggleSelect:h,onDismiss:D,onProjectAssign:A},c.url)})}),te&&Y&&a(Io,{pr:te,host:o,projects:s,tisWarnHours:Y.tisWarnHours,tisDangerHours:Y.tisDangerHours,reviewWarnDays:Y.reviewWarnDays,reviewDangerDays:Y.reviewDangerDays,sfciGated:Y.sfciGated,ignoredFailingChecks:Y.ignoredFailingChecks,workItemLocatorBase:I,onClose:()=>Ie(null),onDismiss:c=>{Ie(null),D(c)},onProjectAssign:A})]})}function vo({host:e,onClose:o,onPulled:s}){let[r,i]=d([]),[n,l]=d(!1),[u,I]=d(""),[m,b]=d(""),[C,w]=d(!1),[g,v]=d(null),x=ue(null);q(()=>{let A=!0;return e.call("listRepos").then(T=>{if(!A)return;let N=(T?.repos??[]).filter(_=>_.active&&_.connection==="connected");i(N),N.length>0&&I(`${N[0].host}|${N[0].owner}/${N[0].repo}`),l(!0)}).catch(()=>{A&&l(!0)}),()=>{A=!1}},[e]),q(()=>{let A=T=>{T.key==="Escape"&&!C&&o()};return window.addEventListener("keydown",A),()=>window.removeEventListener("keydown",A)},[o,C]);let f=oe(()=>r.find(A=>`${A.host}|${A.owner}/${A.repo}`===u),[r,u]),D=async()=>{v(null);let A=Number(m.trim());if(!f){v("Select a repository.");return}if(!Number.isFinite(A)||A<=0){v("Enter a valid PR number.");return}w(!0);try{let T=await e.call("pullPr",{host:f.host,fullName:`${f.owner}/${f.repo}`,number:A});T?.ok&&Array.isArray(T.prs)?s(T.prs):v(T?.error||"Failed to pull PR.")}catch(T){v(T instanceof Error?T.message:String(T))}finally{w(!1)}};return a("div",{className:"modal-backdrop",onClick:()=>!C&&o(),children:t("div",{className:"modal prm-modal",role:"dialog","aria-modal":!0,"aria-labelledby":"prm-pull-title",onClick:A=>A.stopPropagation(),children:[t("header",{className:"prm-modal-header",children:[t("h3",{id:"prm-pull-title",children:[a(Le,{size:14,"aria-hidden":!0})," Add PR"]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:o,title:"Close",children:a(Se,{size:14})})]}),t("div",{className:"prm-modal-body",children:[a("p",{className:"prm-modal-desc",children:"Import a specific pull request by number."}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),n&&r.length===0?a("span",{className:"prm-field-hint",children:"No connected repositories. Connect one in Settings first."}):t("select",{className:"prm-input prm-input--select",value:u,onChange:A=>I(A.target.value),disabled:C||!n,"aria-label":"Repository",children:[!n&&a("option",{children:"Loading\u2026"}),r.map(A=>{let T=`${A.host}|${A.owner}/${A.repo}`;return t("option",{value:T,children:[A.owner,"/",A.repo," (",A.shortHost,")"]},T)})]})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"PR number"}),a("input",{ref:x,type:"number",min:1,value:m,placeholder:"e.g. 42",className:"prm-input",onChange:A=>{b(A.target.value),g&&v(null)},onKeyDown:A=>{A.key==="Enter"&&!C&&(A.preventDefault(),D())},disabled:C||r.length===0})]}),g&&a("div",{className:"prm-modal-error",children:g})]}),t("footer",{className:"prm-modal-footer",children:[t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void D(),disabled:C||r.length===0||!m.trim(),title:"Add this PR to the monitored list",children:[C?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add"})]}),a("button",{type:"button",className:"prm-btn",onClick:o,disabled:C,title:"Cancel without adding",children:"Cancel"})]})]})})}function Po({anchorRef:e,host:o,selectedRepos:s,onClose:r,onToggleRepo:i,onSelectAll:n,onSync:l}){let[u,I]=d(null),[m,b]=d([]);if(q(()=>{let w=e.current;if(!w)return;let g=w.getBoundingClientRect();I({top:g.bottom+4,left:g.right})},[e]),q(()=>{let w=!0;return o.call("listRepos").then(g=>{w&&b((g?.repos??[]).filter(v=>v.active&&v.connection==="connected"))}).catch(()=>{}),()=>{w=!1}},[o]),q(()=>{let w=g=>{g.key==="Escape"&&r()};return window.addEventListener("keydown",w),()=>window.removeEventListener("keydown",w)},[r]),!u||typeof document>"u")return null;let C=s.length===0;return La(t(re,{children:[a("div",{className:"prm-project-menu-backdrop",onMouseDown:w=>{w.stopPropagation(),r()}}),t("div",{className:"prm-tile-menu prm-sync-filter",style:{position:"fixed",top:u.top,left:u.left,transform:"translateX(-100%)"},role:"menu",children:[t("div",{className:"prm-sync-filter-header",children:[a("strong",{children:"Sync & Filter"}),a("span",{className:"prm-sync-filter-desc",children:"Filter the list and choose what to sync."})]}),t("button",{type:"button",className:`prm-project-menu-item ${C?"is-active":""}`,role:"menuitemcheckbox","aria-checked":C,onClick:w=>{w.stopPropagation(),n()},title:"Show and sync all repositories",children:[a("span",{className:"prm-sync-filter-check",children:C&&a(_e,{size:12})}),"All repositories"]}),m.map(w=>{let g=`${w.owner}/${w.repo}`,v=s.includes(g);return t("button",{type:"button",className:`prm-project-menu-item ${v?"is-active":""}`,role:"menuitemcheckbox","aria-checked":v,onClick:x=>{x.stopPropagation(),i(g)},title:`Filter/sync ${g}`,children:[a("span",{className:"prm-sync-filter-check",children:v&&a(_e,{size:12})}),g," ",t("span",{className:"prm-sync-filter-host",children:["(",w.shortHost,")"]})]},`${w.host}|${g}`)}),a("div",{className:"prm-tile-menu-divider"}),t("div",{className:"prm-sync-filter-footer",children:[a("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:r,title:"Close without changing the selection",children:"Close"}),a("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--primary",onClick:()=>{l(s),r()},title:C?"Sync all repositories now":"Sync the selected repositories now",children:C?"Sync All":`Sync ${s.length}`})]})]})]}),document.body)}function Qe({title:e,subtitle:o,actions:s}){return t("header",{className:"prm-area-header",children:[t("div",{className:"prm-area-heading",children:[a("h3",{children:e}),a("p",{children:o})]}),s&&a("div",{className:"prm-area-actions",children:s})]})}function ht({state:e}){return e==="checking"?t("span",{className:"prm-conn-pill prm-conn-pill--checking",children:[a(V,{size:11,className:"prm-spin"})," Checking"]}):e==="connected"?t("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(xe,{size:11})," Connected"]}):t("span",{className:"prm-conn-pill prm-conn-pill--disconnected",children:[a(Pe,{size:11})," Disconnected"]})}function la({title:e,icon:o,onClose:s,busy:r,footer:i,children:n,wide:l}){return q(()=>{let u=I=>{I.key==="Escape"&&!r&&s()};return window.addEventListener("keydown",u),()=>window.removeEventListener("keydown",u)},[s,r]),a("div",{className:"modal-backdrop",onClick:()=>!r&&s(),children:t("div",{className:`modal prm-modal${l?" prm-modal--wide":""}`,role:"dialog","aria-modal":!0,onClick:u=>u.stopPropagation(),children:[t("header",{className:"prm-modal-header",children:[t("h3",{children:[o," ",e]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:s,disabled:r,title:"Close",children:a(Se,{size:14})})]}),n]})})}function xt({title:e,message:o,confirmLabel:s="OK",cancelLabel:r="Cancel",danger:i,busy:n,onConfirm:l,onCancel:u}){return t(la,{title:e,onClose:u,busy:n,children:[a("div",{className:"prm-modal-body",children:o}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:u,disabled:n,children:r}),t("button",{type:"button",className:`prm-btn ${i?"prm-btn--danger":"prm-btn--primary"}`,onClick:l,disabled:n,children:[n?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:s})]})]})]})}function ko({host:e}){let[o,s]=d(()=>{let f=e.cache.get(et);return f?.ok&&Array.isArray(f.orgs)?f.orgs:null}),[r,i]=d(null),[n,l]=d(!1),[u,I]=d(null),[m,b]=d(!1),[C,w]=d(!1),g=Z(async()=>{try{let f=await e.call("listOrgs");f?.ok&&Array.isArray(f.orgs)?(s(f.orgs),i(null)):(s([]),f?.error&&i(f.error))}catch(f){s([]),i(f instanceof Error?f.message:String(f))}},[e]);q(()=>{g()},[g]);let v=async()=>{l(!0),i(null);try{let f=await e.call("rediscoverOrgs");!f?.ok&&f?.error&&i(f.error),await g()}catch(f){i(f instanceof Error?f.message:String(f))}finally{l(!1)}},x=async()=>{if(u){b(!0);try{let f=await e.call("deleteOrg",{host:u.host,login:u.login});!f?.ok&&f?.error&&e.toast(f.error,"error"),await g()}catch(f){e.toast(f instanceof Error?f.message:String(f),"error")}finally{b(!1),I(null)}}};return t("div",{className:"prm-area",children:[a(Qe,{title:"Organizations",subtitle:"This list mirrors the GitHub accounts you are signed into.",actions:t(re,{children:[t("button",{type:"button",className:"prm-btn",onClick:()=>void v(),disabled:n,title:"Re-discover organizations from your gh accounts",children:[n?a(V,{size:13,className:"prm-spin"}):a(qe,{size:13}),a("span",{children:"Re-discover"})]}),a("button",{type:"button",className:"prm-row-icon-btn",onClick:()=>w(!0),title:"How to add or remove organizations","aria-label":"How to add or remove organizations",children:a(Ee,{size:16})})]})}),r&&a("div",{className:"prm-error",children:r}),o===null?t("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading organizations\u2026"]}):o.length===0?t("div",{className:"prm-area-empty",children:["No organizations found. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover."]}):a("div",{className:"prm-card-list",children:o.map(f=>t("div",{className:"prm-entity-card",children:[t("div",{className:"prm-entity-main",children:[t("div",{className:"prm-entity-title",children:[f.login," ",t("span",{className:"prm-entity-host",children:["(",f.shortHost,")"]})]}),a("div",{className:"prm-entity-sub",children:f.apiBaseUrl}),t("div",{className:"prm-entity-sub",children:["Authenticated as ",a("code",{children:f.login})]})]}),t("div",{className:"prm-entity-side",children:[a(ht,{state:n?"checking":f.connection}),a("button",{type:"button",className:"prm-row-icon-btn prm-row-icon-btn--danger",onClick:()=>I(f),title:"Delete organization",children:a(ge,{size:15})})]})]},`${f.host}|${f.login}`))}),C&&t(la,{title:"Adding & removing organizations",icon:a(Ee,{size:16}),onClose:()=>w(!1),children:[t("div",{className:"prm-modal-body prm-help-body",children:[t("p",{children:["PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",a("code",{children:"gh"})," CLI is signed into. To change it:"]}),t("ul",{children:[t("li",{children:[a("strong",{children:"Add"})," an account: run ",a("code",{children:"gh auth login"})," in a terminal and follow the prompts."]}),t("li",{children:[a("strong",{children:"Remove"})," an account: run ",a("code",{children:"gh auth logout"}),"."]}),t("li",{children:["Then click ",a("strong",{children:"Re-discover"})," here to refresh the list."]})]}),t("p",{children:["Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",a("code",{children:"gh"})," credentials are left untouched."]})]}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>w(!1),children:a("span",{children:"Got it"})})})]}),u&&a(xt,{title:"Delete organization?",danger:!0,busy:m,message:t(re,{children:["Delete ",a("strong",{children:u.login})," (",u.shortHost,")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",a("code",{children:"gh"})," credentials are left untouched."]}),confirmLabel:"Delete",onConfirm:()=>void x(),onCancel:()=>I(null)})]})}function Ms(e,o){try{let s=new URL(o);if(s.protocol!=="https:"&&s.protocol!=="http:")return;e.openExternal(o)}catch{}}function Ao(e){return`https://${e.host}/${e.owner}/${e.repo}`}async function Ts(e,o){await Da(o)?e.toast("Link copied","info"):e.toast("Failed to copy link","error")}function Ro({host:e,onRepositoriesChanged:o}){let[s,r]=d(()=>{let y=e.cache.get(St);return y?.ok&&Array.isArray(y.repos)?y.repos:null}),[i,n]=d(()=>{let y=e.cache.get(et);return y?.ok&&Array.isArray(y.orgs)?y.orgs:[]}),[l,u]=d(null),[I,m]=d(!1),[b,C]=d(!1),[w,g]=d(!1),[v,x]=d(null),[f,D]=d("general"),[A,T]=d(null),[N,_]=d(null),[X,z]=d(!1),U=Z(async()=>{try{let[y,F]=await Promise.all([e.call("listRepos"),e.call("listOrgs")]);y?.ok&&Array.isArray(y.repos)?(r(y.repos),u(null)):(r([]),y?.error&&u(y.error)),n(F?.ok&&Array.isArray(F.orgs)?F.orgs:[])}catch(y){r([]),u(y instanceof Error?y.message:String(y))}},[e]);q(()=>{U()},[U]);let $=async()=>{if(N){z(!0);try{await e.call("deleteRepository",{host:N.host,owner:N.owner,repo:N.repo}),await U()}catch(y){e.toast(y instanceof Error?y.message:String(y),"error")}finally{z(!1),_(null)}}};return t("div",{className:"prm-area",children:[a(Qe,{title:"Repositories",subtitle:"Manage your connected repositories",actions:t(re,{children:[t("button",{type:"button",className:"prm-btn",onClick:()=>C(!0),children:[a(qe,{size:13})," ",a("span",{children:"Suggested for you"})]}),t("button",{type:"button",className:"prm-btn",onClick:()=>g(!0),children:[a(ka,{size:13})," ",a("span",{children:"Browse Repositories"})]}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>m(!0),children:[a(Aa,{size:13})," ",a("span",{children:"Add repository manually"})]})]})}),l&&a("div",{className:"prm-error",children:l}),s===null?t("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):s.length===0?t("div",{className:"prm-area-empty",children:["No repositories connected yet. Use ",a("strong",{children:"Suggested for you"}),","," ",a("strong",{children:"Browse"}),", or ",a("strong",{children:"Add repository manually"})," to get started."]}):a("div",{className:"prm-card-list",children:s.map(y=>t("div",{className:"prm-entity-card prm-repo-card",children:[t("div",{className:"prm-repo-top",children:[t("div",{className:"prm-entity-title",children:[a(ze,{size:14,"aria-hidden":!0})," ",t("span",{children:[y.owner,"/",y.repo]}),a("span",{className:`prm-active-badge${y.active?"":" prm-active-badge--off"}`,children:y.active?"Active":"Inactive"}),a(ht,{state:y.connection}),(()=>{let F=Ya[y.buildTisPreset??y.tisPreset??rt],W=Ja[y.reviewTisPreset??st];return t(re,{children:[t("span",{className:"prm-tis-preset-pill",title:`Build preset \u2014 warns after ${F.warnHours}h, behind schedule after ${F.dangerHours}h`,children:[a(He,{size:11,"aria-hidden":!0}),"Build: ",F.label]}),t("span",{className:"prm-tis-preset-pill",title:`Review preset \u2014 warns after ${W.warnDays}d, behind schedule after ${W.dangerDays}d`,children:[a(He,{size:11,"aria-hidden":!0}),"Review: ",W.label]})]})})()]}),t("div",{className:"prm-repo-quick",children:[a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Open on GitHub","data-tip":"Open on GitHub","aria-label":"Open on GitHub",onClick:()=>Ms(e,Ao(y)),children:a(Oe,{size:14})}),a("button",{type:"button",className:"prm-row-icon-btn prm-tip",title:"Copy link","data-tip":"Copy link","aria-label":"Copy link",onClick:()=>void Ts(e,Ao(y)),children:a(Ge,{size:14})})]})]}),t("div",{className:"prm-entity-sub prm-repo-meta",children:[t("span",{children:["Organization: ",y.orgLogin," (",y.shortHost,")"]}),t("span",{children:["Created ",je(y.createdAt)]})]}),t("div",{className:"prm-repo-actions",children:[t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>T(y),children:[a(Ca,{size:12})," ",a("span",{children:"Test Connection"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{D("general"),x(y)},children:[a(Ye,{size:12})," ",a("span",{children:"Edit Repository"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{D("status"),x(y)},title:"Status Settings",children:[a(He,{size:12})," ",a("span",{children:"Status Settings"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm",onClick:()=>{D("notifications"),x(y)},title:"Notification Settings",children:[a(Be,{size:12})," ",a("span",{children:"Notification Settings"})]}),t("button",{type:"button",className:"prm-btn prm-btn--sm prm-btn--danger-ghost",onClick:()=>_(y),children:[a(ge,{size:12})," ",a("span",{children:"Delete Repository"})]})]})]},`${y.host}|${y.owner}/${y.repo}`))}),I&&a(Ds,{host:e,orgs:i,onClose:()=>m(!1),onAdded:async()=>{m(!1),await U()}}),b&&a(Ns,{host:e,onClose:()=>C(!1),onAdded:async()=>{await U()}}),w&&a(Bs,{host:e,onClose:()=>g(!1),onAdded:async()=>{await U()}}),v&&a(Fs,{host:e,repo:v,orgs:i,initialTab:f,onClose:()=>x(null),onSaved:async y=>{x(null),Array.isArray(y)&&(e.cache.set(ie,y),e.cache.set(Ae,y.length),e.cache.refreshBadge()),o?.(),await U()}}),A&&a(Es,{host:e,repo:A,onClose:()=>T(null),onResult:y=>{let F=y?"connected":"disconnected";r(W=>(W??[]).map(J=>J.host===A.host&&J.owner===A.owner&&J.repo===A.repo?{...J,connection:F}:J))}}),N&&a(xt,{title:"Delete repository?",danger:!0,busy:X,message:"Are you sure you want to delete this repository? This will also delete all associated PRs.",confirmLabel:"Delete Repository",onConfirm:()=>void $(),onCancel:()=>_(null)})]})}function Ds({host:e,orgs:o,onClose:s,onAdded:r}){let[i,n]=d(""),[l,u]=d(o[0]?`${o[0].host}|${o[0].login}`:""),[I,m]=d(null),[b,C]=d(!1),w=async()=>{let g=o.find(v=>`${v.host}|${v.login}`===l);if(!g){m("Please select an organization.");return}C(!0),m(null);try{let v=await e.call("addRepository",{ref:i.trim(),host:g.host,orgLogin:g.login});v?.ok?r():m(v?.error||"Failed to add repository.")}catch(v){m(v instanceof Error?v.message:String(v))}finally{C(!1)}};return t(la,{title:"Add repository",icon:a(Aa,{size:14}),onClose:s,busy:b,children:[t("div",{className:"prm-modal-body",children:[t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Repository"}),a("input",{type:"text",className:"prm-input",placeholder:"owner/repo (e.g. my-org/my-repo)",value:i,spellCheck:!1,onChange:g=>{n(g.target.value),I&&m(null)},onKeyDown:g=>{g.key==="Enter"&&!b&&(g.preventDefault(),w())}}),a("span",{className:"prm-field-hint",children:"Enter as owner/repo, a full GitHub URL, or an SSH clone URL."})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label",children:"Organization"}),t("select",{className:"prm-input prm-input--select",value:l,onChange:g=>u(g.target.value),children:[o.length===0&&a("option",{value:"",children:"No organizations"}),o.map(g=>t("option",{value:`${g.host}|${g.login}`,children:[g.login," (",g.shortHost,")"]},`${g.host}|${g.login}`))]})]}),I&&a("div",{className:"prm-modal-error",children:I})]}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:s,disabled:b,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void w(),disabled:b||!i.trim(),children:[b?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Add Repository"})]})]})]})}function Ns({host:e,onClose:o,onAdded:s}){let[r,i]=d(null),[n,l]=d(new Set),[u,I]=d(null),[m,b]=d(!1),C=Z(async()=>{i(null),I(null);try{let x=await e.call("suggestRepositories");x?.ok&&Array.isArray(x.repos)?(i(x.repos),l(new Set(x.repos.filter(f=>f.alreadyAdded).map(f=>f.fullName)))):(i([]),x?.error&&I(x.error))}catch(x){i([]),I(x instanceof Error?x.message:String(x))}},[e]);q(()=>{C()},[C]);let w=x=>{x.alreadyAdded||l(f=>{let D=new Set(f);return D.has(x.fullName)?D.delete(x.fullName):D.add(x.fullName),D})},g=async()=>{if(!r)return;let x=r.filter(f=>!f.alreadyAdded&&n.has(f.fullName));if(x.length!==0){b(!0);try{await e.call("addRepositories",{repos:x.map(f=>({owner:f.owner,repo:f.repo,host:f.host,orgLogin:f.orgLogin}))}),await s(),o()}catch(f){e.toast(f instanceof Error?f.message:String(f),"error")}finally{b(!1)}}},v=r?r.filter(x=>!x.alreadyAdded&&n.has(x.fullName)).length:0;return t(la,{title:"Suggested for you",icon:a(qe,{size:14}),onClose:o,busy:m,wide:!0,children:[t("div",{className:"prm-modal-body",children:[a("p",{className:"prm-field-hint",style:{marginBottom:"12px"},children:"Repositories where you authored or reviewed PRs in the last 90 days."}),r===null?t("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Looking at your activity in the last 90 days\u2026"]}):u?a("div",{className:"prm-modal-error",children:u}):r.length===0?t("div",{className:"prm-area-empty",children:["No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via"," ",a("strong",{children:"Add repository manually"}),"."]}):a("div",{className:"prm-suggested-list",children:r.map(x=>t("label",{className:"prm-suggested-row",children:[a("input",{type:"checkbox",checked:n.has(x.fullName),disabled:x.alreadyAdded,onChange:()=>w(x)}),t("span",{className:"prm-suggested-main",children:[a("span",{className:"prm-entity-title",children:x.fullName}),t("span",{className:"prm-entity-sub",children:[x.prCount," PRs \xB7 ",je(x.lastActivity)]})]}),x.alreadyAdded&&t("span",{className:"prm-suggested-added",children:[a(xe,{size:13})," Already added"]})]},x.fullName))})]}),t("footer",{className:"prm-modal-footer",children:[t("button",{type:"button",className:"prm-btn",onClick:()=>void C(),disabled:m||r===null,children:[a(qe,{size:13})," ",a("span",{children:"Rescan"})]}),a("button",{type:"button",className:"prm-btn",onClick:o,disabled:m,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void g(),disabled:m||v===0,children:[m?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:m?"Adding\u2026":v>0?`Add ${v} Selected`:"Add Selected"})]})]})]})}function Bs({host:e,onClose:o,onAdded:s}){let[r,i]=d(""),[n,l]=d(null),[u,I]=d(!0),[m,b]=d(!1),[C,w]=d(!1),[g,v]=d(1),[x,f]=d(null),[D,A]=d(new Set),[T,N]=d(new Set),[_,X]=d(new Set),[z,U]=d(!1),$=Z(async(R,B)=>{B?b(!0):I(!0),f(null);try{let M=await e.call("listAllRepositories",{page:R}),ae=M?.ok&&Array.isArray(M.repos)?M.repos:[];w(!!M?.hasMore),X(new Set(Array.isArray(M?.incompleteOwners)?M.incompleteOwners:[])),l(ne=>{if(!B||!ne)return ae;let Ie=new Set(ne.map(pe=>`${pe.host}|${pe.fullName}`));return[...ne,...ae.filter(pe=>!Ie.has(`${pe.host}|${pe.fullName}`))]}),M&&M.ok===!1&&M.error&&f(M.error)}catch(M){f(M instanceof Error?M.message:String(M)),B||l([])}finally{I(!1),b(!1)}},[e]);q(()=>{$(1,!1)},[$]);let y=()=>{let R=g+1;v(R),$(R,!0)},F=n??[],W=r.trim().toLowerCase(),J=W?F.filter(R=>R.fullName.toLowerCase().includes(W)):F,P=R=>{A(B=>{let M=new Set(B);return M.has(R)?M.delete(R):M.add(R),M})},fe=R=>{N(B=>{let M=new Set(B);return M.has(R)?M.delete(R):M.add(R),M})},se=R=>`${R.host}|${R.fullName}`,E=(()=>{let R=new Map;for(let B of J){let M=R.get(B.owner)??[];M.push(B),R.set(B.owner,M)}return Array.from(R.entries())})(),be=async()=>{let R=J.filter(B=>!B.alreadyAdded&&D.has(se(B)));if(R.length!==0){U(!0);try{await e.call("addRepositories",{repos:R.map(B=>({owner:B.owner,repo:B.repo,host:B.host,orgLogin:B.owner}))}),await s(),o()}catch(B){e.toast(B instanceof Error?B.message:String(B),"error")}finally{U(!1)}}},Re=J.filter(R=>!R.alreadyAdded&&D.has(se(R))).length;return t(la,{title:"Browse Repositories",icon:a(ka,{size:14}),onClose:o,busy:z,wide:!0,children:[t("div",{className:"prm-modal-body",children:[a("div",{className:"prm-browse-controls",children:a("input",{type:"text",className:"prm-input",placeholder:"Filter repositories across all your organizations\u2026",value:r,spellCheck:!1,autoFocus:!0,onChange:R=>i(R.target.value)})}),x&&a("div",{className:"prm-modal-error",children:x}),u?t("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading repositories\u2026"]}):t("div",{className:"prm-browse-list",children:[E.map(([R,B])=>{let M=!T.has(R);return t("div",{className:"prm-browse-group",children:[t("button",{type:"button",className:"prm-browse-group-header",onClick:()=>fe(R),"aria-expanded":M,children:[a(oa,{size:13,className:`prm-disclosure${M?" is-open":""}`,"aria-hidden":!0}),a("span",{className:"prm-browse-group-name",children:R}),t("span",{className:"prm-browse-group-count",title:!W&&_.has(R)?`${B.length} loaded \u2014 more available, use Load more`:void 0,children:["(",B.length,!W&&_.has(R)?"\u2026":"",")"]})]}),M&&B.map(ae=>ae.alreadyAdded?t("div",{className:"prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added",children:[t("span",{children:[a(ze,{size:13,"aria-hidden":!0})," ",ae.fullName,ae.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]}),t("span",{className:"prm-conn-pill prm-conn-pill--connected",children:[a(xe,{size:11,"aria-hidden":!0})," Connected"]})]},se(ae)):t("label",{className:"prm-checkbox-row prm-browse-repo-row",children:[a("input",{type:"checkbox",checked:D.has(se(ae)),onChange:()=>P(se(ae))}),t("span",{children:[a(ze,{size:13,"aria-hidden":!0})," ",ae.fullName,ae.isPrivate&&a("span",{className:"prm-added-tag",children:" \xB7 private"})]})]},se(ae)))]},R)}),J.length===0&&a("div",{className:"prm-area-empty",children:W?"No repositories match your filter.":"No repositories found."}),C&&!W&&t("button",{type:"button",className:"prm-btn prm-browse-load-more",onClick:y,disabled:m,children:[m?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:m?"Loading\u2026":"Load more"})]})]})]}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:o,disabled:z,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void be(),disabled:z||Re===0,children:[z?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:Re>0?`Add ${Re} Selected`:"Add Selected"})]})]})]})}function Fs({host:e,repo:o,orgs:s,initialTab:r="general",onClose:i,onSaved:n}){let[l,u]=d(r),[I,m]=d(`${o.owner}/${o.repo}`),[b,C]=d(o.orgLogin),[w,g]=d(o.active),[v,x]=d(o.buildTisPreset??o.tisPreset??rt),[f,D]=d(o.reviewTisPreset??st),[A,T]=d(o.sfciGated===!0),[N,_]=d((o.ignoredFailingChecks??[]).some(P=>P.toLowerCase().includes("snyk"))),[X,z]=d(o.notifyInApp??!0),[U,$]=d(null),[y,F]=d(!1),W=s.filter(P=>P.host===o.host),J=async()=>{F(!0),$(null);try{let P=await e.call("updateRepository",{key:{host:o.host,owner:o.owner,repo:o.repo},ref:I.trim(),orgLogin:b,active:w,buildTisPreset:v,reviewTisPreset:f,sfciGated:A,ignoredFailingChecks:N?["Snyk"]:[],notifyInApp:X});P?.ok?n(P.prs):$(P?.error||"Failed to save settings.")}catch(P){$(P instanceof Error?P.message:String(P))}finally{F(!1)}};return t(la,{title:t("span",{className:"prm-dialog-title",children:["Repository Settings ",t("span",{className:"prm-entity-sub",children:[o.owner,"/",o.repo]})]}),icon:a(Ye,{size:14}),onClose:i,busy:y,children:[t("nav",{className:"prm-dialog-tabs",children:[t("button",{type:"button",className:`prm-dialog-tab${l==="general"?" active":""}`,onClick:()=>u("general"),children:[a(Ye,{size:12})," General"]}),t("button",{type:"button",className:`prm-dialog-tab${l==="status"?" active":""}`,onClick:()=>u("status"),children:[a(He,{size:12})," Status"]}),t("button",{type:"button",className:`prm-dialog-tab${l==="notifications"?" active":""}`,onClick:()=>u("notifications"),children:[a(Be,{size:12})," Notifications"]})]}),t("div",{className:"prm-modal-body",children:[l==="general"?t(re,{children:[t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:w,onChange:P=>g(P.target.checked)}),t("span",{children:[a("strong",{children:"Repository is active"}),a("small",{children:"Inactive repositories won't surface new PRs."})]})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Repository"}),a("span",{className:"prm-field-hint",children:"Format: owner/repo (e.g., facebook/react)"}),a("input",{type:"text",className:"prm-input",value:I,spellCheck:!1,onChange:P=>m(P.target.value)})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Organization"}),a("span",{className:"prm-field-hint",children:"The GitHub account this repository belongs to."}),a("select",{className:"prm-input prm-input--select",value:b,onChange:P=>C(P.target.value),children:W.map(P=>t("option",{value:P.login,children:[P.login," (",P.shortHost,")"]},P.login))})]})]}):l==="status"?t(re,{children:[t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Build-phase preset"}),a("span",{className:"prm-field-hint",children:"Jenkins/CI time before the build pill is considered stalled (hours)."}),a("select",{className:"prm-input prm-input--select",value:v,onChange:P=>x(P.target.value),children:Object.values(Ya).map(P=>t("option",{value:P.id,children:[P.label," (",P.warnHours,"h / ",P.dangerHours,"h)"]},P.id))})]}),t("label",{className:"prm-field",children:[a("span",{className:"prm-field-label prm-field-label--strong",children:"Review-phase preset"}),a("span",{className:"prm-field-hint",children:"Review wait before the review pill is considered stalled (days). Drafts are excluded."}),a("select",{className:"prm-input prm-input--select",value:f,onChange:P=>D(P.target.value),children:Object.values(Ja).map(P=>t("option",{value:P.id,children:[P.label," (",P.warnDays,"d / ",P.dangerDays,"d)"]},P.id))})]}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:A,onChange:P=>T(P.target.checked)}),t("span",{children:[a("strong",{children:"SFCI Gated Repo"}),a("small",{children:"Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action."})]})]}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:N,onChange:P=>_(P.target.checked)}),t("span",{children:[a("strong",{children:"Ignore Snyk failures for build status"}),a("small",{children:'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.'})]})]})]}):t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:X,onChange:P=>z(P.target.checked)}),t("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show notifications for status changes on this repository."})]})]}),U&&a("div",{className:"prm-modal-error",children:U})]}),t("footer",{className:"prm-modal-footer",children:[a("button",{type:"button",className:"prm-btn",onClick:i,disabled:y,children:"Cancel"}),t("button",{type:"button",className:"prm-btn prm-btn--primary",onClick:()=>void J(),disabled:y,children:[y?a(V,{size:13,className:"prm-spin"}):null,a("span",{children:"Save Settings"})]})]})]})}function Es({host:e,repo:o,onClose:s,onResult:r}){let[i,n]=d(null);return q(()=>{let l=!0;return(async()=>{try{let I=await e.call("testRepository",{host:o.host,owner:o.owner,repo:o.repo})??{ok:!1,error:"No response"};l&&(n(I),r?.(I.ok))}catch(u){l&&(n({ok:!1,error:u instanceof Error?u.message:String(u)}),r?.(!1))}})(),()=>{l=!1}},[e,o]),t(la,{title:`Connection Test Results: ${o.owner}/${o.repo}`,icon:a(Ca,{size:14}),onClose:s,children:[a("div",{className:"prm-modal-body",children:i===null?t("div",{className:"prm-loading",children:[a(Ca,{size:14,className:"prm-spin"})," Testing connection\u2026"]}):i.ok?t("div",{className:"prm-test-result prm-test-result--ok",children:[a(xe,{size:16})," All connection tests passed."]}):t("div",{className:"prm-test-result prm-test-result--fail",children:[a(Pe,{size:16}),t("div",{children:[a("div",{children:i.error||"Connection failed."}),t("div",{className:"prm-field-hint",children:["Try ",t("code",{children:["gh auth login ",o.host]})," in a terminal, then test again."]})]})]})}),a("footer",{className:"prm-modal-footer",children:a("button",{type:"button",className:"prm-btn",onClick:s,children:"Close"})})]})}function Hs(e){let o=e.trim().split(/\s+/).filter(Boolean);return o.length===0?"?":o.length===1?o[0].slice(0,2).toUpperCase():(o[0][0]+o[o.length-1][0]).toUpperCase()}function Mo({host:e}){let[o,s]=d(()=>{let m=e.cache.get(yt);return m?.ok?m.author??null:void 0}),[r,i]=d(null),[n,l]=d(!1),u=Z(async()=>{try{let m=await e.call("getAuthor");m?.ok?(s(m.author??null),i(null)):(s(null),m?.error&&i(m.error))}catch(m){s(null),i(m instanceof Error?m.message:String(m))}},[e]);q(()=>{u()},[u]);let I=o?.name||o?.login||"";return t("div",{className:"prm-area",children:[a(Qe,{title:"Author",subtitle:"Monitored Author and how to identify per organization"}),r&&a("div",{className:"prm-error",children:r}),o===void 0?t("div",{className:"prm-loading",children:[a(V,{size:14,className:"prm-spin"})," Loading author\u2026"]}):o===null?t("div",{className:"prm-area-empty",children:["No authenticated author. Sign in with ",a("code",{children:"gh auth login"}),", then Re-discover from Organizations."]}):a("div",{className:"prm-card-list",children:t("div",{className:"prm-entity-card prm-author-card",children:[t("button",{type:"button",className:"prm-author-row",onClick:()=>l(m=>!m),"aria-expanded":n,children:[a("span",{className:"prm-avatar prm-avatar--initials","aria-hidden":!0,children:Hs(I)}),t("span",{className:"prm-author-id",children:[a("span",{className:"prm-entity-title",children:I}),o.email&&a("span",{className:"prm-entity-sub",children:o.email})]}),a(oa,{size:16,className:`prm-disclosure${n?" is-open":""}`,"aria-hidden":!0})]}),n&&t("div",{className:"prm-author-detail",children:[t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Display Name"}),a("span",{children:I||"\u2014"})]}),t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Email"}),a("span",{children:o.email||"\u2014"})]}),t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"GitHub Identities"}),a("div",{className:"prm-identity-list",children:o.identities.map(m=>t("div",{className:"prm-identity-row",children:[t("span",{children:[m.login," ",t("span",{className:"prm-entity-host",children:["(",m.shortHost,")"]})]}),m.connection==="connected"?a(xe,{size:13,className:"prm-identity-verified","aria-label":"Verified"}):t("span",{className:"prm-identity-disconnected","aria-label":"Disconnected",children:[a(Pe,{size:13})," Disconnected"]})]},`${m.host}|${m.login}`))})]})]})]})})]})}function To({settings:e,update:o}){let s=e.notifyInApp??e.notifyOnChange;return t("div",{className:"prm-area",children:[a(Qe,{title:"Notifications",subtitle:"How to be notified when pull request status changes"}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:s,onChange:r=>o({notifyInApp:r.target.checked,notifyOnChange:r.target.checked})}),t("span",{children:[a("strong",{children:"In-app notifications"}),a("small",{children:"Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this."})]})]}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:e.sendToInbox??!1,onChange:r=>o({sendToInbox:r.target.checked})}),t("span",{children:[a("strong",{children:"Send to Inbox"}),a("small",{children:"Also push status changes to your project Inbox. Requires the PR to be associated with a Project."})]})]}),t("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sidebar badge"}),t("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="unread",onChange:()=>o({badgeMode:"unread"})}),t("span",{children:[a("strong",{children:"Unread changes"}),a("small",{children:"Counts PRs with an unseen status change since you last viewed them."})]})]}),t("label",{className:"prm-radio-row",children:[a("input",{type:"radio",name:"prm-badge",checked:e.badgeMode==="total",onChange:()=>o({badgeMode:"total"})}),t("span",{children:[a("strong",{children:"Total count"}),a("small",{children:"Counts every monitored PR, read or unread."})]})]})]})]})}var Do=[{value:15,label:"Every 15 minutes"},{value:30,label:"Every 30 minutes"},{value:60,label:"Every hour"},{value:120,label:"Every 2 hours"}],Os=15;function No(e){return new Date(e).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function qs(e,o){let s=Math.max(0,e-o),r=Math.round(s/6e4);if(r<=0)return"now";if(r<60)return`in ${r}m`;let i=Math.floor(r/60),n=r%60;return n?`in ${i}h ${n}m`:`in ${i}h`}function Bo({settings:e,update:o,host:s}){let[r,i]=d(()=>s.cache.get(ie)??[]),[n,l]=d(!1),[u,I]=d(()=>Date.now());q(()=>{let x=window.setInterval(()=>{let f=s.cache.get(ie);f&&i(D=>D===f?D:f),I(Date.now())},1e3);return()=>window.clearInterval(x)},[s]);let m=e.autoSyncEnabled??!0,b=Do.some(x=>x.value===e.pollIntervalMinutes)?e.pollIntervalMinutes:Os,C=r.reduce((x,f)=>Math.max(x,f.lastChecked||0),0),w=m&&C?C+b*6e4:0,g=new Set(r.map(x=>x.repo)).size,v=async()=>{l(!0);try{let x=await s.call("pollAll");x?.ok&&Array.isArray(x.prs)&&(i(x.prs),s.cache.set(ie,x.prs))}catch(x){s.toast(x instanceof Error?x.message:String(x),"error")}finally{l(!1)}};return t("div",{className:"prm-area",children:[a(Qe,{title:"Auto-Sync Scheduling",subtitle:"Automatically sync PRs from all repositories on a schedule"}),t("label",{className:"prm-checkbox-row",children:[a("input",{type:"checkbox",checked:m,onChange:x=>o({autoSyncEnabled:x.target.checked})}),t("span",{children:[a("strong",{children:"Enable Auto-Sync"}),a("small",{children:"Automatically check all repositories for new PRs and sync statuses."})]})]}),t("div",{className:"prm-field",children:[a("label",{className:"prm-field-label",children:"Sync Interval"}),a("select",{className:"prm-input prm-input--select",value:b,onChange:x=>{let f=Number(x.target.value);Number.isFinite(f)&&o({pollIntervalMinutes:f})},children:Do.map(x=>a("option",{value:x.value,children:x.label},x.value))}),a("span",{className:"prm-field-hint",children:"How often to check all active repositories for new pull requests."})]}),t("section",{className:"prm-subsection",children:[a("h4",{className:"prm-subsection-title",children:"Sync Status"}),t("div",{className:"prm-sync-status",children:[t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Next sync"}),a("span",{children:w?t(re,{children:[qs(w,u)," ",t("span",{className:"prm-field-hint",children:["\xB7 ",No(w)]})]}):"\u2014"})]}),t("div",{className:"prm-kv",children:[a("span",{className:"prm-field-label",children:"Last sync"}),a("span",{children:C?t(re,{children:[je(C)," ",t("span",{className:"prm-field-hint",children:["\xB7 ",No(C)]})]}):""})]}),t("div",{className:"prm-sync-counts",children:[t("span",{className:"prm-sync-count",children:[a("strong",{children:g})," repositories checked"]}),t("span",{className:"prm-sync-count",children:[a("strong",{children:r.length})," monitored PRs"]})]})]}),t("button",{type:"button",className:"prm-btn prm-btn--primary prm-btn--inline",onClick:()=>void v(),disabled:n,children:[n?a(V,{size:13,className:"prm-spin"}):a(ke,{size:13}),a("span",{children:"Sync All Now"})]})]})]})}var Us=[{label:"GITHUB",items:[{id:"organizations",label:"Organizations",icon:Ha},{id:"repositories",label:"Repositories",icon:Ea},{id:"author",label:"Author",icon:Ka}]},{label:"CONFIGURATION",items:[{id:"notifications",label:"Notifications",icon:Be}]},{label:"SYSTEM",items:[{id:"system",label:"System",icon:Za}]}];function Fo({settings:e,onSave:o,onRepositoriesChanged:s,host:r}){let[i,n]=d(e.settingsActiveNav??Ct),l=I=>{let m={...e,...I};o(m),r.cache.set("settings",m),r.cache.refreshBadge()},u=I=>{n(I),l({settingsActiveNav:I})};return a("div",{className:"prm-settings-shell",children:t("div",{className:"prm-settings-body",children:[a("nav",{className:"prm-settings-nav","aria-label":"Settings sections",children:Us.map(I=>t("div",{className:"prm-nav-group",children:[a("div",{className:"prm-nav-group-label",children:I.label}),I.items.map(m=>{let b=m.icon;return t("button",{type:"button",className:`prm-nav-row${i===m.id?" active":""}`,"aria-current":i===m.id,onClick:()=>u(m.id),children:[a(b,{size:15,"aria-hidden":!0}),a("span",{children:m.label})]},m.id)})]},I.label))}),t("div",{className:"prm-settings-pane",children:[i==="organizations"&&a(ko,{host:r}),i==="repositories"&&a(Ro,{host:r,onRepositoriesChanged:s}),i==="author"&&a(Mo,{host:r}),i==="notifications"&&a(To,{settings:e,update:l}),i==="system"&&a(Bo,{settings:e,update:l,host:r})]})]})})}function Eo(e){return e.length===1?e[0]:e.length===2?`${e[0]} and ${e[1]}`:`${e.slice(0,-1).join(", ")}, and ${e[e.length-1]}`}function Ho(e,o,s){return e===1?o:s}function Oo(e){if(!e)return null;let o=e.disconnectedHosts??[],s=e.remoteGone??[],r=e.outageHosts??[];return o.length>0?{kind:"disconnect",subjects:o,action:"settings",message:`GitHub sign-in expired for ${Eo(o)} \u2014 re-authenticate to resume syncing.`}:s.length>0?{kind:"remote-gone",subjects:s,action:"resolve",message:`${s.length} ${Ho(s.length,"repository is","repositories are")} no longer reachable on GitHub.`}:r.length>0?{kind:"outage",subjects:r,action:"none",message:`GitHub ${Ho(r.length,"is","is")} temporarily unreachable for ${Eo(r)} \u2014 retrying automatically.`}:null}function _s(e,o){let s=(e.repo??"").toLowerCase();if(s)return(o??[]).find(r=>`${r.owner}/${r.repo}`.toLowerCase()===s)}function qo(e,o){let s=_s(e,o.repositories);if(!((s?s.notifyInApp!==!1:!0)&&!e.muted))return{inApp:!1,inbox:!1};let n=o.notifyInApp??o.notifyOnChange??!1,l=o.sendToInbox??!1;return{inApp:n,inbox:l&&!!e.projectId}}function Uo(e){return e.replace(/[\\`*_[\]]/g,"\\$&").replace(/\r?\n/g," ").trim()}function zs(e){try{let o=new URL(e);if(o.protocol!=="http:"&&o.protocol!=="https:")return""}catch{return""}return e.replace(/[)\s]/g,encodeURIComponent)}async function zo(e,o,s){for(let r of o){let i=vt(r.newStatus)>vt(r.oldStatus);if(!(r.newStatus==="failed"||r.newStatus==="conflict"||r.newStatus==="yellow"||r.newStatus==="green"||r.newStatus==="closed-merged"||r.newStatus==="closed-abandoned"||i))continue;let l=qo(r.pr,s);if(!l.inApp&&!l.inbox)continue;let u=Uo(r.pr.repo),I=Uo(r.pr.title),m=zs(r.pr.url),b=m?`[${I}](${m})`:I;if(l.inApp&&e.toast(`${r.pr.repo}#${r.pr.number}: ${Ne(r.oldStatus)} \u2192 ${Ne(r.newStatus)}`,"info"),l.inbox&&r.pr.projectId){let C=`**${u}#${r.pr.number}** \u2014 ${Ne(r.oldStatus)} \u2192 **${Ne(r.newStatus)}**

${b}`;try{await e.pushInbox({comments:C,projectId:r.pr.projectId})}catch{e.toast(`PR Monitor: couldn't post inbox notification for ${r.pr.repo}#${r.pr.number}`,"error")}}}}var Tt="activeSubTab",Go="listSort",Vo="hostScope",Dt="listView";function Nt({host:e}){let[o,s]=d(null),[r,i]=d(!1),[n,l]=d(()=>e.cache.get(ie)??[]),[u,I]=d(!1),[m,b]=d(null),[C,w]=d("prs"),[g,v]=d(!1),[x,f]=d(null),[D,A]=d(0),[T,N]=d(!1),[_,X]=d(!1),[z,U]=d(!1),[$,y]=d([]),[F,W]=d("status"),[J,P]=d("asc"),[fe,se]=d([]),[E,be]=d("board"),[Re,R]=d(!1),[B,M]=d(()=>({...Xt})),ae=ue(null),ne=ue(!0);q(()=>(ne.current=!0,()=>{ne.current=!1}),[]);let[Ie,pe]=d(()=>e.listProjects());q(()=>{let h=!0;return f(null),v(!1),Promise.all([e.storage.get(ya),e.storage.get(Tt),e.call("listPrs"),e.storage.get(Go),e.storage.get(Vo),e.storage.get(Dt)]).then(([L,S,H,K,he,Ce])=>{if(!h)return;K?.field&&W(K.field),K?.dir&&P(K.dir),Array.isArray(he)&&se(he),Mt(Ce)&&be(Ce);let k=L?{...Sa,...L,relevanceModes:{...Sa.relevanceModes,...L.relevanceModes}}:null;s(k),k&&(e.cache.set("settings",k),e.cache.refreshBadge?.()),S==="prs"||S==="settings"?w(S):(S==="board"||S==="list")&&(w("prs"),Mt(Ce)||(be(S),e.storage.set(Dt,S)),e.storage.set(Tt,"prs")),Array.isArray(H)&&(l(H),e.cache.set(ie,H),e.cache.set(Ae,H.length),e.cache.refreshBadge?.()),i(!0),v(!0),U(!0)}).catch(L=>{h&&(console.error("pr-monitor hydrate failed",L),f(L instanceof Error?L.message:String(L)),v(!0))}),()=>{h=!1}},[e,D]),q(()=>{let h=()=>{let S=e.cache.get(ie);S&&l(K=>K===S?K:S);let H=e.listProjects();pe(K=>K.length===H.length&&K.every((he,Ce)=>he.id===H[Ce].id&&he.name===H[Ce].name&&he.path===H[Ce].path)?K:H)},L=window.setInterval(h,100);return()=>window.clearInterval(L)},[e]);let me=h=>{w(h),e.storage.set(Tt,h)},we=Z(async h=>{I(!0),b(null);try{let L=Array.isArray(h)&&h.length>0,H=L?await e.call("syncRepos",{repos:h}):await e.call("pollAll"),K=Date.now()+3e5;for(;(H.state==="running"||H.state==="queued")&&ne.current&&Date.now()<K;)await new Promise(k=>window.setTimeout(k,250)),H=await e.call("syncStatus",{id:H.id});if((H.state===void 0||H.state==="succeeded")&&Array.isArray(H.prs)){if(l(H.prs),e.cache.set(ie,H.prs),e.cache.set(Ae,H.prs.length),e.cache.refreshBadge?.(),Array.isArray(H.deltas)&&H.deltas.length>0){let k=o??{...Sa,...await e.storage.get(ya)};await zo(e,H.deltas,k)}}else!ne.current||Date.now()>=K?b("Sync is still running. Check back shortly."):H?.error&&b(H.error);let Ce=H?.health;!L&&Ce&&M(Ce)}catch(L){b(L instanceof Error?L.message:String(L))}finally{I(!1),R(!0)}},[e]),ea=ue(!1);q(()=>{!z||ea.current||(ea.current=!0,e.call("getSyncHealth").then(h=>{h?.ok&&h.health&&M(h.health)}).catch(()=>{}),we())},[z,we,e]);let ia=Z(async(h,L)=>{try{let S=await e.call("resolveRemoteGone",{repo:h,action:L});if(!S?.ok){e.toast(`Couldn't ${L} ${h} \u2014 ${S?.error??"unknown error"}`,"error");return}M(H=>({...H,remoteGone:H.remoteGone.filter(K=>K.toLowerCase()!==h.toLowerCase()),keptGone:L==="keep"?[...H.keptGone,h].filter((K,he,Ce)=>Ce.indexOf(K)===he):H.keptGone})),we()}catch(S){e.toast(`Couldn't ${L} ${h} \u2014 ${S instanceof Error?S.message:String(S)}`,"error")}},[e,we]),ba=Z(async h=>{try{let L=await e.call("removePr",h);L?.ok&&Array.isArray(L.prs)&&(l(L.prs),e.cache.set(ie,L.prs),e.cache.set(Ae,L.prs.length),e.cache.refreshBadge?.())}catch(L){e.toast(`Couldn't remove PR \u2014 ${L instanceof Error?L.message:String(L)}`,"error")}},[e]),ve=Z(async h=>{let L=n.find(S=>S.url===h);if(L)try{let S;L.source==="auto"?S=await e.call("dismissPr",{url:h}):S=await e.call("removePr",h),S?.ok&&Array.isArray(S.prs)&&(l(S.prs),e.cache.set(ie,S.prs),e.cache.set(Ae,S.prs.length),e.cache.refreshBadge?.())}catch(S){e.toast(`Couldn't dismiss PR \u2014 ${S instanceof Error?S.message:String(S)}`,"error")}},[e,n]),da=Z(async h=>{s(h);let L=await e.storage.get(ya),S={...h};L&&(S.organizations=L.organizations,S.repositories=L.repositories,S.author=L.author,S.orgDiscovered=L.orgDiscovered,S.authorDiscovered=L.authorDiscovered),await e.storage.set(ya,S),e.cache.set("settings",S),e.cache.refreshBadge?.()},[e]),Xe=Z(async()=>{let h=await e.storage.get(ya);h?.repositories&&s(L=>L&&{...L,repositories:h.repositories})},[e]),Q=Z(async(h,L)=>{try{let S=await e.call("assignProject",h,L);S?.ok&&Array.isArray(S.prs)&&(l(S.prs),e.cache.set(ie,S.prs))}catch(S){e.toast(`Couldn't assign project \u2014 ${S instanceof Error?S.message:String(S)}`,"error")}},[e]),ee=Z((h,L)=>{W(h),P(L),e.storage.set(Go,{field:h,dir:L})},[e]),le=Z(h=>{se(h),e.storage.set(Vo,h)},[e]),te=Z(h=>{be(h),e.storage.set(Dt,h)},[e]),Y=Z(async(h,L)=>{if(h.length!==0)try{let S=await e.call("setPrsSeen",{urls:h,seen:L});S?.ok&&Array.isArray(S.prs)&&(l(S.prs),e.cache.set(ie,S.prs),e.cache.set("monitoredCount",S.prs.length),e.cache.refreshBadge?.())}catch(S){e.toast(`Couldn't update read state \u2014 ${S instanceof Error?S.message:String(S)}`,"error")}},[e]),Ue=Z(async(h,L)=>{if(h.length!==0)try{let S=await e.call("setPrsFavorite",{urls:h,favorite:L});S?.ok&&Array.isArray(S.prs)&&(l(S.prs),e.cache.set(ie,S.prs))}catch(S){e.toast(`Couldn't update favorites \u2014 ${S instanceof Error?S.message:String(S)}`,"error")}},[e]),Me=Z(async h=>{if(h.length!==0)try{let L=await e.call("dismissPrs",{urls:h});L?.ok&&Array.isArray(L.prs)&&(l(L.prs),e.cache.set(ie,L.prs),e.cache.set(Ae,L.prs.length),e.cache.refreshBadge?.())}catch(L){e.toast(`Couldn't dismiss PRs \u2014 ${L instanceof Error?L.message:String(L)}`,"error")}},[e]),ce=oe(()=>{if($.length===0)return n;let h=new Set($.map(L=>L.toLowerCase()));return n.filter(L=>h.has(L.repo.toLowerCase()))},[n,$]),Te=oe(()=>ce.filter(h=>yo.includes(h.status)).map(h=>h.url),[ce]),De=oe(()=>Oo(B),[B]);return g?x!==null?a("section",{className:"prm-panel",children:t("div",{className:"prm-empty",role:"alert",children:[a($e,{size:28,"aria-hidden":!0}),a("h3",{children:"Couldn't load PR Monitor"}),a("p",{children:x}),t("button",{type:"button",className:"prm-btn",onClick:()=>A(h=>h+1),children:[a(ke,{size:13,"aria-hidden":!0})," Retry loading"]})]})}):o?t("section",{className:"prm-panel",children:[t("header",{className:"prm-header",children:[t("div",{className:"prm-header-title",children:[a(Le,{size:16,className:"prm-header-icon","aria-hidden":!0}),t("div",{className:"prm-header-heading",children:[a("h2",{children:C==="settings"?"Settings":"PR Monitor"}),a("p",{className:"prm-header-subtitle",children:C==="settings"?"Manage GitHub connections and PR monitoring preferences.":"Authored, review, and tracked pull requests"})]}),C==="prs"&&a("span",{className:"prm-count-pill",children:ce.length})]}),t("div",{className:"prm-header-actions",children:[C==="prs"&&t(re,{children:[t("button",{type:"button",className:"prm-btn",onClick:()=>N(!0),title:"Add a specific pull request to the monitored list",children:[a(Ua,{size:13})," ",a("span",{children:"Add PR"})]}),Te.length>0&&t("button",{type:"button",className:"prm-btn",onClick:()=>void Me(Te),title:`Sweep \u2014 dismiss the ${Te.length} Merged/Closed PR(s) from the list`,children:[a(ge,{size:13})," ",a("span",{children:"Sweep"})]}),t("div",{className:"prm-split-btn",children:[t("button",{type:"button",className:"prm-btn prm-btn--primary prm-split-primary",onClick:()=>void we($),disabled:u,title:$.length>0?`Sync the ${$.length} selected repositor${$.length===1?"y":"ies"} now`:"Sync all monitored PRs now",children:[u?a(V,{size:13,className:"prm-spin"}):a(ke,{size:13}),a("span",{children:"Sync"})]}),a("button",{ref:ae,type:"button",className:"prm-btn prm-btn--primary prm-split-caret",onClick:()=>X(h=>!h),disabled:u,title:"Sync & Filter \u2014 choose which repositories to show and sync","aria-label":"Open Sync & Filter picker",children:a(Ia,{size:13})}),_&&a(Po,{anchorRef:ae,host:e,selectedRepos:$,onClose:()=>X(!1),onToggleRepo:h=>y(L=>L.includes(h)?L.filter(S=>S!==h):[...L,h]),onSelectAll:()=>y([]),onSync:h=>void we(h)})]})]}),a("button",{type:"button",className:"prm-btn prm-header-mode","aria-pressed":C==="settings",onClick:()=>me(C==="settings"?"prs":"settings"),title:C==="settings"?"Back to pull requests":"Settings",children:C==="settings"?t(re,{children:[a(Ba,{size:13,"aria-hidden":!0})," ",a("span",{children:"PRs"})]}):t(re,{children:[a(ja,{size:13,"aria-hidden":!0})," ",a("span",{children:"Settings"})]})})]})]}),t("div",{className:`prm-content${C==="prs"&&E==="board"?" prm-content--board":""}`,children:[m&&a("div",{className:"prm-error",children:m}),C==="prs"&&De&&t("div",{className:`prm-sync-clue prm-sync-clue--${De.kind}`,role:"status",children:[De.kind==="disconnect"&&a(Xa,{size:14,"aria-hidden":!0}),De.kind==="remote-gone"&&a($e,{size:14,"aria-hidden":!0}),De.kind==="outage"&&a(qa,{size:14,"aria-hidden":!0}),a("span",{className:"prm-sync-clue-msg",children:De.message}),De.action==="settings"&&a("button",{type:"button",className:"prm-sync-clue-action",onClick:()=>me("settings"),children:"Open Settings"})]}),C==="prs"&&B.remoteGone.map(h=>t("div",{className:"prm-sync-prompt",role:"alertdialog","aria-label":`Repository ${h} is gone`,children:[t("span",{className:"prm-sync-prompt-msg",children:[a("strong",{children:h})," can't be found on GitHub. Remove it, or keep the last-known PRs?"]}),t("div",{className:"prm-sync-prompt-actions",children:[a("button",{type:"button",className:"prm-btn",onClick:()=>void ia(h,"keep"),children:"Keep"}),a("button",{type:"button",className:"prm-btn prm-btn--danger",onClick:()=>void ia(h,"remove"),children:"Remove"})]})]},h)),C==="prs"&&a(wo,{prs:ce,host:e,projects:Ie,tisWarnHours:o.tisWarnHours,tisDangerHours:o.tisDangerHours,reviewWarnDays:o.reviewWarnDays,reviewDangerDays:o.reviewDangerDays,repositories:o.repositories,workItemLocatorBase:o.gusLocatorBaseUrl,sortField:F,sortDir:J,onSortChange:ee,hostScope:fe,onHostScopeChange:le,awaitingFirstSync:!Re,syncing:u,autoSyncEnabled:o.autoSyncEnabled??!0,onDismiss:h=>void ve(h),onProjectAssign:(h,L)=>void Q(h,L),onBulkSetSeen:(h,L)=>void Y(h,L),onBulkDismiss:h=>void Me(h),onBulkSetFavorite:(h,L)=>void Ue(h,L),viewMode:E,onViewModeChange:te}),C==="settings"&&r&&a(Fo,{settings:o,onSave:h=>void da(h),onRepositoriesChanged:()=>void Xe(),host:e})]}),T&&a(vo,{host:e,onClose:()=>N(!1),onPulled:h=>{l(h),e.cache.set(ie,h),e.cache.set(Ae,h.length),e.cache.refreshBadge?.(),N(!1)}})]}):a("section",{className:"prm-panel",children:a(Jt,{onSave:async h=>{await da(h)}})}):a("section",{className:"prm-panel",children:t("div",{className:"prm-loading",children:[a(V,{size:16,className:"prm-spin"})," Loading PR Monitor\u2026"]})})}function $o(e){if(e.length!==0)return e.length===1?e[0]:e}var Bt=new Map,jo,Vs=5e3;function Ft(e){jo=e}function $s(){return{get:e=>Bt.get(e),set:(e,o)=>{Bt.set(e,o)},delete:e=>{Bt.delete(e)},refreshBadge:()=>jo?.()}}function js(e,o){globalThis.__ZCC_PLUGIN_RUNTIME__?.toast?.(e,o)}function Ws(e){try{let o=new URL(e);if(o.protocol!=="https:"&&o.protocol!=="http:"||typeof window>"u")return;window.open(o.href,"_blank","noopener,noreferrer")}catch{}}function Wo(e){let o=[],s=!1,r=0,i=async()=>{if(!(s||Date.now()<r)){s=!0;try{let n=await ua(e,"listProjects");Array.isArray(n)&&(o=n)}catch{}finally{r=Date.now()+Vs,s=!1}}};return i(),{call:(n,...l)=>ua(e,n,$o(l)),storage:{get:n=>ua(e,"storageGet",n),set:async(n,l)=>{await ua(e,"storageSet",{key:n,value:l})}},cache:$s(),toast:js,listProjects:()=>(i(),o),openExternal:Ws,pushInbox:async n=>n.projectId?await ua(e,"pushInbox",n):{id:""}}}var Et="prs-changed";var Ht=`/*
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
`;var Xo="pr-monitor",Ko="prm-plugin-styles";function Xs(){return globalThis.__ZCC_PLUGIN_RUNTIME__}function Zs(){if(typeof document>"u")return;let e=document.getElementById(Ko);if(e instanceof HTMLStyleElement){e.textContent=`${At}
${Ht}`;return}let o=document.createElement("style");o.id=Ko,o.textContent=`${At}
${Ht}`,document.head.appendChild(o)}Zs();var Js={height:"100%",minHeight:0,display:"flex",flexDirection:"column"};function Ys(){let e=oe(()=>Wo(Xo),[]);return Lt(Et,o=>{let s=o?.prs;Array.isArray(s)&&(e.cache.set(ie,s),e.cache.set(Ae,s.length),e.cache.refreshBadge?.())}),a("div",{style:Js,children:a(Nt,{host:e})})}function Qs(){let[e,o]=d(null),s=ue(!0),r=ue(0),i=Z(async()=>{let n=++r.current;try{let l=await ua(Xo,"badge");if(!s.current||n!==r.current)return;let u=typeof l?.count=="number"&&l.count>0?l.count:null;o(u)}catch(l){if(!s.current||n!==r.current)return;console.warn("[pr-monitor] badge refresh failed",l),o(null)}},[]);return q(()=>(s.current=!0,i(),Ft(()=>{s.current&&i()}),()=>{s.current=!1,r.current++,Ft(void 0)}),[i]),Lt(Et,n=>{(async()=>{let l=Array.isArray(n?.inAppDeltas)?n.inAppDeltas:[];if(i(),l.length===0)return;let u=Xs();for(let I of l)u?.toast?.(`${I.pr.repo}#${I.pr.number}: ${Ne(I.oldStatus)} -> ${Ne(I.newStatus)}`,"info")})().catch(l=>console.warn("[pr-monitor] notification delivery failed",l))}),e==null?null:a("span",{className:"nav-badge",children:e})}var gp=zt(e=>{e.slots.navPanel({id:"main",title:"PR Monitor",icon:"GitPullRequest",component:Ys,experimental_sidebarAccessory:Qs}),e.slots.commandPaletteAction({id:"open",title:"Open PR Monitor",run:o=>{o.toPluginPanel("main")}})});export{gp as default,Zs as injectStyles};
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
