import { STUDIO_TOKENS } from './studio/studio-tokens.js';
export const AGENTFORCE_STUDIO_STYLES = `
${STUDIO_TOKENS}.sf-as { container-type: inline-size; background:var(--sf-surface); color:var(--sf-text); }
.sf-as .sf-as-header { height:auto; min-height:44px; padding:8px 14px; gap:12px; flex-wrap:wrap; background:var(--sf-surface); }
.af-document-bar { display:flex; align-items:center; flex-wrap:wrap; flex-shrink:0; gap:8px 16px; padding:9px 12px; border-bottom:1px solid var(--sf-border); min-height:58px; box-sizing:border-box; background:var(--sf-surface); }
.af-document-identity { display:flex; align-items:center; gap:10px; flex:1 1 220px; min-width:0; }
.af-document-bar .af-document-icon { flex-shrink:0; width:32px; height:32px; border-radius:8px; background:var(--sf-soft); color:var(--sf-accent); }
.af-document-file { flex:1; min-width:0; }
.af-document-name { font-size:12px; font-weight:600; line-height:18px; color:var(--sf-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-document-details { display:flex; align-items:center; gap:8px; min-width:0; margin-top:2px; line-height:14px; font-size:10px; color:var(--sf-muted); }
.af-document-folder { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-document-actions { display:flex; align-items:center; justify-content:flex-end; flex:0 1 auto; max-width:100%; min-width:0; gap:6px; flex-wrap:wrap; margin-left:auto; }
.af-document-bar .sf-as-save { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:30px; padding:0 10px; color:var(--sf-text); flex-shrink:0; white-space:nowrap; }
.af-document-bar .sf-as-save[hidden] { display:none; }
.af-document-bar .sf-as-save:hover:not(:disabled):not(.is-dirty) { background:var(--sf-soft); }
.af-document-org { display:flex; align-items:center; flex:0 1 220px; min-width:0; max-width:220px; height:30px; box-sizing:border-box; gap:6px; padding:0 7px; border:1px solid var(--sf-border); border-radius:6px; color:var(--sf-muted); background:var(--sf-elevated); }
.af-document-org>svg { flex-shrink:0; }
.af-document-org .sf-org-picker { flex:1; width:100%; min-width:0; height:28px; padding:0; border:0; font-size:11px; color:var(--sf-text); background:transparent; }
.af-document-org:focus-within { outline:2px solid var(--sf-accent); outline-offset:2px; }
.af-document-org .sf-org-picker:focus-visible { outline:0; }
.sf-as .sf-as-explorer-search { margin-top:10px; }
.af-draft-state { color:var(--sf-muted); font-size:10px; display:inline-flex; gap:4px; align-items:center; flex-shrink:0; white-space:nowrap; }.af-draft-state[data-dirty=true] { color:var(--sf-accent); }
.af-document-issues { color:var(--sf-danger); flex-shrink:0; white-space:nowrap; }
.sf-as .sf-as-explorer { width:100%; flex:1; min-height:0; box-sizing:border-box; border:0; background:color-mix(in srgb,var(--sf-surface) 94%,var(--sf-muted)); }.sf-as .sf-as-explorer.is-collapsed { width:34px; }.sf-as .sf-as-explorer-head { padding:14px 10px 10px; }.sf-as .sf-as-tree-btn { padding-top:7px; padding-bottom:7px; }.sf-as .sf-as-section-label { padding:10px 6px 6px; }.sf-as .sf-as-explorer-search { background:var(--sf-surface); }
.sf-as .sf-as-sunken { background:var(--sf-surface); }.sf-as .sf-as-save { border-radius:6px; }.sf-as .sf-as-save.is-dirty { background:var(--sf-accent); color:var(--sf-on-accent); }.sf-as .sf-as-stage { overflow:hidden; }
.af-lab { width:410px; max-width:48%; min-width:300px; min-height:0; display:flex; flex-direction:column; border-left:1px solid var(--sf-border); background:var(--sf-surface); font-size:12px; }
.af-lab[hidden] { display:none; }
.af-workspace { display:flex; flex:1; min-width:0; min-height:0; }
.af-workspace[data-panel-open=true]>.sf-as-stage { flex:var(--af-editor-ratio) 1 0; }
.af-workspace[data-panel-open=true]>.af-tools { flex:calc(1 - var(--af-editor-ratio)) 1 0; width:auto; max-width:none; min-width:0; border-left:0; }
/* Match ZCC's split-divider: 1px rule with an 11px invisible hit area. */
.af-workspace-divider { flex:0 0 1px; cursor:col-resize; touch-action:none; position:relative; z-index:25; background:var(--sf-border); }
.af-workspace-divider::after { content:''; position:absolute; top:0; bottom:0; left:-5px; width:11px; touch-action:none; }
.af-workspace-divider:hover,.af-workspace-divider:focus-visible,.af-workspace[data-resizing=true]>.af-workspace-divider { background:var(--sf-accent); }
.af-workspace-divider:focus-visible { outline:2px solid var(--sf-accent); outline-offset:1px; }
.af-workspace[data-resizing=true] { cursor:col-resize; user-select:none; }.af-workspace[data-resizing=true] iframe { pointer-events:none; }
.af-lab-heading { display:flex; align-items:center; gap:10px; padding:18px; border-bottom:1px solid var(--sf-border); }.af-lab h2 { font-size:14px; letter-spacing:-.02em; margin:0; }.af-lab-heading p { margin:4px 0 0; color:var(--sf-muted); font-size:11px; }
.af-lab-scroll { flex:1; min-height:0; overflow:auto; padding:16px; scrollbar-width:thin; }.af-engine { display:grid; grid-template-columns:1fr 1fr; gap:8px; }.af-engine button { text-align:left; border:1px solid var(--sf-border); background:transparent; border-radius:9px; padding:10px; color:var(--sf-text); cursor:pointer; }.af-engine button[aria-pressed=true] { border-color:var(--sf-accent); background:var(--sf-soft); }.af-engine strong { display:block; font-size:11px; font-weight:600; }.af-engine span { display:block; font-size:10px; line-height:1.5; color:var(--sf-muted); margin-top:5px; }
.af-caption { font-size:11px; line-height:1.6; color:var(--sf-muted); margin:10px 0 16px; }.af-scenario { padding:0; margin:0; border:0; min-width:0; }.af-scenario legend { font-size:9px; font-weight:650; letter-spacing:.1em; color:var(--sf-muted); margin-bottom:10px; }.af-presets { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:14px; }.af-presets button { border:1px solid var(--sf-border); background:transparent; color:var(--sf-muted); border-radius:20px; font-size:10px; padding:5px 9px; cursor:pointer; }.af-presets button:hover { color:var(--sf-text); background:var(--sf-soft); }
.af-scenario-details { margin:12px 0; border-top:1px solid var(--sf-border); border-bottom:1px solid var(--sf-border); }.af-scenario-details>summary { cursor:pointer; font-size:11px; font-weight:550; padding:12px 0; }.af-scenario-details>summary>span { float:right; color:var(--sf-muted); font-size:10px; font-weight:400; }.af-engine button[aria-pressed=true]:disabled { opacity:1; }.af-engine button:disabled { opacity:.65; }
.af-lab label { display:flex; flex-direction:column; gap:6px; font-size:11px; font-weight:500; margin-bottom:12px; }.af-lab input,.af-lab textarea,.af-lab select { box-sizing:border-box; width:100%; background:color-mix(in srgb,var(--sf-surface) 94%,var(--sf-muted)); color:var(--sf-text); font:inherit; font-size:12px; line-height:1.55; border:1px solid var(--sf-border); border-radius:6px; padding:8px 10px; }.af-lab textarea { resize:vertical; min-height:52px; }.af-lab .af-turn-limit { flex-direction:row; align-items:center; justify-content:space-between; }.af-turn-limit select { width:100px; }.af-model { margin:6px 0 14px; color:var(--sf-muted); font-size:11px; }.af-model summary { cursor:pointer; padding:3px 0 8px; }.af-model p { line-height:1.6; }.af-run-actions { display:flex; gap:8px; margin:14px 0 18px; }
.af-primary,.af-secondary { font:inherit; font-size:12px; font-weight:600; border:1px solid var(--sf-border); border-radius:7px; padding:9px 12px; cursor:pointer; }.af-primary { flex:1; display:flex; justify-content:space-between; gap:8px; color:var(--sf-text); border-color:color-mix(in srgb,var(--sf-accent) 60%,var(--sf-border)); background:var(--sf-soft); }.af-secondary { background:transparent; color:var(--sf-muted); }.af-lab button:disabled { opacity:.45; cursor:default; }.sf-as button:focus-visible,.sf-as input:focus-visible,.sf-as textarea:focus-visible,.sf-as select:focus-visible,.sf-as summary:focus-visible { outline:2px solid var(--sf-accent); outline-offset:3px; }
.af-conversation-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 0; border-top:1px solid var(--sf-border); }.af-status { color:var(--sf-muted); font-size:10px; }.af-status.is-busy { color:var(--sf-accent); }.af-text-button { padding:0; font:inherit; font-size:10px; color:var(--sf-accent); background:none; border:0; cursor:pointer; }.af-run-meta { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px; }.af-run-meta span { border:1px solid var(--sf-border); border-radius:4px; padding:3px 5px; font-size:9px; color:var(--sf-muted); }
.af-transcript { display:flex; flex-direction:column; gap:16px; }.af-welcome { display:flex; align-items:center; flex-direction:column; padding:30px 12px; text-align:center; }.af-welcome-orbit { display:grid; place-items:center; width:60px; height:60px; border-radius:20px; border:1px solid color-mix(in srgb,var(--sf-accent) 25%,transparent); background:radial-gradient(circle at top,var(--sf-soft),transparent); color:var(--sf-accent); box-shadow:0 0 0 8px color-mix(in srgb,var(--sf-accent) 3%,transparent); margin-bottom:16px; }.af-welcome h3 { font-size:16px; font-weight:550; letter-spacing:-.025em; line-height:1.45; max-width:235px; margin:8px 0; }.af-welcome p { color:var(--sf-muted); line-height:1.7; max-width:260px; margin:0 0 18px; font-size:12px; }.af-welcome-tag { font-family:ui-monospace,monospace; font-size:10px; color:var(--sf-muted); border:1px solid var(--sf-border); border-radius:5px; padding:4px 7px; overflow-wrap:anywhere; }
.af-message { max-width:94%; }.af-message.is-user { align-self:flex-end; }.af-message.is-agent { align-self:flex-start; width:94%; }.af-message-meta { display:flex; align-items:center; gap:8px; font-size:10px; color:var(--sf-muted); padding:0 2px 6px; }.af-message-meta strong { font-weight:500; }.af-message-text { border:1px solid var(--sf-border); border-radius:3px 12px 12px; padding:11px 13px; line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; }.is-user .af-message-text { border-radius:12px 3px 12px 12px; background:var(--sf-soft); border-color:transparent; }.af-plan { font-size:10px; color:var(--sf-muted); padding:7px 2px; overflow-wrap:anywhere; }.af-plan summary { cursor:pointer; }.af-composer { margin:12px; display:flex; align-items:center; gap:6px; border:1px solid var(--sf-border); background:var(--sf-elevated); border-radius:10px; padding:6px; }.af-composer input { min-width:0; border:0; background:transparent; }.af-composer button { border:0; border-radius:6px; background:var(--sf-soft); color:var(--sf-accent); font-size:19px; width:32px; height:32px; flex-shrink:0; cursor:pointer; }
.af-notice,.af-error { border:1px solid var(--sf-border); padding:10px; border-radius:7px; font-size:11px; line-height:1.6; margin-bottom:12px; }.af-error { color:var(--sf-danger); }.af-notice { color:var(--sf-muted); }.af-verdict { margin-top:18px; padding:14px; border:1px solid var(--sf-border); border-radius:10px; background:var(--sf-soft); line-height:1.6; }.af-verdict>div { display:flex; justify-content:space-between; gap:10px; }.af-verdict>div span,.af-verdict small { font-size:9px; color:var(--sf-muted); }.af-verdict ul { padding-left:16px; }.af-verdict.is-pass strong { color:var(--sf-success); }.af-verdict.is-fail strong { color:var(--sf-danger); }
@media (prefers-reduced-motion:reduce) { .af-lab * { scroll-behavior:auto!important; } }

.af-workspace-label { color:var(--sf-muted); font-size:11px; padding-left:12px; border-left:1px solid var(--sf-border); }
.af-brand-mark,.af-icon { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; color:var(--sf-accent); background:var(--sf-soft); flex-shrink:0; }
.af-tools { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--sf-surface); overflow:hidden; }
.af-tools[hidden],.af-tool-content[hidden],.af-tool-frame[hidden] { display:none; }
/* Tool chrome uses the host's thread-secondary-* classes, shared with ZCC panels. */
.af-tools>.thread-secondary-chrome { height:44px; min-height:44px; }
.af-tool-content { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; overflow:hidden; }
.af-tool-content>.af-lab { width:100%; max-width:none; min-width:0; flex:1; border:0; }
.af-tool-frame { flex:1; min-height:0; width:100%; border:0; }
.af-tool-picker { overflow:auto; padding:24px 18px; }
.af-tool-picker h2,.af-actions-list h2 { font-size:14px; font-weight:600; margin:0 0 6px; }
.af-tool-picker p,.af-actions-list p { font-size:12px; line-height:1.6; color:var(--sf-muted); margin:0 0 20px; }
.af-tool-picker>div { display:flex; flex-direction:column; gap:5px; }
.af-tool-picker button { display:flex; align-items:center; gap:12px; padding:12px 10px; width:100%; border:1px solid transparent; border-radius:7px; text-align:left; font:inherit; background:transparent; color:var(--sf-text); cursor:pointer; }
.af-tool-picker button:hover { border-color:var(--sf-border); background:var(--sf-soft); }
.af-tool-picker strong { display:block; font-size:12px; font-weight:550; }
.af-tool-picker small { display:block; margin-top:4px; font-size:11px; color:var(--sf-muted); line-height:1.5; }
.af-tool-icon { width:28px; flex-shrink:0; color:var(--sf-muted); font-size:22px; text-align:center; }
.af-tool-open { margin-left:auto; font-size:10px; color:var(--sf-muted); }
.af-actions-list { overflow:auto; padding:18px 12px; }
.af-org-agents { overflow:auto; padding:14px 12px; font-size:12px; }
.af-org-agents>header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.af-org-agents>header strong { font-size:13px; font-weight:600; }.af-org-agents>header small { display:block; color:var(--sf-muted); margin-top:3px; font-size:11px; }
.af-agent-search { display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--sf-border); border-radius:7px; color:var(--sf-muted); background:var(--bg-input,transparent); }
.af-agent-search input { width:100%; min-width:0; background:none; border:0; color:var(--sf-text); font:inherit; }
.af-agent-caption { color:var(--sf-muted); font-size:11px; line-height:1.5; margin:10px 0 14px; }
.af-agent-list { display:grid; gap:9px; }.af-agent-card { border:1px solid var(--sf-border); border-radius:9px; padding:12px; background:color-mix(in srgb,var(--sf-elevated) 35%,transparent); }
.af-agent-name { display:flex; gap:8px; align-items:center; }.af-agent-name svg { color:var(--sf-accent); flex-shrink:0; }.af-agent-name strong { font-weight:550; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-agent-api-name { display:block; margin:5px 0 12px; font-size:10px; color:var(--sf-muted); overflow-wrap:anywhere; }
.af-agent-card-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }.af-agent-card-actions select { flex:1; min-width:100px; padding:6px; border:1px solid var(--sf-border); border-radius:6px; background:var(--sf-surface); color:var(--sf-text); font:inherit; font-size:11px; }.af-agent-card-actions button { display:flex; gap:6px; align-items:center; padding:7px 9px; font-size:11px; color:var(--sf-text); }
.af-agent-card-actions button:hover:not(:disabled) { background:var(--sf-soft); border-color:var(--sf-accent); }.af-agent-card-actions button:disabled { opacity:.5; cursor:default; }
.af-agent-empty { display:flex; align-items:center; flex-direction:column; text-align:center; padding:30px 12px; gap:12px; color:var(--sf-muted); }.af-agent-empty strong { color:var(--sf-text); font-weight:550; }.af-agent-empty p { line-height:1.6; margin:0; }
/* Stack on narrow plugin slots; the editor remains usable above its tools. */
@container (max-width:620px) {
  .af-workspace[data-panel-open=true] { flex-direction:column; }
  .af-workspace[data-panel-open=true]>.sf-as-stage { flex:1 1 50%; min-height:140px; }
  .af-workspace[data-panel-open=true]>.af-tools { flex:1 1 50%; border-top:1px solid var(--sf-border); }
  .af-workspace-divider { display:none; }
  .af-document-bar { padding:8px 10px; gap:8px; }
}

/* ---- Studio IDE layout (activity bar, explorer, tabs, bottom panel, compact strip). --sf-* tokens only. ---- */
.sf-studio { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; outline:none; }
.sf-studio-row { display:flex; flex:1; min-width:0; min-height:0; }
.sf-studio-main { display:flex; flex:1; min-width:0; min-height:0; }
.sf-studio-main>.af-workspace { flex:1; }
.sf-studio .sf-strip { display:flex; gap:2px; flex-shrink:0; background:var(--sf-bg); color:var(--sf-muted); }
.sf-strip.is-vertical { flex-direction:column; align-items:center; width:44px; padding:6px 0; border-right:1px solid var(--sf-border); }
.sf-strip.is-horizontal { align-items:stretch; overflow-x:auto; padding:4px 6px; border-bottom:1px solid var(--sf-border); scrollbar-width:none; }
.sf-strip-item { position:relative; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; font-size:12px; cursor:pointer; flex-shrink:0; }
.sf-strip.is-vertical .sf-strip-item { width:36px; height:36px; }
.sf-strip.is-horizontal .sf-strip-item { height:32px; padding:0 10px; }
.sf-strip.is-horizontal.is-icons .sf-strip-item { padding:0; width:34px; }
.sf-strip-item:hover { color:var(--sf-text); background:color-mix(in srgb,var(--sf-accent) 8%,transparent); }
.sf-strip-item.is-active { color:var(--sf-text); background:color-mix(in srgb,var(--sf-accent) 16%,transparent); box-shadow:inset 0 -2px 0 var(--sf-accent); }
.sf-strip.is-vertical .sf-strip-item.is-active { box-shadow:inset 2px 0 0 var(--sf-accent); }
.sf-strip-item:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-strip-icon { display:inline-flex; }
.sf-strip-badge { position:absolute; top:2px; right:2px; min-width:14px; height:14px; padding:0 3px; box-sizing:border-box; border-radius:7px; background:var(--sf-danger); color:var(--sf-bg); font-size:9px; line-height:14px; text-align:center; }
.sf-strip-spacer { flex:1; }
.sf-explorer-col { display:flex; flex-direction:column; width:236px; flex-shrink:0; min-height:0; border-right:1px solid var(--sf-border); background:var(--sf-bg); }
.sf-explorer-col[hidden] { display:none; }
.sf-explorer-col:has(> .sf-as-explorer.is-collapsed) { width:auto; }
.sf-etabs { display:flex; flex-shrink:0; overflow-x:auto; border-bottom:1px solid var(--sf-border); background:var(--sf-bg); scrollbar-width:none; }
.sf-etab { display:inline-flex; align-items:center; flex-shrink:0; border-right:1px solid var(--sf-border); color:var(--sf-muted); }
.sf-etab.is-active { color:var(--sf-text); box-shadow:inset 0 -2px 0 var(--sf-accent); background:color-mix(in srgb,var(--sf-accent) 8%,transparent); }
.sf-etab-label { display:inline-flex; align-items:center; gap:6px; max-width:220px; border:0; background:transparent; color:inherit; font:inherit; font-size:12px; padding:7px 4px 7px 10px; cursor:pointer; }
.sf-etab-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-etab-kind { font-size:9px; letter-spacing:.06em; color:var(--sf-accent); }
.sf-etab-ro, .sf-etab-dirty { font-size:10px; color:var(--sf-muted); }
.sf-etab-dirty { color:var(--sf-accent); }
.sf-etab-problems { min-width:14px; border-radius:7px; background:var(--sf-danger); color:var(--sf-bg); font-size:9px; line-height:14px; text-align:center; padding:0 3px; }
.sf-etab-close { display:inline-flex; border:0; background:transparent; color:var(--sf-muted); cursor:pointer; padding:6px; border-radius:4px; }
.sf-etab-close:hover { color:var(--sf-text); }
.sf-etab-label:focus-visible, .sf-etab-close:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-etab-view { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; }
.sf-kbd { margin-left:6px; padding:0 4px; border:1px solid var(--sf-border); border-radius:4px; font:inherit; font-size:10px; color:var(--sf-muted); }
.sf-bottom { display:flex; flex-direction:column; flex-shrink:0; border-top:1px solid var(--sf-border); background:var(--sf-bg); color:var(--sf-text); }
.sf-bottom-tabs { display:flex; align-items:center; gap:2px; padding:0 6px; }
.sf-bottom-tab { display:inline-flex; align-items:center; gap:6px; border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:11px; padding:6px 10px; cursor:pointer; }
.sf-bottom-tab.is-active { color:var(--sf-text); box-shadow:inset 0 -2px 0 var(--sf-accent); }
.sf-bottom-badge { min-width:14px; border-radius:7px; background:var(--sf-danger); color:var(--sf-bg); font-size:9px; line-height:14px; text-align:center; padding:0 3px; }
.sf-bottom-toggle { margin-left:auto; border:0; background:transparent; color:var(--sf-muted); cursor:pointer; padding:4px; }
.sf-bottom-bar { display:flex; align-items:center; gap:6px; border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:12px; padding:7px 10px; cursor:pointer; text-align:left; }
.sf-bottom-count.is-problem { color:var(--sf-danger); }
.sf-bottom-body { height:220px; overflow:auto; border-top:1px solid var(--sf-border); }
.sf-bottom[data-compact=true] .sf-bottom-body { height:160px; }
.sf-bottom-body[hidden], .sf-bottom-pane[hidden] { display:none; }
.sf-bottom-pane { height:100%; min-height:0; overflow:auto; }
.sf-bottom-tab:focus-visible, .sf-bottom-toggle:focus-visible, .sf-bottom-bar:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-problems-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; font-size:11px; color:var(--sf-muted); border-bottom:1px solid var(--sf-border); }
.sf-problems-head small { color:var(--sf-muted); }
.sf-btn-small { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--sf-border); border-radius:6px; background:transparent; color:var(--sf-text); font:inherit; font-size:11px; padding:3px 8px; cursor:pointer; }
.sf-btn-small:hover:not(:disabled) { border-color:var(--sf-accent); }
.sf-btn-small:disabled { opacity:.5; cursor:default; }
.sf-problems-empty { margin:0; padding:12px 10px; font-size:12px; color:var(--sf-muted); }
.sf-problems-list { list-style:none; margin:0; padding:0; }
.sf-problem { display:grid; grid-template-columns:16px minmax(0,1fr) auto; gap:8px; align-items:baseline; width:100%; border:0; background:transparent; color:var(--sf-text); font:inherit; font-size:12px; text-align:left; padding:5px 10px; cursor:pointer; }
.sf-problem:hover { background:color-mix(in srgb,var(--sf-accent) 8%,transparent); }
.sf-problem:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-problem.is-error .sf-problem-mark { color:var(--sf-danger); } .sf-problem.is-warning .sf-problem-mark { color:var(--sf-warn); } .sf-problem.is-info .sf-problem-mark, .sf-problem.is-hint .sf-problem-mark { color:var(--sf-muted); }
.sf-problem-where { font-size:10px; color:var(--sf-muted); white-space:nowrap; }
.sf-quickopen-backdrop { position:absolute; inset:0; z-index:60; display:flex; justify-content:center; align-items:flex-start; padding-top:48px; background:color-mix(in srgb,var(--sf-bg) 55%,transparent); }
.sf-quickopen { width:min(520px,calc(100% - 24px)); max-height:70%; display:flex; flex-direction:column; border:1px solid var(--sf-border); border-radius:10px; background:var(--sf-bg); color:var(--sf-text); overflow:hidden; }
.sf-quickopen-input { border:0; border-bottom:1px solid var(--sf-border); background:transparent; color:inherit; font:inherit; font-size:13px; padding:10px 12px; }
.sf-quickopen-input:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-quickopen-list { list-style:none; margin:0; padding:4px; overflow:auto; }
.sf-quickopen-list li { display:flex; align-items:baseline; gap:8px; padding:6px 8px; border-radius:6px; font-size:12px; cursor:pointer; }
.sf-quickopen-list li.is-active { background:color-mix(in srgb,var(--sf-accent) 16%,transparent); }
.sf-quickopen-kind { font-size:9px; letter-spacing:.06em; text-transform:uppercase; color:var(--sf-accent); min-width:44px; }
.sf-quickopen-detail { margin-left:auto; font-size:10px; color:var(--sf-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-quickopen-empty { color:var(--sf-muted); cursor:default; }
.sf-as-body { position:relative; }
/* One tool at a time (compact): both children stay mounted so the editor iframe and tool state survive. */
.af-workspace[data-mode=editor]>.af-tools, .af-workspace[data-mode=panel]>.sf-as-stage, .af-workspace:not([data-mode=split])>.af-workspace-divider { display:none; }
.af-workspace[data-mode=editor]>.sf-as-stage, .af-workspace[data-mode=panel][data-panel-open]>.af-tools { flex:1 1 auto; width:100%; max-width:none; min-height:0; border:0; }
/* Studio: the editor tab already names the file, so the document bar stays one row; labels yield to icons before anything wraps. */
.sf-studio .af-action-workspace { container:af-editor / inline-size; }
.sf-studio .af-document-bar { flex-wrap:nowrap; min-height:0; padding:6px 10px; gap:12px; }
.sf-studio .af-document-identity { flex:1 1 0; }
.sf-studio .af-document-actions { flex:0 0 auto; flex-wrap:nowrap; }
.sf-studio .af-document-bar .af-document-icon { width:28px; height:28px; }
@container af-editor (max-width:720px) { .sf-studio .af-document-bar .sf-kbd { display:none; } }
@container af-editor (max-width:620px) { .sf-studio .af-document-bar .sf-as-save { font-size:0; gap:0; width:30px; padding:0; } .sf-studio .af-document-bar .sf-as-save svg { width:14px; height:14px; } }
.sf-studio[data-layout=compact] .af-document-bar { padding:6px 8px; min-height:0; }
.sf-studio[data-layout=compact] .af-document-details { display:none; }
.sf-studio[data-layout=wide] .af-workspace[data-panel-open=true]>.af-tools { border-left:1px solid var(--sf-border); }
@media (prefers-reduced-motion:reduce) { .sf-studio * { transition:none!important; } }

.sf-main-col { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; }
.sf-main-col>.af-workspace { flex:1 1 0; min-height:0; }
.sf-comment-form { display:flex; align-items:flex-end; gap:8px; padding:8px 12px; border-bottom:1px solid var(--sf-border); background:var(--sf-bg); color:var(--sf-text); font-size:12px; }
.sf-comment-form label { display:flex; flex-direction:column; gap:4px; flex:1; }
.sf-comment-form textarea { font:inherit; color:inherit; background:transparent; border:1px solid var(--sf-border); border-radius:6px; padding:4px 6px; resize:vertical; }

.sf-as-no-file { position:absolute; inset:0; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; background:var(--sf-surface); }
.sf-as .sf-as-explorer-top { display:flex; align-items:center; gap:4px; margin-top:10px; }
.sf-as .sf-as-explorer-top .sf-as-explorer-search { margin-top:0; flex:1; min-width:0; }
.sf-as .sf-as-explorer-hide { flex:0 0 auto; color:var(--sf-muted); }
.sf-as .sf-as-section-toggle { display:flex; align-items:center; gap:4px; width:100%; border:0; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; }
.sf-as .sf-as-section-toggle:hover { color:var(--sf-text); }
.sf-as .sf-as-section-toggle:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-as .sf-as-section-count { margin-left:auto; font-weight:400; letter-spacing:0; color:var(--sf-muted); }
.sf-lt { padding:18px 22px; display:flex; flex-direction:column; gap:14px; font-size:12px; color:var(--sf-text); }
.sf-lt-head h2 { margin:0 0 6px; font-size:16px; }
.sf-lt-head p { margin:8px 0 0; color:var(--sf-muted); max-width:720px; }
.sf-lt-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; color:var(--sf-muted); }
.sf-lt-badge { border:1px solid var(--sf-border); border-radius:999px; padding:1px 8px; font-size:10px; }
.sf-lt-path { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-lt-note { margin:0; color:var(--sf-muted); }
.sf-lt-note.is-warn { color:var(--sf-warn); }
.sf-lt-note.is-error { color:var(--sf-danger); }
.sf-lt-section h3 { margin:0 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--sf-muted); }
.sf-lt-used { display:flex; flex-wrap:wrap; gap:10px; }
.sf-lt-table { width:100%; border-collapse:collapse; }
.sf-lt-table th, .sf-lt-table td { text-align:left; vertical-align:top; padding:6px 8px; border-bottom:1px solid var(--sf-border); }
.sf-lt-table th { font-weight:600; color:var(--sf-muted); }
.sf-lt-req { color:var(--sf-danger); margin-left:2px; }
.sf-lt-sub { color:var(--sf-muted); font-size:11px; margin-top:2px; }
.sf-lt-files { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
.sf-lt-files button { border:1px solid var(--sf-border); border-radius:6px; background:transparent; color:var(--sf-muted); padding:3px 8px; cursor:pointer; font:inherit; }
.sf-lt-files button[aria-pressed=true] { border-color:var(--sf-accent); color:var(--sf-text); }
.sf-lt-source { margin:0; padding:10px 12px; border:1px solid var(--sf-border); border-radius:8px; background:var(--sf-surface); overflow:auto; max-height:420px; font-size:11px; line-height:1.5; white-space:pre; }
`;
