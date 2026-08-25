/** Custom drag payload for explorer tree/changes rows dropped onto the composer. */
export const FS_ENTRY_DRAG_MIME = 'application/x-zcc-fs-entry';

export interface FsEntryDragPayload {
  path: string;
  kind: 'file' | 'dir';
}

function isFsEntryDragPayload(value: unknown): value is FsEntryDragPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string'
    && record.path.length > 0
    && (record.kind === 'file' || record.kind === 'dir')
  );
}

export function serializeFsEntryDrag(entry: FsEntryDragPayload): string {
  return JSON.stringify({ path: entry.path, kind: entry.kind });
}

export function parseFsEntryDrag(raw: string): FsEntryDragPayload[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.filter(isFsEntryDragPayload);
  } catch {
    return [];
  }
}
