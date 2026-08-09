import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Code2, ChevronRight, FolderOpen, TerminalSquare } from 'lucide-react';
import type { AppConfig, EditorVerifyResult, OpenTarget } from '@shared/types';
import { useData } from '../../store';
import { CursorIcon } from '../icons/CursorIcon';
import { IntelliJIcon } from '../icons/IntelliJIcon';
import { Section, Field, ToggleSwitch } from './FormFields';

/**
 * Settings → Editor. Configures the `OpenerButtons` "open in editor / terminal"
 * bar. Each target is a COMPACT ROW — glyph + name + live install status + a
 * show/hide switch — with per-editor overrides (launch shim + macOS app name)
 * tucked behind an inline "Advanced" disclosure. The install probe (`<shim>
 * --version`) is folded into each editor row so the operator sees WHY an "open
 * in Cursor" button might fail (shim not on PATH) right where they toggle it.
 *
 * NOTE: these editors are the GUI-launch targets (`cursor`/`code`/`idea`) —
 * DISTINCT from the coding-CLI harnesses (`cursor-agent`/`codex`/`pi`) under the
 * Code Harness tab.
 */

const GLYPHS: Record<OpenTarget, (size: number) => JSX.Element> = {
  cursor: (s) => <CursorIcon size={s} />,
  code: (s) => <Code2 size={s} />,
  intellij: (s) => <IntelliJIcon size={s} />,
  finder: (s) => <FolderOpen size={s} />,
  terminal: (s) => <TerminalSquare size={s} />,
  browser: (s) => <Code2 size={s} />
};

/**
 * One opener target as a compact row. Editors carry a live install status +
 * launcher/app overrides behind "Advanced"; Finder has no config; Terminal has
 * a preferred-app override.
 */
