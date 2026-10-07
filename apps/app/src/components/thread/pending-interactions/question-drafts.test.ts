// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const questions = [{ id: 'q', prompt: 'Pick', allowFreeText: true, multiSelect: false, options: [{ label: 'A', value: 'a' }] }];
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.resetModules(); });
describe('question drafts', () => {
  it('restores exact free text and selections after reload, scoped to the interaction', async () => {
    const mod = await import('./question-drafts.js');
    const key = mod.questionDraftKey('thread', 'interaction');
    const draft = { ...mod.loadQuestionDraft(key, questions), answers: { q: { selected: ['a'], otherSelected: true, freeText: '  exact\ntext  ' } } };
    mod.saveQuestionDraft(key, draft);
    vi.resetModules();
    const reloaded = await import('./question-drafts.js');
    expect(reloaded.loadQuestionDraft(key, questions)).toEqual(draft);
    expect(reloaded.loadQuestionDraft(reloaded.questionDraftKey('other', 'interaction'), questions).answers.q.selected).toEqual([]);
    expect(reloaded.loadQuestionDraft(key, [{ ...questions[0], prompt: 'changed' }]).answers.q.selected).toEqual([]);
  });
  it('keeps a newer edit when an earlier submit succeeds', async () => {
    const mod = await import('./question-drafts.js');
    const old = mod.loadQuestionDraft('key', questions);
    mod.saveQuestionDraft('key', old);
    const newer = { ...old, answers: { q: { selected: ['a'], otherSelected: false } } };
    mod.saveQuestionDraft('key', newer);
    mod.clearQuestionDraft('key', old);
    expect(mod.loadQuestionDraft('key', questions)).toEqual(newer);
    mod.clearQuestionDraft('key', newer);
    expect(mod.loadQuestionDraft('key', questions)).toEqual(old);
  });
  it('survives blocked storage and does not resurrect a cleared draft', async () => {
    const mod = await import('./question-drafts.js');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const draft = { ...mod.loadQuestionDraft('key', questions), answers: { q: { selected: ['a'], otherSelected: false } } };
    mod.saveQuestionDraft('key', draft);
    expect(mod.loadQuestionDraft('key', questions)).toEqual(draft);
    mod.clearQuestionDraft('key', draft);
    expect(mod.loadQuestionDraft('key', questions).answers.q.selected).toEqual([]);
  });
  it.each(['broken', JSON.stringify([['key', { signature: JSON.stringify(questions), index: 0, answers: { q: { selected: ['unknown'], otherSelected: false } } }]]), JSON.stringify([['key', { signature: JSON.stringify(questions), index: '0', answers: {} }]])])('ignores corrupt or invalid storage (%s)', async raw => {
    localStorage.setItem('zcc:question-drafts:v1', raw);
    const mod = await import('./question-drafts.js');
    expect(mod.loadQuestionDraft('key', questions).answers.q.selected).toEqual([]);
  });
  it('bounds retention by count and serialized size', async () => {
    const mod = await import('./question-drafts.js');
    for (let n = 0; n < 45; n++) mod.saveQuestionDraft(String(n), { ...mod.loadQuestionDraft(String(n), questions), answers: { q: { selected: [], otherSelected: true, freeText: 'x'.repeat(32_000) } } });
    const raw = localStorage.getItem('zcc:question-drafts:v1')!;
    expect(raw.length).toBeLessThanOrEqual(256_000);
    expect(JSON.parse(raw).length).toBeLessThanOrEqual(40);
    expect(mod.loadQuestionDraft('0', questions).answers.q.freeText).toBe('');
  });
});
