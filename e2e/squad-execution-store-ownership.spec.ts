/**
 * MT-8: SQLite vs JSON Squad execution-store ownership across relaunches.
 *
 * One isolated HOME / userData is reused across five launches of the BUILT app.
 * Every run is created by really launching a Squad (`teams.startJob`, structured
 * "plan provided in goal", `write-note` -> `review-note`) against the fake
 * coordinator and driving it to COMPLETED. Nothing is seeded: no run record is
 * written by hand into squad-executions.json or squad-executions.sqlite.
 *
 *   1. ZCC_EXECUTION_STORE=json   -> Run A is JSON-owned; survives a same-flag relaunch.
 *   2. no flag                    -> Run B is SQLite-owned; A stays only in JSON.
 *   3. no flag                    -> `executionBoard.dismiss` on each lands only in its owner.
 *   4. ZCC_EXECUTION_STORE=json   -> B stays SQLite-owned/intact; new Run C is JSON-owned.
 *   5. no flag                    -> A, B, C all present with the right owner.
 *
 * Limitation: step 4 is the closest in-repo stand-in for a JSON-only (older)
 * reader. A genuinely older build cannot be run from this tree, so "older build
 * does not corrupt SQLite-owned runs" is NOT proven here.
 *
 * Store inspection runs from the Playwright Node process with the repo's own
 * `createSqliteDatabase` (Node ABI binding, read-only, only after the app has
 * quit), so the installed addon is never flipped.
 */
import { test, expect, launchApp, closeApp, type AppHandle } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true });
test.setTimeout(420_000);

const PLAN = [
  '# Note Plan',
  '',
  '### write-note: Write Note <!-- executable-step -->',
  '- **Work:** Create note.txt containing note ready',
  '- **Depends on:** None',
  '- **Write scope:** `note.txt`',
  '- **Verification:** note.txt present',
  '',
  '### review-note: Review Note <!-- executable-step -->',
  '- **Work:** Read note.txt and report its contents',
  '- **Depends on:** write-note',
  '- **Mode:** read-only',
  '- **Verification:** note reviewed',
  ''
].join('\n');

const BASE_CONFIG = { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, autoRenameTabs: false };

type Flag = 'json' | 'default';

interface StoreRecord { id: string; dismissedAt?: number; state?: string; jobTitle?: string }

function userData(home: string): string {
  return join(home, 'electron-user-data');
}

function readJsonStore(home: string): { ids: string[]; records: StoreRecord[]; raw: string } {
  const file = join(userData(home), 'squad-executions.json');
  if (!existsSync(file)) return { ids: [], records: [], raw: '' };
  const raw = readFileSync(file, 'utf8');
  const records = (JSON.parse(raw) as { records?: StoreRecord[] }).records ?? [];
  return { ids: records.map((r) => r.id), records, raw };
}

function readSqliteStore(home: string): { ids: string[]; records: StoreRecord[]; raw: string } {
  const file = join(userData(home), 'squad-executions.sqlite');
  expect(existsSync(file), 'squad-executions.sqlite exists').toBe(true);
  const db = createSqliteDatabase(file, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      "SELECT value_json FROM execution_store_record_rows WHERE store_id = 'execution-store' ORDER BY position"
    ).all() as Array<{ value_json: string }>;
    const records = rows.map((row) => JSON.parse(row.value_json) as StoreRecord);
    return { ids: records.map((r) => r.id), records, raw: rows.map((r) => r.value_json).join('\n') };
  } finally {
    db.close();
  }
}

async function launch(home: string, flag: Flag, first: boolean): Promise<AppHandle> {
  return launchApp(home, {
    e2e: true,
    // Explicit '' so an ambient ZCC_EXECUTION_STORE in the runner shell cannot leak into the "no flag" launches.
    env: { ZCC_EXECUTION_STORE: flag === 'json' ? 'json' : '' },
    ...(first ? { initialConfig: BASE_CONFIG } : {})
  });
}

async function quit(app: AppHandle): Promise<void> {
  const closed = app.electron.waitForEvent('close').catch(() => undefined);
  await app.electron.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await Promise.race([closed, new Promise((r) => setTimeout(r, 20_000))]);
  await closeApp(app.electron);
}

