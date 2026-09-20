import type { ActionParameter } from '../../lib/agent-action-model.js';

export interface FlowNode { id: string; label: string; kind: string; target?: string; detail: Record<string, unknown> }
export interface FlowEdge { from: string; to: string; label: string; fault: boolean }
export interface FlowModel { nodes: FlowNode[]; edges: FlowEdge[]; inputs: ActionParameter[]; outputs: ActionParameter[]; truncated: boolean }
const NODE_TYPES: Record<string, string> = { start: 'Start', decisions: 'Decision', recordLookups: 'Get records', recordCreates: 'Create records', recordUpdates: 'Update records', recordDeletes: 'Delete records', assignments: 'Assignment', loops: 'Loop', subflows: 'Subflow', actionCalls: 'Action', screens: 'Screen', waits: 'Wait', collectionProcessors: 'Collection', transforms: 'Transform' };
function list(value: unknown): any[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function rec(value: any): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

/** DOMParser is inert; reject DTDs and malformed XML before projecting metadata. */
export function flowFromXml(content: string): Record<string, unknown> {
  if (content.length > 750_000 || /<!DOCTYPE|<!ENTITY/i.test(content)) throw Error('This Flow XML cannot be previewed safely.');
  const document = new DOMParser().parseFromString(content, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'Flow') throw Error('The source is not valid Salesforce Flow XML.');
  const convert = (element: Element, depth: number): unknown => {
    if (depth > 40) throw Error('This Flow XML is nested too deeply to preview.');
    if (!element.children.length) return element.textContent ?? '';
    const result: Record<string, unknown> = {};
    for (const child of element.children) {
      const name = child.localName;
      if (['__proto__', 'constructor', 'prototype'].includes(name)) continue;
      const value = convert(child, depth + 1);
      result[name] = name in result ? [...list(result[name]), value] : value;
    }
    return result;
  };
  return convert(document.documentElement, 0) as Record<string, unknown>;
}

export function flowModel(metadata: Record<string, unknown>): FlowModel {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const addEdge = (from: string, connector: any, label: string, fault = false) => {
    if (typeof connector?.targetReference === 'string') edges.push({ from, to: connector.targetReference, label, fault });
  };
  for (const [key, value] of Object.entries(metadata)) {
    for (const item of list(value).map(rec)) {
      if (!NODE_TYPES[key] && !(item.name && ('locationX' in item || 'connector' in item || 'faultConnector' in item))) continue;
      const id = key === 'start' ? '$start' : item.name;
      if (typeof id !== 'string') continue;
      const target = key === 'subflows' && typeof item.flowName === 'string' ? `flow://${item.flowName}` : key === 'actionCalls' && item.actionType === 'apex' && typeof item.actionName === 'string' ? `apex://${item.actionName}` : undefined;
      nodes.push({ id, kind: NODE_TYPES[key] ?? key, label: typeof item.label === 'string' ? item.label : key === 'start' ? 'Start' : id, target, detail: item });
      addEdge(id, item.connector, 'Next');
      addEdge(id, item.faultConnector, 'Fault', true);
      addEdge(id, item.defaultConnector, item.defaultConnectorLabel || 'Default');
      addEdge(id, item.nextValueConnector, 'For each');
      addEdge(id, item.noMoreValuesConnector, 'After last');
      for (const rule of list(item.rules)) addEdge(id, rule?.connector, rule?.label || rule?.name || 'Rule');
    }
  }
  if (metadata.startElementReference && !nodes.some(node => node.id === '$start')) {
    nodes.unshift({ id: '$start', label: 'Start', kind: 'Start', detail: {} });
    addEdge('$start', { targetReference: metadata.startElementReference }, 'Next');
  }
  const variables = list(metadata.variables).map(rec);
  const params = (flag: string): ActionParameter[] => variables.filter(v => v[flag] === true || v[flag] === 'true').slice(0, 250).map(v => ({ name: String(v.name ?? ''), type: `${v.dataType || 'unknown'}${v.isCollection === true || v.isCollection === 'true' ? '[]' : ''}`, description: String(v.description ?? ''), required: false }));
  return { nodes: nodes.slice(0, 120), edges: edges.slice(0, 300), inputs: params('isInput'), outputs: params('isOutput'), truncated: nodes.length > 120 || edges.length > 300 };
}

/** Breadth-first levels keep cycles bounded and branches side by side. */
export function flowPositions(model: FlowModel): Map<string, { x: number; y: number }> {
  const levels = new Map<string, number>();
  const known = new Set(model.nodes.map(n => n.id));
  const roots = model.nodes.filter(n => n.id === '$start' || !model.edges.some(e => e.to === n.id)).map(n => n.id);
  const queue = roots.length ? roots : model.nodes.slice(0, 1).map(n => n.id);
  queue.forEach(id => levels.set(id, 0));
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const edge of model.edges.filter(e => e.from === from)) {
      if (known.has(edge.to) && !levels.has(edge.to)) { levels.set(edge.to, levels.get(from)! + 1); queue.push(edge.to); }
    }
  }
  const widths = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  let last = Math.max(0, ...levels.values());
  for (const node of model.nodes) {
    const level = levels.get(node.id) ?? ++last;
    const col = widths.get(level) ?? 0;
    widths.set(level, col + 1);
    positions.set(node.id, { x: 30 + col * 250, y: 25 + level * 126 });
  }
  return positions;
}
