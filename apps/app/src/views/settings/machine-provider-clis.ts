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

export type ProviderCliTone = 'ok' | 'warn';

export interface ProviderCliPresentation {
  tone: ProviderCliTone;
  badge: string;
  currentLabel: string;
  latestLabel: string | null;
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

export function providerCliPresentation(status: ProviderCliStatus): ProviderCliPresentation {
  if (!status.installed) {
    return {
      tone: 'warn',
      badge: 'Not installed',
      currentLabel: 'Not installed',
      latestLabel: null
    };
  }
  const currentLabel = status.currentVersion ?? 'Installed';
  if (status.versionUnsupported) {
    return {
      tone: 'warn',
      badge: 'Unsupported',
      currentLabel,
      latestLabel: status.latestVersion
    };
  }
  if (status.needsUpdate) {
    return {
      tone: 'warn',
      badge: 'Update',
      currentLabel,
      latestLabel: status.latestVersion
    };
  }
  return {
    tone: 'ok',
    badge: 'Current',
    currentLabel,
    latestLabel: null
  };
}

export function machineCliInventorySummary(rows: MachineProviderCliRow[]): string | null {
  if (rows.length === 0) return null;
  const pending = rows.filter((row) => row.status.installAction).length;
  if (pending === 0) return 'Up to date';
  return pending === 1 ? '1 update' : `${pending} updates`;
}

export function providerCliBadge(status: ProviderCliStatus): string | null {
  const copy = providerCliPresentation(status);
  return copy.tone === 'ok' ? null : copy.badge;
}
