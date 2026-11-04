/**
 * In-memory, per-plugin "state notes" a plugin attaches to a peer link it owns, shown by the core Peers hub next
 * to that plugin's use of the link. Core never interprets the text: it validates, bounds and relays it. Notes are
 * never persisted; they are cleared when the plugin stops, when the plugin's use of the link goes, and when the
 * link itself goes.
 */
export type PluginLinkNoteState = 'ok' | 'attention';

export interface PluginLinkNote {
  state: PluginLinkNoteState;
  label: string;
  detail?: string;
}

export const NOTE_LABEL_MAX = 40;
export const NOTE_DETAIL_MAX = 200;
/** Entries one plugin may hold, and entries overall. Over the cap the write is refused, never evicting another's note. */
export const NOTES_PER_PLUGIN_MAX = 64;
export const NOTES_TOTAL_MAX = 512;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Returns a normalized note, or `null` when the input is not a valid note. */
export function parsePluginLinkNote(value: unknown): PluginLinkNote | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { state, label, detail, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (state !== 'ok' && state !== 'attention') return null;
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > NOTE_LABEL_MAX || CONTROL.test(trimmed)) return null;
  if (detail === undefined) return { state, label: trimmed };
  if (typeof detail !== 'string') return null;
  const detailTrimmed = detail.trim();
  if (detailTrimmed.length > NOTE_DETAIL_MAX || CONTROL.test(detailTrimmed)) return null;
  return detailTrimmed ? { state, label: trimmed, detail: detailTrimmed } : { state, label: trimmed };
}

const keyOf = (pluginId: string, peerInstanceId: string, scope: string): string => JSON.stringify([pluginId, peerInstanceId, scope]);

export class PluginLinkNotes {
  private readonly notes = new Map<string, { pluginId: string; peerInstanceId: string; scope: string; note: PluginLinkNote }>();

  /** `false` when a new entry would exceed a cap. Replacing an existing entry always succeeds. */
  set(pluginId: string, peerInstanceId: string, scope: string, note: PluginLinkNote): boolean {
    const key = keyOf(pluginId, peerInstanceId, scope);
    if (!this.notes.has(key)) {
      if (this.notes.size >= NOTES_TOTAL_MAX) return false;
      let own = 0;
      for (const entry of this.notes.values()) if (entry.pluginId === pluginId) own += 1;
      if (own >= NOTES_PER_PLUGIN_MAX) return false;
    }
    this.notes.set(key, { pluginId, peerInstanceId, scope, note: { ...note } });
    return true;
  }

  get(pluginId: string, peerInstanceId: string, scope: string): PluginLinkNote | undefined {
    const entry = this.notes.get(keyOf(pluginId, peerInstanceId, scope));
    return entry ? { ...entry.note } : undefined;
  }

  clear(pluginId: string, peerInstanceId: string, scope: string): void {
    this.notes.delete(keyOf(pluginId, peerInstanceId, scope));
  }

  /** A plugin's use of a link was dropped; `scope` omitted drops every scope of that plugin on the peer. */
  clearUse(pluginId: string, peerInstanceId: string, scope?: string): void {
    for (const [key, entry] of this.notes) {
      if (entry.pluginId === pluginId && entry.peerInstanceId === peerInstanceId && (scope === undefined || entry.scope === scope)) this.notes.delete(key);
    }
  }

  clearPeer(peerInstanceId: string): void {
    for (const [key, entry] of this.notes) if (entry.peerInstanceId === peerInstanceId) this.notes.delete(key);
  }

  clearPlugin(pluginId: string): void {
    for (const [key, entry] of this.notes) if (entry.pluginId === pluginId) this.notes.delete(key);
  }

  /** Backstop: drop every note whose (plugin, peer, scope) is not among the currently live uses. */
  retainOnly(live: ReadonlySet<string>): void {
    for (const [key, entry] of this.notes) if (!live.has(keyOf(entry.pluginId, entry.peerInstanceId, entry.scope))) this.notes.delete(key);
  }

  static liveKey(pluginId: string, peerInstanceId: string, scope: string): string {
    return keyOf(pluginId, peerInstanceId, scope);
  }

  get size(): number {
    return this.notes.size;
  }
}
