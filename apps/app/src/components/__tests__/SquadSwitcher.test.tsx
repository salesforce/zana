import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SquadSwitcher, type SquadSwitcherItem } from '../SquadSwitcher.js';

const items: SquadSwitcherItem[] = [
  { id: 'p1', label: 'Frontend', icon: '🎨', color: '#f00', working: 3, isNew: false },
  { id: 'p2', label: 'Research', icon: '🔬', color: '#0f0', working: 0, isNew: true }
];

const html = () =>
  renderToStaticMarkup(<SquadSwitcher items={items} selected="p1" onSelect={() => {}} />);

describe('SquadSwitcher', () => {
  it('renders one chip per item with its label', () => {
    const out = html();
    expect(out.match(/<button/g)?.length).toBe(2);
    expect(out).toContain('Frontend');
    expect(out).toContain('Research');
  });

  it('marks the selected chip active and the other not', () => {
    const out = html();
    expect(out).toContain('squad-flow-tab active');
    expect(out.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(out.match(/aria-pressed="false"/g)?.length).toBe(1);
  });

  it('renders a working-count only for squads with working > 0', () => {
    // p1 has working:3 → one count span; p2 has working:0 → none.
    expect(html().match(/squad-flow-tab-count/g)?.length).toBe(1);
  });

  it('flags a new, unselected squad with the --new modifier', () => {
    // p2 is isNew:true and not selected.
    expect(html()).toContain('squad-flow-tab--new');
  });

  it('omits the --new modifier when a new squad is the selected one', () => {
    // p2 is isNew:true; selecting it must drop the --new cue.
    const out = renderToStaticMarkup(
      <SquadSwitcher items={items} selected="p2" onSelect={() => {}} />
    );
    expect(out).not.toContain('squad-flow-tab--new');
  });
});
