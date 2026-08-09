import { describe, it, expect } from 'vitest';
import type {
  AgentMessage,
  AgentRecord,
  AgentState,
  SquadFlowGraph,
  SquadFlowNode,
  TerminalSession
} from '../../../shared/types.js';
import { buildSquadFlow, SOLO_LAUNCH_ID, type SquadFlowInputs } from '../squadFlow.js';

// ---- builders ---------------------------------------------------------------

function session(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'sid',
    projectId: 'p1',
    title: 'claude',
    profile: 'claude',
    cwd: '/work/p1',
    status: 'running',
    createdAt: 0,
    ...over
  };
}

function agent(over: Partial<AgentRecord>): AgentRecord {
  return {
    sessionId: 'sid',
    projectId: 'p1',
    cwd: '/work/p1',
    registeredAt: 0,
    ...over
  };
}

function message(over: Partial<AgentMessage>): AgentMessage {
  return {
    id: 'm1',
    ts: 1000,
    fromSessionId: 'a',
    fromHandle: 'a',
    toSessionId: 'b',
    toHandle: 'b',
    projectId: 'p1',
    body: 'hi',
    ...over
  };
}

function inputs(over: Partial<SquadFlowInputs>): SquadFlowInputs {
  return {
    projectId: 'p1',
    sessions: [],
    agents: [],
    messages: [],
    statusById: {},
    sinceById: {},
    subagentsById: {},
    subagentChildrenById: {},
    builtAt: 5000,
    ...over
  };
}

/** sessionId → node, for terse assertions. */
function nodeMap(g: SquadFlowGraph): Map<string, SquadFlowNode> {
  return new Map(g.nodes.map((n) => [n.sessionId, n]));
}

// ---- node membership --------------------------------------------------------

describe('buildSquadFlow — node membership', () => {
  it('returns null when no live agents exist', () => {
    expect(buildSquadFlow(inputs({}))).toBeNull();
  });

  it('builds a node per registry agent in the project', () => {
    const g = buildSquadFlow(
      inputs({ agents: [agent({ sessionId: 'arch', handle: 'architect' })] })
    );
    expect(g).not.toBeNull();
    expect(g!.nodes).toHaveLength(1);
    expect(g!.nodes[0].sessionId).toBe('arch');
  });

  it('includes a live agent session even if it never registered a handle', () => {
    const g = buildSquadFlow(
      inputs({ sessions: [session({ id: 'unreg', title: 'worker' })] })
    );
    expect(nodeMap(g!).has('unreg')).toBe(true);
  });

  it('excludes plain shell sessions (no agent)', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [agent({ sessionId: 'arch' })],
        sessions: [session({ id: 'sh', profile: 'shell' })]
      })
    );
    expect(nodeMap(g!).has('sh')).toBe(false);
  });

  it('does not double-count a session that is also a registry agent', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [agent({ sessionId: 'dup', handle: 'h' })],
        sessions: [session({ id: 'dup', title: 'tab title' })]
      })
    );
    expect(g!.nodes).toHaveLength(1);
  });
});

// ---- identity & fused fields ------------------------------------------------

describe('buildSquadFlow — node fields', () => {
  it('labels by handle, falling back to displayName then sessionId', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [
          agent({ sessionId: 'a', handle: 'architect', displayName: 'Tab A' }),
          agent({ sessionId: 'b', displayName: 'Designer Tab' }),
          agent({ sessionId: 'c' })
        ]
      })
    );
    const m = nodeMap(g!);
    expect(m.get('a')!.label).toBe('architect');
    expect(m.get('b')!.label).toBe('Designer Tab');
    expect(m.get('c')!.label).toBe('c');
  });

  it('fuses live state, stateSince and sub-agent count by sessionId', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [agent({ sessionId: 'a', handle: 'a' })],
        statusById: { a: 'working' as AgentState },
        sinceById: { a: 4200 },
        subagentsById: { a: 2 }
      })
    );
    const n = nodeMap(g!).get('a')!;
    expect(n.state).toBe('working');
    expect(n.stateSince).toBe(4200);
    expect(n.liveSubagents).toBe(2);
  });

  it('defaults state to unknown and sub-agents to 0 when absent', () => {
    const g = buildSquadFlow(inputs({ agents: [agent({ sessionId: 'a' })] }));
    const n = nodeMap(g!).get('a')!;
    expect(n.state).toBe('unknown');
    expect(n.liveSubagents).toBe(0);
  });

  it('marks a node exited when its backing session has exited', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [agent({ sessionId: 'a', handle: 'a' })],
        sessions: [session({ id: 'a', status: 'exited' })]
      })
    );
    expect(nodeMap(g!).get('a')!.exited).toBe(true);
  });
});

