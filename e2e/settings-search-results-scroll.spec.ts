/**
 * Settings search results must scroll inside the rail, not the app shell
 * (backlog item 123).
 *
 * `.app-shell` is `overflow: hidden`, which still scrolls programmatically.
 * The Settings rail (`.sidebar`) is `overflow: visible`, and the results list
 * had no scroll container of its own, so `scrollIntoView({ block: 'nearest' })`
 * on a result near the bottom scrolled the whole shell: the title bar row moved
 * up and the fixed sidebar controls were drawn over the list. jsdom has no
 * layout, so this loads the real stylesheets into real Chromium.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { test, expect } from '@playwright/test';

const STYLES = join(process.cwd(), 'apps', 'app', 'src');
const RESULT_COUNT = 60;

function railPage(): string {
  const css = ['styles/global.css', 'views/settings/settings.css'].map((f) => readFileSync(join(STYLES, f), 'utf8')).join('\n');
  const results = Array.from({ length: RESULT_COUNT }, (_, i) =>
    `<div class="settings-result" role="option" id="r${i}"><span class="settings-result-label">Sound ${i}</span><span class="settings-result-crumb">Notifications</span></div>`
  ).join('');
  return `<!doctype html><html><head><style>${css}</style></head><body><div id="root">
    <div class="app-shell" id="shell">
      <div class="titlebar" style="grid-column: 1 / -1">title bar</div>
      <aside class="sidebar settings-pane"><div class="settings-search"><input class="settings-search-input"></div>
        <div class="settings-results" role="listbox" id="results">${results}</div></aside>
      <main class="shell-main">content</main>
    </div></div></body></html>`;
}

test('scrolling to a search result scrolls the results list, never the app shell', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.setContent(railPage());
    const state = await page.evaluate(() => {
      document.getElementById(`r${59}`)!.scrollIntoView({ block: 'nearest' });
      return {
        shellScrollTop: document.getElementById('shell')!.scrollTop,
        listScrollTop: document.getElementById('results')!.scrollTop
      };
    });
    expect(state.shellScrollTop).toBe(0);
    expect(state.listScrollTop).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});
