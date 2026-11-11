import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './extensions.module.css';

export type IconName =
  | 'download' | 'code' | 'layers' | 'shield' | 'check' | 'refresh' | 'folder' | 'git' | 'store'
  | 'edit' | 'book' | 'box' | 'plug' | 'bolt' | 'key' | 'arrow' | 'terminal' | 'panel' | 'seed' | 'eye';

const PATHS_D: Record<IconName, ReactNode> = {
  download: <><path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 19h14" /></>,
  code: <><path d="m9 8-4 4 4 4" /><path d="m15 8 4 4-4 4" /></>,
  layers: <><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14 4l2-2" /><path d="M20 20v-5h-5" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  git: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 8v8" /><path d="M18 11c0 4-6 3-10 6" /></>,
  store: <><path d="M4 9l1.5-5h13L20 9" /><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9" /><path d="M5 12v8h14v-8" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13 7 4 4" /></>,
  book: <><path d="M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5z" /><path d="M19 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" /></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5" /><path d="M12 12v9" /></>,
  plug: <><path d="M9 3v5" /><path d="M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  key: <><circle cx="8" cy="14" r="4" /><path d="m11 11 8-8" /><path d="m16 6 3 3" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  terminal: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 10 3 2-3 2" /><path d="M13 15h4" /></>,
  panel: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 5v14" /></>,
  seed: <><path d="M12 21v-9" /><path d="M12 12c0-4 3-6 7-6 0 4-3 6-7 6z" /><path d="M12 15c0-3-2-5-6-5 0 3 2 5 6 5z" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>
};

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS_D[name]}
    </svg>
  );
}

export function SectionHead({ eyebrow, children, lede }: { eyebrow: string; children: ReactNode; lede?: ReactNode }) {
  return (
    <div className={s.head} data-reveal>
      <p className={s.eyebrow}>{eyebrow}</p>
      <h2>{children}</h2>
      {lede ? <p className={s.lede}>{lede}</p> : null}
    </div>
  );
}

export function Grad({ children }: { children: ReactNode }) {
  return <span className={s.grad}>{children}</span>;
}

/** Trust / checklist card replacing the plain `.proof` box. */
export function ProofCard({ eyebrow, title, body, items, icon = 'shield', link }: {
  eyebrow: string; title: string; body: ReactNode; items?: ReactNode[]; icon?: IconName; link?: { href: string; label: string };
}) {
  return (
    <div className={s.proof} data-reveal>
      <div className={s.proofMain}>
        <span className={s.tile}><Icon name={icon} size={26} /></span>
        <p className={s.eyebrowLeft}>{eyebrow}</p>
        <h2>{title}</h2>
        <p className={s.body}>{body}</p>
        {link ? <Link className={s.link} href={link.href}>{link.label}</Link> : null}
      </div>
      {items ? (
        <ul className={s.checks}>
          {items.map((item, i) => (
            <li key={i}><span className={s.checkDot}><Icon name="check" size={13} /></span><span>{item}</span></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function NextCard({ eyebrow, title, body, actions }: { eyebrow: string; title: string; body: string; actions: ReactNode }) {
  return (
    <div className={s.next} data-reveal>
      <img className={s.nextHub} src="/zana-icon-512.png" alt="" width={72} height={72} />
      <div className={s.nextCopy}>
        <p className={s.eyebrowLeft}>{eyebrow}</p>
        <h2>{title}</h2>
        <p className={s.body}>{body}</p>
      </div>
      <div className={s.nextActions}>{actions}</div>
    </div>
  );
}

export { s as styles };
