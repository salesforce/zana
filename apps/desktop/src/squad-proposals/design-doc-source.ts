import type { SquadProposalErrorCode } from '@zana-ai/zcc-domain/squad-proposal';
import { FILE_MAX_BYTES } from './sources.js';

/**
 * `doc://` plan sources. A Design Doc lives in the Design Docs plugin's own database, so a Squad source named
 * `doc://<id>[/<path>]` is read through the plugin's RPC from main and snapshotted as an attachment: the content
 * is copied into the proposal's private staging folder, never written into the Project. Rule 1 and 2: the doc id
 * comes from an agent, so it is untrusted; the doc must belong to the launching Project (checked here, in main,
 * against the plugin's own record, never against a caller-supplied project), and the content is bounded before it
 * is read and again after.
 */
export const DESIGN_DOCS_PLUGIN_ID = 'design-docs';

/** Calls one Design Docs plugin RPC from main; the wiring owns the transport (`runtimeSupervisor.callPluginRpc`). */
export type DesignDocsRpc = (method: 'get' | 'readFile', args: Record<string, unknown>) => Promise<unknown>;

type Failure = { ok: false; code: SquadProposalErrorCode; message: string };
export type DesignDocSourceOutcome = { ok: true; name: string; text: string; bytes: number; docId: string; path: string } | Failure;

const fail = (code: SquadProposalErrorCode, message: string): Failure => ({ ok: false, code, message });

const DOC_REF = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * `doc://<id>[/<file path>]` (or `doc:<id>/…`; a `#anchor` or `?query` is dropped). The plugin re-validates the id and
 * path; this only keeps obviously hostile shapes (empty, `.`/`..`, backslash, NUL) from reaching it.
 */
export function parseDesignDocSource(source: string): { docRef: string; path: string | null } | null {
  const match = /^doc:(?:\/\/)?([^/#?]*)(?:\/([^#?]*))?/i.exec(source.trim());
  if (!match) return null;
  let ref: string;
  try { ref = decodeURIComponent(match[1]!); } catch { return null; }
  if (!DOC_REF.test(ref)) return null;
  if (match[2] === undefined || match[2] === '') return { docRef: ref, path: null };
  let segments: string[];
  try { segments = match[2].split('/').map((segment) => decodeURIComponent(segment)); } catch { return null; }
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\\\0]/.test(segment))) return null;
  return { docRef: ref, path: segments.join('/') };
}

/** Whether a source string names a design doc (`doc://…` or `doc:…`) rather than a file path. */
export const isDesignDocSource = (source: string): boolean => /^doc:/i.test(source.trim());

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** A safe attachment name from untrusted doc id and path pieces: `design-doc-<id>-<file>`. */
function attachmentName(docId: string, path: string): string {
  const file = (path.split('/').pop() ?? 'plan.md').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  const id = docId.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40);
  return `design-doc-${id}-${file || 'plan.md'}`.slice(0, 120);
}

/**
 * Read the doc file a `doc://` source names. Refused: an unparseable link, a doc the plugin does not know, a doc that
 * belongs to another Project (or to none), a missing file, a binary or oversized file, content that is not text.
 */
export async function readDesignDocSource(rpc: DesignDocsRpc | undefined, projectId: string, source: string): Promise<DesignDocSourceOutcome> {
  if (!rpc) return fail('SOURCE_NOT_ALLOWED', `${source} is a design doc, and design docs are not available here. Copy the plan into a file in the project, or pass it as an attachment.`);
  const link = parseDesignDocSource(source);
  if (!link) return fail('SOURCE_NOT_FILE', `${source} is not a valid design doc link. Use doc://<doc id>/<file path>.`);
  let detail: Record<string, unknown> | undefined;
  try { detail = asRecord(await rpc('get', { doc: link.docRef })); } catch {
    return fail('SOURCE_NOT_FILE', `${source}: no design doc with that id was found.`);
  }
  if (!detail || typeof detail.id !== 'string') return fail('SOURCE_NOT_FILE', `${source}: no design doc with that id was found.`);
  // Same answer for another Project's doc and an unassigned one as for a missing one: do not confirm that it exists.
  if (detail.projectId !== projectId) return fail('SOURCE_NOT_FILE', `${source}: no design doc with that id was found.`);
  const docId = detail.id;
  const path = link.path ?? (typeof detail.entryPath === 'string' ? detail.entryPath : '');
  if (!path) return fail('SOURCE_NOT_FILE', `${source} names no file and the doc has no entry file.`);
  const meta = (Array.isArray(detail.files) ? detail.files : []).map(asRecord).find((file) => file?.path === path);
  if (!meta) return fail('SOURCE_NOT_FILE', `${source}: the doc has no file "${path}".`);
  if (typeof meta.size === 'number' && meta.size > FILE_MAX_BYTES) return fail('SOURCE_TOO_LARGE', `${source} is larger than 4 MiB.`);
  let file: Record<string, unknown> | undefined;
  try { file = asRecord(await rpc('readFile', { doc: docId, path })); } catch {
    return fail('SOURCE_UNREADABLE', `${source} could not be read.`);
  }
  if (!file || typeof file.content !== 'string' || file.encoding !== 'utf8') return fail('SOURCE_NOT_FILE', `${source} is not a text file.`);
  const bytes = Buffer.byteLength(file.content, 'utf8');
  if (bytes > FILE_MAX_BYTES) return fail('SOURCE_TOO_LARGE', `${source} is larger than 4 MiB.`);
  return { ok: true, name: attachmentName(docId, path), text: file.content, bytes, docId, path };
}
