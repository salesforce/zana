import { execFile } from 'node:child_process';

export const EXTRA_ACP_AGENT_PROBES = [
  { providerId: 'acp-omp', binary: 'omp' },
  { providerId: 'acp-grok', binary: 'grok' },
  { providerId: 'acp-hermes-agent', binary: 'hermes' }
] as const;

function runVersion(cmd: string, args: readonly string[], timeoutMs = 8_000): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err) => {
      resolve({ ok: !err });
    });
  });
}

export async function probeExtraAcpAgents(): Promise<Array<{ providerId: string; installed: boolean }>> {
  return Promise.all(EXTRA_ACP_AGENT_PROBES.map(async (probe) => {
    const result = await runVersion(probe.binary, ['--version']);
    return { providerId: probe.providerId, installed: result.ok };
  }));
}

export function extraInstalledMap(
  rows: ReadonlyArray<{ providerId: string; installed: boolean }>
): Record<string, boolean> {
  return Object.fromEntries(rows.map((row) => [row.providerId, row.installed]));
}
