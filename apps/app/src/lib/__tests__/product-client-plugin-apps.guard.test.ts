import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('product-client pluginApps', () => {
  it('calls the redacted plugin-apps HTTP surface instead of returning an empty stub', () => {
    const source = readFileSync(new URL('../product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain("apiJson<{ apps?: PluginAppEntry[] }>('/plugin-apps')");
    expect(source).toContain('/plugin-apps/${encodeURIComponent(id)}/');
    expect(source).not.toMatch(/pluginApps:\s*\{[\s\S]*?list:\s*async\s*\(\)\s*=>\s*\[\]/);
  });
});
