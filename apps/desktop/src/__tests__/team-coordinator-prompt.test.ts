import { describe, expect, it } from 'vitest';
import type { Team, TeamLaunchRequestInput } from '@zana-ai/zcc-domain/product';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import { boundedWorkUnitDigest, jobCoordinatorPrompt } from '../team-coordinator-prompt.js';

const team: Team = {
  id: 'builtin:squad',
  name: 'Doc Squad',
  description: 'x',
  orchestratorPersonaId: 'lead',
  slots: [{ personaId: 'lead', quantity: 1 }, { personaId: 'worker', quantity: 2 }],
  source: 'builtin'
};
const roster = [{ sessionId: 's-1', slotId: 'slot-1', label: 'Worker A' }];
const baseJob: NonNullable<TeamLaunchRequestInput['jobContext']> = { objective: 'Ship the thing' };
const withSources: NonNullable<TeamLaunchRequestInput['jobContext']> = {
  objective: 'Ship the thing',
  sourceBundle: {
    contentRef: 'ref-123',
    sources: [{ id: 'src-1', label: 'plan.md', mediaType: 'text/markdown', byteSize: 10, sha256: 'abc' } as never]
  }
};
const units: ExecutionWorkUnitInput[] = [
  { id: 'a', title: 'A', task: 'do a', dependencies: [] },
  { id: 'b', title: 'B', task: 'do b', dependencies: ['a'] }
];

describe('jobCoordinatorPrompt — Flow A (plan ready, host-dispatched)', () => {
  const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: true, workUnits: units });

  it('tells the coordinator the plan is already dispatched and to make no kickoff calls', () => {
    expect(prompt).toContain('Kickoff is host-managed');
    expect(prompt).toContain('already dispatched every ready work unit');
    expect(prompt).toContain('Do NOT call `execution.snapshot`, `execution.plan.register`, or `execution.work.dispatch_ready`');
  });

  it('injects a bounded seeded-unit digest for a woken coordinator', () => {
    expect(prompt).toContain('the registered units are:');
    expect(prompt).toContain('`a`');
    expect(prompt).toContain('`b` (deps: a)');
  });

  it('never instructs the coordinator to author or hand-dispatch the plan', () => {
    expect(prompt).not.toContain('hand scheduling to the engine with a single `execution.work.dispatch_ready`');
    expect(prompt).not.toContain('author the plan once');
  });
});

describe('jobCoordinatorPrompt — Flow B/C (plan needed, coordinator authors then host dispatches)', () => {
  it('with sources: read sources, register once, host auto-dispatches', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: withSources, roster, planReady: false });
    expect(prompt).toContain('author the plan once');
    expect(prompt).toContain('execution.source.list');
    expect(prompt).toContain('bounded `execution.source.read`');
    expect(prompt).toContain('`execution.plan.register` EXACTLY ONCE');
    expect(prompt).toContain('host AUTOMATICALLY dispatches ready units the instant the plan registers');
    // The coordinator still never calls dispatch_ready — the host does it.
    expect(prompt).toContain('Do NOT call `execution.work.dispatch_ready`');
    // Source content reference is injected (host owns the READ), raw text is not.
    expect(prompt).toContain('Source content reference: `ref-123`');
  });

  it('without sources: derive from the goal (no source-read instruction)', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: false });
    expect(prompt).toContain('Derive bounded generic work units from the goal');
    expect(prompt).not.toContain('execution.source.list');
    expect(prompt).toContain('`execution.plan.register` EXACTLY ONCE');
  });
});

describe('jobCoordinatorPrompt — Flow B/C file handoff (sandbox-immune)', () => {
  it('with a plan file path: write the plan file, no execution.* MCP', () => {
    const prompt = jobCoordinatorPrompt({
      team, executionId: 'exec-1', job: withSources, roster, planReady: false,
      planFilePath: '.zana/execution-plan-exec-1.md', sourceFilePath: '.zana/execution-source-exec-1.md'
    });
    expect(prompt).toContain('the host reads it and registers');
    expect(prompt).toContain('`.zana/execution-plan-exec-1.md`');
    expect(prompt).toContain('`.zana/execution-source-exec-1.md`');
    // The blocked MCP chain must NOT be instructed on the handoff path.
    expect(prompt).toContain('Do not call `execution.source.list` or `execution.source.read`.');
    expect(prompt).toContain('Do not call `execution.plan.register` during normal kickoff.');
    expect(prompt).not.toContain('`execution.plan.register` EXACTLY ONCE');
    expect(prompt).not.toContain('bounded `execution.source.read`');
  });

  it('with a plan file path but no source mirror: derive from goal, still file-write', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: false, planFilePath: '.zana/execution-plan-exec-1.md' });
    expect(prompt).toContain('`.zana/execution-plan-exec-1.md`');
    expect(prompt).toContain('Derive bounded generic work units from the goal');
    // No source-READ instruction (the deny line still names the tool).
    expect(prompt).not.toContain('read that file with your file-read tool');
    expect(prompt).not.toContain('bounded `execution.source.read`');
  });

  it('without a plan file path: falls back to the legacy MCP-register instruction', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: withSources, roster, planReady: false });
    expect(prompt).toContain('`execution.plan.register` EXACTLY ONCE');
  });
});

