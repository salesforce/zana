import type * as Monaco from 'monaco-editor';
import { STUDIO_LIMITS, type StudioComment } from '../../lib/studio-contract.js';
import { hunkEdit } from '../../lib/line-diff.js';
import { ProposalSession, proposalLabel } from './proposal.js';
import { clipSelectionText, commentMarks, commentZoneHeight, debounce, selectionChipActions, topicAtLine } from './studio-helpers.js';

type PostToHost = (message: Record<string, unknown>) => void;
type Editor = Monaco.editor.IStandaloneCodeEditor;

export const CURSOR_DEBOUNCE_MS = 150;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  // Keep the editor selection/focus while clicking.
  node.addEventListener('mousedown', event => event.preventDefault());
  node.addEventListener('click', event => { event.preventDefault(); onClick(); });
  return node;
}

/**
 * Monaco glue for Studio: agent edit proposals (decorations + view zones + per-hunk widgets + sticky bar), review
 * comment glyphs with inline bodies, preview-hit dots and the selection chip. All geometry comes from the pure
 * helpers in proposal.ts / studio-helpers.ts / lib/line-diff.ts.
 */
/** Height of the spacer row that holds a hunk's Accept/Reject buttons. */
const HUNK_ROW_PX = 26;
/** Height of the inline comment composer: label, two-line box, buttons. */
const COMMENT_COMPOSE_PX = 104;
/** Monaco reports a hidden view zone's top about a million pixels above the viewport. */
const HIDDEN_ZONE_TOP = -100_000;

export class StudioLayer {
  private session: ProposalSession | null = null;
  private zoneIds: string[] = [];
  private hunkWidgets: Monaco.editor.IContentWidget[] = [];
  private bar: HTMLElement | null = null;
  private readonly delDecorations: Monaco.editor.IEditorDecorationsCollection;
  private readonly markDecorations: Monaco.editor.IEditorDecorationsCollection;
  private commentZoneIds: string[] = [];
  private comments: StudioComment[] = [];
  private hits: number[] = [];
  private expanded = new Set<string>();
  private editing = false;
  private chip: Monaco.editor.IContentWidget | null = null;
  private composeZoneId: string | null = null;
  private readonly disposables: Monaco.IDisposable[] = [];
  private readonly postCursor = debounce(() => this.reportCursor(), CURSOR_DEBOUNCE_MS);

  constructor(private readonly monaco: typeof Monaco, private readonly editor: Editor, private readonly post: PostToHost) {
    this.delDecorations = editor.createDecorationsCollection();
    this.markDecorations = editor.createDecorationsCollection();
    this.disposables.push(
      editor.onDidChangeCursorSelection(() => this.postCursor()),
      editor.onDidChangeModelContent(() => { if (!this.editing && this.session) this.rerender(); }),
      editor.onMouseDown(event => this.onGutterClick(event))
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => post({ type: 'saveRequest' }));
  }

  private get model(): Monaco.editor.ITextModel | null {
    return this.editor.getModel();
  }

  // ---- proposals -------------------------------------------------------------------------------------------------

  setProposal(input: { proposalId: string; content: string; summary: string; actor: string }): void {
    if (this.session) this.finishProposal('superseded by a newer proposal');
    this.session = new ProposalSession({ proposalId: input.proposalId, proposed: input.content, summary: input.summary, actor: input.actor });
    this.rerender();
  }

  clearProposal(proposalId: string): void {
    if (this.session?.proposalId !== proposalId) return;
    this.session = null;
    this.clearProposalVisuals();
  }

  /** The open file changed: an unresolved proposal can no longer apply. */
  onFileSwitched(): void {
    this.closeCommentComposer();
    if (this.session) this.finishProposal('file changed');
  }

  acceptHunk(index: number): void {
    const session = this.session;
    const model = this.model;
    if (!session || !model) return;
    const hunk = session.hunks.find(row => row.index === index);
    if (!hunk) return;
    this.applyHunks([hunk]);
    session.noteAccepted(1);
    this.rerender();
  }

  acceptAll(): void {
    const session = this.session;
    if (!session || !this.model) return;
    const pending = [...session.hunks];
    this.applyHunks(pending);
    session.noteAccepted(pending.length);
    this.rerender();
  }

  rejectHunk(index: number): void {
    if (this.session?.rejectHunk(index)) this.rerender();
  }

  rejectAll(): void {
    if (this.session) { this.session.rejectAll(); this.rerender(); }
  }

