import type { Metadata } from 'next';
import { MarketplaceClient } from './MarketplaceClient';

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
  return <MarketplaceClient />;
}
