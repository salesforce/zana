import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { makeJobTeamCoordinatorBinary } from '../sdk/harness.js';
import { launchSquadFixture, type JobTeamContext } from '../sdk/job-team-scenario.js';

it('records process cwd and HOME in the fake cohort boot receipt', () => {
  const agent = makeJobTeamCoordinatorBinary();
  const home = mkdtempSync(join(tmpdir(), 'cohort-receipt-'));
  try {
    spawnSync(agent.path, [], { cwd: home, env: { ...process.env, HOME: home }, timeout: 1000 });
    const log = readFileSync(join(home, '.fake-coordinator.log'), 'utf8');
    assert.ok(log.includes(`cwd=${realpathSync(home)}`), 'boot receipt missing cwd');
    assert.ok(log.includes(`home=${home}`), 'boot receipt missing HOME');
  } finally {
    agent.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

it('serializes fixture launch settings as flat public squad_launch fields', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'squad-public-schema-'));
  const launchOptions = { target: { kind: 'worktree', branch: 'feature/fixture' }, worktree: false,
    onComplete: 'leave', push: false, checks: [], failurePolicyDefault: 'fail-run' };
  const ctx = { projectDir, agent: { path: 'fixture' }, window: {
    evaluate: async () => { throw new Error('fixture launch intentionally stopped before Electron'); }
  } } as unknown as JobTeamContext;
  try {
    await assert.rejects(launchSquadFixture(ctx, [{ label: 'flat', input: { mode: 'now', launchOptions } }]), /intentionally stopped/);
    const input = JSON.parse(readFileSync(join(projectDir, '.e2e-proposal.json'), 'utf8')).proposals[0].input;
    assert.equal(Object.hasOwn(input, 'launchOptions'), false, 'public tool must not receive nested launchOptions');
    for (const [key, value] of Object.entries(launchOptions)) assert.deepEqual(input[key], value);
  } finally { rmSync(projectDir, { recursive: true, force: true }); }
});
