/**
 * Persona MCP allowlist, Claude CLI/PTY path (built Electron).
 *
 * A fake `claude` records the argv the production PTY path gives it and the contents of the
 * per-session `--mcp-config` file at start. A restricted persona must launch with
 * `--strict-mcp-config` and a file naming exactly the allowlisted servers plus `zcc-inbox`; `[]`
 * leaves `zcc-inbox` alone; an unset persona is not strict and not restricted. A missing server
 * warns without blocking, credential fields never reach the file, and two concurrent sessions
 * with different lists keep separate files.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import {
  CRED_SECRET, MISSING_SERVER, USER_ALLOWED, USER_BLOCKED, USER_CREDENTIALED, cliMcpStub, seedMcpInventory
} from './fixtures/mcp-allowlist.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(120_000);

interface Recorded { argv: string[]; mcpConfig: { mcpServers?: Record<string, Record<string, unknown>>; error?: string } | null }

async function setup(page: Page, home: string) {
  seedMcpInventory(home);
  const dir = join(home, 'mcp-allowlist-cli-project');
  mkdirSync(dir);
  const binary = join(dir, 'claude-stub.cjs');
  writeFileSync(binary, `#!${process.execPath}\n${cliMcpStub}`);
  chmodSync(binary, 0o755);
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, dir);
  await page.evaluate((b) => window.cc.config.set({ claudeBinary: b }), binary);
  await page.evaluate(async (names) => {
    const base = { baseProfile: 'claude', model: 'sonnet', permissionMode: 'default' } as const;
    for (const persona of [
      { ...base, id: 'e2e-mcp-listed', name: 'Listed', mcpServers: [names.allowed] },
      { ...base, id: 'e2e-mcp-other', name: 'Other', mcpServers: [names.blocked] },
      { ...base, id: 'e2e-mcp-lean', name: 'Lean', mcpServers: [] },
      { ...base, id: 'e2e-mcp-unset', name: 'Unset' },
      { ...base, id: 'e2e-mcp-missing', name: 'Missing', mcpServers: [names.allowed, names.missing] },
      { ...base, id: 'e2e-mcp-cred', name: 'Cred', mcpServers: [names.cred] }
    ]) {
      const result = await window.cc.personas.save(persona as any);
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
  }, { allowed: USER_ALLOWED, blocked: USER_BLOCKED, missing: MISSING_SERVER, cred: USER_CREDENTIALED });
  return { dir, projectId };
}

function launcher(page: Page, dir: string, projectId: string) {
  return async (personaId: string) => {
    const before = new Set(readdirSync(dir).filter((f) => f.startsWith('argv-')));
    const id = await page.evaluate(async ({ projectId, personaId }) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'claude', personaId, cols: 100, rows: 32 });
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, { projectId, personaId });
    let file = '';
    await expect.poll(() => {
      file = readdirSync(dir).find((f) => f.startsWith('argv-') && !before.has(f)) ?? '';
      return file && existsSync(join(dir, file)) ? file : '';
    }, { timeout: 30_000 }).not.toBe('');
    // The file is written in one call, but poll the parse to avoid a torn read.
    let rec: Recorded | undefined;
    await expect.poll(() => { try { rec = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { rec = undefined; } return rec !== undefined; }).toBe(true);
    return { id, rec: rec! };
  };
}

const serversOf = (rec: Recorded) => Object.keys(rec.mcpConfig?.mcpServers ?? {}).sort();

test('allowlisted persona: strict mode, file holds exactly the allowlisted servers plus zcc-inbox', async ({ app }) => {
  const { window: page, home } = app;
  const { dir, projectId } = await setup(page, home);
  const launch = launcher(page, dir, projectId);

  const listed = await launch('e2e-mcp-listed');
  expect(listed.rec.argv).toContain('--strict-mcp-config');
  expect(serversOf(listed.rec)).toEqual(['mcp-alpha', 'zcc-inbox']);
  expect(serversOf(listed.rec)).not.toContain(USER_BLOCKED);
  expect(listed.rec.mcpConfig?.mcpServers?.[USER_ALLOWED]).toMatchObject({ command: 'node' });

  const lean = await launch('e2e-mcp-lean');
  expect(lean.rec.argv).toContain('--strict-mcp-config');
  expect(serversOf(lean.rec)).toEqual(['zcc-inbox']);

  // Unset persona: neither strict nor restricted; user servers are not copied into Zana's file.
  const unset = await launch('e2e-mcp-unset');
  expect(unset.rec.argv).not.toContain('--strict-mcp-config');
  expect(serversOf(unset.rec)).toContain('zcc-inbox');
  expect(serversOf(unset.rec)).not.toContain(USER_ALLOWED);

  for (const { id } of [listed, lean, unset]) await page.evaluate((s) => window.cc.terminals.close(s), id);
});

test('missing allowlisted server warns on the terminal and does not block the launch', async ({ app }) => {
  const { window: page, home } = app;
  const { dir, projectId } = await setup(page, home);
  const { id, rec } = await launcher(page, dir, projectId)('e2e-mcp-missing');
  // Launch proceeded; the present server is delivered, the missing one is simply absent.
  expect(serversOf(rec)).toEqual(['mcp-alpha', 'zcc-inbox']);
  await expect.poll(() => page.evaluate((s) => window.cc.terminals.backlog(s), id), { timeout: 15_000 }).toContain(MISSING_SERVER);
  await page.evaluate((s) => window.cc.terminals.close(s), id);
});

test('credentialed user server is delivered without env or headers and the launch warns by name', async ({ app }) => {
  const { window: page, home } = app;
  const { dir, projectId } = await setup(page, home);
  const { id, rec } = await launcher(page, dir, projectId)('e2e-mcp-cred');
  expect(serversOf(rec)).toEqual([USER_CREDENTIALED, 'zcc-inbox']);
  const def = rec.mcpConfig?.mcpServers?.[USER_CREDENTIALED] ?? {};
  expect(def).not.toHaveProperty('env');
  expect(def).not.toHaveProperty('headers');
  expect(JSON.stringify(rec)).not.toContain(CRED_SECRET);
  await expect.poll(() => page.evaluate((s) => window.cc.terminals.backlog(s), id), { timeout: 15_000 }).toContain(USER_CREDENTIALED);
  const text = await page.evaluate((s) => window.cc.terminals.backlog(s), id);
  expect(text).toContain(USER_CREDENTIALED);
  expect(text).not.toContain(CRED_SECRET);
  await page.evaluate((s) => window.cc.terminals.close(s), id);
});

test('two concurrent sessions with different lists keep separate server sets', async ({ app }) => {
  const { window: page, home } = app;
  const { dir, projectId } = await setup(page, home);
  const launch = launcher(page, dir, projectId);
  const a = await launch('e2e-mcp-listed');
  const b = await launch('e2e-mcp-other');
  // Both sessions are alive at once; each recorded its own file content.
  expect(serversOf(a.rec)).toEqual(['mcp-alpha', 'zcc-inbox']);
  expect(serversOf(b.rec)).toEqual(['mcp-beta', 'zcc-inbox']);
  const pathOf = (r: Recorded) => r.argv[r.argv.indexOf('--mcp-config') + 1];
  expect(pathOf(a.rec)).not.toBe(pathOf(b.rec));
  for (const { id } of [a, b]) await page.evaluate((s) => window.cc.terminals.close(s), id);
});

test('renderer cannot inject an unregistered server definition through a persona', async ({ app }) => {
  const { window: page, home } = app;
  const { dir, projectId } = await setup(page, home);
  // Definitions (objects) and glob/control names are refused or dropped at the store boundary.
  const saved = await page.evaluate(async () => {
    const base = { baseProfile: 'claude', model: 'sonnet', permissionMode: 'default' } as const;
    const results: Array<{ ok: boolean }> = [];
    for (const mcpServers of [[{ command: 'evil', args: [] }], ['bad*glob']]) {
      try { results.push(await window.cc.personas.save({ ...base, id: 'e2e-mcp-inject', name: 'Inject', mcpServers } as any) as any); }
      catch { results.push({ ok: false }); }
    }
    const stored = (await window.cc.personas.list()).find((p) => p.id === 'e2e-mcp-inject');
    return { results, stored: stored?.mcpServers ?? null };
  });
  expect(saved.stored === null || (Array.isArray(saved.stored) && saved.stored.every((s) => typeof s === 'string' && !s.includes('*')))).toBe(true);
  // A well-formed but unregistered name is only a name: it never becomes a server definition.
  await page.evaluate(async (name) => {
    const r = await window.cc.personas.save({ baseProfile: 'claude', model: 'sonnet', permissionMode: 'default', id: 'e2e-mcp-ghost', name: 'Ghost', mcpServers: [name] } as any);
    if (!r.ok) throw new Error(JSON.stringify(r));
  }, 'ghost-server');
  const { id, rec } = await launcher(page, dir, projectId)('e2e-mcp-ghost');
  expect(serversOf(rec)).toEqual(['zcc-inbox']);
  await page.evaluate((s) => window.cc.terminals.close(s), id);
});
