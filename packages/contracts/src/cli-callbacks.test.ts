import { expect, it } from 'vitest';
import { CliCallbackControlSchema, CliCallbackGrantSchema, CliCallbackRequestSchema, CliCallbackResponseSchema, cliCallbackPaths, isCliNativeToolPath } from './cli-callbacks.js';
import { ServerRuntimeRequestSchema, SERVER_RUNTIME_PROTOCOL_VERSION } from './runtime.js';
const grant = { projectId: 'project', sessionId: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) };
it('confines grants to one project/session with no signing key, host override or callback destination', () => {
  expect(cliCallbackPaths(grant).size).toBe(14);
  for (const extra of [{ hostId: 'other' }, { signingKey: 'private' }, { baseUrl: 'http://elsewhere' }]) expect(CliCallbackGrantSchema.safeParse({ ...grant, ...extra }).success).toBe(false);
  expect(CliCallbackControlSchema.safeParse({ action: 'revoke', sessionId: grant.sessionId }).success).toBe(true);
  expect(CliCallbackControlSchema.safeParse({ action: 'revoke', sessionId: grant.sessionId, grant }).success).toBe(false);
  const command = { type: 'request', id: grant.sessionId, deadlineAt: '2026-09-29T10:00:00.000Z', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, operation: 'cli-callback-grant', request: { action: 'register', grant } };
  expect(ServerRuntimeRequestSchema.safeParse(command).success).toBe(true);
  expect(ServerRuntimeRequestSchema.safeParse({ ...command, protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION - 1 }).success).toBe(false);
});
it('bounds and closes the HTTP envelope in both directions', () => {
  const request = { sessionId: grant.sessionId, path: [...cliCallbackPaths(grant)][0], headers: { accept: 'application/json' }, bodyBase64: '' };
  expect(CliCallbackRequestSchema.safeParse(request).success).toBe(true);
  for (const patch of [{ bodyBase64: 'not base64' }, { headers: { authorization: 'private' } }, { headers: { accept: 'line\nbreak' } }, { destination: 'http://elsewhere' }]) expect(CliCallbackRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false);
  expect(CliCallbackResponseSchema.safeParse({ status: 200, bodyBase64: 'e30=' }).success).toBe(true);
  for (const patch of [{ status: 101 }, { location: 'http://elsewhere' }, { contentType: 'text/plain\rinject' }]) expect(CliCallbackResponseSchema.safeParse({ status: 200, bodyBase64: '', ...patch }).success).toBe(false);
});
it('grants the native tool hook path to its own session only', () => {
  const other = { ...grant, sessionId: '22222222-2222-4222-8222-222222222222' };
  const own = `/hook/nativetool/${grant.projectId}/${grant.sessionId}`;
  expect(cliCallbackPaths(grant).has(own)).toBe(true);
  expect(cliCallbackPaths(other).has(own)).toBe(false);
  expect(isCliNativeToolPath(own)).toBe(true);
  expect(isCliNativeToolPath(`/hook/stop/${grant.projectId}/${grant.sessionId}`)).toBe(false);
});
