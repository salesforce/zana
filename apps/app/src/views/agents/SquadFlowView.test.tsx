import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SquadFlowNode } from '@zana-ai/zcc-domain/product';

// The view pulls in the live store + canvas-pan hook at import; stub them so the
// pure `nodeActivity` export can be unit-tested without a running app.
vi.mock('@/store', () => ({
  useData: () => undefined,
  useAgentMesh: () => undefined,
  useAgentStatus: () => undefined,
  useSubagents: () => undefined,
  useSubagentChildren: () => undefined,
  agentViewTerminals: () => []
}));
vi.mock('@/hooks/useCanvasPan', () => ({ useCanvasPan: () => ({ isPanning: false, canvasPanProps: {} }) }));
vi.mock('@/lib/inspect-session', () => ({ inspectAgentSession: () => undefined }));
vi.mock('@/components/SquadSwitcher', () => ({ SquadSwitcher: () => null }));

import { nodeActivity } from './SquadFlowView';

const view = readFileSync(new URL('./SquadFlowView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

function flowNode(over: Partial<SquadFlowNode>): SquadFlowNode {
  return {
    sessionId: 's', label: 's', state: 'idle', liveSubagents: 0, exited: false, isOrchestrator: false, ...over
  };
}

describe('nodeActivity', () => {
  it('marks a fresh-lease claim as both working and streaming', () => {
    const node = flowNode({ claim: { claimedAt: 100, leaseExpiresAt: 2_000 } });
    expect(nodeActivity(node, 1_000)).toEqual({ working: true, streaming: true });
  });

  it('an expired-lease claim is still working but not streaming', () => {
    const node = flowNode({ claim: { claimedAt: 100, leaseExpiresAt: 500 } });
    expect(nodeActivity(node, 1_000)).toEqual({ working: true, streaming: false });
  });

  it('a working agent-state with no claim is working but not streaming (border, no self-arc)', () => {
    expect(nodeActivity(flowNode({ state: 'working' }), 1_000)).toEqual({ working: true, streaming: false });
  });

  it('an idle node with no claim is neither', () => {
    expect(nodeActivity(flowNode({ state: 'idle' }), 1_000)).toEqual({ working: false, streaming: false });
  });

  it('an exited node is never working or streaming even with a live lease', () => {
    const node = flowNode({ exited: true, state: 'working', claim: { leaseExpiresAt: 9_999 } });
    expect(nodeActivity(node, 1_000)).toEqual({ working: false, streaming: false });
  });
});

describe('SquadFlowView activity treatment wiring', () => {
  it('marks EVERY working node with a static border (no pulse — pulse is kanban-only)', () => {
    // working-tier class is applied on `working`, self-arc/live are gated on `streaming`.
    expect(view).toContain("${working && !quiescent ? 'squad-flow-node--working' : ''}");
    expect(view).toContain("${streaming && !quiescent ? 'squad-flow-node--streaming' : ''}");
    // The Flow graph must NOT borrow the kanban board's card pulse.
    expect(css).not.toContain('@keyframes squad-flow-pulse');
    expect(css).not.toMatch(/\.squad-flow-node--working \{[^}]*animation:/s);
  });

  it('draws the self-arc + live badge only for streaming nodes', () => {
    expect(view).toContain('nodeActivity(node, now).streaming ? (');
    expect(view).toContain('<SelfLoopArc');
    expect(view).toContain('{streaming && (');
    expect(view).toContain('className="squad-flow-live"');
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
    expect(view).toContain('aria-label="Squad run canvases. Drag empty space to pan."');
    expect(view).toContain('pannable={false}');
  });
});
