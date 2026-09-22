import type { PointerEvent, KeyboardEvent } from 'react';
import type { InspectorResizeEdge } from './inspector-window.js';

const EDGES: InspectorResizeEdge[] = ['e', 'w', 's', 'se', 'sw'];

export function InspectorResizeHandles({
  hidden,
  onBegin,
  onMove,
  onEnd,
  onReset,
  onKey
}: {
  hidden: boolean;
  onBegin(edge: InspectorResizeEdge, event: PointerEvent<HTMLDivElement>): void;
  onMove(event: PointerEvent<HTMLDivElement>): void;
  onEnd(event: PointerEvent<HTMLDivElement>): void;
  onReset(): void;
  onKey(key: string): void;
}) {
  if (hidden) return null;
  return (
    <>
      {EDGES.map((edge) => {
        const keyboard = edge === 'se';
        return (
          <div
            key={edge}
            className={`inspector-resize-handle is-${edge}`}
            data-testid={`inspector-resize-${edge}`}
            role={keyboard ? 'separator' : undefined}
            aria-orientation={keyboard ? 'horizontal' : undefined}
            aria-label={keyboard ? 'Resize agent window' : undefined}
            aria-hidden={keyboard ? undefined : true}
            title={keyboard ? 'Drag to resize · double-click to reset · arrow keys to adjust' : undefined}
            tabIndex={keyboard ? 0 : undefined}
            onPointerDown={(event) => onBegin(edge, event)}
            onPointerMove={onMove}
            onPointerUp={onEnd}
            onPointerCancel={onEnd}
            onLostPointerCapture={onEnd}
            onDoubleClick={() => {
              if (keyboard) onReset();
            }}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (!keyboard) return;
              if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) {
                return;
              }
              event.preventDefault();
              if (event.key === 'Enter') onReset();
              else onKey(event.key);
            }}
          />
        );
      })}
    </>
  );
}
