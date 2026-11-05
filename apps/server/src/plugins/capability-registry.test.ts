import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CapabilityRegistry, capabilityRegistry, terminalCapabilityKey } from './capability-registry.js';

describe('surface wiring registry', () => {
  it.each(['claude', 'codex', 'opencode', 'cursor', 'pi', 'unknown'])('uses recorded PTY evidence for %s', harness => {
    for (const headless of [false, true]) for (const hookBase of [false, true]) {
      const capabilities = capabilityRegistry.describe({ surface: 'pty', harness, headless, hookBase });
      expect(capabilities.find(row => row.id === 'tool-before-native')?.available).toBe(['claude', 'codex', 'opencode', 'cursor'].includes(harness) && hookBase);
      expect(capabilities.find(row => row.id === 'tool-after-native')?.available).toBe(false);
    }
  });
  it.each(['claude', 'codex', 'opencode', 'cursor', 'pi', 'shell'])('offers PTY interactions for %s only with a visible monitor', harness => {
    for (const hookBase of [false, true]) {
      const row = (headless: boolean) => capabilityRegistry.describe({ surface: 'pty', harness, headless, hookBase }).find(item => item.id === 'interactions');
      expect(row(false)).toMatchObject({ available: true, reason: expect.stringContaining('Agents monitor') });
      expect(row(true)).toMatchObject({ available: false, reason: expect.stringContaining('Headless') });
    }
  });
  it('says what the OpenCode PTY veto leaves ungated, and nothing is advertised without the gate', () => {
    for (const headless of [false, true]) {
      const wired = capabilityRegistry.describe({ surface: 'pty', harness: 'opencode', headless, hookBase: true })
        .find(row => row.id === 'tool-before-native');
      expect(wired).toMatchObject({ available: true, reason: expect.stringContaining('user types') });
      expect(wired?.reason).toContain('remote');
      const unwired = capabilityRegistry.describe({ surface: 'pty', harness: 'opencode', headless, hookBase: false })
        .find(row => row.id === 'tool-before-native');
      expect(unwired).toMatchObject({ available: false, reason: expect.stringContaining('not wired') });
    }
  });
  it('says what the Cursor PTY veto leaves ungated, and nothing is advertised without the gate', () => {
    for (const headless of [false, true]) {
      const wired = capabilityRegistry.describe({ surface: 'pty', harness: 'cursor', headless, hookBase: true })
        .find(row => row.id === 'tool-before-native');
      expect(wired).toMatchObject({ available: true, reason: expect.stringContaining('preToolUse') });
      expect(wired?.reason).toContain('user types');
      expect(wired?.reason).toContain('remote');
      const unwired = capabilityRegistry.describe({ surface: 'pty', harness: 'cursor', headless, hookBase: false })
        .find(row => row.id === 'tool-before-native');
      expect(unwired).toMatchObject({ available: false, reason: expect.stringContaining('not wired') });
    }
  });
  it('keeps the Cursor ACP veto unadvertised and says why', () => {
    for (const headless of [false, true]) {
      const row = capabilityRegistry.describe({ surface: 'modern', harness: 'acp-cursor', headless, hookBase: true })
        .find(item => item.id === 'tool-before-native');
      expect(row).toMatchObject({ available: false, reason: expect.stringContaining('without raising a request') });
      expect(row?.reason).toContain('unverified');
    }
  });
  it.each(['claude', 'codex', 'opencode', 'cursor', 'pi', 'shell', 'unknown'])('advertises PTY message admission only for wired harness %s', harness => {
    for (const headless of [false, true]) for (const hookBase of [false, true]) {
      const row = capabilityRegistry.describe({ surface: 'pty', harness, headless, hookBase }).find(item => item.id === 'message-admission');
      expect(row?.available).toBe(harness !== 'unknown');
      if (harness === 'unknown') expect(row).toMatchObject({ reason: expect.stringContaining('not wired') });
    }
  });
  it.each(['claude', 'codex', 'opencode', 'cursor', 'pi', 'shell'])('delivers PTY lifecycle for %s and says what it omits', harness => {
    for (const headless of [false, true]) for (const hookBase of [false, true]) {
      const row = capabilityRegistry.describe({ surface: 'pty', harness, headless, hookBase }).find(item => item.id === 'lifecycle-delivery');
      expect(row?.available).toBe(true);
      const turnHooks = !headless && hookBase && ['claude', 'codex'].includes(harness);
      if (turnHooks) expect(row?.reason).toBeUndefined();
      else expect(row?.reason).toContain('never reports active or idle');
      if (headless) expect(row?.reason).toContain('headless');
    }
  });
  it('does not advertise PTY lifecycle for an unwired harness', () => {
    expect(capabilityRegistry.describe({ surface: 'pty', harness: 'unknown', headless: false, hookBase: true })
      .find(item => item.id === 'lifecycle-delivery')?.available).toBe(false);
  });
  // Codex is no longer in this list: p0-modern-codex-veto wires its Modern veto.
  it.each(['pi', 'acp', 'acp-opencode', 'acp-cursor', 'spoofed-claude'])('does not infer Modern native hooks for %s', harness => {
    const rows = capabilityRegistry.describe({ surface: 'modern', harness, headless: false, hookBase: true });
    expect(rows.find(row => row.id === 'tool-before-native')).toMatchObject({ available: false, reason: expect.any(String) });
    expect(rows.find(row => row.id === 'tool-after-native')?.available).toBe(false);
    expect(rows.find(row => row.id === 'message-admission')?.available).toBe(harness !== 'spoofed-claude');
  });
  it.each([false, true])('advertises the awaited Modern native veto for each wired harness (headless=%s)', headless => {
    for (const harness of ['claude-code', 'codex']) {
      expect(capabilityRegistry.describe({ surface: 'modern', harness, headless, hookBase: true })
        .find(row => row.id === 'tool-before-native')).toMatchObject({ id: 'tool-before-native', available: true });
      expect(capabilityRegistry.describe({ surface: 'modern', harness, headless, hookBase: false })
        .find(row => row.id === 'tool-before-native')?.available).toBe(false);
    }
  });
  it('wires the Modern Codex command + file-change native veto', () => {
    const row = capabilityRegistry.describe({ surface: 'modern', harness: 'codex', headless: false, hookBase: true })
      .find(row => row.id === 'tool-before-native');
    expect(row).toMatchObject({ id: 'tool-before-native', available: true });
    // Honest scope: Codex raises no approval for an in-sandbox command at workspace scope.
    expect(row?.reason).toContain('workspace scope');
    expect(row?.reason).toContain('MCP');
  });
  it('states why Modern harnesses without an awaited policy transport are unavailable', () => {
    for (const harness of ['pi', 'acp', 'acp-opencode']) {
      expect(capabilityRegistry.describe({ surface: 'modern', harness, headless: false, hookBase: true })
        .find(r => r.id === 'tool-before-native')).toMatchObject({ available: false, reason: expect.stringContaining(harness) });
    }
  });
  it('flags that the Cursor PTY veto is not verified against a logged-in agent', () => {
    expect(capabilityRegistry.describe({ surface: 'pty', harness: 'cursor', headless: false, hookBase: true })
      .find(r => r.id === 'tool-before-native')?.reason).toContain('not been verified');
  });
  it('allows explicit wiring registration only; unknown and missing session evidence unavailable', () => {
    const key = terminalCapabilityKey({ profile: 'codex-yolo' });
    expect(key).toEqual({ surface: 'pty', harness: 'codex', headless: false, hookBase: false });
    expect(terminalCapabilityKey({ profile: 'shell', capabilitySurface: { ...key, hookBase: true } })).toEqual({ ...key, hookBase: true });
    const registry = new CapabilityRegistry();
    expect(registry.describe(null).every(row => !row.available && row.reason)).toBe(true);
    registry.register(key, 'tool-before-native', { available: true });
    registry.register(key, 'tool-before-native', { available: false, reason: 'disconnected' });
    expect(registry.describe(key).find(row => row.id === 'tool-before-native')).toEqual({ id: 'tool-before-native', available: false, reason: 'disconnected' });
  });
  it('documents registry native availability without overclaiming post-tool', () => {
    const doc = readFileSync(new URL('../../../../docs/extensions-sdk-reference.md', import.meta.url), 'utf8');
    // The per-surface matrix itself is checked cell by cell in capability-matrix-doc.guard.test.ts.
    expect(doc).toContain('same-uid process');
    expect(doc).toContain('`hooks.onToolPolicy` is public and stable');
  });
});
