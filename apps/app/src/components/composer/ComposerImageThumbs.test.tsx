import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComposerImageThumbs } from './ComposerImageThumbs.js';

describe('ComposerImageThumbs', () => {
  it('renders compact previews and omit remove when read-only', () => {
    const html = renderToStaticMarkup(
      <ComposerImageThumbs
        images={[
          { id: '1', name: 'one.png', src: 'blob:one' },
          { id: '2', name: 'two.png', src: 'blob:two' }
        ]}
      />
    );
    expect(html).toContain('composer-image-thumbs');
    expect(html).toContain('blob:one');
    expect(html).toContain('blob:two');
    expect(html).toContain('alt="one.png"');
    expect(html).not.toContain('composer-image-thumb-remove');
  });

  it('renders a remove control for each draft image', () => {
    const html = renderToStaticMarkup(
      <ComposerImageThumbs
        onRemove={() => undefined}
        images={[{ id: '1', name: 'shot.png', src: 'blob:shot' }]}
      />
    );
    expect(html).toContain('aria-label="Remove shot.png"');
    expect(html).toContain('composer-image-thumb-remove');
    expect(readFileSync(new URL('./ComposerImageThumbs.tsx', import.meta.url), 'utf8'))
      .toContain('onClick={() => onRemove(image.id)}');
  });

  it('opens a lightbox control when onOpen is provided', () => {
    const html = renderToStaticMarkup(
      <ComposerImageThumbs
        onOpen={() => undefined}
        images={[{ id: '1', name: 'shot.png', src: 'blob:shot' }]}
      />
    );
    expect(html).toContain('composer-image-thumb-preview');
    expect(html).toContain('<button');
  });

  it('renders nothing when empty', () => {
    expect(renderToStaticMarkup(<ComposerImageThumbs images={[]} />)).toBe('');
  });
});
