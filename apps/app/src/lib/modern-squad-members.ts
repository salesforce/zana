import type { ExecutionBoardProjection, Persona, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { AgentCard } from '../components/AgentBoard.js';
import { agentFleetItem, isVisibleThread, threadFleetItem, type FleetItem } from '../components/fleet-item.js';
import type { ThreadListItem } from '../thread-store.js';
import type { SquadFlowThreadParticipant } from './squadFlow.js';

type ThreadFleet = Extract<FleetItem, { kind: 'thread' }>;
type MemberThread = Pick<ThreadFleet, 'id' | 'title' | 'state' | 'projectId' | 'projectName' | 'projectColor' | 'thread'>;

/**
 * Modern squad members as cohort-stamped agent cards. A Modern member is an ACP
 * thread with no PTY cohort stamp, so main projects it onto its execution
 * (`modernMembers`); stamping the same cohort a CLI squad member carries lets
 * every CLI grouping (board host/workers, List team-run, Workflow launch groups,
 * sidebar rows) apply unchanged. `folded` is the set of thread ids now owned by
 * a card, which callers drop from their plain thread lists.
 */
export function modernMemberCards(
  executions: readonly ExecutionBoardProjection[],
  threads: readonly MemberThread[],
  personas: readonly Pick<Persona, 'id' | 'name'>[] = []
): { cards: AgentCard[]; folded: Set<string> } {
  const threadById = new Map(threads.map((item) => [item.id, item]));
  const cards: AgentCard[] = [];
  const folded = new Set<string>();
  for (const execution of executions) {
    for (const member of execution.modernMembers ?? []) {
      if (folded.has(member.threadId)) continue;
      folded.add(member.threadId);
      const item = threadById.get(member.threadId);
      const label = member.role === 'orchestrator' ? 'Orchestrator' : personas.find((p) => p.id === member.personaId)?.name;
      cards.push({
        session: {
          id: member.threadId,
          title: item?.title ?? label ?? 'Squad member',
          status: member.live ? 'running' : 'exited',
          profile: 'claude',
          personaId: member.personaId,
          createdAt: item?.thread.createdAt ?? execution.createdAt,
          cohort: {
            cohortId: execution.executionId, executionId: execution.executionId,
            teamId: execution.teamId ?? 'execution', teamName: execution.teamName ?? 'Squad',
            executionJobTitle: execution.jobTitle,
            role: member.role, slotId: member.slotId, ...(label ? { slotLabel: label } : {})
          }
        } as TerminalSession,
        state: item?.state ?? (member.live ? 'idle' : 'done'),
        projectId: execution.projectId,
        projectName: item?.projectName ?? threads.find((candidate) => candidate.projectId === execution.projectId)?.projectName ?? 'Project',
        ...(item?.projectColor ? { projectColor: item.projectColor } : {}),
        liveSubagents: 0,
        modernThreadId: member.threadId,
        ...(item ? { modernThread: item.thread } : {})
      });
    }
  }
  return { cards, folded };
}

/**
 * The fleet every Agents view reads, with each Modern member thread replaced by
 * its cohort-stamped agent card so Kanban, List and plugin views group a Modern
 * squad exactly like a CLI squad.
 */
export function withModernSquadMembers(
  fleet: readonly FleetItem[],
  executions: readonly ExecutionBoardProjection[],
  personas: readonly Pick<Persona, 'id' | 'name'>[] = []
): FleetItem[] {
  if (!executions.some((execution) => execution.modernMembers?.length)) return [...fleet];
  const threads = fleet.filter((item): item is ThreadFleet => item.kind === 'thread');
  const modern = modernMemberCards(executions, threads, personas);
  return [
    ...fleet.filter((item) => item.kind !== 'thread' || !modern.folded.has(item.id)),
    ...modern.cards.map(agentFleetItem)
  ];
}

/** A Modern member card opens its own thread unless it is the squad's Job host. */
export function modernMemberThreadId(card: AgentCard): string | undefined {
  return card.modernThreadId && card.session.cohort?.role !== 'orchestrator' ? card.modernThreadId : undefined;
}

/**
 * Workflow participants per project: visible threads as Solo nodes, except
 * Modern squad members, which carry their squad cohort so the Flow groups them
 * into that squad's launch like CLI members.
 */
export function modernFlowParticipants(
  threads: readonly ThreadListItem[],
  executions: readonly ExecutionBoardProjection[],
  personas: readonly Pick<Persona, 'id' | 'name'>[] = []
): Map<string, SquadFlowThreadParticipant[]> {
  const visible = threads.filter(isVisibleThread).map((thread) => threadFleetItem(thread));
  const modern = modernMemberCards(executions, visible, personas);
  const byProject = new Map<string, SquadFlowThreadParticipant[]>();
  const push = (projectId: string, participant: SquadFlowThreadParticipant) => {
    const list = byProject.get(projectId) ?? [];
    list.push(participant);
    byProject.set(projectId, list);
  };
  for (const item of visible) {
    if (modern.folded.has(item.id)) continue;
    push(item.projectId, { id: item.id, label: item.title, state: item.state, createdAt: item.thread.createdAt });
  }
  for (const card of modern.cards) {
    push(card.projectId, {
      id: card.modernThreadId!, label: card.session.title, state: card.state, createdAt: card.session.createdAt,
      cohort: card.session.cohort, exited: card.session.status === 'exited'
    });
  }
  return byProject;
}
