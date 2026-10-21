// @vitest-environment happy-dom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickReleaseAssets } from '../../lib/downloads';
import { DownloadClient } from './DownloadClient';

const base = 'https://github.com/salesforce/zana/releases/download/v9.9.9/';
const release = {
  tag_name: 'v9.9.9',
  published_at: '2026-10-18T17:48:08Z',
  assets: [
    'Zana-Command-Center-9.9.9-arm64.dmg',
    'Zana-Command-Center-9.9.9-x64.dmg',
    'Zana-Command-Center-9.9.9-win-x64-Setup.exe'
  ].map((name) => ({ name, browser_download_url: base + name }))
};

function useAgent(userAgent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DownloadClient', () => {
  it('links straight to the latest installers from the GitHub release', async () => {
    useAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)');
    render(createElement(DownloadClient, { release: pickReleaseAssets(release) }));

    expect(screen.getByText('v9.9.9')).toBeTruthy();
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Download for Apple Silicon')).toBe(base + 'Zana-Command-Center-9.9.9-arm64.dmg');
    expect(href('Download for Intel')).toBe(base + 'Zana-Command-Center-9.9.9-x64.dmg');
    expect(href('Download for Windows')).toBe(base + 'Zana-Command-Center-9.9.9-win-x64-Setup.exe');
    expect(screen.getByRole('link', { name: 'Download for Windows' }).dataset.platform).toBe('Windows');
    expect(screen.getAllByRole('heading', { level: 2 })[0].textContent).toBe('macOS');
  });

  it('puts Windows first for Windows visitors and falls back to the releases page', async () => {
    useAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    render(createElement(DownloadClient, { release: {} }));

    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 2 })[0].textContent).toContain('Windows')
    );
    expect(screen.getAllByRole('heading', { level: 2 })[0].textContent).toContain('Windows');
    const windows = screen.getByRole('link', { name: 'Download for Windows' });
    expect(windows.className).toContain('zcc-btn-primary');
    expect(windows.getAttribute('href')).toBe('https://github.com/salesforce/zana/releases/latest');
    expect(screen.getByText(/More info → Run anyway/)).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });
});
