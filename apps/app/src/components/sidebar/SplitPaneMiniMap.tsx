import type { MiniMapSlot } from './paneContentSplitIndicator.js';

const GLYPH_SIZE = 14;
const GLYPH_PADDING = 1;
const INNER = GLYPH_SIZE - 2 * GLYPH_PADDING;
const OUTLINE_WIDTH = 1;

function offset(value: number): number {
  return GLYPH_PADDING + value * INNER;
}

function extent(value: number): number {
  return value * INNER;
}

function outlineInset(isFilled: boolean): number {
  return isFilled ? 0 : OUTLINE_WIDTH / 2;
}

export function SplitPaneMiniMap({
  slots,
  label,
  isWorking = false
}: {
  slots: MiniMapSlot[];
  label: string;
  isWorking?: boolean;
}) {
  const representsFocusedPane = slots.some((slot) => slot.isMe && slot.isFocused);
  return (
    <svg
      width={GLYPH_SIZE}
      height={GLYPH_SIZE}
      viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`}
      className={`split-pane-minimap${representsFocusedPane ? '' : ' is-idle'}${isWorking ? ' is-working' : ''}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      data-testid="split-pane-minimap"
    >
      {slots.map((slot) => {
        const inset = outlineInset(slot.isMe);
        return (
          <rect
            key={slot.paneId}
            x={offset(slot.rect.x) + inset}
            y={offset(slot.rect.y) + inset}
            width={Math.max(extent(slot.rect.w) - 2 * inset, 0)}
            height={Math.max(extent(slot.rect.h) - 2 * inset, 0)}
            strokeWidth={slot.isMe ? 0 : OUTLINE_WIDTH}
            className={
              slot.isMe
                ? slot.isFocused
                  ? 'split-pane-minimap-me is-focused'
                  : 'split-pane-minimap-me'
                : 'split-pane-minimap-other'
            }
          />
        );
      })}
    </svg>
  );
}
