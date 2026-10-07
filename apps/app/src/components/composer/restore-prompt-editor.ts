import type { JSONContent } from '@tiptap/react';
import type { PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
export function promptEditorDocument(input: readonly PromptInput[]): JSONContent {
  const content: JSONContent[] = [];
  for (const part of input) {
    if (part.type !== 'text') continue;
    if (content.length) content.push({ type: 'hardBreak' });
    let offset = 0;
    for (const mention of [...part.mentions].sort((a,b) => a.start-b.start)) {
      if (!Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.end) || mention.start < offset || mention.end <= mention.start || mention.end > part.text.length) continue;
      if (mention.start > offset) content.push({type:'text', text:part.text.slice(offset,mention.start)});
      const text = part.text.slice(mention.start, mention.end);
      content.push({type:'mention', attrs:{id:JSON.stringify(mention.resource), label:text, serializedText:text, resource:mention.resource}});
      offset = mention.end;
    }
    if (offset < part.text.length) content.push({type:'text', text:part.text.slice(offset)});
  }
  return { type:'doc', content:[{type:'paragraph', content}] };
}
