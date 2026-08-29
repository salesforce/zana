import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { Plugin, ProxyOptions } from 'vite';
import { isPluginAssetPath } from '../server/src/http/plugin-assets.ts';

/**
 * Loopback product-server proxy for Vite / electron-vite. `/api` and `/ws` are
 * always forwarded. `/plugins/:id/assets/*` is forwarded too (plugin renderer
 * bundles); other `/plugins/...` paths stay on the SPA.
 *
 * Vite's transform middleware still claims `.ts`/`.tsx` URLs before `server.proxy`
 * runs and rewrites them with `?import`. `pluginAssetDevProxyPlugin` must be
 * registered so those asset fetches never hit the TS pipeline.
 */
export function productDevProxy(serverOrigin: string): Record<string, string | ProxyOptions> {
  return {
    '/api': {
      target: serverOrigin,
      changeOrigin: true
    },
    '/ws': {
      target: serverOrigin,
      changeOrigin: true,
      ws: true
    },
    '/plugins': {
      target: serverOrigin,
      changeOrigin: true,
      bypass(req) {
        if (isPluginAssetPath(req.url ?? '')) return;
        return req.url;
      }
    }
  };
}

/** Proxies `/plugins/:id/assets/*` before Vite transforms source extensions. */
export function pluginAssetDevProxyPlugin(serverOrigin: string): Plugin {
  return {
    name: 'zcc-plugin-asset-dev-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!isPluginAssetPath(req.url ?? '')) {
          next();
          return;
        }
        const target = new URL(req.url ?? '/', serverOrigin);
        const headers = { ...req.headers, host: target.host };
        const upstream = httpRequest(target, { method: req.method, headers }, (incoming) => {
          res.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(res);
        });
        upstream.on('error', () => {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.end();
          }
        });
        req.pipe(upstream);
      });
    }
  };
}
