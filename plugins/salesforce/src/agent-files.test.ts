import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeDeps } from '../lib/node-deps.js';
import {
  AgentFilesError,
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
});
