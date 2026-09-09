import { describe, expect, it, vi } from 'vitest';
import type { PromptTextMention } from '@zana-ai/zcc-domain/thread-runtime';
import {
  absolutePathMentions,
  applyLaunchPatch,
  assembleCliLaunchPrompt,
  availableAgentHarnesses,
  composerDropProjectRoot,
  cliAgentCatalogProviders,
  cliAgentFamilyIdsFromCatalog,
  cliAgentModelOptions,
  cliAgentMoreModelOptions,
  cliComposerModeChip,
  cliLaunchExecutionState,
  cliLaunchFromPermissionMode,
  cliPermissionModesFor,
  CLI_WORK_MODES,
  familyForThreadProviderId,
  PROFILE_BY_FAMILY,
  readCliExtraArgs,
  resolveCliAgentFamily,
  resolveCliLaunchProfile,
  rewritePromptPaths,
  stageRemoteComposerAttachments,
  type StageRemoteComposerAttachmentsInput,
  threadProviderIdForFamily,
  unrestrictedProfileId,
  withExecutionState,
  writeCliExtraArgs
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

  it('passes catalog permission modes through instead of zeroing them', () => {
    expect(cliAgentCatalogProviders([
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        permissionModes: ['accept-edits', 'auto', 'full'],
        composerActions: ['plan']
      },
      { id: 'fake', displayName: 'Fake', permissionModes: ['full'], composerActions: [] }
    ])).toEqual([
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        permissionModes: ['accept-edits', 'auto', 'full'],
        composerActions: ['plan']
      }
    ]);
  });
});

