/**
 * Squad cost plan, s3-wiring (AC3): Modern (Claude Agent SDK) skill allowlist.
 *
 * ZCC_CLAUDE_CODE_EXECUTABLE points the shipped claude-code bridge at a fake
 * `claude` that speaks stream-json and records argv plus every stdin message.
 * SDK 0.3.276 turns `Options.skills` into `Skill(<name>)` entries on `--allowedTools`, so
 * the recorded argv is the boundary where an allowlist is observable. A fake
 * cannot prove the real CLI filters; the opt-in live test does that and settles
 * which plugin-skill name form the SDK matches:
 *   ZCC_LIVE_SKILL_ALLOWLIST=1 pnpm test:e2e -- e2e/squad-skill-allowlist.spec.ts
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect } from './fixtures/app.js';
import { MIXED_ID, SKILLS_ONLY_ID, seedSkillInventory } from './fixtures/skill-allowlist.js';

const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'skill-allowlist-bin');
    const logs = join(home, 'skill-allowlist-logs');
    mkdirSync(bin, { recursive: true });
    mkdirSync(logs, { recursive: true });
    const fake = join(bin, 'claude');
    writeFileSync(fake, `#!${process.execPath}
const fs = require('node:fs');
const { createInterface } = require('node:readline');
if (process.argv.includes('--version')) { console.log('2.1.316 (Claude Code)'); process.exit(0); }
const log = ${JSON.stringify(logs)} + '/' + process.pid + '.jsonl';
const write = (kind, value) => fs.appendFileSync(log, JSON.stringify({ kind, value }) + '\\n');
write('argv', { argv: process.argv.slice(2), cwd: process.cwd() });
let skills = [];
const MODELS = ['default:Sonnet 5:claude-sonnet-5','sonnet:Sonnet 5:claude-sonnet-5','haiku:Haiku 4.5:claude-haiku-4-5','opus:Opus 5.5:claude-opus-5-5'].map(r => { const [value, displayName, resolvedModel] = r.split(':'); return { value, displayName, resolvedModel, description: displayName, supportedEffortLevels: ['low','medium','high'] }; });
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  write('in', msg);
  if (msg.type === 'control_request') {
    if (msg.request.subtype === 'initialize' && Array.isArray(msg.request.skills)) skills = msg.request.skills;
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id,
      response: msg.request.subtype === 'initialize' ? { commands: [], agents: [], models: MODELS, output_style: 'default', available_output_styles: ['default'], account: {} } : {} } });
  } else if (msg.type === 'user') {
    out({ type: 'system', subtype: 'init', session_id: 'fake-skills-session', skills, plugins: [], mcp_servers: [], tools: [], model: 'fake', cwd: process.cwd(), permissionMode: 'default', slash_commands: [], apiKeySource: 'none' });
    out({ type: 'assistant', session_id: 'fake-skills-session', message: { id: 'm1', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } });
    out({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-skills-session', result: 'ok', duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
  }
});
`);
    chmodSync(fake, 0o755);
    await use({ ZCC_CLAUDE_CODE_EXECUTABLE: fake });
  }
});

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true, tmuxScope: 'off', autoRenameTabs: false } });
test.setTimeout(120_000);


interface Session { argv: string[]; worked: boolean }

/** Every fake-claude process the app has spawned, with whether it received a user turn. */
function sessions(home: string): Session[] {
  const dir = join(home, 'skill-allowlist-logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const argv = lines.find((l) => l.kind === 'argv')?.value.argv as string[] | undefined;
    // Catalog probes never receive a user message; only real work sessions count.
    return argv ? [{ argv, worked: lines.some((l) => l.kind === 'in' && l.value.type === 'user') }] : [];
  }).filter((s) => s.worked);
}

/**
 * Skills the SDK handed the CLI. SDK 0.3.276 turns `Options.skills` into
 * `Skill(<name>)` entries on `--allowedTools` (it is not in the initialize request),
 * so that argv entry is the observable boundary. `undefined` = no Skill entries (unrestricted).
 */
