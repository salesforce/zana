import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCliInput, CLI_INPUT_FILE_MAX } from '../lib/cli-input.js';
import { createNodeDeps } from '../lib/node-deps.js';

const roots: string[] = [];
const folder = () => { const root = mkdtempSync(join(tmpdir(), 'sf-cli-input-')); roots.push(root); return root; };
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
describe('CLI JSON input files', () => {
  it('preserves inline/default input and gives actionable option errors', () => {
    const deps = createNodeDeps();
    expect(readCliInput([], undefined, deps)).toEqual({});
    expect(readCliInput(['--input', '{"x":0}'], undefined, deps)).toEqual({ x: 0 });
    expect(() => readCliInput(['--input'], undefined, deps)).toThrow('valid JSON');
    expect(() => readCliInput(['--input', '{}', '--input-file', 'a.json'], undefined, deps)).toThrow('not both');
    expect(() => readCliInput(['--input', '{}', '--input', '{}'], undefined, deps)).toThrow('one input');
    expect(() => readCliInput(['--input-file', '--json'], undefined, deps)).toThrow('JSON path');
    expect(() => readCliInput(['--input-file', 'a.json'], undefined, deps)).toThrow('registered project');
  });
  it('reads a complete large UTF-8 snapshot from relative or absolute project paths', () => {
    const root = folder(), deps = createNodeDeps();
    mkdirSync(join(root, 'inputs'));
    const source = '# é ∑ 😀\n'.repeat(40000) + '# END_OF_SOURCE';
    writeFileSync(join(root, 'inputs/parse.json'), JSON.stringify({ source }));
    for (const path of ['inputs/parse.json', join(root, 'inputs/parse.json')]) expect(readCliInput(['--input-file', path], root, deps)).toEqual({ source });
  });
  it('rejects missing files, directories, symlinks outside the project and parent escapes', () => {
    const root = folder(), outside = folder(), deps = createNodeDeps();
    writeFileSync(join(outside, 'private.json'), '{}');
    symlinkSync(join(outside, 'private.json'), join(root, 'escape.json'));
    for (const candidate of ['missing.json', '.', 'escape.json', join(outside, 'private.json'), '../private.json']) expect(() => readCliInput(['--input-file', candidate], root, deps)).toThrow('inside the registered project');
  });
  it('bounds the actual file, rejects invalid JSON and fails closed without a bounded reader', () => {
    const root = folder(), deps = createNodeDeps();
    writeFileSync(join(root, 'input.json'), '{invalid');
    expect(() => readCliInput(['--input-file', 'input.json'], root, deps)).toThrow('valid JSON');
    const readFileBounded = vi.fn(() => null);
    expect(() => readCliInput(['--input-file', 'input.json'], root, { ...deps, readFileBounded })).toThrow('Could not read');
    expect(readFileBounded).toHaveBeenCalledWith(expect.any(String), CLI_INPUT_FILE_MAX);
    expect(() => readCliInput(['--input-file', 'input.json'], root, { ...deps, readFileBounded: undefined })).toThrow('unavailable');
    writeFileSync(join(root, 'input.json'), ' '.repeat(CLI_INPUT_FILE_MAX + 1));
    expect(() => readCliInput(['--input-file', 'input.json'], root, deps)).toThrow('size limit');
  });
});
