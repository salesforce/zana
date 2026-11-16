import { revealElement } from '@/lib/settings-search/reveal';

/** Upper bound on waiting for the Configure form; it loads with the plugin's settings request. */
export const PLUGIN_SETTING_WAIT_MS = 15_000;

/**
 * Reveal the Configure-page row for descriptor `settingKey` (stable and unique,
 * unlike display labels). The form renders when the plugin's settings request
 * resolves, so a MutationObserver waits for the row instead of polling on a
 * fixed short budget; it stops on success, on the cap, or when cancelled (the
 * effect cleanup on navigation). Returns the cancel function.
 */
export function revealPluginSetting(settingKey: string): () => void {
  const selector = `#plugin-configure [data-plugin-setting-key="${CSS.escape(settingKey)}"]`;
  const find = () => document.querySelector<HTMLElement>(selector);
  const now = find();
  if (now) {
    revealElement(now);
    return () => {};
  }
  let done = false;
  const observer = new MutationObserver(() => {
    const row = find();
    if (!row) return;
    stop();
    revealElement(row);
  });
  const timer = window.setTimeout(() => stop(), PLUGIN_SETTING_WAIT_MS);
  function stop() {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
  }
  observer.observe(document.body, { childList: true, subtree: true });
  return stop;
}
