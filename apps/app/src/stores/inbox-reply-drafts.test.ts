import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_REPLY_DRAFTS, composeSeqFor, useInboxReplyDrafts } from './inbox-reply-drafts.js';

const s = () => useInboxReplyDrafts.getState();

describe('useInboxReplyDrafts', () => {
  beforeEach(() => {
    useInboxReplyDrafts.setState({ drafts: {}, order: [], composeRequest: null });
  });

  it('stores and deletes drafts; blank text deletes', () => {
    s().setDraft('a', 'hello');
    expect(s().drafts.a).toBe('hello');
    s().setDraft('a', '   ');
    expect('a' in s().drafts).toBe(false);
    expect(s().order).toEqual([]);
  });

  it('clearDraft removes a draft and tolerates unknown ids', () => {
    s().setDraft('a', 'x');
    s().clearDraft('a');
    s().clearDraft('missing');
    expect(s().drafts).toEqual({});
    expect(s().order).toEqual([]);
  });

  it('evicts the least recently written draft past the cap', () => {
    for (let i = 0; i < MAX_REPLY_DRAFTS; i++) s().setDraft(`id${i}`, 'x');
    s().setDraft('id0', 'refreshed');
    s().setDraft('new', 'x');
    expect(Object.keys(s().drafts)).toHaveLength(MAX_REPLY_DRAFTS);
    expect('id1' in s().drafts).toBe(false);
    expect(s().drafts.id0).toBe('refreshed');
    expect(s().drafts.new).toBe('x');
  });

  it('requestCompose keeps one request, so the state stays bounded', () => {
    s().requestCompose('a');
    s().requestCompose('a');
    expect(composeSeqFor('a')(s())).toBe(2);
    for (let i = 0; i < MAX_REPLY_DRAFTS + 10; i++) s().requestCompose(`e${i}`);
    expect(composeSeqFor('a')(s())).toBe(0);
    expect(composeSeqFor(`e${MAX_REPLY_DRAFTS + 9}`)(s())).toBe(MAX_REPLY_DRAFTS + 12);
    expect(Object.keys(s().composeRequest ?? {})).toEqual(['entryId', 'seq']);
  });

  it('appendQuote updates the draft and requests compose', () => {
    s().setDraft('a', 'note ');
    s().appendQuote('a', 'q');
    expect(s().drafts.a).toBe('note\n\n> q\n- ');
    expect(composeSeqFor('a')(s())).toBe(1);
  });

  it('appendQuote with an empty selection still requests compose', () => {
    s().appendQuote('a', ' ');
    expect(s().drafts.a).toBeUndefined();
    expect(composeSeqFor('a')(s())).toBe(1);
  });
});
