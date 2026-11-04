import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TOUR_VIDEO, TourVideo } from './TourVideo.tsx';

describe('TourVideo', () => {
  const markup = renderToStaticMarkup(createElement(TourVideo));

  it('shows the title-card poster before playback, with captions', () => {
    expect(markup).toContain(`poster="${TOUR_VIDEO.poster}"`);
    expect(markup).toContain(`src="${TOUR_VIDEO.src}"`);
    expect(markup).toContain(`src="${TOUR_VIDEO.captions}"`);
    expect(markup).toContain('playsInline');
    expect(markup).toContain('preload="metadata"');
  });

  it('ships every referenced asset in public/', () => {
    for (const asset of Object.values(TOUR_VIDEO)) {
      expect(existsSync(join(__dirname, '../../public', asset))).toBe(true);
    }
  });
});
