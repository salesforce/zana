import { describe, it, expect } from 'vitest';
import { formatExitNotification, formatBlockedNotification, formatAnswer } from './notify-format.js';

describe('formatExitNotification', () => {
  it('names the session by its UI title, not the raw id', () => {
    const text = formatExitNotification({ name: 'fix login bug', code: 0 });
    expect(text).toContain('fix login bug');
    expect(text).not.toContain('Session `');
  });

  it('marks a clean exit with the success icon', () => {
    expect(formatExitNotification({ name: 'build', code: 0 })).toContain('✅');
  });

  it('marks a non-zero exit with the error icon and the exit code', () => {
    const text = formatExitNotification({ name: 'build', code: 129 });
    expect(text).toContain('❌');
    expect(text).toContain('exit 129');
  });

  it('includes the project when one is given', () => {
    const text = formatExitNotification({ name: 'build', code: 0, projectName: 'zana-command-center' });
    expect(text).toContain('zana-command-center');
  });

  it('omits the project clause when none is given', () => {
    const text = formatExitNotification({ name: 'build', code: 0 });
    expect(text).not.toContain('undefined');
    expect(text).not.toMatch(/\bin\b/);
  });
});

describe('formatBlockedNotification', () => {
  it('names the session by its UI title and includes the project', () => {
    const text = formatBlockedNotification({ name: 'fix login bug', projectName: 'zana-command-center' });
    expect(text).toContain('⚠️');
    expect(text).toContain('fix login bug');
    expect(text).toContain('zana-command-center');
    expect(text).toContain('needs your input');
  });

  it('omits the project clause when none is given', () => {
    const text = formatBlockedNotification({ name: 'fix login bug' });
    expect(text).not.toContain('undefined');
  });
});

describe('formatAnswer', () => {
  it('returns short prose verbatim (trimmed), with no robot prefix', () => {
    const text = formatAnswer('  Done — the login redirect is fixed.  ');
    expect(text).toBe('Done — the login redirect is fixed.');
    expect(text).not.toContain(':robot_face:');
  });

  it('passes a body right at the cap through untruncated', () => {
    const body = 'x'.repeat(2000);
    expect(formatAnswer(body)).toBe(body);
  });

  it('hard-caps an over-long body and appends the truncation marker', () => {
    const text = formatAnswer('y'.repeat(2500));
    expect(text).toBe('y'.repeat(2000) + '…(truncated)');
    expect(text.startsWith('y'.repeat(2000))).toBe(true);
    expect(text.endsWith('…(truncated)')).toBe(true);
  });
});
