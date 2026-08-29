/** Fence-tag check for ```mermaid blocks. Extra infostring tokens are ignored. */
export function isMermaidInfostring(infostring: string | undefined): boolean {
  return ((infostring || '').match(/\S*/)?.[0]?.toLowerCase() ?? '') === 'mermaid';
}

function escapeHtml(source: string): string {
  return source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Server-rendered mermaid placeholder. DocsEnhancer lazy-loads mermaid and
 * replaces the source with SVG; without JS the source stays readable.
 */
export function mermaidFigureHtml(source: string): string {
  return `<figure class="doc-mermaid"><pre class="doc-mermaid-source">${escapeHtml(source)}</pre></figure>\n`;
}
