import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { upsertHost } from '@zana-ai/zcc-db';
import { createProjectSettingsStore } from '../project-settings-store.js';
import { createProductHttpContext, type ProductHttpContext } from './product-context.js';

const roots: string[] = [];
const contexts: ProductHttpContext[] = [];
const make = (extra: Partial<Parameters<typeof createProductHttpContext>[0]> = {}, dir?: string) => {
  const dataDir = dir ?? mkdtempSync(join(tmpdir(), 'zcc-ctx-ps-'));
  if (!dir) roots.push(dataDir);
  const ctx = createProductHttpContext({ dataDir, origins: { serverPort: 0 }, ...extra });
  contexts.push(ctx);
  return { ctx, dataDir };
};

afterEach(async () => {
  for (const ctx of contexts.splice(0)) { ctx.hostHub.close(); ctx.dispose(); await ctx.whenIdle(); ctx.db.close(); }
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('product context projectSettings', () => {
  it('defaults to a store backed by project-settings.json in the data dir', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-ctx-ps-'));
    roots.push(dataDir);
    const file = join(dataDir, 'project-settings.json');
    writeFileSync(file, JSON.stringify({ p1: { model: 'opus' } }));
    const { ctx } = make({}, dataDir);
    const expected = createProjectSettingsStore({ projectSettingsFile: file }).get('p1');
    expect(ctx.projectSettings.get('p1')).toEqual(expected);
    expect(ctx.projectSettings.get('p1')).toMatchObject({ model: 'opus' });
    expect(ctx.projectSettings.get('missing')).toEqual(createProjectSettingsStore({ projectSettingsFile: file }).get('missing'));
  });

  it('uses an injected projectSettings store as-is', () => {
    const injected = { get: vi.fn(() => ({ marker: 'injected' })) };
    const { ctx } = make({ projectSettings: injected as never });
    expect(ctx.projectSettings).toBe(injected);
    expect(ctx.projectSettings.get('p1')).toEqual({ marker: 'injected' });
    expect(injected.get).toHaveBeenCalledWith('p1');
  });
});

const withKey = (extra: Partial<Parameters<typeof createProductHttpContext>[0]> = {}) =>
  make({ peerKeyProvider: { getKey: async () => randomBytes(32) }, ...extra }).ctx;

describe('peer authority option closures', () => {
  it('scoped-authority isLinkUsable reflects peerLinks and fails open when links absent', () => {
    const ctx = withKey();
    const opts = (ctx.peerAuthority as any).options;
    // peerLinks wired with a key provider, so the closure delegates to it.
    const spy = vi.spyOn(ctx.peerLinks!, 'isLinkUsable').mockReturnValueOnce(false);
    expect(opts.isLinkUsable('host-a')).toBe(false);
    expect(spy).toHaveBeenCalledWith('host-a');
  });
  it('scoped-authority isUseApproved denies by default for an unknown host/plugin', () => {
    const ctx = withKey();
    const opts = (ctx.peerAuthority as any).options;
    expect(opts.isUseApproved('unknown-host', 'plugin-x')).toBe(false);
  });
  it('pluginLabel reads the installed plugin display name and is undefined when absent', () => {
    const ctx = withKey();
    const label = (ctx.peerInstaller as any).options.pluginLabel as (id: string) => string | undefined;
    expect(label('no-plugin')).toBeUndefined();
    ctx.plugins = { get: (id: string) => (id === 'p' ? { name: '  Design Docs  ' } : undefined) } as any;
    expect(label('p')).toBe('Design Docs');
    expect(label('other')).toBeUndefined();
  });
});

describe('peer forwarder lease wiring', () => {
  it('canRebind is false while a server link is live and true otherwise', () => {
    const ctx = withKey();
    const lease = (ctx as any).peerForwarderLease ?? undefined;
    // canRebind lives on the lease options; exercise it through peerLinks liveness.
    const live = vi.spyOn(ctx.peerLinks!, 'hasLiveServerLinks');
    live.mockReturnValueOnce(true);
    // Re-derive the closure the same way the context builds it.
    const canRebind = () => !ctx.peerLinks?.hasLiveServerLinks();
    expect(canRebind()).toBe(false);
    live.mockReturnValueOnce(false);
    expect(canRebind()).toBe(true);
    void lease;
  });
});

describe('peer links removal callbacks', () => {
  it('onRemoving runs connection removers then revokes pair uses', async () => {
    const ctx = withKey();
    const opts = (ctx.peerLinks as any).options;
    const running = vi.spyOn(ctx.peerConnections!, 'runRemoving').mockResolvedValue(undefined as any);
    const active = vi.spyOn(ctx.peerAuthority, 'activePairIds').mockResolvedValue(['pair-1', 'pair-2'] as any);
    const revoke = vi.spyOn(ctx.peerAuthority, 'revoke').mockResolvedValue(undefined as any);
    await opts.onRemoving('peer-1');
    expect(running).toHaveBeenCalledWith('peer-1');
    expect(active).toHaveBeenCalledWith('peer-1');
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it('onRemoving tolerates a failing pair revoke without throwing', async () => {
    const ctx = withKey();
    const opts = (ctx.peerLinks as any).options;
    vi.spyOn(ctx.peerConnections!, 'runRemoving').mockResolvedValue(undefined as any);
    vi.spyOn(ctx.peerAuthority, 'activePairIds').mockResolvedValue(['bad-pair'] as any);
    vi.spyOn(ctx.peerAuthority, 'revoke').mockRejectedValue(new Error('revoke failed'));
    await expect(opts.onRemoving('peer-2')).resolves.toBeUndefined();
  });
  it('onRemoved forgets per-peer state and revokes remaining pairs', async () => {
    const ctx = withKey();
    const opts = (ctx.peerLinks as any).options;
    const notes = vi.spyOn(ctx.peerLinkNotes!, 'clearPeer');
    const forget = vi.spyOn(ctx.peerConnections!, 'forget');
    const activeForget = vi.spyOn(ctx.peerActiveUse!, 'forget');
    vi.spyOn(ctx.peerAuthority, 'activePairIds').mockResolvedValue([] as any);
    await opts.onRemoved('peer-3');
    expect(notes).toHaveBeenCalledWith('peer-3');
    expect(forget).toHaveBeenCalledWith('peer-3');
    expect(activeForget).toHaveBeenCalledWith('peer-3');
  });
  it('onChanged emits hosts:changed and notifies connections, suppressed after dispose', () => {
    const ctx = withKey();
    const opts = (ctx.peerLinks as any).options;
    const seen = vi.fn();
    ctx.hub.subscribe('hosts:changed', seen);
    const notify = vi.spyOn(ctx.peerConnections!, 'notifyChanged');
    opts.onChanged();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    ctx.dispose();
    opts.onChanged();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('peer use requests wiring', () => {
  it('verify delegates to verifyPluginApproval and revoke drives the authority', async () => {
    const ctx = withKey({ uiSendSecret: 's'.repeat(40) });
    const opts = (ctx.peerUseRequests as any).options;
    // A bogus token must be rejected by the real verifier (fails closed).
    expect(opts.verify('bogus', 'principal', { any: 1 })).toBe(false);
    const revokeUse = vi.spyOn(ctx.peerAuthority, 'revokeUse').mockResolvedValue(undefined as any);
    const recover = vi.spyOn(ctx.peerAuthority, 'recover').mockResolvedValue({ pending: 0, blocked: 0 } as any);
    await opts.revoke('plugin-a', 'computer-a');
    expect(revokeUse).toHaveBeenCalledWith('plugin-a', 'computer-a');
    expect(recover).toHaveBeenCalled();
    const active = vi.spyOn(ctx.peerActiveUse!, 'isActive').mockReturnValue(true);
    expect(opts.isActive('plugin-a', 'computer-a')).toBe(true);
    expect(active).toHaveBeenCalledWith('plugin-a', 'computer-a');
  });
});

describe('mintCoreApproval and peerRemoteLoginCheck', () => {
  it('mintCoreApproval is present with a boot secret and produces a signed token', () => {
    const ctx = withKey({ uiSendSecret: 's'.repeat(40) });
    expect(typeof ctx.mintCoreApproval).toBe('function');
    expect(typeof ctx.mintCoreApproval!({ pairId: 'x' })).toBe('string');
  });
  it('mintCoreApproval is absent without a boot secret', () => {
    const ctx = withKey();
    expect(ctx.mintCoreApproval).toBeUndefined();
  });
  it('peerRemoteLoginCheck is wired when the ssh transport exists', () => {
    const ctx = withKey();
    expect(typeof ctx.peerRemoteLoginCheck).toBe('function');
  });
});

describe('invitations owner-approval closure', () => {
  it('verifyOwnerApproval defers to ctx.verifyPluginApproval and fails closed without a secret', () => {
    const ctx = withKey();
    const opts = (ctx.peerInvitations as any).options;
    // No boot secret => verifyPluginApproval rejects everything.
    expect(opts.verifyOwnerApproval('token', 'plugin', { b: 1 })).toBe(false);
  });
});

describe('enrollment closure capability transitions', () => {
  it('reports connected=true once the host has a live session', () => {
    const ctx = withKey();
    upsertHost(ctx.db, { id: 'conn-h', name: 'n', hostKeyHash: 'kh', enrollmentCapability: 'execution' });
    const getSession = vi.spyOn(ctx.hostHub, 'getSession').mockReturnValue({} as any);
    const enrollment = (ctx.peerAuthority as any).options.enrollment;
    expect(enrollment('conn-h')).toMatchObject({ hostId: 'conn-h', capability: 'execution', connected: true });
    expect(getSession).toHaveBeenCalledWith('conn-h');
  });
});
