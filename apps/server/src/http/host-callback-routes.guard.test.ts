import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAllowedHttp, isAllowedWs } from './pairing-allowlist.js';
import { isMachinePath } from '../../../../services/mobile-relay/machine-routes.mjs';

/**
 * A remote daemon reaches the product server only through the SSH pairing
 * forwarder (PAIRING_ALLOWLIST) or the Connect relay (machine-routes.mjs).
 * Both are closed lists. A host route that is served and called but missing
 * from either list is refused before it reaches the server: for the fail-closed
 * native tool veto that denied every remote tool call (#713). This guard ties
 * the three surfaces together so a new route cannot ship without its entries.
 */
const here = dirname(fileURLToPath(import.meta.url));
const daemonSrc = join(here, '../../../host-daemon/src');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const ROUTE = /['"`](\/internal\/hosts\/[a-z][a-z/-]*?)\/?['"`]/g;

function routesIn(source: string): Set<string> {
  return new Set([...stripComments(source).matchAll(ROUTE)].map(match => match[1]!));
}

function daemonSources(): string[] {
  return readdirSync(daemonSrc, { recursive: true, encoding: 'utf8' })
    .filter(file => /\.ts$/.test(file) && !/(\.test\.ts$|__tests__)/.test(file))
    .map(file => readFileSync(join(daemonSrc, file), 'utf8'));
}

const WS = '/internal/hosts/ws';
const served = routesIn(readFileSync(join(here, 'host-internal.ts'), 'utf8'));
const called = new Set(daemonSources().flatMap(source => [...routesIn(source)]));

describe('host callback routes reach the server through every remote transport', () => {
  it('discovers the served and called surfaces (the guard is not vacuous)', () => {
    expect(served).toContain('/internal/hosts/native-tool-policy');
    expect(called).toContain('/internal/hosts/native-tool-policy');
    expect(called).toContain(WS);
  });

  it('serves every route the daemon calls', () => {
    expect([...called].filter(route => !served.has(route))).toEqual([]);
  });

  it.each([...new Set([...served, ...called])].sort())('%s is forwarded by the SSH pairing tunnel and the relay', route => {
    if (route === WS) {
      expect(isAllowedWs(route)).toBe(true);
      expect(isMachinePath('GET', route, true)).toBe(true);
      return;
    }
    expect(isAllowedHttp('POST', route)).toBe(true);
    expect(isMachinePath('POST', route)).toBe(true);
  });

  it('keeps the two transport lists identical for host callbacks', () => {
    const probe = [...new Set([...served, ...called])].filter(route => route !== WS);
    for (const route of probe) {
      expect(isAllowedHttp('POST', route), route).toBe(isMachinePath('POST', route));
      expect(isAllowedHttp('GET', route), route).toBe(isMachinePath('GET', route));
    }
  });
});
