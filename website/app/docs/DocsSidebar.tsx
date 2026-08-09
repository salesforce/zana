import Link from 'next/link';
import { docsByGroup } from '@/lib/docs';
import { DocsMobileSelect } from './DocsMobileSelect';
import { DocsSearchButton } from './DocsSearch';

export function DocsSidebar({ active, mobile }: { active?: string; mobile?: boolean }) {
  const groups = docsByGroup();

  if (mobile) {
    return <DocsMobileSelect groups={groups} active={active} />;
  }

  return (
    <nav className="docs-nav" aria-label="Documentation">
      <DocsSearchButton />
      {groups.map((g) => (
        <div className="group" key={g.group}>
          <div className="group-label">{g.group}</div>
          {g.items.map((d) => (
            <Link key={d.slug} href={`/docs/${d.slug}/`} className={active === d.slug ? 'active' : ''}>
              {d.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
