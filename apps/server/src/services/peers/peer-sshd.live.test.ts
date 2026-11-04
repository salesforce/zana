/**
 * LIVE proof that Zana's own unprivileged sshd (PeerSshd) starts from a data directory, accepts only its own
 * authorized_keys, forwards loopback TCP and refuses Unix-socket forwarding — the full Add computer self-test, with no
 * Remote Login, administrator rights or ~/.ssh involvement.
 *
 * GATED OFF BY DEFAULT. Run with:
 *
 *   ZCC_LIVE_SSH=1 pnpm exec vitest run apps/server/src/services/peers/peer-sshd.live.test.ts
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PeerSshd } from './peer-sshd.js';
import { checkRemoteLogin, createLocalEndpoint } from './peer-ssh-local.js';
import { SshAuthorizedKeys } from './ssh-authorized-keys.js';

const LIVE = process.env.ZCC_LIVE_SSH === '1';

describe.skipIf(!LIVE)('live PeerSshd', () => {
  let root: string | undefined;
  let sshd: PeerSshd | undefined;
  afterAll(async () => { sshd?.dispose(); if (root) await rm(root, { recursive: true, force: true }); });

  it('passes the Add computer self-test end to end and keeps its endpoint across restarts', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'zcc-live-peer-sshd-')));
    sshd = new PeerSshd({ directory: join(root, 'peer-sshd') });
    const authorizedKeys = new SshAuthorizedKeys({ instanceId: 'live', authorizedKeysPath: sshd.authorizedKeysPath });
    const localEndpoint = createLocalEndpoint({ authorizedKeys, sshd, env: {} });

    expect(await checkRemoteLogin(localEndpoint, AbortSignal.timeout(25_000))).toEqual({ ok: true });
    const endpoint = await localEndpoint(AbortSignal.timeout(25_000));
    expect(endpoint.port).not.toBe(22);
    expect(await authorizedKeys.list()).toEqual([]);

    sshd.dispose();
    sshd = new PeerSshd({ directory: join(root, 'peer-sshd') });
    const again = await createLocalEndpoint({ authorizedKeys, sshd, env: {} })(AbortSignal.timeout(25_000));
    expect({ port: again.port, hostKey: again.hostKey }).toEqual({ port: endpoint.port, hostKey: endpoint.hostKey });
  }, 60_000);
});
