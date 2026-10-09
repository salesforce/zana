import type { ReactNode } from 'react';
import { STUDIO_TOKENS } from './studio-tokens.js';
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
 * The shell also owns the shortcuts that must work wherever focus is inside the Studio: Cmd/Ctrl+S saves, Cmd/Ctrl+P opens QuickOpen.
 */
export function StudioShell({ layout, tier, top, activity, explorer, children, quickOpen, quickItems, onQuickOpenChange, onQuickPick, onSave }: {
  layout: StudioLayout;
  tier: number | null;
  top?: ReactNode;
  activity?: ReactNode;
  explorer?: ReactNode;
  children: ReactNode;
  quickOpen: boolean;
  quickItems: QuickOpenItem[];
  onQuickOpenChange(open: boolean): void;
  onQuickPick(item: QuickOpenItem): void;
  onSave(): void;
}) {
  return <div className="sf-as-body sf-studio" data-layout={layout} data-tier={tier ?? undefined} tabIndex={-1}
    onKeyDown={event => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); onSave(); }
      else if (key === 'p') { event.preventDefault(); onQuickOpenChange(true); }
    }}>
    <style>{STUDIO_TOKENS}</style>
    {top}
    <div className="sf-studio-row">
      {activity}
      {explorer && <div className="sf-explorer-col">{explorer}</div>}
      <div className="sf-studio-main">{children}</div>
    </div>
    {quickOpen && <QuickOpen items={quickItems} onPick={onQuickPick} onClose={() => onQuickOpenChange(false)} />}
  </div>;
}
