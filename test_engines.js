const fs = require('fs');
const { Chess, Dames, LEVELS } = new Function(fs.readFileSync(__dirname + '/engines.js', 'utf8') + '; return {Chess, Dames, LEVELS};')();

let ok = true;
function check(label, got, want) {
  const pass = got === want; if (!pass) ok = false;
  console.log(`${pass ? 'OK ' : 'ERR'} ${label}: ${got}${pass ? '' : ' (attendu ' + want + ')'}`);
}

// --- Échecs : perft de référence (chessprogramming.org)
const cases = [
  ['initiale', Chess.START, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
for (const [name, fen, vals] of cases) {
  const p = Chess.fromFEN(fen);
  vals.forEach((v, i) => check(`échecs ${name} perft(${i + 1})`, Chess.perft(p, i + 1), v));
  check(`échecs ${name} FEN aller-retour`, Chess.toFEN(p), fen);
}

// SAN : mat du berger
{
  const p = Chess.fromFEN(Chess.START);
  const seq = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
  let s = [];
  for (const want of seq) {
    const L = Chess.legal(p);
    const m = L.find(x => Chess.san(p, x, L) === want);
    if (!m) { s.push('?' + want); break; }
    s.push(Chess.san(p, m, L)); Chess.make(p, m);
  }
  check('SAN mat du berger', s.join(' '), seq.join(' '));
  check('mat détecté', Chess.legal(p).length === 0 && Chess.inCheck(p, p.side), true);
}

// IA échecs : trouve un mat en 1
{
  const p = Chess.fromFEN('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  const r = Chess.search(p, { maxDepth: 64, timeMs: 1500, noise: 0 });
  check('IA échecs mat en 1 (Rd8#)', Chess.san(p, r.move), 'Rd8#');
  console.log('   ', r);
}
// IA échecs : prend une dame offerte
{
  const p = Chess.fromFEN('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  const r = Chess.search(p, { maxDepth: 64, timeMs: 1500, noise: 0 });
  check('IA échecs gagne la dame (Nxg5)', Chess.san(p, r.move), 'Nxg5');
}
// Temps de réflexion par niveau depuis la position initiale
for (const lv of ['debutant', 'club', 'fort']) {
  const p = Chess.fromFEN(Chess.START);
  const r = Chess.search(p, LEVELS.chess[lv]);
  console.log(`    échecs ${lv}: ${Chess.san(p, r.move)} prof=${r.depth} noeuds=${r.nodes} ${r.ms}ms`);
}

// --- Dames : perft de référence (damforum.nl)
{
  const pos = Dames.initial();
  [9, 81, 658, 4265, 27117, 167140].forEach((v, i) => check(`dames perft(${i + 1})`, Dames.perft(pos, i + 1), v));
}
// Numérotation
check('dames num/idx aller-retour', [...Array(50)].every((_, k) => Dames.num(Dames.idx(k + 1)) === k + 1), true);
check('case 46 en bas à gauche', Dames.idx(46), 90);
check('case 1 en haut', Dames.idx(1), 1);

// Prise majoritaire : un pion blanc peut prendre 1 pièce ou en rafler 2 -> seule la rafle de 2 est légale
function setup(white, black, wk = [], bk = [], side = 1) {
  const pos = { b: new Int8Array(100), side, stack: [] };
  white.forEach(n => pos.b[Dames.idx(n)] = 1); black.forEach(n => pos.b[Dames.idx(n)] = -1);
  wk.forEach(n => pos.b[Dames.idx(n)] = 2); bk.forEach(n => pos.b[Dames.idx(n)] = -2);
  return pos;
}
{
  // Blanc en 32 ; noirs en 27 et 17 (rafle 32x21x12 = 2 pièces) ; noir en 28 (prise simple 32x23)
  const pos = setup([32], [27, 17, 28]);
  const { moves, capture } = Dames.gen(pos);
  check('prise obligatoire', capture, true);
  check('prise majoritaire : nb de coups', moves.length, 1);
  check('prise majoritaire : notation', Dames.notation(moves[0], moves), '32x12');
}
{
  // Dame volante blanche en 46, noir isolé en 28 : prise à distance, plusieurs cases d'arrivée
  const pos = setup([], [28], [46]);
  const { moves } = Dames.gen(pos);
  check('dame volante : arrivées possibles après 28', moves.map(m => Dames.num(m.to)).sort((a, b) => a - b).join(','), '5,10,14,19,23');
}
{
  // Pion qui atteint la dernière rangée en fin de prise -> promu ; noir en 7, blanc en 11 -> 11x2
  const pos = setup([11], [7]);
  const { moves } = Dames.gen(pos);
  check('promotion après prise', moves.length === 1 && moves[0].promo && Dames.num(moves[0].to) === 2, true);
}
// IA dames
for (const lv of ['debutant', 'club', 'fort']) {
  const pos = Dames.initial();
  const r = Dames.search(pos, LEVELS.dames[lv]);
  const L = Dames.gen(pos).moves;
  console.log(`    dames ${lv}: ${Dames.notation(r.move, L)} prof=${r.depth} noeuds=${r.nodes} ${r.ms}ms`);
}
{
  // L'IA doit prendre (et choisir la rafle majoritaire, seule légale)
  const pos = setup([32], [27, 17, 28, 1, 2]);
  const r = Dames.search(pos, LEVELS.dames.fort);
  check('IA dames joue la rafle', Dames.notation(r.move, Dames.gen(pos).moves), '32x12');
}
console.log(ok ? '\nTOUS LES TESTS PASSENT' : '\nDES TESTS ÉCHOUENT');
