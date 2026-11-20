// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownPreview from './MarkdownPreview';

const mocks = vi.hoisted(() => ({ readDataUrl: vi.fn(), host: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  fs: { readDataUrl: mocks.readDataUrl },
  threads: { hostFileContent: mocks.host, storageContent: vi.fn() }
} }));

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const INLINE_DATA_URL = 'data:image/png;base64,AAAA';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) { this.ranges = ranges; }
}

beforeEach(() => {
  vi.stubGlobal('CSS', { highlights: new Map() });
  vi.stubGlobal('Highlight', FakeHighlight);
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
  mocks.readDataUrl.mockReset();
  mocks.readDataUrl.mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

function renderDoc(content: string, documentPath = '/repo/docs/guide.md') {
  return render(<MarkdownPreview content={content} documentPath={documentPath} />);
}

describe('MarkdownPreview images', () => {
  it('loads a relative image through the file reader, resolved against the open file', async () => {
    renderDoc('![Logo](img/logo.png)');
    const image = await screen.findByRole('img', { name: 'Logo' });
    expect(image.getAttribute('src')).toBe(PNG_DATA_URL);
    expect(mocks.readDataUrl).toHaveBeenCalledWith('/repo/docs/img/logo.png');
  });

  it('resolves parent segments, percent-encoded spaces and Windows backslash documents', async () => {
    renderDoc('![Shot](../my%20shots/a.png)', String.raw`C:\Users\me\My Docs\notes\guide.md`);
    await screen.findByRole('img', { name: 'Shot' });
    expect(mocks.readDataUrl).toHaveBeenCalledWith('C:/Users/me/My Docs/my shots/a.png');
  });

  it('keeps data: images inline instead of stripping them', () => {
    renderDoc(`![Inline](${INLINE_DATA_URL})`);
    expect(screen.getByRole('img', { name: 'Inline' }).getAttribute('src')).toBe(INLINE_DATA_URL);
    expect(mocks.readDataUrl).not.toHaveBeenCalled();
  });

  it('leaves https images to the browser and does not read them from disk', () => {
    renderDoc('![Remote](https://example.com/a.png)');
    expect(screen.getByRole('img', { name: 'Remote' }).getAttribute('src')).toBe('https://example.com/a.png');
    expect(mocks.readDataUrl).not.toHaveBeenCalled();
  });

  it('shows the alt text when the image cannot be read', async () => {
    mocks.readDataUrl.mockResolvedValue({ ok: false, message: 'ENOENT' });
    renderDoc('![Missing diagram](gone.png)');
    await waitFor(() => expect(mocks.readDataUrl).toHaveBeenCalled());
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Missing diagram')).toBeTruthy();
  });

  it('still finds text around a loaded image and keeps the image in the copied selection', async () => {
    const { container } = renderDoc('Before the figure\n\n![Logo](logo.png)\n\nAfter the figure');
    await screen.findByRole('img', { name: 'Logo' });
    const text = container.querySelector('.inbox-md')!;
    fireEvent.keyDown(text, { key: 'f', ctrlKey: true });
    const input = screen.getByRole('searchbox', { name: 'Find in preview' });
    fireEvent.change(input, { target: { value: 'figure' } });
    expect(screen.getByTestId('dom-find-bar-count').textContent).toContain('2');
    const range = document.createRange();
    range.selectNodeContents(text);
    expect(range.cloneContents().querySelector('img')?.getAttribute('src')).toBe(PNG_DATA_URL);
  });
});
