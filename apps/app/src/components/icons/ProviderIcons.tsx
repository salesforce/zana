interface Props {
  size?: number;
  className?: string;
}

/**
 * LLM-provider brand marks for the "LLM Providers" settings list — the glyph
 * column of each compact provider row, twins of the editor glyphs
 * (`CursorIcon`/`IntelliJIcon`). All use `currentColor` so they pick up the row
 * theme like the Lucide icons beside them, and are hand-tuned to read at
 * 12-18px.
 */

/** Anthropic — the stylized "A" burst mark (two converging strokes). */
export function AnthropicIcon({ size = 14, className }: Props) {
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
      {/* Two angled blades meeting at the apex — Anthropic's "A" glyph. */}
      <path d="M14.5 3.5 L21 20.5 L17 20.5 L15.6 16.8 L9.4 16.8 L11 12.9 L14.2 12.9 L12.5 8.4 L7.9 20.5 L3.8 20.5 L10.3 3.5 Z" />
    </svg>
  );
}

/** OpenAI — the interlocking six-fold knot, rendered as a simplified ring. */
export function OpenAIIcon({ size = 14, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Simplified rounded-hex ring evoking the OpenAI knot silhouette. */}
      <path d="M12 3.2 L18.6 7 L18.6 14.6 L12 18.4 L5.4 14.6 L5.4 7 Z" />
      <path d="M12 8 L12 12 L15.4 13.9" />
    </svg>
  );
}

/** Google — the four-colour-agnostic "G" swept ring in monochrome. */
export function GoogleGeminiIcon({ size = 14, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Gemini spark — a four-point star (the Gemini/Bard mark). */}
      <path
        d="M12 3 C12 7 13 10 21 12 C13 14 12 17 12 21 C12 17 11 14 3 12 C11 10 12 7 12 3 Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** Generic gateway/endpoint mark for custom OpenAI-compatible providers. */
export function CustomEndpointIcon({ size = 14, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Plug/route node — a hub with two spokes. */}
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3 L12 9 M12 15 L12 21 M4 8 L9 11 M15 13 L20 16" />
    </svg>
  );
}
