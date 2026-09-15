import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('xterm terminals wire OSC 8 away from the default confirm handler', () => {
  it('openXtermHttpLink delegates to handleHttpLinkClick', () => {
    const source = readFileSync(new URL('./xterm-http-link.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { handleHttpLinkClick } from './in-app-browser-link-preference.js'");
    expect(source).toContain('return handleHttpLinkClick(uri, { event, ownerId })');
  });

  it('TerminalView uses openXtermHttpLink for OSC 8 and regex links', () => {
    const source = readFileSync(new URL('../components/TerminalView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('linkHandler: { activate: activateHttpLink }');
    expect(source).toContain('new WebLinksAddon(activateHttpLink)');
    expect(source).toContain('openXtermHttpLink(event, uri, session.id)');
    expect(source).not.toMatch(/window\.open\((uri|['"`])/);
  });

  it('PairingTerminal uses the same OSC 8 handler', () => {
    const source = readFileSync(
      new URL('../views/settings/PairingTerminal.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain('linkHandler: xtermHttpLinkHandler');
  });
});
