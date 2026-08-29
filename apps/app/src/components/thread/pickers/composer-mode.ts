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

export function applyComposerModePrefix(text: string, mode: ComposerWorkMode): string {
  if (mode === 'agent') return text;
  const command = mode === 'plan' ? '/plan' : '/goal';
  const trimmed = text.trimStart();
  const lower = trimmed.toLowerCase();
  if (lower === command || lower.startsWith(`${command} `) || lower.startsWith(`${command}\n`)) {
    return text;
  }
  return `${command} ${trimmed}`;
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
