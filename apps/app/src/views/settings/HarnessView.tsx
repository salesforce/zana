import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { precedenceHelp } from '@zana-ai/zcc-domain/setting-precedence';
import { product } from '../../lib/product-client.js';
import { AlertTriangle, CheckCircle2, ChevronRight, Download } from 'lucide-react';
import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import type { ProviderCliInstallActionKind, ProviderCliKey, ProviderCliStatusResponse } from '@zana-ai/zcc-contracts/host-rpc';
import { useData } from '@/store';
import { sortHarnessDisplayRows } from '@/lib/harness-display-order';
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
import { Section, Field, ToggleSwitch, ChipField, TextArgsField } from '@/components/settings/FormFields';
import { HarnessOptionSelect } from '@/components/HarnessOptionSelect';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { Skeleton } from '@/components/ui/Skeleton';
import { providerUiSchema } from '@zana-ai/zcc-domain/launch-provider';
import type { ThreadModelCatalogSnapshot } from '../../components/thread/pickers/thread-model-catalog.js';
import {
  harnessLoginStatus,
  type HarnessLoginStatus
} from '../../components/thread/pickers/harness-login.js';
import { RemoteMachineDefaultsList } from './RemoteMachineDefaultsList.js';
import { ModelRefreshControl } from './ModelRefreshControl.js';
import { RegisteredHarnesses } from './RegisteredHarnesses.js';
import { MachineEnvironmentSettings } from './MachineEnvironmentSettings.js';
import { RevealContext } from '@/lib/settings-search/reveal';
import {
  HARNESS_BINARY_KEY,
  HARNESS_BINARY_PLACEHOLDER,
  HARNESS_ENABLE_KEY,
  harnessRowPrefix,
  rememberHarnessDescriptors
} from '@/lib/settings-search/providers/harness';
import { HarnessModelTiers, usesTierRules } from './HarnessModelTiers.js';
import './harness-settings.css';

const USE_HARNESS_DEFAULT = { id: '', label: 'Use harness default' } as const;
const CODEX_UI = providerUiSchema('codex');

const ENABLE_KEY = HARNESS_ENABLE_KEY;

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

const BINARY_KEY = HARNESS_BINARY_KEY;
const BINARY_PLACEHOLDER = HARNESS_BINARY_PLACEHOLDER;

