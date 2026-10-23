// Lancer : node test/core.test.js
const assert = require('assert');
const C = require('../src/core.js');

const N = 15;
const solvedFacelets = new C.Cube(N).facelets();

function sameAsSolved(cube) {
  const f = cube.facelets();
  return C.FACES.every((F) => f[F].every((v, i) => v === solvedFacelets[F][i]));
}

// Générateur pseudo-aléatoire reproductible.
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

let checks = 0;

// Notation : aller-retour texte <-> mouvement.
for (const s of ['R', "3R'", 'Rw2', '4Rw', "2-5U'", 'B2']) {
  assert.strictEqual(C.moveToString(C.parseMove(s)), s);
  checks++;
}

// Un mouvement suivi de son inverse ramène au cube résolu ; quatre quarts de tour aussi.
{
  const c = new C.Cube(N);
  c.applyAlg("3R U 7F' 2-4L2 B D'");
  assert(!sameAsSolved(c));
  c.applyAlg(C.invertAlg(C.parseAlg("3R U 7F' 2-4L2 B D'")));
  assert(sameAsSolved(c));
  const d = new C.Cube(N).applyAlg('5R 5R 5R 5R');
  assert(sameAsSolved(d));
  checks += 3;
}

// L'algorithme de parité ne change que les deux ailes visées de UF.
for (let j = 1; j <= (N - 3) / 2; j++) {
  const c = new C.Cube(N).applyAlg(C.parityAlg([j]));
  const a = C.analyze(c);
  assert(a.centersOk);
  const bad = a.edges.filter((e) => e.flipped.length || e.unpaired.length);
  assert.deepStrictEqual(bad.map((e) => [e.name, e.flipped, e.unpaired]), [['UF', [j], []]]);
  checks++;
}

// Chaque arête peut être amenée en UF.
for (const [A, B] of C.EDGES) {
  const setup = C.setupToUF(A, B);
  assert(setup.length <= 3, A + B);
  checks++;
}

// Cas aléatoires : la solution proposée résout toujours la parité.
for (let seed = 1; seed <= 40; seed++) {
  const cube = C.makeParityExample(N, lcg(seed));
  const sol = C.solveParity(cube);
  assert.strictEqual(sol.issues.length, 0);
  assert(sol.steps.length > 0);
  sol.steps.forEach((s) => cube.applyMove(s.move));
  const after = C.analyze(cube);
  assert(after.edges.every((e) => !e.flipped.length && !e.unpaired.length), 'seed ' + seed);
  checks++;
}

// Plusieurs arêtes avec parité en même temps, après passage par les facelets (comme une photo).
{
  const cube = new C.Cube(N);
  cube.applyAlg(C.parityAlg([2, 5]));
  cube.applyAlg("R U' F2");
  cube.applyAlg(C.parityAlg([1]));
  cube.applyAlg("D L2 B'");
  const copy = new C.Cube(N).setFacelets(cube.facelets());
  const sol = C.solveParity(copy);
  assert.strictEqual(sol.analysis.edges.filter((e) => e.flipped.length).length, 2);
  sol.steps.forEach((s) => copy.applyMove(s.move));
  assert(C.analyze(copy).edges.every((e) => !e.flipped.length && !e.unpaired.length));
  checks++;
}

// Autres tailles impaires.
for (const n of [5, 7, 9, 11, 13]) {
  const cube = C.makeParityExample(n, lcg(n));
  const sol = C.solveParity(cube);
  sol.steps.forEach((s) => cube.applyMove(s.move));
  assert(C.analyze(cube).edges.every((e) => !e.flipped.length && !e.unpaired.length));
  checks++;
}

console.log(`OK : ${checks} vérifications réussies`);
