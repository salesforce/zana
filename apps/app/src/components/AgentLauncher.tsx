import { product } from '../lib/product-client.js';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  Terminal as TerminalIcon,
  Bot,
  GitBranch,
  ListChecks,
  Inbox,
  FlaskConical,
  Sparkles,
  Zap,
  Folder,
  Star,
  ChevronRight,
  ChevronDown,
  Blocks,
  UserCog,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Boxes,
  type LucideIcon
} from 'lucide-react';
import type {
  AgentPresetView,
  ExtensionEntry,
  HarnessFamily,
  HarnessModelRoutingV1,
  LaunchProfileId,
  Persona,
  Project,
  QuickPrompt,
  TerminalSession,
  WorkflowArgument
} from '@zana-ai/zcc-domain/product';
import type { SpawnEnvironmentChoice } from '@zana-ai/zcc-domain';
import { EnvironmentPicker, defaultWorkspaceChoice, type WorkspacePickerValue } from './EnvironmentPicker.js';
import { executionMappingOptions } from '@zana-ai/zcc-domain/harness-adapter';
import type {
  HarnessAdapterDescriptor,
  HarnessAgentDiscoveryResult,
  HarnessRoleTarget,
} from '@zana-ai/zcc-domain/harness-adapter';
import {
  buildInterviewPrompt,
  hasArguments,
  parseArgumentNames,
  resolveArguments,
  substituteArguments
} from '@zana-ai/zcc-domain/workflow-args';
import {
  profileLabel,
  VALID_PROFILES,
  isCursorProfile,
  isCodexProfile,
  isPiProfile,
  isOpenCodeProfile,
  providerUiSchema,
} from '@zana-ai/zcc-domain/launch-provider';
import { useData, useUi, usePersonas, useTeams, sortProjectsAlphabetically } from '../store.js';
import { profileIcon, personaIcon } from '../lib/profileIcon.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { AutonomousTeamComposer } from './AutonomousTeamComposer.js';
import { ThreadCommandComposer } from './ThreadCommandComposer.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';
import { LaunchModeSegmented, type LaunchMode } from './LaunchModeSegmented.js';
import { TextArgsField } from './settings/FormFields.js';
import { AgentConversationHistory } from './AgentConversationHistory.js';
import { titleFromPrompt } from '../lib/promptTitle.js';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap.js';
import { effectivePersonaRouting } from '../lib/personaRouting.js';
import { HarnessOptionSelect } from './HarnessOptionSelect.js';
import { LauncherModelPicker } from './LauncherModelPicker.js';
import { PopoverPicklist } from './ui/PopoverPicklist.js';
import { buildFixWithAiPrompt } from '../lib/fixWithAiPrompt.js';
import { posixQuote } from '../lib/quote.js';
import { appendAttachmentContext, attachmentName, mergeAttachmentPaths } from '../lib/attachments.js';

/**
 * A framework preset offered in Advanced view: an installed extension that
 * declares an `agentPreset` in its manifest. The launcher only carries the
 * extension `id` + the display fields; picking one adds its id to `frameworkIds`,
 * which rebuilds the primer from its OWN copy of the manifest and injects it via
 * the persona `--append-system-prompt` path (Rule 1 / Rule 6 — core never
 * hard-codes a framework, and never trusts renderer-supplied primer text).
 */
export interface FrameworkOption {
  id: string;
  title: string;
  preset: AgentPresetView;
}

/** Extract the framework presets from a list of installed extension entries.
 *  An entry contributes at most one; only enabled+consented extensions with a
 *  well-formed `agentPreset` (discovery already dropped primer-less blocks). */
export function frameworkOptionsFrom(entries: ExtensionEntry[]): FrameworkOption[] {
  return entries
    .filter((e) => e.enabled && e.manifest?.agentPreset?.systemPrompt)
    .map((e) => ({
      id: e.id,
      title: e.manifest!.title,
      preset: e.manifest!.agentPreset!
    }))
    .sort((a, b) => (a.preset.label ?? a.title).localeCompare(b.preset.label ?? b.title));
}

export function isWorktreeEligible(target: Project | null, scratchIsTarget: boolean): boolean {
  return !!target && !scratchIsTarget && !target.remote && !target.quickAgent;
}

export function worktreeForSubmission(
  applyAdvanced: boolean,
  worktree: boolean,
  eligible: boolean,
  name: string
): { branch: string } | undefined {
  return applyAdvanced && worktree && eligible && name ? { branch: name } : undefined;
}

export function workspaceForSubmission(
  applyAdvanced: boolean,
  choice: WorkspacePickerValue,
  eligible: boolean,
  name: string
): SpawnEnvironmentChoice {
  if (choice.kind === 'reuse') return choice;
  if (choice.kind === 'personal') return choice;
  if (!applyAdvanced) return { kind: 'unmanaged' };
  if (choice.kind === 'worktree' && eligible) {
    return choice.baseBranch
      ? { kind: 'worktree', branchSlug: name || undefined, baseBranch: choice.baseBranch }
      : { kind: 'worktree', branchSlug: name || undefined };
  }
  return { kind: 'unmanaged' };
}

export function normalizeWorktreeName(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
}

export function normalizeWorktreeNameInput(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/g, '')
    .slice(0, 40);
}

export function resolveWorktreeDefault(
  projectDefault: boolean | undefined,
  globalDefault: boolean
): boolean {
  return typeof projectDefault === 'boolean' ? projectDefault : globalDefault;
}

/**
 * The one agent launcher. The user types an instruction, picks a Claude profile
 * (claude / claude --yolo) and an optional persona or framework primer, then
 * launches an agent seeded with that first prompt. It renders in two modes from
 * a SINGLE component so the two surfaces can't drift (this used to be two
 * siblings — `QuickAgentLauncher` and `LaunchPanel`):
 *
 *   - **Scratch / global mode** (`project` omitted): a one-off Quick Agent
 *     anchored to the built-in `~/zcc-workspace` scratch project. Adds a project
 *     picker (so the global board's "+" can start an agent in ANY project),
 *     editable starter-prompt chips, and scratch subfolder isolation. Opened
 *     from the Agents view / global board.
 *   - **Project mode** (`project` set): pinned to one registered project — no
 *     picker, no chips. Instead surfaces the project-only affordances: a
 *     resumable-conversations list, a background-session tray, and a
 *     default-persona star. Opened from a project's Agents board "New agent".
 *
 * Agent-only by design: shell launches live in the Terminals view (the TabBar
 * "+" spawns a shell directly), so "New agent" never offers a non-agent option.
 */

/**
 * The launcher picks a harness FAMILY (claude/cursor/codex/pi), and a SEPARATE
 * Normal/Yolo toggle decides which concrete profile of that family launches. So
 * "Yolo" is one control that applies to whichever harness is selected, rather
 * than a per-harness picker entry — selecting Yolo launches the family's
 * permission-bypass variant (`claude --dangerously-skip-permissions`,
 * `cursor --force`, `codex --dangerously-bypass-approvals-and-sandbox`).
 */
type LauncherFamily = 'claude' | 'cursor' | 'codex' | 'pi' | 'opencode';
type LauncherRouting = NonNullable<HarnessModelRoutingV1['byAdapter'][HarnessFamily]>;

export function agentRoutingForSubmission(
  profileChosen: boolean,
  familyId: HarnessFamily,
  portableRouting: LauncherRouting,
  nativeRouting: Partial<Record<HarnessFamily, LauncherRouting>>,
  agentRoutingDirty: boolean
): HarnessModelRoutingV1 | undefined {
  if (!agentRoutingDirty) return undefined;
  const routing = profileChosen ? nativeRouting[familyId] : portableRouting;
  return routing && Object.keys(routing).length
    ? { schemaVersion: 1, byAdapter: { [familyId]: routing } }
    : undefined;
}

export function selectedAvailableFamily<T extends { id: LauncherFamily }>(
  families: readonly T[],
  requestedId: LauncherFamily
): T | undefined {
  return families.find((family) => family.id === requestedId);
}

/** Installed CLIs appear automatically; an explicit Settings hide still wins. */
export function optionalHarnessOffered(
  status: { enabled: boolean; installed: boolean } | undefined,
  configEnabled: boolean
): boolean {
  if (status) return status.enabled && status.installed;
  return configEnabled;
}

export function launchStatusAccessibility(hasStatus: boolean) {
  return {
    status: {
      id: 'agent-launch-status',
      role: 'alert' as const,
      'aria-live': 'assertive' as const,
      'aria-atomic': true
    },
    describedBy: hasStatus ? 'agent-launch-status' : undefined
  };
}

const PORTABLE_MODEL_LEVELS = [
  { id: 'low', label: 'Low (speed/cost sensitive)' },
  { id: 'medium', label: 'Medium (balanced normal)' },
  { id: 'high', label: 'High (frontier reasoning)' },
  { id: 'extra-high', label: 'Extra-high (deep reasoning)' }
] as const;
const PORTABLE_EXECUTION_STATES = [
  { id: 'plan', label: 'Plan (planning only)' },
  { id: 'interactive', label: 'Interactive (human-in-loop)' },
  { id: 'accept-edits', label: 'Accept Edits (auto-approve edits)' },
  { id: 'autonomous', label: 'Autonomous (fully auto)' }
] as const;

type OpenCodeAgentDiscoveryState = HarnessAgentDiscoveryResult | { status: 'loading' };
type OpenCodeAgentDiscoverySnapshot = {
  projectId: string;
  profile: LaunchProfileId;
  discovery: OpenCodeAgentDiscoveryState;
};

export function discoveryForOpenCodePicker(
  projectId: string | undefined,
  profile: LaunchProfileId | undefined,
  snapshot: OpenCodeAgentDiscoverySnapshot | null
): OpenCodeAgentDiscoveryState {
  if (!projectId || !profile) return { status: 'failure' };
  return snapshot?.projectId === projectId && snapshot.profile === profile
    ? snapshot.discovery
    : { status: 'loading' };
}

export function resolveOpenCodeRoleOptions(
  staticRoles: readonly HarnessRoleTarget[],
  discovery: HarnessAgentDiscoveryResult
): readonly HarnessRoleTarget[] {
  if (discovery.status === 'failure') return [];
  const knownRoles = new Map(staticRoles.map((role) => [role.id, role]));
  return discovery.descriptors
    .filter(({ directLaunchAllowed }) => directLaunchAllowed)
    .map(({ id, label }) => {
      const known = knownRoles.get(id);
      const stateLabel = known?.executionStates?.map(portableLabel).join(', ');
      return { id, label: stateLabel ? `${label} [${stateLabel}]` : label, scope: ['local'] };
    });
}

export function reconcileOpenCodeRole(
  selectedRole: string | undefined,
  discovery: HarnessAgentDiscoveryResult
): string | undefined {
  if (!selectedRole || discovery.status === 'failure') return selectedRole;
  return discovery.descriptors.some(({ id, directLaunchAllowed }) => id === selectedRole && directLaunchAllowed)
    ? selectedRole
    : undefined;
}

export function roleTargetValueForPicker(
  selectedRole: string | undefined,
  roles: readonly HarnessRoleTarget[]
): string {
  return selectedRole && roles.some(({ id }) => id === selectedRole) ? selectedRole : '';
}

