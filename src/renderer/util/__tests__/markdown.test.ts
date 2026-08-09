import { describe, it, expect } from 'vitest';
import { unwrapBareFence } from '../markdown.js';

describe('unwrapBareFence', () => {
  it('leaves plain markdown untouched', () => {
    const md = '## Title\n\nSome **bold** text and a list:\n- one\n- two';
    expect(unwrapBareFence(md)).toBe(md);
  });

  it('leaves a legitimate single code block untouched', () => {
    const code = '```ts\nconst x = 1;\nconsole.log(x);\n```';
    // No markdown structure inside → not unwrapped.
    expect(unwrapBareFence(code)).toBe(code);
  });

  it('unwraps a body fully wrapped in one fence', () => {
    const wrapped = '```\n## Summary\n\nThere were **THREE** places.\n```';
    const out = unwrapBareFence(wrapped);
    expect(out).toBe('## Summary\n\nThere were **THREE** places.');
  });

  it('keeps a leading status line before the fence', () => {
    const wrapped =
      '**QA Agent** — error in 22s\n\n```\n## Summary\n\n| A | B |\n|---|---|\n| 1 | 2 |\n```';
    const out = unwrapBareFence(wrapped);
    expect(out).toBe(
      '**QA Agent** — error in 22s\n\n## Summary\n\n| A | B |\n|---|---|\n| 1 | 2 |'
    );
  });

  it('flattens nested inner fences (the real-world failure)', () => {
    const wrapped = [
      '**QA Agent** — done',
      '',
      '```',
      '## Summary',
      '',
      'The pipeline:',
      '```',
      'module.json default (30000)',
      '  → applySchemaDefaults()',
      '```',
      '',
      '**Commit chain:**',
      '```',
      'f0d0dbe fix(probe)',
      '```',
      '```'
    ].join('\n');
    const out = unwrapBareFence(wrapped);
    // No triple-backtick lines should survive — they were the invalid nesting.
    expect(out).not.toMatch(/^```/m);
    expect(out).toContain('## Summary');
    expect(out).toContain('**Commit chain:**');
    expect(out).toContain('module.json default (30000)');
    expect(out.startsWith('**QA Agent** — done')).toBe(true);
  });

  it('does not unwrap when content follows the closing fence', () => {
    const text = '```\n## Heading\n```\n\nTrailing prose outside the fence.';
    // Closing fence is not at the end → leave alone (ambiguous shape).
    expect(unwrapBareFence(text)).toBe(text);
  });

  it('does not unwrap a fence whose inner content is plain code', () => {
    const text = '```\nnpm install\nnpm run build\n```';
    expect(unwrapBareFence(text)).toBe(text);
  });

  it('tolerates a language tag on the opening fence', () => {
    const wrapped = '```markdown\n# Title\n\n- bullet\n```';
    expect(unwrapBareFence(wrapped)).toBe('# Title\n\n- bullet');
  });

  it('does not unwrap a real markdown doc with a code block plus a stray trailing fence', () => {
    // The menubar-popover.md regression: a full markdown doc (headings, table)
    // containing a legitimate fenced mockup, then an orphaned closing fence at
    // EOF. First-open/last-close would span the whole doc and flatten it.
    const text = [
      '# Menubar Popover',
      '',
      'Some **intro** prose.',
      '',
      '| File | What |',
      '|------|------|',
      '| a.ts | thing |',
      '',
      '```',
      '╭─────╮',
      '│ box │',
      '╰─────╯',
      '```',
      '',
      '## Notes',
      '',
      '- a follow-up item',
      '```'
    ].join('\n');
    expect(unwrapBareFence(text)).toBe(text);
  });

  it('handles CRLF line endings', () => {
    const wrapped = '```\r\n## Heading\r\n\r\n- item\r\n```';
    const out = unwrapBareFence(wrapped);
    expect(out).toContain('## Heading');
    expect(out).not.toMatch(/```/);
  });
});
