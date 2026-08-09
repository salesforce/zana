import { describe, it, expect } from 'vitest';
import { parseFrontMatter } from '../helpers.js';

// parseFrontMatter peels a `---`…`---` metadata header off a library doc so
// the inbox / library preview renders a clean chip header instead of the raw
// YAML leaking into the markdown body as a mangled bold blob. Must agree with
// the on-disk shape the store's serializer writes.
describe('parseFrontMatter', () => {
  it('returns null when there is no front-matter', () => {
    expect(parseFrontMatter('# Just a heading\n\nbody')).toBeNull();
    expect(parseFrontMatter('no fence at all')).toBeNull();
  });

  it('does not treat a leading horizontal rule as a fence', () => {
    // Starts with `---\n` but there's no closing fence — a doc that opens with
    // a thematic rule must not be mistaken for front-matter.
    expect(parseFrontMatter('---\n\nsome text with no closing fence')).toBeNull();
  });

  it('parses the real library header shape', () => {
    const raw = [
      '---',
      'id: "c07d20fd-07f9-4ed4-a540-9ee35c5eade5"',
      'title: "Library concept review for 1.0.0 (4-team analysis)"',
      'summary: "Consolidated review — verdict: solid foundation, one Critical bug."',
      'tags: ["findings", "library", "1.0.0", "security"]',
      'source: "agent"',
      'createdAt: 1783207878401',
      '---',
      '# Library concept review — for the 1.0.0 release',
      '',
      'Body paragraph.'
    ].join('\n');
    const parsed = parseFrontMatter(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.meta.id).toBe('c07d20fd-07f9-4ed4-a540-9ee35c5eade5');
    expect(parsed!.meta.title).toBe('Library concept review for 1.0.0 (4-team analysis)');
    expect(parsed!.meta.summary).toContain('solid foundation');
    expect(parsed!.meta.tags).toEqual(['findings', 'library', '1.0.0', 'security']);
    expect(parsed!.meta.source).toBe('agent');
    expect(parsed!.meta.createdAt).toBe(1783207878401);
    // Body starts at the H1 — the fence and header are gone.
    expect(parsed!.body).toBe('# Library concept review — for the 1.0.0 release\n\nBody paragraph.');
  });

  it('does not stop at a body line that starts with --- but is not a fence', () => {
    // A `---text` line inside the body (not its own fence line) must not close
    // the header early. The closing fence is the `---` on its own line.
    const raw = ['---', 'title: "x"', '---', 'body ---inline dashes--- here'].join('\n');
    const parsed = parseFrontMatter(raw);
    expect(parsed!.meta.title).toBe('x');
    expect(parsed!.body).toBe('body ---inline dashes--- here');
  });

  it('caps a hostile tag list', () => {
    const many = Array.from({ length: 500 }, (_, i) => `"t${i}"`).join(', ');
    const raw = ['---', `tags: [${many}]`, '---', 'body'].join('\n');
    const parsed = parseFrontMatter(raw);
    expect(parsed!.meta.tags!.length).toBeLessThanOrEqual(64);
  });

  it('ignores a non-numeric createdAt', () => {
    const raw = ['---', 'createdAt: not-a-number', '---', 'body'].join('\n');
    const parsed = parseFrontMatter(raw);
    expect(parsed!.meta.createdAt).toBeUndefined();
  });

  it('handles an empty body after the closing fence', () => {
    const raw = ['---', 'title: "x"', '---'].join('\n');
    const parsed = parseFrontMatter(raw);
    expect(parsed!.body).toBe('');
  });
});
