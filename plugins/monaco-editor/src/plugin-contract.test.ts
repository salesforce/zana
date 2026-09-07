import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { derivePluginId } from '@zana-ai/zcc-domain';
import { CLAIMED_EXTENSIONS, languageForPath } from '../languages.js';
import { confineToRoot, isBinaryBuffer, parseFileSource } from '../file-rpc.js';
import app from '../app.js';
import plugin from '../server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('monaco-editor plugin contract', () => {
  it('derives a stable id and claims code extensions, not markdown or pdf', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('monaco-editor');
    const set = collectTestPluginApp(app, 'monaco-editor');
    expect(set.fileOpeners[0]?.id).toBe('code');
    expect(set.fileOpeners[0]?.extensions).toEqual([...CLAIMED_EXTENSIONS]);
    expect(set.fileOpeners[0]?.title).toBe('File Editor');
    expect(CLAIMED_EXTENSIONS).toContain('ts');
    expect(CLAIMED_EXTENSIONS).not.toContain('md');
    expect(CLAIMED_EXTENSIONS).not.toContain('pdf');
    expect(languageForPath('src/App.tsx')).toBe('typescript');
    expect(languageForPath('Makefile')).toBe('plaintext');
    expect(languageForPath('notes.')).toBe('plaintext');
    expect(languageForPath('unknown.xyz')).toBe('plaintext');
  });

  it('confines writes to the project root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-monaco-root-'));
    tempDirs.push(dir);
    expect(confineToRoot(dir, 'src/hello.ts')).toBe(join(dir, 'src', 'hello.ts'));
    expect(() => confineToRoot(dir, '../etc/passwd')).toThrow(/not inside/);
  });

  it('rejects binary buffers and incomplete file sources', () => {
    expect(isBinaryBuffer(Buffer.from('hello'))).toBe(false);
    expect(isBinaryBuffer(Buffer.from([0, 1, 2]))).toBe(true);
    expect(() => parseFileSource({})).toThrow(/path is required/);
    expect(() =>
      parseFileSource({ path: 'a.ts', source: { kind: 'remote' } })
    ).toThrow(/unsupported file source/);
    const parsed = parseFileSource({
      path: 'src/a.ts',
      source: { kind: 'workspace', projectId: 'p1' },
      content: 'x'
    });
    expect(parsed.source.kind).toBe('workspace');
  });

  it('reads and writes local project files with conflict detection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-monaco-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'hello.ts'), 'export const n = 1;\n');
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'monaco-editor',
      listProjects: () => [{ id: 'p1', name: 'Demo', path: dir }]
    });
    await plugin(zcc);
    const source = {
      kind: 'workspace',
      threadId: 'thr_1',
      environmentId: null,
      projectId: 'p1'
    };
    const file = (await harness.callRpc('read', { path: 'src/hello.ts', source })) as {
      kind: string;
      content: string;
      sha256: string;
    };
    expect(file.kind).toBe('text');
    expect(file.content).toContain('export const n');
    const written = (await harness.callRpc('write', {
      path: 'src/hello.ts',
      source,
      content: 'export const n = 2;\n',
      expectedSha256: file.sha256
    })) as { outcome: string };
    expect(written.outcome).toBe('written');
    expect(readFileSync(join(dir, 'src', 'hello.ts'), 'utf8')).toContain('n = 2');
    const conflict = (await harness.callRpc('write', {
      path: 'src/hello.ts',
      source,
      content: 'export const n = 3;\n',
      expectedSha256: file.sha256
    })) as { outcome: string };
    expect(conflict.outcome).toBe('conflict');
  });

  it('delegates remote or binary files', async () => {
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'monaco-editor',
      listProjects: () => [{ id: 'p1', name: 'Demo' }]
    });
    await plugin(zcc);
    const file = (await harness.callRpc('read', {
      path: 'src/hello.ts',
      source: { kind: 'workspace', threadId: null, environmentId: null, projectId: 'p1' }
    })) as { kind: string };
    expect(file.kind).toBe('unsupported');
    const written = (await harness.callRpc('write', {
      path: 'src/hello.ts',
      source: { kind: 'workspace', threadId: null, environmentId: null, projectId: 'p1' },
      content: 'export const n = 2;\n'
    })) as { outcome: string };
    expect(written.outcome).toBe('unsupported');
  });
});
