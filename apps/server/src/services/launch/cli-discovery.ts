import { getEnvironment, getPrimaryHost, listHosts } from '@zana-ai/zcc-db';
import { projectSources } from '@zana-ai/zcc-domain/project';
import { CliDiscoveryRequestSchema, CliDiscoveryResultSchema, type CliDiscoveryRequest, type CliDiscoveryResult } from '@zana-ai/zcc-contracts/cli-discovery';
import type { ProductHttpContext } from '../../http/product-context.js';
import { resolveProjectHost } from '../../http/project-host.js';
import { BoundedKeyedQueue } from '../bounded-keyed-queue.js';
import { resolveHarnessWorkspacePath } from '../threads/remote-tool-proxy.js';
import { toRemoteStartPathHost } from '../hosts/host-public.js';

const queues = new WeakMap<ProductHttpContext, BoundedKeyedQueue>();

async function location(ctx: ProductHttpContext, request: CliDiscoveryRequest) {
  const project = ctx.toProjects().find(row => row.id === request.projectId);
  if (!project) throw new Error('CLI discovery requires a registered machine checkout');
  if (project.remote) {
    if (!project.hostId || (request.hostId && request.hostId !== project.hostId) || request.environmentId) {
      throw new Error('CLI discovery requires the registered remote host');
    }
    const hostId = resolveProjectHost(ctx, project.hostId);
    ctx.hostHub.ensureHostSessionReady(hostId);
    const root = await resolveHarnessWorkspacePath({
      project, remoteToolProxy: false,
      remoteDefaultPath: ctx.config.getConfig().remoteDefaultPath,
      hosts: listHosts(ctx.db).map(toRemoteStartPathHost),
      probeHostHome: async () => {
        const listing = await ctx.hostHub.callHostOnlineRpc<{ directory: string }>({
          hostId, command: { type: 'host.browse_directory' }
        });
        return listing.directory;
      }
    });
    return { hostId, root, sourcePath: root, cwd: request.cwd ?? root };
  }
  const primaryId = getPrimaryHost(ctx.db)?.id;
  const hostId = resolveProjectHost(ctx, request.hostId ?? project.hostId);
  const source = projectSources(project, primaryId).find(row => row.hostId === hostId);
  if (!source) throw new Error('No registered checkout on the selected machine');
  let root = source.path;
  if (request.environmentId) {
    const environment = getEnvironment(ctx.db, request.environmentId);
    if (!environment || environment.projectId !== project.id || environment.hostId !== hostId
      || environment.status !== 'ready' || !environment.path) {
      throw new Error('CLI environment is unavailable on the selected machine');
    }
    root = environment.path;
  }
  return { hostId, root, sourcePath: source.path, cwd: request.cwd ?? root };
}

/** Main retains consent/evidence decisions; the selected host owns discovery. */
export async function discoverProjectCli(ctx: ProductHttpContext, raw: unknown, deadline: number): Promise<CliDiscoveryResult> {
  const request = CliDiscoveryRequestSchema.parse(raw);
  const owner = await location(ctx, request);
  let queue = queues.get(ctx);
  if (!queue) {
    queue = new BoundedKeyedQueue(4, 100, 'CLI discovery is busy');
    queues.set(ctx, queue);
  }
  return queue.run(owner.hostId, async () => {
    const current = async () => {
      if (JSON.stringify(await location(ctx, request)) !== JSON.stringify(owner)) {
        throw new Error('CLI checkout changed during discovery');
      }
      ctx.hostHub.ensureHostSessionReady(owner.hostId);
    };
    await current();
    const timeoutMs = Math.min(18_000, deadline - Date.now());
    if (timeoutMs <= 0) throw new Error('CLI discovery timed out');
    const result = CliDiscoveryResultSchema.parse(await ctx.hostHub.callHostOnlineRpc({
      hostId: owner.hostId, timeoutMs,
      command: { type: 'provider.cli_discovery', root: owner.root, cwd: owner.cwd,
        profile: request.profile, query: request.query, nativeAgentDiscoveryEnabled: request.nativeAgentDiscoveryEnabled }
    }));
    await current();
    if (Date.now() >= deadline) throw new Error('CLI discovery timed out');
    if (result.query !== request.query) throw new Error('CLI discovery reply does not match the request');
    return result;
  });
}
