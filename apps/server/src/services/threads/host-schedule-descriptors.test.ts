import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { launchOptionsSchema, squadExecutionTargetSchema } from '@zana-ai/zcc-domain/launch-options';

describe('host schedule descriptors startup', () => {
  it('imports and renders schedule tool descriptors without custom-schema conversion errors', async () => {
    const { HOST_SCHEDULE_TOOLS } = await import('./host-schedule-tools.js');
    const descriptor = HOST_SCHEDULE_TOOLS.find(tool => tool.name === 'schedule_update')!;
    const json = JSON.stringify(descriptor.inputSchema);
    expect(json).toContain('launchOptions');
    expect(json).toContain('project-root');
    expect(json).toContain('worktree');
  });

  it('renders both exact target variants with branch bounds and no path escape hatch', () => {
    const json = z.toJSONSchema(squadExecutionTargetSchema);
    expect(json.oneOf).toEqual([
      expect.objectContaining({ required: ['kind'], additionalProperties: false }),
      expect.objectContaining({ required: ['kind', 'branch'], additionalProperties: false,
        properties: expect.objectContaining({ branch: expect.objectContaining({ type: 'string', minLength: 1, maxLength: 200 }) }) })
    ]);
    expect(z.toJSONSchema(launchOptionsSchema).additionalProperties).toBe(false);
    for (const target of [{ kind: 'project-root' }, { kind: 'worktree', branch: 'feat/review' }]) {
      expect(squadExecutionTargetSchema.parse(target)).toEqual(target);
    }
    for (const target of [{ kind: 'project-root', path: '/tmp' }, { kind: 'worktree', branch: '../bad' }, { kind: 'worktree', branch: 'x'.repeat(201) }, { kind: 'worktree', branch: 'feat/x', path: '/tmp' }]) {
      expect(squadExecutionTargetSchema.safeParse(target).success).toBe(false);
    }
  });
});
