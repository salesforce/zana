/**
 * Client for the running app's control plane (the UDS at ~/.zcc/control.sock).
 *
 * Unlike the file-store readers (which work whether the app is up or down), the
 * control plane only exists while the desktop app runs — so every call here can
 * fail with APP_NOT_RUNNING, and the CLI surfaces that as a clean error rather
 * than a stack trace.
 *
 * Caller-class attestation: an app terminal receives `ZCC_SESSION_ID` plus a
 * session-bound `ZCC_SESSION_TOKEN`. We forward both; main verifies the token
 * before granting the bounded orchestrator surface. A human shell has neither
 * and reaches mutations only through main's native confirmation ceremony.
 */

import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ControlClientResult {
  ok: boolean;
  /** Parsed `value` on success. */
  value?: unknown;
  /** Error code on failure (APP_NOT_RUNNING, UNAUTHORIZED, FORBIDDEN_AGENT, …). */
  code?: string;
  message?: string;
}

export interface ControlCallOpts {
  /** Data dir holding control.sock + control.token. Defaults under the resolved dir. */
  dataDir: string;
  op: string;
  args?: Record<string, unknown>;
  /** Override the caller-session marker (tests). Defaults to process.env.ZCC_SESSION_ID. */
  callerSessionId?: string;
  /** Override the session-bound credential (tests). Defaults to ZCC_SESSION_TOKEN. */
  callerCredential?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
}

interface TokenFile {
  token: string;
  nonce: string;
  socket: string;
}

/** Read + parse the token file, or null if the app isn't running / it's absent. */
export function readControlToken(dataDir: string): TokenFile | null {
  const tokenPath = join(dataDir, 'control.token');
  if (!existsSync(tokenPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf8')) as Partial<TokenFile>;
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.socket === 'string'
    ) {
      return { token: parsed.token, nonce: parsed.nonce, socket: parsed.socket };
    }
    return null;
  } catch {
    return null;
  }
}

/** True when the control plane appears to be up (socket + readable token). */
export function isAppRunning(dataDir: string): boolean {
  const tok = readControlToken(dataDir);
  return !!tok && existsSync(tok.socket);
}

/**
 * Send one op to the control plane and await its single JSON response. Resolves
 * (never rejects) to a ControlClientResult so callers can branch on `.code`.
 */
export function callControlPlane(opts: ControlCallOpts): Promise<ControlClientResult> {
  return new Promise((resolve) => {
    const tok = readControlToken(opts.dataDir);
    if (!tok || !existsSync(tok.socket)) {
      resolve({
        ok: false,
        code: 'APP_NOT_RUNNING',
        message: 'Zana Command Center is not running (no control socket). Open the app and retry.'
      });
      return;
    }

    const callerSessionId =
      opts.callerSessionId ?? process.env.ZCC_SESSION_ID ?? undefined;
    const callerCredential =
      opts.callerCredential ?? process.env.ZCC_SESSION_TOKEN ?? undefined;

    let settled = false;
    const done = (r: ControlClientResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      resolve(r);
    };

    const timer = setTimeout(
      () => done({ ok: false, code: 'TIMEOUT', message: 'control plane did not respond' }),
      opts.timeoutMs ?? 15_000
    );

    const socket = connect(tok.socket);
    const chunks: Buffer[] = [];

    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          token: tok.token,
          nonce: tok.nonce,
          callerSessionId,
          callerCredential,
          op: opts.op,
          args: opts.args ?? {}
        }) + '\n'
      );
    });
    socket.on('data', (c: Buffer) => {
      chunks.push(c);
      const buf = Buffer.concat(chunks);
      const nl = buf.indexOf(0x0a);
      if (nl === -1) return;
      try {
        const resp = JSON.parse(buf.subarray(0, nl).toString('utf8')) as ControlClientResult;
        done(resp);
      } catch {
        done({ ok: false, code: 'BAD_RESPONSE', message: 'malformed response from control plane' });
      }
    });
    socket.on('error', (err) =>
      done({ ok: false, code: 'SOCKET_ERR', message: err instanceof Error ? err.message : String(err) })
    );
    socket.on('end', () => {
      if (settled || !chunks.length) return;
      try {
        const resp = JSON.parse(Buffer.concat(chunks).toString('utf8').trim()) as ControlClientResult;
        done(resp);
      } catch {
        done({ ok: false, code: 'BAD_RESPONSE', message: 'malformed response from control plane' });
      }
    });
  });
}
