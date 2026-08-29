import type { MetadataRoute } from 'next';
import { DOCS } from '@/lib/docs';
import { site } from '@/lib/site';

/**
 * Static routes + every published docs slug. Absolute URLs are resolved against
 * PUBLIC_BASE_URL (site.publicBaseUrl / metadataBase). Dynamic API + auth routes
 * are intentionally excluded (nothing to index).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.publicBaseUrl.replace(/\/$/, '');
  const staticPaths = [
    '/',
    '/extensions/',
    '/extensions/getting-started/',
    '/extensions/install/',
    '/extensions/sdk/',
    '/marketplace/',
    '/download/',
    '/docs/'
  ];
  const docPaths = DOCS.map((d) => `/docs/${d.slug}/`);
  return [...staticPaths, ...docPaths].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path.startsWith('/docs') ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.7
  }));
}
