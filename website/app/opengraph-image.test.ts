import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const capture = vi.hoisted(() => ({ markup: '' }));
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: Parameters<typeof renderToStaticMarkup>[0]) {
      capture.markup = renderToStaticMarkup(element);
    }
  }
}));
import OgImage from './opengraph-image';

afterEach(() => vi.restoreAllMocks());

describe('social preview branding', () => {
  it('embeds the checked-in PNG without fetching a deployed website', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await OgImage();
    const expected = await readFile(new URL('../public/zana-icon-512.png', import.meta.url));
    expect(capture.markup).toContain(`data:image/png;base64,${expected.toString('base64')}`);
    expect(capture.markup).toContain('Zana Command Center');
    expect(network).not.toHaveBeenCalled();
  });
});
