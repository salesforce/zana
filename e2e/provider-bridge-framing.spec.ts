import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

const INPUT = `framing-start ${'é🙂'.repeat(48_000)} framing-end`;
const REPLY_PREFIX = 'The large framed turn reached the built provider.';
const REPLY = `${REPLY_PREFIX} ${'é🙂'.repeat(4_000)} framed-output-end`;
const FRAME_CAP_BYTES = 64 * 1024 * 1024;

interface RecordingEntry { dir: string; line: string; seq: number; run: number }

function recordingLane(root: string, direction: string): RecordingEntry[] {
  if (!existsSync(root)) return [];
  // Product spawns use provider/thread scopes; the direct bundled-worker probe
  // uses a thread scope. Both own isolated, finite recording directories.
  return readdirSync(root, { recursive: true }).map(String)
    .filter(file => basename(file) === `${direction}.ndjson`)
    .flatMap(file => readFileSync(join(root, file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test.use({
  initialConfig: { sponsorPromptDismissed: true, providerBridgeRecordingEnabled: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'fixture-bin');
    mkdirSync(bin);
    const shellInit = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), shellInit);
    const fixture = fileURLToPath(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url));
    const script = join(home, 'codex-framing-script.json');
    writeFileSync(script, JSON.stringify({
      // Discovery and resumed turns can use separate app-server processes.
      // This fixture tests framing, so keep its advertised model stable.
      modelId: 'framing-fixture-model',
      requestLogPath: join(home, 'codex-framing-requests.log'), messageText: REPLY,
      processLogPath: join(home, 'codex-framing-process.log'),
    }));
    writeFileSync(join(bin, 'codex'), `#!${process.execPath}\n
if (process.argv.includes('--version')) { console.log('codex-cli 0.153.4'); process.exit(0); }
if (!process.argv.includes('app-server')) process.exit(64);
process.argv = [process.execPath, ${JSON.stringify(fixture)}, ${JSON.stringify(script)}];
import(${JSON.stringify(new URL('../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs', import.meta.url).href)});
`, { mode: 0o700 });
    writeFileSync(join(bin, 'opencode'), `#!${process.execPath}\n
if (process.argv.includes('--version')) { console.log('opencode 1.18.10'); process.exit(0); }
if (!process.argv.includes('acp')) process.exit(64);
process.env.FAKE_ACP_LAUNCH_LOG = ${JSON.stringify(join(home, 'acp-framing-launch.log'))};
process.env.FAKE_ACP_MODEL_CONFIG = '1';
await import(${JSON.stringify(new URL('../plugins/provider-acp/src/bridge/fake-acp-agent.mjs', import.meta.url).href)});
const { writeFileSync } = await import('node:fs');
process.removeAllListeners('SIGTERM');
process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(join(home, 'acp-framing-signal.log'))}, 'SIGTERM'); });
`, { mode: 0o700 });
    await use({ PATH: `${bin}:${process.env.PATH ?? ''}`, ZDOTDIR: home, ZCC_PROVIDER_BRIDGE_RECORD_DIR: join(home, 'framing-recordings') });
  },
});