function portableLabel(value: string): string {
  return value.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** Project Persona routing into per-Agent controls without carrying legacy-only fields. */
export function launcherRoutingFromPersona(persona: Persona): Partial<Record<HarnessFamily, LauncherRouting>> {
  const effective = effectivePersonaRouting(persona);
  return Object.fromEntries(Object.entries(effective).flatMap(([family, routing]) => {
    const compatibility = routing.compatibility
      ? Object.fromEntries([
          ['codexSandbox', routing.compatibility.codexSandbox],
          ['codexApproval', routing.compatibility.codexApproval]
        ].filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : undefined;
    const projected = Object.fromEntries([
      ['providerTargetId', routing.providerTargetId],
      ['roleTargetId', routing.roleTargetId],
      ['modelTargetId', routing.modelTargetId],
      ['executionState', routing.executionState],
      ['compatibility', compatibility && Object.keys(compatibility).length ? compatibility : undefined]
    ].filter((entry) => entry[1] !== undefined)) as LauncherRouting;
    return Object.keys(projected).length ? [[family, projected]] : [];
  })) as Partial<Record<HarnessFamily, LauncherRouting>>;
}

function NativeAgentRoutingFields({
  descriptor,
  routing,
  agentDiscovery,
  onRefreshAgentDescriptors,
  onChange
}: {
  descriptor: HarnessAdapterDescriptor;
  routing: LauncherRouting;
  agentDiscovery: OpenCodeAgentDiscoveryState;
  onRefreshAgentDescriptors: () => void;
  onChange: (patch: Partial<LauncherRouting>) => void;
}) {
  const targets = descriptor.targets;
  const relationship = targets?.providerModelRelationship;
  const inferredProvider = routing.modelTargetId
    ? targets?.models.find((target) => target.id === routing.modelTargetId)?.provider
    : undefined;
  const selectedProvider = routing.providerTargetId
    ?? inferredProvider
    ?? (relationship === 'fixed-provider' ? targets?.providers?.[0]?.id : '');
  const visibleModels = selectedProvider && relationship !== 'fixed-provider'
    ? (targets?.models ?? []).filter((target) => !target.provider || target.provider === selectedProvider)
    : targets?.models ?? [];
  const unavailable = !descriptor.availability.enabled || !descriptor.availability.installed;
  const codexUi = providerUiSchema('codex');
  const dynamicAgentsActive = descriptor.id === 'opencode';
  const agentDescriptorsLoading = agentDiscovery.status === 'loading';
  const agentDescriptorsFailed = agentDiscovery.status === 'failure';
  const roleOptions = agentDiscovery.status === 'loading'
    ? []
    : resolveOpenCodeRoleOptions(targets?.roles ?? [], agentDiscovery);
  const visibleRoleTargetId = roleTargetValueForPicker(
    routing.roleTargetId,
    dynamicAgentsActive ? roleOptions : targets?.roles ?? []
  );

  return (
    <>
      {!!targets?.roles.length && (
        <div className="launch-row launch-native-field--role">
          <label className="launch-row-label" htmlFor="launch-role-target">
            {dynamicAgentsActive ? 'Effective OpenCode agent' : 'Native role'}
          </label>
          {dynamicAgentsActive ? (
            <div className="launch-opencode-role-control">
              <select
                id="launch-role-target"
                className="launch-folder-select"
                value={visibleRoleTargetId}
                disabled={unavailable || agentDescriptorsLoading || agentDescriptorsFailed}
                onChange={(event) => onChange({ roleTargetId: event.target.value || undefined })}
              >
                <option value="">
                  {agentDescriptorsLoading ? 'Loading agents…' : 'Use harness default'}
                </option>
                {roleOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
              </select>
              <button
                type="button"
                className="launch-advanced-toggle"
                onClick={onRefreshAgentDescriptors}
                disabled={unavailable || agentDescriptorsLoading}
                aria-label="Refresh agents"
                title="Refresh agents"
              >
                {agentDescriptorsLoading ? '…' : '↻'}
              </button>
            </div>
          ) : (
            <>
              <input
                id="launch-role-target"
                className="launch-folder-select"
                list={`launch-role-targets-${descriptor.id}`}
                value={visibleRoleTargetId}
                disabled={unavailable}
                onChange={(event) => onChange({ roleTargetId: event.target.value || undefined })}
                placeholder="Use harness default"
              />
              <datalist id={`launch-role-targets-${descriptor.id}`}>
                {targets.roles.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
              </datalist>
            </>
          )}
        </div>
      )}
      {!!targets?.models.length && (
        <div className="launch-row launch-native-field--model">
          <label className="launch-row-label" htmlFor="launch-model-target">Model</label>
          <LauncherModelPicker
            id="launch-model-target"
            models={visibleModels}
            value={routing.modelTargetId ?? ''}
            disabled={unavailable}
            onChange={(value) => onChange({ modelTargetId: value || undefined })}
          />
        </div>
      )}
      {targets?.executionStateMapping && descriptor.id !== 'codex' && descriptor.id !== 'opencode' && (
        <div className="launch-row launch-native-field--execution">
          <label className="launch-row-label" htmlFor="launch-native-execution">Execution State</label>
          <PopoverPicklist
            id="launch-native-execution"
            className="launch-folder-select"
            value={routing.executionState ?? ''}
            disabled={unavailable}
            ariaLabel="Execution state"
            searchable={false}
            onChange={(executionState) => onChange({
              executionState: (executionState || undefined) as LauncherRouting['executionState']
            })}
            options={[
              { value: '', label: 'Use project/global default' },
              ...executionMappingOptions(targets.executionStateMapping).map(({ id, native, states }) => ({
                value: id,
                label: `${native} [${states.map(portableLabel).join(', ')}]`
              }))
            ]}
          />
        </div>
      )}
      {!!targets?.providers?.length && (
        <div className="launch-row launch-native-field--provider">
          <label className="launch-row-label" htmlFor="launch-provider-target">Provider</label>
          <PopoverPicklist
            id="launch-provider-target"
            className="launch-folder-select"
            value={selectedProvider ?? ''}
            disabled={relationship === 'fixed-provider' || unavailable}
            ariaLabel="Provider"
            searchable={false}
            onChange={(providerId) => {
              const providerTargetId = providerId || undefined;
              const currentModel = targets.models.find((target) => target.id === routing.modelTargetId);
              onChange({
                providerTargetId,
                ...(!providerTargetId || (currentModel && currentModel.provider !== providerTargetId)
                  ? { modelTargetId: undefined }
                  : {})
              });
            }}
            options={[
              ...(relationship !== 'fixed-provider' ? [{ value: '', label: 'Use project/global default' }] : []),
              ...targets.providers.map((provider) => ({ value: provider.id, label: provider.label }))
            ]}
          />
        </div>
      )}
      {descriptor.id === 'codex' && (
        <>
          <div className="launch-row launch-native-field--sandbox">
            <label className="launch-row-label" htmlFor="launch-codex-sandbox">Sandbox Policy</label>
            <HarnessOptionSelect
              id="launch-codex-sandbox"
              options={codexUi.sandboxes}
              value={routing.compatibility?.codexSandbox ?? ''}
              onChange={(value) => onChange({
                compatibility: { ...routing.compatibility, codexSandbox: value || undefined }
              })}
               sentinel={{ id: '', label: 'Use project/global default' }}
               dropDefaultId
               disabled={unavailable}
               className="launch-folder-select"
            />
          </div>
          <div className="launch-row launch-native-field--approval">
            <label className="launch-row-label" htmlFor="launch-codex-approval">Approval Policy</label>
            <HarnessOptionSelect
              id="launch-codex-approval"
              options={codexUi.approvals}
              value={routing.compatibility?.codexApproval ?? ''}
              onChange={(value) => onChange({
                compatibility: { ...routing.compatibility, codexApproval: value || undefined }
              })}
               sentinel={{ id: '', label: 'Use project/global default' }}
               dropDefaultId
               disabled={unavailable}
               className="launch-folder-select"
            />
          </div>
        </>
      )}
    </>
  );
}

interface FamilyDescriptor {
  id: LauncherFamily;
  label: string;
  /** The Normal launch profile for this family. */
  base: LaunchProfileId;
  /**
   * The Yolo (permission-bypass) launch profile, or `null` when the family's CLI
   * exposes NO documented bypass flag (PI — only `--approve` for trusting project
   * files, not a permission bypass). A null-yolo family disables the Yolo toggle.
   */
  yolo: LaunchProfileId | null;
}

const FAMILIES: FamilyDescriptor[] = [
  { id: 'claude', label: 'claude', base: 'claude', yolo: 'claude-yolo' },
  { id: 'cursor', label: 'cursor', base: 'cursor', yolo: 'cursor-yolo' },
  { id: 'codex', label: 'codex', base: 'codex', yolo: 'codex-yolo' },
  { id: 'pi', label: 'pi', base: 'pi', yolo: null },
  // OpenCode's `--auto` is a permission bypass, but v1 ships the base profile only
  // (parity with the pi posture — the resume/yolo variants can follow). No yolo
  // profile is registered, so the toggle is disabled for this family.
  { id: 'opencode', label: 'opencode', base: 'opencode', yolo: null }
];

/** Map a concrete profile id back to its (family, yolo) selection — used to seed
 *  the picker + toggle from a preset/framework `baseProfile`. Null if unknown. */
function familySelectionOf(
  profile: LaunchProfileId
): { family: LauncherFamily; yolo: boolean } | null {
  for (const f of FAMILIES) {
    if (f.base === profile) return { family: f.id, yolo: false };
    if (f.yolo === profile) return { family: f.id, yolo: true };
  }
  return null;
}

/** Whitelist of lucide icons honored in quick-prompt metadata. A miss (absent
 *  or unknown name) falls back to a generic Sparkles, so a typo in a hand-edited
 *  prompt file never crashes the renderer. Mirrors the persona/template lists. */
const PROMPT_ICONS: Record<string, LucideIcon> = {
  GitBranch,
  ListChecks,
  Inbox,
  FlaskConical,
  Sparkles,
  Zap,
  Bot
};

function promptIcon(name: string | undefined, size = 13) {
  const Named = name ? PROMPT_ICONS[name] : undefined;
  const Icon = Named ?? Sparkles;
  return <Icon size={size} />;
}

/**
 * Build raw prompt intent and title for a launch. Main converts `prompt` to
 * provider argv after it resolves the effective profile, keeping this renderer
 * request advisory and preserving prompt text for spawn-time features.
 */
export function buildLaunchArgs(
  rawPrompt: string,
  fallbackTitle: string
): { prompt?: string; title?: string } {
  const body = rawPrompt.trim();
  const title = body ? titleFromPrompt(body) : fallbackTitle;
  return {
    prompt: body || undefined,
    title: title || undefined
  };
}

/**
 * Per-argument fill form shown when a parametrized QuickPrompt (`{{arg}}` slots)
 * is applied. The template is the source of truth for which fields to show
 * (`resolveArguments`), so a chip with placeholders but no declared `arguments`
 * still yields free-text fields. Enter in a text field commits the form.
 */
function WorkflowArgForm({
  preset,
  values,
  onChange,
  onApply,
  onInterview,
  onCancel
}: {
  preset: QuickPrompt;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onApply: () => void;
  onInterview: () => void;
  onCancel: () => void;
}) {
  const args: WorkflowArgument[] = resolveArguments(preset.prompt, preset.arguments);
  const preview = substituteArguments(preset.prompt, values, preset.arguments);
  return (
    <div className="workflow-arg-form" role="group" aria-label={`Fill ${preset.label}`}>
      <div className="workflow-arg-form-head">
        {promptIcon(preset.icon)}
        <span className="workflow-arg-form-title">{preset.label}</span>
      </div>
      {args.map((a) => {
        const id = `wf-arg-${a.name}`;
        const val = values[a.name] ?? '';
        return (
          <div key={a.name} className="workflow-arg-field">
            <label htmlFor={id}>{a.name}</label>
            {a.type === 'enum' && a.enumValues && a.enumValues.length > 0 ? (
              <PopoverPicklist
                id={id}
                value={val}
                ariaLabel={a.name}
                searchable={false}
                onChange={(nextValue) => onChange(a.name, nextValue)}
                options={a.enumValues.map((enumValue) => ({ value: enumValue, label: enumValue }))}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={val}
                placeholder={a.description ?? a.defaultValue ?? ''}
                autoFocus={a === args[0]}
                onChange={(e) => onChange(a.name, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onApply();
                  }
                }}
              />
            )}
            {a.description && <span className="workflow-arg-help">{a.description}</span>}
          </div>
        );
      })}
      <pre className="workflow-arg-preview" aria-label="Preview">
        {preview}
      </pre>
      <div className="workflow-arg-actions">
        <button type="button" className="settings-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="settings-btn"
          onClick={onInterview}
          title="Skip the form — hand the agent the template + choices and let it ask you for each value in the terminal"
        >
          Let the agent ask
        </button>
        <button type="button" className="settings-btn primary" onClick={onApply}>
          Use prompt
        </button>
      </div>
    </div>
  );
}

/** Slugify a label into a stable user-prompt id (`user:my-prompt`). Only used to
 *  mint an id for a brand-new prompt — editing keeps the existing id. */
function slugifyId(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `user:${slug || 'prompt'}`;
}

/**
 * In-app editor for a quick prompt (create / edit / reset). The template body is
 * the source of truth for which `{{arg}}` slots exist — the per-argument metadata
 * section is derived live from `parseArgumentNames(prompt)`, so the author fills
 * in type/description/default for exactly the slots they typed, and can't declare
 * a phantom argument. Saving round-trips through `product.quickPrompts.save`,
 * where main re-validates and re-sanitizes (Rule 1). A builtin is edited by
 * saving a user file that shadows its id; "Reset" deletes that user file.
 */
function QuickPromptEditor({
  initial,
  onSaved,
  onCancel
}: {
  /** The prompt being edited, or null for a fresh create. */
  initial: QuickPrompt | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const isBuiltin = initial?.source === 'builtin';
  const [label, setLabel] = useState(initial?.label ?? '');
  const [body, setBody] = useState(initial?.prompt ?? '');
  const [profile, setProfile] = useState<LaunchProfileId>(initial?.profile ?? 'claude');
  // Per-argument metadata keyed by slot name, seeded from the initial prompt's
  // declarations. Only the slots present in `body` are shown/saved.
  const [argMeta, setArgMeta] = useState<Record<string, WorkflowArgument>>(() => {
    const seed: Record<string, WorkflowArgument> = {};
    for (const a of initial?.arguments ?? []) seed[a.name] = a;
    return seed;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useUi((s) => s.pushToast);
  const harnessCursorEnabled = useData((s) => s.harnessCursorEnabled);
  const harnessCodexEnabled = useData((s) => s.harnessCodexEnabled);
  const harnessPiEnabled = useData((s) => s.harnessPiEnabled);
  const harnessOpenCodeEnabled = useData((s) => s.harnessOpenCodeEnabled);
  const harnessStatus = useData((s) => s.harnessStatus);

  // Every launch profile is a valid quick-prompt target (the prompt rides argv,
  // which all profiles accept), so the picker offers the whole set from the
  // shared source of truth instead of a hand-kept claude/shell subset — cursor/
  // codex/pi/opencode follow the same installed-auto-on rule as the main
  // launcher. A resume variant isn't a "start a new prompt" identity, so drop
  // those two.
  const promptProfiles = useMemo(() => {
    const statusFor = (family: HarnessFamily) => harnessStatus.find((row) => row.family === family);
    const list = VALID_PROFILES.filter((p) => !p.endsWith('-resume')).filter((p) => {
      if (isCursorProfile(p)) return optionalHarnessOffered(statusFor('cursor'), harnessCursorEnabled);
      if (isCodexProfile(p)) return optionalHarnessOffered(statusFor('codex'), harnessCodexEnabled);
      if (isPiProfile(p)) return optionalHarnessOffered(statusFor('pi'), harnessPiEnabled);
      if (isOpenCodeProfile(p)) return optionalHarnessOffered(statusFor('opencode'), harnessOpenCodeEnabled);
      return true;
    });
    // Keep an already-saved profile selectable even if it's now filtered out (a
    // disabled harness, or a legacy `-resume` prompt) — else the select blanks.
    return list.includes(profile) ? list : [profile, ...list];
  }, [harnessCursorEnabled, harnessCodexEnabled, harnessPiEnabled, harnessOpenCodeEnabled, harnessStatus, profile]);

  // Slots the template actually references — the source of truth for the args
  // section. Recomputed as the body is edited.
  const slotNames = useMemo(() => parseArgumentNames(body), [body]);

  const setMeta = (name: string, patch: Partial<WorkflowArgument>) =>
    setArgMeta((prev) => ({ ...prev, [name]: { ...(prev[name] ?? { name }), name, ...patch } }));

  const save = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError('A label is required.');
      return;
    }
    if (!body.trim()) {
      setError('Prompt text is required.');
      return;
    }
    // Emit only the metadata for slots still present in the template — an arg
    // whose placeholder was deleted shouldn't linger (main drops it anyway, but
    // keep the payload honest). A slot with no meaningful metadata is omitted so
    // it stays a bare free-text field.
    const args: WorkflowArgument[] = slotNames
      .map((name) => argMeta[name] ?? { name })
      .filter((a) => a.type === 'enum' || a.description || a.defaultValue);
    const entry: QuickPrompt = {
      id: isEdit ? initial!.id : slugifyId(trimmedLabel),
      label: trimmedLabel,
      prompt: body,
      profile,
      ...(initial?.icon ? { icon: initial.icon } : {}),
      ...(args.length ? { arguments: args } : {})
    };
    setBusy(true);
    setError(null);
    try {
      await product.quickPrompts.save(entry);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Reset = delete the user file for this id. For a shadowed builtin this restores
  // the shipped default; for a purely-user prompt it removes it entirely.
  const reset = async () => {
    if (!initial) return;
    setBusy(true);
    setError(null);
    try {
      await product.quickPrompts.delete(initial.id);
      pushToast(
        isBuiltin ? `Reset "${initial.label}" to default` : `Deleted "${initial.label}"`,
        'info'
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quick-prompt-editor" role="group" aria-label={isEdit ? 'Edit quick prompt' : 'New quick prompt'}>
      <div className="workflow-arg-field">
        <label htmlFor="qpe-label">Label</label>
        <input
          id="qpe-label"
          type="text"
          value={label}
          autoFocus
          placeholder="Short chip label"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div className="workflow-arg-field">
        <label htmlFor="qpe-body">Prompt</label>
        <textarea
          id="qpe-body"
          className="quick-prompt-editor-body"
          value={body}
          rows={4}
          placeholder="Run tests for {{package}} and summarize failures."
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="workflow-arg-help">
          Use <code>{'{{name}}'}</code> for a fill-in slot; <code>{'{{{literal}}}'}</code> escapes to
          literal braces.
        </span>
      </div>

      <div className="workflow-arg-field">
        <label htmlFor="qpe-profile">Profile</label>
        <PopoverPicklist
          id="qpe-profile"
          value={profile}
          ariaLabel="Profile"
          searchable={false}
          onChange={(nextProfile) => setProfile(nextProfile as LaunchProfileId)}
          options={promptProfiles.map((item) => ({ value: item, label: profileLabel(item) }))}
        />
      </div>

      {slotNames.length > 0 && (
        <div className="quick-prompt-editor-args">
          <span className="launch-section-label">
            Arguments ({slotNames.length})
          </span>
          {slotNames.map((name) => {
            const meta = argMeta[name] ?? { name };
            const isEnum = meta.type === 'enum';
            return (
              <div key={name} className="quick-prompt-editor-arg">
                <span className="quick-prompt-editor-arg-name">{name}</span>
                <PopoverPicklist
                  value={meta.type ?? 'text'}
                  ariaLabel={`${name} type`}
                  searchable={false}
                  onChange={(type) => setMeta(name, { type: type as 'text' | 'enum' })}
                  options={[
                    { value: 'text', label: 'text' },
                    { value: 'enum', label: 'enum' }
                  ]}
                />
                <input
                  type="text"
                  aria-label={`${name} description`}
                  placeholder="description"
                  value={meta.description ?? ''}
                  onChange={(e) => setMeta(name, { description: e.target.value })}
                />
                {isEnum ? (
                  <input
                    type="text"
                    aria-label={`${name} values`}
                    placeholder="comma,separated,values"
                    value={(meta.enumValues ?? []).join(',')}
                    onChange={(e) =>
                      setMeta(name, {
                        enumValues: e.target.value
                          .split(',')
                          .map((v) => v.trim())
                          .filter(Boolean)
                      })
                    }
                  />
                ) : (
                  <input
                    type="text"
                    aria-label={`${name} default`}
                    placeholder="default"
                    value={meta.defaultValue ?? ''}
                    onChange={(e) => setMeta(name, { defaultValue: e.target.value })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="launch-error" role="alert">
          {error}
        </div>
      )}

      <div className="workflow-arg-actions">
        {isEdit && (
          <button
            type="button"
            className="settings-btn danger"
            onClick={reset}
            disabled={busy}
            title={isBuiltin ? 'Restore the shipped default' : 'Delete this quick prompt'}
          >
            <Trash2 size={12} /> {isBuiltin ? 'Reset' : 'Delete'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="settings-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="settings-btn primary" onClick={save} disabled={busy}>
          {isEdit ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  );
}

interface Props {
  onClose: () => void;
  /**
   * Pin the launcher to one registered project. When set, the launcher is in
   * PROJECT mode: no project picker, no starter chips, but it surfaces the
   * resume list, background tray, and default-persona star. When omitted, it's
   * in SCRATCH/global mode (project picker + chips, anchored to the built-in
   * `~/zcc-workspace` scratch project).
   */
  project?: Project;
  /**
   * Background (detached) sessions to surface so the tray isn't lost. Project
   * mode only — passed by the project Workspace.
   */
  backgroundTabs?: TerminalSession[];
  /**
   * Post-launch behavior. When provided, it OVERRIDES the default
   * redirect-into-the-project — the launcher calls it with the freshly created
   * session + its project id and does NOT navigate. The Agents (global) view
   * uses this to pop the agent-inspector modal instead of leaving the board.
   * When omitted, the default redirect (select the project + focus its tab) runs.
   */
  onLaunched?: (session: TerminalSession, projectId: string) => void;
  /**
   * Seed the instruction box with this text on open. Used by callers that want
   * the launcher to start prefilled — e.g. the inbox's "spawn an agent against
   * this message" button hands over the report as the first prompt. The user can
   * still edit it before launching.
   */
  initialPrompt?: string;
}

export const AgentLauncher = memo(function AgentLauncher({
  onClose,
  project,
  backgroundTabs,
  onLaunched,
  initialPrompt
}: Props) {
  // Persist the in-progress instruction so an accidental click-out / close
  // doesn't discard what the user typed. Keyed per launch context (a pinned
  // project vs. the global/scratch launcher) so two open contexts don't clobber
  // each other's draft. Cleared once the agent is actually launched (Send).
  const draftKey = `zcc.agentLauncher.draft.${project?.id ?? 'global'}`;
  const readDraft = () => {
    try {
      return localStorage.getItem(draftKey) ?? '';
    } catch {
      return '';
    }
  };
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* storage unavailable — nothing to clear */
    }
  };

  const createTerminal = useData((s) => s.createTerminal);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const updateProject = useData((s) => s.updateProject);
  const loadProjects = useData((s) => s.loadProjects);
  // PERF FIX: wrap array selectors in useShallow to prevent re-renders on every
  // store update when the array content is unchanged.
  const projects = useData(useShallow((s) => s.projects));
  const allPersonas = usePersonas(useShallow((s) => s.personas));
  const [anchor, setAnchor] = useState<Project | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  const [presets, setPresets] = useState<QuickPrompt[]>([]);
  const [frameworks, setFrameworks] = useState<FrameworkOption[]>([]);
  /**
   * When applying a parametrized QuickPrompt (`{{arg}}` slots), we pop a small
   * inline fill form instead of injecting the raw template. `argPreset` holds
   * the prompt being filled (null = no form open); `argValues` the field state.
   */
  const [argPreset, setArgPreset] = useState<QuickPrompt | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  /**
   * Quick-prompt editor state (scratch mode only). `null` = closed;
   * `{ mode: 'new' }` = create a fresh prompt; `{ mode: 'edit', prompt }` = edit
   * an existing one (a builtin edit saves a shadowing user file).
   */
  const [editor, setEditor] = useState<
    { mode: 'new' } | { mode: 'edit'; prompt: QuickPrompt } | null
  >(null);
  // Seed from an explicit caller prompt (e.g. inbox "spawn an agent"); otherwise
  // restore any draft the user left behind on a previous open.
  const [prompt, setPromptState] = useState(initialPrompt ?? readDraft());
  const setPrompt = (next: string) => {
    setPromptState(next);
    try {
      if (next) localStorage.setItem(draftKey, next);
      else localStorage.removeItem(draftKey);
    } catch {
      /* storage unavailable — draft simply won't persist */
    }
  };
  const [familyId, setFamilyId] = useState<LauncherFamily>('claude');
  const [profileChosen, setProfileChosen] = useState(false);
  // Normal / Yolo axis — the permission posture applied to whichever family is
  // picked. Yolo launches the family's bypass profile; a family with no bypass
  // (PI) ignores it (the toggle is disabled).
  const [yolo, setYolo] = useState(false);
  const globalDefaultHarness = useData((s) => s.defaultHarness);
  const configLoaded = useData((s) => s.configLoaded);
  const harnessCursorEnabled = useData((s) => s.harnessCursorEnabled);
  const harnessCodexEnabled = useData((s) => s.harnessCodexEnabled);
  const harnessPiEnabled = useData((s) => s.harnessPiEnabled);
  const harnessOpenCodeEnabled = useData((s) => s.harnessOpenCodeEnabled);
  const harnessStatus = useData((s) => s.harnessStatus);
  const microVmEnabled = useData((s) => s.microVmEnabled);
  const worktreeIsolationDefault = useData((s) => s.worktreeIsolationDefault);
  /** Advanced view: expands the persona + framework pickers. Collapsed by
   *  default so the common launch is unchanged. */
  const [advanced, setAdvanced] = useState(false);
  /**
   * Advanced selections driving the launch's system-prompt layer: an explicit
   * `personaId` (a curated persona) OR one-or-more `frameworkIds` (extension
   * framework primers). A persona and frameworks are mutually exclusive —
   * choosing a persona clears the framework set and vice versa — because main
   * lands both in the same persona slot and a persona always wins there. Multiple
   * frameworks ARE allowed and get MERGED main-side into one synthetic persona.
   */
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [frameworkIds, setFrameworkIds] = useState<string[]>([]);
  // Execution environment (Advanced): WHERE the agent runs.
  //   'off'     → a plain local spawn.
  //   'microvm' → a hardware-isolated microVM (microsandbox). Only offered when
  //               `microVmEnabled` is on AND the platform supports it; fails
  //               closed main-side (visible notice) when the runtime is absent.
  // NOTE: the legacy OS kernel sandbox ('sandbox' / Seatbelt) is no longer
  // offered in the picker — the microVM is its hard replacement.
  const [envChoice, setEnvChoice] = useState<'off' | 'microvm'>('off');
  const [workspace, setWorkspace] = useState<WorkspacePickerValue>({ kind: 'unmanaged' });
  const [worktreeName, setWorktreeName] = useState(() => normalizeWorktreeName(titleFromPrompt(prompt)));
  const [worktreeNameInvalid, setWorktreeNameInvalid] = useState(false);
  const [worktreeDefaultLoaded, setWorktreeDefaultLoaded] = useState(false);
  const [targetIsGitRepo, setTargetIsGitRepo] = useState(false);
  const worktreeTouched = useRef(false);
  const worktreeTargetId = useRef<string | null>(null);
  const worktreeNameTouched = useRef(false);
  const worktreeNameRef = useRef<HTMLInputElement>(null);
  // Platform gate for the microVM option (main is the source of truth). Probed
  // once on mount; `null` = unknown yet (treated as unsupported for the UI).
  const [microVmSupported, setMicroVmSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    product.app
      .microVmSupported()
      .then((ok) => alive && setMicroVmSupported(ok))
      .catch(() => alive && setMicroVmSupported(false));
    return () => {
      alive = false;
    };
  }, []);
  // The microVM toggle is offered only when enabled in Settings; it's DISABLED
  // (visible but not selectable) on unsupported hardware so the capability is
  // discoverable with an honest reason rather than silently missing.
  const microVmOffered = microVmEnabled;
  const microVmSelectable = microVmEnabled && microVmSupported === true;
  // If the microVM option gets pulled out from under a selection (Settings
  // toggled off, or the probe says unsupported), fall back to Off.
  useEffect(() => {
    if (envChoice === 'microvm' && !microVmSelectable) setEnvChoice('off');
  }, [envChoice, microVmSelectable]);
  /**
   * Extra CLI args: raw flags forwarded verbatim to the harness argv, e.g.
   * `--plugin-dir`, `/path/to/plugins`. Each chip is one argv token — kept as
   * discrete chips rather than a single pasted string so there's no shell-
   * quoting ambiguity to parse. Scoped PER HARNESS (`family.id`) — claude and
   * opencode take different flags, so a value typed for one must never bleed
    * into the other. Values are retained per harness between launcher sessions.
   */
  const [extraArgsByFamily, setExtraArgsByFamily] = useState<Record<string, string[]>>({});
  const extraArgsCacheKey = (fam: string) => `zcc.agentLauncher.extraArgsCache.${fam}`;
  // Load a family's cached chips lazily, the first time it's actually selected
  // (rather than eagerly for every family on mount).
  const extraArgsFor = (fam: string): string[] => {
    if (fam in extraArgsByFamily) return extraArgsByFamily[fam];
    try {
      const raw = localStorage.getItem(extraArgsCacheKey(fam));
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  };
  const setExtraArgsForFamily = (fam: string, vals: string[]) => {
    setExtraArgsByFamily((prev) => ({ ...prev, [fam]: vals }));
    try {
      if (vals.length) localStorage.setItem(extraArgsCacheKey(fam), JSON.stringify(vals));
      else localStorage.removeItem(extraArgsCacheKey(fam));
    } catch {
      /* storage unavailable — the chips still live in memory for this session */
    }
  };
  /** Starter-prompt chip row (scratch mode): collapsed to the first 2 chips + a
   *  "More" button by default, so the row doesn't eat vertical space before the
   *  user has typed anything; "More" reveals the rest inline. */
  const [chipsExpanded, setChipsExpanded] = useState(false);
  /**
   * Target project for a SCRATCH-mode launch. `null` = the built-in scratch
   * workspace (the default). A real project id launches straight into that
   * registered project instead. Unused in project mode (the target is fixed).
   */
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  // Launch mode: Modern (HTTP conversation, default), CLI Agent (PTY spawn),
  // or an autonomous team run. Autonomous mode mounts AutonomousTeamComposer
  // and launches via `teams.launchAutonomous`. Thread create stays in
  // ThreadCommandComposer.
  const [mode, setMode] = useState<LaunchMode>('thread');
  const [harnessDescriptors, setHarnessDescriptors] = useState<HarnessAdapterDescriptor[]>([]);
  const [openCodeAgentDiscoverySnapshot, setOpenCodeAgentDiscoverySnapshot] = useState<OpenCodeAgentDiscoverySnapshot | null>(null);
  const [agentDescriptorsRefresh, setAgentDescriptorsRefresh] = useState(0);
  const [portableRouting, setPortableRouting] = useState<LauncherRouting>({});
  const [nativeRouting, setNativeRouting] = useState<Partial<Record<HarnessFamily, LauncherRouting>>>({});
  const [agentRoutingDirty, setAgentRoutingDirty] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [fixingWithAi, setFixingWithAi] = useState(false);
  const teams = useTeams(useShallow((s) => s.teams));
  useEffect(() => {
    if (mode === 'autonomous' && teams.length === 0) setMode('thread');
  }, [mode, teams.length]);
  const pushToast = useUi((s) => s.pushToast);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Harness row icon-only fallback: whether the full labels ("claude",
  // "opencode", ...) fit depends on both the modal width and how many
  // harnesses are installed, so it's measured rather than guessed at a fixed
  // breakpoint — see the `.launch-segmented--measure` mirror this reads from.
  const harnessMeasureWrapRef = useRef<HTMLDivElement>(null);
  const harnessMeasureRef = useRef<HTMLDivElement>(null);
  const [harnessCompact, setHarnessCompact] = useState(false);

  useEffect(() => {
    if (!worktreeNameTouched.current) {
      setWorktreeName(normalizeWorktreeName(titleFromPrompt(prompt)));
    }
  }, [prompt]);

  // Project mode is pinned to one project; scratch mode offers the picker.
  const projectMode = !!project;
  // Install status per family — a harness whose CLI isn't found is HIDDEN from
  // the picker entirely (not greyed-out): an unusable profile shouldn't be an
  // option. A family with no verify result yet (probe still running) is treated
  // as installed so the picker never blocks while the check is in flight.
  const installedFamilies = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const h of harnessStatus) m.set(h.family, h.installed);
    return m;
  }, [harnessStatus]);
  const familyInstalled = (fam: LauncherFamily): boolean =>
    installedFamilies.get(fam) !== false;
  // Families offered in the picker: installed CLIs activate automatically
  // (BB-style). An explicit Settings hide still drops them. Claude is always
  // on. Yolo is a SEPARATE axis, so a family appears once regardless of
  // permission posture.
  const availableFamilies = useMemo(
    () =>
      FAMILIES.filter((f) => {
        const status = harnessStatus.find((row) => row.family === f.id);
        if (f.id === 'cursor') return optionalHarnessOffered(status, harnessCursorEnabled);
        if (f.id === 'codex') return optionalHarnessOffered(status, harnessCodexEnabled);
        if (f.id === 'pi') return optionalHarnessOffered(status, harnessPiEnabled);
        if (f.id === 'opencode') return optionalHarnessOffered(status, harnessOpenCodeEnabled);
        return familyInstalled(f.id);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [harnessCursorEnabled, harnessCodexEnabled, harnessPiEnabled, harnessOpenCodeEnabled, harnessStatus, installedFamilies]
  );
  const selectedPersona = personaId ? allPersonas.find((p) => p.id === personaId) : undefined;
  const unavailableHistoryProviders = [
    harnessCursorEnabled ? 'Cursor' : null,
    harnessCodexEnabled ? 'Codex' : null,
    harnessPiEnabled ? 'PI' : null
  ].filter((provider): provider is string => provider !== null);
  // Resolve scratch-mode project selection before deriving Default harness so a
  // picked project uses its own Project → Global hierarchy, not scratch defaults.
  const target = projectMode
    ? project!
    : (targetProjectId ? projects.find((p) => p.id === targetProjectId) : null) ?? anchor;
  const remoteTarget = target?.remote ? { id: target.id, remote: target.remote } : undefined;
  const addAttachments = (paths: string[]) => {
    setAttachments((current) => mergeAttachmentPaths(current, paths));
  };
  const resolveAttachmentPaths = async (): Promise<string[] | null> => {
    if (!remoteTarget) return attachments;
    const uploaded: string[] = [];
    for (const localPath of attachments) {
      const result = await product.fs.uploadToRemote(remoteTarget.id, localPath, '.');
      if (!result.ok || !result.path) {
        pushToast(result.message ?? `Failed to upload ${attachmentName(localPath)}`, 'error');
        return null;
      }
      uploaded.push(result.path);
      pushToast(`Uploaded ${attachmentName(localPath)} to ${remoteTarget.remote.host}`);
    }
    return uploaded.map(posixQuote);
  };
  // Renderer eligibility is advisory. Main still verifies Git state and confines
  // the worktree before changing cwd.
  const scratchIsTarget = !projectMode && targetProjectId === null;
  const worktreeStructurallyEligible = isWorktreeEligible(target, scratchIsTarget);
  const worktreeEligible = worktreeStructurallyEligible && targetIsGitRepo;
  const personaProfileSelection = selectedPersona?.baseProfile
    ? familySelectionOf(selectedPersona.baseProfile)
    : null;
  const projectLaunchDefault = target?.launchDefault;
  const projectProfileSelection = projectLaunchDefault?.kind === 'exact-profile'
    ? familySelectionOf(projectLaunchDefault.profileId)
    : null;
  // Derive the displayed default during render. An effect would first paint
  // Claude and only then replace it with the persisted harness. A pinned persona
  // similarly owns the display unless the operator already made an explicit
  // conflicting harness choice (which remains visible and blocks below).
  const selectedFamilyId = !profileChosen && configLoaded
    ? personaProfileSelection?.family ?? projectProfileSelection?.family ?? globalDefaultHarness ?? availableFamilies[0]?.id
    : familyId;
  // Retain requested family when it becomes unavailable. Never silently replace
  // explicit, Persona, Project, or Global intent with another installed CLI.
  const family = selectedFamilyId ? selectedAvailableFamily(availableFamilies, selectedFamilyId) : undefined;
  const selectedFamilyUnavailable = configLoaded && !family;
  // Yolo only applies when the family HAS a bypass profile; PI (yolo === null)
  // launches its base profile regardless of the toggle.
  const yoloActive = yolo && !!family?.yolo;
  // Resolve the concrete profile + fallback title from (family, yolo).
  const descriptor: { profile: LaunchProfileId; label: string } | undefined = family
    ? {
        profile: yoloActive ? family.yolo! : family.base,
        label: yoloActive ? `${family.label} (yolo)` : family.label
      }
    : undefined;
  const personaProfileConflict = !!(
    profileChosen &&
    selectedPersona?.baseProfile &&
    descriptor &&
    descriptor.profile !== selectedPersona.baseProfile
  );
  const unavailableMessage = selectedFamilyUnavailable
    ? personaProfileSelection
      ? `${selectedPersona!.name} is pinned to ${selectedPersona!.baseProfile}, which is disabled or unavailable. Choose another persona, clear it, or re-enable that harness in Settings.`
      : profileChosen
        ? `${FAMILIES.find((entry) => entry.id === selectedFamilyId)?.label ?? selectedFamilyId} is disabled or unavailable. Choose an enabled harness, or re-enable it in Settings.`
        : projectProfileSelection
          ? `Project default harness ${projectProfileSelection.family} is disabled or unavailable. Choose an enabled harness, or change the Project default.`
          : `Default harness ${selectedFamilyId} is disabled or unavailable. Choose an enabled harness, or re-enable it in Settings.`
    : null;
  const launchStatus = launchError ?? unavailableMessage ?? (personaProfileConflict
    ? `${selectedPersona!.name} is pinned to ${selectedPersona!.baseProfile}, which conflicts with explicit ${descriptor!.profile}. Choose the pinned harness, clear the persona, or launch without it.`
    : null);
  const launchStatusA11y = launchStatusAccessibility(!!launchStatus);
  const selectedHarnessDescriptor = family
    ? harnessDescriptors.find((entry) => entry.id === family.id)
    : undefined;
  const openCodeAgentDiscoveryProjectId =
    selectedHarnessDescriptor?.id === 'opencode' &&
    selectedHarnessDescriptor.availability.enabled &&
    selectedHarnessDescriptor.availability.installed &&
    target &&
    !target.remote
      ? target.id
      : undefined;
  const openCodeAgentDiscoveryProfile = openCodeAgentDiscoveryProjectId ? descriptor?.profile : undefined;
  const openCodeAgentDiscovery = discoveryForOpenCodePicker(
    openCodeAgentDiscoveryProjectId,
    openCodeAgentDiscoveryProfile,
    openCodeAgentDiscoverySnapshot
  );
  const selectedNativeRouting = family ? nativeRouting[family.id] ?? {} : {};
  const customizationCount =
    (agentRoutingDirty ? 1 : 0) +
    (family && extraArgsFor(family.id).length > 0 ? 1 : 0) +
    (personaId ? 1 : 0) +
    frameworkIds.length +
    (envChoice === 'microvm' ? 1 : 0) +
    (workspace.kind === 'worktree' && worktreeEligible ? 1 : 0);

  const updateNativeRouting = (familyId: HarnessFamily, patch: Partial<LauncherRouting>) => {
    setAgentRoutingDirty(true);
    setNativeRouting((current) => {
      const nextEntry: LauncherRouting = { ...(current[familyId] ?? {}), ...patch };
      if (nextEntry.compatibility) {
        const compatibility = Object.fromEntries(
          Object.entries(nextEntry.compatibility).filter(([, value]) => value !== undefined)
        );
        nextEntry.compatibility = Object.keys(compatibility).length ? compatibility : undefined;
      }
      for (const key of Object.keys(nextEntry) as Array<keyof LauncherRouting>) {
        if (nextEntry[key] === undefined) delete nextEntry[key];
      }
      const next = { ...current };
      if (Object.keys(nextEntry).length) next[familyId] = nextEntry;
      else delete next[familyId];
      return next;
    });
  };
  // Recompute compact-vs-full whenever the wrapper resizes (modal drag/resize)
  // or the set of harness buttons changes (installed harnesses, enable toggles
  // flipped in Settings). Compares the wrapper's actual width against the
  // hidden mirror's natural (unwrapped) width — the mirror always renders full
  // labels, so its scrollWidth is the width the visible row would need to do
  // the same, independent of whichever mode the visible row is currently in.
  useEffect(() => {
    let cancelled = false;
    setTargetIsGitRepo(false);
    if (!worktreeStructurallyEligible || !target) return;
    void product.git.isRepo(target.path)
      .then((isRepo) => {
        if (!cancelled) setTargetIsGitRepo(isRepo);
      })
      .catch(() => {
        if (!cancelled) setTargetIsGitRepo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target?.id, target?.path, worktreeStructurallyEligible]);

  useEffect(() => {
    const wrap = harnessMeasureWrapRef.current;
    const mirror = harnessMeasureRef.current;
    if (!wrap || !mirror) return;
    const recompute = () => {
      setHarnessCompact(mirror.scrollWidth > wrap.clientWidth);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [availableFamilies]);

  useEffect(() => {
    if (worktreeTargetId.current !== (target?.id ?? null)) {
      worktreeTargetId.current = target?.id ?? null;
      worktreeTouched.current = false;
    }
    if (!worktreeStructurallyEligible || !target) {
      setWorktreeDefaultLoaded(true);
      return;
    }
    if (!targetIsGitRepo) {
      setWorkspace({ kind: 'unmanaged' });
      setWorktreeDefaultLoaded(true);
      return;
    }
    setWorktreeDefaultLoaded(false);
    if (worktreeTouched.current) {
      setWorktreeDefaultLoaded(true);
      return;
    }
    let cancelled = false;
    void product.projectSettings
      .get(target.id)
      .then((settings) => {
        const effective = resolveWorktreeDefault(
          settings.worktreeIsolation,
          worktreeIsolationDefault
        );
        if (!cancelled) {
          if (!worktreeTouched.current) setWorkspace(effective ? { kind: 'worktree' } : { kind: 'unmanaged' });
          setWorktreeDefaultLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (!worktreeTouched.current) setWorkspace(defaultWorkspaceChoice(worktreeIsolationDefault));
          setWorktreeDefaultLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target?.id, worktreeStructurallyEligible, targetIsGitRepo, worktreeIsolationDefault]);

  // Personas surfaced: in project mode, builtin + global + this project's own
  // (the store merges sources; filter project-scoped ones to this project). In
  // scratch mode, all personas the store carries.
  const personas = useMemo(
    () =>
      projectMode
        ? allPersonas.filter(
            (p) =>
              typeof p.source !== 'object' ||
              p.source === null ||
              !('projectId' in p.source) ||
              p.source.projectId === project!.id
          )
        : allPersonas,
    [allPersonas, projectMode, project]
  );

  // The project's pinned default persona (project mode only) — the one a
  // one-click "+" / ⌘T spawns. Read live so the star reflects updates.
  const defaultPersonaId = useData((s) =>
    projectMode ? s.projects.find((p) => p.id === project!.id)?.defaultPersonas?.[0] : undefined
  );
  const toggleDefaultPersona = (id: string) => {
    if (!projectMode) return;
    void updateProject(project!.id, {
      defaultPersonas: defaultPersonaId === id ? [] : [id]
    });
  };

  // Real (non-scratch) projects offered in the picker, grouped like the Projects
  // rail — Favorites, then Remote, then Local — each A→Z. The scratch anchor is
  // its own leading option and is filtered out here so it isn't listed twice.
  const projectGroups = useMemo(() => {
    const real = projects.filter((p) => !p.quickAgent);
    const favorites = sortProjectsAlphabetically(real.filter((p) => p.favorite));
    const rest = real.filter((p) => !p.favorite);
    const remote = sortProjectsAlphabetically(rest.filter((p) => p.remote));
    const local = sortProjectsAlphabetically(rest.filter((p) => !p.remote));
    return { favorites, remote, local };
  }, [projects]);

  // On mount: load quick-prompt presets + framework presets from installed
  // extensions (Advanced view), and — in scratch mode only — ensure the scratch
  // project exists (creates ~/zcc-workspace on first run). The framework list is
  // read directly from the extension entries — the renderer only carries the
  // display fields + the extension id it later passes back to main (Rule 1).
  useEffect(() => {
    let cancelled = false;
    void loadProjects();
    (async () => {
      const [prompts, entries, anchorRes] = await Promise.all([
        product.quickPrompts.list().catch(() => []),
        product.extensions.list().catch(() => []),
        projectMode ? Promise.resolve(null) : product.projects.ensureQuickAgent()
      ]);
      if (cancelled) return;
      setPresets(prompts);
      setFrameworks(frameworkOptionsFrom(entries));
      if (anchorRes) {
        if (!anchorRes.ok) {
          setAnchorError(anchorRes.message);
          return;
        }
        setAnchor(anchorRes.value);
        // `ensureQuickAgent` creates the scratch project lazily in main but does
        // NOT broadcast a projects change, so the store's `projects` list won't
        // know about a freshly-created ~/zcc-workspace. Merge it in (mirroring
        // host.ts / Workspace.tsx) — otherwise a scratch launch lands a session
        // whose projectId the store can't resolve, and the Agents views render
        // the owning project as "Unknown".
        if (!useData.getState().projects.some((p) => p.id === anchorRes.value.id)) {
          void loadProjects();
        }
      }
    })().catch((err) => {
      if (!cancelled) setAnchorError(err instanceof Error ? err.message : String(err));
    });
    // Live-refresh the chip list when the store changes (editor save/delete, or
    // a hand-edited file in the user dir).
    const off = product.quickPrompts.onChanged((prompts) => {
      if (!cancelled) setPresets(prompts);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [projectMode, loadProjects]);

  useEffect(() => {
    void product.harness.descriptors().then(setHarnessDescriptors).catch(() => setHarnessDescriptors([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!openCodeAgentDiscoveryProjectId || !openCodeAgentDiscoveryProfile) {
      return () => {
        cancelled = true;
      };
    }
    setOpenCodeAgentDiscoverySnapshot({
      projectId: openCodeAgentDiscoveryProjectId,
      profile: openCodeAgentDiscoveryProfile,
      discovery: { status: 'loading' }
    });
    void product.harness.agentDescriptors(
      openCodeAgentDiscoveryProjectId,
      openCodeAgentDiscoveryProfile,
      agentDescriptorsRefresh > 0
    )
      .then((discovery) => {
        if (cancelled) return;
        setOpenCodeAgentDiscoverySnapshot({
          projectId: openCodeAgentDiscoveryProjectId,
          profile: openCodeAgentDiscoveryProfile,
          discovery
        });
        setNativeRouting((current) => {
          const selectedRole = current.opencode?.roleTargetId;
          const reconciledRole = reconcileOpenCodeRole(selectedRole, discovery);
          if (reconciledRole === selectedRole) return current;
          setAgentRoutingDirty(true);
          const next = { ...current };
          const nextOpenCode = { ...(current.opencode ?? {}) };
          delete nextOpenCode.roleTargetId;
          if (Object.keys(nextOpenCode).length) next.opencode = nextOpenCode;
          else delete next.opencode;
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setOpenCodeAgentDiscoverySnapshot({
            projectId: openCodeAgentDiscoveryProjectId,
            profile: openCodeAgentDiscoveryProfile,
            discovery: { status: 'failure' }
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [openCodeAgentDiscoveryProjectId, openCodeAgentDiscoveryProfile, agentDescriptorsRefresh]);

  useDialogFocusTrap(dialogRef, onClose);

  // Post-launch: the caller can override what happens (the Agents global view
  // pops the inspector modal instead of navigating). Default — redirect into the
  // new agent's terminal so the user can immediately follow along / intervene.
  // The session is foreground (non-headless), so selecting its tab is enough.
  // Failed creation leaves launcher, draft, and retained inline error in place
  // so operator can correct selection and retry.
  const afterLaunch = (session: TerminalSession | null) => {
    if (!session) return;
    clearDraft();
    setAttachments([]);
    setLaunchError(null);
    if (target) {
      if (onLaunched) {
        onLaunched(session, target.id);
      } else {
        const ui = useUi.getState();
        ui.enterProjectFocus(target.id);
        ui.selectTab(target.id, session.id);
      }
    }
    onClose();
  };

  // Low-level spawn. `applyAdvanced` gates the persona/framework layer so a
  // resume (which continues an existing transcript verbatim) never re-injects a
  // primer. An explicit persona wins over a framework (they share the persona
  // slot main-side), so only one is ever sent.
  const doCreate = async (
    profile: LaunchProfileId,
    opts: { extraArgs?: string[]; prompt?: string; title?: string; resumeSessionId?: string },
    applyAdvanced: boolean
  ) => {
    if (!target) return;
    const chosenPersonaId = applyAdvanced && advanced ? personaId ?? undefined : undefined;
    const chosenFrameworkIds =
      applyAdvanced && advanced && !chosenPersonaId && frameworkIds.length > 0
        ? frameworkIds
        : undefined;
    setLaunching(true);
    // User-typed extra args (per-harness) go BEFORE opening-task args: the
    // prompt rides a trailing positional (or OpenCode's `--prompt <text>`),
    // which must stay last in argv so it isn't swallowed as a value for a
    // preceding flag. Gated on `applyAdvanced` like persona/framework — a resume
    // (fixed argv, continuing an existing transcript) never picks these up.
    const currentExtraArgs = family ? extraArgsFor(family.id) : [];
    const chosenExtraArgs =
      applyAdvanced && currentExtraArgs.length > 0
        ? [...currentExtraArgs, ...(opts.extraArgs ?? [])]
        : opts.extraArgs;
    let session: TerminalSession | null = null;
    try {
      session = await createTerminal(target.id, profile, 80, 24, {
        extraArgs: chosenExtraArgs,
        prompt: opts.prompt,
        harnessRouting: family
          ? agentRoutingForSubmission(profileChosen, family.id, portableRouting, nativeRouting, agentRoutingDirty)
          : undefined,
        // Let main/provider name a pinned-persona launch from its effective profile.
        // Otherwise a seeded OpenCode default briefly labels a Claude process as
        // OpenCode until terminal auto-rename catches up.
        title: chosenPersonaId ? undefined : opts.title,
        resumeSessionId: opts.resumeSessionId,
        personaId: chosenPersonaId,
        frameworkIds: chosenFrameworkIds,
        profileSource: profileChosen ? 'explicit' : 'seeded-default',
        // For the scratch workspace, ask main to mint a fresh isolated subfolder
        // (seeded by the prompt-derived title) instead of dumping every scratch
        // session into the flat workspace root. Only applies to the scratch
        // workspace — a real project always launches at its own root.
        isolateScratch: scratchIsTarget ? opts.title || true : undefined,
        worktree: worktreeForSubmission(applyAdvanced, workspace.kind === 'worktree', worktreeEligible, worktreeName),
        workspace: workspaceForSubmission(applyAdvanced, workspace, worktreeEligible || workspace.kind === 'personal' || workspace.kind === 'reuse', worktreeName),
        // Execution environment (Advanced opt-in). Only sent when a non-default
        // choice is active, so a normal launch stays byte-identical. Main
        // re-resolves + re-authorizes the environment (Rule 1). 'microvm' is only
        // reachable here when it was selectable (enabled + supported).
        environment:
          applyAdvanced && advanced && envChoice === 'microvm' && microVmSelectable
            ? 'microvm'
            : undefined,
        onError: setLaunchError
      });
    } finally {
      setLaunching(false);
    }
    afterLaunch(session);
  };

  const launch = async () => {
    if (!descriptor || !target || launching) return;
    const normalizedWorktreeName = normalizeWorktreeName(worktreeName);
    if (workspace.kind === 'worktree' && worktreeEligible && !normalizedWorktreeName) {
      setAdvanced(true);
      setWorktreeNameInvalid(true);
      requestAnimationFrame(() => {
        worktreeNameRef.current?.scrollIntoView({ block: 'nearest' });
        worktreeNameRef.current?.focus();
      });
      return;
    }
    if (worktreeName !== normalizedWorktreeName) setWorktreeName(normalizedWorktreeName);
    setLaunching(true);
    try {
      const attachmentPaths = await resolveAttachmentPaths();
      if (attachmentPaths === null) return;
      await doCreate(
        descriptor.profile,
        buildLaunchArgs(appendAttachmentContext(prompt, attachmentPaths), descriptor.label),
        true
      );
    } catch (err) {
      const message = `Agent launch failed: ${err instanceof Error ? err.message : String(err)}`;
      setLaunchError(message);
      pushToast(message, 'error');
    } finally {
      setLaunching(false);
    }
  };

  // "Fix with AI" — spawns a narrowly-scoped repair agent seeded with the raw
  // launch-failure text (mirrors Settings → Doctor's spawn path: claude-yolo so
  // it can inspect/repair local tooling without a permission prompt per step).
  // Always runs at the managed ~/zcc-workspace root rather than the failed
  // project: a missing or stale project cwd is itself a common launch failure,
  // and would prevent the repair agent from starting if reused here.
  const fixWithAi = async () => {
    if (!launchError || fixingWithAi) return;
    setFixingWithAi(true);
    try {
      const anchorRes = await product.projects.ensureQuickAgent();
      if (!anchorRes.ok) {
        setLaunchError(anchorRes.message);
        return;
      }
      const anchor = anchorRes.value;
      const session = await createTerminal(anchor.id, 'claude-yolo', 80, 24, {
        ...buildLaunchArgs(buildFixWithAiPrompt(launchError), 'Fix with AI')
      });
      if (session) {
        setLaunchError(null);
        clearDraft();
        const ui = useUi.getState();
        ui.enterProjectFocus(anchor.id);
        ui.selectTab(anchor.id, session.id);
        onClose();
      }
    } finally {
      setFixingWithAi(false);
    }
  };

  // Resume a detached (background) session back into the tab strip, then close
  // the launcher so the restored terminal isn't hidden behind the backdrop.
  const resumeBackground = (id: string) => {
    if (!target) return;
    void restoreTerminal(id, target.id);
    onClose();
  };

  /** Nudge the family picker + Normal/Yolo toggle to reflect a concrete profile
   *  (from a preset / framework `baseProfile`), but only when its family is one
   *  the launcher actually offers. A persona/framework preset with no profile,
   *  or one whose family is unavailable, leaves the controls untouched. */
  const selectProfile = (profile: LaunchProfileId | undefined) => {
    if (!profile) return;
    const sel = familySelectionOf(profile);
    if (sel && availableFamilies.some((f) => f.id === sel.family)) {
      setFamilyId(sel.family);
      setYolo(sel.yolo);
      setProfileChosen(true);
    }
  };
  const applyPresetProfile = (p: QuickPrompt) => selectProfile(p.profile);

  const applyPreset = (p: QuickPrompt) => {
    // A parametrized prompt opens the per-argument fill form first; a plain one
    // seeds straight into the composer as before.
    if (hasArguments(p.prompt)) {
      const args = resolveArguments(p.prompt, p.arguments);
      const seed: Record<string, string> = {};
      for (const a of args) seed[a.name] = a.defaultValue ?? '';
      setArgValues(seed);
      setArgPreset(p);
      return;
    }
    setPrompt(p.prompt);
    applyPresetProfile(p);
  };

  /** Commit the fill form: substitute values into the template, seed the composer. */
  const applyArgForm = () => {
    if (!argPreset) return;
    setPrompt(substituteArguments(argPreset.prompt, argValues, argPreset.arguments));
    applyPresetProfile(argPreset);
    setArgPreset(null);
    setArgValues({});
  };

  /** Hand the agent the template + argument spec and let it interview the user
   *  in the terminal, instead of collecting the values up-front in the form. */
  const interviewArgForm = () => {
    if (!argPreset) return;
    setPrompt(buildInterviewPrompt(argPreset.prompt, argPreset.arguments));
    applyPresetProfile(argPreset);
    setArgPreset(null);
    setArgValues({});
  };

  const cancelArgForm = () => {
    setArgPreset(null);
    setArgValues({});
  };

  // Persona / framework(s) are mutually exclusive (they share the persona slot
  // main-side). Frameworks themselves multi-select: clicking one toggles its
  // membership in the set. Adding any framework clears an explicit persona; a
  // framework whose preset declares a baseProfile also nudges the profile
  // segmented control so the header/Send reflect what will actually launch.
  const toggleFramework = (fw: FrameworkOption) => {
    setFrameworkIds((cur) => {
      const has = cur.includes(fw.id);
      const next = has ? cur.filter((id) => id !== fw.id) : [...cur, fw.id];
      if (!has) {
        setPersonaId(null);
        selectProfile(fw.preset.baseProfile);
      }
      return next;
    });
  };

  const choosePersona = (p: Persona) => {
    setPersonaId((cur) => {
      const next = cur === p.id ? null : p.id;
      if (next) {
        setFrameworkIds([]);
        const selection = p.baseProfile ? familySelectionOf(p.baseProfile) : null;
        if (selection && availableFamilies.some((entry) => entry.id === selection.family)) {
          setFamilyId(selection.family);
          setYolo(selection.yolo);
          setProfileChosen(true);
          setNativeRouting((current) => ({ ...current, ...launcherRoutingFromPersona(p) }));
        } else {
          setProfileChosen(false);
          setPortableRouting({
            ...(p.modelLevel ? { modelLevel: p.modelLevel } : {}),
            ...(p.executionState ? { executionState: p.executionState } : {})
          });
        }
      }
      return next;
    });
  };

  const bg = projectMode ? backgroundTabs ?? [] : [];

  // The legacy scratch-mode quick-prompt UI (starter chips, prompt editor,
  // workflow arg form, project picker) is superseded by the composers above
  // and kept only for reference — a `const` (rather than the literal `false`)
  // so TS still narrows `editor`/`argPreset` inside these blocks.
  const legacyQuickAgentUiDisabled = false;

  const content = (
      <div
        ref={dialogRef}
        data-testid="launch-modal"
        className="palette launch-modal"
        role="dialog"
        aria-modal
        aria-label={mode === 'autonomous' ? 'New autonomous team' : 'New agent'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="launch-panel">
          <div className="launch-header">
            <div>
              <h3>
                {mode === 'thread'
                  ? (projectMode ? project!.name : 'New agent')
                  : projectMode ? project!.name : scratchIsTarget ? 'Quick agent' : target?.name ?? 'New agent'}
              </h3>
              <p>
                {mode === 'thread'
                  ? 'Start an agent'
                  : projectMode
                    ? 'Start a session'
                    : scratchIsTarget
                      ? 'A scratch Claude session in your workspace'
                      : 'Start a Claude session in this project'}
              </p>
            </div>
          </div>

          {mode !== 'thread' && anchorError && scratchIsTarget && (
            <div className="launch-error" role="alert">
              Couldn’t prepare the workspace: {anchorError}
            </div>
          )}

          {/* Everything between the header and the Send button scrolls as one
              region — the button itself stays pinned outside it (see
              .launch-scroll / .launch-actions in global.css) so a long Advanced
              section or extra-args panel can never push Send off-screen. */}
          <div className="launch-scroll">
          {/* Launch mode: Modern (HTTP conversation) and CLI Agent (PTY) are
              always offered. Autonomous Team only appears when teams exist. */}
          <div className="launch-row">
            <LaunchModeSegmented
              value={mode}
              onChange={setMode}
              showAutonomousTeam={teams.length > 0}
            />
          </div>

          {mode === 'thread' && (
            <div className="launch-thread-composer">
              <ThreadCommandComposer
                project={project}
                initialText={initialPrompt}
                onCreated={onClose}
              />
            </div>
          )}

          {mode === 'agent' && (
            <div className="launch-thread-composer">
              <LegacyAgentHomeComposer
                project={project}
                initialText={initialPrompt}
                onLaunched={onLaunched}
                onClose={onClose}
              />
            </div>
          )}

          {mode === 'agent' && projectMode && (
            <AgentConversationHistory projectId={project!.id} unavailableProviders={unavailableHistoryProviders} onResumed={onClose} />
          )}

          {mode === 'autonomous' && (
          <div className="launch-thread-composer">
            <AutonomousTeamComposer
              project={project}
              initialText={initialPrompt}
              onClose={onClose}
            />
          </div>
          )}

          {legacyQuickAgentUiDisabled && scratchIsTarget && !argPreset && !editor && (
            <div className="quick-prompt-chips" role="group" aria-label="Starter prompts">
              {(chipsExpanded ? presets : presets.slice(0, 2)).map((p) => (
                <span key={p.id} className="quick-prompt-chip-wrap">
                  <button
                    type="button"
                    className="quick-prompt-chip"
                    onClick={() => applyPreset(p)}
                    title={p.prompt}
                  >
                    {promptIcon(p.icon)}
                    <span>{p.label}</span>
                  </button>
                  <button
                    type="button"
                    className="quick-prompt-chip-edit"
                    onClick={() => setEditor({ mode: 'edit', prompt: p })}
                    title={p.source === 'builtin' ? 'Customize this built-in prompt' : 'Edit prompt'}
                    aria-label={`Edit ${p.label}`}
                  >
                    <Pencil size={11} />
                  </button>
                </span>
              ))}
              {!chipsExpanded && presets.length > 2 && (
                <button
                  type="button"
                  className="quick-prompt-chip quick-prompt-chip-more"
                  onClick={() => setChipsExpanded(true)}
                  title="Show more starter prompts"
                >
                  <ChevronRight size={12} />
                  <span>More</span>
                </button>
              )}
              {chipsExpanded && (
                <button
                  type="button"
                  className="quick-prompt-chip quick-prompt-chip-new"
                  onClick={() => setEditor({ mode: 'new' })}
                  title="Create a new quick prompt"
                >
                  <Plus size={12} />
                  <span>New</span>
                </button>
              )}
            </div>
          )}

          {legacyQuickAgentUiDisabled && editor && (
            <QuickPromptEditor
              initial={editor?.mode === 'edit' ? (editor as any).prompt : null}
              onSaved={() => setEditor(null)}
              onCancel={() => setEditor(null)}
            />
          )}

          {legacyQuickAgentUiDisabled && argPreset && (
            <WorkflowArgForm
              preset={argPreset!}
              values={argValues}
              onChange={(name, v) => setArgValues((prev) => ({ ...prev, [name]: v }))}
              onApply={applyArgForm}
              onInterview={interviewArgForm}
              onCancel={cancelArgForm}
            />
          )}

          {legacyQuickAgentUiDisabled && !projectMode && (
            <div className="launch-row">
              <span className="launch-row-label">Project</span>
              <div className="launch-folder">
                <Folder size={13} aria-hidden="true" />
                <PopoverPicklist
                  id="agent-launcher-project"
                  className="launch-folder-select"
                  value={targetProjectId ?? ''}
                  ariaLabel="Target project"
                  onChange={(nextProjectId) => setTargetProjectId(nextProjectId || null)}
                  placeholder="Quick project (scratch)"
                  searchPlaceholder="Search projects"
                  emptyHint="No matching projects"
                  minWidth={320}
                  options={[
                    { value: '', label: 'Quick project (scratch)' },
                    ...projectGroups.favorites.map((project) => ({ value: project.id, label: project.name, group: 'Favorites' })),
                    ...projectGroups.remote.map((project) => ({ value: project.id, label: project.name, group: 'Remote' })),
                    ...projectGroups.local.map((project) => ({ value: project.id, label: project.name, group: 'Local' }))
                  ]}
                />
              </div>
            </div>
          )}

          {mode === 'agent' && (
            <div className="launch-row">
              <span className="launch-row-label">Harness</span>
              {!configLoaded ? (
                <span className="launch-squad-hint" role="status">Loading harness default…</span>
              ) : (
              <div className="launch-harness-measure-wrap" ref={harnessMeasureWrapRef}>
                <div
                  className={`launch-segmented launch-segmented--harness${harnessCompact ? ' is-compact' : ''}`}
                  role="group"
                  aria-label="Launch harness"
                >
                  <button
                    type="button"
                    data-testid="launch-profile-default"
                    className={!profileChosen ? 'active' : ''}
                    onClick={() => {
                      setProfileChosen(false);
                      setYolo(false);
                    }}
                    aria-pressed={!profileChosen}
                    aria-label="Use configured default"
                    title={harnessCompact ? undefined : 'Use configured default'}
                  >
                    {!harnessCompact && <span className="launch-segmented-text">Default</span>}
                  </button>
                  {availableFamilies.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      data-testid={`launch-profile-${f.id}`}
                      className={profileChosen && family?.id === f.id ? 'active' : ''}
                      onClick={() => {
                        setFamilyId(f.id);
                        setProfileChosen(true);
                      }}
                      aria-pressed={profileChosen && family?.id === f.id}
                      aria-label={f.label}
                      title={harnessCompact ? undefined : f.label}
                    >
                      <span className={`tab-profile-icon profile-${f.base}`} aria-hidden="true">
                        {profileIcon(f.base)}
                      </span>
                      {!harnessCompact && <span className="launch-segmented-text">{f.label}</span>}
                    </button>
                  ))}
                </div>
                {/* Hidden mirror used only to measure the width the row would need
                    to show every full label — see the harnessCompact effect. */}
                <div
                  className="launch-segmented launch-segmented--measure"
                  aria-hidden="true"
                  ref={harnessMeasureRef}
                >
                  <button type="button" tabIndex={-1}>
                    <span className="launch-segmented-text">Default</span>
                  </button>
                  {availableFamilies.map((f) => (
                    <button key={f.id} type="button" tabIndex={-1}>
                      <span className={`tab-profile-icon profile-${f.base}`} aria-hidden="true">
                        {profileIcon(f.base)}
                      </span>
                      <span className="launch-segmented-text">{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              )}
            </div>
          )}
          {launchStatus && (mode === 'agent' || launchError) && (
            launchError ? (
              <div {...launchStatusA11y.status} className="launch-error">
                <span className="launch-error-text">{launchStatus}</span>
                <button
                  type="button"
                  className="launch-error-fix-btn"
                  onClick={() => void fixWithAi()}
                  disabled={fixingWithAi || !target}
                  title="Spawn an agent to diagnose and fix this error"
                >
                  {fixingWithAi ? 'Fixing…' : 'Fix with AI'}
                </button>
              </div>
            ) : (
              <p {...launchStatusA11y.status} className="launch-advanced-hint">
                {launchStatus}
              </p>
            )
          )}

          {mode === 'agent' && (
            <div className="launch-row">
              <span className="launch-row-label">Mode</span>
              <div className="launch-segmented" role="group" aria-label="Permission mode">
                <button
                  type="button"
                  data-testid="launch-mode-normal"
                  className={!yoloActive ? 'active' : ''}
                  onClick={() => {
                    setYolo(false);
                    setProfileChosen(true);
                  }}
                  aria-pressed={!yoloActive}
                >
                  Normal
                </button>
                <button
                  type="button"
                  data-testid="launch-mode-yolo"
                  className={yoloActive ? 'active' : ''}
                  onClick={() => {
                    setYolo(true);
                    setProfileChosen(true);
                  }}
                  aria-pressed={yoloActive}
                  // PI exposes no permission-bypass flag, so Yolo is unavailable
                  // for it (only `--approve` for trusting project files, which is
                  // not a bypass). The toggle is disabled with an explanatory hint.
                  disabled={!family?.yolo}
                  title={
                    family?.yolo
                      ? 'Launch with permissions bypassed (auto-approve every action)'
                      : `${family?.label ?? 'This harness'} has no permission-bypass mode`
                  }
                >
                  <span className="tab-profile-icon" aria-hidden="true">
                    <Zap size={13} />
                  </span>
                  Yolo
                </button>
              </div>
            </div>
          )}

          {mode === 'agent' && (
            <button
              type="button"
              className="launch-advanced-toggle"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              aria-controls="agent-launcher-advanced"
            >
              {advanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>Customize launch</span>
              {!advanced && customizationCount > 0 && (
                <span className="launch-advanced-badge" aria-hidden="true">
                  {customizationCount}
                </span>
              )}
            </button>
          )}

          {mode === 'agent' && advanced && (
            <div id="agent-launcher-advanced" className="launch-advanced">
              {!profileChosen && selectedHarnessDescriptor?.id !== 'opencode' && (
                <div className="launch-routing-defaults" data-testid="launch-portable-routing">
                  <span className="launch-routing-defaults-label">Launch defaults</span>
                  <div className="launch-routing-defaults-fields">
                    <label className="launch-routing-defaults-field" htmlFor="launch-model-level">
                      <span>Model level</span>
                      <PopoverPicklist
                        id="launch-model-level"
                        className="launch-folder-select"
                        value={portableRouting.modelLevel ?? ''}
                        ariaLabel="Model level"
                        searchable={false}
                        onChange={(modelLevel) => {
                          setAgentRoutingDirty(true);
                          setPortableRouting((current) => ({
                            ...current,
                            modelLevel: (modelLevel || undefined) as LauncherRouting['modelLevel']
                          }));
                        }}
                        options={[
                          { value: '', label: 'Use configured default' },
                          ...PORTABLE_MODEL_LEVELS.map((option) => ({ value: option.id, label: option.label }))
                        ]}
                      />
                    </label>
                    <label className="launch-routing-defaults-field" htmlFor="launch-execution-state">
                      <span>Execution state</span>
                      <PopoverPicklist
                        id="launch-execution-state"
                        className="launch-folder-select"
                        value={portableRouting.executionState ?? ''}
                        ariaLabel="Execution state"
                        searchable={false}
                        onChange={(executionState) => {
                          setAgentRoutingDirty(true);
                          setPortableRouting((current) => ({
                            ...current,
                            executionState: (executionState || undefined) as LauncherRouting['executionState']
                          }));
                        }}
                        options={[
                          { value: '', label: 'Use configured default' },
                          ...PORTABLE_EXECUTION_STATES.map((option) => ({ value: option.id, label: option.label }))
                        ]}
                      />
                    </label>
                  </div>
                </div>
              )}

              {profileChosen && selectedHarnessDescriptor && (
                <div className="launch-native-routing" data-testid="launch-native-routing">
                  <span className="launch-native-routing-label">Harness settings</span>
                  <div className="launch-native-routing-fields">
                    <NativeAgentRoutingFields
                      descriptor={selectedHarnessDescriptor}
                      routing={selectedNativeRouting}
                      agentDiscovery={openCodeAgentDiscovery}
                      onRefreshAgentDescriptors={() => {
                        if (openCodeAgentDiscoveryProjectId && openCodeAgentDiscoveryProfile) {
                          setOpenCodeAgentDiscoverySnapshot({
                            projectId: openCodeAgentDiscoveryProjectId,
                            profile: openCodeAgentDiscoveryProfile,
                            discovery: { status: 'loading' }
                          });
                        }
                        setAgentDescriptorsRefresh((value) => value + 1);
                      }}
                      onChange={(patch) => updateNativeRouting(family!.id, patch)}
                    />
                  </div>
                </div>
              )}

              {family && (
                <div className="launch-extra-args" id="agent-launcher-extra-args">
                  <TextArgsField
                    key={family.id}
                    label="Extra args"
                    values={extraArgsFor(family.id)}
                    placeholder="--plugin-dir /path/to/plugin"
                    onChange={(vals) => setExtraArgsForFamily(family.id, vals)}
                  />
                </div>
              )}

              {worktreeStructurallyEligible && (
                <div className="launch-row launch-row-top">
                  <span className="launch-row-label">
                    <GitBranch size={12} aria-hidden="true" /> Workspace
                  </span>
                  <div className="launch-worktree-control">
                    <EnvironmentPicker
                      projectId={target!.id}
                      value={workspace}
                      onChange={(next) => {
                        worktreeTouched.current = true;
                        setWorkspace(next);
                        if (next.kind !== 'worktree') setWorktreeNameInvalid(false);
                      }}
                    />
                    {workspace.kind === 'worktree' && (
                      <label className={`launch-worktree-name${worktreeNameInvalid ? ' invalid' : ''}`}>
                        <span>Name</span>
                        <input
                          ref={worktreeNameRef}
                          value={worktreeName}
                          onChange={(event) => {
                            worktreeNameTouched.current = true;
                            const next = normalizeWorktreeNameInput(event.target.value);
                            setWorktreeName(next);
                            if (normalizeWorktreeName(next)) setWorktreeNameInvalid(false);
                          }}
                          onBlur={() => setWorktreeName((current) => normalizeWorktreeName(current))}
                          aria-invalid={worktreeNameInvalid || undefined}
                          aria-describedby="launch-worktree-name-hint"
                          autoComplete="off"
                        />
                        <span
                          id="launch-worktree-name-hint"
                          className="launch-worktree-name-hint"
                          role={worktreeNameInvalid ? 'alert' : undefined}
                        >
                          {worktreeNameInvalid
                            ? 'Worktree name required.'
                            : 'Used for branch and checkout directory.'}
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              )}

              <div className="launch-row launch-row-top">
                <span className="launch-row-label">
                  <Blocks size={12} aria-hidden="true" /> Framework
                </span>
                <div className="launch-personas" role="group" aria-label="Framework presets (multi-select)">
                  <button
                    type="button"
                    className={frameworkIds.length === 0 ? 'launch-persona active' : 'launch-persona'}
                    onClick={() => setFrameworkIds([])}
                    aria-pressed={frameworkIds.length === 0}
                    title="No framework primer"
                  >
                    None
                  </button>
                  {frameworks.map((fw) => {
                    const Icon = resolveIcon(fw.preset.icon ?? 'Blocks');
                    const label = fw.preset.label ?? fw.title;
                    const selected = frameworkIds.includes(fw.id);
                    return (
                      <button
                        key={fw.id}
                        type="button"
                        className={selected ? 'launch-persona active' : 'launch-persona'}
                        onClick={() => toggleFramework(fw)}
                        aria-pressed={selected}
                        title={fw.preset.description ?? `Inject ${label}'s framework primer`}
                      >
                        <span className="tab-profile-icon" aria-hidden="true">
                          <Icon size={11} />
                        </span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {frameworks.length === 0 && (
                <p className="launch-advanced-hint">
                  No framework presets installed. An extension can contribute one via its
                  manifest’s <code>agentPreset</code> block.
                </p>
              )}

              {personas.length > 0 && (
                <div className="launch-row launch-row-top">
                  <span className="launch-row-label">
                    <UserCog size={12} aria-hidden="true" /> Persona
                  </span>
                  <div className="launch-personas" role="group" aria-label="Persona">
                    <button
                      type="button"
                      className={personaId === null ? 'launch-persona active' : 'launch-persona'}
                      onClick={() => setPersonaId(null)}
                      aria-pressed={personaId === null}
                      title="Launch the bare profile, no persona"
                    >
                      None
                    </button>
                    {personas.map((p) => {
                      // Project mode wraps each persona with a star to pin it as
                      // the project's default (one-click "+" / ⌘T). Scratch mode
                      // has no project to pin against, so it's a plain button.
                      if (projectMode) {
                        const isDefault = defaultPersonaId === p.id;
                        return (
                          <span
                            key={p.id}
                            className={`launch-persona-wrap ${personaId === p.id ? 'active' : ''}`}
                          >
                            <button
                              type="button"
                              className="launch-persona"
                              onClick={() => choosePersona(p)}
                              aria-pressed={personaId === p.id}
                              title={p.description ?? p.name}
                            >
                              <span className="tab-profile-icon" aria-hidden="true">
                                {personaIcon(p)}
                              </span>
                              {p.name}
                            </button>
                            <button
                              type="button"
                              className={`launch-persona-star ${isDefault ? 'is-default' : ''}`}
                              onClick={() => toggleDefaultPersona(p.id)}
                              aria-pressed={isDefault}
                              title={
                                isDefault
                                  ? 'Default for this project — one-click "+" / ⌘T launches it. Click to clear.'
                                  : 'Set as this project’s default (one-click "+" / ⌘T)'
                              }
                            >
                              <Star size={11} fill={isDefault ? 'currentColor' : 'none'} />
                            </button>
                          </span>
                        );
                      }
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={personaId === p.id ? 'launch-persona active' : 'launch-persona'}
                          onClick={() => choosePersona(p)}
                          aria-pressed={personaId === p.id}
                          title={p.description ?? p.name}
                        >
                          <span className="tab-profile-icon" aria-hidden="true">
                            {personaIcon(p)}
                          </span>
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="launch-row launch-row-top">
                <span className="launch-row-label">
                  <ShieldCheck size={12} aria-hidden="true" /> Isolation
                </span>
                <div className="launch-personas" role="group" aria-label="Execution environment">
                  <button
                    type="button"
                    className={envChoice === 'off' ? 'launch-persona active' : 'launch-persona'}
                    onClick={() => setEnvChoice('off')}
                    aria-pressed={envChoice === 'off'}
                    title="Run the agent normally (no OS-level containment)"
                  >
                    Off
                  </button>
                  {microVmOffered && (
                    <button
                      type="button"
                      className={envChoice === 'microvm' ? 'launch-persona active' : 'launch-persona'}
                      onClick={() => microVmSelectable && setEnvChoice('microvm')}
                      aria-pressed={envChoice === 'microvm'}
                      disabled={!microVmSelectable}
                      title={
                        microVmSelectable
                          ? 'Run the agent inside a hardware-isolated microVM (microsandbox / libkrun): a separate guest OS with the workspace bind-mounted. Fails closed with a visible notice if the runtime is unavailable — never a silent downgrade.'
                          : microVmSupported === false
                            ? 'microVM isolation needs Apple Silicon / KVM / WHP — unsupported on this hardware.'
                            : 'Checking microVM support…'
                      }
                    >
                      <span className="tab-profile-icon" aria-hidden="true">
                        <Boxes size={11} />
                      </span>
                      microVM
                    </button>
                  )}
                </div>
              </div>
              {envChoice === 'microvm' && (
                <p className="launch-advanced-hint">
                  Boots a hardware-isolated microVM (microsandbox) with your workspace
                  bind-mounted; the agent and everything it spawns live inside the guest.
                  Cold start pulls the image the first time. If the runtime can’t start, the
                  launch fails with a visible notice rather than silently running unconfined.
                </p>
              )}
            </div>
          )}

          {bg.length > 0 && (
            <div className="launch-background">
              <div className="launch-section-label">
                <TerminalIcon size={12} aria-hidden /> Still running ({bg.length})
              </div>
              <div className="launch-bg-list">
                {bg.map((t) => (
                  <button
                    key={t.id}
                    className="launch-bg-row"
                    title={`Resume ${t.title} · ${t.profile}`}
                    onClick={() => resumeBackground(t.id)}
                  >
                    <span className={`tab-profile-icon profile-${t.profile}`} aria-hidden="true">
                      {profileIcon(t.profile)}
                    </span>
                    <span className="launch-bg-title">{t.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {projectMode && <AgentConversationHistory projectId={project!.id} unavailableProviders={unavailableHistoryProviders} onResumed={onClose} />}
          </div>
        </div>
      </div>
  );

  return createPortal(
    <div className="palette-backdrop" onMouseDown={onClose}>
      {content}
    </div>,
    document.body
  );
});
