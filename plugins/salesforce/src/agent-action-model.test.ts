import { describe, expect, it } from 'vitest';
import { parseAgentScriptSource } from '../lib/agent-script-parse.js';
import { actionsFromAst, parseActionTarget } from '../lib/agent-action-model.js';
import { ACTION_AGENT } from './action-fixtures.js';

describe('Agentforce action projection', () => {
  it('uses the official AST, retains scope, types, source lines, calls and mappings', () => {
    const parsed = parseAgentScriptSource(ACTION_AGENT, 'agentforce');
    const [apex, flow, duplicate] = parsed.actions;
    expect(parsed.actions).toHaveLength(3);
    expect(apex).toMatchObject({ id: 'start_agent.orders/actions/lookup', target: 'apex://OrderLookup', inputs: [{ name: 'orderId', type: 'string', required: true }], outputs: [{ name: 'status' }], uses: [{ kind: 'run', code: expect.stringContaining('set @variables.status = @outputs.status') }] });
    expect(ACTION_AGENT.split('\n')[apex.line - 1].trim()).toBe('lookup:');
    expect(ACTION_AGENT.split('\n')[apex.uses[0].line - 1].trim()).toBe('run @actions.lookup');
    expect(flow.uses).toEqual([expect.objectContaining({ kind: 'available', code: expect.stringContaining('with orderId = @variables.order_id') })]);
    expect(duplicate.id).toBe('subagent.returns/actions/lookup');
    expect(duplicate.uses).toEqual([]);
    const graphActions = parsed.graph.nodes.filter(n => n.kind === 'action');
    expect(new Set(graphActions.map(n => n.id)).size).toBe(3);
    expect(parsed.graph.edges.filter(e => e.label === 'declared')).toHaveLength(1);
    expect(parsed.graph.edges.some(e => e.label === 'available')).toBe(true);
    expect(parseAgentScriptSource('# @dialect:agentforce\n' + ACTION_AGENT, 'agentforce').actions[0].line).toBe(apex.line + 1);
  });
  it('ignores action-looking prose and comments; tolerates incomplete and empty drafts', () => {
    expect(parseAgentScriptSource('system:\n    instructions: |\n        run @actions.fake\n# target: "apex://Fake"\n', 'agentforce').actions).toEqual([]);
    expect(parseAgentScriptSource('start_agent route:\n    actions:\n        partial:\n', 'agentforce').actions[0]?.target ?? '').toBe('');
    expect(actionsFromAst({}, '')).toEqual([]);
    expect(actionsFromAst({ actions: new Map([['blank', {}]]) }, '')[0]).toMatchObject({ line: 1, target: '', inputs: [] });
  });
  it('handles shared actions, cycles in AST nodes and unresolved references', () => {
    const reference: any = { __kind: 'RunStatement', target: { object: { name: 'actions' }, property: 'shared' } };
    reference.cycle = reference;
    const actions = actionsFromAst({ actions: new Map([['shared', { target: { value: 'flow://Shared' } }]]), subagent: new Map([['s', { reasoning: { instructions: { statements: [reference, { __kind: 'RunStatement', target: { object: { name: 'actions' }, property: 'missing' } }] } } }]]) }, 'run @actions.shared');
    expect(actions[0].uses).toHaveLength(1);
  });
  it('validates concrete targets before paths or SOQL are constructed', () => {
    expect(parseActionTarget('apex://ns.Class')).toMatchObject({ namespace: 'ns', developerName: 'Class' });
    expect(parseActionTarget('flow://ns__Flow')).toMatchObject({ namespace: 'ns', developerName: 'Flow' });
    expect(parseActionTarget('flow://Flow')).toMatchObject({ namespace: null });
    for (const target of ['apex://../etc', 'flow://A\' OR Id != null', 'apex://a.b.c', 'apex://a__b__c', 'apex://a__', 'prompt://P', '']) expect(parseActionTarget(target)).toBeNull();
  });
});