function OpenerRow({
  anchorId,
  target,
  name,
  blurb,
  status,
  shown,
  onToggle,
  advanced
}: {
  anchorId: string;
  target: OpenTarget;
  name: string;
  blurb: string;
  status?: EditorVerifyResult;
  shown: boolean;
  onToggle: (on: boolean) => void;
  advanced?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const glyph = GLYPHS[target];
  return (
    <div
      className={`opener-row${shown ? '' : ' opener-row--off'}`}
      id={`settings-anchor-${anchorId}`}
    >
      <div className="opener-row-head">
        {advanced ? (
          <button
            type="button"
            className="opener-row-expand"
            aria-expanded={open}
            aria-label={`Advanced settings for ${name}`}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight
              size={14}
              className={`opener-row-chevron${open ? ' opener-row-chevron--open' : ''}`}
              aria-hidden
            />
          </button>
        ) : (
          <span className="opener-row-expand opener-row-expand--empty" aria-hidden />
        )}

        <span className="opener-row-glyph" aria-hidden>
          {glyph(17)}
        </span>

        <div className="opener-row-text">
          <span className="opener-row-name">{name}</span>
          <span className="opener-row-blurb">{blurb}</span>
        </div>

        {status ? (
          <span
            className={`opener-row-status opener-row-status--${status.installed ? 'ok' : 'warn'}`}
            title={
              status.installed
                ? status.version || 'installed'
                : `not found — install it (${status.installHint})`
            }
          >
            {status.installed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {status.installed ? status.version || 'installed' : 'not found'}
          </span>
        ) : null}

        <ToggleSwitch checked={shown} onChange={onToggle} label={`Show ${name} in opener bar`} />
      </div>

      {advanced && open ? <div className="opener-row-advanced">{advanced}</div> : null}
    </div>
  );
}

export function EditorTab({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const status = useData((s) => s.editorStatus);
  const refresh = useData((s) => s.refreshEditorStatus);
  const [checking, setChecking] = useState(false);

  const runCheck = () => {
    setChecking(true);
    Promise.resolve(refresh()).finally(() => setChecking(false));
  };

  // Re-probe whenever the Editor tab mounts so an editor installed since boot
  // (or a changed shim path) is reflected without a restart.
  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const byTarget = new Map(status.map((s) => [s.target, s]));
  const hidden = config.openerHiddenTargets ?? [];
  const isShown = (t: OpenTarget) => !hidden.includes(t);
  const setShown = (t: OpenTarget, on: boolean) => {
    const next = on
      ? hidden.filter((x) => x !== t)
      : [...hidden.filter((x) => x !== t), t];
    onUpdate({ openerHiddenTargets: next });
  };

  // A labelled text override — reused for every "Advanced" field.
  const override = (
    label: string,
    help: string,
    key: keyof AppConfig,
    placeholder: string
  ) => (
    <Field label={label} help={help} mono>
      <input
        type="text"
        value={(config[key] as string | undefined) ?? ''}
        placeholder={placeholder}
        onChange={(ev) => onConfigDraft({ ...config, [key]: ev.target.value })}
        onBlur={(ev) => onUpdate({ [key]: ev.target.value.trim() || undefined })}
        spellCheck={false}
      />
    </Field>
  );

  return (
    <Section
      anchorId="editor-status"
      title="Open-in-editor bar"
      help="Choose which buttons appear in the “open in editor / terminal” bar throughout the app, and how each one launches. The install check shows whether an editor’s command-line launcher is on your PATH — a missing launcher is why an “open in…” button would fail."
    >
      <div className="opener-list">
        <OpenerRow
          anchorId="editor-cursor"
          target="cursor"
          name="Cursor"
          blurb="Opens a path in the Cursor editor."
          status={byTarget.get('cursor')}
          shown={isShown('cursor')}
          onToggle={(on) => setShown('cursor', on)}
          advanced={
            <>
              {override('CLI launcher', 'Command run to open a path. Blank ⇒ ‘cursor’ on your PATH.', 'editorCursorBinary', 'cursor')}
              {override('macOS app name', 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘Cursor’.', 'editorCursorApp', 'Cursor')}
            </>
          }
        />

        <OpenerRow
          anchorId="editor-code"
          target="code"
          name="VS Code"
          blurb="Opens a path in Visual Studio Code."
          status={byTarget.get('code')}
          shown={isShown('code')}
          onToggle={(on) => setShown('code', on)}
          advanced={
            <>
              {override('CLI launcher', 'Command run to open a path. Blank ⇒ ‘code’ on your PATH.', 'editorCodeBinary', 'code')}
              {override('macOS app name', 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘Visual Studio Code’.', 'editorCodeApp', 'Visual Studio Code')}
            </>
          }
        />

        <OpenerRow
          anchorId="editor-intellij"
          target="intellij"
          name="IntelliJ IDEA"
          blurb="Opens a path in IntelliJ IDEA."
          status={byTarget.get('intellij')}
          shown={isShown('intellij')}
          onToggle={(on) => setShown('intellij', on)}
          advanced={
            <>
              {override('CLI launcher', 'Command run to open a path. Blank ⇒ ‘idea’ on your PATH.', 'editorIntellijBinary', 'idea')}
              {override('macOS app name', 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘IntelliJ IDEA’.', 'editorIntellijApp', 'IntelliJ IDEA')}
            </>
          }
        />

        <OpenerRow
          anchorId="editor-finder"
          target="finder"
          name="Finder"
          blurb="Reveals a path in the macOS Finder."
          shown={isShown('finder')}
          onToggle={(on) => setShown('finder', on)}
        />

        <OpenerRow
          anchorId="editor-terminal"
          target="terminal"
          name="Terminal"
          blurb="Opens a path in an external terminal."
          shown={isShown('terminal')}
          onToggle={(on) => setShown('terminal', on)}
          advanced={override(
            'Preferred terminal app',
            'macOS app name launched via ‘open -a <name>’. Blank ⇒ auto-pick iTerm → WezTerm → Alacritty → Terminal.',
            'terminalApp',
            'iTerm'
          )}
        />
      </div>

      <div className="cred-actions">
        <button type="button" className="cred-btn" onClick={runCheck} disabled={checking}>
          <RefreshCw size={14} className={checking ? 'harness-recheck-spin' : undefined} aria-hidden />
          {checking ? 'Checking…' : 'Re-check installs'}
        </button>
      </div>
    </Section>
  );
}
