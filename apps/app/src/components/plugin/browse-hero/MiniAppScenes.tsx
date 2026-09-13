import type { BrowseHeroArchetype } from './browse-hero-archetypes.js';

function accentTint(token: string, percent: number): string {
  return `color-mix(in srgb, var(${token}) ${percent}%, var(--bg-elevated))`;
}

function MiniBar({ width }: { width: string }) {
  return <span className="ext-browse-scene-bar" style={{ width }} />;
}

function KanbanScene({ accent }: { accent: string }) {
  const columns = [
    { label: 'Todo', cards: 3 },
    { label: 'Doing', cards: 2, active: true },
    { label: 'Review', cards: 2 }
  ];
  return (
    <div className="ext-browse-scene-kanban">
      {columns.map((column) => (
        <div key={column.label} className="ext-browse-scene-col">
          <span className="ext-browse-scene-label">{column.label}</span>
          {Array.from({ length: column.cards }, (_, index) => (
            <div
              key={index}
              className={`ext-browse-scene-card${column.active && index === 0 ? ' is-active' : ''}`}
              style={
                column.active && index === 0
                  ? { background: accentTint(accent, 14), borderColor: accentTint(accent, 40) }
                  : undefined
              }
            >
              <MiniBar width={index % 2 === 0 ? '82%' : '64%'} />
              <MiniBar width="38%" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DashboardScene({ accent }: { accent: string }) {
  const bars = [42, 61, 38, 78, 55, 88, 70];
  return (
    <div className="ext-browse-scene-dashboard">
      <div className="ext-browse-scene-stats">
        {['Deploys', 'PRs', 'CI'].map((label, index) => (
          <div
            key={label}
            className="ext-browse-scene-card"
            style={
              index === 2
                ? { background: accentTint(accent, 14), borderColor: accentTint(accent, 40) }
                : undefined
            }
          >
            <span className="ext-browse-scene-label">{label}</span>
            <strong>{index === 0 ? '18' : index === 1 ? '7' : '96%'}</strong>
          </div>
        ))}
      </div>
      <div className="ext-browse-scene-card ext-browse-scene-chart">
        {bars.map((height, index) => (
          <span
            key={index}
            className="ext-browse-scene-chart-bar"
            style={{
              height: `${height}%`,
              background: index === bars.length - 2 ? `var(${accent})` : accentTint(accent, 32)
            }}
          />
        ))}
      </div>
    </div>
  );
}

function InboxScene({ accent }: { accent: string }) {
  return (
    <div className="ext-browse-scene-inbox">
      {['Needs you', 'Draft reply', 'Fix thread'].map((label, index) => (
        <div
          key={label}
          className="ext-browse-scene-card ext-browse-scene-inbox-row"
          style={
            index === 0
              ? { background: accentTint(accent, 14), borderColor: accentTint(accent, 40) }
              : undefined
          }
        >
          <span className="ext-browse-scene-dot" style={{ background: `var(${accent})` }} />
          <div>
            <span className="ext-browse-scene-label">{label}</span>
            <MiniBar width={index === 0 ? '70%' : '52%'} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PanelScene({ accent }: { accent: string }) {
  return (
    <div className="ext-browse-scene-panel">
      <div className="ext-browse-scene-rail" aria-hidden="true">
        <span style={{ background: `var(${accent})` }} />
        <span />
        <span />
      </div>
      <div className="ext-browse-scene-panel-body">
        <MiniBar width="46%" />
        <div className="ext-browse-scene-card">
          <MiniBar width="72%" />
          <MiniBar width="54%" />
        </div>
        <div className="ext-browse-scene-card">
          <MiniBar width="64%" />
          <MiniBar width="40%" />
        </div>
      </div>
    </div>
  );
}

export function MiniAppScene({ archetype }: { archetype: BrowseHeroArchetype }) {
  if (archetype.scene === 'kanban') return <KanbanScene accent={archetype.accent} />;
  if (archetype.scene === 'dashboard') return <DashboardScene accent={archetype.accent} />;
  if (archetype.scene === 'inbox') return <InboxScene accent={archetype.accent} />;
  return <PanelScene accent={archetype.accent} />;
}
