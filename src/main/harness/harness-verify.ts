/**
 * Code-harness verification — "is this CLI actually installed on this machine?"
 *
 * The Settings → Code Harness category needs two orthogonal facts per harness:
 *   - ENABLED — the user's intent, a persisted `AppConfig.harness*Enabled` flag
 *     (already owned by the config); and
 *   - INSTALLED — the machine reality, which is what THIS module answers.
 *
 * A profile is offered in the launcher only when it is BOTH enabled AND
 * installed; an enabled-but-missing harness is shown greyed-out with an honest
 * "binary not found" hint rather than silently failing at spawn.
 *
 * Detection mirrors `dependency-doctor.ts`: a best-effort `<binary> --version`
 * exec that NEVER throws (a missing bin / non-zero exit / timeout all resolve to
 * `installed: false`). The binary is NOT hard-coded here — it is resolved
 * through each family's own {@link LaunchProvider} (`resolveLaunch(...).command`),
 * so the config-override precedence (`config.piBinary || 'pi'`, …) lives in ONE
 * place (the provider) and this module names only the representative profile ids
 * (Rule 6: profile literals stay in the harness layer, never in `PtyManager` or
 * the renderer).
 */

import { execFile } from 'node:child_process';
import type { AppConfig, HarnessFamily, HarnessVerifyResult } from '../../shared/types.js';
import type { LaunchProfileId } from '../../shared/types.js';
import { providerFor } from './registry.js';

/**
 * The verifiable code-harness families, in display order. Each maps to a
 * representative profile whose provider resolves the binary to probe. Claude
 * Code is `alwaysEnabled` — it's the app's default harness, so it has no enable
 * toggle (verify-only), while the rest gate on their `AppConfig` flag.
 *
 * This is the Rule-6 registration seam for verification, the sibling of
 * `registry.ts`'s `LAUNCH_PROVIDERS`: the concrete family↔profile↔config-flag
 * pairing lives ONLY here.
 */
interface HarnessFamilyDef {
  family: HarnessFamily;
  label: string;
  /** The profile whose provider resolves this family's binary. */
  profile: LaunchProfileId;
  /** The `AppConfig` flag gating this harness in the launcher; null ⇒ always on. */
  enabledFlag: keyof AppConfig | null;
  /** Where to get the CLI — a convenience hint surfaced in Settings. */
  installHint: string;
}

const HARNESS_FAMILIES: readonly HarnessFamilyDef[] = [
  {
    family: 'claude',
    label: 'Claude Code',
    profile: 'claude',
    enabledFlag: null,
    installHint: 'https://claude.com/claude-code'
  },
  {
    family: 'cursor',
    label: 'Cursor',
    profile: 'cursor',
    enabledFlag: 'harnessCursorEnabled',
    installHint: 'https://cursor.com/cli'
  },
  {
    family: 'codex',
    label: 'Codex',
    profile: 'codex',
    enabledFlag: 'harnessCodexEnabled',
    installHint: 'npm i -g @openai/codex'
  },
  {
    family: 'pi',
    label: 'PI',
    profile: 'pi',
    enabledFlag: 'harnessPiEnabled',
    installHint: 'npm i -g @earendil-works/pi-coding-agent'
  },
  {
    family: 'opencode',
    label: 'OpenCode',
    profile: 'opencode',
    enabledFlag: 'harnessOpenCodeEnabled',
    installHint: 'https://opencode.ai — npm i -g opencode-ai'
  }
] as const;

/** Result of a spawned probe — never rejects; a failure surfaces as `ok:false`. */
function runVersion(cmd: string, timeoutMs = 8_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      ['--version'],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          out: String(stdout ?? '').trim() || String(stderr ?? '').trim()
        });
      }
    );
  });
}

/** Extract one exact numeric CLI version; ranges and aliases are deliberately unsupported in v1. */
export function normalizeHarnessVersion(output: string): string | undefined {
  return output.match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+)(?:[^0-9]|$)/)?.[1];
}

/**
 * Verify every code-harness family against the current config. Resolves the
 * binary through each family's provider, probes `<binary> --version`, and
 * returns the enabled × installed matrix the renderer gates the picker on.
 * Best-effort: a probe failure is reported as `installed: false`, never thrown.
 */
export async function verifyHarnesses(config: AppConfig): Promise<HarnessVerifyResult[]> {
  return Promise.all(
    HARNESS_FAMILIES.map(async (def): Promise<HarnessVerifyResult> => {
      // resolveLaunch owns the binary-override precedence (Rule 6); we only read
      // the command, discarding the base argv.
      const { command } = providerFor(def.profile).resolveLaunch(def.profile, config, false);
      const enabled = def.enabledFlag === null || config[def.enabledFlag] === true;
      const probe = await runVersion(command);
      return {
        family: def.family,
        label: def.label,
        binary: command,
        enabled,
        alwaysEnabled: def.enabledFlag === null,
        installed: probe.ok,
        version: probe.ok ? probe.out : undefined,
        normalizedVersion: probe.ok ? normalizeHarnessVersion(probe.out) : undefined,
        installHint: def.installHint
      };
    })
  );
}
