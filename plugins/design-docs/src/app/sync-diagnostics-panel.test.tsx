// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SyncDiagnostics } from './api.js';
import { formatDiagnostics, SyncDiagnosticsPanel } from './SyncDiagnosticsPanel.js';
import { copyText } from './clipboard.js';

const data: SyncDiagnostics = {
  counts: { total: 147, byStatus: { draft: 100, approved: 47 }, byProject: {}, unmapped: 38 },
  queue: [],
  peers: [{ replicaId: 'r2', peerId: 'app-2', queueDepth: 2, queuedDocs: 2, failed: 1, waiting: 1, oldestQueuedAt: 1000,
    recentErrors: [{ docId: 'dd_1', error: 'peer request failed: 409 token=SECRET123', at: 2000, attempts: 3 }] }]
};
const api = vi.hoisted(() => ({ syncDiagnostics: vi.fn() }));
vi.mock('./api.js', async (original) => ({ ...(await original<typeof import('./api.js')>()), useApi: () => api, toast: vi.fn() }));
vi.mock('./clipboard.js', () => ({ copyText: vi.fn(async () => true) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('formatDiagnostics', () => {
  it('prints counts, queue and redacted errors', () => {
    const text = formatDiagnostics(data, (id) => `Computer ${id}`, 5000);
    expect(text).toContain('147 docs, 38 unmapped');
    expect(text).toContain('queued 2 (2 docs): 1 failed, 1 waiting');
    expect(text).toContain('dd_1 x3');
    expect(text).not.toContain('SECRET123');
  });
  it('handles an empty queue and the default name', () => {
    expect(formatDiagnostics({ ...data, peers: [{ ...data.peers[0]!, queueDepth: 0, oldestQueuedAt: null, recentErrors: [] }] })).toContain('queued 0');
  });
});

describe('SyncDiagnosticsPanel', () => {
  it('shows per-computer queue and errors, and copies', async () => {
    api.syncDiagnostics.mockResolvedValue(data);
    render(<SyncDiagnosticsPanel nameOf={(id) => `Name ${id}`} />);
    expect(await screen.findByText('This computer: 147 docs, 38 unmapped')).toBeTruthy();
    expect(screen.getByText(/2 queued for 2 docs \(1 failed, 1 waiting\)/)).toBeTruthy();
    expect(screen.getByText(/dd_1: peer request failed: 409/).textContent).not.toContain('SECRET123');
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining('Name app-2')));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.syncDiagnostics).toHaveBeenCalledTimes(2));
  });
  it('says so quietly when the read fails, and shows nothing queued', async () => {
    api.syncDiagnostics.mockRejectedValueOnce(new Error('boom'));
    const { unmount } = render(<SyncDiagnosticsPanel nameOf={(id) => id} />);
    expect((await screen.findByTestId('diagnostics-unavailable')).textContent).toContain('boom');
    unmount();
    api.syncDiagnostics.mockResolvedValue({ ...data, counts: { ...data.counts, unmapped: 0 }, peers: [{ ...data.peers[0]!, queueDepth: 0, oldestQueuedAt: null, recentErrors: [] }] });
    render(<SyncDiagnosticsPanel nameOf={(id) => id} />);
    expect(await screen.findByText('Nothing queued')).toBeTruthy();
    expect(screen.getByText('This computer: 147 docs')).toBeTruthy();
  });
});
