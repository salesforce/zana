import type {
  ProviderCliInstallAction,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-contracts/host-rpc';

const PROVIDER_CLI_ORDER: ProviderCliKey[] = ['codex', 'claudeCode', 'cursor', 'pi', 'opencode'];

export interface MachineProviderCliRow {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
}

export function orderedProviderCliRows(status: ProviderCliStatusResponse | undefined): MachineProviderCliRow[] {
  if (!status) return [];
  return PROVIDER_CLI_ORDER.flatMap((provider) => {
    const row = status[provider];
    return row ? [{ provider, status: row }] : [];
  });
}

export function actionableProviderCliRows(
  statusByHost: Record<string, ProviderCliStatusResponse | undefined>
): Array<{ hostId: string; provider: ProviderCliKey; action: ProviderCliInstallAction }> {
  const out: Array<{ hostId: string; provider: ProviderCliKey; action: ProviderCliInstallAction }> = [];
  for (const [hostId, status] of Object.entries(statusByHost)) {
    for (const row of orderedProviderCliRows(status)) {
      if (row.status.installAction) {
        out.push({ hostId, provider: row.provider, action: row.status.installAction });
      }
    }
  }
  return out;
}

export function providerCliBadge(status: ProviderCliStatus): string | null {
  if (!status.installed) return 'Not installed';
  if (status.versionUnsupported) return 'Unsupported';
  if (status.needsUpdate) return 'Available';
  return null;
}
