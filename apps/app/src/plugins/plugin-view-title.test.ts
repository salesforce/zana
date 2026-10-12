import { describe, expect, it, vi } from 'vitest';
import type { ZccWindowTitle } from '@zana-ai/zcc-plugin-sdk/app';
import {
  claimPluginViewTitle,
  getPluginViewTitle,
  sanitizePluginViewTitle,
  setPluginViewTitle,
  subscribePluginViewTitle
} from './plugin-view-title.js';

describe('sanitizePluginViewTitle', () => {
  it('trims each part, folds control characters and keeps a known tone', () => {
    expect(sanitizePluginViewTitle({ title: '  Agentforce\n·\tHelp ', detail: ' prod ', badge: 'Production', tone: 'danger' })).toEqual({
      title: 'Agentforce · Help',
      detail: 'prod',
      badge: 'Production',
      tone: 'danger'
    });
  });

  it('caps long parts and drops blank ones', () => {
    const clean = sanitizePluginViewTitle({ title: 'x'.repeat(200), detail: '  ', badge: 'b'.repeat(40) })!;
    expect(clean.title).toHaveLength(120);
    expect(clean.title.endsWith('…')).toBe(true);
    expect(clean.badge).toHaveLength(24);
    expect(clean).not.toHaveProperty('detail');
    expect(clean.tone).toBe('neutral');
  });

  it('refuses what is not a title', () => {
    expect(sanitizePluginViewTitle(null)).toBeNull();
    expect(sanitizePluginViewTitle(undefined)).toBeNull();
    expect(sanitizePluginViewTitle({ title: '   ' })).toBeNull();
    expect(sanitizePluginViewTitle('Studio' as unknown as ZccWindowTitle)).toBeNull();
    expect(sanitizePluginViewTitle({ title: 42 } as unknown as ZccWindowTitle)).toBeNull();
    expect(sanitizePluginViewTitle({ title: 'T', detail: 7, tone: 'loud' } as unknown as ZccWindowTitle)).toEqual({ title: 'T', tone: 'neutral' });
  });
});

describe('plugin view title store', () => {
  it('shows the newest mounted title and falls back as each is released', () => {
    const listener = vi.fn();
    const off = subscribePluginViewTitle(listener);
    const pane = setPluginViewTitle({ title: 'Pane', tone: 'neutral' });
    const dialog = setPluginViewTitle({ title: 'Dialog', tone: 'warning' });
    expect(getPluginViewTitle()?.title).toBe('Dialog');
    pane();
    expect(getPluginViewTitle()?.title).toBe('Dialog');
    dialog();
    expect(getPluginViewTitle()).toBeNull();
    dialog();
    expect(listener).toHaveBeenCalledTimes(4);
    off();
    setPluginViewTitle({ title: 'Later', tone: 'neutral' })();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('keeps each place in mount order while its title changes', () => {
    const pane = claimPluginViewTitle();
    pane.set({ title: 'Pane', badge: 'Production', tone: 'danger' });
    const dialog = claimPluginViewTitle();
    expect(getPluginViewTitle()?.title).toBe('Pane');
    dialog.set({ title: 'Dialog', tone: 'neutral' });
    pane.set({ title: 'Pane · Help', badge: 'Production', tone: 'danger' });
    expect(getPluginViewTitle()?.title).toBe('Dialog');
    dialog.set(null);
    expect(getPluginViewTitle()).toEqual({ title: 'Pane · Help', badge: 'Production', tone: 'danger' });
    dialog.release();
    dialog.set({ title: 'Gone', tone: 'neutral' });
    expect(getPluginViewTitle()?.title).toBe('Pane · Help');
    pane.release();
    expect(getPluginViewTitle()).toBeNull();
  });
});
