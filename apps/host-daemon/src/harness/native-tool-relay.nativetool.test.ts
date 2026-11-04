import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { NATIVE_TOOL_RELAY_UNREACHABLE, nativeToolRelayTail } from './native-tool-relay.js';

const run = (out: string, status: number) =>
  execFileSync('sh', ['-c', nativeToolRelayTail()], { env: { OUT: out, STATUS: String(status), PATH: process.env.PATH ?? '' } }).toString().trimEnd();
const reply = (decision: string, reason: string) =>
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"${decision}","permissionDecisionReason":"${reason}"}}`;

it('prints the unreachable deny when curl --fail exits non-zero (proxy 403/429/transport failure)', () => {
  expect(run('', 22)).toBe(NATIVE_TOOL_RELAY_UNREACHABLE);
});

it('prints nothing for a real allow reply', () => {
  expect(run(reply('allow', 'allowed'), 0)).toBe('');
});

it('relays a real deny reply with its own reason', () => {
  const deny = reply('deny', 'blocked by plugin');
  expect(run(deny, 0)).toBe(deny);
});

it('treats a clean exit with a malformed body as unreachable', () => {
  expect(run('not json', 0)).toBe(NATIVE_TOOL_RELAY_UNREACHABLE);
});
