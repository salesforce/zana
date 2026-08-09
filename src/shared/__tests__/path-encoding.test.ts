import { describe, it, expect } from 'vitest';
import { encodeProjectCwd } from '../path-encoding.js';

describe('encodeProjectCwd', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    // Verified against real ~/.claude/projects directory names.
    expect(encodeProjectCwd('/Users/grebmann/Documents/claude-workspace/zana-command-center')).toBe(
      '-Users-grebmann-Documents-claude-workspace-zana-command-center'
    );
    expect(encodeProjectCwd('/Users/grebmann/.aisuite/notebook')).toBe(
      '-Users-grebmann--aisuite-notebook'
    );
    expect(encodeProjectCwd('/Users/grebmann/.npm/_npx/x/node_modules')).toBe(
      '-Users-grebmann--npm--npx-x-node-modules'
    );
  });

  it('collapses slashes, dots, underscores, and other special chars to dashes', () => {
    const pathWithMixed = '/Users/x/my.app_dir-v2';
    expect(encodeProjectCwd(pathWithMixed)).toBe('-Users-x-my-app-dir-v2');

    // Verify no special characters remain
    expect(encodeProjectCwd(pathWithMixed)).not.toContain('/');
    expect(encodeProjectCwd(pathWithMixed)).not.toContain('.');
    expect(encodeProjectCwd(pathWithMixed)).not.toContain('_');
  });

  it('preserves alphanumeric characters unchanged', () => {
    expect(encodeProjectCwd('/abc123/XYZ789')).toBe('-abc123-XYZ789');
  });

  it('handles consecutive non-alphanumeric characters as consecutive dashes', () => {
    // Double-dot and slash-underscore sequences each produce multiple dashes
    expect(encodeProjectCwd('/path/../_test')).toBe('-path-----test');
  });

  it('handles empty string', () => {
    expect(encodeProjectCwd('')).toBe('');
  });

  it('handles paths with spaces, parens, and other punctuation', () => {
    const complexPath = '/Users/x/Projects (2024)/my-app@v1.0';
    const encoded = encodeProjectCwd(complexPath);
    // All non-alphanumeric → dashes
    expect(encoded).toMatch(/^-Users-x-Projects-+2024-+-my-app-v1-0$/);
    // No special chars remain
    expect(encoded).not.toContain('(');
    expect(encoded).not.toContain(')');
    expect(encoded).not.toContain('@');
    expect(encoded).not.toContain('.');
  });
});
