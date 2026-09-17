import { suppressPostDragClick } from '../suppress-post-drag-click.js';
import { pickZone, zoneBox, type SplitZone, type ZoneDecision } from './zones.js';

/** Marks a pane's root element so the drag layer can hit-test it. */
export const SPLIT_PANE_DATA_ATTR = 'data-split-pane-id';

export interface SplitDropTarget {
  paneId: string;
  zone: SplitZone;
}

export interface SplitDragFallbackTarget {
  paneId: string;
  container: HTMLElement | null;
}

export interface SplitDragConfig {
  ghostLabel: string;
  pointerId?: number;
  sourceEl?: HTMLElement | null;
  decide: (paneId: string, zone: SplitZone) => ZoneDecision | null;
  onDrop: (target: SplitDropTarget) => void;
  shouldEngage: (clientX: number, clientY: number) => boolean;
  onEngage?: () => void;
  onEnd?: (result: { dropped: boolean }) => void;
  fallback?: SplitDragFallbackTarget;
  cancelSidebarReorderOnEngage?: boolean;
}

interface ResolvedTarget {
  paneId: string;
  rect: DOMRect;
}

let cancelActiveDrag: (() => void) | null = null;

/** Returns an idempotent cancellation function for the owning component. */
export function beginSplitDrag(config: SplitDragConfig): () => void {
  cancelActiveDrag?.();
  let finished = false;
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  const previousOpacity = config.sourceEl?.style.opacity ?? '';
  let engaged = false;
  let target: SplitDropTarget | null = null;
  let ghostEl: HTMLElement | null = null;
  let overlayEl: HTMLElement | null = null;

  const preventNativeDrag = (event: DragEvent): void => {
    event.preventDefault();
  };
  window.addEventListener('dragstart', preventNativeDrag);

  const engage = (): void => {
    engaged = true;
    if (config.cancelSidebarReorderOnEngage) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
      );
    }
    ghostEl = createGhost(config.ghostLabel);
    overlayEl = createOverlay();
    document.body.append(ghostEl, overlayEl);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    if (config.sourceEl) config.sourceEl.style.opacity = '0.45';
    config.onEngage?.();
    window.addEventListener('keydown', handleKey, true);
  };

  const resolveTarget = (clientX: number, clientY: number): ResolvedTarget | null => {
    const paneEl = paneElementAt(clientX, clientY);
    const paneId = paneEl?.getAttribute(SPLIT_PANE_DATA_ATTR) ?? null;
    if (paneEl && paneId !== null) {
      return { paneId, rect: paneEl.getBoundingClientRect() };
    }
    const fallback = config.fallback;
    if (fallback && fallback.container) {
      const rect = fallback.container.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { paneId: fallback.paneId, rect };
      }
    }
    return null;
  };

  const isOwnPointer = (event: PointerEvent): boolean =>
    config.pointerId === undefined || config.pointerId === event.pointerId;

  const updateTarget = (clientX: number, clientY: number): void => {
    target = null;
    const resolved = resolveTarget(clientX, clientY);
    if (resolved && overlayEl) {
      const zone = pickZone(resolved.rect, clientX, clientY);
      const decision = config.decide(resolved.paneId, zone);
      if (decision) {
        target = { paneId: resolved.paneId, zone: decision.zone };
        positionOverlay(overlayEl, zoneBox(resolved.rect, decision.zone), decision.label);
      } else {
        overlayEl.style.display = 'none';
      }
    } else if (overlayEl) {
      overlayEl.style.display = 'none';
    }
  };

  const handleMove = (event: PointerEvent): void => {
    if (!isOwnPointer(event)) return;
    if (!engaged) {
      if (!config.shouldEngage(event.clientX, event.clientY)) return;
      engage();
    }
    event.preventDefault();
    if (ghostEl) {
      ghostEl.style.left = `${event.clientX + 12}px`;
      ghostEl.style.top = `${event.clientY + 8}px`;
    }
    updateTarget(event.clientX, event.clientY);
  };

  const teardown = (): void => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleCancel);
    window.removeEventListener('dragstart', preventNativeDrag);
    window.removeEventListener('keydown', handleKey, true);
    window.removeEventListener('blur', handleCancel);
    if (cancelActiveDrag === handleCancel) cancelActiveDrag = null;
    ghostEl?.remove();
    overlayEl?.remove();
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    if (config.sourceEl) config.sourceEl.style.opacity = previousOpacity;
  };

  function handleUp(event: PointerEvent): void {
    if (finished || !isOwnPointer(event)) return;
    // The layout or pointer can change between the last move and release.
    if (engaged) updateTarget(event.clientX, event.clientY);
    finished = true;
    const wasEngaged = engaged;
    const dropTarget = engaged ? target : null;
    teardown();
    if (wasEngaged) suppressPostDragClick();
    try {
      if (dropTarget) config.onDrop(dropTarget);
    } finally {
      if (wasEngaged) config.onEnd?.({ dropped: dropTarget !== null });
    }
  }

  function handleCancel(event?: Event): void {
    if (finished || (event instanceof PointerEvent && !isOwnPointer(event))) return;
    finished = true;
    const wasEngaged = engaged;
    teardown();
    if (wasEngaged) {
      suppressPostDragClick();
      config.onEnd?.({ dropped: false });
    }
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handleCancel();
  }

  cancelActiveDrag = handleCancel;
  window.addEventListener('blur', handleCancel);
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleCancel);
  return handleCancel;
}

function paneElementAt(clientX: number, clientY: number): HTMLElement | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const pane =
      element instanceof HTMLElement
        ? element.closest<HTMLElement>(`[${SPLIT_PANE_DATA_ATTR}]`)
        : null;
    if (pane) return pane;
  }
  return null;
}

function createGhost(label: string): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'split-drag-ghost';
  ghost.textContent = label;
  return ghost;
}

function createOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'split-drag-overlay';
  const label = document.createElement('div');
  label.className = 'split-drag-overlay-label';
  label.dataset.splitDragLabel = '';
  overlay.append(label);
  return overlay;
}

function positionOverlay(
  overlay: HTMLElement,
  box: { left: number; top: number; width: number; height: number },
  label: string
): void {
  overlay.style.display = 'block';
  overlay.style.left = `${box.left}px`;
  overlay.style.top = `${box.top}px`;
  overlay.style.width = `${box.width}px`;
  overlay.style.height = `${box.height}px`;
  const labelEl = overlay.querySelector<HTMLElement>('[data-split-drag-label]');
  if (labelEl) labelEl.textContent = label;
}
