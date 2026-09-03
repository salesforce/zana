import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PersonaEditor, savePersona } from '../PersonaEditor.js';
import { useData } from '../../store.js';

function claudeSection(html: string): string {
  const start = html.indexOf('data-testid="persona-claude-options"');
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start);
}

describe('PersonaEditor harness-neutral fields', () => {
  it('labels base selection as Harness profile', () => {
    const html = renderToStaticMarkup(
      <PersonaEditor
        persona={{ id: 'reviewer', name: 'Reviewer', source: 'user' }}
        mode="view"
        onClose={() => {}}
      />
    );

    expect(html).toContain('Harness profile');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Claude only');
    expect(html.lastIndexOf('Opening prompt')).toBeLessThan(html.indexOf('data-testid="persona-claude-options"'));
    expect(html).not.toContain('Base profile');
  });

  it('collapses Claude-only role capabilities and hides inert MCP server entry', () => {
    const html = renderToStaticMarkup(
      <PersonaEditor persona={null} mode="edit" onClose={() => {}} />
    );

    expect(html).toContain('Claude Code');
    expect(html.match(/data-testid="persona-claude-options"/g)).toHaveLength(1);
    expect(html).toContain('Persona tool policy and context directories');
    expect(html).toContain('Claude only');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Allowed tools');
    expect(html).not.toContain('Denied tools');
    expect(html).not.toContain('Extra dirs');
    expect(html).not.toContain('MCP servers');
  });

  it('shows existing Claude values in edit mode below prompts', () => {
    const html = renderToStaticMarkup(
      <PersonaEditor
        persona={{
          id: 'reviewer',
          name: 'Reviewer',
          source: 'user',
          allowedTools: ['Read'],
          deniedTools: ['Write'],
          addDirs: ['/tmp/context']
        }}
        mode="edit"
        onClose={() => {}}
      />
    );

    expect(html.lastIndexOf('Opening prompt')).toBeLessThan(html.indexOf('data-testid="persona-claude-options"'));
    expect(html.match(/data-testid="persona-claude-options"/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('value="Read"');
    expect(html).toContain('value="Write"');
    expect(html).toContain('value="/tmp/context"');
    expect(claudeSection(html)).toContain('Allowed tools');
  });

  it('shows portable routing for neutral personas and harness routing for pinned personas', () => {
    const neutral = renderToStaticMarkup(
      <PersonaEditor persona={{ id: 'neutral', name: 'Neutral', source: 'user' }} mode="edit" onClose={() => {}} />
    );
    const pinned = renderToStaticMarkup(
      <PersonaEditor
        persona={{ id: 'pinned', name: 'Pinned', source: 'user', baseProfile: 'claude' }}
        mode="edit"
        onClose={() => {}}
      />
    );

    expect(neutral).toContain('data-testid="persona-portable-routing"');
    expect(neutral).toContain('persona-routing-grid--neutral');
    expect(neutral).toContain('Model level');
    expect(neutral).not.toContain('Model level (portable)');
    expect(neutral).not.toContain('Execution state (portable)');
    expect(pinned).not.toContain('data-testid="persona-portable-routing"');
    expect(pinned).toContain('persona-routing-grid--pinned');
  });

  it('does not duplicate execution policy with a native role control', () => {
    const html = renderToStaticMarkup(
      <PersonaEditor
        persona={{ id: 'open-code', name: 'OpenCode Persona', source: 'user', baseProfile: 'opencode' }}
        mode="edit"
        onClose={() => {}}
      />
    );

    expect(html).not.toContain('persona-role-target');
  });

  it('accepts project scope for authoritative OpenCode agent discovery', () => {
    const source = readFileSync(new URL('../PersonaEditor.tsx', import.meta.url), 'utf8');
    expect(source).toContain('projectId?: string;');
    expect(source).toContain("descriptor.id === 'opencode'");
    expect(source).toContain("product.harness.agentDescriptors(projectId, 'opencode')");
    expect(source).toContain("product.harness.agentDescriptors(projectId, 'opencode', true)");
    expect(source).toContain('Effective OpenCode agent');
    expect(source).toContain('directLaunchAllowed');
  });

  it('turns a rejected save into an actionable error', async () => {
    const save = vi.fn().mockRejectedValue(new Error('permission denied'));

    await expect(savePersona({ name: 'Reviewer' }, save)).resolves.toEqual({
      ok: false,
      message: 'permission denied'
    });
  });
});
