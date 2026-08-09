import type { MetadataRoute } from 'next';
import { isPlaceholderBaseUrl, site } from '@/lib/site';

/** Allow indexing of everything except the dynamic API + auth surface. */
export default function robots(): MetadataRoute.Robots {
  // A production build with PUBLIC_BASE_URL unset would otherwise publish
  // `http://localhost:4321` absolute URLs to crawlers. Refuse indexing entirely
  // until the deploy sets a real base — better a delisted site than a broken one.
  if (isPlaceholderBaseUrl) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  const base = site.publicBaseUrl.replace(/\/$/, '');
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/dashboard/'] }],
    sitemap: `${base}/sitemap.xml`
  };
}