  private applyHunks(hunks: readonly { index: number; baseStart: number; oldLines: string[]; newLines: string[] }[]): void {
    const model = this.model!;
    const lineCount = model.getLineCount();
    const edits = hunks.map(hunk => {
      const edit = hunkEdit(hunk, hunk.baseStart, lineCount, line => model.getLineLength(line));
      return { range: new this.monaco.Range(edit.startLine, edit.startColumn, edit.endLine, edit.endColumn), text: edit.text };
    });
    this.editing = true;
    try {
      this.editor.executeEdits('agent-proposal', edits);
    } finally {
      this.editing = false;
    }
  }

  private finishProposal(note?: string): void {
    const session = this.session;
    const model = this.model;
    this.session = null;
    this.clearProposalVisuals();
    if (!session || !model) return;
    if (note) session.rejectAll();
    const outcome = session.outcome();
    this.post({ type: 'proposalResolved', proposalId: session.proposalId, ...outcome, ...(note ? { note } : {}), content: model.getValue() });
  }

  private rerender(): void {
    const session = this.session;
    const model = this.model;
    if (!session || !model) return;
    session.refresh(model.getValue());
    if (session.resolved) { this.finishProposal(); return; }
    this.clearProposalVisuals();
    const layout = session.layout();
    this.delDecorations.set(layout.filter(row => row.deleteRange).map(row => ({
      range: new this.monaco.Range(row.deleteRange!.startLine, 1, row.deleteRange!.endLine, 1),
      options: { isWholeLine: true, className: 'sf-del', linesDecorationsClassName: 'sf-del-gutter' }
    })));
    const lineCount = model.getLineCount();
    // Each hunk gets an empty spacer row above it so its Accept/Reject widget never covers code (CodeLens-style).
    // The spacer sorts before the hunk's added lines when both sit after the same line.
    const anchorAfter = (row: (typeof layout)[number]) => Math.min(row.widgetLine - 1, lineCount);
    this.editor.changeViewZones(accessor => {
      for (const row of layout) {
        this.zoneIds.push(accessor.addZone({ afterLineNumber: anchorAfter(row), ordinal: 0, heightInPx: HUNK_ROW_PX, domNode: el('div', 'sf-hunk-spacer'), suppressMouseDown: true }));
        if (row.addLines.length === 0) continue;
        const node = el('div', 'sf-add-zone');
        for (const text of row.addLines) node.appendChild(el('div', 'sf-add-line', text === '' ? ' ' : text));
        this.zoneIds.push(accessor.addZone({ afterLineNumber: Math.min(row.zoneAfterLine, lineCount), ordinal: 1, heightInLines: row.addLines.length, domNode: node, suppressMouseDown: true }));
      }
    });
    const { ABOVE, BELOW } = this.monaco.editor.ContentWidgetPositionPreference;
    for (const row of layout) {
      const node = el('div', 'sf-hunk-widget');
      node.appendChild(button('Accept', 'sf-btn is-accept', () => this.acceptHunk(row.index)));
      node.appendChild(button('Reject', 'sf-btn', () => this.rejectHunk(row.index)));
      const after = anchorAfter(row);
      // Below the line before the hunk lands in the spacer; a hunk at line 1 sits above line 1 (its spacer is first).
      const widget: Monaco.editor.IContentWidget = {
        getId: () => `sf.hunk.${session.proposalId}.${row.index}`,
        getDomNode: () => node,
        getPosition: () => after >= 1
          ? { position: { lineNumber: after, column: 1 }, preference: [BELOW] }
          : { position: { lineNumber: 1, column: 1 }, preference: [ABOVE] }
      };
      this.editor.addContentWidget(widget);
      this.hunkWidgets.push(widget);
    }
    // The summary bar is a strip above the editor, not an overlay, so it never hides the first lines.
    const bar = el('div', 'sf-proposal-bar');
    bar.appendChild(el('span', 'sf-proposal-title', `${session.actor}: ${session.summary}`.slice(0, 160)));
    bar.appendChild(el('span', 'sf-proposal-count', proposalLabel(session.hunks.length)));
    bar.appendChild(button('Reject all', 'sf-btn', () => this.rejectAll()));
    bar.appendChild(button('Accept all', 'sf-btn is-accept', () => this.acceptAll()));
    const container = this.editor.getContainerDomNode();
    container.parentElement?.insertBefore(bar, container);
    this.bar = bar;
  }

  private clearProposalVisuals(): void {
    this.delDecorations.clear();
    this.editor.changeViewZones(accessor => { for (const id of this.zoneIds) accessor.removeZone(id); });
    this.zoneIds = [];
    for (const widget of this.hunkWidgets) this.editor.removeContentWidget(widget);
    this.hunkWidgets = [];
    this.bar?.remove();
    this.bar = null;
  }

  // ---- comments + preview hits ----------------------------------------------------------------------------------

  setComments(comments: StudioComment[]): void {
    this.comments = comments;
    this.renderMarks();
  }

