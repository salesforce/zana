import {
  promptInputHasCommandMention,
  promptInputSchema,
  type PromptInput
} from '@zana-ai/zcc-domain/thread-runtime';

export {
  classifyExecutionMode,
  classifyExecutionModeOption,
  composerWorkModeFromNativeMode,
  isPlanExecutionMode,
  nativeModeForComposerWorkMode,
  portableWorkIntent,
  type ClassifiedExecutionMode,
  type ExecutionModeKind,
  type PortableWorkIntent,
  type PortableWorkMode
} from '@zana-ai/zcc-domain/thread-runtime';

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

/**
 * Claude slash Plan is not an ACP session mode. Pack the SDK permission-mode
 * field so the dedicated Claude bridge can `setPermissionMode("plan")`.
 * Codex slash Plan does not use this field.
 */
export function claudeCodePermissionModeForTurn(
  providerId: string | undefined,
  requestedMode: string
): 'plan' | undefined {
  return requestedMode === 'plan' && providerId === 'claude-code' ? 'plan' : undefined;
}
