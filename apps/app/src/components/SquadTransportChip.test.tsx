import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SquadTransportChip, squadPicklistOption } from './SquadTransportChip.js';

describe('SquadTransportChip', () => {
  it('reuses the fleet kind pill: CLI Agent for CLI or legacy squads, Thread for Modern', () => {
    const legacy = renderToStaticMarkup(<SquadTransportChip team={{}} />);
    const cli = renderToStaticMarkup(<SquadTransportChip team={{ transport: 'CLI' }} />);
    const modern = renderToStaticMarkup(<SquadTransportChip team={{ transport: 'MODERN' }} />);
    for (const html of [legacy, cli]) {
      expect(html).toContain('class="fleet-kind-chip fleet-kind-agent"');
      expect(html).toContain('CLI Agent');
    }
    expect(modern).toContain('class="fleet-kind-chip fleet-kind-thread"');
    expect(modern).toContain('Modern');
    expect(modern).not.toContain('CLI Agent');
  });
});

describe('squadPicklistOption', () => {
  const team = { id: 't1', name: 'Builders', description: 'Ships things', transport: 'MODERN' as const };

  it('keeps plain label/value for trigger + search and renders name with the transport pill', () => {
    const option = squadPicklistOption(team);
    expect(option).toMatchObject({ value: 't1', label: 'Builders' });
    expect(option.description).toBeUndefined();
    const html = renderToStaticMarkup(<>{option.content}</>);
    expect(html).toContain('data-squad-transport="MODERN"');
    expect(html).toContain('Builders');
    expect(html).toContain('fleet-kind-thread');
  });

  it('adds the description line only when requested and present', () => {
    expect(squadPicklistOption(team, { withDescription: true }).description).toBe('Ships things');
    expect(squadPicklistOption({ ...team, description: undefined }, { withDescription: true }).description).toBeUndefined();
    const cli = renderToStaticMarkup(<>{squadPicklistOption({ id: 'c', name: 'Legacy' }).content}</>);
    expect(cli).toContain('data-squad-transport="CLI"');
    expect(cli).toContain('CLI Agent');
  });
});
