/**
 * Persona MCP allowlist, Modern (Claude Agent SDK) Squad path (built Electron).
 *
 * ZCC_CLAUDE_CODE_EXECUTABLE points the shipped claude-code bridge at a fake `claude` that
 * records argv and every stdin message. Modern Squad members are interactive (non-isolated)
 * sessions, so the allowlist narrows the plugin servers Zana injects and the member's launch is
 * announced with a `persona_mcp_allowlist` thread notice naming the allowed servers and stating
 * the limit. Those notices (per thread), plus the fake's recorded argv, are the observable
 * boundary here. A fake cannot prove the real CLI filters its own user servers.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures/app.js';
import { MISSING_SERVER, USER_ALLOWED, USER_BLOCKED, modernMcpFake, seedMcpInventory } from './fixtures/mcp-allowlist.js';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'mcp-allowlist-bin');
    const logs = join(home, 'mcp-allowlist-logs');
    mkdirSync(bin, { recursive: true });
    mkdirSync(logs, { recursive: true });
    const fake = join(bin, 'claude');
    writeFileSync(fake, modernMcpFake(logs, process.execPath));
    chmodSync(fake, 0o755);
    await use({ ZCC_CLAUDE_CODE_EXECUTABLE: fake });
  }
});

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off', autoRenameTabs: false } });
test.setTimeout(120_000);

interface Session { threadId: string | null; argv: string[]; seeded: string[] | null; worked: boolean }

/** Every fake-claude process the app spawned, with the servers its isolated config was seeded with. */
function sessions(home: string): Session[] {
  const dir = join(home, 'mcp-allowlist-logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const argv = lines.find((l) => l.kind === 'argv')?.value;
    return argv ? [{
      threadId: argv.threadId as string | null,
      argv: argv.argv as string[],
      seeded: argv.seededServers ? [...(argv.seededServers as string[])].sort() : null,
      worked: lines.some((l) => l.kind === 'in' && l.value.type === 'user')
    }] : [];
  }).filter((s) => s.worked);
}

interface Member { id: string; mcpServers?: string[] }

