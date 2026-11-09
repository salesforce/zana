import { useEffect, useState } from 'react';
import type { CompanionTooltipView } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { agentDot, agentStatusLabel, formatAge } from './companion-model.js';

/**
 * The tooltip window (`part=tooltip`): a click-through strip main parks beside
 * the hovered rail icon. It only draws what main pushes — no requests of its own.
 */
export function CompanionTooltip() {
  const [tip, setTip] = useState<CompanionTooltipView | null>(null);

  useEffect(() => {
    let alive = true;
    let pushed = false;
    const off = product.companion.onTooltip((next) => {
      pushed = true;
      if (alive) setTip(next);
    });
    // The first hover can beat this window's first render: pull what's showing.
    void product.companion.tooltipState().then((t) => {
      if (alive && !pushed) setTip(t);
    }).catch((err) => console.error('[companion] read tooltip:', err));
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    if (tip) document.documentElement.dataset.theme = tip.theme;
  }, [tip?.theme]);

  if (!tip) return null;
  return (
    <div className={`cc-tip-stage cc-rail-${tip.side}`}>
      <div className={`cc-tip${tip.rows ? ' cc-tip-preview' : ''}`} role="tooltip">
        <span className="cc-tip-label">{tip.label}</span>
        {tip.detail && <span className="cc-tip-detail">{tip.detail}</span>}
        {tip.rows && (
          <ul className="cc-tip-rows">
            {tip.rows.map((r, i) => (
              <li key={i} className="cc-tip-row">
                <span className={`cc-dot ${agentDot({ state: r.state, recentlyCompleted: !!r.recentlyCompleted, failure: r.failure })}`} aria-hidden />
                <span className="cc-row-main">
                  <span className="cc-row-title">{r.title}</span>
                  <span className="cc-row-meta">
                    {agentStatusLabel({ state: r.state, recentlyCompleted: !!r.recentlyCompleted, failure: r.failure })} · {r.projectName}
                    {r.state === 'working' && r.createdAt !== undefined ? ` · ${formatAge(r.createdAt, Date.now())}` : ''}
                  </span>
                </span>
              </li>
            ))}
            {!!tip.more && <li className="cc-tip-more">+{tip.more} more — click to see all</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
