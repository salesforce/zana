import { z } from 'zod';
import { ClaudeCliProvider } from '@zana-ai/zcc-llm';
import { CodexInferenceCompleteResultSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { getPrimaryHost } from '@zana-ai/zcc-db';
import type { HarnessFamily } from '@zana-ai/zcc-domain/product';
import { threadProviderIdForHarnessFamily } from '@zana-ai/zcc-domain/launch-provider';
import { pluginEffectiveHarnessDefault, productPluginSpawnRouting, productProjectHarnessDefault } from '../http/plugin-harness-routing.js';
import { resolveProjectHost } from '../http/project-host.js';
import type { ProductHttpContext } from '../http/product-context.js';
import { bridgeLaunchForProvider, getThreadProvider } from '../services/threads/thread-provider-catalog.js';

const input = z.object({
  instructions: z.string().min(1).max(12_000),
  prompt: z.string().min(1).max(60_000),
  projectId: z.string().min(1).max(200).optional(),
  expectedProviderId: z.string().min(1).max(200).optional(),
  signal: z.custom<AbortSignal>(
    value => typeof value === 'object' && value !== null && typeof (value as AbortSignal).throwIfAborted === 'function'
  ).optional()
}).strict();

const TIMEOUT_MS = 30_000;
const MAX_TEXT_LENGTH = 6_000;
const active = new WeakMap<ProductHttpContext, number>();

type Request = z.infer<typeof input>;
interface Target {
  ctx: ProductHttpContext;
  hostId: string;
  providerId: string;
  model?: string;
}
type Completion = (target: Target, request: Request) => Promise<string>;

async function claudeCompletion(ctx: ProductHttpContext, request: Request, model?: string, isolated = false): Promise<string> {
  const config = ctx.config.getConfig();
  const override = isolated
    ? process.env.ZCC_CLAUDE_CODE_EXECUTABLE || process.env.BB_CLAUDE_CODE_EXECUTABLE
    : undefined;
  const binary = override || config.harnesses?.byId?.claude?.binary || config.claudeBinary || 'claude';
  const result = await new ClaudeCliProvider(binary).run({
    system: request.instructions,
    user: request.prompt,
    model,
    timeoutMs: TIMEOUT_MS,
    maxOutputChars: MAX_TEXT_LENGTH,
    disableTools: true,
    ...(isolated ? { isolated: true } : {}),
    signal: request.signal
  });
  if (!result.ok || !result.text.trim()) throw new Error('Assistant inference is unavailable; check the configured Claude login');
  return result.text;
}

async function codexCompletion(target: Target, request: Request): Promise<string> {
  const { ctx, hostId, providerId } = target;
  let model = target.model;
  if (!model) {
    const provider = getThreadProvider(providerId);
    const catalog = await ctx.modelCatalogs.read({
      providerId, hostId, scope: provider?.models?.scope ?? 'workspace',
      bridgeLaunch: bridgeLaunchForProvider(providerId, ctx.pluginHostArtifacts)
    });
    const row = catalog.models.find(option => option.isDefault) ?? catalog.models[0];
    model = row?.model || row?.id;
  }
  if (!model) throw new Error('Codex model unavailable');
  request.signal?.throwIfAborted();
  const response = await ctx.hostHub.callHostOnlineRpc({
    hostId,
    timeoutMs: TIMEOUT_MS + 2_000,
    command: {
      type: 'codex.inference.complete',
      model,
      reasoningEffort: 'none',
      prompt: `${request.instructions}\n\nConversation data follows as JSON.\n${request.prompt}`,
      outputSchema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      timeoutMs: TIMEOUT_MS
    }
  });
  return z.string().parse(CodexInferenceCompleteResultSchema.parse(response).value.text);
}

const textAdapters: Partial<Record<HarnessFamily, Completion>> = {
  claude: async (target, request) => {
    if (getPrimaryHost(target.ctx.db)?.id !== target.hostId) throw new Error('Claude Code text inference requires the local machine');
    return claudeCompletion(target.ctx, request, target.model, true);
  },
  codex: codexCompletion
};

async function completeForProject(ctx: ProductHttpContext, request: Request & { projectId: string }, pluginId?: string): Promise<{ text: string; providerId: string }> {
  const { projectId } = request;
  const project = ctx.toProjects().find(row => row.id === projectId);
  if (!project) throw new Error('The AI provider project is unavailable.');
  const hostId = resolveProjectHost(ctx, project.hostId);
  const resolve = () => productProjectHarnessDefault(ctx, projectId, hostId);
  const effective = pluginId
    ? await pluginEffectiveHarnessDefault(ctx, { pluginId, projectId, hostId }, resolve)
    : await resolve();
  if (!effective.ok) throw new Error('No usable project AI provider. Check the default in Settings → AI Harness.');

  const providerId = threadProviderIdForHarnessFamily(effective.family);
  const provider = providerId ? getThreadProvider(providerId) : undefined;
  const label = provider?.displayName || effective.family;
  const complete = textAdapters[effective.family];
  if (!provider || !providerId || !complete || provider.unavailableReason) {
    throw new Error(`${label} is unavailable for text-only chat. Check the project’s AI provider in Settings.`);
  }

  if (request.expectedProviderId && request.expectedProviderId !== providerId) {
    throw new Error(`The default AI provider is now ${label}. Start a new conversation to use it.`);
  }

  try {
    const routing = await productPluginSpawnRouting(ctx, { projectId, hostId, providerId, pluginId, harness: effective });
    request.signal?.throwIfAborted();
    const text = await complete({ ctx, hostId, providerId, model: routing?.model }, request);
    return { text, providerId };
  } catch {
    request.signal?.throwIfAborted();
    throw new Error(`${label} couldn’t answer. Check its sign-in and model in Settings → AI Harness.`);
  }
}

/** Bounded inference without any project inputs or agent execution grants. */
export async function completePluginAssistant(
  ctx: ProductHttpContext,
  value: Request,
  pluginId?: string
): Promise<{ text: string; providerId?: string }> {
  const args = input.parse(value);
  if (args.expectedProviderId && !args.projectId) throw new Error('A project is required to check the expected provider.');
  args.signal?.throwIfAborted();
  if ((active.get(ctx) || 0) >= 2) throw new Error('Assistant is busy; try again shortly');
  active.set(ctx, (active.get(ctx) || 0) + 1);
  try {
    const result = args.projectId
      ? await completeForProject(ctx, { ...args, projectId: args.projectId }, pluginId)
      : { text: await claudeCompletion(ctx, args, 'haiku') };
    args.signal?.throwIfAborted();
    if (!result.text.trim()) throw new Error('The AI provider returned an empty answer.');
    return { ...result, text: result.text.slice(0, MAX_TEXT_LENGTH) };
  } finally {
    active.set(ctx, (active.get(ctx) || 1) - 1);
  }
}
