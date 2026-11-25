import { guardEmbeddedFrames } from './frameGuard.js';
import { createOverlay, positionOverlay } from './overlay.js';
import { SPLIT_PANE_DATA_ATTR, type SplitDragConfig } from './splitDragSession.js';
import { pickZone, zoneBox } from './zones.js';

/** Chromium owns the tab drag (including strip reordering and Escape). Pane
 * listeners live only for this local drag and never read external drag data. */
export function beginNativeTabPaneDrag(
  workspace: HTMLElement,
  { decide, onDrop }: Pick<SplitDragConfig, 'decide' | 'onDrop'>
): () => void {
  const overlay = createOverlay();
  const releaseFrames = guardEmbeddedFrames();
  document.body.append(overlay);

  const handle = (event: DragEvent) => {
    const pane = event.target instanceof Element
      ? event.target.closest<HTMLElement>(`[${SPLIT_PANE_DATA_ATTR}]`)
      : null;
    const paneId = pane?.getAttribute(SPLIT_PANE_DATA_ATTR);
    if (!pane || !paneId) {
      overlay.style.display = 'none';
      return;
    }
    const rect = pane.getBoundingClientRect();
    const decision = decide(paneId, pickZone(rect, event.clientX, event.clientY));
    if (!decision) {
      overlay.style.display = 'none';
      return;
    }
    // The workspace owns this drop even over a composer or another drop target.
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'drop') {
      cleanup();
      onDrop({ paneId, zone: decision.zone });
    } else {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      positionOverlay(overlay, zoneBox(rect, decision.zone), decision.label);
    }
  };
  const leave = (event: DragEvent) => {
    if (!(event.relatedTarget instanceof Node && workspace.contains(event.relatedTarget))) {
      overlay.style.display = 'none';
    }
  };
  function cleanup() {
    workspace.removeEventListener('dragover', handle, true);
    workspace.removeEventListener('drop', handle, true);
    workspace.removeEventListener('dragleave', leave);
    overlay.remove();
    releaseFrames();
  }
  workspace.addEventListener('dragover', handle, true);
  workspace.addEventListener('drop', handle, true);
  workspace.addEventListener('dragleave', leave);
  return cleanup;
}
