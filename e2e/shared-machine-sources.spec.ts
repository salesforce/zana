import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';
import { stubOpenDialog, stubNativeDialogs } from './sdk/native-dialog.js';
import { test, expect, launchApp } from './fixtures/app.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { Page } from '@playwright/test';

async function request(page: Page, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return page.evaluate(async ({ path, body, method }) => {
    const response = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, body, method });
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 2000);
  await exited; clearTimeout(timer);
}

function fixturePdf() {
  const stream = 'BT /F1 12 Tf 20 80 Td (Original machine PDF) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('one built Zana shares a project across two real daemon processes and two clients', async ({ home }) => {
  test.setTimeout(240_000);
  const rootA = join(home, 'checkout-a'), rootB = join(home, 'execution-machine', 'checkout-b');
  mkdirSync(rootA, { recursive: true }); mkdirSync(rootB, { recursive: true });
  writeFileSync(join(rootA, 'owner.txt'), 'machine-a'); writeFileSync(join(rootB, 'owner.txt'), 'machine-b');
  const largeHead = 'source-scoped large Git blob\n'.repeat(1800);
  for (const root of [rootA, rootB]) {
    writeFileSync(join(root, 'large.txt'), largeHead);
    writeFileSync(join(root, 'image.png'), Buffer.from('iVBORw0KGgo=', 'base64'));
    for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']]) {
      expect(spawnSync('git', args, { cwd: root, encoding: 'utf8' }).status).toBe(0);
    }
  }
  const canonicalLibraryContent = 'Canonical project knowledge belongs to the original owner.\n'.repeat(20_000);
  for (const root of [rootA, rootB]) mkdirSync(join(root, '.zcc/library'), { recursive: true });
  writeFileSync(join(rootA, '.zcc/library/canonical.txt'), canonicalLibraryContent);
  writeFileSync(join(rootB, '.zcc/library/canonical.txt'), 'shadow metadata must never be selected');
  writeFileSync(join(rootA, '.zcc/library/index.json'), JSON.stringify({ version: 1, docs: [{ id: 'stable-shared-document', relPath: 'canonical.txt', title: 'Shared knowledge', summary: 'One document across all machines', tags: ['shared'], kind: 'other', createdAt: 1, updatedAt: 2, bytes: Buffer.byteLength(canonicalLibraryContent), source: { kind: 'agent' } }] }));
  const fixture = join(home, 'machine-plugin'); mkdirSync(fixture);
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: '@zcc-ext/machine-proof', version: '1.0.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Machine proof', description: 'Multi-machine fixture', branding: { icon: 'Cpu' }, server: './server.mjs', host: './host.mjs' } }));
  writeFileSync(join(fixture, 'server.mjs'), `export default async function(zcc) {
    const host = await zcc.host.experimental_client();
    zcc.rpc.method('probe', async args => {
      const result = await host.call('probe', args, { hostId: args.hostId });
      const count = (await zcc.storage.kv.get('count') ?? 0) + 1;
      await zcc.storage.kv.set('count', count); return { ...result, count };
    });
  }`);
  writeFileSync(join(fixture, 'host.mjs'), `import { experimental_defineHostEntry, defineRpcContract } from '@zana-ai/zcc-plugin-sdk/host';
    import { homedir } from 'node:os';
    import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
    const root = homedir();
    const any = { '~standard': { version: 1, vendor: 'fixture', validate: value => ({ value }) } };
    export default experimental_defineHostEntry({
      contract: defineRpcContract({ probe: { input: any, output: any } }),
      dispose: () => writeFileSync(join(root, 'plugin-disposed'), 'yes'),
      handlers: { probe: input => {
        writeFileSync(join(root, 'plugin-marker'), input.marker);
        return { root, pid: process.pid, text: 'plugin-large-output'.repeat(3000) };
      } }
    });`);
  await buildPluginHost(fixture, '2.3.0');
  const app = await launchApp(home);
  let appStderr = '';
  app.electron.process().stderr?.on('data', chunk => { appStderr = (appStderr + String(chunk)).slice(-32_768); });
  let child: ChildProcess | undefined;
  try {
    const registered = await app.window.evaluate(path => window.cc.projects.add(path), rootA);
    const projectId = (registered as any).value.id;
    await expect.poll(async () => (await request(app.window, '/hosts')).body.some((host: any) => host.isPrimary && host.status === 'connected')).toBe(true);
    const primary = (await request(app.window, '/hosts')).body.find((host: any) => host.isPrimary);
    const grant = (await request(app.window, '/hosts/join-codes', {})).body;
    expect(grant.hostId).toBeTruthy();
    const origin = new URL(app.window.url()).origin;
    const artifactResponse = await fetch(`${origin}/install/zcc-host.tgz`);
    expect(artifactResponse.status).toBe(200);
    const artifact = Buffer.from(await artifactResponse.arrayBuffer());
    expect(artifact.byteLength).toBeLessThan(256 * 1024 * 1024);
    const unpack = join(home, 'packed-daemon'); mkdirSync(unpack);
    const archive = join(home, 'daemon.tgz'); writeFileSync(archive, artifact, { mode: 0o600 });
    expect(spawnSync('tar', ['-xzf', archive, '-C', unpack]).status).toBe(0);
    const machineHome = join(home, 'execution-machine');
    let stderr = '';
    child = spawn(process.execPath, [join(unpack, 'join.mjs'), 'join', '--join-code', grant.joinCode, '--host-id', grant.hostId, '--server-url', origin, '--host-daemon-port', String(await unusedPort())], {
      detached: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH, HOME: machineHome, ZCC_DATA_DIR: join(machineHome, '.zcc-machines', 'fixture'), SHELL: '/bin/sh' }
    });
    child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_384); });
    await expect.poll(async () => (await request(app.window, '/hosts')).body.find((host: any) => host.id === grant.hostId)?.status, { timeout: 30_000, message: 'packed execution daemon must authenticate' }).toBe('connected');
    expect(child.exitCode, stderr).toBeNull();
    const source = await request(app.window, `/projects/${projectId}/sources`, { hostId: grant.hostId, path: rootB });
    expect(source.status).toBe(201);
    const sourceId = source.body.project.sources.find((row: any) => row.hostId === grant.hostId).id;
    for (const [root, branch] of [[rootA, 'primary-only'], [rootB, 'secondary-only']]) {
      expect(spawnSync('git', ['branch', branch], { cwd: root, encoding: 'utf8' }).status).toBe(0);
    }
    const defaultBranches = await request(app.window, `/projects/${projectId}/branches`);
    expect(defaultBranches.status, JSON.stringify(defaultBranches.body)).toBe(200);
    expect(defaultBranches.body.branches).toContain('primary-only');
    expect(defaultBranches.body.branches).not.toContain('secondary-only');
    const selectedBranches = await request(app.window, `/projects/${projectId}/branches?hostId=${grant.hostId}`);
    expect(selectedBranches.status).toBe(200);
    expect(selectedBranches.body.branches).toContain('secondary-only');
    expect(selectedBranches.body.branches).not.toContain('primary-only');
    const opened = app.electron.waitForEvent('window');
    await app.electron.evaluate(({ BrowserWindow }, url) => {
      const client = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      void client.loadURL(url);
    }, app.window.url());
    const browser = await opened; await browser.waitForLoadState('domcontentloaded');
    expect(await browser.evaluate(() => typeof window.cc)).toBe('undefined');
    const sources = (await request(browser, `/projects/${projectId}/sources`)).body.sources;
    expect(sources.map((row: any) => row.hostId).sort()).toEqual([primary.id, grant.hostId].sort());
    // Until CLI profiles have a secondary-host backend, explicit remote launch
    // must fail before the primary's local PTY coordinator sees it.
    const cli = await request(browser, '/shared-product', { method: 'terminals.create', args: [{ projectId, hostId: grant.hostId, profile: 'shell', cwd: rootA }] });
    expect(cli.body.value).toMatchObject({ ok: false, code: 'HOST_UNSUPPORTED' });
    for (const [hostId, folder, marker] of [[primary.id, rootA, 'machine-a'], [grant.hostId, rootB, 'machine-b']]) {
      const root = realpathSync(folder);
      const read = await request(browser, '/fs/read', { path: join(root, 'owner.txt'), scope: { projectId, hostId } });
      expect(read.body).toMatchObject({ ok: true, content: marker });
      const head = await request(browser, '/git', { operation: 'head', path: join(root, 'large.txt'), scope: { projectId, hostId } });
      expect(head.body).toEqual({ ok: true, content: largeHead });
      const image = await request(browser, '/fs/image', { path: join(root, 'image.png'), scope: { projectId, hostId } });
      expect(image.body.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
      const edit = { operation: 'write', path: join(root, 'owner.txt'), scope: { projectId, hostId }, content: `${marker}-edited`, expectedSha256: read.body.sha256 };
      expect((await request(browser, '/fs/mutate', edit)).body.ok).toBe(true);
      expect(readFileSync(join(root, 'owner.txt'), 'utf8')).toBe(`${marker}-edited`);
      expect((await request(app.window, '/fs/mutate', edit)).body).toMatchObject({ ok: false, message: expect.stringContaining('changed') });
      const newPath = join(root, 'created.txt');
      expect((await request(browser, '/fs/mutate', { operation: 'create-file', path: newPath, scope: { projectId, hostId } })).body.ok).toBe(true);
      expect((await request(browser, '/fs/mutate', { operation: 'rename', path: newPath, destination: `${newPath}.moved`, scope: { projectId, hostId } })).body.ok).toBe(true);
      expect((await request(browser, '/fs/mutate', { operation: 'delete', path: `${newPath}.moved`, scope: { projectId, hostId } })).body.ok).toBe(true);
      const started = await request(browser, '/terminals', { projectId, hostId, profile: 'shell', command: 'pwd > execution-marker.txt; sleep 30' });
      expect(started.status, JSON.stringify(started.body)).toBe(201);
      expect(started.body.value.hostId).toBe(hostId);
      await expect.poll(() => existsSync(join(root, 'execution-marker.txt'))).toBe(true);
      expect(readFileSync(join(root, 'execution-marker.txt'), 'utf8').trim()).toBe(root);
      if (hostId === grant.hostId) {
        const busy = await request(browser, `/projects/${projectId}/sources/${sourceId}`, undefined, 'DELETE');
        expect(busy.status).toBe(409);
      }
      expect((await request(browser, `/terminals/${started.body.value.id}/close`, {})).status).toBe(200);
      const fast = await request(browser, '/terminals', { projectId, hostId, profile: 'shell', command: 'printf fast-exit' });
      expect(fast.status).toBe(201);
      await expect.poll(async () => (await request(browser, `/terminals/${fast.body.value.id}`)).body.session.status).toBe('exited');
      const retained = (await request(browser, `/terminals/${fast.body.value.id}/output`)).body;
      expect(retained.text).toContain('fast-exit');
      expect(retained.endOffset - retained.startOffset).toBe(retained.text.length);
      expect(retained.startOffset).toBe(0);
      // Closing after a natural exit is safe and leaves no daemon ownership leak.
      expect((await request(browser, `/terminals/${fast.body.value.id}/close`, {})).status).toBe(200);
      // The packed daemon must expose a real PTY, including on the secondary
      // host. Pipes can print a marker but cannot support a CLI Agent's TUI.
      writeFileSync(join(root, 'tty-probe.cjs'), `
        console.log('TTY:' + process.stdin.isTTY + ':' + process.stdout.isTTY);
        console.log('OWNER:' + process.cwd() + ':' + process.env.HOME);
        console.log('LARGE:' + 'x'.repeat(25000) + ':COMPLETE');
        process.stdout.on('resize', () => console.log('SIZE:' + process.stdout.columns + ':' + process.stdout.rows));
        process.stdin.on('data', data => console.log('INPUT:' + data.toString().trim()));
        process.on('SIGINT', () => { console.log('INTERRUPTED'); process.exit(130); });
      `);
      const tty = await request(browser, '/terminals', { projectId, hostId, profile: 'shell', command: 'node ./tty-probe.cjs' });
      expect(tty.status, JSON.stringify(tty.body)).toBe(201);
      const terminalPath = `/terminals/${tty.body.value.id}`;
      const output = async () => (await request(browser, `${terminalPath}/output?tailBytes=65536`)).body.text as string;
      await expect.poll(output).toContain('TTY:true:true');
      await expect.poll(output).toContain('LARGE:' + 'x'.repeat(25000) + ':COMPLETE');
      expect(await output()).toContain(`OWNER:${root}:${hostId === grant.hostId ? machineHome : home}`);
      expect((await request(browser, `${terminalPath}/resize`, { cols: 109, rows: 41 })).status).toBe(200);
      await expect.poll(output).toContain('SIZE:109:41');
      expect((await request(browser, `${terminalPath}/input`, { data: 'shared-native-input\r' })).status).toBe(200);
      await expect.poll(output).toContain('INPUT:shared-native-input');
      expect((await request(browser, `${terminalPath}/input`, { data: '\x03' })).status).toBe(200);
      await expect.poll(async () => (await request(browser, terminalPath)).body.session.status).toBe('exited');
      expect(await output()).toContain('INTERRUPTED');
      expect((await request(browser, `${terminalPath}/close`, {})).status).toBe(200);
    }
    // A single plugin installation/KV invokes isolated workers on both machines.
    const invalidFixture = join(home, 'invalid-plugin'); mkdirSync(invalidFixture);
    writeFileSync(join(invalidFixture, 'package.json'), JSON.stringify({ name: '@zcc-ext/invalid-proof', version: '1.0.0', zcc: { name: 'Missing required fields' } }));
    await stubOpenDialog(app.electron, [[invalidFixture], [fixture]]); await stubNativeDialogs(app.electron, [0]);
    const invalidInstall = await app.window.evaluate(() => window.cc.extensions.install({ kind: 'localDir' }));
    expect(invalidInstall).toMatchObject({ ok: false });
    expect(JSON.stringify(invalidInstall)).toContain('description');
    expect(JSON.stringify(invalidInstall)).not.toContain('timed out');
    const installed = await app.window.evaluate(() => window.cc.extensions.install({ kind: 'localDir' }));
    expect(installed, JSON.stringify(installed) + appStderr).toMatchObject({ ok: true, value: { id: 'machine-proof' } });
    for (const [hostId, expectedHome, count] of [[primary.id, home, 1], [grant.hostId, machineHome, 2]] as const) {
      const probe = await request(browser, '/plugin-apps/machine-proof/rpc', { method: 'probe', args: { hostId, marker: String(count) } });
      expect(probe.status, JSON.stringify(probe.body)).toBe(200);
      expect(probe.body.value).toMatchObject({ root: expectedHome, count, text: 'plugin-large-output'.repeat(3000) });
      expect(readFileSync(join(expectedHome, 'plugin-marker'), 'utf8')).toBe(String(count));
    }
    expect(readFileSync(join(home, 'plugin-marker'), 'utf8')).toBe('1');
    expect((await request(browser, '/plugin-apps/machine-proof/rpc', { method: 'probe', args: { hostId: '00000000-0000-4000-8000-000000000000', marker: 'wrong' } })).status).not.toBe(200);
    const removed = await app.window.evaluate(() => window.cc.pluginApps.remove('machine-proof'));
    expect(removed, JSON.stringify(removed) + appStderr).toMatchObject({ ok: true });
    await expect.poll(() => [home, machineHome].every(root => existsSync(join(root, 'plugin-disposed')))).toBe(true);
    // The project fixes Explorer's target, even with extra backend sources.
    const heading = browser.getByTestId('sidebar-projects-heading');
    if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
    await browser.getByRole('button', { name: 'Open checkout-a', exact: true }).click();
    await browser.getByTestId('project-nav-explorer').click();
    await expect(browser.getByRole('combobox', { name: 'Explorer machine' })).toHaveCount(0);
    await expect.poll(() => browser.locator('.explorer-view').evaluate(surface => {
      const body = surface.parentElement!.getBoundingClientRect();
      const explorer = surface.getBoundingClientRect();
      return Math.abs(body.width - explorer.width);
    })).toBeLessThanOrEqual(2);
    await browser.locator('.tree-row.file').filter({ hasText: 'owner.txt' }).click();
    const editor = browser.locator('.explorer-viewer-monaco .monaco-editor');
    await expect(editor).toContainText('machine-a-edited');
    const textbox = editor.getByRole('textbox');
    await textbox.focus(); await textbox.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await browser.keyboard.insertText('machine-a-ui');
    await browser.getByTitle('Save (⌘S)', { exact: true }).click();
    await expect.poll(() => readFileSync(join(rootA, 'owner.txt'), 'utf8')).toBe('machine-a-ui');
    expect(readFileSync(join(rootB, 'owner.txt'), 'utf8')).toBe('machine-b-edited');
    await expect(browser.locator('.explorer-viewer .opener-bar')).toHaveCount(0);
    const library = await request(browser, '/library');
    expect(library.status).toBe(200);
    expect(library.body.docs.find((doc: any) => doc.projectId === projectId && doc.relPath === 'canonical.txt')).toMatchObject({ id: 'stable-shared-document', title: 'Shared knowledge', summary: 'One document across all machines', tags: ['shared'] });
    const knowledge = await request(browser, `/library/content?scope=project&projectId=${projectId}&relPath=canonical.txt&hostId=${grant.hostId}`);
    expect(knowledge.body).toMatchObject({ ok: true, content: canonicalLibraryContent, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const knowledgeEdit = `${canonicalLibraryContent}\nEdited from browser`;
    expect((await request(browser, '/library/documents', { action: 'write', scope: 'project', projectId, relPath: 'canonical.txt', content: knowledgeEdit, expectedSha256: knowledge.body.sha256 })).body.value).toMatchObject({ ok: true });
    expect(readFileSync(join(rootA, '.zcc/library/canonical.txt'), 'utf8')).toBe(knowledgeEdit);
    expect(readFileSync(join(rootB, '.zcc/library/canonical.txt'), 'utf8')).toBe('shadow metadata must never be selected');
    expect(await app.window.evaluate(async ({ id, hash }) => window.cc.library.write('project', 'canonical.txt', 'stale desktop edit', id, hash), { id: projectId, hash: knowledge.body.sha256 })).toMatchObject({ ok: false });
    expect((await request(browser, '/library')).body.docs.find((doc: any) => doc.projectId === projectId && doc.relPath === 'canonical.txt').id).toBe('stable-shared-document');
    expect(await app.window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'monaco-editor' }))).toMatchObject({ ok: true });
    const pluginFile = { path: 'owner.txt', source: { kind: 'workspace', projectId, hostId: grant.hostId, environmentId: null, threadId: null } };
    const pluginRead = await request(browser, '/plugin-apps/monaco-editor/rpc', { method: 'read', args: pluginFile });
    expect(pluginRead.status, JSON.stringify(pluginRead.body)).toBe(200);
    expect(pluginRead.body.value).toMatchObject({ kind: 'text', content: 'machine-b-edited' });
    const pluginSave = { method: 'write', args: { ...pluginFile, content: 'machine-b-plugin', expectedSha256: pluginRead.body.value.sha256 } };
    expect((await request(browser, '/plugin-apps/monaco-editor/rpc', pluginSave)).body.value).toMatchObject({ outcome: 'written' });
    expect((await request(browser, '/plugin-apps/monaco-editor/rpc', pluginSave)).body.value).toMatchObject({ outcome: 'conflict' });
    expect(readFileSync(join(rootB, 'owner.txt'), 'utf8')).toBe('machine-b-plugin');
    expect(readFileSync(join(rootA, 'owner.txt'), 'utf8')).toBe('machine-a-ui');
    symlinkSync(rootA, join(rootB, 'escape'));
    const escaped = await request(browser, '/fs/read', { path: join(realpathSync(rootB), 'escape/owner.txt'), scope: { projectId, hostId: grant.hostId } });
    expect(escaped.body.ok).not.toBe(true);
    const escapedWrite = await request(browser, '/fs/mutate', { operation: 'create-file', path: join(realpathSync(rootB), 'escape/forbidden.txt'), scope: { projectId, hostId: grant.hostId } });
    expect(escapedWrite.body.ok).not.toBe(true);
    expect(existsSync(join(rootA, 'forbidden.txt'))).toBe(false);
    const wrongHost = await request(browser, '/fs/read', { path: join(realpathSync(rootA), 'owner.txt'), scope: { projectId, hostId: grant.hostId } });
    expect(wrongHost.body.ok).not.toBe(true);
    expect((await request(browser, `/projects/${projectId}/sources/${sourceId}`, undefined, 'DELETE')).status).toBe(200);
    expect(existsSync(join(rootB, 'owner.txt'))).toBe(true);
    expect((await request(browser, '/projects')).body.projects.some((project: any) => project.id === projectId)).toBe(true);
    // A foreign metadata owner must not fall through to the desktop filesystem,
    // even when that machine's absolute path happens to exist on this desktop.
    const catalogValues = {
      personas: { id: 'foreign-persona', name: 'Original owner persona', baseProfile: 'shell' },
      teams: { id: 'foreign-team', name: 'Original owner team', slots: [] },
      templates: { id: 'foreign-template', name: 'Original owner template', defaults: { profile: 'shell', every: '1h' } }
    };
    for (const [kind, value] of Object.entries(catalogValues)) {
      mkdirSync(join(rootB, '.zcc', kind), { recursive: true });
      writeFileSync(join(rootB, '.zcc', kind, 'fixture.json'), JSON.stringify(value));
    }
    // The directory picker returns a canonical host path. Match that contract
    // instead of registering macOS's /var alias for its /private/var directory.
    const foreign = await request(browser, '/projects', { path: realpathSync(rootB), hostId: grant.hostId });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(200);
    const foreignId = foreign.body.project.id;
    // A separately registered remote project browses its own checkout without
    // asking the user to select a machine inside Explorer.
    await browser.evaluate(id => {
      history.pushState({}, '', `/projects/${encodeURIComponent(id)}/explorer`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, foreignId);
    await expect(browser.getByRole('combobox', { name: 'Explorer machine' })).toHaveCount(0);
    await browser.locator('.tree-row.file').filter({ hasText: 'owner.txt' }).click();
    await expect(editor).toContainText('machine-b-plugin');
    await editor.getByRole('textbox').focus();
    await editor.getByRole('textbox').press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await browser.keyboard.insertText('machine-b-ui');
    await browser.getByTitle('Save (⌘S)', { exact: true }).click();
    await expect.poll(() => readFileSync(join(rootB, 'owner.txt'), 'utf8')).toBe('machine-b-ui');
    expect(readFileSync(join(rootA, 'owner.txt'), 'utf8')).toBe('machine-a-ui');
    // Deferred Team execution must reject before reading goal sources or
    // reserving workers, even when the foreign path exists on this desktop.
    await app.window.evaluate(async () => {
      await window.cc.config.set({ teamJobLaunchEnabled: true, teamLaunchEnabled: true });
      await window.cc.personas.save({ id: 'deferred-team-worker', name: 'Deferred worker', baseProfile: 'shell' });
      await window.cc.teams.save({ id: 'deferred-team', name: 'Deferred Team',
        slots: [{ personaId: 'deferred-team-worker', quantity: 1 }], orchestratorPersonaId: 'deferred-team-worker' });
    });
    const teamInput = { teamId: 'deferred-team', projectId: foreignId, goal: 'Read plan.md and execute the plan', coordinationMode: 'structured' as const };
    const beforeTeam = await app.window.evaluate(async id => ({
      terminals: await window.cc.terminals.list(id), executions: await window.cc.executionBoard.listProject(id)
    }), foreignId);
    const teamResults = await app.window.evaluate(async input => [
      await window.cc.teams.launch(input.teamId, input.projectId),
      await window.cc.teams.launchAutonomous(input.teamId, input.projectId, input.goal),
      await window.cc.teams.startJob(input)
    ], teamInput);
    for (const result of teamResults) expect(result).toMatchObject({ ok: false, code: 'HOST_UNSUPPORTED', message: expect.stringContaining('primary machine') });
    const browserTeam = await request(browser, '/shared-product', { method: 'teams.startJob', args: [teamInput] });
    expect(browserTeam.body.value).toMatchObject({ ok: false, code: 'HOST_UNSUPPORTED' });
    expect(await app.window.evaluate(async id => ({
      terminals: await window.cc.terminals.list(id), executions: await window.cc.executionBoard.listProject(id)
    }), foreignId)).toEqual(beforeTeam);
    expect(existsSync(join(rootB, '.zana'))).toBe(false);
    const feedFile = join(rootB, '.zcc/activity.jsonl');
    const legacyFeedEvent = { id: 'retained-feed-identity', projectId: foreignId, kind: 'project-created', ts: Date.now(), title: 'Original owner activity', dedupeKey: 'legacy-activity' };
    writeFileSync(feedFile, JSON.stringify(legacyFeedEvent) + '\n');
    const commitOnOwner = (subject: string) => {
      expect(spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', subject], {
        cwd: rootB, encoding: 'utf8', timeout: 5_000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      }).status).toBe(0);
    };
    const ownerSubject = 'Original host history ' + 'x'.repeat(25_000) + ' complete';
    commitOnOwner(ownerSubject);
    const ownerFeed = await request(browser, '/shared-product', { method: 'feed.refresh', args: [foreignId, { limit: 10 }] });
    expect(ownerFeed.body.value.events.some((event: any) => event.kind === 'commit' && event.title === ownerSubject), JSON.stringify({ events: ownerFeed.body.value.events.map((event: any) => ({ kind: event.kind, length: event.title.length, tail: event.title.slice(-100) })), errors: appStderr.split('\n').filter(line => /feed|history/i.test(line)).slice(-10) })).toBe(true);
    expect(ownerFeed.body.value.events).toContainEqual(expect.objectContaining({ id: 'retained-feed-identity', title: 'Original owner activity' }));
    expect(readFileSync(feedFile, 'utf8')).toContain(ownerSubject);
    expect((await app.window.evaluate(id => window.cc.feed.refresh(id, { limit: 10 }), foreignId)).events.some(event => event.title === ownerSubject)).toBe(true);
    // Browser-created registry entries must reach the original desktop's live
    // store too; a manual refresh here would hide a missing runtime push.
    await expect(app.window.getByText('checkout-b', { exact: true }).first()).toBeVisible();
    const catalogMethods = ['personas.list', 'teams.list', 'scheduler.listTemplates'];
    for (const [index, value] of Object.values(catalogValues).entries()) {
      await expect.poll(async () => (await request(browser, '/shared-product', { method: catalogMethods[index], args: [] })).body.value.find((row: any) => row.id === value.id)).toMatchObject({ name: value.name, source: { projectId: foreignId } });
    }
    expect(await app.window.evaluate(() => window.cc.personas.list().then(rows => rows.find(row => row.id === 'foreign-persona')))).toMatchObject({ name: 'Original owner persona' });
    for (const name of ['goals', 'schedules']) expect(existsSync(join(rootB, '.zcc', name))).toBe(false);
    const createdSchedule = await request(browser, '/shared-product', { method: 'scheduler.create', args: [{ name: 'Foreign schedule', profile: 'shell', every: '1h', enabled: false, projectId: foreignId, scope: { projectId: foreignId } }] });
    expect(createdSchedule.body.value, JSON.stringify(createdSchedule.body)).toMatchObject({ ok: true });
    const scheduleId = createdSchedule.body.value.value.id;
    const schedulePath = join(rootB, '.zcc/schedules', `${scheduleId}.json`);
    expect(JSON.parse(readFileSync(schedulePath, 'utf8'))).toMatchObject({ id: scheduleId, projectId: foreignId, enabled: false });
    expect(await app.window.evaluate(id => window.cc.scheduler.update(id, { name: 'Shared schedule edit' }), scheduleId)).toMatchObject({ ok: true });
    expect((await request(browser, '/shared-product', { method: 'scheduler.list', args: [] })).body.value.some((task: any) => task.id === scheduleId && task.name === 'Shared schedule edit')).toBe(true);
    const beforeScheduledRun = await app.window.evaluate(id => window.cc.terminals.list(id), foreignId);
    expect((await request(browser, '/shared-product', { method: 'scheduler.runNow', args: [scheduleId] })).body.value).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(schedulePath, 'utf8')).status.runs[0]).toMatchObject({ result: 'error', launchState: 'failed', message: expect.stringContaining('secondary machines') });
    expect(await app.window.evaluate(id => window.cc.terminals.list(id), foreignId)).toEqual(beforeScheduledRun);
    writeFileSync(schedulePath, JSON.stringify({ ...JSON.parse(readFileSync(schedulePath, 'utf8')), name: 'Schedule owner edit' }));
    // The scheduler re-reads the owner's record at the write boundary and merges
    // the patch onto it (stale in-memory snapshots are not adopted); only an
    // explicit `expectedPrompt` CAS rejects. A name patch therefore wins, on the
    // owner's file only, while owner-edited fields it does not touch survive.
    expect((await request(browser, '/shared-product', { method: 'scheduler.update', args: [scheduleId, { name: 'Merged edit' }] })).body.value).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(schedulePath, 'utf8'))).toMatchObject({ name: 'Merged edit', id: scheduleId, projectId: foreignId });
    expect(existsSync(join(rootA, '.zcc/schedules', `${scheduleId}.json`))).toBe(false);
    const createdGoal = await request(browser, '/shared-product', { method: 'goals.create', args: [{ title: 'Foreign goal', statement: 'Keep metadata on owner', successCriteria: ['owned'], noProgressLimit: 1, projectId: foreignId, scope: { projectId: foreignId } }] });
    expect(createdGoal.body.value, JSON.stringify(createdGoal.body)).toMatchObject({ ok: true });
    const goalId = createdGoal.body.value.value.id;
    const goalPath = join(rootB, '.zcc/goals', `${goalId}.json`);
    expect(JSON.parse(readFileSync(goalPath, 'utf8'))).toMatchObject({ id: goalId, projectId: foreignId, status: 'draft' });
    expect(await app.window.evaluate(id => window.cc.goals.update(id, { title: 'Shared goal edit' }), goalId)).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(goalPath, 'utf8')).title).toBe('Shared goal edit');
    expect((await request(browser, '/shared-product', { method: 'goals.list', args: [] })).body.value.some((goal: any) => goal.id === goalId && goal.title === 'Shared goal edit')).toBe(true);
    const beforeForeignRun = await app.window.evaluate(id => window.cc.terminals.list(id), foreignId);
    expect((await request(browser, '/shared-product', { method: 'goals.setStatus', args: [goalId, 'active'] })).body.value.value).toMatchObject({ status: 'escalated' });
    expect(JSON.parse(readFileSync(goalPath, 'utf8')).history.iterations[0].error).toContain('secondary machines');
    expect(await app.window.evaluate(id => window.cc.terminals.list(id), foreignId)).toEqual(beforeForeignRun);
    writeFileSync(goalPath, JSON.stringify({ ...JSON.parse(readFileSync(goalPath, 'utf8')), title: 'Goal owner edit' }));
    expect((await request(browser, '/shared-product', { method: 'goals.update', args: [goalId, { title: 'Stale overwrite' }] })).body.value).toMatchObject({ ok: false, code: 'UPDATE_FAILED' });
    expect(JSON.parse(readFileSync(goalPath, 'utf8')).title).toBe('Goal owner edit');
    expect(existsSync(join(rootA, '.zcc/goals', `${goalId}.json`))).toBe(false);
    const createdFollowUp = await request(browser, '/shared-product', { method: 'followups.create', args: [{ title: 'Foreign follow-up', projectId: foreignId, scope: { projectId: foreignId } }] });
    expect(createdFollowUp.body.value, JSON.stringify(createdFollowUp.body)).toMatchObject({ ok: true });
    const followUpId = createdFollowUp.body.value.value.id;
    const followUpPath = join(rootB, '.zcc/followups', `${followUpId}.json`);
    expect(JSON.parse(readFileSync(followUpPath, 'utf8'))).toMatchObject({ id: followUpId, projectId: foreignId, title: 'Foreign follow-up' });
    const updatedFollowUp = await app.window.evaluate(async id => window.cc.followups.update(id, { title: 'Shared edit' }), followUpId);
    expect(updatedFollowUp).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(followUpPath, 'utf8')).title).toBe('Shared edit');
    // An out-of-band edit wins over a stale client revision.
    const handEdit = { ...JSON.parse(readFileSync(followUpPath, 'utf8')), title: 'Owner edit' };
    writeFileSync(followUpPath, JSON.stringify(handEdit));
    const conflictFollowUp = await request(browser, '/shared-product', { method: 'followups.update', args: [followUpId, { title: 'Stale overwrite' }] });
    expect(conflictFollowUp.body.value).toMatchObject({ ok: false, code: 'UPDATE_FAILED' });
    expect(JSON.parse(readFileSync(followUpPath, 'utf8')).title).toBe('Owner edit');
    expect(existsSync(join(rootA, '.zcc/followups', `${followUpId}.json`))).toBe(false);
    const localWrite = await app.window.evaluate(id => window.cc.library.write('project', 'canonical.txt', 'wrong owner', id), foreignId);
    expect(localWrite.ok).toBe(false);
    expect(readFileSync(join(rootB, '.zcc/library/canonical.txt'), 'utf8')).toBe('shadow metadata must never be selected');
    await app.window.evaluate(() => {
      (window as any).__libraryLatest = [];
      (window as any).__stopLibrary = window.cc.library.onChanged(docs => { (window as any).__libraryLatest = docs; });
    });
    const createdDoc = await app.window.evaluate(id => window.cc.library.add({ scope: 'project', projectId: id, relPath: 'user.md', title: 'Same document', content: '# Shared note', source: { kind: 'user' } }), foreignId);
    expect(createdDoc).toMatchObject({ title: 'Same document', source: { kind: 'user' } });
    expect(readFileSync(join(rootB, '.zcc/library/user.md'), 'utf8')).toBe('# Shared note');
    const pluginDoc = { scope: 'project', projectId: foreignId, path: 'user.md' };
    const docRead = (await request(browser, '/plugin-apps/docs/rpc', { method: 'read', args: pluginDoc })).body.value;
    expect(docRead).toMatchObject({ ok: true, content: '# Shared note', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const docSave = { method: 'write', args: { ...pluginDoc, content: '# Shared note updated', expectedSha256: docRead.sha256 } };
    expect((await request(browser, '/plugin-apps/docs/rpc', docSave)).body.value).toMatchObject({ ok: true });
    expect((await request(browser, '/plugin-apps/docs/rpc', docSave)).body.value).toMatchObject({ ok: false });
    expect(readFileSync(join(rootB, '.zcc/library/user.md'), 'utf8')).toBe('# Shared note updated');
    expect(existsSync(join(rootA, '.zcc/library/user.md'))).toBe(false);
    expect((await request(browser, '/library/documents', { action: 'update', id: createdDoc!.id, patch: { title: 'Renamed everywhere' } })).body.value).toMatchObject({ title: 'Renamed everywhere' });
    expect((await app.window.evaluate(() => window.cc.library.list())).find(doc => doc.id === createdDoc!.id)?.title).toBe('Renamed everywhere');
    await expect.poll(() => app.window.evaluate(id => (window as any).__libraryLatest.find((doc: any) => doc.id === id)?.title, createdDoc!.id)).toBe('Renamed everywhere');
    expect((await request(browser, '/library/documents', { action: 'createFolder', scope: 'project', projectId: foreignId, relPath: 'from-browser/nested' })).body.value).toMatchObject({ ok: true });
    expect(await app.window.evaluate(id => window.cc.library.createFolder('project', 'from-desktop', id), foreignId)).toMatchObject({ ok: true });
    expect(existsSync(join(rootB, '.zcc/library/from-browser/nested'))).toBe(true);
    expect(existsSync(join(rootB, '.zcc/library/from-desktop'))).toBe(true);
    expect(existsSync(join(rootA, '.zcc/library/from-browser'))).toBe(false);
    const searched = (await request(browser, '/library/documents', { action: 'search', query: 'shared note updated' })).body.value;
    expect(searched.hits).toEqual([expect.objectContaining({ docId: createdDoc!.id, scope: 'project', preview: '# Shared note updated' })]);
    expect(await app.window.evaluate(() => window.cc.library.search('shared note updated'))).toEqual(searched);
    const libraryLocation = (relPath: string) => ({ scope: 'project', projectId: foreignId, relPath });
    expect((await request(browser, '/library/documents', { action: 'move', from: libraryLocation('user.md'), to: libraryLocation('from-browser/user.md') })).body.value).toMatchObject({ ok: true });
    writeFileSync(join(rootB, '.zcc/library/from-browser/binary.pdf'), Buffer.from([0, 255, 254]));
    const binaryDoc = await app.window.evaluate(id => window.cc.library.add({ scope: 'project', projectId: id, relPath: 'from-browser/binary.pdf', title: 'Binary registration' }), foreignId);
    expect(binaryDoc).toMatchObject({ kind: 'pdf', bytes: 3 });
    expect(await app.window.evaluate(id => window.cc.library.move({ scope: 'project', projectId: id, relPath: 'from-browser' }, { scope: 'project', projectId: id, relPath: 'moved-by-desktop' }), foreignId)).toMatchObject({ ok: true });
    expect((await request(browser, '/library')).body.docs.find((row: any) => row.id === createdDoc!.id)).toMatchObject({ relPath: 'moved-by-desktop/user.md', title: 'Renamed everywhere' });
    expect(readFileSync(join(rootB, '.zcc/library/moved-by-desktop/binary.pdf'))).toEqual(Buffer.from([0, 255, 254]));
    expect(existsSync(join(rootB, '.zcc/library/from-browser'))).toBe(false);
    expect(existsSync(join(rootA, '.zcc/library/moved-by-desktop'))).toBe(false);
    // Move the same binary tree between the original owners on B and A. The
    // browser and native client must retain the document IDs across both moves.
    const crossRoot = { scope: 'project', projectId, relPath: 'transferred-library' };
    expect((await request(browser, '/library/documents', { action: 'move', from: libraryLocation('moved-by-desktop'), to: crossRoot })).body.value).toMatchObject({ ok: true });
    expect(existsSync(join(rootB, '.zcc/library/moved-by-desktop'))).toBe(false);
    expect(readFileSync(join(rootA, '.zcc/library/transferred-library/binary.pdf'))).toEqual(Buffer.from([0, 255, 254]));
    expect((await app.window.evaluate(() => window.cc.library.list())).find(doc => doc.id === createdDoc!.id)).toMatchObject({ projectId, relPath: 'transferred-library/user.md' });
    expect(await app.window.evaluate(({ from, to }) => window.cc.library.move(from, to), { from: { ...crossRoot, scope: 'project' as const }, to: { ...libraryLocation('moved-by-desktop'), scope: 'project' as const } })).toMatchObject({ ok: true });
    expect(existsSync(join(rootA, '.zcc/library/transferred-library'))).toBe(false);
    expect(readFileSync(join(rootB, '.zcc/library/moved-by-desktop/binary.pdf'))).toEqual(Buffer.from([0, 255, 254]));
    expect((await request(browser, '/library/documents', { action: 'deleteEntry', ...libraryLocation('moved-by-desktop') })).body.value).toMatchObject({ ok: true });
    expect(existsSync(join(rootB, '.zcc/library/moved-by-desktop'))).toBe(false);
    expect(await app.window.evaluate(id => window.cc.library.deleteEntry('project', 'from-desktop', id), foreignId)).toMatchObject({ ok: true });
    expect(existsSync(join(rootB, '.zcc/library/from-desktop'))).toBe(false);
    await expect.poll(() => app.window.evaluate(id => (window as any).__libraryLatest.some((doc: any) => doc.id === id), createdDoc!.id)).toBe(false);
    // A native filesystem watcher must invalidate the shared server, not push
    // its own local-only snapshot. Verify the preload-free client sees it too.
    await browser.evaluate(() => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      (window as any).__libraryWatchSocket = socket;
      (window as any).__libraryWatchSawFile = false;
      socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('Library websocket failed'));
      socket.onmessage = event => {
        if (JSON.parse(event.data).type !== 'library:changed') return;
        void fetch('/api/v1/library').then(response => response.json()).then(body => {
          (window as any).__libraryWatchSawFile = body.docs.some((doc: any) => doc.scope === 'global' && doc.relPath === 'watcher-proof.md');
        });
      };
    }));
    mkdirSync(join(home, '.zcc/library'), { recursive: true });
    writeFileSync(join(home, '.zcc/library/watcher-proof.md'), '# Changed outside the application');
    await expect.poll(() => app.window.evaluate(() => (window as any).__libraryLatest.some((doc: any) => doc.scope === 'global' && doc.relPath === 'watcher-proof.md'))).toBe(true);
    await expect.poll(() => browser.evaluate(() => (window as any).__libraryWatchSawFile)).toBe(true);
    await browser.evaluate(() => { (window as any).__libraryWatchSocket.close(); delete (window as any).__libraryWatchSocket; delete (window as any).__libraryWatchSawFile; });
    await app.window.evaluate(() => { (window as any).__stopLibrary(); delete (window as any).__stopLibrary; delete (window as any).__libraryLatest; });
    const foreignManifestPath = join(rootB, '.zcc/library/index.json');
    const foreignManifest = JSON.parse(readFileSync(foreignManifestPath, 'utf8'));
    foreignManifest.docs.push({ id: 'foreign-feed', relPath: 'feed.md', title: 'Original owner feed document', kind: 'md', source: { kind: 'agent' }, createdAt: Date.now(), updatedAt: Date.now() });
    writeFileSync(join(rootB, '.zcc/library/feed.md'), '# Original owner'); writeFileSync(foreignManifestPath, JSON.stringify(foreignManifest));
    expect((await app.window.evaluate(id => window.cc.feed.list(id), foreignId)).events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'library-doc', title: 'Library doc written: Original owner feed document' })]));
    // A project grant is broader than a Library grant. A symlink to a sibling
    // directory on that SAME owner must not widen Library reads or writes.
    mkdirSync(join(rootB, 'private')); writeFileSync(join(rootB, 'private/secret.md'), 'Outside Library');
    symlinkSync(join(rootB, 'private'), join(rootB, '.zcc/library/escape'));
    const escapedRead = await request(browser, `/library/content?scope=project&projectId=${foreignId}&relPath=escape/secret.md`);
    expect(escapedRead.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(escapedRead.body)).not.toContain('Outside Library');
    expect(await app.window.evaluate(id => window.cc.library.read('project', 'escape/secret.md', id), foreignId)).toMatchObject({ ok: false });
    expect(await app.window.evaluate(id => window.cc.library.add({ scope: 'project', projectId: id, relPath: 'escape/new.md', title: 'No', content: 'No' }), foreignId)).toBeNull();
    expect(existsSync(join(rootB, 'private/new.md'))).toBe(false);
    expect(readFileSync(join(rootB, 'private/secret.md'), 'utf8')).toBe('Outside Library');
    rmSync(join(rootB, '.zcc/library/escape'));
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    const pdfBytes = fixturePdf();
    for (const [name, bytes] of [['preview.png', imageBytes], ['preview.pdf', pdfBytes]] as const) {
      writeFileSync(join(rootB, '.zcc/library', name), bytes);
      const asset = (await request(browser, '/library/documents', { action: 'asset', scope: 'project', projectId: foreignId, relPath: name })).body.value;
      expect(asset).toMatchObject({ ok: true, bytes: bytes.length });
      expect(Buffer.from(asset.dataUrl.split(',')[1], 'base64')).toEqual(bytes);
      expect(await app.window.evaluate(({ id, name }) => window.cc.library.readAsset('project', name, id), { id: foreignId, name })).toEqual(asset);
      expect(existsSync(join(rootA, '.zcc/library', name))).toBe(false);
    }
    // Real file pickers on each client upload to the canonical owner, including
    // a body larger than the generic product-HTTP JSON limit.
    for (const [page, label, bytes] of [[app.window, 'desktop', pdfBytes], [browser, 'browser', Buffer.alloc(2 * 1024 * 1024, 255)]] as const) {
      await page.evaluate(id => { history.pushState({}, '', `/projects/${id}/docs`); dispatchEvent(new PopStateEvent('popstate')); }, foreignId);
      const name = `${label}-import.${label === 'desktop' ? 'pdf' : 'bin'}`;
      await page.locator('input[type=file][aria-label="Import file into project Library"]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
      await expect.poll(() => existsSync(join(rootB, '.zcc/library', name))).toBe(true);
      await expect(page.getByRole('button', { name: 'Import file into project Library', exact: true })).toBeEnabled();
      expect(readFileSync(join(rootB, '.zcc/library', name))).toEqual(bytes);
      expect(existsSync(join(rootA, '.zcc/library', name))).toBe(false);
      await page.locator('input[type=file][aria-label="Import file into project Library"]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('must not replace') });
      await expect(page.getByText(/Library document already exists/).first()).toBeVisible();
      expect(readFileSync(join(rootB, '.zcc/library', name))).toEqual(bytes);
      const imported = (await request(browser, '/library/documents', { action: 'snapshot' })).body.value.docs.find((doc: any) => doc.projectId === foreignId && doc.relPath === name);
      expect(imported).toMatchObject({ source: { kind: 'user' }, bytes: bytes.length });
      expect((await app.window.evaluate(() => window.cc.library.snapshot())).docs.find(doc => doc.id === imported.id)?.relPath).toBe(name);
      await page.evaluate(() => { history.pushState({}, '', '/plugins/docs/panel'); dispatchEvent(new PopStateEvent('popstate')); });
      const globalName = `${label}-global-import.png`;
      await page.locator('input[type=file][aria-label="Import file into Global Library"]').setInputFiles({ name: globalName, mimeType: 'image/png', buffer: imageBytes });
      await expect.poll(() => existsSync(join(home, '.zcc/library', globalName))).toBe(true);
      await expect(page.getByRole('button', { name: 'Import file into Global Library', exact: true })).toBeEnabled();
      expect(readFileSync(join(home, '.zcc/library', globalName))).toEqual(imageBytes);
      expect(existsSync(join(rootB, '.zcc/library', globalName))).toBe(false);
    }
    // An offline metadata machine must not make the other Library roots vanish.
    // Observe the actual UI and native push, then restart the same enrolled daemon.
    await app.window.evaluate(() => {
      (window as any).__availability = null;
      (window as any).__stopAvailability = window.cc.library.onSnapshotChanged(snapshot => { (window as any).__availability = snapshot; });
    });
    for (const page of [app.window, browser]) {
      await page.evaluate(() => {
        history.pushState({}, '', '/plugins/docs/panel'); dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.locator('.library-panel .explorer-tree-header [title="Refresh"]').click();
      await page.locator('.library-panel .tree-row.dir').filter({ hasText: 'checkout-b' }).click();
      await page.getByRole('button', { name: 'preview.png', exact: true }).click();
      await expect.poll(() => page.locator('.library-image-preview img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
      await page.getByRole('button', { name: 'preview.pdf', exact: true }).click();
      await expect(page.locator('iframe.library-pdf-preview')).toHaveAttribute('src', `data:application/pdf;base64,${pdfBytes.toString('base64')}`);
      expect(await page.locator('webview.library-pdf-preview').count()).toBe(0);
      await page.getByRole('button', { name: 'feed.md', exact: true }).click();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const editor = page.locator('.library-viewer [contenteditable="true"]');
      // Both clients are real Electron windows. Activate this one and clear
      // the editor explicitly before typing so an autofocus/selection race
      // cannot append the draft to the existing document.
      await page.bringToFront();
      await editor.click();
      await expect(editor).toBeFocused();
      await editor.press('ControlOrMeta+A');
      await editor.press('Backspace');
      await expect(editor).toHaveText('');
      const draft = page === browser ? 'Browser draft survives offline' : 'Desktop draft survives offline';
      await editor.fill(draft);
      // Clearing all content resets the block to a paragraph. Restore the
      // fixture's heading explicitly and verify its serialized shape below.
      await editor.press('ControlOrMeta+Alt+1');
      await expect(editor.locator('h1')).toHaveText(draft);
      await expect(editor).toHaveText(draft);
    }
    await stop(child);
    await expect.poll(async () => (await request(browser, '/hosts')).body.find((host: any) => host.id === grant.hostId)?.status).not.toBe('connected');
    commitOnOwner('Must stay unseen until the original host reconnects');
    const offlineActivity = { ...legacyFeedEvent, id: 'offline-activity', dedupeKey: 'offline-activity', ts: Date.now(), title: 'Owner activity written while disconnected' };
    writeFileSync(feedFile, readFileSync(feedFile, 'utf8') + JSON.stringify(offlineActivity) + '\n');
    const offlineFeed = await request(browser, '/shared-product', { method: 'feed.refresh', args: [foreignId, { limit: 10 }] });
    expect(offlineFeed.body.value.events.some((event: any) => event.title === ownerSubject)).toBe(true);
    expect(offlineFeed.body.value.events.some((event: any) => event.id === offlineActivity.id)).toBe(false);
    expect(offlineFeed.body.value.events.some((event: any) => event.title === 'Must stay unseen until the original host reconnects')).toBe(false);
    // The daemon is offline but its fixture files remain visible to Electron.
    // A forced native catalogue refresh must retain the last owner snapshot,
    // never read the changed same-named path on this computer.
    for (const [kind, value] of Object.entries(catalogValues)) writeFileSync(join(rootB, '.zcc', kind, 'fixture.json'), JSON.stringify({ ...value, name: value.name + ' updated' }));
    const refreshProject = join(home, 'catalog-refresh'); mkdirSync(refreshProject);
    expect(await app.window.evaluate(path => window.cc.projects.add(path), refreshProject)).toMatchObject({ ok: true });
    for (const [index, value] of Object.values(catalogValues).entries()) {
      expect((await request(browser, '/shared-product', { method: catalogMethods[index], args: [] })).body.value.find((row: any) => row.id === value.id)?.name).toBe(value.name);
    }
    const partial = (await request(browser, '/library/documents', { action: 'snapshot' })).body.value;
    expect(partial).toMatchObject({ complete: false, roots: expect.arrayContaining([expect.objectContaining({ projectId: foreignId, hostId: grant.hostId, state: 'offline' })]) });
    expect(partial.docs.some((doc: any) => doc.id === 'stable-shared-document')).toBe(true);
    expect(partial.docs.some((doc: any) => doc.id === 'foreign-feed')).toBe(false);
    expect(await app.window.evaluate(() => window.cc.library.list().then(() => false, () => true))).toBe(true);
    await expect.poll(() => app.window.evaluate(id => (window as any).__availability?.roots.find((root: any) => root.projectId === id)?.state, foreignId)).toBe('offline');
    for (const page of [app.window, browser]) await expect(page.getByTestId('library-availability')).toContainText('storage machine is offline');
    await expect(browser.locator('.library-viewer [contenteditable="true"]')).toHaveText('Browser draft survives offline');
    await expect(app.window.locator('.library-viewer [contenteditable="true"]')).toHaveText('Desktop draft survives offline');
    await expect(browser.getByTestId('library-document-availability')).toContainText('Reconnect to read or save');
    await browser.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(browser.locator('.library-viewer [contenteditable="true"]')).toHaveText('Browser draft survives offline');
    expect(readFileSync(join(rootB, '.zcc/library/feed.md'), 'utf8')).toBe('# Original owner');
    const availableRead = (await request(browser, '/library/content?scope=global&relPath=watcher-proof.md')).body;
    expect(availableRead.ok).toBe(true);
    expect((await request(browser, '/library/documents', { action: 'write', scope: 'global', relPath: 'watcher-proof.md', expectedSha256: availableRead.sha256, content: '# Edited while another machine was offline' })).body.value).toMatchObject({ ok: true });
    expect((await request(browser, '/library/documents', { action: 'search', query: 'edited while another machine' })).body.value).toMatchObject({ truncated: true, hits: [expect.objectContaining({ scope: 'global' })] });
    const globalDoc = (await request(browser, '/library/documents', { action: 'snapshot' })).body.value.docs.find((doc: any) => doc.scope === 'global' && doc.relPath === 'watcher-proof.md');
    expect(await app.window.evaluate(id => window.cc.library.update(id, { title: 'Accessible metadata' }, { scope: 'global', relPath: 'watcher-proof.md' }), globalDoc.id)).toMatchObject({ title: 'Accessible metadata' });
    child = spawn(process.execPath, [join(unpack, 'join.mjs'), 'join', '--host-id', grant.hostId, '--server-url', origin, '--host-daemon-port', String(await unusedPort())], {
      detached: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH, HOME: machineHome, ZCC_DATA_DIR: join(machineHome, '.zcc-machines', 'fixture'), SHELL: '/bin/sh' }
    });
    child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_384); });
    await expect.poll(async () => (await request(browser, '/hosts')).body.find((host: any) => host.id === grant.hostId)?.status, { timeout: 30_000, message: 'same enrolled daemon reconnects from persisted credentials' }).toBe('connected');
    expect(child.exitCode, stderr).toBeNull();
    for (const [index, value] of Object.values(catalogValues).entries()) {
      await expect.poll(async () => (await request(browser, '/shared-product', { method: catalogMethods[index], args: [] })).body.value.find((row: any) => row.id === value.id)?.name, { timeout: 20_000 }).toBe(value.name + ' updated');
    }
    const reconnectedFeed = (await request(browser, '/shared-product', { method: 'feed.refresh', args: [foreignId, { limit: 10 }] })).body.value.events;
    expect(reconnectedFeed.some((event: any) => event.title === 'Must stay unseen until the original host reconnects')).toBe(true);
    expect(reconnectedFeed).toContainEqual(expect.objectContaining({ id: offlineActivity.id, title: offlineActivity.title }));
    await expect.poll(() => app.window.evaluate(() => (window as any).__availability?.complete)).toBe(true);
    for (const page of [app.window, browser]) await expect(page.getByTestId('library-availability')).toHaveCount(0);
    expect((await request(browser, '/library/documents', { action: 'snapshot' })).body.value.docs.some((doc: any) => doc.id === 'foreign-feed')).toBe(true);
    await browser.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readFileSync(join(rootB, '.zcc/library/feed.md'), 'utf8').trim()).toBe('# Browser draft survives offline');
    await app.window.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(app.window.locator('.library-viewer [contenteditable="true"]')).toHaveText('Desktop draft survives offline');
    expect(readFileSync(join(rootB, '.zcc/library/feed.md'), 'utf8').trim()).toBe('# Browser draft survives offline');
    await app.window.evaluate(() => { (window as any).__stopAvailability(); delete (window as any).__stopAvailability; delete (window as any).__availability; });
    await browser.close();
  } finally { await stop(child); await app.electron.close(); }
});
