import { describe, expect, it } from 'vitest';
import { isDesignDocSource, parseDesignDocSource, readDesignDocSource } from './design-doc-source.js';

describe('parseDesignDocSource', () => {
  it.each([
    ['doc://dd_1', { docRef: 'dd_1', path: null }],
    ['doc://dd_1/', { docRef: 'dd_1', path: null }],
    ['doc:dd_1/plan.md', { docRef: 'dd_1', path: 'plan.md' }],
    ['DOC://dd_1/sub/plan%20a.md#anchor', { docRef: 'dd_1', path: 'sub/plan a.md' }],
    ['doc://dd_1/plan.md?x=1', { docRef: 'dd_1', path: 'plan.md' }]
  ])('parses %s', (source, expected) => expect(parseDesignDocSource(source)).toEqual(expected));

  it.each(['doc://', 'doc:///x', 'doc://-bad', 'doc://%E0%A4%A', 'doc://dd_1/../x', 'doc://dd_1/./x', 'doc://dd_1/a//b', 'doc://dd_1/a%5Cb', 'doc://dd_1/%00', 'doc://dd_1/%E0%A4%A', 'file.md', `doc://${'a'.repeat(65)}`])(
    'rejects %s', (source) => expect(parseDesignDocSource(source)).toBeNull());

  it('tells doc sources from paths', () => {
    expect(isDesignDocSource(' doc://x')).toBe(true);
    expect(isDesignDocSource('docs/plan.md')).toBe(false);
  });
});

describe('readDesignDocSource names', () => {
  it('builds a safe attachment name from untrusted pieces', async () => {
    const rpc = async (method: string) => method === 'get'
      ? { id: 'dd_1', projectId: 'p', entryPath: '.hidden plan!.md', files: [{ path: '.hidden plan!.md' }] }
      : { content: 'x', encoding: 'utf8' };
    const res = await readDesignDocSource(rpc, 'p', 'doc://dd_1');
    expect(res).toMatchObject({ ok: true, name: 'design-doc-dd_1-hidden-plan-.md' });
  });
  it('refuses a doc without an entry file and a non-object reply', async () => {
    expect(await readDesignDocSource(async () => ({ id: 'dd_1', projectId: 'p' }), 'p', 'doc://dd_1')).toMatchObject({ ok: false, code: 'SOURCE_NOT_FILE' });
    expect(await readDesignDocSource(async () => null, 'p', 'doc://dd_1')).toMatchObject({ ok: false, code: 'SOURCE_NOT_FILE' });
    const failing = async (method: string) => { if (method === 'readFile') throw new Error('io'); return { id: 'dd_1', projectId: 'p', entryPath: 'a.md', files: [{ path: 'a.md', size: 1 }] }; };
    expect(await readDesignDocSource(failing, 'p', 'doc://dd_1')).toMatchObject({ ok: false, code: 'SOURCE_UNREADABLE' });
  });
});
