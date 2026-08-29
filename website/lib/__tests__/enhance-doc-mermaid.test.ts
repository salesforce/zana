import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn()
  }
}));

import mermaid from 'mermaid';
import { enhanceDocMermaid } from '../enhance-doc-mermaid';

const initialize = mermaid.initialize as unknown as ReturnType<typeof vi.fn>;
const run = mermaid.run as unknown as ReturnType<typeof vi.fn>;

function sourceEl(text: string) {
  const attrs = new Map<string, string>();
  return {
    textContent: text,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    attrs
  };
}

function svgWrap() {
  let childSvg: { tagName: string } | null = null;
  return {
    className: 'doc-mermaid-svg',
    textContent: '',
    removeAttribute: vi.fn(),
    querySelector: (sel: string) => (sel === 'svg' ? childSvg : null),
    setSvg() {
      childSvg = { tagName: 'svg' };
    }
  };
}

function figure(source: string) {
  const src = sourceEl(source);
  const wrap = svgWrap();
  const classes = new Set<string>();
  return {
    querySelector(sel: string) {
      if (sel === '.doc-mermaid-source') return src;
      if (sel === '.doc-mermaid-svg') return wrap;
      if (sel === '.doc-mermaid-svg svg') return wrap.querySelector('svg');
      return null;
    },
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c)
    },
    appendChild: vi.fn(),
    classes,
    src,
    wrap
  };
}

describe('enhanceDocMermaid', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('is a no-op when the article has no mermaid figures', () => {
    const article = { querySelectorAll: () => [] } as unknown as HTMLElement;
    const stop = enhanceDocMermaid(article);
    expect(typeof stop).toBe('function');
    stop();
    expect(initialize).not.toHaveBeenCalled();
  });

  it('copies source into a render target and hides it after mermaid.run succeeds', async () => {
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('document', {
      documentElement: { getAttribute: () => 'light' },
      createElement: () => svgWrap()
    });

    run.mockImplementation(async ({ nodes }: { nodes: Array<ReturnType<typeof svgWrap>> }) => {
      for (const node of nodes) node.setSvg();
    });

    const fig = figure('flowchart LR\n A --> B');
    const article = { querySelectorAll: () => [fig] } as unknown as HTMLElement;

    const stop = enhanceDocMermaid(article);
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    );
    expect(fig.src.attrs.get('hidden')).toBe('');
    expect(fig.classes.has('is-rendered')).toBe(true);
    stop();
  });

  it('keeps source visible when mermaid.run does not produce an svg', async () => {
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('document', {
      documentElement: { getAttribute: () => 'dark' },
      createElement: () => svgWrap()
    });
    run.mockResolvedValue(undefined);

    const fig = figure('not a diagram');
    const article = { querySelectorAll: () => [fig] } as unknown as HTMLElement;
    const stop = enhanceDocMermaid(article);
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    expect(fig.classes.has('is-error')).toBe(true);
    expect(fig.src.attrs.has('hidden')).toBe(false);
    stop();
  });
});
