import { describe, expect, it } from 'vitest';
import { previewPathRequestSchema, previewPathResultSchema } from './preview-path.js';

describe('thread preview path contracts', () => {
  it('caps basename lookup hints and requires a bounded path', () => {
    expect(previewPathRequestSchema.safeParse({ path: 'report.md', hints: ['docs/report.md'] }).success).toBe(true);
    expect(previewPathRequestSchema.safeParse({ path: '../report.md' }).success).toBe(false);
    expect(previewPathRequestSchema.safeParse({ path: 'report.md', hints: ['../shared/report.md'] }).success).toBe(true);
    expect(previewPathRequestSchema.safeParse({ path: 'report.md', hints: Array(51).fill('a.md') }).success).toBe(false);
  });

  it('represents incomplete discovery separately from an unambiguous match', () => {
    expect(previewPathResultSchema.safeParse({ kind: 'resolved', path: 'docs/report.md' }).success).toBe(true);
    expect(previewPathResultSchema.safeParse({ kind: 'incomplete', paths: ['docs/report.md'] }).success).toBe(true);
  });

  it('includes the authorized location checked for missing paths', () => {
    expect(previewPathResultSchema.safeParse({
      kind: 'not_found', path: 'docs/report.md', checkedPath: 'D:\\repo\\docs\\report.md'
    }).success).toBe(true);
  });
});
