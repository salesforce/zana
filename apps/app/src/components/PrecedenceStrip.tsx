import {
  precedenceLayerLabel,
  getSettingPrecedence,
  hasOrderStrip,
  precedenceHelp,
  type SettingPrecedenceKey
} from '@zana-ai/zcc-domain/setting-precedence';
import './PrecedenceStrip.css';

/**
 * Generated from the domain precedence table. First-defined settings get an
 * arrowed strip (highest priority first); combining, floor and last-wins
 * settings get one rule line, because left to right would mislead.
 */
export function PrecedenceStrip({ settingKey }: { settingKey: SettingPrecedenceKey }) {
  const row = getSettingPrecedence(settingKey);
  if (!hasOrderStrip(row)) {
    return <p className="precedence-rule settings-help" data-testid={`precedence-${settingKey}`}>{precedenceHelp(settingKey)}</p>;
  }
  return (
    <div className="precedence-strip" role="group" aria-label={`${row.label} priority`} data-testid={`precedence-${settingKey}`}>
      <span className="precedence-direction">Checked first →</span>
      <ol>{row.layers.map((layer) => <li key={layer}>{precedenceLayerLabel(row, layer)}</li>)}</ol>
      <span className="precedence-direction">→ checked last</span>
      <p className="precedence-note">The first layer that sets a value wins.{row.note ? ` ${row.note}` : ''}</p>
    </div>
  );
}
