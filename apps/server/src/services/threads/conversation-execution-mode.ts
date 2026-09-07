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

/** Claude's SDK treats a leading `/plan` as an interactive slash command. */
const PLAN_COMMAND_PREFIX = /^\/plan(?:[ \t]+|\n|$)/i;

function parsePromptInputList(input: unknown): PromptInput[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((part) => {
    const parsed = promptInputSchema.safeParse(part);
    return parsed.success ? [parsed.data] : [];
  });
}

export function stripLeadingPlanCommandText(text: string): string {
  const trimmed = text.trimStart();
  const match = trimmed.match(PLAN_COMMAND_PREFIX);
  return match ? trimmed.slice(match[0].length) : text;
}

export function promptTextHasLeadingPlanCommand(text: string): boolean {
  return PLAN_COMMAND_PREFIX.test(text.trimStart());
}

function rawInputHasLeadingPlanCommand(input: unknown): boolean {
  if (typeof input === 'string') return promptTextHasLeadingPlanCommand(input);
  if (!Array.isArray(input)) return false;
  return input.some((part) => {
    if (typeof part === 'string') return promptTextHasLeadingPlanCommand(part);
    if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
      return promptTextHasLeadingPlanCommand((part as { text: string }).text);
    }
    return false;
  });
}

/**
 * Mode the user asked for on this create/send: a `/plan` or `/goal` command
 * mention (or a leading `/plan` prefix) wins, otherwise native ACP `acpMode`,
 * otherwise `agent`. Slash plan must beat a leftover ACP mode from another
 * harness — Claude Code has no ACP Plan session mode.
 */
export function requestedExecutionModeFromTurn(args: {
  acpMode?: string | null;
  input?: unknown;
}): string {
  const parts = parsePromptInputList(args.input);
  if (promptInputHasCommandMention(parts, { trigger: '/', name: 'plan' })) return 'plan';
  if (rawInputHasLeadingPlanCommand(args.input)) return 'plan';
  if (promptInputHasCommandMention(parts, { trigger: '/', name: 'goal' })) return 'goal';
  const acp = typeof args.acpMode === 'string' ? args.acpMode.trim() : '';
  if (acp) return acp;
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
