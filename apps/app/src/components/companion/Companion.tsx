import '../../styles/companion.css';
import { CompanionPanel } from './CompanionPanel.js';
import { CompanionRail } from './CompanionRail.js';
import { CompanionTooltip } from './CompanionTooltip.js';

/**
 * Command Center companion surface (`?surface=companion&part=rail|panel|tooltip`).
 * Thin windows over a main-pushed snapshot — never imports the app store.
 */
export function Companion({ part }: { part: string | null }) {
  if (part === 'panel') return <CompanionPanel />;
  if (part === 'tooltip') return <CompanionTooltip />;
  return <CompanionRail />;
}
