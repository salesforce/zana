import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePluginId, normalizeSkillsRootPaths, readPluginManifest } from '@zana-ai/zcc-domain';
import {
  BUNDLED_PLUGINS,
  BUILTIN_PLUGINS,
  OFFICIAL_PLUGINS,
  PLUGIN_CATALOG_CATEGORIES,
  RECLAIM_UNINSTALLED_AUTOINSTALL_IDS,
  RETIRED_FIRST_PARTY_PLUGIN_IDS,
  isRetiredFirstPartyPluginId
} from './builtin-registry.js';

const pluginsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../plugins');

/** Definition completeness only. github/workflows/automations/inline-vis stay installable stubs; bb feature ports are a separate decision. */

const EXPECTED_CATEGORIES: Record<string, (typeof PLUGIN_CATALOG_CATEGORIES)[number]> = {
  'ask-user-question': 'Agent interaction',
  automations: 'Workflow management',
  connect: 'Host access',
  'custom-instructions': 'Context & knowledge',
  docs: 'Context & knowledge',
  github: 'Developer tools',
  'harness-claude': 'Agent interaction',
  'harness-codex': 'Agent interaction',
  'harness-cursor': 'Agent interaction',
  'harness-opencode': 'Agent interaction',
  'harness-pi': 'Agent interaction',
  'harness-grok': 'Agent interaction',
  'inline-vis': 'Interface',
  'keep-awake': 'Host access',
  memory: 'Context & knowledge',
  'monaco-editor': 'Interface',
  'pdf-preview': 'Interface',
  'plugin-guide': 'Developer tools',
  'pr-monitor': 'Developer tools',
  'provider-acp': 'Agent interaction',
  'provider-claude-code': 'Agent interaction',
  'provider-codex': 'Agent interaction',
  'provider-pi': 'Agent interaction',
  'provider-retry': 'Agent interaction',
  salesforce: 'Developer tools',
  secrets: 'Host access',
  'side-chat': 'Agent interaction',
  tasks: 'Workflow management',
  workflows: 'Workflow management'
};

const EXPECTED_ICONS: Record<string, string> = {
  'ask-user-question': 'CircleHelp',
  automations: 'Workflow',
  connect: 'Cable',
  'custom-instructions': 'ScrollText',
  docs: 'Library',
  github: 'Github',
  'harness-claude': './icons/claude-code.svg',
  'harness-codex': './icons/codex.svg',
  'harness-cursor': './icons/cursor.svg',
  'harness-opencode': './icons/opencode.svg',
  'harness-pi': './icons/pi.svg',
  'harness-grok': './icons/grok.svg',
  'inline-vis': 'ChartNoAxesColumn',
  'keep-awake': 'Coffee',
  memory: 'Brain',
  'monaco-editor': 'Code',
  'pdf-preview': 'FileText',
  'plugin-guide': 'Puzzle',
  'pr-monitor': 'GitPullRequest',
  'provider-acp': './icons/cursor.svg',
  'provider-claude-code': './icons/claude-code.svg',
  'provider-codex': './icons/codex.svg',
  'provider-pi': './icons/pi.svg',
  'provider-retry': 'RotateCcw',
  salesforce: 'Cloud',
  secrets: 'KeyRound',
  'side-chat': 'MessagesSquare',
  tasks: 'ListTodo',
  workflows: 'GitBranch'
};

function pluginRoot(name: string): string {
  return join(pluginsRoot, name);
}

