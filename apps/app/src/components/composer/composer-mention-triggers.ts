import { COMPOSER_TRIGGERS, type TypeaheadTrigger } from './types.js';

export const PLUGIN_MENTION_TRIGGER_CHARS = ['@', '#', '$', '!', '~'] as const;
export type PluginMentionTriggerChar = (typeof PLUGIN_MENTION_TRIGGER_CHARS)[number];

const ALLOWED = new Set<string>(PLUGIN_MENTION_TRIGGER_CHARS);

export interface MentionProviderTriggerRow {
  trigger?: string;
  triggers?: readonly string[];
}

export function mentionProviderTriggerChars(
  provider: MentionProviderTriggerRow
): PluginMentionTriggerChar[] {
  const raw = provider.triggers?.length
    ? provider.triggers
    : provider.trigger
      ? [provider.trigger]
      : ['@'];
  const chars = [...new Set(raw.filter((char): char is PluginMentionTriggerChar => ALLOWED.has(char)))];
  return chars.length > 0 ? chars : ['@'];
}

export function mentionProviderMatchesTrigger(
  provider: MentionProviderTriggerRow,
  char: string
): boolean {
  return mentionProviderTriggerChars(provider).includes(char as PluginMentionTriggerChar);
}

export function composerTriggersForMentionProviders(
  providers: readonly MentionProviderTriggerRow[]
): TypeaheadTrigger[] {
  const chars = new Set<string>(['@']);
  for (const provider of providers) {
    for (const char of mentionProviderTriggerChars(provider)) chars.add(char);
  }
  const mentions = [...chars]
    .sort()
    .map((char) => ({ char, kind: 'mention' as const }));
  return [...mentions, ...COMPOSER_TRIGGERS.filter((trigger) => trigger.kind === 'command')];
}
