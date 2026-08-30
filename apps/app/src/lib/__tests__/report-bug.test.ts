import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBugReport, REPORT_BUG_URL } from '../report-bug.js';

describe('openBugReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
