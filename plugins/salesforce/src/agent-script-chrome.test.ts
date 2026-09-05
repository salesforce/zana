import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYGROUND_VIEW,
  dialectLabel,
  dialectOptions,
  normalizePlaygroundView,
  playgroundViewLabel
} from '../lib/agent-script-chrome.js';

describe('agent script chrome', () => {
  it('pretty-prints dialects and view tabs', () => {
    expect(dialectLabel('agentforce')).toBe('Agentforce');
    expect(dialectLabel('agentscript')).toBe('Agent Script');
    expect(playgroundViewLabel('script')).toBe('Script');
    expect(playgroundViewLabel('graph')).toBe('Graph');
    expect(dialectOptions().map((row) => row.id)).toEqual(['agentforce', 'agentscript', 'agentfabric']);
  });

  it('falls back to split when the view is unknown', () => {
    expect(normalizePlaygroundView('graph')).toBe('graph');
    expect(normalizePlaygroundView('nope')).toBe(DEFAULT_PLAYGROUND_VIEW);
    expect(normalizePlaygroundView(undefined)).toBe('script');
  });
});
