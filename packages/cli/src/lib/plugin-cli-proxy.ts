/**
 * Plugin-contributed `zcc` subcommands. Core command names always win; unknown
 * tokens are proxied to the running app's PluginService via the control plane.
 */

import { RESERVED_ZCC_CLI_COMMANDS } from '@zana-ai/zcc-domain/thread-runtime';
import { callControlPlane, isAppRunning } from './control-client.js';

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

export interface PluginCliContributionEntry {
  pluginId: string;
  name: string;
  summary: string;
  commands?: Array<{ name: string; summary: string; usage: string }>;
}

export function pluginProxyCandidate(
  firstArg: string | undefined,
  knownCommandNames: ReadonlySet<string> = new Set(RESERVED_ZCC_CLI_COMMANDS)
): string | null {
  if (firstArg === undefined || firstArg.length === 0) return null;
  if (firstArg.startsWith('-')) return null;
  if (knownCommandNames.has(firstArg)) return null;
  return firstArg;
}

export function findPluginCliCommand(
  contributions: readonly PluginCliContributionEntry[],
  name: string
): PluginCliContributionEntry | undefined {
  return contributions.find((entry) => entry.name === name);
}

function err(message: string, exitCode = 1): CliResult {
  return { exitCode, stdout: '', stderr: `Error: ${message}\n` };
}

function renderCliResult(
  value: unknown,
  jsonOutput: boolean
): CliResult {
  const result = value as {
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    error?: { code?: string; message?: string };
  };
  if (result?.error?.code === 'plugin_cli_output_too_large') {
    return {
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
      stdout: '',
      stderr: `Error: ${result.error.message ?? 'plugin_cli_output_too_large'}\n`
    };
  }
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 1;
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  if (jsonOutput) {
    return { exitCode, stdout: `${JSON.stringify(value, null, 2)}\n`, stderr: stderr || undefined };
  }
  return {
    exitCode,
    stdout: stdout.endsWith('\n') || stdout.length === 0 ? stdout : `${stdout}\n`,
    stderr: stderr ? (stderr.endsWith('\n') ? stderr : `${stderr}\n`) : undefined
  };
}

export async function proxyPluginCliCommand(
  dataDir: string,
  name: string,
  argv: string[],
  jsonOutput: boolean
): Promise<CliResult> {
  if (!isAppRunning(dataDir)) {
    return err(
      `Zana Command Center is not running — open the app, then re-run \`zcc ${name}\`. Plugin commands only exist while the app is up.`,
      1
    );
  }
  const listed = await callControlPlane({ dataDir, op: 'plugin.contributions', args: {} });
  if (!listed.ok) {
    return err(listed.message ?? listed.code ?? 'could not list plugin CLI contributions', 1);
  }
  const contributions = Array.isArray(listed.value)
    ? (listed.value as PluginCliContributionEntry[])
    : Array.isArray((listed.value as { cliCommands?: unknown })?.cliCommands)
      ? ((listed.value as { cliCommands: PluginCliContributionEntry[] }).cliCommands)
      : [];
  const match = findPluginCliCommand(contributions, name);
  if (!match) {
    return err(
      `unknown command '${name}'\nRun 'zcc --help' for usage. No installed plugin currently contributes \`zcc ${name}\`.`,
      1
    );
  }
  const ran = await callControlPlane({
    dataDir,
    op: 'plugin.cli',
    args: { id: match.pluginId, argv }
  });
  if (!ran.ok) {
    return err(ran.message ?? ran.code ?? 'plugin CLI failed', 1);
  }
  return renderCliResult(ran.value, jsonOutput);
}

export async function runExplicitPluginCli(
  dataDir: string,
  pluginId: string,
  argv: string[],
  jsonOutput: boolean
): Promise<CliResult> {
  if (!isAppRunning(dataDir)) {
    return err('APP_NOT_RUNNING: start Zana Command Center to run plugin commands', 1);
  }
  const ran = await callControlPlane({
    dataDir,
    op: 'plugin.cli',
    args: { id: pluginId, argv }
  });
  if (!ran.ok) {
    return err(ran.message ?? ran.code ?? 'plugin CLI failed', 1);
  }
  return renderCliResult(ran.value, jsonOutput);
}
