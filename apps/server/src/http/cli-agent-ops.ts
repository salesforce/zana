import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result, TerminalSession } from '@zana-ai/zcc-domain/product';

const CONTROL_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
export const PRODUCT_SERVER_CREDENTIAL_ENV = 'ZCC_PRODUCT_SERVER_CREDENTIAL';
let bootCredential: string | undefined;
export function retainProductServerCredential(credential: string | undefined): void {
  bootCredential = credential;
}
function productServerCredential(): string | undefined {
  return bootCredential ?? process.env[PRODUCT_SERVER_CREDENTIAL_ENV];
}
export function productServerHasDesktopCredential(): boolean {
  return Boolean(productServerCredential());
}

interface ControlToken {
  token: string;
  nonce: string;
  socket: string;
}

async function readControlToken(dataDir: string): Promise<ControlToken | null> {
  try {
    const value = JSON.parse(await readFile(join(dataDir, 'control.token'), 'utf8')) as Partial<ControlToken>;
    return typeof value.token === 'string' && typeof value.nonce === 'string' && typeof value.socket === 'string'
      ? { token: value.token, nonce: value.nonce, socket: value.socket }
      : null;
  } catch {
    return null;
  }
}

function disconnected(message = 'Host is not connected') {
  return { ok: false as const, code: 'host_disconnected', message };
}

export async function callControlAsProductServer(
  dataDir: string,
  op: string,
  args: Record<string, unknown>,
  timeoutMs = CONTROL_TIMEOUT_MS
): Promise<unknown> {
  const token = await readControlToken(dataDir);
  if (!token) return disconnected();
  const callerCredential = productServerCredential();
  return new Promise((resolve) => {
    const socket = connect(token.socket);
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const done = (value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(disconnected('CLI Agent operation timed out')), timeoutMs);
    socket.on('connect', () => {
      socket.write(JSON.stringify({
        token: token.token,
        nonce: token.nonce,
        op,
        args,
        ...(callerCredential ? { callerCredential } : {})
      }) + '\n');
    });
    socket.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        done(disconnected('Invalid CLI Agent operation response'));
        return;
      }
      chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const newline = body.indexOf(0x0a);
      if (newline < 0) return;
      try {
        done(JSON.parse(body.subarray(0, newline).toString('utf8')));
      } catch {
        done(disconnected('Invalid CLI Agent operation response'));
      }
    });
    socket.on('error', () => done(disconnected()));
    socket.on('end', () => {
      if (settled) return;
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8').trim()));
      } catch {
        done(disconnected('Invalid CLI Agent operation response'));
      }
    });
  });
}

export interface ProductCliAgentCreateInput {
  projectId: string;
  hostId?: string;
  profile: string;
  prompt?: string;
  personaId?: string;
  extraArgs?: string[];
  harnessRouting?: unknown;
  worktree?: boolean | { branch?: string };
  environment?: string;
  isolateScratch?: boolean | string;
  title?: string;
  cols?: number;
  rows?: number;
}

export interface ProductCliAgentRecord {
  id: string;
  projectId: string;
  hostId?: string;
  profile: string;
  title?: string;
  status: string;
  pid?: number;
}

export interface ProductCliAgentOps {
  invalidateModelCatalog?(providerId: string): Promise<unknown>;
  create(input: ProductCliAgentCreateInput): Promise<unknown>;
  status(sessionId: string): Promise<unknown>;
  list(projectId?: string): Promise<unknown>;
  get(sessionId: string): Promise<unknown>;
  reply(sessionId: string, text: string): Promise<unknown>;
  close(sessionId: string): Promise<unknown>;
}

export function createCliAgentOpsViaControl(dataDir: string): ProductCliAgentOps {
  return {
    invalidateModelCatalog: async (providerId) => {
      // Standalone servers have no desktop cache. The boot-only credential
      // identifies the desktop-attached case without exposing it to renderers.
      if (!productServerCredential()) return;
      const result = asControlResult(await callControlAsProductServer(dataDir, 'harness.models.invalidate', { providerId }, 5_000));
      if (!result.ok) throw new Error(`Desktop model cache could not be refreshed: ${result.message}`);
    },
    create: (input) => callControlAsProductServer(dataDir, 'term.create', { ...input }),
    status: (sessionId) => callControlAsProductServer(dataDir, 'session.status', { sessionId }),
    list: (projectId) => callControlAsProductServer(dataDir, 'term.list', projectId ? { projectId } : {}),
    get: (sessionId) => callControlAsProductServer(dataDir, 'term.get', { sessionId }),
    reply: (sessionId, text) => callControlAsProductServer(dataDir, 'term.reply', { sessionId, text }),
    close: (sessionId) => callControlAsProductServer(dataDir, 'term.close', { sessionId })
  };
}

export function asControlResult<T>(value: unknown): Result<T> {
  if (value && typeof value === 'object' && 'ok' in value) return value as Result<T>;
  return disconnected() as Result<T>;
}

export function sessionToCliAgent(
  session: Pick<TerminalSession, 'id' | 'projectId' | 'hostId' | 'profile' | 'title' | 'pid'>,
  status: string
): ProductCliAgentRecord {
  return {
    id: session.id,
    projectId: session.projectId,
    ...(session.hostId ? { hostId: session.hostId } : {}),
    profile: session.profile,
    title: session.title,
    status,
    pid: typeof session.pid === 'number' ? session.pid : undefined
  };
}

/**
 * Agent-status is dropped on PTY exit. A remembered exited session must still
 * present as `exited` so wait({ until: 'idle' }) succeeds instead of 404.
 */
export function cliAgentPresentationStatus(
  session: { status?: string },
  controlStatus: string | undefined
): string {
  if (session.status === 'exited') return 'exited';
  return controlStatus ?? session.status ?? 'unknown';
}
