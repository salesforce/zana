// Resolve a lucide icon *name* (string) to its component. Extensions and app
// modules name their icons as strings so the contract carries no dependency on
// lucide-react's types; core resolves the name here against lucide's registry,
// falling back to a neutral glyph for an unknown name (never throws).
//
// PERF — no eager barrel. The obvious `import { icons } from 'lucide-react'`
// pulls the ENTIRE registry (1500+ `createLucideIcon` factories, ~775 KB raw)
// into the first-paint chunk, because a string-indexed namespace object can't be
// tree-shaken. Icon names here are dynamic (extension/team/module manifests, an
// open runtime set), so a static named-import allowlist can't cover them either.
// Instead we lean on lucide's own per-icon code-split map (`dynamicIconImports`,
// one `() => import()` per icon) and return a tiny wrapper that loads its single
// icon on first render and caches it. The synchronous `resolveIcon(name)`
// contract is preserved for the ~12 call sites (`const Icon = resolveIcon(n)`
// then `<Icon />`); only the glyph bytes move out of the entry chunk.
import { createElement, forwardRef, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';

type IconLoader = () => Promise<{ default: LucideIcon }>;
const loaders = dynamicIconImports as unknown as Record<string, IconLoader>;

// PascalCase (`ShieldAlert`) → kebab-case (`shield-alert`), matching lucide's own
// key format. Mirrors lucide's toKebabCase: split camel humps and letter→digit
// boundaries (`Code2` → `code-2`).
function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();
}

// Deprecated PascalCase aliases still used across the app's manifests/defaults
// that `dynamicIconImports` no longer keys (lucide renamed them, but kept the
// re-export files). Map each to its canonical kebab key so it resolves to the
// right glyph instead of the fallback. HelpCircle is the fallback icon itself,
// so it MUST resolve.
const ALIASES: Record<string, string> = {
  'help-circle': 'circle-help',
  'pause-circle': 'circle-pause',
  'check-square': 'square-check-big',
  'code-2': 'code-xml',
  'users-2': 'users-round'
};

const FALLBACK_KEY = 'circle-help'; // canonical key for the old HelpCircle

function keyFor(name: string): string {
  const kebab = toKebab(name);
  const resolved = ALIASES[kebab] ?? kebab;
  return loaders[resolved] ? resolved : FALLBACK_KEY;
}

// Cache of the resolved glyph component once its chunk has loaded, keyed by the
// canonical lucide key — shared across every wrapper for the same icon so a
// second `resolveIcon('X')` renders it synchronously with no reload/flash.
const loaded = new Map<string, LucideIcon>();
// Cache of the wrapper components themselves, keyed by the ORIGINAL name. Call
// sites invoke resolveIcon() during render (e.g. inside a `.map`), so a fresh
// wrapper each call would remount every icon — and re-trigger its dynamic
// import — on every parent render. One stable wrapper per name fixes that.
const wrappers = new Map<string, LucideIcon>();

function makeWrapper(name: string): LucideIcon {
  const key = keyFor(name);
  const Wrapper = forwardRef<SVGSVGElement, LucideProps>(function Icon(props, ref) {
    const [Comp, setComp] = useState<LucideIcon | null>(() => loaded.get(key) ?? null);
    useEffect(() => {
      if (Comp) return;
      let alive = true;
      void loaders[key]()
        .then((mod) => {
          loaded.set(key, mod.default);
          if (alive) setComp(() => mod.default);
        })
        .catch(() => {
          /* chunk load failed — leave the placeholder; never throw during render */
        });
      return () => {
        alive = false;
      };
    }, [Comp]);
    // Until the glyph chunk resolves, render a zero-content placeholder sized like
    // the icon (default lucide box is 24; honor an explicit size) so there's no
    // layout shift when it swaps in. Loading from local disk lands within a frame.
    if (!Comp) {
      const size = props.size ?? '1em';
      return createElement('span', {
        'aria-hidden': true,
        style: { display: 'inline-block', width: size, height: size },
        className: props.className
      });
    }
    return createElement(Comp, { ...props, ref });
  });
  return Wrapper as unknown as LucideIcon;
}

export function resolveIcon(name: string | null | undefined): LucideIcon {
  const resolvedName = typeof name === 'string' && name.length > 0 ? name : 'HelpCircle';
  let wrapper = wrappers.get(resolvedName);
  if (!wrapper) {
    wrapper = makeWrapper(resolvedName);
    wrappers.set(resolvedName, wrapper);
  }
  return wrapper;
}
