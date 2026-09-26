import { beforeEach, expect, it, vi } from 'vitest';
import { showConnectionMenu } from './connection-menu';

const native = vi.hoisted(() => ({
  platform: { OS: 'ios' }, sheet: vi.fn(), alert: vi.fn()
}));
vi.mock('react-native', () => ({
  Platform: native.platform,
  ActionSheetIOS: { showActionSheetWithOptions: native.sheet },
  Alert: { alert: native.alert }
}));
const actions = { label: 'Office Mac', share: vi.fn(), reload: vi.fn(), settings: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); native.platform.OS = 'ios'; });

it('presents iPhone actions in a dismissible native sheet and dispatches only the chosen action', () => {
  showConnectionMenu(actions);
  const [options, choose] = native.sheet.mock.calls[0]!;
  expect(options).toEqual({ title: 'Office Mac', options: ['Share', 'Reload', 'This device', 'Cancel'], cancelButtonIndex: 3 });
  choose(3);
  expect(actions.share).not.toHaveBeenCalled();
  expect(actions.reload).not.toHaveBeenCalled();
  expect(actions.settings).not.toHaveBeenCalled();
  choose(0);
  expect(actions.share).toHaveBeenCalledOnce();
  expect(actions.reload).not.toHaveBeenCalled();
  choose(1);
  choose(2);
  expect(actions.reload).toHaveBeenCalledOnce();
  expect(actions.settings).toHaveBeenCalledOnce();
});

it('keeps Android actions within the three-button limit and allows dismissal', () => {
  native.platform.OS = 'android';
  showConnectionMenu(actions);
  const [title, , buttons, options] = native.alert.mock.calls[0]!;
  expect(title).toBe('Office Mac');
  expect(buttons.map((button: { text: string }) => button.text)).toEqual(['Share', 'Reload', 'This device']);
  expect(options).toEqual({ cancelable: true });
  buttons.forEach((button: { onPress(): void }) => button.onPress());
  for (const action of [actions.share, actions.reload, actions.settings]) expect(action).toHaveBeenCalledOnce();
  expect(native.sheet).not.toHaveBeenCalled();
});
