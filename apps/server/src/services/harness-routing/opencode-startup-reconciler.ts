import type { AppConfig, HarnessModelRoutingV1 } from '@zana-ai/zcc-domain/product';
import type { ConfigSnapshot } from '../config/config-store.js';
import { DurableWriteConflictError } from '../config/config-store.js';

export type OpenCodeStartupReconcileOutcome =
  | 'no-op'
  | 'remapped'
  | 'cleared-stale-model'
  | 'cleared-provider-only'
  | 'probe-unavailable'
  | 'cas-give-up';

export interface OpenCodeCatalogModel {
  id: string;
  provider?: string;
}

export interface OpenCodeStartupReconcileResult {
  outcome: OpenCodeStartupReconcileOutcome;
  config?: AppConfig;
}

export interface OpenCodeStartupReconcileDeps {
  snapshot(): ConfigSnapshot;
  replaceConfig(next: AppConfig, expectedHash: string | null): AppConfig;
  discoverLiveModels(input: { cwd: string; config: AppConfig }): Promise<readonly string[] | undefined>;
  catalogModels?: readonly OpenCodeCatalogModel[];
}

type OpenCodeRoute = NonNullable<HarnessModelRoutingV1['byAdapter']['opencode']>;

const AISUITE_PREFIX = 'aisuite/';
const LLMGW_PREFIX = 'llmgw/';

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function liveSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}

function renameCandidate(modelTargetId: string): string | undefined {
  if (!modelTargetId.startsWith(AISUITE_PREFIX)) return undefined;
  return `${LLMGW_PREFIX}${modelTargetId.slice(AISUITE_PREFIX.length)}`;
}

function providerForModel(
  modelTargetId: string,
  catalog: readonly OpenCodeCatalogModel[] | undefined
): string | undefined {
  return catalog?.find((entry) => entry.id === modelTargetId)?.provider;
}

function withOpenCodeRoute(config: AppConfig, nextRoute: OpenCodeRoute | undefined): AppConfig {
  const next = cloneConfig(config);
  const routing = next.harnessRouting ?? { schemaVersion: 1 as const, byAdapter: {} };
  const byAdapter = { ...routing.byAdapter };
  if (!nextRoute || Object.keys(nextRoute).length === 0) delete byAdapter.opencode;
  else byAdapter.opencode = nextRoute;
  if (Object.keys(byAdapter).length === 0) delete next.harnessRouting;
  else next.harnessRouting = { schemaVersion: 1, byAdapter };
  return next;
}

function sameRoute(left: OpenCodeRoute | undefined, right: OpenCodeRoute | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function projectOpenCodeStartupRoute(
  route: OpenCodeRoute | undefined,
  liveModels: readonly string[] | undefined,
  catalogModels?: readonly OpenCodeCatalogModel[]
): { outcome: Exclude<OpenCodeStartupReconcileOutcome, 'cas-give-up'>; route?: OpenCodeRoute } {
  if (!route) return { outcome: 'no-op' };
  if (!liveModels) return { outcome: 'probe-unavailable', route };

  const live = liveSet(liveModels);
  const next: OpenCodeRoute = { ...route };
  const hasRole = Boolean(route.roleTargetId);
  const hasModel = Boolean(route.modelTargetId);
  const hasProvider = Boolean(route.providerTargetId);

  if (hasRole && hasModel) return { outcome: 'no-op', route };

  if (hasModel && route.modelTargetId) {
    if (live.has(route.modelTargetId)) {
      const mappedProvider = providerForModel(route.modelTargetId, catalogModels);
      if (mappedProvider && next.providerTargetId && next.providerTargetId !== mappedProvider) {
        next.providerTargetId = mappedProvider;
        return { outcome: 'remapped', route: next };
      }
      if (!mappedProvider && next.providerTargetId && !hasRole) {
        delete next.providerTargetId;
        return sameRoute(route, next) ? { outcome: 'no-op', route } : { outcome: 'cleared-provider-only', route: next };
      }
      return { outcome: 'no-op', route };
    }

    if (hasRole) return { outcome: 'no-op', route };

    const candidate = renameCandidate(route.modelTargetId);
    if (candidate && live.has(candidate)) {
      next.modelTargetId = candidate;
      const mappedProvider = providerForModel(candidate, catalogModels);
      if (mappedProvider) next.providerTargetId = mappedProvider;
      else delete next.providerTargetId;
      return { outcome: 'remapped', route: next };
    }

    delete next.modelTargetId;
    delete next.providerTargetId;
    return { outcome: 'cleared-stale-model', route: next };
  }

  if (hasProvider && !hasModel) {
    delete next.providerTargetId;
    return { outcome: 'cleared-provider-only', route: next };
  }

  return { outcome: 'no-op', route };
}

export function selectOpenCodeProbeCwd(input: {
  lastProjectId?: string | null;
  projects: readonly { id: string; path: string; remote?: unknown }[];
  pathExists: (path: string) => boolean;
  ensureScratchRoot: () => string;
}): string {
  const locals = input.projects.filter((project) => !project.remote);
  const last = input.lastProjectId
    ? locals.find((project) => project.id === input.lastProjectId)
    : undefined;
  if (last && input.pathExists(last.path)) return last.path;
  const firstExisting = locals.find((project) => input.pathExists(project.path));
  if (firstExisting) return firstExisting.path;
  return input.ensureScratchRoot();
}

export async function reconcileOpenCodeStartupRouting(
  cwd: string,
  deps: OpenCodeStartupReconcileDeps
): Promise<OpenCodeStartupReconcileResult> {
  const attempt = async (snapshot: ConfigSnapshot): Promise<OpenCodeStartupReconcileResult> => {
    const liveModels = await deps.discoverLiveModels({ cwd, config: snapshot.config });
    const current = snapshot.config.harnessRouting?.byAdapter?.opencode;
    const projected = projectOpenCodeStartupRoute(current, liveModels, deps.catalogModels);
    if (
      projected.outcome === 'no-op'
      || projected.outcome === 'probe-unavailable'
      || sameRoute(current, projected.route)
    ) {
      return { outcome: projected.outcome, config: snapshot.config };
    }
    const next = withOpenCodeRoute(snapshot.config, projected.route);
    const config = deps.replaceConfig(next, snapshot.hash);
    return { outcome: projected.outcome, config };
  };

  try {
    return await attempt(deps.snapshot());
  } catch (error) {
    if (!(error instanceof DurableWriteConflictError)) throw error;
  }

  try {
    return await attempt(deps.snapshot());
  } catch (error) {
    if (error instanceof DurableWriteConflictError) return { outcome: 'cas-give-up' };
    throw error;
  }
}
