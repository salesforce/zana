import type { Rect } from './zones.js';

export function createOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'split-drag-overlay';
  const label = document.createElement('div');
  label.className = 'split-drag-overlay-label';
  label.dataset.splitDragLabel = '';
  overlay.append(label);
  return overlay;
}

export function positionOverlay(
  overlay: HTMLElement,
  box: Rect,
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
