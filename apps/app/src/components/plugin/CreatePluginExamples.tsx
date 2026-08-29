import { CREATE_PLUGIN_PROMPT } from '../../lib/create-resource-prompts.js';
import {
  PLUGIN_CREATE_ARCHETYPES,
  PLUGIN_CREATE_UTILITIES,
  pluginCreatePrompt
} from '../../lib/create-plugin-examples.js';

void CREATE_PLUGIN_PROMPT;

export function CreatePluginExamples({
  onSelect
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="create-plugin-examples" data-testid="create-plugin-examples">
      <div className="create-plugin-examples-row" role="group" aria-label="Plugin ideas">
        {PLUGIN_CREATE_ARCHETYPES.map((archetype) => (
          <button
            key={archetype.id}
            type="button"
            className="settings-btn"
            onClick={() => onSelect(pluginCreatePrompt(archetype.brief))}
          >
            {archetype.title}
          </button>
        ))}
      </div>
      <div className="create-plugin-examples-row" role="group" aria-label="Plugin surfaces">
        {PLUGIN_CREATE_UTILITIES.map((example) => (
          <button
            key={example.id}
            type="button"
            className="settings-btn"
            onClick={() => onSelect(pluginCreatePrompt(example.brief))}
          >
            {example.label}
          </button>
        ))}
      </div>
    </div>
  );
}
