import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { startGitDaemon, type GitDaemon } from './fixtures/git-daemon.js';

test('machine projects create, register aliases, clone, and retain registrations through missing folders and reconnect', async ({ app, home }, testInfo) => {
  test.setTimeout(240_000);
  const win = app.window, origin = new URL(win.url()).origin;
  const api = (path: string, body?: unknown) => win.evaluate(async ({ path, body }) => {
    const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
  let child: ChildProcess | undefined, git: GitDaemon | undefined;
  const stop = async () => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => child!.once('close', () => resolve()));
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const timer = setTimeout(() => { try { process.kill(-child!.pid!, 'SIGKILL'); } catch {} }, 2000);
    await exited; clearTimeout(timer);
  };
  try {
    await expect.poll(async () => (await api('/hosts')).body.some((host: any) => host.isPrimary && host.status === 'connected')).toBe(true);
    const grant = (await api('/hosts/join-codes', {})).body;
    const artifact = await fetch(`${origin}/install/zcc-host.tgz`);
    expect(artifact.status).toBe(200);
    const archive = join(home, 'project-daemon.tgz'), unpack = join(home, 'project-daemon');
    writeFileSync(archive, Buffer.from(await artifact.arrayBuffer()), { mode: 0o600 }); mkdirSync(unpack);
    expect(spawnSync('tar', ['-xzf', archive, '-C', unpack]).status).toBe(0);
    const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = (socket.address() as { port: number }).port; await new Promise<void>(resolve => socket.close(() => resolve()));
    const remoteHomePath = join(home, 'project-machine'); mkdirSync(remoteHomePath);
    const remoteHome = realpathSync(remoteHomePath);
    const existingFolder = join(remoteHome, 'existing-on-remote'); mkdirSync(existingFolder);
    mkdirSync(join(remoteHome, '.zcc'));
    const localCatalogue = join(remoteHome, '.zcc', 'projects.json');
    writeFileSync(localCatalogue, JSON.stringify({ version: 1, projects: [{ path: existingFolder, name: 'Existing remote API' }] }));
    let stderr = '';
    const start = (initial: boolean) => {
      child = spawn(process.execPath, [join(unpack, 'join.mjs'), 'join', ...(initial ? ['--join-code', grant.joinCode] : []), '--host-id', grant.hostId, '--server-url', origin, '--host-daemon-port', String(port)], {
        detached: true, stdio: ['ignore', 'ignore', 'pipe'], cwd: remoteHome,
        env: { PATH: process.env.PATH, HOME: remoteHome, ZCC_DATA_DIR: join(remoteHome, '.zcc-machines', 'fixture'), ...(initial ? { ZCC_PROJECT_CATALOGUE_DATA_DIR: join(remoteHome, '.zcc') } : {}), SHELL: '/bin/sh' }
      });
      child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_384); });
    };
    start(true);
    const remote = async () => (await api('/hosts')).body.find((host: any) => host.id === grant.hostId);
    await expect.poll(async () => (await remote())?.status, { timeout: 30_000 }).toBe('connected');
    expect(child!.exitCode, stderr).toBeNull();
    await win.evaluate(async hostId => {
      const response = await fetch(`/api/v1/hosts/${hostId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dev server' }) });
      if (!response.ok) throw new Error('Could not name the fixture machine');
    }, grant.hostId);
    const machineName = (await remote()).name;
    const machine = win.locator(`[data-machine-id="${grant.hostId}"]`);
    await expect(machine).toBeVisible();
    // Connecting alone imports the remote machine's local registered projects.
    await expect(machine.getByRole('button', { name: 'Open Existing remote API', exact: true })).toBeVisible();
    const existingId = (await api('/projects')).body.projects.find((p: any) => p.path === existingFolder).id;
    const liveFolder = join(remoteHome, 'added-outside-viewer'); mkdirSync(liveFolder);
    writeFileSync(localCatalogue, JSON.stringify({ version: 1, projects: [{ path: existingFolder, name: 'Existing remote API' }, { path: liveFolder, name: 'Live remote web' }] }));
    // Daemon invalidation -> server reconciliation -> viewer broadcast, without a manual refresh.
    await expect(machine.getByRole('button', { name: 'Open Live remote web', exact: true })).toBeVisible({ timeout: 30_000 });
    await machine.getByRole('button', { name: `Add project on ${machineName}`, exact: true }).click();
    await win.screenshot({ path: testInfo.outputPath('machine-add-project.png') });
    await win.getByRole('button', { name: /Create new folder/ }).click();
    const create = win.getByRole('dialog', { name: 'Create project folder', exact: true });
    await expect(create.getByRole('textbox', { name: 'Parent folder', exact: true })).toHaveValue(remoteHome);
    await create.getByRole('textbox', { name: 'Folder name' }).fill('../escape');
    await create.getByRole('button', { name: 'Create & add' }).click();
    await expect(create.getByRole('alert')).toBeVisible();
    expect(existsSync(join(home, 'escape'))).toBe(false);
    await create.getByRole('textbox', { name: 'Folder name' }).fill('created-api');
    await create.getByRole('button', { name: 'Create & add' }).click();
    await expect(create).toHaveCount(0);
    const folder = join(remoteHome, 'created-api'); expect(existsSync(folder)).toBe(true);
    expect(existsSync(join(home, 'created-api'))).toBe(false);
    const created = (await api('/projects')).body.projects.find((p: any) => p.path === folder);
    expect(created).toMatchObject({ hostId: grant.hostId, name: 'created-api' });
    // Alias registration must preserve identity and report invalid folders before saving.
    const alias = join(remoteHome, 'api-alias'); symlinkSync(folder, alias);
    expect((await api('/projects', { hostId: grant.hostId, path: alias })).body.project.id).toBe(created.id);
    expect((await api('/projects', { hostId: grant.hostId, path: join(remoteHome, 'absent') })).status).not.toBe(200);
    await machine.getByRole('button', { name: `Add project on ${machineName}`, exact: true }).click();
    await win.getByRole('button', { name: /Clone repository/ }).click();
    git = await startGitDaemon(join(home, 'machine-project-git'), [{ repoName: 'remote-web', files: { 'README.md': 'Remote checkout\n' } }]);
    const clone = win.getByRole('dialog', { name: 'Import from Git', exact: true });
    await clone.getByRole('textbox', { name: 'Repository URL' }).fill(git.urlFor('remote-web'));
    const cloneRoot = (await api(`/projects/clone-root?hostId=${grant.hostId}`)).body.path;
    expect(cloneRoot.startsWith(remoteHome)).toBe(true);
    await expect(clone.locator('.git-dest-preview')).toContainText(join(cloneRoot, 'remote-web'));
    await clone.getByRole('button', { name: 'Clone & add', exact: true }).click();
    await expect(clone).toHaveCount(0, { timeout: 30_000 });
    expect(readFileSync(join(cloneRoot, 'remote-web', 'README.md'), 'utf8')).toBe('Remote checkout\n');
    expect(existsSync(join(home, 'zcc-workspace', 'remote-web'))).toBe(false);
    await expect(machine.getByRole('button', { name: 'Open remote-web', exact: true })).toBeVisible();
    rmSync(folder, { recursive: true });
    await machine.getByRole('button', { name: `Open ${machineName} projects`, exact: true }).click();
    const overview = win.getByRole('dialog', { name: machineName, exact: true });
    await expect(overview.getByText('Folder missing', { exact: true })).toBeVisible();
    await expect(overview.getByRole('status')).toContainText('Last synced');
    await win.screenshot({ path: testInfo.outputPath('machine-folder-missing.png') });
    await stop();
    await expect.poll(async () => (await remote()).status).not.toBe('connected');
    await expect(overview.getByRole('status')).toContainText('Offline · showing saved projects');
    await expect(overview.getByText('Machine offline', { exact: true })).toHaveCount(4);
    expect((await api('/projects')).body.projects.find((p: any) => p.id === created.id)).toBeTruthy();
    const offlineFolder = join(remoteHome, 'registered-offline'); mkdirSync(offlineFolder);
    writeFileSync(localCatalogue, JSON.stringify({ version: 1, projects: [{ path: existingFolder, name: 'Existing remote API' }, { path: liveFolder, name: 'Live remote web' }, { path: offlineFolder, name: 'Registered while offline' }] }));
    mkdirSync(folder); start(false);
    await expect.poll(async () => (await remote()).status, { timeout: 30_000 }).toBe('connected');
    await expect(overview.getByText('Machine offline', { exact: true })).toHaveCount(0);
    await expect(overview.getByText('Folder missing', { exact: true })).toHaveCount(0);
    await expect(machine.getByRole('button', { name: 'Open Registered while offline', exact: true })).toBeVisible();
    const finalProjects = (await api('/projects')).body.projects;
    expect(finalProjects.find((p: any) => p.path === existingFolder).id).toBe(existingId);
    expect(finalProjects.find((p: any) => p.id === created.id).path).toBe(folder);
    expect(new Set(finalProjects.map((p: any) => p.id)).size).toBe(finalProjects.length);
    await win.screenshot({ path: testInfo.outputPath('machine-projects-reconnected.png') });
  } finally { await stop(); await git?.close(); }
});
