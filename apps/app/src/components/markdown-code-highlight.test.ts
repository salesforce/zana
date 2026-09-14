import { describe, expect, it } from 'vitest';
import {
  highlightMarkdownCode,
  languageFromMarkdownClassName
} from './markdown-code-highlight.js';

describe('highlightMarkdownCode', () => {
  it('returns a stable innerHTML object on cache hits', () => {
    const args = { code: 'const x: number = 1;', language: 'typescript' };
    const first = highlightMarkdownCode(args);
    const second = highlightMarkdownCode(args);
    expect(first).toBe(second);
    expect(first.__html).toContain('hljs-');
    expect(first.__html).not.toContain('<script');
  });

  it('escapes HTML when highlighting unknown source', () => {
    const html = highlightMarkdownCode({
      code: 'const el = <div>{"a < b"}</div>;',
      language: 'xml'
    });
    expect(html.__html).not.toContain('<div>');
    expect(html.__html).toContain('&lt;');
  });

  it('reads a fenced language from the markdown className', () => {
    expect(languageFromMarkdownClassName('language-ts')).toBe('ts');
    expect(languageFromMarkdownClassName('language-mermaid')).toBeNull();
    expect(languageFromMarkdownClassName(undefined)).toBeNull();
  });
});
