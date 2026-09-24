'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FLOW_LOOP_MS,
  sceneForElapsed,
  T_DIAGRAM,
  T_KANBAN,
  type FlowScene
} from './flow-scene';
import { SpatialFixture } from './SpatialFixture';
import { HomeFlowWireframe, InboxWireframe } from './wireframes';

const CHAPTERS = [
  { label: 'Start a task', time: 0 },
  { label: 'Follow progress', time: T_KANBAN },
  { label: 'Answer a question', time: null },
  { label: 'Review the result', time: T_DIAGRAM }
] as const;

export function CompactDemo({
  scene,
  inbox
}: {
  scene: FlowScene;
  inbox: boolean;
}) {
  return (
    <div className="demo-compact">
      <span>
        {inbox
          ? 'Inbox · Needs your answer'
          : `${scene.harness} · Checkout project`}
      </span>
      <h4>
        {inbox
          ? 'Which retry budget for checkout?'
          : 'Fix the flaky checkout tests'}
      </h4>
      <p>
        {inbox
          ? 'Reply from the Inbox. Your answer goes back to the waiting agent.'
          : scene.caption}
      </p>
      {inbox ? (
        <p>Keep the decision with the task, so work can continue.</p>
      ) : scene.view === 'home' ? (
        <p>Choose your coding agent, describe the work, and start a Thread.</p>
      ) : (
        <ol>
          {scene.tools.length ? (
            scene.tools.map((tool) => <li key={tool.label}>{tool.label}</li>)
          ) : (
            <li>
              The session is working. Follow its progress on the Agents board.
            </li>
          )}
        </ol>
      )}
      {!inbox && scene.sideTab === 'diff' && (
        <code>
          + beforeEach(() =&gt; {'{'}
          <br />+ mockStripe.reset();
          <br />+ {'}'});
        </code>
      )}
    </div>
  );
}

export function ProductDemo(): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [inbox, setInbox] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReduceMotion(media.matches);
      if (media.matches) setPlaying(false);
    };
    update();
    media.addEventListener('change', update);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      media.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!playing || !visible || reduceMotion) return;
    let frame = 0;
    let lastPaint = 0;
    const start = performance.now() - elapsedRef.current;
    const tick = (now: number) => {
      const next = Math.min(now - start, FLOW_LOOP_MS - 1);
      elapsedRef.current = next;
      if (now - lastPaint >= 42 || next === FLOW_LOOP_MS - 1) {
        setElapsed(next);
        lastPaint = now;
      }
      if (next === FLOW_LOOP_MS - 1) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, visible, reduceMotion]);

  function seek(time: number | null) {
    setPlaying(false);
    setInbox(time === null);
    if (time !== null) {
      elapsedRef.current = time;
      setElapsed(time);
    }
  }

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }
    setInbox(false);
    if (inbox || elapsedRef.current >= FLOW_LOOP_MS - 1) {
      elapsedRef.current = 0;
      setElapsed(0);
    }
    setPlaying(true);
  }

  const scene = sceneForElapsed(elapsed);
  const active = inbox
    ? 2
    : elapsed >= T_DIAGRAM
      ? 3
      : elapsed >= T_KANBAN
        ? 1
        : 0;
  return (
    <div className="product-tour" data-tour-demo ref={rootRef}>
      <section aria-label="Product demo">
        <div className="demo-controls">
          <div
            className="demo-chapters"
            role="group"
            aria-label="Demo chapters"
          >
            {CHAPTERS.map((chapter, index) => (
              <button
                type="button"
                key={chapter.label}
                aria-pressed={active === index}
                onClick={() => seek(chapter.time)}
              >
                <span aria-hidden="true">0{index + 1}</span>
                {chapter.label}
              </button>
            ))}
          </div>
          <div className="demo-playback">
            {!reduceMotion && (
              <button type="button" onClick={togglePlayback}>
                {playing ? 'Pause demo' : 'Play demo'}
              </button>
            )}
            <button type="button" onClick={() => seek(0)}>
              Restart
            </button>
          </div>
        </div>
        <header className="product-tour-heading">
          <h3>
            {inbox
              ? 'Your Inbox'
              : scene.view === 'home'
                ? 'New Chat'
                : scene.view === 'kanban'
                  ? 'The Agents board'
                  : 'Your Thread'}
          </h3>
          <p>
            {inbox
              ? 'Make a decision, and send it back to the agent.'
              : scene.caption}
          </p>
        </header>
        <div className="demo-desktop">
          <SpatialFixture>
            {inbox ? <InboxWireframe /> : <HomeFlowWireframe scene={scene} />}
          </SpatialFixture>
        </div>
        <CompactDemo scene={scene} inbox={inbox} />
        <div className="product-tour-more">
          <span>Illustrative product walkthrough · Explore at your pace</span>
          <Link className="text-link" href="/features/">
            See all features <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
