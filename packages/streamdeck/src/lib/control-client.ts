/**
 * Client for the running app's control plane (the UDS at ~/.zcc/control.sock).
 *
 * This is a near-verbatim port of `@zcc/cli`'s `lib/control-client.ts` — the
 * same token/nonce handshake, the same resolve-to-result (never-reject)
 * contract, the same caller-class attestation. It lives here (rather than being
 * imported from @zcc/cli) so the deck daemon has no dependency on the CLI's
 * build; the two are expected to drift only if the wire protocol changes, in
 * which case both update together.
 *
 * Why the control plane and not MCP: the deck needs a LIVE agent list and a
 * write path (send a message, reply to a prompt). Both are first-class control
 * ops — `agent.list` / `term.list` (read) and `agent.send` / `term.reply`
 * (write) — so the daemon speaks the same protocol the CLI does rather than
 * standing up an MCP transport. The mutating ops are operator-class only; a
 * physical keypress is treated as the operator (no `ZCC_SESSION_ID` in a
 * standalone daemon's env), which is exactly the privilege a hardware button
 * should carry.
 */

import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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
  /** Data dir holding control.sock + control.token. Defaults to the resolved dir. */
  dataDir?: string;
  op: string;
  args?: Record<string, unknown>;
  /** Override the caller-session marker (tests). Defaults to process.env.ZCC_SESSION_ID. */
  callerSessionId?: string;
  callerCredential?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
}

interface TokenFile {
  token: string;
  nonce: string;
  socket: string;
}

/**
 * The default data dir, preferring the post-rebrand `~/.zcc` with a fallback to
 * the legacy `~/.cc-center` — mirrors `@zcc/cli`'s resolution so the deck reads
 * the same store the app writes.
 */
export function resolveDataDir(): string {
  const next = join(homedir(), '.zcc');
  const legacy = join(homedir(), '.cc-center');
  if (existsSync(next)) return next;
  if (existsSync(legacy)) return legacy;
  return next;
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
  const dataDir = opts.dataDir ?? resolveDataDir();
  return new Promise((resolve) => {
    const tok = readControlToken(dataDir);
    if (!tok || !existsSync(tok.socket)) {
      resolve({
        ok: false,
        code: 'APP_NOT_RUNNING',
        message: 'Zana Command Center is not running (no control socket). Open the app and retry.'
      });
      return;
    }

    const callerSessionId = opts.callerSessionId ?? process.env.ZCC_SESSION_ID ?? undefined;
    const callerCredential = opts.callerCredential ?? process.env.ZCC_SESSION_TOKEN ?? undefined;

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
      done({
        ok: false,
        code: 'SOCKET_ERR',
        message: err instanceof Error ? err.message : String(err)
      })
    );
    socket.on('end', () => {
      if (settled || !chunks.length) return;
      try {
        const resp = JSON.parse(
          Buffer.concat(chunks).toString('utf8').trim()
        ) as ControlClientResult;
        done(resp);
      } catch {
        done({ ok: false, code: 'BAD_RESPONSE', message: 'malformed response from control plane' });
      }
    });
  });
}
