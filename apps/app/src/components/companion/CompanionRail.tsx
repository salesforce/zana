import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, Clock, Inbox } from 'lucide-react';
import type { CompanionPanelKind } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { railIndicators, type Indicator } from './companion-model.js';
import zanaLogo from '../../assets/zana-favicon.svg';
import { useCompanion } from './useCompanion.js';

/** Pointer travel (px) before a press on the rail becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Hover delay before the first tooltip; moving between icons is instant after. */
const TOOLTIP_DELAY_MS = 350;
/** Grace before hiding on leave, so gliding to the next icon stays instant. */
const TOOLTIP_LINGER_MS = 90;

/**
 * The floating Command Center rail: logo, Needs You, Agents, Scheduler, a
 * divider and the profile/status avatar. Tiny by default — each icon opens ONE
 * quick panel (a separate window main places beside the rail). Dragging the
 * rail moves it; main snaps it to the nearest screen edge on release.
 */
export function CompanionRail() {
  const { snapshot, pending } = useCompanion();
  const [open, setOpen] = useState<CompanionPanelKind | null>(null);
  const [pulse, setPulse] = useState(false);
  const prevCount = useRef(0);
  const drag = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const tip = useTooltip(open !== null);

  const ind = railIndicators(snapshot, pending.length);

  useEffect(() => {
    const offPanel = product.companion.onPanel((s) => setOpen(s.kind));
    const offClosed = product.companion.onPanelClosed(() => setOpen(null));
    return () => {
      offPanel();
      offClosed();
    };
  }, []);

  // One subtle pulse when attention first appears / grows — never a loop.
  useEffect(() => {
    if (pending.length > prevCount.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1600);
      prevCount.current = pending.length;
      return () => clearTimeout(t);
    }
    // A shrink cancels any pulse in flight (its timer was just cleared).
    prevCount.current = pending.length;
    setPulse(false);
    return undefined;
  }, [pending.length]);

  const toggle = (kind: CompanionPanelKind, focusRequestId?: string) => {
    if (suppressClick.current) return;
    if (open === kind && !focusRequestId) void product.companion.closePanel();
    else void product.companion.openPanel(kind, focusRequestId);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    tip.hide();
    suppressClick.current = false;
    drag.current = { x: e.screenX, y: e.screenY, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.dragging) return;
    if (Math.hypot(e.screenX - d.x, e.screenY - d.y) > DRAG_THRESHOLD) {
      d.dragging = true;
      suppressClick.current = true;
      // Capture only once it IS a drag: capturing on pointerdown retargets the
      // click to the rail itself, so the icon buttons would never see it.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      void product.companion.dragStart();
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.dragging) {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      void product.companion.dragEnd();
      // Let the click that follows pointerup see the flag, then clear it.
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  };

  const needsLabel = pending.length > 0 ? `${pending.length} waiting for you` : 'Nothing waiting';
  const agentsLabel = `${snapshot.counts.working} working · ${snapshot.counts.idle} idle`;
  const schedLabel =
    snapshot.counts.runningSchedules > 0
      ? `${snapshot.counts.runningSchedules} running`
      : `${snapshot.schedules.length} schedules`;

  return (
    <div className={`cc-rail-stage cc-edge-${snapshot.edge}`}>
      <nav
        className="cc-rail"
        aria-label="Command Center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          className="cc-rail-logo"
          aria-label="Open the full window"
          onClick={() => !suppressClick.current && void product.companion.exit()}
          {...tip.bind('Open Zana', 'Leave Command Center', () => !!drag.current?.dragging)}
        >
          {/* The app's own brand mark, as shown in the mobile shell header. */}
          <img className="cc-rail-glyph" src={zanaLogo} width={28} height={28} alt="" draggable={false} />
        </button>

        <RailButton
          tip={tip}
          dragging={() => !!drag.current?.dragging}
          label="Needs you"
          detail={needsLabel}
          active={open === 'needs-you'}
          onClick={() => toggle('needs-you')}
          badge={
            pending.length > 0 ? (
              <span
                className={`cc-badge${pulse ? ' cc-pulse' : ''}`}
                role="button"
                aria-label={`${pending.length} pending — open the first`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle('needs-you', pending[0]?.id);
                }}
              >
                {pending.length > 9 ? '9+' : pending.length}
              </span>
            ) : null
          }
        >
          <Inbox size={18} strokeWidth={1.8} />
        </RailButton>

        <RailButton
          tip={tip}
          dragging={() => !!drag.current?.dragging}
          label="Agents"
          detail={agentsLabel}
          panel="agents"
          active={open === 'agents'}
          onClick={() => toggle('agents')}
          badge={<Dot indicator={ind.agents} />}
        >
          <Bot size={18} strokeWidth={1.8} />
        </RailButton>

        <RailButton
          tip={tip}
          dragging={() => !!drag.current?.dragging}
          label="Scheduler"
          detail={schedLabel}
          active={open === 'scheduler'}
          onClick={() => toggle('scheduler')}
          badge={<Dot indicator={ind.scheduler} />}
        >
          <Clock size={18} strokeWidth={1.8} />
        </RailButton>

        <div className="cc-rail-divider" aria-hidden />

        <RailButton
          tip={tip}
          dragging={() => !!drag.current?.dragging}
          label="Status"
          detail={pending.length > 0 ? needsLabel : 'All clear'}
          active={open === 'status'}
          onClick={() => toggle('status')}
          badge={<Dot indicator={ind.status} ring />}
        >
          <span className="cc-avatar">{snapshot.userInitials || '·'}</span>
        </RailButton>
      </nav>
    </div>
  );
}

