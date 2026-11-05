import { describe, expect, it, vi } from 'vitest';
import { createNativeToolPolicyVerifier } from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import { DISPATCH_ADMISSION_MAIN_PROMPT_MAX_CHARS } from '@zana-ai/zcc-contracts/runtime';
import {
  boundedAdmissionPrompt,
  createMainDispatchAdmission,
  dispatchEntryForPrincipal,
  dispatchOriginForPrincipal,
  productRouteDispatchAdmissionDecider
} from './dispatch-admission.js';

const request = { projectId: 'p1', sessionId: 's1', entry: 'reply', origin: 'user' } as const;

function admission(over: { supervised?: any; productRoute?: any } = {}) {
  const log = vi.fn();
  const admit = createMainDispatchAdmission({
    supervised: () => over.supervised ?? null,
    productRoute: () => over.productRoute ?? null,
    log
  });
  return { admit, log };
}

describe('prompt text for admission', () => {
  it('bounds the text main sends and flags the cut', () => {
    expect(boundedAdmissionPrompt(undefined)).toBeUndefined();
    expect(boundedAdmissionPrompt('')).toBeUndefined();
    expect(boundedAdmissionPrompt('hi')).toEqual({ text: 'hi' });
    const cut = boundedAdmissionPrompt('a'.repeat(DISPATCH_ADMISSION_MAIN_PROMPT_MAX_CHARS + 5))!;
    expect(cut.text).toHaveLength(DISPATCH_ADMISSION_MAIN_PROMPT_MAX_CHARS);
    expect(cut.truncated).toBe(true);
  });

  it('sends the bounded text with the request and never logs it', async () => {
    const decide = vi.fn(async () => ({ action: 'reject', message: 'no' }));
    const { admit, log } = admission({ supervised: decide });
    await admit({ ...request, promptText: 'SECRET-MARKER' });
    expect(decide).toHaveBeenCalledWith({ ...request, prompt: { text: 'SECRET-MARKER' } });
    expect(decide.mock.calls[0]![0]).not.toHaveProperty('promptText');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-MARKER');
  });

  it('omits the prompt for a dispatch with no text', async () => {
    const decide = vi.fn(async () => ({ action: 'proceed' }));
    await admission({ supervised: decide }).admit(request);
    expect(decide).toHaveBeenCalledWith(request);
  });
});

describe('createMainDispatchAdmission', () => {
  it('proceeds on a proceed decision', async () => {
    const { admit } = admission({ supervised: async () => ({ action: 'proceed' }) });
    await expect(admit(request)).resolves.toBeNull();
  });

  it('turns a reject into a DISPATCH_REJECTED refusal carrying the plugin message', async () => {
    const { admit } = admission({ supervised: async () => ({ action: 'reject', message: 'no' }) });
    await expect(admit(request)).resolves.toEqual({ code: 'DISPATCH_REJECTED', message: 'no' });
  });

  it('refuses a wait, since a PTY cannot hold input', async () => {
    const { admit } = admission({ supervised: async () => ({ action: 'wait', reason: 'busy' }) });
    await expect(admit(request)).resolves.toEqual({ code: 'DISPATCH_WAITING', message: 'busy' });
  });

  it('prefers the supervised channel over the product route', async () => {
    const productRoute = vi.fn(async () => ({ action: 'reject', message: 'route' }));
    const { admit } = admission({ supervised: async () => ({ action: 'proceed' }), productRoute });
    await expect(admit(request)).resolves.toBeNull();
    expect(productRoute).not.toHaveBeenCalled();
  });

  it('falls back to the product route when no supervisor runs', async () => {
    const { admit } = admission({ productRoute: async () => ({ action: 'proceed' }) });
    await expect(admit(request)).resolves.toBeNull();
  });

  it('fails closed with no channel at all', async () => {
    const { admit } = admission();
    await expect(admit(request)).resolves.toMatchObject({ code: 'DISPATCH_REJECTED' });
  });

  it('fails closed and logs when the transport throws', async () => {
    const { admit, log } = admission({ supervised: async () => { throw new Error('boom'); } });
    await expect(admit(request)).resolves.toMatchObject({ code: 'DISPATCH_REJECTED' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it.each([null, {}, { action: 'allow' }, { action: 'reject' }, { action: 'wait', reason: '' }])(
    'fails closed on a malformed decision %j', async bad => {
      const { admit, log } = admission({ supervised: async () => bad });
      await expect(admit(request)).resolves.toMatchObject({ code: 'DISPATCH_REJECTED' });
      expect(log).toHaveBeenCalled();
    });
});

describe('productRouteDispatchAdmissionDecider', () => {
  const credential = 'c'.repeat(64);

  it('posts the request signed with the product credential', async () => {
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ action: 'proceed' }), { status: 200 }));
    const decide = productRouteDispatchAdmissionDecider({ serverUrl: () => 'http://127.0.0.1:1', credential: () => credential, fetch: fetch as never });
    await expect(decide(request)).resolves.toEqual({ action: 'proceed' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.pathname).toBe('/api/v1/dispatch-admission');
    const body = String(init.body);
    expect(JSON.parse(body)).toEqual(request);
    const proof = (init.headers as Record<string, string>)['x-zcc-native-tool-policy-proof']!;
    expect(createNativeToolPolicyVerifier(credential)(proof, body)).toBe(true);
  });

  it('throws on a non-ok response so the caller fails closed', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 403 }));
    const decide = productRouteDispatchAdmissionDecider({ serverUrl: () => 'http://127.0.0.1:1', credential: () => credential, fetch: fetch as never });
    await expect(decide(request)).rejects.toThrow('HTTP 403');
  });
});

describe('principal mapping', () => {
  it('maps who produced the opening text', () => {
    expect(dispatchOriginForPrincipal({ kind: 'interactive-user', id: 'x' })).toBe('user');
    expect(dispatchOriginForPrincipal({ kind: 'control-plane', id: 'control-plane:operator' })).toBe('user');
    expect(dispatchOriginForPrincipal({ kind: 'control-plane', id: 'control-plane:orchestrator:abc' })).toBe('agent');
    expect(dispatchOriginForPrincipal({ kind: 'team', id: 'team:t' })).toBe('system');
  });

  it('routes team slots through the job-team entry', () => {
    expect(dispatchEntryForPrincipal({ kind: 'team' })).toBe('job-team-dispatch');
    expect(dispatchEntryForPrincipal({ kind: 'interactive-user' })).toBe('initial');
  });
});
