// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import MarkdownDocument from './MarkdownDocument.js';

const read = vi.hoisted(() => vi.fn(async () => ({ ok: true, dataUrl: 'data:image/png;base64,AAAA' })));
vi.mock('../../lib/product-client.js', () => ({ product: { fs: { readDataUrl: read }, threads: {} } }));
vi.mock('../../hooks/useMonacoTheme.js', () => ({ useMonacoTheme: () => 'light' }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('resolves a local document image relative to its file', async () => {
  render(<MarkdownDocument documentPath="/repo/docs/guide.md" value="![Architecture](images/diagram.png)" savedValue="" />);
  expect((await screen.findByRole('img', { name: 'Architecture' })).getAttribute('src')).toBe('data:image/png;base64,AAAA');
  expect(read).toHaveBeenCalledWith('/repo/docs/images/diagram.png');
});

it('keeps remote images off local disk while retaining HTTPS images', async () => {
  render(<MarkdownDocument localImages={false} documentPath="/repo/guide.md" value="![Local](diagram.png)\n\n![Hosted](https://example.com/diagram.png)" savedValue="" />);
  expect((await screen.findByRole('img', { name: 'Hosted' })).getAttribute('src')).toBe('https://example.com/diagram.png');
  expect(screen.getByText('Local')).toBeTruthy();
  expect(screen.queryByRole('img', { name: 'Local' })).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it.each(['//host/diagram.png', 'http://host/diagram.png'])('does not load an unsupported document image %s', source => {
  render(<MarkdownDocument documentPath="/repo/guide.md" value={`![Private](${source})`} savedValue="" />);
  expect(screen.getByText('Private')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(read).not.toHaveBeenCalled();
});
