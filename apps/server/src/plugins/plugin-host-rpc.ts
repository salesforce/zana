// Adapted from BB services/plugins/plugin-host-rpc.ts; see docs/third-party/BB-LICENSE.
import { randomUUID } from 'node:crypto';
import type { ProductHttpContext } from '../http/product-context.js';
import type { PluginHostArtifactSnapshot } from './plugin-host-artifact-registry.js';
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export async function callPluginHostRpc(ctx: ProductHttpContext, args: {
  pluginId: string; artifact: PluginHostArtifactSnapshot; method: string; input: unknown;
  hostId?: string; signal?: AbortSignal; timeoutMs?: number; projectRoot?: string;
}): Promise<unknown> {
  if (args.signal?.aborted) throw Object.assign(new Error('Host plugin call was cancelled'), { name: 'AbortError' });
  const encoded = JSON.stringify(args.input ?? null);
  if (Buffer.byteLength(encoded) > MAX_INPUT_BYTES) throw new Error('Host plugin input exceeds 8 MiB');
  const hostId = ctx.hostHub.resolveHostId(args.hostId);
  const callId = randomUUID(), timeoutMs = args.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error('Invalid plugin host deadline');
  const identity = { pluginId: args.pluginId, generation: args.artifact.generation, callId };
  const cancel = () => { void ctx.hostHub.callHostOnlineRpc({ hostId, timeoutMs: 6_000, command: { type: 'plugin.host.cancel', ...identity } }).catch(() => undefined); };
  args.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await ctx.hostHub.callHostOnlineRpc<{ output: unknown }>({ hostId, timeoutMs: timeoutMs + 6_000,
      command: { type: 'plugin.host.call', ...identity, method: args.method, input: JSON.parse(encoded), timeoutMs,
        artifact: { digest: args.artifact.digest, byteLength: args.artifact.byteLength },
        ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}) }
    });
    if (args.signal?.aborted) throw Object.assign(new Error('Host plugin call was cancelled'), { name: 'AbortError' });
    return result.output;
  } finally { args.signal?.removeEventListener('abort', cancel); }
}

export async function disposePluginHostWorkers(ctx: ProductHttpContext, pluginId: string, generation: string): Promise<void> {
  await Promise.allSettled(ctx.hostHub.connectedHostIds().map(hostId => ctx.hostHub.callHostOnlineRpc({
    hostId, timeoutMs: 6_000, command: { type: 'plugin.host.dispose', pluginId, generation }
  })));
}

export async function validatePluginHostValue(schema: unknown, value: unknown): Promise<unknown> {
  const standard = schema && typeof schema === 'object' ? (schema as { '~standard'?: { validate?: unknown } })['~standard'] : undefined;
  if (typeof standard?.validate !== 'function') throw new Error('Invalid plugin host method schema');
  const result = await standard.validate(value);
  if (result.issues) throw new Error(`Plugin host validation failed: ${result.issues.map((issue: { message: string }) => issue.message).join('; ')}`);
  return result.value;
}
