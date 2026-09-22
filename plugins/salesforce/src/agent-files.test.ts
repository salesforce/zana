import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeDeps } from '../lib/node-deps.js';
import {
  AgentFilesError,
  createAgentFile,
  listAgentFiles,
  readAgentFile,
  sha256Hex,
  writeAgentFile
} from '../lib/agent-files.js';
import type { SalesforceDeps } from '../lib/types.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memFs(files: Record<string, string>, extraDirs: Record<string, string[]> = {}): SalesforceDeps {
  const dirsMap: Record<string, string[]> = { ...extraDirs };
  return {
    execSf: async () => ({ code: 1, stdout: '', stderr: '' }),
    request: async () => ({ status: 500, json: null, text: '' }),
    now: () => 0,
    exists: (path) => path in files || path in dirsMap,
    stat: (path) => (path in dirsMap ? 'dir' : path in files ? 'file' : 'missing'),
    readFile: (path) => files[path] ?? null,
    readdir: (path) => dirsMap[path] ?? [],
    realpath: (path) => path,
    writeFile: (path, content) => {
      files[path] = content;
    },
    spawnContained: async () => ({ code: 0, stdout: '', stderr: '' })
  };
}

describe('agent files confinement', () => {
  it('lists saved drafts in the project root and afscript files alongside DX bundles', () => {
    const deps = memFs({ '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}', '/proj/New.agent': 'start_agent:', '/proj/force-app/Draft.afscript': 'start_agent:' }, { '/proj': ['sfdx-project.json', 'New.agent', 'force-app'], '/proj/force-app': ['Draft.afscript'] });
    expect(listAgentFiles('/proj', deps).map(row => ({ path: row.path, apiName: row.apiName }))).toEqual([
      { path: 'force-app/Draft.afscript', apiName: 'Draft' }, { path: 'New.agent', apiName: 'New' },
    ]);
    expect(listAgentFiles('/proj', deps, { bundlesOnly: true })).toEqual([]);
  });

  it('lists scanned bundles and refuses path escape', () => {
    const files = {
      '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}',
      '/proj/force-app/MyBot.agent': 'config:\n    agent_name: "MyBot"\nstart_agent:\n    reasoning:\n        instructions: "hi"\n'
    };
    const deps = memFs(files, {
      '/proj': ['sfdx-project.json', 'force-app'],
      '/proj/force-app': ['MyBot.agent']
    });
    const listed = listAgentFiles('/proj', deps);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ apiName: 'MyBot', path: 'force-app/MyBot.agent' });
    expect(listAgentFiles('/proj', deps, { bundlesOnly: true })).toEqual(listed);
    expect(() => readAgentFile('/proj', '/etc/passwd', deps)).toThrow(AgentFilesError);
    expect(() => writeAgentFile('/proj', '../secret.agent', 'x', deps)).toThrow(/path_refused|inside/);
    expect(() => writeAgentFile('/proj', 'force-app/notes.txt', 'x', deps)).toThrow(/path_refused|inside/);
  });

  it('rejects writes without a DX root and sha mismatches', () => {
    const files = {
      '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}',
      '/proj/force-app/MyBot.agent': 'old'
    };
    const deps = memFs(files, {
      '/proj': ['sfdx-project.json', 'force-app'],
      '/proj/force-app': ['MyBot.agent']
    });
    expect(() => listAgentFiles('', deps)).toThrow(/DX project root/);
    expect(() => readAgentFile('/proj', 'force-app/Missing.agent', deps)).toThrow(/not found/);
    expect(() => writeAgentFile('/proj', 'force-app/MyBot.agent', 1 as unknown as string, deps)).toThrow(
      /string content/
    );
    expect(() => writeAgentFile('/proj', 'force-app/MyBot.agent', 'new', deps, sha256Hex('other'))).toThrow(/changed on disk/);
    const written = writeAgentFile('/proj', 'force-app/MyBot.agent', 'new', deps, sha256Hex('old'));
    expect(written.sha256).toBe(sha256Hex('new'));
    expect(readAgentFile('/proj', 'force-app/MyBot.agent', deps).content).toBe('new');
  });

  it('writes atomically through node deps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-sf-write-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'force-app'), { recursive: true });
    writeFileSync(join(dir, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app"}]}');
    writeFileSync(join(dir, 'force-app', 'Bot.agent'), 'old');
    const deps = createNodeDeps();
    writeAgentFile(dir, 'force-app/Bot.agent', 'saved', deps);
    expect(readFileSync(join(dir, 'force-app', 'Bot.agent'), 'utf8')).toBe('saved');
  });

  it('walks a non-DX folder for .agent files when allowed', () => {
    const files = {
      '/src/bots/QC/QC.agent': 'config:\n    agent_name: "QC"\n',
      '/src/README.md': 'nope'
    };
    const deps = memFs(files, {
      '/src': ['bots', 'README.md'],
      '/src/bots': ['QC'],
      '/src/bots/QC': ['QC.agent']
    });
    expect(() => listAgentFiles('/src', deps)).toThrow(/DX project root/);
    const listed = listAgentFiles('/src', deps, { allowNonDx: true });
    expect(listAgentFiles('/src', deps, { allowNonDx: true, bundlesOnly: true })).toEqual([]);
    expect(listed).toEqual([
      expect.objectContaining({ apiName: 'QC', path: 'bots/QC/QC.agent' })
    ]);
    expect(readAgentFile('/src', 'bots/QC/QC.agent', deps, { allowNonDx: true }).content).toContain('QC');
    expect(() => readAgentFile('/src', '/etc/passwd', deps, { allowNonDx: true })).toThrow(AgentFilesError);
  });
  it('creates a complete private file without overwriting files or following destination symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-create-')); dirs.push(root);
    const deps = createNodeDeps();
    const options = { allowNonDx: true };
    const result = createAgentFile(root, 'New.agent', 'new source', deps, options);
    expect(result).toEqual({ path: 'New.agent', sha256: sha256Hex('new source') });
    expect(statSync(join(root, 'New.agent')).mode & 0o777).toBe(0o600);
    expect(() => createAgentFile(root, 'New.agent', 'overwrite', deps, options)).toThrow('already exists');
    symlinkSync(join(root, 'New.agent'), join(root, 'Link.agent'));
    expect(() => createAgentFile(root, 'Link.agent', 'overwrite', deps, options)).toThrow('already exists');
    expect(readFileSync(join(root, 'New.agent'), 'utf8')).toBe('new source');
    expect(readdirSync(root).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('confines new files through an existing parent and bounds source', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-confine-')); dirs.push(root);
    const outside = mkdtempSync(join(tmpdir(), 'sf-outside-')); dirs.push(outside);
    symlinkSync(outside, join(root, 'escape'));
    const deps = createNodeDeps(); const options = { allowNonDx: true };
    for (const path of ['../Outside.agent', '/tmp/Outside.agent', 'escape/Outside.agent', 'missing/New.agent', 'notes.txt', '']) {
      expect(() => createAgentFile(root, path, 'source', deps, options)).toThrow();
    }
    expect(() => createAgentFile(root, 'New.agent', 'x'.repeat(180001), deps, options)).toThrow('180,000');
    expect(() => createAgentFile(root, 'New.agent', 'source', { ...deps, createFile: undefined }, options)).toThrow('unavailable');
    expect(() => createAgentFile(root, 'New.agent', 'source', { ...deps, createFile: () => { throw Error('disk full'); } }, options)).toThrow('disk full');
    expect(readdirSync(outside)).toEqual([]);
  });

});
