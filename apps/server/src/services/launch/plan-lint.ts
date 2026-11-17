/**
 * Pure plan lint (no I/O): parallelism width, mixed contract-and-UI steps and mechanical contradictions,
 * reported as Check findings in the shared finding shape. Called from `buildPlanFindings`.
 */
import { posix } from 'node:path';
import type { SquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';

/** The fields lint reads from a plan step (a structural subset of `ExecutionWorkUnitInput`). */
export interface LintUnit {
  id: string;
  dependencies: readonly string[];
  files?: readonly string[];
  readOnly?: boolean;
  /** A loop review: failing it also skips the dependents of its fix unit. */
  loop?: { fixUnitId: string };
  /** The step's failure policy, when it has one (changes the wording of the skip line only). */
  onFailure?: { kind: string };
}

/** Above this many steps width, overlap and skip impact are skipped (closure and matching grow at least quadratically). */
const MAX_LINT_STEPS = 200;

/** Generic directory names, matched on whole path segments (two entries are consecutive segments). */
const UI_SEGMENTS = ['components', 'views', 'pages', 'ui', 'renderer', 'frontend', 'web', 'apps/app'];
const CONTRACT_SEGMENTS = ['server', 'api', 'domain', 'schema', 'contracts', 'ipc', 'packages'];

const warning = (detail: string, stepId?: string): SquadPlanFinding => ({
  ...(stepId ? { stepId } : {}), requirement: 'plan', severity: 'warning', candidateSlots: [], suggestion: '', detail
});

/**
 * Transitive dependencies of every step (id -> ids it waits for, directly or not), built iteratively in
 * dependency order so a long chain cannot overflow the stack. Undefined for a cycle, a duplicate id or an
 * unknown dependency id: the parser reports those itself.
 */
function dependencyClosure(units: readonly LintUnit[]): Map<string, Set<string>> | undefined {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  if (byId.size !== units.length) return undefined;
  const waiting = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const unit of units) {
    waiting.set(unit.id, unit.dependencies.length);
    for (const dep of unit.dependencies) {
      if (!byId.has(dep)) return undefined;
      const list = dependents.get(dep);
      if (list) list.push(unit.id); else dependents.set(dep, [unit.id]);
    }
  }
  const closure = new Map<string, Set<string>>();
  const ready = units.filter((unit) => !unit.dependencies.length).map((unit) => unit.id);
  for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
    const all = new Set<string>();
    for (const dep of byId.get(id)?.dependencies ?? []) {
      all.add(dep);
      for (const inherited of closure.get(dep) ?? []) all.add(inherited);
    }
    closure.set(id, all);
    for (const next of dependents.get(id) ?? []) {
      const left = (waiting.get(next) ?? 0) - 1;
      waiting.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  return closure.size === units.length ? closure : undefined;
}

type Closure = Map<string, Set<string>>;

/** Largest set of steps with no dependency path between any two (Dilworth: steps minus a maximum matching). */
function widthFromClosure(ids: readonly string[], closure: Closure): number {
  const matchedTo = new Map<string, string>(); // later step -> the earlier step matched to it
  const augment = (id: string, seen: Set<string>): boolean => {
    for (const next of ids) {
      if (!closure.get(next)?.has(id) || seen.has(next)) continue;
      seen.add(next);
      const holder = matchedTo.get(next);
      if (holder === undefined || augment(holder, seen)) { matchedTo.set(next, id); return true; }
    }
    return false;
  };
  let matching = 0;
  for (const id of ids) if (augment(id, new Set())) matching += 1;
  return ids.length - matching;
}

/** The dependency closure, or undefined above the step cap or for a plan the parser already rejects. */
function boundedClosure(units: readonly LintUnit[]): Closure | undefined {
  return units.length > MAX_LINT_STEPS ? undefined : dependencyClosure(units);
}

export function planParallelWidth(units: readonly LintUnit[]): number | undefined {
  const closure = boundedClosure(units);
  return closure ? widthFromClosure(units.map((unit) => unit.id), closure) : undefined;
}

const segmentsOf = (path: string): string[] => path.toLowerCase().split(/[\\/]+/).filter(Boolean);

function touches(directories: readonly string[], names: readonly string[]): boolean {
  const joined = `/${directories.join('/')}/`;
  return names.some((name) => joined.includes(`/${name}/`));
}

/** A file on a UI path is a UI file even when it also sits under a contract name (packages/ui/Button.tsx). */
function mixesContractAndUi(files: readonly string[]): boolean {
  let ui = false;
  let contract = false;
  for (const file of files) {
    const directories = segmentsOf(file).slice(0, -1);
    if (touches(directories, UI_SEGMENTS)) ui = true;
    else if (touches(directories, CONTRACT_SEGMENTS)) contract = true;
  }
  return ui && contract;
}

function stepFindings(unit: LintUnit): SquadPlanFinding[] {
  const out: SquadPlanFinding[] = [];
  const files = unit.files ?? [];
  if (mixesContractAndUi(files)) {
    out.push(warning(`Step ${unit.id} changes both a server contract and the screen that uses it. Split it so the contract lands first.`, unit.id));
  }
  if (unit.readOnly && files.length) {
    out.push(warning(`Step ${unit.id} is marked read-only but lists a Write scope (${files.join(', ')}). Remove the Write scope or make the step able to write.`, unit.id));
  }
  return out;
}

const normalisePath = (file: string): string => posix.normalize(file.replace(/\\/g, '/')).replace(/^(\.\/)+/, '').replace(/\/+$/, '');

/** One finding per pair of steps that can run at the same time and write the same path. */
function overlapFindings(units: readonly LintUnit[], closure: Closure): SquadPlanFinding[] {
  const out: SquadPlanFinding[] = [];
  const written = units.map((unit) => new Set((unit.files ?? []).map(normalisePath)));
  units.forEach((first, index) => {
    for (let other = index + 1; other < units.length; other += 1) {
      const second = units[other];
      if (closure.get(first.id)?.has(second.id) || closure.get(second.id)?.has(first.id)) continue;
      const shared = [...written[index]].filter((file) => written[other].has(file));
      if (shared.length) {
        out.push(warning(`Steps ${first.id} and ${second.id} can run at the same time but both write ${shared.join(', ')}. Make one wait for the other.`));
      }
    }
  });
  return out;
}

/** Check findings for a plan; `workerCount` is undefined when no Squad judges the plan. */
export function lintPlan(input: { units: readonly LintUnit[]; workerCount: number | undefined }): SquadPlanFinding[] {
  const out: SquadPlanFinding[] = [];
  const closure = boundedClosure(input.units);
  const width = closure && input.workerCount && input.units.length ? widthFromClosure(input.units.map((unit) => unit.id), closure) : undefined;
  if (width !== undefined && input.workerCount && width < input.workerCount) {
    out.push(warning(`Only ${width} ${width === 1 ? 'step' : 'steps'} can run at the same time, but this Squad has ${input.workerCount} workers. The others will wait.`));
  }
  for (const unit of input.units) out.push(...stepFindings(unit));
  if (closure) out.push(...overlapFindings(input.units, closure));
  return out;
}

/**
 * For each step, the ids of the steps that will not run if it fails (transitive, in plan order). Mirrors the
 * engine: a pending step is skipped when a dependency failed or was skipped, and also when its dependency is the
 * fix unit of a loop review that failed or was skipped, so failing a review reaches the fix unit's dependents.
 * Empty above the step cap.
 */
export function skipImpact(units: readonly LintUnit[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (units.length > MAX_LINT_STEPS) return out;
  const direct = new Map<string, string[]>();
  for (const unit of units) {
    for (const dep of unit.dependencies) {
      const list = direct.get(dep);
      if (list) list.push(unit.id); else direct.set(dep, [unit.id]);
    }
  }
  const next = (id: string, loopFix: string | undefined): readonly string[] =>
    loopFix === undefined ? direct.get(id) ?? [] : [...(direct.get(id) ?? []), ...(direct.get(loopFix) ?? [])];
  const loopFixOf = new Map(units.filter((unit) => unit.loop).map((unit) => [unit.id, unit.loop?.fixUnitId]));
  const order = new Map(units.map((unit, index) => [unit.id, index]));
  for (const unit of units) {
    const reached = new Set<string>();
    const queue = [unit.id];
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      for (const dependent of next(id, loopFixOf.get(id))) {
        if (dependent === unit.id || reached.has(dependent)) continue;
        reached.add(dependent);
        queue.push(dependent);
      }
    }
    if (reached.size) out.set(unit.id, [...reached].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }
  return out;
}