  setHits(lines: number[]): void {
    this.hits = lines;
    this.renderMarks();
  }

  private renderMarks(): void {
    const model = this.model;
    if (!model) return;
    const marks = commentMarks(this.comments, this.hits, model.getLineCount(), this.expanded);
    this.markDecorations.set(marks.glyphs.map(glyph => ({
      range: new this.monaco.Range(glyph.line, 1, glyph.line, 1),
      options: { glyphMarginClassName: glyph.className, glyphMarginHoverMessage: { value: glyph.message } }
    })));
    this.editor.changeViewZones(accessor => {
      for (const id of this.commentZoneIds) accessor.removeZone(id);
      this.commentZoneIds = marks.zones.map(zone => {
        const node = el('div', 'sf-comment-zone');
        for (const comment of zone.comments) {
          const row = el('div', 'sf-comment-row');
          const head = el('div', 'sf-comment-head');
          head.appendChild(el('span', 'sf-comment-author', `${comment.author.name} - L${comment.line}${comment.endLine > comment.line ? `-${comment.endLine}` : ''}${comment.editedAt ? ' (edited)' : ''}`));
          head.appendChild(this.commentActions(comment));
          row.append(head, el('div', 'sf-comment-body', comment.body));
          node.appendChild(row);
        }
        // The row's buttons own their clicks; Monaco must not move the cursor.
        for (const type of ['mousedown', 'pointerdown']) node.addEventListener(type, event => event.stopPropagation());
        return accessor.addZone({ afterLineNumber: zone.afterLine, heightInLines: commentZoneHeight(zone.comments), domNode: node, suppressMouseDown: true });
      });
    });
  }

  /** Edit (own comments only) and Delete, which asks for a second click before it posts. */
  private commentActions(comment: StudioComment): HTMLElement {
    const actions = el('span', 'sf-comment-actions');
    const target = { line: comment.line, endLine: comment.endLine, quote: comment.quote };
    if (comment.author.kind === 'user') {
      actions.appendChild(button('Edit', 'sf-comment-action', () => this.openCommentComposer(comment.line, comment.endLine, comment.quote, { id: comment.id, body: comment.body })));
    }
    const remove = button('Delete', 'sf-comment-action is-danger', () => {
      if (remove.dataset.confirm !== 'true') {
        remove.dataset.confirm = 'true';
        remove.textContent = 'Confirm delete';
        return;
      }
      this.post({ type: 'commentAction', kind: 'delete', id: comment.id, ...target });
    });
    remove.addEventListener('blur', () => { delete remove.dataset.confirm; remove.textContent = 'Delete'; });
    actions.appendChild(remove);
    return actions;
  }

