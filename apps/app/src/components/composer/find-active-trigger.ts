import type { ActiveTrigger, TypeaheadTrigger } from './types.js';

interface ActiveTriggerEditor {
  state: {
    selection: {
      empty: boolean;
      from: number;
    };
    doc: {
      textBetween(
        from: number,
        to: number,
        blockSeparator?: string,
        leafText?: string
      ): string;
    };
  };
}

function triggerPattern(trigger: TypeaheadTrigger): RegExp {
  const char = trigger.char;
  const queryClass = trigger.kind === 'mention' ? `[^\\s${char}]*` : '\\S*';
  return new RegExp(`(^|[\\s([{])${char}(${queryClass})$`, 'u');
}

/**
 * Resolves the typeahead trigger under the caret. Mentions stop at whitespace
 * or a second trigger char; commands capture the whole non-space token.
 */
export function findActiveTrigger(
  editor: ActiveTriggerEditor,
  triggers: readonly TypeaheadTrigger[]
): ActiveTrigger | null {
  const selection = editor.state.selection;
  if (!selection.empty) return null;

  const textBeforeCursor = editor.state.doc.textBetween(
    0,
    selection.from,
    '\n',
    '\n'
  );

  for (const trigger of triggers) {
    const match = triggerPattern(trigger).exec(textBeforeCursor);
    if (!match) continue;

    const query = match[2] ?? '';
    const from = selection.from - query.length - 1;
    if (from < 0) continue;

    return {
      char: trigger.char,
      kind: trigger.kind,
      query,
      from,
      to: selection.from
    };
  }

  return null;
}
