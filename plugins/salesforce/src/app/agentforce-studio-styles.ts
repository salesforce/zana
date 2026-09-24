export const AGENTFORCE_STUDIO_STYLES = `
.sf-as { container-type: inline-size; background:var(--bg-panel); --af-accent:var(--accent,#8b7cf8); --af-soft:color-mix(in srgb,var(--af-accent) 10%,transparent); --af-line:var(--border,#303139); --af-muted:var(--text-muted,#9696a5); --af-text:var(--text-primary,#eeeeF4); --af-surface:var(--bg-panel,#1b1b21); --af-raised:var(--bg-elevated,var(--bg-panel,#222229)); color:var(--af-text); }
.sf-as .sf-as-header { height:auto; min-height:44px; padding:8px 14px; gap:12px; flex-wrap:wrap; background:var(--af-surface); }
.af-document-bar { display:flex; align-items:center; flex-shrink:0; gap:8px; padding:4px 10px; border-bottom:1px solid var(--af-line); height:44px; box-sizing:border-box; }
.af-document-bar .sf-as-crumb { font-size:12px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-document-bar .sf-as-save,.af-document-bar .af-draft-state { flex-shrink:0; white-space:nowrap; }
.af-document-bar .sf-org-picker { min-width:0; max-width:170px; }
.sf-as .sf-as-explorer-search { margin-top:10px; }
.af-draft-state { color:var(--af-muted); font-size:10px; display:flex; gap:5px; align-items:center; }.af-draft-state i { display:block; width:5px; height:5px; border-radius:50%; background:var(--af-accent); }
.sf-as .sf-as-explorer { width:100%; flex:1; min-height:0; box-sizing:border-box; border:0; background:color-mix(in srgb,var(--af-surface) 94%,var(--af-muted)); }.sf-as .sf-as-explorer.is-collapsed { width:34px; }.sf-as .sf-as-explorer-head { padding:14px 10px 10px; }.sf-as .sf-as-tree-btn { padding-top:7px; padding-bottom:7px; }.sf-as .sf-as-section-label { padding:10px 6px 6px; }.sf-as .sf-as-explorer-search { background:var(--af-surface); }
.sf-as .sf-as-sunken { background:var(--af-surface); }.sf-as .sf-as-save { border-radius:6px; }.sf-as .sf-as-save.is-dirty { background:var(--af-accent); color:var(--text-on-accent,#fff); }.sf-as .sf-as-stage { overflow:hidden; }
.af-lab { width:410px; max-width:48%; min-width:300px; min-height:0; display:flex; flex-direction:column; border-left:1px solid var(--af-line); background:var(--af-surface); font-size:12px; }
.af-lab[hidden] { display:none; }
.af-workspace { display:flex; flex:1; min-width:0; min-height:0; }
.af-workspace[data-panel-open=true]>.sf-as-stage { flex:var(--af-editor-ratio) 1 0; }
.af-workspace[data-panel-open=true]>.af-tools { flex:calc(1 - var(--af-editor-ratio)) 1 0; width:auto; max-width:none; min-width:0; border-left:0; }
/* Match ZCC's split-divider: 1px rule with an 11px invisible hit area. */
.af-workspace-divider { flex:0 0 1px; cursor:col-resize; touch-action:none; position:relative; z-index:25; background:var(--af-line); }
.af-workspace-divider::after { content:''; position:absolute; top:0; bottom:0; left:-5px; width:11px; touch-action:none; }
.af-workspace-divider:hover,.af-workspace-divider:focus-visible,.af-workspace[data-resizing=true]>.af-workspace-divider { background:var(--af-accent); }
.af-workspace-divider:focus-visible { outline:2px solid var(--af-accent); outline-offset:1px; }
.af-workspace[data-resizing=true] { cursor:col-resize; user-select:none; }.af-workspace[data-resizing=true] iframe { pointer-events:none; }
.af-lab-heading { display:flex; align-items:center; gap:10px; padding:18px; border-bottom:1px solid var(--af-line); }.af-lab h2 { font-size:14px; letter-spacing:-.02em; margin:0; }.af-lab-heading p { margin:4px 0 0; color:var(--af-muted); font-size:11px; }
.af-lab-scroll { flex:1; min-height:0; overflow:auto; padding:16px; scrollbar-width:thin; }.af-engine { display:grid; grid-template-columns:1fr 1fr; gap:8px; }.af-engine button { text-align:left; border:1px solid var(--af-line); background:transparent; border-radius:9px; padding:10px; color:var(--af-text); cursor:pointer; }.af-engine button[aria-pressed=true] { border-color:var(--af-accent); background:var(--af-soft); }.af-engine strong { display:block; font-size:11px; font-weight:600; }.af-engine span { display:block; font-size:10px; line-height:1.5; color:var(--af-muted); margin-top:5px; }
.af-caption { font-size:11px; line-height:1.6; color:var(--af-muted); margin:10px 0 16px; }.af-scenario { padding:0; margin:0; border:0; min-width:0; }.af-scenario legend { font-size:9px; font-weight:650; letter-spacing:.1em; color:var(--af-muted); margin-bottom:10px; }.af-presets { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:14px; }.af-presets button { border:1px solid var(--af-line); background:transparent; color:var(--af-muted); border-radius:20px; font-size:10px; padding:5px 9px; cursor:pointer; }.af-presets button:hover { color:var(--af-text); background:var(--af-soft); }
.af-scenario-details { margin:12px 0; border-top:1px solid var(--af-line); border-bottom:1px solid var(--af-line); }.af-scenario-details>summary { cursor:pointer; font-size:11px; font-weight:550; padding:12px 0; }.af-scenario-details>summary>span { float:right; color:var(--af-muted); font-size:10px; font-weight:400; }.af-engine button[aria-pressed=true]:disabled { opacity:1; }.af-engine button:disabled { opacity:.65; }
.af-lab label { display:flex; flex-direction:column; gap:6px; font-size:11px; font-weight:500; margin-bottom:12px; }.af-lab input,.af-lab textarea,.af-lab select { box-sizing:border-box; width:100%; background:color-mix(in srgb,var(--af-surface) 94%,var(--af-muted)); color:var(--af-text); font:inherit; font-size:12px; line-height:1.55; border:1px solid var(--af-line); border-radius:6px; padding:8px 10px; }.af-lab textarea { resize:vertical; min-height:52px; }.af-lab .af-turn-limit { flex-direction:row; align-items:center; justify-content:space-between; }.af-turn-limit select { width:100px; }.af-model { margin:6px 0 14px; color:var(--af-muted); font-size:11px; }.af-model summary { cursor:pointer; padding:3px 0 8px; }.af-model p { line-height:1.6; }.af-run-actions { display:flex; gap:8px; margin:14px 0 18px; }
.af-primary,.af-secondary { font:inherit; font-size:12px; font-weight:600; border:1px solid var(--af-line); border-radius:7px; padding:9px 12px; cursor:pointer; }.af-primary { flex:1; display:flex; justify-content:space-between; gap:8px; color:var(--af-text); border-color:color-mix(in srgb,var(--af-accent) 60%,var(--af-line)); background:var(--af-soft); }.af-secondary { background:transparent; color:var(--af-muted); }.af-lab button:disabled { opacity:.45; cursor:default; }.sf-as button:focus-visible,.sf-as input:focus-visible,.sf-as textarea:focus-visible,.sf-as select:focus-visible,.sf-as summary:focus-visible { outline:2px solid var(--af-accent); outline-offset:3px; }
.af-conversation-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 0; border-top:1px solid var(--af-line); }.af-status { color:var(--af-muted); font-size:10px; }.af-status.is-busy { color:var(--af-accent); }.af-text-button { padding:0; font:inherit; font-size:10px; color:var(--af-accent); background:none; border:0; cursor:pointer; }.af-run-meta { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px; }.af-run-meta span { border:1px solid var(--af-line); border-radius:4px; padding:3px 5px; font-size:9px; color:var(--af-muted); }
.af-transcript { display:flex; flex-direction:column; gap:16px; }.af-welcome { display:flex; align-items:center; flex-direction:column; padding:30px 12px; text-align:center; }.af-welcome-orbit { display:grid; place-items:center; width:60px; height:60px; border-radius:20px; border:1px solid color-mix(in srgb,var(--af-accent) 25%,transparent); background:radial-gradient(circle at top,var(--af-soft),transparent); color:var(--af-accent); box-shadow:0 0 0 8px color-mix(in srgb,var(--af-accent) 3%,transparent); margin-bottom:16px; }.af-welcome h3 { font-size:16px; font-weight:550; letter-spacing:-.025em; line-height:1.45; max-width:235px; margin:8px 0; }.af-welcome p { color:var(--af-muted); line-height:1.7; max-width:260px; margin:0 0 18px; font-size:12px; }.af-welcome-tag { font-family:ui-monospace,monospace; font-size:10px; color:var(--af-muted); border:1px solid var(--af-line); border-radius:5px; padding:4px 7px; overflow-wrap:anywhere; }
.af-message { max-width:94%; }.af-message.is-user { align-self:flex-end; }.af-message.is-agent { align-self:flex-start; width:94%; }.af-message-meta { display:flex; align-items:center; gap:8px; font-size:10px; color:var(--af-muted); padding:0 2px 6px; }.af-message-meta strong { font-weight:500; }.af-message-text { border:1px solid var(--af-line); border-radius:3px 12px 12px; padding:11px 13px; line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; }.is-user .af-message-text { border-radius:12px 3px 12px 12px; background:var(--af-soft); border-color:transparent; }.af-plan { font-size:10px; color:var(--af-muted); padding:7px 2px; overflow-wrap:anywhere; }.af-plan summary { cursor:pointer; }.af-composer { margin:12px; display:flex; align-items:center; gap:6px; border:1px solid var(--af-line); background:var(--af-raised); border-radius:10px; padding:6px; }.af-composer input { min-width:0; border:0; background:transparent; }.af-composer button { border:0; border-radius:6px; background:var(--af-soft); color:var(--af-accent); font-size:19px; width:32px; height:32px; flex-shrink:0; cursor:pointer; }
.af-notice,.af-error { border:1px solid var(--af-line); padding:10px; border-radius:7px; font-size:11px; line-height:1.6; margin-bottom:12px; }.af-error { color:var(--danger,#e88686); }.af-notice { color:var(--af-muted); }.af-verdict { margin-top:18px; padding:14px; border:1px solid var(--af-line); border-radius:10px; background:var(--af-soft); line-height:1.6; }.af-verdict>div { display:flex; justify-content:space-between; gap:10px; }.af-verdict>div span,.af-verdict small { font-size:9px; color:var(--af-muted); }.af-verdict ul { padding-left:16px; }.af-verdict.is-pass strong { color:var(--success,#58a986); }.af-verdict.is-fail strong { color:var(--danger,#e88686); }
@media (prefers-reduced-motion:reduce) { .af-lab * { scroll-behavior:auto!important; } }

.af-workspace-label { color:var(--af-muted); font-size:11px; padding-left:12px; border-left:1px solid var(--af-line); }
.af-brand-mark,.af-icon { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; color:var(--af-accent); background:var(--af-soft); flex-shrink:0; }
.af-tools { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--af-surface); overflow:hidden; }
.af-tools[hidden],.af-tool-content[hidden],.af-tool-frame[hidden] { display:none; }
/* Tool chrome uses the host's thread-secondary-* classes, shared with ZCC panels. */
.af-tools>.thread-secondary-chrome { height:44px; min-height:44px; }
.af-tool-content { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; overflow:hidden; }
.af-tool-content>.af-lab { width:100%; max-width:none; min-width:0; flex:1; border:0; }
.af-tool-frame { flex:1; min-height:0; width:100%; border:0; }
.af-tool-picker { overflow:auto; padding:24px 18px; }
.af-tool-picker h2,.af-actions-list h2 { font-size:14px; font-weight:600; margin:0 0 6px; }
.af-tool-picker p,.af-actions-list p { font-size:12px; line-height:1.6; color:var(--af-muted); margin:0 0 20px; }
.af-tool-picker>div { display:flex; flex-direction:column; gap:5px; }
.af-tool-picker button { display:flex; align-items:center; gap:12px; padding:12px 10px; width:100%; border:1px solid transparent; border-radius:7px; text-align:left; font:inherit; background:transparent; color:var(--af-text); cursor:pointer; }
.af-tool-picker button:hover { border-color:var(--af-line); background:var(--af-soft); }
.af-tool-picker strong { display:block; font-size:12px; font-weight:550; }
.af-tool-picker small { display:block; margin-top:4px; font-size:11px; color:var(--af-muted); line-height:1.5; }
.af-tool-icon { width:28px; flex-shrink:0; color:var(--af-muted); font-size:22px; text-align:center; }
.af-tool-open { margin-left:auto; font-size:10px; color:var(--af-muted); }
.af-actions-list { overflow:auto; padding:18px 12px; }
.af-org-agents { overflow:auto; padding:14px 12px; font-size:12px; }
.af-org-agents>header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.af-org-agents>header strong { font-size:13px; font-weight:600; }.af-org-agents>header small { display:block; color:var(--af-muted); margin-top:3px; font-size:11px; }
.af-agent-search { display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--af-line); border-radius:7px; color:var(--af-muted); background:var(--bg-input,transparent); }
.af-agent-search input { width:100%; min-width:0; background:none; border:0; color:var(--af-text); font:inherit; }
.af-agent-caption { color:var(--af-muted); font-size:11px; line-height:1.5; margin:10px 0 14px; }
.af-agent-list { display:grid; gap:9px; }.af-agent-card { border:1px solid var(--af-line); border-radius:9px; padding:12px; background:color-mix(in srgb,var(--af-raised) 35%,transparent); }
.af-agent-name { display:flex; gap:8px; align-items:center; }.af-agent-name svg { color:var(--af-accent); flex-shrink:0; }.af-agent-name strong { font-weight:550; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-agent-api-name { display:block; margin:5px 0 12px; font-size:10px; color:var(--af-muted); overflow-wrap:anywhere; }
.af-agent-card-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }.af-agent-card-actions select { flex:1; min-width:100px; padding:6px; border:1px solid var(--af-line); border-radius:6px; background:var(--af-surface); color:var(--af-text); font:inherit; font-size:11px; }.af-agent-card-actions button { display:flex; gap:6px; align-items:center; padding:7px 9px; font-size:11px; color:var(--af-text); }
.af-agent-card-actions button:hover:not(:disabled) { background:var(--af-soft); border-color:var(--af-accent); }.af-agent-card-actions button:disabled { opacity:.5; cursor:default; }
.af-agent-empty { display:flex; align-items:center; flex-direction:column; text-align:center; padding:30px 12px; gap:12px; color:var(--af-muted); }.af-agent-empty strong { color:var(--af-text); font-weight:550; }.af-agent-empty p { line-height:1.6; margin:0; }
/* Stack on narrow plugin slots; the editor remains usable above its tools. */
@container (max-width:620px) {
  .af-workspace[data-panel-open=true] { flex-direction:column; }
  .af-workspace[data-panel-open=true]>.sf-as-stage { flex:1 1 50%; min-height:140px; }
  .af-workspace[data-panel-open=true]>.af-tools { flex:1 1 50%; border-top:1px solid var(--af-line); }
  .af-workspace-divider { display:none; }
  .af-document-bar { padding:6px 10px; gap:6px; }
  .af-document-bar .sf-as-crumb { flex-basis:50%; }
}
`;
