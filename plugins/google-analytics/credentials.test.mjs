import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePluginRuntime } from '../../packages/plugin-build/src/prepare-plugin-runtime.ts';
import { writeReleaseDefaults } from './build.mjs';
import { readReleaseDefaults } from './credentials.mjs';

const directories = [];
const temporary = () => { const dir = mkdtempSync(join(tmpdir(), 'ga4-defaults-')); directories.push(dir); return dir; };
afterEach(() => { directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); });

describe('plugin-owned release defaults', () => {
  it('writes private, atomic release defaults and reads only known credential fields', () => {
    const root = temporary();
    writeReleaseDefaults(root, { ZCC_GA4_MEASUREMENT_ID: ' G-RELEASE ', ZCC_GA4_API_SECRET: ' release-secret ' });
    const file = join(root, 'release-defaults/config.json');
    expect(readReleaseDefaults(pathToFileURL(file))).toEqual({ measurementId: 'G-RELEASE', apiSecret: 'release-secret' });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(root, 'release-defaults'))).toEqual(['config.json']);
    writeReleaseDefaults(root, {});
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ measurementId: '', apiSecret: '' });
    expect(readReleaseDefaults(file)).toEqual({});
  });

  it.each([
    { ZCC_GA4_MEASUREMENT_ID: 'G-ONLY' }, { ZCC_GA4_API_SECRET: 'only' },
    { ZCC_GA4_MEASUREMENT_ID: 'invalid', ZCC_GA4_API_SECRET: 'secret' },
    { ZCC_GA4_MEASUREMENT_ID: 'G-TEST', ZCC_GA4_API_SECRET: 'x'.repeat(257) }
  ])('rejects incomplete/malformed release credentials without writing them: %j', (env) => {
    const root = temporary(); expect(() => writeReleaseDefaults(root, env)).toThrow('release defaults require');
    expect(existsSync(join(root, 'release-defaults/config.json'))).toBe(false);
  });

  it.each(['broken-json', 'null', '[]', '{"measurementId":"G-TEST"}', JSON.stringify({ measurementId: 'G-TEST', apiSecret: 'x'.repeat(257) }), 'x'.repeat(1025)])('ignores malformed or oversized assets', (value) => {
    const file = join(temporary(), 'config.json'); writeFileSync(file, value);
    expect(readReleaseDefaults(file)).toEqual({});
  });

  it('ignores absent assets', () => expect(readReleaseDefaults(join(temporary(), 'missing.json'))).toEqual({}));

  it('ships generated credentials through the ordinary dependency-free runtime packager', async () => {
    const root = temporary(); const source = join(root, 'source');
    cpSync(new URL('.', import.meta.url), source, { recursive: true, filter: path => !path.endsWith('config.json') });
    writeReleaseDefaults(source, { ZCC_GA4_MEASUREMENT_ID: 'G-PACKAGED', ZCC_GA4_API_SECRET: 'fake-package-secret' });
    const output = join(root, 'runtime'); await preparePluginRuntime(source, output, '2.3.3');
    expect(readReleaseDefaults(join(output, 'release-defaults/config.json'))).toEqual({ measurementId: 'G-PACKAGED', apiSecret: 'fake-package-secret' });
    const pkg = JSON.parse(readFileSync(join(output, 'package.json'), 'utf8'));
    expect(pkg.zcc.app).toBe('./app.js'); expect(pkg.scripts).toBeUndefined();
    vi.stubEnv('ZCC_GA4_MEASUREMENT_ID', undefined); vi.stubEnv('ZCC_GA4_API_SECRET', undefined);
    const { default: packaged } = await import(pathToFileURL(join(output, 'server.mjs')).href);
    let descriptors;
    packaged({ settings: { define: values => { descriptors = values; return { onChange: () => {} }; } }, rpc: { method: () => {} }, onDispose: () => {} });
    expect(descriptors.measurementId.default).toBe('G-PACKAGED');
    expect(descriptors.apiSecret.default).toBe('fake-package-secret');
  });
});
