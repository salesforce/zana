import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThreadImageLightbox } from './ThreadImageLightbox.js';

describe('ThreadImageLightbox', () => {
  it('opens images in the shared modal shell', () => {
    const html = renderToStaticMarkup(
      <ThreadImageLightbox src="data:image/png;base64,xx" alt="shot.png" onClose={() => undefined} />
    );
    expect(html).toContain('modal-backdrop');
    expect(html).toContain('thread-image-modal');
    expect(html).toContain('thread-image-modal-body');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="shot.png"');
    expect(html).toContain('src="data:image/png;base64,xx"');
    expect(readFileSync(new URL('./ThreadImageLightbox.tsx', import.meta.url), 'utf8'))
      .toContain('className="thread-image-modal"');
  });
});
