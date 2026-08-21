/**
 * External-editor verification — "is this editor's launch shim on this machine?"
 *
 * The Settings → Editor category shows, per editor, whether its CLI shim
 * (`cursor` / `code` / `idea`) resolves — the same "installed / not-installed"
 * affordance the Code Harness tab gives for the coding CLIs, but for the
 * `OpenerButtons` "open in editor" bar. This is DISTINCT from harness
 * verification: the harness probes `cursor-agent` (the coding CLI), whereas this
 * probes `cursor` (the GUI-launch shim). Only the GUI editors are probed —
 * Finder/Terminal aren't editors and have no shim.
 *
 * Detection mirrors `harness-verify.ts`: a best-effort `<binary> --version` exec
 * that NEVER throws (missing bin / non-zero exit / timeout all resolve to
 * `installed: false`). The probed binary honours the user's per-editor override
 * (`AppConfig.editor*Binary`), else the built-in default.
 */

import { execFile } from 'node:child_process';
import type { AppConfig, EditorTarget, EditorVerifyResult } from '@zana-ai/zcc-domain/product';

interface EditorDef {
  target: EditorTarget;
  label: string;
  /** Default CLI shim when the user hasn't overridden it. */
  defaultBinary: string;
  /** The `AppConfig` key holding the user's binary override. */
  binaryKey: keyof AppConfig;
  installHint: string;
}

/**
 * The verifiable editors, in the opener-bar display order. The concrete
 * target↔shim↔config-key pairing lives ONLY here.
 */
const EDITORS: readonly EditorDef[] = [
  {
    target: 'cursor',
    label: 'Cursor',
    defaultBinary: 'cursor',
    binaryKey: 'editorCursorBinary',
    installHint: 'Cursor → Cmd+Shift+P → "Shell Command: Install \'cursor\' command"'
  },
  {
    target: 'code',
    label: 'VS Code',
    defaultBinary: 'code',
    binaryKey: 'editorCodeBinary',
    installHint: 'Code → Cmd+Shift+P → "Shell Command: Install \'code\' command"'
  },
  {
    target: 'intellij',
    label: 'IntelliJ IDEA',
    defaultBinary: 'idea',
    binaryKey: 'editorIntellijBinary',
    installHint: 'IntelliJ → Tools → "Create Command-line Launcher…"'
  }
] as const;

/** Resolve an editor's binary from config override → default. */
export function editorBinary(def: EditorDef | EditorTarget, config: AppConfig): string {
  const d = typeof def === 'string' ? EDITORS.find((e) => e.target === def) : def;
  if (!d) return typeof def === 'string' ? def : '';
  const override = config[d.binaryKey];
  return (typeof override === 'string' && override.trim()) || d.defaultBinary;
}

/** Result of a spawned probe — never rejects; a failure surfaces as `ok:false`. */
function runVersion(cmd: string, timeoutMs = 8_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, ['--version'], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: String(stdout ?? '').trim() || String(stderr ?? '').trim()
      });
    });
  });
}

/**
 * Verify every external editor against the current config. Probes each editor's
 * resolved `<binary> --version` and returns the install matrix the Editor
 * settings row displays. Best-effort: a probe failure is reported as
 * `installed: false`, never thrown.
 */
export async function verifyEditors(config: AppConfig): Promise<EditorVerifyResult[]> {
  return Promise.all(
    EDITORS.map(async (def): Promise<EditorVerifyResult> => {
      const binary = editorBinary(def, config);
      const probe = await runVersion(binary);
      return {
        target: def.target,
        label: def.label,
        binary,
        installed: probe.ok,
        // `--version` output is often multi-line (name + build); keep the first
        // line so the settings row stays compact.
        version: probe.ok ? probe.out.split('\n')[0]?.trim() || undefined : undefined,
        installHint: def.installHint
      };
    })
  );
}
