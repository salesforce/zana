import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';
import { registerApiErrorResumeIpc } from './api-error-resume.js';

const handlers = new Map<string, { handler: (...a: any[]) => any; onError: () => any }>();
const check = vi.fn(async () => ({ ruleId: 'r1', skipped: [] }));
beforeEach(() => {
  handlers.clear(); check.mockClear();
  bindIpcCtx({
    safeHandle: (channel: string, handler: never, onError: never) => handlers.set(channel, { handler, onError }),
    apiErrorResume: { check }
  } as never);
  registerApiErrorResumeIpc();
});
const call = (input: unknown) => handlers.get(IPC.apiErrorResume.check)!.handler(input);
const rule = (o: object) => ({ id: 'a', match: 'overloaded', matchMode: 'contains', message: 'continue', delaySeconds: 20, enabled: true, ...o });

it('rejects invalid input without calling the service', async () => {
  for (const bad of [undefined, null, {}, { text: 5 }]) expect(await call(bad)).toEqual({ ruleId: null, skipped: [] });
  expect(check).not.toHaveBeenCalled();
  expect(handlers.get(IPC.apiErrorResume.check)!.onError()).toEqual({ ruleId: null, skipped: [] });
});
it('drops invalid regex rules and passes normalised rules', async () => {
  await call({ text: 'x', rules: [rule({ id: 'bad', match: '(oops', matchMode: 'regex' }), rule({ id: 'ok', delaySeconds: 1 }), 'junk'] });
  const [, rules] = check.mock.calls[0] as unknown as [string, { id: string; delaySeconds: number }[]];
  expect(rules.map(r => r.id)).toEqual(['ok']);
  expect(rules[0].delaySeconds).toBe(5);
});
it('treats non-array rules as empty and cuts long text', async () => {
  await call({ text: 'y'.repeat(9000), rules: 'nope' });
  const [text, rules] = check.mock.calls[0] as unknown as [string, unknown[]];
  expect(text).toHaveLength(8192);
  expect(rules).toEqual([]);
});
