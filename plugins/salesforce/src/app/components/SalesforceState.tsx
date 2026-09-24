import type { ReactNode } from 'react';
import { Bot, Cloud, Code2, Database, FileText, Package, Search, Unplug } from 'lucide-react';
import { SALESFORCE_STATE_STYLES } from './state-styles.js';

const ICONS = { cloud: Cloud, agents: Bot, data: Database, code: Code2, logs: FileText, deploy: Package, search: Search };
export type SalesforceStateArt = keyof typeof ICONS;

/** Plugin-owned companion to the host's illustrated pane states. */
export function SalesforceState({
  kind = 'empty', art = 'cloud', title, children, action, compact = false,
}: {
  kind?: 'empty' | 'loading' | 'error';
  art?: SalesforceStateArt;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  const Icon = kind === 'error' ? Unplug : ICONS[art];
  return <><style>{SALESFORCE_STATE_STYLES}</style><div className="sf-state" data-kind={kind} data-art={art} data-compact={compact || undefined}
    role={kind === 'loading' ? 'status' : kind === 'error' ? 'alert' : undefined}>
    <div className="sf-state-art" aria-hidden="true">
      <span className="sf-state-orbit" />
      <span className="sf-state-spark sf-state-spark--one" />
      <span className="sf-state-spark sf-state-spark--two" />
      <div className="sf-state-window sf-state-window--back" />
      <div className="sf-state-window">
        <div className="sf-state-window-bar"><i /><i /><i /><Cloud /></div>
        <div className="sf-state-window-body"><span /><span /><span /></div>
      </div>
      <span className="sf-state-badge"><Icon strokeWidth={1.6} /></span>
    </div>
    <div className="sf-state-copy"><h3>{title}</h3>{children && <div className="sf-state-hint">{children}</div>}</div>
    {action && <div className="sf-state-actions">{action}</div>}
  </div></>;
}

export function EmptyState({ title, children, action, art, compact }: {
  title: string; children?: ReactNode; action?: ReactNode; art?: SalesforceStateArt; compact?: boolean;
}) {
  return <SalesforceState title={title} art={art} action={action} compact={compact}>{children}</SalesforceState>;
}

export function LoadingState({ label = 'Loading Salesforce…', hint, art, compact }: {
  label?: string; hint?: string; art?: SalesforceStateArt; compact?: boolean;
}) {
  return <SalesforceState kind="loading" title={label} art={art} compact={compact}>{hint}</SalesforceState>;
}
