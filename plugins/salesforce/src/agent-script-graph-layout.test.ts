import { describe, expect, it } from 'vitest';
import { graphFromAgentSource } from '../lib/agent-script-model.js';
import {
  isPlaceholderAgentGraph,
  layoutAgentGraph
} from '../lib/agent-script-graph-layout.js';

describe('agent script graph layout', () => {
  it('drops the empty placeholder instead of drawing a fake node', () => {
    const empty = graphFromAgentSource('');
    expect(isPlaceholderAgentGraph(empty.nodes)).toBe(true);
    expect(layoutAgentGraph(empty.nodes)).toEqual([]);
  });

  it('stacks start above topics above actions, centered', () => {
    const graph = graphFromAgentSource(`
start_agent:
    after_reasoning:
        transition to @topic.identity_verification
        run @actions.verify_customer

topic identity_verification:
    description: "Verify"
`);
    const laid = layoutAgentGraph(graph.nodes);
    const start = laid.find((row) => row.kind === 'start');
    const topic = laid.find((row) => row.kind === 'topic');
    const action = laid.find((row) => row.kind === 'action');
    expect(start && topic && action).toBeTruthy();
    expect(start!.y).toBeLessThan(topic!.y);
    expect(topic!.y).toBeLessThan(action!.y);
  });
});
