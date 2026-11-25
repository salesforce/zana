import { parse as parseYaml } from 'yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

interface MarkdownNode {
  type: string;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  align?: (string | null)[];
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const supported = new Set(['paragraph', 'heading', 'text', 'emphasis', 'strong', 'delete', 'inlineCode', 'break', 'link', 'list', 'listItem', 'blockquote', 'code', 'thematicBreak', 'table', 'tableRow', 'tableCell', 'image', 'imageReference', 'linkReference']);

/** Offsets always refer to the original string, including BOM and CRLF. */
export function markdownBody(source: string): { body: string; offset: number } {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const text = source.slice(bom);
  // Scan delimiters without normalizing newlines: the renderer helper only
  // recognizes LF, while editing must keep CRLF offsets and metadata intact.
  let header = /^---[ \t]*\r?\n([\s\S]*?)(?:^---|^\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(text);
  if (header?.index !== 0) header = null;
  if (header) {
    try {
      const metadata: unknown = parseYaml(header[1]!, { maxAliasCount: 20 });
      if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) header = null;
    } catch { header = null; }
  }
  const offset = bom + (header?.[0].length ?? 0);
  return { body: source.slice(offset), offset };
}

function treeFor(source: string): { root: MarkdownNode; offset: number } {
  const { body, offset } = markdownBody(source);
  return { root: parser.runSync(parser.parse(body)) as MarkdownNode, offset };
}

function canEdit(node: MarkdownNode): boolean {
  return supported.has(node.type) && !(node.type === 'code' && (node.lang === 'mermaid' || node.meta)) && (node.children?.every(canEdit) ?? true);
}

export interface MarkdownBlock { start: number; end: number; source: string; editable: boolean; kind: string }

export function markdownBlocks(source: string): MarkdownBlock[] {
  const { root, offset } = treeFor(source);
  return (root.children ?? []).flatMap(node => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start === undefined || end === undefined ? [] : [{ start: offset + start, end: offset + end, source: source.slice(offset + start, offset + end), editable: canEdit(node), kind: node.type }];
  });
}

/** GFM's parsed task items select the marker; labels and visual indices never do. */
export function markdownTasks(source: string): Map<number, { offset: number; marker: string }> {
  const { root, offset } = treeFor(source);
  const tasks = new Map<number, { offset: number; marker: string }>();
  const visit = (node: MarkdownNode) => {
    const start = node.position?.start.offset;
    if (node.type === 'listItem' && typeof node.checked === 'boolean' && start !== undefined) {
      const match = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+\[)([ xX])\]/.exec(source.slice(offset + start));
      if (match) tasks.set(start, { offset: offset + start + match[1]!.length, marker: match[2]! });
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return tasks;
}

export function toggleMarkdownTask(source: string, bodyStart: number, checked: boolean): string {
  const task = markdownTasks(source).get(bodyStart);
  if (!task || source[task.offset] !== task.marker) return source;
  return source.slice(0, task.offset) + (checked ? 'x' : ' ') + source.slice(task.offset + 1);
}