describe('jobCoordinatorPrompt — shared invariants (both flows)', () => {
  it.each([true, false])('carries roster, objective, and kickoff denials (planReady=%s)', (planReady) => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady });
    expect(prompt).toContain('Worker A');
    expect(prompt).toContain('Objective: Ship the thing');
    expect(prompt).toContain('Do not call execution.status during normal kickoff.');
    expect(prompt).toContain('On an explicit health or escalation wake, call `execution.snapshot` once');
    expect(prompt).toContain('return `WRONG_AUTHORITY` for a bound cohort');
    expect(prompt).toContain('Do not call `list_agents` during normal kickoff.');
  });
});

describe('jobCoordinatorPrompt — result-only policy', () => {
  it.each([true, false])('never mentions artifact tools and points to unit results (planReady=%s)', (planReady) => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady });
    expect(prompt).not.toContain('artifact.put');
    expect(prompt).not.toContain('artifact.list');
    expect(prompt).toContain('`result` of `execution.work.complete`');
  });
});

describe('jobCoordinatorPrompt — native recovery', () => {
  it('tells a resumed coordinator to continue durable plan state without replacing workers', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: true, recoveryResume: true });
    expect(prompt).toContain('Recovery resume: this coordinator reopened its trusted native session');
    expect(prompt).toContain('Do not recreate completed work, replace workers, or start a new plan.');
  });
});

describe('jobCoordinatorPrompt — self-heal (coordinator answers a coordinator-directed blocker)', () => {
  it.each([true, false])('teaches answering a SEMANTIC_CONFLICT blockerId with execution.work.answer (planReady=%s)', (planReady) => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady });
    expect(prompt).toContain('SEMANTIC_CONFLICT');
    expect(prompt).toContain('blockerId=<id>');
    expect(prompt).toContain('execution.work.answer');
    expect(prompt).toContain('the worker resumes automatically');
    // still reserves human escalation for genuine human-only decisions
    expect(prompt).toContain('human-only decision');
  });
});

describe('jobCoordinatorPrompt — roster and plan-size edges', () => {
  it('renders "- No workers." for an empty roster', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster: [], planReady: true });
    expect(prompt).toContain('Workers are already running:\n- No workers.');
  });

  it('Flow A without workUnits omits the seeded-unit digest but keeps the park instruction', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: true });
    expect(prompt).not.toContain('the registered units are:');
    expect(prompt).toContain('End this turn and remain idle');
  });

  it('Flow A caps an oversized seeded plan in the injected digest', () => {
    const many: ExecutionWorkUnitInput[] = Array.from({ length: 25 }, (_, i) => ({ id: `u${i}`, title: 'T', task: 't', dependencies: [] }));
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: true, workUnits: many });
    expect(prompt).toContain('`u0`');
    expect(prompt).toContain('`u19`');
    expect(prompt).not.toContain('`u20`');
    expect(prompt).toContain('…and 5 more unit(s).');
  });

  it('renders strict-JSON source metadata (no sources → empty array)', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: false });
    expect(prompt).toContain('Metadata is strict JSON:\n[]');
  });
});

describe('boundedWorkUnitDigest', () => {
  it('returns an empty string for no units', () => {
    expect(boundedWorkUnitDigest([])).toBe('');
  });

  it('honors a custom maxUnits bound and reports the correct remainder', () => {
    const many: ExecutionWorkUnitInput[] = Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, title: 'T', task: 't', dependencies: [] }));
    const digest = boundedWorkUnitDigest(many, 3);
    expect(digest).toContain('`u0`');
    expect(digest).toContain('`u2`');
    expect(digest).not.toContain('`u3`');
    expect(digest).toContain('…and 7 more unit(s).');
  });


  it('caps the unit count and reports the remainder', () => {
    const many: ExecutionWorkUnitInput[] = Array.from({ length: 25 }, (_, i) => ({ id: `u${i}`, title: 'T', task: 't', dependencies: [] }));
    const digest = boundedWorkUnitDigest(many, 20);
    expect(digest).toContain('`u0`');
    expect(digest).toContain('`u19`');
    expect(digest).not.toContain('`u20`');
    expect(digest).toContain('…and 5 more unit(s).');
  });

  it('truncates a long task and collapses whitespace', () => {
    const long = 'x'.repeat(200);
    const digest = boundedWorkUnitDigest([{ id: 'a', title: 'A', task: `a\n  ${long}`, dependencies: [] }], 20, 30);
    const taskPart = digest.split(': ')[1] ?? '';
    expect(taskPart.length).toBeLessThanOrEqual(30);
    expect(digest).not.toContain('\n  ');
  });
});

