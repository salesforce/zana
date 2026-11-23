import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDirectRoutine } from './direct-routines.js';
import { newRoutine, patchRoutine } from './model.js';

const quote = () => newRoutine({ name: 'Bitcoin', kind: 'price', asset: ' btc ', currencies: ['usd', 'CHF', 'USD'], cron: '*/10 * * * *' }, 'btc');
afterEach(() => vi.unstubAllGlobals());

describe('direct routine definitions', () => {
  it('normalizes symbols and revalidates cadence and payload on mode changes', () => {
    const row = { ...quote(), lastPrices: { USD: 100 } };
    expect(row).toMatchObject({ asset: 'BTC', currencies: ['USD', 'CHF'], prompt: '' });
    expect(patchRoutine(row, { enabled: false }).lastPrices).toEqual({ USD: 100 });
    expect(patchRoutine(row, { asset: 'ETH' }).lastPrices).toBeUndefined();
    expect(() => patchRoutine(row, { kind: 'agent', prompt: 'hello' })).toThrow('15 minutes');
    expect(patchRoutine(row, { kind: 'agent', cron: '*/15 * * * *', prompt: 'hello' })).not.toHaveProperty('asset');
    expect(() => patchRoutine(row, { cron: '5,59 * * * *' })).toThrow('10 minutes');
    expect(() => patchRoutine(row, { kind: 'reminder' })).toThrow('prompt');
    expect(() => patchRoutine(row, { kind: 'script' })).toThrow('Unknown');
    for (const [patch, reason] of [
      [{ asset: '../../elsewhere' }, 'symbol'], [{ currencies: [] }, 'one to four'],
      [{ currencies: ['USD', 'CHF', 'EUR', 'AUD', 'GBP'] }, 'one to four'],
      [{ currencies: [9] }, 'three-letter'], [{ prompt: 'also do something else' }, 'additional instructions'],
      [{ kind: 'reminder', asset: 'BTC', prompt: 'hello' }, 'Only price']
    ] as const) expect(() => patchRoutine(row, patch)).toThrow(reason);
  });

  it('fetches all quotes once and compares each with its own last successful price', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { currency: 'BTC', rates: { USD: '10200', CHF: '4950' } } }));
    vi.stubGlobal('fetch', fetch);
    const result = await runDirectRoutine({ ...quote(), lastPrices: { USD: 10000, CHF: 5000 } });
    expect(result.text.replaceAll('\u00a0', ' ')).toBe('BTC $10,200 (+2.00%) · CHF 4,950 (-1.00%)');
    expect(result.prices).toEqual({ USD: 10200, CHF: 4950 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url.href).toBe('https://api.coinbase.com/v2/exchange-rates?currency=BTC');
    expect(init).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });

  it('does not invent a baseline, return partial quotes or include upstream error bodies', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const quotes = (rates: Record<string, unknown>, currency = 'BTC') => Response.json({ data: { currency, rates } });
    fetch.mockResolvedValueOnce(quotes({ USD: '100', CHF: '0.01' }));
    expect((await runDirectRoutine(quote())).text).not.toContain('%');
    for (const [response, message] of [
      [new Response('private upstream details', { status: 429 }), 'HTTP 429'],
      [quotes({}, 'ETH'), 'Invalid exchange-rate'], [Response.json({}), 'Invalid exchange-rate'],
      [quotes({ USD: '10', CHF: {} }), 'BTC/CHF'], [quotes({ USD: 'Infinity' }), 'BTC/USD'],
      [quotes({ USD: '0' }), 'BTC/USD'], [new Response(' '.repeat(131073)), '128 KiB']
    ] as const) {
      fetch.mockResolvedValueOnce(response);
      await expect(runDirectRoutine(quote())).rejects.toThrow(message);
    }
    await expect(runDirectRoutine({ ...quote(), kind: 'agent' })).rejects.toThrow('Invalid direct');
  });
});
