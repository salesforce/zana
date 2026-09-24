export const AGENT_ACTION_STYLES = `
.af-action-workspace { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
.af-related-tabs { display:flex; flex-shrink:0; overflow:auto; border-bottom:1px solid var(--sf-as-border); min-height:34px; background:var(--sf-as-surface); }
.af-related-tab { display:flex; align-items:center; max-width:240px; flex-shrink:0; border-right:1px solid var(--sf-as-border); border-bottom:2px solid transparent; }
.af-related-tab.is-active { border-bottom-color:var(--sf-as-accent); background:var(--sf-as-elevated); }
.af-related-tab button { border:0; background:transparent; color:var(--sf-as-muted); font:inherit; font-size:11px; padding:8px 10px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-related-tab.is-active button { color:var(--sf-as-text); }
.af-action-explorer { border-top:1px solid var(--sf-as-border); padding-top:10px; margin-top:12px; }
.af-action-explorer .sf-as-section-label { display:flex; justify-content:space-between; }
.af-action-explorer summary { cursor:pointer; font-size:11px; padding:8px 6px 4px; color:var(--sf-as-muted); overflow:hidden; text-overflow:ellipsis; }
.af-action-icon { display:inline-flex; flex-shrink:0; align-items:center; justify-content:center; width:22px; height:22px; font:600 11px monospace; color:var(--sf-as-muted); }
.af-action-icon.apex { color:var(--syntax-function, #a98ef5); }
.af-action-icon.flow { color:var(--accent, #70aaff); }
.af-action-panel { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; color:var(--sf-as-text); background:var(--sf-as-surface); overflow:hidden; }
.af-action-heading { padding:15px 20px 12px; flex-shrink:0; }
.af-action-breadcrumb { color:var(--sf-as-muted); font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-action-breadcrumb span { padding:0 7px; }
.af-action-title { display:flex; gap:8px; align-items:center; margin:9px 0 6px; }
.af-action-title h2 { font-size:17px; font-weight:600; letter-spacing:-.025em; margin:0; overflow:hidden; text-overflow:ellipsis; }
.af-action-readonly { margin-left:auto; color:var(--sf-as-muted); white-space:nowrap; font-size:10px; border:1px solid var(--sf-as-border); border-radius:4px; padding:3px 5px; }
.af-action-target { display:block; font-size:11px; color:var(--sf-as-muted); overflow-wrap:anywhere; }
.af-action-heading p { margin:8px 0 0; font-size:12px; line-height:1.5; max-height:54px; overflow:auto; color:var(--sf-as-muted); }
.af-action-sourcebar { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:0 20px 8px; }
.af-action-sourcebar [role=group] { display:flex; padding:2px; border:1px solid var(--sf-as-border); border-radius:6px; min-width:0; }
.af-action-sourcebar button,.af-flow-mode button,.af-flow-toolbar button,.af-flow-detail button { font:inherit; font-size:11px; border:0; border-radius:4px; background:transparent; color:var(--sf-as-muted); cursor:pointer; padding:4px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-action-sourcebar button[aria-pressed=true],.af-flow-mode button[aria-pressed=true] { background:var(--sf-as-elevated); color:var(--sf-as-text); box-shadow:0 0 0 1px var(--sf-as-border); }
.af-action-sourcebar button:disabled { opacity:.4; cursor:default; }
.af-action-provenance { padding:0 20px 10px; font-size:10px; color:var(--sf-as-muted); overflow-wrap:anywhere; }
.af-action-provenance small { display:block; margin-top:4px; font-size:10px; opacity:.8; }
.af-action-nav { display:flex; flex-shrink:0; border-block:1px solid var(--sf-as-border); overflow-x:auto; padding:0 12px; }
.af-action-nav button { border:0; border-bottom:2px solid transparent; background:transparent; color:var(--sf-as-muted); font:inherit; font-size:11px; cursor:pointer; padding:10px 8px 9px; white-space:nowrap; }
.af-action-nav button[aria-pressed=true] { border-bottom-color:var(--sf-as-accent); color:var(--sf-as-text); }
.af-action-content { flex:1; min-height:0; overflow:auto; padding:16px 20px; }
.af-action-content.is-implementation { display:flex; flex-direction:column; padding:0; }
.af-action-code { flex:1; width:100%; min-height:150px; border:0; background:transparent; }
.af-action-note { font-size:12px; color:var(--sf-as-muted); line-height:1.6; margin:0 0 14px; }
.is-implementation > .af-action-note { padding:18px 20px; margin:0; }
.af-action-parameters h3 { font-size:12px; margin:18px 0 8px; }
.af-action-parameters { overflow:auto; }
.af-action-parameters table { width:100%; border-collapse:collapse; font-size:11px; text-align:left; }
.af-action-parameters th,.af-action-parameters td { padding:10px 8px; border-bottom:1px solid var(--sf-as-border); vertical-align:top; }
.af-action-parameters thead th { color:var(--sf-as-muted); font-weight:500; }
.af-action-parameters small { display:block; font-size:10px; font-weight:400; color:var(--sf-as-muted); line-height:1.5; margin-top:4px; }
.af-action-warning { color:var(--warning, #bb872d); }
.af-target-link,.af-source-candidate { border:0; background:transparent; color:var(--sf-as-accent); text-align:left; cursor:pointer; font:inherit; font-size:12px; padding:8px 0; overflow-wrap:anywhere; }
.af-source-candidate { margin:0 20px; }
.af-action-use { border:1px solid var(--sf-as-border); border-radius:7px; margin-top:12px; overflow:hidden; }
.af-action-use button { display:flex; gap:12px; justify-content:space-between; width:100%; font:inherit; font-size:11px; background:var(--sf-as-elevated); color:var(--sf-as-text); border:0; border-bottom:1px solid var(--sf-as-border); padding:10px 12px; cursor:pointer; }
.af-action-use button span { color:var(--sf-as-muted); }
.af-action-use pre,.af-flow-detail pre { font-size:11px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; padding:12px; margin:0; }
.af-action-empty { padding:28px 8px; max-width:480px; margin:0 auto; font-size:12px; line-height:1.7; color:var(--sf-as-muted); }
.af-action-empty strong { color:var(--sf-as-text); }
.af-flow-mode { display:flex; gap:6px; padding:10px 20px; border-bottom:1px solid var(--sf-as-border); }
.af-flow { flex:1; min-height:0; display:flex; flex-direction:column; }
.af-flow-official { position:relative; flex:1; min-height:240px; display:flex; }
.af-flow-frame { width:100%; flex:1; min-width:0; border:0; background:var(--sf-as-surface); }
.af-flow-loading { position:absolute; inset:0; z-index:1; display:grid; place-items:center; background:var(--sf-as-surface); }
.af-flow-dependencies { flex-shrink:0; border-top:1px solid var(--sf-as-border); padding:8px 14px; font-size:11px; color:var(--sf-as-muted); }
.af-flow-dependencies summary { cursor:pointer; }
.af-flow-dependencies > div { display:flex; flex-wrap:wrap; gap:4px 16px; max-height:110px; overflow:auto; }
.af-flow-dialog { color:var(--sf-as-text); background:var(--sf-as-surface); border:1px solid var(--sf-as-border); border-radius:10px; padding:0; width:calc(100vw - 40px); height:calc(100vh - 40px); max-width:none; max-height:none; }
.af-flow-dialog[open] { display:flex; flex-direction:column; }
.af-flow-dialog::backdrop { background:rgba(0,0,0,.5); }
.af-flow-dialog > header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 16px; border-bottom:1px solid var(--sf-as-border); }
.af-flow-dialog > header div { min-width:0; }
.af-flow-dialog strong { font-size:14px; overflow-wrap:anywhere; }
.af-flow-dialog small { display:block; font-size:11px; color:var(--sf-as-muted); margin-top:3px; }
.af-flow-toolbar { display:flex; padding:6px 12px; align-items:center; font-size:10px; color:var(--sf-as-muted); }
.af-flow-toolbar span { margin-right:auto; }
.af-flow-viewport { flex:1; overflow:auto; min-height:150px; background-image:radial-gradient(var(--sf-as-border) .7px, transparent .7px); background-size:16px 16px; }
.af-flow-viewport svg { display:block; margin:0 auto; color:var(--sf-as-muted); }
.af-flow-node { cursor:pointer; }
.af-flow-node rect { fill:var(--sf-as-elevated); stroke:var(--sf-as-border); }
.af-flow-node.is-selected rect,.af-flow-node:focus rect { stroke:var(--sf-as-accent); stroke-width:2; }
.af-flow-kind { fill:var(--sf-as-muted); font-size:10px; }
.af-flow-label { fill:var(--sf-as-text); font-size:12px; font-weight:500; }
.af-flow-edge { fill:none; stroke:var(--sf-as-muted); stroke-width:1; }
.af-flow-edge-label { fill:var(--sf-as-muted); font-size:9px; paint-order:stroke; stroke:var(--sf-as-surface); stroke-width:4px; }
.is-fault .af-flow-edge { stroke:var(--danger, #c66); stroke-dasharray:4 4; }
.af-flow-detail { max-height:210px; overflow:auto; border-top:1px solid var(--sf-as-border); padding:10px 16px; font-size:12px; }
.af-flow-detail > div { display:flex; justify-content:space-between; align-items:center; }
.af-flow-detail pre { padding:8px 0; font-size:10px; }
`;
