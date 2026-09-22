import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Connect from '../app/connect';
import { EMPTY_STATE, type MobileState } from './lib/profiles';

const fixture = vi.hoisted(() => ({
  state: undefined as unknown as MobileState,
  ready: true,
  params: {} as { payload?: string; server?: string },
  permission: { granted: true },
  platform: { OS: 'android' },
  dismissKeyboard: vi.fn(),
  requestPermission: vi.fn(),
  update: vi.fn(),
  pair: vi.fn(),
  probe: vi.fn(),
  replace: vi.fn()
}));
vi.mock('react-native', () => ({
  View: 'View',
  Switch: 'Switch',
  ActivityIndicator: 'Spinner',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  Pressable: (props: {
    style: (state: { pressed: boolean }) => unknown;
    children: React.ReactNode;
  }) =>
    createElement(
      'Pressable',
      { ...props, style: props.style({ pressed: false }) },
      props.children
    ),
  Platform: fixture.platform,
  Keyboard: { dismiss: fixture.dismissKeyboard },
  useColorScheme: () => 'light',
  StyleSheet: { create: (styles: unknown) => styles }
}));
vi.mock('expo-camera', () => ({
  CameraView: 'Camera',
  useCameraPermissions: () => [fixture.permission, fixture.requestPermission]
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'new-device' }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => fixture.params,
  useRouter: () => ({ replace: fixture.replace })
}));
vi.mock('./state', () => ({
  useProfiles: () => ({ state: fixture.state, ready: fixture.ready, update: fixture.update })
}));
vi.mock('./lib/client', () => ({ pairServer: fixture.pair, probeDirect: fixture.probe }));

let renderer: ReactTestRenderer;
const payload = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    serverUrl: 'https://mac.example',
    code: 'a'.repeat(22),
    expiresAt: Date.now() + 60_000,
    ...patch
  });
const field = (label: string) => renderer.root.findByProps({ label });
const action = (title: string) => renderer.root.findByProps({ title });
const connect = () => renderer.root.findByProps({ testID: 'connect-server' });
const hasText = (text: string) => JSON.stringify(renderer.toJSON()).includes(text);
async function mount() {
  await act(() => {
    renderer = create(createElement(Connect));
  });
}
async function startScan() {
  await act(() => action('Scan pairing QR').props.onPress());
}
const scanner = () => renderer.root.findByType('Camera' as never).props.onBarcodeScanned;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  fixture.state = { ...EMPTY_STATE, profiles: [] };
  fixture.ready = true;
  fixture.params = {};
  fixture.permission = { granted: true };
  fixture.platform.OS = 'android';
  fixture.requestPermission.mockResolvedValue({ granted: true });
  fixture.pair.mockResolvedValue({ credential: 'c'.repeat(43), deviceId: 'server-device' });
  fixture.probe.mockResolvedValue(undefined);
  fixture.update.mockImplementation(async (change) => {
    fixture.state = change(fixture.state);
  });
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
});

it('scans once, fills the form, and waits for explicit Connect before pairing', async () => {
  await mount();
  expect(connect().props.disabled).toBe(true);
  await startScan();
  expect(fixture.dismissKeyboard).toHaveBeenCalledOnce();
  const scan = scanner();
  await act(() => {
    scan({ data: payload() });
    scan({ data: payload({ serverUrl: 'https://other.example' }) });
  });
  expect(field('Server URL').props.value).toBe('https://mac.example');
  expect(field('Pairing code').props.value).toBe('a'.repeat(22));
  expect(fixture.pair).not.toHaveBeenCalled();
  expect(connect().props.disabled).toBe(false);
  await act(() => connect().props.onPress());
  expect(fixture.dismissKeyboard).toHaveBeenCalledTimes(2);
  expect(fixture.pair).toHaveBeenCalledExactlyOnceWith(
    'https://mac.example',
    'a'.repeat(22),
    'My Zana'
  );
  expect(fixture.state.profiles[0]).toMatchObject({
    serverUrl: 'https://mac.example',
    credential: 'c'.repeat(43)
  });
  expect(fixture.replace).toHaveBeenCalledWith('/');
});

