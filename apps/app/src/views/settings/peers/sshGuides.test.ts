import { describe, expect, it } from 'vitest';
import { sshGuideFor } from './sshGuides.js';

describe('sshGuideFor', () => {
  it('returns a guide for a known reason', () => {
    const guide = sshGuideFor('ssh_remote_login_off');
    expect(guide?.title).toMatch(/Remote Login/);
    expect(guide?.steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(guide)).not.toMatch(/Add peer/);
  });
  it('returns null for unknown, inherited or empty reasons', () => {
    expect(sshGuideFor('nope')).toBeNull();
    expect(sshGuideFor('toString')).toBeNull();
    expect(sshGuideFor(null)).toBeNull();
    expect(sshGuideFor(undefined)).toBeNull();
    expect(sshGuideFor('')).toBeNull();
  });
});
