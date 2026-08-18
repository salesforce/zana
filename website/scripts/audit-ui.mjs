import { chromium } from '@playwright/test';

const baseUrl = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:4321';
const routes = [
  '/',
  '/how-it-works/',
  '/features/',
  '/extensions/',
  '/extensions/getting-started/',
  '/extensions/install/',
  '/extensions/sdk/',
  '/marketplace/',
  '/download/',
  '/docs/',
  '/docs/getting-started/',
  '/dashboard/'
];
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'mobile', width: 390, height: 844 }
];

const browser = await chromium.launch({ headless: true });
const findings = [];

try {
  for (const theme of ['dark', 'light']) {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, colorScheme: theme });
      await context.addInitScript((value) => localStorage.setItem('zcc-theme', value), theme);

      for (const route of routes) {
        const page = await context.newPage();
        const consoleErrors = [];
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', (error) => consoleErrors.push(error.message));

        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
        const metrics = await page.evaluate(() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          };
          const selector = 'a.btn, button.btn, .theme-toggle, .nav-burger, .docs-search-btn, input, select';
          const controls = [...document.querySelectorAll(selector)]
            .filter(visible)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                label: (element.textContent || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.tagName).trim().replace(/\s+/g, ' '),
                tag: element.tagName,
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                wraps: element.scrollHeight > rect.height + 2
              };
            });
          const offscreen = [...document.querySelectorAll('main *, footer *')]
            .filter(visible)
            .filter((element) => !element.closest('pre'))
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1)
            .slice(0, 12)
            .map(({ element, rect }) => ({
              tag: element.tagName,
              className: String(element.className || '').slice(0, 100),
              text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
              left: Math.round(rect.left),
              right: Math.round(rect.right)
            }));
          return {
            pageWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            controls,
            offscreen
          };
        });

        const smallControls = metrics.controls.filter((control) => control.height < 40 || control.width < 40);
        const clippedControls = metrics.controls.filter((control) => control.left < -1 || control.right > metrics.viewportWidth + 1 || control.wraps);
        if (response?.status() !== 200 || metrics.pageWidth > metrics.viewportWidth + 1 || smallControls.length || clippedControls.length || metrics.offscreen.length || consoleErrors.length) {
          findings.push({
            route,
            theme,
            viewport: viewport.name,
            status: response?.status(),
            overflow: metrics.pageWidth - metrics.viewportWidth,
            smallControls,
            clippedControls,
            offscreen: metrics.offscreen,
            consoleErrors
          });
        }
        await page.close();
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ audited: routes.length * viewports.length * 2, findings }, null, 2));
if (findings.length) process.exitCode = 1;
