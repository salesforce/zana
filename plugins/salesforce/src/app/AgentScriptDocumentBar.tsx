import type { ReactNode } from 'react';
import { Bot, Check, Circle, Cloud, CopyPlus, Hammer, PanelRight, Play, Rocket, Save, Search } from 'lucide-react';
import { breadcrumbSegments } from '../../lib/agent-script-file-tree.js';

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
  /** Studio layout: Compile runs the compiler on the saved file, Publish opens the Release tool; QuickOpen is the compact file switcher. */
  onCompile?: () => void;
  /** A compile is in flight. */
  compiling?: boolean;
  onPublish?: () => void;
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
      {props.onQuickOpen && <button type="button" className="icon-btn" title="Go to file (⌘P)" aria-label="Go to file" onClick={props.onQuickOpen}><Search size={15} aria-hidden="true" /></button>}
      {props.onCompile && <button type="button" className="sf-as-save" data-testid="salesforce-agent-script-compile" title={props.dirty ? 'Save first: Compile checks the file on disk' : 'Compile the saved file and show the result under Problems'} disabled={!props.path || props.dirty || props.compiling} onClick={props.onCompile}><Hammer size={13} aria-hidden="true" />{props.compiling ? 'Compiling…' : 'Compile'}</button>}
      {props.orgPicker && <div className="af-document-org"><Cloud size={14} aria-hidden="true" />{props.orgPicker}</div>}
      <button type="button" className={`sf-as-save${props.dirty && !props.saveDisabled ? ' is-dirty' : ''}`} data-testid="salesforce-agent-script-save" aria-label="Save Agentforce file" title="Save Agentforce file (⌘S / Ctrl+S)" hidden={!props.path} disabled={props.saveDisabled} onClick={props.onSave}><Save size={13} aria-hidden="true" />{props.busy ? 'Saving…' : 'Save'}{props.shortcutHint && <kbd className="sf-kbd">⌘S</kbd>}</button>
      <button type="button" className="sf-as-save" title="Save as a new project file" disabled={props.saveAsDisabled} onClick={props.onSaveAs}><CopyPlus size={13} aria-hidden="true" />Save as…</button>
      {props.onPreview && <button type="button" className="sf-as-save" data-testid="salesforce-agent-script-preview" aria-label="Preview" title="Open Preview for this agent" disabled={!props.path} onClick={props.onPreview}><Play size={13} aria-hidden="true" />Preview</button>}
      {props.onPublish && <button type="button" className="sf-as-save" data-testid="salesforce-agent-script-publish" title="Open Release: publish, activate and roll back versions" disabled={!props.path || props.dirty} onClick={props.onPublish}><Rocket size={13} aria-hidden="true" />Publish</button>}
      {!props.panelOpen && !props.hidePanelToggle && <button type="button" className="icon-btn" title="Show side panel" aria-label="Show side panel" aria-expanded={false} onClick={props.onShowPanel}><PanelRight size={15} aria-hidden="true" /></button>}
    </div>
  </div>;
}
