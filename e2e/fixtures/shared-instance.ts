import { expect, type launchApp } from './app.js';

/** Electron reports both the native chrome view and its owning window as pages. */
export async function sharedInstancePage(app: Awaited<ReturnType<typeof launchApp>>, origin: string) {
  await expect.poll(() => app.electron.windows().some(page => page.url().startsWith(origin))).toBe(true);
  return app.electron.windows().find(page => page.url().startsWith(origin))!;
}

export async function sharedChromePage(app: Awaited<ReturnType<typeof launchApp>>) {
  const isChrome = (url: string) => url.startsWith('data:text/html') && decodeURIComponent(url).includes('<title>Zana switcher</title>');
  await expect.poll(() => app.electron.windows().some(page => isChrome(page.url()))).toBe(true);
  return app.electron.windows().find(page => isChrome(page.url()))!;
}
