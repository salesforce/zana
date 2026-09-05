import {
  promptInputHasCommandMention,
  promptInputSchema,
  type PromptInput
} from '@zana-ai/zcc-domain/thread-runtime';

export type ExecutionModeKind = 'plan' | 'ask' | 'execute' | 'custom';

export interface ClassifiedExecutionMode {
  id: string;
  label: string;
  kind: ExecutionModeKind;
}

/**
 * Map a harness-native mode id/label onto a portable semantic kind.
 * Core never branches on a provider id — Cursor `plan`/`agent`/`ask` fall
 * out of this classifier like any other ACP session mode.
 */
export function classifyExecutionMode(id: string, name?: string): ExecutionModeKind {
  const token = id.trim().toLowerCase();
  const label = (name ?? '').trim().toLowerCase();
  if (token === 'plan' || label === 'plan') return 'plan';
  if (token === 'ask' || label === 'ask') return 'ask';
  if (
    token === 'agent'
    || token === 'build'
    || token === 'execute'
    || token === 'code'
    || label === 'agent'
  ) {
    return 'execute';
  }
  return 'custom';
}

export function classifyExecutionModeOption(option: {
  value: string;
  name?: string;
}): ClassifiedExecutionMode {
  return {
    id: option.value,
    label: option.name?.trim() || option.value,
    kind: classifyExecutionMode(option.value, option.name)
  };
}

export function isPlanExecutionMode(id: string | null | undefined, name?: string): boolean {
  if (!id) return false;
  return classifyExecutionMode(id, name) === 'plan';
}

function parsePromptInputList(input: unknown): PromptInput[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((part) => {
    const parsed = promptInputSchema.safeParse(part);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Mode the user asked for on this create/send: native ACP `acpMode` wins,
 * otherwise a `/plan` or `/goal` command mention, otherwise `agent`.
 */
export function requestedExecutionModeFromTurn(args: {
  acpMode?: string | null;
  input?: unknown;
}): string {
  const acp = typeof args.acpMode === 'string' ? args.acpMode.trim() : '';
  if (acp) return acp;
  const parts = parsePromptInputList(args.input);
  if (promptInputHasCommandMention(parts, { trigger: '/', name: 'plan' })) return 'plan';
  if (promptInputHasCommandMention(parts, { trigger: '/', name: 'goal' })) return 'goal';
  return 'agent';
}
