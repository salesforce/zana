import { describe, expect, it } from 'vitest';
import { toPersonaSummary, type Persona } from '../product.js';

const base = { id: 'user:a', name: 'A' } as Persona;

describe('toPersonaSummary mcpServers', () => {
  it('omits the key when unrestricted', () => {
    expect('mcpServers' in toPersonaSummary(base)).toBe(false);
  });
  it('preserves an empty allowlist (restricted to none)', () => {
    expect(toPersonaSummary({ ...base, mcpServers: [] }).mcpServers).toEqual([]);
  });
  it('exposes the list and still omits launch internals', () => {
    const s = toPersonaSummary({ ...base, mcpServers: ['github'], appendSystemPrompt: 'secret' });
    expect(s.mcpServers).toEqual(['github']);
    expect('appendSystemPrompt' in s).toBe(false);
  });
});
