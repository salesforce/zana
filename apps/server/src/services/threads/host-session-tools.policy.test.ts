import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HOST_ADAPT_TOOL_NAMES,
  HOST_PTY_ONLY_TOOL_NAMES,
  HOST_SHARE_TOOL_NAMES,
  mergeHostSessionTooling
} from './host-session-tools.js';
import { HOST_PREVIEW_FILE_TOOL_NAME } from './host-preview-file-tool.js';

describe('host session tool policy', () => {
  it('packs every SHARE tool and none of the ADAPT or PTY-only names', () => {
    const packed = mergeHostSessionTooling({});
    const names = packed.dynamicTools?.map((tool) => tool.name) ?? [];
    expect(names[0]).toBe(HOST_PREVIEW_FILE_TOOL_NAME);
    expect(names).toEqual([...HOST_SHARE_TOOL_NAMES]);
    for (const name of HOST_ADAPT_TOOL_NAMES) {
      expect(names).not.toContain(name);
    }
    for (const name of HOST_PTY_ONLY_TOOL_NAMES) {
      expect(names).not.toContain(name);
    }
  });

  it('does not attach a zcc-inbox MCP URL to conversation packing or ACP/SDK bridges', () => {
    const files = [
      new URL('./conversation-session-tools.ts', import.meta.url),
      new URL('./host-session-tools.ts', import.meta.url),
      new URL('../../../../../plugins/provider-acp/src/bridge/bridge.ts', import.meta.url),
      new URL('../../../../../plugins/provider-claude-code/src/bridge/bridge.ts', import.meta.url)
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/mcpServers[\s\S]{0,200}zcc-inbox/);
      expect(source).not.toMatch(/zcc-inbox[\s\S]{0,80}\/mcp\//);
    }
  });

  it('teaches the same SHARE names the skills already use', () => {
    expect(HOST_SHARE_TOOL_NAMES).toContain('browser_open');
    expect(HOST_SHARE_TOOL_NAMES).toContain('inbox_push');
    expect(HOST_SHARE_TOOL_NAMES).toContain('inbox_search');
    expect(HOST_SHARE_TOOL_NAMES).toContain('suggest_action');
    expect(HOST_SHARE_TOOL_NAMES).toContain('library_write');
    expect(HOST_SHARE_TOOL_NAMES).toContain('goal_create');
    expect(HOST_SHARE_TOOL_NAMES).toContain('schedule_list');
    expect(HOST_SHARE_TOOL_NAMES).toContain('list_projects');
    expect(HOST_SHARE_TOOL_NAMES).toContain('create_local_extension');
    expect(HOST_ADAPT_TOOL_NAMES).toContain('inbox_ask');
    expect(HOST_PTY_ONLY_TOOL_NAMES).toContain('schedule_report');
    expect(HOST_PTY_ONLY_TOOL_NAMES).toContain('register_agent');
  });
});
