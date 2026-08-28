import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  confinePathToRoot,
  outlinePreview,
  parsePositiveInt,
  parseTimelineSegmentLimit
} from './thread-path-confine.js';
import { getThreadReadSeq, markThreadRead, peekThreadReadSeq } from './thread-reads.js';
import { imageContentType } from './thread-host-file.js';

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('thread path confine', () => {
  it('keeps relative and absolute paths inside the environment root', () => {
    expect(confinePathToRoot('/tmp/env', 'README.md')).toBe('README.md');
    expect(confinePathToRoot('/tmp/env', '/tmp/env/src/app.ts')).toBe('src/app.ts');
  });

  it('rejects escapes and empty candidates', () => {
    expect(confinePathToRoot('/tmp/env', '../secret')).toBeNull();
    expect(confinePathToRoot('/tmp/env', '/etc/passwd')).toBeNull();
    expect(confinePathToRoot('/tmp/env', '')).toBeNull();
  });

  it('clamps timeline page size and preview text', () => {
    expect(parseTimelineSegmentLimit(null)).toBe(10_000);
    expect(parseTimelineSegmentLimit('12')).toBe(12);
    expect(parseTimelineSegmentLimit('9999')).toBe(9999);
    expect(parseTimelineSegmentLimit('99999')).toBe(10_000);
    expect(parseTimelineSegmentLimit('nope')).toBe(10_000);
    expect(parsePositiveInt('12')).toBe(12);
    expect(parsePositiveInt('0')).toBeUndefined();
    expect(outlinePreview('  hello\nworld  ')).toBe('hello world');
    expect(outlinePreview('x'.repeat(90)).length).toBe(80);
  });
});

describe('thread reads', () => {
  it('persists last-read seq atomically', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-thread-reads-'));
    expect(getThreadReadSeq(dir, 't1')).toBe(0);
    expect(peekThreadReadSeq(dir, 't1')).toBeNull();
    expect(markThreadRead(dir, 't1', 4)).toBe(4);
    expect(getThreadReadSeq(dir, 't1')).toBe(4);
    expect(peekThreadReadSeq(dir, 't1')).toBe(4);
    expect(markThreadRead(dir, 't1', 0)).toBe(0);
    expect(peekThreadReadSeq(dir, 't1')).toBe(0);
    const body = JSON.parse(readFileSync(join(dir, 'thread-reads.json'), 'utf8')) as { t1: number };
    expect(body.t1).toBe(0);
  });
});

describe('thread host file helpers', () => {
  it('maps image extensions', () => {
    expect(imageContentType('shot.PNG')).toBe('image/png');
    expect(imageContentType('logo.svg')).toBe('image/svg+xml');
    expect(imageContentType('a.jpg')).toBe('image/jpeg');
    expect(imageContentType('a.gif')).toBe('image/gif');
    expect(imageContentType('a.webp')).toBe('image/webp');
    expect(imageContentType('notes.md')).toBeNull();
  });
});
