import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { useData } from '@/store';
import { getThreadModelCatalog } from '@/components/thread/pickers/thread-model-catalog';
import { registerSettingsSearchProvider } from '../registry';
import type { SettingsSearchEntry, SettingsSearchProvider, SettingsValueSnapshot } from '../types';

// Runtime source for the AI Harness page: one row per harness family plus the
// Modern provider list. The static page text lives in `entries/harness.ts`.
// This module must not import the view (lazy-load constraint); the view imports
// the shared tables from here instead.

/** One-line blurb per family, shown under the name in the row. */
export const HARNESS_FAMILY_BLURB: Record<HarnessFamily, string> = {
  claude: 'Anthropic’s coding agent',
  cursor: 'Cursor’s coding agent',
  codex: 'OpenAI’s coding agent',
  pi: 'A coding agent with multiple AI providers',
  opencode: 'An open-source coding agent',
  grok: 'xAI’s coding agent',
  mastracode: 'Mastra’s coding agent',
  afcode: 'Salesforce’s coding agent'
};

/** The `AppConfig` enable flag per family (`claude` has none: always on). */
export const HARNESS_ENABLE_KEY: Partial<Record<HarnessFamily, keyof AppConfig>> = {
  cursor: 'harnessCursorEnabled',
  codex: 'harnessCodexEnabled',
  pi: 'harnessPiEnabled',
  opencode: 'harnessOpenCodeEnabled',
  grok: 'harnessGrokEnabled',
  mastracode: 'harnessMastracodeEnabled',
  afcode: 'harnessAfcodeEnabled'
};

/** The `AppConfig` binary-override key per family. */
export const HARNESS_BINARY_KEY: Record<HarnessFamily, keyof AppConfig> = {
  claude: 'claudeBinary',
  cursor: 'cursorBinary',
  codex: 'codexBinary',
  pi: 'piBinary',
  opencode: 'opencodeBinary',
  grok: 'grokBinary',
  mastracode: 'mastracodeBinary',
  afcode: 'afcodeBinary'
};

/** Default binary name (the `--version` probe target) shown as the input placeholder. */
export const HARNESS_BINARY_PLACEHOLDER: Record<HarnessFamily, string> = {
  claude: 'claude',
  cursor: 'cursor-agent',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode',
  grok: 'grok',
  mastracode: 'mastracode',
  afcode: 'afcode'
};

export type ThreadProviderListItem = {
  id: string;
  displayName: string;
  pluginId: string;
};

export const BUILTIN_THREAD_PROVIDERS: readonly ThreadProviderListItem[] = [
  { id: 'claude-code', displayName: 'Claude Code', pluginId: 'provider-claude-code' },
  { id: 'codex', displayName: 'Codex', pluginId: 'provider-codex' },
  { id: 'pi', displayName: 'Pi', pluginId: 'provider-pi' },
  { id: 'acp-cursor', displayName: 'Cursor', pluginId: 'provider-acp' },
  { id: 'acp-opencode', displayName: 'OpenCode', pluginId: 'provider-acp' },
  { id: 'acp-omp', displayName: 'OMP', pluginId: 'provider-acp' },
  { id: 'acp-grok', displayName: 'Grok Build', pluginId: 'provider-acp' },
  { id: 'acp-mastracode', displayName: 'Mastra Code', pluginId: 'provider-acp' },
  { id: 'acp-hermes-agent', displayName: 'Hermes Agent', pluginId: 'provider-acp' }
];

export const THREAD_PROVIDER_BLURB: Record<string, string> = {
  'claude-code': 'Anthropic’s coding agent',
  'acp-cursor': 'Cursor’s coding agent',
  cursor: 'Cursor’s coding agent',
  'acp-opencode': 'An open-source coding agent',
  'acp-omp': 'A coding agent with multiple AI providers',
  'acp-grok': 'xAI’s coding agent',
  'acp-mastracode': 'Mastra’s coding agent',
  'acp-afcode': 'Salesforce’s coding agent',
  'acp-hermes-agent': 'A coding agent with persistent memory',
  opencode: 'An open-source coding agent',
  codex: 'OpenAI’s coding agent',
  pi: 'A coding agent with multiple AI providers',
  fake: 'A provider for testing'
};

export function threadProviderBlurb(providerId: string): string {
  return THREAD_PROVIDER_BLURB[providerId] ?? 'A provider for Modern conversations.';
}

/** Entry-id prefix of every control inside one harness row (the row expands on a match). */
export function harnessRowPrefix(family: HarnessFamily): string {
  return `harness.${family}.`;
}

/** Stable DOM / entry id for one Modern provider row. */
export function threadProviderSearchId(providerId: string): string {
  return `harness.provider.${providerId}`;
}


let descriptorCache: ReadonlyMap<string, HarnessAdapterDescriptor> | null = null;

/** The page reports the descriptors it loaded so launch-default rows are only indexed where they render. */
export function rememberHarnessDescriptors(descriptors: readonly HarnessAdapterDescriptor[] | null): void {
  descriptorCache = descriptors ? new Map(descriptors.map((d) => [d.id, d])) : null;
}

function enabledValue(family: HarnessFamily, s: SettingsValueSnapshot, fallback: boolean): string {
  const key = HARNESS_ENABLE_KEY[family];
  const on = key ? ((s.config[key] as boolean | undefined) ?? fallback) : true;
  return on ? 'On' : 'Off';
}