function RailButton({
  tip,
  dragging,
  label,
  detail,
  panel,
  active,
  onClick,
  badge,
  children
}: {
  tip: Tooltip;
  dragging: () => boolean;
  label: string;
  detail: string;
  /** Icon whose hover shows a live preview list (main builds it). */
  panel?: CompanionPanelKind;
  active: boolean;
  onClick: () => void;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`cc-rail-btn${active ? ' is-active' : ''}`}
      aria-label={`${label}: ${detail}`}
      aria-pressed={active}
      onClick={onClick}
      {...tip.bind(label, detail, dragging, panel)}
    >
      {children}
      {badge}
    </button>
  );
}

function Dot({ indicator, ring = false }: { indicator: Indicator; ring?: boolean }) {
  if (!indicator) return null;
  return <span className={`cc-rail-dot cc-dot-${indicator}${ring ? ' cc-dot-ring' : ''}`} aria-hidden />;
}

type Tooltip = ReturnType<typeof useTooltip>;

/**
 * Hover tooltips, drawn by main in a click-through window beside the rail (the
 * rail window is too narrow to hold one). Suppressed while a panel is open or
 * the rail is being dragged; the first one waits a beat, the next is instant.
 */
function useTooltip(panelOpen: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showing = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = () => {
    clear();
    if (showing.current) void product.companion.tooltip(null);
    showing.current = false;
  };

  useEffect(() => {
    if (panelOpen) hide();
  }, [panelOpen]);
  useEffect(() => hide, []);

  const bind = (label: string, detail: string, dragging: () => boolean, panel?: CompanionPanelKind) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (panelOpen || dragging()) return;
      const r = e.currentTarget.getBoundingClientRect();
      const send = () => {
        timer.current = null;
        showing.current = true;
        void product.companion.tooltip({ label, detail, panel, y: Math.round(r.top + r.height / 2) });
      };
      clear();
      if (showing.current) send();
      else timer.current = setTimeout(send, TOOLTIP_DELAY_MS);
    },
    onMouseLeave: () => {
      clear();
      if (showing.current) timer.current = setTimeout(hide, TOOLTIP_LINGER_MS);
    }
  });

  return { bind, hide };
}