  private onGutterClick(event: Monaco.editor.IEditorMouseEvent): void {
    if (event.target.type !== this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const model = this.model;
    const line = event.target.position?.lineNumber;
    if (!model || !line) return;
    const here = this.comments.filter(row => row.line <= line && line <= row.endLine);
    const quote = clipSelectionText(model.getLineContent(line));
    if (here.length > 0) {
      const open = here.filter(row => !row.resolved);
      const anyShown = open.some(row => this.expanded.has(row.id));
      for (const row of open) { if (anyShown) this.expanded.delete(row.id); else this.expanded.add(row.id); }
      this.renderMarks();
      this.post({ type: 'commentAction', kind: 'open', line: here[0]!.line, endLine: here[0]!.endLine, quote: here[0]!.quote || quote });
      return;
    }
    this.openCommentComposer(line, line, quote);
  }

  /** Opens the comment box in the editor, under the lines it is about. One at a time. With `editing`, it edits that comment. */
  openCommentComposer(line: number, endLine: number, quote: string, editing?: { id: string; body: string }): void {
    this.closeCommentComposer();
    const model = this.model;
    if (!model) return;
    this.showChip(null, '');
    const node = el('form', 'sf-comment-compose');
    node.setAttribute('aria-label', editing ? 'Edit comment' : 'Add comment');
    const lines = `line${endLine > line ? `s ${line}-${endLine}` : ` ${line}`}`;
    node.appendChild(el('div', 'sf-comment-compose-label', editing ? `Edit comment on ${lines}` : `Comment on ${lines}`));
    const input = el('textarea', 'sf-comment-compose-input');
    input.rows = 2;
    input.setAttribute('aria-label', 'Comment');
    input.maxLength = STUDIO_LIMITS.commentBody;
    input.placeholder = 'Add a comment';
    if (editing) input.value = editing.body;
    const submit = (): void => {
      const body = input.value.trim();
      if (!body) return;
      if (editing && body === editing.body.trim()) { this.closeCommentComposer(); this.editor.focus(); return; }
      this.post(editing
        ? { type: 'commentAction', kind: 'update', id: editing.id, line, endLine, quote, body }
        : { type: 'commentAction', kind: 'submit', line, endLine, quote, body });
      this.closeCommentComposer();
      this.editor.focus();
    };
    const add = button(editing ? 'Save' : 'Add comment', 'sf-btn is-accept', submit);
    add.disabled = !input.value.trim();
    const actions = el('div', 'sf-comment-compose-actions');
    actions.append(add, button('Cancel', 'sf-btn', () => { this.closeCommentComposer(); this.editor.focus(); }));
    node.append(input, actions);
    input.addEventListener('input', () => { add.disabled = !input.value.trim(); });
    node.addEventListener('submit', event => { event.preventDefault(); submit(); });
    // The box owns its keys and clicks; Monaco must not move the cursor or type into the code.
    for (const type of ['mousedown', 'pointerdown', 'keydown', 'keypress', 'keyup']) node.addEventListener(type, event => event.stopPropagation());
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.closeCommentComposer(); this.editor.focus(); }
      else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
    });
    // Monaco sets the zone node's display, so the form lays out inside a plain wrapper.
    const zone = el('div', 'sf-comment-compose-zone');
    zone.appendChild(node);
    // Monaco adds the zone hidden and shows it on a later render (which an unfocused window can delay a lot), so the
    // box takes focus the first time Monaco places it. onDomNodeTop runs just before Monaco sets the zone's display.
    let focused = false;
    const onDomNodeTop = (top: number): void => {
      if (focused || top < HIDDEN_ZONE_TOP) return;
      focused = true;
      queueMicrotask(() => { if (input.isConnected) input.focus(); });
    };
    this.editor.changeViewZones(accessor => {
      this.composeZoneId = accessor.addZone({ afterLineNumber: Math.min(endLine, model.getLineCount()), ordinal: 2, heightInPx: COMMENT_COMPOSE_PX, domNode: zone, suppressMouseDown: true, onDomNodeTop });
    });
  }

  closeCommentComposer(): void {
    const id = this.composeZoneId;
    if (!id) return;
    this.composeZoneId = null;
    this.editor.changeViewZones(accessor => accessor.removeZone(id));
  }

  // ---- cursor + selection chip ---------------------------------------------------------------------------------

  private reportCursor(): void {
    const model = this.model;
    const selection = this.editor.getSelection();
    const position = this.editor.getPosition();
    if (!model || !position) return;
    const text = selection && !selection.isEmpty() ? clipSelectionText(model.getValueInRange(selection)) : '';
    this.post({
      type: 'cursor', line: position.lineNumber, column: position.column,
      ...(selection && text ? { selection: { startLine: selection.startLineNumber, endLine: selection.endLineNumber, text } } : {})
    });
    this.showChip(selection && text ? selection : null, text);
  }

  private showChip(selection: Monaco.Selection | null, text: string): void {
    if (this.chip) { this.editor.removeContentWidget(this.chip); this.chip = null; }
    const model = this.model;
    if (!selection || !model || this.composeZoneId) return;
    const lines = model.getValue().split('\n');
    const actions = selectionChipActions(topicAtLine(lines, selection.startLineNumber));
    const node = el('div', 'sf-selection-chip');
    const range = { startLine: selection.startLineNumber, endLine: selection.endLineNumber, text };
    for (const action of actions) {
      node.appendChild(button(action.label, 'sf-btn', () => {
        if (action.id === 'comment') this.openCommentComposer(range.startLine, range.endLine, text);
        else this.post({ type: 'askSelection', action: action.id === 'ask' ? 'explain-selection' : 'preview-topic', ...range });
        if (this.chip) { this.editor.removeContentWidget(this.chip); this.chip = null; }
      }));
    }
    // Like the comment rows: the chip's buttons own their clicks, so Monaco must not take focus back from the box they open.
    for (const type of ['mousedown', 'pointerdown']) node.addEventListener(type, event => event.stopPropagation());
    this.chip = {
      getId: () => 'sf.selection.chip',
      getDomNode: () => node,
      // Above the selection's first line, so the chip never covers the code that follows it.
      getPosition: () => ({ position: selection.getStartPosition(), preference: [this.monaco.editor.ContentWidgetPositionPreference.ABOVE, this.monaco.editor.ContentWidgetPositionPreference.BELOW] })
    };
    this.editor.addContentWidget(this.chip);
  }

  dispose(): void {
    this.postCursor.cancel();
    this.clearProposalVisuals();
    this.session = null;
    if (this.chip) this.editor.removeContentWidget(this.chip);
    this.closeCommentComposer();
    for (const item of this.disposables) item.dispose();
  }
}
