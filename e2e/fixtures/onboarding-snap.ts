import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { captureElectronScreenshot } from './native-screenshot.js';

/** Attach a compositor screenshot (CDP `page.screenshot` can stall under Xvfb). */
export async function snap(electron: ElectronApplication, page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await captureElectronScreenshot(electron, page, path);
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
