import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { isLoopbackHttpHost, readBrowserBootstrap } from '../server/src/browser-bootstrap.js';

function sendJson(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

/**
 * Vite has no `/_zcc/*` routes of its own, so a browser hitting the renderer
 * origin would otherwise receive `index.html` and fail JSON.parse. This plugin
 * serves the same read-only bootstrap the production static host exposes.
 */
export function zccBrowserBootstrapPlugin(): Plugin {
  return {
    name: 'zcc-browser-bootstrap',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const pathname = req.url?.split('?')[0];
        if (pathname !== '/_zcc/bootstrap' && pathname !== '/_zcc/health') {
          next();
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          res.end();
          return;
        }
        if (!isLoopbackHttpHost(req.headers.host)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (pathname === '/_zcc/health') {
          sendJson(res, { ok: true });
          return;
        }
        sendJson(res, readBrowserBootstrap({ appVersion: process.env.npm_package_version ?? '' }));
      });
    }
  };
}
