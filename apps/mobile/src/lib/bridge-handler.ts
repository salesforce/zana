import { buildBridgeEventScript, parsePageToShellMessage } from '@zana-ai/zcc-mobile-bridge';
import { externalUrl, isSameServer, safePath } from './urls';
export interface NativeActions {
  haptic(kind: string): Promise<void>;
  badge(count: number): Promise<void>;
  share(payload: { title?: string; text?: string; url?: string }): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  openSettings(): void;
  authRequired(): void;
  ready(path: string): void;
  inject(script: string): void;
}
export async function handleBridgeMessage(
  raw: string,
  frameUrl: string,
  serverUrl: string,
  actions: NativeActions
): Promise<void> {
  if (!isSameServer(frameUrl, serverUrl) || raw.length > 16_384) return;
  const parsed = parsePageToShellMessage(raw);
  if (!parsed.ok) return;
  const message = parsed.message;
  try {
    switch (message.type) {
      case 'auth-required':
        actions.authRequired();
        break;
      case 'ready':
        actions.ready(safePath(message.path));
        break;
      case 'title':
        break;
      case 'haptic':
        await actions.haptic(message.kind);
        break;
      case 'badge':
        await actions.badge(Math.min(message.count, 9999));
        break;
      case 'open-external':
        if (externalUrl(message.url)) await actions.openExternal(message.url);
        break;
      case 'open-native':
        actions.openSettings();
        break;
      case 'request':
        try {
          const result = await actions.share(message.request.payload);
          actions.inject(
            buildBridgeEventScript({
              type: 'response',
              id: message.id,
              response: { ok: true, result }
            })
          );
        } catch {
          actions.inject(
            buildBridgeEventScript({
              type: 'response',
              id: message.id,
              response: { ok: false, error: 'Could not open the share sheet' }
            })
          );
        }
        break;
    }
  } catch {
    /* Optional device affordances never interrupt the page. */
  }
}
