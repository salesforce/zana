import { z } from 'zod';
import { ClaudeCliProvider } from '@zana-ai/zcc-llm';
import type { ProductHttpContext } from '../http/product-context.js';

const input = z
  .object({
    instructions: z.string().min(1).max(12_000),
    prompt: z.string().min(1).max(60_000),
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
    const result = await new ClaudeCliProvider(
      config.harnesses?.byId?.claude?.binary || config.claudeBinary || 'claude'
    ).run({
      system: args.instructions,
      user: args.prompt,
      model: 'haiku',
      timeoutMs: 30_000,
      maxOutputChars: 6000,
      disableTools: true,
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