/**
 * squad-bugs lifecycle contract. The prompt must follow the transport's real
 * capabilities: a CLI coordinator keeps the file handoff (the host rereads the
 * file on PTY idle), while a Modern/ACP coordinator has a bound
 * `execution.plan.register` MCP tool and no host reader, so it must register once
 * and must NOT be told to write a plan file as its kickoff.
 * `transport` is not a prompt input yet: the Modern cases are expected red until
 * the contract is implemented.
 */
describe('jobCoordinatorPrompt — transport contract (squad-bugs)', () => {
  const planFilePath = '.zana/execution-plan-exec-1.md';

  it('CLI keeps the file handoff and forbids plan.register', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: false, planFilePath });
    expect(prompt).toContain(`Write your COMPLETE portable-executable plan to \`${planFilePath}\``);
    expect(prompt).toContain('Do NOT call `execution.plan.register`');
    expect(prompt).not.toContain('`execution.plan.register` EXACTLY ONCE');
  });

  it('Modern registers once through the bound MCP tool and has no file-write kickoff', () => {
    const prompt = jobCoordinatorPrompt({
      team, executionId: 'exec-1', job: baseJob, roster, planReady: false, planFilePath, transport: 'modern'
    } as Parameters<typeof jobCoordinatorPrompt>[0]);
    expect(prompt).toContain('`execution.plan.register` EXACTLY ONCE');
    expect(prompt).not.toContain(planFilePath);
    expect(prompt).not.toContain('with your file-write tool');
    expect(prompt).not.toContain('Do NOT call `execution.plan.register`, `execution.work.dispatch_ready`');
  });

  it('Modern without a plan file still registers exactly once and never hand-dispatches', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: false });
    expect(prompt.match(/`execution\.plan\.register` EXACTLY ONCE/g)).toHaveLength(1);
    expect(prompt).toContain('Do NOT call `execution.work.dispatch_ready`');
  });

  it('a valid host seed makes zero authoring calls on either transport', () => {
    for (const transport of [undefined, 'modern', 'cli']) {
      const prompt = jobCoordinatorPrompt({
        team, executionId: 'exec-1', job: baseJob, roster, planReady: true, workUnits: units, planFilePath, ...(transport ? { transport } : {})
      } as Parameters<typeof jobCoordinatorPrompt>[0]);
      expect(prompt).toContain('Kickoff is host-managed');
      expect(prompt).toContain('Do NOT call `execution.snapshot`, `execution.plan.register`');
      expect(prompt).not.toContain('EXACTLY ONCE');
      expect(prompt).not.toContain('file-write tool');
    }
  });
});

describe('jobCoordinatorPrompt — provided plan awaiting correction review (squad-bugs B2a)', () => {
  const planFilePath = '.zana/execution-plan-exec-1.md';

  it('CLI parks instead of authoring the plan file at kickoff', () => {
    const prompt = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: false, planFilePath, planCorrectionPending: true });
    expect(prompt).toContain('awaiting operator correction review');
    expect(prompt).toContain(`Do NOT write any plan file now, including \`${planFilePath}\``);
    expect(prompt).toContain('write only that file');
    expect(prompt).toContain('do not run shell or network commands');
    expect(prompt).not.toContain('Write your COMPLETE portable-executable plan');
    expect(prompt).not.toContain('EXACTLY ONCE');
    expect(prompt).toContain('Do not call get_team_launch during normal kickoff.');
  });

  it('Modern registers one corrected candidate that the host holds for review', () => {
    const modern = jobCoordinatorPrompt({
      team, executionId: 'exec-1', job: baseJob, roster, planReady: false, planFilePath, transport: 'modern', planCorrectionPending: true
    });
    expect(modern).toContain('Call `execution.plan.register` EXACTLY ONCE with that corrected DAG');
    expect(modern).toContain('plan held for operator correction review');
    expect(modern).toContain('Do not retry it.');
    expect(modern).not.toContain('awaiting operator correction review');
    expect(modern).not.toContain(planFilePath);
    expect(modern).toContain('Do not call get_team_launch during normal kickoff.');
    const withSources = jobCoordinatorPrompt({
      team, executionId: 'exec-1', job: { ...baseJob, sourceBundle: { contentRef: 'ref', sources: [{ id: 's1' }] } as never }, roster,
      planReady: false, transport: 'modern', planCorrectionPending: true
    });
    expect(withSources).toContain('the attached execution sources');
    const unpending = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: false, transport: 'modern' });
    expect(unpending).toContain('`execution.plan.register` EXACTLY ONCE with the work DAG');
  });

  it('a pending flag on a ready plan keeps the host-managed arm', () => {
    const ready = jobCoordinatorPrompt({ team, executionId: 'exec-1', job: baseJob, roster, planReady: true, workUnits: units, planFilePath, planCorrectionPending: true });
    expect(ready).toContain('Kickoff is host-managed');
  });
});
