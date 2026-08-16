'use client';

import type { ReactNode } from 'react';

interface BrowserFrameProps {
  title: string;
  badge?: string;
  caption?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A shared, semantic frame for all app screenshots and their placeholders. */
export function BrowserFrame({ title, badge, caption, className = '', children }: BrowserFrameProps) {
  return (
    <figure className={`browser-frame ${className}`}>
      <div className="browser-frame-chrome">
        <span className="browser-frame-controls" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span className="browser-frame-title">{title}</span>
        {badge && <span className="browser-frame-badge">{badge}</span>}
      </div>
      <div className="browser-frame-content">{children}</div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
