// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const composer = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('../../HomeAgentComposer.js', () => ({
  HomeAgentComposer: (props: Record<string, unknown>) => { composer.props = props; return <div data-testid="composer" />; }
}));
vi.mock('./MiniAppScenes.js', () => ({ MiniAppScene: () => null }));

import { BrowseHeroCarousel } from './BrowseHeroCarousel.js';
import { CREATE_PLUGIN_PROMPT } from '../../../lib/create-resource-prompts.js';

afterEach(() => { cleanup(); composer.props = null; });

const base = { onPromptChange: vi.fn(), onComposingChange: vi.fn() };

describe('BrowseHeroCarousel composer', () => {
  it('opens the plugin composer in its own draft scope, seeded with the create-plugin prompt', () => {
    render(<BrowseHeroCarousel {...base} composing prompt="" />);
    expect(screen.getByTestId('composer')).toBeTruthy();
    expect(composer.props).toMatchObject({ draftScope: 'plugin-browse', initialText: CREATE_PLUGIN_PROMPT, autoFocus: true });
  });

  it('seeds the composer with the chosen archetype prompt instead', () => {
    render(<BrowseHeroCarousel {...base} composing prompt="Build a CRM view" />);
    expect(composer.props).toMatchObject({ draftScope: 'plugin-browse', initialText: 'Build a CRM view' });
  });

  it('does not mount the composer while browsing', () => {
    render(<BrowseHeroCarousel {...base} composing={false} prompt="" />);
    expect(screen.queryByTestId('composer')).toBeNull();
  });
});
