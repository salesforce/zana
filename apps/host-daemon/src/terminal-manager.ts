import { randomUUID } from 'node:crypto';
import {
  TerminalHostCommandSchema,
  type TerminalHostCommand,
  type TerminalHostEvent
} from '@zana-ai/zcc-contracts/terminal-execution';

export interface PtyHandle {
  readonly pid?: number;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface HostTerminalManagerOptions {
  spawn(command: string, args: string[], options: { cwd: string; env: Record<string, string>; cols: number; rows: number }): PtyHandle;
  emit(event: TerminalHostEvent): void;
  hostSessionId?: () => string;
}

interface LiveTerminal {
  handle: PtyHandle;
  epoch: number;
  sequence: number;
  exited: boolean;
  expectedExit: boolean;
  backlog: Array<{ sequence: number; data: string }>;
}

const MAX_BACKLOG_BYTES = 256 * 1024;

/**
 * Host-only terminal ownership. It knows process handles and bounded output but
 * never resolves a project, user identity, launch profile, or execution grant.
 */
export class HostTerminalManager {
  private readonly live = new Map<string, LiveTerminal>();
  private readonly handled = new Map<string, TerminalHostEvent[]>();

  constructor(private readonly options: HostTerminalManagerOptions) {}

  handle(input: unknown): TerminalHostEvent[] {
    const command = TerminalHostCommandSchema.parse(input);
    const prior = this.handled.get(command.commandId);
    if (prior) return prior;
    const events: TerminalHostEvent[] = [];
    const emit = (event: TerminalHostEvent) => {
      events.push(event);
      this.options.emit(event);
    };
    try {
      this.dispatch(command, emit);
    } catch (error) {
      const rejected: TerminalHostEvent = {
        kind: 'rejected',
        commandId: command.commandId,
        sessionId: command.sessionId,
        reason: error instanceof Error ? error.message : 'terminal command failed'
      };
      emit(rejected);
    }
    this.handled.set(command.commandId, events);
    // Command ids are short-lived server-issued capabilities. Keep recent
    // outcomes for idempotent retries without letting a long-lived daemon grow.
    if (this.handled.size > 1_000) this.handled.delete(this.handled.keys().next().value!);
    return events;
  }

  private dispatch(command: TerminalHostCommand, emit: (event: TerminalHostEvent) => void): void {
    if (Date.parse(command.deadlineAt) <= Date.now()) throw new Error('terminal command expired');
    if (command.kind === 'start') return this.start(command, emit);
    const live = this.live.get(command.sessionId);
    if (!live || live.epoch !== command.launchEpoch || live.exited) throw new Error('unknown terminal session epoch');
    if (command.kind === 'write') {
      live.handle.write(command.data);
      return;
    }
    if (command.kind === 'resize') {
      live.handle.resize(command.cols, command.rows);
      return;
    }
    if (command.kind === 'terminate') {
      live.expectedExit = command.expected;
      live.handle.kill();
      return;
    }
    for (const item of live.backlog) {
      if (item.sequence > (command.afterSequence ?? -1)) {
        emit({ kind: 'output', sessionId: command.sessionId, launchEpoch: live.epoch, sequence: item.sequence, data: item.data });
      }
    }
  }

  private start(command: Extract<TerminalHostCommand, { kind: 'start' }>, emit: (event: TerminalHostEvent) => void): void {
    if (command.launch.mode !== 'local-pty') throw new Error(`terminal mode ${command.launch.mode} is not migrated`);
    const existing = this.live.get(command.sessionId);
    if (existing && !existing.exited) throw new Error('terminal session is already live');
    const [file, ...args] = command.launch.argv;
    if (!file) throw new Error('terminal argv is empty');
    const handle = this.options.spawn(file, args, command.launch);
    const live: LiveTerminal = { handle, epoch: command.launchEpoch, sequence: 0, exited: false, expectedExit: false, backlog: [] };
    this.live.set(command.sessionId, live);
    emit({ kind: 'accepted', commandId: command.commandId, sessionId: command.sessionId, launchEpoch: command.launchEpoch, hostSessionId: (this.options.hostSessionId ?? randomUUID)() });
    emit({ kind: 'started', sessionId: command.sessionId, launchEpoch: command.launchEpoch, ...(handle.pid ? { pid: handle.pid } : {}) });
    handle.onData((data) => {
      if (live.exited) return;
      const event: TerminalHostEvent = {
        kind: 'output', sessionId: command.sessionId, launchEpoch: live.epoch, sequence: live.sequence++, data
      };
      live.backlog.push({ sequence: event.sequence, data });
      let size = live.backlog.reduce((total, item) => total + Buffer.byteLength(item.data), 0);
      while (size > MAX_BACKLOG_BYTES && live.backlog.length > 1) size -= Buffer.byteLength(live.backlog.shift()!.data);
      this.options.emit(event);
    });
    handle.onExit(({ exitCode }) => {
      if (live.exited) return;
      live.exited = true;
      // The exit sequence is deliberately after every emitted output sequence.
      this.options.emit({
        kind: 'exited', sessionId: command.sessionId, launchEpoch: live.epoch,
        sequence: live.sequence++, code: exitCode, expected: live.expectedExit
      });
      this.live.delete(command.sessionId);
    });
  }
}