// ---- sub-agent children (A3) ------------------------------------------------

describe('buildSquadFlow — sub-agent children', () => {
  it('attaches child records to the node when the map has an entry', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [agent({ sessionId: 'a', handle: 'a' })],
        subagentsById: { a: 2 },
        subagentChildrenById: {
          a: [
            { id: 'a:0', subagentType: 'code-reviewer', status: 'running', startedAt: 1 },
            { id: 'a:1', subagentType: 'researcher', status: 'done', startedAt: 2, stoppedAt: 3 }
          ]
        }
      })
    );
    const n = nodeMap(g!).get('a')!;
    expect(n.subagentChildren).toHaveLength(2);
    expect(n.subagentChildren?.[0].subagentType).toBe('code-reviewer');
    expect(n.liveSubagents).toBe(2);
  });

  it('leaves subagentChildren undefined when no record exists (count-badge fallback)', () => {
    const g = buildSquadFlow(
      inputs({ agents: [agent({ sessionId: 'a' })], subagentsById: { a: 3 } })
    );
    const n = nodeMap(g!).get('a')!;
    expect(n.subagentChildren).toBeUndefined();
    expect(n.liveSubagents).toBe(3); // count is independent of the child array
  });
});

// ---- edges ------------------------------------------------------------------

describe('buildSquadFlow — handoff edges', () => {
  const twoAgents = [
    agent({ sessionId: 'a', handle: 'a' }),
    agent({ sessionId: 'b', handle: 'b' })
  ];

  it('creates a directed edge from an agent→agent message', () => {
    const g = buildSquadFlow(
      inputs({
        agents: twoAgents,
        messages: [message({ fromSessionId: 'a', toSessionId: 'b' })]
      })
    );
    expect(g!.edges).toHaveLength(1);
    expect(g!.edges[0]).toMatchObject({ fromSessionId: 'a', toSessionId: 'b', count: 1 });
  });

  it('aggregates repeated messages into one edge with a count and latest ts', () => {
    const g = buildSquadFlow(
      inputs({
        agents: twoAgents,
        messages: [
          message({ id: 'm1', ts: 1000, fromSessionId: 'a', toSessionId: 'b' }),
          message({ id: 'm2', ts: 3000, fromSessionId: 'a', toSessionId: 'b' })
        ]
      })
    );
    expect(g!.edges).toHaveLength(1);
    expect(g!.edges[0].count).toBe(2);
    expect(g!.edges[0].lastTs).toBe(3000);
  });

  it('keeps direction distinct (a→b and b→a are separate edges)', () => {
    const g = buildSquadFlow(
      inputs({
        agents: twoAgents,
        messages: [
          message({ id: 'm1', fromSessionId: 'a', toSessionId: 'b' }),
          message({ id: 'm2', fromSessionId: 'b', toSessionId: 'a' })
        ]
      })
    );
    expect(g!.edges).toHaveLength(2);
  });

  it('drops edges whose endpoint is not a squad member', () => {
    const g = buildSquadFlow(
      inputs({
        agents: twoAgents,
        messages: [message({ fromSessionId: 'a', toSessionId: 'stranger' })]
      })
    );
    expect(g!.edges).toHaveLength(0);
  });

  it('marks pending when the most-recent message on the edge is undelivered', () => {
    const g = buildSquadFlow(
      inputs({
        agents: twoAgents,
        messages: [
          message({ id: 'm1', ts: 1000, fromSessionId: 'a', toSessionId: 'b', deliveredAt: 1100 }),
          message({ id: 'm2', ts: 3000, fromSessionId: 'a', toSessionId: 'b', deliveredAt: undefined })
        ]
      })
    );
    expect(g!.edges[0].pending).toBe(true);
  });

  it('caps processed messages to the newest 200 (Rule 5 retention)', () => {
    const many: AgentMessage[] = Array.from({ length: 250 }, (_, i) =>
      message({ id: `m${i}`, ts: i, fromSessionId: 'a', toSessionId: 'b' })
    );
    const g = buildSquadFlow(inputs({ agents: twoAgents, messages: many }));
    // One aggregated edge, but its count reflects only the capped window.
    expect(g!.edges[0].count).toBe(200);
  });
});

