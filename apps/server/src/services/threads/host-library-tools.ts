/**
 * Host library_* DynamicTools for conversation threads.
 *
 * Node-safe project-scoped slice of LibraryStore (no Electron). Writes go to
 * `<project>/.zcc/library` so the desktop LibraryStore watcher picks them up.
 * projectId is closed over from the owning conversation row (Rule 1).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import type { LibraryDoc, LibraryManifest } from '@zana-ai/zcc-domain/product';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { confine } from '../projects/fs.js';
import {
  LIBRARY_LIST_DESCRIPTION,
  LIBRARY_READ_DESCRIPTION,
  LIBRARY_REMOVE_DESCRIPTION,
  LIBRARY_WRITE_DESCRIPTION
} from '../library/library-mcp-tools.js';

export const LIBRARY_WRITE_NAME = 'library_write';
export const LIBRARY_READ_NAME = 'library_read';
export const LIBRARY_LIST_NAME = 'library_list';
export const LIBRARY_REMOVE_NAME = 'library_remove';

export const HOST_LIBRARY_INSTRUCTION =
  'Persist project knowledge with `library_write` / `library_read` / `library_list` / `library_remove` (this project\'s `.zcc/library`).';

const MAX_AGENT_READ_BYTES = 10 * 1024 * 1024;
const FRONT_MATTER_FENCE = '---';
const MAX_FRONT_MATTER_TAGS = 100;

export const HOST_LIBRARY_TOOLS: DynamicTool[] = [
  {
    name: LIBRARY_WRITE_NAME,
    description: LIBRARY_WRITE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['relPath'],
      properties: {
        relPath: { type: 'string', minLength: 1 },
        title: { type: 'string' },
        content: { type: 'string' },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      }
    },
    presentation: {
      label: { pending: 'Saving library doc', completed: 'Saved library doc' },
      icon: { glyph: 'Book' }
    }
  },
  {
    name: LIBRARY_READ_NAME,
    description: LIBRARY_READ_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['relPath'],
      properties: { relPath: { type: 'string', minLength: 1 } }
    },
    presentation: {
      label: { pending: 'Reading library doc', completed: 'Read library doc' },
      icon: { glyph: 'BookOpen' }
    }
  },
  {
    name: LIBRARY_LIST_NAME,
    description: LIBRARY_LIST_DESCRIPTION,
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    presentation: {
      label: { pending: 'Listing library', completed: 'Listed library' },
      icon: { glyph: 'Library' }
    }
  },
  {
    name: LIBRARY_REMOVE_NAME,
    description: LIBRARY_REMOVE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['relPath'],
      properties: { relPath: { type: 'string', minLength: 1 } }
    },
    presentation: {
      label: { pending: 'Removing library doc', completed: 'Removed library doc' },
      icon: { glyph: 'Trash' }
    }
  }
];

function fail(name: string, error: string): ToolCallResponse {
  return pluginToolResultToResponse(name, { ok: false, error });
}

function row(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function kindFromExt(ext: string): LibraryDoc['kind'] {
  const lower = ext.toLowerCase();
  if (lower === '.md' || lower === '.markdown') return 'md';
  if (lower === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(lower)) return 'image';
  return 'other';
}

function validateAgentRelPath(relPath: string): void {
  if (!relPath || relPath.trim() === '') throw new Error('relPath is required');
  const normalized = relPath.split('\\').join('/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error('relPath must be relative, not absolute');
  }
  if (normalized.includes('..')) throw new Error('relPath must not contain ".." (path traversal)');
  const segments = normalized.split('/').filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg.startsWith('.')) {
      throw new Error(`relPath segment "${seg}" is reserved (no dot-prefixed names)`);
    }
  }
  if (segments[segments.length - 1] === 'index.json') {
    throw new Error('relPath "index.json" is reserved (the library manifest)');
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readManifest(dir: string): LibraryManifest {
  const path = join(dir, 'index.json');
  if (!existsSync(path)) return { version: 1, docs: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LibraryManifest>;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.docs)) return { version: 1, docs: [] };
    const docs = raw.docs.filter(
      (d: Partial<LibraryDoc>) =>
        d &&
        typeof d.id === 'string' &&
        typeof d.relPath === 'string' &&
        typeof d.title === 'string' &&
        typeof d.kind === 'string' &&
        typeof d.createdAt === 'number' &&
        typeof d.updatedAt === 'number'
    ) as LibraryDoc[];
    return { version: 1, docs };
  } catch {
    return { version: 1, docs: [] };
  }
}

function writeManifest(dir: string, manifest: LibraryManifest): void {
  ensureDir(dir);
  const path = join(dir, 'index.json');
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  renameSync(tmp, path);
}

function serializeFrontMatter(
  meta: { id: string; title: string; summary?: string; tags?: string[]; createdAt: number; sourceKind?: string },
  body: string
): string {
  const lines: string[] = [FRONT_MATTER_FENCE];
  lines.push(`id: ${JSON.stringify(meta.id)}`);
  lines.push(`title: ${JSON.stringify(meta.title)}`);
  if (meta.summary !== undefined) lines.push(`summary: ${JSON.stringify(meta.summary)}`);
  if (meta.tags && meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
  }
  if (meta.sourceKind) lines.push(`source: ${JSON.stringify(meta.sourceKind)}`);
  lines.push(`createdAt: ${meta.createdAt}`);
  lines.push(FRONT_MATTER_FENCE);
  lines.push('');
  return `${lines.join('\n')}${body}`;
}

function parseFrontMatter(raw: string): { meta: { id?: string; title?: string; summary?: string; tags?: string[]; createdAt?: number; sourceKind?: string }; body: string } | null {
  if (!raw.startsWith(`${FRONT_MATTER_FENCE}\n`)) return null;
  const needle = `\n${FRONT_MATTER_FENCE}`;
  let end = raw.indexOf(needle, FRONT_MATTER_FENCE.length);
  while (end >= 0) {
    const after = raw[end + needle.length];
    if (after === undefined || after === '\n') break;
    end = raw.indexOf(needle, end + needle.length);
  }
  if (end < 0) return null;
  const block = raw.slice(FRONT_MATTER_FENCE.length + 1, end);
  const afterFence = raw.indexOf('\n', end + 1);
  const body = afterFence < 0 ? '' : raw.slice(afterFence + 1);
  const meta: { id?: string; title?: string; summary?: string; tags?: string[]; createdAt?: number; sourceKind?: string } = {};
  const decode = (v: string): string => {
    const t = v.trim();
    if (t.startsWith('"')) {
      try {
        return JSON.parse(t) as string;
      } catch {
        return t;
      }
    }
    return t;
  };
  for (const line of block.split('\n')) {
    const sepIdx = line.indexOf(':');
    if (sepIdx < 0) continue;
    const key = line.slice(0, sepIdx).trim();
    const val = line.slice(sepIdx + 1).trim();
    if (key === 'id') meta.id = decode(val);
    else if (key === 'title') meta.title = decode(val);
    else if (key === 'summary') meta.summary = decode(val);
    else if (key === 'source') meta.sourceKind = decode(val);
    else if (key === 'createdAt') {
      const n = Number(val);
      if (Number.isFinite(n)) meta.createdAt = n;
    } else if (key === 'tags') {
      const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
      if (inner) {
        meta.tags = inner.split(',').slice(0, MAX_FRONT_MATTER_TAGS).map((t) => decode(t)).filter((t) => t.length > 0);
      }
    }
  }
  return { meta, body };
}

function libraryDir(ctx: ProductHttpContext, projectId: string): string {
  const project = ctx.toProjects().find((p) => p.id === projectId);
  if (!project?.path) throw new Error(`unknown project: ${projectId}`);
  return join(project.path, '.zcc', 'library');
}

function confineAgentPath(dir: string, relPath: string): string {
  validateAgentRelPath(relPath);
  ensureDir(dir);
  const c = confine(dir, join(dir, relPath));
  if (!c.ok) throw new Error(`relPath rejected: ${c.message}`);
  return c.path;
}

function summarize(doc: LibraryDoc) {
  return {
    relPath: doc.relPath,
    title: doc.title,
    summary: doc.summary,
    tags: doc.tags,
    kind: doc.kind,
    updatedAt: doc.updatedAt
  };
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (base: string): void => {
    let names: string[];
    try {
      names = readdirSync(base);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.') || name === 'index.json') continue;
      const abs = join(base, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else found.push(abs);
    }
  };
  walk(dir);
  return found;
}

export async function invokeHostLibraryTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name, threadId, projectId, input } = args;
  const fields = row(input);
  try {
    const dir = libraryDir(ctx, projectId);

    if (name === LIBRARY_LIST_NAME) {
      const manifest = readManifest(dir);
      const byPath = new Map(manifest.docs.map((d) => [d.relPath, d]));
      const docs: LibraryDoc[] = [];
      for (const abs of walkFiles(dir)) {
        const relPath = relative(dir, abs).split(sep).join('/');
        const existing = byPath.get(relPath);
        if (existing) {
          docs.push(existing);
        } else {
          const st = statSync(abs);
          docs.push({
            id: '',
            relPath,
            title: relPath,
            kind: kindFromExt(extname(relPath)),
            createdAt: st.ctimeMs,
            updatedAt: st.mtimeMs,
            bytes: st.size
          });
        }
      }
      docs.sort((a, b) => b.updatedAt - a.updatedAt);
      return pluginToolResultToResponse(name, docs.map(summarize));
    }

    if (name === LIBRARY_READ_NAME) {
      const relPath = typeof fields.relPath === 'string' ? fields.relPath : '';
      const absPath = confineAgentPath(dir, relPath);
      if (!existsSync(absPath)) throw new Error(`no such doc: ${relPath}`);
      const st = statSync(absPath);
      if (st.size > MAX_AGENT_READ_BYTES) {
        throw new Error(`"${relPath}" is too large to read (${st.size} bytes > ${MAX_AGENT_READ_BYTES} limit)`);
      }
      const raw = readFileSync(absPath, 'utf8');
      const isMd = kindFromExt(extname(relPath)) === 'md';
      const fm = isMd ? parseFrontMatter(raw) : null;
      const content = fm ? fm.body : raw;
      const entry = readManifest(dir).docs.find((d) => d.relPath === relPath);
      const base = entry ?? {
        id: fm?.meta.id ?? '',
        relPath,
        title: fm?.meta.title ?? relPath,
        summary: fm?.meta.summary,
        tags: fm?.meta.tags,
        kind: kindFromExt(extname(relPath)),
        createdAt: fm?.meta.createdAt ?? st.ctimeMs,
        updatedAt: st.mtimeMs,
        bytes: st.size
      };
      return pluginToolResultToResponse(name, { ...summarize(base), content });
    }

    if (name === LIBRARY_WRITE_NAME) {
      const relPath = typeof fields.relPath === 'string' ? fields.relPath : '';
      const absPath = confineAgentPath(dir, relPath);
      const isMd = kindFromExt(extname(relPath)) === 'md';
      const manifest = readManifest(dir);
      const existing = manifest.docs.find((d) => d.relPath === relPath);
      if (existing && existing.source?.kind !== 'agent') {
        throw new Error(`"${relPath}" was authored by ${existing.source?.kind ?? 'a non-agent source'}; agents may only modify agent-authored docs`);
      }
      if (!existing && existsSync(absPath)) {
        const onDiskFm = isMd ? parseFrontMatter(readFileSync(absPath, 'utf8')) : null;
        if (onDiskFm?.meta.sourceKind !== 'agent') {
          throw new Error(`"${relPath}" already exists on disk and is not agent-authored; agents may only modify agent-authored docs`);
        }
      }
      const id = existing?.id ?? randomUUID();
      const createdAt = existing?.createdAt ?? Date.now();
      const title = (typeof fields.title === 'string' ? fields.title : undefined) ?? existing?.title ?? relPath;
      const summary = (typeof fields.summary === 'string' ? fields.summary : undefined) ?? existing?.summary;
      const tags = Array.isArray(fields.tags)
        ? fields.tags.filter((t): t is string => typeof t === 'string')
        : existing?.tags;
      if (fields.content !== undefined) {
        if (typeof fields.content !== 'string') throw new Error('content must be a string');
        ensureDir(dirname(absPath));
        const onDisk = isMd
          ? serializeFrontMatter({ id, title, summary, tags, createdAt, sourceKind: 'agent' }, fields.content)
          : fields.content;
        writeFileSync(absPath, onDisk, 'utf8');
      } else if (!existing && !existsSync(absPath)) {
        throw new Error(`"${relPath}" does not exist yet — pass content to create it`);
      } else if (fields.content === undefined && isMd && existsSync(absPath)) {
        const fm = parseFrontMatter(readFileSync(absPath, 'utf8'));
        const body = fm ? fm.body : readFileSync(absPath, 'utf8');
        writeFileSync(
          absPath,
          serializeFrontMatter({ id, title, summary, tags, createdAt, sourceKind: 'agent' }, body),
          'utf8'
        );
      }
      let bytes = 0;
      let updatedAt = Date.now();
      if (existsSync(absPath)) {
        const st = statSync(absPath);
        bytes = st.size;
        updatedAt = st.mtimeMs;
      }
      const source: LibraryDoc['source'] = { kind: 'agent', sessionId: threadId, projectId };
      let doc: LibraryDoc;
      if (existing) {
        existing.title = title;
        existing.summary = summary;
        existing.tags = tags;
        existing.bytes = bytes;
        existing.updatedAt = updatedAt;
        existing.source = source;
        doc = existing;
      } else {
        doc = {
          id,
          relPath,
          title,
          summary,
          tags,
          kind: kindFromExt(extname(relPath)),
          createdAt,
          updatedAt,
          bytes,
          source
        };
        manifest.docs.push(doc);
      }
      writeManifest(dir, manifest);
      ctx.hub.emit('library:changed', { projectId });
      return pluginToolResultToResponse(name, { ok: true, ...summarize(doc), bytes: doc.bytes });
    }

    if (name === LIBRARY_REMOVE_NAME) {
      const relPath = typeof fields.relPath === 'string' ? fields.relPath : '';
      const absPath = confineAgentPath(dir, relPath);
      const manifest = readManifest(dir);
      const idx = manifest.docs.findIndex((d) => d.relPath === relPath);
      if (idx >= 0) {
        const entry = manifest.docs[idx];
        if (entry.source?.kind !== 'agent') {
          throw new Error(`"${relPath}" was authored by ${entry.source?.kind ?? 'a non-agent source'}; agents may only remove agent-authored docs`);
        }
        manifest.docs.splice(idx, 1);
        writeManifest(dir, manifest);
      } else if (existsSync(absPath)) {
        const isMd = kindFromExt(extname(relPath)) === 'md';
        const onDiskFm = isMd ? parseFrontMatter(readFileSync(absPath, 'utf8')) : null;
        if (onDiskFm?.meta.sourceKind !== 'agent') {
          throw new Error(`"${relPath}" exists on disk but is not agent-authored; agents may only remove agent-authored docs`);
        }
      } else {
        return pluginToolResultToResponse(name, { ok: true, removed: false, relPath });
      }
      if (existsSync(absPath)) rmSync(absPath);
      ctx.hub.emit('library:changed', { projectId });
      return pluginToolResultToResponse(name, { ok: true, removed: true, relPath });
    }

    return fail(name, `Unsupported library tool: ${name}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : `${name} failed`);
  }
}
