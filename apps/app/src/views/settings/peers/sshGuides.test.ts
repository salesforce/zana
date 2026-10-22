import { describe, expect, it } from 'vitest';
import { sshGuideFor } from './sshGuides.js';

describe('sshGuideFor', () => {
  it('returns a guide for a known reason', () => {
    const guide = sshGuideFor('ssh_remote_login_off');
    expect(guide?.title).toMatch(/connection service/);
    expect(guide?.steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(guide)).not.toMatch(/Add peer/);
  });
  it('keeps every guide about this computer, never another one', () => {
    for (const reason of ['ssh_remote_login_off', 'ssh_unreachable', 'ssh_auth_refused', 'ssh_forwarding_refused', 'ssh_stream_local_allowed', 'ssh_host_key_mismatch']) {
      const guide = sshGuideFor(reason);
      expect(guide?.steps.at(-1)).toMatch(/Check again/);
      expect(JSON.stringify(guide)).not.toMatch(/other computer|both computers|new invitation|Remote Login|Terminal|sudo/);
    }
  });
  it('returns null for unknown, inherited or empty reasons', () => {
    expect(sshGuideFor('nope')).toBeNull();
    expect(sshGuideFor('toString')).toBeNull();
    expect(sshGuideFor(null)).toBeNull();
    expect(sshGuideFor(undefined)).toBeNull();
    expect(sshGuideFor('')).toBeNull();
  });
});
