import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';

export type AgentTabStatus = 'Error' | 'Needs you' | 'Working' | 'Idle' | 'Exited';

/** A session the project lists as an agent: scheduler jobs and provider sign-in shells never get a tab. */
export function isListedAgent(session: TerminalSession | undefined): boolean {
  return !!session && !session.scheduled && !session.providerSignIn;
}

/** Tab status word for one CLI Agent. Mirrors the thread tab: only Error, Needs you and Working show an icon. */
export function agentTabStatus(
  session: Pick<TerminalSession, 'status' | 'exitCode'>,
  state: AgentState | undefined
): AgentTabStatus {
  if (session.status === 'exited')
    return session.exitCode ? 'Error' : 'Exited';
  if (state === 'blocked') return 'Needs you';
  if (session.status === 'starting' || state === 'working') return 'Working';
  return 'Idle';
}