function resolvePluginPath(root: string, entry: string): string {
  return join(root, entry.replace(/^\.\//, ''));
}

describe('retired first-party plugins', () => {
  it('names the leftover hub rows and never overlaps the official catalog', () => {
    expect([...RETIRED_FIRST_PARTY_PLUGIN_IDS].sort()).toEqual([
      'consensus',
      'slack',
      'zana',
      'zana-hub'
    ]);
    const official = new Set(OFFICIAL_PLUGINS.map((plugin) => plugin.pluginId));
    for (const id of RETIRED_FIRST_PARTY_PLUGIN_IDS) {
      expect(official.has(id)).toBe(false);
      expect(isRetiredFirstPartyPluginId(id)).toBe(true);
    }
    expect(isRetiredFirstPartyPluginId('docs')).toBe(false);
    expect(isRetiredFirstPartyPluginId('salesforce')).toBe(false);
  });
});

describe('promoted autoInstall reclaim', () => {
  it('names Claude and Codex providers and keeps them autoInstall builtins', () => {
    expect([...RECLAIM_UNINSTALLED_AUTOINSTALL_IDS].sort()).toEqual([
      'provider-claude-code',
      'provider-codex'
    ]);
    const builtins = new Map(BUILTIN_PLUGINS.map((plugin) => [plugin.pluginId, plugin]));
    for (const id of RECLAIM_UNINSTALLED_AUTOINSTALL_IDS) {
      expect(builtins.get(id)?.autoInstall).toBe(true);
    }
  });
});

describe('bundled plugin registry invariants', () => {
  it('keeps official plugins bundled but out of the auto-install builtins', () => {
    const builtinNames = new Set(BUILTIN_PLUGINS.map((plugin) => plugin.name));
    for (const plugin of OFFICIAL_PLUGINS) {
      expect(plugin.autoInstall).toBe(false);
      expect(builtinNames.has(plugin.name)).toBe(false);
    }
    expect(BUILTIN_PLUGINS.every((plugin) => plugin.autoInstall)).toBe(true);
  });

  it('assigns every bundled plugin to one curated store category', () => {
    expect(new Set(BUNDLED_PLUGINS.map((plugin) => plugin.name)).size).toBe(BUNDLED_PLUGINS.length);
    expect(new Set(BUNDLED_PLUGINS.map((plugin) => plugin.pluginId)).size).toBe(BUNDLED_PLUGINS.length);
    expect(Object.fromEntries(BUNDLED_PLUGINS.map((plugin) => [plugin.name, plugin.category]))).toEqual(
      EXPECTED_CATEGORIES
    );
    const validCategories = new Set<string>(PLUGIN_CATALOG_CATEGORIES);
    expect(BUNDLED_PLUGINS.every((plugin) => validCategories.has(plugin.category ?? ''))).toBe(true);
  });

  it('gives every bundled plugin a deliberate settings icon', () => {
    expect(BUNDLED_PLUGINS).toHaveLength(Object.keys(EXPECTED_ICONS).length);
    for (const plugin of BUNDLED_PLUGINS) {
      const pkgPath = join(pluginRoot(plugin.name), 'package.json');
      const manifest = readPluginManifest(JSON.parse(readFileSync(pkgPath, 'utf8')));
      expect(manifest.branding.icon, plugin.name).toBe(EXPECTED_ICONS[plugin.name]);
    }
  });

  it('declares the plugin id each bundled manifest actually derives', () => {
    for (const plugin of BUNDLED_PLUGINS) {
      const root = pluginRoot(plugin.name);
      const pkgPath = join(root, 'package.json');
      expect(existsSync(pkgPath), `missing plugins/${plugin.name}/package.json`).toBe(true);
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; zcc?: { skills?: string[] } };
      const manifest = readPluginManifest(pkg);
      expect(derivePluginId(pkg.name), plugin.name).toBe(plugin.pluginId);
      expect(manifest.id, plugin.name).toBe(plugin.pluginId);

      for (const entry of [manifest.serverEntry, manifest.appEntry, manifest.hostEntry, manifest.ptyEntry]) {
        if (!entry) continue;
        expect(existsSync(resolvePluginPath(root, entry)), `${plugin.name} missing ${entry}`).toBe(true);
      }

      const icon = manifest.branding.icon;
      if (icon?.startsWith('./')) {
        expect(icon.toLowerCase().endsWith('.svg'), `${plugin.name} path icon must be svg`).toBe(true);
        expect(existsSync(resolvePluginPath(root, icon)), `${plugin.name} missing ${icon}`).toBe(true);
      }

      if (Array.isArray(pkg.zcc?.skills) && pkg.zcc.skills.length > 0) {
        for (const skillsRoot of normalizeSkillsRootPaths(pkg.zcc.skills)) {
          const dir = resolvePluginPath(root, skillsRoot);
          expect(existsSync(dir), `${plugin.name} missing skills root ${skillsRoot}`).toBe(true);
          expect(statSync(dir).isDirectory(), `${plugin.name} skills root ${skillsRoot} is not a directory`).toBe(
            true
          );
        }
      }
    }
  });
});
