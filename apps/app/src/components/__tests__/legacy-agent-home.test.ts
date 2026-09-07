import { describe, expect, it } from 'vitest';
import {
  absolutePathMentions,
  assembleCliLaunchPrompt,
  availableAgentHarnesses,
  cliAgentCatalogProviders,
  cliAgentFamilyIdsFromCatalog,
  cliAgentModelOptions,
  cliAgentMoreModelOptions,
  familyForThreadProviderId,
  PROFILE_BY_FAMILY,
  resolveCliAgentFamily,
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

describe('resolveCliAgentFamily', () => {
  it('keeps the current family when it is still installed', () => {
    expect(resolveCliAgentFamily({
      currentFamilyId: 'codex',
      availableFamilyIds: ['claude', 'codex'],
      rememberedFamilyId: 'pi',
      effectiveDefaultFamilyId: 'claude'
    })).toBe('codex');
  });

  it('restores the last-used family when the current pick is empty or gone', () => {
    expect(resolveCliAgentFamily({
      currentFamilyId: '',
      availableFamilyIds: ['claude', 'codex'],
      rememberedFamilyId: 'codex',
      effectiveDefaultFamilyId: 'claude'
    })).toBe('codex');
    expect(resolveCliAgentFamily({
      currentFamilyId: 'pi',
      availableFamilyIds: ['claude', 'codex'],
      rememberedFamilyId: 'codex',
      effectiveDefaultFamilyId: 'claude'
    })).toBe('codex');
  });

  it('falls through to the configured default when nothing remembered is available', () => {
    expect(resolveCliAgentFamily({
      currentFamilyId: '',
      availableFamilyIds: ['claude', 'codex'],
      rememberedFamilyId: 'pi',
      effectiveDefaultFamilyId: 'claude'
    })).toBe('claude');
  });

  it('keeps current then remembered before descriptors arrive', () => {
    expect(resolveCliAgentFamily({
      currentFamilyId: 'codex',
      availableFamilyIds: [],
      rememberedFamilyId: 'pi',
      effectiveDefaultFamilyId: 'claude'
    })).toBe('codex');
    expect(resolveCliAgentFamily({
      currentFamilyId: '',
      availableFamilyIds: [],
      rememberedFamilyId: 'pi',
      effectiveDefaultFamilyId: 'claude'
    })).toBe('pi');
  });
});

describe('cliAgentModelOptions', () => {
  it('keeps a trusted PTY adapter catalog when the adapter lists models', () => {
    expect(cliAgentModelOptions({
      adapterModels: [{ id: 'sonnet', label: 'Sonnet (latest)' }],
      catalogModels: [{ model: 'claude-sonnet-5', displayName: 'Sonnet 5' }]
    })).toEqual([{ id: 'sonnet', label: 'Sonnet (latest)' }]);
  });

  it('uses the live thread catalog when the adapter has no models (Pi)', () => {
    expect(cliAgentModelOptions({
      adapterModels: [],
      catalogModels: [
        { model: 'openai/gpt-5.2', displayName: 'GPT-5.2' },
        { model: 'anthropic/claude-opus-4-8', displayName: 'Opus 4.8' }
      ]
    })).toEqual([
      { id: 'openai/gpt-5.2', label: 'GPT-5.2' },
      { id: 'anthropic/claude-opus-4-8', label: 'Opus 4.8' }
    ]);
  });

  it('prefers the host catalog once it is ready, including an empty list', () => {
    expect(cliAgentModelOptions({
      adapterModels: [{ id: 'sonnet', label: 'Sonnet (latest)' }],
      catalogModels: [{ model: 'claude-sonnet-5', displayName: 'Sonnet 5' }],
      preferCatalog: true,
      catalogReady: true
    })).toEqual([{ id: 'claude-sonnet-5', label: 'Sonnet 5' }]);
    expect(cliAgentModelOptions({
      adapterModels: [{ id: 'sonnet', label: 'Sonnet (latest)' }],
      catalogModels: [],
      preferCatalog: true,
      catalogReady: true
    })).toEqual([]);
  });

  it('keeps the adapter catalog as a placeholder until the host list loads', () => {
    expect(cliAgentModelOptions({
      adapterModels: [{ id: 'sonnet', label: 'Sonnet (latest)' }],
      catalogModels: [],
      preferCatalog: true,
      catalogReady: false
    })).toEqual([{ id: 'sonnet', label: 'Sonnet (latest)' }]);
  });
});

describe('cliAgentMoreModelOptions', () => {
  it('hides more-models when the adapter catalog is the source of truth', () => {
    expect(cliAgentMoreModelOptions({
      adapterModelCount: 2,
      catalogMoreModels: [{ model: 'opus', displayName: 'Opus' }],
      preferCatalog: false
    })).toEqual([]);
  });

  it('surfaces host more-models when preferring the live catalog', () => {
    expect(cliAgentMoreModelOptions({
      adapterModelCount: 2,
      catalogMoreModels: [{ model: 'opus', displayName: 'Opus' }],
      preferCatalog: true
    })).toEqual([{ value: 'opus', label: 'Opus' }]);
  });
});

describe('cliAgentCatalogProviders', () => {
  it('keeps only PTY-mapped host providers and drops thread-only ids', () => {
    expect(cliAgentCatalogProviders([
      { id: 'claude-code', displayName: 'Claude Code' },
      { id: 'codex', displayName: 'Codex' },
      { id: 'fake', displayName: 'Fake' },
      { id: 'acp-opencode', displayName: 'OpenCode' }
    ])).toEqual([
      { id: 'claude-code', displayName: 'Claude Code', permissionModes: [], composerActions: [] },
      { id: 'codex', displayName: 'Codex', permissionModes: [], composerActions: [] },
      { id: 'acp-opencode', displayName: 'OpenCode', permissionModes: [], composerActions: [] }
    ]);
    expect(cliAgentFamilyIdsFromCatalog([
      { id: 'claude-code' },
      { id: 'fake' },
      { id: 'pi' }
    ])).toEqual(['claude', 'pi']);
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
