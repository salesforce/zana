import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';

export const LOADING_REVEAL_DELAY_MS = 200;

const DEFAULT_LINE_WIDTHS = ['75%', '100%', '83%', '67%'] as const;
const DEFAULT_LIST_WIDTHS = ['75%', '67%', '80%', '60%', '67%'] as const;
const DEFAULT_FORM_ROWS = [
  { labelWidth: '56px', valueWidth: '160px' },
  { labelWidth: '56px', valueWidth: '112px' },
  { labelWidth: '56px', valueWidth: '144px' },
  { labelWidth: '56px', valueWidth: '96px' }
] as const;

function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Skeleton({
  className,
  width,
  height,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  width?: string;
  height?: string;
}) {
  return (
    <div
      {...props}
      className={classNames('zcc-skeleton', className)}
      style={{ width, height, ...style }}
      aria-hidden={props['aria-hidden'] ?? true}
    />
  );
}

export function DelayedLoading({
  children,
  delayMs = LOADING_REVEAL_DELAY_MS
}: {
  children: ReactNode;
  delayMs?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs]);

  return visible ? children : null;
}

function StencilStatus({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function StencilLines({
  label,
  widths = DEFAULT_LINE_WIDTHS,
  className
}: {
  label: string;
  widths?: readonly string[];
  className?: string;
}) {
  return (
    <StencilStatus label={label} className={classNames('zcc-stencil-lines', className)}>
      {widths.map((width, index) => (
        <Skeleton key={`${width}-${index}`} className="zcc-stencil-line" width={width} />
      ))}
    </StencilStatus>
  );
}

export function StencilList({
  label,
  widths = DEFAULT_LIST_WIDTHS,
  className
}: {
  label: string;
  widths?: readonly string[];
  className?: string;
}) {
  return (
    <StencilStatus label={label} className={classNames('zcc-stencil-list', className)}>
      {widths.map((width, index) => (
        <div key={`${width}-${index}`} className="zcc-stencil-list-row">
          <Skeleton className="zcc-stencil-list-icon" />
          <Skeleton className="zcc-stencil-line" width={width} />
        </div>
      ))}
    </StencilStatus>
  );
}

export function StencilForm({
  label,
  rows = DEFAULT_FORM_ROWS,
  className
}: {
  label: string;
  rows?: readonly { labelWidth?: string; valueWidth: string }[];
  className?: string;
}) {
  return (
    <StencilStatus label={label} className={classNames('zcc-stencil-form', className)}>
      {rows.map((row, index) => (
        <div key={`${row.valueWidth}-${index}`} className="zcc-stencil-form-row">
          <Skeleton className="zcc-stencil-form-label" width={row.labelWidth ?? '56px'} />
          <Skeleton className="zcc-stencil-form-value" width={row.valueWidth} />
        </div>
      ))}
    </StencilStatus>
  );
}

export function DelayedStencilLines(props: Parameters<typeof StencilLines>[0]) {
  return (
    <DelayedLoading>
      <StencilLines {...props} />
    </DelayedLoading>
  );
}

export function DelayedStencilList(props: Parameters<typeof StencilList>[0]) {
  return (
    <DelayedLoading>
      <StencilList {...props} />
    </DelayedLoading>
  );
}

export function DelayedStencilForm(props: Parameters<typeof StencilForm>[0]) {
  return (
    <DelayedLoading>
      <StencilForm {...props} />
    </DelayedLoading>
  );
}
