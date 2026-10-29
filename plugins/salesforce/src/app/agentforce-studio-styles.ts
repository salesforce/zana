import { STUDIO_RESIZE_STYLES } from './studio/StudioResize.js';
import { STUDIO_TOKENS } from './studio/studio-tokens.js';
export const AGENTFORCE_STUDIO_STYLES = `
${STUDIO_TOKENS}${STUDIO_RESIZE_STYLES}.sf-as { container-type: inline-size; background:var(--sf-surface); color:var(--sf-text); }
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
.af-document-bar .sf-as-save:hover:not(:disabled):not(.is-dirty):not(.is-primary) { background:var(--sf-soft); }
/* Save and its arrow read as one control; the arrow opens Save as…. */
.af-document-bar .sf-as-split { position:relative; display:inline-flex; flex-shrink:0; }
.sf-as .af-document-bar .sf-as-split>.sf-as-save:first-child { border-top-right-radius:0; border-bottom-right-radius:0; }
.sf-as .af-document-bar .sf-as-split>.sf-as-save-more { width:24px; padding:0; margin-left:-1px; border-top-left-radius:0; border-bottom-left-radius:0; }
.sf-as .af-document-bar .sf-as-save-more.is-dirty { border-left:1px solid color-mix(in srgb,var(--sf-on-accent) 35%,transparent); }
.af-document-bar .sf-as-save-menu { position:absolute; top:calc(100% + 4px); right:0; z-index:30; min-width:170px; padding:4px; border:1px solid var(--sf-border); border-radius:8px; background:var(--sf-bg); box-shadow:0 8px 24px rgba(0,0,0,.14); }
.af-document-bar .sf-as-save-menu [role=menuitem] { display:flex; align-items:center; gap:8px; width:100%; border:0; border-radius:5px; background:transparent; color:var(--sf-text); font:inherit; font-size:12px; padding:6px 8px; text-align:left; cursor:pointer; white-space:nowrap; }
.af-document-bar .sf-as-save-menu [role=menuitem]:not(:disabled):hover, .af-document-bar .sf-as-save-menu [role=menuitem]:focus-visible { background:var(--sf-soft); outline:none; }
.af-document-bar .sf-as-save-menu [role=menuitem]:disabled { opacity:.5; cursor:default; }
.af-document-bar .af-document-compile.is-busy svg { animation:sf-compile-pulse 1s ease-in-out infinite; }
@keyframes sf-compile-pulse { 50% { opacity:.35; } }
/* Org switcher: a readable label (alias, kind, chevron) over an invisible native select. */
.af-document-org { display:flex; flex:0 1 auto; min-width:72px; max-width:220px; }
.af-document-org .sf-org-switcher { position:relative; display:flex; min-width:0; width:100%; height:30px; box-sizing:border-box; border:1px solid var(--sf-border); border-radius:6px; color:var(--sf-text); background:var(--sf-elevated); }
.af-document-org .sf-org-switcher:hover { background:var(--sf-soft); }
.af-document-org .sf-org-switcher:focus-within { outline:2px solid var(--sf-accent); outline-offset:2px; }
.af-document-org .sf-org-switcher[data-disabled=true] { opacity:.55; }
.af-document-org .sf-org-switcher-label { display:flex; align-items:center; gap:6px; min-width:0; height:100%; padding:0 8px; pointer-events:none; }
.af-document-org .sf-org-switcher-label svg { flex-shrink:0; color:var(--sf-muted); }
.af-document-org .sf-org-switcher-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:550; }
.af-document-org .sf-org-switcher-kind { flex-shrink:0; font-size:10px; line-height:16px; padding:0 5px; border-radius:4px; color:var(--sf-muted); background:color-mix(in srgb,var(--sf-muted) 14%,transparent); text-transform:capitalize; }
.af-document-org .sf-org-switcher-kind[data-kind=production] { color:var(--sf-warn); background:color-mix(in srgb,var(--sf-warn) 12%,transparent); }
.af-document-org .sf-org-switcher>.sf-org-picker { position:absolute; inset:0; width:100%; height:100%; max-width:none; margin:0; padding:0; border:0; opacity:0; cursor:pointer; }
.af-document-org .sf-org-switcher>.sf-org-picker:disabled { cursor:default; }
.sf-as .sf-as-explorer-search { margin-top:10px; }
.af-draft-state { color:var(--sf-muted); font-size:10px; display:inline-flex; gap:4px; align-items:center; flex-shrink:0; white-space:nowrap; }.af-draft-state[data-dirty=true] { color:var(--sf-accent); }
.af-document-issues { color:var(--sf-danger); flex-shrink:0; white-space:nowrap; }
.sf-as .sf-as-explorer { width:100%; flex:1; min-height:0; box-sizing:border-box; border:0; background:color-mix(in srgb,var(--sf-surface) 94%,var(--sf-muted)); }.sf-as .sf-as-explorer.is-collapsed { width:34px; }.sf-as .sf-as-explorer-head { padding:14px 10px 10px; }.sf-as .sf-as-tree-btn { padding-top:4px; padding-bottom:4px; min-height:26px; }.sf-as .sf-as-section-label { padding:10px 6px 6px; }.sf-as .sf-as-explorer-search { background:var(--sf-surface); }
.sf-as .sf-as-sunken { background:var(--sf-surface); }.sf-as .sf-as-save { border-radius:6px; }.sf-as .sf-as-save.is-dirty, .sf-as .sf-as-save.is-primary { background:var(--sf-accent); color:var(--sf-on-accent); border-color:var(--sf-accent); }.sf-as .sf-as-stage { overflow:hidden; }
.af-lab { width:410px; max-width:48%; min-width:300px; min-height:0; display:flex; flex-direction:column; border-left:1px solid var(--sf-border); background:var(--sf-surface); font-size:12px; }
.af-lab[hidden] { display:none; }
.af-workspace { display:flex; flex:1; min-width:0; min-height:0; }
.af-workspace[data-panel-open=true]>.sf-as-stage { flex:var(--af-editor-ratio) 1 0; }
.af-workspace[data-panel-open=true]>.af-tools { flex:calc(1 - var(--af-editor-ratio)) 1 0; width:auto; max-width:none; min-width:0; border-left:0; }
.af-lab-scroll { flex:1; min-height:0; overflow:auto; padding:16px; scrollbar-width:thin; }.af-engine { display:grid; grid-template-columns:1fr 1fr; gap:8px; }.af-engine button { text-align:left; border:1px solid var(--sf-border); background:transparent; border-radius:9px; padding:10px; color:var(--sf-text); cursor:pointer; }.af-engine button[aria-pressed=true] { border-color:var(--sf-accent); background:var(--sf-soft); }.af-engine strong { display:block; font-size:11px; font-weight:600; }.af-engine span { display:block; font-size:10px; line-height:1.5; color:var(--sf-muted); margin-top:5px; }
.af-caption { font-size:11px; line-height:1.6; color:var(--sf-muted); margin:10px 0 16px; }.af-scenario { padding:0; margin:0; border:0; min-width:0; }.af-scenario legend { font-size:9px; font-weight:650; letter-spacing:.1em; color:var(--sf-muted); margin-bottom:10px; }.af-presets { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:14px; }.af-presets button { border:1px solid var(--sf-border); background:transparent; color:var(--sf-muted); border-radius:20px; font-size:10px; padding:5px 9px; cursor:pointer; }.af-presets button:hover { color:var(--sf-text); background:var(--sf-soft); }
.af-context-fields { padding:0; margin:0; border:0; min-width:0; }.af-scenario-details,.af-context-details { margin:12px 0; border-top:1px solid var(--sf-border); border-bottom:1px solid var(--sf-border); }.af-scenario-details>summary,.af-context-details>summary { cursor:pointer; font-size:11px; font-weight:550; padding:12px 0; }.af-scenario-details>summary>span,.af-context-details>summary>span { float:right; color:var(--sf-muted); font-size:10px; font-weight:400; }.af-engine button[aria-pressed=true]:disabled { opacity:1; }.af-engine button:disabled { opacity:.65; }
.af-lab :where(.af-scenario,.af-model) label { display:flex; flex-direction:column; gap:6px; font-size:11px; font-weight:500; margin-bottom:12px; }.af-lab :where(.af-scenario,.af-model,.af-composer) :is(input,textarea,select) { box-sizing:border-box; width:100%; background:color-mix(in srgb,var(--sf-surface) 94%,var(--sf-muted)); color:var(--sf-text); font:inherit; font-size:12px; line-height:1.55; border:1px solid var(--sf-border); border-radius:6px; padding:8px 10px; }.af-lab :where(.af-scenario,.af-model) textarea { resize:vertical; min-height:52px; }.af-lab .af-turn-limit { flex-direction:row; align-items:center; justify-content:space-between; }.af-turn-limit select { width:100px; }.af-model { margin:6px 0 14px; color:var(--sf-muted); font-size:11px; }.af-model summary { cursor:pointer; padding:3px 0 8px; }.af-model p { line-height:1.6; }.af-run-actions { display:flex; gap:8px; margin:14px 0 18px; }
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
.af-org-agents>header { display:flex; align-items:center; gap:6px; margin-bottom:14px; }.af-org-agents>header>div { flex:1; min-width:0; }
.af-org-agents>header strong { font-size:13px; font-weight:600; }.af-org-agents>header small { display:block; color:var(--sf-muted); margin-top:3px; font-size:11px; }
.af-agent-search { display:flex; align-items:center; gap:7px; padding:7px 9px; border:1px solid var(--sf-border); border-radius:7px; color:var(--sf-muted); background:var(--bg-input,transparent); }
.af-agent-search input { width:100%; min-width:0; background:none; border:0; color:var(--sf-text); font:inherit; }
.af-agent-caption { color:var(--sf-muted); font-size:11px; line-height:1.5; margin:10px 0 14px; }
.af-agent-group { margin-top:12px; }
.af-agent-group-label { display:flex; align-items:center; margin:0 0 4px; padding:0 6px; font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--sf-muted); }
.af-agent-group-label span { margin-left:auto; font-weight:500; letter-spacing:0; }
.af-agent-list { display:grid; gap:1px; }
.af-agent-row { position:relative; display:flex; align-items:center; gap:6px; min-height:30px; padding:0 4px 0 0; border-radius:6px; }
.af-agent-row:hover, .af-agent-row:focus-within, .af-agent-row.is-busy { background:var(--sf-soft); }
.af-agent-row-main { flex:1; min-width:0; display:flex; align-items:center; gap:8px; height:30px; padding:0 6px; border:0; border-radius:6px; background:none; color:var(--sf-text); font:inherit; font-size:12px; text-align:left; }
button.af-agent-row-main { cursor:pointer; }button.af-agent-row-main:disabled { cursor:default; opacity:.6; }
.af-agent-row-main svg { flex:none; color:var(--sf-accent); }
.af-agent-row-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-agent-row-date { margin-left:auto; padding-left:8px; flex:none; font-size:11px; color:var(--sf-muted); }
.af-agent-open-pill { margin-left:auto; flex:none; font-size:10px; line-height:17px; padding:0 7px; border-radius:9px; color:var(--sf-success); background:color-mix(in srgb,var(--sf-success) 14%,transparent); }
/* Org row actions stay focusable while hidden, so Tab reveals them like hover does. */
.af-agent-row-actions { position:absolute; right:4px; top:50%; transform:translateY(-50%); display:flex; align-items:center; gap:4px; opacity:0; pointer-events:none; }
.af-agent-row:hover .af-agent-row-actions, .af-agent-row:focus-within .af-agent-row-actions, .af-agent-row.is-busy .af-agent-row-actions { opacity:1; pointer-events:auto; }
.af-agent-row:hover .af-agent-row-date, .af-agent-row:focus-within .af-agent-row-date, .af-agent-row.is-busy .af-agent-row-date { visibility:hidden; }
.af-agent-row-actions select { height:24px; padding:0 4px; border:1px solid var(--sf-border); border-radius:5px; background:var(--sf-surface); color:var(--sf-text); font:inherit; font-size:11px; }
.af-agent-row-actions button { display:flex; gap:5px; align-items:center; height:24px; padding:0 8px; font-size:11px; color:var(--sf-text); border-radius:5px; }
.af-agent-row-actions button:hover:not(:disabled) { border-color:var(--sf-accent); color:var(--sf-accent); }.af-agent-row-actions button:disabled { opacity:.5; cursor:default; }
.af-agent-row-action { flex:none; }
@media (hover:none) { .af-agent-row .af-agent-row-actions { position:static; transform:none; opacity:1; pointer-events:auto; } .af-agent-row .af-agent-row-date { display:none; } }
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
.sf-explorer-col { position:relative; display:flex; flex-direction:column; width:260px; flex-shrink:0; min-height:0; box-sizing:border-box; padding-right:9px; background:var(--sf-bg); }
/* Reserve the grab strip so it never covers the explorer scrollbar. */
.sf-explorer-col > .sf-explorer-resizer { position:absolute; top:0; right:0; width:9px; height:100%; }
.sf-explorer-col[hidden] { display:none; }
.sf-explorer-col:has(> .sf-as-explorer.is-collapsed) { width:auto; }
.sf-etabs { display:flex; flex-shrink:0; overflow-x:auto; border-bottom:1px solid var(--sf-border); background:var(--sf-bg); scrollbar-width:none; }
.sf-etabs::-webkit-scrollbar { display:none; }
.sf-etab { display:inline-flex; align-items:center; flex-shrink:0; border-right:1px solid var(--sf-border); color:var(--sf-muted); }
.sf-etab.is-active { color:var(--sf-text); box-shadow:inset 0 -2px 0 var(--sf-accent); background:color-mix(in srgb,var(--sf-accent) 8%,transparent); }
.sf-etab-label { display:inline-flex; align-items:center; gap:6px; min-height:36px; max-width:220px; box-sizing:border-box; border:0; background:transparent; color:inherit; font:inherit; font-size:13px; padding:8px 6px 8px 14px; cursor:pointer; }
.sf-etab[data-kind=agent] .sf-etab-label { min-width:84px; justify-content:center; padding-inline:16px; }
.sf-etab-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-etab-kind { font-size:9px; letter-spacing:.06em; color:var(--sf-accent); }
.sf-etab-ro, .sf-etab-dirty { font-size:10px; color:var(--sf-muted); white-space:nowrap; }
.sf-etab-dirty { color:var(--sf-accent); }
.sf-etab-problems { min-width:14px; border-radius:7px; background:var(--sf-danger); color:var(--sf-bg); font-size:9px; line-height:14px; text-align:center; padding:0 3px; }
.sf-etab-close { display:inline-flex; border:0; background:transparent; color:var(--sf-muted); cursor:pointer; padding:6px; border-radius:4px; }
.sf-etab-close:hover { color:var(--sf-text); }
.sf-etab-label:focus-visible, .sf-etab-close:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-etab-menu { position:fixed; z-index:50; display:flex; flex-direction:column; min-width:170px; padding:4px; border:1px solid var(--sf-border); border-radius:6px; background:var(--sf-bg); box-shadow:0 6px 20px rgba(0,0,0,.25); }
.sf-etab-menu button { border:0; background:transparent; color:var(--sf-text); font:inherit; font-size:12px; text-align:left; padding:6px 10px; border-radius:4px; cursor:pointer; }
.sf-etab-menu button:hover:not(:disabled), .sf-etab-menu button:focus-visible { background:color-mix(in srgb,var(--sf-accent) 14%,transparent); outline:0; }
.sf-etab-menu button:disabled { color:var(--sf-muted); cursor:default; }
.sf-etabs-bar { display:flex; align-items:stretch; flex-shrink:0; min-width:0; border-bottom:1px solid var(--sf-border); background:var(--sf-bg); }
.sf-etabs-bar > .sf-etabs { flex:1; min-width:0; border-bottom:0; }
.sf-etabs-actions { display:flex; align-items:center; flex-shrink:0; gap:4px; padding:0 8px; border-left:1px solid var(--sf-border); }
.sf-etabs-actions .af-document-org { max-width:200px; }
.sf-etabs-actions .af-document-org .sf-org-switcher { height:26px; }
@container af-editor (max-width:780px) { .sf-etabs-actions .af-document-org { max-width:120px; } .sf-etabs-actions .sf-follow-label { display:none; } }
.sf-atabs-bar { display:flex; align-items:stretch; flex-shrink:0; min-width:0; border-bottom:1px solid var(--sf-border); background:color-mix(in srgb,var(--sf-text) 4%,var(--sf-bg)); }
.sf-atabs { display:flex; flex:1; min-width:0; overflow-x:auto; scrollbar-width:none; }
.sf-atabs::-webkit-scrollbar { display:none; }
.sf-atab { display:inline-flex; align-items:center; flex-shrink:0; border-right:1px solid var(--sf-border); color:var(--sf-muted); }
.sf-atab.is-active { color:var(--sf-text); background:var(--sf-bg); box-shadow:inset 0 2px 0 var(--sf-accent); }
.sf-atab-label { display:inline-flex; align-items:center; gap:6px; max-width:220px; border:0; background:transparent; color:inherit; font:inherit; font-size:12px; font-weight:600; padding:7px 4px 7px 12px; cursor:pointer; }
.sf-atab-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-atab-running { display:inline-flex; color:var(--sf-accent); }
.sf-atab-label:focus-visible, .sf-atab-add:focus-visible, .sf-atab-view:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-atab-view { border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:12px; padding:3px 8px; border-radius:4px; cursor:pointer; }
.sf-atab-view:hover:not(:disabled) { color:var(--sf-text); }
.sf-atab-view:disabled { opacity:.4; cursor:default; }
.sf-atab-add { display:inline-flex; align-items:center; gap:4px; flex-shrink:0; border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:12px; padding:7px 10px; cursor:pointer; }
.sf-atab-add:hover { color:var(--sf-text); }
.sf-atabs-actions { display:flex; align-items:center; flex-shrink:0; gap:6px; padding:0 8px; border-left:1px solid var(--sf-border); }
.sf-atabs-actions .af-document-org { max-width:200px; }
.sf-held-banner { display:flex; align-items:center; gap:8px; flex-shrink:0; padding:6px 10px; border-bottom:1px solid var(--sf-border); background:color-mix(in srgb,var(--sf-accent) 10%,transparent); color:var(--sf-text); font-size:12px; }
.sf-held-banner > span { flex:1; min-width:0; }
.sf-etab-view { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; }
.sf-panel-tool .sf-etab-view { min-width:0; overflow:hidden; }
.sf-studio-tool-context { display:flex; gap:12px; align-items:center; flex-shrink:0; padding:10px 12px; border-bottom:1px solid var(--sf-border); background:var(--sf-elevated); font-size:12px; }
.sf-studio-tool-context.is-pinned { box-shadow:inset 3px 0 var(--sf-accent); }
.sf-studio-tool-owner { display:flex; flex:1; flex-direction:column; gap:3px; min-width:0; }
.sf-studio-tool-owner strong,.sf-studio-tool-owner span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-studio-tool-owner span { color:var(--sf-muted); font-size:11px; }
.sf-studio-tool-pin { display:inline-flex; gap:6px; align-items:center; flex-shrink:0; min-height:30px; padding:4px 9px; border:1px solid var(--sf-border); border-radius:6px; color:var(--sf-text); background:var(--sf-surface); font:inherit; cursor:pointer; }
.sf-studio-tool-pin:hover,.sf-studio-tool-pin[aria-pressed=true] { color:var(--sf-accent); border-color:var(--sf-accent); background:var(--sf-soft); }
.sf-studio-tool-pin:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-studio-runs { position:relative; flex-shrink:0; }
.sf-studio-runs-trigger { display:inline-flex; align-items:center; gap:6px; min-height:30px; padding:4px 9px; border:1px solid var(--sf-border); border-radius:6px; color:var(--sf-accent); background:var(--sf-elevated); font:inherit; cursor:pointer; white-space:nowrap; }
.sf-studio-runs-list { position:absolute; right:0; top:calc(100% + 6px); z-index:40; width:320px; max-width:calc(100vw - 32px); max-height:360px; overflow:auto; box-sizing:border-box; padding:12px; border:1px solid var(--sf-border); border-radius:10px; color:var(--sf-text); background:var(--sf-elevated); box-shadow:0 8px 24px #0002; white-space:normal; }
.sf-studio-runs-list > strong { font-size:13px; }
.sf-studio-runs-list p { margin:4px 0 10px; font-size:11px; color:var(--sf-muted); }
.sf-studio-runs-list > button { display:flex; gap:9px; align-items:center; width:100%; min-height:52px; text-align:left; padding:8px; border:1px solid var(--sf-border); border-radius:6px; background:var(--sf-surface); color:var(--sf-text); font:inherit; cursor:pointer; }
.sf-studio-runs-list > button + button { margin-top:6px; }
.sf-studio-runs-list > button:hover { border-color:var(--sf-accent); }
.sf-studio-runs-list > button > span { display:flex; flex-direction:column; gap:4px; min-width:0; }
.sf-studio-runs-list > button span span { color:var(--sf-muted); font-size:11px; }
.sf-studio-runs-list > button strong { font-size:12px; overflow:hidden; text-overflow:ellipsis; }
.sf-studio-runs button:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-kbd { margin-left:6px; padding:0 4px; border:1px solid var(--sf-border); border-radius:4px; font:inherit; font-size:10px; color:var(--sf-muted); }
.sf-bottom { display:flex; flex-direction:column; flex-shrink:0; border-top:1px solid var(--sf-border); background:var(--sf-bg); color:var(--sf-text); }
.sf-bottom[data-open=true] { border-top:0; }
.sf-bottom-tabs { display:flex; align-items:center; gap:2px; padding:0 6px; }
.sf-bottom-tab { display:inline-flex; align-items:center; gap:6px; border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:11px; padding:6px 10px; cursor:pointer; }
.sf-bottom-tab.is-active { color:var(--sf-text); box-shadow:inset 0 -2px 0 var(--sf-accent); }
.sf-bottom-badge { min-width:14px; border-radius:7px; background:var(--sf-danger); color:var(--sf-bg); font-size:9px; line-height:14px; text-align:center; padding:0 3px; }
.sf-bottom-toggle { margin-left:auto; border:0; background:transparent; color:var(--sf-muted); cursor:pointer; padding:4px; }
.sf-bottom-bar { display:flex; align-items:center; gap:6px; border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:12px; padding:7px 10px; cursor:pointer; text-align:left; }
.sf-bottom-count.is-problem { color:var(--sf-danger); }
.sf-bottom-body { min-height:0; overflow:auto; border-top:1px solid var(--sf-border); }

.sf-bottom-body[hidden], .sf-bottom-pane[hidden] { display:none; }
.sf-bottom-pane { height:100%; min-height:0; overflow:auto; }
.sf-bottom-tab:focus-visible, .sf-bottom-toggle:focus-visible, .sf-bottom-bar:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-problems-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; font-size:11px; color:var(--sf-muted); border-bottom:1px solid var(--sf-border); }
.sf-problems-head small { color:var(--sf-muted); }
.sf-btn-small { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--sf-border); border-radius:6px; background:transparent; color:var(--sf-text); font:inherit; font-size:11px; padding:3px 8px; cursor:pointer; }
.sf-btn-small:hover:not(:disabled) { border-color:var(--sf-accent); }
.sf-btn-small:disabled { opacity:.5; cursor:default; }
.sf-problems-empty { margin:0; padding:12px 10px; font-size:12px; color:var(--sf-muted); }
.sf-compile { margin:0; padding:6px 10px; font-size:12px; border-bottom:1px solid var(--sf-border); white-space:pre-wrap; overflow-wrap:anywhere; }
.sf-compile.is-running { color:var(--sf-muted); } .sf-compile.is-passed { color:var(--sf-success); } .sf-compile.is-failed { color:var(--sf-danger); }
.sf-follow-chip { display:inline-flex; align-items:center; gap:6px; flex:0 1 auto; min-width:0; max-width:220px; height:30px; box-sizing:border-box; padding:0 10px; border:1px solid var(--sf-border); border-radius:15px; background:var(--sf-soft); color:var(--sf-text); font:inherit; font-size:12px; white-space:nowrap; cursor:pointer; }
.sf-follow-chip>svg { flex:none; color:var(--sf-accent); }
.sf-follow-chip.is-paused>svg { color:currentColor; }
.sf-follow-chip:hover { border-color:var(--sf-accent); }
.sf-follow-chip.is-paused { color:var(--sf-warn); }
.sf-follow-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.sf-follow-action { display:inline-flex; align-items:center; gap:3px; padding-left:6px; border-left:1px solid var(--sf-border); color:var(--sf-muted); flex:none; }
.sf-follow-toast { display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--sf-border); background:var(--sf-elevated); color:var(--sf-text); font-size:12px; }
.sf-follow-toast > span:first-child { flex:1; min-width:0; overflow-wrap:anywhere; }
.sf-follow-why { color:var(--sf-muted); }
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
/* The identity keeps at least its icon and clips its text: it never slides under the actions. */
.sf-studio .af-document-identity { flex:1 1 0; min-width:28px; overflow:hidden; }
.sf-studio .af-document-actions { flex:0 1 auto; flex-wrap:nowrap; min-width:0; }
.sf-studio .af-document-bar .af-document-icon { width:28px; height:28px; }
@container af-editor (max-width:960px) { .sf-studio .af-document-bar .sf-kbd, .sf-studio .af-document-bar .sf-follow-label { display:none; } }
@container af-editor (max-width:780px) { .sf-studio .af-document-bar .sf-as-save:not(.sf-as-save-more) { font-size:0; gap:0; width:30px; padding:0; } .sf-studio .af-document-bar .sf-as-save svg { width:14px; height:14px; } .sf-studio .af-document-bar .sf-follow-action-text { display:none; } .af-document-org .sf-org-switcher-kind { display:none; } }
.sf-studio[data-layout=compact] .af-document-bar { padding:6px 8px; min-height:0; }
.sf-studio[data-layout=compact] .af-document-details { display:none; }
.sf-studio[data-layout=wide] .af-workspace[data-panel-open=true]>.af-tools { border-left:1px solid var(--sf-border); }
@media (prefers-reduced-motion:reduce) { .sf-studio * { transition:none!important; } }

.sf-main-col { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; }
.sf-main-col>.af-workspace { flex:1 1 0; min-height:0; }

.sf-as-no-file { position:absolute; inset:0; z-index:2; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; background:var(--sf-surface); }
.sf-as .sf-as-explorer-top { display:flex; align-items:center; gap:4px; margin-top:10px; }
.sf-as .sf-as-explorer-top .sf-as-explorer-search { margin-top:0; flex:1; min-width:0; }
.sf-as .sf-as-explorer-hide { flex:0 0 auto; color:var(--sf-muted); }
.sf-as .sf-as-section-toggle { display:flex; align-items:center; gap:4px; width:100%; border:0; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit; }
.sf-as .sf-as-section-toggle:hover { color:var(--sf-text); }
.sf-as .sf-as-section-toggle:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-as .sf-as-section-count { margin-left:auto; font-weight:400; letter-spacing:0; color:var(--sf-muted); }
.sf-as .sf-as-explorer-scroll { scrollbar-width:thin; scrollbar-gutter:stable; }
.sf-as .sf-as-tree-name { flex:1 1 auto; }
.sf-as .sf-as-tree-meta { flex:none; font-variant-numeric:tabular-nums; }
.sf-as .sf-as-tree-uses { min-width:18px; padding:0 5px; box-sizing:border-box; border-radius:8px; line-height:16px; text-align:center; background:color-mix(in srgb,var(--sf-muted) 14%,transparent); }
/* Explorer outline: agents unfold into what they reference. Kind colours are fixed hues that read on light and dark hosts. */
.sf-as .sf-as-explorer-scroll { padding:0 4px 10px; }
.sf-as .sf-as-section-label { position:sticky; top:0; z-index:1; background:color-mix(in srgb,var(--sf-surface) 94%,var(--sf-muted)); }
.sf-as .sf-as-section.is-muted .sf-as-section-label { opacity:.75; }
.sf-as .sf-as-chevron { flex:none; color:var(--sf-muted); transition:transform .12s; }
.sf-as [aria-expanded=true] > .sf-as-chevron { transform:rotate(90deg); }
.sf-as .sf-as-kind-icon { display:inline-flex; flex:none; color:var(--sf-muted); }
.sf-as .sf-as-kind-icon.is-agent { color:var(--sf-accent); }
.sf-as .sf-as-kind-icon.is-apex { color:#a371f7; }
.sf-as .sf-as-kind-icon.is-flow { color:#20a98a; }
.sf-as .sf-as-kind-icon.is-prompt { color:#d0679f; }
.sf-as .sf-as-kind-icon.is-lightning-type { color:#e0823d; }
.sf-as .sf-as-kind-icon.is-lwc { color:#3d8fe0; }
.sf-as .sf-as-kind-icon.is-org-agent { color:var(--sf-accent); }
.sf-as .sf-as-kind-icon.is-scenario { color:var(--sf-success); }
.sf-as .sf-as-tree-btn:disabled { cursor:default; opacity:.6; }
.sf-as .sf-as-tree-btn:disabled:hover { background:transparent; }
.sf-as .sf-as-depth-1 { padding-left:22px; }
.sf-as .sf-as-depth-2 { padding-left:38px; }
.sf-as .sf-as-agent-row { padding:0; gap:0; position:relative; }
.sf-as .sf-as-twisty { display:inline-flex; align-items:center; justify-content:center; flex:none; width:22px; height:26px; padding:0; border:0; border-radius:4px; background:transparent; color:inherit; cursor:pointer; }
.sf-as span.sf-as-twisty { cursor:default; }
.sf-as .sf-as-twisty:focus-visible, .sf-as .sf-as-agent-open:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-as .sf-as-agent-open { display:flex; align-items:center; gap:6px; flex:1; min-width:0; height:26px; padding:0 6px 0 0; border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.sf-as .sf-as-agent-row:not(:hover):not(.is-active) .sf-as-hover-meta { display:none; }
.sf-as .sf-as-tree-hint { flex:0 1 auto; min-width:0; max-width:45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; color:var(--sf-muted); }
.sf-as .sf-as-tree-meta.is-danger { color:var(--sf-danger); }
.sf-as .sf-as-tree-meta.is-warn { color:var(--sf-warn); }
.sf-as .sf-as-deps { position:relative; padding-bottom:4px; }
.sf-as .sf-as-deps::before { content:""; position:absolute; left:16px; top:0; bottom:6px; width:1px; background:var(--sf-border); }
.sf-as .sf-as-dep-label { display:flex; gap:6px; padding:6px 8px 2px 38px; font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--sf-muted); }
.sf-as .sf-as-dep-label span { font-weight:400; letter-spacing:0; opacity:.8; }
.sf-as .sf-as-dep-note { padding:4px 8px 6px 38px; font-size:11px; color:var(--sf-muted); }
.sf-as .sf-as-org-link { display:flex; align-items:center; gap:8px; width:calc(100% - 12px); margin:8px 6px 4px; padding:7px 10px; border:1px dashed var(--sf-border); border-radius:7px; background:var(--sf-surface, transparent); color:var(--sf-text); font:inherit; font-size:12px; text-align:left; cursor:pointer; }
.sf-as .sf-as-org-link:hover, .sf-as .sf-as-org-link:focus-visible { border-style:solid; border-color:var(--sf-accent); }
.sf-as .sf-as-org-link-text { display:flex; flex-direction:column; min-width:0; flex:1; }
.sf-as .sf-as-org-link-text > * { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-as .sf-as-org-link-text small { font-size:11px; color:var(--sf-muted); }
.sf-as .sf-as-org-link-arrow { flex:none; color:var(--sf-accent); }
.sf-as .sf-as-focus-back { color:var(--sf-muted); margin-bottom:2px; }
.sf-as .sf-as-view-head { display:flex; align-items:center; gap:6px; padding:2px 2px 4px; font-size:12px; font-weight:600; color:var(--sf-text); }
.sf-as .sf-as-explorer-foot { flex:none; padding:4px; border-top:1px solid var(--sf-border); }
.sf-as .sf-as-explorer-foot .sf-as-tree-btn { color:var(--sf-muted); }
.sf-as .sf-as-explorer-foot .sf-as-tree-btn:hover, .sf-as .sf-as-explorer-foot .sf-as-tree-btn.is-active { color:var(--sf-text); }
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
.sf-lt-rel { margin:0; display:grid; gap:8px; }
.sf-lt-relrow { display:grid; grid-template-columns:76px 1fr; gap:10px; align-items:start; }
.sf-lt-relrow dt { color:var(--sf-muted); padding-top:3px; display:flex; align-items:center; gap:4px; }
.sf-lt-relrow dd { margin:0; min-width:0; }
.sf-lt-count { font-size:10px; font-weight:600; border-radius:999px; padding:0 6px; background:var(--sf-soft); color:var(--sf-muted); }
.sf-lt-chips { display:flex; flex-wrap:wrap; gap:6px; }
.sf-lt-chip { display:inline-flex; align-items:center; gap:5px; max-width:100%; min-width:0; border:1px solid var(--sf-border); border-radius:6px; padding:2px 8px 2px 5px; background:transparent; color:var(--sf-text); font:inherit; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-lt-chip:hover { border-color:var(--sf-accent); }
.sf-lt-chip:focus-visible, .sf-lt-series button:focus-visible, .sf-lt-filebar button:focus-visible { outline:2px solid var(--sf-accent); outline-offset:1px; }
.sf-lt-chip.is-series { background:var(--sf-soft); }
.sf-lt-chip-n { color:var(--sf-muted); font-size:11px; }
.sf-lt-chip .is-type { color:#e0823d; flex:none; }
.sf-lt-chip .is-agent { color:var(--sf-accent); flex:none; }
.sf-lt-chip.is-more { border-style:dashed; color:var(--sf-muted); padding:2px 8px; }
.sf-lt-filter { display:inline-flex; align-items:center; gap:5px; margin-bottom:6px; border:1px solid var(--sf-border); border-radius:6px; padding:1px 6px; color:var(--sf-muted); }
.sf-lt-filter input { border:0; outline:0; background:transparent; color:var(--sf-text); font:inherit; width:160px; }
.sf-lt-filter:focus-within { border-color:var(--sf-accent); }
.sf-lt-series { display:flex; flex-wrap:wrap; align-items:center; gap:3px; margin-top:6px; padding:4px 0 4px 8px; border-left:2px solid var(--sf-border); }
.sf-lt-series-head { color:var(--sf-muted); font:11px var(--sf-mono, ui-monospace, Menlo, monospace); margin-right:4px; }
.sf-lt-series button { border:0; border-radius:4px; padding:1px 6px; min-width:26px; background:var(--sf-soft); color:var(--sf-accent); font:11px var(--sf-mono, ui-monospace, Menlo, monospace); cursor:pointer; }
.sf-lt-series button:hover { text-decoration:underline; }
.sf-lt-bundle { border:1px solid var(--sf-border); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
.sf-lt-filebar { display:flex; align-items:center; gap:2px; padding:0 6px; border-bottom:1px solid var(--sf-border); overflow-x:auto; }
.sf-lt-filebar button { display:inline-flex; align-items:center; gap:5px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--sf-muted); padding:7px 8px 6px; font:inherit; cursor:pointer; white-space:nowrap; }
.sf-lt-filebar button[aria-selected=true] { color:var(--sf-text); border-bottom-color:var(--sf-accent); }
.sf-lt-filebar-gap { flex:1; }
.sf-lt-filebar .sf-lt-copy { border-bottom:0; padding:4px 8px; }
.sf-lt-ext { font-size:9px; font-weight:600; padding:0 4px; border-radius:3px; background:var(--sf-soft); color:var(--sf-muted); }
.sf-lt-code { display:grid; grid-template-columns:auto minmax(0,1fr); max-height:520px; overflow:auto; background:var(--sf-surface); font-size:11px; line-height:1.5; }
.sf-lt-code .sf-lt-gutter { margin:0; padding:10px 8px 10px 12px; text-align:right; color:var(--sf-muted); opacity:.6; user-select:none; border-right:1px solid var(--sf-border); }
.sf-lt-code .sf-lt-source { border:0; border-radius:0; max-height:none; overflow-x:auto; overflow-y:visible; }
.sf-lt-bundle > .sf-lt-source { border:0; border-radius:0; }
.sf-lt-code .tok-tag { color:#3fa45b; } .sf-lt-code .tok-attr { color:#8a63d2; } .sf-lt-code .tok-string { color:#3b82c4; }
.sf-lt-code .tok-comment { color:var(--sf-muted); font-style:italic; } .sf-lt-code .tok-expr { color:#d9822b; } .sf-lt-code .tok-keyword { color:#d1495b; }
.sf-lt-sketch { display:flex; flex-direction:column; gap:8px; padding:10px 12px; }
.sf-lt-sketch iframe { width:100%; height:420px; border:1px solid var(--sf-border); border-radius:6px; background:#fff; }
/* ---- Role-play workbench: conversation | evidence ----------------------------------------------------------------- */
.af-lab.af-lab-split { width:100%; max-width:none; min-width:0; flex:1; border-left:0; container-type:inline-size; }
.af-lab-grid { display:flex; flex:1; min-height:0; min-width:0; overflow:hidden; }
.af-lab-left,.af-lab-right { display:flex; flex-direction:column; min-width:0; min-height:0; }
.af-lab-left { flex:var(--sf-pane-ratio) 1 0; }
.af-lab-right { flex:calc(100 - var(--sf-pane-ratio)) 1 0; }
.af-lab-grid[data-stacked=true] { flex-direction:column; }
.af-lab-head { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:10px 14px; border-bottom:1px solid var(--sf-border); }
.af-lab-head.is-evidence { justify-content:space-between; min-height:44px; box-sizing:border-box; font-size:12px; }
.af-lab-head .af-icon { width:30px; height:30px; border-radius:8px; }
.af-lab-head .af-engine { display:inline-flex; gap:0; border:1px solid var(--sf-border); border-radius:8px; overflow:hidden; }
.af-lab-head .af-engine button { border:0; border-radius:0; padding:6px 11px; }
.af-lab-head .af-engine button+button { border-left:1px solid var(--sf-border); }
.af-lab-head .af-engine span { margin-top:2px; }
.af-lab-head .af-run-meta { margin:0; }
.af-seg { display:inline-flex; border:1px solid var(--sf-border); border-radius:6px; overflow:hidden; }
.af-seg button { border:0; background:transparent; color:var(--sf-muted); font:inherit; font-size:11px; padding:3px 10px; cursor:pointer; }
.af-seg button+button { border-left:1px solid var(--sf-border); }
.af-seg button[aria-pressed=true] { background:var(--sf-soft); color:var(--sf-accent); font-weight:600; }
.af-presets button[aria-pressed=true] { color:var(--sf-accent); border-color:var(--sf-accent); background:var(--sf-soft); }
.af-stepper { display:flex; gap:6px; margin:0; padding:10px 14px; list-style:none; border-bottom:1px solid var(--sf-border); font-size:10px; color:var(--sf-muted); }
.af-step { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.af-step i { display:block; height:4px; border-radius:2px; margin-bottom:5px; background:color-mix(in srgb,var(--sf-muted) 22%,transparent); }
.af-step.is-done { color:var(--sf-text); } .af-step.is-done i { background:var(--sf-success); }
.af-step.is-cur { color:var(--sf-accent); font-weight:600; } .af-step.is-cur i { background:var(--sf-accent); animation:af-pulse 1.2s ease-in-out infinite; }
@keyframes af-pulse { 50% { opacity:.4; } }
.af-lab-split .af-transcript { gap:10px; }
.af-lab-split .af-message { max-width:86%; width:auto; }
.af-message-body { display:block; width:100%; padding:0; border:0; background:none; color:inherit; font:inherit; text-align:left; }
button.af-message-body { cursor:pointer; }
.af-message-meta,.af-message-tags { display:flex; }
.af-message-text { display:block; }
.af-message.is-selected .af-message-text { box-shadow:0 0 0 2px var(--sf-accent); }
.af-message-tags { gap:4px; flex-wrap:wrap; padding:5px 2px 0; }
.af-chip { border:1px solid var(--sf-border); border-radius:999px; padding:1px 7px; font-size:9px; color:var(--sf-muted); white-space:nowrap; }
.af-chip.is-topic { color:var(--sf-accent); border-color:color-mix(in srgb,var(--sf-accent) 45%,var(--sf-border)); }
.af-message.is-ghost { opacity:.7; }
.af-message.is-ghost .af-message-text { background:transparent; border:1px dashed var(--sf-border); color:var(--sf-muted); }
.af-message.is-outgoing .af-message-text { opacity:.85; }
.af-typing { align-self:flex-start; display:flex; gap:4px; padding:10px 12px; border:1px solid var(--sf-border); border-radius:12px; }
.af-typing.is-customer { align-self:flex-end; }
.af-typing i { width:6px; height:6px; border-radius:50%; background:var(--sf-muted); animation:af-pulse 1s infinite; }
.af-typing i:nth-child(2) { animation-delay:.2s; } .af-typing i:nth-child(3) { animation-delay:.4s; }
.af-statusbar { display:flex; align-items:center; gap:10px; padding:8px 14px; border-top:1px solid var(--sf-border); background:var(--sf-elevated); font-size:11px; min-height:38px; box-sizing:border-box; }
.af-statusbar .af-status { font-size:11px; }
.af-dot { width:8px; height:8px; flex-shrink:0; border-radius:50%; background:var(--sf-accent); animation:af-pulse 1s infinite; }
.af-elapsed,.af-saved { color:var(--sf-muted); font-size:10px; font-variant-numeric:tabular-nums; }
.af-saved { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.af-spacer { flex:1; }
.af-statusbar .af-text-button { font-size:11px; white-space:nowrap; }
.af-stop { font:inherit; font-size:11px; font-weight:600; color:var(--sf-danger); background:transparent; border:1px solid color-mix(in srgb,var(--sf-danger) 45%,var(--sf-border)); border-radius:6px; padding:3px 10px; cursor:pointer; }
.af-evidence { flex:1; min-height:0; overflow:auto; padding:12px 14px; display:flex; flex-direction:column; gap:14px; scrollbar-width:thin; }
.af-evidence-empty { color:var(--sf-muted); font-size:11px; line-height:1.6; margin:0; }
.af-ev-turn { display:flex; flex-direction:column; gap:6px; scroll-margin-top:8px; }
.af-ev-turn h4 { display:flex; justify-content:space-between; margin:0; font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--sf-muted); }
.af-ev-turn.is-selected h4 { color:var(--sf-accent); }
.af-ev-turn.is-selected .sf-trace { border-color:var(--sf-accent); }
.af-ev-turn.is-todo { opacity:.5; }
.af-ev-reply { display:flex; flex-direction:column; gap:4px; }
.af-ev-plan { font-family:ui-monospace,monospace; font-size:9px; color:var(--sf-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.af-ev-pending { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px dashed var(--sf-border); border-radius:8px; color:var(--sf-accent); font-size:11px; }
.af-ev-pending::before { content:''; width:8px; height:8px; border-radius:50%; background:var(--sf-accent); animation:af-pulse 1s infinite; }
.af-raw { margin:0; font:10px/1.5 ui-monospace,monospace; color:var(--sf-text); white-space:pre-wrap; overflow-wrap:anywhere; }

/* Role-play: setup rail plus a linked conversation / selected-turn workspace. */
.af-roleplay { position:relative; overflow:hidden; font-size:13px; }
.af-roleplay-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid var(--sf-border); flex-shrink:0; }
.af-roleplay-toolbar>.af-primary { flex:none; justify-content:center; color:var(--sf-on-accent); background:var(--sf-accent); border-color:var(--sf-accent); min-height:36px; }
.af-roleplay-toolbar .af-run-meta { margin:0; }
.af-roleplay-toolbar .af-run-meta span { font-size:11px; }
.af-roleplay-body { display:flex; flex:1; min-width:0; min-height:0; overflow:hidden; }
.af-setup { display:flex; flex-direction:column; flex:0 0 340px; min-width:0; min-height:0; border-right:1px solid var(--sf-border); background:var(--sf-elevated); }
.af-setup[hidden] { display:none; }
.af-setup-head { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; min-height:48px; box-sizing:border-box; border-bottom:1px solid var(--sf-border); }
.af-setup-scroll { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:0 14px 14px; }
.af-roleplay .af-engine { grid-template-columns:1fr; gap:7px; }
.af-roleplay .af-engine strong { font-size:13px; }
.af-roleplay .af-engine span { font-size:12px; margin-top:3px; }
.af-roleplay :where(.af-scenario,.af-model) label { font-size:13px; }
.af-roleplay :where(.af-scenario,.af-model) :is(input,textarea,select) { font-size:13px; }
.af-roleplay .af-presets button { min-height:32px; font-size:12px; border-radius:6px; }
.af-roleplay :is(.af-scenario-details,.af-context-details,.af-model)>summary { display:flex; align-items:center; gap:10px; min-height:44px; box-sizing:border-box; list-style:none; padding:10px 0; font-size:13px; color:var(--sf-text); }
.af-roleplay :is(.af-scenario-details,.af-context-details)>summary>span { float:none; margin-left:auto; font-size:11px; text-align:right; }
.af-roleplay :is(.af-scenario-details,.af-context-details,.af-model,.sf-trace-io)>summary::-webkit-details-marker { display:none; }
.af-roleplay :is(.af-scenario-details,.af-context-details,.af-model,.sf-trace-io)>summary::before { content:''; flex:0 0 7px; width:7px; height:7px; margin:0 4px; border:solid currentColor; border-width:0 2px 2px 0; transform:rotate(-45deg); }
.af-roleplay :is(.af-scenario-details,.af-context-details,.af-model,.sf-trace-io)[open]>summary::before { transform:rotate(45deg); }
.af-roleplay-workspace { display:flex; flex:1; flex-direction:column; min-width:0; min-height:0; }
.af-roleplay .af-lab-head { min-height:48px; flex-shrink:0; }
.af-roleplay .af-lab-head>.af-caption { margin:0 0 0 auto; font-size:12px; }
.af-roleplay .af-lab-scroll,.af-roleplay .af-evidence { overscroll-behavior:contain; scrollbar-width:auto; }
.af-roleplay .af-caption { font-size:12px; }
.af-roleplay .af-message { max-width:94%; }
.af-roleplay .af-message-text { font-size:14px; }
.af-roleplay .af-message-meta,.af-roleplay .af-chip { font-size:12px; }
.af-roleplay .af-message.is-selected .af-message-text { box-shadow:none; border-color:var(--sf-accent); }
.af-roleplay :is(.af-view-trace,.af-turn-nav button,.af-setup-toggle,.af-setup-head button,.af-statusbar .af-text-button,.sf-trace-toggle,.af-mobile-tabs button) { display:inline-flex; gap:7px; align-items:center; justify-content:center; font:inherit; font-size:12px; font-weight:550; color:var(--sf-text); background:var(--sf-surface); border:1px solid var(--sf-border); border-radius:6px; padding:6px 10px; min-height:34px; box-sizing:border-box; cursor:pointer; }
.af-roleplay .af-view-trace { margin-top:8px; color:var(--sf-accent); }
.af-roleplay .af-view-trace[aria-pressed=true],.af-roleplay .af-mobile-tabs button[aria-pressed=true] { color:var(--sf-accent); background:var(--sf-soft); border-color:var(--sf-accent); }
.af-roleplay :is(.af-view-trace,.af-turn-nav button)>span { font-size:22px; line-height:1; }
.af-turn-nav { display:flex; gap:5px; margin-left:auto; }
.af-roleplay .af-seg button { min-height:34px; font-size:12px; color:var(--sf-text); }
.af-roleplay .af-stop { min-height:36px; color:var(--sf-danger); background:color-mix(in srgb,var(--sf-danger) 8%,var(--sf-surface)); border-color:var(--sf-danger); font-size:13px; padding:7px 14px; }
.af-roleplay .af-statusbar { flex-shrink:0; flex-wrap:wrap; font-size:12px; gap:8px; }
.af-roleplay .af-statusbar .af-status,.af-roleplay .af-elapsed { font-size:12px; }
.af-roleplay .af-evidence-empty,.af-roleplay .af-ev-pending { font-size:13px; }
.af-roleplay .af-ev-turn h4 { font-size:12px; }
.af-selected-question { margin:2px 0 12px; line-height:1.6; overflow-wrap:anywhere; color:var(--sf-muted); }
.af-roleplay .af-ev-plan { font-size:11px; }
.af-roleplay .af-raw { font-size:12px; }
.af-roleplay .sf-trace { font-size:13px; padding:12px; }
.af-roleplay .sf-trace-steps { max-height:none; overflow:visible; }
.af-roleplay .sf-trace-row { min-height:34px; }
.af-roleplay :is(.sf-trace-kind,.sf-trace-line,.sf-trace-note) { font-size:12px; }
.af-roleplay .sf-trace-label { flex-wrap:wrap; }
.af-roleplay .sf-trace-name { white-space:normal; overflow-wrap:anywhere; }
.af-roleplay .sf-trace-io { font-size:13px; }
.af-roleplay .sf-trace-io summary { display:flex; align-items:center; gap:10px; min-height:40px; list-style:none; color:var(--sf-text); }
.af-roleplay .sf-trace-io pre { font-size:12px; }
.af-roleplay :is(button,summary):focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.af-roleplay button:not(:disabled):hover { filter:brightness(.95); }
.af-roleplay[data-narrow=true] .af-setup { position:absolute; top:0; bottom:0; left:0; width:100%; box-sizing:border-box; z-index:40; box-shadow:8px 0 32px color-mix(in srgb,var(--sf-text) 15%,transparent); }
.af-setup-backdrop { position:absolute; inset:0; background:color-mix(in srgb,var(--sf-text) 25%,transparent); z-index:35; }
.af-mobile-tabs { display:flex; gap:6px; padding:8px 12px; border-bottom:1px solid var(--sf-border); }
.af-roleplay-workspace[data-compact=true] .sf-pane-divider { display:none; }
.af-roleplay-workspace[data-compact=true] .af-lab-left,.af-roleplay-workspace[data-compact=true] .af-lab-right { flex:1; }
.af-roleplay-workspace[data-compact=true][data-pane=conversation] .af-lab-right,.af-roleplay-workspace[data-compact=true][data-pane=trace] .af-lab-left { display:none; }

@media (prefers-reduced-motion:reduce) { .af-step.is-cur i,.af-typing i,.af-dot,.af-ev-pending::before { animation:none; } }
`;
