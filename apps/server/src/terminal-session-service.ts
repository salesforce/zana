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

  constructor(private readonly execution: TerminalExecutionService) {}

  get(sessionId: string): TerminalSessionRecord | null {
    return this.sessions.get(sessionId) ?? null;
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
      return true;
    }
    if (event.kind === 'started') {
      if (session.state !== 'starting' || !session.accepted) return false;
      session.state = 'running';
      session.pid = event.pid;
      return true;
    }
    if (event.kind === 'output') {
      // A fast local process can write before the start HTTP response reaches
      // the server. Preserve that output under the accepted epoch; `started`
      // still transitions the record to running once its response is processed.
      if (session.state === 'exited' || event.sequence < session.nextSequence) return false;
      session.nextSequence = event.sequence + 1;
      return true;
    }
    if (session.state === 'exited' || event.sequence < session.nextSequence) return false;
    session.state = 'exited';
    session.nextSequence = event.sequence + 1;
    session.expectedExit = event.expected;
    return true;
  }
}
