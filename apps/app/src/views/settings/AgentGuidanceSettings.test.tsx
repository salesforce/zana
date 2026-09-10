/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { BUNDLED_PRODUCT_SKILLS } from '@zana-ai/zcc-domain';
import { AgentGuidanceSettings } from './AgentGuidanceSettings.js';

const base: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

afterEach(() => {
  cleanup();
});

describe('AgentGuidanceSettings', () => {
  it('renders master switches and every bundled skill', () => {
    const html = renderToStaticMarkup(
      <AgentGuidanceSettings config={base} onUpdate={async () => undefined} />
    );
    expect(html).toContain('id="settings-anchor-agent-guidance"');
    expect(html).toContain('Inject product introduction and RULES.md');
    expect(html).toContain('Inject remote-access instructions');
    expect(html).toContain('Inject bundled skills');
    expect(html).toContain('data-testid="bundled-skills-opt-outs"');
    for (const skill of BUNDLED_PRODUCT_SKILLS) {
      expect(html).toContain(skill.label);
      expect(html).toContain(skill.id);
    }
  });

  it('disables per-skill switches when the master skill toggle is off', () => {
    const html = renderToStaticMarkup(
      <AgentGuidanceSettings
        config={{ ...base, injectBundledSkills: false }}
        onUpdate={async () => undefined}
      />
    );
    expect(html).toMatch(/aria-label="CLI"[^>]*disabled/);
  });

  it('opts a skill out without clearing the master switch', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<AgentGuidanceSettings config={base} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('switch', { name: 'CLI' }));
    expect(onUpdate).toHaveBeenCalledWith({ disabledBundledSkills: ['zcc-cli'] });
  });
});
