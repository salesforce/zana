import { useEffect, useId, useRef } from 'react';
import { OrgLoginFields, type OrgLoginFieldsProps } from './OrgLoginFields.js';
import { ArrowUpRight, CircleCheck, Cloud } from './components/icons.js';

/** Native top-layer dialog keeps focus and pointer interaction inside the form. */
export function OrgLoginDialog(props: OrgLoginFieldsProps & {
  projectId?: string;
  error: string | null;
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
          <OrgLoginFields {...props} />
          {props.busy ? <div className="sf-login-waiting" role="status">
            <span className="sf-login-spinner" aria-hidden="true" />
            <div><strong>Finish signing in in your browser</strong><span>This will update automatically. You can close this dialog while you wait.</span></div>
          </div> : <div className="sf-login-destination"><CircleCheck /><span>{props.projectId
            ? 'This org will be selected for this project.'
            : 'Choose a shared default after connecting.'}</span></div>}
          {props.error && <p className="sf-login-error" role="alert">{props.error}</p>}
        </div>
        <div className="sf-login-footer">
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
