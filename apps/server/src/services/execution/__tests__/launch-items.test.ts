import { describe, expect, it } from 'vitest';
import { LAUNCH_ITEM_LIMITS, attachmentNameProblem, sha256Hex, validateLaunchItems, type LaunchItemInput } from '../launch-items.js';

const att = (name: string, text = name, byteSize = Buffer.byteLength(text)): LaunchItemInput =>
  ({ kind: 'attachment', name, byteSize, sha256: sha256Hex(Buffer.from(text)) });
const src = (name: string, text = name): LaunchItemInput =>
  ({ kind: 'source', name, byteSize: Buffer.byteLength(text), sha256: sha256Hex(Buffer.from(text)) });
const used = (items: LaunchItemInput[]) => {
  const result = validateLaunchItems(items);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
};

describe('attachmentNameProblem', () => {
  it.each([
    ['empty', ''],
    ['NUL', 'a\0b.md'],
    ['control character', 'a\u0007.md'],
    ['DEL', 'a\u007f.md'],
    ['C1 control', 'a\u0085.md'],
    ['forward slash', 'a/b.md'],
    ['backslash', 'a\\b.md'],
    ['dot', '.'],
    ['dot dot', '..'],
    ['leading dot', '.env'],
    ['trailing dot', 'plan.'],
    ['trailing space', 'plan '],
    ['escape attempt', '../../etc/passwd'],
    ['windows device', 'CON'],
    ['windows device with extension', 'nul.txt'],
    ['windows device mixed case', 'Lpt9.md'],
    ['over 128 bytes', `${'a'.repeat(129)}.md`],
    ['over 128 bytes in multibyte', 'é'.repeat(65)]
  ])('rejects %s', (_label, name) => {
    expect(attachmentNameProblem(name)).toBeTypeOf('string');
  });

  it.each(['plan.md', 'my plan (final).md', 'noextension', 'é'.repeat(64), 'COM10.md', 'console.md', 'a'.repeat(128)])('accepts %s', (name) => {
    expect(attachmentNameProblem(name)).toBeUndefined();
  });
});

