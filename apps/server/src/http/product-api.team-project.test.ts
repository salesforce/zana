import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startProductServer, type ProductServer } from './product-server.js';
import { runCli } from '../../../../packages/cli/src/lib/run-cli.js';
import { createTeamProductOps } from '../../../desktop/src/team-product-ops.js';
import type { ExecutionRecord } from '../services/execution/store.js';

let server: ProductServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function boot() {
  const dataDir = mkdtempSync(join(tmpdir(), 'team-project-api-'));
  const homeRoot = mkdtempSync(join(homedir(), '.team-project-api-'));
  dirs.push(dataDir, homeRoot);
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  return { dataDir, homeRoot };
}

function register(path: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return fetch(`${server!.url}api/v1/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ path, registrationMode: 'confined', ...extra })
  });
}

describe('team CLI confined project registration', () => {
  it('registers HOME paths and deduplicates concurrent realpath aliases', async () => {
    const { homeRoot } = await boot();
    const projectPath = join(homeRoot, 'checkout');
    mkdirSync(projectPath);
    const alias = join(homeRoot, 'alias');
    symlinkSync(projectPath, alias);
    const responses = await Promise.all([register(projectPath), register(alias)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const rows = await Promise.all(responses.map(response => response.json()));
    expect(rows[0].project.id).toBe(rows[1].project.id);
    expect(rows[0].project.path).toBe(realpathSync(projectPath));
    expect(server!.ctx.projects.list()).toHaveLength(1);
  });

  it('rejects outside paths and symlink escapes without registering them', async () => {
    const { homeRoot, dataDir } = await boot();
    const escape = join(homeRoot, 'escape');
    symlinkSync(dataDir, escape);
    for (const path of [dataDir, escape]) {
      const response = await register(path);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'PROJECT_PATH_UNCONFINED' });
    }
    expect(server!.ctx.projects.list()).toEqual([]);
  });

  it('allows configured cloneRoot but rejects missing paths, files, relative paths and remote host mode', async () => {
    const { dataDir } = await boot();
    const cloneRoot = join(dataDir, 'clones');
    mkdirSync(cloneRoot);
    await server!.ctx.config.setConfig({ cloneRoot });
    const checkout = join(cloneRoot, 'checkout');
    mkdirSync(checkout);
    expect((await register(checkout)).status).toBe(200);
    for (const [path, extra] of [[join(cloneRoot, 'missing'), {}], [join(dataDir, 'projects.json'), {}], ['relative', {}], [checkout, { hostId: 'remote' }]] as const) {
      expect((await register(path, extra)).status).toBe(400);
    }
    expect(server!.ctx.projects.list()).toHaveLength(1);
  });

  it('rejects requests carrying caller attestation headers (not an authenticated-agent boundary)', async () => {
    const { homeRoot } = await boot();
    const attestations: Record<string, string>[] = [{ 'x-zcc-caller-session-id': 'agent' }, { 'x-zcc-caller-credential': 'forged' }];
    for (const headers of attestations) {
      const response = await register(homeRoot, {}, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'FORBIDDEN_AGENT' });
    }
    expect(server!.ctx.projects.list()).toEqual([]);
  });

  it('allows headerless confined registration under the existing local HTTP baseline', async () => {
    const { homeRoot } = await boot();
    // Header absence is not proof of caller identity; path confinement is the boundary tested here.
    const response = await register(homeRoot);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: { path: realpathSync(homeRoot) } });
    expect(server!.ctx.projects.list()).toHaveLength(1);
  });

  it('keeps operator registration unchanged and rejects invalid safe modes', async () => {
    const { dataDir } = await boot();
    expect((await register(dataDir, { registrationMode: 'unknown' })).status).toBe(400);
    const response = await fetch(`${server!.url}api/v1/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: dataDir })
    });
    expect(response.status).toBe(200);
    expect(server!.ctx.projects.list()).toHaveLength(1);
  });

  it('runs CLI path registration, launch, and persisted result across real product HTTP', async () => {
    const { homeRoot } = await boot();
    const record = {
      id: 'ex-1', projectId: 'pending', teamId: 't1', state: 'COMPLETED', stateVersion: 2,
      callerPrincipalId: 'interactive:local', createdAt: 1, updatedAt: 2, attempt: 1,
      finalSummary: 'Persisted complete output', blockers: [],
      request: { version: 1, teamId: 't1', launchRequestId: 'launch', objective: 'ship', slots: [] }
    } as ExecutionRecord;
    server!.ctx.teamOps = createTeamProductOps({
      resolvePreview: async input => ({ launchOptions: {}, resolvedLaunch: (await import('@zana-ai/zcc-domain/launch-options')).resolveAllLaunch({}), location: { kind: 'project-root', projectId: input.projectId }, path: homeRoot, previewToken: 'fixture-token', fingerprint: 'fixture-fingerprint' }),
      startTeamJobFromUi: async input => {
        record.projectId = input.projectId;
        expect(server!.ctx.projects.list().some(row => row.id === input.projectId)).toBe(true);
        return { ok: true, value: { executionId: record.id, state: record.state } };
      },
      getExecution: async () => record, status: async () => record,
      stopJob: async () => ({ ok: true, value: record }), respondToBlocker: async () => ({ ok: true, value: record })
    });
    const args = ['node', 'zcc', 'team', 'launch', '--team', 't1', '--project', homeRoot, '--goal', 'ship', '--wait'];
    const result = await runCli(args, { serverUrl: server!.url });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'Persisted complete output\n' });
    expect(result.stderr).toContain('Launch preview:');
    const again = await runCli([...args, '--json'], { serverUrl: server!.url });
    expect(JSON.parse(again.stdout)).toBe(record.finalSummary);
    expect(server!.ctx.projects.list()).toHaveLength(1);
  });
});
