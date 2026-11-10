import Image from 'next/image';
import Link from 'next/link';
import styles from './constellation.module.css';

const fullColorIcons = new Set(['claude-code.svg', 'afcode.svg', 'slack.png', 'github.png']);

const nodes = [
  { id: 'claude', name: 'Claude Code', detail: 'Anthropic', icons: ['claude-code.svg'], href: '/docs/getting-started/' },
  { id: 'codex', name: 'Codex', detail: 'OpenAI', icons: ['codex.svg'], href: '/docs/getting-started/' },
  { id: 'cursor', name: 'Cursor', detail: 'Anysphere', icons: ['cursor.svg'], href: '/docs/getting-started/' },
  { id: 'opencode', name: 'OpenCode', detail: 'Open source', icons: ['opencode.svg'], href: '/docs/getting-started/' },
  { id: 'grok', name: 'Grok Build', detail: 'xAI', icons: ['grok.svg'], href: '/docs/getting-started/' },
  { id: 'agentforce', name: 'Agentforce Code', detail: 'Salesforce', icons: ['afcode.svg'], href: '/marketplace/' },
  { id: 'more', name: 'Pi · Mastra · ACP', detail: 'And the next one', icons: ['pi.svg', 'mastra.svg'], href: '/marketplace/' },
  { id: 'tools', name: 'Slack · GUS · GitHub', detail: 'Your tools', icons: ['slack.png', 'github.png'], href: '/marketplace/' }
] as const;

const connections = [
  { id: 'claude', x: 180, y: 94 },
  { id: 'codex', x: 560, y: 42 },
  { id: 'cursor', x: 940, y: 94 },
  { id: 'opencode', x: 130, y: 276 },
  { id: 'grok', x: 990, y: 276 },
  { id: 'agentforce', x: 246, y: 378 },
  { id: 'more', x: 874, y: 378 },
  { id: 'tools', x: 560, y: 430 }
] as const;

/** Real text and decorative SVG keep the diagram crisp and usable at every size. */
export function AgentConstellation() {
  return (
    <section id="one-workspace" className={styles.section} aria-labelledby="constellation-heading">
      <div className="wrap">
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Bring it all together</p>
          <h2 id="constellation-heading">Zana consolidates them into <span>one workspace.</span></h2>
          <p>One set of projects, controls and tools, regardless of the model.</p>
        </div>
        <figure className={styles.diagram} aria-label="Your agents and tools connect through Zana">
          <svg className={styles.connections} viewBox="0 0 1120 460" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {connections.map(connection => <line key={connection.id} data-connection={connection.id} x1="560" y1="220" x2={connection.x} y2={connection.y} />)}
          </svg>
          <div className={styles.hub}>
            <Image src="/zana-icon-512.png" width={166} height={166} sizes="(max-width: 760px) 132px, (max-width: 1000px) 150px, 166px" alt="" />
            <strong>Zana</strong>
          </div>
          <ul className={styles.nodes} aria-label="Agents and tools in one place">
            {nodes.map(node => <li key={node.id} data-node={node.id}>
              <Link className={styles.node} href={node.href}>
                <span className={styles.icons} aria-hidden="true">
                  {node.icons.map(icon => <span className={styles.icon} key={icon}><Image className={fullColorIcons.has(icon) ? undefined : styles.monochromeIcon} src={`/walkthrough/icons/${icon}`} width={23} height={23} alt="" /></span>)}
                </span>
                <span className={styles.label}><strong>{node.name}</strong><small>{node.detail}</small></span>
              </Link>
            </li>)}
          </ul>
          <figcaption className="sr-only">Choose an agent to explore setup, or discover plugins for your tools.</figcaption>
        </figure>
      </div>
    </section>
  );
}
