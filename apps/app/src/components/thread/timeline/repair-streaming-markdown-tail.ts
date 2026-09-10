import remend from 'remend';

const TRIPLE_FENCE = /```/;
const DIRECTIVE = /(^|\n)\s*::[a-z]/;

/**
 * Repair incomplete markdown on a live streaming tail only. Copy/export keeps
 * the original text. Triple fences and plugin `::name` directives are left
 * untouched so remend cannot close a fence or break a directive mid-stream.
 */
export function repairStreamingMarkdownTail(tail: string): string {
  if (!tail) return tail;
  if (TRIPLE_FENCE.test(tail) || DIRECTIVE.test(tail)) return tail;
  return remend(tail);
}
