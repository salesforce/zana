import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { listHosts } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  delete process.env.ZCC_APP_URL;
  delete process.env.ZCC_HOST_ARTIFACT;
});

async function start(envUrl?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-hosts-api-'));
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  if (envUrl) process.env.ZCC_APP_URL = envUrl;
  server = await startProductServer({
    dataDir,
    enrollToken: 'enroll-token-enroll-token-enroll',
    origins: { serverPort: 0, devAppPort: 5173 }
  });
  return dataDir;
}

describe('hosts API', () => {
  it('mints a join code without inserting a host row', async () => {
    await start();
    const minted = await fetch(`${server!.url}api/v1/hosts/join-codes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(minted.status).toBe(201);
    const body = await minted.json() as { joinCode: string; hostId: string; expiresAt: number };
    expect(body.joinCode.startsWith('zcde_')).toBe(true);
    expect(body.hostId).toMatch(/^[0-9a-f-]{36}$/i);
    const listed = await fetch(`${server!.url}api/v1/hosts`).then((response) => response.json()) as unknown[];
    expect(listed.some((row) => (row as { id: string }).id === body.hostId)).toBe(false);
    expect(listHosts(server!.ctx.db).some((row) => row.id === body.hostId)).toBe(false);
  });

  it('refuses to delete the primary host and clamps a permission ceiling', async () => {
    await start();
    const enrolled = await fetch(`${server!.url}internal/hosts/enroll`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer enroll-token-enroll-token-enroll',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostName: 'laptop',
        instanceId: '11111111-1111-4111-8111-111111111111'
      })
    });
    expect(enrolled.status).toBe(201);
    const host = await enrolled.json() as { hostId: string };
    const denied = await fetch(`${server!.url}api/v1/hosts/${host.hostId}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' }
    });
    expect(denied.status).toBe(403);
    const patched = await fetch(`${server!.url}api/v1/hosts/${host.hostId}/permission-ceiling`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxPermissionMode: 'accept-edits' })
    });
    expect(patched.status).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({
      id: host.hostId,
      maxPermissionMode: 'accept-edits',
      isPrimary: true
    });
  });

  it('enrolls a join code against a Tailscale Serve Host header', async () => {
    await start('https://box.tailnet.ts.net');
    const minted = await fetch(`${server!.url}api/v1/hosts/join-codes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).then((response) => response.json()) as { joinCode: string; hostId: string };
    const enrolled = await fetch(`${server!.url}internal/hosts/enroll`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${minted.joinCode}`,
        'content-type': 'application/json',
        'x-forwarded-host': 'box.tailnet.ts.net'
      },
      body: JSON.stringify({
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostName: 'remote-box',
        instanceId: '22222222-2222-4222-8222-222222222222',
        hostId: minted.hostId
      })
    });
    expect(enrolled.status).toBe(201);
    const body = await enrolled.json() as { hostId: string };
    expect(body.hostId).toBe(minted.hostId);
    const listed = await fetch(`${server!.url}api/v1/hosts`).then((response) => response.json()) as Array<{
      id: string;
      isPrimary: boolean;
    }>;
    expect(listed.find((row) => row.id === minted.hostId)?.isPrimary).toBe(false);
  });

  it('serves the installer script on loopback', async () => {
    await start();
    const script = await fetch(`${server!.url}install.sh`);
    expect(script.status).toBe(200);
    const text = await script.text();
    expect(text).toContain('--join-code');
    expect(text).toContain('.zcc-machines');
    const version = await fetch(`${server!.url}install/version`).then((response) => response.json()) as {
      protocolVersion: number;
    };
    expect(version.protocolVersion).toBe(HOST_RPC_PROTOCOL_VERSION);
  });

  it('install.sh can skip service install after /status reports connected', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'zcc-host-stub-'));
    writeFileSync(join(artifactDir, 'join.mjs'), `import { createServer } from 'node:http';
const port = Number(process.argv[process.argv.indexOf('--host-daemon-port') + 1]);
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ connected: true }));
}).listen(port, '127.0.0.1');
`);
    const tarball = join(artifactDir, 'zcc-host.tgz');
    expect(spawnSync('tar', ['-czf', tarball, '-C', artifactDir, 'join.mjs']).status).toBe(0);
    process.env.ZCC_HOST_ARTIFACT = tarball;
    await start();
    const downloaded = Buffer.from(await fetch(`${server!.url}install/zcc-host.tgz`).then((response) => {
      expect(response.status).toBe(200);
      return response.arrayBuffer();
    }));
    expect(downloaded.equals(readFileSync(tarball))).toBe(true);
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-install-data-'));
    const script = join(dirname(fileURLToPath(import.meta.url)), '../assets/install-machine.sh');
    const port = 41000 + Math.floor(Math.random() * 1000);
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('sh', [
        script,
        '--join-code', 'zcde_test',
        '--host-id', '11111111-1111-4111-8111-111111111111',
        '--server', server!.url.replace(/\/$/, ''),
        '--host-daemon-port', String(port)
      ], {
        detached: true,
        env: {
          ...process.env,
          ZCC_INSTALL_SKIP_SERVICE: '1',
          ZCC_INSTALL_WAIT_ATTEMPTS: '20',
          ZCC_INSTALL_WAIT_DELAY: '0.2',
          ZCC_HOST_JOIN_CLI: '',
          ZCC_DATA_DIR: dataDir,
          ZCC_HOST_ARTIFACT: tarball
        }
      });
      const killTree = () => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      };
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.includes('Connected (service install skipped).')) {
          killTree();
        }
      });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      const timer = setTimeout(() => {
        killTree();
        resolve({ status: null, stdout, stderr: `${stderr}\ntimeout` });
      }, 15_000);
      child.on('close', () => {
        clearTimeout(timer);
        resolve({
          status: stdout.includes('Connected (service install skipped).') ? 0 : 1,
          stdout,
          stderr
        });
      });
    });
    delete process.env.ZCC_HOST_ARTIFACT;
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Connected (service install skipped).');
  }, 20_000);

  it('proxies provider CLI status and install through host RPC', async () => {
    await start();
    const enrolled = await fetch(`${server!.url}internal/hosts/enroll`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer enroll-token-enroll-token-enroll',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostName: 'laptop',
        instanceId: '11111111-1111-4111-8111-111111111111'
      })
    });
    const host = await enrolled.json() as { hostId: string };
    const missing = await fetch(`${server!.url}api/v1/hosts/missing/provider-clis/status`);
    expect(missing.status).toBe(404);
    const disconnected = await fetch(`${server!.url}api/v1/hosts/${host.hostId}/provider-clis/status`);
    expect(disconnected.status).toBe(503);

    server!.ctx.hostHub.ensureHostSessionReady = () => ({}) as never;
    server!.ctx.hostHub.callHostOnlineRpc = async (input) => {
      if ((input.command as { type: string }).type === 'provider.cli_status') {
        return {
          codex: {
            displayName: 'Codex',
            executableName: 'codex',
            executablePath: null,
            installed: false,
            installSource: 'notInstalled',
            currentVersion: null,
            latestVersion: '0.149.1',
            minimumSupportedVersion: '0.136.0',
            npmPackageName: '@openai/codex',
            npmGlobalPackageVersion: null,
            installAction: {
              kind: 'install',
              label: 'Install',
              commandKind: 'exec',
              command: 'npm install -g @openai/codex@latest'
            },
            needsUpdate: false,
            versionUnsupported: false
          }
        };
      }
      return {
        events: [
          { type: 'started', provider: 'codex', command: 'npm install -g @openai/codex@latest' },
          { type: 'completed', provider: 'codex', exitCode: 0, signal: null, success: true }
        ]
      };
    };

    const status = await fetch(`${server!.url}api/v1/hosts/${host.hostId}/provider-clis/status`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      codex: { displayName: 'Codex', installAction: { kind: 'install' } }
    });

    const bad = await fetch(`${server!.url}api/v1/hosts/${host.hostId}/provider-clis/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'nope' })
    });
    expect(bad.status).toBe(400);

    const installed = await fetch(`${server!.url}api/v1/hosts/${host.hostId}/provider-clis/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'codex', actionKind: 'install' })
    });
    expect(installed.status).toBe(200);
    expect(installed.headers.get('content-type')).toContain('ndjson');
    const lines = (await installed.text()).trim().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'started', provider: 'codex' });
    expect(JSON.parse(lines[1]!)).toMatchObject({ type: 'completed', success: true });
  });
});