test('recording preserves large UTF-8 provider output, resumed turns, and app shutdown', async ({ app }) => {
  test.setTimeout(120_000);
  const root = join(app.home, 'framing-project');
  mkdirSync(root);
  const threadId = await app.window.evaluate(async ({ path, input }) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'codex', input, permissionMode: 'full' }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, { path: root, input: INPUT });
  await app.window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const timeline = app.window.getByTestId('thread-timeline');
  await expect(timeline).toContainText(REPLY_PREFIX, { timeout: 30_000 });
  if (await timeline.getByText(REPLY, { exact: true }).count() === 0) await timeline.getByRole('button', { name: 'Show more', exact: true }).last().click();
  await expect(timeline).toContainText(REPLY);
  const requests = () => {
    const log = join(app.home, 'codex-framing-requests.log');
    return existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      : [];
  };
  await expect.poll(() => requests().filter(row => row.method === 'turn/start').length).toBe(1);
  const nativeInput = requests().find(row => row.method === 'turn/start').params.input;
  expect(nativeInput.some((item: { type: string; text?: string }) => item.type === 'text' && item.text?.includes(INPUT))).toBe(true);

  // The fake app-server completes before acknowledging turn/start. Its late
  // session acknowledgement must preserve idle, so follow up after settlement.
  await expect.poll(() => app.window.evaluate(async id =>
    (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, threadId)).toBe('idle');
  await expect(app.window.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  const composer = app.window.getByTestId('thread-command-input');
  await composer.fill('Following framed turn');
  await composer.press('Enter');
  await expect(timeline.getByText(REPLY_PREFIX, { exact: false })).toHaveCount(2, { timeout: 30_000 });
  if (await timeline.getByText(REPLY, { exact: true }).count() < 2) await timeline.getByRole('button', { name: 'Show more', exact: true }).last().click();
  await expect(timeline.getByText(REPLY, { exact: true })).toHaveCount(2);
  expect(requests().filter(row => row.method === 'turn/start')).toHaveLength(2);
  await expect(app.window.locator('.thread-status-badge.is-error')).toHaveCount(0);

  const recordDir = join(app.home, 'framing-recordings');
  for (const direction of ['runtime→bridge', 'bridge→provider']) {
    await expect.poll(() => recordingLane(recordDir, direction).some(entry => entry.line.includes(INPUT))).toBe(true);
  }
  for (const direction of ['provider→bridge', 'bridge→runtime']) {
    await expect.poll(() => recordingLane(recordDir, direction).filter(entry => entry.line.includes(REPLY)).length).toBeGreaterThanOrEqual(2);
  }
  for (const direction of ['runtime→bridge', 'bridge→provider', 'provider→bridge', 'bridge→runtime']) {
    const entries = recordingLane(recordDir, direction);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.dir).toBe(direction);
      expect(Buffer.byteLength(entry.line)).toBeLessThanOrEqual(FRAME_CAP_BYTES);
      expect(() => JSON.parse(entry.line)).not.toThrow();
    }
  }
  const processLog = readFileSync(join(app.home, 'codex-framing-process.log'), 'utf8');
  const ownedPids = [...new Set(processLog.trim().split('\n').filter(line => line.startsWith('spawn:')).flatMap(line => line.split(':').slice(1).map(Number)))];
  expect(ownedPids.length).toBeGreaterThan(0);
  expect(ownedPids.every(pid => Number.isSafeInteger(pid) && pid > 0)).toBe(true);
  await app.electron.close();
  await expect.poll(() => ownedPids.filter(processAlive), { timeout: 10_000 }).toEqual([]);
  const files = readdirSync(recordDir, { recursive: true }).filter(file => String(file).endsWith('.ndjson')).map(file => join(recordDir, String(file)));
  const sizes = files.map(file => statSync(file).size);
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(files.map(file => statSync(file).size)).toEqual(sizes);
  rmSync(recordDir, { recursive: true });
  expect(existsSync(recordDir)).toBe(false);
});

test('Stop reaps a SIGTERM-resistant ACP child through the built provider', async ({ app }) => {
  test.setTimeout(120_000);
  const root = join(app.home, 'acp-stop-project');
  mkdirSync(root);
  const threadId = await app.window.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'acp-opencode', model: 'fake/default', input: 'announce-mcp-tool', permissionMode: 'full' }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, root);
  await app.window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const processLog = join(app.home, 'acp-framing-launch.log');
  const pids = () => existsSync(processLog)
    ? readFileSync(processLog, 'utf8').trim().split('\n').map(line => Number(line.split(' ')[1])).filter(pid => Number.isSafeInteger(pid) && pid > 0)
    : [];
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    await expect(app.window.getByTestId('thread-timeline')).toContainText('MCP: tool', { timeout: 30_000 });
    expect(pids().some(alive)).toBe(true);
    await app.window.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(() => existsSync(join(app.home, 'acp-framing-signal.log')), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => pids().filter(alive), { timeout: 10_000 }).toEqual([]);
  } finally {
    for (const pid of pids().filter(alive)) process.kill(pid, 'SIGKILL');
  }
});

