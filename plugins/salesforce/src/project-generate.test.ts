import { describe, expect, it } from 'vitest';
import { generatedOutputPath, generatedProjectPath, parseGenerateInput } from '../lib/project-generate.js';

describe('parseGenerateInput', () => {
  it('accepts a name and parent folder', () => {
    expect(parseGenerateInput({ name: ' Acme ', outputDir: ' /tmp/ws ' })).toEqual({
      ok: true,
      name: 'Acme',
      outputDir: '/tmp/ws'
    });
  });

  it('rejects a missing or path-like name', () => {
    expect(parseGenerateInput({})).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(parseGenerateInput({ name: '', outputDir: '/tmp' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(parseGenerateInput({ name: 'foo/bar', outputDir: '/tmp' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(parseGenerateInput({ name: 'foo\\bar', outputDir: '/tmp' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(parseGenerateInput({ name: '..', outputDir: '/tmp' })).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(parseGenerateInput({ name: 'Acme', outputDir: '' })).toMatchObject({ ok: false, code: 'invalid_input' });
  });
});

describe('generatedOutputPath', () => {
  it('prefers the CLI outputDir and falls back to parent/name', () => {
    expect(generatedOutputPath({ outputDir: '/tmp/ws/Acme' }, '/tmp/ws', 'Acme')).toBe('/tmp/ws/Acme');
    expect(generatedProjectPath('/tmp/ws', 'Acme')).toBe('/tmp/ws/Acme');
    expect(generatedOutputPath(null, '/tmp/ws', 'Acme')).toBe('/tmp/ws/Acme');
  });
});
