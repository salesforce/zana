import type { LlmPromptEntry, LlmRunResult } from '@zana-ai/zcc-domain/llm';

export const TAB_NAMER_PROMPT_ID = 'builtin:tab-namer';

export interface RunTabNamerOnceArgs {
  id: string;
  prompt: string;
  namedIds: Set<string>;
  enabled: boolean;
  getEntry: (id: string) => LlmPromptEntry | null | undefined;
  run: (
    entry: LlmPromptEntry,
    vars: Record<string, string>,
    dedupeKey?: string
  ) => Promise<LlmRunResult>;
  /** Re-check after the call; the session/thread may have closed while haiku ran. */
  stillLive?: () => boolean;
  onError?: (err: unknown) => void;
}

/**
 * One-shot tab-namer: names a session or thread from its opening instruction.
 * Safe to call repeatedly — bails once fired, until the call resolves
 * failed/empty/thrown and releases the guard for a retry.
 */
export async function runTabNamerOnce(args: RunTabNamerOnceArgs): Promise<string | null> {
  const prompt = args.prompt.trim();
  if (!prompt || !args.enabled || args.namedIds.has(args.id)) return null;
  const entry = args.getEntry(TAB_NAMER_PROMPT_ID);
  if (!entry) return null;
  args.namedIds.add(args.id);
  try {
    const result = await args.run(entry, { prompt }, args.id);
    if (!result.ok || !result.text.trim()) {
      args.namedIds.delete(args.id);
      return null;
    }
    if (args.stillLive && !args.stillLive()) return null;
    return result.text.trim();
  } catch (err) {
    args.namedIds.delete(args.id);
    args.onError?.(err);
    return null;
  }
}
