import { describe, it, expect } from 'vitest';
import { EXTENSION_PERMISSIONS, isExtensionPermission } from '../index.js';

/**
 * Guard for the closed permission-token enum (the scope-allowlist coupling note:
 * the TOKENS stay a closed, exact-matched set — the `"*"` wildcard lives one
 * level down in the opaque scope allowlists, NEVER as a token). The `satisfies
 * readonly ExtensionPermission[]` on the array already makes union↔array drift a
 * compile error; this adds the RUNTIME invariants a type can't express.
 */
describe('EXTENSION_PERMISSIONS — closed enum invariants', () => {
  it('includes the streaming token', () => {
    expect(EXTENSION_PERMISSIONS).toContain('stream');
    expect(isExtensionPermission('stream')).toBe(true);
  });

  it('holds no wildcard/glob token — breadth lives in the scope allowlists, not the enum', () => {
    for (const tok of EXTENSION_PERMISSIONS) {
      expect(tok).not.toContain('*');
    }
    expect(isExtensionPermission('*')).toBe(false);
    expect(isExtensionPermission('stream:*')).toBe(false);
  });

  it('has no duplicate tokens', () => {
    expect(new Set(EXTENSION_PERMISSIONS).size).toBe(EXTENSION_PERMISSIONS.length);
  });

  it('rejects an unknown token', () => {
    expect(isExtensionPermission('teleport')).toBe(false);
  });
});
