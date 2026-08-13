import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: the first-party framework extensions must SHIP an `agentPreset` in
 * their committed, packaged manifest (`bundled-extensions/<id>/extension.json`
 * — the canonical bundled form seeded on boot). This is the block the Advanced
 * Quick-Agent launcher renders as a Framework preset; without it the launcher
 * shows "No framework presets installed" (the empty state we shipped by
 * accident once). A repack that drops the block, or a source edit that never
 * gets packed, regresses that empty state silently — so assert it here.
 *
 * `systemPrompt` is the load-bearing field (discovery drops a primer-less
 * preset), so we assert a non-trivial primer, not just presence.
 */
const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

function bundledManifest(id: string): Record<string, unknown> {
  const path = join(repoRoot, 'bundled-extensions', id, 'extension.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

describe('bundled framework extensions ship an agentPreset', () => {
  // id → the label the launcher chip should read.
  // NOTE: `zana-hub` (the global-sidebar Zana dashboard) is intentionally NOT
  // in this roster — the global Zana surface was removed (its built manifest
  // deleted), so it no longer ships a bundled agentPreset. The project-scoped
  // `zana` Tickets extension (projectTab, global:false) carries no preset by
  // design, so it isn't a framework-preset framework either.
  const FRAMEWORKS: Array<{ id: string; label: string }> = [{ id: 'consensus', label: 'Consensus' }];

  for (const { id, label } of FRAMEWORKS) {
    it(`${id} declares a well-formed agentPreset (label "${label}")`, () => {
      const m = bundledManifest(id);
      const preset = m.agentPreset as Record<string, unknown> | undefined;
      expect(preset, `${id} is missing agentPreset`).toBeTruthy();
      expect(preset!.label).toBe(label);
      // The primer is what makes the preset do anything — a blank one is dropped
      // at discovery, so require real content.
      expect(typeof preset!.systemPrompt).toBe('string');
      expect((preset!.systemPrompt as string).trim().length).toBeGreaterThan(100);
      // model/baseProfile, when present, must be in the enum discovery narrows to
      // (a typo is silently dropped, so a stale value would ship a bare launch).
      if (preset!.model !== undefined) {
        expect(['opus', 'sonnet', 'haiku', 'default']).toContain(preset!.model);
      }
      if (preset!.baseProfile !== undefined) {
        expect(['claude', 'claude-yolo']).toContain(preset!.baseProfile);
      }
    });
  }
});
