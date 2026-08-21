import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callControlPlane, isAppRunning } from './control-client.js';

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

interface InstalledFile {
  version: 1;
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    status: string;
    source: string;
  }>;
}

function err(message: string, exitCode = 1): CliResult {
  return { exitCode, stdout: '', stderr: `Error: ${message}\n` };
}

function readInstalled(dataDir: string): InstalledFile {
  const file = join(dataDir, 'plugins', 'installed.json');
  if (!existsSync(file)) return { version: 1, plugins: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as InstalledFile;
    return Array.isArray(parsed.plugins) ? parsed : { version: 1, plugins: [] };
  } catch {
    return { version: 1, plugins: [] };
  }
}

async function live(
  dataDir: string,
  op: string,
  args: Record<string, unknown>,
  jsonOutput: boolean
): Promise<CliResult> {
  if (!isAppRunning(dataDir)) {
    return err('APP_NOT_RUNNING: start Zana Command Center to mutate plugins', 1);
  }
  const result = await callControlPlane({ dataDir, op, args });
  if (!result.ok) return err(result.message ?? result.code ?? 'control plane error', 1);
  if (jsonOutput) return { exitCode: 0, stdout: `${JSON.stringify(result.value, null, 2)}\n` };
  return { exitCode: 0, stdout: `${typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)}\n` };
}

export async function runPluginCommand(
  dataDir: string,
  subcommand: string | undefined,
  rest: string[],
  jsonOutput: boolean
): Promise<CliResult> {
  if (!subcommand || subcommand === 'ls' || subcommand === 'list') {
    const file = readInstalled(dataDir);
    if (jsonOutput) return { exitCode: 0, stdout: `${JSON.stringify(file.plugins, null, 2)}\n` };
    if (file.plugins.length === 0) return { exitCode: 0, stdout: 'No plugins installed.\n' };
    const lines = file.plugins.map(
      (p) => `${p.enabled ? '*' : ' '} ${p.id.padEnd(16)} ${p.status.padEnd(12)} ${p.version}  ${p.source}`
    );
    return { exitCode: 0, stdout: `${lines.join('\n')}\n` };
  }
  if (subcommand === 'install') {
    const source = rest[0];
    if (!source) return err('plugin install requires a source (path: | git: | npm: | builtin:)', 2);
    return live(dataDir, 'plugin.install', { source }, jsonOutput);
  }
  if (subcommand === 'enable' || subcommand === 'disable' || subcommand === 'remove' || subcommand === 'reload') {
    const id = rest[0];
    if (!id) return err(`plugin ${subcommand} requires a <pluginId>`, 2);
    return live(dataDir, `plugin.${subcommand}`, { id }, jsonOutput);
  }
  if (subcommand === 'new') {
    const name = rest[0];
    if (!name) return err('plugin new requires a <name>', 2);
    const dest = rest.includes('--dir')
      ? rest[rest.indexOf('--dir') + 1]
      : join(process.cwd(), name);
    if (!dest) return err('plugin new --dir requires a path', 2);
    mkdirSync(dest, { recursive: true });
    const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    writeFileSync(
      join(dest, 'package.json'),
      `${JSON.stringify(
        {
          name: `zcc-plugin-${id}`,
          version: '0.1.0',
          type: 'module',
          engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
          zcc: {
            name,
            description: `${name} plugin`,
            branding: { icon: 'Puzzle' },
            server: './server.mjs',
            app: './app.js',
            skills: ['skills'],
            extra: {
              notes: 'Forward-compat keys go here. Skills and MCP have first-class fields.'
            }
          }
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      join(dest, 'server.mjs'),
      `/** @typedef {import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi} ZccPluginApi */
export default function plugin(zcc) {
  zcc.log.info('${id} loaded');
  zcc.rpc.method('ping', () => ({ ok: true }));
}
`
    );
    writeFileSync(
      join(dest, 'app.js'),
      `import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: ${JSON.stringify(name)},
    icon: 'Puzzle',
    component: () => null
  });
});
`
    );
    writeFileSync(join(dest, 'README.md'), `# ${name}\n\nInstall with \`zcc plugin install ${dest}\`.\n`);
    writeFileSync(
      join(dest, 'CLAUDE.md'),
      `# ${name} plugin

This is a Zana Command Center plugin. Manifest lives in package.json → zcc.
Skills live in skills/<name>/SKILL.md (declared as zcc.skills: ["skills"]).
MCP servers belong in zcc.mcpServers; other notes go in zcc.extra.
Install with \`zcc plugin install ${dest}\`. Reload with \`zcc plugin reload ${id}\`.
Do not request host-daemon tokens. Fill the host panel slot (height 100%).
`
    );
    mkdirSync(join(dest, 'skills', 'hello'), { recursive: true });
    writeFileSync(
      join(dest, 'skills', 'hello', 'SKILL.md'),
      `---
name: hello
description: Sample skill shipped by the ${name} plugin.
---

Use this skill when the user asks about ${name}.
`
    );
    return { exitCode: 0, stdout: `Created plugin scaffold in ${dest}\n` };
  }
  if (subcommand === 'dev') {
    const dir = rest[0] ?? process.cwd();
    if (!existsSync(join(dir, 'package.json'))) {
      return err('plugin dev requires a package.json in the directory', 2);
    }
    const installed = await live(dataDir, 'plugin.install', { source: dir }, jsonOutput);
    if (installed.exitCode !== 0) return installed;
    return {
      exitCode: 0,
      stdout: `${installed.stdout}Watching ${dir}. Re-run \`zcc plugin reload <id>\` after edits (live watch requires a running app).\n`
    };
  }
  return err(`unknown plugin command '${subcommand}'`, 2);
}

export async function runMarketplaceCommand(
  dataDir: string,
  subcommand: string | undefined,
  rest: string[],
  jsonOutput: boolean
): Promise<CliResult> {
  if (!subcommand || subcommand === 'ls' || subcommand === 'list') {
    return live(dataDir, 'marketplace.list', {}, jsonOutput);
  }
  if (subcommand === 'add') {
    const url = rest[0];
    if (!url) return err('marketplace add requires a <url>', 2);
    return live(dataDir, 'marketplace.add', { url }, jsonOutput);
  }
  if (subcommand === 'install') {
    const spec = rest[0];
    if (!spec) return err('marketplace install requires <id@marketplace>', 2);
    return live(dataDir, 'plugin.install', { source: spec }, jsonOutput);
  }
  return err(`unknown marketplace command '${subcommand}'`, 2);
}
