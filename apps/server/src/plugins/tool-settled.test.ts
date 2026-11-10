import { describe, expect, it, vi } from 'vitest';
import { buildToolOutputPreview, emitMainOwnedToolSettled, finalizeToolSettled, TOOL_SETTLED_PREVIEW_MAX_BYTES } from './tool-settled.js';

const base = {
  invocationId: 'inv-1',
  projectId: 'p1',
  providerId: 'claude-code',
  toolName: 'Bash',
  state: 'succeeded' as const,
  durationMs: 12
};

describe('finalizeToolSettled', () => {
  it('never includes output for a plugin without the preview grant', () => {
    const event = finalizeToolSettled({ ...base, output: 'hello' }, false);
    expect(event).toEqual(base);
    expect(JSON.stringify(event)).not.toContain('hello');
  });

  it('includes a redacted, capped preview for a plugin with the grant', () => {
    const secret = 'sk-ant-api03-' + 'A'.repeat(40);
    const event = finalizeToolSettled({ ...base, output: `token ${secret} ${'x'.repeat(10_000)}` }, true);
    expect(event.outputPreview).toBeDefined();
    expect(event.outputPreview).not.toContain(secret);
    expect(Buffer.byteLength(event.outputPreview!, 'utf8')).toBeLessThanOrEqual(TOOL_SETTLED_PREVIEW_MAX_BYTES);
  });

  it('omits the preview when there is no output', () => {
    expect(finalizeToolSettled(base, true)).toEqual(base);
    expect(finalizeToolSettled({ ...base, output: '' }, true)).not.toHaveProperty('outputPreview');
  });

  it('does not split a multi-byte character at the cap', () => {
    const preview = buildToolOutputPreview('é'.repeat(5_000));
    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(TOOL_SETTLED_PREVIEW_MAX_BYTES);
    expect(preview).not.toContain('�');
  });
});

describe('emitMainOwnedToolSettled', () => {
  it('reports undelivered without a plugin service', () => {
    expect(emitMainOwnedToolSettled(undefined, { ...base, profile: 'claude' } as never)).toEqual({ delivered: false });
  });

  it('fans the event out fire-and-forget and swallows failures', async () => {
    const emitToolSettled = vi.fn().mockRejectedValue(new Error('boom'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { providerId: _providerId, ...rest } = base;
    expect(emitMainOwnedToolSettled({ emitToolSettled }, { ...rest, profile: 'claude', sessionId: 's1', output: 'o' } as never)).toEqual({ delivered: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emitToolSettled).toHaveBeenCalledOnce();
    expect(emitToolSettled.mock.calls[0]![0]).toMatchObject({ invocationId: 'inv-1', output: 'o' });
    expect(errors).toHaveBeenCalledWith('[plugins] tool.settled delivery failed');
    errors.mockRestore();
  });
});
