/** A small, serializable projection of the official Agent Script AST. */
export interface ActionParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}
export interface ActionUse {
  line: number;
  kind: 'available' | 'run';
  code: string;
}
export interface AgentAction {
  id: string;
  name: string;
  owner: string;
  target: string;
  description: string;
  line: number;
  inputs: ActionParameter[];
  outputs: ActionParameter[];
  uses: ActionUse[];
}
export type ActionTarget = { kind: 'apex' | 'flow'; name: string; namespace: string | null; developerName: string };
export function parseActionTarget(target: string): ActionTarget | null {
  const match = /^(apex|flow):\/\/([A-Za-z][A-Za-z0-9_]{0,159}(?:\.[A-Za-z][A-Za-z0-9_]{0,159})?)$/.exec(target);
  if (!match) return null;
  const name = match[2];
  const parts = name.includes('.') ? name.split('.') : name.split('__');
  if (parts.length > 2 || parts.some(part => !part)) return null;
  return { kind: match[1] as ActionTarget['kind'], name, namespace: parts.length === 2 ? parts[0] : null, developerName: parts.at(-1)! };
}

type Ast = Record<string, any>;
function entries(value: any): Array<[string, Ast]> {
  return value && typeof value.entries === 'function' ? Array.from(value.entries()) : [];
}
function scalar(value: any): string {
  const raw = value?.value ?? value?.name ?? value;
  return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : '';
}
function lineOf(value: any, offset: number, declaration = false): number {
  const cst = value?.__cst;
  return Math.max(1, ((declaration ? cst?.node?.parent?.startRow : undefined) ?? cst?.range?.start?.line ?? offset) + 1 - offset);
}
function parameters(value: any): ActionParameter[] {
  return entries(value).slice(0, 250).map(([name, param]) => ({
    name, type: scalar(param.type) || 'unknown', description: scalar(param.properties?.description),
    required: scalar(param.properties?.is_required) === 'true'
  }));
}
function walk(value: any, visit: (node: Ast) => void, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (typeof value.entries === 'function') { for (const [, node] of entries(value)) walk(node, visit, seen); }
  else for (const [key, child] of Object.entries(value)) if (!key.startsWith('__')) walk(child, visit, seen);
}

/** Scope is part of identity; the same action name in two subagents is not merged. */
export function actionsFromAst(ast: any, source: string, annotationLines = 0): AgentAction[] {
  const lines = source.split('\n');
  const owners: Array<[string, Ast]> = [['agent', ast], ...['start_agent', 'subagent', 'topic'].flatMap(kind => entries(ast?.[kind]).map(([name, node]): [string, Ast] => [`${kind}.${name}`, node]))];
  const actions: AgentAction[] = owners.flatMap(([owner, node]) => entries(node?.actions).map(([name, action]) => ({
    id: `${owner}/actions/${name}`, name, owner, target: scalar(action.target), description: scalar(action.description),
    line: lineOf(action, annotationLines, true), inputs: parameters(action.inputs), outputs: parameters(action.outputs), uses: []
  })));
  for (const [owner, node] of owners) {
    const scoped = (name: string) => actions.find(a => a.owner === owner && a.name === name) ?? actions.find(a => a.owner === 'agent' && a.name === name);
    for (const section of [node?.reasoning?.instructions, node?.after_reasoning]) {
      walk(section, call => {
        if (call.__kind !== 'RunStatement' || call.target?.object?.name !== 'actions') return;
        const action = scoped(scalar(call.target.property));
        if (!action) return;
        const line = lineOf(call, annotationLines);
        const end = Math.max(line, (call.__cst?.range?.end?.line ?? line + annotationLines - 1) + 1 - annotationLines);
        action.uses.push({ kind: 'run', line, code: lines.slice(line - 1, end).join('\n').trim() });
      });
    }
    // The SDK retains a reasoning-action binding in the mapping CST header, not
    // on the AST block. Read only that AST-selected header (never scan the file).
    for (const [, binding] of entries(node?.reasoning?.actions)) {
      const line = lineOf(binding, annotationLines, true);
      const ref = /:\s*@actions\.([A-Za-z_][\w]*)\b/.exec(lines[line - 1] ?? '');
      const action = ref && scoped(ref[1]);
      if (!action) continue;
      const end = (binding.__cst?.range?.end?.line ?? line + annotationLines - 1) + 1 - annotationLines;
      action.uses.push({ kind: 'available', line, code: lines.slice(line - 1, Math.max(line, end)).join('\n').trim() });
    }
  }
  return actions.slice(0, 250).map(action => ({ ...action, uses: action.uses.slice(0, 1000) }));
}
