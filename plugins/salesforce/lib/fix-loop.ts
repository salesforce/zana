/**
 * "Make these pass": a bounded hand-off to the thread agent. The Studio starts
 * a loop for some failing cases; the agent spends at most `budget` Simulate
 * runs on candidate sources of one file, then proposes its best one. Loops
 * live in memory, a few per plugin, and lapse after a while without a run.
 */
export const FIX_LOOP_LIMITS = { loops: 8, budget: 3, maxBudget: 5, idleMs: 30 * 60_000, cases: 20 } as const;

export type FixLoopStatus = 'running' | 'passed' | 'exhausted' | 'stopped' | 'expired';
export interface FixLoopAttempt { n: number; pass: number; total: number; at: number; failing: string[] }
export interface FixLoop {
  id: string;
  projectId: string;
  agentPath: string;
  suitePath: string;
  caseIds: string[];
  budget: number;
  attempts: FixLoopAttempt[];
  status: FixLoopStatus;
  startedAt: number;
  updatedAt: number;
}

export class FixLoopError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export class FixLoops {
  private readonly loops = new Map<string, FixLoop>();

  constructor(private readonly o: { now(): number; id(): string }) {}

  private expire(): void {
    const at = this.o.now();
    for (const loop of this.loops.values()) {
      if (loop.status === 'running' && at - loop.updatedAt >= FIX_LOOP_LIMITS.idleMs) Object.assign(loop, { status: 'expired', updatedAt: at });
    }
  }

  /** Starts a loop for one file; a running loop on the same file is stopped first. */
  start(input: { projectId: string; agentPath: string; suitePath: string; caseIds: string[]; budget?: number }): FixLoop {
    this.expire();
    const caseIds = [...new Set(input.caseIds.filter(id => typeof id === 'string' && id))].slice(0, FIX_LOOP_LIMITS.cases);
    if (!caseIds.length) throw new FixLoopError('invalid_input', 'Pick at least one failing case.');
    const budget = Math.min(Math.max(1, Math.floor(input.budget ?? FIX_LOOP_LIMITS.budget)), FIX_LOOP_LIMITS.maxBudget);
    const at = this.o.now();
    for (const loop of this.loops.values()) {
      if (loop.projectId === input.projectId && loop.agentPath === input.agentPath && loop.status === 'running') Object.assign(loop, { status: 'stopped', updatedAt: at });
    }
    const loop: FixLoop = { id: this.o.id(), projectId: input.projectId, agentPath: input.agentPath, suitePath: input.suitePath, caseIds, budget, attempts: [], status: 'running', startedAt: at, updatedAt: at };
    this.loops.set(loop.id, loop);
    while (this.loops.size > FIX_LOOP_LIMITS.loops) this.loops.delete(this.loops.keys().next().value!);
    return loop;
  }

  get(projectId: string, id: string): FixLoop | null {
    this.expire();
    const loop = this.loops.get(id);
    return loop && loop.projectId === projectId ? loop : null;
  }

  /** The newest loop for a file, so the Studio can show it after a reload. */
  latest(projectId: string, agentPath: string): FixLoop | null {
    this.expire();
    let found: FixLoop | null = null;
    for (const loop of this.loops.values()) if (loop.projectId === projectId && loop.agentPath === agentPath) found = loop;
    return found;
  }

  stop(projectId: string, id: string): FixLoop | null {
    const loop = this.get(projectId, id);
    if (loop?.status === 'running') Object.assign(loop, { status: 'stopped', updatedAt: this.o.now() });
    return loop;
  }

  /** Checks a run may spend one attempt: the loop runs, the file matches, budget remains. */
  claim(projectId: string, id: string, agentPath: string): FixLoop {
    const loop = this.get(projectId, id);
    if (!loop) throw new FixLoopError('not_found', 'This fix loop does not exist or was replaced. Ask the user to start a new one.');
    if (loop.agentPath !== agentPath) throw new FixLoopError('path_refused', `This fix loop only covers ${loop.agentPath}.`);
    if (loop.status !== 'running') throw new FixLoopError(`loop_${loop.status}`, `This fix loop is ${loop.status}. Propose your best version now, or stop.`);
    if (loop.attempts.length >= loop.budget) throw new FixLoopError('loop_exhausted', `This fix loop used its ${loop.budget} attempts. Propose your best version now.`);
    return loop;
  }

  record(projectId: string, id: string, outcome: Record<string, string>): FixLoop | null {
    const loop = this.get(projectId, id);
    if (!loop || loop.status !== 'running') return loop;
    const failing = loop.caseIds.filter(caseId => outcome[caseId] !== 'pass');
    const at = this.o.now();
    loop.attempts.push({ n: loop.attempts.length + 1, pass: loop.caseIds.length - failing.length, total: loop.caseIds.length, at, failing });
    loop.updatedAt = at;
    if (!failing.length) loop.status = 'passed';
    else if (loop.attempts.length >= loop.budget) loop.status = 'exhausted';
    return loop;
  }
}
