/** @vitest-environment happy-dom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { agentDraftKey, clearAgentDraft, readAgentDraft, writeAgentDraft, rememberAgentSelection, recalledAgentSelection } from './agent-script-drafts.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe('Agentforce draft recovery', () => {
  it('isolates files, examples and projects and preserves the original revision', () => {
    const key = agentDraftKey('project-a', 'file:Bot.agent');
    writeAgentDraft({ key, content: 'edited', baseSha: 'original', dialect: 'agentforce' });
    expect(readAgentDraft(key)).toMatchObject({ content: 'edited', baseSha: 'original' });
    expect(readAgentDraft(agentDraftKey('project-b', 'file:Bot.agent'))).toBeUndefined();
    expect(readAgentDraft(agentDraftKey('project-a', 'example:Bot.agent'))).toBeUndefined();
    clearAgentDraft(key);
    expect(readAgentDraft(key)).toBeUndefined();
  });
  it('bounds storage without silently truncating a large draft', () => {
    for (let i = 0; i < 13; i++) writeAgentDraft({ key: String(i), content: 'source', dialect: 'agentscript' });
    expect(readAgentDraft('0')).toBeUndefined();
    expect(readAgentDraft('12')).toBeDefined();
    expect(writeAgentDraft({ key: 'large', content: 'x'.repeat(180001), dialect: 'agentforce' })).toBe(false);
    expect(readAgentDraft('large')).toBeUndefined();
  });
  it('handles corrupt/unavailable storage and remembers a bounded project selection', () => {
    localStorage.setItem('salesforce.agent-drafts.v1', '{broken');
    expect(readAgentDraft('key')).toBeUndefined();
    localStorage.setItem('salesforce.agent-drafts.v1', JSON.stringify([null, { key: 'bad', content: 42 }]));
    expect(readAgentDraft('bad')).toBeUndefined();
    rememberAgentSelection('p', 'example:minimal');
    rememberAgentSelection('p', 'file:Saved.agent');
    expect(recalledAgentSelection('p')).toBe('file:Saved.agent');
    localStorage.setItem('salesforce.agent-selections.v1', '{bad');
    expect(recalledAgentSelection('p')).toBeUndefined();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('Quota'); });
    expect(writeAgentDraft({ key: 'a', content: 'source', dialect: 'agentforce' })).toBe(false);
    expect(() => { clearAgentDraft('a'); rememberAgentSelection('p', 'file:x'); }).not.toThrow();
  });
});
