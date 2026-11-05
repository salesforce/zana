import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const home = join(tmpdir(), `plugin-agent-sync-home-${process.pid}`);
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => join(tmpdir(), `plugin-agent-sync-home-${process.pid}`) };
});
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', () => ({ rebuildPluginServers: vi.fn() }));

// eslint-disable-next-line import/first
import { applyPluginAgentCapabilities, collectPluginAgentsSkills } from '../plugin-agent-sync.js';

let src: string;
function plugin(id: string, enabled: boolean) {
  const dir = join(src, id);
  mkdirSync(join(dir, 'skills', 'hello'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'hello', 'SKILL.md'), `# ${id}\n`);
  return { id, rootDir: dir, enabled, skillsRootPaths: ['skills'], skillNames: ['hello'], mcpServers: [], extra: {} };
}

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  src = mkdtempSync(join(tmpdir(), 'plugin-agent-sync-src-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(src, { recursive: true, force: true });
});

describe('applyPluginAgentCapabilities ~/.agents/skills', () => {
  it('collects only enabled plugins', async () => {
    const out = await collectPluginAgentsSkills([plugin('on', true), plugin('off', false)]);
    expect(out.map((e) => e.pluginId)).toEqual(['on']);
  });

  it('writes on enable, removes on disable and on uninstall, leaves non-Zana entries', async () => {
    const mine = join(home, '.agents', 'skills', 'mine');
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, 'SKILL.md'), 'mine');
    const a = plugin('a', true);
    await applyPluginAgentCapabilities([a]);
    const file = join(home, '.agents', 'skills', 'plugin-a-hello', 'SKILL.md');
    expect(readFileSync(file, 'utf8')).toBe('# a\n');
    await applyPluginAgentCapabilities([{ ...a, enabled: false }]);
    expect(existsSync(join(home, '.agents', 'skills', 'plugin-a-hello'))).toBe(false);
    await applyPluginAgentCapabilities([a]);
    expect(existsSync(file)).toBe(true);
    await applyPluginAgentCapabilities([]); // uninstalled / boot sweep
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(mine, 'SKILL.md'), 'utf8')).toBe('mine');
  });
});
