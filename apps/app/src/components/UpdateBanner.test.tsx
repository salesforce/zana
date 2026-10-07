// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Status = { kind: string; version?: string; releaseNotes?: Array<{ version?: string; markdown: string }> };
const updates = vi.hoisted(() => ({ status: { kind: 'available', version: '2.3.4' } as Status, progress: null }));
const openWith = vi.hoisted(() => vi.fn());
vi.mock('../store.js', () => ({
  useUpdates: (selector: (value: typeof updates) => unknown) => selector(updates),
  useUpdateBanner: (selector: (value: { dismissed: boolean; dismiss: () => void }) => unknown) =>
    selector({ dismissed: false, dismiss: () => {} }),
  useWhatsNew: { getState: () => ({ openWith }) },
  isUpdateBannerVisible: (kind: string) => kind === 'available' || kind === 'downloading' || kind === 'downloaded'
}));
vi.mock('../lib/product-client.js', () => ({ product: { updates: { download: vi.fn(), skip: vi.fn(), quitAndInstall: vi.fn() } } }));
import { UpdateBanner } from './UpdateBanner.js';

const notes = [{ version: '2.3.4', markdown: '# What’s new in 2.3.4' }];

afterEach(() => {
  cleanup();
  openWith.mockClear();
  updates.status = { kind: 'available', version: '2.3.4' };
});

describe('UpdateBanner release notes', () => {
  it('previews the offered version’s notes before installing', () => {
    updates.status = { kind: 'available', version: '2.3.4', releaseNotes: notes };
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'What’s new' }));
    expect(openWith).toHaveBeenCalledWith(notes, '2.3.4', { preview: true });
  });

  it('keeps the action once the update is staged', () => {
    updates.status = { kind: 'downloaded', version: '2.3.4', releaseNotes: notes };
    render(<UpdateBanner />);
    expect(screen.getByRole('button', { name: 'What’s new' })).toBeTruthy();
  });

  it.each(['2.3.4', undefined])('uses note metadata when the offered version is absent (%s)', noteVersion => {
    const unversioned = [{ version: noteVersion, markdown: '# Update details' }];
    updates.status = { kind: 'available', releaseNotes: unversioned };
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'What’s new' }));
    expect(openWith).toHaveBeenCalledWith(unversioned, noteVersion ?? null, { preview: true });
    expect((screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the action when the feed carried no notes', () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeTruthy();
  });

  it('hides the action while downloading', () => {
    updates.status = { kind: 'downloading', version: '2.3.4', releaseNotes: notes };
    render(<UpdateBanner />);
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();
  });
});
