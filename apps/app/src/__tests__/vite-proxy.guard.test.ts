import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { productDevProxy } from '../../vite-product-proxy.js';

describe('Vite product proxy', () => {
  it('forwards /api, /ws, and plugin asset URLs to the loopback product server', () => {
    const source = readFileSync(new URL('../../vite.dev.config.ts', import.meta.url), 'utf8');
    const electron = readFileSync(new URL('../../../../electron.vite.config.ts', import.meta.url), 'utf8');
    expect(source).toContain('productDevProxy');
    expect(electron).toContain('productDevProxy');

    const proxy = productDevProxy('http://127.0.0.1:8780');
    expect(proxy['/api']).toMatchObject({ target: 'http://127.0.0.1:8780', changeOrigin: true });
    expect(proxy['/ws']).toMatchObject({ target: 'http://127.0.0.1:8780', ws: true });
    const plugins = proxy['/plugins'];
    expect(plugins).toMatchObject({ target: 'http://127.0.0.1:8780', changeOrigin: true });
    if (typeof plugins === 'string' || !plugins.bypass) throw new Error('expected plugin asset bypass');
    expect(plugins.bypass({ url: '/plugins/ask-user-question/assets/app.js?v=1' } as never, {} as never, {} as never)).toBeUndefined();
    expect(
      plugins.bypass({
        url: '/plugins/provider-claude-code/assets/app.tsx?import&v=1'
      } as never, {} as never, {} as never)
    ).toBeUndefined();
    expect(plugins.bypass({} as never, {} as never, {} as never)).toBeUndefined();
    expect(plugins.bypass({ url: '/plugins/github/main' } as never, {} as never, {} as never)).toBe('/plugins/github/main');
  });

  it('registers a pre-transform proxy so Vite cannot claim plugin .tsx assets', () => {
    const source = readFileSync(new URL('../../vite.dev.config.ts', import.meta.url), 'utf8');
    const electron = readFileSync(new URL('../../../../electron.vite.config.ts', import.meta.url), 'utf8');
    const proxySource = readFileSync(new URL('../../vite-product-proxy.ts', import.meta.url), 'utf8');
    expect(source).toContain('pluginAssetDevProxyPlugin');
    expect(electron).toContain('pluginAssetDevProxyPlugin');
    expect(proxySource).toContain('zcc-plugin-asset-dev-proxy');
    expect(proxySource).toContain('isPluginAssetPath');
  });
});
