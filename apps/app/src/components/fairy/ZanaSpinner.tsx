import type { ReactNode } from 'react';
import { ZanaFairy } from './ZanaFairy.js';
import './fairy.css';

const WING = 'M-2 -3C-12 -4 -21 -12 -21 -26C-10 -24 -3 -16 -2 -3Z';

/**
 * The four fairy wings as a pinwheel around a gold centre. Drop-in for
 * lucide's `Loader2`: same `size` / `className` / aria props, decorative
 * unless an `aria-label` is passed.
 */
export function ZanaSpinner({
  size = 16,
  className,
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
  ...rest
}: {
  size?: number;
  className?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  'data-testid'?: string;
}) {
  const labelled = Boolean(ariaLabel);
  return (
    <svg
      {...rest}
      className={`fairy-spinner${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="-32 -32 64 64"
      focusable="false"
      role={labelled ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={labelled ? undefined : (ariaHidden ?? true)}
    >
      {[0, 90, 180, 270].map((rotation, index) => (
        <path key={rotation} d={WING} transform={`rotate(${rotation})`} opacity={1 - index * 0.22} />
      ))}
      <circle r="5" />
    </svg>
  );
}

/** Small list empty state: a still fairy with a glinting star beside a short line. */
export function FairyEmpty({
  title,
  hint,
  className,
  children
}: {
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`fairy-empty${className ? ` ${className}` : ''}`}>
      <ZanaFairy mood="still" />
      <div className="fairy-empty-copy">
        <span className="fairy-empty-title">{title}</span>
        {hint ? <span className="fairy-empty-hint">{hint}</span> : null}
        {children}
      </div>
    </div>
  );
}
