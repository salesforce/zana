import type { Page } from '@playwright/test';
import { expect } from './app.js';

/**
 * Bundled plugins load one at a time after the window opens, and a provider
 * joins the thread catalog only once its plugin has loaded. Creating a thread
 * before then fails with `unknown thread provider`, so specs that start a
 * thread right after launch wait for the provider first.
 */
export async function waitForThreadProvider(window: Page, providerId: string, timeout = 30_000): Promise<void> {
  await expect.poll(() => window.evaluate(async () => {
    const response = await fetch('/api/v1/threads/providers');
    if (!response.ok) throw new Error(`Provider catalog failed: ${response.status}`);
    return (await response.json()).providers.map((provider: { id: string }) => provider.id);
  }), { timeout }).toContain(providerId);
}
