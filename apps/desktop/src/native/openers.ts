import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { win32 } from 'node:path';
import { shell } from 'electron';
import type { EditorTarget, OpenResult, OpenTarget } from '@zana-ai/zcc-domain/product';
import { resolveWindowsEditorLaunch, WINDOWS_INSTALL_HINTS } from '@zana-ai/zcc-server/services/projects/editor-windows';

/**
 * Per-target overrides the caller (main's IPC handler) resolves from `AppConfig`
 * — a custom CLI shim and/or macOS app name per editor, plus a preferred
 * terminal app. All optional; a blank/absent field falls back to the built-in
 * default. Kept as a plain bag so `openers.ts` needn't import the config store.
 */
export interface OpenerOverrides {
  cursorBinary?: string;
  cursorApp?: string;
  codeBinary?: string;
  codeApp?: string;
  intellijBinary?: string;
  intellijApp?: string;
  terminalApp?: string;
}

// macOS terminal preference order: iTerm2, WezTerm, Alacritty, Terminal.app.
// Picked the first time it's needed and cached for the session.
let macTerminalApp: string | null = null;
function pickMacTerminalApp(): string {
  if (macTerminalApp) return macTerminalApp;
  const candidates = [
    ['/Applications/iTerm.app', 'iTerm'],
    ['/Applications/WezTerm.app', 'WezTerm'],
    ['/Applications/Alacritty.app', 'Alacritty']
  ] as const;
  for (const [path, name] of candidates) {
    if (existsSync(path)) {
      macTerminalApp = name;
      return name;
    }
  }
  macTerminalApp = 'Terminal';
  return 'Terminal';
}

function spawnDetached(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<OpenResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...(env ? { env } : {}) });
      child.once('error', (err) => {
        resolve({ ok: false, message: err.message });
      });
      child.once('spawn', () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * Launch a macOS app by NAME via `/usr/bin/open -a`, resolving on its exit code
 * (not merely on spawn) so a missing app is reported honestly. Unlike a bare
 * CLI-shim spawn, `open` lives at a fixed absolute path that's always on even a
 * Dock-launched app's minimal PATH, and it doesn't require the user to have
 * installed the editor's shell command. `-n` opens a fresh instance/window.
 */
function openMacApp(appName: string, path: string): Promise<OpenResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn('/usr/bin/open', ['-a', appName, '-n', path], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        stderr += String(d);
      });
      child.once('error', (err) => resolve({ ok: false, message: err.message }));
      child.once('exit', (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, message: stderr.trim() || `open exited with code ${code}` });
      });
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * A PowerShell single-quoted literal: nothing inside is expanded. PowerShell
 * also treats the curly quotes U+2018..U+201B as single quotes (they open and
 * close a literal), so each of those is doubled too.
 */
function psLiteral(value: string): string {
  return `'${value.replace(/['\u2018-\u201B]/g, '$&$&')}'`;
}

/** The script the hidden PowerShell runs to start `program` in `dir`. */
export function windowsTerminalScript(dir: string, program: string): string {
  return `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${psLiteral(program)} -WorkingDirectory ${psLiteral(dir)}`;
}

/**
 * Open a terminal in `dir` on Windows. A console program spawned `detached`
 * gets no console and exits at once, and `cmd /c start` would re-parse the
 * folder (`%VAR%`, `&`). So a hidden PowerShell runs `Start-Process`, which
 * gives the shell its own window in the user's default terminal app (Windows
 * Terminal on Windows 11). The script travels as `-EncodedCommand`, so the
 * folder is only ever a PowerShell string literal. Resolves on the launcher's
 * exit code so an unknown program is reported.
 */
function openWindowsTerminal(dir: string, program: string, timeoutMs = 20_000): Promise<OpenResult> {
  const powershell = process.env.SystemRoot
    ? win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  const encoded = Buffer.from(windowsTerminalScript(dir, program), 'utf16le').toString('base64');
  const failed = `Could not open ${program} in ${dir}.`;
  return new Promise((resolve) => {
    try {
      // Not `detached`: the launcher needs a (hidden) console to run, and the
      // shell it starts breaks away, so it outlives ZCC.
      const child = spawn(
        powershell,
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
        { stdio: 'ignore', windowsHide: true }
      );
      const timer = setTimeout(() => {
        child.kill();
        resolve({ ok: false, message: `${failed} The launcher timed out.` });
      }, timeoutMs);
      child.once('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, message: `${failed} ${err.message}` });
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? { ok: true } : { ok: false, message: failed });
      });
    } catch (err) {
      resolve({ ok: false, message: `${failed} ${err instanceof Error ? err.message : String(err)}` });
    }
  });
}

/**
 * Open a path in an editor. Prefers the editor's CLI shim (honours `-n` for a
 * fresh window and needs no GUI app-name match), but a Dock-launched ZCC has a
 * minimal PATH that usually omits `/usr/local/bin` where those shims live — so a
 * bare `spawn('cursor', …)` fails with ENOENT and, with `stdio:'ignore'`, fails
 * SILENTLY. When the shim can't be found we fall back to `open -a <App>` for the
 * first installed app-name candidate; only if BOTH miss do we surface the
 * install hint. Linux keeps CLI-only (the fallback is an `open` feature).
 *
 * Windows shims are batch files `spawn` can't start without a shell, so there we
 * run what the shim runs, directly (see `editor-windows.ts`): `Code.exe cli.js
 * -n <path>` as Node. Without `cli.js`, the bare exe gets just the path: with
 * `-n` a running VS Code exits 0 and opens nothing.
 */
