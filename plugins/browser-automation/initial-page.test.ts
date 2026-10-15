import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { reuseInitialPage } from './initial-page.js';

function fixture() {
  const page = { close: vi.fn(async () => {}) };
  const pages = [{ id: 'initial', name: null as string | null, url: 'about:blank' }, { id: 'other', name: 'checkout', url: 'https://example.test' }];
  const original = Object.freeze({
    getPage: vi.fn(async () => page), closePage: vi.fn(async () => {}),
    listPages: vi.fn(async () => pages), newPage: vi.fn(async () => page),
  });
  const run = (script: string) => runInNewContext(`(async () => { ${reuseInitialPage(script, 'initial')} })()`, { browser: original });
  return { original, page, pages, run };
}

it('reuses the initial page for main and preserves other named and anonymous page operations', async () => {
  const f = fixture();
  await f.run('await browser.getPage("main", { test: true }); await browser.getPage("checkout"); await browser.newPage();');
  expect(f.original.getPage.mock.calls).toEqual([['initial', { test: true }], ['checkout']]);
  expect(f.original.newPage).toHaveBeenCalledOnce();
  expect(await f.run('return await browser.listPages();')).toEqual([{ ...f.pages[0], name: 'main' }, f.pages[1]]);
  expect(f.pages[0]!.name).toBeNull();
});

it('closes the reused main page and falls back to a new named main after it is closed', async () => {
  const f = fixture();
  await f.run('await browser.closePage("main"); await browser.closePage("checkout");');
  expect(f.page.close).toHaveBeenCalledOnce();
  expect(f.original.closePage).toHaveBeenCalledExactlyOnceWith('checkout');
  f.pages.shift();
  await f.run('await browser.getPage("main"); await browser.closePage("main");');
  expect(f.original.getPage).toHaveBeenLastCalledWith('main');
  expect(f.original.closePage).toHaveBeenLastCalledWith('main');
});

it('propagates missing-page and close errors without creating unrelated pages', async () => {
  const f = fixture();
  f.original.listPages.mockRejectedValueOnce(new Error('disconnected'));
  await expect(f.run('await browser.getPage("main");')).rejects.toThrow('disconnected');
  expect(f.original.getPage).not.toHaveBeenCalled();
  f.page.close.mockRejectedValueOnce(new Error('close failed'));
  await expect(f.run('await browser.closePage("main");')).rejects.toThrow('close failed');
  expect(f.original.newPage).not.toHaveBeenCalled();
});
