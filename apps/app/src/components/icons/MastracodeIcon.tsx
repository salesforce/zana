interface Props {
  size?: number;
  className?: string;
}

/** Mastra Code brand mark. Uses currentColor so it tracks the picker chrome. */
export function MastracodeIcon({ size = 14, className }: Props) {
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
      <path d="M3.5 19V5h4.1L12 13.4 16.4 5h4.1v14h-3.6V9.8L13.2 19h-2.4L7.1 9.8V19z" />
    </svg>
  );
}
