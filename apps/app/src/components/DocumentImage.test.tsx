/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { DocContent, MarkdownContent } from './MarkdownContent.js';

const mocks = vi.hoisted(() => ({ readDataUrl: vi.fn(), host: vi.fn(), storage: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: {
  fs: { readDataUrl: mocks.readDataUrl },
  threads: { hostFileContent: mocks.host, storageContent: mocks.storage }
} }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readDataUrl.mockResolvedValue({ ok: false });
  mocks.host.mockResolvedValue({ content: '<svg/>', contentType: 'image/svg+xml', encoding: 'utf8' });
  mocks.storage.mockResolvedValue({ content: 'cG5n', contentType: 'image/png', encoding: 'base64' });
});
afterEach(cleanup);

describe('document images', () => {
  it('loads a linked local diagram from the document directory, without using attachments', async () => {
    mocks.readDataUrl.mockResolvedValue({ ok: true, dataUrl: 'data:image/svg+xml,%3Csvg/%3E' });
    const view = render(<DocContent path="/project/README.md" projectId="p1" threadId="t1" exportable
      content="[![Architecture](docs/assets/architecture.svg)](docs/assets/architecture.svg)" />);
    const image = await view.findByRole('img', { name: 'Architecture' });
    expect(image.getAttribute('src')).toBe('data:image/svg+xml,%3Csvg/%3E');
    expect(mocks.readDataUrl).toHaveBeenCalledWith('/project/docs/assets/architecture.svg');
    expect(mocks.host).not.toHaveBeenCalled();
    expect(view.container.innerHTML).not.toContain('attachments/content');
    view.rerender(<DocContent path="/project/README.md" projectId="p1" threadId="t1" exportable
      content="[![Architecture](docs/assets/architecture.svg)](docs/assets/architecture.svg)" />);
    expect(mocks.readDataUrl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the thread host for relative workspace images', async () => {
    const view = render(<DocContent path="docs/guide.md" threadId="t1" content="![Diagram](../assets/my%20image.svg)" />);
    const image = await view.findByRole('img', { name: 'Diagram' });
    expect(mocks.host).toHaveBeenCalledWith('t1', 'assets/my image.svg');
    expect(image.getAttribute('src')).toBe('data:image/svg+xml,%3Csvg%2F%3E');
  });

  it('uses storage exclusively, including when the same path exists in the workspace', async () => {
    const view = render(<DocContent path="reports/guide.md" threadId="t1" storage content="![Diagram](./assets/diagram.png)" />);
    expect((await view.findByRole('img')).getAttribute('src')).toBe('data:image/png;base64,cG5n');
    expect(mocks.storage).toHaveBeenCalledWith('t1', 'reports/assets/diagram.png');
    expect(mocks.readDataUrl).not.toHaveBeenCalled();
    expect(mocks.host).not.toHaveBeenCalled();
  });

  it('discards stale reads on navigation and does not show a previous document image', async () => {
    let finish!: (value: unknown) => void;
    mocks.host.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<DocContent path="one/guide.md" threadId="t1" content="![Diagram](image.svg)" />);
    await waitFor(() => expect(mocks.host).toHaveBeenCalledWith('t1', 'one/image.svg'));
    view.rerender(<DocContent path="two/guide.md" threadId="t1" storage content="![Diagram](image.png)" />);
    const image = await view.findByRole('img');
    expect(image.getAttribute('src')).toContain('data:image/png;');
    finish({ content: '<svg/>', contentType: 'image/svg+xml' });
    await waitFor(() => expect(view.getByRole('img').getAttribute('src')).toContain('data:image/png;'));
  });

  it.each(['missing', 'invalid', 'not-image'])('keeps alt text when a read is %s', async (failure) => {
    if (failure === 'missing') mocks.host.mockRejectedValue(new Error('not found'));
    else if (failure === 'invalid') mocks.host.mockResolvedValue({ content: 'junk', contentType: 'text/plain' });
    else mocks.readDataUrl.mockResolvedValue({ ok: true, dataUrl: 'data:text/html,unsafe' });
    const view = render(<DocContent path="guide.md" threadId="t1" content="![Missing diagram](missing.svg)" />);
    await waitFor(() => expect(mocks.readDataUrl).toHaveBeenCalled());
    expect(view.queryByRole('img')).toBeNull();
    expect(view.getByText('Missing diagram')).toBeTruthy();
  });

  it('does not read unsupported files or malformed paths as images', async () => {
    const view = render(<DocContent path="guide.md" content="![Text](secret.txt)\n\n![Invalid](bad%XX.png)" />);
    expect(view.queryByRole('img')).toBeNull();
    expect(mocks.readDataUrl).not.toHaveBeenCalled();
  });

  it('leaves remote/data images and conversation attachments on their existing paths', () => {
    const view = render(<>
      <DocContent path="docs/guide.md" content="![Remote](https://example.com/a.png)\n\n![Inline](data:image/png;base64,cG5n)" />
      <MarkdownContent projectId="p1" text="![Uploaded](shot.png)" />
    </>);
    expect(view.getByRole('img', { name: 'Remote' }).getAttribute('src')).toBe('https://example.com/a.png');
    expect(view.getByRole('img', { name: 'Inline' }).getAttribute('src')).toBe('data:image/png;base64,cG5n');
    expect(view.getByRole('img', { name: 'Uploaded' }).getAttribute('src')).toContain('/attachments/content?path=shot.png');
    expect(mocks.readDataUrl).not.toHaveBeenCalled();
  });
});
