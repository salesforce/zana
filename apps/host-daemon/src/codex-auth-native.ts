import { killProcessGroup, runPortableCommand, spawnPortableProcess } from '@zana-ai/zcc-agent-process-utils';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { augmentPath, augmentPathWithNodePrefixes } from './env.js';
import { HostCommandError } from './host-command-error.js';

const AUTH_OUTPUT_MAX_BYTES = 256 * 1024;
const AUTH_TIMEOUT_MS = 15_000;

export interface CodexNativeAuthOptions {
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawnPortableProcess;
  timeoutMs?: number;
}

function authUnavailable(message: string): HostCommandError {
  return new HostCommandError('codex_keyring_unavailable', message);
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function storedAuth(result: unknown): string | null {
  const auth = object(result);
  if (!auth) throw authUnavailable('Codex returned an invalid authentication response. Update Codex on the host, then try again.');
  if (auth.authMethod === null && auth.authToken === null && auth.requiresOpenaiAuth === true) return null;
  const token = auth.authToken;
  if (typeof token !== 'string' || !token.trim()) {
    throw authUnavailable('Codex could not provide credentials for voice input. Check the Codex login on the host, then try again.');
  }
  if (auth.authMethod === 'apikey') return JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: token });
  if (auth.authMethod === 'chatgpt' || auth.authMethod === 'chatgptAuthTokens') {
    return JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: token } });
  }
  throw authUnavailable('This Codex authentication method cannot be used for voice input.');
}

// Use the installed, OS-authorized Codex executable to read its own store.
// Calling `security -w` instead requests access as a different executable and
// can prompt on every recording even while Codex itself is already signed in.
// This helper never starts an agent turn or changes the user's storage mode.
export async function readCodexNativeAuth(
  codexHome: string,
  options: CodexNativeAuthOptions = {}
): Promise<string | null> {
  const directory = await mkdtemp(join(tmpdir(), 'zcc-codex-auth-'));
  let output: FileHandle | undefined;
  let child: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let exited = false;
  let failed = false;
  try {
    // File capture avoids Electron's historical >8 KiB child-pipe truncation.
    // The private directory and 0600 file are removed on every completion path.
    output = await open(join(directory, 'response'), 'wx+', 0o600);
    const env = options.env ?? process.env;
    child = (options.spawnImpl ?? spawnPortableProcess)({
      command: 'codex',
      // Voice always targets OpenAI, independently of an inference-only custom
      // model provider (which can suppress auth tokens in getAuthStatus).
      args: ['-c', 'model_provider="openai"', 'app-server'],
      cwd: codexHome,
      env: { ...env, CODEX_HOME: codexHome, PATH: augmentPathWithNodePrefixes(augmentPath(env.PATH)) },
      detached: process.platform !== 'win32',
      stdio: ['pipe', output.fd, 'ignore']
    });
    closed = new Promise<void>((resolve) => {
      child!.once('error', () => { failed = true; resolve(); });
      child!.once('exit', () => { exited = true; resolve(); });
    });
    child.stdin!.on('error', () => { failed = true; });
    const send = (message: unknown) => child!.stdin!.write(`${JSON.stringify(message)}\n`);
    const deadline = performance.now() + (options.timeoutMs ?? AUTH_TIMEOUT_MS);
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.alloc(16 * 1024);
    let offset = 0;
    let pending = '';
    const response = async (id: number): Promise<unknown> => {
      for (;;) {
        if (performance.now() >= deadline) {
          throw authUnavailable('Timed out while asking Codex for voice credentials. Try again, or check Codex on the host.');
        }
        if ((await output!.stat()).size > AUTH_OUTPUT_MAX_BYTES) {
          throw authUnavailable('Codex authentication output exceeded the supported size.');
        }
        const { bytesRead } = await output!.read(buffer, 0, buffer.length, offset);
        offset += bytesRead;
        if (offset > AUTH_OUTPUT_MAX_BYTES) throw authUnavailable('Codex authentication output exceeded the supported size.');
        pending += decoder.write(buffer.subarray(0, bytesRead));
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (!line.trim()) continue;
          const message = object(JSON.parse(line));
          if (message?.id !== id || message.method !== undefined) continue;
          if (message.error !== undefined || !Object.hasOwn(message, 'result')) {
            throw authUnavailable('Codex could not read its saved login. Check or update Codex on the host, then try again.');
          }
          return message.result;
        }
        if (bytesRead > 0) continue;
        if (failed || exited) throw authUnavailable('Codex authentication stopped unexpectedly. Check that Codex is installed and signed in on the host.');
        await delay(25);
      }
    };
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'zcc_voice', version: '1.0.0' } } });
    await response(1);
    send({ method: 'initialized' });
    send({ id: 2, method: 'getAuthStatus', params: { includeToken: true, refreshToken: false } });
    return storedAuth(await response(2));
  } catch (error) {
    // Child errors, protocol errors and JSON parse errors can contain tokens.
    // Never propagate them, their causes, or stdout/stderr to logs or the UI.
    if (error instanceof HostCommandError) throw error;
    throw authUnavailable('Cannot read the saved Codex login. Check that Codex is installed and up to date on the host, then try again.');
  } finally {
    try {
      if (child) {
        child.stdin?.destroy();
        // npm's Codex launcher owns a native child: reap the whole helper group.
        if (process.platform === 'win32' && child.pid !== undefined && !exited) {
          await runPortableCommand('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            timeout: 1_000, maxBuffer: 4096
          }).catch(() => child!.kill('SIGKILL'));
        } else {
          killProcessGroup({ child, signal: 'SIGKILL' });
        }
        await closed;
      }
    } finally {
      try { await output?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
}
