import { createHmac, timingSafeEqual } from 'node:crypto';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createServer, type Server, type ServerResponse } from 'node:http';
import {
  ExecutionEventSchema,
  HostRegistrationSchema,
  SignedExecutionCommandSchema,
  type ExecutionEvent,
  type SignedExecutionCommand
} from '@zana-ai/zcc-contracts/execution';
import { SignedTerminalHostCommandSchema } from '@zana-ai/zcc-contracts/terminal-execution';
import { canonicalJson } from '@zana-ai/zcc-contracts/canonical-json';
import { rejectMalformedExecutionCommand } from './index.js';
import { HostTerminalManager } from './terminal-manager.js';

export interface HostDaemon {
  readonly url: string;
  close(): Promise<void>;
}

export interface StartHostDaemonOptions {
  token: string;
  signingKey: string;
  host?: string;
  port?: number;
  terminalManager?: HostTerminalManager;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 1_000_000) throw new Error('request too large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function commandBytes(command: SignedExecutionCommand['command']): string {
  return canonicalJson(command);
}

function hasValidSignature(command: SignedExecutionCommand, signingKey: string): boolean {
  const expected = createHmac('sha256', signingKey).update(commandBytes(command.command)).digest();
  const received = Buffer.from(command.signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function hasValidTerminalSignature(command: { command: unknown; signature: string }, signingKey: string): boolean {
  const expected = createHmac('sha256', signingKey).update(canonicalJson(command.command)).digest();
  const received = Buffer.from(command.signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function toEvent(value: unknown): ExecutionEvent | null {
  const parsed = ExecutionEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function startCommand(command: SignedExecutionCommand['command']): ChildProcessByStdio<null, Readable, Readable> {
  const [file, ...args] = command.launch.argv;
  if (!file) throw new Error('argv must contain an executable');
  return spawn(file, args, {
    cwd: command.launch.cwd,
    env: command.launch.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/**
 * The daemon never accepts a launch plan directly from a renderer. It accepts
 * only a token-authenticated, HMAC-signed, unexpired command from its paired
 * server and reports bounded process output in the response stream.
 */
export async function startHostDaemon(options: StartHostDaemonOptions): Promise<HostDaemon> {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || (request.url !== '/commands' && request.url !== '/terminals')) {
      json(response, 404, { error: 'not found' });
      return;
    }

    const token = HostRegistrationSchema.safeParse({ token: request.headers.authorization?.replace(/^Bearer\s+/i, '') });
    if (!token.success || token.data.token !== options.token) {
      json(response, 401, { error: 'unauthorized' });
      return;
    }

    let input: unknown;
    try {
      input = await readJson(request);
    } catch {
      json(response, 400, { error: 'invalid JSON' });
      return;
    }
    if (request.url === '/terminals') {
      const signedTerminal = SignedTerminalHostCommandSchema.safeParse(input);
      if (!signedTerminal.success) {
        json(response, 400, { error: 'invalid terminal command' });
        return;
      }
      if (!hasValidTerminalSignature(signedTerminal.data, options.signingKey)) {
        json(response, 403, { error: 'invalid terminal command' });
        return;
      }
      if (!options.terminalManager) {
        json(response, 501, { error: 'terminal host is unavailable' });
        return;
      }
      try {
        json(response, 200, { events: options.terminalManager.handle(signedTerminal.data.command) });
      } catch (error) {
        json(response, 400, { error: error instanceof Error ? error.message : 'terminal command failed' });
      }
      return;
    }
    const signed = SignedExecutionCommandSchema.safeParse(input);
    if (!signed.success) {
      const rejected = rejectMalformedExecutionCommand(
        typeof input === 'object' && input !== null && 'command' in input ? input.command : input
      );
      json(response, 400, rejected ?? { error: 'invalid signed command' });
      return;
    }
    if (!hasValidSignature(signed.data, options.signingKey)) {
      json(response, 403, { error: 'invalid signature' });
      return;
    }
    if (Date.parse(signed.data.command.deadlineAt) <= Date.now()) {
      json(response, 410, { error: 'command expired' });
      return;
    }

    const events: ExecutionEvent[] = [];
    const accepted = toEvent({ kind: 'accepted', commandId: signed.data.command.commandId, sessionId: signed.data.command.sessionId });
    if (accepted) events.push(accepted);
    try {
      const child = startCommand(signed.data.command);
      let sequence = 0;
      const appendOutput = (data: Buffer) => {
        if (events.length >= 258) return;
        const event = toEvent({
          kind: 'output',
          commandId: signed.data.command.commandId,
          sessionId: signed.data.command.sessionId,
          data: data.toString('utf8').slice(0, 64 * 1024),
          sequence: sequence++
        });
        if (event) events.push(event);
      };
      child.stdout.on('data', appendOutput);
      child.stderr.on('data', appendOutput);
      const code = await new Promise<number | null>((resolveExit) => {
        child.once('error', () => resolveExit(null));
        child.once('exit', (exitCode) => resolveExit(exitCode));
      });
      const exited = toEvent({ kind: 'exited', commandId: signed.data.command.commandId, sessionId: signed.data.command.sessionId, code });
      if (exited) events.push(exited);
      json(response, 200, { events });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : 'execution failed' });
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Host daemon did not bind a TCP address');
  }
  return {
    url: `http://${options.host ?? '127.0.0.1'}:${address.port}`,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    })
  };
}
