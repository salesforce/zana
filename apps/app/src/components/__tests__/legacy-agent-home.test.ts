import { describe, expect, it } from 'vitest';
import {
  absolutePathMentions,
  assembleCliLaunchPrompt,
  availableAgentHarnesses,
  familyForThreadProviderId,
  PROFILE_BY_FAMILY,
  rewritePromptPaths,
  threadProviderIdForFamily
} from '../legacy-agent-home.js';

describe('availableAgentHarnesses', () => {
  it('keeps only enabled, installed, agent-eligible adapters', () => {
    expect(availableAgentHarnesses([
      { id: 'claude', agentDefaultEligible: true, availability: { enabled: true, installed: true } },
      { id: 'cursor', agentDefaultEligible: false, availability: { enabled: true, installed: true } },
      { id: 'codex', agentDefaultEligible: true, availability: { enabled: false, installed: true } },
      { id: 'pi', agentDefaultEligible: true, availability: { enabled: true, installed: false } }
    ]).map((row) => row.id)).toEqual(['claude']);
  });
});

describe('PROFILE_BY_FAMILY', () => {
  it('maps every harness family to its default launch profile', () => {
    expect(PROFILE_BY_FAMILY).toEqual({
      claude: 'claude',
      cursor: 'cursor',
      codex: 'codex',
      pi: 'pi',
      opencode: 'opencode'
    });
  });
});

describe('thread provider id mapping', () => {
  it('maps PTY families onto thread provider ids for the shared picker icons', () => {
    expect(threadProviderIdForFamily('claude')).toBe('claude-code');
    expect(threadProviderIdForFamily('cursor')).toBe('acp-cursor');
    expect(threadProviderIdForFamily('opencode')).toBe('acp-opencode');
    expect(threadProviderIdForFamily('codex')).toBe('codex');
    expect(threadProviderIdForFamily('pi')).toBe('pi');
    expect(threadProviderIdForFamily('shell')).toBeNull();
    expect(familyForThreadProviderId('claude-code')).toBe('claude');
    expect(familyForThreadProviderId('acp-cursor')).toBe('cursor');
    expect(familyForThreadProviderId('acp-opencode')).toBe('opencode');
    expect(familyForThreadProviderId('codex')).toBe('codex');
    expect(familyForThreadProviderId('unknown')).toBeNull();
  });
});

describe('CLI launch prompt from mention pills', () => {
  it('collects unique absolute path mentions for remote upload', () => {
    expect(absolutePathMentions([
      { start: 0, end: 12, resource: { kind: 'path', source: 'workspace', entryKind: 'file', path: '/Users/me/a.ts', label: 'a.ts' } },
      { start: 13, end: 24, resource: { kind: 'path', source: 'workspace', entryKind: 'file', path: 'src/foo.ts', label: 'foo.ts' } },
      { start: 25, end: 37, resource: { kind: 'path', source: 'workspace', entryKind: 'file', path: '/Users/me/a.ts', label: 'a.ts' } },
      { start: 38, end: 44, resource: { kind: 'thread', threadId: 't1', projectId: 'p1', label: 'Work' } }
    ])).toEqual(['/Users/me/a.ts']);
  });

  it('rewrites uploaded absolute mentions and joins image paths', () => {
    expect(rewritePromptPaths('See @/Users/me/a.ts please', [
      { from: '/Users/me/a.ts', to: '/remote/a.ts' }
    ])).toBe('See @/remote/a.ts please');
    expect(assembleCliLaunchPrompt({ text: '  ship it  ', imagePaths: ['shots/a.png'] })).toBe('ship it\n@shots/a.png');
    expect(assembleCliLaunchPrompt({ text: '   ' })).toBe('');
  });
});
