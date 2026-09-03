import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { flattenThreadInput, requestAutoThreadTitle, threadTitle } from './conversation-create.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import {
  bridgeLaunchForProvider,
  canonicalThreadProviderId,
  getThreadProvider,
  listThreadProviders,
  registerThreadProvider
} from './thread-provider-catalog.js';

describe('flattenThreadInput', () => {
  it('accepts a string, string array, and PromptInput text parts', () => {
    expect(flattenThreadInput('hello')).toEqual(['hello']);
    expect(flattenThreadInput(['a', 'b'])).toEqual(['a', 'b']);
    expect(flattenThreadInput([{ type: 'text', text: 'hi' }, { type: 'image' }])).toEqual(['hi']);
    expect(flattenThreadInput([{
      type: 'text',
      text: 'see @src/foo.ts',
      mentions: [{ start: 4, end: 15, resource: { kind: 'path', path: 'src/foo.ts' } }]
    }])).toEqual(['see @src/foo.ts']);
    expect(flattenThreadInput(null)).toEqual([]);
  });
});

describe('threadTitle', () => {
  it('prefers an explicit title, then a short prompt snippet, then Thread', () => {
    expect(threadTitle({ title: '  My Name  ' }, ['a long prompt'])).toBe('My Name');
    expect(threadTitle({}, ['  Fix   the login  '])).toBe('Fix the login');
    expect(threadTitle({}, ['a'.repeat(41)])).toBe(`${'a'.repeat(40)}…`);
    expect(threadTitle({}, [])).toBe('Thread');
  });
});

describe('requestAutoThreadTitle', () => {
  it('requests the namer from the first prompt and reserves an explicit title', () => {
    const namer = { request: vi.fn(), reserve: vi.fn() };
    const ctx = { threadTitleNamer: namer } as unknown as import('../../http/product-context.js').ProductHttpContext;
    requestAutoThreadTitle(ctx, { projectId: 'p', providerId: 'claude-code', input: ['work'] }, 'thr-1', ['work']);
    expect(namer.request).toHaveBeenCalledWith('thr-1', 'work');
    expect(namer.reserve).not.toHaveBeenCalled();

    namer.request.mockClear();
    requestAutoThreadTitle(ctx, {
      projectId: 'p',
      providerId: 'claude-code',
      input: ['work'],
      title: 'Pinned'
    }, 'thr-2', ['work']);
    expect(namer.reserve).toHaveBeenCalledWith('thr-2');
    expect(namer.request).not.toHaveBeenCalled();
  });

  it('skips when the first prompt is empty', () => {
    const namer = { request: vi.fn(), reserve: vi.fn() };
    const ctx = { threadTitleNamer: namer } as unknown as import('../../http/product-context.js').ProductHttpContext;
    requestAutoThreadTitle(ctx, { projectId: 'p', providerId: 'claude-code', input: [] }, 'thr-3', []);
    expect(namer.request).not.toHaveBeenCalled();
    expect(namer.reserve).not.toHaveBeenCalled();
  });
});

describe('thread provider catalog', () => {
  it('does not seed providers; plugins are the sole source', () => {
    expect(listThreadProviders().filter((row) => row.id !== 'fake').map((row) => row.id)).toEqual([]);
  });

  it('unregisters a plugin-provided overlay without restoring a core seed', () => {
    const handle = registerThreadProvider('provider-acp', {
      id: 'acp-opencode',
      displayName: 'OpenCode overlay',
      capabilities: {
        supportsServiceTier: true,
        fork: 'tip',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full']
      },
      composerActions: []
    });
    expect(getThreadProvider('acp-opencode')?.displayName).toBe('OpenCode overlay');
    handle.unregister();
    expect(getThreadProvider('acp-opencode')).toBeUndefined();
  });

  it('keeps a newer registration when the previous handle unregisters', () => {
    const first = registerThreadProvider('provider-acp', {
      id: 'acp-opencode',
      displayName: 'first',
      capabilities: {
        supportsServiceTier: true,
        fork: 'tip',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full']
      },
      composerActions: []
    });
    const second = registerThreadProvider('provider-acp', {
      id: 'acp-opencode',
      displayName: 'second',
      capabilities: {
        supportsServiceTier: true,
        fork: 'tip',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full']
      },
      composerActions: []
    });
    first.unregister();
    expect(getThreadProvider('acp-opencode')?.displayName).toBe('second');
    second.unregister();
    expect(getThreadProvider('acp-opencode')).toBeUndefined();
  });

  it('emits digest and byteLength from the host artifact registry', () => {
    const artifacts = new PluginHostArtifactRegistry();
    artifacts.set('provider-acp', {
      path: '/tmp/dist/host.js',
      digest: 'ab'.repeat(32),
      byteLength: 2048,
      generation: 'g1'
    });
    const handle = registerThreadProvider('provider-acp', {
      id: 'acp-opencode',
      displayName: 'OpenCode',
      capabilities: {
        supportsServiceTier: true,
        fork: 'tip',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full']
      },
      composerActions: []
    });
    try {
      const launch = bridgeLaunchForProvider('acp-opencode', artifacts);
      expect(launch.source).toEqual({
        kind: 'artifact',
        digest: 'ab'.repeat(32),
        byteLength: 2048
      });
      expect(launch).not.toHaveProperty('dataDir');
    } finally {
      handle.unregister();
    }
  });

  it('refuses a plugin provider launch when the host artifact is missing', () => {
    const handle = registerThreadProvider('provider-acp', {
      id: 'acp-opencode',
      displayName: 'OpenCode',
      capabilities: {
        supportsServiceTier: true,
        fork: 'tip',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full']
      },
      composerActions: []
    });
    try {
      expect(() => bridgeLaunchForProvider('acp-opencode', new PluginHostArtifactRegistry()))
        .toThrow(/no host artifact/u);
    } finally {
      handle.unregister();
    }
  });

  it('uses a daemon-bundled launch for fake without a registry snapshot', () => {
    const previous = process.env.ZCC_FAKE_PROVIDER;
    process.env.ZCC_FAKE_PROVIDER = '1';
    try {
      const launch = bridgeLaunchForProvider('fake', new PluginHostArtifactRegistry());
      expect(launch.source).toEqual({ kind: 'daemon-bundled', id: 'fake' });
    } finally {
      if (previous === undefined) delete process.env.ZCC_FAKE_PROVIDER;
      else process.env.ZCC_FAKE_PROVIDER = previous;
    }
  });

  it('maps ZCC launch-profile aliases onto thread providers', () => {
    expect(canonicalThreadProviderId('claude')).toBe('claude-code');
    expect(canonicalThreadProviderId('claude-yolo')).toBe('claude-code');
    expect(canonicalThreadProviderId('cursor')).toBe('acp-cursor');
    expect(canonicalThreadProviderId('opencode')).toBe('acp-opencode');
    expect(canonicalThreadProviderId('opencode-resume')).toBe('acp-opencode');
    expect(canonicalThreadProviderId('codex')).toBe('codex');
  });

  it('registers fake first when ZCC_FAKE_PROVIDER=1', () => {
    const previous = process.env.ZCC_FAKE_PROVIDER;
    process.env.ZCC_FAKE_PROVIDER = '1';
    try {
      expect(listThreadProviders()[0]?.id).toBe('fake');
    } finally {
      if (previous === undefined) delete process.env.ZCC_FAKE_PROVIDER;
      else process.env.ZCC_FAKE_PROVIDER = previous;
    }
  });
});

