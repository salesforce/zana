import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { flattenThreadInput, requestAutoThreadTitle, threadTitle } from './conversation-create.js';
import {
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
    expect(source).toContain('requestAutoThreadTitle(ctx, input, running.id, prompt)');
    expect(source).toContain('titleFromPrompt');
    expect(source).toContain('reasoningLevel: args.input.reasoningLevel');
    expect(source).toContain("...(args.input.reasoningLevel ? { reasoningLevel: args.input.reasoningLevel } : {})");
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

describe('conversation timeline projection options', () => {
  it('expands completed turns so work rows stay visible', () => {
    const source = readFileSync(new URL('./conversation-timeline.ts', import.meta.url), 'utf8');
    expect(source).toContain("turnMessageDetail: 'full'");
    expect(source).toContain('includeNestedRows: true');
    expect(source).toContain('workspaceRoot: environment?.path ?? null');
    expect(source).toContain('activeThinking: timeline.activeThinking');
  });
});