test('built utility worker discards over-cap recording frames, recovers, and cleans scoped resources', async ({ app }) => {
  test.setTimeout(120_000);
  const root = join(app.home, 'recording-worker-probe');
  const recordDir = join(root, 'recordings');
  const scratch = join(root, 'tmp');
  mkdirSync(scratch, { recursive: true });
  const worker = join(root, 'worker.mjs');
  const buildRoot = process.env.ZCC_E2E_APP_ROOT ?? fileURLToPath(new URL('../', import.meta.url));
  // Snapshot the production bootstrap, rather than executing a TS source or
  // importing a mocked splitter. It runs as a real child of an Electron utility.
  copyFileSync(join(buildRoot, 'apps/host-daemon/dist/zcc-provider-bridge-worker.mjs'), worker);
  const bridge = join(root, 'probe-bridge.mjs');
  const contextFile = join(root, 'context.json');
  const marker = 'recovered-recording-é🙂';
  const request = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'probe', params: { threadId: 'recording-probe' } });
  const reply = JSON.stringify({ jsonrpc: '2.0', id: 7, result: marker });
  writeFileSync(bridge, `
import { writeFileSync } from 'node:fs';
export const experimental_providerBridge = {
  experimental_apiVersion: 1,
  start(context) { writeFileSync(${JSON.stringify(contextFile)}, JSON.stringify(context)); },
  handleLine(line) {
    const request = JSON.parse(line);
    if (request.id !== 7) throw new Error('Oversized frame reached bridge');
    // One write contains both an oversized line and the following valid line.
    process.stdout.write(Buffer.concat([Buffer.alloc(${FRAME_CAP_BYTES + 1}, 'x'), Buffer.from(${JSON.stringify(`\n${reply}\n`)})]));
  }
};
`);
  const utility = join(root, 'probe-utility.mjs');
  writeFileSync(utility, `
import { spawn } from 'node:child_process';
const child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(worker)}, ${JSON.stringify(bridge)}, 'recording-probe', ${JSON.stringify(root)}], {
  cwd: ${JSON.stringify(root)}, env: { ...process.env, TMPDIR: ${JSON.stringify(scratch)}, TMP: ${JSON.stringify(scratch)}, TEMP: ${JSON.stringify(scratch)}, ZCC_PROVIDER_BRIDGE_RECORD_DIR: ${JSON.stringify(recordDir)} }, stdio: ['pipe', 'pipe', 'pipe'],
});
process.parentPort.postMessage({ kind: 'child', pid: child.pid });
let stdoutBytes = 0;
let tail = Buffer.alloc(0);
let stderr = '';
let spawnError;
let stdinError;
// Await actual close even after a spawn/pipe error, so catch cannot leave a
// still-closing child behind. Writable errors may emit independently of the
// write callback, including after the final successful callback.
const closed = new Promise(resolve => {
  child.once('error', error => { spawnError = error; });
  child.once('close', (code, signal) => resolve({ code, signal }));
});
child.stdin.on('error', error => { stdinError ??= error; child.kill('SIGKILL'); });
child.stdout.on('data', chunk => {
  stdoutBytes += chunk.length;
  tail = Buffer.concat([tail, chunk]).subarray(-65536);
});
child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-65536); });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 30000);
const write = async chunk => {
  if (spawnError || stdinError) throw spawnError || stdinError;
  await new Promise((resolve, reject) => child.stdin.write(chunk, error => error ? reject(error) : resolve()));
  if (spawnError || stdinError) throw spawnError || stdinError;
};
try {
  // The bootstrap's real stdin reader must drop this line before the recorder
  // sees it, then accept the next request from the same final write.
  const chunk = Buffer.alloc(65536, 'x');
  for (let i = 0; i < ${FRAME_CAP_BYTES / 65536}; i++) await write(chunk);
  await write(Buffer.from(${JSON.stringify(`x\n${request}\n`)}));
  child.stdin.end();
  const exit = await closed;
  if (spawnError || stdinError) throw spawnError || stdinError;
  process.parentPort.postMessage({ kind: 'result', ...exit, timedOut, stdoutBytes, tail: tail.toString('utf8'), stderr });
} catch (error) {
  child.kill('SIGKILL');
  await closed;
  const failure = [...new Set([spawnError, stdinError, error].filter(Boolean).map(String))].join('; ');
  process.parentPort.postMessage({ kind: 'result', error: failure, timedOut, stdoutBytes, stderr });
} finally {
  clearTimeout(timer);
  setTimeout(() => process.exit(0), 25);
}
`);
  const result = await app.electron.evaluate(({ utilityProcess }, utilityPath) => new Promise<{
    code: number; signal: string | null; timedOut: boolean; stdoutBytes: number; tail: string; stderr: string; error?: string; workerPid: number;
  }>((resolve, reject) => {
    const child = utilityProcess.fork(utilityPath, [], { stdio: ['ignore', 'pipe', 'pipe'], serviceName: 'recording-framing-probe' });
    let workerPid = 0;
    let result: Record<string, unknown> | undefined;
    let diagnostics = '';
    child.stderr?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-65536); });
    const timer = setTimeout(() => {
      if (workerPid > 0) { try { process.kill(workerPid, 'SIGKILL'); } catch {} }
      child.kill();
      reject(new Error(`Recording utility exceeded deadline: ${diagnostics}`));
    }, 35000);
    child.on('message', message => {
      if (message?.kind === 'child' && Number.isSafeInteger(message.pid) && message.pid > 0) workerPid = message.pid;
      if (message?.kind === 'result') result = message;
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (!result || code !== 0) {
        if (workerPid > 0) { try { process.kill(workerPid, 'SIGKILL'); } catch {} }
        reject(new Error(`Recording utility exited ${code}: ${String(result?.error ?? '')} ${diagnostics}`));
      } else resolve({ ...result, workerPid } as never);
    });
  }), utility);
  expect(result.error, result.stderr).toBeUndefined();
  expect(Number.isSafeInteger(result.workerPid) && result.workerPid > 0).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stderr).toContain('Discarded an oversized JSON-RPC line from the runtime');
  expect(result.stdoutBytes).toBe(FRAME_CAP_BYTES + 2 + Buffer.byteLength(`${reply}\n`));
  expect(result.tail.endsWith(`${reply}\n`)).toBe(true);
  const incoming = recordingLane(recordDir, 'runtime→bridge');
  const outgoing = recordingLane(recordDir, 'bridge→runtime');
  expect(incoming.map(entry => entry.line)).toEqual([request]);
  expect(outgoing.map(entry => entry.line)).toEqual([reply]);
  expect(outgoing[0].dir).toBe('bridge→runtime');
  const context = JSON.parse(readFileSync(contextFile, 'utf8')) as { tempDir: string; dataDir: string; pluginId: string };
  expect(context.dataDir).toBe(root);
  expect(context.pluginId).toBe('recording-probe');
  expect(context.tempDir.startsWith(`${scratch}/`)).toBe(true);
  expect(existsSync(context.tempDir)).toBe(false);
  expect(readdirSync(scratch)).toEqual([]);
  expect(processAlive(result.workerPid)).toBe(false);
  // Process exit closes every recorder fd; retained diagnostic files can now
  // be removed without any subsequent writer recreating them.
  rmSync(recordDir, { recursive: true });
  expect(existsSync(recordDir)).toBe(false);
});


