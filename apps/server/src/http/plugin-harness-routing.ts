/**
 * Host side of `sdk.threads.spawn({ harness: 'project-default' })` routing:
 * the spawn's harness (the plugin's chosen harness, else the project's
 * effective default) is resolved by `resolvePluginSpawnProvider`; this applies
 * that harness's AI-harness overrides (plugin row, else Global → Project), via
 * the same launch resolvers a CLI Agent launch uses. Main-trusted state only —
 * plugin overrides are validated and stored by the host (Rule 1).
 */
import { PluginHarnessOverrideSchema } from '@zana-ai/zcc-contracts/project-settings';
import type {
  AppConfig,
  EffectiveHarnessDefaultResult,
  HarnessFamily,
  LaunchProfileId,
  PluginHarnessOverrideV1,
  Project,
  ProjectSettings
} from '@zana-ai/zcc-domain/product';
import type { HarnessAdapterDescriptor, HarnessScope } from '@zana-ai/zcc-domain/harness-adapter';
import { threadProviderIdForHarnessFamily } from '@zana-ai/zcc-domain/launch-provider';
import type { LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { providerForFamily } from '@zana-ai/zcc-host-daemon/harness/registry';
import {
  resolveExecutionState,
  resolveModelTarget,
  resolveRoleTarget
} from '@zana-ai/zcc-host-daemon/harness/target-resolution';
import { harnessDescriptors, harnessVerify } from './harness-via-rpc.js';
import {
  bridgeLaunchForProvider,
  getThreadProvider,
  type ThreadProviderRecord
} from '../services/threads/thread-provider-catalog.js';
import { validateProviderModelSelection } from '../services/threads/provider-model-validation.js';
import type { ProductHttpContext } from './product-context.js';
import { ThreadCreateError } from './thread-create.js';
import { resolvePluginThreadRouting, type PluginThreadRouting } from './plugin-thread-routing.js';
import { PluginSpawnHarnessError } from './plugin-thread-spawn.js';

export type PluginHarnessRoutingCtx = Pick<
  ProductHttpContext,
  'toProjects' | 'projectSettings' | 'config' | 'hostHub' | 'modelCatalogs' | 'pluginHostArtifacts'
>;

function threadProviderLabel(provider: Pick<ThreadProviderRecord, 'id' | 'displayName'> | undefined, fallback: string): string {
  return provider?.displayName?.trim() || fallback;
}

function scopeFor(project: Project | undefined): HarnessScope {
  return project?.remote ? 'remote' : 'local';
}

/** Session modes of a thread provider on the project's host, read only when needed. */
function acpModeReader(
  ctx: Pick<PluginHarnessRoutingCtx, 'modelCatalogs' | 'hostHub' | 'pluginHostArtifacts'>,
  providerId: string,
  project: Project | undefined,
  hostId: string | undefined
) {
  return async () => {
    const provider = getThreadProvider(providerId);
    const catalog = await ctx.modelCatalogs.read({
      hostId: ctx.hostHub.resolveHostId(hostId ?? project?.hostId),
      providerId,
      scope: provider?.models?.scope ?? 'workspace',
      bridgeLaunch: bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts),
      ...(project?.path && !project.remote ? { cwd: project.path } : {})
    });
    return catalog.acpMode?.options ?? [];
  };
}

/**
 * The overrides a plugin spawn applies, or `null` when it does not opt in.
 * Only `harness: 'project-default'` opts in; an explicit `providerId` spawn
 * keeps its existing behavior (no harness overrides).
 */
