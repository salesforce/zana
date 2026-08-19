import * as pty from 'node-pty';
import { HostTerminalManager, type PtyHandle } from './terminal-manager.js';
import type { TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';

/**
 * The host-local adapter is the sole location where the migrated host daemon
 * may touch node-pty. Policy arrives as a validated server command; this module
 * deliberately knows nothing about project roots, personas, or consent grants.
 */
export function createLocalPtyTerminalManager(emit: (event: TerminalHostEvent) => void): HostTerminalManager {
  return new HostTerminalManager({
    spawn(command, args, options): PtyHandle {
      const handle = pty.spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        cols: options.cols,
        rows: options.rows,
        name: 'xterm-256color'
      });
      return {
        pid: handle.pid,
        onData: (listener) => { handle.onData(listener); },
        onExit: (listener) => { handle.onExit((event) => listener({ exitCode: event.exitCode, signal: event.signal })); },
        write: (data) => handle.write(data),
        resize: (cols, rows) => handle.resize(cols, rows),
        kill: () => handle.kill()
      };
    },
    emit
  });
}
