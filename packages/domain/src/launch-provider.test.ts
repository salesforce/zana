import { describe, it, expect } from 'vitest';
import {
  VALID_PROFILES,
  parseProfile,
  formatProfile,
  isClaudeProfile,
  isCursorProfile,
  isCodexProfile,
  isAgentProfile,
  providerCapabilities,
  providerUiSchema,
  harnessOptions,
  HARNESS_OPTION_ROLES,
  LEAST_CAPABLE,
  seedPromptArgs
} from './launch-provider.js';
import type { LaunchProfileId } from './product.js';

describe('launch-provider', () => {
  describe('parseProfile', () => {
    it('parses all valid profiles', () => {
      expect(parseProfile('claude')).toBe('claude');
      expect(parseProfile('claude-resume')).toBe('claude-resume');
      expect(parseProfile('claude-yolo')).toBe('claude-yolo');
      expect(parseProfile('cursor')).toBe('cursor');
      expect(parseProfile('cursor-resume')).toBe('cursor-resume');
      expect(parseProfile('codex')).toBe('codex');
      expect(parseProfile('codex-resume')).toBe('codex-resume');
      expect(parseProfile('shell')).toBe('shell');
    });

    it('rejects unknown profiles', () => {
      expect(parseProfile('unknown')).toBeNull();
      expect(parseProfile('gemini')).toBeNull();
      expect(parseProfile('')).toBeNull();
      expect(parseProfile('Claude')).toBeNull(); // case-sensitive
    });

    it('round-trips with formatProfile', () => {
      for (const profile of VALID_PROFILES) {
        const formatted = formatProfile(profile);
        const parsed = parseProfile(formatted);
        expect(parsed).toBe(profile);
      }
    });
  });

  describe('isClaudeProfile', () => {
    it('returns true for Claude-family profiles', () => {
      expect(isClaudeProfile('claude')).toBe(true);
      expect(isClaudeProfile('claude-resume')).toBe(true);
      expect(isClaudeProfile('claude-yolo')).toBe(true);
    });

    it('returns false for shell', () => {
      expect(isClaudeProfile('shell')).toBe(false);
    });

    it('returns false for cursor / codex (they are not the Claude family)', () => {
      expect(isClaudeProfile('cursor')).toBe(false);
      expect(isClaudeProfile('codex')).toBe(false);
    });
  });

  describe('isCursorProfile / isCodexProfile / isAgentProfile', () => {
    it('isCursorProfile matches only the cursor family', () => {
      expect(isCursorProfile('cursor')).toBe(true);
      expect(isCursorProfile('cursor-resume')).toBe(true);
      expect(isCursorProfile('claude')).toBe(false);
      expect(isCursorProfile('codex')).toBe(false);
    });

    it('isCodexProfile matches only the codex family', () => {
      expect(isCodexProfile('codex')).toBe(true);
      expect(isCodexProfile('codex-resume')).toBe(true);
      expect(isCodexProfile('cursor')).toBe(false);
    });

    it('isAgentProfile is true for every non-shell profile', () => {
      for (const p of VALID_PROFILES) {
        expect(isAgentProfile(p)).toBe(p !== 'shell');
      }
    });
  });

  describe('providerCapabilities', () => {
    it('resolves claude capabilities', () => {
      const caps = providerCapabilities('claude');
      expect(caps).toEqual({
        hasTranscript: true,
        injectsClaudeMcpConfig: true,
        acceptsPermissionMode: true,
        acceptsPromptArgv: true,
        supportsHooks: true,
        isAgent: true,
        acceptsSessionId: true,
        canAutoCloseOnFinish: true,
        emitsOscStatus: true
      });
    });

    it('resolves claude-resume capabilities', () => {
      const caps = providerCapabilities('claude-resume');
      expect(caps).toEqual({
        hasTranscript: true,
        injectsClaudeMcpConfig: true,
        acceptsPermissionMode: true,
        acceptsPromptArgv: true,
        supportsHooks: true,
        isAgent: true,
        acceptsSessionId: true,
        canAutoCloseOnFinish: true,
        emitsOscStatus: true
      });
    });

    it('resolves claude-yolo capabilities (no permissionMode)', () => {
      const caps = providerCapabilities('claude-yolo');
      expect(caps).toEqual({
        hasTranscript: true,
        injectsClaudeMcpConfig: true,
        acceptsPermissionMode: false, // yolo forces skip-permissions
        acceptsPromptArgv: true,
        supportsHooks: true,
        isAgent: true,
        acceptsSessionId: true,
        canAutoCloseOnFinish: true,
        emitsOscStatus: true
      });
    });

    it('resolves cursor capabilities (agent + promptArgv, no launcher injections)', () => {
      for (const p of ['cursor', 'cursor-resume'] as const) {
        expect(providerCapabilities(p)).toEqual({
          hasTranscript: false,
          injectsClaudeMcpConfig: false,
          acceptsPermissionMode: false,
          acceptsPromptArgv: true,
          supportsHooks: false,
          isAgent: true,
          acceptsSessionId: false,
          canAutoCloseOnFinish: false,
          emitsOscStatus: false
        });
      }
    });

    it('resolves codex capabilities (transcript + hooks + auto-close ON; no minted session id / other Claude flags)', () => {
      for (const p of ['codex', 'codex-resume'] as const) {
        expect(providerCapabilities(p)).toEqual({
          hasTranscript: true,
          injectsClaudeMcpConfig: false,
          acceptsPermissionMode: false,
          acceptsPromptArgv: true,
          supportsHooks: true,
          isAgent: true,
          acceptsSessionId: false,
          canAutoCloseOnFinish: true,
          emitsOscStatus: false
        });
      }
    });

    it('resolves shell capabilities (all false)', () => {
      const caps = providerCapabilities('shell');
      expect(caps).toEqual({
        hasTranscript: false,
        injectsClaudeMcpConfig: false,
        acceptsPermissionMode: false,
        acceptsPromptArgv: false,
        supportsHooks: false,
        isAgent: false,
        acceptsSessionId: false,
        canAutoCloseOnFinish: false,
        emitsOscStatus: false
      });
    });

    it('degrades an UNREGISTERED profile id to the all-off LEAST_CAPABLE floor (T2.1)', () => {
      // A runtime string that drifted ahead of the typed union (newer app version
      // / unregistered harness). It must NOT borrow shell's identity as a runnable
      // answer — it degrades to all-off so no feature service activates.
      const ghost = 'gemini-cli' as unknown as LaunchProfileId;
      expect(providerCapabilities(ghost)).toEqual(LEAST_CAPABLE);
    });

    it('LEAST_CAPABLE is frozen and every gate is false', () => {
      expect(Object.isFrozen(LEAST_CAPABLE)).toBe(true);
      expect(Object.values(LEAST_CAPABLE).every((v) => v === false)).toBe(true);
    });

    it('returns a fresh (mutable) object per call — a caller cannot poison the shared floor', () => {
      const ghost = 'gemini-cli' as unknown as LaunchProfileId;
      const a = providerCapabilities(ghost) as { isAgent: boolean };
      a.isAgent = true; // mutate the returned copy
      // A second call is unaffected, and the frozen constant never changed.
      expect(providerCapabilities(ghost)).toEqual(LEAST_CAPABLE);
      expect(providerCapabilities('shell')).toEqual(LEAST_CAPABLE);
    });

    it('provides no capability keys the UI-schema derivation depends on going missing', () => {
      // providerUiSchema derives models off injectsClaudeMcpConfig and permission
      // modes off acceptsPermissionMode — pin that these keys stay booleans.
      for (const p of VALID_PROFILES) {
        const caps = providerCapabilities(p);
        expect(typeof caps.injectsClaudeMcpConfig).toBe('boolean');
        expect(typeof caps.acceptsPermissionMode).toBe('boolean');
      }
    });

    it('produces identical resolution for all profiles (snapshot guard)', () => {
      const snapshot: Record<string, unknown> = {};
      for (const profile of VALID_PROFILES) {
        snapshot[profile] = providerCapabilities(profile);
      }
      expect(snapshot).toMatchInlineSnapshot(`
        {
          "claude": {
            "acceptsPermissionMode": true,
            "acceptsPromptArgv": true,
            "acceptsSessionId": true,
            "canAutoCloseOnFinish": true,
            "emitsOscStatus": true,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": true,
            "isAgent": true,
            "supportsHooks": true,
          },
          "claude-resume": {
            "acceptsPermissionMode": true,
            "acceptsPromptArgv": true,
            "acceptsSessionId": true,
            "canAutoCloseOnFinish": true,
            "emitsOscStatus": true,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": true,
            "isAgent": true,
            "supportsHooks": true,
          },
          "claude-yolo": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": true,
            "canAutoCloseOnFinish": true,
            "emitsOscStatus": true,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": true,
            "isAgent": true,
            "supportsHooks": true,
          },
          "codex": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": true,
            "emitsOscStatus": false,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": true,
          },
          "codex-resume": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": true,
            "emitsOscStatus": false,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": true,
          },
          "codex-yolo": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": true,
            "emitsOscStatus": false,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": true,
          },
          "cursor": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": false,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": false,
          },
          "cursor-resume": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": false,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": false,
          },
          "cursor-yolo": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": false,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": false,
          },
          "opencode": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": false,
          },
          "opencode-resume": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": true,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": false,
          },
          "pi": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": false,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": false,
          },
          "pi-resume": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": true,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": false,
            "injectsClaudeMcpConfig": false,
            "isAgent": true,
            "supportsHooks": false,
          },
          "shell": {
            "acceptsPermissionMode": false,
            "acceptsPromptArgv": false,
            "acceptsSessionId": false,
            "canAutoCloseOnFinish": false,
            "emitsOscStatus": false,
            "hasTranscript": false,
            "injectsClaudeMcpConfig": false,
            "isAgent": false,
            "supportsHooks": false,
          },
        }
      `);
    });
  });

  describe('providerUiSchema', () => {
    it('claude offers the full model + permission-mode option sets', () => {
      const s = providerUiSchema('claude');
      expect(s.models.map((m) => m.id)).toEqual(['default', 'opus', 'sonnet', 'haiku']);
      expect(s.permissionModes.map((m) => m.id)).toEqual([
        'default',
        'acceptEdits',
        'plan',
        'bypassPermissions'
      ]);
    });

    it('claude-yolo offers models but NO permission modes (it forces skip-permissions)', () => {
      const s = providerUiSchema('claude-yolo');
      expect(s.models.length).toBeGreaterThan(0);
      expect(s.permissionModes).toEqual([]);
    });

    it('codex offers a model catalog + sandbox/approval axis, but NO permission modes', () => {
      // Codex's flag builders emit `-m` (model catalog) and the sandbox/approval
      // pair (`-s`/`-a`) — its analogue to claude's `--permission-mode`.
      for (const p of ['codex', 'codex-resume'] as const) {
        const s = providerUiSchema(p);
        expect(s.models.length).toBeGreaterThan(0);
        expect(s.permissionModes).toEqual([]);
        expect(s.sandboxes.length).toBeGreaterThan(0);
        expect(s.approvals.length).toBeGreaterThan(0);
      }
    });

    it('cursor / shell offer NOTHING — they consume no model/permission/sandbox flags', () => {
      for (const p of ['cursor', 'cursor-resume', 'shell'] as const) {
        const s = providerUiSchema(p);
        expect(s.models).toEqual([]);
        expect(s.permissionModes).toEqual([]);
        expect(s.sandboxes).toEqual([]);
        expect(s.approvals).toEqual([]);
      }
    });

    it('claude offers models but NO sandbox/approval axis (that is codex-only)', () => {
      for (const p of ['claude', 'claude-resume', 'claude-yolo'] as const) {
        const s = providerUiSchema(p);
        expect(s.sandboxes).toEqual([]);
        expect(s.approvals).toEqual([]);
      }
    });

    it('models offered iff (claude flags OR codex); modes iff acceptsPermissionMode; sandbox/approval iff codex', () => {
      // The schema must never drift from the capability truth it derives from.
      for (const p of VALID_PROFILES) {
        const caps = providerCapabilities(p);
        const s = providerUiSchema(p);
        const isCodex = isCodexProfile(p);
        // codex-yolo forces --dangerously-bypass-approvals-and-sandbox, which
        // supersedes the -s/-a axis — so it still offers models (-m) but NO
        // sandbox/approval pickers (parity with claude-yolo dropping the mode).
        const offersSandboxApproval = isCodex && p !== 'codex-yolo';
        expect(s.models.length > 0).toBe(caps.injectsClaudeMcpConfig || isCodex);
        expect(s.permissionModes.length > 0).toBe(caps.acceptsPermissionMode);
        expect(s.sandboxes.length > 0).toBe(offersSandboxApproval);
        expect(s.approvals.length > 0).toBe(offersSandboxApproval);
      }
    });

    it('returns fresh arrays (a caller mutating options cannot corrupt the shared source)', () => {
      const a = providerUiSchema('claude');
      const b = providerUiSchema('claude');
      expect(a.models).not.toBe(b.models);
    });
  });

  describe('harnessOptions (flat role-tagged producer)', () => {
    const rolesPresent = (p: LaunchProfileId) =>
      new Set(harnessOptions(p).map((o) => o.role));

    it('codex offers model + sandbox + approval, NO permission mode', () => {
      for (const p of ['codex', 'codex-resume'] as const) {
        expect(rolesPresent(p)).toEqual(new Set(['model', 'sandbox', 'approval']));
      }
    });

    it('claude (non-yolo) offers model + permissionMode, NO sandbox/approval', () => {
      for (const p of ['claude', 'claude-resume'] as const) {
        expect(rolesPresent(p)).toEqual(new Set(['model', 'permissionMode']));
      }
    });

    it('claude-yolo offers model but NO permission mode (forces skip-permissions)', () => {
      expect(rolesPresent('claude-yolo')).toEqual(new Set(['model']));
    });

    it('cursor / shell offer no options at all', () => {
      for (const p of ['cursor', 'cursor-resume', 'shell'] as const) {
        expect(harnessOptions(p)).toEqual([]);
      }
    });

    it('is the single source `providerUiSchema` groups — the two views never drift', () => {
      // Grouping the flat producer by role must reproduce the grouped schema for
      // EVERY profile (this is exactly how providerUiSchema is implemented, so it
      // guards against a future divergence between the two shapes).
      for (const p of VALID_PROFILES) {
        const flat = harnessOptions(p);
        const grouped = providerUiSchema(p);
        const strip = (role: (typeof HARNESS_OPTION_ROLES)[number]['role']) =>
          flat.filter((o) => o.role === role).map(({ id, label }) => ({ id, label }));
        expect(grouped.models).toEqual(strip('model'));
        expect(grouped.permissionModes).toEqual(strip('permissionMode'));
        expect(grouped.sandboxes).toEqual(strip('sandbox'));
        expect(grouped.approvals).toEqual(strip('approval'));
      }
    });

    it('every option carries a role in the declared role catalogue', () => {
      const known = new Set(HARNESS_OPTION_ROLES.map((r) => r.role));
      for (const p of VALID_PROFILES) {
        for (const o of harnessOptions(p)) expect(known.has(o.role)).toBe(true);
      }
    });
  });

  describe('seedPromptArgs', () => {
    it('seeds a positional prompt for the claude/cursor/codex/pi families', () => {
      for (const p of [
        'claude',
        'claude-resume',
        'claude-yolo',
        'cursor',
        'cursor-resume',
        'cursor-yolo',
        'codex',
        'codex-resume',
        'codex-yolo',
        'pi',
        'pi-resume'
      ] as const) {
        expect(seedPromptArgs(p, 'do the thing'), p).toEqual(['do the thing']);
      }
    });

    it('escapes a dash-leading prompt with `--` for positional harnesses', () => {
      expect(seedPromptArgs('claude', '--help me')).toEqual(['--', '--help me']);
    });

    it('delivers the prompt via --prompt for OpenCode (positional is a project dir)', () => {
      // Regression for the `Failed to change directory to …/<prompt>` bug: the
      // OpenCode positional is a DIR, so the seed prompt must be a flag.
      expect(seedPromptArgs('opencode', 'fix the test')).toEqual(['--prompt', 'fix the test']);
      expect(seedPromptArgs('opencode-resume', 'fix the test')).toEqual([
        '--prompt',
        'fix the test'
      ]);
      // No `--` escape on the flag path — the value is a flag argument already.
      expect(seedPromptArgs('opencode', '--weird')).toEqual(['--prompt', '--weird']);
    });

    it('returns [] for shell (a shell would run the prompt as a command)', () => {
      expect(seedPromptArgs('shell', 'echo hi')).toEqual([]);
    });

    it('returns [] for an empty / whitespace-only prompt on every profile', () => {
      for (const p of VALID_PROFILES) {
        expect(seedPromptArgs(p, ''), p).toEqual([]);
        expect(seedPromptArgs(p, '   '), p).toEqual([]);
      }
    });

    it('trims surrounding whitespace from the seeded prompt', () => {
      expect(seedPromptArgs('claude', '  hello  ')).toEqual(['hello']);
      expect(seedPromptArgs('opencode', '  hello  ')).toEqual(['--prompt', 'hello']);
    });
  });
});
