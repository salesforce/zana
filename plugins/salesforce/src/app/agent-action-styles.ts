import { STUDIO_TOKENS } from './studio/studio-tokens.js';
export const AGENT_ACTION_STYLES = `
${STUDIO_TOKENS}.af-action-workspace { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
.af-related-tabs { display:flex; flex-shrink:0; overflow:auto; border-bottom:1px solid var(--sf-border); min-height:34px; background:var(--sf-surface); }
.af-related-tab { display:flex; align-items:center; max-width:240px; flex-shrink:0; border-right:1px solid var(--sf-border); border-bottom:2px solid transparent; }
.af-related-tab.is-active { border-bottom-color:var(--sf-accent); background:var(--sf-elevated); }
.af-related-tab button { border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:11px; padding:8px 10px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-related-tab.is-active button { color:var(--sf-text); }
.af-action-explorer { border-top:1px solid var(--sf-border); padding-top:10px; margin-top:12px; }
.af-action-explorer .sf-as-section-label { display:flex; justify-content:space-between; }
.af-action-explorer summary { cursor:pointer; font-size:11px; padding:8px 6px 4px; color:var(--sf-muted); overflow:hidden; text-overflow:ellipsis; }
.af-action-icon { display:inline-flex; flex-shrink:0; align-items:center; justify-content:center; width:22px; height:22px; font:600 11px monospace; color:var(--sf-muted); }
.af-action-icon.apex { color:var(--syntax-function, #a98ef5); }
.af-action-icon.flow { color:var(--sf-accent); }
.af-action-panel { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; color:var(--sf-text); background:var(--sf-surface); overflow:hidden; }
.af-action-heading { padding:12px 16px 10px; flex-shrink:0; display:flex; flex-direction:column; gap:6px; }
.af-action-title { display:flex; gap:8px; align-items:center; flex-wrap:wrap; min-width:0; }
.af-action-name { display:flex; align-items:center; gap:6px; flex:1 1 220px; min-width:0; flex-wrap:wrap; }
.af-chip { flex-shrink:0; font-size:10px; line-height:16px; padding:0 7px; border-radius:9px; border:1px solid var(--sf-border); color:var(--sf-muted); white-space:nowrap; }
.af-chip.is-ok { color:var(--sf-success); border-color:color-mix(in srgb,var(--sf-success) 35%,transparent); background:color-mix(in srgb,var(--sf-success) 10%,transparent); }
.af-action-glance { position:relative; display:flex; flex-wrap:wrap; align-items:center; gap:4px 14px; padding-left:30px; font-size:11px; color:var(--sf-muted); min-width:0; }
.af-action-glance b { color:var(--sf-text); font-weight:500; }
.af-action-glance code { font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
.af-source-info summary { cursor:pointer; list-style:none; font-size:13px; }
.af-source-info summary::-webkit-details-marker { display:none; }
.af-action-heading .af-source-info p { position:absolute; z-index:2; top:100%; left:0; margin:6px 0 0; padding:10px 12px; width:320px; max-width:100%; box-sizing:border-box; max-height:none; border:1px solid var(--sf-border); border-radius:6px; background:var(--sf-elevated); box-shadow:0 4px 12px color-mix(in srgb,var(--sf-text) 12%,transparent); }
.af-backlink { border:0; border-radius:10px; padding:1px 8px; font:inherit; font-size:11px; color:var(--sf-accent); background:color-mix(in srgb,var(--sf-accent) 12%,transparent); cursor:pointer; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-backlink:hover { background:color-mix(in srgb,var(--sf-accent) 20%,transparent); }
.af-drift { display:inline-block; width:6px; height:6px; margin-left:5px; border-radius:50%; background:var(--sf-warn); vertical-align:1px; }
.af-action-title h2 { font-size:15px; white-space:nowrap; font-weight:600; letter-spacing:-.025em; margin:0; overflow:hidden; text-overflow:ellipsis; }
.af-action-heading p { margin:0; padding-left:30px; font-size:12px; line-height:1.5; max-height:54px; overflow:auto; color:var(--sf-muted); }
.af-action-sourcebar { display:flex; align-items:center; gap:4px; margin-left:auto; min-width:0; }
.af-action-sourcebar [role=group] { display:flex; padding:2px; border:1px solid var(--sf-border); border-radius:6px; min-width:0; }
.af-action-sourcebar button,.af-action-tools button,.af-flow-toolbar button,.af-flow-detail button { font:inherit; font-size:11px; border:0; border-radius:4px; background:transparent; color:var(--sf-muted); cursor:pointer; padding:4px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-action-sourcebar button[aria-pressed=true],.af-action-tools button[aria-pressed=true] { background:var(--sf-elevated); color:var(--sf-text); box-shadow:0 0 0 1px var(--sf-border); }
.af-action-sourcebar button:disabled { opacity:.4; cursor:default; }
.af-action-nav { display:flex; align-items:center; flex-shrink:0; border-block:1px solid var(--sf-border); overflow-x:auto; padding:0 12px; }
.af-action-nav button { border:0; border-bottom:2px solid transparent; background:transparent; color:var(--sf-muted); font:inherit; font-size:11px; cursor:pointer; padding:10px 8px 9px; white-space:nowrap; }
.af-action-nav button[aria-pressed=true] { border-bottom-color:var(--sf-accent); color:var(--sf-text); }
.af-action-nav > button { display:inline-flex; align-items:center; gap:5px; }
.af-tab-count { font-size:9px; line-height:14px; min-width:14px; padding:0 4px; border-radius:7px; text-align:center; color:var(--sf-muted); background:color-mix(in srgb,var(--sf-muted) 16%,transparent); }
.af-tab-count.is-warn { color:var(--sf-warn); background:color-mix(in srgb,var(--sf-warn) 16%,transparent); }
.af-action-tools { margin-left:auto; display:flex; gap:2px; }
.af-action-tools button { display:inline-flex; align-items:center; padding:4px 6px; }
.af-flow-split { flex:1; min-height:0; display:flex; }
.af-flow-split > .af-flow, .af-flow-split > .af-flow-viewport { flex:1; min-width:0; }
.af-flow-rail { width:260px; flex-shrink:0; overflow:auto; border-left:1px solid var(--sf-border); padding:12px 14px; font-size:11px; }
@container af-editor (max-width:640px) { .af-flow-rail { width:200px; } }
.af-flow-rail-section { margin-bottom:14px; }
.af-flow-rail-section h3 { display:flex; justify-content:space-between; margin:0 0 6px; font-size:10px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--sf-muted); }
.af-flow-rail-param { display:grid; grid-template-columns:1fr auto; gap:2px 8px; padding:6px 0; border-bottom:1px solid var(--sf-border); }
.af-flow-rail-param > span { font-family:monospace; font-size:10px; color:var(--sf-muted); }
.af-flow-rail-param small { grid-column:1 / -1; font-size:10px; color:var(--sf-muted); }
.af-flow-rail-param small.is-ok { color:var(--sf-success); }
.af-flow-rail-param small.is-warn { color:var(--sf-warn); }
.af-flow-rail dl { display:grid; grid-template-columns:56px 1fr; gap:4px 8px; margin:0; }
.af-flow-rail dt { color:var(--sf-muted); }
.af-flow-rail dd { margin:0; display:flex; flex-wrap:wrap; gap:2px 8px; overflow-wrap:anywhere; }
.af-flow-rail dd .af-target-link { padding:0; font-size:11px; }
.af-action-content { flex:1; min-height:0; overflow:auto; padding:16px 20px; }
.af-action-content.is-implementation { display:flex; flex-direction:column; padding:0; }
.af-action-code { flex:1; width:100%; min-height:150px; border:0; background:transparent; }
.af-action-note { font-size:12px; color:var(--sf-muted); line-height:1.6; margin:0 0 14px; }
.is-implementation > .af-action-note { padding:18px 20px; margin:0; }
.af-action-parameters h3 { font-size:12px; margin:18px 0 8px; }
.af-action-parameters { overflow:auto; }
.af-action-parameters table { width:100%; border-collapse:collapse; font-size:11px; text-align:left; }
.af-action-parameters th,.af-action-parameters td { padding:10px 8px; border-bottom:1px solid var(--sf-border); vertical-align:top; }
.af-action-parameters thead th { color:var(--sf-muted); font-weight:500; }
.af-action-parameters small { display:block; font-size:10px; font-weight:400; color:var(--sf-muted); line-height:1.5; margin-top:4px; }
.af-action-warning { color:var(--sf-warn); }
.af-target-link,.af-source-candidate { border:0; background:transparent; color:var(--sf-accent); text-align:left; cursor:pointer; font:inherit; font-size:12px; padding:8px 0; overflow-wrap:anywhere; }
.af-source-candidate { margin:0 20px; }
.af-action-use { border:1px solid var(--sf-border); border-radius:7px; margin-top:12px; overflow:hidden; }
.af-action-use button { display:flex; gap:12px; justify-content:space-between; width:100%; font:inherit; font-size:11px; background:var(--sf-elevated); color:var(--sf-text); border:0; border-bottom:1px solid var(--sf-border); padding:10px 12px; cursor:pointer; }
.af-action-use button span { color:var(--sf-muted); }
.af-action-use pre,.af-flow-detail pre { font-size:11px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; padding:12px; margin:0; }
.af-action-empty { padding:28px 8px; max-width:480px; margin:0 auto; font-size:12px; line-height:1.7; color:var(--sf-muted); }
.af-action-empty strong { color:var(--sf-text); }
.af-flow { flex:1; min-height:0; display:flex; flex-direction:column; }
.af-flow-official { position:relative; flex:1; min-height:240px; display:flex; }
.af-flow-frame { width:100%; flex:1; min-width:0; border:0; background:var(--sf-surface); }
.af-flow-loading { position:absolute; inset:0; z-index:1; display:grid; place-items:center; background:var(--sf-surface); }
.af-flow-dependencies { flex-shrink:0; border-top:1px solid var(--sf-border); padding:8px 14px; font-size:11px; color:var(--sf-muted); }
.af-flow-dependencies summary { cursor:pointer; }
.af-flow-dependencies > div { display:flex; flex-wrap:wrap; gap:4px 16px; max-height:110px; overflow:auto; }
.af-flow-dialog { color:var(--sf-text); background:var(--sf-surface); border:1px solid var(--sf-border); border-radius:10px; padding:0; width:calc(100vw - 40px); height:calc(100vh - 40px); max-width:none; max-height:none; }
.af-flow-dialog[open] { display:flex; flex-direction:column; }
.af-flow-dialog::backdrop { background:rgba(0,0,0,.5); }
.af-flow-dialog > header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 16px; border-bottom:1px solid var(--sf-border); }
.af-flow-dialog > header div { min-width:0; }
.af-flow-dialog-actions { display:flex; gap:4px; flex-shrink:0; }
.af-flow-dialog strong { font-size:14px; overflow-wrap:anywhere; }
.af-flow-dialog small { display:block; font-size:11px; color:var(--sf-muted); margin-top:3px; }
.af-flow-toolbar { display:flex; flex-shrink:0; gap:4px; padding:6px 12px; align-items:center; font-size:10px; color:var(--sf-muted); }
.af-flow-toolbar[hidden] { display:none; }
.af-flow-toolbar span { margin-right:auto; }
.af-flow-viewport { flex:1; overflow:auto; min-height:150px; background-image:radial-gradient(var(--sf-border) .7px, transparent .7px); background-size:16px 16px; }
.af-flow-viewport svg { display:block; margin:0 auto; color:var(--sf-muted); }
.af-flow-node { cursor:pointer; }
.af-flow-node rect { fill:var(--sf-elevated); stroke:var(--sf-border); }
.af-flow-node.is-selected rect,.af-flow-node:focus rect { stroke:var(--sf-accent); stroke-width:2; }
.af-flow-kind { fill:var(--sf-muted); font-size:10px; }
.af-flow-label { fill:var(--sf-text); font-size:12px; font-weight:500; }
.af-flow-edge { fill:none; stroke:var(--sf-muted); stroke-width:1; }
.af-flow-edge-label { fill:var(--sf-muted); font-size:9px; paint-order:stroke; stroke:var(--sf-surface); stroke-width:4px; }
.is-fault .af-flow-edge { stroke:var(--sf-danger); stroke-dasharray:4 4; }
.af-flow-detail { max-height:210px; overflow:auto; border-top:1px solid var(--sf-border); padding:10px 16px; font-size:12px; }
.af-flow-detail > div { display:flex; justify-content:space-between; align-items:center; }
.af-flow-detail pre { padding:8px 0; font-size:10px; }
`;
