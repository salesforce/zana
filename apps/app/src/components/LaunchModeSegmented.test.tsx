import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { LaunchModeSegmented } from './LaunchModeSegmented.js';

describe('LaunchModeSegmented', () => {
  it('always offers Modern and CLI Agent', () => {
    const html = renderToStaticMarkup(
      <LaunchModeSegmented value="thread" onChange={() => undefined} showAutonomousTeam={false} />
    );
    expect(html).toContain('aria-label="Launch mode"');
    expect(html).toContain('Modern');
    expect(html).toContain('launch-segmented-new');
    expect(html).toContain('NEW');
    expect(html).toContain('CLI Agent');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('Autonomous Team');
    expect(html).not.toContain('Single agent');
    expect(html).not.toContain('Thread');
    expect(html).not.toContain('Legacy Agent');
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.launch-segmented-new');
  });

  it('shows Autonomous Team only when teams exist', () => {
    const html = renderToStaticMarkup(
      <LaunchModeSegmented value="autonomous" onChange={() => undefined} showAutonomousTeam />
    );
    expect(html).toContain('Autonomous Team');
    expect(html).toContain('aria-pressed="true"');
  });
});
