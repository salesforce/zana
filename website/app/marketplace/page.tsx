import type { Metadata } from 'next';
import { site } from '@/lib/site';
import { MarketplaceClient } from './MarketplaceClient';

/** Read `PUBLIC_BASE_URL` at request time so the add-command origin can change without a rebuild. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Marketplace',
  description:
    'Browse and install Zana Command Center plugins — panels, skills, and MCP servers from the same catalog the desktop app reads.',
  alternates: { canonical: '/marketplace/' },
  openGraph: {
    title: 'Marketplace — Zana Command Center',
    description: 'Discover plugins: official bundled plus community git catalogs (pointers only).',
    url: '/marketplace/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

export default function MarketplacePage() {
  return <MarketplaceClient publicBaseUrl={site.publicBaseUrl} />;
}
