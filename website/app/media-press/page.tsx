import type { Metadata } from 'next';
import { site } from '../../lib/site';
import { PresentationPlayer } from './PresentationPlayer';
import styles from './media-press.module.css';

const description = 'The Zana story, ready to share. Explore the original presentation, download the slides, and find brand assets.';

export const metadata: Metadata = {
  title: 'Media & Press',
  description,
  alternates: { canonical: '/media-press/' },
  openGraph: {
    title: 'Media & Press — Zana',
    description,
    url: '/media-press/',
    type: 'website',
    images: [{ url: '/media/presentations/zana-cover.webp', width: 1600, height: 900, alt: 'Zana — One workspace for every AI agent' }]
  }
};

export default function MediaPressPage() {
  return (
    <div className={styles.page}>
      <div className="wrap">
        <header className={styles.hero}>
          <p className="fairy-kicker">The Zana story</p>
          <h1>Media &amp; Press</h1>
          <p className={styles.lede}>Presentations, product visuals, and brand assets for sharing Zana with your team and the world.</p>
        </header>

        <article className={styles.feature} aria-labelledby="presentation-heading">
          <PresentationPlayer />
          <div className={styles.caption}>
            <div>
              <p className={styles.eyebrow}>Featured presentation · 16 slides</p>
              <h2 id="presentation-heading">One workspace for every AI agent.</h2>
              <p>The original presentation, with its animations and product views. Use the arrow keys to explore.</p>
            </div>
            <a className="zcc-btn zcc-btn-primary" href="/media/presentations/zana.html#1" target="_blank" rel="noopener noreferrer">Open presentation <span aria-hidden="true">↗</span></a>
          </div>
        </article>

        <section className={styles.resources} aria-label="Downloads">
          <article>
            <p className={styles.eyebrow}>Read &amp; share</p>
            <h2>Presentation PDF</h2>
            <p>The same design, ready to read, print, and share. Text stays crisp as you zoom.</p>
            <a href="/media/presentations/zana.pdf" download>Download PDF <span aria-hidden="true">↓</span></a>
          </article>
          <article>
            <p className={styles.eyebrow}>Present anywhere</p>
            <h2>Offline presentation</h2>
            <p>Save the complete HTML presentation, including the images, and open it in your browser.</p>
            <a href="/media/presentations/zana.html" download>Download HTML <span aria-hidden="true">↓</span></a>
          </article>
          <article>
            <p className={styles.eyebrow}>Brand asset</p>
            <h2>The Zana mark</h2>
            <p>Our original vector mark, ready to use alongside a story, demo, or presentation.</p>
            <a href="/zana-mark.svg" download>Download SVG <span aria-hidden="true">↓</span></a>
          </article>
        </section>

        <section className={styles.about} aria-labelledby="about-zana-heading">
          <p className="fairy-kicker">About Zana</p>
          <h2 id="about-zana-heading">Every agent. One place.</h2>
          <p>Zana is a free, open source desktop app that brings AI coding agents, projects, and shared tools together. Teams choose the agent for each task, follow the work in one place, and share capabilities through plugins.</p>
          <div className="zcc-actions"><a className={styles.textLink} href={site.repo}>Explore the source <span aria-hidden="true">↗</span></a><a className={styles.textLink} href="/docs/getting-started/">Get started with Zana <span aria-hidden="true">→</span></a></div>
        </section>
      </div>
    </div>
  );
}
