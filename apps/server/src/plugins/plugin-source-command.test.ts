import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPluginSourceCommand } from './plugin-source-command.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe('plugin source file capture', () => {
  it('captures complete output above 8192 bytes, isolated cwd and HOME', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'source-test-')); dirs.push(cwd);
    const result = await runPluginSourceCommand(process.execPath, ['-e', "process.stdout.write(JSON.stringify({cwd:process.cwd(),home:process.env.HOME,data:'x'.repeat(40000)}));process.stderr.write('diagnostic')"], cwd, { env: { HOME: cwd } });
    expect(result.code).toBe(0); expect(result.stderr).toBe('diagnostic');
    expect(JSON.parse(result.stdout)).toEqual({ cwd: realpathSync(cwd), home: cwd, data: 'x'.repeat(40_000) });
  });
  it('returns nonzero exits and rejects missing executables, timeouts and oversized output', async () => {
    expect(await runPluginSourceCommand(process.execPath, ['-e', 'process.exit(7)'], tmpdir())).toMatchObject({ code: 7 });
    await expect(runPluginSourceCommand('/missing-zcc-executable', [], tmpdir())).rejects.toThrow();
    await expect(runPluginSourceCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmpdir(), { timeoutMs: 30 })).rejects.toThrow(/timed out/);
    await expect(runPluginSourceCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(100000))"], tmpdir(), { maxBytes: 100 })).rejects.toThrow(/size limit/);
    await expect(runPluginSourceCommand(process.execPath, ['-e', "setInterval(()=>process.stdout.write('x'.repeat(10000)),1)"], tmpdir(), { maxBytes: 100 })).rejects.toThrow(/size limit/);
  });
  it('creates private capture files and removes them on completion', async () => {
    const before = new Set(readdirSync(tmpdir()));
    const pending = runPluginSourceCommand(process.execPath, ['-e', 'setTimeout(()=>{},150)'], tmpdir());
    const added = readdirSync(tmpdir()).filter(name => name.startsWith('zcc-plugin-source-') && !before.has(name));
    expect(added).toHaveLength(1);
    if (process.platform !== 'win32') expect(statSync(join(tmpdir(), added[0]!, 'stdout')).mode & 0o777).toBe(0o600);
    await pending;
    expect(readdirSync(tmpdir())).not.toContain(added[0]);
  });
  it('cancels outstanding commands on shutdown and refuses already-cancelled work', async () => {
    const controller = new AbortController();
    const pending = runPluginSourceCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmpdir(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    await expect(runPluginSourceCommand(process.execPath, ['--version'], tmpdir(), { signal: controller.signal })).rejects.toThrow(/cancelled/);
  });
});
