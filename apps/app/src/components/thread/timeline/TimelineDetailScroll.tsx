import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isNearBottom } from './timeline-scroll.js';

export type TimelineDetailScrollSize = 'summary' | 'base' | 'delegation';

export function TimelineDetailScroll({
  size,
  streaming = false,
  contentKey,
  children
}: {
  size: TimelineDetailScrollSize;
  streaming?: boolean;
  contentKey: string;
  children: ReactNode;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const pinnedAwayRef = useRef(false);
  const [fade, setFade] = useState({ above: false, below: false });

  const updateFade = () => {
    const el = areaRef.current;
    if (!el) return;
    setFade({
      above: el.scrollTop > 2,
      below: el.scrollHeight - el.scrollTop - el.clientHeight > 2
    });
  };

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    if (streaming && !pinnedAwayRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    updateFade();
  }, [contentKey, streaming]);

  return (
    <div
      className={`thread-timeline-detail-scroll is-${size}`}
      data-testid="thread-detail-scroll"
      data-size={size}
    >
      <div
        ref={areaRef}
        className="thread-timeline-detail-scroll-area"
        data-streaming={streaming ? 'true' : undefined}
        onScroll={(event) => {
          pinnedAwayRef.current = !isNearBottom(event.currentTarget);
          updateFade();
        }}
      >
        {children}
      </div>
      {fade.above ? (
        <div className="thread-timeline-detail-scroll-fade is-above" aria-hidden="true" />
      ) : null}
      {fade.below ? (
        <div className="thread-timeline-detail-scroll-fade is-below" aria-hidden="true" />
      ) : null}
    </div>
  );
}
