import {
  resourceFromSuggestion,
  serializedTextForSuggestion,
  suggestionKey,
  type TypeaheadSuggestion
} from './types.js';

export function mentionAttrsForSuggestion(item: TypeaheadSuggestion): {
  id: string;
  label: string;
  resource: ReturnType<typeof resourceFromSuggestion>;
  serializedText: string;
} {
  const serializedText = serializedTextForSuggestion(item);
  const label = item.kind === 'path'
    ? item.name
    : item.kind === 'thread'
      ? item.title
      : item.kind === 'project'
        ? item.name
        : item.name.replace(/^\//, '');
  return {
    id: suggestionKey(item),
    label,
    resource: resourceFromSuggestion(item),
    serializedText
  };
}
