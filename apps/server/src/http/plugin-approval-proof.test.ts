import { describe, expect, it } from 'vitest';
import {
  createPluginApprovalVerifier,
  parsePluginApprovalBinding,
  parsePluginApprovalRequest,
  PLUGIN_APPROVAL_TTL_MS,
  signPluginApproval
} from './plugin-approval-proof.js';

const secret = 'desktop-only-boot-secret-of-at-least-32-bytes';
const now = 1_800_000_000_000;
const binding = {
  action: 'agent.activate',
  target: '00D000000000001',
  targetLabel: 'agentaidev (sandbox)',
  subject: 'Help_Agent v3',
  revision: 'a'.repeat(64)
};

describe('plugin approval bindings', () => {
  it('cleans what the sheet shows and refuses what it cannot show', () => {
    expect(parsePluginApprovalBinding({ ...binding, subject: '  Help\n_Agent   v3 ', revision: '', confirmText: null })).toEqual({
      ok: true, value: { action: 'agent.activate', target: '00D000000000001', targetLabel: 'agentaidev (sandbox)', subject: 'Help _Agent v3' }
    });
    expect(parsePluginApprovalBinding({ ...binding, confirmText: 'prod' })).toMatchObject({ ok: true, value: { confirmText: 'prod' } });
    for (const raw of [null, [], 'x', { ...binding, action: 'Agent.Activate' }, { ...binding, action: '' }, { ...binding, action: 1 }]) {
      expect(parsePluginApprovalBinding(raw).ok).toBe(false);
    }
    expect(parsePluginApprovalBinding({ ...binding, target: ' ' })).toEqual({ ok: false, error: expect.stringContaining('target') });
    expect(parsePluginApprovalBinding({ ...binding, subject: 'x'.repeat(201) }).ok).toBe(false);
    expect(parsePluginApprovalBinding({ ...binding, revision: 'r'.repeat(129) })).toEqual({ ok: false, error: expect.stringContaining('revision') });
    expect(parsePluginApprovalBinding({ ...binding, confirmText: 7 })).toEqual({ ok: false, error: expect.stringContaining('confirmText') });
  });

  it('bounds the explanation around the binding', () => {
    const request = { binding, title: 'Activate Help_Agent', summary: 'Makes v3 live.', details: ['Eval passed on a1b2c3'], confirmLabel: 'Activate', tone: 'danger' };
    expect(parsePluginApprovalRequest(request)).toEqual({ ok: true, value: request });
    expect(parsePluginApprovalRequest({ binding, title: 'Plain' })).toEqual({ ok: true, value: { binding, title: 'Plain' } });
    expect(parsePluginApprovalRequest({ binding, title: 'Plain', tone: 'default', details: [] })).toEqual({ ok: true, value: { binding, title: 'Plain' } });
    for (const [raw, error] of [
      [null, 'request must be an object'],
      [{ binding: null, title: 'x' }, 'binding must be an object'],
      [{ binding, title: '' }, 'title'],
      [{ binding, title: 'x'.repeat(121) }, 'title'],
      [{ binding, title: 'x', summary: 's'.repeat(601) }, 'summary'],
      [{ binding, title: 'x', confirmLabel: 'c'.repeat(41) }, 'confirmLabel'],
      [{ binding, title: 'x', details: 'one' }, 'details'],
      [{ binding, title: 'x', details: Array(9).fill('d') }, 'details'],
      [{ binding, title: 'x', details: ['ok', ''] }, 'each detail'],
      [{ binding, title: 'x', tone: 'loud' }, 'tone']
    ] as const) {
      expect(parsePluginApprovalRequest(raw)).toEqual({ ok: false, error: expect.stringContaining(error) });
    }
  });
});

describe('plugin approval tokens', () => {
  it('accept the exact plugin and binding once', () => {
    let at = now;
    const verify = createPluginApprovalVerifier(secret, () => at);
    const token = signPluginApproval(secret, 'salesforce', binding, now);
    expect(verify(token, 'other-plugin', binding)).toBe(false);
    for (const field of ['action', 'target', 'targetLabel', 'subject', 'revision'] as const) {
      expect(verify(token, 'salesforce', { ...binding, [field]: field === 'action' ? 'agent.publish' : `${binding[field]}x` })).toBe(false);
    }
    expect(verify(token, 'salesforce', { ...binding, confirmText: 'prod' })).toBe(false);
    at = now + PLUGIN_APPROVAL_TTL_MS;
    expect(verify(token, 'salesforce', binding)).toBe(true);
    expect(verify(token, 'salesforce', binding)).toBe(false);
  });

  it('refuse expired, future, forged, malformed and unparseable tokens', () => {
    const verify = createPluginApprovalVerifier(secret, () => now);
    expect(verify(signPluginApproval(secret, 'salesforce', binding, now - PLUGIN_APPROVAL_TTL_MS - 1), 'salesforce', binding)).toBe(false);
    expect(verify(signPluginApproval(secret, 'salesforce', binding, now + 1), 'salesforce', binding)).toBe(false);
    expect(verify(signPluginApproval('w'.repeat(40), 'salesforce', binding, now), 'salesforce', binding)).toBe(false);
    const valid = signPluginApproval(secret, 'salesforce', binding, now);
    for (const token of [undefined, 42, '', 'x'.repeat(129), valid.replace(/\./g, '-'), `${valid}0`]) {
      expect(verify(token, 'salesforce', binding)).toBe(false);
    }
    expect(verify(valid, '', binding)).toBe(false);
    expect(verify(valid, 'salesforce', { ...binding, action: 'BAD' })).toBe(false);
    expect(verify(valid, 'salesforce', binding)).toBe(true);
  });

  it('signs the cleaned binding, so a rebuilt binding with the same text still matches', () => {
    const verify = createPluginApprovalVerifier(secret, () => now);
    const shown = parsePluginApprovalBinding({ ...binding, subject: 'Help_Agent   v3' });
    if (!shown.ok) throw new Error(shown.error);
    expect(verify(signPluginApproval(secret, 'salesforce', shown.value, now), 'salesforce', { ...binding, subject: ' Help_Agent v3' })).toBe(true);
  });

  it('keeps a bounded memory of used tokens and forgets expired ones', () => {
    let at = now;
    const verify = createPluginApprovalVerifier(secret, () => at);
    const first = signPluginApproval(secret, 'salesforce', binding, now);
    expect(verify(first, 'salesforce', binding)).toBe(true);
    for (let i = 1; i <= 1024; i += 1) {
      expect(verify(signPluginApproval(secret, 'salesforce', binding, now), 'salesforce', binding)).toBe(true);
    }
    // The oldest entry was evicted at the cap, but its age still refuses it later.
    at = now + PLUGIN_APPROVAL_TTL_MS + 1;
    expect(verify(first, 'salesforce', binding)).toBe(false);
    expect(verify(signPluginApproval(secret, 'salesforce', binding, at), 'salesforce', binding)).toBe(true);
  });

  it('needs a real secret', () => {
    expect(() => createPluginApprovalVerifier('x'.repeat(31))).toThrow('Invalid desktop UI signing secret');
    expect(createPluginApprovalVerifier('x'.repeat(32))(undefined, 'p', binding)).toBe(false);
  });
});
