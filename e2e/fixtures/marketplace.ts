/**
 * Page object for Settings → Extensions → Marketplace, plus a thin IPC helper.
 *
 * Two layers, used deliberately:
 *   - UI methods (open, rows, install) drive the real renderer the way a user
 *     would — they prove the wiring from a click through IPC to disk and back.
 *   - `ipc()` calls a `window.cc.extensions.*` method directly in the renderer
 *     context — for asserting engine behavior (e.g. a tampered release is
 *     rejected) without depending on transient UI states.
 */
import type { Page } from '@playwright/test';

export class MarketplacePage {
  constructor(private readonly window: Page) {}

  /** Navigate Sidebar → Settings → Extensions section → Marketplace sub-tab. */
  async open(): Promise<void> {
    // Sidebar "Settings" rail entry.
    await this.window.locator('.nav-item', { hasText: 'Settings' }).first().click();
    // Settings section row "Extensions" (a .settings-section-item, not a button).
    await this.window
      .locator('.settings-section-item')
      .filter({ has: this.window.locator('.project-name', { hasText: 'Extensions' }) })
      .click();
    // Extensions hub sub-tab "Marketplace".
    await this.window.getByRole('tab', { name: 'Marketplace' }).click();
    await this.window.waitForSelector('.ext-market', { timeout: 15_000 });
  }

  /** The marketplace "off / not configured" hint (shown when no registry). */
  emptyHint() {
    return this.window.locator('.settings-help--muted', {
      hasText: 'No marketplace configured',
    });
  }

  /** All catalog rows. */
  rows() {
    return this.window.locator('.ext-market-list .ext-market-item');
  }

  /** A catalog row by its visible title. */
  row(title: string) {
    return this.window
      .locator('.ext-market-item')
      .filter({ has: this.window.locator('.ext-market-item-title', { hasText: title }) });
  }

  /** The action button inside a row (Install / Update / Installed / Incompatible). */
  rowButton(title: string) {
    return this.row(title).locator('.ext-market-item-action button');
  }

  /** Call a `window.cc.extensions.<method>(...args)` in the renderer. */
  async ipc<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    return this.window.evaluate(
      ([m, a]) => {
        const api = (window as unknown as { cc: { extensions: Record<string, (...x: unknown[]) => Promise<unknown>> } })
          .cc.extensions;
        return api[m as string](...(a as unknown[]));
      },
      [method, args] as const
    ) as Promise<T>;
  }
}
