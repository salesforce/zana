interface Props {
  size?: number;
  className?: string;
}

/** Grok Build brand mark. Uses currentColor so it tracks the picker chrome. */
export function GrokIcon({ size = 14, className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2 4 7v10l8 5 8-5V7zm0 2.3 5.5 3.4v6.6L12 17.7 6.5 14.3V7.7z" />
    </svg>
  );
}
