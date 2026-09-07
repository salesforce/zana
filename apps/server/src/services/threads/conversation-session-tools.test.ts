import { describe, expect, it } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { packConversationSessionTooling } from './conversation-session-tools.js';
import { HOST_SHARE_TOOL_NAMES, HOST_SESSION_INSTRUCTION } from './host-session-tools.js';
import { HOST_PREVIEW_FILE_TOOL_NAME } from './host-preview-file-tool.js';

describe('packConversationSessionTooling', () => {
  it('still offers SHARE host tools when plugins are absent', async () => {
    const packed = await packConversationSessionTooling({} as ProductHttpContext, {
      threadId: 'thr-1',
      projectId: 'proj-1'
    });
    expect(packed.dynamicTools?.map((tool) => tool.name)).toEqual([...HOST_SHARE_TOOL_NAMES]);
    expect(packed.instructions).toBe(HOST_SESSION_INSTRUCTION);
  });

  it('merges plugin tools after the host SHARE tools', async () => {
    const packed = await packConversationSessionTooling(
      {
        plugins: {
          sessionTools: async () => ({
            tools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: { type: 'object' } }],
            instructions: 'Use sf_soql.'
          })
        }
      } as unknown as ProductHttpContext,
      { threadId: 'thr-1', projectId: 'proj-1' }
    );
    expect(packed.dynamicTools?.map((tool) => tool.name)).toEqual([
      ...HOST_SHARE_TOOL_NAMES,
      'sf_soql'
    ]);
    expect(packed.instructions).toContain('Use sf_soql.');
    expect(packed.instructions).toContain('preview_file');
    expect(packed.instructions).toContain('browser_open');
  });

  it('still offers SHARE host tools when plugin sessionTools throws', async () => {
    const packed = await packConversationSessionTooling(
      {
        plugins: {
          sessionTools: async () => {
            throw new Error('configure failed');
          }
        }
      } as unknown as ProductHttpContext,
      { threadId: 'thr-1', projectId: 'proj-1' }
    );
    expect(packed.dynamicTools?.[0]?.name).toBe(HOST_PREVIEW_FILE_TOOL_NAME);
    expect(packed.dynamicTools?.map((tool) => tool.name)).toEqual([...HOST_SHARE_TOOL_NAMES]);
    expect(packed.instructions).toBe(HOST_SESSION_INSTRUCTION);
  });

  it('drops a plugin tool that collides with a host SHARE name', async () => {
    const packed = await packConversationSessionTooling(
      {
        plugins: {
          sessionTools: async () => ({
            tools: [{ name: 'inbox_push', description: 'plugin copy', inputSchema: {} }]
          })
        }
      } as unknown as ProductHttpContext,
      { threadId: 'thr-1', projectId: 'proj-1' }
    );
    expect(packed.dynamicTools?.filter((tool) => tool.name === 'inbox_push')).toHaveLength(1);
    expect(packed.dynamicTools?.find((tool) => tool.name === 'inbox_push')?.description).toContain('inbox');
  });
});
