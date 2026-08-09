'use client';

import { useRouter } from 'next/navigation';
import type { DocMeta } from '@/lib/docs';

/** On narrow screens the docs sidebar collapses into a jump-to <select>. */
export function DocsMobileSelect({
  groups,
  active
}: {
  groups: { group: string; items: DocMeta[] }[];
  active?: string;
}) {
  const router = useRouter();
  return (
    <div className="docs-mobile-nav">
      <select
        aria-label="Jump to a doc"
        value={active ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v) router.push(`/docs/${v}/`);
        }}
      >
        {groups.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.items.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