async function configure(app: AppHandle, binary: string, projectDir: string): Promise<string> {
  const { window } = app;
  await window.evaluate((bin) => window.cc.config.set({
    teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, defaultHarness: 'claude',
    trustZccToolsEnabled: false, tmuxScope: 'off'
  }), binary);
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Store ownership coordinator',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-worker', name: 'E2E Worker', description: 'Store ownership worker',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.teams.save({
    id: 'e2e-job-team', name: 'E2E Job Team', description: 'Store ownership team',
    slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator'
  }));
  const projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    return ((res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string }).id;
  }, projectDir);
  expect(projectId).toBeTruthy();
  return projectId;
}

/** Really launch a Squad and wait for COMPLETED. Returns its execution id. */
async function runSquad(app: AppHandle, projectId: string, title: string): Promise<string> {
  const { window } = app;
  const executionId = await window.evaluate(async (input) => {
    const res = await window.cc.teams.startJob({
      teamId: 'e2e-job-team', projectId: input.projectId, goal: input.plan, title: input.title,
      summary: 'MT-8 store ownership run', coordinationMode: 'structured'
    });
    if (!res || !res.ok) throw new Error(`startJob failed: ${JSON.stringify(res)}`);
    return res.value.executionId;
  }, { projectId, plan: PLAN, title });
  expect(executionId).toBeTruthy();
  await expect.poll(async () => window.evaluate(async (input) => {
    const snap = await window.cc.executionBoard.snapshot(input.projectId, input.executionId, 0);
    const state = snap?.execution.state ?? 'pending';
    if (state === 'FAILED' || state === 'STOPPED') throw new Error(`execution ${state}`);
    return state;
  }, { projectId, executionId }), { timeout: 90_000, intervals: [1_000], message: `${title} COMPLETED` }).toBe('COMPLETED');
  return executionId;
}

async function listedIds(app: AppHandle, projectId: string): Promise<string[]> {
  return app.window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions.map((e) => e.executionId), projectId);
}

async function snapshotState(app: AppHandle, projectId: string, executionId: string): Promise<string | null> {
  return app.window.evaluate(async (input) => {
    const snap = await window.cc.executionBoard.snapshot(input.projectId, input.executionId, 0);
    return snap ? snap.execution.state : null;
  }, { projectId, executionId });
}

