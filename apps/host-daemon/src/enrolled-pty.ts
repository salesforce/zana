import * as pty from 'node-pty';
import type { HostEventEnvelope } from '@zana-ai/zcc-contracts/host-rpc';

export interface EnrolledPtyHandle {
  pid?: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
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
    pid: handle.pid,
    write: (data) => handle.write(data),
    resize: (cols, rows) => handle.resize(cols, rows),
    kill: () => handle.kill(),
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
  const shell = options.shell ?? process.env.SHELL ?? '/bin/zsh';

  function startTerminal(input: { sessionId: string; cwd: string; cols: number; rows: number }): { pid?: number } {
    const existing = sessions.get(input.sessionId);
    if (existing) {
      existing.kill();
      sessions.delete(input.sessionId);
    }
    const handle = spawn(shell, ['-l'], {
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      env: { ...process.env } as Record<string, string>,
      name: 'xterm-256color'
    });
    sessions.set(input.sessionId, handle);
    handle.onData((data) => {
      options.emit({
        terminalId: input.sessionId,
        kind: 'terminal.output',
        payload: { data }
      });
    });
    handle.onExit((event) => {
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
    startTerminal: async (input: { sessionId: string; cwd: string; cols: number; rows: number }) =>
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
      handle.kill();
      sessions.delete(input.sessionId);
    },
    dispose(): void {
      for (const handle of sessions.values()) {
        try {
          handle.kill();
        } catch {
          /* already gone */
        }
      }
      sessions.clear();
    }
  };
}

export type EnrolledPty = ReturnType<typeof createEnrolledPty>;
