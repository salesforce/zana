import { describe, expect, it } from 'vitest';
import { AGENT_SCRIPT_EXAMPLES } from '../lib/agent-script-model.js';
import {
  isAgentScriptLspQuery,
  lspDialect,
  queryAgentScriptLsp
} from '../lib/agent-script-lsp.js';

describe('agent script LSP', () => {
  it.each(['', '# @dialect:agentforce\n', '# saved agent\n# @dialect:agentforce\n'])('keeps diagnostics, nested symbols and definition coordinates in the original source (%j)', annotation => {
    const source = `${annotation}config:\n    agent_name: "Test"\nvariables:\n    activeTopic: mutable string = ""\nstart_agent router:\n    reasoning:\n        instructions: ->\n            set @variables.activeTopic = "Support"\n            | Help the user.\n`;
    const lines = source.split('\n');
    const declaration = lines.findIndex(line => line.includes('activeTopic:'));
    const reference = lines.findIndex(line => line.includes('@variables'));
    const query = (query: 'definition' | 'symbols' | 'diagnostics' | 'hover' | 'complete', line = reference, column = 28) => {
      const result = queryAgentScriptLsp({ source, dialect: 'agentforce', query, line, column });
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.error);
      return result.result;
    };
    expect(query('definition').definition).toEqual({ start: { line: declaration, column: 4 }, end: { line: declaration, column: 15 } });
    expect(query('symbols').symbols?.find(symbol => symbol.name === 'activeTopic')?.range.start).toEqual({ line: declaration, column: 4 });
    expect(query('diagnostics').diagnostics.find(d => d.code === 'missing-required-field')).toMatchObject({ line: lines.findIndex(line => line.startsWith('start_agent')), column: 0 });
    expect(query('complete').completions?.some(c => c.label === 'activeTopic')).toBe(true);
    const hover = query('hover', lines.findIndex(line => line.startsWith('config:')), 2);
    expect(hover.hover).toBeTruthy();
    if (hover.range) expect(hover.range.start.line).toBe(lines.findIndex(line => line.startsWith('config:')));
  });
  it('maps agentfabric to the agentforce dialect the language service ships', () => {
    expect(lspDialect('agentfabric')).toBe('agentforce');
    expect(lspDialect('agentscript')).toBe('agentscript');
    expect(isAgentScriptLspQuery('hover')).toBe(true);
    expect(isAgentScriptLspQuery('rename')).toBe(false);
  });

  it('returns diagnostics and symbols for the support-bot example', () => {
    const example = AGENT_SCRIPT_EXAMPLES[0]!;
    const diagnostics = queryAgentScriptLsp({
      source: example.source,
      dialect: example.dialect,
      query: 'diagnostics'
    });
    expect(diagnostics.ok).toBe(true);
    if (!diagnostics.ok) return;
    expect(diagnostics.result.query).toBe('diagnostics');
    expect(Array.isArray(diagnostics.result.diagnostics)).toBe(true);

    const symbols = queryAgentScriptLsp({
      source: example.source,
      dialect: example.dialect,
      query: 'symbols'
    });
    expect(symbols.ok).toBe(true);
    if (!symbols.ok) return;
    expect((symbols.result.symbols ?? []).some((row) => /config|start_agent|topic|billing/i.test(row.name))).toBe(
      true
    );
  });

  it('completes after config and hovers a keyword', () => {
    const source = `# @dialect:agentforce
config:
    
`;
    const complete = queryAgentScriptLsp({
      source,
      dialect: 'agentforce',
      query: 'complete',
      line: 2,
      column: 4
    });
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect((complete.result.completions ?? []).length).toBeGreaterThan(0);

    const hover = queryAgentScriptLsp({
      source: AGENT_SCRIPT_EXAMPLES[0]!.source,
      dialect: 'agentforce',
      query: 'hover',
      line: 1,
      column: 0
    });
    expect(hover.ok).toBe(true);
    if (!hover.ok) return;
    expect(typeof hover.result.hover === 'string' || hover.result.hover === undefined).toBe(true);
  });

  it('requires a position for hover and rejects unknown queries', () => {
    expect(
      queryAgentScriptLsp({ source: 'config:\n', dialect: 'agentforce', query: 'hover' }).ok
    ).toBe(false);
    expect(
      queryAgentScriptLsp({
        source: 'config:\n',
        dialect: 'agentforce',
        query: 'nope' as 'diagnostics'
      }).ok
    ).toBe(false);
  });

  it('returns diagnostics for malformed source without throwing', () => {
    const result = queryAgentScriptLsp({
      source: 'topic ???:\n',
      dialect: 'agentforce',
      query: 'diagnostics'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.diagnostics.length > 0 || result.result.hasErrors).toBe(true);
  });
});
