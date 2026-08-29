import { describe, expect, it } from 'vitest';
import { DOCS, renderDoc } from '../docs';
import { isMermaidInfostring, mermaidFigureHtml } from '../doc-mermaid';

describe('isMermaidInfostring', () => {
  it('matches a mermaid fence tag and ignores extra infostring tokens', () => {
    expect(isMermaidInfostring('mermaid')).toBe(true);
    expect(isMermaidInfostring('MERMAID')).toBe(true);
    expect(isMermaidInfostring('mermaid theme=dark')).toBe(true);
    expect(isMermaidInfostring('bash')).toBe(false);
    expect(isMermaidInfostring(undefined)).toBe(false);
    expect(isMermaidInfostring('')).toBe(false);
  });
});

describe('mermaidFigureHtml', () => {
  it('emits a figure with escaped source, not a shiki code wrap', () => {
    const html = mermaidFigureHtml('flowchart LR\n    A["Install <app>"] --> B');
    expect(html).toContain('class="doc-mermaid"');
    expect(html).toContain('class="doc-mermaid-source"');
    expect(html).toContain('A["Install &lt;app&gt;"]');
    expect(html).not.toContain('code-wrap');
    expect(html).not.toContain('code-copy');
  });
});

describe('renderDoc mermaid fences', () => {
  it('renders published getting-started and cli diagrams as mermaid figures', async () => {
    const gettingStarted = DOCS.find((d) => d.slug === 'getting-started');
    const cli = DOCS.find((d) => d.slug === 'cli');
    expect(gettingStarted).toBeTruthy();
    expect(cli).toBeTruthy();

    const started = await renderDoc(gettingStarted!);
    expect(started.html).toContain('class="doc-mermaid"');
    expect(started.html).toContain('Start a thread');
    const diagramAt = started.html.indexOf('flowchart LR');
    expect(diagramAt).toBeGreaterThan(started.html.indexOf('class="doc-mermaid"'));
    expect(started.html.lastIndexOf('code-wrap', diagramAt)).toBeLessThan(started.html.indexOf('class="doc-mermaid"'));

    const cliDoc = await renderDoc(cli!);
    expect(cliDoc.html).toContain('class="doc-mermaid"');
    expect(cliDoc.html).toContain('control.sock');
    expect(cliDoc.html).toContain('class="code-wrap"');
  });

  it('renders ```text CLI dumps as readable plaintext, not shiki comment-gray', async () => {
    const cli = DOCS.find((d) => d.slug === 'cli');
    expect(cli).toBeTruthy();
    const { html } = await renderDoc(cli!);
    const dumpAt = html.indexOf('READ COMMANDS');
    expect(dumpAt).toBeGreaterThan(-1);
    expect(html).toContain('plugin ls');
    const lastShiki = html.lastIndexOf('class="shiki', dumpAt);
    const lastPlain = html.lastIndexOf('<pre><code>', dumpAt);
    expect(lastPlain).toBeGreaterThan(lastShiki);
  });
});
