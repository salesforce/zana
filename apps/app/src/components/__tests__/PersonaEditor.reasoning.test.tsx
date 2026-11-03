import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PersonaEditor } from '../PersonaEditor.js';

// Static-markup coverage of the Reasoning effort picker (#584). The save and
// clear round trip needs a live click, so the built-app E2E covers it
// (e2e/persona-reasoning-effort.spec.ts).
const edit = (persona: Parameters<typeof PersonaEditor>[0]['persona']) =>
  renderToStaticMarkup(<PersonaEditor persona={persona} mode="edit" onClose={() => {}} />);

describe('PersonaEditor reasoning effort (REQ-8)', () => {
  it('shows the picker for a new persona with no base profile', () => {
    const html = edit(null);
    expect(html).toContain('Reasoning effort');
    expect(html).toContain('id="persona-reasoning-effort"');
  });

  it('shows the picker for a neutral persona and a Claude-pinned persona', () => {
    expect(edit({ id: 'n', name: 'N', source: 'user' })).toContain('id="persona-reasoning-effort"');
    expect(edit({ id: 'c', name: 'C', source: 'user', baseProfile: 'claude' })).toContain('id="persona-reasoning-effort"');
    expect(edit({ id: 'y', name: 'Y', source: 'user', baseProfile: 'claude-yolo' })).toContain('id="persona-reasoning-effort"');
  });

  it('hides the picker when the persona is pinned to a non-Claude harness', () => {
    expect(edit({ id: 'o', name: 'O', source: 'user', baseProfile: 'opencode' })).not.toContain('Reasoning effort');
    expect(edit({ id: 'x', name: 'X', source: 'user', baseProfile: 'codex' })).not.toContain('Reasoning effort');
  });

  it('explains what the setting does in plain words', () => {
    const html = edit({ id: 'n', name: 'N', source: 'user' });
    expect(html).toContain('Sets how hard Claude thinks for this persona. Other agents ignore it.');
  });

  it('preselects the saved level', () => {
    const html = edit({ id: 'n', name: 'N', source: 'user', reasoningLevel: 'xhigh' });
    expect(html).toContain('Extra-high');
  });

  it('shows the default label when no level is saved', () => {
    const html = edit({ id: 'n', name: 'N', source: 'user' });
    const start = html.indexOf('id="persona-reasoning-effort"');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(html.slice(start, start + 600)).toContain('Use harness default (unset)');
  });

  it('adds a read-only line in the details view only when a level is set', () => {
    const withLevel = renderToStaticMarkup(
      <PersonaEditor persona={{ id: 'v', name: 'V', source: 'builtin', reasoningLevel: 'high' }} mode="view" onClose={() => {}} />
    );
    const without = renderToStaticMarkup(
      <PersonaEditor persona={{ id: 'w', name: 'W', source: 'builtin' }} mode="view" onClose={() => {}} />
    );
    expect(withLevel).toContain('Reasoning effort');
    expect(withLevel).toContain('high');
    expect(without).not.toContain('Reasoning effort');
  });
});
