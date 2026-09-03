'use client';

import { useCallback, useEffect, type ReactNode } from 'react';
import { anchorForSlide, SLIDES, slideIdFromHash } from './slides';
import { SpatialFixture } from './SpatialFixture';
import { writeSlideHash } from './tour-hash';
import { TourNavContext } from './tour-nav';
import { SlideWireframe } from './wireframes';

export function ProductGallery(): ReactNode {
  const goToSlide = useCallback((slideId: string) => {
    const target = document.getElementById(anchorForSlide(slideId));
    if (!target) return;
    writeSlideHash(slideId);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    const id = slideIdFromHash(window.location.hash);
    if (!id) return;
    const target = document.getElementById(anchorForSlide(id));
    target?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <TourNavContext.Provider value={goToSlide}>
      <div className="product-tour product-tour-gallery" data-tour-gallery>
        {SLIDES.map((slide) => (
          <section
            key={slide.id}
            id={anchorForSlide(slide.id)}
            data-tour-slide={slide.id}
            className="product-tour-gallery-section"
            aria-labelledby={`${anchorForSlide(slide.id)}-heading`}
          >
            <header className="product-tour-heading">
              <h2 id={`${anchorForSlide(slide.id)}-heading`}>{slide.title}</h2>
              <p>{slide.blurb}</p>
            </header>
            <SpatialFixture>
              <SlideWireframe slideId={slide.id} />
            </SpatialFixture>
          </section>
        ))}
      </div>
    </TourNavContext.Provider>
  );
}
