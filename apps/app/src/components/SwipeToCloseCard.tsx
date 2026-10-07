import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useSwipeToClose } from './useSwipeToClose';
import '../styles/swipe-to-close.css';

/** Phone kanban card shell: swipe left to reveal Close, or further to close on release. */
export function SwipeToCloseCard({ title, onClose, children }: {
  title: string;
  onClose: () => Promise<void>;
  children: ReactNode;
}) {
  const swipe = useSwipeToClose<HTMLDivElement>(onClose);
  const { busy, revealed } = swipe;
  return (
    <div ref={swipe.rootRef} className="swipe-close" aria-busy={busy} data-swiping={swipe.dragging}
      data-revealed={revealed} data-ready={swipe.ready} onKeyDown={swipe.onKeyDown}>
      <div className="swipe-close-action">
        <button type="button" disabled={busy || !revealed} tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed} aria-label={`Close ${title}`} onClick={() => void swipe.close()}>
          <X size={20} aria-hidden="true" />
          <span>{swipe.ready ? 'Release to close' : 'Close'}</span>
        </button>
      </div>
      <div className="swipe-close-surface" style={{ transform: `translateX(${-swipe.distance}px)` }}
        {...swipe.handlers}
        onClickCapture={(event) => {
          // A drag (or the tap that dismisses the action) must not also open the card.
          if (swipe.consumeClick(event)) event.stopPropagation();
        }}>
        {children}
        <button className="swipe-close-button" type="button" disabled={busy}
          aria-label={`Close ${title}`} title="Close agent (or swipe left)" onClick={() => void swipe.close()}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
