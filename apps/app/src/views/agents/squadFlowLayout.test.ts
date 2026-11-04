import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SquadFlowGraph, SquadFlowNode, SubagentChild } from '@zana-ai/zcc-domain/product';
import {
  BLOCKER_H,
  CHILD_GAP,
  CHILD_ROW_H,
  CHILDREN_PAD,
  childRowCounts,
  COL_GAP,
  edgeRoute,
  layout,
  MAX_VISIBLE_CHILDREN,
  NODE_H,
  NODE_W,
  nodeHeight,
  nodeNotice,
  PAD_TOP,
  PAD_X,
  ROW_GAP
} from './squadFlowLayout';

function children(n: number): SubagentChild[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, status: 'running', startedAt: i }));
}

function flowNode(over: Partial<SquadFlowNode>): SquadFlowNode {
  const sessionId = over.sessionId ?? 's';
  return {
    sessionId,
    inspectionTarget: { type: 'terminal', id: sessionId },
    label: sessionId, state: 'idle', liveSubagents: 0, exited: false, isOrchestrator: false, ...over
  };
}

function graph(nodes: SquadFlowNode[]): SquadFlowGraph {
  return { projectId: 'p1', nodes, edges: [], summary: { total: nodes.length, working: 0, blocked: 0, idle: 0, exited: 0 }, builtAt: 1 };
}

const blocker = { executionId: 'e1', needsAttention: true, blockerQuestion: 'Which env?', blockerAudience: 'human' as const };

/** Smallest canvas width that fits exactly `n` cards per row. */
function widthFor(n: number): number {
  return PAD_X * 2 + n * NODE_W + (n - 1) * COL_GAP;
}

describe('childRowCounts', () => {
  it('is empty with no child records, even when the live count is non-zero', () => {
    expect(childRowCounts(flowNode({}))).toEqual({ visible: 0, hidden: 0 });
    expect(childRowCounts(flowNode({ liveSubagents: 3 }))).toEqual({ visible: 0, hidden: 0 });
  });

  it('shows every record up to the cap', () => {
    expect(childRowCounts(flowNode({ subagentChildren: children(1), liveSubagents: 1 }))).toEqual({ visible: 1, hidden: 0 });
    expect(childRowCounts(flowNode({ subagentChildren: children(4), liveSubagents: 4 }))).toEqual({ visible: 4, hidden: 0 });
  });

  it('collapses records past the cap into hidden', () => {
    expect(childRowCounts(flowNode({ subagentChildren: children(7), liveSubagents: 7 })))
      .toEqual({ visible: MAX_VISIBLE_CHILDREN, hidden: 3 });
  });

  it('counts live sub-agents without a record as hidden', () => {
    expect(childRowCounts(flowNode({ subagentChildren: children(2), liveSubagents: 5 }))).toEqual({ visible: 2, hidden: 3 });
  });
});

describe('nodeNotice', () => {
  it('is a blocker only for a needs-attention, non-coordinator question', () => {
    expect(nodeNotice(flowNode({ job: blocker }))).toBe('blocker');
    expect(nodeNotice(flowNode({ job: { ...blocker, needsAttention: false } }))).toBeUndefined();
    expect(nodeNotice(flowNode({ job: { ...blocker, blockerQuestion: undefined } }))).toBeUndefined();
  });

  it('is a coordinator notice for any coordinator-audience question', () => {
    expect(nodeNotice(flowNode({ job: { ...blocker, needsAttention: false, blockerAudience: 'coordinator' } }))).toBe('coordinator');
    expect(nodeNotice(flowNode({ job: { ...blocker, blockerAudience: 'coordinator' } }))).toBe('coordinator');
    expect(nodeNotice(flowNode({ job: { executionId: 'e1', blockerAudience: 'coordinator' } }))).toBeUndefined();
  });

  it('is absent without a job', () => {
    expect(nodeNotice(flowNode({}))).toBeUndefined();
  });
});

