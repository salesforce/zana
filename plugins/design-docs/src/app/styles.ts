/**
 * Design Docs styles. Every colour is a Zana token, so the panel follows the
 * active theme (light, dark, or a plugin theme) without its own palette.
 */
export const DESIGN_DOCS_STYLES = `
.dd-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 13px;
}
.dd-root *, .dd-root *::before, .dd-root *::after,
.dd-dialog-backdrop *, .dd-context-menu * { box-sizing: border-box; }
.dd-root button, .dd-dialog-backdrop button, .dd-context-menu button { font: inherit; color: inherit; }
.dd-root :focus-visible, .dd-dialog-backdrop :focus-visible, .dd-context-menu :focus-visible { outline: 2px solid var(--focus-ring, var(--accent-blue)); outline-offset: 1px; }
.dd-spacer { flex: 1 1 auto; min-width: 0; }
.dd-muted { color: var(--text-muted); }
.dd-center { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-height: 120px; padding: 16px; }
.dd-spin { animation: dd-spin 0.9s linear infinite; }
@keyframes dd-spin { to { transform: rotate(360deg); } }
.dd-spinner { display: inline-flex; color: var(--text-muted); }
.dd-section-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dd-count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10.5px;
  line-height: 16px;
  text-align: center;
}
.dd-root code, .dd-pop code, .dd-dialog code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.92em; }
.dd-root kbd {
  padding: 0 4px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

/* ── Inputs ─────────────────────────────────────────────────────────── */
.dd-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-base));
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
}
.dd-input:focus { outline: none; border-color: var(--accent-blue); box-shadow: 0 0 0 1px var(--accent-blue); }
.dd-input::placeholder { color: var(--text-dim); }
.dd-select { appearance: auto; padding: 5px 6px; }
.dd-check { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; cursor: pointer; }
.dd-check code { color: var(--text-primary); }
.dd-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 0; }
.dd-field-row { display: flex; gap: 12px; }
.dd-field-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-primary); }
.dd-field-help { margin: 8px 0 0; font-size: 12px; }
.dd-field-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
.dd-field-inline .dd-select { width: auto; max-width: 180px; }
.dd-form { display: flex; flex-direction: column; gap: 14px; }

.dd-segmented {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-base);
}
.dd-segmented button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.dd-segmented button:hover:not(:disabled) { color: var(--text-primary); }
.dd-segmented button.on { background: var(--bg-elevated); color: var(--text-primary); box-shadow: 0 0 0 1px var(--border); }
.dd-segmented button:disabled { opacity: 0.4; cursor: default; }
.dd-btn-danger.btn.primary { background: var(--danger); border-color: var(--danger); }
.dd-icon-btn { flex: 0 0 auto; background: transparent; cursor: pointer; }
.dd-icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dd-icon-btn.danger:hover:not(:disabled) { color: var(--danger); }
.dd-icon-btn:disabled { opacity: 0.35; cursor: default; }

/* ── Banners, empty states ──────────────────────────────────────────── */
.dd-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 12px;
}
.dd-banner-text { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dd-banner-warn { background: color-mix(in srgb, var(--accent-gold) 12%, var(--bg-panel)); border-color: color-mix(in srgb, var(--accent-gold) 35%, var(--border)); }
.dd-banner-warn > svg { color: var(--accent-gold); }
.dd-banner-error { margin: 8px; border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border)); border-radius: 6px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, var(--bg-panel)); }
.dd-banner-info > svg { color: var(--accent-blue); }
.dd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 18px;
  text-align: center;
  color: var(--text-muted);
}
.dd-empty-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: 4px;
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text-muted);
}
.dd-empty-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.dd-empty-body { max-width: 280px; font-size: 12px; line-height: 1.5; }

/* ── Status, actors, time ───────────────────────────────────────────── */
.dd-status {
  --dd-status: var(--text-muted);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dd-status) 14%, transparent);
  color: var(--dd-status);
  font-size: 11.5px;
  font-weight: 550;
  white-space: nowrap;
}
.dd-status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dd-status-compact { height: 18px; padding: 0 6px; font-size: 10.5px; }
.dd-status-review { --dd-status: var(--accent-gold); }
.dd-status-approved { --dd-status: var(--success); }
.dd-status-implemented { --dd-status: var(--accent-blue); }
.dd-status-archived { --dd-status: var(--text-dim); }
.dd-status-button { padding: 0; border: 0; background: none; cursor: pointer; border-radius: 999px; }
.dd-status-button:hover .dd-status { filter: brightness(1.15); }
.dd-actor { display: inline-flex; align-items: center; gap: 4px; min-width: 0; color: var(--text-muted); }
.dd-actor-agent { color: var(--accent-blue); }
.dd-actor-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.dd-time { color: var(--text-dim); white-space: nowrap; font-size: 11.5px; }
.dd-file-icon { flex: 0 0 auto; color: var(--text-muted); }
.dd-kind-mermaid, .dd-kind-svg { color: var(--accent-blue); }
.dd-kind-html { color: var(--accent-gold); }
.dd-kind-image { color: var(--success); }

/* ── Popovers, menus, dialogs ───────────────────────────────────────── */
.dd-pop-anchor { position: relative; display: inline-flex; flex: 0 0 auto; }
.dd-pop {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 40;
  min-width: 200px;
  padding: 4px;
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  font-size: 13px;
}
.dd-context-menu { position: fixed; z-index: 60; }
.dd-pop-end { right: 0; }
.dd-pop-start { left: 0; }
.dd-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.dd-menu-item:hover { background: var(--bg-hover); }
.dd-menu-item > svg { color: var(--text-muted); flex: 0 0 auto; }
.dd-menu-label { flex: 1 1 auto; min-width: 0; }
.dd-menu-hint { color: var(--text-dim); font-size: 11.5px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-menu-danger, .dd-menu-danger > svg { color: var(--danger); }
.dd-menu-checked { background: color-mix(in srgb, var(--accent-blue) 12%, transparent); }
.dd-menu-section { padding: 6px 8px 2px; font-size: 10.5px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); }

.dd-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}
.dd-dialog {
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  max-height: min(760px, 100%);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 10px;
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  font-size: 13px;
}
.dd-dialog-wide { width: min(680px, 100%); }
.dd-dialog-header { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--border); }
.dd-dialog-title { flex: 1 1 auto; font-size: 14px; font-weight: 600; }
.dd-dialog-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px; }
.dd-dialog-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
.dd-dialog-hint { font-size: 12px; }
.dd-confirm-body { line-height: 1.55; }

/* ── Workbench: list | doc ──────────────────────────────────────────── */
.dd-workbench { flex-direction: row; }
.dd-list {
  display: flex;
  flex-direction: column;
  flex: 0 0 280px;
  width: 280px;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-base);
}
.dd-list-head, .dd-picker-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
}
.dd-list-title { font-size: 13px; font-weight: 650; }
.dd-list-count { color: var(--text-dim); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dd-list-collapsed {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 40px;
  width: 40px;
  gap: 4px;
  padding: 8px 0;
  border-right: 1px solid var(--border);
  background: var(--bg-base);
}
.dd-new { height: 26px; padding: 0 10px; }
.dd-list-tools { display: flex; align-items: center; gap: 4px; padding: 8px 8px 6px 10px; }
.dd-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  color: var(--text-dim);
}
.dd-search:focus-within { border-color: var(--accent-blue); }
.dd-search input { flex: 1 1 auto; min-width: 0; border: 0; outline: none; background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; }
.dd-search-clear { display: grid; place-items: center; padding: 2px; border: 0; border-radius: 4px; background: none; color: var(--text-muted); cursor: pointer; }
.dd-list-filters { display: flex; align-items: center; gap: 2px; padding: 0 8px 6px 6px; }
.dd-workbench .dd-pick {
  display: inline-flex;
  flex: 0 1 auto;
  width: fit-content;
  max-width: 160px;
  min-width: 0;
  height: 24px;
  gap: 4px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
}
.dd-workbench .dd-pick:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.dd-workbench .dd-pick.on { color: var(--accent-blue); background: color-mix(in srgb, var(--accent-blue) 10%, transparent); }
.dd-workbench .dd-pick > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-pick-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dd-pick-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-pick-count { flex: 0 0 auto; color: var(--text-dim); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dd-list-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 6px 12px; }
.dd-list-empty { padding: 20px 10px; text-align: center; font-size: 12px; }
.dd-doc-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  margin-bottom: 2px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dd-doc-row:hover { background: var(--bg-hover); }
.dd-doc-row.on { background: var(--bg-elevated); border-color: var(--border); }
.dd-doc-row-top { display: flex; align-items: flex-start; gap: 8px; }
.dd-doc-row-title { flex: 1 1 auto; min-width: 0; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
.dd-doc-row-summary {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.dd-doc-row-meta { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 11.5px; }
.dd-doc-row-meta > span { display: inline-flex; align-items: center; gap: 3px; }
.dd-doc-row-meta > span.dd-doc-row-project { display: block; flex: 0 1 auto; min-width: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
.dd-doc-row-comments { color: var(--accent-gold); }
.dd-main { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }

/* ── Landing ────────────────────────────────────────────────────────── */
.dd-landing { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dd-landing-inner { max-width: 760px; margin: 0 auto; padding: 56px 32px 48px; }
.dd-landing-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 18px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent-blue) 16%, var(--bg-elevated));
  color: var(--accent-blue);
}
.dd-landing-title { margin: 0 0 10px; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; color: var(--text-bright, var(--text-primary)); }
.dd-landing-lede { margin: 0 0 18px; max-width: 620px; color: var(--text-muted); font-size: 14px; line-height: 1.6; }
.dd-landing-points { display: flex; flex-direction: column; gap: 8px; margin: 0 0 32px; padding: 0; list-style: none; color: var(--text-muted); }
.dd-landing-points li { display: flex; align-items: baseline; gap: 8px; line-height: 1.5; }
.dd-landing-points svg { flex: 0 0 auto; position: relative; top: 2px; color: var(--accent-blue); }
.dd-landing-points strong { color: var(--text-primary); }
.dd-landing-start { display: flex; flex-direction: column; gap: 10px; }
.dd-templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.dd-template {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  text-align: left;
  cursor: pointer;
}
.dd-template:hover { border-color: var(--border-strong, var(--border)); background: var(--bg-hover); }
.dd-template.on { border-color: var(--accent-blue); box-shadow: 0 0 0 1px var(--accent-blue); }
.dd-template-label { font-weight: 600; }
.dd-template-desc { color: var(--text-muted); font-size: 12px; line-height: 1.45; }
.dd-template-files { margin-top: 2px; color: var(--text-dim); font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; }

/* ── Doc ────────────────────────────────────────────────────────────── */
.dd-doc { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.dd-doc-header { flex: 0 0 auto; padding: 12px 16px 10px 20px; border-bottom: 1px solid var(--border); }
.dd-doc-header-compact { padding: 8px 8px 8px 12px; }
.dd-doc-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dd-doc-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; min-width: 0; }
.dd-doc-project { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 12px; }
.dd-doc-updated { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.dd-editable {
  display: block;
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px;
  margin-left: -6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: text;
  overflow-wrap: anywhere;
}
.dd-editable:hover { border-color: var(--border); background: var(--bg-elevated); }
.dd-editable-empty { color: var(--text-dim); font-style: italic; }
.dd-editable-input {
  min-width: 0;
  flex: 1 1 auto;
  margin-left: -6px;
  padding: 2px 6px;
  border: 1px solid var(--accent-blue);
  border-radius: 6px;
  outline: none;
  background: var(--bg-input, var(--bg-base));
  color: var(--text-primary);
  font: inherit;
  resize: none;
}
.dd-doc-title { font-size: 18px; font-weight: 650; line-height: 1.3; letter-spacing: -0.01em; color: var(--text-bright, var(--text-primary)); flex: 0 1 auto; }
.dd-doc-header-compact .dd-doc-title { font-size: 14px; }
input.dd-doc-title { width: 100%; }
.dd-doc-summary { margin-top: 2px; color: var(--text-muted); font-size: 13px; line-height: 1.5; width: 100%; }
textarea.dd-doc-summary { display: block; }
.dd-tags { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.dd-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
}
.dd-tag-add { border-style: dashed; cursor: pointer; }
.dd-tag-add:hover { color: var(--text-primary); }
/* Collapsed, not display:none, so keyboard users can still tab to it. */
.dd-tag-remove { display: inline-flex; width: 0; overflow: hidden; opacity: 0; padding: 0; margin-left: 0; border: 0; background: none; color: inherit; cursor: pointer; }
.dd-tag:hover .dd-tag-remove, .dd-tag-remove:focus-visible { width: 10px; margin-left: 2px; opacity: 1; }
.dd-tag-input { width: 140px; height: 22px; padding: 0 6px; font-size: 12px; }
.dd-doc-body { position: relative; display: flex; flex: 1 1 auto; min-height: 0; }

/* Ask agent */
.dd-ask-trigger { height: 28px; padding: 0 10px; }
.dd-ask-compact { padding: 0 8px; gap: 4px; }
.dd-ask { width: 360px; padding: 0; }
.dd-ask-head { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px 8px; }
.dd-ask-head .dd-muted { font-size: 12px; }
.dd-ask-title { font-weight: 650; }
.dd-ask-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 0 8px 8px; }
.dd-ask-action {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-panel);
  text-align: left;
  cursor: pointer;
}
.dd-ask-action:hover:not(:disabled) { border-color: var(--accent-blue); background: color-mix(in srgb, var(--accent-blue) 8%, var(--bg-panel)); }
.dd-ask-action:disabled { opacity: 0.6; cursor: default; }
.dd-ask-action-icon { display: grid; place-items: center; flex: 0 0 auto; width: 22px; height: 22px; border-radius: 6px; background: color-mix(in srgb, var(--accent-blue) 14%, transparent); color: var(--accent-blue); }
.dd-ask-action-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dd-ask-action-label { font-size: 12.5px; font-weight: 600; }
.dd-ask-action-desc { color: var(--text-muted); font-size: 11px; line-height: 1.35; }
.dd-ask-custom { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-top: 1px solid var(--border); }
.dd-ask-options { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }

/* ── File tree ──────────────────────────────────────────────────────── */
.dd-tree { display: flex; flex-direction: column; flex: 0 0 220px; width: 220px; min-height: 0; border-right: 1px solid var(--border); background: var(--bg-base); }
.dd-tree-head { display: flex; align-items: center; gap: 4px; height: 36px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--border); }
.dd-tree-count { color: var(--text-dim); font-size: 11px; }
.dd-tree-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 4px 12px; }
.dd-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-height: 26px;
  padding-right: 2px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
}
.dd-tree-folder { gap: 5px; color: var(--text-muted); cursor: pointer; }
.dd-tree-folder:hover, .dd-tree-file:hover { background: var(--bg-hover); }
.dd-tree-file.on { background: color-mix(in srgb, var(--accent-blue) 16%, transparent); }
.dd-tree-file.on .dd-tree-name { color: var(--text-bright, var(--text-primary)); font-weight: 550; }
.dd-tree-open { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; height: 26px; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
.dd-tree-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-tree-entry { flex: 0 0 auto; color: var(--text-dim); }
.dd-tree-badge { flex: 0 0 auto; margin-left: auto; min-width: 16px; padding: 0 4px; border-radius: 999px; background: color-mix(in srgb, var(--accent-gold) 22%, transparent); color: var(--accent-gold); font-size: 10px; line-height: 15px; text-align: center; }
.dd-tree-row .dd-pop-anchor { visibility: hidden; }
.dd-tree-row:hover .dd-pop-anchor, .dd-tree-row:focus-within .dd-pop-anchor, .dd-tree-row .dd-pop-anchor:has(.dd-pop) { visibility: visible; }
.dd-tree-row .icon-btn { width: 22px; height: 22px; }
.dd-tree-input { flex: 1 1 auto; padding: 2px 0; }
.dd-tree-input .dd-input { height: 24px; padding: 0 6px; font-size: 12.5px; }
.dd-switcher-pop { padding: 0; width: 280px; max-height: 60vh; display: flex; }
.dd-switcher-pop .dd-tree { flex: 1 1 auto; width: auto; border: 0; border-radius: 8px; max-height: 60vh; }
.dd-switcher {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-base);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.dd-switcher:hover { color: var(--text-primary); }

/* ── File pane ──────────────────────────────────────────────────────── */
.dd-file-pane { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.dd-file-toolbar { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; height: 36px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--border); min-width: 0; }
.dd-file-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
.dd-file-dir { color: var(--text-dim); }
.dd-file-name { color: var(--text-primary); font-weight: 550; }
.dd-file-meta { display: inline-flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; white-space: nowrap; color: var(--text-dim); font-size: 11.5px; }
.dd-flash {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-blue) 16%, transparent);
  color: var(--accent-blue);
  font-size: 11.5px;
  white-space: nowrap;
  animation: dd-flash-in 0.25s ease-out;
}
@keyframes dd-flash-in { from { opacity: 0; transform: translateY(-3px); } }
.dd-file-body { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-doc-compact .dd-file-meta, .dd-doc-compact .dd-mode-label { display: none; }
.dd-preview-html, .dd-preview-image { overflow: hidden; }
.dd-preview-image .dd-image-stage { height: 100%; overflow: auto; }

/* Preview */
.dd-preview { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; }
.dd-prose { max-width: 860px; margin: 0 auto; padding: 28px 40px 96px; }
.dd-doc-compact .dd-prose { padding: 16px 16px 64px; }
.dd-prose .inbox-md { font-size: 14px; line-height: 1.7; }
.dd-prose .inbox-md h1 { margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border); font-size: 26px; line-height: 1.25; letter-spacing: -0.015em; color: var(--text-bright, var(--text-primary)); }
.dd-prose .inbox-md h2 { margin: 32px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); font-size: 19px; line-height: 1.3; color: var(--text-bright, var(--text-primary)); }
.dd-prose .inbox-md h3 { margin: 24px 0 8px; font-size: 15.5px; }
.dd-prose .inbox-md h4 { margin: 18px 0 6px; font-size: 14px; color: var(--text-muted); }
.dd-prose .inbox-md p, .dd-prose .inbox-md ul, .dd-prose .inbox-md ol { margin: 0 0 14px; }
.dd-prose .inbox-md li { margin: 3px 0; }
.dd-prose .inbox-md blockquote { margin: 0 0 14px; padding: 6px 14px; border-left: 3px solid var(--accent-blue); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--accent-blue) 6%, transparent); color: var(--text-muted); }
.dd-prose .inbox-md table { font-size: 13px; }
.dd-prose .inbox-md img { max-width: 100%; border-radius: 6px; }
.dd-prose .inbox-md input[type='checkbox'] { margin-right: 6px; }
.dd-prose-mermaid, .dd-prose-code { max-width: none; }
.dd-prose-mermaid .inbox-md pre:has(svg), .dd-prose-mermaid .inbox-md svg { background: transparent; }
.dd-plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; line-height: 1.6; }
.dd-image-stage {
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 32px;
  background-color: var(--bg-base);
  background-image: linear-gradient(45deg, var(--bg-hover) 25%, transparent 25%, transparent 75%, var(--bg-hover) 75%), linear-gradient(45deg, var(--bg-hover) 25%, transparent 25%, transparent 75%, var(--bg-hover) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}
.dd-image-stage img { max-width: 100%; max-height: 100%; border-radius: 4px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2); }
.dd-html-stage { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dd-html-toolbar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 4px 8px; border-bottom: 1px solid var(--border); background: var(--bg-base); }
.dd-html-status { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.dd-html-widths { display: inline-flex; gap: 2px; }
.dd-html-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
.dd-html-viewport { position: relative; display: flex; justify-content: center; flex: 1 1 auto; min-height: 0; overflow: auto; background: var(--bg-base); }
.dd-page-badge { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--accent-gold) 40%, var(--border)); border-radius: 12px; background: color-mix(in srgb, var(--accent-gold) 12%, transparent); color: var(--text-primary); font-size: 12px; font-variant-numeric: tabular-nums; cursor: pointer; }
.dd-page-badge svg { color: var(--accent-gold); }
.dd-page-badge:hover { background: color-mix(in srgb, var(--accent-gold) 20%, transparent); }
.dd-page-problems { width: min(440px, 80vw); max-height: 320px; overflow: auto; }
.dd-page-problems ul { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.dd-page-problem { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; padding: 6px 8px; border-radius: 5px; font-size: 12px; line-height: 1.45; }
.dd-page-problem:hover { background: var(--bg-hover); }
.dd-page-problem-kind { grid-row: span 2; align-self: start; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--bg-hover); }
.dd-page-problem-error .dd-page-problem-kind { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.dd-page-problem-missing .dd-page-problem-kind { color: var(--accent-gold); background: color-mix(in srgb, var(--accent-gold) 14%, transparent); }
.dd-page-problem-blocked .dd-page-problem-kind { color: var(--accent-blue); background: color-mix(in srgb, var(--accent-blue) 12%, transparent); }
.dd-page-problem-message { overflow-wrap: anywhere; }
.dd-page-problem-source { grid-column: 2; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; overflow-wrap: anywhere; }
.dd-html-frame { flex: 1 1 auto; width: 100%; height: 100%; min-height: 360px; border: 0; background: var(--bg-panel); }
.dd-html-frame-device { flex: 0 0 auto; margin: 16px; height: calc(100% - 32px); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25); }

/* Comment highlights (CSS Custom Highlight API) */
::highlight(dd-comment) { background-color: color-mix(in srgb, var(--accent-gold) 28%, transparent); text-decoration: underline; text-decoration-color: var(--accent-gold); text-decoration-thickness: 2px; }
::highlight(dd-comment-focus) { background-color: color-mix(in srgb, var(--accent-gold) 55%, transparent); }

.dd-selection-chip {
  position: absolute;
  z-index: 20;
  display: flex;
  gap: 2px;
  padding: 3px;
  transform: translateX(-50%);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
.dd-selection-chip button { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; font-size: 12px; white-space: nowrap; cursor: pointer; }
.dd-selection-chip button:hover { background: var(--bg-hover); }
.dd-selection-chip svg { color: var(--accent-blue); }

/* Editor */
.dd-editor { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-editor-body { display: flex; flex: 1 1 auto; min-height: 0; }
.dd-editor-input {
  flex: 1 1 0;
  min-width: 0;
  padding: 20px 24px 64px;
  border: 0;
  outline: none;
  resize: none;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  line-height: 1.65;
  tab-size: 2;
}
.dd-editor-split .dd-editor-input { border-right: 1px solid var(--border); background: var(--bg-base); }
.dd-editor-preview { display: flex; flex: 1 1 0; min-width: 0; min-height: 0; }
.dd-editor-preview .dd-prose { padding: 20px 28px 64px; }
.dd-editor-footer { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; height: 40px; padding: 0 10px 0 14px; border-top: 1px solid var(--border); }
.dd-editor-state { display: inline-flex; align-items: center; gap: 6px; flex: 1 1 auto; color: var(--text-muted); font-size: 12px; }
.dd-editor-hint { color: var(--text-dim); font-size: 11.5px; }
.dd-editor-footer .btn { height: 26px; }

/* Revision view + diff */
.dd-revision { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-revision-banner { flex: 0 0 auto; }
.dd-revision-note { color: var(--text-muted); }
.dd-revision-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: auto; }
.dd-revision-hint { margin: 12px 16px 0; font-size: 12px; }
.dd-diff { padding: 12px 0 48px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; line-height: 1.6; }
.dd-diff-stats { display: flex; gap: 10px; padding: 0 16px 10px; font-size: 12px; }
.dd-diff-added { color: var(--success); }
.dd-diff-removed { color: var(--danger); }
.dd-diff-line { display: flex; padding: 0 16px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dd-diff-sign { flex: 0 0 28px; text-align: center; color: var(--text-dim); user-select: none; }
.dd-diff-text { flex: 1 1 auto; min-width: 0; }
.dd-diff-add { background: color-mix(in srgb, var(--success) 13%, transparent); }
.dd-diff-add .dd-diff-sign { color: var(--success); }
.dd-diff-del { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.dd-diff-del .dd-diff-sign { color: var(--danger); }
.dd-diff-del .dd-diff-text { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.dd-diff-gap { margin: 4px 0; padding: 2px 16px 2px 28px; background: var(--bg-base); color: var(--text-dim); font-size: 11.5px; }

/* ── Rail ───────────────────────────────────────────────────────────── */
.dd-rail { display: flex; flex-direction: column; flex: 0 0 320px; width: 320px; min-height: 0; border-left: 1px solid var(--border); background: var(--bg-base); }
.dd-rail.dd-rail-chat { flex-basis: 420px; width: 420px; }
.dd-rail-floating .dd-rail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 15; width: min(340px, 100%); box-shadow: -12px 0 32px rgba(0, 0, 0, 0.25); }
.dd-rail-floating .dd-rail.dd-rail-chat { width: min(420px, 100%); }
.dd-rail-tabs { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; height: 36px; padding: 0 6px; border-bottom: 1px solid var(--border); }
.dd-rail-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.dd-rail-tab:hover { color: var(--text-primary); }
.dd-rail-tab.on { background: var(--bg-elevated); color: var(--text-primary); box-shadow: 0 0 0 1px var(--border); }
.dd-rail-pane { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-rail-toolbar { display: flex; align-items: center; padding: 8px 10px 4px; }
.dd-rail-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 10px 12px; }

.dd-comment { margin-bottom: 8px; padding: 9px 10px 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
.dd-comment-resolved { opacity: 0.7; }
.dd-comment-head { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.dd-comment-head .icon-btn { width: 22px; height: 22px; }
.dd-comment-anchor { display: flex; flex-direction: column; gap: 3px; width: 100%; margin: 6px 0 2px; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
.dd-comment-anchor:disabled { cursor: default; }
.dd-comment-path { color: var(--text-dim); font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; }
.dd-comment-path-gone { font-style: italic; }
.dd-comment-quote {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  padding-left: 8px;
  border-left: 2px solid var(--accent-gold);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.dd-comment-anchor:hover:not(:disabled) .dd-comment-quote { color: var(--text-primary); }
.dd-comment-body .inbox-md { font-size: 12.5px; line-height: 1.55; }
.dd-comment-body .inbox-md p { margin: 4px 0 6px; }
.dd-replies { margin: 2px 0 6px; padding: 0 0 0 10px; border-left: 1px solid var(--border); list-style: none; }
.dd-reply { padding: 4px 0 0; }
.dd-reply .dd-comment-head { font-size: 11.5px; }
.dd-reply .icon-btn { width: 20px; height: 20px; }
.dd-reply-composer { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
.dd-reply-composer .dd-composer-input { min-height: 48px; }
.dd-reply-buttons { display: inline-flex; gap: 6px; }
.dd-resolved { margin-top: 8px; }
.dd-disclosure { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 6px; padding: 2px 0; border: 0; background: none; color: var(--text-muted); font-size: 12px; cursor: pointer; }
.dd-composer { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; padding: 10px; border-top: 1px solid var(--border); }
.dd-composer-quote { display: flex; align-items: flex-start; gap: 4px; }
.dd-composer-quote .dd-comment-quote { flex: 1 1 auto; }
.dd-composer-input { min-height: 64px; font-size: 12.5px; }
.dd-composer-actions { display: flex; align-items: center; justify-content: space-between; }
.dd-composer-actions .btn { height: 26px; }

.dd-history-list { margin: 0; padding: 0; list-style: none; }
.dd-history-row { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; }
.dd-history-row:hover { background: var(--bg-hover); }
.dd-history-row.on { background: color-mix(in srgb, var(--accent-blue) 14%, transparent); }
.dd-op { flex: 0 0 auto; margin-top: 2px; color: var(--text-muted); }
.dd-op-create { color: var(--success); }
.dd-op-delete { color: var(--danger); }
.dd-op-rename { color: var(--accent-gold); }
.dd-history-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dd-history-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; font-size: 12.5px; font-weight: 550; }
.dd-history-path { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px; font-weight: 400; color: var(--text-muted); overflow-wrap: anywhere; }
.dd-history-rev { color: var(--text-dim); font-size: 11px; font-weight: 400; }
.dd-history-note { color: var(--text-muted); font-size: 12px; }
.dd-history-meta { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }

.dd-agent-chat-head { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; height: 36px; padding: 0 6px; border-bottom: 1px solid var(--border); }
.dd-agent-chat-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; }
.dd-agent-chat-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.dd-agent-chat-body > * { flex: 1 1 auto; min-height: 0; }
.dd-thread-list { margin: 0 0 12px; padding: 0; list-style: none; }
.dd-thread { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; padding-right: 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
.dd-thread-open { display: flex; align-items: flex-start; gap: 8px; flex: 1 1 auto; min-width: 0; padding: 8px 10px; border: 0; background: none; text-align: left; cursor: pointer; }
.dd-thread-open > svg { flex: 0 0 auto; margin-top: 2px; color: var(--accent-blue); }
.dd-thread-open:hover .dd-thread-title { color: var(--accent-blue); }
.dd-thread-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dd-thread-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.dd-thread-meta { display: flex; align-items: center; gap: 6px; }
.dd-role { padding: 0 6px; border-radius: 999px; background: var(--bg-hover); color: var(--text-muted); font-size: 10.5px; line-height: 16px; }
.dd-role-reviewer { background: color-mix(in srgb, var(--accent-gold) 18%, transparent); color: var(--accent-gold); }
.dd-role-editor, .dd-role-author { background: color-mix(in srgb, var(--accent-blue) 16%, transparent); color: var(--accent-blue); }
.dd-agents-hint { display: flex; gap: 8px; padding: 10px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.dd-agents-hint > svg { flex: 0 0 auto; margin-top: 2px; }

/* ── Thread panel ───────────────────────────────────────────────────── */
.dd-picker { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dd-picker .dd-list-scroll { padding-top: 6px; }

/* ── Chat card ──────────────────────────────────────────────────────── */
.dd-card-icon { display: grid; place-items: center; flex: 0 0 auto; width: 24px; height: 24px; border-radius: 6px; background: color-mix(in srgb, var(--accent-blue) 16%, transparent); color: var(--accent-blue); }
.dd-card-meta { display: inline-flex; align-items: center; gap: 6px; }
.dd-card-meta code { color: var(--text-muted); font-size: 11.5px; }

/* ── Narrow workbench ───────────────────────────────────────────────── */
@media (max-width: 900px) {
  .dd-list { flex-basis: 220px; width: 220px; }
  .dd-tree { flex-basis: 180px; width: 180px; }
  .dd-mode-label, .dd-file-meta { display: none; }
}
`;
