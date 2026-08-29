import { reasoningLevelSchema } from '@zana-ai/zcc-domain/thread-runtime';
import { stripModelBrandPrefix } from './model-brand-prefix.js';
import { REASONING_LABELS } from './reasoning-labels.js';

const KNOWN_MODEL_LABELS: Record<string, string> = {
  default: 'Default',
  'claude-fable-5': 'Fable 5',
  'claude-opus-5[1m]': 'Opus 5 (1M)',
  'claude-opus-4-8[1m]': 'Opus 4.8 (1M)',
  'claude-opus-4-7[1m]': 'Opus 4.7 (1M)',
  'claude-sonnet-5': 'Sonnet 5'
};

export function humanThreadModelLabel(model: string, providerId?: string): string {
  return stripModelBrandPrefix(KNOWN_MODEL_LABELS[model] ?? model, providerId ?? '');
}

export function humanThreadReasoningLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = reasoningLevelSchema.safeParse(value);
  return parsed.success ? REASONING_LABELS[parsed.data] : value;
}
