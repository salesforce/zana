import Image from 'next/image';
import Link from 'next/link';
import styles from './AgentArchitecture.module.css';

const CAPABILITIES = [
  {
    icon: 'platform', eyebrow: 'Platform', title: 'Built in', href: '/features/',
    description: 'What every agent gets on day one.', style: '',
    items: ['Agents board', 'Threads & review', 'Squads', 'Inbox & Scheduler', 'Memory & library', 'Remote machines', 'Permission modes']
  },
  {
    icon: 'plugin-sdk', eyebrow: 'Extend', title: 'Plugin SDK', href: '/extensions/sdk/',
    description: 'Teams add what the business needs.', style: styles.extend,
    items: ['UI panels & pages', 'CLI commands', 'Skills & MCP tools', 'Settings & storage', 'Hooks & permissions', 'New AI vendors']
  },
  {
    icon: 'marketplace', eyebrow: 'Share', title: 'Marketplace', href: '/marketplace/',
    description: 'Built once, available to everyone.', style: styles.share,
    items: ['Public catalogue', 'Internal Salesforce marketplace', 'Curated plugin packs', 'Reviewed installs & consent', 'Per-plugin updates']
  }
];

const AGENTS = [
  { name: 'Claude Code', icon: 'claude-code', monochrome: false },
  { name: 'Codex', icon: 'codex', monochrome: true },
  { name: 'Cursor', icon: 'cursor', monochrome: true },
  { name: 'OpenCode', icon: 'opencode', monochrome: true },
  { name: 'Grok', icon: 'grok', monochrome: true },
  { name: 'Pi', icon: 'pi', monochrome: true },
  { name: 'Agentforce Code', icon: 'agentforce-code', monochrome: false },
  { name: 'Any ACP agent', icon: 'acp', monochrome: false }
];

export function AgentArchitecture() {
  return (
    <section className={styles.section} id="agent-architecture" aria-labelledby="agent-architecture-heading">
      <div className={styles.content}>
        <header className={styles.heading}>
          <p className={styles.kicker}>Architecture</p>
          <h2 id="agent-architecture-heading">A layer <span className={styles.gradient}>above every agent</span>.</h2>
        </header>

        <div className={styles.frame}>
          <div className={styles.badge}>ZANA</div>
          <div className={styles.cards}>
            {CAPABILITIES.map(capability => (
              <article key={capability.icon} className={`${styles.card} ${capability.style}`}>
                <div className={styles.cardHeader}>
                  <span className={styles.icon} aria-hidden="true"><Image src={`/architecture/${capability.icon}.svg`} alt="" width={23} height={23} /></span>
                  <div>
                    <span className={styles.eyebrow}>{capability.eyebrow}</span>
                    <h3><Link href={capability.href}>{capability.title}</Link></h3>
                  </div>
                </div>
                <p className={styles.description}>{capability.description}</p>
                <ul>{capability.items.map(item => <li key={item}>{item}</li>)}</ul>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.rail} aria-hidden="true"><span>Runs on top of</span></div>

        <div className={styles.agents}>
          <p className={styles.agentsLabel}><span className={styles.eyebrow}>Harnesses</span><strong>The agents your teams already use</strong></p>
          <ul className={styles.agentList} aria-label="Agents supported by the Zana platform">
            {AGENTS.map(agent => (
              <li key={agent.icon} className={`${styles.agent} ${agent.icon === 'acp' ? styles.any : ''}`}>
                <span className={styles.agentIcon} aria-hidden="true"><Image className={agent.monochrome ? styles.monochrome : undefined} src={`/architecture/${agent.icon}.svg`} alt="" width={26} height={26} /></span>
                <span className={styles.agentName}>{agent.name}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className={styles.note}>Every capability above applies to <strong>every agent</strong> below. Switching vendors keeps everything.</p>
        <p className={styles.more}>
          <Link href="/docs/architecture/">Explore the architecture <span aria-hidden="true">→</span></Link>
          <Link href="/media-press/">See the full presentation <span aria-hidden="true">→</span></Link>
        </p>
      </div>
    </section>
  );
}