async function openInEditor(
  target: EditorTarget,
  name: string,
  cli: string,
  cliArgs: string[],
  appNames: string[],
  installHint: string
): Promise<OpenResult> {
  if (process.platform === 'win32') {
    const launch = await resolveWindowsEditorLaunch(target, cli);
    const notFound = `Could not launch ${name}. Install it ${WINDOWS_INSTALL_HINTS[target]} in Settings → Editor.`;
    if (!launch) return { ok: false, message: notFound };
    const viaExe = launch.cliJs
      ? await spawnDetached(launch.exe, [launch.cliJs, ...cliArgs], { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' })
      : await spawnDetached(launch.exe, cliArgs[0] === '-n' ? cliArgs.slice(1) : cliArgs);
    return viaExe.ok ? viaExe : { ok: false, message: `${notFound} (${viaExe.message})` };
  }
  const viaCli = await spawnDetached(cli, cliArgs);
  if (viaCli.ok) return viaCli;
  if (process.platform === 'darwin') {
    for (const appName of appNames) {
      const path = cliArgs[cliArgs.length - 1];
      const viaOpen = await openMacApp(appName, path);
      if (viaOpen.ok) return viaOpen;
    }
  }
  return { ok: false, message: installHint };
}

export async function openIn(
  target: OpenTarget,
  path: string,
  overrides: OpenerOverrides = {}
): Promise<OpenResult> {
  // A user-set app override is tried FIRST (before the default candidates), so a
  // custom install location / edition ("IntelliJ IDEA Ultimate") wins.
  const appNames = (custom: string | undefined, defaults: string[]) =>
    custom?.trim() ? [custom.trim(), ...defaults] : defaults;
  const bin = (custom: string | undefined, fallback: string) => custom?.trim() || fallback;
  switch (target) {
    case 'cursor':
      // `-n` forces a fresh window rather than reusing/adding-to the focused
      // one — opening a project shouldn't hijack whatever the user already has
      // open in the editor.
      return openInEditor(
        'cursor',
        'Cursor',
        bin(overrides.cursorBinary, 'cursor'),
        ['-n', path],
        appNames(overrides.cursorApp, ['Cursor']),
        'Could not launch Cursor. Install its CLI via Cursor → Cmd+Shift+P → "Shell Command: Install \'cursor\' command", or make sure Cursor.app is in /Applications.'
      );
    case 'code':
      return openInEditor(
        'code',
        'VS Code',
        bin(overrides.codeBinary, 'code'),
        ['-n', path],
        appNames(overrides.codeApp, ['Visual Studio Code']),
        'Could not launch VS Code. Install its CLI via Code → Cmd+Shift+P → "Shell Command: Install \'code\' command", or make sure Visual Studio Code.app is in /Applications.'
      );
    case 'intellij':
      return openInEditor(
        'intellij',
        'IntelliJ IDEA',
        bin(overrides.intellijBinary, 'idea'),
        [path],
        appNames(overrides.intellijApp, ['IntelliJ IDEA', 'IntelliJ IDEA Ultimate', 'IntelliJ IDEA CE']),
        'Could not launch IntelliJ IDEA. Install its CLI via IntelliJ → Tools → "Create Command-line Launcher…", or make sure IntelliJ IDEA.app is in /Applications.'
      );
    case 'finder': {
      // Directories: open them so their contents show in Finder (callers pass a
      // project root and expect to land *inside* it). Files: reveal (select) in
      // the containing folder — `openPath` on a file would instead try to *open*
      // it with its default app and pop the "choose an application" dialog for
      // extensionless / unknown files.
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      if (isDir) {
        const err = await shell.openPath(path);
        if (err) return { ok: false, message: err };
        return { ok: true };
      }
      shell.showItemInFolder(path);
      return { ok: true };
    }
    case 'terminal': {
      if (process.platform === 'win32') {
        let dir: string;
        try {
          dir = statSync(path).isDirectory() ? path : win32.dirname(path);
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
        return openWindowsTerminal(dir, overrides.terminalApp?.trim() || 'powershell.exe');
      }
      if (process.platform !== 'darwin') {
        return { ok: false, message: 'External terminal launch is not yet supported on this platform.' };
      }
      return spawnDetached('open', ['-a', overrides.terminalApp?.trim() || pickMacTerminalApp(), path]);
    }
    case 'browser': {
      // `path` is a URL here. Only allow http(s) so a module can't coerce
      // the shell into opening file:// or app-scheme links.
      if (!/^https?:\/\//i.test(path)) {
        return { ok: false, message: 'Only http(s) URLs can be opened in the browser.' };
      }
      await shell.openExternal(path);
      return { ok: true };
    }
  }
}
