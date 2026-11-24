import type { ExecutionWorkUnit, ExecutionWorkUnitInput } from './store.js';
import { splitChildRouting } from './routing-policy.js';

/**
 * Re-split on scope-widening blockers (plan step `scope-resplit`, AC6).
 *
 * `widensScope` is decided mechanically: an owner response widens a unit's scope when it names a file path outside
 * the unit's declared `files`. A response that only mentions a contract (API, schema, interface) without naming a
 * file cannot be decided mechanically and needs the owner to confirm (`undecidable`). The split creates a child
 * unit that owns only the added scope; the parent keeps its original scope, claim and history.
 */

export type ScopeVerdict = 'widens' | 'none' | 'undecidable';

export interface ScopeAssessment {
  verdict: ScopeVerdict;
  /** Worktree-relative paths the response names that lie outside the unit's declared scope. */
  addedFiles: string[];
  /** The response talks about a contract (API / schema / interface / endpoint). */
  contract: boolean;
  reason: string;
}

/** How many out-of-scope paths one split carries; more is a plan problem, not a blocker answer. */
export const MAX_SPLIT_FILES = 20;
const MAX_PATH_CHARS = 300;

const PATH_TOKEN = /(?:^|[\s"'`(\[,;:])((?:\.{1,2}\/)?[\w@.+-]+(?:\/[\w@.+\-[\]]+)+\/?|[\w@.+-]+\.(?:tsx?|jsx?|mjs|cjs|json|css|scss|md|py|go|rs|java|kt|ya?ml|sql|html|sh|toml|proto|graphql))(?=\.?(?:$|[\s"'`)\],;:?!]))/g;
const CONTRACT_WORDS = /\b(contract|api (?:change|shape|surface)|schema|interface|endpoint|protocol|type definitions?|wire format)\b/i;

/** Strip a trailing glob and normalize a declared scope entry to a plain prefix. */
function declaredPrefix(entry: string): { prefix: string; glob: RegExp | undefined } {
  const clean = entry.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (/[*?]/.test(clean)) {
    const source = clean.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0000/g, '.*');
    return { prefix: clean.split(/[*?]/)[0]!.replace(/\/[^/]*$/, ''), glob: new RegExp(`^${source}$`) };
  }
  return { prefix: clean, glob: undefined };
}

/** True when `path` equals a declared file or lies under a declared directory / glob. */
export function pathInScope(path: string, declared: readonly string[]): boolean {
  return declared.some((entry) => {
    const { prefix, glob } = declaredPrefix(entry);
    if (glob) return glob.test(path) || (prefix !== '' && path.startsWith(`${prefix}/`) && /\*\*$/.test(entry.trim()));
    return prefix === '' ? false : path === prefix || path.startsWith(`${prefix}/`);
  });
}

/** Paths a response names, normalized, de-duplicated and confined to relative non-traversing paths. */
export function extractNamedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_TOKEN)) {
    let candidate = (match[1] ?? '').replace(/^\.\//, '').replace(/\/+$/, '').replace(/[.,;:]+$/, '');
    if (!candidate || candidate.length > MAX_PATH_CHARS) continue;
    if (candidate.startsWith('/') || candidate.split('/').includes('..')) continue;
    // A bare word with a dot (`e.g`, `v1.2`) is not a file: require a known extension or a directory separator.
    if (!candidate.includes('/') && !/\.[A-Za-z0-9]{1,8}$/.test(candidate)) continue;
    if (/^\d+(?:\.\d+)+$/.test(candidate)) continue;
    found.add(candidate);
  }
  return [...found];
}

export function assessScopeWidening(unit: Pick<ExecutionWorkUnit, 'files' | 'readOnly'>, response: string): ScopeAssessment {
  const contract = CONTRACT_WORDS.test(response);
  if (unit.readOnly) return { verdict: 'none', addedFiles: [], contract, reason: 'read-only unit' };
  const declared = unit.files ?? [];
  // A unit with no declared scope has nothing to widen: it already owns the whole tree.
  if (declared.length === 0) return { verdict: 'none', addedFiles: [], contract, reason: 'unit declares no file scope' };
  const added = extractNamedPaths(response).filter((path) => !pathInScope(path, declared));
  if (added.length > MAX_SPLIT_FILES) {
    return { verdict: 'undecidable', addedFiles: [], contract, reason: `response names ${added.length} paths outside the unit's scope (more than ${MAX_SPLIT_FILES} is a plan change, not a split)` };
  }
  if (added.length > 0) {
    return { verdict: 'widens', addedFiles: added.slice(0, MAX_SPLIT_FILES), contract, reason: `response names ${added.length} path(s) outside the unit's scope` };
  }
  if (contract) {
    return { verdict: 'undecidable', addedFiles: [], contract, reason: 'response mentions a contract but names no file outside the unit\'s scope' };
  }
  return { verdict: 'none', addedFiles: [], contract, reason: 'response stays inside the unit\'s declared scope' };
}

/** Owner-facing prompt when widening cannot be decided mechanically. */
export function confirmSplitPrompt(unitId: string, assessment: ScopeAssessment): string {
  return `Scope check for unit ${unitId}: ${assessment.reason}. Nothing was sent. Re-send naming the files the new unit must own `
    + '(a response that names a file outside the unit\'s scope is split into a separate unit automatically), '
    + 'or re-send with scopeSplit "keep" to deliver the answer to this unit unchanged.';
}

/** Unique id for the child unit of `parentId`. */
export function splitChildId(units: readonly Pick<ExecutionWorkUnit, 'id'>[], parentId: string): string {
  const ids = new Set(units.map((unit) => unit.id));
  for (let n = 1; ; n += 1) {
    const candidate = `${parentId}-split-${n}`;
    if (!ids.has(candidate)) return candidate;
  }
}

/** The child unit input: added scope only, same upstream dependencies, routed by tier. */
export function buildSplitChild(parent: ExecutionWorkUnit, childId: string, assessment: ScopeAssessment, response: string): ExecutionWorkUnitInput {
  const routing = splitChildRouting(parent.routing, assessment.contract);
  return {
    id: childId,
    title: `${parent.title} (added scope)`.slice(0, 200),
    task: [
      `Scope added by the owner while answering a blocker on unit ${parent.id} ("${parent.title}").`,
      `Do only this added scope; unit ${parent.id} keeps its original scope.`,
      `Files: ${assessment.addedFiles.join(', ')}`,
      '',
      `Owner response:\n${response}`
    ].join('\n'),
    dependencies: [...parent.dependencies],
    files: [...assessment.addedFiles],
    ...(parent.verification?.length ? { verification: [...parent.verification] } : {}),
    ...(parent.preferredRole ? { preferredRole: parent.preferredRole } : {}),
    ...(routing ? { routing } : {})
  };
}

/** The worker-facing note appended to the delivered answer. */
export function splitDeliveryNote(parentId: string, childId: string, files: readonly string[]): string {
  return `\n\n[Zana scope split] ${files.join(', ')} now belong to unit ${childId}, which another worker will run. `
    + `Continue unit ${parentId} with its original scope only and do not edit those files.`;
}
