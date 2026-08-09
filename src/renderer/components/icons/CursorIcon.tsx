interface Props {
  size?: number;
  className?: string;
}

// Cursor app brand mark — stylized pointed-arrow silhouette inspired by the
// Cursor.com logo. Uses `currentColor` for fill so it picks up our toolbar
// theme like Lucide icons. Geometry is hand-tuned to read at 12-16px in
// the openers row and command palette.
export function CursorIcon({ size = 14, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden="true"
    >
      {/*
        Two stacked chevrons that form Cursor's signature folded-arrow mark.
        Top chevron is solid, bottom is rendered semi-transparent to suggest
        the back face — keeps the silhouette readable in monochrome chrome.
      */}
      <path d="M4 5 L12 9.5 L20 5 L12 14 Z" />
      <path d="M4 5 L12 14 L12 22 L4 17.5 Z" opacity="0.55" />
      <path d="M20 5 L20 17.5 L12 22 L12 14 Z" opacity="0.8" />
    </svg>
  );
}
