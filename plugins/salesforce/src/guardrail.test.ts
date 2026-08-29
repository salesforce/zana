import { describe, expect, it } from 'vitest';
import { Guardrail, envelopeTitle, sessionKey } from '../lib/guardrail.js';

describe('guardrail', () => {
  it('fails closed without a thread id', async () => {
    const guard = new Guardrail(async () => {
      throw new Error('should not prompt');
    });
    await expect(
      guard.mediate({
        threadId: '',
        orgAlias: 'prod',
        orgKind: 'production',
        summary: 'read'
      })
    ).resolves.toEqual({ approved: false, reason: 'headless' });
  });

  it('does not prompt for sandbox reads', async () => {
    const guard = new Guardrail(async () => {
      throw new Error('should not prompt');
    });
    await expect(
      guard.mediate({
        threadId: 't1',
        orgAlias: 'dev',
        orgKind: 'sandbox',
        summary: 'read'
      })
    ).resolves.toEqual({ approved: true, reason: 'submitted' });
  });

  it('prompts production reads and reuses the session envelope', async () => {
    let prompts = 0;
    const guard = new Guardrail(async () => {
      prompts += 1;
      return { approved: true, reason: 'submitted' };
    });
    const request = {
      threadId: 't1',
      orgAlias: 'prod',
      orgId: '00Dxx',
      orgKind: 'production' as const,
      summary: 'read'
    };
    await expect(guard.mediate(request)).resolves.toMatchObject({ approved: true });
    await expect(guard.mediate(request)).resolves.toMatchObject({ approved: true });
    expect(prompts).toBe(1);
    expect(sessionKey('t1', { kind: 'org.production.read', orgAlias: 'prod', orgId: '00Dxx', orgKind: 'production', summary: '' })).toContain('org.production.read');
  });

  it('always prompts Agent Script publish and activate', async () => {
    let prompts = 0;
    const guard = new Guardrail(async () => {
      prompts += 1;
      return { approved: true, reason: 'submitted' };
    });
    const publish = {
      threadId: 't1',
      orgAlias: 'dev',
      orgId: '00D',
      orgKind: 'sandbox' as const,
      kind: 'agent.publish' as const,
      summary: 'publish'
    };
    await expect(guard.mediate(publish)).resolves.toMatchObject({ approved: true });
    await expect(guard.mediate(publish)).resolves.toMatchObject({ approved: true });
    await expect(
      guard.mediate({ ...publish, kind: 'agent.activate', summary: 'activate' })
    ).resolves.toMatchObject({ approved: true });
    expect(prompts).toBe(3);
  });

  it('names every guardrail envelope and can clear a thread session', async () => {
    const guard = new Guardrail(async () => ({ approved: true, reason: 'submitted' }));
    await guard.mediate({
      threadId: 't1',
      orgAlias: 'prod',
      orgId: '00D',
      orgKind: 'production',
      summary: 'read'
    });
    guard.clearThread('t1');
    let prompts = 0;
    const again = new Guardrail(async () => {
      prompts += 1;
      return { approved: true, reason: 'submitted' };
    });
    await again.mediate({
      threadId: 't2',
      orgAlias: 'prod',
      orgKind: 'production',
      summary: 'read'
    });
    expect(prompts).toBe(1);
    expect(envelopeTitle('org.production.read')).toMatch(/production/);
    expect(envelopeTitle('org.unknown.read')).toMatch(/unknown/);
    expect(envelopeTitle('soql.unbounded')).toMatch(/unbounded/);
    expect(envelopeTitle('soql.export')).toMatch(/export/);
    expect(envelopeTitle('apex.anonymous')).toMatch(/anonymous/);
    expect(envelopeTitle('agent.publish')).toMatch(/publish/);
    expect(envelopeTitle('agent.activate')).toMatch(/activate/);
    expect(envelopeTitle('not-a-kind' as 'soql.export')).toMatch(/Salesforce/);
  });

  it('treats cancel as refusal', async () => {
    const guard = new Guardrail(async () => ({ approved: false, reason: 'cancelled' }));
    await expect(
      guard.mediate({
        threadId: 't1',
        orgAlias: 'prod',
        orgKind: 'unknown',
        summary: 'read'
      })
    ).resolves.toEqual({ approved: false, reason: 'cancelled' });
  });
});
