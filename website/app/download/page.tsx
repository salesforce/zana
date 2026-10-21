import type { Metadata } from 'next';
import { site } from '../../lib/site';
import { fetchLatestRelease } from '../../lib/downloads';
import { DownloadClient } from './DownloadClient';

export const metadata: Metadata = {
  title: 'Download',
  description:
    'Download Zana Command Center for macOS (Apple Silicon and Intel) and Windows x64. Linux is coming soon.',
  alternates: { canonical: '/download/' },
  openGraph: {
    title: 'Download — Zana Command Center',
    description: 'Free and open source. Install in minutes on macOS or Windows; Linux is coming soon.',
    url: '/download/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

// Literal (not the imported constant): Next reads segment config statically.
export const revalidate = 600;

export default async function DownloadPage() {
  return <DownloadClient release={await fetchLatestRelease(site.releasesRepo)} />;
}
