/**
 * The fairy — an Art-Nouveau figure in gold linework, floating with a wish-orb
 * that releases dandelion seeds. Ported from the Zana framework website's
 * `Fairy.astro`; adapted to JSX and to the ZCC theme (its gold/forest palette
 * reads on both the cream light theme and the warm dark theme).
 *
 * Animations (flutter / glow / drift + the hover on the wrapper) live in
 * globals.css and are fully disabled under `prefers-reduced-motion: reduce`.
 */
export function Fairy({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 380 540"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      role="img"
      aria-label="A fairy with four iridescent wings holds a glowing orb of light from which dandelion seeds drift upward"
      className={className}
    >
      <defs>
        <radialGradient id="halo" cx="50%" cy="34%" r="58%">
          <stop offset="0%" stopColor="#FFF4D1" stopOpacity="0.95" />
          <stop offset="40%" stopColor="#E5D4A1" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#C9A961" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wingUpper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FAF0CD" stopOpacity="0.92" />
          <stop offset="38%" stopColor="#E5D4A1" stopOpacity="0.55" />
          <stop offset="80%" stopColor="#C9A961" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#A88742" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="wingLower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E5D4A1" stopOpacity="0.7" />
          <stop offset="55%" stopColor="#D4B574" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#C9A961" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dress" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FAF6E8" />
          <stop offset="60%" stopColor="#F5ECCF" />
          <stop offset="100%" stopColor="#EFE0B8" />
        </linearGradient>
        <linearGradient id="bodice" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F8EFCD" />
          <stop offset="100%" stopColor="#E8D7A0" />
        </linearGradient>
        <radialGradient id="orb" cx="38%" cy="38%" r="55%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="35%" stopColor="#FFF4D1" />
          <stop offset="80%" stopColor="#E5C77A" />
          <stop offset="100%" stopColor="#C9A961" />
        </radialGradient>
        <radialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFF4D1" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FFF4D1" stopOpacity="0" />
        </radialGradient>
        <filter id="soft">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>

      {/* Halo */}
      <circle cx="190" cy="190" r="190" fill="url(#halo)" />

      {/* Wings — flutter as a unit */}
      <g className="fairy-flutter" style={{ transformOrigin: '190px 300px' }}>
        {/* Lower wings (further back, smaller, softer) */}
        <g opacity="0.7">
          <path
            d="M 168 268 C 112 290, 60 350, 58 430 C 56 480, 112 470, 148 425 C 168 395, 172 340, 168 285 Z"
            fill="url(#wingLower)"
            stroke="#C9A961"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path d="M 158 285 Q 105 340 78 420" stroke="#C9A961" strokeWidth="0.7" opacity="0.5" />
          <path d="M 162 305 Q 122 365 110 430" stroke="#C9A961" strokeWidth="0.5" opacity="0.4" />

          <path
            d="M 212 268 C 268 290, 320 350, 322 430 C 324 480, 268 470, 232 425 C 212 395, 208 340, 212 285 Z"
            fill="url(#wingLower)"
            stroke="#C9A961"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          <path d="M 222 285 Q 275 340 302 420" stroke="#C9A961" strokeWidth="0.7" opacity="0.5" />
          <path d="M 218 305 Q 258 365 270 430" stroke="#C9A961" strokeWidth="0.5" opacity="0.4" />
        </g>

        {/* Upper wings (large, iridescent, foreground) */}
        <g>
          <path
            d="M 175 235 C 100 195, 22 235, 22 312 C 22 366, 78 386, 132 365 C 162 350, 175 312, 175 268 Z"
            fill="url(#wingUpper)"
            stroke="#C9A961"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          {/* vein structure */}
          <path d="M 158 250 Q 110 248 65 290" stroke="#C9A961" strokeWidth="0.9" opacity="0.7" />
          <path d="M 162 270 Q 100 290 55 332" stroke="#C9A961" strokeWidth="0.7" opacity="0.6" />
          <path d="M 168 295 Q 120 330 100 363" stroke="#C9A961" strokeWidth="0.5" opacity="0.5" />
          <path d="M 158 250 C 130 270, 110 295, 100 320" stroke="#C9A961" strokeWidth="0.4" opacity="0.4" />
          {/* gem dots scattered along veins */}
          <g fill="#C9A961" filter="url(#soft)">
            <circle cx="80" cy="290" r="1.6" opacity="0.7" />
            <circle cx="110" cy="258" r="1.2" opacity="0.55" />
            <circle cx="98" cy="335" r="1.1" opacity="0.6" />
            <circle cx="135" cy="310" r="0.9" opacity="0.5" />
            <circle cx="60" cy="320" r="1.4" opacity="0.55" />
          </g>

          <path
            d="M 205 235 C 280 195, 358 235, 358 312 C 358 366, 302 386, 248 365 C 218 350, 205 312, 205 268 Z"
            fill="url(#wingUpper)"
            stroke="#C9A961"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M 222 250 Q 270 248 315 290" stroke="#C9A961" strokeWidth="0.9" opacity="0.7" />
          <path d="M 218 270 Q 280 290 325 332" stroke="#C9A961" strokeWidth="0.7" opacity="0.6" />
          <path d="M 212 295 Q 260 330 280 363" stroke="#C9A961" strokeWidth="0.5" opacity="0.5" />
          <path d="M 222 250 C 250 270, 270 295, 280 320" stroke="#C9A961" strokeWidth="0.4" opacity="0.4" />
          <g fill="#C9A961" filter="url(#soft)">
            <circle cx="300" cy="290" r="1.6" opacity="0.7" />
            <circle cx="270" cy="258" r="1.2" opacity="0.55" />
            <circle cx="282" cy="335" r="1.1" opacity="0.6" />
            <circle cx="245" cy="310" r="0.9" opacity="0.5" />
            <circle cx="320" cy="320" r="1.4" opacity="0.55" />
          </g>
        </g>
      </g>

      {/* Hair (back layer, behind head) */}
      <g stroke="#2D5F3F" fill="none" strokeLinejoin="round" strokeLinecap="round" opacity="0.75">
        <path d="M 167 110 C 145 130, 138 165, 148 210 C 154 234, 162 255, 174 270" strokeWidth="1.1" />
        <path d="M 213 110 C 235 130, 242 165, 232 210 C 226 234, 218 255, 206 270" strokeWidth="1.1" />
        <path d="M 178 260 C 172 285, 178 308, 190 315" strokeWidth="0.6" opacity="0.6" />
        <path d="M 202 260 C 208 285, 202 308, 190 315" strokeWidth="0.6" opacity="0.6" />
        <path d="M 152 200 C 142 220, 138 240, 142 255" strokeWidth="0.5" opacity="0.5" />
        <path d="M 228 200 C 238 220, 242 240, 238 255" strokeWidth="0.5" opacity="0.5" />
      </g>

      {/* Body / dress */}
      <g stroke="#2D5F3F" strokeLinejoin="round" strokeLinecap="round">
        {/* Head */}
        <ellipse cx="190" cy="142" rx="22" ry="26" fill="url(#dress)" strokeWidth="1.4" />

        {/* Circlet */}
        <path d="M 168 132 Q 190 124 212 132" stroke="#C9A961" strokeWidth="1.4" fill="none" />
        <circle cx="190" cy="125" r="2.4" fill="#C9A961" stroke="none" />
        <path d="M 184 126 L 196 126" stroke="#C9A961" strokeWidth="0.5" strokeDasharray="0.8 1.4" fill="none" />
        {/* circlet leaf flourish */}
        <path d="M 174 130 Q 168 124 174 120" stroke="#C9A961" strokeWidth="0.7" fill="none" />
        <path d="M 206 130 Q 212 124 206 120" stroke="#C9A961" strokeWidth="0.7" fill="none" />

        {/* Subtle face: closed eyes (serene), small mouth */}
        <g fill="none" strokeWidth="0.85">
          <path d="M 180 142 Q 184 140 188 142" />
          <path d="M 192 142 Q 196 140 200 142" />
          <path d="M 187 156 Q 190 158 193 156" />
        </g>

        {/* Neck */}
        <path d="M 184 167 L 184 180 M 196 167 L 196 180" strokeWidth="1.2" fill="none" />

        {/* Bodice */}
        <path
          d="M 184 180 C 170 198, 167 232, 174 270 L 206 270 C 213 232, 210 198, 196 180 Z"
          fill="url(#bodice)"
          strokeWidth="1.4"
        />
        {/* bodice lacing */}
        <path d="M 190 188 L 190 265" stroke="#C9A961" strokeWidth="0.6" strokeDasharray="0.8 2" fill="none" />
        <path d="M 178 210 Q 190 215 202 210" stroke="#C9A961" strokeWidth="0.5" fill="none" />
        <path d="M 176 230 Q 190 236 204 230" stroke="#C9A961" strokeWidth="0.5" fill="none" />
        <path d="M 175 250 Q 190 256 205 250" stroke="#C9A961" strokeWidth="0.5" fill="none" />

        {/* Skirt — long flowing layers */}
        <path
          d="M 174 270 C 152 330, 142 420, 165 495 L 215 495 C 238 420, 228 330, 206 270 Z"
          fill="url(#dress)"
          strokeWidth="1.4"
        />
        {/* skirt fold lines */}
        <path d="M 180 296 C 162 350, 162 425, 175 488" strokeWidth="0.7" opacity="0.55" fill="none" />
        <path d="M 200 296 C 218 350, 218 425, 205 488" strokeWidth="0.7" opacity="0.55" fill="none" />
        <path d="M 190 285 C 188 365, 192 445, 190 495" strokeWidth="0.5" opacity="0.45" fill="none" />
        <path d="M 168 360 C 175 380, 175 410, 168 440" strokeWidth="0.4" opacity="0.4" fill="none" />
        <path d="M 212 360 C 205 380, 205 410, 212 440" strokeWidth="0.4" opacity="0.4" fill="none" />

        {/* skirt hem */}
        <path d="M 165 495 Q 190 506 215 495" stroke="#C9A961" strokeWidth="1.2" fill="none" />
        <g fill="#C9A961" stroke="none">
          <circle cx="170" cy="500" r="0.9" />
          <circle cx="180" cy="503" r="0.9" />
          <circle cx="190" cy="504" r="1.1" />
          <circle cx="200" cy="503" r="0.9" />
          <circle cx="210" cy="500" r="0.9" />
        </g>

        {/* Sash */}
        <path d="M 173 268 Q 190 274 207 268" stroke="#C9A961" strokeWidth="1.6" fill="none" />
        <path d="M 196 273 L 199 296 Q 197 305 201 300" stroke="#C9A961" strokeWidth="0.8" fill="none" />

        {/* Right arm raised — holding orb */}
        <path d="M 199 184 C 222 180, 252 170, 278 152 L 290 132" strokeWidth="1.4" fill="none" />
        {/* right hand */}
        <path
          d="M 286 128 C 290 122, 296 122, 297 128 C 297 132, 293 134, 289 132 Z"
          strokeWidth="1.1"
          fill="url(#dress)"
        />

        {/* Left arm relaxed */}
        <path d="M 181 184 C 162 204, 152 232, 156 260" strokeWidth="1.4" fill="none" />
        {/* left hand */}
        <path
          d="M 153 258 C 150 263, 152 268, 158 266 C 162 264, 160 259, 156 257 Z"
          strokeWidth="1.1"
          fill="url(#dress)"
        />

        {/* Trailing ribbon from sash */}
        <path
          d="M 207 270 C 224 290, 230 320, 224 360 C 220 380, 224 395, 230 405"
          stroke="#C9A961"
          strokeWidth="0.9"
          fill="none"
          opacity="0.8"
        />
        <path d="M 230 405 C 234 410, 232 414, 228 412" stroke="#C9A961" strokeWidth="0.7" fill="none" />
      </g>

      {/* Glowing orb (in raised hand) */}
      <g className="fairy-glow" style={{ transformOrigin: '290px 118px' }}>
        <circle cx="290" cy="118" r="22" fill="url(#orbGlow)" />
        <circle cx="290" cy="118" r="11" fill="url(#orb)" />
        <circle cx="287" cy="115" r="3.2" fill="#FFFFFF" opacity="0.9" />
        <circle cx="290" cy="118" r="11" fill="none" stroke="#C9A961" strokeWidth="0.5" opacity="0.6" />
        {/* inner spark */}
        <path d="M 290 113 L 290 123 M 285 118 L 295 118" stroke="#FFF4D1" strokeWidth="0.6" opacity="0.7" />
      </g>

      {/* Drifting seeds rising from the orb */}
      <g fill="#C9A961" stroke="#C9A961" strokeWidth="0.5" strokeLinecap="round" filter="url(#soft)">
        <g className="fairy-drift" style={{ animationDelay: '0s', transformOrigin: '290px 110px' }}>
          <circle cx="290" cy="108" r="1.7" />
          <path d="M 290 108 L 294 102 M 290 108 L 286 102 M 290 108 L 290 99 M 290 108 L 296 105 M 290 108 L 284 105" />
        </g>
        <g className="fairy-drift" style={{ animationDelay: '1.6s', transformOrigin: '305px 102px' }}>
          <circle cx="305" cy="100" r="1.4" />
          <path d="M 305 100 L 309 94 M 305 100 L 301 94 M 305 100 L 311 98" />
        </g>
        <g className="fairy-drift" style={{ animationDelay: '3.2s', transformOrigin: '278px 96px' }}>
          <circle cx="278" cy="96" r="1.5" />
          <path d="M 278 96 L 278 88 M 278 96 L 282 90 M 278 96 L 274 90" />
        </g>
        <g className="fairy-drift" style={{ animationDelay: '4.8s', transformOrigin: '295px 90px' }}>
          <circle cx="295" cy="90" r="1.2" />
          <path d="M 295 90 L 297 84 M 295 90 L 293 84" />
        </g>
        <g className="fairy-drift" style={{ animationDelay: '6.2s', transformOrigin: '268px 105px' }}>
          <circle cx="268" cy="105" r="1.1" />
          <path d="M 268 105 L 266 99 M 268 105 L 270 99" />
        </g>
      </g>

      {/* Decorative sparkle stars in halo */}
      <g stroke="#C9A961" strokeWidth="0.8" fill="none" className="fairy-glow">
        <path d="M 60 100 L 60 112 M 54 106 L 66 106" />
        <path d="M 320 88 L 320 98 M 315 93 L 325 93" />
        <path d="M 50 220 L 50 228 M 46 224 L 54 224" />
        <path d="M 340 200 L 340 208 M 336 204 L 344 204" />
        <path d="M 100 60 L 100 66 M 97 63 L 103 63" />
        <path d="M 280 50 L 280 56 M 277 53 L 283 53" />
      </g>
    </svg>
  );
}
