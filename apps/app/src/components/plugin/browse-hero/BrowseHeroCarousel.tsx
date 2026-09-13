import { useEffect, useMemo, useState } from 'react';
import { Blocks } from 'lucide-react';
import { HomeAgentComposer } from '../../HomeAgentComposer.js';
import { CREATE_PLUGIN_PROMPT } from '../../../lib/create-resource-prompts.js';
import { MiniAppScene } from './MiniAppScenes.js';
import {
  BROWSE_HERO_ARCHETYPES,
  browseHeroPrompt,
  type BrowseHeroArchetype
} from './browse-hero-archetypes.js';

export function BrowseHeroCarousel({
  composing,
  prompt,
  onPromptChange,
  onComposingChange,
  openRequest
}: {
  composing: boolean;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onComposingChange: (composing: boolean) => void;
  openRequest?: { nonce: number; seed?: string } | null;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const archetypes = BROWSE_HERO_ARCHETYPES;
  const active = archetypes[index] ?? archetypes[0]!;

  useEffect(() => {
    if (reducedMotion || composing) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % archetypes.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [archetypes.length, composing, reducedMotion]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.seed) onPromptChange(openRequest.seed);
    onComposingChange(true);
  }, [onComposingChange, onPromptChange, openRequest]);

  const noun = composing ? 'whatever you need' : active.noun;

  return (
    <section className="ext-browse-hero" aria-label="What you can build with plugins">
      <div className="ext-browse-hero-copy">
        <h2 className="ext-browse-hero-headline">
          Turn ZCC into <span className="ext-browse-hero-noun">{noun}</span>
        </h2>
        <p className="ext-browse-hero-hook">
          {composing
            ? 'Describe the plugin you want. The thread scaffolds it in this project, then you install and iterate.'
            : active.hook}
        </p>
        <div
          className="ext-browse-hero-composer"
          onFocusCapture={() => onComposingChange(true)}
        >
          <HomeAgentComposer
            key={prompt}
            initialText={prompt || CREATE_PLUGIN_PROMPT}
            autoFocus={composing}
          />
        </div>
        <div className="ext-browse-hero-tabs" role="tablist" aria-label="Plugin examples">
          {archetypes.map((archetype, tabIndex) => (
            <button
              key={archetype.id}
              type="button"
              role="tab"
              aria-selected={tabIndex === index}
              className={`ext-browse-hero-tab${tabIndex === index ? ' is-active' : ''}`}
              onClick={() => {
                setIndex(tabIndex);
                onComposingChange(false);
              }}
            >
              {archetype.title}
            </button>
          ))}
        </div>
      </div>
      <ShowcaseFrame archetype={active} reducedMotion={reducedMotion} />
    </section>
  );
}

function ShowcaseFrame({
  archetype,
  reducedMotion
}: {
  archetype: BrowseHeroArchetype;
  reducedMotion: boolean;
}) {
  const Icon = archetype.icon;
  return (
    <div
      className={`ext-browse-frame${reducedMotion ? ' is-static' : ''}`}
      style={{ ['--ext-browse-accent' as string]: `var(${archetype.accent})` }}
    >
      <div className="ext-browse-frame-titlebar">
        <span className="ext-browse-frame-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="ext-browse-frame-title">ZCC — {archetype.title}</span>
        <span className="ext-browse-frame-badge">Plugin</span>
      </div>
      <div className="ext-browse-frame-body">
        <div className="ext-browse-frame-rail" aria-hidden="true">
          <Blocks size={12} />
          <Icon size={12} />
          <span />
        </div>
        <div className="ext-browse-frame-scene">
          <MiniAppScene archetype={archetype} />
        </div>
      </div>
    </div>
  );
}

export function BrowseArchetypeCards({
  onSelect
}: {
  onSelect: (prompt: string) => void;
}) {
  const cards = useMemo(() => BROWSE_HERO_ARCHETYPES.filter((row) => row.id !== 'spark'), []);
  return (
    <div className="ext-browse-archetypes" data-testid="create-plugin-examples">
      {cards.map((archetype) => {
        const Icon = archetype.icon;
        return (
          <button
            key={archetype.id}
            type="button"
            className="ext-browse-archetype"
            onClick={() => onSelect(browseHeroPrompt(archetype.brief))}
          >
            <span
              className="ext-browse-archetype-icon"
              style={{
                background: `color-mix(in srgb, var(${archetype.accent}) 16%, var(--bg-elevated))`,
                color: `var(${archetype.accent})`
              }}
            >
              <Icon size={14} />
            </span>
            <span className="ext-browse-archetype-title">{archetype.title}</span>
            <span className="ext-browse-archetype-hook">{archetype.hook}</span>
          </button>
        );
      })}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