describe('CLI permission modes', () => {
  it('keeps Claude and Codex modes when an unrestricted profile exists', () => {
    expect(cliPermissionModesFor({
      catalogModes: ['accept-edits', 'auto', 'full'],
      hasUnrestrictedProfile: true
    })).toEqual(['accept-edits', 'auto', 'full']);
  });

  it('drops Full Access without an unrestricted profile', () => {
    expect(cliPermissionModesFor({
      catalogModes: ['accept-edits', 'full'],
      hasUnrestrictedProfile: false
    })).toEqual(['accept-edits']);
    expect(cliPermissionModesFor({
      catalogModes: ['full'],
      hasUnrestrictedProfile: false
    })).toEqual([]);
  });

  it('resolves the unrestricted profile from posture, not a harness id literal', () => {
    expect(unrestrictedProfileId([
      { id: 'codex', posture: 'default' },
      { id: 'codex-yolo', posture: 'unrestricted' }
    ])).toBe('codex-yolo');
    expect(unrestrictedProfileId([{ id: 'pi', posture: 'default' }])).toBeUndefined();
  });

  it('maps Edits / Auto / Full onto PTY spawn knobs', () => {
    expect(cliLaunchFromPermissionMode({ mode: 'accept-edits' })).toEqual({
      executionState: 'accept-edits'
    });
    expect(cliLaunchFromPermissionMode({ mode: 'auto' })).toEqual({});
    expect(cliLaunchFromPermissionMode({
      mode: 'full',
      unrestrictedProfileId: 'cursor-yolo'
    })).toEqual({ profileId: 'cursor-yolo' });
    expect(cliLaunchFromPermissionMode({ mode: 'full' })).toEqual({});
  });

  it('maps every family × offered mode onto spawn knobs, including yolo', () => {
    const rows: ReadonlyArray<{
      family: string;
      mode: string;
      unrestrictedId?: string;
      expected: { profileId?: string; executionState?: 'accept-edits' };
    }> = [
      { family: 'claude', mode: 'accept-edits', unrestrictedId: 'claude-yolo', expected: { executionState: 'accept-edits' } },
      { family: 'claude', mode: 'auto', unrestrictedId: 'claude-yolo', expected: {} },
      { family: 'claude', mode: 'full', unrestrictedId: 'claude-yolo', expected: { profileId: 'claude-yolo' } },
      { family: 'cursor', mode: 'accept-edits', unrestrictedId: 'cursor-yolo', expected: { executionState: 'accept-edits' } },
      { family: 'cursor', mode: 'full', unrestrictedId: 'cursor-yolo', expected: { profileId: 'cursor-yolo' } },
      { family: 'codex', mode: 'accept-edits', unrestrictedId: 'codex-yolo', expected: { executionState: 'accept-edits' } },
      { family: 'codex', mode: 'auto', unrestrictedId: 'codex-yolo', expected: {} },
      { family: 'codex', mode: 'full', unrestrictedId: 'codex-yolo', expected: { profileId: 'codex-yolo' } },
      { family: 'pi', mode: 'full', expected: {} },
      { family: 'opencode', mode: 'accept-edits', unrestrictedId: 'opencode-yolo', expected: { executionState: 'accept-edits' } },
      { family: 'opencode', mode: 'full', unrestrictedId: 'opencode-yolo', expected: { profileId: 'opencode-yolo' } }
    ];
    for (const row of rows) {
      expect(
        cliLaunchFromPermissionMode({
          mode: row.mode,
          unrestrictedProfileId: row.unrestrictedId
        }),
        `${row.family} ${row.mode}`
      ).toEqual(row.expected);
    }
  });

  it('withExecutionState would stack Edits onto a native role — the composer must skip that merge', () => {
    expect(withExecutionState(
      { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'reviewer' } } },
      'opencode',
      'accept-edits'
    )).toEqual({
      schemaVersion: 1,
      byAdapter: { opencode: { roleTargetId: 'reviewer', executionState: 'accept-edits' } }
    });
  });

  it('locks picker modes to each family\'s catalog plus unrestricted posture', () => {
    const families: ReadonlyArray<{
      family: string;
      catalogModes: readonly string[];
      profiles: ReadonlyArray<{ id: string; posture: string }>;
      expectedModes: readonly string[];
      unrestrictedId: string | undefined;
    }> = [
      {
        family: 'claude',
        catalogModes: ['accept-edits', 'auto', 'full'],
        profiles: [
          { id: 'claude', posture: 'default' },
          { id: 'claude-yolo', posture: 'unrestricted' }
        ],
        expectedModes: ['accept-edits', 'auto', 'full'],
        unrestrictedId: 'claude-yolo'
      },
      {
        family: 'cursor',
        catalogModes: ['accept-edits', 'full'],
        profiles: [
          { id: 'cursor', posture: 'default' },
          { id: 'cursor-yolo', posture: 'unrestricted' }
        ],
        expectedModes: ['accept-edits', 'full'],
        unrestrictedId: 'cursor-yolo'
      },
      {
        family: 'codex',
        catalogModes: ['accept-edits', 'auto', 'full'],
        profiles: [
          { id: 'codex', posture: 'default' },
          { id: 'codex-yolo', posture: 'unrestricted' }
        ],
        expectedModes: ['accept-edits', 'auto', 'full'],
        unrestrictedId: 'codex-yolo'
      },
      {
        family: 'pi',
        catalogModes: ['full'],
        profiles: [{ id: 'pi', posture: 'default' }],
        expectedModes: [],
        unrestrictedId: undefined
      },
      {
        family: 'opencode',
        catalogModes: ['accept-edits', 'full'],
        profiles: [
          { id: 'opencode', posture: 'default' },
          { id: 'opencode-yolo', posture: 'unrestricted' }
        ],
        expectedModes: ['accept-edits', 'full'],
        unrestrictedId: 'opencode-yolo'
      }
    ];
    for (const row of families) {
      const unrestrictedId = unrestrictedProfileId(row.profiles);
      expect(unrestrictedId, row.family).toBe(row.unrestrictedId);
      expect(cliPermissionModesFor({
        catalogModes: row.catalogModes,
        hasUnrestrictedProfile: Boolean(unrestrictedId)
      }), row.family).toEqual(row.expectedModes);
      expect(row.expectedModes.length > 1, `${row.family} picker`).toBe(Boolean(row.unrestrictedId));
    }
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

describe('composerDropProjectRoot', () => {
  it('keeps local project paths and skips relativization on SSH remotes', () => {
    expect(composerDropProjectRoot(undefined)).toBeNull();
    expect(composerDropProjectRoot({ path: '/repo' })).toBe('/repo');
    expect(composerDropProjectRoot({ path: '/Users/me/zcc-workspace/remotes/dev', remote: { host: 'devbox' } })).toBeNull();
  });
});

describe('stageRemoteComposerAttachments', () => {
  const pathMention = (path: string): PromptTextMention => ({
    start: 0,
    end: path.length + 1,
    resource: { kind: 'path', source: 'workspace', entryKind: 'file', path, label: path.split('/').pop() ?? path }
  });
  const imageFile = { name: 'shot.png' } as File;

  function stagingDeps(
    overrides: Partial<StageRemoteComposerAttachmentsInput> = {}
  ): StageRemoteComposerAttachmentsInput {
    const uploadLocalPath = vi.fn(async (localPath: string) => ({
      ok: true as const,
      path: `/remote/.zcc-uploads/${localPath.split('/').pop()}`
    }));
    const persistImages = vi.fn(async () => ['clip-1.png']);
    const uploadPersistedAttachment = vi.fn(async (relative: string) => ({
      ok: true as const,
      path: `/remote/.zcc-uploads/${relative}`
    }));
    return {
      promptText: 'See @/Users/me/a.ts please',
      mentions: [pathMention('/Users/me/a.ts')],
      images: [] as Array<{ path: string | null; file: File }>,
      projectId: 'p1',
      uploadLocalPath,
      persistImages,
      uploadPersistedAttachment,
      quoteRemotePath: (path: string) => path,
      ...overrides
    };
  }

  it('uploads absolute local mentions and rewrites the prompt', async () => {
    const deps = stagingDeps();
    const staged = await stageRemoteComposerAttachments(deps);
    expect(staged).toMatchObject({
      ok: true,
      promptText: 'See @/remote/.zcc-uploads/a.ts please',
      imagePaths: []
    });
    expect(deps.uploadLocalPath).toHaveBeenCalledWith('/Users/me/a.ts');
    expect(deps.persistImages).not.toHaveBeenCalled();
  });

  it('uploads an image disk path and does not persist it locally', async () => {
    const deps = stagingDeps({
      promptText: 'look',
      mentions: [],
      images: [{ path: '/Users/me/shot.png', file: imageFile }]
    });
    const staged = await stageRemoteComposerAttachments(deps);
    expect(staged).toEqual({
      ok: true,
      promptText: 'look',
      imagePaths: ['/remote/.zcc-uploads/shot.png'],
      uploaded: [{ localPath: '/Users/me/shot.png', remotePath: '/remote/.zcc-uploads/shot.png' }]
    });
    expect(deps.uploadLocalPath).toHaveBeenCalledWith('/Users/me/shot.png');
    expect(deps.persistImages).not.toHaveBeenCalled();
    expect(deps.uploadPersistedAttachment).not.toHaveBeenCalled();
  });

  it('skips relative typeahead paths', async () => {
    const deps = stagingDeps({
      promptText: 'See @src/foo.ts',
      mentions: [pathMention('src/foo.ts')]
    });
    const staged = await stageRemoteComposerAttachments(deps);
    expect(staged).toMatchObject({ ok: true, promptText: 'See @src/foo.ts', imagePaths: [] });
    expect(deps.uploadLocalPath).not.toHaveBeenCalled();
  });

  it('skips absolute paths that are not local files so launch continues', async () => {
    const deps = stagingDeps({
      uploadLocalPath: vi.fn(async () => ({
        ok: false as const,
        message: 'ENOENT: no such file or directory, stat \'/home/dev/src/foo.ts\''
      }))
    });
    const staged = await stageRemoteComposerAttachments(deps);
    expect(staged).toMatchObject({
      ok: true,
      promptText: 'See @/Users/me/a.ts please',
      uploaded: []
    });
  });

  it('aborts when a local file fails to upload', async () => {
    const deps = stagingDeps({
      uploadLocalPath: vi.fn(async () => ({ ok: false as const, message: 'Permission denied' }))
    });
    await expect(stageRemoteComposerAttachments(deps)).resolves.toEqual({
      ok: false,
      localPath: '/Users/me/a.ts',
      message: 'Permission denied'
    });
  });

  it('persists clipboard images then uploads the stored attachment', async () => {
    const deps = stagingDeps({
      promptText: 'look',
      mentions: [],
      images: [{ path: null, file: imageFile }]
    });
    const staged = await stageRemoteComposerAttachments(deps);
    expect(staged).toMatchObject({
      ok: true,
      promptText: 'look',
      imagePaths: ['/remote/.zcc-uploads/clip-1.png']
    });
    expect(deps.persistImages).toHaveBeenCalledWith('p1', [{ path: null, file: imageFile }]);
    expect(deps.uploadPersistedAttachment).toHaveBeenCalledWith('clip-1.png');
    expect(deps.uploadLocalPath).not.toHaveBeenCalled();
  });
});

describe('CLI launch overlay helpers', () => {
  it('lets a plugin profile override the base profile', () => {
    expect(resolveCliLaunchProfile({ baseProfile: 'claude' })).toBe('claude');
    expect(resolveCliLaunchProfile({
      baseProfile: 'claude',
      patchProfileId: 'claude-yolo'
    })).toBe('claude-yolo');
  });

  it('merges extra args and execution state with a plugin patch', () => {
    const merged = applyLaunchPatch({
      baseProfile: 'claude',
      extraArgs: ['--verbose'],
      harnessRouting: withExecutionState(undefined, 'claude', 'plan'),
      patch: {
        extraArgs: ['--dangerously-skip-permissions'],
        profileId: 'claude-yolo',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { claude: { modelTargetId: 'sonnet' } }
        }
      }
    });
    expect(merged.profile).toBe('claude-yolo');
    expect(merged.extraArgs).toEqual(['--verbose', '--dangerously-skip-permissions']);
    expect(merged.harnessRouting?.byAdapter.claude).toMatchObject({
      executionState: 'plan',
      modelTargetId: 'sonnet'
    });
  });

  it('remembers extra args per family in localStorage', () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem(key: string) { return memory.get(key) ?? null; },
        setItem(key: string, value: string) { memory.set(key, value); },
        removeItem(key: string) { memory.delete(key); }
      }
    });
    expect(readCliExtraArgs('claude')).toEqual([]);
    writeCliExtraArgs('claude', ['--plugin-dir', '/tmp/p']);
    expect(readCliExtraArgs('claude')).toEqual(['--plugin-dir', '/tmp/p']);
    expect(readCliExtraArgs('codex')).toEqual([]);
    writeCliExtraArgs('claude', []);
    expect(readCliExtraArgs('claude')).toEqual([]);
  });
});

