import type { ReactNode } from 'react';

/**
 * A MacBook-style device bezel. Used for the homepage product shot so the
 * screenshot reads as a Mac, not as an in-app window.
 */
export function MacFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mac-frame ${className}`}>
      <div className="mac-frame-lid">
        <span className="mac-frame-camera" aria-hidden="true" />
        <div className="mac-frame-screen">{children}</div>
      </div>
      <div className="mac-frame-base" aria-hidden="true">
        <span className="mac-frame-notch" />
      </div>
    </div>
  );
}
