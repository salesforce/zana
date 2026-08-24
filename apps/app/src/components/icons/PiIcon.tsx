interface Props {
  size?: number;
  className?: string;
}

/** Pi brand mark. Uses currentColor so it tracks the picker chrome. */
export function PiIcon({ size = 14, className }: Props) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      viewBox="100 100 600 600"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z" />
      <path d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </svg>
  );
}
