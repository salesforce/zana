import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductDemo } from './ProductDemo.tsx';
import { ProductGallery } from './ProductGallery.tsx';
import {
  ASSISTANT_REPLY,
  HOME_PROMPT,
  T,
  FLOW_LOOP_MS,
  T_DIAGRAM,
  T_KANBAN,
  T_LOADING,
  T_THREAD,
  T_TOOL_EDIT,
  completedScene,
  sceneForElapsed
} from './flow-scene.ts';
import {
  MAX_FIXTURE_SCALE,
  anchorForSlide,
  hrefForSlide,
  SLIDES,
  slideIndexFromHash,
  spatialFixtureScale
} from './slides.ts';
import {
  CliWireframe,
  FeaturesWireframe,
  HomeFlowWireframe,
  InboxWireframe,
  KanbanWireframe,
  PluginsWireframe,
  RemoteWireframe,
  ThreadWireframe
} from './wireframes.tsx';

describe('spatialFixtureScale', () => {
  it('scales together and caps at the legibility ceiling', () => {
    expect(spatialFixtureScale(360, 720)).toBe(0.5);
    expect(spatialFixtureScale(720, 720)).toBe(1);
    expect(spatialFixtureScale(1280, 720)).toBe(MAX_FIXTURE_SCALE);
    expect(spatialFixtureScale(1280, 720, 700, 700)).toBe(1);
    expect(spatialFixtureScale(1280, 720, 350, 700)).toBe(0.5);
  });
});

describe('slideIndexFromHash', () => {
  it('resolves a known slide id and falls back to Kanban', () => {
    expect(SLIDES[slideIndexFromHash('#inbox')]?.id).toBe('inbox');
    expect(SLIDES[slideIndexFromHash('#kanban')]?.id).toBe('kanban');
    expect(SLIDES[slideIndexFromHash('#thread')]?.id).toBe('thread');
    expect(SLIDES[slideIndexFromHash('#cli')]?.id).toBe('cli');
    expect(SLIDES[slideIndexFromHash('#tour-features')]?.id).toBe('features');
    expect(SLIDES[slideIndexFromHash('')]?.id).toBe('kanban');
    expect(SLIDES[slideIndexFromHash('#missing')]?.id).toBe('kanban');
  });
});

describe('hrefForSlide', () => {
  it('keeps the current path and avoids a bare #features hash', () => {
    expect(anchorForSlide('features')).toBe('tour-features');
    expect(anchorForSlide('thread')).toBe('thread');
    expect(hrefForSlide('kanban', 'http://localhost:4321/')).toBe('/#kanban');
    expect(hrefForSlide('inbox', 'http://localhost:4321/?x=1')).toBe('/?x=1#inbox');
    expect(hrefForSlide('thread', 'http://localhost:4321/')).toBe('/#thread');
    expect(hrefForSlide('cli', 'http://localhost:4321/')).toBe('/#cli');
    expect(hrefForSlide('features', 'http://localhost:4321/')).toBe('/#tour-features');
    expect(hrefForSlide('thread', 'http://localhost:4321/features/')).toBe('/features/#thread');
    expect(hrefForSlide('features', 'http://localhost:4321/features/')).toBe('/features/#tour-features');
  });
});

