import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../run-cli.js';
import { runTeamCommand } from './team.js';
import { resolveAllLaunch } from '@zana-ai/zcc-domain/launch-options';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function router(routes: Record<string, unknown | ((body: any) => unknown)>): typeof fetch {
  return (async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
    const route = routes[key];
    if (route === undefined) return response({ error: `unmocked ${key}` }, 404);
    const value = typeof route === 'function' ? route(init?.body ? JSON.parse(String(init.body)) : undefined) : route;
    return value instanceof Response ? value.clone() : response(value);
  }) as typeof fetch;
}
const launch = ['node', 'zcc', 'team', 'launch', '--team', 't1', '--goal', 'ship'];
const launched = { ok: true, value: { kind: 'job', id: 'ex-1', state: 'RUNNING' } };
const trustedPreview = { ok: true, value: { launchOptions: {}, resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p1' }, path: '/repo', branch: 'main', fingerprint: 'host-fingerprint', previewToken: 'opaque-token' } };

describe('team project and terminal result contracts', () => {
  it('prints trusted values and sources before launch and forwards exact preview token', async () => {
    const events: string[] = [];
    const previewValue = { ...trustedPreview.value, resolvedLaunch: resolveAllLaunch({ plan: { push: true, checks: ['lint'] } }) };
    const result = await runTeamCommand('launch', ['--team', 't1', '--project', 'p1', '--goal', 'ship', '--mode', 'structured'], true, {
      onStderr: text => { events.push(text); },
      fetchImpl: router({
        'POST /api/v1/teams/preview': body => { expect(body).toEqual({ teamId: 't1', projectId: 'p1', goal: 'ship', coordinationMode: 'structured' }); events.push('preview'); return { ok: true, value: previewValue }; },
        'POST /api/v1/teams/launch': body => { expect(events[1]).toContain('push: true (plan)'); expect(events[1]).toContain('checks: lint (plan)'); expect(events[1]).toContain('main — /repo'); expect(body.previewToken).toBe('opaque-token'); events.push('launch'); return launched; }
      })
    });
    expect(result?.exitCode).toBe(0);
    expect(events[0]).toBe('preview'); expect(events[2]).toBe('launch');
    expect(JSON.parse(result!.stdout)).toEqual(launched.value);
    expect(result?.stderr).toBe('');
  });

  it.each([response({ message: 'preview refused' }, 400), { ok: false, message: 'preview refused' }, { ok: true, value: {} }])('never launches after missing or rejected trusted preview', async preview => {
    let launches = 0;
    const result = await runCli([...launch, '--project', 'p1'], { fetchImpl: router({ 'POST /api/v1/teams/preview': preview, 'POST /api/v1/teams/launch': () => { launches++; return launched; } }) });
    expect(result.exitCode).not.toBe(0); expect(launches).toBe(0);
  });

  it('prints actual launch location, not prospective preview location', async () => {
    const result = await runCli([...launch, '--project', 'p1'], { fetchImpl: router({ 'POST /api/v1/teams/preview': trustedPreview, 'POST /api/v1/teams/launch': { ok: true, value: { ...launched.value, path: '/repo/.worktrees/actual', branch: 'actual' } } }) });
    expect(result.stdout).toContain('actual — /repo/.worktrees/actual');
  });
  it('forwards all launch policies and branch-only target, preserving false', async () => {
    const seen: unknown[] = [];
    const result = await runCli([...launch, '--project', 'p1', '--worktree=false', '--on-complete', 'leave', '--push=false', '--check', 'unit', '--check', 'lint', '--failure-policy-default', 'fail-run', '--target', 'worktree:feature/x'], {
      fetchImpl: router({ 'POST /api/v1/teams/preview': body => { expect(body).toMatchObject({ coordinationMode: 'freeform', worktree: false, push: false, target: { kind: 'worktree', branch: 'feature/x' } }); return trustedPreview; }, 'POST /api/v1/teams/launch': body => { seen.push(body); return launched; } })
    });
    expect(result.exitCode).toBe(0);
    expect(seen).toEqual([{ teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'freeform', previewToken: 'opaque-token', worktree: false, onComplete: 'leave', push: false, checks: ['unit', 'lint'], failurePolicyDefault: 'fail-run', target: { kind: 'worktree', branch: 'feature/x' } }]);
  });

  it.each([['--worktree=maybe'], ['--push=maybe'], ['--on-complete', 'bad'], ['--check', 'npm test'], ['--failure-policy-default', 'retry'], ['--target', '/tmp'], ['--target', 'worktree:../bad'], ['--target', 'project-root', '--worktree']])('rejects invalid launch flags before network: %s', async (...flags) => {
    const result = await runCli([...launch, '--project', './checkout', ...flags], { fetchImpl: router({}) });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain('unmocked');
  });
  it.each(['/Users/operator/checkout', './checkout', '../checkout', '.', '~/checkout'])('registers path %s through confined main API before launching', async (path) => {
    const seen: unknown[] = [];
    const fetchImpl = router({
      'POST /api/v1/projects': body => { seen.push(body); return { project: { id: 'p1' } }; },
      'POST /api/v1/teams/preview': trustedPreview,
      'POST /api/v1/teams/launch': body => { seen.push(body); return launched; }
    });
    const result = await runCli([...launch, '--project', path], { fetchImpl });
    expect(result.exitCode).toBe(0);
    expect(seen).toEqual([
      { path: path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : resolve(path), registrationMode: 'confined' },
      { teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'freeform', previewToken: 'opaque-token' }
    ]);
    expect(result.stdout).toBe('ex-1\tjob\tRUNNING\n');
  });

  it('passes registered ids unchanged without registration or polling for nonwait', async () => {
    const fetchImpl = router({ 'POST /api/v1/teams/preview': trustedPreview, 'POST /api/v1/teams/launch': body => {
      expect(body.projectId).toBe('p1'); return launched;
    } });
    expect(JSON.parse((await runCli([...launch, '--project', 'p1', '--json'], { fetchImpl })).stdout)).toEqual(launched.value);
  });

  it.each([403, 400, 500])('does not launch after registration failure %s', async status => {
    const result = await runCli([...launch, '--project', './checkout'], { fetchImpl: router({
      'POST /api/v1/projects': response({ code: 'REJECTED', message: 'main refused path' }, status)
    }) });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('main refused path');
    expect(result.stdout).toBe('');
  });

  it('fails closed if registration returns no project id', async () => {
    const result = await runCli([...launch, '--project', './checkout'], { fetchImpl: router({ 'POST /api/v1/projects': {} }) });
    expect(result.stderr).toContain('project registration did not return an id');
  });

  it.each([false, true])('launch --wait prints only terminal result once (json=%s)', async json => {
    const payload = { version: 1, summary: 'actual output', units: [{ result: 'complete text' }] };
    let state = 'RUNNING';
    let now = 0;
    let polls = 0;
    const fetchImpl = router({
      'POST /api/v1/teams/preview': trustedPreview,
      'POST /api/v1/teams/launch': launched,
      'GET /api/v1/executions/ex-1': () => { polls++; return { ok: true, value: { id: 'ex-1', state, summary: 'not output', result: payload } }; }
    });
    const result = await runCli([...launch, '--project', 'p1', '--wait', ...(json ? ['--json'] : [])], {
      fetchImpl, nowMs: () => now, sleep: async () => { now += 500; state = 'COMPLETED'; }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(payload, null, 2)}\n`);
    expect(result.stdout).not.toContain('COMPLETED');
    expect(polls).toBe(2);
    expect(result.stderr).toContain('worktree: false (default)');
    expect(result.stderr).toContain('main — /repo');
  });

  it.each(['COMPLETED', 'FAILED', 'STOPPED'])('wait emits legacy persisted text at %s', async state => {
    const result = await runTeamCommand('wait', ['ex/1'], false, { fetchImpl: router({
      'GET /api/v1/executions/ex%2F1': { id: 'ex/1', state, result: 'Final text\nwith details' }
    }) });
    expect(result?.stdout).toBe('Final text\nwith details\n');
  });

  it('reports missing terminal result instead of reconstructing summary', async () => {
    const result = await runTeamCommand('wait', ['ex-1'], true, { fetchImpl: router({
      'GET /api/v1/executions/ex-1': { value: { id: 'ex-1', state: 'COMPLETED', summary: 'not output' } }
    }) });
    expect(result?.exitCode).toBe(1);
    expect(result?.stdout).toBe('');
    expect(result?.stderr).toContain('terminal execution ex-1 has no persisted result payload');
  });

  it('keeps status output separate from wait result and forwards answers/stops', async () => {
    const fetchImpl = router({
      'GET /api/v1/executions/ex-1': { value: { id: 'ex-1', kind: 'job', state: 'COMPLETED', teamId: 't1', result: 'done' } },
      'POST /api/v1/executions/ex%2F1/answer': body => { expect(body).toEqual({ message: 'yes', blockerId: 'b1' }); return { ok: true }; },
      'POST /api/v1/executions/ex%2F1/stop': { ok: true }
    });
    expect((await runTeamCommand('status', ['ex-1'], false, { fetchImpl }))?.stdout).toBe('ex-1\tjob\tCOMPLETED\tt1\n');
    expect((await runTeamCommand('answer', ['ex/1', '--text', 'yes', '--blocker', 'b1'], false, { fetchImpl }))?.stdout).toBe('ok\n');
    expect((await runTeamCommand('stop', ['ex/1'], true, { fetchImpl }))?.stdout).toContain('true');
  });

  it('validates flags before registration and relays launch/status failures', async () => {
    for (const args of [[], ['--team', 't1'], ['--team', 't1', '--project', './p'], ['--team', 't1', '--project', './p', '--goal', 'x', '--mode', 'bad'], ['--team', 't1', '--project', './p', '--goal', 'x', '--timeout', '25h']]) {
      expect((await runTeamCommand('launch', args, false, { fetchImpl: router({}) }))?.exitCode).toBe(2);
    }
    for (const [command, args] of [['status', []], ['answer', []], ['stop', []], ['wait', []], ['wait', ['ex', '--timeout', '0']], ['bogus', []]] as const) {
      expect((await runTeamCommand(command, [...args], false))?.exitCode).toBe(2);
    }
    expect(await runTeamCommand('ls', [], false)).toBeUndefined();
    const fetchImpl = router({ 'POST /api/v1/teams/preview': trustedPreview, 'POST /api/v1/teams/launch': response({ message: 'launch failed' }, 500), 'GET /api/v1/executions/ex': response({ message: 'status failed' }, 500) });
    expect((await runCli([...launch, '--project', 'p1'], { fetchImpl })).stderr).toContain('launch failed');
    expect((await runTeamCommand('wait', ['ex'], false, { fetchImpl }))?.stderr).toContain('status failed');
    expect((await runTeamCommand('status', ['ex'], false, { fetchImpl }))?.stderr).toContain('status failed');
    expect((await runCli([...launch, '--project', 'p1'], { fetchImpl: router({ 'POST /api/v1/teams/preview': trustedPreview, 'POST /api/v1/teams/launch': {} }) })).stderr).toContain('did not return an id');
  });

  it('times out without output', async () => {
    let now = 0;
    const result = await runTeamCommand('wait', ['ex', '--timeout', '1s'], false, {
      fetchImpl: router({ 'GET /api/v1/executions/ex': { value: { state: 'RUNNING' } } }),
      nowMs: () => now, sleep: async () => { now += 500; }
    });
    expect(result).toEqual({ exitCode: 124, stdout: '', stderr: 'Error: timed out waiting for ex\n' });
  });

  it('reads bounded goal files and rejects empty, missing or oversized files before launch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'team-goal-'));
    dirs.push(dir);
    const file = join(dir, 'goal.txt');
    const fetchImpl = router({ 'POST /api/v1/teams/preview': trustedPreview, 'POST /api/v1/teams/launch': body => { expect(body.goal).toBe('ship file'); expect(body.title).toBe('Title'); expect(body.summary).toBe('Context'); return launched; } });
    writeFileSync(file, 'ship file\n');
    const fileLaunch = ['node', 'zcc', 'team', 'launch', '--team', 't1', '--project', 'p1'];
    expect((await runCli([...fileLaunch, '--goal', `@${file}`, '--title', 'Title', '--summary', 'Context'], { fetchImpl })).exitCode).toBe(0);
    for (const content of ['', 'x'.repeat(4001)]) {
      writeFileSync(file, content);
      expect((await runCli([...fileLaunch, '--goal', `@${file}`], { fetchImpl: router({}) })).exitCode).toBe(2);
    }
    for (const goal of ['@', `@${file}.missing`]) expect((await runCli([...fileLaunch, '--goal', goal], { fetchImpl: router({}) })).exitCode).toBe(2);
  });
});
