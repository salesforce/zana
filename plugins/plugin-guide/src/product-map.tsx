import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import {
  annotationChipCounterScale,
  annotationNeighbors,
  CHIP_COUNTER_SCALE_PROPERTY,
  panCarets,
  spatialFixtureScale,
  SURFACE_NUMBERS
} from './annotation.js';
import { GROUP_BY_SURFACE_ID, SURFACE_GROUPS, SURFACES_BY_ID, type SurfaceGroup } from './surfaces.js';
import { SurfaceCard } from './surface-card.js';
import {
  AppShellWireframe,
  ComposerWireframe,
  HomeWireframe,
  PaletteWireframe,
  PlatformWireframe,
  SettingsWireframe,
  SurfaceMapContext,
  ThreadWireframe
} from './wireframes.js';

export { annotationNeighbors, panCarets, spatialFixtureScale, SURFACE_NUMBERS } from './annotation.js';
export { MAX_FIXTURE_SCALE } from './annotation.js';

function SlideContent({ group }: { group: SurfaceGroup }): ReactNode {
  switch (group.id) {
    case 'app-shell':
      return <AppShellWireframe />;
    case 'home':
      return <HomeWireframe />;
    case 'composer':
      return <ComposerWireframe />;
    case 'thread':
      return <ThreadWireframe />;
    case 'command-palette':
      return <PaletteWireframe />;
    case 'settings':
      return <SettingsWireframe />;
    default:
      return <PlatformWireframe />;
  }
}

