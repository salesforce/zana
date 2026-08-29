import { describe, expect, it, vi } from 'vitest';
import {
  appNavigate,
  getLastAppNavigatePath,
  hasAppNavigate,
  registerAppNavigate
} from '../app-navigate.js';

describe('appNavigate', () => {
  it('returns false and does not record a path when no router is registered', () => {
    registerAppNavigate(null);
    expect(hasAppNavigate()).toBe(false);
    expect(appNavigate('/inbox')).toBe(false);
    expect(getLastAppNavigatePath()).toBeNull();
  });

  it('forwards push and replace to the registered router', () => {
    const navigate = vi.fn();
    registerAppNavigate(navigate);
    expect(hasAppNavigate()).toBe(true);
    expect(appNavigate('/inbox')).toBe(true);
    expect(getLastAppNavigatePath()).toBe('/inbox');
    expect(navigate).toHaveBeenCalledWith('/inbox', undefined);

    expect(appNavigate('/settings', { replace: true })).toBe(true);
    expect(getLastAppNavigatePath()).toBe('/settings');
    expect(navigate).toHaveBeenCalledWith('/settings', { replace: true });

    registerAppNavigate(null);
    expect(hasAppNavigate()).toBe(false);
    expect(getLastAppNavigatePath()).toBeNull();
    expect(appNavigate('/agents')).toBe(false);
  });
});
