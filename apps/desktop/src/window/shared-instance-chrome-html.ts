import { randomUUID } from 'node:crypto';
import type { SharedInstance } from './shared-target.js';

export interface SharedChromeState {
  selected?: SharedInstance;
  unavailable: boolean;
  expanded: boolean;
  picking: boolean;
  busy: boolean;
  needsSignIn: boolean;
  instances: SharedInstance[];
  message: string;
}
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const icon = (name: 'cloud' | 'laptop' | 'globe' | 'power') => `<svg viewBox="0 0 24 24" aria-hidden="true">${{
  cloud: '<path d="M7 18a5 5 0 0 1-1-9.9 6 6 0 0 1 11.6-1A5.5 5.5 0 0 1 18 18Z"/>',
  laptop: '<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M2 20h20l-2-4H4z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  power: '<path d="M12 2v10M6 5a9 9 0 1 0 12 0"/>'
}[name]}</svg>`;
function action(command: string, label: string, help = '', glyph?: 'cloud' | 'laptop' | 'globe' | 'power', primary = false) {
  return `<a role="button" aria-label="${escape(label)}" class="action${primary ? ' primary' : ''}" href="zcc-instance://${command}">${glyph ? icon(glyph) : ''}<span>${escape(label)}${help ? `<small>${escape(help)}</small>` : ''}</span></a>`;
}

/** Only main-generated markup is loaded in the separate, preload-free chrome view. */
export function sharedChromeHtml(state: SharedChromeState): string {
  const nonce = randomUUID();
  const name = state.selected?.name ?? 'Another Zana';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
  <title>Zana switcher</title><style>
  :root{font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#344257;--bg:#fff;--line:#dfe5ed;--muted:#78869a;--hover:#f1f5fa;--blue:#2362b5;--tint:#eef5ff;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:transparent;padding:3px 8px 12px}svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}a{text-decoration:none;color:inherit;cursor:pointer}a:focus-visible{outline:2px solid #548ff0;outline-offset:-2px}.trigger{display:flex;align-items:center;gap:6px;width:fit-content;max-width:100%;margin-left:auto;height:25px;border:1px solid var(--line);border-radius:6px;padding:0 8px;background:var(--tint);color:var(--blue);font-size:11px}.trigger svg{width:14px;height:14px}.trigger span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trigger i{font-style:normal;font-size:10px;color:var(--muted)}.panel{margin-top:8px;padding:6px;background:var(--bg);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 25px #172a4526;max-height:calc(100vh - 51px);overflow:auto}.current{padding:12px;border-bottom:1px solid var(--line);margin-bottom:5px}.eyebrow{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:11px}.identity{display:flex;gap:10px;align-items:center}.identity>svg{color:var(--blue)}strong{font-weight:600}.identity span{min-width:0}.identity strong{display:block;overflow-wrap:anywhere}small{display:block;font-size:10px;line-height:1.6;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}.status{font-size:10px;color:${state.unavailable ? '#b28631' : '#4d9676'};margin-top:9px}.action{display:flex;gap:11px;align-items:center;border-radius:6px;padding:12px;font-size:12px}.action:hover{background:var(--hover)}.action.primary{background:var(--tint);color:var(--blue)}.rule{height:1px;background:var(--line);margin:6px 10px}.message{padding:8px 12px;color:var(--muted);font-size:11px;line-height:1.7}.list{padding:0;margin:0;list-style:none}.list li{border-bottom:1px solid var(--line)}.list a{overflow-wrap:anywhere}.offline{padding:12px;color:var(--muted)}.quit{color:var(--muted)}
  @media(prefers-color-scheme:dark){:root{color:#d7dee7;--bg:#20242b;--line:#363e49;--muted:#96a2b2;--hover:#2a323e;--blue:#91baff;--tint:#26354d}}
  </style></head><body>
  <a role="button" class="trigger" href="zcc-instance://toggle" aria-label="Zana switcher: ${escape(name)}" aria-expanded="${state.expanded}" aria-controls="panel">${icon('cloud')}<span>${escape(name)}</span><i aria-hidden="true">⌄</i></a>
  ${state.expanded ? `<section id="panel" class="panel" aria-label="Zana switcher">
  <div class="current"><div class="eyebrow">You’re using</div><div class="identity">${icon('cloud')}<span><strong>${escape(name)}</strong><small>${escape(state.selected?.url ?? 'Shared Zana')}</small></span></div><div class="status">${state.unavailable ? 'Unavailable' : 'Connected'}</div></div>
  ${action('local', 'Return to this computer', 'Your local projects and work are still here.', 'laptop', true)}
  ${state.picking ? `<div class="rule"></div><div class="message"><strong>Open another Zana</strong></div>
    ${state.busy ? '<p class="message" role="status">Checking your account. If signing in, finish in your browser…</p>' : ''}
    <ul class="list">${state.instances.map(row => `<li>${row.online && !state.busy ? action('select/' + encodeURIComponent(row.id), row.name, row.url, 'cloud') : `<div class="offline">${escape(row.name)}<small>${row.online ? 'Please wait' : 'Offline'}</small></div>`}</li>`).join('')}</ul>
    ${!state.busy && !state.needsSignIn && !state.message && !state.instances.length ? '<p class="message">No Zana instances found. Enable Remote access on the computer you want to open.</p>' : ''}
    ${!state.busy ? action(state.needsSignIn ? 'signin' : 'refresh', state.needsSignIn ? 'Sign in to browse Zanas' : 'Refresh instances', '', 'globe') : ''}
  ` : action('pick', 'Open another Zana…', 'Choose from your account.', 'globe')}
  ${state.message ? `<p class="message" role="alert">${escape(state.message)}</p>` : ''}
  ${state.unavailable ? action('retry', 'Retry this Zana') : ''}
  <div class="rule"></div><div class="quit">${action('quit', 'Quit Zana', 'Close the desktop app on this computer.', 'power')}</div>
  </section>` : ''}
  <script nonce="${nonce}">document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();location.href='zcc-instance://close'}else if(event.key===' '&&event.target.matches('a[role=button]')){event.preventDefault();event.target.click()}});document.addEventListener('click',event=>{if(!event.target.closest('a,.panel'))location.href='zcc-instance://close'});${state.expanded ? "document.querySelector('.primary')?.focus()" : ''}</script>
  </body></html>`;
}
