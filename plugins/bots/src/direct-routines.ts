import { boundedJson } from './bounded-json.js';
import type { BotRoutine } from './model.js';

export interface DirectResult {
  text: string;
  prices?: Record<string, number>;
}

/** Only reviewed actions live here. A stored routine supplies data to the action. */
export async function runDirectRoutine(routine: BotRoutine): Promise<DirectResult> {
  if (routine.kind === 'reminder') return { text: routine.prompt };
  if (routine.kind !== 'price' || !routine.asset || !routine.currencies?.length) throw new Error('Invalid direct routine');
  const url = new URL('https://api.coinbase.com/v2/exchange-rates');
  url.searchParams.set('currency', routine.asset);
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Coinbase returned HTTP ${response.status}`);
  }
  const { data } = await boundedJson(response);
  if (!data || typeof data !== 'object' || !('currency' in data) || data.currency !== routine.asset ||
      !('rates' in data) || !data.rates || typeof data.rates !== 'object') throw new Error('Invalid exchange-rate response');
  const rates = data.rates as Record<string, unknown>;
  const prices: Record<string, number> = {};
  const parts = routine.currencies.map(currency => {
    const raw = rates[currency];
    const price = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
    if (!Number.isFinite(price) || price <= 0) throw new Error(`No valid ${routine.asset}/${currency} rate`);
    prices[currency] = price;
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code',
      maximumFractionDigits: price >= 1000 ? 0 : price >= 1 ? 2 : 8, minimumFractionDigits: 0
    }).format(price);
    const previous = routine.lastPrices?.[currency];
    if (!previous) return formatted;
    const delta = (price / previous - 1) * 100;
    return `${formatted} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%)`;
  });
  return { text: `${routine.asset} ${parts.join(' · ')}`, prices };
}
