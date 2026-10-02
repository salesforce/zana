/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SquadFlowGraph, SquadFlowNode } from '@zana-ai/zcc-domain/product';

// The view pulls in the live store + canvas-pan hook + router at import; stub them
// so the pure `nodeActivity` export and the `SquadGraph` render can be tested
// without a running app or a Router provider.
const stores = vi.hoisted(() => ({
  data: {
    terminals: {} as Record<string, unknown[]>,
    projects: [] as Array<{ id: string; name: string; color?: string }>,
    includeScheduledAgentsInAgentView: true,
    flowAllOrganization: 'merged'
  },
  mesh: { agents: [] as unknown[], messages: [] as unknown[] },
  status: { byId: {} as Record<string, string>, since: {} as Record<string, number> },
  subagents: { byId: {} as Record<string, number> },
  children: { byId: {} as Record<string, unknown[]> },
  threads: [] as unknown[]
}));
vi.mock('@/store', () => ({
  useData: (selector: (state: typeof stores.data) => unknown) => selector(stores.data),
  useAgentMesh: (selector: (state: typeof stores.mesh) => unknown) => selector(stores.mesh),
  useAgentStatus: (selector: (state: typeof stores.status) => unknown) => selector(stores.status),
  useSubagents: (selector: (state: typeof stores.subagents) => unknown) => selector(stores.subagents),
  useSubagentChildren: (selector: (state: typeof stores.children) => unknown) => selector(stores.children),
  agentViewTerminals: (sessions: unknown[] | undefined) => sessions ?? []
}));
vi.mock('@/thread-store', () => ({
  useThreads: (selector: (state: { threads: unknown[] }) => unknown) => selector({ threads: stores.threads })
}));
vi.mock('@/hooks/useCanvasPan', () => ({ useCanvasPan: () => ({ isPanning: false, canvasPanProps: {} }) }));
const mobile = vi.hoisted(() => ({ compact: false, inspectAgent: vi.fn(), inspectThread: vi.fn() }));
vi.mock('@/hooks/useCompactLayout', () => ({ useCompactLayout: () => mobile.compact }));
vi.mock('@/lib/inspect-session', () => ({
  inspectAgentSession: mobile.inspectAgent,
  inspectThread: mobile.inspectThread
}));
afterEach(() => {
  cleanup();
  mobile.compact = false;
  mobile.inspectAgent.mockClear();
  mobile.inspectThread.mockClear();
  stores.data.terminals = {};
  stores.data.projects = [];
  stores.mesh.agents = [];
  stores.mesh.messages = [];
  stores.status.byId = {};
  stores.status.since = {};
  stores.threads = [];
});
vi.mock('@/components/SquadSwitcher', () => ({ SquadSwitcher: () => null }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import { nodeActivity, SquadFlowView, SquadGraph, STREAMING_FRESH_MS } from './SquadFlowView';

// happy-dom rewrites import.meta.url to a non-file scheme, so resolve source
// files from the repo root (vitest cwd) instead of a relative file URL.
const view = readFileSync(join(process.cwd(), 'apps/app/src/views/agents/SquadFlowView.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'apps/app/src/styles/global.css'), 'utf8');

function flowNode(over: Partial<SquadFlowNode>): SquadFlowNode {
  const sessionId = over.sessionId ?? 's';
  return {
    sessionId,
    inspectionTarget: over.inspectionTarget ?? { type: 'terminal', id: sessionId },
    label: 's', state: 'idle', liveSubagents: 0, exited: false, isOrchestrator: false, ...over
  };
}

describe('nodeActivity', () => {
  const now = 1_000_000;

  it('marks a claim with FRESH output progress as working AND streaming (and not "claimed")', () => {
    const node = flowNode({ state: 'working', claim: { claimedAt: 100, progressAt: now - 1_000, leaseExpiresAt: now + 60_000 } });
    expect(nodeActivity(node, now)).toEqual({ working: true, streaming: true, claimed: false });
  });

  it('a live LEASE but STALE progress on an idle dot is CLAIMED, not working — the stuck-worker fix', () => {
    // The agent-state renewal keeps leaseExpiresAt in the future for a silent worker.
    // Under the old rule a bare live lease read as "working" and drew a phantom self-arc;
    // now it must fall through to `claimed` (static chip, no motion).
    const node = flowNode({ claim: { claimedAt: 100, progressAt: now - STREAMING_FRESH_MS - 1, leaseExpiresAt: now + 60_000 } });
    expect(nodeActivity(node, now)).toEqual({ working: false, streaming: false, claimed: true });
  });

  it('a live lease with NO progressAt on an idle dot is CLAIMED, not working', () => {
    const node = flowNode({ claim: { claimedAt: 100, leaseExpiresAt: now + 60_000 } });
    expect(nodeActivity(node, now)).toEqual({ working: false, streaming: false, claimed: true });
  });

  it('a detached (board-synthesized, state:unknown) node with a stale claim is CLAIMED, never working', () => {
    const node = flowNode({ detached: true, state: 'unknown', claim: { claimedAt: 100, leaseExpiresAt: now + 60_000 } });
    expect(nodeActivity(node, now)).toEqual({ working: false, streaming: false, claimed: true });
  });

  it('a detached node WITH fresh progress streams (real output overrides the unknown dot)', () => {
    const node = flowNode({ detached: true, state: 'unknown', claim: { claimedAt: 100, progressAt: now - 500, leaseExpiresAt: now + 60_000 } });
    expect(nodeActivity(node, now)).toEqual({ working: true, streaming: true, claimed: false });
  });

  it('a working agent-state with no claim is working, not streaming, not claimed (self-arc, no live badge)', () => {
    expect(nodeActivity(flowNode({ state: 'working' }), now)).toEqual({ working: true, streaming: false, claimed: false });
  });

  it('an idle node with no claim is none of the three', () => {
    expect(nodeActivity(flowNode({ state: 'idle' }), now)).toEqual({ working: false, streaming: false, claimed: false });
  });

  it('an exited node is never working/streaming/claimed even with a fresh claim', () => {
    const node = flowNode({ exited: true, state: 'working', claim: { progressAt: now, leaseExpiresAt: now + 9_999 } });
    expect(nodeActivity(node, now)).toEqual({ working: false, streaming: false, claimed: false });
  });
});

describe('SquadGraph activity rendering (real DOM)', () => {
  afterEach(cleanup);

  const now = 5_000_000;

  // One graph exercising every tier at once. Bypasses buildSquadFlow so the test
  // owns each node's exact liveness inputs.
  function fourTierGraph(): SquadFlowGraph {
    const nodes: SquadFlowNode[] = [
      // fresh output → streaming (+working)
      flowNode({ sessionId: 'n-stream', label: 'stream', state: 'working', claim: { claimedAt: 1, progressAt: now - 2_000, leaseExpiresAt: now + 60_000 } }),
      // mesh 'working' but no fresh claim output → working only
      flowNode({ sessionId: 'n-work', label: 'work', state: 'working' }),
      // live lease, stale progress, idle dot → claimed (no motion)
      flowNode({ sessionId: 'n-claim', label: 'claim', state: 'idle', claim: { claimedAt: 1, progressAt: now - STREAMING_FRESH_MS - 1, leaseExpiresAt: now + 60_000 } }),
      // nothing → quiet
      flowNode({ sessionId: 'n-idle', label: 'idle', state: 'idle' })
    ];
    return {
      projectId: 'p1',
      nodes,
      edges: [],
      summary: { total: 4, working: 2, blocked: 0, idle: 2, exited: 0 },
      builtAt: now
    };
  }

  it('draws a self-arc ONLY for the two working nodes — never for a stranded claim or an idle node', () => {
    const { container } = render(<SquadGraph graph={fourTierGraph()} />);
    // The stuck-worker bug was a phantom self-arc on a bare claim; assert exactly two arcs.
    expect(container.querySelectorAll('.squad-flow-self-loop')).toHaveLength(2);
  });

  it('dims the self-arc for the mesh-working (no fresh output) node and leaves the streaming arc bright', () => {
    const { container } = render(<SquadGraph graph={fourTierGraph()} />);
    // Exactly one arc carries the dimmed --working variant (n-work); the streaming arc (n-stream) does not.
    expect(container.querySelectorAll('.squad-flow-self-loop--working')).toHaveLength(1);
  });

  it('shows the blue "live" badge only for the streaming node', () => {
    const { container } = render(<SquadGraph graph={fourTierGraph()} />);
    const live = container.querySelectorAll('.squad-flow-live');
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe('live');
  });

  it('shows the neutral "claimed · no recent output" chip only for the stranded-claim node', () => {
    const { container } = render(<SquadGraph graph={fourTierGraph()} />);
    const chips = container.querySelectorAll('.squad-flow-claimed');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('claimed · no recent output');
  });

  it('applies the tier border classes: --streaming (1), --working (2, incl. the streaming node), --claimed (1)', () => {
    const { container } = render(<SquadGraph graph={fourTierGraph()} />);
    expect(container.querySelectorAll('.squad-flow-node--streaming')).toHaveLength(1);
    expect(container.querySelectorAll('.squad-flow-node--working')).toHaveLength(2);
    expect(container.querySelectorAll('.squad-flow-node--claimed')).toHaveLength(1);
  });

  it('labels the stranded-claim node with the "claimed" verb, not "working"', () => {
    const { container } = render(<SquadGraph graph={fourTierGraph()} />);
    const verbs = [...container.querySelectorAll('.squad-flow-state-text')].map((el) => el.textContent ?? '');
    // The claimed node must NOT read "working" (it is not confirmed working).
    expect(verbs.some((v) => v.startsWith('claimed'))).toBe(true);
    // Exactly the two genuinely-working nodes say "working".
    expect(verbs.filter((v) => v.startsWith('working'))).toHaveLength(2);
  });

  it('a quiescent (all-exited) squad renders no self-arc and no live badge', () => {
    const graph = fourTierGraph();
    const exited = graph.nodes.map((n) => ({ ...n, exited: true }));
    const quiescent: SquadFlowGraph = { ...graph, nodes: exited, summary: { total: 4, working: 0, blocked: 0, idle: 0, exited: 4 } };
    const { container } = render(<SquadGraph graph={quiescent} />);
    expect(container.querySelectorAll('.squad-flow-self-loop')).toHaveLength(0);
    expect(container.querySelectorAll('.squad-flow-live')).toHaveLength(0);
  });
});

describe('SquadGraph blocker chip audience', () => {
  afterEach(cleanup);

  const now = 5_000_000;

  function blockerGraph(job: SquadFlowNode['job']): SquadFlowGraph {
    const nodes: SquadFlowNode[] = [flowNode({ sessionId: 'n-blocked', label: 'blocked', state: 'blocked', job })];
    return { projectId: 'p1', nodes, edges: [], summary: { total: 1, working: 0, blocked: 1, idle: 0, exited: 0 }, builtAt: now };
  }

  it('a human-audience blocker renders "Needs you" and not "Coordinator deciding"', () => {
    const { container } = render(
      <SquadGraph graph={blockerGraph({ executionId: 'e1', needsAttention: true, blockerQuestion: 'Which env?', blockerAudience: 'human' })} />
    );
    const needsYou = container.querySelectorAll('.squad-flow-node-blocker');
    expect(needsYou).toHaveLength(1);
    expect(needsYou[0].textContent).toContain('Needs you · Which env?');
    expect(container.querySelectorAll('.squad-flow-node-coord')).toHaveLength(0);
  });

  it('a coordinator-audience blocker renders "Coordinator deciding" and not "Needs you"', () => {
    const { container } = render(
      <SquadGraph graph={blockerGraph({ executionId: 'e1', needsAttention: false, blockerQuestion: 'Retry the failed unit?', blockerAudience: 'coordinator' })} />
    );
    const coord = container.querySelectorAll('.squad-flow-node-coord');
    expect(coord).toHaveLength(1);
    expect(coord[0].textContent).toContain('Coordinator deciding · Retry the failed unit?');
    expect(container.querySelectorAll('.squad-flow-node-blocker')).toHaveLength(0);
  });
});

describe('SquadFlowView activity CSS contract', () => {
  it('keeps the Flow graph off the kanban card pulse (motion is the chevron, not a breathing node)', () => {
    expect(css).not.toContain('@keyframes squad-flow-pulse');
    expect(css).not.toMatch(/\.squad-flow-node--working \{[^}]*animation:/s);
  });

  it('renders the "claimed" chip in a neutral (non-amber) colour so it never clashes with the gold orchestrator tag', () => {
    expect(css).toMatch(/\.squad-flow-claimed \{[^}]*color:\s*var\(--text-muted\)/s);
    // The old amber detached chip is gone.
    expect(css).not.toContain('.squad-flow-detached {');
  });
});

describe('SquadFlowView execution-board poll refresh', () => {
  it('uses allSettled so one project rejecting cannot blank out every project', () => {
    expect(view).toContain('Promise.allSettled(targets.map((id) => window.cc.executionBoard.listProject(id)))');
    expect(view).not.toContain('Promise.all(targets.map((id) => window.cc.executionBoard.listProject(id)))');
  });

  it('logs a rejected project poll instead of throwing unhandled', () => {
    expect(view).toContain(
      "console.error(\n                `[SquadFlowView] executionBoard.listProject failed for project ${pid}`,\n                result.reason\n              );"
    );
  });

  it('falls back to the project\'s own previously-fetched executions on rejection, not an empty list', () => {
    expect(view).toContain('return prev.filter((execution) => execution.projectId === pid);');
  });

  it('applies fulfilled results directly rather than gating the whole tick on every project succeeding', () => {
    expect(view).toContain('if (result.status === \'fulfilled\') return result.value.executions;');
  });
});

describe('SquadFlowView back-edge routing', () => {
  it('raises PAD_TOP so a top-row target keeps inY on-canvas', () => {
    expect(view).toContain('const EDGE_OFFSET = 22;');
    expect(view).toContain('const PAD_TOP = EDGE_OFFSET + 16;');
  });

  it('clamps back-edge inY so a top-row target cannot clip above y=0', () => {
    expect(view).toContain('const inY = Math.max(ty - EDGE_OFFSET, 4);');
  });
});

describe('SquadFlowView separate Team-run canvases', () => {
  it('uses one pannable scrollport for the full stack instead of nested run scrollports', () => {
    expect(css).toMatch(/\.squad-flow-run-groups \{[^}]*overflow:\s*auto;[^}]*cursor:\s*grab;/s);
    expect(css).toMatch(/\.squad-flow-run-groups \.squad-flow-canvas \{[^}]*overflow:\s*visible;/s);
    expect(view).toContain('Squad run canvases. Drag empty space to pan.');
    expect(view).toContain('Agent canvases. Swipe to explore.');
    expect(view).toContain('pannable={false}');
  });
});


describe('mobile canvas interaction', () => {
  afterEach(cleanup);
  it('leaves touch gestures to native scrolling and opens a tapped agent directly', () => {
    mobile.compact = true;
    const inspectJob = vi.fn();
    const graph: SquadFlowGraph = {
      projectId: 'p1', nodes: [flowNode({ sessionId: 'phone-agent', job: { executionId: 'e1' } })],
      edges: [], summary: { total: 1, working: 0, blocked: 0, idle: 1, exited: 0 }, builtAt: Date.now()
    };
    const { container, getByLabelText, rerender } = render(<SquadGraph graph={graph} onInspectExecution={inspectJob} />);
    const node = container.querySelector<HTMLButtonElement>('.squad-flow-node')!;
    expect(node.title).toContain('Tap to open agent');
    node.setPointerCapture = vi.fn();
    fireEvent.pointerDown(node, { pointerId: 1, pointerType: 'touch', button: 0 });
    fireEvent.pointerMove(node, { pointerId: 1, pointerType: 'touch', clientX: 90 });
    fireEvent.pointerCancel(node, { pointerId: 1 });
    expect(node.setPointerCapture).not.toHaveBeenCalled();
    expect(mobile.inspectAgent).not.toHaveBeenCalled();
    expect(node.classList.contains('squad-flow-node--dragging')).toBe(false);
    const canvas = getByLabelText('Agent canvas. Swipe to explore.');
    expect(canvas.scrollLeft).toBe(Number.parseFloat(node.style.left) + 244 / 2 - canvas.clientWidth / 2);
    canvas.scrollLeft = 17;
    rerender(<SquadGraph graph={{ ...graph, builtAt: graph.builtAt + 1 }} onInspectExecution={inspectJob} />);
    expect(canvas.scrollLeft).toBe(17);
    fireEvent.click(node);
    expect(mobile.inspectAgent).toHaveBeenCalledTimes(1);
    expect(mobile.inspectAgent).toHaveBeenCalledWith('phone-agent', 'p1', expect.any(Function));
    expect(inspectJob).not.toHaveBeenCalled();
  });
});

function modernThread(over: Record<string, unknown> = {}) {
  return {
    id: 'modern-1', projectId: 'p1', hostId: 'host', environmentId: null,
    providerId: 'fake', status: 'idle', title: 'Modern agent', createdAt: 100,
    cwd: '/work/p1', branchName: null, isWorktree: false, ...over
  };
}

describe('SquadFlowView modern thread integration', () => {
  it('renders a modern-only registered project and maps pending interaction state', () => {
    stores.data.projects = [{ id: 'p1', name: 'Modern project' }];
    stores.threads = [modernThread({ title: 'Needs review', hasPendingInteraction: true })];

    const { container } = render(<SquadFlowView />);

    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(container.querySelector('.squad-flow-node .agent-blocked')).toBeTruthy();
  });

  it('renders mixed terminal and modern participants with colliding raw ids as separate nodes', () => {
    stores.data.projects = [{ id: 'p1', name: 'Mixed project' }];
    stores.data.terminals = { p1: [{
      id: 'same', projectId: 'p1', title: 'CLI agent', profile: 'claude', cwd: '/work/p1',
      status: 'running', createdAt: 1
    }] };
    stores.threads = [modernThread({ id: 'same', title: 'Modern same id', activity: { activeBackgroundCommandCount: 1 } })];

    const { container } = render(<SquadFlowView projectId="p1" />);

    expect(screen.getByText('CLI agent')).toBeTruthy();
    expect(screen.getByText('Modern same id')).toBeTruthy();
    expect(container.querySelectorAll('.squad-flow-node')).toHaveLength(2);
    expect(container.querySelectorAll('.squad-flow-node--working')).toHaveLength(1);
  });

  it('excludes archived threads and threads belonging to unregistered projects', () => {
    stores.data.projects = [{ id: 'p1', name: 'Visible project' }];
    stores.threads = [
      modernThread({ id: 'archived', title: 'Archived modern', archivedAt: 123 }),
      modernThread({ id: 'unknown-project', projectId: 'missing', title: 'Unknown project modern' }),
      modernThread({ id: 'visible', title: 'Visible modern' })
    ];

    render(<SquadFlowView />);

    expect(screen.getByText('Visible modern')).toBeTruthy();
    expect(screen.queryByText('Archived modern')).toBeNull();
    expect(screen.queryByText('Unknown project modern')).toBeNull();
  });

  it('routes desktop single-click and compact click to thread inspection without double-click reopening', () => {
    const graph: SquadFlowGraph = {
      projectId: 'p1',
      nodes: [flowNode({
        sessionId: 'thread:modern-1', label: 'Modern',
        inspectionTarget: { type: 'thread', id: 'modern-1' }
      })],
      edges: [], summary: { total: 1, working: 0, blocked: 0, idle: 1, exited: 0 }, builtAt: Date.now()
    };
    const { container, rerender } = render(<SquadGraph graph={graph} />);
    let node = container.querySelector<HTMLButtonElement>('.squad-flow-node')!;
    node.setPointerCapture = vi.fn();
    node.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(node, { pointerId: 1, button: 0, timeStamp: 100 });
    fireEvent.pointerUp(node, { pointerId: 1, button: 0, timeStamp: 100 });
    fireEvent.pointerDown(node, { pointerId: 2, button: 0, timeStamp: 200 });
    fireEvent.pointerUp(node, { pointerId: 2, button: 0, timeStamp: 200 });
    fireEvent.doubleClick(node);
    expect(mobile.inspectThread).toHaveBeenCalledTimes(1);
    expect(mobile.inspectThread).toHaveBeenCalledWith('modern-1', 'p1', expect.any(Function));
    expect(mobile.inspectAgent).not.toHaveBeenCalled();

    expect(node.title).toBe('Modern (Click to open thread)');

    mobile.inspectThread.mockClear();
    mobile.compact = true;
    rerender(<SquadGraph graph={graph} />);
    node = container.querySelector<HTMLButtonElement>('.squad-flow-node')!;
    fireEvent.click(node);
    expect(mobile.inspectThread).toHaveBeenCalledOnce();
  });

  it('clears thread double-click suppression when the graph changes', () => {
    const threadNode = flowNode({
      sessionId: 'thread:modern-1', label: 'Modern',
      inspectionTarget: { type: 'thread', id: 'modern-1' }
    });
    const graph = (builtAt: number): SquadFlowGraph => ({
      projectId: 'p1', nodes: [threadNode], edges: [],
      summary: { total: 1, working: 0, blocked: 0, idle: 1, exited: 0 }, builtAt
    });
    const { container, rerender } = render(<SquadGraph graph={graph(1)} />);
    const click = () => {
      const node = container.querySelector<HTMLButtonElement>('.squad-flow-node')!;
      node.setPointerCapture = vi.fn();
      node.releasePointerCapture = vi.fn();
      fireEvent.pointerDown(node, { pointerId: 1, button: 0, timeStamp: 100 });
      fireEvent.pointerUp(node, { pointerId: 1, button: 0, timeStamp: 100 });
    };
    click();
    rerender(<SquadGraph graph={graph(2)} />);
    click();
    expect(mobile.inspectThread).toHaveBeenCalledTimes(2);
  });

  it('preserves terminal job single-click precedence and terminal double-click inspection', () => {
    const inspectJob = vi.fn();
    const graph: SquadFlowGraph = {
      projectId: 'p1',
      nodes: [flowNode({ sessionId: 'cli-1', inspectionTarget: { type: 'terminal', id: 'cli-1' }, job: { executionId: 'job-1', needsAttention: false } })],
      edges: [], summary: { total: 1, working: 0, blocked: 0, idle: 1, exited: 0 }, builtAt: Date.now()
    };
    const { container } = render(<SquadGraph graph={graph} onInspectExecution={inspectJob} />);
    const node = container.querySelector<HTMLButtonElement>('.squad-flow-node')!;
    node.setPointerCapture = vi.fn();
    node.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(node, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(node, { pointerId: 1, button: 0 });
    expect(inspectJob).toHaveBeenCalledWith('p1', 'job-1');
    expect(mobile.inspectAgent).not.toHaveBeenCalled();
    fireEvent.doubleClick(node);
    expect(mobile.inspectAgent).toHaveBeenCalledWith('cli-1', 'p1', expect.any(Function));
  });
});
