interface Props {
  size?: number;
  className?: string;
}

// IntelliJ IDEA brand mark — the stylized square with the lowercase "ij"
// bracket. Uses `currentColor` so it picks up our toolbar theme like the
// Lucide icons and CursorIcon beside it. Geometry is hand-tuned to read at
// 12-16px in the openers row.
export function IntelliJIcon({ size = 14, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Enclosing square (the IDEA app tile). */}
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {/* The "j" descender — a short bar hooking left along the bottom. */}
      <path d="M14 7 L14 15 Q14 17.5 11 17.5 L9 17.5" />
      {/* The "i" dot/bar accent at the top-left. */}
      <path d="M7 7 L9.5 7" />
    </svg>
  );
}
