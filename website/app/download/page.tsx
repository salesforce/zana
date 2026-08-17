import type { Metadata } from 'next';
import { DownloadClient } from './DownloadClient';

export const metadata: Metadata = {
  title: 'Download',
  description:
    'Download Zana Command Center for macOS. Windows and Linux are coming soon.',
  alternates: { canonical: '/download/' },
  openGraph: {
    title: 'Download — Zana Command Center',
    description: 'Free, open, and signed. Install in minutes on macOS; Windows and Linux are coming soon.',
    url: '/download/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

export default function DownloadPage() {
  return <DownloadClient />;
}
