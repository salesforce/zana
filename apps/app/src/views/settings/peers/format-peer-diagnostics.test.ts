import { describe, expect, it } from 'vitest';
import type { PeerLink, PeerLinkDiagnostic } from '@zana-ai/zcc-server-contract';
import { formatPeerDiagnostics } from './format-peer-diagnostics.js';

const link = (over: Partial<PeerLink> = {}): PeerLink => ({ hostId: 'h1', peerInstanceId: 'p1', peerName: 'Studio', state: 'linked', connected: true, uses: [], ...over });
const diag = (over: Partial<PeerLinkDiagnostic> = {}): PeerLinkDiagnostic => ({
  peerInstanceId: 'p1', role: 'inviter', phase: 'linked', side: 'server', state: 'connected', paused: false, forwarderBlocked: null, tunnel: null, session: null, retries: 0, ...over
});
const NOW = new Date('2026-01-01T00:00:00Z');

describe('formatPeerDiagnostics', () => {
  it('reports an empty list', () => {
    expect(formatPeerDiagnostics([], [], NOW)).toBe('Peers diagnostics 2026-01-01T00:00:00.000Z\nlinks: 0');
  });

  it('says there is no live detail for a link without diagnostics, and an unclaimed link', () => {
    const text = formatPeerDiagnostics([link({ peerInstanceId: null, state: 'failed', reason: 'bad', connected: false, paused: true })], [], NOW);
    expect(text).toContain('Studio [unclaimed]');
    expect(text).toContain('failed (bad); not connected; paused; used by nothing');
    expect(text).toContain('no live detail');
  });

  it('lists plugin uses and a healthy connection', () => {
    const text = formatPeerDiagnostics([link({ uses: [{ pluginId: 'a', label: 'A', scope: 's', since: 1 }, { pluginId: 'b', label: 'B', scope: 's', since: 1 }] })],
      [diag({ tunnel: { up: true, downForMs: null }, session: { connected: true, downForMs: null, openForMs: 45_000 } })], NOW);
    expect(text).toContain('used by a, b');
    expect(text).toContain('connection: connected; role inviter');
    expect(text).toContain('forwarder: ok');
    expect(text).toContain('tunnel: up');
    expect(text).toContain('session: open 45s');
  });

  it('shows reason, blocked forwarder, tunnel failure and a down session with scaled durations', () => {
    const text = formatPeerDiagnostics([link({ connected: false })], [diag({ state: 'disconnected', reason: 'ssh-down', forwarderBlocked: 'EADDRINUSE',
      tunnel: { up: false, downForMs: 120_000, failure: 'refused' }, session: { connected: false, downForMs: 3 * 3_600_000, openForMs: null }, retries: 3 })], NOW);
    expect(text).toContain('disconnected (ssh-down)');
    expect(text).toContain('forwarder: BLOCKED: EADDRINUSE');
    expect(text).toContain('down 2m; failure refused');
    expect(text).toContain('session: down 3h');
    expect(text).toContain('retries 3');
  });

  it('prints n/a for unknown durations and a tunnel down without a failure', () => {
    const text = formatPeerDiagnostics([link()], [diag({ tunnel: { up: false, downForMs: null }, session: { connected: false, downForMs: null, openForMs: null } })], NOW);
    expect(text).toContain('tunnel: down n/a');
    expect(text).toContain('session: down n/a');
  });
});
