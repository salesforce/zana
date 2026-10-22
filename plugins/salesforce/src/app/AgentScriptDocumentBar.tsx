import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, Check, ChevronDown, Circle, CloudDownload, CopyPlus, ExternalLink, Hammer, PanelRight, Play, Save, Search } from 'lucide-react';
import { breadcrumbSegments } from '../../lib/agent-script-file-tree.js';
import { modShortcut } from './shortcut-label.js';

type DocumentBarProps = {
  path: string | null;
  dirty: boolean;
  busy: boolean;
  issues: number;
  saveDisabled: boolean;
  saveAsDisabled: boolean;
  panelOpen: boolean;
  orgPicker?: ReactNode;
  headerActions?: ReactNode;
  /** The Following chip: who moves this editor, with a pause. */
  follow?: ReactNode;
  onBrowse: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onShowPanel: () => void;
  /** Open the current agent's Preview tool, retaining any running conversation. */
  onPreview?: () => void;
  /** Studio layout: Compile runs the compiler on the saved file; QuickOpen is the compact file switcher. */
  onCompile?: () => void;
  /** A compile is in flight. */
  compiling?: boolean;
  /** Open the saved agent in the org's Agentforce Builder, in Chrome. */
  onOpenInBuilder?: () => void;
  /** The builder is being opened. */
  openingBuilder?: boolean;
  /** Fetch the saved agent and the Apex, Flows and prompt templates its actions call from the org. */
  onFetch?: () => void;
  onQuickOpen?: () => void;
  /** Show the Cmd/Ctrl+S hint on the Save button (wide layout). */
  shortcutHint?: boolean;
  /** Hide the "show side panel" button when an external strip owns tool switching. */
  hidePanelToggle?: boolean;
};

export function AgentScriptDocumentBar(props: DocumentBarProps) {
  const segments = breadcrumbSegments(props.path);
  const name = segments.at(-1) ?? 'No agent open';
  const folder = segments.slice(0, -1).join(' / ');
  const state = props.busy ? 'Saving…' : props.dirty ? 'Unsaved draft' : props.path ? 'Saved' : 'Open or create an agent';
  return <div className="af-document-bar">
    <div className="af-document-identity">
      <button type="button" className="icon-btn af-document-icon" title="Browse org agents" aria-label="Browse org agents" onClick={props.onBrowse}><Bot size={17} aria-hidden="true" /></button>
      <div className="af-document-file" aria-label="Agentforce file" title={props.path || name}>
        <div className="af-document-name">{name}</div>
        <div className="af-document-details">
          {folder && <span className="af-document-folder">{folder}</span>}
          <span className="af-draft-state" data-dirty={props.dirty} role="status">
            {props.path && !props.dirty && !props.busy ? <Check size={11} aria-hidden="true" /> : <Circle size={6} fill="currentColor" aria-hidden="true" />}
            {state}
          </span>
          {props.issues > 0 && <span className="af-document-issues">{props.issues} {props.issues === 1 ? 'issue' : 'issues'}</span>}
        </div>
      </div>
    </div>
    <div className="af-document-actions">
      {props.follow}
      {props.headerActions}
      {props.onQuickOpen && <button type="button" className="icon-btn" title={`Go to file (${modShortcut('P')})`} aria-label="Go to file" onClick={props.onQuickOpen}><Search size={15} aria-hidden="true" /></button>}
      {props.onFetch && <button type="button" className="icon-btn" data-testid="salesforce-agent-script-fetch" aria-label="Fetch agent from org" title={props.dirty ? 'Save first: Fetch reads what the saved file uses' : 'Fetch this agent and what it uses from the org'} disabled={!props.path || props.dirty} onClick={props.onFetch}><CloudDownload size={15} aria-hidden="true" /></button>}
      {props.onCompile && <button type="button" className={`icon-btn af-document-compile${props.compiling ? ' is-busy' : ''}`} data-testid="salesforce-agent-script-compile" aria-label={props.compiling ? 'Compiling…' : 'Compile'} title={props.dirty ? 'Save first: Compile checks the file on disk' : props.compiling ? 'Compiling…' : 'Compile the saved file and show the result under Problems'} disabled={!props.path || props.dirty || props.compiling} onClick={props.onCompile}><Hammer size={15} aria-hidden="true" /></button>}
      {props.onOpenInBuilder && <button type="button" className={`icon-btn${props.openingBuilder ? ' is-busy' : ''}`} data-testid="salesforce-agent-script-open-builder" aria-label="Open in Agentforce Builder" title="Open in Agentforce Builder (Chrome)" disabled={!props.path || props.openingBuilder} onClick={props.onOpenInBuilder}><ExternalLink size={15} aria-hidden="true" /></button>}
      {props.orgPicker && <div className="af-document-org">{props.orgPicker}</div>}
      {props.path
        ? <SaveSplit {...props} />
        : <button type="button" className={`sf-as-save${props.dirty && !props.saveAsDisabled ? ' is-dirty' : ''}`} title="Save as a new project file" disabled={props.saveAsDisabled} onClick={props.onSaveAs}><CopyPlus size={13} aria-hidden="true" />Save as…</button>}
      {props.onPreview && <button type="button" className="sf-as-save" data-testid="salesforce-agent-script-preview" aria-label="Preview" title="Open Preview for this agent" disabled={!props.path} onClick={props.onPreview}><Play size={13} aria-hidden="true" />Preview</button>}
      {!props.panelOpen && !props.hidePanelToggle && <button type="button" className="icon-btn" title="Show side panel" aria-label="Show side panel" aria-expanded={false} onClick={props.onShowPanel}><PanelRight size={15} aria-hidden="true" /></button>}
    </div>
  </div>;
}

/** Save, with Save as… under its arrow. */
function SaveSplit(props: DocumentBarProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const primary = props.dirty && !props.saveDisabled ? ' is-dirty' : '';
  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  // A menu left open while Save as… becomes unavailable closes instead of offering a dead item.
  const menuDisabled = props.saveAsDisabled;
  useEffect(() => { if (menuDisabled) setOpen(false); }, [menuDisabled]);
  return <div className="sf-as-split" ref={root} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation(); setOpen(false);
    root.current?.querySelector<HTMLButtonElement>('.sf-as-save-more')?.focus();
  }}>
    <button type="button" className={`sf-as-save${primary}`} data-testid="salesforce-agent-script-save" aria-label="Save Agentforce file" title={`Save Agentforce file (${modShortcut('S')})`} disabled={props.saveDisabled} onClick={props.onSave}><Save size={13} aria-hidden="true" />{props.busy ? 'Saving…' : 'Save'}{props.shortcutHint && <kbd className="sf-kbd">⌘S</kbd>}</button>
    <button type="button" className={`sf-as-save sf-as-save-more${primary}`} aria-label="More save options" title="More save options" aria-haspopup="menu" aria-expanded={open} disabled={menuDisabled} onClick={() => setOpen(value => !value)}><ChevronDown size={13} aria-hidden="true" /></button>
    {open && <div className="sf-as-save-menu" role="menu" aria-label="Save options">
      <button ref={item} type="button" role="menuitem" disabled={props.saveAsDisabled} onClick={() => { setOpen(false); props.onSaveAs(); }}><CopyPlus size={13} aria-hidden="true" />Save as…</button>
    </div>}
  </div>;
}
