import { randomUUID } from 'node:crypto';
import type { RuntimeSupervisor } from '../../../desktop/src/runtime/runtime-supervisor.js';
import type { TerminalHostBinding, TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';
import { TERMINAL_HOST_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/terminal-execution';
import type {
  ExecEnvContext,
  ExecutionEnvironment,
  ExecutionSession,
  InnerLaunch,
  IsolationStatus
} from './execution-environment.js';

const COMMAND_DEADLINE_MS = 5_000;
const MAX_BUFFERED_OUTPUT_BYTES = 256 * 1024;

export interface RuntimeHostExecutionEnvironmentOptions {
  runtime: RuntimeSupervisor;
  now?: () => number;
  commandId?: () => string;
}

/**
 * Creates the first migration lane for local shell sessions. The desktop still
 * owns terminal records and renderer fan-out; the host owns only the PTY handle.
 */
export function createRuntimeHostExecutionEnvironment(
  options: RuntimeHostExecutionEnvironmentOptions
): ExecutionEnvironment {
  const now = options.now ?? Date.now;
  const commandId = options.commandId ?? randomUUID;
  return {
    id: 'runtime-host',
    wrap: (inner) => inner,
    rewriteCallbackEnv: (env) => env,
    status: (): IsolationStatus => ({ isolated: false }),
    createSession: async (inner, ctx) => {
      const session = new RuntimeHostExecutionSession(options.runtime, ctx.sessionId, commandId, now);
      await session.start(inner, ctx);
      return session;
    }
  };
}

class RuntimeHostExecutionSession implements ExecutionSession {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number }) => void>();
  private readonly bufferedOutput = new Map<number, Extract<TerminalHostEvent, { kind: 'output' }>>();
  private readonly unsubscribe: () => void;
  private bufferedOutputBytes = 0;
  private exitEvent: Extract<TerminalHostEvent, { kind: 'exited' }> | null = null;
  private lastDeliveredSequence = -1;
  private attachingOutput = false;
  private outputAttached = false;
  private launchEpoch = 0;
  private started = false;
  private exited = false;
  private _pid: number | undefined;
  private binding: TerminalHostBinding | null = null;
  private startError: string | null = null;

  constructor(
    private readonly runtime: RuntimeSupervisor,
    private readonly sessionId: string,
    private readonly commandId: () => string,
    private readonly now: () => number
  ) {
    this.unsubscribe = runtime.onTerminalEvent((event) => this.handleEvent(event));
  }

  get pid(): number | undefined {
    return this._pid;
  }

  async start(
    inner: InnerLaunch,
    ctx: ExecEnvContext & { cols: number; rows: number; sessionEnv: Record<string, string>; spawnEnv?: Record<string, string> }
  ): Promise<void> {
    const events = await this.execute({
      kind: 'start',
      projectId: ctx.projectId,
      launch: {
        argv: [inner.command, ...inner.args],
        cwd: ctx.cwd,
        env: ctx.spawnEnv ?? ctx.sessionEnv,
        cols: ctx.cols,
        rows: ctx.rows,
        mode: 'local-pty'
      }
    });
    for (const event of events) this.handleEvent(event);
    if (!this.started) {
      const error = this.startError ?? 'runtime host did not start terminal session';
      this.destroy();
      throw new Error(error);
    }
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.add(listener);
    if (!this.outputAttached && !this.attachingOutput) void this.attachOutput();
    this.flushBufferedEvents();
  }

  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListeners.add(listener);
    this.flushBufferedEvents();
  }

  write(data: string): void {
    void this.execute({ kind: 'write', data }).catch(() => this.exitWithFailure());
  }

  resize(cols: number, rows: number): void {
    void this.execute({ kind: 'resize', cols, rows }).catch(() => this.exitWithFailure());
  }

  kill(): void {
    void this.execute({ kind: 'terminate', expected: false }).catch(() => this.exitWithFailure());
  }

  terminateExpected(): void {
    void this.execute({ kind: 'terminate', expected: true }).catch(() => this.exitWithFailure());
  }

  destroy(): void {
    this.unsubscribe();
    this.dataListeners.clear();
    this.exitListeners.clear();
    this.bufferedOutput.clear();
    this.bufferedOutputBytes = 0;
    this.exitEvent = null;
  }

  private execute(
    command:
      | { kind: 'start'; projectId: string; launch: { argv: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number; mode: 'local-pty' } }
      | { kind: 'write'; data: string }
      | { kind: 'resize'; cols: number; rows: number }
      | { kind: 'terminate'; expected: boolean }
      | { kind: 'events-since'; afterSequence?: number }
  ): Promise<TerminalHostEvent[]> {
    if (command.kind === 'events-since') {
      return this.runtime.terminalEventsSince(this.sessionId, command.afterSequence);
    }
    return this.runtime.executeTerminal({
      ...command,
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      commandId: this.commandId(),
      sessionId: this.sessionId,
      launchEpoch: this.launchEpoch,
      deadlineAt: new Date(this.now() + COMMAND_DEADLINE_MS).toISOString()
    });
  }

  private handleEvent(event: TerminalHostEvent): void {
    if (event.kind === 'rejected') {
      if (event.sessionId === this.sessionId && event.launchEpoch === this.launchEpoch) {
        this.startError = event.reason;
      }
      return;
    }
    if (event.sessionId !== this.sessionId || event.launchEpoch !== this.launchEpoch) return;
    if (event.kind === 'started') {
      this.started = true;
      this._pid = event.pid;
      return;
    }
    if (event.kind === 'accepted') {
      this.binding = event.binding;
      return;
    }
    if (event.kind === 'output') {
      this.bufferOutput(event);
      this.flushBufferedEvents();
      return;
    }
    if (event.kind === 'exited') {
      if (!this.exitEvent || event.sequence < this.exitEvent.sequence) this.exitEvent = event;
      this.flushBufferedEvents();
    }
  }

  private async attachOutput(): Promise<void> {
    this.attachingOutput = true;
    try {
      const events = await this.execute({ kind: 'events-since', afterSequence: this.lastDeliveredSequence });
      for (const event of events) this.handleEvent(event);
    } catch {
      // The live subscription was established before start(). If the host has
      // already exited or rejects replay, deliver the bounded events received on
      // that subscription rather than turning a late renderer attachment into a
      // second terminal failure.
    } finally {
      this.attachingOutput = false;
      this.outputAttached = true;
      this.flushBufferedEvents();
    }
  }

  private bufferOutput(event: Extract<TerminalHostEvent, { kind: 'output' }>): void {
    if (event.sequence <= this.lastDeliveredSequence || this.bufferedOutput.has(event.sequence)) return;
    this.bufferedOutput.set(event.sequence, event);
    this.bufferedOutputBytes += Buffer.byteLength(event.data);
    if (this.bufferedOutputBytes > MAX_BUFFERED_OUTPUT_BYTES) this.exitWithFailure();
  }

  private flushBufferedEvents(): void {
    if (this.dataListeners.size > 0 && this.outputAttached) {
      const output = [...this.bufferedOutput.values()].sort((left, right) => left.sequence - right.sequence);
      for (const event of output) {
        this.bufferedOutput.delete(event.sequence);
        this.bufferedOutputBytes -= Buffer.byteLength(event.data);
        this.lastDeliveredSequence = Math.max(this.lastDeliveredSequence, event.sequence);
        for (const listener of this.dataListeners) listener(event.data);
      }
    }
    if (!this.exitEvent || this.exitListeners.size === 0 || this.exited) return;
    if (this.bufferedOutput.size > 0 || !this.outputAttached) return;
    this.exited = true;
    for (const listener of this.exitListeners) listener({ exitCode: this.exitEvent.code ?? -1 });
    this.unsubscribe();
    this.exitEvent = null;
  }

  private exitWithFailure(): void {
    if (this.exited) return;
    this.handleEvent({
      kind: 'exited',
      protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
      binding: this.binding ?? {
        hostId: '00000000-0000-4000-8000-000000000000',
        instanceId: '00000000-0000-4000-8000-000000000000',
        hostConnectionId: '00000000-0000-4000-8000-000000000000'
      },
      sessionId: this.sessionId,
      launchEpoch: this.launchEpoch,
      sequence: Number.MAX_SAFE_INTEGER,
      code: -1,
      expected: false
    });
  }
}
