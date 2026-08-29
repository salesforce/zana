import { CREATE_PLUGIN_PROMPT } from './create-resource-prompts.js';
import { APP_ROOT_ROUTE_PATH, getNewThreadRoutePath } from './route-paths.js';

export interface ComposePromptSeed {
  initialText?: string;
  focusPrompt: boolean;
}

export interface CreatePluginComposeState {
  initialPrompt: string;
  focusPrompt: boolean;
}

function isCreatePluginComposeState(value: unknown): value is CreatePluginComposeState {
  if (!value || typeof value !== 'object') return false;
  const row = value as { initialPrompt?: unknown; focusPrompt?: unknown };
  return typeof row.initialPrompt === 'string';
}

export function composePromptSeedFrom(input: {
  searchParams: URLSearchParams;
  state: unknown;
}): ComposePromptSeed {
  const state = isCreatePluginComposeState(input.state) ? input.state : null;
  const fromQuery = input.searchParams.get('prompt') ?? undefined;
  const raw = state?.initialPrompt ?? fromQuery;
  const initialText = raw == null || raw.trim() === '' ? undefined : raw.trimStart();
  const focusPrompt = Boolean(state?.focusPrompt) || input.searchParams.get('focus') === '1';
  return { initialText, focusPrompt };
}

export function createPluginComposeNavigation(options?: {
  prompt?: string;
  projectId?: string | null;
}): { pathname: string; state: CreatePluginComposeState } {
  const initialPrompt = options?.prompt ?? CREATE_PLUGIN_PROMPT;
  return {
    pathname: options?.projectId
      ? getNewThreadRoutePath(options.projectId)
      : APP_ROOT_ROUTE_PATH,
    state: { initialPrompt, focusPrompt: true }
  };
}
