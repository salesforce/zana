import { describe, expect, it } from 'vitest';
import {
  formatGithubMentionContext,
  githubMentionFallbackItems,
  githubMentionItemsFromList,
  parseGithubMentionId
} from '../mentions.mjs';

describe('github mention helpers', () => {
  it('parses owner/repo#number and fallback numbers', () => {
    expect(parseGithubMentionId('acme/app#12')).toEqual({ repo: 'acme/app', number: 12 });
    expect(parseGithubMentionId('#9', 'acme/app')).toEqual({ repo: 'acme/app', number: 9 });
    expect(parseGithubMentionId('nope')).toBeNull();
  });

  it('filters cached list entries and falls back to a typed number', () => {
    expect(githubMentionItemsFromList('issue', 'login', 'acme/app', [
      { number: 1, title: 'Fix login' },
      { number: 2, title: 'Unrelated' }
    ])).toEqual([
      {
        id: 'acme/app#1',
        label: 'Issue acme/app#1: Fix login',
        insertText: '@acme/app#1'
      }
    ]);
    expect(githubMentionFallbackItems('pr', '44', 'acme/app')).toEqual([
      { id: 'acme/app#44', label: 'PR acme/app#44', insertText: '@acme/app#44' }
    ]);
    expect(githubMentionFallbackItems('issue', 'nope', 'acme/app')).toEqual([]);
  });

  it('formats resolve context with title or a load error', () => {
    expect(formatGithubMentionContext({
      kind: 'issue',
      repo: 'acme/app',
      number: 1,
      title: 'Fix login',
      state: 'OPEN',
      author: 'ada',
      url: 'https://example.test/1',
      body: 'Steps'
    })).toContain('Fix login');
    expect(formatGithubMentionContext({
      kind: 'pr',
      repo: 'acme/app',
      number: 2,
      detailError: 'gh missing'
    })).toContain('gh pr view 2 -R acme/app');
  });
});
