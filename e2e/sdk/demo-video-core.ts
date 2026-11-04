/**
 * Pure logic for narrated demo recordings (no Playwright imports, so it is unit-tested from
 * scripts/demo-video-core.test.ts). The Playwright side lives in e2e/sdk/demo-video.ts.
 */

export interface RecordSize { width: number; height: number }
export const DEFAULT_RECORD_SIZE: RecordSize = { width: 1440, height: 900 };

/** Parse `WIDTHxHEIGHT` (e.g. `1920x1080`). Unset or blank gives the fallback; garbage throws. */
export function parseRecordSize(value: string | undefined, fallback: RecordSize = DEFAULT_RECORD_SIZE): RecordSize {
  const text = value?.trim();
  if (!text) return fallback;
  const match = /^(\d{3,5})x(\d{3,5})$/i.exec(text);
  if (!match) throw new Error(`ZCC_E2E_RECORD_SIZE must look like 1920x1080, got "${value}"`);
  const size = { width: Number(match[1]), height: Number(match[2]) };
  // Video codecs need even dimensions; Playwright rounds silently, which would skew the mix.
  if (size.width % 2 || size.height % 2 || size.width < 320 || size.height < 240 || size.width > 7680 || size.height > 4320) {
    throw new Error(`ZCC_E2E_RECORD_SIZE ${text} must be even and between 320x240 and 7680x4320`);
  }
  return size;
}

export interface NarrationEntry { id?: string; caption: string; ms: number }
export interface TimelineEntry { id?: string; text: string; at: number }

/** Keep a hold shorter than this if the recording is not running yet. */
export const BREATH_MS = 300;

/**
 * Tracks which narration line the recording is on. Lines must be said in narration.json order;
 * each is held until the previous one has been spoken, plus a short breath.
 * With no narration entries (a plain recording) nothing is checked and nothing is held.
 */
export class NarrationCursor {
  readonly timeline: TimelineEntry[] = [];
  private startedAt = 0;

  constructor(private readonly entries: readonly NarrationEntry[], private readonly now: () => number = Date.now) {}

  /** Mark the black-flash moment: timeline offsets are relative to it. */
  start(): void { this.startedAt = this.now(); }

  get hasNarration(): boolean { return this.entries.length > 0; }

  /** Milliseconds still to wait before the previous line has been spoken. */
  holdMs(): number {
    const last = this.timeline.at(-1);
    if (!last || !this.hasNarration) return 0;
    const spoken = this.entries[this.timeline.length - 1]?.ms ?? 0;
    return Math.max(0, this.startedAt + last.at + spoken + BREATH_MS - this.now());
  }

  /** Check the next line is the expected one and record it. Call after waiting `holdMs()`. */
  advance(key: { id?: string; caption?: string }, text: string): TimelineEntry {
    const index = this.timeline.length;
    if (this.hasNarration) {
      const expected = this.entries[index];
      if (!expected) throw new Error(`narration has ${this.entries.length} lines but line ${index + 1} was said`);
      if (key.id !== undefined && expected.id !== key.id) {
        throw new Error(`line ${index} is "${key.id}", narration expects "${expected.id ?? expected.caption}"`);
      }
      if (key.caption !== undefined && expected.caption !== key.caption) {
        throw new Error(`caption ${index} is "${key.caption}", narration expects "${expected.caption}"`);
      }
    }
    const entry: TimelineEntry = { ...(key.id !== undefined ? { id: key.id } : {}), text, at: this.now() - this.startedAt };
    this.timeline.push(entry);
    return entry;
  }

  /** Throws if narration lines were left unsaid, which would desync the mix. */
  assertComplete(): void {
    if (this.hasNarration && this.timeline.length !== this.entries.length) {
      throw new Error(`recorded ${this.timeline.length} of ${this.entries.length} narration lines`);
    }
  }
}

export interface SectionCard { number: number | string; title: string; subtitle?: string; hint?: string }

/** `1` -> `01`; strings pass through. */
export function sectionNumber(value: number | string): string {
  return typeof value === 'number' ? String(value).padStart(2, '0') : value;
}

export interface VideoConfig {
  id: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  version?: string;
  opener: { headline: string; subline?: string; chips: string[]; lines: Array<{ at: number; text: string }>; duration: number; revealAt: number };
  closer?: { headline: string; subline?: string; chips: string[]; line?: string; duration: number };
  posterAt?: number;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Validate a per-video `video.json`; returns the list of problems (empty when valid). */
export function validateVideoConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return ['video.json must be an object'];
  const c = raw as Record<string, any>;
  if (!isText(c.id) || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) errors.push('id must be a lowercase slug');
  if (!isText(c.title)) errors.push('title is required');
  if (![c.width, c.height].every((n) => Number.isInteger(n) && n > 0 && n % 2 === 0) || c.width > 7680 || c.height > 4320) errors.push('width/height must be positive even integers within 7680x4320');
  if (![30, 60].includes(c.fps)) errors.push('fps must be 30 or 60');
  const card = (name: string, v: any, required: boolean) => {
    if (!v) { if (required) errors.push(`${name} is required`); return false; }
    if (!isText(v.headline)) errors.push(`${name}.headline is required`);
    if (!Array.isArray(v.chips) || v.chips.length > 6 || !v.chips.every(isText)) errors.push(`${name}.chips must be up to 6 non-empty strings`);
    if (!(v.duration > 0)) errors.push(`${name}.duration must be positive`);
    return true;
  };
  if (card('opener', c.opener, true)) {
    const lines = c.opener.lines;
    if (!Array.isArray(lines) || !lines.every((l: any) => isText(l?.text) && l.at >= 0)) errors.push('opener.lines must be [{at, text}]');
    else {
      for (let i = 1; i < lines.length; i++) if (lines[i].at <= lines[i - 1].at) errors.push('opener.lines must be in time order');
      if (lines.some((l: any) => l.at >= c.opener.duration)) errors.push('opener.lines start after opener.duration');
    }
    if (!(c.opener.revealAt >= 0 && c.opener.revealAt < c.opener.duration)) errors.push('opener.revealAt must be inside opener.duration');
  }
  card('closer', c.closer, false);
  if (c.closer?.line !== undefined && !isText(c.closer.line)) errors.push('closer.line must be text');
  return errors;
}
