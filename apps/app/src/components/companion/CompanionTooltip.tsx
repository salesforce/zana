import { useEffect, useState } from 'react';
import type { CompanionTooltipView } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';

/**
 * The tooltip window (`part=tooltip`): a click-through strip main parks beside
 * the hovered rail icon. It only draws what main pushes — no requests of its own.
 */
export function CompanionTooltip() {
  const [tip, setTip] = useState<CompanionTooltipView | null>(null);

  useEffect(() => {
    const off = product.companion.onTooltip(setTip);
    // The first hover can beat this window's first render: pull what's showing.
    void product.companion.tooltipState().then((t) => t && setTip((cur) => cur ?? t));
    return off;
  }, []);

  useEffect(() => {
    if (tip) document.documentElement.dataset.theme = tip.theme;
  }, [tip?.theme]);

  if (!tip) return null;
  return (
    <div className={`cc-tip-stage cc-rail-${tip.side}`}>
      <div className="cc-tip" role="tooltip">
        <span className="cc-tip-label">{tip.label}</span>
        {tip.detail && <span className="cc-tip-detail">{tip.detail}</span>}
      </div>
    </div>
  );
}
