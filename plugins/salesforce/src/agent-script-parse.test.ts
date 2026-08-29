import { describe, expect, it } from 'vitest';
import { parseAgentScriptSource } from '../lib/agent-script-parse.js';
import { AGENT_SCRIPT_EXAMPLES } from '../lib/agent-script-model.js';

describe('agent script parse', () => {
  it('parses the support-bot example without throwing', () => {
    const example = AGENT_SCRIPT_EXAMPLES[0]!;
    const result = parseAgentScriptSource(example.source, example.dialect);
    expect(result.dialect).toBe('agentforce');
    expect(result.graph.nodes.some((row) => row.kind === 'start' || row.kind === 'topic')).toBe(true);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('returns diagnostics for malformed source', () => {
    const result = parseAgentScriptSource('topic ???:\n', 'agentforce');
    expect(result.diagnostics.length > 0 || result.hasErrors).toBe(true);
  });

  it('parses an empty file without throwing', () => {
    const result = parseAgentScriptSource('', 'agentforce');
    expect(result.dialect).toBe('agentforce');
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});
