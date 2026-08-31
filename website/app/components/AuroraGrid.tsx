'use client';

import { memo } from 'react';

/**
 * Port of the desktop app's ambient grid. Drop as the first child of an
 * `.aurora-host` (positioned, isolating, overflow hidden). Content must sit
 * at z-index 1. Token-driven; beams freeze under prefers-reduced-motion via CSS.
 */
export const AuroraGrid = memo(function AuroraGrid({
  className,
  beams = true
}: {
  className?: string;
  beams?: boolean;
}) {
  return (
    <div className={`aurora-grid${className ? ` ${className}` : ''}`} aria-hidden="true">
      {beams && (
        <>
          <span className="aurora-grid-beam aurora-grid-beam--v b1" />
          <span className="aurora-grid-beam aurora-grid-beam--v b2" />
          <span className="aurora-grid-beam aurora-grid-beam--v b3" />
          <span className="aurora-grid-beam aurora-grid-beam--h b4" />
          <span className="aurora-grid-beam aurora-grid-beam--h b5" />
        </>
      )}
    </div>
  );
});
