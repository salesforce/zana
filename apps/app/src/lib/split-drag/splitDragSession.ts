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

export function beginSplitDrag(config: SplitDragConfig): void {
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
    if (config.sourceEl) config.sourceEl.style.opacity = '0.45';
    config.onEngage?.();
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

  const handleMove = (event: PointerEvent): void => {
    if (!engaged) {
      if (!config.shouldEngage(event.clientX, event.clientY)) return;
      engage();
    }
    event.preventDefault();
    if (ghostEl) {
      ghostEl.style.left = `${event.clientX + 12}px`;
      ghostEl.style.top = `${event.clientY + 8}px`;
    }
    target = null;
    const resolved = resolveTarget(event.clientX, event.clientY);
    if (resolved && overlayEl) {
      const zone = pickZone(resolved.rect, event.clientX, event.clientY);
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

  const teardown = (): void => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleCancel);
    window.removeEventListener('dragstart', preventNativeDrag);
    ghostEl?.remove();
    overlayEl?.remove();
    document.body.style.cursor = '';
    if (config.sourceEl) config.sourceEl.style.opacity = '';
  };

  function handleUp(): void {
    const wasEngaged = engaged;
    const dropTarget = engaged ? target : null;
    teardown();
    if (wasEngaged) swallowNextClick();
    if (dropTarget) config.onDrop(dropTarget);
    if (wasEngaged) config.onEnd?.({ dropped: dropTarget !== null });
  }

  function handleCancel(): void {
    const wasEngaged = engaged;
    teardown();
    if (wasEngaged) {
      swallowNextClick();
      config.onEnd?.({ dropped: false });
    }
  }

  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleCancel);
}

function swallowNextClick(): void {
  const swallow = (event: MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    window.removeEventListener('click', swallow, true);
  };
  window.addEventListener('click', swallow, true);
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 300);
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
