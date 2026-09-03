'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { completedScene, FLOW_LOOP_MS, sceneForElapsed, type FlowScene } from './flow-scene';
import { SpatialFixture } from './SpatialFixture';
import { HomeFlowWireframe } from './wireframes';

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(media.matches);
    const onChange = () => setReduce(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

function demoHeading(view: FlowScene['view']): string {
  if (view === 'thread') return 'Thread';
  if (view === 'kanban') return 'Kanban';
  return 'New Chat';
}

export function ProductDemo(): ReactNode {
  const reduceMotion = usePrefersReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    let frame = 0;
    const origin = performance.now();
    const tick = (now: number) => {
      setElapsed((now - origin) % FLOW_LOOP_MS);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion]);

  const scene = reduceMotion ? completedScene() : sceneForElapsed(elapsed);

  return (
    <div className="product-tour" data-tour-demo>
      <section aria-label="Product demo">
        <header className="product-tour-heading">
          <h2>{demoHeading(scene.view)}</h2>
          <p>{scene.caption}</p>
        </header>
        <SpatialFixture>
          <HomeFlowWireframe scene={scene} />
        </SpatialFixture>
        <p className="product-tour-more">
          <Link className="zcc-btn zcc-btn-ghost" href="/features/">
            See all features
          </Link>
        </p>
      </section>
    </div>
  );
}
