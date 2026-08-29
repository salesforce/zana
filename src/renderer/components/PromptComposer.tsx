import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';
import { useFileDrop } from '../util/useFileDrop';
import { useData } from '../store';
import { fuzzyScore } from '../util/fuzzy';
import { detectMention, applyMention, type MentionMatch } from '../util/mention';
import { highlightMatches } from './palette/highlight';
import { ImprovePromptButton } from './ImprovePromptButton';
import { VoiceInputButton } from './VoiceInputButton';
import { AttachmentPills } from './ui/AttachmentPills';
import { ComposerIconButton } from './ui/CommandComposer';
import type { WalkedFile } from '@shared/types';
import type { AutoGrowTextareaHandle } from './ui/CommandComposer';

/**
 * The agent-instruction box, shared by every launcher that takes a typed prompt
 * (the project launcher, the quick-agent launcher). Owns the behaviour that was
 * previously copy-pasted across those surfaces:
 *   - ⌘/Ctrl+Enter submits (Enter alone keeps a multi-line instruction),
 *   - attach or drop files as removable pills, with a `drop-over` highlight
 *     while dragging,
 *   - type `@` to fuzzy-search files in the target project and insert one at the
 *     caret (see {@link useMention}) — only when a `mentionProjectPath` is given.
 *
 * State stays lifted in the parent (controlled `value`/`onChange`) because each
 * launcher seeds and reads the prompt for its own argv assembly. The parent
 * grabs a {@link PromptComposerHandle} ref to autofocus.
 */
export interface PromptComposerHandle {
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Invoked on ⌘/Ctrl+Enter. */
  onSubmit: () => void;
  /** Use the calmer Home command surface for a quick-agent launch. */
  variant?: 'default' | 'home';
  /** Prevent the inline Home-style launch button from submitting. */
  submitDisabled?: boolean;
  /** Accessible action name for the inline Home-style launch button. */
  submitLabel?: string;
  placeholder?: string;
  rows?: number;
  /** Absolute path of the project whose files back the `@`-mention picker. When
   *  absent (e.g. scratch mode with no resolved project) `@` does nothing. */
  mentionProjectPath?: string;
  attachments: readonly string[];
  onAddAttachments: (paths: string[]) => void;
  onRemoveAttachment: (path: string) => void;
  onPickAttachments?: () => void | Promise<void>;
  attachmentDropEnabled?: boolean;
}

/** Most files to rank/show in the `@`-mention popover at once. */
const MENTION_MAX_RESULTS = 8;

interface Ranked {
  file: WalkedFile;
  matchIdx: number[];
}

/**
 * The `@`-mention picker state machine for one textarea. Watches the caret,
 * lazily walks the project's files once per path, ranks them with the shared
 * `fuzzyScore`, and returns the render props for a popover plus a keydown
 * handler that steals ↑/↓/Enter/Tab/Esc while the popover is open. Selecting a
 * row splices the file's posix `rel` path at the mention token.
 */
function useMention(
  value: string,
  onChange: (v: string) => void,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  projectPath: string | undefined
) {
  const [mention, setMention] = useState<MentionMatch | null>(null);
  const [active, setActive] = useState(0);
  // Files cached per project path — a walk can be large, so do it once.
  const filesRef = useRef<{ path: string; files: WalkedFile[] } | null>(null);
  const [files, setFiles] = useState<WalkedFile[] | null>(null);

  // Recompute the mention token from the live caret position.
  const refresh = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !projectPath) {
      setMention(null);
      return;
    }
    const m = detectMention(el.value, el.selectionStart ?? el.value.length);
    setMention(m);
    if (m) setActive(0);
  }, [projectPath, textareaRef]);

  // Load the project's file list the first time a mention opens for this path.
  useEffect(() => {
    if (!mention || !projectPath) return;
    if (filesRef.current?.path === projectPath) {
      setFiles(filesRef.current.files);
      return;
    }
    let cancelled = false;
    void window.cc.fs.walkFiles(projectPath).then((list) => {
      if (cancelled) return;
      filesRef.current = { path: projectPath, files: list };
      setFiles(list);
    });
    return () => {
      cancelled = true;
    };
  }, [mention, projectPath]);

  // Rank the walked files against the current query (empty query → first N).
  let ranked: Ranked[] = [];
  if (mention && files) {
    const q = mention.query;
    if (!q) {
      ranked = files.slice(0, MENTION_MAX_RESULTS).map((file) => ({ file, matchIdx: [] }));
    } else {
      ranked = files
        .map((file) => {
          const s = fuzzyScore(file.rel, q);
          return s ? { file, score: s.score, matchIdx: s.matchIdx } : null;
        })
        .filter((r): r is Ranked & { score: number } => r !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, MENTION_MAX_RESULTS)
        .map(({ file, matchIdx }) => ({ file, matchIdx }));
    }
  }

  const open = mention !== null && ranked.length > 0;

  const choose = useCallback(
    (file: WalkedFile) => {
      const el = textareaRef.current;
      if (!el || !mention) return;
      const caret = el.selectionStart ?? el.value.length;
      const out = applyMention(value, mention, caret, file.rel);
      onChange(out.value);
      setMention(null);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(out.caret, out.caret);
      });
    },
    [mention, onChange, textareaRef, value]
  );

  // Steal navigation keys only while the popover is open; returns true if handled.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % ranked.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + ranked.length) % ranked.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(ranked[Math.min(active, ranked.length - 1)].file);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return true;
      }
      return false;
    },
    [open, ranked, active, choose]
  );

  const close = useCallback(() => setMention(null), []);

  return { open, ranked, active, setActive, choose, refresh, close, onKeyDown };
}

