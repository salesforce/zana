import type { TerminalHostBinding, TerminalHostEvent, TerminalRequestCommand } from '@zana-ai/zcc-contracts/terminal-execution';
import type { TerminalExecutionService } from './terminal-execution-service.js';
import {
  createInMemoryTerminalSessionRepository,
  type TerminalSessionRepository
} from './runtime-database.js';

export type TerminalSessionState = 'starting' | 'running' | 'exited';

export interface TerminalSessionRecord {
  sessionId: string;
  launchEpoch: number;
  state: TerminalSessionState;
  accepted: boolean;
  pid?: number;
  nextSequence: number;
  expectedExit?: boolean;
  binding?: TerminalHostBinding;
}

/**
 * Server-side terminal-session authority for the host migration lane. The host
 * owns OS handles and its raw scrollback; this service owns the accepted session
 * epoch and filters duplicate or stale host events before they reach desktop.
 */
export class TerminalSessionService {
  constructor(
    private readonly execution: TerminalExecutionService,
    private readonly repository: TerminalSessionRepository = createInMemoryTerminalSessionRepository()
  ) {
  }

  async refreshHostConnection(): Promise<void> {
    const expiresAt = await this.execution.connect();
    this.repository.activateHostConnection(this.execution.binding, expiresAt);
    this.repository.disconnectSessionsForHost(this.execution.binding.hostId, this.execution.binding);
  }

  get(sessionId: string): TerminalSessionRecord | null {
    return this.repository.getSession(sessionId);
  }

  eventsSince(sessionId: string, afterSequence = -1): TerminalHostEvent[] {
    return this.repository.eventsSince(sessionId, afterSequence);
  }

  async execute(command: TerminalRequestCommand): Promise<TerminalHostEvent[]> {
    if (command.kind === 'start') {
      this.repository.deleteSession(command.sessionId);
      this.repository.saveSession({
        sessionId: command.sessionId,
        launchEpoch: command.launchEpoch,
        state: 'starting',
        accepted: false,
        nextSequence: 0,
        ...(this.execution.binding ? { binding: this.execution.binding } : {})
      });
    }
    const events = await this.execution.execute(command);
    // The host may publish accepted/started on its event stream before this HTTP
    // response arrives. Record them for server authority, but return the signed
    // command response as the caller's start acknowledgement either way.
    for (const event of events) this.record(event);
    return events;
  }

  record(event: TerminalHostEvent): boolean {
    if (event.binding && !this.repository.isActiveHostConnection(event.binding)) return false;
    if (event.kind === 'rejected') {
      const session = event.sessionId ? this.repository.getSession(event.sessionId) : null;
      if (
        session &&
        event.launchEpoch === session.launchEpoch &&
        this.sameBinding(session.binding, event.binding)
      ) this.repository.deleteSession(event.sessionId!);
      return true;
    }
    const session = this.repository.getSession(event.sessionId);
    if (!session || session.launchEpoch !== event.launchEpoch || !this.sameBinding(session.binding, event.binding)) return false;
    if (event.kind === 'accepted') {
      if (session.state !== 'starting' || session.accepted) return false;
      session.accepted = true;
      this.append(event);
      this.repository.saveSession(session);
      return true;
    }
    if (event.kind === 'started') {
      if (session.state !== 'starting' || !session.accepted) return false;
      session.state = 'running';
      session.pid = event.pid;
      this.append(event);
      this.repository.saveSession(session);
      return true;
    }
    if (event.kind === 'output') {
      // A fast local process can write before the start HTTP response reaches
      // the server. Preserve that output under the accepted epoch; `started`
      // still transitions the record to running once its response is processed.
      if (session.state === 'exited' || event.sequence < session.nextSequence) return false;
      session.nextSequence = event.sequence + 1;
      this.append(event);
      this.repository.saveSession(session);
      return true;
    }
    if (session.state === 'exited' || event.sequence < session.nextSequence) return false;
    session.state = 'exited';
    session.nextSequence = event.sequence + 1;
    session.expectedExit = event.expected;
    this.append(event);
    this.repository.saveSession(session);
    return true;
  }

  private append(event: Exclude<TerminalHostEvent, { kind: 'rejected' }>): void {
    this.repository.appendEvent(event);
  }

  private sameBinding(left: TerminalHostBinding | undefined, right: TerminalHostBinding | undefined): boolean {
    if (left === undefined) return right === undefined;
    return right !== undefined &&
      left.hostId === right.hostId &&
      left.instanceId === right.instanceId &&
      left.hostConnectionId === right.hostConnectionId;
  }
}
