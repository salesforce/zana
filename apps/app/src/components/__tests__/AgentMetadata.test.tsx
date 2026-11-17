import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentMetadata } from '../AgentMetadata.js';

describe('AgentMetadata', () => {
  it('renders a declared section with unavailable values', () => {
    const html = renderToStaticMarkup(h(AgentMetadata, {
      metadata: {
        observedAt: 1,
        sections: [{
          id: 'runtime', label: 'Runtime',
          values: [{ label: 'Harness', value: 'OpenCode' }, { label: 'Model' }]
        }]
      }
    }));

    expect(html).toContain('Runtime');
    expect(html).toContain('OpenCode');
    expect(html).toContain('Unavailable');
  });

  it('shows the settings layer that supplied a value, never for unavailable values', () => {
    const html = renderToStaticMarkup(h(AgentMetadata, {
      metadata: { observedAt: 1, sections: [{ id: 'runtime', label: 'Runtime', values: [
        { label: 'Model', value: 'opus', source: 'Persona' },
        { label: 'Role', source: 'Project' }
      ] }] }
    }));
    expect(html).toContain('(Persona)');
    expect(html).not.toContain('(Project)');
  });

  it('omits sections unavailable for this harness', () => {
    expect(renderToStaticMarkup(h(AgentMetadata, { metadata: { observedAt: 1, sections: [] } }))).toBe('');
  });
});
