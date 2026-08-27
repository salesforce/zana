import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LaunchModeSegmented } from './LaunchModeSegmented.js';

describe('LaunchModeSegmented', () => {
  it('always offers Thread and Legacy Agent', () => {
    const html = renderToStaticMarkup(
      <LaunchModeSegmented value="thread" onChange={() => undefined} showAutonomousTeam={false} />
    );
    expect(html).toContain('aria-label="Launch mode"');
    expect(html).toContain('Thread');
    expect(html).toContain('Legacy Agent');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('Autonomous Team');
    expect(html).not.toContain('Single agent');
  });

  it('shows Autonomous Team only when teams exist', () => {
    const html = renderToStaticMarkup(
      <LaunchModeSegmented value="autonomous" onChange={() => undefined} showAutonomousTeam />
    );
    expect(html).toContain('Autonomous Team');
    expect(html).toContain('aria-pressed="true"');
  });
});
