/**
 * Apply a project's AI-harness overrides (`HarnessModelRoutingV1`, plus the
 * legacy project fields the launch resolvers still read) to a plugin-spawned
 * thread.
 *
 * Precedence is the launch precedence: Global → Project. The values are resolved
 * by the same host-daemon resolvers a CLI Agent launch uses, then translated
 * onto the knobs a thread actually has (model, permission mode, ACP session
 * mode, `/plan`). A resolved override that a thread cannot honor rejects with
 * {@link PluginSpawnHarnessError}; nothing silently falls back.
 */
import type {
  AppConfig,
  HarnessFamily,
  LaunchProfileId,
  ProjectSettings
} from '@zana-ai/zcc-domain/product';
import type { HarnessScope } from '@zana-ai/zcc-domain/harness-adapter';
import { portableWorkIntent } from '@zana-ai/zcc-domain/thread-runtime';
import type { LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { providerFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import {
  resolveExecutionState,
  resolveModelTarget,
  resolveRoleTarget,
  type ExecutionResolution
} from '@zana-ai/zcc-host-daemon/harness/target-resolution';
import { PluginSpawnHarnessError, type PluginSpawnPermissionMode } from './plugin-thread-spawn.js';

export interface PluginThreadRoutingInput {
  family: HarnessFamily;
  /** Launch profile whose descriptor and posture govern resolution (e.g. the effective default's). */
  profile: LaunchProfileId;
  /** The thread provider the spawn runs on; used in messages only. */
  providerLabel: string;
  config: AppConfig;
  projectSettings?: ProjectSettings;
  scope: HarnessScope;
  /** The thread provider's supported permission modes. */
  permissionModes: readonly string[];
  /** The thread provider's composer actions (`plan` ⇒ slash `/plan`). */
  composerActions?: readonly string[];
  /** ACP session modes of the thread provider; read only when a role or plan needs them. */
  acpModeOptions(): Promise<readonly { value: string; name?: string }[]>;
  /** Test seam; defaults to the registered provider for `profile`. */
  provider?: LaunchProvider;
}

export type PluginThreadRoutingField = 'model' | 'role' | 'execution';

export interface PluginThreadRoutingApplied {
  field: PluginThreadRoutingField;
  /** Resolved native value (model id, role id, execution state or native policy). */
  value: string;
  source: string;
}

export interface PluginThreadRouting {
  model?: string;
  permissionMode?: PluginSpawnPermissionMode;
  acpMode?: string;
  /** Deliver the turn with a `/plan` command mention (slash-plan providers). */
  slashPlan?: boolean;
  applied: PluginThreadRoutingApplied[];
}

const SETTINGS_HINT = 'Change it in Settings → AI Harness.';

function sourceLabel(source: string): string {
  if (source === 'persona' || source === 'Persona') return 'persona';
  if (source === 'project' || source === 'Project') return 'project';
  return 'global';
}

function fail(input: Pick<PluginThreadRoutingInput, 'providerLabel'>, message: string): never {
  const sentence = /[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`;
  throw new PluginSpawnHarnessError(`${input.providerLabel} cannot apply the AI harness override: ${sentence} ${SETTINGS_HINT}`);
}

function resolve<T>(input: PluginThreadRoutingInput, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PluginSpawnHarnessError) throw error;
    fail(input, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Codex sandbox/approval → thread permission mode, using the thread bridge's
 * own mapping (accept-edits = workspace-write + on-request; full =
 * danger-full-access + never). Only those exact pairs map. A half-set policy
 * is rejected too: a launch leaves the other half to Codex's own config, while
 * a thread would pin both, so mapping it would silently change behavior.
 */
function permissionForNativePolicy(
  input: PluginThreadRoutingInput,
  policy: Readonly<Record<string, string>>
): PluginSpawnPermissionMode {
  const sandbox = policy.codexSandbox;
  const approval = policy.codexApproval;
  if (sandbox === 'workspace-write' && approval === 'on-request') return 'accept-edits';
  if (sandbox === 'danger-full-access' && approval === 'never') return 'full';
  const described = `sandbox ${sandbox ?? '(Codex default)'} + approval ${approval ?? '(Codex default)'}`;
  return fail(
    input,
    `${described} has no thread equivalent (threads run workspace-write + on-request or danger-full-access + never).`
  );
}

type ResolvedState = NonNullable<ExecutionResolution['state']>;

/**
 * Portable execution state → thread mode. `interactive` is applied as
 * accept-edits only when the harness maps both to the same native policy;
 * otherwise (Codex: workspace-write + untrusted) a thread cannot express it.
 */
function permissionForState(
  input: PluginThreadRoutingInput,
  provider: LaunchProvider,
  state: Exclude<ResolvedState, 'plan'>
): PluginSpawnPermissionMode {
  // DECISION(design-docs-ai-harness, 2026-10-13): an 'autonomous' override maps to
  // 'full' with no execution-consent step. CLI launches gate this through
  // preflightExecutionAuthorization (services/launch/execution-routing.ts); thread
  // creation, including plugin threads, runs no consent check and a hidden plugin
  // thread has no UI to prompt in. Accepted because the override is a setting the
  // user chose in Project settings and only plugins that opt in via
  // harness:'project-default' receive it. Revisit with the consent follow-up in
  // doc-vault zana/design-docs-ai-harness/proposal.md.
  if (state === 'autonomous') return 'full';
  // DECISION(design-docs-ai-harness, 2026-10-13): accept-edits is `acceptEdits` on a
  // thread, while the CLI passes no --permission-mode for Claude (native 'default'),
  // so a thread is slightly more permissive. Accepted; do not align.
  if (state === 'accept-edits') return 'accept-edits';
  const mapping = provider.adapter.descriptor.targets?.executionStateMapping;
  if (mapping?.interactive && mapping.interactive === mapping['accept-edits']) return 'accept-edits';
  return fail(input, `the interactive execution state (${mapping?.interactive ?? 'native'}) has no thread equivalent.`);
}

export async function resolvePluginThreadRouting(input: PluginThreadRoutingInput): Promise<PluginThreadRouting> {
  const provider = input.provider ?? providerFor(input.profile);
  const resolutionInput = {
    config: input.config,
    ...(input.projectSettings ? { projectSettings: input.projectSettings } : {}),
    profile: input.profile,
    // DECISION(design-docs-ai-harness, 2026-10-13): argv-only project fields (Claude
    // appendSystemPrompt, extraArgs, addDirs, allowed/deniedTools) are not applied to
    // threads and are not rejected either; threads have always ignored them.
    // Accepted as a thread-model gap, tracked in the proposal.
    extraArgs: [] as string[],
    scope: input.scope
  };
  const role = resolve(input, () => resolveRoleTarget(provider, resolutionInput));
  const model = resolve(input, () => resolveModelTarget(provider, resolutionInput));
  const execution = resolve(input, () => resolveExecutionState(provider, resolutionInput));
  const combination = provider.validateRoutingCombination?.({
    roleTargetId: role.targetId,
    executionOrigin: execution.origin,
    executionTargetId: execution.targetId
  });
  if (combination) fail(input, combination);

  const unrestricted = provider.adapter.descriptor.profiles
    .find((candidate) => candidate.id === input.profile)?.posture === 'unrestricted';
  const unmapped = provider.adapter.legacyRouting?.threadUnmappedFields?.(
    { config: input.config, ...(input.projectSettings ? { projectSettings: input.projectSettings } : {}), scope: input.scope },
    { unrestricted }
  ) ?? [];
  if (unmapped.length) {
    fail(input, `${unmapped.join(', ')} ${unmapped.length === 1 ? 'has' : 'have'} no thread equivalent.`);
  }

  const result: PluginThreadRouting = { applied: [] };
  let acpOptions: readonly { value: string; name?: string }[] | undefined;
  const readAcpOptions = async () => {
    acpOptions ??= await input.acpModeOptions();
    return acpOptions;
  };

  if (role.targetId) {
    const options = await readAcpOptions();
    if (!options.some((option) => option.value === role.targetId)) {
      fail(input, `native role ${role.targetId} is not one of this thread provider's session modes.`);
    }
    result.acpMode = role.targetId;
    result.applied.push({ field: 'role', value: role.targetId, source: sourceLabel(role.source) });
  }

  if (model.targetId && !(role.targetId && provider.nativeRolePinsModel)) {
    result.model = model.targetId;
    result.applied.push({ field: 'model', value: model.targetId, source: sourceLabel(model.source) });
  }

  if (unrestricted) {
    result.permissionMode = 'full';
  } else if (execution.nativePolicy && Object.keys(execution.nativePolicy).length) {
    result.permissionMode = permissionForNativePolicy(input, execution.nativePolicy);
    result.applied.push({
      field: 'execution',
      value: Object.values(execution.nativePolicy).join(' + '),
      source: sourceLabel(execution.source)
    });
  } else if (execution.state === 'plan') {
    const intent = portableWorkIntent({
      acpModeOptions: await readAcpOptions(),
      composerActions: input.composerActions ?? []
    });
    if (intent.planNativeValue) {
      if (result.acpMode && result.acpMode !== intent.planNativeValue) {
        fail(input, `native role ${result.acpMode} conflicts with the plan execution state.`);
      }
      result.acpMode = intent.planNativeValue;
    } else if (intent.usesSlashPlan) {
      result.slashPlan = true;
    } else {
      fail(input, 'the plan execution state is not supported by this thread provider.');
    }
    result.applied.push({ field: 'execution', value: 'plan', source: sourceLabel(execution.source) });
  } else if (execution.state) {
    result.permissionMode = permissionForState(input, provider, execution.state);
    result.applied.push({ field: 'execution', value: execution.state, source: sourceLabel(execution.source) });
  }

  if (result.permissionMode && !input.permissionModes.includes(result.permissionMode)) {
    fail(input, `the ${result.permissionMode} permission mode is not supported by this thread provider.`);
  }
  return result;
}

/** Prefix a prompt with a real `/plan` command mention, as the composer's Plan mode does. */
export function slashPlanPromptInput(prompt: string): {
  text: string;
  input: { type: 'text'; text: string; mentions: unknown[] };
} {
  const text = `/plan ${prompt}`;
  return {
    text,
    input: {
      type: 'text',
      text,
      mentions: [{
        start: 0,
        end: '/plan'.length,
        resource: {
          kind: 'command',
          trigger: '/',
          name: 'plan',
          source: 'command',
          origin: 'builtin',
          label: 'plan',
          argumentHint: null
        }
      }]
    }
  };
}
