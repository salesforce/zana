import type {
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-contracts/host-rpc';

// `@zana-ai/zcc-contracts/host-rpc` re-exports the CLI-status types but not the
// bare `ProviderCliInstallAction` member type — derive it from the field that
// actually carries it instead of reaching into the underlying contract package.
type ProviderCliInstallAction = NonNullable<ProviderCliStatus['installAction']>;

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
  hint: string | null;
}

export type ProviderCliUpdateHintView =
  | { kind: 'homebrew'; formula: string }
  | { kind: 'external'; path: string; resolvedPath: string | null }
  | { kind: 'plain'; text: string };

const EXTERNAL_UPDATE_HINT = /^ZCC cannot update this CLI\. PATH is (.+)\.$/u;
const RESOLVES_TO_HINT = /^(.+) \(resolves to (.+)\)$/u;

function homebrewFormulaFromHint(reason: string): string | null {
  if (!reason.startsWith('Managed by Homebrew.')) return null;
  const tick = reason.indexOf('`');
  const end = reason.lastIndexOf('`');
  if (tick < 0 || end <= tick) return null;
  const command = reason.slice(tick + 1, end).trim();
  const formula = command.replace(/^brew\s+\S+\s+/u, '').trim();
  return formula.length > 0 ? formula : null;
}

export function parseProviderCliUpdateHint(reason: string): ProviderCliUpdateHintView {
  const formula = homebrewFormulaFromHint(reason);
  if (formula) return { kind: 'homebrew', formula };
  const external = EXTERNAL_UPDATE_HINT.exec(reason);
  if (external?.[1]) {
    const resolved = RESOLVES_TO_HINT.exec(external[1]);
    if (resolved?.[1] && resolved[2]) {
      return { kind: 'external', path: resolved[1], resolvedPath: resolved[2] };
    }
    return { kind: 'external', path: external[1], resolvedPath: null };
  }
  return { kind: 'plain', text: reason };
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
  const hint = status.updateUnavailableReason ?? null;
  if (!status.installed) {
    return {
      tone: 'warn',
      badge: 'Not installed',
      currentLabel: 'Not installed',
      latestLabel: null,
      hint: null
    };
  }
  const currentLabel = status.currentVersion ?? 'Installed';
  if (status.versionUnsupported) {
    return {
      tone: 'warn',
      badge: 'Unsupported',
      currentLabel,
      latestLabel: status.latestVersion,
      hint
    };
  }
  if (hint) {
    return {
      tone: 'warn',
      badge: hint.startsWith('Managed by Homebrew') ? 'Homebrew' : 'External',
      currentLabel,
      latestLabel: status.latestVersion,
      hint
    };
  }
  if (status.needsUpdate) {
    return {
      tone: 'warn',
      badge: 'Update',
      currentLabel,
      latestLabel: status.latestVersion,
      hint: null
    };
  }
  return {
    tone: 'ok',
    badge: 'Current',
    currentLabel,
    latestLabel: null,
    hint: null
  };
}

const OUTPUT_SNIPPET_LINES = 8;
const OUTPUT_SNIPPET_CHARS = 600;

export function machineCliInventorySummary(rows: MachineProviderCliRow[]): string | null {
  if (rows.length === 0) return null;
  const pending = rows.filter((row) => row.status.installAction).length;
  const blocked = rows.filter((row) => row.status.updateUnavailableReason && !row.status.installAction).length;
  if (pending === 0) return blocked > 0 ? null : 'Up to date';
  return pending === 1 ? '1 update' : `${pending} updates`;
}

export function providerCliBusyLabel(kind: ProviderCliInstallActionKind): string {
  return kind === 'update' ? 'Updating…' : 'Installing…';
}

export function providerCliStartLog(command: string): string {
  return `Running \`${command}\`. This can take a few minutes.`;
}

export function providerCliKeyForFamily(family: string): ProviderCliKey | null {
  if (family === 'claude') return 'claudeCode';
  if (family === 'cursor' || family === 'codex' || family === 'pi' || family === 'opencode') {
    return family;
  }
  return null;
}

export function providerCliInstallLogLines(events: ProviderCliInstallEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === 'started') {
      lines.push(providerCliStartLog(event.command));
      continue;
    }
    if (event.type === 'output') {
      for (const line of event.text.split(/\r?\n/u)) {
        const trimmed = line.trimEnd();
        if (trimmed.trim().length > 0) lines.push(trimmed);
      }
      continue;
    }
    if (event.type === 'error') {
      lines.push(event.message);
      continue;
    }
    if (event.type === 'completed' && event.success) {
      lines.push('Finished.');
    }
  }
  return lines.slice(-OUTPUT_SNIPPET_LINES);
}

export function providerCliBadge(status: ProviderCliStatus): string | null {
  const copy = providerCliPresentation(status);
  return copy.tone === 'ok' ? null : copy.badge;
}

export function dismissInstallLogOnSuccess(
  logs: Record<string, string>,
  key: string,
  ok: boolean
): Record<string, string> {
  if (!ok || !(key in logs)) return logs;
  const next = { ...logs };
  delete next[key];
  return next;
}

export type ProviderCliInstallOutcome =
  | { ok: true }
  | { ok: false; message: string };

function streamText(events: ProviderCliInstallEvent[], stream: 'stderr' | 'stdout'): string {
  return events
    .filter(
      (event): event is Extract<ProviderCliInstallEvent, { type: 'output' }> =>
        event.type === 'output' && event.stream === stream
    )
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
  onEvent?: (event: ProviderCliInstallEvent) => void;
  install: (
    hostId: string,
    request: { provider: ProviderCliKey; actionKind: ProviderCliInstallActionKind },
    onEvent?: (event: ProviderCliInstallEvent) => void
  ) => Promise<ProviderCliInstallEvent[]>;
}): Promise<ProviderCliInstallOutcome> {
  try {
    return providerCliInstallOutcome(
      await input.install(
        input.hostId,
        {
          provider: input.provider,
          actionKind: input.actionKind
        },
        input.onEvent
      )
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Install failed'
    };
  }
}
