import { execFile } from 'node:child_process';
import { augmentPath, augmentPathWithNodePrefixes } from './env.js';
import { resolveHarnessCommand } from './harness/harness-verify.js';

type ExtraAcpAgentProbe = {
  providerId: string;
  binary: string;
  versionArgs?: readonly string[];
};

export const EXTRA_ACP_AGENT_PROBES: readonly ExtraAcpAgentProbe[] = [
  { providerId: 'acp-omp', binary: 'omp' },
  { providerId: 'acp-grok', binary: 'grok' },
  { providerId: 'acp-hermes-agent', binary: 'hermes' },
  { providerId: 'acp-mastracode', binary: 'mastracode', versionArgs: ['--help'] }
];

function runVersion(
  cmd: string,
  args: readonly string[],
  searchPath: string,
  timeoutMs = 8_000
): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PATH: searchPath }
    }, (err) => {
      resolve({ ok: !err });
    });
  });
}

export async function probeExtraAcpAgents(): Promise<Array<{ providerId: string; installed: boolean }>> {
  const searchPath = augmentPathWithNodePrefixes(augmentPath(process.env.PATH));
  return Promise.all(EXTRA_ACP_AGENT_PROBES.map(async (probe) => {
    const command = resolveHarnessCommand(probe.binary, searchPath);
    const result = await runVersion(command, probe.versionArgs ?? ['--version'], searchPath);
    return { providerId: probe.providerId, installed: result.ok };
  }));
}

export function extraInstalledMap(
  rows: ReadonlyArray<{ providerId: string; installed: boolean }>
): Record<string, boolean> {
  return Object.fromEntries(rows.map((row) => [row.providerId, row.installed]));
}
