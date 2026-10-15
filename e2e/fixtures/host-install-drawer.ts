import type { Page } from '@playwright/test';

/**
 * A stage-less install log auto-closes shortly after success, so a fast path (the
 * reuse bind) can unmount the drawer before a poll sees it. Record every distinct
 * log text the drawer renders from the page itself, independent of the drawer staying mounted.
 */
export async function captureDrawerLogs(win: Page, { expand = false } = {}): Promise<void> {
  await win.evaluate((expandLog) => {
    const w = window as unknown as {
      __drawerLogSeen?: string[]; __drawerStages?: Record<string, string>; __drawerLogObserver?: MutationObserver;
    };
    w.__drawerLogObserver?.disconnect();
    w.__drawerLogSeen = [];
    w.__drawerStages = {};
    const record = () => {
      // Staged installs hide the log; expanding as soon as the toggle mounts pins the drawer
      // past success, which a Playwright click can lose to the auto-close on a slow runner.
      const toggle = document.querySelector<HTMLButtonElement>('[data-testid="host-install-log-toggle"][aria-expanded="false"]');
      if (expandLog && toggle) toggle.click();
      const text = document.querySelector('[data-testid="host-install-log"]')?.textContent;
      if (text && w.__drawerLogSeen!.at(-1) !== text) w.__drawerLogSeen!.push(text);
      for (const row of document.querySelectorAll<HTMLElement>('[data-testid^="host-install-stage-"][data-status]')) {
        w.__drawerStages![row.dataset.testid!.slice('host-install-stage-'.length)] = row.dataset.status!;
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-status'] });
    w.__drawerLogObserver = observer;
  }, expand);
}

export async function capturedDrawerLogs(win: Page): Promise<string> {
  return win.evaluate(() => ((window as unknown as { __drawerLogSeen?: string[] }).__drawerLogSeen ?? []).join('\n'));
}

export async function capturedDrawerStages(win: Page): Promise<Record<string, string>> {
  return win.evaluate(() => ({ ...(window as unknown as { __drawerStages?: Record<string, string> }).__drawerStages }));
}
