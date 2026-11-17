/**
 * Pure plan lint (no I/O): parallelism width, mixed contract-and-UI steps and mechanical contradictions,
 * reported as Check findings in the shared finding shape. Called from `buildPlanFindings`.
 */
import type { SquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';

/** The fields lint reads from a plan step (a structural subset of `ExecutionWorkUnitInput`). */
export interface LintUnit {
  id: string;
  dependencies: readonly string[];
  files?: readonly string[];
  readOnly?: boolean;
}

/** Above this many steps the width check is skipped (the matching is cubic in the worst case). */
const MAX_WIDTH_STEPS = 200;

/** Generic directory names, matched on whole path segments (two entries are consecutive segments). */
const UI_SEGMENTS = ['components', 'views', 'pages', 'ui', 'renderer', 'frontend', 'web', 'apps/app'];
const CONTRACT_SEGMENTS = ['server', 'api', 'domain', 'schema', 'contracts', 'ipc', 'packages'];

const warning = (detail: string, stepId?: string): SquadPlanFinding => ({
  ...(stepId ? { stepId } : {}), requirement: 'plan', severity: 'warning', candidateSlots: [], suggestion: '', detail
});

/**
 * Transitive dependencies of every step (id -> ids it waits for, directly or not).
 * Undefined for a cycle, a self-dependency or an unknown dependency id: the parser reports those itself.
 */
function dependencyClosure(units: readonly LintUnit[]): Map<string, Set<string>> | undefined {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const closure = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  let valid = true;
  const visit = (id: string): Set<string> => {
    const known = closure.get(id);
    if (known) return known;
    const all = new Set<string>();
    if (visiting.has(id)) { valid = false; return all; }
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      if (!byId.has(dep)) { valid = false; continue; }
      all.add(dep);
      for (const inherited of visit(dep)) all.add(inherited);
    }
    visiting.delete(id);
    closure.set(id, all);
    return all;
  };
  for (const unit of units) visit(unit.id);
  return valid && byId.size === units.length ? closure : undefined;
}

/** Largest set of steps with no dependency path between any two (Dilworth: steps minus a maximum matching). */
export function planParallelWidth(units: readonly LintUnit[]): number | undefined {
  if (units.length > MAX_WIDTH_STEPS) return undefined;
  const closure = dependencyClosure(units);
  if (!closure) return undefined;
  const ids = units.map((unit) => unit.id);
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

const segmentsOf = (path: string): string[] => path.toLowerCase().split(/[\\/]+/).filter(Boolean);

function touches(directories: readonly string[], names: readonly string[]): boolean {
  const joined = `/${directories.join('/')}/`;
  return names.some((name) => joined.includes(`/${name}/`));
}

function mixesContractAndUi(files: readonly string[]): boolean {
  let ui = false;
  let contract = false;
  for (const file of files) {
    const directories = segmentsOf(file).slice(0, -1);
    ui ||= touches(directories, UI_SEGMENTS);
    contract ||= touches(directories, CONTRACT_SEGMENTS);
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

/** One finding per pair of steps that can run at the same time and write the same path. */
function overlapFindings(units: readonly LintUnit[]): SquadPlanFinding[] {
  const closure = dependencyClosure(units);
  if (!closure) return [];
  const out: SquadPlanFinding[] = [];
  units.forEach((first, index) => {
    for (const second of units.slice(index + 1)) {
      if (closure.get(first.id)?.has(second.id) || closure.get(second.id)?.has(first.id)) continue;
      const theirs = new Set(second.files ?? []);
      const shared = [...new Set(first.files ?? [])].filter((file) => theirs.has(file));
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
  const width = input.workerCount && input.units.length ? planParallelWidth(input.units) : undefined;
  if (width !== undefined && input.workerCount && width < input.workerCount) {
    out.push(warning(`Only ${width} ${width === 1 ? 'step' : 'steps'} can run at the same time, but this Squad has ${input.workerCount} workers. The others will wait.`));
  }
  for (const unit of input.units) out.push(...stepFindings(unit));
  out.push(...overlapFindings(input.units));
  return out;
}

/** For each step, the ids of the steps that will not run if it fails (transitive, in plan order). */
export function skipImpact(units: readonly LintUnit[]): Map<string, string[]> {
  void units;
  throw new Error('not implemented: skipImpact');
}
