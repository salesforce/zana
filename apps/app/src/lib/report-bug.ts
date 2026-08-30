import { REPORT_BUG_URL } from '@zana-ai/zcc-domain/product';

export { REPORT_BUG_URL };

/** Open the public GitHub bug form in the OS browser (main window-open → shell.openExternal). */
export function openBugReport(): void {
  globalThis.open(REPORT_BUG_URL, '_blank', 'noopener');
}
