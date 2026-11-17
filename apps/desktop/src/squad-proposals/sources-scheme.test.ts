import { describe, expect, it, vi } from 'vitest';
import { confineSource, sourceScope, type SquadProposalFs } from './sources.js';

const makeFs = () => {
  const realpath = vi.fn(async (path: string) => path);
  const lstat = vi.fn(async () => { throw new Error('ENOENT'); });
  const open = vi.fn(async () => { throw new Error('ENOENT'); });
  return { fs: { realpath, lstat, open } as unknown as SquadProposalFs, realpath, lstat, open };
};

describe('a source written as <scheme>://... (REQ-6, D2)', () => {
  for (const raw of ['doc://design-1', 'https://example.com/plan.md', 'DOC://x', 'design-docs://abc/def']) {
    it(`refuses ${raw} with a plain message that points to attachments and reads nothing`, async () => {
      const { fs, realpath, lstat, open } = makeFs();
      const scope = (await sourceScope(fs, '/proj', { home: '/home/u' }))!;
      realpath.mockClear();
      const result = await confineSource(fs, scope, raw);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/attach/i);
      expect(result.message).toMatch(/plan text|text of the plan|as an attachment/i);
      expect(result.message).not.toMatch(/does not exist/i);
      expect(result.message).toContain(raw);
      expect(realpath).not.toHaveBeenCalled();
      expect(lstat).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });
  }
  const missing = async (raw: string) => {
    const { fs } = makeFs();
    const scope = (await sourceScope(fs, '/proj', { home: '/home/u' }))!;
    const absent = { ...fs, realpath: vi.fn(async () => { throw new Error('ENOENT'); }) } as unknown as SquadProposalFs;
    return confineSource(absent, scope, raw);
  };
  it('still treats an ordinary relative path as before (existing behaviour)', async () => {
    expect(await missing('notes/plan.md')).toMatchObject({ ok: false, code: 'SOURCE_NOT_FILE' });
  });
  it('does not mistake a Windows drive path for a scheme (it keeps the file message)', async () => {
    const result = await missing('C:\\plans\\a.md');
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_NOT_FILE' });
    expect(result.ok === false && result.message).not.toMatch(/attachment/i);
  });
});

describe('what counts as a <scheme>:// source', () => {
  const missing = async (raw: string) => {
    const { fs } = makeFs();
    const scope = (await sourceScope(fs, '/proj', { home: '/home/u' }))!;
    const absent = { ...fs, realpath: vi.fn(async () => { throw new Error('ENOENT'); }) } as unknown as SquadProposalFs;
    return confineSource(absent, scope, raw);
  };
  it('treats a Windows drive written with forward slashes (C://Users/x/plan.md) as a path, not a scheme', async () => {
    const result = await missing('C://Users/x/plan.md');
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_NOT_FILE' });
    expect(result.ok === false && result.message).not.toMatch(/attachment/i);
  });
  it('treats a relative path whose first folder ends in a colon (foo://bar) as a path, not a scheme', async () => {
    const result = await missing('./foo://bar');
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_NOT_FILE' });
  });
  it('still refuses a two-letter scheme such as ab://x', async () => {
    const result = await missing('ab://x');
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });
  });
});
