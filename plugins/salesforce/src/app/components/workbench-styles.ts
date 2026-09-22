export const WORKBENCH_STYLES = `
.sf-workspace { display:grid; grid-template-columns:minmax(300px,360px) minmax(0,1fr); flex:1; min-height:0; min-width:0; overflow:hidden; }
.sf-workspace-config { overflow:auto; min-height:0; min-width:0; background:var(--bg-base); border-right:1px solid var(--border); }
.sf-workspace-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:20px; flex-shrink:0; }
.sf-workspace-heading h2 { font-size:17px; font-weight:600; line-height:1.3; letter-spacing:-.3px; margin:3px 0 0; overflow-wrap:anywhere; }
.sf-eyebrow { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted); }
.sf-target-strip { margin:0 20px 8px; padding:9px 12px; display:flex; gap:10px; align-items:center; justify-content:space-between; border:1px solid var(--border); border-radius:7px; background:var(--bg-panel); font-size:12px; overflow-wrap:anywhere; }
.sf-target-strip > span { color:var(--text-muted); flex-shrink:0; }
.sf-workspace-section { padding:18px 20px; border-bottom:1px solid var(--border); }
.sf-workspace-section h3 { display:flex; gap:8px; align-items:center; margin:0 0 14px; font-size:13px; font-weight:600; }
.sf-step { display:inline-grid; place-items:center; width:21px; height:21px; border-radius:50%; font-size:11px; color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,var(--bg-panel)); }
.sf-section-hint { font-size:12px; line-height:1.6; color:var(--text-muted); margin:10px 0; }
.sf-control-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.sf-control-row > .sf-select { flex:1; }
.sf-field { display:grid; gap:6px; font-size:12px; font-weight:500; min-width:0; }
.sf-field .sf-input { width:100%; font-weight:400; }
.sf-field textarea { min-height:100px; resize:vertical; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.sf-metadata-browser { margin-top:12px; border:1px solid var(--border); background:var(--bg-panel); border-radius:8px; overflow:hidden; }
.sf-metadata-browser > .sf-input { width:100%; border:0; border-radius:0; border-bottom:1px solid var(--border); padding:10px 12px; }
.sf-metadata-list { max-height:200px; overflow:auto; padding:4px; }
.sf-metadata-list > p { padding:8px; }
.sf-metadata-option { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:4px; cursor:pointer; overflow-wrap:anywhere; }
.sf-metadata-option:hover { background:var(--bg-hover); }
.sf-metadata-option:has(input:checked) { background:color-mix(in srgb,var(--accent) 8%,transparent); }
.sf-metadata-option input { accent-color:var(--accent); flex-shrink:0; }
.sf-list-caption { margin:0; padding:7px 12px; font-size:11px; color:var(--text-muted); border-top:1px solid var(--border); }
.sf-selection-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:14px 0 8px; font-size:12px; }
.sf-selection-chips { display:flex; flex-wrap:wrap; gap:5px; max-height:130px; overflow:auto; }
.sf-selection-chip { display:flex; align-items:center; gap:4px; max-width:100%; padding:3px 5px 3px 8px; border:1px solid color-mix(in srgb,var(--accent) 25%,var(--border)); border-radius:5px; font-size:11px; background:var(--bg-panel); }
.sf-selection-chip > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-selection-chip button { border:0; background:transparent; color:var(--text-muted); cursor:pointer; padding:0 3px; font-size:16px; }
.sf-inline-details { margin-top:14px; font-size:12px; }
.sf-inline-details summary { color:var(--text-muted); cursor:pointer; }
.sf-inline-details[open] > summary { margin-bottom:10px; }
.sf-review-step > .primary { width:100%; white-space:normal; }
.sf-activity { display:flex; flex-direction:column; height:100%; min-height:300px; min-width:0; overflow:hidden; background:var(--bg-panel); container:sf-activity / inline-size; }
.sf-activity > .sf-workspace-heading { border-bottom:1px solid var(--border); }
.sf-activity-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 16px; border-bottom:1px solid var(--border); }
.sf-activity-tools .sf-input { flex:1; width:100%; }
.sf-activity-body { display:grid; grid-template-columns:230px minmax(0,1fr); flex:1; min-height:0; }
.sf-activity-list { overflow:auto; border-right:1px solid var(--border); background:var(--bg-base); padding:8px; }
.sf-activity-item { display:flex; flex-direction:column; gap:6px; width:100%; min-width:0; padding:12px; margin:0 0 4px; border:1px solid transparent; border-radius:7px; text-align:left; background:transparent; color:var(--text-primary); cursor:pointer; }
.sf-activity-item:hover { background:var(--bg-hover); }
.sf-activity-item[aria-pressed=true] { background:var(--bg-panel); border-color:color-mix(in srgb,var(--accent) 50%,var(--border)); box-shadow:inset 3px 0 0 var(--accent); }
.sf-item-top { display:flex; align-items:center; gap:8px; justify-content:space-between; min-width:0; }
.sf-item-top strong { font-size:12px; font-weight:600; overflow-wrap:anywhere; }
.sf-item-state { display:inline-flex; align-items:center; gap:5px; font-size:10px; color:var(--text-muted); white-space:nowrap; }
.sf-item-title { color:var(--text-muted); font-size:12px; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.sf-item-meta { display:flex; justify-content:space-between; gap:8px; color:var(--text-muted); font-size:10px; flex-wrap:wrap; }
.sf-status-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; background:var(--text-muted); }
.sf-status-dot[data-state=failed] { background:var(--danger); }
.sf-status-dot[data-state=succeeded] { background:var(--success); }
.sf-status-dot[data-state=running], .sf-status-dot[data-state=submitted] { background:var(--accent); }
.sf-activity-detail { min-width:0; min-height:0; overflow:auto; }
.sf-run-summary { padding:20px; overflow:visible; }
.sf-run-heading { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
.sf-run-summary h3 { font-size:16px; letter-spacing:-.2px; margin:0 0 10px; overflow-wrap:anywhere; }
.sf-run-summary .sf-toolbar { padding:10px 0; }
.sf-run-summary > p { margin:12px 0; }
.sf-run-summary .sf-badge { text-transform:capitalize; }
.sf-apex-workspace { grid-template-columns:minmax(250px,310px) minmax(0,1fr); }
.sf-apex-content { display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; overflow:hidden; }
.sf-apex-form { display:grid; gap:14px; padding:0 20px 20px; }
.sf-apex-form textarea { min-height:240px; font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; }
.sf-logs-workspace { display:grid; grid-template-columns:290px minmax(0,1fr); min-height:0; min-width:0; flex:1; overflow:hidden; }
.sf-log-list-pane { display:flex; flex-direction:column; min-width:0; min-height:0; border-right:1px solid var(--border); background:var(--bg-base); }
.sf-log-list-pane .sf-workspace-heading { padding:16px; }
.sf-log-list { flex:1; min-height:0; overflow:auto; padding:8px; }
.sf-log-reader { min-width:0; min-height:0; display:flex; flex-direction:column; }
.sf-log-find { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:0 20px 12px; }
.sf-log-find input { flex:1; }
.sf-log-code { margin:0; padding:16px 20px; border:0; border-block:1px solid var(--border); border-radius:0; flex:1; min-height:150px; max-height:none; }
.sf-log-code mark { background:color-mix(in srgb,var(--accent-gold,#e3ac37) 25%,transparent); color:inherit; }
.sf-log-code mark[data-current=true] { outline:1px solid var(--accent-gold,#e3ac37); }
.sf-log-footer { padding:12px 20px; }
.sf-log-footer p { margin:0 0 8px; }
@container sf-activity (max-width:640px) { .sf-activity-body { grid-template-columns:1fr; grid-template-rows:minmax(85px,150px) minmax(220px,1fr); } .sf-activity-list { border-right:0; border-bottom:1px solid var(--border); } .sf-activity-item { padding:9px 12px; } .sf-activity-item .sf-item-title { -webkit-line-clamp:1; } }
@container sf (max-width:820px) { .sf-workspace { display:flex; flex-direction:column; overflow:auto; } .sf-workspace-config { overflow:visible; border-right:0; border-bottom:1px solid var(--border); flex-shrink:0; } .sf-workspace > .sf-activity { min-height:500px; flex-shrink:0; } .sf-workspace-section { padding:14px 18px; } .sf-logs-workspace { grid-template-columns:1fr; grid-template-rows:220px minmax(250px,1fr); overflow:auto; } .sf-log-list-pane { border-right:0; border-bottom:1px solid var(--border); } .sf-workspace-heading { padding:16px; } }
@container sf (max-width:460px) { .sf-control-row > .sf-btn { white-space:normal; } .sf-workspace-section { padding:14px; } .sf-workspace-heading h2 { font-size:16px; } .sf-target-strip { margin-inline:14px; } .sf-apex-form { padding:0 14px 14px; } .sf-activity-tools { padding:10px 12px; } .sf-run-summary { padding:16px; } .sf-log-find { padding-inline:14px; } }
`;
