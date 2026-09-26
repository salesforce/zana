import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Home from '../app/index';

const fixture = vi.hoisted(() => ({
  params: {} as { path?: string },
  session: { revision: 0, ready: true, error: null, resumeRevision: 0, reconnect: vi.fn() },
  push: vi.fn(), share: vi.fn().mockResolvedValue({}), menu: vi.fn()
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'Spinner', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  Platform: { OS: 'ios' }, Share: { share: fixture.share }, Linking: { openURL: vi.fn() },
  BackHandler: { addEventListener: () => ({ remove() {} }) }
}));
vi.mock('expo-router', () => ({
  Redirect: 'Redirect', useFocusEffect: () => {},
  useLocalSearchParams: () => fixture.params, useRouter: () => ({ push: fixture.push })
}));
vi.mock('expo-haptics', () => ({}));
vi.mock('expo-notifications', () => ({}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('./ui', () => ({
  Action: 'Action', Label: 'Label', Screen: 'Screen',
  useColors: () => ({ background: 'white', text: 'black', accent: 'blue' })
}));
vi.mock('./session', () => ({ useNativeSession: () => fixture.session }));
vi.mock('./state', () => ({ useProfiles: () => ({
  state: { activeId: 'office', profiles: [{ id: 'office', label: 'Office Mac', serverUrl: 'https://mac.example' }] },
  ready: true, update: vi.fn()
}) }));
vi.mock('./lib/connection-menu', () => ({ showConnectionMenu: fixture.menu }));

let renderer: ReactTestRenderer;
const web = () => renderer.root.findByType('WebView' as never);
const nativeMenu = () => renderer.root.findAllByProps({ accessibilityLabel: 'Connection options' });
const send = async (data: unknown, url = 'https://mac.example') => {
  await act(() => web().props.onMessage({ nativeEvent: { data: JSON.stringify(data), url } }));
};
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.stubGlobal('__DEV__', true);
  fixture.params = {};
  fixture.session.revision = 0;
  fixture.session.ready = true;
  await act(() => { renderer = create(createElement(Home)); });
});
afterEach(async () => { await act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

it('retires the native header only when a trusted page hosts its own menu', async () => {
  expect(nativeMenu()).toHaveLength(1);
  expect(renderer.root.findAllByProps({ title: 'Share' })).toHaveLength(0);
  await send({ type: 'ready', path: '/' });
  expect(nativeMenu()).toHaveLength(1); // old desktop still has device controls
  await send({ type: 'shell-chrome', visible: true }, 'https://evil.example');
  expect(nativeMenu()).toHaveLength(1);
  await send({ type: 'shell-chrome', visible: true });
  expect(nativeMenu()).toHaveLength(0);
  await send({ type: 'shell-chrome', visible: false });
  expect(nativeMenu()).toHaveLength(1);
  await send({ type: 'shell-chrome', visible: true });
  await act(() => web().props.onLoadStart());
  expect(nativeMenu()).toHaveLength(1);
});

it('shares the current path without remounting the page and reconnects through the session owner', async () => {
  const original = web();
  await act(() => original.props.onNavigationStateChange({ canGoBack: true, url: 'https://mac.example/threads/123' }));
  expect(web()).toBe(original);
  expect(web().props.source).toEqual({ uri: 'https://mac.example/' });
  await send({ type: 'open-native', screen: 'connection-menu' });
  const actions = fixture.menu.mock.calls[0]![0];
  expect(actions.label).toBe('Office Mac');
  await act(() => actions.share());
  expect(fixture.share).toHaveBeenCalledWith({ message: 'https://mac.example/threads/123', url: 'https://mac.example/threads/123' });
  await act(() => actions.reload());
  expect(fixture.session.reconnect).toHaveBeenCalledOnce();
  actions.settings();
  expect(fixture.push).toHaveBeenCalledWith('/settings');
});

it('keeps fallback actions usable before the page loads and after a load error', async () => {
  await act(() => nativeMenu()[0]!.props.onPress());
  fixture.share.mockRejectedValueOnce(new Error('cancelled'));
  await act(() => fixture.menu.mock.calls[0]![0].share());
  expect(fixture.share).toHaveBeenCalledWith({ message: 'https://mac.example/', url: 'https://mac.example/' });
  await send({ type: 'shell-chrome', visible: true });
  await act(() => web().props.onError({ nativeEvent: { description: 'Offline' } }));
  expect(nativeMenu()).toHaveLength(1);
  expect(renderer.root.findByProps({ title: 'Try again' })).toBeTruthy();
  expect(renderer.root.findByProps({ title: 'Saved servers' })).toBeTruthy();
});

it('restores fallback controls for a new session or deep link', async () => {
  await send({ type: 'shell-chrome', visible: true });
  fixture.session.revision++;
  await act(() => renderer.update(createElement(Home)));
  expect(nativeMenu()).toHaveLength(1);
  await send({ type: 'shell-chrome', visible: true });
  fixture.params = { path: '/threads/456' };
  await act(() => renderer.update(createElement(Home)));
  expect(nativeMenu()).toHaveLength(1);
  expect(web().props.source.uri).toBe('https://mac.example/threads/456');
});
