import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

it('only honours ZCC_E2E_PEER_SSH_ENDPOINT behind ZCC_E2E_HOME', () => {
  const source = readFileSync(join(here, 'peer-ssh-local.ts'), 'utf8');
  const uses = source.split('\n').filter(line => line.includes('ZCC_E2E_PEER_SSH_ENDPOINT'));
  expect(uses.length).toBeGreaterThan(0);
  expect(source).toMatch(/if \(!env\.ZCC_E2E_HOME \|\| !env\.ZCC_E2E_PEER_SSH_ENDPOINT\) return undefined;/);
});

it('never reads the override variable from any other peers source', () => {
  const peers = ['peer-links.ts', 'peer-invitation.ts', 'peer-link-bootstrap.ts', 'peer-control-protocol.ts'];
  for (const name of peers) {
    let text = '';
    try { text = readFileSync(join(here, name), 'utf8'); } catch { continue; }
    expect(text, name).not.toContain('ZCC_E2E_PEER_SSH_ENDPOINT');
  }
});
