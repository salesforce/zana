import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the plugin enumeration so we control which plugin install paths
// contribute commands (the real listPlugins walks ~/.claude).
const listPluginsMock = vi.fn();
vi.mock('../extensions/plugins.js', () => ({
  listPlugins: () => listPluginsMock()
}));

import { listCommands } from './commands.js';

let fakeHome: string;
let projectPath: string;
let pluginPath: string;

async function writeMd(path: string, body: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf-8');
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'cc-cmd-home-'));
  projectPath = await mkdtemp(join(tmpdir(), 'cc-cmd-proj-'));
  pluginPath = await mkdtemp(join(tmpdir(), 'cc-cmd-plugin-'));
  process.env.ZCC_CLAUDE_HOME = fakeHome;
  listPluginsMock.mockReset();
  listPluginsMock.mockResolvedValue([]);
});

afterEach(async () => {
  delete process.env.ZCC_CLAUDE_HOME;
  await Promise.all([
    rm(fakeHome, { recursive: true, force: true }),
    rm(projectPath, { recursive: true, force: true }),
    rm(pluginPath, { recursive: true, force: true })
  ]);
});

describe('listCommands', () => {
  it('discovers user commands and parses frontmatter description + argument-hint', async () => {
    await writeMd(
      join(fakeHome, '.claude', 'commands', 'review.md'),
      '---\ndescription: Review the diff\nargument-hint: <pr-url>\n---\nBody here.'
    );
    const cmds = await listCommands();
    const review = cmds.find((c) => c.id === 'user:review');
    expect(review).toBeTruthy();
    expect(review!.invocation).toBe('/review');
    expect(review!.scope).toBe('user');
    expect(review!.description).toBe('Review the diff');
    expect(review!.argumentHint).toBe('<pr-url>');
  });

  it('falls back to the first body line when no frontmatter description', async () => {
    await writeMd(
      join(fakeHome, '.claude', 'commands', 'eq.md'),
      'Run a full Experience Quality audit.\n\n## Step 1'
    );
    const eq = (await listCommands()).find((c) => c.id === 'user:eq');
    expect(eq!.description).toBe('Run a full Experience Quality audit.');
  });

  it('namespaces nested command files with ":"', async () => {
    await writeMd(join(fakeHome, '.claude', 'commands', 'git', 'commit.md'), 'commit helper');
    const cmd = (await listCommands()).find((c) => c.name === 'git:commit');
    expect(cmd).toBeTruthy();
    expect(cmd!.invocation).toBe('/git:commit');
    expect(cmd!.id).toBe('user:git:commit');
  });

  it('discovers project commands when a project path is given', async () => {
    await writeMd(join(projectPath, '.claude', 'commands', 'deploy.md'), 'deploy it');
    const cmds = await listCommands({ projectPath, projectId: 'proj-1' });
    const deploy = cmds.find((c) => c.id === 'project:deploy');
    expect(deploy).toBeTruthy();
    expect(deploy!.scope).toBe('project');
    expect(deploy!.projectId).toBe('proj-1');
  });

  it('discovers enabled-plugin commands from their install path, prefixed by plugin name', async () => {
    await writeMd(join(pluginPath, 'commands', 'status.md'), 'show status');
    listPluginsMock.mockResolvedValue([
      { id: 'zana@mp', name: 'zana', enabled: true, path: pluginPath, source: 'marketplace', provides: { skills: [], commands: ['status'], mcpServers: [] }, manifestValid: true }
    ]);
    const cmd = (await listCommands()).find((c) => c.scope === 'plugin');
    expect(cmd).toBeTruthy();
    expect(cmd!.name).toBe('zana:status');
    expect(cmd!.invocation).toBe('/zana:status');
    expect(cmd!.pluginName).toBe('zana');
  });

  it('skips disabled plugins entirely', async () => {
    await writeMd(join(pluginPath, 'commands', 'status.md'), 'show status');
    listPluginsMock.mockResolvedValue([
      { id: 'zana@mp', name: 'zana', enabled: false, path: pluginPath, source: 'marketplace', provides: { skills: [], commands: ['status'], mcpServers: [] }, manifestValid: true }
    ]);
    expect((await listCommands()).some((c) => c.scope === 'plugin')).toBe(false);
  });

  it('returns empty (no throw) when nothing is installed and no project given', async () => {
    await expect(listCommands()).resolves.toEqual([]);
  });
});
