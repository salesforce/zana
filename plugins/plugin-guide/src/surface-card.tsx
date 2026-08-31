import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { GROUP_BY_SURFACE_ID, type PluginSurface } from './surfaces.js';
import { copyPluginSurfaceAgentReference } from './surfaces.js';
import {
  annotationChipClass,
  ExperimentalBadge,
  renderSurfaceCopy,
  type SurfaceReference
} from './annotation.js';
import { SurfaceMapContext } from './wireframes.js';

export function SurfaceCard({
  surface,
  number,
  onDismiss,
  navigation,
  probe = false
}: {
  surface: PluginSurface;
  number: number | null;
  onDismiss: () => void;
  navigation?: {
    previous: PluginSurface | null;
    next: PluginSurface | null;
    onOpen: (surfaceId: string) => void;
  };
  probe?: boolean;
}): ReactNode {
  const cardRef = useRef<HTMLDivElement>(null);
  const surfaceMap = useContext(SurfaceMapContext);
  const pluginPageHref = surfaceMap?.pluginPageHref;
  const { currentGroupId, onGoToSurface, numberOf } = surfaceMap ?? {};
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copyResetTimer = useRef<number | null>(null);

  useEffect(() => {
    setCopyState('idle');
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = null;
    }
  }, [surface.id]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    },
    []
  );

  const copyForAgent = useCallback(async () => {
    if (copyState === 'copying') return;
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(copyPluginSurfaceAgentReference(surface));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    copyResetTimer.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimer.current = null;
    }, 2000);
  }, [copyState, surface]);

  const resolveReference = useCallback(
    (id: string): SurfaceReference | null => {
      const group = GROUP_BY_SURFACE_ID.get(id);
      if (!group || !onGoToSurface) return null;
      return {
        number: numberOf?.(id) ?? null,
        otherPage: group.id === currentGroupId ? null : group.title,
        onOpen: () => onGoToSurface(id)
      };
    },
    [currentGroupId, numberOf, onGoToSurface]
  );

  useEffect(() => {
    if (probe) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss, probe]);

  useEffect(() => {
    if (probe) return;
    const timer = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [surface.id, probe]);

  return (
    <div
      ref={cardRef}
      role={probe ? undefined : 'dialog'}
      aria-label={probe ? undefined : surface.title}
      className="plugin-guide-card"
      id={`surface-${surface.id}`}
    >
      <div className="plugin-guide-card-head">
        {number === null ? null : (
          <span aria-hidden className={annotationChipClass(true)}>
            {number}
          </span>
        )}
        <h3>{surface.title}</h3>
        {surface.experimental ? <ExperimentalBadge /> : null}
        <div className="plugin-guide-card-nav" role="group" aria-label="Annotation navigation">
          {navigation
            ? (['previous', 'next'] as const).map((direction) => {
                const target = navigation[direction];
                const directionLabel = direction === 'previous' ? 'Previous' : 'Next';
                const label = target
                  ? `${directionLabel} annotation: ${target.title}`
                  : `No ${direction} annotation`;
                return (
                  <button
                    key={direction}
                    type="button"
                    disabled={!target}
                    aria-label={label}
                    title={label}
                    className="plugin-guide-icon-btn"
                    onClick={() => {
                      if (target) navigation.onOpen(target.id);
                    }}
                  >
                    {direction === 'previous' ? '‹' : '›'}
                  </button>
                );
              })
            : null}
          <button type="button" className="plugin-guide-icon-btn" onClick={onDismiss} aria-label="Close" title="Close annotation">
            ×
          </button>
        </div>
      </div>
      <p className="plugin-guide-card-summary">{renderSurfaceCopy(surface.summary, resolveReference)}</p>
      <ul>
        {surface.bullets.map((line) => (
          <li key={line}>{renderSurfaceCopy(line, resolveReference)}</li>
        ))}
      </ul>
      {surface.firstParty && surface.firstParty.length > 0 ? (
        <div className="plugin-guide-card-foot">
          <span className="plugin-guide-used-by-label">Used by</span>
          <div className="plugin-guide-used-by">
            {surface.firstParty.map((name) => {
              const href = pluginPageHref?.(name);
              return href ? (
                <a key={name} href={href}>
                  {name}
                </a>
              ) : (
                <span key={name}>{name}</span>
              );
            })}
          </div>
          <button type="button" className="plugin-guide-copy" onClick={() => void copyForAgent()} disabled={copyState === 'copying'}>
            <span aria-live="polite">
              {copyState === 'copying'
                ? 'Copying…'
                : copyState === 'copied'
                  ? 'Copied'
                  : copyState === 'failed'
                    ? 'Copy failed'
                    : 'Copy for agent'}
            </span>
          </button>
        </div>
      ) : (
        <div className="plugin-guide-card-foot">
          <button type="button" className="plugin-guide-copy" onClick={() => void copyForAgent()} disabled={copyState === 'copying'}>
            <span aria-live="polite">
              {copyState === 'copying'
                ? 'Copying…'
                : copyState === 'copied'
                  ? 'Copied'
                  : copyState === 'failed'
                    ? 'Copy failed'
                    : 'Copy for agent'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
