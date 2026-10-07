import { Link } from 'react-router-dom';
import { Folder, MessageSquare, X } from 'lucide-react';
import type { MobileAgentItem } from './mobile-agent-items';
import { useSwipeToClose } from './useSwipeToClose';

export function MobileAgentRow({ item, active, onOpen, onClose }: {
  item: MobileAgentItem;
  active: boolean;
  onOpen: () => void;
  onClose: () => Promise<void>;
}) {
  const swipe = useSwipeToClose<HTMLLIElement>(onClose);
  const { distance, busy, revealed } = swipe;

  return (
    <li ref={swipe.rootRef} className="mobile-agent-swipe" aria-busy={busy} data-swiping={swipe.dragging} data-revealed={revealed}
      data-ready={swipe.ready} onKeyDown={swipe.onKeyDown}>
      <div className="mobile-agent-swipe-action">
        <button type="button" disabled={busy || !revealed} tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed} aria-label={`Close ${item.title}`}
          onClick={() => void swipe.close()}>
          <X size={20} aria-hidden="true" />
          <span>{swipe.ready ? 'Release to close' : 'Close'}</span>
        </button>
      </div>
      <div className="mobile-agent-row-surface" style={{ transform: `translateX(${-distance}px)` }}>
        <Link to={item.to} className="mobile-agent-row" draggable={false}
          aria-current={active ? 'page' : undefined}
          {...swipe.handlers}
          onClick={(event) => {
            if (!swipe.consumeClick(event)) onOpen();
          }}>
          <MessageSquare size={19} aria-hidden="true" />
          <span className="mobile-agent-row-copy">
            <span className="mobile-agent-row-title">{item.title}</span>
            <span className="mobile-agent-row-detail">
              <span className="mobile-agent-project" title={item.projectName}>
                <Folder size={12} aria-hidden="true" /><span>{item.projectName}</span>
              </span>
              <span className="mobile-agent-status" data-status={item.status}>{item.status}</span>
            </span>
          </span>
        </Link>
        <button className="mobile-agent-close" type="button" disabled={busy}
          aria-label={`Close ${item.title}`} title="Close agent (or swipe left)" onClick={() => void swipe.close()}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
