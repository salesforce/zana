import { useId } from 'react';
import type { OrgLoginInstance } from '../../lib/org-login.js';

const ENVIRONMENTS = [
  ['production', 'Production', 'Live & developer orgs'],
  ['sandbox', 'Sandbox', 'Test environments'],
  ['custom', 'My Domain', 'Company domain / SSO'],
] as const;

export interface OrgLoginFieldsProps {
  instance: OrgLoginInstance;
  url: string;
  alias: string;
  busy: boolean;
  disabled?: boolean;
  onInstance(value: OrgLoginInstance): void;
  onUrl(value: string): void;
  onAlias(value: string): void;
}

export function OrgLoginFields(props: OrgLoginFieldsProps) {
  const id = useId();
  return <>
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
  </>;
}
