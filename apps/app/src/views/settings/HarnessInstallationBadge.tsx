import { CheckCircle2, XCircle } from 'lucide-react';
import type { HarnessVerifyResult } from '@zana-ai/zcc-domain/product';

export function HarnessInstallationBadge({ h, enabled }: { h: HarnessVerifyResult; enabled: boolean }) {
  // Three honest states: installed → green ✓; enabled-but-missing → amber ✗ (the
  // actionable case); off (not installed, not enabled) → a muted/dim ✗.
  const missing = enabled && !h.installed;
  const state = h.installed ? 'ok' : missing ? 'warn' : 'muted';
  const title = h.installed
    ? h.version || 'installed'
    : enabled
      ? `not found — install it (${h.installHint})`
      : 'not installed';
  return (
    <span className={`opener-row-status opener-row-status--${state}`} title={title}>
      {h.installed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {h.installed ? h.version || 'Installed' : 'Not installed'}
    </span>
  );
}
