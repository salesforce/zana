import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { createRuntimeLog, guardOutputPipes, installRuntimeLog, redactRuntimeLog } from './runtime-log.js';
const roots: string[] = [];
async function root() { const p = await mkdtemp(join(tmpdir(), 'zcc-log-')); roots.push(p); return p; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
describe('durable runtime logs', () => {
  it('absorbs disconnected output pipes without logging recursively and releases listeners', () => {
    const stdout = new EventEmitter(), stderr = new EventEmitter();
    const release = guardOutputPipes([stdout, stderr]);
    const brokenPipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    for (const stream of [stdout, stderr]) {
      expect(() => stream.emit('error', brokenPipe)).not.toThrow();
      const otherError = Object.assign(new Error('I/O failure'), { code: 'EIO' });
      expect(() => stream.emit('error', otherError)).toThrow(otherError);
    }
    release(); release();
    expect(stdout.listenerCount('error')).toBe(0);
    expect(stderr.listenerCount('error')).toBe(0);
  });
  it('redacts credentials before writing private logs, without inspecting objects', async () => {
    const sink = createRuntimeLog(await root(), 'server', { env: { API_KEY: 'sensitive-value' } });
    sink.write('error', ['Bearer abc', '--join-code flag-secret', 'token=foo', 'sensitive-value', 'https://user:pass@host/t/zcrs_abcdef', { get secret() { throw new Error('getter must not run'); } }, new Error('failure')]);
    await sink.flush();
    const result = await readFile(sink.file, 'utf8');
    expect(result).toContain('failure'); expect(result).toContain('[object]');
    for (const secret of ['abc', 'flag-secret', 'foo', 'sensitive-value', 'user:pass', 'zcrs_abcdef']) expect(result).not.toContain(secret);
    expect((await stat(sink.file)).mode & 0o777).toBe(0o600);
    expect(redactRuntimeLog('safe value')).toBe('safe value');
  });
  it('caps retention and the pending queue', async () => {
    const dir = await root(), sink = createRuntimeLog(dir, 'desktop', { maxBytes: 150 });
    for (let i = 0; i < 8; i++) { sink.write('warn', ['x'.repeat(100)]); await sink.flush(); }
    expect((await readdir(join(dir, 'logs'))).sort()).toEqual(['desktop.log', 'desktop.log.1', 'desktop.log.2']);
    for (let i = 0; i < 100; i++) sink.write('warn', [i]);
    await sink.flush(); sink.write('warn', ['after overload']); await sink.flush();
    expect(await readFile(sink.file, 'utf8')).toContain('dropped 36 messages');
  });
  it('keeps the app alive on disk errors and rejects invalid roles', async () => {
    const dir = await root(); await writeFile(join(dir, 'logs'), 'blocking file');
    const sink = createRuntimeLog(dir, 'server'); sink.write('error', [null, 42]); await sink.flush();
    expect(() => createRuntimeLog(dir, '../unsafe')).toThrow();
  });
  it('captures console errors, fingerprints the bundle and restores listeners', async () => {
    const dir = await root(), bundle = join(dir, 'bundle.js'); await writeFile(bundle, 'test');
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = process.listenerCount('uncaughtExceptionMonitor');
    const outputListeners = [process.stdout, process.stderr].map(stream => stream.listenerCount('error'));
    const sink = installRuntimeLog(dir, 'desktop', bundle);
    for (const [index, stream] of [process.stdout, process.stderr].entries()) {
      expect(stream.listenerCount('error')).toBe(outputListeners[index] + 1);
    }
    console.error('example error'); console.warn('example warning');
    await vi.waitFor(async () => { await sink.flush(); expect(await readFile(sink.file, 'utf8')).toContain('sha256='); });
    await sink.close();
    const content = await readFile(sink.file, 'utf8'); expect(content).toContain('example error'); expect(content).toContain('example warning');
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(before);
    expect([process.stdout, process.stderr].map(stream => stream.listenerCount('error'))).toEqual(outputListeners);
  });
});
