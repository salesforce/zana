export const ANALYTICS_CONSENT_KEY = 'zana-site-analytics';
export type AnalyticsConsent = 'granted' | 'denied' | null;

type AnalyticsWindow = Window & {
  dataLayer?: IArguments[];
  gtag?: (...args: unknown[]) => void;
};

export function validMeasurementId(value: string | undefined): string | null {
  return value && /^G-[A-Z0-9]+$/.test(value) ? value : null;
}

// Account, pairing, publishing and API URLs can contain private identifiers.
export function isPublicAnalyticsPath(path: string): boolean {
  return path === '/' || /^\/(features|download|docs|extensions|marketplace)(\/|$)/.test(path);
}

export function readAnalyticsConsent(): AnalyticsConsent {
  try {
    const value = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch { return null; }
}

export function saveAnalyticsConsent(value: Exclude<AnalyticsConsent, null>): void {
  try { localStorage.setItem(ANALYTICS_CONSENT_KEY, value); } catch { /* Session-only choice. */ }
}

export function safeAnalyticsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    return url.origin + (isPublicAnalyticsPath(url.pathname) ? url.pathname : '/');
  } catch { return ''; }
}

export function setAnalyticsEnabled(id: string, enabled: boolean, clearCookies = false): void {
  Object.assign(window, { [`ga-disable-${id}`]: !enabled });
  if (clearCookies) {
    for (const name of ['_ga', `_ga_${id.slice(2)}`]) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  }
}

export function initializeAnalytics(id: string): void {
  const target = window as AnalyticsWindow;
  target.dataLayer ??= [];
  target.gtag ??= function () { target.dataLayer!.push(arguments); };
  target.gtag('consent', 'default', {
    analytics_storage: 'granted', ad_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied'
  });
  target.gtag('js', new Date());
  target.gtag('config', id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_domain: 'none',
    cookie_flags: 'SameSite=Lax;Secure',
    page_location: safeAnalyticsUrl(window.location.href),
    page_referrer: safeAnalyticsUrl(document.referrer)
  });
}

export function trackPublicPage(id: string, pathname: string): void {
  if (!isPublicAnalyticsPath(pathname)) return;
  const target = window as AnalyticsWindow;
  const page = {
    page_location: window.location.origin + pathname,
    page_path: pathname,
    page_title: document.title,
    page_referrer: safeAnalyticsUrl(document.referrer)
  };
  target.gtag?.('set', page);
  target.gtag?.('event', 'page_view', { ...page, send_to: id });
}

export function trackDownloadClick(id: string, platform = 'macOS'): void {
  (window as AnalyticsWindow).gtag?.('event', 'download_click', {
    send_to: id, platform
  });
}
