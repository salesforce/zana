/**
 * Docker remote-machine E2E for the pairing-relay session URL.
 *
 * Proves a Linux box can enroll through `http://<door>/t/<sessionId>/…`
 * (install.sh, enroll, zcc-join) while a laptop holds the tunnel. The laptop
 * tunnel. The laptop stub attaches inside the door container so the test
 * does not depend on `host.docker.internal` (Docker Desktop often resolves
 * that name to IPv6 first and IPv4 hangs) or on publishing the door port
 * (that path drops later WebSocket frames). Uses the default `bridge`
 * network so we do not allocate a new subnet (Docker Desktop often exhausts
 * predefined address pools — same reason `docker/remote-machine/compose.yaml`
 * sets `network_mode: bridge`).
 *
 *   pnpm test:docker:pairing
 *
 * Requires Docker Desktop (or a daemon) and builds `docker/remote-machine`.
 * Skipped unless ZCC_DOCKER_E2E=1 so ordinary `pnpm test` stays fast.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const enabled = process.env.ZCC_DOCKER_E2E === '1';
const dir = dirname(fileURLToPath(import.meta.url));
const relayDir = join(dir, '../../website/relay');
const TOKEN = 'relay-token-relay-token';
const pid = process.pid;
const CONTAINER = `zcc-pairing-e2e-${pid}`;
const DOOR = `zcc-pairing-door-${pid}`;
const IMAGE = 'zcc-remote-machine:local';
const DOOR_PORT = 4321;

let startedDoor = false;
let startedContainer = false;

function dockerOk(): boolean {
  const info = spawnSync('docker', ['info'], { encoding: 'utf8' });
  return info.status === 0;
}

function docker(args: string[], opts?: { timeout?: number }): ReturnType<typeof spawnSync> {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: opts?.timeout ?? 120_000
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dockerExec(args: string[], timeout = 30_000) {
  let last = docker(['exec', CONTAINER, ...args], { timeout });
  for (let attempt = 0; attempt < 8 && last.status !== 0; attempt++) {
    await sleep(400);
    last = docker(['exec', CONTAINER, ...args], { timeout });
  }
  return last;
}

afterEach(() => {
  if (startedContainer) {
    docker(['rm', '-f', CONTAINER], { timeout: 30_000 });
    startedContainer = false;
  }
  if (startedDoor) {
    docker(['rm', '-f', DOOR], { timeout: 30_000 });
    startedDoor = false;
  }
});

describe.skipIf(!enabled)('docker remote-machine pairing session', () => {
  it('fetches install.sh, enrolls, and runs zcc-join through /t/<sessionId>', async () => {
    if (!dockerOk()) {
      throw new Error('Docker daemon is not available. Start Docker Desktop, then retry.');
    }

    const inspect = docker(['image', 'inspect', IMAGE], { timeout: 10_000 });
    if (inspect.status !== 0) {
      const build = docker(['build', '-t', IMAGE, dir], { timeout: 300_000 });
      expect(build.status, build.stderr || build.stdout).toBe(0);
    }

    docker(['rm', '-f', CONTAINER, DOOR], { timeout: 15_000 });
    const doorRun = docker([
      'run',
      '-d',
      '--name', DOOR,
      '-e', `PORT=${DOOR_PORT}`,
      '-e', `ZCC_RELAY_TOKEN=${TOKEN}`,
      '-e', 'ZCC_SKIP_NEXT=1',
      '-e', 'ZCC_NEXT_ORIGIN=http://127.0.0.1:9',
      '-v', `${relayDir}:/relay:ro`,
      '-w', '/relay',
      '--entrypoint', 'node',
      IMAGE,
      'front-door.mjs'
    ], { timeout: 60_000 });
    expect(doorRun.status, doorRun.stderr || doorRun.stdout).toBe(0);
    startedDoor = true;

    for (let i = 0; i < 40; i++) {
      const logs = docker(['logs', DOOR], { timeout: 5_000 });
      if ((logs.stdout + logs.stderr).includes('listening on')) break;
      const running = docker(['inspect', '-f', '{{.State.Running}}', DOOR], { timeout: 5_000 });
      if (running.stdout.trim() !== 'true') {
        throw new Error(`front door exited:\n${logs.stdout}\n${logs.stderr}`);
      }
      await sleep(100);
    }

    const laptop = docker([
      'exec', '-d', DOOR, 'sh', '-c',
      `ZCC_RELAY_TOKEN=${TOKEN} RELAY_ORIGIN=http://127.0.0.1:${DOOR_PORT} node /relay/echo-laptop.mjs >/tmp/echo-laptop.log 2>&1`
    ], { timeout: 15_000 });
    expect(laptop.status, laptop.stderr || laptop.stdout).toBe(0);

    let sessionId = '';
    for (let i = 0; i < 40; i++) {
      const hello = docker(
        ['exec', DOOR, 'sh', '-c', 'cat /tmp/echo-session-id 2>/dev/null || true'],
        { timeout: 5_000 }
      );
      const match = /^(zcrs_[A-Za-z0-9_-]+)/.exec(hello.stdout.trim());
      if (match) {
        sessionId = match[1];
        break;
      }
      await sleep(100);
    }
    expect(sessionId).toMatch(/^zcrs_/);

    const doorIp = docker([
      'inspect',
      '-f', '{{.NetworkSettings.Networks.bridge.IPAddress}}',
      DOOR
    ], { timeout: 10_000 }).stdout.trim();
    expect(doorIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

    docker(['rm', '-f', CONTAINER], { timeout: 15_000 });
    const run = docker(['run', '-d', '--name', CONTAINER, IMAGE], { timeout: 60_000 });
    expect(run.status, run.stderr || run.stdout).toBe(0);
    startedContainer = true;
    for (let i = 0; i < 20; i++) {
      const running = docker(['inspect', '-f', '{{.State.Running}}', CONTAINER], { timeout: 10_000 });
      if (running.stdout.trim() === 'true') break;
      await sleep(250);
    }

    const origin = `http://${doorIp}:${DOOR_PORT}/t/${sessionId}`;
    const script = await dockerExec([
      'curl', '-fsS', '--connect-timeout', '5', '--max-time', '10',
      `${origin}/install.sh`
    ]);
    expect(script.status, script.stderr || script.stdout).toBe(0);
    expect(script.stdout).toContain('docker-session-pair');

    const enroll = await dockerExec([
      'curl', '-fsS', '-X', 'POST',
      '-H', 'content-type: application/json',
      '-d', '{"hostName":"zcc-docker"}',
      `${origin}/internal/hosts/enroll`
    ]);
    expect(enroll.status, enroll.stderr || enroll.stdout).toBe(0);
    expect(JSON.parse(enroll.stdout)).toMatchObject({
      hostId: '44444444-4444-4444-8444-444444444444'
    });

    const join = await dockerExec([
      'zcc-join',
      '--join-code', 'zcde_docker_e2e',
      '--host-id', '44444444-4444-4444-8444-444444444444',
      '--server', origin
    ]);
    expect(join.status, join.stderr || join.stdout).toBe(0);
    expect(join.stdout + join.stderr).toContain('docker-session-pair');
  }, 360_000);
});
