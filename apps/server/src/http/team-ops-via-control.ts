import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ProductTeamCaller,
  ProductTeamLaunchInput,
  ProductTeamOps
} from '@zana-ai/zcc-domain/product';

const CONTROL_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

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

async function callControl(
  dataDir: string,
  op: string,
  args: Record<string, unknown>,
  caller?: ProductTeamCaller
): Promise<unknown> {
  const token = await readControlToken(dataDir);
  if (!token) return disconnected();
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
    const timer = setTimeout(() => done(disconnected('Team operation timed out')), CONTROL_TIMEOUT_MS);
    socket.on('connect', () => {
      socket.write(JSON.stringify({
        token: token.token,
        nonce: token.nonce,
        op,
        args,
        ...(caller?.callerSessionId ? { callerSessionId: caller.callerSessionId } : {}),
        ...(caller?.callerCredential ? { callerCredential: caller.callerCredential } : {})
      }) + '\n');
    });
    socket.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        done(disconnected('Invalid Team operation response'));
        return;
      }
      chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const newline = body.indexOf(0x0a);
      if (newline < 0) return;
      try {
        done(JSON.parse(body.subarray(0, newline).toString('utf8')));
      } catch {
        done(disconnected('Invalid Team operation response'));
      }
    });
    socket.on('error', () => done(disconnected()));
    socket.on('end', () => {
      if (settled) return;
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8').trim()));
      } catch {
        done(disconnected('Invalid Team operation response'));
      }
    });
  });
}

export function createTeamOpsViaControl(dataDir: string): ProductTeamOps {
  return {
    launch: (input, caller) => callControl(dataDir, 'team.launch', launchArgs(input), caller) as ReturnType<ProductTeamOps['launch']>,
    status: (id, caller) => callControl(dataDir, 'team.status', { id }, caller) as ReturnType<ProductTeamOps['status']>,
    answer: (input, caller) => callControl(dataDir, 'team.answer', { ...input }, caller) as ReturnType<ProductTeamOps['answer']>,
    stop: (id, expectedStateVersion, caller) => callControl(dataDir, 'team.stop', {
      id,
      ...(expectedStateVersion !== undefined ? { expectedStateVersion } : {})
    }, caller) as ReturnType<ProductTeamOps['stop']>
  };
}

function launchArgs(input: ProductTeamLaunchInput): Record<string, unknown> {
  return { ...input };
}