export async function productPluginSpawnRouting(
  ctx: PluginHarnessRoutingCtx,
  args: {
    projectId: string;
    hostId?: string;
    providerId: string;
    harness?: { family: HarnessFamily; profile: LaunchProfileId };
    /** Host-bound id of the spawning plugin; selects its own overrides. */
    pluginId?: string;
    /** Test seam. */
    provider?: LaunchProvider;
  }
): Promise<PluginThreadRouting | null> {
  if (!args.harness) return null;
  const { family, profile } = args.harness;
  const projects = ctx.toProjects();
  const project = projects.find((row) => row.id === args.projectId);
  const threadProvider = getThreadProvider(args.providerId);
  const pluginRow = args.pluginId
    ? pluginOverrideRow(ctx, args.pluginId, project, projects, family)
    : undefined;
  const base = {
    family,
    profile,
    providerLabel: threadProviderLabel(threadProvider, args.providerId),
    scope: scopeFor(project),
    permissionModes: threadProvider?.capabilities.permissionModes ?? [],
    ...(threadProvider?.composerActions ? { composerActions: threadProvider.composerActions } : {}),
    acpModeOptions: acpModeReader(ctx, args.providerId, project, args.hostId),
    ...(args.provider ? { provider: args.provider } : {})
  };
  if (!pluginRow) {
    return resolvePluginThreadRouting({
      ...base,
      config: ctx.config.getConfig(),
      ...(project ? { projectSettings: ctx.projectSettings.get(project.id) as ProjectSettings } : {})
    });
  }
  // The plugin's row replaces the inherited Project → Global chain for this
  // family as a whole value: no field from inherited settings is merged in.
  try {
    const routing = await resolvePluginThreadRouting({
      ...base,
      config: { harnessRouting: { schemaVersion: 1, byAdapter: { [family]: pluginRow } } } as unknown as AppConfig
    });
    return { ...routing, applied: routing.applied.map((entry) => ({ ...entry, source: 'plugin' })) };
  } catch (error) {
    if (!(error instanceof PluginSpawnHarnessError)) throw error;
    throw new PluginSpawnHarnessError(error.message.replace(
      /Change it in Settings → AI Harness\.$/,
      "Change it in this plugin's AI Harness settings."
    ));
  }
}

type PluginOverrideStores = Pick<PluginHarnessRoutingCtx, 'projectSettings' | 'config'>;

/**
 * The plugin's stored overrides, narrowest scope first: Project → Default
 * Project → Global for a project spawn, or Default Project → Global when the
 * spawn targets the Default Project itself or no registered project.
 */
export function pluginOverrideChain(
  ctx: PluginOverrideStores,
  pluginId: string,
  project: Project | undefined,
  projects: readonly Project[]
): PluginHarnessOverrideV1[] {
  const defaultProject = projects.find((row) => row.quickAgent);
  const chain = [project && !project.quickAgent ? project : undefined, defaultProject]
    .filter((row): row is Project => !!row)
    .map((row) => ctx.projectSettings.getPluginHarnessRouting(row.id, pluginId));
  chain.push(ctx.config.getPluginHarnessRouting(pluginId));
  return chain.filter((value): value is PluginHarnessOverrideV1 => !!value);
}

/**
 * The plugin's row for `family` from the narrowest scope that sets one. A row
 * is a whole value: fields are never merged across scopes.
 */
export function pluginOverrideRow(
  ctx: PluginOverrideStores,
  pluginId: string,
  project: Project | undefined,
  projects: readonly Project[],
  family: HarnessFamily
): NonNullable<PluginHarnessOverrideV1['byAdapter'][HarnessFamily]> | undefined {
  return pluginOverrideChain(ctx, pluginId, project, projects).find((value) => value.byAdapter[family])?.byAdapter[family];
}

/** The harness the plugin chose, from the narrowest scope that sets one. */
export function pluginDefaultHarness(
  ctx: PluginOverrideStores,
  pluginId: string,
  project: Project | undefined,
  projects: readonly Project[]
): HarnessFamily | undefined {
  return pluginOverrideChain(ctx, pluginId, project, projects).find((value) => value.defaultHarness)?.defaultHarness;
}

/**
 * The harness a `harness: 'project-default'` plugin spawn runs on: the
 * plugin's chosen harness when it is installed and enabled on the host,
 * otherwise `fallback` (the project's effective default).
 */
export async function pluginEffectiveHarnessDefault(
  ctx: Pick<PluginHarnessRoutingCtx, 'toProjects' | 'projectSettings' | 'config' | 'hostHub'>,
  args: { pluginId: string; projectId: string; hostId?: string },
  fallback: () => Promise<EffectiveHarnessDefaultResult>,
  /** Test seam. */
  providerOf: (family: HarnessFamily) => LaunchProvider | undefined = providerForFamily
): Promise<EffectiveHarnessDefaultResult> {
  const projects = ctx.toProjects();
  const project = projects.find((row) => row.id === args.projectId);
  const family = pluginDefaultHarness(ctx, args.pluginId, project, projects);
  if (!family) return fallback();
  const provider = providerOf(family);
  if (!provider) {
    return { ok: false, code: 'UNAVAILABLE_DEFAULT', message: `this plugin's harness (${family}) is not registered` };
  }
  const availability = await harnessVerify(ctx.hostHub, args.hostId ?? project?.hostId);
  const status = availability.find((row) => row.family === family);
  if (!status?.installed || !status.enabled) {
    return { ok: false, code: 'UNAVAILABLE_DEFAULT', message: `this plugin's harness (${family}) is disabled or unavailable` };
  }
  return {
    ok: true,
    family,
    profile: (provider.adapter.descriptor.defaultProfileId ?? family) as LaunchProfileId,
    source: 'plugin-override'
  };
}

