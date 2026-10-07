import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { product } from '../../lib/product-client.js';
import { AlertTriangle, Bot, CheckCircle2, ChevronLeft, ChevronRight, Download, Laptop, MessageSquare, RefreshCw, Search, Terminal, XCircle } from 'lucide-react';
import type { AppConfig, HarnessFamily, HarnessVerifyResult, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import type { ProviderCliInstallActionKind, ProviderCliKey, ProviderCliStatusResponse } from '@zana-ai/zcc-contracts/host-rpc';
import { useData, useUi } from '@/store';
import { profileIcon } from '@/lib/profileIcon';
import { useHosts, primaryHost } from '../../hooks/useHosts.js';
import { getSettingsRoutePath } from '../../lib/route-paths.js';
import {
  actionableProviderCliRows,
  dismissInstallLogOnSuccess,
  installProviderCliOnMachine,
  orderedProviderCliRows,
  providerCliBusyLabel,
  providerCliInstallLogLines,
  providerCliKeyForFamily,
  providerCliStartLog
} from './machine-provider-clis.js';
import { ProviderCliUpdateHint } from './ProviderCliUpdateHint.js';
import { providerIconForId } from '@/components/thread/pickers/provider-icon';
import { Section, Field, ToggleSwitch, ChipField, TextArgsField } from '@/components/settings/FormFields';
import { HarnessOptionSelect } from '@/components/HarnessOptionSelect';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { StencilForm, Skeleton } from '@/components/ui/Skeleton';
import { providerUiSchema } from '@zana-ai/zcc-domain/launch-provider';
import {
  getThreadModelCatalog,
  prefetchThreadModelCatalog,
  reloadThreadProviderModels,
  subscribeThreadModelCatalog
} from '../../components/thread/pickers/thread-model-catalog.js';
import {
  emptyModelsHint,
  harnessLoginStatus,
  type HarnessLoginStatus
} from '../../components/thread/pickers/harness-login.js';
import { RemoteMachineDefaultsList } from './RemoteMachineDefaultsList.js';
import { ModelRefreshControl } from './ModelRefreshControl.js';
import './harness-settings.css';

const USE_HARNESS_DEFAULT = { id: '', label: 'Use harness default' } as const;
const CODEX_UI = providerUiSchema('codex');

/** Install and sign-in status is shared across launch surfaces. Modern model
 * catalogues and CLI launch defaults live in their respective tabs below. */

/** Map a harness family → the base launch profile whose glyph represents it, so
 *  the row icons match the New Agent modal's picker exactly. */
const FAMILY_PROFILE: Record<HarnessFamily, LaunchProfileId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode',
  grok: 'grok',
  mastracode: 'mastracode',
  afcode: 'afcode'
};

/** One-line blurb per family, shown under the name in the row. */
const FAMILY_BLURB: Record<HarnessFamily, string> = {
  claude: 'Anthropic’s coding agent',
  cursor: 'Cursor’s coding agent',
  codex: 'OpenAI’s coding agent',
  pi: 'A coding agent with multiple AI providers',
  opencode: 'An open-source coding agent',
  grok: 'xAI’s coding agent',
  mastracode: 'Mastra’s coding agent',
  afcode: 'Salesforce’s coding agent'
};

/** The `AppConfig` enable flag per family (`claude` has none — always on). */
const ENABLE_KEY: Partial<Record<HarnessFamily, keyof AppConfig>> = {
  cursor: 'harnessCursorEnabled',
  codex: 'harnessCodexEnabled',
  pi: 'harnessPiEnabled',
  opencode: 'harnessOpenCodeEnabled',
  grok: 'harnessGrokEnabled',
  mastracode: 'harnessMastracodeEnabled',
  afcode: 'harnessAfcodeEnabled'
};

export function familyEnabled(family: HarnessFamily, config: AppConfig, fallback: boolean): boolean {
  const key = ENABLE_KEY[family];
  if (!key) return true;
  return (config[key] as boolean | undefined) ?? fallback;
}

export function summarizeHarnessHealth(
  status: HarnessVerifyResult[],
  config: AppConfig
): { ok: boolean; message: string; installed: number; enabled: number; total: number } {
  const total = status.length;
  if (total === 0) {
    return { ok: false, message: 'Checking…', installed: 0, enabled: 0, total: 0 };
  }
  const enabledFlags = status.map((row) => familyEnabled(row.family, config, row.enabled));
  const installed = status.filter((row) => row.installed).length;
  const enabled = enabledFlags.filter(Boolean).length;
  const missing = status.filter((row, index) => enabledFlags[index] && !row.installed).length;
  const message = `${installed} installed · ${enabled} enabled`;
  return {
    ok: missing === 0,
    message: missing > 0
      ? `${message} · ${missing} enabled ${missing === 1 ? 'harness needs' : 'harnesses need'} installation`
      : message,
    installed,
    enabled,
    total
  };
}

