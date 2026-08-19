import type { ButtonHTMLAttributes } from 'react';

export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
}

/** A prop-driven host primitive. Application policy belongs in app wrappers. */
export function Button({ tone = 'secondary', className = '', type, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={type ?? 'button'}
      data-zcc-tone={tone}
      className={`zcc-button ${className}`.trim()}
    />
  );
}
