import { RAW_THREAD_ID_PATTERN_SOURCE } from '@zana-ai/zcc-domain/thread-runtime';

export const THREAD_MENTION_HREF_PREFIX = 'zcc-thread:';

const THREAD_MENTION_PATTERN = new RegExp(
  `@thread:([A-Za-z0-9_-]+)|(${RAW_THREAD_ID_PATTERN_SOURCE})`,
  'gu'
);

const SKIP_TYPES = new Set(['code', 'inlineCode', 'link', 'image', 'definition']);

interface MdastNode {
  type?: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

function mentionLink(threadId: string, raw: boolean): MdastNode {
  return {
    type: 'link',
    url: `${THREAD_MENTION_HREF_PREFIX}${threadId}`,
    children: [{ type: 'text', value: raw ? threadId : `@thread:${threadId}` }]
  };
}

export function parseThreadMentionHref(href: string | undefined): string | null {
  if (!href?.startsWith(THREAD_MENTION_HREF_PREFIX)) return null;
  const id = href.slice(THREAD_MENTION_HREF_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

export function splitThreadMentionText(value: string): MdastNode[] {
  const nodes: MdastNode[] = [];
  let cursor = 0;
  THREAD_MENTION_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(THREAD_MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, index) });
    }
    const tagged = match[1];
    const raw = match[2];
    nodes.push(mentionLink(tagged ?? raw ?? match[0], Boolean(raw && !tagged)));
    cursor = index + match[0].length;
  }
  if (cursor === 0) return [{ type: 'text', value }];
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) });
  return nodes;
}

function visitMentions(node: MdastNode): void {
  if (!node || SKIP_TYPES.has(node.type ?? '')) return;
  const children = node.children;
  if (!Array.isArray(children)) return;
  const next: MdastNode[] = [];
  for (const child of children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitThreadMentionText(child.value));
    } else {
      visitMentions(child);
      next.push(child);
    }
  }
  node.children = next;
}

export function remarkThreadMentions() {
  return (tree: MdastNode) => {
    visitMentions(tree);
  };
}
