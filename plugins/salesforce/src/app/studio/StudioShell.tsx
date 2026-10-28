import { useRef, useState, type ReactNode } from 'react';
import { STUDIO_TOKENS } from './studio-tokens.js';
import { ResizeHandle, useElementSize } from './StudioResize.js';
import { EXPLORER_WIDTH } from './studio-layout.js';
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
  const column = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useElementSize(column, setBounds, true);
  const maximum = bounds.width > 0 ? Math.max(EXPLORER_WIDTH.min, Math.min(EXPLORER_WIDTH.max, bounds.width - 300)) : EXPLORER_WIDTH.max;
  const [draft, setDraft] = useState<number | null>(null);
  const current = Math.min(maximum, draft ?? width ?? EXPLORER_WIDTH.default);
  return <div ref={column} className="sf-explorer-col" style={{ width: current }}>
    {children}
    {onWidth && <ResizeHandle className="sf-explorer-resizer" label="Resize explorer" value={current}
      min={EXPLORER_WIDTH.min} max={maximum} step={KEY_STEP}
      onChange={setDraft} onCommit={next => { setDraft(null); if (next !== (width ?? EXPLORER_WIDTH.default)) onWidth(next); }} onReset={() => onWidth(null)} />}
  </div>;
}