describe('nodeHeight', () => {
  it('is NODE_H for a plain card', () => {
    expect(nodeHeight(flowNode({}))).toBe(NODE_H);
    expect(nodeHeight(flowNode({ liveSubagents: 3 }))).toBe(NODE_H);
  });

  it('adds the children section: padding, rows and gaps', () => {
    expect(nodeHeight(flowNode({ subagentChildren: children(1), liveSubagents: 1 }))).toBe(NODE_H + CHILDREN_PAD + CHILD_ROW_H);
    // 4 named rows + "+3 more"
    expect(nodeHeight(flowNode({ subagentChildren: children(7), liveSubagents: 7 })))
      .toBe(NODE_H + CHILDREN_PAD + 5 * CHILD_ROW_H + 4 * CHILD_GAP);
  });

  it('is monotonic in child count and plateaus once rows collapse into "+N more"', () => {
    const heights = [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
      nodeHeight(flowNode({ subagentChildren: n ? children(n) : undefined, liveSubagents: n })));
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    expect(heights[5]).toBeGreaterThan(heights[4]);
    expect(heights[7]).toBe(heights[5]);
  });

  it('adds BLOCKER_H for a blocker or coordinator notice', () => {
    expect(nodeHeight(flowNode({ job: blocker }))).toBe(NODE_H + BLOCKER_H);
    expect(nodeHeight(flowNode({ job: { ...blocker, blockerAudience: 'coordinator' } }))).toBe(NODE_H + BLOCKER_H);
    expect(nodeHeight(flowNode({ job: blocker, subagentChildren: children(2), liveSubagents: 2 })))
      .toBe(nodeHeight(flowNode({ subagentChildren: children(2), liveSubagents: 2 })) + BLOCKER_H);
  });
});

describe('layout', () => {
  const mixed = [
    flowNode({ sessionId: 'tall', subagentChildren: children(7), liveSubagents: 7 }),
    flowNode({ sessionId: 'plain' }),
    flowNode({ sessionId: 'blocked', job: blocker }),
    flowNode({ sessionId: 'mid', subagentChildren: children(2), liveSubagents: 2 }),
    flowNode({ sessionId: 'plain2' }),
    flowNode({ sessionId: 'tall2', subagentChildren: children(5), liveSubagents: 5 }),
    flowNode({ sessionId: 'plain3' })
  ];

  for (const perRow of [1, 2, 3]) {
    it(`never overlaps consecutive rows (${perRow} per row)`, () => {
      const { placed, height } = layout(graph(mixed), widthFor(perRow));
      const rows = new Map<number, typeof placed>();
      for (const p of placed) rows.set(p.y, [...(rows.get(p.y) ?? []), p]);
      const tops = [...rows.keys()].sort((a, b) => a - b);
      expect(tops).toHaveLength(Math.ceil(mixed.length / perRow));
      for (const p of placed) expect(p.height).toBe(nodeHeight(p.node));
      const rowMax = (y: number) => Math.max(...rows.get(y)!.map((p) => p.height));
      for (let r = 0; r + 1 < tops.length; r++) {
        expect(tops[r + 1]).toBe(tops[r] + rowMax(tops[r]) + ROW_GAP);
      }
      const last = tops[tops.length - 1];
      expect(height).toBe(last + rowMax(last) + PAD_TOP);
    });
  }

  it('starts workers at PAD_TOP when there is no orchestrator', () => {
    const { placed } = layout(graph([flowNode({ sessionId: 'a' }), flowNode({ sessionId: 'b' })]), widthFor(3));
    expect(placed.every((p) => p.y === PAD_TOP)).toBe(true);
  });

  it('puts the worker row below the orchestrator\'s own height', () => {
    const orch = flowNode({ sessionId: 'o', isOrchestrator: true, subagentChildren: children(4), liveSubagents: 4 });
    const { placed } = layout(graph([orch, flowNode({ sessionId: 'w' })]), widthFor(3));
    expect(placed[0]).toMatchObject({ y: PAD_TOP, height: nodeHeight(orch) });
    expect(placed[1].y).toBe(PAD_TOP + nodeHeight(orch) + ROW_GAP);
  });
});

