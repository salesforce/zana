import * as pty from 'node-pty';
import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';
import { terminatePtyProcessTree } from './pty-termination.js';
import { accessSync, constants } from 'node:fs';

/** Adapted from BB terminal-manager.ts (MIT; docs/third-party/BB-LICENSE).
 * Minimal Linux hosts often have no zsh and no SHELL in their service env. */
export function resolveEnrolledShell(env: NodeJS.ProcessEnv = process.env, executable = (path: string) => {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}): string {
  for (const candidate of [env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (candidate && executable(candidate)) return candidate;
  }
  return '/bin/sh';
}

export interface EnrolledPtyHandle {
  pid?: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause?(): void;
  resume?(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
}

export interface EnrolledPtySpawn {
  (file: string, args: string[], options: {
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
    name: string;
  }): EnrolledPtyHandle;
}

function defaultSpawn(
  file: string,
  args: string[],
  options: { cwd: string; cols: number; rows: number; env: Record<string, string>; name: string }
): EnrolledPtyHandle {
  const handle = pty.spawn(file, args, options);
  return {
    // node-pty on Windows reports 0 until ConPTY connects; read it at close time.
    get pid() { return handle.pid; },
    write: (data) => handle.write(data),
    resize: (cols, rows) => handle.resize(cols, rows),
    kill: (signal?: string) => handle.kill(signal),
    pause: () => handle.pause(),
    resume: () => handle.resume(),
    onData: (listener) => { handle.onData(listener); },
    onExit: (listener) => {
      handle.onExit((event) => listener({ exitCode: event.exitCode, signal: event.signal }));
    }
  };
}

export function createEnrolledPty(options: {
  emit: (event: HostEventEnvelope) => void;
  spawn?: EnrolledPtySpawn;
  shell?: string;
}) {
  const sessions = new Map<string, EnrolledPtyHandle>();
  const spawn = options.spawn ?? defaultSpawn;
  const shell = options.shell ?? resolveEnrolledShell();
  let paused = false;

  function startTerminal(input: { sessionId: string; cwd: string; cols: number; rows: number; command?: string }): { pid?: number } {
    const existing = sessions.get(input.sessionId);
    if (existing) throw new Error('Terminal is already running');
    if (sessions.size >= 128) throw new Error('Terminal capacity reached');
    const launch = input.command?.trim();
    const handle = spawn(shell, launch ? ['-lc', launch] : ['-l'], {
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      env: { ...process.env } as Record<string, string>,
      name: 'xterm-256color'
    });
    sessions.set(input.sessionId, handle);
    if (paused) handle.pause?.();
    handle.onData((data) => {
      if (sessions.get(input.sessionId) !== handle) return;
      options.emit({
        terminalId: input.sessionId,
        kind: 'terminal.output',
        payload: { data }
      });
    });
    handle.onExit((event) => {
      if (sessions.get(input.sessionId) !== handle) return;
      sessions.delete(input.sessionId);
      options.emit({
        terminalId: input.sessionId,
        kind: 'terminal.exited',
        payload: { exitCode: event.exitCode }
      });
    });
    return { pid: handle.pid };
  }

  function requireSession(sessionId: string): EnrolledPtyHandle {
    const handle = sessions.get(sessionId);
    if (!handle) {
      throw new Error(`unknown terminal ${sessionId}`);
    }
    return handle;
  }

  return {
    setOutputPaused(value: boolean): void {
      if (value === paused) return;
      paused = value;
      for (const handle of sessions.values()) { if (value) handle.pause?.(); else handle.resume?.(); }
    },
    stopOverflowedTerminal(sessionId: string): void {
      const handle = sessions.get(sessionId);
      if (!handle) return;
      sessions.delete(sessionId);
      try { terminatePtyProcessTree(handle); } finally {
        options.emit({ terminalId: sessionId, kind: 'terminal.exited', payload: { exitCode: -1, reason: 'Terminal stopped: output delivery capacity exceeded; some output was lost.' } });
      }
    },
    startTerminal: async (input: { sessionId: string; cwd: string; cols: number; rows: number; command?: string }) =>
      startTerminal(input),
    writeTerminal: async (input: { sessionId: string; data: string }) => {
      requireSession(input.sessionId).write(input.data);
    },
    resizeTerminal: async (input: { sessionId: string; cols: number; rows: number }) => {
      requireSession(input.sessionId).resize(input.cols, input.rows);
    },
    stopTerminal: async (input: { sessionId: string }) => {
      const handle = sessions.get(input.sessionId);
      if (!handle) return;
      terminatePtyProcessTree(handle);
      sessions.delete(input.sessionId);
    },
    dispose(): void {
      for (const handle of sessions.values()) {
        try {
          terminatePtyProcessTree(handle);
        } catch {
          /* already gone */
        }
      }
      sessions.clear();
    }
  };
}

export type EnrolledPty = ReturnType<typeof createEnrolledPty>;
