import { Eye, Pause, Play } from 'lucide-react';
import type { HeldReveal } from './follow-gate.js';

/** Who the Studio follows, with a pause: while paused the agent's reveals wait for the user. */
export function FollowChip(props: { driver?: string; paused: boolean; onToggle: () => void }) {
  const label = props.paused ? 'Following paused' : `Following ${props.driver ?? 'the agent'}`;
  const action = props.paused ? 'Resume' : 'Pause';
  return <button type="button" className={`sf-follow-chip${props.paused ? ' is-paused' : ''}`} data-testid="salesforce-follow-chip"
    aria-pressed={!props.paused} aria-label={`${label}: ${action}`} onClick={props.onToggle}
    title={props.paused ? 'Resume: the agent can move the editor again' : 'Pause: the agent\'s reveals wait until you resume'}>
    {props.paused ? <Pause size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
    <span className="sf-follow-label">{label}</span>
    <span className="sf-follow-action">{props.paused ? <Play size={11} aria-hidden="true" /> : <Pause size={11} aria-hidden="true" />}<span className="sf-follow-action-text">{action}</span></span>
  </button>;
}

/** A reveal the Studio held back because the user was typing or following was paused. */
export function FollowToast(props: { held: HeldReveal; onShow: () => void; onDismiss: () => void }) {
  const why = props.held.reason === 'typing' ? 'Held while you were typing.' : 'Held while following is paused.';
  return <div className="sf-follow-toast" role="status" data-testid="salesforce-follow-toast">
    <span><strong>{props.held.who}</strong> wants to {props.held.label}. <span className="sf-follow-why">{why}</span></span>
    <button type="button" className="sf-btn-small" onClick={props.onShow}>Show</button>
    <button type="button" className="sf-btn-small" onClick={props.onDismiss}>Dismiss</button>
  </div>;
}