describe('sceneForElapsed', () => {
  it('starts on New Chat with Claude Code', () => {
    const scene = sceneForElapsed(0);
    expect(scene.view).toBe('home');
    expect(scene.harness).toBe('Claude Code');
    expect(scene.pickerOpen).toBe(false);
    expect(scene.loading).toBe(false);
    expect(scene.diagram).toBe('hidden');
  });

  it('opens the picker then selects Cursor', () => {
    expect(sceneForElapsed(T.pickerOpen + 10).pickerOpen).toBe(true);
    expect(sceneForElapsed(T.pickerOpen + 10).harness).toBe('Claude Code');
    const selected = sceneForElapsed(T.cursorSelected + 10);
    expect(selected.harness).toBe('Cursor');
    expect(selected.pickerOpen).toBe(true);
    expect(selected.pickerHighlight).toBe('Cursor');
    const selectedMarkup = renderToStaticMarkup(
      createElement(HomeFlowWireframe, { scene: selected })
    );
    expect(selectedMarkup).toContain('Grok');
    expect(selectedMarkup).not.toContain('Opus');
  });

  it('shows the loading overlay after send, then the Agents board', () => {
    const scene = sceneForElapsed(T_LOADING + 50);
    expect(scene.loading).toBe(true);
    expect(scene.view).toBe('home');
    expect(scene.harness).toBe('Cursor');
    expect(scene.homeDraft).toBe(HOME_PROMPT);
    expect(sceneForElapsed(T_KANBAN).loading).toBe(false);
    expect(sceneForElapsed(T_KANBAN).view).toBe('kanban');
    expect(sceneForElapsed(T_THREAD).view).toBe('thread');
  });

  it('shows Checkout flakes working on the launch board', () => {
    const scene = sceneForElapsed(T_KANBAN + 20);
    expect(scene.view).toBe('kanban');
    const markup = renderToStaticMarkup(createElement(HomeFlowWireframe, { scene }));
    expect(markup).toContain('Checkout flakes');
    expect(markup).toContain('Working');
    expect(markup).toContain('Cursor');
    expect(markup).toContain('product-tour-card is-live is-thread');
    expect(markup).not.toContain('Isolated the Stripe mock');
  });

  it('opens a widened Diff pane after the edit', () => {
    const scene = sceneForElapsed(T_TOOL_EDIT + 20);
    expect(scene.view).toBe('thread');
    expect(scene.sideTab).toBe('diff');
    expect(scene.sideWide).toBe(true);
    expect(scene.tools.map((tool) => tool.label)).toContain('Edit checkout.spec.ts');
    const markup = renderToStaticMarkup(createElement(HomeFlowWireframe, { scene }));
    expect(markup).toContain('data-tour-diff');
    expect(markup).toContain('checkout.spec.ts');
    expect(markup).toContain('mockStripe.reset()');
    expect(markup).toContain('- const stripe = mockStripe();');
    expect(markup).toContain('product-tour-side is-split');
  });

  it('lands on a completed thread with tools, reply, and diagram', () => {
    const scene = sceneForElapsed(T_DIAGRAM + 10);
    expect(scene.view).toBe('thread');
    expect(scene.harness).toBe('Cursor');
    expect(scene.userSent).toBe(true);
    expect(scene.tools.map((tool) => tool.label)).toEqual([
      'Read checkout.spec.ts',
      'Edit checkout.spec.ts',
      'Re-ran checkout suite'
    ]);
    expect(scene.assistant).toBe(ASSISTANT_REPLY);
    expect(scene.diagram).toBe('shown');
    expect(scene.status).toBe('idle');
    expect(completedScene().view).toBe('thread');
    expect(completedScene().diagram).toBe('shown');
    expect(sceneForElapsed(FLOW_LOOP_MS - 1).view).toBe('thread');
  });
});

describe('ProductDemo chrome', () => {
  it('renders New Chat without carousel chrome', () => {
    const markup = renderToStaticMarkup(createElement(ProductDemo));
    expect(markup).toContain('data-tour-demo');
    expect(markup).toContain('New Chat');
    expect(markup).toContain('Claude Code');
    expect(markup).toContain('data-harness-icon="Claude Code"');
    expect(markup).toContain('Describe the task…');
    expect(markup).not.toContain('aria-roledescription="carousel"');
    expect(markup).not.toContain('product-tour-page-list');
    expect(markup).not.toContain('Previous surface');
    expect(markup).not.toContain('Next surface');
    expect(markup).toContain('See all features');
    expect(markup).toMatch(/href="\/features\/?"/);
  });

  it('renders the completed thread when given that scene', () => {
    const markup = renderToStaticMarkup(
      createElement(HomeFlowWireframe, { scene: sceneForElapsed(T_DIAGRAM + 10) })
    );
    expect(markup).toContain('Fix flaky checkout tests');
    expect(markup).toContain('Cursor');
    expect(markup).toContain('data-harness-icon="Cursor"');
    expect(markup).toContain('Read checkout.spec.ts');
    expect(markup).toContain('Edit checkout.spec.ts');
    expect(markup).toContain('Re-ran checkout suite');
    expect(markup).toContain(ASSISTANT_REPLY.split('Stripe mock')[0]);
    expect(markup).toContain('Stripe mock');
    expect(markup).toContain('Isolate mock per test');
    expect(markup).toContain('checkout.spec.ts');
    expect(markup).toContain('product-tour-mermaid');
  });

  it('freezes on the completed thread, not Inbox', () => {
    const markup = renderToStaticMarkup(
      createElement(HomeFlowWireframe, { scene: completedScene() })
    );
    expect(markup).toContain('data-flow-view="thread"');
    expect(markup).toContain('product-tour-mermaid');
    expect(markup).toContain('data-tour-diff');
    expect(markup).not.toContain('data-flow-view="inbox"');
    expect(markup).not.toContain('data-inbox-report');
    expect(markup).not.toContain('inbox_push');
  });
});

