// Run through zcc browser-automation after navigating `main` to the site to test.
const page = await browser.getPage('main');
const origin = new URL(page.url()).origin;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([]);
await page.goto(origin);
await page.waitForSelector('.city-demo-heading button[aria-label="Pause city motion"]', { timeout: 5000 });
await page.waitForFunction(() => {
  const canvas = document.querySelector('.city-demo-scene canvas');
  return canvas && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value > 0);
}, { timeout: 5000 });
check(await page.evaluate(() => document.querySelectorAll('a[href="#demo"]').length === 1), 'Duplicate hero demo links');
check(await page.evaluate(() => ['inbox-heading', 'library-heading', 'workflow-heading', 'architecture-heading'].every((id) => !document.getElementById(id))), 'Repeated homepage sections returned');

await page.click('[data-project="checkout"]');
await page.waitForSelector('.city-demo-floor select', { timeout: 3000 });
await page.select('.city-demo-floor select', '0');
check(await page.$eval('.city-demo-floor select', (select) => select.value === '0'), 'Floor selection failed');
await page.click('.city-demo-detail li:first-child button');
await page.waitForSelector('.city-demo-agent', { timeout: 3000 });
check(await page.$eval('.city-demo-agent', (element) => element.textContent.includes('waiting for your reply')), 'Missing waiting-agent explanation');
check(await page.$eval('.city-demo-floor select', (select) => select.value === '1'), 'Worker selection did not find its floor');
check(await page.$$eval('.city-demo-detail li', (items) => items.length === 7), 'Incomplete sample roster');
await page.keyboard.press('Escape');
check(await page.evaluate(() => !document.querySelector('.city-demo-inside') && document.activeElement.dataset.project === 'checkout'), 'Escape/focus restoration failed');

await page.click('[aria-label="Pause city motion"]');
await page.waitForSelector('[aria-label="Resume city motion"]', { timeout: 3000 });
await page.click('[aria-label="Resume city motion"]');
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.waitForSelector('[aria-label="Motion reduced"]', { timeout: 3000 });
check(await page.$eval('[aria-label="Motion reduced"]', (button) => button.disabled), 'Reduced motion not respected');
for (const width of [320, 390, 760, 1280]) {
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
}
await page.emulateMediaFeatures([]);
await page.goto(`${origin}/features/#library`);
await page.waitForSelector('#library', { timeout: 5000 });
await page.goto(`${origin}/docs/architecture/`);
await page.waitForSelector('a[href="/artwork/zana-architecture.svg"]', { timeout: 5000 });
check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
await page.goto(origin);
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
console.log('Homepage verified: rendered city, projects, floors, roster, waiting agent, Escape/focus, motion controls, four viewport widths, Features Library, and architecture docs.');
