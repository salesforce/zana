import { readFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../..');

function read(rel: string): string {
  return readFileSync(join(dir, rel), 'utf8');
}

describe('docker remote machine', () => {
  it('is a Linux box with Node 22, SSH, zcc-join, and a sample workspace', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/FROM node:22-bookworm-slim/);
    expect(dockerfile).toContain('openssh-server');
    expect(dockerfile).toContain("echo 'zcc:zcc'");
    expect(dockerfile).toContain('zcc-join');
    expect(dockerfile).toContain('COPY workspace/');

    const compose = read('compose.yaml');
    expect(compose).toContain('hostname: zcc-docker');
    expect(compose).toContain('host.docker.internal:host-gateway');
    expect(compose).toContain('zcc-machines:/home/zcc/.zcc-machines');
    expect(compose).toContain('network_mode: bridge');
    expect(compose).toContain('ZCC_DOCKER_SSH_PORT:-2222}:22');

    const joinScript = read('zcc-join');
    expect(joinScript).toContain('--join-code');
    expect(joinScript).toContain('--host-id');
    expect(joinScript).toContain('/install.sh');
    expect(joinScript).toContain('runuser -u zcc');
    const joinHelp = spawnSync('sh', [join(dir, 'zcc-join')], { encoding: 'utf8' });
    expect(joinHelp.status).toBe(2);
    expect(joinHelp.stderr).toContain('--join-code');

    const entry = read('entrypoint.sh');
    expect(entry).toContain('chown zcc:zcc');
    expect(entry).toContain('zcc-join');
    expect(entry).toContain('reconnect');
    expect(entry).toContain('sleep infinity');
    expect(entry).not.toMatch(/cat \$\{?found/);

    expect(read('workspace/sample-app/src/index.js')).toContain('zcc-docker');
    expect(existsSync(join(dir, 'workspace/README.txt'))).toBe(true);
  });

  it('exposes play commands from the repo-root package and helper', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['docker:remote-machine']).toContain('docker-remote-machine.sh');
    expect(pkg.scripts['docker:host-daemon']).toContain('--join');
    expect(pkg.scripts['docker:remote-machine:down']).toContain(' down');

    const helper = join(repoRoot, 'scripts/docker-remote-machine.sh');
    chmodSync(helper, 0o755);
    const help = spawnSync('bash', [helper, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--relay');
    expect(help.stdout).toContain('--local');
    expect(help.stdout).toContain('--join-code');
    expect(readFileSync(helper, 'utf8')).toContain('DOOR=auto');
    expect(help.stdout).toContain('ssh -p');

    const missingHost = spawnSync('bash', [helper, '--join-code', 'zcde_test'], { encoding: 'utf8' });
    expect(missingHost.status).toBe(2);
    expect(missingHost.stderr).toContain('--host-id');
  });
});
