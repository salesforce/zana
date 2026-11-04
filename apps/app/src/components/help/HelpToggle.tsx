import { CircleHelp } from 'lucide-react';
import { useHelp } from './HelpProvider.js';
import '../../styles/contextual-help.css';

/** Mobile navigation Help entry: toggles page hints. The title bar uses {@link HelpMenu}. */
export function HelpToggle() {
  const { enabled, setEnabled } = useHelp();
  return <button type="button" data-help-toggle="mobile" data-testid="mobile-help-toggle"
    className={`mobile-nav-notifications mobile-nav-help${enabled ? ' is-active' : ''}`}
    aria-label="Help" aria-pressed={enabled} title={enabled ? 'Hide page hints' : 'Show page hints'}
    onClick={(event) => { event.currentTarget.focus(); setEnabled(!enabled); }}>
    <CircleHelp size={18} aria-hidden="true" />
    Help <span className="mobile-nav-help-status" aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
  </button>;
}
