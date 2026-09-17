import type { ReactNode } from "react";
const icon = (children: ReactNode) =>
  function Icon() {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  };
export const Cloud = icon(
  <path d="M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11-3 5.5 5.5 0 0 0 0 11Z" />,
);
export const Database = icon(
  <>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
  </>,
);
export const FlaskConical = icon(
  <path d="M9 3h6m-5 0v7L4 20q0 1 2 1h12q2 0 2-1l-6-10V3M7 16h10" />,
);
export const Package = icon(
  <path d="m12 2 10 5v10l-10 5-10-5V7Zm0 10L2 7m10 5L22 7M12 12v10M7 4.5l10 5" />,
);
export const Bot = icon(
  <>
    <rect x="3" y="7" width="18" height="14" rx="4" />
    <path d="M12 7V3m-1 0h2M8 12v2m8-2v2m-7 3h6" />
  </>,
);
export const ArrowUpRight = icon(<path d="M6 18 18 6M6 6h12v12" />);
export const CircleCheck = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </>,
);
