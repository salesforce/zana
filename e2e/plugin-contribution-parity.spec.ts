/**
 * Electron production-boundary: what a plugin contributes (an MCP server, an agent tool, a skill) reaches
 * each surface the parity matrix in docs/extensions-sdk-reference.md promises. One observer variant
 * contributes an `alwaysOn` stdio MCP server, `p2_probe_tool` and a skill. Scripted CLIs stand in for the
 * harnesses and dump exactly what main launched them with; nothing calls a model. HOME is the throwaway
 * one.
 *
 *  - PTY Claude, Codex and OpenCode launch with the MCP server.
 *  - A PTY plugin tool is listed by, and callable through, the session's zcc-inbox MCP route, with the
 *    plugin's tool policy consulted on the PTY surface.
 *  - Modern Claude and Modern Codex sessions receive the server (Claude through SDK `--mcp-config`, Codex
 *    through thread/start `config`).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from './fixtures/app.js';
import { waitForThreadProvider } from './fixtures/thread-providers.js';
import {
  CODEX_STUB, OPENCODE_STUB, addProject, claudeStub, installObservers, openTerminal, prepareScriptedClaude,
  prepareScriptedCodex, readLaunch, rpcOn, waitForRunning, waitForSealedPolicy, writeHomeConfig, writeNodeStub
} from './fixtures/aida-p2.js';

const PLUGIN = 'p2-contrib';
const SERVER_NAME = 'p2-server';
const MODEL_CLI = fileURLToPath(new URL('./fixtures/claude-model-cli.cjs', import.meta.url));
const SKILL_DIR = `plugin-${PLUGIN}-p2-skill`;
const MANIFEST = {
  mcpServers: { [SERVER_NAME]: { type: 'stdio', command: 'node', args: ['mcp-server.js'], alwaysOn: true } }
};
const serverMention = /p2.server/;

const skillsRoot = (home: string) => join(home, '.agents', 'skills');
/** A skill the user owns, and a lookalike without the Zana marker: reconcile must never touch either. */
function plantUserSkills(home: string): string[] {
  const own = join(skillsRoot(home), 'user-own-skill');
  const lookalike = join(skillsRoot(home), 'plugin-someone-else-skill');
  for (const dir of [own, lookalike]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${dir.split('/').pop()}\ndescription: user skill\n---\nUSER_SKILL_BODY\n`);
  }
  return [own, lookalike];
}
const userSkillsIntact = (dirs: string[]) =>
  dirs.every((dir) => existsSync(join(dir, 'SKILL.md')) && readFileSync(join(dir, 'SKILL.md'), 'utf8').includes('USER_SKILL_BODY'));

const pty = base.extend<{ stubDir: string; userSkills: string[] }>({
  stubDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-p2-parity-pty-'));
    try { await use(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  },
  userSkills: async ({ home }, use) => { await use(plantUserSkills(home)); },
  launchEnv: async ({ home, stubDir }, use) => {
    installObservers(home, { [PLUGIN]: MANIFEST });
    writeHomeConfig(home, {
      claudeBinary: writeNodeStub(stubDir, 'claude-stub.cjs', claudeStub(MODEL_CLI)),
      codexBinary: writeNodeStub(stubDir, 'codex-stub.cjs', CODEX_STUB),
      opencodeBinary: writeNodeStub(stubDir, 'opencode-stub.cjs', OPENCODE_STUB),
      harnessOpenCodeEnabled: true
    });
    await use({});
  }
});

pty('PTY Claude, Codex and OpenCode launch with the plugin MCP server; the plugin tool is listed and callable with policy', async ({ app, home, stubDir }) => {
  pty.setTimeout(180_000);
  const page = app.window;
  await waitForRunning(page, [PLUGIN]);
  await waitForSealedPolicy(app);
  const projectId = await addProject(page, join(home, 'parity-pty-project'));
  const launches: Record<string, { sessionId: string; launch: NonNullable<ReturnType<typeof readLaunch>> }> = {};
  for (const profile of ['claude', 'codex', 'opencode']) {
    const sessionId = await openTerminal(page, projectId, profile, `Parity ${profile}`);
    await expect.poll(() => readLaunch(stubDir, sessionId) !== undefined, { timeout: 30_000, message: `${profile} PTY never started` }).toBe(true);
    launches[profile] = { sessionId, launch: readLaunch(stubDir, sessionId)! };
  }

  // Claude: --mcp-config. Codex: -c mcp_servers.*. OpenCode: its config file.
  expect(launches.claude.launch.mcpConfigs.join('\n')).toMatch(serverMention);
  expect(launches.claude.launch.mcpConfigs.join('\n')).toContain('mcp-server.js');
  expect(launches.codex.launch.args.join('\n')).toMatch(/mcp_servers\.plugin_p2.contrib_p2.server/);
  expect(JSON.stringify(launches.opencode.launch.openCodeConfig ?? {})).toMatch(/plugin_p2.contrib_p2.server/);

  // The plugin tool goes through the session's zcc-inbox route, under the plugin's tool policy.
  const route = launches.claude.launch.mcpUrl!;
  expect(route).toContain(launches.claude.sessionId);
  const mcp = async (method: string, params?: Record<string, unknown>) => {
    const response = await fetch(route, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })
    });
    expect(response.ok).toBe(true);
    const body = await response.json() as { error?: unknown; result: { tools?: Array<{ name: string }>; isError?: boolean; content?: Array<{ text?: string }> } };
    expect(body.error).toBeUndefined();
    return body.result;
  };
  const listed = (await mcp('tools/list')).tools!.map((tool) => tool.name);
  const toolName = listed.find((name) => name.includes('p2_probe_tool'));
  expect(toolName, `plugin tool missing from ${JSON.stringify(listed)}`).toBeDefined();
  const called = await mcp('tools/call', { name: toolName!, arguments: {} });
  expect(called.isError, JSON.stringify(called)).not.toBe(true);
  expect((called.content ?? []).map((row) => row.text).join('\n')).toContain('P2_TOOL_RAN');
  const policies = await rpcOn(page, PLUGIN)<Array<{ toolName: string; surface?: string; threadId: string }>>('policyList');
  expect(policies).toEqual(expect.arrayContaining([expect.objectContaining({ surface: 'pty', threadId: launches.claude.sessionId })]));
  expect(policies.some((row) => row.toolName.includes('p2_probe_tool'))).toBe(true);
});

const modern = base.extend<{ codexLog: string }>({
  codexLog: async ({ home }, use) => { await use(join(home, 'p2-codex-requests.jsonl')); },
  launchEnv: async ({ home, codexLog }, use) => {
    installObservers(home, { [PLUGIN]: MANIFEST });
    const env = prepareScriptedClaude(home);
    writeHomeConfig(home, { claudeBinary: env.ZCC_CLAUDE_CODE_EXECUTABLE, ...prepareScriptedCodex(home, codexLog) });
    await use(env);
  }
});

modern('Modern Claude and Modern Codex sessions receive the plugin MCP server', async ({ app, home, codexLog }) => {
  modern.setTimeout(180_000);
  const page = app.window;
  await waitForRunning(page, [PLUGIN]);
  await waitForThreadProvider(page, 'claude-code');
  await waitForThreadProvider(page, 'codex');
  await waitForSealedPolicy(app);
  const claudeRoot = join(home, 'parity-modern-claude');
  const codexRoot = join(home, 'parity-modern-codex');
  const claudeProject = await addProject(page, claudeRoot);
  const codexProject = await addProject(page, codexRoot);
  const start = (projectId: string, providerId: string) => page.evaluate(async (body) => {
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return (result.thread ?? result.value).id as string;
  }, { projectId, providerId, input: 'Parity standby', permissionMode: 'accept-edits' });
  await start(claudeProject, 'claude-code');
  await start(codexProject, 'codex');

  // Claude: the SDK launched the CLI with --mcp-config naming the plugin server.
  const claudeJournal = realpathSync(claudeRoot) + '/.native-policy-mcp.jsonl';
  await expect.poll(() => existsSync(claudeJournal) ? readFileSync(claudeJournal, 'utf8') : '', { timeout: 40_000, message: 'Modern Claude never received --mcp-config' }).toMatch(serverMention);
  expect(readFileSync(claudeJournal, 'utf8')).toContain('mcp-server.js');

  // Codex: thread/start config carries mcp_servers.<name>.command.
  await expect.poll(() => existsSync(codexLog) ? readFileSync(codexLog, 'utf8') : '', { timeout: 40_000, message: 'Modern Codex never started a thread' })
    .toMatch(/mcp_servers\.[^"]*p2.server[^"]*\.command/);
});
