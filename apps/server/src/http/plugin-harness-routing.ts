/**
 * Host side of `sdk.threads.spawn({ harness: 'project-default' })` routing:
 * the project's effective harness is resolved by `resolvePluginSpawnProvider`;
 * this applies that harness's AI-harness overrides (Global → Project), via the
 * same launch resolvers a CLI Agent launch uses. Main-trusted state only — the
 * plugin supplies no overrides (Rule 1).
 */
import type { HarnessFamily, LaunchProfileId, Project, ProjectSettings } from '@zana-ai/zcc-domain/product';
import type { HarnessScope } from '@zana-ai/zcc-domain/harness-adapter';
import type { LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import {
  bridgeLaunchForProvider,
  getThreadProvider,
  type ThreadProviderRecord
} from '../services/threads/thread-provider-catalog.js';
import type { ProductHttpContext } from './product-context.js';
import { resolvePluginThreadRouting, type PluginThreadRouting } from './plugin-thread-routing.js';

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
  ctx: PluginHarnessRoutingCtx,
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
    /** Test seam. */
    provider?: LaunchProvider;
  }
): Promise<PluginThreadRouting | null> {
  if (!args.harness) return null;
  const { family, profile } = args.harness;
  const project = ctx.toProjects().find((row) => row.id === args.projectId);
  const threadProvider = getThreadProvider(args.providerId);
  return resolvePluginThreadRouting({
    family,
    profile,
    providerLabel: threadProviderLabel(threadProvider, args.providerId),
    config: ctx.config.getConfig(),
    ...(project ? { projectSettings: ctx.projectSettings.get(project.id) as ProjectSettings } : {}),
    scope: scopeFor(project),
    permissionModes: threadProvider?.capabilities.permissionModes ?? [],
    ...(threadProvider?.composerActions ? { composerActions: threadProvider.composerActions } : {}),
    acpModeOptions: acpModeReader(ctx, args.providerId, project, args.hostId),
    ...(args.provider ? { provider: args.provider } : {})
  });
}
