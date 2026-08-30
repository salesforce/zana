import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { product } from '../../lib/product-client.js';
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, RefreshCw, XCircle } from 'lucide-react';
import type { AppConfig, HarnessFamily, HarnessVerifyResult, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { useData, useUi } from '@/store';
import { profileIcon } from '@/lib/profileIcon';
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

const USE_HARNESS_DEFAULT = { id: '', label: 'Use harness default' } as const;
const CODEX_UI = providerUiSchema('codex');

/**
 * Settings → Code Harness. The page leads with a verification list (install
 * probe + enable switch for each coding CLI), then Modern / CLI Agent tabs
 * for the settings that belong to each launch path.
 *
 * The install probe (`<binary> --version`) is folded into the status rows so
 * the operator sees WHY an enabled harness might be greyed-out in the New Agent
 * modal (its CLI isn't on PATH) right where they toggle it. Claude Code is
 * `alwaysEnabled` — it has no switch (like Finder in the opener bar), only a
 * status badge. Optional families auto-activate when the CLI is found; the
 * switch is an explicit hide, not a required opt-in.
 *
 * NOTE: these are the coding-CLI harnesses (`cursor-agent`/`codex`/`pi`/
 * `opencode`) — DISTINCT from the GUI-launch editors (`cursor`/`code`/`idea`)
 * under the Editor tab. Provider API keys live under the LLM Providers tab; each
 * harness authenticates via its own login flow.
 */

/** Map a harness family → the base launch profile whose glyph represents it, so
 *  the row icons match the New Agent modal's picker exactly. */
const FAMILY_PROFILE: Record<HarnessFamily, LaunchProfileId> = {
  claude: 'claude',
  cursor: 'cursor',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode'
};

/** One-line blurb per family, shown under the name in the row. */
const FAMILY_BLURB: Record<HarnessFamily, string> = {
  claude: 'Anthropic’s Claude Code CLI — the default harness.',
  cursor: 'The ‘cursor-agent’ coding CLI. Authenticates via its own login.',
  codex: 'OpenAI’s ‘codex’ coding CLI. Authenticates via its own login.',
  pi: 'The multi-provider ‘pi’ coding-agent CLI (~40 providers).',
  opencode: 'The ‘opencode’ terminal agent (npm ‘opencode-ai’). zcc-inbox is wired in automatically.'
};

/** The `AppConfig` enable flag per family (`claude` has none — always on). */
const ENABLE_KEY: Partial<Record<HarnessFamily, keyof AppConfig>> = {
  cursor: 'harnessCursorEnabled',
  codex: 'harnessCodexEnabled',
  pi: 'harnessPiEnabled',
  opencode: 'harnessOpenCodeEnabled'
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
  if (installed === total && enabled === total) {
    return { ok: true, message: `All ${total} installed and enabled`, installed, enabled, total };
  }
  const parts: string[] = [];
  if (installed !== total) parts.push(`${installed} of ${total} installed`);
  const disabled = status.filter((_, index) => !enabledFlags[index]);
  if (disabled.length) {
    const names = disabled.map((row) => row.label).join(', ');
    parts.push(`${names} ${disabled.length === 1 ? 'is' : 'are'} off`);
  }
  return { ok: false, message: parts.join(' · '), installed, enabled, total };
}

/** The `AppConfig` binary-override key per family. */
const BINARY_KEY: Record<HarnessFamily, keyof AppConfig> = {
  claude: 'claudeBinary',
  cursor: 'cursorBinary',
  codex: 'codexBinary',
  pi: 'piBinary',
  opencode: 'opencodeBinary'
};

/** Default binary name (the `--version` probe target) shown as the input placeholder. */
const BINARY_PLACEHOLDER: Record<HarnessFamily, string> = {
  claude: 'claude',
  cursor: 'cursor-agent',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode'
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
      {h.installed ? h.version || 'installed' : missing ? 'not found' : 'off'}
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
  login
}: {
  h: HarnessVerifyResult;
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
  descriptor?: HarnessAdapterDescriptor;
  advanced?: React.ReactNode;
  mode: 'status' | 'settings';
  login?: HarnessLoginStatus | null;
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
      help={`Command run for ${h.family} tabs. Blank ⇒ ‘${BINARY_PLACEHOLDER[h.family]}’ on your PATH.`}
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
    <Field label="Default Provider" help={providerRelationship === 'fixed-provider'
      ? `${h.label} uses this fixed provider.`
      : 'Selects which provider’s models appear below. Combined provider/model harnesses encode this choice in the model id.'}>
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
    <Field label="Default Model Level" help={`Native ${h.label} models with their portable model-level mapping.`}>
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
    <Field label="Default Execution State" help={`Native ${h.label} execution policies with their portable execution-state mapping.`}>
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

  return (
    <div
      className={`opener-row${shown ? '' : ' opener-row--off'}`}
      id={mode === 'status' ? `settings-anchor-harness-${h.family}` : undefined}
    >
      <div className="opener-row-head">
        {mode === 'settings' ? (
          <button
            type="button"
            className="opener-row-expand"
            aria-expanded={open}
            aria-label={`Advanced settings for ${h.label}`}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight
              size={14}
              className={`opener-row-chevron${open ? ' opener-row-chevron--open' : ''}`}
              aria-hidden
            />
          </button>
        ) : null}

        <span className="opener-row-glyph" aria-hidden>
          {profileIcon(FAMILY_PROFILE[h.family], 17)}
        </span>

        <div className="opener-row-text">
          <span className="opener-row-name">{h.label}</span>
          <span className="opener-row-blurb">{FAMILY_BLURB[h.family]}</span>
        </div>

        {mode === 'status' ? (
          <span className="opener-row-status-stack">
            <StatusBadge h={h} enabled={enabled} />
            {login ? <LoginBadge login={login} /> : null}
          </span>
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
              default
            </span>
          )
        ) : null}
      </div>

      {mode === 'settings' && open ? (
        <div className="opener-row-advanced">
          {binaryField}
          <fieldset disabled={!shown || !h.installed} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {providerField}
            {modelLevelField}
            {executionStateField}
          </fieldset>
          {advanced}
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
  { id: 'acp-opencode', displayName: 'OpenCode', pluginId: 'provider-acp' }
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
  codex: 'codex',
  pi: 'pi'
};

const THREAD_PROVIDER_BLURB: Record<string, string> = {
  'claude-code': 'Anthropic’s Claude Code — the default Modern provider.',
  'acp-cursor': 'Cursor via the Agent Client Protocol (ACP).',
  cursor: 'Cursor via the Agent Client Protocol (ACP).',
  'acp-opencode': 'OpenCode via the Agent Client Protocol (ACP).',
  opencode: 'OpenCode via the Agent Client Protocol (ACP).',
  codex: 'OpenAI’s Codex coding CLI.',
  pi: 'The multi-provider Pi coding-agent CLI.',
  fake: 'Test-only provider used by AgentRuntime.'
};

function threadProviderGlyph(providerId: string) {
  const Brand = providerIconForId(providerId);
  if (Brand) return <Brand size={17} />;
  const profile = THREAD_PROVIDER_PROFILE[providerId];
  return profile ? profileIcon(profile, 17) : <Bot size={17} />;
}

function threadProviderBlurb(providerId: string): string {
  return THREAD_PROVIDER_BLURB[providerId] ?? 'Registered Modern provider plugin.';
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
    return `${entry.models.length} model${entry.models.length === 1 ? '' : 's'}`;
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
  const models = entry?.models ?? [];
  const visible = models.slice(0, THREAD_PROVIDER_MODEL_CAP);
  const hidden = models.length - visible.length;
  const status = threadProviderModelsStatus(provider.id, loading, entry);
  return (
    <li className="opener-row">
      <div className="opener-row-head">
        <button
          type="button"
          className="opener-row-expand"
          aria-expanded={open}
          aria-label={`Models for ${provider.displayName}`}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight
            size={14}
            className={`opener-row-chevron${open ? ' opener-row-chevron--open' : ''}`}
            aria-hidden
          />
        </button>
        <span className="opener-row-glyph" aria-hidden>
          {threadProviderGlyph(provider.id)}
        </span>
        <div className="opener-row-text">
          <span className="opener-row-name">{provider.displayName}</span>
          <span className="opener-row-blurb">{threadProviderBlurb(provider.id)}</span>
        </div>
        <span className="thread-provider-model-status">{status}</span>
        <code className="thread-provider-id" title={provider.pluginId}>
          {provider.pluginId}
        </code>
      </div>
      {open ? (
        <div className="opener-row-advanced">
          <div className="thread-provider-model-actions">
            <button
              type="button"
              className="cred-btn"
              disabled={loading}
              onClick={() => {
                void reloadThreadProviderModels(provider.id);
              }}
            >
              {models.length > 0 ? 'Reload' : 'Load'}
            </button>
          </div>
          {visible.length > 0 ? (
            <ul className="thread-provider-models">
              {visible.map((model) => (
                <li key={model.id} title={model.id}>
                  {model.displayName} <code>{model.id}</code>
                </li>
              ))}
              {hidden > 0 ? <li className="thread-provider-models-more">and {hidden} more</li> : null}
            </ul>
          ) : (
            <p className="settings-help">{status}</p>
          )}
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

  useLayoutEffect(() => {
    if (settingsAnchor === 'harness-legacy') setPane('legacy');
    if (settingsAnchor === 'harness-thread') setPane('thread');
  }, [settingsAnchor]);

  const runCheck = () => {
    setChecking(true);
    Promise.resolve(refresh()).finally(() => setChecking(false));
  };

  // Re-probe whenever the Code Harness tab mounts so a CLI installed since boot
  // (or a changed binary path) is reflected without a full app restart.
  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

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
    <fieldset disabled={false} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
      <TextArgsField
        label="Extra args"
        help="Applied first. If a later Project, Persona, or Agent setting uses the same option, the later setting takes priority."
        values={config.claudeExtraArgs ?? []}
        placeholder="--plugin-dir /path/to/plugin"
        onChange={(values) => void onUpdate({ claudeExtraArgs: values.length ? values : undefined })}
      />
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
    </fieldset>
  );

  // PI's launcher-wide (provider, model, thinking) defaults live in its Advanced
  // disclosure, below the binary field.
  const piAdvanced = (
    <>
      <Field
        label="Default provider"
        help="Passed as ‘pi --provider <name>’. PI accepts any of its ~40 providers (anthropic, openai, google, mistral, …). Blank ⇒ PI’s own default."
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
        help="Passed as ‘pi --model <pattern>’. A ‘provider/id’ slug (openai/gpt-5), a fuzzy pattern (sonnet), or a ‘:thinking’ suffix. Blank ⇒ PI’s provider default."
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
        help="Passed as ‘pi --thinking <level>’ — PI’s extended-reasoning budget. ‘Default’ ⇒ emit no flag (PI decides)."
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
    <fieldset disabled={config.harnessPiEnabled === false || status.find((entry) => entry.family === 'pi')?.installed !== true} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {piAdvanced}
    </fieldset>
  );

  const codexAdvanced = (
    <fieldset disabled={config.harnessCodexEnabled === false || status.find((entry) => entry.family === 'codex')?.installed !== true} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field
        label="Default Sandbox Policy"
        help="Controls filesystem and command isolation. Bracketed text shows which portable Persona/Agent Execution State normally selects this policy."
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
        help="Controls when Codex asks before acting. Bracketed text shows which portable Persona/Agent Execution State normally selects this policy."
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
    </fieldset>
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
    <>
    <Section
      anchorId="harness-status"
      title="Install status"
      help="Coding CLIs used by Modern and CLI agents. Enable a family here to show it in launch UIs. Check re-probes each binary and, for Cursor and Codex, whether you are signed in — a successful check also refreshes their model lists."
    >
      <div className={`harness-health harness-health--${health.ok ? 'ok' : 'warn'}`} role="status">
        {health.ok ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
        <span className="harness-health-msg">{health.message}</span>
        <button type="button" className="cred-btn" onClick={runCheck} disabled={checking}>
          <RefreshCw size={14} className={checking ? 'harness-recheck-spin' : undefined} aria-hidden />
          {checking ? 'Checking…' : 'Check, Install or Fix'}
        </button>
      </div>
      <div className="opener-list" data-testid="harness-status-list">
        {status.length === 0 ? (
          <p className="settings-help">Checking…</p>
        ) : (
          status.map((h) => (
            <HarnessRow
              key={h.family}
              h={h}
              config={config}
              onConfigDraft={onConfigDraft}
              onUpdate={onUpdate}
              mode="status"
              login={harnessLoginStatus(h.family, modelCatalog, h.installed)}
            />
          ))
        )}
      </div>
    </Section>

    <div className="settings-section settings-section--flush">
      <HarnessSettingsTabs pane={pane} onPaneChange={setPane} />
      <div
        role="tabpanel"
        id="settings-anchor-harness-thread"
        hidden={pane !== 'thread'}
        data-testid="harness-thread-pane"
      >
        <p className="settings-help settings-section-help">
          These plugins power Modern conversations. They register through{' '}
          <code>experimental_registerProvider</code> and launch via AgentRuntime
          — not the CLI Agent PTY harness. Model names come from the host; Reload
          fetches that provider again and updates the composer picker, bypassing
          its cache.
        </p>
        <ThreadProvidersPanel />
      </div>
      <div
        role="tabpanel"
        id="settings-anchor-harness-legacy"
        hidden={pane !== 'legacy'}
        data-testid="harness-legacy-pane"
      >
        <p className="settings-help settings-section-help">
          PTY coding-agent CLIs used only by legacyAgentSession. Global defaults apply first.
          Launch settings then apply in this order: Global → Project → Persona → Agent.
        </p>
        <Field
          label="Default harness"
          help="Used for defaulted new-agent launches. Explicit profile selections and pinned personas keep their profile."
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
      </div>
    </div>
    </>
  );
}

export function HarnessSettingsTabs({
  pane,
  onPaneChange
}: {
  pane: 'thread' | 'legacy';
  onPaneChange: (next: 'thread' | 'legacy') => void;
}) {
  return (
    <div className="settings-tabs" role="tablist" aria-label="Harness settings">
      <button
        type="button"
        role="tab"
        aria-selected={pane === 'thread'}
        className={`settings-tab${pane === 'thread' ? ' is-active' : ''}`}
        onClick={() => onPaneChange('thread')}
      >
        Modern
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={pane === 'legacy'}
        className={`settings-tab${pane === 'legacy' ? ' is-active' : ''}`}
        onClick={() => onPaneChange('legacy')}
      >
        CLI Agent
      </button>
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
