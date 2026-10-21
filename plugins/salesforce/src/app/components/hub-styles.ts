/** The global Salesforce page is a centered reading surface; tiles reflow to the panel width. */
export const HUB_STYLES = `
.sf-hub { width:100%; max-width:1040px; margin:0 auto; padding:28px 32px 40px; }
.sf-hub.sf-content > h3 { margin:28px 0 10px; font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); }
.sf-hub.sf-content > h3 + p { margin:-4px 0 10px; }
.sf-small { font-size:12px; }
.sf-hub-studio { display:flex; flex-direction:column; gap:14px; margin-top:20px; padding:20px; border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border)); border-radius:12px; background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 7%,var(--bg-panel)) 0%,var(--bg-panel) 65%); }
.sf-hub-studio-head { display:flex; align-items:center; gap:12px; }
.sf-hub-studio-head h3 { margin:0; font-size:16px; font-weight:600; }
.sf-hub-studio-icon { flex:none; width:40px; height:40px; display:grid; place-items:center; border-radius:10px; color:var(--text-on-accent,#fff); background:var(--accent); }
.sf-hub-studio-icon svg { width:20px; height:20px; }
.sf-hub-project { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; }
.sf-hub-project select { min-width:0; width:200px; max-width:100%; height:30px; padding:0 8px; color:var(--text-primary); border:1px solid var(--border); border-radius:6px; background:var(--bg-panel); }
.sf-hub-actions { display:flex; flex-wrap:wrap; gap:8px; }
.sf-hub-actions .sf-btn { max-width:100%; white-space:normal; }
.sf-hub-actions .sf-btn svg { width:15px; height:15px; }
.sf-hub-note { font-size:12.5px; padding:8px 10px; border:1px solid var(--border); border-radius:6px; background:var(--bg-elevated); }
.sf-hub-tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(190px,100%),1fr)); gap:10px; }
.sf-hub-tile { display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:14px; text-align:left; color:var(--text-primary); border:1px solid var(--border); border-radius:8px; background:var(--bg-panel); cursor:pointer; }
.sf-hub-tile:hover:not(:disabled) { transition:border-color .12s, background .12s; border-color:var(--accent); background:color-mix(in srgb,var(--accent) 4%,var(--bg-panel)); }
.sf-hub-tile:disabled { opacity:.5; cursor:default; }
.sf-hub-tile-icon { width:32px; height:32px; display:grid; place-items:center; border-radius:8px; background:var(--bg-elevated); }
.sf-hub-tile-icon svg { width:17px; height:17px; }
.sf-hub-recent { list-style:none; margin:0; padding:0; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
.sf-hub-recent li + li { border-top:1px solid var(--border); }
.sf-hub-recent button { width:100%; display:flex; align-items:center; gap:10px; padding:9px 14px; text-align:left; color:var(--text-primary); border:0; background:transparent; cursor:pointer; }
.sf-hub-recent button:hover { background:var(--bg-hover); }
.sf-hub-recent button > svg { width:15px; height:15px; flex:none; color:var(--text-muted); }
.sf-hub-recent strong { font-weight:550; }
.sf-hub-recent .sf-grow { min-width:0; overflow-wrap:anywhere; }
@container sf (max-width:560px) { .sf-hub { padding:20px 16px 32px; } }
@container sf (max-width:360px) { .sf-hub-studio { padding:14px; } .sf-hub-studio-head { flex-direction:column; align-items:flex-start; } }
`;