function skillsOf(session: Session): string[] | undefined {
  const i = session.argv.indexOf('--allowedTools');
  const entries = i < 0 ? [] : session.argv[i + 1].split(',');
  const skills = entries.flatMap((e) => {
    const m = /^Skill\((.*)\)$/.exec(e);
    return m ? [m[1].replace(/\\(.)/g, '$1')] : [];
  });
  return skills.length ? skills : undefined;
}

/**
 * Launch a MODERN Team (the only Modern path that applies personas) with one worker
 * and one unrestricted coordinator, then wait for both Modern sessions to run.
 * Standalone Modern threads do not apply personas, so Team launch is the real seam.
 */
async function runModernTeam(page: Page, home: string, opts: { workerSkills?: string[]; lean?: boolean }) {
  seedSkillInventory(home);
  // The same fake backs the SDK bridge (env) and the CLI health/model probes (config).
  await page.evaluate((bin) => window.cc.config.set({ claudeBinary: bin, defaultHarness: 'claude' }),
    join(home, 'skill-allowlist-bin', 'claude'));
  const root = join(home, 'skill-allowlist-project');
  mkdirSync(root, { recursive: true });
  const plan = join(root, 'plan.md');
  writeFileSync(plan, [
    '# Skill allowlist probe', '', '### inspect: Inspect <!-- executable-step -->',
    '- **Work:** Report SKILL_PROBE after reading README.md.', '- **Depends on:** None',
    '- **Mode:** read-only', '- **Verification:** README.md exists.', ''
  ].join('\n'));
  writeFileSync(join(root, 'README.md'), 'skill allowlist fixture\n');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, env: { ...process.env, HOME: home } });
  git('init', '-b', 'main'); git('add', '.');
  git('-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test', 'commit', '-m', 'fixture');
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, root);
  await page.evaluate(async ({ workerSkills, lean }) => {
    const base = { baseProfile: 'claude', model: 'sonnet', permissionMode: 'default' } as const;
    for (const p of [
      { ...base, id: 'e2e-skill-worker', name: 'Skill worker', ...(workerSkills ? { skills: workerSkills } : {}) },
      { ...base, id: 'e2e-skill-coord', name: 'Skill coordinator' }
    ]) {
      const r = await window.cc.personas.save(p as any);
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
    const r = await window.cc.teams.save({
      id: 'e2e-skill-team', name: 'Skill team', transport: 'MODERN', ...(lean ? { leanWorkers: true } : {}),
      worktreeIsolation: true, routingEnforced: false,
      slots: [{ personaId: 'e2e-skill-worker', quantity: 1 }], orchestratorPersonaId: 'e2e-skill-coord'
    } as any);
    if (!r.ok) throw new Error(JSON.stringify(r));
  }, opts);
  await expect.poll(() => page.evaluate(async () =>
    (await (await fetch('/api/v1/threads/providers')).json()).providers.map((r: { id: string }) => r.id)
  ), { timeout: 30_000 }).toContain('claude-code');
  const started = await page.evaluate((input) => window.cc.teams.startJob(input),
    { teamId: 'e2e-skill-team', projectId, title: 'skills', goal: `implement ${plan}`, coordinationMode: 'structured' as const });
  expect(started.ok, JSON.stringify(started)).toBe(true);
  await expect.poll(() => sessions(home).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  return sessions(home).map(skillsOf);
}

test('restricted worker persona: SDK session gets only allowlisted skills (+ zcc-inbox); coordinator stays unrestricted', async ({ app }) => {
  const { window: page, home } = app;
  const all = await runModernTeam(page, home, { workerSkills: ['allowed-user', 'mixed:mixed-skill'] });
  // AC3: exactly one session carries a filter; it contains the allowlist and zcc-inbox only.
  const filtered = all.filter((s): s is string[] => s !== undefined);
  expect(filtered).toHaveLength(1);
  expect(filtered[0]).toEqual(expect.arrayContaining(['allowed-user', 'mixed:mixed-skill', 'zcc-inbox']));
  expect(filtered[0]).not.toContain('blocked-user');
  expect(JSON.stringify(filtered[0])).not.toContain('only-skill');
  // AC3: unset persona (coordinator) = unrestricted.
  expect(all.some((s) => s === undefined)).toBe(true);
});

test('skills-only vs mixed plugin: Modern filters by Options.skills and never disables plugins', async ({ app }) => {
  const { window: page, home } = app;
  const all = await runModernTeam(page, home, { workerSkills: ['skills-only:only-skill'] });
  const filtered = all.filter((s): s is string[] => s !== undefined);
  expect(filtered).toHaveLength(1);
  expect(filtered[0]).toEqual(expect.arrayContaining(['skills-only:only-skill', 'zcc-inbox']));
  expect(filtered[0]).not.toContain('mixed:mixed-skill');
  // Plugin enablement (enabledPlugins) is the CLI mechanism; the SDK path must not emit it, so the
  // mixed plugin's hooks + MCP server are never switched off by Zana.
  const blob = JSON.stringify(sessions(home));
  expect(blob).not.toContain(`"${MIXED_ID}":false`);
  expect(blob).not.toContain(`"${SKILLS_ONLY_ID}":false`);
});

test('lean Team: worker with unset skills gets [zcc-inbox]; coordinator unrestricted', async ({ app }) => {
  const { window: page, home } = app;
  const all = await runModernTeam(page, home, { lean: true });
  // AC5 (resolution half): one Modern worker session is lean, the coordinator is not.
  expect(all.filter((s) => s !== undefined).map((s) => JSON.stringify(s))).toEqual(['["zcc-inbox",":zcc-inbox"]']);
  expect(all.some((s) => s === undefined)).toBe(true);
});

test.describe('real claude SDK name form (settles bare vs plugin:name)', () => {
  test.skip(process.env.ZCC_LIVE_SKILL_ALLOWLIST !== '1', 'Opt in: runs the real, authenticated claude CLI');
  test('Options.skills matches plugin skills by qualified name; result recorded', async ({ app }, testInfo) => {
    const { home } = app;
    const { plugins } = seedSkillInventory(home);
    for (const f of ['.claude.json', '.claude/.credentials.json']) {
      const src = join(homedir(), f);
      if (existsSync(src)) { mkdirSync(join(home, f, '..'), { recursive: true }); cpSync(src, join(home, f)); }
    }
    const claude = execFileSync('/usr/bin/which', ['claude'], { encoding: 'utf8' }).trim();
    // Same argv the SDK builds from Options.skills (Skill(<name>) allowedTools) plus initialize{skills}, then one user message, read the init message.
    const probe = (skills: string[]) => new Promise<string[]>((resolve, reject) => {
      const child = spawn(claude, ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
        '--allowedTools', skills.map((n) => `Skill(${n})`).join(','),
        '--plugin-dir', plugins[MIXED_ID], '--plugin-dir', plugins[SKILLS_ONLY_ID]],
      { cwd: home, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill(); reject(new Error('no init message in 60s')); }, 60_000);
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        for (const line of buf.split('\n')) {
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'system' && msg.subtype === 'init') { clearTimeout(timer); child.kill(); resolve(msg.skills ?? []); return; }
          } catch { /* partial */ }
        }
      });
      child.on('error', reject);
      child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', skills } }) + '\n');
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok' } }) + '\n');
    });
    const qualified = await probe(['mixed:mixed-skill']);
    const bare = await probe(['mixed-skill']);
    const form = qualified.some((s) => s.includes('mixed-skill')) ? (bare.some((s) => s.includes('mixed-skill')) ? 'both' : 'plugin:name') : bare.some((s) => s.includes('mixed-skill')) ? 'bare' : 'neither';
    testInfo.annotations.push({ type: 'plugin-skill-name-form', description: form });
    console.log(`PLUGIN_SKILL_NAME_FORM=${form}`);
    // Zana forwards allowlist entries verbatim, and persona docs/D3 promise `plugin:skill` works.
    expect(qualified.join(' ')).toContain('mixed-skill');
    expect(qualified.join(' ')).not.toContain('only-skill');
    expect(qualified.join(' ')).not.toContain('blocked-user');
  });
});
