import type { StudioViewState } from '../../../lib/studio-contract.js';

/** Styles for the strip; AssistantRail includes them too. Only --sf-* tokens (studio-tokens.ts). */
export const CONTEXT_STRIP_STYLES = `
.sf-asst-ctx { display:flex; align-items:center; gap:8px; min-width:0; padding:6px 10px; border-bottom:1px solid var(--sf-border); background:var(--sf-bg); color:var(--sf-muted); font-size:11px; }
.sf-asst-ctx-text { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-asst-ctx-text strong { color:var(--sf-text); font-weight:600; }
.sf-asst-ctx-warn { color:var(--sf-warn); }
.sf-asst-ctx-off { opacity:.7; }
.sf-asst-ctx-toggle { display:inline-flex; align-items:center; gap:6px; flex-shrink:0; border:0; background:transparent; color:var(--sf-muted); font:inherit; cursor:pointer; padding:2px 0; }
.sf-asst-ctx-toggle:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-asst-ctx-track { position:relative; width:26px; height:14px; border-radius:7px; border:1px solid var(--sf-border); background:var(--sf-bg); transition:background .12s; }
.sf-asst-ctx-track::after { content:''; position:absolute; top:1px; left:1px; width:10px; height:10px; border-radius:50%; background:var(--sf-muted); transition:transform .12s, background .12s; }
.sf-asst-ctx-toggle[aria-checked=true] .sf-asst-ctx-track { background:var(--sf-accent); border-color:var(--sf-accent); }
.sf-asst-ctx-toggle[aria-checked=true] .sf-asst-ctx-track::after { transform:translateX(12px); background:var(--sf-bg); }
`;

/** What the agent can see, as short text parts (exported for tests). */
export function describeVisibleContext(view: StudioViewState): string[] {
  if (!view.share) return [];
  const parts = [view.path ? view.path.split('/').pop()! : 'unsaved draft'];
  if (view.dirty) parts.push('unsaved edits');
  if (view.selection) parts.push(`lines ${view.selection.startLine}-${view.selection.endLine}`);
  else if (view.cursor) parts.push(`line ${view.cursor.line}`);
  if (view.tool) parts.push(`${view.tool} tool`);
  const problems = view.diagnostics.filter(d => d.severity === 'error' || d.severity === 'warning').length;
  if (problems) parts.push(`${problems} problem${problems === 1 ? '' : 's'}`);
  if (view.lastRun) parts.push(`run ${view.lastRun.runId.slice(0, 8)}`);
  return parts;
}

export interface ContextStripProps {
  view: StudioViewState;
  compact?: boolean;
  onShareChange?(share: boolean): void;
}

/** "Agent sees: ..." strip. The share toggle is offered in compact mode (side panel) when a handler is given. */
export function ContextStrip({ view, compact = false, onShareChange }: ContextStripProps) {
  const parts = describeVisibleContext(view);
  const full = view.share ? parts.join(' · ') : 'nothing (sharing is off)';
  return <div className={`sf-asst-ctx${view.share ? '' : ' sf-asst-ctx-off'}`} data-compact={compact ? 'true' : 'false'} data-testid="studio-context-strip">
    <style>{CONTEXT_STRIP_STYLES}</style>
    <span className="sf-asst-ctx-text" title={`Agent sees: ${full}`}>Agent sees: <strong>{full}</strong></span>
    {compact && onShareChange && <button type="button" role="switch" aria-checked={view.share} aria-label="Share what I am viewing with the agent" className="sf-asst-ctx-toggle" onClick={() => onShareChange(!view.share)}>
      <span className="sf-asst-ctx-track" aria-hidden="true" />Share
    </button>}
  </div>;
}