describe('layout — multiple orchestrators', () => {
  const o1 = flowNode({ sessionId: 'o1', isOrchestrator: true });
  const o2 = flowNode({ sessionId: 'o2', isOrchestrator: true, subagentChildren: children(3), liveSubagents: 3 });
  const w = flowNode({ sessionId: 'w' });

  it('places every orchestrator in row 0, centered, with workers below the tallest', () => {
    const width = widthFor(3);
    const { placed } = layout(graph([o1, w, o2]), width);
    const byId = new Map(placed.map((p) => [p.node.sessionId, p]));
    expect(placed).toHaveLength(3);
    expect(byId.get('o1')!.y).toBe(PAD_TOP);
    expect(byId.get('o2')!.y).toBe(PAD_TOP);
    const rowWidth = 2 * NODE_W + COL_GAP;
    expect(byId.get('o1')!.x).toBe((width - rowWidth) / 2);
    expect(byId.get('o2')!.x).toBe((width - rowWidth) / 2 + NODE_W + COL_GAP);
    expect(byId.get('w')!.y).toBe(PAD_TOP + nodeHeight(o2) + ROW_GAP);
    expect(edgeRoute(byId.get('o2')!, byId.get('w')!)[0].y).toBe(PAD_TOP + nodeHeight(o2));
  });

  it('wraps orchestrators like workers when they exceed one row', () => {
    const { placed } = layout(graph([o1, o2, w]), widthFor(1));
    const byId = new Map(placed.map((p) => [p.node.sessionId, p]));
    expect(byId.get('o1')!.y).toBe(PAD_TOP);
    expect(byId.get('o2')!.y).toBe(PAD_TOP + NODE_H + ROW_GAP);
    expect(byId.get('w')!.y).toBe(PAD_TOP + NODE_H + ROW_GAP + nodeHeight(o2) + ROW_GAP);
  });
});

describe('card constants match the pinned global.css values', () => {
  const css = readFileSync(join(process.cwd(), 'apps/app/src/styles/global.css'), 'utf8');
  const rule = (selector: string): string => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.-]/g, '\\$&')} \\{([^}]*)\\}`));
    expect(match, selector).not.toBeNull();
    return match![1];
  };
  const px = (selector: string, prop: string): number => {
    const value = rule(selector).match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)px`))?.[1];
    expect(value, `${selector} ${prop}`).toBeDefined();
    return Number(value);
  };

  it('derives NODE_H from card border, padding, row heights and body gap', () => {
    const border = px('.squad-flow-node', 'border');
    const padding = px('.squad-flow-node', 'padding');
    expect(NODE_H).toBe(2 * border + 2 * padding + px('.squad-flow-node-top', 'height')
      + px('.squad-flow-node-body', 'gap') + px('.squad-flow-node-state', 'height'));
  });

  it('derives BLOCKER_H from the body gap and the notice line height', () => {
    expect(px('.squad-flow-node-coord', 'height')).toBe(px('.squad-flow-node-blocker', 'height'));
    expect(BLOCKER_H).toBe(px('.squad-flow-node-body', 'gap') + px('.squad-flow-node-blocker', 'height'));
  });

  it('derives the children section constants', () => {
    expect(CHILDREN_PAD).toBe(px('.squad-flow-node', 'gap') + px('.squad-flow-children', 'margin-top')
      + px('.squad-flow-children', 'border-top') + px('.squad-flow-children', 'padding-top'));
    expect(CHILD_GAP).toBe(px('.squad-flow-children', 'gap'));
    expect(CHILD_ROW_H).toBe(px('.squad-flow-child', 'height'));
    expect(CHILD_ROW_H).toBe(px('.squad-flow-child-more', 'height'));
  });
});

describe('edgeRoute', () => {
  it('leaves the source from its own bottom edge', () => {
    const tall = flowNode({ sessionId: 'o', subagentChildren: children(7), liveSubagents: 7 });
    const from = { node: tall, x: 100, y: 40, height: nodeHeight(tall) };
    const to = { node: flowNode({ sessionId: 'w' }), x: 100, y: 40 + nodeHeight(tall) + ROW_GAP, height: NODE_H };
    const pts = edgeRoute(from, to);
    expect(pts[0]).toEqual({ x: 100 + NODE_W / 2, y: from.y + from.height });
    expect(pts[pts.length - 1]).toEqual({ x: 100 + NODE_W / 2, y: to.y });
  });

  it('routes a back-edge out below the source\'s own height', () => {
    const from = { node: flowNode({ sessionId: 'w', job: blocker }), x: 100, y: 300, height: NODE_H + BLOCKER_H };
    const to = { node: flowNode({ sessionId: 'o' }), x: 100, y: 40, height: NODE_H };
    const pts = edgeRoute(from, to);
    expect(pts[0].y).toBe(from.y + from.height);
    expect(pts[1].y).toBe(from.y + from.height + 22);
  });
});
