import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { skillAllowlistCovers } from '@zana-ai/zcc-domain/product';
import { resolveSkillSettings } from '../skill-allowlist-settings.js';

/**
 * Real-CLI proof (no model call): the `--settings` keys we emit must shrink the
 * stream-json `init` skill list to the allowlist plus Claude's own built-ins.
 * Skips where `claude` is unavailable or on CI (it reads the developer's real
 * ~/.claude inventory, so the assertion is relative, never an absolute count).
 */
const hasClaude = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;

interface Init { skills: string[]; plugins: Array<{ name: string }>; slash_commands?: string[] }

function readInit(settings?: unknown): Promise<Init> {
  return new Promise((resolve, reject) => {
    const args = ['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'];
    if (settings) args.push('--settings', JSON.stringify(settings));
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude init timed out')); }, 45_000);
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        try {
          const msg = JSON.parse(line) as { subtype?: string } & Init;
          if (msg.subtype === 'init') { clearTimeout(timer); child.kill(); resolve(msg); return; }
        } catch { /* partial line */ }
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

describe.skipIf(!hasClaude || !!process.env.CI)('claude init honours the allowlist settings', () => {
  it('keeps no plugin-qualified skill when only zcc-inbox is allowed', async () => {
    const base = await readInit();
    const resolved = await resolveSkillSettings({ allowlist: ['zcc-inbox'] });
    if (!resolved.settings) return; // nothing installed to trim on this machine
    const lean = await readInit(resolved.settings);
    expect(lean.skills.length).toBeLessThanOrEqual(base.skills.length);
    const enabledOff = new Set(Object.keys(resolved.settings.enabledPlugins ?? {}).map((id) => id.split('@')[0]));
    for (const skill of lean.skills) {
      const prefix = skill.includes(':') ? skill.split(':')[0] : undefined;
      if (prefix) expect(enabledOff.has(prefix), `${skill} should be off`).toBe(false);
    }
    for (const off of Object.keys(resolved.settings.skillOverrides ?? {})) {
      expect(lean.skills).not.toContain(off);
      expect(lean.slash_commands ?? []).not.toContain(off); // user commands too
    }
    // Every plugin we switched off (MCP-only ones included) is gone from the session.
    const leanPlugins = new Set(lean.plugins.map((p) => p.name));
    for (const prefix of enabledOff) expect(leanPlugins.has(prefix), `${prefix} plugin should be off`).toBe(false);
    // Only partly-allowed / un-enumerable plugins may still contribute qualified skills. A qualified
    // skill the allowlist itself keeps (zcc-inbox, even from a plugin that ships only it) is fine.
    const stillQualified = lean.skills
      .filter((s) => s.includes(':') && skillAllowlistCovers(['zcc-inbox'], s) === false)
      .map((s) => s.split(':')[0]);
    const tolerated = new Set(resolved.bestEffortPlugins.map((id) => id.split('@')[0]));
    for (const prefix of stillQualified) expect(tolerated.has(prefix), `${prefix} left on unexpectedly`).toBe(true);
  }, 120_000);
});
