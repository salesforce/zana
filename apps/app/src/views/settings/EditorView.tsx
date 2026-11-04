import { useContext, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Code2, ChevronRight, FolderOpen, TerminalSquare } from 'lucide-react';
import type { AppConfig, EditorVerifyResult, OpenTarget } from '@zana-ai/zcc-domain/product';
import {
  EXPLORER_FILE_ICON_THEME_CHOICES,
  EXPLORER_FILE_ICON_THEME_LABELS,
  EXPLORER_MINIMAP_LABELS,
  EXPLORER_MINIMAP_SIDE_CHOICES,
  EXPLORER_MINIMAP_SLIDER_CHOICES,
  EXPLORER_MINIMAP_VERTICAL_SIZE_CHOICES,
  EXPLORER_MINIMAP_WIDTH_CHOICES,
  resolveExplorerFileIconTheme,
  resolveExplorerMinimap
} from '@zana-ai/zcc-domain/product';
import { useData } from '@/store';
import { CursorIcon } from '@/components/icons/CursorIcon';
import { IntelliJIcon } from '@/components/icons/IntelliJIcon';
import { Section, Field, ToggleSwitch } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { RevealContext } from '@/lib/settings-search/reveal';
import { fileManagerBlurb, fileManagerTitle } from '@/lib/file-manager';

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
 * AI Harness tab.
 */

/** Settings-search target for the re-check button row (a bare div, not a FormFields primitive). */
const RECHECK_TARGET = { searchId: 'editor.recheck' };

