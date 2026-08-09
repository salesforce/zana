import type { Metadata } from 'next';
import { MarketplaceClient } from './MarketplaceClient';

export const metadata: Metadata = {
  title: 'Marketplace',
  description:
    'Browse and install Zana Command Center extensions — panels, tabs, commands, personas, and teams from the same catalog the desktop app reads.',
  alternates: { canonical: '/marketplace/' },
  openGraph: {
    title: 'Marketplace — Zana Command Center',
    description: 'Extend the cockpit: install panels, tabs, commands, personas, and teams.',
    url: '/marketplace/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

export default function MarketplacePage() {
  return <MarketplaceClient />;
}
