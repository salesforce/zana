import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { productServerUrl } from '../window/renderer-url.js';
import { resolvePublicAppUrl } from '@zana-ai/zcc-server/http/public-app-url';
import {
  authorizeSshPairing,
  sshPairingSession
} from '@zana-ai/zcc-host-daemon/ssh-pairing-pty';

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

export function registerHostsPairingIpc(): void {
  bindPairingListeners();

  ctx.safeHandle(
    IPC.hosts.pairingStart,
    (req: unknown): { ok: true } | { ok: false; message: string } => {
      const authorized = authorizeSshPairing(req, {
        localServerUrl: productServerUrl(),
        publicServerUrl: resolvePublicAppUrl() ?? null
      });
      if (!authorized.ok) return authorized;
      try {
        sshPairingSession.start(authorized);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'Could not start SSH pairing'
        };
      }
    },
    () => ({ ok: false, message: 'Could not start SSH pairing' })
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
