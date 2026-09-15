import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { extractMermaid } from './markdown-mermaid.js';

describe('extractMermaid', () => {
  it('returns the fenced source for a mermaid code element', () => {
    const code = createElement('code', { className: 'language-mermaid' }, 'graph TD;\nA-->B\n');
    expect(extractMermaid(code)).toBe('graph TD;\nA-->B');
  });

  it('joins split text nodes so a remount cannot miss the fence', () => {
    const code = createElement('code', { className: 'language-mermaid' }, ['graph TD;\n', 'A-->B']);
    expect(extractMermaid(code)).toBe('graph TD;\nA-->B');
  });

  it('ignores non-mermaid fences', () => {
    const code = createElement('code', { className: 'language-js' }, 'graph TD;');
    expect(extractMermaid(code)).toBeNull();
  });
});
