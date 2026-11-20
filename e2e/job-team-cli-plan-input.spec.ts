/**
 * AC2 / AC12: `zcc team launch --dry-run --plan-file` through the real Electron boundary.
 *
 * A main-owned shell PTY (the production spawn path) runs the built `zcc` CLI against the
 * app's product server. The plan is over 8192 bytes, the size at which Electron main once
 * truncated piped child stdout, so a clean dry-run proves the whole plan reaches the server
 * and the whole answer comes back. Bad-plan, missing-file and over-cap cases pin the plan
 * error text and exit codes.
 */
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

function bigPlan(): string {
  const steps = Array.from({ length: 30 }, (_, i) => [
    `### step-${i}: Write note ${i} <!-- executable-step -->`,
    `- Work: Create note-${i}.txt containing a short line, padded so the plan is large: ${'lorem ipsum dolor sit amet '.repeat(6)}`,
    `- Write scope: \`note-${i}.txt\``,
    `- Verification: Read note-${i}.txt.`,
    ''
  ].join('\n'));
  return ['# Large plan', '', ...steps].join('\n');
}

test('zcc team launch --dry-run --plan-file works for a >8192 byte plan and reports plan errors with exit codes', async ({ home }) => {
  test.setTimeout(180_000);
  const port = await freePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const app = await launchApp(home, {
    e2e: true,
    env: { ZCC_SERVER_PORT: String(port) },
    initialConfig: { sponsorPromptDismissed: true, teamJobLaunchEnabled: true }
  });
  try {
    const win = app.window;
    const projectDir = join(home, 'plan-input-project');
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id as string;
    }, projectDir);
    await win.evaluate(() => window.cc.personas.save({
      id: 'plan-orch', name: 'Plan Orchestrator', description: 'o', baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await win.evaluate(() => window.cc.personas.save({
      id: 'plan-worker', name: 'Plan Worker', description: 'w', baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await win.evaluate(() => window.cc.teams.save({
      id: 'plan-team', name: 'Plan Team', description: 'd', slots: [{ personaId: 'plan-worker', quantity: 1 }], orchestratorPersonaId: 'plan-orch'
    }));

    const out = join(home, 'plan-out');
    mkdirSync(out, { recursive: true });
    const plan = bigPlan();
    expect(Buffer.byteLength(plan)).toBeGreaterThan(8192);
    writeFileSync(join(out, 'big-plan.md'), plan);
    writeFileSync(join(out, 'bad-plan.md'), 'Just some prose with no steps at all.\n');
    writeFileSync(join(out, 'huge-plan.md'), 'x'.repeat(64_001));

    const zcc = `env -u ZCC_THREAD_ID -u ZCC_SESSION_ID -u ZCC_SESSION_TOKEN ZCC_SERVER_URL=${serverUrl} ZCC_DATA_DIR=${home}/.zcc ${process.execPath} ${ZCC_BIN}`;
    const base = `team launch --team plan-team --project ${projectId} --goal "Plan input check" --dry-run`;
    const cases: Array<[string, string]> = [
      ['big', `${base} --plan-file ${out}/big-plan.md --json`],
      ['big-text', `${base} --plan-file ${out}/big-plan.md`],
      ['bad', `${base} --plan-file ${out}/bad-plan.md`],
      ['missing', `${base} --plan-file ${out}/nope.md`],
      ['huge', `${base} --plan-file ${out}/huge-plan.md`],
      ['freeform', `${base} --mode freeform --plan-file ${out}/big-plan.md`]
    ];
    const script = cases.map(([name, args]) =>
      `${zcc} ${args} > ${out}/${name}.out 2> ${out}/${name}.err; echo $? > ${out}/${name}.code`).join('\n') + `\necho done > ${out}/done\n`;
    writeFileSync(join(out, 'run.sh'), script);

    const sessionId = await win.evaluate(async (projectId) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'shell', cols: 120, rows: 32 });
      const session = result && 'ok' in result ? result.value : result;
      if (!session?.id) throw new Error(JSON.stringify(result));
      return session.id as string;
    }, projectId);
    await win.waitForTimeout(4_000);
    await win.evaluate(({ id, line }) => window.cc.terminals.write(id, line), { id: sessionId, line: `sh ${out}/run.sh\r` });
    await expect.poll(() => existsSync(join(out, 'done')), { timeout: 120_000, message: 'shell never finished the CLI script' }).toBe(true);

    const read = (name: string, ext: string) => readFileSync(join(out, `${name}.${ext}`), 'utf8');
    const code = (name: string) => Number(read(name, 'code').trim());
    const diag = (name: string) => `${name}: code=${read(name, 'code')} out=${read(name, 'out').slice(0, 400)} err=${read(name, 'err').slice(0, 400)}`;

    // Large plan: a complete answer, exit 0, nothing launched.
    expect(code('big'), diag('big')).toBe(0);
    expect(statSync(join(out, 'big.out')).size).toBeGreaterThan(0);
    expect(() => JSON.parse(read('big', 'out')), diag('big')).not.toThrow();
    expect(code('big-text'), diag('big-text')).toBe(0);
    expect(read('big-text', 'out')).toContain('Dry run: nothing was launched.');
    expect(await win.evaluate((id) => window.cc.executionBoard.listProject(id).then((page) => page.executions.length), projectId)).toBe(0);

    // A plan with no steps: the real parser reason, not the generic preview failure.
    expect(code('bad'), diag('bad')).not.toBe(0);
    expect(read('bad', 'err') + read('bad', 'out')).toContain('no executable steps found');
    expect(read('bad', 'err') + read('bad', 'out')).not.toContain('could not validate the plan or target');

    // Usage errors exit 2 with a specific message.
    expect(code('missing'), diag('missing')).toBe(2);
    expect(read('missing', 'err')).toContain('cannot read plan file');
    expect(code('huge'), diag('huge')).toBe(2);
    expect(read('huge', 'err')).toContain('exceeds');
    expect(code('freeform'), diag('freeform')).toBe(2);
    expect(read('freeform', 'err')).toContain('--plan-file requires --mode structured');
  } finally {
    await closeApp(app.electron);
  }
});
