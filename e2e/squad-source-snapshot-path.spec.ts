import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { SQUAD_GOAL_MAX_CHARS } from '../packages/domain/src/squad-proposal.js';
import { test, expect } from './fixtures/app.js';
import { stubRecordedOpenDialog } from './sdk/native-dialog.js';

// A Squad launch with an attached source snapshots it under
// <userData>/squad-execution-sources/<key>/ before anything starts. The key comes
// from the launch id (`ui:<uuid>`); a `:` in it is not a valid Windows file name and
// failed every such launch with "ENOENT … mkdir". The goal here is one character over
// the limit, so the launch is refused with GOAL_TOO_LONG right AFTER the snapshot is
// written, and no coordinator or worker CLI is spawned. The snapshot is discarded again
// by then, so a directory watcher records the folder name while it exists: that proves
// the write happened (and under what name) even if the goal check is ever reordered.
test.use({ e2e: true, initialConfig: {
  teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true,
  autoRenameTabs: false, tmuxScope: 'off'
} });

function createGitProject(projectDir: string, home: string): string {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'README.md'), 'Squad source snapshot fixture.\n');
  const planPath = join(projectDir, 'attached-plan.md');
  writeFileSync(planPath, '# Attached plan\n\nRead README.md.\n');
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'gitconfig') }
  });
  git('init', '-b', 'main');
  git('add', '.');
  git('-c', 'user.name=Squad Source E2E', '-c', 'user.email=squad-source@example.test', 'commit', '-m', 'Fixture setup');
  return planPath;
}

async function registerSquad(window: Page, projectDir: string): Promise<string> {
  const projectId = await window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
    return result.value.id;
  }, projectDir);
  await window.evaluate(async () => {
    for (const persona of [
      { id: 'source-snapshot-coordinator', name: 'Source Snapshot Coordinator' },
      { id: 'source-snapshot-worker', name: 'Source Snapshot Worker' }
    ]) {
      const result = await window.cc.personas.save({ ...persona, baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' });
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
    const team = await window.cc.teams.save({
      id: 'source-snapshot-squad', name: 'Source Snapshot Squad', description: 'Snapshot-only fixture',
      slots: [{ personaId: 'source-snapshot-worker', quantity: 1 }], orchestratorPersonaId: 'source-snapshot-coordinator', defaultPlanning: 'infer'
    });
    if (!team.ok) throw new Error(JSON.stringify(team));
  });
  return projectId;
}

/** Folder names that appear in `dir` from now on, recorded even if they are removed again right away. */
function recordFolderNames(dir: string) {
  const names = new Set<string>();
  const watcher = watch(dir, (_event, name) => { if (name) names.add(String(name)); });
  return { names, stop: () => watcher.close() };
}

test('a Squad launch with an attached source writes its snapshot on every platform', async ({ app, home }) => {
  const { window } = app;
  const projectDir = join(home, 'squad source snapshot project');
  const storeDir = join(home, 'electron-user-data', 'squad-execution-sources');
  let projectId: string | undefined;
  let recorder: ReturnType<typeof recordFolderNames> | undefined;
  try {
    const planPath = createGitProject(projectDir, home);
    projectId = await registerSquad(window, projectDir);
    // Attach the file the way the composer does: the native chooser, then main issues a capability.
    await stubRecordedOpenDialog(app.electron, [[planPath]]);
    const picked = await window.evaluate((id) => window.cc.executionSources.pick(id), projectId);
    expect(picked).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'attached-plan.md' })] });
    const sourceCapabilityIds = (picked as { value: Array<{ id: string }> }).value.map(({ id }) => id);

    mkdirSync(storeDir, { recursive: true });
    recorder = recordFolderNames(storeDir);
    const launched = await window.evaluate(async ({ projectId, goal, sourceCapabilityIds }) => window.cc.teams.startJob({
      teamId: 'source-snapshot-squad', projectId, goal, coordinationMode: 'freeform', sourceCapabilityIds
    }), { projectId, goal: 'x'.repeat(SQUAD_GOAL_MAX_CHARS + 1), sourceCapabilityIds });
    // Before the fix, Windows returned the snapshot's "ENOENT … mkdir …\ui:<uuid>" here instead.
    expect(launched).toMatchObject({ ok: false, code: 'GOAL_TOO_LONG' });
    // The snapshot was written, under a name every platform accepts.
    expect([...recorder.names]).toEqual([expect.stringMatching(/^ui_[0-9a-f-]{36}$/)]);
    // The refused launch discarded it again, and nothing started.
    expect(readdirSync(storeDir)).toEqual([]);
    expect(await window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions, projectId)).toEqual([]);
    expect(await window.evaluate(async (id) => (await window.cc.terminals.list(id)).filter((session) => session.cohort), projectId)).toEqual([]);
  } finally {
    recorder?.stop();
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => undefined);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
