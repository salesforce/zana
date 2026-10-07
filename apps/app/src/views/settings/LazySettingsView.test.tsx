// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const loading = vi.hoisted(() => {
  let finish!: (module: unknown) => void;
  const ready = new Promise(resolve => { finish = resolve; });
  return { ready, finish, requested: vi.fn() };
});
vi.mock('./SettingsView.js', async () => {
  loading.requested();
  return await loading.ready;
});
import { LazySettingsView } from './LazySettingsView.js';
afterEach(cleanup);

it('loads on navigation, keeps an accessible placeholder and preserves mounted settings state', async () => {
  expect(loading.requested).not.toHaveBeenCalled();
  const view = render(<LazySettingsView />);
  expect(screen.getByRole('region', { name: 'Settings' }).getAttribute('aria-busy')).toBe('true');
  await act(async () => {
    loading.finish({ SettingsView: () => <input aria-label="Setting" defaultValue="original" /> });
  });
  expect(loading.requested).toHaveBeenCalledTimes(1);
  const input = screen.getByRole('textbox', { name: 'Setting' }) as HTMLInputElement;
  input.value = 'retained';
  view.rerender(<LazySettingsView />);
  expect(screen.getByRole('textbox', { name: 'Setting' })).toBe(input);
  expect(input.value).toBe('retained');
  expect(screen.queryByRole('region', { name: 'Settings' })).toBeNull();
});
