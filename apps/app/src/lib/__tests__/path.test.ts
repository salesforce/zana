import { describe, it, expect } from 'vitest';
import { tildify, shortenProjectPath } from '../path.js';

describe('tildify', () => {
  it('replaces a leading home prefix with ~', () => {
    expect(tildify('/Users/me/Documents/foo', '/Users/me')).toBe('~/Documents/foo');
  });
  it('maps the home dir itself to ~', () => {
    expect(tildify('/Users/me', '/Users/me')).toBe('~');
  });
  it('tolerates a trailing slash on home', () => {
    expect(tildify('/Users/me/foo', '/Users/me/')).toBe('~/foo');
  });
  it('leaves a path outside home untouched', () => {
    expect(tildify('/opt/srv/app', '/Users/me')).toBe('/opt/srv/app');
  });
  it('is a no-op when home is unknown', () => {
    expect(tildify('/Users/me/foo', '')).toBe('/Users/me/foo');
    expect(tildify('/Users/me/foo', undefined)).toBe('/Users/me/foo');
  });
});

describe('shortenProjectPath', () => {
  it('keeps the distinguishing tail and tildifies home', () => {
    expect(shortenProjectPath('/Users/me/Documents/work/parrot', '/Users/me')).toBe(
      '~/…/work/parrot'
    );
  });
  it('does not collapse when the tail is short enough', () => {
    expect(shortenProjectPath('/Users/me/parrot', '/Users/me')).toBe('~/parrot');
    expect(shortenProjectPath('/Users/me', '/Users/me')).toBe('~');
  });
  it('preserves the filesystem root anchor when home is unknown', () => {
    expect(shortenProjectPath('/opt/srv/apps/a/b/c', undefined)).toBe('/opt/…/b/c');
  });
  it('respects a custom keepTail', () => {
    expect(shortenProjectPath('/Users/me/Documents/work/parrot', '/Users/me', 1)).toBe(
      '~/…/parrot'
    );
  });
});
