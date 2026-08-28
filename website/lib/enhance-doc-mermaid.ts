'use client';

/**
 * Progressive enhancement for ```mermaid fences. mermaid is heavy (~500KB) and
 * only needed on docs that contain a diagram, so it is lazy-loaded here — the
 * same posture as the desktop Markdown renderer.
 *
 * mermaid.run reads each node's textContent (the diagram source) and replaces
 * that node with SVG. We copy source into a dedicated render target so the
 * original <pre> stays as the no-JS / error fallback.
 */

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default);
  }
  return mermaidPromise;
}

function currentMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
}

export function enhanceDocMermaid(article: HTMLElement): () => void {
  const figures = Array.from(article.querySelectorAll<HTMLElement>('figure.doc-mermaid'));
  if (figures.length === 0) return () => {};

  let cancelled = false;

  const paint = async () => {
    const mermaid = await loadMermaid();
    if (cancelled) return;
    mermaid.initialize({
      startOnLoad: false,
      theme: currentMermaidTheme(),
      securityLevel: 'strict',
      fontFamily: 'inherit'
    });

    const nodes: HTMLElement[] = [];
    for (const figure of figures) {
      const sourceEl = figure.querySelector<HTMLElement>('.doc-mermaid-source');
      const source = sourceEl?.textContent ?? '';
      if (!source.trim()) continue;
      let svgWrap = figure.querySelector<HTMLElement>('.doc-mermaid-svg');
      if (!svgWrap) {
        svgWrap = document.createElement('div');
        svgWrap.className = 'doc-mermaid-svg';
        figure.appendChild(svgWrap);
      }
      svgWrap.removeAttribute('data-processed');
      svgWrap.textContent = source;
      nodes.push(svgWrap);
    }

    if (nodes.length === 0) return;
    try {
      await mermaid.run({ nodes, suppressErrors: true });
    } catch {
      /* leave source visible */
    }
    if (cancelled) return;
    for (const figure of figures) {
      const rendered = Boolean(figure.querySelector('.doc-mermaid-svg svg'));
      const sourceEl = figure.querySelector<HTMLElement>('.doc-mermaid-source');
      if (rendered) {
        sourceEl?.setAttribute('hidden', '');
        figure.classList.add('is-rendered');
        figure.classList.remove('is-error');
      } else {
        sourceEl?.removeAttribute('hidden');
        figure.classList.add('is-error');
      }
    }
  };

  void paint();
  const themeObserver = new MutationObserver(() => {
    void paint();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return () => {
    cancelled = true;
    themeObserver.disconnect();
  };
}