function launchDefaultEntries(family: HarnessFamily, label: string): SettingsSearchEntry[] {
  const descriptor = descriptorCache?.get(family);
  // Before the page has loaded descriptors, assume the generic rows exist.
  const hasProviders = descriptor ? !!descriptor.targets?.providers?.length : true;
  const hasModels = descriptor ? !!descriptor.targets?.models?.length : true;
  const hasExecution = descriptor ? !!descriptor.targets?.executionStateMapping : true;
  const base = { section: 'harness', anchor: 'harness-legacy', kind: 'setting' } as const;
  const out: SettingsSearchEntry[] = [];
  if (hasProviders) {
    out.push({
      ...base,
      id: `harness.${family}.default-provider`,
      label: `${label} default provider`,
      help: 'Choose the provider to use for new CLI agents and the models shown below.',
      keywords: ['provider', 'cli agent']
    });
  }
  if (hasModels) {
    out.push({
      ...base,
      id: `harness.${family}.default-model-level`,
      label: `${label} default model level`,
      help: 'Choose a model for new CLI agents. Levels in brackets match Persona and Agent model settings.',
      keywords: ['model', 'cli agent']
    });
  }
  if (hasExecution && family !== 'codex') {
    out.push({
      ...base,
      id: `harness.${family}.default-execution-state`,
      label: `${label} default execution state`,
      help: 'Choose how new CLI agents plan, edit files, and ask for approval.',
      keywords: ['plan', 'accept edits', 'autonomous', 'permission mode', 'cli agent']
    });
  }
  return out;
}

/** Harness rows from install status: name, enable switch, binary path, launch defaults. */
export function harnessRowEntries(status: readonly HarnessVerifyResult[]): SettingsSearchEntry[] {
  const out: SettingsSearchEntry[] = [];
  for (const h of status) {
    const family = h.family;
    out.push({
      id: `harness.${family}.row`,
      section: 'harness',
      anchor: `harness-${family}`,
      label: h.label,
      help: `${HARNESS_FAMILY_BLURB[family]}. ${h.installed ? 'Installed' : 'Not installed'}.`,
      keywords: [family, 'harness', 'coding agent', 'cli'],
      kind: 'setting'
    });
    if (HARNESS_ENABLE_KEY[family]) {
      out.push({
        id: `harness.${family}.enabled`,
        section: 'harness',
        anchor: 'harness-status',
        label: `Show ${h.label} in the New Agent modal`,
        keywords: ['enable', 'disable', 'toggle', family],
        kind: 'setting',
        value: (s) => enabledValue(family, s, h.enabled)
      });
    }
    out.push({
      id: `harness.${family}.binary`,
      section: 'harness',
      anchor: 'harness-legacy',
      label: `${h.label} binary`,
      help: `Leave blank to use ${HARNESS_BINARY_PLACEHOLDER[family]} from your PATH. Set a command or full path to use another installation.`,
      keywords: ['path', 'executable', 'command', family],
      kind: 'setting',
      value: (s) => (s.config[HARNESS_BINARY_KEY[family]] as string | undefined) || undefined
    });
    out.push(...launchDefaultEntries(family, h.label));
  }
  return out;
}

/** Modern providers: name, blurb and (capped) discovered model names. */
export function threadProviderEntries(
  extra: readonly ThreadProviderListItem[],
  catalog: ReturnType<typeof getThreadModelCatalog>
): SettingsSearchEntry[] {
  const byId = new Map<string, string>(BUILTIN_THREAD_PROVIDERS.map((p) => [p.id, p.displayName]));
  for (const p of extra) byId.set(p.id, p.displayName);
  for (const p of catalog.providers) byId.set(p.id, p.displayName);
  return [...byId].map(([id, displayName]) => {
    const models = catalog.byProvider[id]?.models ?? [];
    return {
      id: threadProviderSearchId(id),
      section: 'harness',
      anchor: 'harness-thread',
      label: displayName,
      help: threadProviderBlurb(id),
      keywords: [
        'modern',
        'models',
        // Every model name is searchable (no per-provider cap): the typo tier scans unique words, so this stays cheap.
        ...models.flatMap((m) => [m.displayName, m.id])
      ],
      kind: 'setting'
    } satisfies SettingsSearchEntry;
  });
}

/** Reads live store state; `revision` keeps the corpus in step with it. */
export const harnessSearchProvider: SettingsSearchProvider = () => [
  ...harnessRowEntries(useData.getState().harnessStatus),
  ...threadProviderEntries([], getThreadModelCatalog())
];

/**
 * The corpus rebuilds when any input changes identity: the probed harness status
 * (the boot probe resolves after a search may already be open), the Modern model
 * catalogue snapshot, and the descriptors the page reported. Deliberately NOT a
 * subscription: a catalogue listener would keep the catalogue's background
 * refresh loop running for the whole session.
 */
harnessSearchProvider.revision = () => [useData.getState().harnessStatus, getThreadModelCatalog(), descriptorCache];

/** Register the provider; nothing to subscribe to (see `revision`). Release on shutdown (Rule 3). */
export function registerHarnessSearchProvider(): () => void {
  return registerSettingsSearchProvider(harnessSearchProvider);
}
