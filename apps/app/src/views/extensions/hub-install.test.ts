import { describe, expect, it, vi } from 'vitest';
import { reportHubInstallFailure } from './hub-install.js';

describe('reportHubInstallFailure', () => {
  it('ignores success', () => {
    const toast = vi.fn();
    reportHubInstallFailure({ ok: true }, toast);
    expect(toast).not.toHaveBeenCalled();
  });

  it('ignores a canceled picker', () => {
    const toast = vi.fn();
    reportHubInstallFailure({ ok: false, code: 'CANCELED', message: 'Install canceled' }, toast);
    expect(toast).not.toHaveBeenCalled();
  });

  it('toasts a typed install failure', () => {
    const toast = vi.fn();
    reportHubInstallFailure(
      { ok: false, code: 'INSTALL_FAILED', message: 'plugin host is unavailable' },
      toast
    );
    expect(toast).toHaveBeenCalledWith('plugin host is unavailable', 'error');
  });

  it('falls back when the Result has no message', () => {
    const toast = vi.fn();
    reportHubInstallFailure({ ok: false, code: 'INSTALL_FAILED' }, toast);
    expect(toast).toHaveBeenCalledWith('Install failed', 'error');
  });
});
