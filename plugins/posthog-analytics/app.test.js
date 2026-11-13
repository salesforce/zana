import { describe, expect, it, vi } from 'vitest';
import plugin from './app.js';

describe('retired PostHog renderer', () => {
  it('remains a valid plugin entry without registering content scripts', () => {
    const register = vi.fn();
    expect(plugin.__zccPluginApp).toBe(true);
    plugin.setup({ contentScripts: { register } });
    expect(register).not.toHaveBeenCalled();
  });

  it('does not access renderer APIs or install listeners', () => {
    const app = new Proxy({}, { get() { throw new Error('retired plugin accessed renderer API'); } });
    expect(() => plugin.setup(app)).not.toThrow();
  });
});
