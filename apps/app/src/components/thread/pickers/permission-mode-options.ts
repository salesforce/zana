import type { PermissionMode } from '@zana-ai/zcc-domain/thread-runtime';

export interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  compactLabel: string;
  description: string;
  tone?: 'default' | 'warning';
}

/**
 * The permission modes as the user sees them. Shared by the composer picker
 * so labels, compact chips, and descriptions never drift from one another.
 */
export const PERMISSION_MODE_OPTIONS: readonly PermissionModeOption[] = [
  {
    value: 'accept-edits',
    label: 'Accept Edits',
    compactLabel: 'Edits',
    description:
      'Applies edits inside the workspace automatically. Anything beyond the workspace asks you first.'
  },
  {
    value: 'auto',
    label: 'Approve for me',
    compactLabel: 'Auto',
    description:
      'Same workspace sandbox, with requests reviewed automatically. High-risk actions can still come back to you.'
  },
  {
    value: 'full',
    label: 'Full Access',
    compactLabel: 'Full',
    tone: 'warning',
    description:
      'No sandbox and no approvals — the agent can run anything on your machine.'
  }
];

/** Filter the canonical table to the modes this provider actually offers. */
export function permissionModeOptionsFor(
  modes: readonly string[]
): PermissionModeOption[] {
  const offered = new Set(modes);
  return PERMISSION_MODE_OPTIONS.filter((option) => offered.has(option.value));
}