// ── Plugin-keyed overrides (`zcc.sdk.harnessRouting`) ─────────────────────
// A plugin reads/writes only its own override; the host binds `pluginId`.
// Every value is re-validated here before it is stored (Rule 1).

export type HarnessOverrideScope =
  | { kind: 'global' }
  | { kind: 'default-project' }
  | { kind: 'project'; projectId: string };

export type HarnessRoutingCheckResult = { ok: true } | { ok: false; reason: string };

export type PluginHarnessOverrideCtx = Pick<
  ProductHttpContext,
  'toProjects' | 'projectSettings' | 'config' | 'hostHub' | 'modelCatalogs' | 'pluginHostArtifacts'
>;

type PluginHarnessCheckCtx = Pick<PluginHarnessOverrideCtx, 'toProjects' | 'config' | 'hostHub' | 'modelCatalogs' | 'pluginHostArtifacts'>;

const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,199}$/;

type ResolvedScope = { kind: 'global' } | { kind: 'project'; project: Project };

function assertPluginId(pluginId: string): void {
  if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) throw new Error('invalid plugin id');
}

/** Resolve a plugin-supplied scope against registered projects; unknown ids are rejected. */
function resolveScope(ctx: Pick<PluginHarnessOverrideCtx, 'toProjects'>, scope: HarnessOverrideScope): ResolvedScope {
  if (!scope || typeof scope !== 'object') throw new Error('invalid harness override scope');
  if (scope.kind === 'global') return { kind: 'global' };
  const projects = ctx.toProjects();
  if (scope.kind === 'default-project') {
    const project = projects.find((row) => row.quickAgent);
    if (!project) throw new Error('no Default Project is registered');
    return { kind: 'project', project };
  }
  if (scope.kind === 'project') {
    const project = typeof scope.projectId === 'string' ? projects.find((row) => row.id === scope.projectId) : undefined;
    if (!project) throw new Error('unknown project');
    return { kind: 'project', project };
  }
  throw new Error('invalid harness override scope');
}

/** Renderer-safe per-family descriptors for the project's host (or the given/local host). */
export async function pluginHarnessDescriptors(
  ctx: Pick<PluginHarnessOverrideCtx, 'toProjects' | 'hostHub'>,
  input: { projectId?: string; hostId?: string } = {}
): Promise<HarnessAdapterDescriptor[]> {
  const project = input.projectId ? resolveScope(ctx, { kind: 'project', projectId: input.projectId }) : undefined;
  const hostId = typeof input.hostId === 'string' ? input.hostId : undefined;
  return harnessDescriptors(ctx.hostHub, hostId ?? (project?.kind === 'project' ? project.project.hostId : undefined));
}

/**
 * What a plugin spawn would run for one stored row, checked against the
 * thread provider: the thread-honorable subset, then the resolved model
 * against that provider's live model catalog. Returns a rejection reason, or
 * `null` when it passes or cannot be checked now (thread provider not loaded,
 * host or catalog unreachable); the spawn re-checks either way.
 */
async function checkThreadRow(
  ctx: PluginHarnessCheckCtx,
  family: HarnessFamily,
  profile: LaunchProfileId,
  entry: NonNullable<PluginHarnessOverrideV1['byAdapter'][HarnessFamily]>,
  project: Project | undefined,
  provider: LaunchProvider
): Promise<string | null> {
  const providerId = threadProviderIdForHarnessFamily(family);
  const threadProvider = providerId ? getThreadProvider(providerId) : undefined;
  if (!providerId || !threadProvider) return null;
  try {
    const routing = await resolvePluginThreadRouting({
      family,
      profile,
      providerLabel: threadProviderLabel(threadProvider, providerId),
      config: { harnessRouting: { schemaVersion: 1, byAdapter: { [family]: entry } } } as unknown as AppConfig,
      scope: scopeFor(project),
      permissionModes: threadProvider.capabilities.permissionModes ?? [],
      ...(threadProvider.composerActions ? { composerActions: threadProvider.composerActions } : {}),
      acpModeOptions: acpModeReader(ctx, providerId, project, undefined),
      provider
    });
    if (routing.model) {
      await validateProviderModelSelection(ctx, {
        hostId: ctx.hostHub.resolveHostId(project?.hostId),
        providerId,
        model: routing.model,
        ...(project?.path && !project.remote ? { cwd: project.path } : {})
      });
    }
    return null;
  } catch (error) {
    if (error instanceof PluginSpawnHarnessError) return error.message.replace(/ Change it in Settings → AI Harness\.$/, '');
    if (error instanceof ThreadCreateError) return error.message;
    return null;
  }
}

