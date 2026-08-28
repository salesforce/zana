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

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function triggerPattern(trigger: TypeaheadTrigger): RegExp {
  const char = escapeRegexLiteral(trigger.char);
  // Mentions keep spaces between words so thread titles like "Hello world"
  // match. Tabs/newlines still end the query; a second trigger char does too.
  const queryClass = trigger.kind === 'mention' ? `(?:[^\\s${char}]| )*` : '\\S*';
  return new RegExp(`(^|[\\s([{])${char}(${queryClass})$`, 'u');
}

/**
 * Resolves the typeahead trigger under the caret. Mention queries keep
 * ordinary spaces; commands capture the whole non-space token.
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
