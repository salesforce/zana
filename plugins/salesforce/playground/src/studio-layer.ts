import type * as Monaco from 'monaco-editor';
import type { StudioComment } from '../../lib/studio-contract.js';
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
export class StudioLayer {
  private session: ProposalSession | null = null;
  private zoneIds: string[] = [];
  private hunkWidgets: Monaco.editor.IContentWidget[] = [];
  private bar: Monaco.editor.IOverlayWidget | null = null;
  private readonly delDecorations: Monaco.editor.IEditorDecorationsCollection;
  private readonly markDecorations: Monaco.editor.IEditorDecorationsCollection;
  private commentZoneIds: string[] = [];
  private comments: StudioComment[] = [];
  private hits: number[] = [];
  private expanded = new Set<string>();
  private editing = false;
  private chip: Monaco.editor.IContentWidget | null = null;
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
    this.editor.changeViewZones(accessor => {
      for (const row of layout) {
        if (row.addLines.length === 0) continue;
        const node = el('div', 'sf-add-zone');
        for (const text of row.addLines) node.appendChild(el('div', 'sf-add-line', text === '' ? ' ' : text));
        this.zoneIds.push(accessor.addZone({ afterLineNumber: Math.min(row.zoneAfterLine, model.getLineCount()), heightInLines: row.addLines.length, domNode: node, suppressMouseDown: true }));
      }
    });
    for (const row of layout) {
      const node = el('div', 'sf-hunk-widget');
      node.appendChild(button('Accept', 'sf-btn is-accept', () => this.acceptHunk(row.index)));
      node.appendChild(button('Reject', 'sf-btn', () => this.rejectHunk(row.index)));
      const widget: Monaco.editor.IContentWidget = {
        getId: () => `sf.hunk.${session.proposalId}.${row.index}`,
        getDomNode: () => node,
        getPosition: () => ({ position: { lineNumber: Math.min(row.widgetLine, model.getLineCount()), column: 1 }, preference: [this.monaco.editor.ContentWidgetPositionPreference.ABOVE, this.monaco.editor.ContentWidgetPositionPreference.BELOW] })
      };
      this.editor.addContentWidget(widget);
      this.hunkWidgets.push(widget);
    }
    const bar = el('div', 'sf-proposal-bar');
    bar.appendChild(el('span', 'sf-proposal-title', `${session.actor}: ${session.summary}`.slice(0, 160)));
    bar.appendChild(el('span', 'sf-proposal-count', proposalLabel(session.hunks.length)));
    bar.appendChild(button('Reject all', 'sf-btn', () => this.rejectAll()));
    bar.appendChild(button('Accept all', 'sf-btn is-accept', () => this.acceptAll()));
    this.bar = { getId: () => 'sf.proposal.bar', getDomNode: () => bar, getPosition: () => ({ preference: this.monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER }) };
    this.editor.addOverlayWidget(this.bar);
  }

  private clearProposalVisuals(): void {
    this.delDecorations.clear();
    this.editor.changeViewZones(accessor => { for (const id of this.zoneIds) accessor.removeZone(id); });
    this.zoneIds = [];
    for (const widget of this.hunkWidgets) this.editor.removeContentWidget(widget);
    this.hunkWidgets = [];
    if (this.bar) this.editor.removeOverlayWidget(this.bar);
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
          row.appendChild(el('div', 'sf-comment-author', `${comment.author.name} - L${comment.line}${comment.endLine > comment.line ? `-${comment.endLine}` : ''}`));
          row.appendChild(el('div', 'sf-comment-body', comment.body));
          node.appendChild(row);
        }
        return accessor.addZone({ afterLineNumber: zone.afterLine, heightInLines: commentZoneHeight(zone.comments), domNode: node, suppressMouseDown: true });
      });
    });
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
    this.post({ type: 'commentAction', kind: 'add', line, endLine: line, quote });
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
    if (!selection || !model) return;
    const lines = model.getValue().split('\n');
    const actions = selectionChipActions(topicAtLine(lines, selection.startLineNumber));
    const node = el('div', 'sf-selection-chip');
    const range = { startLine: selection.startLineNumber, endLine: selection.endLineNumber, text };
    for (const action of actions) {
      node.appendChild(button(action.label, 'sf-btn', () => {
        if (action.id === 'comment') this.post({ type: 'commentAction', kind: 'add', line: range.startLine, endLine: range.endLine, quote: text });
        else this.post({ type: 'askSelection', action: action.id === 'ask' ? 'explain-selection' : 'preview-topic', ...range });
        if (this.chip) { this.editor.removeContentWidget(this.chip); this.chip = null; }
      }));
    }
    this.chip = {
      getId: () => 'sf.selection.chip',
      getDomNode: () => node,
      getPosition: () => ({ position: selection.getEndPosition(), preference: [this.monaco.editor.ContentWidgetPositionPreference.BELOW, this.monaco.editor.ContentWidgetPositionPreference.ABOVE] })
    };
    this.editor.addContentWidget(this.chip);
  }

  dispose(): void {
    this.postCursor.cancel();
    this.clearProposalVisuals();
    this.session = null;
    if (this.chip) this.editor.removeContentWidget(this.chip);
    for (const item of this.disposables) item.dispose();
  }
}
