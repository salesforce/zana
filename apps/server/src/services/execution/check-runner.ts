import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { NamedCheckSchema, NamedCheckScopeSchema, type NamedCheck } from '@zana-ai/zcc-contracts/project-settings';
import type { ProjectSettingsStore } from '../../project-settings-store.js';
import { listCheckNames, resolveNamedCheck } from '../../named-check-registry.js';

export interface NamedCheckRunInput {
  projectId: string;
  reference: string;
  cwd: string;
  signal?: AbortSignal;
}
export interface ResolvedNamedCheckRunInput {
  projectId: string;
  check: NamedCheck;
  cwd: string;
  signal?: AbortSignal;
}
const ResolvedCheckSchema = NamedCheckSchema.extend({
  name: z.string().max(100).regex(/^[A-Za-z_][A-Za-z0-9_-]*$/)
}).strict();
export interface NamedCheckRunResult {
  name: string;
  status: 'passed' | 'failed' | 'timeout' | 'output-limit' | 'cancelled' | 'spawn-error';
  exitCode: number | null;
  output: string;
  untrusted: true;
  /** Operational failure, never command output. A termination error must fail closed. */
  error?: string;
}
export interface NamedCheckRunnerOptions {
  store: ProjectSettingsStore;
  /** Must realpath-match cwd to an authorized registered checkout/worktree. No renderer path is a trust anchor. */
  resolveCwd: (projectId: string, cwd: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  tempRoot?: string;
  /** Child-runtime timeout starts at spawn; FIFO wait and cwd authorization are excluded. */
  timeoutMs?: number;
  maxBytes?: number;
  maxConcurrent?: number;
  /** Maximum FIFO waiters, default 32, bounded to 1..256. Overflow rejects without spawning. */
  maxQueued?: number;
}

export function createNamedCheckRunner(options: NamedCheckRunnerOptions) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxBytes = options.maxBytes ?? 1_048_576;
  const maxConcurrent = options.maxConcurrent ?? 2;
  const maxQueued = options.maxQueued ?? 32;
  const captureLimit = Math.floor(maxBytes / 512) * 512;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000
    || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 4_194_304
    || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8
    || !Number.isInteger(maxQueued) || maxQueued < 1 || maxQueued > 256) {
    throw new Error('Invalid named-check runner bounds');
  }
  let closed = false;
  const active = new Map<AbortController, Promise<NamedCheckRunResult>>();
  interface Waiter {
    input: ResolvedNamedCheckRunInput;
    resolve: (result: NamedCheckRunResult) => void;
    reject: (error: unknown) => void;
    cancel: () => void;
  }
  const waiting: Waiter[] = [];
  const cancelledResult = (name: string): NamedCheckRunResult => ({ name, status: 'cancelled', exitCode: null, output: '', untrusted: true });

  function start(input: ResolvedNamedCheckRunInput): Promise<NamedCheckRunResult> {
    const controller = new AbortController();
    const pending = execute(input, controller);
    active.set(controller, pending);
    void pending.finally(() => {
      active.delete(controller);
      while (!closed && active.size < maxConcurrent && waiting.length) {
        const waiter = waiting.shift()!;
        waiter.input.signal?.removeEventListener('abort', waiter.cancel);
        void start(waiter.input).then(waiter.resolve, waiter.reject);
      }
    }).catch(() => {});
    return pending;
  }

  async function execute(input: ResolvedNamedCheckRunInput, controller: AbortController): Promise<NamedCheckRunResult> {
    const check = input.check;
    const result: NamedCheckRunResult = { name: check.name, status: 'cancelled', exitCode: null, output: '', untrusted: true };
    const cancel = () => controller.abort();
    input.signal?.addEventListener('abort', cancel, { once: true });
    if (input.signal?.aborted) controller.abort();
    let directory: string | undefined;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (controller.signal.aborted) return result;
      if (process.platform === 'win32') throw new Error('Named checks require process-group and file-limit support');
      const cwd = await options.resolveCwd(input.projectId, input.cwd);
      if (controller.signal.aborted) return result;
      directory = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'named-check-'));
      file = await open(join(directory, 'output'), 'wx+', 0o600);
      if (controller.signal.aborted) return result;
      const shell = options.shell ?? process.env.SHELL ?? '/bin/sh';
      try { await access(shell, constants.X_OK); }
      catch { result.status = 'spawn-error'; return result; }
      // POSIX sh uses 512-byte units (bash requires POSIX mode). The limit is
      // inherited by the user's normal shell and bounds growth off the JS loop.
      const child = spawn('/bin/sh', [
        '-c', `if [ -n "\${BASH_VERSION-}" ]; then set -o posix; fi\nulimit -f ${Math.floor(maxBytes / 512)} || exit 125\nexec "$@"`,
        'named-check', shell, '-c', check.command
      ], { cwd, env: options.env ?? process.env, windowsHide: true, detached: true, stdio: ['ignore', file.fd, file.fd] });
      let groupKilled = false;
      let ended = false;
      let finish: () => void = () => {};
      const reaped = () => ended || child.exitCode != null || child.signalCode != null;
      const killGroup = () => {
        if (!child.pid || groupKilled || reaped()) return;
        // One attempt for this child identity. Never retry a PID after settlement.
        groupKilled = true;
        try { process.kill(-child.pid, 'SIGKILL'); groupKilled = true; } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ESRCH') {
            result.status = 'failed';
            result.error = `Named-check process-group termination failed: ${code ?? 'unknown'}`;
            finish();
          }
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setImmediate> | undefined;
      let poll: ReturnType<typeof setInterval> | undefined;
      const abort = () => { if (!reaped()) { result.status = 'cancelled'; killGroup(); } };
      const onExit = () => {
        ended = true;
        if (timer) clearTimeout(timer);
        if (deadline) clearImmediate(deadline);
        if (poll) clearInterval(poll);
      };
      try {
        await new Promise<void>((resolve) => {
          finish = resolve;
          child.once('exit', onExit);
          child.once('error', () => { result.status = 'spawn-error'; resolve(); });
          child.once('close', (code, signal) => {
            onExit();
            result.exitCode = code;
            if (signal === 'SIGXFSZ') result.status = 'output-limit';
            else if (result.status === 'cancelled' && !controller.signal.aborted) result.status = code === 0 ? 'passed' : 'failed';
            resolve();
          });
          controller.signal.addEventListener('abort', abort, { once: true });
          child.once('spawn', () => {
            if (controller.signal.aborted || reaped()) return;
            timer = setTimeout(() => {
              // Timers can precede libuv exit delivery after a parent-loop stall.
              // Give the pending I/O/exit phase one turn before signalling.
              deadline = setImmediate(() => {
                if (!reaped()) { result.status = 'timeout'; killGroup(); }
              });
            }, timeoutMs);
          });
          let checking = false;
          poll = setInterval(() => {
            if (checking) return;
            checking = true;
            void file!.stat().then(({ size }) => {
              if (!reaped() && size >= captureLimit) { result.status = 'output-limit'; killGroup(); }
            }).catch(() => { if (!reaped()) { result.status = 'spawn-error'; killGroup(); } }).finally(() => { checking = false; });
          }, 10);
          if (controller.signal.aborted) abort();
        });
      } finally {
        if (timer) clearTimeout(timer);
        if (deadline) clearImmediate(deadline);
        if (poll) clearInterval(poll);
        controller.signal.removeEventListener('abort', abort);
        child.removeListener('exit', onExit);
        // Never signal a reaped child's numeric PID (it can be reused).
        killGroup();
      }
      const { size } = await file.stat();
      if (!result.error && (size >= captureLimit || (result.status === 'failed' && result.exitCode === 153))) result.status = 'output-limit';
      const bytes = Buffer.alloc(Math.min(size, maxBytes));
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      result.output = bytes.subarray(0, bytesRead).toString('utf8');
      return result;
    } finally {
      input.signal?.removeEventListener('abort', cancel);
      try { await file?.close(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
    }
  }

  function runResolved(input: ResolvedNamedCheckRunInput): Promise<NamedCheckRunResult> {
    if (closed) return Promise.reject(new Error('Named-check runner closed'));
    try {
      if (Object.keys(input).some((key) => !['projectId', 'check', 'cwd', 'signal'].includes(key))) {
        throw new Error('Named-check runner rejects unknown input');
      }
      NamedCheckScopeSchema.parse({ kind: 'project', projectId: input.projectId });
      const check = ResolvedCheckSchema.parse(input.check);
      const snapshot = { ...input, check };
      if (input.signal?.aborted) return Promise.resolve(cancelledResult(check.name));
      if (active.size < maxConcurrent) return start(snapshot);
      if (waiting.length >= maxQueued) throw new Error(`Named-check wait queue full (maxQueued=${maxQueued})`);
      return new Promise<NamedCheckRunResult>((resolve, reject) => {
        const waiter: Waiter = { input: snapshot, resolve, reject, cancel: () => {
          const index = waiting.indexOf(waiter);
          if (index < 0) return;
          waiting.splice(index, 1);
          input.signal?.removeEventListener('abort', waiter.cancel);
          resolve(cancelledResult(check.name));
        } };
        waiting.push(waiter);
        input.signal?.addEventListener('abort', waiter.cancel, { once: true });
      });
    } catch (error) { return Promise.reject(error); }
  }

  return {
    listNames: (projectId: string) => listCheckNames(options.store, projectId),
    resolve: (projectId: string, reference: string) => {
      if (!/^check:[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(reference)) throw new Error('Invalid check reference; expected check:<name>');
      return ResolvedCheckSchema.parse(resolveNamedCheck(options.store, projectId, reference));
    },
    /** Trusted admission-snapshot adapter only. Never register as an MCP, IPC or public command API. */
    runResolved,
    run(input: NamedCheckRunInput): Promise<NamedCheckRunResult> {
      if (closed) return Promise.reject(new Error('Named-check runner closed'));
      if (Object.keys(input).some((key) => !['projectId', 'reference', 'cwd', 'signal'].includes(key))) {
        return Promise.reject(new Error('Named-check runner rejects command or unknown input'));
      }
      try {
        if (!/^check:[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(input.reference)) throw new Error('Invalid check reference; expected check:<name>');
        const check = resolveNamedCheck(options.store, input.projectId, input.reference);
        return runResolved({ projectId: input.projectId, check, cwd: input.cwd, signal: input.signal });
      } catch (error) { return Promise.reject(error); }
    },
    async dispose(): Promise<void> {
      closed = true;
      for (const waiter of waiting.splice(0)) {
        waiter.input.signal?.removeEventListener('abort', waiter.cancel);
        waiter.resolve(cancelledResult(waiter.input.check.name));
      }
      for (const controller of active.keys()) controller.abort();
      await Promise.allSettled(active.values());
    }
  };
}
