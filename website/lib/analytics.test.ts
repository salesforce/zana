// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ANALYTICS_CONSENT_KEY, initializeAnalytics, isPublicAnalyticsPath,
  readAnalyticsConsent, safeAnalyticsUrl, saveAnalyticsConsent,
  setAnalyticsEnabled, trackDownloadClick, trackPublicPage, validMeasurementId
} from './analytics';

const id = 'G-ABC1234567';
const target = window as Window & { dataLayer?: IArguments[]; gtag?: (...args: unknown[]) => void };
beforeEach(() => { localStorage.clear(); delete target.gtag; delete target.dataLayer; });
afterEach(() => { vi.restoreAllMocks(); });

it.each([undefined, '', 'UA-123', 'G-abc', 'G-123<script>', ' G-ABC'])('rejects invalid measurement IDs: %s', input => {
  expect(validMeasurementId(input)).toBeNull();
});
it('accepts a GA4 web stream ID', () => { expect(validMeasurementId(id)).toBe(id); });

it.each(['/', '/features/', '/download', '/docs/cli/', '/extensions/sdk/', '/marketplace/'])('allows public page %s', path => {
  expect(isPublicAnalyticsPath(path)).toBe(true);
});
it.each(['/connect/', '/dashboard/', '/api/auth/github/callback/', '/docs-private/', '/other'])('excludes private and unknown page %s', path => {
  expect(isPublicAnalyticsPath(path)).toBe(false);
});
it('stores only recognized consent choices and handles unavailable storage', () => {
  expect(readAnalyticsConsent()).toBeNull();
  localStorage.setItem(ANALYTICS_CONSENT_KEY, 'unexpected');
  expect(readAnalyticsConsent()).toBeNull();
  saveAnalyticsConsent('granted'); expect(readAnalyticsConsent()).toBe('granted');
  saveAnalyticsConsent('denied'); expect(readAnalyticsConsent()).toBe('denied');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  expect(readAnalyticsConsent()).toBeNull();
  expect(() => saveAnalyticsConsent('denied')).not.toThrow();
});
it('removes queries, fragments and private referrer paths', () => {
  expect(safeAnalyticsUrl('https://zana-ide.com/docs/?code=secret#private')).toBe('https://zana-ide.com/docs/');
  expect(safeAnalyticsUrl('https://zana-ide.com/connect/?phone=secret')).toBe('https://zana-ide.com/');
  expect(safeAnalyticsUrl('https://google.com/search?q=anything')).toBe('https://google.com/');
  expect(safeAnalyticsUrl('not a url')).toBe('');
  expect(safeAnalyticsUrl('javascript:alert(1)')).toBe('');
});
it('configures manual page views, denied advertising and host-only cookies', () => {
  initializeAnalytics(id);
  const queue = target.dataLayer!.map(args => Array.from(args));
  expect(queue[0]).toEqual(['consent', 'default', expect.objectContaining({ analytics_storage: 'granted', ad_storage: 'denied' })]);
  expect(queue[1]).toEqual(['js', expect.any(Date)]);
  expect(queue[2]).toEqual(['config', id, expect.objectContaining({ send_page_view: false, cookie_domain: 'none', allow_google_signals: false })]);
  const existing = target.gtag;
  initializeAnalytics(id);
  expect(target.gtag).toBe(existing);
});
it('sends public views and download clicks without private URL parameters', () => {
  target.gtag = vi.fn();
  document.title = 'Documentation';
  trackPublicPage(id, '/connect/'); expect(target.gtag).not.toHaveBeenCalled();
  trackPublicPage(id, '/docs/');
  expect(target.gtag).toHaveBeenLastCalledWith('event', 'page_view', expect.objectContaining({ page_location: window.location.origin + '/docs/', page_title: 'Documentation', send_to: id }));
  trackDownloadClick(id);
  expect(target.gtag).toHaveBeenLastCalledWith('event', 'download_click', { send_to: id, platform: 'macOS' });
  trackDownloadClick(id, 'Windows');
  expect(target.gtag).toHaveBeenLastCalledWith('event', 'download_click', { send_to: id, platform: 'Windows' });
  delete target.gtag;
  expect(() => { trackPublicPage(id, '/'); trackDownloadClick(id); }).not.toThrow();
});
it('disables collection and clears host-only cookies only on a declined choice', () => {
  document.cookie = '_ga=existing; Path=/';
  document.cookie = '_ga_ABC1234567=existing; Path=/';
  setAnalyticsEnabled(id, false);
  expect((window as unknown as Record<string, unknown>)[`ga-disable-${id}`]).toBe(true);
  expect(document.cookie).toContain('_ga=existing');
  setAnalyticsEnabled(id, true);
  expect((window as unknown as Record<string, unknown>)[`ga-disable-${id}`]).toBe(false);
  setAnalyticsEnabled(id, false, true);
  expect(document.cookie).not.toContain('_ga');
});
