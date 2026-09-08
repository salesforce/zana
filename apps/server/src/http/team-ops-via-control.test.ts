import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamOpsViaControl } from './team-ops-via-control.js';

describe('createTeamOpsViaControl', () => {
  const dirs: string[] = [];
  let server: Server | null = null;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function boot() {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-team-control-'));
    dirs.push(dataDir);
    chmodSync(dataDir, 0o700);
    const socket = join(dataDir, 'control.sock');
    const seen: Array<Record<string, unknown>> = [];
    server = createServer((client) => {
      let body = '';
      client.on('data', (chunk) => {
        body += chunk.toString('utf8');
        if (!body.includes('\n')) return;
        const request = JSON.parse(body.trim()) as Record<string, unknown>;
        seen.push(request);
        client.end(JSON.stringify({ ok: true, value: { id: 'ex-1', state: 'RUNNING' } }) + '\n');
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(socket, resolve);
    });
    writeFileSync(join(dataDir, 'control.token'), JSON.stringify({ token: 'secret', nonce: 'boot', socket }), { mode: 0o600 });
    return { dataDir, seen };
  }

  it('forwards all Team verbs over the authenticated control socket', async () => {
    const { dataDir, seen } = await boot();
    const ops = createTeamOpsViaControl(dataDir);
    await ops.launch({ teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'structured' });
    await ops.status('ex-1');
    await ops.answer({ id: 'ex-1', message: 'yes', expectedStateVersion: 2 });
    await ops.stop('ex-1', 3);
    expect(seen.map((request) => request.op)).toEqual([
      'team.launch', 'team.status', 'team.answer', 'team.stop'
    ]);
    expect(seen[0]).toMatchObject({ token: 'secret', nonce: 'boot', args: { goal: 'ship' } });
  });

  it('fails closed when Electron main is unavailable', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-team-control-off-'));
    dirs.push(dataDir);
    mkdirSync(dataDir, { recursive: true });
    await expect(createTeamOpsViaControl(dataDir).status('ex-1')).resolves.toMatchObject({
      ok: false,
      code: 'host_disconnected'
    });
  });
});
