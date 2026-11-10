import { describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from '../harness/claude/provider.js';
import { OpenCodeProvider } from '../harness/opencode/provider.js';

describe('plugin instruction delivery by provider', () => {
  it('Claude appends one system-prompt layer and nothing for empty text', () => {
    const claude = new ClaudeCodeProvider();
    expect(claude.pluginInstructionArgs('claude', 'hi')).toEqual(['--append-system-prompt', 'hi']);
    expect(claude.pluginInstructionArgs('claude', '')).toEqual([]);
  });

  it('OpenCode lists the file after existing instructions and survives bad config', () => {
    const oc = new OpenCodeProvider();
    expect(oc.pluginInstructionsViaConfigFile).toBe(true);
    const merged = oc.mergePluginInstructionsConfig('opencode', JSON.stringify({ mcp: {}, instructions: ['a.md'] }), '/p/x.md');
    expect(JSON.parse(merged)).toEqual({ mcp: {}, instructions: ['a.md', '/p/x.md'] });
    const fresh = oc.mergePluginInstructionsConfig('opencode', '{"mcp":{}}', '/p/x.md');
    expect(JSON.parse(fresh).instructions).toEqual(['/p/x.md']);
    expect(oc.mergePluginInstructionsConfig('opencode', 'not json', '/p/x.md')).toBe('not json');
  });

  it('Claude does not use the config-file channel and leaves config untouched', () => {
    const claude = new ClaudeCodeProvider();
    expect(claude.pluginInstructionsViaConfigFile).toBeFalsy();
    expect(claude.mergePluginInstructionsConfig('claude', '{"a":1}', '/p')).toBe('{"a":1}');
  });
});

describe('native tool gate delivery by provider', () => {
  it('only OpenCode vetoes through its config file', () => {
    const oc = new OpenCodeProvider();
    expect(oc.nativeToolGateViaConfigFile).toBe(true);
    expect(oc.nativeToolGatePluginSource('opencode', 'http://127.0.0.1:1/hook/nativetool/p/s')).toContain('http://127.0.0.1:1/hook/nativetool/p/s');
    expect(JSON.parse(oc.mergeNativeToolGateConfig('opencode', '{"mcp":{}}', '/g.mjs')).plugin).toEqual(['file:///g.mjs']);
    const claude = new ClaudeCodeProvider();
    expect(claude.nativeToolGateViaConfigFile).toBeFalsy();
    expect(claude.nativeToolGatePluginSource('claude', 'http://x')).toBeNull();
    expect(claude.mergeNativeToolGateConfig('claude', '{"a":1}', '/g')).toBe('{"a":1}');
  });
});
