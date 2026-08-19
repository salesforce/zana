import { randomUUID } from 'node:crypto';
import type { RuntimeSupervisor } from '../runtime-supervisor.js';
import type { TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';
import type {
  ExecEnvContext,
  ExecutionEnvironment,
  ExecutionSession,
  InnerLaunch,
  IsolationStatus
} from './execution-environment.js';

const COMMAND_DEADLINE_MS = 5_000;

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
  private readonly bufferedEvents: Array<Extract<TerminalHostEvent, { kind: 'output' | 'exited' }>> = [];
  private readonly unsubscribe: () => void;
  private launchEpoch = 0;
  private started = false;
  private exited = false;
  private _pid: number | undefined;

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
      this.destroy();
      throw new Error('runtime host did not start terminal session');
    }
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.add(listener);
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
    this.bufferedEvents.length = 0;
  }

  private execute(
    command:
      | { kind: 'start'; projectId: string; launch: { argv: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number; mode: 'local-pty' } }
      | { kind: 'write'; data: string }
      | { kind: 'resize'; cols: number; rows: number }
      | { kind: 'terminate'; expected: boolean }
  ): Promise<TerminalHostEvent[]> {
    return this.runtime.executeTerminal({
      ...command,
      commandId: this.commandId(),
      sessionId: this.sessionId,
      launchEpoch: this.launchEpoch,
      deadlineAt: new Date(this.now() + COMMAND_DEADLINE_MS).toISOString()
    });
  }

  private handleEvent(event: TerminalHostEvent): void {
    if (event.kind === 'rejected') return;
    if (event.sessionId !== this.sessionId || event.launchEpoch !== this.launchEpoch) return;
    if (event.kind === 'started') {
      this.started = true;
      this._pid = event.pid;
      return;
    }
    if (event.kind === 'output' || event.kind === 'exited') {
      this.bufferedEvents.push(event);
      this.flushBufferedEvents();
    }
  }

  private flushBufferedEvents(): void {
    while (this.bufferedEvents.length > 0) {
      const event = this.bufferedEvents[0]!;
      if (event.kind === 'output') {
        if (this.dataListeners.size === 0) return;
        this.bufferedEvents.shift();
        for (const listener of this.dataListeners) listener(event.data);
        continue;
      }
      if (this.exitListeners.size === 0) return;
      this.bufferedEvents.shift();
      if (this.exited) continue;
      this.exited = true;
      for (const listener of this.exitListeners) listener({ exitCode: event.code ?? -1 });
      this.unsubscribe();
    }
  }

  private exitWithFailure(): void {
    if (this.exited) return;
    this.handleEvent({
      kind: 'exited',
      sessionId: this.sessionId,
      launchEpoch: this.launchEpoch,
      sequence: Number.MAX_SAFE_INTEGER,
      code: -1,
      expected: false
    });
  }
}
