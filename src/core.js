// Moteur du cube NxN : état, mouvements, analyse et résolution de la parité d'arête.
// Aucun accès au DOM : ce fichier est testé avec Node (voir test/core.test.js).
(function (root) {
  'use strict';

  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  const NORMALS = {
    U: [0, 1, 0], D: [0, -1, 0],
    R: [1, 0, 0], L: [-1, 0, 0],
    F: [0, 0, 1], B: [0, 0, -1],
  };
  // Repère de chaque face vue de face : vecteur "droite" et vecteur "bas".
  // Faces latérales : U en haut. U : B en haut. D : F en haut.
  const FACE_AXES = {
    U: [[1, 0, 0], [0, 0, 1]],
    D: [[1, 0, 0], [0, 0, -1]],
    F: [[1, 0, 0], [0, -1, 0]],
    B: [[-1, 0, 0], [0, -1, 0]],
    R: [[0, 0, -1], [0, -1, 0]],
    L: [[0, 0, 1], [0, -1, 0]],
  };
  // Couleur d'origine de chaque face (indice = FACES.indexOf(face)).
  const COLORS = [
    { name: 'blanc', hex: '#f4f4f0', rgb: [235, 235, 230] },
    { name: 'rouge', hex: '#c8202c', rgb: [190, 30, 40] },
    { name: 'vert', hex: '#12a150', rgb: [20, 160, 80] },
    { name: 'jaune', hex: '#f5d01a', rgb: [240, 205, 30] },
    { name: 'orange', hex: '#f47a12', rgb: [245, 120, 20] },
    { name: 'bleu', hex: '#1756c8', rgb: [25, 85, 200] },
  ];

  const axisOf = (v) => (v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2);

  // Rotation d'un quart de tour (+90°, sens direct) autour de l'axe k, répétée q fois.
  function rot(v, k, q) {
    let [x, y, z] = v;
    for (let i = 0; i < ((q % 4) + 4) % 4; i++) {
      if (k === 0) [y, z] = [-z, y];
      else if (k === 1) [x, z] = [z, -x];
      else [x, y] = [-y, x];
    }
    return [x, y, z];
  }

  // ---------- Notation ----------
  // Un mouvement : { face, depths: [profondeurs, 1 = couche extérieure], turns: 1|2|3 }
  // Rotation du cube entier : { face: 'R'|'U'|'F', whole: true, turns } notée x, y, z.
  const WHOLE = { R: 'x', U: 'y', F: 'z' };
  const suffix = (t) => (t === 2 ? '2' : t === 3 ? "'" : '');

  function moveToString(m) {
    if (m.whole) return WHOLE[m.face] + suffix(m.turns);
    const d = [...m.depths].sort((a, b) => a - b);
    const lo = d[0], hi = d[d.length - 1];
    const contiguous = hi - lo + 1 === d.length;
    let base;
    if (d.length === 1) base = (lo === 1 ? '' : lo) + m.face;
    else if (contiguous && lo === 1) base = (hi === 2 ? '' : hi) + m.face + 'w';
    else if (contiguous) base = lo + '-' + hi + m.face;
    else base = '[' + d.join(',') + ']' + m.face;
    return base + suffix(m.turns);
  }

  function parseMove(tok) {
    const w = /^([xyz])(2'?|')?$/.exec(tok.trim());
    if (w) return { face: { x: 'R', y: 'U', z: 'F' }[w[1]], whole: true, depths: [], turns: w[2] === "'" ? 3 : w[2] ? 2 : 1 };
    const r = /^(\d+)?(?:-(\d+))?([URFDLB])(w)?(2'?|')?$/.exec(tok.trim());
    if (!r) throw new Error('Mouvement inconnu : ' + tok);
    const face = r[3];
    let depths;
    if (r[4]) {
      const hi = r[1] ? +r[1] : 2;
      depths = Array.from({ length: hi }, (_, i) => i + 1);
    } else if (r[2]) {
      depths = [];
      for (let i = +r[1]; i <= +r[2]; i++) depths.push(i);
    } else depths = [r[1] ? +r[1] : 1];
    const turns = r[5] === "'" ? 3 : r[5] ? 2 : 1;
    return { face, depths, turns };
  }

  const parseAlg = (s) => s.trim().split(/\s+/).filter(Boolean).map(parseMove);
  const invertMove = (m) => ({ ...m, depths: m.depths.slice(), turns: 4 - m.turns });
  const invertAlg = (alg) => alg.slice().reverse().map(invertMove);

  // ---------- Cube ----------
  class Cube {
    constructor(n) {
      this.n = n;
      const M = 6 * n * n;
      this.pos = new Int16Array(3 * M); // positions doublées : coordonnées dans [-n, n]
      this.nrm = new Int8Array(3 * M);
      this.col = new Uint8Array(M);
      this.reset();
    }

    reset() {
      const n = this.n;
      let i = 0;
      FACES.forEach((f, fi) => {
        const nv = NORMALS[f], [r, d] = FACE_AXES[f];
        for (let row = 0; row < n; row++) {
          for (let c = 0; c < n; c++, i++) {
            for (let a = 0; a < 3; a++) {
              this.pos[3 * i + a] = nv[a] * n + r[a] * (2 * c - n + 1) + d[a] * (2 * row - n + 1);
              this.nrm[3 * i + a] = nv[a];
            }
            this.col[i] = fi;
          }
        }
      });
    }

    clone() {
      const c = new Cube(this.n);
      c.pos.set(this.pos); c.nrm.set(this.nrm); c.col.set(this.col);
      return c;
    }

    get count() { return this.col.length; }

    // Indice de couche (0..n-1) du sticker i le long de l'axe k.
    layerOf(i, k) {
      return (this.pos[3 * i + k] - this.nrm[3 * i + k] + this.n - 1) / 2;
    }

    // Axe, couches concernées et nombre de quarts de tour (sens direct autour de +axe).
    moveGeometry(m) {
      const nv = NORMALS[m.face], k = axisOf(nv), s = nv[k];
      const layers = m.whole
        ? Array.from({ length: this.n }, (_, i) => i)
        : m.depths.map((d) => (s > 0 ? this.n - d : d - 1));
      const q = (((-m.turns * s) % 4) + 4) % 4;
      return { axis: k, layers, q };
    }

    movingMask(m) {
      const { axis, layers } = this.moveGeometry(m);
      const set = new Set(layers);
      const mask = new Uint8Array(this.count);
      for (let i = 0; i < this.count; i++) if (set.has(this.layerOf(i, axis))) mask[i] = 1;
      return mask;
    }

    applyMove(m) {
      const { axis, q } = this.moveGeometry(m);
      const mask = this.movingMask(m);
      for (let i = 0; i < this.count; i++) {
        if (!mask[i]) continue;
        const p = rot([this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]], axis, q);
        const v = rot([this.nrm[3 * i], this.nrm[3 * i + 1], this.nrm[3 * i + 2]], axis, q);
        for (let a = 0; a < 3; a++) { this.pos[3 * i + a] = p[a]; this.nrm[3 * i + a] = v[a]; }
      }
      return this;
    }

    applyAlg(alg) {
      (typeof alg === 'string' ? parseAlg(alg) : alg).forEach((m) => this.applyMove(m));
      return this;
    }

    // Clé unique d'une position de sticker (coordonnées doublées).
    key(x, y, z) {
      const w = 2 * this.n + 1;
      return ((x + this.n) * w + (y + this.n)) * w + (z + this.n);
    }

    // Table position -> indice de sticker.
    indexByPos() {
      const map = new Map();
      for (let i = 0; i < this.count; i++) {
        map.set(this.key(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]), i);
      }
      return map;
    }

    // Face, ligne et colonne d'une position sur la surface.
    static faceCoords(n, p, nv) {
      for (const f of FACES) {
        const fn = NORMALS[f];
        if (fn[0] === nv[0] && fn[1] === nv[1] && fn[2] === nv[2]) {
          const [r, d] = FACE_AXES[f];
          const c = (p[0] * r[0] + p[1] * r[1] + p[2] * r[2] + n - 1) / 2;
          const row = (p[0] * d[0] + p[1] * d[1] + p[2] * d[2] + n - 1) / 2;
          return { face: f, row, col: c };
        }
      }
      return null;
    }

    // Couleurs vues de face : { U: Uint8Array(n*n), ... } indexées row*n+col.
    facelets() {
      const n = this.n, out = {};
      FACES.forEach((f) => { out[f] = new Uint8Array(n * n); });
      for (let i = 0; i < this.count; i++) {
        const p = [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]];
        const v = [this.nrm[3 * i], this.nrm[3 * i + 1], this.nrm[3 * i + 2]];
        const fc = Cube.faceCoords(n, p, v);
        out[fc.face][fc.row * n + fc.col] = this.col[i];
      }
      return out;
    }

    // Remplace l'état par des couleurs données face par face (positions remises à zéro).
    setFacelets(faces) {
      this.reset();
      const n = this.n;
      FACES.forEach((f, fi) => {
        for (let j = 0; j < n * n; j++) this.col[fi * n * n + j] = faces[f][j];
      });
      return this;
    }

    // Couleur actuellement visible à une position de sticker donnée.
    colorAt(map, p) {
      return this.col[map.get(this.key(p[0], p[1], p[2]))];
    }
  }

  // ---------- Arêtes ----------
  const EDGES = [
    ['U', 'F'], ['U', 'R'], ['U', 'B'], ['U', 'L'],
    ['D', 'F'], ['D', 'R'], ['D', 'B'], ['D', 'L'],
    ['F', 'R'], ['F', 'L'], ['B', 'R'], ['B', 'L'],
  ];

  // Positions doublées des deux stickers du morceau d'arête à l'indice t (0..n-1 le long de l'axe libre).
  function wingStickers(n, A, B, t) {
    const nA = NORMALS[A], nB = NORMALS[B];
    const k = [0, 1, 2].find((a) => nA[a] === 0 && nB[a] === 0);
    const c = [0, 0, 0];
    for (let a = 0; a < 3; a++) c[a] = (n - 1) * (nA[a] + nB[a]);
    c[k] = 2 * t - n + 1;
    return [
      [c[0] + nA[0], c[1] + nA[1], c[2] + nA[2]],
      [c[0] + nB[0], c[1] + nB[1], c[2] + nB[2]],
    ];
  }

  // Analyse les arêtes d'un cube impair déjà réduit (centres faits, arêtes appariées).
  function analyze(cube) {
    const n = cube.n;
    if (n % 2 === 0 || n < 5) throw new Error('Cube impair de taille >= 5 attendu');
    const map = cube.indexByPos();
    const mid = (n - 1) / 2, orbits = (n - 3) / 2;

    const centers = {};
    let centersOk = true;
    const faces = cube.facelets();
    FACES.forEach((f) => {
      const g = faces[f];
      centers[f] = g[mid * n + mid];
      for (let r = 1; r < n - 1; r++) for (let c = 1; c < n - 1; c++) {
        if (g[r * n + c] !== centers[f]) centersOk = false;
      }
    });

    const edges = EDGES.map(([A, B]) => {
      const [mA, mB] = wingStickers(n, A, B, mid);
      const cA = cube.colorAt(map, mA), cB = cube.colorAt(map, mB);
      const flipped = [], unpaired = [], wings = [];
      for (let j = 1; j <= orbits; j++) {
        const ts = [j, n - 1 - j];
        const cols = ts.map((t) => wingStickers(n, A, B, t).map((p) => cube.colorAt(map, p)));
        const ok = cols.every(([a, b]) => a === cA && b === cB);
        const flip = cols.every(([a, b]) => a === cB && b === cA);
        if (flip) flipped.push(j);
        else if (!ok) unpaired.push(j);
        if (flip || !ok) ts.forEach((t) => wingStickers(n, A, B, t).forEach((p) => wings.push(map.get(cube.key(p[0], p[1], p[2])))));
      }
      return { name: A + B, faces: [A, B], colors: [cA, cB], flipped, unpaired, wings };
    });
    return { centers, centersOk, edges };
  }

  // ---------- Résolution ----------
  const OUTER_MOVES = [];
  FACES.forEach((f) => [1, 2, 3].forEach((t) => OUTER_MOVES.push({ face: f, depths: [1], turns: t })));

  const ROTATIONS = [];
  ['R', 'U', 'F'].forEach((f) => [1, 2, 3].forEach((t) => ROTATIONS.push({ face: f, whole: true, depths: [], turns: t })));

  // Plus courte suite de mouvements (extérieurs, ou rotations du cube entier) amenant l'arête (A,B) en UF.
  function setupToUF(A, B, moves = OUTER_MOVES) {
    const start = [NORMALS[A], NORMALS[B]];
    const isUF = (e) => {
      const s = e.map((v) => v.join()).sort().join('|');
      return s === [NORMALS.U, NORMALS.F].map((v) => v.join()).sort().join('|');
    };
    let frontier = [{ e: start, path: [] }];
    const seen = new Set([start.map((v) => v.join()).sort().join('|')]);
    while (frontier.length) {
      const next = [];
      for (const { e, path } of frontier) {
        if (isUF(e)) return path;
        for (const m of moves) {
          const nv = NORMALS[m.face], k = axisOf(nv), s = nv[k];
          if (!m.whole && !e.some((v) => v[k] === s)) continue; // l'arête n'est pas dans cette couche
          const q = (((-m.turns * s) % 4) + 4) % 4;
          const e2 = e.map((v) => rot(v, k, q));
          const key = e2.map((v) => v.join()).sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ e: e2, path: path.concat([m]) });
        }
      }
      frontier = next;
    }
    throw new Error('Arête introuvable');
  }

  // Algorithme de parité (retourne l'arête UF) pour un ensemble d'orbites.
  // r = tranches internes côté R, l = tranches internes côté L, profondeur j+1 pour l'orbite j.
  const PARITY_TEMPLATE = "r2 B2 U2 l U2 r' U2 r U2 F2 r F2 l' B2 r2";

  function parityAlg(orbits) {
    const depths = orbits.map((j) => j + 1).sort((a, b) => a - b);
    const out = [];
    PARITY_TEMPLATE.split(' ').forEach((tok) => {
      const turns = tok.endsWith("'") ? 3 : tok.endsWith('2') ? 2 : 1;
      if (tok[0] === 'r' || tok[0] === 'l') {
        const face = tok[0] === 'r' ? 'R' : 'L';
        depths.forEach((d) => out.push({ face, depths: [d], turns }));
      } else out.push({ face: tok[0], depths: [1], turns });
    });
    return out;
  }

  // Construit la solution pas à pas. Chaque étape : { move, phase, note }.
  function solveParity(cube) {
    const a = analyze(cube);
    const steps = [];
    const issues = [];
    if (!a.centersOk) issues.push('Les centres ne sont pas tous résolus.');
    a.edges.forEach((e) => {
      if (e.unpaired.length) issues.push(`Arête ${e.name} : ailes n°${e.unpaired.map((j) => j + 1).join(', ')} non appariées.`);
    });
    // Arête par arête : tourner le cube entier pour la mettre en haut devant, puis l'algorithme.
    const work = cube.clone();
    for (let guard = 0; guard < 12; guard++) {
      const todo = analyze(work).edges.filter((e) => e.flipped.length);
      if (!todo.length) break;
      const e = todo.find((x) => x.name === 'UF') || todo[0];
      const edge = { colors: e.colors, orbits: e.flipped };
      const label = `aile${e.flipped.length > 1 ? 's' : ''} n°${e.flipped.map((j) => j + 1).join(', ')}`;
      setupToUF(e.faces[0], e.faces[1], ROTATIONS).forEach((m) => {
        steps.push({ move: m, phase: 'rotate', edge, note: `Tourner le cube : arête ${e.name} en haut devant` });
        work.applyMove(m);
      });
      parityAlg(e.flipped).forEach((m) => {
        steps.push({ move: m, phase: 'alg', edge, note: `Parité (${label})` });
        work.applyMove(m);
      });
    }
    return { analysis: a, steps, issues };
  }

  // Cube réduit avec, pour chaque arête donnée, les orbites indiquées retournées.
  // flips : { UF: [1, 3], BL: [2] } ; chaque arête est traitée par conjugaison (mise en place, parité, retour).
  function makeFlippedState(n, flips) {
    const cube = new Cube(n);
    Object.keys(flips).forEach((name) => {
      const orbits = flips[name];
      if (!orbits || !orbits.length) return;
      const setup = setupToUF(name[0], name[1]);
      cube.applyAlg(setup).applyAlg(parityAlg(orbits)).applyAlg(invertAlg(setup));
    });
    return cube;
  }

  // Exemple : cube réduit avec une parité d'arête sur une arête et des orbites au hasard.
  function makeParityExample(n, rnd = Math.random) {
    const cube = new Cube(n);
    const orbits = [];
    for (let j = 1; j <= (n - 3) / 2; j++) if (rnd() < 0.5) orbits.push(j);
    if (!orbits.length) orbits.push(1 + Math.floor(rnd() * ((n - 3) / 2)));
    cube.applyAlg(parityAlg(orbits));
    for (let i = 0; i < 20; i++) cube.applyMove(OUTER_MOVES[Math.floor(rnd() * OUTER_MOVES.length)]);
    return cube;
  }

  const api = {
    FACES, NORMALS, FACE_AXES, COLORS, EDGES, Cube, rot, axisOf,
    moveToString, parseMove, parseAlg, invertMove, invertAlg,
    analyze, setupToUF, ROTATIONS, parityAlg, solveParity, makeParityExample, makeFlippedState, wingStickers,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RubikCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
