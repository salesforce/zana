'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCityCanvas } from '../../lib/agent-city/use-city';
import { buildingInterior, reconcileSeats, workerLocation } from '../../lib/agent-city/interior';
import { CITY_BUILDINGS, CITY_PROJECTS } from './agent-city-demo-data';
import '../../lib/agent-city/palette.css';
import './agent-city-demo.css';

export function AgentCityDemo() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState('');
  const [paused, setPaused] = useState(false);
  const [floor, setFloor] = useState<number | undefined>();
  const [focused, setFocused] = useState<string>();
  const project = CITY_PROJECTS.find((item) => item.id === selected);
  const building = CITY_BUILDINGS.find((item: { id: string }) => item.id === selected);
  const interior = useMemo(() => {
    const options = { floor, focusedKey: focused, page: 0 };
    return building ? buildingInterior(building, options) : undefined;
  }, [building, floor, focused]);
  useEffect(() => { if (selected) back.current?.focus({ preventScroll: true }); }, [selected]);

  function focusMember(key: string) {
    if (!project?.members.some((member) => member.key === key)) return;
    const seat = reconcileSeats(new Map(), building).get(key);
    setFloor(workerLocation(building, seat).floor);
    setFocused(key);
  }

  function select(key: string) {
    if (key.startsWith('city-floor:')) {
      const id = Number(key.slice(11));
      if (interior?.levels.some((level: { id: number }) => level.id === id)) setFloor(id);
      return;
    }
    if (CITY_PROJECTS.some((item) => item.id === key)) {
      setSelected(key); setFloor(undefined); setFocused(undefined);
    } else focusMember(key);
  }
  function leave() {
    setSelected(''); setFloor(undefined); setFocused(undefined);
    root.current?.querySelector<HTMLButtonElement>(`[data-project="${selected}"]`)?.focus({ preventScroll: true });
  }
  const { available, reduced } = useCityCanvas(root, canvas, CITY_BUILDINGS, selected, paused, select, interior, undefined, 'sf');
  const member = project?.members.find((item) => item.key === focused);

  return (
    <div ref={root} className="agent-city agent-city-demo" data-city-theme="sf" onKeyDown={(event) => {
      if (event.key === 'Escape' && selected) { event.preventDefault(); leave(); }
    }}>
      <div className="city-demo-heading">
        <div><strong>Agent City</strong><span>San Francisco</span></div>
        <button type="button" disabled={reduced || !available} onClick={() => setPaused(!paused)} aria-label={reduced ? 'Motion reduced' : paused ? 'Resume city motion' : 'Pause city motion'}>
          {reduced ? 'Motion reduced' : paused ? 'Play' : 'Pause'}
        </button>
      </div>
      <div className="city-demo-scene">
        <canvas ref={canvas} role="img" aria-label="Miniature San Francisco: Salesforce Tower, Victorian houses, Muni and Golden Gate Bridge. Choose a sample project below to explore inside." />
        {!available && <p className="city-demo-unavailable">The city illustration isn’t available in this browser. Explore the sample projects below.</p>}
        {project && <div className="city-demo-inside">
          <button ref={back} type="button" onClick={leave}>← Back to city</button>
          <span>{project.name}</span>
        </div>}
        {interior && available && <label className="city-demo-floor">Explore floor
          <select value={interior.floor.id} onChange={(event) => { setFloor(Number(event.target.value)); setFocused(undefined); }}>
            {interior.levels.map((level: { id: number; label: string; needs: number }) => <option key={level.id} value={level.id}>{level.label}{level.needs ? ' · Needs you' : ''}</option>)}
          </select>
        </label>}
      </div>
      <div className="city-demo-projects" role="group" aria-label="Explore sample projects">
        {CITY_PROJECTS.map((item) => <button type="button" key={item.id} data-project={item.id} aria-pressed={selected === item.id} onClick={() => select(item.id)}>
          <span className={item.needs ? 'city-demo-dot attention' : 'city-demo-dot'} aria-hidden="true" />{item.name}<span>{item.count}</span>
        </button>)}
      </div>
      <div className="city-demo-detail">
        {project ? <>
          <p><strong>{project.name}</strong><span>{project.count} sample {project.count === 1 ? 'agent' : 'agents'} · {project.working} working{project.needs ? ' · 1 needs you' : ''}</span></p>
          <ul aria-label={`${project.name} sample agents`}>
            {project.members.map((item) => <li key={item.key}><button type="button" aria-pressed={focused === item.key} onClick={() => focusMember(item.key)}>
              <span>{item.title}</span><small>{item.harness} · {item.status === 'needs-you' ? 'Needs you' : item.status === 'working' ? 'Working' : 'Idle'}</small>
            </button></li>)}
          </ul>
          {member && <p className="city-demo-agent" role="status">{member.status === 'needs-you' ? 'This sample agent is waiting for your reply. In Zana, open its conversation to answer.' : `${member.harness} · ${member.title} · ${member.status === 'working' ? 'Working' : 'Idle'}`}</p>}
        </> : <p>Every building is a project. <span>Choose one to explore inside.</span></p>}
      </div>
      <p className="city-demo-caption">Interactive demo · Sample data · Agent City plugin</p>
    </div>
  );
}
