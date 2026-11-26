// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

const mocks = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/product-client.js', () => ({ product: { config: { set: mocks.save } } }));
vi.mock('../store.js', async () => {
  const { create } = await import('zustand');
  return {
    useData: create(() => ({ theme: 'light' as 'light' | 'dark' })),
    useUi: { getState: () => ({ pushToast: mocks.toast }) },
    applyTheme: mocks.apply,
    resolveTheme: (theme: string) => theme
  };
});
import { useData } from '../store.js';
import { TitlebarThemeToggle } from './TitlebarThemeToggle.js';

// Keep this store's shape typed without importing the full product store in the mock.
const themeStore = useData as unknown as ReturnType<typeof create<{ theme: 'light' | 'dark' }>>;
afterEach(() => { cleanup(); vi.clearAllMocks(); themeStore.setState({ theme: 'light' }); });

describe('titlebar appearance shortcut', () => {
  it('persists both directions, applies the saved config and describes the next action', async () => {
    mocks.save.mockImplementation(async patch => patch);
    render(<TitlebarThemeToggle />);
    const dark = screen.getByRole('button', { name: 'Switch to dark mode' });
    expect(dark.title).toBe('Switch to dark mode');
    expect(dark.querySelector('.lucide-moon')).not.toBeNull();
    await act(async () => fireEvent.click(dark));
    expect(mocks.save).toHaveBeenLastCalledWith({ theme: 'dark' });
    expect(mocks.apply).toHaveBeenLastCalledWith('dark');
    const light = screen.getByRole('button', { name: 'Switch to light mode' });
    expect(light.querySelector('.lucide-sun')).not.toBeNull();
    expect(light.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    await act(async () => fireEvent.click(light));
    expect(mocks.save).toHaveBeenLastCalledWith({ theme: 'light' });
    expect(themeStore.getState().theme).toBe('light');
  });

  it('reflects appearance changes from Settings, system resolution and other windows', () => {
    render(<TitlebarThemeToggle />);
    act(() => themeStore.setState({ theme: 'dark' }));
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('prevents overlapping writes and waits for persistence before applying the theme', async () => {
    let resolve!: (value: { theme: string }) => void;
    mocks.save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<TitlebarThemeToggle />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.apply).not.toHaveBeenCalled();
    await act(async () => resolve({ theme: 'dark' }));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(themeStore.getState().theme).toBe('dark');
  });

  it('keeps the current appearance on failure and allows a retry', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ theme: 'dark' });
    render(<TitlebarThemeToggle />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    expect(mocks.toast).toHaveBeenCalledWith("Couldn't change appearance. Try again.", 'error');
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(themeStore.getState().theme).toBe('light');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' })));
    expect(themeStore.getState().theme).toBe('dark');
  });
});
