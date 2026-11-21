// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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

it('uses the document checkout scope for a relative image', async () => {
  const scope = { projectId: 'project', hostId: 'remote-host', environmentId: 'checkout' };
  render(<MarkdownDocument fileScope={scope} documentPath="/repo/guide.md" value="![Scoped](diagram.png)" savedValue="" />);
  await screen.findByRole('img', { name: 'Scoped' });
  expect(read).toHaveBeenCalledExactlyOnceWith('/repo/diagram.png', scope);
});

it('ignores a stale image when another checkout has the same document path', async () => {
  let finish!: (value: { ok: boolean; dataUrl: string }) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  read.mockResolvedValueOnce({ ok: true, dataUrl: 'data:image/png;base64,Qg==' });
  const first = { projectId: 'project', hostId: 'first-host' };
  const second = { projectId: 'project', hostId: 'second-host' };
  const props = { documentPath: '/repo/guide.md', value: '![Scoped](diagram.png)', savedValue: '' };
  const view = render(<MarkdownDocument {...props} fileScope={first} />);
  await waitFor(() => expect(read).toHaveBeenCalledWith('/repo/diagram.png', first));
  view.rerender(<MarkdownDocument {...props} fileScope={second} />);
  expect((await screen.findByRole('img')).getAttribute('src')).toBe('data:image/png;base64,Qg==');
  await act(async () => { finish({ ok: true, dataUrl: 'data:image/png;base64,QQ==' }); });
  expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,Qg==');
  expect(read).toHaveBeenLastCalledWith('/repo/diagram.png', second);
});

it('does not retry an unavailable checkout image against local disk', async () => {
  read.mockResolvedValueOnce({ ok: false, dataUrl: '' });
  const scope = { projectId: 'project', hostId: 'offline-host' };
  render(<MarkdownDocument fileScope={scope} documentPath="/repo/guide.md" value="![Unavailable](diagram.png)" savedValue="" />);
  await waitFor(() => expect(read).toHaveBeenCalledExactlyOnceWith('/repo/diagram.png', scope));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText('Unavailable')).toBeTruthy();
});