describe('unmanaged environment reuse', () => {
  it('reattaches to the existing project/host/path environment instead of inserting a duplicate', () => {
    const source = readFileSync(new URL('./conversation-create.ts', import.meta.url), 'utf8');
    expect(source).toContain('appendClientTurnRequested');
    expect(source).toContain('findProjectEnvironmentByHostPath');
    expect(source).toContain("choice.kind === 'unmanaged'");
    expect(source).toContain('needsHostAttach');
    expect(source).toContain("existing.workspaceProvisionType === 'unmanaged'");
    expect(source).toContain('requestAutoThreadTitle(ctx, input, running.id, textPrompt)');
    expect(source).toContain('hostPromptFromInput');
    expect(source).toContain('titleFromPrompt');
    expect(source).toContain('reasoningLevel: args.input.reasoningLevel');
    expect(source).toContain("...(args.input.reasoningLevel ? { reasoningLevel: args.input.reasoningLevel } : {})");
    expect(source).toContain('clientRequestId');
  });
});

describe('thread title namer wiring', () => {
  it('persists a successful namer title and emits threads:updated', () => {
    const source = readFileSync(new URL('../../http/product-context.ts', import.meta.url), 'utf8');
    expect(source).toContain('updateConversationThreadTitle(db, threadId, title)');
    expect(source).toContain("hub.emit('threads:updated', conversationThreadView(ctx, updated))");
    expect(source).toContain('autoRenameTabs !== false');
    expect(source).toContain('join(dataDir, \'llm-prompts\')');
  });
});

describe('SSH remotes', () => {
  it('run on this machine with remote tools unless the enrolled host is selected', () => {
    const source = readFileSync(new URL('./conversation-create.ts', import.meta.url), 'utf8');
    expect(source).toContain('conversationThreadViews');
    expect(source).toContain('peekThreadReadSeq');
    expect(source).toContain('maxConversationEventSequenceByThreadIds');
    expect(source).toContain('threadActivityForConversation');
    expect(source).toContain('isRemoteToolProxyActive(project, input.hostId)');
    expect(source).toContain('remoteWorkspacePath(project, remoteToolProxy)');
    expect(source).toContain('resolveSpawnChoiceForHost');
    expect(source).toContain('dropCwd');
    expect(source).toContain('resolvePersonalTargetPathOnHost');
    expect(source).not.toContain('readRemoteToolProxySetting');
    expect(source).toContain('getPrimaryHost(ctx.db)');
    expect(source).toContain('remoteToolProxy: true');
    expect(source).toContain('threadLaunchRemote(args.project)');
  });
});

describe('conversation timeline projection options', () => {
  it('expands completed turns so work rows stay visible', () => {
    const source = readFileSync(new URL('./conversation-timeline.ts', import.meta.url), 'utf8');
    expect(source).toContain("turnMessageDetail: 'full'");
    expect(source).toContain('includeNestedRows: true');
    expect(source).toContain('workspaceRoot: environment?.path ?? null');
    expect(source).toContain('activeThinking: timeline.activeThinking');
  });
});