/** The `AppConfig` binary-override key per family. */
const BINARY_KEY: Record<HarnessFamily, keyof AppConfig> = {
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
const BINARY_PLACEHOLDER: Record<HarnessFamily, string> = {
  claude: 'claude',
  cursor: 'cursor-agent',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode',
  grok: 'grok',
  mastracode: 'mastracode',
  afcode: 'afcode'
};

function StatusBadge({ h, enabled }: { h: HarnessVerifyResult; enabled: boolean }) {
  // Three honest states: installed → green ✓; enabled-but-missing → amber ✗ (the
  // actionable case); off (not installed, not enabled) → a muted/dim ✗.
  const missing = enabled && !h.installed;
  const state = h.installed ? 'ok' : missing ? 'warn' : 'muted';
  const title = h.installed
    ? h.version || 'installed'
    : enabled
      ? `not found — install it (${h.installHint})`
      : 'not installed';
  return (
    <span className={`opener-row-status opener-row-status--${state}`} title={title}>
      {h.installed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {h.installed ? h.version || 'Installed' : 'Not installed'}
    </span>
  );
}

function LoginBadge({ login }: { login: HarnessLoginStatus }) {
  if (login.state === 'checking') {
    return (
      <span className="opener-row-status opener-row-status--muted" title={`Checking ${login.loginCommand}`}>
        checking login…
      </span>
    );
  }
  if (login.state === 'sign_in_required') {
    return (
      <span
        className="opener-row-status opener-row-status--warn"
        title={`Run ${login.loginCommand}, then Check`}
      >
        <AlertTriangle size={13} />
        sign in
      </span>
    );
  }
  if (login.state === 'unverified') {
    return (
      <span className="opener-row-status opener-row-status--muted" title={`Could not verify. Run ${login.loginCommand} if needed, then Check.`}>
        login unverified
      </span>
    );
  }
  return (
    <span className="opener-row-status opener-row-status--ok" title={`Signed in. Models refresh on Check.`}>
      <CheckCircle2 size={13} />
      signed in
    </span>
  );
}

export function HarnessOptionsGroup({
  title, help, disabled = false, children
}: {
  title: string;
  help?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="harness-options-group" disabled={disabled}>
      <legend>{title}</legend>
      {help ? <p className="settings-help harness-options-intro">{help}</p> : null}
      <div className="harness-options-fields">{children}</div>
    </fieldset>
  );
}

/**
 * One harness family as a compact row. `status` mode is install + enable only
 * (the verification list). `settings` mode is the CLI Agent advanced
 * disclosure (binary / routing) without a second enable switch.
 */
function HarnessRow({
  h,
  config,
  onConfigDraft,
  onUpdate,
  descriptor,
  advanced,
  mode,
  login,
  cliAction,
  cliBusy,
  cliDisabled,
  cliLog,
  cliError,
  cliHint,
  onCliInstall
}: {
  h: HarnessVerifyResult;
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
  descriptor?: HarnessAdapterDescriptor;
  advanced?: React.ReactNode;
  mode: 'status' | 'settings';
  login?: HarnessLoginStatus | null;
  cliAction?: { kind: ProviderCliInstallActionKind; label: string } | null;
  cliBusy?: boolean;
  cliDisabled?: boolean;
  cliLog?: string;
  cliError?: string;
  cliHint?: string;
  onCliInstall?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const enableKey = ENABLE_KEY[h.family];
  const binKey = BINARY_KEY[h.family];
  // Prefer the live config value over the async probe snapshot (`h.enabled`):
  // toggling flips `config` immediately via `onUpdate`, but `harnessStatus` only
  // refreshes on a manual re-check or tab remount, so binding to `h.enabled`
  // would make the switch appear to snap back until that next probe.
  const enabled = enableKey ? ((config[enableKey] as boolean | undefined) ?? h.enabled) : h.enabled;
  const shown = h.alwaysEnabled || enabled;

  const binaryField = (
    <Field
      label={`${h.label} binary`}
      help={`Leave blank to use ${BINARY_PLACEHOLDER[h.family]} from your PATH. Set a command or full path to use another installation.`}
      mono
    >
      <input
        type="text"
        value={(config[binKey] as string | undefined) ?? ''}
        placeholder={BINARY_PLACEHOLDER[h.family]}
        onChange={(e) => onConfigDraft({ ...config, [binKey]: e.target.value })}
        onBlur={(e) => onUpdate({ [binKey]: e.target.value.trim() || undefined })}
        spellCheck={false}
      />
    </Field>
  );
  const portableLabel = (value: string) => value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  const modelTargets = descriptor?.targets?.models ?? [];
  const providerTargets = descriptor?.targets?.providers ?? [];
  const providerRelationship = descriptor?.targets?.providerModelRelationship;
  const configuredModel = config.harnessRouting?.byAdapter?.[h.family];
  const inferredProvider = configuredModel?.modelTargetId
    ? modelTargets.find((target) => target.id === configuredModel.modelTargetId)?.provider
    : undefined;
  const selectedProvider = configuredModel?.providerTargetId
    ?? inferredProvider
    ?? (providerRelationship === 'fixed-provider' ? providerTargets[0]?.id : '');
  const visibleModels = selectedProvider && providerRelationship !== 'fixed-provider'
    ? modelTargets.filter((target) => !target.provider || target.provider === selectedProvider)
    : modelTargets;
  const selectedModelTarget = configuredModel?.modelTargetId
    ?? (configuredModel?.modelLevel
      ? descriptor?.targets?.modelLevelMapping[configuredModel.modelLevel]
      : undefined)
    ?? '';
  const providerField = providerTargets.length ? (
    <Field label="Default Provider" layout="row" help={providerRelationship === 'fixed-provider'
      ? `${h.label} uses this provider.`
      : 'Choose the provider to use for new CLI agents and the models shown below.'}>
      <PopoverPicklist
        value={selectedProvider}
        ariaLabel="Default provider"
        searchable={false}
        disabled={providerRelationship === 'fixed-provider'}
        onChange={(nextProvider) => {
          const byAdapter = { ...(config.harnessRouting?.byAdapter ?? {}) };
          const current = byAdapter[h.family] ?? {};
          const modelStillMatches = modelTargets.some((target) =>
            target.id === current.modelTargetId && (!target.provider || target.provider === nextProvider));
          const providerTargetId = nextProvider || undefined;
          const next = {
            ...current,
            providerTargetId,
            ...(!modelStillMatches ? { modelTargetId: undefined, modelLevel: undefined } : {})
          };
          if (!next.providerTargetId && !next.modelTargetId && !next.modelLevel && !next.executionState) {
            delete byAdapter[h.family];
          } else {
            byAdapter[h.family] = next;
          }
          void onUpdate({ harnessRouting: Object.keys(byAdapter).length ? { schemaVersion: 1, byAdapter } : undefined });
        }}
        options={[
          ...(providerRelationship !== 'fixed-provider' ? [{ value: '', label: 'Use harness default' }] : []),
          ...providerTargets.map((provider) => ({ value: provider.id, label: provider.label }))
        ]}
      />
    </Field>
  ) : null;
  const modelLevelField = modelTargets.length ? (
    <Field label="Default Model Level" layout="row" help="Choose a model for new CLI agents. Levels in brackets match Persona and Agent model settings.">
      <PopoverPicklist
        value={selectedModelTarget}
        ariaLabel="Default model level"
        onChange={(modelTargetId) => {
          const byAdapter = { ...(config.harnessRouting?.byAdapter ?? {}) };
          const current = byAdapter[h.family] ?? {};
          if (modelTargetId) {
            byAdapter[h.family] = {
              ...current,
              modelTargetId,
              modelLevel: undefined
            };
          } else {
            const { modelTargetId: _target, modelLevel: _level, ...rest } = current;
            if (Object.keys(rest).length) byAdapter[h.family] = rest;
            else delete byAdapter[h.family];
          }
          void onUpdate({ harnessRouting: Object.keys(byAdapter).length ? { schemaVersion: 1, byAdapter } : undefined });
        }}
        disabled={!descriptor?.availability.enabled || !descriptor?.availability.installed}
        title={!descriptor?.availability.enabled || !descriptor?.availability.installed ? descriptor?.availability.reason ?? 'Harness unavailable' : undefined}
        options={[
          { value: '', label: 'Use harness default' },
          ...visibleModels.map((target) => ({
            value: target.id,
            label: `${target.label}${target.level ? ` [${portableLabel(target.level)}]` : ''}`
          }))
        ]}
      />
    </Field>
  ) : null;
  const executionMapping = descriptor?.targets?.executionStateMapping;
  const executionStateField = executionMapping && h.family !== 'codex' ? (
    <Field label="Default Execution State" layout="row" help="Choose how new CLI agents plan, edit files, and ask for approval.">
      <PopoverPicklist
        value={config.harnessRouting?.byAdapter?.[h.family]?.executionState ?? ''}
        ariaLabel="Default execution state"
        searchable={false}
        onChange={(executionState) => {
          const byAdapter = { ...(config.harnessRouting?.byAdapter ?? {}) };
          const current = byAdapter[h.family] ?? {};
          if (executionState) {
            byAdapter[h.family] = { ...current, executionState: executionState as 'plan' | 'interactive' | 'accept-edits' | 'autonomous' };
          } else {
            const { executionState: _state, ...rest } = current;
            if (Object.keys(rest).length) byAdapter[h.family] = rest;
            else delete byAdapter[h.family];
          }
          void onUpdate({ harnessRouting: Object.keys(byAdapter).length ? { schemaVersion: 1, byAdapter } : undefined });
        }}
        disabled={!descriptor?.availability.enabled || !descriptor?.availability.installed}
        options={[
          { value: '', label: 'Use harness default' },
          ...Object.entries(executionMapping).map(([state, native]) => ({
            value: state,
            label: `${native} [${portableLabel(state)}]`
          }))
        ]}
      />
    </Field>
  ) : null;

  const RowHeader = mode === 'settings' ? 'button' : 'div';

  return (
    <div
      className={`opener-row${shown ? '' : ' opener-row--off'}`}
      id={mode === 'status' ? `settings-anchor-harness-${h.family}` : undefined}
    >
      <RowHeader
        className={`opener-row-head${mode === 'settings' ? ' harness-disclosure' : ''}`}
        {...(mode === 'settings' ? {
          type: 'button' as const,
          'aria-expanded': open,
          'aria-label': `Advanced settings for ${h.label}`,
          onClick: () => setOpen((value) => !value)
        } : {})}
      >
        {mode === 'settings' ? (
          <span className="opener-row-expand" aria-hidden>
            <ChevronRight
              size={14}
              className={`opener-row-chevron${open ? ' opener-row-chevron--open' : ''}`}
              aria-hidden
            />
          </span>
        ) : null}

        <span className="opener-row-glyph" aria-hidden>
          {profileIcon(FAMILY_PROFILE[h.family], 17)}
        </span>

        <span className="opener-row-text">
          <span className="opener-row-name">{h.label}</span>
          <span className="opener-row-blurb">{FAMILY_BLURB[h.family]}</span>
        </span>

        {mode === 'status' ? (
          <span className="opener-row-status-stack">
            <StatusBadge h={h} enabled={enabled} />
            {login ? <LoginBadge login={login} /> : null}
          </span>
        ) : null}

        {mode === 'status' && cliAction ? (
          <button
            type="button"
            className="settings-btn"
            disabled={cliDisabled}
            onClick={onCliInstall}
            data-testid={`harness-cli-update-${h.family}`}
          >
            {cliBusy ? providerCliBusyLabel(cliAction.kind) : cliAction.label}
          </button>
        ) : null}

        {mode === 'status' ? (
          enableKey ? (
            <ToggleSwitch
              checked={enabled}
              onChange={(on) => {
                const patch = harnessEnablePatch(h.family, on);
                onConfigDraft({ ...config, ...patch });
                void onUpdate(patch);
              }}
              label={`Show ${h.label} in the New Agent modal`}
            />
          ) : (
            <span className="opener-row-always" title="Always available">
              Always on
            </span>
          )
        ) : null}
        {mode === 'settings' ? <span className="harness-configure-label">Configure</span> : null}
      </RowHeader>
      {mode === 'status' && cliError ? (
        <p className="machine-cli-row-error" role="alert" data-testid={`harness-cli-error-${h.family}`}>
          {cliError}
        </p>
      ) : mode === 'status' && cliLog ? (
        <p className="machine-cli-row-progress" data-testid={`harness-cli-progress-${h.family}`}>
          {cliLog}
        </p>
      ) : mode === 'status' && cliHint ? (
        <ProviderCliUpdateHint
          reason={cliHint}
          testId={`harness-cli-hint-${h.family}`}
        />
      ) : null}

      {mode === 'settings' && open ? (
        <div className="opener-row-advanced harness-cli-options">
          {!shown || !h.installed ? (
            <p className="harness-option-notice" role="status">
              {!shown ? 'Enable this harness above to edit its launch defaults.' : 'Install this harness above to edit its launch defaults. You can set a custom binary below.'}
            </p>
          ) : null}
          {providerField || modelLevelField || executionStateField ? (
            <HarnessOptionsGroup title="Launch defaults" disabled={!shown || !h.installed}>
              {providerField}
              {modelLevelField}
              {executionStateField}
            </HarnessOptionsGroup>
          ) : null}
          {advanced}
          {h.family === 'opencode' ? (
            <HarnessOptionsGroup title="Project agents">
              <Field
                label="Discover project agents"
                layout="row"
                help="Show additional OpenCode agents in Modern and CLI Agent pickers. Build and Plan stay available when off."
              >
                <ToggleSwitch
                  checked={config.nativeAgentDiscoveryEnabled !== false}
                  onChange={(nativeAgentDiscoveryEnabled) => {
                    onConfigDraft({ ...config, nativeAgentDiscoveryEnabled });
                    void onUpdate({ nativeAgentDiscoveryEnabled });
                  }}
                  label="Discover additional native agents"
                />
              </Field>
            </HarnessOptionsGroup>
          ) : null}
          <HarnessOptionsGroup title="Connection">{binaryField}</HarnessOptionsGroup>
        </div>
      ) : null}
    </div>
  );
}

type ThreadProviderListItem = {
  id: string;
  displayName: string;
  pluginId: string;
};

const BUILTIN_THREAD_PROVIDERS: readonly ThreadProviderListItem[] = [
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

export function mergeBuiltinThreadProviders(rows: ThreadProviderListItem[]): ThreadProviderListItem[] {
  const seen = new Set(rows.map((row) => row.id));
  const missing = BUILTIN_THREAD_PROVIDERS.filter((row) => !seen.has(row.id));
  return missing.length === 0 ? rows : [...rows, ...missing];
}

const THREAD_PROVIDER_PROFILE: Record<string, LaunchProfileId> = {
  'claude-code': 'claude',
  'acp-cursor': 'cursor',
  cursor: 'cursor',
  'acp-opencode': 'opencode',
  opencode: 'opencode',
  'acp-grok': 'grok',
  grok: 'grok',
  'acp-mastracode': 'mastracode',
  mastracode: 'mastracode',
  'acp-afcode': 'afcode',
  afcode: 'afcode',
  codex: 'codex',
  pi: 'pi'
};

const THREAD_PROVIDER_BLURB: Record<string, string> = {
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

function threadProviderGlyph(providerId: string) {
  const Brand = providerIconForId(providerId);
  if (Brand) return <Brand size={17} />;
  const profile = THREAD_PROVIDER_PROFILE[providerId];
  return profile ? profileIcon(profile, 17) : <Bot size={17} />;
}

function threadProviderBlurb(providerId: string): string {
  return THREAD_PROVIDER_BLURB[providerId] ?? 'A provider for Modern conversations.';
}

const THREAD_PROVIDER_MODEL_CAP = 12;

function threadProviderModelsStatus(
  providerId: string,
  loading: boolean,
  entry: { models: { length: number }; modelLoadError: string | null } | undefined
): string {
  if (loading) return 'Loading…';
  if (!entry) return 'Not loaded';
  if (entry.models.length > 0) {
    return `${entry.models.length} model${entry.models.length === 1 ? '' : 's'}${entry.modelLoadError ? ' · Refresh failed' : ''}`;
  }
  const hint = emptyModelsHint(providerId, entry.modelLoadError);
  if (entry.modelLoadError && entry.modelLoadError !== 'auth_required') {
    return `${hint} (${entry.modelLoadError})`;
  }
  return hint;
}

function ThreadProviderRow({
  provider,
  entry,
  loading
}: {
  provider: ThreadProviderListItem;
  entry: ReturnType<typeof getThreadModelCatalog>['byProvider'][string] | undefined;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const models = entry?.models ?? [];
  const search = query.trim().toLocaleLowerCase();
  const matching = models.filter((model) => !search || `${model.displayName} ${model.id}`.toLocaleLowerCase().includes(search));
  const pageCount = Math.ceil(matching.length / THREAD_PROVIDER_MODEL_CAP);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const first = currentPage * THREAD_PROVIDER_MODEL_CAP;
  const visible = matching.slice(first, first + THREAD_PROVIDER_MODEL_CAP);
  const status = threadProviderModelsStatus(provider.id, loading, entry);
  return (
    <li className="opener-row">
      <button
        type="button"
        className="opener-row-head harness-disclosure"
        aria-expanded={open}
        aria-label={`Models for ${provider.displayName}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="opener-row-expand" aria-hidden>
          <ChevronRight
            size={14}
            className={`opener-row-chevron${open ? ' opener-row-chevron--open' : ''}`}
            aria-hidden
          />
        </span>
        <span className="opener-row-glyph" aria-hidden>
          {threadProviderGlyph(provider.id)}
        </span>
        <span className="opener-row-text">
          <span className="opener-row-name">{provider.displayName}</span>
          <span className="opener-row-blurb">{threadProviderBlurb(provider.id)}</span>
        </span>
        <span className="thread-provider-model-status">{status}</span>
      </button>
      {open ? (
        <div className="opener-row-advanced harness-thread-options">
          <div className="thread-provider-model-actions">
            <h4>Available models</h4>
            <button
              type="button"
              className="cred-btn"
              disabled={loading}
              onClick={() => {
                void reloadThreadProviderModels(provider.id);
              }}
            >
              <RefreshCw size={13} aria-hidden className={loading ? 'harness-recheck-spin' : undefined} />
              {models.length > 0 ? 'Reload' : 'Load'}
            </button>
          </div>
          {models.length > 0 ? (
            <label className="harness-model-search">
              <Search size={14} aria-hidden />
              <input
                type="search"
                aria-label={`Search ${provider.displayName} models`}
                placeholder="Search models…"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              />
            </label>
          ) : null}
          {visible.length > 0 ? (
            <ul className="thread-provider-models">
              {visible.map((model) => (
                <li key={model.id}>
                  <span className="harness-model-copy">
                    <span className="harness-model-name">{model.displayName}</span>
                    <code>{model.id}</code>
                  </span>
                  {model.isDefault ? <span className="harness-model-default">Provider default</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-help" role="status">{search && models.length > 0 ? 'No models match your search.' : status}</p>
          )}
          {matching.length > 0 ? (
            <div className="harness-model-pagination">
              <span>{first + 1}–{first + visible.length} of {matching.length} {matching.length === 1 ? 'model' : 'models'}</span>
              {pageCount > 1 ? (
                <div>
                  <button type="button" className="settings-btn" disabled={currentPage === 0}
                    aria-label={`Previous ${provider.displayName} models`} onClick={() => setPage(currentPage - 1)}>
                    <ChevronLeft size={14} aria-hidden /> Previous
                  </button>
                  <button type="button" className="settings-btn" disabled={currentPage >= pageCount - 1}
                    aria-label={`Next ${provider.displayName} models`} onClick={() => setPage(currentPage + 1)}>
                    Next <ChevronRight size={14} aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {entry?.modelLoadError && models.length > 0 ? (
            <p role="status" className="settings-help">Showing previously loaded models. {emptyModelsHint(provider.id, entry.modelLoadError, entry.modelLoadErrorDetail)}</p>
          ) : null}
          <div className="harness-model-meta">
            {entry?.lastSuccessAt != null ? <span>Last loaded: {new Date(entry.lastSuccessAt).toLocaleString()}</span> : null}
            <code className="thread-provider-id" title={provider.pluginId}>{provider.pluginId}</code>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function ThreadProviderCatalog({
  providers
}: {
  providers: ThreadProviderListItem[];
}) {
  const catalog = useSyncExternalStore(
    subscribeThreadModelCatalog,
    getThreadModelCatalog,
    getThreadModelCatalog
  );
  if (providers.length === 0) {
    return <p className="settings-help">No Modern providers registered.</p>;
  }
  return (
    <>
    {catalog.rosterError ? <p role="status" className="settings-help">Could not refresh providers. {catalog.rosterError}</p> : null}
    <ul className="opener-list thread-provider-list" data-testid="thread-provider-catalog">
      {providers.map((provider) => (
        <ThreadProviderRow
          key={provider.id}
          provider={provider}
          entry={catalog.byProvider[provider.id]}
          loading={catalog.inflight.has(provider.id)}
        />
      ))}
    </ul>
    </>
  );
}

function ThreadProvidersPanel() {
  const [providers, setProviders] = useState<ThreadProviderListItem[] | null>(null);
  useEffect(() => {
    void prefetchThreadModelCatalog();
  }, []);
  useEffect(() => {
    let cancelled = false;
    void product.threads.providers()
      .then((body) => {
        if (!cancelled) setProviders(mergeBuiltinThreadProviders(body.providers));
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (providers === null) {
    return <StencilForm label="Loading Modern providers" />;
  }
  return <ThreadProviderCatalog providers={providers} />;
}

export function HarnessView({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const status = useData((s) => s.harnessStatus);
  const refresh = useData((s) => s.refreshHarnessStatus);
  const modelCatalog = useSyncExternalStore(
    subscribeThreadModelCatalog,
    getThreadModelCatalog,
    getThreadModelCatalog
  );
  // Track the in-flight probe so the button can show it's actively re-checking —
  // the row list stays populated during a re-check (each probe runs `--version`).
  const [checking, setChecking] = useState(false);
  const [pane, setPane] = useState<'thread' | 'legacy'>('thread');
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[] | null>(null);
  const settingsAnchor = useUi((s) => s.settingsAnchor);
  const hosts = useHosts();
  const thisMachine = primaryHost(hosts);
  const thisMachineId = thisMachine?.status === 'connected' ? thisMachine.id : undefined;
  const [cliStatus, setCliStatus] = useState<ProviderCliStatusResponse>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [installLogs, setInstallLogs] = useState<Record<string, string>>({});

  useLayoutEffect(() => {
    if (settingsAnchor === 'harness-legacy') setPane('legacy');
    if (settingsAnchor === 'harness-thread') setPane('thread');
  }, [settingsAnchor]);

  const runCheck = () => {
    setChecking(true);
    Promise.resolve(refresh()).finally(() => setChecking(false));
  };

  const refreshCliStatus = useCallback(async () => {
    if (!thisMachineId) {
      setCliStatus({});
      return;
    }
    try {
      setCliStatus(await product.hosts.providerCliStatus(thisMachineId));
    } catch {
      setCliStatus({});
    }
  }, [thisMachineId]);

  // Re-probe whenever the AI Harness tab mounts so a CLI installed since boot
  // (or a changed binary path) is reflected without a full app restart.
  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    void refreshCliStatus();
  }, [refreshCliStatus]);

  const actionable = useMemo(
    () => (thisMachineId ? actionableProviderCliRows({ [thisMachineId]: cliStatus }) : []),
    [thisMachineId, cliStatus]
  );

  useEffect(() => {
    const descriptors = hasDesktopBridge() ? product.harness.descriptors : undefined;
    if (typeof descriptors !== 'function') return;
    let cancelled = false;
    descriptors()
      .then((next) => { if (!cancelled) setDescriptors(next); })
      .catch(() => { if (!cancelled) setDescriptors([]); });
    return () => { cancelled = true; };
  }, []);

  const claudeAdvanced = (
    <>
      <HarnessOptionsGroup title="Instructions" help="Add guidance for every Claude Code CLI agent.">
        <Field
          label="Append system prompt"
          help="Additive: this text is appended first. Project, Persona, and Agent prompt text is appended after it."
        >
          <textarea
            className="settings-textarea"
            rows={4}
            value={config.claudeAppendSystemPrompt ?? ''}
            onChange={(event) => onConfigDraft({ ...config, claudeAppendSystemPrompt: event.target.value })}
            onBlur={(event) => void onUpdate({ claudeAppendSystemPrompt: event.target.value.trim() || undefined })}
            placeholder="Optional"
          />
        </Field>
      </HarnessOptionsGroup>
      <HarnessOptionsGroup title="Command arguments">
        <TextArgsField
          label="Extra args"
          help="Applied first. If a later Project, Persona, or Agent setting uses the same option, the later setting takes priority."
          values={config.claudeExtraArgs ?? []}
          placeholder="--plugin-dir /path/to/plugin"
          onChange={(values) => void onUpdate({ claudeExtraArgs: values.length ? values : undefined })}
        />
      </HarnessOptionsGroup>
      <HarnessOptionsGroup title="Tools & access" help="Directories and tool rules combine with your Project, Persona, and Agent settings.">
        <ChipField
          label="Add dirs"
          help="Combined: directories from Global, Project, Persona, and Agent settings are all included."
          values={config.claudeAddDirs ?? []}
          placeholder="/path/to/dir"
          onChange={(values) => void onUpdate({ claudeAddDirs: values.length ? values : undefined })}
        />
        <ChipField
          label="Allowed tools"
          help="Combined and deduplicated across Global, Project, Persona, and Agent settings."
          values={config.claudeAllowedTools ?? []}
          placeholder="Bash(git:*)"
          onChange={(values) => void onUpdate({ claudeAllowedTools: values.length ? values : undefined })}
        />
        <ChipField
          label="Denied tools"
          help="Combined and deduplicated across every level. A denial remains in effect when later levels add more settings."
          values={config.claudeDeniedTools ?? []}
          placeholder="Bash(rm:*)"
          onChange={(values) => void onUpdate({ claudeDeniedTools: values.length ? values : undefined })}
        />
      </HarnessOptionsGroup>
    </>
  );

  // PI's launcher-wide (provider, model, thinking) defaults live in its Advanced
  // disclosure, grouped separately from connection settings.
  const piAdvanced = (
    <>
      <Field
        label="Default provider"
        help="Provider name, such as anthropic or openai. Leave blank to use Pi’s own default."
        mono
      >
        <input
          type="text"
          value={config.piProvider ?? ''}
          placeholder="anthropic"
          onChange={(e) => onConfigDraft({ ...config, piProvider: e.target.value })}
          onBlur={(e) => onUpdate({ piProvider: e.target.value.trim() || undefined })}
          spellCheck={false}
        />
      </Field>
      <Field
        label="Default model"
        help="A model ID or name pattern, such as openai/gpt-5 or sonnet. Leave blank to use the provider’s default."
        mono
      >
        <input
          type="text"
          value={config.piModel ?? ''}
          placeholder="anthropic/claude-opus-4-8"
          onChange={(e) => onConfigDraft({ ...config, piModel: e.target.value })}
          onBlur={(e) => onUpdate({ piModel: e.target.value.trim() || undefined })}
          spellCheck={false}
        />
      </Field>
      <Field
        label="Default thinking level"
        layout="row"
        help="Choose how much reasoning Pi uses. Default lets Pi decide."
      >
        <PopoverPicklist
          value={config.piThinking ?? 'default'}
          ariaLabel="Default thinking level"
          searchable={false}
          onChange={(piThinking) => onUpdate({ piThinking: piThinking as AppConfig['piThinking'] })}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'off', label: 'Off' },
            { value: 'minimal', label: 'Minimal' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' },
            { value: 'max', label: 'Max' }
          ]}
        />
      </Field>
    </>
  );

  const piNativeAdvanced = (
    <HarnessOptionsGroup title="Provider & reasoning" disabled={config.harnessPiEnabled === false || status.find((entry) => entry.family === 'pi')?.installed !== true}>
      {piAdvanced}
    </HarnessOptionsGroup>
  );

  const codexAdvanced = (
    <HarnessOptionsGroup title="Permissions & isolation" disabled={config.harnessCodexEnabled === false || status.find((entry) => entry.family === 'codex')?.installed !== true}>
      <Field
        label="Default Sandbox Policy"
        layout="row"
        help="Choose which files and commands Codex can access."
      >
        <HarnessOptionSelect
          id="global-codex-sandbox"
          options={CODEX_UI.sandboxes}
          value={config.defaultCodexSandbox ?? ''}
          onChange={(value) => void onUpdate({ defaultCodexSandbox: (value as AppConfig['defaultCodexSandbox']) || undefined })}
          sentinel={USE_HARNESS_DEFAULT}
          dropDefaultId
        />
      </Field>
      <Field
        label="Default Approval Policy"
        layout="row"
        help="Choose when Codex asks before taking an action."
      >
        <HarnessOptionSelect
          id="global-codex-approval"
          options={CODEX_UI.approvals}
          value={config.defaultCodexApproval ?? ''}
          onChange={(value) => void onUpdate({ defaultCodexApproval: (value as AppConfig['defaultCodexApproval']) || undefined })}
          sentinel={USE_HARNESS_DEFAULT}
          dropDefaultId
        />
      </Field>
    </HarnessOptionsGroup>
  );

  const contributionNodes: Record<string, React.ReactNode> = {
    'claude-global-defaults': claudeAdvanced,
    'codex-global-defaults': codexAdvanced,
    'pi-global-defaults': piNativeAdvanced
  };
  const descriptorsById = new Map((descriptors ?? []).map((descriptor) => [descriptor.id, descriptor]));
  const defaultHarnessOptions = (descriptors ?? []).filter((descriptor) => descriptor.agentDefaultEligible);
  const selectedDefaultEnableKey = config.defaultHarness ? ENABLE_KEY[config.defaultHarness] : undefined;
  const selectedDefaultStatus = config.defaultHarness
    ? status.find((entry) => entry.family === config.defaultHarness)
    : undefined;
  const defaultUnavailable = !!config.defaultHarness && (
    (!!selectedDefaultEnableKey && config[selectedDefaultEnableKey] === false) ||
    selectedDefaultStatus?.installed === false
  );
  const optionAvailability = new Map(status.map((entry) => [entry.family, entry]));
  const health = summarizeHarnessHealth(status, config);

  async function runInstall(
    provider: ProviderCliKey,
    actionKind: ProviderCliInstallActionKind,
    command?: string
  ): Promise<void> {
    if (!thisMachineId) return;
    const key = `${thisMachineId}:${provider}`;
    setBusyKey(key);
    setInstallErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const events: Parameters<typeof providerCliInstallLogLines>[0] = [];
    setInstallLogs((prev) => ({
      ...prev,
      [key]: command ? providerCliStartLog(command) : 'Starting… This can take a few minutes.'
    }));
    try {
      const outcome = await installProviderCliOnMachine({
        hostId: thisMachineId,
        provider,
        actionKind,
        onEvent: (event) => {
          events.push(event);
          const lines = providerCliInstallLogLines(events);
          if (lines.length > 0) {
            setInstallLogs((prev) => ({ ...prev, [key]: lines.join('\n') }));
          }
        },
        install: product.hosts.installProviderCli
      });
      if (!outcome.ok) {
        setInstallErrors((prev) => ({ ...prev, [key]: outcome.message }));
      }
      setInstallLogs((prev) => dismissInstallLogOnSuccess(prev, key, outcome.ok));
      await refreshCliStatus();
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  const settingsRows = status.length === 0 ? (
    <p className="settings-help">Checking…</p>
  ) : (
    status.map((h) => {
      const descriptor = descriptorsById.get(h.family);
      const contributionIds = descriptor?.settingsContributionIds ?? (descriptors === null
        ? h.family === 'claude'
          ? ['claude-global-defaults']
          : h.family === 'pi'
            ? ['pi-global-defaults']
            : []
        : []);
      const advanced = contributionIds
        .map((id) => contributionNodes[id])
        .filter(Boolean);
      return (
        <HarnessRow
          key={h.family}
          h={h}
          config={config}
          onConfigDraft={onConfigDraft}
          onUpdate={onUpdate}
          descriptor={descriptor}
          advanced={advanced.length ? <>{advanced}</> : undefined}
          mode="settings"
        />
      );
    })
  );

  return (
    <div className="harness-settings">
    <Section
      anchorId="harness-status"
      title="Installed harnesses"
      help="Choose which coding agents appear when you start a session. Each harness uses its own account and sign-in."
      flush
    >
      <div className={`harness-health harness-health--${health.ok ? 'ok' : 'warn'}`} role="status">
        <span className="harness-machine-icon" aria-hidden><Laptop size={20} /></span>
        <div className="harness-health-copy">
          <span className="harness-machine-name">This machine{thisMachine?.name ? ` · ${thisMachine.name}` : ''}</span>
          <span className="harness-health-msg">{checking ? 'Checking installation and sign-in…' : health.message}</span>
        </div>
        <div className="harness-health-actions">
          {actionable.length > 0 ? (
            <button
              type="button"
              className="settings-btn primary"
              disabled={busyKey !== null}
              data-testid="harness-update-all"
              onClick={() => {
                void (async () => {
                  for (const item of actionable) {
                    await runInstall(item.provider, item.action.kind, item.action.command);
                  }
                })();
              }}
            >
              <Download size={13} aria-hidden="true" />
              Update all ({actionable.length})
            </button>
          ) : null}
          <button type="button" className="cred-btn" onClick={runCheck} disabled={checking}>
            <RefreshCw size={14} className={checking ? 'harness-recheck-spin' : undefined} aria-hidden />
            {checking ? 'Checking…' : 'Check status'}
          </button>
        </div>
      </div>
      <div className="opener-list" data-testid="harness-status-list">
        {status.length === 0 ? (
          <p className="settings-help">Checking…</p>
        ) : (
          status.map((h) => {
            const provider = providerCliKeyForFamily(h.family);
            const row = provider
              ? orderedProviderCliRows(cliStatus).find((entry) => entry.provider === provider)
              : undefined;
            const key = thisMachineId && provider ? `${thisMachineId}:${provider}` : null;
            return (
              <HarnessRow
                key={h.family}
                h={h}
                config={config}
                onConfigDraft={onConfigDraft}
                onUpdate={onUpdate}
                mode="status"
                login={harnessLoginStatus(h.family, modelCatalog, h.installed)}
                cliAction={row?.status.installAction ?? null}
                cliBusy={key !== null && busyKey === key}
                cliDisabled={busyKey !== null || !thisMachineId}
                cliLog={key ? installLogs[key] : undefined}
                cliError={key ? installErrors[key] : undefined}
                cliHint={row?.status.updateUnavailableReason ?? undefined}
                onCliInstall={
                  row?.status.installAction && provider
                    ? () => void runInstall(
                      provider,
                      row.status.installAction!.kind,
                      row.status.installAction!.command
                    )
                    : undefined
                }
              />
            );
          })
        )}
      </div>
      <div className="harness-setup-footer">
        <span>Check status refreshes installation, sign-in, and model availability.</span>
        <a href={getSettingsRoutePath('machines')} data-testid="harness-machines-link">
          Manage machines <ChevronRight size={13} aria-hidden />
        </a>
      </div>
    </Section>

    <Section anchorId="harness-models" title="Model lists" flush>
      <ModelRefreshControl />
    </Section>

    <Section title="Session settings" flush>
      <HarnessSettingsTabs pane={pane} onPaneChange={setPane} />
      <div
        role="tabpanel"
        id="settings-anchor-harness-thread"
        aria-labelledby="harness-tab-thread"
        hidden={pane !== 'thread'}
        data-testid="harness-thread-pane"
      >
        <p className="settings-help settings-section-help">
          Browse models for Thread conversations. Choose a model in the conversation
          composer; open a harness here to search its models or refresh availability.
        </p>
        <ThreadProvidersPanel />
      </div>
      <div
        role="tabpanel"
        id="settings-anchor-harness-legacy"
        aria-labelledby="harness-tab-legacy"
        hidden={pane !== 'legacy'}
        data-testid="harness-legacy-pane"
      >
        <p className="settings-help settings-section-help">
          Set defaults for agents running in a terminal. Project, Persona, and
          Agent settings can override these defaults.
        </p>
        <div className="harness-default-card">
          <Field
            label="Default harness"
            layout="row"
            help="Used when a new CLI agent has no explicit harness or pinned Persona."
          >
            {descriptors === null ? (
              <Skeleton width="180px" height="28px" />
            ) : (
              <PopoverPicklist
                value={config.defaultHarness ?? 'claude'}
                ariaLabel="Default harness"
                onChange={(nextHarness) => {
                  const defaultHarness = nextHarness as AppConfig['defaultHarness'];
                  onConfigDraft({ ...config, defaultHarness });
                  void onUpdate({ defaultHarness });
                }}
                options={defaultHarnessOptions.map((descriptor) => ({
                  value: descriptor.id,
                  label: `${descriptor.label}${descriptor.availability.installed ? '' : ' (not installed)'}`,
                  disabled: (descriptor.id !== 'shell' && optionAvailability.get(descriptor.id)?.installed === false) ||
                    (descriptor.id !== 'shell' && !!ENABLE_KEY[descriptor.id] && config[ENABLE_KEY[descriptor.id]!] === false)
                }))}
              />
            )}
          </Field>
          <div className="harness-inheritance" aria-label="Settings priority">
            <span>Settings apply in order</span>
            <ol>{['Global', 'Project', 'Persona', 'Agent'].map((level) => <li key={level}>{level}</li>)}</ol>
            <span>Later choices take priority.</span>
          </div>
        </div>
        {defaultUnavailable && (
          <p className="settings-help" role="alert">
            {unavailableDefaultMessage(config.defaultHarness!)}
            {' '}
            <button
              type="button"
              className="settings-btn"
              onClick={() => {
                onConfigDraft({ ...config, defaultHarness: undefined });
                void onUpdate({ defaultHarness: undefined });
              }}
            >
              Clear default
            </button>
          </p>
        )}
        <div className="opener-list" data-testid="harness-legacy-list">
          {settingsRows}
        </div>
        <RemoteMachineDefaultsList />
      </div>
    </Section>
    </div>
  );
}

export function HarnessSettingsTabs({
  pane,
  onPaneChange
}: {
  pane: 'thread' | 'legacy';
  onPaneChange: (next: 'thread' | 'legacy') => void;
}) {
  const tabs = [
    { id: 'thread', label: 'Modern', description: 'Conversations & models', Icon: MessageSquare },
    { id: 'legacy', label: 'CLI Agent', description: 'Terminal launch defaults', Icon: Terminal }
  ] as const;
  return (
    <div className="harness-session-tabs" role="tablist" aria-label="Harness settings">
      {tabs.map(({ id, label, description, Icon }, index) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`harness-tab-${id}`}
          aria-label={label}
          aria-controls={`settings-anchor-harness-${id}`}
          aria-selected={pane === id}
          tabIndex={pane === id ? 0 : -1}
          className={`harness-session-tab${pane === id ? ' is-active' : ''}`}
          onClick={() => onPaneChange(id)}
          onKeyDown={(event) => {
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1
              : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? 1 - index : null;
            if (next === null) return;
            event.preventDefault();
            onPaneChange(tabs[next].id);
            (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
          }}
        >
          <Icon size={18} aria-hidden />
          <span><span className="harness-session-tab-label">{label}</span>
            <span className="harness-session-tab-description">{description}</span></span>
        </button>
      ))}
    </div>
  );
}

export function unavailableDefaultMessage(defaultHarness: HarnessFamily): string {
  return `Default harness ${defaultHarness} is disabled or unavailable. Defaulted launches will block until you restore it, choose another default, or clear it.`;
}

export function harnessEnablePatch(family: HarnessFamily, enabled: boolean): Partial<AppConfig> {
  const key = ENABLE_KEY[family];
  return key ? { [key]: enabled } : {};
}

export { HarnessView as HarnessTab };
