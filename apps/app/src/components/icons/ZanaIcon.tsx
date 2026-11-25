import zanaGlyph from '../../assets/zana-glyph.svg';

/** The existing brand silhouette, tinted by its surrounding control. */
export function ZanaIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <span className={`zana-brand-icon ${className}`.trim()} aria-hidden="true" style={{
    display: 'inline-block', flexShrink: 0, width: size, height: size,
    backgroundColor: 'currentColor', mask: `url("${zanaGlyph}") center / contain no-repeat`
  }} />;
}
