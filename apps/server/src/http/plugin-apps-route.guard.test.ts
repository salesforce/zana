import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('plugin-apps HTTP surface', () => {
  it('exposes a redacted snapshot list and enable/disable posts', () => {
    const source = readFileSync(new URL('./product-api.ts', import.meta.url), 'utf8');
    expect(source).toContain("path === '/api/v1/plugin-apps'");
    expect(source).toContain('toPluginAppSnapshot');
    expect(source).toContain("routeParams(path, '/api/v1/plugin-apps/:id/enable')");
    expect(source).toContain("routeParams(path, '/api/v1/plugin-apps/:id/disable')");
    expect(source).toContain("path === '/api/v1/plugin-apps/updates'");
    expect(source).toContain("routeParams(path, '/api/v1/plugin-apps/:id/update')");
    expect(source).toContain("routeParams(path, '/api/v1/plugin-apps/:id/rpc')");
    expect(source).toContain("routeParams(path, '/api/v1/plugin-apps/:id/settings')");
  });
});