// ---- orchestrator detection -------------------------------------------------

describe('buildSquadFlow — orchestrator', () => {
  it('marks the highest out-degree node as orchestrator', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [
          agent({ sessionId: 'a', handle: 'a' }),
          agent({ sessionId: 'b', handle: 'b' }),
          agent({ sessionId: 'c', handle: 'c' })
        ],
        messages: [
          message({ id: 'm1', fromSessionId: 'a', toSessionId: 'b' }),
          message({ id: 'm2', fromSessionId: 'a', toSessionId: 'c' })
        ]
      })
    );
    const m = nodeMap(g!);
    expect(m.get('a')!.isOrchestrator).toBe(true);
    expect(m.get('b')!.isOrchestrator).toBe(false);
    expect(m.get('c')!.isOrchestrator).toBe(false);
  });

  it('breaks ties (no handoffs yet) by earliest registeredAt', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [
          agent({ sessionId: 'late', handle: 'late', registeredAt: 200 }),
          agent({ sessionId: 'early', handle: 'early', registeredAt: 100 })
        ]
      })
    );
    const m = nodeMap(g!);
    expect(m.get('early')!.isOrchestrator).toBe(true);
    expect(m.get('late')!.isOrchestrator).toBe(false);
  });

  it('marks exactly one orchestrator', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [
          agent({ sessionId: 'a', handle: 'a', registeredAt: 1 }),
          agent({ sessionId: 'b', handle: 'b', registeredAt: 2 })
        ]
      })
    );
    expect(g!.nodes.filter((n) => n.isOrchestrator)).toHaveLength(1);
  });
});

// ---- launch filter (second picker) ------------------------------------------

