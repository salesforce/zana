/**
 * Shared helpers for the ReDoS regression tests (CodeQL js/polynomial-redos).
 */

/**
 * Wall-clock budget for the long-input tests. The linear implementations take
 * a few milliseconds on these inputs; the quadratic regexes they replaced take
 * many seconds, so this keeps wide headroom for a slow or loaded CI runner
 * while still failing on the old behavior.
 */
export const LINEAR_TIME_BUDGET_MS = 2_000;

/**
 * Every string built from `alphabet` tokens, from "" up to `maxTokens` tokens.
 * Used to compare a hand-written scanner with the regex it replaced on all
 * short inputs.
 */
export function* allStrings(alphabet: string | readonly string[], maxTokens: number): Generator<string> {
  const tokens = Array.from(alphabet);
  let layer = [''];
  yield '';
  for (let length = 1; length <= maxTokens; length += 1) {
    const next: string[] = [];
    for (const prefix of layer) {
      for (const token of tokens) next.push(prefix + token);
    }
    yield* next;
    layer = next;
  }
}