describe('validateLaunchItems', () => {
  it('keeps distinct names as given', () => {
    const result = used([att('a.md'), att('b.md')]);
    expect(result.kept).toEqual([{ index: 0, name: 'a.md' }, { index: 1, name: 'b.md' }]);
    expect(result.mapping).toEqual([{ index: 0, given: 'a.md', used: 'a.md' }, { index: 1, given: 'b.md', used: 'b.md' }]);
  });

  it('folds the same name and content into one item and says so', () => {
    const result = used([att('plan.md', 'same'), att('plan.md', 'same')]);
    expect(result.kept).toEqual([{ index: 0, name: 'plan.md' }]);
    expect(result.mapping[1]).toEqual({ index: 1, given: 'plan.md', used: 'plan.md', deduplicated: 'plan.md' });
  });

  it('suffixes the same name with different content, then the next free number', () => {
    const result = used([att('plan.md', 'one'), att('plan.md', 'two'), att('plan.md', 'three')]);
    expect(result.kept.map((k) => k.name)).toEqual(['plan.md', 'plan (1).md', 'plan (2).md']);
    expect(result.mapping.map((m) => m.used)).toEqual(['plan.md', 'plan (1).md', 'plan (2).md']);
  });

  it('suffixes a name without an extension', () => {
    expect(used([att('notes', 'one'), att('notes', 'two')]).kept.map((k) => k.name)).toEqual(['notes', 'notes (1)']);
  });

  it('treats case and Unicode form as the same name', () => {
    const decomposed = 'é.md';
    const composed = 'é.md';
    expect(used([att('Plan.MD', 'one'), att('plan.md', 'two')]).kept.map((k) => k.name)).toEqual(['Plan.MD', 'plan (1).md']);
    expect(used([att(decomposed, 'one'), att(composed, 'one')]).mapping[1]!.deduplicated).toBe(composed);
  });

  it('skips a suffix that is already taken', () => {
    const result = used([att('plan (1).md', 'x'), att('plan.md', 'one'), att('plan.md', 'two')]);
    expect(result.kept.map((k) => k.name)).toEqual(['plan (1).md', 'plan.md', 'plan (2).md']);
  });

  it('suffixes an attachment that clashes with a path source, and folds an identical one', () => {
    const different = used([src('plan.md', 'on disk'), att('plan.md', 'attached')]);
    expect(different.kept.map((k) => k.name)).toEqual(['plan.md', 'plan (1).md']);
    const identical = used([src('plan.md', 'same'), att('plan.md', 'same')]);
    expect(identical.kept).toEqual([{ index: 0, name: 'plan.md' }]);
    expect(identical.mapping).toEqual([{ index: 1, given: 'plan.md', used: 'plan.md', deduplicated: 'plan.md' }]);
  });

  it('reserves source names even when the attachment is listed first', () => {
    const result = used([att('plan.md', 'attached'), src('plan.md', 'on disk')]);
    expect(result.kept).toEqual([{ index: 0, name: 'plan (1).md' }, { index: 1, name: 'plan.md' }]);
  });

  it('never renames or folds path sources among themselves', () => {
    expect(used([src('a.md', 'x'), src('a.md', 'y'), src('.hidden', 'z')]).kept.map((k) => k.name)).toEqual(['a.md', 'a.md', '.hidden']);
  });

  it.each(['a:b.md', 'a*.md', 'a?.md', 'a"b.md', 'a<b.md', 'a>b.md', 'a|b.md'])('rejects the Windows-invalid name %s', (name) => {
    expect(validateLaunchItems([att(name)])).toMatchObject({ ok: false, code: 'INVALID_NAME' });
  });

  it('rejects an unsafe attachment name instead of rewriting it', () => {
    expect(validateLaunchItems([att('../x.md')])).toMatchObject({ ok: false, code: 'INVALID_NAME' });
  });

  it('rejects a numbered name that would outgrow the name limit', () => {
    const name = `${'a'.repeat(125)}.md`;
    expect(Buffer.byteLength(name)).toBe(128);
    expect(validateLaunchItems([att(name, 'one'), att(name, 'two')])).toMatchObject({ ok: false, code: 'NAME_TOO_LONG' });
  });

  it('names the attachment and the limit when one is too large', () => {
    const result = validateLaunchItems([att('big.md', 'x', LAUNCH_ITEM_LIMITS.maxItemBytes + 1)]);
    expect(result).toMatchObject({ ok: false, code: 'ITEM_TOO_LARGE' });
    expect(!result.ok && result.message).toBe("attachment 'big.md' is 4194305 bytes; limit is 4194304");
    expect(validateLaunchItems([att('edge.md', 'x', LAUNCH_ITEM_LIMITS.maxItemBytes)]).ok).toBe(true);
  });

  it('caps the kept items, counting sources and attachments together', () => {
    const sixteen = Array.from({ length: 16 }, (_v, i) => att(`f${i}.md`));
    expect(validateLaunchItems(sixteen).ok).toBe(true);
    expect(validateLaunchItems([...sixteen, att('one-more.md')])).toMatchObject({ ok: false, code: 'TOO_MANY_ITEMS' });
    expect(validateLaunchItems([src('s.md'), ...sixteen])).toMatchObject({ ok: false, code: 'TOO_MANY_ITEMS' });
  });

  it('does not count a folded duplicate toward the cap', () => {
    const items = [...Array.from({ length: 16 }, (_v, i) => att(`f${i}.md`)), att('f0.md')];
    expect(validateLaunchItems(items).ok).toBe(true);
  });

  it('caps the total bytes of kept items', () => {
    const four = LAUNCH_ITEM_LIMITS.maxItemBytes;
    const items = [att('a.md', 'a', four), att('b.md', 'b', four), att('c.md', 'c', four), att('d.md', 'd', four)];
    expect(validateLaunchItems(items).ok).toBe(true);
    expect(validateLaunchItems([...items, att('e.md', 'e', 1)])).toMatchObject({ ok: false, code: 'TOTAL_TOO_LARGE' });
  });
});
