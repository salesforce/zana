'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { spatialFixtureScale } from './slides';

export function SpatialFixture({ children }: { children: ReactNode }): ReactNode {
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
    const measure = () => {
      const authoredWidth = fixture.scrollWidth;
      const authoredHeight = fixture.scrollHeight;
      const scale = spatialFixtureScale(frame.clientWidth, authoredWidth);
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
    return () => observer.disconnect();
  }, []);

  const scaled = geometry.height !== null;
  return (
    <div
      ref={frameRef}
      data-tour-scale={geometry.scale.toFixed(4)}
      className="product-tour-spatial"
      style={scaled ? { height: geometry.height ?? undefined } : undefined}
    >
      <div
        ref={fixtureRef}
        className="product-tour-spatial-inner"
        style={
          scaled
            ? ({
                transform: `scale(${geometry.scale})`,
                width: geometry.width ?? undefined,
                marginLeft: geometry.offsetX
              } as CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
