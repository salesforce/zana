import { useEffect, useId, useRef } from 'react';
import type { OrgLoginInstance } from '../../lib/org-login.js';
import { ArrowUpRight, CircleCheck, Cloud } from './components/icons.js';

const ENVIRONMENTS = [
  ['production', 'Production', 'Live & developer orgs'],
  ['sandbox', 'Sandbox', 'Test environments'],
  ['custom', 'My Domain', 'Company domain / SSO'],
] as const;

/** Native top-layer dialog keeps focus and pointer interaction inside the form. */
export function OrgLoginDialog(props: {
  instance: OrgLoginInstance;
  url: string;
  alias: string;
  busy: boolean;
  disabled?: boolean;
  projectId?: string;
  error: string | null;
  onInstance: (value: OrgLoginInstance) => void;
  onUrl: (value: string) => void;
  onAlias: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLInputElement>('input:checked')?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog ref={dialog} className="sf-login-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={event => { event.preventDefault(); props.onClose(); }}>
      <form className="sf-org-login" data-testid="salesforce-org-login" onSubmit={event => { event.preventDefault(); props.onSubmit(); }}>
        <div className="sf-login-heading">
          <div className="sf-login-mark"><Cloud /></div>
          <button type="button" className="sf-btn quiet sf-login-close" aria-label="Close connection dialog" onClick={props.onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <h2 id={`${id}-title`}>Connect an org</h2>
          <p id={`${id}-description`}>Sign in to Salesforce with your browser.</p>
        </div>
        <div className="sf-login-body">
          <fieldset className="sf-login-environments" disabled={props.busy || props.disabled}>
            <legend>Choose your environment</legend>
            <div className="sf-login-options">
              {ENVIRONMENTS.map(([value, title, description]) => (
                <label key={value} className="sf-login-option">
                  <input type="radio" name={`${id}-environment`} value={value} checked={props.instance === value}
                    onChange={() => props.onInstance(value)} aria-label={title} />
                  <span><strong>{title}</strong><small>{description}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          {props.instance === 'custom' && <label className="sf-login-field">
            My Domain URL
            <input className="sf-input" aria-label="My Domain URL" required disabled={props.busy || props.disabled} autoCapitalize="none" spellCheck={false}
              placeholder="company.my.salesforce.com" value={props.url} onChange={event => props.onUrl(event.target.value)} />
          </label>}
          <label className="sf-login-field">
            <span>Org alias <span className="sf-login-optional">Optional</span></span>
            <input className="sf-input" aria-label="Org alias" disabled={props.busy || props.disabled} autoCapitalize="none" spellCheck={false}
              placeholder="e.g. my-dev-org" value={props.alias} onChange={event => props.onAlias(event.target.value)} />
            <small>A short name to recognize this org in Zana and your terminal.</small>
          </label>
          {props.busy ? <div className="sf-login-waiting" role="status">
            <span className="sf-login-spinner" aria-hidden="true" />
            <div><strong>Finish signing in in your browser</strong><span>This will update automatically. You can close this dialog while you wait.</span></div>
          </div> : <div className="sf-login-destination"><CircleCheck /><span>{props.projectId
            ? 'This org will be selected for this project.'
            : 'Choose a shared default after connecting.'}</span></div>}
          {props.error && <p className="sf-login-error" role="alert">{props.error}</p>}
        </div>
        <div className="sf-login-footer">
          <p>Saved to Salesforce CLI.<br />Ready to use in your terminal.</p>
          <div className="sf-login-buttons">
            <button type="button" className="sf-btn quiet" onClick={props.onClose}>{props.busy ? 'Close' : 'Cancel'}</button>
            <button type="submit" className="sf-btn primary" disabled={props.disabled || props.busy}>
              {props.busy ? 'Waiting for sign-in…' : <><span>Sign in with browser</span><ArrowUpRight /></>}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