/** Launch a MODERN Team with the given worker personas plus an unrestricted coordinator. */
async function runModernTeam(page: Page, home: string, workers: Member[]) {
  seedMcpInventory(home);
  await page.evaluate((bin) => window.cc.config.set({ claudeBinary: bin, defaultHarness: 'claude' }),
    join(home, 'mcp-allowlist-bin', 'claude'));
  const root = join(home, 'mcp-allowlist-project');
  mkdirSync(root, { recursive: true });
  const plan = join(root, 'plan.md');
  const steps = workers.map((_, i) => [
    `### step-${i}: Step ${i} <!-- executable-step -->`, '- **Work:** Report MCP_PROBE after reading README.md.',
    '- **Depends on:** None', '- **Mode:** read-only', '- **Verification:** README.md exists.', ''
  ].join('\n'));
  writeFileSync(plan, ['# MCP allowlist probe', '', ...steps].join('\n'));
  writeFileSync(join(root, 'README.md'), 'mcp allowlist fixture\n');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, env: { ...process.env, HOME: home } });
  git('init', '-b', 'main'); git('add', '.');
  git('-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test', 'commit', '-m', 'fixture');
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  await page.evaluate(async (members) => {
    const base = { baseProfile: 'claude', model: 'sonnet', permissionMode: 'default' } as const;
    const personas = [
      ...members.map((m) => ({ ...base, id: m.id, name: m.id, ...(m.mcpServers ? { mcpServers: m.mcpServers } : {}) })),
      { ...base, id: 'e2e-mcp-coord', name: 'MCP coordinator' }
    ];
    for (const p of personas) {
      const r = await window.cc.personas.save(p as any);
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
    const r = await window.cc.teams.save({
      id: 'e2e-mcp-team', name: 'MCP team', transport: 'MODERN', worktreeIsolation: true, routingEnforced: false,
      slots: members.map((m) => ({ personaId: m.id, quantity: 1 })), orchestratorPersonaId: 'e2e-mcp-coord'
    } as any);
    if (!r.ok) throw new Error(JSON.stringify(r));
  }, workers);
  await expect.poll(() => page.evaluate(async () =>
    (await (await fetch('/api/v1/threads/providers')).json()).providers.map((r: { id: string }) => r.id)
  ), { timeout: 30_000 }).toContain('claude-code');
  const started = await page.evaluate((input) => window.cc.teams.startJob(input),
    { teamId: 'e2e-mcp-team', projectId, title: 'mcp', goal: `implement ${plan}`, coordinationMode: 'freeform' as const });
  expect(started.ok, JSON.stringify(started)).toBe(true);
  await expect.poll(() => sessions(home).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(workers.length + 1);
  return sessions(home);
}

interface Notice { threadId: string; message: string }

/** `persona_mcp_allowlist` notices on the given threads, read through the product API (member threads are hidden from the list). */
async function notices(page: Page, threadIds: string[]): Promise<Notice[]> {
  return page.evaluate(async (ids) => {
    const out: Array<{ threadId: string; message: string }> = [];
    for (const id of ids) {
      const body = await (await fetch(`/api/v1/threads/${id}/events?limit=500`)).json();
      for (const event of (body.events ?? []) as Array<{ payload?: { operation?: string; message?: string } }>) {
        if (event.payload?.operation === 'persona_mcp_allowlist' && typeof event.payload.message === 'string') {
          out.push({ threadId: id, message: event.payload.message });
        }
      }
    }
    return out;
  }, threadIds);
}

const threadIds = (home: string): string[] => [...new Set(sessions(home).flatMap((s) => (s.threadId ? [s.threadId] : [])))];

/** Wait until `want` threads carry a notice; returns one notice per thread. */
async function noticeSet(page: Page, want: number, home: string): Promise<Notice[]> {
  let found: Notice[] = [];
  await expect.poll(async () => { found = await notices(page, threadIds(home)); return found.length; }, { timeout: 30_000 }).toBeGreaterThanOrEqual(want);
  return [...new Map(found.map((n) => [n.threadId, n])).values()];
}

test('restricted worker gets a notice naming its servers and the limit; coordinator gets none', async ({ app }) => {
  const { window: page, home } = app;
  const all = await runModernTeam(page, home, [{ id: 'e2e-mcp-worker', mcpServers: [USER_ALLOWED] }]);
  const found = await noticeSet(page, 1, home);
  expect(found).toHaveLength(1);
  expect(found[0].message).toContain(USER_ALLOWED);
  expect(found[0].message).not.toContain(USER_BLOCKED);
  expect(found[0].message).toMatch(/restricts MCP servers to/);
  // The limit is stated, not implied: the agent's own servers cannot be excluded here.
  expect(found[0].message).toMatch(/stay available|not filtered/);
  // Every spawned session was handed no user-server definitions through argv.
  expect(JSON.stringify(all.map((s) => s.argv))).not.toContain(USER_BLOCKED);
});

test('empty list worker: notice says no extra servers', async ({ app }) => {
  const { window: page, home } = app;
  await runModernTeam(page, home, [{ id: 'e2e-mcp-worker', mcpServers: [] }]);
  const found = await noticeSet(page, 1, home);
  expect(found).toHaveLength(1);
  expect(found[0].message).toContain('no extra servers');
});

test('two workers with different lists get different notices', async ({ app }) => {
  const { window: page, home } = app;
  await runModernTeam(page, home, [
    { id: 'e2e-mcp-w-a', mcpServers: [USER_ALLOWED] },
    { id: 'e2e-mcp-w-b', mcpServers: [USER_BLOCKED] }
  ]);
  const found = await noticeSet(page, 2, home);
  expect(found).toHaveLength(2);
  const texts = found.map((n) => n.message);
  expect(texts.some((m) => m.includes(USER_ALLOWED) && !m.includes(USER_BLOCKED))).toBe(true);
  expect(texts.some((m) => m.includes(USER_BLOCKED) && !m.includes(USER_ALLOWED))).toBe(true);
});

test('allowlisted-but-missing server does not block the Squad launch', async ({ app }) => {
  const { window: page, home } = app;
  await runModernTeam(page, home, [{ id: 'e2e-mcp-worker', mcpServers: [USER_ALLOWED, MISSING_SERVER] }]);
  const found = await noticeSet(page, 1, home);
  expect(found[0].message).toContain(MISSING_SERVER);
});
