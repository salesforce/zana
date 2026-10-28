import { useState, type ReactNode } from 'react';
import { STUDIO_TOKENS } from './studio-tokens.js';
import { EXPLORER_WIDTH, clampExplorerWidth } from './studio-layout.js';
import { QuickOpen, type QuickOpenItem } from './QuickOpen.js';
import type { StudioLayout } from './useWidthTier.js';

/**
 * Layout skeleton of Salesforce Studio. Every slot is always rendered in the same position (an unused slot is `false`),
 * so switching between legacy / compact / wide never remounts the editor iframe in `children`.
 *
 *   legacy  tier not measured yet: today's editor + tools split, nothing else
 *   compact container < 620px: `top` (tool strip + context strip), one tool at a time, QuickOpen instead of an explorer
 *   wide    container >= 620px: `activity` bar, `explorer` column, editor/rail split
 *
 * The shell also owns the shortcuts that must work wherever focus is inside the Studio: Cmd/Ctrl+S saves, Cmd/Ctrl+P opens QuickOpen,
 * Cmd/Ctrl+B shows or hides the explorer (wide layout). The explorer's right edge resizes it (drag, arrow keys, double-click resets).
 */
export function StudioShell({ layout, tier, top, activity, explorer, explorerWidth, onExplorerWidth, children, quickOpen, quickItems, onQuickOpenChange, onQuickPick, onSave, onToggleExplorer }: {
  layout: StudioLayout;
  tier: number | null;
  top?: ReactNode;
  activity?: ReactNode;
  explorer?: ReactNode;
  /** Persisted explorer width; null is the default. */
  explorerWidth?: number | null;
  /** Commits a new width (null resets). Without it the column is not resizable. */
  onExplorerWidth?(width: number | null): void;
  children: ReactNode;
  quickOpen: boolean;
  quickItems: QuickOpenItem[];
  onQuickOpenChange(open: boolean): void;
  onQuickPick(item: QuickOpenItem): void;
  onSave(): void;
  onToggleExplorer?(): void;
}) {
  return <div className="sf-as-body sf-studio" data-layout={layout} data-tier={tier ?? undefined} data-local-shortcuts={onToggleExplorer ? 's p b' : 's p'} tabIndex={-1}
    onKeyDown={event => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); onSave(); }
      else if (key === 'p') { event.preventDefault(); onQuickOpenChange(true); }
      else if (key === 'b' && onToggleExplorer) { event.preventDefault(); onToggleExplorer(); }
    }}>
    <style>{STUDIO_TOKENS}</style>
    {top}
    <div className="sf-studio-row">
      {activity}
      {explorer && <ExplorerColumn width={explorerWidth ?? null} onWidth={onExplorerWidth}>{explorer}</ExplorerColumn>}
      <div className="sf-studio-main">{children}</div>
    </div>
    {quickOpen && <QuickOpen items={quickItems} onPick={onQuickPick} onClose={() => onQuickOpenChange(false)} />}
  </div>;
}

const KEY_STEP = 16;

/** The explorer column. Dragging previews the width locally and commits once on release, so layout storage is written once per drag. */
function ExplorerColumn({ width, onWidth, children }: { width: number | null; onWidth?(width: number | null): void; children: ReactNode }) {
  const [draft, setDraft] = useState<number | null>(null);
  const current = draft ?? width ?? EXPLORER_WIDTH.default;
  return <div className="sf-explorer-col" style={{ width: current }}>
    {children}
    {onWidth && <div className={`sf-explorer-resizer${draft !== null ? ' is-dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize explorer"
      aria-valuemin={EXPLORER_WIDTH.min} aria-valuemax={EXPLORER_WIDTH.max} aria-valuenow={current} tabIndex={0} title="Drag to resize · double-click to reset"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture?.(event.pointerId);
        const startX = event.clientX; const startWidth = current;
        let next = startWidth;
        const move = (ev: PointerEvent) => { next = clampExplorerWidth(startWidth + ev.clientX - startX); setDraft(next); };
        const up = () => {
          handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
          setDraft(null);
          if (next !== startWidth) onWidth(next);
        };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
        setDraft(startWidth);
      }}
      onDoubleClick={() => onWidth(null)}
      onKeyDown={event => {
        const delta = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0;
        if (delta) { event.preventDefault(); onWidth(clampExplorerWidth(current + delta)); }
        else if (event.key === 'Home') { event.preventDefault(); onWidth(null); }
      }} />}
  </div>;
}
