import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { expect, it, vi } from 'vitest';
import { GUIDE_REPOSITORY, guideMarkdown, helpCatalog } from './catalog.js';
import { HelperCatalog } from './catalog-refresh.js';

it('serves guides immediately, shares one background refresh, and keeps its main links offline', async () => {
  const { zcc } = createFakePluginHost();
  const text = 'Updated steps. See [another guide](slackbot-app.md#setup).';
  const version = '99.0.0';
  const guide = {
    ...helpCatalog.entries[0], text,
    url: `${GUIDE_REPOSITORY}v${version}/docs/slack-user-guide.md#corrected-heading`
  };
  const revised = { ...helpCatalog, version, entries: [guide] };
  const response = Promise.withResolvers<Response>();
  const changed = Promise.withResolvers<void>();
  const download = vi.fn(() => response.promise);
  const catalog = new HelperCatalog(zcc.storage.kv, download, changed.resolve);
  catalog.setRefreshEnabled(true);
  expect(await Promise.all([catalog.entries(), catalog.entries()])).toEqual([helpCatalog.entries, helpCatalog.entries]);
  expect(download).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledWith(expect.stringContaining('/zana/main/'), expect.objectContaining({ redirect: 'error' }));

  response.resolve(Response.json(revised));
  await changed.promise;
  const mainGuide = { ...guide, url: `${GUIDE_REPOSITORY}main/docs/slack-user-guide.md#corrected-heading` };
  expect(await catalog.entries()).toEqual([mainGuide]);
  expect(guideMarkdown(text, mainGuide.url)).toContain(`${GUIDE_REPOSITORY}main/docs/slackbot-app.md#setup`);
  expect(download).toHaveBeenCalledTimes(1);

  const offline = new HelperCatalog(zcc.storage.kv, vi.fn().mockRejectedValue(new Error('Offline')));
  expect(await offline.entries()).toEqual([mainGuide]);
});

it.each([
  ['an incompatible schema', () => Response.json({ ...helpCatalog, schemaVersion: helpCatalog.schemaVersion + 1 }), /incompatible schema/],
  ['a malformed release version', () => Response.json({ ...helpCatalog, version: '../main' }), /invalid entries/],
  ['an outside source', () => Response.json({ ...helpCatalog, entries: [{ ...helpCatalog.entries[0], url: 'https://example.org/guide' }] }), /invalid entries/],
  ['a source that escapes its ref', () => Response.json({ ...helpCatalog, entries: [{
    ...helpCatalog.entries[0], url: `${GUIDE_REPOSITORY}v${helpCatalog.version}/../different-ref/docs/guide.md`
  }] }), /invalid entries/],
  ['duplicate entries', () => Response.json({ ...helpCatalog, entries: [helpCatalog.entries[0], helpCatalog.entries[0]] }), /invalid entries/],
  ['an oversized response', () => new Response('x'.repeat(200_000)), /size limit/],
  ['an empty response', () => new Response(null, { status: 200 }), /no body/],
  ['a missing catalog', () => new Response(null, { status: 404 }), /HTTP 404/],
  ['invalid JSON', () => new Response('private-looking invalid response'), /invalid JSON/]
] as const)('uses bundled guides and logs a safe reason for %s', async (_case, response, reason) => {
  const { zcc } = createFakePluginHost();
  const reply = response();
  const changed = vi.fn();
  const debug = vi.fn();
  const catalog = new HelperCatalog(zcc.storage.kv, vi.fn(async () => reply), changed, debug);
  catalog.setRefreshEnabled(true);
  expect(await catalog.entries()).toEqual(helpCatalog.entries);
  await vi.waitFor(() => expect(debug).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(reason)));
  expect(debug.mock.calls[0]?.[0]).not.toContain('private-looking');
  expect(await catalog.entries()).toEqual(helpCatalog.entries);
  expect(changed).not.toHaveBeenCalled();
});

it('serves offline guides with updates off and cancels an in-flight download when switched off', async () => {
  const { zcc } = createFakePluginHost();
  const response = Promise.withResolvers<Response>();
  const revised = { ...helpCatalog, entries: [{ ...helpCatalog.entries[0], text: 'Correction.' }] };
  const changed = vi.fn();
  const debug = vi.fn();
  const download = vi.fn<typeof fetch>()
    .mockReturnValueOnce(response.promise)
    .mockImplementation(async () => Response.json(revised));
  const catalog = new HelperCatalog(zcc.storage.kv, download, changed, debug);
  catalog.setRefreshEnabled(false);
  expect(await catalog.entries()).toEqual(helpCatalog.entries);
  expect(download).not.toHaveBeenCalled();

  catalog.setRefreshEnabled(true);
  expect(await catalog.entries()).toEqual(helpCatalog.entries);
  const signal = download.mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  catalog.setRefreshEnabled(false);
  expect(signal?.aborted).toBe(true);
  response.resolve(Response.json(revised));
  // The fetcher deliberately ignores cancellation and still returns a response.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(await catalog.entries()).toEqual(helpCatalog.entries);
  expect(changed).not.toHaveBeenCalled();
  expect(debug).not.toHaveBeenCalled();
  expect(download).toHaveBeenCalledTimes(1);

  catalog.setRefreshEnabled(true);
  await catalog.entries();
  expect(download).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
});

it('logs network and storage failures without exposing upstream error messages', async () => {
  const { zcc } = createFakePluginHost();
  const sensitive = 'private proxy or storage error details';
  const debug = vi.fn();
  const catalog = new HelperCatalog(zcc.storage.kv, vi.fn().mockRejectedValue(new Error(sensitive)), undefined, debug);
  vi.spyOn(zcc.storage.kv, 'get').mockRejectedValueOnce(new Error(sensitive));
  catalog.setRefreshEnabled(true);
  expect(await catalog.entries()).toEqual(helpCatalog.entries);
  await vi.waitFor(() => expect(debug.mock.calls).toEqual([
    ['Could not read the saved guide catalog.'],
    ['Guide catalog refresh failed.']
  ]));

  debug.mockClear();
  const revised = { ...helpCatalog, entries: [{ ...helpCatalog.entries[0], text: 'Correction.' }] };
  const changed = vi.fn();
  const offline = new HelperCatalog(zcc.storage.kv, vi.fn(async () => Response.json(revised)), changed, debug);
  vi.spyOn(zcc.storage.kv, 'set').mockRejectedValueOnce(new Error(sensitive));
  offline.setRefreshEnabled(true);
  await offline.entries();
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(debug).toHaveBeenCalledExactlyOnceWith('Could not save the updated guide catalog.');
  expect((await offline.entries())[0]?.text).toBe('Correction.');
});