it.each([
  ['expired', () => payload({ expiresAt: 1 }), 'invalid or expired'],
  ['malformed', () => 'not a QR payload', 'Scan a Zana pairing QR'],
  ['null', () => 'null', 'invalid or expired'],
  ['public HTTP', () => payload({ serverUrl: 'http://remote.example' }), 'Use HTTPS']
])('rejects a %s scan and clears the previous pairing code', async (_name, raw, message) => {
  fixture.params = { payload: payload() };
  await mount();
  expect(connect().props.disabled).toBe(false);
  await startScan();
  await act(() => scanner()({ data: raw() }));
  expect(field('Pairing code').props.value).toBe('');
  expect(connect().props.disabled).toBe(true);
  expect(hasText(message)).toBe(true);
  expect(fixture.pair).not.toHaveBeenCalled();
});

it('does not accept queued camera events after cancelling a scan', async () => {
  await mount();
  await startScan();
  const scan = scanner();
  await act(() => action('Cancel scan').props.onPress());
  await act(() => scan({ data: payload() }));
  expect(field('Server URL').props.value).toBe('');
  expect(connect().props.disabled).toBe(true);
});

it('handles permission denial and camera errors, and can request access again', async () => {
  fixture.permission = { granted: false };
  fixture.requestPermission.mockResolvedValueOnce({ granted: false });
  await mount();
  await startScan();
  expect(hasText('Camera access is disabled')).toBe(true);
  fixture.requestPermission.mockRejectedValueOnce(new Error('camera unavailable'));
  await startScan();
  expect(hasText('Could not open the camera')).toBe(true);
  await startScan();
  fixture.permission = { granted: true };
  await act(() => renderer.update(createElement(Connect)));
  expect(scanner()).toBeTypeOf('function');
});

it('keeps a failed connection recoverable and prevents duplicate redemption', async () => {
  fixture.params = { payload: payload() };
  let reject!: (reason: Error) => void;
  fixture.pair.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  await mount();
  const press = connect().props.onPress;
  await act(() => {
    press();
    press();
  });
  expect(fixture.pair).toHaveBeenCalledOnce();
  expect(connect().props.disabled).toBe(true);
  await act(() => reject(new Error('Server is unreachable')));
  expect(hasText('Server is unreachable')).toBe(true);
  expect(connect().props.disabled).toBe(false);
  expect(fixture.replace).not.toHaveBeenCalled();
  await act(() => connect().props.onPress());
  expect(fixture.replace).toHaveBeenCalledWith('/');
});

it('retains the form when secure persistence fails', async () => {
  fixture.params = { payload: payload() };
  fixture.update.mockRejectedValueOnce(new Error('Device storage is unavailable'));
  await mount();
  await act(() => connect().props.onPress());
  expect(hasText('Device storage is unavailable')).toBe(true);
  expect(fixture.replace).not.toHaveBeenCalled();
});

it('supports explicit direct mode and manual entry without pairing', async () => {
  fixture.platform.OS = 'ios';
  fixture.state.appearance = 'dark';
  await mount();
  await act(() => {
    field('Server name').props.onChangeText('Office Mac');
    field('Server URL').props.onChangeText('http://127.0.0.1:8780');
    field('Pairing code').props.onChangeText('manual-code');
    renderer.root
      .findByProps({ accessibilityLabel: 'Direct connection' })
      .props.onValueChange(true);
  });
  await act(() => connect().props.onPress());
  expect(fixture.probe).toHaveBeenCalledWith('http://127.0.0.1:8780');
  expect(fixture.pair).not.toHaveBeenCalled();
  expect(fixture.state.profiles[0]).toMatchObject({ label: 'Office Mac' });
});

it('waits for secure storage to load and allows returning to saved servers', async () => {
  fixture.ready = false;
  fixture.params = { payload: payload() };
  fixture.state.profiles = [
    { id: 'existing', label: 'Office', serverUrl: 'https://office.example' }
  ];
  await mount();
  expect(connect().props.disabled).toBe(true);
  await act(() => connect().props.onPress());
  expect(fixture.pair).not.toHaveBeenCalled();
  await act(() => action('Back to servers').props.onPress());
  expect(fixture.replace).toHaveBeenCalledWith('/settings');
});
