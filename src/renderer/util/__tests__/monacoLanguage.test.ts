import { describe, it, expect } from 'vitest';
import { languageFromPath } from '../monacoLanguage.js';

/**
 * `languageFromPath` maps a file path to a Monaco language id, shared by the
 * Explorer's editor/diff and the agent-modal Changes diff. It keys on the
 * lowercased extension and returns undefined when there's no good match (Monaco
 * then renders plain text) — never throws.
 */
describe('languageFromPath', () => {
  it('maps common source extensions to Monaco language ids', () => {
    expect(languageFromPath('src/renderer/App.tsx')).toBe('typescript');
    expect(languageFromPath('a/b/c.ts')).toBe('typescript');
    expect(languageFromPath('script.js')).toBe('javascript');
    expect(languageFromPath('data.json')).toBe('json');
    expect(languageFromPath('README.md')).toBe('markdown');
    expect(languageFromPath('main.py')).toBe('python');
    expect(languageFromPath('styles.css')).toBe('css');
  });

  it('uses Monaco ids (shell, not bash) so it does not alias highlight.js', () => {
    expect(languageFromPath('deploy.sh')).toBe('shell');
    expect(languageFromPath('.zshrc.zsh')).toBe('shell');
  });

  it('is case-insensitive on the extension', () => {
    expect(languageFromPath('Component.TSX')).toBe('typescript');
    expect(languageFromPath('DATA.JSON')).toBe('json');
  });

  it('returns undefined for unknown or extensionless paths', () => {
    expect(languageFromPath('Makefile')).toBeUndefined();
    expect(languageFromPath('bin/tool')).toBeUndefined();
    expect(languageFromPath('archive.xyz')).toBeUndefined();
  });
});
