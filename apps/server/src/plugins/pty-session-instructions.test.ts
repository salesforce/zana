import { afterEach, describe, expect, it, vi } from 'vitest';
import { PtySessionInstructionsMainRequestSchema, PtySessionInstructionsReplySchema, PTY_SESSION_INSTRUCTIONS_MAX_CHARS } from '@zana-ai/zcc-contracts/runtime';
import { resolveMainOwnedPtyInstructions } from './pty-session-instructions.js';

const req = { sessionId: 's1', projectId: 'p1', profile: 'codex-yolo' } as const;
afterEach(() => vi.restoreAllMocks());

describe('resolveMainOwnedPtyInstructions', () => {
  it('answers empty without a plugin service', async () => {
    await expect(resolveMainOwnedPtyInstructions(undefined, req)).resolves.toEqual({ instructions: '' });
  });

  it('passes pty identity, defaulting threadId to the session id', async () => {
    const sessionInstructions = vi.fn().mockResolvedValue('text');
    await expect(resolveMainOwnedPtyInstructions({ sessionInstructions }, req)).resolves.toEqual({ instructions: 'text' });
    expect(sessionInstructions).toHaveBeenCalledWith({ surface: 'pty', sessionId: 's1', threadId: 's1', projectId: 'p1', harness: 'codex' });
    await resolveMainOwnedPtyInstructions({ sessionInstructions }, { ...req, threadId: 't9' });
    expect(sessionInstructions.mock.calls[1]![0]).toMatchObject({ threadId: 't9', sessionId: 's1' });
  });

  it('answers empty when the plugin service throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sessionInstructions = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(resolveMainOwnedPtyInstructions({ sessionInstructions }, req)).resolves.toEqual({ instructions: '' });
  });
});

describe('pty session instructions contract', () => {
  it('is strict and bounded', () => {
    expect(PtySessionInstructionsMainRequestSchema.safeParse(req).success).toBe(true);
    expect(PtySessionInstructionsMainRequestSchema.safeParse({ ...req, extra: 1 }).success).toBe(false);
    expect(PtySessionInstructionsMainRequestSchema.safeParse({ ...req, profile: '../x' }).success).toBe(false);
    expect(PtySessionInstructionsReplySchema.safeParse({ instructions: 'x'.repeat(PTY_SESSION_INSTRUCTIONS_MAX_CHARS) }).success).toBe(true);
    expect(PtySessionInstructionsReplySchema.safeParse({ instructions: 'x'.repeat(PTY_SESSION_INSTRUCTIONS_MAX_CHARS + 1) }).success).toBe(false);
  });
});