/**
 * Save-time validation: shape, the chosen harness, then every adapter entry
 * through the same resolvers a launch uses and the thread provider's model
 * catalog, so a stored override cannot name an unknown harness,
 * provider/model/role, an unsupported execution state or combination, or a
 * model the thread provider does not offer.
 */
export async function checkPluginHarnessRouting(
  ctx: PluginHarnessCheckCtx,
  scope: HarnessOverrideScope,
  value: unknown,
  /** Test seam. */
  providerOf: (family: HarnessFamily) => LaunchProvider | undefined = providerForFamily
): Promise<HarnessRoutingCheckResult> {
  let resolved: ResolvedScope;
  try {
    resolved = resolveScope(ctx, scope);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const parsed = PluginHarnessOverrideSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, reason: `invalid harness routing: ${path}${issue?.message ?? 'bad shape'}` };
  }
  const chosen = parsed.data.defaultHarness;
  if (chosen && (!providerOf(chosen) || !threadProviderIdForHarnessFamily(chosen))) {
    return { ok: false, reason: `${chosen}: this harness cannot run plugin agents` };
  }
  const project = resolved.kind === 'project' ? resolved.project : undefined;
  const harnessScope = scopeFor(project);
  for (const [family, entry] of Object.entries(parsed.data.byAdapter) as [HarnessFamily, NonNullable<PluginHarnessOverrideV1['byAdapter'][HarnessFamily]>][]) {
    if (!entry) continue;
    const provider = providerOf(family);
    if (!provider) return { ok: false, reason: `${family}: unknown harness` };
    const profile = (provider.adapter.descriptor.defaultProfileId ?? family) as LaunchProfileId;
    const input = {
      config: { harnessRouting: { schemaVersion: 1, byAdapter: { [family]: entry } } } as unknown as AppConfig,
      profile,
      extraArgs: [] as string[],
      scope: harnessScope
    };
    try {
      const role = resolveRoleTarget(provider, input);
      resolveModelTarget(provider, input);
      const execution = resolveExecutionState(provider, input);
      // Launch reads `executionTargetId` only from per-tab routing, so check a
      // stored target exists the same way rather than persisting a dead id.
      if (entry.executionTargetId) {
        resolveExecutionState(provider, {
          ...input,
          perTabRouting: { schemaVersion: 1, byAdapter: { [family]: { executionTargetId: entry.executionTargetId } } }
        });
      }
      const combination = provider.validateRoutingCombination?.({
        roleTargetId: role.targetId,
        executionOrigin: execution.origin,
        executionTargetId: execution.targetId
      });
      if (combination) return { ok: false, reason: `${family}: ${combination}` };
    } catch (error) {
      return { ok: false, reason: `${family}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const threadReason = await checkThreadRow(ctx, family, profile, entry, project, provider);
    if (threadReason) return { ok: false, reason: `${family}: ${threadReason}` };
  }
  return { ok: true };
}

export function readPluginHarnessRouting(
  ctx: PluginHarnessOverrideCtx,
  pluginId: string,
  scope: HarnessOverrideScope
): PluginHarnessOverrideV1 | null {
  assertPluginId(pluginId);
  const resolved = resolveScope(ctx, scope);
  return resolved.kind === 'global'
    ? ctx.config.getPluginHarnessRouting(pluginId)
    : ctx.projectSettings.getPluginHarnessRouting(resolved.project.id, pluginId);
}

/** Validate then persist (or clear with `null`) this plugin's override for `scope`. */
export async function writePluginHarnessRouting(
  ctx: PluginHarnessOverrideCtx,
  pluginId: string,
  scope: HarnessOverrideScope,
  value: PluginHarnessOverrideV1 | null,
  /** Test seam. */
  providerOf?: (family: HarnessFamily) => LaunchProvider | undefined
): Promise<void> {
  assertPluginId(pluginId);
  const resolved = resolveScope(ctx, scope);
  let stored: PluginHarnessOverrideV1 | null = null;
  if (value !== null) {
    const check = await checkPluginHarnessRouting(ctx, scope, value, providerOf);
    if (!check.ok) throw new Error(check.reason);
    stored = PluginHarnessOverrideSchema.parse(value) as PluginHarnessOverrideV1;
  }
  if (resolved.kind === 'global') ctx.config.setPluginHarnessRouting(pluginId, stored);
  else await ctx.projectSettings.setPluginHarnessRouting(resolved.project.id, pluginId, stored);
}
