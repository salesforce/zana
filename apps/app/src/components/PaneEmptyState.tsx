import type { ReactNode } from 'react';
import { FairyScene, type FairySceneKind } from './fairy/FairyScenes.js';

export type PaneEmptyArt = FairySceneKind;

const STATUS_ARTS = new Set<PaneEmptyArt>(['conversation', 'first-turn', 'plugin']);

/**
 * Centered full-pane empty / gone / crash / loading layout. Each art is a
 * small CSS-only fairy scene; `prefers-reduced-motion` shows its final frame.
 * Loading arts announce themselves as a polite status.
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
    <div className={rootClass} data-testid={testId} data-art={art} role={STATUS_ARTS.has(art) ? 'status' : undefined}>
      <div className="pane-empty-art" aria-hidden="true">
        <FairyScene kind={art} />
      </div>
      <h2 className="pane-empty-title">{title}</h2>
      {hint ? <p className="pane-empty-hint">{hint}</p> : null}
      {children}
    </div>
  );
}
