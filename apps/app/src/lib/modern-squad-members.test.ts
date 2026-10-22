import { describe, expect, it } from 'vitest';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { agentFleetItem, threadFleetItem } from '../components/fleet-item.js';
import { closeableLaneAgents, isReclaimableIdle, partitionExecutionMembers, type AgentCard } from '../components/AgentBoard.js';
import type { ThreadListItem } from '../thread-store.js';
import { modernFlowParticipants, modernMemberCards, modernMemberThreadId, withModernSquadMembers } from './modern-squad-members.js';

const thread = (id: string, title: string, over: Partial<ThreadListItem> = {}): ThreadListItem => ({
  id, projectId: 'p', hostId: 'h', environmentId: null, providerId: 'claude-code', status: 'idle',
  title, createdAt: 10, cwd: null, branchName: null, isWorktree: false, ...over
}) as ThreadListItem;

const job = (members: NonNullable<ExecutionBoardProjection['modernMembers']>, over: Partial<ExecutionBoardProjection> = {}) => ({
  executionId: 'e-m', projectId: 'p', teamId: 'modern', teamName: 'Modern squad', jobTitle: 'Modern job',
  state: 'RUNNING', attempt: 1, createdAt: 1, updatedAt: 2, modernMembers: members, ...over
}) as ExecutionBoardProjection;

const lead = { threadId: 't-lead', slotId: 'orchestrator', personaId: 'lead', role: 'orchestrator' as const, live: true };
const writer = { threadId: 't-work', slotId: 'writer', personaId: 'writer', role: 'worker' as const, live: true };

describe('modernMemberCards', () => {
  it('stamps each member with its real squad role and execution cohort', () => {
    const items = [threadFleetItem(thread('t-lead', 'Lead thread'), { name: 'Proj', color: '#f00' })];
    const { cards, folded } = modernMemberCards([job([lead, writer, lead])], items, [{ id: 'writer', name: 'Writer' }]);
    expect([...folded]).toEqual(['t-lead', 't-work']);
    expect(cards.map((card) => card.session.cohort)).toEqual([
      expect.objectContaining({ cohortId: 'e-m', executionId: 'e-m', teamName: 'Modern squad', executionJobTitle: 'Modern job', role: 'orchestrator', slotLabel: 'Orchestrator' }),
      expect.objectContaining({ role: 'worker', slotId: 'writer', slotLabel: 'Writer' })
    ]);
    expect(cards[0]).toMatchObject({ projectName: 'Proj', projectColor: '#f00', modernThreadId: 't-lead', modernThread: { id: 't-lead' } });
    expect(cards[0]!.session).toMatchObject({ title: 'Lead thread', status: 'running', createdAt: 10 });
    // A member with no listed thread still renders, from the projection alone.
    expect(cards[1]).toMatchObject({ projectName: 'Proj', state: 'idle', modernThreadId: 't-work' });
    expect(cards[1]!.session).toMatchObject({ title: 'Writer', createdAt: 1 });
    expect(cards[1]).not.toHaveProperty('modernThread');
  });

  it('falls back for exited, unnamed members and teamless executions', () => {
    const { cards } = modernMemberCards(
      [job([{ ...writer, live: false, personaId: 'ghost' }], { teamId: undefined, teamName: undefined } as never)], []
    );
    expect(cards[0]).toMatchObject({ state: 'done', projectName: 'Project' });
    expect(cards[0]!.session).toMatchObject({ title: 'Squad member', status: 'exited' });
    expect(cards[0]!.session.cohort).toMatchObject({ teamId: 'execution', teamName: 'Squad' });
    expect(cards[0]!.session.cohort).not.toHaveProperty('slotLabel');
  });
});

describe('withModernSquadMembers', () => {
  it('returns the fleet unchanged when no execution has Modern members', () => {
    const fleet = [threadFleetItem(thread('t-solo', 'Solo'))];
    expect(withModernSquadMembers(fleet, [job([])])).toEqual(fleet);
  });

  it('replaces member threads with cards that partition like a CLI squad', () => {
    const fleet = withModernSquadMembers(
      [threadFleetItem(thread('t-lead', 'Lead')), threadFleetItem(thread('t-work', 'Work')), threadFleetItem(thread('t-solo', 'Solo'))],
      [job([lead, writer])]
    );
    expect(fleet.map((item) => `${item.kind}:${item.id}`)).toEqual(['thread:t-solo', 'agent:t-lead', 'agent:t-work']);
    const cards = fleet.flatMap((item) => (item.kind === 'agent' ? [item.card] : []));
    const { top, workersByHost } = partitionExecutionMembers(cards, [job([lead, writer])]);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ session: { id: 't-lead', title: 'Modern job' } });
    expect(top[0]).not.toHaveProperty('isSyntheticExecutionHost');
    expect(workersByHost.get('t-lead')?.map((card) => card.session.id)).toEqual(['t-work']);
  });
});

describe('Modern member card behavior', () => {
  const [hostCard, workerCard] = modernMemberCards([job([lead, writer])], []).cards as [AgentCard, AgentCard];

  it('opens the thread only for a nested member, never for the Job host', () => {
    expect(modernMemberThreadId(hostCard)).toBeUndefined();
    expect(modernMemberThreadId(workerCard)).toBe('t-work');
    const pty = { ...workerCard, modernThreadId: undefined } as AgentCard;
    expect(modernMemberThreadId(pty)).toBeUndefined();
  });

  it('keeps Modern members out of PTY close-idle and lane close-all', () => {
    expect(isReclaimableIdle(workerCard)).toBe(false);
    expect(isReclaimableIdle({ ...workerCard, modernThreadId: undefined })).toBe(true);
    expect(closeableLaneAgents([agentFleetItem(workerCard)])).toEqual([]);
  });
});

describe('modernFlowParticipants', () => {
  it('stamps Modern members with their cohort and leaves other visible threads Solo', () => {
    const byProject = modernFlowParticipants(
      [thread('t-work', 'Work'), thread('t-solo', 'Solo'), thread('t-old', 'Archived', { archivedAt: 5 } as never)],
      [job([{ ...writer, live: false }])],
      [{ id: 'writer', name: 'Writer' }]
    );
    expect(byProject.get('p')).toEqual([
      { id: 't-solo', label: 'Solo', state: 'idle', createdAt: 10 },
      expect.objectContaining({ id: 't-work', label: 'Work', exited: true, cohort: expect.objectContaining({ cohortId: 'e-m', role: 'worker' }) })
    ]);
  });
});
