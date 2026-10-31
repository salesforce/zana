import { validPromptReferences, type PromptTextReference } from '@zana-ai/zcc-domain/thread-runtime';
import { ContextReferenceBadge } from './editor-selection-extension.js';
import { MarkdownContent } from '../MarkdownContent.js';
import { extractInlineThreadImages } from '../thread/timeline/thread-inline-images.js';

export function compactReferenceText(text: string, references: readonly PromptTextReference[]): string {
  let result = text;
  for (const item of [...references].reverse()) result = result.slice(0, item.start) + ` [${item.reference.label}] ` + result.slice(item.end);
  return result;
}

export function ContextReferenceMessage({text, references, threadId, projectId, maxTextChars = Infinity}: {
  text: string; references: PromptTextReference[]; threadId?: string; projectId?: string | null; maxTextChars?: number;
}) {
  const valid = validPromptReferences(text, references);
  const parts = [];
  let cursor = 0;
  let remaining = maxTextChars;
  const appendText = (raw: string, key: number) => {
    // Image thumbnails are rendered by the enclosing message. Never inspect images
    // inside snapshots, and retain the normal cap on ordinary pasted text.
    const value = extractInlineThreadImages(raw).text;
    if (!value) return;
    const clipped = value.slice(0, remaining);
    parts.push(<MarkdownContent key={`text-${key}`} text={clipped + (clipped.length < value.length ? '…' : '')} breaks threadId={threadId} projectId={projectId} />);
    remaining -= value.length;
  };
  for (const item of valid) {
    if (item.start > cursor) appendText(text.slice(cursor, item.start), cursor);
    if (remaining <= 0) break;
    parts.push(<ContextReferenceBadge key={`ref-${item.start}`} reference={item.reference} />);
    cursor = item.end;
    remaining -= item.reference.label.length + 4;
  }
  if (cursor < text.length && remaining > 0) appendText(text.slice(cursor), cursor);
  return <div className="context-reference-message">{parts}</div>;
}
