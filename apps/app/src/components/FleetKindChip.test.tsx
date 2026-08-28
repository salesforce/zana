import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FleetKindChip } from './FleetKindChip.js';

describe('FleetKindChip', () => {
  it('labels a thread distinctly from a CLI agent', () => {
    const thread = renderToStaticMarkup(<FleetKindChip kind="thread" />);
    const agent = renderToStaticMarkup(<FleetKindChip kind="agent" />);
    expect(thread).toContain('data-kind="thread"');
    expect(thread).toContain('Thread');
    expect(thread).not.toContain('CLI Agent');
    expect(agent).toContain('data-kind="agent"');
    expect(agent).toContain('CLI Agent');
    expect(agent).not.toContain('Thread');
  });
});
