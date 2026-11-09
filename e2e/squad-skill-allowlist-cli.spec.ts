/**
 * Squad cost plan, s3b (AC4): Claude CLI/PTY skill allowlist.
 *
 * A fake `claude` records the argv the production PTY path gives it. A restricted
 * persona must carry `skillOverrides` (non-allowed user skills off) and
 * `enabledPlugins` (skills-only plugin off, mixed plugin left on) in `--settings`;
 * an unset persona must carry neither and its argv must otherwise match.
 *
 * The init-message count check (real claude 2.1.316) is opt-in:
 *   ZCC_LIVE_SKILL_ALLOWLIST=1 pnpm test:e2e -- e2e/squad-skill-allowlist-cli.spec.ts
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { MIXED_ID, SKILLS_ONLY_ID, seedSkillInventory } from './fixtures/skill-allowlist.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });
test.setTimeout(120_000);

const stub = String.raw`
const { writeFileSync } = require('node:fs');
if (process.argv.includes('--version')) { console.log('2.1.316 (Claude Code)'); process.exit(0); }
writeFileSync(process.cwd() + '/argv-' + process.pid + '.json', JSON.stringify(process.argv.slice(2)));
console.log('SKILL_ALLOWLIST_STUB_READY');
setInterval(() => {}, 1000);
`;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function settingsOf(argv: string[]): Record<string, any> {
  const i = argv.indexOf('--settings');
  expect(i, '--settings must be present').toBeGreaterThanOrEqual(0);
  const raw = argv[i + 1];
  return JSON.parse(raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8'));
}

test('CLI persona skill allowlist trims --settings; unset persona argv is unchanged', async ({ app }) => {
  const { window: page, home } = app;
  seedSkillInventory(home);
  const dir = join(home, 'skill-allowlist-cli-project');
  mkdirSync(dir);
  const binary = join(dir, 'claude-stub.cjs');
  writeFileSync(binary, `#!${process.execPath}\n${stub}`);
  chmodSync(binary, 0o755);
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, dir);
  await page.evaluate((b) => window.cc.config.set({ claudeBinary: b }), binary);
  await page.evaluate(async () => {
    const base = { baseProfile: 'claude', model: 'sonnet', permissionMode: 'default' } as const;
    for (const persona of [
      // Allows one user skill and one skill of the MIXED plugin only.
      { ...base, id: 'e2e-skills-restricted', name: 'Restricted', skills: ['allowed-user', 'mixed:mixed-skill'] },
      // Lean: nothing listed, only the always-allowed zcc-inbox remains.
      { ...base, id: 'e2e-skills-lean', name: 'Lean', skills: [] },
      { ...base, id: 'e2e-skills-unset', name: 'Unset' }
    ]) {
      const result = await window.cc.personas.save(persona as any);
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
  });

  const launch = async (personaId: string) => {
    const before = new Set(readdirSync(dir).filter((f) => f.startsWith('argv-')));
    const id = await page.evaluate(async ({ projectId, personaId }) => {
      const result = await window.cc.terminals.create({ projectId, profile: 'claude', personaId, cols: 100, rows: 32 });
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, { projectId, personaId });
    let file = '';
    await expect.poll(() => {
      file = readdirSync(dir).find((f) => f.startsWith('argv-') && !before.has(f)) ?? '';
      return file;
    }, { timeout: 30_000 }).not.toBe('');
    await expect.poll(() => existsSync(join(dir, file))).toBe(true);
    const argv: string[] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    await page.evaluate((id) => window.cc.terminals.close(id), id);
    return argv;
  };

  const restricted = await launch('e2e-skills-restricted');
  const lean = await launch('e2e-skills-lean');
  const unset = await launch('e2e-skills-unset');

  // AC4: non-allowed user skill and user command off, allowed skill untouched.
  const r = settingsOf(restricted);
  expect(r.skillOverrides).toMatchObject({ 'blocked-user': 'off', 'blocked-cmd': 'off' });
  expect(Object.keys(r.skillOverrides)).not.toContain('allowed-user');
  // Skills-only plugin has nothing allowed: off. Mixed plugin has its only skill allowed: stays on.
  expect(r.enabledPlugins).toEqual({ [SKILLS_ONLY_ID]: false });
  expect(Object.keys(r.enabledPlugins)).not.toContain(MIXED_ID);

  // Lean persona: every user skill/command and every plugin (incl. mixed hooks+MCP) is off.
  const l = settingsOf(lean);
  // (Zana's own injected user-level skills such as zcc-cli are inventoried too, so match, don't equal.)
  expect(l.skillOverrides).toMatchObject({ 'allowed-user': 'off', 'blocked-user': 'off', 'blocked-cmd': 'off' });
  expect(Object.keys(l.skillOverrides)).not.toContain('zcc-inbox');
  expect(l.enabledPlugins).toEqual({ [SKILLS_ONLY_ID]: false, [MIXED_ID]: false });
  expect(l.hooks).toBeTruthy();
  // Lean also drops user-level MCP (mcp-adaptor) via strict MCP; Zana's explicit --mcp-config stays.
  expect(lean).toContain('--strict-mcp-config');
  expect(lean).toContain('--mcp-config');
  expect(restricted).not.toContain('--strict-mcp-config');
  expect(unset).not.toContain('--strict-mcp-config');
  // Existing Zana hooks still emitted alongside the new keys.
  expect(r.hooks).toBeTruthy();

  // AC3/AC4: unset persona = unrestricted, argv otherwise identical.
  const u = settingsOf(unset);
  expect(u).not.toHaveProperty('skillOverrides');
  expect(u).not.toHaveProperty('enabledPlugins');
  const strip = (argv: string[]) => {
    const copy = [...argv];
    const i = copy.indexOf('--settings');
    const { skillOverrides: _a, enabledPlugins: _b, ...rest } = settingsOf(argv);
    copy[i + 1] = JSON.stringify(rest);
    return copy.join('\u0000').replace(UUID, '<id>').replaceAll('e2e-skills-restricted', 'P').replaceAll('e2e-skills-unset', 'P');
  };
  expect(strip(restricted)).toBe(strip(unset));
});

test.describe('real claude init message (AC4 counts)', () => {
  test.skip(process.env.ZCC_LIVE_SKILL_ALLOWLIST !== '1', 'Opt in: runs the real, authenticated claude CLI');
  test('init skills/plugins/mcp match the resolved allowlist; mixed plugin stays on', async ({ app }) => {
    const { home } = app;
    const { plugins } = seedSkillInventory(home);
    // Copy native auth only into the isolated HOME (never write the real one).
    for (const f of ['.claude.json', '.claude/.credentials.json']) {
      const src = join(homedir(), f);
      if (existsSync(src)) { mkdirSync(join(home, f, '..'), { recursive: true }); cpSync(src, join(home, f)); }
    }
    const claude = execFileSync('/usr/bin/which', ['claude'], { encoding: 'utf8' }).trim();
    const settings = JSON.stringify({
      skillOverrides: { 'blocked-user': 'off' },
      enabledPlugins: { [SKILLS_ONLY_ID]: false }
    });
    const init = await new Promise<any>((resolve, reject) => {
      const child = spawn(claude, ['-p', 'ok', '--output-format', 'stream-json', '--verbose', '--settings', settings,
        '--plugin-dir', plugins[MIXED_ID], '--plugin-dir', plugins[SKILLS_ONLY_ID]], {
        cwd: home, env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe']
      });
      let buf = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('no init message in 60s')); }, 60_000);
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        for (const line of buf.split('\n')) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'system' && msg.subtype === 'init') { clearTimeout(timer); child.kill(); resolve(msg); return; }
          } catch { /* partial line */ }
        }
      });
      child.on('error', reject);
    });
    expect(init.skills).toContain('allowed-user');
    expect(init.skills).not.toContain('blocked-user');
    expect(JSON.stringify(init.skills)).not.toContain('only-skill');
    expect(JSON.stringify(init.skills)).toContain('mixed-skill');
    expect(JSON.stringify(init.plugins)).toContain('mixed');
    expect(JSON.stringify(init.plugins)).not.toContain('skills-only');
    expect(JSON.stringify(init.mcp_servers)).toContain('fixture-mcp');
  });
});