test('native Codex questions reach the renderer and return selected labels and free text', async ({ app }) => {
  const root = join(app.home, 'question-project'); mkdirSync(root);
  const responseLogPath = join(app.home, 'codex-question-responses.jsonl');
  writeFileSync(join(app.home, 'codex-framing-script.json'), JSON.stringify({
    modelId: 'framing-fixture-model', responseLogPath,
    turns: [[
      { method: 'turn/started', params: { threadId: 'codex-thread', turn: { id: 'native-turn', status: 'inProgress' } } },
      { kind: 'request', method: 'item/tool/requestUserInput', params: {
        threadId: 'codex-thread', turnId: 'native-turn', itemId: 'native-item', isBlocking: true, autoResolutionMs: null,
        questions: [
          { id: 'environment', header: 'Environment', question: 'Which environment?', options: [{ label: 'Staging', description: 'Test first' }, { label: 'Production', description: 'Release' }] },
          { id: 'notes', header: 'Notes', question: 'Release notes?' }
        ]
      } },
      { method: 'turn/completed', params: { threadId: 'codex-thread', turn: { id: 'native-turn', status: 'completed' } } }
    ]]
  }));
  const id = await app.window.evaluate(async root => {
    const project = await window.cc.projects.add(root); if (!project.ok) throw Error(project.message);
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'codex', input: 'Ask a native question', permissionMode: 'full' }) });
    const body = await response.json(); if (!response.ok) throw Error(JSON.stringify(body)); return body.thread.id;
  }, root);
  await app.window.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, id);
  await app.window.getByRole('button', { name: /Staging/ }).click();
  await app.window.getByRole('button', { name: 'Next', exact: true }).click();
  await app.window.getByLabel('Release notes?').fill('Ship after review');
  await app.window.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect.poll(() => existsSync(responseLogPath) ? readFileSync(responseLogPath, 'utf8').trim() : '').not.toBe('');
  const answers = readFileSync(responseLogPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(answers).toContainEqual(expect.objectContaining({ result: { answers: { environment: { answers: ['Staging'] }, notes: { answers: ['Ship after review'] } } } }));
  await expect.poll(() => app.window.evaluate(async id => (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status, id)).toBe('idle');
});
