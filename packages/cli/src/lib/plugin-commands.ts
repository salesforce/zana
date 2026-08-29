import { existsSync, mkdirSync, readFileSync, realpathSync, watch } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { PLUGIN_SDK_VERSION, derivePluginId } from '@zana-ai/zcc-plugin-sdk';
import { clampPluginStarterKind, scaffoldPlugin } from '@zana-ai/zcc-plugin-templates';
import { buildPlugin, createPluginDevLoop, syncPluginTypes } from '@zana-ai/zcc-plugin-build';
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

function findInstalledPathPluginId(dataDir: string, dir: string): string | undefined {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    real = resolve(dir);
  }
  for (const plugin of readInstalled(dataDir).plugins) {
    const source = plugin.source.startsWith('path:') ? plugin.source.slice('path:'.length) : plugin.source;
    try {
      if (realpathSync(source) === real) return plugin.id;
    } catch {
      if (resolve(source) === real) return plugin.id;
    }
  }
  return undefined;
}

async function readLogTail(dataDir: string, pluginId: string, tail: number): Promise<string[]> {
  const files = [
    join(dataDir, 'plugins', pluginId, 'logs', 'plugin.log.1'),
    join(dataDir, 'plugins', pluginId, 'logs', 'plugin.log')
  ];
  const lines: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      lines.push(...readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0));
    } catch {
      // ignore unreadable rotated files
    }
  }
  return tail <= 0 ? [] : lines.slice(-tail);
}

function err(message: string, exitCode: number): CliResult {
  return { exitCode, stdout: '', stderr: `Error: ${message}\n` };
}

