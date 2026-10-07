import { describe, expect, it } from 'vitest';
import {
  MAX_UPDATE_NOTES,
  MAX_UPDATE_NOTE_CHARS,
  MAX_UPDATE_NOTES_TOTAL_CHARS,
  htmlToMarkdown,
  normalizeUpdateReleaseNotes
} from './update-release-notes.js';

// Shape GitHub renders `docs/releases/<v>.md` into (the releases.atom <content>).
const GITHUB_BODY = `<h1>What's new in 2.3.4</h1>
<p><strong>Faster remotes.</strong> Zana &amp; friends &mdash; better.</p>
<h2>New</h2>
<ul>
<li><strong>Release notes before updating.</strong> See them in the <a href="https://example.com/r" rel="nofollow">banner</a>.</li>
<li>Use <code>zcc update</code> &lt;now&gt;.</li>
</ul>
<pre><code>zcc --version
</code></pre>`;

describe('htmlToMarkdown', () => {
  it('round-trips the GitHub release-body subset', () => {
    expect(htmlToMarkdown(GITHUB_BODY)).toBe(
      [
        "# What's new in 2.3.4",
        '',
        '**Faster remotes.** Zana & friends — better.',
        '',
        '## New',
        '',
        '- **Release notes before updating.** See them in the [banner](https://example.com/r).',
        '- Use `zcc update` <now>.',
        '',
        '```',
        'zcc --version',
        '```'
      ].join('\n')
    );
  });

  it('drops scripts, styles, comments and unknown tags entirely', () => {
    const md = htmlToMarkdown('<p>ok</p><script>alert(1)</script><style>p{}</style><!-- x --><img src=x onerror=alert(1)><span>t</span>');
    expect(md).toBe('ok\n\nt');
    expect(md).not.toMatch(/alert|<|onerror/);
  });

  it('keeps only http(s) links, reducing others to their text', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>')).toBe('click');
    expect(htmlToMarkdown("<a href='/relative'>rel</a>")).toBe('rel');
    expect(htmlToMarkdown('<a href="https://x.test/a b">sp</a>')).toBe('sp');
  });

  it('decodes numeric entities and handles line breaks, rules and emphasis', () => {
    expect(htmlToMarkdown('<p>a&#33;<br>b&#x21;</p><hr><p><em>c</em><i></i>&bogus;</p>')).toBe('a!  \nb!\n\n---\n\n*c*&bogus;');
  });

  it('cannot leak a placeholder or break out of a code fence', () => {
    expect(htmlToMarkdown('<pre>```\nx</pre>')).not.toMatch(/^```\n```/m);
  });
});

describe('normalizeUpdateReleaseNotes', () => {
  it('attributes a single HTML string to the target version', () => {
    const [note] = normalizeUpdateReleaseNotes(GITHUB_BODY, '2.3.4');
    expect(note.version).toBe('2.3.4');
    expect(note.markdown.startsWith("# What's new in 2.3.4")).toBe(true);
  });

  it('passes markdown (generic feed) through, stripping stray tags', () => {
    expect(normalizeUpdateReleaseNotes('# Hi\n\n- one <b>two</b>', '1.0.0')).toEqual([{ version: '1.0.0', markdown: '# Hi\n\n- one two' }]);
  });

  it('normalizes a fullChangelog array newest first, dropping bad entries', () => {
    const notes = normalizeUpdateReleaseNotes(
      [
        { version: '2.3.2', note: '<p>two</p>' },
        { version: 'v2.3.10', note: '<p>ten</p>' },
        { version: 'bad version!', note: '<p>x</p>' },
        { version: '2.3.3', note: null },
        null,
        { note: '<p>no version</p>' }
      ],
      '2.3.10'
    );
    expect(notes).toEqual([
      { version: '2.3.10', markdown: 'ten' },
      { version: '2.3.2', markdown: 'two' }
    ]);
  });

  it('returns [] for missing notes or an unusable target version', () => {
    expect(normalizeUpdateReleaseNotes(null, '1.0.0')).toEqual([]);
    expect(normalizeUpdateReleaseNotes(undefined, '1.0.0')).toEqual([]);
    expect(normalizeUpdateReleaseNotes('<p>x</p>', undefined)).toEqual([]);
    expect(normalizeUpdateReleaseNotes('<p>x</p>', '../etc')).toEqual([]);
    expect(normalizeUpdateReleaseNotes('   ', '1.0.0')).toEqual([]);
    expect(normalizeUpdateReleaseNotes(42, '1.0.0')).toEqual([]);
  });

  it('bounds the number of versions, each note and the total size', () => {
    const many = Array.from({ length: MAX_UPDATE_NOTES + 5 }, (_, i) => ({ version: `1.0.${i}`, note: 'x' }));
    expect(normalizeUpdateReleaseNotes(many, '1.0.0')).toHaveLength(MAX_UPDATE_NOTES);

    const [long] = normalizeUpdateReleaseNotes('y'.repeat(MAX_UPDATE_NOTE_CHARS * 2), '1.0.0');
    expect(long.markdown.length).toBeLessThanOrEqual(MAX_UPDATE_NOTE_CHARS + 3);
    expect(long.markdown.endsWith('…')).toBe(true);

    const big = Array.from({ length: 10 }, (_, i) => ({ version: `1.0.${i}`, note: 'z'.repeat(MAX_UPDATE_NOTE_CHARS) }));
    const kept = normalizeUpdateReleaseNotes(big, '1.0.9');
    expect(kept.reduce((n, note) => n + note.markdown.length, 0)).toBeLessThanOrEqual(MAX_UPDATE_NOTES_TOTAL_CHARS);
    expect(kept[0].version).toBe('1.0.9'); // the newest survives the budget
  });
});
