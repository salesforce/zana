import { describe, expect, it } from 'vitest';
import {
  assertAutomationTargetThread,
  browserPartitionForThread,
  filterAutomationTargetsForThread,
  forgetPendingAutomationTab,
  HIDDEN_AUTOMATION_VIEW_BOUNDS,
  isPendingAutomationTab,
  partitionForBrowserTab,
  pickLiveBrowserWindow,
  rememberPendingAutomationTab,
  shouldBroadcastAutomationOpen,
  ZCC_BROWSER_AUTOMATION_PARTITION
} from './desktop-browser-thread-scope.js';

describe('desktop browser thread scope', () => {
  it('filters automation targets to the calling thread', () => {
    const owned = new Map([
      ['browser-auto:a', 'thr-1'],
      ['browser-auto:b', 'thr-2']
    ]);
    const targets = [
      { targetId: 'browser-auto:a', tabId: 'browser:1', url: 'https://example.test', title: 'A' },
      { targetId: 'browser-auto:b', tabId: 'browser:2', url: 'https://other.test', title: 'B' }
    ];
    expect(filterAutomationTargetsForThread(targets, owned, 'thr-1')).toEqual([targets[0]]);
    expect(filterAutomationTargetsForThread(targets, owned, undefined)).toEqual(targets);
    expect(
      filterAutomationTargetsForThread(
        [...targets, { targetId: 'browser-auto:c', tabId: 'browser:3', url: 'https://c.test', title: 'C' }],
        owned,
        'thr-1'
      )
    ).toEqual([targets[0]]);
  });

  it('rejects cross-thread target ids', () => {
    const owned = new Map([['browser-auto:a', 'thr-1']]);
    expect(() => assertAutomationTargetThread('browser-auto:a', owned, 'thr-2')).toThrow(
      /unknown automation target/
    );
    expect(() => assertAutomationTargetThread('browser-auto:a', owned, 'thr-1')).not.toThrow();
  });

  it('mints a persist partition name for a later per-thread cookie jar', () => {
    expect(browserPartitionForThread('thr/1')).toBe('persist:zcc-browser-thr_1');
    expect(browserPartitionForThread('')).toBe('persist:zcc-browser-thread');
    expect(() =>
      assertAutomationTargetThread('browser-auto-missing', new Map(), undefined)
    ).not.toThrow();
  });

  it('uses a shared persist partition for agent automation tabs', () => {
    expect(ZCC_BROWSER_AUTOMATION_PARTITION).toBe('persist:zcc-browser-automation');
    expect(partitionForBrowserTab(true)).toBe(ZCC_BROWSER_AUTOMATION_PARTITION);
    expect(partitionForBrowserTab(false)).toBe('persist:zcc-browser');
    expect(partitionForBrowserTab(false, 'persist:custom')).toBe('persist:custom');
  });

  it('tracks pending automation tab ids without an IPC extra key', () => {
    rememberPendingAutomationTab('');
    expect(isPendingAutomationTab('')).toBe(false);
    rememberPendingAutomationTab('browser:auto');
    expect(isPendingAutomationTab('browser:auto')).toBe(true);
    expect(isPendingAutomationTab('browser:personal')).toBe(false);
    expect(isPendingAutomationTab('')).toBe(false);
    forgetPendingAutomationTab('browser:auto');
    expect(isPendingAutomationTab('browser:auto')).toBe(false);
  });

  it('broadcasts a visible open and hidden-attaches when visible is false', () => {
    expect(shouldBroadcastAutomationOpen(true)).toBe(true);
    expect(shouldBroadcastAutomationOpen(false)).toBe(false);
    expect(HIDDEN_AUTOMATION_VIEW_BOUNDS).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it('prefers the focused live window for a hidden attach', () => {
    const focused = {
      id: 'focused',
      isDestroyed: () => false,
      isFocused: () => true,
      webContents: { isDestroyed: () => false }
    };
    const other = {
      id: 'other',
      isDestroyed: () => false,
      isFocused: () => false,
      webContents: { isDestroyed: () => false }
    };
    const dead = {
      id: 'dead',
      isDestroyed: () => true,
      isFocused: () => true,
      webContents: { isDestroyed: () => false }
    };
    expect(pickLiveBrowserWindow([dead, other, focused])?.id).toBe('focused');
    expect(pickLiveBrowserWindow([dead, other])?.id).toBe('other');
    expect(pickLiveBrowserWindow([dead])).toBeNull();
  });
});