describe('cliComposerModeChip', () => {
  it('keeps OpenCode on native roles and offers Agent/Plan for plan-capable PTY families', () => {
    expect(CLI_WORK_MODES).toEqual(['agent', 'plan']);
    expect(cliComposerModeChip('opencode')).toBe('native-role');
    expect(cliComposerModeChip('claude')).toBe('work-mode');
    expect(cliComposerModeChip('cursor')).toBe('work-mode');
    expect(cliComposerModeChip('codex')).toBe('work-mode');
    expect(cliComposerModeChip('pi')).toBe('none');
    expect(cliComposerModeChip('')).toBe('none');
  });
});

describe('cliLaunchExecutionState', () => {
  const base = {
    permissionExecutionState: 'accept-edits' as const,
    hasNativeRole: false,
    unrestrictedProfileSelected: false
  };

  it('emits no extra routing on default Agent so current launches stay identical', () => {
    expect(cliLaunchExecutionState({
      ...base,
      familyId: 'claude',
      workMode: 'agent'
    })).toBe('accept-edits');
    expect(cliLaunchExecutionState({
      familyId: 'claude',
      workMode: 'agent',
      hasNativeRole: false,
      unrestrictedProfileSelected: false
    })).toBeUndefined();
    expect(cliLaunchExecutionState({
      familyId: 'pi',
      workMode: 'plan',
      hasNativeRole: false,
      unrestrictedProfileSelected: false
    })).toBeUndefined();
  });

  it('sets plan and never a roleTargetId for Claude, Cursor, and Codex', () => {
    for (const familyId of ['claude', 'cursor', 'codex'] as const) {
      expect(cliLaunchExecutionState({
        ...base,
        familyId,
        workMode: 'plan'
      }), familyId).toBe('plan');
    }
  });

  it('XORs Plan against Edits and skips Plan on Full/yolo or an OpenCode native role', () => {
    expect(cliLaunchExecutionState({
      ...base,
      familyId: 'claude',
      workMode: 'plan'
    })).toBe('plan');
    expect(cliLaunchExecutionState({
      familyId: 'claude',
      workMode: 'plan',
      permissionExecutionState: 'accept-edits',
      hasNativeRole: false,
      unrestrictedProfileSelected: true
    })).toBeUndefined();
    expect(cliLaunchExecutionState({
      familyId: 'opencode',
      workMode: 'plan',
      permissionExecutionState: 'accept-edits',
      hasNativeRole: true,
      unrestrictedProfileSelected: false
    })).toBeUndefined();
    expect(cliLaunchExecutionState({
      familyId: 'opencode',
      workMode: 'agent',
      permissionExecutionState: 'accept-edits',
      hasNativeRole: true,
      unrestrictedProfileSelected: false
    })).toBeUndefined();
  });

  it('lets applyLaunchPatch still merge plugin extra args and routing on top of Plan', () => {
    const routing = withExecutionState(
      undefined,
      'claude',
      cliLaunchExecutionState({
        familyId: 'claude',
        workMode: 'plan',
        permissionExecutionState: 'accept-edits',
        hasNativeRole: false,
        unrestrictedProfileSelected: false
      }) ?? ''
    );
    const merged = applyLaunchPatch({
      baseProfile: 'claude',
      extraArgs: ['--verbose'],
      harnessRouting: routing,
      patch: {
        extraArgs: ['--plugin-dir', '/tmp/p'],
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { claude: { modelTargetId: 'sonnet' } }
        }
      }
    });
    expect(merged.extraArgs).toEqual(['--verbose', '--plugin-dir', '/tmp/p']);
    expect(merged.harnessRouting?.byAdapter.claude).toMatchObject({
      executionState: 'plan',
      modelTargetId: 'sonnet'
    });
    expect(merged.harnessRouting?.byAdapter.claude).not.toHaveProperty('roleTargetId');
  });
});
