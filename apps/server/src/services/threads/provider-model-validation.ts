import type { ReasoningLevel } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { overlayCustomModels } from './thread-execution-options.js';
import { bridgeLaunchForProvider, getThreadProvider } from './thread-provider-catalog.js';

export async function validateProviderModelSelection(
  ctx: ProductHttpContext,
  input: {
    hostId: string;
    providerId: string;
    cwd?: string;
    model?: string;
    reasoningLevel?: ReasoningLevel;
  }
): Promise<void> {
  // Persisted sessions use this internal sentinel when no model was selected.
  // Providers resolve it to their configured default; it is not a catalog id.
  if (!input.model || input.model === 'default') return;
  const provider = getThreadProvider(input.providerId);
  if (!provider) {
    throw new ThreadCreateError(400, 'invalid-provider', `unknown thread provider: ${input.providerId}`);
  }
  const catalog = await ctx.modelCatalogs.read({
    hostId: input.hostId,
    providerId: input.providerId,
    scope: provider.models?.scope ?? 'workspace',
    bridgeLaunch: bridgeLaunchForProvider(input.providerId, ctx.pluginHostArtifacts),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    requiredModel: input.model
  });
  const overlaid = overlayCustomModels(catalog, ctx.config.getConfig(), provider);
  // An empty catalogue that failed to load says nothing about this model; the launch
  // surfaces the real provider error instead of a misleading "not available".
  if (catalog.modelLoadError && overlaid.models.length === 0 && overlaid.selectedOnlyModels.length === 0) return;
  const row = [...overlaid.models, ...overlaid.selectedOnlyModels]
    .find((model) => model.id === input.model || model.model === input.model);
  if (!row) {
    throw new ThreadCreateError(400, 'invalid-model', `model is not available for ${provider.displayName}: ${input.model}`);
  }
  if (input.reasoningLevel && !row.supportedReasoningEfforts.some(
    (effort) => effort.reasoningEffort === input.reasoningLevel
  )) {
    throw new ThreadCreateError(
      400,
      'invalid-reasoning-level',
      `${input.reasoningLevel} is not supported by ${row.displayName}`
    );
  }
}
