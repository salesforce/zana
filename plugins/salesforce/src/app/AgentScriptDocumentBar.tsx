import type { ReactNode } from 'react';
import { Bot, Check, Circle, Cloud, CopyPlus, Hammer, PanelRight, Rocket, Save, Search } from 'lucide-react';
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
  onBrowse: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onShowPanel: () => void;
  /** Studio layout: Compile / Publish hand the file to the agent; QuickOpen is the compact file switcher. */
  onCompile?: () => void;
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
      {props.headerActions}
      {props.onQuickOpen && <button type="button" className="icon-btn" title="Go to file (⌘P)" aria-label="Go to file" onClick={props.onQuickOpen}><Search size={15} aria-hidden="true" /></button>}
      {props.onCompile && <button type="button" className="sf-as-save" data-testid="salesforce-agent-script-compile" title="Compile and diagnose with the agent" disabled={!props.path} onClick={props.onCompile}><Hammer size={13} aria-hidden="true" />Compile</button>}
      {props.orgPicker && <div className="af-document-org"><Cloud size={14} aria-hidden="true" />{props.orgPicker}</div>}
      <button type="button" className={`sf-as-save${props.dirty && !props.saveDisabled ? ' is-dirty' : ''}`} data-testid="salesforce-agent-script-save" aria-label="Save Agentforce file" title="Save Agentforce file (⌘S / Ctrl+S)" hidden={!props.path} disabled={props.saveDisabled} onClick={props.onSave}><Save size={13} aria-hidden="true" />{props.busy ? 'Saving…' : 'Save'}{props.shortcutHint && <kbd className="sf-kbd">⌘S</kbd>}</button>
      <button type="button" className="sf-as-save" title="Save as a new project file" disabled={props.saveAsDisabled} onClick={props.onSaveAs}><CopyPlus size={13} aria-hidden="true" />Save as…</button>
      {props.onPublish && <button type="button" className="sf-as-save" data-testid="salesforce-agent-script-publish" title="Review and publish to the org as an inactive version" disabled={!props.path || props.dirty} onClick={props.onPublish}><Rocket size={13} aria-hidden="true" />Publish</button>}
      {!props.panelOpen && !props.hidePanelToggle && <button type="button" className="icon-btn" title="Show side panel" aria-label="Show side panel" aria-expanded={false} onClick={props.onShowPanel}><PanelRight size={15} aria-hidden="true" /></button>}
    </div>
  </div>;
}
