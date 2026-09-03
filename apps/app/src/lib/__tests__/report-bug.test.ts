import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_BUG_URL } from '@zana-ai/zcc-domain/product';

const copyText = vi.fn(async (..._args: unknown[]) => undefined);
const saveCrashReport = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const version = vi.fn(async () => '2.0.1');
const hasDesktopBridge = vi.fn(() => false);

vi.mock('../copy-text.js', () => ({
  copyText: (...args: unknown[]) => copyText(...args)
}));

vi.mock('../app-surface.js', () => ({
  hasDesktopBridge: () => hasDesktopBridge()
}));

vi.mock('../product-client.js', () => ({
  product: {
    app: {
      saveCrashReport: (...args: unknown[]) => saveCrashReport(...args),
      version: () => version()
    }
  }
}));

const { openBugReport, reportRendererCrash } = await import('../report-bug.js');

describe('openBugReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    copyText.mockReset();
    saveCrashReport.mockReset();
    hasDesktopBridge.mockReturnValue(false);
  });

  it('opens the public GitHub bug form in a new tab', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);

    openBugReport();

    expect(REPORT_BUG_URL).toBe(
      'https://github.com/salesforce/zana/issues/new?template=bug.yml'
    );
    expect(open).toHaveBeenCalledWith(REPORT_BUG_URL, '_blank', 'noopener');
  });

  it('opens a titled crash URL, copies markdown, and saves when the desktop bridge is present', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    hasDesktopBridge.mockReturnValue(true);
    saveCrashReport.mockResolvedValue({
      ok: true,
      version: '2.0.1',
      osLabel: 'darwin 25 arm64',
      fileName: 'crash-1.md'
    });

    const status = await reportRendererCrash({
      message: 'Minified React error #185',
      stack: 'Error: boom',
      componentStack: 'in ThreadDetail'
    });

    expect(saveCrashReport).toHaveBeenCalledWith({
      message: 'Minified React error #185',
      stack: 'Error: boom',
      componentStack: 'in ThreadDetail'
    });
    expect(copyText).toHaveBeenCalled();
    const markdown = copyText.mock.calls[0]?.[0] as string;
    expect(markdown).toContain('Minified React error #185');
    expect(markdown).toContain('in ThreadDetail');
    expect(markdown).toContain('crash-1.md');
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining(`${REPORT_BUG_URL}&title=`),
      '_blank',
      'noopener'
    );
    expect(status).toContain('Paste into What happened?');
    expect(status).toContain('saved');
  });
});