export const PromptComposer = forwardRef<PromptComposerHandle, Props>(function PromptComposer(
  {
    value,
    onChange,
    onSubmit,
    variant = 'default',
    submitDisabled = false,
    submitLabel = 'Launch agent',
    placeholder,
    rows = 3,
    mentionProjectPath,
    attachments,
    onAddAttachments,
    onRemoveAttachment,
    onPickAttachments,
    attachmentDropEnabled = true
  },
  ref
) {
  const nativeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = useRef<AutoGrowTextareaHandle | null>(null);
  const textElement = () => nativeTextareaRef.current;
  const voiceInputEnabled = useData((s) => s.voiceInputEnabled);
  useImperativeHandle(ref, () => ({ focus: () => textElement()?.focus() }), []);

  const mention = useMention(value, onChange, nativeTextareaRef, mentionProjectPath);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.onKeyDown(e)) return; // popover consumed the key
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitDisabled) onSubmit();
    }
  };

  const { dropOver, dropHandlers } = useFileDrop(
    (paths) => onAddAttachments(paths.split('\n')),
    (paths) => paths.join('\n')
  );

  const homeVariant = variant === 'home';

  return (
    <div
      className={`${homeVariant ? 'ui-command-composer prompt-composer--home' : 'prompt-composer'} ${dropOver ? (homeVariant ? 'is-drop-over' : 'drop-over') : ''}`}
      {...(attachmentDropEnabled ? dropHandlers : {})}
      {...(homeVariant ? { role: 'group', 'aria-label': 'Agent instruction' } : {})}
    >
      <AttachmentPills paths={attachments} onRemove={onRemoveAttachment} />
      <textarea
        ref={(node) => {
          nativeTextareaRef.current = node;
          textareaRef.current = node ? { focus: () => node.focus(), element: () => node } : null;
        }}
        data-testid="launch-instruction"
        className={homeVariant ? 'ui-command-composer-input' : 'launch-instruction'}
        placeholder={placeholder}
        aria-label={homeVariant ? 'Instruction for the new agent' : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          mention.refresh();
        }}
        onKeyUp={mention.refresh}
        onClick={mention.refresh}
        onBlur={() => {
          // Close on blur — but a row's mousedown (which preventDefaults, so the
          // textarea keeps focus) fires its choose() first, so a genuine click
          // still lands. A short delay guards against focus-shuffle races.
          window.setTimeout(mention.close, 120);
        }}
        onKeyDown={onKeyDown}
        rows={rows}
      />
      {mention.open && (
        <div className="mention-popover" role="listbox" aria-label="Insert file">
          {mention.ranked.map((r, i) => (
            <button
              type="button"
              key={r.file.rel}
              role="option"
              aria-selected={i === mention.active}
              className={`palette-item mention-item ${i === mention.active ? 'active' : ''}`}
              // mousedown (not click) so it fires before the textarea's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                mention.choose(r.file);
              }}
              onMouseEnter={() => mention.setActive(i)}
            >
              {highlightMatches(r.file.rel, r.matchIdx)}
            </button>
          ))}
        </div>
      )}
      {homeVariant ? (
        <div className="ui-command-composer-toolbar prompt-composer-home-toolbar">
          <ComposerIconButton
            onClick={() => { void (onPickAttachments ? onPickAttachments() : window.cc.fs.pickFiles().then(onAddAttachments)); }}
            title="Attach files"
            aria-label="Attach files"
          >
            <Paperclip size={16} aria-hidden="true" />
          </ComposerIconButton>
          <div className="prompt-composer-home-actions">
            {voiceInputEnabled && (
              <VoiceInputButton value={value} onChange={onChange} textareaRef={textareaRef} iconOnly />
            )}
            <ComposerIconButton
              className="prompt-composer-home-launch"
              onClick={onSubmit}
              disabled={submitDisabled}
              aria-label={submitLabel}
              title={`${submitLabel} (⌘↵)`}
            >
              <ArrowUp size={17} aria-hidden="true" />
            </ComposerIconButton>
          </div>
        </div>
      ) : (
        <div className="prompt-composer-actions">
          <div className="prompt-composer-input-actions">
            <ComposerIconButton
              onClick={() => { void (onPickAttachments ? onPickAttachments() : window.cc.fs.pickFiles().then(onAddAttachments)); }}
              title="Attach files"
              aria-label="Attach files"
            >
              <Paperclip size={16} aria-hidden="true" />
            </ComposerIconButton>
            {voiceInputEnabled && (
              <VoiceInputButton value={value} onChange={onChange} textareaRef={textareaRef} />
            )}
          </div>
          <ImprovePromptButton value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
});
