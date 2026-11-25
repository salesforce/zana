import { describe, expect, it } from 'vitest';
import { LINEAR_TIME_BUDGET_MS } from '@zana-ai/zcc-domain/linear-time-testing';
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

// ---- Oracle: the regex implementation this file replaced (kept verbatim) ----
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…'
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Only http(s) links survive; anything else (javascript:, data:, relative) keeps just its text. */
function safeHref(raw: string): string | null {
  const href = decodeEntities(raw).trim();
  return /^https?:\/\//i.test(href) && !/[\s()<>]/.test(href) ? href : null;
}

function attr(tagAttrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tagAttrs);
  return m ? (m[2] ?? m[3] ?? '') : null;
}

function legacyHtmlToMarkdown(html: string): string {
  let s = html.slice(0, 256 * 1024);
  // Content that must never surface as text.
  s = s.replace(/<(script|style|template|iframe|object|svg)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Code blocks first, so their contents aren't treated as markup.
  const blocks: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, inner: string) => {
    const code = decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\n+$/, '');
    blocks.push('\n\n```\n' + code.replace(/```/g, '``​`') + '\n```\n\n');
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner.trim()}\n\n`);
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_m, attrs: string, inner: string) => {
    const href = safeHref(attr(attrs, 'href') ?? '');
    const text = inner.replace(/<[^>]*>/g, '').trim();
    return href && text ? `[${text}](${href})` : text;
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => (inner.trim() ? `**${inner.trim()}**` : ''));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => (inner.trim() ? `*${inner.trim()}*` : ''));
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_m, inner: string) => '`' + inner.replace(/`/g, '') + '`');
  s = s.replace(/\s*<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(ul|ol)\s*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '  \n');
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');
  s = s.replace(/<\/?(p|div|blockquote|section|table|tr)\b[^>]*>/gi, '\n\n');
  // Drop every remaining tag, then decode text entities.
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)] ?? '');
  return s
    .replace(/[ \t]+\n/g, (m) => (m.endsWith('  \n') ? '  \n' : '\n'))
    .replace(/\n- [ \t]*\n+/g, '\n- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


/** Small deterministic PRNG so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  '<pre>', '</pre>', '<code>', '</code>', '<a href="https://x.example/p">', '<a href="javascript:x">', '</a>',
  '<b>', '</b>', '<strong>', '</strong>', '<i>', '</i>', '<em>', '</em>', '<h1>', '</h1>', '<h3>', '</h3>',
  '<li>', '<ul>', '</ul>', '<p>', '</p>', '<br>', '<hr>', '<script>', '</script>', '<style>', '</style>',
  '<!--', '-->', '<', '>', '&amp;', '&lt;b&gt;', 'text', ' ', '\n', '`', '```',
];

describe('htmlToMarkdown equivalence with the regex implementation it replaced', () => {
  it('matches on every sequence of up to 3 tokens and on 20k random longer ones', () => {
    const mismatches: string[] = [];
    const check = (input: string) => {
      if (htmlToMarkdown(input) !== legacyHtmlToMarkdown(input)) mismatches.push(input);
    };
    for (const a of TOKENS) {
      check(a);
      for (const b of TOKENS) {
        check(a + b);
        for (const c of TOKENS) check(a + b + c);
      }
    }
    const random = mulberry32(919);
    for (let n = 0; n < 20_000; n += 1) {
      const length = 4 + Math.floor(random() * 10);
      let input = '';
      for (let i = 0; i < length; i += 1) input += TOKENS[Math.floor(random() * TOKENS.length)];
      check(input);
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

describe('htmlToMarkdown multi-character sanitization', () => {
  it('does not let a removed element join the halves of another', () => {
    const out = htmlToMarkdown('<p>a</p><scr<script></script>ipt>alert(1)</script><p>b</p>');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('<script');
    expect(htmlToMarkdown('<p>x<!<!-- -->-- hidden --></p>')).not.toContain('hidden');
  });

  it('leaves no tag-shaped text behind for nested or split tags', () => {
    for (const input of ['<<b>script>x', '<scr<b>ipt>x', '<a href="https://e.example"><b><i>t</i></b></a>', '<p<p>>x']) {
      expect(htmlToMarkdown(input)).not.toMatch(/<[^>]*>/);
    }
  });

  it('drops tags in plain-text feeds too', () => {
    const [note] = normalizeUpdateReleaseNotes('hello <scr<b>ipt>x</b> world', '1.0.0');
    expect(note!.markdown).not.toMatch(/<[^>]*>/);
  });

  it('falls back to dropping every "<" when nesting keeps unfolding', () => {
    // Each level only becomes a complete element once the level inside it is removed.
    let hostile = '<script></script>';
    for (let depth = 0; depth < 8; depth += 1) hostile = `<scr${hostile}ipt></script>`;
    const out = htmlToMarkdown(`x${hostile}y`);
    expect(out).not.toContain('<');
    expect(out.startsWith('x')).toBe(true);
  });
});

describe('htmlToMarkdown on hostile unclosed input', () => {
  it.each([
    ['script', '<script '],
    ['comment', '<!--'],
    ['pre', '<pre>'],
    ['heading', '<h1>'],
    ['link', '<a>'],
    ['bold', '<b>'],
  ])('is linear on 256KB of unclosed <%s> openers', (_name, opener) => {
    // The lazy regexes rescanned to the end for every opener: seconds each.
    const input = opener.repeat(Math.floor((256 * 1024) / opener.length));
    const started = performance.now();
    htmlToMarkdown(input);
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
