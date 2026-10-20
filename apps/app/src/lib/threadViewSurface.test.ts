/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseThreadViewSearch } from './threadViewSurface.js';

const target = { threadId: 't-1', projectId: 'p-1' };
const query = (extra = '') => `?surface=thread-view&threadId=t-1&projectId=p-1${extra}`;

describe('parseThreadViewSearch', () => {
  it('reads a thread view target, with or without a project', () => {
    expect(parseThreadViewSearch(query('&x=1'))).toEqual(target);
    expect(parseThreadViewSearch('?surface=thread-view&threadId=t-1')).toEqual({ threadId: 't-1' });
    expect(parseThreadViewSearch('?surface=thread-view&threadId=t-1&projectId=%20')).toEqual({ threadId: 't-1' });
  });

  it.each([
    '',
    '?threadId=t-1',
    '?surface=plugin-view&threadId=t-1',
    '?surface=thread-view',
    '?surface=thread-view&threadId=../t-1'
  ])('ignores %j', (search) => {
    expect(parseThreadViewSearch(search)).toBeNull();
  });
});

describe('getThreadViewTarget', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.resetModules();
  });

  async function load() {
    return import('./threadViewSurface.js');
  }

  it('is null in an ordinary window', async () => {
    const surface = await load();
    expect(surface.getThreadViewTarget()).toBeNull();
    expect(surface.isThreadViewSurface()).toBe(false);
  });

  it('reads the query and remembers it for a reload without one', async () => {
    window.history.replaceState(null, '', `/${query()}`);
    const first = await load();
    expect(first.getThreadViewTarget()).toEqual(target);
    expect(first.isThreadViewSurface()).toBe(true);

    window.history.replaceState(null, '', '/threads/t-1');
    vi.resetModules();
    expect((await load()).getThreadViewTarget()).toEqual(target);
  });

  it('ignores a tampered remembered target', async () => {
    window.sessionStorage.setItem('zcc.threadViewTarget', JSON.stringify({ threadId: '../x' }));
    expect((await load()).getThreadViewTarget()).toBeNull();
    window.sessionStorage.setItem('zcc.threadViewTarget', '{not json');
    vi.resetModules();
    expect((await load()).getThreadViewTarget()).toBeNull();
  });
});
