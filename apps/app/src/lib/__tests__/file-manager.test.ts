import { describe, expect, it } from 'vitest';
import { fileManagerBlurb, fileManagerName } from '../file-manager.js';

describe('fileManagerName', () => {
  it('names Explorer on Windows', () => {
    expect(fileManagerName('Win32')).toBe('Explorer');
    expect(fileManagerBlurb('Win32')).toBe('Reveals a path in Windows File Explorer.');
  });

  it('names Finder on macOS and other platforms', () => {
    expect(fileManagerName('MacIntel')).toBe('Finder');
    expect(fileManagerName('Linux x86_64')).toBe('Finder');
    expect(fileManagerBlurb('MacIntel')).toBe('Reveals a path in the macOS Finder.');
  });

  it('reads navigator.platform by default', () => {
    const expected = navigator.platform.toUpperCase().startsWith('WIN') ? 'Explorer' : 'Finder';
    expect(fileManagerName()).toBe(expected);
  });
});
