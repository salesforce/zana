import { describe, expect, it } from 'vitest';
import { repairStreamingMarkdownTail } from './repair-streaming-markdown-tail.js';

describe('repairStreamingMarkdownTail', () => {
  it('closes incomplete bold and inline code', () => {
    expect(repairStreamingMarkdownTail('This is **bold')).toBe('This is **bold**');
    expect(repairStreamingMarkdownTail('Use `code')).toBe('Use `code`');
  });

  it('leaves fenced code and directives alone', () => {
    expect(repairStreamingMarkdownTail('```ts\nconst x = 1')).toBe('```ts\nconst x = 1');
    expect(repairStreamingMarkdownTail('\n::chart{id=1}')).toBe('\n::chart{id=1}');
  });
});
