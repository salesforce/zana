import { z } from 'zod';
import { ClaudeCliProvider } from '@zana-ai/zcc-llm';
import { getHost } from '@zana-ai/zcc-db';
import type { PluginAssistantLocalModels, PluginAssistantModelChoice } from '@zana-ai/zcc-plugin-sdk/server';
import type { ProductHttpContext } from '../http/product-context.js';
import { getProviderReadiness } from '../http/provider-readiness-api.js';
import { overlayCustomModels } from '../services/threads/thread-execution-options.js';
import { bridgeLaunchForProvider, getThreadProvider } from '../services/threads/thread-provider-catalog.js';

const providerId = 'claude-code';
const choice = z.object({ providerId: z.string().min(1).max(256), modelId: z.string().min(1).max(512) }).strict();
const input = z
  .object({
    instructions: z.string().min(1).max(12_000),
    prompt: z.string().min(1).max(60_000),
    desktop: z.object({ model: choice.optional(), preferredDefault: choice.optional() }).strict().optional(),
    signal: z
      .custom<AbortSignal>(
        (v) =>
          v === undefined ||
          (typeof v === 'object' &&
            v !== null &&
            typeof (v as AbortSignal).throwIfAborted === 'function')
      )
      .optional()
  })
  .strict();
const active = new WeakMap<ProductHttpContext, number>();

async function desktopModels(ctx: ProductHttpContext, selected?: PluginAssistantModelChoice) {
  const hostId = ctx.desktopHostId?.();
  const unavailable = { defaultModel: null, models: [], hostId: null } as const;
  if (!hostId) return unavailable;
  const host = getHost(ctx.db, hostId);
  const provider = getThreadProvider(providerId);
  if (!host || host.destroyedAt || host.enrollmentCapability !== 'execution' || !provider || provider.unavailableReason) return unavailable;
  const readiness = await getProviderReadiness(ctx, providerId, hostId);
  if (readiness.hostId !== hostId || readiness.providerId !== providerId ||
    !readiness.result.supported || readiness.result.health.status !== 'ready') return unavailable;
  const catalog = await ctx.modelCatalogs.read({
    hostId,
    providerId,
    scope: provider.models?.scope ?? 'workspace',
    bridgeLaunch: bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts),
    ...(host.homeDir ? { cwd: host.homeDir } : {}),
    ...(selected?.providerId === providerId ? { requiredModel: selected.modelId } : {})
  });
  if (catalog.modelLoadError || ctx.desktopHostId?.() !== hostId || getThreadProvider(providerId) !== provider) return unavailable;
  const config = ctx.config.getConfig();
  const listed = overlayCustomModels(catalog, config, provider).models;
  const models = listed.map((model) => ({
    providerId,
    providerLabel: provider.displayName,
    modelId: model.model,
    modelLabel: model.displayName || model.model
  }));
  const defaultIndex = listed.findIndex((model) => model.isDefault);
  const defaultModel = !config.defaultThreadProviderId || config.defaultThreadProviderId === providerId
    ? models[Math.max(defaultIndex, 0)] ?? null : null;
  return { hostId, defaultModel, models };
}

export async function listDesktopAssistantModels(ctx: ProductHttpContext): Promise<PluginAssistantLocalModels> {
  try {
    const { defaultModel, models } = await desktopModels(ctx);
    return { defaultModel, models: [...models] };
  } catch {
    return { defaultModel: null, models: [] };
  }
}

/** A text-only helper, never a Project worker or a bearer of execution grants. */
export async function completePluginAssistant(
  ctx: ProductHttpContext,
  value: z.infer<typeof input>
): Promise<{ text: string }> {
  const args = input.parse(value);
  args.signal?.throwIfAborted();
  if ((active.get(ctx) || 0) >= 2) throw new Error('Assistant is busy; try again shortly');
  active.set(ctx, (active.get(ctx) || 0) + 1);
  try {
    const config = ctx.config.getConfig();
    let model = 'haiku';
    let binary = config.harnesses?.byId?.claude?.binary || config.claudeBinary || 'claude';
    if (args.desktop) {
      const selected = args.desktop.model;
      const local = await desktopModels(ctx, selected);
      args.signal?.throwIfAborted();
      const preferred = args.desktop.preferredDefault;
      const remembered = preferred && preferred.providerId === local.defaultModel?.providerId
        ? local.models.find((entry) => entry.providerId === preferred.providerId && entry.modelId === preferred.modelId)
        : undefined;
      const target = selected
        ? local.models.find((entry) => entry.providerId === selected.providerId && entry.modelId === selected.modelId)
        : remembered ?? local.defaultModel;
      if (!target || ctx.desktopHostId?.() !== local.hostId) {
        throw new Error('The selected desktop assistant model is unavailable.');
      }
      model = target.modelId;
      binary = process.env.ZCC_CLAUDE_CODE_EXECUTABLE?.trim() || process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim() || 'claude';
    }
    const result = await new ClaudeCliProvider(
      binary
    ).run({
      system: args.instructions,
      user: args.prompt,
      model,
      timeoutMs: 30_000,
      maxOutputChars: 6000,
      disableTools: true,
      ...(args.desktop ? { isolated: true } : {}),
      signal: args.signal
    });
    args.signal?.throwIfAborted();
    if (!result.ok || !result.text.trim())
      throw new Error('Assistant inference is unavailable; check the configured Claude login');
    return { text: result.text.slice(0, 6000) };
  } finally {
    active.set(ctx, (active.get(ctx) || 1) - 1);
  }
}
