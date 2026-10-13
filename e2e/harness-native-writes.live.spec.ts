import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test, expect, trustProjectInSandbox } from './fixtures/app.js';

test.describe('real CLI write repair verification', () => {
  test.skip(process.env.ZCC_LIVE_HARNESS_WRITES !== '1', 'Opt in to real authenticated CLI calls');
  test.use({
    initialConfig: { sponsorPromptDismissed: true },
    launchEnv: async ({ home }, use) => {
      // Copy only native authentication/settings into the isolated HOME;
      // neither the application nor a CLI writes to the user's originals.
      for (const file of ['.claude.json', '.claude/settings.json', '.claude/.credentials.json',
        '.cursor/cli-config.json', '.cursor/agent-cli-state.json', '.cursor/auth.json', '.codex/config.toml', '.codex/auth.json']) {
        const source = join(homedir(), file);
        if (existsSync(source)) {
          const target = join(home, file);
          mkdirSync(join(target, '..'), { recursive: true });
          cpSync(source, target);
        }
      }
      const settingsPath = join(home, '.claude', 'settings.json');
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        // Personal hooks/plugins reference the real HOME. The production PTY
        // injects its own policy hooks; this test must exercise those hooks.
        for (const key of ['hooks', 'enabledPlugins', 'extraKnownMarketplaces', 'mcpServers', 'statusLine']) delete settings[key];
        writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 });
      }
      const socket = join(homedir(), '.devbar', 'devbar.sock');
      if (existsSync(socket)) {
        mkdirSync(join(home, '.devbar'), { recursive: true });
        symlinkSync(socket, join(home, '.devbar', 'devbar.sock'));
      }
      await use({ NO_OPEN_BROWSER: '1' });
    }
  });
  for (const profile of ['claude', 'cursor', 'codex'] as const) {
    test(`${profile} creates the requested file through the production PTY`, async ({ app }, testInfo) => {
      test.setTimeout(120_000);
      test.skip(profile === 'cursor' && !existsSync(join(homedir(), '.cursor', 'auth.json'))
        && !process.env.CURSOR_API_KEY && !process.env.CURSOR_AUTH_TOKEN,
      'Isolated HOME requires a file-based Cursor login or an auth environment variable');
      test.skip(profile === 'codex' && !existsSync(join(homedir(), '.codex', 'auth.json'))
        && !process.env.OPENAI_API_KEY,
      'Isolated HOME requires a file-based Codex login or OPENAI_API_KEY');
      const { window, home } = app;
      const dir = join(home, `write-${profile}`);
      mkdirSync(dir);
      writeFileSync(join(dir, 'README.md'), '# Isolated CLI write test\n');
      if (profile === 'claude') trustProjectInSandbox(home, realpathSync(dir));
      const binary = execFileSync('/usr/bin/which', [profile === 'cursor' ? 'cursor-agent' : profile], { encoding: 'utf8' }).trim();
      expect(existsSync(binary), `Missing real ${profile} binary`).toBe(true);
      await window.evaluate(({ profile, binary }) => window.cc.config.set({ [`${profile}Binary`]: binary }), { profile, binary });
      const projectId = await window.evaluate(async path => {
        const result = await window.cc.projects.add(path);
        if (!result.ok) throw new Error(result.message);
        return result.value.id;
      }, dir);
      const marker = `ZANA_WRITE_${profile}`;
      let sessionId: string | undefined;
      try {
        sessionId = await window.evaluate(async ({ projectId, profile, marker }) => {
          const result = await window.cc.terminals.create({
            projectId, profile, cols: 100, rows: 32,
            prompt: `Create marker.txt in the current directory with exactly ${marker}. Use a file-write tool, then stop.`,
            harnessRouting: { schemaVersion: 1, byAdapter: { [profile]: { executionState: 'autonomous' } } }
          });
          if (!result.ok) throw new Error(JSON.stringify(result));
          return result.value.id;
        }, { projectId, profile, marker });
        await expect.poll(() => {
          try { return readFileSync(join(dir, 'marker.txt'), 'utf8'); } catch { return ''; }
        }, { timeout: 75_000 }).toBe(marker);
      } finally {
        if (sessionId) {
          const backlog = await window.evaluate(id => window.cc.terminals.backlog(id), sessionId).catch(() => 'unavailable');
          await testInfo.attach('native-cli-output', { body: (typeof backlog === 'string' ? backlog : JSON.stringify(backlog)).slice(-12000), contentType: 'text/plain' });
          await window.evaluate(id => window.cc.terminals.close(id), sessionId).catch(() => undefined);
        }
      }
    });
  }
});
