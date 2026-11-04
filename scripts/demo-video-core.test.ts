import { describe, expect, it } from 'vitest';
import { NarrationCursor, parseRecordSize, sectionNumber, validateVideoConfig } from '../e2e/sdk/demo-video-core.js';

describe('parseRecordSize', () => {
  it('defaults to 1440x900 when unset or blank', () => {
    expect(parseRecordSize(undefined)).toEqual({ width: 1440, height: 900 });
    expect(parseRecordSize('  ')).toEqual({ width: 1440, height: 900 });
  });
  it('parses WIDTHxHEIGHT case-insensitively', () => {
    expect(parseRecordSize('1920x1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseRecordSize(' 1280X720 ')).toEqual({ width: 1280, height: 720 });
  });
  it('rejects malformed, odd and out-of-range sizes', () => {
    for (const bad of ['1920', '1920*1080', 'axb', '1921x1080', '1920x1081', '100x100', '9000x5000']) {
      expect(() => parseRecordSize(bad), bad).toThrow(/ZCC_E2E_RECORD_SIZE/);
    }
  });
});

describe('NarrationCursor', () => {
  const entries = [{ id: 'a', caption: 'First', ms: 2000 }, { id: 'b', caption: 'Second', ms: 1000 }];
  const make = () => {
    let t = 10_000;
    const cursor = new NarrationCursor(entries, () => t);
    return { cursor, tick: (ms: number) => { t += ms; } };
  };

  it('holds each line until the previous is spoken, plus a breath', () => {
    const { cursor, tick } = make();
    cursor.start();
    expect(cursor.holdMs()).toBe(0);
    tick(100);
    cursor.advance({ id: 'a' }, 'First');
    tick(500);
    expect(cursor.holdMs()).toBe(1800);
    tick(5000);
    expect(cursor.holdMs()).toBe(0);
    expect(cursor.advance({ caption: 'Second' }, 'Second')).toEqual({ text: 'Second', at: 5600 });
    cursor.assertComplete();
  });

  it('records ids and times relative to start', () => {
    const { cursor, tick } = make();
    tick(50);
    cursor.start();
    tick(250);
    cursor.advance({ id: 'a' }, 'First');
    expect(cursor.timeline).toEqual([{ id: 'a', text: 'First', at: 250 }]);
  });

  it('throws on out-of-order ids, wrong captions and extra lines', () => {
    const one = make().cursor;
    expect(() => one.advance({ id: 'b' }, 'x')).toThrow(/line 0 is "b", narration expects "a"/);
    const two = make().cursor;
    expect(() => two.advance({ caption: 'Nope' }, 'Nope')).toThrow(/narration expects "First"/);
    const three = make().cursor;
    three.advance({ id: 'a' }, 'First');
    three.advance({ id: 'b' }, 'Second');
    expect(() => three.advance({ id: 'c' }, 'x')).toThrow(/has 2 lines but line 3/);
  });

  it('expects the caption when the entry has no id', () => {
    const cursor = new NarrationCursor([{ caption: 'Only', ms: 1 }], () => 0);
    expect(() => cursor.advance({ id: 'x' }, 'x')).toThrow(/expects "Only"/);
  });

  it('reports incomplete runs', () => {
    const { cursor } = make();
    cursor.advance({ id: 'a' }, 'First');
    expect(() => cursor.assertComplete()).toThrow(/1 of 2/);
  });

  it('does not check or hold without narration', () => {
    const cursor = new NarrationCursor([], () => 0);
    expect(cursor.hasNarration).toBe(false);
    cursor.advance({ caption: 'anything' }, 'anything');
    expect(cursor.holdMs()).toBe(0);
    cursor.assertComplete();
  });
});

describe('sectionNumber', () => {
  it('zero-pads numbers and passes strings through', () => {
    expect(sectionNumber(1)).toBe('01');
    expect(sectionNumber(12)).toBe('12');
    expect(sectionNumber('A1')).toBe('A1');
  });
});

describe('validateVideoConfig', () => {
  const valid = () => ({
    id: 'squad-guide-1', title: 'What is a Squad?', width: 1920, height: 1080, fps: 30,
    opener: { headline: 'What is a Squad?', chips: ['Persona', 'Squad'], lines: [{ at: 0.5, text: 'Hi.' }, { at: 4, text: 'There.' }], duration: 9, revealAt: 5 },
    closer: { headline: 'Next', chips: [], duration: 4, line: 'Bye.' }
  });
  it('accepts a valid config, with or without a closer', () => {
    expect(validateVideoConfig(valid())).toEqual([]);
    const { closer, ...rest } = valid();
    expect(validateVideoConfig(rest)).toEqual([]);
  });
  it('rejects non-objects', () => {
    expect(validateVideoConfig(null)).toEqual(['video.json must be an object']);
  });
  it('reports each broken field', () => {
    const bad: any = valid();
    Object.assign(bad, { id: 'Bad Id', title: '', width: 1921, fps: 24 });
    bad.opener = { headline: '', chips: ['a', ''], lines: [{ at: 4, text: 'x' }, { at: 2, text: 'y' }, { at: 20, text: 'z' }], duration: 9, revealAt: 12 };
    bad.closer = { headline: 'x', chips: [], duration: 0, line: 5 };
    const errors = validateVideoConfig(bad).join('\n');
    for (const part of ['id must', 'title is required', 'even integers', 'fps must', 'opener.headline', 'opener.chips', 'time order', 'after opener.duration', 'revealAt', 'closer.duration', 'closer.line']) {
      expect(errors).toContain(part);
    }
  });
  it('requires an opener and well-formed line list', () => {
    const noOpener: any = valid();
    delete noOpener.opener;
    expect(validateVideoConfig(noOpener)).toContain('opener is required');
    const badLines: any = valid();
    badLines.opener.lines = 'nope';
    expect(validateVideoConfig(badLines)).toContain('opener.lines must be [{at, text}]');
  });
});
