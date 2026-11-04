import { describe, expect, it } from 'vitest';
import { templateBundleSchema } from './template-bundle.js';
import { sanitizeTemplateInput } from '../server/store.js';
import { MAX_FILES_PER_DOC, MAX_TEXT_FILE_BYTES, MAX_DOC_BYTES } from './limits.js';

const template = { key: 'key', label: 'Name', description: '', entryPath: 'README.md', files: [{ path: 'README.md', content: 'text' }] };
describe('template bundle validation', () => {
  it('accepts versioned bundle and rejects wrong kind/version and duplicate keys', () => {
    const bundle = { kind: 'zcc-design-doc-templates', version: 1, templates: [template] };
    expect(templateBundleSchema.parse(bundle).templates).toEqual([template]);
    for (const value of [{ ...bundle, kind: 'doc' }, { ...bundle, version: 2 }, { ...bundle, templates: [template, template] }]) {
      expect(templateBundleSchema.safeParse(value).success).toBe(false);
    }
  });
  it('normalizes paths, binary bytes and metadata', () => {
    expect(sanitizeTemplateInput({ ...template, label: ' Name ', files: [...template.files, { path: 'image.png', content: 'AAEC', encoding: 'base64' }] }))
      .toMatchObject({ label: 'Name', files: [{ size: 4 }, { size: 3, encoding: 'base64' }] });
  });
  it.each([
    { files: [{ path: '../bad.md', content: '' }] },
    { entryPath: '../bad.md' },
    { entryPath: 'missing.md' },
    { files: [] },
    { files: [template.files[0], { path: 'readme.md', content: '' }] },
    { files: [{ path: 'README.md', content: 'x'.repeat(MAX_TEXT_FILE_BYTES + 1) }] },
    { files: Array.from({ length: MAX_FILES_PER_DOC + 1 }, (_, i) => ({ path: `${i}.md`, content: '' })) },
    { files: Array.from({ length: MAX_DOC_BYTES / MAX_TEXT_FILE_BYTES + 1 }, (_, i) => ({ path: i === 0 ? 'README.md' : `${i}.md`, content: 'x'.repeat(MAX_TEXT_FILE_BYTES) })) },
    { files: [{ path: 'image.png', content: '???', encoding: 'base64' }] },
    { key: '' }, { label: 'x'.repeat(201) }, { description: 'x'.repeat(2001) }
  ])('rejects unsafe or over-budget input %j', (patch) => {
    expect(() => sanitizeTemplateInput({ ...template, ...patch })).toThrow();
  });
});
