/**
 * Adapted from BB Docs, copyright (c) 2026 Michael Yong, MIT license.
 * Source: get-bb/bb@35a03bbbb3f4d8dc814c1a152db5a463102b4250, plugins/docs/markdown-blocks.ts.
 * License: docs/third-party/BB-LICENSE (also included in production bundle banners).
 */
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { markdownBlocks, markdownBody } from './markdown-source.js';

interface Block { source: string; after: string; nodes: ProseMirrorNode[] }
export interface MarkdownBlocks { header: string; leading: string; blocks: Block[]; newline: boolean; lineEnding: string; source: string; originalDoc: ProseMirrorNode }

/** Source spans live below one continuous editor; untouched nodes keep their original bytes. */
export function loadMarkdownBlocks(editor: Editor, source: string, previous?: MarkdownBlocks): MarkdownBlocks {
  const spans = markdownBlocks(source);
  const definitions = spans.filter(block => block.kind === 'definition').map(block => block.source).join('\n');
  const reusable = new Map<string, ProseMirrorNode[]>();
  if (previous) {
    const originals = new Map(previous.blocks.flatMap(block => block.nodes.length === 1 ? [[block.nodes[0]!, block.source] as const] : []));
    editor.state.doc.forEach(node => {
      const original = originals.get(node);
      if (original !== undefined) reusable.set(original, [...(reusable.get(original) ?? []), node]);
    });
  }
  const blocks = spans.map((span, index): Block => {
    const after = source.slice(span.end, spans[index + 1]?.start ?? source.length);
    if (span.kind === 'definition') return { source: span.source, after, nodes: [] };
    let nodes: ProseMirrorNode[] = [];
    if (span.editable) {
      try {
        const parsed = editor.markdown!.parse(span.source + (definitions ? `\n\n${definitions}` : ''));
        nodes = (parsed.content ?? []).map(json => {
          const node = editor.schema.nodeFromJSON(json);
          node.check();
          return node.isInline ? editor.schema.nodes.paragraph!.create(null, node) : node;
        });
      } catch { /* Preserve syntax the rich schema cannot represent. */ }
    }
    if (!nodes.length) nodes = [editor.schema.nodes.markdownSource!.create(null, editor.schema.text(span.source))];
    const reused = reusable.get(span.source)?.shift();
    if (reused && nodes.length === 1 && reused.eq(nodes[0]!)) nodes = [reused];
    return { source: span.source, after, nodes };
  });
  const nodes = blocks.flatMap(block => block.nodes);
  const doc = editor.schema.topNodeType.createAndFill(null, nodes)!;
  const current = editor.state.doc.content;
  const transaction = editor.state.tr;
  const start = current.findDiffStart(doc.content);
  if (start !== null) {
    let { a, b } = current.findDiffEnd(doc.content)!;
    const overlap = start - Math.min(a, b);
    if (overlap > 0) { a += overlap; b += overlap; }
    transaction.replace(start, a, doc.slice(start, b));
  }
  editor.view.dispatch(transaction.setMeta('addToHistory', false).setMeta('preventUpdate', true));
  // ProseMirror may have joined compatible nodes during the transaction.
  const live: ProseMirrorNode[] = [];
  editor.state.doc.forEach(node => live.push(node));
  let index = 0;
  for (const block of blocks) {
    block.nodes = live.slice(index, index + block.nodes.length);
    index += block.nodes.length;
  }
  const { offset } = markdownBody(source);
  return { header: source.slice(0, offset), leading: source.slice(offset, spans[0]?.start ?? source.length), blocks, newline: source.endsWith('\n'), lineEnding: source.includes('\r\n') ? '\r\n' : '\n', source, originalDoc: editor.state.doc };
}

export function serializeMarkdownNodes(editor: Editor, nodes: ProseMirrorNode[]): string {
  return editor.markdown!.serialize(editor.schema.topNodeType.create(null, nodes).toJSON()).replace(/^(?:\r?\n)+/, '');
}

export function saveMarkdownBlocks(
  editor: Editor,
  loaded: MarkdownBlocks,
  serialize: (nodes: ProseMirrorNode[]) => string,
): string {
  if (editor.state.doc.eq(loaded.originalDoc)) return loaded.source;
  const { blocks } = loaded;
  const owner = new Map<ProseMirrorNode, number>();
  blocks.forEach((block, index) => {
    if (block.nodes[0]) owner.set(block.nodes[0], index);
  });
  const children: ProseMirrorNode[] = [];
  editor.state.doc.forEach((node) => children.push(node));
  const parts: { text: string; block?: number }[] = [];
  let edited: ProseMirrorNode[] = [];
  const flush = () => {
    if (edited.length)
      parts.push({ text: serialize(edited).replace(/\r?\n/g, loaded.lineEnding).replace(/[\r\n]+$/, '') });
    edited = [];
  };
  for (let index = 0; index < children.length;) {
    const block = owner.get(children[index]!);
    const nodes = block === undefined ? [] : blocks[block]!.nodes;
    if (
      block !== undefined &&
      nodes.every((node, offset) => children[index + offset] === node)
    ) {
      flush();
      parts.push({ text: blocks[block]!.source, block });
      index += nodes.length;
    } else edited.push(children[index++]!);
  }
  flush();
  const nextShown = (from: number) => {
    let next = from + 1;
    while (blocks[next] && !blocks[next]!.nodes.length) next++;
    return next;
  };
  const between = (from: number, to: number) =>
    (from < 0 ? '' : blocks[from]!.after) +
    blocks
      .slice(from + 1, to)
      .map((block) => block.source + block.after)
      .join('');
  const hidden = (from: number, to: number) =>
    blocks
      .slice(from + 1, to)
      .filter((block) => !block.nodes.length)
      .map((block) => block.source);
  let out = loaded.leading;
  const append = (text: string) => {
    if (text) out += (out.trim() ? `${loaded.lineEnding}${loaded.lineEnding}` : '') + text;
  };
  let anchor = -1;
  let clean = true;
  for (const part of parts) {
    if (part.block === undefined) {
      append(part.text);
      clean = false;
    } else {
      if (clean && part.block === nextShown(anchor))
        out += between(anchor, part.block) + part.text;
      else {
        hidden(anchor, part.block).forEach(append);
        append(part.text);
      }
      anchor = part.block;
      clean = true;
    }
  }
  if (clean && nextShown(anchor) >= blocks.length)
    return loaded.header + out + between(anchor, blocks.length);
  hidden(anchor, blocks.length).forEach(append);
  return loaded.header + (loaded.newline ? `${out}${loaded.lineEnding}` : out);
}
