import { expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), off: vi.fn() }));
vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, setMaxListeners: vi.fn(), on: electron.on, off: electron.off },
  contextBridge: { exposeInMainWorld: electron.expose },
  webFrame: { getZoomFactor: () => 1 },
  webUtils: { getPathForFile: vi.fn() }
}));

/** Every channel main's application menu sends with `sendToFocused` for the shell to act on. */
const MENU_CHANNELS = [
  'app:openSettings',
  'app:newClaudeTab',
  'app:reopenTab',
  'app:closeTab',
  'app:toggleProjectView',
  'app:openPalette',
  'app:openShortcuts',
  'app:openHome',
  'app:toggleInbox'
];

it('relays every application-menu channel to onMenuEvent, View → Toggle Inbox included', async () => {
  await import('./preload.js');
  const api = electron.expose.mock.calls.find(([name]) => name === 'cc')![1];
  electron.on.mockClear();
  const received: string[] = [];
  const off = api.app.onMenuEvent((event: string) => received.push(event));

  const subscribed = new Map(electron.on.mock.calls.map(([name, handler]) => [name as string, handler as () => void]));
  for (const channel of MENU_CHANNELS) subscribed.get(channel)?.();
  expect(received).toEqual(MENU_CHANNELS);

  off();
  expect(electron.off.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(MENU_CHANNELS));
});
