import { createContext, useContext } from 'react';
import type { ProjectFileScope } from '@zana-ai/zcc-desktop-contract';
import { Node } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { DocumentImage } from '../DocumentImage.js';

export interface MarkdownImageScope {
  documentPath: string;
  threadId?: string;
  storage?: boolean;
  localImages?: boolean;
  fileScope?: ProjectFileScope;
}
export const MarkdownImageContext = createContext<MarkdownImageScope>({ documentPath: '', localImages: false });

/** Images use the same authorized reader as Read mode, never the renderer URL. */
export function MarkdownEditorImage({ node }: NodeViewProps) {
  const scope = useContext(MarkdownImageContext);
  const src = String(node.attrs.src ?? '');
  const alt = String(node.attrs.alt ?? '');
  const title = node.attrs.title == null ? undefined : String(node.attrs.title);
  return <NodeViewWrapper as="span" className="md-editor-image" contentEditable={false}>
    {/^https?:\/\//i.test(src) ? <img src={src} alt={alt} title={title} loading="lazy" /> : scope.localImages
      ? <DocumentImage {...scope} src={src} alt={alt} title={title} /> : <span title={src}>{alt}</span>}
  </NodeViewWrapper>;
}

export const MarkdownImage = Image.extend({
  addNodeView() { return ReactNodeViewRenderer(MarkdownEditorImage); },
  renderMarkdown(node) {
    const escape = (value: unknown, characters: RegExp) => String(value ?? '').replace(characters, '\\$&');
    const alt = escape(node.attrs?.alt, /[\\\[\]]/g);
    const src = escape(node.attrs?.src, /[\\<>]/g).replace(/[\r\n]/g, '%0A');
    const title = node.attrs?.title ? ` "${escape(node.attrs.title, /[\\"]/g)}"` : '';
    return `![${alt}](<${src}>${title})`;
  }
}).configure({ inline: true, allowBase64: false });

/** Unsupported syntax is editable as literal text and is never interpreted as HTML. */
export const MarkdownSource = Node.create({
  name: 'markdownSource',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-markdown-source]' }],
  renderHTML: () => ['div', { 'data-markdown-source': '', class: 'md-editor-source' }, ['pre', {}, ['code', {}, 0]]],
  markdownTokenName: 'html',
  parseMarkdown: token => ({ type: 'markdownSource', content: token.raw ? [{ type: 'text', text: token.raw }] : [] }),
  renderMarkdown: node => (node.content ?? []).map(child => child.text ?? '').join('')
});
