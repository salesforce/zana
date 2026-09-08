import { describe, expect, it } from 'vitest';
import { REPORT_BUG_URL } from './about-credits.js';
import {
  CRASH_ISSUE_TITLE_MAX,
  CRASH_REPORT_FIELD_MAX,
  boundCrashText,
  crashIssueMarkdown,
  crashIssueTitle,
  crashIssueUrl
} from './crash-report.js';

describe('crash report builder', () => {
  it('bounds non-strings and oversize text', () => {
    expect(boundCrashText(null, 8)).toBe('');
    expect(boundCrashText(12, 8)).toBe('');
    expect(boundCrashText('abcdef', 4)).toBe('abcd');
    expect(boundCrashText('ok', 8)).toBe('ok');
    expect(boundCrashText('x', 0)).toBe('');
  });

  it('builds a Renderer crash title from the first line', () => {
    expect(crashIssueTitle('Minified React error #185;\nvisit react.dev')).toBe(
      'Renderer crash: Minified React error #185;'
    );
    expect(crashIssueTitle('')).toBe('Renderer crash: unexpected error');
    expect(crashIssueTitle('a'.repeat(CRASH_ISSUE_TITLE_MAX + 40)).length).toBeLessThanOrEqual(
      CRASH_ISSUE_TITLE_MAX + 20
    );
  });

  it('renders paste-ready markdown with version, OS, and saved file', () => {
    const markdown = crashIssueMarkdown({
      message: 'boom',
      stack: 'Error: boom\n    at x',
      componentStack: 'in ThreadDetail',
      version: '2.0.1',
      osLabel: 'darwin 25.6.0 arm64',
      fileName: 'crash-2026.md'
    });
    expect(markdown).toContain('The renderer recovered to the crash screen.');
    expect(markdown).toContain('boom');
    expect(markdown).toContain('in ThreadDetail');
    expect(markdown).toContain('2.0.1 / darwin 25.6.0 arm64');
    expect(markdown).toContain('crash-2026.md');
    expect(markdown).toContain('~/.zcc/crashes');
  });

  it('truncates huge fields before they land in the markdown', () => {
    const markdown = crashIssueMarkdown({
      message: 'm'.repeat(CRASH_REPORT_FIELD_MAX + 50),
      stack: 's'.repeat(CRASH_REPORT_FIELD_MAX + 50)
    });
    expect(markdown).not.toContain('m'.repeat(CRASH_REPORT_FIELD_MAX + 1));
  });

  it('appends an encoded title to the public bug form URL', () => {
    const url = crashIssueUrl('Renderer crash: Minified React error #185');
    expect(url.startsWith(`${REPORT_BUG_URL}&title=`)).toBe(true);
    expect(url).toContain(encodeURIComponent('Renderer crash: Minified React error #185'));
    const huge = crashIssueUrl(`Renderer crash: ${'x'.repeat(20_000)}`);
    expect(huge).toBe(`${REPORT_BUG_URL}&title=${encodeURIComponent('Renderer crash')}`);
  });
});
