import type { ReactNode } from 'react';
import { AlertTriangle, Bot, FolderX, Inbox, Unplug } from 'lucide-react';

export type PaneEmptyArt = 'ended' | 'missing' | 'agents' | 'error' | 'inbox';

/**
 * Centered full-pane empty / gone / crash layout. Arts are CSS-only
 * (`prefers-reduced-motion` disables pulse and blink).
 */
export function PaneEmptyState({
  art,
  title,
  hint,
  testId,
  className,
  children
}: {
  art: PaneEmptyArt;
  title: string;
  hint?: string;
  testId?: string;
  className?: string;
  children?: ReactNode;
}) {
  const rootClass = className ? `pane-empty ${className}` : 'pane-empty';
  return (
    <div className={rootClass} data-testid={testId} data-art={art}>
      <div className="pane-empty-art" aria-hidden="true">
        <PaneEmptyArtVisual art={art} />
      </div>
      <h2 className="pane-empty-title">{title}</h2>
      {hint ? <p className="pane-empty-hint">{hint}</p> : null}
      {children}
    </div>
  );
}

function PaneEmptyArtVisual({ art }: { art: PaneEmptyArt }) {
  if (art === 'ended') {
    return (
      <>
        <div className="pane-empty-term">
          <div className="pane-empty-term-bar">
            <span /><span /><span />
          </div>
          <div className="pane-empty-term-body">
            <span className="pane-empty-prompt">$</span>
            <span className="pane-empty-caret" />
          </div>
        </div>
        <span className="pane-empty-well pane-empty-well--ended">
          <Unplug size={22} strokeWidth={1.75} />
        </span>
      </>
    );
  }

  const Icon =
    art === 'missing' ? FolderX : art === 'agents' ? Bot : art === 'inbox' ? Inbox : AlertTriangle;
  return (
    <span className={`pane-empty-well pane-empty-well--${art}`}>
      <Icon size={22} strokeWidth={1.75} />
    </span>
  );
}
