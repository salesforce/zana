/**
 * Thread ↔ session map for the live bot.
 *
 * Maps a Slack thread (channel + parent ts) to the ZCC session launched from
 * it, so the poll loop can route in-thread follow-ups and lifecycle replies to
 * the right session. CU backs this with SQLite; ZCC plugins persist through
 * the namespaced JSON KV (`ctx.storage`), matching the existing config store —
 * pulling sqlite into a plugin would fight the brokered, JSON-only store a
 * disk extension gets.
 *
 * In-memory cache + write-through to one storage key. The record set is tiny
 * (one row per active session), so loading/saving the whole map is cheap.
 */

import type { MainModuleContext } from '@zana-ai/zcc-extension-sdk/main';

/** One thread↔session link. */
export interface ThreadRecord {
  /** Channel id the thread lives in. */
  channel: string;
  /** Parent message ts — the thread's stable key. */
  parentTs: string;
  /** Linked ZCC session id, or null while a launch is still pending. */
  sessionId: string | null;
  /** When the link was created (ms epoch; passed in — the loop owns the clock). */
  createdAt: number;
}

const STORAGE_KEY = 'bot.threads';

export class ThreadStore {
  private records = new Map<string, ThreadRecord>();
  private loaded = false;

  constructor(private readonly storage: MainModuleContext['storage']) {}

  /** Load the persisted map once. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (this.loaded) return;
    const saved = await this.storage.get<ThreadRecord[]>(STORAGE_KEY);
    if (Array.isArray(saved)) {
      for (const r of saved) {
        if (r && typeof r.channel === 'string' && typeof r.parentTs === 'string') {
          this.records.set(key(r.channel, r.parentTs), r);
        }
      }
    }
    this.loaded = true;
  }

  /** Create/replace a link. `sessionId` may be null until the launch resolves. */
  link(channel: string, parentTs: string, sessionId: string | null, createdAt: number): void {
    this.records.set(key(channel, parentTs), { channel, parentTs, sessionId, createdAt });
    this.persist();
  }

  /** The link for a thread, if any. */
  get(channel: string, parentTs: string): ThreadRecord | undefined {
    return this.records.get(key(channel, parentTs));
  }

  /** Find the thread a session was launched into, if any. */
  findBySession(sessionId: string): ThreadRecord | undefined {
    for (const r of this.records.values()) {
      if (r.sessionId === sessionId) return r;
    }
    return undefined;
  }

  /** Drop a link (e.g. Slack reports the thread/channel is gone). */
  remove(channel: string, parentTs: string): void {
    if (this.records.delete(key(channel, parentTs))) this.persist();
  }

  /** Every linked thread — the poll loop reads these to follow replies. */
  list(): ThreadRecord[] {
    return Array.from(this.records.values());
  }

  private persist(): void {
    this.storage.set(STORAGE_KEY, Array.from(this.records.values()));
  }
}

/** Composite key. Slack ts values are dotted floats — never contain `\n`. */
function key(channel: string, parentTs: string): string {
  return `${channel}\n${parentTs}`;
}
