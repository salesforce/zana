'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  initializeAnalytics, isPublicAnalyticsPath, readAnalyticsConsent,
  saveAnalyticsConsent, setAnalyticsEnabled, trackDownloadClick,
  trackPublicPage, validMeasurementId, type AnalyticsConsent
} from '../../lib/analytics';
import styles from './GoogleAnalytics.module.css';

export function GoogleAnalytics({ measurementId }: { measurementId?: string }) {
  const id = validMeasurementId(measurementId);
  const pathname = usePathname();
  const [consent, setConsent] = useState<AnalyticsConsent>(null);
  const [ready, setReady] = useState(false);
  const [showChoice, setShowChoice] = useState(false);
  const initialized = useRef(false);
  const lastPath = useRef<string | null>(null);
  const publicPage = isPublicAnalyticsPath(pathname);
  const active = !!id && ready && consent === 'granted' && publicPage;

  useEffect(() => {
    const saved = readAnalyticsConsent();
    setConsent(saved);
    setShowChoice(saved === null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!id || !ready) return;
    setAnalyticsEnabled(id, active, consent === 'denied');
    if (!active) { lastPath.current = null; return; }
    if (!initialized.current) {
      initializeAnalytics(id);
      initialized.current = true;
    }
    if (lastPath.current !== pathname) {
      trackPublicPage(id, pathname);
      lastPath.current = pathname;
    }
    function onClick(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a[data-analytics="download"]') : null;
      if (link) trackDownloadClick(id!, link.getAttribute('data-platform') ?? undefined);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [id, active, pathname, ready, consent]);

  if (!id || !ready || !publicPage) return null;
  function choose(value: 'granted' | 'denied') {
    saveAnalyticsConsent(value);
    setConsent(value);
    setShowChoice(false);
  }
  return <>
    {active && <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />}
    {showChoice ? <section className={styles.choice} aria-label="Analytics cookies">
      <p>Allow analytics cookies? Google Analytics helps us understand page visits and download clicks.</p>
      <div className={styles.actions}>
        <button type="button" className="zcc-btn zcc-btn-sm" onClick={() => choose('denied')}>Decline</button>
        <button type="button" className="zcc-btn zcc-btn-sm" onClick={() => choose('granted')}>Accept analytics</button>
      </div>
    </section> : <button type="button" className={styles.preferences} onClick={() => setShowChoice(true)}>Analytics cookies</button>}
  </>;
}
