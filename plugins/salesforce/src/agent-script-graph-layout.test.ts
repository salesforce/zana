import { describe, expect, it } from 'vitest';
import { AGENT_GRAPH_COLUMN_WIDTH, AGENT_GRAPH_NODE_HEIGHT, isPlaceholderAgentGraph, layoutAgentGraph, resolveFocusNode } from '../lib/agent-script-graph-layout.js';
import type { AgentGraphEdge, AgentGraphNode } from '../lib/agent-script-model.js';

const nodes: AgentGraphNode[] = [
  { id: 'act', label: 'Lookup', kind: 'action' }, { id: 't1', label: 'Billing', kind: 'topic' },
  { id: 't2', label: 'Refunds', kind: 'topic' }, { id: 'start', label: 'start_agent', kind: 'start' }
] as AgentGraphNode[];

describe('graph layout', () => {
  it('lays out by rank and as a single column when compact', () => {
    const wide = layoutAgentGraph(nodes);
    expect(new Set(wide.map(n => n.y)).size).toBe(3);
    const col = layoutAgentGraph(nodes, { compact: true });
    expect(col.map(n => n.id)).toEqual(['start', 't1', 't2', 'act']);
    expect(new Set(col.map(n => n.x)).size).toBe(1);
    expect(col[1]!.y - col[0]!.y).toBeGreaterThan(AGENT_GRAPH_NODE_HEIGHT);
    expect(layoutAgentGraph([], { compact: true })).toEqual([]);
    expect(isPlaceholderAgentGraph([{ id: 'empty', label: '', kind: 'start' } as AgentGraphNode])).toBe(true);
  });
  it('lays start, topics and actions out as left-to-right columns with topics level with their actions', () => {
    const many: AgentGraphNode[] = [
      { id: 'start', label: 'start_agent', kind: 'start' }, { id: 't1', label: 'A', kind: 'topic' }, { id: 't2', label: 'B', kind: 'topic' }, { id: 't3', label: 'C', kind: 'topic' },
      { id: 'a1', label: 'x', kind: 'action' }, { id: 'a2', label: 'y', kind: 'action' }, { id: 'a3', label: 'z', kind: 'action' }, { id: 'a4', label: 'w', kind: 'action' }
    ];
    const edges: AgentGraphEdge[] = [
      { id: 'e0', source: 'start', target: 't1' }, { id: 'e1', source: 't2', target: 'a3' }, { id: 'e2', source: 't1', target: 'a1' },
      { id: 'e3', source: 't1', target: 'a2' }, { id: 'e4', source: 't2', target: 'a1' }, { id: 'e5', source: 't1', target: 't2' }
    ];
    const laid = new Map(layoutAgentGraph(many, {}, edges).map(n => [n.id, n]));
    const at = (id: string) => laid.get(id)!;
    expect(at('start').x).toBe(0);
    expect(at('t1').x).toBeGreaterThan(at('start').x + AGENT_GRAPH_COLUMN_WIDTH.start);
    expect(at('a1').x).toBeGreaterThan(at('t1').x + AGENT_GRAPH_COLUMN_WIDTH.topic);
    expect(at('a1').width).toBe(AGENT_GRAPH_COLUMN_WIDTH.action);
    // Actions follow their first owner: t1's block (a1, a2), then t2's (a3), then the orphan.
    expect(['a1', 'a2', 'a3', 'a4'].map(id => at(id).y)).toEqual([...[0, 1, 2, 3].map(i => i * (AGENT_GRAPH_NODE_HEIGHT + 18))]);
    expect(at('t1').y).toBe((at('a1').y + at('a2').y) / 2);
    // t2 wants the middle of a3 and a1 but is pushed below t1; t3 has no actions and stacks under t2.
    expect(at('t2').y).toBe(Math.max((at('a3').y + at('a1').y) / 2, at('t1').y + AGENT_GRAPH_NODE_HEIGHT + 30));
    expect(at('t3').y).toBe(at('t2').y + AGENT_GRAPH_NODE_HEIGHT + 30);
    expect(at('start').y).toBe((at('t1').y + at('t3').y) / 2);
  });
  it('places start alone at the origin when there are no topics', () => {
    expect(layoutAgentGraph([{ id: 's', label: 'start_agent', kind: 'start' }, { id: 'a', label: 'a', kind: 'action' }], {}, [{ id: 'e', source: 's', target: 'a' }]).map(n => [n.id, n.y])).toEqual([['s', 0], ['a', 0]]);
  });
  it('resolves focus by id, label, then case-insensitive label', () => {
    expect(resolveFocusNode(nodes, 't2')?.id).toBe('t2');
    expect(resolveFocusNode(nodes, 'Billing')?.id).toBe('t1');
    expect(resolveFocusNode(nodes, ' refunds ')?.id).toBe('t2');
    expect(resolveFocusNode(nodes, 'nope')).toBeNull();
    expect(resolveFocusNode(nodes, null)).toBeNull();
  });
});
