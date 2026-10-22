import {
  crashIssueMarkdown,
  crashIssueTitle,
  crashIssueUrl,
  REPORT_BUG_URL,
  type RendererCrashPayload
} from '@zana-ai/zcc-domain/product';
import { hasDesktopBridge } from './app-surface.js';
import { copyText } from './copy-text.js';
import { product } from './product-client.js';

export { REPORT_BUG_URL };

/** Open the public GitHub bug form in the OS browser (main window-open → shell.openExternal). */
export function openBugReport(title?: string): void {
  const url = title ? crashIssueUrl(title) : REPORT_BUG_URL;
  globalThis.open(url, '_blank', 'noopener');
}

/**
 * Persist a crash report when the desktop bridge is present, copy paste-ready
 * markdown, and open the public GitHub bug form with a prefilled title.
 */
export async function reportRendererCrash(payload: RendererCrashPayload): Promise<string> {
  let version = '';
  let osLabel = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  let fileName = '';
  if (hasDesktopBridge()) {
    try {
      const saved = await product.app.saveCrashReport(payload);
      if (saved?.ok) {
        version = saved.version;
        osLabel = saved.osLabel;
        fileName = saved.fileName;
      }
    } catch {
      /* clipboard + GitHub still proceed */
    }
    if (!version) {
      version = await product.app.version().catch(() => '');
    }
  }
  const title = crashIssueTitle(payload.message);
  await copyText(crashIssueMarkdown({ ...payload, version, osLabel, fileName }));
  openBugReport(title);
  return fileName
    ? 'Crash details copied. Paste into What happened? A copy is saved so you can attach it on GitHub.'
    : 'Crash details copied. Paste into What happened?';
}
