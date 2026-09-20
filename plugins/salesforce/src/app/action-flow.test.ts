/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import { flowFromXml, flowModel, flowPositions } from './action-flow.js';
import { ACTION_FLOW, ACTION_FLOW_XML } from '../action-fixtures.js';

describe('Flow implementation model', () => {
  it('projects XML and Tooling metadata into the same branches, faults, dependencies and variables', () => {
    const local = flowModel(flowFromXml(ACTION_FLOW_XML));
    const remote = flowModel(ACTION_FLOW);
    expect({ ...local, nodes: local.nodes.map(({ detail, ...node }) => node) }).toEqual({ ...remote, nodes: remote.nodes.map(({ detail, ...node }) => node) });
    expect(local.edges).toContainEqual({ from: 'FindOrder', to: 'LogError', label: 'Fault', fault: true });
    expect(local.edges).toContainEqual({ from: 'Eligible', to: 'Decline', label: 'Outside return window', fault: false });
    expect(local.nodes.find(n => n.id === 'LogError')?.target).toBe('apex://OrderLookup');
    expect(local.nodes.find(n => n.id === 'CreateReturn')?.target).toBe('flow://CreateReturn');
    expect(local.inputs).toMatchObject([{ name: 'orderId', type: 'String' }]);
    expect(local.outputs).toMatchObject([{ name: 'eligible', type: 'Boolean' }]);
    expect(flowPositions(local).size).toBe(6);
  });
  it('retains unfamiliar nodes and bounded loops without inventing execution order', () => {
    const model = flowModel({ startElementReference: 'Loop', loops: { name: 'Loop', nextValueConnector: { targetReference: 'Future' }, noMoreValuesConnector: { targetReference: 'End' } }, futureNodes: { name: 'Future', locationX: 10, connector: { targetReference: 'Loop' } }, assignments: [{ name: 'End' }, { name: 'Disconnected' }], variables: [{ name: 'list', dataType: 'String', isInput: 'true', isCollection: 'true' }] });
    expect(model.nodes.find(n => n.id === 'Future')?.kind).toBe('futureNodes');
    expect(model.edges.map(e => e.label)).toContain('For each');
    expect(model.inputs[0].type).toBe('String[]');
    expect(flowPositions(model).size).toBe(5);
    expect(flowPositions({ ...model, nodes: model.nodes.filter(n => ['Loop', 'Future'].includes(n.id)) }).size).toBe(2);
    expect(flowModel({ assignments: Array.from({ length: 130 }, (_, i) => ({ name: 'a' + i })) }).truncated).toBe(true);
    expect(flowModel({})).toEqual({ nodes: [], edges: [], inputs: [], outputs: [], truncated: false });
  });
  it('refuses malformed, oversized, DTD and deeply nested XML', () => {
    for (const xml of ['<x/>', '<Flow>', '<!DOCTYPE Flow><Flow/>', '<!ENTITY x "secret"><Flow/>', 'x'.repeat(750001), '<Flow>' + '<x>'.repeat(45) + '</x>'.repeat(45) + '</Flow>']) expect(() => flowFromXml(xml)).toThrow();
    expect(flowFromXml('<Flow><__proto__>bad</__proto__><label>Good</label></Flow>')).toEqual({ label: 'Good' });
  });
});
