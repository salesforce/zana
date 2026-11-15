import { expect, it } from 'vitest';
import { createClaudeDeltaHarness, loadFixture } from './delta-test-harness.js';
const threadId = 'consumption';
function setup() {
  const h = createClaudeDeltaHarness();
  const input = (id: string) => { h.translator.trackPushedPrompt(threadId, id); h.acceptInput(id, threadId); };
  const result = (data: Record<string, unknown> = {}) => h.translate({jsonrpc:'2.0',method:'sdk/message',params:{threadId,message:{...loadFixture('result-success.json'),...data}}},{threadId});
  const completed = (data: Record<string, unknown> = {}) => result(data).filter(e => e.type === 'turn/completed');
  return {h, input, result, completed};
}
it('keeps a late steer in the same turn until consumed', () => {
  const h=setup(); h.input('first'); h.input('steer');
  expect(h.completed({user_message_uuids:['first']})).toEqual([]);
  expect(h.completed({user_message_uuids:['steer']})).toHaveLength(1);
  h.input('next'); expect(h.completed({user_message_uuids:['next']})).toHaveLength(1);
});
it('settles folded steers and older CLI results', () => {
  const h=setup(); h.input('first'); h.input('steer');
  expect(h.completed({user_message_uuids:['first','steer']})).toHaveLength(1);
  h.input('old'); h.input('old-steer'); expect(h.completed()).toHaveLength(1);
});
it('holds a task-notification result without discarding the human ledger', () => {
  const h=setup(); h.input('first'); h.input('steer');
  expect(h.completed({user_message_uuids:['first']})).toEqual([]);
  expect(h.completed({origin:{kind:'task-notification'}})).toEqual([]);
  expect(h.completed({user_message_uuids:['steer']})).toHaveLength(1);
});
it('fails promptly with pending steers and clears the ledger', () => {
  const h=setup(); h.input('first'); h.input('steer');
  expect(h.completed({user_message_uuids:[],is_error:true,subtype:'error_during_execution'})).toHaveLength(1);
  h.input('recovered'); expect(h.completed({user_message_uuids:['recovered']})).toHaveLength(1);
});
