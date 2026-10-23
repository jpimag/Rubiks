// Interface : rendu 3D tactile, lecteur de solution, peinture et lecture des couleurs sur photo.
(function () {
  'use strict';
  const C = window.RubikCore;
  const N = 15;
  const STORE_KEY = 'parite15.v1';
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const FACE_NAME = { U: 'du haut', D: 'du bas', F: 'avant', B: 'arrière', R: 'de droite', L: 'de gauche' };
  const FACE_SHORT = { U: 'haut', D: 'bas', F: 'avant', B: 'arrière', R: 'droite', L: 'gauche' };
  const FROM = { U: 'depuis le haut', D: 'depuis le bas', F: "depuis l'avant", B: "depuis l'arrière", R: 'depuis la droite', L: 'depuis la gauche' };
  const SEEN = { U: 'vu du haut', D: 'vu du bas', F: 'vu de face', B: "vu de l'arrière", R: 'vu de droite', L: 'vu de gauche' };

  // ---------- État ----------
  let cube = null;
  let source = 'exemple';
  let paletteMap = [0, 1, 2, 3, 4, 5]; // indice de couleur -> couleur standard affichée
  let solution = null;
  let idx = 0;
  let playing = false;
  let anim = null;
  let highlight = new Set();
  let paintMode = false;
  let paintColor = 0;

  // ---------- Matrices 3x3 (ligne par ligne) ----------
  const mul = (a, b) => {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
    return o;
  };
  const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const homeView = () => mul(rotX(0.48), rotY(-0.62));
  let view = homeView();
  let zoom = 1, panX = 0, panY = 0;

  // ---------- Couleurs du thème ----------
  let bodyRGB = [20, 22, 28], markColor = '#ff2bd6';
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    markColor = cs.getPropertyValue('--mark').trim() || markColor;
    const b = cs.getPropertyValue('--body').trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(b);
    if (m) bodyRGB = [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16));
    requestDraw();
  }
  const shadeCss = (rgb, s) => `rgb(${Math.round(rgb[0] * s)},${Math.round(rgb[1] * s)},${Math.round(rgb[2] * s)})`;
  const DISPLAY_RGB = [[240, 240, 236], [206, 32, 44], [18, 165, 82], [250, 212, 26], [250, 124, 18], [24, 88, 210]];

  // ---------- Rendu 3D ----------
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  let W = 1, H = 1, DPR = 1;
  const CAM = N * 3.4;
  let hits = [];

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const cw = Math.round(w * DPR), ch = Math.round(h * DPR);
    W = w; H = h;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    requestDraw();
  }

  // Matrice de rotation d'angle a autour de l'axe k (même sens que le moteur).
  function axisRot(k, a) {
    const c = Math.cos(a), s = Math.sin(a);
    if (k === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
    if (k === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  }

  // Octogone (carré chanfreiné) d'un sticker dans son plan.
  const H1 = 0.44, H2 = 0.32;
  const OCT = [H2, H1, H1, H2, H1, -H2, H2, -H1, -H2, -H1, -H1, -H2, -H1, H2, -H2, H1];
  const LIGHT = (() => { const l = [-0.35, 0.55, 1]; const n = Math.hypot(...l); return l.map((v) => v / n); })();
  const SP = new Float64Array(16);
  const buckets = [[], [], [], [], [], []];

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!cube) return;
    const f = (zoom * Math.min(W, H) * 0.43 * CAM) / (0.87 * N);
    const cx = W / 2 + panX, cy = H / 2 + panY;
    const half = N / 2;
    const V = view;
    const cam = [V[6] * CAM, V[7] * CAM, V[8] * CAM];
    const ax = anim ? anim.axis : 1;

    // Tranches : blocs de couches consécutives qui tournent (ou non) ensemble.
    const runs = [];
    if (anim) {
      let a = 0;
      for (let l = 1; l <= N; l++) {
        if (l === N || anim.layerSet[l] !== anim.layerSet[a]) { runs.push({ a, b: l - 1, moving: !!anim.layerSet[a] }); a = l; }
      }
    } else runs.push({ a: 0, b: N - 1, moving: false });
    runs.forEach((r) => {
      r.lo = -half + r.a; r.hi = -half + r.b + 1;
      const c = cam[ax];
      r.dist = c < r.lo ? r.lo - c : c > r.hi ? c - r.hi : 0;
    });
    runs.sort((p, q) => q.dist - p.dist); // la plus éloignée d'abord

    // Stickers rangés par direction de normale.
    const pos = cube.pos, nrm = cube.nrm, col = cube.col;
    for (const b of buckets) b.length = 0;
    for (let i = 0; i < cube.count; i++) {
      const k = nrm[3 * i] ? 0 : nrm[3 * i + 1] ? 1 : 2;
      buckets[k * 2 + (nrm[3 * i + k] > 0 ? 0 : 1)].push(i);
    }

    const keepHits = paintMode;
    hits = [];
    const markWidth = Math.max(1.5, Math.min(3.5, (f / CAM) * 0.12));

    for (const run of runs) {
      // M = vue x rotation de la tranche : tout point du cube passe par M.
      const M = run.moving ? mul(V, axisRot(ax, anim.angle)) : V;
      const M0 = M[0], M1 = M[1], M2 = M[2], M3 = M[3], M4 = M[4], M5 = M[5], M6 = M[6], M7 = M[7], M8 = M[8];
      const lo = [-half, -half, -half], hi = [half, half, half];
      lo[ax] = run.lo; hi[ax] = run.hi;

      for (let dir = 0; dir < 6; dir++) {
        const k = dir >> 1, s = dir & 1 ? -1 : 1;
        const o1 = (k + 1) % 3, o2 = (k + 2) % 3;
        const plane = s > 0 ? hi[k] : lo[k];
        // Normale et centre de la face du bloc, en coordonnées de vue.
        const nx = M[k] * s, ny = M[3 + k] * s, nz = M[6 + k] * s;
        const c = [0, 0, 0];
        c[k] = plane; c[o1] = (lo[o1] + hi[o1]) / 2; c[o2] = (lo[o2] + hi[o2]) / 2;
        const pz = M6 * c[0] + M7 * c[1] + M8 * c[2];
        const px = M0 * c[0] + M1 * c[1] + M2 * c[2];
        const py = M3 * c[0] + M4 * c[1] + M5 * c[2];
        if (nx * px + ny * py + nz * (pz - CAM) >= 0) continue;
        const light = 0.6 + 0.4 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);

        // Colonnes de M pour les deux directions du plan.
        const ux = M[o1], uy = M[3 + o1], uz = M[6 + o1];
        const vx = M[o2], vy = M[3 + o2], vz = M[6 + o2];

        // Fond noir de la face du bloc.
        const du = [lo[o1] - c[o1], hi[o1] - c[o1]], dv = [lo[o2] - c[o2], hi[o2] - c[o2]];
        ctx.fillStyle = shadeCss(bodyRGB, light);
        ctx.beginPath();
        [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([a, b], j) => {
          const X = px + du[a] * ux + dv[b] * vx, Y = py + du[a] * uy + dv[b] * vy, Z = pz + du[a] * uz + dv[b] * vz;
          const d = CAM - Z, sx = cx + (f * X) / d, sy = cy - (f * Y) / d;
          if (j) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        });
        ctx.closePath(); ctx.fill();

        // Face interne (coupe) : pas de stickers.
        if (k === ax && (s > 0 ? run.b < N - 1 : run.a > 0)) continue;

        const fills = [];
        for (const i of buckets[dir]) {
          const layer = (pos[3 * i + ax] - nrm[3 * i + ax] + N - 1) / 2;
          if (layer < run.a || layer > run.b) continue;
          const x0 = pos[3 * i] / 2, y0 = pos[3 * i + 1] / 2, z0 = pos[3 * i + 2] / 2;
          const qx = M0 * x0 + M1 * y0 + M2 * z0, qy = M3 * x0 + M4 * y0 + M5 * z0, qz = M6 * x0 + M7 * y0 + M8 * z0;
          for (let j = 0; j < 16; j += 2) {
            const a = OCT[j], b = OCT[j + 1];
            const d = CAM - (qz + a * uz + b * vz);
            SP[j] = cx + (f * (qx + a * ux + b * vx)) / d;
            SP[j + 1] = cy - (f * (qy + a * uy + b * vy)) / d;
          }
          const ci = col[i];
          ctx.fillStyle = fills[ci] || (fills[ci] = shadeCss(DISPLAY_RGB[paletteMap[ci]], light));
          ctx.beginPath();
          ctx.moveTo(SP[0], SP[1]);
          for (let j = 2; j < 16; j += 2) ctx.lineTo(SP[j], SP[j + 1]);
          ctx.closePath(); ctx.fill();
          if (highlight.has(i)) { ctx.strokeStyle = markColor; ctx.lineWidth = markWidth; ctx.stroke(); }
          if (keepHits) hits.push({ i, sp: Float64Array.from(SP) });
        }
      }
    }
  }

  function pick(x, y) {
    for (let h = hits.length - 1; h >= 0; h--) {
      const sp = hits[h].sp;
      let inside = false;
      for (let a = 0, b = sp.length - 2; a < sp.length; b = a, a += 2) {
        const xa = sp[a], ya = sp[a + 1], xb = sp[b], yb = sp[b + 1];
        if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
      }
      if (inside) return hits[h].i;
    }
    return -1;
  }

  let frameQueued = false;
  function requestDraw() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(frame);
  }
  function frame(now) {
    frameQueued = false;
    if (anim) {
      if (anim.t0 == null) anim.t0 = now;
      const t = anim.dur > 0 ? Math.min(1, (now - anim.t0) / anim.dur) : 1;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      anim.angle = (anim.q * Math.PI * e) / 2;
      if (t >= 1) {
        const done = anim.done;
        anim = null;
        done();
      } else requestDraw();
    }
    draw();
  }

  // ---------- Animation des mouvements ----------
  const speedEl = $('speed');
  const quarterMs = () => 900 * Math.pow(130 / 900, speedEl.value / 100);

  function animateMove(m, onDone) {
    const g = cube.moveGeometry(m);
    const q = g.q === 3 ? -1 : g.q;
    const layerSet = new Uint8Array(N);
    g.layers.forEach((l) => { layerSet[l] = 1; });
    const dur = reduceMotion ? 0 : quarterMs() * (Math.abs(q) === 2 ? 1.5 : 1);
    anim = {
      axis: g.axis, layerSet, q, angle: 0, t0: null, dur,
      done: () => { cube.applyMove(m); if (onDone) onDone(); },
    };
    requestDraw();
  }

  // ---------- Lecteur ----------
  const steps = () => (solution ? solution.steps : []);

  function describe(m) {
    const d = m.depths;
    let what;
    if (d.length === 1) what = d[0] === 1 ? `Face ${FACE_NAME[m.face]}` : `Tranche ${d[0]} ${FROM[m.face]}, seule`;
    else what = `Tranches ${d.join(', ')} ${FROM[m.face]}`;
    const turn = m.turns === 2 ? 'demi-tour' : m.turns === 1 ? '¼ de tour horaire' : '¼ de tour anti-horaire';
    return { what, turn: turn + (m.turns === 2 ? '' : ' ' + SEEN[m.face]) };
  }

  function updatePlayer() {
    const st = steps();
    const total = st.length;
    const cur = anim && anim.forwardIndex != null ? anim.forwardIndex : idx;
    $('nowCount').textContent = `${idx} / ${total}`;
    $('progressFill').style.width = total ? `${(100 * idx) / total}%` : '0';
    if (!total) {
      $('nowMove').textContent = '–';
      $('nowDesc').textContent = solution && !solution.issues.length ? 'Rien à faire' : 'Aucun mouvement';
      $('nowNote').textContent = '';
    } else if (cur >= total) {
      $('nowMove').textContent = '✓';
      $('nowDesc').textContent = 'Parité résolue';
      $('nowNote').textContent = 'Toutes les ailes retournées sont remises en place.';
    } else {
      const s = st[cur];
      $('nowMove').textContent = C.moveToString(s.move);
      const d = describe(s.move);
      $('nowDesc').textContent = d.what;
      $('nowNote').textContent = `${d.turn} · ${s.note}`;
    }
    $('btnPlay').textContent = playing ? '⏸' : '▶';
    $('btnPlay').setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
    $('btnFirst').disabled = $('btnPrev').disabled = idx === 0;
    $('btnNext').disabled = $('btnLast').disabled = idx >= total;
    $('btnPlay').disabled = !total;

    const strip = $('moveStrip');
    strip.querySelectorAll('.mv').forEach((el) => {
      const k = +el.dataset.k;
      el.dataset.done = String(k < idx);
      el.dataset.current = String(k === cur);
    });
    const curEl = strip.querySelector('.mv[data-current="true"]');
    if (curEl) {
      const left = curEl.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft || left + curEl.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = left - strip.clientWidth / 2 + curEl.offsetWidth / 2;
      }
    }
  }

  function renderStrip() {
    const strip = $('moveStrip');
    strip.textContent = '';
    let lastPhase = null;
    steps().forEach((s, k) => {
      if (lastPhase && s.phase !== lastPhase) {
        const sep = document.createElement('span');
        sep.className = 'mv-sep';
        strip.appendChild(sep);
      }
      lastPhase = s.phase;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mv';
      b.dataset.k = k;
      b.dataset.phase = s.phase;
      b.textContent = C.moveToString(s.move);
      b.title = `${describe(s.move).what}, ${describe(s.move).turn}`;
      b.addEventListener('click', () => jump(k));
      strip.appendChild(b);
    });
    strip.scrollLeft = 0;
  }

  function stepForward(after) {
    if (anim || idx >= steps().length) return false;
    const s = steps()[idx];
    animateMove(s.move, () => { idx++; updatePlayer(); if (after) after(); });
    anim.forwardIndex = idx;
    updatePlayer();
    return true;
  }
  function stepBack() {
    if (anim || idx <= 0) return;
    stop();
    const s = steps()[idx - 1];
    animateMove(C.invertMove(s.move), () => { idx--; updatePlayer(); });
    anim.forwardIndex = idx - 1;
    updatePlayer();
  }
  function loop() {
    if (!playing) return;
    if (idx >= steps().length) { playing = false; updatePlayer(); return; }
    stepForward(() => setTimeout(loop, reduceMotion ? 250 : quarterMs() * 0.7));
  }
  function play() {
    if (!steps().length) return;
    if (idx >= steps().length) jump(0);
    playing = true;
    updatePlayer();
    if (!anim) loop();
  }
  function stop() { playing = false; updatePlayer(); }
  function jump(k) {
    if (!solution) return;
    playing = false;
    anim = null;
    cube = solution.base.clone();
    for (let j = 0; j < k; j++) cube.applyMove(solution.steps[j].move);
    idx = k;
    updatePlayer();
    requestDraw();
  }

  // ---------- Analyse ----------
  function colorName(ci) { return C.COLORS[paletteMap[ci]].name; }

  function recompute() {
    playing = false;
    anim = null;
    solution = C.solveParity(cube);
    solution.base = cube.clone();
    idx = 0;
    highlight = new Set();
    solution.analysis.edges.forEach((e) => e.wings.forEach((w) => highlight.add(w)));
    renderReport();
    renderStrip();
    updatePlayer();
    save();
    requestDraw();
  }

  function orbitText(orbits) {
    const pos = orbits.map((j) => `n°${j + 1}`);
    const list = pos.length > 1 ? pos.slice(0, -1).join(', ') + ' et ' + pos[pos.length - 1] : pos[0];
    return `${orbits.length > 1 ? 'ailes' : 'aile'} ${list} depuis chaque coin`;
  }

  function renderReport() {
    const a = solution.analysis;
    const flipped = a.edges.filter((e) => e.flipped.length);
    const chip = $('statusChip');
    const parts = [];
    const tag = source === 'exemple' ? 'Exemple généré au hasard. ' : source === 'saisie' ? 'Cube reconstruit depuis ta saisie. ' : '';
    if (flipped.length) {
      chip.dataset.tone = 'warn';
      chip.textContent = `Parité : ${flipped.length} arête${flipped.length > 1 ? 's' : ''}`;
      flipped.forEach((e) => {
        parts.push(`<b>Arête <span class="edge-tag">${e.name}</span> (${FACE_SHORT[e.faces[0]]}-${FACE_SHORT[e.faces[1]]})</b> : ${orbitText(e.flipped)} retournée${e.flipped.length > 1 ? 's' : ''}.`);
      });
      parts.push(`${solution.steps.length} mouvements. Les ailes concernées sont entourées.`);
    } else if (!solution.issues.length) {
      chip.dataset.tone = 'ok';
      chip.textContent = 'Arêtes OK';
      parts.push('<b>Aucune parité d\'arête.</b> Toutes les arêtes sont appariées.');
    }
    if (solution.issues.length) {
      chip.dataset.tone = flipped.length ? 'warn' : 'bad';
      if (!flipped.length) chip.textContent = 'À vérifier';
      parts.push(`<span class="issue">${solution.issues.slice(0, 3).join(' ')}${solution.issues.length > 3 ? ' …' : ''} Vérifie les couleurs avec Peindre.</span>`);
    }
    $('report').innerHTML = tag + parts.join(' ');

    const c = a.centers;
    $('holdHint').innerHTML = `Tiens ton cube : <b>${colorName(c.U)}</b> en haut, <b>${colorName(c.F)}</b> face à toi`;
  }

  // ---------- Sauvegarde locale ----------
  function save() {
    try {
      const f = solution ? solution.base.facelets() : cube.facelets();
      const faces = {};
      C.FACES.forEach((F) => { faces[F] = Array.from(f[F]); });
      localStorage.setItem(STORE_KEY, JSON.stringify({ faces, paletteMap, source }));
    } catch (e) { /* stockage indisponible */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      const faces = {};
      C.FACES.forEach((F) => { faces[F] = Uint8Array.from(d.faces[F]); });
      cube = new C.Cube(N).setFacelets(faces);
      if (Array.isArray(d.paletteMap) && d.paletteMap.length === 6) paletteMap = d.paletteMap;
      source = d.source || 'photo';
      return true;
    } catch (e) { return false; }
  }

  // ---------- Gestes sur le cube ----------
  const pointers = new Map();
  let gesture = null;

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    if (pointers.size === 1) gesture = { kind: 'drag', x: ev.offsetX, y: ev.offsetY, x0: ev.offsetX, y0: ev.offsetY, moved: false };
    else if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      gesture = { kind: 'pinch', d0: Math.hypot(p.x - q.x, p.y - q.y), z0: zoom, mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId) || !gesture) return;
    pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
    if (gesture.kind === 'drag' && pointers.size === 1) {
      const dx = ev.offsetX - gesture.x, dy = ev.offsetY - gesture.y;
      if (Math.hypot(ev.offsetX - gesture.x0, ev.offsetY - gesture.y0) > 6) gesture.moved = true;
      if (!gesture.moved) return;
      gesture.x = ev.offsetX; gesture.y = ev.offsetY;
      const k = 0.0105 / Math.sqrt(zoom);
      view = mul(rotY(dx * k), mul(rotX(dy * k), view));
      requestDraw();
    } else if (gesture.kind === 'pinch' && pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      zoom = Math.min(6, Math.max(0.5, (gesture.z0 * d) / Math.max(1, gesture.d0)));
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      panX += mx - gesture.mx; panY += my - gesture.my;
      gesture.mx = mx; gesture.my = my;
      requestDraw();
    }
  });
  const endPointer = (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    if (gesture && gesture.kind === 'drag' && !gesture.moved && pointers.size === 1 && ev.type === 'pointerup' && paintMode) {
      paintAt(ev.offsetX, ev.offsetY);
    }
    pointers.delete(ev.pointerId);
    if (pointers.size === 0) gesture = null;
    else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      gesture = { kind: 'drag', x: p.x, y: p.y, x0: p.x, y0: p.y, moved: true };
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zoom = Math.min(6, Math.max(0.5, zoom * Math.exp(-ev.deltaY * 0.0015)));
    requestDraw();
  }, { passive: false });

  // ---------- Peinture ----------
  function renderSwatches() {
    const box = $('swatches');
    box.textContent = '';
    for (let ci = 0; ci < 6; ci++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = `rgb(${DISPLAY_RGB[paletteMap[ci]].join(',')})`;
      b.setAttribute('aria-label', colorName(ci));
      b.setAttribute('aria-pressed', String(ci === paintColor));
      b.addEventListener('click', () => { paintColor = ci; renderSwatches(); });
      box.appendChild(b);
    }
  }
  function paintAt(x, y) {
    if (anim) return;
    const i = pick(x, y);
    if (i < 0 || cube.col[i] === paintColor) return;
    // Repartir de l'état de départ pour que la solution reste cohérente.
    if (solution && idx > 0) jump(0);
    cube.col[i] = paintColor;
    source = 'photo';
    recompute();
  }
  $('btnPaint').addEventListener('click', () => {
    paintMode = !paintMode;
    $('btnPaint').setAttribute('aria-pressed', String(paintMode));
    $('paintBar').hidden = !paintMode;
    if (paintMode) renderSwatches();
    requestDraw();
  });

  // ---------- Boutons ----------
  $('btnPlay').addEventListener('click', () => (playing ? stop() : play()));
  $('btnNext').addEventListener('click', () => { stop(); stepForward(); });
  $('btnPrev').addEventListener('click', stepBack);
  $('btnFirst').addEventListener('click', () => jump(0));
  $('btnLast').addEventListener('click', () => jump(steps().length));
  $('btnExample').addEventListener('click', () => {
    cube = C.makeParityExample(N); source = 'exemple'; paletteMap = [0, 1, 2, 3, 4, 5]; recompute();
  });
  $('btnSolved').addEventListener('click', () => {
    cube = new C.Cube(N); source = 'résolu'; recompute();
  });
  $('btnView').addEventListener('click', () => { view = homeView(); zoom = 1; panX = panY = 0; requestDraw(); });
  $('btnHelp').addEventListener('click', () => { $('helpSheet').hidden = false; });
  $('btnHelpClose').addEventListener('click', () => { $('helpSheet').hidden = true; });
  document.addEventListener('keydown', (ev) => {
    if (!$('photoSheet').hidden || !$('helpSheet').hidden || !$('quickSheet').hidden || /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
    if (ev.key === ' ') { ev.preventDefault(); playing ? stop() : play(); }
    else if (ev.key === 'ArrowRight') { stop(); stepForward(); }
    else if (ev.key === 'ArrowLeft') stepBack();
  });

  // =====================================================================
  // Photo : 4 coins par face -> homographie -> échantillonnage -> classement
  // =====================================================================
  const photo = {
    img: null, data: null, w: 0, h: 0,
    face: 'F', pts: {}, samples: {},
  };
  const pCanvas = $('photoCanvas');
  const pctx = pCanvas.getContext('2d');
  let pW = 1, pH = 1, fit = { s: 1, ox: 0, oy: 0 };
  let drag = null;

  function homography(pts) {
    const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i], [x, y] = pts[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const k = A[r][c] / A[c][c];
        for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
        b[r] -= k * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return (u, v) => {
      const d = h[6] * u + h[7] * v + 1;
      return [(h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d];
    };
  }

  // Couleur moyenne de chaque case (n*n*3), lue au centre de la case.
  function sampleFace(pts) {
    const map = homography(pts);
    if (!map) return null;
    const out = new Float32Array(N * N * 3);
    const { data, w, h } = photo;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      let R = 0, G = 0, B = 0, k = 0;
      for (let a = 0; a < 4; a++) for (let bb = 0; bb < 4; bb++) {
        const [x, y] = map((c + 0.32 + 0.12 * a) / N, (r + 0.32 + 0.12 * bb) / N);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
        const o = (yi * w + xi) * 4;
        R += data[o]; G += data[o + 1]; B += data[o + 2]; k++;
      }
      const o = (r * N + c) * 3;
      if (k) { out[o] = R / k; out[o + 1] = G / k; out[o + 2] = B / k; }
    }
    return out;
  }

  function toLab([r, g, b]) {
    const lin = (v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
    const R = lin(r), G = lin(g), B = lin(b);
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  const labDist = (a, b) => 0.5 * Math.abs(a[0] - b[0]) + Math.hypot(a[1] - b[1], a[2] - b[2]);

  // Couleur de référence de chaque face : médiane des centres de la photo, sinon couleur standard.
  function faceRefs() {
    return C.FACES.map((F, fi) => {
      const s = photo.samples[F];
      if (!s) return toLab(C.COLORS[fi].rgb);
      const ch = [[], [], []];
      for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) {
        for (let k = 0; k < 3; k++) ch[k].push(s[(r * N + c) * 3 + k]);
      }
      return toLab(ch.map((a) => a.sort((x, y) => x - y)[a.length >> 1]));
    });
  }

  function classify(s, refs) {
    const out = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const lab = toLab([s[3 * i], s[3 * i + 1], s[3 * i + 2]]);
      let best = 0, bd = Infinity;
      refs.forEach((ref, ci) => { const d = labDist(lab, ref); if (d < bd) { bd = d; best = ci; } });
      out[i] = best;
    }
    return out;
  }

  // Couleur standard la plus proche pour chaque face (affectation sans doublon).
  function bestPalette(refs) {
    const std = DISPLAY_RGB.map(toLab);
    let best = null, bd = Infinity;
    const perm = (used, acc) => {
      if (acc.length === 6) {
        const d = acc.reduce((s, p, i) => s + labDist(refs[i], std[p]), 0);
        if (d < bd) { bd = d; best = acc.slice(); }
        return;
      }
      for (let p = 0; p < 6; p++) if (!used[p]) { used[p] = 1; acc.push(p); perm(used, acc); acc.pop(); used[p] = 0; }
    };
    perm([], []);
    return best;
  }

  function previewColors() {
    const F = photo.face;
    const pts = photo.pts[F];
    if (!pts || pts.length < 4 || !photo.data) return null;
    const raw = sampleFace(pts);
    if (!raw) return null;
    const keep = photo.samples[F];
    photo.samples[F] = raw;
    const refs = faceRefs();
    const pal = bestPalette(refs);
    const cls = classify(raw, refs);
    photo.samples[F] = keep;
    return { cls, pal };
  }

  function renderFacePick() {
    const box = $('facePick');
    box.textContent = '';
    C.FACES.forEach((F, fi) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'face-btn';
      b.setAttribute('aria-pressed', String(F === photo.face));
      b.dataset.done = String(!!photo.samples[F]);
      b.innerHTML = `<b>${F}</b><span class="face-dot" style="background:rgb(${DISPLAY_RGB[paletteMap[fi]].join(',')})"></span><span>${FACE_SHORT[F]}</span><span class="face-state"></span>`;
      b.addEventListener('click', () => { photo.face = F; renderFacePick(); renderPhotoHint(); drawPhoto(); });
      box.appendChild(b);
    });
  }

  function renderPhotoHint() {
    const F = photo.face;
    const orient = F === 'U' ? "le côté arrière (B) en haut" : F === 'D' ? "le côté avant (F) en haut" : 'la face du haut (U) en haut';
    const n = (photo.pts[F] || []).length;
    let msg;
    if (!photo.img) msg = 'Choisis une photo nette, prise de face ou en biais.';
    else if (n < 4) msg = `Face <b>${F}</b> (${FACE_SHORT[F]}), avec ${orient}. Touche le coin <b>${['haut-gauche', 'haut-droit', 'bas-droit', 'bas-gauche'][n]}</b> (${n + 1}/4). Fais glisser pour ajuster.`;
    else msg = `Face <b>${F}</b> : vérifie l'aperçu (pastilles = couleurs lues). Ajuste un coin si besoin, puis <b>Appliquer</b>.`;
    $('photoHint').innerHTML = msg;
    $('btnApply').disabled = n < 4;
  }

  function resizePhoto() {
    const r = pCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    pW = Math.max(1, r.width); pH = Math.max(1, r.height);
    pCanvas.width = Math.round(pW * dpr); pCanvas.height = Math.round(pH * dpr);
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (photo.img) {
      const s = Math.min(pW / photo.w, pH / photo.h);
      fit = { s, ox: (pW - photo.w * s) / 2, oy: (pH - photo.h * s) / 2 };
    }
    drawPhoto();
  }
  const toScreen = ([x, y]) => [fit.ox + x * fit.s, fit.oy + y * fit.s];
  const toImage = (x, y) => [(x - fit.ox) / fit.s, (y - fit.oy) / fit.s];

  function drawPhoto() {
    pctx.clearRect(0, 0, pW, pH);
    $('photoEmpty').hidden = !!photo.img;
    if (!photo.img) return;
    pctx.drawImage(photo.img, fit.ox, fit.oy, photo.w * fit.s, photo.h * fit.s);
    const pts = photo.pts[photo.face] || [];
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

    if (pts.length === 4) {
      const map = homography(pts);
      const prev = previewColors();
      if (map) {
        pctx.strokeStyle = 'rgba(255,255,255,0.55)';
        pctx.lineWidth = 1;
        pctx.beginPath();
        for (let k = 0; k <= N; k++) {
          for (let t = 0; t <= 1; t++) {
            const [a, b] = [toScreen(map(k / N, 0)), toScreen(map(k / N, 1))];
            const [c2, d2] = [toScreen(map(0, k / N)), toScreen(map(1, k / N))];
            if (t === 0) { pctx.moveTo(a[0], a[1]); pctx.lineTo(b[0], b[1]); } else { pctx.moveTo(c2[0], c2[1]); pctx.lineTo(d2[0], d2[1]); }
          }
        }
        pctx.stroke();
        if (prev) {
          const cell = Math.hypot(...[0, 1].map((i) => toScreen(map(1 / N, 0))[i] - toScreen(map(0, 0))[i]));
          const rad = Math.max(1.5, Math.min(6, cell * 0.22));
          for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
            const [x, y] = toScreen(map((c + 0.5) / N, (r + 0.5) / N));
            pctx.beginPath();
            pctx.arc(x, y, rad, 0, Math.PI * 2);
            pctx.fillStyle = `rgb(${DISPLAY_RGB[prev.pal[prev.cls[r * N + c]]].join(',')})`;
            pctx.fill();
            pctx.lineWidth = 1; pctx.strokeStyle = '#000'; pctx.stroke();
          }
        }
      }
    }
    // Contour et coins numérotés.
    pctx.lineWidth = 2;
    pctx.strokeStyle = accent;
    pctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = toScreen(p); i ? pctx.lineTo(x, y) : pctx.moveTo(x, y); });
    if (pts.length === 4) pctx.closePath();
    pctx.stroke();
    pts.forEach((p, i) => {
      const [x, y] = toScreen(p);
      pctx.beginPath(); pctx.arc(x, y, 11, 0, Math.PI * 2);
      pctx.fillStyle = accent; pctx.fill();
      pctx.fillStyle = '#fff'; pctx.font = '600 12px sans-serif'; pctx.textAlign = 'center'; pctx.textBaseline = 'middle';
      pctx.fillText(String(i + 1), x, y + 0.5);
    });
    // Loupe pendant le placement d'un coin.
    if (drag) {
      const p = pts[drag.i];
      if (p) {
        const [sx, sy] = toScreen(p);
        const L = 120, Z = 3.5;
        const lx = sx < pW / 2 && sy < L + 30 ? pW - L - 10 : 10, ly = 10;
        pctx.save();
        pctx.beginPath(); pctx.rect(lx, ly, L, L); pctx.clip();
        const srcSize = L / (fit.s * Z);
        pctx.drawImage(photo.img, p[0] - srcSize / 2, p[1] - srcSize / 2, srcSize, srcSize, lx, ly, L, L);
        pctx.strokeStyle = accent; pctx.lineWidth = 1.5;
        pctx.beginPath();
        pctx.moveTo(lx + L / 2, ly); pctx.lineTo(lx + L / 2, ly + L);
        pctx.moveTo(lx, ly + L / 2); pctx.lineTo(lx + L, ly + L / 2);
        pctx.stroke();
        pctx.restore();
        pctx.strokeStyle = '#fff'; pctx.lineWidth = 2; pctx.strokeRect(lx, ly, L, L);
      }
    }
  }

  pCanvas.addEventListener('pointerdown', (ev) => {
    if (!photo.img) return;
    pCanvas.setPointerCapture(ev.pointerId);
    const F = photo.face;
    const pts = (photo.pts[F] = photo.pts[F] || []);
    let near = -1, nd = 28;
    pts.forEach((p, i) => { const [x, y] = toScreen(p); const d = Math.hypot(x - ev.offsetX, y - ev.offsetY); if (d < nd) { nd = d; near = i; } });
    if (near < 0) {
      if (pts.length >= 4) return;
      pts.push(toImage(ev.offsetX, ev.offsetY));
      near = pts.length - 1;
    }
    const [px, py] = toScreen(pts[near]);
    drag = { i: near, id: ev.pointerId, dx: px - ev.offsetX, dy: py - ev.offsetY };
    renderPhotoHint();
    drawPhoto();
  });
  pCanvas.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const p = toImage(ev.offsetX + drag.dx, ev.offsetY + drag.dy);
    p[0] = Math.min(photo.w, Math.max(0, p[0])); p[1] = Math.min(photo.h, Math.max(0, p[1]));
    photo.pts[photo.face][drag.i] = p;
    drawPhoto();
  });
  const endDrag = (ev) => { if (drag && ev.pointerId === drag.id) { drag = null; drawPhoto(); } };
  pCanvas.addEventListener('pointerup', endDrag);
  pCanvas.addEventListener('pointercancel', endDrag);

  function loadImageFile(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const off = document.createElement('canvas');
      off.width = Math.round(img.naturalWidth * s); off.height = Math.round(img.naturalHeight * s);
      const octx = off.getContext('2d', { willReadFrequently: true });
      octx.drawImage(img, 0, 0, off.width, off.height);
      photo.img = off; photo.w = off.width; photo.h = off.height;
      photo.data = octx.getImageData(0, 0, off.width, off.height).data;
      photo.pts = {};
      URL.revokeObjectURL(url);
      resizePhoto();
      renderPhotoHint();
    };
    img.onerror = () => { $('photoHint').textContent = "Cette image n'a pas pu être ouverte. Essaie une photo JPEG ou PNG."; };
    img.src = url;
  }
  ['fileInput', 'camInput'].forEach((id) => $(id).addEventListener('change', (ev) => {
    loadImageFile(ev.target.files && ev.target.files[0]);
    ev.target.value = '';
  }));
  // Coller une image (copiée depuis la galerie) ou la glisser sur la zone.
  document.addEventListener('paste', (ev) => {
    if ($('photoSheet').hidden) return;
    const item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((it) => it.type.startsWith('image/'));
    if (item) { ev.preventDefault(); loadImageFile(item.getAsFile()); }
    $('pasteZone').value = '';
  });
  $('pasteZone').addEventListener('input', () => { $('pasteZone').value = ''; });
  $('photoStage').addEventListener('dragover', (ev) => ev.preventDefault());
  $('photoStage').addEventListener('drop', (ev) => {
    ev.preventDefault();
    loadImageFile(ev.dataTransfer.files && ev.dataTransfer.files[0]);
  });

  $('btnUndoPt').addEventListener('click', () => { photo.pts[photo.face] = []; renderPhotoHint(); drawPhoto(); });
  $('btnRotate').addEventListener('click', () => {
    // Fait tourner les coins : l'aperçu et la lecture tournent d'un quart de tour.
    const pts = photo.pts[photo.face];
    if (pts && pts.length === 4) { pts.unshift(pts.pop()); drawPhoto(); }
  });
  $('btnApply').addEventListener('click', () => {
    const F = photo.face;
    const pts = photo.pts[F];
    if (!pts || pts.length < 4) return;
    const raw = sampleFace(pts);
    if (!raw) return;
    photo.samples[F] = raw;
    const refs = faceRefs();
    paletteMap = bestPalette(refs);
    const faces = (solution ? solution.base : cube).facelets();
    C.FACES.forEach((G) => { if (photo.samples[G]) faces[G] = classify(photo.samples[G], refs); });
    cube = new C.Cube(N).setFacelets(faces);
    source = 'photo';
    recompute();
    // Face suivante sans photo.
    const next = C.FACES.find((G) => !photo.samples[G]);
    if (next) photo.face = next;
    renderFacePick();
    renderPhotoHint();
    drawPhoto();
  });
  $('btnPhoto').addEventListener('click', () => {
    stop();
    $('photoSheet').hidden = false;
    renderFacePick();
    renderPhotoHint();
    requestAnimationFrame(resizePhoto);
  });
  $('btnPhotoClose').addEventListener('click', () => { $('photoSheet').hidden = true; requestAnimationFrame(resize); });

  // =====================================================================
  // Saisie rapide : arête fautive + paires d'ailes retournées
  // =====================================================================
  const quick = { edge: 'UF', flips: {} };
  const ORBITS = Array.from({ length: (N - 3) / 2 }, (_, k) => k + 1);

  function renderQuick() {
    const ep = $('edgePick');
    ep.textContent = '';
    C.EDGES.forEach(([A, B]) => {
      const name = A + B;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'edge-btn';
      b.setAttribute('aria-pressed', String(name === quick.edge));
      b.dataset.count = String((quick.flips[name] || []).length);
      b.innerHTML = `<b>${name}</b><span>${FACE_SHORT[A]}-${FACE_SHORT[B]}</span>`;
      b.addEventListener('click', () => { quick.edge = name; renderQuick(); });
      ep.appendChild(b);
    });
    const wp = $('wingPick');
    wp.textContent = '';
    const cur = quick.flips[quick.edge] || [];
    ORBITS.forEach((j) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wing-btn';
      b.setAttribute('aria-pressed', String(cur.includes(j)));
      b.innerHTML = `<b>${j + 1} et ${N - j}</b><span>${j === 1 ? 'près des coins' : j === ORBITS.length ? 'près du milieu' : 'ailes n°' + (j + 1)}</span>`;
      b.addEventListener('click', () => {
        const list = (quick.flips[quick.edge] || []).slice();
        const at = list.indexOf(j);
        if (at >= 0) list.splice(at, 1); else list.push(j);
        list.sort((x, y) => x - y);
        if (list.length) quick.flips[quick.edge] = list; else delete quick.flips[quick.edge];
        renderQuick();
      });
      wp.appendChild(b);
    });
    const names = Object.keys(quick.flips);
    $('quickSummary').innerHTML = names.length
      ? 'Sélection : ' + names.map((n) => `<b>${n}</b> ailes ${quick.flips[n].map((j) => `${j + 1}/${N - j}`).join(', ')}`).join(' · ')
      : 'Aucune aile sélectionnée.';
  }

  $('btnQuick').addEventListener('click', () => {
    stop();
    quick.flips = {};
    if (source === 'saisie' || source === 'photo') {
      solution.analysis.edges.forEach((e) => { if (e.flipped.length) quick.flips[e.name] = e.flipped.slice(); });
    }
    quick.edge = Object.keys(quick.flips)[0] || 'UF';
    renderQuick();
    $('quickSheet').hidden = false;
  });
  $('btnQuickClose').addEventListener('click', () => { $('quickSheet').hidden = true; });
  $('btnQuickClear').addEventListener('click', () => { quick.flips = {}; renderQuick(); });
  $('btnQuickApply').addEventListener('click', () => {
    cube = C.makeFlippedState(N, quick.flips);
    source = 'saisie';
    paletteMap = [0, 1, 2, 3, 4, 5];
    recompute();
    $('quickSheet').hidden = true;
    requestAnimationFrame(resize);
  });

  // ---------- Démarrage ----------
  readTheme();
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new ResizeObserver(resize).observe($('stage'));
  new ResizeObserver(resizePhoto).observe($('photoStage'));
  if (!load()) { cube = C.makeParityExample(N); source = 'exemple'; }
  recompute();
  resize();
})();
