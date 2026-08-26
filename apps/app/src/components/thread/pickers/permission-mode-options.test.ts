import { describe, expect, it } from 'vitest';
import {
  PERMISSION_MODE_OPTIONS,
  permissionModeOptionsFor
} from './permission-mode-options.js';

describe('permissionModeOptionsFor', () => {
  it('keeps Accept Edits, Approve for me, and Full Access copy', () => {
    expect(PERMISSION_MODE_OPTIONS.map((row) => row.value)).toEqual([
      'accept-edits',
      'auto',
      'full'
    ]);
    expect(PERMISSION_MODE_OPTIONS[0]).toMatchObject({
      label: 'Accept Edits',
      compactLabel: 'Edits',
      description: 'Applies edits inside the workspace automatically. Anything beyond the workspace asks you first.'
    });
    expect(PERMISSION_MODE_OPTIONS[1]).toMatchObject({
      label: 'Approve for me',
      compactLabel: 'Auto'
    });
    expect(PERMISSION_MODE_OPTIONS[2]).toMatchObject({
      label: 'Full Access',
      compactLabel: 'Full',
      tone: 'warning',
      description: 'No sandbox and no approvals — the agent can run anything on your machine.'
    });
  });

  it('filters to the modes a provider actually offers', () => {
    expect(permissionModeOptionsFor(['full']).map((row) => row.value)).toEqual(['full']);
    expect(permissionModeOptionsFor(['accept-edits', 'full']).map((row) => row.value)).toEqual([
      'accept-edits',
      'full'
    ]);
    expect(permissionModeOptionsFor(['accept-edits', 'auto', 'full'])).toHaveLength(3);
  });
});