const GLYPHS: Record<OpenTarget, (size: number) => React.ReactElement> = {
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
  searchId,
  anchorId,
  target,
  name,
  blurb,
  status,
  shown,
  onToggle,
  advanced
}: {
  /** Settings-search entry id; its `-binary` / `-app` overrides live in the Advanced block. */
  searchId: string;
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
  // A search result inside this row's Advanced block expands it before scrolling.
  const reveal = useContext(RevealContext);
  useEffect(() => {
    if (advanced && reveal.reveal === 'advanced' && reveal.target?.startsWith(`${searchId}-`)) setOpen(true);
  }, [advanced, reveal, searchId]);
  const glyph = GLYPHS[target];
  return (
    <div
      className={`opener-row${shown ? '' : ' opener-row--off'}`}
      id={`settings-anchor-${anchorId}`}
      data-settings-target={searchId}
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

export function EditorView({
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
    placeholder: string,
    { searchId }: { searchId: string }
  ) => (
    <Field searchId={searchId} label={label} help={help} mono>
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
    <>
    <Section
      anchorId="editor-status"
      searchId="editor.bar-intro"
      title="Open-in-editor bar"
      help="Choose which buttons appear in the “open in editor / terminal” bar throughout the app, and how each one launches. The install check shows whether an editor’s command-line launcher is on your PATH — a missing launcher is why an “open in…” button would fail."
    >
      <div className="opener-list">
        <OpenerRow
          searchId="editor.cursor"
          anchorId="editor-cursor"
          target="cursor"
          name="Cursor"
          blurb="Opens a path in the Cursor editor."
          status={byTarget.get('cursor')}
          shown={isShown('cursor')}
          onToggle={(on) => setShown('cursor', on)}
          advanced={
            <>
              {override('CLI launcher', 'Command run to open a path. Blank ⇒ ‘cursor’ on your PATH.', 'editorCursorBinary', 'cursor', { searchId: 'editor.cursor-binary' })}
              {override('macOS app name', 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘Cursor’.', 'editorCursorApp', 'Cursor', { searchId: 'editor.cursor-app' })}
            </>
          }
        />

        <OpenerRow
          searchId="editor.code"
          anchorId="editor-code"
          target="code"
          name="VS Code"
          blurb="Opens a path in Visual Studio Code."
          status={byTarget.get('code')}
          shown={isShown('code')}
          onToggle={(on) => setShown('code', on)}
          advanced={
            <>
              {override('CLI launcher', 'Command run to open a path. Blank ⇒ ‘code’ on your PATH.', 'editorCodeBinary', 'code', { searchId: 'editor.code-binary' })}
              {override('macOS app name', 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘Visual Studio Code’.', 'editorCodeApp', 'Visual Studio Code', { searchId: 'editor.code-app' })}
            </>
          }
        />

        <OpenerRow
          searchId="editor.intellij"
          anchorId="editor-intellij"
          target="intellij"
          name="IntelliJ IDEA"
          blurb="Opens a path in IntelliJ IDEA."
          status={byTarget.get('intellij')}
          shown={isShown('intellij')}
          onToggle={(on) => setShown('intellij', on)}
          advanced={
            <>
              {override('CLI launcher', 'Command run to open a path. Blank ⇒ ‘idea’ on your PATH.', 'editorIntellijBinary', 'idea', { searchId: 'editor.intellij-binary' })}
              {override('macOS app name', 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘IntelliJ IDEA’.', 'editorIntellijApp', 'IntelliJ IDEA', { searchId: 'editor.intellij-app' })}
            </>
          }
        />

        <OpenerRow
          searchId="editor.finder"
          anchorId="editor-finder"
          target="finder"
          name={fileManagerTitle()}
          blurb={fileManagerBlurb()}
          shown={isShown('finder')}
          onToggle={(on) => setShown('finder', on)}
        />

        <OpenerRow
          searchId="editor.terminal"
          anchorId="editor-terminal"
          target="terminal"
          name="Terminal"
          blurb="Opens a path in an external terminal."
          shown={isShown('terminal')}
          onToggle={(on) => setShown('terminal', on)}
          advanced={override(
            'Preferred terminal app',
            'macOS: app name launched via ‘open -a <name>’; blank ⇒ auto-pick iTerm → WezTerm → Alacritty → Terminal. Windows: program name or path started in the folder, without arguments, such as pwsh or cmd; blank ⇒ PowerShell.',
            'terminalApp',
            navigator.platform.toUpperCase().startsWith('WIN') ? 'pwsh' : 'iTerm',
            { searchId: 'editor.terminal-app' }
          )}
        />
      </div>

      <div className="cred-actions" data-settings-target={RECHECK_TARGET.searchId}>
        <button type="button" className="cred-btn" onClick={runCheck} disabled={checking}>
          <RefreshCw size={14} className={checking ? 'harness-recheck-spin' : undefined} aria-hidden />
          {checking ? 'Checking…' : 'Re-check installs'}
        </button>
      </div>
    </Section>

      <ExplorerPreviewSettings config={config} onUpdate={onUpdate} />
      <ExplorerFileSettings config={config} onUpdate={onUpdate} />
    </>
  );
}

function ExplorerPreviewSettings({
  config,
  onUpdate
}: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => void;
}) {
  const minimap = resolveExplorerMinimap(config);
  return (
    <Section
      anchorId="editor-explorer-preview"
      searchId="editor.explorer-preview"
      title="Explorer preview"
      help="How the Explorer shows file contents."
    >
      <Field
        label="Minimap"
        searchId="editor.explorer-minimap"
        help="Show a zoomed-out overview of the file on the edge of the Explorer preview. It scrolls with the file; click or drag it to jump. You can also right-click the minimap or the scrollbar in the editor. It is hidden automatically when the preview is narrow."
      >
        <ToggleSwitch
          checked={minimap.enabled}
          onChange={(v) => onUpdate({ explorerMinimapEnabled: v })}
          label="Minimap"
        />
      </Field>
      <Field label="Minimap width" searchId="editor.explorer-minimap-width" help="How wide the minimap is. Default: Default.">
        <PopoverPicklist
          value={minimap.width}
          ariaLabel="Minimap width"
          searchable={false}
          disabled={!minimap.enabled}
          onChange={(width) => onUpdate({ explorerMinimapWidth: width as typeof minimap.width })}
          options={EXPLORER_MINIMAP_WIDTH_CHOICES.map((v) => ({ value: v, label: EXPLORER_MINIMAP_LABELS[v] }))}
        />
      </Field>
      <Field label="Render characters" searchId="editor.explorer-minimap-characters" help="Draw the actual characters in the minimap instead of plain color blocks.">
        <ToggleSwitch
          checked={minimap.renderCharacters}
          disabled={!minimap.enabled}
          onChange={(v) => onUpdate({ explorerMinimapRenderCharacters: v })}
          label="Render characters"
        />
      </Field>
      {([
        {
          label: 'Minimap vertical size',
          searchId: 'editor.explorer-minimap-vertical-size',
          help: 'Proportional keeps each line a fixed height, Fill stretches the minimap to the full editor height, and Fit shrinks it to fit short files.',
          value: minimap.verticalSize,
          choices: EXPLORER_MINIMAP_VERTICAL_SIZE_CHOICES,
          onChange: (size: string) => onUpdate({ explorerMinimapVerticalSize: size as typeof minimap.verticalSize })
        },
        {
          label: 'Minimap slider',
          searchId: 'editor.explorer-minimap-slider',
          help: 'When the viewport slider is drawn over the minimap.',
          value: minimap.slider,
          choices: EXPLORER_MINIMAP_SLIDER_CHOICES,
          onChange: (slider: string) => onUpdate({ explorerMinimapSlider: slider as typeof minimap.slider })
        },
        {
          label: 'Minimap side',
          searchId: 'editor.explorer-minimap-side',
          help: 'Which edge of the editor the minimap sits on.',
          value: minimap.side,
          choices: EXPLORER_MINIMAP_SIDE_CHOICES,
          onChange: (side: string) => onUpdate({ explorerMinimapSide: side as typeof minimap.side })
        }
      ] as const).map((item) => (
        <Field key={item.searchId} label={item.label} searchId={item.searchId} help={item.help}>
          <PopoverPicklist
            value={item.value}
            ariaLabel={item.label}
            searchable={false}
            disabled={!minimap.enabled}
            onChange={item.onChange}
            options={item.choices.map((v) => ({ value: v, label: EXPLORER_MINIMAP_LABELS[v] }))}
          />
        </Field>
      ))}
    </Section>
  );
}

function ExplorerFileSettings({
  config,
  onUpdate
}: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => void;
}) {
  const fileIconTheme = resolveExplorerFileIconTheme(config);
  return (
    <Section
      anchorId="editor-explorer-files"
      searchId="editor.explorer-files"
      title="Explorer files"
      help="How files are listed in the Explorer, Changes list, Quick Open and Library."
    >
      <Field
        label="File icon theme"
        searchId="editor.explorer-file-icons"
        help="Seti matches VS Code's default icons; Minimal uses one plain file glyph; None hides file and folder icons."
      >
        <PopoverPicklist
          value={fileIconTheme}
          ariaLabel="File icon theme"
          searchable={false}
          onChange={(theme) => onUpdate({ explorerFileIconTheme: theme as typeof fileIconTheme })}
          options={EXPLORER_FILE_ICON_THEME_CHOICES.map((v) => ({ value: v, label: EXPLORER_FILE_ICON_THEME_LABELS[v] }))}
        />
      </Field>
    </Section>
  );
}

export { EditorView as EditorTab };