function installScaffoldDeps(dest: string): string {
  if (process.env.VITEST || process.env.ZCC_SKIP_PLUGIN_NPM === '1') return '';
  const result = spawnSync('npm', ['install', '--include=dev', '--no-fund', '--no-audit'], {
    cwd: dest,
    encoding: 'utf8',
    timeout: 60_000
  });
  if (result.status === 0) return '';
  return `npm install skipped: ${result.stderr?.trim() || result.error?.message || 'failed'}\n`;
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
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
    const id = derivePluginId(`zcc-plugin-${slug}`);
    const dest = rest.includes('--dir')
      ? rest[rest.indexOf('--dir') + 1]
      : join(process.cwd(), `zcc-plugin-${id}`);
    if (!dest) return err('plugin new --dir requires a path', 2);
    const kindFlag = rest.includes('--kind') ? rest[rest.indexOf('--kind') + 1] : undefined;
    const kind = kindFlag
      ? clampPluginStarterKind(kindFlag)
      : rest.includes('--app')
        ? 'main-panel'
        : 'agent-preset';
    mkdirSync(dest, { recursive: true });
    await scaffoldPlugin({
      targetDir: dest,
      id,
      name,
      kind,
      pluginSdkVersion: PLUGIN_SDK_VERSION
    });
    await syncPluginTypes(dest).catch(() => undefined);
    const npmNote = installScaffoldDeps(dest);
    return {
      exitCode: 0,
      stdout: `${npmNote}Created plugin scaffold in ${dest}\nNext: cd ${dest} && zcc plugin install .\n`
    };
  }
  if (subcommand === 'types') {
    const dir = resolve(rest[0] ?? process.cwd());
    if (!existsSync(join(dir, 'package.json'))) {
      return err('plugin types requires a package.json in the directory', 2);
    }
    const written = await syncPluginTypes(dir, { check: rest.includes('--check') });
    if (jsonOutput) return { exitCode: 0, stdout: `${JSON.stringify(written, null, 2)}\n` };
    const stale = written.filter((row) => row.outcome === 'stale');
    if (rest.includes('--check') && stale.length > 0) {
      return err(`stale types: ${stale.map((row) => row.path).join(', ')}`, 1);
    }
    return {
      exitCode: 0,
      stdout: `${written.map((row) => `${row.outcome} ${row.path}`).join('\n')}\n`
    };
  }
  if (subcommand === 'build') {
    const dir = resolve(rest[0] ?? process.cwd());
    if (!existsSync(join(dir, 'package.json'))) {
      return err('plugin build requires a package.json in the directory', 2);
    }
    const built = await buildPlugin(dir, '1.0.0');
    return {
      exitCode: 0,
      stdout: `Built ${[built.server?.jsPath, built.app?.jsPath].filter(Boolean).join(' ') || dir}\n`
    };
  }
  if (subcommand === 'dev') {
    const dir = resolve(rest[0] ?? process.cwd());
    if (!existsSync(join(dir, 'package.json'))) {
      return err('plugin dev requires a package.json in the directory', 2);
    }
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: string;
      zcc?: { server?: string; app?: string };
    };
    const id = findInstalledPathPluginId(dataDir, dir) ?? derivePluginId(pkg.name ?? `zcc-plugin-${dir}`);
    if (!findInstalledPathPluginId(dataDir, dir)) {
      return err(
        `This directory is not installed as a plugin — run \`zcc plugin install ${rest[0] ?? '.'}\` first, then re-run \`zcc plugin dev\`.`,
        2
      );
    }
    const loop = createPluginDevLoop({
      pluginId: id,
      hasApp: Boolean(pkg.zcc?.app),
      hasServer: Boolean(pkg.zcc?.server) && !/\.tsx?$/.test(pkg.zcc?.server ?? ''),
      buildApp: async () => {
        await buildPlugin(dir, '1.0.0');
      },
      buildServer: async () => {
        await buildPlugin(dir, '1.0.0');
      },
      reloadPlugin: async () => {
        const reloaded = await live(dataDir, 'plugin.reload', { id }, false);
        if (reloaded.exitCode !== 0) throw new Error(reloaded.stderr ?? 'reload failed');
      },
      log: (line) => {
        process.stderr.write(`${line}\n`);
      }
    });
    if (rest.includes('--once')) {
      loop.handleChange('package.json');
      await loop.settled();
      loop.dispose();
      return { exitCode: 0, stdout: `Reloaded ${id}\n` };
    }
    const watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (typeof filename === 'string') loop.handleChange(relative(dir, join(dir, filename)));
    });
    await new Promise<void>((resolveWait) => {
      const stop = () => {
        loop.dispose();
        watcher.close();
        resolveWait();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return { exitCode: 0, stdout: `Stopped watching ${dir}\n` };
  }
  if (subcommand === 'logs') {
    const id = rest[0];
    if (!id) return err('plugin logs requires a <pluginId>', 2);
    let n = 100;
    const nFlag = rest.indexOf('-n');
    if (nFlag >= 0) n = Number(rest[nFlag + 1]) || 100;
    const follow = rest.includes('-f') || rest.includes('--follow');
    const fetchLines = async (): Promise<string[] | CliResult> => {
      if (isAppRunning(dataDir)) {
        const result = await callControlPlane({ dataDir, op: 'plugin.logs', args: { id, n } });
        if (!result.ok) return err(result.message ?? result.code ?? 'control plane error', 1);
        return Array.isArray(result.value) ? result.value.map((row) => String(row)) : [];
      }
      return readLogTail(dataDir, id, n);
    };
    const format = (lines: string[], asJson: boolean) =>
      asJson ? `${JSON.stringify(lines, null, 2)}\n` : lines.length === 0 ? '' : `${lines.join('\n')}\n`;
    const first = await fetchLines();
    if (!Array.isArray(first)) return first;
    if (!follow) return { exitCode: 0, stdout: format(first, jsonOutput) };
    process.stdout.write(format(first, false));
    let seen = first.length;
    await new Promise<void>((resolveWait) => {
      const tick = async () => {
        const next = await fetchLines();
        if (!Array.isArray(next)) return;
        if (next.length < seen) seen = 0;
        const extra = next.slice(seen);
        seen = next.length;
        if (extra.length > 0) process.stdout.write(`${extra.join('\n')}\n`);
      };
      const timer = setInterval(() => {
        void tick();
      }, 500);
      const stop = () => {
        clearInterval(timer);
        resolveWait();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return { exitCode: 0, stdout: '' };
  }
  if (subcommand === 'search') {
    const query = rest.join(' ').trim();
    return live(dataDir, 'plugin.search', { query }, jsonOutput);
  }
  if (subcommand === 'outdated') {
    return live(dataDir, 'plugin.outdated', {}, jsonOutput);
  }
  if (subcommand === 'update') {
    const id = rest[0];
    if (!id) return err('plugin update requires a <pluginId>', 2);
    return live(dataDir, 'plugin.update', { id }, jsonOutput);
  }
  if (subcommand === 'run') {
    const id = rest[0];
    if (!id) return err('plugin run requires a <pluginId>', 2);
    const { runExplicitPluginCli } = await import('./plugin-cli-proxy.js');
    return runExplicitPluginCli(dataDir, id, rest.slice(1), jsonOutput);
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
    if (!url) return err('marketplace add requires a <https-url | git:url[@ref] | path:dir>', 2);
    return live(dataDir, 'marketplace.add', { url }, jsonOutput);
  }
  if (subcommand === 'refresh') {
    const url = rest[0];
    if (!url) return err('marketplace refresh requires a source', 2);
    return live(dataDir, 'marketplace.refresh', { url }, jsonOutput);
  }
  if (subcommand === 'remove' || subcommand === 'rm') {
    const url = rest[0];
    if (!url) return err('marketplace remove requires a source', 2);
    return live(dataDir, 'marketplace.remove', { url }, jsonOutput);
  }
  if (subcommand === 'install') {
    const spec = rest[0];
    if (!spec) return err('marketplace install requires <id@marketplace>', 2);
    return live(dataDir, 'plugin.install', { source: spec }, jsonOutput);
  }
  return err(`unknown marketplace command '${subcommand}'`, 2);
}
