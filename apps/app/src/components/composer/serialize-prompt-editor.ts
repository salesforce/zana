import type { JSONContent } from '@tiptap/react';
import type { PromptTextMention } from '@zana-ai/zcc-domain/thread-runtime';
import { promptMentionResourceSchema } from '@zana-ai/zcc-domain/thread-runtime';

export interface SerializedPrompt {
  text: string;
  mentions: PromptTextMention[];
}

function parseMentionResource(value: unknown) {
  const parsed = promptMentionResourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function appendMention(acc: SerializedPrompt, node: JSONContent): void {
  const serializedText =
    typeof node.attrs?.serializedText === 'string' && node.attrs.serializedText.length > 0
      ? node.attrs.serializedText
      : typeof node.attrs?.label === 'string'
        ? node.attrs.label
        : '';
  if (!serializedText) return;
  const start = acc.text.length;
  acc.text += serializedText;
  const resource = parseMentionResource(node.attrs?.resource);
  if (resource) {
    acc.mentions.push({ start, end: acc.text.length, resource });
  }
}

function serializeChildren(acc: SerializedPrompt, nodes: JSONContent[] | undefined, joinBlocks: boolean): void {
  if (!nodes) return;
  for (const [index, child] of nodes.entries()) {
    if (joinBlocks && index > 0) acc.text += '\n';
    serializeNode(acc, child);
  }
}

function serializeNode(acc: SerializedPrompt, node: JSONContent): void {
  if (node.type === 'mention') {
    appendMention(acc, node);
    return;
  }
  if (node.type === 'text' && node.text) {
    acc.text += node.text;
    return;
  }
  if (node.type === 'hardBreak') {
    acc.text += '\n';
    return;
  }
  serializeChildren(acc, node.content, node.type === 'doc');
}

/** Walk a TipTap JSON doc into sendable prompt text plus mention offsets. */
export function serializePromptEditor(doc: JSONContent | null | undefined): SerializedPrompt {
  const acc: SerializedPrompt = { text: '', mentions: [] };
  if (doc) serializeNode(acc, doc);
  return acc;
}
