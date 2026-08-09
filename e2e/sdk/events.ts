/**
 * EventRecorder — the e2e SDK's window onto the app's LIVE main→renderer event
 * and log stream.
 *
 * The main process records every `safeSend(channel, ...args)` push and every
 * `logMainError` / `console.*` line into a bounded ring buffer (src/main/test-tap.ts),
 * exposed to the renderer via `window.__zccTest.drainEvents(cursor)` — but ONLY
 * when the app was launched with `ZCC_E2E=1` (the fixture's `e2e: true` option).
 * This class polls that cursor-based drain and lets a spec assert on an ORDERED
 * timeline instead of racing UI state or polling per-domain snapshots.
 *
 * Because the buffer lives in main, it captures events emitted BEFORE the
 * renderer subscribed and SURVIVES a `window.reload()` — the two things a
 * renderer-side `ipcRenderer.on` tap could never do.
 *
 * Usage:
 *   const rec = new EventRecorder(app.window);
 *   // ... drive the app (spawn an agent, inspect a report, etc.) ...
 *   await rec.waitForChannel('terminals:onExit');
 *   rec.assertOrder(['terminals:onAgentStatus', 'terminals:onExit']);
 */
import type { Page } from '@playwright/test';

export type RecordedKind = 'event' | 'log';

export interface RecordedEntry {
  seq: number;
  ts: number;
  kind: RecordedKind;
  /** For 'event': the IPC channel. For 'log': `log:<level>`. */
  channel: string;
  args: unknown[];
}

interface DrainResult {
  entries: RecordedEntry[];
  cursor: number;
}

interface SnapshotResult {
  seq: number;
  size: number;
  cap: number;
}

/** Minimal shape of the gated `window.__zccTest` bridge (see preload). */
interface ZccTestBridge {
  drainEvents(cursor: number): Promise<DrainResult>;
  snapshot(): Promise<SnapshotResult>;
  reset(): Promise<void>;
}

declare global {
  interface Window {
    __zccTest?: ZccTestBridge;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;

export class EventRecorder {
  private cursor = 0;
  private readonly buffer: RecordedEntry[] = [];

  constructor(private readonly window: Page) {}

  /** Assert the gated bridge is present — fail loudly if the spec forgot `e2e: true`. */
  async assertAvailable(): Promise<void> {
    const present = await this.window.evaluate(() => typeof window.__zccTest !== 'undefined');
    if (!present) {
      throw new Error(
        'window.__zccTest is undefined — the app was not launched with the e2e tap. ' +
          "Add `test.use({ e2e: true })` to the spec (see e2e/fixtures/app.ts)."
      );
    }
  }

  /** Pull everything new since the last poll into the local buffer; return the new batch. */
  async poll(): Promise<RecordedEntry[]> {
    const res = await this.window.evaluate(
      (c) => window.__zccTest!.drainEvents(c),
      this.cursor
    );
    this.cursor = res.cursor;
    this.buffer.push(...res.entries);
    return res.entries;
  }

  /** Everything captured so far, ordered by seq (a defensive copy). */
  collect(): RecordedEntry[] {
    return this.buffer.slice();
  }

  /** Just the event (non-log) channels seen so far, in order. */
  channels(): string[] {
    return this.buffer.filter((e) => e.kind === 'event').map((e) => e.channel);
  }

  /**
   * Poll until an entry matches `predicate` (or throw on timeout). Re-scans
   * already-buffered entries first, so an event that fired before this call is
   * still found. Returns the matching entry.
   */
  async waitForEvent(
    predicate: (e: RecordedEntry) => boolean,
    timeout = DEFAULT_TIMEOUT_MS
  ): Promise<RecordedEntry> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const hit = this.buffer.find(predicate);
      if (hit) return hit;
      if (Date.now() > deadline) {
        const tail = this.buffer.slice(-20).map((e) => e.channel).join(', ');
        throw new Error(
          `EventRecorder.waitForEvent timed out after ${timeout}ms. ` +
            `Buffered ${this.buffer.length} entries; last: [${tail}]`
        );
      }
      await this.poll();
      await this.window.waitForTimeout(POLL_INTERVAL_MS);
    }
  }

  /** Convenience: wait for an exact channel string. */
  waitForChannel(channel: string, timeout?: number): Promise<RecordedEntry> {
    return this.waitForEvent((e) => e.channel === channel, timeout);
  }

  /**
   * Assert a set of channels occurred in the given RELATIVE order (other channels
   * may interleave). Scans the current buffer — call `poll()`/`waitForChannel`
   * first to ensure the events have been drained.
   */
  assertOrder(channels: string[]): void {
    let i = 0;
    for (const e of this.buffer) {
      if (e.kind === 'event' && e.channel === channels[i]) i += 1;
      if (i === channels.length) return;
    }
    const seen = this.channels().join(', ');
    throw new Error(
      `EventRecorder.assertOrder: expected [${channels.join(' → ')}] in order; ` +
        `matched ${i}/${channels.length}. Saw: [${seen}]`
    );
  }

  /**
   * Clear the ring and start a fresh local buffer. Re-reads the current `seq`
   * (main keeps it monotonic across reset) so entries arriving between the
   * snapshot and reset aren't double-counted or skipped on the next poll.
   */
  async reset(): Promise<void> {
    const snap = await this.window.evaluate(() => window.__zccTest!.snapshot());
    await this.window.evaluate(() => window.__zccTest!.reset());
    this.cursor = snap.seq;
    this.buffer.length = 0;
  }
}