describe('ProductGallery', () => {
  it('stacks every surface without carousel chrome', () => {
    const markup = renderToStaticMarkup(createElement(ProductGallery));
    expect(markup).toContain('data-tour-gallery');
    expect(markup).not.toContain('aria-roledescription="carousel"');
    expect(markup).not.toContain('product-tour-page-list');
    expect(markup).not.toContain('Previous surface');
    expect(markup).not.toContain('Next surface');
    for (const slide of SLIDES) {
      expect(markup).toContain(`data-tour-slide="${slide.id}"`);
      expect(markup).toContain(`id="${anchorForSlide(slide.id)}"`);
      expect(markup).toContain(slide.title);
      expect(markup).toContain(slide.blurb);
    }
  });
});

describe('fixtures', () => {
  it('shows New Chat with Modern and CLI Agent launch modes', () => {
    const markup = renderToStaticMarkup(createElement(FeaturesWireframe));
    expect(markup).toContain('Describe the task…');
    expect(markup).toContain('Modern');
    expect(markup).toContain('CLI Agent');
    expect(markup).toContain('width="16"');
    expect(markup).toContain('viewBox="0 0 16 16"');
  });

  it('shows Kanban lanes Needs you / Working / Idle / Done', () => {
    const markup = renderToStaticMarkup(createElement(KanbanWireframe));
    expect(markup).toContain('Needs you');
    expect(markup).toContain('Working');
    expect(markup).toContain('Idle');
    expect(markup).toContain('Done');
    expect(markup).toContain('Checkout flakes');
    expect(markup).toContain('Claude Code');
    expect(markup).toContain('product-tour-card is-thread');
    expect(markup).toContain('product-tour-card-activity');
  });

  it('shows a thread timeline, pending question, and composer', () => {
    const markup = renderToStaticMarkup(createElement(ThreadWireframe));
    expect(markup).toContain('Fix flaky checkout tests');
    expect(markup).toContain('Re-ran checkout suite');
    expect(markup).toContain('Which retry budget for checkout?');
    expect(markup).toContain('checkout.spec.ts');
    expect(markup).toContain('@release-notes');
  });

  it('shows the live CLI agent terminal', () => {
    const markup = renderToStaticMarkup(createElement(CliWireframe));
    expect(markup).toContain('Pairing relay');
    expect(markup).toContain('CLI agent terminal');
    expect(markup).toContain('Ship the pairing flow on this host.');
    expect(markup).toContain('Edit src/pairing.ts');
    expect(markup).toContain('Working');
  });

  it('folds routine inbox noise and pins questions', () => {
    const markup = renderToStaticMarkup(createElement(InboxWireframe));
    expect(markup).toContain('Routine');
    expect(markup).toContain('Agent closed');
    expect(markup).toContain('AI Summary');
    expect(markup).toContain('Needs your answer');
    expect(markup).toContain('Which retry budget for checkout?');
    expect(markup).toContain('Reply');
  });

  it('lists installed plugins beside Browse', () => {
    const markup = renderToStaticMarkup(createElement(PluginsWireframe));
    expect(markup).toContain('Installed');
    expect(markup).toContain('Browse');
    expect(markup).toContain('Confirm full trust to install');
    expect(markup).toContain('New plugin');
  });

  it('shows the SSH host on Remote', () => {
    const markup = renderToStaticMarkup(createElement(RemoteWireframe));
    expect(markup).toContain('fde-box');
    expect(markup).toContain('SSH');
    expect(markup).toContain('Connected · fde-box');
    expect(markup).toContain('Running on fde-box over SSH.');
  });
});
