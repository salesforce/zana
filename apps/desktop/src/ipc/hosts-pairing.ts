import { IPC, type CcApi } from '@zana-ai/zcc-desktop-contract';
import type { PairingTarget } from '@zana-ai/zcc-contracts/runtime';
import { sanitizeSshHost } from '@zana-ai/zcc-domain/machine-pairing';
import { ctx } from './ctx.js';
import { productServerUrl } from '../window/renderer-url.js';
import {
  authorizeSshPairing,
  sshPairingSession
} from '@zana-ai/zcc-host-daemon/ssh-pairing-pty';

type HostPairingStartResult = Awaited<ReturnType<CcApi['hosts']['pairing']['start']>>;

const NO_SUPERVISOR_TARGET: PairingTarget = { kind: 'tunnel', reason: 'relay_offline' };
const START_FAILED = 'Could not start SSH pairing';

let pairingListenersBound = false;

function bindPairingListeners(): void {
  if (pairingListenersBound) return;
  pairingListenersBound = true;
  sshPairingSession.on('data', (data: string) => {
    ctx.safeSend(IPC.hosts.pairingOnData, data);
  });
  sshPairingSession.on('exit', (code: number) => {
    ctx.safeSend(IPC.hosts.pairingOnExit, code);
  });
}

async function resolvePairingTarget(): Promise<PairingTarget> {
  const supervisor = ctx.runtimeSupervisor as { pairingTarget?: () => Promise<PairingTarget> } | null | undefined;
  if (typeof supervisor?.pairingTarget !== 'function') return NO_SUPERVISOR_TARGET;
  try {
    return await supervisor.pairingTarget();
  } catch {
    return NO_SUPERVISOR_TARGET;
  }
}

/**
 * Relay/direct targets install over a one-shot SSH PTY that joins the public
 * origin. With no usable public origin, the renderer hands off to the
 * host-scoped bootstrap stream, which installs through the persistent tunnel —
 * no session-bound PTY tunnel is opened here.
 */
export async function startHostPairing(req: unknown): Promise<HostPairingStartResult> {
  const target = await resolvePairingTarget();
  if (target.kind === 'tunnel') {
    const body = req && typeof req === 'object' ? req as Record<string, unknown> : {};
    const host = typeof body.sshHost === 'string' ? sanitizeSshHost(body.sshHost) : null;
    if (!host) return { ok: false, message: 'Choose a valid SSH host' };
    return { ok: true, handoff: 'tunnel', reason: target.reason };
  }
  const authorized = authorizeSshPairing(req, {
    localServerUrl: productServerUrl(),
    publicServerUrl: target.serverUrl
  });
  if (!authorized.ok) return authorized;
  try {
    sshPairingSession.start(authorized);
    return { ok: true, handoff: 'pty' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : START_FAILED };
  }
}

export function registerHostsPairingIpc(): void {
  bindPairingListeners();

  ctx.safeHandle(
    IPC.hosts.pairingStart,
    (req: unknown): Promise<HostPairingStartResult> => startHostPairing(req),
    (): HostPairingStartResult => ({ ok: false, message: START_FAILED })
  );
  ctx.safeHandle(IPC.hosts.pairingWrite, (data: unknown) => {
    sshPairingSession.write(data);
  }, () => undefined);
  ctx.safeHandle(IPC.hosts.pairingResize, (cols: unknown, rows: unknown) => {
    sshPairingSession.resize(cols, rows);
  }, () => undefined);
  ctx.safeHandle(IPC.hosts.pairingStop, () => {
    sshPairingSession.stop();
  }, () => undefined);
  ctx.safeHandle(
    IPC.hosts.pairingStatus,
    () => sshPairingSession.status(),
    () => ({ running: false, sshHost: null, backlog: '', exitCode: null })
  );
}
