import { describe, it, expect } from 'vitest';
import { countMermaidFences } from '../renderReportHtml';

/**
 * The mermaid fence count is what tells the PDF export how many diagrams to wait
 * for before snapshotting — the fix for diagrams exporting as "Rendering
 * diagram…". These guard the regex against the shapes that actually appear in
 * report bodies.
 */
describe('countMermaidFences', () => {
  const doc = (content: string) => ({ title: 't', docs: [{ path: 'a.md', content }] });

  it('counts a single mermaid fence', () => {
    expect(countMermaidFences(doc('# H\n\n```mermaid\ngraph TD; A-->B\n```\n'))).toBe(1);
  });

  it('counts multiple fences across docs and comments', () => {
    const input = {
      title: 't',
      docs: [
        { path: 'a.md', content: '```mermaid\ngraph TD; A-->B\n```' },
        { path: 'b.md', content: 'text\n```mermaid\nsequenceDiagram\n```\nmore' }
      ],
      comments: 'note\n```mermaid\npie\n```'
    };
    expect(countMermaidFences(input)).toBe(3);
  });

  it('ignores non-mermaid code fences', () => {
    expect(countMermaidFences(doc('```ts\nconst x = 1;\n```\n```bash\nls\n```'))).toBe(0);
  });

  it('matches an indented fence and a longer (````) fence', () => {
    expect(countMermaidFences(doc('  ```mermaid\ngraph TD\n```'))).toBe(1);
    expect(countMermaidFences(doc('````mermaid\ngraph TD\n````'))).toBe(1);
  });

  it('does not count mermaid in a non-markdown doc', () => {
    const input = { title: 't', docs: [{ path: 'a.ts', content: '```mermaid\ngraph\n```' }] };
    expect(countMermaidFences(input)).toBe(0);
  });

  it('returns 0 with no content', () => {
    expect(countMermaidFences({ title: 't', docs: [] })).toBe(0);
  });
});
