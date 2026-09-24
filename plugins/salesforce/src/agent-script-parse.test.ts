import { describe, expect, it } from 'vitest';
import { parseAgentScriptSource } from '../lib/agent-script-parse.js';
import { AGENT_SCRIPT_EXAMPLES } from '../lib/agent-script-model.js';
import { queryAgentScriptLsp } from '../lib/agent-script-lsp.js';

describe('agent script parse', () => {
  it('ships examples that pass the actual language server without diagnostics', () => {
    for (const example of AGENT_SCRIPT_EXAMPLES) {
      const result = queryAgentScriptLsp({ source: example.source, dialect: example.dialect, query: 'diagnostics' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result.diagnostics, example.id).toEqual([]);
    }
  });
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
