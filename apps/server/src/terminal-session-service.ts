import type { TerminalHostCommand, TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';
import type { TerminalExecutionService } from './terminal-execution-service.js';

export type TerminalSessionState = 'starting' | 'running' | 'exited';

export interface TerminalSessionRecord {
  sessionId: string;
  launchEpoch: number;
  state: TerminalSessionState;
  accepted: boolean;
  pid?: number;
  nextSequence: number;
  expectedExit?: boolean;
}

/**
 * Server-side terminal-session authority for the host migration lane. The host
 * owns OS handles and its raw scrollback; this service owns the accepted session
 * epoch and filters duplicate or stale host events before they reach desktop.
 */
export class TerminalSessionService {
  private readonly sessions = new Map<string, TerminalSessionRecord>();
  /** Bounded server-owned event retention for late desktop attachment. */
  private readonly events = new Map<string, TerminalHostEvent[]>();

  constructor(private readonly execution: TerminalExecutionService) {}

  get(sessionId: string): TerminalSessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
  }

  eventsSince(sessionId: string, afterSequence = -1): TerminalHostEvent[] {
    return (this.events.get(sessionId) ?? []).filter((event) =>
      !('sequence' in event) || event.sequence > afterSequence
    );
  }

  async execute(command: TerminalHostCommand): Promise<TerminalHostEvent[]> {
    if (command.kind === 'start') {
      this.sessions.set(command.sessionId, {
        sessionId: command.sessionId,
        launchEpoch: command.launchEpoch,
        state: 'starting',
        accepted: false,
        nextSequence: 0
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
    if (event.kind === 'rejected') {
      if (event.sessionId) this.sessions.delete(event.sessionId);
      return true;
    }
    const session = this.sessions.get(event.sessionId);
    if (!session || session.launchEpoch !== event.launchEpoch) return false;
    if (event.kind === 'accepted') {
      if (session.state !== 'starting' || session.accepted) return false;
      session.accepted = true;
      this.append(event);
      return true;
    }
    if (event.kind === 'started') {
      if (session.state !== 'starting' || !session.accepted) return false;
      session.state = 'running';
      session.pid = event.pid;
      this.append(event);
      return true;
    }
    if (event.kind === 'output') {
      // A fast local process can write before the start HTTP response reaches
      // the server. Preserve that output under the accepted epoch; `started`
      // still transitions the record to running once its response is processed.
      if (session.state === 'exited' || event.sequence < session.nextSequence) return false;
      session.nextSequence = event.sequence + 1;
      this.append(event);
      return true;
    }
    if (session.state === 'exited' || event.sequence < session.nextSequence) return false;
    session.state = 'exited';
    session.nextSequence = event.sequence + 1;
    session.expectedExit = event.expected;
    this.append(event);
    return true;
  }

  private append(event: Exclude<TerminalHostEvent, { kind: 'rejected' }>): void {
    const events = this.events.get(event.sessionId) ?? [];
    events.push(event);
    // Host and desktop each retain 256 KiB of output. The server's smaller
    // metadata stream prevents unbounded session history while preserving the
    // ordered attachment handoff once it owns the session record.
    while (events.length > 1_000) events.shift();
    this.events.set(event.sessionId, events);
  }
}
