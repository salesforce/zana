import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverNativeSkillRoots,
  resolveClaudeNativeSkillRoots,
  resolveCodexNativeSkillRoots,
  resolveCursorVendorSkillRoots,
  resolveOpenCodeConfigSkillRoots,
  resolvePiNativeSkillRoots
} from './native-skill-discovery.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('native skill discovery', () => {
  it('resolves Cursor local and cache plugin skill roots', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-cursor-skills-'));
    dirs.push(home);
    const local = join(home, '.cursor', 'plugins', 'local', 'demo');
    mkdirSync(join(local, 'skills', 'hello'), { recursive: true });
    writeFileSync(join(local, 'plugin.json'), JSON.stringify({ name: 'demo', skills: 'skills' }));
    writeFileSync(join(local, 'skills', 'hello', 'SKILL.md'), '# hello\n');

    const cached = join(home, '.cursor', 'plugins', 'cache', 'market', 'pkg', '1.0.0');
    mkdirSync(join(cached, 'skills', 'cached'), { recursive: true });
    writeFileSync(join(cached, '.cache-complete'), '');
    writeFileSync(join(cached, 'plugin.json'), JSON.stringify({ name: 'pkg' }));
    writeFileSync(join(cached, 'skills', 'cached', 'SKILL.md'), '# cached\n');

    const stale = join(home, '.cursor', 'plugins', 'cache', 'market', 'pkg', '0.9.0');
    mkdirSync(join(stale, 'skills', 'stale'), { recursive: true });
    writeFileSync(join(stale, 'skills', 'stale', 'SKILL.md'), '# stale\n');

    expect(resolveCursorVendorSkillRoots(home).sort()).toEqual(
      [join(local, 'skills'), join(cached, 'skills')].sort()
    );
  });

  it('resolves OpenCode config dir skills including OPENCODE_CONFIG_DIR', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-opencode-skills-'));
    dirs.push(home);
    const defaultSkills = join(home, '.config', 'opencode', 'skills');
    mkdirSync(defaultSkills, { recursive: true });
    const custom = mkdtempSync(join(tmpdir(), 'zcc-opencode-custom-'));
    dirs.push(custom);
    mkdirSync(join(custom, 'skills'), { recursive: true });

    expect(resolveOpenCodeConfigSkillRoots(home, {})).toEqual([defaultSkills]);
    expect(
      resolveOpenCodeConfigSkillRoots(home, { OPENCODE_CONFIG_DIR: custom }).sort()
    ).toEqual([defaultSkills, join(custom, 'skills')].sort());
  });

  it('resolves Pi agent, .agents, and settings.json skill roots', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-pi-skills-'));
    dirs.push(home);
    const agentSkills = join(home, '.pi', 'agent', 'skills');
    const agentsSkills = join(home, '.agents', 'skills');
    mkdirSync(agentSkills, { recursive: true });
    mkdirSync(agentsSkills, { recursive: true });
    const extra = mkdtempSync(join(tmpdir(), 'zcc-pi-extra-skills-'));
    dirs.push(extra);
    writeFileSync(
      join(home, '.pi', 'agent', 'settings.json'),
      JSON.stringify({ skills: [extra, 'npm:ignored', '!skip'] })
    );

    expect(resolvePiNativeSkillRoots(home, {}).sort()).toEqual(
      [agentSkills, agentsSkills, extra].sort()
    );

    const customAgent = mkdtempSync(join(tmpdir(), 'zcc-pi-agent-'));
    dirs.push(customAgent);
    mkdirSync(join(customAgent, 'skills'), { recursive: true });
    expect(
      resolvePiNativeSkillRoots(home, { PI_CODING_AGENT_DIR: customAgent })
    ).toEqual(expect.arrayContaining([join(customAgent, 'skills')]));
  });

  it('tags discovered roots for ACP and Pi', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-native-all-'));
    dirs.push(home);
    mkdirSync(join(home, '.config', 'opencode', 'skills'), { recursive: true });
    mkdirSync(join(home, '.pi', 'agent', 'skills'), { recursive: true });
    const discovered = discoverNativeSkillRoots({ homeDir: home, env: {} });
    expect(discovered.some((root) => root.providerId === 'acp')).toBe(true);
    expect(discovered.some((root) => root.providerId === 'pi')).toBe(true);
  });

  it('resolves Claude skills, commands, and enabled plugin skill dirs', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-claude-skills-'));
    dirs.push(home);
    const skills = join(home, '.claude', 'skills');
    const commands = join(home, '.claude', 'commands');
    const pluginRoot = join(home, 'moved-plugin');
    mkdirSync(skills, { recursive: true });
    mkdirSync(commands, { recursive: true });
    mkdirSync(join(pluginRoot, 'skills'), { recursive: true });
    mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'moved', skills: 'skills' }));
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: { 'moved@market': [{ scope: 'user', installPath: pluginRoot }] }
      })
    );
    expect(resolveClaudeNativeSkillRoots(home, {}).sort()).toEqual(
      [skills, commands, join(pluginRoot, 'skills')].sort()
    );
  });

  it('resolves Codex skills and enabled plugin cache roots', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-codex-skills-'));
    dirs.push(home);
    const codexHome = join(home, 'codex-home');
    const skills = join(codexHome, 'skills');
    const agents = join(home, '.agents', 'skills');
    mkdirSync(skills, { recursive: true });
    mkdirSync(agents, { recursive: true });
    const plugin = join(codexHome, 'plugins', 'cache', 'market', 'demo', '1.0.0');
    mkdirSync(join(plugin, 'skills', 'hello'), { recursive: true });
    mkdirSync(join(plugin, '.codex-plugin'), { recursive: true });
    writeFileSync(join(plugin, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', skills: 'skills' }));
    writeFileSync(join(codexHome, 'config.toml'), '[plugins."demo@market"]\nenabled = true\n');
    expect(
      resolveCodexNativeSkillRoots(home, { CODEX_HOME: codexHome }).sort()
    ).toEqual([skills, agents, join(plugin, 'skills')].sort());
  });

  it('discovers omp, grok, and hermes home skill trees', () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-extra-acp-skills-'));
    dirs.push(home);
    const omp = join(home, '.omp', 'skills');
    const grok = join(home, '.grok', 'skills');
    const hermes = join(home, '.hermes', 'skills');
    mkdirSync(omp, { recursive: true });
    mkdirSync(grok, { recursive: true });
    mkdirSync(hermes, { recursive: true });
    const discovered = discoverNativeSkillRoots({ homeDir: home, env: {} });
    const paths = discovered.flatMap((root) =>
      'skillDirectoryRootPath' in root ? [root.skillDirectoryRootPath] : []
    );
    expect(paths.sort()).toEqual(expect.arrayContaining([omp, grok, hermes]));
  });
});
