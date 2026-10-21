/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { binaryPreviewKind, FilePreviewFallback, FilePreviewRevealButton, useFilePreviewReveal } from './FilePreviewReveal.js';
const mocks = vi.hoisted(() => ({ desktop: vi.fn(), locate: vi.fn(), reveal: vi.fn() }));
vi.mock('../../../lib/app-surface.js', () => ({ hasDesktopBridge: mocks.desktop }));
vi.mock('../../../lib/product-client.js', () => ({ product: { openers: { fileLocation: mocks.locate, revealFile: mocks.reveal } } }));
function Preview({ path = 'app.dmg', revision = 0 }: { path?: string; revision?: number }) {
  const state = useFilePreviewReveal({ path, projectId: 'p1', source: 'workspace' }, revision);
  return <><FilePreviewRevealButton state={state} /><FilePreviewFallback path={path} reveal={state} />{state.error && <p role="alert">{state.error}</p>}</>;
}
beforeEach(() => {
  mocks.desktop.mockReturnValue(true); mocks.locate.mockResolvedValue({ ok: true }); mocks.reveal.mockResolvedValue({ ok: true });
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('preview reveal', () => {
  it('rechecks a previously missing file when its preview is refreshed', async () => {
    mocks.locate.mockResolvedValueOnce({ ok: false });
    const view = render(<Preview />);
    await act(async () => {});
    expect(view.queryByRole('button')).toBeNull();
    view.rerender(<Preview revision={1} />);
    await view.findAllByRole('button', { name: 'Show in Finder' });
    expect(mocks.locate).toHaveBeenCalledTimes(2);
  });
  it('shows header and fallback buttons, passes scope and disables both during a reveal', async () => {
    const pending = Promise.withResolvers<{ ok: boolean }>(); mocks.reveal.mockReturnValueOnce(pending.promise);
    const view = render(<Preview />);
    const buttons = await view.findAllByRole('button', { name: 'Show in Finder' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(buttons.every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith({ path: 'app.dmg', projectId: 'p1', source: 'workspace' });
    await act(async () => { pending.resolve({ ok: true }); });
    expect(buttons.every(button => !(button as HTMLButtonElement).disabled)).toBe(true);
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('uses Explorer on Windows and a generic file manager label on Linux', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const view = render(<Preview path="setup.exe" />);
    await view.findAllByRole('button', { name: 'Show in Explorer' });
    expect(view.getByText('Windows application')).toBeTruthy();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    view.rerender(<Preview path="setup.deb" />);
    await view.findAllByRole('button', { name: 'Show in file manager' });
  });

  it.each(['web', 'remote', 'offline'])('hides the OS action for %s files', async kind => {
    if (kind === 'web') mocks.desktop.mockReturnValue(false);
    else if (kind === 'remote') mocks.locate.mockResolvedValue({ ok: false });
    else mocks.locate.mockRejectedValue(new Error('offline'));
    const view = render(<Preview />);
    await act(async () => {});
    expect(view.queryByRole('button')).toBeNull();
    expect(view.getByText(/Copy its path/)).toBeTruthy();
    if (kind === 'web') expect(mocks.locate).not.toHaveBeenCalled();
  });

  it('reports rejected reveals and thrown failures, and lets the user retry', async () => {
    mocks.reveal.mockResolvedValueOnce({ ok: false, message: 'File moved' }).mockResolvedValueOnce({ ok: false }).mockRejectedValueOnce(new Error('offline'));
    const view = render(<Preview />);
    const button = (await view.findAllByRole('button', { name: 'Show in Finder' }))[0];
    fireEvent.click(button); expect((await view.findByRole('alert')).textContent).toBe('File moved');
    fireEvent.click(button); await waitFor(() => expect(view.getByRole('alert').textContent).toBe('Could not show this file in its folder.'));
    fireEvent.click(button); await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Try again'));
    fireEvent.click(button); await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
  });

  it('ignores stale location and reveal replies when switching files or unmounting', async () => {
    const location = Promise.withResolvers<{ ok: boolean }>(); mocks.locate.mockReturnValueOnce(location.promise);
    const view = render(<Preview />);
    view.rerender(<Preview path="next.zip" />);
    await view.findAllByRole('button', { name: 'Show in Finder' });
    await act(async () => { location.resolve({ ok: false }); });
    expect(view.getAllByRole('button')).toHaveLength(2);
    const reveal = Promise.withResolvers<{ ok: boolean; message: string }>(); mocks.reveal.mockReturnValueOnce(reveal.promise);
    fireEvent.click(view.getAllByRole('button')[0]);
    view.rerender(<Preview path="third.bin" />);
    await view.findAllByRole('button', { name: 'Show in Finder' });
    await act(async () => { reveal.resolve({ ok: false, message: 'Old error' }); });
    expect(view.queryByRole('alert')).toBeNull();
    view.unmount();
  });

  it('presents large files, archives, disk images and unknown extensions', () => {
    const state = { available: true, busy: false, error: null, label: 'Show in Finder', reveal: vi.fn() };
    const view = render(<FilePreviewFallback path="huge.log" tooLarge reveal={state} />);
    expect(view.getByText('This file is too large to preview.')).toBeTruthy();
    expect(view.getByText(/handle larger files/)).toBeTruthy();
    view.rerender(<FilePreviewFallback path="archive.ZIP" reveal={state} />);
    expect(view.getByText('ZIP archive')).toBeTruthy();
    expect(view.getByText(/in another app/)).toBeTruthy();
    expect(binaryPreviewKind('no-extension')).toBeNull(); expect(binaryPreviewKind('notes.md')).toBeNull();
    expect(binaryPreviewKind('file.constructor')).toBeNull();
    expect(binaryPreviewKind('image.iso')?.label).toBe('Disk image');
  });
});
