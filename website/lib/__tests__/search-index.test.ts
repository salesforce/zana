import { describe, it, expect, beforeAll } from 'vitest';
import { buildSearchIndex } from '../search-index';
import { DOCS, renderDoc } from '../docs';

/**
 * The docs search index is built at build time from the synced content/docs/*.md.
 * These tests assert the index shape + anchor parity with the rendered pages, so
 * a ⌘K hit's `#<anchor>` actually lands on a heading that exists in the DOM.
 */
describe('buildSearchIndex', () => {
  let index: Awaited<ReturnType<typeof buildSearchIndex>>;
  beforeAll(async () => {
    index = await buildSearchIndex();
  });

  it('has one entry per published doc, in manifest order', () => {
    expect(index.map((e) => e.slug)).toEqual(DOCS.map((d) => d.slug));
    for (const e of index) {
      expect(e.title).toBeTruthy();
      expect(e.group).toBeTruthy();
    }
  });

  it('gives every doc at least an intro section (level 1, empty anchor)', () => {
    for (const e of index) {
      expect(e.sections.length).toBeGreaterThan(0);
      const intro = e.sections[0];
      expect(intro.level).toBe(1);
      expect(intro.id).toBe('');
    }
  });

  it('caps section bodies and strips markdown/code fences', () => {
    for (const e of index) {
      for (const s of e.sections) {
        expect(s.body.length).toBeLessThanOrEqual(600);
        expect(s.body).not.toContain('```');
        expect(s.body).not.toMatch(/^#{1,6}\s/m);
      }
    }
  });

  it('section anchors match the rendered pages heading ids (deep-link parity)', async () => {
    for (const e of index) {
      const meta = DOCS.find((d) => d.slug === e.slug)!;
      const { toc } = await renderDoc(meta);
      const tocIds = new Set(toc.map((t) => t.id));
      const sectionAnchors = e.sections.map((s) => s.id).filter(Boolean);
      for (const a of sectionAnchors) {
        expect(tocIds.has(a)).toBe(true);
      }
    }
  });

  it('retains every rendered heading as a jumpable section (no body-less headings dropped)', async () => {
    // A heading with no body text (e.g. an h2 immediately followed by an h3)
    // must still be searchable/deep-linkable by its heading text.
    for (const e of index) {
      const meta = DOCS.find((d) => d.slug === e.slug)!;
      const { toc } = await renderDoc(meta);
      const sectionIds = new Set(e.sections.map((s) => s.id));
      for (const t of toc) {
        expect(sectionIds.has(t.id)).toBe(true);
      }
    }
  });
});
