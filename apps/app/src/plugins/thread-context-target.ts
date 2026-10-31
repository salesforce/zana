import {
  parseContextReference,
  type ContextReference,
} from '@zana-ai/zcc-domain/thread-runtime';

type Insert = (reference: ContextReference) => boolean;
const targets = new Map<string, Set<Insert>>();

/** A mounted thread owns its insertion target; ambiguous or absent targets fail closed. */
export function registerThreadContextTarget(
  threadId: string,
  insert: Insert,
): () => void {
  const entries = targets.get(threadId) ?? new Set<Insert>();
  entries.add(insert);
  targets.set(threadId, entries);
  return () => {
    entries.delete(insert);
    if (!entries.size) targets.delete(threadId);
  };
}

export function addThreadContext(
  threadId: string | null,
  value: ContextReference,
): boolean {
  const reference = parseContextReference(value);
  const entries = threadId ? targets.get(threadId) : undefined;
  if (!reference || entries?.size !== 1) return false;
  return [...entries][0]!(reference);
}

type Controls = {
  update: (
    pluginId: string,
    resourceId: string,
    reference: ContextReference | null,
  ) => boolean;
  focus: () => void;
};
const controls = new Map<string, Controls>();
const submitted = new Map<string, Set<() => void>>();
export function registerThreadContextControls(
  threadId: string,
  value: Controls,
): () => void {
  controls.set(threadId, value);
  return () => {
    if (controls.get(threadId) === value) controls.delete(threadId);
  };
}
export function updateThreadContext(
  threadId: string,
  pluginId: string,
  resourceId: string,
  reference: ContextReference | null,
): boolean {
  if (reference && !parseContextReference(reference)) return false;
  return (
    targets.get(threadId)?.size === 1 &&
    (controls.get(threadId)?.update(pluginId, resourceId, reference) ?? false)
  );
}
export function focusThreadComposer(threadId: string): void {
  if (targets.get(threadId)?.size === 1) controls.get(threadId)?.focus();
}
export function onThreadSubmitted(
  threadId: string,
  listener: () => void,
): () => void {
  const set = submitted.get(threadId) ?? new Set();
  set.add(listener);
  submitted.set(threadId, set);
  return () => {
    set.delete(listener);
    if (!set.size) submitted.delete(threadId);
  };
}
export function notifyThreadSubmitted(threadId: string): void {
  for (const listener of submitted.get(threadId) ?? []) {
    try {
      listener();
    } catch {
      /* A plugin observer must not fail an accepted submission. */
    }
  }
}
