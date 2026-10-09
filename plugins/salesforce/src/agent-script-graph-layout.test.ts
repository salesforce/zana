import { describe, expect, it } from 'vitest';
import { AGENT_GRAPH_NODE_HEIGHT, isPlaceholderAgentGraph, layoutAgentGraph, resolveFocusNode } from '../lib/agent-script-graph-layout.js';
import type { AgentGraphNode } from '../lib/agent-script-model.js';

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
  it('resolves focus by id, label, then case-insensitive label', () => {
    expect(resolveFocusNode(nodes, 't2')?.id).toBe('t2');
    expect(resolveFocusNode(nodes, 'Billing')?.id).toBe('t1');
    expect(resolveFocusNode(nodes, ' refunds ')?.id).toBe('t2');
    expect(resolveFocusNode(nodes, 'nope')).toBeNull();
    expect(resolveFocusNode(nodes, null)).toBeNull();
  });
});
