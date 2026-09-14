/**
 * In-process desktop-browser broker for Electron E2E (`__zccDesktopBrowserBroker`).
 * Product HTTP reaches BrowserView through Host-RPC, not this registry.
 */
import type {
  DesktopBrowserCommand,
  DesktopBrowserInstance,
  DesktopBrowserResult
} from '@zana-ai/zcc-host-daemon-contract';

export interface DesktopBrowserBrokerHost {
  listInstances(): DesktopBrowserInstance[];
  execute(command: DesktopBrowserCommand): Promise<DesktopBrowserResult>;
}

let broker: DesktopBrowserBrokerHost | null = null;

export function setDesktopBrowserBroker(next: DesktopBrowserBrokerHost | null): void {
  broker = next;
}

export function getDesktopBrowserBroker(): DesktopBrowserBrokerHost | null {
  return broker;
}
