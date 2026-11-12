// The Zana video intro: plugin tiles orbit the Zana mark, plug in and snap into it,
// the wordmark and a tagline rise, then the camera zooms through into the video.
// The first frame already shows the full mark in the middle, so players and
// thumbnails that show frame 0 never show an empty background.
//
//   const intro = ZanaIntro.mount(stageElement, { theme: 'light', tagline: 'Built from plugins.', accent: 'Including yours.' });
//   intro.render(t);   // deterministic: t in seconds, 0 … ZanaIntro.DURATION
//
// The stage can be any size; everything is laid out from its width and height.
// Used by intro.html (standalone, prepended to any video) and plugin-power.html.
(function () {
  const DURATION = 3.5;
  const POSTER_AT = 2.8; // the full lockup: mark, wordmark and tagline
  const ICONS = {
    check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    file: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>',
    branch: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 16V4M18 8c0 5-7 4-11 9"/>',
    flow: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a4 4 0 014 4v5.5"/>',
    library: '<path d="M5 4v16M9 4v16M13 6l5 14"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 14h.01M15 14h.01M2 14h2M20 14h2"/>',
    siren: '<path d="M7 18v-6a5 5 0 0110 0v6M5 21h14M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>'
  };
  const TILES = ['check', 'file', 'branch', 'flow', 'library', 'globe', 'robot', 'siren'];
  const CSS = `
  .zi { position:absolute; inset:0; z-index:60; overflow:hidden; pointer-events:none; font-family:Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background:radial-gradient(ellipse 70% 60% at 50% 42%, #18284a 0%, #0d1424 55%, #080b12 100%); }
  .zi .zi-glw { position:absolute; width:520px; height:520px; border-radius:50%; filter:blur(80px); opacity:.45; left:0; top:0; }
  .zi .zi-grid { position:absolute; inset:-60px; background-image:linear-gradient(rgba(120,170,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(120,170,255,.06) 1px, transparent 1px); background-size:34px 34px; }
  .zi .zi-c { position:absolute; inset:0; }
  .zi .zi-tile { position:absolute; left:0; top:0; width:46px; height:46px; margin:-23px 0 0 -23px; border-radius:12px; display:grid; place-items:center;
    background:linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.03)); border:1px solid rgba(140,185,255,.35); color:#a9cbff;
    box-shadow:0 10px 26px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.08); }
  .zi .zi-tile svg { width:21px; height:21px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
  .zi .zi-tile.hot { color:#fff; background:linear-gradient(135deg,#ff7a59,#d63c6b); border-color:rgba(255,160,140,.6); }
  .zi svg.zi-links { position:absolute; left:0; top:0; overflow:visible; }
  .zi svg.zi-links line { stroke:rgba(120,170,255,.5); stroke-width:1.4; stroke-dasharray:3 5; }
  .zi .zi-ring { position:absolute; left:0; top:0; width:300px; height:300px; margin:-150px 0 0 -150px; border-radius:50%; border:1.5px solid rgba(120,170,255,.22); }
  .zi .zi-pulse { position:absolute; left:0; top:0; width:120px; height:120px; margin:-60px 0 0 -60px; border-radius:50%; border:2px solid rgba(140,190,255,.8); opacity:0; }
  .zi .zi-halo { position:absolute; left:0; top:0; width:260px; height:260px; margin:-130px 0 0 -130px; border-radius:50%; background:radial-gradient(circle, rgba(110,160,255,.35), rgba(110,160,255,0) 65%); }
  .zi svg.zi-logo { position:absolute; left:0; top:0; width:118px; height:118px; margin:-59px 0 0 -59px; overflow:visible; filter:drop-shadow(0 16px 36px rgba(60,120,255,.45)); }
  .zi .zi-spark { position:absolute; left:0; top:0; width:90px; height:90px; margin:-45px 0 0 -45px; border-radius:50%; background:radial-gradient(circle, rgba(255,230,170,.95), rgba(255,219,158,0) 62%); opacity:0; }
  .zi .zi-word { position:absolute; left:0; right:0; text-align:center; font-size:66px; font-weight:800; letter-spacing:-.045em; color:#f3f7ff; line-height:1; }
  .zi .zi-word span { display:inline-block; }
  .zi .zi-tag { position:absolute; left:40px; right:40px; text-align:center; font-size:20px; font-weight:600; letter-spacing:-.01em; color:#9fc2ff; line-height:1.3; }
  .zi .zi-tag b { background:linear-gradient(120deg,#7cc4ff,#b49cff); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .zi.light { background:radial-gradient(ellipse 70% 60% at 50% 42%, #ffffff 0%, #eef3fb 55%, #e3e9f4 100%); }
  .zi.light .zi-grid { background-image:linear-gradient(rgba(9,105,218,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(9,105,218,.06) 1px, transparent 1px); }
  .zi.light .zi-tile { background:#fff; border-color:rgba(9,105,218,.25); color:#0969da; box-shadow:0 10px 24px rgba(30,41,80,.14); }
  .zi.light .zi-tile.hot { color:#fff; background:linear-gradient(135deg,#ff7a59,#d63c6b); border-color:transparent; }
  .zi.light svg.zi-links line { stroke:rgba(9,105,218,.35); }
  .zi.light .zi-ring { border-color:rgba(9,105,218,.16); } .zi.light .zi-pulse { border-color:rgba(9,105,218,.6); }
  .zi.light .zi-halo { background:radial-gradient(circle, rgba(37,99,235,.18), rgba(37,99,235,0) 65%); }
  .zi.light svg.zi-logo { filter:drop-shadow(0 16px 34px rgba(30,41,80,.30)); }
  .zi.light .zi-word { color:#111827; } .zi.light .zi-tag { color:#57606a; }
  .zi.light .zi-tag b { background:linear-gradient(120deg,#2563eb,#8b5cf6); -webkit-background-clip:text; background-clip:text; color:transparent; }`;
  const LOGO = `
    <defs><linearGradient id="zi-w" x1="11" y1="12" x2="52" y2="51" gradientUnits="userSpaceOnUse"><stop stop-color="#bcefff"/><stop offset=".5" stop-color="#79bbfa"/><stop offset="1" stop-color="#aea0ee"/></linearGradient></defs>
    <rect width="64" height="64" rx="15" fill="#172641"/>
    <g data-k="wl" style="transform-origin:32px 36px"><path d="M27 34C17 33 8 25 8 11C19 13 26 21 27 34ZM27 37C18 33 10 37 10 48C18 49 24 45 27 37Z" fill="url(#zi-w)"/></g>
    <g data-k="wr" style="transform-origin:32px 36px"><path d="M37 34C47 33 54 25 54 11C44 15 38 23 37 34ZM37 37C46 33 54 37 54 48C46 49 40 45 37 37Z" fill="url(#zi-w)"/></g>
    <circle cx="32" cy="18" r="4" fill="#f0f7ff"/><path d="M32 25C35 30 35 34 36 38C37 44 40 48 43 51C36 55 28 55 21 51C24 47 27 43 28 38C29 34 29 30 32 25Z" fill="#f0f7ff"/>
    <path d="M34 29Q40 35 45 28L51 18" stroke="#f0f7ff" stroke-width="2.3" stroke-linecap="round"/>
    <path data-k="star" d="M55 3C56 8 58 10 62 11C58 12 56 14 55 19C54 14 52 12 48 11C52 10 54 8 55 3Z" fill="#ffdb9e" style="transform-origin:55px 11px"/>`;

  const cl = (v) => Math.max(0, Math.min(1, v));
  const pr = (t, a, b) => cl((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const eOut = (v) => 1 - Math.pow(1 - cl(v), 3);
  const eBack = (v) => { v = cl(v); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2); };
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function mount(stage, opts = {}) {
    if (!document.getElementById('zi-style')) {
      const st = document.createElement('style'); st.id = 'zi-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    const W = stage.clientWidth, H = stage.clientHeight, CX = W / 2, CY = H * 0.397, R = 150;
    const root = document.createElement('div');
    root.className = 'zi' + (opts.theme === 'light' ? ' light' : '');
    const tag = [opts.tagline ? esc(opts.tagline) : '', opts.accent ? `<b>${esc(opts.accent)}</b>` : ''].filter(Boolean).join(' ');
    root.innerHTML = `
      <div class="zi-glw" style="background:#3b6fff"></div><div class="zi-glw" style="background:#8b5cf6"></div>
      <div class="zi-grid"></div>
      <div class="zi-c">
        <div class="zi-ring"></div><div class="zi-halo"></div>
        <svg class="zi-links" width="${W}" height="${H}"></svg>
        ${TILES.map((ic) => `<div class="zi-tile${ic === 'siren' ? ' hot' : ''}"><svg viewBox="0 0 24 24">${ICONS[ic]}</svg></div>`).join('')}
        <div class="zi-pulse"></div>
        <svg class="zi-logo" viewBox="0 0 64 64" fill="none">${LOGO}</svg>
        <div class="zi-spark"></div>
        <div class="zi-word" style="top:${CY + 80}px"><span>Z</span><span>a</span><span>n</span><span>a</span></div>
        <div class="zi-tag" style="top:${CY + 164}px">${tag}</div>
      </div>`;
    stage.appendChild(root);
    const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
    const [g1, g2] = qa('.zi-glw'), grid = q('.zi-grid'), content = q('.zi-c');
    const tiles = qa('.zi-tile'), links = q('.zi-links'), ring = q('.zi-ring'), halo = q('.zi-halo'), pulse = q('.zi-pulse');
    const logo = q('.zi-logo'), wl = q('[data-k=wl]'), wr = q('[data-k=wr]'), star = q('[data-k=star]'), spark = q('.zi-spark');
    const letters = qa('.zi-word span'), tagEl = q('.zi-tag');
    const lines = TILES.map(() => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); links.appendChild(l); return l; });
    const at = (el, x, y, extra = '') => { el.style.transform = `translate(${x}px, ${y}px) ${extra}`; };
    content.style.transformOrigin = `${CX}px ${CY + 40}px`;

    function render(t) {
      if (t >= DURATION) { root.style.display = 'none'; return; }
      root.style.display = '';
      at(g1, W * 0.04 + Math.sin(t * 0.9) * 60, -H * 0.25 + Math.cos(t * 0.7) * 40);
      at(g2, W * 0.55 + Math.cos(t * 0.8) * 70, H * 0.32 + Math.sin(t) * 40);
      grid.style.transform = `translate(${(t * 10) % 34}px, ${(t * 6) % 34}px)`;
      // zoom through into the video
      const exit = eOut(pr(t, 2.95, DURATION));
      root.style.opacity = 1 - pr(t, 3.1, DURATION);
      content.style.transform = `scale(${lerp(1, 1.9, exit)})`;
      content.style.opacity = 1 - pr(t, 3.0, 3.4);
      // tiles fly in, orbit, plug into the mark, then snap into it
      const spin = t * 22 - eOut(pr(t, 0, 1.3)) * 90;
      tiles.forEach((d, i) => {
        const a0 = 0.05 + i * 0.09, k = eOut(pr(t, a0, a0 + 0.75));
        const ang = (i / TILES.length) * Math.PI * 2 - Math.PI / 2 + spin * Math.PI / 180;
        const sn = pr(t, 1.45 + i * 0.035, 1.8 + i * 0.035), snk = sn * sn * sn;
        const r = lerp(lerp(620, R, k), 18, snk);
        const x = CX + Math.cos(ang) * r, y = CY + Math.sin(ang) * r;
        d.style.opacity = pr(t, a0, a0 + 0.2) * (1 - pr(t, 1.7 + i * 0.035, 1.82 + i * 0.035));
        at(d, x, y, `rotate(${lerp(i % 2 ? 160 : -160, 0, k)}deg) scale(${lerp(0.6, 1, eBack(pr(t, a0 + 0.3, a0 + 0.8))) * lerp(1, 0.35, snk)})`);
        const lk = pr(t, 1.05 + i * 0.04, 1.3 + i * 0.04), ln = lines[i];
        const x1 = x - Math.cos(ang) * 24, y1 = y - Math.sin(ang) * 24;
        ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
        ln.setAttribute('x2', lerp(x1, CX + Math.cos(ang) * 66, lk)); ln.setAttribute('y2', lerp(y1, CY + Math.sin(ang) * 66, lk));
        ln.style.opacity = lk ? 0.9 * (1 - sn) : 0; ln.style.strokeDashoffset = -t * 20;
      });
      at(ring, CX, CY, `scale(${lerp(0.6, 1, eOut(pr(t, 0.5, 1.2)))}) rotate(${t * 15}deg)`);
      ring.style.opacity = pr(t, 0.5, 1.1) * 0.9 * (1 - pr(t, 1.5, 1.85));
      // the mark is there from frame 0: it breathes, flaps its wings as the plugins land, and its star sparkles
      const bump = Math.sin(Math.PI * pr(t, 1.8, 2.05)) * 0.08;
      at(logo, CX, CY, `translateY(${Math.sin(t * 2.2) * 3 * (1 - pr(t, 1.6, 1.9))}px) scale(${1 + bump})`);
      at(halo, CX, CY, `scale(${1 + 0.06 * Math.sin(t * 3) + bump * 3})`);
      const flap = Math.sin(Math.PI * pr(t, 1.75, 2.1));
      wl.style.transform = `rotate(${flap * 10}deg) scale(${1 - flap * 0.1})`;
      wr.style.transform = `rotate(${-flap * 10}deg) scale(${1 - flap * 0.1})`;
      const tw = Math.sin(Math.PI * pr(t, 1.6, 2.1));
      star.style.transform = `scale(${1 + tw * 0.45}) rotate(${tw * 45}deg)`;
      const sx = CX + (55 / 64 - 0.5) * 118, sy = CY + (11 / 64 - 0.5) * 118, sp = pr(t, 1.6, 2.05);
      at(spark, sx, sy, `scale(${lerp(0.2, 1.6, eOut(sp))})`); spark.style.opacity = sp ? 1 - sp : 0;
      const pu = pr(t, 1.82, 2.4);
      at(pulse, CX, CY, `scale(${lerp(1, 3.4, eOut(pu))})`); pulse.style.opacity = pu ? (1 - pu) * 0.9 : 0;
      // wordmark + tagline
      letters.forEach((c, i) => { const k = eOut(pr(t, 1.9 + i * 0.06, 2.3 + i * 0.06)); c.style.opacity = k; c.style.transform = `translateY(${(1 - k) * 30}px)`; });
      const tg = eOut(pr(t, 2.3, 2.7)); tagEl.style.opacity = tg; tagEl.style.transform = `translateY(${(1 - tg) * 12}px)`;
    }
    render(0);
    return { render, root };
  }

  window.ZanaIntro = { DURATION, POSTER_AT, mount };
})();
