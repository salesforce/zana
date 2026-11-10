/**
 * A shell PTY that Electron main owns must carry the project identity the
 * plugin CLIs need, and the self-lookup route must authenticate by session
 * credential. The spec drives a real shell inside the private app, has it dump
 * its environment, run the built `zcc status --json`, and probe
 * `GET /api/v1/sessions/self` with a good and a bad credential.
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

const ZCC_BIN = fileURLToPath(new URL('../packages/cli/dist/bin/zcc', import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const parseEnv = (text: string): Record<string, string> =>
  Object.fromEntries(text.split('\n').filter((line) => line.includes('=')).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));

test('a main-owned shell PTY carries project identity and the self lookup authenticates by session credential', async ({ home }) => {
  test.setTimeout(180_000);
  const port = await freePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const app = await launchApp(home, {
    env: { ZCC_SERVER_PORT: String(port) },
    initialConfig: { sponsorPromptDismissed: true }
  });
  try {
    const win = app.window;
    const projectDir = join(home, 'identity-project');
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id as string;
    }, projectDir);
    const sessionId = await win.evaluate(async (projectId) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'shell', cols: 120, rows: 32 });
      const session = result && 'ok' in result ? result.value : result;
      if (!session?.id) throw new Error(JSON.stringify(result));
      return session.id as string;
    }, projectId);

    const out = join(home, 'identity-out');
    mkdirSync(out, { recursive: true });
    const script = [
      `env | grep '^ZCC_' > ${out}/env.txt`,
      `curl -s -o ${out}/good.json -w '%{http_code}' -H "x-zcc-caller-session-id: $ZCC_SESSION_ID" -H "Authorization: Bearer $ZCC_SESSION_TOKEN" ${serverUrl}/api/v1/sessions/self > ${out}/good.code`,
      `curl -s -o /dev/null -w '%{http_code}' -H "x-zcc-caller-session-id: $ZCC_SESSION_ID" -H "Authorization: Bearer wrong" ${serverUrl}/api/v1/sessions/self > ${out}/bad.code`,
      `curl -s -o /dev/null -w '%{http_code}' ${serverUrl}/api/v1/sessions/self > ${out}/none.code`,
      `env -u ZCC_THREAD_ID ZCC_SERVER_URL=${serverUrl} ZCC_DATA_DIR=${home}/.zcc ${process.execPath} ${ZCC_BIN} status --json > ${out}/status.json 2> ${out}/status.err`,
      `echo done > ${out}/done`
    ].join('; ');
    // Let the login shell reach its prompt before typing; early input can be dropped.
    await win.waitForTimeout(4_000);
    await win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `${script}\r` });
    await expect.poll(() => existsSync(join(out, 'done')), { timeout: 60_000, message: 'shell never finished the probe script' }).toBe(true);

    const env = parseEnv(readFileSync(join(out, 'env.txt'), 'utf8'));
    expect(env.ZCC_PROJECT_ID).toBe(projectId);
    expect(env.ZCC_SESSION_ID).toBe(sessionId);
    expect(env.ZCC_SESSION_TOKEN).toBeTruthy();
    // Main supplied no thread binding, so an ambient parent-session thread must not leak in.
    expect(env.ZCC_THREAD_ID).not.toBe(process.env.ZCC_THREAD_ID ?? '\u0000');

    // Authentication: a wrong or absent credential is always 401.
    expect(readFileSync(join(out, 'bad.code'), 'utf8')).toBe('401');
    expect(readFileSync(join(out, 'none.code'), 'utf8')).toBe('401');
    // A valid credential is never refused as unauthenticated; main-owned PTYs
    // are not product-server records, so the answer is 404 rather than a body
    // about any other session.
    const goodCode = readFileSync(join(out, 'good.code'), 'utf8');
    expect(['200', '404']).toContain(goodCode);
    if (goodCode === '200') expect(JSON.parse(readFileSync(join(out, 'good.json'), 'utf8'))).toMatchObject({ sessionId, projectId });

    // The CLI resolves the project from the spawn-time env hint.
    const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8')) as { currentProjectId: string | null };
    expect(status.currentProjectId).toBe(projectId);
  } finally {
    await closeApp(app.electron);
  }
});