function SpatialFixture({ children }: { children: ReactNode }): ReactNode {
  const frameRef = useRef<HTMLDivElement>(null);
  const fixtureRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({
    scale: 1,
    height: null as number | null,
    width: null as number | null,
    offsetX: 0
  });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const fixture = fixtureRef.current;
    if (!frame || !fixture) return;
    const viewport = frame.closest<HTMLElement>('[data-guide-stage-viewport]');
    const measure = () => {
      const authoredWidth = fixture.scrollWidth;
      const authoredHeight = fixture.scrollHeight;
      const flowCard = frame.closest('section')?.querySelector<HTMLElement>('[data-guide-card-flow]');
      const cardFootprint = flowCard
        ? flowCard.getBoundingClientRect().height + parseFloat(getComputedStyle(flowCard).marginTop || '0')
        : 0;
      const availableHeight = viewport
        ? viewport.clientHeight -
          (frame.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop) -
          cardFootprint -
          8
        : undefined;
      const scale = spatialFixtureScale(frame.clientWidth, authoredWidth, availableHeight, authoredHeight);
      const scaled = Math.abs(scale - 1) >= 0.0001;
      const height = scaled ? authoredHeight * scale : null;
      const width = scaled ? authoredWidth : null;
      const offsetX = scaled ? (frame.clientWidth - authoredWidth) / 2 : 0;
      setGeometry((current) =>
        Math.abs(current.scale - scale) < 0.0001 &&
        current.height === height &&
        current.width === width &&
        Math.abs(current.offsetX - offsetX) < 0.5
          ? current
          : { scale, height, width, offsetX }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(fixture);
    if (viewport) observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const scaled = geometry.height !== null;
  return (
    <div
      ref={frameRef}
      data-guide-responsive-strategy="scale-together"
      data-guide-scale={geometry.scale.toFixed(4)}
      className="plugin-guide-spatial"
      style={scaled ? { height: geometry.height ?? undefined } : undefined}
    >
      <div
        ref={fixtureRef}
        className="plugin-guide-spatial-inner"
        style={
          {
            [CHIP_COUNTER_SCALE_PROPERTY]: annotationChipCounterScale(geometry.scale),
            ...(scaled
              ? {
                  transform: `scale(${geometry.scale})`,
                  width: geometry.width ?? undefined,
                  marginLeft: geometry.offsetX
                }
              : undefined)
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

function Slide({ group }: { group: SurfaceGroup }): ReactNode {
  if (group.fixtureKind === 'capability-grid') {
    return (
      <div data-guide-responsive-strategy="reflow" className="plugin-guide-reflow">
        <SlideContent group={group} />
      </div>
    );
  }
  return (
    <SpatialFixture>
      <SlideContent group={group} />
    </SpatialFixture>
  );
}

function PanButton({
  direction,
  disabled,
  onClick
}: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${direction === 'previous' ? 'Previous' : 'Next'} surface`}
      className="plugin-guide-pan"
    >
      {direction === 'previous' ? '‹' : '›'}
    </button>
  );
}

export function ProductMap({
  initialSlideId,
  onSlideChange,
  pluginPageHref
}: {
  initialSlideId?: string;
  onSlideChange?: (slideId: string) => void;
  pluginPageHref?: (name: string) => string | null;
}): ReactNode {
  const slides = SURFACE_GROUPS;
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => Math.max(0, slides.findIndex((slide) => slide.id === initialSlideId)));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const show = useCallback(
    (next: number) => {
      if (next < 0 || next >= slides.length) return;
      setOpenId(null);
      setHoverId(null);
      setIndex(next);
      onSlideChange?.(slides[next]?.id ?? 'app-shell');
    },
    [onSlideChange, slides]
  );

  const goToSurface = useCallback(
    (id: string) => {
      const group = GROUP_BY_SURFACE_ID.get(id);
      if (!group) return;
      const target = slides.findIndex((slide) => slide.id === group.id);
      if (target === -1) return;
      if (target !== index) show(target);
      setOpenId(id);
    },
    [index, show, slides]
  );

  const mapState = useMemo(
    () => ({
      activeId: hoverId,
      setActiveId: setHoverId,
      expandedId: openId,
      numberOf: (id: string) => SURFACE_NUMBERS.get(id) ?? null,
      onSelect: setOpenId,
      pluginPageHref,
      currentGroupId: slides[index]?.id,
      onGoToSurface: goToSurface
    }),
    [goToSurface, hoverId, index, openId, pluginPageHref, slides]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(index - 1);
    }
  };

  useEffect(() => {
    if (openId === null) return;
    const container = containerRef.current;
    if (!container) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[role="dialog"]')) return;
      if (target.closest('a[href^="#surface-"]')) return;
      setOpenId(null);
    };
    container.addEventListener('pointerdown', onPointerDown);
    return () => container.removeEventListener('pointerdown', onPointerDown);
  }, [openId]);

  const openSurface = openId ? SURFACES_BY_ID.get(openId) : undefined;
  const group = slides[index] ?? slides[0];
  const carets = panCarets(index, slides.length);

  return (
    <SurfaceMapContext.Provider value={mapState}>
      <div ref={containerRef} className="plugin-guide">
        <section aria-roledescription="carousel" aria-label="Plugin surfaces" onKeyDown={onKeyDown}>
          <header className="plugin-guide-heading">
            <h2>{group?.title}</h2>
            <p>{group?.blurb}</p>
          </header>
          <div className="plugin-guide-pages">
            <PanButton direction="previous" disabled={!carets.previous} onClick={() => show(index - 1)} />
            <ul className="plugin-guide-page-list">
              {slides.map((entry, slideIndex) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={slideIndex === index ? 'true' : undefined}
                    className={slideIndex === index ? 'is-active' : undefined}
                    onClick={() => show(slideIndex)}
                  >
                    {entry.title}
                  </button>
                </li>
              ))}
            </ul>
            <PanButton direction="next" disabled={!carets.next} onClick={() => show(index + 1)} />
          </div>
          <div className="plugin-guide-carousel" style={{ transform: `translateX(-${index * 100}%)` }}>
            {slides.map((entry, slideIndex) => (
              <div
                key={entry.id}
                data-map-section={entry.id}
                className="plugin-guide-carousel-item"
                inert={slideIndex !== index || undefined}
              >
                <Slide group={entry} />
              </div>
            ))}
          </div>
          {openSurface && group ? (
            <div data-guide-card-flow className="plugin-guide-card-flow">
              <SurfaceCard
                surface={openSurface}
                number={SURFACE_NUMBERS.get(openSurface.id) ?? null}
                onDismiss={() => setOpenId(null)}
                navigation={{
                  ...annotationNeighbors(group.surfaces, openSurface.id),
                  onOpen: goToSurface
                }}
              />
            </div>
          ) : null}
        </section>
      </div>
    </SurfaceMapContext.Provider>
  );
}
