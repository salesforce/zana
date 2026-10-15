export const ORG_PREVIEW_STYLES = `
.sf-org-preview { width:100%; min-width:0; box-sizing:border-box; overflow:hidden; }
.sf-org-preview .sf-as-header { flex-shrink:0; gap:8px; padding:10px 12px; }
.sf-org-preview-identity { display:flex; align-items:center; gap:8px; flex:1 1 240px; min-width:0; }
.sf-org-preview-identity .sf-as-brand { flex-shrink:0; }
.sf-org-preview-picker { min-width:0; max-width:100%; flex:1; }
.sf-org-preview-picker > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-org-preview-identity .af-brand-mark, .sf-org-preview-picker > svg { flex-shrink:0; }
.sf-org-preview-controls { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; min-width:0; max-width:100%; margin-left:auto; }
.sf-org-preview-org { display:flex; flex:0 1 auto; min-width:72px; max-width:210px; }
.sf-org-preview-org .sf-org-switcher { position:relative; display:flex; min-width:0; width:100%; height:30px; box-sizing:border-box; border:1px solid var(--sf-border); border-radius:6px; color:var(--sf-text); background:var(--sf-elevated); }
.sf-org-preview-org .sf-org-switcher:hover { background:var(--sf-soft); }
.sf-org-preview-org .sf-org-switcher:focus-within { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-org-preview-org .sf-org-switcher[data-disabled=true] { opacity:.55; }
.sf-org-preview-org .sf-org-switcher-label { display:flex; align-items:center; gap:6px; min-width:0; height:100%; padding:0 8px; pointer-events:none; }
.sf-org-preview-org .sf-org-switcher-label svg { flex-shrink:0; color:var(--sf-muted); }
.sf-org-preview-org .sf-org-switcher-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:550; }
.sf-org-preview-org .sf-org-switcher-kind { flex-shrink:0; font-size:10px; line-height:16px; padding:0 5px; border-radius:4px; color:var(--sf-muted); background:color-mix(in srgb,var(--sf-muted) 14%,transparent); text-transform:capitalize; }
.sf-org-preview-org .sf-org-switcher-kind[data-kind=production] { color:var(--sf-warn); background:color-mix(in srgb,var(--sf-warn) 12%,transparent); }
.sf-org-preview-org .sf-org-switcher>.sf-org-picker { position:absolute; inset:0; width:100%; height:100%; max-width:none; margin:0; padding:0; border:0; opacity:0; cursor:pointer; }
.sf-org-preview-org .sf-org-switcher>.sf-org-picker:disabled { cursor:default; }
.sf-org-preview .sf-as-body { min-width:0; }
.sf-org-preview .af-composer { flex-shrink:0; min-width:0; margin:10px 12px; box-sizing:border-box; }
.sf-org-preview .af-composer input { flex:1; min-width:0; width:0; color:var(--sf-text); }
.sf-org-preview .af-composer button { width:auto; min-width:58px; padding:0 12px; font-size:12px; font-weight:600; white-space:nowrap; }
.sf-org-preview .af-composer:focus-within { border-color:var(--sf-accent); }
.sf-org-preview .sf-as-banner { flex-shrink:0; overflow-wrap:anywhere; }
`;
