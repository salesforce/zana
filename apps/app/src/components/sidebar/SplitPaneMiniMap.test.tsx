import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SplitPaneMiniMap } from './SplitPaneMiniMap.js';

describe('SplitPaneMiniMap', () => {
  it('renders filled and outlined slots for the current layout', () => {
    const html = renderToStaticMarkup(
      <SplitPaneMiniMap
        label="Split position"
        slots={[
          {
            paneId: 'pane-1',
            rect: { x: 0, y: 0, w: 0.5, h: 1 },
            isMe: true,
            isFocused: true
          },
          {
            paneId: 'pane-2',
            rect: { x: 0.5, y: 0, w: 0.5, h: 1 },
            isMe: false,
            isFocused: false
          }
        ]}
      />
    );
    expect(html).toContain('data-testid="split-pane-minimap"');
    expect(html).toContain('aria-label="Split position"');
    expect(html).toContain('split-pane-minimap-me is-focused');
    expect(html).toContain('split-pane-minimap-other');
  });
});
