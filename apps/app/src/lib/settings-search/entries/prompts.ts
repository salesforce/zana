import type { SettingsSearchEntry } from '../types';

/**
 * Settings > Prompts. The prompt list itself is user data; these are the
 * editor's fixed fields (shown once a prompt is selected).
 */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'prompts.intro',
    section: 'prompts',
    label: 'Prompts',
    help: 'Reusable LLM micro-calls the app runs, like a sub-agent: a prompt in, one answer out. The tab-namer prompt names a tab from your first instruction. Edits are saved to ~/.zcc/llm-prompts/; built-ins are customized by shadowing, and Reset removes the shadow.',
    keywords: ['llm', 'micro-call', 'tab-namer', 'tab namer', 'idle-triage', 'shadow', 'built-in prompts', 'custom prompts'],
    kind: 'setting'
  },
  {
    id: 'prompts.label',
    section: 'prompts',
    label: 'Label',
    help: 'Name of the selected prompt in the list.',
    keywords: ['prompt name', 'rename prompt'],
    kind: 'setting'
  },
  {
    id: 'prompts.description',
    section: 'prompts',
    label: 'Description',
    help: 'Optional — shown to you, not the model.',
    kind: 'setting'
  },
  {
    id: 'prompts.provider',
    section: 'prompts',
    label: 'Provider',
    help: 'Which service runs this prompt.',
    options: ['Claude CLI (claude --print)', 'Anthropic SDK', 'OpenAI', 'Gemini'],
    keywords: ['llm provider', 'claude cli', 'openai', 'gemini', 'api key'],
    kind: 'setting'
  },
  {
    id: 'prompts.model',
    section: 'prompts',
    label: 'Model',
    help: 'haiku, sonnet, opus, or a full id',
    keywords: ['haiku', 'sonnet', 'opus', 'model id'],
    kind: 'setting'
  },
  {
    id: 'prompts.system-prompt',
    section: 'prompts',
    label: 'System prompt',
    help: 'The instruction sent to the model.',
    keywords: ['instructions', 'system message'],
    kind: 'setting'
  },
  {
    id: 'prompts.user-template',
    section: 'prompts',
    label: 'User template',
    help: 'The user turn. {{prompt}} is filled with the first instruction.',
    keywords: ['placeholder', 'variables', 'template', '{{prompt}}'],
    kind: 'setting'
  },
  {
    id: 'prompts.max-output-chars',
    section: 'prompts',
    label: 'Max output chars',
    help: 'Upper bound on the length of the answer.',
    keywords: ['output length', 'truncate', 'limit'],
    kind: 'setting'
  },
  {
    id: 'prompts.timeout',
    section: 'prompts',
    label: 'Timeout (ms)',
    help: 'How long a run may take, in milliseconds.',
    keywords: ['time limit', 'milliseconds'],
    kind: 'setting'
  },
  {
    id: 'prompts.actions',
    section: 'prompts',
    label: 'Save, reset and reveal folder',
    help: 'Save, Reset to default, Delete, Reveal folder.',
    keywords: ['restore default', 'shadow', 'llm-prompts folder'],
    kind: 'action'
  },
  {
    id: 'prompts.test',
    section: 'prompts',
    label: 'Test',
    help: 'Run the prompt with sample values for each {{placeholder}}. This template has no placeholders to fill, so Test runs it as-is.',
    keywords: ['try prompt', 'run prompt', 'placeholders'],
    kind: 'action'
  }
];
