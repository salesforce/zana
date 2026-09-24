import { WORKBENCH_STYLES } from "./workbench-styles.js";
/** All Salesforce surfaces inherit host appearance, including compact plugin panels. */
export const SALESFORCE_STYLES = `
.sf-surface { --sf-bg:var(--bg-panel); --sf-fg:var(--text-primary); color:var(--sf-fg); background:var(--sf-bg); font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; container:sf / inline-size; }
.sf-surface *, .sf-soql * { box-sizing:border-box; }
.sf-surface button, .sf-surface input, .sf-surface select, .sf-surface textarea { font:inherit; }
.sf-surface button:focus-visible, .sf-surface a:focus-visible, .sf-soql button:focus-visible { outline:2px solid var(--focus-ring,var(--accent)); outline-offset:2px; }
.sf-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; color:var(--text-primary); border:1px solid var(--border); background:var(--bg-panel); border-radius:6px; padding:6px 10px; cursor:pointer; white-space:nowrap; }
.sf-btn:hover { background:var(--bg-hover); }
.sf-btn.primary { background:var(--accent); border-color:transparent; color:var(--text-on-accent,#fff); }
.sf-btn:disabled { opacity:.5; cursor:default; }
.sf-btn.quiet { border-color:transparent; background:transparent; color:var(--text-muted); }
.sf-btn svg, .sf-header svg, .sf-empty svg, .sf-task svg { width:16px; height:16px; flex-shrink:0; }
.sf-header, .sf-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:12px 18px; border-bottom:1px solid var(--border); flex-shrink:0; }
.sf-header strong, .sf-toolbar strong { font-weight:600; }
.sf-workbench-toolbar { display:flex; align-items:center; gap:8px; min-height:42px; padding:0 10px; border-bottom:1px solid var(--border); flex-shrink:0; }
.sf-workbench-toolbar>.sf-tabs { flex:1; min-width:0; flex-wrap:nowrap; overflow-x:auto; padding:0; border:0; scrollbar-width:thin; }
.sf-workbench-toolbar .sf-tab { padding:9px 8px; white-space:nowrap; font-size:12px; }
.sf-workbench-org { display:flex; align-items:center; gap:8px; min-width:0; }
.sf-workbench-org-actions { display:flex; align-items:center; gap:2px; padding-left:7px; border-left:1px solid var(--border); flex-shrink:0; }
.sf-workbench-org-actions>.icon-btn { width:28px; height:28px; border-radius:6px; color:var(--text-muted); }
.sf-workbench-org-actions>.icon-btn:hover, .sf-workbench-org-actions>.icon-btn[aria-expanded=true] { color:var(--text-primary); background:var(--bg-hover); }
.sf-org-switcher { position:relative; min-width:0; max-width:260px; border:1px solid var(--border); border-radius:7px; background:color-mix(in srgb,var(--bg-elevated) 45%,transparent); }
.sf-org-switcher:hover { background:var(--bg-hover); }
.sf-org-switcher:focus-within { outline:2px solid var(--focus-ring,var(--accent)); outline-offset:2px; }
.sf-org-switcher[data-disabled=true] { opacity:.55; }
.sf-org-switcher-label { display:flex; align-items:center; gap:7px; height:28px; padding:0 8px; pointer-events:none; }
.sf-org-switcher-label svg { flex-shrink:0; }
.sf-org-switcher-icon { color:var(--text-muted); }
.sf-org-switcher-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:550; }
.sf-org-switcher-kind { flex-shrink:0; font-size:10px; line-height:16px; padding:0 5px; border-radius:4px; color:var(--text-muted); background:var(--bg-elevated); text-transform:capitalize; }
.sf-org-switcher-kind[data-kind=production] { color:var(--accent-gold,#c9a45d); background:color-mix(in srgb,var(--accent-gold,#c9a45d) 10%,transparent); }
.sf-org-switcher-chevron { margin-left:1px; color:var(--text-muted); }
.sf-org-switcher>.sf-org-picker { position:absolute; inset:0; width:100%; height:100%; max-width:none; opacity:0; cursor:pointer; }
.sf-org-switcher>.sf-org-picker:disabled { cursor:default; }
@container sf (max-width:720px) { .sf-workbench-toolbar { flex-wrap:wrap; gap:0; }.sf-workbench-toolbar>.sf-tabs { flex-basis:100%; }.sf-workbench-org { margin:4px 0; margin-left:auto; } }
.sf-grow { flex:1; }
.sf-muted { color:var(--text-muted); }
.sf-small { font-size:12px; }
.sf-badge { display:inline-flex; gap:5px; align-items:center; font-size:11px; padding:2px 6px; border-radius:4px; color:var(--text-muted); background:var(--bg-elevated); white-space:nowrap; }
.sf-badge[data-kind=production], .sf-badge[data-kind=unknown] { color:var(--accent-gold); }
.sf-badge[data-kind=sandbox], .sf-badge[data-kind=scratch], .sf-success { color:var(--success); }
.sf-error { color:var(--danger); }
.sf-tabs { display:flex; flex-wrap:wrap; padding:0 14px; gap:4px; border-bottom:1px solid var(--border); flex-shrink:0; }
.sf-tab { padding:11px 9px; border:0; border-bottom:2px solid transparent; color:var(--text-muted); background:none; cursor:pointer; font:inherit; }
.sf-tab[aria-selected=true] { color:var(--text-primary); border-bottom-color:var(--accent); }
.sf-scroll { overflow:auto; min-height:0; min-width:0; flex:1; }
.sf-content { padding:24px; }
.sf-content h2 { margin:0 0 6px; font-size:22px; font-weight:550; letter-spacing:-.4px; }
.sf-content h3, .sf-inspector h3 { margin:0 0 12px; font-size:13px; font-weight:600; }
.sf-content p { margin:0 0 14px; }
.sf-summary { display:flex; gap:14px; align-items:center; flex-wrap:wrap; padding:16px; border:1px solid var(--border); border-radius:8px; margin:22px 0; }
.sf-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; border-bottom:1px solid var(--border); padding:12px 0; }
.sf-row-main { flex:1; min-width:140px; overflow-wrap:anywhere; }
.sf-row-main small { display:block; color:var(--text-muted); font-size:12px; }
.sf-tasks { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:22px; }
.sf-task { display:flex; align-items:center; gap:12px; padding:16px; border:1px solid var(--border); border-radius:8px; background:var(--bg-panel); color:var(--text-primary); text-align:left; cursor:pointer; }
.sf-task:hover { background:var(--bg-hover); }
.sf-task span { flex:1; }
.sf-task small { display:block; font-size:12px; color:var(--text-muted); margin-top:3px; }
.sf-empty { padding:28px 20px; display:grid; gap:10px; justify-items:start; color:var(--text-muted); }
.sf-empty strong { color:var(--text-primary); font-weight:600; }
.sf-notice { padding:10px 16px; border-bottom:1px solid var(--border); background:var(--bg-base); color:var(--text-muted); overflow-wrap:anywhere; }
.sf-notice[role=alert] { color:var(--danger); }
.sf-input, .sf-select { min-width:0; max-width:100%; padding:7px 9px; color:var(--text-primary); background:var(--bg-input,var(--bg-panel)); border:1px solid var(--border); border-radius:6px; font:inherit; }
.sf-form { display:grid; gap:14px; max-width:650px; }
.sf-form label { display:grid; gap:5px; }
.sf-form textarea { min-height:100px; resize:vertical; }
.sf-definition { margin:12px 0; }
.sf-definition div { display:grid; grid-template-columns:minmax(90px,1fr) minmax(0,2fr); border-bottom:1px solid var(--border); gap:12px; padding:9px 0; }
.sf-definition dt { color:var(--text-muted); }
.sf-definition dd { margin:0; overflow-wrap:anywhere; user-select:text; }
.sf-code { font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; overflow-wrap:anywhere; margin:12px 0; padding:14px; background:var(--bg-base); border:1px solid var(--border); border-radius:6px; max-height:480px; overflow:auto; user-select:text; }
.sf-inspector { padding:18px; min-width:0; overflow:auto; background:var(--bg-panel); }
.sf-operation-results { min-width:0; margin-top:18px; overflow-wrap:anywhere; }
.sf-result-metrics { display:flex; flex-wrap:wrap; gap:12px 24px; margin:0 0 20px; }
.sf-result-metrics dt { color:var(--text-muted); font-size:12px; }
.sf-result-metrics dd { margin:2px 0 0; font-size:18px; font-weight:600; }
.sf-result-section h4 { margin:20px 0 8px; font-size:13px; }
.sf-result-list { list-style:none; padding:0; margin:0; }
.sf-result-list > li { border:1px solid var(--border); border-radius:6px; padding:12px; margin-bottom:8px; }
.sf-result-heading { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; }
.sf-result-heading strong { flex:1; min-width:100px; font-weight:550; }
.sf-result-list p { margin:6px 0; }
.sf-result-message { font:inherit; white-space:pre-wrap; overflow-wrap:anywhere; margin:8px 0; user-select:text; }
.sf-operation-results summary { cursor:pointer; color:var(--text-muted); }
.sf-operation-results summary:focus-visible { outline:2px solid var(--focus-ring,var(--accent)); outline-offset:2px; }
.sf-result-raw { margin-top:18px; border-top:1px solid var(--border); padding-top:12px; }
.sf-split { display:grid; grid-template-columns:minmax(0,1fr) minmax(240px,32%); min-height:0; flex:1; }
.sf-split > .sf-inspector { border-left:1px solid var(--border); }
.sf-table-wrap { overflow:auto; min-width:0; }
.sf-table { width:100%; border-collapse:collapse; font-size:12px; }
.sf-table td, .sf-table th { text-align:left; padding:9px 12px; border-bottom:1px solid var(--border); }
.sf-table th { color:var(--text-muted); font-weight:500; position:sticky; top:0; background:var(--bg-panel); }
.sf-link { color:var(--accent); background:none; border:0; padding:0; cursor:pointer; font:inherit; text-align:left; }
.sf-footer { display:flex; flex-wrap:wrap; gap:8px; padding:7px 16px; border-top:1px solid var(--border); color:var(--text-muted); font-size:11px; background:var(--bg-base); }
.sf-org-list { display:flex; flex-direction:column; gap:14px; width:100%; max-width:960px; margin-inline:auto; }
.sf-org-list-head, .sf-org-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.sf-org-list-head { justify-content:space-between; }
.sf-org-list-head strong { font-size:14px; font-weight:600; }
.sf-org-list-head small { display:block; color:var(--text-muted); font-size:12px; margin-top:2px; }
.sf-org-count { display:inline-block; margin-left:8px; padding:0 6px; border-radius:5px; background:var(--bg-elevated); color:var(--text-muted); font-size:11px; }
.sf-connection-status { flex-basis:100%; order:1; margin:0; color:var(--text-muted); font-size:12px; }
.sf-org-rows { list-style:none; margin:0; padding:0; }
.sf-org-rows > li { border-bottom:1px solid var(--border); }
.sf-org-row { display:flex; gap:10px; align-items:center; padding:12px; width:100%; background:none; color:var(--text-primary); border:0; text-align:left; cursor:pointer; }
.sf-org-row[aria-pressed=true] { background:var(--bg-elevated); }
.sf-org-row span:first-child { flex:1; min-width:0; overflow-wrap:anywhere; }
.sf-org-row small { display:block; font-size:12px; color:var(--text-muted); }
.sf-login-dialog { width:540px; max-width:calc(100vw - 32px); max-height:calc(100dvh - 32px); margin:auto; padding:0; border:1px solid var(--border); border-radius:16px; color:var(--text-primary); background:var(--bg-panel); box-shadow:0 24px 80px #0004,0 4px 16px #0001; overflow:auto; text-align:left; font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
.sf-login-dialog::backdrop { background:#0b14225c; backdrop-filter:blur(4px); }
.sf-org-login { margin:0; }
.sf-login-heading { position:relative; padding:28px 28px 0; }
.sf-login-mark { width:42px; height:42px; display:grid; place-items:center; color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,transparent); border:1px solid color-mix(in srgb,var(--accent) 15%,transparent); border-radius:12px; margin-bottom:16px; }
.sf-login-mark svg { width:24px; height:24px; }
.sf-login-heading h2 { margin:0; font-size:23px; font-weight:600; letter-spacing:-.6px; line-height:1.3; }
.sf-login-heading p { margin:7px 0 0; color:var(--text-muted); }
.sf-login-close { position:absolute; top:18px; right:18px; width:30px; height:30px; padding:6px; border-radius:8px; }
.sf-login-close:hover { background:var(--bg-hover); }
.sf-login-body { display:grid; gap:20px; padding:24px 28px; }
.sf-login-environments { border:0; padding:0; margin:0; min-width:0; }
.sf-login-environments legend { padding:0; margin-bottom:9px; font-weight:550; font-size:12px; }
.sf-login-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.sf-login-option { position:relative; display:block; cursor:pointer; }
.sf-login-option input { position:absolute; opacity:0; width:1px; height:1px; }
.sf-login-option > span { display:block; height:100%; border:1px solid var(--border); border-radius:9px; padding:12px 10px; background:var(--bg-panel); transition:background .15s,border-color .15s; }
.sf-login-option strong { display:block; font-size:13px; font-weight:550; }
.sf-login-option small { display:block; color:var(--text-muted); font-size:10px; margin-top:4px; white-space:nowrap; }
.sf-login-option:hover > span { background:var(--bg-hover); }
.sf-login-option input:checked + span { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); background:color-mix(in srgb,var(--accent) 6%,var(--bg-panel)); }
.sf-login-option input:checked + span strong { color:var(--accent); }
.sf-login-option input:focus-visible + span { outline:2px solid var(--focus-ring,var(--accent)); outline-offset:3px; }
.sf-login-environments:disabled .sf-login-option { cursor:default; opacity:.6; }
.sf-login-field { display:grid; gap:7px; font-size:12px; font-weight:550; }
.sf-login-optional { font-size:11px; font-weight:400; margin-left:5px; color:var(--text-muted); }
.sf-login-field .sf-input { width:100%; height:38px; padding:8px 11px; border-radius:7px; font-weight:400; }
.sf-login-field .sf-input:focus { outline:2px solid var(--focus-ring,var(--accent)); outline-offset:2px; }
.sf-login-field small { color:var(--text-muted); font-size:11px; font-weight:400; }
.sf-login-destination { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-muted); }
.sf-login-destination svg { width:15px; height:15px; flex-shrink:0; }
.sf-login-footer { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; padding:18px 24px; border-top:1px solid var(--border); background:var(--bg-base); }
.sf-login-footer p { margin:0; color:var(--text-muted); font-size:10px; line-height:1.6; }
.sf-login-buttons { display:flex; gap:8px; align-items:center; }
.sf-login-buttons .sf-btn { padding:8px 11px; border-radius:7px; font-size:12px; }
.sf-login-buttons .primary { font-weight:550; }
.sf-login-buttons .primary:hover:not(:disabled) { filter:brightness(1.08); }
.sf-login-error { margin:0; padding:10px 12px; border:1px solid color-mix(in srgb,var(--danger) 25%,transparent); border-radius:8px; background:color-mix(in srgb,var(--danger) 6%,transparent); color:var(--danger); font-size:12px; overflow-wrap:anywhere; }
.sf-login-waiting { display:flex; align-items:flex-start; gap:10px; padding:12px; background:color-mix(in srgb,var(--accent) 6%,transparent); border-radius:8px; }
.sf-login-waiting strong { display:block; font-size:12px; font-weight:550; }
.sf-login-waiting div > span { display:block; font-size:11px; color:var(--text-muted); margin-top:4px; }
.sf-login-spinner { width:15px; height:15px; flex-shrink:0; margin-top:2px; border:2px solid color-mix(in srgb,var(--accent) 20%,transparent); border-top-color:var(--accent); border-radius:50%; animation:sf-login-spin .8s linear infinite; }
@keyframes sf-login-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .sf-login-spinner { animation:none; } .sf-login-option > span { transition:none; } }
@media (max-width:560px) { .sf-login-heading { padding:22px 20px 0; } .sf-login-body { padding:20px; } .sf-login-footer { padding:16px 20px; } .sf-login-footer p { flex:1 1 100%; } .sf-login-buttons { width:100%; justify-content:flex-end; } .sf-login-option > span { padding:10px 7px; } .sf-login-option small { white-space:normal; } }
.sf-org-picker { max-width:260px; color:var(--text-primary); background:var(--bg-input); border:1px solid var(--border); border-radius:6px; padding:5px 8px; }
.sf-dialog-backdrop { position:absolute; inset:0; z-index:5; background:color-mix(in srgb,var(--bg-base) 75%,transparent); display:grid; place-items:center; padding:16px; }
.sf-dialog { width:min(100%,420px); background:var(--bg-panel); border:1px solid var(--border); border-radius:10px; padding:20px; box-shadow:0 16px 48px color-mix(in srgb,var(--text-primary) 10%,transparent); }
.sf-dialog h3 { margin-top:0; }
@container sf (max-width:700px) { .sf-split { display:flex; flex-direction:column; } .sf-split > .sf-inspector { border-left:0; border-top:1px solid var(--border); } .sf-content { padding:18px; } }
@container sf (max-width:460px) { .sf-tasks { grid-template-columns:1fr; } .sf-header,.sf-toolbar { padding:10px 12px; gap:8px; } .sf-content h2 { font-size:19px; } .sf-org-picker { max-width:100%; } .sf-tab { padding:10px 6px; } }
` + WORKBENCH_STYLES;
