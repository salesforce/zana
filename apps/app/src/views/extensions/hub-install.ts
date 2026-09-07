/** Shared toast for hub install Results that used to be fire-and-forget. */

export function reportHubInstallFailure(
  res: { ok: boolean; code?: string; message?: string },
  toast: (message: string, kind?: 'info' | 'error') => void
): void {
  if (res.ok) return;
  if (res.code === 'CANCELED') return;
  toast(res.message || 'Install failed', 'error');
}
