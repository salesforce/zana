import type {
  ProviderCliInstallAction,
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
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

export type ProviderCliInstallOutcome =
  | { ok: true }
  | { ok: false; message: string };

const OUTPUT_SNIPPET_LINES = 8;
const OUTPUT_SNIPPET_CHARS = 600;

function streamText(events: ProviderCliInstallEvent[], stream: 'stderr' | 'stdout'): string {
  return events
    .filter((event) => event.type === 'output' && event.stream === stream)
    .map((event) => event.text)
    .join('');
}

export function providerCliInstallOutputSnippet(events: ProviderCliInstallEvent[]): string | null {
  const raw = streamText(events, 'stderr').trim() || streamText(events, 'stdout').trim();
  if (!raw) return null;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  let snippet = lines.slice(-OUTPUT_SNIPPET_LINES).join('\n');
  if (snippet.length > OUTPUT_SNIPPET_CHARS) {
    snippet = snippet.slice(snippet.length - OUTPUT_SNIPPET_CHARS);
  }
  return snippet;
}

function failedCompletedMessage(
  completed: { exitCode: number | null; signal: string | null },
  snippet: string | null
): string {
  if (snippet) return snippet;
  if (completed.exitCode != null) return `Install failed (exit ${completed.exitCode})`;
  if (completed.signal) return `Install failed (${completed.signal})`;
  return 'Install failed';
}

export function providerCliInstallOutcome(
  events: ProviderCliInstallEvent[]
): ProviderCliInstallOutcome {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === 'error') {
      return { ok: false, message: event.message };
    }
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type !== 'completed') continue;
    if (event.success) return { ok: true };
    return {
      ok: false,
      message: failedCompletedMessage(event, providerCliInstallOutputSnippet(events))
    };
  }
  return { ok: false, message: 'Install did not complete' };
}

export async function installProviderCliOnMachine(input: {
  hostId: string;
  provider: ProviderCliKey;
  actionKind: ProviderCliInstallActionKind;
  install: (
    hostId: string,
    request: { provider: ProviderCliKey; actionKind: ProviderCliInstallActionKind }
  ) => Promise<ProviderCliInstallEvent[]>;
}): Promise<ProviderCliInstallOutcome> {
  try {
    return providerCliInstallOutcome(
      await input.install(input.hostId, {
        provider: input.provider,
        actionKind: input.actionKind
      })
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Install failed'
    };
  }
}
