export const SALESFORCE_STATE_STYLES = `
.sf-state { --sf-state-accent:var(--accent,#5d91bf); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; min-width:0; width:100%; min-height:240px; padding:36px 22px; box-sizing:border-box; text-align:center; color:var(--text-primary); font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
.sf-state[data-compact] { min-height:180px; gap:14px; padding:24px 12px; font-size:12px; }
.sf-state-art { position:relative; flex:none; width:144px; height:104px; color:var(--sf-state-accent); }
.sf-state[data-compact] .sf-state-art { zoom:.8; }
.sf-state-orbit { position:absolute; width:112px; height:112px; top:-8px; left:16px; border:1px solid color-mix(in srgb,var(--sf-state-accent) 16%,transparent); border-radius:50%; background:radial-gradient(circle,color-mix(in srgb,var(--sf-state-accent) 7%,transparent),transparent 72%); }
.sf-state-window { position:absolute; top:16px; left:14px; width:108px; height:72px; overflow:hidden; box-sizing:border-box; border:1px solid color-mix(in srgb,var(--sf-state-accent) 24%,var(--border)); border-radius:9px; background:var(--bg-panel); box-shadow:0 5px 14px #00000008; transform:rotate(-5deg); }
.sf-state-window--back { top:9px; left:27px; background:var(--bg-elevated,var(--bg-panel)); transform:rotate(7deg); opacity:.65; }
.sf-state-window-bar { display:flex; align-items:center; gap:4px; height:19px; padding:0 8px; box-sizing:border-box; border-bottom:1px solid var(--border); }
.sf-state-window-bar i { width:3px; height:3px; border-radius:50%; background:var(--text-muted); opacity:.35; }
.sf-state-window-bar svg { width:12px; height:12px; margin-left:auto; opacity:.6; }
.sf-state-window-body { display:grid; gap:7px; padding:12px; }
.sf-state-window-body span { display:block; height:4px; border-radius:4px; background:color-mix(in srgb,var(--sf-state-accent) 28%,transparent); transform-origin:left; }
.sf-state-window-body span:nth-child(2) { width:76%; opacity:.7; }
.sf-state-window-body span:nth-child(3) { width:48%; opacity:.45; }
.sf-state[data-art=data] .sf-state-window-body { grid-template-columns:1fr 1fr 1fr; gap:5px; padding:12px 10px; }
.sf-state[data-art=data] .sf-state-window-body span { width:100%; height:22px; border-radius:3px; }
.sf-state-badge { position:absolute; right:0; bottom:0; display:grid; place-items:center; width:43px; height:43px; border-radius:14px; border:1px solid color-mix(in srgb,var(--sf-state-accent) 20%,var(--border)); background:var(--bg-panel); color:var(--sf-state-accent); box-shadow:0 0 0 5px var(--bg-panel); }
.sf-state-badge::before { content:''; position:absolute; inset:0; border-radius:inherit; background:color-mix(in srgb,var(--sf-state-accent) 8%,transparent); }
.sf-state-badge svg { position:relative; width:23px; height:23px; }
.sf-state-spark { position:absolute; width:4px; height:4px; border-radius:50%; background:currentColor; opacity:.25; }
.sf-state-spark--one { top:0; left:7px; }.sf-state-spark--two { right:1px; top:27px; width:6px; height:6px; }
.sf-state-copy { max-width:340px; min-width:0; overflow-wrap:anywhere; }
.sf-state-copy h3 { margin:0; color:var(--text-primary); font:600 14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; letter-spacing:-.15px; }
.sf-state-hint { margin-top:6px; color:var(--text-muted); text-wrap:pretty; }.sf-state-hint p { margin:0; }.sf-state-hint p+p { margin-top:6px; }
.sf-state-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; max-width:100%; }
.sf-state[data-kind=error] { --sf-state-accent:var(--text-muted); }
.sf-state[data-kind=loading] .sf-state-window-body span { animation:sf-state-line 1.8s ease-in-out infinite; }
.sf-state[data-kind=loading] .sf-state-window-body span:nth-child(2) { animation-delay:.15s; }
.sf-state[data-kind=loading] .sf-state-window-body span:nth-child(3) { animation-delay:.3s; }
.sf-state[data-kind=loading] .sf-state-badge::before { animation:sf-state-pulse 2.4s ease-in-out infinite; }
@keyframes sf-state-line { 0%,100% { opacity:.3; transform:scaleX(.72); } 50% { opacity:1; transform:scaleX(1); } }
@keyframes sf-state-pulse { 0%,100% { opacity:.4; } 50% { opacity:1; } }
@media (prefers-reduced-motion:reduce) { .sf-state[data-kind=loading] .sf-state-window-body span,.sf-state[data-kind=loading] .sf-state-badge::before { animation:none; } }
.sf-frame-stage { position:relative; display:flex; flex:1; min-height:0; width:100%; }
.sf-frame-stage>.sf-state { position:absolute; inset:0; z-index:1; height:100%; min-height:0; overflow:auto; background:var(--bg-panel); }
`;
