import { mentionDisplayLabel } from './mention-label.js';
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
  const resource = resourceFromSuggestion(item);
  return {
    id: suggestionKey(item),
    label: mentionDisplayLabel(resource),
    resource,
    serializedText
  };
}
