/**
 * In-process browser automation host. Desktop main sets the implementation
 * after creating the WebContentsView manager. MCP tools call through this
 * registry so the server package never imports Electron.
 */

export interface BrowserAutomationTarget {
  targetId: string;
  tabId: string;
  url: string;
  title: string | null;
}

export interface BrowserAutomationHost {
  open(args: { threadId: string; url: string; visible: boolean }): Promise<{ targetId: string; tabId: string }>;
  list(threadId?: string): Promise<BrowserAutomationTarget[]>;
  snapshot(targetId: string): Promise<{
    targetId: string;
    tabId: string;
    url: string;
    title: string | null;
    dataUrl: string | null;
  }>;
  click(targetId: string, args: { selector?: string; x?: number; y?: number }): Promise<void>;
  type(targetId: string, args: { selector?: string; text: string }): Promise<void>;
  evaluate(targetId: string, script: string): Promise<unknown>;
  close(targetId: string): Promise<void>;
}

let host: BrowserAutomationHost | null = null;

export function setBrowserAutomationHost(next: BrowserAutomationHost | null): void {
  host = next;
}

export function getBrowserAutomationHost(): BrowserAutomationHost | null {
  return host;
}
