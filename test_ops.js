// Tests de la couche militaire (ops.js) : node test_ops.js
const fs = require('fs');
const Ops = require('./ops.js');
const { Chess, Dames } = new Function(fs.readFileSync(__dirname + '/engines.js', 'utf8') + '; return {Chess, Dames};')();

let ok = true;
function check(label, got, want) {
  const pass = got === want; if (!pass) ok = false;
  console.log(`${pass ? 'OK ' : 'ERR'} ${label}: ${got}${pass ? '' : ' (attendu ' + want + ')'}`);
}
const names = set => [...set].map(Chess.sqName).sort().join(',');

// --- Brouillard de guerre
{
  const p = Chess.fromFEN(Chess.START);
  const cov = Ops.chessCoverage(p.b, 1);
  check('couverture initiale des Blancs : 32 cases (rangées 1 à 4)', cov.size, 32);
  check('aucune case au-delà de la rangée 4', [...cov].every(s => (s >> 4) <= 3), true);
  check('aucun ennemi visible au départ', Ops.visibleEnemies(p.b, 1).size, 0);
  const covB = Ops.chessCoverage(p.b, -1);
  check('couverture initiale des Noirs symétrique', [...covB].every(s => (s >> 4) >= 4) && covB.size === 32, true);
}
{
  // Tour blanche en a1 seule, pion noir en a5 : la tour voit a2..a5 (obstacle compris) et la rangée 1
  const p = Chess.fromFEN('4k3/8/8/p7/8/8/8/R3K3 w - - 0 1');
  const cov = Ops.chessCoverage(p.b, 1);
  check('la tour voit jusqu’au premier obstacle inclus', cov.has(Chess.parseSq('a5')) && !cov.has(Chess.parseSq('a6')), true);
  check('ennemi visible en a5', names(Ops.visibleEnemies(p.b, 1)), 'a5');
}
{
  // Le pion bloqué voit la case devant lui mais pas deux cases plus loin
  const p = Chess.fromFEN('4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1');
  const cov = Ops.chessCoverage(p.b, 1);
  check('pion bloqué : voit e3, pas e4', cov.has(Chess.parseSq('e3')) && !cov.has(Chess.parseSq('e4')), true);
  check('pion : diagonales surveillées', cov.has(Chess.parseSq('d3')) && cov.has(Chess.parseSq('f3')), true);
}
{
  // Toute destination légale est dans la couverture (le brouillard ne fuit pas par les coups possibles)
  const fens = [Chess.START, 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'];
  let all = true;
  for (const f of fens) {
    const p = Chess.fromFEN(f), cov = Ops.chessCoverage(p.b, p.side);
    for (const m of Chess.legal(p)) if (!cov.has(Chess.mTo(m))) all = false;
  }
  check('toutes les destinations légales sont couvertes', all, true);
}

// --- Événements échecs
check('prise -> Évincer', Ops.chessBlueEvent({ role: 'Pare-feu', to: 'e5', victimRole: 'Maliciel' }).tactic, 'evict');
check('échec -> Isoler', Ops.chessBlueEvent({ role: 'CALID', to: 'h5', check: true }).tactic, 'isolate');
check('roque -> Durcir', Ops.chessBlueEvent({ role: 'Poste de commandement', to: 'g1', castle: true }).tactic, 'harden');
check('révélation -> Détecter', Ops.chessBlueEvent({ role: 'Sonde de détection', to: 'c4', revealed: 2 }).text.includes('2 menaces repérées'), true);
check('promotion -> Restaurer', Ops.chessBlueEvent({ role: 'Poste sentinelle', to: 'e8', promoRole: 'CALID' }).tactic, 'restore');
{
  const hid = Ops.chessRedEvent({ role: 'APT', from: 'd8', to: 'h4', visibleTo: false });
  check('coup rouge hors couverture : non localisé', hid.detected === false && hid.text === 'Activité adverse hors couverture', true);
  const cap = Ops.chessRedEvent({ role: 'APT', from: 'd8', to: 'h4', visibleTo: false, victimRole: 'Pare-feu' });
  check('neutralisation : alerte localisée', cap.alert && cap.detected && cap.text.includes('origine hors couverture'), true);
}

check('mat bleu -> Évincer le C2', Ops.chessBlueEvent({ role: 'CALID', to: 'h4', check: true, mate: true }).text.startsWith('Éviction : serveur C2 adverse neutralisé'), true);
check('mat rouge -> compromission', Ops.chessRedEvent({ role: 'APT', from: 'h5', to: 'f7', visibleTo: true, check: true, mate: true, victimRole: 'Poste sentinelle' }).text.startsWith('COMPROMISSION'), true);
check('dames : une seule prise au singulier', Ops.damesRedEvent({ nota: '25x34', caps: 1, prevThreat: 2, newThreat: 2 }).text, 'Neutralisation d’une sentinelle (25x34)');

// --- Kill Chain
check('phases quand l’attaquant a les Noirs', [...Array(10)].map((_, r) => Ops.killChainPhase(r, -1)).join(''), '0000123456');
check('phases quand l’attaquant a les Blancs', [...Array(10)].map((_, r) => Ops.killChainPhase(r, 1)).join(''), '6543210000');
check('7 phases nommées', Ops.PHASES.length, 7);
{
  const pos = Dames.initial();
  check('menace initiale : Reconnaissance', Ops.threatLevel(pos.b, -1), 0);
  pos.b[Dames.idx(28)] = -1; // un pion noir infiltré en case 28 (rangée 5)
  check('implant en case 28 -> phase Livraison', Ops.PHASES[Ops.threatLevel(pos.b, -1)], 'Livraison');
  pos.b[Dames.idx(3)] = 2; pos.b[Dames.idx(48)] = -2; // une dame noire
  check('une dame adverse = phase 7', Ops.threatLevel(pos.b, -1), 6);
}
{
  // Pion noir en 23 ; un pion blanc qui arrive en 28 ou 29 se place devant lui
  const b = new Int8Array(100); b[Dames.idx(23)] = -1;
  check('blocage détecté (case 28)', Ops.damesBlocks(b, Dames.idx(28), -1), true);
  check('blocage détecté (case 29)', Ops.damesBlocks(b, Dames.idx(29), -1), true);
  check('pas de blocage loin du pion (case 37)', Ops.damesBlocks(b, Dames.idx(37), -1), false);
}
check('dames : prise -> Évincer', Ops.damesBlueEvent({ nota: '32x23', caps: 1 }).tactic, 'evict');
check('dames : appât -> Leurrer', Ops.damesBlueEvent({ nota: '33-28', caps: 0, deceive: true }).tactic, 'deceive');
check('dames : promotion rouge -> compromission', Ops.damesRedEvent({ nota: '42-47', caps: 0, promo: true, prevThreat: 5, newThreat: 6 }).text.startsWith('COMPROMISSION'), true);
check('dames : progression signalée', Ops.damesRedEvent({ nota: '19-24', caps: 0, phase: 2, prevThreat: 1, newThreat: 2 }).alert, true);

// --- Compte rendu
{
  const txt = Ops.reportText({
    theatre: 'Échecs · Brouillard de guerre', level: 'Modérée', result: 'Mission accomplie', why: 'Serveur C2 adverse maté.',
    turns: 2, date: '17/11/2026', summary: ['Mouvements adverses : 2, dont 1 localisé (50 %)'],
    tactics: { evict: 1, harden: 1 },
    chronology: [{ turn: 1, team: 'blue', tag: 'Durcir', text: 'Durcissement : redéploiement de votre Poste sentinelle en e4' }],
  });
  check('compte rendu : tactiques listées', txt.includes('Durcir (Harden) ×1, Évincer (Evict) ×1'), true);
  check('compte rendu : chronologie', txt.includes('T1   BLUE  [Durcir]'), true);
}

console.log(ok ? '\nTOUS LES TESTS PASSENT' : '\nDES TESTS ÉCHOUENT');
process.exitCode = ok ? 0 : 1;
