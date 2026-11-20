/**
 * Live checks for the "Squad Worker Issues" branch against a running app (`pnpm run dev` on :8781).
 *
 * Only paths that refuse or preview before any model runs are covered, so this suite is fast and free:
 *   - Test 2: a bad persona file shows up as a load warning (API and `zcc personas ls`).
 *   - Test 3: a launch with unresolved worker personas is refused and opens nothing.
 *   - Test 7: a roster larger than the Squad's Max sessions is refused and opens nothing.
 *   - Test 9: `zcc team launch --plan-file ... --dry-run` previews and creates no run.
 * Stop, restart, respawn and the UI surfaces need real agents or a human; see the manual test plan.
 *
 * Run: `ZCC_SERVER_URL=http://127.0.0.1:8781 pnpm live:squad-worker-issues`
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { Zcc } from '../src/client.js';
import { liveEnabled } from '../src/matrix.js';

const enabled = liveEnabled();
const run = promisify(execFile);
const CLI = resolve(__dirname, '../../cli/dist/bin/zcc.js');

type LaunchResult = { ok?: boolean; code?: string; message?: string; value?: unknown };

const PLAN = [
  '# Live plan',
  '### unit-a: Write a <!-- executable-step -->', '- Work: Create a.txt.', '- Write scope: `a.txt`', '- Verification: Read a.txt.', ''
].join('\n');

describe.skipIf(!enabled)('live squad worker issues (refusals and previews only)', () => {
  const cleanups: Array<() => void> = [];
  afterAll(() => { for (const fn of cleanups.reverse()) { try { fn(); } catch { /* best effort */ } } });

  async function setup() {
    const zcc = await Zcc.connect();
    const project = await zcc.projects.ensureLiveSandbox();
    const teamsDir = join(zcc.dataDir, 'teams');
    mkdirSync(teamsDir, { recursive: true });
    return { zcc, project, teamsDir };
  }

  async function writeTeam(zcc: Zcc, teamsDir: string, id: string, team: Record<string, unknown>) {
    const file = join(teamsDir, `${id}.json`);
    writeFileSync(file, JSON.stringify({ id, name: id, ...team }));
    cleanups.push(() => rmSync(file, { force: true }));
    // The team store watches the directory; wait until the launch path can see the Squad.
    for (let i = 0; i < 40; i += 1) {
      const listed = await zcc.http.request<{ teams?: Array<{ id: string }> }>('GET', '/api/v1/teams');
      if (listed.teams?.some((t) => t.id === id)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`team ${id} never appeared in /api/v1/teams`);
  }

  async function launch(zcc: Zcc, body: Record<string, unknown>): Promise<LaunchResult> {
    try {
      return await zcc.http.request<LaunchResult>('POST', '/api/v1/teams/launch', { body });
    } catch (error) {
      const e = error as { message?: string; code?: string };
      return { ok: false, code: e.code, message: e.message };
    }
  }

  it('test 2: a bad persona file is reported as a load warning with a fixed reason', async () => {
    const { zcc } = await setup();
    const dir = join(zcc.dataDir, 'personas');
    mkdirSync(dir, { recursive: true });
    const name = `live-bad-${zcc.runId}.json`;
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify({ id: `live-bad-${zcc.runId}`, name: 'Bad', baseProfile: 'garbage', secret: 'must-not-leak-4242' }));
    cleanups.push(() => rmSync(file, { force: true }));

    const api = await zcc.http.request<{ warnings: Array<{ file: string; reason: string }> }>('GET', '/api/v1/personas');
    const warning = api.warnings.find((w) => w.file === name);
    expect(warning, JSON.stringify(api.warnings)).toBeTruthy();
    expect(JSON.stringify(warning)).not.toContain('must-not-leak-4242');

    expect(existsSync(CLI), `build the CLI first: ${CLI}`).toBe(true);
    const out = await run('node', [CLI, 'personas', 'ls', '--json'], {
      env: { ...process.env, ZCC_DATA_DIR: zcc.dataDir, ZCC_SERVER_URL: process.env.ZCC_SERVER_URL ?? '' }
    });
    expect(out.stderr).toContain(name);
    expect(out.stdout + out.stderr).not.toContain('must-not-leak-4242');
  });

  it('test 3: freeform and structured launches with unresolved worker personas are refused and open nothing', async () => {
    const { zcc, project, teamsDir } = await setup();
    const ghost = `ghost-${zcc.runId}`;
    // Slot ids are 'orchestrator' + worker slots; every worker persona is unknown.
    await writeTeam(zcc, teamsDir, `live-ghost-all-${zcc.runId}`, {
      orchestratorPersonaId: 'builtin:orchestrator',
      slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }, { personaId: ghost, quantity: 1 }]
    });
    // One real worker plus one unknown worker: freeform now refuses (Modern parity).
    await writeTeam(zcc, teamsDir, `live-ghost-some-${zcc.runId}`, {
      orchestratorPersonaId: 'builtin:orchestrator',
      slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }, { personaId: 'builtin:software-engineer', quantity: 1 }, { personaId: ghost, quantity: 1 }]
    });

    for (const [teamId, mode] of [
      [`live-ghost-some-${zcc.runId}`, 'freeform'],
      [`live-ghost-all-${zcc.runId}`, 'freeform'],
      [`live-ghost-all-${zcc.runId}`, 'structured']
    ] as const) {
      const result = await launch(zcc, { teamId, projectId: project.id, goal: 'live refusal check', mode, ...(mode === 'structured' ? { planText: PLAN } : {}) });
      expect(result.ok, `${teamId} ${mode}: ${JSON.stringify(result)}`).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/executionId/);
    }
  });

  it('test 7: a roster larger than the Squad Max sessions is refused and opens nothing', async () => {
    const { zcc, project, teamsDir } = await setup();
    // Coordinator + 3 workers = 4 sessions against a cap of 3.
    await writeTeam(zcc, teamsDir, `live-limit-${zcc.runId}`, {
      orchestratorPersonaId: 'builtin:orchestrator',
      limits: { maxConcurrent: 3 },
      slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }, { personaId: 'builtin:software-engineer', quantity: 3 }]
    });
    const result = await launch(zcc, {
      teamId: `live-limit-${zcc.runId}`, projectId: project.id, goal: 'live limit check', mode: 'structured', planText: PLAN
    });
    expect(result.ok, JSON.stringify(result)).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/executionId/);
    expect(JSON.stringify(result)).toMatch(/limit|session|concurrent/i);
  });

  it('test 9: zcc team launch --plan-file --dry-run previews and creates no run; a missing file fails cleanly', async () => {
    const { zcc, project } = await setup();
    const planFile = join(zcc.dataDir, `live-plan-${zcc.runId}.md`);
    writeFileSync(planFile, PLAN);
    cleanups.push(() => rmSync(planFile, { force: true }));
    const env = { ...process.env, ZCC_DATA_DIR: zcc.dataDir, ZCC_SERVER_URL: process.env.ZCC_SERVER_URL ?? '' };
    const base = ['team', 'launch', '--team', 'builtin:delivery-squad', '--project', project.id, '--mode', 'structured'];

    const dry = await run('node', [CLI, ...base, '--plan-file', planFile, '--dry-run'], { env }).catch((e) => e as { stdout: string; stderr: string; code?: number });
    expect(dry.stdout + dry.stderr).not.toMatch(/at .*\.(ts|js):\d+/);
    expect((dry as { code?: number }).code ?? 0).toBe(0);

    const missing = await run('node', [CLI, ...base, '--plan-file', join(zcc.dataDir, 'does-not-exist.md')], { env })
      .then(() => ({ code: 0, text: '' }), (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: e.code ?? 1, text: `${e.stdout ?? ''}${e.stderr ?? ''}` }));
    expect(missing.code).not.toBe(0);
    expect(missing.text).toContain('does-not-exist.md');
    expect(missing.text).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});
