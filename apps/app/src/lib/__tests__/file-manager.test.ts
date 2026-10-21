import { describe, expect, it } from 'vitest';
import { fileManagerBlurb, fileManagerName, fileManagerTitle } from '../file-manager.js';

describe('fileManagerName', () => {
  it('names Explorer on Windows', () => {
    expect(fileManagerName('Win32')).toBe('Explorer');
    expect(fileManagerTitle('Win32')).toBe('Explorer');
    expect(fileManagerBlurb('Win32')).toBe('Reveals a path in Windows File Explorer.');
  });

  it('names Finder on macOS', () => {
    expect(fileManagerName('MacIntel')).toBe('Finder');
    expect(fileManagerTitle('MacIntel')).toBe('Finder');
    expect(fileManagerBlurb('MacIntel')).toBe('Reveals a path in the macOS Finder.');
  });

  it('names a generic file manager on Linux and unknown platforms', () => {
    for (const platform of ['Linux x86_64', '']) {
      expect(fileManagerName(platform)).toBe('file manager');
      expect(fileManagerTitle(platform)).toBe('File manager');
      expect(fileManagerBlurb(platform)).toBe('Reveals a path in the system file manager.');
    }
  });

  it('reads navigator.platform by default', () => {
    expect(fileManagerName()).toBe(fileManagerName(navigator.platform));
    expect(fileManagerTitle()).toBe(fileManagerTitle(navigator.platform));
    expect(fileManagerBlurb()).toBe(fileManagerBlurb(navigator.platform));
  });
});
