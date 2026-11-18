import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { stubRecordedOpenDialog } from './sdk/native-dialog.js';

// A Squad launch with an attached source snapshots it under
// <userData>/squad-execution-sources/<key>/ before anything starts. The key comes
// from the launch id (`ui:<uuid>`); a `:` in it is not a valid Windows file name and
// failed every such launch with "ENOENT … mkdir". The goal here is one character over
// the limit, so the launch is refused with GOAL_TOO_LONG right AFTER the snapshot is
// written, and no coordinator or worker CLI is spawned. Reaching that refusal proves
// the snapshot write worked on this platform.
// SQUAD_GOAL_MAX_CHARS in packages/domain/src/squad-proposal.ts.
const SQUAD_GOAL_MAX_CHARS = 2048;

test.use({ e2e: true, initialConfig: {
  teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true,
  autoRenameTabs: false, tmuxScope: 'off'
} });

test('a Squad launch with an attached source writes its snapshot on every platform', async ({ app, home }) => {
  const { window } = app;
  const projectDir = join(home, 'squad source snapshot project');
  const storeDir = join(home, 'electron-user-data', 'squad-execution-sources');
  let projectId: string | undefined;
  try {
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

    projectId = await window.evaluate(async (path) => {
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

    // Attach the file the way the composer does: the native chooser, then main issues a capability.
    await stubRecordedOpenDialog(app.electron, [[planPath]]);
    const picked = await window.evaluate((id) => window.cc.executionSources.pick(id), projectId);
    expect(picked).toMatchObject({ ok: true, value: [expect.objectContaining({ name: 'attached-plan.md' })] });
    const sourceCapabilityIds = (picked as { value: Array<{ id: string }> }).value.map(({ id }) => id);

    const launched = await window.evaluate(async ({ projectId, goal, sourceCapabilityIds }) => window.cc.teams.startJob({
      teamId: 'source-snapshot-squad', projectId, goal, coordinationMode: 'freeform', sourceCapabilityIds
    }), { projectId, goal: 'x'.repeat(SQUAD_GOAL_MAX_CHARS + 1), sourceCapabilityIds });
    // Before the fix, Windows returned the snapshot's "ENOENT … mkdir …\ui:<uuid>" here instead.
    expect(launched).toMatchObject({ ok: false, code: 'GOAL_TOO_LONG' });
    // The refused launch discards its snapshot, and nothing started.
    expect(existsSync(storeDir) ? readdirSync(storeDir) : []).toEqual([]);
    expect(await window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions, projectId)).toEqual([]);
    expect(await window.evaluate(async (id) => (await window.cc.terminals.list(id)).filter((session) => session.cohort), projectId)).toEqual([]);
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => undefined);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
