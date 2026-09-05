import type { PromptTextMention } from '@zana-ai/zcc-domain/thread-runtime';

export type ComposerWorkMode = 'agent' | 'plan' | 'goal';

export const COMPOSER_MODE_LABELS: Record<ComposerWorkMode, string> = {
  agent: 'Agent',
  plan: 'Plan',
  goal: 'Goal'
};

export function composerModesForActions(actions: readonly string[]): ComposerWorkMode[] {
  const modes: ComposerWorkMode[] = ['agent'];
  if (actions.includes('plan')) modes.push('plan');
  if (actions.includes('goal')) modes.push('goal');
  return modes;
}

/** Next composer work mode, wrapping from the last offered mode back to the first. */
export function nextComposerWorkMode(
  modes: readonly ComposerWorkMode[],
  current: ComposerWorkMode
): ComposerWorkMode {
  if (modes.length === 0) return current;
  const index = modes.indexOf(current);
  const from = index < 0 ? 0 : index;
  return modes[(from + 1) % modes.length]!;
}

/** Next native ACP/session mode value, wrapping through catalog order. */
export function nextNativeRoleValue(
  options: readonly { value: string }[],
  current: string | undefined
): string | undefined {
  if (options.length === 0) return current;
  const values = options.map((option) => option.value);
  const index = current ? values.indexOf(current) : -1;
  const from = index < 0 ? 0 : index;
  return values[(from + 1) % values.length];
}

export type ComposerModeCycleKeyEvent = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

export type ComposerModeCycleTarget =
  | {
    kind: 'native';
    options: readonly { value: string }[];
    current: string | undefined;
    onChange: (value: string | undefined) => void;
  }
  | {
    kind: 'work';
    modes: readonly ComposerWorkMode[];
    current: ComposerWorkMode;
    onChange: (value: ComposerWorkMode) => void;
  };

/** Shift+Tab cycles Agent/Plan/Goal or native ACP modes in the focused composer. */
export function isComposerModeCycleShortcut(event: ComposerModeCycleKeyEvent): boolean {
  return event.key === 'Tab'
    && event.shiftKey
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey;
}

/**
 * Shared Shift+Tab handler for thread and home composers.
 * Native ACP modes XOR work modes — same first-slot picker the chrome shows.
 */
export function consumeComposerModeCycle(
  event: ComposerModeCycleKeyEvent,
  target: ComposerModeCycleTarget
): boolean {
  if (!isComposerModeCycleShortcut(event)) return false;
  if (target.kind === 'native') {
    if (target.options.length <= 1) return false;
    event.preventDefault();
    event.stopPropagation();
    target.onChange(nextNativeRoleValue(target.options, target.current));
    return true;
  }
  if (target.modes.length <= 1) return false;
  event.preventDefault();
  event.stopPropagation();
  target.onChange(nextComposerWorkMode(target.modes, target.current));
  return true;
}

export function asComposerWorkMode(value: string | null | undefined): ComposerWorkMode | null {
  if (value === 'agent' || value === 'plan' || value === 'goal') return value;
  return null;
}

function composerWorkModeCommandMention(mode: 'plan' | 'goal', start: number): PromptTextMention {
  const command = `/${mode}`;
  return {
    start,
    end: start + command.length,
    resource: {
      kind: 'command',
      trigger: '/',
      name: mode,
      source: 'command',
      origin: 'builtin',
      label: mode,
      argumentHint: null
    }
  };
}

/** Insert a real `/plan` or `/goal` command mention so the harness stays in that mode. */
export function applyComposerWorkMode(
  serialized: { text: string; mentions: PromptTextMention[] },
  mode: ComposerWorkMode
): { text: string; mentions: PromptTextMention[] } {
  if (mode === 'agent') return serialized;
  const command = `/${mode}`;
  const trimmed = serialized.text.trimStart();
  const lower = trimmed.toLowerCase();
  const already = lower === command || lower.startsWith(`${command} `) || lower.startsWith(`${command}\n`);
  const lead = serialized.text.length - trimmed.length;
  if (already) {
    const mention = composerWorkModeCommandMention(mode, lead);
    const hasMention = serialized.mentions.some((item) => (
      item.resource.kind === 'command'
      && item.resource.name === mode
      && item.start === mention.start
      && item.end === mention.end
    ));
    if (hasMention) return serialized;
    return { text: serialized.text, mentions: [mention, ...serialized.mentions] };
  }
  const prefix = `${command} `;
  const mention = composerWorkModeCommandMention(mode, 0);
  const shifted = serialized.mentions.map((item) => ({
    ...item,
    start: item.start - lead + prefix.length,
    end: item.end - lead + prefix.length
  }));
  return {
    text: `${prefix}${trimmed}`,
    mentions: [mention, ...shifted]
  };
}

export function applyComposerModePrefix(text: string, mode: ComposerWorkMode): string {
  return applyComposerWorkMode({ text, mentions: [] }, mode).text;
}

export function composerActionsFromProvider(
  actions: ReadonlyArray<string | { kind?: string }> | undefined
): string[] {
  if (!actions) return [];
  return actions.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (entry.kind === 'plan' || entry.kind === 'goal') return [entry.kind];
    return [];
  });
}

/** Map a native ACP/session mode onto the shared Agent / Plan / Goal icons. */
export function composerWorkModeForNativeLabel(value: string, name?: string): ComposerWorkMode {
  const hay = `${value} ${name ?? ''}`.toLowerCase();
  if (/\bgoal\b/.test(hay)) return 'goal';
  if (/\bplan\b/.test(hay)) return 'plan';
  return 'agent';
}