/** The Agents board shows the run's card; opening it shows Squad details. */
async function expectCardInUi(app: AppHandle, projectName: string, title: string): Promise<void> {
  const { window } = app;
  const nav = window.getByTestId('project-nav-agents');
  if (!(await nav.isVisible())) {
    const row = window.locator('.project-item').filter({ hasText: projectName }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
  }
  await nav.click();
  const card = window.locator('.agent-card').filter({ hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await expect(window.getByLabel('Squad details')).toBeVisible({ timeout: 15_000 });
}

test('Squad execution store ownership holds across json / default / json / default relaunches', async ({ home }) => {
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-store-ownership-'));
  let app: AppHandle | null = null;
  const titleA = 'Store ownership run A';
  const titleB = 'Store ownership run B';
  const titleC = 'Store ownership run C';
  try {
    // ---- Step 1: json flag. Run A. ----
    app = await launch(home, 'json', true);
    const projectId = await configure(app, agent.path, projectDir);
    const runA = await runSquad(app, projectId, titleA);
    expect(readFileSync(join(projectDir, 'note.txt'), 'utf8')).toBe('note ready\n');
    await quit(app);
    app = null;
    expect(readJsonStore(home).ids).toEqual([runA]);
    expect(readSqliteStore(home).ids, 'json flag: nothing created in SQLite').toEqual([]);

    app = await launch(home, 'json', false);
    expect(await listedIds(app, projectId)).toContain(runA);
    await expectCardInUi(app, basename(projectDir), titleA);
    await quit(app);
    app = null;

    // ---- Step 2: no flag. Run B. ----
    app = await launch(home, 'default', false);
    expect(await listedIds(app, projectId)).toContain(runA);
    const runB = await runSquad(app, projectId, titleB);
    expect(runB).not.toBe(runA);
    await quit(app);
    app = null;
    {
      const json = readJsonStore(home);
      const sqlite = readSqliteStore(home);
      expect(json.ids, 'JSON holds A only').toEqual([runA]);
      expect(sqlite.ids, 'SQLite holds B only').toEqual([runB]);
      expect(json.raw).not.toContain(runB);
      expect(sqlite.raw).not.toContain(runA);
    }

    // ---- Step 3: no flag. Both visible; owner-safe mutation (dismiss) on each. ----
    app = await launch(home, 'default', false);
    expect((await listedIds(app, projectId)).sort()).toEqual([runA, runB].sort());
    await expectCardInUi(app, basename(projectDir), titleA);
    await expectCardInUi(app, basename(projectDir), titleB);
    const jsonBefore = readJsonStore(home);
    const sqliteBefore = readSqliteStore(home);
    expect(jsonBefore.records[0]!.dismissedAt).toBeUndefined();
    expect(sqliteBefore.records[0]!.dismissedAt).toBeUndefined();

    const dismissA = await app.window.evaluate((i) => window.cc.executionBoard.dismiss(i.p, i.e), { p: projectId, e: runA });
    expect(dismissA, JSON.stringify(dismissA)).toMatchObject({ ok: true });
    await quit(app);
    app = null;
    {
      const json = readJsonStore(home);
      const sqlite = readSqliteStore(home);
      expect(json.records.find((r) => r.id === runA)!.dismissedAt, 'A dismissal landed in JSON').toEqual(expect.any(Number));
      expect(sqlite.raw, 'SQLite (B) byte-identical after dismissing A').toBe(sqliteBefore.raw);
      expect(sqlite.records[0]!.dismissedAt).toBeUndefined();
    }

    app = await launch(home, 'default', false);
    expect(await listedIds(app, projectId)).toEqual([runB]);
    const jsonMid = readJsonStore(home);
    const dismissB = await app.window.evaluate((i) => window.cc.executionBoard.dismiss(i.p, i.e), { p: projectId, e: runB });
    expect(dismissB, JSON.stringify(dismissB)).toMatchObject({ ok: true });
    await quit(app);
    app = null;
    const jsonAfterStep3 = readJsonStore(home);
    const sqliteAfterStep3 = readSqliteStore(home);
    expect(sqliteAfterStep3.records.find((r) => r.id === runB)!.dismissedAt, 'B dismissal landed in SQLite').toEqual(expect.any(Number));
    expect(jsonAfterStep3.raw, 'JSON (A) byte-identical after dismissing B').toBe(jsonMid.raw);
    expect(jsonAfterStep3.raw).not.toContain(runB);
    expect(sqliteAfterStep3.raw).not.toContain(runA);

    // ---- Step 4: json flag again (stand-in for a JSON-only reader). Run C. ----
    app = await launch(home, 'json', false);
    // A and B are dismissed (hidden from the board) but their records remain readable by id.
    expect(await listedIds(app, projectId)).toEqual([]);
    expect(await snapshotState(app, projectId, runA)).toBe('COMPLETED');
    expect(await snapshotState(app, projectId, runB)).toBe('COMPLETED');
    const runC = await runSquad(app, projectId, titleC);
    await quit(app);
    app = null;
    {
      const json = readJsonStore(home);
      const sqlite = readSqliteStore(home);
      expect(sqlite.ids, 'B still SQLite-owned, nothing imported/added').toEqual([runB]);
      expect(sqlite.raw, 'SQLite byte-identical to before the json relaunch').toBe(sqliteAfterStep3.raw);
      expect(json.ids, 'JSON holds A and new C, not B').toEqual([runA, runC]);
      expect(json.raw).not.toContain(runB);
      expect(sqlite.raw).not.toContain(runC);
      expect(json.records.find((r) => r.id === runA)).toEqual(jsonAfterStep3.records.find((r) => r.id === runA));
    }

    // ---- Step 5: no flag. A, B, C all resolvable with correct ownership. ----
    app = await launch(home, 'default', false);
    expect(await listedIds(app, projectId)).toEqual([runC]);
    await expectCardInUi(app, basename(projectDir), titleC);
    for (const id of [runA, runB, runC]) expect(await snapshotState(app, projectId, id), id).toBe('COMPLETED');
    await quit(app);
    app = null;
    const finalJson = readJsonStore(home);
    const finalSqlite = readSqliteStore(home);
    expect(finalJson.ids).toEqual([runA, runC]);
    expect(finalSqlite.ids).toEqual([runB]);
    expect(finalSqlite.raw).toBe(sqliteAfterStep3.raw);
  } finally {
    if (app) await quit(app).catch(() => undefined);
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
