/**
 * DURABLE Job Team run to COMPLETED — the completion regression net.
 *
 * `job-team-launch-ui.spec.ts` proves a durable job *surfaces* on the board; it
 * stops there. This spec proves the durable engine actually RUNS a DAG to a
 * successful end: launch → parallel work → a durable human question → an
 * out-of-band answer → dependent work resumes → COMPLETED, with the three
 * output files on disk. The scenario is a self-contained, harness-agnostic
 * fixture — two parallel writes, one mid-run human decision, one dependent
 * assemble — that exercises Zana's engine ALONE and knows nothing of any
 * external plan producer or consumer skill.
 *
 * The cohort spawns a single fake binary (see `makeJobTeamCoordinatorBinary`)
 * for all three slots — 1 orchestrator + 2 workers. Each process self-identifies
 * from its launch prompt and speaks the execution MCP protocol over the app's
 * own loopback endpoint (no model, no external network). The test drives the
 * human side purely through renderer IPC:
 *   window.cc.teams.startJob        → launch the durable job
 *   window.cc.executionBoard.snapshot → poll DAG state + the blocker
 *   window.cc.executionBoard.respond  → answer the durable question
 *
 * Headless safeStorage: the durable launch caches a resume token via Electron
 * `safeStorage`, whose `isEncryptionAvailable()` BLOCKS the main thread forever
 * on a headless macOS runner (no Keychain session) — the launch never returns.
 * `--password-store=basic` does NOT help (Linux-only switch). The fix is the
 * resume-token store's `insecure` mode, enabled from ZCC_E2E_HOME (host.ts),
 * which bypasses safeStorage. Without it this spec hangs on `teams.startJob`.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `teamJobLaunchEnabled` gates whether the cohort MCP route wires the execution
// tools (`execution.plan.register`, `execution.work.*`, `execution.snapshot`) —
// and that gate is READ AT BOOT (host.ts startMcpServer opts, "toggling takes
// effect on next launch"). A post-boot `config.set` is too late: the server
// captured `executionService: undefined` and every cohort tool call returns
// `-32602 not found`. Seed the flag before boot via initialConfig (on macOS the
// fixture writes it to the real ~/.zcc/config.json the app actually reads, and
// restores it on teardown).
test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true } });

// The DAG has a human decision in the middle; give the durable run room.
test.setTimeout(120_000);

interface BlockerView {
  id: string;
  question: string;
  options?: string[];
}
interface ExecView {
  state: string;
  stateVersion?: number;
  currentBlocker?: BlockerView | null;
}

test('a durable Job Team runs its DAG to COMPLETED and answers a mid-run question', async ({
  app
}) => {
  const { window } = app;
  const agent = makeJobTeamCoordinatorBinary();

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-job-team-run-proj-'));
  let projectId: string | null = null;
  let executionId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);

    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-orchestrator',
      name: 'E2E Orchestrator',
      description: 'Claude orchestrator for the durable job-team run spec',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-worker',
      name: 'E2E Worker',
      description: 'Claude worker for the durable job-team run spec',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));

    // 1 orchestrator (orchestratorPersonaId) + 2 workers (a single slot with
    // quantity 2 → two distinct main-minted slot ids).
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-job-team',
      name: 'E2E Durable Job Team',
      description: 'Durable job team driven to completion under test',
      slots: [{ personaId: 'e2e-worker', quantity: 2 }],
      orchestratorPersonaId: 'e2e-orchestrator'
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // Launch the durable job via the intact IPC path.
    executionId = await window.evaluate(async (pid) => {
      const res = await window.cc.teams.startJob({
        teamId: 'e2e-job-team',
        projectId: pid,
        goal: 'Run the minimal workflow probe: home, about, a navigation-label question, then assemble.',
        title: 'Durable probe run',
        summary: 'Two workers, one durable question, one assemble.'
      });
      if (!res || !res.ok) throw new Error('startJob failed: ' + JSON.stringify(res));
      return res.value.executionId;
    }, projectId);
    expect(executionId).toBeTruthy();

    const readExec = async (): Promise<ExecView | null> => window.evaluate(async (args) => {
      const snap = await window.cc.executionBoard.snapshot(args.pid, args.eid, 0);
      if (!snap) return null;
      const e = snap.execution;
      return {
        state: e.state,
        stateVersion: e.stateVersion,
        currentBlocker: e.currentBlocker
          ? { id: e.currentBlocker.id, question: e.currentBlocker.question, options: e.currentBlocker.options }
          : null
      };
    }, { pid: projectId!, eid: executionId! });

    // Wait for the durable human question to surface after both parallel units.
    let blocker: BlockerView | null = null;
    await expect.poll(async () => {
      const exec = await readExec();
      if (exec?.currentBlocker) blocker = exec.currentBlocker;
      // Fail fast if the run died before asking.
      if (exec && ['FAILED', 'STOPPED'].includes(exec.state)) {
        throw new Error(`execution ${exec.state} before the blocker appeared`);
      }
      return blocker ? 'blocked' : (exec?.state ?? 'pending');
    }, { timeout: 60_000, intervals: [1000] }).toBe('blocked');

    expect(blocker!.question).toContain('label');
    expect((blocker!.options ?? []).slice().sort()).toEqual(['About', 'About Atlas']);

    // Answer the durable question out-of-band, exactly as Job Details does.
    const chosen = 'About Atlas';
    await window.evaluate(async (args) => {
      const snap = await window.cc.executionBoard.snapshot(args.pid, args.eid, 0);
      const version = snap?.execution.stateVersion ?? 0;
      const clientRequestId = `${args.blockerId}:${crypto.randomUUID()}`;
      const res = await window.cc.executionBoard.respond(
        args.pid, args.eid, version, args.blockerId, clientRequestId, args.message
      );
      if (!res || !res.ok) throw new Error('respond failed: ' + JSON.stringify(res));
    }, { pid: projectId, eid: executionId, blockerId: blocker!.id, message: chosen });

    // Dependent work resumes; run reaches COMPLETED.
    await expect.poll(async () => {
      const exec = await readExec();
      if (exec && ['FAILED', 'STOPPED'].includes(exec.state)) {
        throw new Error(`execution ${exec.state} before completing`);
      }
      return exec?.state ?? 'pending';
    }, { timeout: 60_000, intervals: [1000] }).toBe('COMPLETED');

    // DAG output artifacts on disk (the probe's acceptance evidence).
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'home.txt'), 'utf8')).toBe('HOME: ready\n');
    expect(readFileSync(join(projectDir, 'about.txt'), 'utf8')).toBe('ABOUT: ready\n');
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toBe(`HOME: ready\nABOUT: ready\nLABEL: ${chosen}\n`);
  } finally {
    try {
      if (projectId) {
        await window.evaluate(async (pid) => {
          try {
            const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
            if (Array.isArray(sessions)) {
              for (const s of sessions) {
                try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ }
              }
            }
          } catch { /* best-effort */ }
          try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
        }, projectId);
      }
    } catch { /* page may already be closed on timeout */ }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    agent.cleanup();
  }
});
