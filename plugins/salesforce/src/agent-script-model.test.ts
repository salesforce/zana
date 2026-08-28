import { describe, expect, it } from 'vitest';
import { AGENT_SCRIPT_EXAMPLES, graphFromAgentSource, isAgentScriptFile } from '../lib/agent-script-model.js';
import { normalizeAgentScriptDialect } from '../lib/types.js';

describe('agent script model', () => {
  it('recognizes agent file extensions', () => {
    expect(isAgentScriptFile('force-app/bots/MyBot.agent')).toBe(true);
    expect(isAgentScriptFile('x.afscript')).toBe(true);
    expect(isAgentScriptFile('README.md')).toBe(false);
  });

  it('builds a topic graph from transitions and actions', () => {
    const graph = graphFromAgentSource(`
start_agent:
    after_reasoning:
        transition to @topic.identity_verification
        run @actions.verify_customer

topic identity_verification:
    description: "Verify"
`);
    expect(graph.nodes.map((row) => row.id).sort()).toEqual([
      'action:verify_customer',
      'start',
      'topic:identity_verification'
    ]);
    expect(graph.edges.some((row) => row.target === 'topic:identity_verification')).toBe(true);
    expect(graph.edges.some((row) => row.target === 'action:verify_customer')).toBe(true);
  });

  it('ships examples with dialect annotations', () => {
    expect(AGENT_SCRIPT_EXAMPLES.length).toBeGreaterThan(0);
    expect(AGENT_SCRIPT_EXAMPLES[0]?.source).toContain('@dialect:');
    expect(AGENT_SCRIPT_EXAMPLES[0]?.source).toContain('start_agent:');
    expect(AGENT_SCRIPT_EXAMPLES.some((row) => row.dialect === 'agentfabric')).toBe(true);
    expect(normalizeAgentScriptDialect('agentscript')).toBe('agentscript');
    expect(normalizeAgentScriptDialect('nope')).toBe('agentforce');
  });

  it('returns a placeholder node when the source has no topics', () => {
    const graph = graphFromAgentSource('');
    expect(graph.nodes.some((row) => row.id === 'empty')).toBe(true);
  });
});
