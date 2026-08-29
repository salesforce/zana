import type { ReactNode } from 'react';

interface AppPageHeaderProps {
  actions?: ReactNode;
  className?: string;
  /** False for nested panes that never occupy the window's top-left corner. */
  ownsWindowTopLeft?: boolean;
  children?: ReactNode;
}

function hasHeaderContent(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (typeof node === 'string') return node.trim().length > 0;
  if (typeof node === 'number') return true;
  if (Array.isArray(node)) return node.some(hasHeaderContent);
  return true;
}

/** Shared route chrome. Hidden when there is nothing to put in the row. */
export function AppPageHeader({
  actions,
  className = '',
  ownsWindowTopLeft = true,
  children
}: AppPageHeaderProps) {
  if (!hasHeaderContent(children) && !hasHeaderContent(actions)) return null;

  const classes = [
    'app-page-header',
    ownsWindowTopLeft ? 'app-page-header--top-left' : '',
    className
  ].filter(Boolean).join(' ');
  return (
    <header className={classes}>
      <div className="app-page-header-content-row" data-testid="app-page-header-content-row">
        {children}
        {actions && <div className="app-page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}
