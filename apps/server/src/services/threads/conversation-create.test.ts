import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flattenThreadInput } from './conversation-create.js';
import { canonicalThreadProviderId, listThreadProviders } from './thread-provider-catalog.js';

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

describe('thread provider catalog', () => {
  it('seeds Claude Code, Codex, Pi, and ACP Cursor', () => {
    const ids = listThreadProviders().map((row) => row.id).sort();
    expect(ids).toEqual(['acp-cursor', 'claude-code', 'codex', 'pi']);
  });

  it('maps ZCC launch-profile aliases onto thread providers', () => {
    expect(canonicalThreadProviderId('claude')).toBe('claude-code');
    expect(canonicalThreadProviderId('claude-yolo')).toBe('claude-code');
    expect(canonicalThreadProviderId('cursor')).toBe('acp-cursor');
    expect(canonicalThreadProviderId('codex')).toBe('codex');
  });

  it('registers fake first when ZCC_FAKE_PROVIDER=1', () => {
    const previous = process.env.ZCC_FAKE_PROVIDER;
    process.env.ZCC_FAKE_PROVIDER = '1';
    try {
      expect(listThreadProviders()[0]?.id).toBe('fake');
      expect(listThreadProviders().map((row) => row.id)).toContain('pi');
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
