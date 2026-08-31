'use client';

import { useEffect, useState } from 'react';
import { site } from '@/lib/site';
import { dismissStarBanner, isStarBannerDismissed } from './star-banner';

/**
 * Site-wide “star us” ask. Starts hidden so SSR/hydration never flash a
 * dismissed banner; localStorage then decides whether to show it.
 */
export function StarBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isStarBannerDismissed(window.localStorage)) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    dismissStarBanner(window.localStorage);
    setShow(false);
  };

  return (
    <div className="star-banner" role="dialog" aria-label="Support Zana">
      <div className="wrap star-banner-inner">
        <span className="star-banner-heart" aria-hidden="true">
          ♥
        </span>
        <div className="star-banner-text">
          <strong>Enjoying Zana?</strong>
          <span>A GitHub ⭐ helps the project — it&apos;s free.</span>
        </div>
        <a
          className="star-banner-cta"
          href={site.repo}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
        >
          Star on GitHub
        </a>
        <button type="button" className="star-banner-close" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
