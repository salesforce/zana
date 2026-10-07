// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  open: true,
  notes: [{ version: '2.3.0', markdown: '# Release 2.3.0' }],
  toVersion: '2.3.0' as string | null,
  preview: false,
  close: vi.fn(),
}));
const updates = vi.hoisted(() => ({ status: { kind: 'idle' as string } }));
const productApi = vi.hoisted(() => ({ download: vi.fn(async () => {}), quitAndInstall: vi.fn(async () => {}) }));
vi.mock('../store.js', () => ({
  useWhatsNew: (selector: (value: typeof state) => unknown) => selector(state),
  useUpdates: (selector: (value: typeof updates) => unknown) => selector(updates)
}));
vi.mock('../lib/product-client.js', () => ({ product: { updates: productApi } }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));
import { WhatsNewModal } from './WhatsNewModal.js';

afterEach(() => {
  cleanup();
  state.open = true;
  state.notes = [{ version: '2.3.0', markdown: '# Release 2.3.0' }];
  state.toVersion = '2.3.0';
  state.preview = false;
  state.close.mockClear();
  updates.status = { kind: 'idle' };
  productApi.download.mockClear();
  productApi.quitAndInstall.mockClear();
});

describe('WhatsNewModal update preview', () => {
  it('offers "Update now" for an available update and starts the install', () => {
    state.preview = true;
    updates.status = { kind: 'available' };
    render(<WhatsNewModal />);
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(state.close).toHaveBeenCalledOnce();
    expect(productApi.download).toHaveBeenCalledWith({ installNow: true });
  });

  it('offers "Restart now" once the update is staged', () => {
    state.preview = true;
    updates.status = { kind: 'downloaded' };
    render(<WhatsNewModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(productApi.quitAndInstall).toHaveBeenCalledOnce();
    expect(productApi.download).not.toHaveBeenCalled();
  });

  it('"Later" just closes', () => {
    state.preview = true;
    updates.status = { kind: 'available' };
    render(<WhatsNewModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(state.close).toHaveBeenCalledOnce();
    expect(productApi.download).not.toHaveBeenCalled();
  });

  it('falls back to "Got it" when the previewed update is no longer actionable', () => {
    state.preview = true;
    updates.status = { kind: 'downloading' };
    render(<WhatsNewModal />);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  });
});

describe('WhatsNewModal video', () => {
  it('shows the walkthrough with the release notes and closes normally', () => {
    render(<WhatsNewModal />);
    expect(screen.getByRole('dialog', { name: 'What’s new in v2.3.0' })).toBeTruthy();
    expect(screen.getByLabelText('Use Zana everywhere walkthrough')).toBeTruthy();
    expect(screen.getByText('# Release 2.3.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(state.close).toHaveBeenCalledOnce();
  });

  it('unmounts the player when the notes close', () => {
    const { rerender } = render(<WhatsNewModal />);
    state.open = false;
    rerender(<WhatsNewModal />);
    expect(screen.queryByLabelText('Use Zana everywhere walkthrough')).toBeNull();
  });

  it('does not open an empty release list', () => {
    state.notes = [];
    render(<WhatsNewModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps media attached to its version when browsing older notes', () => {
    state.toVersion = null;
    state.notes.push({ version: '2.2.0', markdown: '# Previous release' });
    render(<WhatsNewModal />);
    expect(screen.getByRole('dialog', { name: 'What’s new' })).toBeTruthy();
    expect(screen.getAllByLabelText('Use Zana everywhere walkthrough')).toHaveLength(1);
    expect(screen.getByText('v2.2.0')).toBeTruthy();
    expect(screen.getByText('# Previous release')).toBeTruthy();
  });
});