describe('buildSquadFlow — launchFilter (one squad within a project)', () => {
  const twoSquads = [
    agent({ sessionId: 'l1a', handle: 'l1a', teamLaunchId: 'L1' }),
    agent({ sessionId: 'l1b', handle: 'l1b', teamLaunchId: 'L1' }),
    agent({ sessionId: 'l2a', handle: 'l2a', teamLaunchId: 'L2' }),
    agent({ sessionId: 'solo', handle: 'solo' }) // no launch id → solo bucket
  ];

  it('with no filter, merges every agent (unchanged behavior)', () => {
    const g = buildSquadFlow(inputs({ agents: twoSquads }));
    expect(g!.nodes).toHaveLength(4);
  });

  it('keeps only agents of the selected launch', () => {
    const g = buildSquadFlow(inputs({ agents: twoSquads, launchFilter: 'L1' }));
    expect(g!.nodes.map((n) => n.sessionId).sort()).toEqual(['l1a', 'l1b']);
  });

  it('SOLO bucket selects only agents with no launch id', () => {
    const g = buildSquadFlow(inputs({ agents: twoSquads, launchFilter: SOLO_LAUNCH_ID }));
    expect(g!.nodes.map((n) => n.sessionId)).toEqual(['solo']);
  });

  it('puts unregistered live sessions in the SOLO bucket (not a real launch)', () => {
    const g = buildSquadFlow(
      inputs({
        agents: [agent({ sessionId: 'l1a', handle: 'l1a', teamLaunchId: 'L1' })],
        sessions: [session({ id: 'unreg', title: 'ad-hoc' })],
        launchFilter: SOLO_LAUNCH_ID
      })
    );
    expect(g!.nodes.map((n) => n.sessionId)).toEqual(['unreg']);
  });

  it('returns null when the selected launch has no members', () => {
    const g = buildSquadFlow(inputs({ agents: twoSquads, launchFilter: 'NOPE' }));
    expect(g).toBeNull();
  });

  it('does NOT re-admit a filtered-out agent through its backing session', () => {
    // Every agent has a live session (the real-app shape). Filtering to SOLO
    // must keep ONLY the solo agent — the L1/L2 agents' sessions are registry
    // agents that were scoped out, not unregistered solo material.
    const g = buildSquadFlow(
      inputs({
        agents: twoSquads,
        sessions: twoSquads.map((a) => session({ id: a.sessionId, title: a.handle })),
        launchFilter: SOLO_LAUNCH_ID
      })
    );
    expect(g!.nodes.map((n) => n.sessionId)).toEqual(['solo']);
  });

  it('keeps only the selected launch even when every agent has a session', () => {
    const g = buildSquadFlow(
      inputs({
        agents: twoSquads,
        sessions: twoSquads.map((a) => session({ id: a.sessionId, title: a.handle })),
        launchFilter: 'L1'
      })
    );
    expect(g!.nodes.map((n) => n.sessionId).sort()).toEqual(['l1a', 'l1b']);
  });

  it('recomputes the orchestrator WITHIN the squad (not inherited from the merge)', () => {
    // Across the whole project, l1a has the highest out-degree (2 sends) so it
    // would be the merged orchestrator. Filtered to L2, l2a must lead its own squad.
    const g = buildSquadFlow(
      inputs({
        agents: [
          agent({ sessionId: 'l1a', handle: 'l1a', teamLaunchId: 'L1' }),
          agent({ sessionId: 'l1b', handle: 'l1b', teamLaunchId: 'L1' }),
          agent({ sessionId: 'l2a', handle: 'l2a', teamLaunchId: 'L2' }),
          agent({ sessionId: 'l2b', handle: 'l2b', teamLaunchId: 'L2' })
        ],
        messages: [
          message({ id: 'm1', fromSessionId: 'l1a', toSessionId: 'l1b' }),
          message({ id: 'm2', fromSessionId: 'l1a', toSessionId: 'l2a' }),
          message({ id: 'm3', fromSessionId: 'l2a', toSessionId: 'l2b' })
        ],
        launchFilter: 'L2'
      })
    );
    const m = nodeMap(g!);
    expect(m.get('l2a')!.isOrchestrator).toBe(true);
    expect(m.get('l2b')!.isOrchestrator).toBe(false);
    // The cross-squad message (l1a→l2a) is dropped: l1a isn't an L2 member.
    expect(g!.edges).toHaveLength(1);
    expect(g!.edges[0]).toMatchObject({ fromSessionId: 'l2a', toSessionId: 'l2b' });
  });

  it('rolls up the summary within the selected squad only', () => {
    const g = buildSquadFlow(
      inputs({
        agents: twoSquads,
        statusById: {
          l1a: 'working' as AgentState,
          l1b: 'idle' as AgentState,
          l2a: 'working' as AgentState
        },
        launchFilter: 'L1'
      })
    );
    expect(g!.summary).toEqual({ total: 2, working: 1, blocked: 0, idle: 1, exited: 0 });
  });
});

// ---- summary & meta ---------------------------------------------------------

describe('buildSquadFlow — summary', () => {
  it('rolls up state counts and carries builtAt + squad descriptor', () => {
    const g = buildSquadFlow(
      inputs({
        squad: { id: 'frontend-squad', name: 'Frontend Squad', workerCount: 4 },
        agents: [
          agent({ sessionId: 'a', handle: 'a' }),
          agent({ sessionId: 'b', handle: 'b' }),
          agent({ sessionId: 'c', handle: 'c' }),
          agent({ sessionId: 'd', handle: 'd' })
        ],
        sessions: [session({ id: 'd', status: 'exited' })],
        statusById: {
          a: 'working' as AgentState,
          b: 'blocked' as AgentState,
          c: 'idle' as AgentState
        }
      })
    );
    expect(g!.summary).toEqual({ total: 4, working: 1, blocked: 1, idle: 1, exited: 1 });
    expect(g!.builtAt).toBe(5000);
    expect(g!.squad?.id).toBe('frontend-squad');
  });
});
