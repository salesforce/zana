/** All Salesforce surfaces inherit host appearance, including compact plugin panels. */
export const SALESFORCE_STYLES = `
.sf-surface { --sf-bg:var(--bg-panel); --sf-fg:var(--text-primary); color:var(--sf-fg); background:var(--sf-bg); font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; container:sf / inline-size; }
.sf-surface *, .sf-soql * { box-sizing:border-box; }
.sf-surface button, .sf-surface input, .sf-surface select, .sf-surface textarea { font:inherit; }
.sf-surface button:focus-visible, .sf-surface a:focus-visible, .sf-soql button:focus-visible { outline:2px solid var(--focus-ring,var(--accent)); outline-offset:2px; }
.sf-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; color:var(--text-primary); border:1px solid var(--border); background:var(--bg-panel); border-radius:6px; padding:6px 10px; cursor:pointer; white-space:nowrap; }
.sf-btn:hover { background:var(--bg-hover); }
.sf-btn.primary { background:var(--accent); border-color:transparent; color:var(--text-bright); }
.sf-btn:disabled { opacity:.5; cursor:default; }
.sf-btn.quiet { border-color:transparent; background:transparent; color:var(--text-muted); }
.sf-btn svg, .sf-header svg, .sf-empty svg, .sf-task svg { width:16px; height:16px; flex-shrink:0; }
.sf-header, .sf-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:12px 18px; border-bottom:1px solid var(--border); flex-shrink:0; }
.sf-header strong, .sf-toolbar strong { font-weight:600; }
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
.sf-org-list { display:flex; flex-direction:column; gap:12px; }
.sf-org-list-head, .sf-org-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.sf-org-list-head { justify-content:space-between; }
.sf-org-rows { list-style:none; margin:0; padding:0; }
.sf-org-rows > li { border-bottom:1px solid var(--border); }
.sf-org-row { display:flex; gap:10px; align-items:center; padding:12px; width:100%; background:none; color:var(--text-primary); border:0; text-align:left; cursor:pointer; }
.sf-org-row[aria-pressed=true] { background:var(--bg-elevated); }
.sf-org-row span:first-child { flex:1; min-width:0; overflow-wrap:anywhere; }
.sf-org-row small { display:block; font-size:12px; color:var(--text-muted); }
.sf-org-login { padding:16px; border:1px solid var(--border); border-radius:8px; }
.sf-org-picker { max-width:260px; color:var(--text-primary); background:var(--bg-input); border:1px solid var(--border); border-radius:6px; padding:5px 8px; }
.sf-dialog-backdrop { position:absolute; inset:0; z-index:5; background:color-mix(in srgb,var(--bg-base) 75%,transparent); display:grid; place-items:center; padding:16px; }
.sf-dialog { width:min(100%,420px); background:var(--bg-panel); border:1px solid var(--border); border-radius:10px; padding:20px; box-shadow:0 16px 48px color-mix(in srgb,var(--text-primary) 10%,transparent); }
.sf-dialog h3 { margin-top:0; }
@container sf (max-width:700px) { .sf-split { display:flex; flex-direction:column; } .sf-split > .sf-inspector { border-left:0; border-top:1px solid var(--border); } .sf-content { padding:18px; } }
@container sf (max-width:460px) { .sf-tasks { grid-template-columns:1fr; } .sf-header,.sf-toolbar { padding:10px 12px; gap:8px; } .sf-content h2 { font-size:19px; } .sf-org-picker { max-width:100%; } .sf-tab { padding:10px 6px; } }
`;
