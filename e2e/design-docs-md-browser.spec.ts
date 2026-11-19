import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

// A markdown design-doc file opens as a rendered, script-free page; .mdx stays raw.
test('Design Docs markdown file opens rendered in the browser', async ({ app }) => {
  test.setTimeout(120_000);
  const win = app.window;
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  const rpc = (method: string, input: unknown) => win.evaluate(({ method, input }) => window.cc.pluginApps.callRpc('design-docs', method, input), { method, input });
  const doc = (await rpc('create', { title: 'Markdown browser doc' })) as { id: string };
  for (const [path, content] of [
    ['README.md', '# Hello\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>window.pwned=1</script>\n'],
    ['notes.mdx', '# Raw mdx']
  ] as const) await rpc('writeFile', { doc: doc.id, path, content });

  const link = async (path: string) =>
    (await win.evaluate(({ id, path }) => window.cc.pluginApps.callRpc('design-docs', 'pageLink', { doc: id, path }), { id: doc.id, path })) as { url: string };

  const { url } = await link('README.md');
  // The URL names the default server port; the test app serves on its own, so fetch the same path from the window.
  const get = (target: string) => win.evaluate(async (href) => {
    const u = new URL(href);
    const res = await fetch(u.pathname + u.search);
    return { status: res.status, type: res.headers.get('content-type') ?? '', csp: res.headers.get('content-security-policy') ?? '', body: await res.text() };
  }, target);
  const response = await get(url);
  expect(response.status, response.body).toBe(200);
  expect(response.type).toContain('text/html');
  const csp = response.csp;
  expect(csp).toContain("script-src 'none'");
  expect(csp).not.toContain('allow-scripts');
  const body = response.body;
  expect(body).toContain('<table>');
  expect(body).toContain('<h1 id="hello">');
  expect(body).not.toMatch(/<script/i);

  // .mdx has no rendered page: the page route refuses it and the file route serves raw text.
  const mdx = await link('notes.mdx');
  expect((await get(mdx.url)).status).toBe(400);
});
