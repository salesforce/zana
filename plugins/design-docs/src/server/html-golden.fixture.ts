/**
 * What `/page` and `/file` return for HTML and raw files. The saved snapshot in
 * `__golden__/html-routes.json` was captured from the code before markdown
 * pages existed; `html-golden.test.ts` pins the routes to it byte for byte.
 */
import type { PluginHttpResponse } from '@zana-ai/zcc-plugin-sdk/server';

export const GOLDEN_FILES = [
  {
    path: 'index.html',
    content:
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><img src="logo.png"><script src="app.js"></script><a href="runs/r1.md">r1</a><a href="data.json">d</a></body></html>'
  },
  { path: 'style.css', content: 'h1 { margin: 0 }' },
  { path: 'app.js', content: 'fetch("data.json")' },
  { path: 'data.json', content: '{"runs":["</script>"]}' },
  { path: 'runs/r1.md', content: '# Run 1' },
  { path: 'logo.png', content: 'iVBORw0KGgo=', encoding: 'base64' as const }
];

export interface GoldenDeps {
  createPageRoutes: (deps: { store: unknown; kit: unknown; endpoint: string; runtime(): string }) => {
    page(request: unknown): PluginHttpResponse;
    file(request: unknown): PluginHttpResponse;
  };
  NO_KIT: unknown;
  store: { create(input: unknown, actor: unknown): { id: string } };
}

export type GoldenSnapshot = Record<string, { status: number; headers: Record<string, string>; body: string }>;

/** Every response, with the doc id replaced so snapshots compare across runs. */
export function captureHtmlRoutes(deps: GoldenDeps): GoldenSnapshot {
  const doc = deps.store.create({ title: 'Golden', files: GOLDEN_FILES, entryPath: 'index.html' }, { kind: 'user', label: 'You', threadId: null });
  const routes = deps.createPageRoutes({ store: deps.store, kit: deps.NO_KIT, endpoint: '/x', runtime: () => '/*runtime*/' });
  const request = (path: string, query: Record<string, string>) => ({ method: 'GET', path, query: { doc: doc.id, ...query }, body: undefined });
  const snap = (response: PluginHttpResponse) => ({
    status: response.status ?? 200,
    headers: { ...(response.headers ?? {}) },
    body: (typeof response.body === 'string' ? response.body : `bytes:${Buffer.from(response.body as Uint8Array).toString('base64')}`).split(doc.id).join('<DOC>')
  });
  return {
    'page:entry': snap(routes.page(request('/page', {}))),
    'page:index.html': snap(routes.page(request('/page', { path: 'index.html' }))),
    'file:index.html': snap(routes.file(request('/file', { path: 'index.html' }))),
    'file:logo.png': snap(routes.file(request('/file', { path: 'logo.png' }))),
    'file:app.js': snap(routes.file(request('/file', { path: 'app.js' }))),
    'file:style.css': snap(routes.file(request('/file', { path: 'style.css' }))),
    'page:style.css': snap(routes.page(request('/page', { path: 'style.css' }))),
    'file:gone': snap(routes.file(request('/file', { path: 'gone.txt' })))
  };
}
