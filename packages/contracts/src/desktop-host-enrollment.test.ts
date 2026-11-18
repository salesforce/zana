import { expect, it } from 'vitest';
import { DesktopHostEnrollmentSchema } from './runtime.js';

const evidence = { serverInstanceId: '33333333-3333-4333-8333-333333333333', serverUrl: 'http://127.0.0.1:41234/', host: null };
it('accepts only a direct desktop loopback listener with a persistent identity', () => {
  expect(DesktopHostEnrollmentSchema.safeParse(evidence).success).toBe(true);
  expect(DesktopHostEnrollmentSchema.safeParse({ ...evidence, serverInstanceId: 'invalid' }).success).toBe(false);
});
it.each(['https://127.0.0.1:41234/', 'http://example.com/', 'http://localhost:41234/',
  'http://user@127.0.0.1:41234/', 'http://user:pass@127.0.0.1:41234/', 'http://127.0.0.1:41234/other',
  'http://127.0.0.1:41234/?token=secret', 'http://127.0.0.1:41234/#other', 'invalid'])(
  'rejects untrusted desktop evidence address %s', serverUrl => {
    expect(DesktopHostEnrollmentSchema.safeParse({ ...evidence, serverUrl }).success).toBe(false);
  }
);
