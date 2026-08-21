import type { ReactNode } from 'react';

interface AppPageHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** False for nested panes that never occupy the window's top-left corner. */
  ownsWindowTopLeft?: boolean;
}

/** Shared route chrome. The shell owns the trigger reserve, never page bodies. */
export function AppPageHeader({
  title,
  actions,
  className = '',
  ownsWindowTopLeft = true
}: AppPageHeaderProps) {
  return (
    <header className={`app-page-header ${ownsWindowTopLeft ? 'app-page-header--top-left' : ''} ${className}`.trim()}>
      <div className="app-page-header-content-row" data-testid="app-page-header-content-row">
        <div className="app-page-header-title">{title}</div>
        {actions && <div className="app-page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}
