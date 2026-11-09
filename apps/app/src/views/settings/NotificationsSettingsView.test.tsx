// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { clearPluginSlots, interpretPluginApp } from '../../plugins/plugin-slots.js';
import { soundProviderSettingsHref } from '../../plugins/notification-sounds.js';
import { NotificationsSettingsView } from './NotificationsSettingsView.js';
const config = {} as any;
const register = () => interpretPluginApp('voices', definePluginApp(app => app.slots.notificationSoundProvider({
  id: 'main', title: 'Example voices', description: 'Choose a voice', component: () => <div>Character choices</div>, mount: () => undefined
})));
beforeEach(() => { vi.stubGlobal('CSS', { escape: (value: string) => value }); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); clearPluginSlots('voices'); vi.unstubAllGlobals(); });
const show = (props: any = {}, path = '/settings/notifications') => render(<MemoryRouter initialEntries={[path]}><NotificationsSettingsView config={config} onUpdate={vi.fn().mockResolvedValue(undefined)} {...props}/></MemoryRouter>);
it('starts quiet, embeds chime controls and atomically turns sounds off when selecting a plugin', async () => {
  register(); const onUpdate = vi.fn().mockResolvedValue(undefined);
  const view = show({ onUpdate });
  expect(screen.getByRole('switch', { name: 'Play notification sounds' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('heading', { name: 'Sounds by event' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sound provider' }));
  fireEvent.click(screen.getByRole('option', { name: /Example voices/ }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ notificationSoundProvider: 'voices/main', notificationSoundsEnabled: false }));
  view.unmount(); show({ config: { notificationSoundProvider: 'voices/main' }, onUpdate });
  expect(screen.getByText('Character choices')).toBeTruthy();
  expect(screen.queryByRole('slider', { name: 'Chime volume' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Manage plugin' }).getAttribute('href')).toContain('voices');
  fireEvent.click(screen.getByRole('switch', { name: 'Play notification sounds' }));
  await waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith({ notificationSoundsEnabled: true }));
});
it('configure links inspect another provider without silently changing playback', async () => {
  register(); const onUpdate = vi.fn().mockResolvedValue(undefined);
  show({ config: { notificationSoundsEnabled: true, agentSoundNeedsYou: true }, onUpdate }, soundProviderSettingsHref({ pluginId: 'voices', id: 'main' }));
  expect(screen.getByText('Character choices')).toBeTruthy(); expect(onUpdate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Sound provider' }).textContent).toContain('Chimes & custom audio');
  fireEvent.click(screen.getByRole('button', { name: 'Use Example voices' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ notificationSoundProvider: 'voices/main', notificationSoundsEnabled: false }));
});
it('keeps a missing provider silent and offers recovery rather than a fallback player', () => {
  show({ config: { notificationSoundsEnabled: true, notificationSoundProvider: 'missing/main' } });
  expect((screen.getByRole('switch', { name: 'Play notification sounds' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('no other provider will play');
});
it('surfaces save failures and can leave inspection without any settings mutation', async () => {
  register(); const onUpdate = vi.fn().mockRejectedValue(new Error('offline'));
  show({ onUpdate }, soundProviderSettingsHref({ pluginId: 'voices', id: 'main' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to active provider' }));
  expect(screen.getByRole('heading', { name: 'Sounds by event' })).toBeTruthy();
  expect(onUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch', { name: 'Play notification sounds' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not save'));
  expect(screen.getByRole('switch', { name: 'Play notification sounds' }).getAttribute('aria-checked')).toBe('false');
});

it('keeps the master off while enabling an event on a fresh profile', async () => {
  const onUpdate = vi.fn().mockResolvedValue(undefined); show({ onUpdate });
  fireEvent.click(screen.getByRole('switch', { name: 'Agent finishes a turn', exact: true }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ agentSoundDone: true, notificationSoundsEnabled: false }));
});

it('searches a growing provider list and replaces only the selected settings panel', async () => {
  interpretPluginApp('voices', definePluginApp(app => {
    for (let index = 1; index <= 8; index++) app.slots.notificationSoundProvider({
      id: `voice-${index}`, title: `Voice collection ${index}`, description: index === 8 ? 'Gentle nature sounds' : 'Character voices',
      component: () => <div>Controls for collection {index}</div>, mount: () => undefined
    });
  }));
  const onUpdate = vi.fn();
  function Settings() {
    const [settings, setSettings] = useState({ notificationSoundsEnabled: true });
    return <NotificationsSettingsView config={settings as any} onUpdate={async patch => {
      onUpdate(patch); setSettings(current => ({ ...current, ...patch }));
    }} />;
  }
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Sound provider' }));
  open();
  expect(screen.getAllByRole('option')).toHaveLength(9);
  const search = screen.getByRole('textbox', { name: 'Search sound providers…' });
  fireEvent.change(search, { target: { value: 'no such provider' } });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText('No sound providers match your search.')).toBeTruthy();
  expect(onUpdate).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: 'nature' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(screen.getByText('Controls for collection 8')).toBeTruthy());
  expect(onUpdate).toHaveBeenLastCalledWith({ notificationSoundProvider: 'voices/voice-8', notificationSoundsEnabled: false });
  expect(screen.queryByRole('heading', { name: 'Sounds by event' })).toBeNull();
  open();
  expect(screen.getAllByRole('option')).toHaveLength(9);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search sound providers…' }), { target: { value: 'collection 2' } });
  fireEvent.click(screen.getByRole('option', { name: /Voice collection 2/ }));
  await waitFor(() => expect(screen.getByText('Controls for collection 2')).toBeTruthy());
  expect(screen.queryByText('Controls for collection 8')).toBeNull();
});
