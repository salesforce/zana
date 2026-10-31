import { parseContextReference, type ContextReference } from '@zana-ai/zcc-domain/thread-runtime';

type Insert = (reference: ContextReference) => boolean;
const targets = new Map<string, Set<Insert>>();

/** A mounted thread owns its insertion target; ambiguous or absent targets fail closed. */
export function registerThreadContextTarget(threadId: string, insert: Insert): () => void {
  const entries = targets.get(threadId) ?? new Set<Insert>();
  entries.add(insert);
  targets.set(threadId, entries);
  return () => { entries.delete(insert); if (!entries.size) targets.delete(threadId); };
}

export function addThreadContext(threadId: string | null, value: ContextReference): boolean {
  const reference = parseContextReference(value);
  const entries = threadId ? targets.get(threadId) : undefined;
  if (!reference || entries?.size !== 1) return false;
  return [...entries][0]!(reference);
}
