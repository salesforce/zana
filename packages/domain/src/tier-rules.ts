/**
 * Tier rules: pick a model for a portable tier from a harness's live inventory.
 * For harnesses whose model ids carry no portable tier, the user declares ordered
 * rules per tier; nothing here names a vendor or model family.
 */
const MAX_RULES = 8;
const MAX_RULE_CHARS = 128;
const idOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The first rule that matches the live inventory wins. A rule is an exact model id or a
 * name term. A term matches whole words (separated by `-`, `_`, `/` or `.`) and picks the
 * highest version by numeric collation, so the result is the same whatever order the
 * harness lists its models in. Malformed or oversized rules are ignored.
 */
export function resolveTierFromRules(rules: unknown, liveIds: readonly string[]): string | undefined {
  if (!Array.isArray(rules) || !liveIds.length) return undefined;
  const live = new Set(liveIds);
  const ordered = [...live].sort((a, b) => idOrder.compare(b, a) || (a < b ? 1 : a > b ? -1 : 0));
  for (const rule of rules.slice(0, MAX_RULES)) {
    if (typeof rule !== 'string') continue;
    const term = rule.trim();
    if (!term || term.length > MAX_RULE_CHARS) continue;
    if (live.has(term)) return term;
    const words = new RegExp(`(?:^|[-_/.])${escapeRegExp(term)}(?:[-_/.]|$)`, 'i');
    const hit = ordered.find((id) => words.test(id));
    if (hit) return hit;
  }
  return undefined;
}
