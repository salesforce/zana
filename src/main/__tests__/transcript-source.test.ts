/**
 * TranscriptSource dispatch-seam tests. Verifies the seam routes reads to the
 * right registered harness reader by capability: Claude → derived path + Claude
 * reader; no-transcript profile → empty/null.
 *
 * Uses a tmp `~/.claude/projects` tree so the real reader runs end-to-end through
 * the registration seam (no reader mocking).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { TranscriptSource } from '../transcript-source.js';
import { encodeProjectCwd } from '../../shared/path-encoding.js';

describe('TranscriptSource', () => {
  it('returns "" / null for a no-transcript profile (shell)', async () => {
    const src = new TranscriptSource();
    expect(await src.readLastTurn({ id: 's', profile: 'shell', cwd: '/x' })).toBe('');
    expect(await src.readDigest({ id: 's', profile: 'shell', cwd: '/x' })).toBe('');
    expect(await src.readStats({ id: 's', profile: 'shell', cwd: '/x' })).toBeNull();
  });

  it('routes a Claude session to the derived-path Claude reader', async () => {
    // Write a Claude transcript at the derived path the seam will compute.
    const cwd = mkdtempSync(join(tmpdir(), 'ts-claude-cwd-'));
    const claudeSessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const projDir = join(homedir(), '.claude', 'projects', encodeProjectCwd(cwd));
    const transcript = join(projDir, `${claudeSessionId}.jsonl`);
    mkdirSync(projDir, { recursive: true });
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'claude says hello' }] }
    });
    writeFileSync(transcript, `${line}\n`);

    try {
      const src = new TranscriptSource();
      const text = await src.readLastTurn({ id: 'sess-claude', profile: 'claude', cwd, claudeSessionId });
      expect(text).toBe('claude says hello');
    } finally {
      rmSync(transcript, { force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

});
