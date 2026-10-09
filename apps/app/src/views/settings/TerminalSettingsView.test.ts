import { describe, expect, it, vi } from 'vitest';
import { verifyTmux } from '@/views/settings/TerminalSettingsView';
import { searchSettings } from '@/lib/settings-search';
import { getStaticEntries } from '@/lib/settings-search/registry';
import { findSecretValueViolations } from '@/lib/settings-search/secrets';
import { keyboardSearchProvider } from '@/lib/settings-search/providers/keyboard';

describe('TerminalTab tmux verification', () => {
  it('returns an accessible error state after a rejected verification', async () => {
    const check = vi.fn().mockRejectedValue(new Error('IPC unavailable'));

    await expect(verifyTmux(check)).resolves.toEqual({
      status: null,
      error: 'Could not check tmux: IPC unavailable'
    });
  });
});

describe('Config pages are searchable (values, options, synonyms)', () => {
  const cfg = (c: Record<string, unknown>) => ({ config: c as never });
  const top = (q: string, c: Record<string, unknown> = {}) => searchSettings(q, cfg(c)).map((h) => h.entry.id);

  it('finds help-only text and synonyms on every Config page', () => {
    expect(top('OSC 52')).toContain('terminal.clipboard-write');
    expect(top('pagers')).toContain('terminal.wheel-scroll');
    expect(top('dracula')).toContain('terminal.theme');
    expect(top('yolo')).toContain('composer.full-access');
    expect(top('hint cards')).toContain('inbox.show-guidance');
    expect(top('hotkeys')).toContain('keyboard.all-shortcuts');
    expect(top('cookies logged in')).toContain('browser.import-intro');
    expect(top('shadowing')).toContain('prompts.intro');
    expect(top('jetbrains')).toContain('editor.intellij');
    expect(top('zcc-cli')).toContain('global.cli-skills-intro');
    expect(top('repair')).toContain('global.call-doctor');
  });

  it('finds typos on Config pages', () => {
    expect(top('tmxu')).toContain('terminal.tmux-persistence');
  });

  it('searches current values: enums by option label, booleans On/Off, paths and numbers', () => {
    expect(top('dark', { theme: 'dark' })).toContain('global.theme');
    expect(top('remote only', { tmuxScope: 'remote' })).toContain('terminal.tmux-persistence');
    expect(top('/opt/zsh', { shell: '/opt/zsh' })).toContain('terminal.default-shell');
    expect(top('Dracula', { terminalTheme: 'dracula' })).toContain('terminal.theme');
    expect(top('Steer', { steerActiveThreadOnEnter: true })).toContain('composer.send-mode');
    expect(top('Queue', { composerSendMode: 'queue-if-active' })).toContain('composer.send-mode');
    expect(top('/tmp/pdfs', { pdfExportDir: '/tmp/pdfs' })).toContain('inbox.pdf-download-folder');
    expect(top('/usr/bin/mycursor', { editorCursorBinary: '/usr/bin/mycursor' })).toContain('editor.cursor-binary');
    expect(top('/Applications/Foo', { terminalApp: '/Applications/Foo' })).toContain('editor.terminal-app');
  });

  it('reads booleans with the documented defaults', () => {
    const valueOf = (id: string, c: Record<string, unknown>) =>
      getStaticEntries().find((e) => e.id === id)?.value?.(cfg(c));
    expect(valueOf('terminal.wheel-scroll', {})).toBe('On');
    expect(valueOf('terminal.wheel-scroll', { terminalWheelArrowsEnabled: false })).toBe('Off');
    expect(valueOf('global.show-diagnostic-events', {})).toBe('Off');
    expect(valueOf('global.show-diagnostic-events', { showUnhandledProviderEvents: true })).toBe('On');
    expect(valueOf('global.record-provider-traffic', { providerBridgeRecordingEnabled: true })).toBe('On');
    expect(valueOf('inbox.trust-zcc-tools', {})).toBe('On');
    expect(valueOf('inbox.show-guidance', { inboxGuidanceEnabled: false })).toBe('Off');
    expect(valueOf('terminal.clipboard-write', { terminalClipboardWriteEnabled: false })).toBe('Off');
    expect(valueOf('composer.cli-agent', {})).toBe('On');
    expect(valueOf('composer.modern', { composerShowModern: false })).toBe('Off');
    expect(valueOf('composer.squad', { composerShowAutonomousTeam: false })).toBe('Off');
    expect(valueOf('editor.cursor', { openerHiddenTargets: ['cursor'] })).toBe('Off');
    expect(valueOf('editor.code', {})).toBe('On');
    expect(valueOf('terminal.font-size', { fontSize: 14 })).toBe('14');
    expect(valueOf('terminal.font-size', {})).toBeUndefined();
    expect(valueOf('global.theme', { theme: 'bogus' })).toBeUndefined();
  });

  it('never defines a value on a secret-looking Config entry', () => {
    const config = getStaticEntries().filter((e) => /^(global|composer|keyboard|inbox|browser|terminal|editor|prompts)\./.test(e.id));
    expect(config.length).toBeGreaterThan(40);
    expect(findSecretValueViolations([...config, ...keyboardSearchProvider(cfg({}))])).toEqual([]);
  });

  it('keeps Advanced editor overrides flagged for reveal', () => {
    const adv = getStaticEntries().filter((e) => e.reveal === 'advanced').map((e) => e.id).sort();
    expect(adv).toEqual([
      'editor.code-app', 'editor.code-binary', 'editor.cursor-app', 'editor.cursor-binary',
      'editor.intellij-app', 'editor.intellij-binary', 'editor.terminal-app'
    ]);
  });
});
