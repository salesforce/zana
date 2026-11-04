import { expect, it, vi } from 'vitest';
import {
  addThreadContext,
  registerThreadContextTarget,
} from './thread-context-target.js';
it('inserts only into one mounted owning thread and releases on shutdown', () => {
  const ref = { version: 1 as const, label: 'Log', text: 'exact' };
  const insert = vi.fn(() => true),
    other = vi.fn(() => true);
  expect(addThreadContext('a', ref)).toBe(false);
  const release = registerThreadContextTarget('a', insert),
    releaseOther = registerThreadContextTarget('b', other);
  expect(addThreadContext('a', ref)).toBe(true);
  expect(other).not.toHaveBeenCalled();
  expect(addThreadContext(null, ref)).toBe(false);
  expect(addThreadContext('a', { ...ref, version: 2 } as never)).toBe(false);
  const ambiguous = registerThreadContextTarget('a', other);
  expect(addThreadContext('a', ref)).toBe(false);
  ambiguous();
  expect(addThreadContext('a', ref)).toBe(true);
  release();
  releaseOther();
  expect(addThreadContext('a', ref)).toBe(false);
});

it('updates only the owned composer and cleans submission subscriptions', async () => {
  const {
    registerThreadContextControls,
    updateThreadContext,
    focusThreadComposer,
    onThreadSubmitted,
    notifyThreadSubmitted,
  } = await import('./thread-context-target.js');
  const update = vi.fn(() => true),
    focus = vi.fn(),
    submitted = vi.fn();
  const stop = registerThreadContextControls('owned', { update, focus });
  expect(updateThreadContext('owned', 'plugin', 'id', null)).toBe(false);
  const unregister = registerThreadContextTarget('owned', () => true);
  expect(updateThreadContext('owned', 'plugin', 'id', null)).toBe(true);
  focusThreadComposer('owned');
  expect(focus).toHaveBeenCalledOnce();
  const unsubscribe = onThreadSubmitted('owned', submitted);
  notifyThreadSubmitted('other');
  expect(submitted).not.toHaveBeenCalled();
  notifyThreadSubmitted('owned');
  expect(submitted).toHaveBeenCalledOnce();
  unsubscribe();
  notifyThreadSubmitted('owned');
  expect(submitted).toHaveBeenCalledOnce();
  unregister();
  stop();
  expect(updateThreadContext('owned', 'plugin', 'id', null)).toBe(false);
});
it('isolates a throwing plugin observer from accepted submissions', async () => {
  const { onThreadSubmitted, notifyThreadSubmitted } = await import(
    './thread-context-target.js'
  );
  const off = onThreadSubmitted('accepted', () => {
    throw Error('plugin failure');
  });
  const seen = vi.fn();
  const stop = onThreadSubmitted('accepted', seen);
  expect(() => notifyThreadSubmitted('accepted')).not.toThrow();
  expect(seen).toHaveBeenCalledOnce();
  off();
  stop();
});

it('rejects malformed updates and does not let stale controls remove the replacement',async()=>{
 const {registerThreadContextControls,updateThreadContext,focusThreadComposer}=await import('./thread-context-target.js');
 const release=registerThreadContextTarget('replacement',()=>true);
 expect(updateThreadContext('replacement','p','r',null)).toBe(false);
 focusThreadComposer('replacement');focusThreadComposer('absent');
 const old=registerThreadContextControls('replacement',{update:()=>false,focus:()=>{}});
 const update=vi.fn(()=>true);const stop=registerThreadContextControls('replacement',{update,focus:()=>{}});
 old();expect(updateThreadContext('replacement','p','r',{version:2} as never)).toBe(false);
 expect(updateThreadContext('replacement','p','r',null)).toBe(true);expect(update).toHaveBeenCalledOnce();
 stop();release();
});
