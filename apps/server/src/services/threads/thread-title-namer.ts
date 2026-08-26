import type { LlmPromptEntry, LlmRunResult } from '@zana-ai/zcc-domain/llm';
import { runTabNamerOnce } from '@zana-ai/zcc-llm';

export interface ThreadTitleNamer {
  /** Fire-and-forget; no-ops when the thread was already named or reserved. */
  request(threadId: string, prompt: string): void;
  /** Pin the id so a later request — or an in-flight namer result — cannot overwrite an explicit title. */
  reserve(threadId: string): void;
}

export interface ThreadTitleNamerDeps {
  autoRenameEnabled: () => boolean;
  getEntry: (id: string) => LlmPromptEntry | null | undefined;
  run: (
    entry: LlmPromptEntry,
    vars: Record<string, string>,
    dedupeKey?: string
  ) => Promise<LlmRunResult>;
  applyTitle: (threadId: string, title: string) => void;
  stillLive?: (threadId: string) => boolean;
  onError?: (err: unknown) => void;
}

/**
 * Applies `builtin:tab-namer` to conversation threads. Same one-shot / retry
 * contract as the legacy-agent tab path; the apply callback persists the label.
 */
export function createThreadTitleNamer(deps: ThreadTitleNamerDeps): ThreadTitleNamer {
  const namedIds = new Set<string>();
  const lockedIds = new Set<string>();
  return {
    reserve(threadId) {
      namedIds.add(threadId);
      lockedIds.add(threadId);
    },
    request(threadId, prompt) {
      void runTabNamerOnce({
        id: threadId,
        prompt,
        namedIds,
        enabled: deps.autoRenameEnabled(),
        getEntry: deps.getEntry,
        run: deps.run,
        stillLive: deps.stillLive ? () => deps.stillLive!(threadId) : undefined,
        onError: deps.onError
      }).then((title) => {
        if (!title || lockedIds.has(threadId)) return;
        deps.applyTitle(threadId, title);
      });
    }
  };
}