export function LoginBadge({ login }: { login: HarnessLoginStatus }) {
  if (login.state === 'checking') {
    return (
      <span className="opener-row-status opener-row-status--muted" title={`Checking ${login.loginCommand}`}>
        checking login…
      </span>
    );
  }
  if (login.state === 'sign_in_required') {
    const hint = `Not signed in. Run "${login.loginCommand}" in a terminal, then click Check status.`;
    return (
      <>
        <span className="opener-row-status opener-row-status--warn" title={hint}>
          <AlertTriangle size={13} />
          sign in
        </span>
        {/* Visible, not hover-only: the command is the fix. */}
        <code className="opener-row-status opener-row-status--muted" title={hint} data-testid="harness-login-command">
          {login.loginCommand}
        </code>
      </>
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
function HarnessCliSettings({
  h,
  config,
  onConfigDraft,
  onUpdate,
  descriptor,
  advanced,
  loadingOptions,
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
  loadingOptions: boolean;
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
  const [binaryDraft, setBinaryDraft] = useState<string | null>(null);
  // Value shown when editing began: onConfigDraft rewrites `config` on every keystroke, so blur cannot read it back.
  const binaryBaseline = useRef<{ shown: string; stored: string }>({ shown: '', stored: '' });
  const revealTarget = useContext(RevealContext).target;
  // A Settings-search jump to a control inside this collapsed row opens it first.
  useEffect(() => {
    const prefix = harnessRowPrefix(h.family);
    if (revealTarget?.startsWith(prefix) && revealTarget !== prefix + 'enabled' && revealTarget !== prefix + 'row') setOpen(true);
  }, [revealTarget, h.family]);
  const enableKey = ENABLE_KEY[h.family];
  const binKey = BINARY_KEY[h.family];
  // Prefer the live config value over the async probe snapshot (`h.enabled`):
  // toggling flips `config` immediately via `onUpdate`, but `harnessStatus` only
  // refreshes on a manual re-check or tab remount, so binding to `h.enabled`
  // would make the switch appear to snap back until that next probe.
  const enabled = enableKey ? ((config[enableKey] as boolean | undefined) ?? h.enabled) : h.enabled;
  const shown = h.alwaysEnabled || enabled;

  // The server reports the 'claude' default for an unset Claude binary; show that
  // as an empty field (placeholder) so a cleared field stays visibly cleared.
  const storedBinary = (config[binKey] as string | undefined) ?? '';
  const shownBinary = h.family === 'claude' && storedBinary === BINARY_PLACEHOLDER.claude ? '' : storedBinary;
  const binaryField = (
    <Field
      searchId={`${harnessRowPrefix(h.family)}binary`}
      label={`${h.label} binary`}
      help={`Leave blank to use ${BINARY_PLACEHOLDER[h.family]} from your PATH. Set a command or full path to use another installation.`}
      mono
    >
      <input
        type="text"
        value={binaryDraft ?? shownBinary}
        placeholder={BINARY_PLACEHOLDER[h.family]}
        onChange={(e) => {
          if (binaryDraft === null) binaryBaseline.current = { shown: shownBinary, stored: storedBinary };
          setBinaryDraft(e.target.value);
          onConfigDraft({ ...config, [binKey]: e.target.value });
        }}
        onBlur={(e) => {
          // Untouched field: nothing to save.
          if (binaryDraft === null) return;
          setBinaryDraft(null);
          const next = e.target.value.trim();
          const { shown, stored } = binaryBaseline.current;
          if (next === shown.trim()) {
            // Edited back to what was there: drop the draft instead of writing config.
            onConfigDraft({ ...config, [binKey]: stored });
            return;
          }
          // '' (not undefined) so the PATCH body carries the clear.
          onUpdate({ [binKey]: next });
        }}
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
    <Field searchId={`${harnessRowPrefix(h.family)}default-provider`} label="Default Provider" layout="row" help={providerRelationship === 'fixed-provider'
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
    <Field searchId={`${harnessRowPrefix(h.family)}default-model-level`} label="Default Model Level" layout="row" help="Choose a model for new CLI agents. Levels in brackets match Persona and Agent model settings.">
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
    <Field searchId={`${harnessRowPrefix(h.family)}default-execution-state`} label="Default Execution State" layout="row" help="Choose how new CLI agents plan, edit files, and ask for approval.">
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
    <div className="harness-cli-detail">
      <div className="harness-cli-status">
        <strong>CLI agent</strong>
        {login && <span className="opener-row-status-stack"><LoginBadge login={login} /></span>}
        {cliAction ? (
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

        {enableKey ? (
            <ToggleSwitch
              searchId={`${harnessRowPrefix(h.family)}enabled`}
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
          )}
      </div>
      {cliError ? (
        <p className="machine-cli-row-error" role="alert" data-testid={`harness-cli-error-${h.family}`}>
          {cliError}
        </p>
      ) : cliLog ? (
        <p className="machine-cli-row-progress" data-testid={`harness-cli-progress-${h.family}`}>
          {cliLog}
        </p>
      ) : cliHint ? (
        <ProviderCliUpdateHint
          reason={cliHint}
          testId={`harness-cli-hint-${h.family}`}
        />
      ) : null}

      <button type="button" className="harness-cli-disclosure" aria-label={`Advanced settings for ${h.label}`}
        aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <ChevronRight size={14} aria-hidden /> CLI launch settings
      </button>
      {open && loadingOptions && <Skeleton width="100%" height="48px" />}
      {open && !loadingOptions ? (
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
          <HarnessModelTiers family={h.family} label={h.label} descriptor={descriptor} config={config} onUpdate={onUpdate} />
          {advanced}
          {h.family === 'opencode' ? (
            <HarnessOptionsGroup title="Project agents">
              <Field
                searchId="harness.opencode.discover-agents"
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

export function HarnessView({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>, options?: { throwOnError?: boolean }) => Promise<void>;
}) {
  const status = useData((s) => s.harnessStatus);
  const refresh = useData((s) => s.refreshHarnessStatus);
  // Track the in-flight probe so the button can show it's actively re-checking —
  // the row list stays populated during a re-check (each probe runs `--version`).
  const [checking, setChecking] = useState(false);
  const [descriptors, setDescriptors] = useState<HarnessAdapterDescriptor[] | null>(null);
  const hosts = useHosts();
  const thisMachine = primaryHost(hosts);
  const thisMachineId = thisMachine?.status === 'connected' ? thisMachine.id : undefined;
  const [cliStatus, setCliStatus] = useState<ProviderCliStatusResponse>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [installLogs, setInstallLogs] = useState<Record<string, string>>({});

  const runCheck = (refreshModels = true) => {
    setChecking(true);
    Promise.resolve(refresh({ refreshModels })).finally(() => setChecking(false));
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

  // Reuse the boot probe until the user requests a fresh status check.
  useEffect(() => {
    if (status.length === 0) runCheck(false);
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
      .then((next) => { if (!cancelled) { setDescriptors(next); rememberHarnessDescriptors(next); } })
      .catch((error) => {
        console.warn('[settings] loading harness descriptors failed; launch-default rows are hidden', error);
        if (!cancelled) setDescriptors([]);
      });
    return () => { cancelled = true; };
  }, []);

  const claudeAdvanced = (
    <>
      <HarnessOptionsGroup title="Instructions" help="Add guidance for every Claude Code CLI agent.">
        <Field
          searchId="harness.claude.append-system-prompt"
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
          searchId="harness.claude.extra-args"
          label="Extra args"
          help={precedenceHelp('extraArgs')}
          values={config.claudeExtraArgs ?? []}
          placeholder="--plugin-dir /path/to/plugin"
          onChange={(values) => void onUpdate({ claudeExtraArgs: values.length ? values : undefined })}
        />
      </HarnessOptionsGroup>
      <HarnessOptionsGroup title="Tools & access" help="Directories and tool rules combine with your Project, Persona, and Agent settings.">
        <ChipField
          searchId="harness.claude.add-dirs"
          label="Add dirs"
          help="Combined: directories from Global, Project, Persona, and Agent settings are all included."
          values={config.claudeAddDirs ?? []}
          placeholder="/path/to/dir"
          onChange={(values) => void onUpdate({ claudeAddDirs: values.length ? values : undefined })}
        />
        <ChipField
          searchId="harness.claude.allowed-tools"
          label="Allowed tools"
          help="Combined and deduplicated across Global, Project, Persona, and Agent settings."
          values={config.claudeAllowedTools ?? []}
          placeholder="Bash(git:*)"
          onChange={(values) => void onUpdate({ claudeAllowedTools: values.length ? values : undefined })}
        />
        <ChipField
          searchId="harness.claude.denied-tools"
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
        searchId="harness.pi.provider"
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
        searchId="harness.pi.model"
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
        searchId="harness.pi.thinking"
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
        searchId="harness.codex.sandbox"
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
        searchId="harness.codex.approval"
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
  const defaultHarnessOptions = sortHarnessDisplayRows(
    (descriptors ?? []).filter((descriptor) => descriptor.agentDefaultEligible),
    (descriptor) => descriptor.label,
    (descriptor) => descriptor.id
  );
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

  function renderCliSettings(h: HarnessVerifyResult, modelCatalog: ThreadModelCatalogSnapshot) {
    const descriptor = descriptorsById.get(h.family);
    const ids = descriptor?.settingsContributionIds ?? (descriptors === null && (h.family === 'claude' || h.family === 'pi') ? [`${h.family}-global-defaults`] : []);
    const advanced = ids.map(id => contributionNodes[id]).filter(Boolean);
    const provider = providerCliKeyForFamily(h.family);
    const row = provider
      ? orderedProviderCliRows(cliStatus).find((entry) => entry.provider === provider)
      : undefined;
    const key = thisMachineId && provider ? `${thisMachineId}:${provider}` : null;
    return (
      <HarnessCliSettings
        key={h.family}
        h={h}
        config={config}
        onConfigDraft={onConfigDraft}
        onUpdate={onUpdate}
        descriptor={descriptor}
        advanced={advanced}
        loadingOptions={descriptors === null && hasDesktopBridge() && typeof product.harness.descriptors === 'function'}
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
  }

  return (
    <div className="harness-settings">
    <RegisteredHarnesses config={config} status={status} hostId={thisMachineId} hostName={thisMachine?.name} onUpdate={onUpdate} onRefreshStatus={() => { runCheck(false); void refreshCliStatus(); }}
      renderCliSettings={renderCliSettings} machineSummary={checking ? 'Checking installation and sign-in…' : health.message}
      machineActions={actionable.length > 0 && (
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
      )}
      machinesLink={<a href={getSettingsRoutePath('machines')} data-testid="harness-machines-link">Manage machines</a>} checkingStatus={checking} cliDefault={<>
        <div className="harness-default-card">
          <Field
            searchId="harness.default-harness"
            label="Default for CLI agents"
            layout="row"
            help="Used when a new CLI agent has no explicit harness or pinned Persona."
          >
            {descriptors === null ? (
              <Skeleton width="180px" height="28px" />
            ) : (
              <PopoverPicklist
                value={config.defaultHarness ?? 'claude'}
                ariaLabel="Default for CLI agents"
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
    </>} />
    <Section searchId="harness.model-lists" anchorId="harness-models" title="Model lists" flush>
      <ModelRefreshControl />
    </Section>

    <MachineEnvironmentSettings />
    <RemoteMachineDefaultsList />
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
